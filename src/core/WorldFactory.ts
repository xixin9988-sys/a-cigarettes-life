import type {
  BusinessState,
  ClockState,
  EventSystemState,
  GameSettings,
  GameState,
  HomeState,
  IContentRegistry,
  JobState,
  LocationState,
  MarketGoodState,
  NPCState,
  PlayerState,
  RegionState,
  WorldHistoryEntry,
  WorldState,
} from './contracts';
import type { BusinessDef, ItemDef, LocationDef, NPCDef } from '../data/schema';
import {
  SEASONS,
  SKILL_IDS,
  type InventoryEntry,
  type LocationId,
  type QualityStars,
  type RegionId,
  type SkillId,
} from './SharedTypes';
import type { CigaretteAppearance } from './contracts';
import { WORLD_CONFIG } from './WorldConfig';
import { gameTimeToSimSeconds, simSecondsToGameTime } from './TimeUtil';
import { addItemToInventory } from './InventoryUtil';
import { createRelationship, refreshRelationshipStatus } from './RelationshipUtil';
import { hashString } from './utils';
import { HOME_INTERIOR_ID, LOC, interiorIdFor } from '../data/locations/ids';
import { ITEM } from '../data/items/ids';
import { SEASONS as SEASON_LIST } from './SharedTypes';

export const DEFAULT_PLAYER_ID = 'player';

export interface CreateGameStateOptions {
  seed: number;
  playerName: string;
  appearance: CigaretteAppearance;
  content: IContentRegistry;
  startingSeasonIndex?: number;
}

export const DEFAULT_APPEARANCE: CigaretteAppearance = {
  bodyColor: '#f7f3e8',
  filterColor: '#b07a4a',
  accessory: null,
  face: 'smile',
  pattern: 'plain',
};

export function createDefaultSettings(): GameSettings {
  return {
    speed: 1,
    autosaveIntervalSeconds: WORLD_CONFIG.worldTime.autosaveIntervalSeconds,
    masterVolume: 0.8,
    musicVolume: 0.55,
    sfxVolume: 0.7,
    textSpeed: 1,
    showProbabilityDebug: false,
    showTutorialTips: true,
    keybindings: {
      moveUp: 'W',
      moveDown: 'S',
      moveLeft: 'A',
      moveRight: 'D',
      interact: 'E',
      use: 'SPACE',
      menu: 'ESC',
      inventory: 'I',
      map: 'M',
      journal: 'J',
      social: 'K',
      skills: 'L',
      build: 'B',
      debugProbability: 'F12',
    },
    reducedMotion: false,
  };
}

function seededRange(seed: number, key: string, min: number, max: number): number {
  const value = hashString(seed + ':' + key) % 10000;
  return min + (value / 10000) * (max - min);
}

function seededInt(seed: number, key: string, min: number, max: number): number {
  return Math.floor(seededRange(seed, key, min, max + 1));
}

function createClockState(seed: number): ClockState {
  const startSim = gameTimeToSimSeconds({
    year: 1,
    seasonIndex: 0,
    dayOfSeason: 1,
    hour: WORLD_CONFIG.worldTime.startHour,
    minute: WORLD_CONFIG.worldTime.startMinute,
  });
  return {
    simTimeSeconds: startSim,
    lastRealTimestampMs: Date.now(),
    speed: 1,
    paused: false,
    totalRealPlaySeconds: 0,
  };
}

function createLocationState(def: LocationDef, seed: number): LocationState {
  return {
    id: def.id,
    name: def.name,
    regionId: def.regionId,
    discovered: !def.secret,
    unlocked: !def.secret,
    visitCount: 0,
    lastVisitSimTime: 0,
    occupants: [],
    microclimate: {
      indoor: def.indoor,
      shelter: def.shelter,
      windExposure: def.windExposure,
      humidityModifier: def.humidityModifier,
      heatSource: def.heatSource,
    },
    condition: 1,
    lastEventAt: 0,
    searchCount: 0,
    secretsFound: [],
  };
}

