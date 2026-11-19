import { describe, expect, it } from 'vitest';
import type { ProbabilityModifier, ProbabilityOption } from '../../src/core/contracts';
import { MemoryLogger } from '../../src/core/GameLogger';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import { ALIAS_TABLE_THRESHOLD } from '../../src/probability/types';
import {
  buildSampler,
  calculateCandidates,
  computeFinalWeight,
  defaultWeightBounds,
  resolveWeightBounds,
  uniformIndexFromUniform,
} from '../../src/probability/ProbabilityCalculator';
import {
  applyModifiersToWeight,
  resolveModifiers,
  resolveModifiersDetailed,
  sumAdditiveModifiers,
  productMultiplicativeModifiers,
} from '../../src/probability/ModifierResolver';
import { makeContext } from './helpers';

const context = makeContext({
  simulationTime: 100,
  actorState: { skill: 4, mood: 1.5, moodBoost: 2, penalty: -3 },
  environment: { multiplier: 2 },
});

function single(option: Partial<ProbabilityOption<string>> & { id: string }): ProbabilityOption<string> {
  return { baseWeight: 1, result: option.id, ...option };
}

describe('ModifierResolver', () => {
  it('applies additive and multiplicative modifiers in the documented order', () => {
    const applied = resolveModifiers(
      [
        { id: 'bonus', source: 'skill', kind: 'add', value: 5 },
        { id: 'double', source: 'mood', kind: 'multiply', value: 2 },
        { id: 'half', source: 'weather', kind: 'multiply', value: 0.5 },
      ],
      context
    );
    expect(sumAdditiveModifiers(applied)).toBe(5);
    expect(productMultiplicativeModifiers(applied)).toBe(1);
    expect(applyModifiersToWeight(10, applied)).toBe(15);
    expect(applied[0]?.detail).toContain('+5');
    expect(applied[1]?.detail).toContain('x2');
  });

  it('resolves path + perUnit modifiers against the context', () => {
    const applied = resolveModifiers(
      [
        { id: 'skill', source: 'skill', kind: 'add', value: 0.5, path: 'actorState.skill', perUnit: true },
        { id: 'env', source: 'environment', kind: 'multiply', value: 999, path: 'environment.multiplier' },
      ],
      context
    );
    expect(applied[0]?.amount).toBe(2); // 0.5 * 4
    expect(applied[1]?.amount).toBe(2); // resolved path value, not the fallback 999
    expect(applied[0]?.detail).toContain('actorState.skill=4');
    expect(applyModifiersToWeight(10, applied)).toBe(24); // (10 + 2) * 2
  });

  it('falls back to the declared value when a path is missing or non-numeric', () => {
    const resolution = resolveModifiersDetailed(
      [
        { id: 'missing', source: 'x', kind: 'add', value: 3, path: 'actorState.missing' },
        { id: 'wrongType', source: 'x', kind: 'multiply', value: 1.5, path: 'actorId' },
      ],
      context
    );
    expect(resolution.applied[0]?.amount).toBe(3);
    expect(resolution.applied[1]?.amount).toBe(1.5);
    expect(resolution.applied[0]?.detail).toContain('<missing>');
    expect(resolution.warnings).toHaveLength(0);
  });

  it('skips modifiers whose condition fails', () => {
    const applied = resolveModifiers(
      [
        {
          id: 'rainOnly',
          source: 'weather',
          kind: 'multiply',
          value: 2,
          condition: { op: 'cmp', path: 'weather', cmp: 'eq', value: 'rain' },
        },
        { id: 'always', source: 'x', kind: 'add', value: 1 },
      ],
      context
    );
    expect(applied.map((modifier) => modifier.id)).toEqual(['always']);
  });

  it('neutralises invalid amounts instead of poisoning the weight', () => {
    const applied = resolveModifiers(
      [
        { id: 'nanAdd', source: 'x', kind: 'add', value: Number.NaN },
        { id: 'nanMul', source: 'x', kind: 'multiply', value: Number.POSITIVE_INFINITY },
        { id: 'badKind', source: 'x', kind: 'divide' as 'add', value: 2 },
        { id: 'ok', source: 'x', kind: 'add', value: 4 },
      ],
      context
    );
    expect(applied.map((modifier) => modifier.id)).toEqual(['nanAdd', 'nanMul', 'ok']);
    expect(applied[0]?.amount).toBe(0);
    expect(applied[1]?.amount).toBe(1);
    expect(applyModifiersToWeight(10, applied)).toBe(14);
    expect(Number.isFinite(applyModifiersToWeight(10, applied))).toBe(true);
  });

  it('treats non-object entries defensively', () => {
    const malformed = [null, undefined] as unknown as ProbabilityModifier[];
    const applied = resolveModifiers(malformed, context);
    expect(applied).toHaveLength(0);
  });
});

