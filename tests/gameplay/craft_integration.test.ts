import { describe, expect, it } from 'vitest';
import { CONTENT_PACK } from '../../src/data/index';
import { ContentRegistry } from '../../src/core/ContentRegistry';
import { createInitialGameState, DEFAULT_APPEARANCE } from '../../src/core/WorldFactory';
import { Clock } from '../../src/core/Clock';
import { EventBus } from '../../src/core/EventBus';
import { SystemRegistry } from '../../src/core/SystemRegistry';
import { RngFacade, createGameContext } from '../../src/core/GameContext';
import { MemoryLogger } from '../../src/core/GameLogger';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import { SkillSystem } from '../../src/gameplay/SkillSystem';
import { CraftingSystem } from '../../src/gameplay/CraftingSystem';
import { CookingSystem } from '../../src/gameplay/CookingSystem';
import { BuildingSystem } from '../../src/gameplay/BuildingSystem';
import { HousingSystem } from '../../src/gameplay/HousingSystem';
import { CollectionSystem } from '../../src/gameplay/CollectionSystem';
import { FarmingSystem } from '../../src/gameplay/FarmingSystem';
import { addItemToInventory, countItem } from '../../src/core/InventoryUtil';
import { ITEM } from '../../src/data/items/ids';
import { HOME_INTERIOR_ID, LOC, interiorIdFor } from '../../src/data/locations/ids';
import { RECIPES } from '../../src/data/recipes/recipes';
import { BLUEPRINTS } from '../../src/data/blueprints/blueprints';
import { FURNITURE } from '../../src/data/furniture/furniture';

/**
 * Cross-module integration for this agent's module: the craft data is resolved against the
 * REAL content pack (all other agents' data), and the end-to-end player loop is exercised on
 * a real GameState created by WorldFactory and living in the real home interior.
 */
function createRealHarness() {
  const content = new ContentRegistry(CONTENT_PACK);
  const state = createInitialGameState({
    seed: 20240601,
    playerName: 'Ash',
    appearance: { ...DEFAULT_APPEARANCE },
    content,
  });
  const probability = new ProbabilityEngine();
  probability.init(state.meta.seed, state.probability);
  const clock = new Clock(state.clock);
  const bus = new EventBus();
  const registry = new SystemRegistry(bus);
  const skill = new SkillSystem();
  const crafting = new CraftingSystem();
  const cooking = new CookingSystem();
  const building = new BuildingSystem();
  const housing = new HousingSystem();
  const collection = new CollectionSystem();
  const farming = new FarmingSystem();
  for (const system of [skill, farming, crafting, cooking, building, housing, collection]) registry.register(system);
  const ctx = createGameContext({
    state,
    content,
    probability,
    bus,
    clock,
    registry,
    rng: new RngFacade(probability),
    logger: new MemoryLogger(),
  });
  registry.initAll(ctx);
  const give = (itemId: string, quantity: number): void => {
    const def = content.getItem(itemId);
    addItemToInventory(state.player.inventory, itemId, quantity, {
      quality: 3,
      freshness: 1,
      simTime: clock.simTimeSeconds,
      maxStack: def?.maxStack ?? 99,
    });
  };
  const advance = (simSeconds: number): void => {
    clock.advanceSimSeconds(simSeconds);
    state.clock.simTimeSeconds = clock.simTimeSeconds;
    registry.updateAll(simSeconds);
  };
  return { content, state, probability, clock, bus, registry, ctx, skill, farming, crafting, cooking, building, housing, collection, give, advance };
}

