import { describe, expect, it } from 'vitest';
import { DIALOGUE_TREES, MAJOR_NPC_DIALOGUE_TREE_IDS, getDialogueTreeById } from '../../src/data/dialogue/dialogue';
import { COMMUNITY_PROPOSALS } from '../../src/data/community/community';
import { NPC, RESIDENT_NPC_IDS } from '../../src/data/npcs/ids';
import { ALL_EXTERIOR_LOCATION_IDS } from '../../src/data/locations/ids';
import { ALL_ITEM_IDS } from '../../src/data/items/ids';
import type { DialogueCondition, DialogueEffect, DialogueTree } from '../../src/data/schema';
import { NPCS } from '../../src/data/npcs/npcs';
import { ALL_ITEMS } from '../../src/data/items';
import { LOCATIONS } from '../../src/data/locations/locations';

const ALL_TREES = DIALOGUE_TREES;

function collectConditions(tree: DialogueTree): DialogueCondition[] {
  const out: DialogueCondition[] = [];
  for (const node of Object.values(tree.nodes)) {
    if (node.variants) for (const variant of node.variants) out.push(...variant.conditions);
    if (node.choices) for (const choice of node.choices) out.push(...(choice.conditions ?? []));
  }
  return out;
}

function collectEffects(tree: DialogueTree): DialogueEffect[] {
  const out: DialogueEffect[] = [];
  for (const node of Object.values(tree.nodes)) {
    out.push(...(node.effects ?? []));
    if (node.choices) for (const choice of node.choices) out.push(...(choice.effects ?? []));
  }
  return out;
}

