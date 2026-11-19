import type { ActionResult, GameState, IEventSystem, IGameContext, EventSystemState, WorldEvent } from '../core/contracts';
import type { EventConditionDef, EventDef, EventEffectDef, FestivalDef } from '../data/schema';
import type { EventId, LocationId, NPCId, SkillId } from '../core/SharedTypes';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { clamp, clamp01 } from '../core/utils';
import { addItemToInventory } from '../core/InventoryUtil';
import { applyRelationshipDelta, ensureRelationship } from '../core/RelationshipUtil';
import { addWorldHistory } from '../world/WorldHistory';
import { simSecondsToGameTime } from '../core/TimeUtil';

const GAME_HOUR_SIM_SECONDS = 60;
const MAX_EVENTS_KEPT = 400;
const MAX_ACTIVE_EVENTS = 40;
const MAX_EVENT_ROLLS_PER_UPDATE = 4;

function fail(message: string): ActionResult {
  return { ok: false, code: 'invalid', message };
}

function ok(message: string): ActionResult {
  return { ok: true, message };
}

function hourMatches(hour: number, from: number, to: number): boolean {
  if (from === to) return true;
  if (from < to) return hour >= from && hour < to;
  return hour >= from || hour < to;
}

/** Event scheduling, condition evaluation, effect application and seasonal festivals. */
export class EventSystem implements IEventSystem {
  readonly id = 'events';
  private ctx: IGameContext | null = null;
  private lastFestivalCheckAt = -1;
  private initialised = false;

  init(ctx: IGameContext): void {
    if (this.initialised) return;
    this.ctx = ctx;
    this.initialised = true;
    for (const stream of ['events.occurrence', 'events.festival']) {
      if (!ctx.probability.hasStream(stream)) ctx.probability.ensureStream(stream);
    }
    const eventState = ctx.state.eventSystem;
    if (eventState.lastGlobalEventAt <= 0) eventState.lastGlobalEventAt = ctx.clock.simTimeSeconds;
    this.updateFestivalStates(true);
  }

  update(_dtSimSeconds: number): void {
    if (!this.ctx) return;
    const now = this.ctx.clock.simTimeSeconds;
    this.pruneEvents(now);
    this.rollScheduledEvents(now);
    this.updateFestivalStates(false);
  }

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------
  private rollScheduledEvents(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const eventState = ctx.state.eventSystem;
    // worldEventIntervalGameMinutes is in GAME MINUTES; 1 sim second = 1 game minute.
    const interval = Math.max(1, Math.round(WORLD_CONFIG.simulation.worldEventIntervalGameMinutes));
    let rolls = 0;
    while (eventState.lastGlobalEventAt + interval <= now && rolls < MAX_EVENT_ROLLS_PER_UPDATE) {
      eventState.lastGlobalEventAt += interval;
      rolls += 1;
      this.tryTriggerRandomEvent(eventState.lastGlobalEventAt);
    }
    // Do not build up an unbounded backlog after a long offline period.
    if (eventState.lastGlobalEventAt + interval <= now) {
      eventState.lastGlobalEventAt = now - interval;
    }
  }

  private tryTriggerRandomEvent(at: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const state = ctx.state;
    const eventState = state.eventSystem;
    const eligible = this.contentEvents().filter((def) => this.isEligible(def, state, at));
    if (eligible.length === 0) return;

    // Probability of an event occurring at all this tick (roughly one event per 2-3 hours).
    if (!ctx.probability.chance('events.occurrence', 0.22)) return;

    const categoryWeights = eventState.categoryWeights;
    const categories = (['ordinary', 'interesting', 'lucky', 'unlucky', 'special'] as const).filter(
      (category) => eligible.some((def) => def.category === category)
    );
    if (categories.length === 0) return;
    const category = ctx.rng.weighted(
      'events.occurrence',
      categories.map((value) => ({ weight: Math.max(0.01, categoryWeights[value] ?? 0.1), value }))
    );
    if (!category) return;
    const candidates = eligible.filter((def) => def.category === category);
    const chosen = ctx.rng.weighted(
      'events.occurrence',
      candidates.map((def) => ({ weight: Math.max(0.01, def.weight), value: def }))
    );
    if (!chosen) return;
    this.triggerEventDef(chosen, at, null, 'scheduled');
  }

  private contentEvents(): EventDef[] {
    return this.ctx ? this.ctx.content.pack.events : [];
  }

