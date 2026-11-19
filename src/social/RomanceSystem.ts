import type { ActionResult, IGameContext, NPCState, RelationshipState } from '../core/contracts';
import type { NPCId } from '../core/SharedTypes';
import { ensureRelationship, relationshipScore } from '../core/RelationshipUtil';
import { clamp, clamp01 } from '../core/utils';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { SIM_SECONDS_PER_DAY, SOCIAL_CONFIG, cooldownSeconds } from './config';
import {
  addPlayerMoney,
  applyInteraction,
  awardSocialXp,
  clampProbability,
  recordMemory,
  socialResult,
} from './RelationshipOps';
import { addSocialHistory, recordNpcLifeEvent } from './SocialHistory';
import {
  formatPence,
  isSamePlace,
  npcEmotionalWellbeing,
  roundDelta,
  weatherSociability,
} from './socialUtils';

/** Personality/emotion based romantic compatibility in 0..1. */
export function romanceCompatibility(npc: NPCState): number {
  const p = npc.personality;
  return clamp01(
    0.2 +
      p.generosity * 0.2 +
      p.extroversion * 0.15 +
      (1 - p.caution) * 0.15 +
      p.socialNeed * 0.15 +
      p.artisticTendency * 0.1 +
      npcEmotionalWellbeing(npc) * 0.05
  );
}

/** True when the NPC can be romanced at all (content flag + not a family member). */
export function isRomanceable(ctx: IGameContext, npc: NPCState): boolean {
  const def = ctx.content.getNPC(npc.id);
  if (!def) return false;
  const rel = ctx.state.player.relationships[npc.id];
  if (rel && rel.status === 'family') return false;
  return def.romanceable;
}

/**
 * Romance progression: confessions, dates, partner promotion and the slow drift
 * that ends neglected relationships.
 */
export class RomanceSystem {
  constructor(private readonly ctx: IGameContext) {}

  /** Chances and gate diagnostics, exposed for UI hints and tests. */
  getConfessionReadiness(npcId: NPCId): {
    canConfess: boolean;
    reason: string;
    chance: number;
    threshold: number;
    trustThreshold: number;
    intimacyThreshold: number;
  } | null {
    const ctx = this.ctx;
    const npc = ctx.state.npcs[npcId];
    if (!npc) return null;
    const rel = ctx.state.player.relationships[npcId];
    const threshold = WORLD_CONFIG.social.confessThreshold;
    const romanceable = isRomanceable(ctx, npc);
    if (!romanceable) {
      return { canConfess: false, reason: 'not_romanceable', chance: 0, threshold, trustThreshold: SOCIAL_CONFIG.confessTrustThreshold, intimacyThreshold: SOCIAL_CONFIG.confessIntimacyThreshold };
    }
    if (!rel) {
      return { canConfess: false, reason: 'not_close_enough', chance: 0, threshold, trustThreshold: SOCIAL_CONFIG.confessTrustThreshold, intimacyThreshold: SOCIAL_CONFIG.confessIntimacyThreshold };
    }
    if (rel.status === 'dating' || rel.status === 'partner') {
      return { canConfess: false, reason: 'already_together', chance: 1, threshold, trustThreshold: SOCIAL_CONFIG.confessTrustThreshold, intimacyThreshold: SOCIAL_CONFIG.confessIntimacyThreshold };
    }
    const now = ctx.clock.simTimeSeconds;
    const cooldown = rel.cooldowns['confess'] ?? 0;
    if (now < cooldown) {
      return { canConfess: false, reason: 'cooldown', chance: 0, threshold, trustThreshold: SOCIAL_CONFIG.confessTrustThreshold, intimacyThreshold: SOCIAL_CONFIG.confessIntimacyThreshold };
    }
    if (rel.affinity < threshold || rel.trust < SOCIAL_CONFIG.confessTrustThreshold || rel.intimacy < SOCIAL_CONFIG.confessIntimacyThreshold) {
      return { canConfess: false, reason: 'not_close_enough', chance: 0, threshold, trustThreshold: SOCIAL_CONFIG.confessTrustThreshold, intimacyThreshold: SOCIAL_CONFIG.confessIntimacyThreshold };
    }
    return {
      canConfess: true,
      reason: 'ready',
      chance: this.confessionChance(npc, rel),
      threshold,
      trustThreshold: SOCIAL_CONFIG.confessTrustThreshold,
      intimacyThreshold: SOCIAL_CONFIG.confessIntimacyThreshold,
    };
  }

