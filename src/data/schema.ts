import type {
  CropId,
  EquipmentSlot,
  FishId,
  ItemCategory,
  ItemId,
  JsonValue,
  LocationId,
  BusinessId,
  NPCId,
  QualityStars,
  RecipeId,
  RegionId,
  Season,
  SkillId,
  WeatherType,
  NPCPersonalityValues,
} from '../core/SharedTypes';

// ===========================================================================
// ITEMS
// ===========================================================================
export type ItemShape =
  | 'circle'
  | 'rect'
  | 'leaf'
  | 'fish'
  | 'bottle'
  | 'tool'
  | 'food'
  | 'flower'
  | 'gem'
  | 'book'
  | 'furniture'
  | 'ash'
  | 'key'
  | 'gift'
  | 'egg';

export interface ItemVisual {
  shape: ItemShape;
  color: string;
  accent?: string;
}

export type ItemEffectKind =
  | 'energy'
  | 'hunger'
  | 'fun'
  | 'social'
  | 'mood'
  | 'moisture_down'
  | 'moisture_up'
  | 'burn_slow'
  | 'skill_xp'
  | 'influence'
  | 'luck';

export interface ItemEffect {
  kind: ItemEffectKind;
  value: number;
  skill?: SkillId;
  durationHours?: number;
  description?: string;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  description: string;
  category: ItemCategory;
  /** Base price in integer pence. */
  basePrice: number;
  stackable: boolean;
  maxStack: number;
  /** Whether harvested/crafted instances carry quality stars. */
  hasQuality: boolean;
  tags: string[];
  giftTasteTags?: string[];
  effects?: ItemEffect[];
  equipmentSlot?: EquipmentSlot;
  /** 0..1 reduction of rain moisture gain while equipped. */
  moistureProtection?: number;
  /** 0..1 reduction of wind burn acceleration while equipped. */
  windProtection?: number;
  /** Multiplier applied to base burn rate while equipped. */
  burnRateMultiplier?: number;
  /** Skill a tool supports and its tier. */
  toolSkill?: SkillId;
  toolTier?: number;
  edible?: boolean;
  nutrition?: number;
  /** When this is a seed, the crop it plants. */
  seedCropId?: CropId;
  /** When this is a caught fish, the fish definition. */
  fishId?: FishId;
  /** When this is furniture, the furniture definition. */
  furnitureId?: string;
  /** When this is a recipe scroll/book, recipes it unlocks. */
  unlocksRecipes?: RecipeId[];
  /** When this is a book, the skill xp it grants on read. */
  readSkill?: SkillId;
  visual: ItemVisual;
  /** Designer note: where this item is normally obtained. */
  source?: string;
  /** Rarity 1..5 influences market weight and drop weight. */
  rarity?: QualityStars;
}

// ===========================================================================
// CROPS
// ===========================================================================
export interface CropStageDef {
  name: string;
  /** Game hours of ideal growth for this stage. */
  hours: number;
  /** 0..1 visual height hint for rendering. */
  heightHint: number;
}

export interface CropDef {
  id: CropId;
  name: string;
  seedItemId: ItemId;
  produceItemId: ItemId;
  seasons: Season[];
  stages: CropStageDef[];
  /** Water consumed (0..1 of soil moisture) per game hour. */
  waterPerHour: number;
  tempMin: number;
  tempMax: number;
  /** Minimum soil fertility required for decent quality. */
  fertilityMin: number;
  baseQuality: QualityStars;
  diseaseResistance: number;
  /** Hours to regrow produce after harvest, or 0 for single harvest. */
  regrowHours: number;
  /** Multiplier for potash (cigarette ash) quality bonus. */
  ashAffinity: number;
  baseYield: number;
  description: string;
  visual: ItemVisual;
}

// ===========================================================================
// FISH
// ===========================================================================
export interface FishDef {
  id: FishId;
  name: string;
  description: string;
  /** Location ids or water tags this fish inhabits. */
  habitats: string[];
  seasons: Season[];
  startHour: number;
  endHour: number;
  weathers: WeatherType[];
  /** Relative encounter weight. */
  weight: number;
  minSizeCm: number;
  maxSizeCm: number;
  /** 1..5 minigame difficulty. */
  difficulty: number;
  baseValue: number;
  baitTags: string[];
  skillReq: number;
  rarity: QualityStars;
  visual: ItemVisual;
}

