import type { SimulationRuntime } from './SimulationRuntime';
import { FixedStepScheduler } from './SimulationScheduler';

export interface ActiveTickResult {
  simDeltaSeconds: number;
  steps: number;
}

/**
 * LOD 1: high fidelity simulation around the player. Runs every rendered frame on the main
 * thread, driven by the fixed-step scheduler so simulation speed is independent of FPS.
 */
export class ActiveSimulation {
  private readonly scheduler: FixedStepScheduler;

  constructor(
    readonly runtime: SimulationRuntime,
    fixedStepSeconds = 0.25
  ) {
    this.scheduler = new FixedStepScheduler(fixedStepSeconds, 0.25);
  }

  update(deltaRealSeconds: number): ActiveTickResult {
    const steps = this.scheduler.accumulate(deltaRealSeconds);
    let simDelta = 0;
    for (let index = 0; index < steps; index += 1) {
      simDelta += this.runtime.clock.advanceRealSeconds(this.scheduler.fixedStepSeconds);
      this.runtime.update(this.scheduler.fixedStepSeconds);
    }
    return { simDeltaSeconds: simDelta, steps };
  }

  get interpolationAlpha(): number {
    return this.scheduler.interpolationAlpha;
  }
}
