// QA offline catch-up: 24h / 72h / 14d real gaps through the REAL GameEngine, plus the
// deterministic replay property of the offline simulation pipeline itself.
//
// The expected simulated span is derived from the summary's own realElapsedMs (the test sets
// lastSaveRealMs with Date.now(), and the request is sent a few ms later), so a slow test
// machine cannot turn the assertion flaky; a separate assertion checks the nominal gap.
import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/core/Game';
import { DEFAULT_APPEARANCE } from '../../src/core/WorldFactory';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import { runOfflineSimulation } from '../../src/simulation/OfflineSimulation';
import {
  assertStateValid,
  content,
  createQaState,
  gameplayFingerprint,
  negativeBalances,
  validateState,
} from './support/qaHarness';

const HOUR_MS = 3600_000;
const OFFLINE_SCALE = WORLD_CONFIG.worldTime.offlineTimeScale;
const MAX_OFFLINE_SIM_SECONDS = WORLD_CONFIG.worldTime.maxOfflineGameDays * 1440;

async function createGame(seed: number): Promise<GameEngine> {
  const game = new GameEngine({ content });
  await game.init();
  const result = game.newGame({
    playerName: 'QA Offline',
    appearance: DEFAULT_APPEARANCE,
    seed,
    slotId: 'qa_offline_' + seed,
  });
  expect(result.ok, result.message).toBe(true);
  return game;
}

interface OfflineOutcome {
  elapsedMs: number;
  result: NonNullable<Awaited<ReturnType<GameEngine['requestOfflineCatchup']>>>;
  fromSimTime: number;
}

async function catchUp(game: GameEngine, gapHours: number): Promise<OfflineOutcome | null> {
  const state = game.getState();
  const fromSimTime = state.clock.simTimeSeconds;
  state.pendingOffline.lastSaveRealMs = Date.now() - gapHours * HOUR_MS;
  state.pendingOffline.lastOfflineSimTime = fromSimTime;
  state.pendingOffline.lastProcessedSimTime = fromSimTime;
  const started = performance.now();
  const result = await game.requestOfflineCatchup();
  const elapsedMs = performance.now() - started;
  return result ? { elapsedMs, result, fromSimTime } : null;
}

