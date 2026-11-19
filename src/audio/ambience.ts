// Weather / season / location ambience planning plus deterministic scheduling helpers
// for thunder, fire crackle and wildlife one-shots. Pure: no Web Audio, no Math.random.

import type { DayPhase, RegionId, Season, WeatherType } from '../core/SharedTypes';
import { clamp, clamp01, unitFloat } from './deterministic';
import { makeTone, type ToneEvent, type VoiceFilterType, type Waveform } from './voices';

export const AMBIENCE_LAYERS = [
  'rain',
  'rainHeavy',
  'wind',
  'snowHush',
  'fogDrone',
  'fireCrackle',
  'roomTone',
  'outdoorMuffle',
  'birds',
  'crickets',
  'cityHum',
] as const;

export type AmbienceLayerId = (typeof AMBIENCE_LAYERS)[number];
export type AmbienceLayerGains = Record<AmbienceLayerId, number>;
export type NoiseColour = 'white' | 'pink' | 'brown';

export interface AmbienceLayerConfig {
  readonly kind: 'noise' | 'oscillator';
  readonly noiseColour: NoiseColour;
  readonly waveform: Waveform;
  readonly frequencyHz: number;
  readonly filterType: VoiceFilterType;
  readonly filterHz: number;
  readonly q: number;
  /** Slow level wobble rate in Hz; 0 disables the LFO. */
  readonly lfoHz: number;
  /** LFO depth as a fraction of the current target gain. */
  readonly lfoDepth: number;
}

/**
 * Static synthesis recipe per ambience layer. The plan below only supplies target
 * gains; these recipes define the (fixed) colour of each bed so a plan change never
 * has to rebuild audio nodes - it just crossfades gains.
 */
export const AMBIENCE_LAYER_CONFIGS: Readonly<Record<AmbienceLayerId, AmbienceLayerConfig>> = {
  rain: { kind: 'noise', noiseColour: 'pink', waveform: 'sine', frequencyHz: 0, filterType: 'bandpass', filterHz: 2350, q: 0.45, lfoHz: 0.13, lfoDepth: 0.2 },
  rainHeavy: { kind: 'noise', noiseColour: 'brown', waveform: 'sine', frequencyHz: 0, filterType: 'lowpass', filterHz: 420, q: 0.8, lfoHz: 0.07, lfoDepth: 0.18 },
  wind: { kind: 'noise', noiseColour: 'brown', waveform: 'sine', frequencyHz: 0, filterType: 'lowpass', filterHz: 360, q: 0.9, lfoHz: 0.09, lfoDepth: 0.45 },
  snowHush: { kind: 'noise', noiseColour: 'pink', waveform: 'sine', frequencyHz: 0, filterType: 'lowpass', filterHz: 950, q: 0.3, lfoHz: 0.05, lfoDepth: 0.12 },
  fogDrone: { kind: 'oscillator', noiseColour: 'pink', waveform: 'sine', frequencyHz: 58, filterType: 'lowpass', filterHz: 180, q: 0.6, lfoHz: 0.04, lfoDepth: 0.25 },
  fireCrackle: { kind: 'noise', noiseColour: 'pink', waveform: 'sine', frequencyHz: 0, filterType: 'bandpass', filterHz: 2700, q: 1.1, lfoHz: 0.21, lfoDepth: 0.3 },
  roomTone: { kind: 'noise', noiseColour: 'brown', waveform: 'sine', frequencyHz: 0, filterType: 'lowpass', filterHz: 320, q: 0.4, lfoHz: 0.03, lfoDepth: 0.08 },
  outdoorMuffle: { kind: 'noise', noiseColour: 'brown', waveform: 'sine', frequencyHz: 0, filterType: 'lowpass', filterHz: 170, q: 0.5, lfoHz: 0.06, lfoDepth: 0.15 },
  birds: { kind: 'noise', noiseColour: 'pink', waveform: 'sine', frequencyHz: 0, filterType: 'bandpass', filterHz: 3200, q: 0.7, lfoHz: 0.17, lfoDepth: 0.2 },
  crickets: { kind: 'noise', noiseColour: 'white', waveform: 'sine', frequencyHz: 0, filterType: 'bandpass', filterHz: 4800, q: 0.9, lfoHz: 0.23, lfoDepth: 0.35 },
  cityHum: { kind: 'oscillator', noiseColour: 'brown', waveform: 'triangle', frequencyHz: 54, filterType: 'lowpass', filterHz: 190, q: 0.7, lfoHz: 0.05, lfoDepth: 0.1 },
};

