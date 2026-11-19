import type { IGameContext } from '../core/contracts';
import type { GameTime, Season } from '../core/SharedTypes';
import { LOC } from '../data/locations/ids';
import { SEASON_DISPLAY_NAMES } from '../core/SharedTypes';
import { addWorldHistory } from './WorldHistory';

/**
 * OWNER: Agent 4 (World & Map).
 *
 * Owns the calendar side of `world.environment`: year, season, season index and
 * day of season are always derived from the authoritative clock (never stepped
 * by hand). A season change writes a permanent world-history entry (the
 * SimulationRuntime emits the corresponding `time:season` bus event).
 *
 * Day rollovers are exposed through {@link consumeDayRollover} so WorldSystem can
 * run daily upkeep exactly once per elapsed day (including offline catch-up).
 *
 * EnvironmentSystem owns the physical fields (daylight/temperature/humidity/
 * wind); SeasonSystem owns the calendar fields. No duplication.
 */
export class SeasonSystem {
  private ctx: IGameContext | null = null;
  private lastSeasonIndex = -1;
  private lastTotalDays = -1;
  private lastSimSeconds = -1;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    const time = ctx.clock.time;
    this.writeCalendar(time);
    this.lastSeasonIndex = time.seasonIndex;
    this.lastTotalDays = time.totalDays;
    this.lastSimSeconds = ctx.clock.simTimeSeconds;
  }

  private getCtx(): IGameContext {
    if (!this.ctx) throw new Error('SeasonSystem.init(ctx) was not called');
    return this.ctx;
  }

  update(_dtSimSeconds: number): void {
    const ctx = this.getCtx();
    const now = ctx.clock.simTimeSeconds;
    const time = ctx.clock.time;
    this.writeCalendar(time);

    // A rewound clock (debug time travel / tests) resyncs silently instead of
    // recording a bogus "season arrived" history entry.
    const rewound = this.lastSimSeconds >= 0 && now < this.lastSimSeconds;
    if (!rewound && this.lastSeasonIndex >= 0 && time.seasonIndex !== this.lastSeasonIndex) {
      this.onSeasonChanged(time);
    }
    this.lastSeasonIndex = time.seasonIndex;
    this.lastSimSeconds = now;
  }

  private writeCalendar(time: GameTime): void {
    const env = this.getCtx().state.world.environment;
    env.year = time.year;
    env.season = time.season;
    env.seasonIndex = time.seasonIndex;
    env.dayOfSeason = time.dayOfSeason;
  }

  private onSeasonChanged(time: GameTime): void {
    const ctx = this.getCtx();
    // NOTE: the time:season bus event itself is emitted by SimulationRuntime's
    // clock-boundary driver (Lead-owned). SeasonSystem owns the calendar *state*
    // and the permanent world-history record, avoiding a duplicate event.
    addWorldHistory(ctx.state.world, {
      at: ctx.clock.simTimeSeconds,
      category: 'world',
      description:
        SEASON_DISPLAY_NAMES[time.season] + ' arrives in Willowbrook and Ashford. The world turns a page.',
      importance: 2,
      locationId: LOC.center,
    });
    ctx.logger.info('Season changed', { season: time.season, year: time.year });
  }

  // -------------------------------------------------------------------------
  // Read helpers (used by WorldSystem / UI)
  // -------------------------------------------------------------------------

  getTime(): GameTime {
    return this.getCtx().clock.time;
  }

  getSeason(): Season {
    return this.getCtx().clock.time.season;
  }

  /** Whole days elapsed since the world started (0-based). */
  getTotalDays(): number {
    return this.getCtx().clock.time.totalDays;
  }

  /**
   * Returns the number of days that elapsed since the previous call (0 when the
   * day has not changed). Used by WorldSystem for daily upkeep, and safe against
   * large offline catch-up gaps and clock rewinds.
   */
  consumeDayRollover(): number {
    const day = this.getCtx().clock.time.totalDays;
    if (this.lastTotalDays < 0) {
      this.lastTotalDays = day;
      return 0;
    }
    if (day <= this.lastTotalDays) {
      if (day < this.lastTotalDays) this.lastTotalDays = day;
      return 0;
    }
    const elapsed = day - this.lastTotalDays;
    this.lastTotalDays = day;
    return elapsed;
  }
}
