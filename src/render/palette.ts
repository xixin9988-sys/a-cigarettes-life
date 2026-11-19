import type { RegionId, Season, WeatherType } from '../core/SharedTypes';

/**
 * Colour palettes for the procedural pixel-art renderer.
 *
 * Everything here is pure data + maths so it can be unit-tested in Node without
 * booting Phaser. Scenes consume these palettes through {@link seasonPalette},
 * {@link dayNightPalette}, {@link weatherVisual}, {@link regionPalette} and
 * {@link locationPalette}.
 */

export interface SeasonPalette {
  season: Season;
  grass: number;
  grassAlt: number;
  grassShadow: number;
  path: number;
  pathAlt: number;
  water: number;
  waterDeep: number;
  waterLight: number;
  foliage: number;
  foliageLight: number;
  foliageDark: number;
  blossom: number;
  trunk: number;
  rock: number;
  soil: number;
  flower: number;
  flowerAlt: number;
  /** Ambient seasonal particle colour (petals / leaves / fireflies / snow motes). */
  particle: number;
  groundDecor: number;
  snow: number;
}

const SPRING: SeasonPalette = {
  season: 'spring',
  grass: 0x7cae58,
  grassAlt: 0x8cc063,
  grassShadow: 0x66964a,
  path: 0xc7b78c,
  pathAlt: 0xb7a678,
  water: 0x4e93b4,
  waterDeep: 0x356f8e,
  waterLight: 0x7cc0da,
  foliage: 0x5f9e4a,
  foliageLight: 0x8ac86a,
  foliageDark: 0x3f7036,
  blossom: 0xf2bcd4,
  trunk: 0x6f5238,
  rock: 0x8f8f96,
  soil: 0x8a6a4a,
  flower: 0xe478a2,
  flowerAlt: 0xf0c651,
  particle: 0xf6c8dc,
  groundDecor: 0x6a9a4e,
  snow: 0xe8eef2,
};

const SUMMER: SeasonPalette = {
  season: 'summer',
  grass: 0x6a9f42,
  grassAlt: 0x7bb650,
  grassShadow: 0x54852f,
  path: 0xd2bf8b,
  pathAlt: 0xc2ad78,
  water: 0x3f8fae,
  waterDeep: 0x2c6f8e,
  waterLight: 0x66bede,
  foliage: 0x4d8a3a,
  foliageLight: 0x72b851,
  foliageDark: 0x33611f,
  blossom: 0xf6d678,
  trunk: 0x6a4f36,
  rock: 0x8a8a92,
  soil: 0x7f5f42,
  flower: 0xe8c74a,
  flowerAlt: 0xe87a6a,
  particle: 0xfff0b8,
  groundDecor: 0x5c8c34,
  snow: 0xe8eef2,
};

const AUTUMN: SeasonPalette = {
  season: 'autumn',
  grass: 0x94854a,
  grassAlt: 0xa3965a,
  grassShadow: 0x7e7040,
  path: 0xc0a97b,
  pathAlt: 0xb0986a,
  water: 0x4c7e9c,
  waterDeep: 0x3a6480,
  waterLight: 0x7aa8c2,
  foliage: 0xc07832,
  foliageLight: 0xdc9c46,
  foliageDark: 0x8a5624,
  blossom: 0xe8a040,
  trunk: 0x705034,
  rock: 0x90888a,
  soil: 0x7c5a3c,
  flower: 0xd06a3a,
  flowerAlt: 0xc8a040,
  particle: 0xd88a3a,
  groundDecor: 0x8a7638,
  snow: 0xe8eef2,
};

const WINTER: SeasonPalette = {
  season: 'winter',
  grass: 0x9fb0b2,
  grassAlt: 0xb0c0c2,
  grassShadow: 0x8a9a9c,
  path: 0xc4ccd0,
  pathAlt: 0xb6bec2,
  water: 0x5a7f9e,
  waterDeep: 0x44688a,
  waterLight: 0x8cb0cc,
  foliage: 0x5c7a6a,
  foliageLight: 0x7a9a86,
  foliageDark: 0x3f5c50,
  blossom: 0xdfe8ec,
  trunk: 0x5f4a38,
  rock: 0x9aa0a6,
  soil: 0x6f5c4a,
  flower: 0xd8e4ea,
  flowerAlt: 0xc0d0d8,
  particle: 0xffffff,
  groundDecor: 0x8ea0a2,
  snow: 0xe8eef2,
};

