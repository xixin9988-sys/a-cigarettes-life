import type {
  ActionResult,
  EnvironmentState,
  IGameContext,
  IWorldSystem,
  LocationState,
  MicroclimateState,
  RegionState,
  TrainDepartureInfo,
} from '../core/contracts';
import type { LocationDef, TrainRouteDef } from '../data/schema';
import type { GameTime, LocationId, RegionId } from '../core/SharedTypes';
import { LOC } from '../data/locations/ids';
import { addWorldHistory, trimWorldHistory } from './WorldHistory';
import { MapManager } from './MapManager';
import { RegionManager } from './RegionManager';
import { LocationManager } from './LocationManager';
import { SeasonSystem } from './SeasonSystem';
import { EnvironmentSystem } from './EnvironmentSystem';
import { WeatherSystem } from './WeatherSystem';
import { TransportSystem } from './TransportSystem';

/**
 * OWNER: Agent 4 (World & Map).
 *
 * `WorldSystem` (system id: **world**) is the single registered world system.
 * It composes the sub-systems (map, regions, locations, seasons, environment,
 * weather, transport) and exposes the IWorldSystem contract plus traversal,
 * discovery and train APIs to the rest of the game.
 *
 * Update order matters: seasons (calendar) -> weather (Markov) -> environment
 * (physical interpolation) -> transport (journey progress) -> daily upkeep.
 * The Lead registers this one system; sub-systems are reachable through the
 * public properties if UI/debug code needs them.
 */

/** NPC occupancy is refreshed at most once per 5 in-game minutes. */
export const OCCUPANCY_INTERVAL_SIM_SECONDS = 5;

export class WorldSystem implements IWorldSystem {
  readonly id = 'world';

  readonly map = new MapManager();
  readonly regions = new RegionManager();
  readonly locations = new LocationManager();
  readonly seasons = new SeasonSystem();
  readonly environment = new EnvironmentSystem();
  readonly weather = new WeatherSystem();
  readonly transport = new TransportSystem();

  private ctx: IGameContext | null = null;
  private lastOccupancyAt = Number.NEGATIVE_INFINITY;

  init(ctx: IGameContext): void {
    this.ctx = ctx;

    this.map.init(ctx);
    this.regions.init(ctx);
    this.locations.init(ctx);
    this.seasons.init(ctx);
    this.weather.init(ctx);
    this.environment.init(ctx);
    this.transport.init(ctx, this.locations, this.map);

    trimWorldHistory(ctx.state.world);
    // The player starts their life somewhere: count that as the first visit.
    this.locations.markVisited(ctx.state.player.position.locationId, ctx.clock.simTimeSeconds);
    this.locations.recomputeOccupants(ctx.state.npcs);
    this.lastOccupancyAt = ctx.clock.simTimeSeconds;

    const validationWarnings = [
      ...this.map.validate(),
      ...this.regions.validate(),
      ...this.locations.validate(),
    ];
    if (validationWarnings.length > 0) {
      ctx.logger.warn('World state validation warnings', { warnings: validationWarnings });
    }
    ctx.logger.info('WorldSystem initialised', {
      locations: Object.keys(ctx.state.world.locations).length,
      regions: Object.keys(ctx.state.world.regions).length,
      simTimeSeconds: ctx.clock.simTimeSeconds,
    });
  }

  private getCtx(): IGameContext {
    if (!this.ctx) throw new Error('WorldSystem.init(ctx) was not called');
    return this.ctx;
  }

  // -------------------------------------------------------------------------
  // ISystem.update
  // -------------------------------------------------------------------------

  update(dtSimSeconds: number): void {
    const ctx = this.getCtx();
    const delta = Number.isFinite(dtSimSeconds) && dtSimSeconds > 0 ? dtSimSeconds : 0;
    const now = ctx.clock.simTimeSeconds;

    this.seasons.update(delta);
    this.weather.update(delta);
    this.environment.update(delta);
    this.transport.update(delta);

    const elapsedDays = this.seasons.consumeDayRollover();
    if (elapsedDays > 0) {
      this.locations.applyDailyDecay(elapsedDays, ctx.state.world.environment.weather);
    }

    if (now - this.lastOccupancyAt >= OCCUPANCY_INTERVAL_SIM_SECONDS || now < this.lastOccupancyAt) {
      this.locations.recomputeOccupants(ctx.state.npcs);
      this.lastOccupancyAt = now;
    }
    ctx.state.world.lastWorldTickAt = now;
  }

