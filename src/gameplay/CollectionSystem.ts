import type {
  ActionResult,
  CollectionEntryState,
  CollectionState,
  ICollectionSystem,
  IGameContext,
  WorldHistoryEntry,
} from '../core/contracts';
import type { CollectionCategoryDef, ItemDef } from '../data/schema';
import type { EntityId, ItemId, JsonValue, QualityStars } from '../core/SharedTypes';
import { LOC, interiorIdFor } from '../data/locations/ids';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { countItem, removeItemFromInventory } from '../core/InventoryUtil';
import { clamp } from '../core/utils';

/**
 * CollectionSystem (id 'collection') - the naturalist's catalogue and museum donations.
 *
 * An item belongs to a collection category when its ItemCategory OR one of its tags
 * matches one of the category's itemTags (see src/data/collection/categories.ts).
 * `state.collection.totalSpeciesKnown` holds the size of that catalog (the number of
 * distinct collectible species/entries in the content pack) so getProgress().total is
 * stable across saves; entries are registered from the 'item:acquired' bus event, so
 * anything the player finds - fished, foraged, grown, cooked or crafted - is recorded.
 *
 * Photographs are PhotoState records (exploration), not inventory items; they are grouped
 * in the collection UI but are intentionally excluded from the item catalog totals.
 */
const PLAYER_ID = 'player';

export interface CollectionCategoryProgress {
  id: string;
  name: string;
  known: number;
  total: number;
}

export class CollectionSystem implements ICollectionSystem {
  readonly id = 'collection';

