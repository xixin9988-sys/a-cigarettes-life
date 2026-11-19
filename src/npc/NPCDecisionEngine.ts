// =============================================================================
// NPCDecisionEngine - Utility AI for autonomous NPC behaviour.
//
// Every eligible candidate action is scored as
//   utility = needScore * personalityWeight * scheduleBonus * memoryInfluence
//             * historyPenalty * availabilityFactor
// The top candidates are handed to the unified ProbabilityEngine (stream
// 'npc.behavior') which performs the actual weighted selection. No randomness
// is consumed outside ctx.probability, so seeds reproduce exactly.
// =============================================================================
import type {
  GameState,
  IGameContext,
  JobState,
  NPCState,
  ProbabilityContext,
} from '../core/contracts';
import type { GameTime, LocationId, RegionId } from '../core/SharedTypes';
import { isWithinHours } from '../core/TimeUtil';
import { clamp, hashString } from '../core/utils';
import { LOC, regionOfLocation } from '../data/locations/ids';
import {
  DECISION_ACTIVITIES,
  NPC_MODULE,
  activityGroupOf,
  getActivityDefinition,
  type ActivityDefinition,
  type ActivityGroup,
} from './NPC';
import { NeedSystem } from './NeedSystem';
import { PersonalitySystem, deriveProfile, normalisePersonality } from './PersonalitySystem';
import { ScheduleSystem } from './ScheduleSystem';
import { MemorySystem } from './MemorySystem';
import { RelationshipSystem } from './RelationshipSystem';

const BEHAVIOR_STREAM = 'npc.behavior';

export interface DecisionCandidate {
  /** Activity id (unique among candidates). */
  id: string;
  /** Same value as id; kept explicit for readability of decision records. */
  activity: string;
  label: string;
  group: ActivityGroup;
  utility: number;
  /** Final decision weight handed to the probability engine. */
  weight: number;
  targetLocationId: LocationId;
  targetNpcId: string | null;
  durationMinutes: number;
  scheduleBonus: number;
  personalityWeight: number;
  memoryInfluence: number;
  needScore: number;
  historyPenalty: number;
  /** Extra availability factor (money, opening hours, weather...). */
  availability: number;
  eligible: boolean;
  rejectionReason: string | null;
}

export interface DecisionOutcome {
  activity: string;
  targetLocationId: LocationId;
  targetNpcId: string | null;
  durationMinutes: number;
  candidates: DecisionCandidate[];
  decisionId: string | null;
  totalWeight: number;
  at: number;
}

interface CandidateDraft {
  activity: string;
  definition: ActivityDefinition;
  eligible: boolean;
  rejectionReason: string | null;
  targetLocationId: LocationId;
  targetNpcId: string | null;
  availability: number;
  durationMinutes: number;
}

/** Deterministic 0..1 hash (no probability stream consumption). */
function deterministicUnit(key: string): number {
  const hash = hashString(key);
  return (hash % 10000) / 10000;
}

function locationOpen(state: GameState, ctx: IGameContext, locationId: LocationId, hour: number): boolean {
  const def = ctx.content.getLocation(locationId);
  if (def?.businessId) {
    const business = state.economy.businesses[def.businessId];
    if (business) return isWithinHours(hour, business.openHour, business.closeHour);
  }
  if (def) return isWithinHours(hour, def.openHour, def.closeHour);
  // Unknown synthetic content in tests: assume normal trading hours.
  return hour >= 7 && hour < 20;
}

export interface DecisionEngineDeps {
  personality: PersonalitySystem;
  needs: NeedSystem;
  schedule: ScheduleSystem;
  memory: MemorySystem;
  relationships: RelationshipSystem;
}

export class NPCDecisionEngine {
  private readonly personality: PersonalitySystem;
  private readonly needs: NeedSystem;
  private readonly schedule: ScheduleSystem;
  private readonly memory: MemorySystem;
  private readonly relationships: RelationshipSystem;

  constructor(deps: DecisionEngineDeps) {
    this.personality = deps.personality;
    this.needs = deps.needs;
    this.schedule = deps.schedule;
    this.memory = deps.memory;
    this.relationships = deps.relationships;
  }

