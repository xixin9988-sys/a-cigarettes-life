import type { IGameContext } from '../core/contracts';
import type { Season, WeatherType } from '../core/SharedTypes';
import { SEASON_DAYLIGHT_HOURS, SEASON_TEMPERATURE_BASE, WEATHER_PROFILES, WORLD_CONFIG } from '../core/WorldConfig';
import { hourFloat, simSecondsToGameTime } from '../core/TimeUtil';
import { clamp, clamp01, hashString, lerp } from '../core/utils';

/**
 * OWNER: Agent 4 (World & Map).
 *
 * Owns the *physical* environment fields:
 *   temperature, humidity, windSpeed, windDirectionDeg, daylight.
 *
 * The calendar fields (season/day/year) are owned by SeasonSystem and the
 * weather state by WeatherSystem; this system reads both and interpolates the
 * physical values smoothly towards weather/season/time-of-day targets.
 *
 * Design notes:
 *  - Physical values are integrated once per absolute
 *    `WORLD_CONFIG.simulation.environmentIntervalGameMinutes` bucket, so the
 *    result is independent of the frame/offline step size and survives save/load
 *    (no sub-interval accumulator is persisted).
 *  - Wind gusts/direction drift use a deterministic smooth-noise function of the
 *    world seed and absolute time. That keeps the environment fully
 *    reproducible (no hidden RNG draws) and offline-safe; gameplay uncertainty
 *    still goes exclusively through the probability engine.
 */

/** Seconds of absolute sim time between environment integration steps
 * (1 simulated second = 1 in-game minute, so 15 in-game minutes = 15 sim seconds). */
export const ENVIRONMENT_INTERVAL_SIM_SECONDS = WORLD_CONFIG.simulation.environmentIntervalGameMinutes;
/** Upper bound on integration steps performed in a single update (offline safety). */
export const MAX_ENVIRONMENT_STEPS_PER_UPDATE = 96;

const TEMPERATURE_RESPONSE_HOURS = 3;
const HUMIDITY_RESPONSE_HOURS = 1.5;
const WIND_RESPONSE_HOURS = 1;
const WIND_DIRECTION_RESPONSE_HOURS = 4;
/** Hours of dusk/dawn twilight around sunrise/sunset. */
const TWILIGHT_HOURS = 1;

const ENV_INTERVAL_HOURS = WORLD_CONFIG.simulation.environmentIntervalGameMinutes / 60;

/** Normalises an angle in degrees into [0, 360). */
export function normaliseDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Shortest signed angular difference from `from` to `to` in degrees. */
export function shortestAngleDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/**
 * Natural daylight in 0..1 from season and hour-of-day.
 * Sunrise/sunset are derived from SEASON_DAYLIGHT_HOURS, with a one-hour
 * twilight ramp on both sides. The day plateau peaks at 1.0 at solar noon.
 */
export function computeDaylight(season: Season, hour: number): number {
  const daylightHours = SEASON_DAYLIGHT_HOURS[season];
  const sunrise = 12 - daylightHours / 2;
  const sunset = 12 + daylightHours / 2;
  if (hour >= sunrise && hour <= sunset) {
    const progress = (hour - sunrise) / Math.max(0.001, daylightHours);
    return clamp01(0.55 + 0.45 * Math.sin(Math.PI * progress));
  }
  if (hour < sunrise) {
    const t = (hour - (sunrise - TWILIGHT_HOURS)) / TWILIGHT_HOURS;
    return t <= 0 ? 0 : clamp01(0.55 * t * t);
  }
  const t = (sunset + TWILIGHT_HOURS - hour) / TWILIGHT_HOURS;
  return t <= 0 ? 0 : clamp01(0.55 * t * t);
}

/** Temperature the environment is slowly moving towards (degrees C). */
export function computeTargetTemperature(season: Season, weather: WeatherType, hour: number): number {
  const profile = WEATHER_PROFILES[weather];
  // Warmest around 15:00, coldest around 03:00 (+/- 4 C).
  const diurnal = 4 * Math.cos(((hour - 15) / 24) * Math.PI * 2);
  return SEASON_TEMPERATURE_BASE[season] + profile.temperatureDelta + diurnal;
}

/** Relative humidity (0..1) the environment is slowly moving towards. */
export function computeTargetHumidity(season: Season, weather: WeatherType, hour: number): number {
  const profile = WEATHER_PROFILES[weather];
  // Humidity peaks before dawn and dips mid-afternoon.
  const nightFactor = 0.5 - 0.5 * Math.cos(((hour - 15) / 24) * Math.PI * 2);
  const seasonBias = season === 'autumn' ? 0.05 : season === 'winter' ? 0.03 : season === 'summer' ? -0.05 : 0;
  return clamp01(profile.humidityBase + 0.06 * nightFactor + seasonBias);
}

/** 1D value noise in [-1, 1], smooth (cubic) between integer buckets. */
export function smoothNoise(seed: number, x: number): number {
  const bucket = Math.floor(x);
  const fraction = x - bucket;
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return lerp(noiseBucket(seed, bucket), noiseBucket(seed, bucket + 1), smooth);
}

function noiseBucket(seed: number, bucket: number): number {
  const value = hashString(seed + '#' + bucket) / 0xffffffff;
  return value * 2 - 1;
}

/** Wind speed (0..1.25) target including deterministic gusts. */
export function computeTargetWindSpeed(seed: number, weather: WeatherType, atSimSeconds: number): number {
  const base = WEATHER_PROFILES[weather].windSpeedBase;
  // 30 game-minute gust wavelength.
  const gust = 0.14 * smoothNoise(seed ^ 0x51ed270b, atSimSeconds / 30);
  return clamp(base + gust, 0.02, 1.25);
}

