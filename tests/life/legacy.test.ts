import { describe, expect, it } from 'vitest';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import { HOME_INTERIOR_ID, LOC } from '../../src/data/locations/ids';
import { addRelationship, advance, collectEvents, createHarness, createTestPack, makeItemDef, moveTo } from './helpers';
import type { ArchivedLife } from '../../src/core/contracts';

function makeLegacyPack() {
  return createTestPack({
    extraItems: [
      makeItemDef({ id: 'test_locket', name: 'Silver Locket', tags: ['collectible', 'memento'], rarity: 4 }),
      makeItemDef({ id: 'test_photo', name: 'Pressed Photo', tags: ['memorabilia', 'photo'], rarity: 3 }),
      makeItemDef({ id: 'test_common', name: 'Plain Stone', tags: [], rarity: 1 }),
    ],
  });
}

function finishLife(harness: ReturnType<typeof createHarness>): ArchivedLife {
  harness.life.endLife('A quiet ending.');
  const review = harness.life.getLifeReview();
  if (!review) throw new Error('expected archived life');
  return review;
}

describe('GenerationSystem - life review and legacy', () => {
  it('produces no review for a living cigarette', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    const generation = harness.life.getGenerationSystem();
    if (!generation) throw new Error('generation missing');
    expect(generation.buildArchivedLife(harness.state)).toBeNull();
  });

  it('builds the review from real records only', () => {
    const harness = createHarness({ pack: makeLegacyPack(), playerName: 'Ember' });
    moveTo(harness, HOME_INTERIOR_ID, true);
    harness.state.player.occupation = 'Florist';
    harness.state.player.money = 12345;
    harness.state.collection.entries['test_locket'] = {
      itemId: 'test_locket',
      firstCollectedAt: 0,
      count: 1,
      bestQuality: 3,
      donated: false,
    };
    addRelationship(harness, 'npc_marigold_lyle', 'friend', 55);
    addRelationship(harness, 'npc_otto_bramwell', 'acquaintance', 10);
    harness.state.life.archive.push({
      id: 'arch_existing',
      at: 100,
      category: 'choice',
      title: 'Chose to keep the old shop open',
      description: 'A choice that mattered.',
      importance: 3,
      participantIds: [],
    });
    harness.life.readLetter('missing');
    harness.bus.emit('letter:received', {
      letter: {
        id: 'letter_review',
        fromNpcId: 'npc_marigold_lyle',
        subject: 'A note',
        body: 'Hello.',
        sentAt: 50,
        read: false,
        attachments: [],
      },
    });
    advance(harness, 60);
    const review = finishLife(harness);
    expect(review.name).toBe('Ember');
    expect(review.occupation).toBe('Florist');
    expect(review.finalMoney).toBe(12345);
    expect(review.residenceName).toBe('Home Cottage');
    expect(review.collections).toEqual([{ itemId: 'test_locket', count: 1 }]);
    // Only genuinely important relationships (affinity >= 20 / major status) appear.
    expect(review.importantPeople.length).toBe(1);
    expect(review.importantPeople[0]?.npcId).toBe('npc_marigold_lyle');
    expect(review.importantPeople[0]?.status).toBe('friend');
    expect(review.archive.some((entry) => entry.title === 'Chose to keep the old shop open')).toBe(true);
    expect(review.letters.length).toBe(1);
    expect(review.choices).toContain('Chose to keep the old shop open');
    // World changes are only importance >= 4 world history entries.
    for (const change of review.worldChanges) expect(change.length).toBeGreaterThan(0);
    expect(review.worldChanges.length).toBeGreaterThanOrEqual(1);
    // Reviews never contain invented business records.
    expect(review.businessHistory).toEqual([]);
    expect(review.statistics.daysLived).toBe(harness.state.player.statistics.daysLived);
  });

  it('offers at most three real mementos to inherit', () => {
    const harness = createHarness({ pack: makeLegacyPack() });
    moveTo(harness, HOME_INTERIOR_ID, true);
    harness.state.collection.entries['test_locket'] = {
      itemId: 'test_locket',
      firstCollectedAt: 0,
      count: 1,
      bestQuality: 3,
      donated: false,
    };
    harness.state.collection.entries['test_photo'] = {
      itemId: 'test_photo',
      firstCollectedAt: 0,
      count: 2,
      bestQuality: 2,
      donated: false,
    };
    harness.state.collection.entries['test_common'] = {
      itemId: 'test_common',
      firstCollectedAt: 0,
      count: 5,
      bestQuality: 1,
      donated: false,
    };
    const review = finishLife(harness);
    const options = harness.life.getLegacyOptions(review);
    expect(options.length).toBeLessThanOrEqual(WORLD_CONFIG.life.maxLegacyItems);
    expect(options.length).toBeGreaterThan(0);
    expect(options.map((option) => option.itemId)).toContain('test_locket');
    expect(options.map((option) => option.itemId)).not.toContain('test_common');
    const locket = options.find((option) => option.itemId === 'test_locket');
    expect(locket?.name).toBe('Silver Locket');
  });

  it('applies at most three legacy items to a new life with legacy metadata', () => {
    const pack = createTestPack({
      extraItems: [
        makeItemDef({ id: 'legacy_a', name: 'Keep A', tags: ['memento'], rarity: 3 }),
        makeItemDef({ id: 'legacy_b', name: 'Keep B', tags: ['memento'], rarity: 3 }),
        makeItemDef({ id: 'legacy_c', name: 'Keep C', tags: ['memento'], rarity: 3 }),
        makeItemDef({ id: 'legacy_d', name: 'Keep D', tags: ['memento'], rarity: 3 }),
      ],
    });
    const harness = createHarness({ pack });
    moveTo(harness, HOME_INTERIOR_ID, true);
    const acquired = collectEvents(harness, 'item:acquired');
    const signals = collectEvents(harness, 'game:signal');
    harness.life.applyLegacyItems(harness.state, ['legacy_a', 'legacy_b', 'legacy_c', 'legacy_d', 'unknown_item']);
    const entries = harness.state.player.inventory.filter((entry) => entry.itemId.startsWith('legacy_'));
    expect(entries.length).toBe(WORLD_CONFIG.life.maxLegacyItems);
    for (const entry of entries) {
      expect(entry.meta?.['legacy']).toBe(true);
      expect(entry.meta?.['inheritedFromGeneration']).toBe(1);
    }
    expect(harness.state.life.legacyItemIds).toEqual(['legacy_a', 'legacy_b', 'legacy_c']);
    expect(acquired.filter((event) => event.source === 'legacy').length).toBe(3);
    expect(signals.some((signal) => signal.name === 'life:legacy_applied')).toBe(true);
    // Applying twice never duplicates items.
    harness.life.applyLegacyItems(harness.state, ['legacy_a']);
    expect(harness.state.player.inventory.filter((entry) => entry.itemId === 'legacy_a').length).toBe(1);
    expect(harness.state.life.legacyItemIds.length).toBe(3);
  });

  it('records chosen legacy items on the archived previous life', () => {
    const pack = createTestPack({
      extraItems: [makeItemDef({ id: 'legacy_heirloom', name: 'Heirloom', tags: ['memento'], rarity: 4 })],
    });
    const harness = createHarness({ pack });
    moveTo(harness, HOME_INTERIOR_ID, true);
    const review = finishLife(harness);
    expect(review.legacyItemIds).toEqual([]);
    harness.life.applyLegacyItems(harness.state, ['legacy_heirloom']);
    const stored = harness.state.archive.find((entry) => entry.lifeId === review.lifeId);
    expect(stored?.legacyItemIds).toEqual(['legacy_heirloom']);
    void LOC;
  });
});
