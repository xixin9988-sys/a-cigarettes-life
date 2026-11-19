import { beforeAll, describe, expect, it } from 'vitest';
import { CONTENT_PACK } from '../../src/data';
import { ContentRegistry } from '../../src/core/ContentRegistry';
import { DEFAULT_APPEARANCE, createInitialGameState } from '../../src/core/WorldFactory';
import { formatMoney } from '../../src/core/format';
import { WEATHER_DISPLAY_NAMES } from '../../src/core/SharedTypes';
import type { GameState, HomeState } from '../../src/core/contracts';
import type { FurnitureDef } from '../../src/data/schema';
import {
  adjacentLocations,
  buildHudModel,
  candidateBars,
  cigaretteBadges,
  countItem,
  filterInventory,
  influenceTier,
  normaliseKeyName,
  parseSeed,
  previewFurniturePlacement,
  projectRegionMap,
  recipeAvailability,
  resolveShortcuts,
  sanitiseHexColor,
  sortInventory,
  totalSkillLevels,
} from '../../src/ui/model';
import { createDefaultSettings } from '../../src/core/WorldFactory';

let content: ContentRegistry;
let state: GameState;

beforeAll(() => {
  content = new ContentRegistry(CONTENT_PACK);
  state = createInitialGameState({
    seed: 1234,
    playerName: 'Ash',
    appearance: DEFAULT_APPEARANCE,
    content,
  });
});

describe('buildHudModel', () => {
  it('reads real state, not placeholder numbers', () => {
    const model = buildHudModel(state, content);
    const location = content.getLocation(state.player.position.locationId);
    expect(model.locationName).toBe(location?.name);
    expect(model.moneyText).toBe(formatMoney(state.player.money));
    expect(model.weatherLabel).toBe(WEATHER_DISPLAY_NAMES[state.world.environment.weather]);
    expect(model.temperatureText).toBe(Math.round(state.world.environment.temperature) + '°C');
    expect(model.dateText).toContain('Spring 1');
    expect(model.dateText).toContain('Year 1');
    expect(model.cigaretteLengthPercent).toBeCloseTo(100, 5);
    expect(model.cigaretteLengthText).toBe('100.0% remaining');
    expect(model.influenceTierName).toBe('New Resident');
    expect(model.isAlive).toBe(true);
  });

  it('is stable for an unchanged state and changes when money changes', () => {
    const first = buildHudModel(state, content);
    const second = buildHudModel(state, content);
    expect(second.signature).toBe(first.signature);
    state.player.money += 12345;
    const third = buildHudModel(state, content);
    expect(third.signature).not.toBe(first.signature);
    expect(third.moneyText).toBe(formatMoney(state.player.money));
    state.player.money -= 12345;
  });

  it('reflects weather and moisture in cigarette badges', () => {
    const oldWeather = state.world.environment.weather;
    const oldMoisture = state.player.cigarette.moisture;
    state.world.environment.weather = 'rain';
    state.player.cigarette.moisture = 0.95;
    state.player.cigarette.isSheltered = false;
    const badges = cigaretteBadges(state);
    expect(badges.some((badge) => badge.label === 'soaked')).toBe(true);
    expect(badges.some((badge) => badge.label === 'in the rain')).toBe(true);
    state.world.environment.weather = oldWeather;
    state.player.cigarette.moisture = oldMoisture;
  });
});

describe('influenceTier', () => {
  it('matches the authoritative life-system ladder', () => {
    expect(influenceTier(0).name).toBe('New Resident');
    expect(influenceTier(49).name).toBe('New Resident');
    expect(influenceTier(50).name).toBe('Known Face');
    expect(influenceTier(150).name).toBe('Respected Neighbour');
    expect(influenceTier(400).name).toBe('Pillar of the Community');
    expect(influenceTier(800).name).toBe('Village Legend');
    expect(influenceTier(-10).name).toBe('New Resident');
  });

  it('reports progress towards the next rank', () => {
    const half = influenceTier(25);
    expect(half.progress).toBeCloseTo(0.5, 3);
    expect(half.nextText).toContain('Known Face');
    expect(influenceTier(1000).progress).toBe(1);
    expect(influenceTier(1000).nextMin).toBeNull();
  });
});

describe('inventory helpers', () => {
  it('filters by category and search text from real item definitions', () => {
    const seeds = filterInventory(state.player.inventory, content, { category: 'seed' });
    expect(seeds.length).toBeGreaterThan(0);
    for (const entry of seeds) expect(content.getItem(entry.itemId)?.category).toBe('seed');
    const turnips = filterInventory(state.player.inventory, content, { query: 'turnip' });
    expect(turnips.length).toBeGreaterThan(0);
    for (const entry of turnips) {
      const name = content.getItem(entry.itemId)?.name ?? '';
      expect(name.toLowerCase().includes('turnip') || entry.itemId.includes('turnip')).toBe(true);
    }
  });

  it('sorts by name and quantity without dropping entries', () => {
    const sorted = sortInventory(state.player.inventory, content, 'name');
    expect(sorted.length).toBe(state.player.inventory.length);
    const names = sorted.map((entry) => content.getItem(entry.itemId)?.name ?? entry.itemId);
    const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sortedNames);
    const byQuantity = sortInventory(state.player.inventory, content, 'quantity');
    for (let index = 1; index < byQuantity.length; index += 1) {
      expect(byQuantity[index - 1]!.quantity).toBeGreaterThanOrEqual(byQuantity[index]!.quantity);
    }
  });

  it('counts stacked items', () => {
    const entry = state.player.inventory[0];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(countItem(state.player.inventory, entry.itemId)).toBeGreaterThanOrEqual(entry.quantity);
  });
});

