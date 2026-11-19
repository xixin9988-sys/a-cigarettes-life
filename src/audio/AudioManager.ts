import type { GameState } from '../core/contracts';
import type { DayPhase, RegionId, Season, WeatherType } from '../core/SharedTypes';
import { GAME_MINUTES_PER_HOUR, SECONDS_PER_GAME_MINUTE } from '../core/SharedTypes';
import { dayPhaseOfHour } from '../core/TimeUtil';
import {
  AMBIENCE_LAYERS,
  AMBIENCE_LAYER_CONFIGS,
  birdChirp,
  buildAmbiencePlan,
  cricketChirp,
  fireCrackleProfile,
  nextBirdChirpDelay,
  nextCricketChirpDelay,
  nextFireCrackleDelay,
  nextThunderDelay,
  thunderProfile,
  type AmbienceLayerId,
  type AmbiencePlan,
  type NoiseColour,
} from './ambience';
import { clamp, clamp01 } from './deterministic';
import { buildMusicPlan, MUSIC_STEPS_PER_BAR, musicStepEvents, padChordMidi, type MusicPlan } from './music';
import { SFX_DEFINITIONS, sfxEvents, type SoundName } from './sfx';
import {
  createAmbienceLayer,
  createNoiseBuffer,
  createPad,
  playChirp,
  playFireCrackle,
  playThunder,
  playVoiceEvent,
  type AmbienceRuntimeLayer,
  type PadRuntime,
  type VoiceRuntime,
} from './synth';
import { midiToFrequency } from './voices';

export type { SoundName } from './sfx';

type AudioContextConstructor = new () => AudioContext;

interface BrowserAudioWindow extends Window {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

export interface AudioVolumes {
  master: number;
  music: number;
  sfx: number;
}

/** Scene values the soundscape reacts to; extracted once per throttled update. */
interface SceneSnapshot {
  readonly weather: WeatherType;
  readonly season: Season;
  readonly phase: DayPhase;
  readonly indoor: boolean;
  readonly regionId: RegionId;
  readonly hasHeatSource: boolean;
  readonly windSpeed: number;
  readonly rainIntensity: number;
}

/** Mixer bus levels relative to the user volume sliders. */
const MUSIC_BUS_LEVEL = 0.42;
const AMBIENCE_BUS_LEVEL = 0.5;
const MUSIC_LOOKAHEAD_SECONDS = 0.8;
const AMBIENCE_LOOKAHEAD_SECONDS = 1.2;
const MUSIC_SCHEDULER_INTERVAL_MS = 250;
const AMBIENCE_SCHEDULER_INTERVAL_MS = 500;
const UPDATE_THROTTLE_SECONDS = 0.15;
const CROSSFADE_TIME_CONSTANT = 0.12;
const AMBIENCE_CROSSFADE_TIME_CONSTANT = 0.9;
const MAX_LIVE_VOICES = 72;

const INITIAL_MUSIC_PLAN = buildMusicPlan({ season: 'spring', phase: 'afternoon', weather: 'clear', indoor: false });
const INITIAL_AMBIENCE_PLAN = buildAmbiencePlan({
  weather: 'clear',
  season: 'spring',
  phase: 'afternoon',
  indoor: false,
  regionId: 'willowbrook',
  hasHeatSource: false,
  windSpeed: 4,
  rainIntensity: 0,
});

function hourOfSimTime(simTimeSeconds: number): number {
  const minutes = Math.floor(Math.max(0, simTimeSeconds) / SECONDS_PER_GAME_MINUTE);
  return Math.floor(minutes / GAME_MINUTES_PER_HOUR) % 24;
}

function readScene(state: Readonly<GameState>): SceneSnapshot {
  const environment = state.world.environment;
  const position = state.player.position;
  const location = state.world.locations[position.locationId];
  return {
    weather: environment.weather,
    season: environment.season,
    phase: dayPhaseOfHour(hourOfSimTime(state.clock.simTimeSeconds)),
    indoor: position.indoor,
    regionId: position.regionId,
    hasHeatSource: location?.microclimate.heatSource ?? false,
    windSpeed: environment.windSpeed,
    rainIntensity: environment.rainIntensity,
  };
}

/**
 * Fully procedural Web Audio manager: seasonal/day-phase generative music layers,
 * weather + indoor ambience crossfades, storm thunder, fireplace crackle and a
 * multi-voice UI/gameplay SFX set. No external audio assets, no network, no
 * Math.random (everything is deterministic formulas/counters).
 *
 * Audio is created lazily after the first user gesture (browser autoplay policy).
 * The public API is intentionally small and stable for src/main.ts:
 * start(), update(state), setVolumes(partial), playSfx(name), dispose(), isStarted.
 */
export class AudioManager {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicLowpass: BiquadFilterNode | null = null;
  private sfxGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private pad: PadRuntime | null = null;
  private readonly ambienceLayers = new Map<AmbienceLayerId, AmbienceRuntimeLayer>();
  private readonly liveRuntimes = new Set<VoiceRuntime>();
  private noiseBuffers: Record<NoiseColour, AudioBuffer> | null = null;

