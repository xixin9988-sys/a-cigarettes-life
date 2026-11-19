import { describe, expect, it } from 'vitest';
import type { ContentPack, LocationDef } from '../../src/data/schema';
import type { LocationId } from '../../src/core/SharedTypes';
import { ContentRegistry } from '../../src/core/ContentRegistry';
import { MapManager } from '../../src/world/MapManager';
import { LOC } from '../../src/data/locations/ids';
import { interiorIdFor } from '../../src/data/locations/ids';
import { createWorldTestBed, TEST_PACK } from './helpers';

function minimalLocation(
  id: string,
  connections: string[],
  mapX: number,
  mapY: number,
  regionId: 'willowbrook' | 'ashford' = 'willowbrook'
): LocationDef {
  return {
    id,
    name: id,
    regionId,
    kind: 'exploration_area',
    description: 'Test location ' + id,
    indoor: false,
    mapX,
    mapY,
    widthTiles: 4,
    heightTiles: 4,
    connections,
    shelter: 0,
    windExposure: 0.5,
    humidityModifier: 0,
    heatSource: false,
    openHour: 0,
    closeHour: 24,
    facilities: [],
    eventTags: [],
    forageTags: [],
    discoverable: true,
    secret: false,
    theme: 'countryside',
    visual: { shape: 'rect', color: '#ffffff' },
    floorColor: '#ffffff',
    accentColor: '#000000',
  };
}

function packWithLocations(locations: LocationDef[]): ContentPack {
  return { ...TEST_PACK, locations, trainRoutes: [] };
}

function mapFor(locations: LocationDef[]): MapManager {
  const bed = createWorldTestBed();
  const content = new ContentRegistry(packWithLocations(locations));
  const map = new MapManager();
  map.init({ ...bed.ctx, content });
  return map;
}

