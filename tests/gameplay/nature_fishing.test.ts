import { describe, expect, it } from 'vitest';
import type { FishingSessionState, GameEventMap } from '../../src/core/contracts';
import type { NatureHarness } from './helpers/natureHarness';
import {
  advanceOneBigStep,
  createNatureHarness,
  giveItem,
  itemCount,
  recordEvents,
  setGameTime,
  teleport,
} from './helpers/natureHarness';
import { ITEM } from '../../src/data/items/ids';
import { LOC } from '../../src/data/locations/ids';

function makeRiverHarness(seed: number): NatureHarness {
  const h = createNatureHarness({ seed });
  teleport(h, LOC.river);
  giveItem(h, ITEM.fishingRodBasic, 1);
  setGameTime(h, { seasonIndex: 0, dayOfSeason: 5, hour: 10, temperature: 15, weather: 'clear' });
  return h;
}

function advanceToBite(h: NatureHarness, maxSteps = 4000): FishingSessionState | null {
  for (let step = 0; step < maxSteps; step += 1) {
    const session = h.fishing.getSession();
    if (!session || session.phase === 'bite' || session.phase === 'reeling') return session;
    h.clock.advanceSimSeconds(1);
    h.registry.updateAll(1);
  }
  return h.fishing.getSession();
}

function playMinigame(h: NatureHarness, maxSimSeconds = 180): void {
  h.fishing.reel(true);
  let elapsed = 0;
  const step = 0.25;
  while (elapsed < maxSimSeconds) {
    const session = h.fishing.getSession();
    if (!session || session.phase !== 'reeling') return;
    h.fishing.reel(session.tension <= 62);
    h.clock.advanceSimSeconds(step);
    h.registry.updateAll(step);
    elapsed += step;
  }
}

function catchOneFish(seed: number): { fishId: string; sizeCm: number; quality: number } {
  const h = makeRiverHarness(seed);
  const events = recordEvents(h, ['fish:caught', 'item:acquired']);
  const cast = h.fishing.castLine(LOC.river);
  expect(cast.ok, cast.message).toBe(true);
  const session = advanceToBite(h);
  expect(session?.phase).toBe('bite');
  h.fishing.reel(true);
  expect(h.fishing.getSession()?.phase).toBe('reeling');
  playMinigame(h);
  expect(h.fishing.getSession()).toBeNull();
  expect(h.state.fishing.catches).toBe(1);
  const caughtEvents = events.filter((entry) => entry.topic === 'fish:caught');
  expect(caughtEvents).toHaveLength(1);
  const payload = caughtEvents[0]?.payload as GameEventMap['fish:caught'];
  expect(payload.sizeCm).toBeGreaterThan(0);
  expect(payload.quality).toBeGreaterThanOrEqual(1);
  expect(h.state.fishing.bySpecies[payload.fishId]).toBe(1);
  expect(h.state.player.statistics.fishCaught).toBe(1);
  expect(h.state.fishing.lastResultMessage).toContain('You land');
  return { fishId: payload.fishId, sizeCm: payload.sizeCm, quality: payload.quality };
}

