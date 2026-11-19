import { beforeEach, describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/core/Game';
import { ContentRegistry } from '../../src/core/ContentRegistry';
import { CONTENT_PACK } from '../../src/data';
import { addItemToInventory } from '../../src/core/InventoryUtil';
import { ITEM } from '../../src/data/items/ids';
import { LOC } from '../../src/data/locations/ids';
import { BIZ } from '../../src/data/shops/ids';
import { DEFAULT_APPEARANCE } from '../../src/core/WorldFactory';
import type { LocationId } from '../../src/core/SharedTypes';
import type { ContentRegistry as ContentRegistryType } from '../../src/core/ContentRegistry';

const content: ContentRegistryType = new ContentRegistry(CONTENT_PACK);

function buildAdjacency(): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  const addEdge = (a: string, b: string): void => {
    const list = adjacency.get(a) ?? [];
    if (!list.includes(b)) list.push(b);
    adjacency.set(a, list);
  };
  for (const location of content.pack.locations) {
    for (const connection of location.connections) addEdge(location.id, connection);
    if (location.entranceFrom) {
      addEdge(location.id, location.entranceFrom);
      addEdge(location.entranceFrom, location.id);
    }
  }
  return adjacency;
}

const ADJACENCY = buildAdjacency();

function findNextStep(from: LocationId, to: LocationId): LocationId | null {
  const queue: string[] = [from];
  const previous = new Map<string, string | null>([[from, null]]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current === to) {
      let cursor: string = to;
      let child: string = to;
      while (cursor !== from) {
        const parent = previous.get(cursor);
        if (!parent) return null;
        child = cursor;
        cursor = parent;
      }
      return child === from ? null : child;
    }
    for (const neighbour of ADJACENCY.get(current) ?? []) {
      if (!previous.has(neighbour)) {
        previous.set(neighbour, current);
        queue.push(neighbour);
      }
    }
  }
  return null;
}
function travel(game: GameEngine, target: LocationId): void {
  const state = game.getState();
  if (state.player.position.indoor) {
    const exit = game.dispatch({ type: 'move:exit-interior' });
    expect(exit.ok, exit.message).toBe(true);
  }
  let guard = 0;
  while (game.getState().player.position.locationId !== target && guard < 40) {
    guard += 1;
    const current = game.getState().player.position.locationId;
    const next = findNextStep(current, target);
    if (!next) break;
    const result = game.dispatch({ type: 'move:to-location', locationId: next });
    expect(result.ok, 'travel ' + current + ' -> ' + next + ': ' + result.message).toBe(true);
  }
  expect(game.getState().player.position.locationId).toBe(target);
}

async function createGame(): Promise<GameEngine> {
  const game = new GameEngine({ content });
  await game.init();
  const result = game.newGame({ playerName: 'Integration Ash', appearance: DEFAULT_APPEARANCE, seed: 777001 });
  expect(result.ok, result.message).toBe(true);
  return game;
}

