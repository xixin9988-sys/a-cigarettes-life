import { describe, expect, it } from 'vitest';
import { createCraftHarness, FIXTURE_LOCATIONS, ITEMS, type CraftHarness } from './testkit';
import { ITEM } from '../../src/data/items/ids';
import type { StatusEffectState } from '../../src/core/contracts';

function cookQuality(harness: CraftHarness): number {
  const completed = [...harness.signals].reverse().find((signal) => signal.name === 'cook:completed');
  const data = completed?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 0;
  const quality = data['quality'];
  return typeof quality === 'number' ? quality : 0;
}

function foodBuffs(harness: CraftHarness): StatusEffectState[] {
  return harness.state.player.statusEffects.filter((effect) => effect.id.startsWith('cook:'));
}

function giveSoupIngredients(harness: CraftHarness): void {
  harness.give(ITEM.carrot, 2);
  harness.give(ITEM.potato, 1);
  harness.give(ITEM.onion, 1);
  harness.give(ITEM.salt, 1);
}

describe('CookingSystem - stations', () => {
  it('cooks at a kitchen facility', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.kitchen);
    giveSoupIngredients(harness);
    const result = harness.cooking.cook('cook_vegetable_soup');
    expect(result.ok).toBe(true);
    expect(harness.count(ITEM.carrot)).toBe(0);
    expect(harness.count(ITEM.vegetableSoup)).toBe(1);
    expect(harness.state.player.statistics.mealsCooked).toBe(1);
    expect(harness.state.cooking.mastery['cook_vegetable_soup']).toBe(1);
    const quality = cookQuality(harness);
    expect(quality).toBeGreaterThanOrEqual(1);
    expect(quality).toBeLessThanOrEqual(5);
  });

  it('refuses to cook without any station', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.farField);
    giveSoupIngredients(harness);
    const result = harness.cooking.cook('cook_vegetable_soup');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong_location');
    expect(harness.count(ITEM.carrot)).toBe(2);
  });

  it('gets a kitchen station from a placed stove at home', () => {
    const harness = createCraftHarness();
    const stoveId = harness.giveFurniture(ITEM.stove);
    expect(harness.housing.placeFurniture(stoveId, 1, 1, 0).ok).toBe(true);
    expect(harness.cooking.hasStation('kitchen')).toBe(true);
    giveSoupIngredients(harness);
    expect(harness.cooking.cook('cook_vegetable_soup').ok).toBe(true);
  });

  it('uses a campfire for campfire recipes only', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.kitchen);
    harness.give(ITEM.potato, 1);
    harness.give(ITEM.carrot, 1);
    harness.give(ITEM.commonMushroom, 1);
    harness.give(ITEM.salt, 1);
    const wrongStation = harness.cooking.cook('cook_campfire_stew');
    expect(wrongStation.ok).toBe(false);
    expect(wrongStation.code).toBe('wrong_location');
    harness.setPlayerLocation(FIXTURE_LOCATIONS.campfire);
    expect(harness.cooking.cook('cook_campfire_stew').ok).toBe(true);
  });
});

describe('CookingSystem - knowledge and validation', () => {
  it('knows basic recipes from the start and unlocks book recipes', () => {
    const harness = createCraftHarness();
    const knownIds = harness.cooking.getKnownRecipes().map((recipe) => recipe.id);
    expect(knownIds).toContain('cook_vegetable_soup');
    expect(knownIds).not.toContain('cook_strawberry_cake');
    for (const recipe of harness.cooking.getKnownRecipes()) expect(recipe.category).toBe('cook');

    harness.give(ITEM.recipeBook, 1);
    expect(harness.state.cooking.knownRecipes).toContain('cook_strawberry_cake');
    expect(harness.cooking.getKnownRecipes().map((recipe) => recipe.id)).toContain('cook_strawberry_cake');
  });

  it('reports a locked recipe instead of cooking it', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.kitchen);
    harness.give(ITEM.dough, 1);
    harness.give(ITEM.strawberry, 4);
    harness.give(ITEM.sugar, 2);
    harness.give(ITEM.egg, 2);
    const result = harness.cooking.cook('cook_strawberry_cake');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('locked');
  });

  it('rejects crafting recipes and unknown recipes', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.kitchen);
    expect(harness.cooking.cook('craft_plank').code).toBe('invalid');
    expect(harness.cooking.cook('no_such_recipe').code).toBe('not_found');
  });

  it('lists only recipes that can actually be cooked here and now', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.farField);
    expect(harness.cooking.getCookableRecipes()).toHaveLength(0);
    harness.setPlayerLocation(FIXTURE_LOCATIONS.kitchen);
    giveSoupIngredients(harness);
    const cookable = harness.cooking.getCookableRecipes().map((recipe) => recipe.id);
    expect(cookable).toContain('cook_vegetable_soup');
    expect(cookable).not.toContain('cook_apple_pie');
  });

  it('keeps output freshness for freshly cooked food', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.kitchen);
    giveSoupIngredients(harness);
    harness.cooking.cook('cook_vegetable_soup');
    const entry = harness.state.player.inventory.find((candidate) => candidate.itemId === ITEM.vegetableSoup);
    expect(entry).toBeDefined();
    expect(entry?.freshness).toBeCloseTo(1, 5);
  });
});

