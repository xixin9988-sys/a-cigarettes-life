import { describe, expect, it } from 'vitest';
import { NATURE_ITEMS } from '../../src/data/items/nature';
import { CROPS } from '../../src/data/crops/crops';
import { FISH, FORAGE_NODES } from '../../src/data/fish/fish';
import { ITEM, ALL_ITEM_IDS } from '../../src/data/items/ids';
import { ALL_EXTERIOR_LOCATION_IDS, LOC } from '../../src/data/locations/ids';
import { SEASONS, WEATHER_TYPES } from '../../src/core/SharedTypes';

const SEED_KEYS = [
  'turnipSeed', 'carrotSeed', 'potatoSeed', 'cabbageSeed', 'tomatoSeed', 'onionSeed', 'strawberrySeed',
  'pumpkinSeed', 'sunflowerSeed', 'tulipBulb', 'roseCutting', 'lavenderSeed', 'wheatSeed', 'barleySeed',
  'herbSeed', 'appleSapling', 'pearSapling', 'plumSapling', 'cherrySapling',
] as const;

const PRODUCE_KEYS = [
  'turnip', 'carrot', 'potato', 'cabbage', 'tomato', 'onion', 'strawberry', 'pumpkin', 'sunflower',
  'tulip', 'rose', 'lavender', 'wheat', 'barley', 'apple', 'pear', 'plum', 'cherry', 'blackberry',
  'raspberry', 'commonMushroom', 'rareMushroom', 'wildHerb', 'mint', 'rosemary',
] as const;

const FISH_KEYS = [
  'fishTrout', 'fishSalmon', 'fishCarp', 'fishPerch', 'fishPike', 'fishBass', 'fishEel', 'fishCatfish',
  'fishRoach', 'fishBream', 'fishTench', 'fishChub', 'fishGrayling', 'fishSilverEel', 'fishMoonfish', 'junkBoot',
] as const;

const MATERIAL_KEYS = [
  'wood', 'stone', 'ironOre', 'copperOre', 'silverOre', 'clay', 'feather', 'beetle', 'butterfly',
  'wildBerries', 'wildMushroom', 'fibre', 'resin', 'wax', 'coal', 'charcoal', 'glassShard', 'scrapMetal',
  'oldClue', 'hiddenKey', 'warehouseKey', 'gardenKey',
] as const;

const ALL_NATURE_KEYS = [...SEED_KEYS, ...PRODUCE_KEYS, ...FISH_KEYS, ...MATERIAL_KEYS];
const KNOWN_LOCATION_IDS = new Set<string>(ALL_EXTERIOR_LOCATION_IDS);
const WATER_TYPES = new Set(['river', 'lake', 'stream', 'pond', 'canal']);

