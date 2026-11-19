import type {
  BusinessDayRecord,
  BusinessState,
  IGameContext,
  NPCState,
  ShopStockEntryState,
} from '../core/contracts';
import type { BusinessType, ItemDef, LocationKind } from '../data/schema';
import type { BusinessId } from '../core/SharedTypes';
import { clamp } from '../core/utils';
import {
  businessOpenAt,
  businessTypeOf,
  BUSINESS_HISTORY_LIMIT,
  DAY_SIM_SECONDS,
  exteriorIdOf,
  finiteNumber,
  hourOfDayAt,
  locationsEquivalent,
  npcSpendingReserve,
  OWNER_PROFIT_SHARE,
  pushTransaction,
  safePence,
  weekdayIndexAt,
} from './EconomyHelpers';
import type { EmploymentSystem } from './EmploymentSystem';
import type { InventorySystem } from './InventorySystem';
import type { MarketSystem } from './MarketSystem';
import type { TransactionSystem } from './TransactionSystem';

export interface CustomerSimulationResult {
  customers: number;
  revenue: number;
}

export interface BusinessDaySettlementSummary {
  businessId: BusinessId;
  day: number;
  revenue: number;
  expenses: number;
  customers: number;
  ownerIncome: number;
  wagesPaid: number;
  stockValue: number;
}

/** Base customers per open game hour, before all modifiers. */
const BASE_FOOTFALL: Readonly<Record<BusinessType, number>> = {
  cafe: 7,
  bakery: 6,
  flower_shop: 2,
  grocery: 8,
  bookshop: 3,
  post_office: 4,
  library: 4,
  market_stall: 5,
  restaurant: 6,
  supermarket: 12,
  convenience_store: 8,
  clothing_shop: 3,
  furniture_shop: 1.6,
  electronics_shop: 1.6,
  cinema: 7,
  museum: 4,
  farm: 3,
  player_shop: 4,
};

const REGION_FOOTFALL: Readonly<Record<string, number>> = { willowbrook: 1, ashford: 1.15 };

const LOCATION_FOOTFALL: Readonly<Partial<Record<LocationKind, number>>> = {
  town_center: 1.3,
  plaza: 1.3,
  market: 1.2,
  commercial_street: 1.3,
  shopping_mall: 1.4,
  cafe: 1.05,
  bakery: 1.05,
  supermarket: 1.1,
  restaurant: 1,
  museum: 0.9,
  library: 0.9,
  park: 0.8,
  farm: 0.75,
  orchard: 0.7,
  train_station: 1.1,
  riverside_walk: 0.85,
  office_district: 1.05,
  city_residential: 0.9,
  countryside: 0.65,
  event_square: 1.15,
};

const WEATHER_FOOTFALL: Readonly<Record<string, number>> = {
  clear: 1.06,
  cloudy: 1,
  rain: 0.82,
  storm: 0.55,
  fog: 0.85,
  snow: 0.65,
  wind: 0.95,
};

export interface HourlyBusinessReport {
  hourStart: number;
  simulated: number;
  customers: number;
  revenue: number;
}

/**
 * Business opening hours, simulated customers and daily accounting.
 *
 * Customers are not the player: every open business-hour draws an arrival count from the
 * 'economy.customer' stream, each customer picks a real NPC shopper weighted by spending
 * tendency/proximity, picks a real stocked item weighted by need/price, and only buys if
 * the NPC can afford it without dropping below their living reserve. Money never goes
 * negative on any side.
 */
export class BusinessSystem {
  constructor(
    private readonly ctx: IGameContext,
    private readonly market: MarketSystem,
    private readonly inventory: InventorySystem,
    private readonly employment: EmploymentSystem,
    private readonly transactions: TransactionSystem
  ) {}

