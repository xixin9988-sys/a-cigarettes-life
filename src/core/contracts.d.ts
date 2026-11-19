// =============================================================================
// A Cigarette's Life - MASTER SHARED CONTRACT (Agent 0)
// Strict TypeScript interfaces shared by every module. DO NOT modify without
// Agent 0 approval - all modules compile against this file.
// =============================================================================
import type {
  BusinessId,
  CropId,
  DayPhase,
  EntityId,
  EquipmentSlot,
  EventCategory,
  EventId,
  FishId,
  GameTime,
  InventoryEntry,
  ItemId,
  JsonValue,
  LifeId,
  LocationId,
  NPCEmotionsValues,
  NPCId,
  NPCNeedsValues,
  NPCPersonalityValues,
  PlayerId,
  QualityStars,
  RecipeId,
  RegionId,
  RelationshipStatus,
  Season,
  SkillId,
  SocialInteractionKind,
  WeatherType,
  WorldId,
  WorldPosition,
} from './SharedTypes';
import type {
  AchievementDef,
  BlueprintDef,
  BusinessDef,
  CollectionCategoryDef,
  CommunityProposalDef,
  ContentPack,
  CropDef,
  DialogueTree,
  EventDef,
  FestivalDef,
  FishDef,
  ForageNodeDef,
  FurnitureDef,
  ItemDef,
  LocationDef,
  NPCDef,
  PlayerGoalDef,
  RecipeDef,
  TrainRouteDef,
  WeatherTransitionTable,
} from '../data/schema';

// =============================================================================
// 1. ACTION RESULTS & LOGGING
// =============================================================================
export type ActionErrorCode =
  | 'not_found'
  | 'invalid'
  | 'not_enough_money'
  | 'not_enough_items'
  | 'inventory_full'
  | 'not_allowed'
  | 'wrong_location'
  | 'wrong_time'
  | 'on_cooldown'
  | 'busy'
  | 'unsupported'
  | 'locked'
  | 'skill_too_low'
  | 'capacity_reached'
  | 'requirement_not_met'
  | 'not_implemented';

export interface ActionResult {
  ok: boolean;
  message: string;
  code?: ActionErrorCode;
  data?: JsonValue;
  /** True when persistent game state was mutated. */
  stateChanged?: boolean;
}

export interface ILogger {
  debug(message: string, data?: JsonValue): void;
  info(message: string, data?: JsonValue): void;
  warn(message: string, data?: JsonValue): void;
  error(message: string, error?: unknown): void;
}

// =============================================================================
// 2. CLOCK / ENVIRONMENT / WORLD
// =============================================================================
export type GameSpeed = 1 | 2 | 4;
export type GameScreen = 'boot' | 'menu' | 'playing' | 'life_end' | 'offline_summary';

export interface ClockState {
  /** Simulated seconds since world start (Year 1 Spring 1 00:00). */
  simTimeSeconds: number;
  /** Wall-clock timestamp of the last real-time sync. */
  lastRealTimestampMs: number;
  speed: GameSpeed;
  paused: boolean;
  totalRealPlaySeconds: number;
} 

export interface MicroclimateState {
  indoor: boolean;
  /** 0..1 rain/snow protection. */
  shelter: number;
  /** 0..1 wind exposure. */
  windExposure: number;
  humidityModifier: number;
  heatSource: boolean;
}

export interface EnvironmentState {
  season: Season;
  seasonIndex: number;
  dayOfSeason: number;
  year: number;
  weather: WeatherType;
  previousWeather: WeatherType;
  /** Absolute sim time of the next weather transition. */
  nextWeatherChangeAt: number;
  windSpeed: number;
  windDirectionDeg: number;
  /** 0..1 relative humidity. */
  humidity: number;
  /** Degrees Celsius. */
  temperature: number;
  /** 0..1 rain strength. */
  rainIntensity: number;
  /** 0..1 fog density. */
  fogDensity: number;
  /** 0..1 natural daylight. */
  daylight: number;
  /** Recent weather changes for UI/debug. */
  recentWeather: { at: number; weather: WeatherType; temperature: number }[];
}

export interface TrainTicketState {
  id: EntityId;
  routeId: string;
  fromLocationId: LocationId;
  toLocationId: LocationId;
  departSimTime: number;
  arriveSimTime: number;
  pricePence: number;
  purchasedAt: number;
  used: boolean;
}

export interface TrainRideState {
  ticketId: EntityId;
  departSimTime: number;
  arriveSimTime: number;
  fromLocationId: LocationId;
  toLocationId: LocationId;
  status: 'waiting' | 'riding' | 'arrived';
}

export interface TransportState {
  tickets: TrainTicketState[];
  activeRide: TrainRideState | null;
  lastArrivalAt: number;
}

export interface TrainDepartureInfo {
  routeId: string;
  fromLocationId: LocationId;
  toLocationId: LocationId;
  departSimTime: number;
  arriveSimTime: number;
  pricePence: number;
  minutesUntil: number;
}

export interface LocationState {
  id: LocationId;
  name: string;
  regionId: RegionId;
  discovered: boolean;
  unlocked: boolean;
  visitCount: number;
  lastVisitSimTime: number;
  /** NPC ids currently present here. */
  occupants: NPCId[];
  microclimate: MicroclimateState;
  /** 0..1 location upkeep / condition. */
  condition: number;
  lastEventAt: number;
  /** Number of times the player searched this location. */
  searchCount: number;
  /** Discovered secret ids in this location. */
  secretsFound: string[];
}

export interface RegionState {
  id: RegionId;
  name: string;
  unlocked: boolean;
  locationIds: LocationId[];
  discovered: boolean;
}

export interface WorldEvent {
  id: EventId;
  type: string;
  category: EventCategory;
  title: string;
  description: string;
  createdAt: number;
  occurredAt: number;
  locationId?: LocationId;
  participants: NPCId[];
  sourceEventId?: EventId;
  cause: string[];
  result: Record<string, JsonValue>;
  importance: number;
  archived: boolean;
  /** Player has seen this event in the log/notification. */
  acknowledged: boolean;
}

export type WorldHistoryCategory =
  | 'weather'
  | 'economy'
  | 'npc'
  | 'business'
  | 'community'
  | 'festival'
  | 'world'
  | 'player'
  | 'discovery'
  | 'milestone';

export interface WorldHistoryEntry {
  id: EntityId;
  at: number;
  category: WorldHistoryCategory;
  description: string;
  importance: number;
  participantIds: NPCId[];
  locationId?: LocationId;
  relatedEventId?: EventId;
}

export interface WorldState {
  worldId: WorldId;
  seed: number;
  regions: Record<RegionId, RegionState>;
  locations: Record<LocationId, LocationState>;
  environment: EnvironmentState;
  transport: TransportState;
  events: WorldEvent[];
  history: WorldHistoryEntry[];
  worldFlags: Record<string, boolean>;
  /** Last sim time at which the world event scheduler ran. */
  lastWorldTickAt: number;
}

// =============================================================================
// 3. NPC STATE
// =============================================================================
export interface NPCMemoryState {
  id: EntityId;
  type: string;
  text: string;
  participantIds: NPCId[];
  importance: number;
  emotionalValue: number;
  createdAt: number;
  lastRecalledAt: number;
  strength: number;
  permanent: boolean;
}

