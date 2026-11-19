// =============================================================================
// ScheduleSystem - combines each NPC's authored schedule template with a
// per-day adherence roll (stream 'npc.schedule') into today's planned
// activities, resolves target locations and answers "what should this NPC be
// doing at hour H?". The utility AI may still override the plan.
// Deterministic, DOM-free.
// =============================================================================
import type { GameTime, LocationId, RegionId } from '../core/SharedTypes';
import { DAYS_PER_WEEK, GAME_HOURS_PER_DAY, GAME_MINUTES_PER_DAY } from '../core/SharedTypes';
import type { IGameContext, NPCScheduleEntryState, NPCState } from '../core/contracts';
import type { ScheduleSeedEntry } from '../data/schema';
import { LOC, regionOfLocation } from '../data/locations/ids';
import {
  activityGroupOf,
  getActivityDefinition,
  type ActivityGroup,
  type LocationHint,
} from './NPC';
import { PersonalitySystem } from './PersonalitySystem';

const SCHEDULE_STREAM = 'npc.schedule';
const HOURS_PER_DAY = GAME_HOURS_PER_DAY;
const MINUTES_PER_DAY = GAME_MINUTES_PER_DAY;
const WEEKDAY_INDEX = DAYS_PER_WEEK;

export interface PlannedScheduleInfo {
  day: number;
  entries: NPCScheduleEntryState[];
  coverageHours: number;
}

export interface ResolvedActivity {
  activity: string;
  locationId: LocationId;
  group: ActivityGroup;
  startHour: number;
  endHour: number;
  /** True when this activity came from the authored template (not a fallback). */
  fromTemplate: boolean;
}

function clampAdherence(value: number): number {
  if (!Number.isFinite(value)) return 0.85;
  return Math.min(0.985, Math.max(0.05, value));
}

/** True when an entry covers the given hour (overnight windows are supported). */
export function entryCoversHour(entry: NPCScheduleEntryState, hour: number): boolean {
  const start = entry.startHour;
  let end = entry.endHour;
  if (end <= start) end += HOURS_PER_DAY;
  let h = hour;
  if (h < start && start >= HOURS_PER_DAY) h += HOURS_PER_DAY;
  return h >= start && h < end;
}

interface MinuteSegment {
  startMin: number;
  endMin: number;
  activity: string;
  locationId: LocationId | null;
  adherence: number;
  fromTemplate: boolean;
  priority: number;
}

function toSegments(entry: NPCScheduleEntryState, fromTemplate: boolean, priority: number): MinuteSegment[] {
  const startMin = Math.max(0, entry.startHour) * 60;
  let endMin = entry.endHour * 60;
  if (endMin <= startMin) endMin += MINUTES_PER_DAY;
  endMin = Math.min(MINUTES_PER_DAY, endMin);
  const segments: MinuteSegment[] = [];
  if (endMin <= startMin) return segments;
  segments.push({
    startMin,
    endMin,
    activity: entry.activity,
    locationId: entry.locationId ?? null,
    adherence: entry.adherence,
    fromTemplate,
    priority,
  });
  return segments;
}

function insertSegment(target: MinuteSegment[], segment: MinuteSegment): void {
  // Split existing segments so the new one always wins its own time slot.
  const result: MinuteSegment[] = [];
  for (const existing of target) {
    if (existing.endMin <= segment.startMin || existing.startMin >= segment.endMin) {
      result.push(existing);
      continue;
    }
    if (existing.startMin < segment.startMin) {
      result.push({ ...existing, endMin: segment.startMin });
    }
    if (existing.endMin > segment.endMin) {
      result.push({ ...existing, startMin: segment.endMin });
    }
  }
  result.push(segment);
  result.sort((a, b) => a.startMin - b.startMin);
  target.length = 0;
  target.push(...result);
}

function defaultHomeActivity(startMin: number): string {
  const hour = startMin / 60;
  if (hour >= 22 || hour < 6) return 'sleep';
  if (hour < 9.5) return 'breakfast';
  if (hour >= 18 && hour < 22) return 'dinner';
  return 'relax';
}

