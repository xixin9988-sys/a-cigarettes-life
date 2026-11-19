import type {
  ActionResult,
  BusinessState,
  IEconomySystem,
  IGameContext,
  JobState,
  MarketGoodState,
  PlayerShopState,
  ShopStockEntryState,
  TransactionRecord,
} from '../core/contracts';
import type { BusinessDef } from '../data/schema';
import type { BusinessId, ItemId, LocationId } from '../core/SharedTypes';
import { WORLD_CONFIG } from '../core/WorldConfig';
import {
  DAY_SIM_SECONDS,
  dayIndexAt,
  finiteNumber,
  HOUR_SIM_SECONDS,
  hourOfDayAt,
  locationsEquivalent,
} from './EconomyHelpers';
import { BusinessSystem } from './BusinessSystem';
import { EmploymentSystem } from './EmploymentSystem';
import { InventorySystem } from './InventorySystem';
import { MarketSystem } from './MarketSystem';
import { PlayerShopSystem } from './PlayerShopSystem';
import { PriceSystem } from './PriceSystem';
import { SupplyDemandSystem } from './SupplyDemandSystem';
import { TransactionSystem } from './TransactionSystem';

/** Safety cap on hours processed in a single update call (90 game days). */
const MAX_HOURS_PER_UPDATE = 24 * 90;

/**
 * EconomySystem - the registered simulation system (id 'economy') and the single facade
 * through which gameplay/UI touch shops, markets, jobs, transactions and player business.
 *
 * Update loop, driven by absolute sim time so arbitrary dt (including offline catch-up) works:
 *   for each elapsed game hour:
 *     07:00  NPC shops restock toward target stock (cost ~55% of market price)
 *     hour   open businesses simulate customers (stream economy.customer)
 *     22:00  NPC wages + owner profit share + BusinessDayRecord, idempotent per day
 *     hour   market supply/demand/price settlement (stream economy.market) + shop price refresh
 * IsOpen flags are kept in sync at the current instant for UI and validation.
 */
export class EconomySystem implements IEconomySystem {
  readonly id = 'economy';

  private ctx!: IGameContext;
  private price!: PriceSystem;
  private supplyDemand!: SupplyDemandSystem;
  private market!: MarketSystem;
  private inventory!: InventorySystem;
  private transactions!: TransactionSystem;
  private employment!: EmploymentSystem;
  private business!: BusinessSystem;
  private playerShop!: PlayerShopSystem;
  private initialised = false;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    const state = ctx.state;
    const now = ctx.clock.simTimeSeconds;

    this.price = new PriceSystem();
    this.supplyDemand = new SupplyDemandSystem(ctx);
    this.market = new MarketSystem(ctx, this.price, this.supplyDemand);
    this.inventory = new InventorySystem(ctx, this.market);
    this.transactions = new TransactionSystem(ctx, this.price, this.market, this.inventory);
    this.employment = new EmploymentSystem(ctx);
    this.business = new BusinessSystem(ctx, this.market, this.inventory, this.employment, this.transactions);
    this.playerShop = new PlayerShopSystem(ctx, this.market, this.inventory, this.employment);

    // Repair the persisted economy slice before anything reads it.
    const economy = state.economy;
    economy.economicIndex = finiteNumber(economy.economicIndex, 1);
    // Only whole hours are ever settled. Anchor to the current hour boundary so a system
    // constructed mid-session / on load never retroactively replays hours: offline catch-up
    // is driven by SimulationRuntime advancing the clock, not by init.
    economy.lastMarketSettlementAt = this.hourFloor(now);
    economy.lastDailySettlementDay = Math.floor(finiteNumber(economy.lastDailySettlementDay, -1));
    if (economy.transactions.length > 0) {
      economy.transactions = economy.transactions.filter(
        (record) => record && Number.isFinite(record.at) && record.type !== undefined
      );
    }

