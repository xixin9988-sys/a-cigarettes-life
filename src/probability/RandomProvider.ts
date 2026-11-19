// =============================================================================
// Deterministic PRNG primitives (pure, DOM-free, worker-safe).
//
// Algorithm (mandated by the spec, code_artifact.txt module 2.1):
//   1. SplitMix64 hashes / expands a life seed into 128 bits of PRNG state.
//   2. Xoshiro128** generates uniform uint32 values, normalised to [0, 1).
//
// No unseeded entropy source is used anywhere in this module. All functions are
// pure or operate on an explicit state instance so the same seed reproduces the
// same sequence on every platform (32-bit integer math only).
// =============================================================================
import type { StreamState } from './types';

/** Largest uint32 value. */
export const UINT32_MAX = 0xffffffff;
/** 2^32, used to normalise uint32 draws. */
export const TWO_POW_32 = 4294967296;
/** Multiplier that maps a uint32 to the half-open interval [0, 1). */
export const UINT32_TO_UNIT = 1 / TWO_POW_32;

const U64_MASK = 0xffffffffffffffffn;
/** SplitMix64 increment (golden gamma). */
export const GOLDEN_GAMMA_64 = 0x9e3779b97f4a7c15n;
const SPLITMIX_MUL1 = 0xbf58476d1ce4e5b9n;
const SPLITMIX_MUL2 = 0x94d049bb133111ebn;
const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;

/** Wraps a number to uint32. */
export function toUint32(value: number): number {
  return value >>> 0;
}

/** Wraps a bigint to uint64. */
export function toUint64(value: bigint): bigint {
  return value & U64_MASK;
}

/** 32-bit circular left rotate. */
export function rotl32(value: number, shift: number): number {
  const s = shift & 31;
  const bits = value >>> 0;
  if (s === 0) return bits;
  return ((bits << s) | (bits >>> (32 - s))) >>> 0;
}

/** Non-zero fallback state used when SplitMix64 expansion yields all zeroes. */
const ZERO_STATE_REPLACEMENT: StreamState = [0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x8aed2a6b];

// -----------------------------------------------------------------------------
// SplitMix64
// -----------------------------------------------------------------------------

/**
 * One SplitMix64 step. Returns the advanced 64-bit state and the generated
 * 64-bit output. Pure function: `state` is never mutated.
 */
export function splitMix64Next(state: bigint): { state: bigint; value: bigint } {
  const nextState = toUint64(state + GOLDEN_GAMMA_64);
  let z = nextState;
  z = toUint64((z ^ (z >> 30n)) * SPLITMIX_MUL1);
  z = toUint64((z ^ (z >> 27n)) * SPLITMIX_MUL2);
  z = toUint64(z ^ (z >> 31n));
  return { state: nextState, value: z };
}

/** Applies the SplitMix64 output finaliser to an arbitrary 64-bit value. */
export function splitMix64Finalise(value: bigint): bigint {
  let z = toUint64(value);
  z = toUint64((z ^ (z >> 30n)) * SPLITMIX_MUL1);
  z = toUint64((z ^ (z >> 27n)) * SPLITMIX_MUL2);
  return toUint64(z ^ (z >> 31n));
}

/**
 * Stateful SplitMix64 generator. Used for seed expansion and stream derivation,
 * never on the hot per-draw path of a random stream.
 */
export class SplitMix64 {
  private current: bigint;

  constructor(seed: bigint | number = 0n) {
    this.current = typeof seed === 'bigint' ? toUint64(seed) : numberToSeed64(seed);
  }

  get state(): bigint {
    return this.current;
  }

  /** Generates the next 64-bit value. */
  nextUint64(): bigint {
    const step = splitMix64Next(this.current);
    this.current = step.state;
    return step.value;
  }

  /** Generates the next 32-bit value from the high word of a 64-bit output. */
  nextUint32(): number {
    return Number((this.nextUint64() >> 32n) & 0xffffffffn) >>> 0;
  }

  /** Generates a uniform value in [0, 1). */
  next(): number {
    return Number((this.nextUint64() >> 11n) & 0x1fffffffffffffn) / 9007199254740992;
  }
}

// -----------------------------------------------------------------------------
// Seed hashing
// -----------------------------------------------------------------------------

// Reused DataView so number -> bit-pattern conversion is allocation free.
const SEED_VIEW = new DataView(new ArrayBuffer(8));

/**
 * Maps a JS number to a deterministic 64-bit seed using its IEEE-754 bit
 * pattern. -0 is normalised to 0 and non-finite inputs to 0 so the mapping is
 * stable across engines/platforms.
 */
export function numberToSeed64(seed: number): bigint {
  const safe = typeof seed === 'number' && Number.isFinite(seed) ? seed + 0 : 0;
  SEED_VIEW.setFloat64(0, safe, false);
  return SEED_VIEW.getBigUint64(0, false);
}

/** FNV-1a 64-bit hash over the UTF-16 code units of a string (stable cross-platform). */
export function fnv1a64(text: string): bigint {
  let hash = FNV64_OFFSET_BASIS;
  const value = typeof text === 'string' ? text : String(text);
  for (let i = 0; i < value.length; i += 1) {
    hash = toUint64(hash ^ BigInt(value.charCodeAt(i)));
    hash = toUint64(hash * FNV64_PRIME);
  }
  return hash;
}

