/**
 * Test harness for the crafting / cooking / building / housing / collection / skill module.
 *
 * - The REAL ProbabilityEngine (src/probability/ProbabilityEngine.ts) with a fixed seed, so
 *   quality rolls and determinism tests exercise production probability code.
 * - A controlled content pack: the real data files written by the craft agent, the real item
 *   modules from the other agents (ALL_ITEMS), plus minimal stub ItemDefs for any referenced
 *   id that has no definition, plus fixture locations with the exact facilities each test needs.
 * - A fully initialised GameState (WorldFactory) and a context with the six systems registered
 *   in the canonical dependency order.
 */
import type {
  GameState,
  IGameContext,
} from '../../src/core/contracts';
import type { ContentPack, ItemDef, ItemVisual, LocationDef } from '../../src/data/schema';
import type { ItemId, JsonValue, QualityStars, SkillId } from '../../src/core/SharedTypes';
import { Clock } from '../../src/core/Clock';
import { EventBus } from '../../src/core/EventBus';
import { SystemRegistry } from '../../src/core/SystemRegistry';
import { RngFacade, createGameContext } from '../../src/core/GameContext';
import { MemoryLogger } from '../../src/core/GameLogger';
import { ContentRegistry } from '../../src/core/ContentRegistry';
import { DEFAULT_APPEARANCE, createInitialGameState } from '../../src/core/WorldFactory';
import { addItemToInventory, countItem } from '../../src/core/InventoryUtil';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import { ALL_ITEMS } from '../../src/data/items/index';
import { CRAFTED_ITEMS } from '../../src/data/items/crafted';
import { FURNITURE } from '../../src/data/furniture/furniture';
import { BLUEPRINTS } from '../../src/data/blueprints/blueprints';
import { RECIPES } from '../../src/data/recipes/recipes';
import { COLLECTION_CATEGORIES } from '../../src/data/collection/categories';
import { HOME_INTERIOR_ID, LOC, interiorIdFor } from '../../src/data/locations/ids';
import { ITEM } from '../../src/data/items/ids';
import { SkillSystem } from '../../src/gameplay/SkillSystem';
import { CraftingSystem } from '../../src/gameplay/CraftingSystem';
import { CookingSystem } from '../../src/gameplay/CookingSystem';
import { BuildingSystem } from '../../src/gameplay/BuildingSystem';
import { HousingSystem } from '../../src/gameplay/HousingSystem';
import { CollectionSystem } from '../../src/gameplay/CollectionSystem';

// ===========================================================================
// Fixture item / location builders
// ===========================================================================
const FIXTURE_VISUAL: ItemVisual = { color: '#b8b8b8', shape: 'rect' };

function fixtureItem(id: ItemId, overrides: Partial<ItemDef>): ItemDef {
  const base: ItemDef = {
    id,
    name: id.replace(/_/g, ' '),
    description: 'Test fixture item ' + id,
    category: 'misc',
    basePrice: 10,
    stackable: true,
    maxStack: 99,
    hasQuality: false,
    tags: [],
    visual: FIXTURE_VISUAL,
  };
  return { ...base, ...overrides, id };
}

function stubItem(id: ItemId): ItemDef {
  return fixtureItem(id, { tags: ['stub'] });
}

const COLLECTIBLE_FISH_ID = 'test_fish_alpha';
const COLLECTIBLE_MINERAL_ID = 'test_mineral_alpha';
const TEST_HERB_ID = 'test_herb';
const TEST_MEAL_ID = 'test_meal';
const TEST_RECIPE_SCROLL_ID = 'test_recipe_scroll';

function fixtureExtraItems(): ItemDef[] {
  return [
    fixtureItem(COLLECTIBLE_FISH_ID, {
      name: 'Fixture Perch',
      category: 'fish',
      tags: ['fish', 'freshwater'],
      hasQuality: true,
    }),
    fixtureItem(COLLECTIBLE_MINERAL_ID, {
      name: 'Fixture Quartz',
      category: 'collectible',
      tags: ['mineral', 'gem'],
      hasQuality: true,
    }),
    fixtureItem(TEST_HERB_ID, { name: 'Fixture Herb', category: 'produce', tags: ['herb'] }),
    fixtureItem(TEST_RECIPE_SCROLL_ID, {
      name: 'Fixture Recipe Scroll',
      category: 'recipe',
      tags: ['recipe'],
      unlocksRecipes: ['craft_fishing_rod_master'],
    }),
    fixtureItem(TEST_MEAL_ID, {
      name: 'Hearty Fixture Stew',
      category: 'food',
      tags: ['cooked', 'meal'],
      edible: true,
      nutrition: 20,
      effects: [
        { kind: 'skill_xp', value: 20, durationHours: 999 },
        { kind: 'energy', value: 15, durationHours: 2 },
      ],
    }),
  ];
}

