import { describe, expect, it } from 'vitest';
import { createCraftHarness, FIXTURE_LOCATIONS, type CraftHarness } from './testkit';
import { ITEM } from '../../src/data/items/ids';
import { createInventoryEntry } from '../../src/core/InventoryUtil';

const HOME_ID = 'home_player';

function home(harness: CraftHarness) {
  const found = harness.housing.getHome(HOME_ID);
  if (!found) throw new Error('missing player home');
  return found;
}

function nextFurnitureInstance(harness: CraftHarness, itemId: string): string {
  const ids = harness.instanceIds(itemId);
  const first = ids[0];
  if (!first) throw new Error('no instance of ' + itemId);
  return first;
}

describe('HousingSystem - placement basics', () => {
  it('places furniture, consumes the item and recomputes comfort/decor', () => {
    const harness = createCraftHarness();
    const before = home(harness);
    expect(before.furniture).toHaveLength(0);
    // A roof over your head is worth a baseline 5% comfort.
    expect(before.comfort).toBeCloseTo(0.05, 5);

    const instanceId = harness.giveFurniture(ITEM.bedSimple);
    const result = harness.housing.placeFurniture(instanceId, 1, 1, 0);
    expect(result.ok).toBe(true);
    expect(home(harness).furniture).toHaveLength(1);
    expect(harness.count(ITEM.bedSimple)).toBe(0);
    expect(harness.state.player.statistics.furniturePlaced).toBe(1);
    expect(home(harness).comfort).toBeGreaterThan(0);
    expect(home(harness).decorationScore).toBeGreaterThan(0);
    expect(harness.state.housing.lastPlacementAt).toBe(harness.clock.simTimeSeconds);
  });

  it('rotates footprints for 90 degree placements', () => {
    const harness = createCraftHarness();
    const instanceId = harness.giveFurniture(ITEM.bedSimple);
    // Bed is 2 wide x 3 tall; rotated it is 3 wide x 2 tall and fits at x=9.
    const result = harness.housing.placeFurniture(instanceId, 9, 0, 90);
    expect(result.ok).toBe(true);
    expect(home(harness).furniture[0]?.rotation).toBe(90);
    expect(harness.housing.placeFurniture(harness.giveFurniture(ITEM.bedSimple), 9, 0, 45).ok).toBe(false);
  });

  it('rejects placements outside the room bounds', () => {
    const harness = createCraftHarness();
    const result = harness.housing.placeFurniture(harness.giveFurniture(ITEM.tableWood), 11, 0, 0);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid');
  });

  it('rejects overlapping blocking furniture but allows a neighbouring piece', () => {
    const harness = createCraftHarness();
    expect(harness.housing.placeFurniture(harness.giveFurniture(ITEM.tableWood), 1, 1, 0).ok).toBe(true);
    const overlap = harness.housing.placeFurniture(harness.giveFurniture(ITEM.tableWood), 2, 2, 0);
    expect(overlap.ok).toBe(false);
    expect(overlap.message.length).toBeGreaterThan(0);
    expect(harness.housing.placeFurniture(harness.giveFurniture(ITEM.tableWood), 4, 1, 0).ok).toBe(true);
  });

  it('rejects furniture that would seal the room from the doorway', () => {
    const harness = createCraftHarness();
    const columns = [0, 2, 4, 6, 8];
    for (const column of columns) {
      const placed = harness.housing.placeFurniture(harness.giveFurniture(ITEM.wardrobe), column, 7, 0);
      expect(placed.ok).toBe(true);
    }
    // The room is 12 wide; a wardrobe at x=10 closes the last gap between rows 6 and 9.
    const sealing = harness.housing.placeFurniture(harness.giveFurniture(ITEM.wardrobe), 10, 7, 0);
    expect(sealing.ok).toBe(false);
    expect(home(harness).furniture).toHaveLength(columns.length);
  });

  it('lets wall pieces share tiles with floor furniture but not each other', () => {
    const harness = createCraftHarness();
    expect(harness.housing.placeFurniture(harness.giveFurniture(ITEM.wallPainting), 0, 0, 0).ok).toBe(true);
    // Floor furniture on the same tiles is fine: the painting is on the wall plane.
    expect(harness.housing.placeFurniture(harness.giveFurniture(ITEM.tableWood), 0, 0, 0).ok).toBe(true);
    const secondPainting = harness.housing.placeFurniture(harness.giveFurniture(ITEM.wallPainting), 1, 0, 0);
    expect(secondPainting.ok).toBe(false);
  });

  it('rejects non-furniture items and requires being at home', () => {
    const harness = createCraftHarness();
    harness.give(ITEM.plank, 2);
    const plankId = harness.instanceIds(ITEM.plank)[0] ?? '';
    const notFurniture = harness.housing.placeFurniture(plankId, 0, 0, 0);
    expect(notFurniture.ok).toBe(false);
    expect(notFurniture.code).toBe('not_found');

    harness.setPlayerLocation(FIXTURE_LOCATIONS.farField);
    const away = harness.housing.placeFurniture(harness.giveFurniture(ITEM.chairWood), 0, 0, 0);
    expect(away.ok).toBe(false);
    expect(away.code).toBe('wrong_location');
  });
});