  /**
   * Evaluates every candidate, keeps the best few and lets the probability
   * engine choose. Returns the chosen activity plus the full candidate list for
   * debug/archive purposes.
   */
  decide(ctx: IGameContext, npc: NPCState): DecisionOutcome {
    const state = ctx.state;
    const now = ctx.clock.simTimeSeconds;
    const time = ctx.clock.time;
    const hour = time.hour + time.minute / 60;
    const expectedActivity = this.schedule.getExpectedActivity(npc, hour);
    const expectedGroup = activityGroupOf(expectedActivity);
    const drafts: CandidateDraft[] = [];
    for (const definition of DECISION_ACTIVITIES) {
      const draft = this.buildCandidate(ctx, npc, definition, time, hour, expectedGroup);
      if (draft) drafts.push(draft);
    }
    const scored: DecisionCandidate[] = [];
    for (const draft of drafts) {
      if (!draft.eligible) continue;
      const needScore = this.needs.evaluateNeedDelta(npc, draft.definition.satisfy);
      const personalityWeight = this.personality.activityMultiplier(npc, draft.activity);
      const scheduleBonus = this.scheduleBonus(draft.activity, expectedGroup, expectedActivity);
      const memoryInfluence = this.memory.influence(npc, {
        activityId: draft.activity,
        activityGroup: draft.definition.group,
        ...(draft.targetNpcId ? { participantId: draft.targetNpcId } : {}),
      });
      const historyPenalty = this.historyPenalty(npc, draft.activity, draft.definition.group);
      const rawUtility =
        needScore * personalityWeight * scheduleBonus * memoryInfluence * historyPenalty * draft.availability;
      const utility = Number.isFinite(rawUtility) ? rawUtility : 0;
      scored.push({
        id: draft.activity,
        activity: draft.activity,
        label: draft.definition.label,
        group: draft.definition.group,
        utility,
        weight: Math.max(0, utility),
        targetLocationId: draft.targetLocationId,
        targetNpcId: draft.targetNpcId,
        durationMinutes: draft.durationMinutes,
        scheduleBonus,
        personalityWeight,
        memoryInfluence,
        needScore,
        historyPenalty,
        availability: draft.availability,
        eligible: true,
        rejectionReason: null,
      });
    }
    scored.sort((a, b) => b.utility - a.utility);
    let shortlist = scored.filter((candidate) => candidate.utility > 0.0001).slice(0, NPC_MODULE.maxDecisionCandidates);
    if (shortlist.length === 0) {
      shortlist = [this.fallbackCandidate(ctx, npc, expectedGroup)];
    }
    const totalWeight = shortlist.reduce((total, candidate) => total + candidate.weight, 0);
    const decisionContext: ProbabilityContext = {
      worldId: state.world.worldId,
      lifeId: state.life.lifeId,
      simulationTime: now,
      locationId: npc.locationId,
      weather: state.world.environment.weather,
      season: state.world.environment.season,
      actorId: npc.id,
      actorState: {
        hour,
        day: time.totalDays,
        activity: npc.currentActivity,
        expectedActivity,
        mood: npc.mood,
        needs: { ...npc.needs },
        jobId: npc.jobId,
        money: npc.money,
        mostUrgentNeed: this.needs.mostUrgentNeed(npc).need,
      },
    };
    const decision = ctx.probability.decide<DecisionCandidate>({
      streamId: BEHAVIOR_STREAM,
      decisionType: 'npc.activity',
      context: decisionContext,
      candidates: shortlist.map((candidate) => ({
        id: candidate.activity,
        baseWeight: Math.max(candidate.weight, 0.0001),
        result: candidate,
      })),
      minWeight: 0.0001,
      maxWeight: 1000,
    });
    const selected = decision.selectedResult ?? shortlist[0];
    if (!selected) {
      const fallback = this.fallbackCandidate(ctx, npc, expectedGroup);
      return {
        activity: fallback.activity,
        targetLocationId: fallback.targetLocationId,
        targetNpcId: fallback.targetNpcId,
        durationMinutes: fallback.durationMinutes,
        candidates: [fallback],
        decisionId: decision.decisionId,
        totalWeight: fallback.weight,
        at: now,
      };
    }
    return {
      activity: selected.activity,
      targetLocationId: selected.targetLocationId,
      targetNpcId: selected.targetNpcId,
      durationMinutes: selected.durationMinutes,
      candidates: shortlist,
      decisionId: decision.decisionId,
      totalWeight,
      at: now,
    };
  }

