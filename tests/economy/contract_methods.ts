import type { IEconomySystem } from '../../src/core/contracts';

/** Method names required by IEconomySystem in the frozen contract. */
export const IEconomy_METHODS: readonly (keyof IEconomySystem)[] = [
  'getBusiness',
  'getBusinessDef',
  'getBusinesses',
  'getBusinessesAtLocation',
  'getMarket',
  'getMarketGood',
  'getBusinessStock',
  'getJobs',
  'getJobsAtLocation',
  'buyFromBusiness',
  'sellToBusiness',
  'getPlayerShop',
  'buyPlayerShop',
  'setPlayerShopPrice',
  'restockPlayerShop',
  'togglePlayerShopOpen',
  'hireEmployee',
  'fireEmployee',
  'applyForJob',
  'quitJob',
  'workShift',
  'getRecentTransactions',
  'init',
  'update',
];