function fixtureExtraRecipes(): ContentPack['recipes'] {
  return [
    {
      id: 'test_cook_hearty_meal',
      name: 'Hearty Fixture Stew',
      description: 'A test recipe used to exercise cooking buffs.',
      category: 'cook',
      station: 'kitchen',
      inputs: [{ itemId: TEST_HERB_ID, quantity: 1 }],
      outputs: [{ itemId: TEST_MEAL_ID, quantity: 1 }],
      hours: 0.5,
      skill: 'cooking',
      levelReq: 1,
      tags: ['test', 'stew'],
      visual: { color: '#c96f3f', shape: 'food' },
    },
  ];
}

function fixtureLocation(partial: Partial<LocationDef> & { id: string; regionId: 'willowbrook' | 'ashford' }): LocationDef {
  const base: LocationDef = {
    id: partial.id,
    name: partial.id,
    regionId: partial.regionId,
    kind: 'interior',
    description: 'Test fixture location.',
    indoor: true,
    mapX: 0,
    mapY: 0,
    widthTiles: 20,
    heightTiles: 14,
    connections: [],
    shelter: 1,
    windExposure: 0,
    humidityModifier: 0,
    heatSource: false,
    openHour: 0,
    closeHour: 24,
    facilities: [],
    eventTags: [],
    forageTags: [],
    discoverable: false,
    secret: false,
    theme: 'indoor',
    visual: FIXTURE_VISUAL,
    floorColor: '#cccccc',
    accentColor: '#999999',
  };
  return { ...base, ...partial, id: partial.id };
}

export const FIXTURE_LOCATIONS = {
  homeExterior: LOC.home,
  homeInterior: HOME_INTERIOR_ID,
  workshop: 'test_workshop',
  kitchen: 'test_kitchen',
  campfire: 'test_campfire',
  farField: 'test_far_field',
  museumInterior: interiorIdFor(LOC.museum),
} as const;

function fixtureLocations(): LocationDef[] {
  return [
    fixtureLocation({
      id: LOC.home,
      name: 'Willowbrook Home',
      regionId: 'willowbrook',
      kind: 'residence',
      indoor: false,
      facilities: ['farmland'],
      connections: [HOME_INTERIOR_ID, LOC.center],
      widthTiles: 20,
      heightTiles: 14,
      theme: 'town',
      floorColor: '#9fbf7a',
    }),
    fixtureLocation({
      id: HOME_INTERIOR_ID,
      name: 'Home Interior',
      regionId: 'willowbrook',
      entranceFrom: LOC.home,
      facilities: ['bed', 'storage'],
      connections: [LOC.home],
      widthTiles: 20,
      heightTiles: 14,
    }),
    fixtureLocation({
      id: FIXTURE_LOCATIONS.workshop,
      name: 'Village Workshop',
      regionId: 'willowbrook',
      facilities: ['workbench'],
      connections: [LOC.center],
      widthTiles: 16,
      heightTiles: 12,
    }),
    fixtureLocation({
      id: FIXTURE_LOCATIONS.kitchen,
      name: 'Bakery Kitchen',
      regionId: 'willowbrook',
      facilities: ['kitchen'],
      connections: [LOC.center],
      widthTiles: 16,
      heightTiles: 12,
    }),
    fixtureLocation({
      id: FIXTURE_LOCATIONS.campfire,
      name: 'Riverside Campfire',
      regionId: 'willowbrook',
      kind: 'river',
      indoor: false,
      facilities: ['campfire'],
      connections: [LOC.river],
      widthTiles: 20,
      heightTiles: 14,
      theme: 'water',
    }),
    fixtureLocation({
      id: FIXTURE_LOCATIONS.farField,
      name: 'Far Field',
      regionId: 'willowbrook',
      kind: 'countryside',
      indoor: false,
      facilities: ['forage'],
      connections: [LOC.center],
      widthTiles: 20,
      heightTiles: 14,
      theme: 'countryside',
    }),
    fixtureLocation({
      id: interiorIdFor(LOC.museum),
      name: 'Ashford Museum Interior',
      regionId: 'ashford',
      entranceFrom: LOC.museum,
      facilities: ['museum'],
      connections: [LOC.museum],
      widthTiles: 20,
      heightTiles: 14,
    }),
    fixtureLocation({
      id: LOC.museum,
      name: 'Ashford Museum',
      regionId: 'ashford',
      kind: 'museum',
      indoor: false,
      facilities: ['museum'],
      connections: [interiorIdFor(LOC.museum)],
      widthTiles: 20,
      heightTiles: 14,
      theme: 'city',
    }),
  ];
}

