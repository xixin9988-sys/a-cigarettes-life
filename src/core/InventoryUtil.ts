import type { InventoryEntry } from './SharedTypes';
import { makeId } from './utils';

export interface AddItemOptions {
  quality?: 1 | 2 | 3 | 4 | 5;
  freshness?: number;
  simTime: number;
  maxStack?: number;
  meta?: Record<string, string | number | boolean>;
}

export function createInventoryEntry(
  itemId: string,
  quantity: number,
  options: AddItemOptions
): InventoryEntry {
  const entry: InventoryEntry = {
    instanceId: makeId('itm'),
    itemId,
    quantity: Math.max(1, Math.floor(quantity)),
    quality: options.quality ?? 1,
    freshness: options.freshness ?? 1,
    acquiredAt: options.simTime,
  };
  if (options.meta) entry.meta = options.meta;
  return entry;
}

/** Adds items, merging into stackable entries when possible. Mutates the inventory array. */
export function addItemToInventory(
  inventory: InventoryEntry[],
  itemId: string,
  quantity: number,
  options: AddItemOptions
): InventoryEntry[] {
  const remaining = Math.max(0, Math.floor(quantity));
  const maxStack = Math.max(1, Math.floor(options.maxStack ?? 99));
  const added: InventoryEntry[] = [];
  if (remaining === 0) return added;
  const quality = options.quality ?? 1;

  if (maxStack > 1) {
    let left = remaining;
    for (const entry of inventory) {
      if (entry.itemId !== itemId || entry.quality !== quality) continue;
      if (entry.quantity >= maxStack) continue;
      const room = maxStack - entry.quantity;
      const take = Math.min(room, left);
      entry.quantity += take;
      left -= take;
      if (left <= 0) break;
    }
    if (left > 0) {
      const entry = createInventoryEntry(itemId, left, { ...options, quality });
      inventory.push(entry);
      added.push(entry);
    }
  } else {
    for (let i = 0; i < remaining; i += 1) {
      const entry = createInventoryEntry(itemId, 1, { ...options, quality });
      inventory.push(entry);
      added.push(entry);
    }
  }
  return added;
}

export function countItem(inventory: readonly InventoryEntry[], itemId: string): number {
  let total = 0;
  for (const entry of inventory) {
    if (entry.itemId === itemId) total += entry.quantity;
  }
  return total;
}

export function findEntry(inventory: readonly InventoryEntry[], instanceId: string): InventoryEntry | undefined {
  return inventory.find((entry) => entry.instanceId === instanceId);
}

export function findFirstByItem(inventory: readonly InventoryEntry[], itemId: string): InventoryEntry | undefined {
  return inventory.find((entry) => entry.itemId === itemId);
}

export interface ItemRequirement {
  itemId: string;
  quantity: number;
}

export function hasItems(inventory: readonly InventoryEntry[], requirements: readonly ItemRequirement[]): boolean {
  const needed = new Map<string, number>();
  for (const requirement of requirements) {
    needed.set(requirement.itemId, (needed.get(requirement.itemId) ?? 0) + requirement.quantity);
  }
  for (const [itemId, quantity] of needed) {
    if (countItem(inventory, itemId) < quantity) return false;
  }
  return true;
}

/** Removes required items. Returns true only if everything could be removed atomically. */
export function consumeItems(inventory: InventoryEntry[], requirements: readonly ItemRequirement[]): boolean {
  if (!hasItems(inventory, requirements)) return false;
  for (const requirement of requirements) {
    removeItemFromInventory(inventory, requirement.itemId, requirement.quantity);
  }
  return true;
}

/** Removes quantity of an item (optionally a specific instance). Returns removed count. */
export function removeItemFromInventory(
  inventory: InventoryEntry[],
  itemId: string,
  quantity: number,
  instanceId?: string
): number {
  let remaining = Math.max(0, Math.floor(quantity));
  for (let i = inventory.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const entry = inventory[i];
    if (!entry) continue;
    if (entry.itemId !== itemId) continue;
    if (instanceId && entry.instanceId !== instanceId) continue;
    const take = Math.min(entry.quantity, remaining);
    entry.quantity -= take;
    remaining -= take;
    if (entry.quantity <= 0) inventory.splice(i, 1);
  }
  return Math.max(0, Math.floor(quantity)) - remaining;
}

/** Splits a quantity from an entry into a new entry (used by gifting / storage / equipping). */
export function splitEntry(inventory: InventoryEntry[], instanceId: string, quantity: number): InventoryEntry | null {
  const entry = findEntry(inventory, instanceId);
  if (!entry || quantity <= 0 || quantity > entry.quantity) return null;
  const split: InventoryEntry = {
    ...entry,
    instanceId: makeId('itm'),
    quantity,
  };
  if (entry.meta) split.meta = { ...entry.meta };
  entry.quantity -= quantity;
  if (entry.quantity <= 0) {
    const index = inventory.indexOf(entry);
    if (index >= 0) inventory.splice(index, 1);
  }
  inventory.push(split);
  return split;
}

/** Removes a whole entry by instance id and returns it. */
export function takeEntry(inventory: InventoryEntry[], instanceId: string): InventoryEntry | null {
  const index = inventory.findIndex((entry) => entry.instanceId === instanceId);
  if (index < 0) return null;
  const [entry] = inventory.splice(index, 1);
  return entry ?? null;
}

export function totalItemCount(inventory: readonly InventoryEntry[]): number {
  return inventory.reduce((total, entry) => total + entry.quantity, 0);
}