const BIRD_SEASON_ACTIVITY: Readonly<Record<Season, number>> = { spring: 0.9, summer: 0.7, autumn: 0.4, winter: 0.12 };
const BIRD_PHASE_ACTIVITY: Readonly<Record<DayPhase, number>> = { dawn: 1, morning: 0.9, afternoon: 0.45, evening: 0.35, night: 0 };
const BIRD_WEATHER_ACTIVITY: Readonly<Record<WeatherType, number>> = {
  clear: 1,
  cloudy: 0.65,
  wind: 0.5,
  fog: 0.35,
  rain: 0.15,
  snow: 0.12,
  storm: 0,
};
const CRICKET_SEASON_ACTIVITY: Readonly<Record<Season, number>> = { spring: 0.45, summer: 0.9, autumn: 0.55, winter: 0 };

export interface AmbienceInput {
  readonly weather: WeatherType;
  readonly season: Season;
  readonly phase: DayPhase;
  readonly indoor: boolean;
  readonly regionId: RegionId;
  readonly hasHeatSource: boolean;
  /** Environment wind speed in the units used by EnvironmentState. */
  readonly windSpeed: number;
  /** 0..1 rain strength. */
  readonly rainIntensity: number;
}

export interface AmbiencePlan {
  readonly id: string;
  readonly weather: WeatherType;
  readonly season: Season;
  readonly phase: DayPhase;
  readonly indoor: boolean;
  readonly regionId: RegionId;
  readonly layerGains: AmbienceLayerGains;
  /** 0..1 storm thunder likelihood; 0 if no thunder should play. */
  readonly thunderActivity: number;
  readonly stormIntensity: number;
  readonly fireIntensity: number;
  readonly birdActivity: number;
  readonly cricketActivity: number;
  /** 1 outdoors, 0.22 indoors (informational; the layer gains already include it). */
  readonly muffle: number;
}

function zeroLayerGains(): AmbienceLayerGains {
  return {
    rain: 0,
    rainHeavy: 0,
    wind: 0,
    snowHush: 0,
    fogDrone: 0,
    fireCrackle: 0,
    roomTone: 0,
    outdoorMuffle: 0,
    birds: 0,
    crickets: 0,
    cityHum: 0,
  };
}

