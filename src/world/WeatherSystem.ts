import type { IGameContext, IWeatherSystem } from '../core/contracts';
import type { WeatherTransitionTable, WeatherTransitionWeights } from '../data/schema';
import type { WeatherType } from '../core/SharedTypes';
import { WEATHER_DISPLAY_NAMES, WEATHER_TYPES } from '../core/SharedTypes';
import { SEASON_TEMPERATURE_BASE, WEATHER_PROFILES } from '../core/WorldConfig';
import { clamp, clamp01, lerp } from '../core/utils';
import { addWorldHistory } from './WorldHistory';
import { normaliseDegrees } from './EnvironmentSystem';

/**
 * OWNER: Agent 4 (World & Map).
 *
 * Season-aware Markov-chain weather simulation. Every
 * {@link WEATHER_TRANSITION_INTERVAL_HOURS} in-game hours the current weather
 * transitions using the content pack's per-season weight matrix and the
 * dedicated 'world.weather' probability stream.
 *
 * It owns: weather, previousWeather, nextWeatherChangeAt, recentWeather,
 * rainIntensity and fogDensity. It nudges (never teleports) temperature, humidity
 * and wind towards the new weather profile; EnvironmentSystem performs the
 * gradual interpolation of those physical fields.
 *
 * Also implements IWeatherSystem (id 'weather') so UI/debug code can query the
 * live weather without reaching through WorldSystem.
 */

/** In-game hours between Markov transitions (documented game-design value). */
export const WEATHER_TRANSITION_INTERVAL_HOURS = 4;
/** Sim seconds per in-game hour (1 sim second = 1 in-game minute). */
const SIM_SECONDS_PER_GAME_HOUR = 60;
const WEATHER_INTERVAL_SIM_SECONDS = WEATHER_TRANSITION_INTERVAL_HOURS * SIM_SECONDS_PER_GAME_HOUR;
/** Recent weather history kept for UI/debug. */
export const RECENT_WEATHER_LIMIT = 10;
/** Cap on transitions processed in a single update (offline catch-up safety). */
export const MAX_WEATHER_STEPS_PER_UPDATE = 24;
/**
 * A scheduled transition further away than this is treated as corrupt/stale data
 * (the WorldFactory seeds nextWeatherChangeAt with an over-long horizon) and is
 * re-aligned to the normal cadence. Forced weather up to 24h is preserved.
 */
const MAX_SENSIBLE_HORIZON_SIM_SECONDS = 24 * SIM_SECONDS_PER_GAME_HOUR;

/** Fallback row used only when the content table is missing a season/row. */
const FALLBACK_ROW: WeatherTransitionWeights = { clear: 30, cloudy: 40, rain: 20, wind: 10 };

