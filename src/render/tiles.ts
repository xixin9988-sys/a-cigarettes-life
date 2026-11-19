import type { Season } from '../core/SharedTypes';
import type { GroundMaterial } from './layout';

/**
 * Tile texture naming + variant selection for the ground render texture.
 * Kept Phaser-free so the mapping can be tested headlessly.
 */

export const OUTDOOR_SEASONAL_MATERIALS: readonly GroundMaterial[] = ['grass', 'path', 'soil', 'field'];

export interface MaterialTileSpec {
  /** Number of texture variants (deterministically mixed per tile). */
  variants: number;
  /** True when the texture is generated per season. */
  seasonal: boolean;
}

const SPECS: Readonly<Record<GroundMaterial, MaterialTileSpec>> = {
  grass: { variants: 3, seasonal: true },
  path: { variants: 2, seasonal: true },
  soil: { variants: 2, seasonal: true },
  field: { variants: 2, seasonal: true },
  plaza: { variants: 2, seasonal: false },
  cobble: { variants: 2, seasonal: false },
  road: { variants: 2, seasonal: false },
  pavement: { variants: 2, seasonal: false },
  water: { variants: 2, seasonal: false },
  wood: { variants: 2, seasonal: false },
  tile: { variants: 2, seasonal: false },
  carpet: { variants: 2, seasonal: false },
  stone: { variants: 2, seasonal: false },
  concrete: { variants: 2, seasonal: false },
  mall: { variants: 2, seasonal: false },
  crossing: { variants: 1, seasonal: false },
  rail: { variants: 1, seasonal: false },
};

export function materialTileSpec(material: GroundMaterial): MaterialTileSpec {
  return SPECS[material] ?? { variants: 1, seasonal: false };
}

/** Texture key for a material tile variant. */
export function tileTextureKey(material: GroundMaterial, season: Season | string, variant: number): string {
  const spec = materialTileSpec(material);
  const index = spec.variants <= 1 ? 0 : Math.abs(variant) % spec.variants;
  if (spec.seasonal) return 'tile.' + material + '.' + season + '.' + index;
  return 'tile.' + material + '.' + index;
}

/** Deterministic tile-variant index from tile coordinates + plan seed. */
export function tileVariantFor(material: GroundMaterial, tileX: number, tileY: number, seed: number): number {
  const spec = materialTileSpec(material);
  if (spec.variants <= 1) return 0;
  const h = Math.imul(tileX * 73856093 + tileY * 19349663 + seed, 0x9e3779b9) >>> 0;
  return h % spec.variants;
}

/** All texture keys that exist for a given material (used by tests/tools). */
export function tileTextureKeys(material: GroundMaterial, seasons: readonly Season[]): string[] {
  const spec = materialTileSpec(material);
  const keys: string[] = [];
  if (spec.seasonal) {
    for (const season of seasons) {
      for (let variant = 0; variant < spec.variants; variant += 1) keys.push(tileTextureKey(material, season, variant));
    }
  } else {
    for (let variant = 0; variant < spec.variants; variant += 1) keys.push(tileTextureKey(material, 'spring', variant));
  }
  return keys;
}

export const ALL_GROUND_MATERIALS: readonly GroundMaterial[] = [
  'grass',
  'path',
  'plaza',
  'cobble',
  'road',
  'pavement',
  'water',
  'soil',
  'field',
  'wood',
  'tile',
  'carpet',
  'stone',
  'concrete',
  'mall',
  'crossing',
  'rail',
];
