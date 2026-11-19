// =============================================================================
// ProbabilityCalculator: eligibility filtering, weight maths and samplers.
//
// Weight formula (spec module 2.2):
//   W_final = clamp((W_base + SUM(M_add)) * PRODUCT(M_mult), W_min, W_max)
//   - NaN or negative intermediate => 0 (defensive; a warning is surfaced)
//   - +Infinity clamps to W_max, -Infinity => 0
//
// Sampling:
//   - candidate sets (decide/weighted) use a prefix-sum array + binary search,
//   - registered static distributions with more than 32 entries use Vose's
//     alias method (O(N) build, O(1) draw), see ProbabilityRegistry.
// =============================================================================
import type {
  AppliedModifier,
  EvaluatedCandidate,
  ProbabilityContext,
  ProbabilityOption,
} from '../core/contracts';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { collectFailedConditions } from './ConditionEvaluator';
import { applyModifiersToWeight, resolveModifiersDetailed } from './ModifierResolver';
import type { RandomSource } from './RandomStream';

/** Inclusive weight bounds used by the clamp step. */
export interface WeightBounds {
  minWeight: number;
  maxWeight: number;
}

/** One evaluated candidate set, ready for selection. */
export interface CandidateCalculation<T> {
  options: readonly ProbabilityOption<T>[];
  evaluations: EvaluatedCandidate[];
  /** Normalised probability per candidate, aligned with `evaluations`. */
  probabilities: number[];
  totalWeight: number;
  eligibleCount: number;
  warnings: string[];
}

/** Reads the default weight bounds from WORLD_CONFIG. */
export function defaultWeightBounds(): WeightBounds {
  return {
    minWeight: WORLD_CONFIG.probability.defaultMinWeight,
    maxWeight: WORLD_CONFIG.probability.defaultMaxWeight,
  };
}

/**
 * Resolves request-level weight bounds, falling back to WORLD_CONFIG defaults.
 * A negative minimum is impossible and reset to 0; max < min is normalised.
 */
export function resolveWeightBounds(minWeight?: number, maxWeight?: number): WeightBounds {
  const defaults = defaultWeightBounds();
  let min = typeof minWeight === 'number' && Number.isFinite(minWeight) ? minWeight : defaults.minWeight;
  let max = typeof maxWeight === 'number' && Number.isFinite(maxWeight) ? maxWeight : defaults.maxWeight;
  if (min < 0) min = 0;
  if (max <= 0) max = defaults.maxWeight;
  if (max < min) max = min;
  return { minWeight: min, maxWeight: max };
}

/** Sanitises a raw weight: non-finite / non-positive values become 0. */
export function sanitizeWeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return value;
}

/**
 * Computes the final clamped weight. Applies the mandated defensive rules:
 * NaN / negative => 0, finite values clamped into [minWeight, maxWeight].
 */
export function computeFinalWeight(
  baseWeight: number,
  applied: readonly AppliedModifier[],
  bounds: WeightBounds
): number {
  if (typeof baseWeight !== 'number' || !Number.isFinite(baseWeight)) return 0;
  const raw = applyModifiersToWeight(baseWeight, applied);
  if (Number.isNaN(raw) || raw < 0 || raw === Number.NEGATIVE_INFINITY) return 0;
  if (raw === Number.POSITIVE_INFINITY) return bounds.maxWeight;
  if (raw < bounds.minWeight) return bounds.minWeight;
  if (raw > bounds.maxWeight) return bounds.maxWeight;
  return raw;
}

/**
 * Evaluates one candidate: conditions => eligibility, modifiers => final weight.
 * Ineligible candidates keep `finalWeight = 0` and a human-readable reason.
 */
export function evaluateCandidate<T>(
  option: ProbabilityOption<T>,
  context: ProbabilityContext,
  bounds: WeightBounds
): { evaluation: EvaluatedCandidate; warnings: string[] } {
  const warnings: string[] = [];
  const candidateId = typeof option.id === 'string' ? option.id : String(option.id);
  const rawBase = typeof option.baseWeight === 'number' ? option.baseWeight : 0;
  // Invalid base weights are illegal content: sanitise to 0 and force the final
  // weight to 0 (they must not be boosted to the minimum weight by the clamp).
  const invalidBase = !Number.isFinite(rawBase) || rawBase < 0;
  if (!Number.isFinite(rawBase)) {
    warnings.push(`candidate '${candidateId}' has a non-finite baseWeight; treated as weight 0`);
  } else if (rawBase < 0) {
    warnings.push(`candidate '${candidateId}' has a negative baseWeight ${rawBase}; treated as weight 0`);
  }
  const baseWeight = invalidBase ? 0 : rawBase;

  const failed = collectFailedConditions(option.conditions, context);
  const eligible = failed.length === 0;

  const evaluation: EvaluatedCandidate = {
    id: candidateId,
    baseWeight,
    finalWeight: 0,
    probability: 0,
    modifiers: [],
    eligible,
    rejectionReason: null,
  };

  if (!eligible) {
    evaluation.rejectionReason =
      failed.length > 0 ? `conditions failed: ${failed.join(' && ')}` : 'ineligible';
    return { evaluation, warnings };
  }

  const resolution = resolveModifiersDetailed(option.modifiers, context);
  for (const warning of resolution.warnings) warnings.push(`candidate '${candidateId}': ${warning}`);
  evaluation.modifiers = resolution.applied;
  evaluation.finalWeight = invalidBase ? 0 : computeFinalWeight(baseWeight, resolution.applied, bounds);
  return { evaluation, warnings };
}