export interface NPCGoalState {
  id: EntityId;
  type: string;
  label: string;
  progress: number;
  target: number;
  createdAt: number;
  completedAt: number | null;
}

export interface NPCScheduleEntryState {
  startHour: number;
  endHour: number;
  activity: string;
  locationId?: LocationId;
  days?: number[];
  adherence: number;
}

export interface NPCScheduleState {
  entries: NPCScheduleEntryState[];
  /** Day index the schedule was last generated/validated for. */
  lastPlannedDay: number;
}

export interface RelationshipState {
  otherId: EntityId;
  /** -100..100 */
  affinity: number;
  /** 0..100 */
  trust: number;
  /** 0..100 */
  intimacy: number;
  /** 0..100 */
  familiarity: number;
  status: RelationshipStatus;
  firstMetAt: number;
  lastInteractionAt: number;
  interactionCount: number;
  flags: string[];
  /** Per-interaction cooldown keys mapped to sim time when available again. */
  cooldowns: Record<string, number>;
}

export interface NPCState {
  id: NPCId;
  name: string;
  age: number;
  lifeStage: 'child' | 'teen' | 'adult' | 'elder';
  personality: NPCPersonalityValues;
  appearance: {
    primaryColor: string;
    secondaryColor: string;
    hairColor: string;
    skinTone: string;
    outfitStyle: string;
    accessory: string;
    scale: number;
  };
  needs: NPCNeedsValues;
  emotions: NPCEmotionsValues;
  mood: number;
  money: number;
  occupation: string | null;
  jobId: string | null;
  homeLocationId: LocationId;
  workLocationId: LocationId;
  locationId: LocationId;
  currentActivity: string;
  activityStartedAt: number;
  activityEndsAt: number;
  activityTargetNpcId: NPCId | null;
  activityTargetLocationId: LocationId | null;
  /** Recent activity ids, used to avoid repeating the same behaviour. */
  activityHistory: string[];
  decisionCooldownUntil: number;
  relationships: Record<EntityId, RelationshipState>;
  memories: NPCMemoryState[];
  goals: NPCGoalState[];
  schedule: NPCScheduleState;
  interests: string[];
  lifeHistory: { at: number; type: string; description: string; importance: number }[];
  generation: number;
  alive: boolean;
  isMajor: boolean;
  lastUpdatedAt: number;
  /** Module-private extension data (serialisable). */
  extras?: Record<string, JsonValue>;
}

// =============================================================================
// 4. PLAYER STATE
// =============================================================================
export interface CigaretteConditionState {
  /** 1.0 = full cigarette, 0.0 = burnt out (life over). */
  lengthRatio: number;
  /** 0 = dry, 1 = soaked. */
  moisture: number;
  /** Current burn rate multiplier relative to base. */
  burnRate: number;
  /** Whether the player currently stands in shelter. */
  isSheltered: boolean;
  /** Collected but not yet bagged ash. */
  ashAccumulated: number;
  /** Total length (fraction) burned over this life. */
  totalBurned: number;
}

export interface CigaretteAppearance {
  bodyColor: string;
  filterColor: string;
  accessory: string | null;
  face: 'smile' | 'neutral' | 'wink' | 'surprised' | 'sleepy';
  pattern: 'plain' | 'stripe' | 'dots' | 'zigzag';
}

export interface SkillProgressState {
  level: number;
  xp: number;
  xpToNext: number;
  totalXp: number;
  uses: number;
}

export interface PlayerGoalState {
  id: string;
  title: string;
  description: string;
  category: string;
  progress: number;
  target: number;
  completedAt: number | null;
  chosenAt: number;
}

export interface StatusEffectState {
  id: EntityId;
  label: string;
  source: string;
  startedAt: number;
  expiresAt: number | null;
  moveSpeedMultiplier?: number;
  burnRateMultiplier?: number;
  moistureChangePerHour?: number;
  skillXpMultiplier?: number;
  energyRegenPerHour?: number;
}

export interface PlayerStatistics {
  steps: number;
  daysLived: number;
  cropsHarvested: number;
  fishCaught: number;
  fishSpeciesCaught: Record<string, number>;
  fishBiggest: Record<string, number>;
  itemsForaged: number;
  itemsCrafted: number;
  mealsCooked: number;
  itemsBought: number;
  itemsSold: number;
  moneyEarned: number;
  moneySpent: number;
  npcsMet: number;
  conversations: number;
  giftsGiven: number;
  festivalsAttended: number;
  photosTaken: number;
  ashCollected: number;
  furniturePlaced: number;
  secretsFound: number;
  businessesOwned: number;
  shiftsWorked: number;
}

export interface PlayerState {
  id: PlayerId;
  lifeId: LifeId;
  name: string;
  appearance: CigaretteAppearance;
  cigarette: CigaretteConditionState;
  position: WorldPosition;
  money: number;
  inventory: InventoryEntry[];
  equipment: Record<EquipmentSlot, string | null>;
  skills: Record<SkillId, SkillProgressState>;
  relationships: Record<EntityId, RelationshipState>;
  residenceId: LocationId;
  occupation: string | null;
  jobId: string | null;
  influence: number;
  communityPoints: number;
  lifeProgress: number;
  knownRecipes: string[];
  statusEffects: StatusEffectState[];
  statistics: PlayerStatistics;
  /** Sim time of the last completed player activity. */
  lastActionAt: number;
  /** Free-form extension data (serialisable). */
  extras?: Record<string, JsonValue>;
}

// =============================================================================
// 5. ECONOMY
// =============================================================================
export interface MarketGoodState {
  itemId: ItemId;
  basePrice: number;
  currentPrice: number;
  targetStock: number;
  supply: number;
  demand: number;
  seasonalFactor: number;
  trend: number;
  lastUpdatedAt: number;
}

export interface ShopStockEntryState {
  itemId: ItemId;
  quantity: number;
  price: number;
  targetStock: number;
  demandIndex: number;
}

export interface BusinessDayRecord {
  day: number;
  revenue: number;
  expenses: number;
  customers: number;
  stockValue: number;
}

export interface BusinessState {
  id: BusinessId;
  name: string;
  type: string;
  locationId: LocationId;
  ownerNpcId: NPCId | null;
  money: number;
  reputation: number;
  priceMarkup: number;
  openHour: number;
  closeHour: number;
  isOpen: boolean;
  isPlayerOwned: boolean;
  stock: ShopStockEntryState[];
  employees: NPCId[];
  dailyRevenue: number;
  dailyExpenses: number;
  dailyCustomers: number;
  totalRevenue: number;
  history: BusinessDayRecord[];
  lastSettledAt: number;
}

export interface JobState {
  id: EntityId;
  businessId: BusinessId;
  title: string;
  wagePerHour: number;
  startHour: number;
  endHour: number;
  slots: number;
  employeeIds: NPCId[];
  skill?: SkillId;
  levelReq: number;
  playerAvailable: boolean;
  isPlayerJob: boolean;
  lastWorkedAt: number;
}