describe('nature item data', () => {
  it('defines exactly the nature item ids owned by this module', () => {
    const ids = NATURE_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(ALL_NATURE_KEYS.length);
    for (const key of ALL_NATURE_KEYS) {
      const expectedId = ITEM[key];
      expect(ids.filter((id) => id === expectedId)).toHaveLength(1);
    }
  });

  it('every nature item id is registered in ALL_ITEM_IDS', () => {
    const registered = new Set(ALL_ITEM_IDS);
    for (const item of NATURE_ITEMS) expect(registered.has(item.id)).toBe(true);
  });

  it('has sane definitions for every item', () => {
    for (const item of NATURE_ITEMS) {
      expect(item.name.length).toBeGreaterThan(1);
      expect(item.description.length).toBeGreaterThan(10);
      expect(Number.isInteger(item.basePrice)).toBe(true);
      expect(item.basePrice).toBeGreaterThanOrEqual(0);
      expect(item.maxStack).toBeGreaterThanOrEqual(1);
      if (!item.stackable) expect(item.maxStack).toBe(1);
      expect(item.tags.length).toBeGreaterThan(0);
      expect(item.visual.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      if (item.edible) expect(item.nutrition ?? 0).toBeGreaterThan(0);
    }
  });

  it('seeds point at a crop and crops point back at the seed', () => {
    const cropById = new Map(CROPS.map((crop) => [crop.id, crop]));
    const itemById = new Map(NATURE_ITEMS.map((item) => [item.id, item]));
    for (const key of SEED_KEYS) {
      const item = itemById.get(ITEM[key]);
      expect(item).toBeDefined();
      expect(item?.category).toBe('seed');
      expect(item?.seedCropId).toBeDefined();
      const crop = cropById.get(item?.seedCropId ?? '');
      expect(crop, 'seed ' + key + ' references a crop').toBeDefined();
      expect(crop?.seedItemId).toBe(item?.id);
      expect(crop?.produceItemId).toBeDefined();
      expect(itemById.has(crop?.produceItemId ?? '')).toBe(true);
    }
  });

  it('fish items link to a FishDef by fishId', () => {
    const fishIds = new Set(FISH.map((fish) => fish.id));
    const itemById = new Map(NATURE_ITEMS.map((item) => [item.id, item]));
    for (const key of FISH_KEYS) {
      const item = itemById.get(ITEM[key]);
      expect(item).toBeDefined();
      expect(item?.fishId).toBeDefined();
      expect(fishIds.has(item?.fishId ?? '')).toBe(true);
    }
  });
});

describe('crop data', () => {
  it('defines 19 crops with the expected ids', () => {
    const ids = CROPS.map((crop) => crop.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(19);
    for (const id of ['turnip', 'carrot', 'potato', 'cabbage', 'tomato', 'onion', 'strawberry', 'pumpkin',
      'sunflower', 'tulip', 'rose', 'lavender', 'wheat', 'barley', 'herb', 'apple', 'pear', 'plum', 'cherry']) {
      expect(ids).toContain(id);
    }
  });

  it('every crop has valid stages, seasons, water, temperature and yield data', () => {
    for (const crop of CROPS) {
      expect(crop.stages.length).toBeGreaterThanOrEqual(3);
      expect(crop.stages.length).toBeLessThanOrEqual(5);
      for (const stage of crop.stages) {
        expect(stage.hours).toBeGreaterThan(0);
        expect(stage.heightHint).toBeGreaterThanOrEqual(0);
        expect(stage.heightHint).toBeLessThanOrEqual(1);
      }
      expect(crop.seasons.length).toBeGreaterThan(0);
      for (const season of crop.seasons) expect(SEASONS).toContain(season);
      expect(crop.waterPerHour).toBeGreaterThan(0);
      expect(crop.waterPerHour).toBeLessThanOrEqual(0.2);
      expect(crop.tempMin).toBeLessThan(crop.tempMax);
      expect(crop.fertilityMin).toBeGreaterThan(0);
      expect(crop.fertilityMin).toBeLessThanOrEqual(1);
      expect(crop.baseQuality).toBeGreaterThanOrEqual(1);
      expect(crop.baseQuality).toBeLessThanOrEqual(5);
      expect(crop.diseaseResistance).toBeGreaterThanOrEqual(0);
      expect(crop.diseaseResistance).toBeLessThanOrEqual(1);
      expect(crop.regrowHours).toBeGreaterThanOrEqual(0);
      expect(crop.ashAffinity).toBeGreaterThanOrEqual(0);
      expect(crop.baseYield).toBeGreaterThanOrEqual(1);
      expect(crop.description.length).toBeGreaterThan(20);
    }
  });

  it('links crops to existing nature items in both directions', () => {
    const itemById = new Map(NATURE_ITEMS.map((item) => [item.id, item]));
    for (const crop of CROPS) {
      const seed = itemById.get(crop.seedItemId);
      expect(seed, crop.id + ' seed item exists').toBeDefined();
      expect(seed?.seedCropId).toBe(crop.id);
      expect(itemById.has(crop.produceItemId), crop.id + ' produce item exists').toBe(true);
    }
  });

  it('is economically sane: seed cost is repaid by a harvest at the base sell ratio', () => {
    const itemById = new Map(NATURE_ITEMS.map((item) => [item.id, item]));
    for (const crop of CROPS) {
      const seed = itemById.get(crop.seedItemId);
      const produce = itemById.get(crop.produceItemId);
      expect(seed).toBeDefined();
      expect(produce).toBeDefined();
      if (!seed || !produce) continue;
      // EconomySystem buys player goods at 60% of the market price. A single-harvest
      // crop must repay its seed in one picking; regrowing crops (berries/herbs/trees)
      // are long-term investments repaid over their first three pickings.
      const harvests = crop.regrowHours > 0 ? 3 : 1;
      const totalGrowthHours = crop.stages.reduce((total, stage) => total + stage.hours, 0);
      const expectedIncome = produce.basePrice * (produce.hasQuality ? 1.2 : 1) * crop.baseYield * 0.6 * harvests;
      expect(expectedIncome, crop.id + ' ' + harvests + '-harvest income over ' + totalGrowthHours + 'h')
        .toBeGreaterThan(seed.basePrice * 1.05);
    }
  });

  it('has 4 fruit trees with regrowth and long growth cycles', () => {
    const trees = CROPS.filter((crop) => ['apple', 'pear', 'plum', 'cherry'].includes(crop.id));
    expect(trees).toHaveLength(4);
    for (const tree of trees) {
      expect(tree.seedItemId).toMatch(/sapling/);
      expect(tree.regrowHours).toBeGreaterThan(0);
      const totalHours = tree.stages.reduce((total, stage) => total + stage.hours, 0);
      expect(totalHours).toBeGreaterThanOrEqual(180);
    }
  });
});

describe('fish data', () => {
  it('defines 15 fish plus the junk boot', () => {
    expect(FISH).toHaveLength(16);
    const ids = FISH.map((fish) => fish.id);
    expect(new Set(ids).size).toBe(16);
    expect(ids).toContain('junk_boot');
    for (const id of ['trout', 'salmon', 'carp', 'perch', 'pike', 'bass', 'eel', 'catfish', 'roach',
      'bream', 'tench', 'chub', 'grayling', 'silver_eel', 'moonfish']) {
      expect(ids).toContain(id);
    }
  });

  it('has a matching catch item for every fish definition', () => {
    const fishItemIds = new Set(NATURE_ITEMS.filter((item) => item.fishId !== undefined).map((item) => item.fishId));
    for (const fish of FISH) {
      expect(fishItemIds.has(fish.id), 'item for fish ' + fish.id).toBe(true);
    }
  });

  it('uses real location ids and water tags for habitats', () => {
    for (const fish of FISH) {
      expect(fish.habitats.length).toBeGreaterThan(0);
      for (const habitat of fish.habitats) {
        const valid = KNOWN_LOCATION_IDS.has(habitat) || WATER_TYPES.has(habitat);
        expect(valid, fish.id + ' habitat ' + habitat).toBe(true);
      }
    }
  });

  it('has sane time, season, weather, size, difficulty and value data', () => {
    for (const fish of FISH) {
      expect(fish.seasons.length).toBeGreaterThan(0);
      for (const season of fish.seasons) expect(SEASONS).toContain(season);
      expect(fish.weathers.length).toBeGreaterThan(0);
      for (const weather of fish.weathers) expect(WEATHER_TYPES).toContain(weather);
      expect(fish.startHour).toBeGreaterThanOrEqual(0);
      expect(fish.endHour).toBeLessThanOrEqual(24);
      expect(fish.weight).toBeGreaterThan(0);
      expect(fish.minSizeCm).toBeGreaterThan(0);
      expect(fish.maxSizeCm).toBeGreaterThan(fish.minSizeCm);
      expect(fish.difficulty).toBeGreaterThanOrEqual(1);
      expect(fish.difficulty).toBeLessThanOrEqual(5);
      expect(fish.baseValue).toBeGreaterThan(0);
      expect(fish.skillReq).toBeGreaterThanOrEqual(0);
      expect(fish.rarity).toBeGreaterThanOrEqual(1);
      expect(fish.rarity).toBeLessThanOrEqual(5);
      expect(fish.description.length).toBeGreaterThan(20);
      if (fish.id !== 'junk_boot') expect(fish.baitTags.length).toBeGreaterThan(0);
    }
  });
});

describe('forage node data', () => {
  it('defines at least 25 nodes with unique ids', () => {
    expect(FORAGE_NODES.length).toBeGreaterThanOrEqual(25);
    const ids = FORAGE_NODES.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the required location kinds and valid items', () => {
    const itemIds = new Set(NATURE_ITEMS.map((item) => item.id));
    const locationIds = new Set(FORAGE_NODES.map((node) => node.locationId));
    for (const required of [LOC.forest, LOC.park, LOC.orchard, LOC.countryside, LOC.lake, LOC.river,
      LOC.abandonedFarmhouse, LOC.greenhouse]) {
      expect(locationIds.has(required), 'nodes at ' + required).toBe(true);
    }
    for (const node of FORAGE_NODES) {
      expect(KNOWN_LOCATION_IDS.has(node.locationId), node.id + ' location').toBe(true);
      expect(itemIds.has(node.itemId), node.id + ' item').toBe(true);
      expect(node.seasons.length).toBeGreaterThan(0);
      for (const season of node.seasons) expect(SEASONS).toContain(season);
      expect(node.respawnHours).toBeGreaterThan(0);
      expect(node.skillReq).toBeGreaterThanOrEqual(1);
      expect(node.yieldMin).toBeGreaterThanOrEqual(1);
      expect(node.yieldMax).toBeGreaterThanOrEqual(node.yieldMin);
      expect(node.tags.length).toBeGreaterThan(0);
      expect(node.description.length).toBeGreaterThan(10);
    }
  });

  it('exposes all resource families (mushrooms, berries, herbs, wood, stone, ore, insects, feathers)', () => {
    const tags = new Set(FORAGE_NODES.flatMap((node) => node.tags));
    for (const tag of ['mushroom', 'berry', 'herb', 'wood', 'stone', 'ore', 'insect', 'feather']) {
      expect(tags.has(tag), 'forage tag ' + tag).toBe(true);
    }
  });
});