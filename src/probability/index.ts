// =============================================================================
// Public entry point of the probability module (L1 facility layer).
//
// The game wires `new ProbabilityEngine()`, calls `init(seed, state.probability)`
// once, and stores `exportState()` back into `GameState.probability`.
// =============================================================================
export { ProbabilityEngine } from './ProbabilityEngine';
export type { DecisionPreview } from './ProbabilityEngine';

export * from './RandomProvider';
export * from './SeedManager';
export * from './RandomStream';
export * from './ConditionEvaluator';
export * from './ModifierResolver';
export * from './ProbabilityCalculator';
export * from './ProbabilityRegistry';
export * from './ProbabilityHistory';
export * from './CausalTrace';
export * from './ProbabilityDebugger';

export {
  ALIAS_TABLE_THRESHOLD,
  DECISION_ID_PREFIX,
  KNOWN_STREAM_IDS,
  PROBABILITY_STATE_VERSION,
  formatDecisionId,
  isKnownStreamId,
  parseDecisionIdCounter,
} from './types';
export type {
  DecisionCause,
  DecisionFallback,
  ProbabilityDecisionEx,
  ProbabilityDecisionRecordEx,
  ProbabilityEngineOptions,
  StreamState,
} from './types';

import { ProbabilityEngine } from './ProbabilityEngine';
import type { ProbabilityPersistState } from '../core/contracts';

/** Convenience factory used by wiring code and tests. */
export function createProbabilityEngine(seed = 0, persisted?: ProbabilityPersistState): ProbabilityEngine {
  const engine = new ProbabilityEngine();
  engine.init(seed, persisted);
  return engine;
}