  /** Repairs contract defaults created by WorldFactory (unknown lastSettledAt becomes -1). */
  normalise(now: number): void {
    const economy = this.ctx.state.economy;
    for (const business of Object.values(economy.businesses)) {
      business.money = Math.max(0, Math.round(finiteNumber(business.money, 0)));
      business.reputation = clamp(finiteNumber(business.reputation, 50), 0, 100);
      business.priceMarkup = clamp(finiteNumber(business.priceMarkup, 1), 0.5, 2);
      business.dailyRevenue = Math.max(0, finiteNumber(business.dailyRevenue, 0));
      business.dailyExpenses = Math.max(0, finiteNumber(business.dailyExpenses, 0));
      business.dailyCustomers = Math.max(0, Math.floor(finiteNumber(business.dailyCustomers, 0)));
      business.totalRevenue = Math.max(0, finiteNumber(business.totalRevenue, 0));
      if (!Number.isFinite(business.lastSettledAt) || business.lastSettledAt <= 0) business.lastSettledAt = -1;
      if (business.ownerNpcId && !this.ctx.state.npcs[business.ownerNpcId]) business.ownerNpcId = null;
      business.employees = business.employees.filter((npcId) => Boolean(this.ctx.state.npcs[npcId]));
      if (business.history.length > BUSINESS_HISTORY_LIMIT) {
        business.history.splice(0, business.history.length - BUSINESS_HISTORY_LIMIT);
      }
      for (const entry of business.stock) {
        entry.quantity = Math.max(0, Math.floor(finiteNumber(entry.quantity, 0)));
        entry.price = Math.max(1, safePence(finiteNumber(entry.price, 1)));
        entry.targetStock = Math.max(1, Math.round(finiteNumber(entry.targetStock, 10)));
        entry.demandIndex = Math.max(0.1, finiteNumber(entry.demandIndex, 1));
      }
    }
    const shop = economy.playerShop;
    if (shop) {
      if (!Number.isFinite(shop.lastSettledAt) || shop.lastSettledAt <= 0) shop.lastSettledAt = -1;
      shop.employees = shop.employees.filter((employee) => Boolean(this.ctx.state.npcs[employee.npcId]));
      shop.reputation = clamp(finiteNumber(shop.reputation, 50), 0, 100);
      shop.totalRevenue = Math.max(0, finiteNumber(shop.totalRevenue, 0));
      shop.totalExpenses = Math.max(0, finiteNumber(shop.totalExpenses, 0));
    }
    this.syncOpenStates(now);
  }

  /** Recomputes every business isOpen flag from hours, closed days and the player toggle. */
  syncOpenStates(now: number): void {
    const economy = this.ctx.state.economy;
    for (const business of Object.values(economy.businesses)) {
      const type = businessTypeOf(this.ctx, business);
      let open = businessOpenAt(business, type, now);
      if (business.isPlayerOwned) {
        const shop = economy.playerShop;
        open = open && shop !== null && shop.businessId === business.id && shop.open;
      }
      business.isOpen = open;
    }
  }

  /** Live opening query used by the UI and by action validation. */
  isOpenAt(businessId: BusinessId, atSimSeconds?: number): boolean {
    const business = this.ctx.state.economy.businesses[businessId];
    if (!business) return false;
    const at = atSimSeconds ?? this.ctx.clock.simTimeSeconds;
    const open = businessOpenAt(business, businessTypeOf(this.ctx, business), at);
    if (!business.isPlayerOwned) return open;
    const shop = this.ctx.state.economy.playerShop;
    return open && shop !== null && shop.businessId === business.id && shop.open;
  }

  /** Simulates all open businesses for the game hour that starts at hourStart. */
  simulateHour(hourStart: number): HourlyBusinessReport {
    this.syncOpenStates(hourStart);
    let simulated = 0;
    let customers = 0;
    let revenue = 0;
    for (const business of Object.values(this.ctx.state.economy.businesses)) {
      if (!business.isOpen) continue;
      const result = this.simulateCustomers(business, hourStart);
      simulated += 1;
      customers += result.customers;
      revenue += result.revenue;
    }
    return { hourStart, simulated, customers, revenue };
  }

