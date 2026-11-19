import type {
  ActionResult,
  BusinessState,
  IGameContext,
  NPCState,
  PlayerShopState,
} from '../core/contracts';
import type { BusinessType } from '../data/schema';
import type { NPCId, RegionId } from '../core/SharedTypes';
import { clamp } from '../core/utils';
import { formatMoney } from '../core/format';
import {
  actionFail,
  actionOk,
  adjustPlayerMoney,
  basePriceOf,
  businessOpenAt,
  businessTypeOf,
  BUSINESS_HISTORY_LIMIT,
  DAY_SIM_SECONDS,
  emitSignal,
  finiteNumber,
  PLAYER_SHOP_BASE_PRICE,
  PLAYER_SHOP_EMPLOYEE_LIMIT,
  PLAYER_SHOP_FLOAT,
  playerAtBusiness,
  PURCHASABLE_BUSINESS_TYPES,
  pushTransaction,
  RESTOCK_COST_RATIO,
  safePence,
} from './EconomyHelpers';
import type { EmploymentSystem } from './EmploymentSystem';
import type { InventorySystem } from './InventorySystem';
import type { MarketSystem } from './MarketSystem';
import type { PriceSystem } from './PriceSystem';

export interface PlayerShopQuote {
  businessId: string;
  purchasable: boolean;
  pricePence: number;
  reason: string;
}

export interface PlayerShopDaySettlement {
  businessId: string;
  day: number;
  revenue: number;
  expenses: number;
  customers: number;
  wagesPaid: number;
  playerIncome: number;
}

/**
 * Player business ownership: buying a shop, pricing stock, wholesale restocking,
 * opening/closing, hiring/firing (max 3) and the daily profit settlement.
 * The player's till is never allowed below zero and the shop floats a small reserve so
 * it can still restock after a bad day.
 */
export class PlayerShopSystem {
  constructor(
    private readonly ctx: IGameContext,
    private readonly market: MarketSystem,
    private readonly inventory: InventorySystem,
    private readonly employment: EmploymentSystem
  ) {}

  /** Purchase quote for the UI / action validation. */
  purchaseQuote(businessId: string): PlayerShopQuote | null {
    const economy = this.ctx.state.economy;
    const business = economy.businesses[businessId];
    if (!business) return null;
    const type = businessTypeOf(this.ctx, business);
    if (economy.playerShop) {
      return {
        businessId,
        purchasable: false,
        pricePence: 0,
        reason: 'You already own ' + economy.playerShop.name + '.',
      };
    }
    if (business.isPlayerOwned) {
      return { businessId, purchasable: false, pricePence: 0, reason: 'That shop already belongs to you.' };
    }
    if (business.ownerNpcId) {
      const owner = this.ctx.state.npcs[business.ownerNpcId];
      return {
        businessId,
        purchasable: false,
        pricePence: 0,
        reason: business.name + ' is not for sale' + (owner ? ' — it belongs to ' + owner.name + '.' : '.'),
      };
    }
    if (!PURCHASABLE_BUSINESS_TYPES.includes(type)) {
      return {
        businessId,
        purchasable: false,
        pricePence: 0,
        reason: business.name + ' is a public service and cannot be bought.',
      };
    }
    return { businessId, purchasable: true, pricePence: this.purchasePrice(business, type), reason: 'For sale.' };
  }

