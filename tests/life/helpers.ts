import type {
  EnvironmentState,
  GameEventMap,
  GameEventTopic,
  IGameContext,
  IProbabilityEngine,
  ISystem,
  IWorldSystem,
  MicroclimateState,
  ProbabilityDecision,
  ProbabilityDecisionRecord,
  ProbabilityPersistState,
  ProbabilityRequest,
  ProbabilityStreamStats,
  RelationshipState,
  ActionResult,
  GameState,
  TrainDepartureInfo,
} from '../../src/core/contracts';
import type { ConditionExpr, ProbabilityContext } from '../../src/core/contracts';
import type {
  ContentPack,
  FishDef,
  ItemDef,
  LocationDef,
  TrainRouteDef,
} from '../../src/data/schema';
import type {
  EquipmentSlot,
  GameTime,
  JsonValue,
  LocationId,
  QualityStars,
  SkillId,
  WeatherType,
} from '../../src/core/SharedTypes';
import { simSecondsToGameTime } from '../../src/core/TimeUtil';
import { makeId } from '../../src/core/utils';
import { Clock } from '../../src/core/Clock';
import { ConsoleLogger } from '../../src/core/GameLogger';
import { ContentRegistry } from '../../src/core/ContentRegistry';
import { EventBus } from '../../src/core/EventBus';
import { RngFacade, createGameContext } from '../../src/core/GameContext';
import { SystemRegistry } from '../../src/core/SystemRegistry';
import { DEFAULT_APPEARANCE, createInitialGameState } from '../../src/core/WorldFactory';
import { WEATHER_PROFILES } from '../../src/core/WorldConfig';
import { addItemToInventory, removeItemFromInventory } from '../../src/core/InventoryUtil';
import { HOME_INTERIOR_ID, LOC, interiorIdFor } from '../../src/data/locations/ids';
import { LIFE_ITEMS } from '../../src/data/items/life';
import { ACHIEVEMENTS } from '../../src/data/achievements/achievements';
import { PLAYER_GOALS } from '../../src/data/goals/goals';
import { LifeSystem } from '../../src/life/LifeSystem';
import { readLifeExtras, writeLifeExtras } from '../../src/life/lifeShared';

