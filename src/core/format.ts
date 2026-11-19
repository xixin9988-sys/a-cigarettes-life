import {
  QUALITY_DISPLAY_NAMES,
  SEASON_DISPLAY_NAMES,
  SKILL_DISPLAY_NAMES,
  WEEKDAY_NAMES,
  WEATHER_DISPLAY_NAMES,
  type GameTime,
  type QualityStars,
  type Season,
  type SkillId,
  type WeatherType,
} from './SharedTypes';
import { weekdayIndex } from './TimeUtil';

/** Money is always stored as integer pence. Displays as £12.50. */
export function formatMoney(pence: number): string {
  const safe = Math.round(pence);
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  const pounds = Math.floor(abs / 100);
  const pennies = abs % 100;
  return `${sign}£${pounds}.${pennies.toString().padStart(2, '0')}`;
}

export function formatGameTime(gameTime: GameTime): string {
  const hour = gameTime.hour.toString().padStart(2, '0');
  const minute = gameTime.minute.toString().padStart(2, '0');
  return `${hour}:${minute}`;
}

export function formatGameDate(gameTime: GameTime): string {
  return `${SEASON_DISPLAY_NAMES[gameTime.season]} ${gameTime.dayOfSeason}, Year ${gameTime.year}`;
}

export function formatFullGameTime(gameTime: GameTime): string {
  return `${formatGameDate(gameTime)} · ${formatGameTime(gameTime)}`;
}

export function formatWeekday(gameTime: GameTime): string {
  return WEEKDAY_NAMES[weekdayIndex(gameTime)] ?? 'Monday';
}

export function weatherLabel(weather: WeatherType): string {
  return WEATHER_DISPLAY_NAMES[weather];
}

export function seasonLabel(season: Season): string {
  return SEASON_DISPLAY_NAMES[season];
}

export function skillLabel(skill: SkillId): string {
  return SKILL_DISPLAY_NAMES[skill];
}

export function qualityStars(quality: QualityStars): string {
  return '★'.repeat(quality) + '☆'.repeat(5 - quality);
}

export function qualityLabel(quality: QualityStars): string {
  return `${QUALITY_DISPLAY_NAMES[quality]} ${qualityStars(quality)}`;
}

export function formatDurationGameHours(hours: number): string {
  const safe = Math.max(0, Math.round(hours));
  const days = Math.floor(safe / 24);
  const rest = safe % 24;
  if (days > 0) return `${days}d ${rest}h`;
  return `${rest}h`;
}

export function formatPercentValue(value01: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value01)) * 100)}%`;
}