function createNPCState(def: NPCDef, seed: number): NPCState {
  const needs = {
    hunger: seededInt(seed, def.id + ':hunger', 10, 60),
    energy: seededInt(seed, def.id + ':energy', 15, 70),
    social: seededInt(seed, def.id + ':social', 10, 60),
    fun: seededInt(seed, def.id + ':fun', 10, 60),
    safety: seededInt(seed, def.id + ':safety', 5, 35),
    belonging: seededInt(seed, def.id + ':belonging', 5, 40),
    moneyPressure: seededInt(seed, def.id + ':money', 0, 40),
    workPressure: seededInt(seed, def.id + ':work', 0, 35),
    purpose: seededInt(seed, def.id + ':purpose', 0, 40),
  };
  const emotions = {
    joy: 0.45 + seededRange(seed, def.id + ':joy', 0, 0.3),
    sadness: seededRange(seed, def.id + ':sadness', 0, 0.15),
    anger: seededRange(seed, def.id + ':anger', 0, 0.1),
    fear: seededRange(seed, def.id + ':fear', 0, 0.1),
    affection: seededRange(seed, def.id + ':affection', 0.1, 0.4),
    stress: seededRange(seed, def.id + ':stress', 0, 0.25),
  };
  return {
    id: def.id,
    name: def.name,
    age: def.age,
    lifeStage: def.lifeStage,
    personality: { ...def.personality },
    appearance: { ...def.appearance },
    needs,
    emotions,
    mood: emotions.joy - emotions.sadness - emotions.stress * 0.5,
    money: def.startingMoney || seededInt(seed, def.id + ':money', 8000, 95000),
    occupation: def.occupation,
    jobId: null,
    homeLocationId: def.homeLocationId,
    workLocationId: def.workLocationId,
    locationId: def.homeLocationId,
    currentActivity: 'resting',
    activityStartedAt: 0,
    activityEndsAt: 0,
    activityTargetNpcId: null,
    activityTargetLocationId: null,
    activityHistory: [],
    decisionCooldownUntil: 0,
    relationships: {},
    memories: [],
    goals: def.goals.map((goal, index) => ({
      id: def.id + ':goal:' + index,
      type: 'life_goal',
      label: goal,
      progress: 0,
      target: 1,
      createdAt: 0,
      completedAt: null,
    })),
    schedule: {
      entries: def.scheduleTemplate.map((entry) => {
        const mapped: NPCState['schedule']['entries'][number] = {
          startHour: entry.startHour,
          endHour: entry.endHour,
          activity: entry.activity,
          adherence: entry.adherence,
        };
        if (entry.locationId) mapped.locationId = entry.locationId;
        if (entry.days) mapped.days = [...entry.days];
        return mapped;
      }),
      lastPlannedDay: -1,
    },
    interests: [...def.interests],
    lifeHistory: [
      {
        at: 0,
        type: 'birth',
        description: def.name + ' was born in ' + def.homeLocationId + '.',
        importance: 5,
      },
    ],
    generation: 1,
    alive: true,
    isMajor: def.major,
    lastUpdatedAt: 0,
  };
}

function createBusinessState(def: BusinessDef, content: IContentRegistry, seed: number): BusinessState {
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    locationId: def.locationId,
    ownerNpcId: def.ownerNpcId,
    money: def.initialMoney,
    reputation: def.reputation,
    priceMarkup: def.priceMarkup,
    openHour: def.openHour,
    closeHour: def.closeHour,
    isOpen: false,
    isPlayerOwned: false,
    stock: def.stock.map((stock) => {
      const item = content.getItem(stock.itemId);
      const base = item?.basePrice ?? 100;
      return {
        itemId: stock.itemId,
        quantity: stock.quantity,
        price: Math.max(1, Math.round(base * stock.priceMultiplier * def.priceMarkup)),
        targetStock: stock.restockTarget,
        demandIndex: 1,
      };
    }),
    employees: [],
    dailyRevenue: 0,
    dailyExpenses: 0,
    dailyCustomers: 0,
    totalRevenue: 0,
    history: [],
    lastSettledAt: 0,
  };
}

