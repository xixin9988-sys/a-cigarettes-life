import Phaser from 'phaser';
import type { ArchivedLife, GameState } from '../core/contracts';
import { getSceneSession } from './session';
import { startWorldScene } from './sceneRouter';
import { cameraZoomFor, seededValue } from '../render/geometry';
import { fadeToScene } from './sceneRouter';

const END_W = 1280;
const END_H = 720;

interface Puff {
  image: Phaser.GameObjects.Image;
  life: number;
  seed: number;
}

interface Spark {
  image: Phaser.GameObjects.Image;
  life: number;
}

/**
 * End-of-life burnout sequence: the cigarette burns down to the filter while the
 * room warms with ember light, smoke thickens, then fades to black and the
 * DOM life-review modal is shown. Polls the screen state so "new life" works.
 */
export class LifeEndScene extends Phaser.Scene {
  private session!: ReturnType<typeof getSceneSession>;
  private review: ArchivedLife | null = null;
  private reviewShown = false;
  private finished = false;
  private elapsed = 0;
  private smokeAccum = 0;
  private burnDuration = 7200;
  private body: Phaser.GameObjects.Image | null = null;
  private filter: Phaser.GameObjects.Image | null = null;
  private emberCore: Phaser.GameObjects.Image | null = null;
  private emberGlow: Phaser.GameObjects.Image | null = null;
  private face: Phaser.GameObjects.Graphics | null = null;
  private readonly puffs: Puff[] = [];
  private readonly sparks: Spark[] = [];
  private readonly resizeHandler: () => void;
  private transitioning = false;

  constructor() {
    super('LifeEndScene');
    this.resizeHandler = () => this.applyCamera();
  }

  create(): void {
    this.session = getSceneSession();
    this.reviewShown = false;
    this.finished = false;
    this.elapsed = 0;
    this.smokeAccum = 0;
    this.transitioning = false;
    const api = this.session.api;
    this.review = api.getSystems().life.getLifeReview() ?? api.getLifeArchive()[api.getLifeArchive().length - 1] ?? null;
    this.cameras.main.setBackgroundColor('#08060a');
    this.cameras.main.setBounds(0, 0, END_W, END_H);
    this.applyCamera();
    this.cameras.main.fadeIn(500, 0, 0, 0);
    this.buildScene(api.getState());
    this.buildTimeline();
    this.scale.on('resize', this.resizeHandler);
    this.events.once('shutdown', () => this.scale.off('resize', this.resizeHandler));
  }

  private applyCamera(): void {
    const zoom = cameraZoomFor(this.scale.width, this.scale.height, END_W, END_H);
    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(END_W / 2, END_H / 2);
  }

