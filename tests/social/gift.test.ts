import { describe, expect, it } from 'vitest';
import { NPC } from '../../src/data/npcs/ids';
import { ITEM } from '../../src/data/items/ids';
import { evaluateGift } from '../../src/social/GiftSystem';
import type { ItemDef, NPCDef } from '../../src/data/schema';
import {
  advanceHours,
  createSocialHarness,
  requireNpc,
  eventsOf,
  givePlayerItem,
  placeAtPlayer,
  setRelationship,
} from './support/harness';

function fixtureItem(overrides: Partial<ItemDef>): ItemDef {
  return {
    id: 'test_item',
    name: 'test item',
    description: 'test',
    category: 'misc',
    basePrice: 100,
    stackable: true,
    maxStack: 99,
    hasQuality: true,
    tags: [],
    visual: { shape: 'circle', color: '#fff' },
    ...overrides,
  };
}

function fixtureNpc(overrides: Partial<NPCDef>): NPCDef {
  return {
    id: 'npc_test',
    name: 'Test Person',
    age: 30,
    lifeStage: 'adult',
    personality: {
      extroversion: 0.5,
      introversion: 0.5,
      adventure: 0.5,
      caution: 0.5,
      generosity: 0.5,
      curiosity: 0.5,
      socialNeed: 0.5,
      independence: 0.5,
      responsibility: 0.5,
      spendingTendency: 0.5,
      artisticTendency: 0.5,
      workTendency: 0.5,
    },
    appearance: {
      primaryColor: '#fff',
      secondaryColor: '#000',
      hairColor: '#000',
      skinTone: '#fff',
      outfitStyle: 'casual',
      accessory: 'none',
      scale: 1,
    },
    occupation: 'tester',
    homeLocationId: 'willowbrook_home',
    workLocationId: 'willowbrook_center',
    startingMoney: 1000,
    interests: [],
    goals: [],
    bio: 'test',
    dialogueTreeId: 'dialogue_resident',
    scheduleTemplate: [],
    initialRelationships: [],
    major: false,
    romanceable: false,
    likes: [],
    dislikes: [],
    ...overrides,
  };
}

describe('gift taste evaluation', () => {
  it('matches plural and singular taste tags', () => {
    const npc = fixtureNpc({ likes: ['flowers'], dislikes: ['junk'] });
    const item = fixtureItem({ giftTasteTags: ['flower'] });
    const reaction = evaluateGift(npc, item, 3);
    expect(reaction.likedTagMatches).toBe(1);
    expect(reaction.affinityDelta).toBeGreaterThan(5);
  });

  it('penalises disliked tags and cannot be rescued by quality', () => {
    const npc = fixtureNpc({ likes: [], dislikes: ['metal'] });
    const badQuality = evaluateGift(npc, fixtureItem({ giftTasteTags: ['metal'] }), 1);
    const goodQuality = evaluateGift(npc, fixtureItem({ giftTasteTags: ['metal'] }), 5);
    expect(badQuality.affinityDelta).toBeLessThan(0);
    expect(goodQuality.affinityDelta).toBeLessThan(0);
    expect(badQuality.reaction).toBe('disliked');
  });

  it('awards quality and wrapper bonuses', () => {
    const npc = fixtureNpc({ likes: ['sweet'] });
    const low = evaluateGift(npc, fixtureItem({ giftTasteTags: ['sweet'] }), 1);
    const high = evaluateGift(npc, fixtureItem({ giftTasteTags: ['sweet'] }), 5);
    expect(high.affinityDelta).toBeGreaterThan(low.affinityDelta);
    const wrapped = evaluateGift(npc, fixtureItem({ giftTasteTags: ['sweet'], category: 'gift' }), 1);
    expect(wrapped.wrappedBonus).toBeGreaterThan(0);
    expect(wrapped.affinityDelta).toBeGreaterThan(low.affinityDelta);
  });

  it('a neutral gift is still a small positive gesture', () => {
    const npc = fixtureNpc({ likes: ['tea'], dislikes: ['junk'] });
    const neutral = evaluateGift(npc, fixtureItem({ giftTasteTags: ['wood'] }), 1);
    expect(neutral.affinityDelta).toBeGreaterThan(0);
    expect(neutral.affinityDelta).toBeLessThan(5);
  });
});

