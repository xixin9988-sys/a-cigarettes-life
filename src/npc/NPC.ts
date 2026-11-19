// =============================================================================
// NPC domain vocabulary shared by the autonomous-life module (Agent 3).
// Activity catalogue, need polarity, module constants and the serialisable
// per-NPC extension payload stored in NPCState.extras ('npc' namespace).
// DOM-free / Phaser-free: safe to run inside the simulation Web Worker.
// =============================================================================
import type { JsonValue, LocationId, NPCId, NPCNeedsValues, NPCPersonalityValues } from '../core/SharedTypes';
import type { NPCState } from '../core/contracts';
import {
  GAME_MINUTES_PER_DAY,
  GAME_MINUTES_PER_HOUR,
  SECONDS_PER_GAME_MINUTE,
} from '../core/SharedTypes';
import { clamp } from '../core/utils';

// -----------------------------------------------------------------------------
// Time helpers. Contract: 1 simulation second = 1 in-game minute at 1x.
// Therefore 1 game hour = 60 sim seconds and 1 game day = 1440 sim seconds.
// -----------------------------------------------------------------------------
export const SIM_SECONDS_PER_GAME_MINUTE = SECONDS_PER_GAME_MINUTE;
export const SIM_SECONDS_PER_GAME_HOUR = GAME_MINUTES_PER_HOUR * SECONDS_PER_GAME_MINUTE;
export const SIM_SECONDS_PER_GAME_DAY = GAME_MINUTES_PER_DAY * SECONDS_PER_GAME_MINUTE;

export function gameMinutesToSimSeconds(minutes: number): number {
  return minutes * SIM_SECONDS_PER_GAME_MINUTE;
}

export function simSecondsToGameHours(seconds: number): number {
  return seconds / SIM_SECONDS_PER_GAME_HOUR;
}

export function simSecondsToGameDays(seconds: number): number {
  return seconds / SIM_SECONDS_PER_GAME_DAY;
}

// -----------------------------------------------------------------------------
// Module tuning constants (documented local balance; WORLD_CONFIG owns the
// shared need-decay/relationship numbers that other modules also read).
// -----------------------------------------------------------------------------
export const NPC_MODULE = {
  /** Memory cap per NPC (permanent memories are never dropped). */
  maxMemoriesPerNpc: 60,
  /** Recent activity ids kept for anti-repetition. */
  maxActivityHistory: 8,
  /** Decision cooldown bounds in game minutes (staggered by NPC hash). */
  decisionCooldownMinutesMin: 10,
  decisionCooldownMinutesMax: 40,
  /** Utility candidates that reach the probability engine. */
  maxDecisionCandidates: 5,
  /** Hard cap of behaviour decisions per NPC per update() call (offline catch-up). */
  maxDecisionsPerNpcUpdate: 8,
  /** Hard cap of hourly catch-up chunks simulated per NPC per update() call. */
  maxChunksPerNpcUpdate: 96,
  /** Social simulation cadence in game minutes. */
  socialIntervalGameMinutes: 15,
  /** Social slots processed per update() call (offline catch-up cap). */
  maxSocialSlotsPerUpdate: 12,
  /** Cap of pair interactions processed per social slot. */
  maxInteractionsPerSocialSlot: 12,
  /** Daily NPC-NPC social interaction budget per NPC. */
  maxSocialInteractionsPerNpcDay: 6,
  /** NPC social log ring size (state.social.npcSocialLog). */
  npcSocialLogCap: 200,
  /** Life-history entries retained per NPC. */
  lifeHistoryCap: 60,
  /** Base chance an eligible co-located pair interacts in a slot. */
  basePairInteractionChance: 0.16,
  /** Attempts to form a dating bond per warm interaction when eligible. */
  romanceFormationChance: 0.12,
  /** Days without contact before relationships start drifting. */
  relationshipDecayGraceDays: 2,
  /** Simulated days processed in one relationship decay pass. */
  maxRelationshipDecayDays: 10,
  /** Consecutive-activity penalty applied to the utility of the previous group. */
  repeatedActivityPenalty: 0.55,
} as const;

