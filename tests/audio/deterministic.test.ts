import { describe, expect, it } from 'vitest';
import {
  approach,
  clamp,
  clamp01,
  hashFloat01,
  hashInt32,
  hashStringToSeed,
  hashUnit,
  lerp,
  mix32,
  pickIndex,
  smoothstep,
  unitFloat,
} from '../../src/audio/deterministic';

describe('deterministic hashing', () => {
  it('is a pure function: same input -> same output', () => {
    for (const value of [0, 1, -1, 42, 123456, -987654, 2147483647, -2147483648]) {
      expect(mix32(value)).toBe(mix32(value));
      expect(hashInt32(value)).toBe(mix32(value));
    }
  });

  it('produces unsigned 32-bit integers', () => {
    for (let value = -5000; value <= 5000; value += 137) {
      const hash = hashInt32(value);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThan(2 ** 32);
    }
  });

  it('returns floats in [0, 1)', () => {
    for (let value = -2000; value < 2000; value += 7) {
      const unit = hashFloat01(value);
      expect(Number.isFinite(unit)).toBe(true);
      expect(unit).toBeGreaterThanOrEqual(0);
      expect(unit).toBeLessThan(1);
    }
  });

  it('mixes seed/counter/salt deterministically and keeps draws in range', () => {
    const first = hashUnit(1234, 7, 3);
    expect(hashUnit(1234, 7, 3)).toBe(first);
    expect(hashUnit(1234, 7, 4)).not.toBe(first);
    expect(hashUnit(1234, 8, 3)).not.toBe(first);
    for (let counter = 0; counter < 500; counter += 1) {
      const unit = unitFloat(987654, counter, 11);
      expect(unit).toBeGreaterThanOrEqual(0);
      expect(unit).toBeLessThan(1);
    }
  });

  it('has a reasonably uniform distribution', () => {
    const buckets = new Array<number>(10).fill(0);
    let sum = 0;
    for (let counter = 0; counter < 4000; counter += 1) {
      const unit = unitFloat(0x51ed270b, counter, 1);
      sum += unit;
      const bucket = Math.min(9, Math.floor(unit * 10));
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    expect(sum / 4000).toBeGreaterThan(0.47);
    expect(sum / 4000).toBeLessThan(0.53);
    for (const count of buckets) {
      expect(count).toBeGreaterThan(300);
    }
  });

  it('is collision resistant enough for counters', () => {
    const seen = new Set<number>();
    for (let counter = 0; counter < 1000; counter += 1) seen.add(unitFloat(77, counter, 5));
    expect(seen.size).toBeGreaterThan(995);
  });
});

describe('hashStringToSeed', () => {
  it('is stable and different for different strings', () => {
    expect(hashStringToSeed('spring-morning-clear-outdoor')).toBe(hashStringToSeed('spring-morning-clear-outdoor'));
    expect(hashStringToSeed('spring')).not.toBe(hashStringToSeed('summer'));
    expect(Number.isInteger(hashStringToSeed(''))).toBe(true);
    expect(Number.isFinite(hashStringToSeed('a'.repeat(500)))).toBe(true);
  });
});

describe('math helpers', () => {
  it('clamps and lerps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(Number.NaN, 2, 3)).toBe(2);
    expect(clamp01(0.5)).toBe(0.5);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerp(10, 20, 2)).toBe(20);
  });

  it('smoothstep is monotonic and bounded', () => {
    let previous = -1;
    for (let index = 0; index <= 20; index += 1) {
      const value = smoothstep(0, 1, index / 20);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(smoothstep(0, 1, -5)).toBe(0);
    expect(smoothstep(0, 1, 5)).toBe(1);
  });

  it('approach converges smoothly toward the target', () => {
    let value = 0;
    let previous = 0;
    for (let step = 0; step < 60; step += 1) {
      value = approach(value, 1, 0.05, 0.2);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(value).toBeGreaterThan(0.99);
    expect(approach(0.4, 0.9, 0, 0.2)).toBe(0.9);
    expect(approach(0.4, 0.9, 0.05, 0)).toBe(0.9);
  });

  it('picks deterministic in-range indices', () => {
    for (let counter = 0; counter < 200; counter += 1) {
      const index = pickIndex(42, counter, 7);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(7);
    }
    expect(pickIndex(42, 0, 0)).toBe(0);
  });
});
