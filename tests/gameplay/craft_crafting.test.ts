import { describe, expect, it } from 'vitest';
import { createCraftHarness, FIXTURE_LOCATIONS, ITEMS, type CraftHarness } from './testkit';
import { ITEM } from '../../src/data/items/ids';

const HOME = FIXTURE_LOCATIONS.homeInterior;

function placeWorkbench(harness: CraftHarness): void {
  const instanceId = harness.giveFurniture(ITEM.workbenchHome);
  const result = harness.housing.placeFurniture(instanceId, 1, 1, 0);
  expect(result.ok).toBe(true);
}

function craftQuality(harness: CraftHarness): number {
  const completed = [...harness.signals].reverse().find((signal) => signal.name === 'craft:completed');
  const data = completed?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 0;
  const quality = data['quality'];
  return typeof quality === 'number' ? quality : 0;
}

describe('CraftingSystem - station gating', () => {
  it('refuses crafting without a workbench station', () => {
    const harness = createCraftHarness();
    harness.give(ITEM.wood, 3);
    const result = harness.crafting.craft('craft_plank', 1);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong_location');
    expect(harness.signals.some((signal) => signal.name === 'craft:started')).toBe(false);
  });

  it('gets a workbench station from placed home furniture', () => {
    const harness = createCraftHarness();
    harness.give(ITEM.wood, 3);
    placeWorkbench(harness);
    const result = harness.crafting.canCraft('craft_plank', 1);
    expect(result.ok).toBe(true);
    expect(harness.crafting.getStationAvailability().workbench).toBe(true);
    expect(harness.crafting.getStationAvailability().art_studio).toBe(false);
  });

  it('gets a workbench station from a location facility', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.workshop);
    harness.give(ITEM.wood, 3);
    expect(harness.crafting.hasStation('workbench')).toBe(true);
    expect(harness.crafting.canCraft('craft_plank', 1).ok).toBe(true);
    // No forge facility exists in the schema; a workbench also covers forge recipes.
    expect(harness.crafting.hasStation('forge')).toBe(true);
  });

  it('gets a workbench station from a carried workbench kit', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.farField);
    harness.give(ITEM.workbenchKit, 1);
    harness.give(ITEM.wood, 3);
    expect(harness.crafting.hasStation('workbench')).toBe(true);
  });

  it('needs a paintbrush plus a workbench for the art studio station', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.farField);
    harness.give(ITEM.paintbrush, 1);
    expect(harness.crafting.hasStation('art_studio')).toBe(false);
    harness.give(ITEM.workbenchKit, 1);
    expect(harness.crafting.hasStation('art_studio')).toBe(true);
  });
});

describe('CraftingSystem - validation and atomic consumption', () => {
  it('reports missing materials without consuming anything', () => {
    const harness = createCraftHarness();
    placeWorkbench(harness);
    harness.give(ITEM.wood, 2);
    const result = harness.crafting.craft('craft_plank', 1);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_enough_items');
    expect(harness.count(ITEM.wood)).toBe(2);
    expect(harness.state.crafting.jobs).toHaveLength(0);
  });

  it('consumes the whole batch atomically on success', () => {
    const harness = createCraftHarness();
    placeWorkbench(harness);
    harness.give(ITEM.wood, 6);
    const result = harness.crafting.craft('craft_plank', 2);
    expect(result.ok).toBe(true);
    expect(harness.count(ITEM.wood)).toBe(0);
    expect(harness.state.crafting.jobs).toHaveLength(1);
    expect(harness.state.crafting.jobs[0]?.quantity).toBe(2);
  });

  it('validates batch size and rejects cooking recipes', () => {
    const harness = createCraftHarness();
    placeWorkbench(harness);
    harness.give(ITEM.wood, 30);
    expect(harness.crafting.craft('craft_plank', 0).ok).toBe(false);
    expect(harness.crafting.craft('craft_plank', 1.5).ok).toBe(false);
    expect(harness.crafting.craft('craft_plank', 21).ok).toBe(false);
    const cookResult = harness.crafting.craft('cook_vegetable_soup', 1);
    expect(cookResult.ok).toBe(false);
    expect(cookResult.code).toBe('invalid');
    expect(harness.crafting.craft('no_such_recipe', 1).code).toBe('not_found');
  });

  it('gates recipes behind the required skill level', () => {
    const harness = createCraftHarness();
    placeWorkbench(harness);
    const result = harness.crafting.canCraft('craft_fishing_rod_good', 1);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('skill_too_low');
  });

  it('locks recipes until their unlock item is acquired', () => {
    const harness = createCraftHarness();
    placeWorkbench(harness);
    const locked = harness.crafting.canCraft('craft_fishing_rod_master', 1);
    expect(locked.ok).toBe(false);
    expect(locked.code).toBe('locked');
    harness.give(ITEM.fishingBook, 1);
    expect(harness.state.player.knownRecipes).toContain('craft_fishing_rod_master');
    const unlocked = harness.crafting.canCraft('craft_fishing_rod_master', 1);
    expect(unlocked.code).not.toBe('locked');
  });

  it('learns recipes listed on an acquired item', () => {
    const harness = createCraftHarness();
    placeWorkbench(harness);
    harness.give(ITEMS.testRecipeScroll, 1);
    expect(harness.state.player.knownRecipes).toContain('craft_fishing_rod_master');
  });
});