// -----------------------------------------------------------------------------
// Needs model.
// Every need is stored 0..100. "resource" needs are satisfactions where a HIGH
// value is good (energy, social fulfilment, fun, safety, belonging, purpose)
// and that decay over time. "pressure" needs are deficits where a HIGH value is
// bad (hunger, moneyPressure, workPressure) and that accumulate over time.
// Need urgency is the distance from the desired state, 0..1.
// -----------------------------------------------------------------------------
export type NeedKey = keyof NPCNeedsValues;
export type NeedPolarity = 'resource' | 'pressure';

export const NEED_POLARITY: Readonly<Record<NeedKey, NeedPolarity>> = {
  hunger: 'pressure',
  energy: 'resource',
  social: 'resource',
  fun: 'resource',
  safety: 'resource',
  belonging: 'resource',
  moneyPressure: 'pressure',
  workPressure: 'pressure',
  purpose: 'resource',
};

/** 0..1 urgency (1 = desperate). */
export function needUrgency(need: NeedKey, value: number): number {
  const safe = clamp(value, 0, 100);
  return NEED_POLARITY[need] === 'resource' ? (100 - safe) / 100 : safe / 100;
}

/**
 * Converts a raw need delta into an "improvement score": positive means the
 * activity leaves the NPC better off. Resource needs improve with +delta,
 * pressure needs improve with -delta.
 */
export function needImprovement(need: NeedKey, delta: number): number {
  return NEED_POLARITY[need] === 'resource' ? delta : -delta;
}

export function clampNeedValue(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 100);
}

// -----------------------------------------------------------------------------
// Activity groups (used for schedule matching and anti-repetition).
// -----------------------------------------------------------------------------
export type ActivityGroup =
  | 'work'
  | 'sleep'
  | 'food'
  | 'social'
  | 'leisure'
  | 'care'
  | 'home'
  | 'errand'
  | 'explore'
  | 'travel'
  | 'idle';

export type LocationHint =
  | 'home'
  | 'work'
  | 'social'
  | 'food'
  | 'cafe'
  | 'shops'
  | 'outdoors'
  | 'library'
  | 'water'
  | 'garden'
  | 'rest'
  | 'errands'
  | 'jobs'
  | 'station'
  | 'event'
  | 'date'
  | 'market';

export type NeedDeltaMap = Partial<Record<NeedKey, number>>;

export interface ActivityDefinition {
  id: string;
  label: string;
  group: ActivityGroup;
  /** True when the utility AI may pick this activity as a fresh behaviour. */
  decision: boolean;
  /** Typical duration in game minutes (before personality variation). */
  baseDurationMinutes: number;
  /** Need changes applied when the activity completes. */
  satisfy: NeedDeltaMap;
  locationHint: LocationHint;
  /**
   * Personality modifiers: weight = 1 + sum((trait - 0.5) * coefficient).
   * Coefficients below are intentionally small so no trait dominates.
   */
  personality: Partial<Record<keyof NPCPersonalityValues, number>>;
  /** Interest tags this activity expresses (matched against NPCState.interests). */
  interests: string[];
}