/**
 * Hashes a string to a well-distributed 64-bit value: FNV-1a followed by the
 * SplitMix64 finaliser. Used to derive independent random streams from names.
 */
export function hashString64(text: string): bigint {
  return splitMix64Finalise(fnv1a64(text));
}

// -----------------------------------------------------------------------------
// Xoshiro128** state expansion
// -----------------------------------------------------------------------------

/**
 * Expands a 64-bit seed into a full 128-bit Xoshiro128** state using two
 * SplitMix64 outputs (low word first, matching the reference xoshiro seeding
 * procedure). Guarantees a non-zero state: an all-zero xoshiro state is a fixed
 * point that would emit zeroes forever.
 */
export function expandState128(seed64: bigint): StreamState {
  const generator = new SplitMix64(toUint64(seed64));
  const first = generator.nextUint64();
  const second = generator.nextUint64();
  const state: StreamState = [
    Number(first & 0xffffffffn) >>> 0,
    Number((first >> 32n) & 0xffffffffn) >>> 0,
    Number(second & 0xffffffffn) >>> 0,
    Number((second >> 32n) & 0xffffffffn) >>> 0,
  ];
  if ((state[0] | state[1] | state[2] | state[3]) === 0) {
    return [...ZERO_STATE_REPLACEMENT];
  }
  return state;
}

/**
 * Normalises arbitrary persisted data into a valid stream state.
 * Returns null when the value is not exactly four finite numbers; an all-zero
 * state is repaired to a fixed non-zero constant so the stream keeps moving.
 */
export function normalizeState(values: readonly unknown[] | undefined | null): StreamState | null {
  if (!Array.isArray(values) || values.length !== 4) return null;
  const state: StreamState = [0, 0, 0, 0];
  for (let i = 0; i < 4; i += 1) {
    const value = values[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    state[i] = value >>> 0;
  }
  if ((state[0] | state[1] | state[2] | state[3]) === 0) {
    return [...ZERO_STATE_REPLACEMENT];
  }
  return state;
}

/** Serialises a stream state as four decimal uint32 words (save-game format). */
export function serializeState(state: StreamState): number[] {
  return [state[0], state[1], state[2], state[3]];
}

// -----------------------------------------------------------------------------
// Xoshiro128**
// -----------------------------------------------------------------------------

/**
 * Xoshiro128** generator over four uint32 words. This is the hot path of the
 * probability engine: one call allocates nothing and uses only 32-bit integer
 * multiplication (`Math.imul`) so results are identical on every platform.
 */
export class Xoshiro128 {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(state: StreamState) {
    this.s0 = state[0] >>> 0;
    this.s1 = state[1] >>> 0;
    this.s2 = state[2] >>> 0;
    this.s3 = state[3] >>> 0;
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) {
      this.s0 = ZERO_STATE_REPLACEMENT[0];
      this.s1 = ZERO_STATE_REPLACEMENT[1];
      this.s2 = ZERO_STATE_REPLACEMENT[2];
      this.s3 = ZERO_STATE_REPLACEMENT[3];
    }
  }

  /** Creates a generator from a 64-bit seed via SplitMix64 expansion. */
  static fromSeed64(seed64: bigint): Xoshiro128 {
    return new Xoshiro128(expandState128(seed64));
  }

  /** Current state snapshot (fresh array). */
  get state(): StreamState {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  /** Replaces the state (already-normalised input expected). */
  setState(state: StreamState): void {
    this.s0 = state[0] >>> 0;
    this.s1 = state[1] >>> 0;
    this.s2 = state[2] >>> 0;
    this.s3 = state[3] >>> 0;
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) {
      this.s0 = ZERO_STATE_REPLACEMENT[0];
      this.s1 = ZERO_STATE_REPLACEMENT[1];
      this.s2 = ZERO_STATE_REPLACEMENT[2];
      this.s3 = ZERO_STATE_REPLACEMENT[3];
    }
  }

  /** Generates the next uniform uint32. */
  nextUint32(): number {
    const s0 = this.s0;
    const s1 = this.s1;
    const s2 = this.s2;
    const s3 = this.s3;
    // result = rotl(s1 * 5, 7) * 9   (all arithmetic modulo 2^32)
    const result = Math.imul(rotl32(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    // Reference update order:
    //   t = s1 << 9; s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 11)
    const t = (s1 << 9) >>> 0;
    const n2 = (s2 ^ s0) >>> 0;
    const n3 = (s3 ^ s1) >>> 0;
    const n1 = (s1 ^ n2) >>> 0;
    const n0 = (s0 ^ n3) >>> 0;
    this.s0 = n0;
    this.s1 = n1;
    this.s2 = (n2 ^ t) >>> 0;
    this.s3 = rotl32(n3, 11);
    return result;
  }

  /** Generates the next uniform value in [0, 1). */
  next(): number {
    return this.nextUint32() * UINT32_TO_UNIT;
  }

  /** Independently copies this generator (state only). */
  clone(): Xoshiro128 {
    return new Xoshiro128([this.s0, this.s1, this.s2, this.s3]);
  }
}

/** Creates a Xoshiro128** state from a 64-bit seed. */
export function xoshiroStateFromSeed64(seed64: bigint): StreamState {
  return expandState128(seed64);
}
