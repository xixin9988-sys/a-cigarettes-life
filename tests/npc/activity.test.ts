// =============================================================================
// NPCSystem behaviour tests: autonomous activity changes, bus events, decision
// debug records, activity variety and query API.
// =============================================================================
import { describe, expect, it } from 'vitest';
import { NPC } from '../../src/data/npcs/ids';
import { LOC } from '../../src/data/locations/ids';
import type { GameEventMap } from '../../src/core/contracts';
import { createNpcHarness } from './support/harness';

describe('NPCSystem autonomous activity', () => {
  it('changes activities across a simulated day and emits npc:activity events', () => {
    const harness = createNpcHarness({ seed: 330011 });
    const events: GameEventMap['npc:activity'][] = [];
    harness.bus.on('npc:activity', (payload) => events.push(payload));
    harness.advanceGameDays(2, 0.5);
    expect(events.length).toBeGreaterThan(20);
    for (const event of events) {
      expect(harness.state.npcs[event.npcId]).toBeDefined();
      expect(event.activity.length).toBeGreaterThan(0);
      expect(harness.content.getLocation(event.locationId)).toBeDefined();
    }
    // Every major NPC lived through several different activities.
    for (const npc of harness.majorNpcs()) {
      const seen = new Set<string>([npc.currentActivity]);
      for (const event of events) if (event.npcId === npc.id) seen.add(event.activity);
      expect(seen.size, npc.id).toBeGreaterThanOrEqual(3);
      expect(npc.activityHistory.length, npc.id).toBeGreaterThan(0);
      expect(npc.activityHistory.length, npc.id).toBeLessThanOrEqual(8);
      expect(npc.locationId, npc.id).toMatch(/willowbrook_|ashford_/);
      expect(npc.activityEndsAt, npc.id).toBeGreaterThanOrEqual(npc.activityStartedAt);
      expect(npc.decisionCooldownUntil, npc.id).toBeGreaterThanOrEqual(npc.activityStartedAt);
    }
    const distinctActivities = new Set(events.map((event) => event.activity));
    expect(distinctActivities.size).toBeGreaterThanOrEqual(6);
  });

  it('never leaves an NPC frozen on one activity for a whole simulated day', () => {
    const harness = createNpcHarness({ seed: 445566 });
    const changes = new Map<string, number>();
    for (const npc of harness.majorNpcs()) changes.set(npc.id, 0);
    const lastActivity = new Map<string, string>();
    for (const npc of harness.majorNpcs()) lastActivity.set(npc.id, npc.currentActivity);
    for (let step = 0; step < 48; step += 1) {
      harness.advanceGameMinutes(30, 30);
      for (const npc of harness.majorNpcs()) {
        if (lastActivity.get(npc.id) !== npc.currentActivity) {
          changes.set(npc.id, (changes.get(npc.id) ?? 0) + 1);
          lastActivity.set(npc.id, npc.currentActivity);
        }
      }
    }
    for (const npc of harness.majorNpcs()) {
      // 24 simulated hours: everyone should change activity at least twice.
      expect(changes.get(npc.id) ?? 0, npc.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('records the last utility decision with its candidate weights', () => {
    const harness = createNpcHarness({ seed: 556677 });
    harness.advanceGameHours(6, 0.5);
    for (const npc of harness.majorNpcs()) {
      const decision = harness.system.getLastDecision(npc.id);
      expect(decision, npc.id).not.toBeNull();
      if (!decision) continue;
      expect(decision.activity.length).toBeGreaterThan(0);
      expect(decision.candidates.length).toBeGreaterThanOrEqual(1);
      expect(decision.candidates.length).toBeLessThanOrEqual(5);
      for (const candidate of decision.candidates) {
        expect(candidate.id.length).toBeGreaterThan(0);
        expect(Number.isFinite(candidate.weight)).toBe(true);
        expect(candidate.weight).toBeGreaterThanOrEqual(0);
      }
      // The decision is persisted in the serialisable NPC extras payload.
      const extras = npc.extras?.['npc'] as Record<string, unknown> | undefined;
      expect(extras?.['lastDecision']).toBeDefined();
    }
    expect(harness.system.getLastDecision('npc_does_not_exist')).toBeNull();
  });

  it('supports setNPCActivity for event/scene integration with validation', () => {
    const harness = createNpcHarness({ seed: 667788 });
    const npc = harness.npc(NPC.marigoldLyle);
    const events: GameEventMap['npc:activity'][] = [];
    harness.bus.on('npc:activity', (payload) => events.push(payload));
    const result = harness.system.setNPCActivity(npc.id, 'read', LOC.library);
    expect(result.ok).toBe(true);
    expect(result.stateChanged).toBe(true);
    expect(npc.currentActivity).toBe('read');
    expect(npc.locationId).toBe(LOC.library);
    expect(npc.activityTargetLocationId).toBe(LOC.library);
    expect(npc.activityEndsAt).toBeGreaterThan(npc.activityStartedAt);
    expect(events.some((event) => event.npcId === npc.id && event.activity === 'read')).toBe(true);

    expect(harness.system.setNPCActivity('missing_npc', 'read', LOC.library).ok).toBe(false);
    expect(harness.system.setNPCActivity(npc.id, '', LOC.library).ok).toBe(false);
    expect(harness.system.setNPCActivity(npc.id, 'read', 'not_a_location').ok).toBe(false);
  });

  it('provides consistent NPC queries', () => {
    const harness = createNpcHarness({ seed: 778899 });
    const all = harness.system.getAllNPCs();
    expect(all).toHaveLength(56);
    const ids = all.map((npc) => npc.id);
    expect([...ids].sort()).toEqual([...ids]);
    expect(harness.system.getMajorNPCs()).toHaveLength(14);
    expect(harness.system.getNPC(NPC.ottoBramwell)?.name).toBe('Otto Bramwell');
    expect(harness.system.getNPC('missing')).toBeUndefined();

    const atCafe = harness.system.getNPCsAt(LOC.cafe);
    for (const npc of atCafe) expect(npc.locationId).toBe(LOC.cafe);
    expect(atCafe).toEqual(all.filter((npc) => npc.locationId === LOC.cafe));

    const playerLocation = harness.state.player.position.locationId;
    expect(harness.system.getNearbyNPCs()).toEqual(harness.system.getNPCsAt(playerLocation));
  });

  it('keeps activity variety from collapsing to a single repeated id', () => {
    const harness = createNpcHarness({ seed: 889900 });
    harness.advanceGameDays(3, 1);
    const everyActivity = new Set<string>();
    for (const npc of Object.values(harness.state.npcs)) {
      everyActivity.add(npc.currentActivity);
      for (const activity of npc.activityHistory) everyActivity.add(activity);
    }
    expect(everyActivity.size).toBeGreaterThanOrEqual(8);
    for (const npc of Object.values(harness.state.npcs)) {
      // The anti-repetition rule keeps the last two activities different in
      // most cases; at minimum history is never a single value repeated 8 times.
      const unique = new Set(npc.activityHistory);
      expect(unique.size, npc.id).toBeGreaterThanOrEqual(Math.min(2, npc.activityHistory.length));
    }
  });
});
