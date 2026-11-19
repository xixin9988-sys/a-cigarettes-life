import { describe, expect, it } from 'vitest';
import type { ProbabilityRequest } from '../../src/core/contracts';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import {
  ProbabilityDebugger,
  chiSquarePValue,
  chiSquareTest,
  logGamma,
} from '../../src/probability/ProbabilityDebugger';
import { makeContext } from './helpers';

function request(overrides: Partial<ProbabilityRequest<string>> = {}): ProbabilityRequest<string> {
  return {
    streamId: 'npc.behavior',
    decisionType: 'behaviour',
    context: makeContext({ simulationTime: 10 }),
    candidates: [
      { id: 'work', baseWeight: 60, result: 'work' },
      { id: 'eat', baseWeight: 40, result: 'eat' },
    ],
    ...overrides,
  };
}

function seededEngine(): ProbabilityEngine {
  const engine = new ProbabilityEngine();
  engine.init(271828);
  return engine;
}

describe('ProbabilityDebugger: maths', () => {
  it('computes logGamma accurately', () => {
    expect(logGamma(1)).toBeCloseTo(0, 10);
    expect(logGamma(2)).toBeCloseTo(0, 10);
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10);
    expect(logGamma(10)).toBeCloseTo(Math.log(362880), 10);
  });

  it('returns known chi-square critical values', () => {
    expect(chiSquarePValue(3.841459, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquarePValue(5.991465, 2)).toBeCloseTo(0.05, 3);
    expect(chiSquarePValue(0, 3)).toBe(1);
    expect(chiSquarePValue(Number.POSITIVE_INFINITY, 3)).toBe(0);
    expect(Number.isNaN(chiSquarePValue(1, 0))).toBe(true);
  });

  it('flags fair vs biased samples', () => {
    const fair = chiSquareTest({ heads: 5010, tails: 4990 }, { heads: 0.5, tails: 0.5 });
    expect(fair.acceptable).toBe(true);
    expect(fair.pValue).toBeGreaterThan(0.5);
    const biased = chiSquareTest({ heads: 9000, tails: 1000 }, { heads: 0.5, tails: 0.5 });
    expect(biased.acceptable).toBe(false);
    expect(biased.pValue).toBeLessThan(1e-6);
  });

  it('handles degenerate expectations', () => {
    expect(chiSquareTest({}, {}).note).toBe('no observations');
    expect(chiSquareTest({ a: 10 }, {}).acceptable).toBe(false);
    const impossible = chiSquareTest({ a: 5, b: 5 }, { a: 1, b: 0 });
    expect(impossible.statistic).toBe(Number.POSITIVE_INFINITY);
    expect(impossible.acceptable).toBe(false);
    expect(impossible.observedTotal).toBe(10);
  });
});

describe('ProbabilityDebugger: engine inspection', () => {
  it('summarises streams, draws, decisions and the seed', () => {
    const engine = seededEngine();
    for (let i = 0; i < 5; i += 1) engine.roll('world.weather');
    engine.roll('npc.behavior');
    engine.decide(request());
    const debuggerInstance = engine.createDebugger();
    const summary = debuggerInstance.summarize();
    expect(summary.seed).toBe(271828);
    expect(summary.seedHex).toHaveLength(16);
    expect(summary.seedHex).toBe(debuggerInstance.seedFingerprint());
    expect(summary.streamCount).toBe(2);
    expect(summary.totalDraws).toBe(7);
    expect(summary.totalDecisions).toBe(1);
    expect(summary.historySize).toBe(1);
    const weather = summary.streams.find((stream) => stream.streamId === 'world.weather');
    expect(weather?.draws).toBe(5);
    expect(weather?.known).toBe(true);
    const behavior = summary.streams.find((stream) => stream.streamId === 'npc.behavior');
    expect(behavior?.decisions).toBe(1);
  });

  it('builds a selection heatmap from decision history', () => {
    const engine = seededEngine();
    for (let i = 0; i < 300; i += 1) engine.decide(request());
    const heatmap = engine.createDebugger().heatmap('behaviour');
    expect(heatmap).toHaveLength(1);
    const row = heatmap[0];
    expect(row?.decisions).toBe(300);
    const work = row?.cells.find((cell) => cell.candidateId === 'work');
    const eat = row?.cells.find((cell) => cell.candidateId === 'eat');
    expect(work?.expectedProbability).toBeCloseTo(0.6, 6);
    expect(eat?.expectedProbability).toBeCloseTo(0.4, 6);
    expect(work?.observedRate).toBeGreaterThan(0.5);
    expect(work?.observedRate).toBeLessThan(0.7);
    expect((work?.selectedCount ?? 0) + (eat?.selectedCount ?? 0)).toBe(300);
    expect(engine.createDebugger().heatmap('missing_type')).toEqual([]);
  });

  it('tests the recorded distribution of a decision type', () => {
    const engine = seededEngine();
    for (let i = 0; i < 2000; i += 1) engine.decide(request());
    const result = engine.createDebugger().distributionTest('behaviour');
    expect(result.observedTotal).toBe(2000);
    expect(result.degreesOfFreedom).toBe(1);
    expect(result.acceptable).toBe(true);
  });

  it('draws histograms and uniformity tests from scratch streams', () => {
    const engine = seededEngine();
    const liveBefore = engine.exportState();
    const debuggerInstance = engine.createDebugger();
    const histogram = debuggerInstance.drawHistogram(271828, 'world.weather', 10_000, 10);
    expect(histogram).toHaveLength(10);
    const total = histogram.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(total).toBe(10_000);
    for (const bucket of histogram) {
      expect(bucket.count).toBeGreaterThan(1000 * 0.6);
      expect(bucket.probability).toBeGreaterThan(0);
    }
    expect(debuggerInstance.uniformityTest(271828, 'world.weather', 10_000).acceptable).toBe(true);
    // The live engine is untouched by scratch sampling.
    expect(engine.exportState()).toEqual(liveBefore);
  });

  it('compares seeds and finds the first divergence', () => {
    const engine = seededEngine();
    const debuggerInstance = engine.createDebugger();
    const identical = debuggerInstance.compareSeeds(100, 100, ['world.weather', 'npc.behavior'], 500);
    expect(identical.divergentStreams).toHaveLength(0);
    expect(identical.identicalStreams).toEqual(['world.weather', 'npc.behavior']);

    const different = debuggerInstance.compareSeeds(100, 101, ['world.weather', 'npc.behavior'], 500);
    expect(different.divergentStreams).toHaveLength(2);
    for (const divergence of different.divergentStreams) {
      expect(divergence.firstDivergenceIndex).not.toBeNull();
      expect(divergence.valueA).not.toBe(divergence.valueB);
      expect(divergence.samples).toBe(500);
    }
    // Defaults to the engine's streams, then to the known stream catalogue.
    expect(debuggerInstance.compareSeeds(1, 2, undefined, 10).divergentStreams.length).toBeGreaterThan(0);
    const emptyEngine = new ProbabilityEngine();
    emptyEngine.init(1);
    expect(
      emptyEngine.createDebugger().compareSeeds(1, 2, undefined, 5).divergentStreams.length
    ).toBeGreaterThan(0);
  });
});