describe('HousingSystem - removing and comfort', () => {
  it('returns removed furniture to the bag', () => {
    const harness = createCraftHarness();
    const instanceId = harness.giveFurniture(ITEM.bedSimple);
    harness.housing.placeFurniture(instanceId, 1, 1, 0);
    const placedId = home(harness).furniture[0]?.id ?? '';
    const result = harness.housing.removeFurniture(placedId);
    expect(result.ok).toBe(true);
    expect(home(harness).furniture).toHaveLength(0);
    expect(harness.count(ITEM.bedSimple)).toBe(1);
    expect(home(harness).comfort).toBeCloseTo(0.05, 5);
    expect(harness.housing.removeFurniture(placedId).ok).toBe(false);
  });

  it('needs the player at home to remove furniture', () => {
    const harness = createCraftHarness();
    harness.housing.placeFurniture(harness.giveFurniture(ITEM.bedSimple), 1, 1, 0);
    const placedId = home(harness).furniture[0]?.id ?? '';
    harness.setPlayerLocation(FIXTURE_LOCATIONS.farField);
    const result = harness.housing.removeFurniture(placedId);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong_location');
  });

  it('applies diminishing returns to comfort', () => {
    const harness = createCraftHarness();
    harness.housing.placeFurniture(harness.giveFurniture(ITEM.bedSimple), 1, 1, 0);
    const first = home(harness).comfort;
    harness.housing.placeFurniture(harness.giveFurniture(ITEM.bedSimple), 4, 1, 0);
    const second = home(harness).comfort;
    expect(second).toBeGreaterThan(first);
    expect(second - first).toBeLessThan(first);
    expect(second).toBeLessThanOrEqual(1);
  });
});

describe('HousingSystem - storage', () => {
  it('moves items between the bag and home storage', () => {
    const harness = createCraftHarness();
    harness.give(ITEM.apple, 2);
    const instanceId = harness.instanceIds(ITEM.apple)[0] ?? '';
    const stored = harness.housing.storeItem(HOME_ID, instanceId);
    expect(stored.ok).toBe(true);
    expect(home(harness).storage).toHaveLength(1);
    expect(harness.count(ITEM.apple)).toBe(0);

    const storageId = home(harness).storage[0]?.instanceId ?? '';
    const taken = harness.housing.takeItem(HOME_ID, storageId);
    expect(taken.ok).toBe(true);
    expect(home(harness).storage).toHaveLength(0);
    expect(harness.count(ITEM.apple)).toBe(2);
  });

  it('respects storage capacity and accepts extra storage furniture', () => {
    const harness = createCraftHarness();
    expect(harness.housing.getStorageCapacity(HOME_ID)).toBe(16);
    const now = harness.clock.simTimeSeconds;
    for (let index = 0; index < 16; index += 1) {
      home(harness).storage.push(createInventoryEntry(ITEM.plank, 1, { simTime: now }));
    }
    harness.give(ITEM.breadLoaf, 1);
    const full = harness.housing.storeItem(HOME_ID, harness.instanceIds(ITEM.breadLoaf)[0] ?? '');
    expect(full.ok).toBe(false);
    expect(full.code).toBe('capacity_reached');

    harness.housing.placeFurniture(harness.giveFurniture(ITEM.storageChest), 1, 1, 0);
    expect(harness.housing.getStorageCapacity(HOME_ID)).toBe(26);
    const stored = harness.housing.storeItem(HOME_ID, harness.instanceIds(ITEM.breadLoaf)[0] ?? '');
    expect(stored.ok).toBe(true);
  });

  it('rejects storing items at someone else non-home location', () => {
    const harness = createCraftHarness();
    harness.give(ITEM.breadLoaf, 1);
    const instanceId = harness.instanceIds(ITEM.breadLoaf)[0] ?? '';
    harness.setPlayerLocation(FIXTURE_LOCATIONS.farField);
    const result = harness.housing.storeItem(HOME_ID, instanceId);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong_location');
  });
});

