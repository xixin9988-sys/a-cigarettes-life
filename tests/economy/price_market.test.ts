import { describe, expect, it } from 'vitest';
import {
  DAY,
  HOUR,
  GROCERY_INTERIOR,
  advanceHours,
  advanceSimSeconds,
  allFixtureItems,
  createScenario,
  eventsOf,
  findNonFiniteNumbers,
  marketSnapshot,
  placePlayer,
} from './harness';
import { BIZ } from '../../src/data/shops/ids';
import { ITEM } from '../../src/data/items/ids';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import { addItemToInventory } from '../../src/core/InventoryUtil';

function priceBand(basePrice: number): { min: number; max: number } {
  return {
    min: Math.max(1, Math.floor(basePrice * WORLD_CONFIG.economy.priceClampMin) - 1),
    max: Math.ceil(basePrice * WORLD_CONFIG.economy.priceClampMax) + 1,
  };
}

describe('Market and prices', () => {
  it('bootstraps a finite market good for every item', () => {
    const scenario = createScenario();
    const market = scenario.economy.getMarket();
    for (const item of allFixtureItems()) {
      const good = market[item.id];
      expect(good, 'missing market good ' + item.id).toBeDefined();
      // A few quest-only item ids carry a 0 base price outside the economy domain; the
      // market floors those at 1 pence so no transaction maths ever sees a zero price.
      expect(good?.basePrice).toBe(item.basePrice > 0 ? item.basePrice : 1);
      const band = priceBand(item.basePrice > 0 ? item.basePrice : 1);
      expect(good?.currentPrice).toBeGreaterThanOrEqual(band.min);
      expect(good?.currentPrice).toBeLessThanOrEqual(band.max);
      expect(good?.supply).toBeGreaterThanOrEqual(1);
      expect(good?.demand).toBeGreaterThanOrEqual(1);
      expect(good?.targetStock).toBeGreaterThanOrEqual(1);
      expect(good?.seasonalFactor).toBeGreaterThanOrEqual(0.75);
      expect(good?.seasonalFactor).toBeLessThanOrEqual(1.3);
    }
    const problems = findNonFiniteNumbers(scenario.state.economy.market);
    expect(problems).toEqual([]);
  });

  it('keeps every price clamped and finite across five simulated days', () => {
    const scenario = createScenario();
    advanceHours(scenario, 24 * 5);
    const market = scenario.economy.getMarket();
    for (const item of allFixtureItems()) {
      const good = market[item.id];
      expect(good, item.id).toBeDefined();
      if (!good) continue;
      const band = priceBand(item.basePrice > 0 ? item.basePrice : 1);
      expect(good.currentPrice, item.id).toBeGreaterThanOrEqual(band.min);
      expect(good.currentPrice, item.id).toBeLessThanOrEqual(band.max);
      expect(Number.isInteger(good.currentPrice), item.id).toBe(true);
      expect(good.trend, item.id).toBeGreaterThanOrEqual(-0.5);
      expect(good.trend, item.id).toBeLessThanOrEqual(0.5);
      expect(good.supply).toBeLessThanOrEqual(good.targetStock * 4 + 0.01);
      expect(good.demand).toBeLessThanOrEqual(good.targetStock * 4 + 0.01);
    }
    expect(scenario.state.economy.economicIndex).toBeGreaterThanOrEqual(0.5);
    expect(scenario.state.economy.economicIndex).toBeLessThanOrEqual(2);
    expect(findNonFiniteNumbers(scenario.state.economy)).toEqual([]);
  });

  it('moves prices over time (the market is alive)', () => {
    const scenario = createScenario();
    const before = marketSnapshot(scenario);
    advanceHours(scenario, 72);
    const after = marketSnapshot(scenario);
    const changed = before.filter((entry, index) => {
      const next = after[index];
      return next !== undefined && (entry.price !== next.price || entry.supply !== next.supply);
    });
    expect(changed.length).toBeGreaterThan(20);
  });

  it('reacts to player trade: buying raises demand, selling raises supply', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    const bread = scenario.economy.getMarketGood(ITEM.breadLoaf);
    expect(bread).toBeDefined();
    if (!bread) return;
    const demandBefore = bread.demand;
    const bought = scenario.economy.buyFromBusiness(BIZ.willowGrocery, ITEM.breadLoaf, 5);
    expect(bought.ok).toBe(true);
    advanceHours(scenario, 1);
    expect(bread.demand).toBeGreaterThan(demandBefore);

    addItemToInventory(scenario.state.player.inventory, ITEM.breadLoaf, 4, {
      quality: 2,
      simTime: scenario.clock.simTimeSeconds,
      maxStack: 20,
    });
    const supplyBefore = bread.supply;
    const sold = scenario.economy.sellToBusiness(BIZ.willowGrocery, ITEM.breadLoaf, 4);
    expect(sold.ok).toBe(true);
    advanceHours(scenario, 1);
    expect(bread.supply).toBeGreaterThan(supplyBefore);
  });

  it('updates seasonal factors when the season changes', () => {
    const scenario = createScenario({ startSimTime: 10 * HOUR });
    const turnip = scenario.economy.getMarketGood(ITEM.turnip);
    expect(turnip).toBeDefined();
    if (!turnip) return;
    scenario.state.world.environment.season = 'spring';
    advanceHours(scenario, 1);
    const springFactor = turnip.seasonalFactor;
    scenario.state.world.environment.season = 'winter';
    advanceHours(scenario, 1);
    const winterFactor = turnip.seasonalFactor;
    expect(winterFactor).not.toBe(springFactor);
    expect(winterFactor).toBeGreaterThan(springFactor);
  });

  it('is deterministic: same seed and same actions give identical markets', () => {
    const first = createScenario({ seed: 777 });
    const second = createScenario({ seed: 777 });
    advanceHours(first, 48);
    advanceHours(second, 48);
    expect(marketSnapshot(first)).toEqual(marketSnapshot(second));
    expect(first.state.economy.economicIndex).toBe(second.state.economy.economicIndex);
    const businessMoney = (scenario: typeof first) =>
      first.economy.getBusinesses().map((business) => [business.id, business.money] as const);
    expect(businessMoney(second)).toEqual(businessMoney(first));
  });

  it('produces the same state for hourly steps and one large offline-style step', () => {
    const hourly = createScenario({ seed: 424242 });
    const bulk = createScenario({ seed: 424242 });
    advanceHours(hourly, 48);
    advanceSimSeconds(bulk, 48 * HOUR);
    expect(marketSnapshot(bulk)).toEqual(marketSnapshot(hourly));
    const snapshot = (scenario: typeof hourly) =>
      scenario.economy.getBusinesses().map((business) => ({
        id: business.id,
        money: business.money,
        reputation: business.reputation,
        dailyRevenue: business.dailyRevenue,
        dailyCustomers: business.dailyCustomers,
      }));
    expect(snapshot(bulk)).toEqual(snapshot(hourly));
    const npcMoney = (scenario: typeof hourly) =>
      Object.values(scenario.state.npcs).map((npc) => [npc.id, npc.money] as const);
    expect(npcMoney(bulk)).toEqual(npcMoney(hourly));
  });

  it('emits transaction events for the player and not for NPC purchases', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    const result = scenario.economy.buyFromBusiness(BIZ.willowGrocery, ITEM.breadLoaf, 1);
    expect(result.ok).toBe(true);
    expect(eventsOf(scenario, 'transaction:completed').length).toBe(1);
    advanceHours(scenario, 3);
    // NPC customer purchases must not spam the UI event with player transactions.
    expect(eventsOf(scenario, 'transaction:completed').length).toBe(1);
  });
});