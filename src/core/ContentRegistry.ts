import type { IContentRegistry } from './contracts';
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
import type { BusinessId, CropId, FishId, ItemId, LocationId, NPCId, RecipeId, RegionId } from './SharedTypes';

function indexById<T extends { id: string }>(entries: readonly T[], label: string, errors: string[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const entry of entries) {
    if (map.has(entry.id)) {
      errors.push('Duplicate ' + label + ' id: ' + entry.id);
      continue;
    }
    map.set(entry.id, entry);
  }
  return map;
}

/** Immutable lookup registry over the static content pack, with validation. */
export class ContentRegistry implements IContentRegistry {
  readonly pack: ContentPack;
  private readonly items: Map<string, ItemDef>;
  private readonly crops: Map<string, CropDef>;
  private readonly fish: Map<string, FishDef>;
  private readonly forageNodes: Map<string, ForageNodeDef>;
  private readonly recipes: Map<string, RecipeDef>;
  private readonly events: Map<string, EventDef>;
  private readonly festivals: Map<string, FestivalDef>;
  private readonly locations: Map<string, LocationDef>;
  private readonly businesses: Map<string, BusinessDef>;
  private readonly npcs: Map<string, NPCDef>;
  private readonly dialogueTrees: Map<string, DialogueTree>;
  private readonly furniture: Map<string, FurnitureDef>;
  private readonly blueprints: Map<string, BlueprintDef>;
  private readonly achievements: Map<string, AchievementDef>;
  private readonly playerGoals: Map<string, PlayerGoalDef>;
  private readonly proposals: Map<string, CommunityProposalDef>;
  private readonly collectionCategories: Map<string, CollectionCategoryDef>;
  private readonly trainRoutes: Map<string, TrainRouteDef>;
  private readonly itemsByTag = new Map<string, ItemDef[]>();
  private readonly validationErrors: string[] = [];

  constructor(pack: ContentPack) {
    this.pack = pack;
    this.items = indexById(pack.items, 'item', this.validationErrors);
    this.crops = indexById(pack.crops, 'crop', this.validationErrors);
    this.fish = indexById(pack.fish, 'fish', this.validationErrors);
    this.forageNodes = indexById(pack.forageNodes, 'forage node', this.validationErrors);
    this.recipes = indexById(pack.recipes, 'recipe', this.validationErrors);
    this.events = indexById(pack.events, 'event', this.validationErrors);
    this.festivals = indexById(pack.festivals, 'festival', this.validationErrors);
    this.locations = indexById(pack.locations, 'location', this.validationErrors);
    this.businesses = indexById(pack.businesses, 'business', this.validationErrors);
    this.npcs = indexById(pack.npcs, 'npc', this.validationErrors);
    this.dialogueTrees = indexById(pack.dialogueTrees, 'dialogue tree', this.validationErrors);
    this.furniture = indexById(pack.furniture, 'furniture', this.validationErrors);
    this.blueprints = indexById(pack.blueprints, 'blueprint', this.validationErrors);
    this.achievements = indexById(pack.achievements, 'achievement', this.validationErrors);
    this.playerGoals = indexById(pack.playerGoals, 'player goal', this.validationErrors);
    this.proposals = indexById(pack.communityProposals, 'community proposal', this.validationErrors);
    this.collectionCategories = indexById(pack.collectionCategories, 'collection category', this.validationErrors);
    this.trainRoutes = indexById(pack.trainRoutes, 'train route', this.validationErrors);

    for (const item of pack.items) {
      for (const tag of item.tags) {
        const bucket = this.itemsByTag.get(tag);
        if (bucket) bucket.push(item);
        else this.itemsByTag.set(tag, [item]);
      }
    }
    this.validateReferences();
  }

