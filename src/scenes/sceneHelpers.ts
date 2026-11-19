import type { IContentRegistry } from '../core/contracts';
import { seedToString } from './sceneHelpersExtra';

export { hashString } from './sceneHelpersExtra';
export { TILE } from './sceneHelpersExtra';

/** Scene keys used by the location router. */
export type WorldSceneKey = 'TownScene' | 'CityScene' | 'InteriorScene';

/**
 * Chooses the Phaser scene that renders a location.
 * Willowbrook exteriors -> TownScene, Ashford exteriors -> CityScene,
 * indoor rooms -> InteriorScene.
 */
export function sceneForLocation(content: IContentRegistry, locationId: string): WorldSceneKey {
  const def = content.getLocation(locationId);
  if (!def) return 'TownScene';
  if (def.indoor) return 'InteriorScene';
  return def.regionId === 'ashford' ? 'CityScene' : 'TownScene';
}

/** Legacy palette export kept for compatibility with the earlier fallback scenes. */
export const PALETTES = {
  spring: { grass: 0x7cae58, grassAlt: 0x8cc063, path: 0xc7b78c, water: 0x4e93b4 },
  summer: { grass: 0x6a9f42, grassAlt: 0x7bb650, path: 0xd2bf8b, water: 0x3f8fae },
  autumn: { grass: 0x94854a, grassAlt: 0xa3965a, path: 0xc0a97b, water: 0x4c7e9c },
  winter: { grass: 0x9fb0b2, grassAlt: 0xb0c0c2, path: 0xc4ccd0, water: 0x5a7f9e },
} as const;

/** Deterministic float in [0, range) derived from a string tag and an index. */
export function seededOffset(seed: string, index: number, range: number): number {
  return seedToString(seed, index) * range;
}
