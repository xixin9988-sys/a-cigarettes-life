import type { IGameContext, MarketGoodState, TransactionRecord } from '../core/contracts';
import type { ItemDef } from '../data/schema';
import type { ItemId } from '../core/SharedTypes';
import { hashString } from '../core/utils';
import { DAY_SIM_SECONDS } from './EconomyHelpers';
import {
  basePriceOf,
  clampPriceToBase,
  finiteNumber,
  HOUR_SIM_SECONDS,
  safePence,
} from './EconomyHelpers';
import type { PriceSystem } from './PriceSystem';
import type { SupplyDemandSystem } from './SupplyDemandSystem';

export interface MarketSettlementSummary {
  hourEnd: number;
  goodsUpdated: number;
  transactionsApplied: number;
  economicIndex: number;
}

/**
 * Owns the abstract item market: bootstrap/repair of MarketGoodState records, hourly
 * settlement that combines PriceSystem and SupplyDemandSystem, and the refresh of shop
 * sticker prices from the current market price.
 */
export class MarketSystem {
  constructor(
    private readonly ctx: IGameContext,
    private readonly price: PriceSystem,
    private readonly supplyDemand: SupplyDemandSystem
  ) {}

  /** Creates market records for any item that does not have one yet and repairs invalid values. */
  ensureMarket(now: number): void {
    const market = this.ctx.state.economy.market;
    for (const item of this.ctx.content.getAllItems()) {
      if (!market[item.id]) market[item.id] = this.createGood(item, now);
    }
    for (const business of Object.values(this.ctx.state.economy.businesses)) {
      for (const entry of business.stock) {
        if (!market[entry.itemId]) {
          const fallbackBase = basePriceOf(this.ctx, entry.itemId);
          market[entry.itemId] = this.createFallbackGood(entry.itemId, fallbackBase, now);
        }
      }
    }
    for (const good of Object.values(market)) this.sanitiseGood(good, now);
  }

  getGood(itemId: ItemId): MarketGoodState | undefined {
    return this.ctx.state.economy.market[itemId];
  }

  /** Applies a completed trade to market demand/supply immediately (see SupplyDemandSystem). */
  noteTransaction(record: TransactionRecord): void {
    this.supplyDemand.noteTransaction(record);
  }

  /** Current market price for an item (falls back to its base price). */
  marketPrice(itemId: ItemId): number {
    const good = this.getGood(itemId);
    if (good && Number.isFinite(good.currentPrice)) return Math.max(1, Math.round(good.currentPrice));
    return Math.max(1, basePriceOf(this.ctx, itemId));
  }

  /**
   * Runs one hourly market settlement covering transactions in [lastSettlement, hourEnd).
   * Updates every good's supply/demand/price/trend and the shared economic index, then
   * refreshes NPC-owned shop prices from the new market prices.
   */
  settleHour(hourEnd: number): MarketSettlementSummary {
    const state = this.ctx.state;
    const economy = state.economy;
    const season = state.world.environment.season;
    const market = economy.market;
    const since = economy.lastMarketSettlementAt;

    const signals = this.supplyDemand.collectDemandSignals();

    const goods = Object.values(market);
    for (const good of goods) {
      this.sanitiseGood(good, hourEnd);
      const item = this.ctx.content.getItem(good.itemId);
      const base = item && item.basePrice > 0 ? item.basePrice : Math.max(1, good.basePrice);
      good.basePrice = safePence(base);
      good.seasonalFactor = this.price.seasonalFactor(item, season);
      this.supplyDemand.updateGood(good, item, signals);
      const previousPrice = good.currentPrice;
      good.currentPrice = this.price.computeMarketPrice(good);
      good.trend = this.price.trend(previousPrice, good.currentPrice, good.basePrice);
      good.lastUpdatedAt = hourEnd;
    }

    economy.economicIndex = this.price.economicIndex(goods);
    economy.lastMarketSettlementAt = hourEnd;
    this.refreshBusinessPrices();

    return {
      hourEnd,
      goodsUpdated: goods.length,
      transactionsApplied: economy.transactions.filter((record) => record.at >= since && record.at < hourEnd).length,
      economicIndex: economy.economicIndex,
    };
  }