describe('weight bounds', () => {
  it('defaults to WORLD_CONFIG and sanitises invalid bounds', () => {
    expect(defaultWeightBounds()).toEqual({ minWeight: 0.0001, maxWeight: 1000 });
    expect(resolveWeightBounds()).toEqual({ minWeight: 0.0001, maxWeight: 1000 });
    expect(resolveWeightBounds(Number.NaN, Number.NaN)).toEqual({ minWeight: 0.0001, maxWeight: 1000 });
    expect(resolveWeightBounds(-5, 10)).toEqual({ minWeight: 0, maxWeight: 10 });
    expect(resolveWeightBounds(2, 1)).toEqual({ minWeight: 2, maxWeight: 2 });
  });

  it('clamps final weights and returns 0 for negative / NaN intermediates', () => {
    const bounds = defaultWeightBounds();
    expect(computeFinalWeight(5, [], bounds)).toBe(5);
    expect(computeFinalWeight(0.00001, [], bounds)).toBe(0.0001);
    expect(computeFinalWeight(5000, [], bounds)).toBe(1000);
    expect(computeFinalWeight(-5, [], bounds)).toBe(0);
    expect(computeFinalWeight(Number.NaN, [], bounds)).toBe(0);
    const addNegative = resolveModifiers([{ id: 'penalty', source: 'x', kind: 'add', value: -20 }], context);
    expect(computeFinalWeight(5, addNegative, bounds)).toBe(0);
    const multiplyZero = resolveModifiers([{ id: 'zero', source: 'x', kind: 'multiply', value: 0 }], context);
    expect(computeFinalWeight(5, multiplyZero, bounds)).toBe(0.0001); // 0 is non-negative -> min clamp applies
    // A non-finite modifier value is neutralised to the identity element (x1),
    // so the base weight is preserved rather than producing Infinity.
    const infinite = resolveModifiers(
      [{ id: 'inf', source: 'x', kind: 'multiply', value: Number.POSITIVE_INFINITY }],
      context
    );
    expect(infinite[0]?.amount).toBe(1);
    expect(computeFinalWeight(5, infinite, bounds)).toBe(5);
  });
});

describe('calculateCandidates', () => {
  it('filters by conditions and normalises probabilities', () => {
    const calculation = calculateCandidates(
      [
        single({ id: 'a', baseWeight: 2 }),
        single({ id: 'b', baseWeight: 6 }),
        single({ id: 'c', baseWeight: 2, conditions: [{ op: 'never' }] }),
      ],
      context
    );
    expect(calculation.evaluations.map((evaluation) => evaluation.eligible)).toEqual([true, true, false]);
    expect(calculation.totalWeight).toBe(8);
    expect(calculation.probabilities).toEqual([0.25, 0.75, 0]);
    expect(calculation.evaluations[2]?.rejectionReason).toContain('conditions failed');
  });

  it('keeps baseWeight metadata and applies modifiers per candidate', () => {
    const calculation = calculateCandidates(
      [
        single({
          id: 'boosted',
          baseWeight: 10,
          modifiers: [{ id: 'm', source: 'skill', kind: 'multiply', value: 2 }],
        }),
      ],
      context
    );
    const evaluation = calculation.evaluations[0];
    expect(evaluation?.baseWeight).toBe(10);
    expect(evaluation?.finalWeight).toBe(20);
    expect(evaluation?.modifiers).toHaveLength(1);
    expect(evaluation?.probability).toBe(1);
  });

  it('treats NaN / negative base weights as zero weight (warned, selectable only via fallback)', () => {
    const calculation = calculateCandidates(
      [single({ id: 'nan', baseWeight: Number.NaN }), single({ id: 'negative', baseWeight: -3 })],
      context
    );
    expect(calculation.totalWeight).toBe(0);
    expect(calculation.warnings.length).toBeGreaterThanOrEqual(2);
    expect(calculation.evaluations[0]?.finalWeight).toBe(0);
    expect(calculation.evaluations[1]?.finalWeight).toBe(0);
    expect(calculation.evaluations[0]?.eligible).toBe(true);
  });
});

