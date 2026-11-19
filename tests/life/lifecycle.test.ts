import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../../src/core/WorldFactory';
import { ITEM } from '../../src/data/items/ids';
import { HOME_INTERIOR_ID, LOC } from '../../src/data/locations/ids';
import type { LetterState } from '../../src/core/contracts';
import {
  advance,
  advanceInSteps,
  collectEvents,
  createHarness,
  giveItem,
  moveTo,
} from './helpers';

function makeLetter(id: string, fromNpcId: string | null = null): LetterState {
  return {
    id,
    fromNpcId,
    subject: 'Test letter',
    body: 'Dear Ash,\n\nThe weather is fine. Come by soon.',
    sentAt: 100,
    read: false,
    attachments: [],
  };
}

describe('LifeSystem lifecycle', () => {
  it('ends the life when the body reaches zero and emits life:ended exactly once', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    const ended = collectEvents(harness, 'life:ended');
    advanceInSteps(harness, 16 * 1440, 60);
    expect(harness.state.life.phase).toBe('ended');
    expect(harness.state.player.cigarette.lengthRatio).toBe(0);
    expect(harness.state.life.endReason).toBeTruthy();
    expect(harness.state.life.endedAt).not.toBeNull();
    expect(harness.state.player.lifeProgress).toBe(1);
    expect(ended.length).toBe(1);
    expect(ended[0]?.lifeId).toBe(harness.state.life.lifeId);
    // The update loop must not keep ageing a finished life.
    const ageAfterEnd = harness.state.life.ageDays;
    advance(harness, 1440);
    expect(harness.state.life.ageDays).toBe(ageAfterEnd);
  });

  it('exposes the life-ending API idempotently with a real reason', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    const ended = collectEvents(harness, 'life:ended');
    const first = harness.life.endLife('Snuffed out by a sudden gust.');
    expect(first.ok).toBe(true);
    expect(harness.state.life.phase).toBe('ended');
    expect(harness.state.life.endReason).toBe('Snuffed out by a sudden gust.');
    expect(ended.length).toBe(1);

    const second = harness.life.endLife('Again?');
    expect(second.ok).toBe(false);
    expect(second.code).toBe('not_allowed');
    expect(ended.length).toBe(1);
    expect(harness.life.endLife('x').ok).toBe(false);
  });

  it('does not review a life that is still burning, but reviews a real one honestly', () => {
    const harness = createHarness({ playerName: 'Smokey' });
    moveTo(harness, HOME_INTERIOR_ID, true);
    expect(harness.life.getLifeReview()).toBeNull();
    expect(harness.life.buildArchivedLife()).toBeNull();

    advanceInSteps(harness, 3 * 1440, 60);
    harness.life.endLife('A test ending.');
    const review = harness.life.getLifeReview();
    expect(review).not.toBeNull();
    if (!review) throw new Error('expected review');
    expect(review.name).toBe('Smokey');
    expect(review.lifeId).toBe(harness.state.life.lifeId);
    expect(review.generation).toBe(1);
    expect(review.durationDays).toBeCloseTo(harness.state.life.ageDays, 1);
    expect(review.endReason).toBe('A test ending.');
    expect(review.finalMoney).toBe(harness.state.player.money);
    expect(review.residenceName).toBe('Home Cottage');
    // Honesty: no relationships and no collection -> empty records, not invented ones.
    expect(review.importantPeople).toEqual([]);
    expect(review.collections).toEqual([]);
    expect(review.photos).toEqual([]);
    expect(review.letters).toEqual([]);
    expect(review.skills.gardening).toBe(harness.state.player.skills.gardening?.level);
    // The world history entry created at world start is real and important enough to keep.
    expect(review.worldChanges.length).toBeGreaterThanOrEqual(1);
    expect(review.statistics.daysLived).toBe(harness.state.player.statistics.daysLived);
    // ... and the same review is in the persistent archive.
    expect(harness.state.archive.some((entry) => entry.lifeId === review.lifeId)).toBe(true);
    expect(harness.life.getLifeReview()).toBe(review);
  });

  it('closes a life whose saved body is already spent when the system wakes up', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    harness.state.player.cigarette.lengthRatio = 0;
    advance(harness, 1);
    expect(harness.state.life.phase).toBe('ended');
    expect(harness.state.life.endedAt).not.toBeNull();
    expect(harness.life.getLifeReview()).not.toBeNull();
  });

  it('records a real death entry in the life archive', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    harness.life.endLife('Burned down to the filter.');
    const deathEntries = harness.state.life.archive.filter((entry) => entry.category === 'death');
    expect(deathEntries.length).toBe(1);
    expect(deathEntries[0]?.importance).toBe(10);
    expect(deathEntries[0]?.description).toContain('Burned down to the filter.');
  });

  it('reads letters that arrive on the bus and marks them read once', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    harness.bus.emit('letter:received', { letter: makeLetter('letter_test_1', 'npc_marigold_lyle') });
    expect(harness.state.life.letters.some((letter) => letter.id === 'letter_test_1')).toBe(true);
    const read = harness.life.readLetter('letter_test_1');
    expect(read.ok).toBe(true);
    expect(harness.state.life.letters.find((letter) => letter.id === 'letter_test_1')?.read).toBe(true);
    const second = harness.life.readLetter('letter_test_1');
    expect(second.ok).toBe(true);
    expect(second.stateChanged).toBe(false);
    const missing = harness.life.readLetter('nope');
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe('not_found');
    // The letter is chronicled.
    expect(harness.state.life.archive.some((entry) => entry.title.includes('letter'))).toBe(true);
  });

  it('warms up by a heat source or a carried warmer, with a cooldown', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    harness.state.player.cigarette.moisture = 0.6;
    const first = harness.life.warmUp('heat_source');
    expect(first.ok).toBe(true);
    expect(harness.state.player.cigarette.moisture).toBeCloseTo(0.38, 9);
    const immediate = harness.life.warmUp('heat_source');
    expect(immediate.ok).toBe(false);
    expect(immediate.code).toBe('on_cooldown');
    advance(harness, 60);
    harness.state.player.cigarette.moisture = 0.5;
    expect(harness.life.warmUp('heat_source').ok).toBe(true);

    // No fire at the river: the heat-source action must fail honestly.
    const outdoor = createHarness();
    moveTo(outdoor, LOC.river, false);
    outdoor.state.player.cigarette.moisture = 0.5;
    const noFire = outdoor.life.warmUp('heat_source');
    expect(noFire.ok).toBe(false);
    expect(noFire.code).toBe('not_allowed');

    // Carried care items work anywhere, provided you really carry them.
    const cold = createHarness();
    moveTo(cold, LOC.river, false);
    cold.state.player.cigarette.moisture = 0.5;
    expect(cold.life.warmUp(ITEM.handWarmer).ok).toBe(false);
    giveItem(cold, ITEM.handWarmer);
    expect(cold.life.warmUp(ITEM.handWarmer).ok).toBe(true);
    advance(cold, 60);
    cold.state.player.cigarette.moisture = 0.5;
    giveItem(cold, ITEM.desiccantPack);
    expect(cold.life.warmUp(ITEM.desiccantPack).ok).toBe(true);
    advance(cold, 60);
    cold.state.player.cigarette.moisture = 0.4;
    expect(cold.life.warmUp('nonsense').code).toBe('invalid');
    cold.state.player.cigarette.moisture = 0;
    expect(cold.life.warmUp('heat_source').code).toBe('requirement_not_met');
  });

  it('customises appearance with validation and rejects bad input', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    const signals = collectEvents(harness, 'game:signal');
    const good = {
      ...DEFAULT_APPEARANCE,
      bodyColor: '#AABBCC',
      filterColor: '#123456',
      face: 'wink' as const,
      pattern: 'dots' as const,
      accessory: 'red ribbon',
    };
    const result = harness.life.customizeAppearance(good);
    expect(result.ok).toBe(true);
    expect(harness.state.player.appearance.bodyColor).toBe('#aabbcc');
    expect(harness.state.player.appearance.pattern).toBe('dots');
    expect(signals.some((signal) => signal.name === 'player:appearance_changed')).toBe(true);

    const bad = harness.life.customizeAppearance({ ...good, bodyColor: 'not-a-colour' });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('invalid');
    expect(harness.state.player.appearance.bodyColor).toBe('#aabbcc');

    const badFace = harness.life.customizeAppearance({ ...good, face: 'angry' as never });
    expect(badFace.ok).toBe(false);
    harness.life.endLife('test');
    expect(harness.life.customizeAppearance(good).ok).toBe(false);
  });

  it('sanity-checks identity helpers', () => {
    const harness = createHarness({ playerName: '   ' });
    expect(harness.life.getIdentity().getDisplayName(harness.state)).toBe('Ash');
    harness.state.player.name = 'Smokey';
    harness.state.player.occupation = 'Gardener';
    expect(harness.life.getIdentity().getTitle(harness.state)).toBe('Smokey the Gardener');
    harness.state.player.occupation = null;
    expect(harness.life.getIdentity().getTitle(harness.state)).toBe('Smokey, Wanderer');
    const description = harness.life.getIdentity().describeAppearance(harness.state.player.appearance);
    expect(description.length).toBeGreaterThan(10);
  });

  it('keeps daysLived and lifeProgress in sync with the burn state', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    advanceInSteps(harness, 2 * 1440, 60);
    expect(harness.state.player.statistics.daysLived).toBe(2);
    expect(harness.state.player.lifeProgress).toBeCloseTo(
      1 - harness.state.player.cigarette.lengthRatio,
      9
    );
    advanceInSteps(harness, 1 * 1440, 60);
    expect(harness.state.player.statistics.daysLived).toBe(3);
  });

  it('writes occasional friendly letters through the player.opportunities stream', () => {
    let totalLetters = 0;
    let sampleBody = '';
    let sampleFrom: string | null = null;
    // The letter roll is probabilistic; across several deterministic seeds at least one
    // life must receive a letter from its friend (same seed => same result).
    for (let seed = 1; seed <= 8; seed += 1) {
      const harness = createHarness({ seed });
      moveTo(harness, HOME_INTERIOR_ID, true);
      harness.state.player.relationships['npc_test_friend'] = {
        otherId: 'npc_test_friend',
        affinity: 70,
        trust: 60,
        intimacy: 40,
        familiarity: 80,
        status: 'friend',
        firstMetAt: 0,
        lastInteractionAt: 0,
        interactionCount: 10,
        flags: [],
        cooldowns: {},
      };
      const received = collectEvents(harness, 'letter:received');
      advanceInSteps(harness, 30 * 1440, 60);
      totalLetters += received.length;
      for (const payload of received) {
        const letter = payload.letter;
        expect(letter.fromNpcId).toBe('npc_test_friend');
        expect(letter.body.length).toBeGreaterThan(30);
        expect(letter.read).toBe(false);
        expect(harness.state.life.letters.some((stored) => stored.id === letter.id)).toBe(true);
        sampleBody = letter.body;
        sampleFrom = letter.fromNpcId;
      }
    }
    expect(totalLetters).toBeGreaterThan(0);
    expect(sampleBody.length).toBeGreaterThan(30);
    expect(sampleFrom).toBe('npc_test_friend');
  });
});
