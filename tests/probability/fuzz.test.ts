import { describe, expect, it } from 'vitest';
import type {
  ConditionExpr,
  ProbabilityContext,
  ProbabilityModifier,
  ProbabilityOption,
  ProbabilityRequest,
} from '../../src/core/contracts';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import { deriveStreamState } from '../../src/probability/SeedManager';
import { RandomStream } from '../../src/probability/RandomStream';
import { makeContext } from './helpers';

/**
 * Deterministic fuzz suite: a fixed-seed generator builds many decision shapes
 * and every decision must obey the engine invariants. This catches integration
 * bugs between conditions, modifiers, clamping, normalisation and fallbacks that
 * hand-written cases can miss.
 */
const generator = new RandomStream('fuzz.generator', deriveStreamState(0xf00d, 'fuzz.generator'));

function pick<T>(values: readonly T[]): T {
  const index = Math.min(values.length - 1, Math.floor(generator.next() * values.length));
  return values[index] as T;
}

function chance(p: number): boolean {
  return generator.next() < p;
}

function makeCondition(): ConditionExpr {
  const kind = pick(['cmp', 'flag', 'contains', 'and', 'or', 'not', 'always', 'never'] as const);
  switch (kind) {
    case 'cmp':
      return {
        op: 'cmp',
        path: pick(['actorState.mood', 'environment.temperature', 'simulationTime', 'actorState.skill']),
        cmp: pick(['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const),
        value: pick([0, 0.5, 1, 5, 20, 'rain']),
      };
    case 'flag':
      return { op: 'flag', path: 'environment.sheltered', equals: chance(0.5) };
    case 'contains':
      return {
        op: 'contains',
        path: pick(['history', 'environment.tags']),
        value: pick(['met', 'rain', 'calm']),
      };
    case 'and':
      return { op: 'and', args: [makeCondition(), makeCondition()] };
    case 'or':
      return { op: 'or', args: [makeCondition(), makeCondition()] };
    case 'not':
      return { op: 'not', arg: makeCondition() };
    case 'always':
      return { op: 'always' };
    default:
      return { op: 'never' };
  }
}

function makeModifier(index: number): ProbabilityModifier {
  const kind = pick(['add', 'multiply'] as const);
  const hasPath = chance(0.5);
  const modifier: ProbabilityModifier = {
    id: `mod_${index}`,
    source: 'fuzz',
    kind,
    value: kind === 'add' ? pick([-2, -0.5, 0, 1, 3]) : pick([0, 0.5, 1, 1.5, 2, -1]),
  };
  if (hasPath) {
    modifier.path = pick(['actorState.mood', 'environment.temperature', 'actorState.skill', 'missing.path']);
    if (chance(0.5)) modifier.perUnit = true;
  }
  if (chance(0.3)) modifier.condition = makeCondition();
  return modifier;
}

function makeCandidate(index: number): ProbabilityOption<string> {
  const candidate: ProbabilityOption<string> = {
    id: `option_${index}`,
    baseWeight: chance(0.1) ? pick([Number.NaN, -5]) : pick([0, 0.00001, 1, 2.5, 10, 100, 5000]),
    result: `result_${index}`,
  };
  if (chance(0.5)) candidate.conditions = [makeCondition()];
  if (chance(0.6)) {
    const modifiers: ProbabilityModifier[] = [];
    const count = 1 + Math.floor(generator.next() * 3);
    for (let i = 0; i < count; i += 1) modifiers.push(makeModifier(i));
    candidate.modifiers = modifiers;
  }
  return candidate;
}

function makeRequest(index: number): ProbabilityRequest<string> {
  const candidateCount = 1 + Math.floor(generator.next() * 8);
  const candidates: ProbabilityOption<string>[] = [];
  for (let i = 0; i < candidateCount; i += 1) candidates.push(makeCandidate(i));
  const context: ProbabilityContext = makeContext({
    simulationTime: index * 60,
    weather: pick(['clear', 'rain', 'storm']),
    season: pick(['spring', 'summer', 'autumn', 'winter']),
    actorState: {
      mood: generator.next(),
      skill: Math.floor(generator.next() * 20),
      inventory: { ash: Math.floor(generator.next() * 50) },
    },
    environment: {
      temperature: Math.floor(generator.next() * 30) - 5,
      sheltered: chance(0.5),
      tags: ['calm'],
    },
    history: chance(0.5) ? ['met_someone'] : [],
  });
  const request: ProbabilityRequest<string> = {
    streamId: pick(['fuzz.stream.a', 'fuzz.stream.b', 'fuzz.stream.c']),
    decisionType: `fuzz_${index % 5}`,
    context,
    candidates,
  };
  if (chance(0.4)) {
    request.minWeight = pick([0, 0.0001, 0.5]);
    request.maxWeight = pick([1, 10, 1000]);
  }
  return request;
}

function verifyDecision(
  engine: ProbabilityEngine,
  request: ProbabilityRequest<string>,
  decision: ReturnType<ProbabilityEngine['decide']>
): void {
  expect(decision.candidates).toHaveLength(request.candidates.length);
  expect(decision.streamId).toBe(request.streamId);
  let eligibleCount = 0;
  let probabilitySum = 0;
  for (const evaluation of decision.candidates) {
    expect(Number.isFinite(evaluation.baseWeight)).toBe(true);
    expect(Number.isFinite(evaluation.finalWeight)).toBe(true);
    expect(evaluation.finalWeight).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(evaluation.probability)).toBe(true);
    expect(evaluation.probability).toBeGreaterThanOrEqual(0);
    expect(evaluation.probability).toBeLessThanOrEqual(1);
    if (evaluation.eligible) {
      eligibleCount += 1;
      probabilitySum += evaluation.probability;
    } else {
      // The first-candidate fallback can flag an ineligible candidate as the
      // deterministic outcome with probability 1; everywhere else ineligible
      // candidates must have zero probability.
      if (decision.fallback === 'first-candidate' && evaluation.id === decision.selectedOptionId) {
        expect(evaluation.probability).toBe(1);
      } else {
        expect(evaluation.probability).toBe(0);
      }
      expect(evaluation.rejectionReason).not.toBeNull();
    }
    for (const modifier of evaluation.modifiers) expect(Number.isFinite(modifier.amount)).toBe(true);
  }

  if (decision.fallback === 'none') {
    expect(decision.selectedOptionId).not.toBeNull();
    const selected = decision.candidates.find((candidate) => candidate.id === decision.selectedOptionId);
    expect(selected?.eligible).toBe(true);
    if (decision.totalWeight > 0) {
      expect(probabilitySum).toBeCloseTo(1, 9);
      expect((selected?.probability ?? 0) > 0).toBe(true);
    } else {
      expect(eligibleCount).toBe(0);
      expect(decision.candidates.length).toBeGreaterThan(0);
    }
  } else if (decision.fallback === 'uniform-eligible') {
    expect(eligibleCount).toBeGreaterThan(0);
    expect(probabilitySum).toBeCloseTo(1, 9);
    expect(decision.totalWeight).toBe(0);
    expect(decision.selectedOptionId).not.toBeNull();
  } else {
    expect(eligibleCount).toBe(0);
    expect(decision.selectedOptionId).toBe(decision.candidates[0]?.id ?? null);
  }

  // Replayable record and matching detailed diagnostics.
  const record = engine.replayDecision(decision.decisionId);
  expect(record).not.toBeNull();
  expect(record?.selectedOptionId).toBe(decision.selectedOptionId);
  expect(engine.getHistoryDetailed(1)[0]?.fallback).toBe(decision.fallback);
}

describe('fuzz: decision invariants across 200 generated shapes', () => {
  it('holds all invariants and replays every decision', () => {
    const engine = new ProbabilityEngine();
    engine.init(0xbeef);
    const requests: ProbabilityRequest<string>[] = [];
    const decisions: ReturnType<ProbabilityEngine['decide']>[] = [];
    for (let i = 0; i < 200; i += 1) {
      const request = makeRequest(i);
      const decision = engine.decide(request);
      requests.push(request);
      decisions.push(decision);
      verifyDecision(engine, request, decision);
      // previewDecision must agree with the recorded weights.
      const preview = engine.previewDecision(request);
      expect(preview.candidates.length).toBe(decision.candidates.length);
      expect(preview.totalWeight).toBe(decision.totalWeight);
      for (let c = 0; c < preview.candidates.length; c += 1) {
        expect(preview.candidates[c]?.finalWeight).toBe(decision.candidates[c]?.finalWeight);
      }
    }

    // Identical replay from a fresh engine with the same seed + request order.
    const other = new ProbabilityEngine();
    other.init(0xbeef);
    for (let i = 0; i < requests.length; i += 1) {
      const request = requests[i];
      if (!request) continue;
      const decision = other.decide(request);
      expect(decision.decisionId).toBe(decisions[i]?.decisionId);
      expect(decision.selectedOptionId).toBe(decisions[i]?.selectedOptionId);
    }
  });

  it('simulate() matches decision weights for generated shapes', () => {
    const engine = new ProbabilityEngine();
    engine.init(0x1234);
    for (let i = 0; i < 30; i += 1) {
      const request = makeRequest(1000 + i);
      const result = engine.simulate(request, 500);
      let total = 0;
      for (const value of Object.values(result)) total += value;
      expect(total).toBe(500);
      const expected = engine.previewDecision(request).candidates;
      for (const evaluation of expected) {
        const observed = (result[evaluation.id] ?? 0) / 500;
        expect(Math.abs(observed - evaluation.probability)).toBeLessThan(0.12);
      }
    }
  });

  it('survives a save/load round-trip in the middle of generated decisions', () => {
    const engine = new ProbabilityEngine();
    engine.init(0x5678);
    for (let i = 0; i < 50; i += 1) engine.decide(makeRequest(i));
    const saved = JSON.parse(JSON.stringify(engine.exportState())) as ReturnType<
      ProbabilityEngine['exportState']
    >;
    const restored = new ProbabilityEngine();
    restored.init(0x5678, saved);
    for (let i = 50; i < 100; i += 1) {
      const request = makeRequest(i);
      const a = engine.decide(request);
      const b = restored.decide(request);
      expect(b.decisionId).toBe(a.decisionId);
      expect(b.selectedOptionId).toBe(a.selectedOptionId);
      expect(b.candidates).toEqual(a.candidates);
    }
  });
});
