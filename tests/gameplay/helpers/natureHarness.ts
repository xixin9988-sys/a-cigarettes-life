import { Clock } from '../../../src/core/Clock';
import { ContentRegistry } from '../../../src/core/ContentRegistry';
import { createGameContext, RngFacade } from '../../../src/core/GameContext';
import { EventBus } from '../../../src/core/EventBus';
import { MemoryLogger } from '../../../src/core/GameLogger';
import { SystemRegistry } from '../../../src/core/SystemRegistry';
import { DEFAULT_APPEARANCE, createInitialGameState } from '../../../src/core/WorldFactory';
import { addItemToInventory, countItem } from '../../../src/core/InventoryUtil';
import { gameTimeToSimSeconds } from '../../../src/core/TimeUtil';
import { SEASONS } from '../../../src/core/SharedTypes';
import type {
  EvaluatedCandidate,
  GameState,
  IGameContext,
  IProbabilityEngine,
  ISkillSystem,
  IWorldSystem,
  ProbabilityDecision,
  ProbabilityDecisionRecord,
  ProbabilityOption,
  ProbabilityPersistState,
  ProbabilityRequest,
  ProbabilityStreamStats,
  ConditionExpr,
  ProbabilityContext,
  ActionResult,
  MicroclimateState,
  EnvironmentState,
  RegionState,
  LocationState,
  TrainDepartureInfo,
  GameEventTopic,
} from '../../../src/core/contracts';
import type {
  ContentPack,
  ItemDef,
  LocationDef,
  TrainRouteDef,
  ItemShape,
  LocationKind,
  FacilityKind,
} from '../../../src/data/schema';
import type { GameTime, ItemCategory, QualityStars, Season, SkillId, WeatherType } from '../../../src/core/SharedTypes';
import { CONTENT_PACK } from '../../../src/data/index';
import { ITEM } from '../../../src/data/items/ids';
import { LOC } from '../../../src/data/locations/ids';
import { FarmingSystem } from '../../../src/gameplay/FarmingSystem';
import { ForagingSystem } from '../../../src/gameplay/ForagingSystem';
import { FishingSystem } from '../../../src/gameplay/FishingSystem';
import { ExplorationSystem } from '../../../src/gameplay/ExplorationSystem';

// =============================================================================
// Deterministic probability engine double
// =============================================================================
interface StreamSlot {
  state: number;
  draws: number;
  decisions: number;
  lastValue: number;
}

function streamSeed(seed: number, streamId: string): number {
  let hash = (seed >>> 0) ^ 0x9e3779b9;
  for (let index = 0; index < streamId.length; index += 1) {
    hash = Math.imul(hash ^ streamId.charCodeAt(index), 16777619) >>> 0;
  }
  return (hash === 0 ? 0x6d2b79f5 : hash) >>> 0;
}

/**
 * Small deterministic IProbabilityEngine used only by the nature test harness.
 * The production engine is a parallel deliverable; the systems under test only use the
 * documented IProbabilityEngine surface (roll/chance/floatRange/intRange/weighted).
 * Each stream is an independent mulberry32 sequence keyed by (seed, streamId).
 */
export class NatureTestProbabilityEngine implements IProbabilityEngine {
  seed = 1;
  private readonly streams = new Map<string, StreamSlot>();
  private history: ProbabilityDecisionRecord[] = [];
  private decisionCounter = 0;
  private traceCounter = 0;

  init(seed: number, persisted?: ProbabilityPersistState): void {
    this.seed = seed >>> 0;
    this.streams.clear();
    this.history = [];
    this.decisionCounter = 0;
    this.traceCounter = 0;
    if (persisted) this.importState(persisted);
  }

  ensureStream(streamId: string): void {
    if (this.streams.has(streamId)) return;
    this.streams.set(streamId, { state: streamSeed(this.seed, streamId), draws: 0, decisions: 0, lastValue: 0 });
  }

  hasStream(streamId: string): boolean {
    return this.streams.has(streamId);
  }

  listStreams(): string[] {
    return Array.from(this.streams.keys());
  }

  private next(streamId: string): number {
    this.ensureStream(streamId);
    const slot = this.streams.get(streamId);
    if (!slot) throw new Error('stream disappeared: ' + streamId);
    slot.state = (slot.state + 0x6d2b79f5) >>> 0;
    let t = slot.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    slot.draws += 1;
    slot.lastValue = value;
    return value;
  }

