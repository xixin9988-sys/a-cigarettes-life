import { describe, expect, it } from 'vitest';
import { DAY_PHASES, SEASONS, WEATHER_TYPES, type DayPhase, type Season, type WeatherType } from '../../src/core/SharedTypes';
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
  type AmbienceInput,
  type AmbienceLayerId,
} from '../../src/audio/ambience';
import { approach } from '../../src/audio/deterministic';

const BASE: AmbienceInput = {
  weather: 'clear',
  season: 'spring',
  phase: 'afternoon',
  indoor: false,
  regionId: 'willowbrook',
  hasHeatSource: false,
  windSpeed: 5,
  rainIntensity: 0,
};

function plan(overrides: Partial<AmbienceInput>) {
  return buildAmbiencePlan({ ...BASE, ...overrides });
}

function expectGainInRange(layer: AmbienceLayerId, value: number): void {
  expect(Number.isFinite(value), layer).toBe(true);
  expect(value).toBeGreaterThanOrEqual(0);
  expect(value).toBeLessThanOrEqual(1);
}

describe('ambience plans', () => {
  it('is deterministic and changes id with the scene', () => {
    expect(plan({}).id).toBe(plan({}).id);
    expect(plan({ weather: 'rain' }).id).not.toBe(plan({}).id);
    expect(plan({ indoor: true }).id).not.toBe(plan({}).id);
    expect(plan({ phase: 'night' }).id).not.toBe(plan({}).id);
    expect(plan({ regionId: 'ashford' }).id).not.toBe(plan({}).id);
    expect(plan({ hasHeatSource: true }).id).not.toBe(plan({}).id);
    expect(plan({ windSpeed: 25 }).id).not.toBe(plan({}).id);
    expect(plan({ rainIntensity: 0.9, weather: 'rain' }).id).not.toBe(plan({ weather: 'rain' }).id);
  });

  it('covers every combination with finite in-range layer gains', () => {
    for (const weather of WEATHER_TYPES) {
      for (const season of SEASONS) {
        for (const phase of DAY_PHASES) {
          for (const indoor of [false, true]) {
            for (const regionId of ['willowbrook', 'ashford'] as const) {
              for (const hasHeatSource of [false, true]) {
                const result = plan({ weather, season, phase, indoor, regionId, hasHeatSource });
                for (const layer of AMBIENCE_LAYERS) expectGainInRange(layer, result.layerGains[layer]);
                expect(result.thunderActivity).toBeGreaterThanOrEqual(0);
                expect(result.thunderActivity).toBeLessThanOrEqual(1);
                expect(result.stormIntensity).toBeGreaterThanOrEqual(0);
                expect(result.stormIntensity).toBeLessThanOrEqual(1);
                expect(result.fireIntensity).toBeGreaterThanOrEqual(0);
                expect(result.fireIntensity).toBeLessThanOrEqual(1);
                expect(result.muffle).toBeGreaterThan(0);
                expect(result.muffle).toBeLessThanOrEqual(1);
              }
            }
          }
        }
      }
    }
  });

  it('clear spring afternoon outdoors is calm: birds yes, rain/thunder/fire no', () => {
    const result = plan({});
    expect(result.layerGains.rain).toBe(0);
    expect(result.layerGains.rainHeavy).toBe(0);
    expect(result.layerGains.snowHush).toBe(0);
    expect(result.layerGains.fogDrone).toBe(0);
    expect(result.layerGains.fireCrackle).toBe(0);
    expect(result.layerGains.roomTone).toBe(0);
    expect(result.layerGains.birds).toBeGreaterThan(0);
    expect(result.layerGains.crickets).toBe(0);
    expect(result.thunderActivity).toBe(0);
    expect(result.layerGains.wind).toBeGreaterThan(0);
  });

  it('rain adds rain beds and dampens wildlife; storm adds thunder', () => {
    const clear = plan({});
    const rain = plan({ weather: 'rain', rainIntensity: 0.8, windSpeed: 14 });
    const storm = plan({ weather: 'storm', rainIntensity: 1, windSpeed: 26 });
    expect(rain.layerGains.rain).toBeGreaterThan(0.15);
    expect(rain.layerGains.rainHeavy).toBeGreaterThan(0);
    expect(rain.layerGains.rain).toBeGreaterThan(clear.layerGains.rain);
    expect(rain.layerGains.birds).toBeLessThan(clear.layerGains.birds);
    expect(rain.thunderActivity).toBe(0);
    expect(storm.layerGains.rain).toBeGreaterThanOrEqual(rain.layerGains.rain);
    expect(storm.layerGains.wind).toBeGreaterThan(rain.layerGains.wind);
    expect(storm.thunderActivity).toBe(1);
    expect(storm.stormIntensity).toBeGreaterThanOrEqual(0.4);
    expect(storm.layerGains.birds).toBe(0);
  });

  it('snow and fog add their signature beds', () => {
    expect(plan({ weather: 'snow' }).layerGains.snowHush).toBeGreaterThan(0);
    expect(plan({ weather: 'fog' }).layerGains.fogDrone).toBeGreaterThan(0);
    expect(plan({ weather: 'wind', windSpeed: 25 }).layerGains.wind).toBeGreaterThan(0.2);
  });

  it('indoor muffle attenuates weather, adds room tone and fire', () => {
    const outdoor = plan({ weather: 'rain', rainIntensity: 0.7, hasHeatSource: false });
    const indoorCold = plan({ weather: 'rain', rainIntensity: 0.7, indoor: true, hasHeatSource: false });
    const indoorFire = plan({ weather: 'rain', rainIntensity: 0.7, indoor: true, hasHeatSource: true });
    expect(indoorCold.layerGains.rain).toBeLessThan(outdoor.layerGains.rain * 0.3);
    expect(indoorCold.layerGains.roomTone).toBeGreaterThan(0);
    expect(indoorCold.layerGains.outdoorMuffle).toBeGreaterThan(0);
    expect(indoorCold.layerGains.fireCrackle).toBeGreaterThan(0);
    expect(indoorFire.layerGains.fireCrackle).toBeGreaterThan(indoorCold.layerGains.fireCrackle);
    expect(indoorCold.layerGains.birds).toBeLessThan(outdoor.layerGains.birds);
  });

  it('indoor thunder is quieter than outdoor thunder but still audible', () => {
    const outdoor = plan({ weather: 'storm', rainIntensity: 1 });
    const indoor = plan({ weather: 'storm', rainIntensity: 1, indoor: true });
    expect(indoor.thunderActivity).toBeGreaterThan(0);
    expect(indoor.thunderActivity).toBeLessThan(outdoor.thunderActivity);
  });

  it('night brings crickets, dawn brings birds, cities hum', () => {
    expect(plan({ season: 'summer', phase: 'night' }).layerGains.crickets).toBeGreaterThan(0);
    expect(plan({ season: 'summer', phase: 'night' }).layerGains.birds).toBe(0);
    expect(plan({ phase: 'dawn' }).layerGains.birds).toBeGreaterThan(0);
    expect(plan({ regionId: 'ashford' }).layerGains.cityHum).toBeGreaterThan(0);
    expect(plan({ regionId: 'ashford', indoor: true }).layerGains.cityHum).toBeLessThan(
      plan({ regionId: 'ashford' }).layerGains.cityHum
    );
  });

  it('every layer has a synthesis recipe with valid parameters', () => {
    for (const layer of AMBIENCE_LAYERS) {
      const config = AMBIENCE_LAYER_CONFIGS[layer];
      expect(config.filterHz).toBeGreaterThan(0);
      expect(config.q).toBeGreaterThan(0);
      expect(Number.isFinite(config.lfoHz)).toBe(true);
      expect(config.lfoHz).toBeGreaterThanOrEqual(0);
      expect(config.lfoDepth).toBeGreaterThanOrEqual(0);
      if (config.kind === 'oscillator') {
        expect(config.frequencyHz).toBeGreaterThan(16);
        expect(config.frequencyHz).toBeLessThan(2000);
      }
    }
  });
});

