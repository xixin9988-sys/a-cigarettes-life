import { describe, expect, it } from 'vitest';
import type { LocationDef } from '../../src/data/schema';
import type { Season } from '../../src/core/SharedTypes';
import { LOCATIONS } from '../../src/data/locations/locations';
import { interiorIdFor } from '../../src/data/locations/ids';
import {
  FACILITY_VISUALS,
  buildLocationPlan,
  clampToWalkable,
  exteriorFacilityVisual,
  facilityVisual,
  isFreePoint,
  resolveForagePoint,
  resolveNpcAnchor,
  type LocationPlan,
  type PlanContext,
} from '../../src/render/layout';
import { PROP_SIZES, WALL_STYLES, isKnownPropKey } from '../../src/render/assetKeys';
import { ALL_GROUND_MATERIALS } from '../../src/render/tiles';
import { SCENE_HEIGHT, SCENE_WIDTH } from '../../src/render/geometry';
import type { FacilityKind } from '../../src/data/schema';

const BY_ID = new Map<string, LocationDef>(LOCATIONS.map((def) => [def.id, def]));

function contextFor(def: LocationDef, season: Season = 'spring'): PlanContext {
  const neighbours = def.connections
    .map((id) => BY_ID.get(id))
    .filter((neighbour): neighbour is LocationDef => neighbour !== undefined)
    .map((neighbour) => ({ id: neighbour.id, name: neighbour.name, mapX: neighbour.mapX, mapY: neighbour.mapY }));
  const interiorDef = !def.indoor ? BY_ID.get(interiorIdFor(def.id)) ?? null : null;
  const entranceDef = def.indoor && def.entranceFrom ? BY_ID.get(def.entranceFrom) ?? null : null;
  return {
    season,
    neighbours,
    interior: interiorDef ? { id: interiorDef.id, name: interiorDef.name } : null,
    entrance: entranceDef ? { id: entranceDef.id, name: entranceDef.name } : null,
  };
}

function planFor(def: LocationDef, season: Season = 'spring'): LocationPlan {
  return buildLocationPlan(def, contextFor(def, season));
}

const PLANS: { def: LocationDef; plan: LocationPlan }[] = LOCATIONS.map((def) => ({ def, plan: planFor(def) }));

function withinScene(x: number, y: number, margin = 0): boolean {
  return x >= -margin && y >= -margin && x <= SCENE_WIDTH + margin && y <= SCENE_HEIGHT + margin;
}

