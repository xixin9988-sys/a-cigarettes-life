// =============================================================================
// CausalTrace: bounded decision graph for debugging cause chains.
//
// Every recorded decision becomes a node that can point at the decision that
// caused it and/or at the world event that triggered it. Nodes are stored in a
// FIFO ring so memory stays bounded; only the monotonically increasing counter
// is persisted (as `ProbabilityPersistState.traceCounter`), which is enough to
// keep ids globally unique across save/load while the graph itself is runtime
// diagnostics rebuilt from live decisions.
// =============================================================================
import { WORLD_CONFIG } from '../core/WorldConfig';

/** Input for recording one decision node. */
export interface CausalTraceInput {
  decisionId: string;
  decisionType: string;
  streamId: string;
  selectedOptionId: string | null;
  timestamp: number;
  parentDecisionId?: string | null;
  sourceEventId?: string | null;
}

/** One node of the decision cause graph. */
export interface CausalTraceNode {
  nodeId: string;
  decisionId: string;
  decisionType: string;
  streamId: string;
  parentDecisionId: string | null;
  sourceEventId: string | null;
  selectedOptionId: string | null;
  timestamp: number;
}

const MAX_CHAIN_DEPTH = 64;

export class CausalTrace {
  /** Maximum number of retained nodes. */
  readonly limit: number;

  private readonly nodes = new Map<string, CausalTraceNode>();
  private readonly order: (string | undefined)[];
  private head = 0;
  private count = 0;
  private counterValue = 0;

  constructor(limit: number = WORLD_CONFIG.probability.historyLimit) {
    const fallback = WORLD_CONFIG.probability.historyLimit;
    const requested = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : fallback;
    this.limit = Math.max(1, requested);
    this.order = new Array<string | undefined>(this.limit);
  }

  /** Monotonic node counter (persisted as traceCounter). */
  get counter(): number {
    return this.counterValue;
  }

  get size(): number {
    return this.count;
  }

  /** Records a decision node and returns it. */
  record(input: CausalTraceInput): CausalTraceNode {
    this.counterValue += 1;
    const node: CausalTraceNode = {
      nodeId: `trace_${this.counterValue}`,
      decisionId: input.decisionId,
      decisionType: typeof input.decisionType === 'string' ? input.decisionType : '',
      streamId: typeof input.streamId === 'string' ? input.streamId : '',
      parentDecisionId: typeof input.parentDecisionId === 'string' ? input.parentDecisionId : null,
      sourceEventId: typeof input.sourceEventId === 'string' ? input.sourceEventId : null,
      selectedOptionId: typeof input.selectedOptionId === 'string' ? input.selectedOptionId : null,
      timestamp:
        typeof input.timestamp === 'number' && Number.isFinite(input.timestamp) ? input.timestamp : 0,
    };

    if (this.count === this.limit) {
      const evictedId = this.order[this.head];
      if (typeof evictedId === 'string') this.nodes.delete(evictedId);
      this.order[this.head] = node.decisionId;
      this.head = (this.head + 1) % this.limit;
    } else {
      const tail = (this.head + this.count) % this.limit;
      this.order[tail] = node.decisionId;
      this.count += 1;
    }
    this.nodes.set(node.decisionId, node);
    return node;
  }

  /** Looks a node up by decision id. */
  get(decisionId: string): CausalTraceNode | undefined {
    return this.nodes.get(decisionId);
  }

  /** Direct children of a decision (linear scan; debugging only). */
  children(decisionId: string): CausalTraceNode[] {
    const result: CausalTraceNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.parentDecisionId === decisionId) result.push(node);
    }
    return result;
  }

  /**
   * Full cause chain from the earliest reachable ancestor to `decisionId`
   * (empty when the node is unknown). Cycles are cut defensively.
   */
  chain(decisionId: string): CausalTraceNode[] {
    const chain: CausalTraceNode[] = [];
    const visited = new Set<string>();
    let currentId: string | null = decisionId;
    while (currentId !== null && chain.length < MAX_CHAIN_DEPTH) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const node = this.nodes.get(currentId);
      if (!node) break;
      chain.push(node);
      currentId = node.parentDecisionId;
    }
    return chain.reverse();
  }

  /** Nodes without a recorded parent (roots of cause chains), oldest first. */
  roots(limit = 100): CausalTraceNode[] {
    const result: CausalTraceNode[] = [];
    for (let i = 0; i < this.count; i += 1) {
      const decisionId = this.order[(this.head + i) % this.limit];
      if (typeof decisionId !== 'string') continue;
      const node = this.nodes.get(decisionId);
      if (!node) continue;
      if (node.parentDecisionId === null || !this.nodes.has(node.parentDecisionId)) {
        result.push(node);
        if (result.length >= limit) break;
      }
    }
    return result;
  }

  /** All retained nodes, oldest first. */
  toArray(): CausalTraceNode[] {
    const result: CausalTraceNode[] = [];
    for (let i = 0; i < this.count; i += 1) {
      const decisionId = this.order[(this.head + i) % this.limit];
      if (typeof decisionId !== 'string') continue;
      const node = this.nodes.get(decisionId);
      if (node) result.push(node);
    }
    return result;
  }

  /** Restores the persisted monotonic counter (ids stay unique after loading). */
  setCounter(value: number): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      this.counterValue = 0;
      return;
    }
    this.counterValue = Math.floor(value);
  }

  /** Clears retained nodes but keeps the counter (so ids never repeat). */
  clear(): void {
    this.nodes.clear();
    this.order.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  /** Clears nodes and resets the counter (used by `init` with a fresh seed). */
  reset(): void {
    this.clear();
    this.counterValue = 0;
  }
}
