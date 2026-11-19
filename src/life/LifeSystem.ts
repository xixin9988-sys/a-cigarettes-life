import type {
  ActionResult,
  ArchivedLife,
  CigaretteAppearance,
  CigaretteConditionState,
  EnvironmentState,
  IGameContext,
  ILifeSystem,
  IWorldSystem,
  LetterState,
  LifeArchiveEntry,
  LifeState,
  MicroclimateState,
  PlayerGoalState,
} from '../core/contracts';
import type { AchievementDef, PlayerGoalDef } from '../data/schema';
import type { GameState } from '../core/contracts';
import { WEATHER_DISPLAY_NAMES } from '../core/SharedTypes';
import { clamp01 } from '../core/utils';
import { addItemToInventory, countItem } from '../core/InventoryUtil';
import { ITEM } from '../data/items/ids';
import { AchievementSystem } from './AchievementSystem';
import { CigarettePhysicsSystem, type CigaretteSnapshot } from './CigarettePhysicsSystem';
import { GenerationSystem, type LegacyOption } from './GenerationSystem';
import { InfluenceSystem, type InfluenceSnapshot } from './InfluenceSystem';
import { LifeArchiveSystem } from './LifeArchiveSystem';
import { PlayerIdentitySystem } from './PlayerIdentitySystem';
import {
  SIM_SECONDS_PER_GAME_DAY,
  countItemOnPerson,
  evaluateTrigger,
  mutateLifeExtras,
  readLifeExtras,
  writeLifeExtras,
  type TriggerContext,
} from './lifeShared';

/**
 * LifeSystem - the player's life cycle: cigarette physics, ash collection, warmth, identity,
 * personal goals, achievements, letters, influence bookkeeping and the end-of-life trigger.
 *
 * Update contract: init(ctx) then update(dtSimSeconds). dtSimSeconds is simulated seconds
 * (1 sim second = 1 in-game minute, 1440 = one game day). The clock (ctx.clock) is the only
 * time source for timestamps - no wall-clock time and no Math.random(), so save replay is
 * deterministic. The system is DOM-free and worker-safe.
 *
 * Extra public methods beyond ILifeSystem (documented for the Lead's wiring):
 *  - setExertion(level: 0..1): e.g. 1 while sprinting / doing heavy farm work.
 *  - getMoveSpeedMultiplier(): movement speed factor the player controller must apply.
 *  - getInfluenceSnapshot(): influence tier/progress for the HUD.
 *  - getPersonalGoal()/getPersonalGoalDef(): chosen goal state for the life panel.
 *  - buildArchivedLife()/getLegacyOptions()/applyLegacyItems(): multi-generation API.
 *  - getCigaretteSnapshot(): read-only environment/condition snapshot for the HUD.
 *  - isTooSoakedForHeavyWork(): true when soaked (spec: cannot do heavy work).
 *  - getRemainingGameHours(): burn-rate aware estimate for the HUD.
 */
export const DAILY_LETTER_CHANCE = 0.12;
export const MIN_LETTER_AFFINITY = 25;
export const MAX_LETTERS = 80;
export const WARM_UP_COOLDOWN_SECONDS = 30;
export const WARM_HEAT_SOURCE_MOISTURE_REDUCTION = 0.22;
export const WARM_HAND_WARMER_MOISTURE_REDUCTION = 0.12;
export const WARM_DESICCANT_MOISTURE_REDUCTION = 0.16;
export const MAX_ASH_COLLECT_PER_ACTION = 100;

