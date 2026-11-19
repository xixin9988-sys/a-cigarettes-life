// =============================================================================
// ProbabilityHistory: bounded ring buffer of decision records.
//
// Persistence contract: `ProbabilityPersistState.history` is a plain array. The
// buffer exports records oldest-first (a chronological log) and reads them back
// in the same order. `getHistory(limit)` returns newest-first, which is what the
// debug panel / "recent decisions" views want.
// =============================================================================
import type { ProbabilityDecisionRecord } from '../core/contracts';
import { WORLD_CONFIG } from '../core/WorldConfig';
import type { DecisionFallback, ProbabilityDecisionRecordEx } from './types';

const EMPTY_CONTEXT = { worldId: '', lifeId: '', simulationTime: 0 } as const;

function normalizeFallback(value: unknown): DecisionFallback {
  if (value === 'uniform-eligible' || value === 'first-candidate') return value;
  return 'none';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Converts a persisted contract record into the engine's extended record,
 * defensively filling optional diagnostic fields (older saves lack them).
 */
export function toDecisionRecordEx(record: ProbabilityDecisionRecord): ProbabilityDecisionRecordEx | null {
  if (!record || typeof record !== 'object') return null;
  if (typeof record.decisionId !== 'string' || record.decisionId.length === 0) return null;
  const candidates = Array.isArray(record.candidates) ? record.candidates : [];
  const extended = record as Partial<ProbabilityDecisionRecordEx>;
  return {
    decisionId: record.decisionId,
    streamId: typeof record.streamId === 'string' ? record.streamId : '',
    decisionType: typeof record.decisionType === 'string' ? record.decisionType : '',
    context: record.context && typeof record.context === 'object' ? record.context : { ...EMPTY_CONTEXT },
    candidates,
    selectedOptionId: typeof record.selectedOptionId === 'string' ? record.selectedOptionId : null,
    timestamp: isFiniteNumber(record.timestamp) ? record.timestamp : 0,
    fallback: normalizeFallback(extended.fallback),
    parentDecisionId: typeof extended.parentDecisionId === 'string' ? extended.parentDecisionId : null,
    sourceEventId: typeof extended.sourceEventId === 'string' ? extended.sourceEventId : null,
  };
}

export class ProbabilityHistory {
  /** Maximum number of retained records. */
  readonly limit: number;

  private readonly slots: (ProbabilityDecisionRecordEx | undefined)[];
  private readonly byId = new Map<string, ProbabilityDecisionRecordEx>();
  private head = 0;
  private count = 0;

  constructor(limit: number = WORLD_CONFIG.probability.historyLimit) {
    const fallback = WORLD_CONFIG.probability.historyLimit;
    const requested = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : fallback;
    this.limit = Math.max(1, requested);
    this.slots = new Array<ProbabilityDecisionRecordEx | undefined>(this.limit);
  }

  get size(): number {
    return this.count;
  }

  /** Appends a record, evicting the oldest one when full. O(1). */
  push(record: ProbabilityDecisionRecordEx): void {
    if (!record || typeof record.decisionId !== 'string' || record.decisionId.length === 0) return;
    if (this.count === this.limit) {
      const evicted = this.slots[this.head];
      if (evicted) this.byId.delete(evicted.decisionId);
      this.slots[this.head] = record;
      this.head = (this.head + 1) % this.limit;
    } else {
      const tail = (this.head + this.count) % this.limit;
      this.slots[tail] = record;
      this.count += 1;
    }
    this.byId.set(record.decisionId, record);
  }

  /** Returns up to `limit` records, newest first. */
  latest(limit: number = this.count): ProbabilityDecisionRecordEx[] {
    const requested = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : this.count;
    const wanted = Math.max(0, Math.min(this.count, requested));
    const result: ProbabilityDecisionRecordEx[] = [];
    for (let i = 0; i < wanted; i += 1) {
      const index = (this.head + this.count - 1 - i + this.limit) % this.limit;
      const record = this.slots[index];
      if (record) result.push(record);
    }
    return result;
  }

  /** Returns every retained record, oldest first (persistence order). */
  chronological(): ProbabilityDecisionRecordEx[] {
    const result: ProbabilityDecisionRecordEx[] = [];
    for (let i = 0; i < this.count; i += 1) {
      const record = this.slots[(this.head + i) % this.limit];
      if (record) result.push(record);
    }
    return result;
  }

  get(decisionId: string): ProbabilityDecisionRecordEx | undefined {
    return this.byId.get(decisionId);
  }

  has(decisionId: string): boolean {
    return this.byId.has(decisionId);
  }

  clear(): void {
    this.slots.fill(undefined);
    this.byId.clear();
    this.head = 0;
    this.count = 0;
  }

  /**
   * Loads persisted records (oldest first). Malformed records are skipped.
   * Returns the number of records loaded.
   */
  load(records: readonly ProbabilityDecisionRecord[]): number {
    this.clear();
    if (!Array.isArray(records)) return 0;
    let loaded = 0;
    for (const record of records) {
      const extended = toDecisionRecordEx(record);
      if (!extended) continue;
      this.push(extended);
      loaded += 1;
    }
    return loaded;
  }
}