  /** Utility bonus for following / ignoring the planned schedule. */
  private scheduleBonus(activity: string, expectedGroup: ActivityGroup, expectedActivity: string): number {
    const group = activityGroupOf(activity);
    if (activity === expectedActivity) return 1.75;
    if (group === expectedGroup) return 1.5;
    switch (expectedGroup) {
      case 'work':
        return group === 'food' ? 0.9 : 0.62;
      case 'sleep':
        return group === 'sleep' ? 1.75 : 0.55;
      case 'social':
        return group === 'social' ? 1.45 : 0.9;
      case 'food':
        return group === 'food' ? 1.4 : 0.85;
      case 'errand':
        return group === 'errand' ? 1.3 : 0.85;
      case 'leisure':
        return group === 'leisure' ? 1.35 : 0.9;
      case 'home':
        return group === 'home' ? 1.4 : 0.85;
      case 'care':
        return group === 'care' ? 1.3 : 0.85;
      default:
        return 1;
    }
  }

  /** Repeating the same group/activity repeatedly gets boring. */
  private historyPenalty(npc: NPCState, activity: string, group: ActivityGroup): number {
    const history = npc.activityHistory;
    if (history.length === 0) return 1;
    const last = history[history.length - 1];
    const secondLast = history.length >= 2 ? history[history.length - 2] : undefined;
    let penalty = 1;
    if (last === activity) penalty *= NPC_MODULE.repeatedActivityPenalty;
    else if (last !== undefined && activityGroupOf(last) === group) penalty *= 0.82;
    if (secondLast === activity) penalty *= 0.9;
    return penalty;
  }