export const SEASON_PALETTES: Readonly<Record<Season, SeasonPalette>> = {
  spring: SPRING,
  summer: SUMMER,
  autumn: AUTUMN,
  winter: WINTER,
};

export function seasonPalette(season: Season | string): SeasonPalette {
  if (season === 'summer') return SUMMER;
  if (season === 'autumn') return AUTUMN;
  if (season === 'winter') return WINTER;
  return SPRING;
}

// ---------------------------------------------------------------------------
// Region palettes (architecture style)
// ---------------------------------------------------------------------------

export interface RegionPalette {
  roofA: number;
  roofB: number;
  wallA: number;
  wallB: number;
  trim: number;
  accent: number;
  windowLit: number;
  sign: number;
  post: number;
  awning: number;
  awningAlt: number;
  road: number;
  roadAlt: number;
  pavement: number;
  glass: number;
  fence: number;
}

const WILLOWBROOK_REGION_PALETTE: RegionPalette = {
  roofA: 0x8a4a3a,
  roofB: 0x5a4a5a,
  wallA: 0xd8c8a8,
  wallB: 0xb8a88c,
  trim: 0x6a4a32,
  accent: 0x9a5a3a,
  windowLit: 0xffd98a,
  sign: 0xc9b48a,
  post: 0x5a4a3a,
  awning: 0x9a4f3f,
  awningAlt: 0x4f6a8a,
  road: 0x8a8070,
  roadAlt: 0x7a7062,
  pavement: 0xb8ac94,
  glass: 0x9fc0d0,
  fence: 0x8a7350,
};

const ASHFORD_REGION_PALETTE: RegionPalette = {
  roofA: 0x5a5a66,
  roofB: 0x3f4450,
  wallA: 0xa8a8b0,
  wallB: 0x8a8a96,
  trim: 0x4a4a52,
  accent: 0x5c6b8a,
  windowLit: 0xffe0a0,
  sign: 0xb8c4d0,
  post: 0x4a4a52,
  awning: 0x3f6f8a,
  awningAlt: 0x8a4f6a,
  road: 0x5c5c62,
  roadAlt: 0x505056,
  pavement: 0x9a9aa0,
  glass: 0x9ab4c8,
  fence: 0x6a6a72,
};

export function regionPalette(regionId: RegionId | string): RegionPalette {
  return regionId === 'ashford' ? ASHFORD_REGION_PALETTE : WILLOWBROOK_REGION_PALETTE;
}

// ---------------------------------------------------------------------------
// Day / night gradient
// ---------------------------------------------------------------------------

export type DayStage = 'day' | 'golden' | 'dusk' | 'twilight' | 'night';

export interface DayNightPalette {
  stage: DayStage;
  skyTop: number;
  skyBottom: number;
  horizon: number;
  cloud: number;
  /** Full-screen colour tint laid over the world. */
  ambientColor: number;
  ambientAlpha: number;
  /** 0..1 - how strongly ember / lantern glows read at this light level. */
  emberBoost: number;
  /** 0..1 - window / street-lamp strength. */
  lightStrength: number;
  starAlpha: number;
}

interface DayAnchor {
  at: number;
  p: Omit<DayNightPalette, 'stage'>;
}

/** Anchors are keyed by daylight (0 = midnight, 1 = noon) and lerped between. */
const DAY_ANCHORS: readonly DayAnchor[] = [
  {
    at: 0,
    p: {
      skyTop: 0x070b1e,
      skyBottom: 0x161c3a,
      horizon: 0x1e2440,
      cloud: 0x2a3050,
      ambientColor: 0x050a1c,
      ambientAlpha: 0.5,
      emberBoost: 1,
      lightStrength: 1,
      starAlpha: 1,
    },
  },
  {
    at: 0.18,
    p: {
      skyTop: 0x141a3c,
      skyBottom: 0x3c3a6a,
      horizon: 0x4a4060,
      cloud: 0x5a5470,
      ambientColor: 0x0c1430,
      ambientAlpha: 0.34,
      emberBoost: 0.75,
      lightStrength: 0.85,
      starAlpha: 0.8,
    },
  },
  {
    at: 0.42,
    p: {
      skyTop: 0x4a3a72,
      skyBottom: 0xd08060,
      horizon: 0xc07860,
      cloud: 0x8a6a80,
      ambientColor: 0x3a2a5a,
      ambientAlpha: 0.18,
      emberBoost: 0.45,
      lightStrength: 0.6,
      starAlpha: 0.35,
    },
  },
  {
    at: 0.7,
    p: {
      skyTop: 0xcf8a5a,
      skyBottom: 0xf2d0a0,
      horizon: 0xf0c890,
      cloud: 0xf8dcc0,
      ambientColor: 0x3a1f2a,
      ambientAlpha: 0.07,
      emberBoost: 0.2,
      lightStrength: 0.25,
      starAlpha: 0.05,
    },
  },
  {
    at: 1,
    p: {
      skyTop: 0x4f9ad0,
      skyBottom: 0xbcdcea,
      horizon: 0xd8e8ea,
      cloud: 0xffffff,
      ambientColor: 0xfff0d0,
      ambientAlpha: 0.02,
      emberBoost: 0,
      lightStrength: 0,
      starAlpha: 0,
    },
  },
];

