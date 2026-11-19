import { describe, expect, it } from 'vitest';
import {
  SCENE_HEIGHT,
  SCENE_WIDTH,
  cameraZoomFor,
  circleIntersectsRect,
  clamp,
  clamp01,
  clampToRect,
  daylightTint,
  distanceSq,
  hashCombine,
  hashString,
  mulberry32,
  normalizeDegrees,
  pixelToTile,
  pointInRect,
  sceneToStatePosition,
  seededInt,
  seededRange,
  seededValue,
  stateToScenePosition,
  tileCentre,
  tileToPixel,
  TILE_SIZE,
  windVector,
  wrapValue,
} from '../../src/render/geometry';
import { cigaretteVisual, activityPose, npcEmotionBubble, npcWalkOffset } from '../../src/render/figures';

describe('tile maths', () => {
  it('converts tiles to pixels and back', () => {
    expect(TILE_SIZE).toBe(32);
    expect(tileToPixel(0)).toBe(0);
    expect(tileToPixel(3)).toBe(96);
    expect(tileToPixel(3, 5)).toBe(101);
    for (const tile of [0, 1, 7, 23]) {
      expect(pixelToTile(tileToPixel(tile))).toBe(tile);
    }
    expect(pixelToTile(31)).toBe(0);
    expect(pixelToTile(32)).toBe(1);
    expect(tileCentre(1, 2)).toEqual({ x: 48, y: 80 });
  });

  it('has a fixed 1280x736 diorama', () => {
    expect(SCENE_WIDTH).toBe(1280);
    expect(SCENE_HEIGHT).toBe(736);
  });
});

describe('wind vector', () => {
  it('points along the reported compass bearing', () => {
    const north = windVector(0, 1);
    expect(Math.abs(north.x)).toBeLessThan(1e-9);
    expect(north.y).toBeCloseTo(-1, 6);
    const east = windVector(90, 1);
    expect(east.x).toBeCloseTo(1, 6);
    expect(Math.abs(east.y)).toBeLessThan(1e-9);
    const south = windVector(180, 1);
    expect(south.y).toBeCloseTo(1, 6);
    const west = windVector(270, 1);
    expect(west.x).toBeCloseTo(-1, 6);
  });

  it('scales with speed, normalises direction and handles calm air', () => {
    const strong = windVector(45, 2);
    expect(Math.hypot(strong.x, strong.y)).toBeCloseTo(2, 6);
    const wrapped = windVector(405, 1);
    const straight = windVector(45, 1);
    expect(wrapped.x).toBeCloseTo(straight.x, 6);
    expect(wrapped.y).toBeCloseTo(straight.y, 6);
    expect(windVector(123, 0)).toEqual({ x: 0, y: 0 });
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(720)).toBe(0);
  });
});