describe('MapManager', () => {
  it('builds a valid, connected navigation graph from the real world data', () => {
    const bed = createWorldTestBed();
    expect(bed.world.map.validate()).toEqual([]);
    expect(bed.world.map.validateConnectivity()).toEqual([]);
  });

  it('walks the real world with BFS and returns adjacent hops', () => {
    const bed = createWorldTestBed();
    const path = bed.world.map.findPath(LOC.home, LOC.cafe);
    expect(path).not.toBeNull();
    if (!path) return;
    expect(path[0]).toBe(LOC.home);
    expect(path[path.length - 1]).toBe(LOC.cafe);
    for (let i = 1; i < path.length; i += 1) {
      const previous = path[i - 1];
      const current = path[i];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      if (previous && current) expect(bed.world.map.areAdjacent(previous, current)).toBe(true);
    }
  });

  it('returns a single node path for same-location and null for unknown locations', () => {
    const bed = createWorldTestBed();
    expect(bed.world.map.findPath(LOC.center, LOC.center)).toEqual([LOC.center]);
    expect(bed.world.map.findPath(LOC.center, 'not_a_location')).toBeNull();
    expect(bed.world.map.findPath('not_a_location', LOC.center)).toBeNull();
  });

  it('routes through interiors as leaves of their exterior', () => {
    const bed = createWorldTestBed();
    const cafeInterior = interiorIdFor(LOC.cafe);
    const path = bed.world.map.findPath(cafeInterior, LOC.center);
    expect(path).not.toBeNull();
    expect(path?.[0]).toBe(cafeInterior);
    expect(path?.[1]).toBe(LOC.cafe);
    expect(bed.world.map.getAdjacent(cafeInterior)).toEqual([LOC.cafe]);
  });

  it('plans cross-region travel using the rail link', () => {
    const bed = createWorldTestBed();
    const route = bed.world.map.findTravelRoute(LOC.center, LOC.highStreet);
    expect(route).not.toBeNull();
    if (!route) return;
    expect(route.usesRail).toBe(true);
    expect(route.path[route.path.length - 1]).toBe(LOC.highStreet);
    expect(route.path).toContain(LOC.trainStation);
    expect(route.path).toContain(LOC.ashfordTrainStation);
    expect(route.totalMinutes).toBeGreaterThan(30);
    for (const edge of route.edges) {
      expect(edge.minutes).toBeGreaterThan(0);
      expect(['walk', 'rail']).toContain(edge.mode);
    }
  });

  it('plans same-region travel on foot only', () => {
    const bed = createWorldTestBed();
    const route = bed.world.map.findTravelRoute(LOC.home, LOC.cafe);
    expect(route).not.toBeNull();
    if (!route) return;
    expect(route.usesRail).toBe(false);
    expect(route.edges.every((edge) => edge.mode === 'walk')).toBe(true);
  });

  it('exposes map geometry helpers used by scenes and the map UI', () => {
    const bed = createWorldTestBed();
    const def = bed.content.getLocationOrThrow(LOC.center);
    expect(bed.world.map.getSceneCentrePx(def)).toEqual({
      x: (def.widthTiles * 32) / 2,
      y: (def.heightTiles * 32) / 2,
    });
    expect(bed.world.map.getMapCentrePx(def)).toEqual({ x: def.mapX * 32, y: def.mapY * 32 });
    expect(bed.world.map.getDistanceTiles(LOC.center, LOC.plaza)).toBeGreaterThan(0);
    expect(bed.world.map.estimateWalkMinutes(LOC.center, LOC.plaza)).toBeGreaterThan(0);
    const bounds = bed.world.map.getMapBounds('willowbrook');
    expect(bounds.widthTiles).toBeGreaterThan(10);
    expect(bounds.heightTiles).toBeGreaterThan(10);
    expect(bounds.maxTileX).toBeGreaterThan(bounds.minTileX);
  });

  it('recognises stations and returns read-only neighbour copies', () => {
    const bed = createWorldTestBed();
    expect(bed.world.map.isStation(LOC.trainStation)).toBe(true);
    expect(bed.world.map.isStation(LOC.ashfordTrainStation)).toBe(true);
    expect(bed.world.map.isStation(LOC.cafe)).toBe(false);
    const neighbours = bed.world.map.getAdjacent(LOC.center);
    neighbours.push('mutated');
    expect(bed.world.map.getAdjacent(LOC.center)).not.toContain('mutated');
  });

  it('reports (and refuses to boot with) a disconnected map', () => {
    const locations = [
      minimalLocation('a', ['b'], 10, 10),
      minimalLocation('b', ['a'], 12, 10),
      minimalLocation('c', [], 40, 40),
    ];
    expect(() => mapFor(locations)).toThrow(/disconnected/i);
  });

  it('detects one-way and duplicate exterior connections', () => {
    const oneWay = [
      minimalLocation('a', ['b'], 10, 10),
      minimalLocation('b', ['a', 'c'], 12, 10),
      minimalLocation('c', ['b', 'a'], 14, 10),
    ];
    const oneWayErrors = mapFor(oneWay).validate();
    expect(oneWayErrors.some((error) => error.includes('one-way: c -> a'))).toBe(true);

    const duplicates = [minimalLocation('a', ['b', 'b'], 10, 10), minimalLocation('b', ['a'], 12, 10)];
    const duplicateErrors = mapFor(duplicates).validate();
    expect(duplicateErrors.some((error) => error.includes('duplicate connection'))).toBe(true);
  });

  it('reports one-way/unknown connections as validation errors', () => {
    const locations = [
      minimalLocation('a', ['b', 'missing'], 10, 10),
      minimalLocation('b', ['a'], 12, 10),
    ];
    const map = mapFor(locations);
    const errors = map.validate();
    expect(errors.some((error) => error.includes('missing'))).toBe(true);
    // a->b is mirrored by the builder, so it is not reported as one-way.
    expect(errors.some((error) => error.includes('one-way'))).toBe(false);
  });

  it('treats a disconnected second region as a connectivity error', () => {
    const locations = [
      minimalLocation('a', ['b'], 10, 10),
      minimalLocation('b', ['a'], 12, 10),
    ];
    const map = mapFor(locations);
    expect(map.validateConnectivity()).toEqual([]);
    const twoRegions = [...locations, minimalLocation('c', [], 40, 40, 'ashford')];
    expect(() => mapFor(twoRegions)).toThrow(/disconnected/i);
  });

  it('provides the static definition and rail route lookups', () => {
    const bed = createWorldTestBed();
    expect(bed.world.map.getDef(LOC.home)?.id).toBe(LOC.home);
    expect(bed.world.map.getLocationDefs().length).toBe(90);
    expect(bed.world.map.getRailRoutes().length).toBe(4);
    expect(bed.world.map.getRegionOf(LOC.home)).toBe('willowbrook');
    expect(bed.world.map.getRegionOf(LOC.highStreet)).toBe('ashford');
  });

  it('is deterministic about path selection', () => {
    const bed = createWorldTestBed();
    const first: LocationId[] | null = bed.world.map.findPath(LOC.forest, LOC.home);
    for (let i = 0; i < 5; i += 1) {
      expect(bed.world.map.findPath(LOC.forest, LOC.home)).toEqual(first);
    }
  });
});
