// Deterministic pseudo-random helpers for the procedural audio system.
// No Math.random(): every value comes from integer hashes, counters and seeds, so
// identical inputs always produce identical sound design decisions (and tests can
// assert exact values / reproducibility).

/** 32-bit integer avalanche mix (MurmurHash3-style finaliser). */
export function mix32(input: number): number {
  let value = input | 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

/** Deterministic unsigned 32-bit hash of an integer. */
export function hashInt32(value: number): number {
  return mix32(value);
}

/** Deterministic float in [0, 1). */
export function hashFloat01(value: number): number {
  return mix32(value) / 4294967296;
}

/** Mixes a base seed, an integer counter and an integer salt into a 32-bit hash. */
export function hashUnit(seed: number, counter: number, salt: number): number {
  const mixedCounter = Math.imul((counter | 0) + 1, 0x9e3779b1);
  const mixedSalt = Math.imul((salt | 0) + 1, 0x85ebca6b);
  return mix32(mix32((seed | 0) ^ mixedCounter) ^ mixedSalt);
}

/** Deterministic float in [0, 1) from seed + counter + salt. */
export function unitFloat(seed: number, counter: number, salt: number): number {
  return hashUnit(seed, counter, salt) / 4294967296;
}

/** FNV-1a hash of a string, used to derive stable seeds from plan / sound ids. */
export function hashStringToSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return mix32(hash);
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

/**
 * Frame-rate independent exponential approach toward a target.
 * Used for smooth audio gain crossfades; larger time constants are slower/smoother.
 */
export function approach(current: number, target: number, deltaSeconds: number, timeConstantSeconds: number): number {
  if (deltaSeconds <= 0 || timeConstantSeconds <= 0) return target;
  const alpha = 1 - Math.exp(-deltaSeconds / timeConstantSeconds);
  return current + (target - current) * clamp01(alpha);
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const span = edge1 - edge0;
  const t = clamp01(span === 0 ? (value >= edge1 ? 1 : 0) : (value - edge0) / span);
  return t * t * (3 - 2 * t);
}

/** Deterministic index in [0, length) from a seed + counter. */
export function pickIndex(seed: number, counter: number, length: number): number {
  if (length <= 0) return 0;
  return hashUnit(seed, counter, 0) % length;
}
