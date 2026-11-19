// Seasonal / day-phase generative music. Pure planning + note generation: the same
// season, phase, weather and indoor flag always produce the same plan and, for a given
// step counter, the same notes. No Math.random and no audio API access here.

import type { DayPhase, Season, WeatherType } from '../core/SharedTypes';
import { clamp, clamp01, hashStringToSeed, unitFloat } from './deterministic';
import { makeTone, midiToFrequency, type ToneEvent } from './voices';

export const MUSIC_LAYERS = ['pad', 'bass', 'arp', 'bell', 'counter'] as const;
export type MusicLayerId = (typeof MUSIC_LAYERS)[number];
export type MusicLayerGains = Record<MusicLayerId, number>;

/** Number of eighth-note steps in one musical bar (4/4 time). */
export const MUSIC_STEPS_PER_BAR = 8;

export interface ScaleDefinition {
  readonly id: string;
  /** Semitone offsets from the root for the seven degrees of the mode. */
  readonly intervals: readonly number[];
  /** MIDI note number of the mode root. */
  readonly rootMidi: number;
}

/**
 * One mode per season: Lydian (bright spring), Mixolydian (warm summer),
 * Aeolian (melancholy autumn) and Dorian (cold, sparse winter).
 */
export const MUSIC_SCALES: Readonly<Record<Season, ScaleDefinition>> = {
  spring: { id: 'spring-lydian', intervals: [0, 2, 4, 6, 7, 9, 11], rootMidi: 62 },
  summer: { id: 'summer-mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10], rootMidi: 60 },
  autumn: { id: 'autumn-aeolian', intervals: [0, 2, 3, 5, 7, 8, 10], rootMidi: 57 },
  winter: { id: 'winter-dorian', intervals: [0, 2, 3, 5, 7, 9, 10], rootMidi: 55 },
};

interface PhaseMood {
  readonly bpm: number;
  readonly density: number;
  readonly brightness: number;
  readonly register: number;
  readonly pad: number;
  readonly bass: number;
  readonly arp: number;
  readonly bell: number;
  readonly counter: number;
}

/** How the in-game day phase colours the arrangement. */
const PHASE_MOODS: Readonly<Record<DayPhase, PhaseMood>> = {
  dawn: { bpm: 70, density: 0.36, brightness: 0.58, register: -12, pad: 0.55, bass: 0.22, arp: 0.5, bell: 0.45, counter: 0.16 },
  morning: { bpm: 88, density: 0.6, brightness: 0.78, register: 0, pad: 0.45, bass: 0.28, arp: 0.72, bell: 0.4, counter: 0.08 },
  afternoon: { bpm: 94, density: 0.7, brightness: 0.85, register: 0, pad: 0.42, bass: 0.3, arp: 0.8, bell: 0.34, counter: 0.06 },
  evening: { bpm: 76, density: 0.42, brightness: 0.46, register: -5, pad: 0.6, bass: 0.26, arp: 0.5, bell: 0.5, counter: 0.34 },
  night: { bpm: 60, density: 0.2, brightness: 0.28, register: -12, pad: 0.68, bass: 0.3, arp: 0.26, bell: 0.3, counter: 0.5 },
};

interface WeatherMood {
  readonly bpmDelta: number;
  readonly densityDelta: number;
  readonly brightnessDelta: number;
  readonly gainScale: number;
  readonly padDelta: number;
  readonly arpDelta: number;
  readonly bellDelta: number;
}

/** Weather pulls the music darker/slower when the world is more dramatic. */
const WEATHER_MOODS: Readonly<Record<WeatherType, WeatherMood>> = {
  clear: { bpmDelta: 2, densityDelta: 0.06, brightnessDelta: 0.12, gainScale: 1, padDelta: 0, arpDelta: 0.06, bellDelta: 0.05 },
  cloudy: { bpmDelta: -2, densityDelta: 0, brightnessDelta: -0.06, gainScale: 0.96, padDelta: 0.02, arpDelta: -0.04, bellDelta: 0 },
  rain: { bpmDelta: -6, densityDelta: -0.08, brightnessDelta: -0.18, gainScale: 0.9, padDelta: 0.06, arpDelta: -0.12, bellDelta: -0.04 },
  storm: { bpmDelta: -12, densityDelta: -0.12, brightnessDelta: -0.3, gainScale: 0.72, padDelta: 0.12, arpDelta: -0.2, bellDelta: -0.1 },
  fog: { bpmDelta: -4, densityDelta: -0.06, brightnessDelta: -0.14, gainScale: 0.88, padDelta: 0.1, arpDelta: -0.1, bellDelta: 0 },
  snow: { bpmDelta: -8, densityDelta: -0.1, brightnessDelta: -0.05, gainScale: 0.86, padDelta: 0.08, arpDelta: -0.16, bellDelta: 0.16 },
  wind: { bpmDelta: -3, densityDelta: -0.02, brightnessDelta: -0.04, gainScale: 0.94, padDelta: 0.02, arpDelta: -0.02, bellDelta: 0.06 },
};

/** Four-bar chord root progressions (scale degrees) per season. */
const SEASON_PROGRESSIONS: Readonly<Record<Season, readonly number[]>> = {
  spring: [0, 4, 5, 3],
  summer: [0, 5, 3, 4],
  autumn: [0, 5, 2, 6],
  winter: [0, 3, 5, 0],
};

/** Arpeggio contours (chord-relative scale degrees) per season. */
const SEASON_ARP_PATTERNS: Readonly<Record<Season, readonly number[]>> = {
  spring: [0, 2, 4, 2],
  summer: [0, 4, 2, 7],
  autumn: [0, 2, 4, 2],
  winter: [0, 4, 2, 4],
};

const MIN_BPM = 45;
const MAX_BPM = 120;

export interface MusicPlan {
  readonly id: string;
  readonly season: Season;
  readonly phase: DayPhase;
  readonly weather: WeatherType;
  readonly indoor: boolean;
  readonly scale: ScaleDefinition;
  readonly bpm: number;
  readonly beatSeconds: number;
  /** Length of one eighth-note step in seconds. */
  readonly stepSeconds: number;
  /** Swing amount applied to off-beat eighth notes (fraction of a step). */
  readonly swing: number;
  readonly density: number;
  readonly brightness: number;
  readonly layerGains: MusicLayerGains;
  readonly progressionRoots: readonly number[];
  readonly arpPattern: readonly number[];
  readonly registerOffset: number;
}

export interface MusicInput {
  readonly season: Season;
  readonly phase: DayPhase;
  readonly weather: WeatherType;
  readonly indoor: boolean;
}

export function buildMusicPlan(input: Readonly<MusicInput>): MusicPlan {
  const mood = PHASE_MOODS[input.phase];
  const weather = WEATHER_MOODS[input.weather];
  const scale = MUSIC_SCALES[input.season];
  const indoor = input.indoor;

  const bpm = clamp(Math.round(mood.bpm + weather.bpmDelta + (indoor ? -2 : 0)), MIN_BPM, MAX_BPM);
  const beatSeconds = 60 / bpm;
  const brightness = clamp01(mood.brightness + weather.brightnessDelta + (indoor ? -0.18 : 0));
  const density = clamp01(mood.density + weather.densityDelta + (indoor ? -0.06 : 0));
  const gainScale = weather.gainScale * (indoor ? 0.9 : 1);

  return {
    id: `${input.season}-${input.phase}-${input.weather}-${indoor ? 'indoor' : 'outdoor'}`,
    season: input.season,
    phase: input.phase,
    weather: input.weather,
    indoor,
    scale,
    bpm,
    beatSeconds,
    stepSeconds: beatSeconds / 2,
    swing: 0.06 + (input.season === 'summer' ? 0.04 : 0) + (input.phase === 'night' ? 0.02 : 0),
    density,
    brightness,
    layerGains: {
      pad: clamp01((mood.pad + weather.padDelta + (indoor ? 0.14 : 0)) * gainScale),
      bass: clamp01(mood.bass * gainScale),
      arp: clamp01((mood.arp + weather.arpDelta + (indoor ? -0.16 : 0)) * gainScale),
      bell: clamp01((mood.bell + weather.bellDelta + (indoor ? -0.12 : 0)) * gainScale),
      counter: clamp01(mood.counter * gainScale),
    },
    progressionRoots: SEASON_PROGRESSIONS[input.season],
    arpPattern: SEASON_ARP_PATTERNS[input.season],
    registerOffset: mood.register + (indoor ? -2 : 0),
  };
}

/** Converts a chord-relative scale degree (may be negative or > 6) to a MIDI note. */
export function degreeToMidi(plan: MusicPlan, degree: number): number {
  const normalized = ((degree % 7) + 7) % 7;
  const octave = Math.floor(degree / 7);
  const semitone = plan.scale.intervals[normalized] ?? 0;
  return clamp(Math.round(plan.scale.rootMidi + semitone + octave * 12 + plan.registerOffset), 24, 96);
}

/** Root degree of the chord that plays in the given bar. */
export function chordRootForBar(plan: MusicPlan, bar: number): number {
  const roots = plan.progressionRoots;
  const index = ((bar % roots.length) + roots.length) % roots.length;
  return roots[index] ?? 0;
}

/** Three sustained pad notes (root, third, fifth) for a bar, in a low register. */
export function padChordMidi(plan: MusicPlan, bar: number): readonly number[] {
  const root = chordRootForBar(plan, bar);
  return [
    clamp(degreeToMidi(plan, root) - 12, 24, 84),
    clamp(degreeToMidi(plan, root + 2) - 12, 24, 84),
    clamp(degreeToMidi(plan, root + 4) - 12, 24, 84),
  ];
}

export interface MusicNote extends ToneEvent {
  readonly layer: MusicLayerId;
  readonly midi: number;
}

function makeMusicNote(
  plan: MusicPlan,
  layer: MusicLayerId,
  degree: number,
  durationSeconds: number,
  gain: number,
  pan: number
): MusicNote {
  const midi = degreeToMidi(plan, degree);
  const frequency = midiToFrequency(midi);
  const waveform = layer === 'bass' ? 'triangle' : layer === 'bell' ? 'sine' : layer === 'arp' ? 'triangle' : 'sine';
  const filter = layer === 'bass' ? { filterHz: 420 } : layer === 'bell' ? { filterHz: 5200 } : {};
  const tone = makeTone({
    durationSeconds,
    frequencyStart: frequency,
    frequencyEnd: frequency,
    waveform,
    gain: clamp(gain, 0, 0.2),
    attackSeconds: layer === 'bass' ? 0.05 : 0.02,
    releaseSeconds: Math.min(0.6, durationSeconds * 0.5),
    pan: clamp(pan, -0.8, 0.8),
    ...filter,
  });
  return { ...tone, layer, midi };
}

/**
 * Generates the notes that should start on the given eighth-note step.
 * Pure and deterministic: identical (plan, step) always returns identical notes.
 */
export function musicStepEvents(plan: MusicPlan, stepIndex: number): MusicNote[] {
  const notes: MusicNote[] = [];
  const safeStep = Math.max(0, Math.floor(stepIndex));
  const seed = hashStringToSeed(`${plan.id}|melody`);
  const bar = Math.floor(safeStep / MUSIC_STEPS_PER_BAR);
  const stepInBar = safeStep % MUSIC_STEPS_PER_BAR;
  const chordRoot = chordRootForBar(plan, bar);
  const stepSeconds = plan.stepSeconds;
  const pan = (salt: number): number => unitFloat(seed, safeStep, salt) * 1.6 - 0.8;

  // Bass: chord root an octave below the pad, once per bar.
  if (stepInBar === 0 && plan.layerGains.bass > 0.01) {
    notes.push(makeMusicNote(plan, 'bass', chordRoot - 7, stepSeconds * 3.4, 0.085 + plan.layerGains.bass * 0.04, pan(11)));
  }

  // Arpeggio: chord-tone eighths, thinned out by plan density and the arp layer gain.
  if (plan.layerGains.arp > 0.01 && unitFloat(seed, safeStep, 21) < 0.32 + plan.density * 0.62) {
    const pattern = plan.arpPattern;
    const offset = pattern[stepInBar % pattern.length] ?? 0;
    const gain = 0.03 + unitFloat(seed, safeStep, 22) * 0.03;
    notes.push(makeMusicNote(plan, 'arp', chordRoot + offset, stepSeconds * 0.85, gain, pan(23)));
  }

  // Bell: sparse high chord tones on the second half of the bar.
  if ((stepInBar === 4 || stepInBar === 6) && unitFloat(seed, safeStep, 31) < plan.density * 0.5) {
    if (plan.layerGains.bell > 0.01) {
      const degree = chordRoot + (unitFloat(seed, safeStep, 32) < 0.5 ? 7 : 9);
      notes.push(makeMusicNote(plan, 'bell', degree, stepSeconds * 3.2, 0.024 + plan.layerGains.bell * 0.02, pan(33)));
    }
  }

  // Counter melody: long, low chord tone every other bar for evening/night/dawn moods.
  if (stepInBar === 0 && bar % 2 === 1 && plan.layerGains.counter > 0.12) {
    notes.push(makeMusicNote(plan, 'counter', chordRoot + 2, stepSeconds * 5.6, 0.032 + plan.layerGains.counter * 0.025, 0));
  }

  return notes;
}

/** A stable description of the plan used for change detection in the manager. */
export function musicPlanKey(plan: MusicPlan): string {
  return plan.id;
}
