import type { Season, WeatherType } from '../core/SharedTypes';
import { clamp, clamp01, lerp, normalizeDegrees, seededValue, type Vec2 } from './geometry';

/**
 * Pure weather/ambient effect profiles. The scene-side WeatherFXController turns
 * these numbers into pooled sprites; keeping the maths here makes it testable.
 */

export interface PrecipitationProfile {
  count: number;
  /** Pixels per second falling speed. */
  speed: number;
  /** Horizontal drift in pixels per second. */
  driftX: number;
  /** Streak length in pixels (rain only). */
  length: number;
  alpha: number;
  size: number;
}

export function rainProfile(windSpeed: number, rainIntensity: number): PrecipitationProfile {
  const intensity = clamp01(rainIntensity);
  const wind = clamp(windSpeed, 0, 1.5);
  return {
    count: Math.round(lerp(40, 260, intensity)),
    speed: lerp(420, 720, intensity),
    driftX: (wind - 0.3) * 220,
    length: lerp(7, 15, intensity),
    alpha: lerp(0.28, 0.55, intensity),
    size: 1,
  };
}

export interface SnowProfile {
  count: number;
  speed: number;
  driftX: number;
  swayAmplitude: number;
  swaySpeed: number;
  alpha: number;
  size: number;
}

export function snowProfile(windSpeed: number, intensity: number): SnowProfile {
  const i = clamp01(intensity);
  const wind = clamp(windSpeed, 0, 1.5);
  return {
    count: Math.round(lerp(30, 150, i)),
    speed: lerp(26, 52, i),
    driftX: (wind - 0.25) * 34,
    swayAmplitude: lerp(6, 18, i),
    swaySpeed: lerp(0.6, 1.4, i),
    alpha: lerp(0.6, 0.9, i),
    size: 2,
  };
}

export interface FogProfile {
  alpha: number;
  blobs: number;
  speed: number;
}

export function fogProfile(fogDensity: number): FogProfile {
  const d = clamp01(fogDensity);
  return {
    alpha: lerp(0.05, 0.3, d),
    blobs: Math.round(lerp(3, 9, d)),
    speed: lerp(4, 14, d),
  };
}

export interface WindDustProfile {
  count: number;
  speed: number;
  alpha: number;
}

export function windDustProfile(windSpeed: number): WindDustProfile {
  const wind = clamp01(windSpeed);
  return {
    count: Math.round(lerp(4, 34, wind)),
    speed: lerp(60, 220, wind),
    alpha: lerp(0.06, 0.22, wind),
  };
}

export type AmbientKind = 'petal' | 'leaf' | 'firefly' | 'mote' | 'none';

/**
 * Seasonal ambient particle kind. Fireflies only appear on dark summer nights;
 * motes cover bright winter days and quiet summer afternoons.
 */
export function ambientKind(season: Season | string, daylight: number): AmbientKind {
  const light = clamp01(daylight);
  if (season === 'spring') return 'petal';
  if (season === 'autumn') return 'leaf';
  if (season === 'winter') return 'mote';
  if (season === 'summer') return light < 0.25 ? 'firefly' : 'mote';
  return 'none';
}

export interface AmbientProfile {
  kind: AmbientKind;
  count: number;
  speed: number;
  alpha: number;
  color: number;
  glow: boolean;
}

export function ambientProfile(season: Season | string, daylight: number): AmbientProfile {
  const kind = ambientKind(season, daylight);
  switch (kind) {
    case 'petal':
      return { kind, count: 26, speed: 18, alpha: 0.85, color: 0xf6c8dc, glow: false };
    case 'leaf':
      return { kind, count: 22, speed: 26, alpha: 0.9, color: 0xd88a3a, glow: false };
    case 'firefly':
      return { kind, count: 30, speed: 12, alpha: 0.95, color: 0xe8f078, glow: true };
    case 'mote':
      return { kind, count: 20, speed: 8, alpha: 0.5, color: season === 'winter' ? 0xffffff : 0xfff2c0, glow: false };
    default:
      return { kind, count: 0, speed: 0, alpha: 0, color: 0xffffff, glow: false };
  }
}

/** True when a storm bolt should be visible this frame (deterministic schedule). */
export function lightningFlash(simTimeSeconds: number, worldSeed: number): number {
  const period = 7 + (worldSeed % 6);
  const offset = (worldSeed >>> 8) % period;
  const local = (simTimeSeconds + offset) % period;
  // Double-strike envelope: main flash, brief darkness, smaller echo.
  if (local < 0.05) return 1;
  if (local < 0.2) return 0.55 * (1 - (local - 0.05) / 0.15);
  if (local < 0.34) return 0;
  if (local < 0.46) return 0.32 * (1 - (local - 0.34) / 0.12);
  return 0;
}

/** A deterministic jagged lightning bolt polyline from (x, startY) down to endY. */
export function lightningBolt(seed: number, x: number, startY: number, endY: number, segments = 7): Vec2[] {
  const points: Vec2[] = [];
  const span = endY - startY;
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const jitter = index === 0 || index === segments ? 0 : (seededValue(seed, index) - 0.5) * 34;
    points.push({ x: x + jitter, y: startY + span * t });
  }
  return points;
}

/** Wraps a cloud's x position across the scene at a wind-driven speed. */
export function cloudOffset(simTimeSeconds: number, windSpeed: number, baseX: number, width: number): number {
  const speed = 2 + clamp(windSpeed, 0, 1.5) * 9;
  const range = width + 200;
  return (((baseX + simTimeSeconds * speed) % range) + range) % range - 100;
}

export function precipitationKind(weather: WeatherType, season: Season | string): 'rain' | 'snow' | 'none' {
  if (weather === 'snow') return 'snow';
  if (weather === 'rain' || weather === 'storm') return season === 'winter' ? 'snow' : 'rain';
  if (season === 'winter' && (weather === 'cloudy' || weather === 'wind')) return 'snow';
  return 'none';
}

/** Sun / moon position along the sky arc, 0..1 across the day. */
export function celestialProgress(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return clamp01((h - 5) / 15);
}

/** 0..1 star twinkle for a given star index and time. */
export function starTwinkle(index: number, simTimeSeconds: number): number {
  return 0.55 + 0.45 * Math.sin(simTimeSeconds * (0.6 + (index % 5) * 0.17) + index * 1.7);
}

export function windSway(index: number, windSpeed: number, simTimeSeconds: number): number {
  const amplitude = 0.004 + clamp01(windSpeed) * 0.02;
  return Math.sin(simTimeSeconds * (0.9 + (index % 7) * 0.11) + index * 1.3) * amplitude;
}

export function fogBlobOffset(index: number, blobs: number, simTimeSeconds: number, speed: number, width: number): number {
  const lane = (index + 0.5) / Math.max(1, blobs);
  const drift = simTimeSeconds * speed * (0.5 + ((index * 7) % 10) / 10);
  return (((lane * (width + 400) + drift) % (width + 400)) + width + 400) % (width + 400) - 200;
}

export function temperatureBreath(simTimeSeconds: number): number {
  return 0.5 + 0.5 * Math.sin(simTimeSeconds * 1.7);
}

export function normaliseWeatherTime(simTimeSeconds: number): number {
  return normalizeDegrees(simTimeSeconds);
}
