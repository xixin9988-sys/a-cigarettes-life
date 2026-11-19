import { describe, expect, it } from 'vitest';
import type { ItemDef } from '../../src/data/schema';
import { CRAFTED_ITEMS } from '../../src/data/items/crafted';
import { FURNITURE } from '../../src/data/furniture/furniture';
import { BLUEPRINTS } from '../../src/data/blueprints/blueprints';
import { RECIPES } from '../../src/data/recipes/recipes';
import { COLLECTION_CATEGORIES } from '../../src/data/collection/categories';
import { ALL_ITEM_IDS, ITEM } from '../../src/data/items/ids';

const canonicalIds = new Set<string>(ALL_ITEM_IDS);
const byId = new Map<string, ItemDef>(CRAFTED_ITEMS.map((item) => [item.id, item]));

const PROCESSED_MATERIALS = [
  ITEM.glass,
  ITEM.cloth,
  ITEM.leather,
  ITEM.paper,
  ITEM.ink,
  ITEM.paint,
  ITEM.ceramic,
  ITEM.brass,
  ITEM.plank,
  ITEM.brick,
  ITEM.nail,
  ITEM.compost,
  ITEM.fertilizer,
  ITEM.candleWax,
  ITEM.beeswax,
];

const FURNITURE_ITEMS = [
  ITEM.bedSimple,
  ITEM.bedComfortable,
  ITEM.tableWood,
  ITEM.chairWood,
  ITEM.sofaComfy,
  ITEM.bookshelf,
  ITEM.wardrobe,
  ITEM.storageChest,
  ITEM.fireplace,
  ITEM.rugWarm,
  ITEM.floorLamp,
  ITEM.pottedPlant,
  ITEM.wallPainting,
  ITEM.kitchenCounter,
  ITEM.stove,
  ITEM.workbenchHome,
  ITEM.displayCase,
  ITEM.gardenBench,
  ITEM.pictureFrame,
  ITEM.wallClock,
  ITEM.vaseFlowers,
  ITEM.candleHolder,
  ITEM.mirror,
  ITEM.curtain,
  ITEM.windChime,
];

const BUILDING_ITEMS = [ITEM.greenhouseKit, ITEM.fencePicket, ITEM.flowerBed, ITEM.birdBath, ITEM.stonePath];
const CRAFTED_TOOLS = [ITEM.fishingRodGood, ITEM.fishingRodMaster];