function createMarketGood(item: ItemDef, seed: number): MarketGoodState {
  const seasonalFactor =
    item.category === 'produce' || item.category === 'fish'
      ? 0.9 + seededRange(seed, item.id + ':season', 0, 0.2)
      : 1;
  return {
    itemId: item.id,
    basePrice: item.basePrice,
    currentPrice: Math.max(1, Math.round(item.basePrice * seasonalFactor)),
    targetStock: seededInt(seed, item.id + ':target', 8, 40),
    supply: seededInt(seed, item.id + ':supply', 10, 40),
    demand: seededInt(seed, item.id + ':demand', 10, 40),
    seasonalFactor,
    trend: 0,
    lastUpdatedAt: 0,
  };
}

function createHomeState(content: IContentRegistry): HomeState {
  const rooms = [
    {
      id: 'main_room',
      name: 'Main Room',
      widthTiles: 12,
      heightTiles: 10,
      unlocked: true,
      wallColor: '#e8d8b8',
      floorStyle: 'wood',
    },
  ];
  return {
    id: 'home_player',
    regionId: 'willowbrook',
    locationId: content.getLocation(HOME_INTERIOR_ID) ? HOME_INTERIOR_ID : LOC.home,
    name: 'My Little Home',
    ownerId: DEFAULT_PLAYER_ID,
    rooms,
    furniture: [],
    storage: [],
    comfort: 0.2,
    decorationScore: 0,
    wallColor: '#e8d8b8',
    floorStyle: 'wood',
    upgrades: [],
    gardens: [],
  };
}

function createPlayerState(
  options: CreateGameStateOptions,
  content: IContentRegistry,
  simTime: number
): PlayerState {
  const skills = {} as Record<SkillId, PlayerState['skills'][SkillId]>;
  for (const skill of SKILL_IDS) {
    skills[skill] = { level: 1, xp: 0, xpToNext: WORLD_CONFIG.skill.baseXpToLevel, totalXp: 0, uses: 0 };
  }
  const inventory: InventoryEntry[] = [];
  const starterItems: { itemId: string; quantity: number; quality: QualityStars }[] = [
    { itemId: ITEM.matches, quantity: 1, quality: 1 },
    { itemId: ITEM.wateringCan, quantity: 1, quality: 2 },
    { itemId: ITEM.hoe, quantity: 1, quality: 2 },
    { itemId: ITEM.turnipSeed, quantity: 3, quality: 1 },
    { itemId: ITEM.breadLoaf, quantity: 2, quality: 2 },
    { itemId: ITEM.camera, quantity: 1, quality: 2 },
  ];
  for (const starter of starterItems) {
    addItemToInventory(inventory, starter.itemId, starter.quantity, {
      quality: starter.quality,
      simTime,
      maxStack: 99,
    });
  }
  const equipment = {
    umbrella: null,
    windbreak: null,
    case: null,
    outerwear: null,
    accessory: null,
    hat: null,
    tool: null,
  };
  const homeInterior = content.getLocation(HOME_INTERIOR_ID) ? HOME_INTERIOR_ID : LOC.home;
  return {
    id: DEFAULT_PLAYER_ID,
    lifeId: 'life_1',
    name: options.playerName || 'Ash',
    appearance: { ...options.appearance },
    cigarette: {
      lengthRatio: 1,
      moisture: 0.08,
      burnRate: 1,
      isSheltered: false,
      ashAccumulated: 0,
      totalBurned: 0,
    },
    position: { regionId: 'willowbrook', locationId: homeInterior, x: 6 * 32, y: 6 * 32, indoor: true },
    money: WORLD_CONFIG.economyStarting.playerMoneyPence,
    inventory,
    equipment,
    skills,
    relationships: {},
    residenceId: LOC.home,
    occupation: null,
    jobId: null,
    influence: 0,
    communityPoints: 0,
    lifeProgress: 0,
    knownRecipes: [],
    statusEffects: [],
    statistics: {
      steps: 0,
      daysLived: 0,
      cropsHarvested: 0,
      fishCaught: 0,
      fishSpeciesCaught: {},
      fishBiggest: {},
      itemsForaged: 0,
      itemsCrafted: 0,
      mealsCooked: 0,
      itemsBought: 0,
      itemsSold: 0,
      moneyEarned: 0,
      moneySpent: 0,
      npcsMet: 0,
      conversations: 0,
      giftsGiven: 0,
      festivalsAttended: 0,
      photosTaken: 0,
      ashCollected: 0,
      furniturePlaced: 0,
      secretsFound: 0,
      businessesOwned: 0,
      shiftsWorked: 0,
    },
    lastActionAt: simTime,
  };
}

