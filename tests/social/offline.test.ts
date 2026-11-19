import { describe, expect, it } from 'vitest';
import { NPC } from '../../src/data/npcs/ids';
import { LOC } from '../../src/data/locations/ids';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import { addSocialHistory } from '../../src/social/SocialHistory';
import { recordMemory } from '../../src/social/RelationshipOps';
import { SOCIAL_CONFIG } from '../../src/social/config';
import {
  advance,
  advanceDays,
  advanceHours,
  createSocialHarness,
  requireNpc,
  placeAtPlayer,
  placeAllMajorsAtPlayer,
  setRelationship,
  socialSnapshot,
} from './support/harness';
import type { SocialHarness } from './support/harness';

function friendlyTown(h: SocialHarness, affinity = 70): void {
  placeAllMajorsAtPlayer(h);
  for (const npcId of Object.keys(h.state.npcs)) {
    const npc = h.state.npcs[npcId];
    if (!npc) continue;
    setRelationship(h, npcId, { affinity, trust: 60, intimacy: 15, familiarity: 55, status: 'friend' });
  }
}

function richHarness(seed: number): SocialHarness {
  const h = createSocialHarness({ seed, playerMoney: 100000, weather: 'rain', hour: 21 });
  friendlyTown(h);
  h.state.player.influence = 40;
  placeAtPlayer(h, NPC.marigoldLyle);
  setRelationship(h, NPC.marigoldLyle, {
    affinity: 80,
    trust: 70,
    intimacy: 60,
    familiarity: 80,
    status: 'dating',
    interactionCount: 20,
    lastInteractionAt: h.clock.simTimeSeconds - 40 * 24 * 60,
  });
  const now = h.clock.simTimeSeconds;
  h.state.social.invitations.push({
    id: 'inv_offline_pending',
    fromNpcId: NPC.sylviaReed,
    activity: 'coffee',
    locationId: LOC.cafe,
    proposedAt: now,
    expiresAt: now + 24 * 60,
    status: 'pending',
  });
  expect(h.social.proposeCommunityProject('proposal_tree_planting').ok).toBe(true);
  return h;
}

describe('large offline catch-up', () => {
  it('resolves months of social time in one update without hanging', () => {
    const h = richHarness(1234321);
    const started = Date.now();
    advanceDays(h, 30);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(2000);
    // Invitations expired.
    expect(h.social.getInvitations().length).toBeLessThanOrEqual(SOCIAL_CONFIG.maxPendingInvitations);
    expect(h.state.social.invitations.filter((invitation) => invitation.status === 'pending')).toHaveLength(0);
    // Community project resolved (approved and built, or rejected).
    const project = h.social.getCommunityProjects()[0];
    expect(project).toBeDefined();
    if (project) {
      expect(['complete', 'rejected']).toContain(project.status);
    }
    // Neglected romance ended with an ex status and a memory.
    expect(h.state.player.relationships[NPC.marigoldLyle]?.status).toBe('ex');
    expect(requireNpc(h, NPC.marigoldLyle).memories.some((memory) => memory.type === 'romance_breakup')).toBe(true);
    // Bounded logs/history.
    expect(h.state.social.interactionLog.length).toBeLessThanOrEqual(SOCIAL_CONFIG.maxInteractionLog);
    expect(h.state.world.history.length).toBeLessThanOrEqual(WORLD_CONFIG.simulation.maxHistoryEntries);
  });

  it('does not generate an unbounded pile of NPC invitations across a long absence', () => {
    const h = richHarness(777001);
    advanceDays(h, 60);
    expect(h.state.social.invitations.filter((invitation) => invitation.status === 'pending').length).toBeLessThanOrEqual(
      SOCIAL_CONFIG.maxPendingInvitations
    );
    // Resolved invitations are trimmed so saves cannot grow without bound.
    expect(h.state.social.invitations.length).toBeLessThanOrEqual(SOCIAL_CONFIG.maxStoredInvitations);
  });

  it('is deterministic: identical seeds and setups produce identical social state', () => {
    const first = richHarness(20260101);
    advanceDays(first, 10);
    const second = richHarness(20260101);
    advanceDays(second, 10);
    expect(socialSnapshot(first)).toBe(socialSnapshot(second));
  });

  it('a zero-delta update does not change state', () => {
    const h = richHarness(31415);
    advanceDays(h, 3);
    const before = socialSnapshot(h);
    h.registry.updateAll(0);
    expect(socialSnapshot(h)).toBe(before);
  });

  it('many small updates and one large jump both fully resolve the community project', () => {
    const fast = richHarness(4242);
    advanceDays(fast, 12);
    const slow = richHarness(4242);
    for (let i = 0; i < 12 * 24; i += 1) advanceHours(slow, 1);
    const fastProject = fast.social.getCommunityProjects()[0];
    const slowProject = slow.social.getCommunityProjects()[0];
    expect(fastProject).toBeDefined();
    expect(slowProject).toBeDefined();
    if (!fastProject || !slowProject) return;
    // Vote entitlement is time-based, so the number of ballots cast matches even
    // though the per-ballot random draws differ with update cadence.
    expect(fastProject.votesFor + fastProject.votesAgainst).toBe(
      slowProject.votesFor + slowProject.votesAgainst
    );
    expect(['complete', 'rejected']).toContain(fastProject.status);
    expect(['complete', 'rejected']).toContain(slowProject.status);
  });
});

describe('state caps and bookkeeping', () => {
  it('caps the interaction log', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.sylviaReed);
    for (let i = 0; i < SOCIAL_CONFIG.maxInteractionLog + 20; i += 1) {
      h.social.talkTo(NPC.sylviaReed);
      advanceHours(h, 1.01);
    }
    expect(h.state.social.interactionLog.length).toBeLessThanOrEqual(SOCIAL_CONFIG.maxInteractionLog);
    expect(h.state.player.statistics.conversations).toBeGreaterThan(0);
  });

  it('caps NPC memories while preserving permanent ones', () => {
    const h = createSocialHarness();
    const npc = placeAtPlayer(h, NPC.marigoldLyle);
    for (let i = 0; i < 5; i += 1) {
      recordMemory(h.ctx, npc, {
        type: 'permanent_test',
        text: 'a permanent memory ' + String(i),
        importance: 90,
        emotionalValue: 4,
        permanent: true,
      });
    }
    for (let i = 0; i < 90; i += 1) {
      recordMemory(h.ctx, npc, {
        type: 'small_test',
        text: 'a trivial memory ' + String(i),
        importance: 2,
        emotionalValue: 0,
      });
    }
    expect(npc.memories.length).toBeLessThanOrEqual(SOCIAL_CONFIG.maxMemoriesPerNpc);
    const permanent = npc.memories.filter((memory) => memory.permanent);
    expect(permanent.length).toBe(5);
  });

  it('caps world history through the shared addSocialHistory helper', () => {
    const h = createSocialHarness();
    for (let i = 0; i < WORLD_CONFIG.simulation.maxHistoryEntries + 60; i += 1) {
      addSocialHistory(h.state, {
        category: 'player',
        description: 'social history entry ' + String(i),
        importance: 1,
      });
    }
    expect(h.state.world.history.length).toBeLessThanOrEqual(WORLD_CONFIG.simulation.maxHistoryEntries);
  });
});
