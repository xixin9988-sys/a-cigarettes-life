import type {
  ActionResult,
  BusinessState,
  GameEventTopic,
  GameState,
  IGameContext,
  JobState,
  NPCState,
} from '../../src/core/contracts';
import type { ContentPack, DialogueTree, LocationDef, NPCDef, WeatherTransitionTable } from '../../src/data/schema';
import type { BusinessId, NPCId, RegionId } from '../../src/core/SharedTypes';

import { Clock } from '../../src/core/Clock';
import { EventBus as EventBusImpl } from '../../src/core/EventBus';
import { SystemRegistry } from '../../src/core/SystemRegistry';
import { RngFacade, createGameContext } from '../../src/core/GameContext';
import { MemoryLogger } from '../../src/core/GameLogger';
import { ContentRegistry } from '../../src/core/ContentRegistry';
import { DEFAULT_APPEARANCE, createInitialGameState } from '../../src/core/WorldFactory';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import { CORE_ITEMS } from '../../src/data/items/core';
import { NATURE_ITEMS } from '../../src/data/items/nature';
import { CRAFTED_ITEMS } from '../../src/data/items/crafted';
import { LIFE_ITEMS } from '../../src/data/items/life';
import { LOCATIONS } from '../../src/data/locations/locations';
import { BUSINESSES } from '../../src/data/shops/shops';
import { EconomySystem } from '../../src/economy/EconomySystem';
import { exteriorIdOf } from '../../src/economy/EconomyHelpers';
import {
  ALL_EXTERIOR_LOCATION_IDS,
  LOC,
  interiorIdFor,
} from '../../src/data/locations/ids';
import { MAJOR_NPC_IDS, NPC, RESIDENT_NPC_IDS } from '../../src/data/npcs/ids';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import { hashString } from '../../src/core/utils';


export interface RecordedEvent {
  topic: GameEventTopic;
  payload: unknown;
}

export interface EconomyScenario {
  state: GameState;
  content: ContentRegistry;
  clock: Clock;
  bus: EventBusImpl;
  probability: ProbabilityEngine;
  registry: SystemRegistry;
  ctx: IGameContext;
  economy: EconomySystem;
  logger: MemoryLogger;
  events: RecordedEvent[];
}

export interface ScenarioOptions {
  seed?: number;
  /** Starts the player at this location instead of the default home interior. */
  playerLocationId?: string;
  /** Overrides the initial clock (sim seconds). Defaults to the WorldFactory start time. */
  startSimTime?: number;
}

/** Simulated seconds per in-game hour/day: 1 sim second = 1 in-game minute. */
export const HOUR = 60;
export const DAY = 24 * HOUR;
export const START_DAY0_08 = 8 * HOUR;

const FIXTURE_DIALOGUE_TREE: DialogueTree = {
  id: 'dialogue_fixture',
  rootNodeId: 'root',
  nodes: {
    root: { id: 'root', text: 'Fine weather for it.', choices: [] },
  },
};

const FIXTURE_WEATHER: WeatherTransitionTable = {
  bySeason: {
    spring: { clear: { clear: 1 } },
    summer: { clear: { clear: 1 } },
    autumn: { clear: { clear: 1 } },
    winter: { clear: { clear: 1 } },
  },
};

export function allFixtureItems() {
  return [...CORE_ITEMS, ...NATURE_ITEMS, ...CRAFTED_ITEMS, ...LIFE_ITEMS];
}

/** Business id to the exterior location id NPC schedules use. */
export function businessExterior(business: { locationId: string }): string {
  return exteriorIdOf(business.locationId);
}

const MAJOR_ROLES: Readonly<Record<string, string>> = {
  [NPC.marigoldLyle]: 'florist',
  [NPC.ottoBramwell]: 'baker',
  [NPC.sylviaReed]: 'cafe owner',
  [NPC.haroldBagg]: 'postmaster',
  [NPC.elizaThorne]: 'retired librarian',
  [NPC.theoGrey]: 'bookseller',
  [NPC.claraBright]: 'botanist',
  [NPC.finnHolloway]: 'fisherman',
  [NPC.adaQuinn]: 'farmer',
  [NPC.rufusMarsh]: 'warehouse keeper',
  [NPC.penelopeVance]: 'museum curator',
  [NPC.jasperKim]: 'barista',
  [NPC.edmundHale]: 'community chair',
  [NPC.ninaOkoye]: 'office worker',
};

function fixturePersonality(index: number) {
  const trait = (offset: number) => {
    const value = (hashString('fixture-personality:' + index + ':' + offset) % 1000) / 1000;
    return Math.round((0.15 + value * 0.8) * 100) / 100;
  };
  return {
    extroversion: trait(1),
    introversion: trait(2),
    adventure: trait(3),
    caution: trait(4),
    generosity: trait(5),
    curiosity: trait(6),
    socialNeed: trait(7),
    independence: trait(8),
    responsibility: trait(9),
    spendingTendency: trait(10),
    artisticTendency: trait(11),
    workTendency: trait(12),
  };
}

