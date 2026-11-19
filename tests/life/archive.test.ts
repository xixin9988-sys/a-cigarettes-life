import { describe, expect, it } from 'vitest';
import type { LifeArchiveEntry, WorldEvent } from '../../src/core/contracts';
import { ITEM } from '../../src/data/items/ids';
import { HOME_INTERIOR_ID, LOC } from '../../src/data/locations/ids';
import { makeFishDef, makeItemDef, createHarness, createTestPack, moveTo, advance } from './helpers';

function makeWorldEvent(overrides: Partial<WorldEvent> = {}): WorldEvent {
  return {
    id: 'evt_test_1',
    type: 'test_event',
    category: 'interesting',
    title: 'A test event',
    description: 'Something interesting happened in the square.',
    createdAt: 100,
    occurredAt: 100,
    participants: [],
    cause: [],
    result: {},
    importance: 3,
    archived: false,
    acknowledged: false,
    ...overrides,
  };
}

function makePack() {
  return createTestPack({
    fish: [makeFishDef({ id: 'fish_trout', name: 'Trout', maxSizeCm: 50 })],
    extraItems: [
      makeItemDef({ id: 'test_memento', name: 'Test Memento', tags: ['collectible', 'memento'], rarity: 5 }),
      makeItemDef({ id: 'test_common', name: 'Test Common', tags: [], rarity: 1 }),
    ],
  });
}

function createArchiveHarness() {
  const harness = createHarness({ pack: makePack() });
  moveTo(harness, HOME_INTERIOR_ID, true);
  return harness;
}

