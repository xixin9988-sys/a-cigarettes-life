import type { ActionResult, IGameContext, InvitationState, NPCState } from '../core/contracts';
import type { LocationId, NPCId } from '../core/SharedTypes';
import { ensureRelationship, isHostile, relationshipScore } from '../core/RelationshipUtil';
import { clamp01 } from '../core/utils';
import { LOC } from '../data/locations/ids';
import { SOCIAL_CONFIG, cooldownSeconds } from './config';
import {
  applyInteraction,
  awardSocialXp,
  clampProbability,
  recordMemory,
  socialResult,
} from './RelationshipOps';
import { addSocialHistory, recordNpcLifeEvent } from './SocialHistory';
import {
  formatGameHours,
  invitationWeatherModifier,
  isSamePlace,
  locationName,
  nextSequentialId,
  npcEmotionalWellbeing,
  roundDelta,
} from './socialUtils';

export type InvitationActivity = InvitationState['activity'];

const ACTIVITY_LABELS: Readonly<Record<InvitationActivity, string>> = {
  walk: 'a walk',
  coffee: 'coffee',
  meal: 'a meal',
  date: 'a date',
  festival: 'the festival',
  help: 'a hand with something',
};

/** Preferred venues per activity (first existing location wins). */
const ACTIVITY_VENUES: Readonly<Record<InvitationActivity, readonly LocationId[]>> = {
  walk: [LOC.park, LOC.cityPark, LOC.riversideWalk, LOC.countryside, LOC.center],
  coffee: [LOC.cafe, LOC.cityCafe],
  meal: [LOC.bakery, LOC.cafe, LOC.restaurant],
  date: [LOC.restaurant, LOC.cafe, LOC.cityPark, LOC.plaza],
  festival: [LOC.plaza, LOC.eventSquare, LOC.park],
  help: [],
};

/**
 * Invitation mechanics: the player asking an NPC out, accepting/declining, and
 * NPCs proactively inviting the player (with festival invites when one is live).
 */
export class InvitationSystem {
  private lastNpcInviteTickAt = -1;

  constructor(private readonly ctx: IGameContext) {}

  /** Called from SocialSystem.init so NPC invites start from "now". */
  initialise(): void {
    if (this.lastNpcInviteTickAt < 0) {
      this.lastNpcInviteTickAt = this.ctx.clock.simTimeSeconds;
    }
  }

  /** All still-actionable invitations (pending, not past their expiry). */
  getInvitations(): InvitationState[] {
    const now = this.ctx.clock.simTimeSeconds;
    return this.ctx.state.social.invitations
      .filter((invitation) => invitation.status === 'pending' && invitation.expiresAt > now)
      .sort((a, b) => a.proposedAt - b.proposedAt);
  }

