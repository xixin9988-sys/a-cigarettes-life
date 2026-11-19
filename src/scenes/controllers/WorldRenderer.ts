import Phaser from 'phaser';
import type { LocationDef } from '../../data/schema';
import type { Season } from '../../core/SharedTypes';
import type { BuildingPlan, GroundMaterial, LocationPlan, RectPlan } from '../../render/layout';
import type { SeasonPalette } from '../../render/palette';
import { locationPalette, mixColor, regionPalette, seasonPalette, shade } from '../../render/palette';
import { hashString, seededValue } from '../../render/geometry';
import { windSway } from '../../render/effects';
import { tileTextureKey, tileVariantFor } from '../../render/tiles';

export interface WorldRendererOptions {
  scene: Phaser.Scene;
  plan: LocationPlan;
  def: LocationDef;
  season: Season;
}

interface WindowRef {
  glass: Phaser.GameObjects.Image;
  baseTint: number;
}

interface LightRef {
  glow: Phaser.GameObjects.Image;
  strength: number;
}

interface ChimneyRef {
  puffs: Phaser.GameObjects.Image[];
  x: number;
  y: number;
  phase: number;
}

const INDOOR_FLOOR_MATERIALS: ReadonlySet<GroundMaterial> = new Set(['wood', 'tile', 'carpet', 'stone', 'concrete', 'mall']);

/**
 * Builds every static piece of a location scene from the deterministic
 * LocationPlan: the tiled ground render-texture, interior walls, buildings,
 * props, water shimmer, window lights, exit markers and ambient glimmers.
 * Animated bits (sway, shimmer, glows) are updated from the scene each frame.
 */
export class WorldRenderer {
  readonly plan: LocationPlan;
  private readonly scene: Phaser.Scene;
  private readonly def: LocationDef;
  private readonly season: Season;
  private readonly palette: SeasonPalette;
  private readonly windows: WindowRef[] = [];
  private readonly lights: LightRef[] = [];
  private readonly foliage: Phaser.GameObjects.Image[] = [];
  private readonly waterSparkles: { image: Phaser.GameObjects.Image; baseX: number; baseY: number; seed: number; area: RectPlan }[] = [];
  private readonly chimneys: ChimneyRef[] = [];
  private readonly glimmers: { image: Phaser.GameObjects.Image; phase: number }[] = [];
  private ceiling: Phaser.GameObjects.Graphics | null = null;

  constructor(options: WorldRendererOptions) {
    this.scene = options.scene;
    this.plan = options.plan;
    this.def = options.def;
    this.season = options.season;
    this.palette = seasonPalette(options.season);
    const seed = hashString(options.plan.id);
    this.buildGround(seed);
    this.buildInterior(seed);
    this.buildBuildings(seed);
    this.buildProps(seed);
    this.buildWater(seed);
    this.buildMarkers(seed);
    this.buildCeiling();
  }

  // -------------------------------------------------------------------------
  // Ground
  // -------------------------------------------------------------------------

