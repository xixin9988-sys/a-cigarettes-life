import type {
  ActionResult,
  ActionErrorCode,
  BusinessState,
  GameEventMap,
  IGameContext,
  MarketGoodState,
  ShopStockEntryState,
  TransactionRecord,
} from '../core/contracts';
import type { BusinessType, ItemDef } from '../data/schema';
import type { ItemId, JsonValue, QualityStars } from '../core/SharedTypes';
import { GAME_MINUTES_PER_DAY, GAME_MINUTES_PER_HOUR, SECONDS_PER_GAME_MINUTE } from '../core/SharedTypes';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { isWithinHours } from '../core/TimeUtil';
import { clamp, roundMoney } from '../core/utils';
import { formatMoney } from '../core/format';

/** One in-game hour and day expressed in simulated seconds (1 sim second = 1 game minute). */
export const HOUR_SIM_SECONDS = GAME_MINUTES_PER_HOUR * SECONDS_PER_GAME_MINUTE;
export const DAY_SIM_SECONDS = GAME_MINUTES_PER_DAY * SECONDS_PER_GAME_MINUTE;

/** Ring sizes mandated by the economy brief / contract. */
export const TRANSACTION_LOG_LIMIT = 100;
export const BUSINESS_HISTORY_LIMIT = 60;
export const PLAYER_SHOP_EMPLOYEE_LIMIT = 3;
/** Cash the player's shop keeps in the till instead of paying out as daily profit. */
export const PLAYER_SHOP_FLOAT = 2000;
/** Fraction of positive trading profit the NPC owner of a business takes home each day. */
export const OWNER_PROFIT_SHARE = 0.45;
/** Restock cost as a fraction of the item's current market price. */
export const RESTOCK_COST_RATIO = 0.55;
/** Fraction of current market price paid when the player sells to a business. */
export const PLAYER_SELL_RATIO = 0.6;
/** Minimum cash an NPC will not spend below when shopping. */
export const NPC_RESERVE_MINIMUM = 400;

/**
 * Weekly closing days, keyed by business type. The BusinessDef schema has no closed-day
 * field (documented contract gap), so the economy module owns this small balance rule:
 *  - libraries and museums close on Mondays (0),
 *  - the post office closes on Sundays (6),
 *  - city furniture/electronics/clothing shops close on Mondays (0).
 * Cafés, bakeries, groceries, supermarkets, convenience stores, markets, restaurants,
 * cinemas, farms and stations trade every day.
 */
export const WEEKLY_CLOSED_DAYS: Readonly<Partial<Record<BusinessType, readonly number[]>>> = {
  library: [0],
  museum: [0],
  post_office: [6],
  furniture_shop: [0],
  electronics_shop: [0],
  clothing_shop: [0],
};

const BUSINESS_TYPES: readonly BusinessType[] = [
  'cafe',
  'bakery',
  'flower_shop',
  'grocery',
  'bookshop',
  'post_office',
  'library',
  'market_stall',
  'restaurant',
  'supermarket',
  'convenience_store',
  'clothing_shop',
  'furniture_shop',
  'electronics_shop',
  'cinema',
  'museum',
  'farm',
  'player_shop',
];

/** Business types the player is allowed to purchase outright. */
export const PURCHASABLE_BUSINESS_TYPES: readonly BusinessType[] = [
  'cafe',
  'bakery',
  'flower_shop',
  'grocery',
  'bookshop',
  'market_stall',
  'restaurant',
  'supermarket',
  'convenience_store',
  'clothing_shop',
  'furniture_shop',
  'electronics_shop',
  'cinema',
  'farm',
];

/** Purchase price in pence by business type (before reputation adjustment). */
export const PLAYER_SHOP_BASE_PRICE: Readonly<Record<BusinessType, number>> = {
  cafe: 140000,
  bakery: 120000,
  flower_shop: 100000,
  grocery: 180000,
  bookshop: 110000,
  post_office: 90000,
  library: 90000,
  market_stall: 80000,
  restaurant: 220000,
  supermarket: 350000,
  convenience_store: 150000,
  clothing_shop: 170000,
  furniture_shop: 200000,
  electronics_shop: 260000,
  cinema: 300000,
  museum: 150000,
  farm: 240000,
  player_shop: 120000,
};

