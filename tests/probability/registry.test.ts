import { describe, expect, it } from 'vitest';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import { ProbabilityRegistry } from '../../src/probability/ProbabilityRegistry';
import { RandomStream } from '../../src/probability/RandomStream';
import { deriveStreamState } from '../../src/probability/SeedManager';

function sourceFor(seed: number, streamId: string): { next: () => number; stream: RandomStream } {
  const stream = new RandomStream(streamId, deriveStreamState(seed, streamId));
  return { stream, next: () => stream.next() };
}

describe('ProbabilityRegistry', () => {
  it('registers, lists and reports sizes', () => {
    const registry = new ProbabilityRegistry();
    expect(registry.size).toBe(0);
    registry.register('weather', [
      { key: 'clear', weight: 5 },
      { key: 'rain', weight: 3 },
    ]);
    registry.registerWeights('loot', { common: 10, rare: 1 });
    expect(registry.size).toBe(2);
    expect(registry.list()).toEqual(['weather', 'loot']);
    expect(registry.has('weather')).toBe(true);
    expect(registry.has('missing')).toBe(false);
    expect(registry.getDefinition('loot')?.entries.map((entry) => entry.key)).toEqual(['common', 'rare']);
    expect(() => registry.register('', [])).toThrow();
  });

  it('compiles lazily and invalidates the sampler when re-registered', () => {
    const registry = new ProbabilityRegistry();
    registry.register('table', [
      { key: 'a', weight: 1 },
      { key: 'b', weight: 1 },
    ]);
    // Registration alone must not build the alias/prefix table.
    expect(registry.compiledCount).toBe(0);
    const versionBefore = registry.getDefinition('table')?.version ?? 0;
    expect(registry.mode('table')).toBe('prefix');
    expect(registry.compiledCount).toBe(1);

    registry.register('table', [
      { key: 'a', weight: 0 },
      { key: 'b', weight: 100 },
    ]);
    const versionAfter = registry.getDefinition('table')?.version ?? 0;
    expect(versionAfter).toBeGreaterThan(versionBefore);
    expect(registry.compiledCount).toBe(0); // cache invalidated on change
    const source = sourceFor(1, 'test.stream');
    for (let i = 0; i < 50; i += 1) expect(registry.sample('table', source)).toBe('b');
    expect(registry.getCompiled('table')?.version).toBe(versionAfter);
  });

  it('samples deterministically from a seeded stream', () => {
    const registry = new ProbabilityRegistry();
    registry.registerWeights('table', { a: 1, b: 2, c: 3, d: 4 });
    const run = (): string[] => {
      const source = sourceFor(99, 'table.stream');
      const keys: string[] = [];
      for (let i = 0; i < 100; i += 1) keys.push(registry.sample('table', source) ?? 'none');
      return keys;
    };
    expect(run()).toEqual(run());
  });

  it('uses the alias table above 32 entries', () => {
    const registry = new ProbabilityRegistry();
    registry.register(
      'large',
      Array.from({ length: 40 }, (_, index) => ({ key: `k${index}`, weight: 1 }))
    );
    expect(registry.mode('large')).toBe('alias');
    const probabilities = registry.probabilities('large');
    expect(probabilities).not.toBeNull();
    expect(Object.keys(probabilities ?? {})).toHaveLength(40);
    let sum = 0;
    for (const value of Object.values(probabilities ?? {})) sum += value;
    expect(sum).toBeCloseTo(1, 9);
  });

  it('merges duplicate keys in probability reports and is sample-safe', () => {
    const registry = new ProbabilityRegistry();
    registry.register('dupes', [
      { key: 'a', weight: 1 },
      { key: 'a', weight: 2 },
      { key: 'b', weight: 1 },
    ]);
    const probabilities = registry.probabilities('dupes');
    expect(probabilities?.['a']).toBeCloseTo(0.75, 9);
    expect(probabilities?.['b']).toBeCloseTo(0.25, 9);
    const source = sourceFor(3, 'dupe.stream');
    for (let i = 0; i < 50; i += 1) {
      const key = registry.sample('dupes', source);
      expect(key === 'a' || key === 'b').toBe(true);
    }
  });

  it('returns null and consumes no randomness for missing / empty distributions', () => {
    const registry = new ProbabilityRegistry();
    const source = sourceFor(5, 'empty.stream');
    const before = source.stream.exportState();
    expect(registry.sample('missing', source)).toBeNull();
    expect(source.stream.exportState()).toEqual(before);

    registry.register('empty', []);
    expect(registry.sample('empty', source)).toBeNull();
    expect(registry.mode('empty')).toBe('prefix');
    expect(source.stream.exportState()).toEqual(before);

    registry.register('zero', [
      { key: 'a', weight: 0 },
      { key: 'b', weight: -2 },
      { key: 'c', weight: Number.NaN },
    ]);
    expect(registry.sample('zero', source)).toBeNull();
    expect(registry.probabilities('zero')).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('sanitises entries and unregisters cleanly', () => {
    const registry = new ProbabilityRegistry();
    registry.register('mixed', [
      { key: 'ok', weight: 2 },
      { key: '', weight: 5 },
      { key: 'negative', weight: -1 },
      null as unknown as { key: string; weight: number },
    ]);
    const probabilities = registry.probabilities('mixed');
    expect(probabilities).toEqual({ ok: 1, negative: 0 });
    expect(registry.unregister('mixed')).toBe(true);
    expect(registry.unregister('mixed')).toBe(false);
    expect(registry.sample('mixed', sourceFor(1, 'x'))).toBeNull();
    registry.register('temp', [{ key: 'a', weight: 1 }]);
    registry.clear();
    expect(registry.size).toBe(0);
  });
});

describe('ProbabilityRegistry inside the engine', () => {
  it('samples distributions through the engine and uses the named stream', () => {
    const engine = new ProbabilityEngine();
    engine.init(4242);
    engine.distributions.registerWeights('weather.table', { clear: 5, rain: 3, storm: 2 });
    const first = engine.sampleDistribution('world.weather', 'weather.table');
    expect(first).not.toBeNull();
    expect(engine.hasStream('world.weather')).toBe(true);
    expect(engine.getStats('world.weather').draws).toBe(1);

    // Same seed, same sample sequence.
    const other = new ProbabilityEngine();
    other.init(4242);
    other.distributions.registerWeights('weather.table', { clear: 5, rain: 3, storm: 2 });
    expect(other.sampleDistribution('world.weather', 'weather.table')).toBe(first);
  });

  it('does not disturb other streams or history when sampling distributions', () => {
    const engine = new ProbabilityEngine();
    engine.init(9);
    engine.roll('world.environment');
    const environmentState = engine.exportState().streams['world.environment'];
    engine.distributions.registerWeights('table', { a: 1, b: 1, c: 1 });
    for (let i = 0; i < 25; i += 1) engine.sampleDistribution('world.weather', 'table');
    expect(engine.exportState().streams['world.environment']).toEqual(environmentState);
    expect(engine.getHistory()).toHaveLength(0);
    expect(engine.sampleDistribution('world.weather', 'unknown.table')).toBeNull();
  });
});
