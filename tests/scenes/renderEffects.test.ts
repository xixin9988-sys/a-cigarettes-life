import { describe, expect, it } from 'vitest';
import {
  ambientKind,
  ambientProfile,
  celestialProgress,
  cloudOffset,
  fogProfile,
  lightningBolt,
  lightningFlash,
  precipitationKind,
  rainProfile,
  snowProfile,
  starTwinkle,
  windDustProfile,
  windSway,
} from '../../src/render/effects';
import { SEASONS } from '../../src/core/SharedTypes';

describe('precipitation profiles', () => {
  it('scales rain with intensity and drifts with wind', () => {
    const drizzle = rainProfile(0.2, 0.1);
    const downpour = rainProfile(0.2, 1);
    expect(downpour.count).toBeGreaterThan(drizzle.count);
    expect(downpour.alpha).toBeGreaterThan(drizzle.alpha);
    expect(rainProfile(1, 0.5).driftX).toBeGreaterThan(rainProfile(0, 0.5).driftX);
    for (const profile of [drizzle, downpour]) {
      expect(profile.length).toBeGreaterThan(0);
      expect(profile.speed).toBeGreaterThan(0);
    }
  });

  it('scales snow and fog profiles', () => {
    expect(snowProfile(0.2, 1).count).toBeGreaterThan(snowProfile(0.2, 0.1).count);
    expect(snowProfile(1, 0.5).driftX).toBeGreaterThan(snowProfile(0, 0.5).driftX);
    expect(fogProfile(1).alpha).toBeGreaterThan(fogProfile(0.1).alpha);
    expect(fogProfile(1).blobs).toBeGreaterThanOrEqual(fogProfile(0.1).blobs);
    expect(windDustProfile(1).count).toBeGreaterThan(windDustProfile(0).count);
  });

  it('decides rain vs snow vs nothing', () => {
    expect(precipitationKind('rain', 'summer')).toBe('rain');
    expect(precipitationKind('storm', 'winter')).toBe('snow');
    expect(precipitationKind('snow', 'spring')).toBe('snow');
    expect(precipitationKind('clear', 'summer')).toBe('none');
    expect(precipitationKind('cloudy', 'winter')).toBe('snow');
  });
});

describe('seasonal ambient particles', () => {
  it('selects a kind per season and light level', () => {
    expect(ambientKind('spring', 0.8)).toBe('petal');
    expect(ambientKind('autumn', 0.8)).toBe('leaf');
    expect(ambientKind('winter', 0.8)).toBe('mote');
    expect(ambientKind('summer', 0.8)).toBe('mote');
    expect(ambientKind('summer', 0.1)).toBe('firefly');
  });

  it('returns coherent profiles', () => {
    for (const season of SEASONS) {
      const profile = ambientProfile(season, 0.5);
      expect(profile.count).toBeGreaterThan(0);
      expect(profile.color).toBeGreaterThanOrEqual(0);
      expect(profile.alpha).toBeGreaterThan(0);
      expect(profile.glow).toBe(profile.kind === 'firefly');
    }
  });
});

describe('lightning', () => {
  it('flashes deterministically within a bounded envelope', () => {
    const seed = 12345;
    let flashes = 0;
    let previous = -1;
    for (let seconds = 0; seconds < 40; seconds += 0.05) {
      const value = lightningFlash(seconds, seed);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      if (value > 0.6) flashes += 1;
      if (seconds === 0) previous = value;
    }
    expect(lightningFlash(0, seed)).toBe(previous);
    expect(flashes).toBeGreaterThan(0);
    // Different seeds schedule different strikes.
    const a = lightningFlash(3.1, 1);
    const b = lightningFlash(3.1, 2);
    expect(a === b && a !== 0).toBe(false);
  });

  it('builds a jagged bolt polyline', () => {
    const points = lightningBolt(99, 400, 10, 200, 7);
    expect(points.length).toBe(8);
    expect(points[0]?.y).toBe(10);
    expect(points[points.length - 1]?.y).toBe(200);
    expect(Math.abs((points[0]?.x ?? 0) - 400)).toBeLessThan(1e-9);
    expect(Math.abs((points[points.length - 1]?.x ?? 0) - 400)).toBeLessThan(1e-9);
  });
});

describe('sky / ambient motion helpers', () => {
  it('wraps clouds across the scene', () => {
    for (let seconds = 0; seconds < 200; seconds += 7) {
      const x = cloudOffset(seconds, 0.5, 100, 1280);
      expect(x).toBeGreaterThanOrEqual(-100);
      expect(x).toBeLessThanOrEqual(1280 + 100);
    }
  });

  it('places the sun high at noon and below the horizon at night', () => {
    expect(celestialProgress(12)).toBeGreaterThan(0.4);
    expect(celestialProgress(0)).toBe(0);
    expect(celestialProgress(23)).toBe(1);
  });

  it('keeps twinkle and wind sway small and bounded', () => {
    for (let index = 0; index < 10; index += 1) {
      const twinkle = starTwinkle(index, index * 2.4);
      expect(twinkle).toBeGreaterThanOrEqual(0.1);
      expect(twinkle).toBeLessThanOrEqual(1);
      const sway = windSway(index, 1, index * 1.7);
      expect(Math.abs(sway)).toBeLessThanOrEqual(0.03);
    }
  });
});