  /** Builds one candidate draft for an activity definition. */
  private buildCandidate(
    ctx: IGameContext,
    npc: NPCState,
    definition: ActivityDefinition,
    time: GameTime,
    hour: number,
    expectedGroup: ActivityGroup
  ): CandidateDraft | null {
    const state = ctx.state;
    const profile = deriveProfile(normalisePersonality(npc.personality));
    const base: CandidateDraft = {
      activity: definition.id,
      definition,
      eligible: true,
      rejectionReason: null,
      targetLocationId: npc.homeLocationId,
      targetNpcId: null,
      availability: 1,
      durationMinutes: this.durationFor(npc, definition, time),
    };
    const weather = state.world.environment.weather;
    const outdoorFactor = weather === 'rain' || weather === 'storm' || weather === 'snow' ? 0.55 : weather === 'clear' ? 1.12 : 1;
    const nightFactor = hour >= 23 || hour < 5 ? 0.25 : hour >= 22 ? 0.6 : 1;
    const duty = clamp(npc.personality.responsibility, 0, 1);

    switch (definition.id) {
      case 'work': {
        const job = npc.jobId ? state.economy.jobs[npc.jobId] : undefined;
        const inShift = job ? isWithinHours(hour, job.startHour, job.endHour) : expectedGroup === 'work';
        if (hour >= 22 || hour < 4) {
          return this.ineligible(base, 'unreasonable hour for work');
        }
        if (job && !inShift && npc.needs.workPressure < 65) {
          base.availability = 0.45;
        }
        if (!job && expectedGroup !== 'work' && npc.needs.workPressure < 40) {
          base.availability = 0.5;
        }
        base.targetLocationId = this.locationOr(ctx, npc.workLocationId, npc.homeLocationId);
        base.availability *= 0.85 + 0.3 * duty;
        return base;
      }
      case 'go_home': {
        if (npc.locationId === npc.homeLocationId && expectedGroup !== 'home') {
          return this.ineligible(base, 'already at home');
        }
        base.targetLocationId = npc.homeLocationId;
        base.availability = nightFactor === 1 ? 1 : 1.1;
        return base;
      }
      case 'sleep': {
        const energyUrgency = (100 - npc.needs.energy) / 100;
        const canSleep = hour >= 21 || hour < 6.5 || energyUrgency > 0.7 || expectedGroup === 'sleep';
        if (!canSleep) return this.ineligible(base, 'not tired and daytime');
        base.targetLocationId = npc.homeLocationId;
        if (expectedGroup === 'work' && duty > 0.5) base.availability = 0.5;
        if (hour >= 23 || hour < 5) base.availability *= 1.15;
        return base;
      }
      case 'eat': {
        const hunger = npc.needs.hunger;
        if (hunger < 14 && expectedGroup !== 'food') return this.ineligible(base, 'not hungry');
        const cafe = this.pickRegional(ctx, npc, [LOC.cafe, LOC.bakery], [LOC.cityCafe, LOC.restaurant]);
        const canBuy = npc.money >= 1200 && locationOpen(state, ctx, cafe, hour);
        const wantsOut = hunger > 45 && canBuy && deterministicUnit(npc.id + ':eat:' + Math.floor(hour)) > 0.45;
        base.targetLocationId = wantsOut ? cafe : this.locationOr(ctx, npc.homeLocationId, npc.homeLocationId);
        if (wantsOut) base.availability *= 0.9 + 0.2 * profile.spendDrive;
        return base;
      }
      case 'shop': {
        const shop = this.pickRegional(ctx, npc, [LOC.grocery, LOC.market], [LOC.supermarket, LOC.convenienceStore]);
        const open = locationOpen(state, ctx, shop, hour);
        if (!open || hour < 8 || hour > 20 || npc.money < 2500) {
          return this.ineligible(base, npc.money < 2500 ? 'cannot afford shopping' : 'shops closed');
        }
        base.targetLocationId = shop;
        const disposable = clamp((npc.money - 2000) / 40000, 0, 1);
        base.availability = (0.35 + 0.65 * disposable) * (0.8 + 0.4 * profile.spendDrive) * outdoorFactor;
        return base;
      }
      case 'stroll': {
        if (hour < 6 || hour > 21.5) return this.ineligible(base, 'too late for a stroll');
        base.targetLocationId = this.pickRegional(ctx, npc, [LOC.park, LOC.plaza], [LOC.cityPark, LOC.riversideWalk]);
        base.availability = outdoorFactor * (hour >= 23 ? 0.2 : 1);
        return base;
      }
      case 'read': {
        if (hour >= 23 || hour < 6) return this.ineligible(base, 'too late to read');
        const library = this.pickRegional(ctx, npc, [LOC.library, LOC.bookshop], [LOC.cityLibrary, LOC.museum]);
        const wantsLibrary = locationOpen(state, ctx, library, hour) && profile.curiosity > 0.42;
        base.targetLocationId = wantsLibrary ? library : npc.homeLocationId;
        base.availability *= 0.9 + 0.2 * profile.curiosity;
        return base;
      }
      case 'fish': {
        if (hour < 5 || hour > 20.5) return this.ineligible(base, 'not fishing hours');
        const interested = npc.interests.includes('fishing') || npc.interests.includes('water') || profile.adventure > 0.6;
        if (!interested && expectedGroup !== 'explore') return this.ineligible(base, 'no interest in fishing');
        base.targetLocationId = this.pickRegional(ctx, npc, [LOC.river, LOC.lake], [LOC.riversideWalk, LOC.cityPark]);
        base.availability = outdoorFactor * (weather === 'storm' ? 0.4 : 1);
        return base;
      }
      case 'garden': {
        if (hour < 6 || hour > 19.5) return this.ineligible(base, 'not gardening hours');
        const interested =
          npc.interests.includes('gardening') || npc.interests.includes('plants') || profile.curiosity > 0.55;
        if (!interested && expectedGroup !== 'explore') return this.ineligible(base, 'no interest in gardening');
        base.targetLocationId = this.pickRegional(ctx, npc, [LOC.greenhouse, LOC.farm], [LOC.cityPark, LOC.orchard]);
        base.availability = outdoorFactor;
        return base;
      }
      case 'visit_friend': {
        if (hour < 7.5 || hour > 21.5) return this.ineligible(base, 'too late to visit');
        const target = this.relationships.bestSocialTarget(npc, state);
        if (!target) return this.ineligible(base, 'no friends to visit yet');
        if (target.currentActivity === 'sleep' || !target.alive) {
          return this.ineligible(base, 'friend is asleep');
        }
        base.targetNpcId = target.id;
        base.targetLocationId = target.locationId;
        base.durationMinutes = Math.round(definition.baseDurationMinutes * (0.85 + 0.3 * profile.socialDrive));
        base.availability = outdoorFactor;
        return base;
      }
      case 'go_cafe': {
        const cafe = this.pickRegional(ctx, npc, [LOC.cafe], [LOC.cityCafe]);
        if (!locationOpen(state, ctx, cafe, hour) || npc.money < 900) {
          return this.ineligible(base, npc.money < 900 ? 'cannot afford cafe' : 'cafe closed');
        }
        base.targetLocationId = cafe;
        const disposable = clamp((npc.money - 500) / 25000, 0, 1);
        base.availability = (0.45 + 0.55 * disposable) * (0.75 + 0.5 * profile.spendDrive);
        return base;
      }
      case 'date': {
        const partner = this.relationships.romanticPartnerOf(npc, state);
        if (!partner) return this.ineligible(base, 'not seeing anyone');
        if (hour < 10 || hour > 22) return this.ineligible(base, 'wrong time for a date');
        if (partner.currentActivity === 'sleep') return this.ineligible(base, 'partner is asleep');
        const dateSpot = this.pickRegional(
          ctx,
          npc,
          hour >= 17 ? [LOC.cafe, LOC.park] : [LOC.park, LOC.cafe],
          hour >= 17 ? [LOC.restaurant, LOC.cityCafe] : [LOC.cityPark, LOC.museum]
        );
        if (partner.locationId === npc.locationId) {
          // Already together: staying in together counts as the date.
          base.targetLocationId = npc.locationId;
        } else {
          base.targetLocationId = locationOpen(state, ctx, dateSpot, hour) ? dateSpot : partner.locationId;
        }
        base.targetNpcId = partner.id;
        return base;
      }
      case 'attend_event': {
        const festival = this.activeFestival(ctx, time);
        if (festival) {
          if (hour < festival.startHour || hour > festival.startHour + festival.durationHours) {
            return this.ineligible(base, 'festival not running right now');
          }
          base.targetLocationId = this.locationOr(ctx, festival.locationId, npc.locationId);
          base.availability = 1.25;
          return base;
        }
        const activeEventLocation = this.activeWorldEventLocation(ctx, time);
        if (activeEventLocation) {
          base.targetLocationId = activeEventLocation;
          base.availability = 1.1;
          return base;
        }
        return this.ineligible(base, 'nothing on today');
      }
      case 'rest': {
        if (expectedGroup === 'work' && duty > 0.6) base.availability = 0.45;
        base.targetLocationId = npc.locationId === npc.homeLocationId ? npc.homeLocationId : npc.homeLocationId;
        base.availability *= nightFactor;
        return base;
      }
      case 'personal_errand': {
        if (hour < 8 || hour > 18.5) return this.ineligible(base, 'errand hours over');
        const errand = this.pickRegional(ctx, npc, [LOC.postOffice, LOC.grocery], [LOC.officeDistrict, LOC.supermarket]);
        base.targetLocationId = locationOpen(state, ctx, errand, hour) ? errand : npc.homeLocationId;
        base.availability = 0.85 + 0.3 * duty;
        return base;
      }
      case 'look_for_work': {
        if (npc.jobId !== null) return this.ineligible(base, 'already employed');
        if (hour < 8 || hour > 18) return this.ineligible(base, 'not hiring hours');
        const job = this.vacantJob(ctx);
        if (!job) return this.ineligible(base, 'no vacancies');
        base.targetLocationId = this.jobLocation(ctx, job, npc);
        return base;
      }
      case 'travel': {
        if (hour < 6 || hour > 22) return this.ineligible(base, 'no travel at night');
        if (profile.riskDrive < 0.42) return this.ineligible(base, 'prefers to stay close to home');
        const homeRegion: RegionId = regionOfLocation(npc.homeLocationId);
        const destination: readonly LocationId[] =
          homeRegion === 'willowbrook'
            ? [LOC.culturalCenter, LOC.highStreet, LOC.eventSquare]
            : [LOC.center, LOC.plaza, LOC.park];
        base.targetLocationId = npc.homeLocationId;
        for (const candidate of destination) {
          if (ctx.content.getLocation(candidate)) {
            base.targetLocationId = candidate;
            break;
          }
        }
        if (base.targetLocationId === npc.homeLocationId) {
          return this.ineligible(base, 'nowhere to travel to');
        }
        base.availability *= 0.7 + 0.5 * profile.riskDrive;
        return base;
      }
      default:
        return null;
    }
  }

