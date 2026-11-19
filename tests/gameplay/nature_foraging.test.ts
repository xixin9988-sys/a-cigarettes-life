import { describe, expect, it } from 'vitest';
import type { NatureHarness } from './helpers/natureHarness';
import {
  advanceSim,
  createNatureHarness,
  findForageNode,
  giveItem,
  itemCount,
  recordEvents,
  setGameTime,
  teleport,
} from './helpers/natureHarness';
import { ITEM } from '../../src/data/items/ids';
import { LOC } from '../../src/data/locations/ids';
import { FORAGE_NODES } from '../../src/data/fish/fish';

const HOUR = 60; // 1 game hour = 60 sim seconds (1 sim second = 1 game minute)

function makeHarness(seed: number): NatureHarness {
  const h = createNatureHarness({ seed });
  teleport(h, LOC.forest);
  setGameTime(h, { seasonIndex: 1, dayOfSeason: 5, hour: 10, temperature: 20, weather: 'clear' });
  h.skill.setLevel('foraging', 3);
  return h;
}

describe('ForagingSystem', () => {
  it('materialises one node state per ForageNodeDef with stable unique ids', () => {
    const h = makeHarness(1);
    const nodes = Object.values(h.state.foraging.nodes);
    expect(nodes).toHaveLength(FORAGE_NODES.length);
    expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length);
    for (const node of nodes) {
      expect(node.id.startsWith(node.defId + ':')).toBe(true);
      expect(node.depleted).toBe(false);
      expect(node.respawnAt).toBe(0);
      expect(h.foraging.getNodeDef(node.id)?.id).toBe(node.defId);
    }
    expect(h.foraging.getNodesAt(LOC.forest).length).toBeGreaterThan(0);
  });

  it('gathers a seasonal node, emits items and sets a respawn timer', () => {
    const h = makeHarness(2);
    const events = recordEvents(h, ['item:acquired']);
    const node = findForageNode(h, 'forest_chanterelle_ring');
    expect(node).toBeDefined();
    if (!node) return;
    const before = itemCount(h, ITEM.commonMushroom);
    const result = h.foraging.gather(node.id);
    expect(result.ok, result.message).toBe(true);
    const data = result.data as { quantity: number; respawnAt: number };
    expect(data.quantity).toBeGreaterThanOrEqual(1);
    expect(itemCount(h, ITEM.commonMushroom)).toBe(before + data.quantity);
    expect(node.depleted).toBe(true);
    expect(node.respawnAt).toBe(h.clock.simTimeSeconds + 72 * HOUR);
    expect(h.state.foraging.gatheredToday).toBeGreaterThanOrEqual(data.quantity);
    expect(h.state.player.statistics.itemsForaged).toBeGreaterThanOrEqual(data.quantity);
    expect(events.filter((entry) => entry.topic === 'item:acquired')).toHaveLength(1);
    expect(h.skill.calls.some((call) => call.skill === 'foraging')).toBe(true);
  });

  it('enforces the respawn cooldown, then respawns after the wait', () => {
    const h = makeHarness(3);
    const node = findForageNode(h, 'forest_fallen_branches');
    expect(node).toBeDefined();
    if (!node) return;
    expect(h.foraging.gather(node.id).ok).toBe(true);
    const blocked = h.foraging.gather(node.id);
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('on_cooldown');
    advanceSim(h, node.respawnAt - h.clock.simTimeSeconds + 60, 60);
    expect(node.depleted).toBe(false);
    expect(h.foraging.gather(node.id).ok).toBe(true);
  });

  it('rejects out-of-season gathering', () => {
    const h = makeHarness(4);
    const node = findForageNode(h, 'forest_pale_mushroom');
    expect(node).toBeDefined();
    if (!node) return;
    // Spring - the pale mushroom only fruits in autumn.
    const result = h.foraging.gather(node.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong_time');
  });

  it('requires the foraging skill level of the node', () => {
    const h = makeHarness(5);
    setGameTime(h, { seasonIndex: 2, dayOfSeason: 5, hour: 10, temperature: 14, weather: 'fog' });
    teleport(h, LOC.forest);
    h.skill.setLevel('foraging', 1);
    const node = findForageNode(h, 'forest_pale_mushroom');
    expect(node).toBeDefined();
    if (!node) return;
    const tooLow = h.foraging.gather(node.id);
    expect(tooLow.ok).toBe(false);
    expect(tooLow.code).toBe('skill_too_low');
    h.skill.setLevel('foraging', 5);
    const ok = h.foraging.gather(node.id);
    expect(ok.ok, ok.message).toBe(true);
  });

  it('requires the player to be at the node location', () => {
    const h = makeHarness(6);
    const node = findForageNode(h, 'forest_chanterelle_ring');
    expect(node).toBeDefined();
    if (!node) return;
    teleport(h, LOC.park);
    const result = h.foraging.gather(node.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong_location');
  });

  it('resets the daily gathered counter on a new day', () => {
    const h = makeHarness(7);
    const node = findForageNode(h, 'forest_chanterelle_ring');
    expect(node).toBeDefined();
    if (!node) return;
    expect(h.foraging.gather(node.id).ok).toBe(true);
    expect(h.state.foraging.gatheredToday).toBeGreaterThan(0);
    advanceSim(h, 24 * HOUR, 600);
    expect(h.state.foraging.gatheredToday).toBe(0);
    expect(h.state.foraging.lastResetDay).toBe(h.clock.time.totalDays);
  });

  it('is deterministic for the same seed and gather order', () => {
    const run = (seed: number): { quantity: number; quality: number; order: number }[] => {
      const h = makeHarness(seed);
      const results: { quantity: number; quality: number; order: number }[] = [];
      const defIds = ['forest_fallen_branches', 'forest_bramble_patch', 'forest_wood_sorrel'];
      for (const defId of defIds) {
        const node = findForageNode(h, defId);
        if (!node) continue;
        const gather = h.foraging.gather(node.id);
        expect(gather.ok, gather.message).toBe(true);
        const data = gather.data as { quantity: number; quality: number };
        results.push({ quantity: data.quantity, quality: data.quality, order: results.length });
      }
      return results;
    };
    const first = run(2468);
    const second = run(2468);
    expect(second).toEqual(first);
  });

  it('weakens gathering for unknown nodes and unknown definitions', () => {
    const h = makeHarness(8);
    expect(h.foraging.gather('nope:0').ok).toBe(false);
    expect(h.foraging.getNodeDef('nope:0')).toBeUndefined();
  });
});