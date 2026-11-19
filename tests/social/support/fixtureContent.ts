import type { ContentPack, FestivalDef, ItemDef, LocationDef, NPCDef, ScheduleSeedEntry } from '../../../src/data/schema';
import type { WeatherTransitionTable, WeatherTransitionWeights } from '../../../src/data/schema';
import type { NPCPersonalityValues, Season, WeatherType } from '../../../src/core/SharedTypes';
import {
  SEASONS,
  WEATHER_TYPES,
  type LocationId,
  type RegionId,
} from '../../../src/core/SharedTypes';
import { ALL_EXTERIOR_LOCATION_IDS, HOME_INTERIOR_ID, LOC, regionOfLocation } from '../../../src/data/locations/ids';
import { ALL_ITEM_IDS, ITEM } from '../../../src/data/items/ids';
import { NPC, RESIDENT_NPC_IDS } from '../../../src/data/npcs/ids';
import { DIALOGUE_TREES } from '../../../src/data/dialogue/dialogue';
import { COMMUNITY_PROPOSALS } from '../../../src/data/community/community';

/**
 * Self-contained content pack for the social test-suite. It deliberately does
 * not import other agents' item/NPC data (those modules are built in parallel),
 * but it does exercise the REAL dialogue trees and community proposals that
 * ship with the game.
 */

const MAJOR_NAMES: Record<string, string> = {
  [NPC.marigoldLyle]: 'Marigold Lyle',
  [NPC.ottoBramwell]: 'Otto Bramwell',
  [NPC.sylviaReed]: 'Sylvia Reed',
  [NPC.haroldBagg]: 'Harold Bagg',
  [NPC.elizaThorne]: 'Eliza Thorne',
  [NPC.theoGrey]: 'Theo Grey',
  [NPC.claraBright]: 'Clara Bright',
  [NPC.finnHolloway]: 'Finn Holloway',
  [NPC.adaQuinn]: 'Ada Quinn',
  [NPC.rufusMarsh]: 'Rufus Marsh',
  [NPC.penelopeVance]: 'Penelope Vance',
  [NPC.jasperKim]: 'Jasper Kim',
  [NPC.edmundHale]: 'Edmund Hale',
  [NPC.ninaOkoye]: 'Nina Okoye',
};

const MAJOR_OCCUPATIONS: Record<string, string> = {
  [NPC.marigoldLyle]: 'florist',
  [NPC.ottoBramwell]: 'baker',
  [NPC.sylviaReed]: 'cafe owner',
  [NPC.haroldBagg]: 'postman',
  [NPC.elizaThorne]: 'retired librarian',
  [NPC.theoGrey]: 'bookshop owner',
  [NPC.claraBright]: 'botanist',
  [NPC.finnHolloway]: 'fisherman',
  [NPC.adaQuinn]: 'farmer',
  [NPC.rufusMarsh]: 'warehouse keeper',
  [NPC.penelopeVance]: 'museum curator',
  [NPC.jasperKim]: 'barista and musician',
  [NPC.edmundHale]: 'community chair',
  [NPC.ninaOkoye]: 'office worker',
};

const MAJOR_LIKES: Record<string, string[]> = {
  [NPC.marigoldLyle]: ['flowers', 'gardening', 'tea'],
  [NPC.ottoBramwell]: ['food', 'baking', 'sweet', 'practical'],
  [NPC.sylviaReed]: ['gossip', 'tea', 'sweet', 'company'],
  [NPC.haroldBagg]: ['letters', 'history', 'tea', 'practical'],
  [NPC.elizaThorne]: ['books', 'history', 'letters'],
  [NPC.theoGrey]: ['books', 'romance', 'quiet'],
  [NPC.claraBright]: ['flowers', 'plants', 'science'],
  [NPC.finnHolloway]: ['fish', 'water', 'quiet'],
  [NPC.adaQuinn]: ['food', 'practical', 'growing'],
  [NPC.rufusMarsh]: ['order', 'metal', 'practical'],
  [NPC.penelopeVance]: ['history', 'old things', 'art'],
  [NPC.jasperKim]: ['music', 'coffee', 'art'],
  [NPC.edmundHale]: ['town matters', 'history', 'tea'],
  [NPC.ninaOkoye]: ['coffee', 'city life', 'ambition'],
};

