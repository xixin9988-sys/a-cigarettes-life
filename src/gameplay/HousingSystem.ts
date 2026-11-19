import type {
  ActionResult,
  HomeState,
  HousingState,
  IHousingSystem,
  IGameContext,
  ISystem,
  PlacedFurnitureState,
  RoomState,
} from '../core/contracts';
import type { BlueprintDef, FurnitureDef } from '../data/schema';
import type { ItemId, JsonValue, LocationId, QualityStars } from '../core/SharedTypes';
import { HOME_INTERIOR_ID } from '../data/locations/ids';
import { ITEM } from '../data/items/ids';
import { addItemToInventory, countItem, findEntry, removeItemFromInventory, takeEntry } from '../core/InventoryUtil';
import { clamp01 } from '../core/utils';
import { findHomeAtLocation } from './CraftingSystem';

/**
 * HousingSystem (id 'housing') - grid furniture placement, decoration and storage.
 *
 * GRID + COLLISION RULES (code_artifact module 11):
 *  - every room is a tiles grid; furniture has an axis-aligned footprint (width x height),
 *    swapped for 90/270 degree rotations.
 *  - AABB overlap is rejected between furniture of the same collision class
 *    (blocking floor/outdoor pieces, wall pieces, small surface pieces).
 *  - walkability: 'wall' and 'surface' pieces never block walking; 'floor'/'outdoor' pieces
 *    block unless tagged 'nonblocking' (rugs, paths). The room door is the bottom-middle
 *    tile. After a placement every free tile must still be reachable from the door (BFS),
 *    so furniture can never seal a corner or the doorway.
 *
 * COMFORT / DECORATION: sum of placed bonuses with diminishing returns
 * (sorted descending, each next piece weighted 0.85/0.88 less) plus blueprint upgrade
 * bonuses and a small bonus per unlocked room. Both are clamped to 0..1.
 *
 * STORAGE: base 16 stacks + storage furniture slots + blueprint bonuses. Both storage
 * moves preserve item quality/freshness/meta.
 */
export const DEFAULT_WALL_COLOR = '#e8d8b8';
export const DEFAULT_FLOOR_STYLE = 'wood';
/** Virtual outdoor room where garden furniture (benches, paths, bird baths) is placed. */
export const GARDEN_ROOM_ID = 'garden';
const GARDEN_WIDTH_TILES = 20;
const GARDEN_HEIGHT_TILES = 14;

export const ROOM_LAYOUTS: Record<string, { name: string; widthTiles: number; heightTiles: number }> = {
  second_room: { name: 'Second Room', widthTiles: 10, heightTiles: 8 },
  bedroom: { name: 'Bedroom', widthTiles: 12, heightTiles: 10 },
  kitchen: { name: 'Kitchen', widthTiles: 12, heightTiles: 8 },
  workshop: { name: 'Workshop', widthTiles: 12, heightTiles: 10 },
  storeroom: { name: 'Storeroom', widthTiles: 8, heightTiles: 8 },
  conservatory: { name: 'Conservatory', widthTiles: 14, heightTiles: 10 },
};

export interface FloorStyleOption {
  id: string;
  label: string;
  itemId: ItemId;
  quantity: number;
}

/** Floor styles with their material cost (consumed when a floor is laid). */
export const FLOOR_STYLES: readonly FloorStyleOption[] = [
  { id: 'wood', label: 'Wooden Boards', itemId: ITEM.plank, quantity: 2 },
  { id: 'stone', label: 'Stone Flags', itemId: ITEM.stone, quantity: 3 },
  { id: 'tile', label: 'Fired Tiles', itemId: ITEM.brick, quantity: 2 },
  { id: 'carpet', label: 'Woven Carpet', itemId: ITEM.cloth, quantity: 2 },
];

export const WALL_COLOR_OPTIONS: readonly string[] = [
  '#e8d8b8',
  '#d9c9a3',
  '#f2ead6',
  '#c9b8a8',
  '#a8c4b0',
  '#b8c8d9',
  '#d9b8c4',
  '#c4b8d9',
  '#b0b8a8',
  '#e8c8a8',
];

