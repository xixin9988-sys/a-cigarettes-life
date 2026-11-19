// =============================================================================
// RelationshipSystem - helpers for NPC-NPC and NPC-player relationships:
// bilateral creation, delta application through RelationshipUtil, status
// refresh, long-neglect drift and player/NPC mirroring.
// Deterministic, DOM-free.
// =============================================================================
import type { GameState, NPCState, RelationshipState } from '../core/contracts';
import type { JsonValue, NPCId, RelationshipStatus } from '../core/SharedTypes';
import {
  applyRelationshipDelta,
  createRelationship,
  isFriendly,
  isHostile,
  refreshRelationshipStatus,
  relationshipScore,
  type RelationshipDelta,
} from '../core/RelationshipUtil';
import { SIM_SECONDS_PER_GAME_DAY, NPC_MODULE, readNpcExtras, writeNpcExtras } from './NPC';

export const PLAYER_RELATIONSHIP_DECAY_KEY = 'npcPlayerRelationshipDecayDay';

export interface RelationshipChange {
  otherId: string;
  status: RelationshipStatus;
  affinity: number;
  trust: number;
  intimacy: number;
  delta: RelationshipDelta;
}

export interface PairDeltas {
  a: RelationshipDelta;
  b: RelationshipDelta;
}

function dayIndex(now: number): number {
  return Math.floor(now / SIM_SECONDS_PER_GAME_DAY);
}

function addFlag(rel: RelationshipState, flag: string): void {
  if (!rel.flags.includes(flag)) rel.flags.push(flag);
}

/** Applies one day of neglect drift to a relationship (towards neutral). */
export function driftRelationshipOneDay(rel: RelationshipState): boolean {
  const before =
    Math.abs(rel.affinity) + rel.trust + rel.intimacy + rel.familiarity;
  if (rel.status === 'family' || rel.status === 'partner') {
    rel.familiarity = Math.max(0, rel.familiarity - 0.2);
  } else {
    if (rel.affinity > 0) rel.affinity = Math.max(0, rel.affinity - 0.4);
    else if (rel.affinity < 0) rel.affinity = Math.min(0, rel.affinity + 0.4);
    rel.familiarity = Math.max(0, rel.familiarity - 0.9);
    rel.trust = Math.max(0, rel.trust - 0.25);
    rel.intimacy = Math.max(0, rel.intimacy - 0.2);
  }
  refreshRelationshipStatus(rel);
  const after = Math.abs(rel.affinity) + rel.trust + rel.intimacy + rel.familiarity;
  return Math.abs(after - before) >= 0.2;
}

export class RelationshipSystem {
  /** Ensures one direction of a relationship exists. */
  ensure(npc: NPCState, otherId: string, now: number): RelationshipState {
    const existing = npc.relationships[otherId];
    if (existing) return existing;
    const created = createRelationship(otherId, now);
    npc.relationships[otherId] = created;
    return created;
  }

  /** Ensures both NPCs know each other (symmetric existence, asymmetric values). */
  ensureBilateral(a: NPCState, b: NPCState, now: number): void {
    this.ensure(a, b.id, now);
    this.ensure(b, a.id, now);
  }

  /** Applies asymmetric interaction deltas to both directions. */
  applyInteraction(a: NPCState, b: NPCState, deltas: PairDeltas, now: number): RelationshipChange[] {
    this.ensureBilateral(a, b, now);
    const relA = this.ensure(a, b.id, now);
    const relB = this.ensure(b, a.id, now);
    applyRelationshipDelta(relA, deltas.a, now);
    applyRelationshipDelta(relB, deltas.b, now);
    return [
      {
        otherId: b.id,
        status: relA.status,
        affinity: relA.affinity,
        trust: relA.trust,
        intimacy: relA.intimacy,
        delta: deltas.a,
      },
      {
        otherId: a.id,
        status: relB.status,
        affinity: relB.affinity,
        trust: relB.trust,
        intimacy: relB.intimacy,
        delta: deltas.b,
      },
    ];
  }

  /** Force-sets a shared status (used for seeded couples and milestone transitions). */
  setStatus(a: NPCState, b: NPCState, status: RelationshipStatus, now: number): void {
    this.ensureBilateral(a, b, now);
    const relA = this.ensure(a, b.id, now);
    const relB = this.ensure(b, a.id, now);
    relA.status = status;
    relB.status = status;
    relA.lastInteractionAt = now;
    relB.lastInteractionAt = now;
  }

  markFlag(a: NPCState, b: NPCState, flag: string, now: number): void {
    this.ensureBilateral(a, b, now);
    addFlag(this.ensure(a, b.id, now), flag);
    addFlag(this.ensure(b, a.id, now), flag);
  }

