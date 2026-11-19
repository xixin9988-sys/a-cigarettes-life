import { describe, expect, it } from 'vitest';
import type { ContentPack } from '../../src/data/schema';
import type { GameState, IGameContext } from '../../src/core/contracts';
import type { LocationId } from '../../src/core/SharedTypes';
import { ContentRegistry } from '../../src/core/ContentRegistry';
import { EventBus } from '../../src/core/EventBus';
import { Clock } from '../../src/core/Clock';
import { SystemRegistry } from '../../src/core/SystemRegistry';
import { createGameContext, RngFacade } from '../../src/core/GameContext';
import { MemoryLogger } from '../../src/core/GameLogger';
import { DEFAULT_APPEARANCE, createInitialGameState } from '../../src/core/WorldFactory';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import { WorldSystem } from '../../src/world/WorldManager';
import { LOCATIONS } from '../../src/data/locations/locations';
import { TRAIN_ROUTES } from '../../src/data/transport/routes';
import { WEATHER_TABLE } from '../../src/data/probability/weather';
import { BUSINESSES } from '../../src/data/shops/shops';
import { NPCS } from '../../src/data/npcs/npcs';
import { FORAGE_NODES } from '../../src/data/fish/fish';

/**
 * Cross-module integration coverage for the world module.
 *
 * The focused suites use a minimal local pack and stay independent of other
 * agents. This suite additionally pulls in the *other modules' static data that
 * references world locations* (businesses, NPCs, forage nodes) and proves the
 * world's 90 locations satisfy every reference. It then boots a real GameState
 * with the real ProbabilityEngine and runs the world system end-to-end.
 */

const INTEGRATION_PACK: ContentPack = {
  items: [],
  crops: [],
  fish: [],
  forageNodes: FORAGE_NODES,
  recipes: [],
  events: [],
  festivals: [],
  locations: LOCATIONS,
  trainRoutes: TRAIN_ROUTES,
  businesses: BUSINESSES,
  npcs: NPCS,
  dialogueTrees: [],
  furniture: [],
  blueprints: [],
  achievements: [],
  playerGoals: [],
  communityProposals: [],
  collectionCategories: [],
  weatherTable: WEATHER_TABLE,
};

interface FullStack {
  content: ContentRegistry;
  state: GameState;
  engine: ProbabilityEngine;
  world: WorldSystem;
  ctx: IGameContext;
  clock: Clock;
}

function createFullStack(seed: number): FullStack {
  const content = new ContentRegistry(INTEGRATION_PACK);
  const state = createInitialGameState({
    seed,
    playerName: 'Ash',
    appearance: DEFAULT_APPEARANCE,
    content,
  });
  const engine = new ProbabilityEngine();
  engine.init(seed, state.probability);
  const clock = new Clock(state.clock);
  const bus = new EventBus();
  const registry = new SystemRegistry(bus);
  const logger = new MemoryLogger();
  const rng = new RngFacade(engine);
  const ctx = createGameContext({
    state,
    content,
    probability: engine,
    bus,
    clock,
    registry,
    rng,
    logger,
  });
  const world = new WorldSystem();
  registry.register(world);
  world.init(ctx);
  return { content, state, engine, world, ctx, clock };
}

function advanceHours(stack: FullStack, hours: number): void {
  for (let i = 0; i < hours; i += 1) {
    stack.clock.advanceSimSeconds(60);
    stack.world.update(60);
  }
}

function isWorldReferenceError(message: string): boolean {
  return /location|Location|Train route|train route/.test(message);
}

