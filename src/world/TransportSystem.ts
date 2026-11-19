import type {
  ActionResult,
  IGameContext,
  TrainDepartureInfo,
  TrainRideState,
  TrainTicketState,
  TransportState,
} from '../core/contracts';
import type { TrainRouteDef } from '../data/schema';
import type { LocationId } from '../core/SharedTypes';
import { GAME_SECONDS_PER_DAY } from '../core/TimeUtil';
import { addWorldHistory } from './WorldHistory';
import type { LocationManager } from './LocationManager';
import type { MapManager } from './MapManager';

/**
 * OWNER: Agent 4 (World & Map).
 *
 * Train transport: timetable, tickets, boarding and the journey itself.
 * Trains are the only way to cross between Willowbrook and Ashford City.
 *
 * All times are simulated seconds (1 sim second = 1 in-game minute), so a
 * 30-minute boarding window is 30 sim seconds.
 */

/** Boarding window before departure, in game minutes (= sim seconds). */
export const BOARDING_WINDOW_MINUTES = 30;
/** Hard cap on stored tickets; used tickets are pruned first. */
export const MAX_TICKETS = 24;
/** Max departures returned by getTrainSchedule. */
const MAX_DEPARTURES = 40;

function simSecondsPerGameHour(): number {
  return 60;
}

export class TransportSystem {
  private ctx: IGameContext | null = null;
  private locations: LocationManager | null = null;
  private map: MapManager | null = null;
  private readonly routesById = new Map<string, TrainRouteDef>();

  init(ctx: IGameContext, locations: LocationManager, map: MapManager): void {
    this.ctx = ctx;
    this.locations = locations;
    this.map = map;
    this.routesById.clear();
    for (const route of ctx.content.pack.trainRoutes) this.routesById.set(route.id, route);
    this.ensureTransportState();
  }

  private getCtx(): IGameContext {
    if (!this.ctx) throw new Error('TransportSystem.init(ctx, ...) was not called');
    return this.ctx;
  }

  private getLocations(): LocationManager {
    if (!this.locations) throw new Error('TransportSystem.init(ctx, ...) was not called');
    return this.locations;
  }

  private getTransport(): TransportState {
    const transport = this.getCtx().state.world.transport;
    this.ensureTransportState();
    return transport;
  }

  private ensureTransportState(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const transport = ctx.state.world.transport;
    if (!transport) return;
    if (!Array.isArray(transport.tickets)) transport.tickets = [];
    if (transport.activeRide === undefined) transport.activeRide = null;
    if (!Number.isFinite(transport.lastArrivalAt)) transport.lastArrivalAt = 0;
  }

  private getRoute(routeId: string): TrainRouteDef | undefined {
    return this.routesById.get(routeId);
  }

  /** All train routes known to the world (static content). */
  getRoutes(): TrainRouteDef[] {
    return [...this.routesById.values()];
  }

  /** Exterior ids of every station served by a route. */
  getStations(): LocationId[] {
    const seen = new Set<LocationId>();
    for (const route of this.routesById.values()) {
      seen.add(route.fromLocationId);
      seen.add(route.toLocationId);
    }
    return [...seen];
  }

  isStation(locationId: LocationId): boolean {
    return this.map ? this.map.isStation(locationId) : this.getStations().includes(locationId);
  }

  /** Resolves an interior (or exterior) to the exterior station id. */
  private stationOf(locationId: LocationId): LocationId {
    return this.getLocations().getExteriorOf(locationId);
  }

  /** Sim time of the next departure of one route at or after `nowSimSeconds`. */
  nextDepartureSimTime(route: TrainRouteDef, nowSimSeconds: number): number {
    const dayStart = Math.floor(nowSimSeconds / GAME_SECONDS_PER_DAY) * GAME_SECONDS_PER_DAY;
    const firstHour = route.departHours[0] ?? 6;
    let best = Number.POSITIVE_INFINITY;
    for (const hour of route.departHours) {
      let candidate = dayStart + hour * simSecondsPerGameHour();
      if (candidate < nowSimSeconds) candidate += GAME_SECONDS_PER_DAY;
      if (candidate < best) best = candidate;
    }
    if (!Number.isFinite(best)) return dayStart + firstHour * simSecondsPerGameHour();
    return best;
  }

  // -------------------------------------------------------------------------
  // Timetable
  // -------------------------------------------------------------------------

