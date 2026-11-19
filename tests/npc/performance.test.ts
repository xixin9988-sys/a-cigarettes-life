// =============================================================================
// Performance / offline catch-up tests: a single update() call spanning 30 game
// days for all 56 NPCs must stay fast, bounded and deterministic, and must not
// corrupt anyNPC state.
// =============================================================================
import { describe, expect, it } from 'vitest';
import { NEED_KEYS } from '../../src/core/SharedTypes';
import { SIM_SECONDS_PER_GAME_DAY } from '../../src/npc/NPC';
import { createNpcHarness, npcStateSnapshot } from './support/harness';

function assertNpcStateSane(harness: ReturnType<typeof createNpcHarness>): void {
  const now = harness.clock.simTimeSeconds;
  for (const npc of Object.values(harness.state.npcs)) {
    expect(npc.lastUpdatedAt, npc.id).toBe(now);
    expect(Number.isFinite(npc.money), npc.id).toBe(true);
    expect(npc.money, npc.id).toBeGreaterThanOrEqual(0);
    for (const need of NEED_KEYS) {
      expect(Number.isFinite(npc.needs[need]), npc.id + ':' + need).toBe(true);
      expect(npc.needs[need], npc.id + ':' + need).toBeGreaterThanOrEqual(0);
      expect(npc.needs[need], npc.id + ':' + need).toBeLessThanOrEqual(100);
    }
    for (const emotion of Object.keys(npc.emotions) as (keyof typeof npc.emotions)[]) {
      expect(Number.isFinite(npc.emotions[emotion]), npc.id).toBe(true);
      expect(npc.emotions[emotion], npc.id).toBeGreaterThanOrEqual(0);
      expect(npc.emotions[emotion], npc.id).toBeLessThanOrEqual(1);
    }
    expect(Number.isFinite(npc.mood), npc.id).toBe(true);
    expect(Math.abs(npc.mood), npc.id).toBeLessThanOrEqual(1);
    expect(npc.memories.length, npc.id).toBeLessThanOrEqual(60);
    expect(npc.activityHistory.length, npc.id).toBeLessThanOrEqual(8);
    expect(npc.schedule.entries.length, npc.id).toBeGreaterThan(0);
    expect(harness.content.getLocation(npc.locationId), npc.id).toBeDefined();
    expect(npc.currentActivity.length, npc.id).toBeGreaterThan(0);
  }
}

describe('NPCSystem large-dt catch-up performance', () => {
  it('simulates all 56 NPCs over 30 game days in a single update fast enough', () => {
    const harness = createNpcHarness({ seed: 111222 });
    const start = performance.now();
    harness.advanceSimSeconds(30 * SIM_SECONDS_PER_GAME_DAY);
    const elapsedMs = performance.now() - start;
    // Generous bound for CI machines; the implementation is expected to be
    // well under this (target: a few seconds at most).
    expect(elapsedMs).toBeLessThan(15000);
    assertNpcStateSane(harness);
    expect(harness.system.getDecisionCount()).toBeGreaterThan(0);
    // Decision budget is respected per NPC per update call.
    expect(harness.system.getDecisionCount()).toBeLessThanOrEqual(56 * 8 + 8);
  });

  it('produces identical state for the same seed and same big jump', () => {
    const first = createNpcHarness({ seed: 333444 });
    const second = createNpcHarness({ seed: 333444 });
    first.advanceSimSeconds(10 * SIM_SECONDS_PER_GAME_DAY);
    second.advanceSimSeconds(10 * SIM_SECONDS_PER_GAME_DAY);
    expect(npcStateSnapshot(second.state)).toBe(npcStateSnapshot(first.state));

    const different = createNpcHarness({ seed: 555666 });
    different.advanceSimSeconds(10 * SIM_SECONDS_PER_GAME_DAY);
    expect(npcStateSnapshot(different.state)).not.toBe(npcStateSnapshot(first.state));
  });

  it('does not rework state when no time passes', () => {
    const harness = createNpcHarness({ seed: 777888 });
    harness.advanceGameHours(2, 1);
    const snapshot = npcStateSnapshot(harness.state);
    harness.system.update(0);
    harness.system.update(0);
    expect(npcStateSnapshot(harness.state)).toBe(snapshot);
  });

  it('prunes old memories during long offline catch-up', () => {
    const harness = createNpcHarness({ seed: 999000 });
    const npc = harness.npc('resident_05');
    harness.system.memorySystem.addMemory(
      npc,
      { type: 'event:trivial', text: 'A trivial old memory.', importance: 12 },
      harness.clock.simTimeSeconds
    );
    const memoryCountBefore = npc.memories.length;
    expect(memoryCountBefore).toBeGreaterThan(0);
    harness.advanceSimSeconds(30 * SIM_SECONDS_PER_GAME_DAY);
    expect(npc.memories.length).toBeLessThanOrEqual(60);
    expect(
      npc.memories.some((memory) => memory.text === 'A trivial old memory.')
    ).toBe(false);
  });
});