describe('giveGift', () => {
  it('a liked gift raises affinity, consumes the item, counts the gift and stores a memory', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.sylviaReed);
    const instanceId = givePlayerItem(h, ITEM.teaLeaves, 2, 3);
    const beforeMoney = h.state.player.money;
    const result = h.social.giveGift(NPC.sylviaReed, instanceId);
    expect(result.ok).toBe(true);
    const rel = h.state.player.relationships[NPC.sylviaReed];
    expect(rel?.affinity).toBeGreaterThan(0);
    expect(rel?.interactionCount).toBe(1);
    expect(h.state.player.statistics.giftsGiven).toBe(1);
    expect(h.state.player.money).toBe(beforeMoney);
    const entry = h.state.player.inventory.find((item) => item.instanceId === instanceId);
    expect(entry?.quantity).toBe(1); // one consumed from the stack
    expect(requireNpc(h, NPC.sylviaReed)?.memories.some((memory) => memory.type === 'social_gift')).toBe(true);
    expect(eventsOf(h, 'item:lost')).toHaveLength(1);
    expect(h.state.player.skills.social.totalXp).toBeGreaterThan(0);
  });

  it('a disliked gift lowers affinity and is remembered negatively', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.rufusMarsh);
    const instanceId = givePlayerItem(h, ITEM.rose);
    const result = h.social.giveGift(NPC.rufusMarsh, instanceId);
    expect(result.ok).toBe(true);
    const rel = h.state.player.relationships[NPC.rufusMarsh];
    expect(rel?.affinity).toBeLessThan(0);
    expect(requireNpc(h, NPC.rufusMarsh)?.memories.some((memory) => memory.type === 'social_gift_disliked')).toBe(true);
  });

  it('enforces the 12 game hour gift cooldown', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    const first = givePlayerItem(h, ITEM.pressedFlower);
    expect(h.social.giveGift(NPC.marigoldLyle, first).ok).toBe(true);
    const second = givePlayerItem(h, ITEM.pressedFlower);
    const blocked = h.social.giveGift(NPC.marigoldLyle, second);
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('on_cooldown');
    // Item untouched while on cooldown.
    expect(h.state.player.inventory.some((item) => item.instanceId === second)).toBe(true);
    advanceHours(h, 12.1);
    expect(h.social.giveGift(NPC.marigoldLyle, second).ok).toBe(true);
    expect(h.state.player.statistics.giftsGiven).toBe(2);
  });

  it('rejects gifting an item the player does not carry or gifting across the map', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.theoGrey);
    expect(h.social.giveGift(NPC.theoGrey, 'not_an_instance').ok).toBe(false);
    const instanceId = givePlayerItem(h, ITEM.romanceNovel);
    requireNpc(h, NPC.theoGrey).locationId = 'willowbrook_library' as never;
    const wrongPlace = h.social.giveGift(NPC.theoGrey, instanceId);
    expect(wrongPlace.ok).toBe(false);
    expect(wrongPlace.code).toBe('wrong_location');
  });

  it('higher quality gives a better reaction in a real playthrough', () => {
    const run = (quality: 1 | 5): number => {
      const h = createSocialHarness({ seed: 1111 });
      placeAtPlayer(h, NPC.sylviaReed);
      const instanceId = givePlayerItem(h, ITEM.teaLeaves, 1, quality);
      h.social.giveGift(NPC.sylviaReed, instanceId);
      return h.state.player.relationships[NPC.sylviaReed]?.affinity ?? 0;
    };
    const low = run(1);
    const high = run(5);
    expect(high).toBeGreaterThan(low);
  });

  it('previewGift reports the same reaction the real gift produces', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.sylviaReed);
    const preview = h.social.getGiftSystem().previewGift(NPC.sylviaReed, ITEM.teaLeaves);
    expect(preview).not.toBeNull();
    if (!preview) return;
    const instanceId = givePlayerItem(h, ITEM.teaLeaves, 1, 3);
    h.social.giveGift(NPC.sylviaReed, instanceId);
    const affinity = h.state.player.relationships[NPC.sylviaReed]?.affinity ?? 0;
    expect(affinity).toBeGreaterThan(0);
    expect(preview.reaction === 'loved' || preview.reaction === 'liked').toBe(true);
    expect(preview.likedTagMatches).toBe(1);
  });

  it('a genuinely hostile NPC may refuse the gift outright', () => {
    let refused = false;
    for (let seed = 1; seed <= 40 && !refused; seed += 1) {
      const h = createSocialHarness({ seed });
      placeAtPlayer(h, NPC.rufusMarsh);
      setRelationship(h, NPC.rufusMarsh, { affinity: -90, trust: 0, familiarity: 20, status: 'enemy' });
      const instanceId = givePlayerItem(h, ITEM.rose);
      const result = h.social.giveGift(NPC.rufusMarsh, instanceId);
      if (result.ok) continue;
      refused = true;
      expect(result.code).toBe('not_allowed');
      // The item is not consumed when the gift is refused.
      expect(h.state.player.inventory.some((entry) => entry.instanceId === instanceId)).toBe(true);
    }
    expect(refused).toBe(true);
  });

  it('cannot gift to a person who is not present', () => {
    const h = createSocialHarness();
    const instanceId = givePlayerItem(h, ITEM.rose);
    requireNpc(h, NPC.marigoldLyle).locationId = 'willowbrook_market' as never;
    const result = h.social.giveGift(NPC.marigoldLyle, instanceId);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong_location');
  });
});

describe('gift balance guardrails', () => {
  it('a disliked gift does not crash when the player has not met the NPC yet', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.ninaOkoye);
    const instanceId = givePlayerItem(h, ITEM.scrapMetal);
    const result = h.social.giveGift(NPC.ninaOkoye, instanceId);
    expect(result.ok).toBe(true);
    expect(h.state.player.relationships[NPC.ninaOkoye]?.affinity).toBeLessThan(0);
  });

  it('relationship gains diminish as affinity approaches 100', () => {
    const gain = (affinity: number): number => {
      const h = createSocialHarness({ seed: 22 });
      placeAtPlayer(h, NPC.marigoldLyle);
      setRelationship(h, NPC.marigoldLyle, { affinity, trust: 50, familiarity: 60, status: 'friend' });
      const instanceId = givePlayerItem(h, ITEM.pressedFlower);
      h.social.giveGift(NPC.marigoldLyle, instanceId);
      return (h.state.player.relationships[NPC.marigoldLyle]?.affinity ?? 0) - affinity;
    };
    expect(gain(30)).toBeGreaterThan(gain(90));
  });
});