/**
 * Evaluates every candidate and normalises the eligible weights.
 * Computed probabilities are 0 for ineligible candidates; when the total weight
 * is 0 the caller is expected to apply its deterministic fallback.
 */
export function calculateCandidates<T>(
  options: readonly ProbabilityOption<T>[],
  context: ProbabilityContext,
  bounds: WeightBounds = defaultWeightBounds()
): CandidateCalculation<T> {
  const evaluations: EvaluatedCandidate[] = [];
  const warnings: string[] = [];
  let eligibleCount = 0;

  for (const option of options) {
    const result = evaluateCandidate(option, context, bounds);
    evaluations.push(result.evaluation);
    for (const warning of result.warnings) warnings.push(warning);
    if (result.evaluation.eligible) eligibleCount += 1;
  }

  let totalWeight = 0;
  for (const evaluation of evaluations) {
    if (evaluation.eligible) totalWeight += evaluation.finalWeight;
  }
  const safeTotal = Number.isFinite(totalWeight) ? totalWeight : 0;

  const probabilities: number[] = new Array(evaluations.length);
  for (let i = 0; i < evaluations.length; i += 1) {
    const evaluation = evaluations[i];
    if (!evaluation) {
      probabilities[i] = 0;
      continue;
    }
    const probability = evaluation.eligible && safeTotal > 0 ? evaluation.finalWeight / safeTotal : 0;
    evaluation.probability = probability;
    probabilities[i] = probability;
  }

  return {
    options,
    evaluations,
    probabilities,
    totalWeight: safeTotal,
    eligibleCount,
    warnings,
  };
}

/**
 * Normalises an arbitrary weight list (0 when the total is invalid).
 * Used by samplers and debug tooling.
 */
export function normalizeWeightList(weights: readonly number[]): { probabilities: number[]; total: number } {
  const safe = weights.map(sanitizeWeight);
  let total = 0;
  for (const weight of safe) total += weight;
  if (!Number.isFinite(total) || total <= 0) {
    return { probabilities: safe.map(() => 0), total: 0 };
  }
  return { probabilities: safe.map((weight) => weight / total), total };
}

/** Maps a uniform [0,1) value to an index in [0, count). */
export function uniformIndexFromUniform(uniform: number, count: number): number {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return -1;
  const size = Math.max(1, Math.floor(count));
  const safeUniform = Number.isFinite(uniform) ? Math.min(Math.max(uniform, 0), 1 - Number.EPSILON) : 0;
  const index = Math.floor(safeUniform * size);
  return index >= size ? size - 1 : index < 0 ? 0 : index;
}

/** Draws a uniform index using the supplied random source. */
export function uniformIndex(source: RandomSource, count: number): number {
  return uniformIndexFromUniform(source.next(), count);
}

// =============================================================================
// Samplers
// =============================================================================

/** A deterministic weighted sampler over entries indexed 0..size-1. */
export interface WeightedSampler {
  readonly mode: 'prefix' | 'alias';
  readonly size: number;
  /** Sum of the sanitised raw weights (may be 0 for an empty distribution). */
  readonly totalWeight: number;
  /** True when there is no positive weight to sample. */
  readonly isEmpty: boolean;
  /** Returns an index in [0, size) or -1 when the distribution is empty. */
  sampleIndex(source: RandomSource): number;
  /** Normalised probability per entry (sums to 1 when not empty). */
  normalizedProbabilities(): number[];
}

/** Prepares raw weights: sanitises, reports the maximum for overflow-safe scaling. */
function prepareWeights(weights: readonly number[]): { safe: number[]; max: number } {
  const safe: number[] = new Array(weights.length);
  let max = 0;
  for (let i = 0; i < weights.length; i += 1) {
    const weight = sanitizeWeight(weights[i]);
    safe[i] = weight;
    if (weight > max) max = weight;
  }
  return { safe, max };
}

/**
 * Prefix-sum sampler + binary search: O(N) build, O(log N) sample with exactly
 * one uniform draw. Used for candidate sets (normally <= 32 entries).
 */
export class PrefixSumSampler implements WeightedSampler {
  readonly mode = 'prefix' as const;
  readonly size: number;
  readonly totalWeight: number;
  readonly isEmpty: boolean;

  private readonly cumulative: number[];
  private readonly scaledTotal: number;
  private readonly probabilities: number[];

