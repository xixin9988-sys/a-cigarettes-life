// =============================================================================
// SocialSimulation tests: NPCs form friendships, rivalries and romances without
// the player, write memories and life history, keep the social log capped and
// remain fully deterministic.
// =============================================================================
import { describe, expect, it } from 'vitest';
import { NPC } from '../../src/data/npcs/ids';
import { LOC } from '../../src/data/locations/ids';
import { createRelationship } from '../../src/core/RelationshipUtil';
import { SIM_SECONDS_PER_GAME_DAY, SIM_SECONDS_PER_GAME_MINUTE } from '../../src/npc/NPC';
import { createNpcHarness, type NpcHarness } from './support/harness';

function countFriendPairs(harness: NpcHarness): number {
  let count = 0;
  const npcs = Object.values(harness.state.npcs);
  for (const npc of npcs) {
    for (const [otherId, relationship] of Object.entries(npc.relationships)) {
      if (npc.id >= otherId) continue;
      if (
        relationship.status === 'friend' ||
        relationship.status === 'close_friend' ||
        relationship.status === 'dating' ||
        relationship.status === 'partner' ||
        relationship.status === 'family'
      ) {
        count += 1;
      }
    }
  }
  return count;
}

describe('SocialSimulation (NPC-NPC autonomous life)', () => {
  it('grows NPC friendships over simulated days without the player', () => {
    const harness = createNpcHarness({ seed: 910001 });
    const before = countFriendPairs(harness);
    harness.advanceGameDays(10, 0.5);
    const after = countFriendPairs(harness);
    expect(after).toBeGreaterThan(before);
    expect(harness.state.social.npcSocialLog.length).toBeGreaterThan(20);
    // The log is capped and contains well-formed entries.
    expect(harness.state.social.npcSocialLog.length).toBeLessThanOrEqual(200);
    for (const entry of harness.state.social.npcSocialLog) {
      expect(harness.state.npcs[entry.npcA]).toBeDefined();
      expect(harness.state.npcs[entry.npcB]).toBeDefined();
      expect(entry.npcA).not.toBe(entry.npcB);
      expect(entry.kind.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(10);
    }
  });

  it('lets two compatible NPCs fall in love through repeated encounters', () => {
    const harness = createNpcHarness({ seed: 920002 });
    const a = harness.npc('resident_01');
    const b = harness.npc('resident_13');
    expect(harness.content.getNPC(a.id)?.romanceable).toBe(true);
    expect(harness.content.getNPC(b.id)?.romanceable).toBe(true);
    a.locationId = LOC.park;
    b.locationId = LOC.park;
    a.currentActivity = 'relax';
    b.currentActivity = 'relax';
    let status = 'acquaintance';
    let encounters = 0;
    for (let index = 0; index < 240; index += 1) {
      harness.clock.advanceSimSeconds(30 * SIM_SECONDS_PER_GAME_MINUTE);
      const now = harness.clock.simTimeSeconds;
      harness.system.socialSimulation.simulatePair(harness.ctx, a, b, now);
      encounters += 1;
      const rel = a.relationships[b.id];
      if (rel?.status === 'dating' || rel?.status === 'partner') {
        status = rel.status;
        break;
      }
    }
    expect(encounters).toBeLessThanOrEqual(240);
    expect(status).toBe('dating');
    const relA = a.relationships[b.id];
    const relB = b.relationships[a.id];
    expect(relB?.status).toBe('dating');
    expect(relA?.affinity).toBeGreaterThan(30);
    expect(relA?.trust).toBeGreaterThanOrEqual(20);
    const romanceHistory = a.lifeHistory.filter((entry) => entry.type === 'romance');
    expect(romanceHistory.length).toBeGreaterThanOrEqual(1);
    expect(a.memories.some((memory) => memory.participantIds.includes(b.id))).toBe(true);
    expect(b.memories.some((memory) => memory.participantIds.includes(a.id))).toBe(true);
    expect(harness.state.social.npcSocialLog.length).toBeGreaterThanOrEqual(1);
  });

  it('lets long-running conflict turn friends into rivals', () => {
    const harness = createNpcHarness({ seed: 930003 });
    const a = harness.npc(NPC.marigoldLyle);
    const b = harness.npc(NPC.sylviaReed);
    // Push them into a bitter argument loop.
    for (let index = 0; index < 40; index += 1) {
      harness.clock.advanceSimSeconds(30 * SIM_SECONDS_PER_GAME_MINUTE);
      harness.system.socialSimulation.simulatePair(
        harness.ctx,
        a,
        b,
        harness.clock.simTimeSeconds,
        'argument'
      );
    }
    const rel = a.relationships[b.id];
    expect(rel).toBeDefined();
    expect(rel?.affinity).toBeLessThanOrEqual(-25);
    expect(rel?.status === 'rival' || rel?.status === 'enemy').toBe(true);
    expect(a.lifeHistory.some((entry) => entry.type === 'rivalry')).toBe(true);
    expect(
      harness.state.social.npcSocialLog.some((entry) => entry.kind === 'argument')
    ).toBe(true);
  });

  it('breaks up couples whose relationship has soured', () => {
    const harness = createNpcHarness({ seed: 940004 });
    const a = harness.npc('resident_03');
    const b = harness.npc('resident_17');
    // Seeded couple from INITIAL_COUPLES.
    expect(a.relationships[b.id]?.status).toBe('dating');
    for (let index = 0; index < 80; index += 1) {
      harness.clock.advanceSimSeconds(30 * SIM_SECONDS_PER_GAME_MINUTE);
      harness.system.socialSimulation.simulatePair(
        harness.ctx,
        a,
        b,
        harness.clock.simTimeSeconds,
        'argument'
      );
      if (a.relationships[b.id]?.status === 'ex') break;
    }
    expect(a.relationships[b.id]?.status).toBe('ex');
    expect(b.relationships[a.id]?.status).toBe('ex');
    expect(a.lifeHistory.some((entry) => entry.type === 'breakup')).toBe(true);
  });

  it('is deterministic for the same seed', () => {
    const run = (): string => {
      const harness = createNpcHarness({ seed: 950005 });
      harness.advanceGameDays(3, 0.5);
      const relevant = Object.values(harness.state.npcs)
        .sort((left, right) => (left.id < right.id ? -1 : 1))
        .map((npc) => ({
          id: npc.id,
          memories: npc.memories.map((memory) => memory.id),
          relationships: Object.fromEntries(
            Object.entries(npc.relationships).map(([otherId, rel]) => [
              otherId,
              { affinity: Math.round(rel.affinity * 100) / 100, status: rel.status },
            ])
          ),
        }));
      return JSON.stringify({ relevant, log: harness.state.social.npcSocialLog.length });
    };
    expect(run()).toBe(run());
  });

  it('mirrors player relationships onto the NPC and decays neglected ones', () => {
    const harness = createNpcHarness({ seed: 960006 });
    const npc = harness.npc(NPC.theoGrey);
    const playerRel = createRelationship(npc.id, harness.clock.simTimeSeconds, 'friend');
    playerRel.affinity = 48;
    playerRel.trust = 40;
    playerRel.intimacy = 22;
    playerRel.familiarity = 70;
    playerRel.interactionCount = 5;
    harness.state.player.relationships[npc.id] = playerRel;
    harness.advanceGameHours(2, 1);
    const mirrored = npc.relationships[harness.state.player.id];
    expect(mirrored).toBeDefined();
    expect(mirrored?.affinity).toBe(48);
    expect(mirrored?.status).toBe('friend');

    // Simulate long neglect then advance enough days to trigger drift.
    playerRel.lastInteractionAt = harness.clock.simTimeSeconds - 20 * SIM_SECONDS_PER_GAME_DAY;
    const familiarityBefore = playerRel.familiarity;
    harness.advanceGameDays(2, 2);
    expect(playerRel.familiarity).toBeLessThan(familiarityBefore);
    expect(mirrored?.familiarity).toBeLessThan(70);
  });

  it('lets neglected NPC-NPC relationships drift apart', () => {
    const harness = createNpcHarness({ seed: 961106 });
    const a = harness.npc(NPC.haroldBagg);
    const b = harness.npc(NPC.elizaThorne);
    // Force an old, strong friendship that nobody maintains.
    const relA = a.relationships[b.id];
    const relB = b.relationships[a.id];
    expect(relA).toBeDefined();
    expect(relB).toBeDefined();
    if (!relA || !relB) return;
    const now = harness.clock.simTimeSeconds;
    relA.affinity = 45;
    relA.familiarity = 80;
    relA.lastInteractionAt = now - 20 * SIM_SECONDS_PER_GAME_DAY;
    relB.affinity = 45;
    relB.familiarity = 80;
    relB.lastInteractionAt = now - 20 * SIM_SECONDS_PER_GAME_DAY;
    // Exercise the drift pass directly so the live social simulation cannot
    // freshen the bond between the two measurements.
    const later = now + 3 * SIM_SECONDS_PER_GAME_DAY;
    const changed = harness.system.relationshipSystem.decayNpcRelationships(a, later);
    const changedOther = harness.system.relationshipSystem.decayNpcRelationships(b, later);
    expect(changed.length + changedOther.length).toBeGreaterThan(0);
    expect(relA.familiarity).toBeLessThan(80);
    expect(relA.affinity).toBeLessThan(45);
    expect(relB.familiarity).toBeLessThan(80);
    expect(relB.affinity).toBeLessThan(45);
  });

  it('notifies the bus about meaningful relationship changes', () => {
    const harness = createNpcHarness({ seed: 970007 });
    const events: { npcId: string; kind: string; status: string }[] = [];
    harness.bus.on('relationship:changed', (payload) =>
      events.push({ npcId: payload.npcId, kind: payload.kind, status: payload.status })
    );
    harness.advanceGameDays(2, 0.5);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.kind === 'npc_npc' || event.kind === 'decay').toBe(true);
      expect(harness.state.npcs[event.npcId]).toBeDefined();
    }
  });

  it('records NPC memories with participant ids and permanent romances', () => {
    const harness = createNpcHarness({ seed: 980008 });
    const a = harness.npc('resident_01');
    const b = harness.npc('resident_13');
    a.locationId = LOC.cafe;
    b.locationId = LOC.cafe;
    for (let index = 0; index < 60; index += 1) {
      harness.clock.advanceSimSeconds(60 * SIM_SECONDS_PER_GAME_MINUTE);
      harness.system.socialSimulation.simulatePair(harness.ctx, a, b, harness.clock.simTimeSeconds);
    }
    const romanceMemory = a.memories.find((memory) => memory.permanent);
    if (a.relationships[b.id]?.status === 'dating') {
      expect(romanceMemory).toBeDefined();
    }
    expect(a.memories.length).toBeLessThanOrEqual(60);
    expect(b.memories.length).toBeLessThanOrEqual(60);
    const logEntries = harness.state.social.npcSocialLog.filter(
      (entry) => entry.npcA === a.id || entry.npcB === a.id
    );
    expect(logEntries.length).toBeGreaterThan(0);
  });
});
