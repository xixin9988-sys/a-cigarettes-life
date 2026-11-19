import { describe, expect, it } from 'vitest';
import {
  SEASON_PALETTES,
  colorFromHex,
  colorToCss,
  dayNightPalette,
  daylightStage,
  lighten,
  locationPalette,
  mixColor,
  regionPalette,
  seasonPalette,
  shade,
  weatherVisual,
} from '../../src/render/palette';
import { SEASONS, WEATHER_TYPES } from '../../src/core/SharedTypes';

function validColor(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffff;
}

describe('season palettes', () => {
  it('defines a complete palette for every season', () => {
    for (const season of SEASONS) {
      const palette = seasonPalette(season);
      expect(palette.season).toBe(season);
      const colors = [palette.grass, palette.grassAlt, palette.path, palette.water, palette.foliage, palette.particle];
      for (const color of colors) expect(validColor(color)).toBe(true);
      expect(palette.grass).not.toBe(palette.water);
    }
    expect(SEASON_PALETTES.winter.grass).not.toBe(SEASON_PALETTES.summer.grass);
  });

  it('falls back to spring for unknown seasons', () => {
    expect(seasonPalette('monsoon').season).toBe('spring');
  });
});

describe('day/night palette', () => {
  it('classifies daylight stages', () => {
    expect(dayNightPalette(1).stage).toBe('day');
    expect(dayNightPalette(0.65).stage).toBe('golden');
    expect(dayNightPalette(0.4).stage).toBe('dusk');
    expect(dayNightPalette(0.2).stage).toBe('twilight');
    expect(dayNightPalette(0).stage).toBe('night');
    expect(daylightStage(0.9)).toBe('day');
  });

  it('darkens monotonically as daylight falls', () => {
    const daylightSamples = [1, 0.8, 0.6, 0.4, 0.2, 0];
    const ambient = daylightSamples.map((value) => dayNightPalette(value).ambientAlpha);
    for (let index = 1; index < ambient.length; index += 1) {
      expect(ambient[index] ?? 0).toBeGreaterThanOrEqual(ambient[index - 1] ?? 0);
    }
    const stars = daylightSamples.map((value) => dayNightPalette(value).starAlpha);
    for (let index = 1; index < stars.length; index += 1) {
      expect(stars[index] ?? 0).toBeGreaterThanOrEqual(stars[index - 1] ?? 0);
    }
    expect(dayNightPalette(0).emberBoost).toBeGreaterThan(dayNightPalette(1).emberBoost);
    expect(dayNightPalette(0).lightStrength).toBeGreaterThan(dayNightPalette(1).lightStrength);
  });

  it('produces in-range colours and alphas', () => {
    for (let daylight = 0; daylight <= 1; daylight += 0.05) {
      const palette = dayNightPalette(daylight);
      expect(validColor(palette.skyTop)).toBe(true);
      expect(validColor(palette.skyBottom)).toBe(true);
      expect(validColor(palette.ambientColor)).toBe(true);
      expect(palette.ambientAlpha).toBeGreaterThanOrEqual(0);
      expect(palette.ambientAlpha).toBeLessThanOrEqual(1);
    }
  });
});

describe('weather visuals', () => {
  it('covers every weather type', () => {
    for (const weather of WEATHER_TYPES) {
      const visual = weatherVisual(weather, 0.5, 0.5);
      expect(validColor(visual.tint)).toBe(true);
      expect(visual.tintAlpha).toBeGreaterThanOrEqual(0);
      expect(visual.cloudiness).toBeGreaterThanOrEqual(0);
      expect(visual.cloudiness).toBeLessThanOrEqual(1);
    }
  });

  it('darkens rain with intensity and leaves clear untouched', () => {
    expect(weatherVisual('rain', 1).tintAlpha).toBeGreaterThan(weatherVisual('rain', 0).tintAlpha);
    expect(weatherVisual('clear', 1).tintAlpha).toBe(0);
    expect(weatherVisual('storm', 1).cloudiness).toBeGreaterThanOrEqual(weatherVisual('cloudy', 0).cloudiness);
  });
});

describe('region and interior palettes', () => {
  it('gives Willowbrook and Ashford distinct architecture palettes', () => {
    const willow = regionPalette('willowbrook');
    const ashford = regionPalette('ashford');
    expect(willow.roofA).not.toBe(ashford.roofA);
    for (const value of Object.values(willow)) expect(validColor(value)).toBe(true);
    for (const value of Object.values(ashford)) expect(validColor(value)).toBe(true);
  });

  it('derives interior colours from authored location colours', () => {
    const palette = locationPalette('#a9a08c', '#7d5a3c', true);
    expect(palette.floor).toBe(0xa9a08c);
    expect(palette.wall).not.toBe(palette.floor);
    expect(validColor(palette.trim)).toBe(true);
    const broken = locationPalette('not-a-colour', 'nope', false);
    expect(validColor(broken.floor)).toBe(true);
  });
});

describe('colour helpers', () => {
  it('parses hex strings', () => {
    expect(colorFromHex('#ff8800', 0)).toBe(0xff8800);
    expect(colorFromHex('ff8800', 0)).toBe(0xff8800);
    expect(colorFromHex('0xff8800', 0)).toBe(0xff8800);
    expect(colorFromHex('#abc', 0)).toBe(0xaabbcc);
    expect(colorFromHex('rubbish', 0x123456)).toBe(0x123456);
  });

  it('round-trips through css', () => {
    expect(colorToCss(0x0a0b0c)).toBe('#0a0b0c');
    expect(colorFromHex(colorToCss(0x123fed), 0)).toBe(0x123fed);
  });

  it('mixes, shades and lightens', () => {
    expect(mixColor(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mixColor(0x000000, 0xffffff, 1)).toBe(0xffffff);
    const mid = mixColor(0x000000, 0xffffff, 0.5);
    expect(mid).toBeGreaterThan(0x7f0000);
    expect(shade(0x808080, 0.5)).toBe(0x404040);
    expect(lighten(0x101010, 0x10)).toBe(0x202020);
  });
});
