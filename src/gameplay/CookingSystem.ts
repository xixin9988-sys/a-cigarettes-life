import type {
  ActionResult,
  CookingState,
  HomeState,
  ICookingSystem,
  IGameContext,
  ISkillSystem,
  StatusEffectState,
} from '../core/contracts';
import type { FacilityKind, ItemDef, ItemEffect, RecipeDef } from '../data/schema';
import type { ItemId, JsonValue, QualityStars, RecipeId } from '../core/SharedTypes';
import { ITEM } from '../data/items/ids';
import { SKILL_ACTIVITY_XP, WORLD_CONFIG } from '../core/WorldConfig';
import { addItemToInventory, consumeItems, countItem, hasItems } from '../core/InventoryUtil';
import { clamp, clamp01 } from '../core/utils';
import { findHomeAtLocation } from './CraftingSystem';

/**
 * CookingSystem (id 'cooking') - kitchen / campfire cooking with persistent food buffs.
 *
 * QUALITY FORMULA (same inherited-quality model as crafting):
 *   quality = clamp(round(avgInputQuality * 0.6 + skillLevelFactor * 0.3 + jitter * 0.1), 1, 5)
 *   jitter is drawn from probability stream 'cooking.quality'.
 *   mastery adds up to +0.3 to the skill factor (never past 1..5 bounds).
 *
 * FRESHNESS: output freshness = clamp01(avgInputFreshness * 0.85 + 0.15).
 *
 * FOOD EFFECTS: there is no player hunger meter (the player is a cigarette), so every
 * ItemEffect kind is mapped onto a timed StatusEffectState:
 *   energy      -> energyRegenPerHour
 *   hunger      -> energyRegenPerHour * 0.5 (satiety buffers energy)
 *   fun/social/mood -> skillXpMultiplier +1% per point (capped +25%)
 *   moisture_down/up -> moistureChangePerHour (capped +-0.5/h)
 *   burn_slow   -> burnRateMultiplier (never below 0.55)
 *   skill_xp    -> instant XP if the effect names a skill, else skillXpMultiplier buff
 *   luck        -> small skillXpMultiplier bonus
 *   influence   -> immediate player.influence
 * All timed buffs are capped to MAX_BUFF_HOURS and mirrored in state.cooking.buffs (persisted)
 * and player.statusEffects (read by SkillSystem / cigarette physics). Quality scales each
 * effect value by (0.8 + 0.08 * quality) so a perfect meal is worth 20% more.
 */
const SIM_SECONDS_PER_GAME_HOUR = 60;
const COOKING_QUALITY_STREAM = 'cooking.quality';
const QUALITY_INPUT_WEIGHT = 0.6;
const QUALITY_SKILL_WEIGHT = 0.3;
const QUALITY_LUCK_WEIGHT = 0.1;
const DEFAULT_INPUT_QUALITY = 2.5;
const MAX_BUFF_HOURS = 12;
const MAX_ACTIVE_FOOD_BUFFS = 5;
const MASTERY_FACTOR_BONUS_CAP = 0.3;
const COOKING_BUFF_SOURCE_PREFIX = 'cooking:';
const COOKING_BUFF_ID_PREFIX = 'cook:';

const DEFAULT_BUFF_HOURS: Partial<Record<ItemEffect['kind'], number>> = {
  energy: 3,
  hunger: 3,
  fun: 3,
  social: 3,
  mood: 3,
  moisture_down: 1,
  moisture_up: 1,
  burn_slow: 2,
  skill_xp: 2,
  luck: 4,
};

const KITCHEN_FACILITIES: readonly FacilityKind[] = ['kitchen', 'cafe', 'bakery'];
const CAMPFIRE_FACILITIES: readonly FacilityKind[] = ['campfire'];

const FURNITURE_KITCHEN: readonly string[] = [ITEM.stove, ITEM.kitchenCounter];
const FURNITURE_CAMPFIRE: readonly string[] = [ITEM.fireplace];

export class CookingSystem implements ICookingSystem {
  readonly id = 'cooking';