describe('recipeAvailability', () => {
  it('detects missing materials and maximum craftable quantity', () => {
    const recipe = content.getAllRecipes().find((candidate) => candidate.category === 'craft');
    expect(recipe).toBeDefined();
    if (!recipe) return;
    const knowledge = { playerKnown: ['*'], cookingKnown: [] };
    const empty = recipeAvailability({
      recipe,
      inventory: [],
      knowledge,
      skillLevel: 20,
      stationOk: true,
    });
    expect(empty.known).toBe(true);
    expect(empty.levelOk).toBe(true);
    expect(empty.stationOk).toBe(true);
    expect(empty.canCraft).toBe(false);
    expect(empty.missing.length).toBe(recipe.inputs.length);

    const inventory = recipe.inputs.map((input, index) => ({
      instanceId: 'instance_' + index,
      itemId: input.itemId,
      quantity: input.quantity * 3,
      quality: 3 as const,
      freshness: 1,
      acquiredAt: 0,
    }));
    const plenty = recipeAvailability({
      recipe,
      inventory,
      knowledge,
      skillLevel: 20,
      stationOk: true,
    });
    expect(plenty.missing).toEqual([]);
    expect(plenty.canCraft).toBe(true);
    expect(plenty.maxQuantity).toBe(3);

    const lockedLevel = recipeAvailability({
      recipe,
      inventory,
      knowledge,
      skillLevel: 0,
      stationOk: true,
    });
    expect(lockedLevel.levelOk).toBe(recipe.levelReq <= 0);
    expect(lockedLevel.canCraft).toBe(false);
  });

  it('honours the unlock requirement for gated recipes', () => {
    const gated = content.getAllRecipes().find((candidate) => candidate.unlockItemId !== undefined);
    if (!gated) return;
    const unknown = recipeAvailability({
      recipe: gated,
      inventory: [],
      knowledge: { playerKnown: [], cookingKnown: [] },
      skillLevel: 20,
      stationOk: true,
    });
    expect(unknown.known).toBe(false);
    const known = recipeAvailability({
      recipe: gated,
      inventory: [],
      knowledge: { playerKnown: [gated.id], cookingKnown: [] },
      skillLevel: 20,
      stationOk: true,
    });
    expect(known.known).toBe(true);
  });
});

describe('map projection', () => {
  it('projects real exterior locations with connection lines', () => {
    const projection = projectRegionMap('willowbrook', content, state);
    expect(projection.name).toBe('Willowbrook');
    expect(projection.nodes.length).toBeGreaterThan(0);
    expect(projection.edges.length).toBeGreaterThan(0);
    expect(projection.width).toBeGreaterThan(0);
    expect(projection.height).toBeGreaterThan(0);
    for (const node of projection.nodes) expect(node.def.regionId).toBe('willowbrook');
    for (const edge of projection.edges) {
      expect(projection.nodes.some((node) => node.def.id === edge.from)).toBe(true);
      expect(projection.nodes.some((node) => node.def.id === edge.to)).toBe(true);
    }
  });

  it('lists one-step neighbours from the mirrored walk graph', () => {
    const neighbours = adjacentLocations(content, state.player.position.locationId);
    expect(neighbours.length).toBeGreaterThan(0);
    for (const neighbour of neighbours) expect(neighbour.id).not.toBe(state.player.position.locationId);
  });
});