  constructor(weights: readonly number[]) {
    this.size = weights.length;
    const { safe, max } = prepareWeights(weights);
    this.cumulative = new Array<number>(this.size).fill(0);
    this.probabilities = new Array<number>(this.size).fill(0);

    if (this.size === 0 || max <= 0) {
      this.isEmpty = true;
      this.totalWeight = 0;
      this.scaledTotal = 0;
      return;
    }

    // Scale by the maximum weight so huge weights cannot overflow the sum.
    let scaledTotal = 0;
    const ratios: number[] = new Array(this.size);
    for (let i = 0; i < this.size; i += 1) {
      const ratio = (safe[i] ?? 0) / max;
      ratios[i] = ratio;
      scaledTotal += ratio;
    }
    this.isEmpty = scaledTotal <= 0;
    this.scaledTotal = this.isEmpty ? 0 : scaledTotal;
    this.totalWeight = max * scaledTotal;

    let running = 0;
    for (let i = 0; i < this.size; i += 1) {
      const ratio = ratios[i] ?? 0;
      running += ratio;
      this.cumulative[i] = running;
      this.probabilities[i] = this.scaledTotal > 0 ? ratio / this.scaledTotal : 0;
    }
  }

  sampleIndex(source: RandomSource): number {
    if (this.isEmpty || this.size === 0) return -1;
    const target = source.next() * this.scaledTotal;
    let low = 0;
    let high = this.size - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const boundary = this.cumulative[middle] ?? Number.POSITIVE_INFINITY;
      if (target < boundary) high = middle;
      else low = middle + 1;
    }
    const index = low;
    return index < 0 ? 0 : index >= this.size ? this.size - 1 : index;
  }

  normalizedProbabilities(): number[] {
    return [...this.probabilities];
  }
}

/**
 * Vose's alias method: O(N) build, O(1) sample using two uniform draws.
 * Used for registered static distributions larger than 32 entries.
 */
export class AliasTableSampler implements WeightedSampler {
  readonly mode = 'alias' as const;
  readonly size: number;
  readonly totalWeight: number;
  readonly isEmpty: boolean;

  private readonly probability: number[];
  private readonly alias: number[];
  private readonly normalized: number[];

  constructor(weights: readonly number[]) {
    this.size = weights.length;
    const { safe, max } = prepareWeights(weights);
    this.probability = new Array<number>(this.size).fill(0);
    this.alias = new Array<number>(this.size).fill(0);
    this.normalized = new Array<number>(this.size).fill(0);

    if (this.size === 0 || max <= 0) {
      this.isEmpty = true;
      this.totalWeight = 0;
      return;
    }

    // ratios in [0,1], scaledSum in [0,size] -> no overflow for any input.
    const ratios: number[] = new Array(this.size);
    let scaledSum = 0;
    for (let i = 0; i < this.size; i += 1) {
      const ratio = (safe[i] ?? 0) / max;
      ratios[i] = ratio;
      scaledSum += ratio;
    }
    this.isEmpty = scaledSum <= 0;
    this.totalWeight = max * scaledSum;
    if (this.isEmpty) return;

    // scaled[i] has mean 1 across the table.
    const scaled: number[] = new Array(this.size);
    for (let i = 0; i < this.size; i += 1) {
      scaled[i] = ((ratios[i] ?? 0) * this.size) / scaledSum;
      this.normalized[i] = (ratios[i] ?? 0) / scaledSum;
    }
    for (let i = 0; i < this.size; i += 1) this.alias[i] = i;

    const small: number[] = [];
    const large: number[] = [];
    for (let i = 0; i < this.size; i += 1) {
      const value = scaled[i] ?? 0;
      if (value < 1) small.push(i);
      else large.push(i);
    }

    while (small.length > 0 && large.length > 0) {
      const less = small.pop();
      const more = large.pop();
      if (less === undefined || more === undefined) break;
      this.probability[less] = scaled[less] ?? 0;
      this.alias[less] = more;
      const updated = (scaled[more] ?? 0) + (scaled[less] ?? 0) - 1;
      scaled[more] = updated;
      if (updated < 1) small.push(more);
      else large.push(more);
    }
    while (large.length > 0) {
      const index = large.pop();
      if (index === undefined) break;
      this.probability[index] = 1;
    }
    while (small.length > 0) {
      const index = small.pop();
      if (index === undefined) break;
      this.probability[index] = 1;
    }
  }

  sampleIndex(source: RandomSource): number {
    if (this.isEmpty || this.size === 0) return -1;
    const column = uniformIndexFromUniform(source.next(), this.size);
    const safeColumn = column < 0 ? 0 : column;
    const threshold = this.probability[safeColumn] ?? 1;
    if (source.next() < threshold) return safeColumn;
    const alternative = this.alias[safeColumn] ?? safeColumn;
    return alternative < 0 ? 0 : alternative >= this.size ? safeColumn : alternative;
  }

  normalizedProbabilities(): number[] {
    return [...this.normalized];
  }
}

/**
 * Builds the appropriate sampler. `auto` follows the spec threshold:
 * prefix-sum + binary search for <= 32 entries, Vose alias above that.
 */
export function buildSampler(
  weights: readonly number[],
  mode: 'auto' | 'prefix' | 'alias' = 'auto'
): WeightedSampler {
  if (mode === 'alias') return new AliasTableSampler(weights);
  if (mode === 'prefix') return new PrefixSumSampler(weights);
  return weights.length > 32 ? new AliasTableSampler(weights) : new PrefixSumSampler(weights);
}