export interface ForageNodeDef {
  id: string;
  name: string;
  locationId: LocationId;
  itemId: ItemId;
  seasons: Season[];
  respawnHours: number;
  skillReq: number;
  yieldMin: number;
  yieldMax: number;
  tags: string[];
  description: string;
}

// ===========================================================================
// RECIPES (crafting + cooking)
// ===========================================================================
export interface RecipeIngredient {
  itemId: ItemId;
  quantity: number;
}

export interface RecipeOutput {
  itemId: ItemId;
  quantity: number;
}

export type RecipeCategory = 'craft' | 'cook';
export type CraftStation = 'workbench' | 'kitchen' | 'campfire' | 'forge' | 'art_studio' | 'none';

export interface RecipeDef {
  id: RecipeId;
  name: string;
  description: string;
  category: RecipeCategory;
  station: CraftStation;
  inputs: RecipeIngredient[];
  outputs: RecipeOutput[];
  /** Game hours required. */
  hours: number;
  skill: SkillId;
  levelReq: number;
  /** Item that unlocks this recipe when obtained/read. Empty = known from start. */
  unlockItemId?: ItemId;
  tags: string[];
  visual: ItemVisual;
}

// ===========================================================================
// EVENTS & FESTIVALS
// ===========================================================================
export type EventConditionDef =
  | { kind: 'season'; seasons: Season[] }
  | { kind: 'weather'; weathers: WeatherType[] }
  | { kind: 'hourRange'; from: number; to: number }
  | { kind: 'dayOfSeason'; days: number[] }
  | { kind: 'locationTag'; tags: string[] }
  | { kind: 'minInfluence'; value: number }
  | { kind: 'minSkill'; skill: SkillId; level: number }
  | { kind: 'maxOccurrences'; eventType: string; max: number }
  | { kind: 'flag'; flag: string; equals: boolean }
  | { kind: 'probability'; chance: number };

export type EventEffectDef =
  | { kind: 'relationship'; target: 'player_best' | 'random_npc' | 'all_known'; delta: { affinity?: number; trust?: number; intimacy?: number } }
  | { kind: 'money'; target: 'player' | 'random_npc'; amount: number }
  | { kind: 'item'; itemId: ItemId; quantity: number }
  | { kind: 'npc_mood'; target: 'random_npc' | 'all_known'; value: number }
  | { kind: 'history'; description: string; importance: number }
  | { kind: 'worldFlag'; flag: string; value: boolean }
  | { kind: 'chainEvent'; eventId: string; chance: number }
  | { kind: 'weather'; weather: WeatherType; durationHours: number };

export interface EventDef {
  id: string;
  title: string;
  description: string;
  category: 'ordinary' | 'interesting' | 'lucky' | 'unlucky' | 'special';
  /** Relative weight within its category. */
  weight: number;
  conditions: EventConditionDef[];
  locationTags: string[];
  minParticipants: number;
  maxParticipants: number;
  cooldownHours: number;
  unique: boolean;
  durationHours: number;
  effects: EventEffectDef[];
  chainId?: string;
  importance: number;
  icon: string;
  tags: string[];
}

export interface FestivalActivityDef {
  id: string;
  label: string;
  description: string;
  minigame?: 'fishing_contest' | 'garden_show' | 'art_exhibition' | 'market_stall' | 'music_performance' | 'costume_parade';
  skill?: SkillId;
  rewardMoney?: number;
  rewardItemId?: ItemId;
}

export interface FestivalDef {
  id: string;
  name: string;
  description: string;
  season: Season;
  dayOfSeason: number;
  startHour: number;
  durationHours: number;
  locationId: LocationId;
  activities: FestivalActivityDef[];
  importance: number;
  npcInterestTags: string[];
  visual: ItemVisual;
}

