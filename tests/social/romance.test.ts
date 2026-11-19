import { describe, expect, it } from 'vitest';
import { NPC } from '../../src/data/npcs/ids';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import {
  advanceDays,
  advanceHours,
  createSocialHarness,
  eventsOf,
  placeAtPlayer,
  requireNpc,
  setRelationship,
} from './support/harness';

function datingSetup(h: ReturnType<typeof createSocialHarness>, values: { affinity?: number; trust?: number; intimacy?: number } = {}) {
  return setRelationship(h, NPC.marigoldLyle, {
    affinity: values.affinity ?? 85,
    trust: values.trust ?? 70,
    intimacy: values.intimacy ?? 40,
    familiarity: 80,
    status: 'friend',
    interactionCount: 30,
  });
}

describe('confessTo gates', () => {
  it('requires the player to be with the NPC', () => {
    const h = createSocialHarness();
    datingSetup(h);
    const result = h.social.confessTo(NPC.marigoldLyle);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong_location');
  });

  it('refuses NPCs that are not romanceable', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.ottoBramwell);
    setRelationship(h, NPC.ottoBramwell, { affinity: 95, trust: 90, intimacy: 80, familiarity: 90, status: 'close_friend' });
    const result = h.social.confessTo(NPC.ottoBramwell);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_allowed');
    expect(h.state.player.relationships[NPC.ottoBramwell]?.status).not.toBe('dating');
  });

  it('refuses when affinity is below the configured threshold', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    datingSetup(h, { affinity: WORLD_CONFIG.social.confessThreshold - 10 });
    const result = h.social.confessTo(NPC.marigoldLyle);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('requirement_not_met');
    const readiness = h.social.getRomanceSystem().getConfessionReadiness(NPC.marigoldLyle);
    expect(readiness?.canConfess).toBe(false);
    expect(readiness?.reason).toBe('not_close_enough');
  });

  it('refuses when trust or intimacy is too low', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    datingSetup(h, { trust: 5 });
    expect(h.social.confessTo(NPC.marigoldLyle).code).toBe('requirement_not_met');
    datingSetup(h, { intimacy: 1 });
    expect(h.social.confessTo(NPC.marigoldLyle).code).toBe('requirement_not_met');
  });

  it('refuses when already dating', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    datingSetup(h);
    setRelationship(h, NPC.marigoldLyle, { affinity: 90, trust: 80, intimacy: 60, familiarity: 80, status: 'dating' });
    const result = h.social.confessTo(NPC.marigoldLyle);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid');
  });

  it('reports readiness diagnostics for the UI', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    datingSetup(h);
    const readiness = h.social.getRomanceSystem().getConfessionReadiness(NPC.marigoldLyle);
    expect(readiness?.canConfess).toBe(true);
    expect(readiness?.chance).toBeGreaterThan(0);
    expect(readiness?.chance).toBeLessThanOrEqual(0.95);
  });
});

describe('confessTo outcomes', () => {
  it('succeeds eventually for a very close relationship, sets dating and writes permanent memories/history', () => {
    let succeeded = false;
    for (let seed = 1; seed <= 30 && !succeeded; seed += 1) {
      const h = createSocialHarness({ seed });
      placeAtPlayer(h, NPC.marigoldLyle);
      datingSetup(h);
      const result = h.social.confessTo(NPC.marigoldLyle);
      if (!result.ok) continue;
      succeeded = true;
      const rel = h.state.player.relationships[NPC.marigoldLyle];
      expect(rel?.status).toBe('dating');
      expect(rel?.flags).toContain('romance_started');
      const memory = requireNpc(h, NPC.marigoldLyle).memories.find((entry) => entry.type === 'romance_confession');
      expect(memory).toBeDefined();
      expect(memory?.permanent).toBe(true);
      expect(memory?.importance).toBeGreaterThanOrEqual(80);
      expect(h.state.world.history.some((entry) => entry.description.includes('sweethearts'))).toBe(true);
      expect(eventsOf(h, 'game:signal').some((payload) => JSON.stringify(payload).includes('romance_started'))).toBe(true);
      expect(requireNpc(h, NPC.marigoldLyle).lifeHistory.some((entry) => entry.type === 'romance')).toBe(true);
    }
    expect(succeeded).toBe(true);
  });

  it('rejections apply a cooldown and a permanent, memorable sting', () => {
    let rejected = false;
    for (let seed = 1; seed <= 40 && !rejected; seed += 1) {
      const h = createSocialHarness({ seed });
      placeAtPlayer(h, NPC.marigoldLyle);
      datingSetup(h, { affinity: 66, trust: 40, intimacy: 22 });
      const result = h.social.confessTo(NPC.marigoldLyle);
      if (result.ok) continue;
      rejected = true;
      const rel = h.state.player.relationships[NPC.marigoldLyle];
      expect(rel?.status).not.toBe('dating');
      expect(rel?.cooldowns['confess']).toBeGreaterThan(h.clock.simTimeSeconds);
      expect(rel?.affinity).toBeLessThan(66);
      const memory = requireNpc(h, NPC.marigoldLyle).memories.find((entry) => entry.type === 'romance_rejection');
      expect(memory?.permanent).toBe(true);
      // A second attempt is blocked by the cooldown.
      const second = h.social.confessTo(NPC.marigoldLyle);
      expect(second.ok).toBe(false);
      expect(second.code).toBe('on_cooldown');
    }
    expect(rejected).toBe(true);
  });

  it('is reproducible for the same seed and state', () => {
    const run = (): boolean => {
      const h = createSocialHarness({ seed: 2024 });
      placeAtPlayer(h, NPC.marigoldLyle);
      datingSetup(h);
      return h.social.confessTo(NPC.marigoldLyle).ok;
    };
    expect(run()).toBe(run());
  });
});