  // -------------------------------------------------------------------------
  // IWorldSystem: state accessors
  // -------------------------------------------------------------------------

  getRegion(id: RegionId): RegionState | undefined {
    return this.regions.getRegion(id);
  }

  getLocation(id: LocationId): LocationState | undefined {
    return this.locations.getState(id);
  }

  getLocationDef(id: LocationId): LocationDef | undefined {
    return this.locations.getDef(id);
  }

  getLocationsInRegion(regionId: RegionId): LocationState[] {
    return this.locations.getStatesInRegion(regionId);
  }

  getAllLocations(): LocationState[] {
    return this.locations.getAllStates();
  }

  getMicroclimate(locationId: LocationId): MicroclimateState {
    return this.locations.getMicroclimate(locationId);
  }

  getEnvironment(): EnvironmentState {
    return this.getCtx().state.world.environment;
  }

  getTime(): GameTime {
    return this.getCtx().clock.time;
  }

  getCurrentLocationId(): LocationId {
    return this.getCtx().state.player.position.locationId;
  }

  isIndoor(locationId: LocationId): boolean {
    return this.locations.isIndoor(locationId);
  }

  // -------------------------------------------------------------------------
  // IWorldSystem: movement
  // -------------------------------------------------------------------------

  travelTo(locationId: LocationId): ActionResult {
    const ctx = this.getCtx();
    const state = ctx.state;
    const def = this.locations.getDef(locationId);
    if (!def) return { ok: false, code: 'not_found', message: 'There is no such place.' };

    const currentId = state.player.position.locationId;
    if (currentId === locationId) {
      return { ok: true, message: 'You are already in ' + def.name + '.' };
    }
    if (this.transport.getRideStatus() === 'riding') {
      return { ok: false, code: 'busy', message: 'You are on the train. Wait for arrival.' };
    }
    const currentDef = this.locations.getDef(currentId);
    if (!currentDef) {
      return { ok: false, code: 'not_found', message: 'Your current position is not a real location.' };
    }
    // Adjacency is evaluated on the mirrored walk graph so entering/exiting an
    // interior works from both directions (exteriors only list exterior edges).
    if (!this.map.areAdjacent(currentId, locationId)) {
      return { ok: false, code: 'not_allowed', message: 'You cannot walk to ' + def.name + ' from here.' };
    }
    const locationState = this.locations.getState(locationId);
    if (!locationState) return { ok: false, code: 'not_found', message: 'That place has no runtime state.' };
    if (!locationState.unlocked) {
      return {
        ok: false,
        code: 'locked',
        message: def.secret ? 'You have not found a way into ' + def.name + ' yet.' : def.name + ' is locked.',
      };
    }
    const region = state.world.regions[def.regionId];
    if (region && !region.unlocked) {
      return { ok: false, code: 'locked', message: 'That region is not unlocked yet.' };
    }

    // Leaving the platform cancels a pending (not yet departed) boarding.
    this.transport.cancelWaitingRide();

    const centre = this.map.getSceneCentrePx(def);
    const from = currentId;
    state.player.position = {
      regionId: def.regionId,
      locationId,
      x: centre.x,
      y: centre.y,
      indoor: def.indoor,
    };
    this.locations.markVisited(locationId, ctx.clock.simTimeSeconds);
    this.regions.discoverRegion(def.regionId);
    ctx.bus.emit('location:changed', { from, to: locationId, regionId: def.regionId });
    return { ok: true, message: 'You arrive at ' + def.name + '.', stateChanged: true };
  }

  // -------------------------------------------------------------------------
  // IWorldSystem: discovery
  // -------------------------------------------------------------------------

  discoverLocation(locationId: LocationId): ActionResult {
    const ctx = this.getCtx();
    const def = this.locations.getDef(locationId);
    if (!def) return { ok: false, code: 'not_found', message: 'There is no such place.' };
    const state = this.locations.getState(locationId);
    if (!state) return { ok: false, code: 'not_found', message: 'That place has no runtime state.' };
    if (state.discovered) {
      return { ok: true, message: def.name + ' is already on your map.' };
    }
    state.discovered = true;
    this.regions.discoverRegion(def.regionId);
    addWorldHistory(ctx.state.world, {
      at: ctx.clock.simTimeSeconds,
      category: 'discovery',
      description: 'Discovered ' + def.name + '.',
      importance: def.secret ? 3 : 2,
      locationId: def.id,
    });
    ctx.bus.emit('discovery:made', { kind: 'location', id: def.id, description: def.description });
    return {
      ok: true,
      message: 'Discovered ' + def.name + '.',
      stateChanged: true,
      data: { locationId: def.id },
    };
  }