describe('furniture placement preview', () => {
  function homeWith(furniture: HomeState['furniture']): HomeState {
    return {
      id: 'home_test',
      regionId: 'willowbrook',
      locationId: 'home_test',
      name: 'Test home',
      ownerId: 'player',
      rooms: [
        { id: 'main', name: 'Main', widthTiles: 6, heightTiles: 5, unlocked: true, wallColor: '#fff', floorStyle: 'wood' },
      ],
      furniture,
      storage: [],
      comfort: 0,
      decorationScore: 0,
      wallColor: '#fff',
      floorStyle: 'wood',
      upgrades: [],
      gardens: [],
    };
  }
  const chair: FurnitureDef = {
    id: 'chair',
    itemId: 'chair_wood',
    name: 'Chair',
    description: 'A chair.',
    slot: 'floor',
    widthTiles: 1,
    heightTiles: 1,
    storageSlots: 0,
    comfort: 0.1,
    decor: 0.1,
    tags: [],
    visual: { shape: 'furniture', color: '#8a6844' },
  };
  const table: FurnitureDef = {
    id: 'table',
    itemId: 'table_wood',
    name: 'Table',
    description: 'A table.',
    slot: 'floor',
    widthTiles: 2,
    heightTiles: 2,
    storageSlots: 0,
    comfort: 0.2,
    decor: 0.2,
    tags: [],
    visual: { shape: 'furniture', color: '#8a6844' },
  };
  const resolve = (id: string): FurnitureDef | undefined => (id === 'chair' ? chair : id === 'table' ? table : undefined);

  it('accepts a free in-bounds placement', () => {
    const home = homeWith([]);
    const preview = previewFurniturePlacement({ home, def: table, roomId: 'main', x: 1, y: 1, rotation: 0, resolveFurniture: resolve });
    expect(preview.inBounds).toBe(true);
    expect(preview.collisionIds).toEqual([]);
    expect(preview.fits).toBe(true);
    expect(preview.width).toBe(2);
  });

  it('rejects out-of-bounds and overlapping blocking furniture', () => {
    const home = homeWith([
      { id: 'placed_chair', homeId: 'home_test', furnitureId: 'chair', roomId: 'main', x: 2, y: 2, rotation: 0 },
    ]);
    const outside = previewFurniturePlacement({ home, def: table, roomId: 'main', x: 5, y: 4, rotation: 0, resolveFurniture: resolve });
    expect(outside.inBounds).toBe(false);
    expect(outside.fits).toBe(false);
    const overlap = previewFurniturePlacement({ home, def: chair, roomId: 'main', x: 2, y: 2, rotation: 0, resolveFurniture: resolve });
    expect(overlap.collisionIds).toEqual(['placed_chair']);
    expect(overlap.fits).toBe(false);
  });

  it('swaps the footprint when rotated 90 degrees', () => {
    const home = homeWith([]);
    const portrait: FurnitureDef = { ...table, widthTiles: 1, heightTiles: 3 };
    const rotated = previewFurniturePlacement({ home, def: portrait, roomId: 'main', x: 0, y: 0, rotation: 90, resolveFurniture: resolve });
    expect(rotated.width).toBe(3);
    expect(rotated.height).toBe(1);
  });
});

describe('settings / input helpers', () => {
  it('resolves default and custom UI shortcuts', () => {
    const settings = createDefaultSettings();
    const defaults = resolveShortcuts(settings);
    expect(defaults.inventory).toBe('I');
    expect(defaults.help).toBe('TAB');
    expect(defaults.debugProbability).toBe('F12');
    const custom = resolveShortcuts({ ...settings, keybindings: { ...settings.keybindings, 'ui.inventory': 'q' } });
    expect(custom.inventory).toBe('Q');
    expect(custom.map).toBe('M');
  });

  it('normalises key names for rebinding', () => {
    expect(normaliseKeyName('i')).toBe('I');
    expect(normaliseKeyName('Tab')).toBe('TAB');
    expect(normaliseKeyName('Escape')).toBe('ESC');
    expect(normaliseKeyName(' ')).toBe('SPACE');
    expect(normaliseKeyName('F12')).toBe('F12');
  });

  it('validates seeds and colours', () => {
    expect(parseSeed('')).toBeNull();
    expect(parseSeed('42')).toBe(42);
    expect(parseSeed('-1')).toBeNull();
    expect(parseSeed('abc')).toBeNull();
    expect(parseSeed('4294967296')).toBeNull();
    expect(sanitiseHexColor('#ABC', '#000000')).toBe('#aabbcc');
    expect(sanitiseHexColor('not-a-colour', '#123456')).toBe('#123456');
  });

  it('totalSkillLevels accepts both live progress and archived numbers', () => {
    expect(totalSkillLevels({ gardening: { level: 3 }, fishing: { level: 2 } })).toBe(5);
    expect(totalSkillLevels({ gardening: 4, fishing: 1 } as unknown as Record<string, number>)).toBe(5);
  });
});

describe('probability candidate bars', () => {
  it('normalises eligible weights to percentages that sum to 100', () => {
    const record = {
      decisionId: 'd1',
      streamId: 'stream',
      decisionType: 'test',
      context: {},
      selectedOptionId: 'a',
      timestamp: 0,
      candidates: [
        { id: 'a', baseWeight: 1, finalWeight: 3, probability: 0, modifiers: [], eligible: true, rejectionReason: null },
        { id: 'b', baseWeight: 1, finalWeight: 1, probability: 0, modifiers: [], eligible: true, rejectionReason: null },
        { id: 'c', baseWeight: 1, finalWeight: 0, probability: 0, modifiers: [], eligible: false, rejectionReason: 'nope' },
      ],
    };
    const bars = candidateBars(record as never);
    const total = bars.reduce((sum, bar) => sum + bar.probabilityPercent, 0);
    expect(total).toBeCloseTo(100, 5);
    expect(bars[0]?.id).toBe('a');
    expect(bars[0]?.probabilityPercent).toBeCloseTo(75, 5);
    const ineligible = bars.find((bar) => bar.id === 'c');
    expect(ineligible?.eligible).toBe(false);
    expect(ineligible?.probabilityPercent).toBe(0);
  });
});