  /**
   * Upcoming departures from a station, sorted by departure time.
   * `fromLocationId` may be the station exterior or its interior.
   * `toLocationId` (optional) filters to a destination station.
   */
  getTrainSchedule(fromLocationId: LocationId, toLocationId?: LocationId): TrainDepartureInfo[] {
    const ctx = this.getCtx();
    const now = ctx.clock.simTimeSeconds;
    const from = this.stationOf(fromLocationId);
    const to = toLocationId !== undefined ? this.stationOf(toLocationId) : null;
    const departures: TrainDepartureInfo[] = [];

    for (const route of this.routesById.values()) {
      if (route.fromLocationId !== from) continue;
      if (to !== null && route.toLocationId !== to) continue;
      for (const hour of route.departHours) {
        const departSimTime = this.nextDepartureForHour(hour, now);
        const arriveSimTime = departSimTime + route.durationMinutes;
        departures.push({
          routeId: route.id,
          fromLocationId: route.fromLocationId,
          toLocationId: route.toLocationId,
          departSimTime,
          arriveSimTime,
          pricePence: route.pricePence,
          minutesUntil: Math.max(0, Math.round(departSimTime - now)),
        });
      }
    }

    departures.sort((a, b) => {
      if (a.departSimTime !== b.departSimTime) return a.departSimTime - b.departSimTime;
      return a.routeId.localeCompare(b.routeId);
    });
    return departures.slice(0, MAX_DEPARTURES);
  }

  private nextDepartureForHour(hour: number, nowSimSeconds: number): number {
    const dayStart = Math.floor(nowSimSeconds / GAME_SECONDS_PER_DAY) * GAME_SECONDS_PER_DAY;
    let candidate = dayStart + hour * simSecondsPerGameHour();
    while (candidate < nowSimSeconds) candidate += GAME_SECONDS_PER_DAY;
    return candidate;
  }

  // -------------------------------------------------------------------------
  // Tickets
  // -------------------------------------------------------------------------

  getTickets(): TrainTicketState[] {
    return [...this.getTransport().tickets];
  }

  getActiveRide(): TrainRideState | null {
    return this.getTransport().activeRide;
  }

  getRideStatus(): TrainRideState['status'] | 'none' {
    const ride = this.getTransport().activeRide;
    return ride ? ride.status : 'none';
  }

  /** Cancels a ride that has not departed yet. Returns true when a ride was cancelled. */
  cancelWaitingRide(): boolean {
    const transport = this.getTransport();
    if (!transport.activeRide || transport.activeRide.status !== 'waiting') return false;
    transport.activeRide = null;
    return true;
  }

  buyTrainTicket(routeId: string): ActionResult {
    const ctx = this.getCtx();
    const transport = this.getTransport();
    const route = this.getRoute(routeId);
    if (!route) return { ok: false, code: 'not_found', message: 'That train service does not exist.' };

    if (transport.activeRide) {
      return { ok: false, code: 'busy', message: 'You are already waiting for or riding a train.' };
    }

    const currentStation = this.stationOf(ctx.state.player.position.locationId);
    if (currentStation !== route.fromLocationId) {
      return { ok: false, code: 'wrong_location', message: 'You must be at the departure station to buy this ticket.' };
    }

    const player = ctx.state.player;
    if (player.money < route.pricePence) {
      return {
        ok: false,
        code: 'not_enough_money',
        message: 'You cannot afford the fare of ' + route.pricePence + 'p.',
      };
    }

    const now = ctx.clock.simTimeSeconds;
    const departSimTime = this.nextDepartureSimTime(route, now);
    const arriveSimTime = departSimTime + route.durationMinutes;
    const sequence =
      transport.tickets.filter((ticket) => ticket.routeId === routeId && ticket.departSimTime === departSimTime).length + 1;
    const ticket: TrainTicketState = {
      id: 'ticket_' + routeId + '_' + departSimTime + '_' + sequence,
      routeId,
      fromLocationId: route.fromLocationId,
      toLocationId: route.toLocationId,
      departSimTime,
      arriveSimTime,
      pricePence: route.pricePence,
      purchasedAt: now,
      used: false,
    };

    player.money -= route.pricePence;
    transport.tickets.push(ticket);
    this.pruneTickets();
    ctx.bus.emit('money:changed', {
      amount: -route.pricePence,
      balance: player.money,
      reason: 'train ticket',
    });
    addWorldHistory(ctx.state.world, {
      at: now,
      category: 'player',
      description:
        'Bought a ticket for the ' + route.name + ' service, departing at ' + this.formatHour(departSimTime) + '.',
      importance: 1,
      locationId: route.fromLocationId,
    });
    ctx.logger.info('Train ticket bought', { routeId, departSimTime, price: route.pricePence });
    const destinationName = this.getLocations().getDef(route.toLocationId)?.name ?? route.toLocationId;
    return {
      ok: true,
      message: 'Ticket bought for the ' + this.formatHour(departSimTime) + ' train to ' + destinationName + '.',
      stateChanged: true,
      data: {
        ticketId: ticket.id,
        routeId,
        departSimTime,
        arriveSimTime,
        pricePence: route.pricePence,
      },
    };
  }