  unlockLocation(locationId: LocationId): ActionResult {
    const ctx = this.getCtx();
    const def = this.locations.getDef(locationId);
    if (!def) return { ok: false, code: 'not_found', message: 'There is no such place.' };
    const state = this.locations.getState(locationId);
    if (!state) return { ok: false, code: 'not_found', message: 'That place has no runtime state.' };
    if (state.unlocked) {
      return { ok: true, message: def.name + ' is already accessible.' };
    }
    const requirement = def.clueRequirement ?? 0;
    if (requirement > 0) {
      const clues = ctx.state.exploration.clues.length;
      if (clues < requirement) {
        return {
          ok: false,
          code: 'requirement_not_met',
          message: 'You need ' + requirement + ' clues to find this place (you have ' + clues + ').',
        };
      }
    }
    state.unlocked = true;
    state.discovered = true;
    this.regions.discoverRegion(def.regionId);
    addWorldHistory(ctx.state.world, {
      at: ctx.clock.simTimeSeconds,
      category: 'discovery',
      description: 'A hidden place opens up: ' + def.name + '.',
      importance: 4,
      locationId: def.id,
    });
    ctx.bus.emit('discovery:made', {
      kind: 'secret',
      id: def.id,
      description: 'You have found a way into ' + def.name + '.',
    });
    return {
      ok: true,
      message: 'You have unlocked ' + def.name + '.',
      stateChanged: true,
      data: { locationId: def.id },
    };
  }

  // -------------------------------------------------------------------------
  // IWorldSystem: transport
  // -------------------------------------------------------------------------

  getTrainRoutes(): TrainRouteDef[] {
    return this.transport.getRoutes();
  }

  getTrainSchedule(fromLocationId: LocationId, toLocationId?: LocationId): TrainDepartureInfo[] {
    return toLocationId === undefined
      ? this.transport.getTrainSchedule(fromLocationId)
      : this.transport.getTrainSchedule(fromLocationId, toLocationId);
  }

  buyTrainTicket(routeId: string): ActionResult {
    return this.transport.buyTrainTicket(routeId);
  }

  boardTrain(): ActionResult {
    return this.transport.boardTrain();
  }

  getUnlockedTravelDestinations(): LocationId[] {
    const ids: LocationId[] = [];
    for (const state of this.locations.getAllStates()) {
      if (!state.unlocked) continue;
      if (this.locations.isIndoor(state.id)) continue;
      ids.push(state.id);
    }
    return ids.sort((a, b) => a.localeCompare(b));
  }

  // -------------------------------------------------------------------------
  // Extra public helpers (UI / integration; beyond the frozen interface)
  // -------------------------------------------------------------------------

  /** Walk path (fewest stops) from the player's current location to a target. */
  getPathTo(locationId: LocationId): LocationId[] | null {
    return this.map.findPath(this.getCurrentLocationId(), locationId);
  }

  /** Live weather type, for HUD/debug code that only knows about the world system. */
  getWeatherType(): EnvironmentState['weather'] {
    return this.getEnvironment().weather;
  }

  /** Refreshes NPC occupancy arrays immediately (used after teleports/tests). */
  refreshOccupants(): void {
    const ctx = this.getCtx();
    this.locations.recomputeOccupants(ctx.state.npcs);
    this.lastOccupancyAt = ctx.clock.simTimeSeconds;
  }

  /** Convenience history helper so other systems do not import WorldHistory directly. */
  recordHistory(input: {
    at?: number;
    category: Parameters<typeof addWorldHistory>[1]['category'];
    description: string;
    importance?: number;
    locationId?: LocationId;
  }): void {
    const ctx = this.getCtx();
    addWorldHistory(ctx.state.world, {
      at: input.at ?? ctx.clock.simTimeSeconds,
      category: input.category,
      description: input.description,
      importance: input.importance ?? 2,
      ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
    });
  }

  /** The village centre, handy as a default history location. */
  getCentreLocationId(): LocationId {
    return LOC.center;
  }
}