export function weekdayIndexAt(simTimeSeconds: number): number {
  return Math.floor(Math.max(0, simTimeSeconds) / DAY_SIM_SECONDS) % 7;
}

export function hourOfDayAt(simTimeSeconds: number): number {
  return Math.floor(Math.max(0, simTimeSeconds) / HOUR_SIM_SECONDS) % 24;
}

export function dayIndexAt(simTimeSeconds: number): number {
  return Math.floor(Math.max(0, simTimeSeconds) / DAY_SIM_SECONDS);
}

export function isClosedWeekday(type: BusinessType, weekdayIndex: number): boolean {
  const days = WEEKLY_CLOSED_DAYS[type];
  return days ? days.includes(weekdayIndex) : false;
}

export function businessTypeOf(ctx: IGameContext, business: BusinessState): BusinessType {
  const def = ctx.content.getBusiness(business.id);
  if (def && BUSINESS_TYPES.includes(def.type)) return def.type;
  const raw = business.type;
  const match = BUSINESS_TYPES.find((type) => type === raw);
  return match ?? 'convenience_store';
}

/** True when the business is within its opening hours and not on a weekly closing day. */
export function businessOpenAt(business: BusinessState, type: BusinessType, simTimeSeconds: number): boolean {
  if (!isWithinHours(hourOfDayAt(simTimeSeconds), business.openHour, business.closeHour)) return false;
  return !isClosedWeekday(type, weekdayIndexAt(simTimeSeconds));
}

/** Strips the interior suffix from an interior location id. */
export function exteriorIdOf(locationId: string): string {
  return locationId.endsWith('_interior') ? locationId.slice(0, -'_interior'.length) : locationId;
}

/** Two locations are equivalent for interaction when they are the same or exterior/interior pair. */
export function locationsEquivalent(a: string, b: string): boolean {
  return a === b || exteriorIdOf(a) === exteriorIdOf(b);
}

/** True when the player stands at the business (inside or directly outside the door). */
export function playerAtBusiness(ctx: IGameContext, business: BusinessState): boolean {
  return locationsEquivalent(ctx.state.player.position.locationId, business.locationId);
}

/** True when the player stands at the given location or its interior. */
export function playerAtLocation(ctx: IGameContext, locationId: string): boolean {
  return locationsEquivalent(ctx.state.player.position.locationId, locationId);
}

export function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function safePence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function basePriceOf(ctx: IGameContext, itemId: ItemId): number {
  const item = ctx.content.getItem(itemId);
  if (item && Number.isFinite(item.basePrice) && item.basePrice > 0) return item.basePrice;
  const good = ctx.state.economy.market[itemId];
  if (good && Number.isFinite(good.basePrice) && good.basePrice > 0) return good.basePrice;
  return 100;
}

export function itemDefOf(ctx: IGameContext, itemId: ItemId): ItemDef | undefined {
  return ctx.content.getItem(itemId);
}

export function itemNameOf(ctx: IGameContext, itemId: ItemId): string {
  return ctx.content.getItem(itemId)?.name ?? itemId;
}

export function marketPriceOf(ctx: IGameContext, itemId: ItemId): number {
  const good = ctx.state.economy.market[itemId];
  if (good && Number.isFinite(good.currentPrice)) return Math.max(1, Math.round(good.currentPrice));
  return Math.max(1, Math.round(basePriceOf(ctx, itemId)));
}

/** Clamps a price to the global [40%, 250%] band around the item base price. */
export function clampPriceToBase(price: number, basePrice: number): number {
  const { priceClampMin, priceClampMax } = WORLD_CONFIG.economy;
  const safeBase = Math.max(1, finiteNumber(basePrice, 1));
  const raw = finiteNumber(price, safeBase);
  return safePence(clamp(raw, safeBase * priceClampMin, safeBase * priceClampMax));
}