function fixtureAppearance(index: number) {
  const palette = ['#c98b6b', '#8ba6c9', '#b9c98b', '#c9b98b', '#b98bc9', '#8bc9b9'];
  const color = palette[index % palette.length] ?? '#c98b6b';
  return {
    primaryColor: color,
    secondaryColor: '#f2e6d0',
    hairColor: '#5a4a3a',
    skinTone: '#d9b08c',
    outfitStyle: 'casual' as const,
    accessory: index % 3 === 0 ? 'scarf' : 'none',
    scale: 1,
  };
}

/**
 * Deterministic fixture NPCs (14 majors + 42 residents). NPC data is owned by another
 * agent; economy tests only need believable budgets/workplaces, so this fixture pins the
 * population shape and gives it fixed workplaces derived from the real BUSINESSES list.
 */
export function createFixtureNpcs(): NPCDef[] {
  const npcs: NPCDef[] = [];
  const home = LOC.cityResidential;
  const businessExteriors = BUSINESSES.map((business) => businessExterior(business));
  const owners = new Map<string, string>();
  for (const business of BUSINESSES) {
    if (business.ownerNpcId && business.ownerNpcId !== null) {
      owners.set(business.ownerNpcId, businessExterior(business));
    }
  }

  const makeNpc = (id: NPCId, index: number, major: boolean): NPCDef => {
    const isOwner = owners.has(id);
    const workLocationId = isOwner
      ? (owners.get(id) as string)
      : major
        ? LOC.center
        : (businessExteriors[index % businessExteriors.length] ?? LOC.center);
    const money = 12000 + ((index * 7919) % 42000);
    return {
      id,
      name: major ? 'Major ' + id : 'Resident ' + String(index).padStart(2, '0'),
      age: 22 + (index % 45),
      lifeStage: index % 9 === 0 ? 'elder' : index % 7 === 0 ? 'teen' : 'adult',
      personality: fixturePersonality(index),
      appearance: fixtureAppearance(index),
      occupation: major ? (MAJOR_ROLES[id] ?? 'resident') : 'shop worker',
      homeLocationId: home,
      workLocationId,
      startingMoney: money,
      interests: ['gardening', 'fishing', 'reading'],
      goals: ['live a quiet life'],
      bio: 'A fixture resident used by economy tests.',
      dialogueTreeId: 'dialogue_fixture',
      scheduleTemplate: [],
      initialRelationships: [],
      major,
      romanceable: major,
      likes: ['food', 'gifts'],
      dislikes: ['rudeness'],
    };
  };

  MAJOR_NPC_IDS.forEach((id, index) => npcs.push(makeNpc(id, index, true)));
  RESIDENT_NPC_IDS.forEach((id, index) => npcs.push(makeNpc(id, index + 14, false)));
  return npcs;
}

/** Builds a content pack that uses the real items + real locations + real businesses. */
export function createFixtureContent(): ContentRegistry {
  const items = allFixtureItems();
  const pack: ContentPack = {
    items,
    crops: [],
    fish: [],
    forageNodes: [],
    recipes: [],
    events: [],
    festivals: [],
    locations: LOCATIONS,
    trainRoutes: [],
    businesses: BUSINESSES,
    npcs: createFixtureNpcs(),
    dialogueTrees: [FIXTURE_DIALOGUE_TREE],
    furniture: [],
    blueprints: [],
    achievements: [],
    playerGoals: [],
    communityProposals: [],
    collectionCategories: [],
    weatherTable: FIXTURE_WEATHER,
  };
  return new ContentRegistry(pack);
}

/** Fresh headless economy scenario: real content data, deterministic seed, real engine. */
export function createScenario(options: ScenarioOptions = {}): EconomyScenario {
  const seed = options.seed ?? 20240517;
  const content = createFixtureContent();
  const state = createInitialGameState({
    seed,
    playerName: 'Ash',
    appearance: DEFAULT_APPEARANCE,
    content,
  });
  if (options.playerLocationId) {
    state.player.position.locationId = options.playerLocationId;
    const location: LocationDef | undefined = content.getLocation(options.playerLocationId);
    state.player.position.indoor = location ? location.indoor : false;
  }
  if (options.startSimTime !== undefined) state.clock.simTimeSeconds = options.startSimTime;

  const bus = new EventBusImpl();
  const clock = new Clock(state.clock);
  const probability = new ProbabilityEngine();
  probability.init(seed, state.probability);
  const registry = new SystemRegistry(bus);
  const economy = new EconomySystem();
  registry.register(economy);
  const rng = new RngFacade(probability);
  const logger = new MemoryLogger();
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
  registry.initAll(ctx);

  const scenario: EconomyScenario = {
    state,
    content,
    clock,
    bus,
    probability,
    registry,
    ctx,
    economy,
    logger,
    events: [],
  };
  captureEvents(scenario);
  return scenario;
}

