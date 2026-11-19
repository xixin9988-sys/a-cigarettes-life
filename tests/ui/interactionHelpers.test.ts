import { describe, expect, it } from 'vitest';
import type { OfflineChange } from '../../src/core/contracts';
import {
  eventCategoryIcon,
  formatDurationClock,
  formatPercent01,
  groupLifeArchive,
  groupOfflineChanges,
  itemActionKinds,
  humaniseId,
  minutesUntilText,
  offlineChangeIcon,
  parsePositiveInt,
  qualityColor,
  quantityFraction,
  remainingCigaretteHours,
  stableHash,
  cosmeticNoise,
  xpToNextForLevel,
  windArrow,
} from '../../src/ui/model';
import { CONTENT_PACK } from '../../src/data';
import { ContentRegistry } from '../../src/core/ContentRegistry';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';

const content = new ContentRegistry(CONTENT_PACK);

describe('formatting helpers', () => {
  it('formats durations from simulation seconds', () => {
    expect(formatDurationClock(0)).toBe('0m');
    expect(formatDurationClock(90)).toBe('1h 30m');
    expect(formatDurationClock(60 * 24 * 2 + 60 * 5)).toBe('2d 5h');
  });

  it('formats percentages and clamps out-of-range input', () => {
    expect(formatPercent01(0.456, 1)).toBe('45.6%');
    expect(formatPercent01(-3)).toBe('0%');
    expect(formatPercent01(3)).toBe('100%');
    expect(quantityFraction(5, 10)).toBeCloseTo(0.5, 5);
    expect(quantityFraction(5, 0)).toBe(0);
  });

  it('formats train countdowns', () => {
    expect(minutesUntilText(0)).toBe('0m');
    expect(minutesUntilText(45.4)).toBe('45m');
    expect(minutesUntilText(125)).toBe('2h 5m');
  });

  it('humanises ids and arrows', () => {
    expect(humaniseId('train_station')).toBe('Train Station');
    expect(windArrow(0)).toBe('↑');
    expect(windArrow(90)).toBe('→');
    expect(windArrow(180)).toBe('↓');
    expect(windArrow(360)).toBe('↑');
    expect(windArrow(Number.NaN)).toBe('↑');
  });

  it('computes remaining cigarette hours from world config and burn rate', () => {
    expect(remainingCigaretteHours(1, 1)).toBeCloseTo(WORLD_CONFIG.cigarette.lifetimeGameHours, 5);
    expect(remainingCigaretteHours(0.5, 2)).toBeCloseTo(WORLD_CONFIG.cigarette.lifetimeGameHours / 4, 5);
    expect(remainingCigaretteHours(1, 0)).toBeGreaterThan(0);
  });

  it('mirrors the world config skill xp curve', () => {
    expect(xpToNextForLevel(WORLD_CONFIG.skill.maxLevel)).toBe(0);
    const level1 = xpToNextForLevel(1);
    const level2 = xpToNextForLevel(2);
    expect(level1).toBe(WORLD_CONFIG.skill.baseXpToLevel);
    expect(level2).toBeGreaterThan(level1);
  });
});

describe('deterministic cosmetic helpers', () => {
  it('stableHash is deterministic and stable', () => {
    expect(stableHash('hello')).toBe(stableHash('hello'));
    expect(stableHash('hello')).not.toBe(stableHash('world'));
    expect(stableHash('')).toBeGreaterThanOrEqual(0);
  });

  it('cosmeticNoise stays in [0,1) and never uses Math.random', () => {
    for (let index = 0; index < 20; index += 1) {
      const value = cosmeticNoise('ember', index);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(cosmeticNoise('ember', 3)).toBe(cosmeticNoise('ember', 3));
  });
});

describe('journal / offline helpers', () => {
  it('groups archive entries by category', () => {
    const entries = [
      { category: 'milestone', title: 'a' },
      { category: 'milestone', title: 'b' },
      { category: 'daily', title: 'c' },
    ];
    const groups = groupLifeArchive(entries);
    expect(Object.keys(groups).sort()).toEqual(['daily', 'milestone']);
    expect(groups.milestone).toHaveLength(2);
    expect(groups.daily).toHaveLength(1);
  });

  it('groups offline changes in a stable order and icons every kind', () => {
    const changes: OfflineChange[] = [
      { kind: 'event', description: 'festival', importance: 2 },
      { kind: 'player', description: 'you moved', importance: 1 },
      { kind: 'event', description: 'second', importance: 1 },
    ];
    const groups = groupOfflineChanges(changes);
    expect(groups[0]?.kind).toBe('player');
    expect(groups[1]?.kind).toBe('event');
    expect(groups[1]?.items).toHaveLength(2);
    for (const kind of ['npc', 'business', 'farming', 'economy', 'event', 'relationship', 'weather', 'player', 'world'] as const) {
      expect(offlineChangeIcon(kind).length).toBeGreaterThan(0);
    }
    expect(eventCategoryIcon('lucky')).toBe('🍀');
    expect(eventCategoryIcon('unknown-category')).toBe('·');
  });
});

describe('item action helpers', () => {
  it('detects food, equipment and readable items from real definitions', () => {
    const bread = content.getAllItems().find((item) => item.edible === true && item.category === 'food');
    expect(bread).toBeDefined();
    if (bread) {
      const kinds = itemActionKinds(bread);
      expect(kinds.canUse).toBe(true);
      expect(kinds.isFood).toBe(true);
    }
    const equipment = content.getAllItems().find((item) => item.equipmentSlot !== undefined);
    expect(equipment).toBeDefined();
    if (equipment) {
      const kinds = itemActionKinds(equipment);
      expect(kinds.canEquip).toBe(true);
      expect(kinds.canUse).toBe(true);
    }
    const readable = content.getAllItems().find((item) => item.readSkill !== undefined);
    if (readable) {
      expect(itemActionKinds(readable).canRead).toBe(true);
    }
    expect(itemActionKinds(undefined).canUse).toBe(false);
  });

  it('maps quality to a stable colour and parsing quantities clamps', () => {
    expect(qualityColor(1)).toMatch(/^#/);
    expect(qualityColor(5)).not.toBe(qualityColor(1));
    expect(parsePositiveInt('3', 10)).toBe(3);
    expect(parsePositiveInt('0', 10)).toBe(1);
    expect(parsePositiveInt('999', 10)).toBe(10);
    expect(parsePositiveInt('abc', 10, 2)).toBe(2);
  });
});
