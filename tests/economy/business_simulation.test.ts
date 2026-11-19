import { describe, expect, it } from 'vitest';
import {
  DAY,
  HOUR,
  advanceHours,
  businessFor,
  createScenario,
  jobFor,
  npcFor,
} from './harness';
import { BIZ } from '../../src/data/shops/ids';
import { ITEM } from '../../src/data/items/ids';
import { NPC } from '../../src/data/npcs/ids';
import type { BusinessState } from '../../src/core/contracts';

function stockTotal(business: BusinessState): number {
  return business.stock.reduce((total, line) => total + line.quantity, 0);
}

describe('Business customer simulation', () => {
  it('serves customers during opening hours and books real revenue', () => {
    const scenario = createScenario({ startSimTime: 8 * HOUR });
    const cafe = businessFor(scenario, BIZ.willowCafe);
    const stockBefore = stockTotal(cafe);
    const npcMoneyBefore = Object.fromEntries(
      Object.values(scenario.state.npcs).map((npc) => [npc.id, npc.money])
    );

    advanceHours(scenario, 10); // 08:00 -> 18:00, the full cafe trading day

    expect(cafe.dailyRevenue).toBeGreaterThan(0);
    expect(cafe.dailyCustomers).toBeGreaterThan(0);
    expect(cafe.totalRevenue).toBe(cafe.dailyRevenue);
    expect(stockTotal(cafe)).toBeLessThan(stockBefore);
    expect(cafe.money).toBeGreaterThan(0);
    for (const npc of Object.values(scenario.state.npcs)) {
      expect(Number.isFinite(npc.money), npc.id).toBe(true);
      expect(npc.money, npc.id).toBeGreaterThanOrEqual(0);
      expect(npc.money, npc.id).toBeLessThanOrEqual(npcMoneyBefore[npc.id] ?? npc.money);
    }
    const npcPurchases = scenario.state.economy.transactions.filter(
      (record) => record.type === 'buy' && record.actorId !== scenario.state.player.id
    );
    expect(npcPurchases.length).toBeGreaterThan(0);
    expect(npcPurchases.every((record) => record.quantity === 1 && record.totalPrice > 0)).toBe(true);
  });

  it('stays shut outside opening hours and on weekly closing days', () => {
    const late = createScenario({ startSimTime: 19 * HOUR });
    const cafe = businessFor(late, BIZ.willowCafe);
    expect(late.economy.isBusinessOpen(BIZ.willowCafe)).toBe(false);
    advanceHours(late, 3);
    expect(cafe.dailyRevenue).toBe(0);
    expect(cafe.dailyCustomers).toBe(0);

    const monday = createScenario({ startSimTime: 10 * HOUR });
    expect(monday.economy.isBusinessOpen(BIZ.ashfordMuseum)).toBe(false);
    expect(monday.economy.isBusinessOpen(BIZ.willowLibrary)).toBe(false);
    const tuesday = createScenario({ startSimTime: DAY + 10 * HOUR });
    expect(tuesday.economy.isBusinessOpen(BIZ.ashfordMuseum)).toBe(true);
    expect(tuesday.economy.isBusinessOpen(BIZ.willowLibrary)).toBe(true);
  });

  it('restocks NPC-owned shops every morning at 07:00 and pays wholesale costs', () => {
    const scenario = createScenario({ startSimTime: 8 * HOUR });
    const grocery = businessFor(scenario, BIZ.willowGrocery);
    advanceHours(scenario, 14); // to 22:00 after a full trading day
    const depleted = grocery.stock.filter((line) => line.quantity < line.targetStock);
    expect(depleted.length).toBeGreaterThan(0);
    const quantitiesBefore = new Map(depleted.map((line) => [line.itemId, line.quantity]));
    const expensesAfterSettlement = grocery.dailyExpenses;

    advanceHours(scenario, 10); // to next day 08:00 -> the 07:00 restock runs

    for (const line of depleted) {
      expect(
        line.quantity,
        'restock should top up depleted line ' + line.itemId
      ).toBeGreaterThan(quantitiesBefore.get(line.itemId) ?? 0);
    }
    expect(grocery.dailyExpenses).toBeGreaterThan(expensesAfterSettlement);
    expect(grocery.dailyExpenses).toBeGreaterThan(0);
  });

  it('pays NPC wages and owner income at the 22:00 settlement, idempotently', () => {
    const scenario = createScenario({ startSimTime: 8 * HOUR });
    const cafe = businessFor(scenario, BIZ.willowCafe);
    const baristaJob = jobFor(scenario, BIZ.willowCafe, 0);
    expect(baristaJob.employeeIds.length).toBeGreaterThan(0);
    advanceHours(scenario, 14); // to 22:00, just before settlement

    const employees = baristaJob.employeeIds.map((npcId) => npcFor(scenario, npcId));
    const employeeMoneyBefore = employees.reduce((total, npc) => total + npc.money, 0);
    const ownerBefore = npcFor(scenario, NPC.sylviaReed).money;
    const expectedWages = employees.length * baristaJob.wagePerHour;

    advanceHours(scenario, 1); // 22:00-23:00 hour -> settlement runs

    expect(cafe.history.length).toBe(1);
    const record = cafe.history[0];
    expect(record?.day).toBe(0);
    expect(record?.revenue).toBeGreaterThan(0);
    expect(record?.customers).toBeGreaterThan(0);
    expect(cafe.dailyRevenue).toBe(0);
    expect(cafe.dailyExpenses).toBe(0);
    expect(cafe.lastSettledAt).toBe(22 * HOUR);

    const wageRecords = scenario.state.economy.transactions.filter(
      (entry) => entry.type === 'wage' && entry.businessId === BIZ.willowCafe
    );
    expect(wageRecords.length).toBe(1);
    expect(wageRecords[0]?.totalPrice).toBe(expectedWages);
    const employeeMoneyAfter = employees.reduce((total, npc) => total + npc.money, 0);
    expect(employeeMoneyAfter).toBeGreaterThan(employeeMoneyBefore + expectedWages - 1400);
    expect(npcFor(scenario, NPC.sylviaReed).money).toBeGreaterThan(ownerBefore);

    const historyAfterFirstSettlement = cafe.history.length;
    scenario.economy.update(0);
    scenario.economy.update(0);
    expect(cafe.history.length).toBe(historyAfterFirstSettlement);
    advanceHours(scenario, 24); // clock reaches day 1 23:00 so the 22:00 settlement hour runs
    expect(cafe.history.length).toBe(2);
    expect(cafe.history[1]?.day).toBe(1);
    expect(scenario.state.economy.lastDailySettlementDay).toBe(1);
  });

  it('caps the business day history at 60 records', () => {
    const scenario = createScenario({ startSimTime: 21 * HOUR });
    const grocery = businessFor(scenario, BIZ.willowGrocery);
    for (let index = 0; index < 70; index += 1) {
      grocery.history.push({ day: index - 100, revenue: 1, expenses: 0, customers: 0, stockValue: 0 });
    }
    advanceHours(scenario, 2); // 21:00 -> 23:00, day 0 settlement
    expect(grocery.history.length).toBe(60);
    expect(grocery.history.at(-1)?.day).toBe(0);
  });

  it('never lets business, NPC or player money go negative over three days', () => {
    const scenario = createScenario({ startSimTime: 7 * HOUR });
    advanceHours(scenario, 24 * 3);
    expect(scenario.state.player.money).toBeGreaterThanOrEqual(0);
    for (const business of scenario.economy.getBusinesses()) {
      expect(Number.isFinite(business.money), business.id).toBe(true);
      expect(business.money, business.id).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(business.reputation), business.id).toBe(true);
      expect(business.reputation, business.id).toBeGreaterThanOrEqual(0);
      expect(business.reputation, business.id).toBeLessThanOrEqual(100);
      expect(business.history.length, business.id).toBeLessThanOrEqual(60);
      for (const line of business.stock) {
        expect(line.quantity, business.id + ' ' + line.itemId).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(line.price), business.id).toBe(true);
      }
    }
    for (const npc of Object.values(scenario.state.npcs)) {
      expect(Number.isFinite(npc.money), npc.id).toBe(true);
      expect(npc.money, npc.id).toBeGreaterThanOrEqual(0);
    }
    expect(scenario.state.economy.transactions.length).toBeLessThanOrEqual(100);
  });

  it('stocks shops with item ids that all exist in the content pack', () => {
    const scenario = createScenario();
    for (const business of scenario.economy.getBusinesses()) {
      for (const line of business.stock) {
        expect(scenario.content.getItem(line.itemId), business.id + ' ' + line.itemId).toBeDefined();
      }
    }
    // Sampling a couple of known products keeps the data assertion honest.
    expect(scenario.content.getItem(ITEM.breadLoaf)).toBeDefined();
    expect(scenario.content.getItem(ITEM.teaCup)).toBeDefined();
  });
});