const FALLBACK_ANCHOR: DayAnchor = {
  at: 0.5,
  p: {
    skyTop: 0x4a3a72,
    skyBottom: 0xd08060,
    horizon: 0xc07860,
    cloud: 0x8a6a80,
    ambientColor: 0x3a2a5a,
    ambientAlpha: 0.18,
    emberBoost: 0.45,
    lightStrength: 0.6,
    starAlpha: 0.35,
  },
};

function anchorAt(daylight: number): { low: DayAnchor; high: DayAnchor; t: number } {
  const d = clamp(daylight, 0, 1);
  let low: DayAnchor = DAY_ANCHORS[0] ?? FALLBACK_ANCHOR;
  let high: DayAnchor = DAY_ANCHORS[DAY_ANCHORS.length - 1] ?? FALLBACK_ANCHOR;
  for (let index = 0; index < DAY_ANCHORS.length - 1; index += 1) {
    const a = DAY_ANCHORS[index];
    const b = DAY_ANCHORS[index + 1];
    if (a && b && d >= a.at && d <= b.at) {
      low = a;
      high = b;
      break;
    }
  }
  const span = high.at - low.at;
  const t = span <= 0 ? 0 : clamp01((d - low.at) / span);
  return { low, high, t };
}

function stageFor(daylight: number): DayStage {
  if (daylight >= 0.82) return 'day';
  if (daylight >= 0.55) return 'golden';
  if (daylight >= 0.3) return 'dusk';
  if (daylight >= 0.12) return 'twilight';
  return 'night';
}

/** Smooth day/night palette interpolated from the daylight value in EnvironmentState. */
export function dayNightPalette(daylight: number): DayNightPalette {
  const { low, high, t } = anchorAt(daylight);
  return {
    stage: stageFor(daylight),
    skyTop: mixColor(low.p.skyTop, high.p.skyTop, t),
    skyBottom: mixColor(low.p.skyBottom, high.p.skyBottom, t),
    horizon: mixColor(low.p.horizon, high.p.horizon, t),
    cloud: mixColor(low.p.cloud, high.p.cloud, t),
    ambientColor: mixColor(low.p.ambientColor, high.p.ambientColor, t),
    ambientAlpha: lerp(low.p.ambientAlpha, high.p.ambientAlpha, t),
    emberBoost: lerp(low.p.emberBoost, high.p.emberBoost, t),
    lightStrength: lerp(low.p.lightStrength, high.p.lightStrength, t),
    starAlpha: lerp(low.p.starAlpha, high.p.starAlpha, t),
  };
}

export function daylightStage(daylight: number): DayStage {
  return stageFor(daylight);
}

// ---------------------------------------------------------------------------
// Weather visuals
// ---------------------------------------------------------------------------

export interface WeatherVisual {
  /** Full-screen tint colour. */
  tint: number;
  tintAlpha: number;
  /** 0..1 cloud cover used by the sky backdrop. */
  cloudiness: number;
  /** Colour used by fog blobs. */
  fogTint: number;
  /** 0..1 darkening multiplier for the sky. */
  skyDarken: number;
}

const WEATHER_VISUALS: Readonly<Record<WeatherType, WeatherVisual>> = {
  clear: { tint: 0x000000, tintAlpha: 0, cloudiness: 0, fogTint: 0xdde4ea, skyDarken: 0 },
  cloudy: { tint: 0x5a6470, tintAlpha: 0.1, cloudiness: 0.55, fogTint: 0xdde4ea, skyDarken: 0.12 },
  rain: { tint: 0x46566c, tintAlpha: 0.16, cloudiness: 0.85, fogTint: 0xdde4ea, skyDarken: 0.28 },
  storm: { tint: 0x242c3c, tintAlpha: 0.28, cloudiness: 1, fogTint: 0xc8d2d8, skyDarken: 0.46 },
  fog: { tint: 0xc8d2d8, tintAlpha: 0.12, cloudiness: 0.6, fogTint: 0xdde4ea, skyDarken: 0.18 },
  snow: { tint: 0xd8e4ee, tintAlpha: 0.1, cloudiness: 0.7, fogTint: 0xe8f0f6, skyDarken: 0.16 },
  wind: { tint: 0x9a8a70, tintAlpha: 0.04, cloudiness: 0.3, fogTint: 0xdde4ea, skyDarken: 0.04 },
};

