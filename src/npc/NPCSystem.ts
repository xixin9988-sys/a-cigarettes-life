// =============================================================================
// NPCSystem - orchestrates the autonomous life of every NPC (14 majors +
// 42 residents): needs, emotions, schedules, utility-AI decisions, movement,
// memories, NPC-NPC relationships, social simulation and life archive.
//
// System id: 'npc'. Constructor takes no arguments; init(ctx) is called after
// construction (see AGENT_TASKS system order: world -> npc -> economy ...).
//
// Performance contract: update() accepts huge offline dt (a single call can
// span many game days). Per-NPC catch-up is processed in hour buckets with a
// hard cap on decisions/chunks per call; any remaining time is aggregated.
// =============================================================================
import type {
  ActionResult,
  GameState,
  IGameContext,
  INPCSystem,
  NPCState,
  NPCScheduleEntryState,
  RelationshipState,
  WorldEvent,
} from '../core/contracts';
import type { GameTime, LocationId, NPCId, SocialInteractionKind } from '../core/SharedTypes';
import { GAME_MINUTES_PER_HOUR } from '../core/SharedTypes';
import { simSecondsToGameTime } from '../core/TimeUtil';
import { clamp } from '../core/utils';
import { applyRelationshipDelta, type RelationshipDelta } from '../core/RelationshipUtil';
import { INITIAL_COUPLES } from '../data/npcs/npcs';
import {
  ACTIVITIES,
  NPC_MODULE,
  SIM_SECONDS_PER_GAME_HOUR,
  SIM_SECONDS_PER_GAME_MINUTE,
  activityGroupOf,
  getActivityDefinition,
  npcRecordId,
  readNpcExtras,
  writeNpcExtras,
  type NpcDecisionDebug,
} from './NPC';
import { NeedSystem } from './NeedSystem';
import { PersonalitySystem, normalisePersonality } from './PersonalitySystem';
import { MemorySystem } from './MemorySystem';
import { ScheduleSystem } from './ScheduleSystem';
import { RelationshipSystem } from './RelationshipSystem';
import { NPCArchive } from './NPCArchive';
import { SocialSimulation } from './SocialSimulation';
import { NPCDecisionEngine, type DecisionOutcome } from './NPCDecisionEngine';

interface GoalKeywordRule {
  keywords: readonly string[];
  groups: readonly string[];
  activities?: readonly string[];
  /** Progress earned per game hour of matching activity. */
  progressPerHour: number;
}

const GOAL_RULES: readonly GoalKeywordRule[] = [
  { keywords: ['farm', 'garden', 'harvest', 'plant', 'crop', 'greenhouse'], groups: ['explore'], activities: ['garden'], progressPerHour: 0.05 },
  { keywords: ['fish', 'river', 'lake', 'catch'], groups: ['explore'], activities: ['fish'], progressPerHour: 0.06 },
  { keywords: ['book', 'read', 'story', 'history', 'library', 'write', 'poem'], groups: ['leisure'], progressPerHour: 0.045 },
  { keywords: ['art', 'music', 'paint', 'sing', 'dance', 'craft', 'make'], groups: ['leisure'], progressPerHour: 0.04 },
  { keywords: ['friend', 'community', 'neighbour', 'neighbor', 'village', 'town', 'party', 'social'], groups: ['social'], progressPerHour: 0.04 },
  { keywords: ['work', 'career', 'business', 'shop', 'prosper', 'earn'], groups: ['work', 'errand'], progressPerHour: 0.035 },
  { keywords: ['city', 'travel', 'adventure', 'world', 'explore'], groups: ['travel'], progressPerHour: 0.05 },
  { keywords: ['family', 'home', 'cosy', 'cozy', 'settle'], groups: ['home', 'care'], progressPerHour: 0.04 },
  { keywords: ['bake', 'cook', 'food', 'recipe', 'feast'], groups: ['food'], activities: ['go_cafe'], progressPerHour: 0.045 },
  { keywords: ['flower', 'plant', 'bloom', 'rose'], groups: ['explore'], activities: ['garden'], progressPerHour: 0.05 },
];

export class NPCSystem implements INPCSystem {
  readonly id = 'npc';

  readonly needSystem = new NeedSystem();
  readonly personalitySystem = new PersonalitySystem();
  readonly memorySystem = new MemorySystem();
  readonly scheduleSystem: ScheduleSystem;
  readonly relationshipSystem = new RelationshipSystem();
  readonly archive: NPCArchive;
  readonly socialSimulation: SocialSimulation;
  readonly decisionEngine: NPCDecisionEngine;

  private ctx: IGameContext | null = null;
  private eventUnsubscribe: (() => void) | null = null;
  private lastDecisions = new Map<NPCId, NpcDecisionDebug>();
  private lastUpdateAt = -1;
  private lastMemoryPassAt = -1;
  private decisionCounter = 0;
  private interactionCounter = 0;
  private initialised = false;

