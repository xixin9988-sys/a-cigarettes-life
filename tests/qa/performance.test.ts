// QA performance budgets and bounded-growth checks.
// Numbers are measured with performance.now(); budgets are deliberately generous for CI
// but tight enough to catch accidental O(n^2) or unbounded-log regressions.
import { describe, expect, it } from 'vitest';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import { runHeadlessSimulation } from '../../src/simulation/SimulationReplay';
import { SimulationRuntime } from '../../src/simulation/SimulationRuntime';
import { SaveManager } from '../../src/persistence/SaveManager';
import { MemorySaveStorage } from '../../src/persistence/IndexedDBStorage';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import { addWorldHistory, trimWorldHistory } from '../../src/world/WorldHistory';
import type { GameState, ProbabilityRequest } from '../../src/core/contracts';
import { assertStateValid, content, createQaState, gameplayFingerprint } from './support/qaHarness';

const PROBABILITY_REQUEST: ProbabilityRequest<string> = {
  streamId: 'npc.behavior',
  decisionType: 'qa.performance',
  context: { worldId: 'world_qa', lifeId: 'life_qa', simulationTime: 1234, season: 'spring', weather: 'clear' },
  candidates: [
    { id: 'work', baseWeight: 50, conditions: [{ op: 'always' }], result: 'work' },
    { id: 'social', baseWeight: 25, conditions: [{ op: 'always' }], result: 'social' },
    { id: 'leisure', baseWeight: 25, conditions: [{ op: 'cmp', path: 'season', cmp: 'eq', value: 'spring' }], result: 'leisure' },
  ],
};

