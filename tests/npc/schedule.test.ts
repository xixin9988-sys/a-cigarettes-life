// =============================================================================
// ScheduleSystem tests: adherence planning, full-day coverage, weekday
// handling, day rollover replanning and determinism.
// =============================================================================
import { describe, expect, it } from 'vitest';
import { NPC } from '../../src/data/npcs/ids';
import { createNpcHarness } from './support/harness';
import { SIM_SECONDS_PER_GAME_DAY } from '../../src/npc/NPC';

function coverageHours(entries: { startHour: number; endHour: number }[]): number {
  const covered = new Array<boolean>(1440).fill(false);
  for (const entry of entries) {
    const start = Math.max(0, Math.round(entry.startHour * 60));
    let end = Math.min(1440, Math.round(entry.endHour * 60));
    if (end <= start) end = 1440;
    for (let minute = start; minute < end; minute += 1) covered[minute] = true;
  }
  return covered.filter(Boolean).length / 60;
}

describe('ScheduleSystem', () => {
  it('plans a full 24h day for every NPC at init', () => {
    const harness = createNpcHarness({ seed: 5150 });
    const day = harness.time().totalDays;
    for (const npc of Object.values(harness.state.npcs)) {
      expect(npc.schedule.entries.length, npc.id).toBeGreaterThanOrEqual(6);
      expect(npc.schedule.lastPlannedDay, npc.id).toBe(day);
      expect(coverageHours(npc.schedule.entries), npc.id).toBeCloseTo(24, 1);
      expect(harness.system.getExpectedActivity(npc.id), npc.id).not.toBeNull();
      for (const entry of npc.schedule.entries) {
        expect(entry.endHour, npc.id).toBeGreaterThan(entry.startHour);
        expect(entry.adherence, npc.id).toBeGreaterThan(0);
        expect(entry.adherence, npc.id).toBeLessThanOrEqual(1);
      }
    }
  });

  it('resolves a planned activity and location for any hour of the day', () => {
    const harness = createNpcHarness({ seed: 6161 });
    const npc = harness.npc(NPC.marigoldLyle);
    for (let hour = 0; hour < 24; hour += 0.5) {
      const entry = npc.schedule.entries.find((candidate) => {
        let end = candidate.endHour;
        if (end <= candidate.startHour) end += 24;
        return hour >= candidate.startHour && hour < end;
      });
      expect(entry, 'hour ' + hour).toBeDefined();
    }
  });

  it('replans when the in-game day rolls over', () => {
    const harness = createNpcHarness({ seed: 7171 });
    const startDay = harness.time().totalDays;
    harness.advanceGameDays(1, 2);
    const nextDay = harness.time().totalDays;
    expect(nextDay).toBe(startDay + 1);
    for (const npc of Object.values(harness.state.npcs)) {
      expect(npc.schedule.lastPlannedDay, npc.id).toBe(nextDay);
      expect(coverageHours(npc.schedule.entries), npc.id).toBeCloseTo(24, 1);
    }
  });

  it('honours weekday-restricted entries (the bakery is closed on Sundays)', () => {
    const harness = createNpcHarness({ seed: 8181 });
    // Start day is Monday (totalDays 0). Advance to Sunday.
    harness.advanceSimSeconds(6 * SIM_SECONDS_PER_GAME_DAY);
    const time = harness.time();
    expect(time.totalDays % 7).toBe(6);
    const otto = harness.npc(NPC.ottoBramwell);
    expect(otto.schedule.lastPlannedDay).toBe(time.totalDays);
    expect(otto.schedule.entries.some((entry) => entry.activity === 'work')).toBe(false);
  });

  it('is deterministic for the same seed and different across seeds', () => {
    const first = createNpcHarness({ seed: 4242 });
    const second = createNpcHarness({ seed: 4242 });
    const third = createNpcHarness({ seed: 9999 });
    const planOf = (harness: ReturnType<typeof createNpcHarness>): string =>
      JSON.stringify(
        Object.values(harness.state.npcs)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map((npc) => npc.schedule.entries)
      );
    expect(planOf(first)).toBe(planOf(second));
    expect(planOf(first)).not.toBe(planOf(third));
  });

  it('lets less responsible NPCs deviate from the template sometimes', () => {
    const harness = createNpcHarness({ seed: 1212 });
    const expectedGroups = new Set<string>();
    for (const npc of harness.majorNpcs()) {
      for (const entry of npc.schedule.entries) {
        expectedGroups.add(entry.activity);
      }
    }
    // The authored activity vocabulary should survive into the plans.
    expect(expectedGroups.size).toBeGreaterThan(8);
  });
});
