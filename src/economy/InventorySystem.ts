import type { BusinessState, IGameContext, ShopStockEntryState } from '../core/contracts';
import type { ItemId } from '../core/SharedTypes';
import { clamp } from '../core/utils';
import { basePriceOf, finiteNumber, RESTOCK_COST_RATIO, safePence } from './EconomyHelpers';
import type { MarketSystem } from './MarketSystem';

export interface RestockResult {
  unitsOrdered: number;
  costPence: number;
}

/**
 * Shop stock helpers. ShopStockEntryState lives in the contract; this class is the only
 * place that mutates it, so stock quantities/prices always stay finite and non-negative.
 */
export class InventorySystem {
  constructor(
    private readonly ctx: IGameContext,
    private readonly market: MarketSystem
  ) {}

  getStockEntry(business: BusinessState, itemId: ItemId): ShopStockEntryState | undefined {
    return business.stock.find((entry) => entry.itemId === itemId);
  }

  availableQuantity(business: BusinessState, itemId: ItemId): number {
    const entry = this.getStockEntry(business, itemId);
    return entry ? Math.max(0, Math.floor(entry.quantity)) : 0;
  }

  priceOf(business: BusinessState, itemId: ItemId): number {
    const entry = this.getStockEntry(business, itemId);
    return entry ? Math.max(1, safePence(entry.price)) : 0;
  }

  /** Removes up to quantity units of stock. Returns the number actually removed. */
  removeStock(business: BusinessState, itemId: ItemId, quantity: number): number {
    const entry = this.getStockEntry(business, itemId);
    if (!entry) return 0;
    const wanted = Math.max(0, Math.floor(quantity));
    const taken = Math.min(wanted, Math.max(0, Math.floor(entry.quantity)));
    entry.quantity = Math.max(0, Math.floor(entry.quantity) - taken);
    return taken;
  }

  /** Adds units to an existing stock line. Returns the number added (0 when the shop does not carry it). */
  addStock(business: BusinessState, itemId: ItemId, quantity: number): number {
    const entry = this.getStockEntry(business, itemId);
    if (!entry) return 0;
    const added = Math.max(0, Math.floor(quantity));
    entry.quantity = Math.max(0, Math.floor(entry.quantity) + added);
    return added;
  }

  setStockPrice(business: BusinessState, itemId: ItemId, pricePence: number): boolean {
    const entry = this.getStockEntry(business, itemId);
    if (!entry) return false;
    entry.price = Math.max(1, safePence(pricePence));
    return true;
  }

  /** Total retail value of the current stock at current market prices. */
  stockValue(business: BusinessState): number {
    let total = 0;
    for (const entry of business.stock) {
      const unit = this.market.marketPrice(entry.itemId);
      total += Math.max(0, finiteNumber(entry.quantity, 0)) * Math.max(1, unit);
    }
    return safePence(total);
  }

  /**
   * Daily restock at 07:00 for NPC-run businesses: orders a deterministic 60-100% of the
   * gap to target stock, pays ~55% of current market price per unit and never lets the
   * business till go negative (partial orders are fine when cash is short).
   * Player-owned shops are restocked manually via PlayerShopSystem.restockPlayerShop().
   */
  restockBusiness(business: BusinessState, now: number): RestockResult {
    void now;
    if (business.isPlayerOwned) return { unitsOrdered: 0, costPence: 0 };
    const def = this.ctx.content.getBusiness(business.id);
    if (!def) return { unitsOrdered: 0, costPence: 0 };
    let unitsOrdered = 0;
    let costPence = 0;

    for (const seed of def.stock) {
      let entry = this.getStockEntry(business, seed.itemId);
      if (!entry) {
        const base = basePriceOf(this.ctx, seed.itemId);
        entry = {
          itemId: seed.itemId,
          quantity: 0,
          price: Math.max(1, safePence(base * seed.priceMultiplier * business.priceMarkup)),
          targetStock: Math.max(1, Math.round(seed.restockTarget)),
          demandIndex: 1,
        };
        business.stock.push(entry);
      }
      const target = Math.max(
        1,
        Math.round(seed.restockTarget),
        Number.isFinite(entry.targetStock) ? Math.round(entry.targetStock) : 0
      );
      entry.targetStock = target;
      const missing = target - Math.max(0, Math.floor(entry.quantity));
      if (missing <= 0) continue;

      const roll = this.ctx.probability.roll('economy.business');
      const wanted = Math.round(clamp(missing * (0.6 + 0.4 * roll), 1, missing));
      const unitCost = Math.max(1, Math.round(this.market.marketPrice(seed.itemId) * RESTOCK_COST_RATIO));
      const affordable = Math.floor(Math.max(0, business.money) / unitCost);
      const quantity = Math.min(wanted, affordable);
      if (quantity <= 0) continue;

      const cost = quantity * unitCost;
      business.money = Math.max(0, business.money - cost);
      business.dailyExpenses += cost;
      entry.quantity = Math.max(0, Math.floor(entry.quantity)) + quantity;
      unitsOrdered += quantity;
      costPence += cost;
    }

    return { unitsOrdered, costPence };
  }
}
