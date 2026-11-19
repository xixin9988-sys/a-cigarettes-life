import type { IGameContext, MarketGoodState, TransactionRecord } from '../core/contracts';
import type { ItemDef } from '../data/schema';
import { clamp } from '../core/utils';
import { finiteNumber } from './EconomyHelpers';

/** Aggregated demand pressure derived from the whole NPC population (0..1, 0.5 = neutral). */
export interface DemandSignals {
  foodNeed: number;
  energyNeed: number;
  funNeed: number;
  socialNeed: number;
  moneyPressure: number;
}

/**
 * Keeps abstract supply and demand for every market good in a plausible, mean-reverting
 * equilibrium. Supply and demand relax toward the good target stock each hour; recent
 * transactions and the needs of the whole NPC population push demand and supply around.
 * The result feeds PriceSystem.computeMarketPrice.
 */
export class SupplyDemandSystem {
  constructor(private readonly ctx: IGameContext) {}

  /** Scans every living NPC once per settlement. Cheap (56 NPCs) and deterministic. */
  collectDemandSignals(): DemandSignals {
    const npcs = this.ctx.state.npcs;
    let hunger = 0;
    let energy = 0;
    let fun = 0;
    let social = 0;
    let moneyPressure = 0;
    let count = 0;
    for (const npc of Object.values(npcs)) {
      if (!npc.alive) continue;
      count += 1;
      hunger += clamp(npc.needs.hunger / 100, 0, 1);
      energy += clamp(npc.needs.energy / 100, 0, 1);
      fun += clamp(npc.needs.fun / 100, 0, 1);
      social += clamp(npc.needs.belonging / 100, 0, 1);
      moneyPressure += clamp(npc.needs.moneyPressure / 100, 0, 1);
    }
    if (count === 0) {
      return { foodNeed: 0.5, energyNeed: 0.5, funNeed: 0.5, socialNeed: 0.5, moneyPressure: 0.5 };
    }
    return {
      foodNeed: hunger / count,
      energyNeed: energy / count,
      funNeed: fun / count,
      socialNeed: social / count,
      moneyPressure: moneyPressure / count,
    };
  }

  /**
   * Applies a completed trade to the market immediately. Called for every player trade and
   * every simulated NPC purchase. Applying pressure at trade time (instead of replaying the
   * capped 100-record transaction ring at settlement) keeps market pressure exact even on a
   * busy day, and keeps hourly-step and large-dt offline runs identical.
   */
  noteTransaction(record: TransactionRecord): void {
    if (!record.itemId || record.quantity <= 0) return;
    const good = this.ctx.state.economy.market[record.itemId];
    if (!good) return;
    const target = Math.max(1, finiteNumber(good.targetStock, 10));
    const cap = target * 4;
    if (record.type === 'buy' || record.type === 'shop_income') {
      good.demand = clamp(Math.max(1, finiteNumber(good.demand, target)) + record.quantity * 1.5, 1, cap);
    } else if (record.type === 'sell') {
      good.supply = clamp(Math.max(1, finiteNumber(good.supply, target)) + record.quantity * 1.25, 1, cap);
    }
  }

  /**
   * Applies one hourly settlement step to a market good.
   *  - supply/demand mean-revert to targetStock (production/consumption),
   *  - NPC needs shift demand by item use,
   *  - a small deterministic noise draw (economy.market stream) keeps the market alive.
   * Transaction pressure is added in noteTransaction() at trade time.
   */
  updateGood(good: MarketGoodState, item: ItemDef | undefined, signals: DemandSignals): void {
    const target = Math.max(1, finiteNumber(good.targetStock, 10));
    let supply = Math.max(1, finiteNumber(good.supply, target));
    let demand = Math.max(1, finiteNumber(good.demand, target));

    supply += (target - supply) * 0.08;
    demand += (target - demand) * 0.06;

    demand += this.needDemandBoost(item, signals, target);
    demand *= this.priceSensitivity(item, signals);

    const noise = 0.97 + this.ctx.probability.roll('economy.market') * 0.06;
    supply *= noise;
    demand *= 2 - noise;

    good.supply = Math.round(clamp(supply, 1, target * 4) * 100) / 100;
    good.demand = Math.round(clamp(demand, 1, target * 4) * 100) / 100;
  }

  /** Absolute demand added each hour because NPCs want to eat, rest, have fun or nest. */
  private needDemandBoost(item: ItemDef | undefined, signals: DemandSignals, target: number): number {
    if (!item) return 0;
    const tags = item.tags;
    const category = item.category;
    let boost = 0;
    if (category === 'food' || category === 'drink' || tags.includes('ingredient')) {
      boost += (signals.foodNeed - 0.35) * target * 0.35;
    }
    if (tags.includes('hot') || tags.includes('coffee') || tags.includes('tea')) {
      boost += (signals.energyNeed - 0.4) * target * 0.2;
    }
    if (category === 'book' || category === 'gift' || category === 'collectible') {
      boost += (signals.funNeed - 0.4) * target * 0.25;
    }
    if (category === 'furniture' || category === 'decor') {
      boost += (signals.socialNeed - 0.4) * target * 0.2;
    }
    return boost;
  }

  /**
   * Price sensitivity: when money is tight, cheap staples are in higher demand and luxury
   * goods lose demand; when the purse is comfortable, luxuries recover.
   */
  private priceSensitivity(item: ItemDef | undefined, signals: DemandSignals): number {
    if (!item) return 1;
    const base = Math.max(1, finiteNumber(item.basePrice, 1));
    const pressure = clamp(signals.moneyPressure, 0, 1);
    const cheap = clamp(1 - (base - 80) / 500, 0, 1);
    const luxury = clamp((base - 900) / 4000, 0, 1);
    const factor = 1 + pressure * (cheap * 0.18 - luxury * 0.22) - (1 - pressure) * luxury * 0.06;
    return clamp(factor, 0.7, 1.2);
  }
}