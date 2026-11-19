import type {
  ActionResult,
  CraftJobState,
  CraftingState,
  HomeState,
  ICraftingSystem,
  IGameContext,
  ISkillSystem,
  PlacedFurnitureState,
} from '../core/contracts';
import type { CraftStation, FacilityKind, RecipeDef } from '../data/schema';
import type { ItemId, JsonValue, LocationId, QualityStars, RecipeId } from '../core/SharedTypes';
import { HOME_INTERIOR_ID, LOC, interiorIdFor } from '../data/locations/ids';
import { ITEM } from '../data/items/ids';
import { SKILL_ACTIVITY_XP, WORLD_CONFIG } from '../core/WorldConfig';
import { addItemToInventory, consumeItems, countItem, hasItems } from '../core/InventoryUtil';
import { clamp } from '../core/utils';

/**
 * CraftingSystem (id 'crafting') - workbench crafting with timed jobs.
 *
 * QUALITY FORMULA (documented contract, mirrors code_artifact module 11):
 *   avgInputQuality  = quantity-weighted mean quality (1..5) of the consumed inputs
 *   skillLevelFactor = 1 + 4 * (level - 1) / (maxLevel - 1)          -> 1..5
 *   jitter           = probability stream 'crafting.quality' float in [1, 5]
 *   quality          = clamp(round(avgInputQuality * 0.6 + skillLevelFactor * 0.3 + jitter * 0.1), 1, 5)
 *
 * JOBS: inputs are consumed atomically when the job starts, outputs are delivered when
 * `completesAt` (absolute sim time) is reached. Job length = recipe.hours * quantity,
 * shortened by recipe mastery (up to -35%). The average input quality is persisted in
 * player.extras ('craft:jobInputQuality') so a save/load mid-job keeps the same quality.
 *
 * STATIONS: a station is available when the player's current location has the matching
 * facility, or a piece of home furniture grants it, or the player carries a portable kit
 * (workbench kit / paintbrush). FacilityKind has no 'forge', so forge recipes run at a
 * workbench - a bench vice and hand tools are enough for this village.
 */
const SIM_SECONDS_PER_GAME_HOUR = 60;
const CRAFTING_QUALITY_STREAM = 'crafting.quality';
const MAX_BATCH_SIZE = 20;
const MAX_CONCURRENT_JOBS = 8;
const MAX_JOBS_COMPLETED_PER_UPDATE = 64;
const JOB_QUALITY_EXTRAS_KEY = 'craft:jobInputQuality';
const DEFAULT_INPUT_QUALITY = 2.5;
const MAX_MASTERY_SPEED_BONUS = 0.35;
const MASTERY_SPEED_PER_LEVEL = 0.02;

/** Location facilities that satisfy each crafting station. */
const STATION_FACILITIES: Record<Exclude<CraftStation, 'none'>, FacilityKind[]> = {
  workbench: ['workbench'],
  kitchen: ['kitchen', 'cafe', 'bakery'],
  campfire: ['campfire'],
  // FacilityKind has no 'forge' entry; a workbench with hand tools is the village forge.
  forge: ['workbench'],
  art_studio: ['art_studio'],
};

/** Placed home furniture that provides a crafting station. */
const FURNITURE_STATION_GRANTS: Record<string, CraftStation[]> = {
  [ITEM.workbenchHome]: ['workbench', 'forge'],
  [ITEM.kitchenCounter]: ['kitchen'],
  [ITEM.stove]: ['kitchen'],
  [ITEM.fireplace]: ['campfire'],
};

/** Portable items that provide a station wherever the player stands. */
const PORTABLE_STATION_ITEMS: Record<string, Exclude<CraftStation, 'none'>[]> = {
  [ITEM.workbenchKit]: ['workbench', 'forge'],
  [ITEM.paintbrush]: ['art_studio'],
};

export class CraftingSystem implements ICraftingSystem {
  readonly id = 'crafting';

