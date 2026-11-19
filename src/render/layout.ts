import type { FacilityKind, LocationDef } from '../data/schema';
import type { RegionId, Season } from '../core/SharedTypes';
import { ambientKind } from './effects';
import { hashString, SCENE_HEIGHT, SCENE_WIDTH, seededInt, seededRange, seededValue, type Vec2 } from './geometry';
import { locationPalette, regionPalette } from './palette';

/**
 * Deterministic, Phaser-free location layout planner.
 *
 * Every location renders on the same 1280x736 "diorama" canvas, but the layout
 * is generated from its kind, theme, region and authored colours. The planner
 * produces plain data (rects, prop placements, building specs, exits, facilities,
 * obstacles) that the scene-side renderer turns into pixel art.
 *
 * Rules:
 *  - Deterministic per location id: no Math.random, no wall clock.
 *  - The scene centre is always walkable (the player enters a location at its
 *    centre because WorldManager.travelTo places them at the definition centre).
 *  - All interactables sit on/next to walkable ground.
 */

export const W = SCENE_WIDTH;
export const H = SCENE_HEIGHT;
/** Height of the painted sky / distant-house band at the top of exterior scenes. */
export const SKY = 128;

export type GroundMaterial =
  | 'grass'
  | 'path'
  | 'plaza'
  | 'cobble'
  | 'road'
  | 'pavement'
  | 'water'
  | 'soil'
  | 'field'
  | 'wood'
  | 'tile'
  | 'carpet'
  | 'stone'
  | 'concrete'
  | 'mall'
  | 'crossing'
  | 'rail';

export type BuildingStyle =
  | 'cottage'
  | 'shop'
  | 'townhouse'
  | 'civic'
  | 'barn'
  | 'tower'
  | 'office'
  | 'glass'
  | 'ruin'
  | 'greenhouse'
  | 'station'
  | 'warehouse'
  | 'kiosk'
  | 'stage';

export type WallStyle = 'plaster' | 'brick' | 'wood' | 'tile' | 'industrial' | 'glass';

export type CeilingStyle = 'sky' | 'glass' | 'indoor';

export type ExitSide = 'north' | 'south' | 'east' | 'west';

export interface RectPlan {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GroundZone {
  x: number;
  y: number;
  width: number;
  height: number;
  material: GroundMaterial;
}

export interface PropPlan {
  key: string;
  x: number;
  y: number;
  scale: number;
  flipX: boolean;
  /** Flat props (rugs, crossings) are centred on their position instead of bottom-anchored. */
  flat: boolean;
}

export interface WindowPlan {
  x: number;
  y: number;
  width: number;
  height: number;
  lit: boolean;
}

export interface LightPlan {
  x: number;
  y: number;
  radius: number;
  color: number;
  strength: number;
}

export interface BuildingPlan {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Roof band height in pixels (top of the building). */
  roofHeight: number;
  /** Y coordinate where the facade wall starts (y + roofHeight). */
  wallTop: number;
  style: BuildingStyle;
  floors: number;
  wallColor: number;
  roofColor: number;
  trimColor: number;
  windowColor: number;
  awningColor: number | null;
  hasDoor: boolean;
  signText: string | null;
  seed: number;
  windows: WindowPlan[];
}

export interface ExitPlan {
  toId: string;
  label: string;
  side: ExitSide;
  x: number;
  y: number;
}

export interface DoorPlan {
  x: number;
  y: number;
  toId: string;
  label: string;
  kind: 'enter' | 'exit';
}

export type FacilityAction =
  | 'shop'
  | 'collection'
  | 'inventory'
  | 'rest'
  | 'fishing'
  | 'train'
  | 'warm'
  | 'events'
  | 'housing'
  | 'farm';

export interface FacilityPlan {
  kind: string;
  label: string;
  x: number;
  y: number;
  prop: string;
  action: FacilityAction;
  radius: number;
}

export interface InteriorStylePlan {
  wallStyle: WallStyle;
  wallColor: number;
  trimColor: number;
  floorMaterial: GroundMaterial;
  doorX: number;
  windows: WindowPlan[];
}

export interface SearchSpotPlan {
  x: number;
  y: number;
  label: string;
}

export interface AmbientPlan {
  petals: boolean;
  leaves: boolean;
  motes: boolean;
  fireflies: boolean;
}

export interface LocationPlan {
  id: string;
  name: string;
  indoor: boolean;
  regionId: RegionId;
  width: number;
  height: number;
  skyHeight: number;
  ceilingStyle: CeilingStyle;
  ground: GroundZone[];
  waterZones: RectPlan[];
  bridges: RectPlan[];
  buildings: BuildingPlan[];
  props: PropPlan[];
  exits: ExitPlan[];
  door: DoorPlan | null;
  facilities: FacilityPlan[];
  searchSpot: SearchSpotPlan | null;
  obstacles: RectPlan[];
  lights: LightPlan[];
  walkable: RectPlan;
  playerSpawn: Vec2;
  npcAnchors: Vec2[];
  ambient: AmbientPlan;
  interiorStyle: InteriorStylePlan | null;
  farmable: boolean;
}

export interface PlanNeighbour {
  id: string;
  name: string;
  mapX: number;
  mapY: number;
}

export interface PlanContext {
  season: Season;
  neighbours: readonly PlanNeighbour[];
  /** For exteriors: the enterable interior of this building, when one exists. */
  interior: { id: string; name: string } | null;
  /** For interiors: the exterior this room belongs to. */
  entrance: { id: string; name: string } | null;
}

// ---------------------------------------------------------------------------
// Facility prop / action vocabulary
// ---------------------------------------------------------------------------

export interface FacilityVisual {
  prop: string;
  action: FacilityAction;
  label: string;
}

export const FACILITY_VISUALS: Readonly<Record<string, FacilityVisual>> = {
  shop: { prop: 'prop.counter', action: 'shop', label: 'Shop' },
  shop_counter: { prop: 'prop.counter', action: 'shop', label: 'Shop counter' },
  cafe: { prop: 'prop.table', action: 'shop', label: 'Café' },
  bakery: { prop: 'prop.counter', action: 'shop', label: 'Bakery counter' },
  restaurant: { prop: 'prop.table', action: 'shop', label: 'Restaurant' },
  library: { prop: 'prop.shelves', action: 'collection', label: 'Library shelves' },
  museum: { prop: 'prop.displaycase', action: 'collection', label: 'Museum display' },
  workbench: { prop: 'prop.workbench', action: 'inventory', label: 'Workbench' },
  kitchen: { prop: 'prop.kitchen', action: 'inventory', label: 'Kitchen' },
  art_studio: { prop: 'prop.easel', action: 'inventory', label: 'Art studio' },
  greenhouse: { prop: 'prop.planter', action: 'inventory', label: 'Greenhouse beds' },
  farmland: { prop: 'prop.stall', action: 'farm', label: 'Farmland' },
  bed: { prop: 'prop.bed', action: 'rest', label: 'Bed' },
  campfire: { prop: 'prop.campfire', action: 'warm', label: 'Campfire' },
  heater: { prop: 'prop.stove', action: 'warm', label: 'Warm hearth' },
  fishing_spot: { prop: 'prop.dock', action: 'fishing', label: 'Fishing spot' },
  train: { prop: 'prop.stationboard', action: 'train', label: 'Train' },
  noticeboard: { prop: 'prop.noticeboard', action: 'events', label: 'Noticeboard' },
  stage: { prop: 'prop.stage', action: 'events', label: 'Stage' },
  cinema_screen: { prop: 'prop.screen', action: 'events', label: 'Cinema' },
  storage: { prop: 'prop.crate', action: 'housing', label: 'Storage' },
  office_desk: { prop: 'prop.desk', action: 'inventory', label: 'Desk' },
};

export function facilityVisual(kind: FacilityKind | string): FacilityVisual | null {
  return FACILITY_VISUALS[kind] ?? null;
}

/**
 * Interior furniture (beds, shop counters, stoves) only makes sense inside, so
 * exterior locations swap those facilities for street-appropriate props: menu
 * boards outside cafés, market stalls for shops, easels outside studios, etc.
 * Kinds not listed here are simply not placed outdoors.
 */
export const EXTERIOR_FACILITY_VISUALS: Readonly<Record<string, { prop: string; action: FacilityAction }>> = {
  shop: { prop: 'prop.stall', action: 'shop' },
  shop_counter: { prop: 'prop.stall', action: 'shop' },
  cafe: { prop: 'prop.menu', action: 'shop' },
  bakery: { prop: 'prop.menu', action: 'shop' },
  restaurant: { prop: 'prop.menu', action: 'shop' },
  art_studio: { prop: 'prop.easel', action: 'inventory' },
  greenhouse: { prop: 'prop.planter', action: 'inventory' },
  farmland: { prop: 'prop.stall', action: 'farm' },
  campfire: { prop: 'prop.campfire', action: 'warm' },
  fishing_spot: { prop: 'prop.dock', action: 'fishing' },
  train: { prop: 'prop.stationboard', action: 'train' },
  noticeboard: { prop: 'prop.noticeboard', action: 'events' },
  storage: { prop: 'prop.crate', action: 'housing' },
};

export function exteriorFacilityVisual(kind: string): FacilityVisual | null {
  const base = facilityVisual(kind);
  const exterior = EXTERIOR_FACILITY_VISUALS[kind];
  if (!base || !exterior) return null;
  return { prop: exterior.prop, action: exterior.action, label: base.label };
}

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

function ground(x: number, y: number, width: number, height: number, material: GroundMaterial): GroundZone {
  return { x, y, width, height, material };
}

function prop(key: string, x: number, y: number, scale = 1, flipX = false): PropPlan {
  return { key, x, y, scale, flipX, flat: false };
}

function flatProp(key: string, x: number, y: number, scale = 1): PropPlan {
  return { key, x, y, scale, flipX: false, flat: true };
}

function rect(x: number, y: number, width: number, height: number): RectPlan {
  return { x, y, width, height };
}

function walkableRect(left: number, top: number, right: number, bottom: number): RectPlan {
  return { x: left, y: top, width: Math.max(32, right - left), height: Math.max(32, bottom - top) };
}

/** Cylinder vs rect list test used while placing props/anchors. */
export function isFreePoint(obstacles: readonly RectPlan[], x: number, y: number, radius: number): boolean {
  for (const obstacle of obstacles) {
    const nearestX = Math.max(obstacle.x, Math.min(x, obstacle.x + obstacle.width));
    const nearestY = Math.max(obstacle.y, Math.min(y, obstacle.y + obstacle.height));
    const dx = x - nearestX;
    const dy = y - nearestY;
    if (dx * dx + dy * dy < radius * radius) return false;
  }
  return true;
}

export function clampToWalkable(walkable: RectPlan, x: number, y: number, margin: number): Vec2 {
  const minX = walkable.x + margin;
  const maxX = walkable.x + walkable.width - margin;
  const minY = walkable.y + margin;
  const maxY = walkable.y + walkable.height - margin;
  return {
    x: Math.max(Math.min(minX, maxX), Math.min(x, Math.max(minX, maxX))),
    y: Math.max(Math.min(minY, maxY), Math.min(y, Math.max(minY, maxY))),
  };
}

function half(plan: LocationPlan): number {
  return hashString(plan.id);
}

// ---------------------------------------------------------------------------
// Anchor points + deterministic resolve helpers
// ---------------------------------------------------------------------------

function buildAnchors(plan: LocationPlan, count = 14): Vec2[] {
  const { walkable, obstacles } = plan;
  const seed = half(plan);
  const anchors: Vec2[] = [];
  const rows = [0.58, 0.74, 0.88];
  const cols = 5;
  for (const row of rows) {
    for (let col = 0; col < cols; col += 1) {
      const x = walkable.x + ((col + 0.5) / cols) * walkable.width + seededRange(seed, anchors.length + 31, -26, 26);
      const y = walkable.y + row * walkable.height + seededRange(seed, anchors.length + 77, -18, 18);
      const clamped = clampToWalkable(walkable, x, y, 26);
      if (isFreePoint(obstacles, clamped.x, clamped.y, 20)) anchors.push(clamped);
      if (anchors.length >= count) return anchors;
    }
  }
  if (anchors.length === 0) anchors.push({ x: walkable.x + walkable.width / 2, y: walkable.y + walkable.height / 2 });
  return anchors;
}

/** Deterministic NPC spawn anchor for a location plan. */
export function resolveNpcAnchor(plan: LocationPlan, npcId: string): Vec2 {
  const anchors = plan.npcAnchors;
  if (anchors.length === 0) return { x: plan.walkable.x + plan.walkable.width / 2, y: plan.walkable.y + plan.walkable.height / 2 };
  const seed = hashString(npcId);
  const base = anchors[seed % anchors.length];
  if (!base) return { x: plan.walkable.x + plan.walkable.width / 2, y: plan.walkable.y + plan.walkable.height / 2 };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = clampToWalkable(
      plan.walkable,
      base.x + seededRange(seed, attempt * 2, -46, 46),
      base.y + seededRange(seed, attempt * 2 + 1, -30, 30),
      24
    );
    if (isFreePoint(plan.obstacles, candidate.x, candidate.y, 14)) return candidate;
  }
  return { x: base.x, y: base.y };
}