  /** Probability formula for a confession success. */
  confessionChance(npc: NPCState, rel: RelationshipState): number {
    const threshold = WORLD_CONFIG.social.confessThreshold;
    const span = Math.max(1, 100 - threshold);
    const affinityNorm = clamp01((rel.affinity - threshold) / span);
    const trustNorm = clamp01(rel.trust / 100);
    const intimacyNorm = clamp01(rel.intimacy / 100);
    const compat = romanceCompatibility(npc);
    const wellbeing = npcEmotionalWellbeing(npc);
    const influence = clamp01(this.ctx.state.player.influence / 100);
    const raw =
      0.2 +
      affinityNorm * 0.35 +
      trustNorm * 0.2 +
      intimacyNorm * 0.1 +
      compat * 0.15 +
      wellbeing * 0.05 +
      influence * 0.05;
    return clampProbability(raw, 0.05, 0.95);
  }

  /** Confesses romantic feelings to an NPC. Gates on affinity/trust/intimacy and romanceability. */
  confessTo(npcId: NPCId): ActionResult {
    const ctx = this.ctx;
    const state = ctx.state;
    const npc = state.npcs[npcId];
    if (!npc) return socialResult(false, 'There is nobody by that name here.', 'not_found');
    if (!npc.alive) return socialResult(false, npc.name + ' is no longer around.', 'not_found');
    if (!isSamePlace(state.player.position.locationId, npc.locationId)) {
      return socialResult(false, 'You need to be standing with ' + npc.name + ' for that.', 'wrong_location');
    }
    const def = ctx.content.getNPC(npcId);
    if (!def) return socialResult(false, 'That person has no story to tell.', 'not_found');
    const rel = ensureRelationship(state.player.relationships, npcId, ctx.clock.simTimeSeconds);
    if (!isRomanceable(ctx, npc)) {
      return socialResult(false, npc.name + ' gives you a puzzled look. That is not a door that opens.', 'not_allowed');
    }
    if (rel.status === 'dating' || rel.status === 'partner') {
      return socialResult(false, 'You are already ' + (rel.status === 'partner' ? 'partners' : 'sweethearts') + '.', 'invalid');
    }
    const now = ctx.clock.simTimeSeconds;
    const cooldown = rel.cooldowns['confess'] ?? 0;
    if (now < cooldown) {
      const hours = Math.max(1, Math.ceil((cooldown - now) / 3600));
      return socialResult(false, 'Maybe give ' + npc.name + ' some space first. (' + String(hours) + 'h)', 'on_cooldown');
    }
    const threshold = WORLD_CONFIG.social.confessThreshold;
    if (rel.affinity < threshold) {
      return socialResult(
        false,
        'You are not close enough to ' + npc.name + ' for that yet. (affection ' + String(Math.round(rel.affinity)) + '/' + String(threshold) + ')',
        'requirement_not_met'
      );
    }
    if (rel.trust < SOCIAL_CONFIG.confessTrustThreshold) {
      return socialResult(
        false,
        npc.name + ' does not trust you enough to hear it yet. (trust ' + String(Math.round(rel.trust)) + '/' + String(SOCIAL_CONFIG.confessTrustThreshold) + ')',
        'requirement_not_met'
      );
    }
    if (rel.intimacy < SOCIAL_CONFIG.confessIntimacyThreshold) {
      return socialResult(
        false,
        'There is not enough closeness between you and ' + npc.name + ' yet.',
        'requirement_not_met'
      );
    }

    const chance = this.confessionChance(npc, rel);
    const accepted = ctx.probability.chance('social.romance', chance);
    if (accepted) {
      rel.status = 'dating';
      if (!rel.flags.includes('romance_started')) rel.flags.push('romance_started');
      const result = applyInteraction(
        ctx,
        npc,
        { affinity: 6, trust: 3, intimacy: 8, familiarity: 3 },
        'confess',
        'Confessed to ' + npc.name + ' - and was answered with a yes.'
      );
      rel.cooldowns['romance_started'] = now;
      recordMemory(ctx, npc, {
        type: 'romance_confession',
        text: 'The cigarette confessed how it felt. ' + npc.name + ' said yes. It is a memory that will never fade.',
        importance: 95,
        emotionalValue: 9,
        permanent: true,
      });
      recordNpcLifeEvent(npc, now, 'romance', 'Became sweethearts with the cigarette.', 5);
      addSocialHistory(state, {
        category: 'player',
        description: 'The cigarette and ' + npc.name + ' became sweethearts.',
        importance: 4,
        at: now,
        participantIds: [npc.id],
        locationId: state.player.position.locationId,
      });
      ctx.bus.emit('game:signal', { name: 'romance_started', data: { npcId, npcName: npc.name } });
      awardSocialXp(ctx, SOCIAL_CONFIG.socialXp.confess, 'social:confess');
      return socialResult(true, npc.name + ' goes very still, then smiles. "I thought you would never ask."', undefined, {
        npcId,
        accepted: true,
        chance: roundDelta(chance),
        status: rel.status,
        affinityDelta: result.affinityDelta,
        trustDelta: result.trustDelta,
        intimacyDelta: result.intimacyDelta,
      });
    }

    rel.cooldowns['confess'] = now + cooldownSeconds(SOCIAL_CONFIG.confessRejectedCooldownHours);
    rel.status = 'friend';
    applyInteraction(
      ctx,
      npc,
      { affinity: -6, trust: -1, intimacy: -2, familiarity: 1 },
      'confess',
      'Confessed to ' + npc.name + ' and was gently turned down.'
    );
    recordMemory(ctx, npc, {
      type: 'romance_rejection',
      text: 'The cigarette confessed, and ' + npc.name + ' turned it down as kindly as they could.',
      importance: 78,
      emotionalValue: -6,
      permanent: true,
    });
    recordNpcLifeEvent(npc, now, 'romance', 'Turned down a confession from the cigarette.', 4);
    ctx.bus.emit('game:signal', { name: 'romance_rejected', data: { npcId, npcName: npc.name } });
    return socialResult(
      false,
      npc.name + ' looks away. "I am fond of you, truly. Just not like that."',
      'not_allowed',
      { npcId, accepted: false, chance: roundDelta(chance), status: rel.status },
      true
    );
  }