  private buildGround(seed: number): void {
    const rt = this.scene.add.renderTexture(0, 0, this.plan.width, this.plan.height).setOrigin(0, 0);
    rt.setDepth(-100);
    const interiorPal = locationPalette(this.def.floorColor, this.def.accentColor, this.def.indoor);
    const indoor = this.def.indoor;
    rt.beginDraw();
    for (const zone of this.plan.ground) {
      const material = zone.material;
      const tint = indoor && INDOOR_FLOOR_MATERIALS.has(material)
        ? material === 'carpet'
          ? mixColor(interiorPal.accent, 0xf0e0d0, 0.45)
          : interiorPal.floor
        : 0xffffff;
      const zoneSeed = seed + material.length * 131 + zone.x * 7 + zone.y * 13;
      for (let y = zone.y; y < zone.y + zone.height; y += 32) {
        for (let x = zone.x; x < zone.x + zone.width; x += 32) {
          const tileX = Math.floor(x / 32);
          const tileY = Math.floor(y / 32);
          const variant = tileVariantFor(material, tileX, tileY, zoneSeed);
          rt.batchDraw(tileTextureKey(material, this.season, variant), x, y, 1, tint);
        }
      }
    }
    // Slight water tint so season palettes read through the neutral water texture.
    for (const water of this.plan.waterZones) {
      const tint = this.palette.water;
      for (let y = water.y; y < water.y + water.height; y += 32) {
        for (let x = water.x; x < water.x + water.width; x += 32) {
          rt.batchDraw(tileTextureKey('water', this.season, tileVariantFor('water', Math.floor(x / 32), Math.floor(y / 32), seed)), x, y, 1, tint);
        }
      }
    }
    rt.endDraw();
    // Bridges.
    for (const bridge of this.plan.bridges) this.paintBridge(bridge.x, bridge.y, bridge.width, bridge.height);
    // Ground-level shadows under the sky band for exteriors.
    if (this.plan.ceilingStyle === 'sky') {
      const skirt = this.scene.add.graphics().setDepth(-99);
      skirt.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.28, 0.28, 0, 0);
      skirt.fillRect(0, this.plan.skyHeight, this.plan.width, 22);
    }
  }

  private paintBridge(x: number, y: number, width: number, height: number): void {
    const g = this.scene.add.graphics().setDepth(-96);
    g.fillStyle(0x7a5a3a, 1);
    g.fillRect(x, y, width, height);
    for (let offset = 0; offset < width; offset += 8) {
      g.fillStyle(offset % 16 === 0 ? 0x9a7a4a : 0x8a6a44, 1);
      g.fillRect(x + offset + 1, y, 6, height);
    }
    g.fillStyle(0x4a3a2a, 1);
    g.fillRect(x, y + 4, width, 3);
    g.fillRect(x, y + height - 8, width, 3);
    // Railings.
    g.fillStyle(0x5a4028, 1);
    g.fillRect(x + 2, y, 4, 14);
    g.fillRect(x + width - 6, y, 4, 14);
    g.fillRect(x + 2, y + height - 14, 4, 14);
    g.fillRect(x + width - 6, y + height - 14, 4, 14);
  }

  // -------------------------------------------------------------------------
  // Interior walls / windows / ceiling
  // -------------------------------------------------------------------------

  private buildInterior(seed: number): void {
    const style = this.plan.interiorStyle;
    if (!style) return;
    const scene = this.scene;
    const pal = locationPalette(this.def.floorColor, this.def.accentColor, true);
    const wallH = 136;
    const rtKey = 'wall.' + style.wallStyle;
    // Back wall band.
    const wall = scene.add.renderTexture(0, 0, this.plan.width, wallH).setOrigin(0, 0);
    wall.setDepth(-98);
    wall.beginDraw();
    for (let x = 0; x < this.plan.width; x += 32) {
      wall.batchDraw(rtKey, x, 0, 1, pal.wall);
      for (let y = 32; y < wallH; y += 32) wall.batchDraw(rtKey, x, y, 1, pal.wall);
    }
    wall.endDraw();
    // Wall shading: darker toward the ceiling, warm light band near the floor.
    const shadeLayer = scene.add.graphics().setDepth(-97);
    shadeLayer.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.3, 0.3, 0.02, 0.02);
    shadeLayer.fillRect(0, 0, this.plan.width, 54);
    shadeLayer.fillStyle(pal.trim, 1);
    shadeLayer.fillRect(0, wallH - 14, this.plan.width, 6);
    shadeLayer.fillStyle(shade(pal.trim, 0.8), 1);
    shadeLayer.fillRect(0, wallH - 8, this.plan.width, 8);
    // Side walls.
    const side = scene.add.graphics().setDepth(-97);
    side.fillStyle(pal.wallAlt, 1);
    side.fillRect(0, 0, 32, this.plan.height);
    side.fillRect(this.plan.width - 32, 0, 32, this.plan.height);
    side.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0.25, 0, 0.25);
    side.fillRect(30, 0, 12, this.plan.height);
    side.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.25, 0, 0.25, 0);
    side.fillRect(this.plan.width - 42, 0, 12, this.plan.height);
    // South wall with a doorway gap.
    const doorX = style.doorX;
    side.fillStyle(pal.wallAlt, 1);
    side.fillRect(0, this.plan.height - 64, doorX - 52, 64);
    side.fillRect(doorX + 52, this.plan.height - 64, this.plan.width - (doorX + 52), 64);
    side.fillStyle(shade(pal.wallAlt, 0.78), 1);
    side.fillRect(0, this.plan.height - 64, this.plan.width, 6);
    side.fillStyle(shade(pal.wallAlt, 0.86), 1);
    side.fillRect(0, this.plan.height - 16, doorX - 52, 16);
    side.fillRect(doorX + 52, this.plan.height - 16, this.plan.width - (doorX + 52), 16);
    // Door frame + mat.
    const door = scene.add.image(doorX, this.plan.height - 6, 'door.wood').setOrigin(0.5, 1).setDepth(-95);
    door.setTint(pal.trim);
    const mat = scene.add.image(doorX, this.plan.height - 70, 'fx.shadow').setDepth(-96).setDisplaySize(96, 30).setTint(pal.accent);
    mat.setAlpha(0.4);
    // Windows on the back wall.
    style.windows.forEach((win, index) => {
      const glass = scene.add.image(win.x, win.y, 'win.glass.tall').setOrigin(0, 0).setDepth(-96);
      glass.setDisplaySize(win.width, win.height);
      glass.setTint(0xbfe0ef);
      const frame = scene.add.image(win.x - 2, win.y - 2, 'win.frame.tall').setOrigin(0, 0).setDepth(-95);
      frame.setDisplaySize(win.width + 4, win.height + 4);
      frame.setTint(pal.trim);
      this.windows.push({ glass, baseTint: 0xbfe0ef });
      // Light spilling in from the window.
      const spill = scene.add.image(win.x + win.width / 2, wallH + 60, 'fx.glow').setDepth(-94);
      spill.setBlendMode(Phaser.BlendModes.ADD);
      spill.setTint(0xfff0c8);
      spill.setAlpha(0.18);
      spill.setScale(2.4, 1.6);
      void index;
    });
    // Interior warm lights registered in the plan.
    for (const light of this.plan.lights) {
      const glow = scene.add.image(light.x, light.y, 'fx.glow').setDepth(44).setBlendMode(Phaser.BlendModes.ADD);
      glow.setTint(light.color);
      glow.setScale(light.radius / 32, light.radius / 32);
      glow.setAlpha(light.strength * 0.25);
      this.lights.push({ glow, strength: light.strength });
    }
    void seed;
  }

  private buildCeiling(): void {
    if (this.plan.ceilingStyle !== 'glass') return;
    const g = this.scene.add.graphics().setDepth(4800).setScrollFactor(0);
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    g.fillStyle(0xdfeef4, 0.1);
    g.fillRect(0, 0, width, height);
    g.lineStyle(6, 0x8a96a0, 0.28);
    for (let x = 80; x < width; x += 170) g.lineBetween(x, 0, x, height);
    g.lineStyle(3, 0xaab4bc, 0.2);
    for (let y = 90; y < height; y += 190) g.lineBetween(0, y, width, y);
    g.fillStyle(0xffffff, 0.08);
    g.fillRect(0, 0, width, 90);
    this.ceiling = g;
  }

  // -------------------------------------------------------------------------
  // Buildings
  // -------------------------------------------------------------------------

  private addWindow(building: BuildingPlan, x: number, y: number, width: number, height: number, kind: string): void {
    const scene = this.scene;
    const depth = building.y + building.height + 1;
    const glass = scene.add.image(x, y, 'win.glass.' + kind).setOrigin(0, 0).setDepth(depth);
    glass.setDisplaySize(width, height);
    const baseTint = building.windowColor;
    glass.setTint(baseTint);
    const frame = scene.add.image(x - 2, y - 2, 'win.frame.' + kind).setOrigin(0, 0).setDepth(depth + 1);
    frame.setDisplaySize(width + 4, height + 4);
    frame.setTint(building.trimColor);
    this.windows.push({ glass, baseTint });
  }

  private buildBuildings(seed: number): void {
    for (let index = 0; index < this.plan.buildings.length; index += 1) {
      const building = this.plan.buildings[index];
      if (building) this.paintBuilding(building, seed + index * 977);
    }
  }

  private paintBuilding(b: BuildingPlan, seed: number): void {
    const scene = this.scene;
    const region = regionPalette(this.def.regionId);
    const depth = b.y + b.height;
    const g = scene.add.graphics().setDepth(depth);
    const bottom = b.y + b.height;
    const roofTop = b.y;
    const wallTop = b.wallTop;
    const wallHeight = bottom - wallTop;
    const doorX = b.x + b.width / 2;
    // Ground shadow.
    g.fillStyle(0x000000, 0.16);
    g.fillEllipse(doorX, bottom + 2, b.width * 0.86, 14);
    if (b.style === 'greenhouse') {
      g.fillStyle(0x8ab8b0, 1);
      g.fillRect(b.x, roofTop, b.width, b.height);
      g.fillStyle(0xc8e8e0, 0.8);
      g.fillRect(b.x + 3, roofTop + 3, b.width - 6, b.height - 6);
      g.lineStyle(2, 0x6a9a92, 0.9);
      for (let x = b.x + 24; x < b.x + b.width; x += 24) g.lineBetween(x, roofTop + 3, x, bottom - 3);
      g.lineBetween(b.x + 3, roofTop + 3, b.x + 3, bottom - 3);
      g.fillStyle(0xffffff, 0.25);
      g.fillRect(b.x + 6, roofTop + 6, b.width * 0.4, 8);
      const door = scene.add.image(doorX, bottom - 4, 'door.shop').setOrigin(0.5, 1).setDepth(depth + 1);
      door.setTint(b.trimColor);
      return;
    }
    if (b.style === 'ruin') {
      g.fillStyle(0x6a6258, 1);
      g.fillRect(b.x, wallTop, b.width, wallHeight);
      g.fillStyle(0x5a544c, 1);
      for (let x = b.x; x < b.x + b.width; x += 34) {
        const h = 18 + Math.round(seededValue(seed, x) * (wallHeight * 0.8));
        g.fillRect(x, wallTop, 28, h);
      }
      g.fillStyle(0x3a3430, 1);
      g.fillRect(b.x + 40, wallTop + 22, 44, 34);
      g.fillRect(b.x + b.width - 90, wallTop + 30, 40, 26);
      g.lineStyle(2, 0x3f3a34, 0.9);
      g.lineBetween(b.x + 10, wallTop + 12, b.x + 60, wallTop + 70);
      g.lineBetween(b.x + b.width - 20, wallTop + 6, b.x + b.width - 80, wallTop + 60);
      // Broken roof beams.
      g.fillStyle(0x5a4a3a, 1);
      g.fillRect(b.x + 10, roofTop + 30, b.width - 20, 5);
      g.fillRect(b.x + 26, roofTop + 18, 5, 30);
      g.fillRect(b.x + b.width - 40, roofTop + 14, 5, 34);
      return;
    }
    // --- Wall ---
    g.fillStyle(b.wallColor, 1);
    g.fillRect(b.x, wallTop, b.width, wallHeight);
    g.fillStyle(shade(b.wallColor, 0.88), 1);
    g.fillRect(b.x, wallTop, 6, wallHeight);
    g.fillRect(b.x + b.width - 6, wallTop, 6, wallHeight);
    g.fillStyle(shade(b.wallColor, 1.12), 1);
    g.fillRect(b.x + 6, wallTop, b.width - 12, 4);
    if (b.floors > 1) {
      for (let floor = 1; floor < b.floors; floor += 1) {
        const y = wallTop + Math.round((wallHeight / b.floors) * floor);
        g.fillStyle(shade(b.wallColor, 0.82), 0.8);
        g.fillRect(b.x, y, b.width, 3);
      }
    }
    // Wainscot.
    g.fillStyle(shade(b.wallColor, 0.86), 1);
    g.fillRect(b.x, bottom - 10, b.width, 10);
    // --- Roof ---
    const roofColor = b.roofColor;
    if (b.style === 'office' || b.style === 'glass' || b.style === 'station') {
      g.fillStyle(roofColor, 1);
      g.fillRect(b.x - 6, roofTop, b.width + 12, b.roofHeight);
      g.fillStyle(shade(roofColor, 1.18), 1);
      g.fillRect(b.x - 6, roofTop, b.width + 12, 5);
      g.fillStyle(shade(roofColor, 0.78), 1);
      g.fillRect(b.x - 6, roofTop + b.roofHeight - 5, b.width + 12, 5);
      if (b.style === 'glass') {
        g.fillStyle(0xbfe0ec, 0.4);
        for (let x = b.x - 2; x < b.x + b.width; x += 22) g.fillRect(x, roofTop + 6, 14, b.roofHeight - 14);
      }
    } else if (b.style === 'tower' || b.style === 'civic') {
      // Flat civic roof with parapet and a little dome / clock.
      g.fillStyle(roofColor, 1);
      g.fillRect(b.x - 5, roofTop, b.width + 10, b.roofHeight);
      g.fillStyle(shade(roofColor, 1.2), 1);
      g.fillRect(b.x - 5, roofTop, b.width + 10, 6);
      g.fillStyle(shade(roofColor, 0.75), 1);
      g.fillRect(b.x - 5, roofTop + b.roofHeight - 6, b.width + 10, 6);
      if (b.style === 'tower') {
        g.fillStyle(shade(roofColor, 0.6), 1);
        g.fillTriangle(doorX - 40, roofTop, doorX + 40, roofTop, doorX, roofTop - 34);
        g.fillStyle(0xf0e8d0, 1);
        g.fillCircle(doorX, wallTop + 34, 14);
        g.fillStyle(0x3a3430, 1);
        g.fillCircle(doorX, wallTop + 34, 11);
        g.fillStyle(0xf0e8d0, 1);
        g.fillRect(doorX - 1, wallTop + 26, 2, 9);
        g.fillRect(doorX, wallTop + 34, 6, 2);
      }
    } else if (b.style === 'barn' || b.style === 'warehouse') {
      g.fillStyle(roofColor, 1);
      g.fillTriangle(b.x - 8, roofTop + b.roofHeight, b.x + b.width + 8, roofTop + b.roofHeight, doorX, roofTop - 14);
      g.fillStyle(shade(roofColor, 0.82), 1);
      g.fillTriangle(b.x, roofTop + b.roofHeight, b.x + b.width, roofTop + b.roofHeight, doorX, roofTop - 4);
      for (let x = b.x + 20; x < b.x + b.width - 10; x += 26) {
        g.lineStyle(1, shade(roofColor, 0.7), 0.7);
        g.lineBetween(x, roofTop + 6, x, roofTop + b.roofHeight - 2);
      }
    } else if (b.style === 'stage') {
      g.fillStyle(roofColor, 1);
      g.fillRect(b.x - 6, roofTop, b.width + 12, b.roofHeight);
      g.fillStyle(0xc04a5a, 1);
      for (let x = b.x - 4; x < b.x + b.width; x += 22) g.fillRect(x, roofTop + 4, 12, b.roofHeight - 8);
    } else {
      // Gabled cottage / shop roof.
      g.fillStyle(roofColor, 1);
      g.fillRect(b.x - 8, roofTop + 8, b.width + 16, b.roofHeight - 8);
      g.fillTriangle(b.x - 8, roofTop + 8, b.x + b.width + 8, roofTop + 8, doorX, roofTop - 12);
      g.fillStyle(shade(roofColor, 1.22), 1);
      g.fillRect(b.x - 8, roofTop + 8, b.width + 16, 3);
      for (let y = roofTop + 18; y < roofTop + b.roofHeight - 2; y += 7) {
        g.fillStyle(shade(roofColor, 0.88), 0.65);
        g.fillRect(b.x - 6, y, b.width + 12, 1);
      }
      g.fillStyle(shade(roofColor, 0.72), 1);
      g.fillRect(b.x - 8, roofTop + b.roofHeight - 4, b.width + 16, 4);
      // Chimney.
      if (seededValue(seed, 3) > 0.35) {
        const chimneyX = b.x + Math.round(b.width * 0.72);
        g.fillStyle(shade(roofColor, 0.62), 1);
        g.fillRect(chimneyX, roofTop - 4, 14, 22);
        g.fillStyle(0x5a5048, 1);
        g.fillRect(chimneyX - 2, roofTop - 6, 18, 5);
        this.registerChimney(chimneyX + 7, roofTop - 8, seed);
      }
    }
    // --- Awning ---
    if (b.awningColor !== null) {
      const awningW = Math.min(230, b.width - 50);
      const awningX = doorX - awningW / 2;
      const stripe = 14;
      for (let x = awningX; x < awningX + awningW; x += stripe) {
        const isAlt = Math.round((x - awningX) / stripe) % 2 === 0;
        g.fillStyle(isAlt ? b.awningColor : 0xf0e4cc, 1);
        g.fillRect(x, wallTop + 18, stripe - 1, 12);
        g.fillStyle(shade(isAlt ? b.awningColor : 0xf0e4cc, 0.8), 1);
        g.fillRect(x, wallTop + 28, stripe - 1, 4);
      }
    }
    // --- Door ---
    if (b.hasDoor) {
      const doorKind = b.style === 'shop' || b.style === 'civic' || b.style === 'office' || b.style === 'station' ? 'shop' : 'wood';
      const door = scene.add.image(doorX, bottom - 4, 'door.' + doorKind).setOrigin(0.5, 1).setDepth(depth + 1);
      door.setTint(b.trimColor);
      // Step.
      g.fillStyle(0x8a8478, 1);
      g.fillRect(doorX - 26, bottom - 5, 52, 6);
      // Door lamp light.
      const lamp = scene.add.image(doorX + 28, wallTop + 22, 'fx.glow').setDepth(43).setBlendMode(Phaser.BlendModes.ADD);
      lamp.setTint(0xffd98a).setScale(1.1).setAlpha(0.2);
      this.lights.push({ glow: lamp, strength: 0.8 });
    }
    // --- Windows ---
    for (const win of b.windows) {
      const kind = b.style === 'office' || b.style === 'glass' ? 'tall' : b.width > 300 ? 'small' : 'small';
      this.addWindow(b, win.x, win.y, win.width, win.height, kind);
    }
    // --- Sign ---
    if (b.signText) {
      const signW = Math.min(200, b.signText.length * 9 + 22);
      g.fillStyle(b.trimColor, 1);
      g.fillRect(doorX - signW / 2, wallTop + 4, signW, 18);
      g.fillStyle(b.style === 'shop' ? region.sign : shade(b.wallColor, 1.25), 1);
      g.fillRect(doorX - signW / 2 + 2, wallTop + 6, signW - 4, 14);
      const text = scene.add.text(doorX, wallTop + 13, b.signText, {
        fontFamily: '"Courier New", monospace',
        fontSize: '9px',
        color: '#2a2420',
        resolution: 2,
      });
      text.setOrigin(0.5, 0.5);
      text.setDepth(depth + 2);
    }
  }

  private registerChimney(x: number, y: number, seed: number): void {
    const puffs: Phaser.GameObjects.Image[] = [];
    for (let index = 0; index < 3; index += 1) {
      const puff = this.scene.add.image(x, y, 'fx.smoke').setDepth(y + 40).setAlpha(0).setTint(0xd8d8d8);
      puffs.push(puff);
    }
    this.chimneys.push({ puffs, x, y, phase: seededValue(seed, 7) * 2 });
  }

  // -------------------------------------------------------------------------
  // Props
  // -------------------------------------------------------------------------

  private buildProps(seed: number): void {
    const foliageKeys = ['prop.tree', 'prop.bush', 'prop.hedge', 'prop.reed', 'prop.tallgrass', 'prop.flower'];
    for (let index = 0; index < this.plan.props.length; index += 1) {
      const item = this.plan.props[index];
      if (!item) continue;
      const image = this.scene.add.image(item.x, item.y, item.key);
      if (item.flat) {
        image.setOrigin(0.5, 0.5).setDepth(-90);
      } else {
        image.setOrigin(0.5, 1).setDepth(Math.round(item.y));
      }
      image.setScale(item.scale);
      if (item.flipX) image.setFlipX(true);
      this.applySeasonTint(image, item.key);
      if (foliageKeys.some((prefix) => item.key.startsWith(prefix))) this.foliage.push(image);
      const fallbackAlpha = item.key.startsWith('prop.rug') ? 0.9 : 1;
      image.setAlpha(fallbackAlpha);
      void seed;
    }
  }

  private applySeasonTint(image: Phaser.GameObjects.Image, key: string): void {
    const isPlant = key.startsWith('prop.tree') || key.startsWith('prop.bush') || key.startsWith('prop.hedge') || key.startsWith('prop.reed') || key.startsWith('prop.tallgrass') || key.startsWith('prop.flower') || key.startsWith('prop.planter') || key.startsWith('prop.plant');
    if (!isPlant) return;
    if (this.season === 'autumn') image.setTint(0xe0b070);
    else if (this.season === 'winter') image.setTint(0xc8d8e0);
    else if (key.startsWith('prop.flower')) image.setTint(0xffffff);
  }

  // -------------------------------------------------------------------------
  // Water sparkle + markers
  // -------------------------------------------------------------------------

  private buildWater(seed: number): void {
    for (let w = 0; w < this.plan.waterZones.length; w += 1) {
      const zone = this.plan.waterZones[w];
      if (!zone) continue;
      const count = Math.max(3, Math.min(14, Math.round((zone.width * zone.height) / 12000)));
      for (let index = 0; index < count; index += 1) {
        const x = zone.x + 20 + seededValue(seed + w * 31, index * 3) * Math.max(1, zone.width - 40);
        const y = zone.y + 16 + seededValue(seed + w * 31, index * 3 + 1) * Math.max(1, zone.height - 32);
        const image = this.scene.add.image(x, y, 'fx.winddust').setDepth(-93).setAlpha(0.22);
        image.setTint(this.palette.waterLight);
        image.setScale(0.8 + seededValue(seed, index + 60) * 0.8);
        this.waterSparkles.push({ image, baseX: x, baseY: y, seed: seededValue(seed, index + 90) * 6.28, area: zone });
      }
    }
  }

  private buildMarkers(seed: number): void {
    for (const exit of this.plan.exits) {
      const side = exit.side;
      const arrow = this.scene.add.graphics().setDepth(-92);
      arrow.fillStyle(0xf0e2c0, 0.45);
      const dirX = side === 'east' ? 1 : side === 'west' ? -1 : 0;
      const dirY = side === 'south' ? 1 : side === 'north' ? -1 : 0;
      arrow.fillTriangle(
        exit.x + dirX * 20,
        exit.y + dirY * 20,
        exit.x - dirX * 6 - dirY * 8,
        exit.y - dirY * 6 - dirX * 8,
        exit.x - dirX * 6 + dirY * 8,
        exit.y - dirY * 6 + dirX * 8
      );
      const post = this.scene.add.image(exit.x, exit.y, 'prop.signpost').setOrigin(0.5, 1).setDepth(Math.round(exit.y) + 1);
      post.setTint(0xe8dcc0);
      const labelX = Math.max(92, Math.min(this.plan.width - 92, exit.x));
      const label = this.scene.add.text(labelX, exit.y - 38, exit.label, {
        fontFamily: '"Courier New", monospace',
        fontSize: '9px',
        color: '#f4ead8',
        backgroundColor: '#1a1620bb',
        padding: { left: 4, right: 4, top: 2, bottom: 2 },
        resolution: 2,
      });
      label.setOrigin(0.5, 1);
      label.setDepth(Math.round(exit.y) + 2);
    }
    if (this.plan.searchSpot) {
      const glimmer = this.scene.add.image(this.plan.searchSpot.x, this.plan.searchSpot.y - 12, 'fx.spark').setDepth(-91);
      glimmer.setBlendMode(Phaser.BlendModes.ADD).setTint(0xffe8a0).setScale(1.4);
      this.glimmers.push({ image: glimmer, phase: seededValue(seed, 11) * 6.28 });
    }
  }

  // -------------------------------------------------------------------------
  // Animation
  // -------------------------------------------------------------------------

  update(deltaMs: number, elapsedMs: number, lightStrength: number, windSpeed: number, indoor: boolean): void {
    const seconds = elapsedMs / 1000;
    for (const light of this.lights) {
      const flicker = 0.92 + Math.sin(seconds * 2.3 + light.strength * 12) * 0.08;
      light.glow.setAlpha(light.strength * 0.28 * (0.25 + lightStrength * 0.75) * flicker);
    }
    for (const window of this.windows) {
      const night = mixColor(window.baseTint, 0xffd08a, lightStrength);
      window.glass.setTint(night);
    }
    for (let index = 0; index < this.foliage.length; index += 1) {
      const image = this.foliage[index];
      if (image) image.setRotation(windSway(index, windSpeed, seconds));
    }
    for (let index = 0; index < this.waterSparkles.length; index += 1) {
      const sparkle = this.waterSparkles[index];
      if (!sparkle) continue;
      const t = seconds * 0.6 + sparkle.seed;
      sparkle.image.x = sparkle.baseX + Math.sin(t) * 14;
      sparkle.image.y = sparkle.baseY + Math.cos(t * 0.7) * 4;
      sparkle.image.setAlpha(0.12 + Math.abs(Math.sin(t * 1.3)) * 0.16);
    }
    for (const chimney of this.chimneys) {
      for (let index = 0; index < chimney.puffs.length; index += 1) {
        const puff = chimney.puffs[index];
        if (!puff) continue;
        const t = (seconds * 0.16 + index * 0.34 + chimney.phase) % 1;
        puff.setPosition(chimney.x + Math.sin(t * 5 + index) * 7 + t * 12, chimney.y - t * 52);
        puff.setAlpha((1 - t) * 0.22);
        puff.setScale(0.3 + t * 1.1);
      }
    }
    for (let index = 0; index < this.glimmers.length; index += 1) {
      const glimmer = this.glimmers[index];
      if (!glimmer) continue;
      glimmer.image.setAlpha(0.35 + Math.abs(Math.sin(seconds * 1.6 + glimmer.phase)) * 0.55);
      glimmer.image.setScale(1.2 + Math.sin(seconds * 1.1 + glimmer.phase) * 0.35);
    }
    void deltaMs;
    void indoor;
  }

  /** Returns seasonal tint for a prop key (used by the scene for weather-reactive props). */
  static propSeasonTint(season: Season, key: string): number | null {
    if (!key.startsWith('prop.tree') && !key.startsWith('prop.bush')) return null;
    if (season === 'autumn') return 0xe0b070;
    if (season === 'winter') return 0xc8d8e0;
    return null;
  }
}