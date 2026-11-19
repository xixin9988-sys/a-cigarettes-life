import type { WeatherTransitionTable } from '../schema';

/**
 * OWNER: Agent 4 (World & Map).
 *
 * Season-aware Markov-chain weather transition table.
 * Rows are the current weather, columns are the candidate next weather and the
 * value is a relative weight (rows do not need to sum to 100 - the weather
 * system normalises them before drawing from the 'world.weather' stream).
 *
 * Seasonal design notes:
 *  - Spring is changeable and breezy, with showers and the odd thunderstorm.
 *  - Summer is dominated by clear skies; storms are short and rare.
 *  - Autumn is the foggy, wet and windy season.
 *  - Winter is the only season in which snow can appear (target weights for
 *    'snow' are only present in the winter rows). Fog and frost are common.
 * Snow therefore never occurs outside winter, but the 'snow' source row is
 * still defined in every season so the matrix is complete for forced weather.
 */
export const WEATHER_TABLE: WeatherTransitionTable = {
  bySeason: {
    spring: {
      clear: { clear: 32, cloudy: 34, rain: 18, wind: 10, fog: 4, storm: 2 },
      cloudy: { clear: 18, cloudy: 30, rain: 28, wind: 12, fog: 6, storm: 6 },
      rain: { clear: 12, cloudy: 32, rain: 26, wind: 10, fog: 8, storm: 12 },
      storm: { clear: 10, cloudy: 34, rain: 30, wind: 14, fog: 4, storm: 8 },
      fog: { clear: 16, cloudy: 30, rain: 20, wind: 14, fog: 18, storm: 2 },
      snow: { clear: 25, cloudy: 45, rain: 20, wind: 10 },
      wind: { clear: 30, cloudy: 32, rain: 14, wind: 16, fog: 2, storm: 6 },
    },
    summer: {
      clear: { clear: 62, cloudy: 20, rain: 8, wind: 4, storm: 6 },
      cloudy: { clear: 34, cloudy: 30, rain: 20, wind: 6, storm: 10 },
      rain: { clear: 24, cloudy: 34, rain: 22, wind: 6, storm: 14 },
      storm: { clear: 30, cloudy: 36, rain: 22, wind: 6, storm: 6 },
      fog: { clear: 40, cloudy: 34, rain: 10, wind: 16 },
      snow: { clear: 40, cloudy: 40, rain: 20 },
      wind: { clear: 46, cloudy: 26, rain: 10, wind: 10, storm: 8 },
    },
    autumn: {
      clear: { clear: 24, cloudy: 32, rain: 20, wind: 8, fog: 14, storm: 2 },
      cloudy: { clear: 12, cloudy: 26, rain: 30, wind: 14, fog: 14, storm: 4 },
      rain: { clear: 8, cloudy: 28, rain: 30, wind: 14, fog: 14, storm: 6 },
      storm: { clear: 8, cloudy: 30, rain: 32, wind: 16, fog: 10, storm: 4 },
      fog: { clear: 10, cloudy: 30, rain: 20, wind: 12, fog: 28 },
      snow: { clear: 20, cloudy: 40, rain: 20, wind: 10, fog: 10 },
      wind: { clear: 18, cloudy: 30, rain: 24, wind: 16, fog: 10, storm: 2 },
    },
    winter: {
      clear: { clear: 20, cloudy: 30, rain: 4, wind: 12, fog: 16, snow: 18 },
      cloudy: { clear: 10, cloudy: 24, rain: 8, wind: 12, fog: 16, snow: 28, storm: 2 },
      rain: { clear: 6, cloudy: 24, rain: 12, wind: 14, fog: 14, snow: 26, storm: 4 },
      storm: { clear: 6, cloudy: 30, rain: 16, wind: 20, snow: 24, storm: 4 },
      fog: { clear: 8, cloudy: 24, rain: 4, wind: 14, fog: 34, snow: 16 },
      snow: { clear: 14, cloudy: 26, rain: 4, wind: 14, fog: 12, snow: 30 },
      wind: { clear: 12, cloudy: 28, rain: 4, wind: 18, fog: 12, snow: 22, storm: 4 },
    },
  },
};

/** The seven weather types, used for matrix validation. */
export const WEATHER_TABLE_TYPES = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow', 'wind'] as const;
