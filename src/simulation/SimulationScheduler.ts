/** Fixed-step accumulator that decouples simulation from display refresh rate. */
export class FixedStepScheduler {
  private accumulator = 0;
  private lastDelta = 0;

  constructor(
    readonly fixedStepSeconds = 0.25,
    readonly maxFrameSeconds = 0.25
  ) {}

  /** Adds real elapsed time and returns the number of fixed simulation steps to run. */
  accumulate(deltaRealSeconds: number): number {
    const clamped = Math.max(0, Math.min(deltaRealSeconds, this.maxFrameSeconds));
    this.lastDelta = clamped;
    this.accumulator += clamped;
    const steps = Math.floor(this.accumulator / this.fixedStepSeconds);
    this.accumulator -= steps * this.fixedStepSeconds;
    return steps;
  }

  get interpolationAlpha(): number {
    return this.accumulator / this.fixedStepSeconds;
  }

  get lastFrameSeconds(): number {
    return this.lastDelta;
  }

  reset(): void {
    this.accumulator = 0;
    this.lastDelta = 0;
  }
}

export interface IntervalTask {
  id: string;
  everySeconds: number;
  elapsed: number;
  callback: () => void;
  enabled: boolean;
}

/**
 * Named interval scheduler for periodic work (autosave, background worker sync, UI refresh).
 * Unlike an ever-growing setTimeout chain it is deterministic under fixed-step ticking.
 */
export class SimulationScheduler {
  private readonly tasks = new Map<string, IntervalTask>();

  schedule(id: string, everySeconds: number, callback: () => void, startImmediately = false): void {
    this.tasks.set(id, {
      id,
      everySeconds: Math.max(0.1, everySeconds),
      elapsed: startImmediately ? Math.max(0.1, everySeconds) : 0,
      callback,
      enabled: true,
    });
  }

  cancel(id: string): void {
    this.tasks.delete(id);
  }

  setEnabled(id: string, enabled: boolean): void {
    const task = this.tasks.get(id);
    if (task) task.enabled = enabled;
  }

  tick(deltaSeconds: number): void {
    for (const task of this.tasks.values()) {
      if (!task.enabled) continue;
      task.elapsed += deltaSeconds;
      let guard = 0;
      while (task.elapsed >= task.everySeconds && guard < 1000) {
        guard += 1;
        task.elapsed -= task.everySeconds;
        task.callback();
      }
    }
  }

  clear(): void {
    this.tasks.clear();
  }
}