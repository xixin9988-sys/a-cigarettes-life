// =============================================================================
// ProbabilityEngine: the single deterministic probability facility of the game.
//
// Implements `IProbabilityEngine` from src/core/contracts.d.ts exactly, plus a
// small set of documented diagnostics/integration helpers (see the final report):
//   - `distributions`: registry of static weighted tables,
//   - `causalTrace`: decision cause graph,
//   - `setNextCause()`: attach parent-event/decision metadata to the next
//     `decide()` call (the frozen ProbabilityRequest has no field for it),
//   - `sampleDistribution()`: sample a registered static distribution,
//   - `previewDecision()`: weight/eligibility preview without drawing,
//   - `getHistoryDetailed()` / `getStatsForAllStreams()` / `createDebugger()`.
//
// Determinism: all randomness comes from named `RandomStream` instances seeded
// from (lifeSeed, streamId). No unseeded entropy, no wall-clock time in decisions.
// =============================================================================
import type {
  ConditionExpr,
  EvaluatedCandidate,
  ILogger,
  IProbabilityEngine,
  ProbabilityContext,
  ProbabilityDecisionRecord,
  ProbabilityPersistState,
  ProbabilityRequest,
  ProbabilityStreamStats,
} from '../core/contracts';
import { WORLD_CONFIG } from '../core/WorldConfig';
import type { StreamState } from './types';
import {
  KNOWN_STREAM_IDS,
  PROBABILITY_STATE_VERSION,
  formatDecisionId,
  parseDecisionIdCounter,
  type DecisionCause,
  type DecisionFallback,
  type ProbabilityDecisionEx,
  type ProbabilityDecisionRecordEx,
  type ProbabilityEngineOptions,
} from './types';
import { RandomStream } from './RandomStream';
import { deriveStreamState, normalizeLifeSeed, validateStreamState } from './SeedManager';
import {
  calculateCandidates,
  PrefixSumSampler,
  resolveWeightBounds,
  uniformIndex,
  type CandidateCalculation,
} from './ProbabilityCalculator';
import { evaluateConditions } from './ConditionEvaluator';
import { ProbabilityHistory } from './ProbabilityHistory';
import { CausalTrace } from './CausalTrace';
import { ProbabilityRegistry } from './ProbabilityRegistry';
import { ProbabilityDebugger } from './ProbabilityDebugger';

const SILENT_LOGGER: ILogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface PendingCause {
  parentDecisionId: string | null;
  sourceEventId: string | null;
}