function captureEvents(scenario: EconomyScenario): void {
  scenario.bus.on('money:changed', (payload) => scenario.events.push({ topic: 'money:changed', payload }));
  scenario.bus.on('item:acquired', (payload) => scenario.events.push({ topic: 'item:acquired', payload }));
  scenario.bus.on('item:lost', (payload) => scenario.events.push({ topic: 'item:lost', payload }));
  scenario.bus.on('transaction:completed', (payload) =>
    scenario.events.push({ topic: 'transaction:completed', payload })
  );
  scenario.bus.on('game:signal', (payload) => scenario.events.push({ topic: 'game:signal', payload }));
}

/** Advances the clock and runs one economy update per hour. */
export function advanceHours(scenario: EconomyScenario, hours: number): void {
  const wholeHours = Math.max(1, Math.floor(hours));
  for (let index = 0; index < wholeHours; index += 1) {
    scenario.clock.advanceSimSeconds(HOUR);
    scenario.economy.update(HOUR);
  }
}

/** Advances an arbitrary number of sim seconds in one update (large-dt / offline style). */
export function advanceSimSeconds(scenario: EconomyScenario, seconds: number): void {
  scenario.clock.advanceSimSeconds(seconds);
  scenario.economy.update(seconds);
}

/** Teleports the clock and syncs opening states without simulating elapsed time. */
export function setClock(scenario: EconomyScenario, simSeconds: number): void {
  scenario.clock.setSimTimeSeconds(simSeconds);
  scenario.economy.update(0);
}

export function placePlayer(scenario: EconomyScenario, locationId: string): void {
  scenario.state.player.position.locationId = locationId;
  scenario.state.player.position.indoor = scenario.content.getLocation(locationId)?.indoor ?? false;
}

export function businessFor(scenario: EconomyScenario, businessId: BusinessId): BusinessState {
  const business = scenario.economy.getBusiness(businessId);
  if (!business) throw new Error('Missing business: ' + businessId);
  return business;
}

export function jobsFor(scenario: EconomyScenario, businessId: BusinessId): JobState[] {
  return scenario.economy.getJobs().filter((job) => job.businessId === businessId);
}

export function jobFor(scenario: EconomyScenario, businessId: BusinessId, index = 0): JobState {
  const job = jobsFor(scenario, businessId)[index];
  if (!job) throw new Error('Missing job ' + index + ' at ' + businessId);
  return job;
}

export function npcFor(scenario: EconomyScenario, npcId: NPCId): NPCState {
  const npc = scenario.state.npcs[npcId];
  if (!npc) throw new Error('Missing NPC: ' + npcId);
  return npc;
}

export function playerInventoryCount(scenario: EconomyScenario, itemId: string): number {
  let total = 0;
  for (const entry of scenario.state.player.inventory) {
    if (entry.itemId === itemId) total += entry.quantity;
  }
  return total;
}

export function eventsOf(scenario: EconomyScenario, topic: GameEventTopic): RecordedEvent[] {
  return scenario.events.filter((event) => event.topic === topic);
}

export function clearEvents(scenario: EconomyScenario): void {
  scenario.events.length = 0;
}

export interface MarketNumericSnapshot {
  itemId: string;
  price: number;
  supply: number;
  demand: number;
  seasonal: number;
  trend: number;
}

export function marketSnapshot(scenario: EconomyScenario): MarketNumericSnapshot[] {
  return Object.values(scenario.economy.getMarket())
    .map((good) => ({
      itemId: good.itemId,
      price: good.currentPrice,
      supply: good.supply,
      demand: good.demand,
      seasonal: good.seasonalFactor,
      trend: good.trend,
    }))
    .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
}

export function expectActionResult(result: ActionResult): void {
  if (!result.ok) throw new Error('Expected a successful action, got: ' + result.message);
}

/** Walks a JSON-ish value and reports any non-finite number (NaN/Infinity). */
export function findNonFiniteNumbers(value: unknown, path = '$'): string[] {
  const problems: string[] = [];
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) problems.push(path + ' = ' + String(value));
    return problems;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => problems.push(...findNonFiniteNumbers(entry, path + '[' + index + ']')));
    return problems;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      problems.push(...findNonFiniteNumbers(entry, path + '.' + key));
    }
  }
  return problems;
}

export function regularItemCount(scenario: EconomyScenario): number {
  return allFixtureItems().length;
}

export const FIXTURE_REGION: RegionId = 'willowbrook';
export const HOME_INTERIOR = interiorIdFor(LOC.home);
export const CAFE_INTERIOR = interiorIdFor(LOC.cafe);
export const GROCERY_INTERIOR = interiorIdFor(LOC.grocery);
export const LIBRARY_INTERIOR = interiorIdFor(LOC.library);
export const BAKERY_INTERIOR = interiorIdFor(LOC.bakery);

export { ALL_EXTERIOR_LOCATION_IDS };
export const WORLD = WORLD_CONFIG;