  private ctx: IGameContext | null = null;
  private catalogIds: ItemId[] = [];
  private catalogIndex = new Map<ItemId, CollectionCategoryDef>();

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.rebuildCatalog();
    ctx.bus.on('item:acquired', (payload) => {
      this.recordAcquiredItem(payload.itemId, payload.quality);
    });
    // Rebuild from anything already in the player's inventory (e.g. loading an older save).
    const seen = new Set<ItemId>();
    for (const entry of ctx.state.player.inventory) {
      if (seen.has(entry.itemId)) continue;
      seen.add(entry.itemId);
      this.recordAcquiredItem(entry.itemId, entry.quality);
    }
  }

  update(_dtSimSeconds: number): void {
    // Collection entries only change when items are acquired/donated.
  }

  // -------------------------------------------------------------------------
  // ICollectionSystem
  // -------------------------------------------------------------------------
  registerItem(itemId: ItemId, quality: QualityStars): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return this.fail('not_found', 'The collection is not available yet.');
    const item = ctx.content.getItem(itemId);
    if (!item) return this.fail('not_found', 'Unknown item: ' + itemId);
    const category = this.catalogIndex.get(itemId);
    if (!category) {
      return this.fail('not_allowed', item.name + ' does not belong in any collection.');
    }
    const safeQuality = clamp(Math.round(quality), 1, 5) as QualityStars;
    const now = ctx.clock.simTimeSeconds;
    const collection = ctx.state.collection;
    const existing = collection.entries[itemId];
    if (existing) {
      existing.count += 1;
      if (safeQuality > existing.bestQuality) existing.bestQuality = safeQuality;
      const data: JsonValue = { itemId, categoryId: category.id, count: existing.count, bestQuality: existing.bestQuality };
      return { ok: true, message: item.name + ' logged again (' + existing.count + ').', stateChanged: true, data };
    }
    const entry: CollectionEntryState = {
      itemId,
      firstCollectedAt: now,
      count: 1,
      bestQuality: safeQuality,
      donated: false,
    };
    collection.entries[itemId] = entry;
    collection.totalSpeciesKnown = this.catalogIds.length;
    const data: JsonValue = {
      itemId,
      itemName: item.name,
      categoryId: category.id,
      categoryName: category.name,
      known: Object.keys(collection.entries).length,
      total: this.catalogIds.length,
    };
    ctx.bus.emit('game:signal', { name: 'collection:registered', data });
    return { ok: true, message: 'Added ' + item.name + ' to your ' + category.name + ' collection.', stateChanged: true, data };
  }

  donateToMuseum(itemId: ItemId): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return this.fail('not_found', 'The collection is not available yet.');
    if (!this.playerAtMuseum()) {
      return this.fail('wrong_location', 'Donations are made in person at the Ashford Museum.');
    }
    const item = ctx.content.getItem(itemId);
    if (!item) return this.fail('not_found', 'Unknown item: ' + itemId);
    const collection = ctx.state.collection;
    const entry = collection.entries[itemId];
    if (!entry) return this.fail('not_found', 'That is not in your collection book yet.');
    if (entry.donated) {
      return this.fail('not_allowed', 'The museum already has one of those on display.');
    }
    const have = countItem(ctx.state.player.inventory, itemId);
    if (have < 1) {
      return this.fail('not_enough_items', 'You do not have a ' + item.name + ' to donate.');
    }
    removeItemFromInventory(ctx.state.player.inventory, itemId, 1);
    entry.donated = true;
    collection.donatedCount += 1;
    ctx.state.player.influence = Math.max(0, ctx.state.player.influence + 1);
    ctx.state.player.communityPoints += 1;
    ctx.bus.emit('item:lost', { itemId, quantity: 1, reason: 'museum_donation' });
    this.appendHistory('discovery', 'You donated a ' + item.name + ' to the Ashford Museum.', 3);
    const data: JsonValue = {
      itemId,
      itemName: item.name,
      donatedCount: collection.donatedCount,
      total: this.catalogIds.length,
    };
    ctx.bus.emit('game:signal', { name: 'collection:donated', data });
    return {
      ok: true,
      message: 'The museum gratefully accepts your ' + item.name + '.',
      stateChanged: true,
      data,
    };
  }

  getProgress(): { known: number; total: number; donated: number } {
    const ctx = this.ctx;
    if (!ctx) return { known: 0, total: 0, donated: 0 };
    return {
      known: Object.keys(ctx.state.collection.entries).length,
      total: this.catalogIds.length,
      donated: ctx.state.collection.donatedCount,
    };
  }

  isCollected(itemId: ItemId): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    return ctx.state.collection.entries[itemId] !== undefined;
  }

  // -------------------------------------------------------------------------
  // Extra public helpers (UI)
  // -------------------------------------------------------------------------
  getCategoryProgress(): CollectionCategoryProgress[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    const categories = ctx.content.pack.collectionCategories;
    const catalogByCategory = this.buildCatalogByCategory();
    const result: CollectionCategoryProgress[] = [];
    for (const category of categories) {
      const ids = catalogByCategory.get(category.id) ?? [];
      let known = 0;
      for (const id of ids) {
        if (ctx.state.collection.entries[id]) known += 1;
      }
      result.push({ id: category.id, name: category.name, known, total: ids.length });
    }
    return result;
  }

  getCatalog(): ItemDef[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    const items: ItemDef[] = [];
    for (const id of this.catalogIds) {
      const item = ctx.content.getItem(id);
      if (item) items.push(item);
    }
    return items;
  }

  getEntries(): CollectionEntryState[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    return Object.values(ctx.state.collection.entries).map((entry) => ({ ...entry }));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  private rebuildCatalog(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const categories = ctx.content.pack.collectionCategories;
    this.catalogIndex.clear();
    this.catalogIds = [];
    for (const item of ctx.content.getAllItems()) {
      const category = this.categoryForItem(item, categories);
      if (!category) continue;
      if (this.catalogIndex.has(item.id)) continue;
      this.catalogIndex.set(item.id, category);
      this.catalogIds.push(item.id);
    }
    ctx.state.collection.totalSpeciesKnown = this.catalogIds.length;
  }

  private buildCatalogByCategory(): Map<string, ItemId[]> {
    const ctx = this.ctx;
    const result = new Map<string, ItemId[]>();
    if (!ctx) return result;
    for (const category of ctx.content.pack.collectionCategories) result.set(category.id, []);
    for (const item of ctx.content.getAllItems()) {
      const category = this.categoryForItem(item, ctx.content.pack.collectionCategories);
      if (!category) continue;
      const bucket = result.get(category.id);
      if (bucket && !bucket.includes(item.id)) bucket.push(item.id);
    }
    return result;
  }

  private categoryForItem(item: ItemDef, categories: readonly CollectionCategoryDef[]): CollectionCategoryDef | null {
    for (const category of categories) {
      for (const tag of category.itemTags) {
        if (item.category === tag || item.tags.includes(tag)) return category;
      }
    }
    return null;
  }

  private recordAcquiredItem(itemId: ItemId, quality: QualityStars): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const category = this.catalogIndex.get(itemId);
    if (!category) return;
    const safeQuality = clamp(Math.round(quality), 1, 5) as QualityStars;
    const existing = ctx.state.collection.entries[itemId];
    if (existing) {
      existing.count += 1;
      if (safeQuality > existing.bestQuality) existing.bestQuality = safeQuality;
      return;
    }
    const entry: CollectionEntryState = {
      itemId,
      firstCollectedAt: ctx.clock.simTimeSeconds,
      count: 1,
      bestQuality: safeQuality,
      donated: false,
    };
    ctx.state.collection.entries[itemId] = entry;
    ctx.state.collection.totalSpeciesKnown = this.catalogIds.length;
    const item = ctx.content.getItem(itemId);
    const data: JsonValue = {
      itemId,
      itemName: item?.name ?? itemId,
      categoryId: category.id,
      categoryName: category.name,
      known: Object.keys(ctx.state.collection.entries).length,
      total: this.catalogIds.length,
    };
    ctx.bus.emit('game:signal', { name: 'collection:registered', data });
  }

  private playerAtMuseum(): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const locationId = ctx.state.player.position.locationId;
    if (locationId === LOC.museum || locationId === interiorIdFor(LOC.museum)) return true;
    const def = ctx.content.getLocation(locationId);
    if (!def) return false;
    return def.facilities.includes('museum');
  }

  private appendHistory(category: WorldHistoryEntry['category'], description: string, importance: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const history = ctx.state.world.history;
    const at = ctx.clock.simTimeSeconds;
    const id: EntityId = 'hist_collection_' + history.length + '_' + Math.round(at);
    const entry: WorldHistoryEntry = {
      id,
      at,
      category,
      description,
      importance,
      participantIds: [],
    };
    const locationId = ctx.state.player.position.locationId;
    if (locationId) entry.locationId = locationId;
    history.push(entry);
    const cap = WORLD_CONFIG.simulation.maxHistoryEntries;
    if (history.length > cap) history.splice(0, history.length - cap);
  }

  private fail(code: ActionResult['code'], message: string): ActionResult {
    const result: ActionResult = { ok: false, message };
    if (code) result.code = code;
    return result;
  }
}

export const COLLECTION_PLAYER_ID = PLAYER_ID;