describe('CookingSystem - food buffs', () => {
  it('applies food effects to status effects and the cooking buff list', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.kitchen);
    harness.give(ITEMS.testHerb, 1);
    const result = harness.cooking.cook(ITEMS.testMealRecipe);
    expect(result.ok).toBe(true);
    expect(harness.state.cooking.buffs).toHaveLength(2);
    expect(foodBuffs(harness)).toHaveLength(2);
    expect(harness.skill.getXpMultiplier()).toBeGreaterThan(1);
    for (const buff of harness.state.cooking.buffs) expect(buff.source.startsWith('cooking:')).toBe(true);
  });

  it('caps buff durations and lets them expire', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.kitchen);
    harness.give(ITEMS.testHerb, 1);
    const start = harness.clock.simTimeSeconds;
    harness.cooking.cook(ITEMS.testMealRecipe);
    const xpBuff = harness.state.cooking.buffs.find((buff) => typeof buff.skillXpMultiplier === 'number');
    const energyBuff = harness.state.cooking.buffs.find((buff) => typeof buff.energyRegenPerHour === 'number');
    expect(xpBuff).toBeDefined();
    expect(energyBuff).toBeDefined();
    // The 999 hour fixture buff is capped to 12 hours of game time (12 * 60 sim seconds).
    expect((xpBuff?.expiresAt ?? 0) - start).toBe(12 * 60);
    expect((energyBuff?.expiresAt ?? 0) - start).toBe(2 * 60);

    harness.advanceGameHours(13);
    expect(harness.state.cooking.buffs).toHaveLength(0);
    expect(foodBuffs(harness)).toHaveLength(0);
    expect(harness.skill.getXpMultiplier()).toBe(1);
  });

  it('expires food buffs during a multi-day offline catch-up', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.kitchen);
    harness.give(ITEMS.testHerb, 1);
    harness.cooking.cook(ITEMS.testMealRecipe);
    expect(harness.state.cooking.buffs.length).toBeGreaterThan(0);
    harness.advanceGameHours(24 * 3);
    expect(harness.state.cooking.buffs).toHaveLength(0);
    expect(foodBuffs(harness)).toHaveLength(0);
  });

  it('feeds the skill XP multiplier into skill gains', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.kitchen);
    harness.give(ITEMS.testHerb, 1);
    harness.cooking.cook(ITEMS.testMealRecipe);
    const multiplier = harness.skill.getXpMultiplier();
    const before = harness.skill.getProgress('crafting').totalXp;
    harness.skill.addXp('crafting', 100, 'unit-test');
    const gained = harness.skill.getProgress('crafting').totalXp - before;
    expect(gained).toBe(Math.max(1, Math.round(100 * multiplier)));
  });

  it('keeps at most five food buffs active', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.kitchen);
    harness.give(ITEMS.testHerb, 3);
    for (let index = 0; index < 3; index += 1) {
      expect(harness.cooking.cook(ITEMS.testMealRecipe).ok).toBe(true);
    }
    expect(harness.state.cooking.buffs.length).toBeLessThanOrEqual(5);
    expect(foodBuffs(harness).length).toBeLessThanOrEqual(5);
    expect(harness.cooking.getActiveBuffs().length).toBe(harness.state.cooking.buffs.length);
  });

  it('is deterministic for the same seed and action sequence', () => {
    const run = (): number => {
      const harness = createCraftHarness({ seed: 551122 });
      harness.setPlayerLocation(FIXTURE_LOCATIONS.kitchen);
      giveSoupIngredients(harness);
      harness.cooking.cook('cook_vegetable_soup');
      return cookQuality(harness);
    };
    expect(run()).toBe(run());
  });
});