const BASE_STORAGE_SLOTS = 16;
const UPGRADE_STORAGE_BONUS: Record<string, number> = {
  bp_storeroom: 16,
  bp_home_extension: 8,
  bp_farm_shed: 20,
};
const UPGRADE_COMFORT_BONUS: Record<string, number> = {
  bp_bedroom: 0.05,
  bp_bedroom_expansion: 0.1,
  bp_kitchen_upgrade: 0.08,
  bp_farm_shed: 0.05,
};
const UPGRADE_DECOR_BONUS: Record<string, number> = {
  bp_conservatory: 0.2,
};
const GARDEN_DECOR_BONUS: Record<string, number> = {
  bp_garden_flowers: 0.1,
  bp_garden_expansion: 0.04,
};
const COMFORT_DIMINISHING = 0.85;
const DECOR_DIMINISHING = 0.88;
const WALL_PAINT_DECOR_BONUS = 0.02;
const FLOOR_DECOR_BONUS = 0.02;
const ROOM_DECOR_BONUS = 0.03;
const ROOM_COMFORT_BONUS = 0.015;
/** A roof over your head is worth a little comfort even with no furniture. */
const BASE_COMFORT = 0.05;

/** BuildingSystem as seen by HousingSystem (extra public method beyond IBuildingSystem). */
interface BuildingBridge extends ISystem {
  startProject(blueprintId: string, locationId: LocationId): ActionResult;
}

type CollisionClass = 'blocking' | 'wall' | 'surface';
type Rotation = 0 | 90 | 180 | 270;

const NON_BLOCKING_TAG = 'nonblocking';

export class HousingSystem implements IHousingSystem {
  readonly id = 'housing';

