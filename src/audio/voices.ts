// Voice/event descriptions shared by the procedural music, ambience and SFX layers.
// These types are DOM-free so the sound-design decisions can be reasoned about and
// tested headlessly; the Web Audio rendering lives in synth.ts.

export type Waveform = 'sine' | 'square' | 'triangle' | 'sawtooth';
export type VoiceFilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch';

/** A pitched, enveloped oscillator voice (one-shot). */
export interface ToneEvent {
  readonly kind: 'tone';
  /** Seconds relative to the scheduling call. */
  readonly offsetSeconds: number;
  readonly durationSeconds: number;
  readonly frequencyStart: number;
  readonly frequencyEnd: number;
  readonly waveform: Waveform;
  readonly gain: number;
  readonly attackSeconds: number;
  readonly releaseSeconds: number;
  /** Optional per-voice lowpass cutoff in Hz. */
  readonly filterHz?: number;
  /** Optional stereo position, -1 = left, 1 = right. */
  readonly pan?: number;
}

/** A filtered noise-burst voice (one-shot). */
export interface NoiseEvent {
  readonly kind: 'noise';
  readonly offsetSeconds: number;
  readonly durationSeconds: number;
  readonly gain: number;
  readonly filterType: VoiceFilterType;
  readonly filterStartHz: number;
  readonly filterEndHz: number;
  readonly q: number;
  readonly attackSeconds: number;
  readonly releaseSeconds: number;
  readonly pan?: number;
}

export type VoiceEvent = ToneEvent | NoiseEvent;

export interface ToneOptions {
  readonly offsetSeconds?: number;
  readonly durationSeconds: number;
  readonly frequencyStart: number;
  readonly frequencyEnd?: number;
  readonly waveform?: Waveform;
  readonly gain: number;
  readonly attackSeconds?: number;
  readonly releaseSeconds?: number;
  readonly filterHz?: number;
  readonly pan?: number;
}

export interface NoiseOptions {
  readonly offsetSeconds?: number;
  readonly durationSeconds: number;
  readonly gain: number;
  readonly filterType?: VoiceFilterType;
  readonly filterStartHz?: number;
  readonly filterEndHz?: number;
  readonly q?: number;
  readonly attackSeconds?: number;
  readonly releaseSeconds?: number;
  readonly pan?: number;
}

/** Equal-temperament MIDI note -> frequency in Hz (A4 = 69 = 440 Hz). */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function makeTone(options: ToneOptions): ToneEvent {
  return {
    kind: 'tone',
    offsetSeconds: options.offsetSeconds ?? 0,
    durationSeconds: options.durationSeconds,
    frequencyStart: options.frequencyStart,
    frequencyEnd: options.frequencyEnd ?? options.frequencyStart,
    waveform: options.waveform ?? 'sine',
    gain: options.gain,
    attackSeconds: options.attackSeconds ?? 0.01,
    releaseSeconds: options.releaseSeconds ?? Math.min(0.25, options.durationSeconds * 0.6),
    ...(options.filterHz !== undefined ? { filterHz: options.filterHz } : {}),
    ...(options.pan !== undefined ? { pan: options.pan } : {}),
  };
}

export function makeNoise(options: NoiseOptions): NoiseEvent {
  const filterStartHz = options.filterStartHz ?? 1200;
  return {
    kind: 'noise',
    offsetSeconds: options.offsetSeconds ?? 0,
    durationSeconds: options.durationSeconds,
    gain: options.gain,
    filterType: options.filterType ?? 'lowpass',
    filterStartHz,
    filterEndHz: options.filterEndHz ?? filterStartHz,
    q: options.q ?? 0.7,
    attackSeconds: options.attackSeconds ?? 0.005,
    releaseSeconds: options.releaseSeconds ?? Math.min(0.2, options.durationSeconds * 0.6),
    ...(options.pan !== undefined ? { pan: options.pan } : {}),
  };
}

/** Total wall-clock length of a voice event (scheduling offset + envelope tail). */
export function voiceEventDuration(event: VoiceEvent): number {
  return event.offsetSeconds + event.durationSeconds + event.releaseSeconds;
}
