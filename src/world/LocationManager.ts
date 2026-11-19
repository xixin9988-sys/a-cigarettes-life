import type { IGameContext, LocationState, MicroclimateState, NPCState } from '../core/contracts';
import type { FacilityKind, LocationDef } from '../data/schema';
import type { LocationId, NPCId, RegionId } from '../core/SharedTypes';
import { clamp01 } from '../core/utils';
import { isWithinHours } from '../core/TimeUtil';
import { interiorIdFor } from '../data/locations/ids';

/**
 * OWNER: Agent 4 (World & Map).
 *
 * Owns `GameState.world.locations`: visit tracking, discovery/unlock flags,
 * secrets, microclimate mirrors, opening hours, facilities, condition decay and
 * NPC occupancy. WorldSystem delegates every per-location read/write here so
 * there is exactly one place that mutates location state.
 */

/** Daily condition decay (0..1 of the 0..1 condition score). Weather scales it. */
const BASE_CONDITION_DECAY_PER_DAY = 0.0035;
/** Locations never decay below this condition value. */
const MIN_CONDITION = 0.05;

export const WEATHER_CONDITION_SEVERITY: Readonly<Record<string, number>> = {
  clear: 0.6,
  cloudy: 0.8,
  rain: 1.2,
  storm: 2.1,
  fog: 0.9,
  snow: 1.5,
  wind: 1.1,
};