  private ctx: IGameContext | null = null;
  private buffCounter = 0;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.syncKnownRecipes();
    ctx.bus.on('item:acquired', (payload) => {
      this.learnFromItem(payload.itemId);
    });
  }

  update(_dtSimSeconds: number): void {
    this.pruneExpiredBuffs();
  }

  // -------------------------------------------------------------------------
  // ICookingSystem
  // -------------------------------------------------------------------------
  cook(recipeId: RecipeId): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return this.fail('not_found', 'Cooking is not available yet.');
    const recipe = ctx.content.getRecipe(recipeId);
    if (!recipe) return this.fail('not_found', 'No such recipe.');
    if (recipe.category !== 'cook') {
      return this.fail('invalid', recipe.name + ' is a crafting recipe - use a workbench.');
    }
    if (!this.isKnown(recipe)) {
      return this.fail('locked', 'You have not learned how to cook ' + recipe.name + ' yet.');
    }
    const skillLevel = this.getSkillLevel('cooking');
    if (skillLevel < recipe.levelReq) {
      return this.fail(
        'skill_too_low',
        'You need cooking level ' + recipe.levelReq + ' (you are ' + skillLevel + ').'
      );
    }
    const station = recipe.station === 'campfire' ? 'campfire' : 'kitchen';
    if (!this.hasStation(station)) {
      return this.fail(
        'wrong_location',
        station === 'kitchen'
          ? 'You need a kitchen to cook ' + recipe.name + '.'
          : 'You need a campfire or hearth to cook ' + recipe.name + '.'
      );
    }
    const missing = this.firstMissingRequirement(recipe);
    if (missing) return this.fail('not_enough_items', 'You need ' + missing + '.');
    if (!hasItems(ctx.state.player.inventory, recipe.inputs)) {
      return this.fail('not_enough_items', 'You are missing ingredients.');
    }

    const avgInputQuality = this.averageInputQuality(recipe);
    const avgInputFreshness = this.averageInputFreshness(recipe);
    if (!consumeItems(ctx.state.player.inventory, recipe.inputs)) {
      return this.fail('not_enough_items', 'You are missing ingredients.');
    }

    const now = ctx.clock.simTimeSeconds;
    const quality = this.rollQuality(recipe, skillLevel, avgInputQuality);
    const freshness = clamp01(avgInputFreshness * 0.85 + 0.15);

    let meals = 0;
    for (const output of recipe.outputs) {
      const def = ctx.content.getItem(output.itemId);
      addItemToInventory(ctx.state.player.inventory, output.itemId, output.quantity, {
        quality,
        freshness,
        simTime: now,
        maxStack: def?.maxStack ?? 99,
      });
      if (def?.edible) meals += output.quantity;
      ctx.bus.emit('item:acquired', {
        itemId: output.itemId,
        quantity: output.quantity,
        quality,
        source: COOKING_BUFF_SOURCE_PREFIX + recipe.id,
      });
    }
    if (meals === 0) meals = 1;

    this.applyFoodEffects(recipe, quality, now);
    ctx.state.cooking.mastery[recipe.id] = (ctx.state.cooking.mastery[recipe.id] ?? 0) + 1;
    ctx.state.cooking.lastCookAt = now;
    ctx.state.player.statistics.mealsCooked += meals;

    const qualityMultiplier = 0.8 + quality * 0.1;
    const xp = Math.max(
      1,
      Math.round((SKILL_ACTIVITY_XP.cooking * (1 + recipe.hours * 0.3) + recipe.levelReq * 2) * qualityMultiplier)
    );
    this.skillSystem()?.addXp('cooking', xp, 'cooking:' + recipe.id);

    const data: JsonValue = {
      recipeId: recipe.id,
      quality,
      freshness,
      xp,
      outputs: recipe.outputs.map((output) => ({ itemId: output.itemId, quantity: output.quantity })),
    };
    ctx.bus.emit('game:signal', { name: 'cook:completed', data });
    return {
      ok: true,
      message: 'Cooked ' + recipe.name + ' (' + quality + ' stars).',
      stateChanged: true,
      data,
    };
  }

  getKnownRecipes(): RecipeDef[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    return ctx.content
      .getAllRecipes()
      .filter((recipe) => recipe.category === 'cook' && this.isKnown(recipe))
      .sort((a, b) => a.levelReq - b.levelReq || a.hours - b.hours || a.id.localeCompare(b.id));
  }

  getCookingState(): CookingState {
    const ctx = this.ctx;
    if (!ctx) return { knownRecipes: [], mastery: {}, lastCookAt: 0, buffs: [] };
    return ctx.state.cooking;
  }

  // -------------------------------------------------------------------------
  // Extra public helpers (UI / other systems)
  // -------------------------------------------------------------------------
  /** Known recipes that this kitchen/campfire can actually cook right now. */
  getCookableRecipes(): RecipeDef[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    const skillLevel = this.getSkillLevel('cooking');
    return this.getKnownRecipes().filter((recipe) => {
      if (skillLevel < recipe.levelReq) return false;
      const station = recipe.station === 'campfire' ? 'campfire' : 'kitchen';
      if (!this.hasStation(station)) return false;
      return hasItems(ctx.state.player.inventory, recipe.inputs);
    });
  }

  hasStation(station: 'kitchen' | 'campfire'): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const facilities = this.playerFacilities();
    const required = station === 'kitchen' ? KITCHEN_FACILITIES : CAMPFIRE_FACILITIES;
    if (required.some((facility) => facilities.has(facility))) return true;
    const home = this.playerHome();
    if (!home) return false;
    if (station === 'kitchen' && home.rooms.some((room) => room.id === 'kitchen')) return true;
    const granted = station === 'kitchen' ? FURNITURE_KITCHEN : FURNITURE_CAMPFIRE;
    return home.furniture.some((placed) => granted.includes(placed.furnitureId));
  }

  /** Active food buffs, newest first. */
  getActiveBuffs(): StatusEffectState[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    return ctx.state.cooking.buffs.map((buff) => ({ ...buff }));
  }

  getMastery(recipeId: RecipeId): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    return ctx.state.cooking.mastery[recipeId] ?? 0;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  private rollQuality(recipe: RecipeDef, skillLevel: number, avgInputQuality: number): QualityStars {
    const ctx = this.ctx;
    if (!ctx) return 1;
    const mastery = this.getMastery(recipe.id);
    const masteryBonus = Math.min(MASTERY_FACTOR_BONUS_CAP, mastery * 0.02);
    const maxLevel = WORLD_CONFIG.skill.maxLevel;
    const skillFactor = clamp(1 + 4 * clamp((skillLevel - 1) / Math.max(1, maxLevel - 1), 0, 1) + masteryBonus, 1, 5);
    const jitter = ctx.probability.floatRange(COOKING_QUALITY_STREAM, 1, 5);
    const raw = avgInputQuality * QUALITY_INPUT_WEIGHT + skillFactor * QUALITY_SKILL_WEIGHT + jitter * QUALITY_LUCK_WEIGHT;
    return clamp(Math.round(raw), 1, 5) as QualityStars;
  }

  private averageInputQuality(recipe: RecipeDef): number {
    const ctx = this.ctx;
    if (!ctx) return DEFAULT_INPUT_QUALITY;
    const inventory = ctx.state.player.inventory;
    let weighted = 0;
    let counted = 0;
    for (const input of recipe.inputs) {
      let remaining = input.quantity;
      for (const entry of inventory) {
        if (remaining <= 0) break;
        if (entry.itemId !== input.itemId) continue;
        const take = Math.min(entry.quantity, remaining);
        weighted += entry.quality * take;
        counted += take;
        remaining -= take;
      }
    }
    return counted > 0 ? weighted / counted : DEFAULT_INPUT_QUALITY;
  }

  private averageInputFreshness(recipe: RecipeDef): number {
    const ctx = this.ctx;
    if (!ctx) return 1;
    const inventory = ctx.state.player.inventory;
    let weighted = 0;
    let counted = 0;
    for (const input of recipe.inputs) {
      let remaining = input.quantity;
      for (const entry of inventory) {
        if (remaining <= 0) break;
        if (entry.itemId !== input.itemId) continue;
        const take = Math.min(entry.quantity, remaining);
        weighted += entry.freshness * take;
        counted += take;
        remaining -= take;
      }
    }
    return counted > 0 ? weighted / counted : 1;
  }

  private firstMissingRequirement(recipe: RecipeDef): string | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    for (const input of recipe.inputs) {
      const have = countItem(ctx.state.player.inventory, input.itemId);
      if (have >= input.quantity) continue;
      const name = ctx.content.resolveItemName(input.itemId);
      return name + ' (have ' + have + '/' + input.quantity + ')';
    }
    return null;
  }

  private applyFoodEffects(recipe: RecipeDef, quality: QualityStars, now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const factor = 0.8 + quality * 0.08;
    for (const output of recipe.outputs) {
      const def = ctx.content.getItem(output.itemId);
      if (!def || !def.effects || def.effects.length === 0) continue;
      for (const effect of def.effects) {
        this.applyEffect(recipe, def, effect, factor, now);
      }
    }
  }

  private applyEffect(recipe: RecipeDef, def: ItemDef, effect: ItemEffect, factor: number, now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const scaled = effect.value * factor;
    if (effect.kind === 'influence') {
      ctx.state.player.influence = Math.max(0, ctx.state.player.influence + Math.round(scaled));
      return;
    }
    if (effect.kind === 'skill_xp' && effect.skill) {
      this.skillSystem()?.addXp(effect.skill, Math.max(1, Math.round(scaled)), 'meal:' + def.id);
      return;
    }
    const buff = this.buildBuff(recipe, def, effect, scaled, now);
    if (!buff) return;
    this.pushBuff(buff);
  }

  private buildBuff(
    recipe: RecipeDef,
    def: ItemDef,
    effect: ItemEffect,
    scaled: number,
    now: number
  ): StatusEffectState | null {
    const hours = clamp(effect.durationHours ?? DEFAULT_BUFF_HOURS[effect.kind] ?? 2, 0.25, MAX_BUFF_HOURS);
    this.buffCounter += 1;
    const base: StatusEffectState = {
      id: COOKING_BUFF_ID_PREFIX + recipe.id + ':' + effect.kind + ':' + this.buffCounter,
      label: def.name + ' (' + effect.kind.replace(/_/g, ' ') + ')',
      source: COOKING_BUFF_SOURCE_PREFIX + recipe.id,
      startedAt: now,
      expiresAt: now + hours * SIM_SECONDS_PER_GAME_HOUR,
    };
    switch (effect.kind) {
      case 'energy':
        base.energyRegenPerHour = Math.max(0, scaled);
        return base;
      case 'hunger':
        // No player hunger meter: satiety shows up as steadier energy regen.
        base.energyRegenPerHour = Math.max(0, scaled * 0.5);
        return base;
      case 'fun':
      case 'social':
      case 'mood':
        base.skillXpMultiplier = 1 + clamp(scaled * 0.01, 0, 0.25);
        return base;
      case 'moisture_down':
        base.moistureChangePerHour = -clamp(scaled * 0.01, 0, 0.5);
        return base;
      case 'moisture_up':
        base.moistureChangePerHour = clamp(scaled * 0.01, 0, 0.5);
        return base;
      case 'burn_slow':
        base.burnRateMultiplier = Math.max(0.55, 1 - clamp(scaled * 0.01, 0, 0.4));
        return base;
      case 'skill_xp':
        base.skillXpMultiplier = 1 + clamp(scaled * 0.01, 0, 0.5);
        return base;
      case 'luck':
        base.skillXpMultiplier = 1 + clamp(scaled * 0.005, 0, 0.1);
        return base;
      default:
        return null;
    }
  }

  private pushBuff(buff: StatusEffectState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const cooking = ctx.state.cooking;
    const statusEffects = ctx.state.player.statusEffects;
    // Keep at most MAX_ACTIVE_FOOD_BUFFS: drop the oldest food buff (both mirrors).
    while (cooking.buffs.length >= MAX_ACTIVE_FOOD_BUFFS) {
      const oldest = cooking.buffs.shift();
      if (!oldest) break;
      const index = statusEffects.findIndex((effect) => effect.id === oldest.id);
      if (index >= 0) statusEffects.splice(index, 1);
    }
    cooking.buffs.push(buff);
    statusEffects.push(buff);
  }

  private pruneExpiredBuffs(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.clock.simTimeSeconds;
    const cooking = ctx.state.cooking;
    let changed = false;
    for (let index = cooking.buffs.length - 1; index >= 0; index -= 1) {
      const buff = cooking.buffs[index];
      if (!buff) continue;
      if (buff.expiresAt === null || buff.expiresAt > now) continue;
      cooking.buffs.splice(index, 1);
      changed = true;
    }
    const statusEffects = ctx.state.player.statusEffects;
    const filtered = statusEffects.filter((effect) => {
      if (!effect.id.startsWith(COOKING_BUFF_ID_PREFIX)) return true;
      if (effect.expiresAt === null) return false;
      return effect.expiresAt > now;
    });
    if (filtered.length !== statusEffects.length) {
      ctx.state.player.statusEffects = filtered;
      changed = true;
    }
    if (changed) {
      const activeIds = new Set(cooking.buffs.map((buff) => buff.id));
      const mirror = cooking.buffs.filter((buff) => activeIds.has(buff.id));
      if (mirror.length !== cooking.buffs.length) cooking.buffs = mirror;
    }
  }

  private syncKnownRecipes(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const seen = new Set<ItemId>();
    for (const entry of ctx.state.player.inventory) {
      if (seen.has(entry.itemId)) continue;
      seen.add(entry.itemId);
      this.learnFromItem(entry.itemId);
    }
  }

  private learnFromItem(itemId: ItemId): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const itemDef = ctx.content.getItem(itemId);
    let learned = false;
    if (itemDef?.unlocksRecipes) {
      for (const recipeId of itemDef.unlocksRecipes) {
        const recipe = ctx.content.getRecipe(recipeId);
        if (!recipe || recipe.category !== 'cook') continue;
        if (ctx.state.cooking.knownRecipes.includes(recipeId)) continue;
        ctx.state.cooking.knownRecipes.push(recipeId);
        learned = true;
      }
    }
    for (const recipe of ctx.content.getAllRecipes()) {
      if (recipe.category !== 'cook') continue;
      if (recipe.unlockItemId !== itemId) continue;
      if (ctx.state.cooking.knownRecipes.includes(recipe.id)) continue;
      ctx.state.cooking.knownRecipes.push(recipe.id);
      learned = true;
    }
    if (learned) {
      const data: JsonValue = { itemId };
      ctx.bus.emit('game:signal', { name: 'cook:recipes-unlocked', data });
    }
  }

  private isKnown(recipe: RecipeDef): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (!recipe.unlockItemId) return true;
    if (ctx.state.cooking.knownRecipes.includes(recipe.id)) return true;
    if (ctx.state.player.knownRecipes.includes(recipe.id)) return true;
    return false;
  }

  private getSkillLevel(skill: 'cooking'): number {
    const ctx = this.ctx;
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
    const def = ctx.content.getLocation(ctx.state.player.position.locationId);
    if (def) for (const facility of def.facilities) facilities.add(facility);
    return facilities;
  }

  private playerHome(): HomeState | undefined {
    const ctx = this.ctx;
    if (!ctx) return undefined;
    return findHomeAtLocation(ctx, ctx.state.player.position.locationId);
  }

  private fail(code: ActionResult['code'], message: string): ActionResult {
    const result: ActionResult = { ok: false, message };
    if (code) result.code = code;
    return result;
  }
}