  /** Daily 07:00 restock pass for every NPC-owned business. */
  restockAll(now: number): { units: number; cost: number } {
    let units = 0;
    let cost = 0;
    for (const business of Object.values(this.ctx.state.economy.businesses)) {
      const result = this.inventory.restockBusiness(business, now);
      units += result.unitsOrdered;
      cost += result.costPence;
    }
    return { units, cost };
  }

  /**
   * 22:00 daily settlement for NPC-owned businesses: pay wages, pay the owner profit share,
   * update reputation, push a capped BusinessDayRecord and reset daily counters.
   * Idempotent per business per day via lastSettledAt.
   */
  settleDay(day: number, now: number): BusinessDaySettlementSummary[] {
    const state = this.ctx.state;
    const economy = state.economy;
    const summaries: BusinessDaySettlementSummary[] = [];
    for (const business of Object.values(economy.businesses)) {
      if (business.isPlayerOwned) continue;
      const lastSettledDay = Math.floor(business.lastSettledAt / DAY_SIM_SECONDS);
      if (lastSettledDay >= day) continue;

      const revenue = safePence(business.dailyRevenue);
      const customers = Math.max(0, Math.floor(business.dailyCustomers));
      const wagesPaid = this.employment.payBusinessWages(business, now);
      let ownerIncome = 0;
      const owner = business.ownerNpcId ? state.npcs[business.ownerNpcId] : undefined;
      if (owner && owner.alive) {
        const profitBeforeOwner = revenue - safePence(business.dailyExpenses);
        if (profitBeforeOwner > 0) {
          const share = safePence(profitBeforeOwner * OWNER_PROFIT_SHARE);
          ownerIncome = Math.min(share, safePence(business.money));
          if (ownerIncome > 0) {
            business.money = Math.max(0, Math.round(business.money - ownerIncome));
            business.dailyExpenses += ownerIncome;
            owner.money = Math.max(0, Math.round(owner.money + ownerIncome));
            pushTransaction(this.ctx, {
              at: now,
              type: 'shop_income',
              actorId: owner.id,
              businessId: business.id,
              itemId: null,
              quantity: 1,
              unitPrice: ownerIncome,
              totalPrice: ownerIncome,
              note: 'Owner income at ' + business.name,
            });
          }
        }
      }

      const stockValue = this.inventory.stockValue(business);
      const expenses = safePence(business.dailyExpenses);
      const record: BusinessDayRecord = { day, revenue, expenses, customers, stockValue };
      business.history.push(record);
      if (business.history.length > BUSINESS_HISTORY_LIMIT) {
        business.history.splice(0, business.history.length - BUSINESS_HISTORY_LIMIT);
      }

      this.updateReputation(business);
      business.dailyRevenue = 0;
      business.dailyExpenses = 0;
      business.dailyCustomers = 0;
      business.lastSettledAt = now;
      summaries.push({
        businessId: business.id,
        day,
        revenue,
        expenses,
        customers,
        ownerIncome,
        wagesPaid,
        stockValue,
      });
    }
    if (summaries.length > 0) {
      economy.lastDailySettlementDay = Math.max(economy.lastDailySettlementDay, day);
    }
    return summaries;
  }

