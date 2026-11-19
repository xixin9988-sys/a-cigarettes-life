import { describe, expect, it } from 'vitest';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import { chiSquarePValue, chiSquareTest } from '../../src/probability/ProbabilityDebugger';
import { makeContext } from './helpers';

const SEED = 20240101;

function newEngine(): ProbabilityEngine {
  const engine = new ProbabilityEngine();
  engine.init(SEED);
  return engine;
}

describe('distribution: chance()', () => {
  it('matches a 60/40 split over 20k samples', () => {
    const engine = newEngine();
    let successes = 0;
    const samples = 20000;
    for (let i = 0; i < samples; i += 1) {
      if (engine.chance('player.opportunities', 0.6)) successes += 1;
    }
    expect(Math.abs(successes - samples * 0.6)).toBeLessThan(samples * 0.03);
    const result = chiSquareTest(
      { success: successes, failure: samples - successes },
      { success: 0.6, failure: 0.4 }
    );
    expect(result.acceptable).toBe(true);
  });

  it('is deterministic for a fixed seed', () => {
    const a = newEngine();
    const b = newEngine();
    for (let i = 0; i < 500; i += 1) {
      expect(a.chance('fishing.results', 0.37)).toBe(b.chance('fishing.results', 0.37));
    }
  });

  it('treats certainties without consuming randomness and clamps out-of-range values', () => {
    const engine = newEngine();
    const before = engine.exportState().streams['world.weather'];
    expect(engine.chance('world.weather', 0)).toBe(false);
    expect(engine.chance('world.weather', -3)).toBe(false);
    expect(engine.chance('world.weather', 1)).toBe(true);
    expect(engine.chance('world.weather', 12)).toBe(true);
    expect(engine.chance('world.weather', Number.NaN)).toBe(false);
    expect(engine.exportState().streams['world.weather']).toEqual(before);
  });
});

describe('distribution: weighted()', () => {
  it('matches a 60/40 ad-hoc weighting over 20k samples', () => {
    const engine = newEngine();
    const candidates = [
      { weight: 60, value: 'yes' as const },
      { weight: 40, value: 'no' as const },
    ];
    let yes = 0;
    const samples = 20000;
    for (let i = 0; i < samples; i += 1) {
      const picked = engine.weighted('player.opportunities', candidates);
      if (picked === 'yes') yes += 1;
    }
    expect(Math.abs(yes - samples * 0.6)).toBeLessThan(samples * 0.03);
    expect(chiSquareTest({ yes, no: samples - yes }, { yes: 0.6, no: 0.4 }).acceptable).toBe(true);
  });

  it('matches a five-way weight table over 20k samples', () => {
    const engine = newEngine();
    const weights = [5, 3, 2, 1.5, 0.5];
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const candidates = weights.map((weight, index) => ({ weight, value: `option_${index}` }));
    const counts = new Map<string, number>();
    const samples = 20000;
    for (let i = 0; i < samples; i += 1) {
      const picked = engine.weighted('economy.market', candidates);
      if (picked !== null) counts.set(picked, (counts.get(picked) ?? 0) + 1);
    }
    const observed: Record<string, number> = {};
    const expected: Record<string, number> = {};
    for (let index = 0; index < weights.length; index += 1) {
      const key = `option_${index}`;
      observed[key] = counts.get(key) ?? 0;
      expected[key] = (weights[index] ?? 0) / total;
      const expectedCount = samples * ((weights[index] ?? 0) / total);
      expect(Math.abs((counts.get(key) ?? 0) - expectedCount)).toBeLessThan(
        Math.max(60, expectedCount * 0.08)
      );
    }
    expect(chiSquareTest(observed, expected).acceptable).toBe(true);
  });

  it('returns null when nothing is selectable and ignores invalid weights', () => {
    const engine = newEngine();
    expect(engine.weighted('ui.cosmetic', [])).toBeNull();
    expect(engine.weighted('ui.cosmetic', [{ weight: 0, value: 'a' }])).toBeNull();
    expect(
      engine.weighted('ui.cosmetic', [
        { weight: -2, value: 'a' },
        { weight: Number.NaN, value: 'b' },
      ])
    ).toBeNull();
    expect(
      engine.weighted('ui.cosmetic', [
        { weight: -2, value: 'a' },
        { weight: 3, value: 'b' },
      ])
    ).toBe('b');
  });
});