  roll(streamId: string): number {
    return this.next(streamId);
  }

  floatRange(streamId: string, min: number, max: number): number {
    return min + this.next(streamId) * (max - min);
  }

  intRange(streamId: string, minInclusive: number, maxInclusive: number): number {
    if (maxInclusive < minInclusive) return minInclusive;
    return minInclusive + Math.floor(this.next(streamId) * (maxInclusive - minInclusive + 1));
  }

  chance(streamId: string, probability: number): boolean {
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return this.next(streamId) < probability;
  }

  weighted<T>(streamId: string, candidates: readonly { weight: number; value: T }[]): T | null {
    const usable = candidates.filter((candidate) => Number.isFinite(candidate.weight) && candidate.weight > 0);
    if (usable.length === 0) return null;
    let total = 0;
    for (const candidate of usable) total += candidate.weight;
    if (total <= 0) return null;
    let roll = this.next(streamId) * total;
    for (const candidate of usable) {
      roll -= candidate.weight;
      if (roll < 0) return candidate.value;
    }
    const last = usable[usable.length - 1];
    return last ? last.value : null;
  }

  decide<T>(request: ProbabilityRequest<T>): ProbabilityDecision<T> {
    this.decisionCounter += 1;
    this.ensureStream(request.streamId);
    const slot = this.streams.get(request.streamId);
    if (slot) slot.decisions += 1;
    const eligible = request.candidates.filter((candidate) => Number.isFinite(candidate.baseWeight) && candidate.baseWeight > 0);
    const evaluated: EvaluatedCandidate[] = request.candidates.map((candidate) => ({
      id: candidate.id,
      baseWeight: candidate.baseWeight,
      finalWeight: candidate.baseWeight,
      probability: 0,
      modifiers: [],
      eligible: candidate.baseWeight > 0,
      rejectionReason: candidate.baseWeight > 0 ? null : 'non-positive weight',
    }));
    let totalWeight = 0;
    for (const candidate of eligible) totalWeight += candidate.baseWeight;
    let selectedOptionId: string | null = null;
    let selectedResult: T | null = null;
    if (eligible.length > 0 && totalWeight > 0) {
      let roll = this.next(request.streamId) * totalWeight;
      for (const candidate of eligible) {
        roll -= candidate.baseWeight;
        if (roll < 0) {
          selectedOptionId = candidate.id;
          selectedResult = candidate.result;
          break;
        }
      }
      if (!selectedResult) {
        const fallback = eligible[eligible.length - 1];
        if (fallback) {
          selectedOptionId = fallback.id;
          selectedResult = fallback.result;
        }
      }
      for (const candidate of evaluated) {
        candidate.probability = candidate.eligible ? candidate.baseWeight / totalWeight : 0;
      }
    }
    const decision: ProbabilityDecision<T> = {
      decisionId: 'dec_' + this.decisionCounter,
      streamId: request.streamId,
      decisionType: request.decisionType,
      context: request.context,
      candidates: evaluated,
      selectedOptionId,
      selectedResult,
      totalWeight,
      timestamp: request.context.simulationTime,
    };
    this.history.push({
      decisionId: decision.decisionId,
      streamId: decision.streamId,
      decisionType: decision.decisionType,
      context: decision.context,
      candidates: evaluated,
      selectedOptionId,
      timestamp: decision.timestamp,
    });
    if (this.history.length > 5000) this.history.splice(0, this.history.length - 5000);
    return decision;
  }

  getHistory(limit?: number): ProbabilityDecisionRecord[] {
    if (!limit || limit <= 0) return this.history.slice();
    return this.history.slice(-limit);
  }

  getHistoryForDecision(decisionId: string): ProbabilityDecisionRecord | undefined {
    return this.history.find((record) => record.decisionId === decisionId);
  }

  getStats(streamId: string): ProbabilityStreamStats {
    this.ensureStream(streamId);
    const slot = this.streams.get(streamId);
    return {
      streamId,
      draws: slot?.draws ?? 0,
      decisions: slot?.decisions ?? 0,
      lastValue: slot?.lastValue ?? 0,
    };
  }

