import type { ActionResult, IGameContext } from '../core/contracts';
import type { NPCId } from '../core/SharedTypes';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { ensureRelationship, isHostile } from '../core/RelationshipUtil';
import { clamp01 } from '../core/utils';
import { SOCIAL_CONFIG, cooldownSeconds } from './config';
import {
  addPlayerItem,
  applyInteraction,
  awardSocialXp,
  clampProbability,
  recordMemory,
  socialResult,
} from './RelationshipOps';
import { affinityDiminishingFactor, isSamePlace, npcEmotionalWellbeing, roundDelta, weatherSociability } from './socialUtils';
import { ITEM } from '../data/items/ids';

/** Weather flavour used in memory/summary lines. */
function weatherFlavour(weather: string): string {
  switch (weather) {
    case 'rain':
      return 'as the rain pattered down';
    case 'storm':
      return 'while the storm rattled the windows';
    case 'snow':
      return 'with snow drifting past';
    case 'fog':
      return 'through the fog';
    case 'wind':
      return 'with the wind tugging at everything';
    case 'clear':
      return 'under a clear sky';
    default:
      return 'on a grey afternoon';
  }
}

/** Time-of-day willingness multiplier for casual conversation. */
function timeOfDayFactor(hour: number): number {
  if (hour >= 23 || hour < 5) return 0.5;
  if (hour >= 5 && hour < 8) return 0.82;
  if (hour >= 21) return 0.72;
  return 1;
}

/** Items an NPC may hand over as a token of thanks. */
const REPAYMENT_ITEM_IDS: readonly string[] = [
  ITEM.pressedFlower,
  ITEM.handmadeCandle,
  ITEM.paintedCard,
  ITEM.jam,
  ITEM.honeyJar,
  ITEM.teaCup,
  ITEM.wildBerries,
];

/**
 * Player-facing friendship mechanics: chatting, helping and apologising.
 * Owned by SocialSystem (not a registered system itself).
 */
export class FriendshipSystem {
  constructor(private readonly ctx: IGameContext) {}

  /** Casual chat with a nearby NPC. Applies personality/needs/weather modified deltas. */
  talkTo(npcId: NPCId): ActionResult {
    const ctx = this.ctx;
    const state = ctx.state;
    const npc = state.npcs[npcId];
    if (!npc) return socialResult(false, 'There is nobody by that name here.', 'not_found');
    if (!npc.alive) return socialResult(false, npc.name + ' is no longer around.', 'not_found');
    if (!isSamePlace(state.player.position.locationId, npc.locationId)) {
      return socialResult(false, npc.name + ' is not here right now.', 'wrong_location');
    }
    const now = ctx.clock.simTimeSeconds;
    const rel = ensureRelationship(state.player.relationships, npcId, now);
    const cooldown = rel.cooldowns['talk'] ?? 0;
    if (now < cooldown) {
      const minutes = Math.max(1, Math.ceil((cooldown - now) / 60));
      return socialResult(false, npc.name + ' is still mid-thought. Try again in ' + String(minutes) + ' min.', 'on_cooldown');
    }
    if (isHostile(rel) && rel.affinity <= -25) {
      rel.cooldowns['talk'] = now + cooldownSeconds(0.5);
      return socialResult(
        false,
        npc.name + ' turns away. Whatever is between you will need more than small talk.',
        'not_allowed',
        undefined,
        true
      );
    }

    const firstMeeting = rel.interactionCount === 0;
    const p = npc.personality;
    const weather = state.world.environment.weather;
    const hour = ctx.clock.time.hour;
    const friendliness = 0.55 + p.extroversion * 0.55 + p.generosity * 0.2;
    const needFactor = 0.6 + (npc.needs.social / 100) * 0.9;
    const moodFactor = 0.75 + npcEmotionalWellbeing(npc) * 0.5;
    const sociability = weatherSociability(weather);
    const timeFactor = timeOfDayFactor(hour);
    const familiarityBonus = 0.8 + clamp01(rel.familiarity / 100) * 0.4;
    const diminishing = affinityDiminishingFactor(rel, SOCIAL_CONFIG.talkDiminishingFloor, SOCIAL_CONFIG.talkDiminishingDivisor);
    const greetingBonus = firstMeeting ? 1.45 : 1;

    const affinity = roundDelta(
      WORLD_CONFIG.social.chatAffinityGain *
        friendliness *
        needFactor *
        moodFactor *
        sociability *
        timeFactor *
        familiarityBonus *
        diminishing *
        greetingBonus
    );
    const trust = roundDelta(0.42 * friendliness * (0.6 + p.responsibility * 0.8) * diminishing);
    const isClose = rel.status === 'close_friend' || rel.status === 'dating' || rel.status === 'partner';
    const intimacy = roundDelta(isClose ? 0.3 * clamp01(rel.familiarity / 100) : 0.04);
    const familiarity = roundDelta(1 + p.extroversion * 0.6);

    const result = applyInteraction(
      ctx,
      npc,
      { affinity, trust, intimacy, familiarity },
      firstMeeting ? 'greet' : 'chat',
      firstMeeting
        ? 'Met ' + npc.name + ' for the first time, ' + weatherFlavour(weather) + '.'
        : 'Chatted with ' + npc.name + ' ' + weatherFlavour(weather) + '.'
    );
    rel.cooldowns['talk'] = now + cooldownSeconds(SOCIAL_CONFIG.talkCooldownHours);
    state.player.statistics.conversations += 1;

    recordMemory(ctx, npc, {
      type: 'social_chat',
      text:
        'The cigarette ' +
        (firstMeeting ? 'introduced itself' : 'stopped for a chat') +
        ' ' +
        weatherFlavour(weather) +
        '.',
      importance: firstMeeting ? 12 : 3,
      emotionalValue: affinity >= 1 ? 2 : 0,
      permanent: false,
    });
    awardSocialXp(ctx, SOCIAL_CONFIG.socialXp.talk, 'social:talk');

    const statusLine =
      rel.status === 'friend' || rel.status === 'close_friend' || rel.status === 'dating' || rel.status === 'partner'
        ? ' You are ' + rel.status.replace(/_/g, ' ') + ' now.'
        : '';
    const message = firstMeeting
      ? npc.name + ' introduces themselves. The conversation is warm enough.' + statusLine
      : npc.name + ' seems ' + (affinity > 1.5 ? 'glad' : affinity > 0 ? 'content' : 'polite') + ' to chat.' + statusLine;
    return socialResult(true, message, undefined, {
      npcId,
      affinityDelta: result.affinityDelta,
      trustDelta: result.trustDelta,
      intimacyDelta: result.intimacyDelta,
      status: rel.status,
      firstMeeting,
    });
  }