/** Deterministic ground point for a forage node of this location. */
export function resolveForagePoint(plan: LocationPlan, nodeId: string): Vec2 {
  const anchors = plan.npcAnchors;
  if (anchors.length === 0) return { x: plan.walkable.x + plan.walkable.width / 2, y: plan.walkable.y + plan.walkable.height / 2 };
  const seed = hashString('forage:' + nodeId);
  const base = anchors[seed % anchors.length];
  if (!base) return { x: plan.walkable.x + plan.walkable.width / 2, y: plan.walkable.y + plan.walkable.height / 2 };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = clampToWalkable(
      plan.walkable,
      base.x + seededRange(seed, attempt * 3, -70, 70),
      base.y + seededRange(seed, attempt * 3 + 1, -44, 44),
      28
    );
    if (isFreePoint(plan.obstacles, candidate.x, candidate.y, 12)) return candidate;
  }
  return { x: base.x, y: base.y };
}

// ---------------------------------------------------------------------------
// Exits + door placement
// ---------------------------------------------------------------------------

function sideBetween(def: LocationDef, neighbour: PlanNeighbour): ExitSide {
  const dx = neighbour.mapX - def.mapX;
  const dy = neighbour.mapY - def.mapY;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

function placeExits(plan: LocationPlan, def: LocationDef, ctx: PlanContext): void {
  const bySide = new Map<ExitSide, PlanNeighbour[]>();
  for (const neighbour of ctx.neighbours) {
    const side = sideBetween(def, neighbour);
    const list = bySide.get(side) ?? [];
    list.push(neighbour);
    bySide.set(side, list);
  }
  const { walkable, obstacles } = plan;
  for (const [side, list] of bySide) {
    list.sort((a, b) => (side === 'north' || side === 'south' ? a.mapX - b.mapX : a.mapY - b.mapY));
    list.forEach((neighbour, index) => {
      const t = (index + 1) / (list.length + 1);
      let x = walkable.x + walkable.width * t;
      let y = walkable.y + walkable.height / 2;
      if (side === 'north') y = walkable.y + 26;
      else if (side === 'south') y = walkable.y + walkable.height - 26;
      else if (side === 'east') x = walkable.x + walkable.width - 32;
      else x = walkable.x + 32;
      // Nudge along the edge until the marker lands on free ground.
      for (let attempt = 0; attempt < 14; attempt += 1) {
        if (isFreePoint(obstacles, x, y, 18)) break;
        if (side === 'north' || side === 'south') x += attempt % 2 === 0 ? 38 : -38;
        else y += attempt % 2 === 0 ? 38 : -38;
        const clamped = clampToWalkable(walkable, x, y, 22);
        x = clamped.x;
        y = clamped.y;
      }
      plan.exits.push({ toId: neighbour.id, label: neighbour.name, side, x, y });
    });
  }
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

interface BuildingSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  style: BuildingStyle;
  floors: number;
  hasDoor: boolean;
  signText: string | null;
}

const CIVIC_KINDS: ReadonlySet<string> = new Set(['library', 'museum', 'cinema', 'cultural_center', 'city_library', 'town_center']);

function addBuilding(plan: LocationPlan, def: LocationDef, spec: BuildingSpec): BuildingPlan {
  const region = regionPalette(def.regionId);
  const seed = hashString(plan.id + ':building:' + plan.buildings.length);
  let roofColor = region.roofA;
  let wallColor = region.wallA;
  let trimColor = region.trim;
  let awningColor: number | null = null;
  let windowColor = region.windowLit;
  switch (spec.style) {
    case 'cottage':
      wallColor = region.wallA;
      roofColor = region.roofA;
      break;
    case 'shop':
      wallColor = region.wallB;
      roofColor = region.roofB;
      awningColor = region.awning;
      break;
    case 'townhouse':
      wallColor = region.wallA;
      roofColor = region.roofB;
      break;
    case 'civic':
      wallColor = region.wallA;
      roofColor = region.roofB;
      trimColor = region.trim;
      break;
    case 'barn':
      wallColor = 0x8a4a34;
      roofColor = 0x4a4048;
      break;
    case 'tower':
      wallColor = region.wallA;
      roofColor = region.roofB;
      break;
    case 'office':
      wallColor = 0x8a929c;
      roofColor = 0x3f4450;
      windowColor = 0xa8d0e0;
      break;
    case 'glass':
      wallColor = region.glass;
      roofColor = region.roofB;
      windowColor = 0xc8e8f0;
      break;
    case 'ruin':
      wallColor = 0x7a7268;
      roofColor = 0x5a5248;
      trimColor = 0x4a443c;
      break;
    case 'greenhouse':
      wallColor = 0xa8d0c8;
      roofColor = 0x8ab8b0;
      windowColor = 0xd8f0e8;
      break;
    case 'station':
      wallColor = region.wallB;
      roofColor = region.roofB;
      break;
    case 'warehouse':
      wallColor = 0x8a8a82;
      roofColor = 0x5a5a58;
      break;
    case 'kiosk':
      wallColor = region.wallB;
      roofColor = region.roofA;
      awningColor = region.awningAlt;
      break;
    case 'stage':
      wallColor = 0x8a6a4a;
      roofColor = region.awning;
      break;
    default:
      break;
  }
  const roofHeight = Math.round(spec.height * (spec.style === 'ruin' ? 0.22 : spec.style === 'office' || spec.style === 'glass' ? 0.26 : 0.36));
  const wallTop = spec.y + roofHeight;
  const wallHeight = spec.height - roofHeight;
  const windows: WindowPlan[] = [];
  const cols = Math.max(1, Math.floor((spec.width - 46) / 58));
  const rows = Math.max(1, spec.floors);
  const doorX = spec.x + spec.width / 2;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const wx = spec.x + 24 + (col + 0.5) * ((spec.width - 48) / cols) - 9;
      const wy = wallTop + 12 + row * Math.min(34, wallHeight / rows);
      if (wy + 20 > spec.y + spec.height - 8) continue;
      // Leave the door bay clear on the ground floor.
      if (row === rows - 1 && Math.abs(wx + 9 - doorX) < 40) continue;
      windows.push({ x: Math.round(wx), y: Math.round(wy), width: 18, height: 22, lit: true });
    }
  }
  const building: BuildingPlan = {
    x: spec.x,
    y: spec.y,
    width: spec.width,
    height: spec.height,
    roofHeight,
    wallTop,
    style: spec.style,
    floors: rows,
    wallColor,
    roofColor,
    trimColor,
    windowColor,
    awningColor,
    hasDoor: spec.hasDoor,
    signText: spec.signText,
    seed,
    windows,
  };
  plan.buildings.push(building);
  plan.obstacles.push(rect(spec.x, spec.y + Math.round(roofHeight * 0.6), spec.width, spec.height - Math.round(roofHeight * 0.6)));
  if (spec.hasDoor && spec.style !== 'ruin' && spec.style !== 'greenhouse') {
    plan.lights.push({ x: doorX, y: wallTop + wallHeight - 30, radius: 64, color: region.windowLit, strength: 0.7 });
  }
  return building;
}

