import type { GameState, IContentRegistry, PhotoState, PlayerGoalState } from '../core/contracts';
import type { AchievementTrigger } from '../data/schema';
import type { JsonObject, JsonValue, SkillId } from '../core/SharedTypes';
import { SKILL_IDS } from '../core/SharedTypes';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { clamp, clamp01 } from '../core/utils';

/**
 * Internal shared helpers for the life module (Agent 12).
 *
 * The contract has no dedicated GameState slice for personal goals / life counters, so the
 * life module persists its small amount of extension data in the documented, serialisable
 * `player.extras` bag under a single namespaced key ("life"). Everything written there is
 * plain JSON so SaveManager can serialise it unchanged.
 */

// ---------------------------------------------------------------------------
// Simulation time (1 sim second = 1 in-game minute)
// ---------------------------------------------------------------------------
export const SIM_SECONDS_PER_GAME_MINUTE = 1;
export const SIM_SECONDS_PER_GAME_HOUR = 60;
export const SIM_SECONDS_PER_GAME_DAY = 1440;

/** Converts simulated seconds to in-game hours. */
export function simSecondsToGameHours(dtSimSeconds: number): number {
  return dtSimSeconds / SIM_SECONDS_PER_GAME_HOUR;
}

// ---------------------------------------------------------------------------
// Life extension data (persisted in player.extras["life"])
// ---------------------------------------------------------------------------
export interface LifeCounters {
  /** Five-star crops harvested (fed by the crop:harvested bus event). */
  perfectCrops: number;
  /** Cakes / pies baked or cooked (fed by item:acquired). */
  cakesBaked: number;
  /** Cigarette ash consumed from the inventory (fertiliser, crafting, pigments). */
  ashUsed: number;
  /** Inventory ash count at the last update; used to derive ashUsed from inventory deltas. */
  ashOnHand: number;
}

export const DEFAULT_LIFE_COUNTERS: LifeCounters = {
  perfectCrops: 0,
  cakesBaked: 0,
  ashUsed: 0,
  ashOnHand: 0,
};

export interface LifeExtras {
  counters: LifeCounters;
  personalGoal: PlayerGoalState | null;
  /** Sim time before which warmUp() is still recovering its warmth. */
  warmUpReadyAt: number;
  /** Last in-game day (0-based totalDays) on which a daily opportunity letter was rolled. */
  lastOpportunityDay: number;
  /** Number of letters written by the daily opportunity roll this life. */
  lettersWritten: number;
}

export function defaultLifeExtras(): LifeExtras {
  return {
    counters: { ...DEFAULT_LIFE_COUNTERS },
    personalGoal: null,
    warmUpReadyAt: 0,
    lastOpportunityDay: -1,
    lettersWritten: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNonNegativeInt(value: unknown, fallback: number): number {
  return Math.max(0, Math.floor(asNumber(value, fallback)));
}

function parsePlayerGoal(value: unknown): PlayerGoalState | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : null;
  if (!id) return null;
  const completedAt = typeof value.completedAt === 'number' ? value.completedAt : null;
  return {
    id,
    title: typeof value.title === 'string' ? value.title : id,
    description: typeof value.description === 'string' ? value.description : '',
    category: typeof value.category === 'string' ? value.category : 'career',
    progress: Math.max(0, asNumber(value.progress, 0)),
    target: Math.max(1, asNumber(value.target, 1)),
    completedAt,
    chosenAt: asNumber(value.chosenAt, 0),
  };
}

/** Reads the life extension bag, returning safe defaults for missing/corrupt data. */
export function readLifeExtras(state: GameState): LifeExtras {
  const extras = defaultLifeExtras();
  const raw: JsonValue | undefined = state.player.extras?.['life'];
  if (!isRecord(raw)) return extras;
  const counters = isRecord(raw['counters']) ? raw['counters'] : {};
  extras.counters = {
    perfectCrops: asNonNegativeInt(counters['perfectCrops'], 0),
    cakesBaked: asNonNegativeInt(counters['cakesBaked'], 0),
    ashUsed: asNonNegativeInt(counters['ashUsed'], 0),
    ashOnHand: asNonNegativeInt(counters['ashOnHand'], 0),
  };
  extras.personalGoal = parsePlayerGoal(raw['personalGoal']);
  extras.warmUpReadyAt = asNumber(raw['warmUpReadyAt'], 0);
  extras.lastOpportunityDay = Math.floor(asNumber(raw['lastOpportunityDay'], -1));
  extras.lettersWritten = asNonNegativeInt(raw['lettersWritten'], 0);
  return extras;
}

function personalGoalToJson(goal: PlayerGoalState): JsonObject {
  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    category: goal.category,
    progress: goal.progress,
    target: goal.target,
    completedAt: goal.completedAt,
    chosenAt: goal.chosenAt,
  };
}

