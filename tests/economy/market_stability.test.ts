import { describe, expect, it } from 'vitest';
import type { IEconomySystem } from '../../src/core/contracts';
import { IEconomy_METHODS } from './contract_methods';
import {
  DAY,
  HOUR,
  advanceHours,
  advanceSimSeconds,
  allFixtureItems,
  createScenario,
  findNonFiniteNumbers,
  marketSnapshot,
} from './harness';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import { BIZ } from '../../src/data/shops/ids';
import { ITEM } from '../../src/data/items/ids';
import { GROCERY_INTERIOR } from './harness';
import { LOC } from '../../src/data/locations/ids';

function priceBand(basePrice: number): { min: number; max: number } {
  return {
    min: Math.max(1, Math.floor(basePrice * WORLD_CONFIG.economy.priceClampMin) - 1),
    max: Math.ceil(basePrice * WORLD_CONFIG.economy.priceClampMax) + 1,
  };
}

describe('Economy contract surface', () => {
  it('implements every IEconomySystem method with the registered id', () => {
    const scenario = createScenario();
    const system: IEconomySystem = scenario.economy;
    expect(system.id).toBe('economy');
    expect(typeof system.init).toBe('function');
    expect(typeof system.update).toBe('function');
    for (const method of IEconomy_METHODS) {
      expect(typeof (system as unknown as Record<string, unknown>)[method], method).toBe('function');
    }
    // Extra documented helpers beyond the frozen contract.
    expect(typeof scenario.economy.isBusinessOpen).toBe('function');
    expect(typeof scenario.economy.getPlayerJob).toBe('function');
    expect(typeof scenario.economy.getPlayerShopQuote).toBe('function');
  });

  it('exposes location/job/stock getters that agree with state', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    const grocery = scenario.economy.getBusiness(BIZ.willowGrocery);
    expect(grocery).toBeDefined();
    expect(scenario.economy.getBusinessDef(BIZ.willowGrocery)?.name).toBe(grocery?.name);
    expect(scenario.economy.getBusinessStock(BIZ.willowGrocery)).toBe(grocery?.stock);
    const atLocation = scenario.economy.getBusinessesAtLocation(GROCERY_INTERIOR);
    expect(atLocation.map((business) => business.id)).toContain(BIZ.willowGrocery);
    const exteriorAt = scenario.economy.getBusinessesAtLocation(LOC.grocery);
    expect(exteriorAt.map((business) => business.id)).toContain(BIZ.willowGrocery);
    const jobsAtLocation = scenario.economy.getJobsAtLocation(GROCERY_INTERIOR);
    expect(jobsAtLocation.length).toBeGreaterThanOrEqual(3);
    expect(jobsAtLocation.every((job) => job.businessId === BIZ.willowGrocery)).toBe(true);
    const good = scenario.economy.getMarketGood(ITEM.breadLoaf);
    expect(scenario.economy.getMarket()[ITEM.breadLoaf]).toBe(good);
    expect(scenario.economy.getRecentTransactions().length).toBe(0);
    expect(scenario.economy.getPlayerShop()).toBeNull();
    expect(scenario.economy.getPlayerJob()).toBeNull();
  });

  it('repairs corrupted economy numbers on init instead of propagating NaN', () => {
    const scenario = createScenario({ startSimTime: 10 * HOUR });
    const bread = scenario.economy.getMarketGood(ITEM.breadLoaf);
    if (!bread) throw new Error('missing bread market');
    bread.currentPrice = Number.NaN;
    bread.supply = Number.POSITIVE_INFINITY;
    bread.demand = Number.NaN;
    const business = scenario.economy.getBusiness(BIZ.willowGrocery);
    if (!business) throw new Error('missing grocery');
    business.money = Number.NEGATIVE_INFINITY;
    business.reputation = Number.NaN;
    scenario.state.economy.economicIndex = Number.NaN;
    scenario.state.economy.lastMarketSettlementAt = Number.NaN;
    scenario.economy.init(scenario.ctx);
    expect(findNonFiniteNumbers(scenario.state.economy)).toEqual([]);
    expect(business.money).toBeGreaterThanOrEqual(0);
    expect(bread.currentPrice).toBeGreaterThan(0);
  });

  it('re-initialising is idempotent (safe on save/load)', () => {
    const scenario = createScenario({ startSimTime: 9 * HOUR });
    advanceHours(scenario, 6);
    const employeesBefore = scenario.economy
      .getBusinesses()
      .map((business) => [business.id, [...business.employees].sort()]);
    const moneyBefore = scenario.economy.getBusinesses().map((business) => [business.id, business.money]);
    const marketSizeBefore = Object.keys(scenario.economy.getMarket()).length;

    scenario.economy.init(scenario.ctx);

    const employeesAfter = scenario.economy
      .getBusinesses()
      .map((business) => [business.id, [...business.employees].sort()]);
    const moneyAfter = scenario.economy.getBusinesses().map((business) => [business.id, business.money]);
    expect(employeesAfter).toEqual(employeesBefore);
    expect(moneyAfter).toEqual(moneyBefore);
    expect(Object.keys(scenario.economy.getMarket()).length).toBe(marketSizeBefore);
    expect(findNonFiniteNumbers(scenario.state.economy)).toEqual([]);
  });
});