/** Builds the target ambience mix for the current world scene. */
export function buildAmbiencePlan(input: Readonly<AmbienceInput>): AmbiencePlan {
  const rainIntensity = clamp01(input.rainIntensity);
  const wind = clamp01(input.windSpeed / 30);
  const gains = zeroLayerGains();
  const weather = input.weather;
  const stormy = weather === 'storm';
  const wet = weather === 'rain' || stormy;

  let rain = 0;
  let rainHeavy = 0;
  let windLayer = wind * 0.16;
  let snow = 0;
  let fog = 0;

  if (weather === 'rain') {
    rain = 0.2 + rainIntensity * 0.32;
    rainHeavy = 0.04 + rainIntensity * 0.1;
    windLayer += 0.05 + wind * 0.12;
  } else if (stormy) {
    rain = 0.3 + rainIntensity * 0.34;
    rainHeavy = 0.12 + rainIntensity * 0.2;
    windLayer += 0.16 + wind * 0.28;
  } else if (weather === 'snow') {
    snow = 0.14 + rainIntensity * 0.14;
    windLayer += 0.03 + wind * 0.1;
  } else if (weather === 'fog') {
    fog = 0.14 + rainIntensity * 0.1;
  } else if (weather === 'wind') {
    windLayer += 0.2 + wind * 0.34;
  } else if (weather === 'cloudy') {
    windLayer += wind * 0.06;
  } else {
    windLayer += wind * 0.08;
  }

  if (input.season === 'winter') windLayer += 0.03;
  if (input.season === 'autumn') windLayer += 0.02;

  rain = clamp01(rain);
  rainHeavy = clamp01(rainHeavy);
  windLayer = clamp01(windLayer);
  snow = clamp01(snow);
  fog = clamp01(fog);

  const muffle = input.indoor ? 0.22 : 1;
  gains.rain = rain * muffle;
  gains.rainHeavy = rainHeavy * muffle;
  gains.wind = windLayer * muffle;
  gains.snowHush = snow * muffle;
  gains.fogDrone = fog * muffle;
  gains.outdoorMuffle = input.indoor ? clamp01((rain + rainHeavy + windLayer + snow + fog) * 0.4) : 0;
  gains.roomTone = input.indoor ? (wet || stormy ? 0.26 : 0.2) : 0;
  gains.fireCrackle = input.indoor ? (input.hasHeatSource ? 0.55 : 0.1) : 0;
  gains.cityHum = input.regionId === 'ashford' ? (input.indoor ? 0.06 : 0.14) : 0;
  gains.birds = clamp01(BIRD_SEASON_ACTIVITY[input.season] * BIRD_PHASE_ACTIVITY[input.phase] * BIRD_WEATHER_ACTIVITY[weather]) * muffle;

  const cricketWeather = stormy ? 0 : weather === 'rain' ? 0.08 : weather === 'snow' ? 0 : 1;
  gains.crickets =
    clamp01(input.phase === 'night' ? CRICKET_SEASON_ACTIVITY[input.season] * cricketWeather * 0.6 : 0) * muffle;

  return {
    id: `${weather}|${input.season}|${input.phase}|${input.indoor ? 'in' : 'out'}|${input.regionId}|${
      input.hasHeatSource ? 'heat' : 'cold'
    }|w${Math.round(wind * 10)}|r${Math.round(rainIntensity * 10)}`,
    weather,
    season: input.season,
    phase: input.phase,
    indoor: input.indoor,
    regionId: input.regionId,
    layerGains: gains,
    thunderActivity: stormy ? (input.indoor ? 0.55 : 1) : 0,
    stormIntensity: stormy ? clamp01(0.4 + rainIntensity * 0.6) : 0,
    fireIntensity: gains.fireCrackle,
    birdActivity: gains.birds,
    cricketActivity: gains.crickets,
    muffle,
  };
}

// ---------------------------------------------------------------------------
// Deterministic one-shot scheduling helpers (thunder, fire pops, wildlife)
// ---------------------------------------------------------------------------

const THUNDER_SEED = 0x7f4a7c15;
const FIRE_SEED = 0x51ed270b;
const BIRD_SEED = 0x2f9d2c4e;
const CRICKET_SEED = 0x6d2b79f5;

export interface ThunderProfile {
  /** Delay before the initial crack reaches the listener. */
  readonly delaySeconds: number;
  readonly rumbleSeconds: number;
  readonly peakGain: number;
  readonly crackGain: number;
  readonly lowpassHz: number;
  /** Number of rolling re-swells after the main rumble burst. */
  readonly rollCount: number;
}

/** Deterministic thunder character; near strikes are louder, brighter and longer. */
export function thunderProfile(counter: number): ThunderProfile {
  const safe = Math.max(0, Math.floor(counter));
  const proximity = clamp01(1 - unitFloat(THUNDER_SEED, safe, 1) * 0.85);
  return {
    delaySeconds: 0.03 + unitFloat(THUNDER_SEED, safe, 2) * 0.26,
    rumbleSeconds: 2 + unitFloat(THUNDER_SEED, safe, 3) * 3,
    peakGain: 0.12 + proximity * 0.4,
    crackGain: 0.08 + proximity * 0.3,
    lowpassHz: 240 + proximity * 540,
    rollCount: 2 + Math.floor(unitFloat(THUNDER_SEED, safe, 4) * 3),
  };
}

/** Seconds until the next thunder event; more active storms produce closer strikes. */
export function nextThunderDelay(counter: number, activity: number): number {
  const safeActivity = clamp(activity, 0.15, 1);
  const base = 4 + unitFloat(THUNDER_SEED, Math.max(0, Math.floor(counter)), 5) * 10;
  return base / safeActivity;
}

export interface FireCrackleProfile {
  readonly delaySeconds: number;
  readonly durationSeconds: number;
  readonly gain: number;
  readonly bandpassHz: number;
  readonly pops: number;
}

