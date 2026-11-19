import { describe, expect, it } from 'vitest';
import type { LocationDef } from '../../src/data/schema';
import type { LocationId } from '../../src/core/SharedTypes';
import { LOCATIONS } from '../../src/data/locations/locations';
import {
  ALL_EXTERIOR_LOCATION_IDS,
  ASHFORD_EXTERIORS,
  LOC,
  WILLOWBROOK_EXTERIORS,
  interiorIdFor,
  regionOfLocation,
} from '../../src/data/locations/ids';
import { ALL_BUSINESS_IDS, BIZ } from '../../src/data/shops/ids';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';

function byId(): Map<LocationId, LocationDef> {
  return new Map(LOCATIONS.map((def) => [def.id, def]));
}

const EXTERIORS = LOCATIONS.filter((def) => !def.indoor);
const INTERIORS = LOCATIONS.filter((def) => def.indoor);
const BY_ID = byId();

function reachableFromWalkGraph(start: LocationId): Set<LocationId> {
  const seen = new Set<LocationId>([start]);
  const queue: LocationId[] = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current === undefined) continue;
    const def = BY_ID.get(current);
    if (!def) continue;
    for (const neighbour of def.connections) {
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      queue.push(neighbour);
    }
  }
  return seen;
}

/** True when the two exteriors are connected using exterior edges only. */
function exteriorConnected(start: LocationId, target: LocationId): boolean {
  const seen = new Set<LocationId>([start]);
  const queue: LocationId[] = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current === target) return true;
    const def = current === undefined ? undefined : BY_ID.get(current);
    if (!def) continue;
    for (const neighbour of def.connections) {
      const neighbourDef = BY_ID.get(neighbour);
      if (!neighbourDef || neighbourDef.indoor) continue;
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      queue.push(neighbour);
    }
  }
  return seen.has(target);
}