describe('deterministic hashing & randomness', () => {
  it('hashes strings stably', () => {
    expect(hashString('willowbrook')).toBe(hashString('willowbrook'));
    expect(hashString('willowbrook')).not.toBe(hashString('ashford'));
    expect(hashCombine(1, 2)).not.toBe(hashCombine(2, 1));
  });

  it('seeded values stay in range and deterministic', () => {
    for (let index = 0; index < 50; index += 1) {
      const value = seededValue(1234, index);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(value).toBe(seededValue(1234, index));
    }
    expect(seededRange(9, 1, 10, 20)).toBeGreaterThanOrEqual(10);
    expect(seededRange(9, 1, 10, 20)).toBeLessThan(20);
    expect(seededInt(9, 2, 3, 5)).toBeGreaterThanOrEqual(3);
    expect(seededInt(9, 2, 3, 5)).toBeLessThanOrEqual(5);
  });

  it('mulberry32 streams are reproducible and in range', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let index = 0; index < 20; index += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('camera zoom', () => {
  it('always covers the viewport and stays bounded', () => {
    const cases = [
      [1280, 720],
      [1920, 1080],
      [800, 600],
      [2560, 720],
      [1024, 768],
    ];
    for (const [width, height] of cases) {
      const zoom = cameraZoomFor(width ?? 0, height ?? 0);
      expect(zoom).toBeGreaterThanOrEqual(1);
      expect(zoom).toBeLessThanOrEqual(3);
      expect(SCENE_WIDTH * zoom).toBeGreaterThanOrEqual((width ?? 0) - 0.001);
      expect(SCENE_HEIGHT * zoom).toBeGreaterThanOrEqual((height ?? 0) - 0.001);
    }
    expect(cameraZoomFor(1280, 720)).toBe(1);
    expect(cameraZoomFor(1920, 1080)).toBeCloseTo(1.5, 6);
  });
});

describe('state <-> scene coordinates', () => {
  it('maps the definition centre to the scene centre', () => {
    const mapped = stateToScenePosition(128, 96, 256, 192);
    expect(mapped.x).toBeCloseTo(SCENE_WIDTH / 2, 6);
    expect(mapped.y).toBeCloseTo(SCENE_HEIGHT / 2, 6);
  });

  it('round-trips arbitrary positions', () => {
    const state = sceneToStatePosition(321, 654, 256, 192);
    const back = stateToScenePosition(state.x, state.y, 256, 192);
    expect(back.x).toBeCloseTo(321, 4);
    expect(back.y).toBeCloseTo(654, 4);
  });
});

describe('geometry helpers', () => {
  it('clamps and tests rectangles', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp01(-2)).toBe(0);
    expect(pointInRect(5, 5, { x: 0, y: 0, width: 10, height: 10 })).toBe(true);
    expect(pointInRect(11, 5, { x: 0, y: 0, width: 10, height: 10 })).toBe(false);
    expect(circleIntersectsRect(2, 2, 4, { x: 0, y: 0, width: 10, height: 10 })).toBe(true);
    expect(circleIntersectsRect(20, 20, 4, { x: 0, y: 0, width: 10, height: 10 })).toBe(false);
    expect(clampToRect(-5, 50, { x: 0, y: 0, width: 100, height: 100 }, 10)).toEqual({ x: 10, y: 50 });
    expect(distanceSq(0, 0, 3, 4)).toBe(25);
    expect(wrapValue(-1, 10)).toBe(9);
    expect(wrapValue(11, 10)).toBe(1);
  });

  it('keeps the legacy daylight tint monotonic in darkness', () => {
    const day = daylightTint(1);
    const night = daylightTint(0);
    expect(day.alpha).toBeLessThan(night.alpha);
    expect(day.color).not.toBe(night.color);
  });
});

describe('cigarette visual parameters', () => {
  const base = { lengthRatio: 1, moisture: 0, burnRate: 1, isSheltered: false, ashAccumulated: 0, totalBurned: 0 };

  it('shortens as the cigarette burns and slows smoke when wet', () => {
    const full = cigaretteVisual(base, 0.2, 225, false, false, 0.8);
    const half = cigaretteVisual({ ...base, lengthRatio: 0.5 }, 0.2, 225, false, false, 0.8);
    const stub = cigaretteVisual({ ...base, lengthRatio: 0.05 }, 0.2, 225, false, false, 0.8);
    expect(half.heightPx).toBeLessThan(full.heightPx);
    expect(stub.heightPx).toBeLessThan(half.heightPx);
    expect(stub.heightPx).toBeGreaterThanOrEqual(10);
    const wet = cigaretteVisual({ ...base, moisture: 0.9 }, 0.2, 225, true, false, 0.8);
    expect(wet.steam).toBe(true);
    expect(wet.smokeRate).toBeLessThan(full.smokeRate);
    expect(wet.droopRad).toBeGreaterThan(full.droopRad);
    expect(wet.emberColor).not.toBe(full.emberColor);
  });

  it('glows more at night and leans with the wind', () => {
    const day = cigaretteVisual(base, 0.9, 90, false, false, 1);
    const night = cigaretteVisual(base, 0.9, 90, false, false, 0);
    expect(night.glowStrength).toBeGreaterThan(day.glowStrength);
    const eastWind = cigaretteVisual(base, 1, 90, false, false, 0.5);
    expect(eastWind.leanRad).toBeGreaterThan(0);
    const westWind = cigaretteVisual(base, 1, 270, false, false, 0.5);
    expect(westWind.leanRad).toBeLessThan(0);
  });
});

describe('npc poses, emotions and patrol paths', () => {
  it('maps activities to poses', () => {
    expect(activityPose('sleep')).toBe('sleep');
    expect(activityPose('read')).toBe('read');
    expect(activityPose('stroll')).toBe('walk');
    expect(activityPose('work')).toBe('work');
    expect(activityPose('socialise')).toBe('talk');
    expect(activityPose('fish')).toBe('fish');
    expect(activityPose('')).toBe('idle');
    expect(activityPose(null)).toBe('idle');
  });

  it('picks the dominant emotion bubble', () => {
    const npc = {
      emotions: { joy: 0.1, sadness: 0.1, anger: 0.1, fear: 0.1, affection: 0.9, stress: 0.1 },
      mood: 0.5,
      isMajor: true,
    };
    expect(npcEmotionBubble(npc)?.symbol).toBe('♥');
    const neutral = { emotions: { joy: 0.1, sadness: 0.1, anger: 0.1, fear: 0.1, affection: 0.1, stress: 0.1 }, mood: 0, isMajor: false };
    expect(npcEmotionBubble(neutral)).toBeNull();
    const happy = { ...neutral, mood: 0.8 };
    expect(npcEmotionBubble(happy)?.symbol).toBe('♪');
  });

  it('produces bounded deterministic patrol offsets', () => {
    for (let index = 0; index < 20; index += 1) {
      const a = npcWalkOffset('npc_' + index, 'stroll', 120 + index, 50);
      const b = npcWalkOffset('npc_' + index, 'stroll', 120 + index, 50);
      expect(a).toEqual(b);
      expect(Math.hypot(a.x, a.y)).toBeLessThanOrEqual(50 * 1.2);
      expect(Math.abs(a.y)).toBeLessThanOrEqual(50 * 0.56);
    }
    const idle = npcWalkOffset('npc_1', 'relax', 44, 50);
    expect(Math.hypot(idle.x, idle.y)).toBeLessThan(10);
  });
});
