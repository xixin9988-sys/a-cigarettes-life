import type { LocationId, RegionId } from '../../core/SharedTypes';

/** Canonical exterior location ids (Agent 0). Interiors use interiorIdFor(exteriorId). */
export const LOC = {
  // Willowbrook (25 exterior locations)
  home: 'willowbrook_home',
  center: 'willowbrook_center',
  cafe: 'willowbrook_cafe',
  bakery: 'willowbrook_bakery',
  flowerShop: 'willowbrook_flower_shop',
  grocery: 'willowbrook_grocery',
  bookshop: 'willowbrook_bookshop',
  postOffice: 'willowbrook_post_office',
  library: 'willowbrook_library',
  market: 'willowbrook_market',
  plaza: 'willowbrook_plaza',
  park: 'willowbrook_park',
  river: 'willowbrook_river',
  lake: 'willowbrook_lake',
  forest: 'willowbrook_forest',
  farm: 'willowbrook_farm',
  orchard: 'willowbrook_orchard',
  greenhouse: 'willowbrook_greenhouse',
  countryside: 'willowbrook_countryside',
  trainStation: 'willowbrook_train_station',
  warehouse: 'willowbrook_warehouse',
  abandonedFarmhouse: 'willowbrook_abandoned_farmhouse',
  hiddenGarden: 'willowbrook_hidden_garden',
  secretPath: 'willowbrook_secret_path',
  ancientWell: 'willowbrook_ancient_well',

  // Ashford City (20 exterior locations)
  highStreet: 'ashford_high_street',
  shoppingMall: 'ashford_shopping_mall',
  supermarket: 'ashford_supermarket',
  convenienceStore: 'ashford_convenience_store',
  clothingShop: 'ashford_clothing_shop',
  furnitureShop: 'ashford_furniture_shop',
  electronicsShop: 'ashford_electronics_shop',
  restaurant: 'ashford_restaurant',
  cityCafe: 'ashford_cafe',
  cityPark: 'ashford_city_park',
  museum: 'ashford_museum',
  cityLibrary: 'ashford_library',
  cinema: 'ashford_cinema',
  apartments: 'ashford_apartments',
  culturalCenter: 'ashford_cultural_center',
  riversideWalk: 'ashford_riverside_walk',
  ashfordTrainStation: 'ashford_train_station',
  cityResidential: 'ashford_city_residential',
  officeDistrict: 'ashford_office_district',
  eventSquare: 'ashford_event_square',
} as const;

export const WILLOWBROOK_EXTERIORS: readonly LocationId[] = [
  LOC.home,
  LOC.center,
  LOC.cafe,
  LOC.bakery,
  LOC.flowerShop,
  LOC.grocery,
  LOC.bookshop,
  LOC.postOffice,
  LOC.library,
  LOC.market,
  LOC.plaza,
  LOC.park,
  LOC.river,
  LOC.lake,
  LOC.forest,
  LOC.farm,
  LOC.orchard,
  LOC.greenhouse,
  LOC.countryside,
  LOC.trainStation,
  LOC.warehouse,
  LOC.abandonedFarmhouse,
  LOC.hiddenGarden,
  LOC.secretPath,
  LOC.ancientWell,
];

export const ASHFORD_EXTERIORS: readonly LocationId[] = [
  LOC.highStreet,
  LOC.shoppingMall,
  LOC.supermarket,
  LOC.convenienceStore,
  LOC.clothingShop,
  LOC.furnitureShop,
  LOC.electronicsShop,
  LOC.restaurant,
  LOC.cityCafe,
  LOC.cityPark,
  LOC.museum,
  LOC.cityLibrary,
  LOC.cinema,
  LOC.apartments,
  LOC.culturalCenter,
  LOC.riversideWalk,
  LOC.ashfordTrainStation,
  LOC.cityResidential,
  LOC.officeDistrict,
  LOC.eventSquare,
];

export const ALL_EXTERIOR_LOCATION_IDS: readonly LocationId[] = [...WILLOWBROOK_EXTERIORS, ...ASHFORD_EXTERIORS];

export const WILLOWBROOK_REGION: RegionId = 'willowbrook';
export const ASHFORD_REGION: RegionId = 'ashford';

/** Interior scene id convention: <exteriorId>_interior. */
export function interiorIdFor(exteriorId: LocationId): LocationId {
  return exteriorId + '_interior';
}

export const HOME_INTERIOR_ID: LocationId = interiorIdFor(LOC.home);
export const WILLOWBROOK_STATION_INTERIOR_ID: LocationId = interiorIdFor(LOC.trainStation);
export const ASHFORD_STATION_INTERIOR_ID: LocationId = interiorIdFor(LOC.ashfordTrainStation);

export function regionOfLocation(locationId: LocationId): RegionId {
  return WILLOWBROOK_EXTERIORS.includes(locationId) ||
    WILLOWBROOK_EXTERIORS.some((exterior) => interiorIdFor(exterior) === locationId)
    ? 'willowbrook'
    : 'ashford';
}
