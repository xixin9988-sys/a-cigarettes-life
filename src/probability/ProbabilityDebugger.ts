// =============================================================================
// ProbabilityDebugger: statistics and inspection helpers for the F12 probability
// panel. Everything here is read-only except for scratch streams created from a
// seed, which never touch the live engine.
//
// Provides: per-stream draw/decision summaries, chi-square goodness-of-fit,
// draw histograms (heatmap-ready), seed comparison (first divergence), decision
// selection heatmaps and record validation / anomaly detection.
// =============================================================================
import type { ProbabilityDecisionRecord, ProbabilityStreamStats } from '../core/contracts';
import { RandomStream } from './RandomStream';
import { deriveStreamState } from './SeedManager';
import { numberToSeed64 } from './RandomProvider';
import { toDecisionRecordEx } from './ProbabilityHistory';
import { KNOWN_STREAM_IDS, type ProbabilityDecisionRecordEx } from './types';

/** The subset of engine behaviour the debugger needs (engine satisfies it). */
export interface DebugEnginePort {
  readonly seed: number;
  hasStream(streamId: string): boolean;
  listStreams(): string[];
  getStats(streamId: string): ProbabilityStreamStats;
  getHistory(limit?: number): ProbabilityDecisionRecord[];
  getHistoryForDecision?(decisionId: string): ProbabilityDecisionRecord | undefined;
}

export interface StreamDebugSummary {
  streamId: string;
  draws: number;
  decisions: number;
  lastValue: number;
  known: boolean;
}

export interface EngineDebugSummary {
  seed: number;
  seedHex: string;
  streamCount: number;
  totalDraws: number;
  totalDecisions: number;
  historySize: number;
  streams: StreamDebugSummary[];
}

export interface HistogramBucket {
  /** Inclusive lower bound. */
  start: number;
  /** Exclusive upper bound (1 for the last bucket). */
  end: number;
  count: number;
  probability: number;
}

export interface ChiSquareResult {
  statistic: number;
  degreesOfFreedom: number;
  pValue: number;
  acceptable: boolean;
  observedTotal: number;
  expectedTotal: number;
  note: string;
}

export interface SeedDivergence {
  streamId: string;
  /** Number of identical draws before the first difference, or null if identical. */
  firstDivergenceIndex: number | null;
  valueA: number | null;
  valueB: number | null;
  samples: number;
}

export interface SeedComparisonResult {
  seedA: number;
  seedB: number;
  samples: number;
  identicalStreams: string[];
  divergentStreams: SeedDivergence[];
}

export interface HeatmapCell {
  candidateId: string;
  selectedCount: number;
  total: number;
  observedRate: number;
  expectedProbability: number;
  deviation: number;
}

export interface HeatmapRow {
  decisionType: string;
  decisions: number;
  cells: HeatmapCell[];
}

export interface DecisionValidation {
  decisionId: string;
  valid: boolean;
  issues: string[];
}

export interface ReplayInspection {
  found: boolean;
  record: ProbabilityDecisionRecordEx | null;
  validation: DecisionValidation | null;
}

export interface ProbabilityDebuggerOptions {
  /** p-value threshold below which a distribution is flagged. Default 0.01. */
  acceptablePValue?: number;
}

// =============================================================================
// Chi-square / incomplete gamma maths
// =============================================================================