// ===========================================================================
// Content pack
// ===========================================================================
export function buildFixturePack(): ContentPack {
  const items: ItemDef[] = [];
  const seen = new Set<string>();
  const add = (item: ItemDef): void => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  };
  for (const item of ALL_ITEMS) add(item);
  for (const item of CRAFTED_ITEMS) add(item);
  for (const item of fixtureExtraItems()) add(item);

  // Stub any item id referenced by our recipes / blueprints / furniture that the other
  // item modules have not defined. Stubs are only used when a module is genuinely missing
  // an id; they keep this module's tests independent of the other agents' delivery order.
  const referenced = new Set<ItemId>();
  for (const recipe of RECIPES) {
    for (const input of recipe.inputs) referenced.add(input.itemId);
    for (const output of recipe.outputs) referenced.add(output.itemId);
    if (recipe.unlockItemId) referenced.add(recipe.unlockItemId);
  }
  for (const blueprint of BLUEPRINTS) {
    for (const input of blueprint.inputs) referenced.add(input.itemId);
  }
  for (const def of FURNITURE) {
    referenced.add(def.itemId);
    if (def.itemId !== def.id) referenced.add(def.id);
  }
  for (const itemId of referenced) if (!seen.has(itemId)) add(stubItem(itemId));

  const weatherTable: ContentPack['weatherTable'] = {
    bySeason: { spring: {}, summer: {}, autumn: {}, winter: {} } as ContentPack['weatherTable']['bySeason'],
  };

  return {
    items,
    crops: [],
    fish: [],
    forageNodes: [],
    recipes: [...RECIPES, ...fixtureExtraRecipes()],
    events: [],
    festivals: [],
    locations: fixtureLocations(),
    trainRoutes: [],
    businesses: [],
    npcs: [],
    dialogueTrees: [],
    furniture: FURNITURE,
    blueprints: BLUEPRINTS,
    achievements: [],
    playerGoals: [],
    communityProposals: [],
    collectionCategories: COLLECTION_CATEGORIES,
    weatherTable,
  };
}

export function buildFixtureContent(pack?: ContentPack): ContentRegistry {
  return new ContentRegistry(pack ?? buildFixturePack());
}

// ===========================================================================
// Harness
// ===========================================================================
export interface HarnessOptions {
  seed?: number;
  register?: string[];
  /** Keep the WorldFactory starter inventory (default true). Set false for clean-inventory tests. */
  starterInventory?: boolean;
}

export interface CraftHarness {
  state: GameState;
  content: ContentRegistry;
  probability: ProbabilityEngine;
  clock: Clock;
  bus: EventBus;
  registry: SystemRegistry;
  logger: MemoryLogger;
  ctx: IGameContext;
  signals: { name: string; data?: JsonValue }[];
  skill: SkillSystem;
  crafting: CraftingSystem;
  cooking: CookingSystem;
  building: BuildingSystem;
  housing: HousingSystem;
  collection: CollectionSystem;
  /** Advance raw simulated seconds (1 sim second = 1 in-game minute). */
  advance(simSeconds: number): void;
  /** Advance in-game minutes (1 in-game minute = 1 simulated second). */
  advanceGameMinutes(minutes: number): void;
  /** Advance in-game hours (1 in-game hour = 60 simulated seconds). */
  advanceGameHours(hours: number): void;
  give(itemId: ItemId, quantity: number, quality?: QualityStars): void;
  giveFurniture(itemId: ItemId, quality?: QualityStars): string;
  instanceIds(itemId: ItemId): string[];
  count(itemId: ItemId): number;
  setPlayerLocation(locationId: string): void;
}

