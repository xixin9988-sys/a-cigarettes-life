import Phaser from 'phaser';
import type { Season } from '../core/SharedTypes';
import { SEASON_PALETTES, colorToCss, mixColor, shade } from './palette';
import { ALL_GROUND_MATERIALS, materialTileSpec, tileTextureKey } from './tiles';
import {
  CROP_STAGE_SIZES,
  DOOR_KINDS,
  NPC_HAIR_STYLES,
  NPC_HAT_KINDS,
  NPC_OUTFITS,
  PLAYER_PATTERNS,
  PROP_SIZES,
  WALL_STYLES,
  WINDOW_KINDS,
} from './assetKeys';

/**
 * Procedural pixel-art texture factory.
 *
 * Every texture in the game is drawn here once during PreloadScene and then
 * reused from Phaser's texture cache - no external assets, no network, no
 * randomness. Colours that depend on runtime state (season, region, NPC palette)
 * are applied as tints by the renderers.
 */

type Graphics = Phaser.GameObjects.Graphics;

const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
const TILE = 32;

function makeGraphics(scene: Phaser.Scene): Graphics {
  return scene.make.graphics({ x: 0, y: 0 }, false);
}

function commit(scene: Phaser.Scene, graphics: Graphics, key: string, width: number, height: number): void {
  if (!scene.textures.exists(key)) graphics.generateTexture(key, width, height);
  graphics.destroy();
}

function fill(g: Graphics, x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
  g.fillStyle(color, alpha);
  g.fillRect(x, y, w, h);
}

function px(g: Graphics, x: number, y: number, color: number, alpha = 1): void {
  g.fillStyle(color, alpha);
  g.fillRect(x, y, 1, 1);
}

function ellipse(g: Graphics, cx: number, cy: number, w: number, h: number, color: number, alpha = 1): void {
  g.fillStyle(color, alpha);
  g.fillEllipse(cx, cy, w, h);
}

function canvasTexture(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void
): void {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, width, height);
  if (!texture) return;
  const context = texture.getContext();
  if (context) draw(context);
  texture.refresh();
}

function css(color: number, alpha = 1): string {
  const hex = colorToCss(color);
  if (alpha >= 1) return hex;
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// ---------------------------------------------------------------------------
// Ground tiles
// ---------------------------------------------------------------------------

function drawGrassTile(g: Graphics, season: Season, variant: number): void {
  const p = SEASON_PALETTES[season];
  fill(g, 0, 0, TILE, TILE, p.grass);
  // Patchy darker clumps.
  for (let index = 0; index < 5; index += 1) {
    const x = (index * 11 + variant * 7 + 3) % (TILE - 6);
    const y = (index * 17 + variant * 5 + 4) % (TILE - 6);
    fill(g, x, y, 5 + (index % 3), 3, p.grassShadow, 0.45);
  }
  // Blades.
  for (let index = 0; index < 10; index += 1) {
    const x = (index * 13 + variant * 9 + 5) % (TILE - 2);
    const y = (index * 7 + variant * 11 + 8) % (TILE - 4);
    px(g, x, y, p.grassAlt, 0.9);
    px(g, x, y - 1, p.grassAlt, 0.7);
    px(g, x + 1, y, p.grassAlt, 0.5);
  }
  if (variant === 2 && season !== 'winter') {
    for (let index = 0; index < 3; index += 1) {
      const x = 6 + index * 9;
      const y = 7 + index * 8;
      px(g, x, y, p.flower, 0.95);
      px(g, x + 1, y, p.flower, 0.6);
      px(g, x, y + 1, p.flower, 0.6);
      px(g, x + 1, y + 1, p.flowerAlt, 0.8);
    }
  }
  if (variant === 1 && season === 'winter') {
    fill(g, 4, 12, 12, 5, p.snow, 0.6);
    fill(g, 16, 4, 9, 4, p.snow, 0.5);
  }
}

function drawPathTile(g: Graphics, season: Season, variant: number): void {
  const p = SEASON_PALETTES[season];
  fill(g, 0, 0, TILE, TILE, p.path);
  for (let index = 0; index < 7; index += 1) {
    const x = (index * 9 + variant * 6 + 3) % (TILE - 5);
    const y = (index * 13 + variant * 4 + 6) % (TILE - 4);
    fill(g, x, y, 4, 3, p.pathAlt, 0.8);
    px(g, x, y, mixColor(p.pathAlt, 0xffffff, 0.3), 0.7);
  }
  if (season === 'winter') {
    fill(g, 0, 0, TILE, TILE, 0xffffff, 0.18);
  }
  if (season === 'autumn') {
    px(g, 8, 22, 0xc07832, 0.8);
    px(g, 9, 23, 0xc07832, 0.8);
    px(g, 24, 9, 0xd89a40, 0.7);
  }
}

function drawSoilTile(g: Graphics, season: Season, variant: number): void {
  const p = SEASON_PALETTES[season];
  const base = season === 'winter' ? mixColor(p.soil, 0xe8eef2, 0.45) : p.soil;
  fill(g, 0, 0, TILE, TILE, base);
  for (let index = 0; index < 6; index += 1) {
    const y = 3 + index * 5 + variant * 2;
    fill(g, 2, y, TILE - 4, 2, shade(base, 0.82), 0.8);
  }
  for (let index = 0; index < 8; index += 1) {
    const x = (index * 11 + 4) % (TILE - 2);
    const y = (index * 7 + 9) % (TILE - 2);
    px(g, x, y, shade(base, 1.18), 0.7);
  }
}

function drawFieldTile(g: Graphics, season: Season, variant: number): void {
  const p = SEASON_PALETTES[season];
  const base = shade(p.soil, 0.9);
  fill(g, 0, 0, TILE, TILE, base);
  const rowColor = shade(base, 0.72);
  for (let index = 0; index < 4; index += 1) {
    fill(g, 0, 3 + index * 8, TILE, 3, rowColor, 0.85);
  }
  if (season === 'spring' || season === 'summer') {
    const sprout = p.grassAlt;
    for (let index = 0; index < 6; index += 1) {
      const x = 4 + index * 5 + variant * 3;
      const y = 5 + (index % 4) * 8;
      px(g, x, y, sprout, 0.95);
      px(g, x, y - 1, sprout, 0.8);
    }
  }
  if (season === 'winter') {
    fill(g, 0, 0, TILE, TILE, 0xf2f6fa, 0.25);
  }
}

function drawPlazaTile(g: Graphics, variant: number): void {
  fill(g, 0, 0, TILE, TILE, 0x9a948c);
  fill(g, 2, 2, 14, 14, 0xa6a098);
  fill(g, 18, 2, 12, 14, 0x928c84);
  fill(g, 2, 18, 12, 12, 0x928c84);
  fill(g, 16, 18, 14, 12, 0xa6a098);
  fill(g, 0, 15, TILE, 2, 0x7f7a72);
  fill(g, 15, 0, 2, TILE, 0x7f7a72);
  px(g, 6 + variant, 6, 0xb8b2a8, 0.8);
  px(g, 22, 8 + variant, 0x6f6a64, 0.6);
}

function drawCobbleTile(g: Graphics, variant: number): void {
  fill(g, 0, 0, TILE, TILE, 0x7a7468);
  const stones = [
    [3, 3, 13, 8],
    [18, 2, 11, 9],
    [2, 14, 10, 8],
    [14, 13, 15, 9],
    [4, 24, 24, 6],
  ];
  stones.forEach((stone, index) => {
    const x = (stone[0] ?? 0) + (variant + index) % 2;
    const y = stone[1] ?? 0;
    const w = stone[2] ?? 8;
    const h = stone[3] ?? 6;
    ellipse(g, x + w / 2, y + h / 2, w * 2, h * 2, index % 2 === 0 ? 0x948e80 : 0x8a8478);
    px(g, x + 2, y + 1, 0xa8a294, 0.7);
  });
}

function drawRoadTile(g: Graphics, variant: number): void {
  fill(g, 0, 0, TILE, TILE, 0x4c4c54);
  for (let index = 0; index < 14; index += 1) {
    const x = (index * 13 + variant * 7 + 2) % (TILE - 2);
    const y = (index * 7 + variant * 11 + 3) % (TILE - 2);
    px(g, x, y, 0x585860, 0.8);
  }
  if (variant === 1) {
    fill(g, 6, 4, 20, 2, 0x646470, 0.5);
    fill(g, 10, 20, 16, 2, 0x42424a, 0.6);
  }
}

function drawPavementTile(g: Graphics, variant: number): void {
  fill(g, 0, 0, TILE, TILE, 0xa8a49c);
  fill(g, 1, 1, 14, 14, 0xb2aea6);
  fill(g, 17, 1, 14, 14, 0x9e9a92);
  fill(g, 1, 17, 14, 13, 0x9e9a92);
  fill(g, 17, 17, 14, 13, 0xb2aea6);
  fill(g, 0, 0, TILE, 1, 0x8a867e);
  fill(g, 0, 16, TILE, 1, 0x8a867e);
  if (variant === 1) {
    fill(g, 8, 8, 3, 3, 0x8f8b84, 0.8);
  }
}

function drawWaterTile(g: Graphics, variant: number): void {
  fill(g, 0, 0, TILE, TILE, 0xdceaf2);
  const shadeColor = 0xb8d2e2;
  for (let index = 0; index < 4; index += 1) {
    const y = 4 + index * 8 + variant * 2;
    fill(g, 3, y, 12, 2, shadeColor, 0.7);
    fill(g, 18, y + 3, 10, 2, shadeColor, 0.5);
  }
  fill(g, 0, 0, TILE, 2, 0xf4fbff, 0.35);
  px(g, 10 + variant * 3, 22, 0xffffff, 0.8);
}

function drawWoodTile(g: Graphics, variant: number): void {
  fill(g, 0, 0, TILE, TILE, 0xf2ecdf);
  for (let index = 0; index < 4; index += 1) {
    fill(g, 0, index * 8, TILE, 7, variant === 1 && index % 2 === 1 ? 0xe6dfd0 : 0xefe8da);
    fill(g, 0, index * 8 + 7, TILE, 1, 0xc8bfae, 0.9);
    const offset = (index * 11 + variant * 13) % 20;
    fill(g, offset + 3, index * 8 + 3, 8, 1, 0xd8d0c0, 0.7);
  }
}

function drawTileFloorTexture(g: Graphics, variant: number): void {
  fill(g, 0, 0, TILE, TILE, 0xf4f4f0);
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      const light = (row + col + variant) % 2 === 0;
      fill(g, col * 16 + 1, row * 16 + 1, 14, 14, light ? 0xffffff : 0xe4e4de);
    }
  }
  fill(g, 0, 15, TILE, 2, 0xc8c8c0);
  fill(g, 15, 0, 2, TILE, 0xc8c8c0);
}