  /** Takes a sweetheart on a date. Costs money, builds intimacy, may deepen the bond. */
  goOnDate(npcId: NPCId): ActionResult {
    const ctx = this.ctx;
    const state = ctx.state;
    const npc = state.npcs[npcId];
    if (!npc) return socialResult(false, 'There is nobody by that name here.', 'not_found');
    const rel = ensureRelationship(state.player.relationships, npcId, ctx.clock.simTimeSeconds);
    if (rel.status !== 'dating' && rel.status !== 'partner') {
      return socialResult(false, 'You and ' + npc.name + ' are not sweethearts.', 'not_allowed');
    }
    if (!isSamePlace(state.player.position.locationId, npc.locationId)) {
      return socialResult(false, npc.name + ' is not here. Ask them out in person.', 'wrong_location');
    }
    const now = ctx.clock.simTimeSeconds;
    const cooldown = rel.cooldowns['date'] ?? 0;
    if (now < cooldown) {
      const hours = Math.max(1, Math.ceil((cooldown - now) / 3600));
      return socialResult(false, 'You went out together recently. (' + String(hours) + 'h)', 'on_cooldown');
    }
    if (state.player.money < SOCIAL_CONFIG.dateCostPence) {
      return socialResult(
        false,
        'A proper date costs money. You need ' + formatPence(SOCIAL_CONFIG.dateCostPence) + '.',
        'not_enough_money'
      );
    }

    // NPC autonomy: mood, energy, workload and personality decide willingness.
    const weather = state.world.environment.weather;
    const willingness = clampProbability(
      SOCIAL_CONFIG.dateWillingBaseChance +
        romanceCompatibility(npc) * 0.15 +
        npcEmotionalWellbeing(npc) * 0.15 +
        weatherSociability(weather) * 0.05 -
        (npc.needs.workPressure / 100) * 0.15 -
        (1 - npc.needs.energy / 100) * 0.1,
      0.15,
      0.97
    );
    if (!ctx.probability.chance('social.romance', willingness)) {
      rel.cooldowns['date'] = now + cooldownSeconds(10);
      recordMemory(ctx, npc, {
        type: 'romance_declined_date',
        text: 'The cigarette asked them out, but the timing was all wrong.',
        importance: 22,
        emotionalValue: -2,
        permanent: false,
      });
      return socialResult(
        false,
        npc.name + ' sighs. "Tonight is not good. Work has me wrung out."',
        'busy',
        { npcId, willing: false, chance: roundDelta(willingness) },
        true
      );
    }

    addPlayerMoney(ctx, -SOCIAL_CONFIG.dateCostPence, 'date');
    const result = applyInteraction(
      ctx,
      npc,
      {
        affinity: SOCIAL_CONFIG.dateAffinityGain,
        trust: SOCIAL_CONFIG.dateTrustGain,
        intimacy: SOCIAL_CONFIG.dateIntimacyGain,
        familiarity: 3,
      },
      'date',
      'Went on a date with ' + npc.name + '.'
    );
    rel.cooldowns['date'] = now + cooldownSeconds(SOCIAL_CONFIG.dateCooldownHours);
    recordMemory(ctx, npc, {
      type: 'romance_date',
      text: 'A date with the cigarette: warm, easy, worth remembering.',
      importance: 58,
      emotionalValue: 7,
      permanent: false,
    });
    awardSocialXp(ctx, SOCIAL_CONFIG.socialXp.date, 'social:date');

    let becamePartner = false;
    let partnerChance = 0;
    if (rel.status === 'dating' && rel.intimacy >= SOCIAL_CONFIG.partnerIntimacyThreshold) {
      partnerChance = clampProbability(
        SOCIAL_CONFIG.partnerChancePerDate * clamp01(rel.intimacy / 100) + clamp01(relationshipScore(rel) / 100) * 0.1,
        0.05,
        0.9
      );
      if (ctx.probability.chance('social.romance', partnerChance)) {
        becamePartner = true;
        rel.status = 'partner';
        if (!rel.flags.includes('partner')) rel.flags.push('partner');
        recordMemory(ctx, npc, {
          type: 'romance_partner',
          text: 'Somewhere between the walk home and the door, they decided they were partners now. It feels permanent.',
          importance: 100,
          emotionalValue: 10,
          permanent: true,
        });
        recordNpcLifeEvent(npc, now, 'romance', 'Took the cigarette as their partner.', 5);
        addSocialHistory(state, {
          category: 'player',
          description: 'The cigarette and ' + npc.name + ' became partners for life.',
          importance: 5,
          at: now,
          participantIds: [npc.id],
          locationId: state.player.position.locationId,
        });
        ctx.bus.emit('game:signal', { name: 'romance_partner', data: { npcId, npcName: npc.name } });
      }
    }

    const partnerText = becamePartner
      ? ' By the time you walk home, the two of you are partners.'
      : '';
    return socialResult(
      true,
      'A lovely evening with ' + npc.name + '. (' + formatPence(SOCIAL_CONFIG.dateCostPence) + ')' + partnerText,
      undefined,
      {
        npcId,
        becamePartner,
        partnerChance: roundDelta(partnerChance),
        affinityDelta: result.affinityDelta,
        trustDelta: result.trustDelta,
        intimacyDelta: result.intimacyDelta,
        status: rel.status,
      }
    );
  }