  /** Buys the business and turns it into the player's shop. */
  buyPlayerShop(businessId: string): ActionResult {
    const state = this.ctx.state;
    const economy = state.economy;
    if (economy.playerShop) {
      return actionFail('not_allowed', 'You already own ' + economy.playerShop.name + '.');
    }
    const business = economy.businesses[businessId];
    if (!business) return actionFail('not_found', 'That business does not exist.');
    const quote = this.purchaseQuote(businessId);
    if (!quote) return actionFail('not_found', 'That business does not exist.');
    if (!quote.purchasable) return actionFail('not_allowed', quote.reason);
    if (!playerAtBusiness(this.ctx, business)) {
      return actionFail('wrong_location', 'You need to be at ' + business.name + ' to buy it.');
    }
    if (state.player.money < quote.pricePence) {
      return actionFail(
        'not_enough_money',
        'Buying ' + business.name + ' costs ' + formatMoney(quote.pricePence) + ' — you have ' + formatMoney(state.player.money) + '.'
      );
    }

    const type = businessTypeOf(this.ctx, business);
    const now = this.ctx.clock.simTimeSeconds;
    const employees: PlayerShopState['employees'] = [];
    for (const npcId of business.employees) {
      if (!state.npcs[npcId]) continue;
      employees.push({
        npcId,
        wagePerHour: this.employment.wageForBusiness(business.id),
        hiredAt: now,
      });
    }

    adjustPlayerMoney(this.ctx, -quote.pricePence, 'Bought ' + business.name);
    business.isPlayerOwned = true;
    business.ownerNpcId = null;
    const location = this.ctx.content.getLocation(business.locationId);
    const regionId: RegionId = location?.regionId ?? 'willowbrook';
    economy.playerShop = {
      businessId: business.id,
      name: business.name,
      regionId,
      locationId: business.locationId,
      employees,
      open: true,
      reputation: business.reputation,
      totalRevenue: 0,
      totalExpenses: 0,
      lastSettledAt: -1,
    };
    business.isOpen = businessOpenAt(business, type, now);
    state.player.statistics.businessesOwned += 1;
    pushTransaction(this.ctx, {
      at: now,
      type: 'buy',
      actorId: state.player.id,
      businessId: business.id,
      itemId: null,
      quantity: 1,
      unitPrice: quote.pricePence,
      totalPrice: quote.pricePence,
      note: 'Purchased ' + business.name,
    });
    emitSignal(this.ctx, 'economy:business_bought', {
      businessId: business.id,
      pricePence: quote.pricePence,
    });
    return actionOk(
      'You bought ' + business.name + ' for ' + formatMoney(quote.pricePence) + '. It is open for business!',
      { businessId: business.id, pricePence: quote.pricePence }
    );
  }

  /** Sets the player shop sticker price for a carried line; clamped to [40%, 250%] of base. */
  setPlayerShopPrice(itemId: string, pricePence: number): ActionResult {
    const shop = this.ctx.state.economy.playerShop;
    if (!shop) return actionFail('not_allowed', 'You do not own a shop yet.');
    const business = this.ctx.state.economy.businesses[shop.businessId];
    if (!business) return actionFail('not_found', 'Your shop no longer exists.');
    const entry = this.inventory.getStockEntry(business, itemId);
    if (!entry) return actionFail('not_found', business.name + ' does not stock that item.');
    const base = basePriceOf(this.ctx, itemId);
    const min = Math.max(1, Math.round(base * 0.4));
    const max = Math.max(min, Math.round(base * 2.5));
    const requested = Math.round(finiteNumber(pricePence, entry.price));
    const clamped = Math.round(clamp(requested, min, max));
    entry.price = Math.max(1, clamped);
    emitSignal(this.ctx, 'economy:shop_price_set', { itemId, price: entry.price });
    const clampedNote = clamped !== requested ? ' (clamped to ' + formatMoney(min) + '..' + formatMoney(max) + ')' : '';
    return actionOk('Set the price of ' + this.itemName(itemId) + ' to ' + formatMoney(entry.price) + clampedNote + '.', {
      itemId,
      price: entry.price,
    });
  }

  /** Buys wholesale units directly out of the player wallet and adds them to shop stock. */
  restockPlayerShop(itemId: string, quantity: number): ActionResult {
    const state = this.ctx.state;
    const shop = state.economy.playerShop;
    if (!shop) return actionFail('not_allowed', 'You do not own a shop yet.');
    const business = state.economy.businesses[shop.businessId];
    if (!business) return actionFail('not_found', 'Your shop no longer exists.');
    const entry = this.inventory.getStockEntry(business, itemId);
    if (!entry) return actionFail('not_found', business.name + ' does not stock that item.');
    const wanted = Math.floor(finiteNumber(quantity, 0));
    if (wanted < 1) return actionFail('invalid', 'Order at least 1 unit.');
    const capacity = Math.max(0, 200 - Math.max(0, Math.floor(entry.quantity)));
    if (capacity <= 0) return actionFail('capacity_reached', 'The stockroom is full for ' + this.itemName(itemId) + '.');
    const amount = Math.min(wanted, 99, capacity);
    const unitCost = Math.max(1, Math.round(this.market.marketPrice(itemId) * RESTOCK_COST_RATIO));
    const totalCost = unitCost * amount;
    if (state.player.money < totalCost) {
      return actionFail(
        'not_enough_money',
        'That wholesale order costs ' + formatMoney(totalCost) + ' — you have ' + formatMoney(state.player.money) + '.'
      );
    }

    adjustPlayerMoney(this.ctx, -totalCost, 'Wholesale restock at ' + business.name);
    entry.quantity = Math.max(0, Math.floor(entry.quantity)) + amount;
    shop.totalExpenses += totalCost;
    pushTransaction(this.ctx, {
      at: this.ctx.clock.simTimeSeconds,
      type: 'shop_expense',
      actorId: state.player.id,
      businessId: business.id,
      itemId,
      quantity: amount,
      unitPrice: unitCost,
      totalPrice: totalCost,
      note: 'Wholesale restock of ' + this.itemName(itemId) + ' at ' + business.name,
    });
    emitSignal(this.ctx, 'economy:shop_restocked', { itemId, quantity: amount, costPence: totalCost });
    return actionOk(
      'Restocked ' + amount + ' × ' + this.itemName(itemId) + ' for ' + formatMoney(totalCost) + '.',
      { itemId, quantity: amount, costPence: totalCost }
    );
  }