/** Result of a non-drawing decision preview (mirrors decide() without recording). */
export interface DecisionPreview {
  candidates: EvaluatedCandidate[];
  totalWeight: number;
  eligibleCount: number;
  fallback: DecisionFallback;
  warnings: string[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Deep copy of a decision context (JSON state by contract), best effort. */
function snapshotContext(context: ProbabilityContext | undefined): ProbabilityContext {
  if (!context || typeof context !== 'object') {
    return { worldId: '', lifeId: '', simulationTime: 0 };
  }
  try {
    return JSON.parse(JSON.stringify(context)) as ProbabilityContext;
  } catch {
    try {
      return { ...context };
    } catch {
      return { worldId: '', lifeId: '', simulationTime: 0 };
    }
  }
}

function cloneEvaluatedCandidate(candidate: EvaluatedCandidate): EvaluatedCandidate {
  return {
    id: candidate.id,
    baseWeight: candidate.baseWeight,
    finalWeight: candidate.finalWeight,
    probability: candidate.probability,
    modifiers: candidate.modifiers.map((modifier) => ({ ...modifier })),
    eligible: candidate.eligible,
    rejectionReason: candidate.rejectionReason,
  };
}

/** Extracts the numeric counter of the newest decision id in a record list. */
function highestDecisionCounter(records: readonly ProbabilityDecisionRecord[]): number {
  let highest = 0;
  for (const record of records) {
    const counter = parseDecisionIdCounter(record.decisionId);
    if (counter > highest) highest = counter;
  }
  return highest;
}

export class ProbabilityEngine implements IProbabilityEngine {
  private currentSeed: number;
  private readonly streams = new Map<string, RandomStream>();
  private readonly streamDecisionCounts = new Map<string, number>();
  private readonly streamLastValues = new Map<string, number>();
  private readonly history: ProbabilityHistory;
  private readonly traceLog: CausalTrace;
  private readonly logger: ILogger;
  private readonly registry = new ProbabilityRegistry();
  private decisionCount = 0;
  private pendingCause: PendingCause | null = null;

  constructor(options: ProbabilityEngineOptions = {}) {
    this.currentSeed = 0;
    this.logger = options.logger ?? SILENT_LOGGER;
    const historyLimit = options.historyLimit ?? WORLD_CONFIG.probability.historyLimit;
    this.history = new ProbabilityHistory(historyLimit);
    this.traceLog = new CausalTrace(options.traceLimit ?? historyLimit);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle / persistence
  // ---------------------------------------------------------------------------

  get seed(): number {
    return this.currentSeed;
  }

  /**
   * (Re)initialises the engine for a life. When `persisted` is supplied every
   * stream state, the decision history and the counters are restored, so the
   * exact random sequence continues after loading a save.
   */
  init(seed: number, persisted?: ProbabilityPersistState): void {
    this.currentSeed = normalizeLifeSeed(seed);
    this.resetRuntimeState();
    if (persisted) this.loadPersisted(persisted, false);
  }

  /** Replaces the complete probability runtime state (save-game load). */
  importState(state: ProbabilityPersistState): void {
    if (!state || typeof state !== 'object') return;
    this.resetRuntimeState();
    this.loadPersisted(state, true);
  }

  /** Serialises everything the save game needs. */
  exportState(): ProbabilityPersistState {
    const streams: Record<string, number[]> = {};
    for (const [streamId, stream] of this.streams) {
      streams[streamId] = stream.exportState();
    }
    return {
      version: PROBABILITY_STATE_VERSION,
      seed: this.currentSeed,
      streams,
      decisionCount: this.decisionCount,
      // Chronological order; extended records are structurally valid contract records.
      history: this.history.chronological(),
      traceCounter: this.traceLog.counter,
    };
  }

  private resetRuntimeState(): void {
    this.streams.clear();
    this.streamDecisionCounts.clear();
    this.streamLastValues.clear();
    this.history.clear();
    this.traceLog.clear();
    this.traceLog.setCounter(0);
    this.decisionCount = 0;
    this.pendingCause = null;
  }

  private loadPersisted(state: ProbabilityPersistState, replaceSeed: boolean): void {
    if (!state || typeof state !== 'object') return;

    if (isFiniteNumber(state.seed)) {
      const persistedSeed = normalizeLifeSeed(state.seed);
      if (replaceSeed) this.currentSeed = persistedSeed;
      else if (persistedSeed !== this.currentSeed) {
        this.logger.warn('probability: persisted seed differs from init seed; keeping init seed', {
          seed: this.currentSeed,
          persistedSeed,
        });
      }
    }

    const streamStates = state.streams;
    if (streamStates && typeof streamStates === 'object') {
      for (const streamId of Object.keys(streamStates)) {
        const values = streamStates[streamId];
        const stream = RandomStream.fromPersisted(streamId, values);
        if (stream) this.streams.set(streamId, stream);
        else this.logger.warn('probability: ignoring malformed persisted stream state', { streamId });
      }
    }

    const records = Array.isArray(state.history) ? state.history : [];
    this.history.load(records);

    const persistedDecisionCount = isFiniteNumber(state.decisionCount)
      ? Math.max(0, Math.floor(state.decisionCount))
      : 0;
    // Guarantee unique decision ids even if decisionCount in the save is stale.
    this.decisionCount = Math.max(persistedDecisionCount, highestDecisionCounter(records));

    const traceCounter = isFiniteNumber(state.traceCounter) ? Math.max(0, Math.floor(state.traceCounter)) : 0;
    this.traceLog.setCounter(traceCounter);
  }

  // ---------------------------------------------------------------------------
  // Streams
  // ---------------------------------------------------------------------------

  /** Registers a stream derived from the life seed if not present. */
  ensureStream(streamId: string): void {
    this.ensureStreamInstance(streamId);
  }

  hasStream(streamId: string): boolean {
    return this.streams.has(streamId);
  }

  listStreams(): string[] {
    return [...this.streams.keys()];
  }

  private ensureStreamInstance(streamId: string): RandomStream {
    const key = typeof streamId === 'string' ? streamId : String(streamId);
    const existing = this.streams.get(key);
    if (existing) return existing;
    const created = new RandomStream(key, deriveStreamState(this.currentSeed, key));
    this.streams.set(key, created);
    return created;
  }

  /** Central draw path: every intake also updates the per-stream debug stats. */
  private draw(streamId: string): number {
    const stream = this.ensureStreamInstance(streamId);
    const value = stream.next();
    this.streamLastValues.set(stream.id, value);
    return value;
  }

  // ---------------------------------------------------------------------------
  // Primitive draws
  // ---------------------------------------------------------------------------

  /** Uniform value in [0, 1) from the named stream. */
  roll(streamId: string): number {
    return this.draw(streamId);
  }

  /** Uniform value in [min, max); the bounds are swapped when reversed. */
  floatRange(streamId: string, min: number, max: number): number {
    let low = isFiniteNumber(min) ? min : 0;
    let high = isFiniteNumber(max) ? max : 1;
    if (low > high) {
      const swap = low;
      low = high;
      high = swap;
    }
    return low + (high - low) * this.draw(streamId);
  }

  /** Uniform integer in [minInclusive, maxInclusive] (inclusive). */
  intRange(streamId: string, minInclusive: number, maxInclusive: number): number {
    let low = isFiniteNumber(minInclusive) ? Math.round(minInclusive) : 0;
    let high = isFiniteNumber(maxInclusive) ? Math.round(maxInclusive) : 0;
    if (low > high) {
      const swap = low;
      low = high;
      high = swap;
    }
    const span = high - low + 1;
    if (!Number.isFinite(span) || span <= 0) return low;
    const uniform = this.draw(streamId);
    const offset = Math.min(span - 1, Math.floor(uniform * span));
    return low + offset;
  }

  /** Bernoulli trial. p <= 0 / p >= 1 are certainties and consume no randomness. */
  chance(streamId: string, probability: number): boolean {
    const p = isFiniteNumber(probability) ? probability : 0;
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.draw(streamId) < p;
  }

  /** Weighted pick from an ad-hoc list. Returns null when nothing is selectable. */
  weighted<T>(streamId: string, candidates: readonly { weight: number; value: T }[]): T | null {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const values: { weight: number; value: T }[] = [];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      values.push({
        weight: isFiniteNumber(candidate.weight) && candidate.weight > 0 ? candidate.weight : 0,
        value: candidate.value,
      });
    }
    if (values.length === 0) return null;
    const sampler = new PrefixSumSampler(values.map((candidate) => candidate.weight));
    if (sampler.isEmpty) return null;
    const index = sampler.sampleIndex({ next: () => this.draw(streamId) });
    const picked = index >= 0 ? values[index] : undefined;
    return picked ? picked.value : null;
  }

  // ---------------------------------------------------------------------------
  // Decision API
  // ---------------------------------------------------------------------------

  /**
   * Full decision pipeline: condition filtering, modifier resolution, clamping,
   * normalisation, weighted selection, history + causal trace recording.
   * Never throws on bad weights; falls back deterministically and flags it.
   */
  decide<T>(request: ProbabilityRequest<T>): ProbabilityDecisionEx<T> {
    const streamId = typeof request.streamId === 'string' ? request.streamId : String(request.streamId);
    const candidates = Array.isArray(request.candidates) ? request.candidates : [];
    const context = request.context ?? { worldId: '', lifeId: '', simulationTime: 0 };
    this.ensureStream(streamId);

    const bounds = resolveWeightBounds(request.minWeight, request.maxWeight);
    const calculation = calculateCandidates(candidates, context, bounds);
    for (const warning of calculation.warnings) {
      this.logger.warn(`probability: ${warning}`, { streamId, decisionType: request.decisionType });
    }

    const evaluations = calculation.evaluations;
    const eligibleIndices: number[] = [];
    const weights: number[] = new Array(evaluations.length);
    for (let i = 0; i < evaluations.length; i += 1) {
      const evaluation = evaluations[i];
      const weight = evaluation && evaluation.eligible ? evaluation.finalWeight : 0;
      weights[i] = weight;
      if (evaluation && evaluation.eligible) eligibleIndices.push(i);
    }

    const probabilityOutcome = this.resolveFallbackProbabilities(
      evaluations,
      eligibleIndices,
      calculation.totalWeight
    );
    const totalWeight = probabilityOutcome.totalWeight;
    const fallback = probabilityOutcome.fallback;

    let selectedIndex: number | null = null;
    if (fallback === 'none') {
      const sampler = new PrefixSumSampler(weights);
      const index = sampler.sampleIndex({ next: () => this.draw(streamId) });
      selectedIndex = index >= 0 && index < evaluations.length ? index : null;
    } else if (fallback === 'uniform-eligible') {
      // Safe fallback #1: eligible candidates but all weights clamped to zero.
      // Pick one uniformly so the game can never soft-lock on bad weights.
      const chosen = uniformIndex({ next: () => this.draw(streamId) }, eligibleIndices.length);
      selectedIndex = chosen >= 0 ? (eligibleIndices[chosen] ?? null) : null;
    } else if (evaluations.length > 0) {
      // Safe fallback #2: no candidate passed its conditions. Pick the first
      // candidate deterministically so callers always get a result; the flag
      // lets debug tooling surface this content bug.
      selectedIndex = 0;
    }

    this.decisionCount += 1;
    const decisionId = formatDecisionId(this.decisionCount);
    const cause = this.pendingCause;
    this.pendingCause = null;
    const parentDecisionId = cause ? cause.parentDecisionId : null;
    const sourceEventId = cause ? cause.sourceEventId : null;
    const timestamp = isFiniteNumber(context.simulationTime) ? context.simulationTime : 0;
    const contextSnapshot = snapshotContext(context);
    const selectedOption = selectedIndex !== null ? candidates[selectedIndex] : undefined;
    const selectedOptionId = selectedOption ? selectedOption.id : null;

    // Private copies keep the recorded history immutable from caller mutation.
    const recordedCandidates = evaluations.map(cloneEvaluatedCandidate);
    const record: ProbabilityDecisionRecordEx = {
      decisionId,
      streamId,
      decisionType: typeof request.decisionType === 'string' ? request.decisionType : '',
      context: contextSnapshot,
      candidates: recordedCandidates,
      selectedOptionId,
      timestamp,
      fallback,
      parentDecisionId,
      sourceEventId,
    };
    this.history.push(record);
    this.traceLog.record({
      decisionId,
      decisionType: record.decisionType,
      streamId,
      selectedOptionId,
      timestamp,
      parentDecisionId,
      sourceEventId,
    });
    this.streamDecisionCounts.set(streamId, (this.streamDecisionCounts.get(streamId) ?? 0) + 1);
    if (fallback !== 'none') {
      this.logger.warn('probability: deterministic fallback selection', {
        decisionId,
        streamId,
        decisionType: record.decisionType,
        fallback,
        candidateCount: evaluations.length,
      });
    }

    return {
      decisionId,
      streamId,
      decisionType: record.decisionType,
      context: contextSnapshot,
      candidates: evaluations,
      selectedOptionId,
      selectedResult: selectedOption ? selectedOption.result : null,
      totalWeight,
      timestamp,
      fallback,
      parentDecisionId,
      sourceEventId,
    };
  }

  /**
   * Applies the deterministic fallback semantics and fills normalised
   * probabilities on the evaluated candidates. Shared by decide() and
   * previewDecision() so the F12 preview shows exactly what decide() would do.
   */
  private resolveFallbackProbabilities(
    evaluations: EvaluatedCandidate[],
    eligibleIndices: readonly number[],
    totalWeight: number
  ): { totalWeight: number; fallback: DecisionFallback } {
    if (totalWeight > 0) return { totalWeight, fallback: 'none' };
    if (eligibleIndices.length > 0) {
      const share = 1 / eligibleIndices.length;
      for (const index of eligibleIndices) {
        const evaluation = evaluations[index];
        if (evaluation) evaluation.probability = share;
      }
      return { totalWeight: 0, fallback: 'uniform-eligible' };
    }
    if (evaluations.length > 0) {
      const first = evaluations[0];
      if (first) first.probability = 1;
      return { totalWeight: 0, fallback: 'first-candidate' };
    }
    return { totalWeight: 0, fallback: 'none' };
  }

  /** Evaluates a decision shape without drawing, recording or mutating state. */
  previewDecision<T>(request: ProbabilityRequest<T>): DecisionPreview {
    const candidates = Array.isArray(request.candidates) ? request.candidates : [];
    const context = request.context ?? { worldId: '', lifeId: '', simulationTime: 0 };
    const bounds = resolveWeightBounds(request.minWeight, request.maxWeight);
    const calculation: CandidateCalculation<T> = calculateCandidates(candidates, context, bounds);
    const evaluations = calculation.evaluations;
    const eligibleIndices: number[] = [];
    for (let i = 0; i < evaluations.length; i += 1) {
      if (evaluations[i]?.eligible) eligibleIndices.push(i);
    }
    const outcome = this.resolveFallbackProbabilities(evaluations, eligibleIndices, calculation.totalWeight);
    return {
      candidates: evaluations.map(cloneEvaluatedCandidate),
      totalWeight: outcome.totalWeight,
      eligibleCount: calculation.eligibleCount,
      fallback: outcome.fallback,
      warnings: [...calculation.warnings],
    };
  }

  // ---------------------------------------------------------------------------
  // History / stats / replay
  // ---------------------------------------------------------------------------

  /** Recent decision records, newest first. */
  getHistory(limit?: number): ProbabilityDecisionRecord[] {
    return this.history.latest(limit);
  }

  /** Recent decision records with engine diagnostics (fallback / causal ids). */
  getHistoryDetailed(limit?: number): ProbabilityDecisionRecordEx[] {
    return this.history.latest(limit);
  }

  getHistoryForDecision(decisionId: string): ProbabilityDecisionRecord | undefined {
    return this.history.get(decisionId);
  }

  /** Returns the recorded decision (or null when it was evicted / unknown). */
  replayDecision(decisionId: string): ProbabilityDecisionRecord | null {
    return this.history.get(decisionId) ?? null;
  }

  getStats(streamId: string): ProbabilityStreamStats {
    const stream = this.streams.get(streamId);
    return {
      streamId,
      draws: stream ? stream.draws : 0,
      decisions: this.streamDecisionCounts.get(streamId) ?? 0,
      lastValue: this.streamLastValues.get(streamId) ?? 0,
    };
  }

  /** Stats for every registered stream (debug panel convenience). */
  getStatsForAllStreams(): ProbabilityStreamStats[] {
    return this.listStreams().map((streamId) => this.getStats(streamId));
  }

  evaluateConditions(conditions: readonly ConditionExpr[], context: ProbabilityContext): boolean {
    return evaluateConditions(conditions, context);
  }

  /**
   * Debug helper: draws `samples` from a scratch clone of the named stream and
   * returns per-option counts. Live stream state, stats, history and counters
   * are not touched.
   */
  simulate<T>(request: ProbabilityRequest<T>, samples: number): Record<string, number> {
    const counts: Record<string, number> = {};
    const candidates = Array.isArray(request.candidates) ? request.candidates : [];
    for (const candidate of candidates) {
      if (candidate && typeof candidate.id === 'string') counts[candidate.id] = 0;
    }
    const totalSamples = isFiniteNumber(samples) ? Math.max(0, Math.floor(samples)) : 0;
    if (totalSamples === 0 || candidates.length === 0) return counts;

    const context = request.context ?? { worldId: '', lifeId: '', simulationTime: 0 };
    const bounds = resolveWeightBounds(request.minWeight, request.maxWeight);
    const calculation = calculateCandidates(candidates, context, bounds);
    const evaluations = calculation.evaluations;

    const eligibleIndices: number[] = [];
    const weights: number[] = new Array(evaluations.length);
    for (let i = 0; i < evaluations.length; i += 1) {
      const evaluation = evaluations[i];
      weights[i] = evaluation && evaluation.eligible ? evaluation.finalWeight : 0;
      if (evaluation && evaluation.eligible) eligibleIndices.push(i);
    }

    const streamId = typeof request.streamId === 'string' ? request.streamId : String(request.streamId);
    const live = this.streams.get(streamId);
    const scratch = live
      ? live.clone()
      : new RandomStream(streamId, deriveStreamState(this.currentSeed, streamId));
    const source = { next: () => scratch.next() };

    const weightedSampler = calculation.totalWeight > 0 ? new PrefixSumSampler(weights) : null;
    for (let sample = 0; sample < totalSamples; sample += 1) {
      let index = -1;
      if (weightedSampler && !weightedSampler.isEmpty) {
        index = weightedSampler.sampleIndex(source);
      } else if (eligibleIndices.length > 0) {
        const chosen = uniformIndex(source, eligibleIndices.length);
        index = chosen >= 0 ? (eligibleIndices[chosen] ?? -1) : -1;
      } else {
        index = 0;
      }
      const evaluation = index >= 0 ? evaluations[index] : undefined;
      if (!evaluation) continue;
      counts[evaluation.id] = (counts[evaluation.id] ?? 0) + 1;
    }
    return counts;
  }

  // ---------------------------------------------------------------------------
  // Integration helpers beyond IProbabilityEngine (documented in the report)
  // ---------------------------------------------------------------------------

  /** Reusable static weighted distributions (weather tables, loot tables...). */
  get distributions(): ProbabilityRegistry {
    return this.registry;
  }

  /** Decision cause graph (bounded; diagnostics only). */
  get causalTrace(): CausalTrace {
    return this.traceLog;
  }

  /**
   * Attaches causal metadata to the next decide() call only. Systems building
   * event chains use this to link decisions back to the triggering event.
   */
  setNextCause(cause: DecisionCause | null): void {
    if (!cause) {
      this.pendingCause = null;
      return;
    }
    this.pendingCause = {
      parentDecisionId: typeof cause.parentDecisionId === 'string' ? cause.parentDecisionId : null,
      sourceEventId: typeof cause.sourceEventId === 'string' ? cause.sourceEventId : null,
    };
  }

  /**
   * Samples a registered static distribution using the named live stream.
   * Returns null (and consumes no randomness) for unknown/empty distributions.
   */
  sampleDistribution(streamId: string, distributionId: string): string | null {
    this.ensureStream(streamId);
    return this.registry.sample(distributionId, { next: () => this.draw(streamId) });
  }

  /** Re-derives a stream state from the current life seed (debug / replay aid). */
  deriveStreamState(streamId: string): StreamState {
    return deriveStreamState(this.currentSeed, streamId);
  }

  /** Validated persisted state words for one stream (debug / replay aid). */
  getStreamState(streamId: string): StreamState | undefined {
    const stream = this.streams.get(streamId);
    if (!stream) return undefined;
    return validateStreamState(stream.exportState()) ?? undefined;
  }

  /** Creates a debugger bound to this engine. */
  createDebugger(): ProbabilityDebugger {
    return new ProbabilityDebugger(this);
  }

  /** Known stream id catalogue (advisory; ensureStream accepts any string). */
  get knownStreamIds(): readonly string[] {
    return KNOWN_STREAM_IDS;
  }
}
