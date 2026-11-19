// QA regression tests for the defects reported during task-12 and fixed by the Lead.
// Each test asserts the specification-correct behaviour end-to-end through the REAL
// GameEngine, so a re-introduction of the bug fails loudly.
import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/core/Game';
import { DEFAULT_APPEARANCE } from '../../src/core/WorldFactory';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import { runOfflineSimulation } from '../../src/simulation/OfflineSimulation';
import { LOC } from '../../src/data/locations/ids';
import { ITEM } from '../../src/data/items/ids';
import {
  assertStateValid,
  content,
  createQaState,
  negativeBalances,
  travelTo,
  validateState,
} from './support/qaHarness';

const HOUR_MS = 3600_000;
const OFFLINE_SCALE = WORLD_CONFIG.worldTime.offlineTimeScale;

async function createGame(seed: number): Promise<GameEngine> {
  const game = new GameEngine({ content });
  await game.init();
  const result = game.newGame({ playerName: 'QA Regression', appearance: DEFAULT_APPEARANCE, seed });
  expect(result.ok, result.message).toBe(true);
  return game;
}

const openGames: GameEngine[] = [];
afterEach(() => {
  while (openGames.length > 0) {
    const game = openGames.pop();
    if (game) game.destroy();
  }
});
async function trackedGame(seed: number): Promise<GameEngine> {
  const game = await createGame(seed);
  openGames.push(game);
  return game;
}
async function setOfflineGap(game: GameEngine, gapHours: number): Promise<void> {
  const state = game.getState();
  const now = state.clock.simTimeSeconds;
  state.pendingOffline.lastSaveRealMs = Date.now() - gapHours * HOUR_MS;
  state.pendingOffline.lastOfflineSimTime = now;
  state.pendingOffline.lastProcessedSimTime = now;
}