describe('decide(): clamping and defensive fallbacks', () => {
  it('clamps request-level bounds', () => {
    const engine = new ProbabilityEngine();
    engine.init(1);
    const decision = engine.decide({
      streamId: 'events.occurrence',
      decisionType: 'bounded',
      context,
      minWeight: 2,
      maxWeight: 5,
      candidates: [
        { id: 'huge', baseWeight: 5000, result: 'huge' },
        { id: 'tiny', baseWeight: 0.00001, result: 'tiny' },
      ],
    });
    expect(decision.candidates[0]?.finalWeight).toBe(5);
    expect(decision.candidates[1]?.finalWeight).toBe(2);
    expect(decision.candidates[0]?.probability).toBeCloseTo(5 / 7, 9);
    expect(decision.candidates[1]?.probability).toBeCloseTo(2 / 7, 9);
  });

  it('never selects a candidate whose weight was zeroed by invalid input', () => {
    const engine = new ProbabilityEngine();
    engine.init(99);
    for (let i = 0; i < 200; i += 1) {
      const decision = engine.decide({
        streamId: 'events.occurrence',
        decisionType: 'invalid_weight',
        context,
        candidates: [
          { id: 'invalid', baseWeight: Number.NaN, result: 'invalid' },
          { id: 'valid', baseWeight: 1, result: 'valid' },
        ],
      });
      expect(decision.selectedOptionId).toBe('valid');
      expect(decision.candidates[0]?.probability).toBe(0);
    }
  });

  it('uses uniform-eligible fallback (flagged) when every eligible weight is zero', () => {
    const engine = new ProbabilityEngine();
    engine.init(7);
    const counts = new Map<string, number>();
    for (let i = 0; i < 600; i += 1) {
      const decision = engine.decide({
        streamId: 'events.occurrence',
        decisionType: 'zero_weights',
        context,
        minWeight: 0,
        candidates: [
          { id: 'a', baseWeight: 0, result: 'a' },
          { id: 'b', baseWeight: 0, result: 'b' },
        ],
      });
      expect(decision.fallback).toBe('uniform-eligible');
      expect(decision.totalWeight).toBe(0);
      expect(decision.candidates[0]?.probability).toBeCloseTo(0.5, 9);
      expect(decision.selectedOptionId).not.toBeNull();
      counts.set(
        decision.selectedOptionId ?? 'none',
        (counts.get(decision.selectedOptionId ?? 'none') ?? 0) + 1
      );
    }
    // Both options remain reachable: the game cannot soft-lock on bad weights.
    expect((counts.get('a') ?? 0) > 0).toBe(true);
    expect((counts.get('b') ?? 0) > 0).toBe(true);
    expect(engine.getHistoryDetailed(1)[0]?.fallback).toBe('uniform-eligible');
  });

  it('falls back to the first candidate (flagged) when nothing is eligible', () => {
    const logger = new MemoryLogger();
    const engine = new ProbabilityEngine({ logger });
    engine.init(7);
    const decision = engine.decide({
      streamId: 'events.occurrence',
      decisionType: 'none_eligible',
      context,
      candidates: [
        { id: 'first', baseWeight: 1, conditions: [{ op: 'never' }], result: 'first_result' },
        { id: 'second', baseWeight: 100, conditions: [{ op: 'never' }], result: 'second_result' },
      ],
    });
    expect(decision.fallback).toBe('first-candidate');
    expect(decision.selectedOptionId).toBe('first');
    expect(decision.selectedResult).toBe('first_result');
    expect(decision.candidates[0]?.probability).toBe(1);
    expect(decision.candidates[1]?.probability).toBe(0);
    expect(logger.entries.some((entry) => entry.message.includes('fallback'))).toBe(true);
  });

  it('previewDecision mirrors decide() fallback semantics without drawing or recording', () => {
    const engine = new ProbabilityEngine();
    engine.init(31);
    const before = engine.exportState();

    const uniformPreview = engine.previewDecision({
      streamId: 'events.occurrence',
      decisionType: 'preview_zero',
      context,
      minWeight: 0,
      candidates: [
        { id: 'a', baseWeight: 0, result: 'a' },
        { id: 'b', baseWeight: 0, result: 'b' },
      ],
    });
    expect(uniformPreview.fallback).toBe('uniform-eligible');
    expect(uniformPreview.totalWeight).toBe(0);
    expect(uniformPreview.candidates[0]?.probability).toBe(0.5);
    expect(uniformPreview.candidates[1]?.probability).toBe(0.5);

    const forcedPreview = engine.previewDecision({
      streamId: 'events.occurrence',
      decisionType: 'preview_forced',
      context,
      candidates: [{ id: 'only', baseWeight: 1, conditions: [{ op: 'never' }], result: 'only' }],
    });
    expect(forcedPreview.fallback).toBe('first-candidate');
    expect(forcedPreview.candidates[0]?.probability).toBe(1);

    const weightedPreview = engine.previewDecision({
      streamId: 'events.occurrence',
      decisionType: 'preview_weighted',
      context,
      candidates: [
        { id: 'a', baseWeight: 3, result: 'a' },
        { id: 'b', baseWeight: 1, result: 'b' },
      ],
    });
    expect(weightedPreview.fallback).toBe('none');
    expect(weightedPreview.candidates[0]?.probability).toBeCloseTo(0.75, 9);

    // Preview must not perturb the engine at all.
    expect(engine.exportState()).toEqual(before);
  });

  it('handles empty candidate lists without throwing', () => {
    const engine = new ProbabilityEngine();
    engine.init(1);
    const decision = engine.decide({
      streamId: 'events.occurrence',
      decisionType: 'empty',
      context,
      candidates: [],
    });
    expect(decision.candidates).toHaveLength(0);
    expect(decision.selectedOptionId).toBeNull();
    expect(decision.selectedResult).toBeNull();
    expect(decision.fallback).toBe('none');
    expect(decision.totalWeight).toBe(0);
    expect(engine.getHistory()).toHaveLength(1);
  });

  it('logs warnings for illegal weights through the injected logger', () => {
    const logger = new MemoryLogger();
    const engine = new ProbabilityEngine({ logger });
    engine.init(2);
    engine.decide({
      streamId: 'events.occurrence',
      decisionType: 'warned',
      context,
      candidates: [{ id: 'bad', baseWeight: Number.NaN, result: 'bad' }],
    });
    expect(logger.entries.some((entry) => entry.level === 'warn')).toBe(true);
  });
});

