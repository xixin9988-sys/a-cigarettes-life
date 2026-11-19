import { describe, expect, it } from 'vitest';
import { NPC } from '../../src/data/npcs/ids';
import { ITEM } from '../../src/data/items/ids';
import { LOC } from '../../src/data/locations/ids';
import {
  advanceHours,
  createSocialHarness,
  requireNpc,
  eventsOf,
  givePlayerItem,
  placeAtPlayer,
  setRelationship,
} from './support/harness';

describe('talkTo', () => {
  it('rejects talking to an NPC who is somewhere else', () => {
    const h = createSocialHarness();
    const npc = placeAtPlayer(h, NPC.ottoBramwell);
    npc.locationId = LOC.bakery; // somewhere else entirely
    const result = h.social.talkTo(NPC.ottoBramwell);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong_location');
    expect(h.state.player.relationships[NPC.ottoBramwell]).toBeUndefined();
  });

  it('greets a new NPC: builds affinity/trust/familiarity, logs the meeting and awards social XP', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    const result = h.social.talkTo(NPC.marigoldLyle);
    expect(result.ok).toBe(true);
    const rel = h.social.getRelationship(NPC.marigoldLyle);
    expect(rel).toBeDefined();
    if (!rel) return;
    expect(rel.affinity).toBeGreaterThan(0);
    expect(rel.trust).toBeGreaterThan(0);
    expect(rel.familiarity).toBeGreaterThan(0);
    expect(rel.interactionCount).toBe(1);
    expect(h.state.player.statistics.conversations).toBe(1);
    expect(h.state.player.statistics.npcsMet).toBe(1);
    expect(h.state.player.skills.social.totalXp).toBeGreaterThan(0);
    expect(eventsOf(h, 'npc:met')).toHaveLength(1);
    const changes = eventsOf(h, 'relationship:changed') as { npcId: string; kind: string }[];
    expect(changes.some((change) => change.npcId === NPC.marigoldLyle && change.kind === 'greet')).toBe(true);
    const log = h.social.getInteractionLog(5);
    expect(log.length).toBe(1);
    expect(log[0]?.kind).toBe('greet');
    expect(log[0]?.affinityDelta).toBeGreaterThan(0);
  });

  it('enforces the 1 game hour chat cooldown and then allows another chat', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.sylviaReed);
    expect(h.social.talkTo(NPC.sylviaReed).ok).toBe(true);
    const blocked = h.social.talkTo(NPC.sylviaReed);
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('on_cooldown');
    expect(h.state.player.relationships[NPC.sylviaReed]?.interactionCount).toBe(1);
    advanceHours(h, 1.1);
    const again = h.social.talkTo(NPC.sylviaReed);
    expect(again.ok).toBe(true);
    expect(h.state.player.relationships[NPC.sylviaReed]?.interactionCount).toBe(2);
    expect(h.state.player.statistics.conversations).toBe(2);
    expect(h.state.player.statistics.npcsMet).toBe(1);
  });

  it('does not count a second NPC as a second meeting twice', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    placeAtPlayer(h, NPC.ottoBramwell);
    expect(h.social.talkTo(NPC.marigoldLyle).ok).toBe(true);
    expect(h.state.player.statistics.npcsMet).toBe(1);
    expect(h.social.talkTo(NPC.ottoBramwell).ok).toBe(true);
    expect(h.state.player.statistics.npcsMet).toBe(2);
  });

  it('extroverted, socially-needy NPCs warm up faster than reserved ones', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.ottoBramwell);
    placeAtPlayer(h, NPC.rufusMarsh);
    expect(h.social.talkTo(NPC.ottoBramwell).ok).toBe(true);
    expect(h.social.talkTo(NPC.rufusMarsh).ok).toBe(true);
    const otto = h.state.player.relationships[NPC.ottoBramwell];
    const rufus = h.state.player.relationships[NPC.rufusMarsh];
    expect(otto && rufus).toBeTruthy();
    if (!otto || !rufus) return;
    expect(otto.affinity).toBeGreaterThan(rufus.affinity);
  });

  it('is deterministic for the same seed and same action sequence', () => {
    const run = (): string => {
      const h = createSocialHarness({ seed: 987654 });
      placeAtPlayer(h, NPC.claraBright);
      h.social.talkTo(NPC.claraBright);
      advanceHours(h, 1.1);
      h.social.talkTo(NPC.claraBright);
      const rel = h.state.player.relationships[NPC.claraBright];
      return JSON.stringify({ rel, log: h.state.social.interactionLog });
    };
    expect(run()).toBe(run());
  });

  it('refuses small talk when the relationship is genuinely hostile', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.rufusMarsh);
    setRelationship(h, NPC.rufusMarsh, { affinity: -60, trust: 5, familiarity: 40, status: 'enemy' });
    const result = h.social.talkTo(NPC.rufusMarsh);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_allowed');
    expect(h.state.player.relationships[NPC.rufusMarsh]?.affinity).toBe(-60);
  });
});

