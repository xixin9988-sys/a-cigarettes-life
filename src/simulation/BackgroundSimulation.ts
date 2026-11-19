import type { BackgroundTickResult, GameState, IWorkerBridge } from '../core/contracts';
import type { SimulationRuntime } from './SimulationRuntime';

/**
 * LOD 2: background simulation for distant regions. Prefers the Web Worker so the Phaser
 * render loop never blocks; falls back to a local simulation runtime when workers are absent.
 */
export class BackgroundSimulation {
  constructor(
    private readonly bridge: IWorkerBridge | null,
    private readonly localRuntime: SimulationRuntime | null = null
  ) {}

  get hasWorker(): boolean {
    return this.bridge !== null && this.bridge.ready;
  }

  async run(snapshot: GameState, simDeltaSeconds: number): Promise<BackgroundTickResult> {
    if (this.bridge && this.bridge.ready) {
      try {
        return await this.bridge.requestBackground(snapshot, simDeltaSeconds);
      } catch {
        // fall through to local
      }
    }
    if (this.localRuntime) {
      const startedAt = Date.now();
      this.localRuntime.setSimTimeSeconds(snapshot.clock.simTimeSeconds);
      this.localRuntime.advance(simDeltaSeconds);
      this.localRuntime.flushPersistence();
      return {
        requestId: 'local',
        state: this.localRuntime.state,
        simTimeSeconds: this.localRuntime.clock.simTimeSeconds,
        elapsedMs: Date.now() - startedAt,
      };
    }
    throw new Error('Background simulation unavailable: no worker and no local runtime');
  }
}
