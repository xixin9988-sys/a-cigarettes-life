import type { ActionResult, IGameContext } from '../core/contracts';
import type { ItemId, NPCId, QualityStars } from '../core/SharedTypes';
import type { ItemDef, NPCDef } from '../data/schema';
import { ensureRelationship } from '../core/RelationshipUtil';
import { findEntry, removeItemFromInventory } from '../core/InventoryUtil';
import { clamp01 } from '../core/utils';
import { SOCIAL_CONFIG, cooldownSeconds } from './config';
import {
  applyInteraction,
  awardSocialXp,
  clampProbability,
  recordMemory,
  socialResult,
} from './RelationshipOps';
import {
  affinityDiminishingFactor,
  countTagMatches,
  isSamePlace,
  npcEmotionalWellbeing,
  roundDelta,
} from './socialUtils';

export interface GiftReaction {
  /** Affinity delta that will be applied (before relationship clamping). */
  affinityDelta: number;
  trustDelta: number;
  intimacyDelta: number;
  likedTagMatches: number;
  dislikedTagMatches: number;
  interestMatches: number;
  qualityBonus: number;
  wrappedBonus: number;
  reaction: 'loved' | 'liked' | 'neutral' | 'disliked';
}

/** Judgement of a gift based on the NPC's taste tags. Exposed for UI tooltips/tests. */
export function evaluateGift(
  npc: NPCDef | undefined,
  item: ItemDef,
  quality: QualityStars,
  npcMoodWellbeing = 0.5
): { affinityDelta: number; trustDelta: number; intimacyDelta: number; likedTagMatches: number; dislikedTagMatches: number; interestMatches: number; qualityBonus: number; wrappedBonus: number; reaction: GiftReaction['reaction'] } {
  const tasteTags = item.giftTasteTags ?? [];
  const allTags = tasteTags.length > 0 ? tasteTags : item.tags;
  const likes = npc ? npc.likes : [];
  const dislikes = npc ? npc.dislikes : [];
  const interests = npc ? npc.interests : [];

  const likedTagMatches = countTagMatches(tasteTags, likes);
  const dislikedTagMatches = countTagMatches(tasteTags, dislikes);
  const interestMatches = likedTagMatches > 0 ? 0 : countTagMatches(allTags, interests);
  const qualityBonus = roundDelta((quality - 1) * SOCIAL_CONFIG.giftQualityBonusPerStar);
  const wrappedBonus = item.category === 'gift' ? SOCIAL_CONFIG.giftWrappedBonus : 0;
  const moodFactor = 0.8 + (1 - clamp01(npcMoodWellbeing)) * 0.5;

  let affinityDelta: number;
  if (dislikedTagMatches > 0) {
    // A disliked gift is remembered for the wrong reasons; quality cannot save it.
    affinityDelta =
      -SOCIAL_CONFIG.giftDislikedPenalty * (1 + 0.5 * (dislikedTagMatches - 1)) +
      qualityBonus * 0.25 +
      (likedTagMatches > 0 ? SOCIAL_CONFIG.giftLikedTagBonus * likedTagMatches * 0.5 : 0);
  } else if (likedTagMatches > 0) {
    affinityDelta =
      (SOCIAL_CONFIG.giftBaseGain + SOCIAL_CONFIG.giftLikedTagBonus * likedTagMatches + qualityBonus + wrappedBonus) *
      moodFactor;
  } else {
    affinityDelta = SOCIAL_CONFIG.giftBaseGain * 0.35 + qualityBonus * 0.5 + wrappedBonus + interestMatches * 1.1;
  }
  affinityDelta = roundDelta(affinityDelta);
  const trustDelta = roundDelta(dislikedTagMatches > 0 ? -0.5 : 0.8 + qualityBonus * 0.15);
  const intimacyDelta = roundDelta(likedTagMatches > 0 ? 0.6 + qualityBonus * 0.2 : 0.1);
  const reaction: GiftReaction['reaction'] =
    affinityDelta >= 9 ? 'loved' : affinityDelta >= 4 ? 'liked' : affinityDelta > -2 ? 'neutral' : 'disliked';
  return {
    affinityDelta,
    trustDelta,
    intimacyDelta,
    likedTagMatches,
    dislikedTagMatches,
    interestMatches,
    qualityBonus,
    wrappedBonus,
    reaction,
  };
}

/**
 * Gift giving: consumes one item, scores it against the NPC's likes/dislikes and
 * quality, then applies relationship/memory/statistics effects.
 */
export class GiftSystem {
  constructor(private readonly ctx: IGameContext) {}

