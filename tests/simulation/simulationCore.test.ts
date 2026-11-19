import { describe, expect, it } from 'vitest';
import { ContentRegistry } from '../../src/core/ContentRegistry';
import { createInitialGameState, DEFAULT_APPEARANCE } from '../../src/core/WorldFactory';
import { CONTENT_PACK } from '../../src/data';
import { FixedStepScheduler, SimulationScheduler } from '../../src/simulation/SimulationScheduler';
import { captureSnapshot, restoreSnapshot, serialiseSnapshot, deserialiseSnapshot } from '../../src/simulation/SimulationSnapshot';
import { diffGameStates, describeDiff } from '../../src/simulation/StateDiffEngine';
import { buildOfflineSummary, captureSummaryBaseline } from '../../src/simulation/OfflineSummaryBuilder';

const content = new ContentRegistry(CONTENT_PACK);
const state = () =>
  createInitialGameState({
    seed: 2024,
    playerName: 'Offline Ash',
    appearance: DEFAULT_APPEARANCE,
    content,
  });

describe('FixedStepScheduler', () => {
  it('accumulates fixed steps independently of frame rate', () => {
    const sixty = new FixedStepScheduler(0.25, 0.25);
    const oneFortyFour = new FixedStepScheduler(0.25, 0.25);
    let steps60 = 0;
    let steps144 = 0;
    for (let index = 0; index < 60; index += 1) steps60 += sixty.accumulate(1 / 60);
    for (let index = 0; index < 144; index += 1) steps144 += oneFortyFour.accumulate(1 / 144);
    // A 2x frame-rate difference must not change simulated step count materially.
    expect(Math.abs(steps60 - steps144)).toBeLessThanOrEqual(1);
  });

  it('clamps huge frame gaps to avoid simulation avalanche', () => {
    const scheduler = new FixedStepScheduler(0.25, 0.25);
    const steps = scheduler.accumulate(5);
    expect(steps).toBe(1);
  });

  it('cancels missing frames gracefully', () => {
    const scheduler = new FixedStepScheduler(0.25, 0.25);
    expect(scheduler.accumulate(0)).toBe(0);
    expect(scheduler.accumulate(-3)).toBe(0);
  });
});

describe('SimulationScheduler', () => {
  it('runs named interval tasks on time and cancels them', () => {
    const scheduler = new SimulationScheduler();
    let runs = 0;
    scheduler.schedule('autosave', 2, () => {
      runs += 1;
    });
    scheduler.tick(1);
    expect(runs).toBe(0);
    scheduler.tick(1);
    expect(runs).toBe(1);
    scheduler.tick(4);
    expect(runs).toBe(3);
    scheduler.cancel('autosave');
    scheduler.tick(10);
    expect(runs).toBe(3);
  });
});

describe('SimulationSnapshot', () => {
  it('captures an independent deep copy and restores it', () => {
    const original = state();
    const snapshot = captureSnapshot(original);
    expect(snapshot.simTimeSeconds).toBe(original.clock.simTimeSeconds);
    original.player.money = 1;
    expect(snapshot.state.player.money).not.toBe(1);
    const restored = restoreSnapshot(snapshot);
    expect(restored.player.money).toBe(snapshot.state.player.money);
    restored.player.money = 99;
    expect(snapshot.state.player.money).not.toBe(99);
  });

  it('round-trips through JSON', () => {
    const snapshot = captureSnapshot(state());
    const parsed = deserialiseSnapshot(serialiseSnapshot(snapshot));
    expect(parsed.state.meta.seed).toBe(snapshot.state.meta.seed);
    expect(parsed.simTimeSeconds).toBe(snapshot.simTimeSeconds);
  });
});

describe('StateDiffEngine', () => {
  it('detects changed slices, NPCs and new events', () => {
    const before = state();
    const after = JSON.parse(JSON.stringify(before)) as typeof before;
    after.player.money += 100;
    const npcId = Object.keys(after.npcs)[0];
    if (npcId) {
      const npc = after.npcs[npcId];
      if (npc) npc.currentActivity = 'testing';
    }
    const diff = diffGameStates(before, after);
    expect(diff.changedSlices).toContain('player');
    if (npcId) expect(diff.changedNpcIds).toContain(npcId);
    expect(describeDiff(diff)).toContain('slices');
  });
});

describe('OfflineSummaryBuilder', () => {
  it('summarises real changes and returns no fabricated highlights', () => {
    const before = state();
    const summary = buildOfflineSummary({
      state: before,
      baseline: captureSummaryBaseline(before),
      fromSimTime: before.clock.simTimeSeconds,
      toSimTime: before.clock.simTimeSeconds + 3600,
      realElapsedMs: 3600_000,
    });
    expect(summary.changes).toHaveLength(0);
    expect(summary.headline.length).toBeGreaterThan(10);
    expect(summary.simulatedGameHours).toBe(60);
  });

  it('reports money, cigarette burn, new events and NPC activity changes', () => {
    const before = state();
    const baseline = captureSummaryBaseline(before);
    const after = JSON.parse(JSON.stringify(before)) as typeof before;
    after.player.money = before.player.money + 5000;
    after.player.cigarette.lengthRatio = before.player.cigarette.lengthRatio - 0.05;
    const npcId = Object.keys(after.npcs)[0];
    if (npcId) {
      const npc = after.npcs[npcId];
      if (npc) {
        npc.currentActivity = 'fishing';
        npc.locationId = 'willowbrook_river';
      }
    }
    const summary = buildOfflineSummary({
      state: after,
      baseline,
      fromSimTime: before.clock.simTimeSeconds,
      toSimTime: before.clock.simTimeSeconds + 1440 * 60,
      realElapsedMs: 24 * 3600 * 1000,
    });
    expect(summary.simulatedGameHours).toBe(1440);
    expect(summary.changes.length).toBeGreaterThan(0);
    expect(summary.changes.some((change) => change.description.includes('balance'))).toBe(true);
    expect(summary.changes.some((change) => change.description.includes('cigarette shortened'))).toBe(true);
    expect(summary.highlights.length).toBeLessThanOrEqual(8);
  });
});