describe('QA: performance budgets', () => {
  it('performs 20k probability decisions and 200k primitive draws within budget', { timeout: 60000 }, () => {
    const engine = new ProbabilityEngine();
    engine.init(20260101);
    const decideStart = performance.now();
    for (let draw = 0; draw < 20000; draw += 1) engine.decide(PROBABILITY_REQUEST);
    const decideMs = performance.now() - decideStart;
    const perDecisionUs = (decideMs * 1000) / 20000;
    expect(decideMs, '20k decisions elapsed ms').toBeLessThan(5000);
    expect(perDecisionUs, 'microseconds per decision').toBeLessThan(1000);
    expect(engine.getStats('npc.behavior').decisions).toBe(20000);
    expect(engine.getHistory().length).toBeLessThanOrEqual(WORLD_CONFIG.probability.historyLimit);

    const rollStart = performance.now();
    for (let draw = 0; draw < 200000; draw += 1) engine.roll('npc.social');
    const rollMs = performance.now() - rollStart;
    expect(rollMs, '200k primitive draws elapsed ms').toBeLessThan(5000);

    // Determinism: two fresh engines with the same seed => same decisions and sample counts.
    const freshA = new ProbabilityEngine();
    freshA.init(20260101);
    const freshB = new ProbabilityEngine();
    freshB.init(20260101);
    const firstIds: string[] = [];
    const twinIds: string[] = [];
    for (let index = 0; index < 200; index += 1) {
      firstIds.push(freshA.decide(PROBABILITY_REQUEST).selectedOptionId ?? '');
      twinIds.push(freshB.decide(PROBABILITY_REQUEST).selectedOptionId ?? '');
    }
    expect(twinIds).toEqual(firstIds);
    const sampled = freshA.simulate(PROBABILITY_REQUEST, 5000);
    const twinSampled = freshB.simulate(PROBABILITY_REQUEST, 5000);
    expect(twinSampled).toEqual(sampled);
    // The 20k-decision engine's own history remains capped and complete.
    expect(engine.getHistory(5).length).toBe(5);
    expect(Object.values(sampled).reduce((total, count) => total + count, 0)).toBe(5000);
    for (const count of Object.values(sampled)) expect(count).toBeGreaterThan(0);
    console.log(
      'QA perf 20k decisions=' + decideMs.toFixed(1) + 'ms (' + perDecisionUs.toFixed(2) + 'us/decision), ' +
      '200k rolls=' + rollMs.toFixed(1) + 'ms, history=' + engine.getHistory().length
    );
  });

  it('simulates all 56 NPCs for 30 game days fast enough and keeps logs bounded', { timeout: 180000 }, () => {
    const started = performance.now();
    // 6-hour aggregation steps exercise the documented large-dt tolerance of every system.
    const result = runHeadlessSimulation({ seed: 5150, days: 30, stepMinutes: 360 });
    const elapsedMs = performance.now() - started;
    expect(elapsedMs, '30-day headless run elapsed ms').toBeLessThan(30000);
    expect(Object.keys(result.state.npcs)).toHaveLength(WORLD_CONFIG.population.initialNpcCount);
    expect(result.state.probability.decisionCount, 'NPC decisions were recorded').toBeGreaterThan(1000);
    assertStateValid(result.state, '30-day headless state');
    expect(result.state.world.events.length).toBeLessThanOrEqual(WORLD_CONFIG.simulation.maxWorldEventLog);
    expect(result.state.world.history.length).toBeLessThanOrEqual(WORLD_CONFIG.simulation.maxHistoryEntries);
    const stateBytes = JSON.stringify(result.state).length;
    expect(stateBytes).toBeLessThan(64 * 1024 * 1024);
    console.log(
      'QA perf 56-NPC 30-day headless (6h steps) elapsedMs=' + elapsedMs.toFixed(0) +
      ' decisions=' + result.state.probability.decisionCount +
      ' events=' + result.state.world.events.length +
      ' history=' + result.state.world.history.length +
      ' stateBytes=' + stateBytes
    );
  });

  it('trims 2000 world-history entries down to the configured cap', { timeout: 60000 }, () => {
    const state = createQaState(7001);
    const startLength = state.world.history.length;
    for (let index = 0; index < 2000; index += 1) {
      addWorldHistory(state.world, {
        at: state.clock.simTimeSeconds + index,
        category: 'world',
        description: 'qa history entry ' + index,
        importance: 2,
      });
    }
    expect(state.world.history.length).toBe(WORLD_CONFIG.simulation.maxHistoryEntries);
    const ids = new Set(state.world.history.map((entry) => entry.id));
    expect(ids.size).toBe(state.world.history.length);
    const newest = state.world.history[state.world.history.length - 1];
    expect(newest?.description).toBe('qa history entry 1999');
    expect(state.world.history.some((entry) => entry.description === 'qa history entry 0')).toBe(false);
    expect(startLength).toBeGreaterThan(0);

    // Loading an oversized legacy log: trimWorldHistory must repair it.
    while (state.world.history.length < 1200) {
      const index = state.world.history.length;
      state.world.history.push({
        id: 'legacy_' + index,
        at: state.clock.simTimeSeconds,
        category: 'world',
        description: 'legacy entry ' + index,
        importance: 1,
        participantIds: [],
      });
    }
    trimWorldHistory(state.world);
    expect(state.world.history.length).toBe(WORLD_CONFIG.simulation.maxHistoryEntries);
    console.log('QA perf history trim 2000 -> ' + state.world.history.length);
  });

  it('round-trips a saved game quickly with a bounded payload', { timeout: 120000 }, async () => {
    // Drive the world through the real SimulationRuntime directly instead of GameEngine: this
    // avoids racing the engine's fire-and-forget autosave timers, so the measured save/load
    // payload is a stable snapshot rather than a state mutated concurrently mid-measurement.
    const state = createQaState(424242, 'QA Perf');
    const runtime = new SimulationRuntime({ state, content });
    runtime.advance(600); // 600 simulated seconds = 10 game hours of live world
    runtime.flushPersistence();
    expect(state.clock.simTimeSeconds).toBeGreaterThan(480 + 500);

    const holder: { current: GameState } = { current: state };
    const manager = new SaveManager(
      {
        getState: () => holder.current,
        applyState: (next) => {
          holder.current = next;
        },
      },
      new MemorySaveStorage()
    );
    await manager.init();
    const saveStarted = performance.now();
    const saved = await manager.save('qa_perf_slot');
    const saveMs = performance.now() - saveStarted;
    expect(saved.ok, saved.message).toBe(true);
    const exported = await manager.exportSave('qa_perf_slot');
    expect(exported).not.toBeNull();
    const payloadBytes = exported ? exported.length : 0;
    expect(payloadBytes).toBeGreaterThan(1000);
    expect(payloadBytes, 'save payload bytes').toBeLessThan(32 * 1024 * 1024);

    const loadStarted = performance.now();
    const loaded = await manager.load('qa_perf_slot');
    const loadMs = performance.now() - loadStarted;
    expect(loaded).not.toBeNull();
    expect(saveMs, 'save elapsed ms').toBeLessThan(3000);
    expect(loadMs, 'load elapsed ms').toBeLessThan(3000);
    if (loaded) {
      assertStateValid(loaded, 'loaded state');
      expect(loaded.player.name).toBe('QA Perf');
      expect(holder.current).toBe(loaded);
      // SaveManager trims the persisted probability decision history to the most recent 400
      // records (the live engine keeps its full ring), so compare against a same-trimmed copy.
      const expected = structuredClone(state);
      if (expected.probability.history.length > 400) {
        expected.probability.history = expected.probability.history.slice(-400);
      }
      expect(gameplayFingerprint(loaded)).toBe(gameplayFingerprint(expected));
    }
    manager.close();
    console.log(
      'QA perf saveMs=' + saveMs.toFixed(1) + ' loadMs=' + loadMs.toFixed(1) +
      ' payloadBytes=' + payloadBytes + ' (' + (payloadBytes / 1024 / 1024).toFixed(2) + ' MB)'
    );
  });
});