  /** Player asks an NPC to spend time together. */
  inviteNPC(npcId: NPCId, activity: InvitationActivity): ActionResult {
    const ctx = this.ctx;
    const state = ctx.state;
    const npc = state.npcs[npcId];
    if (!npc) return socialResult(false, 'There is nobody by that name here.', 'not_found');
    if (!npc.alive) return socialResult(false, npc.name + ' is no longer around.', 'not_found');
    if (!isSamePlace(state.player.position.locationId, npc.locationId)) {
      return socialResult(false, npc.name + ' is not here to ask.', 'wrong_location');
    }
    const pending = this.getInvitations();
    if (pending.length >= SOCIAL_CONFIG.maxPendingInvitations) {
      return socialResult(false, 'You already have invitations waiting. Sort those out first.', 'capacity_reached');
    }
    if (pending.some((invitation) => invitation.fromNpcId === npcId)) {
      return socialResult(false, npc.name + ' is already waiting on an answer from you.', 'invalid');
    }
    const now = ctx.clock.simTimeSeconds;
    const rel = ensureRelationship(state.player.relationships, npcId, now);
    const cooldown = rel.cooldowns['invite'] ?? 0;
    if (now < cooldown) {
      const minutes = Math.max(1, Math.ceil((cooldown - now) / 60));
      return socialResult(false, npc.name + ' has other plans for now. (' + String(minutes) + ' min)', 'on_cooldown');
    }

    if (activity === 'date' && rel.status !== 'dating' && rel.status !== 'partner') {
      return socialResult(false, 'You cannot ask ' + npc.name + ' on a date - you are not sweethearts.', 'not_allowed');
    }
    const activeFestival = this.getActiveFestival();
    if (activity === 'festival' && !activeFestival) {
      return socialResult(false, 'There is no festival running to invite anyone to.', 'wrong_time');
    }

    const chance = this.invitationAcceptanceChance(npc, rel, activity);
    const accepted = ctx.probability.chance('social.interaction', chance);
    if (!accepted) {
      rel.cooldowns['invite'] = now + cooldownSeconds(SOCIAL_CONFIG.inviteDeclinedCooldownHours);
      recordMemory(ctx, npc, {
        type: 'invitation_declined',
        text: 'The cigarette asked them to ' + ACTIVITY_LABELS[activity] + '. The timing was simply wrong.',
        importance: 18,
        emotionalValue: -1,
        permanent: false,
      });
      return socialResult(
        false,
        npc.name + ' shakes their head. "Not today, sorry."',
        'busy',
        { npcId, activity, accepted: false, chance: roundDelta(chance) },
        true
      );
    }

    const locationId = this.resolveActivityLocation(activity, npc);
    const invitation = this.createInvitation(npcId, activity, locationId, now);
    rel.cooldowns['invite'] = now + cooldownSeconds(SOCIAL_CONFIG.inviteCooldownHours);
    awardSocialXp(ctx, SOCIAL_CONFIG.socialXp.invite, 'social:invite');
    ctx.bus.emit('game:signal', {
      name: 'invitation_offered',
      data: { invitationId: invitation.id, npcId, activity, locationId },
    });
    recordMemory(ctx, npc, {
      type: 'invitation_accepted',
      text: 'The cigarette asked them to ' + ACTIVITY_LABELS[activity] + ' and they said yes.',
      importance: 26,
      emotionalValue: 3,
      permanent: false,
    });
    const place = locationName(ctx.content, locationId);
    return socialResult(
      true,
      npc.name + ' would love to. You agree to meet for ' + ACTIVITY_LABELS[activity] + ' at ' + place + '.',
      undefined,
      {
        npcId,
        activity,
        accepted: true,
        chance: roundDelta(chance),
        invitationId: invitation.id,
        locationId,
      }
    );
  }

  /** Probability an NPC says yes to a player invitation. */
  invitationAcceptanceChance(npc: NPCState, rel: ReturnType<typeof ensureRelationship>, activity: InvitationActivity): number {
    const state = this.ctx.state;
    const p = npc.personality;
    const affinityNorm = clamp01((rel.affinity + 100) / 200);
    const trustNorm = clamp01(rel.trust / 100);
    const outdoor = activity === 'walk' || activity === 'festival' || activity === 'date';
    let chance =
      0.18 +
      affinityNorm * 0.4 +
      trustNorm * 0.15 +
      p.extroversion * 0.08 +
      p.socialNeed * 0.08 +
      ((npc.needs.social + npc.needs.fun) / 200) * 0.06 -
      (npc.needs.workPressure / 100) * 0.1 -
      (1 - npc.needs.energy / 100) * 0.05 +
      npcEmotionalWellbeing(npc) * 0.05;
    if (outdoor) chance += invitationWeatherModifier(state.world.environment.weather);
    switch (activity) {
      case 'walk':
        chance += p.adventure * 0.06;
        break;
      case 'coffee':
        chance += p.extroversion * 0.05;
        break;
      case 'meal':
        chance += 0.03;
        break;
      case 'festival':
        chance += 0.08;
        break;
      case 'date':
        chance += clamp01(npcEmotionalWellbeing(npc)) * 0.06;
        break;
      default:
        break;
    }
    if (isHostile(rel)) chance = Math.min(chance, 0.05);
    return clampProbability(chance, 0.03, 0.95);
  }

