// =============================================================================
// NPC content - 14 major NPCs + 42 residents of Willowbrook / Ashford.
// OWNER: Agent 3 (NPC Autonomous Life).
//
// All ids come from the canonical constants in src/data/npcs/ids.ts and
// src/data/locations/ids.ts. Schedules are believable daily routines; every
// day window is covered so the NPC module never has to invent behaviour for an
// uncovered hour. Initial relationships are declared exactly once per pair;
// WorldFactory mirrors them bilaterally.
// =============================================================================
import type {
  InitialRelationshipSeed,
  NPCDef,
  NPCAppearanceDef,
  ScheduleSeedEntry,
} from '../schema';
import type { LocationId, NPCId, NPCPersonalityValues } from '../../core/SharedTypes';
import { NPC, RESIDENT_NPC_IDS } from './ids';
import { LOC } from '../locations/ids';

// -----------------------------------------------------------------------------
// Gift-taste vocabulary. ItemDef.giftTasteTags (economy agent) should use these
// tags; the social agent matches NPC likes/dislikes against them.
// -----------------------------------------------------------------------------
export const NPC_GIFT_TAGS = [
  'flower', 'plant', 'seed', 'herb', 'garden', 'nature',
  'bread', 'pastry', 'cake', 'sweet', 'baked_good', 'honey', 'cheese', 'farm_produce', 'vegetable', 'fruit',
  'fish', 'fresh_fish', 'river', 'outdoors',
  'coffee', 'tea', 'cider', 'ale', 'picnic',
  'book', 'poetry', 'history', 'letter', 'stationery', 'music', 'art',
  'antique', 'museum', 'fossil', 'old_coin', 'collectible',
  'handmade', 'candle', 'knitting', 'wood', 'tool', 'practical',
  'romantic', 'perfume', 'jewelry', 'silver', 'crystal',
  'city_life', 'fashion', 'festival', 'community', 'quiet', 'cozy', 'bird', 'toy',
  // Broader taste tags used for social preferences (not all map to physical items).
  'socialising', 'loud', 'comfort', 'adventure', 'learning',
] as const;

/** Canonical NPC interest vocabulary used by the utility AI / biographies. */
export const NPC_INTEREST_TAGS = [
  'flowers', 'gardening', 'plants', 'nature', 'forest', 'water', 'fishing', 'river',
  'baking', 'cooking', 'food', 'coffee', 'tea', 'books', 'poetry', 'history', 'local_history',
  'music', 'art', 'craft', 'making', 'community', 'gossip', 'socialising', 'friends',
  'city_life', 'career', 'travel', 'outdoors', 'walking', 'weather', 'quiet', 'home',
  'comfort', 'romance', 'festivals', 'animals', 'birds', 'practical', 'errands', 'work',
  'bargains', 'fashion', 'shopping', 'ambition', 'adventure', 'celebration', 'heat',
] as const;

// -----------------------------------------------------------------------------
// Small builders
// -----------------------------------------------------------------------------
const DEFAULT_APPEARANCE: NPCAppearanceDef = {
  primaryColor: '#8a7f6a',
  secondaryColor: '#d8cfbb',
  hairColor: '#4a3a2a',
  skinTone: '#d9b08c',
  outfitStyle: 'casual',
  accessory: 'none',
  scale: 1,
};