  replayDecision(decisionId: string): ProbabilityDecisionRecord | null {
    return this.getHistoryForDecision(decisionId) ?? null;
  }

  evaluateConditions(conditions: readonly ConditionExpr[], context: ProbabilityContext): boolean {
    return conditions.every((condition) => this.evaluateCondition(condition, context));
  }

  private evaluateCondition(condition: ConditionExpr, context: ProbabilityContext): boolean {
    switch (condition.op) {
      case 'and':
        return condition.args.every((arg) => this.evaluateCondition(arg, context));
      case 'or':
        return condition.args.some((arg) => this.evaluateCondition(arg, context));
      case 'not':
        return !this.evaluateCondition(condition.arg, context);
      case 'always':
        return true;
      case 'never':
        return false;
      case 'flag':
        return Boolean(resolvePath(context, condition.path)) === condition.equals;
      case 'contains': {
        const value = resolvePath(context, condition.path);
        if (Array.isArray(value)) return value.includes(condition.value);
        if (typeof value === 'string' && typeof condition.value === 'string') return value.includes(condition.value);
        return false;
      }
      case 'cmp': {
        const left = resolvePath(context, condition.path);
        switch (condition.cmp) {
          case 'eq':
            return left === condition.value;
          case 'ne':
            return left !== condition.value;
          case 'gt':
            return typeof left === 'number' && typeof condition.value === 'number' && left > condition.value;
          case 'gte':
            return typeof left === 'number' && typeof condition.value === 'number' && left >= condition.value;
          case 'lt':
            return typeof left === 'number' && typeof condition.value === 'number' && left < condition.value;
          case 'lte':
            return typeof left === 'number' && typeof condition.value === 'number' && left <= condition.value;
          default:
            return false;
        }
      }
      default:
        return false;
    }
  }

  exportState(): ProbabilityPersistState {
    const streams: Record<string, number[]> = {};
    for (const [streamId, slot] of this.streams) streams[streamId] = [slot.state, slot.draws, slot.decisions];
    return {
      version: 1,
      seed: this.seed,
      streams,
      decisionCount: this.decisionCounter,
      history: this.history.slice(-200),
      traceCounter: this.traceCounter,
    };
  }

  importState(state: ProbabilityPersistState): void {
    this.seed = state.seed >>> 0;
    this.streams.clear();
    for (const [streamId, values] of Object.entries(state.streams)) {
      this.streams.set(streamId, {
        state: (values[0] ?? 0) >>> 0,
        draws: values[1] ?? 0,
        decisions: values[2] ?? 0,
        lastValue: 0,
      });
    }
    this.history = state.history.slice();
    this.decisionCounter = state.decisionCount;
    this.traceCounter = state.traceCounter;
  }

  simulate<T>(request: ProbabilityRequest<T>, samples: number): Record<string, number> {
    const counts: Record<string, number> = {};
    const snapshot = this.exportState();
    try {
      for (let index = 0; index < Math.max(0, Math.floor(samples)); index += 1) {
        const decision = this.decide(request);
        const key = decision.selectedOptionId ?? 'none';
        counts[key] = (counts[key] ?? 0) + 1;
      }
    } finally {
      this.importState(snapshot);
    }
    return counts;
  }

  /** Test helper: force deterministic forced outcomes for a stream (used sparingly). */
  forceRoll(streamId: string, value: number): void {
    this.ensureStream(streamId);
    const slot = this.streams.get(streamId);
    if (slot) slot.lastValue = value;
  }
}