function isWeatherType(value: string): value is WeatherType {
  return (WEATHER_TYPES as readonly string[]).includes(value);
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export class WeatherSystem implements IWeatherSystem {
  readonly id = 'weather';
  private ctx: IGameContext | null = null;
  private table: WeatherTransitionTable | null = null;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.table = ctx.content.getWeatherTable();
    const env = ctx.state.world.environment;
    const now = ctx.clock.simTimeSeconds;

    if (!isWeatherType(env.weather)) env.weather = 'clear';
    if (!isWeatherType(env.previousWeather)) env.previousWeather = env.weather;
    env.rainIntensity = clamp01(env.rainIntensity);
    env.fogDensity = clamp01(env.fogDensity);
    if (
      !Number.isFinite(env.nextWeatherChangeAt) ||
      env.nextWeatherChangeAt <= now ||
      env.nextWeatherChangeAt - now > MAX_SENSIBLE_HORIZON_SIM_SECONDS
    ) {
      env.nextWeatherChangeAt = now + WEATHER_INTERVAL_SIM_SECONDS;
    }
    if (!Array.isArray(env.recentWeather)) env.recentWeather = [];
    while (env.recentWeather.length > RECENT_WEATHER_LIMIT) env.recentWeather.shift();
    if (env.recentWeather.length === 0) {
      env.recentWeather.push({ at: now, weather: env.weather, temperature: env.temperature });
    }

    const tableErrors = this.validateTable();
    if (tableErrors.length > 0) ctx.logger.warn('Weather transition table incomplete', { errors: tableErrors });
  }

  private getCtx(): IGameContext {
    if (!this.ctx) throw new Error('WeatherSystem.init(ctx) was not called');
    return this.ctx;
  }

  private validateTable(): string[] {
    const errors: string[] = [];
    if (!this.table) return ['missing weather table'];
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      const seasonTable = this.table.bySeason[season];
      if (!seasonTable) {
        errors.push('missing season row set: ' + season);
        continue;
      }
      for (const source of WEATHER_TYPES) {
        const row = seasonTable[source];
        if (!row) {
          errors.push('missing weather row ' + season + '/' + source);
          continue;
        }
        const total = Object.values(row).reduce((sum, weight) => sum + (typeof weight === 'number' ? weight : 0), 0);
        if (total <= 0) errors.push('empty weather row ' + season + '/' + source);
      }
    }
    return errors;
  }

  update(_dtSimSeconds: number): void {
    const ctx = this.getCtx();
    const env = ctx.state.world.environment;
    const now = ctx.clock.simTimeSeconds;
    if (!Number.isFinite(env.nextWeatherChangeAt)) {
      env.nextWeatherChangeAt = now + WEATHER_INTERVAL_SIM_SECONDS;
      return;
    }

    let steps = 0;
    while (now >= env.nextWeatherChangeAt && steps < MAX_WEATHER_STEPS_PER_UPDATE) {
      const at = env.nextWeatherChangeAt;
      env.nextWeatherChangeAt = at + WEATHER_INTERVAL_SIM_SECONDS;
      this.transitionAt(at);
      steps += 1;
    }

    if (now >= env.nextWeatherChangeAt) {
      // Very large dt (offline catch-up): skip the backlog rather than emitting
      // thousands of transitions, but keep the schedule aligned to absolute time.
      const missed = Math.floor((now - env.nextWeatherChangeAt) / WEATHER_INTERVAL_SIM_SECONDS) + 1;
      env.nextWeatherChangeAt += missed * WEATHER_INTERVAL_SIM_SECONDS;
      ctx.logger.warn('Skipped weather transitions during long time step', { missed });
    }
  }

  // -------------------------------------------------------------------------
  // Transitions
  // -------------------------------------------------------------------------

  private transitionAt(atSimTime: number): void {
    const ctx = this.getCtx();
    const env = ctx.state.world.environment;
    const from = env.weather;
    const row = this.table?.bySeason[env.season]?.[from];
    const next = this.pickNextWeather(row, from);
    this.applyWeather(next, atSimTime, false);
    this.recordWeatherChange(atSimTime);
    this.emitWeatherChanged();
    if (next === 'storm' || next === 'snow') {
      addWorldHistory(ctx.state.world, {
        at: atSimTime,
        category: 'weather',
        description:
          next === 'storm'
            ? 'A violent storm sweeps across the region, rattling windows and bending the trees.'
            : 'Snow settles silently over the valley, softening every rooftop and hedge.',
        importance: next === 'storm' ? 3 : 2,
      });
    }
  }

  private pickNextWeather(row: WeatherTransitionWeights | undefined, fallbackFrom: WeatherType): WeatherType {
    const candidates: { weight: number; value: WeatherType }[] = [];
    const source = row ?? FALLBACK_ROW;
    for (const [key, weight] of Object.entries(source)) {
      if (typeof weight !== 'number' || weight <= 0) continue;
      if (!isWeatherType(key)) continue;
      candidates.push({ weight, value: key });
    }
    if (candidates.length === 0) return fallbackFrom === 'clear' ? 'cloudy' : 'clear';
    const picked = this.getCtx().rng.weighted('world.weather', candidates);
    return picked ?? 'cloudy';
  }

  private applyWeather(next: WeatherType, _atSimTime: number, forced: boolean): void {
    const ctx = this.getCtx();
    const env = ctx.state.world.environment;
    const previous = env.weather;
    env.previousWeather = previous;
    env.weather = next;
    const profile = WEATHER_PROFILES[next];
    env.rainIntensity = profile.rainIntensity;
    env.fogDensity = clamp01(1 - profile.visibility);

    if (forced) {
      env.windSpeed = clamp(profile.windSpeedBase, 0.02, 1.25);
      env.humidity = clamp01(profile.humidityBase);
      env.temperature = roundTo(SEASON_TEMPERATURE_BASE[env.season] + profile.temperatureDelta, 2);
    } else {
      env.windSpeed = clamp(lerp(env.windSpeed, profile.windSpeedBase, 0.6), 0.02, 1.25);
      env.humidity = clamp01(lerp(env.humidity, profile.humidityBase, 0.4));
      const temperatureTarget = SEASON_TEMPERATURE_BASE[env.season] + profile.temperatureDelta;
      env.temperature = roundTo(lerp(env.temperature, temperatureTarget, 0.3), 2);
    }
    env.windDirectionDeg = roundTo(
      normaliseDegrees(env.windDirectionDeg + ctx.rng.floatRange('world.environment', -55, 55)),
      1
    );
  }

  private recordWeatherChange(atSimTime: number): void {
    const env = this.getCtx().state.world.environment;
    env.recentWeather.push({ at: atSimTime, weather: env.weather, temperature: env.temperature });
    while (env.recentWeather.length > RECENT_WEATHER_LIMIT) env.recentWeather.shift();
  }

  private emitWeatherChanged(): void {
    const ctx = this.getCtx();
    const env = ctx.state.world.environment;
    ctx.bus.emit('weather:changed', {
      weather: env.weather,
      previous: env.previousWeather,
      temperature: env.temperature,
      windSpeed: env.windSpeed,
    });
  }

  // -------------------------------------------------------------------------
  // IWeatherSystem
  // -------------------------------------------------------------------------

  getWeather(): WeatherType {
    return this.getCtx().state.world.environment.weather;
  }

  getTemperature(): number {
    return this.getCtx().state.world.environment.temperature;
  }

  getWindSpeed(): number {
    return this.getCtx().state.world.environment.windSpeed;
  }

  getHumidity(): number {
    return this.getCtx().state.world.environment.humidity;
  }

  /**
   * Overrides the weather for a fixed duration (used by events/festivals).
   * The normal Markov schedule resumes afterwards.
   */
  forceWeather(weather: WeatherType, durationHours: number): void {
    const ctx = this.getCtx();
    const env = ctx.state.world.environment;
    const now = ctx.clock.simTimeSeconds;
    const safeHours = Number.isFinite(durationHours) ? Math.max(1, durationHours) : WEATHER_TRANSITION_INTERVAL_HOURS;
    this.applyWeather(weather, now, true);
    env.nextWeatherChangeAt = now + safeHours * SIM_SECONDS_PER_GAME_HOUR;
    this.recordWeatherChange(now);
    this.emitWeatherChanged();
    addWorldHistory(ctx.state.world, {
      at: now,
      category: 'weather',
      description: WEATHER_DISPLAY_NAMES[weather] + ' settles firmly over the region for a while.',
      importance: weather === 'storm' ? 3 : 2,
    });
    ctx.logger.info('Weather forced', { weather, durationHours: safeHours });
  }
}
