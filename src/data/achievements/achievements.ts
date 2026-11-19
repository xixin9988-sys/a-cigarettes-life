import type { AchievementDef } from '../schema';

/**
 * OWNER: Agent 12 (Life & Progression).
 *
 * Every achievement uses a real, game-state-derived trigger evaluated by
 * AchievementSystem. Trigger kinds:
 *  - stat         : a PlayerStatistics key, or a derived lifecycle counter documented in
 *                   src/life/AchievementSystem.ts (perfectCrops, ashUsed, fishSpeciesCount,
 *                   locationsVisited, decorScore, ...). Supports dot paths such as
 *                   "fishSpeciesCaught.fish_moonfish".
 *  - skill        : key is a SkillId, or "any" for the highest skill level.
 *  - collection   : key "total" for the number of collected species, or a specific item id.
 *  - relationship : key "friends" | "close_friends" | "partners" | "known".
 *  - wealth       : key "money" | "moneyEarned" | "influence" | "communityPoints".
 *
 * hidden achievements are not listed until unlocked. rewardInfluence is real influence
 * granted through InfluenceSystem when the achievement unlocks.
 */
export const ACHIEVEMENTS: AchievementDef[] = [
  // --- Fishing ---
  {
    id: 'first_cast',
    title: 'First Catch',
    description: 'Land your very first fish. The river keeps its secrets until you learn to wait.',
    hidden: false,
    trigger: { kind: 'stat', key: 'fishCaught', threshold: 1 },
    rewardInfluence: 3,
    icon: '🎣',
  },
  {
    id: 'ten_fish',
    title: 'Ten on the Line',
    description: 'Catch ten fish. The regulars at the riverbank start nodding to you.',
    hidden: false,
    trigger: { kind: 'stat', key: 'fishCaught', threshold: 10 },
    rewardInfluence: 5,
    icon: '🐟',
  },
  {
    id: 'river_regular',
    title: 'River Regular',
    description: 'Catch five different kinds of fish from the waters around Willowbrook.',
    hidden: false,
    trigger: { kind: 'stat', key: 'fishSpeciesCount', threshold: 5 },
    rewardInfluence: 5,
    icon: '🎏',
  },
  {
    id: 'moonfish',
    title: 'Moonlit Rarity',
    description: 'Catch the moonfish that only rises under a clear night sky.',
    hidden: true,
    trigger: { kind: 'stat', key: 'fishSpeciesCaught.fish_moonfish', threshold: 1 },
    rewardInfluence: 10,
    icon: '🌙',
  },

  // --- Farming / gardening ---
  {
    id: 'green_thumb',
    title: 'Green Thumb',
    description: 'Harvest your first crop from soil you tended yourself.',
    hidden: false,
    trigger: { kind: 'stat', key: 'cropsHarvested', threshold: 1 },
    rewardInfluence: 3,
    icon: '🌱',
  },
  {
    id: 'perfect_crop',
    title: 'Perfection in the Soil',
    description: 'Grow and harvest a five-star crop. Patience, water and a little ash go a long way.',
    hidden: true,
    trigger: { kind: 'stat', key: 'perfectCrops', threshold: 1 },
    rewardInfluence: 6,
    icon: '⭐',
  },
  {
    id: 'bumper_harvest',
    title: 'Bumper Harvest',
    description: 'Bring in fifty crops over your life. The market stall knows your name now.',
    hidden: false,
    trigger: { kind: 'stat', key: 'cropsHarvested', threshold: 50 },
    rewardInfluence: 8,
    icon: '🌾',
  },

  // --- Social ---
  {
    id: 'five_friends',
    title: 'Good Company',
    description: 'Become friends with five of the residents of Willowbrook.',
    hidden: false,
    trigger: { kind: 'relationship', key: 'friends', threshold: 5 },
    rewardInfluence: 6,
    icon: '🤝',
  },
  {
    id: 'close_confidant',
    title: 'Close Confidant',
    description: 'Earn the close friendship of another cigarette.',
    hidden: false,
    trigger: { kind: 'relationship', key: 'close_friends', threshold: 1 },
    rewardInfluence: 6,
    icon: '💬',
  },
  {
    id: 'romance_partner',
    title: 'Two of a Kind',
    description: 'Find someone who wants to walk through this short, bright life beside you.',
    hidden: false,
    trigger: { kind: 'relationship', key: 'partners', threshold: 1 },
    rewardInfluence: 10,
    icon: '❤️',
  },
  {
    id: 'social_butterfly',
    title: 'Social Butterfly',
    description: 'Have twenty-five real conversations with the people around you.',
    hidden: false,
    trigger: { kind: 'stat', key: 'conversations', threshold: 25 },
    rewardInfluence: 5,
    icon: '🦋',
  },
  {
    id: 'generous_soul',
    title: 'Generous Soul',
    description: 'Give ten gifts. A small thing, given often, is how a village becomes a home.',
    hidden: false,
    trigger: { kind: 'stat', key: 'giftsGiven', threshold: 10 },
    rewardInfluence: 5,
    icon: '🎁',
  },

  // --- Business / wealth ---
  {
    id: 'own_business',
    title: 'Shopkeeper',
    description: 'Own a shop of your own. Rent, stock, wages, and the quiet pride of a sign with your name on it.',
    hidden: false,
    trigger: { kind: 'stat', key: 'businessesOwned', threshold: 1 },
    rewardInfluence: 12,
    icon: '🏪',
  },
  {
    id: 'ten_thousand',
    title: 'Ten Thousand Pence',
    description: 'Earn ten thousand pence over the course of one life.',
    hidden: false,
    trigger: { kind: 'stat', key: 'moneyEarned', threshold: 10000 },
    rewardInfluence: 8,
    icon: '🪙',
  },
  {
    id: 'comfortable',
    title: 'Comfortable',
    description: 'Hold one hundred thousand pence at once. Enough to stop counting for a while.',
    hidden: false,
    trigger: { kind: 'wealth', key: 'money', threshold: 100000 },
    rewardInfluence: 12,
    icon: '💰',
  },
  {
    id: 'hard_worker',
    title: 'Honest Work',
    description: 'Work ten full shifts. There is a particular dignity in being expected somewhere.',
    hidden: false,
    trigger: { kind: 'stat', key: 'shiftsWorked', threshold: 10 },
    rewardInfluence: 5,
    icon: '🕰️',
  },

  // --- Archives / influence ---
  {
    id: 'influence_known',
    title: 'Known Face',
    description: 'Reach 50 influence. People in the street greet you without being introduced.',
    hidden: false,
    trigger: { kind: 'wealth', key: 'influence', threshold: 50 },
    rewardInfluence: 6,
    icon: '🔔',
  },
  {
    id: 'influence_pillar',
    title: 'Pillar of the Village',
    description: 'Reach 400 influence. When Willowbrook needs something done, they ask you.',
    hidden: false,
    trigger: { kind: 'wealth', key: 'influence', threshold: 400 },
    rewardInfluence: 15,
    icon: '🏛️',
  },
  {
    id: 'influence_legend',
    title: 'Living Legend',
    description: 'Reach 800 influence. They will tell stories about this cigarette for generations.',
    hidden: true,
    trigger: { kind: 'wealth', key: 'influence', threshold: 800 },
    rewardInfluence: 25,
    icon: '👑',
  },

  // --- Community / festivals ---
  {
    id: 'three_festivals',
    title: 'Life of the Party',
    description: 'Join in three seasonal festivals. Willowbrook remembers who shows up.',
    hidden: false,
    trigger: { kind: 'stat', key: 'festivalsAttended', threshold: 3 },
    rewardInfluence: 8,
    icon: '🎪',
  },
  {
    id: 'community_project',
    title: 'Civic Spirit',
    description: 'See a community project through to completion. Bricks, votes and patience.',
    hidden: false,
    trigger: { kind: 'stat', key: 'communityProjectsCompleted', threshold: 1 },
    rewardInfluence: 10,
    icon: '🧱',
  },
  {
    id: 'home_decor_80',
    title: 'Hearth and Home',
    description: 'Decorate your home to a decoration score of 80. It is worth coming home to.',
    hidden: false,
    trigger: { kind: 'stat', key: 'decorScore', threshold: 0.8 },
    rewardInfluence: 8,
    icon: '🛋️',
  },

  // --- Skills / crafting ---
  {
    id: 'max_skill',
    title: 'Master of One',
    description: 'Reach level 20 in any of the eight life skills.',
    hidden: true,
    trigger: { kind: 'skill', key: 'any', threshold: 20 },
    rewardInfluence: 20,
    icon: '🎖️',
  },
  {
    id: 'bake_cake',
    title: 'Sweet Success',
    description: 'Bake a cake or a pie in your own kitchen.',
    hidden: false,
    trigger: { kind: 'stat', key: 'cakesBaked', threshold: 1 },
    rewardInfluence: 5,
    icon: '🍰',
  },
  {
    id: 'handmade_life',
    title: 'Handmade Life',
    description: 'Craft fifteen things with your own hands.',
    hidden: false,
    trigger: { kind: 'stat', key: 'itemsCrafted', threshold: 15 },
    rewardInfluence: 5,
    icon: '🔨',
  },
  {
    id: 'self_sufficient',
    title: 'Self-Sufficient',
    description: 'Cook ten meals from ingredients you gathered yourself.',
    hidden: false,
    trigger: { kind: 'stat', key: 'mealsCooked', threshold: 10 },
    rewardInfluence: 5,
    icon: '🍲',
  },
  {
    id: 'wild_harvest',
    title: 'Wild Harvest',
    description: 'Forage twenty-five things from the woods, hedgerows and riverbanks.',
    hidden: false,
    trigger: { kind: 'stat', key: 'itemsForaged', threshold: 25 },
    rewardInfluence: 5,
    icon: '🍄',
  },

  // --- Exploration ---
  {
    id: 'first_discovery',
    title: 'Off the Beaten Path',
    description: 'Discover your first hidden secret. Every path has a quieter one beside it.',
    hidden: false,
    trigger: { kind: 'stat', key: 'secretsFound', threshold: 1 },
    rewardInfluence: 3,
    icon: '🔍',
  },
  {
    id: 'keeper_of_secrets',
    title: 'Keeper of Secrets',
    description: 'Discover ten secrets hiding in Willowbrook and Ashford.',
    hidden: true,
    trigger: { kind: 'stat', key: 'secretsFound', threshold: 10 },
    rewardInfluence: 12,
    icon: '🗝️',
  },
  {
    id: 'hidden_places',
    title: 'Hidden Places',
    description: 'Unlock all three of the secret places marked on no map.',
    hidden: true,
    trigger: { kind: 'stat', key: 'secretLocationsFound', threshold: 3 },
    rewardInfluence: 12,
    icon: '🗺️',
  },
  {
    id: 'wanderer',
    title: 'Willowbrook Wanderer',
    description: 'Visit fifteen different locations around the two towns.',
    hidden: false,
    trigger: { kind: 'stat', key: 'locationsVisited', threshold: 15 },
    rewardInfluence: 6,
    icon: '🚶',
  },
  {
    id: 'city_lights',
    title: 'City Lights',
    description: 'Visit thirty-five different locations, from the riverbank to the Ashford high street.',
    hidden: false,
    trigger: { kind: 'stat', key: 'locationsVisited', threshold: 35 },
    rewardInfluence: 8,
    icon: '🌆',
  },
  {
    id: 'photographer',
    title: 'Shutterbug',
    description: 'Take five photographs of the world around you.',
    hidden: false,
    trigger: { kind: 'stat', key: 'photosTaken', threshold: 5 },
    rewardInfluence: 5,
    icon: '📷',
  },

  // --- Life / ash ---
  {
    id: 'survive_7',
    title: 'One Week of Smoke',
    description: 'Keep burning for seven full days without burning out.',
    hidden: false,
    trigger: { kind: 'stat', key: 'daysLived', threshold: 7 },
    rewardInfluence: 5,
    icon: '🕯️',
  },
  {
    id: 'ash_collector',
    title: 'Ash Collector',
    description: 'Collect twenty pinches of your own cigarette ash.',
    hidden: false,
    trigger: { kind: 'stat', key: 'ashCollected', threshold: 20 },
    rewardInfluence: 5,
    icon: '🪶',
  },
  {
    id: 'ashes_to_ashes',
    title: 'Ashes to Ashes',
    description: 'Use cigarette ash as fertiliser, pigment or glaze fifty times.',
    hidden: true,
    trigger: { kind: 'stat', key: 'ashUsed', threshold: 50 },
    rewardInfluence: 8,
    icon: '🌫️',
  },
  {
    id: 'naturalist',
    title: 'Naturalist',
    description: 'Register twenty different species in your collection.',
    hidden: false,
    trigger: { kind: 'collection', key: 'total', threshold: 20 },
    rewardInfluence: 10,
    icon: '🦔',
  },
];

/** Achievement ids in declaration order (handy for UI grids). */
export const ACHIEVEMENT_IDS: readonly string[] = ACHIEVEMENTS.map((achievement) => achievement.id);