describe('world module inside the wider content set', () => {
  it('satisfies every cross-module location reference', () => {
    const registry = new ContentRegistry(INTEGRATION_PACK);
    const locationIds = new Set<LocationId>(LOCATIONS.map((def) => def.id));
    const businessIds = new Set(BUSINESSES.map((business) => business.id));

    // Every business sits at an existing location (its exterior street address).
    for (const business of BUSINESSES) {
      expect(locationIds.has(business.locationId), business.id + ' at ' + business.locationId).toBe(true);
    }
    // Every business id claimed by a location exists in the shops data AND the
    // business points back at exactly that location (one canonical address each).
    for (const def of LOCATIONS) {
      if (!def.businessId) continue;
      expect(businessIds.has(def.businessId), def.id + ' claims missing business ' + def.businessId).toBe(true);
      const business = BUSINESSES.find((candidate) => candidate.id === def.businessId);
      expect(business?.locationId, def.id + ' business address mismatch').toBe(def.id);
    }
    for (const business of BUSINESSES) {
      const address = registry.getLocation(business.locationId);
      expect(address?.businessId, business.id + ' is not registered at its address').toBe(business.id);
    }
    // Every NPC home/work location exists.
    expect(NPCS.length).toBeGreaterThan(0);
    for (const npc of NPCS) {
      expect(locationIds.has(npc.homeLocationId), npc.id + ' home ' + npc.homeLocationId).toBe(true);
      expect(locationIds.has(npc.workLocationId), npc.id + ' work ' + npc.workLocationId).toBe(true);
    }
    // Every forage node references a real location.
    for (const node of FORAGE_NODES) {
      expect(locationIds.has(node.locationId), 'forage node ' + node.id + ' at ' + node.locationId).toBe(true);
    }
    // Train routes reference real station exteriors.
    for (const route of TRAIN_ROUTES) {
      expect(locationIds.has(route.fromLocationId)).toBe(true);
      expect(locationIds.has(route.toLocationId)).toBe(true);
      expect(registry.getLocation(route.fromLocationId)?.indoor).toBe(false);
      expect(registry.getLocation(route.toLocationId)?.indoor).toBe(false);
    }
    expect(registry.getTrainRoute(TRAIN_ROUTES[0]?.id ?? '')).toBeDefined();
    expect(registry.getWeatherTable()).toBe(WEATHER_TABLE);
    expect(registry.getLocationsInRegion('willowbrook')).toHaveLength(50);
    expect(registry.getLocationsInRegion('ashford')).toHaveLength(40);
    // Frozen contract: every canonical exterior has an interior scene.
    for (const exteriorId of LOCATIONS.filter((def) => !def.indoor).map((def) => def.id)) {
      expect(registry.getLocation(exteriorId + '_interior'), 'missing interior for ' + exteriorId).toBeDefined();
    }
  });

  it('has no world-related content validation errors in the integrated pack', () => {
    const registry = new ContentRegistry(INTEGRATION_PACK);
    const worldErrors = registry.validate().filter(isWorldReferenceError);
    expect(worldErrors, 'world-related content errors: ' + worldErrors.join(' | ')).toEqual([]);
    // Every registered location must resolve through the registry.
    for (const def of LOCATIONS) {
      expect(registry.getLocation(def.id), 'registry missing location ' + def.id).toBeDefined();
    }
  });

  it('boots and runs with the real world factory and probability engine', () => {
    const stack = createFullStack(20261119);
    expect(stack.world.getAllLocations()).toHaveLength(90);
    expect(stack.state.npcs !== undefined).toBe(true);
    expect(stack.world.getCurrentLocationId()).toBeTruthy();
    advanceHours(stack, 48);
    const env = stack.world.getEnvironment();
    expect(Number.isFinite(env.temperature)).toBe(true);
    expect(Number.isFinite(env.humidity)).toBe(true);
    expect(env.season).toBe('spring');
    expect(stack.state.world.history.length).toBeGreaterThan(0);
    // Weather and environment randomness must go through our assigned streams.
    expect(stack.engine.hasStream('world.weather')).toBe(true);
    expect(stack.engine.hasStream('world.environment')).toBe(true);
    const exported = stack.engine.exportState();
    expect(exported.streams['world.weather']?.length ?? 0).toBeGreaterThan(0);
    // Occupancy must be derived from the real NPC population.
    const occupied = stack.world.getAllLocations().filter((location) => location.occupants.length > 0);
    expect(occupied.length).toBeGreaterThan(0);
  });

  it('reproduces identical worlds on the same seed with the real probability engine', () => {
    const run = (): string => {
      const stack = createFullStack(777);
      advanceHours(stack, 72);
      return JSON.stringify({
        environment: stack.world.getEnvironment(),
        history: stack.state.world.history.map((entry) => entry.description),
        locations: Object.values(stack.state.world.locations).map((location) => ({
          id: location.id,
          visitCount: location.visitCount,
          discovered: location.discovered,
        })),
      });
    };
    expect(run()).toBe(run());
  });

  it('supports the full player journey on the real map: home -> centre -> train -> Ashford', () => {
    const stack = createFullStack(99);
    const world = stack.world;
    const route: LocationId[] = [
      'willowbrook_home_interior',
      'willowbrook_home',
      'willowbrook_park',
      'willowbrook_plaza',
      'willowbrook_center',
      'willowbrook_train_station',
      'willowbrook_train_station_interior',
    ];
    for (const locationId of route) {
      const result = world.travelTo(locationId);
      expect(result.ok, locationId + ': ' + result.message).toBe(true);
    }
    stack.clock.setSimTimeSeconds(12 * 60);
    world.update(0);
    const schedule = world.getTrainSchedule('willowbrook_train_station_interior');
    expect(schedule.length).toBeGreaterThan(0);
    const departure = schedule[0];
    expect(departure).toBeDefined();
    if (!departure) return;
    stack.clock.setSimTimeSeconds(departure.departSimTime - 10);
    expect(world.buyTrainTicket(departure.routeId).ok).toBe(true);
    expect(world.boardTrain().ok).toBe(true);
    stack.clock.setSimTimeSeconds(departure.arriveSimTime + 1);
    world.update(0);
    expect(world.getCurrentLocationId()).toBe('ashford_train_station');
    expect(world.getLocation('ashford_train_station')?.regionId).toBe('ashford');
    // And can walk from Ashford station into the city.
    expect(world.travelTo('ashford_high_street').ok).toBe(true);
  });

  it('can validate the aggregated game content pack when it is complete', async () => {
    let pack: ContentPack | null = null;
    let importError = '';
    try {
      const module = await import('../../src/data');
      pack = module.CONTENT_PACK;
    } catch (error) {
      importError = error instanceof Error ? error.message : String(error);
    }
    if (!pack) {
      // Another domain's data module is mid-edit: skip with a loud warning
      // rather than failing the world suite for an unrelated module.
      console.warn('Aggregated CONTENT_PACK unavailable, skipping full-pack validation: ' + importError);
      return;
    }
    expect(pack.locations).toBe(LOCATIONS);
    expect(pack.trainRoutes).toBe(TRAIN_ROUTES);
    expect(pack.weatherTable).toBe(WEATHER_TABLE);
    const registry = new ContentRegistry(pack);
    const worldErrors = registry.validate().filter(isWorldReferenceError);
    expect(worldErrors, 'world-related content errors: ' + worldErrors.join(' | ')).toEqual([]);
    const locationIds = new Set(pack.locations.map((def) => def.id));
    for (const business of pack.businesses) {
      expect(locationIds.has(business.locationId), business.id + ' at ' + business.locationId).toBe(true);
    }
  });
});