  /** Helps an NPC with their burden. Builds trust; may earn a small token of thanks. */
  helpNPC(npcId: NPCId): ActionResult {
    const ctx = this.ctx;
    const state = ctx.state;
    const npc = state.npcs[npcId];
    if (!npc) return socialResult(false, 'There is nobody by that name here.', 'not_found');
    if (!npc.alive) return socialResult(false, npc.name + ' is no longer around.', 'not_found');
    if (!isSamePlace(state.player.position.locationId, npc.locationId)) {
      return socialResult(false, npc.name + ' is not here right now.', 'wrong_location');
    }
    const now = ctx.clock.simTimeSeconds;
    const rel = ensureRelationship(state.player.relationships, npcId, now);
    const cooldown = rel.cooldowns['help'] ?? 0;
    if (now < cooldown) {
      const minutes = Math.max(1, Math.ceil((cooldown - now) / 60));
      return socialResult(false, npc.name + ' does not need help again yet. (' + String(minutes) + ' min)', 'on_cooldown');
    }
    if (isHostile(rel) && rel.affinity <= -25) {
      return socialResult(false, npc.name + ' would rather manage alone than accept help from you.', 'not_allowed');
    }

    const p = npc.personality;
    const workPressure = npc.needs.workPressure / 100;
    const generosity = p.generosity;
    const diminishing = affinityDiminishingFactor(rel, SOCIAL_CONFIG.talkDiminishingFloor, SOCIAL_CONFIG.talkDiminishingDivisor);
    const needFactor = 0.6 + workPressure * 0.9 + (1 - npc.needs.energy / 100) * 0.2;
    const affinity = roundDelta(SOCIAL_CONFIG.helpBaseGain * needFactor * (0.65 + generosity * 0.6) * diminishing);
    const trust = roundDelta(3 * (0.5 + p.responsibility * 0.7));
    const intimacy = roundDelta(0.35 + generosity * 0.3);
    const familiarity = roundDelta(2.2);

    const firstHelp = !rel.flags.includes('helped_before');
    if (firstHelp) rel.flags.push('helped_before');
    const result = applyInteraction(ctx, npc, { affinity, trust, intimacy, familiarity }, 'help', 'Helped ' + npc.name + ' with their work.');
    rel.cooldowns['help'] = now + cooldownSeconds(SOCIAL_CONFIG.helpCooldownHours);

    recordMemory(ctx, npc, {
      type: 'social_help',
      text: 'The cigarette went out of its way to help them. That is not nothing.',
      importance: firstHelp ? 55 : 22,
      emotionalValue: 4,
      permanent: false,
    });

    // A grateful NPC may repay with something small from their pockets.
    const repayChance = clampProbability(SOCIAL_CONFIG.helpRepayBaseChance + generosity * 0.25 + rel.trust / 400, 0.05, 0.85);
    let repayedItemId: string | null = null;
    if (ctx.probability.chance('social.interaction', repayChance)) {
      const candidates = REPAYMENT_ITEM_IDS.filter((itemId) => ctx.content.getItem(itemId) !== undefined);
      if (candidates.length > 0) {
        const index = ctx.probability.intRange('social.interaction', 0, candidates.length - 1);
        const itemId = candidates[index];
        if (itemId) {
          addPlayerItem(ctx, itemId, 1, 2, 'npc_repayment');
          repayedItemId = itemId;
          recordMemory(ctx, npc, {
            type: 'social_repayment',
            text: 'They thanked the cigarette with a small token: ' + ctx.content.resolveItemName(itemId) + '.',
            importance: 30,
            emotionalValue: 3,
            permanent: false,
          });
        }
      }
    }

    if (firstHelp && rel.trust >= 45) {
      recordMemory(ctx, npc, {
        type: 'social_bond',
        text: 'The cigarette proved it could be relied on. ' + npc.name + ' will remember that.',
        importance: 82,
        emotionalValue: 6,
        permanent: true,
      });
    }

    awardSocialXp(ctx, SOCIAL_CONFIG.socialXp.help, 'social:help');

    const repayText =
      repayedItemId === null
        ? ''
        : ' They press a small thank-you into your hand: ' + ctx.content.resolveItemName(repayedItemId) + '.';
    return socialResult(true, npc.name + ' is grateful for the help.' + repayText, undefined, {
      npcId,
      affinityDelta: result.affinityDelta,
      trustDelta: result.trustDelta,
      intimacyDelta: result.intimacyDelta,
      status: rel.status,
      repaidItemId: repayedItemId ?? '',
    });
  }