function createEventSystemState(seed: number): EventSystemState {
  return {
    cooldowns: {},
    occurrences: {},
    activeEventIds: [],
    uniqueTriggered: [],
    festivals: {},
    lastGlobalEventAt: 0,
    categoryWeights: { ordinary: 0.45, interesting: 0.25, lucky: 0.15, unlucky: 0.1, special: 0.05 },
    pendingNotifications: [],
  };
}

/** Builds a complete fresh GameState from the content pack. */
export function createInitialGameState(options: CreateGameStateOptions): GameState {
  const content = options.content;
  const pack = content.pack;
  const seed = options.seed >>> 0;
  const clock = createClockState(seed);
  const startTime = simSecondsToGameTime(clock.simTimeSeconds);

  const locations: Record<LocationId, LocationState> = {};
  for (const def of pack.locations) {
    locations[def.id] = createLocationState(def, seed);
  }

  const regions: Record<RegionId, RegionState> = {
    willowbrook: {
      id: 'willowbrook',
      name: 'Willowbrook',
      unlocked: true,
      locationIds: pack.locations.filter((location) => location.regionId === 'willowbrook').map((location) => location.id),
      discovered: true,
    },
    ashford: {
      id: 'ashford',
      name: 'Ashford City',
      unlocked: true,
      locationIds: pack.locations.filter((location) => location.regionId === 'ashford').map((location) => location.id),
      discovered: true,
    },
  };

  const npcs: Record<string, NPCState> = {};
  for (const def of pack.npcs) {
    npcs[def.id] = createNPCState(def, seed);
  }
  for (const def of pack.npcs) {
    const npc = npcs[def.id];
    if (!npc) continue;
    for (const initial of def.initialRelationships) {
      const other = npcs[initial.npcId];
      if (!other) continue;
      const forward = createRelationship(initial.npcId, 0, initial.status ?? 'acquaintance');
      forward.affinity = initial.affinity;
      forward.trust = initial.trust;
      forward.intimacy = initial.intimacy;
      forward.familiarity = Math.max(10, Math.abs(initial.affinity) + initial.trust * 0.5);
      refreshRelationshipStatus(forward);
      npc.relationships[initial.npcId] = forward;
      const backward = createRelationship(def.id, 0, initial.status ?? 'acquaintance');
      backward.affinity = initial.affinity;
      backward.trust = initial.trust;
      backward.intimacy = initial.intimacy;
      backward.familiarity = forward.familiarity;
      refreshRelationshipStatus(backward);
      other.relationships[def.id] = backward;
    }
  }

  const market: Record<string, MarketGoodState> = {};
  for (const item of pack.items) {
    market[item.id] = createMarketGood(item, seed);
  }

  const businesses: Record<string, BusinessState> = {};
  const jobs: Record<string, JobState> = {};
  for (const def of pack.businesses) {
    businesses[def.id] = createBusinessState(def, content, seed);
    def.jobs.forEach((job, index) => {
      const id = 'job:' + def.id + ':' + index;
      jobs[id] = {
        id,
        businessId: def.id,
        title: job.title,
        wagePerHour: job.wagePerHour,
        startHour: job.startHour,
        endHour: job.endHour,
        slots: job.slots,
        employeeIds: [],
        levelReq: job.levelReq ?? 1,
        playerAvailable: job.playerAvailable,
        isPlayerJob: false,
        lastWorkedAt: 0,
      };
      if (job.skill) jobs[id].skill = job.skill;
    });
  }

  const history: WorldHistoryEntry[] = [
    {
      id: 'history_begin',
      at: clock.simTimeSeconds,
      category: 'world',
      description: 'A new cigarette is lit in Willowbrook. The world carries on as it always has.',
      importance: 4,
      participantIds: [],
      locationId: LOC.home,
    },
  ];

  const world: WorldState = {
    worldId: 'world_1',
    seed,
    regions,
    locations,
    environment: {
      season: startTime.season,
      seasonIndex: startTime.seasonIndex,
      dayOfSeason: startTime.dayOfSeason,
      year: startTime.year,
      weather: 'clear',
      previousWeather: 'clear',
      nextWeatherChangeAt: clock.simTimeSeconds + 4 * 60 * 60,
      windSpeed: 0.18,
      windDirectionDeg: seededRange(seed, 'wind-dir', 0, 360),
      humidity: 0.48,
      temperature: 13 + seededRange(seed, 'temp', -2, 2),
      rainIntensity: 0,
      fogDensity: 0,
      daylight: 0.7,
      recentWeather: [],
    },
    transport: { tickets: [], activeRide: null, lastArrivalAt: 0 },
    events: [],
    history,
    worldFlags: {},
    lastWorldTickAt: clock.simTimeSeconds,
  };

  const eventSystem = createEventSystemState(seed);
  for (const festival of pack.festivals) {
    const seasonIndex = SEASON_LIST.indexOf(festival.season);
    eventSystem.festivals[festival.id] = {
      season: seasonIndex,
      day: festival.dayOfSeason,
      state: 'upcoming',
      participantCount: 0,
    };
  }

  const player = createPlayerState(options, content, clock.simTimeSeconds);
  const home = createHomeState(content);
  const archive = [] as GameState['archive'];

  const state: GameState = {
    version: WORLD_CONFIG.saveVersion,
    meta: {
      saveVersion: WORLD_CONFIG.saveVersion,
      gameVersion: '1.0.0',
      createdAt: Date.now(),
      savedAt: Date.now(),
      lastRealTimestampMs: Date.now(),
      playTimeSeconds: 0,
      lastProcessedSimTime: clock.simTimeSeconds,
      lifeId: player.lifeId,
      worldId: world.worldId,
      seed,
      generation: 1,
    },
    clock,
    world,
    npcs,
    player,
    economy: {
      market,
      businesses,
      jobs,
      playerShop: null,
      economicIndex: 1,
      lastMarketSettlementAt: clock.simTimeSeconds,
      lastDailySettlementDay: 0,
      transactions: [],
    },
    farming: { plots: {}, greenhouses: {}, lastTickAt: clock.simTimeSeconds },
    fishing: { session: null, casts: 0, catches: 0, bySpecies: {}, biggestBySpecies: {}, lastResultMessage: '' },
    foraging: { nodes: {}, gatheredToday: 0, lastResetDay: 0 },
    exploration: { locations: {}, discoveredSecrets: [], clues: [], lastSearchAt: 0 },
    crafting: { jobs: [], mastery: {}, lastCraftAt: 0 },
    cooking: { knownRecipes: [], mastery: {}, lastCookAt: 0, buffs: [] },
    building: { projects: [], unlockedBlueprints: [], completedProjects: [] },
    housing: { homes: { [home.id]: home }, ownedHomeIds: [home.id], lastPlacementAt: 0 },
    collection: { entries: {}, donatedCount: 0, totalSpeciesKnown: pack.items.length },
    social: {
      invitations: [],
      interactionLog: [],
      communityProjects: [],
      activeConversation: null,
      lastInteractionAt: 0,
      npcSocialLog: [],
      lastNpcSocialAt: 0,
    },
    life: {
      lifeId: player.lifeId,
      generation: 1,
      startedAt: clock.simTimeSeconds,
      phase: 'alive',
      endReason: null,
      endedAt: null,
      ageDays: 0,
      archive: [],
      achievements: [],
      letters: [],
      legacyItemIds: [],
      lastAshCollectedAt: 0,
      lastWarnedAt: 0,
      warnings: [],
    },
    eventSystem,
    probability: {
      version: 1,
      seed,
      streams: {},
      decisionCount: 0,
      history: [],
      traceCounter: 0,
    },
    settings: createDefaultSettings(),
    archive,
    pendingOffline: {
      lastSaveRealMs: Date.now(),
      pendingSummary: null,
      lastOfflineSimTime: clock.simTimeSeconds,
      offlineLockToken: null,
    },
    flags: { tutorial_seen: false, first_day: true },
  };

  for (const festival of pack.festivals) {
    void festival;
  }
  void SEASONS;
  void interiorIdFor;

  return state;
}