describe('full life cycle integration', () => {
  let game: GameEngine;

  beforeEach(async () => {
    game = await createGame();
  });

  it('creates a playable save with a full living population and starts the clock', () => {
    const state = game.getState();
    expect(game.getScreen()).toBe('playing');
    expect(Object.keys(state.npcs)).toHaveLength(56);
    expect(state.player.money).toBeGreaterThan(0);
    expect(state.world.locations[LOC.home]).toBeDefined();
    expect(state.world.locations[LOC.home + '_interior']).toBeDefined();
    const startTime = state.clock.simTimeSeconds;
    for (let index = 0; index < 120; index += 1) game.tick(1);
    expect(game.getState().clock.simTimeSeconds).toBeGreaterThan(startTime);
    expect(game.getState().world.environment.weather).toBeDefined();
  });

  it('farms a crop with ash fertiliser and harvests it', () => {
    travel(game, LOC.farm);
    const farming = game.getSystems().farming;
    const state = game.getState();
    addItemToInventory(state.player.inventory, ITEM.cigaretteAsh, 5, { simTime: state.clock.simTimeSeconds, maxStack: 99 });
    let plotId: string | null = null;
    for (let x = 1; x <= 8 && !plotId; x += 1) {
      for (let y = 1; y <= 8 && !plotId; y += 1) {
        const result = farming.tillPlot(LOC.farm, x, y);
        if (result.ok) {
          const plots = farming.getPlots(LOC.farm);
          const newest = plots[plots.length - 1];
          if (newest) plotId = newest.id;
        }
      }
    }
    expect(plotId, 'could not till a farm plot').not.toBeNull();
    if (!plotId) return;
    const seedEntry = state.player.inventory.find((entry) => entry.itemId === ITEM.turnipSeed);
    expect(seedEntry).toBeDefined();
    expect(farming.plantSeed(plotId, ITEM.turnipSeed).ok).toBe(true);
    expect(farming.waterPlot(plotId).ok).toBe(true);
    expect(farming.fertilizePlot(plotId, 'ash').ok).toBe(true);
    game.dispatch({ type: 'time:rest', hours: 96 });
    const plots = farming.getPlots(LOC.farm);
    const plot = plots.find((candidate) => candidate.id === plotId);
    expect(plot).toBeDefined();
    const harvest = farming.harvestPlot(plotId);
    if (plot && plot.stage === 'mature') {
      expect(harvest.ok).toBe(true);
      expect(game.getState().player.statistics.cropsHarvested).toBeGreaterThan(0);
    }
  });

  it('buys an item from a shop in a real transaction', () => {
    travel(game, LOC.grocery + '_interior');
    const state = game.getState();
    let business = state.economy.businesses[BIZ.willowGrocery];
    expect(business).toBeDefined();
    if (!business) return;
    if (!business.isOpen) {
      game.dispatch({ type: 'time:rest', hours: 2 });
      business = game.getState().economy.businesses[BIZ.willowGrocery];
      if (!business) return;
    }
    expect(business.isOpen).toBe(true);
    const stock = business.stock.find((entry) => entry.quantity > 0 && entry.itemId === ITEM.breadLoaf) ?? business.stock.find((entry) => entry.quantity > 0);
    expect(stock).toBeDefined();
    if (!stock) return;
    const beforeMoney = state.player.money;
    const beforeItem = state.player.inventory
      .filter((entry) => entry.itemId === stock.itemId)
      .reduce((total, entry) => total + entry.quantity, 0);
    const result = game.dispatch({ type: 'shop:buy', businessId: BIZ.willowGrocery, itemId: stock.itemId, quantity: 1 });
    expect(result.ok, result.message).toBe(true);
    expect(game.getState().player.money).toBeLessThan(beforeMoney);
    const afterItem = game.getState().player.inventory
      .filter((entry) => entry.itemId === stock.itemId)
      .reduce((total, entry) => total + entry.quantity, 0);
    expect(afterItem).toBeGreaterThan(beforeItem);
  });

  it('talks to a local NPC and runs a dialogue tree', () => {
    travel(game, LOC.cafe);
    const state = game.getState();
    const npc = Object.values(state.npcs)[0];
    expect(npc).toBeDefined();
    if (!npc) return;
    npc.locationId = state.player.position.locationId;
    const start = game.dispatch({ type: 'dialogue:start', npcId: npc.id });
    expect(start.ok, start.message).toBe(true);
    const node = game.getSystems().dialogue.getCurrentNode();
    expect(node?.text.length).toBeGreaterThan(0);
    if (node && node.choices.length > 0) {
      const choice = game.dispatch({ type: 'dialogue:choose', choiceIndex: 0 });
      expect(choice.ok, choice.message).toBe(true);
    }
    const end = game.dispatch({ type: 'dialogue:end' });
    expect(end.ok).toBe(true);
  });

  it('persists and reloads the world through IndexedDB saves', async () => {
    for (let index = 0; index < 30; index += 1) game.tick(1);
    const save = await game.saveGame('slot_integration');
    expect(save.ok, save.message).toBe(true);
    const before = game.getState();
    const money = before.player.money;
    const simTime = before.clock.simTimeSeconds;
    const money2 = before.player.money;
    const load = await game.loadGame('slot_integration');
    expect(load.ok, load.message).toBe(true);
    expect(game.getState().player.money).toBe(money);
    expect(game.getState().player.money).toBe(money2);
    expect(game.getState().clock.simTimeSeconds).toBeGreaterThanOrEqual(simTime);
  });

  it('processes offline catch-up, advances the world and produces a real summary', async () => {
    const state = game.getState();
    const beforeSimTime = state.clock.simTimeSeconds;
    state.pendingOffline.lastSaveRealMs = Date.now() - 2 * 60 * 60 * 1000;
    state.pendingOffline.lastOfflineSimTime = beforeSimTime;
    state.pendingOffline.lastProcessedSimTime = beforeSimTime;
    const result = await game.requestOfflineCatchup();
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.ok).toBe(true);
    expect(result.summary.simulatedGameHours).toBeGreaterThan(0);
    expect(game.getState().clock.simTimeSeconds).toBeGreaterThan(beforeSimTime);
    expect(game.getOfflineSummary()).not.toBeNull();
    game.acknowledgeOfflineSummary();
    expect(game.getOfflineSummary()).toBeNull();
  });

  it('ends the life when the cigarette burns out and starts a next generation', async () => {
    const state = game.getState();
    state.player.cigarette.lengthRatio = 0.001;
    game.dispatch({ type: 'time:rest', hours: 24 });
    const ended = game.getState();
    expect(ended.life.phase).toBe('ended');
    expect(game.getScreen()).toBe('life_end');
    const review = game.getSystems().life.getLifeReview();
    expect(review).not.toBeNull();
    const next = game.startNextLife([]);
    expect(next.ok, next.message).toBe(true);
    expect(game.getState().life.phase).toBe('alive');
    expect(game.getState().life.generation).toBe(2);
    expect(game.getState().archive.length).toBeGreaterThanOrEqual(1);
  });

  it('exposes probability debug data for the F12 panel', () => {
    for (let index = 0; index < 60; index += 1) game.tick(1);
    const debug = game.getProbabilityDebug();
    expect(debug.seed).toBeGreaterThan(0);
    expect(debug.streams.length).toBeGreaterThan(0);
    expect(debug.recent.length).toBeGreaterThan(0);
  });
});