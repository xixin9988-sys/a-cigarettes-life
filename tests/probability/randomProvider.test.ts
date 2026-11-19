import { describe, expect, it } from 'vitest';
import {
  GOLDEN_GAMMA_64,
  SplitMix64,
  UINT32_TO_UNIT,
  Xoshiro128,
  expandState128,
  fnv1a64,
  hashString64,
  normalizeState,
  numberToSeed64,
  rotl32,
  serializeState,
  splitMix64Finalise,
  splitMix64Next,
} from '../../src/probability/RandomProvider';

// Reference vectors computed from the published SplitMix64 / Xoshiro128**
// algorithms (public domain, Blackman & Vigna) - NOT from this module's code.
const SPLITMIX_SEED0 = [0xe220a8397b1dcdafn, 0x6e789e6aa1b965f4n, 0x06c45d188009454fn, 0xf88bb8a8724c81ecn];

const XOSHIRO_STATE_1234 = [1, 2, 3, 4] as const;
const XOSHIRO_OUTPUTS = [11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849];

describe('RandomProvider: SplitMix64', () => {
  it('matches the reference output sequence for seed 0', () => {
    let state = 0n;
    for (const expected of SPLITMIX_SEED0) {
      const step = splitMix64Next(state);
      state = step.state;
      expect(step.value).toBe(expected);
    }
    // state advanced by golden gamma each step
    expect(state).toBe((BigInt(SPLITMIX_SEED0.length) * GOLDEN_GAMMA_64) & ((1n << 64n) - 1n));
  });

  it('is pure (does not mutate its input) and wraps to 64 bits', () => {
    const start = (1n << 64n) - 1n;
    const first = splitMix64Next(start);
    const second = splitMix64Next(start);
    expect(first).toEqual(second);
    expect(first.state).toBe(GOLDEN_GAMMA_64 - 1n);
  });

  it('finalise is deterministic and reversible-safe for 64-bit inputs', () => {
    expect(splitMix64Finalise(123456789n)).toBe(splitMix64Finalise(123456789n));
    expect(splitMix64Finalise(1n)).not.toBe(splitMix64Finalise(2n));
    expect(splitMix64Finalise(-1n)).toBe(splitMix64Finalise((1n << 64n) - 1n));
  });

  it('SplitMix64 class produces the same sequence as the pure function', () => {
    const generator = new SplitMix64(0);
    for (const expected of SPLITMIX_SEED0) {
      expect(generator.nextUint64()).toBe(expected);
    }
    const seeded = new SplitMix64(42);
    expect(seeded.next()).toBeGreaterThanOrEqual(0);
    expect(seeded.next()).toBeLessThan(1);
  });
});

describe('RandomProvider: hashing and seed mapping', () => {
  it('hashes strings deterministically and distinctly', () => {
    expect(fnv1a64('world.weather')).toBe(0x0320e7fb1dc767e1n);
    expect(hashString64('world.weather')).toBe(0x64c57e9241c36f22n);
    expect(hashString64('npc.behavior')).toBe(0xf3016bbc88dc94f4n);
    expect(hashString64('world.weather')).not.toBe(hashString64('npc.behavior'));
    expect(hashString64('')).toBe(hashString64(''));
  });

  it('maps numbers to stable IEEE-754 seeds and normalises invalid inputs', () => {
    expect(numberToSeed64(0)).toBe(0n);
    expect(numberToSeed64(1)).toBe(0x3ff0000000000000n);
    expect(numberToSeed64(42)).toBe(0x4045000000000000n);
    expect(numberToSeed64(-1)).toBe(0xbff0000000000000n);
    expect(numberToSeed64(1.5)).toBe(0x3ff8000000000000n);
    expect(numberToSeed64(Number.NaN)).toBe(0n);
    expect(numberToSeed64(Number.POSITIVE_INFINITY)).toBe(0n);
    expect(numberToSeed64(-0)).toBe(numberToSeed64(0));
  });
});

describe('RandomProvider: Xoshiro128**', () => {
  it('matches the reference output sequence for state [1,2,3,4]', () => {
    const generator = new Xoshiro128([...XOSHIRO_STATE_1234]);
    for (const expected of XOSHIRO_OUTPUTS) {
      expect(generator.nextUint32()).toBe(expected);
    }
  });

  it('normalises uint32 draws into [0, 1)', () => {
    const generator = new Xoshiro128([...XOSHIRO_STATE_1234]);
    for (let i = 0; i < 2000; i += 1) {
      const value = generator.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(XOSHIRO_OUTPUTS[0]! * UINT32_TO_UNIT).toBeCloseTo(0.0000026822090148925781, 12);
  });

  it('serialises and restores its state exactly', () => {
    const first = new Xoshiro128([...XOSHIRO_STATE_1234]);
    for (let i = 0; i < 17; i += 1) first.nextUint32();
    const saved = first.state;
    const restored = new Xoshiro128(saved);
    for (let i = 0; i < 100; i += 1) {
      expect(restored.nextUint32()).toBe(first.nextUint32());
    }
  });

  it('never emits a stuck all-zero sequence for a zero state', () => {
    const generator = new Xoshiro128([0, 0, 0, 0]);
    const values = new Set<number>();
    for (let i = 0; i < 50; i += 1) values.add(generator.nextUint32());
    expect(values.size).toBeGreaterThan(40);
  });

  it('expands seeds into non-zero 128-bit states and clones independently', () => {
    const state = expandState128(0n);
    expect(state.length).toBe(4);
    expect(state.some((word) => word !== 0)).toBe(true);
    const original = Xoshiro128.fromSeed64(0n);
    const expected = Xoshiro128.fromSeed64(0n);
    for (let i = 0; i < 20; i += 1) {
      expect(original.nextUint32()).toBe(expected.nextUint32());
    }
    const clone = original.clone();
    expect(clone.state).toEqual(original.state);
    // The clone continues the identical sequence...
    const reference = Xoshiro128.fromSeed64(0n);
    for (let i = 0; i < 20; i += 1) reference.nextUint32();
    for (let i = 0; i < 10; i += 1) {
      expect(clone.nextUint32()).toBe(reference.nextUint32());
    }
    expect(clone.state).not.toEqual(original.state);
    // ...and drawing from the clone never leaks into the original stream.
    for (let i = 0; i < 10; i += 1) {
      expect(original.nextUint32()).toBe(expected.nextUint32());
    }
  });

  it('rotates 32-bit words correctly', () => {
    expect(rotl32(0x80000000, 1)).toBe(1);
    expect(rotl32(1, 31)).toBe(0x80000000);
    expect(rotl32(0xdeadbeef, 0)).toBe(0xdeadbeef);
    expect(rotl32(0xdeadbeef, 32)).toBe(0xdeadbeef);
  });
});

describe('RandomProvider: state validation', () => {
  it('accepts valid 4-word states and rejects malformed data', () => {
    expect(normalizeState([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(normalizeState([1, 2, 3])).toBeNull();
    expect(normalizeState([1, 2, 3, Number.NaN])).toBeNull();
    expect(normalizeState(null)).toBeNull();
    expect(normalizeState('nope' as unknown as number[])).toBeNull();
    expect(normalizeState([0, 0, 0, 0])?.some((word) => word !== 0)).toBe(true);
    // uint32 wrapping on import
    expect(normalizeState([-1, 0, 0, 1])?.[0]).toBe(0xffffffff);
  });

  it('round-trips serialised states', () => {
    const state = expandState128(987654321n);
    expect(serializeState(state)).toEqual([state[0], state[1], state[2], state[3]]);
    expect(normalizeState(serializeState(state))).toEqual(state);
  });
});