export interface PlayerShopState {
  businessId: BusinessId;
  name: string;
  regionId: RegionId;
  locationId: LocationId;
  employees: { npcId: NPCId; wagePerHour: number; hiredAt: number }[];
  open: boolean;
  reputation: number;
  totalRevenue: number;
  totalExpenses: number;
  lastSettledAt: number;
}

export interface TransactionRecord {
  id: EntityId;
  at: number;
  type: 'buy' | 'sell' | 'wage' | 'shop_income' | 'shop_expense' | 'gift' | 'reward';
  actorId: EntityId;
  businessId: BusinessId | null;
  itemId: ItemId | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  note: string;
}

export interface EconomyState {
  market: Record<ItemId, MarketGoodState>;
  businesses: Record<BusinessId, BusinessState>;
  jobs: Record<EntityId, JobState>;
  playerShop: PlayerShopState | null;
  economicIndex: number;
  lastMarketSettlementAt: number;
  lastDailySettlementDay: number;
  transactions: TransactionRecord[];
}

// =============================================================================
// 6. GAMEPLAY STATE SLICES
// =============================================================================
export type FarmPlotStage = 'wild' | 'cleared' | 'tilled' | 'planted' | 'mature' | 'withered';

export interface FarmPlotState {
  id: EntityId;
  ownerId: EntityId;
  locationId: LocationId;
  x: number;
  y: number;
  stage: FarmPlotStage;
  cropId: CropId | null;
  /** 0..1 progress through the current growth stage. */
  growth: number;
  growthStage: number;
  plantedAt: number;
  wateredAt: number;
  /** 0..1 soil moisture. */
  moisture: number;
  /** 0..1 soil fertility. */
  fertility: number;
  /** 0..1 potash (cigarette ash) level. */
  potash: number;
  health: number;
  disease: number;
  quality: QualityStars;
  harvests: number;
  lastUpdatedAt: number;
}

export interface GreenhouseState {
  id: EntityId;
  locationId: LocationId;
  ownerId: EntityId;
  plots: EntityId[];
  condition: number;
  builtAt: number;
}

export interface FarmingState {
  plots: Record<EntityId, FarmPlotState>;
  greenhouses: Record<EntityId, GreenhouseState>;
  lastTickAt: number;
}

export type FishingSessionPhase = 'idle' | 'casting' | 'waiting' | 'bite' | 'reeling' | 'landed' | 'escaped';

export interface FishingSessionState {
  locationId: LocationId;
  phase: FishingSessionPhase;
  startedAt: number;
  waitUntil: number;
  targetFishId: FishId | null;
  fishSizeCm: number;
  tension: number;
  progress: number;
  stamina: number;
  rodItemId: ItemId | null;
  baitItemId: ItemId | null;
  lastUpdateAt: number;
  message: string;
}

export interface FishingState {
  session: FishingSessionState | null;
  casts: number;
  catches: number;
  bySpecies: Record<string, number>;
  biggestBySpecies: Record<string, number>;
  lastResultMessage: string;
}

export interface ForageNodeState {
  id: EntityId;
  defId: string;
  locationId: LocationId;
  depleted: boolean;
  respawnAt: number;
  remaining: number;
}

export interface ForagingState {
  nodes: Record<EntityId, ForageNodeState>;
  gatheredToday: number;
  lastResetDay: number;
}

export interface PhotoState {
  id: EntityId;
  title: string;
  description: string;
  takenAt: number;
  locationId: LocationId;
  subjects: string[];
  kind: 'landscape' | 'npc' | 'fish' | 'event' | 'collection';
}

export interface ExplorationLocationState {
  locationId: LocationId;
  searchCount: number;
  lastSearchedAt: number;
  clues: string[];
  discoveredSecretIds: string[];
  photoIds: EntityId[];
}

export interface ExplorationState {
  locations: Record<LocationId, ExplorationLocationState>;
  discoveredSecrets: string[];
  clues: string[];
  lastSearchAt: number;
}

export interface CraftJobState {
  id: EntityId;
  recipeId: RecipeId;
  station: string;
  quantity: number;
  startedAt: number;
  completesAt: number;
}

export interface CraftingState {
  jobs: CraftJobState[];
  mastery: Record<string, number>;
  lastCraftAt: number;
}

export interface CookingState {
  knownRecipes: string[];
  mastery: Record<string, number>;
  lastCookAt: number;
  buffs: StatusEffectState[];
}

export interface BuildProjectState {
  id: EntityId;
  blueprintId: string;
  locationId: LocationId;
  startedAt: number;
  completesAt: number;
  status: 'building' | 'complete' | 'cancelled';
  progress: number;
}

export interface BuildingState {
  projects: BuildProjectState[];
  unlockedBlueprints: string[];
  completedProjects: string[];
}

export interface RoomState {
  id: string;
  name: string;
  widthTiles: number;
  heightTiles: number;
  unlocked: boolean;
  wallColor: string;
  floorStyle: string;
}

export interface PlacedFurnitureState {
  id: EntityId;
  homeId: EntityId;
  furnitureId: string;
  roomId: string;
  x: number;
  y: number;
  rotation: number;
}

export interface HomeState {
  id: EntityId;
  regionId: RegionId;
  locationId: LocationId;
  name: string;
  ownerId: EntityId;
  rooms: RoomState[];
  furniture: PlacedFurnitureState[];
  storage: InventoryEntry[];
  comfort: number;
  decorationScore: number;
  wallColor: string;
  floorStyle: string;
  upgrades: string[];
  gardens: string[];
}

export interface HousingState {
  homes: Record<EntityId, HomeState>;
  ownedHomeIds: EntityId[];
  lastPlacementAt: number;
}

export interface CollectionEntryState {
  itemId: ItemId;
  firstCollectedAt: number;
  count: number;
  bestQuality: QualityStars;
  donated: boolean;
}

export interface CollectionState {
  entries: Record<string, CollectionEntryState>;
  donatedCount: number;
  totalSpeciesKnown: number;
}

// =============================================================================
// 7. SOCIAL
// =============================================================================
export interface InvitationState {
  id: EntityId;
  fromNpcId: NPCId;
  activity: 'walk' | 'coffee' | 'meal' | 'date' | 'festival' | 'help';
  locationId: LocationId;
  proposedAt: number;
  expiresAt: number;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
}

export interface InteractionLogEntry {
  id: EntityId;
  at: number;
  npcId: NPCId;
  kind: SocialInteractionKind;
  summary: string;
  affinityDelta: number;
  trustDelta: number;
  intimacyDelta: number;
}

export interface CommunityProjectState {
  id: EntityId;
  proposalId: string;
  status: 'proposed' | 'voting' | 'approved' | 'rejected' | 'building' | 'complete';
  votesFor: number;
  votesAgainst: number;
  requiredSupport: number;
  startedAt: number;
  completesAt: number | null;
  funded: boolean;
}

export interface DialogueSessionState {
  npcId: NPCId;
  treeId: string;
  nodeId: string;
  startedAt: number;
  choicesShown: number;
  usedChoiceIds: Record<string, boolean>;
}