  /** Presents a specific inventory instance to an NPC standing nearby. */
  giveGift(npcId: NPCId, instanceId: string): ActionResult {
    const ctx = this.ctx;
    const state = ctx.state;
    const npc = state.npcs[npcId];
    if (!npc) return socialResult(false, 'There is nobody by that name here.', 'not_found');
    if (!npc.alive) return socialResult(false, npc.name + ' is no longer around.', 'not_found');
    if (!isSamePlace(state.player.position.locationId, npc.locationId)) {
      return socialResult(false, npc.name + ' is not here right now.', 'wrong_location');
    }
    const entry = findEntry(state.player.inventory, instanceId);
    if (!entry) return socialResult(false, 'You are not carrying that item.', 'not_found');
    const item = ctx.content.getItem(entry.itemId);
    if (!item) return socialResult(false, 'That item is not part of the world.', 'not_found');

    const now = ctx.clock.simTimeSeconds;
    const rel = ensureRelationship(state.player.relationships, npcId, now);
    const cooldown = rel.cooldowns['gift'] ?? 0;
    if (now < cooldown) {
      const minutes = Math.max(1, Math.ceil((cooldown - now) / 60));
      return socialResult(false, npc.name + ' has already received a gift recently. (' + String(minutes) + ' min)', 'on_cooldown');
    }

    // Really hostile NPCs refuse gifts from the player outright.
    const acceptance = this.acceptanceChance(npcId);
    if (acceptance < 1 && !ctx.probability.chance('social.interaction', acceptance)) {
      rel.cooldowns['gift'] = now + cooldownSeconds(1);
      return socialResult(
        false,
        npc.name + ' does not take it. "Not from you. Not yet."',
        'not_allowed',
        { npcId, acceptanceChance: acceptance },
        true
      );
    }

    const npcDef = ctx.content.getNPC(npcId);
    const quality = entry.quality;
    const reaction = evaluateGift(npcDef, item, quality, npcEmotionalWellbeing(npc));
    const diminishing = affinityDiminishingFactor(
      rel,
      SOCIAL_CONFIG.talkDiminishingFloor,
      SOCIAL_CONFIG.talkDiminishingDivisor
    );
    const affinityDelta = roundDelta(reaction.affinityDelta >= 0 ? reaction.affinityDelta * diminishing : reaction.affinityDelta);
    const trustDelta = reaction.trustDelta;
    const intimacyDelta = reaction.intimacyDelta;

    removeItemFromInventory(state.player.inventory, entry.itemId, 1, instanceId);
    ctx.bus.emit('item:lost', { itemId: entry.itemId, quantity: 1, reason: 'gift' });

    const summary =
      reaction.reaction === 'disliked'
        ? 'Gave ' + itemName(item) + ' to ' + npc.name + ', who clearly does not care for it.'
        : 'Gave ' + itemName(item) + ' to ' + npc.name + '.';
    const result = applyInteraction(
      ctx,
      npc,
      { affinity: affinityDelta, trust: trustDelta, intimacy: intimacyDelta, familiarity: 2.5 },
      'gift',
      summary
    );
    rel.cooldowns['gift'] = now + cooldownSeconds(SOCIAL_CONFIG.giftCooldownHours);
    state.player.statistics.giftsGiven += 1;

    const memoryImportance =
      reaction.reaction === 'disliked' ? 45 : reaction.reaction === 'loved' ? 48 : 20;
    recordMemory(ctx, npc, {
      type: reaction.reaction === 'disliked' ? 'social_gift_disliked' : 'social_gift',
      text:
        reaction.reaction === 'disliked'
          ? 'The cigarette gave them ' + itemName(item) + '. They will not say it out loud, but it was not their sort of thing.'
          : 'The cigarette gave them ' + itemName(item) + (quality >= 4 ? ', and it was a fine one at that' : '') + '.',
      importance: memoryImportance,
      emotionalValue: reaction.reaction === 'disliked' ? -4 : 5,
      permanent: false,
    });
    awardSocialXp(ctx, SOCIAL_CONFIG.socialXp.gift, 'social:gift');

    let message: string;
    switch (reaction.reaction) {
      case 'loved':
        message = npc.name + ' lights up at the gift. ' + itemName(item) + ' was exactly right.';
        break;
      case 'liked':
        message = npc.name + ' is clearly pleased with ' + itemName(item) + '.';
        break;
      case 'disliked':
        message = npc.name + ' thanks you politely, but ' + itemName(item) + ' is not to their taste.';
        break;
      default:
        message = npc.name + ' accepts ' + itemName(item) + ' with a nod.';
        break;
    }
    return socialResult(true, message, undefined, {
      npcId,
      itemId: entry.itemId,
      quality,
      reaction: reaction.reaction,
      affinityDelta: result.affinityDelta,
      trustDelta: result.trustDelta,
      intimacyDelta: result.intimacyDelta,
      likedTagMatches: reaction.likedTagMatches,
      dislikedTagMatches: reaction.dislikedTagMatches,
      status: rel.status,
    });
  }

  /** Dry-run taste judgement (used by UI to show a hint before gifting). */
  previewGift(npcId: NPCId, itemId: ItemId): GiftReaction | null {
    const ctx = this.ctx;
    const npc = ctx.state.npcs[npcId];
    const item = ctx.content.getItem(itemId);
    if (!npc || !item) return null;
    const npcDef = ctx.content.getNPC(npcId);
    const reaction = evaluateGift(npcDef, item, 3, npcEmotionalWellbeing(npc));
    return {
      affinityDelta: reaction.affinityDelta,
      trustDelta: reaction.trustDelta,
      intimacyDelta: reaction.intimacyDelta,
      likedTagMatches: reaction.likedTagMatches,
      dislikedTagMatches: reaction.dislikedTagMatches,
      interestMatches: reaction.interestMatches,
      qualityBonus: reaction.qualityBonus,
      wrappedBonus: reaction.wrappedBonus,
      reaction: reaction.reaction,
    };
  }

  /** Chance an NPC accepts a gift at all (hostile NPCs sometimes refuse). */
  acceptanceChance(npcId: NPCId): number {
    const rel = this.ctx.state.player.relationships[npcId];
    if (!rel) return 1;
    if (rel.affinity < -40) return clampProbability(0.15, 0.05, 0.5);
    return 1;
  }
}

/** Local item-name helper (keeps message building readable). */
function itemName(item: ItemDef): string {
  return item.name;
}