export function weatherVisual(weather: WeatherType, rainIntensity = 0, fogDensity = 0): WeatherVisual {
  const base = WEATHER_VISUALS[weather] ?? WEATHER_VISUALS.clear;
  let tintAlpha = base.tintAlpha;
  if (weather === 'rain' || weather === 'storm') tintAlpha = clamp(base.tintAlpha + rainIntensity * 0.06, 0, 0.5);
  if (weather === 'fog') tintAlpha = clamp(base.tintAlpha + fogDensity * 0.1, 0, 0.45);
  return {
    tint: base.tint,
    tintAlpha,
    cloudiness: clamp01(base.cloudiness + rainIntensity * 0.1),
    fogTint: base.fogTint,
    skyDarken: clamp01(base.skyDarken + rainIntensity * 0.1),
  };
}

// ---------------------------------------------------------------------------
// Interior palettes
// ---------------------------------------------------------------------------

export interface LocationPalette {
  floor: number;
  floorAlt: number;
  accent: number;
  wall: number;
  wallAlt: number;
  trim: number;
  /** Window / lamp light colour for this interior. */
  light: number;
}

/** Derives an interior palette from the authored LocationDef colours. */
export function locationPalette(floorColor: string, accentColor: string, indoor: boolean): LocationPalette {
  const floor = colorFromHex(floorColor, indoor ? 0x9a7f5e : 0x8a9a6a);
  const accent = colorFromHex(accentColor, 0x7a5a3a);
  return {
    floor,
    floorAlt: shade(floor, 0.9),
    accent,
    wall: indoor ? shade(mixColor(floor, 0xf0e6d4, 0.4), 0.94) : shade(accent, 0.8),
    wallAlt: indoor ? shade(mixColor(floor, 0xf0e6d4, 0.4), 0.82) : shade(accent, 0.66),
    trim: shade(accent, 0.72),
    light: indoor ? 0xffcf8a : 0xffe6b8,
  };
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Parses '#rrggbb', 'rrggbb' or numeric 0xrrggbb. Returns the fallback when invalid. */
export function colorFromHex(hex: string, fallback: number): number {
  if (typeof hex !== 'string') return fallback;
  const trimmed = hex.trim().replace(/^#/, '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
      const r = trimmed[0] ?? '0';
      const g = trimmed[1] ?? '0';
      const b = trimmed[2] ?? '0';
      return Number.parseInt(r + r + g + g + b + b, 16);
    }
    return fallback;
  }
  const value = Number.parseInt(trimmed, 16);
  return Number.isFinite(value) ? value : fallback;
}

export function colorToCss(color: number): string {
  return '#' + (color >>> 0).toString(16).padStart(6, '0').slice(-6);
}

function channel(color: number, shift: number): number {
  return (color >> shift) & 0xff;
}

/** Component-wise linear mix, t clamped to 0..1. */
export function mixColor(a: number, b: number, t: number): number {
  const tt = clamp01(t);
  const r = Math.round(lerp(channel(a, 16), channel(b, 16), tt));
  const g = Math.round(lerp(channel(a, 8), channel(b, 8), tt));
  const bl = Math.round(lerp(channel(a, 0), channel(b, 0), tt));
  return (r << 16) | (g << 8) | bl;
}

/** Multiplies every channel: factor < 1 darkens, > 1 lightens. */
export function shade(color: number, factor: number): number {
  const f = Math.max(0, factor);
  const r = clamp(Math.round(channel(color, 16) * f), 0, 255);
  const g = clamp(Math.round(channel(color, 8) * f), 0, 255);
  const b = clamp(Math.round(channel(color, 0) * f), 0, 255);
  return (r << 16) | (g << 8) | b;
}

/** Adds a flat amount to each channel (used for rim light / highlights). */
export function lighten(color: number, amount: number): number {
  const r = clamp(channel(color, 16) + amount, 0, 255);
  const g = clamp(channel(color, 8) + amount, 0, 255);
  const b = clamp(channel(color, 0) + amount, 0, 255);
  return (r << 16) | (g << 8) | b;
}
