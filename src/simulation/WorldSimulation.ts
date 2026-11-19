import type { BackgroundTickResult, GameState, IWorkerBridge, OfflineSimResult } from '../core/contracts';
import type { SimulationRuntime } from './SimulationRuntime';
import { ActiveSimulation } from './ActiveSimulation';
import { BackgroundSimulation } from './BackgroundSimulation';
import { captureSnapshot } from './SimulationSnapshot';
import { runOfflineSimulation } from './OfflineSimulation';

/**
 * High level WorldSimulation facade: coordinates the three simulation LODs.
 * - LOD1 ActiveSimulation (main thread, player area)
 * - LOD2 BackgroundSimulation (Web Worker, distant regions)
 * - LOD3 offline catch-up (Web Worker or local fallback)
 */
export class WorldSimulation {
  private readonly active: ActiveSimulation;
  private readonly background: BackgroundSimulation;

  constructor(
    readonly runtime: SimulationRuntime,
    bridge: IWorkerBridge | null = null
  ) {
    this.active = new ActiveSimulation(runtime);
    this.background = new BackgroundSimulation(bridge, runtime);
  }

  updateActive(deltaRealSeconds: number): { simDeltaSeconds: number; steps: number } {
    return this.active.update(deltaRealSeconds);
  }

  async runBackground(simDeltaSeconds: number): Promise<BackgroundTickResult> {
    const snapshot = captureSnapshot(this.runtime.state);
    return this.background.run(snapshot.state, simDeltaSeconds);
  }

  async catchUpOffline(fromSimTime: number, toSimTime: number): Promise<OfflineSimResult> {
    const result = await runOfflineSimulation({
      state: captureSnapshot(this.runtime.state).state,
      content: this.runtime.content,
      fromSimTime,
      toSimTime,
    });
    return {
      requestId: 'world-simulation-offline',
      ok: true,
      lastProcessedSimTime: toSimTime,
      state: result.state,
      summary: result.summary,
      stats: result.stats,
    };
  }

  getState(): GameState {
    return this.runtime.state;
  }
}