describe('dialogue data', () => {
  it('ships one dedicated tree per major NPC, with the documented tree id convention', () => {
    const majorIds = Object.values(NPC);
    expect(MAJOR_NPC_DIALOGUE_TREE_IDS).toHaveLength(majorIds.length);
    for (const npcId of majorIds) {
      const tree = getDialogueTreeById('dialogue_' + npcId);
      expect(tree, 'missing tree for ' + npcId).toBeDefined();
      expect(tree?.npcId).toBe(npcId);
      expect(Object.keys(tree?.nodes ?? {}).length).toBeGreaterThanOrEqual(8);
    }
  });

  it('includes the generic resident tree and the optional role trees', () => {
    expect(getDialogueTreeById('dialogue_resident')).toBeDefined();
    expect(Object.keys(getDialogueTreeById('dialogue_resident')?.nodes ?? {}).length).toBeGreaterThanOrEqual(10);
    expect(getDialogueTreeById('dialogue_shopkeeper')).toBeDefined();
    expect(getDialogueTreeById('dialogue_farmer')).toBeDefined();
    expect(getDialogueTreeById('dialogue_artist')).toBeDefined();
  });

  it('has unique tree ids and unique node ids inside each tree', () => {
    const ids = new Set<string>();
    for (const tree of ALL_TREES) {
      expect(ids.has(tree.id), 'duplicate tree id ' + tree.id).toBe(false);
      ids.add(tree.id);
      expect(tree.nodes[tree.rootNodeId], tree.id + ' has no root node').toBeDefined();
      for (const [nodeId, node] of Object.entries(tree.nodes)) {
        expect(node.id, 'node key/id mismatch in ' + tree.id + ': ' + nodeId).toBe(nodeId);
      }
    }
  });

  it('never links to a missing node from a node.next or a choice.next', () => {
    for (const tree of ALL_TREES) {
      for (const node of Object.values(tree.nodes)) {
        if (node.next) {
          expect(tree.nodes[node.next], tree.id + ': node ' + node.id + ' -> missing ' + node.next).toBeDefined();
        }
        if (node.choices) {
          const choiceIds = new Set<string>();
          for (const choice of node.choices) {
            expect(choiceIds.has(choice.id), tree.id + ': duplicate choice id ' + choice.id).toBe(false);
            choiceIds.add(choice.id);
            if (choice.next) {
              expect(tree.nodes[choice.next], tree.id + ': choice ' + choice.id + ' -> missing ' + choice.next).toBeDefined();
            }
          }
        }
      }
    }
  });

  it('greetingByStatus values point to real nodes', () => {
    for (const tree of ALL_TREES) {
      if (!tree.greetingByStatus) continue;
      for (const [status, nodeId] of Object.entries(tree.greetingByStatus)) {
        expect(tree.nodes[nodeId], tree.id + ': greeting for ' + status + ' -> missing ' + nodeId).toBeDefined();
      }
    }
    for (const npcId of Object.values(NPC)) {
      const tree = getDialogueTreeById('dialogue_' + npcId);
      expect(tree?.greetingByStatus, 'missing greetingByStatus for ' + npcId).toBeDefined();
      expect(Object.keys(tree?.greetingByStatus ?? {}).length).toBeGreaterThanOrEqual(5);
    }
  });

  it('only references real item ids from hasItem conditions', () => {
    const known = new Set(ALL_ITEM_IDS);
    for (const tree of ALL_TREES) {
      for (const condition of collectConditions(tree)) {
        if (condition.kind === 'hasItem') {
          expect(known.has(condition.itemId), tree.id + ' references unknown item ' + condition.itemId).toBe(true);
        }
      }
    }
  });

  it('uses every condition kind somewhere in the dialogue library', () => {
    const kinds = new Set<string>();
    for (const tree of ALL_TREES) for (const condition of collectConditions(tree)) kinds.add(condition.kind);
    const required = [
      'affinityMin',
      'trustMin',
      'intimacyMin',
      'status',
      'hasItem',
      'weather',
      'season',
      'hourRange',
      'flag',
      'moodMin',
      'moistureMin',
      'seenBefore',
      'probability',
    ];
    for (const kind of required) expect(kinds.has(kind), 'condition kind not used: ' + kind).toBe(true);
  });

  it('uses every effect kind somewhere in the dialogue library', () => {
    const kinds = new Set<string>();
    for (const tree of ALL_TREES) for (const effect of collectEffects(tree)) kinds.add(effect.kind);
    const required = ['relationship', 'money', 'item', 'memory', 'flag', 'goal', 'influence', 'endConversation'];
    for (const kind of required) expect(kinds.has(kind), 'effect kind not used: ' + kind).toBe(true);
  });

  it('never grants an item the canonical registry does not know', () => {
    const known = new Set(ALL_ITEM_IDS);
    for (const tree of ALL_TREES) {
      for (const effect of collectEffects(tree)) {
        if (effect.kind === 'item') expect(known.has(effect.itemId), tree.id + ' effect uses unknown item ' + effect.itemId).toBe(true);
      }
    }
  });

  it('every major NPC tree has real branching (conditions + effects)', () => {
    for (const npcId of Object.values(NPC)) {
      const tree = getDialogueTreeById('dialogue_' + npcId);
      if (!tree) continue;
      const conditions = collectConditions(tree);
      const effects = collectEffects(tree);
      expect(conditions.length, npcId + ' has no conditional content').toBeGreaterThan(5);
      expect(effects.length, npcId + ' has no effects').toBeGreaterThan(8);
      const variantNodes = Object.values(tree.nodes).filter((node) => (node.variants?.length ?? 0) > 0);
      expect(variantNodes.length, npcId + ' has no dynamic text variants').toBeGreaterThan(0);
      const onceChoices = Object.values(tree.nodes)
        .flatMap((node) => node.choices ?? [])
        .filter((choice) => choice.once === true);
      expect(onceChoices.length, npcId + ' has no once-only story beats').toBeGreaterThan(0);
    }
  });

  it('resident tree covers ordinary villagers with 10+ nodes and weather/season/moisture branches', () => {
    const tree = getDialogueTreeById('dialogue_resident');
    expect(tree).toBeDefined();
    if (!tree) return;
    expect(Object.keys(tree.nodes).length).toBeGreaterThanOrEqual(10);
    const kinds = new Set(collectConditions(tree).map((condition) => condition.kind));
    expect(kinds.has('weather')).toBe(true);
    expect(kinds.has('season')).toBe(true);
    expect(kinds.has('moistureMin')).toBe(true);
    expect(kinds.has('probability')).toBe(true);
  });
});