  private ctx: IGameContext | null = null;
  private placementCounter = 0;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.ensurePlayerHome();
    for (const home of this.homes()) this.recomputeHome(home);
  }

  update(_dtSimSeconds: number): void {
    // Housing changes are action-driven; nothing to tick.
  }

  // -------------------------------------------------------------------------
  // IHousingSystem - lookups
  // -------------------------------------------------------------------------
  getHome(homeId: string): HomeState | undefined {
    const ctx = this.ctx;
    if (!ctx) return undefined;
    return ctx.state.housing.homes[homeId];
  }

  getHomeAtLocation(locationId: LocationId): HomeState | undefined {
    const ctx = this.ctx;
    if (!ctx) return undefined;
    return findHomeAtLocation(ctx, locationId);
  }

  getHomes(): HomeState[] {
    return this.homes();
  }

  // -------------------------------------------------------------------------
  // IHousingSystem - placement
  // -------------------------------------------------------------------------
  placeFurniture(itemInstanceId: string, x: number, y: number, rotation: number): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return this.fail('not_found', 'Housing is not available yet.');
    const home = this.playerHome();
    if (!home) return this.fail('wrong_location', 'You can only arrange furniture at home.');
    const entry = findEntry(ctx.state.player.inventory, itemInstanceId);
    if (!entry) return this.fail('not_found', 'That item is not in your bag.');
    const itemDef = ctx.content.getItem(entry.itemId);
    if (!itemDef) return this.fail('not_found', 'Unknown item.');
    const furnitureId = itemDef.furnitureId ?? itemDef.id;
    const def = ctx.content.getFurniture(furnitureId);
    if (!def) return this.fail('not_found', itemDef.name + ' is not a piece of furniture.');

    // Outdoor pieces belong in the garden; everything else belongs inside the house.
    if (def.slot === 'outdoor') {
      if (!this.playerAtHomeExterior(home)) {
        return this.fail('wrong_location', 'Take ' + def.name + ' out to the garden to place it.');
      }
      const garden = this.ensureGardenRoom(home);
      return this.placeInRoomInternal(home, garden, def, itemInstanceId, x, y, rotation);
    }
    if (this.playerAtHomeExterior(home)) {
      return this.fail('wrong_location', 'Go inside to arrange ' + def.name + '.');
    }
    const room = home.rooms.find((candidate) => candidate.unlocked && candidate.id !== GARDEN_ROOM_ID);
    if (!room) return this.fail('not_found', 'Your home has no room to decorate.');
    return this.placeInRoomInternal(home, room, def, itemInstanceId, x, y, rotation);
  }

  /** Extra helper for the building UI: place into a specific room. */
  placeFurnitureInRoom(
    home: HomeState,
    roomId: string,
    itemInstanceId: string,
    x: number,
    y: number,
    rotation: number
  ): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return this.fail('not_found', 'Housing is not available yet.');
    const room = home.rooms.find((candidate) => candidate.id === roomId);
    if (!room) return this.fail('not_found', 'That room does not exist.');
    if (!room.unlocked) return this.fail('locked', 'That room is not built yet.');
    const entry = findEntry(ctx.state.player.inventory, itemInstanceId);
    if (!entry) return this.fail('not_found', 'That item is not in your bag.');
    const itemDef = ctx.content.getItem(entry.itemId);
    if (!itemDef) return this.fail('not_found', 'Unknown item.');
    const furnitureId = itemDef.furnitureId ?? itemDef.id;
    const def = ctx.content.getFurniture(furnitureId);
    if (!def) return this.fail('not_found', itemDef.name + ' is not a piece of furniture.');
    if (room.id === GARDEN_ROOM_ID && def.slot !== 'outdoor') {
      return this.fail('invalid', def.name + ' is indoor furniture - place it inside the house.');
    }
    if (room.id !== GARDEN_ROOM_ID && def.slot === 'outdoor') {
      return this.fail('invalid', def.name + ' belongs in the garden.');
    }
    return this.placeInRoomInternal(home, room, def, itemInstanceId, x, y, rotation);
  }

  /** Shared placement pipeline: validate grid/collision/path, consume the item, record placement. */
  private placeInRoomInternal(
    home: HomeState,
    room: RoomState,
    def: FurnitureDef,
    itemInstanceId: string,
    x: number,
    y: number,
    rotation: number
  ): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return this.fail('not_found', 'Housing is not available yet.');
    const entry = findEntry(ctx.state.player.inventory, itemInstanceId);
    if (!entry) return this.fail('not_found', 'That item is not in your bag.');

    const normalisedRotation = this.normaliseRotation(rotation);
    if (normalisedRotation === null) return this.fail('invalid', 'Rotation must be 0, 90, 180 or 270 degrees.');
    if (!Number.isInteger(x) || !Number.isInteger(y)) return this.fail('invalid', 'Furniture must sit on a grid tile.');
    const footprint = this.footprint(def, normalisedRotation);
    if (x < 0 || y < 0 || x + footprint.width > room.widthTiles || y + footprint.height > room.heightTiles) {
      return this.fail('invalid', def.name + ' does not fit there.');
    }
    const overlap = this.findOverlap(home, room, def, x, y, footprint);
    if (overlap) return this.fail('invalid', 'There is already something in the way.');
    // The garden is open ground: it has no doorway to protect.
    if (room.id !== GARDEN_ROOM_ID && this.wouldBlockRoom(home, room, x, y, footprint)) {
      return this.fail('invalid', 'That would block the doorway or seal off part of the room.');
    }

    const removed = removeItemFromInventory(ctx.state.player.inventory, entry.itemId, 1, itemInstanceId);
    if (removed !== 1) return this.fail('not_found', 'That item is not in your bag.');

    const placed: PlacedFurnitureState = {
      id: this.nextPlacedId(home),
      homeId: home.id,
      furnitureId: def.id,
      roomId: room.id,
      x,
      y,
      rotation: normalisedRotation,
    };
    home.furniture.push(placed);
    this.recomputeHome(home);

    const now = ctx.clock.simTimeSeconds;
    ctx.state.housing.lastPlacementAt = now;
    ctx.state.player.statistics.furniturePlaced += 1;
    ctx.bus.emit('item:lost', { itemId: entry.itemId, quantity: 1, reason: 'placed_furniture' });
    const data: JsonValue = { placedId: placed.id, furnitureId: def.id, roomId: room.id };
    ctx.bus.emit('game:signal', { name: 'housing:furniture-placed', data });
    return {
      ok: true,
      message: 'Placed ' + def.name + '.',
      stateChanged: true,
      data,
    };
  }

  removeFurniture(placedFurnitureId: string): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return this.fail('not_found', 'Housing is not available yet.');
    for (const home of this.homes()) {
      const index = home.furniture.findIndex((placed) => placed.id === placedFurnitureId);
      if (index < 0) continue;
      const placed = home.furniture[index];
      if (!placed) return this.fail('not_found', 'That furniture is not here.');
      if (!this.canModify(home)) return this.fail('not_allowed', 'You cannot rearrange that home.');
      if (!this.playerIsHome(home)) return this.fail('wrong_location', 'You need to be at home to move furniture.');
      const def = ctx.content.getFurniture(placed.furnitureId);
      const itemId = def?.itemId ?? placed.furnitureId;
      const itemDef = ctx.content.getItem(itemId);
      home.furniture.splice(index, 1);
      this.recomputeHome(home);
      const now = ctx.clock.simTimeSeconds;
      addItemToInventory(ctx.state.player.inventory, itemId, 1, {
        quality: (itemDef?.hasQuality ? 3 : 1) as QualityStars,
        freshness: 1,
        simTime: now,
        maxStack: itemDef?.maxStack ?? 1,
      });
      ctx.bus.emit('item:acquired', {
        itemId,
        quantity: 1,
        quality: (itemDef?.hasQuality ? 3 : 1) as QualityStars,
        source: 'furniture_removed',
      });
      const data: JsonValue = { placedId: placedFurnitureId, furnitureId: placed.furnitureId };
      ctx.bus.emit('game:signal', { name: 'housing:furniture-removed', data });
      return { ok: true, message: 'Took ' + (def?.name ?? 'furniture') + ' back into your bag.', stateChanged: true, data };
    }
    return this.fail('not_found', 'No such placed furniture.');
  }

  // -------------------------------------------------------------------------
  // IHousingSystem - decoration
  // -------------------------------------------------------------------------
  paintWall(homeId: string, color: string): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return this.fail('not_found', 'Housing is not available yet.');
    const home = ctx.state.housing.homes[homeId];
    if (!home) return this.fail('not_found', 'No such home.');
    if (!this.canModify(home)) return this.fail('not_allowed', 'That home is not yours.');
    if (!this.playerIsHome(home)) return this.fail('wrong_location', 'You need to be at home to decorate.');
    const normalised = this.normaliseColor(color);
    if (!normalised) return this.fail('invalid', 'Choose a colour like #e8d8b8.');
    if (countItem(ctx.state.player.inventory, ITEM.paint) < 1) {
      return this.fail('not_enough_items', 'You need a tin of paint.');
    }
    removeItemFromInventory(ctx.state.player.inventory, ITEM.paint, 1);
    home.wallColor = normalised;
    for (const room of home.rooms) room.wallColor = normalised;
    this.recomputeHome(home);
    const data: JsonValue = { homeId, color: normalised };
    ctx.bus.emit('game:signal', { name: 'housing:painted', data });
    return { ok: true, message: 'Painted the walls ' + normalised + '.', stateChanged: true, data };
  }

  setFloorStyle(homeId: string, style: string): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return this.fail('not_found', 'Housing is not available yet.');
    const home = ctx.state.housing.homes[homeId];
    if (!home) return this.fail('not_found', 'No such home.');
    if (!this.canModify(home)) return this.fail('not_allowed', 'That home is not yours.');
    if (!this.playerIsHome(home)) return this.fail('wrong_location', 'You need to be at home to decorate.');
    const option = FLOOR_STYLES.find((candidate) => candidate.id === style);
    if (!option) {
      return this.fail('invalid', 'Available floors: ' + FLOOR_STYLES.map((candidate) => candidate.id).join(', ') + '.');
    }
    const have = countItem(ctx.state.player.inventory, option.itemId);
    if (have < option.quantity) {
      const name = ctx.content.resolveItemName(option.itemId);
      return this.fail('not_enough_items', 'You need ' + option.quantity + 'x ' + name + ' (have ' + have + ').');
    }
    removeItemFromInventory(ctx.state.player.inventory, option.itemId, option.quantity);
    home.floorStyle = option.id;
    for (const room of home.rooms) room.floorStyle = option.id;
    this.recomputeHome(home);
    const data: JsonValue = { homeId, style: option.id, spentItemId: option.itemId, spentQuantity: option.quantity };
    ctx.bus.emit('game:signal', { name: 'housing:floor-changed', data });
    return { ok: true, message: 'Laid the ' + option.label.toLowerCase() + '.', stateChanged: true, data };
  }

  // -------------------------------------------------------------------------
  // IHousingSystem - storage
  // -------------------------------------------------------------------------
  storeItem(homeId: string, instanceId: string): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return this.fail('not_found', 'Housing is not available yet.');
    const home = ctx.state.housing.homes[homeId];
    if (!home) return this.fail('not_found', 'No such home.');
    if (!this.canModify(home)) return this.fail('not_allowed', 'That home is not yours.');
    if (!this.playerIsHome(home)) return this.fail('wrong_location', 'You need to be at home to use storage.');
    if (home.storage.length >= this.getStorageCapacity(homeId)) {
      return this.fail('capacity_reached', 'Your home storage is full.');
    }
    const entry = takeEntry(ctx.state.player.inventory, instanceId);
    if (!entry) return this.fail('not_found', 'That item is not in your bag.');
    home.storage.push(entry);
    const data: JsonValue = { homeId, itemId: entry.itemId, quantity: entry.quantity };
    ctx.bus.emit('game:signal', { name: 'housing:stored', data });
    return { ok: true, message: 'Stored ' + ctx.content.resolveItemName(entry.itemId) + '.', stateChanged: true, data };
  }

  takeItem(homeId: string, instanceId: string): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return this.fail('not_found', 'Housing is not available yet.');
    const home = ctx.state.housing.homes[homeId];
    if (!home) return this.fail('not_found', 'No such home.');
    if (!this.canModify(home)) return this.fail('not_allowed', 'That home is not yours.');
    if (!this.playerIsHome(home)) return this.fail('wrong_location', 'You need to be at home to use storage.');
    const entry = takeEntry(home.storage, instanceId);
    if (!entry) return this.fail('not_found', 'That item is not in storage.');
    const itemDef = ctx.content.getItem(entry.itemId);
    const now = ctx.clock.simTimeSeconds;
    const added = addItemToInventory(ctx.state.player.inventory, entry.itemId, entry.quantity, {
      quality: entry.quality,
      freshness: entry.freshness,
      simTime: now,
      maxStack: itemDef?.maxStack ?? 99,
    });
    if (entry.meta) {
      for (const addedEntry of added) addedEntry.meta = { ...entry.meta };
    }
    ctx.bus.emit('item:acquired', {
      itemId: entry.itemId,
      quantity: entry.quantity,
      quality: entry.quality,
      source: 'home_storage',
    });
    const data: JsonValue = { homeId, itemId: entry.itemId, quantity: entry.quantity };
    ctx.bus.emit('game:signal', { name: 'housing:taken', data });
    return {
      ok: true,
      message: 'Took ' + ctx.content.resolveItemName(entry.itemId) + ' from storage.',
      stateChanged: true,
      data,
    };
  }

  // -------------------------------------------------------------------------
  // IHousingSystem - building integration
  // -------------------------------------------------------------------------
  addRoom(homeId: string, blueprintId: string): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return this.fail('not_found', 'Housing is not available yet.');
    const home = ctx.state.housing.homes[homeId];
    if (!home) return this.fail('not_found', 'No such home.');
    if (!this.canModify(home)) return this.fail('not_allowed', 'That home is not yours.');
    const blueprint = ctx.content.getBlueprint(blueprintId);
    if (!blueprint) return this.fail('not_found', 'No such blueprint.');
    if (blueprint.kind !== 'room' && blueprint.kind !== 'home_expansion') {
      return this.fail('invalid', blueprint.name + ' is not a room blueprint.');
    }
    if (ctx.registry.has('building')) {
      const building = ctx.registry.getRequired<BuildingBridge>('building');
      return building.startProject(blueprintId, home.locationId);
    }
    // No building system registered (isolated module): apply immediately after paying materials.
    const missing = this.firstMissing(blueprint);
    if (missing) return this.fail('not_enough_items', 'You need ' + missing + '.');
    for (const input of blueprint.inputs) {
      removeItemFromInventory(ctx.state.player.inventory, input.itemId, input.quantity);
    }
    return this.applyCompletedBlueprint(blueprintId, home.locationId);
  }

  /** Called by BuildingSystem when a construction project finishes. Pays nothing. */
  applyCompletedBlueprint(blueprintId: string, locationId: LocationId): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return this.fail('not_found', 'Housing is not available yet.');
    const blueprint = ctx.content.getBlueprint(blueprintId);
    if (!blueprint) return this.fail('not_found', 'No such blueprint.');
    const home = findHomeAtLocation(ctx, locationId) ?? this.ownedHomes()[0];
    if (!home) return this.fail('not_found', 'You do not own a home here.');
    const applied = this.applyBlueprintToHome(home, blueprint);
    this.recomputeHome(home);
    const data: JsonValue = { homeId: home.id, blueprintId, kind: blueprint.kind, applied };
    ctx.bus.emit('game:signal', { name: 'housing:blueprint-applied', data });
    return applied
      ? { ok: true, message: blueprint.name + ' added to your home.', stateChanged: true, data }
      : { ok: true, message: blueprint.name + ' was already built.', data };
  }

  /** Extra helper: storage capacity in item stacks. */
  getStorageCapacity(homeId: string): number {
    const ctx = this.ctx;
    if (!ctx) return BASE_STORAGE_SLOTS;
    const home = ctx.state.housing.homes[homeId];
    if (!home) return 0;
    let capacity = BASE_STORAGE_SLOTS;
    for (const placed of home.furniture) {
      const def = ctx.content.getFurniture(placed.furnitureId);
      if (def && def.storageSlots > 0) capacity += def.storageSlots;
    }
    for (const upgrade of home.upgrades) capacity += UPGRADE_STORAGE_BONUS[upgrade] ?? 0;
    return capacity;
  }

  /** Recompute comfort/decoration for one home (also used after building completions). */
  recomputeHome(home: HomeState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const comfortBonuses: number[] = [];
    const decorBonuses: number[] = [];
    for (const placed of home.furniture) {
      const def = ctx.content.getFurniture(placed.furnitureId);
      if (!def) continue;
      if (def.comfort > 0) comfortBonuses.push(def.comfort);
      if (def.decor > 0) decorBonuses.push(def.decor);
    }
    let comfortExtra = 0;
    let decorExtra = 0;
    for (const upgrade of home.upgrades) {
      comfortExtra += UPGRADE_COMFORT_BONUS[upgrade] ?? 0;
      decorExtra += UPGRADE_DECOR_BONUS[upgrade] ?? 0;
    }
    for (const garden of home.gardens) decorExtra += GARDEN_DECOR_BONUS[garden] ?? 0.02;
    const unlockedRooms = home.rooms.filter((room) => room.unlocked).length;
    comfortExtra += Math.max(0, unlockedRooms - 1) * ROOM_COMFORT_BONUS;
    decorExtra += Math.max(0, unlockedRooms - 1) * ROOM_DECOR_BONUS;
    if (home.wallColor !== DEFAULT_WALL_COLOR) decorExtra += WALL_PAINT_DECOR_BONUS;
    if (home.floorStyle !== DEFAULT_FLOOR_STYLE) decorExtra += FLOOR_DECOR_BONUS;

    const comfortRaw = this.diminishingSum(comfortBonuses, COMFORT_DIMINISHING);
    const decorRaw = this.diminishingSum(decorBonuses, DECOR_DIMINISHING);
    home.comfort = clamp01(BASE_COMFORT + comfortRaw / (comfortRaw + 1.2) + comfortExtra);
    home.decorationScore = clamp01(decorRaw / (decorRaw + 1.5) + decorExtra);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  private applyBlueprintToHome(home: HomeState, blueprint: BlueprintDef): boolean {
    let applied = false;
    if (blueprint.kind === 'room' && blueprint.unlocksRoomId) {
      const roomId = blueprint.unlocksRoomId;
      if (!home.rooms.some((room) => room.id === roomId)) {
        const layout = ROOM_LAYOUTS[roomId] ?? { name: blueprint.name, widthTiles: 10, heightTiles: 8 };
        const room: RoomState = {
          id: roomId,
          name: layout.name,
          widthTiles: layout.widthTiles,
          heightTiles: layout.heightTiles,
          unlocked: true,
          wallColor: home.wallColor,
          floorStyle: home.floorStyle,
        };
        home.rooms.push(room);
        applied = true;
      }
    }
    if (
      (blueprint.kind === 'room' ||
        blueprint.kind === 'home_expansion' ||
        blueprint.kind === 'farm_facility') &&
      !home.upgrades.includes(blueprint.id)
    ) {
      home.upgrades.push(blueprint.id);
      applied = true;
    }
    if (blueprint.kind === 'garden' && !home.gardens.includes(blueprint.id)) {
      home.gardens.push(blueprint.id);
      applied = true;
    }
    return applied;
  }

  private diminishingSum(values: number[], factor: number): number {
    const sorted = [...values].filter((value) => value > 0).sort((a, b) => b - a);
    let total = 0;
    let weight = 1;
    for (const value of sorted) {
      total += value * weight;
      weight *= factor;
    }
    return total;
  }

  private footprint(def: FurnitureDef, rotation: Rotation): { width: number; height: number } {
    if (rotation === 90 || rotation === 270) return { width: def.heightTiles, height: def.widthTiles };
    return { width: def.widthTiles, height: def.heightTiles };
  }

  private normaliseRotation(rotation: number): Rotation | null {
    if (!Number.isFinite(rotation)) return null;
    const normalised = ((Math.round(rotation) % 360) + 360) % 360;
    if (normalised === 0 || normalised === 90 || normalised === 180 || normalised === 270) return normalised;
    return null;
  }

  private normaliseColor(color: string): string | null {
    if (typeof color !== 'string') return null;
    const trimmed = color.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
    if (/^#[0-9a-f]{3}$/.test(trimmed)) {
      const r = trimmed.charAt(1);
      const g = trimmed.charAt(2);
      const b = trimmed.charAt(3);
      return '#' + r + r + g + g + b + b;
    }
    return null;
  }

  private collisionClass(def: FurnitureDef): CollisionClass {
    if (def.slot === 'wall') return 'wall';
    if (def.slot === 'surface') return 'surface';
    return 'blocking';
  }

  private blocksMovement(def: FurnitureDef): boolean {
    if (this.collisionClass(def) !== 'blocking') return false;
    return !def.tags.includes(NON_BLOCKING_TAG);
  }

  private rectsOverlap(
    ax: number,
    ay: number,
    aw: number,
    ah: number,
    bx: number,
    by: number,
    bw: number,
    bh: number
  ): boolean {
    return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
  }

  private findOverlap(
    home: HomeState,
    room: RoomState,
    def: FurnitureDef,
    x: number,
    y: number,
    footprint: { width: number; height: number }
  ): PlacedFurnitureState | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const newClass = this.collisionClass(def);
    for (const placed of home.furniture) {
      if (placed.roomId !== room.id) continue;
      const other = ctx.content.getFurniture(placed.furnitureId);
      if (!other) continue;
      if (this.collisionClass(other) !== newClass) continue;
      const otherRotation = this.normaliseRotation(placed.rotation) ?? 0;
      const otherFootprint = this.footprint(other, otherRotation);
      if (
        this.rectsOverlap(x, y, footprint.width, footprint.height, placed.x, placed.y, otherFootprint.width, otherFootprint.height)
      ) {
        return placed;
      }
    }
    return null;
  }

  /** BFS from the door over free tiles; rejects placements that seal any free tile away. */
  private wouldBlockRoom(
    home: HomeState,
    room: RoomState,
    x: number,
    y: number,
    footprint: { width: number; height: number }
  ): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const width = room.widthTiles;
    const height = room.heightTiles;
    if (width <= 0 || height <= 0) return true;
    const blocked = new Set<number>();
    const mark = (mx: number, my: number, mw: number, mh: number): void => {
      for (let ty = my; ty < my + mh; ty += 1) {
        for (let tx = mx; tx < mx + mw; tx += 1) {
          if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
          blocked.add(ty * width + tx);
        }
      }
    };
    for (const placed of home.furniture) {
      if (placed.roomId !== room.id) continue;
      const def = ctx.content.getFurniture(placed.furnitureId);
      if (!def || !this.blocksMovement(def)) continue;
      const rotation = this.normaliseRotation(placed.rotation) ?? 0;
      const otherFootprint = this.footprint(def, rotation);
      mark(placed.x, placed.y, otherFootprint.width, otherFootprint.height);
    }
    mark(x, y, footprint.width, footprint.height);

    const doorX = Math.floor(width / 2);
    const doorY = height - 1;
    const doorIndex = doorY * width + doorX;
    if (blocked.has(doorIndex)) return true;

    const visited = new Set<number>([doorIndex]);
    const queue: number[] = [doorIndex];
    while (queue.length > 0) {
      const index = queue.shift();
      if (index === undefined) break;
      const cx = index % width;
      const cy = Math.floor(index / width);
      const neighbours: [number, number][] = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ];
      for (const [nx, ny] of neighbours) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbourIndex = ny * width + nx;
        if (blocked.has(neighbourIndex) || visited.has(neighbourIndex)) continue;
        visited.add(neighbourIndex);
        queue.push(neighbourIndex);
      }
    }
    let freeTiles = 0;
    for (let index = 0; index < width * height; index += 1) {
      if (!blocked.has(index)) freeTiles += 1;
    }
    return visited.size !== freeTiles;
  }

  private nextPlacedId(home: HomeState): string {
    const existing = new Set(home.furniture.map((placed) => placed.id));
    this.placementCounter += 1;
    let counter = this.placementCounter;
    let candidate = home.id + ':furn:' + counter;
    while (existing.has(candidate)) {
      counter += 1;
      this.placementCounter = counter;
      candidate = home.id + ':furn:' + counter;
    }
    return candidate;
  }

  private homes(): HomeState[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    return Object.values(ctx.state.housing.homes);
  }

  private ownedHomes(): HomeState[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    const playerId = ctx.state.player.id;
    const ownedIds = new Set(ctx.state.housing.ownedHomeIds);
    return this.homes().filter((home) => home.ownerId === playerId || ownedIds.has(home.id));
  }

  private canModify(home: HomeState): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (home.ownerId === ctx.state.player.id) return true;
    return ctx.state.housing.ownedHomeIds.includes(home.id);
  }

  private playerIsHome(home: HomeState): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const locationId = ctx.state.player.position.locationId;
    if (home.locationId === locationId) return true;
    const def = ctx.content.getLocation(locationId);
    if (def?.entranceFrom && def.entranceFrom === home.locationId) return true;
    const homeDef = ctx.content.getLocation(home.locationId);
    if (homeDef?.entranceFrom && homeDef.entranceFrom === locationId) return true;
    return false;
  }

  private playerHome(): HomeState | undefined {
    const ctx = this.ctx;
    if (!ctx) return undefined;
    return findHomeAtLocation(ctx, ctx.state.player.position.locationId);
  }

  /** The exterior location of a home: the entrance of its interior, or its own id. */
  private homeExteriorLocation(home: HomeState): LocationId | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const homeDef = ctx.content.getLocation(home.locationId);
    if (!homeDef) return null;
    if (homeDef.indoor && homeDef.entranceFrom) return homeDef.entranceFrom;
    return homeDef.id;
  }

  private playerAtHomeExterior(home: HomeState): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const exterior = this.homeExteriorLocation(home);
    if (!exterior) return false;
    return ctx.state.player.position.locationId === exterior;
  }

  /** Lazily creates the virtual garden room used for outdoor furniture. */
  private ensureGardenRoom(home: HomeState): RoomState {
    const existing = home.rooms.find((room) => room.id === GARDEN_ROOM_ID);
    if (existing) {
      if (!existing.unlocked) existing.unlocked = true;
      return existing;
    }
    const garden: RoomState = {
      id: GARDEN_ROOM_ID,
      name: 'Garden',
      widthTiles: GARDEN_WIDTH_TILES,
      heightTiles: GARDEN_HEIGHT_TILES,
      unlocked: true,
      wallColor: home.wallColor,
      floorStyle: 'grass',
    };
    home.rooms.push(garden);
    return garden;
  }

  private firstMissing(blueprint: BlueprintDef): string | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    for (const input of blueprint.inputs) {
      const have = countItem(ctx.state.player.inventory, input.itemId);
      if (have >= input.quantity) continue;
      return ctx.content.resolveItemName(input.itemId) + ' (have ' + have + '/' + input.quantity + ')';
    }
    return null;
  }

  private ensurePlayerHome(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const state = ctx.state;
    const housing: HousingState = state.housing;
    const playerId = state.player.id;
    const existingOwned = Object.values(housing.homes).find(
      (home) => home.ownerId === playerId || housing.ownedHomeIds.includes(home.id)
    );
    if (existingOwned) return;
    const locationId = ctx.content.getLocation(HOME_INTERIOR_ID)
      ? HOME_INTERIOR_ID
      : state.player.position.locationId;
    const home: HomeState = {
      id: 'home_player',
      regionId: state.player.position.regionId,
      locationId,
      name: 'My Little Home',
      ownerId: playerId,
      rooms: [
        {
          id: 'main_room',
          name: 'Main Room',
          widthTiles: 12,
          heightTiles: 10,
          unlocked: true,
          wallColor: DEFAULT_WALL_COLOR,
          floorStyle: DEFAULT_FLOOR_STYLE,
        },
      ],
      furniture: [],
      storage: [],
      comfort: 0.05,
      decorationScore: 0,
      wallColor: DEFAULT_WALL_COLOR,
      floorStyle: DEFAULT_FLOOR_STYLE,
      upgrades: [],
      gardens: [],
    };
    housing.homes[home.id] = home;
    if (!housing.ownedHomeIds.includes(home.id)) housing.ownedHomeIds.push(home.id);
  }

  private fail(code: ActionResult['code'], message: string): ActionResult {
    const result: ActionResult = { ok: false, message };
    if (code) result.code = code;
    return result;
  }
}