  private simulateCustomers(business: BusinessState, hourStart: number): CustomerSimulationResult {
    const state = this.ctx.state;
    const type = businessTypeOf(this.ctx, business);
    const hour = hourOfDayAt(hourStart);
    const weekday = weekdayIndexAt(hourStart);
    const environment = state.world.environment;
    const exterior = this.ctx.content.getLocation(exteriorIdOf(business.locationId));
    const regionFactor = REGION_FOOTFALL[exterior?.regionId ?? 'willowbrook'] ?? 1;
    const locationFactor = exterior ? LOCATION_FOOTFALL[exterior.kind] ?? 1 : 1;
    const weatherFactor = WEATHER_FOOTFALL[environment.weather] ?? 1;
    const weekendFactor = weekday >= 5 ? 1.12 : 1;
    const timeFactor = this.timeOfDayFactor(type, hour);
    const reputationFactor = clamp(0.55 + (business.reputation / 100) * 0.9, 0.6, 1.4);
    const availabilityFactor = this.availabilityFactor(business);
    const priceFactor = this.priceCompetitivenessFactor(business);

    const mean =
      (BASE_FOOTFALL[type] ?? 4) *
      regionFactor *
      locationFactor *
      weatherFactor *
      weekendFactor *
      timeFactor *
      reputationFactor *
      availabilityFactor *
      priceFactor;
    if (mean <= 0) return { customers: 0, revenue: 0 };

    const variance = 0.8 + this.ctx.probability.roll('economy.customer') * 0.4;
    const arrivals = Math.max(0, Math.round(mean * variance));
    if (arrivals <= 0) return { customers: 0, revenue: 0 };

    const buyerCandidates = this.buildBuyerCandidates(business, hour);
    if (buyerCandidates.length === 0) return { customers: 0, revenue: 0 };

    let customers = 0;
    let revenue = 0;
    for (let index = 0; index < arrivals; index += 1) {
      const buyer = this.ctx.probability.weighted('economy.customer', buyerCandidates);
      if (!buyer) break;
      const candidates = this.buildItemCandidates(business, buyer);
      if (candidates.length === 0) break;
      const entry = this.ctx.probability.weighted('economy.customer', candidates);
      if (!entry) break;
      const price = Math.max(1, safePence(entry.price));
      const reserve = npcSpendingReserve(buyer.money);
      const spendable = Math.max(0, buyer.money - reserve);
      const maxSingle = Math.floor(Math.max(0, buyer.money) * this.maxBudgetShare());
      if (price > spendable || price > maxSingle) continue;
      if (entry.quantity < 1) continue;
      entry.quantity = Math.max(0, Math.floor(entry.quantity) - 1);
      this.transactions.recordNpcPurchase(business, buyer, entry, price, hourStart);
      customers += 1;
      revenue += price;
    }
    return { customers, revenue };
  }

  /** Weighted NPC shoppers: spending tendency, proximity to the shop, night-time scarcity. */
  private buildBuyerCandidates(business: BusinessState, hour: number): { weight: number; value: NPCState }[] {
    const candidates: { weight: number; value: NPCState }[] = [];
    for (const npc of Object.values(this.ctx.state.npcs)) {
      if (!npc.alive) continue;
      const reserve = npcSpendingReserve(npc.money);
      if (npc.money - reserve <= 50) continue;
      let weight = 0.4 + clamp(npc.personality.spendingTendency, 0, 1);
      if (locationsEquivalent(npc.locationId, business.locationId)) weight *= 3;
      if (hour >= 21 || hour < 6) weight *= 0.35;
      weight *= 1 + clamp(npc.needs.fun / 400, 0, 0.3);
      if (weight > 0) candidates.push({ weight, value: npc });
    }
    return candidates;
  }

  /** Weighted stocked items: demand index, need fit and price competitiveness. */
  private buildItemCandidates(
    business: BusinessState,
    buyer: NPCState
  ): { weight: number; value: ShopStockEntryState }[] {
    const candidates: { weight: number; value: ShopStockEntryState }[] = [];
    for (const entry of business.stock) {
      if (entry.quantity < 1) continue;
      const price = Math.max(1, safePence(entry.price));
      const item = this.ctx.content.getItem(entry.itemId);
      const marketPrice = this.market.marketPrice(entry.itemId);
      const priceRatio = clamp(marketPrice / price, 0.4, 2.5);
      let weight = (0.5 + clamp(entry.demandIndex, 0.1, 4)) * priceRatio * 0.55;
      weight *= this.needFit(item, buyer);
      if (weight > 0) candidates.push({ weight, value: entry });
    }
    return candidates;
  }