describe('goOnDate', () => {
  it('requires a dating relationship', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    setRelationship(h, NPC.marigoldLyle, { affinity: 60, trust: 50, intimacy: 40, familiarity: 60, status: 'friend' });
    const result = h.social.goOnDate(NPC.marigoldLyle);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_allowed');
  });

  it('requires enough money and a cooldown window', () => {
    const h = createSocialHarness({ playerMoney: 100 });
    placeAtPlayer(h, NPC.marigoldLyle);
    setRelationship(h, NPC.marigoldLyle, { affinity: 80, trust: 70, intimacy: 50, familiarity: 70, status: 'dating' });
    const poor = h.social.goOnDate(NPC.marigoldLyle);
    expect(poor.ok).toBe(false);
    expect(poor.code).toBe('not_enough_money');
    h.state.player.money = 5000;
    // Find a seed where the NPC actually agrees to go out.
    let went = false;
    for (let seed = 1; seed <= 30 && !went; seed += 1) {
      h.probability.init(seed);
      const result = h.social.goOnDate(NPC.marigoldLyle);
      if (!result.ok) continue;
      went = true;
      expect(h.state.player.money).toBe(5000 - 800);
      const rel = h.state.player.relationships[NPC.marigoldLyle];
      expect(rel?.intimacy).toBeGreaterThan(50);
      expect(rel?.cooldowns['date']).toBeGreaterThan(h.clock.simTimeSeconds);
      expect(requireNpc(h, NPC.marigoldLyle).memories.some((memory) => memory.type === 'romance_date')).toBe(true);
      // Second date immediately is blocked.
      expect(h.social.goOnDate(NPC.marigoldLyle).code).toBe('on_cooldown');
    }
    expect(went).toBe(true);
  });

  it('can promote a dating relationship to partner at high intimacy', () => {
    let promoted = false;
    for (let seed = 1; seed <= 40 && !promoted; seed += 1) {
      const h = createSocialHarness({ seed, playerMoney: 5000 });
      placeAtPlayer(h, NPC.marigoldLyle);
      setRelationship(h, NPC.marigoldLyle, { affinity: 95, trust: 85, intimacy: 68, familiarity: 90, status: 'dating' });
      const result = h.social.goOnDate(NPC.marigoldLyle);
      if (!result.ok) continue;
      if (h.state.player.relationships[NPC.marigoldLyle]?.status !== 'partner') continue;
      promoted = true;
      expect(requireNpc(h, NPC.marigoldLyle).memories.some((memory) => memory.type === 'romance_partner')).toBe(true);
      expect(h.state.world.history.some((entry) => entry.description.includes('partners for life'))).toBe(true);
    }
    expect(promoted).toBe(true);
  });

  it('an NPC may decline a date without charging the player', () => {
    let declined = false;
    for (let seed = 1; seed <= 40 && !declined; seed += 1) {
      const h = createSocialHarness({ seed, playerMoney: 5000 });
      placeAtPlayer(h, NPC.marigoldLyle);
      setRelationship(h, NPC.marigoldLyle, { affinity: 70, trust: 55, intimacy: 35, familiarity: 60, status: 'dating' });
      requireNpc(h, NPC.marigoldLyle).needs.workPressure = 95;
      requireNpc(h, NPC.marigoldLyle).needs.energy = 5;
      const result = h.social.goOnDate(NPC.marigoldLyle);
      if (result.ok) continue;
      declined = true;
      expect(result.code).toBe('busy');
      expect(h.state.player.money).toBe(5000);
      expect(h.state.player.relationships[NPC.marigoldLyle]?.cooldowns['date']).toBeGreaterThan(h.clock.simTimeSeconds);
    }
    expect(declined).toBe(true);
  });
});