  private ineligible(base: CandidateDraft, reason: string): CandidateDraft {
    base.eligible = false;
    base.rejectionReason = reason;
    return base;
  }

  private locationOr(ctx: IGameContext, preferred: LocationId, fallback: LocationId): LocationId {
    if (ctx.content.getLocation(preferred)) return preferred;
    return fallback;
  }

  /** Picks an existing location for the NPC's home region, falling back sensibly. */
  private pickRegional(
    ctx: IGameContext,
    npc: NPCState,
    willowbrook: readonly LocationId[],
    ashford: readonly LocationId[]
  ): LocationId {
    const homeRegion = regionOfLocation(npc.homeLocationId);
    const preferred = homeRegion === 'ashford' ? ashford : willowbrook;
    for (const candidate of preferred) {
      if (ctx.content.getLocation(candidate)) return candidate;
    }
    const fallback = homeRegion === 'ashford' ? willowbrook : ashford;
    for (const candidate of fallback) {
      if (ctx.content.getLocation(candidate)) return candidate;
    }
    return npc.homeLocationId;
  }

  private durationFor(npc: NPCState, definition: ActivityDefinition, time: GameTime): number {
    const variation = 0.85 + 0.3 * deterministicUnit(npc.id + ':' + definition.id + ':' + time.totalDays);
    let minutes = definition.baseDurationMinutes * variation;
    if (definition.id === 'sleep' && npc.needs.energy < 35) minutes *= 1.15;
    if (definition.id === 'work' && npc.needs.workPressure > 75) minutes *= 0.85;
    return Math.max(20, Math.round(minutes));
  }