const LETTER_TEMPLATES: readonly { subject: string; body: string }[] = [
  {
    subject: 'Thinking of you by the window',
    body:
      'Dear {player},\n\nThe weather has turned {weather} and the whole lane smells of wet stone. I saw a cigarette ' +
      'walking past the bakery this morning and thought of you. Come by for tea when the day is yours.\n\nYours, {npc}',
  },
  {
    subject: 'A small invitation',
    body:
      'Dear {player},\n\nI have been saving something silly for you - a ribbon, a biscuit, a story not worth the ' +
      'telling. It is {season}, the evenings are long, and it would be easier to enjoy them with you.\n\n{npc}',
  },
  {
    subject: 'The garden is doing well',
    body:
      'Dear {player},\n\nYou would not believe how the garden has come on. Even the stubborn corner by the wall is ' +
      'green now. I keep meaning to ask you what you have been doing to the soil. You always did have a knack.\n\n{npc}',
  },
  {
    subject: 'Rain again',
    body:
      'Dear {player},\n\nIt is {weather} again and I have been worrying about you - soaked paper is no joke. Keep ' +
      'to the eaves, and if you find yourself nearby there is a chair by my fire that no one is using.\n\n{npc}',
  },
  {
    subject: 'A thank you',
    body:
      'Dear {player},\n\nI do not think I said it properly, so I am saying it in ink: thank you. Willowbrook is ' +
      'kinder than it was before you came, and I am not the only one who thinks so.\n\nWith warmth, {npc}',
  },
  {
    subject: 'Something I found',
    body:
      'Dear {player},\n\nI found an old photograph in the bottom of a drawer, and realised I have not made a ' +
      'single new memory worth keeping this month. Let us fix that, shall we? I am free all {season}.\n\n{npc}',
  },
];

function isAlive(state: GameState): boolean {
  return state.life.phase === 'alive';
}

function fail(message: string, code: ActionResult['code']): ActionResult {
  const result: ActionResult = { ok: false, message };
  if (code) result.code = code;
  return result;
}

function succeed(message: string, stateChanged = true): ActionResult {
  return { ok: true, message, stateChanged };
}