export class ScheduleSystem {
  constructor(private readonly personality: PersonalitySystem) {}

  /** Replans the NPC's day when the day has rolled over or no plan exists. */
  ensureDailyPlan(ctx: IGameContext, npc: NPCState, time: GameTime): boolean {
    if (npc.schedule.lastPlannedDay === time.totalDays && npc.schedule.entries.length > 0) {
      return false;
    }
    this.planDay(ctx, npc, time);
    return true;
  }

  /** Builds today's plan from the authored template + adherence rolls. */
  planDay(ctx: IGameContext, npc: NPCState, time: GameTime): void {
    const definition = ctx.content.getNPC(npc.id);
    const template = definition?.scheduleTemplate ?? [];
    const weekday = time.totalDays % WEEKDAY_INDEX;
    const segments: MinuteSegment[] = [];
    let priority = 0;
    for (const seed of template) {
      if (!this.entryAppliesOn(seed, weekday)) continue;
      priority += 1;
      const adherence = clampAdherence(seed.adherence);
      const chance = this.personality.adherenceChance(npc, adherence);
      const follows = ctx.probability.chance(SCHEDULE_STREAM, chance);
      const planned = follows
        ? { activity: seed.activity, locationId: seed.locationId ?? null }
        : this.deviate(ctx, npc, seed.activity);
      const entry: NPCScheduleEntryState = {
        startHour: seed.startHour,
        endHour: seed.endHour,
        activity: planned.activity,
        adherence,
      };
      if (planned.locationId) entry.locationId = planned.locationId;
      else entry.locationId = this.resolveLocationForActivity(ctx, npc, planned.activity);
      const rawSegments = toSegments(entry, follows, priority);
      for (const segment of rawSegments) insertSegment(segments, segment);
    }
    this.fillGaps(segments, npc);
    const merged = this.mergeSegments(segments);
    const entries: NPCScheduleEntryState[] = merged.map((segment) => {
      const planned: NPCScheduleEntryState = {
        startHour: segment.startMin / 60,
        endHour: segment.endMin / 60,
        activity: segment.activity,
        locationId: segment.locationId ?? npc.homeLocationId,
        adherence: segment.adherence,
      };
      return planned;
    });
    npc.schedule.entries = entries;
    npc.schedule.lastPlannedDay = time.totalDays;
  }

  private entryAppliesOn(seed: ScheduleSeedEntry, weekday: number): boolean {
    if (!seed.days || seed.days.length === 0) return true;
    return seed.days.includes(weekday);
  }

  /** Picks a plausible deviation when the NPC does not follow the template. */
  private deviate(
    ctx: IGameContext,
    npc: NPCState,
    templateActivity: string
  ): { activity: string; locationId: LocationId | null } {
    const group = activityGroupOf(templateActivity);
    const profile = this.personality.profileOf(npc);
    let options: { weight: number; value: string }[];
    switch (group) {
      case 'work':
        options = [
          { weight: 1.1, value: 'personal_errand' },
          { weight: 0.9, value: 'stroll' },
          { weight: 0.7 + 0.6 * profile.homeDrive, value: 'go_home' },
          { weight: 0.5, value: 'go_cafe' },
          { weight: 0.8 + 0.8 * profile.socialDrive, value: 'visit_friend' },
        ];
        break;
      case 'social':
        options = [
          { weight: 1.2, value: 'stroll' },
          { weight: 1.0, value: 'read' },
          { weight: 0.8, value: 'go_home' },
          { weight: 0.7, value: 'rest' },
        ];
        break;
      case 'sleep':
        options = [
          { weight: 2.5, value: 'rest' },
          { weight: 0.4, value: 'go_home' },
        ];
        break;
      case 'food':
        options = [
          { weight: 1.0 + profile.spendDrive, value: 'go_cafe' },
          { weight: 1.0, value: 'stroll' },
          { weight: 0.8, value: 'go_home' },
        ];
        break;
      default:
        options = [
          { weight: 1.1, value: 'stroll' },
          { weight: 1.0, value: 'read' },
          { weight: 0.8 + 0.5 * profile.homeDrive, value: 'go_home' },
          { weight: 0.7 + 0.7 * profile.socialDrive, value: 'visit_friend' },
        ];
        break;
    }
    const picked = ctx.probability.weighted(SCHEDULE_STREAM, options);
    return { activity: picked ?? 'relax', locationId: null };
  }