describe('LifeArchiveSystem', () => {
  it('archives the first catch of a species and records sizes of prize catches', () => {
    const harness = createArchiveHarness();
    const archiveEvents = [] as LifeArchiveEntry[];
    harness.bus.on('life:archive', (payload) => archiveEvents.push(payload.entry));

    harness.bus.emit('fish:caught', { fishId: 'fish_trout', sizeCm: 20, quality: 2 });
    const entries = harness.life.getArchive();
    expect(entries.length).toBe(1);
    expect(entries[0]?.title).toBe('First Trout');
    expect(entries[0]?.category).toBe('collection');
    expect(entries[0]?.importance).toBe(4);
    expect(archiveEvents.length).toBe(1);

    // A second, unremarkable trout is not life-archive material.
    harness.bus.emit('fish:caught', { fishId: 'fish_trout', sizeCm: 22, quality: 2 });
    expect(harness.life.getArchive().length).toBe(1);

    // A prize-sized or excellent trout is.
    harness.bus.emit('fish:caught', { fishId: 'fish_trout', sizeCm: 48, quality: 5 });
    const entriesAfter = harness.life.getArchive();
    expect(entriesAfter.length).toBe(2);
    expect(entriesAfter[1]?.title).toBe('A fine Trout');
    expect(entriesAfter[1]?.description).toContain('48.0 cm');
  });

  it('archives perfect crops and ignores ordinary ones', () => {
    const harness = createArchiveHarness();
    harness.bus.emit('crop:harvested', { cropId: 'crop_turnip', quality: 3, quantity: 2 });
    expect(harness.life.getArchive().length).toBe(0);
    harness.bus.emit('crop:harvested', { cropId: 'crop_turnip', quality: 5, quantity: 2 });
    const entries = harness.life.getArchive();
    // The perfect crop is archived, and the achievement it unlocks is archived too.
    expect(entries[0]?.title).toContain('perfect');
    expect(entries.some((entry) => entry.category === 'collection')).toBe(true);
    expect(entries.some((entry) => entry.title.startsWith('Achievement:'))).toBe(true);
  });

  it('archives major relationship milestones once per status', () => {
    const harness = createArchiveHarness();
    harness.bus.emit('relationship:changed', {
      npcId: 'npc_marigold_lyle',
      kind: 'chat',
      affinity: 40,
      trust: 35,
      intimacy: 20,
      status: 'friend',
    });
    expect(harness.life.getArchive().map((entry) => entry.title)).toEqual([
      'Became friends with npc_marigold_lyle',
    ]);
    // Same status events (every friendly chat) do not spam the chronicle.
    harness.bus.emit('relationship:changed', {
      npcId: 'npc_marigold_lyle',
      kind: 'chat',
      affinity: 41,
      trust: 36,
      intimacy: 21,
      status: 'friend',
    });
    expect(harness.life.getArchive().length).toBe(1);
    harness.bus.emit('relationship:changed', {
      npcId: 'npc_marigold_lyle',
      kind: 'date',
      affinity: 70,
      trust: 60,
      intimacy: 60,
      status: 'partner',
    });
    const entries = harness.life.getArchive();
    expect(entries.length).toBe(2);
    expect(entries[1]?.importance).toBe(5);
  });

  it('archives events only when important enough, with the real event data', () => {
    const harness = createArchiveHarness();
    harness.bus.emit('event:occurred', { event: makeWorldEvent({ importance: 2 }) });
    expect(harness.life.getArchive().length).toBe(0);
    harness.bus.emit('event:occurred', {
      event: makeWorldEvent({ id: 'evt_test_2', importance: 4, title: 'Storm over the square', occurredAt: 500 }),
    });
    const entries = harness.life.getArchive();
    expect(entries.length).toBe(1);
    expect(entries[0]?.title).toBe('Storm over the square');
    expect(entries[0]?.category).toBe('event');
    expect(entries[0]?.at).toBe(500);
    expect(entries[0]?.importance).toBe(4);
  });

  it('archives discoveries, festivals, achievements, goals and rare finds', () => {
    const harness = createArchiveHarness();
    harness.bus.emit('discovery:made', {
      kind: 'secret',
      id: 'secret_1',
      description: 'Found a hidden garden gate behind the hedge.',
    });
    harness.bus.emit('festival:participated', { festivalId: 'fest_spring_flowers', activityId: 'flower_show', result: 'second place' });
    harness.bus.emit('achievement:unlocked', { achievementId: 'first_cast', title: 'First Catch' });
    harness.bus.emit('goal:completed', { goalId: 'goal_avid_collector', title: 'An Avid Collector' });
    harness.bus.emit('item:acquired', { itemId: 'test_memento', quantity: 1, quality: 1, source: 'test' });
    // Common items are not chronicled.
    harness.bus.emit('item:acquired', { itemId: 'test_common', quantity: 5, quality: 1, source: 'test' });
    const entries = harness.life.getArchive();
    expect(entries.length).toBe(5);
    expect(entries.map((entry) => entry.category)).toEqual([
      'exploration',
      'event',
      'milestone',
      'milestone',
      'collection',
    ]);
    expect(entries[2]?.title).toContain('First Catch');
    expect(entries[3]?.importance).toBe(5);
    // Re-acquiring the same rare item does not duplicate the entry.
    harness.bus.emit('item:acquired', { itemId: 'test_memento', quantity: 1, quality: 1, source: 'test' });
    expect(harness.life.getArchive().length).toBe(5);
  });

  it('archives level milestones from game:signal but ignores unrelated signals', () => {
    const harness = createArchiveHarness();
    harness.bus.emit('game:signal', { name: 'skill:levelup', data: { skill: 'fishing', level: 3 } });
    expect(harness.life.getArchive().length).toBe(0);
    harness.bus.emit('game:signal', { name: 'skill:levelup', data: { skill: 'fishing', level: 5 } });
    harness.bus.emit('game:signal', { name: 'unrelated:signal', data: { foo: 'bar' } });
    const entries = harness.life.getArchive();
    expect(entries.length).toBe(1);
    expect(entries[0]?.title).toBe('Fishing level 5');
    expect(entries[0]?.category).toBe('milestone');
  });

  it('rejects entries below the configured importance threshold', () => {
    const harness = createArchiveHarness();
    const archive = harness.life.getArchiveSystem();
    if (!archive) throw new Error('archive missing');
    const low = archive.recordLifeEvent({
      category: 'daily',
      title: 'A quiet afternoon',
      description: 'Nothing much happened.',
      importance: 2,
    });
    expect(low).toBeNull();
    expect(harness.life.getArchive().length).toBe(0);
    const high = archive.recordLifeEvent({
      category: 'milestone',
      title: 'A real milestone',
      description: 'Something worth remembering really happened.',
      importance: 3,
    });
    expect(high).not.toBeNull();
    expect(harness.life.getArchive().length).toBe(1);
    expect(harness.life.getArchive()[0]?.at).toBe(harness.clock.simTimeSeconds);
  });

  it('caps the archive at 400 entries and lets important entries displace filler', () => {
    const harness = createArchiveHarness();
    const archive = harness.life.getArchiveSystem();
    if (!archive) throw new Error('archive missing');
    for (let index = 0; index < 410; index += 1) {
      archive.recordLifeEvent({
        category: 'daily',
        title: 'Filler ' + index,
        description: 'Routine record number ' + index + '.',
        importance: 3,
      });
    }
    expect(harness.life.getArchive().length).toBe(400);
    const big = archive.recordLifeEvent({
      category: 'milestone',
      title: 'The one that matters',
      description: 'A genuinely important event recorded after the archive filled up.',
      importance: 9,
    });
    expect(big).not.toBeNull();
    expect(harness.life.getArchive().length).toBe(400);
    expect(harness.life.getArchive().some((entry) => entry.title === 'The one that matters')).toBe(true);
    // A low-importance entry cannot displace anything once the archive is full.
    const filler = archive.recordLifeEvent({
      category: 'daily',
      title: 'More filler',
      description: 'This should be rejected because the archive is full of more important things.',
      importance: 3,
    });
    expect(filler).toBeNull();
  });

  it('does not archive events after the life has ended', () => {
    const harness = createArchiveHarness();
    harness.life.endLife('test end');
    const before = harness.life.getArchive().length;
    harness.bus.emit('achievement:unlocked', { achievementId: 'late', title: 'Too Late' });
    harness.bus.emit('fish:caught', { fishId: 'fish_trout', sizeCm: 50, quality: 5 });
    expect(harness.life.getArchive().length).toBe(before);
    void ITEM;
    void LOC;
    advance(harness, 60);
  });
});