export interface SocialState {
  invitations: InvitationState[];
  interactionLog: InteractionLogEntry[];
  communityProjects: CommunityProjectState[];
  activeConversation: DialogueSessionState | null;
  lastInteractionAt: number;
  npcSocialLog: { at: number; npcA: NPCId; npcB: NPCId; kind: string; description: string }[];
  lastNpcSocialAt: number;
}

// =============================================================================
// 8. LIFE / ARCHIVE / LEGACY
// =============================================================================
export type LifeArchiveCategory =
  | 'milestone'
  | 'relationship'
  | 'business'
  | 'exploration'
  | 'collection'
  | 'event'
  | 'choice'
  | 'death'
  | 'daily';

export interface LifeArchiveEntry {
  id: EntityId;
  at: number;
  category: LifeArchiveCategory;
  title: string;
  description: string;
  importance: number;
  participantIds: NPCId[];
  locationId?: LocationId;
  photoId?: EntityId;
}

export interface LetterState {
  id: EntityId;
  fromNpcId: NPCId | null;
  subject: string;
  body: string;
  sentAt: number;
  read: boolean;
  attachments: ItemId[];
  sourceEventId?: EventId;
}

export interface AchievementState {
  id: string;
  unlockedAt: number;
}

export interface LifeState {
  lifeId: LifeId;
  generation: number;
  startedAt: number;
  phase: 'alive' | 'ending' | 'ended';
  endReason: string | null;
  endedAt: number | null;
  ageDays: number;
  archive: LifeArchiveEntry[];
  achievements: AchievementState[];
  letters: LetterState[];
  legacyItemIds: ItemId[];
  lastAshCollectedAt: number;
  lastWarnedAt: number;
  /** Whether the player has ever been warned about near-burnout / soaking. */
  warnings: string[];
}

export interface ArchivedPerson {
  npcId: NPCId;
  name: string;
  status: RelationshipStatus;
  affinity: number;
}

export interface ArchivedLife {
  lifeId: LifeId;
  generation: number;
  name: string;
  startedAt: number;
  endedAt: number;
  durationDays: number;
  endReason: string;
  residenceName: string;
  occupation: string | null;
  skills: Record<SkillId, number>;
  finalMoney: number;
  collections: { itemId: ItemId; count: number }[];
  importantPeople: ArchivedPerson[];
  businessHistory: string[];
  archive: LifeArchiveEntry[];
  photos: PhotoState[];
  letters: LetterState[];
  worldChanges: string[];
  choices: string[];
  legacyItemIds: ItemId[];
  statistics: PlayerStatistics;
}

// =============================================================================
// 9. EVENT SYSTEM
// =============================================================================
export interface EventSystemState {
  cooldowns: Record<string, number>;
  occurrences: Record<string, number>;
  activeEventIds: EventId[];
  uniqueTriggered: string[];
  festivals: Record<string, { season: number; day: number; state: 'upcoming' | 'active' | 'ended'; participantCount: number }>;
  lastGlobalEventAt: number;
  categoryWeights: Record<EventCategory, number>;
  pendingNotifications: EventId[];
}

// =============================================================================
// 10. PROBABILITY ENGINE
// =============================================================================
export interface ProbabilityContext {
  worldId: string;
  lifeId: string;
  simulationTime: number;
  locationId?: string;
  weather?: string;
  season?: string;
  actorId?: string;
  targetId?: string;
  environment?: Record<string, unknown>;
  actorState?: Record<string, unknown>;
  history?: string[];
}