describe('location data', () => {
  it('defines exactly the 45 canonical exteriors with unique ids', () => {
    expect(EXTERIORS).toHaveLength(45);
    const ids = EXTERIORS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...ALL_EXTERIOR_LOCATION_IDS].sort());
    expect(Object.keys(LOC)).toHaveLength(45);
  });

  it('splits exteriors into 25 Willowbrook and 20 Ashford locations', () => {
    const willowbrook = EXTERIORS.filter((def) => def.regionId === 'willowbrook').map((def) => def.id);
    const ashford = EXTERIORS.filter((def) => def.regionId === 'ashford').map((def) => def.id);
    expect([...willowbrook].sort()).toEqual([...WILLOWBROOK_EXTERIORS].sort());
    expect([...ashford].sort()).toEqual([...ASHFORD_EXTERIORS].sort());
  });

  it('has every location id from the canonical registry exactly once', () => {
    const ids = LOCATIONS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ALL_EXTERIOR_LOCATION_IDS) {
      expect(BY_ID.has(id), 'missing exterior ' + id).toBe(true);
    }
  });

  it('has rich, non-placeholder descriptions for every location', () => {
    for (const def of LOCATIONS) {
      expect(def.name.length, def.id + ' name').toBeGreaterThan(2);
      expect(def.description.length, def.id + ' description').toBeGreaterThan(40);
      expect(def.description.toLowerCase()).not.toContain('todo');
      expect(def.floorColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(def.accentColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(def.visual.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('gives every location a sane map footprint and position', () => {
    for (const def of LOCATIONS) {
      expect(def.widthTiles, def.id + ' width').toBeGreaterThanOrEqual(4);
      expect(def.heightTiles, def.id + ' height').toBeGreaterThanOrEqual(4);
      expect(def.widthTiles, def.id + ' width').toBeLessThanOrEqual(16);
      expect(def.heightTiles, def.id + ' height').toBeLessThanOrEqual(12);
      expect(def.mapX, def.id + ' mapX').toBeGreaterThan(0);
      expect(def.mapY, def.id + ' mapY').toBeGreaterThan(0);
      expect(def.openHour).toBeGreaterThanOrEqual(0);
      expect(def.closeHour).toBeLessThanOrEqual(24);
    }
  });

  it('keeps exterior connections undirected and fully connected per region', () => {
    for (const def of EXTERIORS) {
      expect(def.connections.length, def.id + ' should have neighbours').toBeGreaterThan(0);
      expect(def.connections, def.id + ' should list its own interior').toContain(interiorIdFor(def.id));
      for (const neighbour of def.connections) {
        const target = BY_ID.get(neighbour);
        expect(target, def.id + ' -> ' + neighbour).toBeDefined();
        expect(target?.connections, neighbour + ' -> ' + def.id + ' must be mirrored').toContain(def.id);
        if (target?.indoor) {
          // The only indoor neighbour of an exterior is its own building.
          expect(neighbour, def.id + ' must not link into another building').toBe(interiorIdFor(def.id));
          expect(target.entranceFrom).toBe(def.id);
        }
      }
    }
    for (const regionId of ['willowbrook', 'ashford'] as const) {
      const first = EXTERIORS.find((def) => def.regionId === regionId);
      expect(first).toBeDefined();
      if (!first) continue;
      for (const def of EXTERIORS.filter((candidate) => candidate.regionId === regionId)) {
        expect(exteriorConnected(first.id, def.id), regionId + ' cannot reach ' + def.id + ' on foot').toBe(true);
      }
    }
  });

  it('creates an interior for every exterior and links it to its exterior', () => {
    // The frozen contract expects every canonical exterior to have a matching
    // <exteriorId>_interior scene, including open-air venues (covered halls,
    // pavilions, huts and barns that belong to that place).
    const expectedInteriors: LocationId[] = ALL_EXTERIOR_LOCATION_IDS.map((exteriorId) => interiorIdFor(exteriorId));
    const interiorIds = new Set(INTERIORS.map((def) => def.id));
    expect(INTERIORS.length).toBe(expectedInteriors.length);
    for (const id of expectedInteriors) {
      expect(interiorIds.has(id), 'missing interior ' + id).toBe(true);
      const def = BY_ID.get(id);
      expect(def).toBeDefined();
      if (!def) continue;
      expect(def.indoor).toBe(true);
      expect(def.kind).toBe('interior');
      expect(def.entranceFrom).toBeDefined();
      expect(def.connections).toEqual([def.entranceFrom]);
      const exterior = def.entranceFrom ? BY_ID.get(def.entranceFrom) : undefined;
      expect(exterior?.connections).toContain(def.id);
      expect(exterior, def.id + ' entrance must exist').toBeDefined();
      expect(exterior?.indoor).toBe(false);
      expect(def.mapX).toBe(exterior?.mapX);
      expect(def.mapY).toBe(exterior?.mapY);
      expect(def.regionId).toBe(exterior?.regionId);
      expect(regionOfLocation(def.id)).toBe(exterior?.regionId);
    }
  });

  it('defines the secret locations with clue requirements', () => {
    const secretExteriors: LocationId[] = [LOC.hiddenGarden, LOC.secretPath, LOC.ancientWell];
    for (const id of secretExteriors) {
      const def = BY_ID.get(id);
      expect(def?.secret, id + ' should be secret').toBe(true);
      expect(def?.discoverable).toBe(true);
      expect(def?.clueRequirement ?? 0).toBeGreaterThan(0);
    }
    const basement = BY_ID.get(interiorIdFor(LOC.warehouse));
    expect(basement?.secret).toBe(true);
    expect(basement?.clueRequirement ?? 0).toBeGreaterThan(0);
    // The hidden garden and secret path are reachable from the forest once unlocked.
    const forest = BY_ID.get(LOC.forest);
    expect(forest?.connections).toContain(LOC.secretPath);
    expect(forest?.connections).toContain(LOC.hiddenGarden);
  });

  it('applies the documented microclimate rules', () => {
    for (const def of INTERIORS) {
      expect(def.shelter, def.id + ' shelter').toBe(1);
      expect(def.windExposure, def.id + ' wind').toBe(0);
    }
    expect(BY_ID.get(interiorIdFor(LOC.home))?.heatSource).toBe(true);
    expect(BY_ID.get(interiorIdFor(LOC.cafe))?.heatSource).toBe(true);
    expect(BY_ID.get(interiorIdFor(LOC.warehouse))?.heatSource).toBe(false);
    const park = BY_ID.get(LOC.park);
    expect(park?.shelter ?? 0).toBeGreaterThan(0.35);
    expect(park?.shelter ?? 1).toBeLessThan(0.6);
    const forest = BY_ID.get(LOC.forest);
    expect(forest?.shelter ?? 0).toBeGreaterThan(0.6);
    expect(forest?.windExposure ?? 1).toBeLessThan(0.25);
    for (const id of [LOC.river, LOC.riversideWalk]) {
      const def = BY_ID.get(id);
      expect(def?.windExposure ?? 0, id + ' wind exposure').toBeGreaterThanOrEqual(0.7);
      expect(def?.humidityModifier ?? 0, id + ' humidity').toBeGreaterThan(0);
    }
    for (const id of [LOC.river, LOC.lake, LOC.riversideWalk]) {
      const def = BY_ID.get(id);
      expect(def?.fishSpot, id + ' fish spot').toBeDefined();
      expect(['river', 'lake', 'canal', 'pond', 'stream']).toContain(def?.fishSpot?.waterType);
      expect(def?.fishSpot?.quality ?? -1).toBeGreaterThan(0);
    }
    const cafeInterior = BY_ID.get(interiorIdFor(LOC.cafe));
    expect(cafeInterior?.heatSource).toBe(true);
    expect(cafeInterior?.facilities).toContain('cafe');
  });

  it('references only canonical business ids and assigns every wired business', () => {
    const wired = new Set<string>();
    const claimedBy = new Map<string, LocationId>();
    for (const def of LOCATIONS) {
      if (!def.businessId) continue;
      expect(ALL_BUSINESS_IDS, def.id + ' business').toContain(def.businessId);
      expect(claimedBy.has(def.businessId), 'business claimed by two locations: ' + def.businessId).toBe(false);
      claimedBy.set(def.businessId, def.id);
      wired.add(def.businessId);
    }
    expect(claimedBy.size).toBe(ALL_BUSINESS_IDS.length);
    // Every business with a dedicated building is wired to its interior.
    const buildingBusinesses = [
      BIZ.willowCafe,
      BIZ.willowBakery,
      BIZ.willowFlorist,
      BIZ.willowGrocery,
      BIZ.willowBookshop,
      BIZ.willowPostOffice,
      BIZ.willowLibrary,
      BIZ.willowMarketStall,
      BIZ.willowFarm,
      BIZ.willowTrainStation,
      BIZ.ashfordSupermarket,
      BIZ.ashfordConvenience,
      BIZ.ashfordClothing,
      BIZ.ashfordFurniture,
      BIZ.ashfordElectronics,
      BIZ.ashfordRestaurant,
      BIZ.ashfordCafe,
      BIZ.ashfordMuseum,
      BIZ.ashfordLibrary,
      BIZ.ashfordCinema,
      BIZ.ashfordTrainStation,
    ];
    for (const businessId of buildingBusinesses) {
      expect(wired.has(businessId), 'business id not wired to any location: ' + businessId).toBe(true);
    }
  });

  it('gives facilities/fish spots/forage tags only in valid shapes', () => {
    const validFacilities = new Set([
      'shop',
      'cafe',
      'bakery',
      'library',
      'museum',
      'workbench',
      'kitchen',
      'campfire',
      'bed',
      'storage',
      'stage',
      'fishing_spot',
      'forage',
      'train',
      'farmland',
      'greenhouse',
      'heater',
      'noticeboard',
      'art_studio',
      'cinema_screen',
      'office_desk',
      'shop_counter',
    ]);
    for (const def of LOCATIONS) {
      for (const facility of def.facilities) {
        expect(validFacilities.has(facility), def.id + ' facility ' + facility).toBe(true);
      }
      expect(Array.isArray(def.connections)).toBe(true);
    }
    const station = BY_ID.get(LOC.trainStation);
    expect(station?.facilities).toContain('train');
    expect(BY_ID.get(LOC.farm)?.facilities).toContain('farmland');
    expect(BY_ID.get(LOC.forest)?.forageTags.length ?? 0).toBeGreaterThan(0);
  });

  it('keeps every location scene within the renderable map size', () => {
    const maxPixels = WORLD_CONFIG.map.renderWidth * 3;
    for (const def of LOCATIONS) {
      const widthPx = def.widthTiles * WORLD_CONFIG.map.tileSize;
      const heightPx = def.heightTiles * WORLD_CONFIG.map.tileSize;
      expect(widthPx).toBeGreaterThan(0);
      expect(widthPx).toBeLessThanOrEqual(maxPixels);
      expect(heightPx).toBeLessThanOrEqual(maxPixels);
    }
  });
});