  /** Player accepts a pending invitation. */
  acceptInvitation(invitationId: string): ActionResult {
    const ctx = this.ctx;
    const state = ctx.state;
    const now = ctx.clock.simTimeSeconds;
    const invitation = state.social.invitations.find((item) => item.id === invitationId);
    if (!invitation) return socialResult(false, 'That invitation no longer exists.', 'not_found');
    if (invitation.status !== 'pending') return socialResult(false, 'That invitation is already settled.', 'invalid');
    if (invitation.expiresAt <= now) {
      invitation.status = 'expired';
      return socialResult(false, 'That invitation has expired.', 'wrong_time');
    }
    const npc = state.npcs[invitation.fromNpcId];
    if (!npc) {
      invitation.status = 'expired';
      return socialResult(false, 'The invitation came from someone who is no longer around.', 'not_found');
    }

    invitation.status = 'accepted';
    const together = isSamePlace(state.player.position.locationId, npc.locationId);
    const bonus = together ? 1 : 0.6;
    const intimacyBonus = invitation.activity === 'date' ? 2 : invitation.activity === 'festival' ? 1 : 0;
    const result = applyInteraction(
      ctx,
      npc,
      {
        affinity: SOCIAL_CONFIG.invitationRelationshipAffinity * bonus,
        trust: SOCIAL_CONFIG.invitationRelationshipTrust * bonus,
        intimacy: (SOCIAL_CONFIG.invitationRelationshipIntimacy + intimacyBonus) * bonus,
        familiarity: 1.5,
      },
      'invite',
      'Accepted ' + npc.name + "'s invitation to " + ACTIVITY_LABELS[invitation.activity] + '.'
    );
    awardSocialXp(ctx, SOCIAL_CONFIG.socialXp.invitationAccepted, 'social:invite');
    recordMemory(ctx, npc, {
      type: 'invitation_fulfilled',
      text: 'The cigarette showed up for ' + ACTIVITY_LABELS[invitation.activity] + '. Showing up matters.',
      importance: invitation.activity === 'date' ? 60 : 34,
      emotionalValue: 5,
      permanent: false,
    });
    if (invitation.activity === 'date' || invitation.activity === 'festival') {
      if (npc.lifeHistory.length < 60) {
        recordNpcLifeEvent(npc, now, 'social', 'Spent ' + ACTIVITY_LABELS[invitation.activity] + ' with the cigarette.', 2);
      }
      addSocialHistory(state, {
        category: 'player',
        description: 'The cigarette joined ' + npc.name + ' for ' + ACTIVITY_LABELS[invitation.activity] + ' at ' + locationName(ctx.content, invitation.locationId) + '.',
        importance: 2,
        at: now,
        participantIds: [npc.id],
        locationId: invitation.locationId,
      });
    }
    ctx.bus.emit('game:signal', {
      name: 'invitation_accepted',
      data: { invitationId: invitation.id, npcId: npc.id, activity: invitation.activity },
    });
    const place = locationName(ctx.content, invitation.locationId);
    return socialResult(
      true,
      together
        ? 'You spend ' + ACTIVITY_LABELS[invitation.activity] + ' with ' + npc.name + ' at ' + place + '.'
        : 'You agree to meet ' + npc.name + ' for ' + ACTIVITY_LABELS[invitation.activity] + ' at ' + place + '.',
      undefined,
      {
        invitationId: invitation.id,
        npcId: npc.id,
        activity: invitation.activity,
        together,
        affinityDelta: result.affinityDelta,
        trustDelta: result.trustDelta,
        intimacyDelta: result.intimacyDelta,
        status: result.relationship.status,
      }
    );
  }

  /** Player declines a pending invitation (small relationship cost). */
  declineInvitation(invitationId: string): ActionResult {
    const ctx = this.ctx;
    const state = ctx.state;
    const invitation = state.social.invitations.find((item) => item.id === invitationId);
    if (!invitation) return socialResult(false, 'That invitation no longer exists.', 'not_found');
    if (invitation.status !== 'pending') return socialResult(false, 'That invitation is already settled.', 'invalid');
    const npc = state.npcs[invitation.fromNpcId];
    invitation.status = 'declined';
    if (!npc) {
      return socialResult(true, 'You let the invitation lapse.');
    }
    const result = applyInteraction(
      ctx,
      npc,
      { affinity: -SOCIAL_CONFIG.declineAffinityPenalty, trust: -0.5, familiarity: 0.5 },
      'invite',
      'Declined ' + npc.name + "'s invitation to " + ACTIVITY_LABELS[invitation.activity] + '.'
    );
    recordMemory(ctx, npc, {
      type: 'invitation_declined_by_player',
      text: 'The cigarette turned down their invitation. It stings a little more than they admit.',
      importance: 30,
      emotionalValue: -3,
      permanent: false,
    });
    ctx.bus.emit('game:signal', {
      name: 'invitation_declined',
      data: { invitationId: invitation.id, npcId: npc.id },
    });
    return socialResult(
      true,
      'You let ' + npc.name + ' down gently. They nod and pretend it is fine.',
      undefined,
      {
        invitationId: invitation.id,
        npcId: npc.id,
        activity: invitation.activity,
        affinityDelta: result.affinityDelta,
        status: result.relationship.status,
      }
    );
  }