    this.market.ensureMarket(now);
    this.business.normalise(now);
    this.employment.rebuildAssignments(now);
    this.market.refreshBusinessPrices();
    this.business.syncOpenStates(now);
    this.initialised = true;
  }

  update(dtSimSeconds: number): void {
    void dtSimSeconds;
    if (!this.initialised) return;
    const now = this.ctx.clock.simTimeSeconds;
    const economy = this.ctx.state.economy;
    const settlementHours = Math.max(1, Math.round(WORLD_CONFIG.economy.marketSettlementHours));
    const blockSeconds = settlementHours * HOUR_SIM_SECONDS;

    if (!Number.isFinite(economy.lastMarketSettlementAt) || economy.lastMarketSettlementAt > now) {
      economy.lastMarketSettlementAt = this.hourFloor(now);
    }
    if (economy.lastMarketSettlementAt % HOUR_SIM_SECONDS !== 0) {
      economy.lastMarketSettlementAt = this.hourFloor(economy.lastMarketSettlementAt);
    }

    let processed = 0;
    while (now - economy.lastMarketSettlementAt >= blockSeconds && processed < MAX_HOURS_PER_UPDATE) {
      const blockStart = economy.lastMarketSettlementAt;
      for (let offset = 0; offset < settlementHours; offset += 1) {
        const hourStart = blockStart + offset * HOUR_SIM_SECONDS;
        const localHour = hourOfDayAt(hourStart);
        const day = dayIndexAt(hourStart);

        if (localHour === WORLD_CONFIG.economy.restockHour) {
          this.business.restockAll(hourStart);
        }

        this.business.simulateHour(hourStart);

        if (localHour === WORLD_CONFIG.economy.dailySettlementHour) {
          this.business.settleDay(day, hourStart);
          const playerSettlement = this.playerShop.settleDay(day, hourStart);
          if (playerSettlement || day > economy.lastDailySettlementDay) {
            economy.lastDailySettlementDay = Math.max(economy.lastDailySettlementDay, day);
          }
        }
      }

      this.market.settleHour(blockStart + blockSeconds);
      processed += settlementHours;
    }

    this.business.syncOpenStates(now);
  }

  // -------------------------------------------------------------------------
  // IEconomySystem - reads
  // -------------------------------------------------------------------------
  getBusiness(id: BusinessId): BusinessState | undefined {
    return this.ctx.state.economy.businesses[id];
  }

  getBusinessDef(id: BusinessId): BusinessDef | undefined {
    return this.ctx.content.getBusiness(id);
  }

  getBusinesses(): BusinessState[] {
    return Object.values(this.ctx.state.economy.businesses);
  }

  getBusinessesAtLocation(locationId: LocationId): BusinessState[] {
    return this.getBusinesses().filter((business) => locationsEquivalent(business.locationId, locationId));
  }

  getMarket(): Record<ItemId, MarketGoodState> {
    return this.ctx.state.economy.market;
  }

  getMarketGood(itemId: ItemId): MarketGoodState | undefined {
    return this.ctx.state.economy.market[itemId];
  }

  getBusinessStock(businessId: BusinessId): ShopStockEntryState[] {
    const business = this.ctx.state.economy.businesses[businessId];
    return business ? business.stock : [];
  }

  getJobs(): JobState[] {
    return this.employment.getJobs();
  }

  getJobsAtLocation(locationId: LocationId): JobState[] {
    return this.employment.getJobsAtLocation(locationId);
  }

  getPlayerShop(): PlayerShopState | null {
    return this.ctx.state.economy.playerShop;
  }

  getRecentTransactions(limit?: number): TransactionRecord[] {
    return this.transactions.getRecentTransactions(limit);
  }

  // -------------------------------------------------------------------------
  // IEconomySystem - actions
  // -------------------------------------------------------------------------
  buyFromBusiness(businessId: BusinessId, itemId: ItemId, quantity: number): ActionResult {
    return this.transactions.buyFromBusiness(businessId, itemId, quantity);
  }

  sellToBusiness(businessId: BusinessId, itemId: ItemId, quantity: number, instanceId?: string): ActionResult {
    return instanceId === undefined
      ? this.transactions.sellToBusiness(businessId, itemId, quantity)
      : this.transactions.sellToBusiness(businessId, itemId, quantity, instanceId);
  }

  buyPlayerShop(businessId: BusinessId): ActionResult {
    return this.playerShop.buyPlayerShop(businessId);
  }

  setPlayerShopPrice(itemId: ItemId, pricePence: number): ActionResult {
    return this.playerShop.setPlayerShopPrice(itemId, pricePence);
  }

  restockPlayerShop(itemId: ItemId, quantity: number): ActionResult {
    return this.playerShop.restockPlayerShop(itemId, quantity);
  }

  togglePlayerShopOpen(open: boolean): ActionResult {
    return this.playerShop.togglePlayerShopOpen(open);
  }

  hireEmployee(npcId: string): ActionResult {
    return this.playerShop.hireEmployee(npcId);
  }

  fireEmployee(npcId: string): ActionResult {
    return this.playerShop.fireEmployee(npcId);
  }

  applyForJob(jobId: string): ActionResult {
    return this.employment.applyForJob(jobId);
  }

  quitJob(): ActionResult {
    return this.employment.quitJob();
  }

  workShift(): ActionResult {
    return this.employment.workShift();
  }

  // -------------------------------------------------------------------------
  // Extra public helpers (beyond IEconomySystem, documented for UI/Lead wiring)
  // -------------------------------------------------------------------------
  /** Live opening state, e.g. for shop-panel buttons and job applications. */
  isBusinessOpen(businessId: BusinessId, atSimSeconds?: number): boolean {
    return atSimSeconds === undefined
      ? this.business.isOpenAt(businessId)
      : this.business.isOpenAt(businessId, atSimSeconds);
  }

  getPlayerJob(): JobState | null {
    return this.employment.getPlayerJob();
  }

  /** Purchase quote for the player-shop UI: { purchasable, pricePence, reason }. */
  getPlayerShopQuote(businessId: BusinessId): ReturnType<PlayerShopSystem['purchaseQuote']> {
    return this.playerShop.purchaseQuote(businessId);
  }

  private hourFloor(simTimeSeconds: number): number {
    const safe = Math.max(0, finiteNumber(simTimeSeconds, 0));
    return Math.floor(safe / HOUR_SIM_SECONDS) * HOUR_SIM_SECONDS;
  }
}

export { DAY_SIM_SECONDS };