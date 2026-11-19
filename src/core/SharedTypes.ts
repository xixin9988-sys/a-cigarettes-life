// Shared runtime constants and primitive types for the whole game.
// This file is DOM-free and safe for Web Workers.

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// ---------------------------------------------------------------------------
// Identifiers (plain string aliases, globally unique)
// ---------------------------------------------------------------------------
export type EntityId = string;
export type WorldId = string;
export type LifeId = string;
export type NPCId = EntityId;
export type PlayerId = EntityId;
export type ItemId = string;
export type LocationId = string;
export type RegionId = 'willowbrook' | 'ashford';
export type BusinessId = string;
export type EventId = string;
export type RecipeId = string;
export type CropId = string;
export type FishId = string;

export const REGION_IDS: readonly RegionId[] = ['willowbrook', 'ashford'];

// ---------------------------------------------------------------------------
// Time / environment primitive unions
// ---------------------------------------------------------------------------
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

export type WeatherType = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow' | 'wind';
export const WEATHER_TYPES: readonly WeatherType[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow', 'wind'];

export type DayPhase = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';
export const DAY_PHASES: readonly DayPhase[] = ['dawn', 'morning', 'afternoon', 'evening', 'night'];

export type SkillId =
  | 'gardening'
  | 'fishing'
  | 'foraging'
  | 'exploration'
  | 'crafting'
  | 'cooking'
  | 'social'
  | 'art';

export const SKILL_IDS: readonly SkillId[] = [
  'gardening',
  'fishing',
  'foraging',
  'exploration',
  'crafting',
  'cooking',
  'social',
  'art',
];

export const SKILL_DISPLAY_NAMES: Readonly<Record<SkillId, string>> = {
  gardening: 'Gardening',
  fishing: 'Fishing',
  foraging: 'Foraging',
  exploration: 'Exploration',
  crafting: 'Crafting',
  cooking: 'Cooking',
  social: 'Socialising',
  art: 'Artistry',
};

export type QualityStars = 1 | 2 | 3 | 4 | 5;

export type ItemCategory =
  | 'seed'
  | 'produce'
  | 'fish'
  | 'material'
  | 'tool'
  | 'equipment'
  | 'food'
  | 'drink'
  | 'furniture'
  | 'decor'
  | 'clothing'
  | 'book'
  | 'collectible'
  | 'gift'
  | 'cigarette'
  | 'recipe'
  | 'misc';

export const ITEM_CATEGORIES: readonly ItemCategory[] = [
  'seed',
  'produce',
  'fish',
  'material',
  'tool',
  'equipment',
  'food',
  'drink',
  'furniture',
  'decor',
  'clothing',
  'book',
  'collectible',
  'gift',
  'cigarette',
  'recipe',
  'misc',
];

export type EquipmentSlot = 'umbrella' | 'windbreak' | 'case' | 'outerwear' | 'accessory' | 'hat' | 'tool';

export const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = [
  'umbrella',
  'windbreak',
  'case',
  'outerwear',
  'accessory',
  'hat',
  'tool',
];

// ---------------------------------------------------------------------------
// Geometry / position
// ---------------------------------------------------------------------------
export interface Vec2 {
  x: number;
  y: number;
}

export interface WorldPosition {
  regionId: RegionId;
  locationId: LocationId;
  x: number;
  y: number;
  indoor: boolean;
}

export interface GameTime {
  /** 1-based year. */
  year: number;
  season: Season;
  /** 0-based season index. */
  seasonIndex: number;
  /** 1-based day within the season. */
  dayOfSeason: number;
  /** 1-based day within the year. */
  dayOfYear: number;
  /** 0-23. */
  hour: number;
  /** 0-59. */
  minute: number;
  /** Whole hours elapsed since world start. */
  totalHours: number;
  /** Whole days elapsed since world start (0-based). */
  totalDays: number;
  phase: DayPhase;
}

// ---------------------------------------------------------------------------
// Relationship primitive
// ---------------------------------------------------------------------------
export type RelationshipStatus =
  | 'stranger'
  | 'acquaintance'
  | 'friend'
  | 'close_friend'
  | 'rival'
  | 'enemy'
  | 'dating'
  | 'partner'
  | 'family'
  | 'ex';

export const RELATIONSHIP_STATUSES: readonly RelationshipStatus[] = [
  'stranger',
  'acquaintance',
  'friend',
  'close_friend',
  'rival',
  'enemy',
  'dating',
  'partner',
  'family',
  'ex',
];

export type EventCategory = 'ordinary' | 'interesting' | 'lucky' | 'unlucky' | 'special';

export const EVENT_CATEGORIES: readonly EventCategory[] = ['ordinary', 'interesting', 'lucky', 'unlucky', 'special'];

export interface InventoryEntry {
  /** Unique instance id. Stackable duplicates merge into one entry until maxStack. */
  instanceId: string;
  itemId: ItemId;
  quantity: number;
  quality: QualityStars;
  /** 0..1, 1 = fresh. Food/produce decay over time. */
  freshness: number;
  /** Sim time (seconds) when acquired. */
  acquiredAt: number;
  /** Optional per-instance metadata (e.g. caught size, crafted by). */
  meta?: JsonObject;
}

// ---------------------------------------------------------------------------
// Display constants
// ---------------------------------------------------------------------------
export const SEASON_DISPLAY_NAMES: Readonly<Record<Season, string>> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
};

