import { describe, expect, it } from 'vitest';
import {
  DAY,
  GROCERY_INTERIOR,
  HOUR,
  LIBRARY_INTERIOR,
  businessFor,
  clearEvents,
  createScenario,
  eventsOf,
  placePlayer,
  setClock,
} from './harness';
import { BIZ } from '../../src/data/shops/ids';
import { ITEM } from '../../src/data/items/ids';
import { addItemToInventory } from '../../src/core/InventoryUtil';
import type { BusinessState, ShopStockEntryState } from '../../src/core/contracts';

function stockLine(business: BusinessState, itemId: string): ShopStockEntryState {
  const line = business.stock.find((entry) => entry.itemId === itemId);
  if (!line) throw new Error('Missing stock line: ' + itemId);
  return line;
}

function itemCount(state: { player: { inventory: { itemId: string; quantity: number }[] } }, itemId: string): number {
  return state.player.inventory
    .filter((entry) => entry.itemId === itemId)
    .reduce((total, entry) => total + entry.quantity, 0);
}

describe('TransactionSystem: buying from businesses', () => {
  it('buys atomically and updates money, stock, inventory, stats and events', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    const business = businessFor(scenario, BIZ.willowGrocery);
    const line = stockLine(business, ITEM.breadLoaf);
    const playerMoneyBefore = scenario.state.player.money;
    const businessMoneyBefore = business.money;
    const stockBefore = line.quantity;
    const carriedBefore = itemCount(scenario.state, ITEM.breadLoaf);
    const expectedTotal = line.price * 2;
    clearEvents(scenario);

    const result = scenario.economy.buyFromBusiness(BIZ.willowGrocery, ITEM.breadLoaf, 2);

    expect(result.ok).toBe(true);
    expect(result.stateChanged).toBe(true);
    expect(scenario.state.player.money).toBe(playerMoneyBefore - expectedTotal);
    expect(business.money).toBe(businessMoneyBefore + expectedTotal);
    expect(line.quantity).toBe(stockBefore - 2);
    expect(itemCount(scenario.state, ITEM.breadLoaf)).toBe(carriedBefore + 2);
    expect(scenario.state.player.statistics.itemsBought).toBe(2);
    expect(scenario.state.player.statistics.moneySpent).toBe(expectedTotal);
    expect(business.dailyRevenue).toBe(expectedTotal);
    expect(business.dailyCustomers).toBe(1);
    expect(scenario.state.economy.transactions.at(-1)?.type).toBe('buy');

    const moneyEvents = eventsOf(scenario, 'money:changed');
    expect(moneyEvents).toHaveLength(1);
    const moneyPayload = moneyEvents[0]?.payload as { amount: number; balance: number; reason: string };
    expect(moneyPayload.amount).toBe(-expectedTotal);
    expect(moneyPayload.balance).toBe(playerMoneyBefore - expectedTotal);
    expect(eventsOf(scenario, 'item:acquired')).toHaveLength(1);
    expect(eventsOf(scenario, 'transaction:completed')).toHaveLength(1);
    expect(scenario.state.player.money).toBeGreaterThanOrEqual(0);
  });

  it('rejects a purchase outside the business location without mutating state', () => {
    const scenario = createScenario({ startSimTime: 10 * HOUR });
    const business = businessFor(scenario, BIZ.willowGrocery);
    const line = stockLine(business, ITEM.breadLoaf);
    const moneyBefore = scenario.state.player.money;
    const stockBefore = line.quantity;
    const transactionsBefore = scenario.state.economy.transactions.length;

    const result = scenario.economy.buyFromBusiness(BIZ.willowGrocery, ITEM.breadLoaf, 1);

    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong_location');
    expect(scenario.state.player.money).toBe(moneyBefore);
    expect(line.quantity).toBe(stockBefore);
    expect(scenario.state.economy.transactions.length).toBe(transactionsBefore);
  });

  it('rejects a purchase when the shop is closed or on a weekly closing day', () => {
    const night = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 23 * HOUR });
    const nightResult = night.economy.buyFromBusiness(BIZ.willowGrocery, ITEM.breadLoaf, 1);
    expect(nightResult.ok).toBe(false);
    expect(nightResult.code).toBe('wrong_time');

    // Libraries are closed on Mondays (day 0 in the sim calendar).
    const monday = createScenario({ playerLocationId: LIBRARY_INTERIOR, startSimTime: 10 * HOUR });
    expect(monday.economy.isBusinessOpen(BIZ.willowLibrary)).toBe(false);
    const mondayResult = monday.economy.buyFromBusiness(BIZ.willowLibrary, ITEM.gardeningBook, 1);
    expect(mondayResult.ok).toBe(false);
    expect(mondayResult.code).toBe('wrong_time');

    const tuesday = createScenario({ playerLocationId: LIBRARY_INTERIOR, startSimTime: DAY + 10 * HOUR });
    expect(tuesday.economy.isBusinessOpen(BIZ.willowLibrary)).toBe(true);
    const bookResult = tuesday.economy.buyFromBusiness(BIZ.willowLibrary, ITEM.gardeningBook, 1);
    expect(bookResult.ok).toBe(true);
  });

  it('rejects out-of-stock and unaffordable purchases without side effects', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    const business = businessFor(scenario, BIZ.willowGrocery);
    const line = stockLine(business, ITEM.breadLoaf);

    const tooMany = scenario.economy.buyFromBusiness(BIZ.willowGrocery, ITEM.breadLoaf, 500);
    expect(tooMany.ok).toBe(false);
    expect(tooMany.code).toBe('not_enough_items');
    expect(line.quantity).toBeGreaterThan(0);

    const unknownItem = scenario.economy.buyFromBusiness(BIZ.willowGrocery, ITEM.goldenSeed, 1);
    expect(unknownItem.ok).toBe(false);
    expect(unknownItem.code).toBe('not_found');

    const moneyBefore = scenario.state.player.money;
    scenario.state.player.money = 1;
    const poor = scenario.economy.buyFromBusiness(BIZ.willowGrocery, ITEM.breadLoaf, 1);
    expect(poor.ok).toBe(false);
    expect(poor.code).toBe('not_enough_money');
    expect(scenario.state.player.money).toBe(1);
    scenario.state.player.money = moneyBefore;
  });
});

