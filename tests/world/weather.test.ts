import { describe, expect, it } from 'vitest';
import { WEATHER_TABLE } from '../../src/data/probability/weather';
import { SEASONS, WEATHER_TYPES } from '../../src/core/SharedTypes';
import type { Season, WeatherType } from '../../src/core/SharedTypes';
import { WEATHER_TRANSITION_INTERVAL_HOURS, MAX_WEATHER_STEPS_PER_UPDATE } from '../../src/world/WeatherSystem';
import { RECENT_WEATHER_LIMIT } from '../../src/world/WeatherSystem';
import { createWorldTestBed, advanceGameHours, advanceSimSeconds } from './helpers';

function transitions(season: Season, from: WeatherType): Record<string, number> {
  return { ...(WEATHER_TABLE.bySeason[season]?.[from] ?? {}) };
}

function transitionProbability(season: Season, from: WeatherType, to: WeatherType): number {
  const row = transitions(season, from);
  const total = Object.values(row).reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return 0;
  return (row[to] ?? 0) / total;
}

describe('weather transition table', () => {
  it('defines every season with all seven source rows', () => {
    for (const season of SEASONS) {
      const seasonTable = WEATHER_TABLE.bySeason[season];
      expect(seasonTable, 'season table ' + season).toBeDefined();
      for (const source of WEATHER_TYPES) {
        const row = seasonTable?.[source];
        expect(row, season + '/' + source + ' row').toBeDefined();
        expect(Object.keys(row ?? {}).length).toBeGreaterThan(0);
      }
    }
  });

  it('only contains valid weather targets with positive finite weights', () => {
    for (const season of SEASONS) {
      for (const source of WEATHER_TYPES) {
        const row = transitions(season, source);
        let total = 0;
        for (const [target, weight] of Object.entries(row)) {
          expect(WEATHER_TYPES as readonly string[], season + '/' + source + ' -> ' + target).toContain(target);
          expect(Number.isFinite(weight), season + '/' + source + ' weight').toBe(true);
          expect(weight).toBeGreaterThan(0);
          total += weight;
        }
        expect(total, season + '/' + source + ' total weight').toBeGreaterThan(0);
      }
    }
  });

  it('allows snow only in winter', () => {
    for (const season of SEASONS) {
      for (const source of WEATHER_TYPES) {
        const snowWeight = transitions(season, source).snow ?? 0;
        if (season === 'winter') {
          // Snow must be genuinely possible in winter.
          expect(snowWeight, 'winter snow weight missing from ' + source).toBeGreaterThan(0);
        } else {
          expect(snowWeight, 'unexpected snow transition in ' + season + '/' + source).toBe(0);
        }
      }
    }
  });

  it('makes storms rarer than ordinary cloud/rain transitions', () => {
    for (const season of SEASONS) {
      for (const source of WEATHER_TYPES) {
        const stormChance = transitionProbability(season, source, 'storm');
        expect(stormChance, season + '/' + source + ' storm chance').toBeLessThanOrEqual(0.16);
      }
    }
  });

  it('makes fog more likely in autumn and winter than in spring and summer', () => {
    const averageFog = (season: Season): number => {
      let sum = 0;
      for (const source of WEATHER_TYPES) sum += transitionProbability(season, source, 'fog');
      return sum / WEATHER_TYPES.length;
    };
    expect(averageFog('autumn')).toBeGreaterThan(averageFog('spring'));
    expect(averageFog('winter')).toBeGreaterThan(averageFog('summer'));
    expect(averageFog('autumn')).toBeGreaterThan(0.1);
  });

  it('favours settled weather in summer', () => {
    expect(transitionProbability('summer', 'clear', 'clear')).toBeGreaterThan(0.5);
    expect(transitionProbability('summer', 'clear', 'clear')).toBeGreaterThan(
      transitionProbability('winter', 'clear', 'clear')
    );
  });
});

