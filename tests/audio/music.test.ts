import { describe, expect, it } from 'vitest';
import { DAY_PHASES, SEASONS, WEATHER_TYPES, type Season } from '../../src/core/SharedTypes';
import {
  MUSIC_LAYERS,
  MUSIC_SCALES,
  MUSIC_STEPS_PER_BAR,
  buildMusicPlan,
  chordRootForBar,
  degreeToMidi,
  musicPlanKey,
  musicStepEvents,
  padChordMidi,
} from '../../src/audio/music';

const BASE = { season: 'spring', phase: 'morning', weather: 'clear', indoor: false } as const;

function allPlans() {
  const plans = [];
  for (const season of SEASONS) {
    for (const phase of DAY_PHASES) {
      for (const weather of WEATHER_TYPES) {
        for (const indoor of [false, true]) {
          plans.push(buildMusicPlan({ season, phase, weather, indoor }));
        }
      }
    }
  }
  return plans;
}

describe('music plans', () => {
  it('has one distinct mode per season', () => {
    const ids = SEASONS.map((season) => MUSIC_SCALES[season].id);
    expect(new Set(ids).size).toBe(4);
    const intervals = SEASONS.map((season) => MUSIC_SCALES[season].intervals.join(','));
    expect(new Set(intervals).size).toBe(4);
    for (const season of SEASONS) {
      expect(MUSIC_SCALES[season].intervals).toHaveLength(7);
    }
  });

  it('stays inside sane tempo/density/brightness ranges for every combination', () => {
    for (const plan of allPlans()) {
      expect(Number.isInteger(plan.bpm)).toBe(true);
      expect(plan.bpm).toBeGreaterThanOrEqual(45);
      expect(plan.bpm).toBeLessThanOrEqual(120);
      expect(plan.beatSeconds).toBeCloseTo(60 / plan.bpm, 6);
      expect(plan.stepSeconds).toBeCloseTo(plan.beatSeconds / 2, 9);
      expect(plan.density).toBeGreaterThanOrEqual(0);
      expect(plan.density).toBeLessThanOrEqual(1);
      expect(plan.brightness).toBeGreaterThanOrEqual(0);
      expect(plan.brightness).toBeLessThanOrEqual(1);
      expect(plan.progressionRoots).toHaveLength(4);
      expect(plan.arpPattern.length).toBeGreaterThan(0);
      expect(plan.swing).toBeGreaterThan(0);
      for (const layer of MUSIC_LAYERS) {
        const gain = plan.layerGains[layer];
        expect(gain).toBeGreaterThanOrEqual(0);
        expect(gain).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is deterministic and keyed by the musical context', () => {
    const first = buildMusicPlan(BASE);
    const second = buildMusicPlan(BASE);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(musicPlanKey(first)).toBe(first.id);
    expect(buildMusicPlan({ ...BASE, season: 'winter' }).id).not.toBe(first.id);
    expect(buildMusicPlan({ ...BASE, phase: 'night' }).id).not.toBe(first.id);
    expect(buildMusicPlan({ ...BASE, weather: 'storm' }).id).not.toBe(first.id);
    expect(buildMusicPlan({ ...BASE, indoor: true }).id).not.toBe(first.id);
    const ids = new Set(allPlans().map((plan) => plan.id));
    expect(ids.size).toBe(SEASONS.length * DAY_PHASES.length * WEATHER_TYPES.length * 2);
  });

  it('follows the day phase: night slower/sparser/darker than afternoon', () => {
    const afternoon = buildMusicPlan({ ...BASE, phase: 'afternoon' });
    const night = buildMusicPlan({ ...BASE, phase: 'night' });
    expect(night.bpm).toBeLessThan(afternoon.bpm);
    expect(night.density).toBeLessThan(afternoon.density);
    expect(night.brightness).toBeLessThan(afternoon.brightness);
    expect(night.layerGains.counter).toBeGreaterThan(afternoon.layerGains.counter);
  });

  it('follows the weather: storms are slower and darker than clear skies', () => {
    const clear = buildMusicPlan({ ...BASE, weather: 'clear' });
    const storm = buildMusicPlan({ ...BASE, weather: 'storm' });
    expect(storm.bpm).toBeLessThan(clear.bpm);
    expect(storm.brightness).toBeLessThan(clear.brightness);
    expect(storm.layerGains.arp).toBeLessThan(clear.layerGains.arp);
  });

  it('muffles the arrangement indoors', () => {
    const outdoor = buildMusicPlan(BASE);
    const indoor = buildMusicPlan({ ...BASE, indoor: true });
    expect(indoor.brightness).toBeLessThan(outdoor.brightness);
    expect(indoor.layerGains.arp).toBeLessThan(outdoor.layerGains.arp);
    expect(indoor.layerGains.pad).toBeGreaterThanOrEqual(outdoor.layerGains.pad);
  });
});

describe('degrees, chords and melodic events', () => {
  it('maps scale degrees to ascending MIDI notes and clamps extremes', () => {
    const plan = buildMusicPlan(BASE);
    const notes = [0, 1, 2, 3, 4, 5, 6].map((degree) => degreeToMidi(plan, degree));
    for (let index = 1; index < notes.length; index += 1) {
      expect(notes[index] ?? 0).toBeGreaterThan(notes[index - 1] ?? 0);
    }
    expect(degreeToMidi(plan, -30)).toBeGreaterThanOrEqual(24);
    expect(degreeToMidi(plan, 30)).toBeLessThanOrEqual(96);
  });

  it('produces a three-note ascending pad chord per bar', () => {
    for (const season of SEASONS) {
      const plan = buildMusicPlan({ ...BASE, season: season as Season });
      for (let bar = 0; bar < 8; bar += 1) {
        const chord = padChordMidi(plan, bar);
        expect(chord).toHaveLength(3);
        expect(chord[0] ?? 0).toBeLessThanOrEqual(chord[1] ?? 0);
        expect(chord[1] ?? 0).toBeLessThanOrEqual(chord[2] ?? 0);
        for (const midi of chord) {
          expect(midi).toBeGreaterThanOrEqual(24);
          expect(midi).toBeLessThanOrEqual(84);
        }
        expect(chordRootForBar(plan, bar + 4)).toBe(chordRootForBar(plan, bar));
      }
    }
  });

  it('generates deterministic, audible, bounded notes', () => {
    for (const plan of allPlans()) {
      let totalNotes = 0;
      for (let step = 0; step < MUSIC_STEPS_PER_BAR * 4; step += 1) {
        const notes = musicStepEvents(plan, step);
        const again = musicStepEvents(plan, step);
        expect(JSON.stringify(again)).toBe(JSON.stringify(notes));
        totalNotes += notes.length;
        expect(notes.length).toBeLessThanOrEqual(4);
        for (const note of notes) {
          expect(MUSIC_LAYERS).toContain(note.layer);
          expect(note.frequencyStart).toBeGreaterThanOrEqual(16);
          expect(note.frequencyStart).toBeLessThanOrEqual(18000);
          expect(note.durationSeconds).toBeGreaterThan(0);
          expect(note.gain).toBeGreaterThan(0);
          expect(note.gain).toBeLessThanOrEqual(0.2);
          expect(note.midi).toBeGreaterThanOrEqual(24);
          expect(note.midi).toBeLessThanOrEqual(96);
        }
      }
      expect(totalNotes).toBeGreaterThan(0);
    }
  });

  it('varies the melody over time and across seasons', () => {
    const plan = buildMusicPlan(BASE);
    const signatures = new Set<string>();
    for (let step = 0; step < 64; step += 1) signatures.add(JSON.stringify(musicStepEvents(plan, step)));
    expect(signatures.size).toBeGreaterThan(8);

    const spring = JSON.stringify(musicStepEvents(buildMusicPlan(BASE), 9));
    const winter = JSON.stringify(musicStepEvents(buildMusicPlan({ ...BASE, season: 'winter' }), 9));
    expect(spring).not.toBe(winter);
  });

  it('keeps the dense spring-morning plan musical', () => {
    const plan = buildMusicPlan(BASE);
    const layers = new Set<string>();
    let noteCount = 0;
    for (let step = 0; step < MUSIC_STEPS_PER_BAR * 4; step += 1) {
      for (const note of musicStepEvents(plan, step)) {
        layers.add(note.layer);
        noteCount += 1;
      }
    }
    expect(noteCount).toBeGreaterThanOrEqual(8);
    expect(layers.has('bass')).toBe(true);
    expect(layers.has('arp')).toBe(true);
    expect(plan.layerGains.pad).toBeGreaterThan(0.1);
  });
});