function shortLabel(name: string): string {
  const cleaned = name.replace(/^(The|A|An)\s+/i, '');
  if (cleaned.length <= 18) return cleaned.toUpperCase();
  const words = cleaned.split(/\s+/);
  const first = words[0] ?? cleaned;
  return first.slice(0, 18).toUpperCase();
}

// ---------------------------------------------------------------------------
// Generic exterior scaffolding
// ---------------------------------------------------------------------------

function baseExterior(def: LocationDef, ctx: PlanContext, skyHeight = SKY): LocationPlan {
  const walkable = walkableRect(26, skyHeight + 6, W - 26, H - 38);
  const season = ctx.season;
  const kind = ambientKind(season, 0.7);
  return {
    id: def.id,
    name: def.name,
    indoor: false,
    regionId: def.regionId,
    width: W,
    height: H,
    skyHeight,
    ceilingStyle: 'sky',
    ground: [],
    waterZones: [],
    bridges: [],
    buildings: [],
    props: [],
    exits: [],
    door: null,
    facilities: [],
    searchSpot: null,
    obstacles: [],
    lights: [],
    walkable,
    playerSpawn: { x: W / 2, y: skyHeight + (H - skyHeight) * 0.62 },
    npcAnchors: [],
    ambient: {
      petals: kind === 'petal',
      leaves: kind === 'leaf',
      motes: kind === 'mote',
      fireflies: kind === 'firefly',
    },
    interiorStyle: null,
    farmable: isFarmable(def),
  };
}

function isFarmable(def: LocationDef): boolean {
  if (def.kind === 'farm' || def.kind === 'orchard' || def.kind === 'greenhouse') return true;
  if (def.id === 'willowbrook_home') return true;
  return def.facilities.includes('farmland') || def.facilities.includes('greenhouse');
}

function addTree(plan: LocationPlan, x: number, y: number, variant = 0, scale = 1): void {
  const keys = ['prop.tree.round', 'prop.tree.pine', 'prop.tree.round', 'prop.tree.willow'];
  const key = keys[variant % keys.length] ?? 'prop.tree.round';
  plan.props.push(prop(key, x, y, scale));
  plan.obstacles.push(rect(x - 12, y - 12, 24, 14));
}

function addBush(plan: LocationPlan, x: number, y: number, scale = 1): void {
  plan.props.push(prop('prop.bush', x, y, scale));
}

function addFlowers(plan: LocationPlan, x: number, y: number): void {
  plan.props.push(prop('prop.flowerbed', x, y, 1));
}

function addLamp(plan: LocationPlan, x: number, y: number, tall = false): void {
  plan.props.push(prop(tall ? 'prop.lamp.street' : 'prop.lamp.post', x, y, 1));
  plan.lights.push({ x, y: y - 34, radius: 92, color: 0xffd98a, strength: 1 });
}

function addBench(plan: LocationPlan, x: number, y: number, station = false): void {
  plan.props.push(prop(station ? 'prop.bench.station' : 'prop.bench', x, y, 1));
  plan.obstacles.push(rect(x - 22, y - 10, 44, 12));
}

function addFacility(plan: LocationPlan, def: LocationDef, kind: string, x: number, y: number, exterior = false): void {
  const visual = exterior ? exteriorFacilityVisual(kind) : facilityVisual(kind);
  if (!visual) return;
  plan.props.push(prop(visual.prop, x, y, 1));
  plan.obstacles.push(rect(x - 20, y - 12, 40, 16));
  plan.facilities.push({
    kind,
    label: visual.label,
    x,
    y: y - 6,
    prop: visual.prop,
    action: visual.action,
    radius: 58,
  });
}

function addFacilitiesRow(plan: LocationPlan, def: LocationDef, rowY: number): void {
  const list = def.facilities.filter((kind) => exteriorFacilityVisual(kind) !== null);
  const usable = list.slice(0, 4);
  const spacing = usable.length > 1 ? Math.min(260, (W - 360) / (usable.length - 1)) : 0;
  const startX = W / 2 - (spacing * (usable.length - 1)) / 2;
  usable.forEach((kind, index) => {
    const x = startX + spacing * index + seededRange(hashString(plan.id), index, -20, 20);
    addFacility(plan, def, kind, x, rowY + (index % 2) * 36, true);
  });
}

function addSearchSpot(plan: LocationPlan, x: number, y: number): void {
  if (!isFreePoint(plan.obstacles, x, y, 16)) {
    const fallback = clampToWalkable(plan.walkable, x, y, 40);
    plan.searchSpot = { x: fallback.x, y: fallback.y, label: 'Search this place' };
    return;
  }
  plan.searchSpot = { x, y, label: 'Search this place' };
}

function finishExterior(plan: LocationPlan, def: LocationDef, ctx: PlanContext): LocationPlan {
  plan.npcAnchors = buildAnchors(plan);
  placeExits(plan, def, ctx);
  if (plan.searchSpot === null && !def.indoor) {
    const spot = plan.npcAnchors[0];
    if (spot) addSearchSpot(plan, spot.x - 90, spot.y + 20);
  }
  return plan;
}

function makeDoor(plan: LocationPlan, ctx: PlanContext, x: number, y: number, label: string, kind: 'enter' | 'exit'): void {
  if (kind === 'enter' && !ctx.interior) return;
  if (kind === 'exit' && !ctx.entrance) return;
  const toId = kind === 'enter' ? ctx.interior?.id : ctx.entrance?.id;
  if (!toId) return;
  plan.door = { x, y, toId, label, kind };
  plan.lights.push({ x, y: y - 20, radius: 58, color: 0xffd08a, strength: 0.8 });
}

// ---------------------------------------------------------------------------
// Exterior templates
// ---------------------------------------------------------------------------

const CIVIC_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  museum: 'MUSEUM',
  cinema: 'CINEMA',
  library: 'LIBRARY',
  city_library: 'LIBRARY',
  cultural_center: 'CULTURE',
};

function planShopfront(def: LocationDef, ctx: PlanContext): LocationPlan {
  const plan = baseExterior(def, ctx);
  const palette = regionPalette(def.regionId);
  const city = def.regionId === 'ashford' || def.theme === 'city';
  const seed = hashString(def.id);
  plan.ground.push(ground(0, SKY, W, H - SKY, city ? 'pavement' : 'grass'));
  plan.ground.push(ground(0, 300, W, 92, city ? 'pavement' : 'path'));
  if (city) plan.ground.push(ground(0, 282, W, 18, 'cobble'));

  const mainW = 300 + seededInt(seed, 1, 0, 110);
  const mainH = 150 + seededInt(seed, 2, 0, 40);
  const mainX = Math.round(W / 2 - mainW / 2 + seededRange(seed, 3, -30, 30));
  const mainY = SKY - 52;
  const civic = CIVIC_KINDS.has(def.kind);
  const label = CIVIC_LABEL_OVERRIDES[def.kind] ?? shortLabel(def.name);
  addBuilding(plan, def, {
    x: mainX,
    y: mainY,
    width: mainW,
    height: mainH,
    style: civic ? 'civic' : def.kind === 'restaurant' || def.kind === 'city_cafe' ? 'shop' : 'shop',
    floors: civic ? 2 : 1,
    hasDoor: true,
    signText: label,
  });
  // Flanking cottages / shopfronts fill the street.
  const sideW = 190 + seededInt(seed, 4, 0, 50);
  addBuilding(plan, def, { x: 40, y: SKY - 18, width: sideW, height: 130, style: 'cottage', floors: 1, hasDoor: false, signText: null });
  addBuilding(plan, def, {
    x: W - 40 - sideW,
    y: SKY - 26,
    width: sideW,
    height: 140,
    style: city ? 'townhouse' : 'cottage',
    floors: city ? 2 : 1,
    hasDoor: false,
    signText: null,
  });

  const doorX = mainX + mainW / 2;
  const doorY = mainY + mainH;
  makeDoor(plan, ctx, doorX, doorY, ctx.interior?.name ?? 'Door', 'enter');
  // Forecourt + approach path.
  plan.ground.push(ground(mainX - 70, doorY - 6, mainW + 140, 74, city ? 'pavement' : 'cobble'));
  plan.ground.push(ground(0, 366, W, 58, city ? 'pavement' : 'path'));
  if (!city) plan.ground.push(ground(mainX - 60, 300, mainW + 120, 68, 'cobble'));

  plan.props.push(prop('prop.planter', doorX - 96, doorY + 36));
  plan.props.push(prop('prop.planter', doorX + 96, doorY + 36));
  plan.props.push(prop('prop.signpost', doorX - 150, doorY + 68));
  if (city) {
    plan.props.push(prop('prop.bin', doorX + 160, 360));
    plan.props.push(prop('prop.bollard', doorX - 210, 372));
    plan.props.push(prop('prop.bollard', doorX + 230, 372));
    addLamp(plan, 150, 356, true);
    addLamp(plan, W - 150, 356, true);
  } else {
    addLamp(plan, 170, 360);
    addLamp(plan, W - 170, 360);
    addBench(plan, 220, 500);
    addBench(plan, W - 220, 500);
    addTree(plan, 90, 590, 0, 1.1);
    addTree(plan, W - 90, 610, 2, 1.05);
    addBush(plan, 140, 540);
    addBush(plan, W - 150, 540);
    addFlowers(plan, 260, 460);
    addFlowers(plan, W - 270, 460);
  }
  if (def.kind === 'cafe' || def.kind === 'restaurant' || def.kind === 'city_cafe') {
    plan.props.push(prop('prop.table', mainX - 40, doorY + 100));
    plan.props.push(prop('prop.chair', mainX - 74, doorY + 104));
    plan.props.push(prop('prop.chair', mainX - 10, doorY + 104));
    plan.obstacles.push(rect(mainX - 70, doorY + 86, 100, 28));
  }
  if (def.kind === 'bakery' || def.kind === 'grocery' || def.kind === 'supermarket') {
    plan.props.push(prop('prop.crate', mainX + mainW / 2 + 150, doorY + 40));
    plan.props.push(prop('prop.barrel', mainX + mainW / 2 + 188, doorY + 44));
  }
  if (civic) {
    plan.props.push(prop('prop.flagpole', mainX - mainW / 2 - 40, doorY - 10));
    plan.props.push(prop('prop.flagpole', mainX + mainW / 2 + 40, doorY - 10));
  }
  addFacilitiesRow(plan, def, 340);
  addSearchSpot(plan, mainX + mainW + 40, doorY + 120);
  void palette;
  return finishExterior(plan, def, ctx);
}