function drawCarpetTile(g: Graphics, variant: number): void {
  fill(g, 0, 0, TILE, TILE, 0xf0e8e2);
  for (let index = 0; index < 12; index += 1) {
    const x = (index * 11 + variant * 5 + 3) % (TILE - 3);
    const y = (index * 7 + variant * 3 + 4) % (TILE - 3);
    fill(g, x, y, 2, 2, 0xe0d4cc, 0.9);
  }
  fill(g, 0, 0, TILE, 1, 0xd0c4bc, 0.7);
  fill(g, 0, 31, TILE, 1, 0xd0c4bc, 0.7);
}

function drawStoneTile(g: Graphics, variant: number): void {
  fill(g, 0, 0, TILE, TILE, 0xf0f0ec);
  fill(g, 1, 1, 14, 13, 0xffffff);
  fill(g, 17, 1, 14, 13, 0xe6e6e0);
  fill(g, 1, 16, 30, 15, 0xe6e6e0);
  fill(g, 0, 14, TILE, 2, 0xcdcdc6);
  fill(g, 16, 0, 2, 14, 0xcdcdc6);
  if (variant === 1) px(g, 8, 6, 0xd8d8d0, 0.9);
}

function drawConcreteTile(g: Graphics, variant: number): void {
  fill(g, 0, 0, TILE, TILE, 0xececec);
  for (let index = 0; index < 8; index += 1) {
    const x = (index * 13 + variant * 9) % (TILE - 4);
    const y = (index * 11 + variant * 5) % (TILE - 4);
    fill(g, x, y, 3, 2, 0xd8d8d8, 0.8);
  }
  if (variant === 1) {
    g.lineStyle(1, 0xc4c4c4, 0.7);
    g.lineBetween(6, 4, 14, 20);
  }
}

function drawMallTile(g: Graphics, variant: number): void {
  fill(g, 0, 0, TILE, TILE, 0xf2f0ec);
  g.lineStyle(1, 0xd8d4ce, 0.9);
  g.lineBetween(0, 16, 32, 16);
  g.lineBetween(16, 0, 16, 32);
  fill(g, 2, 2, 12, 12, 0xffffff, 0.7);
  fill(g, 18, 18, 12, 12, 0xe8e4de, 0.8);
  if (variant === 1) fill(g, 6, 20, 8, 3, 0xdad6d0, 0.6);
}

function drawCrossingTile(g: Graphics): void {
  g.clear();
  for (let index = 0; index < 4; index += 1) {
    fill(g, 2 + index * 8, 0, 4, TILE, 0xf0f0e8, 0.85);
  }
}

function drawRailTile(g: Graphics): void {
  fill(g, 0, 0, TILE, TILE, 0x5a5450);
  for (let index = 0; index < 6; index += 1) {
    fill(g, (index * 7) % TILE, (index * 13) % TILE, 4, 3, 0x6a645e, 0.9);
  }
  fill(g, 0, 8, TILE, 5, 0x7a6a56);
  fill(g, 0, 3, TILE, 2, 0x9a9aa2);
  fill(g, 0, 16, TILE, 2, 0x9a9aa2);
  fill(g, 0, 12, TILE, 1, 0x6a6a72, 0.8);
}

export function generateTileTextures(scene: Phaser.Scene): void {
  const neutralDrawers: Record<string, (g: Graphics, variant: number) => void> = {
    plaza: drawPlazaTile,
    cobble: drawCobbleTile,
    road: drawRoadTile,
    pavement: drawPavementTile,
    water: drawWaterTile,
    wood: drawWoodTile,
    tile: drawTileFloorTexture,
    carpet: drawCarpetTile,
    stone: drawStoneTile,
    concrete: drawConcreteTile,
    mall: drawMallTile,
    crossing: (g: Graphics) => drawCrossingTile(g),
    rail: (g: Graphics) => drawRailTile(g),
  };
  for (const material of ALL_GROUND_MATERIALS) {
    const spec = materialTileSpec(material);
    if (spec.seasonal) {
      for (const season of SEASONS) {
        for (let variant = 0; variant < spec.variants; variant += 1) {
          const key = tileTextureKey(material, season, variant);
          if (scene.textures.exists(key)) continue;
          const g = makeGraphics(scene);
          if (material === 'grass') drawGrassTile(g, season, variant);
          else if (material === 'path') drawPathTile(g, season, variant);
          else if (material === 'soil') drawSoilTile(g, season, variant);
          else drawFieldTile(g, season, variant);
          commit(scene, g, key, TILE, TILE);
        }
      }
      continue;
    }
    const drawer = neutralDrawers[material];
    if (!drawer) continue;
    for (let variant = 0; variant < spec.variants; variant += 1) {
      const key = tileTextureKey(material, 'spring', variant);
      if (scene.textures.exists(key)) continue;
      const g = makeGraphics(scene);
      drawer(g, variant);
      commit(scene, g, key, TILE, TILE);
    }
  }
}

// ---------------------------------------------------------------------------
// Interior walls, windows, doors
// ---------------------------------------------------------------------------

function drawWallTile(g: Graphics, style: string): void {
  fill(g, 0, 0, TILE, TILE, 0xf4f0e8);
  if (style === 'plaster') {
    fill(g, 0, 0, TILE, TILE, 0xf8f4ec);
    for (let index = 0; index < 8; index += 1) {
      px(g, (index * 11 + 5) % TILE, (index * 7 + 9) % TILE, 0xe4ded2, 0.7);
    }
    fill(g, 0, 26, TILE, 6, 0xe0d8ca, 0.8);
  } else if (style === 'brick') {
    fill(g, 0, 0, TILE, TILE, 0xf0ece2);
    for (let row = 0; row < 4; row += 1) {
      const offset = row % 2 === 0 ? 0 : 8;
      for (let col = -1; col < 3; col += 1) {
        fill(g, col * 16 + offset + 1, row * 8 + 1, 14, 6, row % 2 === 0 ? 0xffffff : 0xe8e2d6);
      }
      fill(g, 0, row * 8, TILE, 1, 0xcfc8ba);
    }
  } else if (style === 'wood') {
    fill(g, 0, 0, TILE, TILE, 0xe8dcc8);
    for (let index = 0; index < 4; index += 1) {
      fill(g, index * 8 + 1, 0, 6, TILE, index % 2 === 0 ? 0xf0e4d0 : 0xded2be);
      fill(g, index * 8, 0, 1, TILE, 0xc0b49e);
    }
  } else if (style === 'tile') {
    fill(g, 0, 0, TILE, TILE, 0xf8f8f4);
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        fill(g, col * 8 + 1, row * 8 + 1, 6, 6, (row + col) % 2 === 0 ? 0xffffff : 0xeaeae4);
      }
    }
  } else if (style === 'industrial') {
    fill(g, 0, 0, TILE, TILE, 0xdcdcd8);
    for (let index = 0; index < 8; index += 1) {
      fill(g, index * 4, 0, 2, TILE, index % 2 === 0 ? 0xf0f0ec : 0xc8c8c4);
    }
    fill(g, 0, 24, TILE, 3, 0xb0b0ac, 0.7);
  } else {
    // glass
    g.clear();
    fill(g, 0, 0, TILE, TILE, 0xd8ecf4, 0.35);
    fill(g, 0, 0, 1, TILE, 0xc0e0ec, 0.8);
    fill(g, 0, 0, TILE, 1, 0xc0e0ec, 0.8);
    fill(g, 8, 8, 6, 10, 0xffffff, 0.2);
  }
}

