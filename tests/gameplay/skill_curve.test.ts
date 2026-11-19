import { describe, expect, it } from 'vitest';
import { createCraftHarness } from './testkit';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import type { StatusEffectState } from '../../src/core/contracts';

const BASE = WORLD_CONFIG.skill.baseXpToLevel;
const GROWTH = WORLD_CONFIG.skill.xpGrowth;
const MAX_LEVEL = WORLD_CONFIG.skill.maxLevel;

function expectedXpToNext(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return Math.round(BASE * Math.pow(GROWTH, level - 1));
}

describe('SkillSystem - XP curve', () => {
  it('follows the configured exponential curve', () => {
    const harness = createCraftHarness({ register: ['skill'] });
    expect(BASE).toBe(60);
    expect(harness.skill.getProgress('crafting').xpToNext).toBe(60);
    expect(harness.skill.xpToNext(1)).toBe(60);
    expect(harness.skill.xpToNext(2)).toBe(expectedXpToNext(2));
    expect(harness.skill.xpToNext(3)).toBe(expectedXpToNext(3));
    expect(harness.skill.xpToNext(2)).toBe(71);
    expect(harness.skill.xpToNext(MAX_LEVEL)).toBe(0);
  });

  it('is monotonically increasing until max level', () => {
    const harness = createCraftHarness({ register: ['skill'] });
    let previous = 0;
    for (let level = 1; level < MAX_LEVEL; level += 1) {
      const value = harness.skill.xpToNext(level);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it('levels up at the threshold and carries the remainder', () => {
    const harness = createCraftHarness({ register: ['skill'] });
    harness.skill.addXp('crafting', 59, 'unit-test');
    let progress = harness.skill.getProgress('crafting');
    expect(progress.level).toBe(1);
    expect(progress.xp).toBe(59);

    harness.skill.addXp('crafting', 6, 'unit-test');
    progress = harness.skill.getProgress('crafting');
    expect(progress.level).toBe(2);
    expect(progress.xp).toBe(5);
    expect(progress.xpToNext).toBe(71);
    expect(progress.totalXp).toBe(65);
    expect(progress.uses).toBe(2);
    expect(harness.skill.getLevel('crafting')).toBe(2);
  });

  it('can gain several levels from one large action', () => {
    const harness = createCraftHarness({ register: ['skill'] });
    // 60 + 71 + 84 = 215 xp reaches level 4 exactly.
    harness.skill.addXp('gardening', 215, 'bumper-harvest');
    const progress = harness.skill.getProgress('gardening');
    expect(progress.level).toBe(4);
    expect(progress.xp).toBe(0);
    expect(progress.xpToNext).toBe(expectedXpToNext(4));
  });

  it('emits skill:levelup signals with the new level', () => {
    const harness = createCraftHarness({ register: ['skill'] });
    harness.skill.addXp('fishing', 60, 'first-cast');
    const levelUp = harness.signals.filter((signal) => signal.name === 'skill:levelup');
    expect(levelUp).toHaveLength(1);
    expect(levelUp[0]?.data).toMatchObject({ skill: 'fishing', level: 2, source: 'first-cast' });
  });

  it('stops at the configured maximum level', () => {
    const harness = createCraftHarness({ register: ['skill'] });
    harness.skill.addXp('art', 10_000_000, 'cheat');
    const progress = harness.skill.getProgress('art');
    expect(progress.level).toBe(MAX_LEVEL);
    expect(progress.xpToNext).toBe(0);
    expect(progress.xp).toBe(0);
    expect(progress.totalXp).toBeGreaterThan(0);
    // Further XP does not overflow the level.
    harness.skill.addXp('art', 500, 'cheat');
    expect(harness.skill.getLevel('art')).toBe(MAX_LEVEL);
  });

  it('multiplies XP gain by active status effects and clamps the multiplier', () => {
    const harness = createCraftHarness({ register: ['skill'] });
    const buff: StatusEffectState = {
      id: 'buff_1',
      label: 'Well fed',
      source: 'test',
      startedAt: 0,
      expiresAt: null,
      skillXpMultiplier: 1.5,
    };
    harness.state.player.statusEffects.push(buff);
    expect(harness.skill.getXpMultiplier()).toBeCloseTo(1.5, 5);
    harness.skill.addXp('cooking', 40, 'buff-test');
    expect(harness.skill.getProgress('cooking').totalXp).toBe(60);

    const extra: StatusEffectState = {
      id: 'buff_2',
      label: 'Inspired',
      source: 'test',
      startedAt: 0,
      expiresAt: null,
      skillXpMultiplier: 100,
    };
    harness.state.player.statusEffects.push(extra);
    expect(harness.skill.getXpMultiplier()).toBe(4);
  });

  it('canUse gates actions by level', () => {
    const harness = createCraftHarness({ register: ['skill'] });
    expect(harness.skill.canUse('exploration', 1)).toBe(true);
    expect(harness.skill.canUse('exploration', 2)).toBe(false);
    harness.skill.addXp('exploration', 215, 'test');
    expect(harness.skill.canUse('exploration', 4)).toBe(true);
    expect(harness.skill.canUse('exploration', 5)).toBe(false);
  });

  it('reports progress ratios for the UI', () => {
    const harness = createCraftHarness({ register: ['skill'] });
    harness.skill.addXp('social', 30, 'chat');
    expect(harness.skill.getProgressRatio('social')).toBeCloseTo(0.5, 5);
    harness.skill.addXp('social', 30, 'chat');
    expect(harness.skill.getProgressRatio('social')).toBe(0);
  });

  it('ignores invalid xp amounts and keeps the eight skills present', () => {
    const harness = createCraftHarness({ register: ['skill'] });
    const before = harness.skill.getProgress('crafting').totalXp;
    harness.skill.addXp('crafting', 0, 'nothing');
    harness.skill.addXp('crafting', Number.NaN, 'nothing');
    harness.skill.addXp('crafting', -50, 'nothing');
    expect(harness.skill.getProgress('crafting').totalXp).toBe(before);
    expect(harness.skill.getTotalLevels()).toBe(8);
  });
});
