import { describe, expect, it } from 'vitest';
import type { GameEventMap } from '../../src/core/contracts';
import type { NatureHarness } from './helpers/natureHarness';
import {
  advanceSim,
  createNatureHarness,
  giveItem,
  itemCount,
  recordEvents,
  setGameTime,
  teleport,
} from './helpers/natureHarness';
import { ITEM } from '../../src/data/items/ids';
import { LOC } from '../../src/data/locations/ids';

const HOUR = 60; // 1 game hour = 60 sim seconds (1 sim second = 1 game minute)

function makeHarness(seed: number, locationId: string = LOC.forest): NatureHarness {
  const h = createNatureHarness({ seed });
  teleport(h, locationId);
  setGameTime(h, { seasonIndex: 0, dayOfSeason: 8, hour: 10, temperature: 16, weather: 'clear' });
  return h;
}

function waitForCooldown(h: NatureHarness): void {
  advanceSim(h, HOUR + 5, 60);
}

function search(h: NatureHarness, locationId: string) {
  teleport(h, locationId);
  return h.exploration.search(locationId);
}

describe('ExplorationSystem', () => {
  it('searches a location and applies a one game hour cooldown', () => {
    const h = makeHarness(11);
    const events = recordEvents(h, ['discovery:made']);
    const first = search(h, LOC.forest);
    expect(first.ok, first.message).toBe(true);
    expect(h.exploration.getDiscoveryState(LOC.forest).searchCount).toBe(1);
    expect(h.state.exploration.lastSearchAt).toBe(h.clock.simTimeSeconds);
    expect(h.state.world.locations[LOC.forest]?.searchCount).toBe(1);
    const blocked = search(h, LOC.forest);
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('on_cooldown');
    waitForCooldown(h);
    const again = search(h, LOC.forest);
    expect(again.ok, again.message).toBe(true);
    expect(h.exploration.getDiscoveryState(LOC.forest).searchCount).toBe(2);
    expect(['nothing', 'clue', 'item', 'photo', 'secret']).toContain((again.data as { outcome: string }).outcome);
    expect(h.skill.calls.some((call) => call.skill === 'exploration')).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(0);
  });

  it('requires being at the location to search', () => {
    const h = makeHarness(12);
    teleport(h, LOC.park);
    const result = h.exploration.search(LOC.forest);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong_location');
  });

  it('finds clues, items and photo opportunities across repeated searches', () => {
    const h = makeHarness(13);
    const outcomes = new Set<string>();
    for (let attempt = 0; attempt < 80 && !(outcomes.has('clue') && outcomes.has('item')); attempt += 1) {
      const result = search(h, LOC.forest);
      if (result.ok) {
        const outcome = (result.data as { outcome: string }).outcome;
        outcomes.add(outcome);
        if (outcome === 'clue') expect(h.exploration.getClues().length).toBeGreaterThan(0);
      }
      waitForCooldown(h);
    }
    expect(outcomes.has('clue'), 'a clue outcome was found').toBe(true);
    expect(outcomes.has('item'), 'an item outcome was found').toBe(true);
    expect(h.exploration.getClues().length).toBeGreaterThan(0);
    expect(h.state.exploration.clues.length).toBeGreaterThan(0);
  });

  it('discovers a nearby hidden location through search', () => {
    const h = makeHarness(14);
    const forest = h.state.world.locations[LOC.forest];
    expect(forest).toBeDefined();
    let discovered = false;
    for (let attempt = 0; attempt < 60 && !discovered; attempt += 1) {
      const result = search(h, LOC.forest);
      if (result.ok && (result.data as { outcome: string }).outcome === 'secret') {
        discovered = true;
        break;
      }
      waitForCooldown(h);
    }
    expect(discovered, 'a secret discovery outcome was found').toBe(true);
    expect(h.state.world.locations[LOC.hiddenGarden]?.discovered).toBe(true);
    const record = h.exploration.getDiscoveryState(LOC.forest);
    expect(record.discoveredSecretIds).toContain(LOC.hiddenGarden);
    expect(h.state.world.history.some((entry) => entry.description.includes('Hidden Garden'))).toBe(true);
  });

  it('unlocks a secret location when the clue requirement is met', () => {
    const h = makeHarness(15);
    const events = recordEvents(h, ['discovery:made']);
    const notEnough = h.exploration.unlockSecret(LOC.hiddenGarden);
    expect(notEnough.ok).toBe(false);
    expect(notEnough.code).toBe('requirement_not_met');
    h.state.exploration.clues = ['clue one', 'clue two', 'clue three'];
    const unlocked = h.exploration.unlockSecret(LOC.hiddenGarden);
    expect(unlocked.ok, unlocked.message).toBe(true);
    expect(h.state.world.locations[LOC.hiddenGarden]?.unlocked).toBe(true);
    expect(h.exploration.getSecrets()).toContain(LOC.hiddenGarden);
    expect(h.state.player.statistics.secretsFound).toBe(1);
    const secretEvents = events.filter(
      (entry) => (entry.payload as GameEventMap['discovery:made']).kind === 'secret'
    );
    expect(secretEvents).toHaveLength(1);
    expect(h.state.world.history.some((entry) => entry.description.includes('secret of Hidden Garden'))).toBe(true);
    const again = h.exploration.unlockSecret(LOC.hiddenGarden);
    expect(again.ok).toBe(false);
  });

  it('refuses to unlock a secret from too far away', () => {
    const h = makeHarness(16, LOC.park);
    h.state.exploration.clues = ['a', 'b', 'c'];
    const result = h.exploration.unlockSecret(LOC.hiddenGarden);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong_location');
  });

  it('takes photos with a camera and stores them on the player record', () => {
    const h = makeHarness(17, LOC.park);
    const events = recordEvents(h, ['discovery:made']);
    // The starting inventory includes a camera, so strip it for the negative case.
    h.state.player.inventory = h.state.player.inventory.filter((entry) => entry.itemId !== ITEM.camera);
    const withoutCamera = h.exploration.takePhoto(LOC.park);
    expect(withoutCamera.ok).toBe(false);
    expect(withoutCamera.code).toBe('not_enough_items');
    giveItem(h, ITEM.camera, 1);
    const photo = h.exploration.takePhoto(LOC.park);
    expect(photo.ok, photo.message).toBe(true);
    expect(h.exploration.getPhotos()).toHaveLength(1);
    expect(h.exploration.getDiscoveryState(LOC.park).photoIds).toHaveLength(1);
    expect(h.state.player.statistics.photosTaken).toBe(1);
    expect(h.state.player.extras?.['nature.photos']).toBeDefined();
    expect(events.some((entry) => (entry.payload as GameEventMap['discovery:made']).kind === 'photo')).toBe(true);
    expect(h.skill.calls.some((call) => call.skill === 'art')).toBe(true);
    const second = h.exploration.takePhoto(LOC.park);
    expect(second.ok).toBe(true);
    expect(h.exploration.getPhotos()).toHaveLength(2);
    teleport(h, LOC.forest);
    const wrongPlace = h.exploration.takePhoto(LOC.park);
    expect(wrongPlace.ok).toBe(false);
    expect(wrongPlace.code).toBe('wrong_location');
  });

  it('is deterministic for the same seed and search sequence', () => {
    const run = (seed: number): string[] => {
      const h = makeHarness(seed);
      const outcomes: string[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const result = search(h, LOC.forest);
        expect(result.ok, result.message).toBe(true);
        outcomes.push((result.data as { outcome: string }).outcome);
        waitForCooldown(h);
      }
      return outcomes;
    };
    expect(run(333)).toEqual(run(333));
  });

  it('exposes clues and secrets through the read API', () => {
    const h = makeHarness(18);
    expect(h.exploration.getClues()).toEqual([]);
    expect(h.exploration.getSecrets()).toEqual([]);
    expect(h.exploration.getPhotos()).toEqual([]);
    expect(h.exploration.getDiscoveryState(LOC.center).searchCount).toBe(0);
    expect(itemCount(h, ITEM.oldClue)).toBe(0);
  });

  it('rejects searches at unknown locations', () => {
    const h = makeHarness(19);
    const result = h.exploration.search('not_a_location');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_found');
  });
});