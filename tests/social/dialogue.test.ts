import { describe, expect, it } from 'vitest';
import { NPC, RESIDENT_NPC_IDS } from '../../src/data/npcs/ids';
import { ITEM } from '../../src/data/items/ids';
import { LOC } from '../../src/data/locations/ids';
import { DIALOGUE_TREES } from '../../src/data/dialogue/dialogue';
import {
  advanceHours,
  createSocialHarness,
  requireNpc,
  eventsOf,
  givePlayerItem,
  placeAtPlayer,
  setClockTime,
  setEnvironment,
  setRelationship,
} from './support/harness';
import type { SocialHarness } from './support/harness';

function choiceIndex(h: SocialHarness, choiceId: string): number {
  const node = h.dialogue.getCurrentNode();
  if (!node) return -1;
  return node.choices.findIndex((choice) => choice.id === choiceId);
}

function chooseById(h: SocialHarness, choiceId: string) {
  const index = choiceIndex(h, choiceId);
  expect(index, 'choice not rendered: ' + choiceId).toBeGreaterThanOrEqual(0);
  return h.dialogue.choose(index);
}

describe('startConversation', () => {
  it('opens a usable conversation for every major NPC with their own tree', () => {
    const h = createSocialHarness();
    for (const npcId of Object.values(NPC)) {
      placeAtPlayer(h, npcId);
      const result = h.dialogue.startConversation(npcId);
      expect(result.ok, 'failed for ' + npcId + ': ' + result.message).toBe(true);
      const node = h.dialogue.getCurrentNode();
      expect(node, 'no current node for ' + npcId).not.toBeNull();
      if (!node) continue;
      expect(node.text.length).toBeGreaterThan(20);
      expect(node.choices.length).toBeGreaterThanOrEqual(5);
      expect(node.emotion.length).toBeGreaterThan(0);
      const session = h.dialogue.getConversation();
      expect(session?.npcId).toBe(npcId);
      expect(session?.treeId).toBe('dialogue_' + npcId);
      expect(h.dialogue.endConversation().ok).toBe(true);
      expect(h.dialogue.getConversation()).toBeNull();
    }
  });

  it('works for generic residents with the shared resident tree', () => {
    const h = createSocialHarness();
    const residentId = RESIDENT_NPC_IDS[0] ?? '';
    placeAtPlayer(h, residentId);
    expect(h.dialogue.startConversation(residentId).ok).toBe(true);
    expect(h.dialogue.getConversation()?.treeId).toBe('dialogue_resident');
    const node = h.dialogue.getCurrentNode();
    expect(node?.choices.length).toBeGreaterThan(3);
  });

  it('requires the NPC to be present and alive', () => {
    const h = createSocialHarness();
    expect(h.dialogue.startConversation(NPC.ottoBramwell).ok).toBe(false);
    placeAtPlayer(h, NPC.ottoBramwell);
    requireNpc(h, NPC.ottoBramwell).alive = false;
    expect(h.dialogue.startConversation(NPC.ottoBramwell).ok).toBe(false);
    const unknown = h.dialogue.startConversation('npc_nobody');
    expect(unknown.ok).toBe(false);
    expect(unknown.code).toBe('not_found');
  });

  it('rejects an NPC who is in another location', () => {
    const h = createSocialHarness();
    const npc = placeAtPlayer(h, NPC.sylviaReed);
    npc.locationId = LOC.restaurant;
    const result = h.dialogue.startConversation(NPC.sylviaReed);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong_location');
  });

  it('marks first meetings, counts them and awards social XP', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.jasperKim);
    h.dialogue.startConversation(NPC.jasperKim);
    expect(h.state.player.statistics.npcsMet).toBe(1);
    expect(eventsOf(h, 'npc:met')).toHaveLength(1);
    expect(h.state.flags['met:' + NPC.jasperKim]).toBe(true);
    expect(h.state.player.skills.social.totalXp).toBeGreaterThan(0);
    h.dialogue.endConversation();
    h.dialogue.startConversation(NPC.jasperKim);
    expect(h.state.player.statistics.npcsMet).toBe(1);
    expect(eventsOf(h, 'npc:met')).toHaveLength(1);
  });

  it('drops a stale conversation after a few game hours', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.theoGrey);
    h.dialogue.startConversation(NPC.theoGrey);
    advanceHours(h, 4);
    expect(h.dialogue.getConversation()).toBeNull();
    expect(h.dialogue.getCurrentNode()).toBeNull();
  });
});

