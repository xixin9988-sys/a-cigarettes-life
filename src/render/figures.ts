import type { CigaretteAppearance, CigaretteConditionState, NPCState } from '../core/contracts';
import { colorFromHex } from './palette';
import { clamp, clamp01, hashString, lerp, seededValue, type Vec2 } from './geometry';

/**
 * Pure visual parameter derivation for the two sprite families:
 *  - the anthropomorphic cigarette player (shortens as it burns, droops when wet,
 *    leans in the wind, glows harder at night), and
 *  - the village NPC figures (palette / pose / emotion bubble / walk offsets).
 */

// ---------------------------------------------------------------------------
// Player cigarette
// ---------------------------------------------------------------------------

export interface CigaretteVisual {
  /** Body (paper) height in pixels - shrinks from 48 to 10 as the cigarette burns. */
  heightPx: number;
  widthPx: number;
  filterHeightPx: number;
  emberRadius: number;
  emberAlpha: number;
  emberColor: number;
  /** Smoke puffs per second. */
  smokeRate: number;
  smokeRise: number;
  smokeDriftX: number;
  steam: boolean;
  /** Forward/downward sag from moisture, in radians. */
  droopRad: number;
  /** Lean caused by wind, in radians (positive = lean right). */
  leanRad: number;
  bobAmplitude: number;
  bobSpeed: number;
  /** 0..1 additive ember halo strength. */
  glowStrength: number;
  /** 0..1 how ragged/wet the paper looks. */
  wetness: number;
}

export function cigaretteVisual(
  condition: Readonly<CigaretteConditionState>,
  windSpeed: number,
  windDirectionDeg: number,
  sheltered: boolean,
  moving: boolean,
  daylight: number
): CigaretteVisual {
  const lengthRatio = clamp01(condition.lengthRatio);
  const moisture = clamp01(condition.moisture);
  const burnRate = Number.isFinite(condition.burnRate) ? clamp(condition.burnRate, 0.2, 3) : 1;
  const wind = clamp(windSpeed, 0, 1.5);
  const light = clamp01(daylight);

  const heightPx = Math.round(lerp(10, 46, lengthRatio));
  const windX = Math.sin((windDirectionDeg * Math.PI) / 180);
  const steam = moisture > 0.55;
  return {
    heightPx,
    widthPx: 14,
    filterHeightPx: Math.round(clamp(lerp(6, 11, lengthRatio), 6, 12)),
    emberRadius: 2.8 + (1 - lengthRatio) * 0.8,
    emberAlpha: clamp01(0.42 + burnRate * 0.2 + (1 - light) * 0.28 - moisture * 0.35),
    emberColor: moisture > 0.72 ? 0x86aec6 : burnRate > 1.25 ? 0xffa03c : 0xff7a2a,
    smokeRate: clamp((0.8 + burnRate * 1.1) * (1 - moisture * 0.55) * (sheltered ? 0.85 : 1.15), 0.4, 4.2),
    smokeRise: 16 + wind * 6,
    smokeDriftX: windX * (14 + wind * 40),
    steam,
    droopRad: moisture * 0.2 + (1 - lengthRatio) * 0.05,
    leanRad: windX * wind * 0.1,
    bobAmplitude: moving ? 2.2 : 0.9,
    bobSpeed: moving ? 8.5 : 2.6,
    glowStrength: clamp01((1 - light) * 0.85 * (1 - moisture * 0.45) + 0.15),
    wetness: moisture,
  };
}

/** Deterministic little puff offset so successive smoke puffs fan out. */
export function smokePuffOffset(index: number): { x: number; y: number; scale: number } {
  return {
    x: (seededValue(0x5a6f, index) - 0.5) * 5,
    y: seededValue(0x5a70, index) * 2,
    scale: 0.7 + seededValue(0x5a71, index) * 0.6,
  };
}

// ---------------------------------------------------------------------------
// NPC figures
// ---------------------------------------------------------------------------

