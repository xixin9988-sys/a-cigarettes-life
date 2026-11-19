import { describe, expect, it } from 'vitest';
import { CORE_ITEMS } from '../../src/data/items/core';
import { NATURE_ITEMS } from '../../src/data/items/nature';
import { CRAFTED_ITEMS } from '../../src/data/items/crafted';
import { LIFE_ITEMS } from '../../src/data/items/life';
import { BUSINESSES } from '../../src/data/shops/shops';
import { ITEM, ALL_ITEM_IDS } from '../../src/data/items/ids';
import { BIZ, ALL_BUSINESS_IDS } from '../../src/data/shops/ids';
import { MAJOR_NPC_IDS } from '../../src/data/npcs/ids';
import { LOCATIONS } from '../../src/data/locations/locations';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import { ITEM_CATEGORIES, EQUIPMENT_SLOTS, SKILL_IDS, type ItemCategory } from '../../src/core/SharedTypes';
import type { BusinessType } from '../../src/data/schema';

const OTHER_ITEMS = [...NATURE_ITEMS, ...CRAFTED_ITEMS, ...LIFE_ITEMS];
const ALL_ITEMS = [...CORE_ITEMS, ...OTHER_ITEMS];
const ALL_ITEM_ID_SET = new Set<string>(ALL_ITEM_IDS);

const BUSINESS_TYPES: readonly BusinessType[] = [
  'cafe',
  'bakery',
  'flower_shop',
  'grocery',
  'bookshop',
  'post_office',
  'library',
  'market_stall',
  'restaurant',
  'supermarket',
  'convenience_store',
  'clothing_shop',
  'furniture_shop',
  'electronics_shop',
  'cinema',
  'museum',
  'farm',
  'player_shop',
];

const OWNED_TOOL_IDS = [
  ITEM.fishingRodBasic,
  ITEM.axe,
  ITEM.pickaxe,
  ITEM.hoe,
  ITEM.wateringCan,
  ITEM.wateringCanLarge,
  ITEM.shovel,
  ITEM.bugNet,
  ITEM.camera,
  ITEM.paintbrush,
  ITEM.hammer,
  ITEM.sewingKit,
  ITEM.cookingPot,
  ITEM.pan,
  ITEM.workbenchKit,
  ITEM.lantern,
  ITEM.backpack,
];

const OWNED_FOOD_DRINK_IDS = [
  ITEM.breadLoaf,
  ITEM.cheeseWedge,
  ITEM.vegetableSoup,
  ITEM.applePie,
  ITEM.strawberryCake,
  ITEM.cheeseSandwich,
  ITEM.gardenSalad,
  ITEM.fishStew,
  ITEM.teaCup,
  ITEM.coffeeCup,
  ITEM.lemonade,
  ITEM.cider,
  ITEM.hotChocolate,
  ITEM.honeyJar,
  ITEM.berryJam,
  ITEM.mushroomSoup,
  ITEM.roastDinner,
  ITEM.picnicBasket,
  ITEM.herbalTea,
];

const OWNED_INGREDIENT_IDS = [
  ITEM.flour,
  ITEM.sugar,
  ITEM.salt,
  ITEM.butter,
  ITEM.milk,
  ITEM.egg,
  ITEM.cheese,
  ITEM.dough,
  ITEM.pieDough,
  ITEM.jam,
  ITEM.teaLeaves,
  ITEM.coffeeBeans,
  ITEM.honey,
  ITEM.oil,
];

const OWNED_BOOK_IDS = [
  ITEM.gardeningBook,
  ITEM.fishingBook,
  ITEM.localHistoryBook,
  ITEM.recipeBook,
  ITEM.romanceNovel,
  ITEM.artBook,
  ITEM.museumGuide,
  ITEM.townAlmanac,
];

const OWNED_CLOTHING_IDS = [ITEM.raincoat, ITEM.wellyBoots, ITEM.sunHat, ITEM.scarf, ITEM.townCoat, ITEM.workApron];

