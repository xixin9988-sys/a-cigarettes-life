import { describe, expect, it } from 'vitest';
import type { ProbabilityRequest } from '../../src/core/contracts';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import { makeContext } from './helpers';

const request: ProbabilityRequest<string> = {
  streamId: 'npc.behavior',
  decisionType: 'npc_action',
  context: makeContext({ simulationTime: 42 }),
  candidates: [
    { id: 'work', baseWeight: 60, result: 'work' },
    { id: 'eat', baseWeight: 40, result: 'eat' },
  ],
};

describe('sampling: performance', () => {
  it('executes 100k draws well under one second', () => {
    const engine = new ProbabilityEngine();
    engine.init(123456);
    const startedAt = performance.now();
    let sink = 0;
    for (let i = 0; i < 100_000; i += 1) sink += engine.roll('player.opportunities');
    const elapsed = performance.now() - startedAt;
    expect(sink).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000);
  });

  it('executes 100k intRange / chance calls quickly and deterministically', () => {
    const engine = new ProbabilityEngine();
    engine.init(654321);
    const startedAt = performance.now();
    let sink = 0;
    for (let i = 0; i < 100_000; i += 1) {
      sink += engine.intRange('economy.market', 0, 9);
      if (engine.chance('fishing.results', 0.05)) sink += 1;
    }
    expect(performance.now() - startedAt).toBeLessThan(1000);
    expect(Number.isFinite(sink)).toBe(true);
  });
});

describe('sampling: simulate()', () => {
  it('returns per-option counts matching the weights without disturbing live state', () => {
    const engine = new ProbabilityEngine();
    engine.init(777);
    // Warm up a live stream with real draws and one real decision.
    for (let i = 0; i < 10; i += 1) engine.roll('npc.behavior');
    engine.decide(request);
    const before = engine.exportState();
    const beforeStats = engine.getStats('npc.behavior');
    const beforeDecisionCount = engine.getHistory().length;

    const samples = 10_000;
    const counts = engine.simulate(request, samples);
    expect(Object.keys(counts).sort()).toEqual(['eat', 'work']);
    expect((counts['work'] ?? 0) + (counts['eat'] ?? 0)).toBe(samples);
    expect(Math.abs((counts['work'] ?? 0) - samples * 0.6)).toBeLessThan(samples * 0.05);

    const after = engine.exportState();
    expect(after).toEqual(before);
    expect(engine.getStats('npc.behavior')).toEqual(beforeStats);
    expect(engine.getHistory()).toHaveLength(beforeDecisionCount);
  });

  it('is deterministic for the same request and samples', () => {
    const engine = new ProbabilityEngine();
    engine.init(888);
    const first = engine.simulate(request, 5000);
    const second = engine.simulate(request, 5000);
    expect(first).toEqual(second);

    const other = new ProbabilityEngine();
    other.init(888);
    expect(other.simulate(request, 5000)).toEqual(first);
  });

  it('does not create a live stream when simulating an unknown stream', () => {
    const engine = new ProbabilityEngine();
    engine.init(1);
    expect(engine.hasStream('simulated.stream')).toBe(false);
    engine.simulate({ ...request, streamId: 'simulated.stream' }, 100);
    expect(engine.hasStream('simulated.stream')).toBe(false);
    expect(engine.listStreams()).toEqual([]);
  });

  it('evaluates conditions and uses the fallback flags while simulating', () => {
    const engine = new ProbabilityEngine();
    engine.init(2);
    const filtered = engine.simulate(
      {
        streamId: 'npc.social',
        decisionType: 'filtered',
        context: makeContext(),
        candidates: [
          { id: 'impossible', baseWeight: 50, conditions: [{ op: 'never' }], result: 'impossible' },
          { id: 'possible', baseWeight: 1, result: 'possible' },
        ],
      },
      1000
    );
    expect(filtered['impossible']).toBe(0);
    expect(filtered['possible']).toBe(1000);

    const noneEligible = engine.simulate(
      {
        streamId: 'npc.social',
        decisionType: 'none_eligible',
        context: makeContext(),
        candidates: [
          { id: 'first', baseWeight: 1, conditions: [{ op: 'never' }], result: 'first' },
          { id: 'second', baseWeight: 1, conditions: [{ op: 'never' }], result: 'second' },
        ],
      },
      1000
    );
    expect(noneEligible['first']).toBe(1000);
    expect(noneEligible['second']).toBe(0);

    const zeroWeights = engine.simulate(
      {
        streamId: 'npc.social',
        decisionType: 'zero_weights',
        minWeight: 0,
        context: makeContext(),
        candidates: [
          { id: 'a', baseWeight: 0, result: 'a' },
          { id: 'b', baseWeight: 0, result: 'b' },
        ],
      },
      2000
    );
    expect((zeroWeights['a'] ?? 0) + (zeroWeights['b'] ?? 0)).toBe(2000);
    expect((zeroWeights['a'] ?? 0) > 0).toBe(true);
    expect((zeroWeights['b'] ?? 0) > 0).toBe(true);
  });

  it('handles zero samples and empty candidate lists', () => {
    const engine = new ProbabilityEngine();
    engine.init(3);
    expect(engine.simulate(request, 0)).toEqual({ work: 0, eat: 0 });
    expect(engine.simulate({ ...request, candidates: [] }, 100)).toEqual({});
    expect(engine.simulate(request, -10)).toEqual({ work: 0, eat: 0 });
  });
});

describe('sampling: draw bookkeeping', () => {
  it('consumes no randomness when weighted() has nothing to pick', () => {
    const engine = new ProbabilityEngine();
    engine.init(4);
    engine.ensureStream('ui.cosmetic');
    const state = engine.exportState().streams['ui.cosmetic'];
    expect(engine.weighted('ui.cosmetic', [])).toBeNull();
    expect(engine.weighted('ui.cosmetic', [{ weight: 0, value: 'x' }])).toBeNull();
    expect(engine.exportState().streams['ui.cosmetic']).toEqual(state);
  });

  it('counts draws for every primitive operation', () => {
    const engine = new ProbabilityEngine();
    engine.init(5);
    engine.roll('a.stream');
    engine.floatRange('a.stream', 0, 1);
    engine.intRange('a.stream', 0, 1);
    engine.chance('a.stream', 0.5);
    engine.chance('a.stream', 0);
    engine.chance('a.stream', 1);
    engine.weighted('a.stream', [
      { weight: 1, value: 'x' },
      { weight: 1, value: 'y' },
    ]);
    expect(engine.getStats('a.stream').draws).toBe(5);
    expect(engine.getStats('a.stream').lastValue).toBeGreaterThanOrEqual(0);
    expect(engine.getStats('a.stream').lastValue).toBeLessThan(1);
  });
});
