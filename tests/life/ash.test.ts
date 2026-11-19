import { describe, expect, it } from 'vitest';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import { ITEM } from '../../src/data/items/ids';
import { HOME_INTERIOR_ID, LOC } from '../../src/data/locations/ids';
import { countItem } from '../../src/core/InventoryUtil';
import { readLifeExtras } from '../../src/life/lifeShared';
import {
  advance,
  advanceInSteps,
  collectEvents,
  createHarness,
  giveItem,
  moveTo,
  setWeather,
  takeItem,
} from './helpers';

function ashCount(harness: ReturnType<typeof createHarness>): number {
  return countItem(harness.state.player.inventory, ITEM.cigaretteAsh);
}

describe('LifeSystem.collectAsh', () => {
  it('refuses to collect when there is no whole pinch of ash', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    const result = harness.life.collectAsh();
    expect(result.ok).toBe(false);
    expect(result.code).toBe('requirement_not_met');
    expect(ashCount(harness)).toBe(0);
  });

  it('converts accumulated ash into integer ash items and resets the accumulator', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    const acquired = collectEvents(harness, 'item:acquired');
    const signals = collectEvents(harness, 'game:signal');
    advanceInSteps(harness, 3 * 1440, 60);
    const accumulated = harness.state.player.cigarette.ashAccumulated;
    expect(accumulated).toBeGreaterThan(1);

    const result = harness.life.collectAsh();
    expect(result.ok).toBe(true);
    const collected = Math.floor(accumulated);
    expect(ashCount(harness)).toBe(collected);
    expect(harness.state.player.cigarette.ashAccumulated).toBeCloseTo(accumulated - collected, 9);
    expect(harness.state.player.statistics.ashCollected).toBe(collected);
    expect(harness.state.life.lastAshCollectedAt).toBe(harness.clock.simTimeSeconds);
    expect(acquired.some((event) => event.itemId === ITEM.cigaretteAsh && event.quantity === collected)).toBe(true);
    expect(signals.some((signal) => signal.name === 'cigarette:ash_collected')).toBe(true);
  });

  it('caps a single collection at 100 pinches', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    harness.state.player.cigarette.ashAccumulated = WORLD_CONFIG.cigarette.maxAsh;
    const result = harness.life.collectAsh();
    expect(result.ok).toBe(true);
    expect(ashCount(harness)).toBe(100);
    expect(harness.state.player.cigarette.ashAccumulated).toBe(0);
  });

  it('cannot be used after the life has ended', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    harness.state.player.cigarette.ashAccumulated = 10;
    harness.life.endLife('test');
    const result = harness.life.collectAsh();
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_allowed');
  });

  it('tracks ash consumed by other systems (fertiliser/crafting) as ashUsed', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    giveItem(harness, ITEM.cigaretteAsh, 10);
    advance(harness, 5);
    expect(readLifeExtras(harness.state).counters.ashOnHand).toBe(10);
    expect(readLifeExtras(harness.state).counters.ashUsed).toBe(0);

    takeItem(harness, ITEM.cigaretteAsh, 3);
    advance(harness, 5);
    expect(readLifeExtras(harness.state).counters.ashUsed).toBe(3);
    expect(readLifeExtras(harness.state).counters.ashOnHand).toBe(7);

    takeItem(harness, ITEM.cigaretteAsh, 7);
    advance(harness, 5);
    expect(readLifeExtras(harness.state).counters.ashUsed).toBe(10);
  });

  it('a well-lived cigarette produces most of the ash cap before burning out', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    advanceInSteps(harness, 13 * 1440, 60);
    const accumulated = harness.state.player.cigarette.ashAccumulated;
    expect(accumulated).toBeGreaterThan(WORLD_CONFIG.cigarette.maxAsh * 0.8);
    expect(harness.life.collectAsh().ok).toBe(true);
    expect(ashCount(harness)).toBeGreaterThan(80);
  });

  it('ash collection stacks correctly with different max stacks', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    harness.state.player.cigarette.ashAccumulated = 99;
    harness.life.collectAsh();
    expect(ashCount(harness)).toBe(99);
    // Wet weather has nothing to do with ash, but burn more for a second collection.
    setWeather(harness, 'clear');
    advanceInSteps(harness, 2 * 1440, 60);
    harness.life.collectAsh();
    const total = ashCount(harness);
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThanOrEqual(99 * 2);
    expect(harness.state.player.inventory.filter((entry) => entry.itemId === ITEM.cigaretteAsh).length).toBeGreaterThanOrEqual(1);
    void LOC;
  });
});
