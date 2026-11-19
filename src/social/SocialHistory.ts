import type { GameState, WorldHistoryEntry } from '../core/contracts';
import type { EventId, LocationId, NPCId } from '../core/SharedTypes';
import type { WorldHistoryCategory } from '../core/contracts';
import { addWorldHistory } from '../world/WorldHistory';

export interface SocialHistoryInput {
  category: WorldHistoryCategory;
  description: string;
  importance: number;
  at?: number;
  participantIds?: NPCId[];
  locationId?: LocationId;
  relatedEventId?: EventId;
}

/**
 * Appends a social/community milestone to the shared world history through the
 * world module's addWorldHistory helper (the documented cross-module path), so
 * ids and capping stay consistent with every other system.
 */
export function addSocialHistory(state: GameState, input: SocialHistoryInput): WorldHistoryEntry {
  const at = input.at ?? state.clock.simTimeSeconds;
  const request: Parameters<typeof addWorldHistory>[1] = {
    at,
    category: input.category,
    description: input.description,
    importance: input.importance,
  };
  if (input.participantIds) request.participantIds = [...input.participantIds];
  if (input.locationId) request.locationId = input.locationId;
  if (input.relatedEventId) request.relatedEventId = input.relatedEventId;
  return addWorldHistory(state.world, request);
}

/** Appends a personal milestone to an NPC's life history (read by social/UI panels). */
export function recordNpcLifeEvent(
  npc: { lifeHistory: { at: number; type: string; description: string; importance: number }[] },
  at: number,
  type: string,
  description: string,
  importance: number
): void {
  npc.lifeHistory.push({ at, type, description, importance });
  const cap = 60;
  if (npc.lifeHistory.length <= cap) return;
  // Prefer keeping high-importance entries; drop oldest low-importance first.
  let weakestIndex = 0;
  let weakestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < npc.lifeHistory.length; i += 1) {
    const entry = npc.lifeHistory[i];
    if (!entry) continue;
    const score = entry.importance * 1000 + entry.at * 0.001;
    if (score < weakestScore) {
      weakestScore = score;
      weakestIndex = i;
    }
  }
  npc.lifeHistory.splice(weakestIndex, 1);
}