describe('CraftingSystem - timed jobs and quality', () => {
  it('creates a job whose length is hours x quantity', () => {
    const harness = createCraftHarness();
    placeWorkbench(harness);
    harness.give(ITEM.wood, 6);
    const before = harness.clock.simTimeSeconds;
    const result = harness.crafting.craft('craft_plank', 2);
    expect(result.ok).toBe(true);
    const job = harness.state.crafting.jobs[0];
    expect(job).toBeDefined();
    if (!job) return;
    expect(job.startedAt).toBe(before);
    // 0.5 hours per plank x 2 planks x 60 sim seconds per game hour
    expect(job.completesAt - job.startedAt).toBe(60);
  });

  it('delivers outputs, masteries, statistics and XP when the job completes', () => {
    const harness = createCraftHarness();
    placeWorkbench(harness);
    harness.give(ITEM.wood, 6, 4);
    const xpBefore = harness.skill.getProgress('crafting').totalXp;
    harness.crafting.craft('craft_plank', 2);
    harness.advanceGameMinutes(59);
    expect(harness.count(ITEM.plank)).toBe(0);
    harness.advanceGameMinutes(1);
    expect(harness.state.crafting.jobs).toHaveLength(0);
    expect(harness.count(ITEM.plank)).toBe(4);
    expect(harness.state.crafting.mastery['craft_plank']).toBe(1);
    expect(harness.state.player.statistics.itemsCrafted).toBe(4);
    expect(harness.skill.getProgress('crafting').totalXp).toBeGreaterThan(xpBefore);
    expect(harness.signals.some((signal) => signal.name === 'craft:completed')).toBe(true);
  });

  it('keeps crafted quality inside 1..5', () => {
    const harness = createCraftHarness();
    placeWorkbench(harness);
    harness.give(ITEM.wood, 3, 1);
    harness.crafting.craft('craft_plank', 1);
    harness.advanceGameMinutes(30);
    const quality = craftQuality(harness);
    expect(quality).toBeGreaterThanOrEqual(1);
    expect(quality).toBeLessThanOrEqual(5);
  });

  it('reaches perfect quality with max skill and perfect inputs', () => {
    const harness = createCraftHarness();
    placeWorkbench(harness);
    harness.skill.addXp('crafting', 10_000_000, 'test');
    expect(harness.skill.getLevel('crafting')).toBe(20);
    harness.give(ITEM.wood, 3, 5);
    harness.crafting.craft('craft_plank', 1);
    harness.advanceGameMinutes(30);
    // avgInput 5 * 0.6 + skillFactor 5 * 0.3 + jitter(1..5) * 0.1 rounds to 5.
    expect(craftQuality(harness)).toBe(5);
  });

  it('completes several queued jobs in one update (offline catch-up)', () => {
    const harness = createCraftHarness();
    placeWorkbench(harness);
    harness.give(ITEM.wood, 12);
    expect(harness.crafting.craft('craft_plank', 1).ok).toBe(true);
    expect(harness.crafting.craft('craft_plank', 1).ok).toBe(true);
    expect(harness.crafting.craft('craft_plank', 1).ok).toBe(true);
    harness.advanceGameHours(4);
    expect(harness.state.crafting.jobs).toHaveLength(0);
    expect(harness.count(ITEM.plank)).toBe(6);
  });

  it('is deterministic for the same seed and action sequence', () => {
    const run = (): number => {
      const harness = createCraftHarness({ seed: 987123 });
      placeWorkbench(harness);
      harness.give(ITEM.wood, 12, 3);
      harness.crafting.craft('craft_plank', 1);
      harness.advanceGameMinutes(30);
      harness.crafting.craft('craft_plank', 1);
      harness.advanceGameMinutes(30);
      return craftQuality(harness);
    };
    expect(run()).toBe(run());
  });

  it('completes exactly once across a multi-day offline jump', () => {
    const harness = createCraftHarness();
    placeWorkbench(harness);
    harness.give(ITEM.wood, 3);
    harness.crafting.craft('craft_plank', 1);
    harness.advanceGameHours(24 * 7);
    expect(harness.count(ITEM.plank)).toBe(2);
    expect(harness.state.crafting.jobs).toHaveLength(0);
    harness.advanceGameHours(24 * 7);
    expect(harness.count(ITEM.plank)).toBe(2);
    expect(harness.state.crafting.mastery['craft_plank']).toBe(1);
  });

  it('respects the concurrent job limit', () => {
    const harness = createCraftHarness();
    placeWorkbench(harness);
    harness.give(ITEM.wood, 30);
    for (let index = 0; index < 8; index += 1) {
      expect(harness.crafting.craft('craft_plank', 1).ok).toBe(true);
    }
    const ninth = harness.crafting.craft('craft_plank', 1);
    expect(ninth.ok).toBe(false);
    expect(ninth.code).toBe('busy');
  });
});