function resolvePath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// =============================================================================
// Test skill system
// =============================================================================
export class NatureTestSkillSystem implements ISkillSystem {
  readonly id = 'skill';
  readonly calls: { skill: SkillId; amount: number; source: string }[] = [];
  private ctx!: IGameContext;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
  }

  update(): void {
    // no-op
  }

  addXp(skill: SkillId, amount: number, source: string): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.calls.push({ skill, amount, source });
    const progress = this.ctx.state.player.skills[skill];
    if (!progress) return;
    progress.totalXp += amount;
    progress.xp += amount;
    progress.uses += 1;
    while (progress.level < 20 && progress.xp >= progress.xpToNext) {
      progress.xp -= progress.xpToNext;
      progress.level += 1;
      progress.xpToNext = Math.round(progress.xpToNext * 1.18);
    }
  }

  getProgress(skill: SkillId) {
    return this.ctx.state.player.skills[skill]!;
  }

  getLevel(skill: SkillId): number {
    return this.getProgress(skill).level;
  }

  canUse(skill: SkillId, level: number): boolean {
    return this.getLevel(skill) >= level;
  }

  /** Test helper: override a skill level without grinding xp. */
  setLevel(skill: SkillId, level: number): void {
    const progress = this.ctx.state.player.skills[skill];
    if (!progress) return;
    progress.level = level;
    progress.xp = 0;
    progress.totalXp = 0;
    progress.uses = 1;
  }
}

// =============================================================================
// Test world system
// =============================================================================
export class NatureTestWorldSystem implements IWorldSystem {
  readonly id = 'world';
  private ctx!: IGameContext;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
  }

  update(): void {
    // no-op - tests set the environment directly
  }

  getRegion(id: string): RegionState | undefined {
    return this.ctx.state.world.regions[id as keyof typeof this.ctx.state.world.regions];
  }

  getLocation(id: string): LocationState | undefined {
    return this.ctx.state.world.locations[id];
  }

  getLocationDef(id: string) {
    return this.ctx.content.getLocation(id);
  }

  getLocationsInRegion(regionId: string): LocationState[] {
    return Object.values(this.ctx.state.world.locations).filter((location) => location.regionId === regionId);
  }

  getAllLocations(): LocationState[] {
    return Object.values(this.ctx.state.world.locations);
  }

  getMicroclimate(locationId: string): MicroclimateState {
    const location = this.ctx.content.getLocation(locationId);
    return (
      this.ctx.state.world.locations[locationId]?.microclimate ?? {
        indoor: location?.indoor ?? false,
        shelter: location?.shelter ?? 0,
        windExposure: location?.windExposure ?? 0,
        humidityModifier: location?.humidityModifier ?? 0,
        heatSource: location?.heatSource ?? false,
      }
    );
  }

  getEnvironment(): EnvironmentState {
    return this.ctx.state.world.environment;
  }

  getTime(): GameTime {
    return this.ctx.clock.time;
  }

  getCurrentLocationId(): string {
    return this.ctx.state.player.position.locationId;
  }

  isIndoor(locationId: string): boolean {
    return this.ctx.content.getLocation(locationId)?.indoor ?? false;
  }

  travelTo(locationId: string): ActionResult {
    const def = this.ctx.content.getLocation(locationId);
    const location = this.ctx.state.world.locations[locationId];
    if (!def || !location) return { ok: false, code: 'not_found', message: 'Unknown location.' };
    if (!location.unlocked) return { ok: false, code: 'locked', message: 'That place is not open to you yet.' };
    this.ctx.state.player.position = {
      regionId: def.regionId,
      locationId,
      x: Math.round((def.widthTiles * 32) / 2),
      y: Math.round((def.heightTiles * 32) / 2),
      indoor: def.indoor,
    };
    location.discovered = true;
    location.visitCount += 1;
    location.lastVisitSimTime = this.ctx.clock.simTimeSeconds;
    return { ok: true, message: 'You arrive at ' + def.name + '.', stateChanged: true };
  }

  discoverLocation(locationId: string): ActionResult {
    const location = this.ctx.state.world.locations[locationId];
    const def = this.ctx.content.getLocation(locationId);
    if (!location || !def) return { ok: false, code: 'not_found', message: 'Unknown location.' };
    if (location.discovered) return { ok: true, message: def.name + ' is already known.', stateChanged: false };
    location.discovered = true;
    return { ok: true, message: 'You have discovered ' + def.name + '.', stateChanged: true };
  }

  unlockLocation(locationId: string): ActionResult {
    const location = this.ctx.state.world.locations[locationId];
    const def = this.ctx.content.getLocation(locationId);
    if (!location || !def) return { ok: false, code: 'not_found', message: 'Unknown location.' };
    if (location.unlocked) return { ok: false, code: 'invalid', message: 'That place is already open.' };
    location.unlocked = true;
    location.discovered = true;
    return { ok: true, message: 'The way to ' + def.name + ' is open.', stateChanged: true };
  }

  getTrainRoutes(): TrainRouteDef[] {
    return [];
  }

  getTrainSchedule(): TrainDepartureInfo[] {
    return [];
  }

  buyTrainTicket(): ActionResult {
    return { ok: false, code: 'unsupported', message: 'Trains are not needed in this test.' };
  }

  boardTrain(): ActionResult {
    return { ok: false, code: 'unsupported', message: 'Trains are not needed in this test.' };
  }

  getUnlockedTravelDestinations(): string[] {
    return Object.values(this.ctx.state.world.locations)
      .filter((location) => location.unlocked)
      .map((location) => location.id);
  }
}