export function stockEntryOf(business: BusinessState, itemId: ItemId): ShopStockEntryState | undefined {
  return business.stock.find((entry) => entry.itemId === itemId);
}

export function totalStockUnits(business: BusinessState): number {
  return business.stock.reduce((total, entry) => total + Math.max(0, Math.floor(entry.quantity)), 0);
}

export function stockValueOf(business: BusinessState, market: Record<ItemId, MarketGoodState>): number {
  let value = 0;
  for (const entry of business.stock) {
    const good = market[entry.itemId];
    const unit = good && Number.isFinite(good.currentPrice) ? good.currentPrice : entry.price;
    value += Math.max(0, entry.quantity) * Math.max(1, finiteNumber(unit, entry.price));
  }
  return safePence(value);
}

/** Living reserve an NPC will not spend below (never negative money). */
export function npcSpendingReserve(npcMoney: number): number {
  const { livingReserveRatio } = WORLD_CONFIG.npcEconomy;
  return Math.max(NPC_RESERVE_MINIMUM, Math.round(Math.max(0, npcMoney) * livingReserveRatio));
}

export function actionOk(message: string, data?: JsonValue): ActionResult {
  const result: ActionResult = { ok: true, message, stateChanged: true };
  if (data !== undefined) result.data = data;
  return result;
}

export function actionUnchanged(message: string): ActionResult {
  return { ok: true, message, stateChanged: false };
}

export function actionFail(code: ActionErrorCode, message: string): ActionResult {
  return { ok: false, message, code, stateChanged: false };
}

/** Applies a player money delta (validated by the caller) and emits money:changed. Never goes negative. */
export function adjustPlayerMoney(ctx: IGameContext, delta: number, reason: string): number {
  const player = ctx.state.player;
  const amount = Math.round(delta);
  const next = Math.max(0, Math.round(player.money) + amount);
  const applied = next - player.money;
  player.money = next;
  ctx.bus.emit('money:changed', { amount: applied, balance: next, reason });
  return next;
}

export function emitItemAcquired(
  ctx: IGameContext,
  itemId: ItemId,
  quantity: number,
  quality: QualityStars,
  source: string
): void {
  ctx.bus.emit('item:acquired', { itemId, quantity, quality, source });
}

export function emitItemLost(ctx: IGameContext, itemId: ItemId, quantity: number, reason: string): void {
  ctx.bus.emit('item:lost', { itemId, quantity, reason });
}

export function emitSignal(ctx: IGameContext, name: string, data?: JsonValue): void {
  const payload: GameEventMap['game:signal'] = data === undefined ? { name } : { name, data };
  ctx.bus.emit('game:signal', payload);
}

export type TransactionDraft = Omit<TransactionRecord, 'id'>;

/** Appends a transaction to the capped ring buffer and notifies listeners for player transactions. */
export function pushTransaction(ctx: IGameContext, draft: TransactionDraft): TransactionRecord {
  const economy = ctx.state.economy;
  const record: TransactionRecord = {
    ...draft,
    id: 'txn_' + Math.floor(draft.at) + '_' + (economy.transactions.length + 1) + '_' + draft.type,
    quantity: Math.max(0, Math.floor(draft.quantity)),
    totalPrice: safePence(draft.totalPrice),
    unitPrice: safePence(draft.unitPrice),
  };
  economy.transactions.push(record);
  if (economy.transactions.length > TRANSACTION_LOG_LIMIT) {
    economy.transactions.splice(0, economy.transactions.length - TRANSACTION_LOG_LIMIT);
  }
  if (record.actorId === ctx.state.player.id) {
    ctx.bus.emit('transaction:completed', { record });
  }
  return record;
}

/** Human readable price helper used in ActionResult messages. */
export function money(pence: number): string {
  return formatMoney(roundMoney(pence));
}

/** Rounds a pence amount safely. */
export function pence(value: number): number {
  return Math.max(0, roundMoney(finiteNumber(value, 0)));
}