function planResidential(def: LocationDef, ctx: PlanContext): LocationPlan {
  const plan = baseExterior(def, ctx);
  const city = def.regionId === 'ashford' || def.theme === 'city';
  const seed = hashString(def.id);
  plan.ground.push(ground(0, SKY, W, H - SKY, city ? 'pavement' : 'grass'));
  plan.ground.push(ground(0, 392, W, 84, city ? 'road' : 'path'));
  plan.ground.push(ground(0, 470, W, 44, city ? 'pavement' : 'grass'));
  if (city) plan.ground.push(ground(0, 370, W, 22, 'cobble'));

  const enterable = ctx.interior !== null && def.kind === 'residence';
  const cottageCount = def.kind === 'apartments' ? 1 : 3;
  const cottageWidth = def.kind === 'apartments' ? 520 : 292;
  const gap = def.kind === 'apartments' ? 0 : 106;
  const totalWidth = cottageCount * cottageWidth + (cottageCount - 1) * gap;
  const startX = Math.round((W - totalWidth) / 2);
  for (let index = 0; index < cottageCount; index += 1) {
    const x = startX + index * (cottageWidth + gap);
    const height = def.kind === 'apartments' ? 232 : 148 + seededInt(seed, index, 0, 24);
    const isEnterable = enterable && index === 1;
    const label = def.kind === 'apartments' ? 'APARTMENTS' : isEnterable ? shortLabel(def.name) : null;
    addBuilding(plan, def, {
      x,
      y: SKY - 30,
      width: cottageWidth,
      height,
      style: def.kind === 'apartments' ? 'townhouse' : city ? 'townhouse' : 'cottage',
      floors: def.kind === 'apartments' ? 3 : city ? 2 : 1,
      hasDoor: isEnterable || (def.kind !== 'apartments' && index !== 1),
      signText: label,
    });
    const doorY = SKY - 30 + height;
    if (isEnterable) makeDoor(plan, ctx, x + cottageWidth / 2, doorY, ctx.interior?.name ?? 'Home', 'enter');
    if (!city) {
      addFlowers(plan, x + 40, doorY + 26);
      addFlowers(plan, x + cottageWidth - 40, doorY + 26);
      plan.props.push(prop('prop.mailbox', x + 26, doorY + 54));
      plan.props.push(prop('prop.fence', x + cottageWidth - 70, doorY + 60, 1));
      addBush(plan, x + 12, doorY + 44);
    } else {
      plan.props.push(prop('prop.bin', x + 34, doorY + 40));
      plan.props.push(prop('prop.bollard', x + cottageWidth - 30, doorY + 44));
    }
  }
  if (def.kind === 'apartments') {
    plan.ground.push(ground(startX - 90, 470, totalWidth + 180, 160, 'cobble'));
    plan.props.push(prop('prop.fountain', W / 2, 560, 0.8));
    plan.obstacles.push(rect(W / 2 - 30, 540, 60, 34));
    addBench(plan, W / 2 - 150, 620);
    addBench(plan, W / 2 + 150, 620);
  }
  addLamp(plan, 110, 420, city);
  addLamp(plan, W - 110, 420, city);
  addLamp(plan, W / 2, 392, city);
  if (city) {
    plan.props.push(prop('prop.car', 330, 448));
    plan.props.push(prop('prop.car', W - 330, 448, 1, true));
    plan.obstacles.push(rect(260, 420, 150, 34));
    plan.obstacles.push(rect(W - 410, 420, 150, 34));
    plan.props.push(prop('prop.busstop', 90, 486));
  } else {
    addBench(plan, W / 2 + 120, 520);
    addTree(plan, 80, 660, 0, 1.15);
    addTree(plan, W - 80, 680, 2, 1.1);
    addBush(plan, W - 160, 620);
    // shared clothesline between the cottages
    plan.props.push(prop('prop.fence', 300, 372, 1));
  }
  addFacilitiesRow(plan, def, 520);
  addSearchSpot(plan, W / 2 + 220, 560);
  return finishExterior(plan, def, ctx);
}

function planSquare(def: LocationDef, ctx: PlanContext): LocationPlan {
  const plan = baseExterior(def, ctx);
  const seed = hashString(def.id);
  const city = def.regionId === 'ashford';
  plan.ground.push(ground(0, SKY, W, H - SKY, city ? 'pavement' : 'grass'));
  plan.ground.push(ground(140, 296, W - 280, 330, city ? 'plaza' : 'cobble'));
  plan.ground.push(ground(0, 430, W, 76, city ? 'pavement' : 'path'));
  plan.ground.push(ground(W / 2 - 42, 196, 84, 240, city ? 'plaza' : 'cobble'));

  const civic = def.kind === 'town_center';
  if (civic) {
    addBuilding(plan, def, { x: W / 2 - 96, y: SKY - 62, width: 192, height: 200, style: 'tower', floors: 3, hasDoor: true, signText: 'CLOCK TOWER' });
    makeDoor(plan, ctx, W / 2, SKY + 138, ctx.interior?.name ?? 'Clock tower', 'enter');
  } else if (def.kind === 'event_square') {
    addBuilding(plan, def, { x: W / 2 - 210, y: SKY + 6, width: 420, height: 118, style: 'stage', floors: 1, hasDoor: false, signText: 'EVENT SQUARE' });
    addBuilding(plan, def, { x: 60, y: SKY - 20, width: 260, height: 140, style: 'cottage', floors: 1, hasDoor: false, signText: null });
    addBuilding(plan, def, { x: W - 320, y: SKY - 26, width: 260, height: 146, style: city ? 'townhouse' : 'cottage', floors: city ? 2 : 1, hasDoor: false, signText: null });
  } else {
    addBuilding(plan, def, { x: 56, y: SKY - 24, width: 252, height: 150, style: city ? 'office' : 'cottage', floors: city ? 2 : 1, hasDoor: false, signText: null });
    addBuilding(plan, def, { x: W - 308, y: SKY - 30, width: 252, height: 156, style: city ? 'office' : 'townhouse', floors: city ? 2 : 1, hasDoor: false, signText: null });
    addBuilding(plan, def, { x: W / 2 - 170, y: SKY - 10, width: 340, height: 128, style: 'shop', floors: 1, hasDoor: true, signText: shortLabel(def.name) });
    makeDoor(plan, ctx, W / 2, SKY + 118, ctx.interior?.name ?? 'Hall', 'enter');
    void seed;
  }
  // Central landmark.
  if (def.kind === 'market') {
    for (let index = 0; index < 6; index += 1) {
      const x = 300 + (index % 3) * 320 + seededRange(seed, index, -24, 24);
      const y = 400 + Math.floor(index / 3) * 130;
      plan.props.push(prop('prop.stall', x, y));
      plan.obstacles.push(rect(x - 34, y - 20, 68, 22));
    }
    plan.props.push(prop('prop.crate', W / 2, 560));
  } else if (def.kind === 'plaza') {
    plan.props.push(prop('prop.fountain', W / 2, 470, 1.1));
    plan.obstacles.push(rect(W / 2 - 36, 446, 72, 38));
  } else if (def.kind === 'event_square') {
    plan.props.push(prop('prop.statue', 260, 480));
    plan.obstacles.push(rect(240, 458, 40, 26));
  } else {
    plan.props.push(prop('prop.fountain', W / 2, 458, 1));
    plan.obstacles.push(rect(W / 2 - 34, 436, 68, 36));
    plan.props.push(prop('prop.statue', W / 2 - 230, 500));
    plan.obstacles.push(rect(W / 2 - 248, 478, 36, 26));
  }
  for (let index = 0; index < 4; index += 1) {
    const x = 230 + index * 280;
    addBench(plan, x, 640);
    addLamp(plan, x - 80, 610, city);
    addFlowers(plan, x + 60, 560);
  }
  addTree(plan, 40, 620, 0, 1.1);
  addTree(plan, W - 40, 640, 2, 1.05);
  plan.props.push(prop('prop.noticeboard', 190, 540));
  addFacilitiesRow(plan, def, 560);
  addSearchSpot(plan, W / 2 + 180, 600);
  return finishExterior(plan, def, ctx);
}

