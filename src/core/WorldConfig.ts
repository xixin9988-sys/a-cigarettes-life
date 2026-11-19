import type { Season, SkillId, WeatherType } from './SharedTypes';

/**
 * Central balance and world configuration. All systems read from here so that
 * gameplay tuning stays in one auditable place.
 */
export const WORLD_CONFIG = {
  saveVersion: 1,
  worldTime: {
    /** Real seconds per in-game minute at 1x speed. */
    secondsPerGameMinute: 1,
    /** Starting calendar point of a new life. */
    startYear: 1,
    startSeasonIndex: 0,
    startDayOfSeason: 1,
    startHour: 8,
    startMinute: 0,
    /** Autosave cadence in real seconds. */
    autosaveIntervalSeconds: 120,
    /** Maximum real hours of offline simulation processed in one go. */
    maxOfflineRealHours: 24 * 180,
    /** Real seconds -> simulated seconds multiplier for offline catch-up. */
    /** 1 real hour offline = 180 sim seconds = 3 in-game hours (so 24h real = 3 game days). */
    offlineTimeScale: 0.05,
    /** Hard cap of simulated game days processed in a single offline catch-up. */
    maxOfflineGameDays: 14,
  },
  cigarette: {
    /** Game hours of full burn at 1x base rate with no modifiers. */
    lifetimeGameHours: 336,
    /** Life fraction burned per game hour of active play at base rate. */
    baseBurnPerGameHour: 1 / 336,
    /** Fraction of the active burn rate applied while the game is closed. */
    offlineBurnMultiplier: 0.35,
    /** Baseline moisture evaporation per game hour in dry sheltered areas. */
    moistureDryRatePerHour: 0.08,
    /** Rain moisture gain per game hour without protection at rainIntensity 1. */
    moistureRainGainPerHour: 0.55,
    /** At/above this moisture the player is "soaked" and cannot do heavy work. */
    soakedThreshold: 0.85,
    /** Moisture above this starts slowing movement. */
    dampThreshold: 0.3,
    /** Ash collected per 0.01 length burned. */
    ashPerLengthUnit: 0.0045,
    maxAsh: 100,
  },
  needs: {
    decayPerGameHour: {
      hunger: 2.2,
      energy: 1.9,
      social: 1.4,
      fun: 1.6,
      safety: 0.4,
      belonging: 0.8,
      moneyPressure: 0.7,
      workPressure: 0.9,
      purpose: 0.5,
    },
  },
  npcEconomy: {
    livingReserveRatio: 0.25,
    maxBudgetSharePerPurchase: 0.35,
    wageTaxRate: 0.12,
    dailyFoodBudgetRatio: 0.15,
  },
  economy: {
    priceClampMin: 0.4,
    priceClampMax: 2.5,
    marketSettlementHours: 1,
    dailySettlementHour: 22,
    restockHour: 7,
  },
  skill: {
    maxLevel: 20,
    /** Base XP required for level 2; grows exponentially per level. */
    baseXpToLevel: 60,
    xpGrowth: 1.18,
    xpActivityMultiplier: 1,
  },
  farming: {
    wildGrowthSpeed: 0.35,
    growthHoursMultiplier: 1,
    dryRatePerHour: 0.12,
    waterCapacity: 1,
    ashPotashBonus: 0.25,
    diseaseBaseRatePerHour: 0.004,
    weedSpawnPerHour: 0.03,
    witheredAfterDryHours: 72,
  },
  fishing: {
    baseBiteWaitGameMinutes: { min: 4, max: 22 },
    tensionRisePerSecond: 42,
    progressPerSecond: 26,
    escapeTension: 100,
    catchProgress: 100,
  },
  simulation: {
    activeTickSeconds: 0.25,
    backgroundNpcIntervalGameMinutes: 10,
    economyIntervalGameMinutes: 60,
    environmentIntervalGameMinutes: 15,
    worldEventIntervalGameMinutes: 30,
    offlineStepMinutes: { short: 5, medium: 30, long: 1440 },
    workerOfflineTimeoutMs: 60000,
    maxOfflineEvents: 250,
    maxWorldEventLog: 400,
    maxHistoryEntries: 800,
    historyArchiveImportance: 3,
  },
  economyStarting: {
    playerMoneyPence: 25000,
    npcMoneyRangePence: [8000, 95000] as [number, number],
    businessMoneyRangePence: [30000, 400000] as [number, number],
  },
  map: {
    tileSize: 32,
    renderWidth: 1280,
    renderHeight: 720,
  },
  world: {
    majorNpcCount: 14,
    residentNpcCount: 42,
    majorNpcRelationshipSeedMin: 1,
    maxRelationshipHistory: 40,
    memoryDecayLambdaPerDay: 0.08,
    permanentMemoryThreshold: 80,
    shortTermMemoryThreshold: 5,
  },
  population: {
    initialNpcCount: 56,
  },
  social: {
    maxFriends: 20,
    giftCooldownGameHours: 12,
    chatCooldownGameHours: 1,
    inviteCooldownGameHours: 20,
    greetingAffinityGain: 1.2,
    chatAffinityGain: 2.4,
    giftBaseGain: 6,
    helpBaseGain: 8,
    confessThreshold: 65,
  },
  probability: {
    historyLimit: 5000,
    defaultMinWeight: 0.0001,
    defaultMaxWeight: 1000,
  },
  life: {
    startingInfluence: 0,
    influencePerCommunityPoint: 0.2,
    archiveImportanceThreshold: 3,
    maxLegacyItems: 3,
  },
} as const;

