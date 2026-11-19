import type { ProbabilityContext } from '../../src/core/contracts';
import type { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';

/** Minimal deterministic context for engine tests. */
export function makeContext(overrides: Partial<ProbabilityContext> = {}): ProbabilityContext {
  return {
    worldId: 'world_test',
    lifeId: 'life_test',
    simulationTime: 0,
    ...overrides,
  };
}

/** Draws `count` consecutive uniform values from a stream (helper). */
export function drawSequence(engine: ProbabilityEngine, streamId: string, count: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) values.push(engine.roll(streamId));
  return values;
}

/** Counts how often each value appears in a list. */
export function countValues<T>(values: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

/** Close-to assertion helper with a clear message. */
export function expectCloseTo(actual: number, expected: number, tolerance: number, label: string): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected} +/- ${tolerance}, got ${actual}`);
  }
}