  /** Fills any uncovered minutes with believable home defaults. */
  private fillGaps(segments: MinuteSegment[], npc: NPCState): void {
    let cursor = 0;
    const ordered = [...segments].sort((a, b) => a.startMin - b.startMin);
    for (const segment of ordered) {
      if (segment.startMin > cursor) {
        const activity = defaultHomeActivity(cursor);
        const filler: MinuteSegment = {
          startMin: cursor,
          endMin: segment.startMin,
          activity,
          locationId: this.resolveLocationForActivityFromNpcOnly(npc, activity),
          adherence: 1,
          fromTemplate: false,
          priority: 0,
        };
        segments.push(filler);
      }
      cursor = Math.max(cursor, segment.endMin);
    }
    if (cursor < MINUTES_PER_DAY) {
      const activity = defaultHomeActivity(cursor);
      segments.push({
        startMin: cursor,
        endMin: MINUTES_PER_DAY,
        activity,
        locationId: this.resolveLocationForActivityFromNpcOnly(npc, activity),
        adherence: 1,
        fromTemplate: false,
        priority: 0,
      });
    }
    segments.sort((a, b) => a.startMin - b.startMin);
  }

  /** Merges adjacent segments that already agree on activity + location. */
  private mergeSegments(segments: MinuteSegment[]): MinuteSegment[] {
    const merged: MinuteSegment[] = [];
    for (const segment of segments) {
      const previous = merged[merged.length - 1];
      if (
        previous &&
        previous.endMin === segment.startMin &&
        previous.activity === segment.activity &&
        previous.locationId === segment.locationId
      ) {
        previous.endMin = segment.endMin;
        previous.adherence = Math.max(previous.adherence, segment.adherence);
        previous.fromTemplate = previous.fromTemplate || segment.fromTemplate;
        continue;
      }
      merged.push({ ...segment });
    }
    return merged;
  }

  /** Entry that covers the given fractional hour (fallback: last entry of day). */
  getExpectedEntry(npc: NPCState, hour: number): NPCScheduleEntryState | undefined {
    for (const entry of npc.schedule.entries) {
      if (entryCoversHour(entry, hour)) return entry;
    }
    return npc.schedule.entries[0];
  }

  getExpectedActivity(npc: NPCState, hour: number): string {
    return this.getExpectedEntry(npc, hour)?.activity ?? 'relax';
  }

  getExpectedGroup(npc: NPCState, hour: number): ActivityGroup {
    return activityGroupOf(this.getExpectedActivity(npc, hour));
  }

  getExpectedLocation(npc: NPCState, hour: number): LocationId {
    return this.getExpectedEntry(npc, hour)?.locationId ?? npc.homeLocationId;
  }

