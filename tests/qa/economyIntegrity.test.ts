// QA economy integrity: long-run market/business stability and idempotent player-shop
// settlement, driven by the REAL SimulationRuntime / GameEngine economy systems.
import { afterEach, describe, expect, it } from 'vitest';
import { SimulationRuntime } from '../../src/simulation/SimulationRuntime';
import { GameEngine } from '../../src/core/Game';
import { EconomySystem } from '../../src/economy/EconomySystem';
import { DEFAULT_APPEARANCE } from '../../src/core/WorldFactory';
import { LOC } from '../../src/data/locations/ids';
import {
  content,
  createQaState,
  marketPriceViolations,
  negativeBalances,
  travelTo,
  validateState,
} from './support/qaHarness';

interface MonthRun {
  state: ReturnType<typeof createQaState>;
  initialPrices: Record<string, number>;
  elapsedMs: number;
}

function runEconomyMonth(seed: number): MonthRun {
  const state = createQaState(seed);
  const initialPrices: Record<string, number> = {};
  for (const [itemId, good] of Object.entries(state.economy.market)) initialPrices[itemId] = good.currentPrice;
  const runtime = new SimulationRuntime({ state, content });
  const started = performance.now();
  // One aggregated step across 30 game days: the economy must integrate hour by hour from
  // absolute timestamps and settle every day exactly once.
  runtime.advance(30 * 1440);
  runtime.flushPersistence();
  return { state, initialPrices, elapsedMs: performance.now() - started };
}

const openGames: GameEngine[] = [];
afterEach(() => {
  while (openGames.length > 0) {
    const game = openGames.pop();
    if (game) game.destroy();
  }
});

async function createGame(seed: number): Promise<GameEngine> {
  const game = new GameEngine({ content });
  await game.init();
  const result = game.newGame({ playerName: 'QA Economy', appearance: DEFAULT_APPEARANCE, seed, slotId: 'qa_economy_' + seed });
  expect(result.ok, result.message).toBe(true);
  openGames.push(game);
  return game;
}