  /** Boards the earliest valid ticket from the current station (<= 30 min to departure). */
  boardTrain(): ActionResult {
    const ctx = this.getCtx();
    const transport = this.getTransport();
    if (transport.activeRide) {
      return { ok: false, code: 'busy', message: 'You are already on the platform or on the train.' };
    }
    const now = ctx.clock.simTimeSeconds;
    const currentStation = this.stationOf(ctx.state.player.position.locationId);
    if (!this.isStation(currentStation)) {
      return { ok: false, code: 'wrong_location', message: 'There is no platform here.' };
    }

    let candidate: TrainTicketState | null = null;
    for (const ticket of transport.tickets) {
      if (ticket.used) continue;
      if (ticket.fromLocationId !== currentStation) continue;
      const minutesUntil = ticket.departSimTime - now;
      if (minutesUntil < 0) continue;
      if (minutesUntil > BOARDING_WINDOW_MINUTES) continue;
      if (candidate === null || ticket.departSimTime < candidate.departSimTime) candidate = ticket;
    }
    if (!candidate) {
      return {
        ok: false,
        code: 'wrong_time',
        message: 'No train leaves from here in the next ' + BOARDING_WINDOW_MINUTES + ' minutes.',
      };
    }

    transport.activeRide = {
      ticketId: candidate.id,
      departSimTime: candidate.departSimTime,
      arriveSimTime: candidate.arriveSimTime,
      fromLocationId: candidate.fromLocationId,
      toLocationId: candidate.toLocationId,
      status: 'waiting',
    };
    ctx.logger.info('Player boarded train', { ticketId: candidate.id, departSimTime: candidate.departSimTime });
    const destinationName = this.getLocations().getDef(candidate.toLocationId)?.name ?? candidate.toLocationId;
    return {
      ok: true,
      message: 'You board the train to ' + destinationName + '. Departure in ' + Math.max(0, Math.round(candidate.departSimTime - now)) + ' min.',
      stateChanged: true,
      data: { ticketId: candidate.id, departSimTime: candidate.departSimTime },
    };
  }

  // -------------------------------------------------------------------------
  // Journey update
  // -------------------------------------------------------------------------

  update(_dtSimSeconds: number): void {
    const ctx = this.getCtx();
    const transport = this.getTransport();
    const ride = transport.activeRide;
    if (!ride) return;
    const now = ctx.clock.simTimeSeconds;

    if (ride.status === 'waiting' && now >= ride.departSimTime) {
      ride.status = 'riding';
      ctx.logger.info('Train departed', { from: ride.fromLocationId, to: ride.toLocationId });
    }
    if (now >= ride.arriveSimTime) {
      this.completeArrival();
    }
  }

  private completeArrival(): void {
    const ctx = this.getCtx();
    const transport = this.getTransport();
    const ride = transport.activeRide;
    if (!ride) return;
    const now = ctx.clock.simTimeSeconds;
    const ticket = transport.tickets.find((entry) => entry.id === ride.ticketId);
    if (ticket) ticket.used = true;

    const destination = this.getLocations().getDef(ride.toLocationId);
    if (!destination) {
      ctx.logger.error('Train arrived at unknown location: ' + ride.toLocationId);
      transport.activeRide = null;
      return;
    }
    const centre = this.map ? this.map.getSceneCentrePx(destination) : { x: 0, y: 0 };
    ctx.state.player.position = {
      regionId: destination.regionId,
      locationId: destination.id,
      x: centre.x,
      y: centre.y,
      indoor: destination.indoor,
    };
    const from = ride.fromLocationId;
    transport.activeRide = null;
    transport.lastArrivalAt = now;
    this.getLocations().markVisited(destination.id, now);
    this.pruneTickets();

    ctx.bus.emit('location:changed', { from, to: destination.id, regionId: destination.regionId });
    addWorldHistory(ctx.state.world, {
      at: now,
      category: 'player',
      description: 'Arrived by train at ' + destination.name + '.',
      importance: 2,
      locationId: destination.id,
    });
    ctx.logger.info('Player arrived by train', { to: destination.id, from });
  }

  private pruneTickets(): void {
    const transport = this.getTransport();
    while (transport.tickets.length > MAX_TICKETS) {
      const activeTicketId = transport.activeRide ? transport.activeRide.ticketId : null;
      const removable = transport.tickets.findIndex((ticket) => ticket.id !== activeTicketId);
      if (removable < 0) break;
      transport.tickets.splice(removable, 1);
    }
    // Drop the oldest used tickets first.
    transport.tickets.sort((a, b) => a.purchasedAt - b.purchasedAt);
  }

  /** Formats a sim time as HH:MM for messages/UI. */
  formatHour(simTimeSeconds: number): string {
    const minutesOfDay = ((Math.floor(simTimeSeconds) % GAME_SECONDS_PER_DAY) + GAME_SECONDS_PER_DAY) % GAME_SECONDS_PER_DAY;
    const hour = Math.floor(minutesOfDay / simSecondsPerGameHour());
    const minute = minutesOfDay % simSecondsPerGameHour();
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }
}
