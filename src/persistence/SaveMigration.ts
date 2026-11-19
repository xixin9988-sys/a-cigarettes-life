import type { GameState } from '../core/contracts';
import { WORLD_CONFIG } from '../core/WorldConfig';

export interface MigrationResult {
  state: GameState;
  migrated: boolean;
  fromVersion: number;
  toVersion: number;
  notes: string[];
}

/** Applies version migrations to loaded saves. New versions append migration steps here. */
export function migrateSave(raw: unknown, expectedVersion = WORLD_CONFIG.saveVersion): MigrationResult {
  const state = raw as GameState;
  const notes: string[] = [];
  let version = typeof state.version === 'number' ? state.version : 0;
  const original = version;
  if (version < 1) {
    state.version = 1;
    version = 1;
    notes.push('Initialised missing save version');
  }
  // Future migrations go here:
  // if (version < 2) { ...; version = 2; notes.push('v2: ...'); }
  state.version = Math.max(version, expectedVersion);
  state.meta.saveVersion = state.version;
  return { state, migrated: original !== state.version, fromVersion: original, toVersion: state.version, notes };
}

/** Structural sanity checks that catch corrupted or incompatible save payloads. */
export function validateLoadedState(state: GameState): string[] {
  const errors: string[] = [];
  if (!state || typeof state !== 'object') return ['Save payload is not an object'];
  if (!state.meta || typeof state.meta.seed !== 'number') errors.push('Missing meta/seed');
  if (!state.clock || typeof state.clock.simTimeSeconds !== 'number') errors.push('Missing clock');
  if (!state.player || !state.player.cigarette) errors.push('Missing player state');
  if (!state.world || !state.world.locations) errors.push('Missing world state');
  if (!state.npcs || typeof state.npcs !== 'object') errors.push('Missing NPC state');
  if (!state.probability || !Array.isArray(state.probability.history)) errors.push('Missing probability state');
  if (typeof state.version !== 'number') errors.push('Missing save version');
  return errors;
}