describe('Craft module against the real content pack', () => {
  it('resolves every item referenced by its recipes, blueprints and furniture', () => {
    const content = new ContentRegistry(CONTENT_PACK);
    const missing: string[] = [];
    for (const recipe of RECIPES) {
      for (const input of recipe.inputs) if (!content.getItem(input.itemId)) missing.push(recipe.id + ' input ' + input.itemId);
      for (const output of recipe.outputs) if (!content.getItem(output.itemId)) missing.push(recipe.id + ' output ' + output.itemId);
      if (recipe.unlockItemId && !content.getItem(recipe.unlockItemId)) missing.push(recipe.id + ' unlock ' + recipe.unlockItemId);
    }
    for (const blueprint of BLUEPRINTS) {
      for (const input of blueprint.inputs) {
        if (!content.getItem(input.itemId)) missing.push(blueprint.id + ' input ' + input.itemId);
      }
    }
    for (const def of FURNITURE) if (!content.getFurniture(def.id)) missing.push('furniture def ' + def.id);
    expect(missing).toEqual([]);
    expect(content.getRecipe('craft_plank')).toBeDefined();
    expect(content.getBlueprint('bp_greenhouse_basic')).toBeDefined();
    expect(content.getCollectionCategory('fish')).toBeDefined();
  });

  it('finds a workbench and kitchen in the real home so recipes are reachable', () => {
    const harness = createRealHarness();
    expect(harness.state.player.position.locationId).toBe(HOME_INTERIOR_ID);
    const homeDef = harness.content.getLocation(HOME_INTERIOR_ID);
    expect(homeDef).toBeDefined();
    const facilities = homeDef?.facilities ?? [];
    expect(facilities).toContain('workbench');
    expect(facilities).toContain('kitchen');
    const stations = harness.crafting.getStationAvailability();
    expect(stations.workbench).toBe(true);
    expect(stations.kitchen).toBe(true);
    expect(stations.forge).toBe(true);
  });

  it('runs the full craft -> cook -> furnish -> build -> donate loop on real data', () => {
    const harness = createRealHarness();
    const { state, content, collection } = harness;

    // 1) Craft planks at the real home workbench.
    harness.give(ITEM.wood, 6);
    expect(harness.crafting.craft('craft_plank', 2).ok).toBe(true);
    harness.advance(3600);
    expect(countItem(state.player.inventory, ITEM.plank)).toBe(4);
    expect(state.player.statistics.itemsCrafted).toBe(4);

    // 2) Cook a real soup at the real kitchen.
    harness.give(ITEM.carrot, 2);
    harness.give(ITEM.potato, 1);
    harness.give(ITEM.onion, 1);
    harness.give(ITEM.salt, 1);
    expect(harness.cooking.cook('cook_vegetable_soup').ok).toBe(true);
    expect(countItem(state.player.inventory, ITEM.vegetableSoup)).toBe(1);
    expect(state.player.statistics.mealsCooked).toBe(1);

    // 3) Furnish the real player home with a real furniture item.
    const bedDef = content.getItem(ITEM.bedSimple);
    addItemToInventory(state.player.inventory, ITEM.bedSimple, 1, {
      quality: 1,
      freshness: 1,
      simTime: harness.clock.simTimeSeconds,
      maxStack: bedDef?.maxStack ?? 1,
    });
    const bedEntry = state.player.inventory.find((entry) => entry.itemId === ITEM.bedSimple);
    expect(harness.housing.placeFurniture(bedEntry?.instanceId ?? '', 1, 1, 0).ok).toBe(true);
    expect(state.housing.homes['home_player']?.comfort ?? 0).toBeGreaterThan(0);

    // 4) Build a real greenhouse at home.
    harness.skill.addXp('gardening', 400, 'integration');
    harness.give(ITEM.greenhouseKit, 1);
    harness.give(ITEM.wood, 10);
    harness.give(ITEM.stone, 8);
    expect(harness.building.startProject('bp_greenhouse_basic', state.player.position.locationId).ok).toBe(true);
    harness.advance(30 * 60);
    expect(Object.keys(state.farming.greenhouses)).toHaveLength(1);
    expect(Object.keys(state.farming.plots)).toHaveLength(4);
    expect(state.housing.homes['home_player']?.gardens).toContain('bp_greenhouse_basic');

    // 5) Donate the cooked dish at the real Ashford museum.
    const museumLocation = interiorIdFor(LOC.museum);
    state.player.position.locationId = museumLocation;
    const progressBefore = collection.getProgress().donated;
    expect(collection.donateToMuseum(ITEM.vegetableSoup).ok).toBe(true);
    expect(collection.getProgress().donated).toBe(progressBefore + 1);
  });

  it('hands finished greenhouse plots to the real FarmingSystem', () => {
    const harness = createRealHarness();
    harness.skill.addXp('gardening', 400, 'integration');
    harness.give(ITEM.greenhouseKit, 1);
    harness.give(ITEM.wood, 10);
    harness.give(ITEM.stone, 8);
    expect(harness.building.startProject('bp_greenhouse_basic', harness.state.player.position.locationId).ok).toBe(true);
    harness.advance(30 * 60);
    const greenhouse = Object.values(harness.state.farming.greenhouses)[0];
    expect(greenhouse).toBeDefined();
    const plotId = greenhouse?.plots[0] ?? '';
    expect(harness.farming.isGreenhousePlot(plotId)).toBe(true);
    expect(harness.farming.getPlot(plotId)?.stage).toBe('tilled');

    // In winter a turnip would never grow outside; inside the greenhouse it is plantable.
    harness.state.world.environment.season = 'winter';
    harness.state.player.position.locationId = LOC.home;
    harness.give(ITEM.turnipSeed, 1);
    const planted = harness.farming.plantSeed(plotId, ITEM.turnipSeed);
    expect(planted.ok).toBe(true);
    expect(harness.farming.getPlot(plotId)?.cropId).toBe('turnip');
  });

  it('serves collection progress from the real item catalog', () => {
    const harness = createRealHarness();
    const progress = harness.collection.getProgress();
    expect(progress.total).toBeGreaterThan(30);
    const categories = harness.collection.getCategoryProgress();
    const fish = categories.find((category) => category.id === 'fish');
    expect(fish?.total).toBeGreaterThan(10);
    const plants = categories.find((category) => category.id === 'plants');
    expect(plants?.total).toBeGreaterThan(5);
    // Furniture must not leak into the naturalist's catalog.
    const catalogIds = harness.collection.getCatalog().map((item) => item.id);
    expect(catalogIds).not.toContain(ITEM.bedSimple);
    expect(catalogIds).not.toContain(ITEM.pottedPlant);
  });
});