function generateArchitectureTextures(scene: Phaser.Scene): void {
  for (const style of WALL_STYLES) {
    const key = 'wall.' + style;
    if (scene.textures.exists(key)) continue;
    const g = makeGraphics(scene);
    drawWallTile(g, style);
    commit(scene, g, key, TILE, TILE);
  }
  // Skirting board / baseboard.
  if (!scene.textures.exists('wall.trim')) {
    const g = makeGraphics(scene);
    fill(g, 0, 0, TILE, 10, 0xf0e8da);
    fill(g, 0, 8, TILE, 3, 0xd0c4b0);
    fill(g, 0, 11, TILE, 3, 0xb8a890, 0.7);
    commit(scene, g, 'wall.trim', TILE, 14);
  }
  // Windows: separate tintable glass and frame layers.
  const windowSizes: Record<string, { w: number; h: number }> = {
    small: { w: 20, h: 24 },
    tall: { w: 20, h: 34 },
    shop: { w: 44, h: 28 },
    arch: { w: 28, h: 38 },
  };
  for (const kind of WINDOW_KINDS) {
    const size = windowSizes[kind] ?? { w: 20, h: 24 };
    const glassKey = 'win.glass.' + kind;
    if (!scene.textures.exists(glassKey)) {
      const g = makeGraphics(scene);
      fill(g, 0, 0, size.w, size.h, 0x9cc4d8);
      fill(g, 0, 0, size.w, Math.floor(size.h * 0.45), 0xc8e4f0, 0.6);
      fill(g, Math.floor(size.w / 2) - 1, 0, 2, size.h, 0x7aa0b4, 0.6);
      commit(scene, g, glassKey, size.w, size.h);
    }
    const frameKey = 'win.frame.' + kind;
    if (!scene.textures.exists(frameKey)) {
      const g = makeGraphics(scene);
      const border = 3;
      fill(g, 0, 0, size.w, border, 0xffffff);
      fill(g, 0, size.h - border, size.w, border, 0xffffff);
      fill(g, 0, 0, border, size.h, 0xffffff);
      fill(g, size.w - border, 0, border, size.h, 0xffffff);
      fill(g, Math.floor(size.w / 2) - 1, 0, 2, size.h, 0xffffff);
      fill(g, 0, Math.floor(size.h * 0.5) - 1, size.w, 2, 0xffffff);
      fill(g, 0, size.h - 2, size.w, 2, 0xd8d8d8, 0.7);
      commit(scene, g, frameKey, size.w, size.h);
    }
  }
  // Doors.
  for (const kind of DOOR_KINDS) {
    const key = 'door.' + kind;
    if (scene.textures.exists(key)) continue;
    const g = makeGraphics(scene);
    const w = kind === 'shop' ? 44 : 34;
    const h = 50;
    fill(g, 0, 0, w, h, kind === 'shop' ? 0x8ab0c0 : 0x9a6a44);
    fill(g, 2, 2, w - 4, h - 4, kind === 'shop' ? 0xb8d8e4 : 0xb07a4a);
    if (kind === 'shop') {
      fill(g, 6, 8, w - 12, h - 22, 0xcfe8f0, 0.85);
    } else {
      fill(g, 5, 8, w - 10, h - 20, 0x9a6a3e);
      fill(g, 8, 12, w - 16, 12, 0xb07a4a);
      fill(g, 8, 30, w - 16, 12, 0xb07a4a);
    }
    px(g, w - 8, Math.floor(h * 0.55), 0xf0d080);
    fill(g, 0, h - 3, w, 3, 0x4a3a2a, 0.8);
    commit(scene, g, key, w, h);
  }
}

// ---------------------------------------------------------------------------
// FX particles
// ---------------------------------------------------------------------------

