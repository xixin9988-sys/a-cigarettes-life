// UI / gameplay sound-effect catalogue. Each cue is a small deterministic multi-voice
// recipe (tones + filtered noise) rendered by synth.ts. No external audio assets.

import { hashStringToSeed, unitFloat } from './deterministic';
import { makeNoise, makeTone, type VoiceEvent } from './voices';

export type SoundName =
  | 'ui_click'
  | 'ui_open'
  | 'ui_close'
  | 'ui_error'
  | 'success'
  | 'coin'
  | 'item_get'
  | 'level_up'
  | 'fish_bite'
  | 'fish_catch'
  | 'fish_escape'
  | 'harvest'
  | 'craft'
  | 'save'
  | 'warning'
  | 'dialogue_blip'
  | 'footstep';

export const SOUND_NAMES: readonly SoundName[] = [
  'ui_click',
  'ui_open',
  'ui_close',
  'ui_error',
  'success',
  'coin',
  'item_get',
  'level_up',
  'fish_bite',
  'fish_catch',
  'fish_escape',
  'harvest',
  'craft',
  'save',
  'warning',
  'dialogue_blip',
  'footstep',
];

export interface SfxDefinition {
  readonly name: SoundName;
  /** Overall cue level multiplier applied on top of each voice gain. */
  readonly gain: number;
  /** Minimum seconds between two plays of the same cue (spam protection). */
  readonly throttleSeconds: number;
  /** Maximum number of simultaneously playing instances of this cue. */
  readonly maxConcurrent: number;
  readonly events: readonly VoiceEvent[];
}

const SFX_SEED = 0x4be1f00d;