  /** Per-update maintenance: expire invitations and let friendly NPCs send some. */
  update(): void {
    const ctx = this.ctx;
    const now = ctx.clock.simTimeSeconds;
    this.initialise();
    this.expireInvitations(now);

    const tickSeconds = cooldownSeconds(SOCIAL_CONFIG.npcInviteTickHours);
    const maxTicks = SOCIAL_CONFIG.maxNpcInviteTicksPerUpdate;
    let ticks = 0;
    while (now - this.lastNpcInviteTickAt >= tickSeconds && ticks < maxTicks) {
      this.lastNpcInviteTickAt += tickSeconds;
      ticks += 1;
      // Evaluate each missed tick at its own point in time so invitations made
      // while the player was away are realistically expired by the time they return.
      this.expireInvitations(this.lastNpcInviteTickAt);
      this.tryNpcInvitation(this.lastNpcInviteTickAt);
    }
    if (now - this.lastNpcInviteTickAt >= tickSeconds) {
      // Huge offline gap: skip ahead instead of looping through months of ticks.
      this.lastNpcInviteTickAt = Math.floor(now / tickSeconds) * tickSeconds;
    }
    // Anything created or still pending during catch-up must respect "now".
    this.expireInvitations(now);
    this.trimStoredInvitations();
  }

  private expireInvitations(now: number): void {
    for (const invitation of this.ctx.state.social.invitations) {
      if (invitation.status === 'pending' && invitation.expiresAt <= now) {
        invitation.status = 'expired';
        const npc = this.ctx.state.npcs[invitation.fromNpcId];
        if (npc) {
          recordMemory(this.ctx, npc, {
            type: 'invitation_lapsed',
            text: 'The invitation to ' + ACTIVITY_LABELS[invitation.activity] + ' was never answered. They noticed.',
            importance: 16,
            emotionalValue: -2,
            permanent: false,
          });
        }
      }
    }
  }

  private trimStoredInvitations(): void {
    const invitations = this.ctx.state.social.invitations;
    if (invitations.length <= SOCIAL_CONFIG.maxStoredInvitations) return;
    const resolved = invitations.filter((item) => item.status !== 'pending');
    const pending = invitations.filter((item) => item.status === 'pending');
    const keepResolved = resolved.slice(Math.max(0, resolved.length - (SOCIAL_CONFIG.maxStoredInvitations - pending.length)));
    this.ctx.state.social.invitations = [...keepResolved, ...pending];
  }

  /** Pending invitations at a specific point in time (used by offline catch-up). */
  private pendingAt(at: number): InvitationState[] {
    return this.ctx.state.social.invitations.filter(
      (invitation) => invitation.status === 'pending' && invitation.expiresAt > at
    );
  }

  /** Determines whether a friendly NPC spontaneously invites the player this tick. */
  private tryNpcInvitation(at: number): void {
    const ctx = this.ctx;
    const state = ctx.state;
    const pending = this.pendingAt(at);
    if (pending.length >= SOCIAL_CONFIG.maxPendingInvitations) return;
    const pendingNpcIds = new Set(pending.map((invitation) => invitation.fromNpcId));

    interface Candidate {
      npc: NPCState;
      relScore: number;
      affinity: number;
    }
    const candidates: Candidate[] = [];
    for (const npcId of Object.keys(state.npcs)) {
      const npc = state.npcs[npcId];
      if (!npc || !npc.alive) continue;
      if (pendingNpcIds.has(npcId)) continue;
      const rel = state.player.relationships[npcId];
      if (!rel) continue;
      if (rel.affinity < 20 || rel.trust < 10) continue;
      if (isHostile(rel)) continue;
      candidates.push({ npc, relScore: relationshipScore(rel), affinity: rel.affinity });
    }
    if (candidates.length === 0) return;
    candidates.sort((a, b) => b.relScore - a.relScore || (a.npc.id < b.npc.id ? -1 : 1));
    const pool = candidates.slice(0, 6);
    for (const candidate of pool) {
      const affinityNorm = clamp01((candidate.affinity + 100) / 200);
      const chance = clampProbability(
        0.008 +
          affinityNorm * 0.05 +
          candidate.npc.personality.socialNeed * 0.03 +
          candidate.npc.personality.extroversion * 0.015,
        0.004,
        0.2
      );
      if (!ctx.probability.chance('social.interaction', chance)) continue;
      const activity = this.pickNpcInvitationActivity(candidate.npc);
      const locationId = this.resolveActivityLocation(activity, candidate.npc);
      const invitation = this.createInvitation(candidate.npc.id, activity, locationId, at);
      recordMemory(ctx, candidate.npc, {
        type: 'invitation_sent',
        text: 'They worked up the nerve to invite the cigarette to ' + ACTIVITY_LABELS[activity] + '.',
        importance: 25,
        emotionalValue: 3,
        permanent: false,
      });
      ctx.bus.emit('game:signal', {
        name: 'invitation',
        data: {
          invitationId: invitation.id,
          npcId: candidate.npc.id,
          npcName: candidate.npc.name,
          activity,
          locationId,
          locationName: locationName(ctx.content, locationId),
          expiresAt: invitation.expiresAt,
        },
      });
      return;
    }
  }