const MAJOR_DISLIKES: Record<string, string[]> = {
  [NPC.marigoldLyle]: ['junk', 'metal'],
  [NPC.ottoBramwell]: ['junk'],
  [NPC.sylviaReed]: ['boring'],
  [NPC.haroldBagg]: ['junk', 'loud'],
  [NPC.elizaThorne]: ['junk'],
  [NPC.theoGrey]: ['loud', 'junk'],
  [NPC.claraBright]: ['junk', 'metal'],
  [NPC.finnHolloway]: ['junk', 'loud'],
  [NPC.adaQuinn]: ['junk'],
  [NPC.rufusMarsh]: ['mess', 'flowers'],
  [NPC.penelopeVance]: ['junk'],
  [NPC.jasperKim]: ['quiet', 'junk'],
  [NPC.edmundHale]: ['junk', 'mess'],
  [NPC.ninaOkoye]: ['junk', 'mess'],
};

const ROMANCEABLE: ReadonlySet<string> = new Set([
  NPC.marigoldLyle,
  NPC.sylviaReed,
  NPC.theoGrey,
  NPC.claraBright,
  NPC.finnHolloway,
  NPC.jasperKim,
  NPC.ninaOkoye,
]);

/** Personality presets varied enough to make behavioural tests meaningful. */
function personality(overrides: Partial<NPCPersonalityValues> = {}): NPCPersonalityValues {
  return {
    extroversion: 0.5,
    introversion: 0.5,
    adventure: 0.5,
    caution: 0.5,
    generosity: 0.5,
    curiosity: 0.5,
    socialNeed: 0.5,
    independence: 0.5,
    responsibility: 0.5,
    spendingTendency: 0.5,
    artisticTendency: 0.5,
    workTendency: 0.5,
    ...overrides,
  };
}

const MAJOR_PERSONALITIES: Record<string, Partial<NPCPersonalityValues>> = {
  [NPC.marigoldLyle]: { extroversion: 0.7, generosity: 0.8, socialNeed: 0.6, artisticTendency: 0.8, introversion: 0.3 },
  [NPC.ottoBramwell]: { extroversion: 0.85, generosity: 0.7, socialNeed: 0.75, workTendency: 0.9, introversion: 0.2 },
  [NPC.sylviaReed]: { extroversion: 0.95, generosity: 0.6, socialNeed: 0.9, curiosity: 0.8, introversion: 0.1 },
  [NPC.haroldBagg]: { extroversion: 0.3, introversion: 0.8, responsibility: 0.9, socialNeed: 0.4 },
  [NPC.elizaThorne]: { introversion: 0.7, curiosity: 0.9, responsibility: 0.6, socialNeed: 0.35 },
  [NPC.theoGrey]: { introversion: 0.9, socialNeed: 0.45, artisticTendency: 0.7, curiosity: 0.8 },
  [NPC.claraBright]: { introversion: 0.7, curiosity: 0.95, generosity: 0.6, artisticTendency: 0.5 },
  [NPC.finnHolloway]: { introversion: 0.85, adventure: 0.4, responsibility: 0.7, socialNeed: 0.3 },
  [NPC.adaQuinn]: { extroversion: 0.55, workTendency: 0.95, responsibility: 0.9, generosity: 0.6 },
  [NPC.rufusMarsh]: { introversion: 0.8, caution: 0.8, responsibility: 0.85, generosity: 0.35 },
  [NPC.penelopeVance]: { introversion: 0.75, curiosity: 0.85, responsibility: 0.8, artisticTendency: 0.6 },
  [NPC.jasperKim]: { extroversion: 0.9, artisticTendency: 0.95, socialNeed: 0.8, generosity: 0.55 },
  [NPC.edmundHale]: { extroversion: 0.6, responsibility: 0.95, caution: 0.7, socialNeed: 0.5 },
  [NPC.ninaOkoye]: { extroversion: 0.55, introversion: 0.45, curiosity: 0.8, workTendency: 0.9, independence: 0.85 },
};

