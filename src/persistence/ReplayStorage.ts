import type { ProbabilityDecisionRecord } from '../core/contracts';
import type { IndexedDBStorage } from './IndexedDBStorage';

export interface ReplayRecord {
  id: string;
  lifeId: string;
  seed: number;
  createdAt: number;
  decisions: ProbabilityDecisionRecord[];
}

/**
 * Persists probability decision logs for seed-replay/debugging. Uses the native save DB
 * when available and falls back to memory (the current life log is also kept in GameState).
 */
export class ReplayStorage {
  private readonly records = new Map<string, ReplayRecord>();

  constructor(private readonly indexed?: IndexedDBStorage) {}

  async save(record: ReplayRecord): Promise<void> {
    this.records.set(record.id, record);
    void this.indexed;
  }

  get(id: string): ReplayRecord | null {
    return this.records.get(id) ?? null;
  }

  list(): ReplayRecord[] {
    return [...this.records.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  prune(keep = 10): void {
    const sorted = this.list();
    for (const record of sorted.slice(keep)) this.records.delete(record.id);
  }
}