const SFX_TABLE: Readonly<Record<SoundName, SfxDefinition>> = {
  ui_click: {
    name: 'ui_click',
    gain: 0.7,
    throttleSeconds: 0.035,
    maxConcurrent: 3,
    events: [
      makeNoise({ durationSeconds: 0.02, gain: 0.05, filterType: 'highpass', filterStartHz: 3200, filterEndHz: 2400, attackSeconds: 0.001, releaseSeconds: 0.015 }),
      makeTone({ durationSeconds: 0.05, frequencyStart: 780, frequencyEnd: 540, waveform: 'square', gain: 0.06, attackSeconds: 0.002, releaseSeconds: 0.04 }),
    ],
  },
  ui_open: {
    name: 'ui_open',
    gain: 0.75,
    throttleSeconds: 0.05,
    maxConcurrent: 3,
    events: [
      makeTone({ durationSeconds: 0.11, frequencyStart: 440, frequencyEnd: 660, waveform: 'triangle', gain: 0.08, attackSeconds: 0.008, releaseSeconds: 0.08 }),
      makeTone({ offsetSeconds: 0.07, durationSeconds: 0.12, frequencyStart: 880, frequencyEnd: 990, waveform: 'sine', gain: 0.045, attackSeconds: 0.01, releaseSeconds: 0.1 }),
      makeNoise({ durationSeconds: 0.06, gain: 0.025, filterType: 'bandpass', filterStartHz: 2400, filterEndHz: 3000, q: 0.8, attackSeconds: 0.006, releaseSeconds: 0.05 }),
    ],
  },
  ui_close: {
    name: 'ui_close',
    gain: 0.7,
    throttleSeconds: 0.05,
    maxConcurrent: 3,
    events: [
      makeTone({ durationSeconds: 0.1, frequencyStart: 620, frequencyEnd: 400, waveform: 'triangle', gain: 0.07, attackSeconds: 0.006, releaseSeconds: 0.08 }),
      makeTone({ offsetSeconds: 0.04, durationSeconds: 0.12, frequencyStart: 330, frequencyEnd: 260, waveform: 'sine', gain: 0.04, attackSeconds: 0.01, releaseSeconds: 0.1 }),
    ],
  },
  ui_error: {
    name: 'ui_error',
    gain: 0.85,
    throttleSeconds: 0.18,
    maxConcurrent: 2,
    events: [
      makeTone({ durationSeconds: 0.16, frequencyStart: 170, frequencyEnd: 120, waveform: 'sawtooth', gain: 0.1, attackSeconds: 0.005, releaseSeconds: 0.12 }),
      makeTone({ offsetSeconds: 0.09, durationSeconds: 0.14, frequencyStart: 120, frequencyEnd: 100, waveform: 'square', gain: 0.05, attackSeconds: 0.005, releaseSeconds: 0.1 }),
      makeNoise({ durationSeconds: 0.12, gain: 0.03, filterType: 'lowpass', filterStartHz: 700, filterEndHz: 400, attackSeconds: 0.005, releaseSeconds: 0.09 }),
    ],
  },
  success: {
    name: 'success',
    gain: 0.8,
    throttleSeconds: 0.12,
    maxConcurrent: 3,
    events: [
      makeTone({ durationSeconds: 0.18, frequencyStart: 523.25, waveform: 'sine', gain: 0.07, attackSeconds: 0.008, releaseSeconds: 0.14 }),
      makeTone({ offsetSeconds: 0.07, durationSeconds: 0.2, frequencyStart: 659.25, waveform: 'sine', gain: 0.065, attackSeconds: 0.008, releaseSeconds: 0.16 }),
      makeTone({ offsetSeconds: 0.14, durationSeconds: 0.26, frequencyStart: 783.99, waveform: 'triangle', gain: 0.06, attackSeconds: 0.01, releaseSeconds: 0.22 }),
    ],
  },
  coin: {
    name: 'coin',
    gain: 0.75,
    throttleSeconds: 0.03,
    maxConcurrent: 4,
    events: [
      makeTone({ durationSeconds: 0.07, frequencyStart: 1046.5, frequencyEnd: 1174.66, waveform: 'square', gain: 0.05, attackSeconds: 0.002, releaseSeconds: 0.06 }),
      makeTone({ offsetSeconds: 0.06, durationSeconds: 0.1, frequencyStart: 1567.98, waveform: 'square', gain: 0.035, attackSeconds: 0.002, releaseSeconds: 0.09 }),
    ],
  },
  item_get: {
    name: 'item_get',
    gain: 0.75,
    throttleSeconds: 0.04,
    maxConcurrent: 4,
    events: [
      makeTone({ durationSeconds: 0.09, frequencyStart: 740, frequencyEnd: 1040, waveform: 'sine', gain: 0.05, attackSeconds: 0.006, releaseSeconds: 0.07 }),
      makeTone({ offsetSeconds: 0.07, durationSeconds: 0.12, frequencyStart: 1480, waveform: 'triangle', gain: 0.03, attackSeconds: 0.004, releaseSeconds: 0.1 }),
      makeNoise({ durationSeconds: 0.06, gain: 0.02, filterType: 'highpass', filterStartHz: 2800, filterEndHz: 2400, attackSeconds: 0.004, releaseSeconds: 0.05 }),
    ],
  },
  level_up: {
    name: 'level_up',
    gain: 0.9,
    throttleSeconds: 0.5,
    maxConcurrent: 1,
    events: [
      makeTone({ durationSeconds: 0.16, frequencyStart: 523.25, waveform: 'triangle', gain: 0.07, attackSeconds: 0.01, releaseSeconds: 0.12 }),
      makeTone({ offsetSeconds: 0.1, durationSeconds: 0.18, frequencyStart: 659.25, waveform: 'triangle', gain: 0.07, attackSeconds: 0.01, releaseSeconds: 0.14 }),
      makeTone({ offsetSeconds: 0.2, durationSeconds: 0.2, frequencyStart: 783.99, waveform: 'triangle', gain: 0.07, attackSeconds: 0.01, releaseSeconds: 0.16 }),
      makeTone({ offsetSeconds: 0.3, durationSeconds: 0.34, frequencyStart: 1046.5, waveform: 'sine', gain: 0.075, attackSeconds: 0.012, releaseSeconds: 0.28 }),
      makeNoise({ offsetSeconds: 0.3, durationSeconds: 0.25, gain: 0.02, filterType: 'highpass', filterStartHz: 4200, filterEndHz: 5000, attackSeconds: 0.02, releaseSeconds: 0.2 }),
    ],
  },
  fish_bite: {
    name: 'fish_bite',
    gain: 0.85,
    throttleSeconds: 0.1,
    maxConcurrent: 3,
    events: [
      makeTone({ durationSeconds: 0.07, frequencyStart: 520, frequencyEnd: 600, waveform: 'square', gain: 0.065, attackSeconds: 0.002, releaseSeconds: 0.05 }),
      makeTone({ offsetSeconds: 0.1, durationSeconds: 0.07, frequencyStart: 560, frequencyEnd: 640, waveform: 'square', gain: 0.06, attackSeconds: 0.002, releaseSeconds: 0.05 }),
      makeNoise({ offsetSeconds: 0.02, durationSeconds: 0.12, gain: 0.03, filterType: 'bandpass', filterStartHz: 1200, filterEndHz: 900, q: 0.9, attackSeconds: 0.004, releaseSeconds: 0.09 }),
    ],
  },
  fish_catch: {
    name: 'fish_catch',
    gain: 0.85,
    throttleSeconds: 0.25,
    maxConcurrent: 2,
    events: [
      makeTone({ durationSeconds: 0.16, frequencyStart: 740, frequencyEnd: 988, waveform: 'sine', gain: 0.06, attackSeconds: 0.008, releaseSeconds: 0.12 }),
      makeTone({ offsetSeconds: 0.1, durationSeconds: 0.26, frequencyStart: 1175, waveform: 'sine', gain: 0.05, attackSeconds: 0.01, releaseSeconds: 0.22 }),
      makeNoise({ offsetSeconds: 0.02, durationSeconds: 0.28, gain: 0.035, filterType: 'bandpass', filterStartHz: 1800, filterEndHz: 700, q: 0.9, attackSeconds: 0.01, releaseSeconds: 0.22 }),
    ],
  },
  fish_escape: {
    name: 'fish_escape',
    gain: 0.8,
    throttleSeconds: 0.25,
    maxConcurrent: 2,
    events: [
      makeTone({ durationSeconds: 0.22, frequencyStart: 240, frequencyEnd: 150, waveform: 'sawtooth', gain: 0.06, attackSeconds: 0.008, releaseSeconds: 0.18 }),
      makeNoise({ durationSeconds: 0.24, gain: 0.03, filterType: 'lowpass', filterStartHz: 900, filterEndHz: 400, attackSeconds: 0.01, releaseSeconds: 0.18 }),
    ],
  },
  harvest: {
    name: 'harvest',
    gain: 0.8,
    throttleSeconds: 0.06,
    maxConcurrent: 3,
    events: [
      makeTone({ durationSeconds: 0.12, frequencyStart: 620, frequencyEnd: 380, waveform: 'triangle', gain: 0.06, attackSeconds: 0.004, releaseSeconds: 0.1 }),
      makeNoise({ durationSeconds: 0.14, gain: 0.04, filterType: 'bandpass', filterStartHz: 1400, filterEndHz: 900, q: 0.7, attackSeconds: 0.008, releaseSeconds: 0.11 }),
    ],
  },
  craft: {
    name: 'craft',
    gain: 0.8,
    throttleSeconds: 0.06,
    maxConcurrent: 3,
    events: [
      makeTone({ durationSeconds: 0.07, frequencyStart: 470, waveform: 'square', gain: 0.05, attackSeconds: 0.002, releaseSeconds: 0.06 }),
      makeTone({ offsetSeconds: 0.05, durationSeconds: 0.16, frequencyStart: 940, frequencyEnd: 880, waveform: 'triangle', gain: 0.04, attackSeconds: 0.004, releaseSeconds: 0.13 }),
      makeNoise({ durationSeconds: 0.06, gain: 0.025, filterType: 'highpass', filterStartHz: 2400, filterEndHz: 3200, attackSeconds: 0.002, releaseSeconds: 0.05 }),
    ],
  },
  save: {
    name: 'save',
    gain: 0.75,
    throttleSeconds: 0.4,
    maxConcurrent: 1,
    events: [
      makeTone({ durationSeconds: 0.16, frequencyStart: 620, frequencyEnd: 830, waveform: 'sine', gain: 0.055, attackSeconds: 0.012, releaseSeconds: 0.13 }),
      makeTone({ offsetSeconds: 0.12, durationSeconds: 0.18, frequencyStart: 930, waveform: 'sine', gain: 0.035, attackSeconds: 0.012, releaseSeconds: 0.15 }),
    ],
  },
  warning: {
    name: 'warning',
    gain: 0.9,
    throttleSeconds: 0.35,
    maxConcurrent: 2,
    events: [
      makeTone({ durationSeconds: 0.16, frequencyStart: 220, frequencyEnd: 190, waveform: 'sawtooth', gain: 0.06, attackSeconds: 0.006, releaseSeconds: 0.12 }),
      makeTone({ offsetSeconds: 0.17, durationSeconds: 0.16, frequencyStart: 185, frequencyEnd: 160, waveform: 'sawtooth', gain: 0.055, attackSeconds: 0.006, releaseSeconds: 0.12 }),
      makeTone({ durationSeconds: 0.3, frequencyStart: 110, waveform: 'sine', gain: 0.03, attackSeconds: 0.02, releaseSeconds: 0.2 }),
    ],
  },
  dialogue_blip: {
    name: 'dialogue_blip',
    gain: 0.6,
    throttleSeconds: 0.035,
    maxConcurrent: 4,
    events: [
      makeTone({ durationSeconds: 0.035, frequencyStart: 640, frequencyEnd: 600, waveform: 'square', gain: 0.035, attackSeconds: 0.001, releaseSeconds: 0.028 }),
    ],
  },
  footstep: {
    name: 'footstep',
    gain: 0.55,
    throttleSeconds: 0.08,
    maxConcurrent: 3,
    events: [
      makeNoise({ durationSeconds: 0.06, gain: 0.045, filterType: 'lowpass', filterStartHz: 220, filterEndHz: 140, attackSeconds: 0.002, releaseSeconds: 0.05 }),
      makeTone({ durationSeconds: 0.045, frequencyStart: 120, frequencyEnd: 90, waveform: 'triangle', gain: 0.03, attackSeconds: 0.002, releaseSeconds: 0.038 }),
    ],
  },
};