  /** Opens or closes the player shop. Opening hours still apply. */
  togglePlayerShopOpen(open: boolean): ActionResult {
    const state = this.ctx.state;
    const shop = state.economy.playerShop;
    if (!shop) return actionFail('not_allowed', 'You do not own a shop yet.');
    const business = state.economy.businesses[shop.businessId];
    if (!business) return actionFail('not_found', 'Your shop no longer exists.');
    const nextOpen = Boolean(open);
    shop.open = nextOpen;
    const type = businessTypeOf(this.ctx, business);
    business.isOpen = nextOpen && businessOpenAt(business, type, this.ctx.clock.simTimeSeconds);
    emitSignal(this.ctx, 'economy:shop_toggled', { open: nextOpen, businessId: business.id });
    if (nextOpen) {
      return actionOk(
        business.isOpen
          ? business.name + ' is open for business.'
          : business.name + ' is marked open, but the street is outside opening hours.'
      );
    }
    return actionOk(business.name + ' is closed. No customers will come in.');
  }

  /** Hires a resident (max 3). Wage comes from the business job definition. */
  hireEmployee(npcId: NPCId): ActionResult {
    const state = this.ctx.state;
    const shop = state.economy.playerShop;
    if (!shop) return actionFail('not_allowed', 'You do not own a shop yet.');
    const business = state.economy.businesses[shop.businessId];
    if (!business) return actionFail('not_found', 'Your shop no longer exists.');
    const npc = state.npcs[npcId];
    if (!npc) return actionFail('not_found', 'That person does not exist.');
    if (!npc.alive) return actionFail('not_allowed', npc.name + ' is no longer with us.');
    if (shop.employees.some((employee) => employee.npcId === npcId)) {
      return actionFail('invalid', npc.name + ' already works here.');
    }
    if (shop.employees.length >= PLAYER_SHOP_EMPLOYEE_LIMIT) {
      return actionFail(
        'capacity_reached',
        'You can only employ ' + PLAYER_SHOP_EMPLOYEE_LIMIT + ' people at this shop.'
      );
    }
    for (const other of Object.values(state.economy.businesses)) {
      if (other.ownerNpcId === npcId) {
        return actionFail('not_allowed', npc.name + ' owns ' + other.name + ' and cannot work here.');
      }
    }
    if (npc.jobId) {
      const job = state.economy.jobs[npc.jobId];
      if (job && job.businessId !== business.id) {
        const workplace = state.economy.businesses[job.businessId];
        return actionFail('busy', npc.name + ' already works at ' + (workplace?.name ?? 'another business') + '.');
      }
    }

    const wage = this.employment.wageForBusiness(business.id);
    shop.employees.push({ npcId, wagePerHour: wage, hiredAt: this.ctx.clock.simTimeSeconds });
    const role = Object.values(state.economy.jobs).find(
      (job) => job.businessId === business.id && job.playerAvailable
    ) ?? Object.values(state.economy.jobs).find((job) => job.businessId === business.id);
    if (role) this.employment.linkNpc(npc, role);
    else {
      npc.jobId = null;
      npc.occupation = 'shop assistant';
      if (!business.employees.includes(npcId)) business.employees.push(npcId);
    }
    emitSignal(this.ctx, 'economy:employee_hired', { npcId, wagePerHour: wage, businessId: business.id });
    return actionOk(npc.name + ' is hired at ' + formatMoney(wage) + ' per hour.', { npcId, wagePerHour: wage });
  }

