import type { IGameContext, MarketGoodState } from '../core/contracts';
import type { ItemDef } from '../data/schema';
import type { Season } from '../core/SharedTypes';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { clamp } from '../core/utils';
import { clampPriceToBase, finiteNumber, PLAYER_SELL_RATIO, safePence } from './EconomyHelpers';

/** Supply/demand pressure coefficient: price moves +/-12% per full target-stock imbalance. */
const DEMAND_PRESSURE_ALPHA = 0.12;

const PRODUCE_SEASON: Readonly<Record<Season, number>> = { spring: 0.9, summer: 0.86, autumn: 1, winter: 1.18 };
const FISH_SEASON: Readonly<Record<Season, number>> = { spring: 1, summer: 1.05, autumn: 0.95, winter: 0.92 };
const SEED_SEASON: Readonly<Record<Season, number>> = { spring: 0.9, summer: 1, autumn: 1.1, winter: 1.15 };
const FLOWER_SEASON: Readonly<Record<Season, number>> = { spring: 0.9, summer: 0.92, autumn: 1.05, winter: 1.2 };
const FOOD_SEASON: Readonly<Record<Season, number>> = { spring: 1, summer: 0.97, autumn: 1, winter: 1.05 };
const GIFT_SEASON: Readonly<Record<Season, number>> = { spring: 1.05, summer: 1, autumn: 1, winter: 1.15 };
const HOT_DRINK_SEASON: Readonly<Record<Season, number>> = { spring: 1, summer: 0.85, autumn: 1.05, winter: 1.12 };
const COLD_DRINK_SEASON: Readonly<Record<Season, number>> = { spring: 1, summer: 1.1, autumn: 1, winter: 0.9 };

/**
 * Pure price maths for the abstract village market and the shop sticker prices.
 * Everything here is a deterministic function of MarketGoodState + static item data:
 * the brief mandates price = round(base * seasonalFactor * (1 + alpha * (demand - supply) / target) * markup)
 * clamped to [40%, 250%] of the item base price.
 */
export class PriceSystem {
  /** Seasonal price multiplier for an item (clamped to a gentle 0.75..1.3 band). */
  seasonalFactor(item: ItemDef | undefined, season: Season): number {
    if (!item) return 1;
    const category = item.category;
    const tags = item.tags;
    let factor = 1;
    let seasonal = 0;
    if (category === 'produce') seasonal = PRODUCE_SEASON[season];
    else if (category === 'fish') seasonal = FISH_SEASON[season];
    else if (category === 'seed') seasonal = SEED_SEASON[season];
    else if (category === 'food') seasonal = FOOD_SEASON[season];
    else if (category === 'gift') seasonal = GIFT_SEASON[season];
    if (seasonal > 0) factor *= seasonal;
    if (tags.includes('flower') || tags.includes('bouquet')) factor *= FLOWER_SEASON[season];
    if (tags.includes('hot') || tags.includes('soup') || tags.includes('stew')) factor *= HOT_DRINK_SEASON[season];
    if (tags.includes('cold') || tags.includes('refreshing') || tags.includes('lemonade')) {
      factor *= COLD_DRINK_SEASON[season];
    }
    return clamp(1 + (factor - 1) * 0.8, 0.75, 1.3);
  }

  /** Abstract market price for one good from supply/demand pressure and seasonal factor. */
  computeMarketPrice(good: MarketGoodState): number {
    const base = Math.max(1, finiteNumber(good.basePrice, 1));
    const seasonal = clamp(finiteNumber(good.seasonalFactor, 1), 0.5, 1.6);
    const target = Math.max(1, finiteNumber(good.targetStock, 1));
    const supply = Math.max(0, finiteNumber(good.supply, target));
    const demand = Math.max(0, finiteNumber(good.demand, target));
    const pressure = 1 + DEMAND_PRESSURE_ALPHA * ((demand - supply) / target);
    return clampPriceToBase(base * seasonal * clamp(pressure, 0.5, 2), base);
  }

  /**
   * Shop sticker price: current market price * the stock line multiplier * the business markup,
   * clamped to the global base-price band. Deterministic and finite.
   */
  computeShopPrice(marketPrice: number, basePrice: number, priceMultiplier: number, markup: number): number {
    const base = Math.max(1, finiteNumber(basePrice, 1));
    const multiplier = clamp(finiteNumber(priceMultiplier, 1), 0.5, 2);
    const markupSafe = clamp(finiteNumber(markup, 1), 0.5, 2);
    const market = Math.max(1, finiteNumber(marketPrice, base));
    return clampPriceToBase(market * multiplier * markupSafe, base);
  }

  /** Price the player receives when selling an item to a business (60% of the current market price). */
  sellPrice(good: MarketGoodState | undefined, basePrice: number): number {
    const reference = good && Number.isFinite(good.currentPrice) ? good.currentPrice : Math.max(1, basePrice);
    return Math.max(1, safePence(reference * PLAYER_SELL_RATIO));
  }

  /** Normalised price trend (-0.5..0.5) used by the UI to draw arrows. */
  trend(previousPrice: number, nextPrice: number, basePrice: number): number {
    const base = Math.max(1, finiteNumber(basePrice, 1));
    return clamp((finiteNumber(nextPrice, base) - finiteNumber(previousPrice, base)) / base, -0.5, 0.5);
  }

  /** Average market price / base price across all tradeable goods, clamped to a sane band. */
  economicIndex(goods: readonly MarketGoodState[]): number {
    let sum = 0;
    let count = 0;
    for (const good of goods) {
      const base = finiteNumber(good.basePrice, 0);
      const price = finiteNumber(good.currentPrice, 0);
      if (base <= 0 || price <= 0) continue;
      sum += clamp(price / base, WORLD_CONFIG.economy.priceClampMin, WORLD_CONFIG.economy.priceClampMax);
      count += 1;
    }
    if (count === 0) return 1;
    return clamp(sum / count, 0.5, 2);
  }
}
