import { describe, expect, it } from 'vitest';
import { NPC } from '../../src/data/npcs/ids';
import { RESIDENT_NPC_IDS } from '../../src/data/npcs/ids';
import { LOC } from '../../src/data/locations/ids';
import type { InvitationState } from '../../src/core/contracts';
import {
  advanceDays,
  advanceHours,
  createSocialHarness,
  requireNpc,
  eventsOf,
  placeAllMajorsAtPlayer,
  placeAtPlayer,
  setRelationship,
} from './support/harness';
import type { SocialHarness } from './support/harness';

function fabricateInvitation(
  h: SocialHarness,
  npcId: string,
  activity: InvitationState['activity'] = 'coffee',
  locationId: string = LOC.cafe
): InvitationState {
  const now = h.clock.simTimeSeconds;
  const invitation: InvitationState = {
    id: 'inv_test_' + String(h.state.social.invitations.length),
    fromNpcId: npcId,
    activity,
    locationId,
    proposedAt: now,
    expiresAt: now + 24 * 60,
    status: 'pending',
  };
  h.state.social.invitations.push(invitation);
  return invitation;
}

function friendly(h: SocialHarness, npcId: string, affinity = 60): void {
  setRelationship(h, npcId, { affinity, trust: 50, intimacy: 20, familiarity: 60, status: 'friend' });
}

describe('inviteNPC', () => {
  it('requires the NPC to be present', () => {
    const h = createSocialHarness();
    const result = h.social.inviteNPC(NPC.sylviaReed, 'coffee');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong_location');
  });

  it('creates a pending invitation when the NPC accepts (24h expiry, venue, signal)', () => {
    let accepted = false;
    for (let seed = 1; seed <= 30 && !accepted; seed += 1) {
      const h = createSocialHarness({ seed });
      placeAtPlayer(h, NPC.sylviaReed);
      friendly(h, NPC.sylviaReed);
      const result = h.social.inviteNPC(NPC.sylviaReed, 'coffee');
      if (!result.ok) continue;
      accepted = true;
      const pending = h.social.getInvitations();
      expect(pending).toHaveLength(1);
      const invitation = pending[0];
      expect(invitation?.fromNpcId).toBe(NPC.sylviaReed);
      expect(invitation?.activity).toBe('coffee');
      expect(invitation?.status).toBe('pending');
      expect(invitation?.expiresAt).toBe((invitation?.proposedAt ?? 0) + 24 * 60);
      expect(h.content.getLocation(invitation?.locationId ?? '')).toBeDefined();
      const rel = h.state.player.relationships[NPC.sylviaReed];
      expect(rel?.cooldowns['invite']).toBeGreaterThan(h.clock.simTimeSeconds);
      expect(eventsOf(h, 'game:signal').some((payload) => JSON.stringify(payload).includes('invitation_offered'))).toBe(true);
      expect(h.state.player.skills.social.totalXp).toBeGreaterThan(0);
    }
    expect(accepted).toBe(true);
  });

  it('applies a distinct shorter cooldown when the NPC declines', () => {
    let declined = false;
    for (let seed = 1; seed <= 40 && !declined; seed += 1) {
      const h = createSocialHarness({ seed });
      placeAtPlayer(h, NPC.haroldBagg);
      friendly(h, NPC.haroldBagg, 25);
      const result = h.social.inviteNPC(NPC.haroldBagg, 'walk');
      if (result.ok) continue;
      declined = true;
      expect(result.code).toBe('busy');
      expect(h.social.getInvitations()).toHaveLength(0);
      const rel = h.state.player.relationships[NPC.haroldBagg];
      expect(rel?.cooldowns['invite']).toBeGreaterThan(h.clock.simTimeSeconds);
      expect(rel?.cooldowns['invite']).toBeLessThan(h.clock.simTimeSeconds + 20 * 60);
      expect(requireNpc(h, NPC.haroldBagg).memories.some((memory) => memory.type === 'invitation_declined')).toBe(true);
    }
    expect(declined).toBe(true);
  });

  it('refuses a date invitation unless the two are sweethearts', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.theoGrey);
    friendly(h, NPC.theoGrey);
    const result = h.social.inviteNPC(NPC.theoGrey, 'date');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_allowed');
  });

  it('rejects an invalid activity string', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.theoGrey);
    const result = h.social.inviteNPC(NPC.theoGrey, 'skydiving' as never);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid');
  });

  it('respects the max pending invitation cap', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.sylviaReed);
    placeAtPlayer(h, NPC.theoGrey);
    placeAtPlayer(h, NPC.marigoldLyle);
    friendly(h, NPC.sylviaReed);
    friendly(h, NPC.theoGrey);
    friendly(h, NPC.marigoldLyle);
    fabricateInvitation(h, NPC.ottoBramwell);
    fabricateInvitation(h, NPC.haroldBagg);
    fabricateInvitation(h, NPC.adaQuinn);
    const result = h.social.inviteNPC(NPC.sylviaReed, 'coffee');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('capacity_reached');
  });

  it('supports festival invitations only while a festival is active', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.sylviaReed);
    friendly(h, NPC.sylviaReed);
    const inactive = h.social.inviteNPC(NPC.sylviaReed, 'festival');
    expect(inactive.ok).toBe(false);
    expect(inactive.code).toBe('wrong_time');

    const festivalId = 'festival_spring_flower';
    const entry = h.state.eventSystem.festivals[festivalId];
    expect(entry).toBeDefined();
    if (entry) entry.state = 'active';

    let accepted = false;
    for (let seed = 1; seed <= 30 && !accepted; seed += 1) {
      h.probability.init(seed);
      const result = h.social.inviteNPC(NPC.sylviaReed, 'festival');
      if (!result.ok) continue;
      accepted = true;
      expect(h.social.getInvitations()[0]?.locationId).toBe(LOC.plaza);
    }
    expect(accepted).toBe(true);
  });
});

