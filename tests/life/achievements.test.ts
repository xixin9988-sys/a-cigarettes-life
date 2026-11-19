import { describe, expect, it } from 'vitest';
import { ITEM } from '../../src/data/items/ids';
import { HOME_INTERIOR_ID } from '../../src/data/locations/ids';
import { readLifeExtras, writeLifeExtras } from '../../src/life/lifeShared';
import { addRelationship, advance, createHarness, moveTo, setCounters, setSkillLevel } from './helpers';

function advanceHour(harness: ReturnType<typeof createHarness>): void {
  advance(harness, 60);
}

function influenceOf(harness: ReturnType<typeof createHarness>): number {
  return harness.state.player.influence;
}

describe('AchievementSystem', () => {
  it('starts with no unlocked achievements and exposes every definition', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    const all = harness.life.getAchievements();
    expect(all.length).toBeGreaterThanOrEqual(25);
    expect(all.every((entry) => entry.state === null)).toBe(true);
    expect(all.some((entry) => entry.def.hidden)).toBe(true);
    const progress = harness.life.getAchievementSystem()?.getProgressList() ?? [];
    expect(progress.length).toBe(all.length);
    expect(progress.every((entry) => entry.progress >= 0)).toBe(true);
  });

  it('unlocks a stat achievement once, rewards influence and is archived', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    const unlocked = [] as { achievementId: string; title: string }[];
    harness.bus.on('achievement:unlocked', (payload) => unlocked.push(payload));
    harness.state.player.statistics.fishCaught = 1;
    advanceHour(harness);
    expect(unlocked.length).toBe(1);
    expect(unlocked[0]?.achievementId).toBe('first_cast');
    const state = harness.life.getAchievements().find((entry) => entry.def.id === 'first_cast');
    expect(state?.state?.unlockedAt).toBe(harness.clock.simTimeSeconds);
    expect(influenceOf(harness)).toBe(3);
    expect(harness.state.player.communityPoints).toBe(15);
    expect(harness.life.getArchive().some((entry) => entry.title === 'Achievement: First Catch')).toBe(true);

    advanceHour(harness);
    advanceHour(harness);
    expect(harness.life.getAchievements().filter((entry) => entry.state !== null).length).toBe(1);
    expect(influenceOf(harness)).toBe(3);
  });

  it('unlocks multiple thresholds in one check when the statistic already qualifies', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    harness.state.player.statistics.fishCaught = 10;
    advanceHour(harness);
    const ids = harness.life.getAchievements().flatMap((entry) => (entry.state ? [entry.def.id] : []));
    expect(ids).toContain('first_cast');
    expect(ids).toContain('ten_fish');
  });

  it('counts friendships and romance from relationship state', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    for (let index = 1; index <= 5; index += 1) {
      addRelationship(harness, 'npc_friend_' + index, 'friend', 50);
    }
    addRelationship(harness, 'npc_partner', 'partner', 80);
    addRelationship(harness, 'npc_close', 'close_friend', 70);
    advanceHour(harness);
    const ids = harness.life.getAchievements().flatMap((entry) => (entry.state ? [entry.def.id] : []));
    expect(ids).toContain('five_friends');
    expect(ids).toContain('romance_partner');
    expect(ids).toContain('close_confidant');
  });

  it('tracks perfect crops and cakes through bus events, and ash use through inventory deltas', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    harness.bus.emit('crop:harvested', { cropId: 'crop_turnip', quality: 5, quantity: 1 });
    expect(readLifeExtras(harness.state).counters.perfectCrops).toBe(1);
    expect(harness.life.getAchievements().some((entry) => entry.def.id === 'perfect_crop' && entry.state)).toBe(true);

    harness.bus.emit('item:acquired', { itemId: ITEM.strawberryCake, quantity: 1, quality: 3, source: 'test' });
    expect(readLifeExtras(harness.state).counters.cakesBaked).toBe(1);
    expect(harness.life.getAchievements().some((entry) => entry.def.id === 'bake_cake' && entry.state)).toBe(true);

    setCounters(harness, (counters) => {
      counters.ashUsed = 50;
    });
    advanceHour(harness);
    expect(harness.life.getAchievements().some((entry) => entry.def.id === 'ashes_to_ashes' && entry.state)).toBe(true);
  });

  it('unlocks collection, moonfish, skill and wealth achievements from real state', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    for (let index = 0; index < 20; index += 1) {
      harness.state.collection.entries['item_' + index] = {
        itemId: 'item_' + index,
        firstCollectedAt: 0,
        count: 1,
        bestQuality: 2,
        donated: false,
      };
    }
    harness.state.player.statistics.fishSpeciesCaught['fish_moonfish'] = 1;
    setSkillLevel(harness, 'art', 20);
    harness.bus.emit('game:signal', { name: 'skill:levelup', data: { skill: 'art', level: 20 } });
    harness.state.player.money = 100000;
    harness.bus.emit('money:changed', { amount: 100000, balance: 100000, reason: 'test' });
    harness.state.player.statistics.moneyEarned = 10000;
    advanceHour(harness);
    const ids = harness.life.getAchievements().flatMap((entry) => (entry.state ? [entry.def.id] : []));
    expect(ids).toContain('naturalist');
    expect(ids).toContain('moonfish');
    expect(ids).toContain('max_skill');
    expect(ids).toContain('comfortable');
    expect(ids).toContain('ten_thousand');
  });

  it('keeps influence and community points consistent with reward influence', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    harness.state.player.statistics.fishCaught = 10;
    advanceHour(harness);
    const earned = harness.state.player.influence;
    expect(earned).toBe(8);
    expect(harness.state.player.communityPoints).toBe(40);
    const snapshot = harness.life.getInfluenceSnapshot();
    expect(snapshot?.influence).toBe(8);
    expect(snapshot?.tier.id).toBe('new_resident');
    expect(harness.life.getAchievementSystem()?.isUnlocked('first_cast')).toBe(true);
    expect(harness.life.getAchievementSystem()?.getUnlocked().length).toBeGreaterThanOrEqual(2);
    // counts persisted in player.extras survive a save/load style round-trip of the extras bag
    const extras = readLifeExtras(harness.state);
    const copy = JSON.parse(JSON.stringify(extras)) as typeof extras;
    writeLifeExtras(harness.state, copy);
    expect(readLifeExtras(harness.state).counters.perfectCrops).toBe(extras.counters.perfectCrops);
  });
});