// =============================================================================
// Synthetic content so the nature tests do not depend on other agents' data
// =============================================================================
function makeTool(id: string, name: string, skill: SkillId, tier: number): ItemDef {
  return {
    id,
    name,
    description: name + ' (test fixture).',
    category: 'tool',
    basePrice: 500,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: ['tool', 'test_fixture'],
    toolSkill: skill,
    toolTier: tier,
    visual: { shape: 'tool', color: '#7a7a8a', accent: '#c8c8d8' },
  };
}

function makeSimpleItem(id: string, name: string, category: ItemCategory, shape: ItemShape, tags: string[]): ItemDef {
  return {
    id,
    name,
    description: name + ' (test fixture).',
    category,
    basePrice: 100,
    stackable: true,
    maxStack: 99,
    hasQuality: false,
    tags,
    visual: { shape, color: '#8a8a9a', accent: '#c8c8d8' },
  };
}

const SYNTHETIC_ITEMS: readonly ItemDef[] = [
  makeTool(ITEM.hoe, 'Hoe', 'gardening', 1),
  makeTool(ITEM.wateringCan, 'Watering Can', 'gardening', 1),
  makeTool(ITEM.wateringCanLarge, 'Large Watering Can', 'gardening', 2),
  makeTool(ITEM.camera, 'Camera', 'art', 1),
  makeTool(ITEM.fishingRodBasic, 'Basic Fishing Rod', 'fishing', 1),
  makeTool(ITEM.fishingRodGood, 'Good Fishing Rod', 'fishing', 2),
  makeTool(ITEM.fishingRodMaster, 'Master Fishing Rod', 'fishing', 3),
  makeSimpleItem(ITEM.greenhouseKit, 'Greenhouse Kit', 'misc', 'furniture', ['building_material']),
  makeSimpleItem(ITEM.glass, 'Glass', 'material', 'gem', ['material', 'glass']),
  makeSimpleItem(ITEM.compost, 'Compost', 'material', 'circle', ['material', 'fertiliser']),
  makeSimpleItem(ITEM.cigaretteAsh, 'Cigarette Ash', 'material', 'ash', ['material', 'ash', 'fertiliser']),
  makeSimpleItem('test_bait', 'Worms', 'misc', 'circle', ['bait', 'bait_worm']),
  makeSimpleItem('test_lure', 'Moon Lure', 'misc', 'gem', ['bait', 'bait_moon']),
];

interface LocationOverrides {
  regionId?: 'willowbrook' | 'ashford';
  indoor?: boolean;
  connections?: string[];
  facilities?: FacilityKind[];
  forageTags?: string[];
  eventTags?: string[];
  secret?: boolean;
  clueRequirement?: number;
  widthTiles?: number;
  heightTiles?: number;
  fishSpot?: { waterType: 'river' | 'lake' | 'stream' | 'pond' | 'canal'; quality: number };
  entranceFrom?: string;
  shelter?: number;
  windExposure?: number;
}

