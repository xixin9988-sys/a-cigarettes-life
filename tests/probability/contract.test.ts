import { describe, expect, it } from 'vitest';
import type {
  IProbabilityEngine,
  ProbabilityDecisionRecord,
  ProbabilityPersistState,
  ProbabilityRequest,
  ProbabilityStreamStats,
} from '../../src/core/contracts';
import { RngFacade } from '../../src/core/GameContext';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import { createProbabilityEngine } from '../../src/probability';
import { makeContext } from './helpers';

const request: ProbabilityRequest<string> = {
  streamId: 'world.weather',
  decisionType: 'weather_transition',
  context: makeContext({ simulationTime: 60, season: 'winter' }),
  candidates: [
    { id: 'clear', baseWeight: 6, result: 'clear' },
    { id: 'snow', baseWeight: 4, result: 'snow' },
  ],
};

describe('contract compliance: IProbabilityEngine', () => {
  it('implements and exercises every interface member', () => {
    const engine: IProbabilityEngine = new ProbabilityEngine();
    engine.init(1234);
    expect(engine.seed).toBe(1234);

    engine.ensureStream('manual.stream');
    expect(engine.hasStream('manual.stream')).toBe(true);
    expect(engine.listStreams()).toContain('manual.stream');

    expect(engine.roll('world.weather')).toBeGreaterThanOrEqual(0);
    expect(engine.floatRange('world.weather', 1, 2)).toBeGreaterThanOrEqual(1);
    expect(engine.intRange('world.weather', 1, 6)).toBeGreaterThanOrEqual(1);
    expect(engine.chance('world.weather', 0.5)).toBeTypeOf('boolean');
    expect(engine.weighted('world.weather', [{ weight: 1, value: 'a' }])).toBe('a');

    const decision = engine.decide(request);
    expect(decision.decisionId).toBeTypeOf('string');
    expect(decision.selectedResult === 'clear' || decision.selectedResult === 'snow').toBe(true);

    const history: ProbabilityDecisionRecord[] = engine.getHistory(10);
    expect(history.length).toBe(1);
    expect(engine.getHistoryForDecision(decision.decisionId)?.decisionId).toBe(decision.decisionId);
    expect(engine.replayDecision(decision.decisionId)?.decisionId).toBe(decision.decisionId);

    const stats: ProbabilityStreamStats = engine.getStats('world.weather');
    expect(stats.streamId).toBe('world.weather');
    expect(stats.decisions).toBe(1);

    expect(
      engine.evaluateConditions([{ op: 'cmp', path: 'season', cmp: 'eq', value: 'winter' }], request.context)
    ).toBe(true);

    const persisted: ProbabilityPersistState = engine.exportState();
    expect(persisted.version).toBeTypeOf('number');
    expect(persisted.seed).toBe(1234);
    expect(typeof persisted.streams).toBe('object');
    expect(Array.isArray(persisted.history)).toBe(true);
    expect(persisted.traceCounter).toBeTypeOf('number');

    const restored: IProbabilityEngine = new ProbabilityEngine();
    restored.init(1234, persisted);
    expect(restored.seed).toBe(1234);
    expect(restored.hasStream('world.weather')).toBe(true);
    expect(restored.roll('world.weather')).toBe(engine.roll('world.weather'));

    const counts = restored.simulate(request, 500);
    expect((counts['clear'] ?? 0) + (counts['snow'] ?? 0)).toBe(500);

    const imported = new ProbabilityEngine();
    imported.init(1);
    imported.importState(persisted);
    expect(imported.seed).toBe(1234);
    expect(imported.getHistory().length).toBe(1);
  });

  it('can be constructed with no arguments and through the factory', () => {
    const plain = new ProbabilityEngine();
    plain.init(0);
    expect(plain.seed).toBe(0);
    const created = createProbabilityEngine(42);
    expect(created.seed).toBe(42);
    expect(created.listStreams()).toEqual([]);
  });
});

describe('contract compliance: IRngFacade integration', () => {
  it('drives shuffle / weighted / ranges deterministically', () => {
    const engine = new ProbabilityEngine();
    engine.init(2020);
    const rng = new RngFacade(engine);
    const values = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle('ui.cosmetic', values);
    expect(shuffled).toHaveLength(values.length);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(values);
    expect(rng.intRange('ui.cosmetic', 1, 10)).toBeGreaterThanOrEqual(1);
    expect(rng.chance('ui.cosmetic', 0.5)).toBeTypeOf('boolean');
    expect(rng.weighted('ui.cosmetic', [{ weight: 1, value: 'only' }])).toBe('only');

    const otherEngine = new ProbabilityEngine();
    otherEngine.init(2020);
    const otherRng = new RngFacade(otherEngine);
    expect(otherRng.shuffle('ui.cosmetic', values)).toEqual(shuffled);
  });
});
