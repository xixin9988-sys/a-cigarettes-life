// Web Audio rendering helpers for the procedural soundscape. All nodes are created with
// plain Web Audio primitives (no external assets, no network). Every play* function
// returns the nodes it created so the caller can fully disconnect them when they end,
// which keeps long sessions leak-free.

import type { AmbienceLayerConfig, AmbienceLayerId, Chirp, FireCrackleProfile, NoiseColour, ThunderProfile } from './ambience';
import { clamp, hashFloat01 } from './deterministic';
import { makeNoise, makeTone, type NoiseEvent, type ToneEvent } from './voices';

export interface VoiceRuntime {
  readonly sources: readonly AudioScheduledSourceNode[];
  readonly nodes: readonly AudioNode[];
}

export interface AmbienceRuntimeLayer {
  readonly id: AmbienceLayerId;
  readonly gain: GainNode;
  readonly filter: BiquadFilterNode | null;
  readonly lfoGain: GainNode | null;
  readonly sources: readonly AudioScheduledSourceNode[];
  readonly nodes: readonly AudioNode[];
}

export interface PadVoice {
  readonly oscillator: OscillatorNode;
  readonly gain: GainNode;
}

export interface PadRuntime {
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
  readonly voices: readonly PadVoice[];
  readonly sources: readonly OscillatorNode[];
  readonly nodes: readonly AudioNode[];
}

/** Deterministic xorshift noise buffer (white / pink / brown). */
export function createNoiseBuffer(context: AudioContext, seconds: number, colour: NoiseColour, seed: number): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let state = (seed | 0) === 0 ? 0x9e3779b9 : seed | 0;
  let pink0 = 0;
  let pink1 = 0;
  let pink2 = 0;
  let brown = 0;
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const white = (state | 0) / 2147483648;
    let sample: number;
    if (colour === 'white') {
      sample = white * 0.6;
    } else if (colour === 'brown') {
      brown = clamp(brown + white * 0.02, -0.9, 0.9);
      sample = brown;
    } else {
      pink0 = 0.99765 * pink0 + white * 0.099046;
      pink1 = 0.963 * pink1 + white * 0.2965164;
      pink2 = 0.57 * pink2 + white * 1.0526913;
      sample = (pink0 + pink1 + pink2 + white * 0.1848) * 0.12;
    }
    data[index] = clamp(sample, -1, 1);
  }
  return buffer;
}

function makePanner(context: AudioContext, pan: number): StereoPannerNode {
  const panner = context.createStereoPanner();
  panner.pan.value = clamp(pan, -1, 1);
  return panner;
}

function applyEnvelope(
  gainNode: GainNode,
  when: number,
  attackSeconds: number,
  peak: number,
  durationSeconds: number,
  releaseSeconds: number
): void {
  const attack = Math.max(0.002, attackSeconds);
  const duration = Math.max(attack + 0.01, durationSeconds);
  const release = Math.max(0.01, releaseSeconds);
  const holdEnd = when + Math.max(attack, duration - release);
  const end = when + duration + release;
  const param = gainNode.gain;
  param.setValueAtTime(0.0001, when);
  param.linearRampToValueAtTime(Math.max(0.0002, peak), when + attack);
  param.setValueAtTime(Math.max(0.0002, peak), holdEnd);
  param.exponentialRampToValueAtTime(0.0001, end);
}

/** Schedules one pitched voice; returns its runtime handle for cleanup. */
export function playToneEvent(
  context: AudioContext,
  destination: AudioNode,
  event: ToneEvent,
  when: number,
  gainScale = 1
): VoiceRuntime {
  const oscillator = context.createOscillator();
  oscillator.type = event.waveform;
  const startHz = clamp(event.frequencyStart, 16, 18000);
  const endHz = clamp(event.frequencyEnd, 16, 18000);
  oscillator.frequency.setValueAtTime(startHz, when);
  if (Math.abs(endHz - startHz) > 0.5) {
    oscillator.frequency.exponentialRampToValueAtTime(endHz, when + Math.max(0.01, event.durationSeconds));
  }

  const gain = context.createGain();
  applyEnvelope(gain, when, event.attackSeconds, event.gain * gainScale, event.durationSeconds, event.releaseSeconds);
  oscillator.connect(gain);

  const nodes: AudioNode[] = [oscillator, gain];
  let tail: AudioNode = gain;
  if (event.filterHz !== undefined) {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = clamp(event.filterHz, 40, 18000);
    filter.Q.value = 0.4;
    tail.connect(filter);
    tail = filter;
    nodes.push(filter);
  }
  if (event.pan !== undefined) {
    const panner = makePanner(context, event.pan);
    tail.connect(panner);
    tail = panner;
    nodes.push(panner);
  }
  tail.connect(destination);

  const envelopeEnd = when + event.durationSeconds + event.releaseSeconds;
  oscillator.start(when);
  oscillator.stop(Math.max(when + event.durationSeconds + 0.15, envelopeEnd + 0.05));
  return { sources: [oscillator], nodes };
}