  private validateReferences(): void {
    for (const recipe of this.pack.recipes) {
      for (const input of recipe.inputs) {
        if (!this.items.has(input.itemId)) this.validationErrors.push('Recipe ' + recipe.id + ' references unknown item ' + input.itemId);
      }
      for (const output of recipe.outputs) {
        if (!this.items.has(output.itemId)) this.validationErrors.push('Recipe ' + recipe.id + ' references unknown item ' + output.itemId);
      }
    }
    for (const crop of this.pack.crops) {
      if (!this.items.has(crop.seedItemId)) this.validationErrors.push('Crop ' + crop.id + ' references unknown seed ' + crop.seedItemId);
      if (!this.items.has(crop.produceItemId)) this.validationErrors.push('Crop ' + crop.id + ' references unknown produce ' + crop.produceItemId);
    }
    for (const location of this.pack.locations) {
      for (const connection of location.connections) {
        if (!this.locations.has(connection)) this.validationErrors.push('Location ' + location.id + ' connects to unknown location ' + connection);
      }
      if (location.businessId && !this.businesses.has(location.businessId)) {
        this.validationErrors.push('Location ' + location.id + ' references unknown business ' + location.businessId);
      }
    }
    for (const business of this.pack.businesses) {
      if (!this.locations.has(business.locationId)) this.validationErrors.push('Business ' + business.id + ' at unknown location ' + business.locationId);
      for (const stock of business.stock) {
        if (!this.items.has(stock.itemId)) this.validationErrors.push('Business ' + business.id + ' stocks unknown item ' + stock.itemId);
      }
    }
    for (const npc of this.pack.npcs) {
      if (!this.locations.has(npc.homeLocationId)) this.validationErrors.push('NPC ' + npc.id + ' has unknown home ' + npc.homeLocationId);
      if (!this.locations.has(npc.workLocationId)) this.validationErrors.push('NPC ' + npc.id + ' has unknown workplace ' + npc.workLocationId);
      if (!this.dialogueTrees.has(npc.dialogueTreeId)) this.validationErrors.push('NPC ' + npc.id + ' has unknown dialogue tree ' + npc.dialogueTreeId);
    }
    for (const festival of this.pack.festivals) {
      if (!this.locations.has(festival.locationId)) this.validationErrors.push('Festival ' + festival.id + ' at unknown location ' + festival.locationId);
    }
    for (const blueprint of this.pack.blueprints) {
      for (const input of blueprint.inputs) {
        if (!this.items.has(input.itemId)) this.validationErrors.push('Blueprint ' + blueprint.id + ' needs unknown item ' + input.itemId);
      }
    }
  }

  getItem(id: ItemId): ItemDef | undefined {
    return this.items.get(id);
  }

  getItemOrThrow(id: ItemId): ItemDef {
    const item = this.items.get(id);
    if (!item) throw new Error('Unknown item id: ' + id);
    return item;
  }

  getAllItems(): ItemDef[] {
    return this.pack.items;
  }

  getItemsByTag(tag: string): ItemDef[] {
    return this.itemsByTag.get(tag) ?? [];
  }

  getCrop(id: CropId): CropDef | undefined {
    return this.crops.get(id);
  }

  getFish(id: FishId): FishDef | undefined {
    return this.fish.get(id);
  }

  getForageNode(id: string): ForageNodeDef | undefined {
    return this.forageNodes.get(id);
  }

  getRecipe(id: RecipeId): RecipeDef | undefined {
    return this.recipes.get(id);
  }

  getAllRecipes(): RecipeDef[] {
    return this.pack.recipes;
  }

  getEvent(id: string): EventDef | undefined {
    return this.events.get(id);
  }

  getFestival(id: string): FestivalDef | undefined {
    return this.festivals.get(id);
  }

  getLocation(id: LocationId): LocationDef | undefined {
    return this.locations.get(id);
  }

  getLocationOrThrow(id: LocationId): LocationDef {
    const location = this.locations.get(id);
    if (!location) throw new Error('Unknown location id: ' + id);
    return location;
  }

  getLocationsInRegion(regionId: RegionId): LocationDef[] {
    return this.pack.locations.filter((location) => location.regionId === regionId);
  }

  getBusiness(id: BusinessId): BusinessDef | undefined {
    return this.businesses.get(id);
  }

  getNPC(id: NPCId): NPCDef | undefined {
    return this.npcs.get(id);
  }

  getDialogueTree(id: string): DialogueTree | undefined {
    return this.dialogueTrees.get(id);
  }

  getFurniture(id: string): FurnitureDef | undefined {
    return this.furniture.get(id);
  }

  getBlueprint(id: string): BlueprintDef | undefined {
    return this.blueprints.get(id);
  }

  getAchievement(id: string): AchievementDef | undefined {
    return this.achievements.get(id);
  }

  getPlayerGoal(id: string): PlayerGoalDef | undefined {
    return this.playerGoals.get(id);
  }

  getCommunityProposal(id: string): CommunityProposalDef | undefined {
    return this.proposals.get(id);
  }

  getCollectionCategory(id: string): CollectionCategoryDef | undefined {
    return this.collectionCategories.get(id);
  }

  getTrainRoute(id: string): TrainRouteDef | undefined {
    return this.trainRoutes.get(id);
  }

  getWeatherTable(): WeatherTransitionTable {
    return this.pack.weatherTable;
  }

  resolveItemName(id: ItemId): string {
    return this.items.get(id)?.name ?? id;
  }

  validate(): string[] {
    return [...this.validationErrors];
  }
}
