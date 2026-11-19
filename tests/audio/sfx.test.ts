import { describe, expect, it } from 'vitest';
import {
  SOUND_NAMES,
  SFX_DEFINITIONS,
  sfxDetuneCents,
  sfxDuration,
  sfxEvents,
  type SoundName,
} from '../../src/audio/sfx';

describe('SFX catalogue', () => {
  it('covers exactly the documented public cue names', () => {
    expect(SOUND_NAMES).toHaveLength(17);
    expect(new Set(SOUND_NAMES).size).toBe(17);
    expect(Object.keys(SFX_DEFINITIONS).sort()).toEqual([...SOUND_NAMES].sort());
    for (const name of SOUND_NAMES) {
      expect(SFX_DEFINITIONS[name].name).toBe(name);
    }
  });

  it('has valid, bounded definitions for every cue', () => {
    for (const name of SOUND_NAMES) {
      const definition = SFX_DEFINITIONS[name];
      expect(definition.gain).toBeGreaterThan(0);
      expect(definition.gain).toBeLessThanOrEqual(1);
      expect(definition.throttleSeconds).toBeGreaterThanOrEqual(0);
      expect(definition.throttleSeconds).toBeLessThan(1);
      expect(definition.maxConcurrent).toBeGreaterThanOrEqual(1);
      expect(definition.maxConcurrent).toBeLessThanOrEqual(8);
      expect(definition.events.length).toBeGreaterThanOrEqual(1);
      expect(definition.events.length).toBeLessThanOrEqual(6);
      for (const event of definition.events) {
        expect(Number.isFinite(event.offsetSeconds)).toBe(true);
        expect(event.offsetSeconds).toBeGreaterThanOrEqual(0);
        expect(event.offsetSeconds).toBeLessThan(0.5);
        expect(event.durationSeconds).toBeGreaterThan(0);
        expect(event.durationSeconds).toBeLessThanOrEqual(1.5);
        expect(event.gain).toBeGreaterThan(0);
        expect(event.gain).toBeLessThanOrEqual(0.5);
        expect(event.attackSeconds).toBeGreaterThanOrEqual(0);
        expect(event.releaseSeconds).toBeGreaterThanOrEqual(0);
        if (event.kind === 'tone') {
          expect(event.frequencyStart).toBeGreaterThan(16);
          expect(event.frequencyStart).toBeLessThan(18000);
          expect(event.frequencyEnd).toBeGreaterThan(16);
          expect(event.frequencyEnd).toBeLessThan(18000);
          expect(['sine', 'square', 'triangle', 'sawtooth']).toContain(event.waveform);
        } else {
          expect(event.filterStartHz).toBeGreaterThan(0);
          expect(event.filterStartHz).toBeLessThan(18000);
          expect(event.filterEndHz).toBeGreaterThan(0);
          expect(event.filterEndHz).toBeLessThan(18000);
          expect(event.q).toBeGreaterThan(0);
          expect(['lowpass', 'highpass', 'bandpass']).toContain(event.filterType);
        }
      }
    }
  });

  it('gives richer cues multiple voices where it matters', () => {
    expect(SFX_DEFINITIONS.level_up.events.length).toBeGreaterThanOrEqual(4);
    expect(SFX_DEFINITIONS.success.events.length).toBeGreaterThanOrEqual(3);
    expect(SFX_DEFINITIONS.fish_catch.events.length).toBeGreaterThanOrEqual(3);
    expect(SFX_DEFINITIONS.warning.events.length).toBeGreaterThanOrEqual(2);
    const hasNoise = SOUND_NAMES.filter((name) => SFX_DEFINITIONS[name].events.some((event) => event.kind === 'noise'));
    expect(hasNoise.length).toBeGreaterThanOrEqual(8);
  });

  it('keeps every standard gameplay cue wired by main.ts', () => {
    const wired: SoundName[] = [
      'ui_click',
      'fish_catch',
      'harvest',
      'level_up',
      'coin',
      'item_get',
      'warning',
      'save',
      'success',
    ];
    for (const name of wired) expect(SOUND_NAMES).toContain(name);
  });

  it('applies deterministic per-variant detune and stays reproducible', () => {
    for (const name of SOUND_NAMES) {
      for (const variant of [0, 1, 2, 37, 996]) {
        expect(sfxDetuneCents(name, variant)).toBe(sfxDetuneCents(name, variant));
        expect(Math.abs(sfxDetuneCents(name, variant))).toBeLessThanOrEqual(4);
        expect(JSON.stringify(sfxEvents(name, variant))).toBe(JSON.stringify(sfxEvents(name, variant)));
      }
      const variants = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((variant) => JSON.stringify(sfxEvents(name, variant))));
      expect(variants.size).toBeGreaterThan(1);
    }
    expect(sfxDuration('level_up')).toBeGreaterThan(0.3);
    expect(sfxDuration('level_up')).toBeLessThan(3);
    expect(sfxDuration('ui_click')).toBeLessThan(0.2);
  });
});
