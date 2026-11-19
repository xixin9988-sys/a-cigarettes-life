// =============================================================================
// SeedManager: deterministic derivation of independent random streams from a
// single life seed.
//
// Derivation is a pure function of (lifeSeed, streamId, attempt):
//   seed64   = ieee754 bits of lifeSeed
//   idHash   = splitmix64-whitened FNV-1a 64 of the stream id
//   mixed    = splitmix64(seed64 XOR idHash XOR attempt * goldenGamma).value
//   state    = splitmix64 128-bit expansion of mixed
//
// Consequences relied upon across the game:
//   - same life seed + same stream id => identical stream state everywhere,
//   - different stream ids => statistically independent streams,
//   - adding / removing draws or streams never perturbs another stream,
//   - `attempt` allows an explicit retry when a stream id must be re-derived.
// =============================================================================
import type { StreamState } from './types';
import {
  GOLDEN_GAMMA_64,
  expandState128,
  hashString64,
  normalizeState,
  numberToSeed64,
  splitMix64Next,
  toUint64,
} from './RandomProvider';

/**
 * Bumped whenever the derivation function changes. Persisted stream states are
 * authoritative across saves, so bumping this does not corrupt old saves - it is
 * used by tests/tooling to detect behaviour drift.
 */
export const STREAM_DERIVATION_VERSION = 1;

/** Normalises a life seed: non-finite / non-numeric values fall back to 0. */
export function normalizeLifeSeed(seed: number): number {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return 0;
  return seed + 0;
}

/** Clamps a derivation attempt counter to a safe uint32. */
function normalizeAttempt(attempt: number): number {
  if (typeof attempt !== 'number' || !Number.isFinite(attempt)) return 0;
  return Math.max(0, Math.min(0xffffffff, Math.floor(attempt)));
}

/**
 * Derives the 64-bit seed for one stream. Pure and allocation-light (a few
 * BigInt operations, only used when a stream is created or for debug tooling).
 */
export function deriveStreamSeed64(lifeSeed: number, streamId: string, attempt = 0): bigint {
  const seed64 = numberToSeed64(normalizeLifeSeed(lifeSeed));
  const idHash = hashString64(typeof streamId === 'string' ? streamId : String(streamId));
  const attemptSalt = toUint64(BigInt(normalizeAttempt(attempt)) * GOLDEN_GAMMA_64);
  const mixed = toUint64(seed64 ^ idHash ^ attemptSalt);
  return splitMix64Next(mixed).value;
}

/** Derives the complete 128-bit Xoshiro128** state for a stream. */
export function deriveStreamState(lifeSeed: number, streamId: string, attempt = 0): StreamState {
  return expandState128(deriveStreamSeed64(lifeSeed, streamId, attempt));
}

/** Derives states for a batch of stream ids (insertion-ordered record). */
export function deriveStreamStates(
  lifeSeed: number,
  streamIds: readonly string[]
): Record<string, StreamState> {
  const result: Record<string, StreamState> = {};
  for (const streamId of streamIds) {
    if (typeof streamId !== 'string' || streamId.length === 0) continue;
    result[streamId] = deriveStreamState(lifeSeed, streamId);
  }
  return result;
}

/**
 * Validates persisted stream data (`number[]` from a save file) and converts it
 * to a canonical state. Returns null for malformed input; all-zero states are
 * repaired to a fixed non-zero state.
 */
export function validateStreamState(values: readonly number[] | null | undefined): StreamState | null {
  return normalizeState(values);
}

/** True when two stream states are bit-identical. */
export function streamStatesEqual(a: StreamState, b: StreamState): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** 32 hex character fingerprint of a stream state (debug / save diffing). */
export function streamStateSignature(state: StreamState): string {
  return state.map((word) => (word >>> 0).toString(16).padStart(8, '0')).join('');
}
