import { describe, expect, it } from 'vitest';
import {
  DAY,
  GROCERY_INTERIOR,
  HOUR,
  advanceHours,
  businessFor,
  createScenario,
  eventsOf,
  placePlayer,
} from './harness';
import { BIZ } from '../../src/data/shops/ids';
import { ITEM } from '../../src/data/items/ids';
import { NPC } from '../../src/data/npcs/ids';
import { interiorIdFor, LOC } from '../../src/data/locations/ids';
import type { EconomyScenario } from './harness';

function buyGrocery(scenario: EconomyScenario): void {
  scenario.state.player.money = 500000;
  const quote = scenario.economy.getPlayerShopQuote(BIZ.willowGrocery);
  expect(quote?.purchasable).toBe(true);
  const result = scenario.economy.buyPlayerShop(BIZ.willowGrocery);
  expect(result.ok, result.message).toBe(true);
}

function shopLine(scenario: EconomyScenario, itemId: string) {
  const shop = scenario.economy.getPlayerShop();
  expect(shop).not.toBeNull();
  const business = scenario.economy.getBusiness(shop?.businessId ?? '');
  const line = business?.stock.find((entry) => entry.itemId === itemId);
  expect(line).toBeDefined();
  return line!;
}

describe('PlayerShopSystem: buying a business', () => {
  it('buys a for-sale business, transfers employees and records the purchase', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    scenario.state.player.money = 500000;
    const business = businessFor(scenario, BIZ.willowGrocery);
    const price = scenario.economy.getPlayerShopQuote(BIZ.willowGrocery)?.pricePence ?? 0;
    expect(price).toBeGreaterThan(50000);
    expect(price).toBeLessThan(400000);
    const employeesBefore = [...business.employees];
    const moneyBefore = scenario.state.player.money;

    const result = scenario.economy.buyPlayerShop(BIZ.willowGrocery);

    expect(result.ok, result.message).toBe(true);
    expect(scenario.state.player.money).toBe(moneyBefore - price);
    expect(business.isPlayerOwned).toBe(true);
    expect(business.ownerNpcId).toBeNull();
    const shop = scenario.economy.getPlayerShop();
    expect(shop).not.toBeNull();
    expect(shop?.businessId).toBe(BIZ.willowGrocery);
    expect(shop?.locationId).toBe(business.locationId);
    expect(shop?.regionId).toBe('willowbrook');
    expect(shop?.open).toBe(true);
    expect(shop?.employees.map((employee) => employee.npcId).sort()).toEqual(employeesBefore.sort());
    expect(shop?.reputation).toBe(business.reputation);
    expect(scenario.state.player.statistics.businessesOwned).toBe(1);
    const purchase = scenario.state.economy.transactions.filter(
      (record) => record.type === 'buy' && record.businessId === BIZ.willowGrocery
    );
    expect(purchase.at(-1)?.totalPrice).toBe(price);
    expect(eventsOf(scenario, 'money:changed').length).toBe(1);
    expect(
      eventsOf(scenario, 'game:signal').some(
        (event) => (event.payload as { name: string }).name === 'economy:business_bought'
      )
    ).toBe(true);
  });

  it('refuses public services, NPC-owned shops, unaffordable shops and remote purchases', () => {
    const library = createScenario({ playerLocationId: interiorIdFor(LOC.library), startSimTime: DAY + 10 * HOUR });
    library.state.player.money = 500000;
    const publicService = library.economy.buyPlayerShop(BIZ.willowLibrary);
    expect(publicService.ok).toBe(false);
    expect(publicService.code).toBe('not_allowed');

    const owned = createScenario({ playerLocationId: interiorIdFor(LOC.cafe), startSimTime: 10 * HOUR });
    owned.state.player.money = 500000;
    const npcOwned = owned.economy.buyPlayerShop(BIZ.willowCafe);
    expect(npcOwned.ok).toBe(false);
    expect(npcOwned.code).toBe('not_allowed');

    const poor = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    poor.state.player.money = 1000;
    const unaffordable = poor.economy.buyPlayerShop(BIZ.willowGrocery);
    expect(unaffordable.ok).toBe(false);
    expect(unaffordable.code).toBe('not_enough_money');
    expect(poor.economy.getPlayerShop()).toBeNull();

    const remote = createScenario({ startSimTime: 10 * HOUR });
    remote.state.player.money = 500000;
    const wrongPlace = remote.economy.buyPlayerShop(BIZ.willowGrocery);
    expect(wrongPlace.ok).toBe(false);
    expect(wrongPlace.code).toBe('wrong_location');

    const buyer = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    buyer.state.player.money = 900000;
    expect(buyer.economy.buyPlayerShop(BIZ.willowGrocery).ok).toBe(true);
    const second = buyer.economy.buyPlayerShop(BIZ.ashfordSupermarket);
    expect(second.ok).toBe(false);
    expect(second.code).toBe('not_allowed');
  });
});

