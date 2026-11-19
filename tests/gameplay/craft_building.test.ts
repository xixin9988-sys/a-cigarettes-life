import { describe, expect, it } from 'vitest';
import { createCraftHarness, FIXTURE_LOCATIONS, type CraftHarness } from './testkit';
import { ITEM } from '../../src/data/items/ids';

const HOME = FIXTURE_LOCATIONS.homeInterior;
const HOME_ID = 'home_player';

function giveGreenhouseMaterials(harness: CraftHarness): void {
  harness.give(ITEM.greenhouseKit, 1);
  harness.give(ITEM.wood, 10);
  harness.give(ITEM.stone, 8);
}

function giveRoomMaterials(harness: CraftHarness): void {
  harness.give(ITEM.plank, 20);
  harness.give(ITEM.brick, 15);
  harness.give(ITEM.nail, 20);
  harness.give(ITEM.glass, 4);
}

function giveGardenMaterials(harness: CraftHarness): void {
  harness.give(ITEM.plank, 12);
  harness.give(ITEM.stone, 10);
  harness.give(ITEM.compost, 4);
}

describe('BuildingSystem - availability and validation', () => {
  it('unlocks blueprints as skills grow', () => {
    const harness = createCraftHarness();
    expect(harness.building.getAvailableBlueprints()).toHaveLength(0);
    harness.skill.addXp('gardening', 200, 'test');
    const available = harness.building.getAvailableBlueprints().map((blueprint) => blueprint.id);
    expect(available).toContain('bp_greenhouse_basic');
    expect(available).toContain('bp_garden_expansion');
    expect(available).not.toContain('bp_greenhouse_large');
  });

  it('rejects unknown blueprints and missing materials', () => {
    const harness = createCraftHarness();
    expect(harness.building.startProject('no_such_blueprint', HOME).code).toBe('not_found');
    harness.skill.addXp('gardening', 200, 'test');
    const missing = harness.building.startProject('bp_greenhouse_basic', HOME);
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe('not_enough_items');
    expect(harness.state.building.projects).toHaveLength(0);
  });

  it('rejects low skill levels', () => {
    const harness = createCraftHarness();
    giveGreenhouseMaterials(harness);
    const result = harness.building.startProject('bp_greenhouse_basic', HOME);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('skill_too_low');
  });

  it('requires the player to be at the building site or at their own home', () => {
    const harness = createCraftHarness();
    harness.skill.addXp('gardening', 200, 'test');
    giveGreenhouseMaterials(harness);
    harness.setPlayerLocation(FIXTURE_LOCATIONS.farField);
    const result = harness.building.startProject('bp_greenhouse_basic', FIXTURE_LOCATIONS.farField);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_allowed');
  });

  it('rejects a duplicate project for the same blueprint and location', () => {
    const harness = createCraftHarness();
    harness.skill.addXp('gardening', 200, 'test');
    giveGreenhouseMaterials(harness);
    giveGreenhouseMaterials(harness);
    expect(harness.building.startProject('bp_greenhouse_basic', HOME).ok).toBe(true);
    const duplicate = harness.building.startProject('bp_greenhouse_basic', HOME);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.code).toBe('busy');
  });
});