// ---------------------------------------------------------------------------
// Deterministic probability engine test double (the real engine is another agent's
// module; the life domain only needs ensureStream/chance/intRange for its own streams).
// ---------------------------------------------------------------------------
function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolvePath(context: ProbabilityContext, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = context;
  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function compareValues(actual: unknown, expected: JsonValue, cmp: string): boolean {
  if (cmp === 'eq') return actual === expected || String(actual) === String(expected);
  if (cmp === 'ne') return !(actual === expected || String(actual) === String(expected));
  const left = typeof actual === 'number' ? actual : Number(actual);
  const right = typeof expected === 'number' ? expected : Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  switch (cmp) {
    case 'gt': return left > right;
    case 'gte': return left >= right;
    case 'lt': return left < right;
    case 'lte': return left <= right;
    default: return false;
  }
}

function evaluateCondition(condition: ConditionExpr, context: ProbabilityContext): boolean {
  switch (condition.op) {
    case 'and': return condition.args.every((arg) => evaluateCondition(arg, context));
    case 'or': return condition.args.some((arg) => evaluateCondition(arg, context));
    case 'not': return !evaluateCondition(condition.arg, context);
    case 'cmp': return compareValues(resolvePath(context, condition.path), condition.value, condition.cmp);
    case 'flag': {
      const value = resolvePath(context, condition.path);
      return (value === true) === condition.equals;
    }
    case 'contains': {
      const value = resolvePath(context, condition.path);
      if (Array.isArray(value)) return value.includes(condition.value);
      if (typeof value === 'string') return value.includes(String(condition.value));
      return false;
    }
    case 'always': return true;
    case 'never': return false;
    default: return false;
  }
}

export class StubProbabilityEngine implements IProbabilityEngine {
  private initialSeed = 1;
  private readonly streamStates = new Map<string, number>();
  private history: ProbabilityDecisionRecord[] = [];
  private decisionCount = 0;
  private traceCounter = 0;

  get seed(): number {
    return this.initialSeed;
  }

  init(seed: number, persisted?: ProbabilityPersistState): void {
    this.initialSeed = seed >>> 0;
    this.streamStates.clear();
    this.history = [];
    this.decisionCount = 0;
    if (persisted) {
      this.initialSeed = persisted.seed >>> 0;
      for (const [streamId, state] of Object.entries(persisted.streams)) {
        const first = state[0];
        if (typeof first === 'number') this.streamStates.set(streamId, first >>> 0);
      }
      this.decisionCount = persisted.decisionCount;
      this.traceCounter = persisted.traceCounter;
    }
  }

  ensureStream(streamId: string): void {
    if (!this.streamStates.has(streamId)) {
      this.streamStates.set(streamId, hashString(this.initialSeed + ':' + streamId) || 0x9e3779b9);
    }
  }

  hasStream(streamId: string): boolean {
    return this.streamStates.has(streamId);
  }

  listStreams(): string[] {
    return [...this.streamStates.keys()];
  }

  private nextState(streamId: string): number {
    this.ensureStream(streamId);
    let state = this.streamStates.get(streamId) ?? 0x9e3779b9;
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    this.streamStates.set(streamId, state);
    return state;
  }

  roll(streamId: string): number {
    return this.nextState(streamId) / 4294967296;
  }

  floatRange(streamId: string, min: number, max: number): number {
    return min + this.roll(streamId) * (max - min);
  }

  intRange(streamId: string, minInclusive: number, maxInclusive: number): number {
    if (maxInclusive < minInclusive) return minInclusive;
    const span = maxInclusive - minInclusive + 1;
    return minInclusive + Math.min(span - 1, Math.floor(this.roll(streamId) * span));
  }

  chance(streamId: string, probability: number): boolean {
    return this.roll(streamId) < probability;
  }

  weighted<T>(streamId: string, candidates: readonly { weight: number; value: T }[]): T | null {
    const eligible = candidates.filter((candidate) => candidate.weight > 0);
    if (eligible.length === 0) return null;
    const total = eligible.reduce((sum, candidate) => sum + candidate.weight, 0);
    let draw = this.roll(streamId) * total;
    for (const candidate of eligible) {
      draw -= candidate.weight;
      if (draw < 0) return candidate.value;
    }
    return eligible[eligible.length - 1]?.value ?? null;
  }

  decide<T>(request: ProbabilityRequest<T>): ProbabilityDecision<T> {
    const eligible = request.candidates.filter(
      (candidate) =>
        candidate.baseWeight > 0 &&
        (candidate.conditions ?? []).every((condition) => evaluateCondition(condition, request.context))
    );
    const chosen = this.weighted(
      request.streamId,
      eligible.map((candidate) => ({ weight: candidate.baseWeight, value: candidate }))
    );
    this.decisionCount += 1;
    this.traceCounter += 1;
    const decisionId = 'stub-decision-' + this.traceCounter;
    const decision: ProbabilityDecision<T> = {
      decisionId,
      streamId: request.streamId,
      decisionType: request.decisionType,
      context: request.context,
      candidates: request.candidates.map((candidate) => ({
        id: candidate.id,
        baseWeight: candidate.baseWeight,
        finalWeight: candidate.baseWeight,
        probability: 0,
        modifiers: [],
        eligible: eligible.includes(candidate),
        rejectionReason: eligible.includes(candidate) ? null : 'filtered',
      })),
      selectedOptionId: chosen?.id ?? null,
      selectedResult: chosen?.result ?? null,
      totalWeight: eligible.reduce((sum, candidate) => sum + candidate.baseWeight, 0),
      timestamp: request.context.simulationTime,
    };
    this.history.push({
      decisionId,
      streamId: decision.streamId,
      decisionType: decision.decisionType,
      context: decision.context,
      candidates: decision.candidates,
      selectedOptionId: decision.selectedOptionId,
      timestamp: decision.timestamp,
    });
    return decision;
  }

  getHistory(limit = 100): ProbabilityDecisionRecord[] {
    return this.history.slice(Math.max(0, this.history.length - limit));
  }

  getHistoryForDecision(decisionId: string): ProbabilityDecisionRecord | undefined {
    return this.history.find((record) => record.decisionId === decisionId);
  }

  getStats(streamId: string): ProbabilityStreamStats {
    return {
      streamId,
      draws: 0,
      decisions: this.history.filter((record) => record.streamId === streamId).length,
      lastValue: 0,
    };
  }

  replayDecision(decisionId: string): ProbabilityDecisionRecord | null {
    return this.getHistoryForDecision(decisionId) ?? null;
  }

  evaluateConditions(conditions: readonly ConditionExpr[], context: ProbabilityContext): boolean {
    return conditions.every((condition) => evaluateCondition(condition, context));
  }

  exportState(): ProbabilityPersistState {
    const streams: Record<string, number[]> = {};
    for (const [streamId, state] of this.streamStates) streams[streamId] = [state];
    return {
      version: 1,
      seed: this.initialSeed,
      streams,
      decisionCount: this.decisionCount,
      history: this.history.slice(-100),
      traceCounter: this.traceCounter,
    };
  }

  importState(state: ProbabilityPersistState): void {
    this.init(state.seed, state);
  }

  simulate<T>(request: ProbabilityRequest<T>, samples: number): Record<string, number> {
    const counts: Record<string, number> = {};
    for (let index = 0; index < samples; index += 1) {
      const decision = this.decide(request);
      const key = decision.selectedOptionId ?? 'none';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }
}

// ---------------------------------------------------------------------------
// Minimal world system stub used to verify the physics microclimate delegation.
// ---------------------------------------------------------------------------
export class StubWorldSystem implements IWorldSystem {
  readonly id = 'world';
  private state: GameState | null = null;
  private microOverride: MicroclimateState | null;

  constructor(microOverride: MicroclimateState | null = null) {
    this.microOverride = microOverride;
  }

  init(ctx: IGameContext): void {
    this.state = ctx.state;
  }

  update(): void {
    // no-op
  }

  private requireState(): GameState {
    if (!this.state) throw new Error('StubWorldSystem not initialised');
    return this.state;
  }

  getRegion(): undefined {
    return undefined;
  }

  getLocation(id: LocationId): GameState['world']['locations'][string] | undefined {
    return this.requireState().world.locations[id];
  }

  getLocationDef(): undefined {
    return undefined;
  }

  getLocationsInRegion(): GameState['world']['locations'][string][] {
    return [];
  }

  getAllLocations(): GameState['world']['locations'][string][] {
    return Object.values(this.requireState().world.locations);
  }

  getMicroclimate(locationId: LocationId): MicroclimateState {
    if (this.microOverride) return this.microOverride;
    const location = this.requireState().world.locations[locationId];
    return (
      location?.microclimate ?? {
        indoor: false,
        shelter: 0,
        windExposure: 1,
        humidityModifier: 0,
        heatSource: false,
      }
    );
  }

  getEnvironment(): EnvironmentState {
    return this.requireState().world.environment;
  }

  getTime(): GameTime {
    return simSecondsToGameTime(this.requireState().clock.simTimeSeconds);
  }

  getCurrentLocationId(): LocationId {
    return this.requireState().player.position.locationId;
  }

  isIndoor(locationId: LocationId): boolean {
    return this.getMicroclimate(locationId).indoor;
  }

  private unsupported(): ActionResult {
    return { ok: false, message: 'Travel is not supported in this test stub.', code: 'unsupported' };
  }

  travelTo(): ActionResult {
    return this.unsupported();
  }

  discoverLocation(): ActionResult {
    return this.unsupported();
  }

  unlockLocation(): ActionResult {
    return this.unsupported();
  }

  getTrainRoutes(): TrainRouteDef[] {
    return [];
  }

  getTrainSchedule(): TrainDepartureInfo[] {
    return [];
  }

  buyTrainTicket(): ActionResult {
    return this.unsupported();
  }

  boardTrain(): ActionResult {
    return this.unsupported();
  }

  getUnlockedTravelDestinations(): LocationId[] {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Content fixtures
// ---------------------------------------------------------------------------
const BASE_LOCATION: Omit<LocationDef, 'id' | 'name' | 'indoor' | 'shelter' | 'windExposure' | 'heatSource' | 'connections'> = {
  regionId: 'willowbrook',
  kind: 'interior',
  description: 'A test location.',
  mapX: 0,
  mapY: 0,
  widthTiles: 12,
  heightTiles: 10,
  humidityModifier: 0,
  openHour: 0,
  closeHour: 24,
  facilities: [],
  eventTags: [],
  forageTags: [],
  discoverable: false,
  secret: false,
  theme: 'indoor',
  visual: { shape: 'rect', color: '#dddddd' },
  floorColor: '#cccccc',
  accentColor: '#999999',
};

export function makeLocationDef(
  overrides: Partial<LocationDef> & { id: LocationId; name: string }
): LocationDef {
  return {
    ...BASE_LOCATION,
    indoor: false,
    shelter: 0,
    windExposure: 0.8,
    heatSource: false,
    connections: [],
    ...overrides,
  } as LocationDef;
}

/** Locations used by the life tests: home, cafe (heat), park (shelter), river (exposed), secret garden. */
export function createTestLocations(): LocationDef[] {
  return [
    makeLocationDef({
      id: HOME_INTERIOR_ID,
      name: 'Willowbrook Home',
      indoor: true,
      shelter: 1,
      windExposure: 0,
      heatSource: true,
      kind: 'interior',
      connections: [LOC.home],
    }),
    makeLocationDef({
      id: LOC.home,
      name: 'Home Cottage',
      indoor: false,
      shelter: 0.5,
      windExposure: 0.4,
      kind: 'residence',
      connections: [HOME_INTERIOR_ID, LOC.center],
    }),
    makeLocationDef({
      id: LOC.center,
      name: 'Willowbrook Centre',
      kind: 'town_center',
      connections: [LOC.home, LOC.cafe, LOC.park, LOC.river, LOC.hiddenGarden],
      shelter: 0.3,
      windExposure: 0.6,
    }),
    makeLocationDef({
      id: interiorIdFor(LOC.cafe),
      name: 'The Willow Cafe',
      indoor: true,
      shelter: 1,
      windExposure: 0,
      heatSource: true,
      kind: 'interior',
      connections: [LOC.cafe],
    }),
    makeLocationDef({
      id: LOC.cafe,
      name: 'Willow Cafe',
      kind: 'cafe',
      connections: [interiorIdFor(LOC.cafe), LOC.center],
      shelter: 0.25,
      windExposure: 0.55,
    }),
    makeLocationDef({
      id: LOC.park,
      name: 'Willow Park',
      kind: 'park',
      connections: [LOC.center],
      shelter: 0.6,
      windExposure: 0.45,
      theme: 'countryside',
    }),
    makeLocationDef({
      id: LOC.river,
      name: 'Willow River',
      kind: 'river',
      connections: [LOC.center],
      shelter: 0,
      windExposure: 1,
      humidityModifier: 0.15,
      theme: 'water',
      fishSpot: { waterType: 'river', quality: 0.7 },
    }),
    makeLocationDef({
      id: LOC.hiddenGarden,
      name: 'Hidden Garden',
      kind: 'hidden_garden',
      connections: [LOC.center],
      secret: true,
      discoverable: true,
      shelter: 0.7,
      windExposure: 0.3,
      theme: 'forest',
    }),
  ];
}

export function makeFishDef(overrides: Partial<FishDef> & { id: string; name: string }): FishDef {
  return {
    description: 'A test fish.',
    habitats: [LOC.river],
    seasons: ['spring', 'summer', 'autumn', 'winter'],
    startHour: 0,
    endHour: 24,
    weathers: ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow', 'wind'],
    weight: 1,
    minSizeCm: 10,
    maxSizeCm: 50,
    difficulty: 2,
    baseValue: 120,
    baitTags: [],
    skillReq: 1,
    rarity: 2,
    visual: { shape: 'fish', color: '#9fb7c9' },
    ...overrides,
  } as FishDef;
}

export function makeItemDef(overrides: Partial<ItemDef> & { id: string; name: string }): ItemDef {
  return {
    description: 'A test item.',
    category: 'collectible',
    basePrice: 100,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: [],
    visual: { shape: 'gem', color: '#ffffff' },
    ...overrides,
  } as ItemDef;
}

export interface TestPackOptions {
  locations?: LocationDef[];
  extraItems?: ItemDef[];
  fish?: FishDef[];
}

export function createTestPack(options: TestPackOptions = {}): ContentPack {
  return {
    items: [...LIFE_ITEMS, ...(options.extraItems ?? [])],
    crops: [],
    fish: options.fish ?? [],
    forageNodes: [],
    recipes: [],
    events: [],
    festivals: [],
    locations: options.locations ?? createTestLocations(),
    trainRoutes: [],
    businesses: [],
    npcs: [],
    dialogueTrees: [],
    furniture: [],
    blueprints: [],
    achievements: ACHIEVEMENTS,
    playerGoals: PLAYER_GOALS,
    communityProposals: [],
    collectionCategories: [],
    weatherTable: { bySeason: { spring: {}, summer: {}, autumn: {}, winter: {} } },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
export interface Harness {
  state: GameState;
  content: ContentRegistry;
  pack: ContentPack;
  bus: EventBus;
  clock: Clock;
  probability: StubProbabilityEngine;
  registry: SystemRegistry;
  ctx: IGameContext;
  life: LifeSystem;
}

export interface HarnessOptions {
  seed?: number;
  pack?: ContentPack;
  playerName?: string;
  /** Optional world system stub registered as 'world'. */
  world?: StubWorldSystem;
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const pack = options.pack ?? createTestPack();
  const content = new ContentRegistry(pack);
  const seed = options.seed ?? 20260101;
  const state = createInitialGameState({
    seed,
    playerName: options.playerName ?? 'Ash',
    appearance: { ...DEFAULT_APPEARANCE },
    content,
  });
  const clock = new Clock(state.clock);
  const bus = new EventBus();
  const probability = new StubProbabilityEngine();
  probability.init(seed);
  const registry = new SystemRegistry(bus);
  if (options.world) registry.register(options.world as ISystem);
  const life = new LifeSystem();
  registry.register(life);
  const rng = new RngFacade(probability);
  const ctx = createGameContext({
    state,
    content,
    probability,
    bus,
    clock,
    registry,
    rng,
    logger: new ConsoleLogger({ minLevel: 'error', prefix: '[life-test]' }),
  });
  registry.initAll(ctx);

  // Deterministic, dry baseline environment.
  state.world.environment.weather = 'clear';
  state.world.environment.rainIntensity = 0;
  state.world.environment.windSpeed = 0;
  state.world.environment.humidity = 0.4;
  state.world.environment.temperature = 15;
  state.player.cigarette.moisture = 0;

  const homeInterior = content.getLocation(HOME_INTERIOR_ID);
  if (homeInterior) {
    state.player.position = {
      regionId: 'willowbrook',
      locationId: HOME_INTERIOR_ID,
      x: 0,
      y: 0,
      indoor: true,
    };
  }

  return { state, content, pack, bus, clock, probability, registry, ctx, life };
}

// ---------------------------------------------------------------------------
// Driving helpers
// ---------------------------------------------------------------------------
export function moveTo(harness: Harness, locationId: LocationId, indoor = false): void {
  const def = harness.content.getLocation(locationId);
  harness.state.player.position = {
    regionId: def?.regionId ?? 'willowbrook',
    locationId,
    x: 0,
    y: 0,
    indoor,
  };
}

export function setEnvironment(harness: Harness, partial: Partial<EnvironmentState>): void {
  Object.assign(harness.state.world.environment, partial);
}

export function setWeather(harness: Harness, weather: WeatherType): void {
  const profile = WEATHER_PROFILES[weather];
  setEnvironment(harness, {
    weather,
    rainIntensity: profile.rainIntensity,
    windSpeed: profile.windSpeedBase,
    humidity: profile.humidityBase,
  });
}

/** Advances the clock then runs one life update, mirroring SimulationRuntime. */
export function advance(harness: Harness, simSeconds: number): void {
  harness.clock.advanceSimSeconds(simSeconds);
  harness.life.update(simSeconds);
}

/** Advances in fixed steps (default one game hour) until the total is reached or life ends. */
export function advanceInSteps(harness: Harness, totalSimSeconds: number, stepSimSeconds = 60): void {
  let remaining = totalSimSeconds;
  while (remaining > 1e-9) {
    if (harness.state.life.phase !== 'alive') return;
    const step = Math.min(stepSimSeconds, remaining);
    advance(harness, step);
    remaining -= step;
  }
}

export function equip(harness: Harness, slot: EquipmentSlot, itemId: string | null): void {
  harness.state.player.equipment[slot] = itemId;
}

export function giveItem(harness: Harness, itemId: string, quantity = 1, quality: QualityStars = 1): void {
  addItemToInventory(harness.state.player.inventory, itemId, quantity, {
    simTime: harness.clock.simTimeSeconds,
    quality,
    maxStack: 99,
  });
}

export function takeItem(harness: Harness, itemId: string, quantity = 1): number {
  return removeItemFromInventory(harness.state.player.inventory, itemId, quantity);
}

export function collectEvents<K extends GameEventTopic>(
  harness: Harness,
  topic: K
): GameEventMap[K][] {
  const received: GameEventMap[K][] = [];
  harness.bus.on(topic, (payload) => received.push(payload));
  return received;
}

export function addRelationship(
  harness: Harness,
  npcId: string,
  status: RelationshipState['status'],
  affinity: number
): RelationshipState {
  const relationship: RelationshipState = {
    otherId: npcId,
    affinity,
    trust: 40,
    intimacy: 30,
    familiarity: 50,
    status,
    firstMetAt: 0,
    lastInteractionAt: 0,
    interactionCount: 1,
    flags: [],
    cooldowns: {},
  };
  harness.state.player.relationships[npcId] = relationship;
  return relationship;
}

export function setSkillLevel(harness: Harness, skill: SkillId, level: number): void {
  const progress = harness.state.player.skills[skill];
  if (progress) progress.level = level;
}

export function setCounters(harness: Harness, mutate: (counters: ReturnType<typeof readLifeExtras>['counters']) => void): void {
  const extras = readLifeExtras(harness.state);
  mutate(extras.counters);
  writeLifeExtras(harness.state, extras);
}

export function advanceToNextHour(harness: Harness): void {
  advanceInSteps(harness, 60, 60);
}

export function randomId(prefix: string): string {
  return makeId(prefix);
}
