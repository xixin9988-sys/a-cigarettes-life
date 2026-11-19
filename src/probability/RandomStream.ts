// =============================================================================
// RandomStream: one named, independently persisted deterministic random stream.
//
// A stream owns exactly four uint32 state words (save-game format: number[4])
// plus a runtime-only draw counter used by the F12 debug panel. Every game
// system names its own stream id; streams never share state, so adding a draw in
// one system cannot perturb another system's sequence.
// =============================================================================
import type { StreamState } from './types';
import { UINT32_TO_UNIT, Xoshiro128, normalizeState, serializeState } from './RandomProvider';
import { deriveStreamState, normalizeLifeSeed } from './SeedManager';

/** Structural interface consumed by samplers so tests can pass a stub source. */
export interface RandomSource {
  next(): number;
}

/** Snapshot of a stream for debug tooling. */
export interface RandomStreamSnapshot {
  id: string;
  state: StreamState;
  draws: number;
}

export class RandomStream {
  readonly id: string;
  private readonly generator: Xoshiro128;
  private drawCount = 0;

  constructor(id: string, state: StreamState) {
    this.id = typeof id === 'string' ? id : String(id);
    this.generator = new Xoshiro128(state);
  }

  /** Creates a stream derived from (lifeSeed, streamId), as the engine does. */
  static derived(lifeSeed: number, streamId: string): RandomStream {
    const seed = normalizeLifeSeed(lifeSeed);
    return new RandomStream(streamId, deriveStreamState(seed, streamId));
  }

  /**
   * Restores a stream from persisted `number[]` data. Returns null when the
   * data is malformed (the caller then re-derives the stream from the seed).
   */
  static fromPersisted(streamId: string, values: readonly number[] | null | undefined): RandomStream | null {
    const state = normalizeState(values);
    if (!state) return null;
    return new RandomStream(streamId, state);
  }

  /** Current 4x uint32 state (fresh array; safe to store). */
  get state(): StreamState {
    return this.generator.state;
  }

  /** Number of random values consumed since creation/import (runtime only). */
  get draws(): number {
    return this.drawCount;
  }

  /** Next uniform uint32 (counts as one draw). */
  nextUint32(): number {
    this.drawCount += 1;
    return this.generator.nextUint32();
  }

  /** Next uniform value in [0, 1) (counts as one draw). */
  next(): number {
    this.drawCount += 1;
    return this.generator.nextUint32() * UINT32_TO_UNIT;
  }

  /** Serialises the state for `ProbabilityPersistState.streams`. */
  exportState(): number[] {
    return serializeState(this.generator.state);
  }

  /**
   * Restores the state from persisted data. Draw counters are runtime-only and
   * reset to zero (they are not part of the frozen persistence contract).
   * Returns false when the input is malformed.
   */
  importState(values: readonly number[]): boolean {
    const state = normalizeState(values);
    if (!state) return false;
    this.generator.setState(state);
    this.drawCount = 0;
    return true;
  }

  /** Resets the runtime draw counter (used when a save is loaded). */
  resetDrawCount(): void {
    this.drawCount = 0;
  }

  /** Exact independent copy: same state, same draw count, no shared references. */
  clone(): RandomStream {
    const copy = new RandomStream(this.id, this.generator.state);
    copy.drawCount = this.drawCount;
    return copy;
  }

  /** Debug snapshot. */
  snapshot(): RandomStreamSnapshot {
    return { id: this.id, state: this.generator.state, draws: this.drawCount };
  }
}