const LANCZOS_COEFFICIENTS: readonly number[] = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Lanczos approximation of ln(Gamma(x)) for x > 0. */
export function logGamma(value: number): number {
  if (!(value > 0)) return Number.NaN;
  if (value < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  const z = value - 1;
  let sum = LANCZOS_COEFFICIENTS[0] ?? 0;
  for (let i = 1; i < LANCZOS_COEFFICIENTS.length; i += 1) {
    sum += (LANCZOS_COEFFICIENTS[i] ?? 0) / (z + i);
  }
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** Regularised lower incomplete gamma P(a, x) via series expansion. */
function regularizedGammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  let ap = a;
  let sum = 1 / a;
  let term = sum;
  for (let n = 1; n < 300; n += 1) {
    ap += 1;
    term *= x / ap;
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

/** Regularised upper incomplete gamma Q(a, x) via continued fraction. */
function regularizedGammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - regularizedGammaP(a, x);
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 300; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** p-value of a chi-square statistic: P(X >= statistic | df). */
export function chiSquarePValue(statistic: number, degreesOfFreedom: number): number {
  if (!Number.isFinite(degreesOfFreedom) || degreesOfFreedom <= 0) return Number.NaN;
  if (!Number.isFinite(statistic)) return 0;
  if (statistic <= 0) return 1;
  const p = regularizedGammaQ(degreesOfFreedom / 2, statistic / 2);
  if (!Number.isFinite(p)) return Number.NaN;
  return Math.min(1, Math.max(0, p));
}

/**
 * Chi-square goodness-of-fit test between observed counts and expected
 * probabilities (probabilities are scaled by the observed total).
 */
export function chiSquareTest(
  observed: Readonly<Record<string, number>>,
  expectedProbabilities: Readonly<Record<string, number>>,
  acceptablePValue = 0.01
): ChiSquareResult {
  const observedKeys = Object.keys(observed);
  const expectedKeys = Object.keys(expectedProbabilities);
  const keys = [...new Set([...observedKeys, ...expectedKeys])];
  let observedTotal = 0;
  for (const key of keys) {
    const count = observed[key] ?? 0;
    observedTotal += Number.isFinite(count) && count > 0 ? count : 0;
  }
  const degreesOfFreedom = Math.max(1, keys.length - 1);
  const notes: string[] = [];

  if (keys.length === 0 || observedTotal <= 0) {
    return {
      statistic: 0,
      degreesOfFreedom,
      pValue: 1,
      acceptable: true,
      observedTotal: 0,
      expectedTotal: 0,
      note: 'no observations',
    };
  }

  let expectedTotal = 0;
  for (const key of keys) {
    const probability = expectedProbabilities[key] ?? 0;
    if (Number.isFinite(probability) && probability > 0) expectedTotal += probability;
  }
  if (expectedTotal <= 0) {
    return {
      statistic: Number.POSITIVE_INFINITY,
      degreesOfFreedom,
      pValue: 0,
      acceptable: false,
      observedTotal,
      expectedTotal: 0,
      note: 'expected probabilities sum to zero',
    };
  }

  let statistic = 0;
  let lowExpectedCells = 0;
  let impossibleCells = 0;
  for (const key of keys) {
    const probability = Math.max(
      0,
      Number.isFinite(expectedProbabilities[key] ?? 0) ? (expectedProbabilities[key] ?? 0) : 0
    );
    const expectedCount = (probability / expectedTotal) * observedTotal;
    const observedCount = Math.max(0, observed[key] ?? 0);
    if (expectedCount < 5) lowExpectedCells += 1;
    if (expectedCount <= 0) {
      if (observedCount > 0) {
        impossibleCells += 1;
        statistic = Number.POSITIVE_INFINITY;
      }
      continue;
    }
    const difference = observedCount - expectedCount;
    statistic += (difference * difference) / expectedCount;
  }

  if (impossibleCells > 0) notes.push(`${impossibleCells} observed outcome(s) had zero expected probability`);
  if (lowExpectedCells > 0)
    notes.push(`${lowExpectedCells} cell(s) with expected count < 5 (approximation may be rough)`);

  const pValue = chiSquarePValue(statistic, degreesOfFreedom);
  const acceptable = Number.isFinite(pValue) && pValue >= acceptablePValue;
  return {
    statistic,
    degreesOfFreedom,
    pValue,
    acceptable,
    observedTotal,
    expectedTotal,
    note: notes.length > 0 ? notes.join('; ') : 'ok',
  };
}

// =============================================================================
// Debugger
// =============================================================================

export class ProbabilityDebugger {
  private readonly port: DebugEnginePort;
  private readonly acceptablePValue: number;

  constructor(port: DebugEnginePort, options: ProbabilityDebuggerOptions = {}) {
    this.port = port;
    const threshold = options.acceptablePValue;
    this.acceptablePValue = typeof threshold === 'number' && Number.isFinite(threshold) ? threshold : 0.01;
  }

  /** 16 hex character fingerprint of the IEEE-754 seed bits (UI "current seed"). */
  seedFingerprint(seed: number = this.port.seed): string {
    return numberToSeed64(seed).toString(16).padStart(16, '0');
  }

  /** Recent decision records with engine diagnostics attached. */
  decisions(limit?: number): ProbabilityDecisionRecordEx[] {
    const records = this.port.getHistory(limit);
    const result: ProbabilityDecisionRecordEx[] = [];
    for (const record of records) {
      const extended = toDecisionRecordEx(record);
      if (extended) result.push(extended);
    }
    return result;
  }

  /** Per-stream usage summary + engine totals. */
  summarize(): EngineDebugSummary {
    const streamIds = this.port.listStreams();
    const streams: StreamDebugSummary[] = [];
    let totalDraws = 0;
    let totalDecisions = 0;
    for (const streamId of streamIds) {
      const stats = this.port.getStats(streamId);
      totalDraws += stats.draws;
      totalDecisions += stats.decisions;
      streams.push({
        streamId,
        draws: stats.draws,
        decisions: stats.decisions,
        lastValue: stats.lastValue,
        known: KNOWN_STREAM_IDS.includes(streamId),
      });
    }
    return {
      seed: this.port.seed,
      seedHex: this.seedFingerprint(),
      streamCount: streamIds.length,
      totalDraws,
      totalDecisions,
      historySize: this.port.getHistory().length,
      streams,
    };
  }

  /**
   * Selection heatmap grouped by decision type: observed selection rate vs the
   * average recorded probability for every candidate. Ready for the F12 heatmap.
   */
  heatmap(decisionType?: string): HeatmapRow[] {
    const records = this.decisions();
    const groups = new Map<string, ProbabilityDecisionRecordEx[]>();
    for (const record of records) {
      if (decisionType !== undefined && record.decisionType !== decisionType) continue;
      const existing = groups.get(record.decisionType);
      if (existing) existing.push(record);
      else groups.set(record.decisionType, [record]);
    }

    const rows: HeatmapRow[] = [];
    for (const [type, group] of groups) {
      const orderedIds: string[] = [];
      const selected = new Map<string, number>();
      const expectedSum = new Map<string, number>();
      for (const record of group) {
        for (const candidate of record.candidates) {
          if (!selected.has(candidate.id)) {
            orderedIds.push(candidate.id);
            selected.set(candidate.id, 0);
            expectedSum.set(candidate.id, 0);
          }
          if (record.selectedOptionId === candidate.id) {
            selected.set(candidate.id, (selected.get(candidate.id) ?? 0) + 1);
          }
          expectedSum.set(
            candidate.id,
            (expectedSum.get(candidate.id) ?? 0) +
              (Number.isFinite(candidate.probability) ? candidate.probability : 0)
          );
        }
      }
      const total = group.length;
      const cells: HeatmapCell[] = orderedIds.map((candidateId) => {
        const selectedCount = selected.get(candidateId) ?? 0;
        const observedRate = total > 0 ? selectedCount / total : 0;
        const expectedProbability = total > 0 ? (expectedSum.get(candidateId) ?? 0) / total : 0;
        return {
          candidateId,
          selectedCount,
          total,
          observedRate,
          expectedProbability,
          deviation: observedRate - expectedProbability,
        };
      });
      rows.push({ decisionType: type, decisions: total, cells });
    }
    rows.sort((a, b) => a.decisionType.localeCompare(b.decisionType));
    return rows;
  }

  /** Chi-square goodness-of-fit of one decision type against its recorded probabilities. */
  distributionTest(decisionType: string): ChiSquareResult {
    const records = this.decisions().filter((record) => record.decisionType === decisionType);
    const observed: Record<string, number> = {};
    const expected: Record<string, number> = {};
    const countsPerCandidate = new Map<string, number>();
    const probabilityPerCandidate = new Map<string, number>();
    for (const record of records) {
      for (const candidate of record.candidates) {
        if (!countsPerCandidate.has(candidate.id)) {
          countsPerCandidate.set(candidate.id, 0);
          probabilityPerCandidate.set(candidate.id, 0);
        }
        if (record.selectedOptionId === candidate.id) {
          countsPerCandidate.set(candidate.id, (countsPerCandidate.get(candidate.id) ?? 0) + 1);
        }
        probabilityPerCandidate.set(
          candidate.id,
          (probabilityPerCandidate.get(candidate.id) ?? 0) +
            (Number.isFinite(candidate.probability) ? candidate.probability : 0)
        );
      }
    }
    const recordCount = records.length;
    for (const [candidateId, count] of countsPerCandidate) {
      observed[candidateId] = count;
      expected[candidateId] =
        recordCount > 0 ? (probabilityPerCandidate.get(candidateId) ?? 0) / recordCount : 0;
    }
    return chiSquareTest(observed, expected, this.acceptablePValue);
  }

  /** Histogram of `samples` draws from an independent scratch stream. */
  drawHistogram(seed: number, streamId: string, samples: number, buckets = 10): HistogramBucket[] {
    const count = Number.isFinite(samples) ? Math.max(0, Math.floor(samples)) : 0;
    const bucketCount = Number.isFinite(buckets) ? Math.max(1, Math.floor(buckets)) : 10;
    const counts = new Array<number>(bucketCount).fill(0);
    if (count > 0) {
      const stream = new RandomStream(streamId, deriveStreamState(seed, streamId));
      for (let i = 0; i < count; i += 1) {
        const value = stream.next();
        const index = Math.min(bucketCount - 1, Math.floor(value * bucketCount));
        counts[index] = (counts[index] ?? 0) + 1;
      }
    }
    return counts.map((bucketCountValue, index) => ({
      start: index / bucketCount,
      end: (index + 1) / bucketCount,
      count: bucketCountValue,
      probability: count > 0 ? bucketCountValue / count : 0,
    }));
  }

  /** Chi-square uniformity test of one scratch stream's [0,1) draws. */
  uniformityTest(seed: number, streamId: string, samples: number, buckets = 10): ChiSquareResult {
    const histogram = this.drawHistogram(seed, streamId, samples, buckets);
    const observed: Record<string, number> = {};
    const expected: Record<string, number> = {};
    for (let i = 0; i < histogram.length; i += 1) {
      observed[`bucket_${i}`] = histogram[i]?.count ?? 0;
      expected[`bucket_${i}`] = 1 / histogram.length;
    }
    return chiSquareTest(observed, expected, this.acceptablePValue);
  }

  /**
   * Compares the draw sequences of two seeds over the given streams.
   * Scratch streams only; the live engine is not touched.
   */
  compareSeeds(
    seedA: number,
    seedB: number,
    streamIds?: readonly string[],
    samples = 1000
  ): SeedComparisonResult {
    const count = Number.isFinite(samples) ? Math.max(0, Math.floor(samples)) : 0;
    const candidateIds =
      streamIds && streamIds.length > 0
        ? [...streamIds]
        : this.port.listStreams().length > 0
          ? this.port.listStreams()
          : [...KNOWN_STREAM_IDS];
    const identicalStreams: string[] = [];
    const divergentStreams: SeedDivergence[] = [];

    for (const streamId of candidateIds) {
      const streamA = new RandomStream(streamId, deriveStreamState(seedA, streamId));
      const streamB = new RandomStream(streamId, deriveStreamState(seedB, streamId));
      let firstIndex: number | null = null;
      let valueA: number | null = null;
      let valueB: number | null = null;
      for (let i = 0; i < count; i += 1) {
        const a = streamA.next();
        const b = streamB.next();
        if (a !== b) {
          firstIndex = i;
          valueA = a;
          valueB = b;
          break;
        }
      }
      if (firstIndex === null) identicalStreams.push(streamId);
      else
        divergentStreams.push({ streamId, firstDivergenceIndex: firstIndex, valueA, valueB, samples: count });
    }
    return { seedA, seedB, samples: count, identicalStreams, divergentStreams };
  }

  /** Validates one decision record against the engine's invariants. */
  validateRecord(
    record: ProbabilityDecisionRecord | ProbabilityDecisionRecordEx,
    minWeight = 0
  ): DecisionValidation {
    const issues: string[] = [];
    const extended = toDecisionRecordEx(record);
    if (!extended) return { decisionId: '', valid: false, issues: ['record is not a valid decision record'] };
    const decisionId = extended.decisionId;
    if (extended.candidates.length === 0 && extended.selectedOptionId !== null) {
      issues.push('selected an option but recorded no candidates');
    }
    if (extended.fallback !== 'first-candidate') {
      let probabilitySum = 0;
      const seen = new Set<string>();
      for (const candidate of extended.candidates) {
        if (seen.has(candidate.id)) issues.push(`duplicate candidate id '${candidate.id}'`);
        seen.add(candidate.id);
        if (!Number.isFinite(candidate.baseWeight))
          issues.push(`candidate '${candidate.id}' has non-finite baseWeight`);
        if (!Number.isFinite(candidate.finalWeight) || candidate.finalWeight < 0) {
          issues.push(`candidate '${candidate.id}' has invalid finalWeight`);
        }
        if (
          !Number.isFinite(candidate.probability) ||
          candidate.probability < 0 ||
          candidate.probability > 1 + 1e-9
        ) {
          issues.push(`candidate '${candidate.id}' has invalid probability`);
        }
        if (candidate.eligible) probabilitySum += candidate.probability;
        if (candidate.finalWeight > 0 && candidate.finalWeight < minWeight) {
          issues.push(`candidate '${candidate.id}' finalWeight below the minimum bound`);
        }
        for (const modifier of candidate.modifiers) {
          if (!Number.isFinite(modifier.amount))
            issues.push(`candidate '${candidate.id}' modifier '${modifier.id}' has non-finite amount`);
        }
        if (!candidate.eligible && candidate.probability !== 0) {
          issues.push(`ineligible candidate '${candidate.id}' has non-zero probability`);
        }
      }
      if (
        extended.fallback === 'none' &&
        extended.candidates.length > 0 &&
        Math.abs(probabilitySum - 1) > 1e-6
      ) {
        issues.push(`probabilities sum to ${probabilitySum.toFixed(9)} instead of 1`);
      }
    }
    if (extended.selectedOptionId === null) {
      if (extended.candidates.length > 0) issues.push('no option selected despite candidates being present');
    } else {
      const selected = extended.candidates.find((candidate) => candidate.id === extended.selectedOptionId);
      if (!selected) {
        issues.push(`selected option '${extended.selectedOptionId}' is not among the candidates`);
      } else if (!selected.eligible && extended.fallback !== 'first-candidate') {
        // Selecting an ineligible candidate is only legal for the documented
        // first-candidate fallback (which flags itself for the debug panel).
        issues.push('selected option is ineligible');
      } else if (
        extended.fallback === 'first-candidate' &&
        extended.candidates[0]?.id !== extended.selectedOptionId
      ) {
        issues.push('first-candidate fallback did not select the first candidate');
      }
    }
    if (!Number.isFinite(extended.timestamp)) issues.push('non-finite timestamp');
    return { decisionId, valid: issues.length === 0, issues };
  }

  /** Validates the retained history; returns only invalid records by default. */
  validateHistory(limit?: number, includeValid = false): DecisionValidation[] {
    const results: DecisionValidation[] = [];
    for (const record of this.decisions(limit)) {
      const validation = this.validateRecord(record);
      if (!validation.valid || includeValid) results.push(validation);
    }
    return results;
  }

  /** Human-readable anomaly list for the debug panel (bounded). */
  anomalies(limit = 200): string[] {
    const messages: string[] = [];
    for (const validation of this.validateHistory(limit)) {
      messages.push(`${validation.decisionId}: ${validation.issues.join('; ')}`);
    }
    let fallbackCount = 0;
    for (const record of this.decisions(limit)) {
      if (record.fallback !== 'none') fallbackCount += 1;
    }
    if (fallbackCount > 0) messages.push(`${fallbackCount} recent decision(s) used a deterministic fallback`);
    return messages;
  }

  /** Looks up a decision for replay inspection (record + validation). */
  inspectDecision(decisionId: string): ReplayInspection {
    let record: ProbabilityDecisionRecord | undefined;
    if (this.port.getHistoryForDecision) record = this.port.getHistoryForDecision(decisionId);
    if (!record) record = this.decisions().find((candidate) => candidate.decisionId === decisionId);
    if (!record) return { found: false, record: null, validation: null };
    const extended = toDecisionRecordEx(record);
    if (!extended) return { found: false, record: null, validation: null };
    return { found: true, record: extended, validation: this.validateRecord(extended) };
  }
}