describe('QA: long-run economy integrity', () => {
  it('runs 30 game days without NaN, negative money or unclamped prices, and restocks shops', { timeout: 180000 }, () => {
    const run = runEconomyMonth(8801);
    const state = run.state;
    const report = validateState(state);
    expect(report.issues, report.issues.slice(0, 10).join(' | ')).toEqual([]);
    expect(marketPriceViolations(state)).toEqual([]);
    expect(negativeBalances(state)).toEqual([]);

    // The economy is alive: prices moved, shops restocked, wages were paid.
    const moved = Object.entries(state.economy.market).filter(([itemId, good]) => good.currentPrice !== run.initialPrices[itemId]);
    expect(moved.length, 'market prices changed over 30 days').toBeGreaterThan(10);
    for (const business of Object.values(state.economy.businesses)) {
      const stockedLines = business.stock.filter((entry) => entry.quantity > 0).length;
      expect(stockedLines, business.id + ' still has stocked lines (restock works)').toBeGreaterThan(0);
      expect(business.reputation).toBeGreaterThanOrEqual(0);
      expect(business.reputation).toBeLessThanOrEqual(100);
    }
    const wageRecords = state.economy.transactions.filter((record) => record.type === 'wage');
    expect(wageRecords.length, 'wage transactions are recorded').toBeGreaterThan(0);
    for (const record of wageRecords) {
      expect(Number.isFinite(record.totalPrice)).toBe(true);
      expect(record.totalPrice).toBeGreaterThanOrEqual(0);
    }
    // Employment is real: NPCs hold jobs and businesses have staff.
    const employedNpcs = Object.values(state.npcs).filter((npc) => npc.jobId !== null).length;
    expect(employedNpcs, 'NPCs have jobs').toBeGreaterThan(0);
    const staffedBusinesses = Object.values(state.economy.businesses).filter((business) => business.employees.length > 0).length;
    expect(staffedBusinesses, 'businesses have staff').toBeGreaterThan(0);
    expect(state.economy.lastMarketSettlementAt % 60).toBe(0);
    expect(state.economy.lastMarketSettlementAt).toBeLessThanOrEqual(state.clock.simTimeSeconds);
    expect(state.economy.lastDailySettlementDay).toBeGreaterThanOrEqual(0);
    expect(state.economy.transactions.length).toBeLessThanOrEqual(101);

    // Determinism: a second identical month reproduces the exact same economy state.
    const repeat = runEconomyMonth(8801);
    expect(JSON.stringify(repeat.state.economy)).toBe(JSON.stringify(state.economy));
    console.log(
      'QA economy seed=8801 elapsedMs=' + run.elapsedMs.toFixed(0) +
      ' priceMoves=' + moved.length + ' wages=' + wageRecords.length +
      ' employedNpcs=' + employedNpcs + ' staffedBusinesses=' + staffedBusinesses +
      ' transactions=' + state.economy.transactions.length +
      ' economicIndex=' + state.economy.economicIndex.toFixed(3)
    );
  });

  it('settles the player shop exactly once per game day and keeps the till solvent', { timeout: 180000 }, async () => {
    const game = await createGame(8802);
    const state = game.getState();
    // Fixture: the player needs capital to buy a business (earning 150k pence through work
    // would take many simulated days; QA seeds the wallet and documents it in the report).
    state.player.money = 500000;
    travelTo(game, LOC.grocery + '_interior');
    const economy = game.getRuntime().systems.economy;
    const bought = game.dispatch({ type: 'shop:buy-business', businessId: 'biz_willow_grocery' });
    expect(bought.ok, bought.message).toBe(true);
    const shop = economy.getPlayerShop();
    expect(shop).not.toBeNull();
    if (!shop) return;
    expect(shop.businessId).toBe('biz_willow_grocery');
    expect(game.dispatch({ type: 'shop:open', open: true }).ok).toBe(true);
    expect(game.dispatch({ type: 'shop:restock', itemId: 'bread_loaf', quantity: 20 }).ok).toBe(true);

    const business = economy.getBusiness(shop.businessId);
    expect(business).toBeDefined();
    if (!business) return;

    // Cross 22:00 of day 0 -> exactly one daily settlement.
    const rest = game.dispatch({ type: 'time:rest', hours: 20 });
    expect(rest.ok, rest.message).toBe(true);
    expect(business.history.length, 'one daily settlement after crossing 22:00').toBe(1);
    expect(shop.lastSettledAt).toBeGreaterThan(0);
    const firstSettledAt = shop.lastSettledAt;
    const historyAfterFirst = business.history.length;

    // Re-running the economy at the same instant must not settle again (idempotency guard).
    for (let attempt = 0; attempt < 3; attempt += 1) economy.update(0);
    expect(business.history.length).toBe(historyAfterFirst);
    expect(shop.lastSettledAt).toBe(firstSettledAt);

    // Cross the next 22:00 -> exactly one more settlement, on the next day index.
    const restAgain = game.dispatch({ type: 'time:rest', hours: 21 });
    expect(restAgain.ok, restAgain.message).toBe(true);
    expect(business.history.length, 'one settlement per day').toBe(2);
    const days = business.history.map((record) => record.day);
    expect(new Set(days).size, 'settlement days are unique: ' + days.join(',')).toBe(days.length);
    for (const record of business.history) {
      expect(Number.isFinite(record.revenue)).toBe(true);
      expect(Number.isFinite(record.expenses)).toBe(true);
      expect(record.revenue).toBeGreaterThanOrEqual(0);
      expect(record.expenses).toBeGreaterThanOrEqual(0);
    }
    expect(game.getState().player.money).toBeGreaterThanOrEqual(0);
    expect(business.money).toBeGreaterThanOrEqual(0);
    expect(shop.totalRevenue).toBeGreaterThanOrEqual(0);
    expect(shop.totalExpenses).toBeGreaterThanOrEqual(0);
    expect(validateState(game.getState()).issues).toEqual([]);

    const incomeRecords = game.getState().economy.transactions.filter((record) => record.type === 'shop_income');
    console.log(
      'QA player shop settlements=' + business.history.length + ' days=' + days.join(',') +
      ' incomeRecords=' + incomeRecords.length + ' playerMoney=' + game.getState().player.money +
      ' shopReputation=' + shop.reputation.toFixed(1)
    );
  });

  it('keeps player money non-negative when a purchase is unaffordable and prices trades atomically', { timeout: 60000 }, async () => {
    const game = await createGame(8803);
    const state = game.getState();
    travelTo(game, LOC.grocery + '_interior');
    // Extra class method beyond the frozen IEconomySystem contract (documented by the economy agent).
    const economy = game.getRuntime().systems.economy as EconomySystem;
    const business = economy.getBusiness('biz_willow_grocery');
    expect(business).toBeDefined();
    if (!business) return;
    if (!economy.isBusinessOpen('biz_willow_grocery')) game.dispatch({ type: 'time:rest', hours: 2 });
    expect(economy.isBusinessOpen('biz_willow_grocery')).toBe(true);
    const stockBefore = business.stock.find((entry) => entry.itemId === 'bread_loaf')?.quantity ?? 0;
    const moneyBefore = state.player.money;
    const buy = game.dispatch({ type: 'shop:buy', businessId: 'biz_willow_grocery', itemId: 'bread_loaf', quantity: 1 });
    expect(buy.ok, buy.message).toBe(true);
    expect(game.getState().player.money).toBeLessThan(moneyBefore);
    expect(game.getState().player.money).toBeGreaterThanOrEqual(0);
    const stockAfter = business.stock.find((entry) => entry.itemId === 'bread_loaf')?.quantity ?? 0;
    expect(stockAfter).toBe(stockBefore - 1);

    // Empty wallet: the failed trade must not mutate money, stock or inventory.
    state.player.money = 0;
    const stockBeforeFail = business.stock.find((entry) => entry.itemId === 'bread_loaf')?.quantity ?? 0;
    const inventoryBefore = JSON.stringify(state.player.inventory);
    const denied = game.dispatch({ type: 'shop:buy', businessId: 'biz_willow_grocery', itemId: 'bread_loaf', quantity: 1 });
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe('not_enough_money');
    expect(game.getState().player.money).toBe(0);
    expect(business.stock.find((entry) => entry.itemId === 'bread_loaf')?.quantity ?? 0).toBe(stockBeforeFail);
    expect(JSON.stringify(state.player.inventory)).toBe(inventoryBefore);

    // Selling the held loaf credits money and never produces negative balances.
    const held = state.player.inventory.find((entry) => entry.itemId === 'bread_loaf');
    expect(held).toBeDefined();
    if (held) {
      const sell = game.dispatch({ type: 'shop:sell', businessId: 'biz_willow_grocery', itemId: 'bread_loaf', quantity: 1, instanceId: held.instanceId });
      expect(sell.ok, sell.message).toBe(true);
      expect(game.getState().player.money).toBeGreaterThan(0);
    }
    expect(negativeBalances(game.getState())).toEqual([]);
    expect(marketPriceViolations(game.getState())).toEqual([]);
  });
});