function generateFxTextures(scene: Phaser.Scene): void {
  canvasTexture(scene, 'fx.smoke', 24, 24, (ctx) => {
    const gradient = ctx.createRadialGradient(12, 12, 1, 12, 12, 12);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 24, 24);
  });
  canvasTexture(scene, 'fx.steam', 28, 28, (ctx) => {
    const gradient = ctx.createRadialGradient(14, 14, 1, 14, 14, 14);
    gradient.addColorStop(0, 'rgba(240,250,255,0.9)');
    gradient.addColorStop(0.55, 'rgba(240,250,255,0.32)');
    gradient.addColorStop(1, 'rgba(240,250,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 28, 28);
  });
  canvasTexture(scene, 'fx.glow', 64, 64, (ctx) => {
    const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.28, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(0.65, 'rgba(255,255,255,0.16)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  });
  canvasTexture(scene, 'fx.shadow', 32, 12, (ctx) => {
    const gradient = ctx.createRadialGradient(16, 6, 1, 16, 6, 16);
    gradient.addColorStop(0, 'rgba(0,0,0,0.45)');
    gradient.addColorStop(0.6, 'rgba(0,0,0,0.16)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 12);
  });
  canvasTexture(scene, 'fx.fog', 180, 80, (ctx) => {
    for (let index = 0; index < 5; index += 1) {
      const cx = 30 + index * 30;
      const cy = 40 + (index % 2 === 0 ? -10 : 10);
      const gradient = ctx.createRadialGradient(cx, cy, 4, cx, cy, 46);
      gradient.addColorStop(0, 'rgba(255,255,255,0.48)');
      gradient.addColorStop(0.7, 'rgba(255,255,255,0.12)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 180, 80);
    }
  });
  canvasTexture(scene, 'fx.cloud', 120, 46, (ctx) => {
    const blobs = [
      { x: 34, y: 28, r: 20 },
      { x: 58, y: 20, r: 26 },
      { x: 86, y: 26, r: 18 },
      { x: 50, y: 32, r: 16 },
    ];
    for (const blob of blobs) {
      const gradient = ctx.createRadialGradient(blob.x, blob.y, 1, blob.x, blob.y, blob.r * 1.4);
      gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 120, 46);
    }
  });
  // Simple sprite particles.
  const simple: Record<string, { w: number; h: number; draw: (g: Graphics) => void }> = {
    'fx.raindrop': {
      w: 3,
      h: 14,
      draw: (g) => {
        fill(g, 1, 0, 1, 10, 0xffffff, 0.35);
        fill(g, 1, 3, 1, 10, 0xffffff, 0.9);
        fill(g, 0, 10, 3, 4, 0xffffff, 0.55);
      },
    },
    'fx.splash': {
      w: 10,
      h: 6,
      draw: (g) => {
        fill(g, 0, 3, 10, 1, 0xffffff, 0.7);
        fill(g, 2, 1, 1, 2, 0xffffff, 0.6);
        fill(g, 7, 1, 1, 2, 0xffffff, 0.6);
      },
    },
    'fx.snow': {
      w: 6,
      h: 6,
      draw: (g) => {
        fill(g, 2, 0, 2, 6, 0xffffff, 0.95);
        fill(g, 0, 2, 6, 2, 0xffffff, 0.95);
        fill(g, 1, 1, 4, 4, 0xffffff, 0.6);
      },
    },
    'fx.ember': {
      w: 5,
      h: 5,
      draw: (g) => {
        fill(g, 1, 1, 3, 3, 0xffffff, 0.9);
        fill(g, 2, 0, 1, 5, 0xffffff, 0.7);
      },
    },
    'fx.spark': {
      w: 4,
      h: 4,
      draw: (g) => {
        fill(g, 1, 0, 2, 4, 0xffffff, 0.9);
        fill(g, 0, 1, 4, 2, 0xffffff, 0.9);
      },
    },
    'fx.leaf': {
      w: 8,
      h: 6,
      draw: (g) => {
        fill(g, 1, 1, 5, 4, 0xffffff, 0.95);
        fill(g, 3, 0, 2, 1, 0xffffff, 0.8);
        fill(g, 2, 2, 3, 1, 0xc0c0c0, 0.6);
      },
    },
    'fx.petal': {
      w: 6,
      h: 5,
      draw: (g) => {
        fill(g, 1, 1, 4, 3, 0xffffff, 0.95);
        fill(g, 2, 0, 2, 1, 0xffffff, 0.8);
      },
    },
    'fx.firefly': {
      w: 6,
      h: 6,
      draw: (g) => {
        fill(g, 1, 1, 4, 4, 0xffffff, 0.9);
        fill(g, 2, 0, 2, 1, 0xffffff, 0.6);
      },
    },
    'fx.mote': {
      w: 3,
      h: 3,
      draw: (g) => fill(g, 0, 0, 3, 3, 0xffffff, 0.9),
    },
    'fx.winddust': {
      w: 10,
      h: 3,
      draw: (g) => {
        fill(g, 0, 1, 10, 1, 0xffffff, 0.7);
        fill(g, 3, 0, 4, 1, 0xffffff, 0.4);
      },
    },
    'fx.star': {
      w: 3,
      h: 3,
      draw: (g) => fill(g, 1, 0, 1, 3, 0xffffff, 0.9),
    },
  };
  for (const [key, spec] of Object.entries(simple)) {
    if (scene.textures.exists(key)) continue;
    const g = makeGraphics(scene);
    spec.draw(g);
    commit(scene, g, key, spec.w, spec.h);
  }
  // Moon and sun.
  if (!scene.textures.exists('fx.moon')) {
    const g = makeGraphics(scene);
    g.fillStyle(0xf4f0d8, 1);
    g.fillCircle(16, 16, 13);
    g.fillStyle(0xd8d4b8, 1);
    g.fillCircle(11, 12, 3);
    g.fillCircle(20, 19, 2);
    g.fillCircle(17, 9, 2);
    commit(scene, g, 'fx.moon', 32, 32);
  }
  if (!scene.textures.exists('fx.sun')) {
    const g = makeGraphics(scene);
    g.lineStyle(2, 0xfff0c0, 0.8);
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      g.lineBetween(16 + Math.cos(angle) * 14, 16 + Math.sin(angle) * 14, 16 + Math.cos(angle) * 19, 16 + Math.sin(angle) * 19);
    }
    g.fillStyle(0xfff4d0, 1);
    g.fillCircle(16, 16, 11);
    g.fillStyle(0xffe8a8, 0.8);
    g.fillCircle(13, 13, 5);
    commit(scene, g, 'fx.sun', 38, 38);
  }
}

// ---------------------------------------------------------------------------
// UI textures
// ---------------------------------------------------------------------------

function generateUiTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists('ui.keycap')) {
    const g = makeGraphics(scene);
    fill(g, 0, 0, 20, 20, 0xf2e6cc);
    fill(g, 1, 1, 18, 16, 0xfff8e8);
    fill(g, 2, 2, 16, 2, 0xffffff);
    fill(g, 0, 16, 20, 4, 0xc8b494);
    commit(scene, g, 'ui.keycap', 20, 20);
  }
  if (!scene.textures.exists('ui.bubble')) {
    const g = makeGraphics(scene);
    g.fillStyle(0xffffff, 0.94);
    g.fillRoundedRect(0, 0, 22, 18, 5);
    g.fillTriangle(7, 17, 13, 17, 8, 23);
    g.fillStyle(0xe0d8c8, 0.5);
    g.fillRoundedRect(1, 12, 20, 4, 3);
    commit(scene, g, 'ui.bubble', 22, 24);
  }
  if (!scene.textures.exists('ui.marker')) {
    const g = makeGraphics(scene);
    fill(g, 1, 0, 12, 8, 0xffffff, 0.95);
    fill(g, 3, 8, 8, 3, 0xffffff, 0.95);
    fill(g, 5, 11, 4, 3, 0xffffff, 0.9);
    fill(g, 6, 14, 2, 2, 0xffffff, 0.8);
    commit(scene, g, 'ui.marker', 14, 16);
  }
  if (!scene.textures.exists('ui.nameplate')) {
    const g = makeGraphics(scene);
    fill(g, 0, 0, 64, 14, 0x000000, 0.45);
    fill(g, 1, 1, 62, 12, 0x1d1a22, 0.5);
    commit(scene, g, 'ui.nameplate', 64, 14);
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type PropDrawer = (g: Graphics, width: number, height: number) => void;

function baseShadow(g: Graphics, width: number, height: number): void {
  ellipse(g, width / 2, height - 4, width * 0.72, 8, 0x000000, 0.22);
}

function foliageClump(g: Graphics, cx: number, cy: number, spread: number, dark = 0x3f7036, mid = 0x5f9a4a, light = 0x74b055): void {
  ellipse(g, cx, cy + 4, spread * 1.5, spread, dark);
  ellipse(g, cx - spread * 0.2, cy, spread * 1.2, spread * 0.85, mid);
  ellipse(g, cx + spread * 0.25, cy - 2, spread * 0.8, spread * 0.6, light);
}

function drawRoundTree(g: Graphics, w: number, h: number): void {
  baseShadow(g, w, h);
  fill(g, w / 2 - 3, h - 24, 6, 22, 0x6f5238);
  fill(g, w / 2 - 3, h - 24, 2, 22, 0x8a6a4a);
  foliageClump(g, w / 2, h - 34, 15);
  ellipse(g, w / 2 - 1, h - 46, 18, 14, 0x9ad074);
}

function drawPine(g: Graphics, w: number, h: number): void {
  baseShadow(g, w, h);
  fill(g, w / 2 - 3, h - 22, 6, 20, 0x5c4430);
  for (let layer = 0; layer < 3; layer += 1) {
    const y = h - 22 - layer * 12;
    const halfW = 9 + layer * 5;
    g.fillStyle(layer === 0 ? 0x2f5c3a : layer === 1 ? 0x356b42 : 0x3f7a4a, 1);
    g.fillTriangle(w / 2 - halfW, y, w / 2 + halfW, y, w / 2, y - 19);
  }
}

function drawWillow(g: Graphics, w: number, h: number): void {
  baseShadow(g, w, h);
  fill(g, w / 2 - 3, h - 26, 6, 24, 0x6f5238);
  ellipse(g, w / 2, h - 38, 34, 22, 0x4f8a4a);
  g.fillStyle(0x5f9a4a, 1);
  for (let index = 0; index < 7; index += 1) {
    g.fillRect(8 + index * 5, h - 38, 2, 14 + (index % 3) * 5);
  }
  ellipse(g, w / 2 - 3, h - 44, 22, 15, 0x74b055);
}

function drawAppleTree(g: Graphics, w: number, h: number): void {
  drawRoundTree(g, w, h);
  for (let index = 0; index < 6; index += 1) {
    px(g, w / 2 - 12 + (index % 3) * 11, h - 44 + Math.floor(index / 3) * 11, 0xc84a3a);
    px(g, w / 2 - 11 + (index % 3) * 11, h - 44 + Math.floor(index / 3) * 11, 0xe06a4a);
  }
}

function drawBareTree(g: Graphics, w: number, h: number): void {
  baseShadow(g, w, h);
  fill(g, w / 2 - 3, h - 28, 6, 26, 0x5c4430);
  g.lineStyle(2, 0x5c4430, 1);
  g.lineBetween(w / 2, h - 26, w / 2 - 13, h - 42);
  g.lineBetween(w / 2, h - 26, w / 2 + 13, h - 44);
  g.lineBetween(w / 2, h - 34, w / 2 - 8, h - 52);
  g.lineBetween(w / 2, h - 34, w / 2 + 9, h - 52);
  fill(g, w / 2 - 6, h - 55, 12, 3, 0xe8eef2, 0.7);
}

function drawBlossomTree(g: Graphics, w: number, h: number): void {
  drawRoundTree(g, w, h);
  for (let index = 0; index < 10; index += 1) {
    px(g, 6 + ((index * 7) % (w - 10)), h - 48 + ((index * 5) % 18), 0xf2bcd4, 0.95);
  }
}

const PROP_DRAWERS: Record<string, PropDrawer> = {
  'prop.tree.round': drawRoundTree,
  'prop.tree.pine': drawPine,
  'prop.tree.willow': drawWillow,
  'prop.tree.apple': drawAppleTree,
  'prop.tree.bare': drawBareTree,
  'prop.tree.blossom': drawBlossomTree,
  'prop.bush': (g, w, h) => {
    baseShadow(g, w, h);
    ellipse(g, w * 0.36, h - 5, 20, 14, 0x3f7036);
    ellipse(g, w * 0.62, h - 5, 22, 15, 0x4f8a3e);
    ellipse(g, w * 0.5, h - 11, 18, 12, 0x5f9a4a);
  },
  'prop.hedge': (g, w, h) => {
    fill(g, 0, h - 14, w, 14, 0x3f6b36);
    for (let index = 0; index < 8; index += 1) {
      ellipse(g, 4 + index * 8, h - 14, 12, 14, index % 2 === 0 ? 0x4f8a3e : 0x5f9a4a);
    }
    fill(g, 0, h - 4, w, 4, 0x2f4f2a, 0.6);
  },
  'prop.flowerbed': (g, w, h) => {
    fill(g, 0, h - 9, w, 9, 0x6a4a34);
    fill(g, 0, h - 9, w, 2, 0x8a6a4a);
    const colors = [0xe478a2, 0xf0c651, 0xd06a3a, 0xf2bcd4, 0xe8f078];
    for (let index = 0; index < 9; index += 1) {
      const x = 4 + index * ((w - 8) / 9);
      px(g, x, h - 12, 0x5f9a4a);
      px(g, x, h - 13, colors[index % colors.length] ?? 0xe478a2);
    }
  },
  'prop.flowers': (g, w, h) => {
    fill(g, 3, h - 6, 1, 6, 0x5f9a4a);
    fill(g, 8, h - 8, 1, 8, 0x5f9a4a);
    fill(g, 12, h - 5, 1, 5, 0x5f9a4a);
    px(g, 2, h - 8, 0xe478a2);
    px(g, 3, h - 8, 0xf2bcd4);
    px(g, 7, h - 10, 0xf0c651);
    px(g, 11, h - 7, 0xd06a3a);
  },
  'prop.tallgrass': (g, w, h) => {
    for (let index = 0; index < 9; index += 1) {
      const height = 7 + (index % 4) * 3;
      fill(g, 2 + index * 3, h - height, 1, height, index % 2 === 0 ? 0x5f9a4a : 0x74b055);
    }
  },
  'prop.rock': (g, w, h) => {
    baseShadow(g, w, h);
    g.fillStyle(0x7a7a82, 1);
    g.fillTriangle(2, h - 3, w / 2, 2, w - 2, h - 3);
    g.fillStyle(0x8f8f96, 1);
    g.fillTriangle(5, h - 4, w / 2 - 2, 5, w / 2 + 5, h - 4);
    px(g, w / 2 - 4, 6, 0xb0b0b8, 0.8);
  },
  'prop.stump': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 4, 4, w - 8, h - 8, 0x6f5238);
    ellipse(g, w / 2, 5, w - 8, 8, 0x9a7a52);
    ellipse(g, w / 2, 5, w - 16, 4, 0x6f5238);
  },
  'prop.mushroom': (g, w, h) => {
    fill(g, w / 2 - 2, h - 8, 4, 8, 0xe8dcc8);
    ellipse(g, w / 2, h - 9, 14, 9, 0xb84a3a);
    px(g, w / 2 - 3, h - 11, 0xf0e0d0);
    px(g, w / 2 + 2, h - 10, 0xf0e0d0);
  },
  'prop.reed': (g, w, h) => {
    for (let index = 0; index < 4; index += 1) {
      const x = 3 + index * 3;
      fill(g, x, h - 24 + index * 2, 1, 24, index % 2 === 0 ? 0x6f8a4a : 0x8a9a5a);
      fill(g, x - 1, h - 28 + index * 2, 3, 5, 0x8a6a3a);
    }
  },
  'prop.lily': (g, w, h) => {
    ellipse(g, w / 2, h / 2, w - 2, h - 2, 0x4f8f4a);
    px(g, w / 2 - 2, h / 2 - 2, 0xf2bcd4);
  },
  'prop.bramble': (g, w, h) => {
    baseShadow(g, w, h);
    g.lineStyle(2, 0x3f4a34, 1);
    g.lineBetween(2, h - 2, w - 4, 6);
    g.lineBetween(4, h - 6, w - 2, h - 12);
    g.lineBetween(6, 4, w - 8, h - 2);
    px(g, w / 2, h / 2, 0x8a3a4a);
  },
  'prop.bench': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, 2, w - 4, 3, 0x7a5a3a);
    fill(g, 4, 8, w - 8, 4, 0x9a7a4a);
    fill(g, 6, 12, 3, h - 14, 0x5a4028);
    fill(g, w - 9, 12, 3, h - 14, 0x5a4028);
  },
  'prop.bench.station': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, 2, w - 4, 3, 0x5a6a72);
    fill(g, 4, 8, w - 8, 4, 0x8a9aa2);
    fill(g, 6, 12, 3, h - 14, 0x3f4a52);
    fill(g, w - 9, 12, 3, h - 14, 0x3f4a52);
  },
  'prop.lamp.post': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, w / 2 - 2, 8, 4, h - 10, 0x4a4038);
    fill(g, w / 2 - 5, 2, 10, 10, 0x3f3a34);
    fill(g, w / 2 - 4, 3, 8, 8, 0xffe6a0);
  },
  'prop.lamp.street': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, w / 2 - 2, 10, 4, h - 12, 0x3f4448);
    fill(g, w / 2 - 3, h - 6, 8, 6, 0x3f4448);
    fill(g, 1, 8, w - 2, 3, 0x3f4448);
    fill(g, 1, 10, 8, 6, 0x3f3a34);
    fill(g, 2, 11, 6, 4, 0xffe6a0);
  },
  'prop.signpost': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, w / 2 - 2, 12, 4, h - 14, 0x6a5238);
    fill(g, 2, 6, w - 4, 16, 0xc9b48a);
    fill(g, 3, 7, w - 6, 14, 0xdcc49a);
    fill(g, 6, 10, w - 12, 2, 0x6a5238, 0.8);
    fill(g, 6, 14, w - 16, 2, 0x6a5238, 0.8);
  },
  'prop.noticeboard': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 6, 14, 4, h - 16, 0x6a5238);
    fill(g, w - 10, 14, 4, h - 16, 0x6a5238);
    fill(g, 2, 2, w - 4, 16, 0x7a5a3a);
    fill(g, 4, 4, w - 8, 12, 0xc9b48a);
    fill(g, 7, 6, 8, 7, 0xf0e8d0);
    fill(g, 18, 6, 10, 6, 0xf0e8d0);
    fill(g, 30, 7, 8, 5, 0xf0e8d0);
  },
  'prop.menu': (g, w, h) => {
    baseShadow(g, w, h);
    g.fillStyle(0x6a5238, 1);
    g.fillTriangle(2, h - 2, w / 2, 6, w / 2 + 2, h - 2);
    g.fillStyle(0x7a5a3a, 1);
    g.fillTriangle(w - 2, h - 2, w / 2, 6, w / 2 - 2, h - 2);
    fill(g, 6, 14, w - 12, 10, 0x2a2a2a);
    fill(g, 8, 16, w - 16, 2, 0xf0e8d0, 0.8);
  },
  'prop.stall': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, 10, w - 4, h - 14, 0x7a5a3a);
    fill(g, 4, h - 16, w - 8, 12, 0x9a7a4a);
    for (let index = 0; index < 6; index += 1) {
      fill(g, 2 + index * 12, 2, 12, 9, index % 2 === 0 ? 0xc85a4a : 0xf0e0c8);
    }
    fill(g, 4, 11, w - 8, 2, 0x5a4028);
    fill(g, 10, h - 20, 14, 8, 0x8a6a4a);
  },
  'prop.fountain': (g, w, h) => {
    baseShadow(g, w, h);
    ellipse(g, w / 2, h - 10, w - 8, 18, 0x8a8478);
    ellipse(g, w / 2, h - 12, w - 16, 12, 0x9a9488);
    ellipse(g, w / 2, h - 12, w - 24, 8, 0x5a9ab4);
    fill(g, w / 2 - 3, 8, 6, h - 22, 0x8a8478);
    ellipse(g, w / 2, 8, 20, 7, 0x9a9488);
    ellipse(g, w / 2, 7, 14, 4, 0x7ac0d8);
  },
  'prop.statue': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 4, h - 14, w - 8, 14, 0x8a8478);
    fill(g, 8, h - 20, w - 16, 7, 0x9a9488);
    fill(g, w / 2 - 4, 12, 8, h - 32, 0x8f8f96);
    ellipse(g, w / 2, 10, 10, 10, 0x9a9aa2);
    fill(g, w / 2 - 8, 20, 16, 4, 0x8f8f96);
  },
  'prop.well': (g, w, h) => {
    baseShadow(g, w, h);
    ellipse(g, w / 2, h - 8, w - 8, 16, 0x7a7468);
    ellipse(g, w / 2, h - 10, w - 16, 11, 0x1a1a22);
    fill(g, 4, 2, 4, h - 12, 0x6a5238);
    fill(g, w - 8, 2, 4, h - 12, 0x6a5238);
    fill(g, 2, 2, w - 4, 4, 0x7a5a3a);
    fill(g, w / 2 - 1, 6, 2, h - 20, 0x8a6a3a);
  },
  'prop.crate': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, 2, w - 4, h - 5, 0x9a7a4a);
    fill(g, 3, 3, w - 6, h - 7, 0xb08a52);
    g.lineStyle(2, 0x7a5a3a, 0.9);
    g.lineBetween(3, 3, w - 3, h - 5);
    g.lineBetween(w - 3, 3, 3, h - 5);
  },
  'prop.barrel': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 3, 4, w - 6, h - 8, 0x7a5a3a);
    fill(g, 4, 5, w - 8, h - 10, 0x8a6a44);
    fill(g, 2, 8, w - 4, 3, 0x5a4a3a);
    fill(g, 2, h - 14, w - 4, 3, 0x5a4a3a);
    ellipse(g, w / 2, 5, w - 6, 5, 0x9a7a52);
  },
  'prop.sack': (g, w, h) => {
    baseShadow(g, w, h);
    ellipse(g, w / 2, h - 8, w - 6, 14, 0xc9b48a);
    ellipse(g, w / 2, h - 12, w - 10, 14, 0xdcc9a0);
    fill(g, w / 2 - 3, 2, 6, 6, 0xb09a72);
  },
  'prop.hay': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 1, 4, w - 2, h - 7, 0xc9a850);
    fill(g, 2, 5, w - 4, h - 9, 0xdcbc62);
    for (let index = 0; index < 5; index += 1) fill(g, 3, 6 + index * 3, w - 6, 1, 0xa88a3a, 0.7);
  },
  'prop.cart': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 6, 8, w - 12, 8, 0x7a5a3a);
    fill(g, 8, 9, w - 16, 5, 0x9a7a4a);
    g.fillStyle(0x4a3a2a, 1);
    g.fillCircle(14, h - 7, 7);
    g.fillCircle(w - 14, h - 7, 7);
    g.fillStyle(0x8a6a44, 1);
    g.fillCircle(14, h - 7, 3);
    g.fillCircle(w - 14, h - 7, 3);
  },
  'prop.planter': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, h - 10, w - 4, 10, 0x7a5a3a);
    fill(g, 3, h - 9, w - 6, 8, 0x8a6a44);
    ellipse(g, w / 2, h - 12, 20, 12, 0x4f8a3e);
    for (let index = 0; index < 5; index += 1) {
      px(g, 6 + index * 4, h - 16 - (index % 2) * 3, [0xe478a2, 0xf0c651, 0xf2bcd4][index % 3] ?? 0xe478a2);
    }
  },
  'prop.pot': (g, w, h) => {
    fill(g, 3, 8, w - 6, 6, 0xb06a4a);
    fill(g, 4, 9, w - 8, 4, 0xc97a56);
    fill(g, 2, 6, w - 4, 3, 0x9a5a3e);
    ellipse(g, w / 2, 5, 10, 8, 0x5f9a4a);
  },
  'prop.plant': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, w / 2 - 6, h - 12, 12, 12, 0x9a5a3e);
    fill(g, w / 2 - 5, h - 11, 10, 10, 0xb06a4a);
    g.lineStyle(2, 0x4f8a3e, 1);
    g.lineBetween(w / 2, h - 12, w / 2 - 8, h - 24);
    g.lineBetween(w / 2, h - 12, w / 2 + 8, h - 26);
    g.lineBetween(w / 2, h - 12, w / 2 + 2, h - 30);
    g.fillStyle(0x6aaa52, 1);
    g.fillEllipse(w / 2 - 8, h - 24, 8, 5);
    g.fillEllipse(w / 2 + 8, h - 26, 8, 5);
    g.fillEllipse(w / 2 + 2, h - 30, 8, 5);
  },
  'prop.bucket': (g, w, h) => {
    fill(g, 2, 5, w - 4, h - 6, 0x8a8a92);
    fill(g, 3, 6, w - 6, h - 8, 0x9a9aa2);
    fill(g, 1, 4, w - 2, 2, 0x6a6a72);
  },
  'prop.watercan': (g, w, h) => {
    fill(g, 6, 6, 10, 10, 0x6a8a6a);
    fill(g, 7, 7, 8, 8, 0x7a9a7a);
    fill(g, 2, 8, 5, 2, 0x6a8a6a);
    fill(g, 1, 6, 2, 4, 0x8aaa8a);
  },
  'prop.toolbox': (g, w, h) => {
    fill(g, 1, 5, w - 2, h - 6, 0x8a4a3a);
    fill(g, 2, 6, w - 4, h - 8, 0xa05a46);
    fill(g, w / 2 - 4, 2, 8, 3, 0x5a3a2a);
  },
  'prop.bookstack': (g, w, h) => {
    fill(g, 1, h - 5, w - 2, 4, 0x9a4a4a);
    fill(g, 3, h - 9, w - 6, 4, 0x4a6a9a);
    fill(g, 2, h - 13, w - 4, 4, 0x8a8a4a);
    fill(g, 5, 2, w - 10, 4, 0x6a4a8a);
  },
  'prop.table': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, 2, w - 4, 5, 0x9a7a4a);
    fill(g, 2, 3, w - 4, 3, 0xb08a52);
    fill(g, 6, 7, 3, h - 9, 0x6a5238);
    fill(g, w - 9, 7, 3, h - 9, 0x6a5238);
  },
  'prop.chair': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 3, 2, w - 6, 3, 0x8a6a44);
    fill(g, 4, 6, w - 8, 4, 0xa07a4a);
    fill(g, 4, 10, 2, h - 12, 0x6a5238);
    fill(g, w - 6, 10, 2, h - 12, 0x6a5238);
  },
  'prop.counter': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 1, 4, w - 2, h - 7, 0x8a6a44);
    fill(g, 2, 5, w - 4, h - 10, 0xa07a4a);
    fill(g, 1, 2, w - 2, 5, 0x6a5238);
    fill(g, 2, 3, w - 4, 3, 0x9a7a52);
  },
  'prop.shelves': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 1, 2, w - 2, h - 5, 0x6a5238);
    fill(g, 3, 4, w - 6, h - 9, 0x3a2a20);
    const colors = [0xc85a4a, 0x4a6a9a, 0xd0a04a, 0x6a8a4a, 0x8a5a8a];
    for (let row = 0; row < 3; row += 1) {
      const y = 8 + row * 15;
      fill(g, 2, y + 11, w - 4, 3, 0x7a5a3a);
      for (let col = 0; col < 5; col += 1) fill(g, 5 + col * 12, y, 8, 10, colors[(row + col) % colors.length] ?? 0xc85a4a);
    }
  },
  'prop.bed': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, 6, w - 4, h - 8, 0x6a5238);
    fill(g, 4, 8, w - 8, h - 12, 0xc8b8d8);
    fill(g, 4, 8, w - 8, 10, 0xf0e8f4);
    fill(g, 6, 10, 16, 8, 0xffffff);
    fill(g, w - 30, 10, 22, 8, 0xffffff);
    fill(g, 4, 20, w - 8, 10, 0xb05a6a);
    fill(g, 2, 2, w - 4, 5, 0x7a5a3a);
  },
  'prop.stove': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, 6, w - 4, h - 8, 0x4a4a52);
    fill(g, 4, 8, w - 8, h - 12, 0x5a5a62);
    ellipse(g, w / 2, h - 12, 14, 7, 0x2a2a30);
    fill(g, 3, 2, w - 6, 4, 0x3a3a42);
    fill(g, w / 2 - 1, 3, 2, 4, 0xff8a3a);
    fill(g, 6, h - 9, 8, 5, 0xffb060, 0.7);
  },
  'prop.fireplace': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, 2, w - 4, h - 5, 0x7a7268);
    fill(g, 8, 12, w - 16, h - 20, 0x2a2228);
    fill(g, 10, h - 18, w - 20, 8, 0xff7a2a, 0.85);
    fill(g, 16, h - 14, w - 32, 6, 0xffb050, 0.9);
    fill(g, 2, 2, w - 4, 5, 0x9a9288);
    fill(g, w / 2 - 20, 2, 40, 6, 0x8a6a4a);
  },
  'prop.workbench': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 1, 6, w - 2, 7, 0x8a6a44);
    fill(g, 2, 7, w - 4, 4, 0xa07a4a);
    fill(g, 4, 13, 4, h - 15, 0x6a5238);
    fill(g, w - 8, 13, 4, h - 15, 0x6a5238);
    fill(g, 10, 0, 12, 5, 0x8a8a92);
    fill(g, w - 30, 1, 10, 4, 0x9a6a3a);
  },
  'prop.easel': (g, w, h) => {
    baseShadow(g, w, h);
    g.fillStyle(0x6a5238, 1);
    g.fillTriangle(w / 2, 8, 3, h - 2, 8, h - 2);
    g.fillTriangle(w / 2, 8, w - 3, h - 2, w - 8, h - 2);
    fill(g, w / 2 - 1, 8, 2, h - 10, 0x7a5a3a);
    fill(g, 5, 2, w - 10, 18, 0xe8e0d0);
    fill(g, 7, 4, w - 14, 14, 0x6a9ac8);
  },
  'prop.rug': (g, w, h) => {
    fill(g, 2, 2, w - 4, h - 4, 0x9a4a4a);
    fill(g, 6, 6, w - 12, h - 12, 0xb05a5a);
    fill(g, 12, 12, w - 24, h - 24, 0x9a4a4a, 0.8);
    for (let index = 0; index < 5; index += 1) {
      fill(g, 14 + index * 20, 14, 4, 4, 0xe8c060, 0.8);
      fill(g, 14 + index * 20, h - 18, 4, 4, 0xe8c060, 0.8);
    }
  },
  'prop.displaycase': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, 8, w - 4, h - 10, 0x8a7a62);
    fill(g, 4, 10, w - 8, 12, 0xcfe8f0, 0.85);
    fill(g, 6, 12, 10, 8, 0xd0a04a);
    fill(g, 22, 12, 8, 8, 0x4a8a9a);
    fill(g, 2, 2, w - 4, 6, 0x6a5a4a);
  },
  'prop.pedestal': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 4, h - 10, w - 8, 10, 0x8a8478);
    fill(g, 10, 8, w - 20, h - 18, 0x9a9488);
    fill(g, 8, 2, w - 16, 7, 0xa8a298);
    fill(g, w / 2 - 4, 0, 8, 6, 0xc8b48a);
  },
  'prop.painting': (g, w, h) => {
    fill(g, 0, 0, w, h, 0x6a5238);
    fill(g, 3, 3, w - 6, h - 6, 0x3a4a5a);
    fill(g, 5, h - 14, w - 10, 9, 0x4a6a4a);
    fill(g, 5, 5, w - 10, h - 20, 0x6a9ac0, 0.7);
    fill(g, w / 2 - 5, 6, 5, 5, 0xf0e0a0, 0.8);
  },
  'prop.screen': (g, w, h) => {
    fill(g, 0, 0, w, h, 0x1a1a22);
    fill(g, 3, 3, w - 6, 14, 0xc8d8e8);
    fill(g, 6, 6, w - 12, 8, 0x9ac0d8, 0.8);
    fill(g, 3, h - 10, w - 6, 7, 0x2a2a34);
  },
  'prop.desk': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, 5, w - 4, 5, 0x8a6a44);
    fill(g, 3, 6, w - 6, 3, 0xa07a4a);
    fill(g, 6, 10, 4, h - 12, 0x6a5238);
    fill(g, w - 10, 10, 4, h - 12, 0x6a5238);
    fill(g, 12, 0, 16, 4, 0xe8e0d0);
    fill(g, w - 30, 0, 12, 5, 0x4a4a52);
  },
  'prop.till': (g, w, h) => {
    fill(g, 2, 4, w - 4, h - 6, 0x5a5a62);
    fill(g, 3, 5, w - 6, 8, 0x9ab0b8);
    fill(g, 3, 1, w - 6, 4, 0x4a4a52);
  },
  'prop.stationboard': (g, w, h) => {
    fill(g, 6, 12, 3, h - 14, 0x6a5238);
    fill(g, w - 9, 12, 3, h - 14, 0x6a5238);
    fill(g, 1, 1, w - 2, 16, 0x4a5a5a);
    fill(g, 3, 3, w - 6, 12, 0x2a3a3a);
    for (let index = 0; index < 3; index += 1) fill(g, 5, 5 + index * 3, w - 14, 1, 0xf0e8d0, 0.75);
  },
  'prop.stationclock': (g, w, h) => {
    fill(g, w / 2 - 1, 12, 2, h - 12, 0x4a4a52);
    fill(g, 1, 0, w - 2, 14, 0x4a4a52);
    fill(g, 3, 2, w - 6, 10, 0xf0e8d8);
    fill(g, w / 2, 7, 1, 3, 0x2a2a32);
    fill(g, w / 2, 7, 3, 1, 0x2a2a32);
  },
  'prop.kiosk': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, 10, w - 4, h - 14, 0xc9a86a);
    fill(g, 4, 12, w - 8, h - 18, 0xe0c088);
    for (let index = 0; index < 5; index += 1) fill(g, 4 + index * 15, 2, 14, 9, index % 2 === 0 ? 0x4a8a9a : 0xf0e0c8);
    fill(g, 12, h - 16, 26, 12, 0x9ac0d0, 0.8);
  },
  'prop.stage': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, 10, w - 4, h - 12, 0x7a5a3a);
    fill(g, 4, 12, w - 8, h - 16, 0x9a7a4a);
    for (let index = 0; index < 5; index += 1) fill(g, 2 + index * 19, 2, 15, 9, index % 2 === 0 ? 0xa04a4a : 0xf0e0c8);
  },
  'prop.campfire': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 4, h - 8, w - 8, 6, 0x5a4a3a);
    fill(g, 8, h - 12, 12, 4, 0x6a5238);
    g.fillStyle(0xff7a2a, 1);
    g.fillTriangle(w / 2 - 6, h - 8, w / 2 + 6, h - 8, w / 2, h - 20);
    g.fillStyle(0xffc050, 1);
    g.fillTriangle(w / 2 - 3, h - 8, w / 2 + 3, h - 8, w / 2, h - 16);
  },
  'prop.fence': (g, w, h) => {
    for (let index = 0; index < 5; index += 1) fill(g, 3 + index * 13, 2, 3, h - 4, 0x8a7350);
    fill(g, 0, 7, w, 3, 0x8a7350);
    fill(g, 0, 14, w, 3, 0x8a7350);
  },
  'prop.railfence': (g, w, h) => {
    for (let index = 0; index < 4; index += 1) fill(g, 6 + index * 16, 2, 3, h - 4, 0x5a6a72);
    fill(g, 0, 5, w, 2, 0x8a9aa2);
    fill(g, 0, 12, w, 2, 0x8a9aa2);
  },
  'prop.stonewall': (g, w, h) => {
    fill(g, 0, 6, w, h - 6, 0x7a7468);
    fill(g, 2, 8, 12, 6, 0x8f8a7c);
    fill(g, 16, 7, 13, 7, 0x8f8a7c);
    fill(g, 1, 16, 14, 6, 0x8f8a7c);
    fill(g, 17, 16, 12, 6, 0x8f8a7c);
    fill(g, 0, 4, w, 4, 0x9a9488, 0.9);
  },
  'prop.dock': (g, w, h) => {
    fill(g, 0, 2, w, h - 4, 0x7a5a3a);
    for (let index = 0; index < 6; index += 1) fill(g, 1 + index * 7, 3, 6, h - 6, index % 2 === 0 ? 0x9a7a4a : 0x8a6a44);
    fill(g, 0, h - 5, w, 4, 0x4a3a2a, 0.8);
  },
  'prop.mailbox': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, w / 2 - 1, 10, 2, h - 12, 0x5a4a3a);
    fill(g, 1, 2, w - 2, 9, 0x9a4a4a);
    fill(g, 2, 3, w - 4, 7, 0xb05a5a);
  },
  'prop.bin': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, 6, w - 4, h - 8, 0x4a5a4a);
    fill(g, 3, 7, w - 6, h - 11, 0x5a6a5a);
    fill(g, 1, 3, w - 2, 4, 0x3a4a3a);
  },
  'prop.bollard': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, 6, w - 4, h - 8, 0x4a4a52);
    fill(g, 3, 7, w - 6, h - 11, 0x5a5a62);
    ellipse(g, w / 2, 5, w - 4, 5, 0x5a5a62);
  },
  'prop.busstop': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 2, 4, 3, h - 6, 0x4a5a62);
    fill(g, w - 5, 4, 3, h - 6, 0x4a5a62);
    fill(g, 1, 2, w - 2, 8, 0x3a4a52);
    fill(g, 4, 3, w - 8, 6, 0x9ac0d8, 0.85);
    fill(g, 4, 10, w - 8, 12, 0x3a4a52, 0.9);
  },
  'prop.car': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 4, 10, w - 8, h - 16, 0x9a4a4a);
    fill(g, 6, 11, w - 12, h - 18, 0xb05a5a);
    fill(g, 12, 2, w - 24, 10, 0xa04a4a);
    fill(g, 15, 3, w - 30, 8, 0x9ac0d8, 0.85);
    g.fillStyle(0x2a2a32, 1);
    g.fillCircle(16, h - 7, 6);
    g.fillCircle(w - 16, h - 7, 6);
    g.fillStyle(0x8a8a92, 1);
    g.fillCircle(16, h - 7, 3);
    g.fillCircle(w - 16, h - 7, 3);
    fill(g, 4, h - 9, 8, 4, 0xf0e0a0);
  },
  'prop.trafficlight': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, w / 2 - 2, 10, 4, h - 12, 0x3a3a42);
    fill(g, 2, 2, w - 4, 22, 0x2a2a32);
    fill(g, 5, 4, 6, 5, 0xc84a4a);
    fill(g, 5, 10, 6, 5, 0xf0c040);
    fill(g, 5, 16, 6, 5, 0x5ac86a);
  },
  'prop.flagpole': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, w / 2 - 1, 2, 2, h - 4, 0x9a9aa2);
    fill(g, 3, 4, w - 4, 3, 0xb05a5a);
    fill(g, 3, 9, w - 4, 3, 0xf0e8d8);
    fill(g, 3, 14, w - 4, 3, 0x5a7a9a);
  },
  'prop.luggage': (g, w, h) => {
    fill(g, 2, 5, w - 4, h - 6, 0x8a6a44);
    fill(g, 3, 6, w - 6, h - 8, 0x9a7a52);
    fill(g, 8, 2, 8, 3, 0x6a5238);
  },
  'prop.snowman': (g, w, h) => {
    baseShadow(g, w, h);
    ellipse(g, w / 2, h - 9, 20, 16, 0xf0f6fa);
    ellipse(g, w / 2, h - 22, 16, 14, 0xf8fcff);
    ellipse(g, w / 2, h - 32, 12, 11, 0xffffff);
    fill(g, w / 2 - 4, h - 36, 2, 2, 0x2a2a32);
    fill(g, w / 2 + 2, h - 36, 2, 2, 0x2a2a32);
    fill(g, w / 2 - 1, h - 31, 6, 2, 0xe0a040);
    fill(g, w / 2 - 8, h - 40, 16, 3, 0x4a4a52);
  },
  'prop.scarecrow': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, w / 2 - 1, 10, 2, h - 12, 0x6a5238);
    fill(g, 2, 18, w - 4, 2, 0x6a5238);
    fill(g, w / 2 - 8, 10, 16, 14, 0x9a7a4a);
    fill(g, w / 2 - 5, 12, 10, 10, 0xc8a86a);
    ellipse(g, w / 2, 8, 12, 11, 0xdcc9a0);
    fill(g, w / 2 - 4, 6, 2, 2, 0x2a2a32);
    fill(g, w / 2 + 2, 6, 2, 2, 0x2a2a32);
    fill(g, w / 2 - 9, 8, 18, 3, 0x8a7a4a);
  },
  'prop.kitchen': (g, w, h) => {
    baseShadow(g, w, h);
    fill(g, 1, 4, w - 2, h - 7, 0x9a8a74);
    fill(g, 2, 5, w - 4, h - 10, 0xb0a08a);
    fill(g, 1, 2, w - 2, 5, 0x6a5a4a);
    fill(g, 2, 3, w - 4, 3, 0xc8bca8);
    fill(g, 10, 8, 22, 12, 0x8a8a92);
    fill(g, 12, 10, 18, 8, 0x5a5a62);
    fill(g, 42, 10, 20, 8, 0x6a7a8a);
    fill(g, 44, 12, 16, 4, 0x9ac0d8);
    fill(g, 70, 8, 16, 12, 0x7a6a5a);
    fill(g, 72, 10, 12, 8, 0xd0a04a);
  },
  'prop.boat': (g, w, h) => {
    baseShadow(g, w, h);
    g.fillStyle(0x7a5a3a, 1);
    g.fillTriangle(2, h - 8, w - 2, h - 8, w / 2, h - 2);
    fill(g, 4, h - 12, w - 8, 6, 0x8a6a44);
    fill(g, 6, h - 14, w - 12, 3, 0xb08a52);
    fill(g, w / 2 - 1, 2, 2, 10, 0x6a5238);
    fill(g, w / 2 - 6, 6, 12, 2, 0x9a7a4a);
  },
  'prop.plot': (g, w, h) => {
    ellipse(g, w / 2, h / 2 + 2, w - 2, h - 4, 0x4a3a2a, 0.55);
    ellipse(g, w / 2, h / 2, w - 8, h - 8, 0x5c4430);
    for (let index = 0; index < 4; index += 1) fill(g, 4, 4 + index * 4, w - 8, 2, 0x6f5238, 0.9);
  },
};

