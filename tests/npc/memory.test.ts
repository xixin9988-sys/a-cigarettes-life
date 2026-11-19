// =============================================================================
// MemorySystem tests: Ebbinghaus decay, permanent memories, recall boosts,
// cap enforcement and memory influence on behaviour.
// =============================================================================
import { describe, expect, it } from 'vitest';
import {
  MEMORY_DECAY_LAMBDA_PER_DAY,
  MemorySystem,
  PERMANENT_MEMORY_THRESHOLD,
  decayedStrength,
} from '../../src/npc/MemorySystem';
import { SIM_SECONDS_PER_GAME_DAY } from '../../src/npc/NPC';
import { createNpcHarness } from './support/harness';

function memoryHarness(seed = 909090) {
  const harness = createNpcHarness({ seed });
  const npc = harness.majorNpcs()[0]!;
  npc.memories = [];
  return { harness, npc, memory: harness.system.memorySystem };
}

describe('MemorySystem', () => {
  it('starts at the seed importance and decays exponentially', () => {
    const { npc, memory } = memoryHarness();
    const now = 10_000;
    const created = memory.addMemory(
      npc,
      { type: 'social:chat', text: 'A pleasant afternoon at the cafe.', importance: 60, emotionalValue: 4 },
      now
    );
    expect(created.strength).toBe(60);
    expect(created.permanent).toBe(false);
    memory.update(npc, now + 10 * SIM_SECONDS_PER_GAME_DAY);
    const expected = decayedStrength(60, 10);
    expect(expected).toBeCloseTo(60 * Math.exp(-MEMORY_DECAY_LAMBDA_PER_DAY * 10), 6);
    expect(created.strength).toBeCloseTo(expected, 4);
    expect(created.strength).toBeLessThan(60);
  });

  it('prunes faded short-term memories but keeps permanent ones forever', () => {
    const { npc, memory } = memoryHarness();
    const now = 5000;
    memory.addMemory(npc, { type: 'social:small_talk', text: 'A forgettable hello.', importance: 10 }, now);
    const important = memory.addMemory(
      npc,
      { type: 'romance:began', text: 'They fell in love.', importance: PERMANENT_MEMORY_THRESHOLD },
      now
    );
    expect(important.permanent).toBe(true);
    memory.update(npc, now + 10 * SIM_SECONDS_PER_GAME_DAY);
    expect(npc.memories).toHaveLength(1);
    expect(npc.memories[0]?.id).toBe(important.id);
    memory.update(npc, now + 400 * SIM_SECONDS_PER_GAME_DAY);
    expect(npc.memories.some((entry) => entry.id === important.id)).toBe(true);
  });

  it('caps memories at 60 while always keeping permanent memories', () => {
    const { npc, memory } = memoryHarness();
    const now = 1000;
    for (let index = 0; index < 25; index += 1) {
      memory.addMemory(
        npc,
        { type: 'milestone', text: 'Permanent memory ' + index, importance: 90 },
        now + index
      );
    }
    for (let index = 0; index < 70; index += 1) {
      memory.addMemory(
        npc,
        { type: 'event:small', text: 'Transient memory ' + index, importance: 20 + (index % 10) },
        now + index
      );
    }
    expect(npc.memories).toHaveLength(60);
    expect(memory.permanentCount(npc)).toBe(25);
    expect(npc.memories.filter((entry) => entry.permanent)).toHaveLength(25);
  });

  it('strengthens a memory and resets its decay clock when recalled', () => {
    const { npc, memory } = memoryHarness();
    const now = 2000;
    const created = memory.addMemory(
      npc,
      { type: 'social:heart_to_heart', text: 'A long honest talk.', importance: 50, emotionalValue: 6 },
      now
    );
    memory.update(npc, now + 8 * SIM_SECONDS_PER_GAME_DAY);
    const before = created.strength;
    expect(before).toBeLessThan(50);
    const recalled = memory.recall(npc, created.id, now + 8 * SIM_SECONDS_PER_GAME_DAY);
    expect(recalled).toBe(true);
    expect(created.strength).toBeGreaterThan(before);
    expect(created.lastRecalledAt).toBe(now + 8 * SIM_SECONDS_PER_GAME_DAY);
    expect(memory.recall(npc, 'missing-memory', now)).toBe(false);
  });

  it('remembers people and turns memories into decision influence', () => {
    const { npc, memory } = memoryHarness();
    const now = 3000;
    const otherId = 'resident_01';
    memory.addMemory(
      npc,
      {
        type: 'social:go_cafe',
        text: 'A wonderful afternoon of coffee and gossip.',
        participantIds: [otherId],
        importance: 80,
        emotionalValue: 7,
      },
      now
    );
    expect(memory.influence(npc, { activityId: 'go_cafe', activityGroup: 'social' })).toBeGreaterThan(1);
    expect(memory.influence(npc, { participantId: otherId })).toBeGreaterThan(1);
    expect(memory.influence(npc, { activityId: 'fish', activityGroup: 'explore' })).toBe(1);
    // A negative memory about someone makes interacting with them less appealing.
    npc.memories = [];
    memory.addMemory(
      npc,
      { type: 'social:argument', text: 'A bitter argument.', participantIds: [otherId], importance: 90, emotionalValue: -10 },
      now
    );
    const negativeInfluence = memory.influence(npc, { activityGroup: 'social', participantId: otherId });
    expect(negativeInfluence).toBeLessThan(1);
    expect(negativeInfluence).toBeGreaterThanOrEqual(0.7);
    expect(memory.memoriesAbout(npc, otherId)).toHaveLength(1);
    const recalled = memory.recallAbout(npc, otherId, now + 1, 2);
    expect(recalled).toHaveLength(1);
    // Empty memory => neutral influence.
    npc.memories = [];
    expect(memory.influence(npc, { activityId: 'work' })).toBe(1);
  });

  it('generates deterministic ids for identical event sequences', () => {
    const a = memoryHarness(12345);
    const b = memoryHarness(12345);
    const seed = { type: 'social:chat', text: 'Same chat.', importance: 30 };
    const first = a.memory.addMemory(a.npc, seed, 6000);
    const second = b.memory.addMemory(b.npc, seed, 6000);
    expect(first.id).toBe(second.id);
    const third = a.memory.addMemory(a.npc, seed, 6000);
    expect(third.id).not.toBe(first.id);
  });
});