/** Schedules one filtered noise burst; returns its runtime handle for cleanup. */
export function playNoiseEvent(
  context: AudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  event: NoiseEvent,
  when: number,
  gainScale = 1
): VoiceRuntime {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = false;

  const gain = context.createGain();
  applyEnvelope(gain, when, event.attackSeconds, event.gain * gainScale, event.durationSeconds, event.releaseSeconds);

  const filter = context.createBiquadFilter();
  filter.type = event.filterType;
  const startHz = clamp(event.filterStartHz, 30, 18000);
  const endHz = clamp(event.filterEndHz, 30, 18000);
  filter.frequency.setValueAtTime(startHz, when);
  if (Math.abs(endHz - startHz) > 0.5) {
    filter.frequency.exponentialRampToValueAtTime(endHz, when + Math.max(0.02, event.durationSeconds));
  }
  filter.Q.value = clamp(event.q, 0.01, 20);

  source.connect(gain).connect(filter);
  const nodes: AudioNode[] = [source, gain, filter];
  let tail: AudioNode = filter;
  if (event.pan !== undefined) {
    const panner = makePanner(context, event.pan);
    tail.connect(panner);
    tail = panner;
    nodes.push(panner);
  }
  tail.connect(destination);

  const playDuration = Math.max(0.02, Math.min(event.durationSeconds + event.releaseSeconds, buffer.duration - 0.05));
  const maxOffset = Math.max(0, buffer.duration - playDuration - 0.02);
  const offset =
    maxOffset > 0
      ? hashFloat01(Math.floor((when + event.offsetSeconds) * 1000) ^ Math.floor(event.durationSeconds * 10000)) * maxOffset
      : 0;
  source.start(when, offset, playDuration);
  return { sources: [source], nodes };
}

/** Schedules a generic voice event (tone or noise). */
export function playVoiceEvent(
  context: AudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  event: ToneEvent | NoiseEvent,
  when: number,
  gainScale = 1
): VoiceRuntime {
  return event.kind === 'tone'
    ? playToneEvent(context, destination, event, when, gainScale)
    : playNoiseEvent(context, destination, buffer, event, when, gainScale);
}

/** Built-in loop for a persistent ambience bed, with optional slow LFO wobble. */
export function createAmbienceLayer(
  context: AudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  id: AmbienceLayerId,
  config: AmbienceLayerConfig
): AmbienceRuntimeLayer {
  const gain = context.createGain();
  gain.gain.value = 0.0001;
  gain.connect(destination);
  const nodes: AudioNode[] = [gain];

  let filter: BiquadFilterNode | null = null;
  let tail: AudioNode = gain;
  if (config.filterHz > 0) {
    filter = context.createBiquadFilter();
    filter.type = config.filterType;
    filter.frequency.value = clamp(config.filterHz, 30, 18000);
    filter.Q.value = clamp(config.q, 0.01, 20);
    filter.connect(gain);
    tail = filter;
    nodes.push(filter);
  }

  const sources: AudioScheduledSourceNode[] = [];
  if (config.kind === 'oscillator') {
    const oscillator = context.createOscillator();
    oscillator.type = config.waveform;
    oscillator.frequency.value = clamp(config.frequencyHz, 16, 2000);
    oscillator.connect(tail);
    oscillator.start();
    sources.push(oscillator);
    nodes.push(oscillator);
  } else {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(tail);
    source.start();
    sources.push(source);
    nodes.push(source);
  }

  let lfoGain: GainNode | null = null;
  if (config.lfoHz > 0) {
    lfoGain = context.createGain();
    lfoGain.gain.value = 0;
    const lfo = context.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = clamp(config.lfoHz, 0.01, 20);
    lfo.connect(lfoGain).connect(gain.gain);
    lfo.start();
    sources.push(lfo);
    nodes.push(lfo, lfoGain);
  }

  return { id, gain, filter, lfoGain, sources, nodes };
}

/** Three-oscillator detuned pad; chord changes just retune the oscillators. */
export function createPad(context: AudioContext, destination: AudioNode): PadRuntime {
  const gain = context.createGain();
  gain.gain.value = 0.0001;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  filter.Q.value = 0.35;
  filter.connect(gain);
  gain.connect(destination);

  const detunes = [-7, 4, 11];
  const levels = [0.34, 0.27, 0.2];
  const voices: PadVoice[] = [];
  for (let index = 0; index < 3; index += 1) {
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = 220;
    oscillator.detune.value = detunes[index] ?? 0;
    const voiceGain = context.createGain();
    voiceGain.gain.value = levels[index] ?? 0.2;
    oscillator.connect(voiceGain);
    voiceGain.connect(filter);
    oscillator.start();
    voices.push({ oscillator, gain: voiceGain });
  }

  const nodes: AudioNode[] = [filter, gain];
  for (const voice of voices) {
    nodes.push(voice.oscillator, voice.gain);
  }
  return { filter, gain, voices, sources: voices.map((voice) => voice.oscillator), nodes };
}