  private buildScene(state: Readonly<GameState>): void {
    // Warm room glow.
    this.add.image(END_W / 2, END_H - 90, 'fx.glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xff9a4a).setScale(9).setAlpha(0.1).setDepth(-50);
    const vignette = this.add.graphics().setDepth(40);
    vignette.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.75, 0.75, 0, 0);
    vignette.fillRect(0, 0, END_W, 190);
    vignette.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.9, 0.9);
    vignette.fillRect(0, END_H - 220, END_W, 220);
    const floor = this.add.graphics().setDepth(-40);
    floor.fillStyle(0x120e14, 1);
    floor.fillRect(0, 610, END_W, 110);
    floor.fillStyle(0x1a141c, 1);
    floor.fillRect(0, 640, END_W, 80);
    // The cigarette: body shrinks to the filter over the sequence.
    const filterHeight = 46;
    const baseY = 646;
    this.add.image(END_W / 2, baseY + 6, 'fx.shadow').setOrigin(0.5, 0.5).setDisplaySize(120, 30).setAlpha(0.5).setDepth(-30);
    this.filter = this.add.image(END_W / 2, baseY, 'player.filter').setOrigin(0.5, 1).setDepth(-20);
    this.filter.setDisplaySize(46, filterHeight);
    this.filter.setTint(0xb07a4a);
    this.body = this.add.image(END_W / 2, baseY - filterHeight, 'player.body.' + this.patternKey(state)).setOrigin(0.5, 1).setDepth(-20);
    this.body.setDisplaySize(46, 260);
    this.body.setTint(this.bodyColor(state));
    this.face = this.add.graphics().setDepth(-19);
    this.drawFace(260 + filterHeight);
    this.emberGlow = this.add.image(END_W / 2, baseY - filterHeight - 260, 'fx.glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xff8a3a).setScale(2.4).setAlpha(0.55).setDepth(-18);
    this.emberCore = this.add.image(END_W / 2, baseY - filterHeight - 260, 'fx.ember').setBlendMode(Phaser.BlendModes.ADD).setScale(2.4).setDepth(-17);
    // Smoke and sparks.
    for (let index = 0; index < 30; index += 1) {
      const image = this.add.image(0, 0, 'fx.smoke').setDepth(-10).setVisible(false);
      this.puffs.push({ image, life: 0, seed: index });
    }
    for (let index = 0; index < 10; index += 1) {
      const image = this.add.image(0, 0, 'fx.spark').setBlendMode(Phaser.BlendModes.ADD).setDepth(-5).setVisible(false);
      this.sparks.push({ image, life: 0 });
    }
    // Headline text.
    const headline = this.add
      .text(END_W / 2, 120, 'the last of the smoke', {
        fontFamily: '"Courier New", monospace',
        fontSize: '26px',
        color: '#f0dfc4',
        letterSpacing: 3,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(50)
      .setAlpha(0);
    this.tweens.add({ targets: headline, alpha: 1, duration: 1400, delay: 900, ease: 'Sine.easeOut' });
    const review = this.review;
    if (review) {
      const summary =
        review.name +
        '  ·  generation ' +
        review.generation +
        '\n' +
        review.durationDays +
        ' days lived  ·  ' +
        this.money(review.finalMoney) +
        '  ·  ' +
        review.importantPeople.length +
        ' remembered people\n' +
        (review.endReason ? 'cause: ' + review.endReason : 'a life, complete');
      const stats = this.add
        .text(END_W / 2, 176, summary, {
          fontFamily: '"Courier New", monospace',
          fontSize: '12px',
          color: '#b8a890',
          align: 'center',
          lineSpacing: 6,
          resolution: 2,
        })
        .setOrigin(0.5, 0)
        .setDepth(50)
        .setAlpha(0);
      this.tweens.add({ targets: stats, alpha: 1, duration: 1600, delay: 3000, ease: 'Sine.easeOut' });
    }
  }

  private patternKey(state: Readonly<GameState>): string {
    const pattern = state.player.appearance.pattern;
    return pattern === 'stripe' || pattern === 'dots' || pattern === 'zigzag' ? pattern : 'plain';
  }

  private bodyColor(state: Readonly<GameState>): number {
    const parsed = Number.parseInt(state.player.appearance.bodyColor.replace('#', ''), 16);
    return Number.isFinite(parsed) ? parsed : 0xf7f3e8;
  }

  private drawFace(bodyHeight: number): void {
    if (!this.face) return;
    this.face.clear();
    const topY = 646 - 46 - bodyHeight;
    const faceY = topY + 34;
    this.face.fillStyle(0x4a3a30, 1);
    this.face.fillRect(END_W / 2 - 12, faceY, 5, 6);
    this.face.fillRect(END_W / 2 + 7, faceY, 5, 6);
    this.face.fillRect(END_W / 2 - 6, faceY + 14, 12, 3);
    this.face.fillStyle(0xffffff, 0.75);
    this.face.fillRect(END_W / 2 - 12, faceY, 2, 2);
    this.face.fillRect(END_W / 2 + 7, faceY, 2, 2);
  }

  private buildTimeline(): void {
    const body = this.body;
    if (body) {
      this.tweens.add({
        targets: body,
        displayHeight: 8,
        duration: this.burnDuration,
        ease: 'Sine.easeIn',
      });
    }
    const filter = this.filter;
    if (filter) {
      this.tweens.add({ targets: filter, displayHeight: 40, duration: this.burnDuration, ease: 'Sine.easeIn' });
    }
    this.time.delayedCall(this.burnDuration, () => {
      this.finished = true;
      this.cameras.main.flash(220, 255, 180, 120);
      this.cameras.main.fadeOut(1300, 0, 0, 0);
      this.time.delayedCall(1400, () => this.showReview());
    });
  }

  private showReview(): void {
    if (this.reviewShown) return;
    this.reviewShown = true;
    if (this.review) this.session.ui.showLifeReview(this.review);
    else this.session.ui.showNotification('The archive could not find this life.', 'warning');
  }

  private money(pence: number): string {
    const whole = Math.floor(Math.abs(pence) / 100);
    const pennies = Math.abs(pence) % 100;
    return (pence < 0 ? '-£' : '£') + whole + '.' + String(pennies).padStart(2, '0');
  }

  update(_time: number, delta: number): void {
    const api = this.session.api;
    const screen = api.getScreen();
    if (screen === 'playing') {
      if (!this.transitioning) {
        this.transitioning = true;
        startWorldScene(this, this.session);
      }
      return;
    }
    if (screen === 'menu') {
      if (!this.transitioning) {
        this.transitioning = true;
        fadeToScene(this, 'MainMenuScene');
      }
      return;
    }
    const dt = Math.min(delta, 120);
    this.elapsed += dt;
    this.animateBurn(dt);
  }

  private animateBurn(dt: number): void {
    const seconds = this.elapsed / 1000;
    const progress = Math.min(1, this.elapsed / this.burnDuration);
    const baseY = 646;
    const body = this.body;
    const emberY = baseY - 46 - (body ? body.displayHeight : 0);
    if (this.face && body) this.drawFace(body.displayHeight);
    if (this.emberCore) {
      this.emberCore.setPosition(END_W / 2, emberY);
      this.emberCore.setAlpha(0.7 + Math.abs(Math.sin(seconds * 4)) * 0.3);
      this.emberCore.setScale(2.4 + Math.sin(seconds * 5) * 0.6);
    }
    if (this.emberGlow) {
      this.emberGlow.setPosition(END_W / 2, emberY);
      this.emberGlow.setAlpha(0.4 + Math.abs(Math.sin(seconds * 3)) * 0.35);
      this.emberGlow.setScale(2.2 + progress * 2.2);
    }
    // Smoke gets thicker as the cigarette shortens.
    this.smokeAccum += dt;
    const interval = 260 - progress * 170;
    if (this.smokeAccum > interval) {
      this.smokeAccum = 0;
      const puff = this.puffs.find((candidate) => candidate.life <= 0);
      if (puff) {
        puff.life = 1;
        puff.image.setVisible(true);
        puff.image.setPosition(END_W / 2 + seededValue(0x31, puff.seed) * 18 - 9, emberY);
        puff.image.setAlpha(0.25 + progress * 0.2);
        puff.image.setScale(0.6 + progress * 0.6);
      }
    }
    for (const puff of this.puffs) {
      if (puff.life <= 0) continue;
      puff.life -= dt / 3200;
      if (puff.life <= 0) {
        puff.image.setVisible(false);
        continue;
      }
      const age = 1 - puff.life;
      puff.image.y -= (20 + progress * 30) * (dt / 1000);
      puff.image.x += (6 + Math.sin(seconds + puff.seed) * 8) * (dt / 1000);
      puff.image.setScale(0.6 + age * (2.6 + progress * 2));
      puff.image.setAlpha(puff.life * (0.2 + progress * 0.18));
      puff.image.setAngle((puff.seed % 5 - 2) * 5);
    }
    // Ember sparks in the final third (deterministic cadence).
    if (progress > 0.55 && Math.floor(this.elapsed / 90) % 3 === 0) {
      const spark = this.sparks.find((candidate) => candidate.life <= 0);
      if (spark) {
        spark.life = 1;
        spark.image.setVisible(true);
        spark.image.setPosition(END_W / 2, emberY);
        spark.image.setAlpha(1);
      }
    }
    for (const spark of this.sparks) {
      if (spark.life <= 0) continue;
      spark.life -= dt / 1200;
      if (spark.life <= 0) {
        spark.image.setVisible(false);
        continue;
      }
      spark.image.y -= 26 * (dt / 1000);
      spark.image.x += Math.sin(seconds * 2 + spark.image.y * 0.01) * 14 * (dt / 1000);
      spark.image.setAlpha(spark.life * 0.9);
      spark.image.setScale(0.6 + spark.life);
    }
  }
}