const ACTIVITY_LIST: readonly ActivityDefinition[] = [
  {
    id: 'work',
    label: 'Working',
    group: 'work',
    decision: true,
    baseDurationMinutes: 210,
    satisfy: { energy: -10, workPressure: 14, moneyPressure: -5, purpose: 7, social: 2 },
    locationHint: 'work',
    personality: { workTendency: 1.3, responsibility: 0.9, independence: 0.3, caution: 0.3, extroversion: 0.1 },
    interests: ['work', 'craft', 'community', 'making', 'city_life'],
  },
  {
    id: 'sleep',
    label: 'Sleeping',
    group: 'sleep',
    decision: true,
    baseDurationMinutes: 420,
    satisfy: { energy: 55, fun: 3, safety: 6, workPressure: -8, hunger: 6 },
    locationHint: 'home',
    personality: { caution: 0.2, independence: 0.1 },
    interests: ['quiet', 'home'],
  },
  {
    id: 'go_home',
    label: 'Heading home',
    group: 'home',
    decision: true,
    baseDurationMinutes: 90,
    satisfy: { safety: 10, belonging: 6, energy: 4, fun: 3 },
    locationHint: 'home',
    personality: { caution: 0.5, independence: 0.2, introversion: 0.4 },
    interests: ['home', 'quiet', 'comfort'],
  },
  {
    id: 'eat',
    label: 'Eating',
    group: 'food',
    decision: true,
    baseDurationMinutes: 45,
    satisfy: { hunger: -34, fun: 3, energy: 4 },
    locationHint: 'food',
    personality: { generosity: 0.2, caution: 0.1 },
    interests: ['food', 'cooking', 'comfort'],
  },
  {
    id: 'shop',
    label: 'Shopping',
    group: 'errand',
    decision: true,
    baseDurationMinutes: 50,
    satisfy: { fun: 9, moneyPressure: 5, belonging: 3, purpose: 2 },
    locationHint: 'shops',
    personality: { spendingTendency: 1.2, extroversion: 0.4, curiosity: 0.2 },
    interests: ['shopping', 'fashion', 'bargains', 'city_life'],
  },
  {
    id: 'stroll',
    label: 'Strolling',
    group: 'leisure',
    decision: true,
    baseDurationMinutes: 60,
    satisfy: { fun: 12, energy: -4, safety: 4, purpose: 2 },
    locationHint: 'outdoors',
    personality: { adventure: 0.8, curiosity: 0.5, introversion: 0.3 },
    interests: ['nature', 'outdoors', 'weather', 'walking'],
  },
  {
    id: 'read',
    label: 'Reading',
    group: 'leisure',
    decision: true,
    baseDurationMinutes: 90,
    satisfy: { fun: 13, purpose: 5, energy: 3 },
    locationHint: 'library',
    personality: { introversion: 0.8, curiosity: 0.9, caution: 0.2, workTendency: 0.1 },
    interests: ['books', 'poetry', 'history', 'quiet'],
  },
  {
    id: 'fish',
    label: 'Fishing',
    group: 'explore',
    decision: true,
    baseDurationMinutes: 150,
    satisfy: { fun: 15, purpose: 7, energy: -6, hunger: 4, safety: 2 },
    locationHint: 'water',
    personality: { adventure: 0.8, caution: 0.3, introversion: 0.5, independence: 0.4 },
    interests: ['fishing', 'water', 'outdoors', 'quiet'],
  },
  {
    id: 'garden',
    label: 'Gardening',
    group: 'explore',
    decision: true,
    baseDurationMinutes: 120,
    satisfy: { fun: 12, purpose: 8, energy: -7, hunger: 3 },
    locationHint: 'garden',
    personality: { curiosity: 0.5, responsibility: 0.5, caution: 0.3, adventure: 0.3 },
    interests: ['gardening', 'plants', 'nature', 'flowers'],
  },
  {
    id: 'visit_friend',
    label: 'Visiting a friend',
    group: 'social',
    decision: true,
    baseDurationMinutes: 120,
    satisfy: { social: 26, belonging: 14, fun: 11, energy: -2 },
    locationHint: 'social',
    personality: { extroversion: 1.1, socialNeed: 1.0, introversion: -0.7, generosity: 0.4 },
    interests: ['friends', 'gossip', 'socialising'],
  },
  {
    id: 'go_cafe',
    label: 'Going to the cafe',
    group: 'social',
    decision: true,
    baseDurationMinutes: 70,
    satisfy: { social: 15, fun: 13, hunger: -16, moneyPressure: 4 },
    locationHint: 'cafe',
    personality: { extroversion: 0.9, socialNeed: 0.7, spendingTendency: 0.5, introversion: -0.4 },
    interests: ['coffee', 'tea', 'gossip', 'socialising', 'cakes'],
  },
  {
    id: 'date',
    label: 'On a date',
    group: 'social',
    decision: true,
    baseDurationMinutes: 150,
    satisfy: { social: 24, fun: 18, belonging: 12, moneyPressure: 3 },
    locationHint: 'date',
    personality: { extroversion: 0.4, socialNeed: 0.4, adventure: 0.2, generosity: 0.3 },
    interests: ['romance', 'music', 'food', 'city_life'],
  },
  {
    id: 'attend_event',
    label: 'Attending an event',
    group: 'social',
    decision: true,
    baseDurationMinutes: 120,
    satisfy: { social: 20, fun: 20, belonging: 12, purpose: 6 },
    locationHint: 'event',
    personality: { extroversion: 1.0, curiosity: 0.6, socialNeed: 0.6 },
    interests: ['festivals', 'community', 'music', 'art', 'celebration'],
  },
  {
    id: 'rest',
    label: 'Resting',
    group: 'care',
    decision: true,
    baseDurationMinutes: 60,
    satisfy: { energy: 20, fun: 4, workPressure: -4, safety: 3 },
    locationHint: 'rest',
    personality: { caution: 0.4, independence: 0.3, workTendency: -0.6 },
    interests: ['quiet', 'comfort', 'home'],
  },
  {
    id: 'personal_errand',
    label: 'Running errands',
    group: 'errand',
    decision: true,
    baseDurationMinutes: 60,
    satisfy: { purpose: 4, moneyPressure: -6, energy: -3, workPressure: -2 },
    locationHint: 'errands',
    personality: { responsibility: 0.9, caution: 0.4, independence: 0.3, adventure: -0.2 },
    interests: ['community', 'errands', 'practical'],
  },
  {
    id: 'look_for_work',
    label: 'Looking for work',
    group: 'errand',
    decision: true,
    baseDurationMinutes: 90,
    satisfy: { purpose: 5, moneyPressure: -4, energy: -4, workPressure: 3 },
    locationHint: 'jobs',
    personality: { workTendency: 1.0, responsibility: 0.6, independence: 0.4 },
    interests: ['work', 'city_life', 'ambition'],
  },
  {
    id: 'travel',
    label: 'Travelling',
    group: 'travel',
    decision: true,
    baseDurationMinutes: 90,
    satisfy: { fun: 8, energy: -5, purpose: 2 },
    locationHint: 'station',
    personality: { adventure: 1.2, curiosity: 0.8, caution: -0.4 },
    interests: ['travel', 'city_life', 'adventure'],
  },
  // ---- Routine activities used by schedules (not fresh decision candidates) ----
  {
    id: 'breakfast',
    label: 'Breakfast',
    group: 'food',
    decision: false,
    baseDurationMinutes: 30,
    satisfy: { hunger: -26, energy: 10, fun: 2 },
    locationHint: 'home',
    personality: {},
    interests: ['food', 'home'],
  },
  {
    id: 'lunch',
    label: 'Lunch',
    group: 'food',
    decision: false,
    baseDurationMinutes: 40,
    satisfy: { hunger: -24, energy: 6 },
    locationHint: 'food',
    personality: {},
    interests: ['food'],
  },
  {
    id: 'dinner',
    label: 'Dinner',
    group: 'food',
    decision: false,
    baseDurationMinutes: 60,
    satisfy: { hunger: -30, social: 6, fun: 4 },
    locationHint: 'home',
    personality: {},
    interests: ['food', 'home'],
  },
  {
    id: 'commute',
    label: 'Commuting',
    group: 'travel',
    decision: false,
    baseDurationMinutes: 30,
    satisfy: { energy: -5, fun: 2 },
    locationHint: 'station',
    personality: {},
    interests: ['travel'],
  },
  {
    id: 'leisure',
    label: 'Leisure time',
    group: 'leisure',
    decision: false,
    baseDurationMinutes: 90,
    satisfy: { fun: 14, social: 4, energy: -2 },
    locationHint: 'outdoors',
    personality: {},
    interests: ['socialising', 'outdoors'],
  },
  {
    id: 'hobby',
    label: 'Hobby time',
    group: 'leisure',
    decision: false,
    baseDurationMinutes: 100,
    satisfy: { fun: 15, purpose: 9, energy: -2 },
    locationHint: 'home',
    personality: {},
    interests: ['craft', 'art', 'music', 'books', 'gardening'],
  },
  {
    id: 'relax',
    label: 'Relaxing',
    group: 'care',
    decision: false,
    baseDurationMinutes: 75,
    satisfy: { energy: 14, fun: 7, workPressure: -6 },
    locationHint: 'home',
    personality: {},
    interests: ['quiet', 'comfort'],
  },
  {
    id: 'socialise',
    label: 'Socialising',
    group: 'social',
    decision: false,
    baseDurationMinutes: 90,
    satisfy: { social: 22, belonging: 10, fun: 9 },
    locationHint: 'social',
    personality: {},
    interests: ['socialising', 'gossip', 'friends'],
  },
  {
    id: 'market',
    label: 'At the market',
    group: 'errand',
    decision: false,
    baseDurationMinutes: 50,
    satisfy: { fun: 8, hunger: -6, moneyPressure: -2, belonging: 4 },
    locationHint: 'market',
    personality: {},
    interests: ['bargains', 'food', 'community'],
  },
  {
    id: 'errand',
    label: 'Errands',
    group: 'errand',
    decision: false,
    baseDurationMinutes: 45,
    satisfy: { purpose: 3, energy: -2, moneyPressure: -2 },
    locationHint: 'errands',
    personality: {},
    interests: ['errands', 'practical'],
  },
];