describe('HousingSystem - decoration', () => {
  it('requires a tin of paint and applies a valid wall colour', () => {
    const harness = createCraftHarness();
    const noPaint = harness.housing.paintWall(HOME_ID, '#a8c4b0');
    expect(noPaint.ok).toBe(false);
    expect(noPaint.code).toBe('not_enough_items');

    harness.give(ITEM.paint, 1);
    const invalid = harness.housing.paintWall(HOME_ID, 'not-a-colour');
    expect(invalid.ok).toBe(false);
    expect(invalid.code).toBe('invalid');

    const painted = harness.housing.paintWall(HOME_ID, '#a8c4b0');
    expect(painted.ok).toBe(true);
    expect(home(harness).wallColor).toBe('#a8c4b0');
    for (const room of home(harness).rooms) expect(room.wallColor).toBe('#a8c4b0');
    expect(harness.count(ITEM.paint)).toBe(0);
  });

  it('expands shorthand hex colours', () => {
    const harness = createCraftHarness();
    harness.give(ITEM.paint, 1);
    expect(harness.housing.paintWall(HOME_ID, '#ABC').ok).toBe(true);
    expect(home(harness).wallColor).toBe('#aabbcc');
  });

  it('lays a floor style for its material cost', () => {
    const harness = createCraftHarness();
    const noMaterials = harness.housing.setFloorStyle(HOME_ID, 'stone');
    expect(noMaterials.ok).toBe(false);
    expect(noMaterials.code).toBe('not_enough_items');
    harness.give(ITEM.stone, 3);
    expect(harness.housing.setFloorStyle(HOME_ID, 'unknown').code).toBe('invalid');
    const result = harness.housing.setFloorStyle(HOME_ID, 'stone');
    expect(result.ok).toBe(true);
    expect(home(harness).floorStyle).toBe('stone');
    for (const room of home(harness).rooms) expect(room.floorStyle).toBe('stone');
    expect(harness.count(ITEM.stone)).toBe(0);
  });
});

describe('HousingSystem - garden', () => {
  it('places outdoor furniture in the garden room when standing outside', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.homeExterior);
    const result = harness.housing.placeFurniture(harness.giveFurniture(ITEM.gardenBench), 2, 2, 0);
    expect(result.ok).toBe(true);
    expect(home(harness).furniture[0]?.roomId).toBe('garden');
    expect(home(harness).rooms.some((room) => room.id === 'garden')).toBe(true);
    expect(home(harness).decorationScore).toBeGreaterThan(0);
  });

  it('refuses garden furniture inside and indoor furniture outside', () => {
    const harness = createCraftHarness();
    const benchInside = harness.housing.placeFurniture(harness.giveFurniture(ITEM.gardenBench), 1, 1, 0);
    expect(benchInside.ok).toBe(false);
    expect(benchInside.code).toBe('wrong_location');

    harness.setPlayerLocation(FIXTURE_LOCATIONS.homeExterior);
    const bedOutside = harness.housing.placeFurniture(harness.giveFurniture(ITEM.bedSimple), 1, 1, 0);
    expect(bedOutside.ok).toBe(false);
    expect(bedOutside.code).toBe('wrong_location');
  });

  it('does not apply indoor doorway rules to open garden ground', () => {
    const harness = createCraftHarness();
    harness.setPlayerLocation(FIXTURE_LOCATIONS.homeExterior);
    for (const x of [0, 2, 4, 6, 8, 10, 12]) {
      expect(harness.housing.placeFurniture(harness.giveFurniture(ITEM.gardenBench), x, 5, 0).ok).toBe(true);
    }
    expect(home(harness).furniture).toHaveLength(7);
  });

  it('only lets explicit room placement put garden items in the garden', () => {
    const harness = createCraftHarness();
    const garden = home(harness);
    const benchId = harness.giveFurniture(ITEM.gardenBench);
    const result = harness.housing.placeFurnitureInRoom(garden, 'main_room', benchId, 1, 1, 0);
    expect(result.ok).toBe(false);
  });
});

describe('HousingSystem - room blueprints', () => {
  it('delegates addRoom to the building system and applies the finished room', () => {
    const harness = createCraftHarness();
    harness.skill.addXp('crafting', 400, 'test');
    harness.give(ITEM.plank, 20);
    harness.give(ITEM.brick, 15);
    harness.give(ITEM.nail, 20);
    harness.give(ITEM.glass, 4);
    const started = harness.housing.addRoom(HOME_ID, 'bp_extra_room');
    expect(started.ok).toBe(true);
    expect(harness.state.building.projects).toHaveLength(1);
    harness.advanceGameHours(36);
    expect(home(harness).rooms.some((room) => room.id === 'second_room')).toBe(true);
    expect(harness.housing.getHomeAtLocation(FIXTURE_LOCATIONS.homeInterior)?.id).toBe(HOME_ID);
    expect(harness.housing.getHomes()).toHaveLength(1);
  });

  it('rejects non-room blueprints for addRoom', () => {
    const harness = createCraftHarness();
    const result = harness.housing.addRoom(HOME_ID, 'bp_greenhouse_basic');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid');
  });
});