describe('thunder scheduling', () => {
  it('produces deterministic, bounded profiles', () => {
    for (let counter = 0; counter < 200; counter += 1) {
      const first = thunderProfile(counter);
      const second = thunderProfile(counter);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.delaySeconds).toBeGreaterThanOrEqual(0);
      expect(first.delaySeconds).toBeLessThan(0.4);
      expect(first.rumbleSeconds).toBeGreaterThanOrEqual(2);
      expect(first.rumbleSeconds).toBeLessThanOrEqual(5);
      expect(first.peakGain).toBeGreaterThan(0.1);
      expect(first.peakGain).toBeLessThanOrEqual(0.6);
      expect(first.crackGain).toBeGreaterThan(0);
      expect(first.crackGain).toBeLessThan(0.4);
      expect(first.lowpassHz).toBeGreaterThanOrEqual(240);
      expect(first.lowpassHz).toBeLessThanOrEqual(800);
      expect(first.rollCount).toBeGreaterThanOrEqual(2);
      expect(first.rollCount).toBeLessThanOrEqual(4);
    }
  });

  it('varies strike character and schedules more closely in stronger storms', () => {
    const signatures = new Set<string>();
    let quietTotal = 0;
    let loudTotal = 0;
    for (let counter = 0; counter < 200; counter += 1) {
      signatures.add(JSON.stringify(thunderProfile(counter)));
      quietTotal += nextThunderDelay(counter, 0.3);
      loudTotal += nextThunderDelay(counter, 1);
    }
    expect(signatures.size).toBeGreaterThan(50);
    expect(quietTotal / 200).toBeGreaterThan(20);
    expect(loudTotal / 200).toBeGreaterThan(3);
    expect(loudTotal / 200).toBeLessThan(quietTotal / 200);
    expect(nextThunderDelay(5, 1)).toBeGreaterThan(0);
  });
});

