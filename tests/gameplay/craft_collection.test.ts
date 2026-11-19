import { describe, expect, it } from 'vitest';
import { createCraftHarness, FIXTURE_LOCATIONS, ITEMS } from './testkit';
import { ITEM } from '../../src/data/items/ids';

const MUSEUM = FIXTURE_LOCATIONS.museumInterior;

describe('CollectionSystem - registration', () => {
  it('registers collectible items from item:acquired', () => {
    const harness = createCraftHarness({ starterInventory: false });
    expect(harness.collection.isCollected(ITEMS.collectibleFish)).toBe(false);
    harness.give(ITEMS.collectibleFish, 1, 3);
    expect(harness.collection.isCollected(ITEMS.collectibleFish)).toBe(true);
    const progress = harness.collection.getProgress();
    expect(progress.known).toBe(1);
    expect(progress.total).toBeGreaterThanOrEqual(2);
    expect(progress.donated).toBe(0);
    const signal = harness.signals.find((entry) => entry.name === 'collection:registered');
    expect(signal).toBeDefined();
    expect(harness.state.collection.totalSpeciesKnown).toBe(progress.total);
  });

  it('ignores items that belong to no collection category', () => {
    const harness = createCraftHarness({ starterInventory: false });
    harness.give(ITEM.plank, 3);
    expect(harness.collection.isCollected(ITEM.plank)).toBe(false);
    expect(harness.collection.getProgress().known).toBe(0);
  });

  it('tracks counts and best quality across repeated acquisitions', () => {
    const harness = createCraftHarness({ starterInventory: false });
    harness.give(ITEMS.collectibleMineral, 1, 2);
    harness.give(ITEMS.collectibleMineral, 1, 5);
    harness.give(ITEMS.collectibleMineral, 1, 1);
    const entry = harness.state.collection.entries[ITEMS.collectibleMineral];
    expect(entry).toBeDefined();
    expect(entry?.count).toBe(3);
    expect(entry?.bestQuality).toBe(5);
  });

  it('refuses to register non-collectible items through the API', () => {
    const harness = createCraftHarness({ starterInventory: false });
    const result = harness.collection.registerItem(ITEM.plank, 3);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_allowed');
    const unknown = harness.collection.registerItem('no_such_item', 3 as const);
    expect(unknown.code).toBe('not_found');
  });

  it('reports per-category progress for the album UI', () => {
    const harness = createCraftHarness({ starterInventory: false });
    harness.give(ITEMS.collectibleFish, 1, 4);
    const categories = harness.collection.getCategoryProgress();
    expect(categories.length).toBeGreaterThanOrEqual(10);
    const fish = categories.find((category) => category.id === 'fish');
    expect(fish).toBeDefined();
    expect(fish?.known).toBe(1);
    expect(fish?.total).toBeGreaterThanOrEqual(1);
    const mineral = categories.find((category) => category.id === 'minerals');
    expect(mineral?.known).toBe(0);
    expect(mineral?.total).toBeGreaterThanOrEqual(1);
    expect(harness.collection.getCatalog().length).toBe(harness.collection.getProgress().total);
    expect(harness.collection.getEntries()).toHaveLength(1);
  });
});

describe('CollectionSystem - museum donations', () => {
  it('donates a collected specimen at the museum', () => {
    const harness = createCraftHarness({ starterInventory: false });
    harness.give(ITEMS.collectibleFish, 1, 3);
    harness.setPlayerLocation(MUSEUM);
    const historyBefore = harness.state.world.history.length;
    const result = harness.collection.donateToMuseum(ITEMS.collectibleFish);
    expect(result.ok).toBe(true);
    expect(harness.collection.getProgress().donated).toBe(1);
    expect(harness.state.collection.entries[ITEMS.collectibleFish]?.donated).toBe(true);
    expect(harness.count(ITEMS.collectibleFish)).toBe(0);
    expect(harness.state.player.influence).toBe(1);
    expect(harness.state.world.history.length).toBeGreaterThan(historyBefore);
    expect(harness.signals.some((signal) => signal.name === 'collection:donated')).toBe(true);
  });

  it('does not donate the same specimen twice', () => {
    const harness = createCraftHarness({ starterInventory: false });
    harness.give(ITEMS.collectibleFish, 2, 3);
    harness.setPlayerLocation(MUSEUM);
    expect(harness.collection.donateToMuseum(ITEMS.collectibleFish).ok).toBe(true);
    const second = harness.collection.donateToMuseum(ITEMS.collectibleFish);
    expect(second.ok).toBe(false);
    expect(second.code).toBe('not_allowed');
    expect(harness.collection.getProgress().donated).toBe(1);
    expect(harness.count(ITEMS.collectibleFish)).toBe(1);
  });

  it('requires the player to be at the museum', () => {
    const harness = createCraftHarness({ starterInventory: false });
    harness.give(ITEMS.collectibleFish, 1, 3);
    const result = harness.collection.donateToMuseum(ITEMS.collectibleFish);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong_location');
  });

  it('requires a collected specimen to exist in the bag', () => {
    const harness = createCraftHarness({ starterInventory: false });
    harness.setPlayerLocation(MUSEUM);
    const notCollected = harness.collection.donateToMuseum(ITEMS.collectibleFish);
    expect(notCollected.ok).toBe(false);
    expect(notCollected.code).toBe('not_found');

    harness.give(ITEMS.collectibleFish, 1, 3);
    // Remove the item again but keep the collection entry.
    harness.state.player.inventory = harness.state.player.inventory.filter(
      (entry) => entry.itemId !== ITEMS.collectibleFish
    );
    const notEnough = harness.collection.donateToMuseum(ITEMS.collectibleFish);
    expect(notEnough.ok).toBe(false);
    expect(notEnough.code).toBe('not_enough_items');
  });

  it('works from the museum exterior too', () => {
    const harness = createCraftHarness({ starterInventory: false });
    harness.give(ITEMS.collectibleMineral, 1, 2);
    harness.setPlayerLocation('ashford_museum');
    expect(harness.collection.donateToMuseum(ITEMS.collectibleMineral).ok).toBe(true);
  });
});