/** Writes the life extension bag back to player.extras["life"]. */
export function writeLifeExtras(state: GameState, extras: LifeExtras): void {
  const life: JsonObject = {
    counters: {
      perfectCrops: extras.counters.perfectCrops,
      cakesBaked: extras.counters.cakesBaked,
      ashUsed: extras.counters.ashUsed,
      ashOnHand: extras.counters.ashOnHand,
    },
    personalGoal: extras.personalGoal ? personalGoalToJson(extras.personalGoal) : null,
    warmUpReadyAt: extras.warmUpReadyAt,
    lastOpportunityDay: extras.lastOpportunityDay,
    lettersWritten: extras.lettersWritten,
  };
  state.player.extras = { ...(state.player.extras ?? {}), life };
}

/** Mutates the persisted life extras through a callback and writes the result back. */
export function mutateLifeExtras(state: GameState, mutate: (extras: LifeExtras) => void): LifeExtras {
  const extras = readLifeExtras(state);
  mutate(extras);
  writeLifeExtras(state, extras);
  return extras;
}

// ---------------------------------------------------------------------------
// Inventory / equipment helpers
// ---------------------------------------------------------------------------
/** Total quantity of an item carried on the player's person (inventory + equipment). */
export function countItemOnPerson(state: GameState, itemId: string): number {
  let total = 0;
  for (const entry of state.player.inventory) {
    if (entry.itemId === itemId) total += entry.quantity;
  }
  for (const equipped of Object.values(state.player.equipment)) {
    if (equipped === itemId) total += 1;
  }
  return total;
}