  /** Attempts to mend a damaged relationship. Needs a real grievance to exist. */
  apologiseTo(npcId: NPCId): ActionResult {
    const ctx = this.ctx;
    const state = ctx.state;
    const npc = state.npcs[npcId];
    if (!npc) return socialResult(false, 'There is nobody by that name here.', 'not_found');
    if (!isSamePlace(state.player.position.locationId, npc.locationId)) {
      return socialResult(false, npc.name + ' is not here right now.', 'wrong_location');
    }
    const now = ctx.clock.simTimeSeconds;
    const rel = ensureRelationship(state.player.relationships, npcId, now);
    const hasGrievance = rel.affinity < SOCIAL_CONFIG.apologiseAffinityThreshold || rel.trust < 25;
    if (!hasGrievance) {
      return socialResult(false, 'There is nothing to apologise for. ' + npc.name + ' is on good terms with you.', 'not_allowed');
    }
    const cooldown = rel.cooldowns['apologise'] ?? 0;
    if (now < cooldown) {
      const minutes = Math.max(1, Math.ceil((cooldown - now) / 60));
      return socialResult(false, 'An apology so soon would ring hollow. (' + String(minutes) + ' min)', 'on_cooldown');
    }

    const p = npc.personality;
    const depth = clamp01(Math.abs(Math.min(0, rel.affinity)) / 100);
    const chance = clampProbability(
      SOCIAL_CONFIG.apologiseBaseChance + p.generosity * 0.2 + (1 - depth) * 0.25 + clamp01(rel.familiarity / 300),
      0.12,
      0.9
    );
    const accepted = ctx.probability.chance('social.interaction', chance);
    rel.cooldowns['apologise'] = now + cooldownSeconds(SOCIAL_CONFIG.apologiseCooldownHours);

    if (accepted) {
      const affinity = roundDelta(Math.min(30, 6 + Math.abs(Math.min(0, rel.affinity)) * 0.5));
      const trust = roundDelta(5);
      const result = applyInteraction(
        ctx,
        npc,
        { affinity, trust, intimacy: 1, familiarity: 2 },
        'apologise',
        'Apologised to ' + npc.name + ', and they accepted it.'
      );
      if (!rel.flags.includes('apologised')) rel.flags.push('apologised');
      recordMemory(ctx, npc, {
        type: 'social_apology',
        text: 'The cigarette swallowed its pride and apologised properly. They accepted.',
        importance: 70,
        emotionalValue: 5,
        permanent: false,
      });
      awardSocialXp(ctx, SOCIAL_CONFIG.socialXp.apologise, 'social:apologise');
      return socialResult(true, npc.name + ' listens, sighs, and accepts the apology. Things thaw a little.', undefined, {
        npcId,
        accepted: true,
        chance: roundDelta(chance),
        affinityDelta: result.affinityDelta,
        trustDelta: result.trustDelta,
        status: rel.status,
      });
    }

    const result = applyInteraction(
      ctx,
      npc,
      { affinity: 1, trust: 0.5, intimacy: 0, familiarity: 1 },
      'apologise',
      'Apologised to ' + npc.name + ', but it was not enough yet.'
    );
    recordMemory(ctx, npc, {
      type: 'social_apology_failed',
      text: 'The cigarette tried to apologise, but the words landed badly.',
      importance: 32,
      emotionalValue: -2,
      permanent: false,
    });
    awardSocialXp(ctx, SOCIAL_CONFIG.socialXp.apologise * 0.5, 'social:apologise');
    return socialResult(
      false,
      npc.name + ' accepts that you spoke, but is not ready to forgive yet.',
      'requirement_not_met',
      { npcId, accepted: false, chance: roundDelta(chance), affinityDelta: result.affinityDelta, trustDelta: result.trustDelta, status: rel.status },
      true
    );
  }

}