describe('Economy stability', () => {
  it('runs 30 game days without NaN, negative money or unclamped prices', () => {
    const scenario = createScenario({ startSimTime: 8 * HOUR });
    advanceHours(scenario, 24 * 30);

    expect(scenario.clock.simTimeSeconds).toBe(8 * HOUR + 24 * 30 * HOUR);
    expect(findNonFiniteNumbers(scenario.state.economy)).toEqual([]);
    expect(findNonFiniteNumbers(scenario.state.player.money)).toEqual([]);
    expect(findNonFiniteNumbers(Object.values(scenario.state.npcs).map((npc) => npc.money))).toEqual([]);

    const market = scenario.economy.getMarket();
    let ratioSum = 0;
    let ratioCount = 0;
    for (const item of allFixtureItems()) {
      const good = market[item.id];
      expect(good, 'market good ' + item.id).toBeDefined();
      if (!good) continue;
      const effectiveBase = item.basePrice > 0 ? item.basePrice : 1;
      const band = priceBand(effectiveBase);
      expect(good.currentPrice, item.id + ' price clamped').toBeGreaterThanOrEqual(band.min);
      expect(good.currentPrice, item.id + ' price clamped').toBeLessThanOrEqual(band.max);
      expect(Number.isInteger(good.currentPrice), item.id).toBe(true);
      expect(good.trend, item.id).toBeGreaterThanOrEqual(-0.5);
      expect(good.trend, item.id).toBeLessThanOrEqual(0.5);
      expect(good.supply, item.id).toBeGreaterThanOrEqual(1);
      expect(good.demand, item.id).toBeGreaterThanOrEqual(1);
      expect(good.supply, item.id).toBeLessThanOrEqual(good.targetStock * 4 + 0.01);
      expect(good.demand, item.id).toBeLessThanOrEqual(good.targetStock * 4 + 0.01);
      ratioSum += good.currentPrice / Math.max(1, effectiveBase);
      ratioCount += 1;
    }
    expect(ratioCount).toBeGreaterThan(200);
    const meanRatio = ratioSum / ratioCount;
    expect(meanRatio).toBeGreaterThan(0.6);
    expect(meanRatio).toBeLessThan(1.6);
    expect(scenario.state.economy.economicIndex).toBeGreaterThanOrEqual(0.5);
    expect(scenario.state.economy.economicIndex).toBeLessThanOrEqual(2);

    expect(scenario.state.player.money).toBeGreaterThanOrEqual(0);
    let settledBusinesses = 0;
    for (const business of scenario.economy.getBusinesses()) {
      expect(Number.isFinite(business.money), business.id).toBe(true);
      expect(business.money, business.id).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(business.money), business.id).toBe(true);
      expect(business.reputation, business.id).toBeGreaterThanOrEqual(0);
      expect(business.reputation, business.id).toBeLessThanOrEqual(100);
      expect(business.history.length, business.id).toBeLessThanOrEqual(60);
      // Every NPC-run business must have settled exactly once per simulated day (30 days).
      expect(business.history.length, business.id + ' settlements').toBe(30);
      for (const record of business.history) {
        expect(record.revenue, business.id).toBeGreaterThanOrEqual(0);
        expect(record.expenses, business.id).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(record.stockValue), business.id).toBe(true);
      }
      settledBusinesses += 1;
    }
    expect(settledBusinesses).toBe(22);
    for (const npc of Object.values(scenario.state.npcs)) {
      expect(Number.isFinite(npc.money), npc.id).toBe(true);
      expect(npc.money, npc.id).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(npc.money), npc.id).toBe(true);
    }
    expect(scenario.state.economy.transactions.length).toBeLessThanOrEqual(100);
    // The economy must still be trading at the end of the month.
    const totalBusinessMoney = scenario.economy.getBusinesses().reduce((total, business) => total + business.money, 0);
    expect(totalBusinessMoney).toBeGreaterThan(0);
  });

  it('processes a large offline-style step to the exact requested hour', () => {
    const scenario = createScenario({ startSimTime: 8 * HOUR });
    advanceSimSeconds(scenario, 10 * DAY);
    const simulatedHours = Math.floor(scenario.clock.simTimeSeconds / HOUR);
    expect(scenario.state.economy.lastMarketSettlementAt).toBe(simulatedHours * HOUR);
    expect(findNonFiniteNumbers(scenario.state.economy)).toEqual([]);
    expect(scenario.state.economy.transactions.length).toBeLessThanOrEqual(100);
  });

  it('keeps the same-seed market reproducible after a month', () => {
    const first = createScenario({ seed: 31337, startSimTime: 8 * HOUR });
    advanceHours(first, 24 * 3);
    const payload = JSON.stringify(marketSnapshot(first));
    const restored = createScenario({ seed: 31337, startSimTime: 8 * HOUR });
    advanceHours(restored, 24 * 3);
    expect(JSON.stringify(marketSnapshot(restored))).toBe(payload);
  });
});