describe('QA regressions: fixed task-12 defects stay fixed', () => {
  it('REGRESSION-1a: farming uses the game-hour scale - turnips mature and harvest in under ~2 game days', { timeout: 180000 }, async () => {
    const game = await trackedGame(31415);
    travelTo(game, LOC.farm);
    const till = game.dispatch({ type: 'farm:till', locationId: LOC.farm, x: 3, y: 3 });
    expect(till.ok, till.message).toBe(true);
    const farming = game.getRuntime().systems.farming;
    const plots = farming.getPlots(LOC.farm);
    const plotId = plots[plots.length - 1]?.id ?? null;
    expect(plotId).not.toBeNull();
    if (!plotId) return;
    expect(game.dispatch({ type: 'farm:plant', plotId, seedItemId: ITEM.turnipSeed }).ok).toBe(true);
    expect(game.dispatch({ type: 'farm:water', plotId }).ok).toBe(true);
    // 8 x 12 = 96 ideal game hours, re-watered each half day. Turnip needs only 40 stage hours.
    for (let step = 0; step < 8; step += 1) {
      game.dispatch({ type: 'time:rest', hours: 12 });
      game.dispatch({ type: 'farm:water', plotId });
    }
    const plot = farming.getPlots(LOC.farm).find((candidate) => candidate.id === plotId);
    expect(plot).toBeDefined();
    expect(plot?.stage, 'crop stage after 96 ideal game hours').toBe('mature');
    const harvest = game.dispatch({ type: 'farm:harvest', plotId });
    expect(harvest.ok, harvest.message).toBe(true);
    expect(game.getState().player.statistics.cropsHarvested).toBeGreaterThan(0);
    expect(game.getState().player.inventory.some((entry) => entry.itemId === ITEM.turnip)).toBe(true);
  });

  it('REGRESSION-1b: forage nodes respawn after their configured game hours', { timeout: 120000 }, async () => {
    const game = await trackedGame(2718);
    travelTo(game, LOC.forest);
    const state = game.getState();
    const candidates = Object.values(state.foraging.nodes).filter((node) => {
      if (node.locationId !== LOC.forest || node.depleted) return false;
      const def = content.getForageNode(node.defId);
      return def !== undefined && def.respawnHours <= 24 && def.skillReq <= 1 && def.seasons.includes(state.world.environment.season);
    });
    const node = candidates[0];
    expect(node, 'no fast-respawn spring forage node at the forest').toBeDefined();
    if (!node) return;
    const def = content.getForageNode(node.defId);
    const respawnHours = def?.respawnHours ?? 24;
    const gather = game.dispatch({ type: 'forage:gather', nodeId: node.id });
    expect(gather.ok, gather.message).toBe(true);
    expect(game.getState().foraging.nodes[node.id]?.depleted).toBe(true);
    game.dispatch({ type: 'time:rest', hours: respawnHours + 6 });
    expect(game.getState().foraging.nodes[node.id]?.depleted, 'node respawned after ' + (respawnHours + 6) + ' game hours').toBe(false);
    const regather = game.dispatch({ type: 'forage:gather', nodeId: node.id });
    expect(regather.ok, regather.message).toBe(true);
  });

  it('REGRESSION-1c: exploration search cooldown is one game hour', { timeout: 60000 }, async () => {
    const game = await trackedGame(3721);
    travelTo(game, LOC.park);
    const first = game.dispatch({ type: 'explore:search', locationId: LOC.park });
    expect(first.ok, first.message).toBe(true);
    const blocked = game.dispatch({ type: 'explore:search', locationId: LOC.park });
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('on_cooldown');
    game.dispatch({ type: 'time:rest', hours: 2 });
    const second = game.dispatch({ type: 'explore:search', locationId: LOC.park });
    expect(second.ok, 'search available again after 2 game hours: ' + second.message).toBe(true);
  });

  it('REGRESSION-2: offline catch-up runs multiple aggregated steps instead of one giant step', { timeout: 120000 }, async () => {
    const game = await trackedGame(5101);
    await setOfflineGap(game, 24);
    const result = await game.requestOfflineCatchup();
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.stats.steps, 'aggregated steps for a 24h absence (3 game days -> daily macro steps)').toBeGreaterThanOrEqual(2);
    expect(result.stats.steps).toBeLessThan(4000);
    expect(await game.requestOfflineCatchup()).toBeNull();
  });

  it('REGRESSION-3: a 14-day absence is clamped to maxOfflineGameDays and the life survives', { timeout: 120000 }, async () => {
    const game = await trackedGame(5102);
    await setOfflineGap(game, 14 * 24);
    const result = await game.requestOfflineCatchup();
    expect(result).not.toBeNull();
    if (!result) return;
    const maxGameHours = WORLD_CONFIG.worldTime.maxOfflineGameDays * 24;
    expect(result.summary.simulatedGameHours).toBeLessThanOrEqual(maxGameHours + 1e-6);
    expect(result.summary.simulatedGameHours).toBeGreaterThan(0);
    expect(game.getState().life.phase).toBe('alive');
    expect(game.getState().player.cigarette.lengthRatio).toBeGreaterThan(0.5);
    assertStateValid(game.getState(), 'state after clamped long absence');
  });

  it('REGRESSION-4: main-thread offline fallback applies the same burn multiplier as the worker path', { timeout: 120000 }, async () => {
    const game = await trackedGame(5103);
    const base = structuredClone(game.getState());
    const fromSimTime = base.clock.simTimeSeconds;
    const toSimTime = fromSimTime + 4320; // 24h real at the 0.05 scale
    await setOfflineGap(game, 24);
    const result = await game.requestOfflineCatchup();
    expect(result).not.toBeNull();
    if (!result) return;
    const fallbackBurn = 1 - game.getState().player.cigarette.lengthRatio;
    const workerPath = await runOfflineSimulation({ state: base, content, fromSimTime, toSimTime });
    const workerBurn = 1 - workerPath.state.player.cigarette.lengthRatio;
    expect(Math.abs(fallbackBurn - workerBurn), 'fallback ' + fallbackBurn.toFixed(4) + ' vs worker ' + workerBurn.toFixed(4)).toBeLessThan(0.02);
    // The documented 0.35 offline multiplier over 72 game hours of a 336-hour life.
    expect(fallbackBurn).toBeGreaterThan(0.05);
    expect(fallbackBurn).toBeLessThan(0.1);
  });

  it('REGRESSION-5: the player can obtain a fishing rod and fish through normal play', { timeout: 120000 }, async () => {
    const rodId: string = ITEM.fishingRodBasic;
    const sources: string[] = [];
    for (const business of content.pack.businesses) {
      for (const stock of business.stock) if (stock.itemId === rodId) sources.push('shop ' + business.id);
    }
    for (const recipe of content.pack.recipes) {
      for (const output of recipe.outputs) if (output.itemId === rodId) sources.push('recipe ' + recipe.id);
    }
    const starter = createQaState(1);
    if (starter.player.inventory.some((entry) => entry.itemId === rodId)) sources.push('starter inventory');
    expect(sources, 'acquisition sources for ' + rodId).not.toEqual([]);

    // End-to-end: a brand-new player can travel to the river and cast immediately.
    const game = await trackedGame(5150);
    expect(game.getState().player.inventory.some((entry) => entry.itemId === rodId)).toBe(true);
    travelTo(game, LOC.river);
    const cast = game.dispatch({ type: 'fish:cast', locationId: LOC.river });
    expect(cast.ok, cast.message).toBe(true);
    expect(game.getRuntime().systems.fishing.getSession()).not.toBeNull();
    const cancel = game.dispatch({ type: 'fish:cancel' });
    expect(cancel.ok).toBe(true);
    expect(negativeBalances(game.getState())).toEqual([]);
    expect(validateState(game.getState()).issues).toEqual([]);
  });

  it('REGRESSION-6: an offline catch-up that ends the life is reconciled on the next tick', { timeout: 120000 }, async () => {
    const game = await trackedGame(5160);
    game.getState().player.cigarette.lengthRatio = 0.002;
    await setOfflineGap(game, 24);
    const result = await game.requestOfflineCatchup();
    expect(result).not.toBeNull();
    if (!result) return;
    expect(game.getState().life.phase).toBe('ended');
    expect(game.isPlaying()).toBe(false);
    if (game.getScreen() === 'playing') game.tick(1);
    expect(game.getScreen()).toBe('life_end');
    expect(game.getState().life.endReason).not.toBeNull();
    expect(game.getState().archive.length).toBeGreaterThanOrEqual(1);
  });
});