  private musicPlan: MusicPlan = INITIAL_MUSIC_PLAN;
  private ambiencePlan: AmbiencePlan = INITIAL_AMBIENCE_PLAN;
  private currentAmbienceId = '';
  private currentMusicKey = '';
  private lastUpdateAt = Number.NEGATIVE_INFINITY;

  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private ambienceTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;
  private nextNoteTime = 0;
  private nextThunderAt = 0;
  private thunderCounter = 0;
  private nextFireCrackleAt = 0;
  private fireCrackleCounter = 0;
  private nextBirdAt = 0;
  private birdCounter = 0;
  private nextCricketAt = 0;
  private cricketCounter = 0;

  private readonly sfxLastAt = new Map<SoundName, number>();
  private readonly sfxActive = new Map<SoundName, number>();
  private readonly sfxVariants = new Map<SoundName, number>();

  private volumes: AudioVolumes = { master: 0.8, music: 0.55, sfx: 0.7 };
  private appliedVolumes: AudioVolumes = { master: -1, music: -1, sfx: -1 };
  private started = false;
  private suspendedTicks = 0;
  private startPromise: Promise<void> | null = null;

  get isStarted(): boolean {
    return this.started;
  }

  /** Creates and resumes the audio graph. Safe to call repeatedly; only the first call does work. */
  start(): Promise<void> {
    if (this.started) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.createAudioGraph()
      .catch(() => undefined)
      .finally(() => {
        this.startPromise = null;
      });
    return this.startPromise;
  }

  /**
   * Reacts to game-state changes (weather, season, day phase, indoor/outdoor, region,
   * heat source). Throttled internally: called every animation frame by main.ts but only
   * a handful of times per second does any planning work.
   */
  update(state: Readonly<GameState>): void {
    if (!this.started || !this.context) return;
    const now = this.context.currentTime;
    if (now - this.lastUpdateAt < UPDATE_THROTTLE_SECONDS) return;
    this.lastUpdateAt = now;

    const scene = readScene(state);
    const ambience = buildAmbiencePlan(scene);
    if (ambience.id !== this.currentAmbienceId) this.applyAmbiencePlan(ambience, now, false);

    const musicKey = `${scene.season}|${scene.phase}|${scene.weather}|${scene.indoor ? 'in' : 'out'}`;
    if (musicKey !== this.currentMusicKey) {
      this.currentMusicKey = musicKey;
      this.applyMusicPlan(
        buildMusicPlan({ season: scene.season, phase: scene.phase, weather: scene.weather, indoor: scene.indoor }),
        now,
        false
      );
    }

    // Autoplay fallback: if the browser kept the context suspended (gesture not accepted
    // yet), retry resume on a slow cadence instead of failing silently forever.
    if (this.context.state === 'suspended') {
      this.suspendedTicks += 1;
      if (this.suspendedTicks % 120 === 0) void this.context.resume().catch(() => undefined);
    } else {
      this.suspendedTicks = 0;
    }
  }

  /** Applies the persisted settings volumes. Called every frame by main.ts; cheap when unchanged. */
  setVolumes(volumes: Partial<AudioVolumes>): void {
    this.volumes = {
      master: clamp01(volumes.master ?? this.volumes.master),
      music: clamp01(volumes.music ?? this.volumes.music),
      sfx: clamp01(volumes.sfx ?? this.volumes.sfx),
    };
    const context = this.context;
    if (!context) return;
    const applied = this.appliedVolumes;
    const changed =
      Math.abs(this.volumes.master - applied.master) > 0.004 ||
      Math.abs(this.volumes.music - applied.music) > 0.004 ||
      Math.abs(this.volumes.sfx - applied.sfx) > 0.004;
    if (changed) this.applyVolumes(context.currentTime, false);
  }