const ACTIVITIES_BY_ID = new Map<string, ActivityDefinition>();
for (const definition of ACTIVITY_LIST) ACTIVITIES_BY_ID.set(definition.id, definition);

export const ACTIVITIES: readonly ActivityDefinition[] = ACTIVITY_LIST;

/** All activities the utility AI may choose (fresh behaviours). */
export const DECISION_ACTIVITIES: readonly ActivityDefinition[] = ACTIVITY_LIST.filter(
  (definition) => definition.decision
);

export function getActivityDefinition(activityId: string): ActivityDefinition | undefined {
  return ACTIVITIES_BY_ID.get(activityId);
}

/** Falls back to the 'idle' group for unknown/content-authored activity names. */
export function activityGroupOf(activityId: string): ActivityGroup {
  return ACTIVITIES_BY_ID.get(activityId)?.group ?? 'idle';
}

export function isSleepActivity(activityId: string): boolean {
  return activityGroupOf(activityId) === 'sleep';
}

// -----------------------------------------------------------------------------
// Personality trait vocabulary (12 traits from the contract).
// -----------------------------------------------------------------------------
export const PERSONALITY_KEYS: readonly (keyof NPCPersonalityValues)[] = [
  'extroversion',
  'introversion',
  'adventure',
  'caution',
  'generosity',
  'curiosity',
  'socialNeed',
  'independence',
  'responsibility',
  'spendingTendency',
  'artisticTendency',
  'workTendency',
];

