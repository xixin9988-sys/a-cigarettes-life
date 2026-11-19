import type { GameState } from '../core/contracts';

export interface StateDiff {
  changedSlices: string[];
  changedNpcIds: string[];
  addedEventIds: string[];
  changedLocationIds: string[];
  changedBusinessIds: string[];
}

const SLICE_KEYS: (keyof GameState)[] = [
  'meta',
  'clock',
  'world',
  'npcs',
  'player',
  'economy',
  'farming',
  'fishing',
  'foraging',
  'exploration',
  'crafting',
  'cooking',
  'building',
  'housing',
  'collection',
  'social',
  'life',
  'eventSystem',
  'settings',
  'archive',
  'pendingOffline',
  'flags',
];

function equalJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Computes a coarse state diff between two snapshots so the Web Worker only has to ship
 * the slices that actually changed back to the main thread.
 */
export function diffGameStates(before: GameState, after: GameState): StateDiff {
  const changedSlices: string[] = [];
  for (const key of SLICE_KEYS) {
    if (!equalJson(before[key], after[key])) changedSlices.push(String(key));
  }
  const changedNpcIds: string[] = [];
  for (const npcId of Object.keys(after.npcs)) {
    if (!before.npcs[npcId] || !equalJson(before.npcs[npcId], after.npcs[npcId])) changedNpcIds.push(npcId);
  }
  const changedLocationIds: string[] = [];
  for (const locationId of Object.keys(after.world.locations)) {
    if (
      !before.world.locations[locationId] ||
      !equalJson(before.world.locations[locationId], after.world.locations[locationId])
    ) {
      changedLocationIds.push(locationId);
    }
  }
  const changedBusinessIds: string[] = [];
  for (const businessId of Object.keys(after.economy.businesses)) {
    if (
      !before.economy.businesses[businessId] ||
      !equalJson(before.economy.businesses[businessId], after.economy.businesses[businessId])
    ) {
      changedBusinessIds.push(businessId);
    }
  }
  const beforeEvents = new Set(before.world.events.map((event) => event.id));
  const addedEventIds = after.world.events.filter((event) => !beforeEvents.has(event.id)).map((event) => event.id);
  return { changedSlices, changedNpcIds, addedEventIds, changedLocationIds, changedBusinessIds };
}

/** Applies changed top-level slices from a worker result onto a main-thread state object (in place). */
export function applyStateSlices(target: GameState, source: GameState, diff: StateDiff): void {
  for (const slice of diff.changedSlices) {
    const key = slice as keyof GameState;
    if (slice === 'npcs') continue;
    (target as unknown as Record<string, unknown>)[slice] = structuredClone(source[key]);
  }
  for (const npcId of diff.changedNpcIds) {
    const npc = source.npcs[npcId];
    if (npc) target.npcs[npcId] = structuredClone(npc);
  }
}

export function describeDiff(diff: StateDiff): string {
  const parts: string[] = [];
  if (diff.changedSlices.length > 0) parts.push('slices: ' + diff.changedSlices.join(','));
  if (diff.changedNpcIds.length > 0) parts.push(diff.changedNpcIds.length + ' NPCs');
  if (diff.addedEventIds.length > 0) parts.push(diff.addedEventIds.length + ' new events');
  return parts.length > 0 ? parts.join('; ') : 'no changes';
}