describe('BuildingSystem - project lifecycle', () => {
  it('consumes materials, tracks progress and completes a greenhouse', () => {
    const harness = createCraftHarness();
    harness.skill.addXp('gardening', 200, 'test');
    giveGreenhouseMaterials(harness);
    const xpBefore = harness.skill.getProgress('gardening').totalXp;
    const start = harness.clock.simTimeSeconds;

    const result = harness.building.startProject('bp_greenhouse_basic', HOME);
    expect(result.ok).toBe(true);
    expect(harness.count(ITEM.greenhouseKit)).toBe(0);
    expect(harness.count(ITEM.wood)).toBe(0);
    expect(harness.state.building.projects).toHaveLength(1);
    const project = harness.state.building.projects[0];
    expect(project?.status).toBe('building');
    // 24 build hours = 24 * 60 sim seconds
    expect((project?.completesAt ?? 0) - start).toBe(24 * 60);

    harness.advanceGameHours(12);
    expect(harness.building.getProjectProgress(project?.id ?? '')).toBeCloseTo(0.5, 2);
    expect(harness.state.building.projects[0]?.status).toBe('building');

    harness.advanceGameHours(12);
    const finished = harness.state.building.projects[0];
    expect(finished?.status).toBe('complete');
    expect(finished?.progress).toBe(1);
    expect(harness.state.building.completedProjects).toContain('bp_greenhouse_basic');

    const greenhouses = Object.values(harness.state.farming.greenhouses);
    expect(greenhouses).toHaveLength(1);
    const greenhouse = greenhouses[0];
    expect(greenhouse?.plots).toHaveLength(4);
    expect(Object.keys(harness.state.farming.plots)).toHaveLength(4);
    for (const plotId of greenhouse?.plots ?? []) {
      const plot = harness.state.farming.plots[plotId];
      expect(plot).toBeDefined();
      expect(plot?.stage).toBe('tilled');
      expect(plot?.ownerId).toBe(harness.state.player.id);
    }
    const home = harness.housing.getHome(HOME_ID);
    expect(home?.gardens).toContain('bp_greenhouse_basic');
    expect(harness.skill.getProgress('gardening').totalXp).toBeGreaterThan(xpBefore);
    expect(harness.state.world.history.length).toBeGreaterThan(1);
  });

  it('adds a room to the home when a room blueprint completes', () => {
    const harness = createCraftHarness();
    harness.skill.addXp('crafting', 400, 'test');
    giveRoomMaterials(harness);
    expect(harness.building.startProject('bp_extra_room', HOME).ok).toBe(true);
    harness.advanceGameHours(36);
    const home = harness.housing.getHome(HOME_ID);
    expect(home).toBeDefined();
    const room = home?.rooms.find((candidate) => candidate.id === 'second_room');
    expect(room).toBeDefined();
    expect(room?.unlocked).toBe(true);
    expect(room?.widthTiles).toBeGreaterThan(0);
    expect(home?.upgrades).toContain('bp_extra_room');
    expect(home?.comfort ?? 0).toBeGreaterThan(0);
  });

  it('grants crafting stations when a workshop or kitchen room is built', () => {
    const harness = createCraftHarness();
    expect(harness.crafting.hasStation('workbench')).toBe(false);
    expect(harness.cooking.hasStation('kitchen')).toBe(false);
    harness.skill.addXp('crafting', 10_000_000, 'test');
    harness.skill.addXp('gardening', 200, 'test');
    harness.give(ITEM.plank, 48);
    harness.give(ITEM.nail, 48);
    harness.give(ITEM.ironOre, 6);
    harness.give(ITEM.brick, 22);
    harness.give(ITEM.glass, 3);
    expect(harness.building.startProject('bp_workshop', HOME).ok).toBe(true);
    expect(harness.building.startProject('bp_kitchen', HOME).ok).toBe(true);
    harness.advanceGameHours(48);
    expect(harness.crafting.hasStation('workbench')).toBe(true);
    expect(harness.crafting.hasStation('forge')).toBe(true);
    expect(harness.cooking.hasStation('kitchen')).toBe(true);
    const home = harness.housing.getHome(HOME_ID);
    expect(home?.rooms.some((room) => room.id === 'workshop')).toBe(true);
    expect(home?.rooms.some((room) => room.id === 'kitchen')).toBe(true);
  });

  it('adds tillable garden plots for a garden expansion', () => {
    const harness = createCraftHarness();
    harness.skill.addXp('gardening', 200, 'test');
    giveGardenMaterials(harness);
    expect(harness.building.startProject('bp_garden_expansion', HOME).ok).toBe(true);
    harness.advanceGameHours(16);
    expect(Object.keys(harness.state.farming.plots)).toHaveLength(3);
    const home = harness.housing.getHome(HOME_ID);
    expect(home?.gardens).toContain('bp_garden_expansion');
    const homeExteriorDef = harness.content.getLocation(FIXTURE_LOCATIONS.homeExterior);
    const width = homeExteriorDef?.widthTiles ?? 16;
    for (const plot of Object.values(harness.state.farming.plots)) {
      expect(plot.stage).toBe('tilled');
      expect(plot.locationId).toBe(FIXTURE_LOCATIONS.homeExterior);
      // Special plots reserve a virtual band outside the hand-tillable field.
      expect(plot.x).toBeGreaterThanOrEqual(width);
    }
  });

  it('completes a project exactly once during a multi-day offline jump', () => {
    const harness = createCraftHarness();
    harness.skill.addXp('gardening', 200, 'test');
    giveGreenhouseMaterials(harness);
    harness.building.startProject('bp_greenhouse_basic', HOME);
    harness.advanceGameHours(24 * 5);
    expect(Object.keys(harness.state.farming.greenhouses)).toHaveLength(1);
    expect(harness.state.building.completedProjects.filter((id) => id === 'bp_greenhouse_basic')).toHaveLength(1);
    harness.advanceGameHours(24 * 5);
    expect(Object.keys(harness.state.farming.greenhouses)).toHaveLength(1);
    expect(harness.state.building.completedProjects.filter((id) => id === 'bp_greenhouse_basic')).toHaveLength(1);
  });

  it('refunds half of the materials when a project is cancelled', () => {
    const harness = createCraftHarness();
    harness.skill.addXp('gardening', 200, 'test');
    giveGardenMaterials(harness);
    harness.building.startProject('bp_garden_expansion', HOME);
    const projectId = harness.state.building.projects[0]?.id ?? '';
    const result = harness.building.cancelProject(projectId);
    expect(result.ok).toBe(true);
    expect(harness.state.building.projects[0]?.status).toBe('cancelled');
    expect(harness.count(ITEM.plank)).toBe(6);
    expect(harness.count(ITEM.stone)).toBe(5);
    expect(harness.count(ITEM.compost)).toBe(2);
    const secondCancel = harness.building.cancelProject(projectId);
    expect(secondCancel.ok).toBe(false);
  });

  it('does not offer an already-built single instance blueprint again', () => {
    const harness = createCraftHarness();
    harness.skill.addXp('gardening', 200, 'test');
    giveGreenhouseMaterials(harness);
    harness.building.startProject('bp_greenhouse_basic', HOME);
    harness.advanceGameHours(24);
    const available = harness.building.getAvailableBlueprints().map((blueprint) => blueprint.id);
    expect(available).not.toContain('bp_greenhouse_basic');
    giveGreenhouseMaterials(harness);
    const again = harness.building.startProject('bp_greenhouse_basic', HOME);
    expect(again.ok).toBe(false);
    expect(again.code).toBe('locked');
  });

  it('exposes project helpers for the building UI', () => {
    const harness = createCraftHarness();
    harness.skill.addXp('gardening', 200, 'test');
    giveGreenhouseMaterials(harness);
    harness.building.startProject('bp_greenhouse_basic', HOME);
    expect(harness.building.getActiveProjects()).toHaveLength(1);
    expect(harness.building.getProjects()).toHaveLength(1);
    expect(harness.building.isBlueprintUnlocked('bp_greenhouse_basic')).toBe(true);
  });
});