describe('greeting by relationship status', () => {
  it('picks the status-specific greeting node', () => {
    const cases: { status: 'friend' | 'dating' | 'ex' | 'enemy'; nodeId: string }[] = [
      { status: 'friend', nodeId: 'greet_friend' },
      { status: 'dating', nodeId: 'greet_dating' },
      { status: 'ex', nodeId: 'greet_awkward' },
      { status: 'enemy', nodeId: 'greet_cold' },
    ];
    for (const testCase of cases) {
      const h = createSocialHarness();
      placeAtPlayer(h, NPC.marigoldLyle);
      setRelationship(h, NPC.marigoldLyle, {
        affinity: testCase.status === 'dating' ? 70 : testCase.status === 'enemy' ? -70 : 40,
        trust: 50,
        familiarity: 60,
        status: testCase.status,
      });
      h.dialogue.startConversation(NPC.marigoldLyle);
      expect(h.dialogue.getConversation()?.nodeId).toBe(testCase.nodeId);
      h.dialogue.endConversation();
    }
  });

  it('falls back to the neutral greeting for a stranger', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    h.dialogue.startConversation(NPC.marigoldLyle);
    expect(h.dialogue.getConversation()?.nodeId).toBe('greet_acquaintance');
  });
});

describe('dynamic text variants', () => {
  it('changes the greeting for rain, late night, a soaked player and a warm friendship', () => {
    const base = (setup: (h: SocialHarness) => void): string => {
      const h = createSocialHarness();
      placeAtPlayer(h, NPC.marigoldLyle);
      setup(h);
      h.dialogue.startConversation(NPC.marigoldLyle);
      return h.dialogue.getCurrentNode()?.text ?? '';
    };
    const dry = base(() => undefined);
    const rainy = base((h) => setEnvironment(h, { weather: 'rain' }));
    const night = base((h) => setClockTime(h, { hour: 23 }));
    const soaked = base((h) => {
      h.state.player.cigarette.moisture = 0.9;
    });
    const warm = base((h) =>
      setRelationship(h, NPC.marigoldLyle, { affinity: 70, trust: 60, familiarity: 70, status: 'friend' })
    );
    expect(rainy).not.toBe(dry);
    expect(rainy).toContain('Rain');
    expect(night).toContain('Late');
    expect(soaked).toContain('dripping');
    expect(warm).toContain('flower');
  });

  it('interpolates {tokens} with live values and never leaks a token', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    h.dialogue.startConversation(NPC.marigoldLyle);
    const text = h.dialogue.getCurrentNode()?.text ?? '';
    expect(text).not.toContain('{');
    // The root/greeting text refers to the player by name in several strings.
    const anyNpcText = DIALOGUE_TREES.filter((tree) => tree.npcId !== undefined)
      .flatMap((tree) => Object.values(tree.nodes))
      .some((node) => node.text.includes('{player}'));
    expect(anyNpcText).toBe(true);
  });
});