  /** Fires a player-shop employee. */
  fireEmployee(npcId: NPCId): ActionResult {
    const state = this.ctx.state;
    const shop = state.economy.playerShop;
    if (!shop) return actionFail('not_allowed', 'You do not own a shop yet.');
    const index = shop.employees.findIndex((employee) => employee.npcId === npcId);
    if (index < 0) return actionFail('not_found', 'That person does not work here.');
    const npc = state.npcs[npcId];
    shop.employees.splice(index, 1);
    this.employment.unlinkNpc(npcId);
    emitSignal(this.ctx, 'economy:employee_fired', { npcId });
    return actionOk((npc?.name ?? 'The employee') + ' no longer works at your shop.');
  }

  /**
   * 22:00 daily settlement of the player shop: wages are paid from the till, then the
   * positive trading profit is transferred to the player wallet, keeping a float behind.
   * Idempotent per day via playerShop.lastSettledAt.
   */
  settleDay(day: number, now: number): PlayerShopDaySettlement | null {
    const state = this.ctx.state;
    const shop = state.economy.playerShop;
    if (!shop) return null;
    const business = state.economy.businesses[shop.businessId];
    if (!business) return null;
    const lastSettledDay = Math.floor(shop.lastSettledAt / DAY_SIM_SECONDS);
    if (lastSettledDay >= day) return null;

    const revenue = safePence(business.dailyRevenue);
    const customers = Math.max(0, Math.floor(business.dailyCustomers));
    const wagesPaid = this.employment.payPlayerShopWages(business, shop.employees, now);
    const expenses = safePence(business.dailyExpenses);
    const profit = revenue - expenses;
    const tillSurplus = Math.max(0, safePence(business.money - PLAYER_SHOP_FLOAT));
    const playerIncome = profit > 0 ? Math.min(safePence(profit), tillSurplus) : 0;
    if (playerIncome > 0) {
      business.money = Math.max(0, Math.round(business.money - playerIncome));
      adjustPlayerMoney(this.ctx, playerIncome, 'Daily profit from ' + business.name);
      state.player.statistics.moneyEarned += playerIncome;
      pushTransaction(this.ctx, {
        at: now,
        type: 'shop_income',
        actorId: state.player.id,
        businessId: business.id,
        itemId: null,
        quantity: 1,
        unitPrice: playerIncome,
        totalPrice: playerIncome,
        note: 'Daily profit from ' + business.name,
      });
    }

    shop.totalRevenue += revenue;
    shop.totalExpenses += wagesPaid;
    shop.reputation = this.nextReputation(shop, business);
    const record = {
      day,
      revenue,
      expenses,
      customers,
      stockValue: this.inventory.stockValue(business),
    };
    business.history.push(record);
    if (business.history.length > BUSINESS_HISTORY_LIMIT) {
      business.history.splice(0, business.history.length - BUSINESS_HISTORY_LIMIT);
    }
    business.dailyRevenue = 0;
    business.dailyExpenses = 0;
    business.dailyCustomers = 0;
    business.reputation = shop.reputation;
    business.lastSettledAt = now;
    shop.lastSettledAt = now;
    emitSignal(this.ctx, 'economy:shop_settled', {
      businessId: business.id,
      revenue,
      wagesPaid,
      playerIncome,
      customers,
    });
    return {
      businessId: business.id,
      day,
      revenue,
      expenses,
      customers,
      wagesPaid,
      playerIncome,
    };
  }

  private nextReputation(shop: PlayerShopState, business: BusinessState): number {
    const availability =
      business.stock.length > 0
        ? business.stock.filter((entry) => entry.quantity > 0).length / business.stock.length
        : 0.5;
    let delta = 0;
    if (availability >= 0.7) delta += 0.5;
    else if (availability < 0.35) delta -= 1;
    if (business.dailyCustomers > 0) delta += 0.3;
    else delta -= 0.2;
    return clamp(Math.round((shop.reputation + delta) * 10) / 10, 0, 100);
  }

  /** Purchase price: type baseline adjusted by reputation, clamped to the brief 80k-350k band. */
  private purchasePrice(business: BusinessState, type: BusinessType): number {
    const base = PLAYER_SHOP_BASE_PRICE[type] ?? 120000;
    const reputationAdjust = 1 + (clamp(business.reputation, 0, 100) - 50) / 250;
    const raw = Math.round((base * reputationAdjust) / 100) * 100;
    return Math.round(clamp(raw, 80000, 350000));
  }

  private itemName(itemId: string): string {
    return this.ctx.content.getItem(itemId)?.name ?? itemId;
  }
}