  /**
   * Rewrites NPC-owned business sticker prices: market price * stock multiplier * business markup.
   * Player-owned shops are skipped: the contract has no persisted per-item price override slot,
   * so a player-owned shop keeps exactly the prices the player set in setPlayerShopPrice().
   */
  refreshBusinessPrices(): void {
    const economy = this.ctx.state.economy;
    for (const business of Object.values(economy.businesses)) {
      if (business.isPlayerOwned) continue;
      const def = this.ctx.content.getBusiness(business.id);
      for (const entry of business.stock) {
        const seed = def?.stock.find((lineSeed) => lineSeed.itemId === entry.itemId);
        const base = basePriceOf(this.ctx, entry.itemId);
        const marketPrice = this.marketPrice(entry.itemId);
        entry.price = this.price.computeShopPrice(
          marketPrice,
          base,
          seed?.priceMultiplier ?? 1,
          business.priceMarkup
        );
        const good = economy.market[entry.itemId];
        if (good) {
          const supply = Math.max(1, finiteNumber(good.supply, 1));
          entry.demandIndex = Math.min(4, Math.max(0.25, finiteNumber(good.demand, supply) / supply));
        }
        if (!Number.isFinite(entry.targetStock) || entry.targetStock <= 0) {
          entry.targetStock = Math.max(1, Math.round(seed?.restockTarget ?? 10));
        }
        entry.quantity = Math.max(0, Math.round(finiteNumber(entry.quantity, 0)));
      }
    }
  }

  private createGood(item: ItemDef, now: number): MarketGoodState {
    const seed = this.ctx.state.meta.seed >>> 0;
    const base = Number.isFinite(item.basePrice) && item.basePrice > 0 ? item.basePrice : 100;
    const target = 8 + (hashString(seed + ':' + item.id + ':target') % 25);
    const supply = 10 + (hashString(seed + ':' + item.id + ':supply') % 25);
    const demand = 10 + (hashString(seed + ':' + item.id + ':demand') % 25);
    const seasonal = this.price.seasonalFactor(item, this.ctx.state.world.environment.season);
    return {
      itemId: item.id,
      basePrice: base,
      currentPrice: clampPriceToBase(base * seasonal, base),
      targetStock: target,
      supply,
      demand,
      seasonalFactor: seasonal,
      trend: 0,
      lastUpdatedAt: now,
    };
  }

  private createFallbackGood(itemId: ItemId, base: number, now: number): MarketGoodState {
    const seed = this.ctx.state.meta.seed >>> 0;
    const target = 8 + (hashString(seed + ':' + itemId + ':target') % 25);
    return {
      itemId,
      basePrice: Math.max(1, safePence(base)),
      currentPrice: Math.max(1, safePence(base)),
      targetStock: target,
      supply: target,
      demand: target,
      seasonalFactor: 1,
      trend: 0,
      lastUpdatedAt: now,
    };
  }

  private sanitiseGood(good: MarketGoodState, now: number): void {
    const fallbackBase = Math.max(1, basePriceOf(this.ctx, good.itemId));
    good.basePrice = Math.max(1, safePence(finiteNumber(good.basePrice, fallbackBase)));
    good.targetStock = Math.max(1, Math.round(finiteNumber(good.targetStock, 10)));
    good.supply = Math.max(1, finiteNumber(good.supply, good.targetStock));
    good.demand = Math.max(1, finiteNumber(good.demand, good.targetStock));
    good.seasonalFactor = finiteNumber(good.seasonalFactor, 1);
    good.currentPrice = clampPriceToBase(finiteNumber(good.currentPrice, good.basePrice), good.basePrice);
    good.trend = finiteNumber(good.trend, 0);
    good.lastUpdatedAt = finiteNumber(good.lastUpdatedAt, now);
  }
}

export { DAY_SIM_SECONDS, HOUR_SIM_SECONDS };