describe('conditions and once-only choices', () => {
  it('hides gated choices until the relationship is close enough and the item exists', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    h.dialogue.startConversation(NPC.marigoldLyle);
    let node = h.dialogue.getCurrentNode();
    expect(node?.choices.find((choice) => choice.id === 'rumour')?.available).toBe(false);
    expect(node?.choices.find((choice) => choice.id === 'special')?.available).toBe(false);
    expect(node?.choices.find((choice) => choice.id === 'gift')?.available).toBe(false);
    expect(node?.choices.find((choice) => choice.id === 'flirt')?.available).toBe(true);
    h.dialogue.endConversation();

    setRelationship(h, NPC.marigoldLyle, { affinity: 60, trust: 60, familiarity: 60, status: 'friend' });
    givePlayerItem(h, ITEM.pressedFlower);
    h.dialogue.startConversation(NPC.marigoldLyle);
    node = h.dialogue.getCurrentNode();
    expect(node?.choices.find((choice) => choice.id === 'rumour')?.available).toBe(true);
    expect(node?.choices.find((choice) => choice.id === 'special')?.available).toBe(true);
    expect(node?.choices.find((choice) => choice.id === 'gift')?.available).toBe(true);
  });

  it('never offers the community branch to a romanceable NPC and vice versa', () => {
    const romanceHarness = createSocialHarness();
    placeAtPlayer(romanceHarness, NPC.marigoldLyle);
    romanceHarness.dialogue.startConversation(NPC.marigoldLyle);
    expect(romanceHarness.dialogue.getCurrentNode()?.choices.some((choice) => choice.id === 'community')).toBe(false);

    const communityHarness = createSocialHarness();
    placeAtPlayer(communityHarness, NPC.ottoBramwell);
    communityHarness.dialogue.startConversation(NPC.ottoBramwell);
    expect(communityHarness.dialogue.getCurrentNode()?.choices.some((choice) => choice.id === 'community')).toBe(true);
    expect(communityHarness.dialogue.getCurrentNode()?.choices.some((choice) => choice.id === 'flirt')).toBe(false);
  });

  it('uses a once-only story beat once, persistently, across conversations', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    setRelationship(h, NPC.marigoldLyle, { affinity: 40, trust: 20, familiarity: 50, status: 'friend' });
    h.dialogue.startConversation(NPC.marigoldLyle);
    expect(chooseById(h, 'chat').ok).toBe(true);
    const deep = chooseById(h, 'chat_deep');
    expect(deep.ok).toBe(true);
    expect(h.state.flags['dlg_once:' + NPC.marigoldLyle + ':chat_deep']).toBe(true);
    h.dialogue.endConversation();

    h.dialogue.startConversation(NPC.marigoldLyle);
    chooseById(h, 'chat');
    const node = h.dialogue.getCurrentNode();
    expect(node?.choices.find((choice) => choice.id === 'chat_deep')?.available).toBe(false);
  });
});

describe('choice effects', () => {
  it('applies relationship and memory effects from a choice', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    const rel = setRelationship(h, NPC.marigoldLyle, { affinity: 40, trust: 20, familiarity: 50, status: 'friend' });
    const beforeAffinity = rel.affinity;
    const beforeTrust = rel.trust;
    h.dialogue.startConversation(NPC.marigoldLyle);
    chooseById(h, 'chat');
    expect(chooseById(h, 'chat_deep').ok).toBe(true);
    expect(rel.affinity).toBeGreaterThan(beforeAffinity);
    expect(rel.trust).toBeGreaterThan(beforeTrust);
    expect(requireNpc(h, NPC.marigoldLyle).memories.some((memory) => memory.type === 'dialogue')).toBe(true);
    expect(eventsOf(h, 'relationship:changed').length).toBeGreaterThan(0);
  });

  it('applies money and item effects from a purchase choice', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    const beforeMoney = h.state.player.money;
    h.dialogue.startConversation(NPC.marigoldLyle);
    chooseById(h, 'work');
    const result = chooseById(h, 'work_buy');
    expect(result.ok).toBe(true);
    expect(h.state.player.money).toBe(beforeMoney - 220);
    expect(h.state.player.inventory.some((entry) => entry.itemId === ITEM.rose)).toBe(true);
    expect(eventsOf(h, 'money:changed')).toHaveLength(1);
    expect(eventsOf(h, 'item:acquired')).toHaveLength(1);
    expect(h.dialogue.getConversation()?.nodeId).toBe('work_buy');
  });

  it('refuses a purchase the player cannot afford and mutates nothing', () => {
    const h = createSocialHarness({ playerMoney: 50 });
    placeAtPlayer(h, NPC.marigoldLyle);
    const beforeLog = h.state.social.interactionLog.length;
    h.dialogue.startConversation(NPC.marigoldLyle);
    chooseById(h, 'work');
    const result = chooseById(h, 'work_buy');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_enough_money');
    expect(h.state.player.money).toBe(50);
    expect(h.state.player.inventory.some((entry) => entry.itemId === ITEM.rose)).toBe(false);
    expect(h.state.social.interactionLog.length).toBe(beforeLog);
    expect(h.dialogue.getConversation()).not.toBeNull();
    // The choice was not consumed: after earning money it can be taken.
    h.state.player.money = 1000;
    expect(chooseById(h, 'work_buy').ok).toBe(true);
  });

  it('applies gated special-node effects (item + relationship + goal)', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    setRelationship(h, NPC.marigoldLyle, { affinity: 60, trust: 60, familiarity: 60, status: 'friend' });
    h.dialogue.startConversation(NPC.marigoldLyle);
    const beforeAffinity = h.state.player.relationships[NPC.marigoldLyle]?.affinity ?? 0;
    const result = chooseById(h, 'special');
    expect(result.ok).toBe(true);
    expect(h.state.player.inventory.some((entry) => entry.itemId === ITEM.pressedFlower)).toBe(true);
    expect(h.state.player.relationships[NPC.marigoldLyle]?.affinity).toBeGreaterThan(beforeAffinity);
    // The node's effects are guarded to run once per conversation.
    expect(h.dialogue.getConversation()?.usedChoiceIds['node:special']).toBe(true);
  });

  it('gift-choice consumes the carried item and applies a memory', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    setRelationship(h, NPC.marigoldLyle, { affinity: 50, trust: 30, familiarity: 60, status: 'friend' });
    const instanceId = givePlayerItem(h, ITEM.pressedFlower);
    expect(h.state.player.inventory.some((entry) => entry.instanceId === instanceId)).toBe(true);
    h.dialogue.startConversation(NPC.marigoldLyle);
    expect(chooseById(h, 'gift').ok).toBe(true);
    expect(h.state.player.inventory.some((entry) => entry.instanceId === instanceId)).toBe(false);
    expect(h.state.flags['dialogue_gift:' + NPC.marigoldLyle]).toBe(true);
    expect(requireNpc(h, NPC.marigoldLyle).memories.some((memory) => memory.importance >= 50)).toBe(true);
  });
});