/** A full thunder strike: initial crack, low rumble, sub thump and rolling swells. */
export function playThunder(
  context: AudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  profile: ThunderProfile,
  when: number,
  gainScale = 1
): VoiceRuntime[] {
  const runtimes: VoiceRuntime[] = [];
  const crackWhen = when + profile.delaySeconds;

  runtimes.push(
    playNoiseEvent(
      context,
      destination,
      buffer,
      makeNoise({
        durationSeconds: 0.22,
        gain: profile.crackGain * gainScale,
        filterType: 'highpass',
        filterStartHz: 1500,
        filterEndHz: 600,
        q: 0.7,
        attackSeconds: 0.004,
        releaseSeconds: 0.32,
        pan: -0.25,
      }),
      crackWhen
    )
  );

  const rumbleDuration = Math.min(profile.rumbleSeconds, 4.6);
  runtimes.push(
    playNoiseEvent(
      context,
      destination,
      buffer,
      makeNoise({
        durationSeconds: rumbleDuration,
        gain: profile.peakGain * gainScale,
        filterType: 'lowpass',
        filterStartHz: profile.lowpassHz * 1.8,
        filterEndHz: profile.lowpassHz * 0.6,
        q: 0.6,
        attackSeconds: 0.07,
        releaseSeconds: 1.1,
        pan: 0.15,
      }),
      crackWhen + 0.04
    )
  );

  runtimes.push(
    playToneEvent(
      context,
      destination,
      makeTone({
        durationSeconds: Math.min(profile.rumbleSeconds * 0.6, 2.4),
        frequencyStart: 58,
        frequencyEnd: 34,
        waveform: 'sine',
        gain: profile.peakGain * 0.55 * gainScale,
        attackSeconds: 0.02,
        releaseSeconds: 0.9,
        filterHz: 140,
      }),
      crackWhen + 0.02
    )
  );

  const rollCount = Math.min(profile.rollCount, 4);
  for (let index = 0; index < rollCount; index += 1) {
    const rollOffset = 0.45 + (index / Math.max(1, rollCount)) * rumbleDuration * 0.7 + hashFloat01(index + 17) * 0.3;
    const rollGain = Math.max(0.02, profile.peakGain * (0.3 - index * 0.05) * gainScale);
    runtimes.push(
      playNoiseEvent(
        context,
        destination,
        buffer,
        makeNoise({
          durationSeconds: 0.8,
          gain: rollGain,
          filterType: 'lowpass',
          filterStartHz: 320,
          filterEndHz: 160,
          q: 0.5,
          attackSeconds: 0.05,
          releaseSeconds: 1.1,
          pan: hashFloat01(index + 43) * 1.2 - 0.6,
        }),
        crackWhen + rollOffset
      )
    );
  }

  return runtimes;
}

/** One ember pop (a music/fire crackle layer one-shot). */
export function playFireCrackle(
  context: AudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  profile: FireCrackleProfile,
  when: number,
  gainScale = 1
): VoiceRuntime[] {
  const runtimes: VoiceRuntime[] = [];
  const count = Math.min(profile.pops, 3);
  for (let index = 0; index < count; index += 1) {
    const offset = profile.delaySeconds + index * (profile.durationSeconds + 0.012);
    const gain = profile.gain * (0.7 + hashFloat01(index + 91) * 0.6) * gainScale;
    runtimes.push(
      playNoiseEvent(
        context,
        destination,
        buffer,
        makeNoise({
          durationSeconds: Math.max(0.02, profile.durationSeconds * 0.5),
          gain,
          filterType: 'bandpass',
          filterStartHz: profile.bandpassHz,
          filterEndHz: profile.bandpassHz * 0.7,
          q: 1.2,
          attackSeconds: 0.001,
          releaseSeconds: 0.025,
          pan: hashFloat01(index + 107) * 1.2 - 0.6,
        }),
        when + offset
      )
    );
  }
  return runtimes;
}

/** Schedules all notes of a bird/cricket chirp into the ambience bus. */
export function playChirp(
  context: AudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  chirp: Chirp,
  when: number,
  gainScale = 1
): VoiceRuntime[] {
  const runtimes: VoiceRuntime[] = [];
  for (const event of chirp.events) {
    runtimes.push(playVoiceEvent(context, destination, buffer, event, when + event.offsetSeconds, gainScale));
  }
  return runtimes;
}