describe('romance drift and breakups', () => {
  it('breaks up after sustained neglect and leaves an ex status plus history', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    setRelationship(h, NPC.marigoldLyle, {
      affinity: 40,
      trust: 60,
      intimacy: 60,
      familiarity: 80,
      status: 'dating',
      lastInteractionAt: h.clock.simTimeSeconds - 30 * 24 * 60,
    });
    advanceHours(h, 1);
    const rel = h.state.player.relationships[NPC.marigoldLyle];
    expect(rel?.status).toBe('ex');
    expect(rel?.flags).toContain('breakup');
    expect(rel?.cooldowns['confess']).toBeGreaterThan(h.clock.simTimeSeconds);
    const memory = requireNpc(h, NPC.marigoldLyle).memories.find((entry) => entry.type === 'romance_breakup');
    expect(memory?.permanent).toBe(true);
    expect(h.state.world.history.some((entry) => entry.description.includes('drifted apart'))).toBe(true);
    expect(eventsOf(h, 'game:signal').some((payload) => JSON.stringify(payload).includes('romance_ended'))).toBe(true);
    expect(h.social.getRomanceSystem().getActiveRomances()).toHaveLength(0);
  });

  it('decays affection during neglect before the final break', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    setRelationship(h, NPC.marigoldLyle, {
      affinity: 50,
      trust: 60,
      intimacy: 60,
      familiarity: 80,
      status: 'dating',
      lastInteractionAt: h.clock.simTimeSeconds - 14 * 24 * 60,
    });
    advanceHours(h, 1);
    const rel = h.state.player.relationships[NPC.marigoldLyle];
    expect(rel?.status).toBe('dating');
    expect(rel?.affinity).toBeLessThan(50);
    expect(rel?.flags).toContain('neglect_warned');
    expect(eventsOf(h, 'relationship:changed').some((payload) => JSON.stringify(payload).includes('"kind":"decay"'))).toBe(true);
  });

  it('does not decay or break up non-romantic friendships', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.adaQuinn);
    setRelationship(h, NPC.adaQuinn, {
      affinity: 30,
      trust: 30,
      intimacy: 10,
      familiarity: 60,
      status: 'friend',
      lastInteractionAt: h.clock.simTimeSeconds - 60 * 24 * 60,
    });
    advanceDays(h, 1);
    const rel = h.state.player.relationships[NPC.adaQuinn];
    expect(rel?.status).toBe('friend');
    expect(rel?.affinity).toBe(30);
  });

  it('a fresh interaction postpones decay (patience respects recent contact)', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    setRelationship(h, NPC.marigoldLyle, {
      affinity: 60,
      trust: 60,
      intimacy: 60,
      familiarity: 80,
      status: 'dating',
      lastInteractionAt: h.clock.simTimeSeconds - 4 * 24 * 60,
    });
    advanceHours(h, 1);
    const rel = h.state.player.relationships[NPC.marigoldLyle];
    expect(rel?.status).toBe('dating');
    expect(rel?.affinity).toBe(60);
    expect(rel?.flags).not.toContain('neglect_warned');
  });

  it('tracking the neglect days works for UI', () => {
    const h = createSocialHarness();
    placeAtPlayer(h, NPC.marigoldLyle);
    setRelationship(h, NPC.marigoldLyle, {
      affinity: 60,
      trust: 60,
      intimacy: 60,
      familiarity: 80,
      status: 'dating',
      lastInteractionAt: h.clock.simTimeSeconds - 2 * 24 * 60,
    });
    const romance = h.social.getRomanceSystem();
    expect(romance.neglectDays(NPC.marigoldLyle)).toBeCloseTo(2, 3);
    expect(romance.getActiveRomances()).toHaveLength(1);
    expect(romance.getActiveRomances()[0]?.partner).toBe(false);
  });
});
