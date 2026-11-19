import type { ClockState, GameSpeed, IClock } from './contracts';
import type { GameTime } from './SharedTypes';
import { simSecondsToGameTime } from './TimeUtil';

/** Simulation clock. Timescale: 1 real second = 1 in-game minute at 1x speed. */
export class Clock implements IClock {
  private state: ClockState;

  constructor(initial: ClockState) {
    this.state = { ...initial };
  }

  get simTimeSeconds(): number {
    return this.state.simTimeSeconds;
  }

  get time(): GameTime {
    return simSecondsToGameTime(this.state.simTimeSeconds);
  }

  get paused(): boolean {
    return this.state.paused;
  }

  get speed(): GameSpeed {
    return this.state.speed;
  }

  setSpeed(speed: GameSpeed): void {
    this.state.speed = speed;
  }

  setPaused(paused: boolean): void {
    this.state.paused = paused;
  }

  advanceRealSeconds(realSeconds: number): number {
    if (this.state.paused) return 0;
    const safeReal = Math.max(0, Math.min(realSeconds, 5));
    const delta = safeReal * this.state.speed;
    this.state.simTimeSeconds += delta;
    this.state.totalRealPlaySeconds += safeReal;
    this.state.lastRealTimestampMs = Date.now();
    return delta;
  }

  advanceSimSeconds(seconds: number): void {
    const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    this.state.simTimeSeconds += safe;
  }

  setSimTimeSeconds(seconds: number): void {
    this.state.simTimeSeconds = Math.max(0, seconds);
  }

  syncRealTimestamp(realMs: number): void {
    this.state.lastRealTimestampMs = realMs;
  }

  serialize(): ClockState {
    return { ...this.state };
  }

  restore(state: ClockState): void {
    this.state = { ...state };
  }
}