export interface FigurePalette {
  primary: number;
  secondary: number;
  hair: number;
  skin: number;
  scale: number;
  outfit: string;
  accessory: string;
}

const DEFAULT_FIGURE_PALETTE: FigurePalette = {
  primary: 0xb89a6a,
  secondary: 0xd8cfbb,
  hair: 0x4a3a2a,
  skin: 0xd9b08c,
  scale: 1,
  outfit: 'casual',
  accessory: 'none',
};

export function npcFigurePalette(appearance: NPCState['appearance']): FigurePalette {
  if (!appearance) return DEFAULT_FIGURE_PALETTE;
  return {
    primary: colorFromHex(appearance.primaryColor, DEFAULT_FIGURE_PALETTE.primary),
    secondary: colorFromHex(appearance.secondaryColor, DEFAULT_FIGURE_PALETTE.secondary),
    hair: colorFromHex(appearance.hairColor, DEFAULT_FIGURE_PALETTE.hair),
    skin: colorFromHex(appearance.skinTone, DEFAULT_FIGURE_PALETTE.skin),
    scale: clamp(Number.isFinite(appearance.scale) ? appearance.scale : 1, 0.85, 1.15),
    outfit: appearance.outfitStyle || 'casual',
    accessory: appearance.accessory || 'none',
  };
}

export type FigurePose = 'idle' | 'walk' | 'work' | 'sit' | 'sleep' | 'fish' | 'eat' | 'talk' | 'read';

/** Maps a runtime NPC activity id to a small sprite pose family. */
export function activityPose(activity: string | null | undefined): FigurePose {
  const id = (activity ?? '').toLowerCase();
  if (id === '') return 'idle';
  if (id.includes('sleep') || id.includes('nap')) return 'sleep';
  if (id.includes('read') || id.includes('study') || id.includes('book')) return 'read';
  if (id.includes('fish')) return 'fish';
  if (id.includes('eat') || id.includes('drink') || id.includes('meal') || id.includes('lunch') || id.includes('dinner')) return 'eat';
  if (id.includes('work') || id.includes('garden') || id.includes('craft') || id.includes('build') || id.includes('cook')) return 'work';
  if (id.includes('talk') || id.includes('chat') || id.includes('social') || id.includes('convers')) return 'talk';
  if (id.includes('stroll') || id.includes('walk') || id.includes('commute') || id.includes('travel') || id.includes('go_') || id.includes('errand') || id.includes('shop') || id.includes('wander')) return 'walk';
  if (id.includes('sit') || id.includes('rest') || id.includes('relax') || id.includes('leisure')) return 'sit';
  return 'idle';
}

export interface EmotionBubble {
  symbol: string;
  tone: number;
  strength: number;
}

const EMOTION_ORDER: readonly { key: keyof NPCState['emotions']; symbol: string; tone: number }[] = [
  { key: 'affection', symbol: '♥', tone: 0xff9ab0 },
  { key: 'joy', symbol: '♪', tone: 0xffe08a },
  { key: 'anger', symbol: '!', tone: 0xff7a5a },
  { key: 'sadness', symbol: '…', tone: 0x9ab0d8 },
  { key: 'fear', symbol: '?', tone: 0xc0a0ff },
  { key: 'stress', symbol: '~', tone: 0xa0d0c0 },
];

/**
 * Picks the dominant emotion bubble. Weak emotions fall back to a subtle mood
 * symbol, and neutral NPCs show no bubble at all.
 */
export function npcEmotionBubble(npc: Pick<NPCState, 'emotions' | 'mood' | 'isMajor'>): EmotionBubble | null {
  let best: { symbol: string; tone: number; strength: number } | null = null;
  for (const entry of EMOTION_ORDER) {
    const value = npc.emotions ? clamp01(npc.emotions[entry.key]) : 0;
    if (!best || value > best.strength) best = { symbol: entry.symbol, tone: entry.tone, strength: value };
  }
  const mood = clamp(Number.isFinite(npc.mood) ? npc.mood : 0, -1, 1);
  const threshold = npc.isMajor ? 0.34 : 0.46;
  if (best && best.strength >= threshold) return best;
  if (mood > 0.32) return { symbol: '♪', tone: 0xffe08a, strength: 0.3 + mood * 0.4 };
  if (mood < -0.32) return { symbol: '…', tone: 0x9ab0d8, strength: 0.3 + -mood * 0.4 };
  return null;
}

