import Phaser from 'phaser';
import type { GameState } from '../core/contracts';
import type { Season } from '../core/SharedTypes';
import { getSceneSession } from './session';
import { startWorldScene } from './sceneRouter';
import { dayNightPalette, mixColor, seasonPalette, shade } from '../render/palette';
import { cameraZoomFor, hashString, seededValue } from '../render/geometry';

const MENU_W = 1280;
const MENU_H = 720;

interface EmberParticle {
  image: Phaser.GameObjects.Image;
  speed: number;
  phase: number;
  drift: number;
}

interface SmokePuff {
  image: Phaser.GameObjects.Image;
  life: number;
  seed: number;
}

interface Firefly {
  image: Phaser.GameObjects.Image;
  phase: number;
  speed: number;
  baseX: number;
  baseY: number;
}

/**
 * Main menu backdrop: a dusk village silhouette with drifting chimney smoke,
 * a burning cigarette figure on the hill, embers, fireflies and (if the world
 * says so) rain. The interactive menu itself is DOM (#ui-root).
 */
export class MainMenuScene extends Phaser.Scene {
  private session!: ReturnType<typeof getSceneSession>;
  private elapsed = 0;
  private transitionPending = false;
  private readonly embers: EmberParticle[] = [];
  private readonly smoke: SmokePuff[] = [];
  private readonly fireflies: Firefly[] = [];
  private readonly stars: { image: Phaser.GameObjects.Image; phase: number }[] = [];
  private readonly clouds: { image: Phaser.GameObjects.Image; baseX: number; y: number }[] = [];
  private readonly rain: Phaser.GameObjects.Image[] = [];
  private figure: Phaser.GameObjects.Container | null = null;
  private figureBody: Phaser.GameObjects.Image | null = null;
  private figureEmber: Phaser.GameObjects.Image | null = null;
  private figureGlow: Phaser.GameObjects.Image | null = null;
  private moonGlow: Phaser.GameObjects.Image | null = null;
  private smokeAccum = 0;
  private wet = false;
  private readonly resizeHandler: () => void;

  constructor() {
    super('MainMenuScene');
    this.resizeHandler = () => this.applyCamera();
  }

  create(): void {
    this.session = getSceneSession();
    this.session.ui.showMainMenu();
    this.transitionPending = false;
    this.elapsed = 0;
    this.cameras.main.setBackgroundColor('#0d0a12');
    this.cameras.main.setBounds(0, 0, MENU_W, MENU_H);
    this.applyCamera();
    this.cameras.main.fadeIn(420, 8, 6, 12);

    const state = this.session.api.getState();
    const season = state.world.environment.season;
    this.wet = state.world.environment.weather === 'rain' || state.world.environment.weather === 'storm';
    this.drawBackdrop(state, season);
    this.buildStars();
    this.buildVillageLights(season);
    this.buildFigure(state);
    this.buildParticles();
    this.buildTitles(state, season);
    if (this.wet) this.buildRain();

    this.scale.on('resize', this.resizeHandler);
    this.events.once('shutdown', () => this.scale.off('resize', this.resizeHandler));
  }

  private applyCamera(): void {
    const zoom = cameraZoomFor(this.scale.width, this.scale.height, MENU_W, MENU_H);
    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(MENU_W / 2, MENU_H / 2);
  }

  // -------------------------------------------------------------------------
  // Static backdrop
  // -------------------------------------------------------------------------