/** Item ids currently equipped in the player's protection slots. */
export function getEquippedItemIds(state: GameState): string[] {
  const ids: string[] = [];
  for (const equipped of Object.values(state.player.equipment)) {
    if (typeof equipped === 'string' && equipped.length > 0) ids.push(equipped);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Derived stat / progress evaluation (shared by goals and achievements)
// ---------------------------------------------------------------------------
export interface TriggerContext {
  state: GameState;
  content: IContentRegistry;
  counters: LifeCounters;
}

/** PlayerStatistics numeric keys that can be used directly as achievement stat keys. */
export const STATISTIC_KEYS: readonly string[] = [
  'steps',
  'daysLived',
  'cropsHarvested',
  'fishCaught',
  'itemsForaged',
  'itemsCrafted',
  'mealsCooked',
  'itemsBought',
  'itemsSold',
  'moneyEarned',
  'moneySpent',
  'npcsMet',
  'conversations',
  'giftsGiven',
  'festivalsAttended',
  'photosTaken',
  'ashCollected',
  'furniturePlaced',
  'secretsFound',
  'businessesOwned',
  'shiftsWorked',
];

/** Additional derived stat keys computed from the live GameState. */
export const DERIVED_STAT_KEYS: readonly string[] = [
  'fishSpeciesCount',
  'fishSpeciesCaught.<fishId>',
  'fishBiggest.<fishId>',
  'friendCount',
  'closeFriendCount',
  'partnerCount',
  'knownNpcCount',
  'maxSkillLevel',
  'totalSkillLevel',
  'perfectCrops',
  'cakesBaked',
  'ashUsed',
  'locationsVisited',
  'secretLocationsFound',
  'decorScore',
  'communityProjectsCompleted',
  'achievementsUnlocked',
  'archiveEntries',
  'lettersRead',
  'eventsExperienced',
  'playerMoney',
  'playerInfluence',
  'playerCommunityPoints',
  'ageDays',
  'generation',
];

/** True when a stat trigger key is known to the resolver (direct statistic or derived). */
export function isKnownStatKey(key: string): boolean {
  if (STATISTIC_KEYS.includes(key)) return true;
  if (key.startsWith('fishSpeciesCaught.') || key.startsWith('fishBiggest.')) return true;
  return DERIVED_STAT_KEYS.includes(key);
}

function statisticValue(state: GameState, key: string): number {
  const stats = state.player.statistics;
  switch (key) {
    case 'steps': return stats.steps;
    case 'daysLived': return stats.daysLived;
    case 'cropsHarvested': return stats.cropsHarvested;
    case 'fishCaught': return stats.fishCaught;
    case 'itemsForaged': return stats.itemsForaged;
    case 'itemsCrafted': return stats.itemsCrafted;
    case 'mealsCooked': return stats.mealsCooked;
    case 'itemsBought': return stats.itemsBought;
    case 'itemsSold': return stats.itemsSold;
    case 'moneyEarned': return stats.moneyEarned;
    case 'moneySpent': return stats.moneySpent;
    case 'npcsMet': return stats.npcsMet;
    case 'conversations': return stats.conversations;
    case 'giftsGiven': return stats.giftsGiven;
    case 'festivalsAttended': return stats.festivalsAttended;
    case 'photosTaken': return stats.photosTaken;
    case 'ashCollected': return stats.ashCollected;
    case 'furniturePlaced': return stats.furniturePlaced;
    case 'secretsFound': return stats.secretsFound;
    case 'businessesOwned': return stats.businessesOwned;
    case 'shiftsWorked': return stats.shiftsWorked;
    default: return Number.NaN;
  }
}

function fishSpeciesCount(state: GameState): number {
  return Object.keys(state.player.statistics.fishSpeciesCaught).length;
}

function relationshipCount(state: GameState, statuses: readonly string[]): number {
  let count = 0;
  for (const relationship of Object.values(state.player.relationships)) {
    if (statuses.includes(relationship.status)) count += 1;
  }
  return count;
}

function maxSkillLevel(state: GameState): number {
  let max = 0;
  for (const skill of SKILL_IDS) {
    const progress = state.player.skills[skill];
    if (progress && progress.level > max) max = progress.level;
  }
  return max;
}

function totalSkillLevel(state: GameState): number {
  let total = 0;
  for (const skill of SKILL_IDS) {
    total += state.player.skills[skill]?.level ?? 0;
  }
  return total;
}

function maxDecorScore(state: GameState): number {
  let max = 0;
  for (const home of Object.values(state.housing.homes)) {
    if (home.decorationScore > max) max = home.decorationScore;
  }
  return max;
}

function locationsVisited(state: GameState): number {
  let count = 0;
  for (const location of Object.values(state.world.locations)) {
    if (location.visitCount > 0) count += 1;
  }
  return count;
}

function secretLocationsFound(state: GameState, content: IContentRegistry): number {
  let count = 0;
  for (const def of content.pack.locations) {
    if (!def.secret) continue;
    const location = state.world.locations[def.id];
    if (location && location.unlocked) count += 1;
  }
  return count;
}

function communityProjectsCompleted(state: GameState): number {
  let count = 0;
  for (const project of state.social.communityProjects) {
    if (project.status === 'complete') count += 1;
  }
  return count;
}

/** Resolves a stat-style trigger key to its current numeric value. Unknown keys resolve to 0. */
export function resolveStatValue(ctx: TriggerContext, key: string): number {
  const direct = statisticValue(ctx.state, key);
  if (!Number.isNaN(direct)) return direct;

  if (key.startsWith('fishSpeciesCaught.')) {
    const fishId = key.slice('fishSpeciesCaught.'.length);
    return ctx.state.player.statistics.fishSpeciesCaught[fishId] ?? 0;
  }
  if (key.startsWith('fishBiggest.')) {
    const fishId = key.slice('fishBiggest.'.length);
    return ctx.state.player.statistics.fishBiggest[fishId] ?? 0;
  }

  switch (key) {
    case 'fishSpeciesCount': return fishSpeciesCount(ctx.state);
    case 'friendCount': return relationshipCount(ctx.state, ['friend', 'close_friend']);
    case 'closeFriendCount': return relationshipCount(ctx.state, ['close_friend']);
    case 'partnerCount': return relationshipCount(ctx.state, ['dating', 'partner']);
    case 'knownNpcCount': return relationshipCount(ctx.state, ['acquaintance', 'friend', 'close_friend', 'dating', 'partner', 'family', 'rival', 'enemy', 'ex']);
    case 'maxSkillLevel': return maxSkillLevel(ctx.state);
    case 'totalSkillLevel': return totalSkillLevel(ctx.state);
    case 'perfectCrops': return ctx.counters.perfectCrops;
    case 'cakesBaked': return ctx.counters.cakesBaked;
    case 'ashUsed': return ctx.counters.ashUsed;
    case 'locationsVisited': return locationsVisited(ctx.state);
    case 'secretLocationsFound': return secretLocationsFound(ctx.state, ctx.content);
    case 'decorScore': return maxDecorScore(ctx.state);
    case 'communityProjectsCompleted': return communityProjectsCompleted(ctx.state);
    case 'achievementsUnlocked': return ctx.state.life.achievements.length;
    case 'archiveEntries': return ctx.state.life.archive.length;
    case 'lettersRead': return ctx.state.life.letters.filter((letter) => letter.read).length;
    case 'eventsExperienced': return ctx.state.world.events.length;
    case 'playerMoney': return ctx.state.player.money;
    case 'playerInfluence': return ctx.state.player.influence;
    case 'playerCommunityPoints': return ctx.state.player.communityPoints;
    case 'ageDays': return ctx.state.life.ageDays;
    case 'generation': return ctx.state.life.generation;
    default: return 0;
  }
}

function skillLevel(state: GameState, skill: SkillId): number {
  return state.player.skills[skill]?.level ?? 0;
}

/** Evaluates any achievement/goal trigger and returns its current progress value. */
export function evaluateTrigger(ctx: TriggerContext, trigger: AchievementTrigger): number {
  switch (trigger.kind) {
    case 'stat':
      return resolveStatValue(ctx, trigger.key);
    case 'skill':
      return trigger.key === 'any' ? maxSkillLevel(ctx.state) : skillLevel(ctx.state, trigger.key as SkillId);
    case 'collection': {
      const entries = ctx.state.collection.entries;
      if (trigger.key === 'total' || trigger.key === 'all') return Object.keys(entries).length;
      return entries[trigger.key]?.count ?? 0;
    }
    case 'relationship':
      if (trigger.key === 'friends') return relationshipCount(ctx.state, ['friend', 'close_friend']);
      if (trigger.key === 'close_friends') return relationshipCount(ctx.state, ['close_friend']);
      if (trigger.key === 'partners') return relationshipCount(ctx.state, ['dating', 'partner']);
      if (trigger.key === 'known') return relationshipCount(ctx.state, ['acquaintance', 'friend', 'close_friend', 'dating', 'partner', 'family', 'rival', 'enemy', 'ex']);
      return 0;
    case 'wealth':
      if (trigger.key === 'money' || trigger.key === 'netWorth') return ctx.state.player.money;
      if (trigger.key === 'moneyEarned') return ctx.state.player.statistics.moneyEarned;
      if (trigger.key === 'influence') return ctx.state.player.influence;
      if (trigger.key === 'communityPoints') return ctx.state.player.communityPoints;
      return 0;
    case 'event':
      return ctx.state.eventSystem.occurrences[trigger.key] ?? 0;
    default:
      return 0;
  }
}

/** True when the trigger goal/achievement threshold is currently met. */
export function isTriggerMet(ctx: TriggerContext, trigger: AchievementTrigger): boolean {
  return evaluateTrigger(ctx, trigger) >= trigger.threshold;
}

// ---------------------------------------------------------------------------
// Miscellaneous helpers
// ---------------------------------------------------------------------------
/** Ratio (0..1) describing overall life burn progress, useful for UI progress bars. */
export function lifeProgressRatio(state: GameState): number {
  return clamp01(1 - state.player.cigarette.lengthRatio);
}

/** Clamped movement multiplier bookkeeping shared by physics and life system. */
export function clampMultiplier(value: number): number {
  return clamp(value, 0.15, 1.5);
}

// ---------------------------------------------------------------------------
// Photos (tolerant bridge to the exploration slice)
// ---------------------------------------------------------------------------
/**
 * CONTRACT GAP: GameState has no persistent array of PhotoState - ExplorationState only
 * stores photo ids per location. We therefore read an optional `photos` array from
 * state.exploration if an implementation provides one, and otherwise return no photos
 * rather than fabricating records.
 */
export function readPhotos(state: GameState): PhotoState[] {
  const carrier = state.exploration as unknown as { photos?: unknown };
  const photos = carrier.photos;
  if (!Array.isArray(photos)) return [];
  const result: PhotoState[] = [];
  for (const raw of photos) {
    if (!isRecord(raw)) continue;
    const id = typeof raw.id === 'string' ? raw.id : null;
    const title = typeof raw.title === 'string' ? raw.title : null;
    const takenAt = asNumber(raw.takenAt, Number.NaN);
    const locationId = typeof raw.locationId === 'string' ? raw.locationId : null;
    const kind = raw.kind;
    if (!id || !title || !locationId || !Number.isFinite(takenAt)) continue;
    if (kind !== 'landscape' && kind !== 'npc' && kind !== 'fish' && kind !== 'event' && kind !== 'collection') continue;
    const subjects = Array.isArray(raw.subjects)
      ? raw.subjects.filter((subject): subject is string => typeof subject === 'string')
      : [];
    result.push({
      id,
      title,
      description: typeof raw.description === 'string' ? raw.description : '',
      takenAt,
      locationId,
      subjects,
      kind,
    });
  }
  return result;
}

/** The archive importance threshold from WORLD_CONFIG (records below it are not stored). */
export function archiveImportanceThreshold(): number {
  return WORLD_CONFIG.life.archiveImportanceThreshold;
}