  /** Plays a UI/gameplay sound cue. No-op until audio has been unlocked by a user gesture. */
  playSfx(name: SoundName): void {
    const context = this.context;
    const destination = this.sfxGain;
    const buffers = this.noiseBuffers;
    if (!context || !destination || !buffers) return;
    const definition = SFX_DEFINITIONS[name];
    if (!definition) return;

    const now = context.currentTime;
    const last = this.sfxLastAt.get(name);
    if (last !== undefined && now - last < definition.throttleSeconds) return;
    if ((this.sfxActive.get(name) ?? 0) >= definition.maxConcurrent) return;
    if (this.liveRuntimes.size >= MAX_LIVE_VOICES) return;

    this.sfxLastAt.set(name, now);
    const variant = this.sfxVariants.get(name) ?? 0;
    this.sfxVariants.set(name, (variant + 1) % 997);

    const events = sfxEvents(name, variant);
    this.sfxActive.set(name, (this.sfxActive.get(name) ?? 0) + 1);
    let remaining = events.length;
    const onCueEnded = (): void => {
      remaining -= 1;
      if (remaining > 0) return;
      const active = this.sfxActive.get(name) ?? 1;
      if (active <= 1) this.sfxActive.delete(name);
      else this.sfxActive.set(name, active - 1);
    };

    for (const event of events) {
      const runtime = playVoiceEvent(context, destination, buffers.white, event, now + event.offsetSeconds, definition.gain);
      this.trackRuntime(runtime, onCueEnded);
    }
    if (events.length === 0) onCueEnded();
  }

  /** Stops every timer/source, disconnects the graph and closes the context. */
  dispose(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.ambienceTimer !== null) {
      clearInterval(this.ambienceTimer);
      this.ambienceTimer = null;
    }

    for (const runtime of this.liveRuntimes) {
      this.stopAndDisconnect(runtime);
    }
    this.liveRuntimes.clear();

    for (const layer of this.ambienceLayers.values()) {
      for (const source of layer.sources) this.stopSource(source);
      for (const node of layer.nodes) this.disconnectNode(node);
    }
    this.ambienceLayers.clear();

    if (this.pad) {
      for (const voice of this.pad.voices) {
        this.stopSource(voice.oscillator);
        this.disconnectNode(voice.oscillator);
        this.disconnectNode(voice.gain);
      }
      this.disconnectNode(this.pad.filter);
      this.disconnectNode(this.pad.gain);
      this.pad = null;
    }

    this.disconnectNode(this.musicGain);
    this.disconnectNode(this.musicLowpass);
    this.disconnectNode(this.sfxGain);
    this.disconnectNode(this.ambienceGain);
    this.disconnectNode(this.masterGain);
    this.musicGain = null;
    this.musicLowpass = null;
    this.sfxGain = null;
    this.ambienceGain = null;
    this.masterGain = null;
    this.noiseBuffers = null;

    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);