const MAJOR_HOMES: Record<string, LocationId> = {
  [NPC.marigoldLyle]: LOC.flowerShop,
  [NPC.ottoBramwell]: LOC.bakery,
  [NPC.sylviaReed]: LOC.cafe,
  [NPC.haroldBagg]: LOC.countryside,
  [NPC.elizaThorne]: LOC.library,
  [NPC.theoGrey]: LOC.bookshop,
  [NPC.claraBright]: LOC.greenhouse,
  [NPC.finnHolloway]: LOC.river,
  [NPC.adaQuinn]: LOC.farm,
  [NPC.rufusMarsh]: LOC.warehouse,
  [NPC.penelopeVance]: LOC.museum,
  [NPC.jasperKim]: LOC.cityCafe,
  [NPC.edmundHale]: LOC.center,
  [NPC.ninaOkoye]: LOC.apartments,
};

const MAJOR_WORK: Record<string, LocationId> = {
  [NPC.marigoldLyle]: LOC.flowerShop,
  [NPC.ottoBramwell]: LOC.bakery,
  [NPC.sylviaReed]: LOC.cafe,
  [NPC.haroldBagg]: LOC.postOffice,
  [NPC.elizaThorne]: LOC.library,
  [NPC.theoGrey]: LOC.bookshop,
  [NPC.claraBright]: LOC.greenhouse,
  [NPC.finnHolloway]: LOC.river,
  [NPC.adaQuinn]: LOC.farm,
  [NPC.rufusMarsh]: LOC.warehouse,
  [NPC.penelopeVance]: LOC.museum,
  [NPC.jasperKim]: LOC.cafe,
  [NPC.edmundHale]: LOC.center,
  [NPC.ninaOkoye]: LOC.officeDistrict,
};

function makeMajorNpc(npcId: string): NPCDef {
  const name = MAJOR_NAMES[npcId] ?? npcId;
  return {
    id: npcId,
    name,
    age: 30,
    lifeStage: 'adult',
    personality: personality(MAJOR_PERSONALITIES[npcId]),
    appearance: {
      primaryColor: '#cc8844',
      secondaryColor: '#553322',
      hairColor: '#332211',
      skinTone: '#e0b090',
      outfitStyle: 'casual',
      accessory: 'none',
      scale: 1,
    },
    occupation: MAJOR_OCCUPATIONS[npcId] ?? 'resident',
    homeLocationId: MAJOR_HOMES[npcId] ?? LOC.home,
    workLocationId: MAJOR_WORK[npcId] ?? LOC.center,
    startingMoney: 25000,
    interests: MAJOR_LIKES[npcId] ?? [],
    goals: [MAJOR_OCCUPATIONS[npcId] ?? 'resident', 'a quiet life'],
    bio: name + ' lives in Willowbrook.',
    dialogueTreeId: 'dialogue_' + npcId,
    scheduleTemplate: [] as ScheduleSeedEntry[],
    initialRelationships: [],
    major: true,
    romanceable: ROMANCEABLE.has(npcId),
    likes: MAJOR_LIKES[npcId] ?? [],
    dislikes: MAJOR_DISLIKES[npcId] ?? [],
  };
}

function makeResidentNpc(npcId: string, index: number): NPCDef {
  return {
    id: npcId,
    name: 'Resident ' + String(index + 1),
    age: 40 + (index % 20),
    lifeStage: 'adult',
    personality: personality({ extroversion: 0.3 + (index % 5) * 0.12, socialNeed: 0.4 + (index % 3) * 0.15 }),
    appearance: {
      primaryColor: '#8899aa',
      secondaryColor: '#334455',
      hairColor: '#221a14',
      skinTone: '#d8b090',
      outfitStyle: 'casual',
      accessory: 'none',
      scale: 1,
    },
    occupation: ['shop assistant', 'teacher', 'nurse', 'mechanic', 'student', 'retiree'][index % 6] ?? 'resident',
    homeLocationId: LOC.cityResidential,
    workLocationId: LOC.highStreet,
    startingMoney: 12000,
    interests: ['village life'],
    goals: ['a quiet life'],
    bio: 'An ordinary resident of the village.',
    dialogueTreeId: 'dialogue_resident',
    scheduleTemplate: [],
    initialRelationships: [],
    major: false,
    romanceable: false,
    likes: ['tea'],
    dislikes: ['junk'],
  };
}