function planPark(def: LocationDef, ctx: PlanContext): LocationPlan {
  const plan = baseExterior(def, ctx);
  const city = def.kind === 'city_park';
  plan.ground.push(ground(0, SKY, W, H - SKY, 'grass'));
  // Winding path.
  const paths: RectPlan[] = [
    { x: 0, y: 470, width: 520, height: 66 },
    { x: 360, y: 320, width: 66, height: 210 },
    { x: 360, y: 320, width: 560, height: 66 },
    { x: 860, y: 214, width: 66, height: 172 },
    { x: 860, y: 214, width: 420, height: 66 },
  ];
  for (const path of paths) plan.ground.push(ground(path.x, path.y, path.width, path.height, city ? 'pavement' : 'path'));
  // Pond.
  if (!city) {
    plan.ground.push(ground(930, 470, 280, 168, 'water'));
    plan.waterZones.push({ x: 930, y: 470, width: 280, height: 168 });
    plan.obstacles.push({ x: 930, y: 470, width: 280, height: 168 });
    plan.props.push(prop('prop.dock', 900, 560));
    plan.props.push(prop('prop.lily', 1000, 540));
    plan.props.push(prop('prop.lily', 1080, 590));
    plan.props.push(prop('prop.reed', 940, 486));
    plan.props.push(prop('prop.reed', 1180, 520));
    addTree(plan, 1210, 690, 3, 1.2);
    addTree(plan, 880, 690, 0, 1.1);
  }
  // Trees fill the grass, avoiding paths.
  const seed = hashString(def.id);
  for (let index = 0; index < 18; index += 1) {
    const x = seededRange(seed, index * 3, 40, W - 40);
    const y = seededRange(seed, index * 3 + 1, 190, H - 60);
    let onPath = false;
    for (const path of paths) {
      if (x > path.x - 40 && x < path.x + path.width + 40 && y > path.y - 40 && y < path.y + path.height + 40) onPath = true;
    }
    if (onPath) continue;
    const kind = seededInt(seed, index + 300, 0, 3);
    if (kind === 0) addBush(plan, x, y);
    else if (kind === 1) plan.props.push(prop('prop.tallgrass', x, y));
    else if (kind === 2) plan.props.push(prop('prop.rock', x, y));
    else addTree(plan, x, y, seededInt(seed, index + 400, 0, 3), 0.95 + seededValue(seed, index) * 0.3);
  }
  addTree(plan, 60, 260, 1, 1.2);
  addTree(plan, 120, 220, 0, 1.05);
  addBush(plan, 200, 300);
  addFlowers(plan, 250, 420);
  addFlowers(plan, 700, 470);
  addBench(plan, 300, 560);
  addBench(plan, 660, 356);
  addBench(plan, 1000, 260);
  addLamp(plan, 220, 480);
  addLamp(plan, 900, 300);
  if (city) {
    plan.props.push(prop('prop.fountain', W / 2, 520, 1));
    plan.obstacles.push(rect(W / 2 - 34, 496, 68, 38));
    plan.props.push(prop('prop.flowerbed', 520, 620));
    plan.props.push(prop('prop.flowerbed', 760, 620));
  }
  plan.props.push(prop('prop.noticeboard', 470, 400));
  if (ctx.season === 'winter') plan.props.push(prop('prop.snowman', 780, 620));
  addFacilitiesRow(plan, def, 620);
  addSearchSpot(plan, 700, 620);
  return finishExterior(plan, def, ctx);
}

function planWater(def: LocationDef, ctx: PlanContext): LocationPlan {
  const plan = baseExterior(def, ctx);
  const lake = def.kind === 'lake';
  const waterTop = 200;
  const waterHeight = 218;
  const bridgeX = 600;
  const bridgeWidth = 96;
  plan.ground.push(ground(0, SKY, W, H - SKY, 'grass'));
  plan.ground.push(ground(0, SKY, W, waterTop - SKY, 'path'));
  if (lake) plan.ground.push(ground(120, waterTop, W - 240, waterHeight, 'water'));
  else plan.ground.push(ground(0, waterTop, W, waterHeight, 'water'));
  plan.ground.push(ground(0, waterTop + waterHeight, W, 74, 'path'));
  const waterX = lake ? 120 : 0;
  const waterW = lake ? W - 240 : W;
  plan.waterZones.push({ x: waterX, y: waterTop, width: waterW, height: waterHeight });
  // Bridge splits the water into two collision rects.
  plan.bridges.push({ x: bridgeX, y: waterTop - 8, width: bridgeWidth, height: waterHeight + 16 });
  plan.obstacles.push(rect(waterX, waterTop, bridgeX - waterX, waterHeight));
  plan.obstacles.push(rect(bridgeX + bridgeWidth, waterTop, waterX + waterW - (bridgeX + bridgeWidth), waterHeight));
  addLamp(plan, bridgeX - 30, waterTop + 10);
  addLamp(plan, bridgeX + bridgeWidth + 30, waterTop + 10);
  for (let index = 0; index < 10; index += 1) {
    const x = 60 + index * 120 + seededRange(hashString(def.id), index, -20, 20);
    if (x > bridgeX - 60 && x < bridgeX + bridgeWidth + 60) continue;
    plan.props.push(prop('prop.reed', x, waterTop + 6));
    plan.props.push(prop('prop.reed', x + 26, waterTop + waterHeight - 8));
  }
  addTree(plan, 150, waterTop, 3, 1.15);
  addTree(plan, 1130, waterTop + waterHeight + 20, 3, 1.1);
  addTree(plan, 240, waterTop + waterHeight + 60, 0, 1.05);
  addTree(plan, W - 240, waterTop + waterHeight + 60, 2, 1.1);
  addBush(plan, 60, waterTop + waterHeight + 40);
  addBush(plan, W - 60, waterTop + waterHeight + 40);
  if (lake) {
    plan.props.push(prop('prop.boat', 980, waterTop + 120));
    plan.props.push(prop('prop.lily', 880, waterTop + 80));
    plan.props.push(prop('prop.lily', 1040, waterTop + 170));
  } else {
    plan.props.push(prop('prop.boat', 200, waterTop + 130, 1));
    plan.props.push(prop('prop.lily', 320, waterTop + 60));
  }
  plan.props.push(prop('prop.dock', bridgeX + bridgeWidth + 60, waterTop + waterHeight + 14));
  plan.props.push(prop('prop.fence', 80, waterTop + waterHeight + 66, 1));
  plan.props.push(prop('prop.fence', W - 200, waterTop + waterHeight + 66, 1));
  addBench(plan, 380, waterTop + waterHeight + 120);
  addBench(plan, 900, waterTop + waterHeight + 120);
  addLamp(plan, 700, waterTop + waterHeight + 90);
  if (def.kind === 'riverside_walk') {
    for (let index = 0; index < 5; index += 1) {
      plan.props.push(prop('prop.railfence', 140 + index * 220, waterTop + waterHeight + 84, 1));
      addBench(plan, 200 + index * 220, waterTop + waterHeight + 140);
    }
    addLamp(plan, 300, waterTop + waterHeight + 130, true);
    addLamp(plan, 1000, waterTop + waterHeight + 130, true);
  }
  addFacilitiesRow(plan, def, waterTop + waterHeight + 110);
  // Fishing spot goes on the bank, not in the middle of the walkway.
  addFacility(plan, def, 'fishing_spot', bridgeX + bridgeWidth + 60, waterTop + waterHeight + 18, true);
  addSearchSpot(plan, 420, waterTop + waterHeight + 130);
  return finishExterior(plan, def, ctx);
}

function planForest(def: LocationDef, ctx: PlanContext): LocationPlan {
  const plan = baseExterior(def, ctx);
  plan.ground.push(ground(0, SKY, W, H - SKY, 'grass'));
  const trails: RectPlan[] = [
    { x: 560, y: 620, width: 90, height: 116 },
    { x: 520, y: 480, width: 130, height: 90 },
    { x: 600, y: 380, width: 230, height: 80 },
    { x: 750, y: 290, width: 80, height: 130 },
    { x: 660, y: 236, width: 170, height: 66 },
  ];
  for (const trail of trails) plan.ground.push(ground(trail.x, trail.y, trail.width, trail.height, 'path'));
  if (def.kind === 'secret_path') {
    plan.ground.push(ground(0, SKY, 520, H - SKY, 'grass'));
    plan.ground.push(ground(700, SKY, W - 700, H - SKY, 'grass'));
    for (const trail of [
      { x: 520, y: 128, width: 90, height: 240 },
      { x: 560, y: 360, width: 90, height: 220 },
      { x: 640, y: 560, width: 120, height: 120 },
    ]) {
      plan.ground.push(ground(trail.x, trail.y, trail.width, trail.height, 'path'));
    }
    for (let index = 0; index < 7; index += 1) {
      plan.props.push(prop('prop.bramble', 470, 220 + index * 66));
      plan.props.push(prop('prop.bramble', 660, 180 + index * 70));
    }
  }
  const seed = hashString(def.id);
  const treeCount = def.kind === 'secret_path' ? 10 : 26;
  for (let index = 0; index < treeCount; index += 1) {
    const x = seededRange(seed, index * 5, 30, W - 30);
    const y = seededRange(seed, index * 5 + 1, 150, H - 40);
    const variant = seededInt(seed, index * 5 + 2, 0, 3);
    let onPath = false;
    for (const trail of trails) {
      if (x > trail.x - 26 && x < trail.x + trail.width + 26 && y > trail.y - 26 && y < trail.y + trail.height + 26) onPath = true;
    }
    if (onPath) continue;
    if (variant === 0) addBush(plan, x, y, 1 + seededValue(seed, index) * 0.4);
    else if (variant === 1) plan.props.push(prop('prop.mushroom', x, y, 1));
    else if (variant === 2) plan.props.push(prop('prop.stump', x, y, 1));
    else addTree(plan, x, y, seededInt(seed, index + 200, 0, 3), 0.95 + seededValue(seed, index * 3) * 0.35);
  }
  addTree(plan, 40, 190, 1, 1.2);
  addTree(plan, W - 40, 200, 0, 1.2);
  addTree(plan, 90, 660, 3, 1.1);
  addTree(plan, W - 90, 670, 1, 1.1);
  plan.props.push(prop('prop.rock', 900, 620));
  plan.props.push(prop('prop.flowers', 430, 600));
  plan.props.push(prop('prop.tallgrass', 760, 640));
  plan.props.push(prop('prop.noticeboard', 620, 300));
  addFacilitiesRow(plan, def, 560);
  addSearchSpot(plan, 480, 640);
  return finishExterior(plan, def, ctx);
}

function planOrchard(def: LocationDef, ctx: PlanContext): LocationPlan {
  const plan = baseExterior(def, ctx);
  plan.ground.push(ground(0, SKY, W, H - SKY, 'grass'));
  plan.ground.push(ground(0, 420, W, 70, 'path'));
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      plan.props.push(prop('prop.tree.apple', 180 + col * 220, 250 + row * 90, 0.95));
      plan.obstacles.push(rect(168 + col * 220, 238 + row * 90, 24, 14));
    }
  }
  for (let index = 0; index < 4; index += 1) {
    plan.props.push(prop('prop.fence', 120 + index * 280, 360, 1));
  }
  plan.props.push(prop('prop.crate', 1080, 400));
  plan.props.push(prop('prop.cart', 420, 380, 1));
  plan.obstacles.push(rect(392, 366, 56, 20));
  plan.props.push(prop('prop.bush', 60, 260));
  plan.props.push(prop('prop.bush', W - 60, 260));
  addLamp(plan, 640, 440);
  addBench(plan, 900, 520);
  addFacilitiesRow(plan, def, 540);
  addSearchSpot(plan, 280, 600);
  return finishExterior(plan, def, ctx);
}

