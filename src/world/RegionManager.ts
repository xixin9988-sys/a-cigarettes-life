import type { IGameContext, RegionState } from '../core/contracts';
import type { RegionId } from '../core/SharedTypes';
import { REGION_IDS } from '../core/SharedTypes';

/**
 * OWNER: Agent 4 (World & Map).
 *
 * Owns the two top-level world regions (Willowbrook, Ashford City) and keeps
 * their RegionState in sync with the static location definitions. Regions are
 * always explorable in this game - the fields exist so later content (a locked
 * district, a future expansion) can gate them without touching the systems.
 */

export const REGION_NAMES: Readonly<Record<RegionId, string>> = {
  willowbrook: 'Willowbrook',
  ashford: 'Ashford City',
};

export const REGION_DESCRIPTIONS: Readonly<Record<RegionId, string>> = {
  willowbrook: 'A sleepy English village of cottages, farms and old secrets.',
  ashford: 'A busy market city of glass offices, museums and train whistles.',
};

export class RegionManager {
  private ctx: IGameContext | null = null;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.syncRegions();
    this.trimRegionLocations();
  }

  /** Creates missing regions and re-syncs their location lists from the content pack. */
  private syncRegions(): void {
    const ctx = this.getCtx();
    const regions = ctx.state.world.regions;
    for (const regionId of REGION_IDS) {
      const expected = ctx.content.getLocationsInRegion(regionId).map((def) => def.id);
      const existing = regions[regionId];
      if (!existing) {
        regions[regionId] = {
          id: regionId,
          name: REGION_NAMES[regionId],
          unlocked: true,
          locationIds: expected,
          discovered: true,
        };
        continue;
      }
      existing.name = existing.name || REGION_NAMES[regionId];
      existing.locationIds = expected;
    }
  }

  /** Removes location ids that no longer exist from region lists (content migration safety). */
  private trimRegionLocations(): void {
    const locations = this.getCtx().state.world.locations;
    for (const regionId of REGION_IDS) {
      const region = this.getCtx().state.world.regions[regionId];
      if (!region) continue;
      region.locationIds = region.locationIds.filter((id) => locations[id] !== undefined);
    }
  }

  private getCtx(): IGameContext {
    if (!this.ctx) throw new Error('RegionManager.init(ctx) was not called');
    return this.ctx;
  }

  getRegion(id: RegionId): RegionState | undefined {
    return this.getCtx().state.world.regions[id];
  }

  getRegions(): RegionState[] {
    const regions = this.getCtx().state.world.regions;
    const result: RegionState[] = [];
    for (const regionId of REGION_IDS) {
      const region = regions[regionId];
      if (region) result.push(region);
    }
    return result;
  }

  /** Region a location belongs to, resolved through the static location definition. */
  getRegionOfLocation(locationId: string): RegionId | undefined {
    const def = this.getCtx().content.getLocation(locationId);
    return def ? def.regionId : undefined;
  }

  getRegionLocations(regionId: RegionId): string[] {
    const region = this.getCtx().state.world.regions[regionId];
    return region ? [...region.locationIds] : [];
  }

  isRegionUnlocked(regionId: RegionId): boolean {
    return this.getCtx().state.world.regions[regionId]?.unlocked ?? false;
  }

  /** Marks a region as seen by the player. Returns true when the state changed. */
  discoverRegion(regionId: RegionId): boolean {
    const region = this.getCtx().state.world.regions[regionId];
    if (!region || region.discovered) return false;
    region.discovered = true;
    return true;
  }

  /** Unlocks a region (its locations become travel candidates). Idempotent. */
  unlockRegion(regionId: RegionId): boolean {
    const region = this.getCtx().state.world.regions[regionId];
    if (!region) return false;
    const changed = !region.unlocked || !region.discovered;
    region.unlocked = true;
    region.discovered = true;
    return changed;
  }

  /** Validates region/location consistency. Returns human readable problems (empty = OK). */
  validate(): string[] {
    const errors: string[] = [];
    const ctx = this.getCtx();
    for (const regionId of REGION_IDS) {
      const region = ctx.state.world.regions[regionId];
      if (!region) {
        errors.push('Missing region state: ' + regionId);
        continue;
      }
      const seen = new Set<string>();
      for (const locationId of region.locationIds) {
        if (seen.has(locationId)) errors.push('Region ' + regionId + ' lists location twice: ' + locationId);
        seen.add(locationId);
        if (!ctx.state.world.locations[locationId]) {
          errors.push('Region ' + regionId + ' lists unknown location: ' + locationId);
        }
      }
      for (const def of ctx.content.getLocationsInRegion(regionId)) {
        if (!seen.has(def.id)) errors.push('Region ' + regionId + ' is missing location: ' + def.id);
      }
    }
    return errors;
  }
}
