import type { IGameContext } from '../core/contracts';
import type { LocationDef, TrainRouteDef } from '../data/schema';
import type { LocationId, RegionId } from '../core/SharedTypes';
import { REGION_IDS } from '../core/SharedTypes';
import { WORLD_CONFIG } from '../core/WorldConfig';

/**
 * OWNER: Agent 4 (World & Map).
 *
 * Static navigation layer. It turns the location definitions into two graphs:
 *
 *  - the **walk graph**: every `connections` edge. Interiors are leaves that
 *    connect to their own exterior; a player may only walk along these edges.
 *  - the **travel graph**: the walk graph plus rail edges derived from
 *    TRAIN_ROUTES. This graph is used by map UI / travel planning; it answers
 *    "how would I get from the bakery to Ashford museum?" including the train.
 *
 * Pathfinding is a BFS on the walk graph (fewest stops) and a Dijkstra on the
 * travel graph (fastest estimated minutes). The graphs are tiny (75 nodes), so
 * an O(V^2) extract-min is used instead of pulling in a heap dependency.
 */

export type TravelEdgeMode = 'walk' | 'rail';

export interface TravelEdge {
  from: LocationId;
  to: LocationId;
  mode: TravelEdgeMode;
  /** Estimated game minutes for this leg. */
  minutes: number;
  /** Approximate straight-line distance in map tiles (0 for interiors). */
  tiles: number;
  /** Rail only: id of the train route serving this edge. */
  routeId?: string;
}

export interface TravelRoute {
  path: LocationId[];
  edges: TravelEdge[];
  totalMinutes: number;
  usesRail: boolean;
}

export interface MapBounds {
  regionId: RegionId;
  minTileX: number;
  minTileY: number;
  maxTileX: number;
  maxTileY: number;
  widthTiles: number;
  heightTiles: number;
}

/** Assumed walking pace: map tiles per in-game minute (used for route estimates). */
export const WALK_TILES_PER_GAME_MINUTE = 2.2;
/** Average wait for the next train, in game minutes (roughly half of the 2h cadence). */
export const RAIL_AVERAGE_WAIT_MINUTES = 60;
/** Minimum estimated time for a leg, so interiors never take "zero" minutes. */
const MIN_LEG_MINUTES = 1;

function tileSize(): number {
  return WORLD_CONFIG.map.tileSize;
}