export function fireCrackleProfile(counter: number): FireCrackleProfile {
  const safe = Math.max(0, Math.floor(counter));
  return {
    delaySeconds: unitFloat(FIRE_SEED, safe, 1) * 0.03,
    durationSeconds: 0.03 + unitFloat(FIRE_SEED, safe, 2) * 0.09,
    gain: 0.05 + unitFloat(FIRE_SEED, safe, 3) * 0.14,
    bandpassHz: 1800 + unitFloat(FIRE_SEED, safe, 4) * 2400,
    pops: 1 + Math.floor(unitFloat(FIRE_SEED, safe, 5) * 2),
  };
}

/** Seconds until the next ember pop; hotter fires crackle more often. */
export function nextFireCrackleDelay(counter: number, intensity: number): number {
  const safe = clamp(intensity, 0.05, 1);
  return (0.05 + unitFloat(FIRE_SEED, Math.max(0, Math.floor(counter)), 2) * 0.42) / safe;
}

export interface Chirp {
  readonly kind: 'bird' | 'cricket';
  readonly events: readonly ToneEvent[];
  readonly totalSeconds: number;
}

/** Deterministic bird chirp: 2-4 quick rising/falling whistles in a realistic register. */
export function birdChirp(counter: number): Chirp {
  const safe = Math.max(0, Math.floor(counter));
  const events: ToneEvent[] = [];
  const count = 2 + Math.floor(unitFloat(BIRD_SEED, safe, 1) * 3);
  const base = 2100 + unitFloat(BIRD_SEED, safe, 2) * 2600;
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const indexSeed = safe * 13 + index;
    const duration = 0.035 + unitFloat(BIRD_SEED, indexSeed, 3) * 0.05;
    const start = base * (0.9 + unitFloat(BIRD_SEED, indexSeed, 4) * 0.35);
    const end = start * (0.7 + unitFloat(BIRD_SEED, indexSeed, 5) * 0.5);
    events.push(
      makeTone({
        offsetSeconds: offset,
        durationSeconds: duration,
        frequencyStart: start,
        frequencyEnd: end,
        waveform: 'sine',
        gain: 0.018 + unitFloat(BIRD_SEED, indexSeed, 6) * 0.022,
        attackSeconds: 0.004,
        releaseSeconds: 0.03,
        pan: unitFloat(BIRD_SEED, indexSeed, 7) * 1.4 - 0.7,
      })
    );
    offset += duration + 0.03 + unitFloat(BIRD_SEED, indexSeed, 8) * 0.06;
  }
  return { kind: 'bird', events, totalSeconds: offset };
}

/** Deterministic cricket chirp: 3-6 fast high pulses. */
export function cricketChirp(counter: number): Chirp {
  const safe = Math.max(0, Math.floor(counter));
  const events: ToneEvent[] = [];
  const count = 3 + Math.floor(unitFloat(CRICKET_SEED, safe, 1) * 4);
  const base = 3900 + unitFloat(CRICKET_SEED, safe, 2) * 1200;
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const indexSeed = safe * 17 + index;
    const duration = 0.012 + unitFloat(CRICKET_SEED, indexSeed, 3) * 0.012;
    events.push(
      makeTone({
        offsetSeconds: offset,
        durationSeconds: duration,
        frequencyStart: base,
        frequencyEnd: base * 0.94,
        waveform: 'sine',
        gain: 0.012 + unitFloat(CRICKET_SEED, indexSeed, 4) * 0.012,
        attackSeconds: 0.002,
        releaseSeconds: 0.01,
        pan: unitFloat(CRICKET_SEED, indexSeed, 5) * 1.6 - 0.8,
      })
    );
    offset += duration + 0.018;
  }
  return { kind: 'cricket', events, totalSeconds: offset };
}

export function nextBirdChirpDelay(counter: number, activity: number): number {
  const safe = clamp(activity, 0.05, 1);
  return (1.2 + unitFloat(BIRD_SEED, Math.max(0, Math.floor(counter)), 9) * 4.8) / safe;
}

export function nextCricketChirpDelay(counter: number, activity: number): number {
  const safe = clamp(activity, 0.05, 1);
  return (0.5 + unitFloat(CRICKET_SEED, Math.max(0, Math.floor(counter)), 9) * 1.8) / safe;
}