export type ConditionExpr =
  | { op: 'and'; args: ConditionExpr[] }
  | { op: 'or'; args: ConditionExpr[] }
  | { op: 'not'; arg: ConditionExpr }
  | { op: 'cmp'; path: string; cmp: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'; value: JsonValue }
  | { op: 'flag'; path: string; equals: boolean }
  | { op: 'contains'; path: string; value: JsonValue }
  | { op: 'always' }
  | { op: 'never' };

export interface ProbabilityModifier {
  id: string;
  kind: 'add' | 'multiply';
  /** Value used when no dynamic resolver is supplied. */
  value: number;
  /** Stable context path resolved to produce the modifier amount, e.g. 'actorState.skillLevel'. */
  path?: string;
  /** Applies the modifier value per unit of the resolved context value. */
  perUnit?: boolean;
  condition?: ConditionExpr;
  source: string;
}

export interface ProbabilityOption<T> {
  id: string;
  baseWeight: number;
  conditions?: ConditionExpr[];
  modifiers?: ProbabilityModifier[];
  result: T;
}

export interface AppliedModifier {
  id: string;
  source: string;
  kind: 'add' | 'multiply';
  amount: number;
  detail: string;
}

export interface EvaluatedCandidate {
  id: string;
  baseWeight: number;
  finalWeight: number;
  probability: number;
  modifiers: AppliedModifier[];
  eligible: boolean;
  rejectionReason: string | null;
}

export interface ProbabilityDecision<T> {
  decisionId: string;
  streamId: string;
  decisionType: string;
  context: ProbabilityContext;
  candidates: EvaluatedCandidate[];
  selectedOptionId: string | null;
  selectedResult: T | null;
  totalWeight: number;
  timestamp: number;
}

export interface ProbabilityDecisionRecord {
  decisionId: string;
  streamId: string;
  decisionType: string;
  context: ProbabilityContext;
  candidates: EvaluatedCandidate[];
  selectedOptionId: string | null;
  timestamp: number;
}

export interface ProbabilityRequest<T> {
  streamId: string;
  decisionType: string;
  context: ProbabilityContext;
  candidates: ProbabilityOption<T>[];
  minWeight?: number;
  maxWeight?: number;
}

export interface ProbabilityStreamStats {
  streamId: string;
  draws: number;
  decisions: number;
  lastValue: number;
}

export interface ProbabilityPersistState {
  version: number;
  seed: number;
  streams: Record<string, number[]>;
  decisionCount: number;
  history: ProbabilityDecisionRecord[];
  traceCounter: number;
}

// =============================================================================
// 11. SETTINGS / META / SAVE
// =============================================================================
export interface GameSettings {
  speed: GameSpeed;
  autosaveIntervalSeconds: number;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  textSpeed: number;
  showProbabilityDebug: boolean;
  showTutorialTips: boolean;
  keybindings: Record<string, string>;
  reducedMotion: boolean;
}

export interface MetaState {
  saveVersion: number;
  gameVersion: string;
  createdAt: number;
  savedAt: number;
  lastRealTimestampMs: number;
  playTimeSeconds: number;
  lastProcessedSimTime: number;
  lifeId: LifeId;
  worldId: WorldId;
  seed: number;
  generation: number;
}

export interface PendingOfflineState {
  lastSaveRealMs: number;
  pendingSummary: OfflineSummary | null;
  lastOfflineSimTime: number;
  offlineLockToken: string | null;
}

export interface OfflineChange {
  kind: 'npc' | 'business' | 'farming' | 'economy' | 'event' | 'relationship' | 'weather' | 'player' | 'world';
  description: string;
  importance: number;
  relatedId?: string;
}

export interface OfflineSummary {
  fromSimTime: number;
  toSimTime: number;
  realElapsedMs: number;
  simulatedGameHours: number;
  headline: string;
  changes: OfflineChange[];
  newEvents: EventId[];
  letters: LetterState[];
  highlights: string[];
  importantNpcUpdates: { npcId: NPCId; name: string; description: string }[];
}

export interface SaveSlotMeta {
  slotId: string;
  worldId: WorldId;
  lifeId: LifeId;
  playerName: string;
  generation: number;
  year: number;
  season: Season;
  dayOfSeason: number;
  money: number;
  playTimeSeconds: number;
  savedAt: number;
  saveVersion: number;
  checksum: string;
}

export interface SaveEnvelope {
  version: number;
  checksum: string;
  savedAtRealMs: number;
  lastProcessedSimTime: number;
  payload: GameState;
}

export interface GameState {
  version: number;
  meta: MetaState;
  clock: ClockState;
  world: WorldState;
  npcs: Record<NPCId, NPCState>;
  player: PlayerState;
  economy: EconomyState;
  farming: FarmingState;
  fishing: FishingState;
  foraging: ForagingState;
  exploration: ExplorationState;
  crafting: CraftingState;
  cooking: CookingState;
  building: BuildingState;
  housing: HousingState;
  collection: CollectionState;
  social: SocialState;
  life: LifeState;
  eventSystem: EventSystemState;
  probability: ProbabilityPersistState;
  settings: GameSettings;
  archive: ArchivedLife[];
  pendingOffline: PendingOfflineState;
  flags: Record<string, boolean>;
}

// =============================================================================
// 12. CONTENT REGISTRY
// =============================================================================
export interface IContentRegistry {
  readonly pack: ContentPack;
  getItem(id: ItemId): ItemDef | undefined;
  getItemOrThrow(id: ItemId): ItemDef;
  getAllItems(): ItemDef[];
  getItemsByTag(tag: string): ItemDef[];
  getCrop(id: CropId): CropDef | undefined;
  getFish(id: FishId): FishDef | undefined;
  getForageNode(id: string): ForageNodeDef | undefined;
  getRecipe(id: RecipeId): RecipeDef | undefined;
  getAllRecipes(): RecipeDef[];
  getEvent(id: string): EventDef | undefined;
  getFestival(id: string): FestivalDef | undefined;
  getLocation(id: LocationId): LocationDef | undefined;
  getLocationOrThrow(id: LocationId): LocationDef;
  getLocationsInRegion(regionId: RegionId): LocationDef[];
  getBusiness(id: BusinessId): BusinessDef | undefined;
  getNPC(id: NPCId): NPCDef | undefined;
  getDialogueTree(id: string): DialogueTree | undefined;
  getFurniture(id: string): FurnitureDef | undefined;
  getBlueprint(id: string): BlueprintDef | undefined;
  getAchievement(id: string): AchievementDef | undefined;
  getPlayerGoal(id: string): PlayerGoalDef | undefined;
  getCommunityProposal(id: string): CommunityProposalDef | undefined;
  getCollectionCategory(id: string): CollectionCategoryDef | undefined;
  getTrainRoute(id: string): TrainRouteDef | undefined;
  getWeatherTable(): WeatherTransitionTable;
  resolveItemName(id: ItemId): string;
  validate(): string[];
}

// =============================================================================
// 13. CORE SERVICES
// =============================================================================
export interface IRngFacade {
  roll(streamId: string): number;
  chance(streamId: string, probability: number): boolean;
  floatRange(streamId: string, min: number, max: number): number;
  intRange(streamId: string, minInclusive: number, maxInclusive: number): number;
  weighted<T>(streamId: string, candidates: readonly { weight: number; value: T }[]): T | null;
  shuffle<T>(streamId: string, values: readonly T[]): T[];
}

export interface IClock {
  readonly simTimeSeconds: number;
  readonly time: GameTime;
  readonly paused: boolean;
  readonly speed: GameSpeed;
  setSpeed(speed: GameSpeed): void;
  setPaused(paused: boolean): void;
  /** Advances using real elapsed seconds (applies speed and pause). Returns simulated seconds advanced. */
  advanceRealSeconds(realSeconds: number): number;
  /** Advances simulated seconds directly (tests, offline catch-up). */
  advanceSimSeconds(seconds: number): void;
  setSimTimeSeconds(seconds: number): void;
  syncRealTimestamp(realMs: number): void;
  serialize(): ClockState;
  restore(state: ClockState): void;
}

export interface GameEventMap {
  'time:hour': { simTimeSeconds: number; time: GameTime; hour: number };
  'time:day': { simTimeSeconds: number; time: GameTime; day: number };
  'time:season': { simTimeSeconds: number; time: GameTime; season: Season };
  'weather:changed': { weather: WeatherType; previous: WeatherType; temperature: number; windSpeed: number };
  'location:changed': { from: LocationId | null; to: LocationId; regionId: RegionId };
  'npc:activity': { npcId: NPCId; activity: string; locationId: LocationId };
  'npc:met': { npcId: NPCId; npcName: string };
  'relationship:changed': { npcId: NPCId; kind: SocialInteractionKind | 'npc_npc' | 'decay'; affinity: number; trust: number; intimacy: number; status: RelationshipStatus };
  'item:acquired': { itemId: ItemId; quantity: number; quality: QualityStars; source: string };
  'item:lost': { itemId: ItemId; quantity: number; reason: string };
  'money:changed': { amount: number; balance: number; reason: string };
  'transaction:completed': { record: TransactionRecord };
  'crop:harvested': { cropId: CropId; quality: QualityStars; quantity: number };
  'fish:caught': { fishId: FishId; sizeCm: number; quality: QualityStars };
  'discovery:made': { kind: 'secret' | 'clue' | 'location' | 'photo'; id: string; description: string };
  'event:occurred': { event: WorldEvent };
  'festival:started': { festivalId: string; locationId: LocationId };
  'festival:participated': { festivalId: string; activityId: string; result: string };
  'cigarette:state': { lengthRatio: number; moisture: number; burnRate: number; sheltered: boolean };
  'cigarette:warning': { kind: 'soaked' | 'near_burnout' | 'wind' | 'ash_full'; message: string };
  'life:ended': { lifeId: LifeId; cause: string; ageDays: number };
  'life:archive': { entry: LifeArchiveEntry };
  'letter:received': { letter: LetterState };
  'achievement:unlocked': { achievementId: string; title: string };
  'goal:completed': { goalId: string; title: string };
  'community:proposal': { project: CommunityProjectState };
  'save:completed': { slotId: string; savedAt: number };
  'offline:progress': { percent: number; phase: string };
  'offline:completed': { summary: OfflineSummary };
  'game:signal': { name: string; data?: JsonValue };
}

export type GameEventTopic = keyof GameEventMap & string;

export interface IEventBus {
  on<K extends GameEventTopic>(topic: K, handler: (payload: GameEventMap[K]) => void): () => void;
  once<K extends GameEventTopic>(topic: K, handler: (payload: GameEventMap[K]) => void): () => void;
  emit<K extends GameEventTopic>(topic: K, payload: GameEventMap[K]): void;
  off<K extends GameEventTopic>(topic: K, handler: (payload: GameEventMap[K]) => void): void;
  clear(): void;
  listenerCount(topic: GameEventTopic): number;
}

export interface ISystem {
  readonly id: string;
  init(ctx: IGameContext): void;
  update(dtSimSeconds: number): void;
}

export interface ISystemRegistry {
  register(system: ISystem): void;
  get<T extends ISystem>(id: string): T | undefined;
  getRequired<T extends ISystem>(id: string): T;
  all(): ISystem[];
  has(id: string): boolean;
  initAll(ctx: IGameContext): void;
  updateAll(dtSimSeconds: number): void;
}

export interface IGameContext {
  readonly state: GameState;
  readonly content: IContentRegistry;
  readonly probability: IProbabilityEngine;
  readonly bus: IEventBus;
  readonly clock: IClock;
  readonly registry: ISystemRegistry;
  readonly rng: IRngFacade;
  readonly logger: ILogger;
}

// =============================================================================
// 14. PROBABILITY ENGINE INTERFACE
// =============================================================================
export interface IProbabilityEngine {
  readonly seed: number;
  init(seed: number, persisted?: ProbabilityPersistState): void;
  /** Registers a stream derived from the life seed if not present. */
  ensureStream(streamId: string): void;
  hasStream(streamId: string): boolean;
  listStreams(): string[];
  roll(streamId: string): number;
  floatRange(streamId: string, min: number, max: number): number;
  intRange(streamId: string, minInclusive: number, maxInclusive: number): number;
  chance(streamId: string, probability: number): boolean;
  weighted<T>(streamId: string, candidates: readonly { weight: number; value: T }[]): T | null;
  decide<T>(request: ProbabilityRequest<T>): ProbabilityDecision<T>;
  getHistory(limit?: number): ProbabilityDecisionRecord[];
  getHistoryForDecision(decisionId: string): ProbabilityDecisionRecord | undefined;
  getStats(streamId: string): ProbabilityStreamStats;
  replayDecision(decisionId: string): ProbabilityDecisionRecord | null;
  evaluateConditions(conditions: readonly ConditionExpr[], context: ProbabilityContext): boolean;
  exportState(): ProbabilityPersistState;
  importState(state: ProbabilityPersistState): void;
  /** Debug helper: draws N samples from a decision shape and returns counts. */
  simulate<T>(request: ProbabilityRequest<T>, samples: number): Record<string, number>;
}

// =============================================================================
// 15. DOMAIN SYSTEM INTERFACES
// =============================================================================
export interface IWorldSystem extends ISystem {
  getRegion(id: RegionId): RegionState | undefined;
  getLocation(id: LocationId): LocationState | undefined;
  getLocationDef(id: LocationId): LocationDef | undefined;
  getLocationsInRegion(regionId: RegionId): LocationState[];
  getAllLocations(): LocationState[];
  getMicroclimate(locationId: LocationId): MicroclimateState;
  getEnvironment(): EnvironmentState;
  getTime(): GameTime;
  getCurrentLocationId(): LocationId;
  isIndoor(locationId: LocationId): boolean;
  travelTo(locationId: LocationId): ActionResult;
  getTrainRoutes(): TrainRouteDef[];
  getTrainSchedule(fromLocationId: LocationId, toLocationId?: LocationId): TrainDepartureInfo[];
  buyTrainTicket(routeId: string): ActionResult;
  boardTrain(): ActionResult;
  getUnlockedTravelDestinations(): LocationId[];
}

export interface INPCSystem extends ISystem {
  getNPC(id: NPCId): NPCState | undefined;
  getAllNPCs(): NPCState[];
  getMajorNPCs(): NPCState[];
  getNPCsAt(locationId: LocationId): NPCState[];
  getNearbyNPCs(): NPCState[];
  setNPCActivity(npcId: NPCId, activity: string, locationId: LocationId): ActionResult;
  getLastDecision(npcId: NPCId): { activity: string; candidates: { id: string; weight: number }[] } | null;
}

export interface IEconomySystem extends ISystem {
  getBusiness(id: BusinessId): BusinessState | undefined;
  getBusinessDef(id: BusinessId): BusinessDef | undefined;
  getBusinesses(): BusinessState[];
  getBusinessesAtLocation(locationId: LocationId): BusinessState[];
  getMarket(): Record<ItemId, MarketGoodState>;
  getMarketGood(itemId: ItemId): MarketGoodState | undefined;
  getBusinessStock(businessId: BusinessId): ShopStockEntryState[];
  getJobs(): JobState[];
  getJobsAtLocation(locationId: LocationId): JobState[];
  buyFromBusiness(businessId: BusinessId, itemId: ItemId, quantity: number): ActionResult;
  sellToBusiness(businessId: BusinessId, itemId: ItemId, quantity: number, instanceId?: string): ActionResult;
  getPlayerShop(): PlayerShopState | null;
  buyPlayerShop(businessId: BusinessId): ActionResult;
  setPlayerShopPrice(itemId: ItemId, pricePence: number): ActionResult;
  restockPlayerShop(itemId: ItemId, quantity: number): ActionResult;
  togglePlayerShopOpen(open: boolean): ActionResult;
  hireEmployee(npcId: NPCId): ActionResult;
  fireEmployee(npcId: NPCId): ActionResult;
  applyForJob(jobId: string): ActionResult;
  quitJob(): ActionResult;
  workShift(): ActionResult;
  getRecentTransactions(limit?: number): TransactionRecord[];
}

export interface IFarmingSystem extends ISystem {
  getPlots(locationId?: LocationId): FarmPlotState[];
  getCropDef(cropId: CropId): CropDef | undefined;
  tillPlot(locationId: LocationId, x: number, y: number): ActionResult;
  plantSeed(plotId: string, seedItemId: ItemId): ActionResult;
  waterPlot(plotId: string): ActionResult;
  fertilizePlot(plotId: string, fertilizer: 'ash' | 'compost' | 'none'): ActionResult;
  harvestPlot(plotId: string): ActionResult;
  clearPlot(plotId: string): ActionResult;
  buildGreenhouse(locationId: LocationId): ActionResult;
  getGreenhouses(): GreenhouseState[];
}

export interface IFishingSystem extends ISystem {
  castLine(locationId: LocationId, rodInstanceId?: string, baitInstanceId?: string): ActionResult;
  reel(hold: boolean): ActionResult;
  cancelFishing(): ActionResult;
  getSession(): FishingSessionState | null;
  getAvailableFish(locationId: LocationId): FishId[];
  getFishingState(): FishingState;
}

export interface IForagingSystem extends ISystem {
  gather(nodeId: string): ActionResult;
  getNodesAt(locationId: LocationId): ForageNodeState[];
  getNodeDef(nodeId: string): ForageNodeDef | undefined;
}

export interface IExplorationSystem extends ISystem {
  search(locationId: LocationId): ActionResult;
  unlockSecret(locationId: LocationId): ActionResult;
  takePhoto(locationId: LocationId): ActionResult;
  getDiscoveryState(locationId: LocationId): ExplorationLocationState;
  getPhotos(): PhotoState[];
  getSecrets(): string[];
}

export interface ICraftingSystem extends ISystem {
  craft(recipeId: RecipeId, quantity: number): ActionResult;
  getAvailableRecipes(category: 'craft' | 'cook'): RecipeDef[];
  canCraft(recipeId: RecipeId, quantity: number): ActionResult;
  getCraftingState(): CraftingState;
}

export interface ICookingSystem extends ISystem {
  cook(recipeId: RecipeId): ActionResult;
  getKnownRecipes(): RecipeDef[];
  getCookingState(): CookingState;
}

export interface IBuildingSystem extends ISystem {
  getProjects(): BuildProjectState[];
  startProject(blueprintId: string, locationId: LocationId): ActionResult;
  cancelProject(projectId: string): ActionResult;
  getAvailableBlueprints(): BlueprintDef[];
}

export interface IHousingSystem extends ISystem {
  getHome(homeId: string): HomeState | undefined;
  getHomeAtLocation(locationId: LocationId): HomeState | undefined;
  getHomes(): HomeState[];
  placeFurniture(itemInstanceId: string, x: number, y: number, rotation: number): ActionResult;
  removeFurniture(placedFurnitureId: string): ActionResult;
  paintWall(homeId: string, color: string): ActionResult;
  setFloorStyle(homeId: string, style: string): ActionResult;
  storeItem(homeId: string, instanceId: string): ActionResult;
  takeItem(homeId: string, instanceId: string): ActionResult;
  addRoom(homeId: string, blueprintId: string): ActionResult;
}

export interface ICollectionSystem extends ISystem {
  registerItem(itemId: ItemId, quality: QualityStars): ActionResult;
  donateToMuseum(itemId: ItemId): ActionResult;
  getProgress(): { known: number; total: number; donated: number };
  isCollected(itemId: ItemId): boolean;
}

export interface ISkillSystem extends ISystem {
  addXp(skill: SkillId, amount: number, source: string): void;
  getProgress(skill: SkillId): SkillProgressState;
  getLevel(skill: SkillId): number;
  canUse(skill: SkillId, level: number): boolean;
}

export interface IEventSystem extends ISystem {
  getActiveEvents(): WorldEvent[];
  getRecentEvents(limit?: number): WorldEvent[];
  acknowledgeEvent(eventId: EventId): ActionResult;
  getFestivals(): { def: FestivalDef; state: EventSystemState['festivals'][string] }[];
  participateFestival(festivalId: string, activityId: string): ActionResult;
  triggerEventForTesting(eventId: string): ActionResult;
  getEventSystemState(): EventSystemState;
}

export interface ISocialSystem extends ISystem {
  getRelationship(npcId: NPCId): RelationshipState | undefined;
  getKnownNPCs(): NPCState[];
  talkTo(npcId: NPCId): ActionResult;
  giveGift(npcId: NPCId, instanceId: string): ActionResult;
  helpNPC(npcId: NPCId): ActionResult;
  inviteNPC(npcId: NPCId, activity: InvitationState['activity']): ActionResult;
  getInvitations(): InvitationState[];
  acceptInvitation(invitationId: string): ActionResult;
  declineInvitation(invitationId: string): ActionResult;
  confessTo(npcId: NPCId): ActionResult;
  goOnDate(npcId: NPCId): ActionResult;
  apologiseTo(npcId: NPCId): ActionResult;
  proposeCommunityProject(proposalId: string): ActionResult;
  getCommunityProjects(): CommunityProjectState[];
  getInteractionLog(limit?: number): InteractionLogEntry[];
  getSocialState(): SocialState;
}

export interface IDialogueSystem extends ISystem {
  startConversation(npcId: NPCId): ActionResult;
  getConversation(): DialogueSessionState | null;
  getCurrentNode(): { npcId: NPCId; text: string; choices: { id: string; text: string; available: boolean }[]; emotion: string } | null;
  choose(choiceIndex: number): ActionResult;
  endConversation(): ActionResult;
}

export interface ILifeSystem extends ISystem {
  getCigaretteState(): CigaretteConditionState;
  getLifeState(): LifeState;
  collectAsh(): ActionResult;
  warmUp(source: string): ActionResult;
  customizeAppearance(appearance: CigaretteAppearance): ActionResult;
  choosePersonalGoal(goalId: string): ActionResult;
  getAvailableGoals(): PlayerGoalDef[];
  getArchive(): LifeArchiveEntry[];
  getAchievements(): { def: AchievementDef; state: AchievementState | null }[];
  getLifeReview(): ArchivedLife | null;
  readLetter(letterId: string): ActionResult;
  /** Forcefully ends the current life (also triggered by lengthRatio <= 0). */
  endLife(reason: string): ActionResult;
}

export interface IWeatherSystem {
  getWeather(): WeatherType;
  getTemperature(): number;
  getWindSpeed(): number;
  getHumidity(): number;
  forceWeather(weather: WeatherType, durationHours: number): void;
  update(dtSimSeconds: number): void;
}

// =============================================================================
// 16. WORKER PROTOCOL / OFFLINE SIMULATION
// =============================================================================
export interface OfflineSimRequest {
  requestId: string;
  /** Full serialised state. The worker returns the advanced state and summary. */
  baseState: GameState;
  fromSimTime: number;
  toSimTime: number;
  realElapsedMs: number;
  /** Idempotency token: worker echoes it, main thread rejects stale results. */
  baseProcessedSimTime: number;
}

export interface OfflineSimStats {
  steps: number;
  npcDecisions: number;
  events: number;
  elapsedMs: number;
  transactions: number;
}

export interface OfflineSimResult {
  requestId: string;
  ok: boolean;
  /** Sim time after processing; used for the idempotency lock. */
  lastProcessedSimTime: number;
  state: GameState;
  summary: OfflineSummary;
  stats: OfflineSimStats;
  error?: string;
}

export interface BackgroundTickResult {
  state: GameState;
  simTimeSeconds: number;
  elapsedMs: number;
}

export type ToSimulationWorkerMessage =
  | { kind: 'init'; seed: number; packVersion: string }
  | { kind: 'offline'; request: OfflineSimRequest }
  | { kind: 'background'; baseState: GameState; simDeltaSeconds: number }
  | { kind: 'ping'; requestId: string }
  | { kind: 'shutdown' };

export type FromSimulationWorkerMessage =
  | { kind: 'ready'; packVersion: string }
  | { kind: 'pong'; requestId: string }
  | { kind: 'offline-progress'; requestId: string; percent: number; phase: string }
  | { kind: 'offline-result'; result: OfflineSimResult }
  | { kind: 'offline-error'; requestId: string; message: string }
  | { kind: 'background-result'; result: BackgroundTickResult }
  | { kind: 'worker-error'; message: string };

export interface IWorkerBridge {
  readonly ready: boolean;
  start(onProgress?: (percent: number, phase: string) => void): Promise<void>;
  requestOffline(request: OfflineSimRequest): Promise<OfflineSimResult>;
  requestBackground(baseState: GameState, simDeltaSeconds: number): Promise<BackgroundTickResult>;
  ping(): Promise<boolean>;
  terminate(): void;
}

// =============================================================================
// 17. PERSISTENCE
// =============================================================================
export interface ISaveManager {
  init(): Promise<void>;
  save(slotId: string): Promise<ActionResult>;
  load(slotId: string): Promise<GameState | null>;
  listSlots(): Promise<SaveSlotMeta[]>;
  deleteSlot(slotId: string): Promise<void>;
  autosave(): Promise<ActionResult>;
  exportSave(slotId?: string): Promise<string | null>;
  importSave(json: string, slotId: string): Promise<ActionResult>;
  hasAnySave(): Promise<boolean>;
  getLastSavedAt(): number;
}

// =============================================================================
// 18. PLAYER ACTIONS / GAME API
// =============================================================================
export interface NewGameOptions {
  playerName: string;
  appearance: CigaretteAppearance;
  seed?: number;
  slotId?: string;
}

export interface FertilizerChoice {
  kind: 'ash' | 'compost' | 'none';
}

export type GameAction =
  | { type: 'move:to-location'; locationId: LocationId }
  | { type: 'move:enter'; locationId: LocationId }
  | { type: 'move:exit-interior' }
  | { type: 'move:position'; x: number; y: number }
  | { type: 'interact'; targetKind: string; targetId: string }
  | { type: 'inventory:use'; instanceId: string }
  | { type: 'inventory:drop'; instanceId: string; quantity: number }
  | { type: 'inventory:equip'; instanceId: string }
  | { type: 'inventory:unequip'; slot: EquipmentSlot }
  | { type: 'inventory:read-book'; instanceId: string }
  | { type: 'ash:collect' }
  | { type: 'farm:till'; locationId: LocationId; x: number; y: number }
  | { type: 'farm:plant'; plotId: string; seedItemId: ItemId }
  | { type: 'farm:water'; plotId: string }
  | { type: 'farm:fertilize'; plotId: string; fertilizer: 'ash' | 'compost' | 'none' }
  | { type: 'farm:harvest'; plotId: string }
  | { type: 'farm:clear'; plotId: string }
  | { type: 'farm:build-greenhouse'; locationId: LocationId }
  | { type: 'fish:cast'; locationId: LocationId; rodInstanceId?: string; baitInstanceId?: string }
  | { type: 'fish:reel'; hold: boolean }
  | { type: 'fish:cancel' }
  | { type: 'forage:gather'; nodeId: string }
  | { type: 'explore:search'; locationId: LocationId }
  | { type: 'explore:unlock'; locationId: LocationId }
  | { type: 'explore:photo'; locationId: LocationId }
  | { type: 'craft'; recipeId: RecipeId; quantity: number }
  | { type: 'cook'; recipeId: RecipeId }
  | { type: 'build:start'; blueprintId: string; locationId: LocationId }
  | { type: 'build:cancel'; projectId: string }
  | { type: 'housing:place'; itemInstanceId: string; x: number; y: number; rotation: number }
  | { type: 'housing:remove'; placedFurnitureId: string }
  | { type: 'housing:paint'; homeId: string; color: string }
  | { type: 'housing:floor'; homeId: string; style: string }
  | { type: 'housing:store'; homeId: string; instanceId: string }
  | { type: 'housing:take'; homeId: string; instanceId: string }
  | { type: 'housing:add-room'; homeId: string; blueprintId: string }
  | { type: 'shop:buy'; businessId: BusinessId; itemId: ItemId; quantity: number }
  | { type: 'shop:sell'; businessId: BusinessId; itemId: ItemId; quantity: number; instanceId?: string }
  | { type: 'shop:price'; itemId: ItemId; pricePence: number }
  | { type: 'shop:restock'; itemId: ItemId; quantity: number }
  | { type: 'shop:open'; open: boolean }
  | { type: 'shop:hire'; npcId: NPCId }
  | { type: 'shop:fire'; npcId: NPCId }
  | { type: 'shop:buy-business'; businessId: BusinessId }
  | { type: 'work:apply'; jobId: string }
  | { type: 'work:shift' }
  | { type: 'work:quit' }
  | { type: 'social:talk'; npcId: NPCId }
  | { type: 'social:gift'; npcId: NPCId; instanceId: string }
  | { type: 'social:help'; npcId: NPCId }
  | { type: 'social:invite'; npcId: NPCId; activity: InvitationState['activity'] }
  | { type: 'social:accept-invite'; invitationId: string }
  | { type: 'social:decline-invite'; invitationId: string }
  | { type: 'social:confess'; npcId: NPCId }
  | { type: 'social:date'; npcId: NPCId }
  | { type: 'social:apologise'; npcId: NPCId }
  | { type: 'social:propose'; proposalId: string }
  | { type: 'dialogue:start'; npcId: NPCId }
  | { type: 'dialogue:choose'; choiceIndex: number }
  | { type: 'dialogue:end' }
  | { type: 'train:buy-ticket'; routeId: string }
  | { type: 'train:board' }
  | { type: 'life:customize'; appearance: CigaretteAppearance }
  | { type: 'life:set-goal'; goalId: string }
  | { type: 'life:warm-up'; source?: string }
  | { type: 'life:read-letter'; letterId: string }
  | { type: 'life:end'; reason?: string }
  | { type: 'life:next-generation'; legacyItemIds: string[] }
  | { type: 'event:acknowledge'; eventId: EventId }
  | { type: 'festival:participate'; festivalId: string; activityId: string }
  | { type: 'collection:donate'; itemId: ItemId }
  | { type: 'save'; slotId?: string }
  | { type: 'load'; slotId: string }
  | { type: 'settings:update'; settings: Partial<GameSettings> };

export interface IGameApi {
  getState(): Readonly<GameState>;
  getContent(): IContentRegistry;
  getClock(): IClock;
  getScreen(): GameScreen;
  setScreen(screen: GameScreen): void;
  dispatch(action: GameAction): ActionResult;
  /** Advances the whole simulation deterministically (headless/tests). */
  tick(deltaRealSeconds: number): void;
  newGame(options: NewGameOptions): ActionResult;
  saveGame(slotId: string): Promise<ActionResult>;
  loadGame(slotId: string): Promise<ActionResult>;
  listSaveSlots(): Promise<SaveSlotMeta[]>;
  startNextLife(legacyItemIds: string[]): ActionResult;
  requestOfflineCatchup(): Promise<OfflineSimResult | null>;
  getOfflineSummary(): OfflineSummary | null;
  acknowledgeOfflineSummary(): void;
  getLifeArchive(): ArchivedLife[];
  isPlaying(): boolean;
  getSystems(): IGameSystems;
}

export interface IGameSystems {
  world: IWorldSystem;
  npc: INPCSystem;
  economy: IEconomySystem;
  farming: IFarmingSystem;
  fishing: IFishingSystem;
  foraging: IForagingSystem;
  exploration: IExplorationSystem;
  crafting: ICraftingSystem;
  cooking: ICookingSystem;
  building: IBuildingSystem;
  housing: IHousingSystem;
  collection: ICollectionSystem;
  skill: ISkillSystem;
  events: IEventSystem;
  social: ISocialSystem;
  dialogue: IDialogueSystem;
  life: ILifeSystem;
  save: ISaveManager;
}
