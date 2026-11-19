import type { IContentRegistry, NPCState, RelationshipState } from '../core/contracts';
import type { LocationId, WeatherType } from '../core/SharedTypes';
import { interiorIdFor } from '../data/locations/ids';
import { clamp, clamp01 } from '../core/utils';

/**
 * Small helpers shared by the social systems. Kept DOM-free and deterministic:
 * every function is pure except where a state object is passed explicitly.
 */

/** Generates the next sequential id for ids shaped '<prefix>_<number>'. */
export function nextSequentialId(prefix: string, existing: Iterable<string>): string {
  const strictPrefix = prefix + '_';
  let max = -1;
  for (const id of existing) {
    if (!id.startsWith(strictPrefix)) continue;
    const suffix = id.slice(strictPrefix.length);
    if (suffix.length === 0) continue;
    let numeric = true;
    for (let i = 0; i < suffix.length; i += 1) {
      const code = suffix.charCodeAt(i);
      if (code < 48 || code > 57) {
        numeric = false;
        break;
      }
    }
    if (!numeric) continue;
    const value = Number(suffix);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return strictPrefix + String(max + 1);
}

/** Rounds a relationship delta for stable saves/UI (2 decimals). */
export function roundDelta(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Normalises a free-form taste/tag string so 'flowers', 'flower' and 'Flowers!' match. */
export function normaliseTag(tag: string): string {
  const lowered = tag.trim().toLowerCase();
  let result = '';
  for (let i = 0; i < lowered.length; i += 1) {
    const ch = lowered.charAt(i);
    result += ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' ? ch : '_';
  }
  while (result.includes('__')) result = result.replace('__', '_');
  if (result.endsWith('s') && result.length > 3) result = result.slice(0, -1);
  return result;
}

/** Number of tags that match between two tag lists (plural/case tolerant). */
export function countTagMatches(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right.map(normaliseTag));
  let matches = 0;
  for (const tag of left) {
    if (rightSet.has(normaliseTag(tag))) matches += 1;
  }
  return matches;
}

/** True when two location ids describe the same place (exterior or its interior). */
export function isSamePlace(a: LocationId, b: LocationId): boolean {
  if (a === b) return true;
  if (interiorIdFor(b) === a) return true;
  if (interiorIdFor(a) === b) return true;
  return false;
}

/** NPC mood normalised to a 0..100 score (NPCState.mood is a -1..1 style value). */
export function npcMoodScore(npc: NPCState): number {
  const raw = npc.mood;
  const normalised = raw > 1 ? raw / 100 : (raw + 1) / 2;
  return Math.round(clamp01(normalised) * 100);
}

/** Emotional wellbeing from the emotion vector, normalised 0..1. */
export function npcEmotionalWellbeing(npc: NPCState): number {
  const e = npc.emotions;
  return clamp01(0.5 + e.joy * 0.5 - e.sadness * 0.35 - e.anger * 0.25 - e.stress * 0.3);
}

/** How much the current weather makes people want company (0.7..1.1). */
export function weatherSociability(weather: WeatherType): number {
  switch (weather) {
    case 'clear':
      return 1.08;
    case 'cloudy':
      return 1;
    case 'fog':
      return 0.88;
    case 'wind':
      return 0.9;
    case 'rain':
      return 0.86;
    case 'snow':
      return 0.82;
    case 'storm':
      return 0.7;
    default:
      return 1;
  }
}

/** True for weather where people prefer to stay indoors. */
export function isInclementWeather(weather: WeatherType): boolean {
  return weather === 'rain' || weather === 'storm' || weather === 'snow';
}

/** Extra acceptance probability for an outdoor invitation by weather. */
export function invitationWeatherModifier(weather: WeatherType): number {
  switch (weather) {
    case 'clear':
      return 0.05;
    case 'cloudy':
      return 0;
    case 'wind':
      return -0.03;
    case 'fog':
      return -0.05;
    case 'rain':
      return -0.1;
    case 'snow':
      return -0.12;
    case 'storm':
      return -0.18;
    default:
      return 0;
  }
}

/** Experience-based affinity gain multiplier: close friends gain more slowly. */
export function affinityDiminishingFactor(rel: RelationshipState, floor: number, divisor: number): number {
  const raw = 1 - rel.affinity / divisor;
  return clamp(raw, floor, 1.25);
}

/** Normalises a relationship score (-100..100) to 0..1 for probability math. */
export function normaliseRelationshipValue(value: number): number {
  return clamp01((value + 100) / 200);
}

/** Friendly UI summary of a relationship status. */
export function relationshipStatusLabel(rel: RelationshipState): string {
  switch (rel.status) {
    case 'stranger':
      return 'stranger';
    case 'acquaintance':
      return 'acquaintance';
    case 'friend':
      return 'friend';
    case 'close_friend':
      return 'close friend';
    case 'rival':
      return 'rival';
    case 'enemy':
      return 'enemy';
    case 'dating':
      return 'sweetheart';
    case 'partner':
      return 'partner';
    case 'family':
      return 'family';
    case 'ex':
      return 'former partner';
    default:
      return 'stranger';
  }
}

/** Location display name with a graceful fallback for missing content. */
export function locationName(content: IContentRegistry, locationId: LocationId): string {
  return content.getLocation(locationId)?.name ?? locationId.replace(/_/g, ' ');
}

/** Formats a pence amount for player-facing text (e.g. 1250 -> '£12.50'). */
export function formatPence(pence: number): string {
  const value = Math.max(0, Math.round(pence));
  const pounds = Math.floor(value / 100);
  const remainder = value % 100;
  return '£' + String(pounds) + '.' + String(remainder).padStart(2, '0');
}

/** Formats game hours as a compact duration label. */
export function formatGameHours(hours: number): string {
  const whole = Math.max(0, Math.round(hours));
  if (whole < 24) return String(whole) + 'h';
  const days = Math.floor(whole / 24);
  const rest = whole % 24;
  return rest === 0 ? String(days) + 'd' : String(days) + 'd ' + String(rest) + 'h';
}
