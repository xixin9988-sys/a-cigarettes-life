import type {
  IEventBus,
  IGameContext,
  IRngFacade,
  IProbabilityEngine,
  NPCState,
} from '../../src/core/contracts';
import type { ContentPack } from '../../src/data/schema';
import type { LocationId } from '../../src/core/SharedTypes';
import type { GameState } from '../../src/core/contracts';
import { ContentRegistry } from '../../src/core/ContentRegistry';
import { EventBus } from '../../src/core/EventBus';
import { Clock } from '../../src/core/Clock';
import { SystemRegistry } from '../../src/core/SystemRegistry';
import { createGameContext } from '../../src/core/GameContext';
import { MemoryLogger } from '../../src/core/GameLogger';
import { DEFAULT_APPEARANCE, createInitialGameState } from '../../src/core/WorldFactory';
import { LOCATIONS } from '../../src/data/locations/locations';
import { TRAIN_ROUTES } from '../../src/data/transport/routes';
import { WEATHER_TABLE } from '../../src/data/probability/weather';
import { WorldSystem } from '../../src/world/WorldManager';

/**
 * Test fixtures for the world module.
 *
 * The world module is tested against a *minimal local content pack* containing
 * only the data this domain owns (locations, train routes, weather table). That
 * keeps the suite independent of the other agents' in-progress data modules while
 * still exercising the real ContentRegistry/WorldFactory/system stack that the
 * game uses in production.
 */

export const TEST_PACK: ContentPack = {
  items: [],
  crops: [],
  fish: [],
  forageNodes: [],
  recipes: [],
  events: [],
  festivals: [],
  locations: LOCATIONS,
  trainRoutes: TRAIN_ROUTES,
  businesses: [],
  npcs: [],
  dialogueTrees: [],
  furniture: [],
  blueprints: [],
  achievements: [],
  playerGoals: [],
  communityProposals: [],
  collectionCategories: [],
  weatherTable: WEATHER_TABLE,
};

/** Deterministic xorshift32-based IRngFacade used instead of the probability engine. */
export class DeterministicRng implements IRngFacade {
  private readonly states = new Map<string, number>();
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  private stateFor(streamId: string): number {
    const existing = this.states.get(streamId);
    if (existing !== undefined) return existing;
    let hash = (this.seed ^ 0x9e3779b9) >>> 0;
    for (let i = 0; i < streamId.length; i += 1) {
      hash ^= streamId.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const initial = hash === 0 ? 1 : hash;
    this.states.set(streamId, initial);
    return initial;
  }

  private next(streamId: string): number {
    let state = this.stateFor(streamId);
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    this.states.set(streamId, state);
    return state / 0x100000000;
  }

  roll(streamId: string): number {
    return this.next(streamId);
  }

  chance(streamId: string, probability: number): boolean {
    return this.next(streamId) < probability;
  }

  floatRange(streamId: string, min: number, max: number): number {
    return min + this.next(streamId) * (max - min);
  }

  intRange(streamId: string, minInclusive: number, maxInclusive: number): number {
    const low = Math.ceil(minInclusive);
    const high = Math.floor(maxInclusive);
    if (high <= low) return low;
    return low + Math.floor(this.next(streamId) * (high - low + 1));
  }

  weighted<T>(streamId: string, candidates: readonly { weight: number; value: T }[]): T | null {
    let total = 0;
    for (const candidate of candidates) {
      if (candidate.weight > 0) total += candidate.weight;
    }
    if (total <= 0) return null;
    const target = this.next(streamId) * total;
    let accumulated = 0;
    for (const candidate of candidates) {
      if (candidate.weight <= 0) continue;
      accumulated += candidate.weight;
      if (target < accumulated) return candidate.value;
    }
    const last = candidates[candidates.length - 1];
    return last ? last.value : null;
  }

  shuffle<T>(streamId: string, values: readonly T[]): T[] {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = this.intRange(streamId, 0, i);
      const a = result[i];
      const b = result[j];
      if (a !== undefined && b !== undefined) {
        result[i] = b;
        result[j] = a;
      }
    }
    return result;
  }
}

export interface CapturedEvent {
  topic: string;
  payload: unknown;
}

export interface WorldTestBed {
  content: ContentRegistry;
  state: GameState;
  bus: EventBus;
  clock: Clock;
  registry: SystemRegistry;
  logger: MemoryLogger;
  rng: DeterministicRng;
  ctx: IGameContext;
  world: WorldSystem;
  captured: CapturedEvent[];
  eventsFor(topic: string): unknown[];
}

export interface WorldTestBedOptions {
  seed?: number;
  playerName?: string;
}

/**
 * Builds a headless world with the real ContentRegistry, GameState factory,
 * EventBus, Clock and SystemRegistry. The probability engine is not needed by
 * the world module (all of its randomness goes through ctx.rng with
 * 'world.weather' / 'world.environment' stream ids), so the context is built
 * with a deterministic rng facade and no probability engine.
 */
