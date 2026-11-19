// Minimal deterministic fake Web Audio graph used by the headless AudioManager tests.
// It validates that the manager only feeds finite numbers into AudioParams, tracks every
// created node/connection, and lets a test assert that dispose() disconnects everything.

export class FakeAudioParam {
  private currentValue = 0;

  get value(): number {
    return this.currentValue;
  }

  set value(next: number) {
    FakeAudioParam.assertFinite(next, 'AudioParam.value');
    this.currentValue = next;
  }

  setValueAtTime(value: number, time: number): FakeAudioParam {
    FakeAudioParam.assertFinite(time, 'setValueAtTime time');
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): FakeAudioParam {
    FakeAudioParam.assertFinite(time, 'linearRampToValueAtTime time');
    this.value = value;
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): FakeAudioParam {
    if (!(value > 0)) throw new Error('exponentialRampToValueAtTime requires a positive value, got ' + value);
    FakeAudioParam.assertFinite(time, 'exponentialRampToValueAtTime time');
    this.value = value;
    return this;
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): FakeAudioParam {
    FakeAudioParam.assertFinite(startTime, 'setTargetAtTime start');
    if (!Number.isFinite(timeConstant) || timeConstant <= 0) {
      throw new Error('setTargetAtTime requires a positive time constant, got ' + timeConstant);
    }
    this.value = target;
    return this;
  }

  cancelScheduledValues(time: number): FakeAudioParam {
    FakeAudioParam.assertFinite(time, 'cancelScheduledValues time');
    return this;
  }

  private static assertFinite(value: number, label: string): void {
    if (!Number.isFinite(value)) throw new Error(label + ' must be finite, got ' + value);
  }
}

export class FakeAudioNode {
  private static created: FakeAudioNode[] = [];
  private readonly outgoing = new Set<FakeAudioNode>();

  constructor() {
    FakeAudioNode.created.push(this);
  }

  static reset(): void {
    FakeAudioNode.created = [];
  }

  static all(): readonly FakeAudioNode[] {
    return FakeAudioNode.created;
  }

  connect<T extends FakeAudioNode>(destination: T): T {
    this.outgoing.add(destination);
    return destination;
  }

  disconnect(): void {
    this.outgoing.clear();
  }

  get outgoingCount(): number {
    return this.outgoing.size;
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam();
}

export class FakeBiquadFilterNode extends FakeAudioNode {
  type: 'lowpass' | 'highpass' | 'bandpass' | 'notch' = 'lowpass';
  readonly frequency = new FakeAudioParam();
  readonly Q = new FakeAudioParam();
}

export class FakeAudioBuffer {
  private readonly data: Float32Array;

  constructor(
    readonly length: number,
    readonly sampleRate: number
  ) {
    this.data = new Float32Array(length);
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(_channel: number): Float32Array {
    return this.data;
  }
}

export interface FakeSourceNode extends FakeAudioNode {
  onended: (() => void) | null;
  started: boolean;
  stopped: boolean;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
}

export class FakeOscillatorNode extends FakeAudioNode implements FakeSourceNode {
  type: 'sine' | 'square' | 'triangle' | 'sawtooth' = 'sine';
  readonly frequency = new FakeAudioParam();
  readonly detune = new FakeAudioParam();
  onended: (() => void) | null = null;
  started = false;
  stopped = false;

  start(_when?: number): void {
    this.started = true;
  }

  stop(_when?: number): void {
    this.stopped = true;
  }
}

export class FakeBufferSourceNode extends FakeAudioNode implements FakeSourceNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  startOffset = 0;

  start(_when?: number, offset?: number, _duration?: number): void {
    this.started = true;
    this.startOffset = offset ?? 0;
  }

  stop(_when?: number): void {
    this.stopped = true;
  }
}

export class FakeStereoPannerNode extends FakeAudioNode {
  readonly pan = new FakeAudioParam();
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  readonly destination = new FakeAudioNode();
  readonly sampleRate = 8000;
  readonly createdSources: FakeSourceNode[] = [];
  state: 'running' | 'suspended' | 'closed';
  closeCount = 0;
  resumeCount = 0;
  private time = 0;

  constructor(state: 'running' | 'suspended' = 'running') {
    this.state = state;
    FakeAudioContext.instances.push(this);
  }

  static reset(): void {
    FakeAudioContext.instances = [];
  }

  get currentTime(): number {
    return this.time;
  }

  advance(seconds: number): void {
    this.time += seconds;
  }

  async resume(): Promise<void> {
    this.resumeCount += 1;
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.closeCount += 1;
    this.state = 'closed';
  }

  createGain(): FakeGainNode {
    return new FakeGainNode();
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    return new FakeBiquadFilterNode();
  }

  createOscillator(): FakeOscillatorNode {
    const node = new FakeOscillatorNode();
    this.createdSources.push(node);
    return node;
  }

  createBufferSource(): FakeBufferSourceNode {
    const node = new FakeBufferSourceNode();
    this.createdSources.push(node);
    return node;
  }

  createStereoPanner(): FakeStereoPannerNode {
    return new FakeStereoPannerNode();
  }

  createBuffer(_channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(length, sampleRate);
  }
}
