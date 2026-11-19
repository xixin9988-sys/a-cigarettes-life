// =============================================================================
// ProbabilityRegistry: reusable static weighted distributions ("probability
// tables") shared by game systems, e.g. weather transitions, loot tables,
// NPC name pools.
//
// Alias tables (and prefix sums for small tables) are compiled lazily on first
// use and invalidated whenever the registration changes, so re-registering a
// table (hot reload / content patch) is always reflected on the next draw.
// Sampling is driven by an explicit RandomSource, so distributions stay inside
// the deterministic probability engine and never allocate their own RNG.
// =============================================================================
import { buildSampler, type WeightedSampler } from './ProbabilityCalculator';
import type { RandomSource } from './RandomStream';

/** One weighted entry of a static distribution. Duplicate keys are allowed. */
export interface DistributionEntry {
  key: string;
  weight: number;
}

/** A registered (but possibly not yet compiled) distribution. */
export interface DistributionDefinition {
  id: string;
  entries: readonly DistributionEntry[];
  version: number;
}

/** A lazily compiled distribution ready for sampling. */
export interface CompiledDistribution {
  id: string;
  version: number;
  keys: readonly string[];
  weights: readonly number[];
  sampler: WeightedSampler;
}

function assertValidId(id: string): void {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('ProbabilityRegistry: distribution id must be a non-empty string');
  }
}

function sanitizeEntries(entries: readonly DistributionEntry[]): DistributionEntry[] {
  if (!Array.isArray(entries)) return [];
  const result: DistributionEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.key !== 'string' || entry.key.length === 0) continue;
    const weight =
      typeof entry.weight === 'number' && Number.isFinite(entry.weight) && entry.weight > 0
        ? entry.weight
        : 0;
    result.push({ key: entry.key, weight });
  }
  return result;
}

export class ProbabilityRegistry {
  private readonly definitions = new Map<string, DistributionDefinition>();
  private readonly compiled = new Map<string, CompiledDistribution>();
  private revision = 0;

  /** Registers (or replaces) a weighted distribution. Invalidates its sampler. */
  register(id: string, entries: readonly DistributionEntry[]): this {
    assertValidId(id);
    this.revision += 1;
    this.definitions.set(id, {
      id,
      entries: sanitizeEntries(entries),
      version: this.revision,
    });
    this.compiled.delete(id);
    return this;
  }

  /** Registers a distribution from a `{ key: weight }` record (insertion order kept). */
  registerWeights(id: string, weights: Readonly<Record<string, number>> | ReadonlyMap<string, number>): this {
    const entries: DistributionEntry[] = [];
    if (weights instanceof Map) {
      for (const [key, weight] of weights) entries.push({ key, weight });
    } else {
      const record = weights as Readonly<Record<string, number>>;
      for (const key of Object.keys(record)) {
        entries.push({ key, weight: record[key] ?? 0 });
      }
    }
    return this.register(id, entries);
  }

  /** Removes a distribution and its compiled sampler. Returns true when present. */
  unregister(id: string): boolean {
    this.compiled.delete(id);
    return this.definitions.delete(id);
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  /** Registered distribution ids in registration order. */
  list(): string[] {
    return [...this.definitions.keys()];
  }

  get size(): number {
    return this.definitions.size;
  }

  /** Number of currently cached compiled samplers (lazy-build diagnostics). */
  get compiledCount(): number {
    return this.compiled.size;
  }

  getDefinition(id: string): DistributionDefinition | undefined {
    return this.definitions.get(id);
  }

  /** Returns the lazily built compiled form (builds it on first call). */
  getCompiled(id: string): CompiledDistribution | undefined {
    const cached = this.compiled.get(id);
    if (cached) return cached;
    const definition = this.definitions.get(id);
    if (!definition) return undefined;
    const keys = definition.entries.map((entry) => entry.key);
    const weights = definition.entries.map((entry) => entry.weight);
    const compiled: CompiledDistribution = {
      id,
      version: definition.version,
      keys,
      weights,
      sampler: buildSampler(weights),
    };
    this.compiled.set(id, compiled);
    return compiled;
  }

  /** Sampling mode selected for a distribution ('prefix' | 'alias'). */
  mode(id: string): 'prefix' | 'alias' | null {
    const compiled = this.getCompiled(id);
    return compiled ? compiled.sampler.mode : null;
  }

  /**
   * Draws one key from the distribution. Returns null (and consumes no
   * randomness) when the distribution does not exist or has no positive weight.
   */
  sample(id: string, source: RandomSource): string | null {
    const compiled = this.getCompiled(id);
    if (!compiled || compiled.sampler.isEmpty) return null;
    const index = compiled.sampler.sampleIndex(source);
    if (index < 0) return null;
    const key = compiled.keys[index];
    return key === undefined ? null : key;
  }

  /**
   * Normalised probabilities per key (duplicate keys are merged).
   * Returns null for unknown distributions.
   */
  probabilities(id: string): Record<string, number> | null {
    const compiled = this.getCompiled(id);
    if (!compiled) return null;
    const normalized = compiled.sampler.normalizedProbabilities();
    const result: Record<string, number> = {};
    for (let i = 0; i < compiled.keys.length; i += 1) {
      const key = compiled.keys[i];
      if (key === undefined) continue;
      result[key] = (result[key] ?? 0) + (normalized[i] ?? 0);
    }
    return result;
  }

  /** Drops every distribution (used when a new life starts). */
  clear(): void {
    this.definitions.clear();
    this.compiled.clear();
  }
}
