import type {
  ActionResult,
  BusinessState,
  IGameContext,
  NPCState,
  ShopStockEntryState,
  TransactionRecord,
} from '../core/contracts';
import type { ItemId } from '../core/SharedTypes';
import { addItemToInventory, countItem, findEntry, removeItemFromInventory } from '../core/InventoryUtil';
import { clamp } from '../core/utils';
import {
  actionFail,
  actionOk,
  adjustPlayerMoney,
  basePriceOf,
  businessOpenAt,
  businessTypeOf,
  emitItemAcquired,
  emitItemLost,
  finiteNumber,
  money,
  playerAtBusiness,
  pushTransaction,
  safePence,
  TRANSACTION_LOG_LIMIT,
} from './EconomyHelpers';
import type { InventorySystem } from './InventorySystem';
import type { MarketSystem } from './MarketSystem';
import type { PriceSystem } from './PriceSystem';

/**
 * Atomic player <-> business trades. Every validation happens before any mutation, so a
 * failed trade leaves money, stock and inventory untouched; money can never go negative.
 */
export class TransactionSystem {
  constructor(
    private readonly ctx: IGameContext,
    private readonly price: PriceSystem,
    private readonly market: MarketSystem,
    private readonly inventory: InventorySystem
  ) {}

  /** Most recent transactions first. */
  getRecentTransactions(limit = TRANSACTION_LOG_LIMIT): TransactionRecord[] {
    const safeLimit = clamp(Math.floor(limit), 1, TRANSACTION_LOG_LIMIT);
    return this.ctx.state.economy.transactions.slice(-safeLimit).reverse();
  }

  /** True when the business is serving customers right now (hours, closed days, player toggle). */
  isServing(business: BusinessState): boolean {
    const now = this.ctx.clock.simTimeSeconds;
    if (!businessOpenAt(business, businessTypeOf(this.ctx, business), now)) return false;
    if (business.isPlayerOwned) {
      const shop = this.ctx.state.economy.playerShop;
      if (!shop || shop.businessId !== business.id) return false;
      return shop.open;
    }
    return true;
  }

  /** Buys quantity of an item from a business. All-or-nothing. */
  buyFromBusiness(businessId: string, itemId: ItemId, quantity: number): ActionResult {
    const state = this.ctx.state;
    const player = state.player;
    const business = state.economy.businesses[businessId];
    if (!business) return actionFail('not_found', 'That business does not exist.');
    if (business.isPlayerOwned) {
      return actionFail('not_allowed', 'You cannot buy from your own shop — take stock from the counter instead.');
    }
    const wanted = Math.floor(finiteNumber(quantity, 0));
    if (wanted < 1) return actionFail('invalid', 'Choose a quantity of at least 1.');

    const entry = this.inventory.getStockEntry(business, itemId);
    if (!entry) {
      return actionFail('not_found', business.name + ' does not sell ' + this.itemName(itemId) + '.');
    }
    if (!this.isServing(business)) {
      return actionFail('wrong_time', business.name + ' is closed right now.');
    }
    if (!playerAtBusiness(this.ctx, business)) {
      return actionFail('wrong_location', 'You need to be at ' + business.name + ' to shop there.');
    }
    const available = Math.max(0, Math.floor(entry.quantity));
    if (available < wanted) {
      return actionFail(
        'not_enough_items',
        available > 0
          ? 'Only ' + available + ' × ' + this.itemName(itemId) + ' left in stock.'
          : this.itemName(itemId) + ' is out of stock.'
      );
    }

    const unitPrice = Math.max(1, safePence(entry.price));
    const totalPrice = unitPrice * wanted;
    if (player.money < totalPrice) {
      return actionFail(
        'not_enough_money',
        'You need ' + money(totalPrice) + ' but only have ' + money(player.money) + '.'
      );
    }

    // ---- mutations ----
    entry.quantity = available - wanted;
    business.money = Math.max(0, Math.round(business.money + totalPrice));
    business.dailyRevenue += totalPrice;
    business.totalRevenue += totalPrice;
    business.dailyCustomers += 1;
    adjustPlayerMoney(this.ctx, -totalPrice, 'Bought ' + this.itemName(itemId) + ' from ' + business.name);

    const item = this.ctx.content.getItem(itemId);
    const added = addItemToInventory(player.inventory, itemId, wanted, {
      quality: 2,
      freshness: item?.edible ? 0.9 : 1,
      simTime: this.ctx.clock.simTimeSeconds,
      maxStack: item?.maxStack ?? 99,
    });
    void added;
    emitItemAcquired(this.ctx, itemId, wanted, 2, business.name);

    player.statistics.itemsBought += wanted;
    player.statistics.moneySpent += totalPrice;

    const buyRecord = pushTransaction(this.ctx, {
      at: this.ctx.clock.simTimeSeconds,
      type: 'buy',
      actorId: player.id,
      businessId: business.id,
      itemId,
      quantity: wanted,
      unitPrice,
      totalPrice,
      note: 'Bought ' + wanted + ' × ' + this.itemName(itemId) + ' at ' + business.name,
    });
    this.market.noteTransaction(buyRecord);

    return actionOk(
      'Bought ' + wanted + ' × ' + this.itemName(itemId) + ' for ' + money(totalPrice) + '.',
      { businessId: business.id, itemId, quantity: wanted, totalPrice }
    );
  }

