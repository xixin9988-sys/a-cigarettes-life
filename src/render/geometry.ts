/**
 * Pure geometry / determinism helpers for the renderer.
 *
 * No Phaser and no DOM here so these can be unit-tested headlessly and reused by
 * both the scene code and the layout planner.
 */

export const TILE_SIZE = 32;
/** Fixed scene footprint in tiles: 40 x 23 = 1280 x 736 px. */
export const SCENE_TILES_W = 40;
export const SCENE_TILES_H = 23;
export const SCENE_WIDTH = SCENE_TILES_W * TILE_SIZE;
export const SCENE_HEIGHT = SCENE_TILES_H * TILE_SIZE;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Basic maths
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, value: number): number {
  if (a === b) return 0;
  return clamp01((value - a) / (b - a));
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = inverseLerp(edge0, edge1, value);
  return t * t * (3 - 2 * t);
}

export function distanceSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** Circle versus axis-aligned rectangle overlap test (used for walking collision). */
export function circleIntersectsRect(cx: number, cy: number, radius: number, rect: Rect): boolean {
  const nearestX = clamp(cx, rect.x, rect.x + rect.width);
  const nearestY = clamp(cy, rect.y, rect.y + rect.height);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

/** Clamps a point inside a rectangle while keeping a margin from every edge. */
export function clampToRect(x: number, y: number, rect: Rect, margin = 0): Vec2 {
  const minX = rect.x + margin;
  const maxX = rect.x + rect.width - margin;
  const minY = rect.y + margin;
  const maxY = rect.y + rect.height - margin;
  return {
    x: clamp(x, Math.min(minX, maxX), Math.max(minX, maxX)),
    y: clamp(y, Math.min(minY, maxY), Math.max(minY, maxY)),
  };
}

// ---------------------------------------------------------------------------
// Tile <-> pixel conversion
// ---------------------------------------------------------------------------

/** Converts a tile coordinate to the pixel at its top-left corner (+ optional offset). */
export function tileToPixel(tile: number, offsetPx = 0): number {
  return tile * TILE_SIZE + offsetPx;
}

/** Converts a pixel coordinate to the tile that contains it. */
export function pixelToTile(pixel: number): number {
  return Math.floor(pixel / TILE_SIZE);
}

/** Centre pixel of a tile. */
export function tileCentre(tileX: number, tileY: number): Vec2 {
  return {
    x: tileToPixel(tileX) + TILE_SIZE / 2,
    y: tileToPixel(tileY) + TILE_SIZE / 2,
  };
}

// ---------------------------------------------------------------------------
// Deterministic hashing / pseudo-random numbers
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit string hash. */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hashCombine(a: number, b: number): number {
  let hash = (a ^ 0x9e3779b9) >>> 0;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= b >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** Mulberry32 PRNG: deterministic, tiny, good enough for cosmetic placement. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless deterministic value in [0, 1) for (seed, index). */
export function seededValue(seed: number, index: number): number {
  return (hashCombine(seed >>> 0, index >>> 0) >>> 8) / 16777216;
}

/** Deterministic value in [min, max) for (seed, index). */
export function seededRange(seed: number, index: number, min: number, max: number): number {
  return min + seededValue(seed, index) * (max - min);
}

/** Deterministic integer in [min, max]. */
export function seededInt(seed: number, index: number, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(seededValue(seed, index) * (max - min + 1));
}

export function wrapValue(value: number, size: number): number {
  if (size <= 0) return 0;
  const wrapped = value % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}

export function normalizeDegrees(degrees: number): number {
  return wrapValue(degrees, 360);
}

// ---------------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------------

/**
 * Wind drift vector in screen space.
 *
 * `windDirectionDeg` is a compass bearing describing where the wind blows
 * *towards*: 0 = north (screen up), 90 = east (screen right). The returned
 * vector has the full requested magnitude and points along that bearing, so a
 * speed of 1 at 0 degrees returns (0, -1).
 */
export function windVector(windDirectionDeg: number, windSpeed: number): Vec2 {
  const speed = Number.isFinite(windSpeed) ? windSpeed : 0;
  if (speed === 0) return { x: 0, y: 0 };
  const rad = (normalizeDegrees(windDirectionDeg) * Math.PI) / 180;
  return {
    x: Math.sin(rad) * speed,
    y: -Math.cos(rad) * speed,
  };
}

/** Rotates a compass bearing into the canvas rotation used for wind streaks. */
export function windScreenAngleRad(windDirectionDeg: number): number {
  return (normalizeDegrees(windDirectionDeg) * Math.PI) / 180;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/**
 * Integer-ish zoom so a 1280x736 scene always covers the viewport.
 * Phaser camera zoom > 1 magnifies pixels; values below 1 would blur them.
 */
export function cameraZoomFor(
  viewWidth: number,
  viewHeight: number,
  worldWidth = SCENE_WIDTH,
  worldHeight = SCENE_HEIGHT,
  minZoom = 1,
  maxZoom = 3
): number {
  const safeViewW = Math.max(1, viewWidth);
  const safeViewH = Math.max(1, viewHeight);
  const need = Math.max(safeViewW / worldWidth, safeViewH / worldHeight);
  // Snap to 1/4 steps for stable pixel sampling while keeping the scene filled.
  const stepped = Math.ceil(need * 4) / 4;
  return clamp(stepped, minZoom, maxZoom);
}

// ---------------------------------------------------------------------------
// State <-> scene coordinate mapping
// ---------------------------------------------------------------------------

/**
 * Persistent player positions live in the LocationDef's tile footprint
 * (widthTiles * 32 px) while the scene always renders on a fixed 1280x736
 * canvas. Mapping is proportional, so entering a location at the definition
 * centre lands exactly at the scene centre.
 */
export function stateToScenePosition(
  stateX: number,
  stateY: number,
  stateWidth: number,
  stateHeight: number,
  sceneWidth = SCENE_WIDTH,
  sceneHeight = SCENE_HEIGHT
): Vec2 {
  const nx = stateWidth > 0 ? clamp01(stateX / stateWidth) : 0.5;
  const ny = stateHeight > 0 ? clamp01(stateY / stateHeight) : 0.5;
  return { x: nx * sceneWidth, y: ny * sceneHeight };
}

export function sceneToStatePosition(
  sceneX: number,
  sceneY: number,
  stateWidth: number,
  stateHeight: number,
  sceneWidth = SCENE_WIDTH,
  sceneHeight = SCENE_HEIGHT
): Vec2 {
  const nx = sceneWidth > 0 ? clamp01(sceneX / sceneWidth) : 0.5;
  const ny = sceneHeight > 0 ? clamp01(sceneY / sceneHeight) : 0.5;
  return { x: nx * stateWidth, y: ny * stateHeight };
}

// ---------------------------------------------------------------------------
// Day/night tint (legacy helper kept stable for other scene modules)
// ---------------------------------------------------------------------------

export interface TintSpec {
  color: number;
  alpha: number;
}

/** Coarse blue-night tint used for simple overlays; the rich gradient is in palette.ts. */
export function daylightTint(daylight: number): TintSpec {
  if (daylight > 0.75) return { color: 0xfff4d6, alpha: 0.04 };
  if (daylight > 0.45) return { color: 0xffd9a0, alpha: 0.1 };
  if (daylight > 0.2) return { color: 0x5b4a8f, alpha: 0.22 };
  return { color: 0x121a3f, alpha: 0.42 };
}