// ===========================================================================
// LOCATIONS & TRANSPORT
// ===========================================================================
export type LocationKind =
  | 'residence'
  | 'town_center'
  | 'cafe'
  | 'bakery'
  | 'flower_shop'
  | 'grocery'
  | 'bookshop'
  | 'post_office'
  | 'library'
  | 'market'
  | 'plaza'
  | 'park'
  | 'river'
  | 'lake'
  | 'forest'
  | 'farm'
  | 'orchard'
  | 'greenhouse'
  | 'countryside'
  | 'train_station'
  | 'warehouse'
  | 'abandoned_farmhouse'
  | 'hidden_garden'
  | 'secret_path'
  | 'exploration_area'
  | 'commercial_street'
  | 'shopping_mall'
  | 'supermarket'
  | 'convenience_store'
  | 'clothing_shop'
  | 'furniture_shop'
  | 'electronics_shop'
  | 'restaurant'
  | 'city_cafe'
  | 'city_park'
  | 'museum'
  | 'city_library'
  | 'cinema'
  | 'apartments'
  | 'cultural_center'
  | 'riverside_walk'
  | 'city_residential'
  | 'office_district'
  | 'event_square'
  | 'interior';

export type FacilityKind =
  | 'shop'
  | 'cafe'
  | 'bakery'
  | 'library'
  | 'museum'
  | 'workbench'
  | 'kitchen'
  | 'campfire'
  | 'bed'
  | 'storage'
  | 'stage'
  | 'fishing_spot'
  | 'forage'
  | 'train'
  | 'farmland'
  | 'greenhouse'
  | 'heater'
  | 'noticeboard'
  | 'art_studio'
  | 'cinema_screen'
  | 'office_desk'
  | 'shop_counter';

export interface FishSpotDef {
  waterType: 'river' | 'lake' | 'stream' | 'pond' | 'canal';
  /** 0..1 water quality, affects fish rarity and size. */
  quality: number;
}

export interface LocationDef {
  id: LocationId;
  name: string;
  regionId: RegionId;
  kind: LocationKind;
  description: string;
  /** Indoor locations are their own travel nodes shown when entering a building. */
  indoor: boolean;
  /** For interiors: the exterior location this interior belongs to. */
  entranceFrom?: LocationId;
  /** Map tile position for the overworld tile map. */
  mapX: number;
  mapY: number;
  widthTiles: number;
  heightTiles: number;
  /** Travel graph neighbours (exteriors normally; interior connects to entrance). */
  connections: LocationId[];
  /** 0..1 rain/snow protection. */
  shelter: number;
  /** 0..1 wind exposure. */
  windExposure: number;
  humidityModifier: number;
  heatSource: boolean;
  openHour: number;
  closeHour: number;
  facilities: FacilityKind[];
  businessId?: BusinessId;
  fishSpot?: FishSpotDef;
  eventTags: string[];
  forageTags: string[];
  discoverable: boolean;
  secret: boolean;
  /** Required exploration clue count to reveal a secret location. */
  clueRequirement?: number;
  theme: 'town' | 'countryside' | 'forest' | 'indoor' | 'city' | 'water' | 'farm';
  visual: ItemVisual;
  /** Color used to tint the rendered floor. */
  floorColor: string;
  /** Accent color for buildings/decoration. */
  accentColor: string;
}

export interface TrainRouteDef {
  id: string;
  fromLocationId: LocationId;
  toLocationId: LocationId;
  /** Departure hours (24h) on the in-game clock. */
  departHours: number[];
  /** Travel duration in game minutes. */
  durationMinutes: number;
  pricePence: number;
  name: string;
}

// ===========================================================================
// BUSINESSES, JOBS
// ===========================================================================
export type BusinessType =
  | 'cafe'
  | 'bakery'
  | 'flower_shop'
  | 'grocery'
  | 'bookshop'
  | 'post_office'
  | 'library'
  | 'market_stall'
  | 'restaurant'
  | 'supermarket'
  | 'convenience_store'
  | 'clothing_shop'
  | 'furniture_shop'
  | 'electronics_shop'
  | 'cinema'
  | 'museum'
  | 'farm'
  | 'player_shop';

export interface ShopStockSeed {
  itemId: ItemId;
  quantity: number;
  /** Multiplier applied on top of the item base price. */
  priceMultiplier: number;
  /** Target stock for automatic restock. */
  restockTarget: number;
}

