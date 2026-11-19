import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../../src/audio/AudioManager';
import type { GameState } from '../../src/core/contracts';
import type { WeatherType } from '../../src/core/SharedTypes';
import { FakeAudioContext, FakeAudioNode } from './fakeAudioContext';

class SuspendedFakeAudioContext extends FakeAudioContext {
  constructor() {
    super('suspended');
  }
}

function makeState(weather: WeatherType, indoor: boolean, hour: number): Readonly<GameState> {
  const state = {
    clock: { simTimeSeconds: hour * 60 },
    world: {
      environment: { weather, season: 'autumn', windSpeed: 12, rainIntensity: 0.6 },
      locations: { home: { microclimate: { heatSource: true } } },
    },
    player: { position: { locationId: 'home', indoor, regionId: 'willowbrook' } },
  };
  return state as unknown as GameState;
}

beforeEach(() => {
  FakeAudioContext.reset();
  FakeAudioNode.reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AudioManager autoplay safety (headless, no window)', () => {
  it('is inert and never throws when Web Audio is unavailable', async () => {
    const manager = new AudioManager();
    expect(manager.isStarted).toBe(false);
    await manager.start();
    expect(manager.isStarted).toBe(false);
    manager.setVolumes({ master: 0.5, music: 0.2, sfx: 0.3 });
    manager.update(makeState('rain', true, 20));
    manager.playSfx('ui_click');
    manager.playSfx('level_up');
    manager.dispose();
    expect(manager.isStarted).toBe(false);
  });

  it('exposes the stable public API contract', () => {
    const manager = new AudioManager();
    const start: () => Promise<void> = () => manager.start();
    const update: (state: Readonly<GameState>) => void = (state) => manager.update(state);
    const setVolumes: (volumes: Partial<{ master: number; music: number; sfx: number }>) => void = (volumes) =>
      manager.setVolumes(volumes);
    const playSfx: (name: 'ui_click') => void = (name) => manager.playSfx(name);
    const dispose: () => void = () => manager.dispose();
    const isStarted: boolean = manager.isStarted;
    expect(typeof start).toBe('function');
    expect(typeof update).toBe('function');
    expect(typeof setVolumes).toBe('function');
    expect(typeof playSfx).toBe('function');
    expect(typeof dispose).toBe('function');
    expect(isStarted).toBe(false);
    manager.dispose();
  });
});

describe('AudioManager with a fake AudioContext', () => {
  it('starts once, plays throttled SFX, reacts to state and disposes without dangling nodes', async () => {
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    const manager = new AudioManager();
    await manager.start();
    await manager.start();
    expect(manager.isStarted).toBe(true);
    expect(FakeAudioContext.instances).toHaveLength(1);
    const context = FakeAudioContext.instances[0];
    expect(context).toBeDefined();
    if (!context) return;
    expect(context.state).toBe('running');
    // Pad, ring buses and the eleven persistent ambience beds were built.
    expect(FakeAudioNode.all().length).toBeGreaterThan(45);

    manager.setVolumes({ master: 0.45, music: 0.3, sfx: 0.6 });
    manager.setVolumes({ music: 0.2 });

    const beforeSfx = context.createdSources.length;
    manager.playSfx('ui_click');
    const afterFirst = context.createdSources.length;
    expect(afterFirst).toBeGreaterThan(beforeSfx);
    manager.playSfx('ui_click');
    expect(context.createdSources.length).toBe(afterFirst);
    context.advance(0.5);
    manager.playSfx('ui_click');
    expect(context.createdSources.length).toBeGreaterThan(afterFirst);

    manager.update(makeState('storm', false, 22));
    context.advance(0.2);
    manager.update(makeState('storm', true, 22));
    context.advance(0.2);
    manager.update(makeState('snow', true, 6));
    context.advance(0.2);
    manager.update(makeState('clear', false, 11));

    manager.dispose();
    expect(manager.isStarted).toBe(false);
    expect(context.closeCount).toBe(1);
    expect(context.state).toBe('closed');
    for (const node of FakeAudioNode.all()) expect(node.outgoingCount).toBe(0);
    // Post-dispose calls are safe no-ops.
    manager.update(makeState('rain', false, 3));
    manager.playSfx('coin');
    manager.setVolumes({ master: 0 });
    expect(manager.isStarted).toBe(false);
  });

  it('drives the lookahead schedulers and clears its timers on dispose', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    const manager = new AudioManager();
    await manager.start();
    const context = FakeAudioContext.instances[0];
    if (!context) throw new Error('fake context was not created');
    expect(vi.getTimerCount()).toBe(2);
    const sourcesAfterStart = context.createdSources.length;

    manager.update(makeState('storm', false, 21));
    for (let tick = 0; tick < 14; tick += 1) {
      context.advance(0.75);
      manager.update(makeState('storm', false, 21));
      vi.advanceTimersByTime(300);
    }
    expect(context.createdSources.length).toBeGreaterThan(sourcesAfterStart + 10);
    for (const node of FakeAudioNode.all()) expect(Number.isFinite(node.outgoingCount)).toBe(true);

    manager.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(manager.isStarted).toBe(false);
  });

  it('resumes a suspended context (autoplay unlock) and can restart after dispose', async () => {
    vi.stubGlobal('window', { AudioContext: SuspendedFakeAudioContext });
    const manager = new AudioManager();
    await manager.start();
    expect(manager.isStarted).toBe(true);
    const first = FakeAudioContext.instances[0];
    expect(first).toBeDefined();
    expect(first?.resumeCount).toBe(1);
    expect(first?.state).toBe('running');

    manager.dispose();
    expect(first?.closeCount).toBe(1);
    expect(manager.isStarted).toBe(false);

    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    await manager.start();
    expect(manager.isStarted).toBe(true);
    expect(FakeAudioContext.instances).toHaveLength(2);
    expect(FakeAudioContext.instances[1]?.state).toBe('running');
    manager.dispose();
    expect(FakeAudioContext.instances[1]?.closeCount).toBe(1);
  });
});