    this.started = false;
    this.startPromise = null;
    this.appliedVolumes = { master: -1, music: -1, sfx: -1 };
    this.musicPlan = INITIAL_MUSIC_PLAN;
    this.ambiencePlan = INITIAL_AMBIENCE_PLAN;
    this.currentAmbienceId = '';
    this.currentMusicKey = '';
    this.lastUpdateAt = Number.NEGATIVE_INFINITY;
    this.musicStep = 0;
    this.nextNoteTime = 0;
    this.nextThunderAt = 0;
    this.thunderCounter = 0;
    this.nextFireCrackleAt = 0;
    this.fireCrackleCounter = 0;
    this.nextBirdAt = 0;
    this.birdCounter = 0;
    this.nextCricketAt = 0;
    this.cricketCounter = 0;
    this.sfxLastAt.clear();
    this.sfxActive.clear();
    this.sfxVariants.clear();
    this.suspendedTicks = 0;
  }

  // -------------------------------------------------------------------------
  // Graph construction
  // -------------------------------------------------------------------------
  private async createAudioGraph(): Promise<void> {
    if (typeof window === 'undefined') return;
    const audioWindow = window as BrowserAudioWindow;
    const Constructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    if (!Constructor) return;

    let context: AudioContext;
    try {
      context = new Constructor();
    } catch {
      return;
    }
    this.context = context;
    try {
      if (context.state === 'suspended') await context.resume();
    } catch {
      // The gesture may not have been accepted yet; update() retries resume.
    }
    if (this.context !== context) {
      // dispose() ran while we were awaiting resume().
      if (context.state !== 'closed') void context.close().catch(() => undefined);
      return;
    }
    if (context.state === 'closed') {
      this.context = null;
      return;
    }

    this.buildGraph(context);
    this.started = true;
    this.musicStep = 0;
    this.nextNoteTime = context.currentTime + 0.2;
    // Fade in from silence (rather than jumping gain values) after the user gesture unlocks audio.
    this.applyVolumes(context.currentTime, false);
    this.applyMusicPlan(this.musicPlan, context.currentTime, false);
    this.applyAmbiencePlan(this.ambiencePlan, context.currentTime, false);
    this.lastUpdateAt = Number.NEGATIVE_INFINITY;
    this.musicTimer = setInterval(() => this.musicTick(), MUSIC_SCHEDULER_INTERVAL_MS);
    this.ambienceTimer = setInterval(() => this.ambienceTick(), AMBIENCE_SCHEDULER_INTERVAL_MS);
  }

  private buildGraph(context: AudioContext): void {
    this.masterGain = context.createGain();
    this.masterGain.gain.value = Math.max(0.0001, clamp01(this.volumes.master));
    this.masterGain.connect(context.destination);

    this.musicLowpass = context.createBiquadFilter();
    this.musicLowpass.type = 'lowpass';
    this.musicLowpass.frequency.value = 16000;
    this.musicLowpass.Q.value = 0.3;
    this.musicGain = context.createGain();
    this.musicGain.gain.value = 0.0001;
    this.musicGain.connect(this.musicLowpass);
    this.musicLowpass.connect(this.masterGain);

    this.sfxGain = context.createGain();
    this.sfxGain.gain.value = 0.0001;
    this.sfxGain.connect(this.masterGain);

    this.ambienceGain = context.createGain();
    this.ambienceGain.gain.value = 0.0001;
    this.ambienceGain.connect(this.masterGain);

    this.noiseBuffers = {
      white: createNoiseBuffer(context, 6, 'white', 0x1a2b3c4d),
      pink: createNoiseBuffer(context, 6, 'pink', 0x5e6f7a8b),
      brown: createNoiseBuffer(context, 6, 'brown', 0x9c0d1e2f),
    };

    this.pad = createPad(context, this.musicGain);
    for (const id of AMBIENCE_LAYERS) {
      const config = AMBIENCE_LAYER_CONFIGS[id];
      const buffer = this.noiseBuffers[config.noiseColour];
      this.ambienceLayers.set(id, createAmbienceLayer(context, this.ambienceGain, buffer, id, config));
    }
  }

  // -------------------------------------------------------------------------
  // Mixer / plan application
  // -------------------------------------------------------------------------
  private applyVolumes(now: number, immediate: boolean): void {
    const targets: AudioVolumes = {
      master: clamp01(this.volumes.master),
      music: clamp01(this.volumes.music),
      sfx: clamp01(this.volumes.sfx),
    };
    this.setGain(this.masterGain, targets.master, now, immediate);
    this.setGain(this.musicGain, targets.music * MUSIC_BUS_LEVEL, now, immediate);
    this.setGain(this.sfxGain, targets.sfx, now, immediate);
    this.setGain(this.ambienceGain, targets.music * AMBIENCE_BUS_LEVEL, now, immediate);
    this.appliedVolumes = targets;
  }

  private setGain(
    node: GainNode | null,
    value: number,
    now: number,
    immediate: boolean,
    timeConstant = CROSSFADE_TIME_CONSTANT
  ): void {
    if (!node) return;
    const safe = Math.max(0.0001, clamp01(value));
    if (immediate) node.gain.setValueAtTime(safe, now);
    else node.gain.setTargetAtTime(safe, now, timeConstant);
  }

  private applyMusicPlan(plan: MusicPlan, now: number, immediate: boolean): void {
    this.musicPlan = plan;
    if (this.pad) {
      this.setGain(this.pad.gain, plan.layerGains.pad * 0.18, now, immediate, 0.6);
      const cutoff = 220 + plan.brightness * 1900;
      if (immediate) this.pad.filter.frequency.setValueAtTime(cutoff, now);
      else this.pad.filter.frequency.setTargetAtTime(cutoff, now, 0.8);
      this.retunePad(plan, now, immediate);
    }
    if (this.musicLowpass) {
      const cutoff = plan.indoor ? 4200 : 2600 + plan.brightness * 12000;
      if (immediate) this.musicLowpass.frequency.setValueAtTime(cutoff, now);
      else this.musicLowpass.frequency.setTargetAtTime(cutoff, now, 0.8);
    }
  }

  private retunePad(plan: MusicPlan, now: number, immediate: boolean): void {
    const pad = this.pad;
    if (!pad) return;
    const bar = Math.floor(this.musicStep / MUSIC_STEPS_PER_BAR);
    const chord = padChordMidi(plan, bar);
    for (let index = 0; index < pad.voices.length; index += 1) {
      const voice = pad.voices[index];
      const midi = chord[index];
      if (!voice || midi === undefined) continue;
      const frequency = midiToFrequency(midi);
      if (immediate) voice.oscillator.frequency.setValueAtTime(frequency, now);
      else voice.oscillator.frequency.setTargetAtTime(frequency, now, 0.35);
    }
  }

  private applyAmbiencePlan(plan: AmbiencePlan, now: number, immediate: boolean): void {
    this.ambiencePlan = plan;
    for (const id of AMBIENCE_LAYERS) {
      const layer = this.ambienceLayers.get(id);
      if (!layer) continue;
      const config = AMBIENCE_LAYER_CONFIGS[id];
      const target = clamp01(plan.layerGains[id]);
      // Weather/indoor beds fade slowly so transitions feel like a soundscape, not a cut.
      this.setGain(layer.gain, target, now, immediate, AMBIENCE_CROSSFADE_TIME_CONSTANT);
      if (layer.lfoGain) {
        const depth = target * config.lfoDepth;
        if (immediate) layer.lfoGain.gain.setValueAtTime(depth, now);
        else layer.lfoGain.gain.setTargetAtTime(depth, now, 1.1);
      }
    }
    this.currentAmbienceId = plan.id;
  }

  // -------------------------------------------------------------------------
  // Schedulers (lookahead, cheap timers)
  // -------------------------------------------------------------------------
  private musicTick(): void {
    const context = this.context;
    const destination = this.musicGain;
    const buffers = this.noiseBuffers;
    if (!context || !destination || !buffers) return;

    const now = context.currentTime;
    if (this.nextNoteTime < now - 1) this.nextNoteTime = now + 0.05;
    const horizon = now + MUSIC_LOOKAHEAD_SECONDS;
    let scheduled = 0;
    while (this.nextNoteTime < horizon && scheduled < 24) {
      const plan = this.musicPlan;
      const stepInBar = this.musicStep % MUSIC_STEPS_PER_BAR;
      if (stepInBar === 0) this.retunePad(plan, this.nextNoteTime, false);
      const notes = musicStepEvents(plan, this.musicStep);
      for (const note of notes) {
        if (this.liveRuntimes.size >= MAX_LIVE_VOICES) break;
        const layerGain = plan.layerGains[note.layer];
        if (layerGain <= 0.01) continue;
        const swing = stepInBar % 2 === 1 ? plan.stepSeconds * plan.swing : 0;
        const runtime = playVoiceEvent(context, destination, buffers.white, note, this.nextNoteTime + swing, layerGain);
        this.trackRuntime(runtime);
      }
      this.nextNoteTime += plan.stepSeconds;
      this.musicStep = (this.musicStep + 1) % (MUSIC_STEPS_PER_BAR * 8192);
      scheduled += 1;
    }
  }

  private ambienceTick(): void {
    const context = this.context;
    const destination = this.ambienceGain;
    const buffers = this.noiseBuffers;
    if (!context || !destination || !buffers) return;

    const plan = this.ambiencePlan;
    const now = context.currentTime;
    const horizon = now + AMBIENCE_LOOKAHEAD_SECONDS;
    const voiceBudget = MAX_LIVE_VOICES - this.liveRuntimes.size;

    if (plan.thunderActivity > 0.05 && voiceBudget > 12) {
      if (this.nextThunderAt < now) this.nextThunderAt = now + 2.5 + plan.stormIntensity * 2;
      while (this.nextThunderAt < horizon) {
        const profile = thunderProfile(this.thunderCounter);
        const thunderGain = plan.indoor ? 0.45 : 1;
        for (const runtime of playThunder(context, destination, buffers.white, profile, this.nextThunderAt, thunderGain)) {
          this.trackRuntime(runtime);
        }
        this.thunderCounter += 1;
        this.nextThunderAt += nextThunderDelay(this.thunderCounter, plan.thunderActivity);
      }
    } else if (plan.thunderActivity <= 0.05) {
      this.nextThunderAt = 0;
    }

    if (plan.fireIntensity > 0.04 && voiceBudget > 8) {
      if (this.nextFireCrackleAt < now) this.nextFireCrackleAt = now + 0.25;
      let scheduledCrackles = 0;
      while (this.nextFireCrackleAt < horizon && scheduledCrackles < 8) {
        const profile = fireCrackleProfile(this.fireCrackleCounter);
        const fireGain = clamp01(plan.fireIntensity * 1.4);
        for (const runtime of playFireCrackle(context, destination, buffers.white, profile, this.nextFireCrackleAt, fireGain)) {
          this.trackRuntime(runtime);
        }
        this.fireCrackleCounter += 1;
        this.nextFireCrackleAt += nextFireCrackleDelay(this.fireCrackleCounter, plan.fireIntensity);
        scheduledCrackles += 1;
      }
    } else if (plan.fireIntensity <= 0.04) {
      this.nextFireCrackleAt = 0;
    }

    if (plan.birdActivity > 0.04 && voiceBudget > 6) {
      if (this.nextBirdAt < now) this.nextBirdAt = now + 0.9;
      if (this.nextBirdAt < horizon) {
        const chirp = birdChirp(this.birdCounter);
        const birdGain = clamp01(0.35 + plan.birdActivity * 0.85);
        for (const runtime of playChirp(context, destination, buffers.white, chirp, this.nextBirdAt, birdGain)) {
          this.trackRuntime(runtime);
        }
        this.birdCounter += 1;
        this.nextBirdAt += nextBirdChirpDelay(this.birdCounter, plan.birdActivity);
      }
    } else if (plan.birdActivity <= 0.04) {
      this.nextBirdAt = 0;
    }

    if (plan.cricketActivity > 0.04 && voiceBudget > 6) {
      if (this.nextCricketAt < now) this.nextCricketAt = now + 0.5;
      if (this.nextCricketAt < horizon) {
        const chirp = cricketChirp(this.cricketCounter);
        const cricketGain = clamp01(0.35 + plan.cricketActivity * 0.85);
        for (const runtime of playChirp(context, destination, buffers.white, chirp, this.nextCricketAt, cricketGain)) {
          this.trackRuntime(runtime);
        }
        this.cricketCounter += 1;
        this.nextCricketAt += nextCricketChirpDelay(this.cricketCounter, plan.cricketActivity);
      }
    } else if (plan.cricketActivity <= 0.04) {
      this.nextCricketAt = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Voice bookkeeping / cleanup
  // -------------------------------------------------------------------------
  private trackRuntime(runtime: VoiceRuntime, onEnded?: () => void): void {
    const sources = runtime.sources;
    if (sources.length === 0) {
      this.cleanupRuntime(runtime);
      onEnded?.();
      return;
    }
    this.liveRuntimes.add(runtime);
    let remaining = sources.length;
    for (const source of sources) {
      source.onended = () => {
        remaining -= 1;
        if (remaining > 0) return;
        this.cleanupRuntime(runtime);
        onEnded?.();
      };
    }
  }

  private cleanupRuntime(runtime: VoiceRuntime): void {
    this.liveRuntimes.delete(runtime);
    for (const node of runtime.nodes) this.disconnectNode(node);
  }

  private stopAndDisconnect(runtime: VoiceRuntime): void {
    for (const source of runtime.sources) {
      source.onended = null;
      this.stopSource(source);
    }
    for (const node of runtime.nodes) this.disconnectNode(node);
  }

  private stopSource(source: AudioScheduledSourceNode): void {
    try {
      source.stop();
    } catch {
      // Already stopped / never started; nothing to do.
    }
  }

  private disconnectNode(node: AudioNode | null): void {
    if (!node) return;
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  }
}
