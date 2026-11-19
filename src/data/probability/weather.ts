import type { WeatherTransitionTable } from '../schema';

/** OWNER: Agent 4 (World & Map). Season-aware weather transition matrix. */
export const WEATHER_TABLE: WeatherTransitionTable = {
  bySeason: { spring: {}, summer: {}, autumn: {}, winter: {} },
};