describe('distribution: decide()', () => {
  it('normalises probabilities and selects according to weights', () => {
    const engine = newEngine();
    const counts = new Map<string, number>();
    const samples = 4000;
    for (let i = 0; i < samples; i += 1) {
      const decision = engine.decide({
        streamId: 'social.interaction',
        decisionType: 'greeting',
        context: makeContext({ simulationTime: i }),
        candidates: [
          { id: 'warm', baseWeight: 60, result: 'warm' },
          { id: 'cold', baseWeight: 40, result: 'cold' },
        ],
      });
      expect(decision.candidates[0]?.probability).toBeCloseTo(0.6, 9);
      expect(decision.candidates[1]?.probability).toBeCloseTo(0.4, 9);
      expect(
        (decision.candidates[0]?.probability ?? 0) + (decision.candidates[1]?.probability ?? 0)
      ).toBeCloseTo(1, 9);
      const selected = decision.selectedOptionId ?? 'none';
      counts.set(selected, (counts.get(selected) ?? 0) + 1);
    }
    const warm = counts.get('warm') ?? 0;
    expect(Math.abs(warm - samples * 0.6)).toBeLessThan(samples * 0.05);
  });

  it('filters candidates whose conditions fail', () => {
    const engine = newEngine();
    for (let i = 0; i < 300; i += 1) {
      const decision = engine.decide({
        streamId: 'npc.social',
        decisionType: 'social_move',
        context: makeContext({ actorState: { energy: 0.1, mood: -1 } }),
        candidates: [
          {
            id: 'dance',
            baseWeight: 10,
            conditions: [{ op: 'cmp', path: 'actorState.energy', cmp: 'gte', value: 0.5 }],
            result: 'dance',
          },
          { id: 'sit', baseWeight: 1, result: 'sit' },
        ],
      });
      expect(decision.selectedOptionId).toBe('sit');
      expect(decision.candidates[0]?.eligible).toBe(false);
      expect(decision.candidates[0]?.probability).toBe(0);
      expect(decision.candidates[0]?.rejectionReason).toContain('conditions failed');
      expect(decision.candidates[0]?.finalWeight).toBe(0);
    }
  });
});

describe('distribution: primitive ranges', () => {
  it('intRange is inclusive, bounded and roughly uniform', () => {
    const engine = newEngine();
    const counts = new Array<number>(6).fill(0);
    const samples = 12000;
    for (let i = 0; i < samples; i += 1) {
      const value = engine.intRange('economy.jobs', 1, 6);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
      counts[value - 1] = (counts[value - 1] ?? 0) + 1;
    }
    for (const count of counts) {
      expect(Math.abs(count - samples / 6)).toBeLessThan((samples / 6) * 0.15);
    }
  });

  it('intRange handles single values, swapped bounds and invalid input', () => {
    const engine = newEngine();
    expect(engine.intRange('ui.cosmetic', 5, 5)).toBe(5);
    for (let i = 0; i < 50; i += 1) {
      const value = engine.intRange('ui.cosmetic', 10, 2);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThanOrEqual(10);
    }
    expect(engine.intRange('ui.cosmetic', Number.NaN, Number.NaN)).toBe(0);
  });

  it('floatRange stays inside the bounds and is roughly uniform', () => {
    const engine = newEngine();
    let sum = 0;
    const samples = 10000;
    for (let i = 0; i < samples; i += 1) {
      const value = engine.floatRange('world.environment', 10, 20);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThan(20);
      sum += value;
    }
    expect(sum / samples).toBeGreaterThan(14.8);
    expect(sum / samples).toBeLessThan(15.2);
  });
});

describe('distribution: registered static alias table', () => {
  it('samples a >32 entry alias table according to its weights', () => {
    const engine = newEngine();
    const entries = Array.from({ length: 40 }, (_, index) => ({
      key: `entry_${index}`,
      weight: 1 + (index % 5),
    }));
    engine.distributions.register('test.large_table', entries);
    expect(engine.distributions.mode('test.large_table')).toBe('alias');
    const probabilities = engine.distributions.probabilities('test.large_table');
    expect(probabilities).not.toBeNull();
    let probabilitySum = 0;
    for (const value of Object.values(probabilities ?? {})) probabilitySum += value;
    expect(probabilitySum).toBeCloseTo(1, 9);

    const counts: Record<string, number> = {};
    const samples = 20000;
    for (let i = 0; i < samples; i += 1) {
      const key = engine.sampleDistribution('ui.cosmetic', 'test.large_table');
      expect(key).not.toBeNull();
      if (key) counts[key] = (counts[key] ?? 0) + 1;
    }
    const expected: Record<string, number> = {};
    for (const entry of entries) expected[entry.key] = probabilities?.[entry.key] ?? 0;
    expect(chiSquareTest(counts, expected).acceptable).toBe(true);
  });

  it('chi-square p-value handles known critical values', () => {
    // 95th percentile of chi-square with 1 degree of freedom.
    expect(chiSquarePValue(3.841459, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquarePValue(0, 4)).toBe(1);
    expect(chiSquarePValue(Number.POSITIVE_INFINITY, 2)).toBe(0);
    expect(chiSquarePValue(1, 0)).toBeNaN();
  });
});