describe('community proposal data', () => {
  it('ships eight valid proposals', () => {
    expect(COMMUNITY_PROPOSALS).toHaveLength(8);
    const ids = new Set<string>();
    const locationIds = new Set<string>(ALL_EXTERIOR_LOCATION_IDS);
    for (const proposal of COMMUNITY_PROPOSALS) {
      expect(ids.has(proposal.id), 'duplicate proposal id ' + proposal.id).toBe(false);
      ids.add(proposal.id);
      expect(proposal.title.length).toBeGreaterThan(2);
      expect(proposal.description.length).toBeGreaterThan(20);
      expect(locationIds.has(proposal.locationId), proposal.id + ' uses unknown location ' + proposal.locationId).toBe(true);
      expect(proposal.costPence).toBeGreaterThan(0);
      expect(Number.isInteger(proposal.costPence)).toBe(true);
      expect(proposal.influenceRequired).toBeGreaterThanOrEqual(0);
      expect(proposal.supportRequired).toBeGreaterThanOrEqual(1);
      expect(proposal.constructionHours).toBeGreaterThan(0);
      expect(proposal.effects.length).toBeGreaterThanOrEqual(2);
      expect(proposal.tags.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('covers a spread of prices and requirements so progression matters', () => {
    const influences = COMMUNITY_PROPOSALS.map((proposal) => proposal.influenceRequired);
    expect(Math.min(...influences)).toBeLessThanOrEqual(5);
    expect(Math.max(...influences)).toBeGreaterThanOrEqual(20);
    const costs = COMMUNITY_PROPOSALS.map((proposal) => proposal.costPence);
    expect(Math.max(...costs)).toBeGreaterThan(Math.min(...costs) * 3);
  });

  it('does not reference resident-only ids as proposals', () => {
    const residentIds = new Set<string>(RESIDENT_NPC_IDS);
    for (const proposal of COMMUNITY_PROPOSALS) {
      expect(residentIds.has(proposal.id)).toBe(false);
    }
  });
});

describe('cross-module content contracts', () => {
  it('every NPC definition\'s dialogueTreeId resolves to a shipped dialogue tree', () => {
    const ids = new Set(DIALOGUE_TREES.map((tree) => tree.id));
    expect(NPCS.length).toBeGreaterThanOrEqual(54);
    for (const npc of NPCS) {
      expect(ids.has(npc.dialogueTreeId), npc.id + ' references missing tree ' + npc.dialogueTreeId).toBe(true);
    }
  });

  it('every item referenced by dialogue exists in the shipped item data', () => {
    const itemIds = new Set(ALL_ITEMS.map((item) => item.id));
    expect(itemIds.size).toBeGreaterThan(100);
    for (const tree of ALL_TREES) {
      for (const condition of collectConditions(tree)) {
        if (condition.kind === 'hasItem') {
          expect(itemIds.has(condition.itemId), tree.id + ' hasItem references missing item ' + condition.itemId).toBe(true);
        }
      }
      for (const effect of collectEffects(tree)) {
        if (effect.kind === 'item') {
          expect(itemIds.has(effect.itemId), tree.id + ' item effect references missing item ' + effect.itemId).toBe(true);
        }
      }
    }
  });

  it('every community proposal site exists in the shipped location data', () => {
    const locationIds = new Set(LOCATIONS.map((location) => location.id));
    for (const proposal of COMMUNITY_PROPOSALS) {
      expect(locationIds.has(proposal.locationId), proposal.id + ' references missing location ' + proposal.locationId).toBe(true);
    }
  });
});