  /** Picks what an NPC would like to invite the player to (probability weighted). */
  private pickNpcInvitationActivity(npc: NPCState): InvitationActivity {
    const ctx = this.ctx;
    const rel = this.ctx.state.player.relationships[npc.id];
    const festival = this.getActiveFestival();
    const candidates: { weight: number; value: InvitationActivity }[] = [
      { weight: 3 + npc.personality.adventure * 3, value: 'walk' },
      { weight: 3 + npc.personality.extroversion * 2, value: 'coffee' },
      { weight: 2 + npc.personality.generosity, value: 'meal' },
    ];
    if (festival) candidates.push({ weight: 4, value: 'festival' });
    if (rel && (rel.status === 'dating' || rel.status === 'partner')) {
      candidates.push({ weight: 3 + npcEmotionalWellbeing(npc) * 2, value: 'date' });
    }
    if (npc.needs.workPressure > 40) candidates.push({ weight: 2, value: 'help' });
    const picked = ctx.probability.weighted('social.interaction', candidates);
    return picked ?? 'walk';
  }

  private createInvitation(
    npcId: NPCId,
    activity: InvitationActivity,
    locationId: LocationId,
    now: number
  ): InvitationState {
    const state = this.ctx.state;
    const invitation: InvitationState = {
      id: nextSequentialId('inv', state.social.invitations.map((item) => item.id)),
      fromNpcId: npcId,
      activity,
      locationId,
      proposedAt: now,
      expiresAt: now + cooldownSeconds(SOCIAL_CONFIG.invitationExpiryHours),
      status: 'pending',
    };
    state.social.invitations.push(invitation);
    return invitation;
  }

  /** First existing venue for an activity in the NPC's region, else the player's location. */
  resolveActivityLocation(activity: InvitationActivity, npc: NPCState): LocationId {
    const ctx = this.ctx;
    const npcRegion = ctx.content.getLocation(npc.homeLocationId)?.regionId ?? ctx.content.getLocation(npc.workLocationId)?.regionId;
    const venues = ACTIVITY_VENUES[activity];
    for (const venue of venues) {
      const def = ctx.content.getLocation(venue);
      if (!def) continue;
      if (npcRegion && def.regionId !== npcRegion) continue;
      return venue;
    }
    // Fall back to any venue matching the activity regardless of region.
    for (const venue of venues) {
      if (ctx.content.getLocation(venue)) return venue;
    }
    const festival = activity === 'festival' ? this.getActiveFestival() : null;
    if (festival) {
      const def = ctx.content.getFestival(festival.id);
      if (def) return def.locationId;
    }
    return ctx.state.player.position.locationId;
  }

  /** Currently active festival definition, if events system says one is running. */
  getActiveFestival(): { id: string; locationId: LocationId; name: string } | null {
    const state = this.ctx.state;
    const ids = Object.keys(state.eventSystem.festivals).sort((a, b) => (a < b ? -1 : 1));
    for (const id of ids) {
      const entry = state.eventSystem.festivals[id];
      if (!entry || entry.state !== 'active') continue;
      const def = this.ctx.content.getFestival(id);
      if (!def) continue;
      return { id, locationId: def.locationId, name: def.name };
    }
    return null;
  }

  /** Human-readable summary used by UI/tests. */
  describeInvitation(invitation: InvitationState): string {
    const state = this.ctx.state;
    const npc = state.npcs[invitation.fromNpcId];
    const name = npc ? npc.name : invitation.fromNpcId;
    const place = locationName(this.ctx.content, invitation.locationId);
    const hoursLeft = Math.max(0, (invitation.expiresAt - state.clock.simTimeSeconds) / 3600);
    return name + ' invites you to ' + ACTIVITY_LABELS[invitation.activity] + ' at ' + place + ' (' + formatGameHours(hoursLeft) + ' left)';
  }

}

/** Type guard used by SocialSystem to accept activity strings from UI. */
export function isInvitationActivity(value: string): value is InvitationActivity {
  return value === 'walk' || value === 'coffee' || value === 'meal' || value === 'date' || value === 'festival' || value === 'help';
}

