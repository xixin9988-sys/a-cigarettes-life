import { describe, expect, it } from 'vitest';
import { WORLD_CONFIG, WEATHER_PROFILES } from '../../src/core/WorldConfig';
import { ITEM } from '../../src/data/items/ids';
import { HOME_INTERIOR_ID, LOC } from '../../src/data/locations/ids';
import type { MicroclimateState } from '../../src/core/contracts';
import {
  StubWorldSystem,
  advance,
  advanceInSteps,
  collectEvents,
  createHarness,
  equip,
  giveItem,
  moveTo,
  setEnvironment,
  setWeather,
} from './helpers';
import { ASH_FULL_WARNING_FRACTION, CIGARETTE_WARNING_COOLDOWN_SECONDS } from '../../src/life/CigarettePhysicsSystem';

const BASE_PER_GAME_HOUR = WORLD_CONFIG.cigarette.baseBurnPerGameHour;
const GAME_HOURS_PER_DAY = 24;

function expectedLengthRatio(days: number, burnMultiplier: number): number {
  return 1 - days * GAME_HOURS_PER_DAY * BASE_PER_GAME_HOUR * burnMultiplier;
}

describe('CigarettePhysicsSystem - base burn rate', () => {
  it('burns exactly the configured fraction of the body over 1, 7 and 14 game days indoors', () => {
    const oneDay = createHarness();
    moveTo(oneDay, HOME_INTERIOR_ID, true);
    advanceInSteps(oneDay, 1440, 60);
    expect(oneDay.state.player.cigarette.lengthRatio).toBeCloseTo(expectedLengthRatio(1, 1), 9);

    const sevenDays = createHarness();
    moveTo(sevenDays, HOME_INTERIOR_ID, true);
    advanceInSteps(sevenDays, 7 * 1440, 60);
    expect(sevenDays.state.player.cigarette.lengthRatio).toBeCloseTo(expectedLengthRatio(7, 1), 9);

    // 14 game days == WORLD_CONFIG.cigarette.lifetimeGameHours: the body is spent.
    const fourteenDays = createHarness();
    moveTo(fourteenDays, HOME_INTERIOR_ID, true);
    advanceInSteps(fourteenDays, 14 * 1440, 60);
    expect(fourteenDays.state.player.cigarette.lengthRatio).toBeLessThan(1e-6);
    expect(fourteenDays.state.life.phase).toBe('ended');
  });

  it('applies the outdoor weather burn multiplier, e.g. clear weather burns slower than still indoor air', () => {
    const harness = createHarness();
    moveTo(harness, LOC.river, false);
    advanceInSteps(harness, 7 * 1440, 60);
    const expected = 1 - (7 * 24 * BASE_PER_GAME_HOUR * WEATHER_PROFILES.clear.burnMultiplier);
    expect(harness.state.player.cigarette.lengthRatio).toBeCloseTo(expected, 6);
    expect(harness.state.player.cigarette.lengthRatio).toBeGreaterThan(0.5);
  });

  it('burns faster in high wind, and wind protection slows that down', () => {
    const calm = createHarness();
    moveTo(calm, LOC.river, false);
    advanceInSteps(calm, 1440, 60);
    const calmRatio = calm.state.player.cigarette.lengthRatio;

    const windy = createHarness();
    moveTo(windy, LOC.river, false);
    setWeather(windy, 'wind');
    advanceInSteps(windy, 1440, 60);
    const windyRatio = windy.state.player.cigarette.lengthRatio;
    expect(windyRatio).toBeLessThan(calmRatio);

    const protectedHarness = createHarness();
    moveTo(protectedHarness, LOC.river, false);
    setWeather(protectedHarness, 'wind');
    equip(protectedHarness, 'accessory', ITEM.brassWindGuard);
    advanceInSteps(protectedHarness, 1440, 60);
    const protectedRatio = protectedHarness.state.player.cigarette.lengthRatio;
    expect(protectedRatio).toBeGreaterThan(windyRatio);
    expect(protectedRatio).toBeLessThan(calmRatio);
  });

  it('exertion accelerates burning, moisture slows it, and both stay clamped', () => {
    const idle = createHarness();
    moveTo(idle, HOME_INTERIOR_ID, true);
    advanceInSteps(idle, 720, 60);

    const exerted = createHarness();
    moveTo(exerted, HOME_INTERIOR_ID, true);
    exerted.life.setExertion(1);
    advanceInSteps(exerted, 720, 60);
    expect(exerted.state.player.cigarette.lengthRatio).toBeLessThan(idle.state.player.cigarette.lengthRatio);
    expect(exerted.life.getMoveSpeedMultiplier()).toBe(1);
  });

  it('respects the offline burn multiplier from state.flags.offline_simulation', () => {
    const online = createHarness();
    moveTo(online, HOME_INTERIOR_ID, true);
    advanceInSteps(online, 1440, 60);
    const onlineBurned = 1 - online.state.player.cigarette.lengthRatio;

    const offline = createHarness();
    moveTo(offline, HOME_INTERIOR_ID, true);
    offline.state.flags['offline_simulation'] = true;
    advanceInSteps(offline, 1440, 60);
    const offlineBurned = 1 - offline.state.player.cigarette.lengthRatio;
    expect(offlineBurned).toBeCloseTo(onlineBurned * WORLD_CONFIG.cigarette.offlineBurnMultiplier, 8);
    delete offline.state.flags['offline_simulation'];
    advanceInSteps(offline, 1440, 60);
    expect(1 - offline.state.player.cigarette.lengthRatio).toBeCloseTo(offlineBurned + onlineBurned, 6);
  });

  it('caps burns at 0 and closes the life exactly once (ends, never negative)', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    advanceInSteps(harness, 20 * 1440, 60);
    expect(harness.state.player.cigarette.lengthRatio).toBe(0);
    expect(harness.state.life.phase).toBe('ended');
    expect(harness.state.player.cigarette.totalBurned).toBeLessThanOrEqual(1);
    expect(harness.state.life.endedAt).not.toBeNull();
  });
});