export class MapManager {
  private ctx: IGameContext | null = null;
  private readonly defs = new Map<LocationId, LocationDef>();
  private readonly walkAdj = new Map<LocationId, LocationId[]>();
  private readonly travelAdj = new Map<LocationId, TravelEdge[]>();
  private readonly routes: TrainRouteDef[] = [];

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.build();
    const errors = this.validate();
    const connectivityErrors = this.validateConnectivity();
    const fatal = [...errors, ...connectivityErrors];
    if (connectivityErrors.length > 0) {
      throw new Error('World map graph is disconnected: ' + connectivityErrors.join(' | '));
    }
    if (fatal.length > 0) {
      ctx.logger.warn('World map validation warnings', { errors: fatal });
    }
  }

  private getCtx(): IGameContext {
    if (!this.ctx) throw new Error('MapManager.init(ctx) was not called');
    return this.ctx;
  }

  private build(): void {
    const ctx = this.getCtx();
    this.defs.clear();
    this.walkAdj.clear();
    this.travelAdj.clear();
    this.routes.length = 0;

    for (const def of ctx.content.pack.locations) {
      this.defs.set(def.id, def);
      this.walkAdj.set(def.id, []);
      this.travelAdj.set(def.id, []);
    }

    // Walk edges: mirror every declared connection so the graph is always undirected.
    for (const def of this.defs.values()) {
      for (const targetId of def.connections) {
        if (!this.defs.has(targetId)) continue; // reported by validate()
        const forward = this.walkAdj.get(def.id);
        const backward = this.walkAdj.get(targetId);
        if (forward && !forward.includes(targetId)) forward.push(targetId);
        if (backward && !backward.includes(def.id)) backward.push(def.id);
      }
    }

    // Walk edges become the base of the travel graph.
    for (const [fromId, neighbours] of this.walkAdj) {
      const edges = this.travelAdj.get(fromId);
      if (!edges) continue;
      for (const toId of neighbours) {
        const minutes = this.estimateWalkMinutes(fromId, toId);
        edges.push({
          from: fromId,
          to: toId,
          mode: 'walk',
          minutes,
          tiles: this.getDistanceTiles(fromId, toId),
        });
      }
    }

    // Rail edges: one edge per route, in its declared direction.
    for (const route of ctx.content.pack.trainRoutes) {
      this.routes.push(route);
      if (!this.defs.has(route.fromLocationId) || !this.defs.has(route.toLocationId)) continue;
      const edges = this.travelAdj.get(route.fromLocationId);
      if (!edges) continue;
      edges.push({
        from: route.fromLocationId,
        to: route.toLocationId,
        mode: 'rail',
        minutes: route.durationMinutes + RAIL_AVERAGE_WAIT_MINUTES,
        tiles: this.getDistanceTiles(route.fromLocationId, route.toLocationId),
        routeId: route.id,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Static lookups
  // -------------------------------------------------------------------------

  getLocationDefs(): LocationDef[] {
    return [...this.defs.values()];
  }

  getDef(id: LocationId): LocationDef | undefined {
    return this.defs.get(id);
  }

  getRailRoutes(): TrainRouteDef[] {
    return [...this.routes];
  }

  /** Walk-graph neighbours of a location (what the player can reach on foot). */
  getAdjacent(id: LocationId): LocationId[] {
    const neighbours = this.walkAdj.get(id);
    return neighbours ? [...neighbours] : [];
  }

  areAdjacent(a: LocationId, b: LocationId): boolean {
    const neighbours = this.walkAdj.get(a);
    return neighbours ? neighbours.includes(b) : false;
  }

  /** True when at least one train route starts at this location. */
  isStation(locationId: LocationId): boolean {
    return this.routes.some((route) => route.fromLocationId === locationId);
  }

  getRegionOf(locationId: LocationId): RegionId | undefined {
    return this.defs.get(locationId)?.regionId;
  }

  /** Scene-local centre in pixels, where the player stands when visiting the location. */
  getSceneCentrePx(def: LocationDef): { x: number; y: number } {
    const size = tileSize();
    return {
      x: (def.widthTiles * size) / 2,
      y: (def.heightTiles * size) / 2,
    };
  }

  /** Overworld pixel position of a location's centre tile (for the map UI). */
  getMapCentrePx(def: LocationDef): { x: number; y: number } {
    const size = tileSize();
    return { x: def.mapX * size, y: def.mapY * size };
  }

  /** Straight-line distance between two location centres in map tiles (0 for interiors). */
  getDistanceTiles(a: LocationId, b: LocationId): number {
    const defA = this.defs.get(a);
    const defB = this.defs.get(b);
    if (!defA || !defB) return 0;
    const dx = defA.mapX - defB.mapX;
    const dy = defA.mapY - defB.mapY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Estimated walking time in game minutes between two adjacent-ish locations. */
  estimateWalkMinutes(a: LocationId, b: LocationId): number {
    const minutes = Math.ceil(this.getDistanceTiles(a, b) / WALK_TILES_PER_GAME_MINUTE);
    return Math.max(MIN_LEG_MINUTES, minutes);
  }

  /** Bounding box of all locations of a region, in map tiles (for camera/map UI). */
  getMapBounds(regionId: RegionId): MapBounds {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const def of this.defs.values()) {
      if (def.regionId !== regionId) continue;
      const halfW = def.widthTiles / 2;
      const halfH = def.heightTiles / 2;
      minX = Math.min(minX, def.mapX - halfW);
      minY = Math.min(minY, def.mapY - halfH);
      maxX = Math.max(maxX, def.mapX + halfW);
      maxY = Math.max(maxY, def.mapY + halfH);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return { regionId, minTileX: 0, minTileY: 0, maxTileX: 0, maxTileY: 0, widthTiles: 0, heightTiles: 0 };
    }
    return {
      regionId,
      minTileX: minX,
      minTileY: minY,
      maxTileX: maxX,
      maxTileY: maxY,
      widthTiles: maxX - minX,
      heightTiles: maxY - minY,
    };
  }

  // -------------------------------------------------------------------------
  // Pathfinding
  // -------------------------------------------------------------------------

  /** Fewest-stops BFS path over the walk graph. Returns null when unreachable. */
  findPath(from: LocationId, to: LocationId): LocationId[] | null {
    if (from === to) return this.defs.has(from) ? [from] : null;
    if (!this.defs.has(from) || !this.defs.has(to)) return null;
    const previous = new Map<LocationId, LocationId | null>();
    previous.set(from, null);
    const queue: LocationId[] = [from];
    let head = 0;
    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      if (current === undefined) break;
      const neighbours = this.walkAdj.get(current) ?? [];
      for (const next of neighbours) {
        if (previous.has(next)) continue;
        previous.set(next, current);
        if (next === to) {
          return this.reconstructPath(previous, from, to);
        }
        queue.push(next);
      }
    }
    return null;
  }

  private reconstructPath(
    previous: Map<LocationId, LocationId | null>,
    from: LocationId,
    to: LocationId
  ): LocationId[] {
    const path: LocationId[] = [];
    let cursor: LocationId | null | undefined = to;
    while (cursor !== null && cursor !== undefined) {
      path.push(cursor);
      cursor = previous.get(cursor);
    }
    path.reverse();
    if (path[0] !== from) return [];
    return path;
  }

  /**
   * Fastest estimated route over the travel graph (walk + rail), using Dijkstra.
   * Rail legs include an average wait estimate; the caller should use
   * TransportSystem.getTrainSchedule for exact departure times.
   */
  findTravelRoute(from: LocationId, to: LocationId): TravelRoute | null {
    if (!this.defs.has(from) || !this.defs.has(to)) return null;
    if (from === to) return { path: [from], edges: [], totalMinutes: 0, usesRail: false };

    const distances = new Map<LocationId, number>();
    const previousEdge = new Map<LocationId, TravelEdge>();
    const visited = new Set<LocationId>();
    for (const id of this.defs.keys()) distances.set(id, Number.POSITIVE_INFINITY);
    distances.set(from, 0);

    while (visited.size < this.defs.size) {
      let current: LocationId | null = null;
      let currentNodeDistance = Number.POSITIVE_INFINITY;
      for (const [id, distance] of distances) {
        if (visited.has(id)) continue;
        if (distance < currentNodeDistance) {
          currentNodeDistance = distance;
          current = id;
        }
      }
      if (current === null) break;
      visited.add(current);
      if (current === to) break;
      const edges = this.travelAdj.get(current);
      if (!edges) continue;
      for (const edge of edges) {
        if (visited.has(edge.to)) continue;
        const candidate = currentNodeDistance + edge.minutes;
        const existing = distances.get(edge.to) ?? Number.POSITIVE_INFINITY;
        if (candidate < existing) {
          distances.set(edge.to, candidate);
          previousEdge.set(edge.to, edge);
        }
      }
    }

    const totalMinutes = distances.get(to);
    if (totalMinutes === undefined || !Number.isFinite(totalMinutes)) return null;
    if (!previousEdge.has(to)) return null;

    const edges: TravelEdge[] = [];
    let cursor: LocationId = to;
    while (cursor !== from) {
      const edge = previousEdge.get(cursor);
      if (!edge) return null;
      edges.push(edge);
      cursor = edge.from;
    }
    edges.reverse();
    const path: LocationId[] = [from];
    for (const edge of edges) path.push(edge.to);
    return {
      path,
      edges,
      totalMinutes: Math.round(totalMinutes),
      usesRail: edges.some((edge) => edge.mode === 'rail'),
    };
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /** Structural validation of the static map data. */
  validate(): string[] {
    const ctx = this.getCtx();
    const errors: string[] = [];
    for (const def of ctx.content.pack.locations) {
      if (def.indoor) {
        const entrance = def.entranceFrom;
        if (!entrance) {
          errors.push('Interior ' + def.id + ' has no entranceFrom');
        } else {
          const exterior = this.defs.get(entrance);
          if (!exterior) errors.push('Interior ' + def.id + ' points at unknown exterior ' + entrance);
          else if (exterior.indoor) errors.push('Interior ' + def.id + ' entrance ' + entrance + ' is itself indoors');
          if (def.connections.length !== 1 || def.connections[0] !== entrance) {
            errors.push('Interior ' + def.id + ' must connect only to its entrance ' + entrance);
          }
        }
      }
      const seenTargets = new Set<LocationId>();
      for (const target of def.connections) {
        if (seenTargets.has(target)) {
          errors.push('Location ' + def.id + ' lists duplicate connection ' + target);
          continue;
        }
        seenTargets.add(target);
        const targetDef = this.defs.get(target);
        if (!targetDef) {
          errors.push('Location ' + def.id + ' connects to unknown location ' + target);
          continue;
        }
        // Interior -> exterior links are intentionally declared on the interior
        // only (the builder mirrors them); every exterior link must be declared
        // on both endpoints so the undirected graph cannot silently drift.
        if (!def.indoor && !targetDef.connections.includes(def.id)) {
          errors.push('Location connection is one-way: ' + def.id + ' -> ' + target);
        }
      }
    }

    for (const route of ctx.content.pack.trainRoutes) {
      const from = this.defs.get(route.fromLocationId);
      const to = this.defs.get(route.toLocationId);
      if (!from) errors.push('Train route ' + route.id + ' starts at unknown location ' + route.fromLocationId);
      else if (from.indoor) errors.push('Train route ' + route.id + ' starts indoors (' + from.id + ')');
      if (!to) errors.push('Train route ' + route.id + ' ends at unknown location ' + route.toLocationId);
      else if (to.indoor) errors.push('Train route ' + route.id + ' ends indoors (' + to.id + ')');
      if (route.departHours.length === 0) errors.push('Train route ' + route.id + ' has no departures');
      if (route.durationMinutes <= 0) errors.push('Train route ' + route.id + ' has non-positive duration');
      if (route.pricePence < 0) errors.push('Train route ' + route.id + ' has negative price');
    }
    return errors;
  }

  /** Connectivity validation: each region must be walkable internally and the
   * whole world must be connected once the rail links are added. */
  validateConnectivity(): string[] {
    const errors: string[] = [];
    const exteriorIds = [...this.defs.values()].filter((def) => !def.indoor).map((def) => def.id);

    for (const regionId of REGION_IDS) {
      const regionExteriors = [...this.defs.values()]
        .filter((def) => !def.indoor && def.regionId === regionId)
        .map((def) => def.id);
      if (regionExteriors.length === 0) continue;
      const start = regionExteriors[0];
      if (start === undefined) continue;
      const reachable = new Set<LocationId>(this.bfsReachable(start, this.walkAdj));
      for (const id of regionExteriors) {
        if (!reachable.has(id)) errors.push('Region ' + regionId + ' is not fully walkable: ' + id);
      }
    }

    if (exteriorIds.length > 0) {
      const start = exteriorIds[0];
      if (start !== undefined) {
        const reachable = new Set<LocationId>();
        for (const id of this.bfsReachable(start, this.toAdjacency(this.travelAdj))) reachable.add(id);
        for (const id of exteriorIds) {
          if (!reachable.has(id)) errors.push('World travel graph is disconnected at: ' + id);
        }
      }
    }
    return errors;
  }

  private toAdjacency(edges: Map<LocationId, TravelEdge[]>): Map<LocationId, LocationId[]> {
    const adjacency = new Map<LocationId, LocationId[]>();
    for (const [id, list] of edges) adjacency.set(id, list.map((edge) => edge.to));
    return adjacency;
  }

  private bfsReachable(from: LocationId, adjacency: Map<LocationId, LocationId[]>): LocationId[] {
    const seen = new Set<LocationId>([from]);
    const queue: LocationId[] = [from];
    let head = 0;
    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      if (current === undefined) continue;
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return [...seen];
  }
}
