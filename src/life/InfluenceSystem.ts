import type { IEventBus } from '../core/contracts';
import type { GameState } from '../core/contracts';
import type { JsonValue } from '../core/SharedTypes';
import { WORLD_CONFIG } from '../core/WorldConfig';

/**
 * Community influence: the player's standing as a special resident of Willowbrook.
 * Influence is earned from community contributions, relationships, business and public
 * events. Thresholds (from the spec) give the UI a readable ladder.
 *
 * The state stores both `player.influence` (the score) and `player.communityPoints`
 * (the contribution count). WORLD_CONFIG.life.influencePerCommunityPoint documents that
 * one community point is worth 0.2 influence, so gaining influence also credits the
 * equivalent community points and the two fields stay consistent.
 */

export type InfluenceTierId = 'new_resident' | 'known' | 'respected' | 'pillar' | 'legend';

export interface InfluenceTier {
  id: InfluenceTierId;
  label: string;
  minInfluence: number;
}

export const INFLUENCE_TIERS: readonly InfluenceTier[] = [
  { id: 'new_resident', label: 'New Resident', minInfluence: 0 },
  { id: 'known', label: 'Known Face', minInfluence: 50 },
  { id: 'respected', label: 'Respected Neighbour', minInfluence: 150 },
  { id: 'pillar', label: 'Pillar of the Community', minInfluence: 400 },
  { id: 'legend', label: 'Village Legend', minInfluence: 800 },
];

export interface InfluenceSnapshot {
  influence: number;
  communityPoints: number;
  tier: InfluenceTier;
  nextTier: InfluenceTier | null;
  /** 0..1 progress from the current tier towards the next one. */
  progressToNext: number;
}

export class InfluenceSystem {
  private readonly state: GameState;
  private readonly bus: IEventBus;
  private readonly logger?: { info(message: string, data?: JsonValue): void };

  constructor(params: { state: GameState; bus: IEventBus; logger?: { info(message: string, data?: JsonValue): void } }) {
    this.state = params.state;
    this.bus = params.bus;
    if (params.logger) this.logger = params.logger;
  }

  /** Adds influence for a documented reason and emits a UI-facing signal. */
  gainInfluence(amount: number, reason: string): number {
    if (!Number.isFinite(amount) || amount <= 0) return this.getInfluence();
    const player = this.state.player;
    const beforeTier = this.getTier();
    const gain = Math.round(amount * 100) / 100;
    player.influence = Math.round((player.influence + gain) * 100) / 100;
    const communityGain = Math.round(gain / Math.max(0.01, WORLD_CONFIG.life.influencePerCommunityPoint));
    if (communityGain > 0) player.communityPoints += communityGain;

    const afterTier = this.getTier();
    const data: JsonValue = {
      amount: gain,
      influence: player.influence,
      communityPoints: player.communityPoints,
      tier: afterTier.id,
      reason,
    };
    this.bus.emit('game:signal', { name: 'influence:changed', data });
    if (afterTier.id !== beforeTier.id) {
      this.bus.emit('game:signal', {
        name: 'influence:tier_up',
        data: { tier: afterTier.id, label: afterTier.label, influence: player.influence, reason },
      });
    }
    this.logger?.info('influence gained: ' + gain + ' (' + reason + ')');
    return player.influence;
  }

  /** Spends influence (e.g. a rejected community proposal). Never drops below zero. */
  spendInfluence(amount: number, reason: string): boolean {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const player = this.state.player;
    if (player.influence < amount) return false;
    player.influence = Math.round((player.influence - amount) * 100) / 100;
    this.bus.emit('game:signal', {
      name: 'influence:changed',
      data: { amount: -amount, influence: player.influence, communityPoints: player.communityPoints, tier: this.getTier().id, reason },
    });
    return true;
  }

  getInfluence(): number {
    return this.state.player.influence;
  }

  getCommunityPoints(): number {
    return this.state.player.communityPoints;
  }

  getTier(): InfluenceTier {
    const influence = this.state.player.influence;
    let current = INFLUENCE_TIERS[0] as InfluenceTier;
    for (const tier of INFLUENCE_TIERS) {
      if (influence >= tier.minInfluence) current = tier;
    }
    return current;
  }

  getNextTier(): InfluenceTier | null {
    const influence = this.state.player.influence;
    for (const tier of INFLUENCE_TIERS) {
      if (influence < tier.minInfluence) return tier;
    }
    return null;
  }

  getProgressToNextTier(): number {
    const current = this.getTier();
    const next = this.getNextTier();
    if (!next) return 1;
    const span = next.minInfluence - current.minInfluence;
    if (span <= 0) return 1;
    const progress = (this.state.player.influence - current.minInfluence) / span;
    return Math.min(1, Math.max(0, progress));
  }

  getSnapshot(): InfluenceSnapshot {
    return {
      influence: this.getInfluence(),
      communityPoints: this.getCommunityPoints(),
      tier: this.getTier(),
      nextTier: this.getNextTier(),
      progressToNext: this.getProgressToNextTier(),
    };
  }
}