function generatePropTextures(scene: Phaser.Scene): void {
  for (const [key, size] of Object.entries(PROP_SIZES)) {
    if (scene.textures.exists(key)) continue;
    const drawer = PROP_DRAWERS[key];
    const g = makeGraphics(scene);
    if (drawer) drawer(g, size.width, size.height);
    else {
      fill(g, 1, 1, size.width - 2, size.height - 2, 0x9a7a4a);
      fill(g, 2, 2, size.width - 4, 3, 0xc9a86a);
    }
    commit(scene, g, key, size.width, size.height);
  }
}

// ---------------------------------------------------------------------------
// Crop growth stages
// ---------------------------------------------------------------------------

function generateCropTextures(scene: Phaser.Scene): void {
  CROP_STAGE_SIZES.forEach((size, stage) => {
    const key = 'crop.stage.' + stage;
    if (scene.textures.exists(key)) return;
    const g = makeGraphics(scene);
    const cx = size.width / 2;
    const stemHeight = size.height - 3;
    fill(g, cx - 1, size.height - stemHeight, 2, stemHeight, 0x4f8a3e);
    const leaves = 2 + stage;
    for (let index = 0; index < leaves; index += 1) {
      const y = size.height - 5 - index * 3;
      const direction = index % 2 === 0 ? -1 : 1;
      fill(g, cx + direction * 2, y, 5, 2, 0x6aaa52);
      fill(g, cx + direction * 2, y - 1, 2, 2, 0x6aaa52);
    }
    if (stage >= 3) {
      ellipse(g, cx - 4, size.height - 9, 6, 5, 0xe8a040);
      ellipse(g, cx + 4, size.height - 12, 6, 5, 0xe8a040);
    }
    if (stage >= 4) {
      ellipse(g, cx, size.height - 6, 8, 6, 0xd88a30);
    }
    commit(scene, g, key, size.width, size.height);
  });
}