// -----------------------------------------------------------------------------
// Serialisable NPCState.extras payload. Everything the NPC module needs across
// save/load lives here (under the 'npc' namespace so other modules can keep
// their own keys). All values are plain JSON.
// -----------------------------------------------------------------------------
export interface NpcDecisionDebug {
  activity: string;
  at: number;
  candidates: { id: string; weight: number }[];
}

export interface NpcExtras {
  lastDecision?: NpcDecisionDebug;
  /** Monotonic counter for deterministic memory ids. */
  memorySeq?: number;
  /** Current day index for the daily social budget. */
  socialDay?: number;
  /** Interactions used today. */
  socialCount?: number;
  /** Last day relationship drift was processed. */
  lastRelationshipDecayDay?: number;
  /** Monotonic counter for deterministic life-history ids. */
  historySeq?: number;
  /** Seeded-romance marker (data declares couples the contract cannot express). */
  seededRomance?: string[];
  /** Sim time until which the NPC is externally occupied. */
  awayUntil?: number;
}

function asObject(value: JsonValue | undefined): Record<string, JsonValue> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, JsonValue>;
}

function asFiniteNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') result.push(entry);
  }
  return result;
}

function parseDecisionDebug(value: JsonValue | undefined): NpcDecisionDebug | undefined {
  const raw = asObject(value);
  if (!raw) return undefined;
  const activity = raw['activity'];
  const at = asFiniteNumber(raw['at']);
  if (typeof activity !== 'string' || at === undefined) return undefined;
  const candidates: { id: string; weight: number }[] = [];
  const rawCandidates = raw['candidates'];
  if (Array.isArray(rawCandidates)) {
    for (const item of rawCandidates) {
      const candidate = asObject(item);
      if (!candidate) continue;
      const id = candidate['id'];
      const weight = asFiniteNumber(candidate['weight']);
      if (typeof id === 'string' && weight !== undefined) candidates.push({ id, weight });
    }
  }
  return { activity, at, candidates };
}