export const SFX_DEFINITIONS: Readonly<Record<SoundName, SfxDefinition>> = SFX_TABLE;

/**
 * Deterministic per-instance pitch variation (+/- 4 cents) so repeated UI sounds do
 * not phase-cancel or sound robotic, while staying fully reproducible from the variant
 * counter (never Math.random).
 */
export function sfxDetuneCents(name: SoundName, variant: number): number {
  const seed = hashStringToSeed(`sfx:${name}`);
  const unit = unitFloat(seed, Math.max(0, Math.floor(variant)), 1);
  return (unit - 0.5) * 8;
}

/** Returns the cue events with deterministic per-variant detune applied. */
export function sfxEvents(name: SoundName, variant = 0): readonly VoiceEvent[] {
  const definition = SFX_DEFINITIONS[name];
  const ratio = Math.pow(2, sfxDetuneCents(name, variant) / 1200);
  return definition.events.map((event) =>
    event.kind === 'tone'
      ? { ...event, frequencyStart: event.frequencyStart * ratio, frequencyEnd: event.frequencyEnd * ratio }
      : event
  );
}

/** Longest voice event in a cue, in seconds (used for scheduling bookkeeping). */
export function sfxDuration(name: SoundName): number {
  let longest = 0;
  for (const event of SFX_DEFINITIONS[name].events) {
    longest = Math.max(longest, event.offsetSeconds + event.durationSeconds + event.releaseSeconds);
  }
  return longest;
}