  private fallbackCandidate(ctx: IGameContext, npc: NPCState, expectedGroup: ActivityGroup): DecisionCandidate {
    const rest = getActivityDefinition('rest');
    const definition = rest ?? getActivityDefinition('go_home');
    const baseDuration = definition?.baseDurationMinutes ?? 60;
    const group = definition?.group ?? 'care';
    return {
      id: definition?.id ?? 'rest',
      activity: definition?.id ?? 'rest',
      label: definition?.label ?? 'Resting',
      group,
      utility: 0.1,
      weight: 0.1,
      targetLocationId: npc.homeLocationId,
      targetNpcId: null,
      durationMinutes: baseDuration,
      scheduleBonus: expectedGroup === group ? 1.3 : 1,
      personalityWeight: 0.5,
      memoryInfluence: 1,
      needScore: 0.1,
      historyPenalty: 1,
      availability: 1,
      eligible: true,
      rejectionReason: null,
    };
  }

  private activeFestival(ctx: IGameContext, time: GameTime) {
    for (const festival of ctx.content.pack.festivals) {
      if (festival.season === time.season && festival.dayOfSeason === time.dayOfSeason) return festival;
    }
    return undefined;
  }

  private activeWorldEventLocation(ctx: IGameContext, time: GameTime): LocationId | null {
    const state = ctx.state;
    const active = new Set(state.eventSystem.activeEventIds);
    if (active.size === 0) return null;
    for (const event of state.world.events) {
      if (!active.has(event.id) || !event.locationId) continue;
      if (Math.abs(time.totalHours - event.occurredAt / 60) <= 4) return event.locationId;
    }
    return null;
  }

  /** First vacancy in the economy job list (deterministic order). */
  private vacantJob(ctx: IGameContext): JobState | undefined {
    const jobs = Object.values(ctx.state.economy.jobs).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const job of jobs) {
      if (job.employeeIds.length < job.slots) return job;
    }
    return undefined;
  }

  private jobLocation(ctx: IGameContext, job: JobState, npc: NPCState): LocationId {
    const business = ctx.state.economy.businesses[job.businessId];
    const def = ctx.content.getBusiness(job.businessId);
    const location = business?.locationId ?? def?.locationId;
    if (location && ctx.content.getLocation(location)) return location;
    return npc.homeLocationId;
  }
}