  /**
   * Applies neglect drift to every NPC-NPC relationship of this NPC.
   * Runs at most once per game day per NPC (marker in NPC extras).
   */
  decayNpcRelationships(npc: NPCState, now: number): RelationshipChange[] {
    const currentDay = dayIndex(now);
    const extras = readNpcExtras(npc);
    // Default marker = yesterday so the first-ever pass applies one day of drift.
    const lastDay = extras.lastRelationshipDecayDay ?? currentDay - 1;
    if (currentDay <= lastDay) return [];
    const skipped = Math.min(currentDay - lastDay, NPC_MODULE.maxRelationshipDecayDays);
    extras.lastRelationshipDecayDay = currentDay;
    writeNpcExtras(npc, extras);
    const changes: RelationshipChange[] = [];
    for (const rel of Object.values(npc.relationships)) {
      if (rel.otherId === npc.id) continue;
      const untouchedDays = (now - rel.lastInteractionAt) / SIM_SECONDS_PER_GAME_DAY;
      if (untouchedDays < NPC_MODULE.relationshipDecayGraceDays) continue;
      let changed = false;
      for (let day = 0; day < skipped; day += 1) {
        if (driftRelationshipOneDay(rel)) changed = true;
      }
      if (changed) {
        changes.push({
          otherId: rel.otherId,
          status: rel.status,
          affinity: rel.affinity,
          trust: rel.trust,
          intimacy: rel.intimacy,
          delta: { affinity: -0.4, trust: -0.25, intimacy: -0.2 },
        });
      }
    }
    return changes;
  }

  /**
   * Applies neglect drift to player-facing relationships (player.relationships).
   * Marker is stored in PlayerState.extras (free-form extension payload).
   */
  decayPlayerRelationships(state: GameState, now: number): RelationshipChange[] {
    const currentDay = dayIndex(now);
    const extras: Record<string, JsonValue> = state.player.extras ? { ...state.player.extras } : {};
    const storedDay = extras[PLAYER_RELATIONSHIP_DECAY_KEY];
    // Default marker = yesterday so a loaded save catches up immediately.
    const lastDay = typeof storedDay === 'number' ? storedDay : currentDay - 1;
    if (currentDay <= lastDay) return [];
    const skipped = Math.min(currentDay - lastDay, NPC_MODULE.maxRelationshipDecayDays);
    extras[PLAYER_RELATIONSHIP_DECAY_KEY] = currentDay;
    state.player.extras = extras;
    const changes: RelationshipChange[] = [];
    for (const rel of Object.values(state.player.relationships)) {
      const untouchedDays = (now - rel.lastInteractionAt) / SIM_SECONDS_PER_GAME_DAY;
      if (untouchedDays < NPC_MODULE.relationshipDecayGraceDays) continue;
      let changed = false;
      for (let day = 0; day < skipped; day += 1) {
        if (driftRelationshipOneDay(rel)) changed = true;
      }
      if (changed) {
        changes.push({
          otherId: rel.otherId,
          status: rel.status,
          affinity: rel.affinity,
          trust: rel.trust,
          intimacy: rel.intimacy,
          delta: { affinity: -0.4, trust: -0.25, intimacy: -0.2 },
        });
      }
    }
    return changes;
  }

  /**
   * Mirrors the player's view of a relationship onto the NPC's view so the NPC
   * remembers the player consistently (and so dialogue/memory can use it).
   */
  syncPlayerMirror(state: GameState, npc: NPCState, now: number): RelationshipState | undefined {
    const playerRel = state.player.relationships[npc.id];
    if (!playerRel) return undefined;
    const npcRel = this.ensure(npc, state.player.id, now);
    npcRel.affinity = playerRel.affinity;
    npcRel.trust = playerRel.trust;
    npcRel.intimacy = playerRel.intimacy;
    npcRel.familiarity = playerRel.familiarity;
    npcRel.status = playerRel.status;
    npcRel.firstMetAt = playerRel.firstMetAt;
    npcRel.lastInteractionAt = playerRel.lastInteractionAt;
    npcRel.interactionCount = playerRel.interactionCount;
    npcRel.flags = [...playerRel.flags];
    npcRel.cooldowns = { ...playerRel.cooldowns };
    return npcRel;
  }

  /** Friendly NPCs sorted by relationship strength. */
  friendsOf(npc: NPCState, state: GameState): NPCState[] {
    const results: { other: NPCState; score: number }[] = [];
    for (const [otherId, rel] of Object.entries(npc.relationships)) {
      if (otherId === npc.id || otherId === state.player.id) continue;
      const other = state.npcs[otherId];
      if (!other || !other.alive) continue;
      if (!isFriendly(rel) && rel.status !== 'dating' && rel.status !== 'partner' && rel.status !== 'family') continue;
      results.push({ other, score: relationshipScore(rel) });
    }
    results.sort((a, b) => b.score - a.score);
    return results.map((entry) => entry.other);
  }

  hostileOf(npc: NPCState, state: GameState): NPCState[] {
    return Object.entries(npc.relationships)
      .filter(([otherId, rel]) => otherId !== npc.id && otherId !== state.player.id && isHostile(rel))
      .map(([otherId]) => state.npcs[otherId])
      .filter((other): other is NPCState => other !== undefined && other.alive);
  }

  romanticPartnerOf(npc: NPCState, state: GameState): NPCState | undefined {
    for (const [otherId, rel] of Object.entries(npc.relationships)) {
      if (rel.status !== 'dating' && rel.status !== 'partner') continue;
      const other = state.npcs[otherId];
      if (other && other.alive) return other;
    }
    return undefined;
  }

  /** Best social target: friend/partner/family with the highest score. */
  bestSocialTarget(npc: NPCState, state: GameState): NPCState | undefined {
    const partner = this.romanticPartnerOf(npc, state);
    if (partner) return partner;
    const friends = this.friendsOf(npc, state);
    return friends[0];
  }

  scoreFor(npc: NPCState, otherId: string): number {
    const rel = npc.relationships[otherId];
    return rel ? relationshipScore(rel) : 0;
  }
}