export interface JobDefSeed {
  title: string;
  wagePerHour: number;
  startHour: number;
  endHour: number;
  slots: number;
  skill?: SkillId;
  levelReq?: number;
  /** Whether the player can take this job directly (major places). */
  playerAvailable: boolean;
}

export interface BusinessDef {
  id: BusinessId;
  name: string;
  type: BusinessType;
  locationId: LocationId;
  description: string;
  ownerNpcId: NPCId | null;
  initialMoney: number;
  reputation: number;
  priceMarkup: number;
  openHour: number;
  closeHour: number;
  stock: ShopStockSeed[];
  jobs: JobDefSeed[];
  supplierBusinessId?: BusinessId;
}

// ===========================================================================
// NPC DEFINITIONS & SCHEDULES
// ===========================================================================
export interface NPCAppearanceDef {
  primaryColor: string;
  secondaryColor: string;
  hairColor: string;
  skinTone: string;
  outfitStyle: 'casual' | 'work' | 'formal' | 'artsy' | 'outdoor' | 'elder' | 'city';
  accessory: string;
  scale: number;
}

export interface ScheduleSeedEntry {
  /** 0-23, may be fractional (e.g. 8.5). */
  startHour: number;
  endHour: number;
  activity: string;
  locationId?: LocationId;
  /** 0=Monday..6=Sunday; empty means every day. */
  days?: number[];
  /** Probability the NPC follows this entry on a given day (0..1). */
  adherence: number;
}

export interface InitialRelationshipSeed {
  npcId: NPCId;
  affinity: number;
  trust: number;
  intimacy: number;
  status?: 'stranger' | 'acquaintance' | 'friend' | 'close_friend' | 'family' | 'rival';
}

export interface NPCDef {
  id: NPCId;
  name: string;
  age: number;
  lifeStage: 'child' | 'teen' | 'adult' | 'elder';
  personality: NPCPersonalityValues;
  appearance: NPCAppearanceDef;
  occupation: string;
  homeLocationId: LocationId;
  workLocationId: LocationId;
  startingMoney: number;
  interests: string[];
  goals: string[];
  bio: string;
  dialogueTreeId: string;
  scheduleTemplate: ScheduleSeedEntry[];
  initialRelationships: InitialRelationshipSeed[];
  major: boolean;
  /** If true this NPC can be romanced (subject to personality checks). */
  romanceable: boolean;
  /** Gift taste tags this NPC likes. */
  likes: string[];
  dislikes: string[];
}

// ===========================================================================
// DIALOGUE
// ===========================================================================
export type DialogueCondition =
  | { kind: 'affinityMin'; value: number }
  | { kind: 'trustMin'; value: number }
  | { kind: 'intimacyMin'; value: number }
  | { kind: 'status'; statuses: string[] }
  | { kind: 'hasItem'; itemId: ItemId }
  | { kind: 'weather'; weathers: WeatherType[] }
  | { kind: 'season'; seasons: Season[] }
  | { kind: 'hourRange'; from: number; to: number }
  | { kind: 'flag'; flag: string; equals: boolean }
  | { kind: 'moodMin'; value: number }
  | { kind: 'moistureMin'; value: number }
  | { kind: 'seenBefore'; value: boolean }
  | { kind: 'probability'; chance: number };

export type DialogueEffect =
  | { kind: 'relationship'; affinity?: number; trust?: number; intimacy?: number }
  | { kind: 'money'; amount: number }
  | { kind: 'item'; itemId: ItemId; quantity: number }
  | { kind: 'memory'; text: string; importance: number; permanent: boolean }
  | { kind: 'flag'; flag: string; value: boolean }
  | { kind: 'goal'; goalType: string }
  | { kind: 'influence'; amount: number }
  | { kind: 'endConversation' };

export interface DialogueChoice {
  id: string;
  text: string;
  conditions?: DialogueCondition[];
  effects?: DialogueEffect[];
  next?: string;
  once?: boolean;
  /** Optional short label shown on the button. */
  label?: string;
}