describe('PlayerShopSystem: pricing, restocking and opening', () => {
  it('clamps player prices to the 40-250% base band and keeps them across settlements', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    buyGrocery(scenario);
    const base = scenario.content.getItem(ITEM.breadLoaf)?.basePrice ?? 120;

    const tooCheap = scenario.economy.setPlayerShopPrice(ITEM.breadLoaf, 1);
    expect(tooCheap.ok).toBe(true);
    expect(shopLine(scenario, ITEM.breadLoaf).price).toBe(Math.round(base * 0.4));

    const tooDear = scenario.economy.setPlayerShopPrice(ITEM.breadLoaf, 999999);
    expect(tooDear.ok).toBe(true);
    expect(shopLine(scenario, ITEM.breadLoaf).price).toBe(Math.round(base * 2.5));

    const fair = scenario.economy.setPlayerShopPrice(ITEM.breadLoaf, 177);
    expect(fair.ok).toBe(true);
    expect(shopLine(scenario, ITEM.breadLoaf).price).toBe(177);
    const unknown = scenario.economy.setPlayerShopPrice(ITEM.fossil, 100);
    expect(unknown.ok).toBe(false);
    expect(unknown.code).toBe('not_found');

    advanceHours(scenario, 2);
    expect(shopLine(scenario, ITEM.breadLoaf).price).toBe(177);

    const noShop = createScenario({ startSimTime: 10 * HOUR });
    const notOwner = noShop.economy.setPlayerShopPrice(ITEM.breadLoaf, 100);
    expect(notOwner.ok).toBe(false);
    expect(notOwner.code).toBe('not_allowed');
  });

  it('restocks wholesale from the player wallet and records the expense', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    buyGrocery(scenario);
    const line = shopLine(scenario, ITEM.breadLoaf);
    const quantityBefore = line.quantity;
    const moneyBefore = scenario.state.player.money;
    const marketPrice = scenario.economy.getMarketGood(ITEM.breadLoaf)?.currentPrice ?? 120;
    const expectedUnit = Math.max(1, Math.round(marketPrice * 0.55));

    const result = scenario.economy.restockPlayerShop(ITEM.breadLoaf, 10);

    expect(result.ok, result.message).toBe(true);
    expect(line.quantity).toBe(quantityBefore + 10);
    expect(scenario.state.player.money).toBe(moneyBefore - expectedUnit * 10);
    expect(scenario.economy.getPlayerShop()?.totalExpenses).toBe(expectedUnit * 10);
    expect(scenario.state.economy.transactions.at(-1)?.type).toBe('shop_expense');

    const invalid = scenario.economy.restockPlayerShop(ITEM.breadLoaf, 0);
    expect(invalid.ok).toBe(false);
    expect(invalid.code).toBe('invalid');
    const unstocked = scenario.economy.restockPlayerShop(ITEM.fossil, 1);
    expect(unstocked.ok).toBe(false);
    expect(unstocked.code).toBe('not_found');

    scenario.state.player.money = 1;
    const poor = scenario.economy.restockPlayerShop(ITEM.breadLoaf, 5);
    expect(poor.ok).toBe(false);
    expect(poor.code).toBe('not_enough_money');
  });

  it('toggles the shop open and closed, stopping customer trade while shut', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    buyGrocery(scenario);
    const business = businessFor(scenario, BIZ.willowGrocery);

    const closed = scenario.economy.togglePlayerShopOpen(false);
    expect(closed.ok).toBe(true);
    expect(business.isOpen).toBe(false);
    expect(scenario.economy.isBusinessOpen(BIZ.willowGrocery)).toBe(false);
    advanceHours(scenario, 2);
    expect(business.dailyRevenue).toBe(0);
    expect(business.dailyCustomers).toBe(0);

    const reopened = scenario.economy.togglePlayerShopOpen(true);
    expect(reopened.ok).toBe(true);
    expect(business.isOpen).toBe(true);
    advanceHours(scenario, 2);
    expect(business.dailyRevenue).toBeGreaterThan(0);
  });

  it('hires and fires up to three employees', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    buyGrocery(scenario);
    const shop = scenario.economy.getPlayerShop();
    if (!shop) throw new Error('no shop');
    const candidates = [NPC.elizaThorne, NPC.claraBright, NPC.rufusMarsh, NPC.ninaOkoye];
    let hired = 0;
    for (const npcId of candidates) {
      if (shop.employees.length >= 3) break;
      const before = shop.employees.length;
      const result = scenario.economy.hireEmployee(npcId);
      expect(result.ok, result.message).toBe(true);
      expect(shop.employees.length).toBe(before + 1);
      hired += 1;
      expect(shop.employees.some((employee) => employee.npcId === npcId)).toBe(true);
      expect(shop.employees.find((employee) => employee.npcId === npcId)?.wagePerHour).toBeGreaterThan(0);
      expect(scenario.state.npcs[npcId]?.money).toBeGreaterThanOrEqual(0);
    }
    expect(hired).toBeGreaterThanOrEqual(1);
    expect(shop.employees.length).toBe(3);
    const overflowCandidate = candidates.find((npcId) => !shop.employees.some((employee) => employee.npcId === npcId));
    if (overflowCandidate) {
      const overflow = scenario.economy.hireEmployee(overflowCandidate);
      expect(overflow.ok).toBe(false);
      expect(overflow.code).toBe('capacity_reached');
    }
    const duplicate = scenario.economy.hireEmployee(shop.employees[0]?.npcId ?? NPC.elizaThorne);
    expect(duplicate.ok).toBe(false);

    const ownerElsewhere = shop.employees.some((employee) => employee.npcId === NPC.marigoldLyle);
    expect(ownerElsewhere).toBe(false);
    const project = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    buyGrocery(project);
    const hireOwner = project.economy.hireEmployee(NPC.marigoldLyle);
    expect(hireOwner.ok).toBe(false);
    expect(hireOwner.code).toBe('not_allowed');

    const fireTarget = shop.employees[0]?.npcId;
    if (fireTarget) {
      const fire = scenario.economy.fireEmployee(fireTarget);
      expect(fire.ok).toBe(true);
      expect(shop.employees.length).toBe(2);
      const fireAgain = scenario.economy.fireEmployee(fireTarget);
      expect(fireAgain.ok).toBe(false);
      expect(fireAgain.code).toBe('not_found');
    }
  });

  it('settles daily profit minus wages to the player, idempotently', () => {
    const scenario = createScenario({ playerLocationId: GROCERY_INTERIOR, startSimTime: 10 * HOUR });
    buyGrocery(scenario);
    const business = businessFor(scenario, BIZ.willowGrocery);
    const shop = scenario.economy.getPlayerShop();
    if (!shop) throw new Error('no shop');
    const playerMoneyBefore = scenario.state.player.money;

    advanceHours(scenario, 13); // 10:00 -> 23:00, the 22:00 settlement hour runs

    expect(shop.lastSettledAt).toBe(22 * HOUR);
    expect(business.history.length).toBe(1);
    expect(business.history[0]?.day).toBe(0);
    expect(shop.totalRevenue).toBeGreaterThan(0);
    expect(business.dailyRevenue).toBe(0);
    expect(business.dailyExpenses).toBe(0);
    expect(scenario.state.player.money).toBeGreaterThanOrEqual(playerMoneyBefore);
    expect(business.money).toBeGreaterThanOrEqual(0);

    scenario.economy.update(0);
    scenario.economy.update(0);
    expect(business.history.length).toBe(1);
    advanceHours(scenario, 24);
    expect(business.history.length).toBe(2);
    expect(shop.lastSettledAt).toBe(22 * HOUR + DAY);
  });
});