/** Prevailing wind direction target in degrees (south-westerly, drifting slowly). */
export function computeTargetWindDirectionDeg(seed: number, weather: WeatherType, atSimSeconds: number): number {
  const base = 200 + (seed % 80);
  const weatherBias = weather === 'wind' ? 35 : weather === 'storm' ? 55 : weather === 'fog' ? -25 : 0;
  // 4 game-hour drift wavelength.
  const drift = 90 * smoothNoise(seed ^ 0x2545f491, atSimSeconds / 240);
  return normaliseDegrees(base + weatherBias + drift);
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function alphaFor(hours: number, responseHours: number): number {
  return 1 - Math.exp(-hours / responseHours);
}

export class EnvironmentSystem {
  private ctx: IGameContext | null = null;
  private lastIntervalBucket = -1;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    const env = ctx.state.world.environment;
    // Repair potentially corrupt values from old saves.
    if (!Number.isFinite(env.temperature)) env.temperature = SEASON_TEMPERATURE_BASE[env.season];
    if (!Number.isFinite(env.humidity)) env.humidity = 0.5;
    if (!Number.isFinite(env.windSpeed)) env.windSpeed = 0.2;
    if (!Number.isFinite(env.windDirectionDeg)) env.windDirectionDeg = 225;
    env.humidity = clamp01(env.humidity);
    env.daylight = computeDaylight(env.season, hourFloat(ctx.clock.time));
    this.lastIntervalBucket = Math.floor(ctx.clock.simTimeSeconds / ENVIRONMENT_INTERVAL_SIM_SECONDS);
  }

  private getCtx(): IGameContext {
    if (!this.ctx) throw new Error('EnvironmentSystem.init(ctx) was not called');
    return this.ctx;
  }

  update(_dtSimSeconds: number): void {
    const ctx = this.getCtx();
    const env = ctx.state.world.environment;
    const now = ctx.clock.simTimeSeconds;

    // Daylight is continuous and always current (dusk rendering, NPC schedules).
    env.daylight = computeDaylight(env.season, hourFloat(ctx.clock.time));

    const bucket = Math.floor(now / ENVIRONMENT_INTERVAL_SIM_SECONDS);
    if (bucket < this.lastIntervalBucket) {
      // Clock was rewound (debug/tests): resync without simulating backwards.
      this.lastIntervalBucket = bucket;
      return;
    }
    if (bucket <= this.lastIntervalBucket) return;

    let steps = bucket - this.lastIntervalBucket;
    if (this.lastIntervalBucket < 0 || steps > MAX_ENVIRONMENT_STEPS_PER_UPDATE) {
      steps = Math.max(1, Math.min(steps, MAX_ENVIRONMENT_STEPS_PER_UPDATE));
    }
    for (let i = 0; i < steps; i += 1) {
      const stepTime = (bucket - steps + i + 1) * ENVIRONMENT_INTERVAL_SIM_SECONDS;
      this.advanceEnvironment(stepTime);
    }
    this.lastIntervalBucket = bucket;
  }

  /** One fixed-size integration step towards the current environmental targets. */
  private advanceEnvironment(stepTime: number): void {
    const ctx = this.getCtx();
    const env = ctx.state.world.environment;
    const stepGameTime = simSecondsToGameTime(stepTime);
    const hour = hourFloat(stepGameTime);
    const season = stepGameTime.season;
    const weather = env.weather;
    const seed = ctx.state.world.seed >>> 0;

    const temperatureTarget = computeTargetTemperature(season, weather, hour);
    const humidityTarget = computeTargetHumidity(season, weather, hour);
    const windTarget = computeTargetWindSpeed(seed, weather, stepTime);
    const directionTarget = computeTargetWindDirectionDeg(seed, weather, stepTime);

    env.temperature = roundTo(
      lerp(env.temperature, temperatureTarget, alphaFor(ENV_INTERVAL_HOURS, TEMPERATURE_RESPONSE_HOURS)),
      2
    );
    env.humidity = roundTo(
      clamp01(lerp(env.humidity, humidityTarget, alphaFor(ENV_INTERVAL_HOURS, HUMIDITY_RESPONSE_HOURS))),
      3
    );
    env.windSpeed = roundTo(
      clamp(lerp(env.windSpeed, windTarget, alphaFor(ENV_INTERVAL_HOURS, WIND_RESPONSE_HOURS)), 0, 1.25),
      3
    );
    const directionAlpha = alphaFor(ENV_INTERVAL_HOURS, WIND_DIRECTION_RESPONSE_HOURS);
    env.windDirectionDeg = roundTo(
      normaliseDegrees(env.windDirectionDeg + shortestAngleDelta(env.windDirectionDeg, directionTarget) * directionAlpha),
      1
    );
  }

  // -------------------------------------------------------------------------
  // Read helpers (UI / tests; WeatherSystem exposes the IWeatherSystem versions)
  // -------------------------------------------------------------------------

  getDaylight(): number {
    return this.getCtx().state.world.environment.daylight;
  }

  getTemperature(): number {
    return this.getCtx().state.world.environment.temperature;
  }

  getHumidity(): number {
    return this.getCtx().state.world.environment.humidity;
  }

  getWindSpeed(): number {
    return this.getCtx().state.world.environment.windSpeed;
  }

  getWindDirectionDeg(): number {
    return this.getCtx().state.world.environment.windDirectionDeg;
  }

  /** True during the brighter half of the day (daylight >= 0.5). */
  isDay(): boolean {
    return this.getCtx().state.world.environment.daylight >= 0.5;
  }
}