describe('accept / decline invitation lifecycle', () => {
  it('accepting grants relationship, a memory and the accepted status', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.sylviaReed);
    const invitation = fabricateInvitation(h, NPC.sylviaReed, 'meal', LOC.cafe);
    const result = h.social.acceptInvitation(invitation.id);
    expect(result.ok).toBe(true);
    expect(invitation.status).toBe('accepted');
    const rel = h.state.player.relationships[NPC.sylviaReed];
    expect(rel?.affinity).toBeGreaterThan(0);
    expect(rel?.intimacy).toBeGreaterThan(0);
    expect(requireNpc(h, NPC.sylviaReed).memories.some((memory) => memory.type === 'invitation_fulfilled')).toBe(true);
    expect(eventsOf(h, 'game:signal').some((payload) => JSON.stringify(payload).includes('invitation_accepted'))).toBe(true);
    expect(h.social.acceptInvitation(invitation.id).ok).toBe(false);
    expect(h.social.getInvitations()).toHaveLength(0);
  });

  it('declining costs a little affection and records it', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.sylviaReed);
    friendly(h, NPC.sylviaReed);
    const invitation = fabricateInvitation(h, NPC.sylviaReed, 'walk', LOC.park);
    const before = h.state.player.relationships[NPC.sylviaReed]?.affinity ?? 0;
    const result = h.social.declineInvitation(invitation.id);
    expect(result.ok).toBe(true);
    expect(invitation.status).toBe('declined');
    expect(h.state.player.relationships[NPC.sylviaReed]?.affinity).toBeLessThan(before);
    expect(requireNpc(h, NPC.sylviaReed).memories.some((memory) => memory.type === 'invitation_declined_by_player')).toBe(true);
  });

  it('cannot accept an expired invitation', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.sylviaReed);
    const invitation = fabricateInvitation(h, NPC.sylviaReed);
    advanceDays(h, 2);
    const result = h.social.acceptInvitation(invitation.id);
    expect(result.ok).toBe(false);
    expect(invitation.status).toBe('expired');
  });

  it('expires invitations automatically during updates', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.sylviaReed);
    const invitation = fabricateInvitation(h, NPC.sylviaReed);
    expect(h.social.getInvitations()).toHaveLength(1);
    advanceHours(h, 25);
    expect(h.social.getInvitations()).toHaveLength(0);
    expect(invitation.status).toBe('expired');
    expect(requireNpc(h, NPC.sylviaReed).memories.some((memory) => memory.type === 'invitation_lapsed')).toBe(true);
  });

  it('reports unknown invitations cleanly', () => {
    const h = createSocialHarness();
    expect(h.social.acceptInvitation('inv_missing').ok).toBe(false);
    expect(h.social.declineInvitation('inv_missing').ok).toBe(false);
  });
});

describe('NPC-initiated invitations', () => {
  it('friendly NPCs eventually invite the player, emit game:signal and respect the cap', () => {
    const h = createSocialHarness({ seed: 909090 });
    placeAllMajorsAtPlayer(h);
    for (const npcId of Object.keys(h.state.npcs)) {
      const npc = h.state.npcs[npcId];
      if (npc) friendly(h, npcId, 70);
    }
    let invites = 0;
    for (let tick = 0; tick < 40 && invites === 0; tick += 1) {
      advanceHours(h, 2);
      invites = h.social.getInvitations().length;
      expect(invites).toBeLessThanOrEqual(3);
    }
    expect(invites).toBeGreaterThan(0);
    const signal = eventsOf(h, 'game:signal').filter((payload) => JSON.stringify(payload).includes('"name":"invitation"'));
    expect(signal.length).toBeGreaterThan(0);
    const pending = h.social.getInvitations();
    for (const invitation of pending) {
      expect(invitation.status).toBe('pending');
      expect(h.state.player.relationships[invitation.fromNpcId]).toBeDefined();
      expect(h.content.getLocation(invitation.locationId)).toBeDefined();
    }
    const describe = h.social.getInvitationSystem().describeInvitation(pending[0] as InvitationState);
    expect(describe.length).toBeGreaterThan(10);
  });

  it('does not spontaneously invite when nobody is friendly yet', () => {
    const h = createSocialHarness({ seed: 5 });
    placeAllMajorsAtPlayer(h);
    advanceHours(h, 60);
    expect(h.social.getInvitations()).toHaveLength(0);
  });

  it('includes residents in the NPC invitation pool when they are friendly', () => {
    const h = createSocialHarness({ seed: 31337 });
    const residentId = RESIDENT_NPC_IDS[0] ?? '';
    friendly(h, residentId, 80);
    let invites = 0;
    for (let tick = 0; tick < 120 && invites === 0; tick += 1) {
      advanceHours(h, 2);
      invites = h.social.getInvitations().length;
    }
    expect(invites).toBeGreaterThan(0);
    expect(h.social.getInvitations().some((invitation) => invitation.fromNpcId === residentId)).toBe(true);
  });
});
