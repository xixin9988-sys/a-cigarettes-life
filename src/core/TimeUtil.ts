import {
  DAY_PHASES,
  DAYS_PER_SEASON,
  DAYS_PER_WEEK,
  GAME_MINUTES_PER_DAY,
  GAME_MINUTES_PER_HOUR,
  SECONDS_PER_GAME_MINUTE,
  SEASONS,
  type DayPhase,
  type GameTime,
  type Season,
} from './SharedTypes';

export const GAME_SECONDS_PER_DAY = GAME_MINUTES_PER_DAY * SECONDS_PER_GAME_MINUTE;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;

export function dayPhaseOfHour(hour: number): DayPhase {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/** Converts simulation seconds (seconds elapsed since world start at 00:00 of Year 1 Spring 1) to calendar time. */
export function simSecondsToGameTime(simTimeSeconds: number): GameTime {
  const safeSeconds = Math.max(0, Math.floor(simTimeSeconds));
  const totalMinutes = Math.floor(safeSeconds / SECONDS_PER_GAME_MINUTE);
  const totalDays = Math.floor(totalMinutes / GAME_MINUTES_PER_DAY);
  const minutesIntoDay = totalMinutes % GAME_MINUTES_PER_DAY;
  const hour = Math.floor(minutesIntoDay / GAME_MINUTES_PER_HOUR);
  const minute = minutesIntoDay % GAME_MINUTES_PER_HOUR;

  const yearIndex = Math.floor(totalDays / DAYS_PER_YEAR);
  const dayOfYearIndex = totalDays % DAYS_PER_YEAR;
  const seasonIndex = Math.floor(dayOfYearIndex / DAYS_PER_SEASON);
  const dayOfSeason = (dayOfYearIndex % DAYS_PER_SEASON) + 1;
  const season: Season = SEASONS[seasonIndex] ?? 'spring';

  return {
    year: yearIndex + 1,
    season,
    seasonIndex,
    dayOfSeason,
    dayOfYear: dayOfYearIndex + 1,
    hour,
    minute,
    totalHours: Math.floor(totalMinutes / GAME_MINUTES_PER_HOUR),
    totalDays,
    phase: dayPhaseOfHour(hour),
  };
}

/** Converts a calendar time (year 1-based, season/day/hour/minute) to simulation seconds. */
export function gameTimeToSimSeconds(input: {
  year: number;
  seasonIndex: number;
  dayOfSeason: number;
  hour: number;
  minute: number;
}): number {
  const yearIndex = Math.max(0, input.year - 1);
  const dayOfYearIndex =
    yearIndex * DAYS_PER_YEAR + input.seasonIndex * DAYS_PER_SEASON + Math.max(0, input.dayOfSeason - 1);
  const minutes = dayOfYearIndex * GAME_MINUTES_PER_DAY + input.hour * GAME_MINUTES_PER_HOUR + input.minute;
  return minutes * SECONDS_PER_GAME_MINUTE;
}

export function gameTimeToMinuteOfDay(gameTime: GameTime): number {
  return gameTime.hour * GAME_MINUTES_PER_HOUR + gameTime.minute;
}

export function weekdayIndex(gameTime: GameTime): number {
  return gameTime.totalDays % DAYS_PER_WEEK;
}

export function weekdayName(gameTime: GameTime): string {
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
  return names[weekdayIndex(gameTime)] ?? 'Monday';
}

export function isWeekend(gameTime: GameTime): boolean {
  const index = weekdayIndex(gameTime);
  return index === 5 || index === 6;
}

export function hourFloat(gameTime: GameTime): number {
  return gameTime.hour + gameTime.minute / GAME_MINUTES_PER_HOUR;
}

export function isNightHour(hour: number): boolean {
  return hour >= 21 || hour < 6;
}

/** Normalises an hour value into [0, 24). */
export function normaliseHour(hour: number): number {
  const h = hour % 24;
  return h < 0 ? h + 24 : h;
}

/** True if `hour` lies within [openHour, closeHour). Handles overnight openings. */
export function isWithinHours(hour: number, openHour: number, closeHour: number): boolean {
  const h = normaliseHour(hour);
  if (openHour === closeHour) return true;
  if (openHour < closeHour) return h >= openHour && h < closeHour;
  return h >= openHour || h < closeHour;
}

export function nextHourBoundarySimSeconds(simTimeSeconds: number): number {
  const secondsPerHour = GAME_MINUTES_PER_HOUR * SECONDS_PER_GAME_MINUTE;
  return (Math.floor(simTimeSeconds / secondsPerHour) + 1) * secondsPerHour;
}

export function nextDayBoundarySimSeconds(simTimeSeconds: number): number {
  return (Math.floor(simTimeSeconds / GAME_SECONDS_PER_DAY) + 1) * GAME_SECONDS_PER_DAY;
}

export const DAY_PHASE_ORDER: readonly DayPhase[] = DAY_PHASES;
export const SEASON_ORDER: readonly Season[] = SEASONS;