describe('CraftingSystem - available recipe listing', () => {
  it('filters by station, knowledge, level and materials', () => {
    const harness = createCraftHarness();
    harness.give(ITEM.wood, 3);
    expect(harness.crafting.getAvailableRecipes('craft')).toHaveLength(0);

    placeWorkbench(harness);
    const available = harness.crafting.getAvailableRecipes('craft');
    const ids = available.map((recipe) => recipe.id);
    expect(ids).toContain('craft_plank');
    expect(ids).not.toContain('craft_bed_simple');
    expect(ids).not.toContain('craft_fishing_rod_good');
    expect(harness.crafting.getAvailableRecipes('cook')).toHaveLength(0);
    for (const recipe of available) expect(recipe.category).toBe('craft');
  });

  it('exposes mastery and active jobs for the UI', () => {
    const harness = createCraftHarness();
    placeWorkbench(harness);
    harness.give(ITEM.wood, 3);
    expect(harness.crafting.getActiveJobs()).toHaveLength(0);
    harness.crafting.craft('craft_plank', 1);
    const jobs = harness.crafting.getActiveJobs();
    expect(jobs).toHaveLength(1);
    harness.advanceGameMinutes(30);
    expect(harness.crafting.getMastery('craft_plank')).toBe(1);
    expect(harness.crafting.getCraftingState().mastery['craft_plank']).toBe(1);
  });

  it('does not let a craft job reference a recipe outside the pack', () => {
    const harness = createCraftHarness();
    expect(harness.crafting.craft('unknown_recipe_id', 1).code).toBe('not_found');
    expect(harness.crafting.isRecipeKnownById('craft_plank')).toBe(true);
    expect(harness.crafting.isRecipeKnownById('unknown_recipe_id')).toBe(false);
  });

  it('stays at home location for the whole test setup', () => {
    const harness = createCraftHarness();
    expect(harness.state.player.position.locationId).toBe(HOME);
  });
});