// ---------------------------------------------------------------------------
// Figures: NPC body parts and the cigarette player
// ---------------------------------------------------------------------------

function generateFigureTextures(scene: Phaser.Scene): void {
  for (const outfit of NPC_OUTFITS) {
    const key = 'npc.torso.' + outfit;
    if (scene.textures.exists(key)) continue;
    const g = makeGraphics(scene);
    const w = 16;
    const h = 26;
    fill(g, 3, 4, 10, 22, 0xffffff);
    fill(g, 2, 6, 12, 6, 0xffffff);
    fill(g, 2, h - 3, 12, 3, 0xd8d8d8, 0.8);
    if (outfit === 'work') {
      fill(g, 5, 10, 6, 15, 0xd0d0d0);
      fill(g, 4, 5, 2, 6, 0xc8c8c8);
      fill(g, 10, 5, 2, 6, 0xc8c8c8);
    } else if (outfit === 'formal') {
      fill(g, 6, 4, 4, 4, 0xe0e0e0);
      g.fillStyle(0xd0d0d0, 1);
      g.fillTriangle(4, 5, 8, 5, 6, 13);
      g.fillTriangle(12, 5, 8, 5, 10, 13);
      fill(g, 7, 12, 2, 12, 0xc8c8c8);
    } else if (outfit === 'elder') {
      fill(g, 3, 5, 10, 7, 0xe0e0e0);
      fill(g, 6, 9, 4, 14, 0xd0d0d0);
    } else if (outfit === 'outdoor') {
      fill(g, 3, 5, 10, 16, 0xe8e8e8);
      fill(g, 7, 6, 2, 15, 0xc0c0c0);
    } else if (outfit === 'artsy') {
      fill(g, 3, 6, 10, 17, 0xf0f0f0);
      fill(g, 5, 14, 3, 3, 0xd8d8d8);
      fill(g, 9, 18, 3, 2, 0xd8d8d8);
    } else if (outfit === 'city') {
      fill(g, 3, 5, 10, 20, 0xe8e8e8);
      fill(g, 7, 7, 2, 16, 0xc8c8c8);
      px(g, 8, 10, 0x9a9a9a);
    } else {
      fill(g, 4, 5, 8, 5, 0xf0f0f0);
    }
    commit(scene, g, key, w, h);
  }
  if (!scene.textures.exists('npc.legs')) {
    const g = makeGraphics(scene);
    fill(g, 3, 0, 4, 12, 0xffffff);
    fill(g, 9, 0, 4, 12, 0xffffff);
    fill(g, 2, 10, 5, 2, 0xd0d0d0);
    fill(g, 9, 10, 5, 2, 0xd0d0d0);
    commit(scene, g, 'npc.legs', 16, 12);
  }
  if (!scene.textures.exists('npc.head')) {
    const g = makeGraphics(scene);
    ellipse(g, 6, 6, 12, 12, 0xffffff);
    fill(g, 0, 5, 2, 3, 0xf0f0f0);
    fill(g, 10, 5, 2, 3, 0xf0f0f0);
    commit(scene, g, 'npc.head', 12, 12);
  }
  const hairSizes: Record<string, { w: number; h: number }> = {
    short: { w: 14, h: 9 },
    long: { w: 16, h: 18 },
    bun: { w: 14, h: 12 },
    bald: { w: 12, h: 6 },
  };
  for (const style of NPC_HAIR_STYLES) {
    const key = 'npc.hair.' + style;
    if (scene.textures.exists(key)) continue;
    const size = hairSizes[style] ?? { w: 14, h: 9 };
    const g = makeGraphics(scene);
    if (style === 'bald') {
      fill(g, 2, 2, 8, 2, 0xffffff, 0.5);
    } else if (style === 'long') {
      fill(g, 1, 1, 14, 6, 0xffffff);
      fill(g, 0, 4, 3, 13, 0xffffff);
      fill(g, 13, 4, 3, 13, 0xffffff);
    } else if (style === 'bun') {
      fill(g, 1, 3, 12, 5, 0xffffff);
      ellipse(g, 7, 2, 7, 6, 0xffffff);
    } else {
      fill(g, 1, 2, 12, 5, 0xffffff);
      fill(g, 2, 5, 2, 3, 0xffffff);
      fill(g, 10, 5, 2, 3, 0xffffff);
    }
    commit(scene, g, key, size.w, size.h);
  }
  const hatSizes: Record<string, { w: number; h: number }> = { cap: { w: 18, h: 8 }, brim: { w: 22, h: 7 } };
  for (const kind of NPC_HAT_KINDS) {
    const key = 'npc.hat.' + kind;
    if (scene.textures.exists(key)) continue;
    const size = hatSizes[kind] ?? { w: 18, h: 8 };
    const g = makeGraphics(scene);
    if (kind === 'cap') {
      fill(g, 2, 3, 14, 5, 0xffffff);
      fill(g, 5, 1, 8, 3, 0xf0f0f0);
      fill(g, 12, 6, 6, 2, 0xe0e0e0);
    } else {
      fill(g, 1, 3, 20, 3, 0xffffff);
      fill(g, 4, 0, 14, 4, 0xf0f0f0);
    }
    commit(scene, g, key, size.w, size.h);
  }
  if (!scene.textures.exists('npc.arm')) {
    const g = makeGraphics(scene);
    fill(g, 0, 0, 4, 10, 0xffffff);
    commit(scene, g, 'npc.arm', 4, 10);
  }
  for (const pattern of PLAYER_PATTERNS) {
    const key = 'player.body.' + pattern;
    if (scene.textures.exists(key)) continue;
    const g = makeGraphics(scene);
    const w = 16;
    const h = 64;
    fill(g, 0, 0, w, h, 0xffffff);
    fill(g, 0, 0, 3, h, 0xe8e8e8);
    fill(g, w - 3, 0, 3, h, 0xf8f8f8);
    if (pattern === 'stripe') {
      for (let index = 0; index < 4; index += 1) fill(g, 0, 8 + index * 14, w, 4, 0xd8d8d8, 0.9);
    } else if (pattern === 'dots') {
      for (let index = 0; index < 14; index += 1) fill(g, 3 + (index * 5) % 10, 6 + (index * 9) % 52, 2, 2, 0xd0d0d0, 0.9);
    } else if (pattern === 'zigzag') {
      for (let index = 0; index < 4; index += 1) {
        const y = 10 + index * 14;
        for (let col = 0; col < 4; col += 1) fill(g, col * 4, y + (col % 2 === 0 ? 0 : 3), 4, 2, 0xd8d8d8, 0.85);
      }
    }
    commit(scene, g, key, w, h);
  }
  if (!scene.textures.exists('player.filter')) {
    const g = makeGraphics(scene);
    fill(g, 0, 0, 16, 20, 0xffffff);
    fill(g, 0, 4, 16, 2, 0xd8d8d8, 0.85);
    fill(g, 0, 9, 16, 2, 0xd8d8d8, 0.85);
    fill(g, 0, 14, 16, 2, 0xd8d8d8, 0.85);
    fill(g, 0, 18, 16, 2, 0xc8c8c8);
    commit(scene, g, 'player.filter', 16, 20);
  }
  if (!scene.textures.exists('player.umb')) {
    const g = makeGraphics(scene);
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(2, 16, 30, 16, 16, 0);
    fill(g, 3, 15, 26, 3, 0xe8e8e8);
    fill(g, 15, 18, 2, 14, 0x8a6a4a);
    commit(scene, g, 'player.umb', 32, 32);
  }
  if (!scene.textures.exists('player.case')) {
    const g = makeGraphics(scene);
    fill(g, 0, 0, 14, 18, 0xffffff);
    fill(g, 2, 2, 10, 14, 0xe8e8e8);
    commit(scene, g, 'player.case', 14, 18);
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function generateTexturePack(scene: Phaser.Scene): void {
  generateTileTextures(scene);
  generateArchitectureTextures(scene);
  generateFxTextures(scene);
  generateUiTextures(scene);
  generatePropTextures(scene);
  generateCropTextures(scene);
  generateFigureTextures(scene);
}