  /** Next planned entry after the given fractional hour (for UI/debug). */
  getNextEntry(npc: NPCState, hour: number): NPCScheduleEntryState | undefined {
    let best: NPCScheduleEntryState | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const entry of npc.schedule.entries) {
      let distance = entry.startHour - hour;
      if (distance <= 0.001) distance += HOURS_PER_DAY;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    }
    return best;
  }

  /** Resolved current activity including location (used by tests/UI). */
  getResolvedActivity(npc: NPCState, hour: number): ResolvedActivity | undefined {
    const entry = this.getExpectedEntry(npc, hour);
    if (!entry) return undefined;
    return {
      activity: entry.activity,
      locationId: entry.locationId ?? npc.homeLocationId,
      group: activityGroupOf(entry.activity),
      startHour: entry.startHour,
      endHour: entry.endHour,
      fromTemplate: true,
    };
  }

  getPlanInfo(npc: NPCState): PlannedScheduleInfo {
    let coverage = 0;
    for (const entry of npc.schedule.entries) {
      let end = entry.endHour;
      if (end <= entry.startHour) end += HOURS_PER_DAY;
      coverage += Math.max(0, end - entry.startHour);
    }
    return {
      day: npc.schedule.lastPlannedDay,
      entries: npc.schedule.entries,
      coverageHours: Math.min(HOURS_PER_DAY, coverage),
    };
  }

  // ---------------------------------------------------------------------------
  // Location resolution
  // ---------------------------------------------------------------------------
  private regionOf(npc: NPCState): RegionId {
    return regionOfLocation(npc.homeLocationId);
  }

  private regionPick(ctx: IGameContext, npc: NPCState, willowbrook: LocationId, ashford: LocationId): LocationId {
    const preferred = this.regionOf(npc) === 'ashford' ? ashford : willowbrook;
    if (ctx.content.getLocation(preferred)) return preferred;
    const other = preferred === ashford ? willowbrook : ashford;
    return ctx.content.getLocation(other) ? other : npc.homeLocationId;
  }

  /** Resolves a sensible location for an activity (used by schedule + decisions). */
  resolveLocationForActivity(ctx: IGameContext, npc: NPCState, activity: string): LocationId {
    const definition = getActivityDefinition(activity);
    if (!definition) return npc.homeLocationId;
    const hint: LocationHint = definition.locationHint;
    let candidate: LocationId;
    switch (hint) {
      case 'work':
        candidate = npc.workLocationId || npc.homeLocationId;
        break;
      case 'home':
      case 'rest':
      case 'food':
        candidate = npc.homeLocationId;
        break;
      case 'cafe':
        candidate = this.regionPick(ctx, npc, LOC.cafe, LOC.cityCafe);
        break;
      case 'shops':
        candidate = this.regionPick(ctx, npc, LOC.grocery, LOC.convenienceStore);
        break;
      case 'outdoors':
        candidate = this.regionPick(ctx, npc, LOC.park, LOC.cityPark);
        break;
      case 'library':
        candidate = this.regionPick(ctx, npc, LOC.library, LOC.cityLibrary);
        break;
      case 'water':
        candidate = this.regionPick(ctx, npc, LOC.river, LOC.riversideWalk);
        break;
      case 'garden':
        candidate = this.regionPick(ctx, npc, LOC.greenhouse, LOC.orchard);
        break;
      case 'errands':
        candidate = this.regionPick(ctx, npc, LOC.postOffice, LOC.supermarket);
        break;
      case 'jobs':
        candidate = this.regionPick(ctx, npc, LOC.market, LOC.officeDistrict);
        break;
      case 'station':
        candidate = this.regionPick(ctx, npc, LOC.trainStation, LOC.ashfordTrainStation);
        break;
      case 'market':
        candidate = this.regionPick(ctx, npc, LOC.market, LOC.supermarket);
        break;
      case 'event':
        candidate = this.regionPick(ctx, npc, LOC.plaza, LOC.eventSquare);
        break;
      case 'date':
        candidate = this.regionPick(ctx, npc, LOC.cafe, LOC.restaurant);
        break;
      case 'social':
        candidate = this.regionPick(ctx, npc, LOC.plaza, LOC.cityPark);
        break;
      default:
        candidate = npc.homeLocationId;
        break;
    }
    if (ctx.content.getLocation(candidate)) return candidate;
    if (ctx.content.getLocation(npc.homeLocationId)) return npc.homeLocationId;
    if (ctx.content.getLocation(npc.workLocationId)) return npc.workLocationId;
    return candidate;
  }

  private resolveLocationForActivityFromNpcOnly(npc: NPCState, activity: string): LocationId {
    const definition = getActivityDefinition(activity);
    if (!definition) return npc.homeLocationId;
    if (definition.locationHint === 'work') return npc.workLocationId || npc.homeLocationId;
    return npc.homeLocationId;
  }
}