  /**
   * Background romance maintenance: neglect erodes affection, and a romance that
   * falls apart leaves an 'ex' status rather than silently disappearing.
   */
  updateDrift(): void {
    const ctx = this.ctx;
    const state = ctx.state;
    const now = ctx.clock.simTimeSeconds;
    const checkInterval = cooldownSeconds(SOCIAL_CONFIG.romanceCheckIntervalHours);
    for (const npcId of Object.keys(state.player.relationships)) {
      const rel = state.player.relationships[npcId];
      if (!rel) continue;
      if (rel.status !== 'dating' && rel.status !== 'partner') continue;
      const lastCheck = rel.cooldowns['romance_check_at'] ?? rel.lastInteractionAt;
      if (now - lastCheck < checkInterval) continue;
      rel.cooldowns['romance_check_at'] = now;
      const npc = state.npcs[npcId];
      const patienceDays =
        SOCIAL_CONFIG.breakupNeglectDays +
        (npc ? npc.personality.generosity * SOCIAL_CONFIG.patienceGenerosityDays : 2) +
        (npc ? npc.personality.responsibility * SOCIAL_CONFIG.patienceResponsibilityDays : 1);
      const daysSince = (now - rel.lastInteractionAt) / SIM_SECONDS_PER_DAY;
      if (daysSince > patienceDays) {
        const decayDays = daysSince - patienceDays;
        const before = rel.affinity;
        rel.affinity = clamp(rel.affinity - SOCIAL_CONFIG.neglectAffinityPerDay * decayDays, -100, 100);
        const delta = roundDelta(rel.affinity - before);
        if (delta !== 0) {
          if (!rel.flags.includes('neglect_warned')) {
            rel.flags.push('neglect_warned');
            if (npc) {
              recordMemory(ctx, npc, {
                type: 'romance_neglect',
                text: 'The cigarette has not been around much lately. It is starting to feel like a message.',
                importance: 62,
                emotionalValue: -5,
                permanent: false,
              });
            }
          }
          ctx.bus.emit('relationship:changed', {
            npcId,
            kind: 'decay',
            affinity: rel.affinity,
            trust: rel.trust,
            intimacy: rel.intimacy,
            status: rel.status,
          });
        }
      }
      const shouldBreakup =
        rel.affinity <= SOCIAL_CONFIG.breakupAffinityThreshold || daysSince > patienceDays + 10;
      if (!shouldBreakup) continue;
      this.breakUp(npcId, rel, now, daysSince > patienceDays + 10 ? 'neglect' : 'affinity');
    }
  }

