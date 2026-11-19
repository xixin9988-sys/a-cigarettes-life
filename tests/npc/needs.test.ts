// =============================================================================
// NeedSystem tests: per-hour decay/accumulation, activity satisfaction,
// emotion/mood derivation and financial pressure coupling.
// =============================================================================
import { describe, expect, it } from 'vitest';
import { NeedSystem } from '../../src/npc/NeedSystem';
import { NEED_KEYS, type NPCNeedsValues } from '../../src/core/SharedTypes';
import { createNpcHarness } from './support/harness';

function freshNpc() {
  const harness = createNpcHarness({ seed: 424242 });
  return { harness, npc: harness.majorNpcs()[0]! };
}

describe('NeedSystem', () => {
  it('decays resource needs downward and accumulates pressure needs upward', () => {
    const needs = new NeedSystem();
    const { npc } = freshNpc();
    const before = { ...npc.needs };
    needs.applyHourlyDecay(npc, 6);
    expect(npc.needs.energy).toBeLessThan(before.energy);
    expect(npc.needs.social).toBeLessThan(before.social);
    expect(npc.needs.fun).toBeLessThan(before.fun);
    expect(npc.needs.safety).toBeLessThan(before.safety);
    expect(npc.needs.belonging).toBeLessThan(before.belonging);
    expect(npc.needs.purpose).toBeLessThan(before.purpose);
    expect(npc.needs.hunger).toBeGreaterThan(before.hunger);
    expect(npc.needs.workPressure).toBeGreaterThan(before.workPressure);
  });

  it('clamps every need to 0..100 even over very long catch-up spans', () => {
    const needs = new NeedSystem();
    const { npc } = freshNpc();
    needs.applyHourlyDecay(npc, 10000);
    for (const key of NEED_KEYS) {
      expect(npc.needs[key], key).toBeGreaterThanOrEqual(0);
      expect(npc.needs[key], key).toBeLessThanOrEqual(100);
      expect(Number.isFinite(npc.needs[key]), key).toBe(true);
    }
  });

  it('applies activity satisfaction: eating reduces hunger, sleeping restores energy, working raises work pressure', () => {
    const needs = new NeedSystem();
    const { npc } = freshNpc();
    npc.needs.hunger = 60;
    needs.applyActivityCompletion(npc, 'eat', 45);
    expect(npc.needs.hunger).toBeLessThan(60);

    npc.needs.energy = 35;
    needs.applyActivityCompletion(npc, 'sleep', 420);
    expect(npc.needs.energy).toBeGreaterThan(35);
    expect(npc.needs.energy).toBeLessThanOrEqual(100);

    npc.needs.workPressure = 20;
    needs.applyActivityCompletion(npc, 'work', 210);
    expect(npc.needs.workPressure).toBeGreaterThan(20);
  });

  it('scales satisfaction with actual duration (interrupted naps help less)', () => {
    const needs = new NeedSystem();
    const { npc } = freshNpc();
    npc.needs.energy = 30;
    const afterShort = (() => {
      const clone = structuredClone(npc);
      needs.applyActivityCompletion(clone, 'sleep', 60);
      return clone.needs.energy;
    })();
    const afterFull = (() => {
      const clone = structuredClone(npc);
      needs.applyActivityCompletion(clone, 'sleep', 420);
      return clone.needs.energy;
    })();
    expect(afterFull).toBeGreaterThan(afterShort);
  });

  it('uses activity decay modifiers (working tires faster than resting; sleep does not drain energy)', () => {
    const needs = new NeedSystem();
    const { npc } = freshNpc();
    const tired = structuredClone(npc);
    tired.needs.energy = 80;
    tired.currentActivity = 'work';
    needs.applyHourlyDecay(tired, 4);
    const rested = structuredClone(npc);
    rested.needs.energy = 80;
    rested.currentActivity = 'rest';
    needs.applyHourlyDecay(rested, 4);
    expect(tired.needs.energy).toBeLessThan(rested.needs.energy);

    const asleep = structuredClone(npc);
    asleep.needs.energy = 40;
    asleep.currentActivity = 'sleep';
    needs.applyHourlyDecay(asleep, 8);
    expect(asleep.needs.energy).toBeGreaterThanOrEqual(39.5);
  });

  it('drifts emotions and mood towards need-derived targets and keeps them in range', () => {
    const needs = new NeedSystem();
    const { npc } = freshNpc();
    // Miserable NPC: all resources empty, pressures maxed.
    const unhappy = structuredClone(npc);
    unhappy.needs = {
      hunger: 100, energy: 0, social: 0, fun: 0, safety: 0, belonging: 0,
      moneyPressure: 100, workPressure: 100, purpose: 0,
    } satisfies NPCNeedsValues;
    // Contented NPC: the opposite.
    const happy = structuredClone(npc);
    happy.needs = {
      hunger: 0, energy: 100, social: 100, fun: 100, safety: 100, belonging: 100,
      moneyPressure: 0, workPressure: 0, purpose: 100,
    } satisfies NPCNeedsValues;
    for (let hour = 0; hour < 40; hour += 1) {
      needs.updateEmotions(unhappy, 1);
      needs.updateEmotions(happy, 1);
    }
    expect(happy.emotions.joy).toBeGreaterThan(unhappy.emotions.joy);
    expect(happy.emotions.sadness).toBeLessThan(unhappy.emotions.sadness);
    expect(happy.emotions.stress).toBeLessThan(unhappy.emotions.stress);
    expect(happy.emotions.anger).toBeLessThan(unhappy.emotions.anger);
    expect(happy.mood).toBeGreaterThan(unhappy.mood);
    for (const npcState of [unhappy, happy]) {
      for (const key of Object.keys(npcState.emotions) as (keyof typeof npcState.emotions)[]) {
        expect(npcState.emotions[key]).toBeGreaterThanOrEqual(0);
        expect(npcState.emotions[key]).toBeLessThanOrEqual(1);
      }
      expect(npcState.mood).toBeGreaterThanOrEqual(-1);
      expect(npcState.mood).toBeLessThanOrEqual(1);
    }
  });

  it('orders need urgency with the right polarity', () => {
    const needs = new NeedSystem();
    const { npc } = freshNpc();
    npc.needs.hunger = 95; // pressure: almost desperate
    npc.needs.energy = 95; // resource: almost full
    const snapshot = needs.needSnapshot(npc);
    const hunger = snapshot.find((entry) => entry.need === 'hunger');
    const energy = snapshot.find((entry) => entry.need === 'energy');
    expect(hunger?.urgency).toBeGreaterThan(0.9);
    expect(energy?.urgency).toBeLessThan(0.1);
    expect(snapshot[0]?.urgency).toBeGreaterThanOrEqual(snapshot[snapshot.length - 1]?.urgency ?? 0);
  });

  it('couples money pressure to the NPC wallet', () => {
    const needs = new NeedSystem();
    const { npc } = freshNpc();
    const rich = structuredClone(npc);
    rich.money = 250000;
    rich.needs.moneyPressure = 70;
    const poor = structuredClone(npc);
    poor.money = 500;
    poor.needs.moneyPressure = 70;
    needs.applyHourlyDecay(rich, 10);
    needs.applyHourlyDecay(poor, 10);
    expect(rich.needs.moneyPressure).toBeLessThan(poor.needs.moneyPressure);
    expect(poor.needs.moneyPressure).toBeGreaterThan(60);
  });
});
