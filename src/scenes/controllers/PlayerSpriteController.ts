import Phaser from 'phaser';
import type { GameState } from '../../core/contracts';
import { cigaretteVisual, playerFaceGlyph, playerPatternKey, smokePuffOffset } from '../../render/figures';
import { colorFromHex, mixColor } from '../../render/palette';

interface SmokePuff {
  image: Phaser.GameObjects.Image;
  life: number;
  seed: number;
  steam: boolean;
}

interface EmberSpark {
  image: Phaser.GameObjects.Image;
  life: number;
  vx: number;
  vy: number;
}

const PUFF_COUNT = 16;
const SPARK_COUNT = 5;
const LEG_HEIGHT = 8;

/**
 * The anthropomorphic cigarette player.
 *
 * Renders as a few tinted sprites plus two small Graphics layers (face, limbs):
 *  - paper body with pattern + body/filter colours from the player appearance,
 *  - dynamic shortening from cigarette.lengthRatio,
 *  - ember tip with additive glow, wind-driven smoke / steam puffs and sparks,
 *  - moisture droop, wind lean, walk bob, umbrella when equipped.
 */
export class PlayerSpriteController extends Phaser.GameObjects.Container {
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly bodyImage: Phaser.GameObjects.Image;
  private readonly filterImage: Phaser.GameObjects.Image;
  private readonly emberGlow: Phaser.GameObjects.Image;
  private readonly emberCore: Phaser.GameObjects.Image;
  private readonly umbrella: Phaser.GameObjects.Image;
  private readonly caseImage: Phaser.GameObjects.Image;
  private readonly hat: Phaser.GameObjects.Image;
  private readonly face: Phaser.GameObjects.Graphics;
  private readonly limbs: Phaser.GameObjects.Graphics;
  private readonly puffs: SmokePuff[] = [];
  private readonly sparks: EmberSpark[] = [];
  private smokeAccum = 0;
  private sparkAccum = 0;
  private puffCounter = 0;
  private clock = 0;
  private walkPhase = 0;
  private lastPattern = '';
  private lastFace = '';
  private lastFaceHeight = -1;
  private emberFlicker = 0;
  private footX = 0;
  private footY = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, state: Readonly<GameState>) {
    super(scene, x, y);
    this.footX = x;
    this.footY = y;
    this.shadow = scene.add.image(0, 0, 'fx.shadow').setOrigin(0.5, 0.5).setAlpha(0.55);
    this.limbs = scene.add.graphics();
    this.bodyImage = scene.add.image(0, -LEG_HEIGHT, 'player.body.plain').setOrigin(0.5, 1);
    this.filterImage = scene.add.image(0, -LEG_HEIGHT, 'player.filter').setOrigin(0.5, 1);
    this.face = scene.add.graphics();
    this.emberGlow = scene.add.image(0, 0, 'fx.glow').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.emberCore = scene.add.image(0, 0, 'fx.ember').setBlendMode(Phaser.BlendModes.ADD);
    this.umbrella = scene.add.image(0, 0, 'player.umb').setOrigin(0.5, 1).setVisible(false);
    this.hat = scene.add.image(0, 0, 'npc.hat.cap').setOrigin(0.5, 1).setVisible(false);
    this.caseImage = scene.add.image(0, 0, 'player.case').setVisible(false);
    this.add([this.shadow, this.limbs, this.caseImage, this.umbrella, this.bodyImage, this.filterImage, this.face, this.emberGlow, this.emberCore, this.hat]);
    for (let index = 0; index < PUFF_COUNT; index += 1) {
      const image = scene.add.image(0, 0, 'fx.smoke').setVisible(false);
      this.add(image);
      this.puffs.push({ image, life: 0, seed: index, steam: false });
    }
    for (let index = 0; index < SPARK_COUNT; index += 1) {
      const image = scene.add.image(0, 0, 'fx.spark').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      this.add(image);
      this.sparks.push({ image, life: 0, vx: 0, vy: 0 });
    }
    scene.add.existing(this);
    this.applyAppearance(state);
  }

  private applyAppearance(state: Readonly<GameState>): void {
    const appearance = state.player.appearance;
    this.bodyImage.setTint(colorFromHex(appearance.bodyColor, 0xf7f3e8));
    this.filterImage.setTint(colorFromHex(appearance.filterColor, 0xb07a4a));
  }

  /** Repositions the character's feet. Screen depth must be managed by the scene. */
  setFootPosition(x: number, y: number): void {
    this.footX = x;
    this.footY = y;
  }

  /** Foot position in world pixels (the sprite bobs around this point). */
  getFootX(): number {
    return this.footX;
  }

  getFootY(): number {
    return this.footY;
  }

  updateFromState(
    state: Readonly<GameState>,
    deltaMs: number,
    moving: boolean,
    talking: boolean,
    windSpeed: number,
    windDirectionDeg: number,
    daylight: number,
    wet: boolean,
    indoor: boolean
  ): void {
    const appearance = state.player.appearance;
    const condition = state.player.cigarette;
    const dt = Math.min(deltaMs, 120);
    this.clock += dt;

    const visual = cigaretteVisual(condition, windSpeed, windDirectionDeg, indoor, moving, daylight);
    const pattern = playerPatternKey(appearance.pattern);
    if (pattern !== this.lastPattern) {
      this.lastPattern = pattern;
      this.bodyImage.setTexture('player.body.' + pattern);
    }
    this.applyAppearance(state);

    const bodyHeight = visual.heightPx;
    const filterHeight = visual.filterHeightPx;
    const wetTint = mixColor(colorFromHex(appearance.bodyColor, 0xf7f3e8), 0x8fa8b8, condition.moisture * 0.32);
    this.bodyImage.setTint(wetTint);
    this.bodyImage.setDisplaySize(14, bodyHeight);
    this.bodyImage.y = -LEG_HEIGHT - filterHeight;
    this.filterImage.setDisplaySize(14, filterHeight);
    this.filterImage.y = -LEG_HEIGHT;

    // Walking: alternate little legs and arms.
    this.walkPhase += moving ? dt * 0.012 : dt * 0.003;
    const stride = moving ? Math.sin(this.walkPhase) * 3 : 0;
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 2.4 : Math.sin(this.clock * 0.0026) * 0.8;
    this.limbs.clear();
    this.limbs.fillStyle(0xe8dcc4, 1);
    this.limbs.fillRect(-5 + stride * 0.4, -LEG_HEIGHT, 4, LEG_HEIGHT);
    this.limbs.fillRect(1 - stride * 0.4, -LEG_HEIGHT, 4, LEG_HEIGHT);
    // Arms: thin paper strips sticking out of the body.
    this.limbs.fillStyle(0xf0e8d8, 0.95);
    this.limbs.fillRect(-9, -LEG_HEIGHT - filterHeight - bodyHeight * 0.55 + stride, 3, 9);
    this.limbs.fillRect(6, -LEG_HEIGHT - filterHeight - bodyHeight * 0.55 - stride, 3, 9);

    this.x = this.footX;
    this.y = this.footY - bob;
    this.rotation = visual.droopRad + visual.leanRad + (moving ? Math.sin(this.walkPhase * 2) * 0.02 : 0);
    this.shadow.setDisplaySize(20 - bodyHeight * 0.12, 7);
    this.shadow.setAlpha(0.4 + (1 - bodyHeight / 46) * 0.1);

    // Face - redraw only when the expression or the body height changes noticeably.
    const glyph = playerFaceGlyph(appearance, condition, moving, talking);
    if (glyph !== this.lastFace || Math.abs(bodyHeight - this.lastFaceHeight) > 1) {
      this.lastFace = glyph;
      this.lastFaceHeight = bodyHeight;
      this.drawFace(glyph, bodyHeight, filterHeight);
    }

    // Ember tip.
    this.emberFlicker = 0.65 + Math.sin(this.clock * 0.013) * 0.18 + Math.sin(this.clock * 0.031) * 0.1;
    const emberY = -LEG_HEIGHT - filterHeight - bodyHeight;
    this.emberCore.setPosition(0, emberY);
    this.emberCore.setTint(visual.emberColor);
    this.emberCore.setAlpha(visual.emberAlpha * (0.85 + this.emberFlicker * 0.2));
    this.emberCore.setScale(0.7 + visual.emberRadius * 0.08);
    this.emberGlow.setPosition(0, emberY);
    this.emberGlow.setTint(visual.emberColor);
    this.emberGlow.setScale(0.35 + visual.emberRadius * 0.055 + this.emberFlicker * 0.06);
    this.emberGlow.setAlpha(visual.glowStrength * 0.55 * this.emberFlicker);

    // Equipment accessories.
    const equipment = state.player.equipment;
    const showUmbrella = equipment.umbrella !== null && !indoor && wet;
    this.umbrella.setVisible(showUmbrella);
    if (showUmbrella) {
      this.umbrella.setPosition(4, emberY - 6);
      this.umbrella.setTint(colorFromHex('#b85a5a', 0xb85a5a));
      this.umbrella.setScale(0.9);
    }
    this.hat.setVisible(equipment.hat !== null);
    if (equipment.hat !== null) {
      this.hat.setPosition(0, emberY + 4);
      this.hat.setTint(colorFromHex('#5a4a6a', 0x5a4a6a));
    }
    this.caseImage.setVisible(equipment.case !== null);
    if (equipment.case !== null) {
      this.caseImage.setPosition(-10, -LEG_HEIGHT - filterHeight - bodyHeight * 0.45);
      this.caseImage.setTint(colorFromHex('#8a5a3a', 0x8a5a3a));
    }

    // Smoke / steam puffs.
    this.smokeAccum += dt;
    const interval = 1000 / Math.max(0.4, visual.smokeRate);
    if (this.smokeAccum >= interval) {
      this.smokeAccum = 0;
      this.spawnPuff(emberY, visual.steam);
    }
    const wind = { x: Math.sin((windDirectionDeg * Math.PI) / 180), y: -Math.cos((windDirectionDeg * Math.PI) / 180) };
    const windStrength = 6 + windSpeed * 46;
    for (const puff of this.puffs) {
      if (puff.life <= 0) continue;
      puff.life -= dt / (1700 + (puff.seed % 5) * 240);
      if (puff.life <= 0) {
        puff.image.setVisible(false);
        continue;
      }
      const age = 1 - puff.life;
      puff.image.x += (wind.x * windStrength + Math.sin(this.clock * 0.002 + puff.seed) * 3) * (dt / 1000);
      puff.image.y += (-visual.smokeRise * puff.life - wind.y * windStrength * 0.15) * (dt / 1000);
      puff.image.setScale(0.5 + age * 1.9 + (puff.seed % 3) * 0.1);
      puff.image.setAlpha(Math.min(0.5, puff.life * 0.55) * (puff.steam ? 0.9 : 0.75));
      puff.image.setAngle((puff.seed % 5 - 2) * 4);
      puff.image.setTint(puff.steam ? 0xe4f4ff : 0xd8d8d4);
    }
    // Ember sparks drift up and die.
    this.sparkAccum += dt;
    if (this.sparkAccum > 220 && visual.emberAlpha > 0.45) {
      this.sparkAccum = 0;
      this.spawnSpark(emberY, wind.x, wind.y);
    }
    for (const spark of this.sparks) {
      if (spark.life <= 0) continue;
      spark.life -= dt / 900;
      if (spark.life <= 0) {
        spark.image.setVisible(false);
        continue;
      }
      spark.image.x += spark.vx * (dt / 1000);
      spark.image.y += spark.vy * (dt / 1000);
      spark.vy -= 8 * (dt / 1000);
      spark.image.setTint(0xffb060);
      spark.image.setAlpha(spark.life * 0.9);
      spark.image.setScale(0.5 + spark.life * 0.6);
    }
  }

  private spawnPuff(emberY: number, steam: boolean): void {
    const puff = this.puffs.find((candidate) => candidate.life <= 0);
    if (!puff) return;
    const offset = smokePuffOffset(this.puffCounter % 97);
    this.puffCounter += 1;
    puff.life = 1;
    puff.steam = steam;
    puff.image.setTexture(steam ? 'fx.steam' : 'fx.smoke');
    puff.image.setVisible(true);
    puff.image.setPosition(offset.x, emberY + offset.y);
    puff.image.setAlpha(0.35);
    puff.image.setScale(0.5 + offset.scale * 0.2);
    puff.image.setAngle(0);
  }

  private spawnSpark(emberY: number, windX: number, windY: number): void {
    const spark = this.sparks.find((candidate) => candidate.life <= 0);
    if (!spark) return;
    spark.life = 1;
    spark.image.setVisible(true);
    spark.image.setPosition(0, emberY);
    spark.vx = windX * 34 + (this.puffCounter % 7 - 3) * 4;
    spark.vy = -26 - (this.puffCounter % 5) * 5 + windY * 8;
    spark.image.setAlpha(1);
    spark.image.setScale(0.6);
  }

  private drawFace(glyph: ReturnType<typeof playerFaceGlyph>, bodyHeight: number, filterHeight: number): void {
    const graphics = this.face;
    graphics.clear();
    const topY = -LEG_HEIGHT - filterHeight - bodyHeight;
    const faceY = topY + Math.min(18, bodyHeight * 0.42);
    graphics.fillStyle(0x4a3a30, 1);
    const eyeY = faceY;
    if (bodyHeight < 16) {
      graphics.fillRect(-1, eyeY, 2, 1);
      return;
    }
    if (glyph === 'sleepy') {
      graphics.fillRect(-4, eyeY, 3, 1);
      graphics.fillRect(2, eyeY, 3, 1);
    } else if (glyph === 'wink') {
      graphics.fillRect(-4, eyeY, 3, 2);
      graphics.fillRect(2, eyeY, 2, 1);
    } else if (glyph === 'surprised') {
      graphics.fillRect(-4, eyeY, 2, 3);
      graphics.fillRect(3, eyeY, 2, 3);
    } else {
      graphics.fillRect(-4, eyeY, 2, 2);
      graphics.fillRect(3, eyeY, 2, 2);
      graphics.fillStyle(0xffffff, 0.85);
      graphics.fillRect(-4, eyeY, 1, 1);
      graphics.fillRect(3, eyeY, 1, 1);
    }
    // Mouth.
    graphics.fillStyle(0x5a4034, 1);
    if (glyph === 'smile') {
      graphics.fillRect(-2, eyeY + 5, 5, 1);
      graphics.fillRect(-3, eyeY + 4, 1, 1);
      graphics.fillRect(3, eyeY + 4, 1, 1);
    } else if (glyph === 'neutral') {
      graphics.fillRect(-2, eyeY + 5, 4, 1);
    } else if (glyph === 'surprised') {
      graphics.fillRect(-1, eyeY + 5, 2, 2);
    } else {
      graphics.fillRect(-1, eyeY + 5, 2, 1);
    }
    // Blush for happy / affectionate moods.
    if (glyph === 'smile') {
      graphics.fillStyle(0xe8a0a0, 0.4);
      graphics.fillRect(-6, eyeY + 3, 2, 1);
      graphics.fillRect(4, eyeY + 3, 2, 1);
    }
  }
}