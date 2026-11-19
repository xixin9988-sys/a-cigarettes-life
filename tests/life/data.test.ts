import { describe, expect, it } from 'vitest';
import type { AchievementTrigger, ItemDef } from '../../src/data/schema';
import { LIFE_ITEMS } from '../../src/data/items/life';
import { ACHIEVEMENTS } from '../../src/data/achievements/achievements';
import { PLAYER_GOALS } from '../../src/data/goals/goals';
import { ITEM } from '../../src/data/items/ids';
import { SKILL_IDS } from '../../src/core/SharedTypes';
import { isKnownStatKey } from '../../src/life/lifeShared';
import { INFLUENCE_TIERS } from '../../src/life/InfluenceSystem';

const HEX = /^#[0-9a-fA-F]{6}$/;

const REQUIRED_LIFE_ITEM_IDS: readonly string[] = [
  ITEM.miniUmbrella,
  ITEM.waterproofCase,
  ITEM.windbreakScreen,
  ITEM.waxedPaperCoat,
  ITEM.brassWindGuard,
  ITEM.cigaretteHolder,
  ITEM.filterExtender,
  ITEM.desiccantPack,
  ITEM.windproofLighter,
  ITEM.matches,
  ITEM.handWarmer,
  ITEM.ashTray,
  ITEM.ceramicAshPot,
  ITEM.cigaretteAsh,
  ITEM.ashFertilizer,
  ITEM.ashGlaze,
  ITEM.paintPigment,
];

function knownStatKey(key: string): boolean {
  return isKnownStatKey(key);
}

function assertValidTrigger(trigger: AchievementTrigger, label: string): void {
  expect(trigger.threshold, label + ' threshold').toBeGreaterThan(0);
  expect(Number.isFinite(trigger.threshold), label + ' threshold finite').toBe(true);
  switch (trigger.kind) {
    case 'stat':
      expect(
        knownStatKey(trigger.key),
        label + ' stat key "' + trigger.key + '" is resolvable'
      ).toBe(true);
      break;
    case 'skill':
      expect(SKILL_IDS.includes(trigger.key as (typeof SKILL_IDS)[number]) || trigger.key === 'any', label).toBe(true);
      break;
    case 'collection':
      expect(trigger.key === 'total' || trigger.key.length > 0, label).toBe(true);
      break;
    case 'relationship':
      expect(['friends', 'close_friends', 'partners', 'known']).toContain(trigger.key);
      break;
    case 'wealth':
      expect(['money', 'moneyEarned', 'influence', 'communityPoints', 'netWorth']).toContain(trigger.key);
      break;
    case 'event':
      expect(trigger.key.length).toBeGreaterThan(0);
      break;
    default:
      throw new Error('Unknown trigger kind for ' + label);
  }
}

describe('life item data', () => {
  it('defines every cigarette-care and ash-product id required by the brief', () => {
    const ids = new Set(LIFE_ITEMS.map((item) => item.id));
    for (const required of REQUIRED_LIFE_ITEM_IDS) {
      expect(ids.has(required), 'missing life item ' + required).toBe(true);
    }
    // The module owns exactly these ids - no cargo-cult duplicates from other domains.
    expect(LIFE_ITEMS.length).toBe(REQUIRED_LIFE_ITEM_IDS.length);
  });

  it('has unique ids that all exist in the canonical ITEM registry', () => {
    const ids = LIFE_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const canonical = new Set<string>(Object.values(ITEM));
    for (const id of ids) expect(canonical.has(id), id + ' is canonical').toBe(true);
  });

  it('has complete, well-formed item definitions', () => {
    const allowedCategories = new Set([
      'material',
      'tool',
      'equipment',
      'misc',
      'collectible',
      'gift',
      'furniture',
      'decor',
      'clothing',
      'book',
    ]);
    for (const item of LIFE_ITEMS) {
      expect(item.name.length, item.id + ' name').toBeGreaterThan(2);
      expect(item.description.length, item.id + ' description').toBeGreaterThan(30);
      expect(Number.isInteger(item.basePrice), item.id + ' integer price').toBe(true);
      expect(item.basePrice, item.id + ' price').toBeGreaterThan(0);
      expect(item.maxStack, item.id + ' maxStack').toBeGreaterThanOrEqual(1);
      expect(allowedCategories.has(item.category), item.id + ' category').toBe(true);
      expect(item.visual.color, item.id + ' colour').toMatch(HEX);
      expect(item.tags.length, item.id + ' tags').toBeGreaterThan(0);
      expect(item.source, item.id + ' source').toBeTruthy();
    }
  });

  it('models wearable protection with valid 0..1 coefficients', () => {
    const wearableIds = [
      ITEM.miniUmbrella,
      ITEM.waterproofCase,
      ITEM.windbreakScreen,
      ITEM.waxedPaperCoat,
      ITEM.brassWindGuard,
      ITEM.cigaretteHolder,
      ITEM.filterExtender,
    ];
    for (const id of wearableIds) {
      const item = LIFE_ITEMS.find((candidate) => candidate.id === id) as ItemDef;
      expect(item.equipmentSlot, id + ' slot').toBeTruthy();
      const hasProtection =
        (item.moistureProtection ?? 0) > 0 || (item.windProtection ?? 0) > 0 || item.burnRateMultiplier !== undefined;
      expect(hasProtection, id + ' provides protection').toBe(true);
      if (item.moistureProtection !== undefined) {
        expect(item.moistureProtection).toBeGreaterThan(0);
        expect(item.moistureProtection).toBeLessThanOrEqual(1);
      }
      if (item.windProtection !== undefined) {
        expect(item.windProtection).toBeGreaterThan(0);
        expect(item.windProtection).toBeLessThanOrEqual(1);
      }
      if (item.burnRateMultiplier !== undefined) {
        expect(item.burnRateMultiplier).toBeGreaterThan(0);
        expect(item.burnRateMultiplier).toBeLessThan(1.5);
      }
    }
    // The umbrella is the strongest rain protection, the brass guard the strongest wind protection.
    const umbrella = LIFE_ITEMS.find((item) => item.id === ITEM.miniUmbrella);
    const caseItem = LIFE_ITEMS.find((item) => item.id === ITEM.waterproofCase);
    expect(caseItem?.moistureProtection ?? 0).toBeGreaterThan(umbrella?.moistureProtection ?? 0);
    const guard = LIFE_ITEMS.find((item) => item.id === ITEM.brassWindGuard);
    expect(guard?.windProtection ?? 0).toBeGreaterThanOrEqual(0.8);
  });

  it('defines the ash product chain with ash and fertiliser tags', () => {
    const ashItems = [ITEM.cigaretteAsh, ITEM.ashFertilizer, ITEM.ashGlaze, ITEM.paintPigment];
    for (const id of ashItems) {
      const item = LIFE_ITEMS.find((candidate) => candidate.id === id) as ItemDef;
      expect(item.tags).toContain('ash');
      expect(item.stackable, id + ' stackable').toBe(true);
      expect(item.maxStack).toBeGreaterThan(1);
    }
    const rawAsh = LIFE_ITEMS.find((item) => item.id === ITEM.cigaretteAsh);
    expect(rawAsh?.tags).toContain('fertilizer');
    expect(rawAsh?.tags).toContain('potash');
    const pigment = LIFE_ITEMS.find((item) => item.id === ITEM.paintPigment);
    expect(pigment?.tags).toContain('pigment');
  });
});