function appearance(overrides: Partial<NPCAppearanceDef>): NPCAppearanceDef {
  return { ...DEFAULT_APPEARANCE, ...overrides };
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Fills a partial trait map; extroversion/introversion default to complements. */
function traits(values: Partial<NPCPersonalityValues>): NPCPersonalityValues {
  const extroversion = values.extroversion ?? 0.5;
  const introversion = values.introversion ?? clamp01(1 - extroversion);
  return {
    extroversion: clamp01(extroversion),
    introversion: clamp01(introversion),
    adventure: clamp01(values.adventure ?? 0.5),
    caution: clamp01(values.caution ?? 0.5),
    generosity: clamp01(values.generosity ?? 0.5),
    curiosity: clamp01(values.curiosity ?? 0.5),
    socialNeed: clamp01(values.socialNeed ?? 0.5),
    independence: clamp01(values.independence ?? 0.5),
    responsibility: clamp01(values.responsibility ?? 0.5),
    spendingTendency: clamp01(values.spendingTendency ?? 0.5),
    artisticTendency: clamp01(values.artisticTendency ?? 0.5),
    workTendency: clamp01(values.workTendency ?? 0.5),
  };
}

/** Schedule entry helper with correct optional-property handling. */
function s(
  startHour: number,
  endHour: number,
  activity: string,
  locationId: LocationId | null,
  adherence = 0.85,
  days?: number[]
): ScheduleSeedEntry {
  const entry: ScheduleSeedEntry = { startHour, endHour, activity, adherence };
  if (locationId) entry.locationId = locationId;
  if (days && days.length > 0) entry.days = [...days];
  return entry;
}

function rel(
  npcId: NPCId,
  affinity: number,
  trust: number,
  intimacy: number,
  status?: InitialRelationshipSeed['status']
): InitialRelationshipSeed {
  const seed: InitialRelationshipSeed = { npcId, affinity, trust, intimacy };
  if (status) seed.status = status;
  return seed;
}

const ALL_WEEK = [0, 1, 2, 3, 4, 5];
const WEEKDAYS = [0, 1, 2, 3, 4];
const SATURDAY = [5];
const SUNDAY = [6];

function complementDays(days: readonly number[]): number[] {
  const result: number[] = [];
  for (let day = 0; day < 7; day += 1) {
    if (!days.includes(day)) result.push(day);
  }
  return result;
}

// -----------------------------------------------------------------------------
// Routine generators for residents (majors have bespoke schedules).
// Every generator returns contiguous entries covering the whole 24h day.
// -----------------------------------------------------------------------------
interface WorkScheduleOptions {
  home: LocationId;
  work: LocationId;
  workStart: number;
  workEnd: number;
  workDays?: number[];
  wakeHour?: number;
  bedHour?: number;
  lunchLocation?: LocationId;
  leisureLocation?: LocationId;
  restDayLocation?: LocationId;
  adherence?: number;
}

function workSchedule(options: WorkScheduleOptions): ScheduleSeedEntry[] {
  const home = options.home;
  const work = options.work;
  const days = options.workDays ?? ALL_WEEK;
  const restDays = complementDays(days);
  const adherence = options.adherence ?? 0.86;
  const workStart = options.workStart;
  const workEnd = Math.max(options.workEnd, workStart + 3);
  const wake = options.wakeHour ?? Math.max(3.4, Math.min(10, workStart - 1.4));
  const bed = options.bedHour ?? (workEnd > 18.5 ? 23.4 : 22.4);
  const leisure = options.leisureLocation ?? LOC.park;
  const lunchStart = workStart + Math.max(2.5, Math.min(3.75, (workEnd - workStart) * 0.52));
  const lunchEnd = Math.min(workEnd, lunchStart + 0.75);
  const entries: ScheduleSeedEntry[] = [
    s(0, Math.max(1, wake - 0.6), 'sleep', home, adherence),
    s(Math.max(0.5, wake - 0.6), Math.max(1.5, wake - 0.2), 'breakfast', home, adherence * 0.95),
  ];
  if (wake - 0.2 < workStart) {
    entries.push(s(Math.max(0.8, wake - 0.2), workStart, 'commute', work, adherence * 0.9, days));
  }
  entries.push(s(workStart, lunchStart, 'work', work, adherence, days));
  if (lunchEnd > lunchStart) {
    entries.push(s(lunchStart, lunchEnd, 'lunch', options.lunchLocation ?? work, adherence * 0.9));
  }
  if (workEnd > lunchEnd) {
    entries.push(s(lunchEnd, workEnd, 'work', work, adherence, days));
  }
  if (restDays.length > 0) {
    entries.push(
      s(workStart, workEnd, 'leisure', options.restDayLocation ?? leisure, adherence * 0.7, restDays)
    );
  }
  if (workEnd <= 18.2) {
    entries.push(s(workEnd, Math.min(17.5, workEnd + 0.6), 'stroll', leisure, adherence * 0.65));
    entries.push(s(17.9, 18.9, 'dinner', home, adherence * 0.9));
    entries.push(s(19, 21, 'leisure', leisure, adherence * 0.7));
    entries.push(s(21, bed, 'relax', home, adherence * 0.9));
  } else {
    entries.push(s(workEnd, Math.min(bed, workEnd + 0.8), 'dinner', home, adherence * 0.9));
    entries.push(s(Math.min(bed, workEnd + 0.8), bed, 'relax', home, adherence * 0.9));
  }
  entries.push(s(bed, 24, 'sleep', home, adherence));
  return entries.filter((entry) => entry.endHour > entry.startHour);
}

interface SchoolScheduleOptions {
  home: LocationId;
  school: LocationId;
  schoolStart: number;
  schoolEnd: number;
  days?: number[];
  leisureLocation?: LocationId;
  bedHour?: number;
  adherence?: number;
  /** Child routine: earlier night, more play. */
  child?: boolean;
}

function schoolSchedule(options: SchoolScheduleOptions): ScheduleSeedEntry[] {
  const home = options.home;
  const school = options.school;
  const child = options.child === true;
  const days = options.days ?? ALL_WEEK;
  const adherence = options.adherence ?? 0.88;
  const wake = options.schoolStart - 1.4;
  const bed = options.bedHour ?? (child ? 21 : 23);
  const leisure = options.leisureLocation ?? LOC.park;
  const restDays = complementDays(days);
  const entries: ScheduleSeedEntry[] = [
    s(0, Math.max(1, wake - 0.6), 'sleep', home, adherence),
    s(Math.max(0.6, wake - 0.6), Math.max(1.6, wake - 0.2), 'breakfast', home, adherence * 0.95),
    s(Math.max(1, wake - 0.2), options.schoolStart, 'commute', school, adherence * 0.9, days),
    s(options.schoolStart, options.schoolStart + 3, 'work', school, adherence, days),
    s(options.schoolStart + 3, options.schoolStart + 3.75, 'lunch', school, adherence * 0.9),
    s(options.schoolStart + 3.75, options.schoolEnd, 'work', school, adherence, days),
  ];
  if (restDays.length > 0) {
    entries.push(s(options.schoolStart, options.schoolEnd, 'leisure', leisure, adherence * 0.7, restDays));
  }
  entries.push(
    s(options.schoolEnd, Math.min(options.schoolEnd + 1.5, 17.5), child ? 'leisure' : 'stroll', leisure, adherence * 0.75)
  );
  entries.push(s(18, 19, 'dinner', home, adherence * 0.9));
  entries.push(s(19, child ? 20.25 : 21.25, child ? 'hobby' : 'read', home, adherence * 0.7));
  entries.push(s(child ? 20.25 : 21.25, bed, 'relax', home, adherence * 0.9));
  entries.push(s(bed, 24, 'sleep', home, adherence));
  return entries.filter((entry) => entry.endHour > entry.startHour);
}

interface RetiredScheduleOptions {
  home: LocationId;
  market: LocationId;
  cafe: LocationId;
  library: LocationId;
  garden: LocationId;
  bedHour?: number;
  adherence?: number;
}

function retiredSchedule(options: RetiredScheduleOptions): ScheduleSeedEntry[] {
  const adherence = options.adherence ?? 0.8;
  const bed = options.bedHour ?? 21.5;
  return [
    s(0, 7.25, 'sleep', options.home, adherence),
    s(7.25, 8, 'breakfast', options.home, adherence * 0.9),
    s(8, 9.5, 'stroll', LOC.park, adherence * 0.8),
    s(9.5, 10.75, 'go_cafe', options.cafe, adherence * 0.75),
    s(10.75, 12, 'personal_errand', options.market, adherence * 0.7),
    s(12, 13, 'lunch', options.home, adherence * 0.9),
    s(13, 14.5, 'garden', options.garden, adherence * 0.65),
    s(14.5, 16, 'read', options.library, adherence * 0.7),
    s(16, 17.25, 'leisure', options.market, adherence * 0.65),
    s(17.25, 18, 'dinner', options.home, adherence * 0.9),
    s(18, 20.5, 'relax', options.home, adherence * 0.9),
    s(20.5, bed, 'read', options.home, adherence * 0.75),
    s(bed, 24, 'sleep', options.home, adherence),
  ].filter((entry) => entry.endHour > entry.startHour);
}

interface FreeScheduleOptions {
  home: LocationId;
  studio: LocationId;
  cafe: LocationId;
  library: LocationId;
  bedHour?: number;
  adherence?: number;
}

function freeSchedule(options: FreeScheduleOptions): ScheduleSeedEntry[] {
  const adherence = options.adherence ?? 0.72;
  const bed = options.bedHour ?? 23;
  return [
    s(0, 8.4, 'sleep', options.home, adherence),
    s(8.4, 9.1, 'breakfast', options.home, adherence * 0.9),
    s(9.1, 12.2, 'hobby', options.studio, adherence * 0.75),
    s(12.2, 13.1, 'lunch', options.cafe, adherence * 0.8),
    s(13.1, 16.2, 'hobby', options.studio, adherence * 0.7),
    s(16.2, 17.4, 'read', options.library, adherence * 0.65),
    s(17.4, 18.3, 'dinner', options.home, adherence * 0.85),
    s(18.3, 20.6, 'socialise', options.cafe, adherence * 0.7),
    s(20.6, bed, 'relax', options.home, adherence * 0.85),
    s(bed, 24, 'sleep', options.home, adherence),
  ].filter((entry) => entry.endHour > entry.startHour);
}

interface NightScheduleOptions {
  home: LocationId;
  stage: LocationId;
  cafe: LocationId;
  bedHour?: number;
  adherence?: number;
}

function nightSchedule(options: NightScheduleOptions): ScheduleSeedEntry[] {
  const adherence = options.adherence ?? 0.7;
  const bed = options.bedHour ?? 23.5;
  return [
    s(0, 1.2, 'rest', options.home, adherence * 0.7),
    s(1.2, 9, 'sleep', options.home, adherence),
    s(9, 9.75, 'breakfast', options.home, adherence * 0.9),
    s(9.75, 12, 'personal_errand', options.cafe, adherence * 0.7),
    s(12, 13, 'lunch', options.cafe, adherence * 0.8),
    s(13, 16.5, 'hobby', options.stage, adherence * 0.75),
    s(16.5, 18, 'dinner', options.home, adherence * 0.85),
    s(18, 20.2, 'leisure', options.cafe, adherence * 0.65),
    s(20.2, bed, 'work', options.stage, adherence * 0.8),
    s(bed, 24, 'rest', options.home, adherence * 0.7),
  ].filter((entry) => entry.endHour > entry.startHour);
}

// -----------------------------------------------------------------------------
// 14 MAJOR NPCs
// -----------------------------------------------------------------------------
const MAJOR_NPCS: NPCDef[] = [
  {
    id: NPC.marigoldLyle,
    name: 'Marigold Lyle',
    age: 47,
    lifeStage: 'adult',
    personality: traits({
      extroversion: 0.78, introversion: 0.22, adventure: 0.35, caution: 0.55,
      generosity: 0.82, curiosity: 0.62, socialNeed: 0.75, independence: 0.42,
      responsibility: 0.72, spendingTendency: 0.55, artisticTendency: 0.8, workTendency: 0.75,
    }),
    appearance: appearance({
      primaryColor: '#f2b5c4', secondaryColor: '#7aa95c', hairColor: '#c98b4b',
      skinTone: '#f0c8a8', outfitStyle: 'casual', accessory: 'flower-pin', scale: 1,
    }),
    occupation: 'Florist',
    homeLocationId: LOC.home,
    workLocationId: LOC.flowerShop,
    startingMoney: 42000,
    interests: ['flowers', 'gardening', 'gossip', 'romance', 'community'],
    goals: [
      'Grow the finest roses in the county',
      'Keep the flower shop blooming through every season',
      'Make the village square beautiful for the spring festival',
    ],
    bio:
      'Marigold has run the flower shop on the village square for twenty years, and she knows exactly which rose belongs at every wedding in Willowbrook. She is the first to hear any news and the last to let a neighbour go hungry, and her window boxes are the unofficial pride of the village. She firmly believes that most problems can be solved with a bouquet and a cup of tea.',
    dialogueTreeId: 'dialogue_' + NPC.marigoldLyle,
    scheduleTemplate: [
      s(0, 6.25, 'sleep', LOC.home, 0.94),
      s(6.25, 7, 'breakfast', LOC.home, 0.9),
      s(7, 7.8, 'commute', LOC.flowerShop, 0.9),
      s(7.8, 9.5, 'garden', LOC.flowerShop, 0.9),
      s(9.5, 13, 'work', LOC.flowerShop, 0.92),
      s(13, 13.75, 'lunch', LOC.flowerShop, 0.88),
      s(13.75, 17.5, 'work', LOC.flowerShop, 0.9),
      s(17.5, 18.4, 'dinner', LOC.home, 0.85),
      s(18.4, 19.5, 'stroll', LOC.plaza, 0.72),
      s(19.5, 21.2, 'socialise', LOC.cafe, 0.75),
      s(21.2, 22.4, 'relax', LOC.home, 0.85),
      s(22.4, 24, 'sleep', LOC.home, 0.94),
    ],
    initialRelationships: [
      rel(NPC.sylviaReed, 45, 40, 30, 'friend'),
      rel(NPC.claraBright, 38, 35, 20, 'friend'),
      rel(NPC.elizaThorne, 20, 25, 10, 'acquaintance'),
    ],
    major: true,
    romanceable: false,
    likes: ['flower', 'plant', 'romantic', 'garden', 'sweet', 'tea', 'handmade'],
    dislikes: ['practical', 'tool', 'fossil', 'ale'],
  },
  {
    id: NPC.ottoBramwell,
    name: 'Otto Bramwell',
    age: 56,
    lifeStage: 'adult',
    personality: traits({
      extroversion: 0.4, introversion: 0.6, adventure: 0.2, caution: 0.65,
      generosity: 0.55, curiosity: 0.35, socialNeed: 0.35, independence: 0.7,
      responsibility: 0.9, spendingTendency: 0.3, artisticTendency: 0.5, workTendency: 0.95,
    }),
    appearance: appearance({
      primaryColor: '#e8d0a9', secondaryColor: '#8c5a3c', hairColor: '#6b6b6b',
      skinTone: '#e8c39e', outfitStyle: 'work', accessory: 'flour-dusted-cap', scale: 1.02,
    }),
    occupation: 'Baker',
    homeLocationId: LOC.home,
    workLocationId: LOC.bakery,
    startingMoney: 65000,
    interests: ['baking', 'cooking', 'work', 'practical', 'quiet'],
    goals: [
      'Bake the perfect loaf for the harvest festival',
      'Pass the bakery old recipes to someone worthy',
      'Never open late and never sell stale bread',
    ],
    bio:
      'Otto has been up before dawn baking for the village since he was a boy, and he has strong opinions about how a loaf should sound when you tap it. Gruff, flour-dusted and quietly generous, he distrusts anything that was not made by hand. He and Sylvia at the cafe have a running argument about whose pastry is better.',
    dialogueTreeId: 'dialogue_' + NPC.ottoBramwell,
    scheduleTemplate: [
      s(0, 3.4, 'sleep', LOC.home, 0.96),
      s(3.4, 3.75, 'breakfast', LOC.home, 0.9),
      s(3.75, 4.5, 'commute', LOC.bakery, 0.95),
      s(4.5, 9.5, 'work', LOC.bakery, 0.97, [0, 1, 2, 3, 4, 5]),
      s(9.5, 10.4, 'lunch', LOC.bakery, 0.85),
      s(10.4, 14.5, 'work', LOC.bakery, 0.96, [0, 1, 2, 3, 4, 5]),
      s(10.4, 14.5, 'leisure', LOC.home, 0.7, SUNDAY),
      s(14.5, 15.2, 'stroll', LOC.park, 0.7),
      s(15.2, 16.4, 'personal_errand', LOC.market, 0.72, [1, 4]),
      s(15.2, 17, 'rest', LOC.home, 0.72),
      s(17, 18.1, 'dinner', LOC.home, 0.85),
      s(18.1, 21, 'hobby', LOC.home, 0.75),
      s(21, 22.4, 'relax', LOC.home, 0.85),
      s(22.4, 24, 'sleep', LOC.home, 0.96),
    ],
    initialRelationships: [
      rel(NPC.sylviaReed, -28, 22, 18, 'rival'),
      rel(NPC.haroldBagg, 15, 20, 5, 'acquaintance'),
    ],
    major: true,
    romanceable: false,
    likes: ['bread', 'pastry', 'baked_good', 'practical', 'coffee', 'honey', 'tool'],
    dislikes: ['sweet', 'fashion', 'city_life', 'candle'],
  },
  {
    id: NPC.sylviaReed,
    name: 'Sylvia Reed',
    age: 44,
    lifeStage: 'adult',
    personality: traits({
      extroversion: 0.85, introversion: 0.15, adventure: 0.4, caution: 0.45,
      generosity: 0.65, curiosity: 0.65, socialNeed: 0.85, independence: 0.65,
      responsibility: 0.7, spendingTendency: 0.5, artisticTendency: 0.4, workTendency: 0.8,
    }),
    appearance: appearance({
      primaryColor: '#c96b4a', secondaryColor: '#f5e6c8', hairColor: '#2f2a26',
      skinTone: '#c68b63', outfitStyle: 'casual', accessory: 'coffee-stained-apron', scale: 1,
    }),
    occupation: 'Cafe owner',
    homeLocationId: LOC.home,
    workLocationId: LOC.cafe,
    startingMoney: 58000,
    interests: ['coffee', 'cooking', 'gossip', 'music', 'socialising'],
    goals: [
      'Make the cafe the heart of Willowbrook',
      'See Jasper settle into a happy life',
      'Host a music evening the whole village remembers',
    ],
    bio:
      'Sylvia cafe sits at the heart of Willowbrook, which is exactly where she likes to be. She remembers every regular order and most of their secrets, and she has a soft spot for lost souls and struggling musicians - especially her son, Jasper. Underneath the cheerful gossip is a steely head for business.',
    dialogueTreeId: 'dialogue_' + NPC.sylviaReed,
    scheduleTemplate: [
      s(0, 5.75, 'sleep', LOC.home, 0.92),
      s(5.75, 6.3, 'breakfast', LOC.home, 0.85),
      s(6.3, 7, 'commute', LOC.cafe, 0.9),
      s(7, 11.5, 'work', LOC.cafe, 0.94, [0, 1, 2, 3, 4, 5]),
      s(7, 11.5, 'rest', LOC.home, 0.8, SUNDAY),
      s(11.5, 12.4, 'lunch', LOC.cafe, 0.88),
      s(12.4, 17, 'work', LOC.cafe, 0.92),
      s(17, 18.2, 'socialise', LOC.plaza, 0.72),
      s(18.2, 19.1, 'dinner', LOC.home, 0.85),
      s(19.1, 20.4, 'personal_errand', LOC.market, 0.65, [2, 5]),
      s(19.1, 21, 'relax', LOC.home, 0.78),
      s(21, 22.5, 'socialise', LOC.cafe, 0.6, [4, 5]),
      s(21, 22.5, 'relax', LOC.home, 0.78),
      s(22.5, 24, 'sleep', LOC.home, 0.92),
    ],
    initialRelationships: [
      rel(NPC.jasperKim, 70, 75, 60, 'family'),
      rel(NPC.haroldBagg, 22, 25, 10, 'acquaintance'),
    ],
    major: true,
    romanceable: true,
    likes: ['coffee', 'tea', 'cake', 'sweet', 'socialising', 'music', 'romantic'],
    dislikes: ['quiet', 'practical', 'fossil', 'tool'],
  },
  {
    id: NPC.haroldBagg,
    name: 'Harold Bagg',
    age: 61,
    lifeStage: 'adult',
    personality: traits({
      extroversion: 0.65, introversion: 0.35, adventure: 0.45, caution: 0.6,
      generosity: 0.75, curiosity: 0.55, socialNeed: 0.6, independence: 0.75,
      responsibility: 0.85, spendingTendency: 0.35, artisticTendency: 0.25, workTendency: 0.85,
    }),
    appearance: appearance({
      primaryColor: '#3f6aa1', secondaryColor: '#d94a3d', hairColor: '#c9c1b4',
      skinTone: '#e5b48d', outfitStyle: 'work', accessory: 'post-bag', scale: 1.03,
    }),
    occupation: 'Postman',
    homeLocationId: LOC.home,
    workLocationId: LOC.postOffice,
    startingMoney: 38000,
    interests: ['walking', 'weather', 'gossip', 'birds', 'practical'],
    goals: [
      'Walk every lane in Willowbrook in a single day',
      'Deliver every letter on time until he retires',
      'Whittle the perfect wooden bird',
    ],
    bio:
      'Harold has walked the same postal round for thirty years and still knows where every dog on the route will try to bite him. Since his wife passed, the round has become his way of keeping company with the whole village. He whittles birds during his breaks and can predict rain better than the almanac.',
    dialogueTreeId: 'dialogue_' + NPC.haroldBagg,
    scheduleTemplate: [
      s(0, 5.4, 'sleep', LOC.home, 0.94),
      s(5.4, 6, 'breakfast', LOC.home, 0.88),
      s(6, 6.6, 'commute', LOC.postOffice, 0.9),
      s(6.6, 10.5, 'work', LOC.postOffice, 0.93, WEEKDAYS),
      s(10.5, 11.3, 'lunch', LOC.cafe, 0.85),
      s(10.5, 11.3, 'stroll', LOC.park, 0.8, [5, 6]),
      s(11.3, 15.5, 'work', LOC.postOffice, 0.9, WEEKDAYS),
      s(12, 13, 'stroll', LOC.park, 0.75, SATURDAY),
      s(15.5, 17, 'personal_errand', LOC.market, 0.7),
      s(17, 18, 'dinner', LOC.home, 0.85),
      s(18, 20.2, 'hobby', LOC.home, 0.75),
      s(20.2, 21.5, 'socialise', LOC.cafe, 0.6, [2, 4]),
      s(20.2, 21.5, 'relax', LOC.home, 0.8),
      s(21.5, 24, 'sleep', LOC.home, 0.94),
    ],
    initialRelationships: [
      rel(NPC.elizaThorne, 40, 42, 25, 'friend'),
      rel(NPC.edmundHale, 35, 40, 20, 'friend'),
    ],
    major: true,
    romanceable: true,
    likes: ['letter', 'stationery', 'tea', 'bread', 'bird', 'practical', 'wood'],
    dislikes: ['city_life', 'fashion', 'candle', 'loud'],
  },
  {
    id: NPC.elizaThorne,
    name: 'Eliza Thorne',
    age: 72,
    lifeStage: 'elder',
    personality: traits({
      extroversion: 0.3, introversion: 0.7, adventure: 0.25, caution: 0.7,
      generosity: 0.6, curiosity: 0.85, socialNeed: 0.4, independence: 0.8,
      responsibility: 0.7, spendingTendency: 0.2, artisticTendency: 0.55, workTendency: 0.35,
    }),
    appearance: appearance({
      primaryColor: '#7f6fa0', secondaryColor: '#efe6d6', hairColor: '#dedede',
      skinTone: '#e8c7a6', outfitStyle: 'elder', accessory: 'reading-glasses', scale: 0.95,
    }),
    occupation: 'Retired librarian',
    homeLocationId: LOC.home,
    workLocationId: LOC.library,
    startingMoney: 52000,
    interests: ['books', 'history', 'local_history', 'poetry', 'quiet'],
    goals: [
      'Write the definitive history of Willowbrook',
      'Keep the village library open for the next generation',
      'Remember every name that ever lived on her street',
    ],
    bio:
      'Eliza spent forty years as Willowbrook librarian and now treats the reading room as her second home. She is writing a history of every lane and every name in the parish and remembers which families quarrelled in 1962. Wry, unstoppably curious and quietly kind to anyone who asks her a question.',
    dialogueTreeId: 'dialogue_' + NPC.elizaThorne,
    scheduleTemplate: [
      s(0, 7, 'sleep', LOC.home, 0.9),
      s(7, 7.7, 'breakfast', LOC.home, 0.85),
      s(7.7, 9.2, 'read', LOC.home, 0.75),
      s(9.2, 10, 'stroll', LOC.park, 0.7),
      s(10, 12, 'read', LOC.library, 0.8),
      s(12, 13, 'lunch', LOC.home, 0.85),
      s(13, 15.2, 'hobby', LOC.library, 0.75),
      s(15.2, 16.2, 'go_cafe', LOC.cafe, 0.65),
      s(16.2, 18, 'read', LOC.library, 0.75),
      s(18, 19, 'dinner', LOC.home, 0.85),
      s(19, 21, 'socialise', LOC.home, 0.6, [2, 5]),
      s(19, 21, 'relax', LOC.home, 0.8),
      s(21, 21.8, 'read', LOC.home, 0.75),
      s(21.8, 24, 'sleep', LOC.home, 0.9),
    ],
    initialRelationships: [
      rel(NPC.theoGrey, 42, 45, 28, 'friend'),
      rel(NPC.edmundHale, 48, 50, 30, 'friend'),
    ],
    major: true,
    romanceable: false,
    likes: ['book', 'poetry', 'history', 'tea', 'quiet', 'antique', 'letter'],
    dislikes: ['loud', 'city_life', 'fashion', 'festival'],
  },
  {
    id: NPC.theoGrey,
    name: 'Theo Grey',
    age: 39,
    lifeStage: 'adult',
    personality: traits({
      extroversion: 0.28, introversion: 0.72, adventure: 0.35, caution: 0.6,
      generosity: 0.6, curiosity: 0.9, socialNeed: 0.45, independence: 0.55,
      responsibility: 0.7, spendingTendency: 0.3, artisticTendency: 0.7, workTendency: 0.65,
    }),
    appearance: appearance({
      primaryColor: '#4e7d68', secondaryColor: '#d8c3a5', hairColor: '#3b2f2a',
      skinTone: '#e0b391', outfitStyle: 'formal', accessory: 'round-spectacles', scale: 1,
    }),
    occupation: 'Bookshop owner',
    homeLocationId: LOC.home,
    workLocationId: LOC.bookshop,
    startingMoney: 31000,
    interests: ['books', 'poetry', 'local_history', 'music', 'quiet'],
    goals: [
      'Find the missing volume of the old town almanac',
      'Host a poetry evening at the bookshop',
      'Finally finish writing his own novel',
    ],
    bio:
      'Theo took over the bookshop from his father and has been quietly reshaping it into a refuge for anyone who needs a warm corner and a story. He is far braver between the pages than he is in person, and still cannot talk for a minute about poetry without blushing. He is hoping the town lost almanac will turn up somewhere.',
    dialogueTreeId: 'dialogue_' + NPC.theoGrey,
    scheduleTemplate: [
      s(0, 6.7, 'sleep', LOC.home, 0.9),
      s(6.7, 7.4, 'breakfast', LOC.home, 0.85),
      s(7.4, 8.2, 'commute', LOC.bookshop, 0.85),
      s(8.2, 12, 'work', LOC.bookshop, 0.88, [0, 1, 2, 3, 4, 5]),
      s(12, 12.8, 'lunch', LOC.cafe, 0.8),
      s(12.8, 17.5, 'work', LOC.bookshop, 0.86),
      s(17.5, 18.4, 'dinner', LOC.home, 0.85),
      s(18.4, 20.5, 'read', LOC.home, 0.8),
      s(20.5, 21.6, 'socialise', LOC.cafe, 0.55, [1, 4]),
      s(20.5, 21.6, 'relax', LOC.home, 0.8),
      s(21.6, 23.5, 'hobby', LOC.home, 0.75),
      s(23.5, 24, 'sleep', LOC.home, 0.9),
    ],
    initialRelationships: [
      rel(NPC.penelopeVance, 30, 35, 18, 'acquaintance'),
      rel(NPC.jasperKim, 28, 30, 15, 'friend'),
    ],
    major: true,
    romanceable: true,
    likes: ['book', 'poetry', 'romantic', 'tea', 'music', 'quiet', 'letter'],
    dislikes: ['loud', 'ale', 'tool', 'festival'],
  },
  {
    id: NPC.claraBright,
    name: 'Clara Bright',
    age: 31,
    lifeStage: 'adult',
    personality: traits({
      extroversion: 0.5, introversion: 0.5, adventure: 0.55, caution: 0.5,
      generosity: 0.65, curiosity: 0.95, socialNeed: 0.5, independence: 0.6,
      responsibility: 0.75, spendingTendency: 0.35, artisticTendency: 0.6, workTendency: 0.8,
    }),
    appearance: appearance({
      primaryColor: '#8fbc5a', secondaryColor: '#f0e4b8', hairColor: '#7a4b2a',
      skinTone: '#d9a273', outfitStyle: 'outdoor', accessory: 'plant-clippings', scale: 1,
    }),
    occupation: 'Botanist',
    homeLocationId: LOC.countryside,
    workLocationId: LOC.greenhouse,
    startingMoney: 36000,
    interests: ['plants', 'gardening', 'nature', 'forest', 'history'],
    goals: [
      'Catalogue every wild plant in Willowbrook',
      'Breed a rose that blooms in winter',
      'Turn the old greenhouse into a community garden',
    ],
    bio:
      'Clara keeps the village greenhouse running and spends her free days tramping through the forest with a field notebook and muddy boots. Her cousin Penelope calls her the best botanist in the county, and Clara is too busy dividing lavender to argue. She is convinced the right plant can fix almost anything.',
    dialogueTreeId: 'dialogue_' + NPC.claraBright,
    scheduleTemplate: [
      s(0, 6.3, 'sleep', LOC.countryside, 0.9),
      s(6.3, 7, 'breakfast', LOC.countryside, 0.85),
      s(7, 7.7, 'commute', LOC.greenhouse, 0.85),
      s(7.7, 11.5, 'garden', LOC.greenhouse, 0.9),
      s(11.5, 12.4, 'lunch', LOC.greenhouse, 0.85),
      s(12.4, 16, 'work', LOC.greenhouse, 0.88),
      s(16, 17.6, 'stroll', LOC.forest, 0.7),
      s(17.6, 18.6, 'dinner', LOC.countryside, 0.85),
      s(18.6, 20.2, 'hobby', LOC.countryside, 0.75),
      s(20.2, 21.5, 'read', LOC.home, 0.6, [1, 3]),
      s(20.2, 21.5, 'relax', LOC.countryside, 0.8),
      s(21.5, 22.5, 'relax', LOC.countryside, 0.85),
      s(22.5, 24, 'sleep', LOC.countryside, 0.9),
    ],
    initialRelationships: [
      rel(NPC.adaQuinn, 40, 45, 25, 'friend'),
      rel(NPC.penelopeVance, 55, 60, 40, 'family'),
      rel(NPC.elizaThorne, 35, 40, 20, 'friend'),
    ],
    major: true,
    romanceable: true,
    likes: ['plant', 'seed', 'herb', 'flower', 'handmade', 'nature', 'book', 'tea'],
    dislikes: ['fashion', 'fossil', 'loud', 'city_life'],
  },
  {
    id: NPC.finnHolloway,
    name: 'Finn Holloway',
    age: 35,
    lifeStage: 'adult',
    personality: traits({
      extroversion: 0.45, introversion: 0.55, adventure: 0.7, caution: 0.45,
      generosity: 0.6, curiosity: 0.5, socialNeed: 0.45, independence: 0.8,
      responsibility: 0.6, spendingTendency: 0.4, artisticTendency: 0.3, workTendency: 0.75,
    }),
    appearance: appearance({
      primaryColor: '#4f7f8f', secondaryColor: '#d9c8a0', hairColor: '#5b3a24',
      skinTone: '#c99063', outfitStyle: 'outdoor', accessory: 'fishing-hat', scale: 1.04,
    }),
    occupation: 'Fisherman',
    homeLocationId: LOC.countryside,
    workLocationId: LOC.river,
    startingMoney: 26000,
    interests: ['fishing', 'water', 'weather', 'river', 'quiet'],
    goals: [
      'Catch the legendary silver eel',
      'Save enough to buy a proper river boat',
      'Build a cabin with a view of the water',
    ],
    bio:
      'Finn fishes the river before dawn and knows every bend, eddy and old story between the bridge and the lake. He is quiet with strangers and a chatterbox with the water, and has earned a local reputation for pulling strange things out of the river. He has been sweet on Ada Quinn since they were children.',
    dialogueTreeId: 'dialogue_' + NPC.finnHolloway,
    scheduleTemplate: [
      s(0, 4.4, 'sleep', LOC.countryside, 0.92),
      s(4.4, 4.9, 'breakfast', LOC.countryside, 0.85),
      s(4.9, 5.4, 'commute', LOC.river, 0.9),
      s(5.4, 9.5, 'fish', LOC.river, 0.93),
      s(9.5, 10.3, 'lunch', LOC.river, 0.8),
      s(10.3, 14, 'fish', LOC.lake, 0.88),
      s(14, 15, 'stroll', LOC.countryside, 0.7),
      s(15, 17.5, 'personal_errand', LOC.market, 0.7),
      s(17.5, 18.5, 'dinner', LOC.countryside, 0.85),
      s(18.5, 20.4, 'socialise', LOC.cafe, 0.6, [1, 3, 5]),
      s(18.5, 20.4, 'relax', LOC.countryside, 0.8),
      s(20.4, 22, 'hobby', LOC.countryside, 0.75),
      s(22, 24, 'sleep', LOC.countryside, 0.92),
    ],
    initialRelationships: [
      rel(NPC.adaQuinn, 62, 55, 48, 'close_friend'),
    ],
    major: true,
    romanceable: false,
    likes: ['fish', 'fresh_fish', 'river', 'outdoors', 'practical', 'ale', 'quiet'],
    dislikes: ['city_life', 'fashion', 'loud', 'candle'],
  },
  {
    id: NPC.adaQuinn,
    name: 'Ada Quinn',
    age: 33,
    lifeStage: 'adult',
    personality: traits({
      extroversion: 0.6, introversion: 0.4, adventure: 0.45, caution: 0.55,
      generosity: 0.7, curiosity: 0.55, socialNeed: 0.55, independence: 0.85,
      responsibility: 0.95, spendingTendency: 0.25, artisticTendency: 0.2, workTendency: 0.95,
    }),
    appearance: appearance({
      primaryColor: '#8a6a3f', secondaryColor: '#d4b483', hairColor: '#1f1a17',
      skinTone: '#b87b52', outfitStyle: 'work', accessory: 'straw-hat', scale: 1.02,
    }),
    occupation: 'Farmer',
    homeLocationId: LOC.countryside,
    workLocationId: LOC.farm,
    startingMoney: 45000,
    interests: ['farming', 'gardening', 'food', 'festivals', 'community'],
    goals: [
      'Bring in the best harvest in Willowbrook',
      'Pay off the farm equipment loan',
      'Host the autumn harvest supper for the whole village',
    ],
    bio:
      'Ada runs the family farm on the west side of the village with rolled sleeves and a plan for everything. She gets up before the chickens, keeps the accounts in a terrifyingly neat notebook, and is the first to turn up with soup when a neighbour is ill. Her harvest suppers are legendary.',
    dialogueTreeId: 'dialogue_' + NPC.adaQuinn,
    scheduleTemplate: [
      s(0, 4.7, 'sleep', LOC.countryside, 0.94),
      s(4.7, 5.2, 'breakfast', LOC.countryside, 0.9),
      s(5.2, 5.6, 'commute', LOC.farm, 0.92),
      s(5.6, 9.5, 'garden', LOC.farm, 0.95),
      s(9.5, 10.3, 'lunch', LOC.farm, 0.85),
      s(10.3, 14.5, 'garden', LOC.farm, 0.92),
      s(14.5, 16, 'work', LOC.farm, 0.88),
      s(16, 17.5, 'personal_errand', LOC.market, 0.75),
      s(17.5, 18.6, 'dinner', LOC.countryside, 0.85),
      s(18.6, 20.5, 'socialise', LOC.cafe, 0.6, [1, 3, 5]),
      s(18.6, 20.5, 'relax', LOC.countryside, 0.8),
      s(20.5, 21.8, 'hobby', LOC.countryside, 0.72),
      s(21.8, 24, 'sleep', LOC.countryside, 0.94),
    ],
    initialRelationships: [
      rel(NPC.edmundHale, 18, 25, 8, 'acquaintance'),
    ],
    major: true,
    romanceable: false,
    likes: ['farm_produce', 'vegetable', 'seed', 'practical', 'tool', 'bread', 'cider'],
    dislikes: ['fashion', 'city_life', 'sweet', 'candle'],
  },
  {
    id: NPC.rufusMarsh,
    name: 'Rufus Marsh',
    age: 54,
    lifeStage: 'adult',
    personality: traits({
      extroversion: 0.25, introversion: 0.75, adventure: 0.3, caution: 0.8,
      generosity: 0.4, curiosity: 0.3, socialNeed: 0.25, independence: 0.85,
      responsibility: 0.8, spendingTendency: 0.2, artisticTendency: 0.15, workTendency: 0.8,
    }),
    appearance: appearance({
      primaryColor: '#5c5c5c', secondaryColor: '#8c6a3f', hairColor: '#4a4a4a',
      skinTone: '#cfa07c', outfitStyle: 'work', accessory: 'warehouse-keys', scale: 1.06,
    }),
    occupation: 'Warehouse keeper',
    homeLocationId: LOC.home,
    workLocationId: LOC.warehouse,
    startingMoney: 30000,
    interests: ['practical', 'quiet', 'work', 'history', 'errands'],
    goals: [
      'Keep every crate accounted for',
      'Learn what is really stored in the warehouse basement',
      'Retire with a tidy ledger',
    ],
    bio:
      'Rufus has minded the warehouse on the edge of town for twenty years and trusts it far more than he trusts people. His keys never leave his belt, his ledger is spotless, and he has a suspiciously detailed theory about what is stored in the basement. He softens for exactly two things: old tools and Finn fishing stories.',
    dialogueTreeId: 'dialogue_' + NPC.rufusMarsh,
    scheduleTemplate: [
      s(0, 6.2, 'sleep', LOC.home, 0.93),
      s(6.2, 6.9, 'breakfast', LOC.home, 0.85),
      s(6.9, 7.5, 'commute', LOC.warehouse, 0.9),
      s(7.5, 12, 'work', LOC.warehouse, 0.94, WEEKDAYS),
      s(12, 12.8, 'lunch', LOC.warehouse, 0.82),
      s(12.8, 17.5, 'work', LOC.warehouse, 0.92, WEEKDAYS),
      s(12, 13, 'stroll', LOC.park, 0.7, [5, 6]),
      s(13, 17, 'personal_errand', LOC.market, 0.7, [5, 6]),
      s(17.5, 18.4, 'dinner', LOC.home, 0.85),
      s(18.4, 20.2, 'hobby', LOC.home, 0.7),
      s(20.2, 21, 'go_cafe', LOC.cafe, 0.4),
      s(20.2, 21, 'relax', LOC.home, 0.8),
      s(21, 22.3, 'relax', LOC.home, 0.85),
      s(22.3, 24, 'sleep', LOC.home, 0.93),
    ],
    initialRelationships: [
      rel(NPC.finnHolloway, 35, 40, 18, 'friend'),
    ],
    major: true,
    romanceable: false,
    likes: ['practical', 'tool', 'antique', 'old_coin', 'ale', 'quiet', 'wood'],
    dislikes: ['loud', 'fashion', 'festival', 'candle'],
  },
  {
    id: NPC.penelopeVance,
    name: 'Penelope Vance',
    age: 41,
    lifeStage: 'adult',
    personality: traits({
      extroversion: 0.55, introversion: 0.45, adventure: 0.4, caution: 0.55,
      generosity: 0.55, curiosity: 0.9, socialNeed: 0.5, independence: 0.6,
      responsibility: 0.75, spendingTendency: 0.45, artisticTendency: 0.75, workTendency: 0.85,
    }),
    appearance: appearance({
      primaryColor: '#b08c6d', secondaryColor: '#2d3b55', hairColor: '#6b3f2a',
      skinTone: '#e3b58f', outfitStyle: 'formal', accessory: 'curator-brooch', scale: 1,
    }),
    occupation: 'Museum curator',
    homeLocationId: LOC.apartments,
    workLocationId: LOC.museum,
    startingMoney: 62000,
    interests: ['history', 'art', 'museums', 'city_life', 'tea'],
    goals: [
      'Bring the Willowbrook hoard back to the museum',
      'Open a permanent exhibition on the old railway',
      'Find the missing portrait of the first mayor',
    ],
    bio:
      'Penelope runs the Ashford Museum with impeccable taste and an agenda - half of it dedicated to bringing the county scattered history home. She is the only person who can get Edmund Hale and the city council into the same room without shouting. She takes her tea strong and her artefacts seriously.',
    dialogueTreeId: 'dialogue_' + NPC.penelopeVance,
    scheduleTemplate: [
      s(0, 6.8, 'sleep', LOC.apartments, 0.9),
      s(6.8, 7.5, 'breakfast', LOC.apartments, 0.85),
      s(7.5, 8.2, 'commute', LOC.museum, 0.9),
      s(8.2, 12, 'work', LOC.museum, 0.9, [1, 2, 3, 4, 5]),
      s(12, 12.9, 'lunch', LOC.cityCafe, 0.82),
      s(12.9, 17, 'work', LOC.museum, 0.88),
      s(17, 18.1, 'read', LOC.cityLibrary, 0.65),
      s(18.1, 19.2, 'dinner', LOC.apartments, 0.85),
      s(19.2, 21, 'leisure', LOC.eventSquare, 0.6, [2, 5]),
      s(19.2, 21, 'relax', LOC.apartments, 0.8),
      s(21, 22.4, 'hobby', LOC.apartments, 0.75),
      s(22.4, 24, 'sleep', LOC.apartments, 0.9),
    ],
    initialRelationships: [
      rel(NPC.edmundHale, 40, 45, 25, 'friend'),
      rel(NPC.ninaOkoye, 15, 20, 8, 'acquaintance'),
    ],
    major: true,
    romanceable: true,
    likes: ['antique', 'history', 'fossil', 'old_coin', 'book', 'art', 'tea', 'collectible'],
    dislikes: ['ale', 'tool', 'loud', 'practical'],
  },
  {
    id: NPC.jasperKim,
    name: 'Jasper Kim',
    age: 25,
    lifeStage: 'adult',
    personality: traits({
      extroversion: 0.8, introversion: 0.2, adventure: 0.65, caution: 0.25,
      generosity: 0.6, curiosity: 0.65, socialNeed: 0.8, independence: 0.55,
      responsibility: 0.35, spendingTendency: 0.6, artisticTendency: 0.9, workTendency: 0.6,
    }),
    appearance: appearance({
      primaryColor: '#2f4858', secondaryColor: '#e1a730', hairColor: '#1c1c1c',
      skinTone: '#d8a878', outfitStyle: 'artsy', accessory: 'guitar-pick-necklace', scale: 0.98,
    }),
    occupation: 'Barista & musician',
    homeLocationId: LOC.home,
    workLocationId: LOC.cityCafe,
    startingMoney: 18000,
    interests: ['music', 'art', 'coffee', 'city_life', 'romance'],
    goals: [
      'Write a song the whole village sings',
      'Play the stage at the Ashford culture day',
      'Save enough to record a little album',
    ],
    bio:
      'Jasper works mornings at the city cafe and spends every other waking hour with his guitar, chasing the song that will finally sound like the one in his head. He is Sylvia Reed son, which explains both the easy charm and the stubborn streak. He has a habit of falling for the wrong person and writing a very good song about it.',
    dialogueTreeId: 'dialogue_' + NPC.jasperKim,
    scheduleTemplate: [
      s(0, 2, 'hobby', LOC.home, 0.7),
      s(2, 6.5, 'sleep', LOC.home, 0.88),
      s(6.5, 7.1, 'breakfast', LOC.home, 0.82),
      s(7.1, 8.1, 'commute', LOC.cityCafe, 0.85),
      s(8.1, 12, 'work', LOC.cityCafe, 0.88, [0, 1, 2, 3, 4]),
      s(12, 12.8, 'lunch', LOC.cityCafe, 0.8),
      s(12.8, 15.5, 'work', LOC.cityCafe, 0.85, [0, 1, 2, 3, 4]),
      s(15.5, 18, 'hobby', LOC.cityPark, 0.75),
      s(18, 19, 'dinner', LOC.home, 0.8),
      s(19, 21.5, 'socialise', LOC.cafe, 0.7, [1, 3, 5, 6]),
      s(19, 21.5, 'hobby', LOC.home, 0.75),
      s(21.5, 23.4, 'hobby', LOC.home, 0.7),
      s(23.4, 24, 'relax', LOC.home, 0.8),
    ],
    initialRelationships: [
      rel(NPC.ninaOkoye, 30, 35, 15, 'friend'),
    ],
    major: true,
    romanceable: true,
    likes: ['music', 'coffee', 'art', 'romantic', 'city_life', 'handmade', 'festival'],
    dislikes: ['practical', 'quiet', 'tool', 'fossil'],
  },
  {
    id: NPC.edmundHale,
    name: 'Edmund Hale',
    age: 66,
    lifeStage: 'elder',
    personality: traits({
      extroversion: 0.6, introversion: 0.4, adventure: 0.3, caution: 0.65,
      generosity: 0.8, curiosity: 0.55, socialNeed: 0.6, independence: 0.5,
      responsibility: 0.9, spendingTendency: 0.3, artisticTendency: 0.35, workTendency: 0.7,
    }),
    appearance: appearance({
      primaryColor: '#6b5e4a', secondaryColor: '#c8b995', hairColor: '#d8d2c6',
      skinTone: '#dbb08d', outfitStyle: 'formal', accessory: 'mayor-chain', scale: 1,
    }),
    occupation: 'Community chair',
    homeLocationId: LOC.home,
    workLocationId: LOC.center,
    startingMoney: 55000,
    interests: ['community', 'history', 'local_history', 'gossip', 'practical'],
    goals: [
      'Get the market awning approved before summer',
      'Keep the village green open for everyone',
      'Broker peace between the bakery and the cafe',
    ],
    bio:
      'Edmund has chaired the village community for two decades and treats every pothole and planning dispute as a personal matter. He is fond of long letters, longer speeches and the steady rhythm of a handshake, and considers the whole village his responsibility. Even his rivals admit the village would drift without him.',
    dialogueTreeId: 'dialogue_' + NPC.edmundHale,
    scheduleTemplate: [
      s(0, 6, 'sleep', LOC.home, 0.92),
      s(6, 6.8, 'breakfast', LOC.home, 0.85),
      s(6.8, 7.6, 'commute', LOC.center, 0.85),
      s(7.6, 9.2, 'stroll', LOC.plaza, 0.7),
      s(9.2, 12, 'work', LOC.center, 0.88, WEEKDAYS),
      s(12, 13, 'lunch', LOC.cafe, 0.82),
      s(13, 16.5, 'work', LOC.center, 0.85, WEEKDAYS),
      s(9.2, 16.5, 'personal_errand', LOC.market, 0.7, [5, 6]),
      s(16.5, 17.5, 'read', LOC.library, 0.65),
      s(17.5, 18.6, 'dinner', LOC.home, 0.85),
      s(18.6, 20.5, 'socialise', LOC.plaza, 0.6, [0, 2, 4]),
      s(18.6, 20.5, 'relax', LOC.home, 0.8),
      s(20.5, 22, 'hobby', LOC.home, 0.72),
      s(22, 24, 'sleep', LOC.home, 0.92),
    ],
    initialRelationships: [
      rel(NPC.rufusMarsh, 12, 18, 5, 'acquaintance'),
    ],
    major: true,
    romanceable: false,
    likes: ['history', 'antique', 'tea', 'practical', 'community', 'book', 'cider'],
    dislikes: ['loud', 'fashion', 'festival', 'candle'],
  },
  {
    id: NPC.ninaOkoye,
    name: 'Nina Okoye',
    age: 28,
    lifeStage: 'adult',
    personality: traits({
      extroversion: 0.55, introversion: 0.45, adventure: 0.5, caution: 0.5,
      generosity: 0.55, curiosity: 0.65, socialNeed: 0.6, independence: 0.75,
      responsibility: 0.7, spendingTendency: 0.5, artisticTendency: 0.45, workTendency: 0.8,
    }),
    appearance: appearance({
      primaryColor: '#3e5c76', secondaryColor: '#d9a06b', hairColor: '#1a1a1a',
      skinTone: '#8a5a3b', outfitStyle: 'city', accessory: 'laptop-bag', scale: 0.99,
    }),
    occupation: 'Office worker',
    homeLocationId: LOC.apartments,
    workLocationId: LOC.officeDistrict,
    startingMoney: 48000,
    interests: ['city_life', 'career', 'coffee', 'music', 'travel'],
    goals: [
      'Make junior partner before thirty',
      'Travel to every stop on the train line',
      'Find a flat with a balcony for plants',
    ],
    bio:
      'Nina commutes to an office in Ashford every weekday and dreams of the balcony flat she has promised herself. She keeps a colour-coded calendar, a growing collection of coffee shops, and a notebook of everything she means to do once work is done. She is braver than she looks and funnier than her email signature suggests.',
    dialogueTreeId: 'dialogue_' + NPC.ninaOkoye,
    scheduleTemplate: [
      s(0, 6.9, 'sleep', LOC.apartments, 0.9),
      s(6.9, 7.5, 'breakfast', LOC.apartments, 0.85),
      s(7.5, 8.6, 'commute', LOC.officeDistrict, 0.88),
      s(8.6, 12.5, 'work', LOC.officeDistrict, 0.9, WEEKDAYS),
      s(12.5, 13.4, 'lunch', LOC.cityCafe, 0.8),
      s(13.4, 17.6, 'work', LOC.officeDistrict, 0.88, WEEKDAYS),
      s(9, 11, 'go_cafe', LOC.cityCafe, 0.7, SATURDAY),
      s(12, 15, 'shop', LOC.shoppingMall, 0.7, SATURDAY),
      s(9, 12, 'stroll', LOC.cityPark, 0.7, SUNDAY),
      s(17.6, 18.7, 'personal_errand', LOC.supermarket, 0.75),
      s(18.7, 19.7, 'dinner', LOC.apartments, 0.85),
      s(19.7, 21.5, 'socialise', LOC.cityCafe, 0.6, [1, 3, 5]),
      s(19.7, 21.5, 'relax', LOC.apartments, 0.8),
      s(21.5, 23, 'read', LOC.apartments, 0.75),
      s(23, 24, 'sleep', LOC.apartments, 0.9),
    ],
    initialRelationships: [
      rel(NPC.elizaThorne, 12, 15, 5, 'acquaintance'),
    ],
    major: true,
    romanceable: true,
    likes: ['coffee', 'book', 'city_life', 'fashion', 'practical', 'music', 'stationery'],
    dislikes: ['quiet', 'fossil', 'outdoors', 'candle'],
  },
];

// -----------------------------------------------------------------------------
// Couples the contract cannot express (InitialRelationshipSeed has no 'dating'
// status). NPCSystem.init applies these exactly once per save.
// -----------------------------------------------------------------------------
export interface InitialCouple {
  a: NPCId;
  b: NPCId;
  description: string;
}

export const INITIAL_COUPLES: readonly InitialCouple[] = [
  {
    a: NPC.adaQuinn,
    b: NPC.finnHolloway,
    description: 'Ada Quinn and Finn Holloway have been sweethearts since before the player arrived in Willowbrook.',
  },
  {
    a: 'resident_03',
    b: 'resident_17',
    description: 'Rowan Finch and Kezia Downing have been together for years and share a cottage on the edge of the fields.',
  },
];

// -----------------------------------------------------------------------------
// 42 RESIDENTS
// -----------------------------------------------------------------------------
function rid(index: number): NPCId {
  return RESIDENT_NPC_IDS[index] ?? 'resident_' + String(index + 1).padStart(2, '0');
}

interface ResidentSpec {
  index: number;
  name: string;
  age: number;
  lifeStage: NPCDef['lifeStage'];
  occupation: string;
  home: LocationId;
  work: LocationId;
  money: number;
  personality: Partial<NPCPersonalityValues>;
  appearance: Partial<NPCAppearanceDef>;
  interests: string[];
  goals: string[];
  bio: string;
  likes: string[];
  dislikes: string[];
  romanceable: boolean;
  schedule: ScheduleSeedEntry[];
  relationships: InitialRelationshipSeed[];
}

function residentDef(spec: ResidentSpec): NPCDef {
  return {
    id: rid(spec.index),
    name: spec.name,
    age: spec.age,
    lifeStage: spec.lifeStage,
    personality: traits(spec.personality),
    appearance: appearance(spec.appearance),
    occupation: spec.occupation,
    homeLocationId: spec.home,
    workLocationId: spec.work,
    startingMoney: spec.money,
    interests: spec.interests,
    goals: spec.goals,
    bio: spec.bio,
    dialogueTreeId: 'dialogue_resident',
    scheduleTemplate: spec.schedule,
    initialRelationships: spec.relationships,
    major: false,
    romanceable: spec.romanceable,
    likes: spec.likes,
    dislikes: spec.dislikes,
  };
}

const RESIDENT_SPECS: ResidentSpec[] = [
  {
    index: 0, name: 'Ivy Pemberton', age: 34, lifeStage: 'adult', occupation: 'Shop assistant',
    home: LOC.home, work: LOC.grocery, money: 21000,
    personality: { extroversion: 0.7, generosity: 0.65, curiosity: 0.5, responsibility: 0.75, spendingTendency: 0.45, socialNeed: 0.65 },
    appearance: { primaryColor: '#7a9e5f', secondaryColor: '#f0d9b5', hairColor: '#8a4b2f', skinTone: '#e8bd94', accessory: 'shop-apron' },
    interests: ['socialising', 'flowers', 'gossip', 'bargains'],
    goals: ['Run the grocery counter like clockwork', 'Save up for a little car'],
    bio: 'Ivy has worked the grocery counter since she left school and knows exactly which customer needs which cut of gossip. She sings to herself when she restocks the shelves.',
    likes: ['flower', 'tea', 'sweet', 'handmade'], dislikes: ['loud', 'practical'],
    romanceable: true, schedule: workSchedule({ home: LOC.home, work: LOC.grocery, workStart: 8, workEnd: 17, workDays: ALL_WEEK, leisureLocation: LOC.park }),
    relationships: [rel('resident_38', 40, 35, 20, 'friend')],
  },
  {
    index: 1, name: 'Miles Ashby', age: 29, lifeStage: 'adult', occupation: 'Delivery driver',
    home: LOC.home, work: LOC.warehouse, money: 24000,
    personality: { extroversion: 0.55, adventure: 0.6, caution: 0.4, curiosity: 0.45, responsibility: 0.65, independence: 0.7 },
    appearance: { primaryColor: '#4d6d8a', secondaryColor: '#d9c9a8', hairColor: '#3a2b22', skinTone: '#d8a87c', accessory: 'driving-gloves' },
    interests: ['travel', 'weather', 'music', 'practical'],
    goals: ['Drive every delivery route in the county', 'Restore an old motorbike'],
    bio: 'Miles knows every pothole between Willowbrook and Ashford and talks to his van more than to most people. He is saving for a motorbike he insists is a sensible investment.',
    likes: ['practical', 'tool', 'coffee', 'city_life'], dislikes: ['quiet', 'fashion'],
    romanceable: true, schedule: workSchedule({ home: LOC.home, work: LOC.warehouse, workStart: 7, workEnd: 16, workDays: ALL_WEEK, leisureLocation: LOC.river }),
    relationships: [rel('resident_14', 35, 30, 15, 'friend')],
  },
  {
    index: 2, name: 'Rowan Finch', age: 44, lifeStage: 'adult', occupation: 'Carpenter',
    home: LOC.countryside, work: LOC.warehouse, money: 33000,
    personality: { extroversion: 0.45, caution: 0.55, generosity: 0.6, curiosity: 0.5, responsibility: 0.85, workTendency: 0.85, spendingTendency: 0.3 },
    appearance: { primaryColor: '#7a5c3a', secondaryColor: '#c9b48e', hairColor: '#5a4632', skinTone: '#d9ab7e', accessory: 'sawdust-apron' },
    interests: ['craft', 'making', 'wood', 'practical', 'community'],
    goals: ['Build a proper dining table for the cottage', 'Teach someone the trade properly'],
    bio: 'Rowan can fix a fence, a chair and most of the village if given a morning and a mug of tea. He and Kezia share a cottage full of half-finished projects.',
    likes: ['wood', 'tool', 'practical', 'ale'], dislikes: ['fashion', 'city_life'],
    romanceable: false, schedule: workSchedule({ home: LOC.countryside, work: LOC.warehouse, workStart: 8, workEnd: 17, workDays: WEEKDAYS, leisureLocation: LOC.park }),
    relationships: [rel('resident_17', 60, 55, 45, 'close_friend'), rel(NPC.rufusMarsh, 25, 28, 10, 'friend')],
  },
  {
    index: 3, name: 'Hattie Blume', age: 68, lifeStage: 'elder', occupation: 'Retired teacher',
    home: LOC.home, work: LOC.library, money: 44000,
    personality: { extroversion: 0.5, generosity: 0.7, curiosity: 0.7, responsibility: 0.7, caution: 0.6, socialNeed: 0.5 },
    appearance: { primaryColor: '#a88bb5', secondaryColor: '#efe4cf', hairColor: '#d5d0c8', skinTone: '#e2bb96', outfitStyle: 'elder', accessory: 'knitting-bag' },
    interests: ['books', 'poetry', 'community', 'quiet', 'history'],
    goals: ['Read every book in the library', 'Keep the school reading circle alive'],
    bio: 'Hattie taught three generations of Willowbrook children their letters and still keeps a reading circle going at the library. She is the only person who can quieten a room with a raised eyebrow.',
    likes: ['book', 'poetry', 'tea', 'handmade'], dislikes: ['loud', 'fashion'],
    romanceable: false, schedule: retiredSchedule({ home: LOC.home, market: LOC.market, cafe: LOC.cafe, library: LOC.library, garden: LOC.greenhouse }),
    relationships: [rel('resident_11', 55, 50, 35, 'close_friend')],
  },
  {
    index: 4, name: 'Gus Merrick', age: 52, lifeStage: 'adult', occupation: 'Mechanic',
    home: LOC.countryside, work: LOC.warehouse, money: 29000,
    personality: { extroversion: 0.4, caution: 0.55, generosity: 0.45, curiosity: 0.4, responsibility: 0.8, workTendency: 0.9, independence: 0.65 },
    appearance: { primaryColor: '#4a4f55', secondaryColor: '#a8743f', hairColor: '#3b3b3b', skinTone: '#cf9d75', accessory: 'oil-rag' },
    interests: ['practical', 'work', 'errands', 'quiet'],
    goals: ['Keep every engine in the county running', 'Train Idris to take over the tools'],
    bio: 'Gus keeps the village engines running from a shed behind the warehouse and has little patience for anything he cannot take apart. He is secretly proud of his apprentice Idris.',
    likes: ['tool', 'practical', 'ale', 'wood'], dislikes: ['fashion', 'candle'],
    romanceable: false, schedule: workSchedule({ home: LOC.countryside, work: LOC.warehouse, workStart: 7.5, workEnd: 16.5, workDays: WEEKDAYS, leisureLocation: LOC.river }),
    relationships: [rel('resident_41', 38, 40, 15, 'friend')],
  },
  {
    index: 5, name: 'Tilly Vane', age: 10, lifeStage: 'child', occupation: 'School pupil',
    home: LOC.home, work: LOC.library, money: 700,
    personality: { extroversion: 0.75, adventure: 0.7, curiosity: 0.85, generosity: 0.5, caution: 0.3, responsibility: 0.5 },
    appearance: { primaryColor: '#e4a3c0', secondaryColor: '#f7e6c8', hairColor: '#8a5a2e', skinTone: '#e9c3a0', accessory: 'pocket-frog', scale: 0.82 },
    interests: ['animals', 'stories', 'outdoors', 'friends'],
    goals: ['Find a frog for the pond', 'Read the whole shelf of adventure books'],
    bio: 'Tilly is convinced the village pond holds a secret and spends most of her spare time investigating it. She brings home pockets full of stones and stories.',
    likes: ['toy', 'sweet', 'bird', 'flower'], dislikes: ['practical', 'quiet'],
    romanceable: false, schedule: schoolSchedule({ home: LOC.home, school: LOC.library, schoolStart: 8.5, schoolEnd: 15, days: WEEKDAYS, leisureLocation: LOC.park, child: true }),
    relationships: [rel('resident_26', 65, 70, 50, 'family')],
  },
  {
    index: 6, name: 'Arthur Penhallow', age: 74, lifeStage: 'elder', occupation: 'Retired postman',
    home: LOC.home, work: LOC.postOffice, money: 39000,
    personality: { extroversion: 0.55, caution: 0.6, generosity: 0.7, curiosity: 0.5, responsibility: 0.75, socialNeed: 0.55 },
    appearance: { primaryColor: '#5c6b8a', secondaryColor: '#d8cdb8', hairColor: '#d8d8d8', skinTone: '#e0b891', outfitStyle: 'elder', accessory: 'walking-stick' },
    interests: ['walking', 'weather', 'birds', 'gossip'],
    goals: ['Walk the old postal route once more', 'Keep feeding the sparrows by the station'],
    bio: 'Arthur delivered letters in Willowbrook for forty years before Harold took over, and the two old postmen still compare routes. He feeds the sparrows outside the station every morning.',
    likes: ['bird', 'letter', 'tea', 'bread'], dislikes: ['city_life', 'loud'],
    romanceable: false, schedule: retiredSchedule({ home: LOC.home, market: LOC.market, cafe: LOC.cafe, library: LOC.library, garden: LOC.park }),
    relationships: [rel('resident_36', 30, 30, 15, 'friend')],
  },
  {
    index: 7, name: 'Beatrix Loom', age: 38, lifeStage: 'adult', occupation: 'Seamstress',
    home: LOC.home, work: LOC.market, money: 19000,
    personality: { extroversion: 0.55, artisticTendency: 0.85, curiosity: 0.6, generosity: 0.55, responsibility: 0.6, spendingTendency: 0.35 },
    appearance: { primaryColor: '#a86b8c', secondaryColor: '#e8d7c0', hairColor: '#6b3a2a', skinTone: '#d9a87e', accessory: 'pin-cushion' },
    interests: ['craft', 'fashion', 'art', 'bargains'],
    goals: ['Sew a dress worthy of the festival', 'Save enough to rent a proper stall'],
    bio: 'Beatrix mends half the village clothes and quietly designs a better wardrobe for the other half. She runs a fabric stall at the market on Saturdays.',
    likes: ['handmade', 'fashion', 'candle', 'tea'], dislikes: ['tool', 'city_life'],
    romanceable: true, schedule: workSchedule({ home: LOC.home, work: LOC.market, workStart: 9, workEnd: 16, workDays: [1, 3, 5], leisureLocation: LOC.park, restDayLocation: LOC.plaza }),
    relationships: [rel('resident_27', 28, 30, 12, 'friend')],
  },
  {
    index: 8, name: 'Callum Ridge', age: 22, lifeStage: 'adult', occupation: 'Farmhand',
    home: LOC.countryside, work: LOC.farm, money: 12000,
    personality: { extroversion: 0.6, adventure: 0.55, caution: 0.35, generosity: 0.55, curiosity: 0.4, responsibility: 0.6, workTendency: 0.85 },
    appearance: { primaryColor: '#8a7a4f', secondaryColor: '#d0b98d', hairColor: '#c9a15a', skinTone: '#d8a878', accessory: 'straw-hat' },
    interests: ['farming', 'outdoors', 'music', 'friends'],
    goals: ['Save for a share of the farm', 'Win the harvest ploughing match'],
    bio: 'Callum has worked Ada fields since he was fourteen and dreams of owning a strip of his own one day. He plays a battered guitar in the barn when the work is done.',
    likes: ['farm_produce', 'cider', 'music', 'practical'], dislikes: ['fashion', 'quiet'],
    romanceable: true, schedule: workSchedule({ home: LOC.countryside, work: LOC.farm, workStart: 6.5, workEnd: 15, workDays: ALL_WEEK, leisureLocation: LOC.park }),
    relationships: [rel('resident_21', 25, 25, 10, 'friend'), rel(NPC.adaQuinn, 30, 32, 12, 'friend')],
  },
  {
    index: 9, name: 'Delia Moss', age: 47, lifeStage: 'adult', occupation: 'Cafe cook',
    home: LOC.home, work: LOC.cafe, money: 23000,
    personality: { extroversion: 0.5, caution: 0.5, generosity: 0.7, curiosity: 0.45, responsibility: 0.85, workTendency: 0.85, spendingTendency: 0.3 },
    appearance: { primaryColor: '#c47a4a', secondaryColor: '#f0e0c4', hairColor: '#5c3f2a', skinTone: '#d8a87c', accessory: 'cook-apron' },
    interests: ['cooking', 'food', 'community', 'gossip'],
    goals: ['Perfect the cafe soup of the day', 'Feed every hungry person in the village once'],
    bio: 'Delia has cooked at the cafe longer than Sylvia has owned it and treats the kitchen as her personal kingdom. She keeps a notebook of soups and a spare loaf for anyone who needs one.',
    likes: ['bread', 'cheese', 'farm_produce', 'practical'], dislikes: ['fashion', 'loud'],
    romanceable: false, schedule: workSchedule({ home: LOC.home, work: LOC.cafe, workStart: 6.5, workEnd: 14.5, workDays: ALL_WEEK, leisureLocation: LOC.market }),
    relationships: [rel('resident_24', 32, 32, 18, 'friend')],
  },
  {
    index: 10, name: 'Elsie Craddock', age: 81, lifeStage: 'elder', occupation: 'Retired librarian',
    home: LOC.home, work: LOC.library, money: 41000,
    personality: { extroversion: 0.3, curiosity: 0.8, generosity: 0.6, caution: 0.7, responsibility: 0.65, independence: 0.7 },
    appearance: { primaryColor: '#8b8aa5', secondaryColor: '#ece3d2', hairColor: '#e8e8e8', skinTone: '#e6c3a2', outfitStyle: 'elder', accessory: 'shopping-basket' },
    interests: ['books', 'quiet', 'history', 'tea'],
    goals: ['Finish the library jigsaw', 'Pass on her recipe for elderflower cordial'],
    bio: 'Elsie worked beside Eliza at the library for thirty years and still arrives on Tuesdays to help with the returns. She is the person to ask about the village as it used to be.',
    likes: ['book', 'tea', 'quiet', 'handmade'], dislikes: ['loud', 'city_life'],
    romanceable: false, schedule: retiredSchedule({ home: LOC.home, market: LOC.market, cafe: LOC.cafe, library: LOC.library, garden: LOC.park }),
    relationships: [rel('resident_32', 30, 32, 15, 'friend')],
  },
  {
    index: 11, name: 'Felix Otter', age: 26, lifeStage: 'adult', occupation: "Fisherman's apprentice",
    home: LOC.countryside, work: LOC.lake, money: 15000,
    personality: { extroversion: 0.45, adventure: 0.7, caution: 0.4, generosity: 0.6, curiosity: 0.55, independence: 0.75, workTendency: 0.75 },
    appearance: { primaryColor: '#5f8a8a', secondaryColor: '#d9c8a0', hairColor: '#7a4a2a', skinTone: '#d9a87e', outfitStyle: 'outdoor', accessory: 'tackle-box' },
    interests: ['fishing', 'water', 'outdoors', 'animals'],
    goals: ['Catch a fish bigger than Silas has', 'Learn to mend a river net'],
    bio: 'Felix is Silas apprentice on the river and takes the job more seriously than his teacher expected. He still gets excited about every catch, however small.',
    likes: ['fish', 'fresh_fish', 'river', 'cider'], dislikes: ['city_life', 'fashion'],
    romanceable: true, schedule: workSchedule({ home: LOC.countryside, work: LOC.lake, workStart: 5.5, workEnd: 13, workDays: ALL_WEEK, leisureLocation: LOC.river }),
    relationships: [rel('resident_25', 42, 38, 20, 'friend'), rel(NPC.finnHolloway, 40, 38, 20, 'friend')],
  },
  {
    index: 12, name: 'Gemma Pike', age: 31, lifeStage: 'adult', occupation: 'Community nurse',
    home: LOC.apartments, work: LOC.culturalCenter, money: 34000,
    personality: { extroversion: 0.65, caution: 0.5, generosity: 0.8, curiosity: 0.6, responsibility: 0.9, socialNeed: 0.6, spendingTendency: 0.4 },
    appearance: { primaryColor: '#6fa3b0', secondaryColor: '#f0eee6', hairColor: '#4a3a2a', skinTone: '#c98f66', accessory: 'medical-bag' },
    interests: ['community', 'socialising', 'books', 'gossip'],
    goals: ['Keep the village clinic running', 'Raise money for a new community defibrillator'],
    bio: 'Gemma runs the weekly village clinic in the cultural centre and visits anyone who cannot get to it. She has a way of making a worrying symptom sound like a manageable problem.',
    likes: ['tea', 'book', 'flower', 'handmade'], dislikes: ['loud', 'ale'],
    romanceable: true, schedule: workSchedule({ home: LOC.apartments, work: LOC.culturalCenter, workStart: 9, workEnd: 17, workDays: WEEKDAYS, leisureLocation: LOC.cityPark }),
    relationships: [rel('resident_26', 30, 28, 12, 'friend'), rel(NPC.ninaOkoye, 20, 22, 8, 'acquaintance')],
  },
  {
    index: 13, name: 'Hugo Temple', age: 58, lifeStage: 'adult', occupation: 'Train conductor',
    home: LOC.home, work: LOC.trainStation, money: 35000,
    personality: { extroversion: 0.5, caution: 0.65, generosity: 0.55, curiosity: 0.4, responsibility: 0.85, workTendency: 0.8 },
    appearance: { primaryColor: '#2f4a6a', secondaryColor: '#d8c9a4', hairColor: '#5c5c5c', skinTone: '#d8a87c', accessory: 'conductor-cap' },
    interests: ['travel', 'practical', 'weather', 'work'],
    goals: ['Never miss a departure announcement', 'Ride the last train of the season to the coast'],
    bio: 'Hugo has announced every departure from Willowbrook station for decades and still says it as though the platform is full. He keeps the timetable in his head and a spare whistle in his pocket.',
    likes: ['practical', 'coffee', 'tool', 'city_life'], dislikes: ['fashion', 'candle'],
    romanceable: false, schedule: workSchedule({ home: LOC.home, work: LOC.trainStation, workStart: 7, workEnd: 15, workDays: ALL_WEEK, leisureLocation: LOC.plaza }),
    relationships: [rel('resident_20', 55, 60, 40, 'family')],
  },
  {
    index: 14, name: 'Isla Wren', age: 17, lifeStage: 'teen', occupation: 'Student',
    home: LOC.home, work: LOC.library, money: 1500,
    personality: { extroversion: 0.65, adventure: 0.5, caution: 0.4, curiosity: 0.75, generosity: 0.55, responsibility: 0.55 },
    appearance: { primaryColor: '#5a8fb0', secondaryColor: '#e8dcc0', hairColor: '#3a2a1f', skinTone: '#e0b088', accessory: 'headphones', scale: 0.95 },
    interests: ['music', 'friends', 'art', 'city_life'],
    goals: ['Pass the exams and get into the Ashford art course', 'Learn three songs on the guitar'],
    bio: 'Isla is counting the days until she can study art in Ashford and spends her free hours drawing in the margins of her notebooks. She and Yarrow are inseparable.',
    likes: ['music', 'art', 'sweet', 'fashion'], dislikes: ['practical', 'quiet'],
    romanceable: false, schedule: schoolSchedule({ home: LOC.home, school: LOC.library, schoolStart: 9, schoolEnd: 15.5, days: WEEKDAYS, leisureLocation: LOC.park }),
    relationships: [rel('resident_31', 35, 30, 18, 'friend')],
  },
  {
    index: 15, name: 'Jonah Beck', age: 24, lifeStage: 'adult', occupation: 'Barista',
    home: LOC.apartments, work: LOC.cityCafe, money: 16000,
    personality: { extroversion: 0.7, adventure: 0.45, caution: 0.35, generosity: 0.6, curiosity: 0.5, socialNeed: 0.7, spendingTendency: 0.55 },
    appearance: { primaryColor: '#3f6b5a', secondaryColor: '#e8d4b0', hairColor: '#2a1f1a', skinTone: '#c99063', accessory: 'coffee-towel' },
    interests: ['coffee', 'music', 'city_life', 'socialising'],
    goals: ['Learn latte art well enough to compete', 'Save for a proper espresso machine'],
    bio: 'Jonah makes the best flat white in Ashford, or at least he says so, and practices latte hearts after closing. He and Jasper argue about music with great enthusiasm and no malice.',
    likes: ['coffee', 'music', 'sweet', 'city_life'], dislikes: ['quiet', 'practical'],
    romanceable: true, schedule: workSchedule({ home: LOC.apartments, work: LOC.cityCafe, workStart: 7.5, workEnd: 16, workDays: WEEKDAYS, leisureLocation: LOC.cityPark }),
    relationships: [rel('resident_30', 30, 28, 15, 'friend'), rel(NPC.jasperKim, 30, 30, 12, 'friend')],
  },
  {
    index: 16, name: 'Kezia Downing', age: 36, lifeStage: 'adult', occupation: 'Gardener',
    home: LOC.countryside, work: LOC.greenhouse, money: 18000,
    personality: { extroversion: 0.5, adventure: 0.45, caution: 0.5, generosity: 0.6, curiosity: 0.65, responsibility: 0.7, workTendency: 0.85 },
    appearance: { primaryColor: '#6f8f4a', secondaryColor: '#e0d4a8', hairColor: '#b87a3a', skinTone: '#e0b088', accessory: 'garden-gloves' },
    interests: ['gardening', 'plants', 'outdoors', 'quiet'],
    goals: ['Grow the best pumpkins on the lane', 'Make the cottage garden self-sufficient in herbs'],
    bio: 'Kezia tends the greenhouse beds and her own overstuffed cottage garden with the same stubborn patience. She and Rowan have a greenhouse full of experiments and a kitchen full of seedlings.',
    likes: ['plant', 'seed', 'herb', 'tea'], dislikes: ['city_life', 'fashion'],
    romanceable: false, schedule: workSchedule({ home: LOC.countryside, work: LOC.greenhouse, workStart: 8, workEnd: 16, workDays: WEEKDAYS, leisureLocation: LOC.forest }),
    relationships: [rel('resident_37', 25, 25, 10, 'friend')],
  },
  {
    index: 17, name: 'Linus Voss', age: 45, lifeStage: 'adult', occupation: 'Museum guard',
    home: LOC.cityResidential, work: LOC.museum, money: 27000,
    personality: { extroversion: 0.35, caution: 0.7, generosity: 0.5, curiosity: 0.6, responsibility: 0.85, independence: 0.6 },
    appearance: { primaryColor: '#3a4a5c', secondaryColor: '#c9c2b0', hairColor: '#5c5c5c', skinTone: '#c99063', outfitStyle: 'formal', accessory: 'museum-badge' },
    interests: ['history', 'quiet', 'practical', 'errands'],
    goals: ['Learn the story behind every exhibit', 'Keep the museum floors spotless'],
    bio: 'Linus guards the Ashford Museum with the patience of a man who has seen every visitor type and a soft spot for the ones who actually read the labels. He knows more museum trivia than some of the curators.',
    likes: ['antique', 'history', 'tea', 'quiet'], dislikes: ['loud', 'fashion'],
    romanceable: false, schedule: workSchedule({ home: LOC.cityResidential, work: LOC.museum, workStart: 9.5, workEnd: 17.5, workDays: [1, 2, 3, 4, 5, 6], leisureLocation: LOC.cityPark }),
    relationships: [rel('resident_35', 28, 26, 12, 'friend')],
  },
  {
    index: 18, name: 'Mira Solano', age: 28, lifeStage: 'adult', occupation: 'Artist',
    home: LOC.apartments, work: LOC.cityPark, money: 11000,
    personality: { extroversion: 0.6, adventure: 0.6, caution: 0.25, artisticTendency: 0.95, curiosity: 0.85, generosity: 0.55, spendingTendency: 0.6 },
    appearance: { primaryColor: '#c47ba0', secondaryColor: '#f0dfc0', hairColor: '#2a1f2a', skinTone: '#d9a87e', outfitStyle: 'artsy', accessory: 'paintbrush' },
    interests: ['art', 'city_life', 'music', 'friends'],
    goals: ['Paint the whole market square in one afternoon', 'Sell a painting for real money'],
    bio: 'Mira paints cityscapes on the same bench in the city park every morning and sells the occasional canvas to surprised passers-by. She talks about colour the way other people talk about weather.',
    likes: ['art', 'handmade', 'city_life', 'fruit'], dislikes: ['practical', 'tool'],
    romanceable: true, schedule: freeSchedule({ home: LOC.apartments, studio: LOC.cityPark, cafe: LOC.cityCafe, library: LOC.cityLibrary }),
    relationships: [rel('resident_30', 45, 40, 22, 'close_friend')],
  },
  {
    index: 19, name: 'Ned Sowerby', age: 66, lifeStage: 'elder', occupation: 'Retired train driver',
    home: LOC.home, work: LOC.trainStation, money: 47000,
    personality: { extroversion: 0.55, caution: 0.6, generosity: 0.65, curiosity: 0.45, responsibility: 0.75, socialNeed: 0.55 },
    appearance: { primaryColor: '#5c6b8a', secondaryColor: '#d8cdb8', hairColor: '#d0d0d0', skinTone: '#dbb08d', outfitStyle: 'elder', accessory: 'pocket-watch' },
    interests: ['practical', 'travel', 'gossip', 'weather'],
    goals: ['See the new express train run', 'Keep the station garden tidy'],
    bio: 'Ned drove the coastal line for thirty-five years and still turns up at the station to watch the trains he no longer drives. He and Hugo can talk timetables for hours.',
    likes: ['practical', 'tea', 'tool', 'city_life'], dislikes: ['loud', 'fashion'],
    romanceable: false, schedule: retiredSchedule({ home: LOC.home, market: LOC.market, cafe: LOC.cafe, library: LOC.library, garden: LOC.plaza }),
    relationships: [],
  },
  {
    index: 20, name: 'Opal Fairweather', age: 17, lifeStage: 'teen', occupation: 'Student',
    home: LOC.apartments, work: LOC.cityLibrary, money: 1800,
    personality: { extroversion: 0.45, adventure: 0.5, caution: 0.45, curiosity: 0.8, generosity: 0.6, responsibility: 0.6, introversion: 0.55 },
    appearance: { primaryColor: '#7a6fa8', secondaryColor: '#e8dcc8', hairColor: '#6b4a8a', skinTone: '#e0b896', accessory: 'sketchbook', scale: 0.95 },
    interests: ['history', 'books', 'art', 'museums'],
    goals: ['Get a museum volunteering placement', 'Finish her project on the old railway'],
    bio: 'Opal spends her study breaks in the museum archive, chasing the history of the railway line for a school project. She is shy until someone asks her about the past, and then she is unstoppable.',
    likes: ['book', 'history', 'museum', 'tea'], dislikes: ['loud', 'fashion'],
    romanceable: false, schedule: schoolSchedule({ home: LOC.apartments, school: LOC.cityLibrary, schoolStart: 9, schoolEnd: 15.5, days: WEEKDAYS, leisureLocation: LOC.cityPark }),
    relationships: [rel('resident_33', 60, 65, 45, 'family'), rel(NPC.penelopeVance, 18, 20, 5, 'acquaintance')],
  },
  {
    index: 21, name: 'Percy Quill', age: 41, lifeStage: 'adult', occupation: 'Writer',
    home: LOC.home, work: LOC.cityLibrary, money: 14000,
    personality: { extroversion: 0.35, introversion: 0.65, adventure: 0.4, caution: 0.5, generosity: 0.55, curiosity: 0.85, responsibility: 0.6, artisticTendency: 0.85, spendingTendency: 0.3 },
    appearance: { primaryColor: '#6b5a7a', secondaryColor: '#e0d4bc', hairColor: '#4a3a2a', skinTone: '#d9ab7e', outfitStyle: 'artsy', accessory: 'fountain-pen' },
    interests: ['books', 'history', 'quiet', 'cafe', 'local_history'],
    goals: ['Finish the village history column every week', 'Write one story that Eliza approves of'],
    bio: 'Percy writes the weekly village notes for the county paper from a corner of the library and is always one interview behind. He is much funnier in print than in person.',
    likes: ['book', 'letter', 'coffee', 'antique'], dislikes: ['loud', 'fashion'],
    romanceable: true, schedule: freeSchedule({ home: LOC.home, studio: LOC.cityLibrary, cafe: LOC.cafe, library: LOC.cityLibrary }),
    relationships: [rel('resident_40', 35, 38, 18, 'friend')],
  },
  {
    index: 22, name: 'Quinn Mercer', age: 33, lifeStage: 'adult', occupation: 'Post office clerk',
    home: LOC.home, work: LOC.postOffice, money: 20000,
    personality: { extroversion: 0.6, caution: 0.5, generosity: 0.65, curiosity: 0.5, responsibility: 0.8, socialNeed: 0.6, spendingTendency: 0.35 },
    appearance: { primaryColor: '#3f6aa1', secondaryColor: '#e8dcc0', hairColor: '#6b3a2a', skinTone: '#d9a87e', accessory: 'stamp-book' },
    interests: ['stationery', 'letter', 'gossip', 'community'],
    goals: ['Sort the Christmas post without panic', 'Collect a stamp from every county'],
    bio: 'Quinn runs the post office counter with unshakeable cheer and a running commentary on village news. She has the neatest handwriting in Willowbrook and will show you if you ask.',
    likes: ['letter', 'stationery', 'tea', 'handmade'], dislikes: ['loud', 'tool'],
    romanceable: true, schedule: workSchedule({ home: LOC.home, work: LOC.postOffice, workStart: 8.5, workEnd: 17, workDays: WEEKDAYS, leisureLocation: LOC.park }),
    relationships: [rel('resident_32', 25, 28, 10, 'friend')],
  },
  {
    index: 23, name: 'Rosa Bellamy', age: 55, lifeStage: 'adult', occupation: "Baker's assistant",
    home: LOC.home, work: LOC.bakery, money: 22000,
    personality: { extroversion: 0.55, caution: 0.55, generosity: 0.7, curiosity: 0.4, responsibility: 0.85, workTendency: 0.9, artisticTendency: 0.45 },
    appearance: { primaryColor: '#e0c9a8', secondaryColor: '#a86b4a', hairColor: '#8a6a4a', skinTone: '#dbb08d', accessory: 'flour-apron' },
    interests: ['baking', 'food', 'community', 'gossip'],
    goals: ['Learn Otto sourdough starter secret', 'Bake a cake for every village birthday'],
    bio: 'Rosa has worked the bakery ovens alongside Otto for fifteen years and is the only person who can tell him a loaf is overbaked without being glared at. She keeps the birthdays of half the village in her head.',
    likes: ['bread', 'cake', 'sweet', 'tea'], dislikes: ['fashion', 'city_life'],
    romanceable: false, schedule: workSchedule({ home: LOC.home, work: LOC.bakery, workStart: 5, workEnd: 13, workDays: ALL_WEEK, leisureLocation: LOC.cafe }),
    relationships: [rel('resident_33', 45, 50, 35, 'family'), rel(NPC.ottoBramwell, 30, 35, 10, 'friend')],
  },
  {
    index: 24, name: 'Silas Tarn', age: 47, lifeStage: 'adult', occupation: 'River fisherman',
    home: LOC.countryside, work: LOC.river, money: 17000,
    personality: { extroversion: 0.35, adventure: 0.65, caution: 0.5, generosity: 0.5, curiosity: 0.4, independence: 0.85, workTendency: 0.8 },
    appearance: { primaryColor: '#4f6f7f', secondaryColor: '#c9c0a0', hairColor: '#4a4a4a', skinTone: '#cf9d75', outfitStyle: 'outdoor', accessory: 'old-net' },
    interests: ['fishing', 'water', 'quiet', 'weather'],
    goals: ['Mend every net before spring', 'Find the deep pool the old-timers talk about'],
    bio: 'Silas has fished the river since he was a boy and has opinions about every kind of weather and almost nothing else. He is training Felix to be quieter on the bank.',
    likes: ['fish', 'fresh_fish', 'ale', 'practical'], dislikes: ['city_life', 'loud'],
    romanceable: false, schedule: workSchedule({ home: LOC.countryside, work: LOC.river, workStart: 5, workEnd: 13.5, workDays: ALL_WEEK, leisureLocation: LOC.lake }),
    relationships: [rel(NPC.finnHolloway, 35, 35, 18, 'friend')],
  },
  {
    index: 25, name: 'Tessa Forrester', age: 39, lifeStage: 'adult', occupation: 'Primary teacher',
    home: LOC.apartments, work: LOC.culturalCenter, money: 26000,
    personality: { extroversion: 0.65, caution: 0.5, generosity: 0.75, curiosity: 0.7, responsibility: 0.9, socialNeed: 0.6, spendingTendency: 0.35 },
    appearance: { primaryColor: '#6a8fb0', secondaryColor: '#f0e8d4', hairColor: '#b07a4a', skinTone: '#d8a878', accessory: 'chalk-dust' },
    interests: ['books', 'community', 'art', 'friends'],
    goals: ['Take the class on a real nature trip', 'Fill the school bookshelf with new stories'],
    bio: 'Tessa teaches the village children in the cultural centre and can keep twenty of them busy with a story and a piece of chalk. She is Tilly mother and the reason the pond investigation has not been shut down.',
    likes: ['book', 'art', 'sweet', 'handmade'], dislikes: ['loud', 'tool'],
    romanceable: false, schedule: workSchedule({ home: LOC.apartments, work: LOC.culturalCenter, workStart: 8.5, workEnd: 16.5, workDays: WEEKDAYS, leisureLocation: LOC.cityPark }),
    relationships: [],
  },
  {
    index: 26, name: 'Ulysses Pike', age: 66, lifeStage: 'elder', occupation: 'Retired carpenter',
    home: LOC.home, work: LOC.market, money: 36000,
    personality: { extroversion: 0.6, caution: 0.6, generosity: 0.7, curiosity: 0.45, responsibility: 0.7, socialNeed: 0.6 },
    appearance: { primaryColor: '#7a6a4a', secondaryColor: '#d8c9a8', hairColor: '#e0e0e0', skinTone: '#dbb08d', outfitStyle: 'elder', accessory: 'flat-cap' },
    interests: ['community', 'gossip', 'practical', 'market'],
    goals: ['Carve a sign for every village shop', 'Keep the market stalls in good repair'],
    bio: 'Ulysses still fixes the market stall hinges for free and treats the market as his own front room. He can tell you the history of every shop on the square and most of the arguments.',
    likes: ['wood', 'tool', 'tea', 'practical'], dislikes: ['fashion', 'city_life'],
    romanceable: false, schedule: retiredSchedule({ home: LOC.home, market: LOC.market, cafe: LOC.cafe, library: LOC.library, garden: LOC.market }),
    relationships: [],
  },
  {
    index: 27, name: 'Verity Lorne', age: 23, lifeStage: 'adult', occupation: 'Florist apprentice',
    home: LOC.home, work: LOC.flowerShop, money: 9000,
    personality: { extroversion: 0.6, adventure: 0.4, caution: 0.45, generosity: 0.65, curiosity: 0.7, artisticTendency: 0.85, responsibility: 0.65, spendingTendency: 0.45 },
    appearance: { primaryColor: '#d98fb0', secondaryColor: '#f0e0c8', hairColor: '#c98b4b', skinTone: '#f0c8a8', accessory: 'flower-crown' },
    interests: ['flowers', 'art', 'gossip', 'romance'],
    goals: ['Learn every flower name Marigold knows', 'Design a wedding bouquet on her own'],
    bio: 'Verity started at the flower shop two years ago and has already rearranged the window display three times without permission. She has a good eye, a loud laugh and a lot to learn.',
    likes: ['flower', 'plant', 'handmade', 'romantic'], dislikes: ['tool', 'practical'],
    romanceable: true, schedule: workSchedule({ home: LOC.home, work: LOC.flowerShop, workStart: 8, workEnd: 16.5, workDays: ALL_WEEK, leisureLocation: LOC.plaza }),
    relationships: [rel(NPC.marigoldLyle, 35, 38, 18, 'friend')],
  },
  {
    index: 28, name: 'Wilbur Grist', age: 38, lifeStage: 'adult', occupation: 'Market trader',
    home: LOC.countryside, work: LOC.market, money: 25000,
    personality: { extroversion: 0.85, adventure: 0.4, caution: 0.35, generosity: 0.6, curiosity: 0.5, socialNeed: 0.8, spendingTendency: 0.55 },
    appearance: { primaryColor: '#a8743f', secondaryColor: '#e8d8b0', hairColor: '#3a2a1f', skinTone: '#d8a87c', accessory: 'market-cap' },
    interests: ['bargains', 'gossip', 'socialising', 'food'],
    goals: ['Have the loudest stall on market day', 'Save enough to buy a van'],
    bio: 'Wilbur sells vegetables, gossip and unsolicited advice at the Saturday market, often all at once. He has the kind of voice that carries across a square without trying.',
    likes: ['farm_produce', 'cider', 'cheese', 'festival'], dislikes: ['quiet', 'fashion'],
    romanceable: false, schedule: workSchedule({ home: LOC.countryside, work: LOC.market, workStart: 7, workEnd: 14.5, workDays: [0, 2, 4, 5, 6], leisureLocation: LOC.cafe, restDayLocation: LOC.park }),
    relationships: [rel('resident_27', 30, 30, 15, 'friend')],
  },
  {
    index: 29, name: 'Xanthe Moon', age: 30, lifeStage: 'adult', occupation: 'Musician & dancer',
    home: LOC.apartments, work: LOC.culturalCenter, money: 13000,
    personality: { extroversion: 0.85, adventure: 0.75, caution: 0.2, generosity: 0.6, curiosity: 0.6, artisticTendency: 0.95, socialNeed: 0.85, spendingTendency: 0.6 },
    appearance: { primaryColor: '#8a4a8a', secondaryColor: '#e8c04a', hairColor: '#1a1a2a', skinTone: '#c99063', outfitStyle: 'artsy', accessory: 'silver-anklet' },
    interests: ['music', 'art', 'city_life', 'friends', 'celebration'],
    goals: ['Fill the cultural centre for a show', 'Write a piece with Jasper'],
    bio: 'Xanthe dances, sings and organises the culture day revue, usually all in the same week. She has never met a quiet room she could not fill and is the best friend Mira has.',
    likes: ['music', 'art', 'festival', 'romantic'], dislikes: ['quiet', 'practical'],
    romanceable: true, schedule: nightSchedule({ home: LOC.apartments, stage: LOC.culturalCenter, cafe: LOC.cityCafe }),
    relationships: [rel(NPC.edmundHale, 20, 22, 5, 'acquaintance')],
  },
  {
    index: 30, name: 'Yarrow Bell', age: 14, lifeStage: 'teen', occupation: 'Student',
    home: LOC.home, work: LOC.library, money: 1200,
    personality: { extroversion: 0.55, adventure: 0.6, caution: 0.4, curiosity: 0.75, generosity: 0.6, responsibility: 0.5 },
    appearance: { primaryColor: '#6f9e7a', secondaryColor: '#e8dcc0', hairColor: '#b87a4a', skinTone: '#d8a87c', accessory: 'sketchbook', scale: 0.96 },
    interests: ['friends', 'art', 'outdoors', 'music'],
    goals: ['Draw the whole village in one sketchbook', 'Get Isla to actually practise guitar'],
    bio: 'Yarrow is the quieter half of a friendship that gets into a surprising amount of trouble. They draw constantly and give the drawings away to anyone who admires them.',
    likes: ['art', 'handmade', 'sweet', 'flower'], dislikes: ['practical', 'loud'],
    romanceable: false, schedule: schoolSchedule({ home: LOC.home, school: LOC.library, schoolStart: 9, schoolEnd: 15.5, days: WEEKDAYS, leisureLocation: LOC.park }),
    relationships: [rel('resident_42', 28, 25, 12, 'friend')],
  },
  {
    index: 31, name: 'Zinnia Hart', age: 27, lifeStage: 'adult', occupation: 'Library assistant',
    home: LOC.home, work: LOC.library, money: 16000,
    personality: { extroversion: 0.45, caution: 0.5, generosity: 0.65, curiosity: 0.8, responsibility: 0.75, introversion: 0.55, spendingTendency: 0.3 },
    appearance: { primaryColor: '#7a8fb0', secondaryColor: '#f0e6d0', hairColor: '#8a4b2f', skinTone: '#e0b891', accessory: 'library-card' },
    interests: ['books', 'poetry', 'quiet', 'history'],
    goals: ['Reorganise the local history shelf', 'Run the children reading hour better than Hattie'],
    bio: 'Zinnia keeps the library running while Eliza pursues her history and Hattie runs the reading circle. She is the one who actually knows where everything is.',
    likes: ['book', 'poetry', 'tea', 'quiet'], dislikes: ['loud', 'ale'],
    romanceable: true, schedule: workSchedule({ home: LOC.home, work: LOC.library, workStart: 9, workEnd: 17, workDays: [1, 2, 3, 4, 5], leisureLocation: LOC.park }),
    relationships: [rel(NPC.elizaThorne, 30, 32, 15, 'friend')],
  },
  {
    index: 32, name: 'Algie Mullins', age: 71, lifeStage: 'elder', occupation: 'Retired baker',
    home: LOC.home, work: LOC.bakery, money: 34000,
    personality: { extroversion: 0.55, caution: 0.6, generosity: 0.75, curiosity: 0.45, responsibility: 0.7, socialNeed: 0.55 },
    appearance: { primaryColor: '#d8c9a8', secondaryColor: '#8c6a3f', hairColor: '#e0e0e0', skinTone: '#dbb08d', outfitStyle: 'elder', accessory: 'bread-basket' },
    interests: ['baking', 'food', 'gossip', 'community'],
    goals: ['Keep an eye on Otto ovens', 'Bake bread for the winter festival'],
    bio: 'Algie handed the bakery to Otto years ago but still comes in early to drink tea and critique the crusts. He is the village grandfather, whether or not you have a choice in the matter.',
    likes: ['bread', 'pastry', 'tea', 'practical'], dislikes: ['fashion', 'city_life'],
    romanceable: false, schedule: retiredSchedule({ home: LOC.home, market: LOC.market, cafe: LOC.cafe, library: LOC.library, garden: LOC.park }),
    relationships: [rel('resident_36', 30, 35, 15, 'friend')],
  },
  {
    index: 33, name: 'Birdie Larkin', age: 9, lifeStage: 'child', occupation: 'School pupil',
    home: LOC.home, work: LOC.library, money: 500,
    personality: { extroversion: 0.7, adventure: 0.55, caution: 0.35, curiosity: 0.8, generosity: 0.6, responsibility: 0.45 },
    appearance: { primaryColor: '#e8b04a', secondaryColor: '#f7e8c8', hairColor: '#c9a15a', skinTone: '#e9c3a0', accessory: 'ribbon', scale: 0.8 },
    interests: ['animals', 'stories', 'friends', 'outdoors'],
    goals: ['Find a hedgehog for the garden', 'Learn to make biscuits with Algie'],
    bio: 'Birdie follows her grandfather Algie around the bakery and has strong opinions about which biscuits are best. She keeps a list of every bird she has seen from the kitchen window.',
    likes: ['sweet', 'bird', 'toy', 'baked_good'], dislikes: ['practical', 'quiet'],
    romanceable: false, schedule: schoolSchedule({ home: LOC.home, school: LOC.library, schoolStart: 8.5, schoolEnd: 15, days: WEEKDAYS, leisureLocation: LOC.park, child: true }),
    relationships: [rel('resident_33', 60, 65, 45, 'family')],
  },
  {
    index: 34, name: 'Cassian Wells', age: 34, lifeStage: 'adult', occupation: 'Office clerk',
    home: LOC.cityResidential, work: LOC.officeDistrict, money: 32000,
    personality: { extroversion: 0.5, caution: 0.6, generosity: 0.55, curiosity: 0.5, responsibility: 0.85, spendingTendency: 0.45, independence: 0.6 },
    appearance: { primaryColor: '#3e5c76', secondaryColor: '#c9c2b0', hairColor: '#2a2a2a', skinTone: '#6b4a2f', outfitStyle: 'city', accessory: 'briefcase' },
    interests: ['city_life', 'practical', 'music', 'errands'],
    goals: ['Get the Ashford office audit signed off early', 'Run the city half-marathon'],
    bio: 'Cassian keeps the Ashford office accounts in order and his trainers by the door for an evening run. He is quiet at work and unexpectedly funny at the pub afterwards.',
    likes: ['practical', 'coffee', 'music', 'city_life'], dislikes: ['loud', 'fossil'],
    romanceable: true, schedule: workSchedule({ home: LOC.cityResidential, work: LOC.officeDistrict, workStart: 9, workEnd: 17.5, workDays: WEEKDAYS, leisureLocation: LOC.riversideWalk }),
    relationships: [],
  },
  {
    index: 35, name: 'Dot Ivers', age: 79, lifeStage: 'elder', occupation: 'Retired nurse',
    home: LOC.home, work: LOC.park, money: 46000,
    personality: { extroversion: 0.5, caution: 0.65, generosity: 0.8, curiosity: 0.5, responsibility: 0.75, socialNeed: 0.55 },
    appearance: { primaryColor: '#9a8fb5', secondaryColor: '#efe8d8', hairColor: '#e8e8e8', skinTone: '#e6c3a2', outfitStyle: 'elder', accessory: 'walking-stick' },
    interests: ['walking', 'community', 'wildlife', 'gossip'],
    goals: ['Walk the park loop every morning', 'Keep an eye on every elder on the lane'],
    bio: 'Dot was the village nurse for forty years and still notices when someone is not quite well. She walks the park loop every morning and reports back on the ducks.',
    likes: ['flower', 'bird', 'tea', 'community'], dislikes: ['loud', 'city_life'],
    romanceable: false, schedule: retiredSchedule({ home: LOC.home, market: LOC.market, cafe: LOC.cafe, library: LOC.library, garden: LOC.park }),
    relationships: [],
  },
  {
    index: 36, name: 'Emory Gage', age: 42, lifeStage: 'adult', occupation: 'Estate caretaker',
    home: LOC.countryside, work: LOC.abandonedFarmhouse, money: 28000,
    personality: { extroversion: 0.3, caution: 0.65, generosity: 0.45, curiosity: 0.6, independence: 0.85, responsibility: 0.8, workTendency: 0.85 },
    appearance: { primaryColor: '#5a6a4a', secondaryColor: '#c9c0a8', hairColor: '#4a4a4a', skinTone: '#c99063', outfitStyle: 'outdoor', accessory: 'estate-keys' },
    interests: ['practical', 'outdoors', 'quiet', 'history'],
    goals: ['Keep the old farmhouse from falling in', 'Find out who used to own the estate'],
    bio: 'Emory looks after the old farmhouse and the land around it for a landlord nobody has seen in years. He knows every loose slate and has found some interesting things in the barn.',
    likes: ['tool', 'antique', 'wood', 'quiet'], dislikes: ['loud', 'city_life'],
    romanceable: false, schedule: workSchedule({ home: LOC.countryside, work: LOC.abandonedFarmhouse, workStart: 8, workEnd: 16, workDays: ALL_WEEK, leisureLocation: LOC.forest }),
    relationships: [rel('resident_40', 30, 30, 12, 'friend')],
  },
  {
    index: 37, name: 'Flora Pettigrew', age: 25, lifeStage: 'adult', occupation: 'Grocery assistant',
    home: LOC.home, work: LOC.grocery, money: 12000,
    personality: { extroversion: 0.65, adventure: 0.4, caution: 0.45, generosity: 0.65, curiosity: 0.55, socialNeed: 0.65, spendingTendency: 0.4 },
    appearance: { primaryColor: '#8ab06a', secondaryColor: '#f0e4c8', hairColor: '#5a3a2a', skinTone: '#e0b896', accessory: 'pencil-behind-ear' },
    interests: ['flowers', 'friends', 'bargains', 'romance'],
    goals: ['Get promoted to run the evening shift', 'Save for a trip to the coast'],
    bio: 'Flora works the grocery with Ivy and shares her knack for remembering what everyone buys. She has a soft spot for the flower shop window and a long list of places she wants to see.',
    likes: ['flower', 'sweet', 'stationery', 'tea'], dislikes: ['practical', 'loud'],
    romanceable: true, schedule: workSchedule({ home: LOC.home, work: LOC.grocery, workStart: 8, workEnd: 16, workDays: ALL_WEEK, leisureLocation: LOC.plaza }),
    relationships: [],
  },
  {
    index: 38, name: 'Gideon Ashdown', age: 50, lifeStage: 'adult', occupation: 'Shopkeeper',
    home: LOC.cityResidential, work: LOC.convenienceStore, money: 41000,
    personality: { extroversion: 0.5, caution: 0.6, generosity: 0.55, curiosity: 0.35, responsibility: 0.85, workTendency: 0.9, spendingTendency: 0.25 },
    appearance: { primaryColor: '#4a6a5a', secondaryColor: '#d8ccb0', hairColor: '#5c5c5c', skinTone: '#c99063', outfitStyle: 'work', accessory: 'shopkeeper-visor' },
    interests: ['practical', 'errands', 'work', 'city_life'],
    goals: ['Keep the corner shop open through the winter', 'Teach an apprentice the till and the stockroom'],
    bio: 'Gideon runs the Ashford corner shop with a strict till and a soft heart, extending credit to the same three neighbours every month. He knows more about the city than most people who live there.',
    likes: ['practical', 'coffee', 'cheese', 'city_life'], dislikes: ['loud', 'fashion'],
    romanceable: false, schedule: workSchedule({ home: LOC.cityResidential, work: LOC.convenienceStore, workStart: 8, workEnd: 20, workDays: ALL_WEEK, leisureLocation: LOC.cityPark, bedHour: 23.4 }),
    relationships: [rel('resident_35', 25, 25, 10, 'friend')],
  },
  {
    index: 39, name: 'Hesper Ingram', age: 61, lifeStage: 'adult', occupation: 'Retired teacher',
    home: LOC.home, work: LOC.library, money: 37000,
    personality: { extroversion: 0.45, caution: 0.6, generosity: 0.7, curiosity: 0.75, responsibility: 0.7, socialNeed: 0.5 },
    appearance: { primaryColor: '#8a7fa8', secondaryColor: '#ece0cc', hairColor: '#d8d4c8', skinTone: '#e2bb96', outfitStyle: 'elder', accessory: 'book-bag' },
    interests: ['books', 'history', 'quiet', 'local_history'],
    goals: ['Finish the county history index', 'Find the missing almanac alongside Theo'],
    bio: 'Hesper taught history at the Ashford school for thirty years and now spends her retirement in the village archive. She and Percy have a long-running disagreement about how to write a proper local history.',
    likes: ['book', 'history', 'tea', 'letter'], dislikes: ['loud', 'fashion'],
    romanceable: false, schedule: retiredSchedule({ home: LOC.home, market: LOC.market, cafe: LOC.cafe, library: LOC.library, garden: LOC.plaza }),
    relationships: [],
  },
  {
    index: 40, name: 'Idris Kell', age: 20, lifeStage: 'adult', occupation: 'Apprentice mechanic',
    home: LOC.countryside, work: LOC.warehouse, money: 8000,
    personality: { extroversion: 0.5, adventure: 0.5, caution: 0.45, generosity: 0.55, curiosity: 0.6, responsibility: 0.65, workTendency: 0.85 },
    appearance: { primaryColor: '#4a4f55', secondaryColor: '#a8743f', hairColor: '#2a2a2a', skinTone: '#8a5a3b', accessory: 'tool-belt' },
    interests: ['practical', 'work', 'travel', 'friends'],
    goals: ['Strip and rebuild an engine alone', 'Buy a van and see the coast'],
    bio: 'Idris is Gus apprentice and takes to engines faster than anyone expected. He still keeps the first spanner he was given on the shelf beside his bed.',
    likes: ['tool', 'practical', 'cider', 'music'], dislikes: ['fashion', 'quiet'],
    romanceable: true, schedule: workSchedule({ home: LOC.countryside, work: LOC.warehouse, workStart: 7.5, workEnd: 16.5, workDays: WEEKDAYS, leisureLocation: LOC.river }),
    relationships: [],
  },
  {
    index: 41, name: 'Juno Atley', age: 15, lifeStage: 'teen', occupation: 'Student',
    home: LOC.home, work: LOC.library, money: 1000,
    personality: { extroversion: 0.6, adventure: 0.45, caution: 0.5, generosity: 0.6, curiosity: 0.7, responsibility: 0.55, introversion: 0.4 },
    appearance: { primaryColor: '#8a9e5f', secondaryColor: '#e8dcc0', hairColor: '#5a3a2a', skinTone: '#d8a878', accessory: 'library-book', scale: 0.97 },
    interests: ['books', 'friends', 'history', 'music'],
    goals: ['Get top marks in the history exam', 'Finish the school project about the old station'],
    bio: 'Juno is the one who actually remembers the dates in history class and lends their notes to Yarrow every week. They are quietly determined to leave Willowbrook for university one day.',
    likes: ['book', 'history', 'tea', 'stationery'], dislikes: ['loud', 'city_life'],
    romanceable: false, schedule: schoolSchedule({ home: LOC.home, school: LOC.library, schoolStart: 9, schoolEnd: 15.5, days: WEEKDAYS, leisureLocation: LOC.park }),
    relationships: [rel('resident_40', 45, 50, 30, 'family')],
  },
];

const RESIDENT_NPCS: NPCDef[] = RESIDENT_SPECS.map(residentDef);

/** Complete NPC content: 14 majors followed by 42 residents. */
export const NPCS: NPCDef[] = [...MAJOR_NPCS, ...RESIDENT_NPCS];

/** Convenience lookups used by tests and UI. */
export const MAJOR_NPCS_BY_ID: ReadonlyMap<NPCId, NPCDef> = new Map(
  MAJOR_NPCS.map((npc) => [npc.id, npc])
);

export const RESIDENT_NPCS_BY_ID: ReadonlyMap<NPCId, NPCDef> = new Map(
  RESIDENT_NPCS.map((npc) => [npc.id, npc])
);