  /** Sells quantity of a carried item to a business at 60% of the current market price. */
  sellToBusiness(businessId: string, itemId: ItemId, quantity: number, instanceId?: string): ActionResult {
    const state = this.ctx.state;
    const player = state.player;
    const business = state.economy.businesses[businessId];
    if (!business) return actionFail('not_found', 'That business does not exist.');
    if (business.isPlayerOwned) {
      return actionFail('not_allowed', 'That is your own shop — you cannot sell stock back to yourself.');
    }
    const wanted = Math.floor(finiteNumber(quantity, 0));
    if (wanted < 1) return actionFail('invalid', 'Choose a quantity of at least 1.');
    const item = this.ctx.content.getItem(itemId);
    if (!item) return actionFail('not_found', 'That item does not exist.');
    if (!this.isServing(business)) {
      return actionFail('wrong_time', business.name + ' is closed right now.');
    }
    if (!playerAtBusiness(this.ctx, business)) {
      return actionFail('wrong_location', 'You need to be at ' + business.name + ' to trade there.');
    }

    if (instanceId) {
      const entry = findEntry(player.inventory, instanceId);
      if (!entry || entry.itemId !== itemId) {
        return actionFail('not_found', 'You are not carrying that item.');
      }
      if (entry.quantity < wanted) {
        return actionFail('not_enough_items', 'You only have ' + entry.quantity + ' × ' + item.name + '.');
      }
    } else if (countItem(player.inventory, itemId) < wanted) {
      return actionFail('not_enough_items', 'You only have ' + countItem(player.inventory, itemId) + ' × ' + item.name + '.');
    }

    const good = this.market.getGood(itemId);
    const unitPrice = this.price.sellPrice(good, basePriceOf(this.ctx, itemId));
    const totalPrice = unitPrice * wanted;
    if (business.money < totalPrice) {
      return actionFail(
        'not_enough_money',
        business.name + ' cannot afford ' + money(totalPrice) + ' right now (till: ' + money(business.money) + ').'
      );
    }

    // ---- mutations ----
    const removed = removeItemFromInventory(player.inventory, itemId, wanted, instanceId);
    if (removed !== wanted) {
      // Defensive: validation above guarantees this cannot happen; fail without touching money.
      return actionFail('not_enough_items', 'You are not carrying enough ' + item.name + '.');
    }
    business.money = Math.max(0, Math.round(business.money - totalPrice));
    business.dailyExpenses += totalPrice;
    if (this.inventory.getStockEntry(business, itemId)) {
      this.inventory.addStock(business, itemId, wanted);
    }
    adjustPlayerMoney(this.ctx, totalPrice, 'Sold ' + item.name + ' to ' + business.name);

    player.statistics.itemsSold += wanted;
    player.statistics.moneyEarned += totalPrice;
    emitItemLost(this.ctx, itemId, wanted, 'Sold to ' + business.name);

    const sellRecord = pushTransaction(this.ctx, {
      at: this.ctx.clock.simTimeSeconds,
      type: 'sell',
      actorId: player.id,
      businessId: business.id,
      itemId,
      quantity: wanted,
      unitPrice,
      totalPrice,
      note: 'Sold ' + wanted + ' × ' + item.name + ' to ' + business.name,
    });
    this.market.noteTransaction(sellRecord);

    return actionOk('Sold ' + wanted + ' × ' + item.name + ' for ' + money(totalPrice) + '.', {
      businessId: business.id,
      itemId,
      quantity: wanted,
      totalPrice,
    });
  }

  /**
   * Records a simulated NPC purchase (used by BusinessSystem customer simulation).
   * Callers have already checked affordability; this keeps all balance maths in one place.
   */
  recordNpcPurchase(
    business: BusinessState,
    npc: NPCState,
    entry: ShopStockEntryState,
    unitPrice: number,
    atSimSeconds: number
  ): void {
    const pricePaid = Math.max(1, safePence(unitPrice));
    business.money = Math.max(0, Math.round(business.money + pricePaid));
    business.dailyRevenue += pricePaid;
    business.totalRevenue += pricePaid;
    business.dailyCustomers += 1;
    npc.money = Math.max(0, Math.round(npc.money - pricePaid));
    const purchaseRecord = pushTransaction(this.ctx, {
      at: atSimSeconds,
      type: 'buy',
      actorId: npc.id,
      businessId: business.id,
      itemId: entry.itemId,
      quantity: 1,
      unitPrice: pricePaid,
      totalPrice: pricePaid,
      note: npc.name + ' bought ' + this.itemName(entry.itemId) + ' at ' + business.name,
    });
    this.market.noteTransaction(purchaseRecord);
  }

  private itemName(itemId: ItemId): string {
    return this.ctx.content.getItem(itemId)?.name ?? itemId;
  }
}