describe('location plan generation', () => {
  it('builds a plan for every location in the content pack', () => {
    expect(PLANS.length).toBe(LOCATIONS.length);
    expect(PLANS.length).toBeGreaterThanOrEqual(45);
  });

  it('uses the fixed diorama footprint and coherent ground zones', () => {
    for (const { def, plan } of PLANS) {
      expect(plan.id).toBe(def.id);
      expect(plan.width).toBe(SCENE_WIDTH);
      expect(plan.height).toBe(SCENE_HEIGHT);
      expect(plan.ground.length).toBeGreaterThan(0);
      for (const zone of plan.ground) {
        expect(ALL_GROUND_MATERIALS).toContain(zone.material);
        expect(zone.width).toBeGreaterThan(0);
        expect(zone.height).toBeGreaterThan(0);
        expect(withinScene(zone.x, zone.y, 2)).toBe(true);
        expect(withinScene(zone.x + zone.width, zone.y + zone.height, 2)).toBe(true);
      }
      for (const bridge of plan.bridges) {
        expect(withinScene(bridge.x, bridge.y)).toBe(true);
      }
      // Walkable rect must sit inside the scene and contain the player spawn.
      expect(plan.walkable.width).toBeGreaterThan(40);
      expect(plan.walkable.height).toBeGreaterThan(40);
      expect(withinScene(plan.playerSpawn.x, plan.playerSpawn.y, 0)).toBe(true);
      expect(plan.playerSpawn.x).toBeGreaterThanOrEqual(plan.walkable.x);
      expect(plan.playerSpawn.y).toBeGreaterThanOrEqual(plan.walkable.y);
      expect(plan.playerSpawn.x).toBeLessThanOrEqual(plan.walkable.x + plan.walkable.width);
      expect(plan.playerSpawn.y).toBeLessThanOrEqual(plan.walkable.y + plan.walkable.height);
    }
  });

  it('emits only known prop texture keys at sane positions', () => {
    for (const { plan } of PLANS) {
      for (const item of plan.props) {
        expect(isKnownPropKey(item.key)).toBe(true);
        expect(PROP_SIZES[item.key]).toBeDefined();
        expect(withinScene(item.x, item.y, 60)).toBe(true);
        expect(item.scale).toBeGreaterThan(0);
      }
    }
  });

  it('keeps obstacles inside the scene', () => {
    for (const { plan } of PLANS) {
      for (const obstacle of plan.obstacles) {
        expect(obstacle.width).toBeGreaterThan(0);
        expect(obstacle.height).toBeGreaterThan(0);
        expect(withinScene(obstacle.x, obstacle.y, 2)).toBe(true);
        expect(withinScene(obstacle.x + obstacle.width, obstacle.y + obstacle.height, 2)).toBe(true);
      }
    }
  });

  it('places NPC anchors on free walkable ground', () => {
    for (const { plan } of PLANS) {
      expect(plan.npcAnchors.length).toBeGreaterThan(0);
      for (const anchor of plan.npcAnchors) {
        const clamped = clampToWalkable(plan.walkable, anchor.x, anchor.y, 20);
        expect(Math.abs(clamped.x - anchor.x)).toBeLessThan(1e-6);
        expect(Math.abs(clamped.y - anchor.y)).toBeLessThan(1e-6);
        expect(isFreePoint(plan.obstacles, anchor.x, anchor.y, 14)).toBe(true);
      }
      for (const npcId of ['npc_1', 'npc_2', 'npc_3', 'npc_4', 'npc_5']) {
        const resolved = resolveNpcAnchor(plan, npcId);
        expect(resolved.x).toBeGreaterThanOrEqual(plan.walkable.x);
        expect(resolved.y).toBeGreaterThanOrEqual(plan.walkable.y);
        expect(resolved.x).toBeLessThanOrEqual(plan.walkable.x + plan.walkable.width);
        expect(resolved.y).toBeLessThanOrEqual(plan.walkable.y + plan.walkable.height);
        expect(resolveNpcAnchor(plan, npcId)).toEqual(resolved);
      }
      for (const nodeId of ['wild_berries:0', 'mushrooms:3', 'herbs:7']) {
        const point = resolveForagePoint(plan, nodeId);
        expect(resolveForagePoint(plan, nodeId)).toEqual(point);
        expect(point.x).toBeGreaterThanOrEqual(plan.walkable.x);
        expect(point.y).toBeGreaterThanOrEqual(plan.walkable.y);
      }
    }
  });

  it('connects every exit to a real neighbour of the location', () => {
    for (const { def, plan } of PLANS) {
      for (const exit of plan.exits) {
        expect(def.connections).toContain(exit.toId);
        expect(exit.label.length).toBeGreaterThan(0);
        expect(withinScene(exit.x, exit.y)).toBe(true);
      }
    }
  });

  it('places facilities that map to a real prop and action', () => {
    for (const { def, plan } of PLANS) {
      for (const facility of plan.facilities) {
        const visual = def.indoor ? facilityVisual(facility.kind) : exteriorFacilityVisual(facility.kind);
        expect(visual).not.toBeNull();
        expect(facility.prop).toBe(visual?.prop);
        expect(facility.action).toBe(visual?.action);
        expect(PROP_SIZES[facility.prop]).toBeDefined();
        expect(facility.radius).toBeGreaterThan(0);
        expect(withinScene(facility.x, facility.y, 20)).toBe(true);
        expect(def.facilities).toContain(facility.kind as FacilityKind);
      }
    }
  });

  it('covers every authored facility kind with a visual mapping except foraging', () => {
    const kinds = new Set<string>();
    for (const def of LOCATIONS) {
      for (const kind of def.facilities) kinds.add(kind);
    }
    for (const kind of kinds) {
      if (kind === 'forage') {
        expect(facilityVisual(kind)).toBeNull();
        continue;
      }
      expect(FACILITY_VISUALS[kind]).toBeDefined();
      expect(FACILITY_VISUALS[kind]?.prop).toBeTruthy();
    }
  });

  it('puts the door on the right side of the interior/exterior boundary', () => {
    for (const { def, plan } of PLANS) {
      if (def.indoor) {
        expect(plan.door).not.toBeNull();
        expect(plan.door?.kind).toBe('exit');
        expect(plan.door?.toId).toBe(def.entranceFrom);
        expect(plan.interiorStyle).not.toBeNull();
        expect(WALL_STYLES).toContain(plan.interiorStyle?.wallStyle);
        expect(plan.interiorStyle?.wallColor).toBeGreaterThan(0);
        expect(plan.interiorStyle?.trimColor).toBeGreaterThan(0);
      } else {
        expect(plan.interiorStyle).toBeNull();
        if (plan.door) {
          expect(plan.door.kind).toBe('enter');
          expect(plan.door.toId).toBe(interiorIdFor(def.id));
          expect(def.indoor).toBe(false);
        }
      }
    }
  });

  it('keeps building windows inside their facade', () => {
    for (const { plan } of PLANS) {
      for (const building of plan.buildings) {
        expect(building.width).toBeGreaterThan(80);
        expect(building.height).toBeGreaterThan(60);
        expect(building.roofHeight).toBeGreaterThan(0);
        expect(building.wallTop).toBe(building.y + building.roofHeight);
        expect(building.wallTop).toBeLessThan(building.y + building.height);
        for (const window of building.windows) {
          expect(window.x).toBeGreaterThanOrEqual(building.x);
          expect(window.x + window.width).toBeLessThanOrEqual(building.x + building.width);
          expect(window.y).toBeGreaterThanOrEqual(building.wallTop);
          expect(window.y + window.height).toBeLessThanOrEqual(building.y + building.height);
        }
      }
    }
  });

  it('is fully deterministic for the same location and season', () => {
    for (const { def } of PLANS.slice(0, 12)) {
      const a = planFor(def, 'autumn');
      const b = planFor(def, 'autumn');
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('gives every location a distinct walkable layout fingerprint', () => {
    const fingerprints = new Set(PLANS.map(({ plan }) => JSON.stringify({ g: plan.ground, p: plan.props, b: plan.buildings.map((b) => [b.x, b.y, b.width, b.height]) })));
    expect(fingerprints.size).toBe(PLANS.length);
  });

  it('places winter decoration only in winter plans', () => {
    const park = BY_ID.get('willowbrook_park');
    expect(park).toBeDefined();
    if (!park) return;
    const summer = planFor(park, 'summer');
    const winter = planFor(park, 'winter');
    const count = (plan: LocationPlan): number => plan.props.filter((prop) => prop.key === 'prop.snowman').length;
    expect(count(summer)).toBe(0);
    expect(count(winter)).toBeGreaterThan(0);
  });
});