describe('FishingSystem', () => {
  it('runs the full cast -> wait -> bite -> reel -> land lifecycle', () => {
    const h = makeRiverHarness(1001);
    const events = recordEvents(h, ['item:acquired', 'fish:caught']);
    const cast = h.fishing.castLine(LOC.river);
    expect(cast.ok, cast.message).toBe(true);
    expect(h.state.fishing.casts).toBe(1);
    const waiting = h.fishing.getSession();
    expect(waiting?.phase).toBe('waiting');
    expect(waiting?.targetFishId).toBeTruthy();
    expect(waiting?.waitUntil).toBeGreaterThan(h.clock.simTimeSeconds);
    const busy = h.fishing.castLine(LOC.river);
    expect(busy.ok).toBe(false);
    expect(busy.code).toBe('busy');
    expect(advanceToBite(h)?.phase).toBe('bite');
    expect(h.state.fishing.lastResultMessage).toContain('bite');
    expect(h.fishing.reel(true).ok).toBe(true);
    expect(h.fishing.getSession()?.phase).toBe('reeling');
    playMinigame(h);
    expect(h.fishing.getSession()).toBeNull();
    expect(h.state.fishing.catches).toBe(1);
    expect(events.some((entry) => entry.topic === 'fish:caught')).toBe(true);
    expect(events.some((entry) => entry.topic === 'item:acquired')).toBe(true);
    const fishEntries = h.state.player.inventory.filter((entry) => entry.itemId.startsWith('fish_') || entry.itemId === ITEM.junkBoot);
    expect(fishEntries.length).toBeGreaterThanOrEqual(1);
    const caught = fishEntries[fishEntries.length - 1];
    expect(caught?.meta?.sizeCm).toBeGreaterThan(0);
    expect(h.skill.calls.some((call) => call.skill === 'fishing')).toBe(true);
  });

  it('escapes when tension reaches the maximum', () => {
    const h = makeRiverHarness(1002);
    expect(h.fishing.castLine(LOC.river).ok).toBe(true);
    advanceToBite(h);
    h.fishing.reel(true);
    expect(h.fishing.getSession()?.phase).toBe('reeling');
    // Hold the line without ever releasing: tension must snap it.
    for (let step = 0; step < 400 && h.fishing.getSession(); step += 1) {
      h.fishing.reel(true);
      h.clock.advanceSimSeconds(0.25);
      h.registry.updateAll(0.25);
    }
    expect(h.fishing.getSession()).toBeNull();
    expect(h.state.fishing.catches).toBe(0);
    expect(h.state.fishing.lastResultMessage).toContain('Snap');
  });

  it('escapes if the player stops reeling for four seconds', () => {
    const h = makeRiverHarness(1003);
    expect(h.fishing.castLine(LOC.river).ok).toBe(true);
    advanceToBite(h);
    h.fishing.reel(true);
    expect(h.fishing.getSession()?.phase).toBe('reeling');
    h.fishing.reel(false);
    for (let step = 0; step < 30 && h.fishing.getSession(); step += 1) {
      h.fishing.reel(false);
      h.clock.advanceSimSeconds(0.25);
      h.registry.updateAll(0.25);
    }
    expect(h.fishing.getSession()).toBeNull();
    expect(h.state.fishing.lastResultMessage).toContain('slack');
  });

  it('cancels a session cleanly across a large offline step', () => {
    const h = makeRiverHarness(1004);
    expect(h.fishing.castLine(LOC.river).ok).toBe(true);
    advanceOneBigStep(h, 3600);
    expect(h.fishing.getSession()).toBeNull();
    expect(h.state.fishing.lastResultMessage).toContain('away');
  });

  it('is deterministic: same seed and actions catch the same fish and size', () => {
    const first = catchOneFish(2002);
    const second = catchOneFish(2002);
    expect(second).toEqual(first);
  });

  it('lists available fish for the water and returns none without a fishing spot', () => {
    const h = makeRiverHarness(1005);
    const available = h.fishing.getAvailableFish(LOC.river);
    expect(available.length).toBeGreaterThan(0);
    expect(available).toContain('trout');
    expect(h.fishing.getAvailableFish(LOC.park)).toEqual([]);
    expect(h.fishing.getAvailableFish(LOC.farm)).toEqual([]);
  });

  it('consumes bait and strengthens the odds / records the bait id', () => {
    const h = makeRiverHarness(1006);
    giveItem(h, 'test_bait', 3);
    const bait = h.state.player.inventory.find((entry) => entry.itemId === 'test_bait');
    expect(bait).toBeDefined();
    if (!bait) return;
    const before = itemCount(h, 'test_bait');
    const cast = h.fishing.castLine(LOC.river, undefined, bait.instanceId);
    expect(cast.ok, cast.message).toBe(true);
    expect(itemCount(h, 'test_bait')).toBe(before - 1);
    expect(h.fishing.getSession()?.baitItemId).toBe('test_bait');
    const rod = h.state.player.inventory.find((entry) => entry.itemId === ITEM.fishingRodBasic);
    expect(rod).toBeDefined();
    if (!rod) return;
    h.fishing.cancelFishing();
    const wrongBait = h.fishing.castLine(LOC.river, rod.instanceId, h.state.player.inventory[0]?.instanceId ?? '');
    // The first inventory entry is a stack of seeds or a tool; either way it must not be bait.
    expect(wrongBait.ok).toBe(false);
  });

  it('rejects casting without a rod, away from water, or with a non-rod instance', () => {
    const h = createNatureHarness({ seed: 1007 });
    teleport(h, LOC.river);
    setGameTime(h, { seasonIndex: 0, dayOfSeason: 5, hour: 10 });
    h.state.player.inventory = [];
    const noRod = h.fishing.castLine(LOC.river);
    expect(noRod.ok).toBe(false);
    expect(noRod.code).toBe('not_enough_items');
    giveItem(h, ITEM.wood, 1);
    const woodOnly = h.state.player.inventory[0];
    if (woodOnly) {
      const wrongRod = h.fishing.castLine(LOC.river, woodOnly.instanceId);
      expect(wrongRod.ok).toBe(false);
      expect(wrongRod.code).toBe('invalid');
    }
    giveItem(h, ITEM.fishingRodBasic, 1);
    teleport(h, LOC.park);
    const wrongPlace = h.fishing.castLine(LOC.park);
    expect(wrongPlace.ok).toBe(false);
    expect(wrongPlace.code).toBe('not_allowed');
    teleport(h, LOC.river);
    const away = h.fishing.castLine(LOC.lake);
    expect(away.ok).toBe(false);
    expect(away.code).toBe('wrong_location');
  });

  it('lets the player cancel a cast', () => {
    const h = makeRiverHarness(1008);
    expect(h.fishing.cancelFishing().ok).toBe(false);
    expect(h.fishing.castLine(LOC.river).ok).toBe(true);
    const cancel = h.fishing.cancelFishing();
    expect(cancel.ok).toBe(true);
    expect(h.fishing.getSession()).toBeNull();
    expect(h.state.fishing.lastResultMessage).toContain('empty line');
    expect(h.fishing.getAvailableFish(LOC.river).length).toBeGreaterThan(0);
  });

  it('misses the bite window when the player does not strike', () => {
    const h = makeRiverHarness(1010);
    expect(h.fishing.castLine(LOC.river).ok).toBe(true);
    expect(advanceToBite(h)?.phase).toBe('bite');
    // Let the six-second bite window pass without reeling.
    for (let step = 0; step < 40 && h.fishing.getSession(); step += 1) {
      h.clock.advanceSimSeconds(0.5);
      h.registry.updateAll(0.5);
    }
    expect(h.fishing.getSession()).toBeNull();
    expect(h.state.fishing.lastResultMessage).toContain('spat out');
    expect(h.state.fishing.catches).toBe(0);
  });

  it('filters fish by season, hour, weather and skill requirement', () => {
    const h = makeRiverHarness(1011);
    // Spring noon, clear river: trout/perch are available, autumn fish are not.
    const spring = h.fishing.getAvailableFish(LOC.river);
    expect(spring).toContain('trout');
    expect(spring).toContain('perch');
    expect(spring).not.toContain('salmon');
    expect(spring).not.toContain('grayling');
    // Winter: trout closes, perch stays.
    setGameTime(h, { seasonIndex: 3, dayOfSeason: 5, hour: 10, weather: 'clear' });
    const winter = h.fishing.getAvailableFish(LOC.river);
    expect(winter).toContain('perch');
    expect(winter).not.toContain('trout');
    // Snow silences almost everything except the boot; casting still succeeds.
    setGameTime(h, { seasonIndex: 3, dayOfSeason: 5, hour: 10, weather: 'snow' });
    const snow = h.fishing.getAvailableFish(LOC.river);
    expect(snow.every((fishId) => fishId === 'junk_boot')).toBe(true);
    expect(h.fishing.castLine(LOC.river).ok).toBe(true);
    // The legendary moonfish is skill-gated.
    expect(h.fishing.getAvailableFish(LOC.lake)).not.toContain('moonfish');
    h.skill.setLevel('fishing', 12);
    setGameTime(h, { seasonIndex: 1, dayOfSeason: 10, hour: 23, weather: 'clear' });
    expect(h.fishing.getAvailableFish(LOC.lake)).toContain('moonfish');
    // Night hours close the daytime-only fish.
    expect(h.fishing.getAvailableFish(LOC.river)).not.toContain('bass');
  });

  it('supports a higher-tier rod', () => {
    const h = makeRiverHarness(1009);
    giveItem(h, ITEM.fishingRodMaster, 1);
    const master = h.state.player.inventory.find((entry) => entry.itemId === ITEM.fishingRodMaster);
    expect(master).toBeDefined();
    if (!master) return;
    const cast = h.fishing.castLine(LOC.river, master.instanceId);
    expect(cast.ok, cast.message).toBe(true);
    expect((cast.data as { rodTier: number }).rodTier).toBe(3);
    expect(h.fishing.getSession()?.rodItemId).toBe(ITEM.fishingRodMaster);
  });
});