describe('navigation and validation', () => {
  it('rejects invalid choice indexes and unavailable choices', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    h.dialogue.startConversation(NPC.marigoldLyle);
    expect(h.dialogue.choose(-1).ok).toBe(false);
    expect(h.dialogue.choose(99).ok).toBe(false);
    const rumourIndex = choiceIndex(h, 'rumour');
    const gated = h.dialogue.choose(rumourIndex);
    expect(gated.ok).toBe(false);
    expect(gated.code).toBe('requirement_not_met');
  });

  it('follows a choice to its target node and keeps the conversation open', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    h.dialogue.startConversation(NPC.marigoldLyle);
    const result = chooseById(h, 'chat');
    expect(result.ok).toBe(true);
    const session = h.dialogue.getConversation();
    expect(session?.nodeId).toBe('chat');
    expect(h.dialogue.getCurrentNode()?.text.length).toBeGreaterThan(10);
  });

  it('ends the conversation when a choice has no continuation', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    h.dialogue.startConversation(NPC.marigoldLyle);
    const byeIndex = choiceIndex(h, 'bye');
    const result = h.dialogue.choose(byeIndex);
    expect(result.ok).toBe(true);
    // 'bye' leads to the end node, whose endConversation effect closes the session.
    expect(h.dialogue.getConversation()).toBeNull();
  });

  it('is idempotent when ending a conversation twice', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.theoGrey);
    h.dialogue.startConversation(NPC.theoGrey);
    expect(h.dialogue.endConversation().ok).toBe(true);
    expect(h.dialogue.endConversation().ok).toBe(true);
    expect(h.dialogue.getCurrentNode()).toBeNull();
  });

  it('reports an error instead of throwing when choosing without a conversation', () => {
    const h = createSocialHarness();
    const result = h.dialogue.choose(0);
    expect(result.ok).toBe(false);
    expect(h.dialogue.getCurrentNode()).toBeNull();
  });
});

describe('dialogue effect coverage across all trees', () => {
  it('every major NPC conversation can award social XP by reaching a second node', () => {
    const h = createSocialHarness();
    for (const npcId of Object.values(NPC)) {
      placeAtPlayer(h, npcId);
      h.dialogue.startConversation(npcId);
      const before = h.state.player.skills.social.totalXp;
      const chatIndex = choiceIndex(h, 'chat');
      if (chatIndex >= 0) {
        const result = h.dialogue.choose(chatIndex);
        expect(result.ok, 'chat failed for ' + npcId).toBe(true);
        expect(h.state.player.skills.social.totalXp).toBeGreaterThan(before);
      }
      h.dialogue.endConversation();
    }
  });
});
