import { describe, expect, it } from 'vitest';
import {
  ALL_GROUND_MATERIALS,
  materialTileSpec,
  tileTextureKey,
  tileTextureKeys,
  tileVariantFor,
} from '../../src/render/tiles';
import { SEASONS } from '../../src/core/SharedTypes';

describe('ground tile mapping', () => {
  it('defines at least one variant for every material', () => {
    expect(ALL_GROUND_MATERIALS.length).toBeGreaterThan(10);
    for (const material of ALL_GROUND_MATERIALS) {
      const spec = materialTileSpec(material);
      expect(spec.variants).toBeGreaterThanOrEqual(1);
      expect(spec.variants).toBeLessThanOrEqual(4);
    }
  });

  it('names seasonal and neutral textures consistently', () => {
    expect(tileTextureKey('grass', 'spring', 0)).toBe('tile.grass.spring.0');
    expect(tileTextureKey('grass', 'winter', 2)).toBe('tile.grass.winter.2');
    expect(tileTextureKey('wood', 'spring', 1)).toBe('tile.wood.1');
    expect(tileTextureKey('wood', 'winter', 1)).toBe('tile.wood.1');
    // Variants wrap for var-1 materials.
    expect(tileTextureKey('crossing', 'spring', 5)).toBe('tile.crossing.0');
  });

  it('lists the exact keys the texture factory generates', () => {
    for (const material of ALL_GROUND_MATERIALS) {
      const keys = tileTextureKeys(material, SEASONS);
      const spec = materialTileSpec(material);
      expect(keys.length).toBe(spec.seasonal ? spec.variants * SEASONS.length : spec.variants);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) {
        expect(key.startsWith('tile.')).toBe(true);
        expect(key).not.toContain('undefined');
      }
    }
  });

  it('picks deterministic variants inside the spec range', () => {
    const spec = materialTileSpec('grass');
    for (let tileY = 0; tileY < 6; tileY += 1) {
      for (let tileX = 0; tileX < 6; tileX += 1) {
        const variant = tileVariantFor('grass', tileX, tileY, 1234);
        expect(variant).toBeGreaterThanOrEqual(0);
        expect(variant).toBeLessThan(spec.variants);
        expect(tileVariantFor('grass', tileX, tileY, 1234)).toBe(variant);
      }
    }
    expect(tileVariantFor('crossing', 3, 4, 99)).toBe(0);
  });
});