describe('WeatherSystem', () => {
  it('initialises an absolute next-transition time from state', () => {
    const bed = createWorldTestBed();
    const env = bed.world.getEnvironment();
    const start = bed.clock.simTimeSeconds;
    expect(env.nextWeatherChangeAt).toBeGreaterThan(start);
    expect(env.nextWeatherChangeAt).toBeLessThanOrEqual(start + WEATHER_TRANSITION_INTERVAL_HOURS * 60);
    expect(env.recentWeather.length).toBeGreaterThanOrEqual(1);
  });

  it('transitions exactly on the 4 in-game hour schedule', () => {
    const bed = createWorldTestBed();
    const env = bed.world.getEnvironment();
    const previous = env.weather;
    const nextAt = env.nextWeatherChangeAt;
    // One sim second before the boundary nothing changes.
    bed.clock.setSimTimeSeconds(nextAt - 1);
    bed.world.update(60);
    expect(env.weather).toBe(previous);
    expect(env.nextWeatherChangeAt).toBe(nextAt);
    // Cross the boundary - the Markov chain must pick a next state.
    bed.clock.setSimTimeSeconds(nextAt);
    bed.world.update(60);
    expect(env.previousWeather).toBe(previous);
    expect(env.nextWeatherChangeAt).toBe(nextAt + WEATHER_TRANSITION_INTERVAL_HOURS * 60);
    expect(env.recentWeather.length).toBeGreaterThanOrEqual(2);
    expect(env.recentWeather[env.recentWeather.length - 1]?.weather).toBe(env.weather);
    expect(bed.eventsFor('weather:changed').length).toBeGreaterThanOrEqual(1);
  });

  it('is deterministic for the same seed and diverges for a different seed', () => {
    const run = (seed: number): string[] => {
      const bed = createWorldTestBed({ seed });
      const events: string[] = [];
      bed.bus.on('weather:changed', (payload) => {
        events.push(payload.weather + '@' + Math.round(bed.clock.simTimeSeconds));
      });
      advanceGameHours(bed, 24 * 10);
      return events;
    };
    const first = run(424242);
    const second = run(424242);
    const different = run(999001);
    expect(first.length).toBeGreaterThan(20);
    expect(second).toEqual(first);
    expect(different).not.toEqual(first);
  });

  it('keeps recentWeather capped and consistent', () => {
    const bed = createWorldTestBed({ seed: 77 });
    advanceGameHours(bed, 24 * 20);
    const env = bed.world.getEnvironment();
    expect(env.recentWeather.length).toBeLessThanOrEqual(RECENT_WEATHER_LIMIT);
    for (const entry of env.recentWeather) {
      expect(WEATHER_TYPES).toContain(entry.weather);
      expect(Number.isFinite(entry.at)).toBe(true);
      expect(Number.isFinite(entry.temperature)).toBe(true);
    }
  });

  it('exposes weather, temperature, wind and humidity through IWeatherSystem', () => {
    const bed = createWorldTestBed();
    const env = bed.world.getEnvironment();
    expect(bed.world.weather.getWeather()).toBe(env.weather);
    expect(bed.world.weather.getTemperature()).toBe(env.temperature);
    expect(bed.world.weather.getWindSpeed()).toBe(env.windSpeed);
    expect(bed.world.weather.getHumidity()).toBe(env.humidity);
  });

  it('forceWeather overrides the weather for the requested duration and records it', () => {
    const bed = createWorldTestBed();
    const now = bed.clock.simTimeSeconds;
    const historyBefore = bed.state.world.history.length;
    bed.world.weather.forceWeather('storm', 6);
    const env = bed.world.getEnvironment();
    expect(env.weather).toBe('storm');
    expect(env.rainIntensity).toBeGreaterThan(0.9);
    expect(env.nextWeatherChangeAt).toBe(now + 6 * 60);
    expect(bed.state.world.history.length).toBeGreaterThan(historyBefore);
    const changed = bed.eventsFor('weather:changed');
    expect(changed.length).toBeGreaterThanOrEqual(1);
    // The override is not immediately overwritten by the Markov chain.
    bed.clock.setSimTimeSeconds(now + 5 * 60);
    bed.world.update(0);
    expect(env.weather).toBe('storm');
  });

  it('survives huge offline-style deltas without unbounded loops', () => {
    const bed = createWorldTestBed();
    // Jump 30 in-game days in a single update step.
    bed.clock.advanceSimSeconds(30 * 24 * 60);
    const started = Date.now();
    bed.world.update(30 * 24 * 60);
    expect(Date.now() - started).toBeLessThan(2000);
    const env = bed.world.getEnvironment();
    expect(env.nextWeatherChangeAt).toBeGreaterThan(bed.clock.simTimeSeconds);
    expect(env.nextWeatherChangeAt).toBeLessThanOrEqual(
      bed.clock.simTimeSeconds + WEATHER_TRANSITION_INTERVAL_HOURS * 60 + 1
    );
    expect(MAX_WEATHER_STEPS_PER_UPDATE).toBeGreaterThan(0);
  });

  it('round-trips temperature/humidity/wind between weather and environment systems', () => {
    const bed = createWorldTestBed({ seed: 31337 });
    advanceGameHours(bed, 12);
    const env = bed.world.getEnvironment();
    expect(env.temperature).toBeGreaterThan(-25);
    expect(env.temperature).toBeLessThan(45);
    expect(env.humidity).toBeGreaterThanOrEqual(0);
    expect(env.humidity).toBeLessThanOrEqual(1);
    expect(env.windSpeed).toBeGreaterThanOrEqual(0);
    expect(env.windSpeed).toBeLessThanOrEqual(1.25);
    expect(env.windDirectionDeg).toBeGreaterThanOrEqual(0);
    expect(env.windDirectionDeg).toBeLessThan(360);
    expect(env.rainIntensity).toBeGreaterThanOrEqual(0);
    expect(env.fogDensity).toBeGreaterThanOrEqual(0);
    expect(env.fogDensity).toBeLessThanOrEqual(1);
    expect(env.nextWeatherChangeAt).toBeGreaterThan(bed.clock.simTimeSeconds);
  });
});