  /** Ends a romance, leaving a permanent 'ex' status and history entry. */
  breakUp(npcId: NPCId, rel: RelationshipState, now: number, cause: string): void {
    const ctx = this.ctx;
    const state = ctx.state;
    const npc = state.npcs[npcId];
    const wasPartner = rel.status === 'partner';
    rel.status = 'ex';
    rel.flags = rel.flags.filter((flag) => flag !== 'romance_started' && flag !== 'partner');
    if (!rel.flags.includes('breakup')) rel.flags.push('breakup');
    rel.cooldowns['confess'] = now + cooldownSeconds(SOCIAL_CONFIG.breakupCooldownHours);
    rel.cooldowns['date'] = now + cooldownSeconds(SOCIAL_CONFIG.breakupCooldownHours);
    if (npc) {
      recordMemory(ctx, npc, {
        type: 'romance_breakup',
        text: wasPartner
          ? 'They and the cigarette drifted apart. Partners, once. The end is remembered.'
          : 'Things with the cigarette simply stopped. The quiet after it is what they remember.',
        importance: 92,
        emotionalValue: -9,
        permanent: true,
      });
      recordNpcLifeEvent(npc, now, 'romance', 'Broke up with the cigarette (' + cause + ').', 5);
      addSocialHistory(state, {
        category: 'player',
        description: 'The cigarette and ' + npc.name + ' drifted apart' + (wasPartner ? ' after being partners' : '') + '.',
        importance: 4,
        at: now,
        participantIds: [npc.id],
      });
    }
    ctx.bus.emit('relationship:changed', {
      npcId,
      kind: 'decay',
      affinity: rel.affinity,
      trust: rel.trust,
      intimacy: rel.intimacy,
      status: rel.status,
    });
    ctx.bus.emit('game:signal', { name: 'romance_ended', data: { npcId, cause } });
  }

  /** Debug/UI helper: the player's active romances. */
  getActiveRomances(): { npcId: NPCId; partner: boolean; affinity: number; intimacy: number }[] {
    const out: { npcId: NPCId; partner: boolean; affinity: number; intimacy: number }[] = [];
    for (const [npcId, rel] of Object.entries(this.ctx.state.player.relationships)) {
      if (rel.status !== 'dating' && rel.status !== 'partner') continue;
      out.push({ npcId, partner: rel.status === 'partner', affinity: rel.affinity, intimacy: rel.intimacy });
    }
    return out;
  }

  /** Test/UI introspection: current neglect days for a romance (0 when not romanced). */
  neglectDays(npcId: NPCId): number {
    const rel = this.ctx.state.player.relationships[npcId];
    if (!rel || (rel.status !== 'dating' && rel.status !== 'partner')) return 0;
    return Math.max(0, (this.ctx.clock.simTimeSeconds - rel.lastInteractionAt) / SIM_SECONDS_PER_DAY);
  }
}