export const WEATHER_DISPLAY_NAMES: Readonly<Record<WeatherType, string>> = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  rain: 'Rain',
  storm: 'Storm',
  fog: 'Fog',
  snow: 'Snow',
  wind: 'Windy',
};

export const QUALITY_DISPLAY_NAMES: Readonly<Record<QualityStars, string>> = {
  1: 'Common',
  2: 'Good',
  3: 'Fine',
  4: 'Excellent',
  5: 'Perfect',
};

export const WEEKDAY_NAMES: readonly string[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** Interaction kinds used across social/UI systems. */
export type SocialInteractionKind = 'greet' | 'chat' | 'gift' | 'help' | 'invite' | 'date' | 'confess' | 'apologise';

export const DAYS_PER_WEEK = 7;
// ---------------------------------------------------------------------------
// NPC psychological model value shapes (0..1 traits, 0..100 needs, 0..1 emotions)
// ---------------------------------------------------------------------------
export interface NPCPersonalityValues {
  extroversion: number;
  introversion: number;
  adventure: number;
  caution: number;
  generosity: number;
  curiosity: number;
  socialNeed: number;
  independence: number;
  responsibility: number;
  spendingTendency: number;
  artisticTendency: number;
  workTendency: number;
}

export const PERSONALITY_TRAITS: readonly (keyof NPCPersonalityValues)[] = [
  'extroversion',
  'introversion',
  'adventure',
  'caution',
  'generosity',
  'curiosity',
  'socialNeed',
  'independence',
  'responsibility',
  'spendingTendency',
  'artisticTendency',
  'workTendency',
];

export interface NPCNeedsValues {
  hunger: number;
  energy: number;
  social: number;
  fun: number;
  safety: number;
  belonging: number;
  moneyPressure: number;
  workPressure: number;
  purpose: number;
}

export const NEED_KEYS: readonly (keyof NPCNeedsValues)[] = [
  'hunger',
  'energy',
  'social',
  'fun',
  'safety',
  'belonging',
  'moneyPressure',
  'workPressure',
  'purpose',
];

export interface NPCEmotionsValues {
  joy: number;
  sadness: number;
  anger: number;
  fear: number;
  affection: number;
  stress: number;
}

export const EMOTION_KEYS: readonly (keyof NPCEmotionsValues)[] = [
  'joy',
  'sadness',
  'anger',
  'fear',
  'affection',
  'stress',
];
// ---------------------------------------------------------------------------
// Time scale constants (single source of truth)
// ---------------------------------------------------------------------------
/** Real simulation seconds per in-game minute at 1x speed. */
export const SECONDS_PER_GAME_MINUTE = 1;
export const GAME_MINUTES_PER_HOUR = 60;
export const GAME_MINUTES_PER_DAY = 1440;
export const GAME_HOURS_PER_DAY = 24;
export const DAYS_PER_SEASON = 28;