describe('helpNPC', () => {
  it('builds trust and records the first favour', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.adaQuinn);
    setRelationship(h, NPC.adaQuinn, { affinity: 20, trust: 20, familiarity: 30, status: 'acquaintance' });
    const result = h.social.helpNPC(NPC.adaQuinn);
    expect(result.ok).toBe(true);
    const rel = h.state.player.relationships[NPC.adaQuinn];
    expect(rel?.trust).toBeGreaterThan(20);
    expect(rel?.flags).toContain('helped_before');
    expect(requireNpc(h, NPC.adaQuinn)?.memories.some((memory) => memory.type === 'social_help')).toBe(true);
  });

  it('enforces the help cooldown', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.adaQuinn);
    expect(h.social.helpNPC(NPC.adaQuinn).ok).toBe(true);
    const second = h.social.helpNPC(NPC.adaQuinn);
    expect(second.ok).toBe(false);
    expect(second.code).toBe('on_cooldown');
  });

  it('sometimes earns a small token of thanks (across seeds at least one repayment happens)', () => {
    let repaid = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const h = createSocialHarness({ seed });
      placeAtPlayer(h, NPC.ottoBramwell);
      setRelationship(h, NPC.ottoBramwell, { affinity: 60, trust: 60, familiarity: 60, status: 'friend' });
      const before = h.state.player.inventory.length;
      h.social.helpNPC(NPC.ottoBramwell);
      const after = h.state.player.inventory.length;
      if (after > before) repaid += 1;
    }
    expect(repaid).toBeGreaterThan(0);
  });

  it('is deterministic: same seed and state -> same repayment outcome', () => {
    const run = (): boolean => {
      const h = createSocialHarness({ seed: 777 });
      placeAtPlayer(h, NPC.ottoBramwell);
      setRelationship(h, NPC.ottoBramwell, { affinity: 60, trust: 60, familiarity: 60, status: 'friend' });
      const before = h.state.player.inventory.length;
      h.social.helpNPC(NPC.ottoBramwell);
      return h.state.player.inventory.length > before;
    };
    expect(run()).toBe(run());
  });
});

describe('apologiseTo', () => {
  it('refuses when there is no grievance to apologise for', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.haroldBagg);
    setRelationship(h, NPC.haroldBagg, { affinity: 40, trust: 60, familiarity: 50, status: 'friend' });
    const result = h.social.apologiseTo(NPC.haroldBagg);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_allowed');
  });

  it('can repair a damaged relationship, set a cooldown, and leave a memory', () => {
    let repaired = 0;
    for (let seed = 1; seed <= 20 && repaired === 0; seed += 1) {
      const h = createSocialHarness({ seed });
      placeAtPlayer(h, NPC.sylviaReed);
      setRelationship(h, NPC.sylviaReed, { affinity: -40, trust: 10, familiarity: 40, status: 'rival' });
      const result = h.social.apologiseTo(NPC.sylviaReed);
      if (!result.ok) continue;
      repaired += 1;
      const rel = h.state.player.relationships[NPC.sylviaReed];
      expect(rel?.affinity).toBeGreaterThan(-40);
      expect(rel?.trust).toBeGreaterThan(10);
      expect(rel?.flags).toContain('apologised');
      expect(rel?.cooldowns['apologise']).toBeGreaterThan(h.clock.simTimeSeconds);
      expect(requireNpc(h, NPC.sylviaReed)?.memories.some((memory) => memory.type === 'social_apology')).toBe(true);
    }
    expect(repaired).toBeGreaterThan(0);
  });

  it('a failed apology still costs the cooldown and leaves a trace', () => {
    let failed = 0;
    for (let seed = 1; seed <= 30 && failed === 0; seed += 1) {
      const h = createSocialHarness({ seed });
      placeAtPlayer(h, NPC.rufusMarsh);
      setRelationship(h, NPC.rufusMarsh, { affinity: -80, trust: 5, familiarity: 20, status: 'enemy' });
      const result = h.social.apologiseTo(NPC.rufusMarsh);
      if (result.ok) continue;
      failed += 1;
      const rel = h.state.player.relationships[NPC.rufusMarsh];
      expect(rel?.cooldowns['apologise']).toBeGreaterThan(h.clock.simTimeSeconds);
      expect(requireNpc(h, NPC.rufusMarsh)?.memories.some((memory) => memory.type === 'social_apology_failed')).toBe(true);
    }
    expect(failed).toBeGreaterThan(0);
  });
});

describe('known NPCs', () => {
  it('lists only NPCs the player has actually met', () => {
    const h = createSocialHarness();
    expect(h.social.getKnownNPCs()).toHaveLength(0);
    placeAtPlayer(h, NPC.theoGrey);
    h.social.talkTo(NPC.theoGrey);
    const known = h.social.getKnownNPCs();
    expect(known).toHaveLength(1);
    expect(known[0]?.id).toBe(NPC.theoGrey);
  });

  it('exposes a summary snapshot for the social panel', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    h.social.talkTo(NPC.marigoldLyle);
    const summary = h.social.getSocialSummary();
    expect(summary.known).toBe(1);
    expect(summary.pendingInvitations).toBe(0);
    expect(summary.completedProjects).toBe(0);
    expect(Array.isArray(summary.romances)).toBe(true);
  });
});

describe('available interactions inventory', () => {
  it('does not depend on inventory items being present for chatting', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.elizaThorne);
    expect(h.state.player.inventory.length).toBeGreaterThan(0); // starter kit
    expect(h.social.talkTo(NPC.elizaThorne).ok).toBe(true);
    expect(givePlayerItem(h, ITEM.breadLoaf)).toBeTruthy();
  });
});