/** Reads the NPC module payload out of NPCState.extras with defensive parsing. */
export function readNpcExtras(npc: NPCState): NpcExtras {
  const payload = asObject(npc.extras?.['npc'] as JsonValue | undefined);
  if (!payload) return {};
  const extras: NpcExtras = {};
  const lastDecision = parseDecisionDebug(payload['lastDecision']);
  if (lastDecision) extras.lastDecision = lastDecision;
  const memorySeq = asFiniteNumber(payload['memorySeq']);
  if (memorySeq !== undefined) extras.memorySeq = Math.max(0, Math.floor(memorySeq));
  const socialDay = asFiniteNumber(payload['socialDay']);
  if (socialDay !== undefined) extras.socialDay = Math.floor(socialDay);
  const socialCount = asFiniteNumber(payload['socialCount']);
  if (socialCount !== undefined) extras.socialCount = Math.max(0, Math.floor(socialCount));
  const lastDecay = asFiniteNumber(payload['lastRelationshipDecayDay']);
  if (lastDecay !== undefined) extras.lastRelationshipDecayDay = Math.floor(lastDecay);
  const historySeq = asFiniteNumber(payload['historySeq']);
  if (historySeq !== undefined) extras.historySeq = Math.max(0, Math.floor(historySeq));
  const seededRomance = asStringArray(payload['seededRomance']);
  if (seededRomance) extras.seededRomance = seededRomance;
  const awayUntil = asFiniteNumber(payload['awayUntil']);
  if (awayUntil !== undefined) extras.awayUntil = awayUntil;
  return extras;
}

/** Writes the NPC module payload back into NPCState.extras. */
export function writeNpcExtras(npc: NPCState, extras: NpcExtras): void {
  const payload: Record<string, JsonValue> = {};
  if (extras.lastDecision) {
    payload['lastDecision'] = {
      activity: extras.lastDecision.activity,
      at: extras.lastDecision.at,
      candidates: extras.lastDecision.candidates.map((candidate) => ({
        id: candidate.id,
        weight: candidate.weight,
      })),
    };
  }
  if (extras.memorySeq !== undefined) payload['memorySeq'] = extras.memorySeq;
  if (extras.socialDay !== undefined) payload['socialDay'] = extras.socialDay;
  if (extras.socialCount !== undefined) payload['socialCount'] = extras.socialCount;
  if (extras.lastRelationshipDecayDay !== undefined) {
    payload['lastRelationshipDecayDay'] = extras.lastRelationshipDecayDay;
  }
  if (extras.historySeq !== undefined) payload['historySeq'] = extras.historySeq;
  if (extras.seededRomance) payload['seededRomance'] = [...extras.seededRomance];
  if (extras.awayUntil !== undefined) payload['awayUntil'] = extras.awayUntil;
  const next: Record<string, JsonValue> = npc.extras ? { ...npc.extras } : {};
  next['npc'] = payload;
  npc.extras = next;
}

/** Record a behaviour decision for debug UI (mirrors NPCSystem.getLastDecision). */
export function storeLastDecision(npc: NPCState, debug: NpcDecisionDebug): void {
  const extras = readNpcExtras(npc);
  extras.lastDecision = debug;
  writeNpcExtras(npc, extras);
}

// -----------------------------------------------------------------------------
// Deterministic id helper. Never use Date.now()/makeId() for gameplay ids:
// identical seeds + states must produce identical saves.
// -----------------------------------------------------------------------------
export function npcRecordId(prefix: string, npcId: NPCId, sequence: number, at: number): string {
  return prefix + ':' + npcId + ':' + Math.floor(at).toString(36) + ':' + sequence.toString(36);
}

// -----------------------------------------------------------------------------
// Small numeric helpers used across the NPC module.
// -----------------------------------------------------------------------------
export function safeClamp01(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}