  private ctx: IGameContext | null = null;
  private readonly recipeByUnlockItem = new Map<ItemId, RecipeDef[]>();

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.indexUnlockItems();
    this.syncKnownRecipesFromInventory();
    ctx.bus.on('item:acquired', (payload) => {
      this.handleItemAcquired(payload.itemId);
    });
  }

  update(_dtSimSeconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const jobs = ctx.state.crafting.jobs;
    if (jobs.length === 0) return;
    const now = ctx.clock.simTimeSeconds;
    let completed = 0;
    for (let index = jobs.length - 1; index >= 0 && completed < MAX_JOBS_COMPLETED_PER_UPDATE; index -= 1) {
      const job = jobs[index];
      if (!job) continue;
      if (job.completesAt > now) continue;
      jobs.splice(index, 1);
      this.completeJob(job);
      completed += 1;
    }
  }

  // -------------------------------------------------------------------------
  // ICraftingSystem
  // -------------------------------------------------------------------------
  getAvailableRecipes(category: 'craft' | 'cook'): RecipeDef[] {
    return this.getKnownRecipes(category).filter((recipe) => hasItems(this.inventory(), recipe.inputs));
  }

  canCraft(recipeId: RecipeId, quantity: number): ActionResult {
    const ctx = this.requireContext();
    if (!ctx) return this.fail('not_found', 'Crafting is not available yet.');
    const recipe = ctx.content.getRecipe(recipeId);
    if (!recipe) return this.fail('not_found', 'No such recipe.');
    return this.validateCraft(recipe, quantity);
  }

  craft(recipeId: RecipeId, quantity: number): ActionResult {
    const ctx = this.requireContext();
    if (!ctx) return this.fail('not_found', 'Crafting is not available yet.');
    const recipe = ctx.content.getRecipe(recipeId);
    if (!recipe) return this.fail('not_found', 'No such recipe.');
    const validation = this.validateCraft(recipe, quantity);
    if (!validation.ok) return validation;

    const batch = Math.floor(quantity);
    const requirements = recipe.inputs.map((input) => ({
      itemId: input.itemId,
      quantity: input.quantity * batch,
    }));
    const avgInputQuality = this.averageInputQuality(requirements);
    if (!consumeItems(ctx.state.player.inventory, requirements)) {
      // Defensive: validateCraft() already checked, but never consume partially.
      return this.fail('not_enough_items', 'You are missing materials for that.');
    }

    const now = ctx.clock.simTimeSeconds;
    const job: CraftJobState = {
      id: this.nextJobId(),
      recipeId: recipe.id,
      station: recipe.station,
      quantity: batch,
      startedAt: now,
      completesAt: now + this.effectiveHours(recipe, batch) * SIM_SECONDS_PER_GAME_HOUR,
    };
    ctx.state.crafting.jobs.push(job);
    ctx.state.crafting.lastCraftAt = now;
    this.rememberJobQuality(job.id, avgInputQuality);

    const data: JsonValue = {
      jobId: job.id,
      recipeId: recipe.id,
      quantity: batch,
      completesAt: job.completesAt,
    };
    ctx.bus.emit('game:signal', { name: 'craft:started', data });
    return {
      ok: true,
      message: 'Started crafting ' + recipe.name + (batch > 1 ? ' x' + batch : '') + '.',
      stateChanged: true,
      data,
    };
  }

  getCraftingState(): CraftingState {
    const ctx = this.requireContext();
    if (!ctx) return { jobs: [], mastery: {}, lastCraftAt: 0 };
    return ctx.state.crafting;
  }

  // -------------------------------------------------------------------------
  // Extra public helpers (UI / other systems)
  // -------------------------------------------------------------------------
  /** Known, station- and level-eligible recipes for a category (ignores materials). */
  getKnownRecipes(category: 'craft' | 'cook'): RecipeDef[] {
    const ctx = this.requireContext();
    if (!ctx) return [];
    return ctx.content
      .getAllRecipes()
      .filter(
        (recipe) =>
          recipe.category === category &&
          this.isRecipeKnown(recipe) &&
          this.getSkillLevel(recipe.skill) >= recipe.levelReq &&
          this.hasStation(recipe.station)
      )
      .sort((a, b) => a.levelReq - b.levelReq || a.hours - b.hours || a.id.localeCompare(b.id));
  }

  isRecipeKnownById(recipeId: RecipeId): boolean {
    const ctx = this.requireContext();
    if (!ctx) return false;
    const recipe = ctx.content.getRecipe(recipeId);
    if (!recipe) return false;
    return this.isRecipeKnown(recipe);
  }

  getMastery(recipeId: RecipeId): number {
    const ctx = this.requireContext();
    if (!ctx) return 0;
    return ctx.state.crafting.mastery[recipeId] ?? 0;
  }

  getActiveJobs(): CraftJobState[] {
    const ctx = this.requireContext();
    if (!ctx) return [];
    return ctx.state.crafting.jobs.map((job) => ({ ...job }));
  }

  /** Which stations the player can currently use where they stand. */
  getStationAvailability(): Record<CraftStation, boolean> {
    return {
      workbench: this.hasStation('workbench'),
      kitchen: this.hasStation('kitchen'),
      campfire: this.hasStation('campfire'),
      forge: this.hasStation('forge'),
      art_studio: this.hasStation('art_studio'),
      none: true,
    };
  }

  hasStation(station: CraftStation): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (station === 'none') return true;
    const facilities = this.playerFacilities();
    if (STATION_FACILITIES[station].some((facility) => facilities.has(facility))) return true;
    const home = this.playerHome();
    if (home && this.homeGrantsStation(home, station)) return true;
    const inventory = ctx.state.player.inventory;
    for (const [itemId, stations] of Object.entries(PORTABLE_STATION_ITEMS)) {
      if (!stations.includes(station)) continue;
      if (countItem(inventory, itemId) <= 0) continue;
      // A paintbrush alone is no studio: it needs a workbench under it.
      if (station === 'art_studio' && !this.hasStation('workbench')) continue;
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Internals - validation
  // -------------------------------------------------------------------------
  private validateCraft(recipe: RecipeDef, quantity: number): ActionResult {
    const ctx = this.requireContext();
    if (!ctx) return this.fail('not_found', 'Crafting is not available yet.');
    if (recipe.category !== 'craft') {
      return this.fail('invalid', recipe.name + ' is a cooking recipe - use a kitchen.');
    }
    if (!Number.isFinite(quantity) || Math.floor(quantity) !== quantity || quantity < 1) {
      return this.fail('invalid', 'Choose how many to make (1-' + MAX_BATCH_SIZE + ').');
    }
    if (quantity > MAX_BATCH_SIZE) {
      return this.fail('invalid', 'You can only make ' + MAX_BATCH_SIZE + ' at a time.');
    }
    if (!this.isRecipeKnown(recipe)) {
      return this.fail('locked', 'You have not learned how to make ' + recipe.name + ' yet.');
    }
    const skillLevel = this.getSkillLevel(recipe.skill);
    if (skillLevel < recipe.levelReq) {
      return this.fail(
        'skill_too_low',
        'You need ' + recipe.skill + ' level ' + recipe.levelReq + ' (you are ' + skillLevel + ').'
      );
    }
    if (!this.hasStation(recipe.station)) {
      return this.fail('wrong_location', this.stationRequirementText(recipe.station) + ' to craft ' + recipe.name + '.');
    }
    if (ctx.state.crafting.jobs.length >= MAX_CONCURRENT_JOBS) {
      return this.fail('busy', 'Your workbench is already busy. Wait for a job to finish.');
    }
    const requirements = recipe.inputs.map((input) => ({
      itemId: input.itemId,
      quantity: input.quantity * quantity,
    }));
    const missing = this.firstMissingRequirement(requirements);
    if (missing) {
      return this.fail('not_enough_items', 'You need ' + missing + '.');
    }
    return { ok: true, message: 'Ready to craft ' + recipe.name + '.' };
  }

  private firstMissingRequirement(requirements: readonly { itemId: ItemId; quantity: number }[]): string | null {
    const inventory = this.inventory();
    for (const requirement of requirements) {
      const have = countItem(inventory, requirement.itemId);
      if (have >= requirement.quantity) continue;
      const name = this.ctx?.content.resolveItemName(requirement.itemId) ?? requirement.itemId;
      return name + ' (have ' + have + '/' + requirement.quantity + ')';
    }
    return null;
  }

  private stationRequirementText(station: CraftStation): string {
    switch (station) {
      case 'workbench':
        return 'You need a workbench';
      case 'kitchen':
        return 'You need a kitchen';
      case 'campfire':
        return 'You need a campfire or hearth';
      case 'forge':
        return 'You need a workbench with forge tools';
      case 'art_studio':
        return 'You need an art studio or a workbench and paintbrush';
      default:
        return 'You need a station';
    }
  }

  // -------------------------------------------------------------------------
  // Internals - job completion
  // -------------------------------------------------------------------------
  private completeJob(job: CraftJobState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const recipe = ctx.content.getRecipe(job.recipeId);
    const state = ctx.state;
    if (!recipe) {
      ctx.logger.warn('Craft job references an unknown recipe', job.recipeId);
      this.forgetJobQuality(job.id);
      return;
    }
    const now = ctx.clock.simTimeSeconds;
    const avgInputQuality = this.readJobQuality(job.id) ?? DEFAULT_INPUT_QUALITY;
    const skillLevel = this.getSkillLevel(recipe.skill);
    const maxLevel = WORLD_CONFIG.skill.maxLevel;
    const skillLevelFactor = 1 + 4 * clamp((skillLevel - 1) / Math.max(1, maxLevel - 1), 0, 1);
    const jitter = ctx.probability.floatRange(CRAFTING_QUALITY_STREAM, 1, 5);
    const rawQuality =
      avgInputQuality * 0.6 + skillLevelFactor * 0.3 + jitter * 0.1;
    const quality = clamp(Math.round(rawQuality), 1, 5) as QualityStars;

    let totalOutputs = 0;
    for (const output of recipe.outputs) {
      const quantity = output.quantity * job.quantity;
      if (quantity <= 0) continue;
      const def = ctx.content.getItem(output.itemId);
      addItemToInventory(state.player.inventory, output.itemId, quantity, {
        quality,
        freshness: 1,
        simTime: now,
        maxStack: def?.maxStack ?? 99,
      });
      totalOutputs += quantity;
      ctx.bus.emit('item:acquired', {
        itemId: output.itemId,
        quantity,
        quality,
        source: 'crafting:' + recipe.id,
      });
    }

    state.crafting.mastery[recipe.id] = (state.crafting.mastery[recipe.id] ?? 0) + 1;
    state.player.statistics.itemsCrafted += totalOutputs;
    state.crafting.lastCraftAt = now;

    const baseXp = SKILL_ACTIVITY_XP[recipe.skill] * (1 + recipe.hours * 0.25) + recipe.levelReq * 2;
    const xp = Math.max(1, Math.round(baseXp * job.quantity));
    this.skillSystem()?.addXp(recipe.skill, xp, 'crafting:' + recipe.id);

    this.forgetJobQuality(job.id);
    const data: JsonValue = {
      recipeId: recipe.id,
      quantity: job.quantity,
      quality,
      xp,
      outputs: recipe.outputs.map((output) => ({
        itemId: output.itemId,
        quantity: output.quantity * job.quantity,
      })),
    };
    ctx.bus.emit('game:signal', { name: 'craft:completed', data });
  }

  private effectiveHours(recipe: RecipeDef, quantity: number): number {
    const mastery = this.getMastery(recipe.id);
    const speedBonus = Math.min(MAX_MASTERY_SPEED_BONUS, mastery * MASTERY_SPEED_PER_LEVEL);
    return Math.max(0.05, recipe.hours * quantity * (1 - speedBonus));
  }

  private averageInputQuality(requirements: readonly { itemId: ItemId; quantity: number }[]): number {
    const inventory = this.inventory();
    let weighted = 0;
    let counted = 0;
    for (const requirement of requirements) {
      let remaining = requirement.quantity;
      for (const entry of inventory) {
        if (remaining <= 0) break;
        if (entry.itemId !== requirement.itemId) continue;
        const take = Math.min(entry.quantity, remaining);
        weighted += entry.quality * take;
        counted += take;
        remaining -= take;
      }
    }
    if (counted <= 0) return DEFAULT_INPUT_QUALITY;
    return weighted / counted;
  }

  private nextJobId(): string {
    const ctx = this.ctx;
    if (!ctx) return 'craft_0_1';
    const existing = new Set(ctx.state.crafting.jobs.map((job) => job.id));
    const stamp = Math.round(ctx.clock.simTimeSeconds);
    let counter = 1;
    let candidate = 'craft_' + stamp + '_' + counter;
    while (existing.has(candidate)) {
      counter += 1;
      candidate = 'craft_' + stamp + '_' + counter;
    }
    return candidate;
  }

  // -------------------------------------------------------------------------
  // Internals - unlocks & stations
  // -------------------------------------------------------------------------
  private indexUnlockItems(): void {
    const ctx = this.requireContext();
    if (!ctx) return;
    this.recipeByUnlockItem.clear();
    for (const recipe of ctx.content.getAllRecipes()) {
      if (!recipe.unlockItemId) continue;
      const bucket = this.recipeByUnlockItem.get(recipe.unlockItemId);
      if (bucket) bucket.push(recipe);
      else this.recipeByUnlockItem.set(recipe.unlockItemId, [recipe]);
    }
  }

  private syncKnownRecipesFromInventory(): void {
    const ctx = this.requireContext();
    if (!ctx) return;
    const seen = new Set<ItemId>();
    for (const entry of ctx.state.player.inventory) {
      if (seen.has(entry.itemId)) continue;
      seen.add(entry.itemId);
      this.handleItemAcquired(entry.itemId);
    }
  }

  private handleItemAcquired(itemId: ItemId): void {
    const ctx = this.requireContext();
    if (!ctx) return;
    const itemDef = ctx.content.getItem(itemId);
    let unlockedAny = false;
    if (itemDef?.unlocksRecipes) {
      for (const recipeId of itemDef.unlocksRecipes) {
        if (this.learnRecipe(recipeId, ctx.state.player.knownRecipes)) unlockedAny = true;
      }
    }
    const recipes = this.recipeByUnlockItem.get(itemId);
    if (recipes) {
      for (const recipe of recipes) {
        const target = recipe.category === 'cook' ? ctx.state.cooking.knownRecipes : ctx.state.player.knownRecipes;
        if (this.learnRecipe(recipe.id, target)) unlockedAny = true;
      }
    }
    if (unlockedAny) {
      const data: JsonValue = { itemId };
      ctx.bus.emit('game:signal', { name: 'craft:recipes-unlocked', data });
    }
  }

  private learnRecipe(recipeId: RecipeId, list: string[]): boolean {
    const ctx = this.requireContext();
    if (!ctx) return false;
    if (!ctx.content.getRecipe(recipeId)) return false;
    if (list.includes(recipeId)) return false;
    list.push(recipeId);
    return true;
  }

  private isRecipeKnown(recipe: RecipeDef): boolean {
    const ctx = this.requireContext();
    if (!ctx) return false;
    if (!recipe.unlockItemId) return true;
    if (ctx.state.player.knownRecipes.includes(recipe.id)) return true;
    if (ctx.state.cooking.knownRecipes.includes(recipe.id)) return true;
    return false;
  }

  private getSkillLevel(skill: RecipeDef['skill']): number {
    const ctx = this.requireContext();
    if (!ctx) return 1;
    return this.skillSystem()?.getLevel(skill) ?? ctx.state.player.skills[skill]?.level ?? 1;
  }

  private skillSystem(): ISkillSystem | null {
    const ctx = this.ctx;
    if (!ctx || !ctx.registry.has('skill')) return null;
    return ctx.registry.getRequired<ISkillSystem>('skill');
  }

  private playerFacilities(): Set<string> {
    const ctx = this.ctx;
    const facilities = new Set<string>();
    if (!ctx) return facilities;
    const locationId = ctx.state.player.position.locationId;
    const def = ctx.content.getLocation(locationId);
    if (def) for (const facility of def.facilities) facilities.add(facility);
    return facilities;
  }

  private playerHome(): HomeState | undefined {
    const ctx = this.ctx;
    if (!ctx) return undefined;
    return findHomeAtLocation(ctx, ctx.state.player.position.locationId);
  }

  private homeGrantsStation(home: HomeState, station: CraftStation): boolean {
    for (const placed of home.furniture as PlacedFurnitureState[]) {
      const grants = FURNITURE_STATION_GRANTS[placed.furnitureId];
      if (grants && grants.includes(station)) return true;
    }
    // Built rooms provide their own station: a workshop has a bench and hand forge,
    // a kitchen room is a kitchen (blueprints promise exactly this).
    const roomIds = new Set(home.rooms.map((room) => room.id));
    if (roomIds.has('workshop') && (station === 'workbench' || station === 'forge')) return true;
    if (roomIds.has('kitchen') && station === 'kitchen') return true;
    return false;
  }

  private inventory() {
    const ctx = this.requireContext();
    if (!ctx) return [];
    return ctx.state.player.inventory;
  }

  private rememberJobQuality(jobId: string, quality: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const player = ctx.state.player;
    const extras = player.extras ?? (player.extras = {});
    const existing = extras[JOB_QUALITY_EXTRAS_KEY];
    let bag: Record<string, JsonValue> = {};
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      bag = { ...existing };
    }
    bag[jobId] = clamp(quality, 1, 5);
    extras[JOB_QUALITY_EXTRAS_KEY] = bag;
  }

  private readJobQuality(jobId: string): number | undefined {
    const ctx = this.ctx;
    if (!ctx) return undefined;
    const existing = ctx.state.player.extras?.[JOB_QUALITY_EXTRAS_KEY];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return undefined;
    const value = existing[jobId];
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return clamp(value, 1, 5);
  }

  private forgetJobQuality(jobId: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const extras = ctx.state.player.extras;
    if (!extras) return;
    const existing = extras[JOB_QUALITY_EXTRAS_KEY];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return;
    if (!(jobId in existing)) return;
    const bag = { ...existing };
    delete bag[jobId];
    if (Object.keys(bag).length === 0) delete extras[JOB_QUALITY_EXTRAS_KEY];
    else extras[JOB_QUALITY_EXTRAS_KEY] = bag;
  }

  private requireContext(): IGameContext | null {
    if (!this.ctx) return null;
    return this.ctx;
  }

  private fail(code: ActionResult['code'], message: string): ActionResult {
    const result: ActionResult = { ok: false, message };
    if (code) result.code = code;
    return result;
  }
}

// ---------------------------------------------------------------------------
// Shared location/home lookup used by Crafting, Cooking, Housing and Building.
// ---------------------------------------------------------------------------
export function findHomeAtLocation(ctx: IGameContext, locationId: LocationId): HomeState | undefined {
  const homes = Object.values(ctx.state.housing.homes);
  for (const home of homes) {
    if (home.locationId === locationId) return home;
    if (interiorIdFor(home.locationId) === locationId) return home;
    const def = ctx.content.getLocation(locationId);
    if (def?.entranceFrom && def.entranceFrom === home.locationId) return home;
  }
  // Fall back to the home either side of the interior/exterior pair.
  if (locationId === HOME_INTERIOR_ID || locationId === LOC.home) {
    for (const home of homes) {
      const homeDef = ctx.content.getLocation(home.locationId);
      if (home.locationId === HOME_INTERIOR_ID || home.locationId === LOC.home) return home;
      if (homeDef && (homeDef.entranceFrom === LOC.home || homeDef.entranceFrom === HOME_INTERIOR_ID)) return home;
    }
  }
  return undefined;
}
