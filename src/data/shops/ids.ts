import type { BusinessId } from '../../core/SharedTypes';

/** Canonical business ids (Agent 0). */
export const BIZ = {
  willowCafe: 'biz_willow_cafe',
  willowBakery: 'biz_willow_bakery',
  willowFlorist: 'biz_willow_florist',
  willowGrocery: 'biz_willow_grocery',
  willowBookshop: 'biz_willow_bookshop',
  willowPostOffice: 'biz_willow_post_office',
  willowLibrary: 'biz_willow_library',
  willowMarketStall: 'biz_willow_market_stall',
  willowFarm: 'biz_willow_farm',
  willowTrainStation: 'biz_willow_train_station',
  ashfordSupermarket: 'biz_ashford_supermarket',
  ashfordConvenience: 'biz_ashford_convenience',
  ashfordClothing: 'biz_ashford_clothing',
  ashfordFurniture: 'biz_ashford_furniture',
  ashfordElectronics: 'biz_ashford_electronics',
  ashfordRestaurant: 'biz_ashford_restaurant',
  ashfordCafe: 'biz_ashford_cafe',
  ashfordMuseum: 'biz_ashford_museum',
  ashfordLibrary: 'biz_ashford_library',
  ashfordCinema: 'biz_ashford_cinema',
  ashfordTrainStation: 'biz_ashford_train_station',
  ashfordMarket: 'biz_ashford_market',
} as const;

export const ALL_BUSINESS_IDS: readonly BusinessId[] = Object.values(BIZ);