/** Gift-tag overrides so taste tests have real, documented tags to assert on. */
const ITEM_OVERRIDES: Record<string, Partial<ItemDef>> = {
  [ITEM.rose]: { category: 'produce', basePrice: 220, tags: ['flower'], giftTasteTags: ['flowers', 'romance'], hasQuality: true },
  [ITEM.bouquet]: { category: 'gift', basePrice: 900, tags: ['flower', 'gift'], giftTasteTags: ['flowers', 'romance'], hasQuality: false },
  [ITEM.pressedFlower]: { category: 'gift', basePrice: 300, tags: ['flower', 'keepsake'], giftTasteTags: ['flowers', 'memory'], hasQuality: false },
  [ITEM.honeyJar]: { category: 'food', basePrice: 420, tags: ['sweet', 'food'], giftTasteTags: ['sweet', 'food'], edible: true, nutrition: 10, hasQuality: true },
  [ITEM.breadLoaf]: { category: 'food', basePrice: 180, tags: ['food', 'baking'], giftTasteTags: ['food', 'baking'], edible: true, nutrition: 20, hasQuality: true },
  [ITEM.teaLeaves]: { category: 'material', basePrice: 260, tags: ['tea'], giftTasteTags: ['tea'], hasQuality: true },
  [ITEM.fishTrout]: { category: 'fish', basePrice: 420, tags: ['fish'], giftTasteTags: ['fish', 'food'], hasQuality: true },
  [ITEM.oldLetter]: { category: 'collectible', basePrice: 350, tags: ['letters', 'history'], giftTasteTags: ['letters', 'history'], hasQuality: false },
  [ITEM.localHistoryBook]: { category: 'book', basePrice: 300, tags: ['books', 'history'], giftTasteTags: ['books', 'history'], hasQuality: false },
  [ITEM.romanceNovel]: { category: 'book', basePrice: 320, tags: ['books', 'romance'], giftTasteTags: ['books', 'romance'], hasQuality: false },
  [ITEM.musicBox]: { category: 'gift', basePrice: 800, tags: ['music', 'keepsake'], giftTasteTags: ['music'], hasQuality: false },
  [ITEM.fossil]: { category: 'collectible', basePrice: 950, tags: ['history', 'old things'], giftTasteTags: ['history', 'old things'], hasQuality: false },
  [ITEM.scrapMetal]: { category: 'material', basePrice: 40, tags: ['metal', 'junk'], giftTasteTags: ['metal', 'junk'], hasQuality: false },
  [ITEM.oldCoin]: { category: 'collectible', basePrice: 700, tags: ['old things'], giftTasteTags: ['old things', 'history'], hasQuality: false },
  [ITEM.coffeeCup]: { category: 'drink', basePrice: 230, tags: ['coffee'], giftTasteTags: ['coffee'], edible: true, hasQuality: true },
  [ITEM.wildHerb]: { category: 'material', basePrice: 60, tags: ['plants'], giftTasteTags: ['plants', 'gardening'], hasQuality: true },
  [ITEM.lavender]: { category: 'produce', basePrice: 90, tags: ['flower', 'herb'], giftTasteTags: ['flowers', 'gardening'], hasQuality: true },
};

function makeItem(itemId: string): ItemDef {
  const override = ITEM_OVERRIDES[itemId];
  const base: ItemDef = {
    id: itemId,
    name: itemId.replace(/_/g, ' '),
    description: 'Test item: ' + itemId,
    category: 'misc',
    basePrice: 100,
    stackable: true,
    maxStack: 99,
    hasQuality: false,
    tags: [],
    visual: { shape: 'circle', color: '#dddddd' },
  };
  return override ? { ...base, ...override, id: itemId } : base;
}