  private drawBackdrop(state: Readonly<GameState>, season: Season): void {
    const palette = seasonPalette(season);
    const night = dayNightPalette(0.16);
    const sky = this.add.graphics().setDepth(-100);
    const top = mixColor(0x0e0b1c, night.skyTop, 0.5);
    const mid = mixColor(0x2a1a34, 0x4a2a3a, 0.5);
    const bottom = mixColor(0x6a3a3a, 0x8a5a4a, 0.6);
    sky.fillGradientStyle(top, top, mid, mid, 1);
    sky.fillRect(0, 0, MENU_W, 300);
    sky.fillGradientStyle(mid, mid, bottom, bottom, 1);
    sky.fillRect(0, 300, MENU_W, 170);
    // Moon with a soft halo.
    this.moonGlow = this.add.image(1004, 132, 'fx.glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xd8d8f0).setAlpha(0.18).setScale(6).setDepth(-95);
    this.add.image(1004, 132, 'fx.moon').setTint(0xe8e4d0).setScale(2.6).setDepth(-94);
    // Distant clouds.
    for (let index = 0; index < 3; index += 1) {
      const cloud = this.add.image(0, 0, 'fx.cloud').setDepth(-92).setTint(0x8a7a90).setAlpha(0.22);
      cloud.setScale(2.2 + index * 0.7, 1.6);
      this.clouds.push({ image: cloud, baseX: 120 + index * 430, y: 110 + index * 46 });
    }
    // Hill layers.
    const hills = this.add.graphics().setDepth(-90);
    hills.fillStyle(mixColor(palette.foliageDark, 0x1a1420, 0.82), 1);
    hills.fillRect(0, 420, MENU_W, 300);
    for (let x = -80; x < MENU_W + 80; x += 220) {
      hills.fillTriangle(x, 470, x + 220, 470, x + 110, 360);
    }
    hills.fillStyle(mixColor(palette.foliageDark, 0x100c14, 0.9), 1);
    hills.fillRect(0, 500, MENU_W, 220);
    for (let x = -60; x < MENU_W + 60; x += 180) {
      hills.fillTriangle(x, 540, x + 180, 540, x + 90, 452);
    }
    // Village silhouette skyline.
    const village = this.add.graphics().setDepth(-88);
    const houseColor = 0x191420;
    const roofColor = 0x100c16;
    for (let index = 0; index < 11; index += 1) {
      const x = 60 + index * 116 + (index % 3) * 14;
      const h = 60 + ((index * 37) % 54);
      const w = 74 + ((index * 23) % 30);
      village.fillStyle(houseColor, 1);
      village.fillRect(x, 470 - h, w, h + 40);
      village.fillStyle(roofColor, 1);
      village.fillTriangle(x - 8, 470 - h, x + w + 8, 470 - h, x + w / 2, 470 - h - 26);
      if (index % 4 === 1) {
        village.fillRect(x + w - 18, 470 - h - 42, 12, 26);
      }
    }
    // Clock tower.
    village.fillStyle(houseColor, 1);
    village.fillRect(596, 250, 74, 260);
    village.fillStyle(roofColor, 1);
    village.fillTriangle(586, 250, 680, 250, 633, 196);
    village.fillStyle(0xe8d8a8, 0.9);
    village.fillCircle(633, 300, 20);
    village.fillStyle(0x1a1420, 1);
    village.fillCircle(633, 300, 16);
    village.fillStyle(0xe8d8a8, 0.9);
    village.fillRect(632, 288, 2, 13);
    village.fillRect(632, 300, 9, 2);
    // Ground + grass silhouette.
    const ground = this.add.graphics().setDepth(-80);
    ground.fillStyle(0x0e0b12, 1);
    ground.fillRect(0, 560, MENU_W, 160);
    ground.fillStyle(0x161018, 1);
    ground.fillRect(0, 600, MENU_W, 120);
    // Lamp post + glow.
    const lampX = 372;
    const lamp = this.add.graphics().setDepth(-70);
    lamp.fillStyle(0x2a2228, 1);
    lamp.fillRect(lampX - 3, 470, 6, 130);
    lamp.fillRect(lampX - 12, 462, 24, 14);
    lamp.fillStyle(0xffe6a0, 1);
    lamp.fillRect(lampX - 8, 466, 16, 8);
    this.add.image(lampX, 470, 'fx.glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd98a).setAlpha(0.22).setScale(3.4).setDepth(-69);
    // Bench + fence foreground.
    const bench = this.add.graphics().setDepth(-68);
    bench.fillStyle(0x241c22, 1);
    bench.fillRect(760, 596, 90, 8);
    bench.fillRect(770, 604, 6, 22);
    bench.fillRect(838, 604, 6, 22);
    bench.fillStyle(0x1c1518, 1);
    for (let index = 0; index < 4; index += 1) bench.fillRect(180 + index * 24, 618 + (index % 2) * 3, 4, 26);
    bench.fillRect(176, 628, 100, 4);
    void state;
    void bottom;
    void shade;
  }

  private buildStars(): void {
    const seed = hashString('menu-stars');
    for (let index = 0; index < 34; index += 1) {
      const image = this.add
        .image(seededValue(seed, index) * MENU_W, 20 + seededValue(seed, index + 100) * 300, 'fx.star')
        .setDepth(-96)
        .setTint(0xf0eee0)
        .setAlpha(0.4 + seededValue(seed, index + 200) * 0.6)
        .setScale(0.7 + seededValue(seed, index + 300) * 1.2);
      this.stars.push({ image, phase: seededValue(seed, index + 400) * 6.28 });
    }
  }

  private buildVillageLights(season: Season): void {
    const seed = hashString('menu-lights' + season);
    const windows = this.add.graphics().setDepth(-87);
    for (let index = 0; index < 26; index += 1) {
      const house = index % 11;
      const x = 74 + house * 116 + 12 + (index % 4) * 16;
      const y = 400 + (index % 5) * 18;
      const lit = seededValue(seed, index) > 0.35;
      windows.fillStyle(lit ? 0xffcf82 : 0x3a3040, lit ? 0.85 : 0.6);
      windows.fillRect(x, y - 60, 8, 10);
    }
    // A string of festival lights over the lane.
    for (let index = 0; index < 16; index += 1) {
      const x = 300 + index * 40;
      const y = 452 + Math.sin(index * 0.9) * 8;
      windows.fillStyle(index % 2 === 0 ? 0xffb066 : 0xffe0a0, 0.8);
      windows.fillRect(x, y, 4, 4);
    }
  }

  private buildFigure(state: Readonly<GameState>): void {
    const x = 1060;
    const y = 600;
    const container = this.add.container(x, y).setDepth(-50);
    const shadow = this.add.image(0, 2, 'fx.shadow').setOrigin(0.5, 0.5).setDisplaySize(54, 16).setAlpha(0.5);
    const body = this.add.image(0, -34, 'player.body.' + this.patternKey(state)).setOrigin(0.5, 1);
    body.setDisplaySize(26, 150);
    body.setTint(this.bodyColor(state));
    const filter = this.add.image(0, 0, 'player.filter').setOrigin(0.5, 1);
    filter.setDisplaySize(26, 34);
    filter.setTint(0xb07a4a);
    const ember = this.add.image(0, -186, 'fx.ember').setBlendMode(Phaser.BlendModes.ADD).setScale(2.2);
    const glow = this.add.image(0, -186, 'fx.glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xff9a4a).setScale(1.8).setAlpha(0.5);
    container.add([shadow, filter, body, glow, ember]);
    // Little paper face.
    const face = this.add.graphics();
    face.fillStyle(0x4a3a30, 1);
    face.fillRect(-6, -158, 3, 4);
    face.fillRect(3, -158, 3, 4);
    face.fillRect(-3, -150, 7, 2);
    container.add(face);
    this.figure = container;
    this.figureBody = body;
    this.figureEmber = ember;
    this.figureGlow = glow;
  }

  private patternKey(state: Readonly<GameState>): string {
    const pattern = state.player.appearance.pattern;
    return pattern === 'stripe' || pattern === 'dots' || pattern === 'zigzag' ? pattern : 'plain';
  }

  private bodyColor(state: Readonly<GameState>): number {
    const raw = state.player.appearance.bodyColor.replace('#', '');
    const parsed = Number.parseInt(raw, 16);
    return Number.isFinite(parsed) ? parsed : 0xf7f3e8;
  }

  private buildParticles(): void {
    const seed = hashString('menu-particles');
    for (let index = 0; index < 46; index += 1) {
      const image = this.add.image(seededValue(seed, index) * MENU_W, 640 + seededValue(seed, index + 50) * 80, 'fx.ember');
      image.setBlendMode(Phaser.BlendModes.ADD).setDepth(-40).setTint(index % 3 === 0 ? 0xffd08a : 0xff9a4a);
      image.setScale(0.5 + seededValue(seed, index + 100) * 1.1);
      this.embers.push({
        image,
        speed: 14 + seededValue(seed, index + 150) * 34,
        phase: seededValue(seed, index + 200) * 6.28,
        drift: seededValue(seed, index + 250) * 2 - 1,
      });
    }
    for (let index = 0; index < 18; index += 1) {
      const image = this.add.image(0, 0, 'fx.smoke').setDepth(-45).setVisible(false);
      this.smoke.push({ image, life: 0, seed: index });
    }
    for (let index = 0; index < 14; index += 1) {
      const image = this.add.image(0, 0, 'fx.firefly').setDepth(-38).setBlendMode(Phaser.BlendModes.ADD).setTint(0xe8f078);
      this.fireflies.push({
        image,
        phase: seededValue(seed, index + 300) * 6.28,
        speed: 0.3 + seededValue(seed, index + 350) * 0.5,
        baseX: 120 + seededValue(seed, index + 400) * 1040,
        baseY: 480 + seededValue(seed, index + 450) * 180,
      });
    }
  }

  private buildRain(): void {
    for (let index = 0; index < 150; index += 1) {
      const image = this.add.image(0, 0, 'fx.raindrop').setDepth(-30).setAlpha(0.35).setTint(0xcfe4f0);
      this.rain.push(image);
    }
  }

  private buildTitles(state: Readonly<GameState>, season: Season): void {
    const night = dayNightPalette(0.18);
    const title = this.add
      .text(MENU_W / 2, 122, "A CIGARETTE'S LIFE", {
        fontFamily: '"Courier New", monospace',
        fontSize: '46px',
        color: '#f6e7c8',
        stroke: '#2a1a1a',
        strokeThickness: 6,
        letterSpacing: 6,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(-20);
    title.setShadow(0, 4, '#00000088', 6, true, true);
    this.add
      .text(MENU_W / 2, 168, 'a living world, burning slowly', {
        fontFamily: '"Courier New", monospace',
        fontSize: '15px',
        color: '#d8b88a',
        letterSpacing: 2,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(-20);
    this.add
      .text(MENU_W / 2, 196, 'the world keeps turning while you are away', {
        fontFamily: '"Courier New", monospace',
        fontSize: '10px',
        color: '#8a7a6a',
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(-20);
    const environment = state.world.environment;
    this.add
      .text(MENU_W - 18, 18, season.toUpperCase() + '  ·  ' + environment.weather.toUpperCase() + '  ·  ' + Math.round(environment.temperature) + '°C', {
        fontFamily: '"Courier New", monospace',
        fontSize: '10px',
        color: '#a89a86',
        resolution: 2,
      })
      .setOrigin(1, 0)
      .setDepth(-20);
    const version = this.add
      .text(18, MENU_H - 16, 'Willowbrook & Ashford  ·  generation ' + state.life.generation, {
        fontFamily: '"Courier New", monospace',
        fontSize: '9px',
        color: '#6a5f58',
        resolution: 2,
      })
      .setOrigin(0, 1)
      .setDepth(-20);
    version.setAlpha(0.8);
    void night;
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(_time: number, delta: number): void {
    const api = this.session.api;
    const screen = api.getScreen();
    if (screen === 'playing') {
      if (!this.transitionPending) {
        this.transitionPending = true;
        this.session.ui.hideMainMenu();
        this.cameras.main.fadeOut(240, 8, 6, 12);
        this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => startWorldScene(this, this.session));
      }
      return;
    }
    if (screen === 'life_end') {
      if (!this.transitionPending) {
        this.transitionPending = true;
        this.cameras.main.fadeOut(220, 8, 6, 12);
        this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('LifeEndScene'));
      }
      return;
    }
    const dt = Math.min(delta, 120);
    this.elapsed += dt;
    const seconds = this.elapsed / 1000;
    this.animateParticles(dt, seconds);
  }

  private animateParticles(dt: number, seconds: number): void {
    const seed = hashString('menu-animate');
    // Embers rise from the ground and the cigarette.
    for (let index = 0; index < this.embers.length; index += 1) {
      const ember = this.embers[index];
      if (!ember) continue;
      ember.image.y -= ember.speed * (dt / 1000);
      ember.image.x += Math.sin(seconds * 0.6 + ember.phase) * 6 * (dt / 1000) + ember.drift * 2 * (dt / 1000);
      ember.image.setAlpha(0.35 + Math.abs(Math.sin(seconds * 0.8 + ember.phase)) * 0.65);
      if (ember.image.y < 300) {
        ember.image.y = 660 + seededValue(seed, index) * 60;
        ember.image.x = seededValue(seed, index + 40) * MENU_W;
      }
    }
    // Figure: breathing sway, ember flicker, smoke.
    if (this.figure && this.figureBody && this.figureEmber && this.figureGlow) {
      this.figure.rotation = Math.sin(seconds * 0.5) * 0.014;
      const flicker = 0.7 + Math.abs(Math.sin(seconds * 3.1)) * 0.3;
      this.figureEmber.setAlpha(flicker).setScale(1.9 + flicker * 0.5);
      this.figureGlow.setAlpha(0.35 + flicker * 0.25);
      const body = this.figureBody;
      body.setDisplaySize(26, 150 + Math.sin(seconds * 0.9) * 2);
    }
    this.smokeAccum += dt;
    if (this.smokeAccum > 240) {
      this.smokeAccum = 0;
      const puff = this.smoke.find((candidate) => candidate.life <= 0);
      if (puff && this.figure) {
        puff.life = 1;
        puff.image.setVisible(true);
        puff.image.setPosition(this.figure.x + seededValue(0x77, puff.seed) * 8 - 4, this.figure.y - 186);
        puff.image.setAlpha(0.3);
        puff.image.setScale(0.7);
      }
    }
    for (const puff of this.smoke) {
      if (puff.life <= 0) continue;
      puff.life -= dt / 2600;
      if (puff.life <= 0) {
        puff.image.setVisible(false);
        continue;
      }
      const age = 1 - puff.life;
      puff.image.y -= (26 + (puff.seed % 4) * 6) * (dt / 1000);
      puff.image.x += (10 + Math.sin(seconds * 0.7 + puff.seed) * 6) * (dt / 1000);
      puff.image.setScale(0.6 + age * 2.4);
      puff.image.setAlpha(puff.life * 0.24);
    }
    // Stars twinkle.
    for (let index = 0; index < this.stars.length; index += 1) {
      const star = this.stars[index];
      if (!star) continue;
      star.image.setAlpha(0.25 + Math.abs(Math.sin(seconds * (0.5 + (index % 5) * 0.12) + star.phase)) * 0.7);
    }
    // Clouds drift slowly.
    for (const cloud of this.clouds) {
      const x = ((cloud.baseX + seconds * 5) % (MENU_W + 400)) - 200;
      cloud.image.setPosition(x, cloud.y);
    }
    // Fireflies.
    for (const firefly of this.fireflies) {
      firefly.image.x = firefly.baseX + Math.sin(seconds * firefly.speed + firefly.phase) * 34;
      firefly.image.y = firefly.baseY + Math.cos(seconds * firefly.speed * 0.8 + firefly.phase) * 22;
      firefly.image.setAlpha(0.2 + Math.abs(Math.sin(seconds * 1.7 + firefly.phase)) * 0.8);
    }
    if (this.moonGlow) this.moonGlow.setAlpha(0.14 + Math.abs(Math.sin(seconds * 0.4)) * 0.08);
    // Rain.
    if (this.rain.length > 0) {
      const width = this.scale.width;
      const height = this.scale.height;
      for (let index = 0; index < this.rain.length; index += 1) {
        const drop = this.rain[index];
        if (!drop) continue;
        const x = ((seededValue(seed, index) * width + seconds * 220 + index * 17) % (width + 60)) - 30;
        const y = ((seededValue(seed, index + 60) * height + seconds * 640 + index * 29) % (height + 70)) - 35;
        drop.setPosition(x, y).setRotation(0.28).setAlpha(0.22);
      }
    }
  }
}