describe('ProbabilityDebugger: validation', () => {
  it('validates healthy records and reports tampered ones', () => {
    const engine = seededEngine();
    const decision = engine.decide(request());
    const debuggerInstance = engine.createDebugger();
    const valid = debuggerInstance.validateRecord(engine.replayDecision(decision.decisionId) ?? decision);
    expect(valid.valid).toBe(true);
    expect(valid.issues).toEqual([]);
    expect(debuggerInstance.validateHistory()).toEqual([]);
    expect(debuggerInstance.anomalies()).toEqual([]);

    const tampered = JSON.parse(JSON.stringify(decision)) as typeof decision;
    tampered.selectedOptionId = 'does_not_exist';
    const invalid = debuggerInstance.validateRecord(tampered);
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.join(' ')).toContain('not among the candidates');

    const badWeights = JSON.parse(JSON.stringify(decision)) as typeof decision;
    if (badWeights.candidates[0]) badWeights.candidates[0].finalWeight = Number.NaN;
    expect(debuggerInstance.validateRecord(badWeights).valid).toBe(false);
  });

  it('accepts empty-candidate decisions as valid records', () => {
    const engine = seededEngine();
    engine.decide({
      streamId: 'events.occurrence',
      decisionType: 'empty',
      context: makeContext(),
      candidates: [],
    });
    const debuggerInstance = engine.createDebugger();
    expect(debuggerInstance.validateHistory()).toEqual([]);
    const record = engine.getHistory(1)[0];
    expect(record).toBeDefined();
    if (record) {
      expect(debuggerInstance.validateRecord(record)).toEqual({
        decisionId: 'dec_000001',
        valid: true,
        issues: [],
      });
    }
  });

  it('flags fallback decisions as anomalies', () => {
    const engine = seededEngine();
    engine.decide({
      streamId: 'events.occurrence',
      decisionType: 'forced',
      context: makeContext(),
      candidates: [{ id: 'only', baseWeight: 1, conditions: [{ op: 'never' }], result: 'only' }],
    });
    const anomalies = engine.createDebugger().anomalies();
    expect(anomalies.some((message) => message.includes('deterministic fallback'))).toBe(true);
    const history = engine.createDebugger().validateHistory(undefined, true);
    expect(history).toHaveLength(1);
    // The fallback is flagged but the record itself is still structurally valid.
    expect(history[0]?.valid).toBe(true);
  });

  it('inspects decisions for replay', () => {
    const engine = seededEngine();
    const decision = engine.decide(request());
    const inspection = engine.createDebugger().inspectDecision(decision.decisionId);
    expect(inspection.found).toBe(true);
    expect(inspection.record?.decisionId).toBe(decision.decisionId);
    expect(inspection.validation?.valid).toBe(true);
    expect(engine.createDebugger().inspectDecision('dec_missing').found).toBe(false);
  });

  it('accepts an explicit p-value threshold', () => {
    const engine = seededEngine();
    for (let i = 0; i < 100; i += 1) engine.decide(request());
    const strict = new ProbabilityDebugger(engine, { acceptablePValue: 0.999 });
    const result = strict.distributionTest('behaviour');
    expect(result.pValue).toBeLessThan(0.999);
    expect(result.acceptable).toBe(false);
  });
});