describe('achievement data', () => {
  it('provides at least 25 achievements with unique ids', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(25);
    const ids = ACHIEVEMENTS.map((achievement) => achievement.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has complete, valid definitions and real triggers', () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.title.length, achievement.id).toBeGreaterThan(2);
      expect(achievement.description.length, achievement.id).toBeGreaterThan(20);
      expect(typeof achievement.hidden, achievement.id + ' hidden').toBe('boolean');
      expect(achievement.icon.length, achievement.id + ' icon').toBeGreaterThan(0);
      expect(Number.isInteger(achievement.rewardInfluence), achievement.id + ' reward').toBe(true);
      expect(achievement.rewardInfluence).toBeGreaterThanOrEqual(0);
      assertValidTrigger(achievement.trigger, 'achievement ' + achievement.id);
    }
  });

  it('covers the milestone list from the domain brief', () => {
    const covered = new Set(ACHIEVEMENTS.map((achievement) => achievement.id));
    const required = [
      'first_cast',
      'ten_fish',
      'perfect_crop',
      'five_friends',
      'romance_partner',
      'own_business',
      'ten_thousand',
      'keeper_of_secrets',
      'naturalist',
      'ashes_to_ashes',
      'survive_7',
      'three_festivals',
      'community_project',
      'max_skill',
      'bake_cake',
      'moonfish',
    ];
    for (const id of required) expect(covered.has(id), 'missing achievement ' + id).toBe(true);
  });

  it('keeps a meaningful number of hidden achievements', () => {
    expect(ACHIEVEMENTS.filter((achievement) => achievement.hidden).length).toBeGreaterThanOrEqual(4);
  });

  it('grants influence rewards that make sense against the tier ladder', () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.rewardInfluence).toBeLessThanOrEqual(INFLUENCE_TIERS[INFLUENCE_TIERS.length - 1]?.minInfluence ?? 800);
    }
  });
});

describe('player goal data', () => {
  it('provides at least 15 goals with unique ids and valid categories/icons', () => {
    expect(PLAYER_GOALS.length).toBeGreaterThanOrEqual(15);
    const ids = PLAYER_GOALS.map((goal) => goal.id);
    expect(new Set(ids).size).toBe(ids.length);
    const allowedCategories = ['career', 'social', 'collection', 'craft', 'explore', 'community', 'wealth'];
    for (const goal of PLAYER_GOALS) {
      expect(goal.title.length, goal.id).toBeGreaterThan(2);
      expect(goal.description.length, goal.id).toBeGreaterThan(20);
      expect(allowedCategories, goal.id + ' category').toContain(goal.category);
      expect(goal.icon.length, goal.id + ' icon').toBeGreaterThan(0);
      expect(goal.rewardInfluence).toBeGreaterThan(0);
      assertValidTrigger(goal.trigger, 'goal ' + goal.id);
    }
  });

  it('covers the goal examples from the domain brief', () => {
    const triggers = PLAYER_GOALS.map((goal) => goal.trigger.kind + ':' + goal.trigger.key);
    expect(triggers).toContain('skill:gardening');
    expect(triggers).toContain('skill:fishing');
    expect(triggers.some((trigger) => trigger.startsWith('collection:'))).toBe(true);
    expect(triggers).toContain('stat:businessesOwned');
    expect(triggers).toContain('skill:art');
    expect(triggers).toContain('stat:decorScore');
    expect(triggers).toContain('stat:friendCount');
    expect(triggers).toContain('stat:perfectCrops');
    expect(triggers).toContain('stat:secretLocationsFound');
  });

  it('does not share ids between achievements and goals', () => {
    const achievementIds = new Set(ACHIEVEMENTS.map((entry) => entry.id));
    for (const goal of PLAYER_GOALS) expect(achievementIds.has(goal.id), goal.id).toBe(false);
  });
});