export function createWorldTestBed(options: WorldTestBedOptions = {}): WorldTestBed {
  const seed = options.seed ?? 1234567;
  const content = new ContentRegistry(TEST_PACK);
  const state = createInitialGameState({
    seed,
    playerName: options.playerName ?? 'Ash',
    appearance: DEFAULT_APPEARANCE,
    content,
  });
  const bus = new EventBus();
  const clock = new Clock(state.clock);
  const registry = new SystemRegistry(bus);
  const logger = new MemoryLogger();
  const rng = new DeterministicRng(seed);
  const captured: CapturedEvent[] = [];

  const capture = (topic: string): void => {
    bus.on(topic as never, (payload: never) => {
      captured.push({ topic, payload });
    });
  };
  for (const topic of [
    'weather:changed',
    'location:changed',
    'discovery:made',
    'time:season',
    'money:changed',
    'item:acquired',
  ]) {
    capture(topic);
  }

  const probability = null as unknown as IProbabilityEngine;
  const ctx = createGameContext({
    state,
    content,
    probability,
    bus,
    clock,
    registry,
    rng,
    logger,
  });

  const world = new WorldSystem();
  registry.register(world);
  world.init(ctx);

  const eventsFor = (topic: string): unknown[] => captured.filter((event) => event.topic === topic).map((event) => event.payload);
  return { content, state, bus, clock, registry, logger, rng, ctx, world, captured, eventsFor };
}

/** Runs the world for a number of in-game hours in one-hour update steps. */
export function advanceGameHours(bed: WorldTestBed, hours: number): void {
  for (let i = 0; i < hours; i += 1) {
    bed.clock.advanceSimSeconds(60);
    bed.world.update(60);
  }
}

/** Advances the clock and runs a single world update. */
export function advanceSimSeconds(bed: WorldTestBed, seconds: number): void {
  bed.clock.advanceSimSeconds(seconds);
  bed.world.update(seconds);
}

/** Moves the player directly (test setup only - production movement goes through travelTo). */
export function placePlayer(bed: WorldTestBed, locationId: LocationId): void {
  const def = bed.content.getLocationOrThrow(locationId);
  bed.state.player.position = {
    regionId: def.regionId,
    locationId,
    x: (def.widthTiles * 32) / 2,
    y: (def.heightTiles * 32) / 2,
    indoor: def.indoor,
  };
}

/** Minimal NPC state fixture; only the fields occupancy/world logic reads matter. */
export function createTestNpc(id: string, locationId: LocationId): NPCState {
  return {
    id,
    name: id,
    age: 30,
    lifeStage: 'adult',
    personality: {
      extroversion: 0.5,
      introversion: 0.5,
      adventure: 0.5,
      caution: 0.5,
      generosity: 0.5,
      curiosity: 0.5,
      socialNeed: 0.5,
      independence: 0.5,
      responsibility: 0.5,
      spendingTendency: 0.5,
      artisticTendency: 0.5,
      workTendency: 0.5,
    },
    appearance: {
      primaryColor: '#ffffff',
      secondaryColor: '#000000',
      hairColor: '#333333',
      skinTone: '#e0c0a0',
      outfitStyle: 'casual',
      accessory: 'none',
      scale: 1,
    },
    needs: {
      hunger: 50,
      energy: 50,
      social: 50,
      fun: 50,
      safety: 50,
      belonging: 50,
      moneyPressure: 50,
      workPressure: 50,
      purpose: 50,
    },
    emotions: { joy: 0.5, sadness: 0.1, anger: 0.1, fear: 0.1, affection: 0.3, stress: 0.2 },
    mood: 0.4,
    money: 1000,
    occupation: null,
    jobId: null,
    homeLocationId: locationId,
    workLocationId: locationId,
    locationId,
    currentActivity: 'strolling',
    activityStartedAt: 0,
    activityEndsAt: 0,
    activityTargetNpcId: null,
    activityTargetLocationId: null,
    activityHistory: [],
    decisionCooldownUntil: 0,
    relationships: {},
    memories: [],
    goals: [],
    schedule: { entries: [], lastPlannedDay: -1 },
    interests: [],
    lifeHistory: [],
    generation: 1,
    alive: true,
    isMajor: false,
    lastUpdatedAt: 0,
  };
}

/** Collects the topic names captured by a bed. */
export function capturedTopics(bed: WorldTestBed): string[] {
  return bed.captured.map((event) => event.topic);
}

/** Typed convenience wrapper for tests that need the raw event bus. */
export function subscribe(bus: IEventBus, topic: string, handler: (payload: unknown) => void): () => void {
  return bus.on(topic as never, handler as never);
}