  constructor() {
    this.scheduleSystem = new ScheduleSystem(this.personalitySystem);
    this.archive = new NPCArchive(this.memorySystem);
    this.socialSimulation = new SocialSimulation({
      personality: this.personalitySystem,
      relationships: this.relationshipSystem,
      memory: this.memorySystem,
      archive: this.archive,
      needs: this.needSystem,
    });
    this.decisionEngine = new NPCDecisionEngine({
      personality: this.personalitySystem,
      needs: this.needSystem,
      schedule: this.scheduleSystem,
      memory: this.memorySystem,
      relationships: this.relationshipSystem,
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  init(ctx: IGameContext): void {
    this.ctx = ctx;
    if (this.eventUnsubscribe) {
      this.eventUnsubscribe();
      this.eventUnsubscribe = null;
    }
    // World events involving NPCs feed back into their needs, emotions and
    // memories (the event system owns the event log itself).
    this.eventUnsubscribe = ctx.bus.on('event:occurred', (payload) => {
      this.onWorldEvent(ctx, payload.event);
    });
    ctx.probability.ensureStream('npc.behavior');
    ctx.probability.ensureStream('npc.social');
    ctx.probability.ensureStream('npc.schedule');
    ctx.probability.ensureStream('npc.memory');
    const now = ctx.clock.simTimeSeconds;
    const time = ctx.clock.time;
    this.lastUpdateAt = now;
    this.lastMemoryPassAt = now;
    this.decisionCounter = 0;
    this.interactionCounter = 0;
    this.lastDecisions.clear();
    if (!Number.isFinite(ctx.state.social.lastNpcSocialAt) || ctx.state.social.lastNpcSocialAt <= 0) {
      ctx.state.social.lastNpcSocialAt = now;
    } else if (ctx.state.social.lastNpcSocialAt > now) {
      ctx.state.social.lastNpcSocialAt = now;
    }
    const npcs = this.sortedNpcs(ctx.state);
    for (const npc of npcs) {
      this.normaliseNpc(npc, now);
      this.ensureInitialRelationships(ctx, npc, now);
      this.assignJob(ctx, npc);
    }
    this.seedInitialCouples(ctx, npcs, now);
    for (const npc of npcs) {
      this.prepareStartingRoutine(ctx, npc, time, now);
    }
    this.initialised = true;
  }

  /** Main tick. Uses absolute clock time so it is safe for tiny and huge dt. */
  update(_dtSimSeconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.clock.simTimeSeconds;
    if (!Number.isFinite(now)) return;
    if (this.lastUpdateAt < 0 || now < this.lastUpdateAt - 1) {
      // Clock rewound (loaded save / rewind): treat the new time as the baseline.
      this.lastUpdateAt = now;
      this.lastMemoryPassAt = now;
      for (const npc of this.sortedNpcs(ctx.state)) {
        if (npc.lastUpdatedAt > now) npc.lastUpdatedAt = now;
        npc.decisionCooldownUntil = Math.min(npc.decisionCooldownUntil, now);
      }
      return;
    }
    const time = ctx.clock.time;
    const npcs = this.sortedNpcs(ctx.state);
    const population = this.buildLocationPopulation(ctx.state);
    for (const npc of npcs) {
      this.scheduleSystem.ensureDailyPlan(ctx, npc, time);
    }
    for (const npc of npcs) {
      this.advanceNpc(ctx, npc, now, population);
    }
    this.updateMemoryPass(ctx, npcs, now);
    this.updateRelationships(ctx, npcs, now);
    const social = this.socialSimulation.update(ctx);
    this.interactionCounter += social.interactions;
    this.lastUpdateAt = now;
  }

  // ---------------------------------------------------------------------------
  // INPCSystem interface
  // ---------------------------------------------------------------------------
  getNPC(id: NPCId): NPCState | undefined {
    return this.ctx?.state.npcs[id];
  }

  getAllNPCs(): NPCState[] {
    if (!this.ctx) return [];
    return this.sortedNpcs(this.ctx.state);
  }

  getMajorNPCs(): NPCState[] {
    return this.getAllNPCs().filter((npc) => npc.isMajor);
  }

  getNPCsAt(locationId: LocationId): NPCState[] {
    return this.getAllNPCs().filter((npc) => npc.alive && npc.locationId === locationId);
  }

  getNearbyNPCs(): NPCState[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    return this.getNPCsAt(ctx.state.player.position.locationId);
  }

  setNPCActivity(npcId: NPCId, activity: string, locationId: LocationId): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return { ok: false, code: 'not_implemented', message: 'NPC system is not initialised yet.' };
    const npc = ctx.state.npcs[npcId];
    if (!npc) return { ok: false, code: 'not_found', message: 'Unknown NPC: ' + npcId };
    if (typeof activity !== 'string' || activity.trim().length === 0) {
      return { ok: false, code: 'invalid', message: 'Activity must be a non-empty string.' };
    }
    if (!ctx.content.getLocation(locationId)) {
      return { ok: false, code: 'not_found', message: 'Unknown location: ' + locationId };
    }
    const now = ctx.clock.simTimeSeconds;
    const previousActivity = npc.currentActivity;
    const previousLocation = npc.locationId;
    const definition = getActivityDefinition(activity);
    const durationMinutes = definition?.baseDurationMinutes ?? 60;
    npc.currentActivity = activity;
    npc.locationId = locationId;
    npc.activityStartedAt = now;
    npc.activityEndsAt = now + this.minutesToSimSeconds(durationMinutes);
    npc.activityTargetNpcId = null;
    npc.activityTargetLocationId = locationId;
    npc.decisionCooldownUntil = now + this.minutesToSimSeconds(this.cooldownMinutes(npc));
    npc.lastUpdatedAt = Math.max(npc.lastUpdatedAt, now - 1);
    this.pushActivityHistory(npc, activity);
    this.emitActivityIfChanged(ctx, npc, previousActivity, previousLocation);
    return {
      ok: true,
      message: npc.name + ' is now ' + activity + ' at ' + locationId + '.',
      stateChanged: true,
    };
  }

  getLastDecision(npcId: NPCId): { activity: string; candidates: { id: string; weight: number }[] } | null {
    const debug = this.lastDecisions.get(npcId);
    if (!debug) return null;
    return { activity: debug.activity, candidates: debug.candidates.map((candidate) => ({ ...candidate })) };
  }

  // ---------------------------------------------------------------------------
  // Extra public API (beyond INPCSystem) for Lead integration / social agent /
  // UI debug. Documented in the module report.
  // ---------------------------------------------------------------------------
  /** Number of behaviour decisions taken since init (offline stats/debug). */
  getDecisionCount(): number {
    return this.decisionCounter;
  }

  /** Number of NPC-NPC social interactions simulated since init. */
  getInteractionCount(): number {
    return this.interactionCounter;
  }

  isInitialised(): boolean {
    return this.initialised && this.ctx !== null;
  }

  /** Planned schedule for today (empty before init). */
  getSchedulePlan(npcId: NPCId): NPCScheduleEntryState[] {
    const npc = this.getNPC(npcId);
    return npc ? npc.schedule.entries.map((entry) => ({ ...entry })) : [];
  }

  /** What the schedule says the NPC should be doing at the current clock hour. */
  getExpectedActivity(npcId: NPCId): string | null {
    const ctx = this.ctx;
    const npc = this.getNPC(npcId);
    if (!ctx || !npc) return null;
    const time = ctx.clock.time;
    return this.scheduleSystem.getExpectedActivity(npc, time.hour + time.minute / 60);
  }

  /** Forces a fresh utility decision (debug/event reactions). */
  forceDecision(npcId: NPCId): DecisionOutcome | null {
    const ctx = this.ctx;
    const npc = this.getNPC(npcId);
    if (!ctx || !npc) return null;
    const outcome = this.decisionEngine.decide(ctx, npc);
    this.applyDecision(ctx, npc, outcome, ctx.clock.simTimeSeconds);
    return outcome;
  }

  /**
   * Keeps an NPC's memory of the player consistent when the social/dialogue
   * systems change the player-side relationship. Also mirrors the values.
   */
  notePlayerInteraction(npcId: NPCId, delta: RelationshipDelta, kind: SocialInteractionKind = 'chat'): ActionResult {
    const ctx = this.ctx;
    const npc = this.getNPC(npcId);
    if (!ctx || !npc) return { ok: false, code: 'not_found', message: 'Unknown NPC or system not initialised.' };
    const now = ctx.clock.simTimeSeconds;
    const rel = this.relationshipSystem.ensure(npc, ctx.state.player.id, now);
    const beforeStatus = rel.status;
    applyRelationshipDelta(rel, delta, now);
    const affinityDelta = delta.affinity ?? 0;
    const text =
      ctx.state.player.name + ' and ' + npc.name + ' spent time together (' + kind.replaceAll('_', ' ') + ').';
    this.memorySystem.addMemory(
      npc,
      {
        type: 'player:' + kind,
        text,
        participantIds: [ctx.state.player.id],
        importance: clamp(8 + Math.abs(affinityDelta) * 2, 8, 60),
        emotionalValue: affinityDelta >= 0 ? 4 : -4,
      },
      now
    );
    if (beforeStatus !== rel.status || Math.abs(affinityDelta) >= 1) {
      ctx.bus.emit('relationship:changed', {
        npcId: npc.id,
        kind,
        affinity: rel.affinity,
        trust: rel.trust,
        intimacy: rel.intimacy,
        status: rel.status,
      });
    }
    return { ok: true, message: 'Updated ' + npc.name + "'s memory of the player.", stateChanged: true };
  }

  // ---------------------------------------------------------------------------
  // Initialisation helpers
  // ---------------------------------------------------------------------------
  private sortedNpcs(state: GameState): NPCState[] {
    return Object.values(state.npcs).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private normaliseNpc(npc: NPCState, now: number): void {
    npc.personality = normalisePersonality(npc.personality);
    for (const need of Object.keys(npc.needs) as (keyof NPCState['needs'])[]) {
      npc.needs[need] = clamp(Number.isFinite(npc.needs[need]) ? npc.needs[need] : 0, 0, 100);
    }
    for (const emotion of Object.keys(npc.emotions) as (keyof NPCState['emotions'])[]) {
      npc.emotions[emotion] = clamp(Number.isFinite(npc.emotions[emotion]) ? npc.emotions[emotion] : 0, 0, 1);
    }
    npc.mood = clamp(Number.isFinite(npc.mood) ? npc.mood : 0, -1, 1);
    npc.activityHistory = npc.activityHistory.filter((entry) => typeof entry === 'string').slice(-NPC_MODULE.maxActivityHistory);
    delete npc.relationships[npc.id];
    for (const rel of Object.values(npc.relationships)) {
      if (!rel || typeof rel.otherId !== 'string' || rel.otherId === npc.id) continue;
      rel.affinity = clamp(rel.affinity, -100, 100);
      rel.trust = clamp(rel.trust, 0, 100);
      rel.intimacy = clamp(rel.intimacy, 0, 100);
      rel.familiarity = clamp(rel.familiarity, 0, 100);
    }
    if (!Array.isArray(npc.memories)) npc.memories = [];
    if (!Array.isArray(npc.goals)) npc.goals = [];
    if (!Array.isArray(npc.lifeHistory)) npc.lifeHistory = [];
    if (!Array.isArray(npc.schedule.entries)) npc.schedule.entries = [];
    if (!Number.isFinite(npc.lastUpdatedAt) || npc.lastUpdatedAt <= 0) npc.lastUpdatedAt = now;
    if (!Number.isFinite(npc.decisionCooldownUntil)) npc.decisionCooldownUntil = now;
    if (!Number.isFinite(npc.activityStartedAt)) npc.activityStartedAt = now;
    if (!Number.isFinite(npc.activityEndsAt)) npc.activityEndsAt = now;
    const extras = readNpcExtras(npc);
    writeNpcExtras(npc, extras);
    const debug = extras.lastDecision;
    if (debug) this.lastDecisions.set(npc.id, debug);
  }

  /** Ensures authored initial relationships exist even for states created without seeds. */
  private ensureInitialRelationships(ctx: IGameContext, npc: NPCState, now: number): void {
    const definition = ctx.content.getNPC(npc.id);
    if (!definition) return;
    for (const seed of definition.initialRelationships) {
      const other = ctx.state.npcs[seed.npcId];
      if (!other || seed.npcId === npc.id) continue;
      if (!npc.relationships[seed.npcId]) {
        const created = this.relationshipSystem.ensure(npc, seed.npcId, now);
        created.affinity = clamp(seed.affinity, -100, 100);
        created.trust = clamp(seed.trust, 0, 100);
        created.intimacy = clamp(seed.intimacy, 0, 100);
        created.familiarity = clamp(Math.max(10, Math.abs(seed.affinity) + seed.trust * 0.5), 0, 100);
        applySeedStatus(created, seed.status);
      }
      if (!other.relationships[npc.id]) {
        const created = this.relationshipSystem.ensure(other, npc.id, now);
        created.affinity = clamp(seed.affinity, -100, 100);
        created.trust = clamp(seed.trust, 0, 100);
        created.intimacy = clamp(seed.intimacy, 0, 100);
        created.familiarity = clamp(Math.max(10, Math.abs(seed.affinity) + seed.trust * 0.5), 0, 100);
        applySeedStatus(created, seed.status);
      }
      // Pre-existing relationships must not be re-announced as new milestones.
      applySeedMilestoneFlags(npc.relationships[seed.npcId], seed.status);
      applySeedMilestoneFlags(other.relationships[npc.id], seed.status);
    }
  }

  /**
   * Applies the couples declared in the NPC data. InitialRelationshipSeed has
   * no 'dating' status in the contract, so couples are seeded here exactly once
   * (tracked per NPC in extras.seededRomance so a later breakup is respected).
   */
  private seedInitialCouples(ctx: IGameContext, npcs: NPCState[], now: number): void {
    const byId = new Map(npcs.map((npc) => [npc.id, npc]));
    for (const couple of INITIAL_COUPLES) {
      const a = byId.get(couple.a);
      const b = byId.get(couple.b);
      if (!a || !b || a.id === b.id) continue;
      const extrasA = readNpcExtras(a);
      const extrasB = readNpcExtras(b);
      const seededA = extrasA.seededRomance ?? [];
      const seededB = extrasB.seededRomance ?? [];
      if (seededA.includes(b.id) && seededB.includes(a.id)) continue;
      this.relationshipSystem.setStatus(a, b, 'dating', now);
      this.relationshipSystem.markFlag(a, b, 'npc_friend_archived', now);
      this.relationshipSystem.markFlag(a, b, 'npc_romance_archived', now);
      const relA = this.relationshipSystem.ensure(a, b.id, now);
      const relB = this.relationshipSystem.ensure(b, a.id, now);
      relA.affinity = Math.max(relA.affinity, 62);
      relA.trust = Math.max(relA.trust, 55);
      relA.intimacy = Math.max(relA.intimacy, 50);
      relA.familiarity = Math.max(relA.familiarity, 80);
      relB.affinity = Math.max(relB.affinity, 60);
      relB.trust = Math.max(relB.trust, 54);
      relB.intimacy = Math.max(relB.intimacy, 48);
      relB.familiarity = Math.max(relB.familiarity, 78);
      extrasA.seededRomance = [...seededA, b.id];
      extrasB.seededRomance = [...seededB, a.id];
      writeNpcExtras(a, extrasA);
      writeNpcExtras(b, extrasB);
      a.lifeHistory.push({ at: now, type: 'romance', description: couple.description, importance: 7 });
      b.lifeHistory.push({ at: now, type: 'romance', description: couple.description, importance: 7 });
    }
  }

  /**
   * Reads the economy job list (read-only) and links each NPC to the job whose
   * business sits at their workplace and whose title matches their occupation.
   * economy.jobs[].employeeIds remains owned by EconomySystem.
   */
  private assignJob(ctx: IGameContext, npc: NPCState): void {
    const jobs = Object.values(ctx.state.economy.jobs).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (npc.jobId !== null && ctx.state.economy.jobs[npc.jobId]) return;
    if (jobs.length === 0) return;
    const assignments = new Map<string, number>();
    for (const other of Object.values(ctx.state.npcs)) {
      if (other.jobId) assignments.set(other.jobId, (assignments.get(other.jobId) ?? 0) + 1);
    }
    const occupationWords = this.significantWords(npc.occupation ?? '');
    let best: { jobId: string; score: number } | null = null;
    for (const job of jobs) {
      const business = ctx.state.economy.businesses[job.businessId];
      const businessDef = ctx.content.getBusiness(job.businessId);
      const locationId = business?.locationId ?? businessDef?.locationId;
      if (locationId !== npc.workLocationId) continue;
      const used = assignments.get(job.id) ?? 0;
      if (used >= Math.max(1, job.slots)) continue;
      const titleWords = this.significantWords(job.title);
      let score = 0;
      for (const word of occupationWords) if (titleWords.includes(word)) score += 2;
      // Prefer higher wages slightly when several jobs fit.
      score += Math.min(1, job.wagePerHour / 2000);
      if (!best || score > best.score) best = { jobId: job.id, score };
    }
    if (best && best.score >= 2) {
      npc.jobId = best.jobId;
    } else if (best) {
      // Location fits but the title does not: still better than no link at all
      // for an employed NPC working at that place.
      if ((npc.occupation ?? '').length > 0) npc.jobId = best.jobId;
    }
  }

  private significantWords(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => word.length >= 3);
  }

  /** Places NPCs into their scheduled activity at init so the world looks alive. */
  /** Applies the emotional/memory echo of a world event to its NPC participants. */
  private onWorldEvent(ctx: IGameContext, event: WorldEvent): void {
    const negative = event.category === 'unlucky';
    for (const participantId of event.participants) {
      const npc = ctx.state.npcs[participantId];
      if (!npc || !npc.alive) continue;
      this.needSystem.applyExternalDelta(
        npc,
        negative ? { fun: -4, safety: -3, social: -2 } : { fun: 4, social: 3, belonging: 2 }
      );
      const importance = clamp(Math.round(event.importance * 10), 5, 100);
      this.memorySystem.addMemory(
        npc,
        {
          type: 'event:' + event.type,
          text: event.title + ': ' + event.description,
          participantIds: event.participants.filter((id) => id !== npc.id),
          importance,
          emotionalValue: negative ? -5 : 3,
        },
        event.occurredAt
      );
      this.needSystem.updateEmotions(npc, 0.5);
    }
  }

  private prepareStartingRoutine(ctx: IGameContext, npc: NPCState, time: GameTime, now: number): void {
    this.scheduleSystem.ensureDailyPlan(ctx, npc, time);
    const hour = time.hour + time.minute / 60;
    const entry = this.scheduleSystem.getExpectedEntry(npc, hour);
    const activity = entry?.activity ?? 'relax';
    const locationId = entry?.locationId ?? npc.homeLocationId;
    const minutes = this.minutesUntilEntryEnd(entry, hour);
    npc.currentActivity = activity;
    npc.locationId = ctx.content.getLocation(locationId) ? locationId : npc.homeLocationId;
    npc.activityTargetLocationId = npc.locationId;
    npc.activityTargetNpcId = null;
    npc.activityStartedAt = now;
    npc.activityEndsAt = now + this.minutesToSimSeconds(Math.max(15, Math.min(minutes, 180)));
    npc.decisionCooldownUntil = now + this.minutesToSimSeconds(this.cooldownMinutes(npc));
    npc.lastUpdatedAt = now;
  }

  private minutesUntilEntryEnd(entry: NPCScheduleEntryState | undefined, hour: number): number {
    if (!entry) return 60;
    let end = entry.endHour;
    if (end <= entry.startHour) end += 24;
    let current = hour;
    if (current < entry.startHour) current += 24;
    return Math.max(15, Math.round((end - current) * GAME_MINUTES_PER_HOUR));
  }

  // ---------------------------------------------------------------------------
  // Catch-up simulation
  // ---------------------------------------------------------------------------
  private buildLocationPopulation(state: GameState): Map<LocationId, number> {
    const population = new Map<LocationId, number>();
    for (const npc of Object.values(state.npcs)) {
      if (!npc.alive) continue;
      population.set(npc.locationId, (population.get(npc.locationId) ?? 0) + 1);
    }
    return population;
  }

  private advanceNpc(
    ctx: IGameContext,
    npc: NPCState,
    now: number,
    population: Map<LocationId, number>
  ): void {
    if (!npc.alive) return;
    let cursor = npc.lastUpdatedAt;
    if (!Number.isFinite(cursor) || cursor > now) cursor = now;
    let remainingHours = (now - cursor) / SIM_SECONDS_PER_GAME_HOUR;
    if (remainingHours <= 1e-6) {
      npc.lastUpdatedAt = now;
      return;
    }
    let decisionsLeft = NPC_MODULE.maxDecisionsPerNpcUpdate;
    let chunks = 0;
    while (remainingHours > 1e-6 && chunks < NPC_MODULE.maxChunksPerNpcUpdate) {
      const stepHours = Math.min(remainingHours, 1);
      const stepSeconds = stepHours * SIM_SECONDS_PER_GAME_HOUR;
      const stepEnd = cursor + stepSeconds;
      this.simulateNpcStep(ctx, npc, stepEnd, stepHours, population);
      if (decisionsLeft > 0 && this.needsDecision(npc, stepEnd)) {
        const outcome = this.decisionEngine.decide(ctx, npc);
        this.applyDecision(ctx, npc, outcome, stepEnd);
        decisionsLeft -= 1;
      }
      cursor = stepEnd;
      remainingHours -= stepHours;
      chunks += 1;
    }
    if (remainingHours > 1e-6) {
      this.aggregateRemainingTime(ctx, npc, now, remainingHours, population);
    }
    npc.lastUpdatedAt = now;
  }

  private simulateNpcStep(
    ctx: IGameContext,
    npc: NPCState,
    stepEnd: number,
    stepHours: number,
    population: Map<LocationId, number>
  ): void {
    const time = simSecondsToGameTime(stepEnd);
    this.scheduleSystem.ensureDailyPlan(ctx, npc, time);
    const company = (population.get(npc.locationId) ?? 1) - 1 > 0;
    this.needSystem.applyHourlyDecay(npc, stepHours, { hasCompany: company });
    this.needSystem.updateEmotions(npc, stepHours);
    if (npc.activityEndsAt <= stepEnd + 1e-6) {
      const actualMinutes = Math.max(
        1,
        (Math.min(stepEnd, npc.activityEndsAt) - npc.activityStartedAt) / SIM_SECONDS_PER_GAME_MINUTE
      );
      this.needSystem.applyActivityCompletion(npc, npc.currentActivity, actualMinutes);
      this.advanceGoals(ctx, npc, npc.currentActivity, actualMinutes / 60);
      this.maybeArchiveFestivalAttendance(ctx, npc, stepEnd);
      npc.activityEndsAt = stepEnd;
    }
  }

  /** Attending a festival leaves a life-archive entry (and a memory). */
  private maybeArchiveFestivalAttendance(ctx: IGameContext, npc: NPCState, atSimTime: number): void {
    if (npc.currentActivity !== 'attend_event') return;
    const time = simSecondsToGameTime(atSimTime);
    for (const festival of ctx.content.pack.festivals) {
      if (festival.season !== time.season || festival.dayOfSeason !== time.dayOfSeason) continue;
      if (!ctx.probability.chance('npc.memory', 0.6)) return;
      this.archive.festival(ctx, npc, festival.name, festival.locationId);
      return;
    }
  }

  /** Aggregates leftover catch-up time after the chunk/decision budget is spent. */
  private aggregateRemainingTime(
    ctx: IGameContext,
    npc: NPCState,
    now: number,
    remainingHours: number,
    population: Map<LocationId, number>
  ): void {
    const time = simSecondsToGameTime(now);
    this.scheduleSystem.ensureDailyPlan(ctx, npc, time);
    const hour = time.hour + time.minute / 60;
    const expectedActivity = this.scheduleSystem.getExpectedActivity(npc, hour);
    const expectedLocation = this.scheduleSystem.getExpectedLocation(npc, hour);
    // Snap the NPC into the schedule expected now so the saved state is coherent.
    npc.currentActivity = expectedActivity;
    if (ctx.content.getLocation(expectedLocation)) npc.locationId = expectedLocation;
    npc.activityTargetLocationId = npc.locationId;
    npc.activityTargetNpcId = null;
    npc.activityStartedAt = now - this.minutesToSimSeconds(30);
    npc.activityEndsAt = now + this.minutesToSimSeconds(45);
    this.pushActivityHistory(npc, expectedActivity);
    const company = (population.get(npc.locationId) ?? 1) - 1 > 0;
    this.needSystem.applyHourlyDecay(npc, remainingHours, { hasCompany: company });
    this.needSystem.updateEmotions(npc, Math.min(remainingHours, 8));
    this.needSystem.recomputeMood(npc);
  }

  /** Should the NPC make a fresh behaviour decision at this point in time? */
  private needsDecision(npc: NPCState, atTime: number): boolean {
    const activityEnded = npc.activityEndsAt <= atTime + 1e-6;
    if (activityEnded) return true;
    if (atTime < npc.decisionCooldownUntil) return false;
    const ctx = this.ctx;
    if (!ctx) return false;
    const time = simSecondsToGameTime(atTime);
    const hour = time.hour + time.minute / 60;
    const expectedGroup = activityGroupOf(this.scheduleSystem.getExpectedActivity(npc, hour));
    const currentGroup = activityGroupOf(npc.currentActivity);
    if (expectedGroup !== 'idle' && expectedGroup !== currentGroup) return true;
    const urgent = this.needSystem.mostUrgentNeed(npc);
    return urgent.urgency >= 0.78;
  }

  private applyDecision(ctx: IGameContext, npc: NPCState, outcome: DecisionOutcome, atTime: number): void {
    const now = atTime;
    const previousActivity = npc.currentActivity;
    const previousLocation = npc.locationId;
    const targetLocation = ctx.content.getLocation(outcome.targetLocationId)
      ? outcome.targetLocationId
      : npc.locationId;
    const targetNpc = outcome.targetNpcId ? ctx.state.npcs[outcome.targetNpcId] : undefined;
    npc.currentActivity = outcome.activity;
    npc.locationId = targetLocation;
    npc.activityTargetLocationId = targetLocation;
    npc.activityTargetNpcId = targetNpc ? targetNpc.id : null;
    npc.activityStartedAt = now;
    npc.activityEndsAt = now + this.minutesToSimSeconds(Math.max(20, outcome.durationMinutes));
    npc.decisionCooldownUntil = now + this.minutesToSimSeconds(this.cooldownMinutes(npc));
    npc.lastUpdatedAt = now;
    this.pushActivityHistory(npc, outcome.activity);
    const debug: NpcDecisionDebug = {
      activity: outcome.activity,
      at: now,
      candidates: outcome.candidates.map((candidate) => ({
        id: candidate.activity,
        weight: Math.round(candidate.utility * 1000) / 1000,
      })),
    };
    this.lastDecisions.set(npc.id, debug);
    const extras = readNpcExtras(npc);
    extras.lastDecision = debug;
    writeNpcExtras(npc, extras);
    this.decisionCounter += 1;
    this.emitActivityIfChanged(ctx, npc, previousActivity, previousLocation);
  }

  private pushActivityHistory(npc: NPCState, activity: string): void {
    const history = npc.activityHistory;
    if (history[history.length - 1] !== activity) history.push(activity);
    if (history.length > NPC_MODULE.maxActivityHistory) {
      history.splice(0, history.length - NPC_MODULE.maxActivityHistory);
    }
  }

  private emitActivityIfChanged(
    ctx: IGameContext,
    npc: NPCState,
    previousActivity: string,
    previousLocation: LocationId
  ): void {
    if (previousActivity === npc.currentActivity && previousLocation === npc.locationId) return;
    ctx.bus.emit('npc:activity', {
      npcId: npc.id,
      activity: npc.currentActivity,
      locationId: npc.locationId,
    });
  }

  private updateMemoryPass(ctx: IGameContext, npcs: NPCState[], now: number): void {
    if (this.lastMemoryPassAt >= 0 && now - this.lastMemoryPassAt < SIM_SECONDS_PER_GAME_HOUR) return;
    for (const npc of npcs) this.memorySystem.update(npc, now);
    this.lastMemoryPassAt = now;
  }

  private updateRelationships(ctx: IGameContext, npcs: NPCState[], now: number): void {
    for (const npc of npcs) {
      this.relationshipSystem.syncPlayerMirror(ctx.state, npc, now);
    }
    for (const npc of npcs) {
      const changes = this.relationshipSystem.decayNpcRelationships(npc, now);
      for (const change of changes) {
        if (Math.abs(change.delta.affinity ?? 0) < 0.3) continue;
        const otherIsMajor = ctx.state.npcs[change.otherId]?.isMajor === true;
        if (!npc.isMajor && !otherIsMajor) continue;
        ctx.bus.emit('relationship:changed', {
          npcId: npc.id,
          kind: 'npc_npc',
          affinity: change.affinity,
          trust: change.trust,
          intimacy: change.intimacy,
          status: change.status,
        });
      }
    }
    const playerChanges = this.relationshipSystem.decayPlayerRelationships(ctx.state, now);
    for (const change of playerChanges) {
      ctx.bus.emit('relationship:changed', {
        npcId: change.otherId,
        kind: 'decay',
        affinity: change.affinity,
        trust: change.trust,
        intimacy: change.intimacy,
        status: change.status,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Goals
  // ---------------------------------------------------------------------------
  private advanceGoals(ctx: IGameContext, npc: NPCState, activity: string, hours: number): void {
    if (npc.goals.length === 0 || hours <= 0) return;
    const group = activityGroupOf(activity);
    const now = ctx.clock.simTimeSeconds;
    for (const goal of npc.goals) {
      if (goal.completedAt !== null) continue;
      const label = goal.label.toLowerCase();
      let matched = false;
      for (const rule of GOAL_RULES) {
        if (!rule.keywords.some((keyword) => label.includes(keyword))) continue;
        if (!rule.groups.includes(group) && !(rule.activities ?? []).includes(activity)) continue;
        goal.progress = clamp(goal.progress + hours * rule.progressPerHour, 0, goal.target);
        matched = true;
        break;
      }
      if (!matched) continue;
      if (goal.progress >= goal.target) {
        goal.completedAt = now;
        goal.progress = goal.target;
        this.archive.goalCompleted(ctx, npc, goal.label);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  private cooldownMinutes(npc: NPCState): number {
    const key = npc.id + ':' + Math.floor(npc.activityStartedAt / 60);
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
      hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
    }
    const span = NPC_MODULE.decisionCooldownMinutesMax - NPC_MODULE.decisionCooldownMinutesMin;
    return NPC_MODULE.decisionCooldownMinutesMin + (hash % (span + 1));
  }

  private minutesToSimSeconds(minutes: number): number {
    return minutes * SIM_SECONDS_PER_GAME_MINUTE;
  }

  /** Estimated maximum catch-up horizon used by tests/debug. */
  getMaxCatchupHours(): number {
    return NPC_MODULE.maxChunksPerNpcUpdate;
  }

  /** All activities the utility AI can choose (for debug UI). */
  getActivityCatalogue(): readonly { id: string; label: string; group: string }[] {
    return ACTIVITIES.map((activity) => ({ id: activity.id, label: activity.label, group: activity.group }));
  }

  /**
   * Integration hook for the economy EmploymentSystem: records a new job for an
   * NPC and archives it. NPC hiring/assignment itself stays owned by economy.
   */
  recordNewJob(npcId: NPCId, jobId: string, title: string): ActionResult {
    const ctx = this.ctx;
    const npc = this.getNPC(npcId);
    if (!ctx || !npc) return { ok: false, code: 'not_found', message: 'Unknown NPC or system not initialised.' };
    if (!ctx.state.economy.jobs[jobId]) {
      return { ok: false, code: 'not_found', message: 'Unknown job: ' + jobId };
    }
    npc.jobId = jobId;
    this.archive.newJob(ctx, npc, title);
    return { ok: true, message: npc.name + ' now works as ' + title + '.', stateChanged: true };
  }

  /** Deterministic record id helper exposed for archive users. */
  static recordId(prefix: string, npcId: NPCId, sequence: number, at: number): string {
    return npcRecordId(prefix, npcId, sequence, at);
  }
}

function applySeedStatus(
  rel: RelationshipState,
  status: 'stranger' | 'acquaintance' | 'friend' | 'close_friend' | 'family' | 'rival' | undefined
): void {
  if (!status) return;
  rel.status = status;
}

/** Marks already-established milestones so they are not archived twice. */
function applySeedMilestoneFlags(
  rel: RelationshipState | undefined,
  status: 'stranger' | 'acquaintance' | 'friend' | 'close_friend' | 'family' | 'rival' | undefined
): void {
  if (!rel || !status) return;
  const add = (flag: string): void => {
    if (!rel.flags.includes(flag)) rel.flags.push(flag);
  };
  if (status === 'friend' || status === 'close_friend' || status === 'family') add('npc_friend_archived');
  if (status === 'close_friend') add('npc_close_friend_archived');
  if (status === 'rival') add('npc_rival_archived');
}
