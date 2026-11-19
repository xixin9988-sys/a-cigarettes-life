import type { RelationshipState } from './contracts';
import type { RelationshipStatus } from './SharedTypes';
import { clamp } from './utils';

export interface RelationshipDelta {
  affinity?: number;
  trust?: number;
  intimacy?: number;
  familiarity?: number;
}

export function createRelationship(otherId: string, simTime: number, status: RelationshipStatus = 'stranger'): RelationshipState {
  return {
    otherId,
    affinity: 0,
    trust: 0,
    intimacy: 0,
    familiarity: 0,
    status,
    firstMetAt: simTime,
    lastInteractionAt: simTime,
    interactionCount: 0,
    flags: [],
    cooldowns: {},
  };
}

export function ensureRelationship(
  relationships: Record<string, RelationshipState>,
  otherId: string,
  simTime: number
): RelationshipState {
  const existing = relationships[otherId];
  if (existing) return existing;
  const created = createRelationship(otherId, simTime);
  relationships[otherId] = created;
  return created;
}

/** Applies a delta and clamps values; updates familiarity and status. */
export function applyRelationshipDelta(rel: RelationshipState, delta: RelationshipDelta, simTime: number): void {
  rel.affinity = clamp(rel.affinity + (delta.affinity ?? 0), -100, 100);
  rel.trust = clamp(rel.trust + (delta.trust ?? 0), 0, 100);
  rel.intimacy = clamp(rel.intimacy + (delta.intimacy ?? 0), 0, 100);
  rel.familiarity = clamp(rel.familiarity + (delta.familiarity ?? 0.6), 0, 100);
  rel.lastInteractionAt = simTime;
  rel.interactionCount += 1;
  refreshRelationshipStatus(rel);
}

const ROMANCE_STATUSES: readonly RelationshipStatus[] = ['dating', 'partner', 'family', 'ex'];

/** Recomputes the status when not in an explicitly managed status. */
export function refreshRelationshipStatus(rel: RelationshipState): void {
  if (ROMANCE_STATUSES.includes(rel.status)) return;
  rel.status = deriveRelationshipStatus(rel);
}

export function deriveRelationshipStatus(rel: RelationshipState): RelationshipStatus {
  if (rel.affinity <= -60) return 'enemy';
  if (rel.affinity <= -25) return 'rival';
  if (rel.affinity >= 60 && rel.intimacy >= 55 && rel.familiarity >= 75) return 'close_friend';
  if (rel.affinity >= 32 && rel.trust >= 25) return 'friend';
  if (rel.familiarity >= 8) return 'acquaintance';
  return 'stranger';
}

export function relationshipScore(rel: RelationshipState): number {
  return rel.affinity * 0.55 + rel.trust * 0.3 + rel.intimacy * 0.15;
}

export function isFriendly(rel: RelationshipState): boolean {
  return rel.affinity >= 20 && rel.trust >= 10;
}

export function isHostile(rel: RelationshipState): boolean {
  return rel.affinity <= -20 || rel.status === 'enemy' || rel.status === 'rival';
}

export function knowsNpc(rel: RelationshipState): boolean {
  return rel.interactionCount > 0 || rel.familiarity > 0;
}

export function describeRelationship(rel: RelationshipState): string {
  switch (rel.status) {
    case 'partner':
      return 'Partner';
    case 'dating':
      return 'Dating';
    case 'close_friend':
      return 'Close friend (' + Math.round(rel.affinity) + ')';
    case 'friend':
      return 'Friend (' + Math.round(rel.affinity) + ')';
    case 'acquaintance':
      return 'Acquaintance (' + Math.round(rel.affinity) + ')';
    case 'rival':
      return 'Rival (' + Math.round(rel.affinity) + ')';
    case 'enemy':
      return 'Enemy (' + Math.round(rel.affinity) + ')';
    case 'family':
      return 'Family';
    case 'ex':
      return 'Former partner';
    default:
      return 'Stranger';
  }
}