describe('samplers', () => {
  it('selects prefix-sum sampling for <= 32 entries and alias above it', () => {
    expect(buildSampler(new Array(5).fill(1)).mode).toBe('prefix');
    expect(buildSampler(new Array(ALIAS_TABLE_THRESHOLD).fill(1)).mode).toBe('prefix');
    expect(buildSampler(new Array(ALIAS_TABLE_THRESHOLD + 1).fill(1)).mode).toBe('alias');
    expect(buildSampler([1, 2, 3], 'alias').mode).toBe('alias');
    expect(buildSampler([1, 2, 3], 'prefix').mode).toBe('prefix');
  });

  it('maps uniforms to uniform indices safely', () => {
    expect(uniformIndexFromUniform(0, 3)).toBe(0);
    expect(uniformIndexFromUniform(0.5, 2)).toBe(1);
    expect(uniformIndexFromUniform(0.9999999, 3)).toBe(2);
    expect(uniformIndexFromUniform(1, 3)).toBe(2);
    expect(uniformIndexFromUniform(-1, 3)).toBe(0);
    expect(uniformIndexFromUniform(0.5, 0)).toBe(-1);
    expect(uniformIndexFromUniform(Number.NaN, 4)).toBe(0);
  });

  it('normalised probabilities of both samplers match the raw weights', () => {
    const weights = [5, 3, 2, 1.5, 0.5];
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    for (const sampler of [buildSampler(weights, 'prefix'), buildSampler(weights, 'alias')]) {
      const probabilities = sampler.normalizedProbabilities();
      expect(probabilities).toHaveLength(weights.length);
      for (let i = 0; i < weights.length; i += 1) {
        expect(probabilities[i]).toBeCloseTo((weights[i] ?? 0) / total, 12);
      }
      expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    }
  });

  it('empty distributions sample -1 and consume no randomness', () => {
    for (const sampler of [buildSampler([]), buildSampler([0, 0, 0])]) {
      expect(sampler.isEmpty).toBe(true);
      expect(sampler.sampleIndex({ next: () => 0.5 })).toBe(-1);
    }
  });
});