function planFarm(def: LocationDef, ctx: PlanContext): LocationPlan {
  const plan = baseExterior(def, ctx);
  plan.ground.push(ground(0, SKY, W, H - SKY, 'grass'));
  if (def.kind === 'greenhouse') {
    plan.ground.push(ground(0, 430, W, 70, 'path'));
    const greenhouse = addBuilding(plan, def, {
      x: W / 2 - 190,
      y: SKY - 4,
      width: 380,
      height: 168,
      style: 'greenhouse',
      floors: 1,
      hasDoor: true,
      signText: 'GREENHOUSE',
    });
    makeDoor(plan, ctx, greenhouse.x + greenhouse.width / 2, greenhouse.y + greenhouse.height, ctx.interior?.name ?? 'Greenhouse', 'enter');
    plan.ground.push(ground(W / 2 - 240, greenhouse.y + greenhouse.height, 480, 64, 'soil'));
    for (let index = 0; index < 4; index += 1) {
      plan.props.push(prop('prop.planter', 400 + index * 150, 330));
      plan.props.push(prop('prop.pot', 460 + index * 150, 360));
    }
    plan.props.push(prop('prop.watercan', 340, 356));
    plan.props.push(prop('prop.bucket', 930, 356));
    addFacilitiesRow(plan, def, 520);
    addSearchSpot(plan, 320, 560);
    return finishExterior(plan, def, ctx);
  }
  plan.ground.push(ground(0, 420, W, 74, 'path'));
  const barn = addBuilding(plan, def, {
    x: 70,
    y: SKY - 46,
    width: 300,
    height: 178,
    style: 'barn',
    floors: 1,
    hasDoor: true,
    signText: 'BARN',
  });
  makeDoor(plan, ctx, barn.x + barn.width / 2, barn.y + barn.height, ctx.interior?.name ?? 'Barn', 'enter');
  addBuilding(plan, def, { x: W - 350, y: SKY - 16, width: 280, height: 140, style: 'cottage', floors: 1, hasDoor: false, signText: null });
  // Crop fields.
  const fields: RectPlan[] = [
    { x: 430, y: 300, width: 320, height: 190 },
    { x: 430, y: 530, width: 320, height: 150 },
    { x: 800, y: 300, width: 320, height: 190 },
    { x: 800, y: 530, width: 320, height: 150 },
  ];
  for (const field of fields) {
    plan.ground.push(ground(field.x, field.y, field.width, field.height, 'field'));
    plan.props.push(prop('prop.fence', field.x + 8, field.y + field.height + 8, 1));
  }
  for (let index = 0; index < 3; index += 1) {
    plan.props.push(prop('prop.hay', 390 + index * 40, 500, 1));
    plan.obstacles.push(rect(376 + index * 40, 488, 28, 16));
  }
  plan.props.push(prop('prop.scarecrow', 660, 500));
  plan.obstacles.push(rect(652, 486, 18, 16));
  plan.props.push(prop('prop.cart', 760, 470, 1));
  plan.obstacles.push(rect(732, 456, 56, 20));
  plan.props.push(prop('prop.crate', 400, 286));
  addTree(plan, 120, 640, 0, 1.1);
  addTree(plan, W - 80, 640, 2, 1.05);
  addLamp(plan, W - 140, 470);
  addFacilitiesRow(plan, def, 500);
  addSearchSpot(plan, 380, 600);
  return finishExterior(plan, def, ctx);
}

function planCountryside(def: LocationDef, ctx: PlanContext): LocationPlan {
  const plan = baseExterior(def, ctx);
  plan.ground.push(ground(0, SKY, W, H - SKY, 'grass'));
  plan.ground.push(ground(0, 450, W, 76, 'path'));
  plan.ground.push(ground(0, 560, W, 176, 'grass'));
  if (def.kind === 'abandoned_farmhouse') {
    const ruin = addBuilding(plan, def, { x: 120, y: SKY - 20, width: 340, height: 168, style: 'ruin', floors: 1, hasDoor: false, signText: null });
    makeDoor(plan, ctx, ruin.x + ruin.width / 2, ruin.y + ruin.height, ctx.interior?.name ?? 'Ruined farmhouse', 'enter');
    plan.props.push(prop('prop.well', 700, 400, 1));
    plan.obstacles.push(rect(676, 380, 48, 30));
    for (let index = 0; index < 6; index += 1) {
      plan.props.push(prop('prop.bramble', 540 + index * 90, 320 + (index % 2) * 40));
    }
    plan.props.push(prop('prop.crate', 880, 430));
    plan.props.push(prop('prop.barrel', 940, 430));
    addTree(plan, 80, 640, 3, 1.2);
  } else if (def.kind === 'warehouse') {
    const warehouse = addBuilding(plan, def, {
      x: W / 2 - 230,
      y: SKY - 40,
      width: 460,
      height: 184,
      style: 'warehouse',
      floors: 1,
      hasDoor: true,
      signText: 'WAREHOUSE',
    });
    makeDoor(plan, ctx, warehouse.x + warehouse.width / 2, warehouse.y + warehouse.height, ctx.interior?.name ?? 'Warehouse', 'enter');
    for (let index = 0; index < 5; index += 1) {
      plan.props.push(prop('prop.crate', 250 + index * 180, 400, 1));
      plan.obstacles.push(rect(236 + index * 180, 388, 28, 16));
    }
    plan.props.push(prop('prop.barrel', 320, 470));
    plan.props.push(prop('prop.sack', 480, 470));
    plan.props.push(prop('prop.railfence', 80, 500, 1));
  } else if (def.kind === 'exploration_area') {
    plan.props.push(prop('prop.well', W / 2, 430, 1.25));
    plan.obstacles.push(rect(W / 2 - 34, 404, 68, 34));
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      plan.props.push(prop('prop.rock', W / 2 + Math.cos(angle) * 150, 430 + Math.sin(angle) * 90, 1));
    }
    addTree(plan, 160, 280, 0, 1.2);
    addTree(plan, W - 160, 300, 1, 1.15);
    addTree(plan, 220, 650, 2, 1.1);
  } else {
    plan.props.push(prop('prop.stonewall', 200, 300, 1));
    plan.props.push(prop('prop.stonewall', 400, 300, 1));
    plan.props.push(prop('prop.stonewall', 700, 320, 1));
    for (let index = 0; index < 5; index += 1) {
      addTree(plan, 90 + index * 260, 250 + (index % 3) * 50, index % 4, 1 + (index % 3) * 0.08);
    }
    plan.props.push(prop('prop.well', 1050, 600, 1));
    plan.obstacles.push(rect(1026, 580, 48, 30));
    for (let index = 0; index < 4; index += 1) {
      plan.props.push(prop('prop.bramble', 300 + index * 160, 620));
    }
  }
  addBush(plan, 60, 400);
  addBush(plan, W - 60, 400);
  addBench(plan, 600, 600);
  addLamp(plan, 980, 460);
  addFacilitiesRow(plan, def, 620);
  addSearchSpot(plan, 760, 660);
  return finishExterior(plan, def, ctx);
}

function planStation(def: LocationDef, ctx: PlanContext): LocationPlan {
  const plan = baseExterior(def, ctx);
  const seed = hashString(def.id + ':station');
  plan.ground.push(ground(0, SKY, W, H - SKY, 'pavement'));
  plan.ground.push(ground(0, 140, W, 56, 'rail'));
  plan.ground.push(ground(0, 196, W, 104, 'stone'));
  for (let index = 0; index < 6; index += 1) {
    plan.props.push(prop('prop.bench.station', 170 + index * 180 + seededRange(seed, index, -16, 16), 274 + seededRange(seed, index + 10, -6, 6), 1));
  }
  const station = addBuilding(plan, def, {
    x: 80,
    y: SKY - 54,
    width: 400,
    height: 158,
    style: 'station',
    floors: 1,
    hasDoor: true,
    signText: 'STATION',
  });
  makeDoor(plan, ctx, station.x + station.width / 2, station.y + station.height, ctx.interior?.name ?? 'Station', 'enter');
  addBuilding(plan, def, { x: W - 360, y: SKY - 20, width: 280, height: 132, style: 'warehouse', floors: 1, hasDoor: false, signText: 'GOODS' });
  plan.props.push(prop('prop.stationboard', 620 + seededRange(seed, 20, -30, 30), 300, 1));
  plan.props.push(prop('prop.crate', 1000 + seededRange(seed, 21, -20, 20), 320));
  plan.props.push(prop('prop.crate', 1040 + seededRange(seed, 22, -20, 20), 322));
  plan.props.push(prop('prop.barrel', 1090 + seededRange(seed, 23, -20, 20), 320));
  plan.props.push(prop('prop.luggage', 540, 290));
  for (let index = 0; index < 4; index += 1) addLamp(plan, 200 + index * 280, 292, true);
  addTree(plan, 60, 640, 0, 1.1);
  addTree(plan, W - 60, 650, 2, 1.1);
  addBench(plan, 300, 560);
  addBench(plan, 900, 560);
  for (let index = 0; index < 5; index += 1) {
    plan.props.push(prop('prop.railfence', 120 + index * 240, 404, 1));
  }
  addFacility(plan, def, 'train', 620, 286, true);
  addSearchSpot(plan, 420, 560);
  return finishExterior(plan, def, ctx);
}