const OWNED_GIFT_IDS = [
  ITEM.bouquet,
  ITEM.giftBox,
  ITEM.handmadeCandle,
  ITEM.plushCigarette,
  ITEM.friendshipBracelet,
  ITEM.paintedCard,
  ITEM.oldCoin,
  ITEM.messageBottle,
  ITEM.pressedFlower,
  ITEM.fossil,
  ITEM.crystal,
  ITEM.musicBox,
  ITEM.oldLetter,
  ITEM.antiqueKey,
  ITEM.silverLocket,
];

const OWNED_MISC_IDS = [
  ITEM.cameraFilm,
  ITEM.photoPaper,
  ITEM.artSupplies,
  ITEM.festivalRibbon,
  ITEM.harvestCrown,
  ITEM.goldenSeed,
  ITEM.rainbowScale,
  ITEM.legendaryLure,
  ITEM.mysteriousLetter,
];

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

describe('CORE_ITEMS data integrity', () => {
  it('declares unique, canonical item ids and never duplicates another module id', () => {
    const ids = CORE_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(ALL_ITEM_ID_SET.has(id), 'unknown canonical id: ' + id).toBe(true);
    const otherIds = new Set(OTHER_ITEMS.map((item) => item.id));
    for (const id of ids) {
      expect(otherIds.has(id), 'item id also declared by another data module: ' + id).toBe(false);
    }
    // Every item id across all modules must be defined exactly once.
    const allIds = ALL_ITEMS.map((item) => item.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('defines every item id group assigned to the economy domain', () => {
    const ownedIds = new Set(CORE_ITEMS.map((item) => item.id));
    const required = [
      ...OWNED_TOOL_IDS,
      ...OWNED_FOOD_DRINK_IDS,
      ...OWNED_INGREDIENT_IDS,
      ...OWNED_BOOK_IDS,
      ...OWNED_CLOTHING_IDS,
      ...OWNED_GIFT_IDS,
      ...OWNED_MISC_IDS,
    ];
    expect(required.length).toBe(88);
    for (const id of required) expect(ownedIds.has(id), 'missing core item: ' + id).toBe(true);
  });

  it('has complete, balanced and renderable ItemDefs', () => {
    for (const item of CORE_ITEMS) {
      expect(item.name.length, item.id).toBeGreaterThan(2);
      expect(item.description.length, item.id).toBeGreaterThan(25);
      expect(Number.isInteger(item.basePrice), item.id).toBe(true);
      expect(item.basePrice, item.id).toBeGreaterThanOrEqual(1);
      expect(item.basePrice, item.id).toBeLessThanOrEqual(10000);
      expect(ITEM_CATEGORIES.includes(item.category as ItemCategory), item.id).toBe(true);
      expect(item.tags.length, item.id).toBeGreaterThan(0);
      expect(isHexColor(item.visual.color), item.id + ' visual colour').toBe(true);
      if (item.visual.accent) expect(isHexColor(item.visual.accent), item.id + ' accent').toBe(true);
      expect(item.stackable || item.maxStack === 1, item.id).toBe(true);
      if (item.stackable) expect(item.maxStack, item.id).toBeGreaterThanOrEqual(2);
      if (item.rarity !== undefined) {
        expect(item.rarity, item.id).toBeGreaterThanOrEqual(1);
        expect(item.rarity, item.id).toBeLessThanOrEqual(5);
      }
    }
  });

  it('gives tools, books, clothing, food, gifts and collectibles their behaviour fields', () => {
    const byId = new Map(CORE_ITEMS.map((item) => [item.id, item]));
    for (const id of OWNED_TOOL_IDS) {
      const item = byId.get(id);
      expect(item, id).toBeDefined();
      expect(item?.category, id).toBe('tool');
      expect(item?.toolSkill, id).toBeDefined();
      expect(SKILL_IDS.includes(item?.toolSkill ?? 'gardening'), id).toBe(true);
      expect(item?.toolTier, id).toBeGreaterThanOrEqual(1);
      expect(item?.equipmentSlot, id).toBeDefined();
      expect(EQUIPMENT_SLOTS.includes(item?.equipmentSlot ?? 'tool'), id).toBe(true);
    }
    for (const id of OWNED_BOOK_IDS) {
      const item = byId.get(id);
      expect(item?.category, id).toBe('book');
      expect(item?.readSkill, id).toBeDefined();
      expect(item?.effects?.some((effect) => effect.kind === 'skill_xp'), id).toBe(true);
    }
    for (const id of OWNED_CLOTHING_IDS) {
      const item = byId.get(id);
      expect(item?.category, id).toBe('clothing');
      expect(item?.equipmentSlot, id).toBeDefined();
      expect(item?.tags, id).toContain('clothing');
    }
    for (const id of OWNED_FOOD_DRINK_IDS) {
      const item = byId.get(id);
      expect(item?.edible, id).toBe(true);
      expect(item?.nutrition, id).toBeGreaterThan(0);
      expect(item?.effects?.length, id).toBeGreaterThan(0);
      expect(item?.category === 'food' || item?.category === 'drink', id).toBe(true);
    }
    for (const id of OWNED_INGREDIENT_IDS) {
      const item = byId.get(id);
      expect(item?.category, id).toBe('material');
      expect(item?.tags, id).toContain('ingredient');
      expect(item?.tags, id).toContain('cooking');
    }
    for (const id of OWNED_GIFT_IDS) {
      const item = byId.get(id);
      expect(item, id).toBeDefined();
      const isGift = item?.category === 'gift';
      const isCollectible = item?.category === 'collectible';
      expect(isGift || isCollectible, id).toBe(true);
      if (isGift) {
        expect(item?.giftTasteTags?.length, id).toBeGreaterThan(0);
        expect(item?.tags, id).toContain('giftable');
      } else {
        expect(item?.tags, id).toContain('collectible');
        expect(item?.rarity, id).toBeDefined();
      }
    }
  });
});

describe('BUSINESSES data integrity', () => {
  it('covers every canonical business id exactly once', () => {
    const ids = BUSINESSES.map((business) => business.id);
    expect(ids.length).toBe(22);
    expect(new Set(ids).size).toBe(22);
    for (const id of ALL_BUSINESS_IDS) expect(ids, 'missing ' + id).toContain(id);
    for (const id of ids) expect(ALL_BUSINESS_IDS, 'stray ' + id).toContain(id);
  });

  it('has realistic owners, hours, reputation and markup', () => {
    const locationIds = new Set(LOCATIONS.map((location) => location.id));
    const majorIds = new Set<string>(MAJOR_NPC_IDS);
    const names = new Set<string>();
    let ownerCount = 0;
    let forSaleCount = 0;
    for (const business of BUSINESSES) {
      expect(names.has(business.name), business.id + ' duplicate name').toBe(false);
      names.add(business.name);
      expect(business.description.length, business.id).toBeGreaterThan(40);
      expect(BUSINESS_TYPES.includes(business.type), business.id + ' type').toBe(true);
      expect(locationIds.has(business.locationId), business.id + ' location ' + business.locationId).toBe(true);
      if (business.ownerNpcId !== null) {
        ownerCount += 1;
        expect(majorIds.has(business.ownerNpcId), business.id + ' owner ' + business.ownerNpcId).toBe(true);
      } else {
        forSaleCount += 1;
      }
      expect(business.reputation, business.id).toBeGreaterThanOrEqual(40);
      expect(business.reputation, business.id).toBeLessThanOrEqual(75);
      expect(business.priceMarkup, business.id).toBeGreaterThanOrEqual(0.9);
      expect(business.priceMarkup, business.id).toBeLessThanOrEqual(1.25);
      const moneyRange = WORLD_CONFIG.economyStarting.businessMoneyRangePence;
      expect(business.initialMoney, business.id).toBeGreaterThanOrEqual(moneyRange[0]);
      expect(business.initialMoney, business.id).toBeLessThanOrEqual(moneyRange[1]);
      expect(Number.isInteger(business.openHour), business.id).toBe(true);
      expect(Number.isInteger(business.closeHour), business.id).toBe(true);
      expect(business.openHour, business.id).toBeGreaterThanOrEqual(5);
      expect(business.closeHour, business.id).toBeLessThanOrEqual(23);
      expect(business.closeHour, business.id).toBeGreaterThan(business.openHour);
      if (business.supplierBusinessId) {
        expect(ALL_BUSINESS_IDS, business.id + ' supplier').toContain(business.supplierBusinessId);
        expect(business.supplierBusinessId, business.id + ' self supply').not.toBe(business.id);
      }
    }
    expect(ownerCount).toBeGreaterThanOrEqual(8);
    expect(forSaleCount).toBeGreaterThanOrEqual(5);
  });

  it('stocks 8-20 existing items per business with sane prices and restock targets', () => {
    const itemIds = new Set<string>(ALL_ITEMS.map((item) => item.id));
    const itemsById = new Map(ALL_ITEMS.map((item) => [item.id, item]));
    for (const business of BUSINESSES) {
      expect(business.stock.length, business.id).toBeGreaterThanOrEqual(8);
      expect(business.stock.length, business.id).toBeLessThanOrEqual(20);
      const seen = new Set<string>();
      for (const line of business.stock) {
        expect(itemIds.has(line.itemId), business.id + ' stocks unknown ' + line.itemId).toBe(true);
        expect(seen.has(line.itemId), business.id + ' duplicate stock ' + line.itemId).toBe(false);
        seen.add(line.itemId);
        expect(Number.isInteger(line.quantity), business.id).toBe(true);
        expect(line.quantity, business.id + ' ' + line.itemId).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(line.restockTarget), business.id).toBe(true);
        expect(line.restockTarget, business.id + ' ' + line.itemId).toBeGreaterThanOrEqual(line.quantity);
        expect(line.priceMultiplier, business.id + ' ' + line.itemId).toBeGreaterThanOrEqual(0.75);
        expect(line.priceMultiplier, business.id + ' ' + line.itemId).toBeLessThanOrEqual(1.3);
        const item = itemsById.get(line.itemId);
        expect(item?.basePrice, line.itemId).toBeGreaterThan(0);
      }
    }
  });

  it('offers real jobs with wages, shifts and player availability', () => {
    let playerAvailableJobs = 0;
    for (const business of BUSINESSES) {
      expect(business.jobs.length, business.id).toBeGreaterThanOrEqual(1);
      for (const job of business.jobs) {
        expect(job.title.length, business.id).toBeGreaterThan(2);
        expect(job.wagePerHour, business.id + ' ' + job.title).toBeGreaterThanOrEqual(600);
        expect(job.wagePerHour, business.id + ' ' + job.title).toBeLessThanOrEqual(1400);
        expect(Number.isInteger(job.wagePerHour), business.id).toBe(true);
        expect(job.startHour, business.id).toBeGreaterThanOrEqual(0);
        expect(job.endHour, business.id).toBeLessThanOrEqual(24);
        expect(job.endHour, business.id).toBeGreaterThan(job.startHour);
        expect(job.slots, business.id).toBeGreaterThanOrEqual(1);
        expect(job.levelReq ?? 1, business.id).toBeGreaterThanOrEqual(1);
        expect(typeof job.playerAvailable, business.id).toBe('boolean');
        if (job.skill) expect(SKILL_IDS.includes(job.skill), business.id).toBe(true);
        if (job.playerAvailable) playerAvailableJobs += 1;
      }
    }
    expect(playerAvailableJobs).toBeGreaterThanOrEqual(20);
  });
});