function makeLocation(id: string, name: string, kind: LocationKind, mapX: number, mapY: number, overrides: LocationOverrides = {}): LocationDef {
  const def: LocationDef = {
    id,
    name,
    regionId: overrides.regionId ?? 'willowbrook',
    kind,
    description: name + ' (test fixture).',
    indoor: overrides.indoor ?? false,
    mapX,
    mapY,
    widthTiles: overrides.widthTiles ?? 20,
    heightTiles: overrides.heightTiles ?? 20,
    connections: overrides.connections ?? [],
    shelter: overrides.shelter ?? 0.2,
    windExposure: overrides.windExposure ?? 0.4,
    humidityModifier: 0,
    heatSource: false,
    openHour: 0,
    closeHour: 24,
    facilities: overrides.facilities ?? [],
    eventTags: overrides.eventTags ?? [],
    forageTags: overrides.forageTags ?? [],
    discoverable: true,
    secret: overrides.secret ?? false,
    theme: 'farm',
    visual: { shape: 'rect', color: '#9a8a6a', accent: '#5a4a3a' },
    floorColor: '#c8b898',
    accentColor: '#6a5a3a',
  };
  if (overrides.fishSpot) def.fishSpot = { ...overrides.fishSpot };
  if (overrides.clueRequirement !== undefined) def.clueRequirement = overrides.clueRequirement;
  if (overrides.entranceFrom) def.entranceFrom = overrides.entranceFrom;
  def.theme =
    kind === 'river' || kind === 'lake'
      ? 'water'
      : kind === 'forest'
        ? 'forest'
        : kind === 'countryside' || kind === 'orchard' || kind === 'farm'
          ? 'countryside'
          : kind === 'greenhouse'
            ? 'farm'
            : 'town';
  return def;
}

const SYNTHETIC_LOCATIONS: readonly LocationDef[] = [
  makeLocation(LOC.center, 'Willowbrook Centre', 'town_center', 10, 10, {
    connections: [LOC.home, LOC.farm, LOC.park, LOC.river, LOC.countryside, LOC.market],
    facilities: ['noticeboard'],
    eventTags: ['town'],
  }),
  makeLocation(LOC.home, 'Cigarette Home', 'residence', 4, 10, {
    connections: [LOC.center],
    widthTiles: 16,
    heightTiles: 12,
  }),
  makeLocation(LOC.market, 'Market Stall', 'market', 12, 8, {
    connections: [LOC.center, LOC.plaza],
    facilities: ['shop_counter'],
    eventTags: ['market'],
  }),
  makeLocation(LOC.plaza, 'Village Plaza', 'plaza', 12, 12, {
    connections: [LOC.market],
    eventTags: ['festival'],
  }),
  makeLocation(LOC.farm, 'Willowbrook Farm', 'farm', 2, 4, {
    connections: [LOC.center, LOC.orchard, LOC.greenhouse, LOC.countryside],
    facilities: ['farmland'],
    widthTiles: 24,
    heightTiles: 18,
    shelter: 0.1,
    windExposure: 0.7,
  }),
  makeLocation(LOC.orchard, 'Willowbrook Orchard', 'orchard', 0, 2, {
    connections: [LOC.farm, LOC.forest],
    facilities: ['farmland', 'forage'],
    forageTags: ['fruit'],
    widthTiles: 20,
    heightTiles: 16,
  }),
  makeLocation(LOC.greenhouse, 'Old Greenhouse', 'greenhouse', 1, 1, {
    connections: [LOC.farm],
    facilities: ['greenhouse', 'forage'],
    widthTiles: 12,
    heightTiles: 10,
  }),
  makeLocation(LOC.countryside, 'Countryside', 'countryside', -2, 6, {
    connections: [LOC.center, LOC.farm, LOC.forest, LOC.abandonedFarmhouse, LOC.warehouse],
    facilities: ['forage'],
    forageTags: ['wild'],
    widthTiles: 24,
    heightTiles: 20,
    windExposure: 0.8,
  }),
  makeLocation(LOC.forest, 'Willowbrook Forest', 'forest', -4, 8, {
    connections: [LOC.countryside, LOC.orchard, LOC.hiddenGarden, LOC.secretPath],
    facilities: ['forage'],
    forageTags: ['wild', 'mushroom'],
    eventTags: ['mysterious', 'history', 'nature'],
    widthTiles: 24,
    heightTiles: 24,
    shelter: 0.7,
  }),
  makeLocation(LOC.park, 'Willowbrook Park', 'park', 14, 6, {
    connections: [LOC.center],
    facilities: ['forage'],
    forageTags: ['wild'],
    eventTags: ['nature', 'scenic'],
    widthTiles: 20,
    heightTiles: 16,
  }),
  makeLocation(LOC.river, 'Willowbrook River', 'river', 16, 12, {
    connections: [LOC.center, LOC.lake],
    facilities: ['fishing_spot', 'forage'],
    forageTags: ['wild'],
    fishSpot: { waterType: 'river', quality: 0.85 },
    windExposure: 0.6,
  }),
  makeLocation(LOC.lake, 'Willowbrook Lake', 'lake', 18, 16, {
    connections: [LOC.river],
    facilities: ['fishing_spot', 'forage'],
    forageTags: ['wild'],
    fishSpot: { waterType: 'lake', quality: 0.9 },
  }),
  makeLocation(LOC.riversideWalk, 'Ashford Riverside Walk', 'riverside_walk', 30, 10, {
    regionId: 'ashford',
    connections: [],
    facilities: ['fishing_spot'],
    fishSpot: { waterType: 'canal', quality: 0.7 },
  }),
  makeLocation(LOC.abandonedFarmhouse, 'Abandoned Farmhouse', 'abandoned_farmhouse', -6, 12, {
    connections: [LOC.countryside],
    facilities: ['forage'],
    forageTags: ['wild'],
    eventTags: ['history', 'mysterious'],
    widthTiles: 14,
    heightTiles: 14,
  }),
  makeLocation(LOC.warehouse, 'Old Warehouse', 'warehouse', 0, 14, {
    connections: [LOC.countryside],
    facilities: ['storage'],
    eventTags: ['history'],
  }),
  makeLocation(LOC.hiddenGarden, 'Hidden Garden', 'hidden_garden', -5, 10, {
    connections: [LOC.forest],
    facilities: ['forage'],
    forageTags: ['garden'],
    eventTags: ['romance', 'mysterious'],
    secret: true,
    clueRequirement: 3,
    entranceFrom: LOC.forest,
  }),
  makeLocation(LOC.secretPath, 'Secret Path', 'secret_path', -3, 10, {
    connections: [LOC.forest],
    secret: true,
    clueRequirement: 2,
    entranceFrom: LOC.forest,
  }),
];