describe('Item data - crafted.ts', () => {
  it('defines every item this agent owns exactly once', () => {
    const ids = CRAFTED_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(canonicalIds.has(id)).toBe(true);
    for (const id of [...PROCESSED_MATERIALS, ...FURNITURE_ITEMS, ...BUILDING_ITEMS, ...CRAFTED_TOOLS]) {
      expect(byId.has(id)).toBe(true);
    }
  });

  it('has complete, useful item definitions', () => {
    for (const item of CRAFTED_ITEMS) {
      expect(item.name.length).toBeGreaterThan(2);
      expect(item.description.length).toBeGreaterThan(15);
      expect(item.basePrice).toBeGreaterThan(0);
      expect(item.maxStack).toBeGreaterThanOrEqual(1);
      expect(item.visual.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(item.visual.shape.length).toBeGreaterThan(1);
      if (item.category === 'furniture') expect(item.furnitureId).toBe(item.id);
    }
  });

  it('links the crafted fishing rods to the fishing skill', () => {
    for (const id of CRAFTED_TOOLS) {
      const item = byId.get(id);
      expect(item?.toolSkill).toBe('fishing');
      expect(item?.toolTier).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('Furniture data', () => {
  it('has one valid FurnitureDef per furniture item', () => {
    const ids = FURNITURE.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(FURNITURE.length).toBeGreaterThanOrEqual(25);
    for (const def of FURNITURE) {
      expect(def.id).toBe(def.itemId);
      expect(canonicalIds.has(def.itemId)).toBe(true);
      expect(byId.has(def.itemId)).toBe(true);
      expect(['floor', 'wall', 'surface', 'outdoor']).toContain(def.slot);
      expect(def.widthTiles).toBeGreaterThanOrEqual(1);
      expect(def.heightTiles).toBeGreaterThanOrEqual(1);
      expect(def.storageSlots).toBeGreaterThanOrEqual(0);
      expect(def.comfort).toBeGreaterThanOrEqual(0);
      expect(def.comfort).toBeLessThanOrEqual(1);
      expect(def.decor).toBeGreaterThanOrEqual(0);
      expect(def.decor).toBeLessThanOrEqual(1);
      expect(def.description.length).toBeGreaterThan(10);
      expect(def.tags.length).toBeGreaterThan(0);
    }
  });

  it('has a FurnitureDef for every furniture item in crafted.ts', () => {
    for (const item of CRAFTED_ITEMS) {
      if (item.category !== 'furniture') continue;
      const def = FURNITURE.find((candidate) => candidate.itemId === item.id);
      expect(def).toBeDefined();
    }
  });

  it('provides the home crafting stations through placed furniture', () => {
    const tags = FURNITURE.filter((def) => def.tags.includes('workstation')).map((def) => def.itemId);
    expect(tags).toContain(ITEM.workbenchHome);
    expect(tags).toContain(ITEM.stove);
    expect(tags).toContain(ITEM.kitchenCounter);
  });
});

describe('Recipe data', () => {
  it('ships a full crafting and cooking book', () => {
    const craftRecipes = RECIPES.filter((recipe) => recipe.category === 'craft');
    const cookRecipes = RECIPES.filter((recipe) => recipe.category === 'cook');
    expect(craftRecipes.length).toBeGreaterThanOrEqual(30);
    expect(cookRecipes.length).toBeGreaterThanOrEqual(25);
    const ids = RECIPES.map((recipe) => recipe.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only references canonical item ids that exist in an item module', () => {
    for (const recipe of RECIPES) {
      expect(recipe.inputs.length).toBeGreaterThan(0);
      expect(recipe.outputs.length).toBeGreaterThan(0);
      for (const input of recipe.inputs) {
        expect(canonicalIds.has(input.itemId)).toBe(true);
        expect(input.quantity).toBeGreaterThan(0);
      }
      for (const output of recipe.outputs) {
        expect(canonicalIds.has(output.itemId)).toBe(true);
        expect(output.quantity).toBeGreaterThan(0);
      }
      if (recipe.unlockItemId) expect(canonicalIds.has(recipe.unlockItemId)).toBe(true);
    }
  });

  it('has sane gameplay values', () => {
    for (const recipe of RECIPES) {
      expect(recipe.name.length).toBeGreaterThan(2);
      expect(recipe.description.length).toBeGreaterThan(10);
      expect(recipe.hours).toBeGreaterThan(0);
      expect(recipe.hours).toBeLessThanOrEqual(24);
      expect(recipe.levelReq).toBeGreaterThanOrEqual(1);
      expect(recipe.levelReq).toBeLessThanOrEqual(20);
      expect(recipe.tags.length).toBeGreaterThan(0);
      expect(recipe.visual.color).toMatch(/^#[0-9a-f]{6}$/i);
      if (recipe.category === 'cook') expect(recipe.station === 'kitchen' || recipe.station === 'campfire').toBe(true);
      else expect(['workbench', 'forge', 'art_studio', 'campfire', 'none']).toContain(recipe.station);
    }
  });

  it('covers every furniture piece with a recipe', () => {
    for (const itemId of FURNITURE_ITEMS) {
      const recipe = RECIPES.find(
        (candidate) => candidate.category === 'craft' && candidate.outputs.some((output) => output.itemId === itemId)
      );
      expect(recipe).toBeDefined();
    }
  });

  it('covers the ash-product loop', () => {
    const ashOutputs = new Set<string>();
    for (const recipe of RECIPES) {
      if (!recipe.inputs.some((input) => input.itemId === ITEM.cigaretteAsh)) continue;
      for (const output of recipe.outputs) ashOutputs.add(output.itemId);
    }
    expect(ashOutputs.has(ITEM.paintPigment)).toBe(true);
    expect(ashOutputs.has(ITEM.ashFertilizer)).toBe(true);
    expect(ashOutputs.has(ITEM.ashGlaze)).toBe(true);
  });

  it('covers the cigarette protection gear', () => {
    const protectionOutputs = new Set<string>();
    for (const recipe of RECIPES) {
      if (!recipe.tags.includes('protection')) continue;
      for (const output of recipe.outputs) protectionOutputs.add(output.itemId);
    }
    for (const id of [ITEM.miniUmbrella, ITEM.waterproofCase, ITEM.windbreakScreen, ITEM.waxedPaperCoat, ITEM.brassWindGuard]) {
      expect(protectionOutputs.has(id)).toBe(true);
    }
  });
});

describe('Blueprint data', () => {
  it('ships at least twelve valid blueprints', () => {
    expect(BLUEPRINTS.length).toBeGreaterThanOrEqual(12);
    const ids = BLUEPRINTS.map((blueprint) => blueprint.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const blueprint of BLUEPRINTS) {
      expect(blueprint.name.length).toBeGreaterThan(2);
      expect(blueprint.description.length).toBeGreaterThan(10);
      expect(blueprint.inputs.length).toBeGreaterThan(0);
      expect(blueprint.buildHours).toBeGreaterThan(0);
      expect(blueprint.levelReq).toBeGreaterThanOrEqual(1);
      expect(blueprint.effects.length).toBeGreaterThan(0);
      expect(['room', 'greenhouse', 'farm_facility', 'home_expansion', 'store_decoration', 'garden']).toContain(
        blueprint.kind
      );
      for (const input of blueprint.inputs) {
        expect(canonicalIds.has(input.itemId)).toBe(true);
        expect(input.quantity).toBeGreaterThan(0);
      }
    }
  });

  it('has the expected blueprint families', () => {
    const kinds = new Set(BLUEPRINTS.map((blueprint) => blueprint.kind));
    expect(kinds.has('room')).toBe(true);
    expect(kinds.has('greenhouse')).toBe(true);
    expect(kinds.has('garden')).toBe(true);
    expect(kinds.has('farm_facility')).toBe(true);
    expect(kinds.has('home_expansion')).toBe(true);
    expect(kinds.has('store_decoration')).toBe(true);
    const rooms = BLUEPRINTS.filter((blueprint) => blueprint.kind === 'room');
    for (const room of rooms) expect(typeof room.unlocksRoomId).toBe('string');
    const greenhouses = BLUEPRINTS.filter((blueprint) => blueprint.kind === 'greenhouse');
    expect(greenhouses.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Collection category data', () => {
  it('declares ten well-formed categories', () => {
    expect(COLLECTION_CATEGORIES).toHaveLength(10);
    const ids = COLLECTION_CATEGORIES.map((category) => category.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const category of COLLECTION_CATEGORIES) {
      expect(category.name.length).toBeGreaterThan(2);
      expect(category.description.length).toBeGreaterThan(10);
      expect(category.itemTags.length).toBeGreaterThan(0);
      expect(category.icon.length).toBeGreaterThan(0);
    }
    const required = ['fish', 'insects', 'minerals', 'flowers', 'plants', 'food', 'recipes', 'photographs', 'festival', 'mementos'];
    for (const id of required) expect(ids).toContain(id);
  });
});