  /** How strongly an item matches an NPC shopper current needs. */
  private needFit(item: ItemDef | undefined, buyer: NPCState): number {
    if (!item) return 0.7;
    const category = item.category;
    const tags = item.tags;
    let fit = 1;
    if (category === 'food' || category === 'drink' || tags.includes('ingredient')) {
      fit *= 0.6 + clamp(buyer.needs.hunger / 100, 0, 1) * 1.2;
    }
    if (tags.includes('hot') || tags.includes('coffee') || tags.includes('tea')) {
      fit *= 0.8 + clamp(buyer.needs.energy / 100, 0, 1) * 0.6;
    }
    if (category === 'book' || category === 'gift' || category === 'collectible') {
      fit *= 0.6 + clamp(buyer.needs.fun / 100, 0, 1) * 0.9;
    }
    if (category === 'furniture' || category === 'decor') {
      fit *= 0.5 + clamp(buyer.needs.belonging / 100, 0, 1) * 0.6;
    }
    return clamp(fit, 0.2, 2.5);
  }

  /** Fraction of a purchase an NPC will spend at once (mirrors WorldConfig npcEconomy). */
  private maxBudgetShare(): number {
    return 0.35;
  }

  private availabilityFactor(business: BusinessState): number {
    if (business.stock.length === 0) return 0.5;
    let stocked = 0;
    for (const entry of business.stock) if (entry.quantity > 0) stocked += 1;
    return 0.4 + 0.6 * (stocked / business.stock.length);
  }

  private priceCompetitivenessFactor(business: BusinessState): number {
    let ratioSum = 0;
    let count = 0;
    for (const entry of business.stock) {
      if (entry.quantity <= 0) continue;
      const price = Math.max(1, safePence(entry.price));
      ratioSum += clamp(this.market.marketPrice(entry.itemId) / price, 0.4, 2.5);
      count += 1;
    }
    if (count === 0) return 0.7;
    const average = ratioSum / count;
    return clamp(0.75 + average * 0.25, 0.7, 1.3);
  }

  private timeOfDayFactor(type: BusinessType, hour: number): number {
    const meal = hour >= 11 && hour < 14;
    const morning = hour >= 6 && hour < 11;
    const afternoon = hour >= 14 && hour < 17;
    const evening = hour >= 17 && hour < 21;
    switch (type) {
      case 'cafe':
        return morning ? 1.4 : meal ? 1.4 : afternoon ? 1 : evening ? 0.85 : 0.45;
      case 'bakery':
        return morning ? 1.6 : meal ? 1.15 : afternoon ? 0.7 : evening ? 0.4 : 0.3;
      case 'restaurant':
        return meal ? 1.3 : evening ? 1.5 : afternoon ? 0.55 : 0.4;
      case 'grocery':
      case 'supermarket':
      case 'convenience_store':
        return afternoon ? 1.15 : evening ? 1.2 : morning ? 1.05 : 0.7;
      case 'market_stall':
        return morning ? 1.25 : meal ? 1 : afternoon ? 0.5 : 0.45;
      case 'cinema':
        return evening ? 1.6 : afternoon ? 1.1 : hour >= 21 ? 0.9 : 0.5;
      case 'museum':
      case 'library':
        return morning ? 0.9 : afternoon ? 1.15 : 0.7;
      case 'furniture_shop':
      case 'electronics_shop':
      case 'clothing_shop':
        return afternoon ? 1.15 : morning ? 0.95 : 0.7;
      case 'farm':
        return morning ? 1.15 : afternoon ? 0.9 : 0.5;
      default:
        return morning ? 1.1 : meal ? 1.35 : afternoon ? 0.95 : evening ? 0.85 : 0.5;
    }
  }

  /** Reputation drifts with stock availability and price competitiveness each day. */
  private updateReputation(business: BusinessState): void {
    const availability = this.availabilityFactor(business);
    const competitiveness = this.priceCompetitivenessFactor(business);
    let delta = 0;
    if (availability >= 0.7) delta += 0.6;
    else if (availability < 0.35) delta -= 1.1;
    if (competitiveness >= 1.08) delta += 0.4;
    else if (competitiveness < 0.82) delta -= 0.4;
    if (business.dailyCustomers === 0) delta -= 0.2;
    business.reputation = clamp(Math.round((business.reputation + delta) * 10) / 10, 0, 100);
  }
}