import type { WorldHistoryCategory, WorldHistoryEntry, WorldState } from '../core/contracts';
import type { EventId, LocationId, NPCId } from '../core/SharedTypes';
import { WORLD_CONFIG } from '../core/WorldConfig';

/**
 * OWNER: Agent 4 (World & Map).
 *
 * World history is the shared, capped chronicle of everything that happens in
 * the living world (weather milestones, discoveries, journeys, festivals...).
 * Every system may append to it through {@link addWorldHistory}; the helper
 * keeps ids deterministic and monotonic (so replays and save/load keep stable
 * entry ids) and enforces WORLD_CONFIG.simulation.maxHistoryEntries.
 */

export interface AddWorldHistoryInput {
  /** Absolute sim time of the event (seconds since world start). */
  at: number;
  category: WorldHistoryCategory;
  description: string;
  /** 1 (trivia) .. 5 (life-changing). Defaults to 2. */
  importance?: number;
  participantIds?: readonly NPCId[];
  locationId?: LocationId;
  relatedEventId?: EventId;
}

const DEFAULT_IMPORTANCE = 2;
const HISTORY_ID_PATTERN = /^hist_(\d+)$/;

/** Next free sequence for 'hist_<n>' ids. Ids stay unique across the cap: the
 * highest id is never removed because trimming always drops the oldest entries. */
function nextHistorySequence(history: readonly WorldHistoryEntry[]): number {
  let max = 0;
  for (const entry of history) {
    const match = HISTORY_ID_PATTERN.exec(entry.id);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max + 1;
}

/**
 * Appends one entry to the world history, trimming the oldest entries so the
 * log never grows past WORLD_CONFIG.simulation.maxHistoryEntries. Returns the
 * created entry (with its deterministic id) so callers can link to it.
 */
export function addWorldHistory(world: WorldState, input: AddWorldHistoryInput): WorldHistoryEntry {
  const maxEntries = Math.max(1, WORLD_CONFIG.simulation.maxHistoryEntries);
  const entry: WorldHistoryEntry = {
    id: 'hist_' + nextHistorySequence(world.history),
    at: input.at,
    category: input.category,
    description: input.description,
    importance: input.importance ?? DEFAULT_IMPORTANCE,
    participantIds: input.participantIds ? [...input.participantIds] : [],
  };
  if (input.locationId !== undefined) entry.locationId = input.locationId;
  if (input.relatedEventId !== undefined) entry.relatedEventId = input.relatedEventId;
  while (world.history.length >= maxEntries) world.history.shift();
  world.history.push(entry);
  return entry;
}

/** Trims the history down to the configured cap (used after loading old saves). */
export function trimWorldHistory(world: WorldState): void {
  const maxEntries = Math.max(1, WORLD_CONFIG.simulation.maxHistoryEntries);
  const overflow = world.history.length - maxEntries;
  if (overflow > 0) world.history.splice(0, overflow);
}

/** Newest-first slice of the history, for UI/debug panels. */
export function getRecentWorldHistory(world: WorldState, limit = 20): WorldHistoryEntry[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  return world.history.slice(-safeLimit).reverse();
}

/** Convenience filter used by UI/debug screens. */
export function getWorldHistoryByCategory(
  world: WorldState,
  category: WorldHistoryCategory,
  limit = 20
): WorldHistoryEntry[] {
  const matching = world.history.filter((entry) => entry.category === category);
  return matching.slice(-Math.max(1, Math.floor(limit))).reverse();
}