/**
 * Deterministic cosmetic patrol offset around an NPC's anchor. Walking NPCs get
 * a slow figure-of-eight path; other poses keep a tiny weight shift so the
 * village never looks frozen.
 */
export function npcWalkOffset(npcId: string, activity: string, simTimeSeconds: number, radius: number): Vec2 {
  const seed = hashString(npcId);
  const pose = activityPose(activity);
  if (pose !== 'walk') {
    const amount = pose === 'idle' ? radius * 0.06 : radius * 0.025;
    return {
      x: Math.sin(simTimeSeconds * 0.7 + (seed % 100)) * amount,
      y: Math.cos(simTimeSeconds * 0.5 + (seed % 73)) * amount * 0.4,
    };
  }
  const speedX = 0.16 + ((seed % 7) * 0.012);
  const speedY = 0.26 + (((seed >>> 4) % 5) * 0.016);
  const phase = (seed % 628) / 100;
  return {
    x: Math.sin(simTimeSeconds * speedX + phase) * radius,
    y: Math.sin(simTimeSeconds * speedY + phase * 1.7) * radius * 0.55,
  };
}

/** 0..1 walk-cycle phase with per-NPC offset. */
export function figureWalkCycle(npcId: string, simTimeSeconds: number): number {
  const seed = hashString(npcId);
  return (simTimeSeconds * 7 + (seed % 360) / 360 * Math.PI * 2) % (Math.PI * 2);
}

/** Horizontal facing: -1 left, 1 right, derived from the patrol velocity. */
export function npcFacing(npcId: string, activity: string, simTimeSeconds: number): -1 | 1 {
  const seed = hashString(npcId);
  const pose = activityPose(activity);
  if (pose !== 'walk') return (seed & 1) === 0 ? 1 : -1;
  const speedX = 0.16 + ((seed % 7) * 0.012);
  const phase = (seed % 628) / 100;
  return Math.cos(simTimeSeconds * speedX + phase) >= 0 ? 1 : -1;
}

/** Breathing bob in pixels for NPCs; phase offset per id keeps a crowd alive. */
export function npcBreath(npcId: string, simTimeSeconds: number): number {
  const seed = hashString(npcId);
  return Math.sin(simTimeSeconds * 1.6 + (seed % 100) * 0.11) * 0.9;
}

/** Palette for the player's body pattern texture key suffix. */
export function playerPatternKey(pattern: CigaretteAppearance['pattern']): 'plain' | 'stripe' | 'dots' | 'zigzag' {
  if (pattern === 'stripe' || pattern === 'dots' || pattern === 'zigzag') return pattern;
  return 'plain';
}

/** Face expression glyph for the cigarette's little paper face. */
export function playerFaceGlyph(
  appearance: Readonly<CigaretteAppearance>,
  condition: Readonly<CigaretteConditionState>,
  moving: boolean,
  talking: boolean
): 'smile' | 'neutral' | 'wink' | 'surprised' | 'sleepy' {
  if (condition.moisture > 0.7) return 'sleepy';
  if (condition.lengthRatio < 0.22) return 'surprised';
  if (talking) return 'smile';
  if (moving) return 'neutral';
  if (appearance.face === 'wink') return 'wink';
  if (appearance.face === 'surprised') return 'surprised';
  if (appearance.face === 'sleepy') return 'sleepy';
  if (appearance.face === 'neutral') return 'neutral';
  return appearance.face === 'smile' ? 'smile' : 'neutral';
}