function planCityStreet(def: LocationDef, ctx: PlanContext): LocationPlan {
  const plan = baseExterior(def, ctx);
  const palette = regionPalette('ashford');
  plan.ground.push(ground(0, SKY, W, H - SKY, 'pavement'));
  plan.ground.push(ground(0, 306, W, 136, 'road'));
  plan.ground.push(ground(0, 442, W, 30, 'pavement'));
  plan.ground.push(ground(0, 560, W, 90, 'road'));
  plan.ground.push(ground(520, 306, 120, 136, 'crossing'));
  // North row of tall buildings.
  const styles: BuildingStyle[] = def.kind === 'office_district' ? ['office', 'glass', 'office', 'glass'] : ['townhouse', 'shop', 'townhouse', 'shop'];
  const widths = [246, 274, 246, 260];
  let x = 70;
  for (let index = 0; index < 4; index += 1) {
    const width = widths[index] ?? 280;
    const height = 170 + (index % 2) * 46;
    const isCivic = index === 1;
    const building = addBuilding(plan, def, {
      x,
      y: SKY - 40,
      width,
      height,
      style: styles[index] ?? 'townhouse',
      floors: index % 2 === 0 ? 3 : 2,
      hasDoor: isCivic,
      signText: isCivic ? shortLabel(def.name) : null,
    });
    if (isCivic) makeDoor(plan, ctx, building.x + building.width / 2, building.y + building.height, ctx.interior?.name ?? 'Shop', 'enter');
    x += width + 34;
  }
  // Street furniture.
  for (let index = 0; index < 5; index += 1) {
    plan.props.push(prop('prop.bollard', 120 + index * 180, 470));
    addLamp(plan, 80 + index * 260, 480, true);
  }
  plan.props.push(prop('prop.trafficlight', 560, 300));
  plan.props.push(prop('prop.trafficlight', 660, 440, 1, true));
  plan.props.push(prop('prop.busstop', 1080, 470));
  plan.props.push(prop('prop.bin', 300, 474));
  plan.props.push(prop('prop.bin', 860, 474));
  plan.props.push(prop('prop.car', 300, 400));
  plan.props.push(prop('prop.car', 900, 400, 1, true));
  plan.obstacles.push(rect(230, 372, 150, 34));
  plan.obstacles.push(rect(W - 380, 372, 150, 34));
  plan.props.push(prop('prop.flowerbed', 160, 620));
  plan.props.push(prop('prop.flowerbed', 1100, 620));
  plan.props.push(prop('prop.bench', 420, 630));
  plan.props.push(prop('prop.bench', 820, 630));
  addTree(plan, 60, 690, 0, 1.05);
  addTree(plan, W - 60, 690, 2, 1.05);
  if (def.kind === 'commercial_street' || def.kind === 'cultural_center') {
    plan.props.push(prop('prop.stall', 700, 300));
    plan.props.push(prop('prop.stall', 840, 300));
    plan.obstacles.push(rect(666, 286, 68, 22));
    plan.obstacles.push(rect(806, 286, 68, 22));
  }
  addFacilitiesRow(plan, def, 530);
  addSearchSpot(plan, 120, 640);
  void palette;
  return finishExterior(plan, def, ctx);
}

function planArcade(def: LocationDef, ctx: PlanContext): LocationPlan {
  const plan = baseExterior(def, ctx, 0);
  plan.ceilingStyle = 'glass';
  plan.walkable = walkableRect(40, 150, W - 40, H - 50);
  plan.playerSpawn = { x: W / 2, y: H * 0.62 };
  plan.ground.push(ground(0, 0, W, H, 'mall'));
  plan.ground.push(ground(0, 170, W, 70, 'stone'));
  plan.ground.push(ground(0, 520, W, 90, 'stone'));
  // Shop fronts along the north wall.
  let x = 60;
  for (let index = 0; index < 5; index += 1) {
    addBuilding(plan, def, {
      x,
      y: 30,
      width: 226,
      height: 128,
      style: 'shop',
      floors: 1,
      hasDoor: false,
      signText: ['FASHION', 'BOOKS', 'TOYS', 'CAFE', 'TECH'][index] ?? null,
    });
    x += 230;
  }
  // Kiosks and furniture fill the concourse.
  for (let index = 0; index < 4; index += 1) {
    plan.props.push(prop('prop.kiosk', 160 + index * 320, 560));
    plan.obstacles.push(rect(120 + index * 320, 536, 80, 28));
  }
  plan.props.push(prop('prop.planter', 300, 640));
  plan.props.push(prop('prop.planter', 980, 640));
  plan.props.push(prop('prop.fountain', W / 2, 420, 0.9));
  plan.obstacles.push(rect(W / 2 - 28, 400, 56, 32));
  addBench(plan, 420, 500);
  addBench(plan, 860, 500);
  plan.props.push(prop('prop.plant', 200, 260));
  plan.props.push(prop('prop.plant', W - 200, 260));
  plan.props.push(prop('prop.noticeboard', 120, 300));
  addFacilitiesRow(plan, def, 350);
  addLamp(plan, 260, 300);
  addLamp(plan, W - 260, 300);
  addSearchSpot(plan, 640, 620);
  return finishExterior(plan, def, ctx);
}

// ---------------------------------------------------------------------------
// Interior template
// ---------------------------------------------------------------------------

interface InteriorTemplate {
  wallStyle: WallStyle;
  floorMaterial: GroundMaterial;
  furniture: { key: string; x: number; y: number; scale?: number }[];
  facilitySlots: { kind: string; x: number; y: number }[];
}

function interiorTemplate(def: LocationDef, ctx: PlanContext): InteriorTemplate {
  const facilities = def.facilities;
  const has = (kind: FacilityKind): boolean => facilities.includes(kind);
  if (has('bed')) {
    return {
      wallStyle: 'plaster',
      floorMaterial: 'wood',
      furniture: [
        { key: 'prop.bed', x: 190, y: 262, scale: 1.1 },
        { key: 'prop.kitchen', x: 470, y: 236 },
        { key: 'prop.stove', x: 640, y: 236 },
        { key: 'prop.workbench', x: 880, y: 240 },
        { key: 'prop.shelves', x: 1060, y: 240 },
        { key: 'prop.fireplace', x: 320, y: 470 },
        { key: 'prop.rug', x: 640, y: 470 },
        { key: 'prop.table', x: 640, y: 452 },
        { key: 'prop.chair', x: 590, y: 470 },
        { key: 'prop.chair', x: 690, y: 470 },
        { key: 'prop.plant', x: 1120, y: 470 },
        { key: 'prop.painting', x: 760, y: 150 },
      ],
      facilitySlots: [
        { kind: 'bed', x: 190, y: 278 },
        { kind: 'kitchen', x: 470, y: 252 },
        { kind: 'workbench', x: 880, y: 256 },
        { kind: 'heater', x: 320, y: 486 },
        { kind: 'storage', x: 1060, y: 256 },
      ],
    };
  }
  if (has('library') || def.kind === 'library' || def.kind === 'city_library') {
    return {
      wallStyle: 'plaster',
      floorMaterial: 'wood',
      furniture: [
        { key: 'prop.shelves', x: 260, y: 240 },
        { key: 'prop.shelves', x: 420, y: 240 },
        { key: 'prop.shelves', x: 580, y: 240 },
        { key: 'prop.shelves', x: 740, y: 240 },
        { key: 'prop.shelves', x: 900, y: 240 },
        { key: 'prop.rug', x: 640, y: 480 },
        { key: 'prop.table', x: 560, y: 470 },
        { key: 'prop.chair', x: 500, y: 480 },
        { key: 'prop.chair', x: 620, y: 480 },
        { key: 'prop.table', x: 800, y: 560 },
        { key: 'prop.chair', x: 760, y: 570 },
        { key: 'prop.plant', x: 1120, y: 300 },
        { key: 'prop.bookstack', x: 340, y: 500 },
      ],
      facilitySlots: [
        { kind: 'library', x: 640, y: 260 },
        { kind: 'workbench', x: 1050, y: 600 },
      ],
    };
  }
  if (has('museum') || def.kind === 'museum') {
    return {
      wallStyle: 'brick',
      floorMaterial: 'stone',
      furniture: [
        { key: 'prop.displaycase', x: 260, y: 280 },
        { key: 'prop.displaycase', x: 480, y: 280 },
        { key: 'prop.displaycase', x: 700, y: 280 },
        { key: 'prop.displaycase', x: 920, y: 280 },
        { key: 'prop.pedestal', x: 360, y: 480 },
        { key: 'prop.pedestal', x: 640, y: 480 },
        { key: 'prop.pedestal', x: 920, y: 480 },
        { key: 'prop.painting', x: 300, y: 160 },
        { key: 'prop.painting', x: 800, y: 160 },
        { key: 'prop.plant', x: 1120, y: 600 },
      ],
      facilitySlots: [{ kind: 'museum', x: 640, y: 300 }],
    };
  }
  if (has('train') || def.kind === 'train_station') {
    return {
      wallStyle: 'plaster',
      floorMaterial: 'stone',
      furniture: [
        { key: 'prop.counter', x: 340, y: 260 },
        { key: 'prop.shelves', x: 560, y: 240 },
        { key: 'prop.bench.station', x: 800, y: 320 },
        { key: 'prop.bench.station', x: 980, y: 320 },
        { key: 'prop.stationboard', x: 500, y: 350 },
        { key: 'prop.stationclock', x: 760, y: 150 },
        { key: 'prop.luggage', x: 1120, y: 300 },
        { key: 'prop.crate', x: 150, y: 560 },
      ],
      facilitySlots: [
        { kind: 'train', x: 500, y: 366 },
        { kind: 'noticeboard', x: 760, y: 320 },
      ],
    };
  }
  if (has('storage') || def.kind === 'warehouse') {
    return {
      wallStyle: 'industrial',
      floorMaterial: 'concrete',
      furniture: [
        { key: 'prop.crate', x: 200, y: 300 },
        { key: 'prop.crate', x: 260, y: 306 },
        { key: 'prop.crate', x: 230, y: 250 },
        { key: 'prop.barrel', x: 380, y: 300 },
        { key: 'prop.barrel', x: 430, y: 300 },
        { key: 'prop.shelves', x: 640, y: 240 },
        { key: 'prop.workbench', x: 880, y: 250 },
        { key: 'prop.toolbox', x: 820, y: 310 },
        { key: 'prop.planter', x: 1080, y: 300 },
        { key: 'prop.painting', x: 480, y: 160 },
      ],
      facilitySlots: [
        { kind: 'storage', x: 230, y: 320 },
        { kind: 'workbench', x: 880, y: 266 },
      ],
    };
  }
  if (has('greenhouse') || def.kind === 'greenhouse') {
    return {
      wallStyle: 'glass',
      floorMaterial: 'tile',
      furniture: [
        { key: 'prop.planter', x: 240, y: 300 },
        { key: 'prop.planter', x: 440, y: 300 },
        { key: 'prop.planter', x: 640, y: 300 },
        { key: 'prop.planter', x: 840, y: 300 },
        { key: 'prop.planter', x: 1040, y: 300 },
        { key: 'prop.pot', x: 180, y: 480 },
        { key: 'prop.pot', x: 1120, y: 480 },
        { key: 'prop.watercan', x: 340, y: 480 },
        { key: 'prop.bucket', x: 380, y: 480 },
        { key: 'prop.sack', x: 1060, y: 560 },
        { key: 'prop.plant', x: 120, y: 260 },
        { key: 'prop.plant', x: 1140, y: 260 },
      ],
      facilitySlots: [
        { kind: 'greenhouse', x: 640, y: 316 },
        { kind: 'workbench', x: 900, y: 480 },
      ],
    };
  }
  const cafeKinds: readonly string[] = ['restaurant', 'city_cafe'];
  if (has('shop') || has('shop_counter') || has('cafe') || has('bakery') || cafeKinds.includes(def.kind)) {
    const cafe = has('cafe') || cafeKinds.includes(def.kind);
    const furniture: { key: string; x: number; y: number; scale?: number }[] = [
      { key: 'prop.counter', x: 400, y: 270 },
      { key: 'prop.counter', x: 560, y: 270 },
      { key: 'prop.shelves', x: 240, y: 240 },
      { key: 'prop.shelves', x: 760, y: 240 },
      { key: 'prop.displaycase', x: 900, y: 270 },
      { key: 'prop.till', x: 480, y: 250 },
      { key: 'prop.painting', x: 400, y: 160 },
      { key: 'prop.menu', x: 740, y: 170 },
    ];
    if (cafe) {
      furniture.push(
        { key: 'prop.table', x: 300, y: 480 },
        { key: 'prop.chair', x: 250, y: 490 },
        { key: 'prop.chair', x: 350, y: 490 },
        { key: 'prop.table', x: 640, y: 520 },
        { key: 'prop.chair', x: 590, y: 530 },
        { key: 'prop.chair', x: 690, y: 530 },
        { key: 'prop.table', x: 980, y: 480 },
        { key: 'prop.chair', x: 930, y: 490 }
      );
    } else {
      furniture.push({ key: 'prop.crate', x: 1060, y: 320 }, { key: 'prop.plant', x: 1120, y: 600 }, { key: 'prop.rug', x: 640, y: 520 });
    }
    return {
      wallStyle: 'plaster',
      floorMaterial: def.kind === 'bakery' ? 'tile' : 'wood',
      furniture,
      facilitySlots: [
        { kind: cafe ? 'cafe' : 'shop_counter', x: 480, y: 286 },
        { kind: cafe ? 'shop' : 'workbench', x: 900, y: 600 },
        { kind: 'storage', x: 1060, y: 320 },
      ],
    };
  }
  return {
    wallStyle: 'plaster',
    floorMaterial: 'wood',
    furniture: [
      { key: 'prop.table', x: 640, y: 440 },
      { key: 'prop.chair', x: 580, y: 450 },
      { key: 'prop.chair', x: 700, y: 450 },
      { key: 'prop.shelves', x: 300, y: 240 },
      { key: 'prop.stove', x: 900, y: 250 },
      { key: 'prop.rug', x: 640, y: 500 },
      { key: 'prop.plant', x: 1080, y: 320 },
      { key: 'prop.painting', x: 640, y: 160 },
      { key: 'prop.bookstack', x: 980, y: 320 },
    ],
    facilitySlots: [
      { kind: 'storage', x: 300, y: 256 },
      { kind: 'heater', x: 900, y: 266 },
    ],
  };
}