describe('TransactionSystem: selling to businesses', () => {
  it('pays 60% of the current market price and takes the items', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    const business = businessFor(scenario, BIZ.willowGrocery);
    const good = scenario.economy.getMarketGood(ITEM.breadLoaf);
    expect(good).toBeDefined();
    const expectedUnit = Math.max(1, Math.round((good?.currentPrice ?? 120) * 0.6));
    addItemToInventory(scenario.state.player.inventory, ITEM.breadLoaf, 3, {
      quality: 2,
      simTime: scenario.clock.simTimeSeconds,
      maxStack: 20,
    });
    const moneyBefore = scenario.state.player.money;
    const businessMoneyBefore = business.money;
    const carriedBefore = itemCount(scenario.state, ITEM.breadLoaf);
    clearEvents(scenario);

    const result = scenario.economy.sellToBusiness(BIZ.willowGrocery, ITEM.breadLoaf, 2);

    expect(result.ok).toBe(true);
    expect(result.message).toContain('Sold');
    expect(scenario.state.player.money).toBe(moneyBefore + expectedUnit * 2);
    expect(business.money).toBe(businessMoneyBefore - expectedUnit * 2);
    expect(itemCount(scenario.state, ITEM.breadLoaf)).toBe(carriedBefore - 2);
    expect(scenario.state.player.statistics.itemsSold).toBe(2);
    expect(scenario.state.economy.transactions.at(-1)?.type).toBe('sell');
    expect(eventsOf(scenario, 'item:lost')).toHaveLength(1);
    expect(eventsOf(scenario, 'money:changed')).toHaveLength(1);
  });

  it('rejects selling items the player does not carry, and overdrawing the shop till', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    const business = businessFor(scenario, BIZ.willowGrocery);
    const noItems = scenario.economy.sellToBusiness(BIZ.willowGrocery, ITEM.fossil, 1);
    expect(noItems.ok).toBe(false);
    expect(noItems.code).toBe('not_enough_items');

    addItemToInventory(scenario.state.player.inventory, ITEM.breadLoaf, 1, {
      quality: 2,
      simTime: scenario.clock.simTimeSeconds,
      maxStack: 20,
    });
    const carriedBefore = itemCount(scenario.state, ITEM.breadLoaf);
    const playerMoneyBefore = scenario.state.player.money;
    const businessMoneyBefore = business.money;
    business.money = 1;
    const broke = scenario.economy.sellToBusiness(BIZ.willowGrocery, ITEM.breadLoaf, 1);
    expect(broke.ok).toBe(false);
    expect(broke.code).toBe('not_enough_money');
    expect(itemCount(scenario.state, ITEM.breadLoaf)).toBe(carriedBefore);
    expect(scenario.state.player.money).toBe(playerMoneyBefore);
    business.money = businessMoneyBefore;
  });

  it('sells a specific inventory instance when an instance id is supplied', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    const entry = addItemToInventory(scenario.state.player.inventory, ITEM.cheeseWedge, 2, {
      quality: 3,
      simTime: scenario.clock.simTimeSeconds,
      maxStack: 10,
    })[0];
    expect(entry).toBeDefined();
    if (!entry) return;
    const result = scenario.economy.sellToBusiness(BIZ.willowGrocery, ITEM.cheeseWedge, 1, entry.instanceId);
    expect(result.ok, result.message).toBe(true);
    expect(entry.quantity).toBe(1);
    const wrongInstance = scenario.economy.sellToBusiness(BIZ.willowGrocery, ITEM.breadLoaf, 1, entry.instanceId);
    expect(wrongInstance.ok).toBe(false);
    expect(wrongInstance.code).toBe('not_found');
  });

  it('refuses selling to your own shop and trading at a closed business', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    scenario.state.player.money = 500000;
    const purchased = scenario.economy.buyPlayerShop(BIZ.willowGrocery);
    expect(purchased.ok).toBe(true);
    const result = scenario.economy.sellToBusiness(BIZ.willowGrocery, ITEM.breadLoaf, 1);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_allowed');

    const night = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 23 * HOUR });
    addItemToInventory(night.state.player.inventory, ITEM.breadLoaf, 1, {
      quality: 2,
      simTime: night.clock.simTimeSeconds,
      maxStack: 20,
    });
    const closed = night.economy.sellToBusiness(BIZ.willowGrocery, ITEM.breadLoaf, 1);
    expect(closed.ok).toBe(false);
    expect(closed.code).toBe('wrong_time');
  });

  it('keeps the transaction ring capped and ordered newest-first', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    scenario.state.player.money = 1000000;
    for (let index = 0; index < 120; index += 1) {
      const line = stockLine(businessFor(scenario, BIZ.willowGrocery), ITEM.breadLoaf);
      if (line.quantity < 1) line.quantity = 50;
      scenario.economy.buyFromBusiness(BIZ.willowGrocery, ITEM.breadLoaf, 1);
    }
    expect(scenario.state.economy.transactions.length).toBeLessThanOrEqual(100);
    const recent = scenario.economy.getRecentTransactions(5);
    expect(recent).toHaveLength(5);
    for (let index = 1; index < recent.length; index += 1) {
      expect(recent[index - 1]!.at).toBeGreaterThanOrEqual(recent[index]!.at);
    }
  });
});