describe('fire and wildlife one-shots', () => {
  it('fire crackle is deterministic and correlated with intensity', () => {
    let hotTotal = 0;
    let coldTotal = 0;
    for (let counter = 0; counter < 100; counter += 1) {
      const profile = fireCrackleProfile(counter);
      expect(JSON.stringify(fireCrackleProfile(counter))).toBe(JSON.stringify(profile));
      expect(profile.durationSeconds).toBeGreaterThan(0);
      expect(profile.durationSeconds).toBeLessThan(0.2);
      expect(profile.gain).toBeGreaterThan(0);
      expect(profile.gain).toBeLessThanOrEqual(0.2);
      expect(profile.bandpassHz).toBeGreaterThanOrEqual(1800);
      expect(profile.bandpassHz).toBeLessThanOrEqual(4200);
      hotTotal += nextFireCrackleDelay(counter, 1);
      coldTotal += nextFireCrackleDelay(counter, 0.1);
    }
    expect(hotTotal / 100).toBeLessThan(coldTotal / 100);
    expect(nextFireCrackleDelay(0, 1)).toBeGreaterThan(0);
  });

  it('bird chirps are deterministic, bounded and varied', () => {
    const signatures = new Set<string>();
    for (let counter = 0; counter < 100; counter += 1) {
      const chirp = birdChirp(counter);
      expect(JSON.stringify(birdChirp(counter))).toBe(JSON.stringify(chirp));
      expect(chirp.kind).toBe('bird');
      expect(chirp.events.length).toBeGreaterThanOrEqual(2);
      expect(chirp.events.length).toBeLessThanOrEqual(4);
      expect(chirp.totalSeconds).toBeGreaterThan(0);
      expect(chirp.totalSeconds).toBeLessThan(2);
      let previousOffset = -1;
      for (const event of chirp.events) {
        expect(event.offsetSeconds).toBeGreaterThanOrEqual(previousOffset);
        previousOffset = event.offsetSeconds;
        expect(event.frequencyStart).toBeGreaterThan(1500);
        expect(event.frequencyStart).toBeLessThan(7000);
        expect(event.durationSeconds).toBeGreaterThan(0);
        expect(event.gain).toBeGreaterThan(0);
      }
      signatures.add(JSON.stringify(chirp));
    }
    expect(signatures.size).toBeGreaterThan(50);
    expect(nextBirdChirpDelay(0, 1)).toBeGreaterThan(0);
    expect(nextBirdChirpDelay(0, 1)).toBeLessThan(nextBirdChirpDelay(0, 0.1) * 20);
  });

  it('cricket chirps are high, fast and deterministic', () => {
    for (let counter = 0; counter < 100; counter += 1) {
      const chirp = cricketChirp(counter);
      expect(JSON.stringify(cricketChirp(counter))).toBe(JSON.stringify(chirp));
      expect(chirp.kind).toBe('cricket');
      expect(chirp.events.length).toBeGreaterThanOrEqual(3);
      expect(chirp.events.length).toBeLessThanOrEqual(6);
      for (const event of chirp.events) {
        expect(event.frequencyStart).toBeGreaterThan(3000);
        expect(event.frequencyStart).toBeLessThan(6000);
        expect(event.durationSeconds).toBeGreaterThan(0);
        expect(event.durationSeconds).toBeLessThan(0.05);
      }
      expect(chirp.totalSeconds).toBeGreaterThan(0);
      expect(chirp.totalSeconds).toBeLessThan(1);
    }
    expect(nextCricketChirpDelay(0, 1)).toBeGreaterThan(0);
  });

  it('crossfade helper converges monotonically', () => {
    let value = 0;
    for (let step = 0; step < 40; step += 1) {
      const next = approach(value, 0.8, 0.05, 0.9);
      expect(next).toBeGreaterThanOrEqual(value);
      value = next;
    }
    expect(value).toBeGreaterThan(0.7);
  });
});
