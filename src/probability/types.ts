// =============================================================================
// Module-local probability types.
//
// The frozen contract (`src/core/contracts.d.ts`) defines the public
// `IProbabilityEngine` API but has no room for engine-internal diagnostics such
// as the deterministic-fallback flag or causal-parent ids. Those are declared
// here as *structural extensions* of the contract records: they are assignable
// to the contract types (so no caller breaks), survive JSON persistence and are
// what the F12 probability debugger consumes.
// =============================================================================
import type { ILogger, ProbabilityDecision, ProbabilityDecisionRecord } from '../core/contracts';

/** Four 32-bit words: the complete Xoshiro128** state of one random stream. */
export type StreamState = [number, number, number, number];

/**
 * How a decision produced its selection.
 * - `none`: normal weighted sampling (all candidates had a positive total weight).
 * - `uniform-eligible`: every eligible candidate had weight 0; one eligible
 *   candidate was picked uniformly so the game never soft-locks.
 * - `first-candidate`: no candidate was eligible; the first candidate was
 *   selected deterministically (and flagged) so the caller always gets a result.
 */
export type DecisionFallback = 'none' | 'uniform-eligible' | 'first-candidate';

/** Contract record + engine diagnostics. Assignable to `ProbabilityDecisionRecord`. */
export interface ProbabilityDecisionRecordEx extends ProbabilityDecisionRecord {
  fallback: DecisionFallback;
  /** Decision that directly caused this one, when a causal link was declared. */
  parentDecisionId: string | null;
  /** World-event id that triggered this decision, when declared. */
  sourceEventId: string | null;
}

/** Contract decision + engine diagnostics. Assignable to `ProbabilityDecision`. */
export interface ProbabilityDecisionEx<T> extends ProbabilityDecision<T> {
  fallback: DecisionFallback;
  parentDecisionId: string | null;
  sourceEventId: string | null;
}

/** Causal metadata the caller can attach to the next `decide()` call. */
export interface DecisionCause {
  parentDecisionId: string | null;
  sourceEventId: string | null;
}

/** Constructor options. All optional; the game normally uses `new ProbabilityEngine()`. */
export interface ProbabilityEngineOptions {
  /** Receives invalid-weight / fallback / import warnings. Defaults to silent. */
  logger?: ILogger;
  /** Overrides `WORLD_CONFIG.probability.historyLimit` (tests / debug tooling). */
  historyLimit?: number;
  /** Overrides the causal-trace node limit (defaults to the history limit). */
  traceLimit?: number;
}

/** Version written into `ProbabilityPersistState.version`. */
export const PROBABILITY_STATE_VERSION = 1;

/** Candidate-set size above which registered static distributions use Vose alias tables. */
export const ALIAS_TABLE_THRESHOLD = 32;

/** Prefix of every recorded decision id, e.g. `dec_000042`. */
export const DECISION_ID_PREFIX = 'dec_';

export function formatDecisionId(counter: number): string {
  const safe = Number.isFinite(counter) ? Math.max(1, Math.floor(counter)) : 1;
  return `${DECISION_ID_PREFIX}${safe.toString().padStart(6, '0')}`;
}

/** Parses the numeric suffix of a decision id; returns 0 when it is not ours. */
export function parseDecisionIdCounter(decisionId: string): number {
  if (typeof decisionId !== 'string' || !decisionId.startsWith(DECISION_ID_PREFIX)) return 0;
  const suffix = decisionId.slice(DECISION_ID_PREFIX.length);
  if (!/^\d+$/.test(suffix)) return 0;
  const parsed = Number.parseInt(suffix, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Stable stream ids from `docs/ARCHITECTURE.md`. Advisory only: `ensureStream`
 * accepts any string and every module owns / derives its own ids. This list is
 * used by debug tooling (seed comparison, coverage reports) and tests.
 */
export const KNOWN_STREAM_IDS: readonly string[] = [
  'world.weather',
  'world.environment',
  'world.transport',
  'npc.behavior',
  'npc.social',
  'npc.memory',
  'npc.schedule',
  'economy.market',
  'economy.business',
  'economy.customer',
  'economy.jobs',
  'farming.growth',
  'farming.quality',
  'foraging.results',
  'fishing.results',
  'fishing.minigame',
  'exploration.discovery',
  'crafting.quality',
  'cooking.quality',
  'collection.discovery',
  'social.interaction',
  'social.romance',
  'social.dialogue',
  'events.occurrence',
  'events.festival',
  'player.opportunities',
  'player.cigarettePhysics',
  'life.ash',
  'life.archive',
  'housing.decor',
  'ui.cosmetic',
];

export function isKnownStreamId(streamId: string): boolean {
  return KNOWN_STREAM_IDS.includes(streamId);
}