/** Simulated seconds the engine is expected to add for a real gap (cap included). */
function expectedSimSeconds(realElapsedMs: number): number {
  return Math.min((realElapsedMs / 1000) * OFFLINE_SCALE, MAX_OFFLINE_SIM_SECONDS);
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

describe('QA: offline catch-up stress (GameEngine)', () => {
  it('settles 24h and 72h real gaps truthfully, within budget, and idempotently', { timeout: 180000 }, async () => {
    const cases = [
      { seed: 7101, gapHours: 24 },
      { seed: 7102, gapHours: 72 },
    ];
    for (const testCase of cases) {
      const game = await trackedGame(testCase.seed);
      const outcome = await catchUp(game, testCase.gapHours);
      expect(outcome, 'gap ' + testCase.gapHours + 'h returned no result').not.toBeNull();
      if (!outcome) continue;
      const result = outcome.result;

      // -- truthful summary -------------------------------------------------
      const expected = expectedSimSeconds(result.summary.realElapsedMs);
      const nominal = Math.min(((testCase.gapHours * HOUR_MS) / 1000) * OFFLINE_SCALE, MAX_OFFLINE_SIM_SECONDS);
      expect(result.ok).toBe(true);
      expect(result.summary.fromSimTime).toBe(outcome.fromSimTime);
      expect(result.summary.toSimTime - result.summary.fromSimTime).toBeCloseTo(expected, 6);
      expect(result.summary.simulatedGameHours).toBeCloseTo(expected / 60, 6);
      // Date.now() jitter only: the measured gap is never far from the nominal gap.
      expect(Math.abs(expected - nominal)).toBeLessThan(5);
      expect(result.summary.realElapsedMs).toBeGreaterThan(0);
      expect(result.summary.headline.length).toBeGreaterThan(10);
      expect(result.summary.changes.length).toBeLessThanOrEqual(60);
      for (const change of result.summary.changes) {
        expect(change.description.length, 'empty offline change description').toBeGreaterThan(0);
        expect(Number.isFinite(change.importance)).toBe(true);
      }
      expect(result.summary.importantNpcUpdates.length).toBeLessThanOrEqual(8);
      const worldEventIds = new Set(result.state.world.events.map((event) => event.id));
      for (const eventId of result.summary.newEvents) {
        expect(worldEventIds.has(eventId), 'summary event ' + eventId + ' is not in world.events').toBe(true);
      }
      expect(result.state.clock.simTimeSeconds).toBeCloseTo(result.summary.toSimTime, 6);
      expect(game.getState().clock.simTimeSeconds).toBeCloseTo(result.summary.toSimTime, 6);

      // -- player / economy integrity --------------------------------------
      expect(validateState(game.getState()).issues).toEqual([]);
      expect(negativeBalances(game.getState())).toEqual([]);
      const burn = 1 - game.getState().player.cigarette.lengthRatio;
      expect(burn).toBeGreaterThan(0);
      expect(burn).toBeLessThan(1);
      expect(game.getState().life.phase).toBe('alive');

      // -- pending evidence stored for the UI -------------------------------
      expect(game.getOfflineSummary()).not.toBeNull();
      expect(game.getState().pendingOffline.lastProcessedSimTime).toBeCloseTo(result.summary.toSimTime, 6);
      expect(game.getState().pendingOffline.lastOfflineSimTime).toBeCloseTo(result.summary.toSimTime, 6);
      expect(game.getState().pendingOffline.pendingSummary).not.toBeNull();

      // -- idempotency: an immediate second request must be a no-op ---------
      const clockAfter = game.getState().clock.simTimeSeconds;
      const moneyAfter = game.getState().player.money;
      const second = await game.requestOfflineCatchup();
      expect(second, 'immediate second offline request must not double-settle').toBeNull();
      expect(game.getState().clock.simTimeSeconds).toBe(clockAfter);
      expect(game.getState().player.money).toBe(moneyAfter);

      // -- bounded runtime --------------------------------------------------
      expect(outcome.elapsedMs).toBeLessThan(15000);
      console.log(
        'QA offline gap=' + testCase.gapHours + 'h elapsedMs=' + outcome.elapsedMs.toFixed(0) +
        ' steps=' + result.stats.steps + ' simHours=' + result.summary.simulatedGameHours.toFixed(1) +
        ' changes=' + result.summary.changes.length + ' burn=' + burn.toFixed(3) +
        ' history=' + game.getState().world.history.length
      );
    }
  });

  it('clamps a 14-day absence to maxOfflineGameDays and keeps the life alive', { timeout: 180000 }, async () => {
    const game = await trackedGame(7103);
    const outcome = await catchUp(game, 14 * 24);
    expect(outcome).not.toBeNull();
    if (!outcome) return;
    const result = outcome.result;
    const expected = expectedSimSeconds(result.summary.realElapsedMs);
    expect(result.ok).toBe(true);
    expect(result.summary.toSimTime - result.summary.fromSimTime).toBeCloseTo(expected, 6);
    expect(expected).toBeLessThanOrEqual(MAX_OFFLINE_SIM_SECONDS + 1e-6);
    expect(result.summary.simulatedGameHours).toBeCloseTo(expected / 60, 6);
    // 14 real days would be 42 game days; the configured cap must clamp it.
    expect(result.summary.simulatedGameHours).toBeLessThanOrEqual(WORLD_CONFIG.worldTime.maxOfflineGameDays * 24 + 1e-6);

    assertStateValid(game.getState(), 'state after 14d offline');
    expect(negativeBalances(game.getState())).toEqual([]);
    // With the intended cap and the 0.35 offline burn multiplier the cigarette survives.
    expect(game.getState().life.phase).toBe('alive');
    expect(game.getState().player.cigarette.lengthRatio).toBeGreaterThan(0.5);

    const second = await game.requestOfflineCatchup();
    expect(second).toBeNull();
    expect(outcome.elapsedMs).toBeLessThan(15000);
    console.log(
      'QA offline gap=14d elapsedMs=' + outcome.elapsedMs.toFixed(0) + ' steps=' + result.stats.steps +
      ' simHours=' + result.summary.simulatedGameHours.toFixed(1) +
      ' lengthRatio=' + game.getState().player.cigarette.lengthRatio.toFixed(3)
    );
  });

  it('replays an identical offline window deterministically (idempotent settlement result)', { timeout: 60000 }, async () => {
    const base = createQaState(7201);
    const fromSimTime = base.clock.simTimeSeconds;
    const toSimTime = fromSimTime + 4320; // = 24h real offline at the configured 0.05 scale
    const first = await runOfflineSimulation({ state: structuredClone(base), content, fromSimTime, toSimTime });
    const second = await runOfflineSimulation({ state: structuredClone(base), content, fromSimTime, toSimTime });
    expect(second.state.clock.simTimeSeconds).toBe(first.state.clock.simTimeSeconds);
    expect(gameplayFingerprint(second.state)).toBe(gameplayFingerprint(first.state));
    expect(second.summary.toSimTime).toBe(first.summary.toSimTime);
    expect(second.summary.simulatedGameHours).toBe(first.summary.simulatedGameHours);
    expect(second.stats.steps).toBe(first.stats.steps);
    assertStateValid(first.state, 'offline replay state');
  });
});