/** Content pack: the real CONTENT_PACK plus synthetic tools/locations when missing/needed. */
export function buildNatureTestPack(): ContentPack {
  const itemMap = new Map<string, ItemDef>();
  for (const item of CONTENT_PACK.items) if (!itemMap.has(item.id)) itemMap.set(item.id, item);
  for (const item of SYNTHETIC_ITEMS) if (!itemMap.has(item.id)) itemMap.set(item.id, item);
  const locationMap = new Map<string, LocationDef>();
  for (const location of CONTENT_PACK.locations) if (!locationMap.has(location.id)) locationMap.set(location.id, location);
  // Always replace our fixture locations so the nature tests are independent of the world agent's in-progress data.
  for (const location of SYNTHETIC_LOCATIONS) locationMap.set(location.id, location);
  return {
    ...CONTENT_PACK,
    items: Array.from(itemMap.values()),
    locations: Array.from(locationMap.values()),
  };
}

// =============================================================================
// Harness
// =============================================================================
export interface NatureHarness {
  seed: number;
  state: GameState;
  content: ContentRegistry;
  probability: NatureTestProbabilityEngine;
  bus: EventBus;
  clock: Clock;
  registry: SystemRegistry;
  logger: MemoryLogger;
  ctx: IGameContext;
  farming: FarmingSystem;
  foraging: ForagingSystem;
  fishing: FishingSystem;
  exploration: ExplorationSystem;
  skill: NatureTestSkillSystem;
  world: NatureTestWorldSystem;
}

export interface NatureHarnessOptions {
  seed?: number;
  playerMoney?: number;
}