  private isEligible(def: EventDef, state: GameState, now: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const eventState = state.eventSystem;
    if (eventState.uniqueTriggered.includes(def.id)) return false;
    const cooldownUntil = eventState.cooldowns[def.id] ?? 0;
    if (cooldownUntil > now) return false;
    const occurrences = eventState.occurrences[def.id] ?? 0;
    if (def.unique && occurrences > 0) return false;
    for (const condition of def.conditions) {
      if (!this.matchesCondition(condition, state)) return false;
    }
    return true;
  }

  private matchesCondition(condition: EventConditionDef, state: GameState): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const environment = state.world.environment;
    const time = ctx.clock.time;
    switch (condition.kind) {
      case 'season':
        return condition.seasons.includes(environment.season);
      case 'weather':
        return condition.weathers.includes(environment.weather);
      case 'hourRange':
        return hourMatches(time.hour, condition.from, condition.to);
      case 'dayOfSeason':
        return condition.days.includes(time.dayOfSeason);
      case 'locationTag':
        return ctx.content.pack.locations.some(
          (location) => !location.secret && condition.tags.some((tag) => location.eventTags.includes(tag))
        );
      case 'minInfluence':
        return state.player.influence >= condition.value;
      case 'minSkill':
        return (state.player.skills[condition.skill]?.level ?? 0) >= condition.level;
      case 'maxOccurrences':
        return (state.eventSystem.occurrences[condition.eventType] ?? 0) < condition.max;
      case 'flag':
        return (state.world.worldFlags[condition.flag] ?? false) === condition.equals;
      case 'probability':
        return ctx.probability.chance('events.occurrence', clamp01(condition.chance));
      default:
        return true;
    }
  }

  // -------------------------------------------------------------------------
  // Triggering
  // -------------------------------------------------------------------------
  private pickLocation(def: EventDef, state: GameState): LocationId | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const candidates = ctx.content.pack.locations.filter(
      (location) =>
        !location.indoor &&
        !location.secret &&
        state.world.locations[location.id]?.unlocked !== false &&
        def.locationTags.some((tag) => location.eventTags.includes(tag))
    );
    if (candidates.length > 0) {
      const picked = ctx.rng.weighted(
        'events.occurrence',
        candidates.map((location) => ({ weight: 1, value: location.id }))
      );
      if (picked) return picked;
    }
    const playerLocation = state.player.position.locationId;
    const playerDef = ctx.content.getLocation(playerLocation);
    if (playerDef && !playerDef.secret) return playerLocation;
    return null;
  }

  private pickParticipants(def: EventDef, state: GameState, locationId: LocationId | null): NPCId[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    const pool = Object.values(state.npcs).filter(
      (npc) => npc.alive && (locationId === null || npc.locationId === locationId)
    );
    const fallback = Object.values(state.npcs).filter((npc) => npc.alive);
    const source = pool.length > 0 ? pool : fallback;
    const shuffled = ctx.rng.shuffle(
      'events.occurrence',
      source.map((npc) => npc.id)
    );
    const count = clamp(
      ctx.rng.intRange('events.occurrence', def.minParticipants, Math.max(def.minParticipants, def.maxParticipants)),
      0,
      shuffled.length
    );
    return shuffled.slice(0, count);
  }

  private triggerEventDef(def: EventDef, at: number, sourceEventId: EventId | null, cause: string): WorldEvent | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const state = ctx.state;
    const locationId = this.pickLocation(def, state);
    const participants = this.pickParticipants(def, state, locationId);
    const event: WorldEvent = {
      id: 'evt_' + Math.round(at) + '_' + state.world.events.length,
      type: def.id,
      category: def.category,
      title: def.title,
      description: def.description,
      createdAt: at,
      occurredAt: at,
      participants,
      cause: sourceEventId ? [sourceEventId, cause] : [cause],
      result: {},
      importance: def.importance,
      archived: def.importance < 3,
      acknowledged: false,
    };
    if (sourceEventId) event.sourceEventId = sourceEventId;
    if (locationId) {
      event.locationId = locationId;
      const locationState = state.world.locations[locationId];
      if (locationState) locationState.lastEventAt = at;
    }

    for (const effect of def.effects) {
      this.applyEffect(effect, event, at);
    }

    state.world.events.push(event);
    while (state.world.events.length > MAX_EVENTS_KEPT) state.world.events.shift();
    const eventState = state.eventSystem;
    eventState.cooldowns[def.id] = at + def.cooldownHours * GAME_HOUR_SIM_SECONDS;
    eventState.occurrences[def.id] = (eventState.occurrences[def.id] ?? 0) + 1;
    if (def.unique && (eventState.occurrences[def.id] ?? 0) === 1) eventState.uniqueTriggered.push(def.id);
    if (def.durationHours > 0) {
      eventState.activeEventIds.push(event.id);
      while (eventState.activeEventIds.length > MAX_ACTIVE_EVENTS) eventState.activeEventIds.shift();
    }
    eventState.pendingNotifications.push(event.id);
    while (eventState.pendingNotifications.length > 40) eventState.pendingNotifications.shift();
    addWorldHistory(state.world, {
      at,
      category: def.category === 'special' ? 'discovery' : def.locationTags.includes('market') ? 'economy' : 'world',
      description: def.title + ': ' + def.description,
      importance: def.importance,
      participantIds: participants,
      ...(locationId ? { locationId } : {}),
      relatedEventId: event.id,
    });
    ctx.bus.emit('event:occurred', { event });
    return event;
  }

  private applyEffect(effect: EventEffectDef, event: WorldEvent, at: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const state = ctx.state;
    switch (effect.kind) {
      case 'relationship': {
        const targets =
          effect.target === 'player_best'
            ? event.participants.slice(0, 1)
            : effect.target === 'random_npc'
              ? event.participants.slice(0, 1)
              : event.participants.slice(0, 4);
        for (const npcId of targets) {
          const npc = state.npcs[npcId];
          if (!npc) continue;
          const playerRel = ensureRelationship(state.player.relationships, npcId, at);
          applyRelationshipDelta(playerRel, effect.delta, at);
          const npcRel = ensureRelationship(npc.relationships, 'player', at);
          applyRelationshipDelta(npcRel, effect.delta, at);
          ctx.bus.emit('relationship:changed', {
            npcId,
            kind: 'npc_npc',
            affinity: playerRel.affinity,
            trust: playerRel.trust,
            intimacy: playerRel.intimacy,
            status: playerRel.status,
          });
        }
        break;
      }
      case 'money': {
        const amount = Math.round(effect.amount);
        if (effect.target === 'player') {
          state.player.money = Math.max(0, state.player.money + amount);
          ctx.bus.emit('money:changed', { amount, balance: state.player.money, reason: 'event' });
        } else {
          for (const npcId of event.participants.slice(0, 1)) {
            const npc = state.npcs[npcId];
            if (npc) npc.money = Math.max(0, npc.money + amount);
          }
        }
        break;
      }
      case 'item': {
        const def = ctx.content.getItem(effect.itemId);
        addItemToInventory(state.player.inventory, effect.itemId, Math.max(1, effect.quantity), {
          simTime: at,
          maxStack: def?.maxStack ?? 99,
          quality: 2,
        });
        ctx.bus.emit('item:acquired', {
          itemId: effect.itemId,
          quantity: Math.max(1, effect.quantity),
          quality: 2,
          source: 'event',
        });
        break;
      }
      case 'npc_mood': {
        for (const npcId of event.participants.slice(0, 8)) {
          const npc = state.npcs[npcId];
          if (!npc) continue;
          npc.emotions.joy = clamp01(npc.emotions.joy + effect.value);
          npc.emotions.stress = clamp01(npc.emotions.stress - effect.value * 0.5);
          npc.mood = clamp(npc.mood + effect.value, -1, 1);
        }
        break;
      }
      case 'history': {
        addWorldHistory(state.world, {
          at,
          category: 'world',
          description: effect.description,
          importance: effect.importance,
          participantIds: event.participants,
          ...(event.locationId ? { locationId: event.locationId } : {}),
          relatedEventId: event.id,
        });
        break;
      }
      case 'worldFlag': {
        state.world.worldFlags[effect.flag] = effect.value;
        break;
      }
      case 'chainEvent': {
        if (ctx.probability.chance('events.occurrence', clamp01(effect.chance))) {
          const def = ctx.content.getEvent(effect.eventId);
          if (def) this.triggerEventDef(def, at, event.id, 'chain');
        }
        break;
      }
      case 'weather': {
        const environment = state.world.environment;
        environment.previousWeather = environment.weather;
        environment.weather = effect.weather;
        environment.nextWeatherChangeAt = at + Math.max(1, effect.durationHours) * GAME_HOUR_SIM_SECONDS;
        ctx.bus.emit('weather:changed', {
          weather: environment.weather,
          previous: environment.previousWeather,
          temperature: environment.temperature,
          windSpeed: environment.windSpeed,
        });
        break;
      }
      default:
        break;
    }
  }

  private pruneEvents(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const state = ctx.state;
    const eventState = state.eventSystem;
    const defs = new Map(ctx.content.pack.events.map((def) => [def.id, def]));
    eventState.activeEventIds = eventState.activeEventIds.filter((eventId) => {
      const event = state.world.events.find((candidate) => candidate.id === eventId);
      if (!event) return false;
      const def = defs.get(event.type);
      const duration = def ? def.durationHours : 2;
      return now < event.occurredAt + duration * GAME_HOUR_SIM_SECONDS;
    });
    if (state.world.events.length > MAX_EVENTS_KEPT) {
      state.world.events.splice(0, state.world.events.length - MAX_EVENTS_KEPT);
    }
  }

  // -------------------------------------------------------------------------
  // Festivals
  // -------------------------------------------------------------------------
  private updateFestivalStates(initial: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const state = ctx.state;
    const time = ctx.clock.time;
    const now = ctx.clock.simTimeSeconds;
    if (!initial && now - this.lastFestivalCheckAt < 5 * GAME_HOUR_SIM_SECONDS) return;
    this.lastFestivalCheckAt = now;
    const festivals: FestivalDef[] = ctx.content.pack.festivals;
    for (const festival of festivals) {
      const seasonIndex = ['spring', 'summer', 'autumn', 'winter'].indexOf(festival.season);
      const existing = state.eventSystem.festivals[festival.id];
      const record = existing ?? { season: seasonIndex, day: festival.dayOfSeason, state: 'upcoming' as const, participantCount: 0 };
      const locationState = state.world.locations[festival.locationId];
      const participantCount = locationState
        ? Object.values(state.npcs).filter((npc) => npc.locationId === festival.locationId).length
        : 0;
      record.participantCount = participantCount;
      const isFestivalDay = time.seasonIndex === seasonIndex && time.dayOfSeason === festival.dayOfSeason;
      const isActive = isFestivalDay && time.hour >= festival.startHour && time.hour < festival.startHour + festival.durationHours;
      const wasActive = record.state === 'active';
      if (isActive) {
        record.state = 'active';
        if (!wasActive) {
          addWorldHistory(state.world, {
            at: now,
            category: 'festival',
            description: festival.name + ' begins in ' + locationName(ctx, festival.locationId),
            importance: festival.importance,
            locationId: festival.locationId,
          });
          ctx.bus.emit('festival:started', { festivalId: festival.id, locationId: festival.locationId });
        }
      } else if (isFestivalDay && time.hour >= festival.startHour + festival.durationHours) {
        record.state = 'ended';
      } else {
        const festivalDayIndex = seasonIndex * 28 + festival.dayOfSeason;
        const currentDayIndex = time.seasonIndex * 28 + time.dayOfSeason;
        record.state = currentDayIndex > festivalDayIndex ? 'ended' : 'upcoming';
      }
      state.eventSystem.festivals[festival.id] = record;
    }
  }

  getFestivals(): { def: FestivalDef; state: EventSystemState['festivals'][string] }[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    return ctx.content.pack.festivals.map((def) => ({
      def,
      state: ctx.state.eventSystem.festivals[def.id] ?? { season: 0, day: def.dayOfSeason, state: 'upcoming', participantCount: 0 },
    }));
  }

  participateFestival(festivalId: string, activityId: string): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return fail('Events are not running');
    const festival = ctx.content.getFestival(festivalId);
    if (!festival) return fail('Unknown festival');
    const record = ctx.state.eventSystem.festivals[festivalId];
    if (!record || record.state !== 'active') return fail('That festival is not active right now');
    const activity = festival.activities.find((candidate) => candidate.id === activityId);
    if (!activity) return fail('Unknown festival activity');
    const now = ctx.clock.simTimeSeconds;
    const cooldownKey = 'festival:' + festivalId + ':' + activityId;
    if ((ctx.state.eventSystem.cooldowns[cooldownKey] ?? 0) > now) return fail('You already joined that activity this festival');
    if (ctx.state.player.position.locationId !== festival.locationId) {
      const playerDef = ctx.content.getLocation(ctx.state.player.position.locationId);
      if (!playerDef || playerDef.indoor !== false) return fail('You need to be at ' + (ctx.content.getLocation(festival.locationId)?.name ?? festival.locationId));
    }
    const skill: SkillId | null = activity.skill ?? null;
    const skillLevel = skill ? ctx.state.player.skills[skill]?.level ?? 1 : 1;
    const chance = clamp(0.35 + skillLevel * 0.035 + ctx.state.player.influence / 600, 0.12, 0.95);
    const success = ctx.probability.chance('events.festival', chance);
    const rewards: string[] = [];
    if (success) {
      if (activity.rewardMoney) {
        ctx.state.player.money += activity.rewardMoney;
        rewards.push(activity.rewardMoney + 'p');
        ctx.bus.emit('money:changed', {
          amount: activity.rewardMoney,
          balance: ctx.state.player.money,
          reason: 'festival',
        });
      }
      if (activity.rewardItemId) {
        const def = ctx.content.getItem(activity.rewardItemId);
        addItemToInventory(ctx.state.player.inventory, activity.rewardItemId, 1, {
          simTime: now,
          maxStack: def?.maxStack ?? 99,
          quality: 3,
        });
        rewards.push(def?.name ?? activity.rewardItemId);
        ctx.bus.emit('item:acquired', {
          itemId: activity.rewardItemId,
          quantity: 1,
          quality: 3,
          source: 'festival',
        });
      }
      ctx.state.player.influence += 6;
      ctx.state.player.communityPoints += 2;
      const skillSystem = ctx.registry.get('skill') as unknown as
        | { addXp?: (skillId: SkillId, amount: number, source: string) => void }
        | undefined;
      if (skill && skillSystem?.addXp) skillSystem.addXp(skill, 30, 'festival');
    }
    ctx.state.eventSystem.cooldowns[cooldownKey] = now + 24 * GAME_HOUR_SIM_SECONDS;
    ctx.state.player.statistics.festivalsAttended += 1;
    ctx.state.player.influence += 2;
    const participants = Object.values(ctx.state.npcs)
      .filter((npc) => npc.locationId === festival.locationId)
      .slice(0, 6)
      .map((npc) => npc.id);
    const event: WorldEvent = {
      id: 'evt_festival_' + Math.round(now) + '_' + festivalId,
      type: 'festival:' + festivalId,
      category: 'special',
      title: festival.name + ' — ' + activity.label,
      description:
        activity.label + ' at ' + festival.name + ': ' +
        (success ? 'it went beautifully. ' + (rewards.length > 0 ? 'Rewards: ' + rewards.join(', ') : '') : 'it could have gone better, but the day was warm.'),
      createdAt: now,
      occurredAt: now,
      participants,
      cause: ['festival'],
      result: { success, activityId, rewards },
      importance: festival.importance,
      archived: false,
      acknowledged: false,
      locationId: festival.locationId,
    };
    ctx.state.world.events.push(event);
    addWorldHistory(ctx.state.world, {
      at: now,
      category: 'festival',
      description: event.description,
      importance: festival.importance,
      participantIds: participants,
      locationId: festival.locationId,
      relatedEventId: event.id,
    });
    ctx.bus.emit('festival:participated', {
      festivalId,
      activityId,
      result: success ? 'success' : 'failure',
    });
    ctx.bus.emit('event:occurred', { event });
    return {
      ok: true,
      message: success ? 'You took part in ' + activity.label + '. ' + rewards.join(', ') : 'You took part in ' + activity.label + ', but did not win anything.',
      stateChanged: true,
    };
  }

  // -------------------------------------------------------------------------
  // IEventSystem queries
  // -------------------------------------------------------------------------
  getActiveEvents(): WorldEvent[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    const ids = new Set(ctx.state.eventSystem.activeEventIds);
    return ctx.state.world.events.filter((event) => ids.has(event.id));
  }

  getRecentEvents(limit = 20): WorldEvent[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    return ctx.state.world.events.slice(-Math.max(1, limit)).reverse();
  }

  acknowledgeEvent(eventId: EventId): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return fail('Events are not running');
    const event = ctx.state.world.events.find((candidate) => candidate.id === eventId);
    if (!event) return fail('Unknown event');
    event.acknowledged = true;
    ctx.state.eventSystem.pendingNotifications = ctx.state.eventSystem.pendingNotifications.filter((id) => id !== eventId);
    return ok('Notice dismissed');
  }

  triggerEventForTesting(eventId: string): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return fail('Events are not running');
    const def = ctx.content.getEvent(eventId);
    if (!def) return fail('Unknown event definition');
    const event = this.triggerEventDef(def, ctx.clock.simTimeSeconds, null, 'testing');
    return event ? ok('Triggered ' + def.title) : fail('Could not trigger event');
  }

  getEventSystemState(): EventSystemState {
    if (!this.ctx) throw new Error('EventSystem not initialised');
    return this.ctx.state.eventSystem;
  }
}

function locationName(ctx: IGameContext, locationId: LocationId): string {
  return ctx.content.getLocation(locationId)?.name ?? locationId;
}