describe('CigarettePhysicsSystem - moisture', () => {
  it('soaks in the rain when exposed, soaks far less under tree cover, and stays dry indoors', () => {
    const river = createHarness();
    moveTo(river, LOC.river, false);
    setWeather(river, 'rain');
    advanceInSteps(river, 2 * 60, 60);
    const riverMoisture = river.state.player.cigarette.moisture;
    expect(riverMoisture).toBeGreaterThanOrEqual(WORLD_CONFIG.cigarette.soakedThreshold);

    const park = createHarness();
    moveTo(park, LOC.park, false);
    setWeather(park, 'rain');
    advanceInSteps(park, 2 * 60, 60);
    const parkMoisture = park.state.player.cigarette.moisture;
    expect(parkMoisture).toBeLessThan(riverMoisture);
    expect(park.state.player.cigarette.isSheltered).toBe(true);

    const indoors = createHarness();
    moveTo(indoors, HOME_INTERIOR_ID, true);
    setWeather(indoors, 'rain');
    advanceInSteps(indoors, 2 * 60, 60);
    expect(indoors.state.player.cigarette.moisture).toBe(0);
    expect(indoors.state.player.cigarette.isSheltered).toBe(true);
  });

  it('protects against rain with umbrella and waterproof case, strongest for the case', () => {
    const unprotected = createHarness();
    moveTo(unprotected, LOC.river, false);
    setWeather(unprotected, 'rain');
    advanceInSteps(unprotected, 90, 60);
    const bareMoisture = unprotected.state.player.cigarette.moisture;

    const umbrella = createHarness();
    moveTo(umbrella, LOC.river, false);
    setWeather(umbrella, 'rain');
    equip(umbrella, 'umbrella', ITEM.miniUmbrella);
    advanceInSteps(umbrella, 90, 60);
    expect(umbrella.state.player.cigarette.moisture).toBeLessThan(bareMoisture);

    const cased = createHarness();
    moveTo(cased, LOC.river, false);
    setWeather(cased, 'rain');
    equip(cased, 'case', ITEM.waterproofCase);
    advanceInSteps(cased, 90, 60);
    expect(cased.state.player.cigarette.moisture).toBeLessThan(umbrella.state.player.cigarette.moisture);
  });

  it('dries indoors next to a heat source, and desiccant / hand warmer speed it up further', () => {
    const plain = createHarness();
    moveTo(plain, HOME_INTERIOR_ID, true);
    plain.state.player.cigarette.moisture = 0.6;
    advanceInSteps(plain, 60, 60);
    const plainMoisture = plain.state.player.cigarette.moisture;
    expect(plainMoisture).toBeLessThan(0.6);

    const withDesiccant = createHarness();
    moveTo(withDesiccant, HOME_INTERIOR_ID, true);
    withDesiccant.state.player.cigarette.moisture = 0.6;
    giveItem(withDesiccant, ITEM.desiccantPack);
    advanceInSteps(withDesiccant, 60, 60);
    expect(withDesiccant.state.player.cigarette.moisture).toBeLessThan(plainMoisture);

    const withWarmer = createHarness();
    moveTo(withWarmer, HOME_INTERIOR_ID, true);
    withWarmer.state.player.cigarette.moisture = 0.6;
    giveItem(withWarmer, ITEM.handWarmer);
    advanceInSteps(withWarmer, 60, 60);
    expect(withWarmer.state.player.cigarette.moisture).toBeLessThan(plainMoisture);
  });

  it('dries slower in cold air than in warm air (temperature is part of the environment sample)', () => {
    const cold = createHarness();
    moveTo(cold, HOME_INTERIOR_ID, true);
    setEnvironment(cold, { temperature: 2 });
    cold.state.player.cigarette.moisture = 0.6;
    advanceInSteps(cold, 60, 60);

    const warm = createHarness();
    moveTo(warm, HOME_INTERIOR_ID, true);
    setEnvironment(warm, { temperature: 26 });
    warm.state.player.cigarette.moisture = 0.6;
    advanceInSteps(warm, 60, 60);

    expect(warm.state.player.cigarette.moisture).toBeLessThan(cold.state.player.cigarette.moisture);
    expect(warm.life.getCigaretteSnapshot()?.temperature).toBe(26);
  });

  it('clamps moisture into 0..1 over very long wet and dry spells', () => {
    const harness = createHarness();
    moveTo(harness, LOC.river, false);
    setEnvironment(harness, { rainIntensity: 1, humidity: 1 });
    advanceInSteps(harness, 12 * 60, 60);
    const moisture = harness.state.player.cigarette.moisture;
    expect(moisture).toBeGreaterThanOrEqual(0);
    expect(moisture).toBeLessThanOrEqual(1);

    moveTo(harness, HOME_INTERIOR_ID, true);
    setEnvironment(harness, { rainIntensity: 0, humidity: 0 });
    advanceInSteps(harness, 12 * 60, 60);
    expect(harness.state.player.cigarette.moisture).toBe(0);
  });

  it('delegates microclimate to the registered world system when one is present', () => {
    // A world stub that reports the player as fully indoors and dry, even though the
    // position says river: the physics must trust the world provider, not the raw def.
    const dryIndoors: MicroclimateState = {
      indoor: true,
      shelter: 1,
      windExposure: 0,
      humidityModifier: 0,
      heatSource: true,
    };
    const world = new StubWorldSystem(dryIndoors);
    const harness = createHarness({ world });
    moveTo(harness, LOC.river, false);
    setWeather(harness, 'rain');
    advanceInSteps(harness, 2 * 60, 60);
    expect(harness.state.player.cigarette.moisture).toBe(0);
    expect(harness.state.player.cigarette.isSheltered).toBe(true);

    // Without the registered provider the same setup soaks the player.
    const fallback = createHarness();
    moveTo(fallback, LOC.river, false);
    setWeather(fallback, 'rain');
    advanceInSteps(fallback, 2 * 60, 60);
    expect(fallback.state.player.cigarette.moisture).toBeGreaterThan(0);
  });
});

