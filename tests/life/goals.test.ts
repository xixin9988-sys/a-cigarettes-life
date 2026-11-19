import { describe, expect, it } from 'vitest';
import { HOME_INTERIOR_ID } from '../../src/data/locations/ids';
import { readLifeExtras } from '../../src/life/lifeShared';
import { PLAYER_GOALS } from '../../src/data/goals/goals';
import { advance, advanceInSteps, collectEvents, createHarness, moveTo } from './helpers';

describe('LifeSystem personal goals', () => {
  it('offers every data-driven goal and starts with none chosen', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    const available = harness.life.getAvailableGoals();
    expect(available.length).toBe(PLAYER_GOALS.length);
    expect(harness.life.getPersonalGoal()).toBeNull();
    expect(harness.life.getPersonalGoalDef()).toBeNull();
  });

  it('chooses a goal, persists it, archives the choice and rejects unknown goals', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    const chosen = harness.life.choosePersonalGoal('goal_avid_collector');
    expect(chosen.ok).toBe(true);
    const goal = harness.life.getPersonalGoal();
    expect(goal?.id).toBe('goal_avid_collector');
    expect(goal?.target).toBe(25);
    expect(goal?.progress).toBe(0);
    expect(goal?.completedAt).toBeNull();
    expect(readLifeExtras(harness.state).personalGoal?.id).toBe('goal_avid_collector');
    expect(harness.life.getPersonalGoalDef()?.title).toBe('An Avid Collector');
    expect(harness.life.getArchive().some((entry) => entry.category === 'choice')).toBe(true);

    const missing = harness.life.choosePersonalGoal('goal_does_not_exist');
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe('not_found');

    // Cannot abandon a goal that is still in progress.
    const second = harness.life.choosePersonalGoal('goal_celebrated_gardener');
    expect(second.ok).toBe(false);
    expect(second.code).toBe('not_allowed');
  });

  it('advances goal progress from real state hourly and completes it with rewards', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    const completed = collectEvents(harness, 'goal:completed');
    harness.life.choosePersonalGoal('goal_avid_collector');
    const influenceBefore = harness.state.player.influence;
    for (let index = 0; index < 10; index += 1) {
      harness.state.collection.entries['item_' + index] = {
        itemId: 'item_' + index,
        firstCollectedAt: 0,
        count: 1,
        bestQuality: 1,
        donated: false,
      };
    }
    advance(harness, 60);
    expect(harness.life.getPersonalGoal()?.progress).toBe(10);
    expect(completed.length).toBe(0);

    for (let index = 10; index < 25; index += 1) {
      harness.state.collection.entries['item_' + index] = {
        itemId: 'item_' + index,
        firstCollectedAt: 0,
        count: 1,
        bestQuality: 1,
        donated: false,
      };
    }
    advance(harness, 60);
    const goal = harness.life.getPersonalGoal();
    expect(goal?.progress).toBe(25);
    expect(goal?.completedAt).not.toBeNull();
    expect(completed.length).toBe(1);
    expect(completed[0]?.goalId).toBe('goal_avid_collector');
    const def = PLAYER_GOALS.find((entry) => entry.id === 'goal_avid_collector');
    expect(harness.state.player.influence - influenceBefore).toBeGreaterThanOrEqual(def?.rewardInfluence ?? 1);
    expect(harness.life.getArchive().some((entry) => entry.title.includes('An Avid Collector'))).toBe(true);

    // A completed goal may be replaced by a new direction.
    const next = harness.life.choosePersonalGoal('goal_celebrated_gardener');
    expect(next.ok).toBe(true);
    expect(harness.life.getPersonalGoal()?.id).toBe('goal_celebrated_gardener');
  });

  it('completes skill and wealth goals from live progress', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    const completed = collectEvents(harness, 'goal:completed');
    harness.life.choosePersonalGoal('goal_celebrated_gardener');
    const gardening = harness.state.player.skills.gardening;
    if (!gardening) throw new Error('missing skill');
    gardening.level = 12;
    advance(harness, 60);
    expect(completed.some((event) => event.goalId === 'goal_celebrated_gardener')).toBe(true);

    harness.life.choosePersonalGoal('goal_wealth_builder');
    harness.state.player.statistics.moneyEarned = 25000;
    advance(harness, 60);
    expect(completed.some((event) => event.goalId === 'goal_wealth_builder')).toBe(true);
  });

  it('does not allow choosing goals after the life ends', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    harness.life.endLife('test');
    const result = harness.life.choosePersonalGoal('goal_avid_collector');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_allowed');
    advanceInSteps(harness, 60, 60);
  });
});