function planInterior(def: LocationDef, ctx: PlanContext): LocationPlan {
  const template = interiorTemplate(def, ctx);
  const wallHeight = 136;
  const doorX = W / 2;
  const walkable = walkableRect(38, wallHeight + 14, W - 38, H - 64);
  const plan: LocationPlan = {
    id: def.id,
    name: def.name,
    indoor: true,
    regionId: def.regionId,
    width: W,
    height: H,
    skyHeight: 0,
    ceilingStyle: 'indoor',
    ground: [],
    waterZones: [],
    bridges: [],
    buildings: [],
    props: [],
    exits: [],
    door: null,
    facilities: [],
    searchSpot: null,
    obstacles: [],
    lights: [],
    walkable,
    playerSpawn: { x: doorX, y: H - 180 },
    npcAnchors: [],
    ambient: { petals: false, leaves: false, motes: true, fireflies: false },
    interiorStyle: null,
    farmable: isFarmable(def),
  };
  plan.ground.push(ground(0, 0, W, H, template.floorMaterial));
  for (const item of template.furniture) {
    if (item.key === 'prop.rug') plan.ground.push(ground(item.x - 96, item.y - 56, 192, 112, 'carpet'));
  }
  const interiorPal = locationPalette(def.floorColor, def.accentColor, true);
  plan.interiorStyle = {
    wallStyle: template.wallStyle,
    wallColor: interiorPal.wall,
    trimColor: interiorPal.trim,
    floorMaterial: template.floorMaterial,
    doorX,
    windows: [
      { x: 300, y: 40, width: 74, height: 58, lit: true },
      { x: 760, y: 40, width: 74, height: 58, lit: true },
    ],
  };
  // Wall-adjacent furniture sits against the top wall; floor furniture below.
  // A small deterministic jitter per location keeps same-template rooms distinct.
  const interiorSeed = hashString(def.id + ':interior');
  template.furniture.forEach((item, index) => {
    if (item.key === 'prop.rug') return;
    const jitterX = seededRange(interiorSeed, index * 2, -9, 9);
    const jitterY = seededRange(interiorSeed, index * 2 + 1, -6, 6);
    const x = Math.round(item.x + jitterX);
    const y = Math.round(item.y + jitterY);
    plan.props.push(prop(item.key, x, y, item.scale ?? 1));
    const isWallItem = y < 320;
    if (isWallItem) {
      plan.obstacles.push(rect(x - 52, y - 46, 104, 48));
    } else if (item.key === 'prop.chair' || item.key === 'prop.pot' || item.key === 'prop.plant' || item.key === 'prop.painting') {
      // Chairs/pots are small enough to walk around without a collider.
    } else {
      plan.obstacles.push(rect(x - 56, y - 40, 112, 42));
    }
  });
  // Door on the south wall.
  const entranceName = ctx.entrance?.name ?? 'Outside';
  makeDoor(plan, ctx, doorX, H - 74, entranceName, 'exit');
  plan.ground.push(ground(doorX - 60, H - 96, 120, 96, 'stone'));
  // Facility placement: use the template slot, otherwise find a free spot.
  const usedSlots = new Set<string>();
  for (const kind of def.facilities) {
    const visual = facilityVisual(kind);
    if (!visual) continue;
    const slot = template.facilitySlots.find((candidate) => candidate.kind === kind && !usedSlots.has(candidate.kind));
    let x = 640;
    let y = 600;
    if (slot) {
      usedSlots.add(slot.kind);
      x = slot.x;
      y = slot.y;
    } else {
      const index = plan.facilities.length;
      x = 220 + index * 180;
      y = 600;
      plan.props.push(prop(visual.prop, x, y, 1));
    }
    plan.facilities.push({
      kind,
      label: visual.label,
      x,
      y: y - 6,
      prop: visual.prop,
      action: visual.action,
      radius: 62,
    });
    plan.lights.push({ x, y: y - 20, radius: 76, color: 0xffd08a, strength: 0.55 });
  }
  plan.lights.push({ x: doorX, y: 46, radius: 120, color: 0xffe6b8, strength: 0.8 });
  plan.npcAnchors = buildAnchors(plan, 8);
  return plan;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const SQUARE_KINDS: ReadonlySet<string> = new Set(['town_center', 'plaza', 'market', 'event_square']);
const PARK_KINDS: ReadonlySet<string> = new Set(['park', 'city_park', 'hidden_garden']);
const WATER_KINDS: ReadonlySet<string> = new Set(['river', 'lake', 'riverside_walk']);
const FOREST_KINDS: ReadonlySet<string> = new Set(['forest', 'secret_path']);
const FARM_KINDS: ReadonlySet<string> = new Set(['farm', 'greenhouse']);
const COUNTRYSIDE_KINDS: ReadonlySet<string> = new Set(['countryside', 'abandoned_farmhouse', 'warehouse', 'ancient_well', 'exploration_area']);
const STATION_KINDS: ReadonlySet<string> = new Set(['train_station']);
const CITY_KINDS: ReadonlySet<string> = new Set(['commercial_street', 'office_district', 'cultural_center']);
const ARCADE_KINDS: ReadonlySet<string> = new Set(['shopping_mall']);
const RESIDENTIAL_KINDS: ReadonlySet<string> = new Set(['residence', 'city_residential', 'apartments']);

/** Builds the deterministic render plan for a location. */
export function buildLocationPlan(def: LocationDef, ctx: PlanContext): LocationPlan {
  if (def.indoor) return planInterior(def, ctx);
  if (ARCADE_KINDS.has(def.kind)) return planArcade(def, ctx);
  if (def.kind === 'orchard') return planOrchard(def, ctx);
  if (RESIDENTIAL_KINDS.has(def.kind)) return planResidential(def, ctx);
  if (SQUARE_KINDS.has(def.kind)) return planSquare(def, ctx);
  if (PARK_KINDS.has(def.kind)) return planPark(def, ctx);
  if (WATER_KINDS.has(def.kind)) return planWater(def, ctx);
  if (FOREST_KINDS.has(def.kind)) return planForest(def, ctx);
  if (FARM_KINDS.has(def.kind)) return planFarm(def, ctx);
  if (COUNTRYSIDE_KINDS.has(def.kind)) return planCountryside(def, ctx);
  if (STATION_KINDS.has(def.kind)) return planStation(def, ctx);
  if (CITY_KINDS.has(def.kind)) return planCityStreet(def, ctx);
  return planShopfront(def, ctx);
}