function makeLocation(locationId: LocationId): LocationDef {
  const indoor = locationId === HOME_INTERIOR_ID;
  const regionId: RegionId = regionOfLocation(locationId);
  const def: LocationDef = {
    id: locationId,
    name: locationId.replace(/_/g, ' ').replace('willowbrook ', 'Willowbrook '),
    regionId,
    kind: indoor ? 'interior' : 'town_center',
    description: 'A place in Willowbrook or Ashford.',
    indoor,
    mapX: 0,
    mapY: 0,
    widthTiles: 20,
    heightTiles: 15,
    connections: [],
    shelter: indoor ? 1 : 0.3,
    windExposure: indoor ? 0 : 0.5,
    humidityModifier: 0,
    heatSource: indoor,
    openHour: 0,
    closeHour: 24,
    facilities: [],
    eventTags: [],
    forageTags: [],
    discoverable: true,
    secret: false,
    theme: indoor ? 'indoor' : regionId === 'ashford' ? 'city' : 'town',
    visual: { shape: 'rect', color: '#aabbcc' },
    floorColor: '#c8bda8',
    accentColor: '#887766',
  };
  if (indoor) def.entranceFrom = LOC.home;
  return def;
}

/** A single spring festival so festival invitations and event-system hooks are testable. */
const FIXTURE_FESTIVALS: FestivalDef[] = [
  {
    id: 'festival_spring_flower',
    name: 'Spring Flower Festival',
    description: 'Willowbrook celebrates the first blooms of the year.',
    season: 'spring',
    dayOfSeason: 14,
    startHour: 10,
    durationHours: 6,
    locationId: LOC.plaza,
    activities: [
      { id: 'flower_show', label: 'Flower Show', description: 'Residents show their best blooms.', skill: 'gardening' },
    ],
    importance: 4,
    npcInterestTags: ['flowers', 'community'],
    visual: { shape: 'flower', color: '#ff88aa' },
  },
];

function makeWeatherTable(): WeatherTransitionTable {
  const bySeason = {} as Record<Season, Partial<Record<WeatherType, WeatherTransitionWeights>>>;
  for (const season of SEASONS) {
    const row: Partial<Record<WeatherType, WeatherTransitionWeights>> = {};
    for (const from of WEATHER_TYPES) {
      const weights: WeatherTransitionWeights = {};
      for (const to of WEATHER_TYPES) {
        if (to === from) continue;
        weights[to] = 1;
      }
      row[from] = weights;
    }
    bySeason[season] = row;
  }
  return { bySeason };
}

/** Builds the social test content pack. */
export function buildFixtureContentPack(): ContentPack {
  const locations: LocationDef[] = ALL_EXTERIOR_LOCATION_IDS.map(makeLocation);
  locations.push(makeLocation(HOME_INTERIOR_ID));
  const npcs: NPCDef[] = Object.values(NPC).map(makeMajorNpc);
  RESIDENT_NPC_IDS.slice(0, 6).forEach((npcId, index) => npcs.push(makeResidentNpc(npcId, index)));
  return {
    items: ALL_ITEM_IDS.map(makeItem),
    crops: [],
    fish: [],
    forageNodes: [],
    recipes: [],
    events: [],
    festivals: FIXTURE_FESTIVALS,
    locations,
    trainRoutes: [],
    businesses: [],
    npcs,
    dialogueTrees: DIALOGUE_TREES,
    furniture: [],
    blueprints: [],
    achievements: [],
    playerGoals: [],
    communityProposals: COMMUNITY_PROPOSALS,
    collectionCategories: [],
    weatherTable: makeWeatherTable(),
  };
}

/** Convenient exported constants for tests. */
export const FIXTURE_MAJOR_NPC_IDS = Object.values(NPC);
export const FIXTURE_RESIDENT_NPC_IDS = RESIDENT_NPC_IDS.slice(0, 6);
export const FIXTURE_AREA_LOCATION = LOC.park;
