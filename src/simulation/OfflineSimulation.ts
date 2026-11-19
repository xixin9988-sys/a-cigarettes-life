import type { GameState, IContentRegistry, ILogger } from '../core/contracts';
import { SimulationRuntime, type SimulationRuntimeOptions } from './SimulationRuntime';
import type { OfflineRunResult } from './SimulationRuntime';

export interface OfflineSimulationOptions {
  state: GameState;
  content: IContentRegistry;
  fromSimTime: number;
  toSimTime: number;
  logger?: ILogger;
  realElapsedMs?: number;
  onProgress?: (percent: number, phase: string) => void;
}

/**
 * LOD 3: offline catch-up simulation. Runs the full deterministic simulation over aggregated
 * time steps inside the Web Worker (or main-thread fallback) and produces player-facing summary.
 */
export async function runOfflineSimulation(options: OfflineSimulationOptions): Promise<OfflineRunResult> {
  const { state, content, fromSimTime, toSimTime, logger, onProgress } = options;
  state.flags['offline_simulation'] = true;
  try {
    const runtimeOptions: SimulationRuntimeOptions = { state, content, syncIdCounter: true };
    if (logger) runtimeOptions.logger = logger;
    const runtime = new SimulationRuntime(runtimeOptions);
    runtime.setSimTimeSeconds(fromSimTime);
    const result = await runtime.runOffline(fromSimTime, toSimTime, onProgress, options.realElapsedMs);
    state.pendingOffline.lastProcessedSimTime = toSimTime;
    state.pendingOffline.pendingSummary = result.summary;
    state.pendingOffline.lastOfflineSimTime = toSimTime;
    state.pendingOffline.lastSaveRealMs = Date.now();
    return result;
  } finally {
    delete state.flags['offline_simulation'];
  }
}