export function createNatureHarness(options: NatureHarnessOptions = {}): NatureHarness {
  const seed = options.seed ?? 12345;
  const pack = buildNatureTestPack();
  const content = new ContentRegistry(pack);
  const state = createInitialGameState({
    seed,
    playerName: 'Ash',
    appearance: { ...DEFAULT_APPEARANCE },
    content,
  });
  if (options.playerMoney !== undefined) state.player.money = options.playerMoney;
  const clock = new Clock(state.clock);
  const bus = new EventBus();
  const probability = new NatureTestProbabilityEngine();
  probability.init(seed, state.probability);
  const logger = new MemoryLogger();
  const registry = new SystemRegistry(bus);
  const world = new NatureTestWorldSystem();
  const skill = new NatureTestSkillSystem();
  const farming = new FarmingSystem();
  const foraging = new ForagingSystem();
  const fishing = new FishingSystem();
  const exploration = new ExplorationSystem();
  registry.register(world);
  registry.register(skill);
  registry.register(farming);
  registry.register(foraging);
  registry.register(fishing);
  registry.register(exploration);
  const rng = new RngFacade(probability);
  const ctx = createGameContext({ state, content, probability, bus, clock, registry, rng, logger });
  registry.initAll(ctx);
  return { seed, state, content, probability, bus, clock, registry, logger, ctx, farming, foraging, fishing, exploration, skill, world };
}

// ---------------------------------------------------------------- utilities
export function teleport(h: NatureHarness, locationId: string): void {
  const def = h.content.getLocation(locationId);
  h.state.player.position = {
    regionId: def?.regionId ?? 'willowbrook',
    locationId,
    x: 32,
    y: 32,
    indoor: def?.indoor ?? false,
  };
}

export function giveItem(h: NatureHarness, itemId: string, quantity = 1, quality: QualityStars = 1): void {
  const def = h.content.getItem(itemId);
  addItemToInventory(h.state.player.inventory, itemId, quantity, {
    quality,
    freshness: 1,
    simTime: h.clock.simTimeSeconds,
    maxStack: def?.maxStack ?? 99,
  });
}

export function itemCount(h: NatureHarness, itemId: string): number {
  return countItem(h.state.player.inventory, itemId);
}

export interface GameTimeOptions {
  seasonIndex?: number;
  dayOfSeason?: number;
  hour?: number;
  minute?: number;
  weather?: WeatherType;
  temperature?: number;
  humidity?: number;
  rainIntensity?: number;
  windSpeed?: number;
}

/** Sets the clock and mirrors the world environment the nature systems read. */
export function setGameTime(h: NatureHarness, options: GameTimeOptions = {}): void {
  const seasonIndex = options.seasonIndex ?? 0;
  const season: Season = SEASONS[seasonIndex] ?? 'spring';
  const hour = options.hour ?? 12;
  const minute = options.minute ?? 0;
  const dayOfSeason = options.dayOfSeason ?? 5;
  h.clock.setSimTimeSeconds(gameTimeToSimSeconds({ year: 1, seasonIndex, dayOfSeason, hour, minute }));
  const env = h.state.world.environment;
  env.season = season;
  env.seasonIndex = seasonIndex;
  env.dayOfSeason = dayOfSeason;
  env.year = 1;
  env.weather = options.weather ?? 'clear';
  env.temperature = options.temperature ?? 16;
  env.humidity = options.humidity ?? 0.45;
  env.rainIntensity = options.rainIntensity ?? 0;
  env.windSpeed = options.windSpeed ?? 0.1;
}

/** Advances the clock in fixed sub-steps, updating every registered system each step. */
export function advanceSim(h: NatureHarness, seconds: number, stepSeconds = 1): void {
  let remaining = Math.max(0, seconds);
  const step = Math.max(0.01, stepSeconds);
  let guard = 0;
  while (remaining > 1e-9 && guard < 200000) {
    guard += 1;
    const delta = Math.min(step, remaining);
    h.clock.advanceSimSeconds(delta);
    h.registry.updateAll(delta);
    remaining -= delta;
  }
}

/** Advances the clock by a single very large delta (offline catch-up style). */
export function advanceOneBigStep(h: NatureHarness, seconds: number): void {
  h.clock.advanceSimSeconds(seconds);
  h.registry.updateAll(seconds);
}

/** Finds the materialised forage node state for a definition id. */
export function findForageNode(h: NatureHarness, defId: string) {
  return Object.values(h.state.foraging.nodes).find((node) => node.defId === defId);
}

/** Collects bus payloads for the given topics into an array. */
export function recordEvents(h: NatureHarness, topics: readonly GameEventTopic[]): { topic: GameEventTopic; payload: unknown }[] {
  const captured: { topic: GameEventTopic; payload: unknown }[] = [];
  for (const topic of topics) {
    h.bus.on(topic, (payload) => {
      captured.push({ topic, payload });
    });
  }
  return captured;
}