export interface DialogueNode {
  id: string;
  text: string;
  /** Dynamic text variants chosen by condition; first matching variant wins. */
  variants?: { conditions: DialogueCondition[]; text: string }[];
  choices?: DialogueChoice[];
  effects?: DialogueEffect[];
  next?: string;
  emotion?: 'happy' | 'sad' | 'angry' | 'surprised' | 'neutral' | 'shy';
  /** Node only valid for these conditions (tree starts at root, branches filter). */
}

export interface DialogueTree {
  id: string;
  npcId?: NPCId;
  rootNodeId: string;
  nodes: Record<string, DialogueNode>;
  /** Fallback greeting nodes selected by relationship status. */
  greetingByStatus?: Record<string, string>;
}

// ===========================================================================
// HOUSING / BUILDING
// ===========================================================================
export type FurnitureSlot = 'floor' | 'wall' | 'surface' | 'outdoor';

export interface FurnitureDef {
  id: string;
  itemId: ItemId;
  name: string;
  description: string;
  slot: FurnitureSlot;
  widthTiles: number;
  heightTiles: number;
  /** Storage capacity in item stacks (0 = not storage). */
  storageSlots: number;
  /** 0..1 comfort bonus for resting. */
  comfort: number;
  /** 0..1 decoration score. */
  decor: number;
  tags: string[];
  visual: ItemVisual;
}

export type BlueprintKind = 'room' | 'greenhouse' | 'farm_facility' | 'home_expansion' | 'store_decoration' | 'garden';

export interface BlueprintDef {
  id: string;
  name: string;
  description: string;
  kind: BlueprintKind;
  inputs: RecipeIngredient[];
  buildHours: number;
  skill: SkillId;
  levelReq: number;
  unlocksRoomId?: string;
  effects: string[];
  visual: ItemVisual;
}

// ===========================================================================
// ACHIEVEMENTS / GOALS / COMMUNITY / COLLECTION
// ===========================================================================
export interface AchievementTrigger {
  kind: 'stat' | 'event' | 'skill' | 'collection' | 'relationship' | 'wealth';
  /** Stat key for 'stat', event type for 'event', skill id for 'skill', etc. */
  key: string;
  threshold: number;
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  hidden: boolean;
  trigger: AchievementTrigger;
  rewardInfluence: number;
  icon: string;
}

export interface PlayerGoalDef {
  id: string;
  title: string;
  description: string;
  category: 'career' | 'social' | 'collection' | 'craft' | 'explore' | 'community' | 'wealth';
  trigger: AchievementTrigger;
  rewardInfluence: number;
  icon: string;
}

export interface CommunityProposalDef {
  id: string;
  title: string;
  description: string;
  locationId: LocationId;
  costPence: number;
  influenceRequired: number;
  supportRequired: number;
  constructionHours: number;
  effects: string[];
  tags: string[];
}

export interface CollectionCategoryDef {
  id: string;
  name: string;
  description: string;
  itemTags: string[];
  icon: string;
}

// ===========================================================================
// WEATHER TABLE
// ===========================================================================
export type WeatherTransitionWeights = Partial<Record<WeatherType, number>>;

export interface WeatherTransitionTable {
  /** season -> current weather -> candidate weather -> weight */
  bySeason: Record<Season, Partial<Record<WeatherType, WeatherTransitionWeights>>>;
}

// ===========================================================================
// CONTENT PACK
// ===========================================================================
export interface ContentPack {
  items: ItemDef[];
  crops: CropDef[];
  fish: FishDef[];
  forageNodes: ForageNodeDef[];
  recipes: RecipeDef[];
  events: EventDef[];
  festivals: FestivalDef[];
  locations: LocationDef[];
  trainRoutes: TrainRouteDef[];
  businesses: BusinessDef[];
  npcs: NPCDef[];
  dialogueTrees: DialogueTree[];
  furniture: FurnitureDef[];
  blueprints: BlueprintDef[];
  achievements: AchievementDef[];
  playerGoals: PlayerGoalDef[];
  communityProposals: CommunityProposalDef[];
  collectionCategories: CollectionCategoryDef[];
  weatherTable: WeatherTransitionTable;
  /** Free-form extra configuration for module tuning. */
  extra?: Record<string, JsonValue>;
}