const DEFAULT_SYSTEMS = ['skill', 'crafting', 'cooking', 'building', 'housing', 'collection'];

export function createCraftHarness(options: HarnessOptions = {}): CraftHarness {
  const seed = options.seed ?? 424242;
  const content = buildFixtureContent();
  const state = createInitialGameState({
    seed,
    playerName: 'Ash',
    appearance: { ...DEFAULT_APPEARANCE },
    content,
  });
  if (options.starterInventory === false) state.player.inventory.length = 0;
  const probability = new ProbabilityEngine();
  probability.init(state.meta.seed >>> 0, state.probability);
  const clock = new Clock(state.clock);
  const bus = new EventBus();
  const registry = new SystemRegistry(bus);
  const logger = new MemoryLogger();
  const rng = new RngFacade(probability);

  const enabled = new Set(options.register ?? DEFAULT_SYSTEMS);
  const skill = new SkillSystem();
  const crafting = new CraftingSystem();
  const cooking = new CookingSystem();
  const building = new BuildingSystem();
  const housing = new HousingSystem();
  const collection = new CollectionSystem();
  const ordered = [skill, crafting, cooking, building, housing, collection];
  for (const system of ordered) {
    if (enabled.has(system.id)) registry.register(system);
  }

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

  const signals: { name: string; data?: JsonValue }[] = [];
  bus.on('game:signal', (payload) => {
    if (payload.data === undefined) signals.push({ name: payload.name });
    else signals.push({ name: payload.name, data: payload.data });
  });

  const harness: CraftHarness = {
    state,
    content,
    probability,
    clock,
    bus,
    registry,
    logger,
    ctx,
    signals,
    skill,
    crafting,
    cooking,
    building,
    housing,
    collection,
    advance(simSeconds: number): void {
      clock.advanceSimSeconds(simSeconds);
      state.clock.simTimeSeconds = clock.simTimeSeconds;
      registry.updateAll(simSeconds);
    },
    advanceGameMinutes(minutes: number): void {
      harness.advance(minutes);
    },
    advanceGameHours(hours: number): void {
      harness.advance(hours * 60);
    },
    give(itemId: ItemId, quantity: number, quality: QualityStars = 3): void {
      const def = content.getItem(itemId);
      addItemToInventory(state.player.inventory, itemId, quantity, {
        quality,
        freshness: 1,
        simTime: clock.simTimeSeconds,
        maxStack: def?.maxStack ?? 99,
      });
      bus.emit('item:acquired', { itemId, quantity, quality, source: 'test_give' });
    },
    giveFurniture(itemId: ItemId, quality: QualityStars = 3): string {
      const def = content.getItem(itemId);
      addItemToInventory(state.player.inventory, itemId, 1, {
        quality,
        freshness: 1,
        simTime: clock.simTimeSeconds,
        maxStack: def?.maxStack ?? 1,
      });
      const matches = state.player.inventory.filter((candidate) => candidate.itemId === itemId);
      const last = matches[matches.length - 1];
      if (!last) throw new Error('Failed to give furniture ' + itemId);
      bus.emit('item:acquired', { itemId, quantity: 1, quality, source: 'test_give' });
      return last.instanceId;
    },
    instanceIds(itemId: ItemId): string[] {
      return state.player.inventory.filter((entry) => entry.itemId === itemId).map((entry) => entry.instanceId);
    },
    count(itemId: ItemId): number {
      return countItem(state.player.inventory, itemId);
    },
    setPlayerLocation(locationId: string): void {
      state.player.position.locationId = locationId;
      const def = content.getLocation(locationId);
      if (def) {
        state.player.position.regionId = def.regionId;
        state.player.position.indoor = def.indoor;
      }
    },
  };
  return harness;
}

export const TEST_IDS = {
  collectibleFish: COLLECTIBLE_FISH_ID,
  collectibleMineral: COLLECTIBLE_MINERAL_ID,
  testHerb: TEST_HERB_ID,
  testMeal: TEST_MEAL_ID,
  testRecipeScroll: TEST_RECIPE_SCROLL_ID,
  testMealRecipe: 'test_cook_hearty_meal',
} as const;

export const ITEMS = { ...ITEM, ...TEST_IDS };
export type { SkillId };
