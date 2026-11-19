import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../../src/core/WorldFactory';
import { INFLUENCE_TIERS, InfluenceSystem } from '../../src/life/InfluenceSystem';
import { PlayerIdentitySystem, validateCigaretteAppearance as validateAppearanceFromIdentity } from '../../src/life/PlayerIdentitySystem';
import { HOME_INTERIOR_ID } from '../../src/data/locations/ids';
import { collectEvents, createHarness } from './helpers';

describe('PlayerIdentitySystem appearance validation', () => {
  it('accepts a valid appearance and normalises colours', () => {
    const result = validateAppearanceFromIdentity({
      bodyColor: '#AABBCC',
      filterColor: '#112233',
      accessory: '  red ribbon  ',
      face: 'wink',
      pattern: 'zigzag',
    });
    expect(result.ok).toBe(true);
    expect(result.value?.bodyColor).toBe('#aabbcc');
    expect(result.value?.accessory).toBe('red ribbon');
    expect(validateAppearanceFromIdentity(DEFAULT_APPEARANCE).ok).toBe(true);
  });

  it('rejects malformed colours, faces, patterns and accessories', () => {
    const base = { ...DEFAULT_APPEARANCE };
    expect(validateAppearanceFromIdentity({ ...base, bodyColor: 'red' }).ok).toBe(false);
    expect(validateAppearanceFromIdentity({ ...base, bodyColor: '#12345' }).ok).toBe(false);
    expect(validateAppearanceFromIdentity({ ...base, filterColor: 42 as never }).ok).toBe(false);
    expect(validateAppearanceFromIdentity({ ...base, face: 'furious' as never }).ok).toBe(false);
    expect(validateAppearanceFromIdentity({ ...base, pattern: 'plaid' as never }).ok).toBe(false);
    expect(validateAppearanceFromIdentity({ ...base, accessory: 'x'.repeat(60) }).ok).toBe(false);
    expect(validateAppearanceFromIdentity(null).ok).toBe(false);
    expect(validateAppearanceFromIdentity('cigarette').ok).toBe(false);
  });

  it('exposes the two validator entry points with identical behaviour', () => {
    const input = { ...DEFAULT_APPEARANCE, face: 'sleepy' as const };
    const identityValidator = new PlayerIdentitySystem();
    const viaCustomize = identityValidator.customize(createHarness().state, input);
    expect(viaCustomize.ok).toBe(validateAppearanceFromIdentity(input).ok);
  });

  it('builds display names, titles and palettes', () => {
    const identity = new PlayerIdentitySystem();
    const harness = createHarness({ playerName: '  ' });
    expect(identity.getDisplayName(harness.state)).toBe('Ash');
    harness.state.player.name = 'Bramble';
    harness.state.player.occupation = 'Baker';
    expect(identity.getTitle(harness.state)).toBe('Bramble the Baker');
    expect(identity.getOccupationLabel(harness.state)).toBe('Baker');
    harness.state.player.occupation = null;
    expect(identity.getOccupationLabel(harness.state)).toBe('Wanderer');
    const palette = identity.getPalette(harness.state.player.appearance);
    expect(palette.body).toBe(harness.state.player.appearance.bodyColor);
    expect(identity.sanitizeName('x'.repeat(80)).length).toBe(24);
  });
});

describe('InfluenceSystem', () => {
  function createInfluenceHarness() {
    const harness = createHarness();
    const signals = collectEvents(harness, 'game:signal');
    const influence = new InfluenceSystem({ state: harness.state, bus: harness.bus });
    return { harness, signals, influence };
  }

  it('adds influence and the equivalent community points, emitting a signal', () => {
    const { harness, signals, influence } = createInfluenceHarness();
    expect(influence.getInfluence()).toBe(0);
    const now = influence.gainInfluence(50, 'test:community');
    expect(now).toBe(50);
    expect(harness.state.player.influence).toBe(50);
    expect(harness.state.player.communityPoints).toBe(250);
    const signal = signals.find((entry) => entry.name === 'influence:changed');
    expect(signal).toBeTruthy();
    expect(signals.some((entry) => entry.name === 'influence:tier_up')).toBe(true);
    expect(influence.getTier().id).toBe('known');
    void HOME_INTERIOR_ID;
  });

  it('ignores invalid gains and clamps spending to available influence', () => {
    const { harness, influence } = createInfluenceHarness();
    influence.gainInfluence(-20, 'bad');
    influence.gainInfluence(Number.NaN, 'bad');
    expect(harness.state.player.influence).toBe(0);
    influence.gainInfluence(30, 'test');
    expect(influence.spendInfluence(50, 'too much')).toBe(false);
    expect(influence.getInfluence()).toBe(30);
    expect(influence.spendInfluence(10, 'spent')).toBe(true);
    expect(influence.getInfluence()).toBe(20);
  });

  it('maps the five spec thresholds to tiers and progress', () => {
    const { harness, influence } = createInfluenceHarness();
    const expected = [0, 50, 150, 400, 800];
    expect(INFLUENCE_TIERS.map((tier) => tier.minInfluence)).toEqual(expected);
    const checkpoints = [
      { influence: 0, tier: 'new_resident' },
      { influence: 49, tier: 'new_resident' },
      { influence: 50, tier: 'known' },
      { influence: 149, tier: 'known' },
      { influence: 150, tier: 'respected' },
      { influence: 399, tier: 'respected' },
      { influence: 400, tier: 'pillar' },
      { influence: 799, tier: 'pillar' },
      { influence: 800, tier: 'legend' },
    ];
    for (const checkpoint of checkpoints) {
      harness.state.player.influence = checkpoint.influence;
      expect(influence.getTier().id, String(checkpoint.influence)).toBe(checkpoint.tier);
    }
    harness.state.player.influence = 100;
    expect(influence.getTier().id).toBe('known');
    expect(influence.getNextTier()?.id).toBe('respected');
    expect(influence.getProgressToNextTier()).toBeCloseTo((100 - 50) / (150 - 50), 9);
    harness.state.player.influence = 800;
    expect(influence.getNextTier()).toBeNull();
    expect(influence.getProgressToNextTier()).toBe(1);
    const snapshot = influence.getSnapshot();
    expect(snapshot.tier.id).toBe('legend');
    expect(snapshot.nextTier).toBeNull();
  });
});