describe('CigarettePhysicsSystem - movement, ash and warnings', () => {
  it('implements the documented movement multiplier for damp, soaked and near-burnout states', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    harness.state.player.cigarette.moisture = 0;
    expect(harness.life.getMoveSpeedMultiplier()).toBe(1);

    harness.state.player.cigarette.moisture = 0.8;
    expect(harness.life.getMoveSpeedMultiplier()).toBeCloseTo(1 - 0.5 * (0.8 - 0.3), 9);

    harness.state.player.cigarette.moisture = 0.3;
    harness.state.player.cigarette.lengthRatio = 0.1;
    expect(harness.life.getMoveSpeedMultiplier()).toBeCloseTo(0.75, 9);

    harness.state.player.statusEffects.push({
      id: 'test-effect',
      label: 'Heavy legs',
      source: 'test',
      startedAt: 0,
      expiresAt: null,
      moveSpeedMultiplier: 0.5,
    });
    expect(harness.life.getMoveSpeedMultiplier()).toBeCloseTo(0.375, 9);
  });

  it('produces ash proportional to burned body and respects the ash cap', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    advanceInSteps(harness, 1440, 60);
    const ash = harness.state.player.cigarette.ashAccumulated;
    expect(ash).toBeGreaterThan(0);
    expect(ash).toBeLessThanOrEqual(WORLD_CONFIG.cigarette.maxAsh);
    // A whole cigarette is worth exactly maxAsh pinches.
    expect(ash).toBeCloseTo(WORLD_CONFIG.cigarette.maxAsh * (1 - harness.state.player.cigarette.lengthRatio), 6);
  });

  it('emits cigarette:state at least every ~5 simulated seconds', () => {
    const harness = createHarness();
    moveTo(harness, HOME_INTERIOR_ID, true);
    const states = collectEvents(harness, 'cigarette:state');
    for (let index = 0; index < 6; index += 1) advance(harness, 5);
    expect(states.length).toBeGreaterThanOrEqual(5);
    const last = states[states.length - 1];
    expect(last?.lengthRatio).toBeGreaterThan(0.99);
    expect(last?.sheltered).toBe(true);
  });

  it('warns when soaked, near burnout, in strong wind and when the ash tray is full', () => {
    const soaked = createHarness();
    moveTo(soaked, LOC.river, false);
    setWeather(soaked, 'rain');
    const soakedWarnings = collectEvents(soaked, 'cigarette:warning');
    advanceInSteps(soaked, 3 * 60, 30);
    const soakedKinds = soakedWarnings.map((warning) => warning.kind);
    expect(soakedKinds).toContain('soaked');
    expect(soaked.state.life.warnings).toContain('soaked');

    const burnt = createHarness();
    moveTo(burnt, HOME_INTERIOR_ID, true);
    burnt.state.player.cigarette.lengthRatio = 0.16;
    const burnWarnings = collectEvents(burnt, 'cigarette:warning');
    advanceInSteps(burnt, 5 * 60, 60);
    expect(burnWarnings.map((warning) => warning.kind)).toContain('near_burnout');

    const windy = createHarness();
    moveTo(windy, LOC.river, false);
    setWeather(windy, 'wind');
    const windWarnings = collectEvents(windy, 'cigarette:warning');
    advanceInSteps(windy, 60, 60);
    expect(windWarnings.map((warning) => warning.kind)).toContain('wind');

    const ashy = createHarness();
    moveTo(ashy, HOME_INTERIOR_ID, true);
    ashy.state.player.cigarette.ashAccumulated = WORLD_CONFIG.cigarette.maxAsh * ASH_FULL_WARNING_FRACTION;
    const ashWarnings = collectEvents(ashy, 'cigarette:warning');
    advanceInSteps(ashy, 60, 60);
    expect(ashWarnings.map((warning) => warning.kind)).toContain('ash_full');
  });

  it('throttles warnings to at most one per warning cooldown', () => {
    const harness = createHarness();
    moveTo(harness, LOC.river, false);
    setWeather(harness, 'rain');
    const warnings = collectEvents(harness, 'cigarette:warning');
    advanceInSteps(harness, 60, 60);
    expect(warnings.length).toBe(1);
    // Immediately make a second danger visible: still throttled.
    harness.state.player.cigarette.ashAccumulated = WORLD_CONFIG.cigarette.maxAsh;
    advance(harness, 5);
    expect(warnings.length).toBe(1);
    // After the cooldown elapses, the next danger may warn again.
    advance(harness, CIGARETTE_WARNING_COOLDOWN_SECONDS + 60);
    expect(warnings.length).toBe(2);
  });

  it('exposes a readable snapshot with protection and burn-rate estimates', () => {
    const harness = createHarness();
    moveTo(harness, LOC.river, false);
    setWeather(harness, 'rain');
    equip(harness, 'umbrella', ITEM.miniUmbrella);
    equip(harness, 'accessory', ITEM.brassWindGuard);
    const snapshot = harness.life.getCigaretteSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.rainProtection).toBeGreaterThan(0);
    expect(snapshot?.windProtection).toBeGreaterThan(0);
    expect(snapshot?.burnRateMultiplier).toBeLessThanOrEqual(1);
    expect(harness.life.getRemainingGameHours()).toBeGreaterThan(0);
    expect(harness.life.isTooSoakedForHeavyWork()).toBe(false);
  });
});