function normaliseWarmUpSource(source: string): string {
  return source.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export class LifeSystem implements ILifeSystem {
  readonly id = 'life';

  private ctx: IGameContext | null = null;
  private physics: CigarettePhysicsSystem | null = null;
  private influence: InfluenceSystem | null = null;
  private archive: LifeArchiveSystem | null = null;
  private achievements: AchievementSystem | null = null;
  private generation: GenerationSystem | null = null;
  private readonly identity = new PlayerIdentitySystem();
  private lastProcessedHour = -1;
  private lastSeenDay = -1;
  private lifeReviewCache: ArchivedLife | null = null;
  private initialized = false;

  // -------------------------------------------------------------------------
  // ISystem
  // -------------------------------------------------------------------------
  init(ctx: IGameContext): void {
    if (this.initialized) return;
    this.ctx = ctx;
    const state = ctx.state;
    if (state.life.phase === 'ending') state.life.phase = 'ended';
    if (state.player.lifeId !== state.life.lifeId) state.player.lifeId = state.life.lifeId;
    // Make sure the streams this module owns are registered in the probability engine.
    for (const streamId of ['player.cigarettePhysics', 'life.ash', 'life.archive', 'player.opportunities']) {
      if (!ctx.probability.hasStream(streamId)) ctx.probability.ensureStream(streamId);
    }

    this.influence = new InfluenceSystem({ state, bus: ctx.bus });
    this.archive = new LifeArchiveSystem(ctx);
    this.archive.init();
    this.achievements = new AchievementSystem({ ctx, influence: this.influence });
    this.achievements.init();
    this.generation = new GenerationSystem({
      state,
      content: ctx.content,
      clock: ctx.clock,
      bus: ctx.bus,
    });

    this.physics = new CigarettePhysicsSystem({
      state,
      content: ctx.content,
      bus: ctx.bus,
      clock: ctx.clock,
      getMicroclimate: (locationId) => this.sampleMicroclimate(locationId),
      getEnvironment: () => this.sampleEnvironment(),
    });

    this.lastProcessedHour = ctx.clock.time.totalHours;
    this.lastSeenDay = ctx.clock.time.totalDays;
    this.initialized = true;
  }

  update(dtSimSeconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.initialized) return;
    const state = ctx.state;
    if (!isAlive(state)) return;
    const physics = this.physics;
    if (!physics) return;
    const dt = Number.isFinite(dtSimSeconds) && dtSimSeconds > 0 ? dtSimSeconds : 0;

    // A loaded/edited state may already show a spent body: close the life immediately.
    if (state.player.cigarette.lengthRatio <= 0) {
      this.endLife('Your cigarette body burned down to the filter.');
      return;
    }

    // Age runs on the passed delta so offline catch-up ages the life correctly.
    state.life.ageDays += dt / SIM_SECONDS_PER_GAME_DAY;
    state.player.statistics.daysLived = Math.floor(state.life.ageDays + 1e-9);

    physics.update(dt);
    if (physics.consumeBurnedOutFlag()) {
      this.endLife('Your cigarette body burned down to the filter.');
      return;
    }
    state.player.lifeProgress = clamp01(1 - state.player.cigarette.lengthRatio);
    this.trackAshConsumption();
    this.tickPeriodicWork(dt);
  }

  /** Tears down bus subscriptions (save / hot-reload / test cleanup). */
  dispose(): void {
    this.archive?.dispose();
    this.achievements?.dispose();
    this.physics = null;
    this.ctx = null;
    this.initialized = false;
  }

  // -------------------------------------------------------------------------
  // ILifeSystem
  // -------------------------------------------------------------------------
  getCigaretteState(): CigaretteConditionState {
    return this.requireCtx().state.player.cigarette;
  }

  getLifeState(): LifeState {
    return this.requireCtx().state.life;
  }

  /** Converts accumulated ash into stackable ITEM.cigaretteAsh inventory items. */
  collectAsh(): ActionResult {
    const ctx = this.requireCtx();
    const state = ctx.state;
    if (!isAlive(state)) return fail('There is no ash left to collect from a spent cigarette.', 'not_allowed');
    const cigarette = state.player.cigarette;
    const whole = Math.floor(cigarette.ashAccumulated + 1e-9);
    if (whole <= 0) {
      return fail('Your ash tray is empty. Let a little more of your body burn first.', 'requirement_not_met');
    }
    const item = ctx.content.getItem(ITEM.cigaretteAsh);
    const maxStack = Math.max(1, item?.maxStack ?? 99);
    const quantity = Math.min(whole, MAX_ASH_COLLECT_PER_ACTION);
    const now = ctx.clock.simTimeSeconds;
    addItemToInventory(state.player.inventory, ITEM.cigaretteAsh, quantity, {
      simTime: now,
      quality: 1,
      maxStack,
    });
    cigarette.ashAccumulated = Math.max(0, cigarette.ashAccumulated - quantity);
    state.life.lastAshCollectedAt = now;
    state.player.statistics.ashCollected += quantity;
    mutateLifeExtras(state, (extras) => {
      extras.counters.ashOnHand = countItemOnPerson(state, ITEM.cigaretteAsh);
    });
    ctx.bus.emit('item:acquired', { itemId: ITEM.cigaretteAsh, quantity, quality: 1, source: 'cigarette' });
    ctx.bus.emit('game:signal', {
      name: 'cigarette:ash_collected',
      data: { quantity, remaining: cigarette.ashAccumulated },
    });
    return succeed('You flick ' + quantity + ' pinch' + (quantity === 1 ? '' : 'es') + ' of ash into your bag.');
  }

  /** Warms the paper by a heat source or a carried hand warmer / desiccant pack. */
  warmUp(source: string): ActionResult {
    const ctx = this.requireCtx();
    const state = ctx.state;
    if (!isAlive(state)) return fail('The warmth cannot reach a spent cigarette.', 'not_allowed');
    const cigarette = state.player.cigarette;
    if (cigarette.moisture <= 0.005) return fail('You are already perfectly dry.', 'requirement_not_met');
    const now = ctx.clock.simTimeSeconds;
    const extras = readLifeExtras(state);
    if (extras.warmUpReadyAt > now) return fail('Give the warmth a moment to build again.', 'on_cooldown');

    const normalised = normaliseWarmUpSource(source);
    const physics = this.physics;
    const microclimate = physics ? physics.getCurrentMicroclimate() : null;
    let reduction = 0;
    let message = '';
    const heatSourceKeys = ['heat_source', 'heatsource', 'fireplace', 'stove', 'campfire', 'heater', 'fire'];
    let itemId: string | null = null;
    if (ctx.content.getItem(source)) itemId = source;
    else if (normalised === 'hand_warmer' || normalised === 'handwarmer') itemId = ITEM.handWarmer;
    else if (normalised === 'desiccant_pack' || normalised === 'desiccant' || normalised === 'desiccantpack') {
      itemId = ITEM.desiccantPack;
    }

    if (heatSourceKeys.includes(normalised)) {
      if (!microclimate || !microclimate.heatSource) {
        return fail('There is no hearth or fire here to warm yourself by.', 'not_allowed');
      }
      reduction = WARM_HEAT_SOURCE_MOISTURE_REDUCTION;
      message = 'You hold your paper close to the warmth until the damp lifts out of it.';
    } else if (itemId) {
      if (countItemOnPerson(state, itemId) <= 0) {
        return fail('You are not carrying anything like that.', 'requirement_not_met');
      }
      if (itemId === ITEM.handWarmer) {
        reduction = WARM_HAND_WARMER_MOISTURE_REDUCTION;
        message = 'The clay warmer glows against your body and the damp slowly eases.';
      } else {
        reduction = WARM_DESICCANT_MOISTURE_REDUCTION;
        message = 'The desiccant pack drinks the moisture from the air around you.';
      }
    } else {
      return fail('That is not something you can warm yourself with.', 'invalid');
    }

    cigarette.moisture = clamp01(cigarette.moisture - reduction);
    extras.warmUpReadyAt = now + WARM_UP_COOLDOWN_SECONDS;
    writeLifeExtras(state, extras);
    ctx.bus.emit('game:signal', {
      name: 'cigarette:warmed',
      data: { source: itemId ?? normalised, moisture: cigarette.moisture },
    });
    return succeed(message);
  }

  customizeAppearance(appearance: CigaretteAppearance): ActionResult {
    const ctx = this.requireCtx();
    const state = ctx.state;
    if (!isAlive(state)) return fail('This life is over; appearance no longer matters.', 'not_allowed');
    const result = this.identity.customize(state, appearance);
    if (!result.ok) return result;
    ctx.bus.emit('game:signal', {
      name: 'player:appearance_changed',
      data: {
        bodyColor: state.player.appearance.bodyColor,
        filterColor: state.player.appearance.filterColor,
        face: state.player.appearance.face,
        pattern: state.player.appearance.pattern,
      },
    });
    return result;
  }

  /** Chooses the current personal goal from the PLAYER_GOALS content. */
  choosePersonalGoal(goalId: string): ActionResult {
    const ctx = this.requireCtx();
    const state = ctx.state;
    if (!isAlive(state)) return fail('You cannot choose a new direction from beyond the filter.', 'not_allowed');
    const def = ctx.content.getPlayerGoal(goalId);
    if (!def) return fail('No such personal goal exists.', 'not_found');
    const extras = readLifeExtras(state);
    if (extras.personalGoal && extras.personalGoal.completedAt === null) {
      return fail('You are already pursuing "' + extras.personalGoal.title + '". Finish it first.', 'not_allowed');
    }
    const context: TriggerContext = { state, content: ctx.content, counters: extras.counters };
    const current = evaluateTrigger(context, def.trigger);
    const goal: PlayerGoalState = {
      id: def.id,
      title: def.title,
      description: def.description,
      category: def.category,
      progress: Math.min(def.trigger.threshold, current),
      target: def.trigger.threshold,
      completedAt: null,
      chosenAt: ctx.clock.simTimeSeconds,
    };
    extras.personalGoal = goal;
    writeLifeExtras(state, extras);
    this.archive?.recordLifeEvent({
      category: 'choice',
      title: 'Chose a personal goal: ' + def.title,
      description: def.description,
      importance: 3,
    });
    ctx.bus.emit('game:signal', { name: 'life:goal_chosen', data: { goalId: def.id, title: def.title } });
    return succeed('You set your heart on: ' + def.title + '.');
  }

  getAvailableGoals(): PlayerGoalDef[] {
    return this.requireCtx().content.pack.playerGoals;
  }

  getArchive(): LifeArchiveEntry[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    return this.archive ? this.archive.getEntries() : [...ctx.state.life.archive];
  }

  getAchievements(): { def: AchievementDef; state: { id: string; unlockedAt: number } | null }[] {
    const ctx = this.requireCtx();
    if (this.achievements) return this.achievements.getAll();
    const unlocked = new Map<string, { id: string; unlockedAt: number }>();
    for (const achievement of ctx.state.life.achievements) unlocked.set(achievement.id, achievement);
    return ctx.content.pack.achievements.map((def) => {
      const achievementState = unlocked.get(def.id) ?? null;
      return { def, state: achievementState };
    });
  }

  getLifeReview(): ArchivedLife | null {
    const ctx = this.requireCtx();
    const state = ctx.state;
    if (state.life.phase === 'alive') return null;
    const cached = this.lifeReviewCache;
    if (cached && cached.lifeId === state.life.lifeId) return cached;
    const archived = state.archive.find((entry) => entry.lifeId === state.life.lifeId);
    if (archived) {
      this.lifeReviewCache = archived;
      return archived;
    }
    return this.generation ? this.generation.buildArchivedLife(state) : null;
  }

  readLetter(letterId: string): ActionResult {
    const ctx = this.requireCtx();
    const state = ctx.state;
    const letter = state.life.letters.find((candidate) => candidate.id === letterId);
    if (!letter) return fail('No such letter in your keepsake box.', 'not_found');
    if (letter.read) return succeed('You have already read that letter.', false);
    letter.read = true;
    const from = letter.fromNpcId
      ? ctx.content.getNPC(letter.fromNpcId)?.name ?? state.npcs[letter.fromNpcId]?.name ?? 'someone'
      : 'someone';
    ctx.bus.emit('game:signal', { name: 'letter:read', data: { letterId, from } });
    return succeed('You read the letter from ' + from + '.');
  }

  /** Ends the life; also invoked automatically when lengthRatio reaches 0. Idempotent. */
  endLife(reason: string): ActionResult {
    const ctx = this.requireCtx();
    const state = ctx.state;
    if (state.life.phase !== 'alive') return fail('This life has already ended.', 'not_allowed');
    const now = ctx.clock.simTimeSeconds;
    const endReason = reason.trim().length > 0 ? reason.trim() : 'Burned out';
    state.life.phase = 'ending';
    state.life.endReason = endReason;
    state.life.endedAt = now;
    state.player.lifeProgress = 1;
    this.archive?.recordLifeEvent({
      category: 'death',
      title: 'The last of the filter',
      description: endReason + ' ' + this.identity.getDisplayName(state) + ' burned for ' +
        Math.round(state.life.ageDays * 10) / 10 + ' days.',
      importance: 10,
    });
    const review = this.generation ? this.generation.buildArchivedLife(state) : null;
    state.life.phase = 'ended';
    if (review) {
      this.lifeReviewCache = review;
      const existingIndex = state.archive.findIndex((entry) => entry.lifeId === review.lifeId);
      if (existingIndex >= 0) state.archive[existingIndex] = review;
      else state.archive.push(review);
    }
    ctx.bus.emit('life:ended', {
      lifeId: state.life.lifeId,
      cause: endReason,
      ageDays: state.life.ageDays,
    });
    ctx.bus.emit('game:signal', {
      name: 'life:ended',
      data: { lifeId: state.life.lifeId, cause: endReason, ageDays: state.life.ageDays },
    });
    return succeed(endReason);
  }

  // -------------------------------------------------------------------------
  // Extra public API for the game / UI
  // -------------------------------------------------------------------------
  setExertion(level: number): void {
    this.physics?.setExertion(level);
  }

  getMoveSpeedMultiplier(): number {
    return this.physics ? this.physics.getMoveSpeedMultiplier() : 1;
  }

  getCigaretteSnapshot(): CigaretteSnapshot | null {
    return this.physics ? this.physics.getSnapshot() : null;
  }

  isTooSoakedForHeavyWork(): boolean {
    return this.physics ? this.physics.isTooSoakedForHeavyWork() : false;
  }

  getRemainingGameHours(): number {
    return this.physics ? this.physics.getRemainingGameHours() : 0;
  }

  getInfluenceSnapshot(): InfluenceSnapshot | null {
    return this.influence ? this.influence.getSnapshot() : null;
  }

  /** Adds influence from anywhere in the game (achievements, events, community work). */
  gainInfluence(amount: number, reason: string): number {
    return this.influence ? this.influence.gainInfluence(amount, reason) : 0;
  }

  getPersonalGoal(): PlayerGoalState | null {
    if (!this.ctx) return null;
    return readLifeExtras(this.ctx.state).personalGoal;
  }

  getPersonalGoalDef(): PlayerGoalDef | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const goal = readLifeExtras(ctx.state).personalGoal;
    if (!goal) return null;
    return ctx.content.getPlayerGoal(goal.id) ?? null;
  }

  /** Builds the review of the current (ended) life; null while still alive. */
  buildArchivedLife(state?: GameState): ArchivedLife | null {
    if (!this.generation) return null;
    const target = state ?? this.requireCtx().state;
    return this.generation.buildArchivedLife(target);
  }

  /** Up to 3 mementos from a past life that a new generation may inherit. */
  getLegacyOptions(archive: ArchivedLife, state?: GameState): LegacyOption[] {
    return this.generation ? this.generation.getLegacyOptions(archive, state) : [];
  }

  /** Applies chosen legacy items to a new life (max 3, meta.legacy = true). */
  applyLegacyItems(state: GameState, itemIds: string[]): void {
    this.generation?.applyLegacyItems(state, itemIds);
  }

  getIdentity(): PlayerIdentitySystem {
    return this.identity;
  }

  /** Archive helper (also lets the Game record custom life events). */
  getArchiveSystem(): LifeArchiveSystem | null {
    return this.archive;
  }

  getAchievementSystem(): AchievementSystem | null {
    return this.achievements;
  }

  getGenerationSystem(): GenerationSystem | null {
    return this.generation;
  }

  // -------------------------------------------------------------------------
  // Internal periodic work
  // -------------------------------------------------------------------------
  private tickPeriodicWork(dt: number): void {
    const ctx = this.requireCtx();
    const time = ctx.clock.time;
    if (time.totalHours !== this.lastProcessedHour || dt >= 60) {
      this.lastProcessedHour = time.totalHours;
      this.achievements?.checkAll();
      this.updatePersonalGoal();
    }
    if (time.totalDays !== this.lastSeenDay) {
      this.lastSeenDay = time.totalDays;
      this.updatePersonalGoal();
      this.maybeWriteDailyLetter(time.totalDays);
    }
  }

  /** Tracks ash consumed by other systems by comparing the carried ash count over time. */
  private trackAshConsumption(): void {
    const state = this.requireCtx().state;
    const carried = countItem(state.player.inventory, ITEM.cigaretteAsh);
    const extras = readLifeExtras(state);
    const previous = extras.counters.ashOnHand;
    if (carried < previous) {
      const used = previous - carried;
      mutateLifeExtras(state, (next) => {
        next.counters.ashUsed += used;
        next.counters.ashOnHand = carried;
      });
    } else if (carried > previous) {
      mutateLifeExtras(state, (next) => {
        next.counters.ashOnHand = carried;
      });
    }
  }

  private updatePersonalGoal(): void {
    const ctx = this.requireCtx();
    const state = ctx.state;
    const extras = readLifeExtras(state);
    const goal = extras.personalGoal;
    if (!goal || goal.completedAt !== null) return;
    const def = ctx.content.getPlayerGoal(goal.id);
    if (!def) return;
    const context: TriggerContext = { state, content: ctx.content, counters: extras.counters };
    const value = evaluateTrigger(context, def.trigger);
    goal.progress = Math.min(def.trigger.threshold, Math.max(0, value));
    const completed = value >= def.trigger.threshold;
    if (completed) goal.completedAt = ctx.clock.simTimeSeconds;
    writeLifeExtras(state, extras);
    if (completed) {
      this.influence?.gainInfluence(def.rewardInfluence, 'goal:' + def.id);
      ctx.bus.emit('goal:completed', { goalId: def.id, title: def.title });
    }
  }

  /** Occasionally a friend writes to the player (probability stream player.opportunities). */
  private maybeWriteDailyLetter(currentDay: number): void {
    const ctx = this.requireCtx();
    const state = ctx.state;
    const extras = readLifeExtras(state);
    if (currentDay <= extras.lastOpportunityDay) return;
    extras.lastOpportunityDay = currentDay;
    writeLifeExtras(state, extras);
    if (!ctx.rng.chance('player.opportunities', DAILY_LETTER_CHANCE)) return;

    const friends = Object.values(state.player.relationships)
      .filter((relationship) => relationship.affinity >= MIN_LETTER_AFFINITY && relationship.status !== 'enemy')
      .sort((a, b) => b.affinity - a.affinity)
      .slice(0, 5);
    if (friends.length === 0) return;
    const friendIndex = ctx.rng.intRange('player.opportunities', 0, friends.length - 1);
    const friend = friends[friendIndex];
    if (!friend) return;
    const npcName = ctx.content.getNPC(friend.otherId)?.name ?? state.npcs[friend.otherId]?.name ?? 'A friend';
    const templateIndex = ctx.rng.intRange('player.opportunities', 0, LETTER_TEMPLATES.length - 1);
    const template = LETTER_TEMPLATES[templateIndex] ?? LETTER_TEMPLATES[0];
    if (!template) return;
    const environment = this.physics ? this.physics.getCurrentEnvironment() : this.sampleEnvironment();
    const weather = (WEATHER_DISPLAY_NAMES[environment.weather] ?? 'strange').toLowerCase();
    const season = ctx.clock.time.season;
    const playerName = this.identity.getDisplayName(state);
    const body = template.body
      .split('{player}').join(playerName)
      .split('{npc}').join(npcName)
      .split('{weather}').join(weather)
      .split('{season}').join(season);
    if (state.life.letters.length >= MAX_LETTERS) return;
    const letter: LetterState = {
      id: 'letter_' + currentDay.toString(36) + '_' + (extras.lettersWritten + 1).toString(36),
      fromNpcId: friend.otherId,
      subject: template.subject,
      body,
      sentAt: ctx.clock.simTimeSeconds,
      read: false,
      attachments: [],
    };
    extras.lettersWritten += 1;
    writeLifeExtras(state, extras);
    ctx.bus.emit('letter:received', { letter });
  }

  // -------------------------------------------------------------------------
  // World providers with local fallbacks (world system is optional in headless tests)
  // -------------------------------------------------------------------------
  private sampleMicroclimate(locationId: string): MicroclimateState {
    const ctx = this.requireCtx();
    const world = ctx.registry.get<IWorldSystem>('world');
    if (world) return world.getMicroclimate(locationId);
    const location = ctx.state.world.locations[locationId];
    if (location) return location.microclimate;
    const indoor = ctx.state.player.position.indoor;
    return {
      indoor,
      shelter: indoor ? 1 : 0,
      windExposure: indoor ? 0 : 1,
      humidityModifier: 0,
      heatSource: false,
    };
  }

  private sampleEnvironment(): EnvironmentState {
    const ctx = this.requireCtx();
    const world = ctx.registry.get<IWorldSystem>('world');
    if (world) return world.getEnvironment();
    return ctx.state.world.environment;
  }

  private requireCtx(): IGameContext {
    if (!this.ctx) throw new Error('LifeSystem.init(ctx) must be called before use.');
    return this.ctx;
  }
}