/** Weather runtime profiles used by weather and cigarette-physics systems. */
export interface WeatherProfile {
  id: WeatherType;
  label: string;
  rainIntensity: number;
  windSpeedBase: number;
  humidityBase: number;
  temperatureDelta: number;
  visibility: number;
  /** Multiplier applied to cigarette burn rate in the open. */
  burnMultiplier: number;
}

export const WEATHER_PROFILES: Readonly<Record<WeatherType, WeatherProfile>> = {
  clear: {
    id: 'clear',
    label: 'Clear',
    rainIntensity: 0,
    windSpeedBase: 0.12,
    humidityBase: 0.42,
    temperatureDelta: 2,
    visibility: 1,
    burnMultiplier: 0.95,
  },
  cloudy: {
    id: 'cloudy',
    label: 'Cloudy',
    rainIntensity: 0,
    windSpeedBase: 0.24,
    humidityBase: 0.55,
    temperatureDelta: 0,
    visibility: 0.92,
    burnMultiplier: 1,
  },
  rain: {
    id: 'rain',
    label: 'Rain',
    rainIntensity: 0.55,
    windSpeedBase: 0.35,
    humidityBase: 0.82,
    temperatureDelta: -3,
    visibility: 0.8,
    burnMultiplier: 0.72,
  },
  storm: {
    id: 'storm',
    label: 'Storm',
    rainIntensity: 1,
    windSpeedBase: 0.85,
    humidityBase: 0.94,
    temperatureDelta: -5,
    visibility: 0.55,
    burnMultiplier: 0.55,
  },
  fog: {
    id: 'fog',
    label: 'Fog',
    rainIntensity: 0.06,
    windSpeedBase: 0.08,
    humidityBase: 0.9,
    temperatureDelta: -2,
    visibility: 0.35,
    burnMultiplier: 0.9,
  },
  snow: {
    id: 'snow',
    label: 'Snow',
    rainIntensity: 0.2,
    windSpeedBase: 0.3,
    humidityBase: 0.75,
    temperatureDelta: -8,
    visibility: 0.7,
    burnMultiplier: 0.65,
  },
  wind: {
    id: 'wind',
    label: 'Windy',
    rainIntensity: 0,
    windSpeedBase: 0.75,
    humidityBase: 0.4,
    temperatureDelta: -1,
    visibility: 0.9,
    burnMultiplier: 1.55,
  },
};

export const SEASON_TEMPERATURE_BASE: Readonly<Record<Season, number>> = {
  spring: 12,
  summer: 21,
  autumn: 12,
  winter: 4,
};

export const SEASON_DAYLIGHT_HOURS: Readonly<Record<Season, number>> = {
  spring: 13,
  summer: 16,
  autumn: 11,
  winter: 8,
};

export const SKILL_ACTIVITY_XP: Readonly<Record<SkillId, number>> = {
  gardening: 6,
  fishing: 7,
  foraging: 5,
  exploration: 8,
  crafting: 6,
  cooking: 5,
  social: 4,
  art: 7,
};

export type WorldConfig = typeof WORLD_CONFIG;