export class LocationManager {
  private ctx: IGameContext | null = null;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.syncStates();
  }

  private getCtx(): IGameContext {
    if (!this.ctx) throw new Error('LocationManager.init(ctx) was not called');
    return this.ctx;
  }

  /** Ensures every content definition has exactly one LocationState (content/save migration safety). */
  syncStates(): void {
    const ctx = this.getCtx();
    const locations = ctx.state.world.locations;
    for (const def of ctx.content.pack.locations) {
      const existing = locations[def.id];
      if (!existing) {
        locations[def.id] = this.createLocationState(def);
        continue;
      }
      // Keep mirrors consistent if static data changed between versions.
      existing.name = def.name;
      existing.regionId = def.regionId;
      existing.microclimate = this.microclimateFromDef(def);
      if (existing.condition > 1 || Number.isNaN(existing.condition)) existing.condition = 1;
      if (!Array.isArray(existing.secretsFound)) existing.secretsFound = [];
      if (!Array.isArray(existing.occupants)) existing.occupants = [];
    }
  }

  private microclimateFromDef(def: LocationDef): MicroclimateState {
    return {
      indoor: def.indoor,
      shelter: def.shelter,
      windExposure: def.windExposure,
      humidityModifier: def.humidityModifier,
      heatSource: def.heatSource,
    };
  }

  private createLocationState(def: LocationDef): LocationState {
    return {
      id: def.id,
      name: def.name,
      regionId: def.regionId,
      discovered: !def.secret,
      unlocked: !def.secret,
      visitCount: 0,
      lastVisitSimTime: 0,
      occupants: [],
      microclimate: this.microclimateFromDef(def),
      condition: 1,
      lastEventAt: 0,
      searchCount: 0,
      secretsFound: [],
    };
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  getDef(id: LocationId): LocationDef | undefined {
    return this.getCtx().content.getLocation(id);
  }

  getState(id: LocationId): LocationState | undefined {
    return this.getCtx().state.world.locations[id];
  }

  getAllStates(): LocationState[] {
    const ctx = this.getCtx();
    const result: LocationState[] = [];
    for (const def of ctx.content.pack.locations) {
      const state = ctx.state.world.locations[def.id];
      if (state) result.push(state);
    }
    return result;
  }

  getStatesInRegion(regionId: RegionId): LocationState[] {
    return this.getAllStates().filter((state) => state.regionId === regionId);
  }

  /** Exterior id for a location: interiors resolve to `entranceFrom`. */
  getExteriorOf(locationId: LocationId): LocationId {
    const def = this.getDef(locationId);
    if (!def) return locationId;
    return def.indoor && def.entranceFrom ? def.entranceFrom : def.id;
  }

  /** Interior id of an exterior, when the building is enterable. */
  getInteriorOf(exteriorId: LocationId): LocationId | undefined {
    const interiorId = interiorIdFor(exteriorId);
    return this.getDef(interiorId) ? interiorId : undefined;
  }

  getMicroclimate(locationId: LocationId): MicroclimateState {
    const state = this.getState(locationId);
    if (state) {
      // Return a copy so callers cannot accidentally mutate authoritative state.
      return { ...state.microclimate };
    }
    const def = this.getDef(locationId);
    if (def) return this.microclimateFromDef(def);
    return { indoor: false, shelter: 0, windExposure: 0.5, humidityModifier: 0, heatSource: false };
  }

  isIndoor(locationId: LocationId): boolean {
    const def = this.getDef(locationId);
    return def ? def.indoor : false;
  }

  isOpenAt(locationId: LocationId, hour: number): boolean {
    const def = this.getDef(locationId);
    if (!def) return false;
    return isWithinHours(hour, def.openHour, def.closeHour);
  }

  hasFacility(locationId: LocationId, facility: FacilityKind): boolean {
    const def = this.getDef(locationId);
    return def ? def.facilities.includes(facility) : false;
  }

  getFacilities(locationId: LocationId): FacilityKind[] {
    const def = this.getDef(locationId);
    return def ? [...def.facilities] : [];
  }

  getUnlockedStates(): LocationState[] {
    return this.getAllStates().filter((state) => state.unlocked);
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  /** Records a visit. Returns true when the location was not yet discovered. */
  markVisited(locationId: LocationId, simTime: number): boolean {
    const state = this.getState(locationId);
    if (!state) return false;
    state.visitCount += 1;
    state.lastVisitSimTime = simTime;
    const wasDiscovered = state.discovered;
    state.discovered = true;
    return !wasDiscovered;
  }

  /** Reveals a location on the map (travel still requires it to be unlocked). */
  discover(locationId: LocationId): boolean {
    const state = this.getState(locationId);
    if (!state || state.discovered) return false;
    state.discovered = true;
    return true;
  }

  /** Unlocks a location so it can be travelled to. */
  unlock(locationId: LocationId): boolean {
    const state = this.getState(locationId);
    if (!state) return false;
    const changed = !state.unlocked || !state.discovered;
    state.unlocked = true;
    state.discovered = true;
    return changed;
  }

  /** Registers a discovered secret inside this location. Returns true when new. */
  recordSecret(locationId: LocationId, secretId: string): boolean {
    const state = this.getState(locationId);
    if (!state) return false;
    if (state.secretsFound.includes(secretId)) return false;
    state.secretsFound.push(secretId);
    return true;
  }

  /** Marks that the player has searched this location (used for exploration pacing). */
  recordSearch(locationId: LocationId): boolean {
    const state = this.getState(locationId);
    if (!state) return false;
    state.searchCount += 1;
    return true;
  }

  markLastEvent(locationId: LocationId, simTime: number): void {
    const state = this.getState(locationId);
    if (state) state.lastEventAt = simTime;
  }

  /** Applies slow condition decay for a number of elapsed days. */
  applyDailyDecay(daysElapsed: number, weather: string): void {
    if (!(daysElapsed > 0)) return;
    const severity = WEATHER_CONDITION_SEVERITY[weather] ?? 1;
    const decay = BASE_CONDITION_DECAY_PER_DAY * severity * Math.min(daysElapsed, 30);
    for (const state of this.getAllStates()) {
      state.condition = clamp01(Math.max(MIN_CONDITION, state.condition - decay));
    }
  }

  /** Restores condition (repairs/maintenance, used by community projects later). */
  repair(locationId: LocationId, amount: number): void {
    const state = this.getState(locationId);
    if (!state) return;
    state.condition = clamp01(state.condition + Math.max(0, amount));
  }

  /**
   * Recomputes NPC occupancy for every location from the authoritative NPC
   * state. Returns the number of location occupant lists that changed.
   */
  recomputeOccupants(npcs: Readonly<Record<string, NPCState>>): number {
    const ctx = this.getCtx();
    const buckets = new Map<LocationId, NPCId[]>();
    for (const npc of Object.values(npcs)) {
      if (!npc.alive) continue;
      const bucket = buckets.get(npc.locationId);
      if (bucket) bucket.push(npc.id);
      else buckets.set(npc.locationId, [npc.id]);
    }
    let changed = 0;
    for (const state of ctx.state.world.locations ? Object.values(ctx.state.world.locations) : []) {
      const next = buckets.get(state.id) ?? [];
      if (next.length !== state.occupants.length) {
        state.occupants = next;
        changed += 1;
        continue;
      }
      let same = true;
      for (let i = 0; i < next.length; i += 1) {
        if (next[i] !== state.occupants[i]) {
          same = false;
          break;
        }
      }
      if (!same) {
        state.occupants = next;
        changed += 1;
      }
    }
    return changed;
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /** Validates location state mirrors. Returns human readable problems. */
  validate(): string[] {
    const ctx = this.getCtx();
    const errors: string[] = [];
    for (const def of ctx.content.pack.locations) {
      const state = ctx.state.world.locations[def.id];
      if (!state) {
        errors.push('Missing location state: ' + def.id);
        continue;
      }
      if (state.regionId !== def.regionId) errors.push('Location ' + def.id + ' region mismatch');
      if (state.microclimate.indoor !== def.indoor) errors.push('Location ' + def.id + ' microclimate indoor mismatch');
      if (state.condition < 0 || state.condition > 1) errors.push('Location ' + def.id + ' condition out of range');
      if (!def.secret && !state.unlocked) errors.push('Non-secret location ' + def.id + ' should be unlocked by default');
    }
    return errors;
  }
}
