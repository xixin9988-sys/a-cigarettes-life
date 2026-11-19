import Phaser from 'phaser';
import type { GameState } from '../../core/contracts';
import type { Season } from '../../core/SharedTypes';
import type { LocationPlan } from '../../render/layout';
import { dayNightPalette, mixColor, seasonPalette, weatherVisual } from '../../render/palette';
import {
  ambientKind,
  ambientProfile,
  celestialProgress,
  cloudOffset,
  fogBlobOffset,
  fogProfile,
  lightningBolt,
  lightningFlash,
  precipitationKind,
  rainProfile,
  snowProfile,
  starTwinkle,
  windDustProfile,
} from '../../render/effects';
import { clamp01, hashString, seededRange, seededValue, wrapValue } from '../../render/geometry';

interface DriftParticle {
  image: Phaser.GameObjects.Image;
  seedX: number;
  seedY: number;
  speed: number;
}

interface FogBlob {
  image: Phaser.GameObjects.Image;
  lane: number;
  speed: number;
  y: number;
}

interface AmbientParticle {
  image: Phaser.GameObjects.Image;
  seedX: number;
  seedY: number;
  speed: number;
  phase: number;
}

const RAIN_MAX = 260;
const SNOW_MAX = 150;
const DUST_MAX = 34;
const FOG_MAX = 9;
const AMBIENT_MAX = 30;
const STAR_COUNT = 18;

/**
 * Weather / season / day-night atmosphere for a location scene.
 *
 * Purely cosmetic: reads EnvironmentState and renders a sky gradient with sun &
 * moon arc, drifting clouds and stars, rain / snow / fog / wind particles,
 * seasonal ambient particles, a day-night colour wash, interior warm light and
 * deterministic lightning flashes (returned to the scene for camera flashes).
 * All particles are pooled - nothing is allocated per frame.
 */
export class WeatherFXController {
  private readonly scene: Phaser.Scene;
  private readonly plan: LocationPlan;
  private readonly season: Season;
  private readonly sky: Phaser.GameObjects.Graphics;
  private readonly hills: Phaser.GameObjects.Graphics;
  private readonly sun: Phaser.GameObjects.Image;
  private readonly moon: Phaser.GameObjects.Image;
  private readonly clouds: { image: Phaser.GameObjects.Image; baseX: number; y: number }[] = [];
  private readonly stars: { image: Phaser.GameObjects.Image; phase: number }[] = [];
  private readonly rain: DriftParticle[] = [];
  private readonly snow: DriftParticle[] = [];
  private readonly dust: DriftParticle[] = [];
  private readonly fog: FogBlob[] = [];
  private readonly ambient: AmbientParticle[] = [];
  private readonly tint: Phaser.GameObjects.Rectangle;
  private readonly warm: Phaser.GameObjects.Rectangle;
  private readonly flash: Phaser.GameObjects.Rectangle;
  private readonly bolt: Phaser.GameObjects.Graphics;
  private readonly indoor: boolean;
  private readonly worldSeed: number;
  private clockMs = 0;
  private lastSkyKey = '';
  private lastAmbientKind = '';
  private flashPeak = 0;
  private lightningCooldown = 0;

  constructor(scene: Phaser.Scene, plan: LocationPlan, season: Season, worldSeed: number) {
    this.scene = scene;
    this.plan = plan;
    this.season = season;
    this.worldSeed = worldSeed >>> 0;
    this.indoor = plan.indoor || plan.ceilingStyle !== 'sky';
    const width = scene.scale.width;
    const height = scene.scale.height;
    const seed = hashString(plan.id + ':weather');

    this.sky = scene.add.graphics().setDepth(-300);
    this.hills = scene.add.graphics().setDepth(-290);
    this.drawHills();
    this.sun = scene.add.image(0, 0, 'fx.sun').setDepth(-280).setAlpha(0);
    this.moon = scene.add.image(0, 0, 'fx.moon').setDepth(-280).setAlpha(0);
    for (let index = 0; index < 3; index += 1) {
      this.clouds.push({
        image: scene.add.image(0, 0, 'fx.cloud').setDepth(-270).setAlpha(0.4),
        baseX: seededRange(seed, index, 0, width),
        y: 24 + index * 20 + seededRange(seed, index + 10, -8, 8),
      });
    }
    for (let index = 0; index < STAR_COUNT; index += 1) {
      this.stars.push({
        image: scene.add.image(seededRange(seed, index + 20, 20, width - 20), seededRange(seed, index + 40, 8, 92), 'fx.star')
          .setDepth(-275)
          .setAlpha(0)
          .setScale(seededRange(seed, index + 60, 0.6, 1.4)),
        phase: seededValue(seed, index + 80) * 6,
      });
    }
    // Screen-space precipitation pools.
    const rainTint = 0xcfe4f0;
    for (let index = 0; index < RAIN_MAX; index += 1) {
      this.rain.push({
        image: scene.add.image(0, 0, 'fx.raindrop').setScrollFactor(0).setDepth(5100).setVisible(false).setTint(rainTint),
        seedX: seededValue(seed, index + 100),
        seedY: seededValue(seed, index + 400),
        speed: seededRange(seed, index + 700, 0.85, 1.25),
      });
    }
    for (let index = 0; index < SNOW_MAX; index += 1) {
      this.snow.push({
        image: scene.add.image(0, 0, 'fx.snow').setScrollFactor(0).setDepth(5100).setVisible(false),
        seedX: seededValue(seed, index + 1000),
        seedY: seededValue(seed, index + 1300),
        speed: seededRange(seed, index + 1600, 0.7, 1.3),
      });
    }
    for (let index = 0; index < DUST_MAX; index += 1) {
      this.dust.push({
        image: scene.add.image(0, 0, 'fx.winddust').setScrollFactor(0).setDepth(5100).setVisible(false).setTint(0xe8dcc0),
        seedX: seededValue(seed, index + 2000),
        seedY: seededValue(seed, index + 2300),
        speed: seededRange(seed, index + 2600, 0.75, 1.4),
      });
    }
    for (let index = 0; index < FOG_MAX; index += 1) {
      this.fog.push({
        image: scene.add.image(0, 0, 'fx.fog').setScrollFactor(0).setDepth(5150).setVisible(false).setAlpha(0),
        lane: (index + 0.5) / FOG_MAX,
        speed: seededRange(seed, index + 3000, 0.5, 1.2),
        y: seededRange(seed, index + 3300, 0.2, 0.9),
      });
    }
    for (let index = 0; index < AMBIENT_MAX; index += 1) {
      this.ambient.push({
        image: scene.add.image(0, 0, 'fx.petal').setScrollFactor(0).setDepth(5120).setVisible(false),
        seedX: seededValue(seed, index + 4000),
        seedY: seededValue(seed, index + 4300),
        speed: seededRange(seed, index + 4600, 0.6, 1.4),
        phase: seededValue(seed, index + 4900) * 6.28,
      });
    }
    this.tint = scene.add.rectangle(0, 0, width, height, 0x0a0a14, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(5000);
    this.warm = scene.add.rectangle(0, 0, width, height, 0xffcf8a, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(4900);
    this.flash = scene.add.rectangle(0, 0, width, height, 0xffffff, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(5300);
    this.bolt = scene.add.graphics().setScrollFactor(0).setDepth(5200);
    this.resize(width, height);
  }

  private drawHills(): void {
    const palette = seasonPalette(this.season);
    const hills = this.hills;
    hills.clear();
    if (this.indoor) return;
    const band = this.plan.skyHeight;
    const layers = [
      { color: mixColor(palette.foliageDark, 0x8898a8, 0.55), base: band - 6, height: 46, step: 190 },
      { color: mixColor(palette.foliageDark, 0x4a5a6a, 0.4), base: band + 4, height: 34, step: 140 },
    ];
    for (const layer of layers) {
      hills.fillStyle(layer.color, 1);
      hills.fillRect(0, layer.base, this.plan.width, layer.height);
      for (let x = -120; x < this.plan.width + 120; x += layer.step) {
        hills.fillTriangle(x, layer.base + layer.height, x + layer.step, layer.base + layer.height, x + layer.step / 2, layer.base - 18);
      }
    }
    // Distant rooftops silhouette for the village / city horizon.
    hills.fillStyle(mixColor(palette.foliageDark, 0x2a2a34, 0.55), 1);
    for (let index = 0; index < 8; index += 1) {
      const x = 40 + index * 160 + (index % 2) * 40;
      const h = 18 + (index % 3) * 8;
      hills.fillRect(x, band - h, 46, h);
      hills.fillTriangle(x - 4, band - h, x + 50, band - h, x + 23, band - h - 12);
    }
  }

  /** Flash intensity for this frame (0..1); the scene uses it to flash the camera. */
  getFlashPeak(): number {
    return this.flashPeak;
  }

  /** True while the overlay game objects are still alive (false after shutdown). */
  private hasLiveTargets(): boolean {
    return this.tint.scene !== null && this.warm.scene !== null && this.flash.scene !== null && this.tint.geom !== null;
  }

  resize(width: number, height: number): void {
    if (!this.hasLiveTargets()) return;
    this.tint.setSize(width, height);
    this.warm.setSize(width, height);
    this.flash.setSize(width, height);
  }

  update(state: Readonly<GameState>, deltaMs: number): void {
    if (!this.hasLiveTargets()) return;
    this.clockMs += Math.min(deltaMs, 120);
    const environment = state.world.environment;
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    this.tint.setSize(width, height);
    this.warm.setSize(width, height);
    this.flash.setSize(width, height);
    const seconds = this.clockMs / 1000;
    const simSeconds = state.clock.simTimeSeconds;
    const palette = seasonPalette(environment.season);
    const night = dayNightPalette(environment.daylight);
    const weatherLook = weatherVisual(environment.weather, environment.rainIntensity, environment.fogDensity);

    // --- Sky gradient (only redrawn when the daylight bucket changes) ---
    const skyKey = night.stage + ':' + Math.round(environment.daylight * 40) + ':' + weatherLook.skyDarken.toFixed(2);
    if (skyKey !== this.lastSkyKey) {
      this.lastSkyKey = skyKey;
      const top = mixColor(night.skyTop, 0x2a2e3a, weatherLook.skyDarken);
      const bottom = mixColor(night.skyBottom, 0x3a3e4a, weatherLook.skyDarken);
      this.sky.clear();
      if (this.plan.ceilingStyle === 'glass') {
        this.sky.fillGradientStyle(0xdfe8ee, 0xdfe8ee, 0xc8d8e0, 0xc8d8e0, 1);
        this.sky.fillRect(0, 0, this.plan.width, this.plan.height);
      } else if (!this.indoor) {
        const horizon = this.plan.skyHeight + 10;
        this.sky.fillGradientStyle(top, top, bottom, bottom, 1);
        this.sky.fillRect(0, 0, this.plan.width, horizon);
        this.sky.fillStyle(mixColor(bottom, 0x000000, 0.08), 1);
        this.sky.fillRect(0, horizon - 2, this.plan.width, 2);
      }
    }
    // --- Sun & moon arc ---
    if (!this.indoor && this.plan.ceilingStyle === 'sky') {
      const hour = ((simSeconds / 3600) % 24 + 24) % 24;
      const progress = celestialProgress(hour);
      const band = this.plan.skyHeight;
      const sunX = 80 + progress * (this.plan.width - 160);
      const sunY = band - 34 - Math.sin(progress * Math.PI) * 52;
      this.sun.setPosition(sunX, sunY).setAlpha(clamp01(environment.daylight * 1.2) * 0.95);
      this.sun.setTint(mixColor(0xfff4d0, 0xffc070, night.stage === 'day' ? 0 : 0.4));
      const moonProgress = ((hour + 12) % 24) / 24;
      this.moon.setPosition(80 + moonProgress * (this.plan.width - 160), band - 44 - Math.sin(moonProgress * Math.PI) * 44);
      this.moon.setAlpha(clamp01((0.4 - environment.daylight) * 2.4));
      for (let index = 0; index < this.stars.length; index += 1) {
        const star = this.stars[index];
        if (!star) continue;
        star.image.setAlpha(night.starAlpha * starTwinkle(index + star.phase, simSeconds) * (1 - weatherLook.cloudiness * 0.7));
      }
      for (let index = 0; index < this.clouds.length; index += 1) {
        const cloud = this.clouds[index];
        if (!cloud) continue;
        const x = cloudOffset(simSeconds, environment.windSpeed, cloud.baseX + index * 300, this.plan.width);
        cloud.image.setPosition(x, cloud.y);
        cloud.image.setTint(night.cloud);
        cloud.image.setAlpha(0.16 + weatherLook.cloudiness * 0.55);
        cloud.image.setScale(0.8 + index * 0.25, 0.8 + index * 0.2);
      }
    }

    // --- Precipitation / wind particles (screen space) ---
    const canPrecipitate = !this.indoor;
    const precip = precipitationKind(environment.weather, environment.season);
    const rainActive = canPrecipitate && precip === 'rain';
    const snowActive = canPrecipitate && precip === 'snow';
    const dustActive = canPrecipitate && (environment.weather === 'wind' || environment.windSpeed > 0.7);
    const rain = rainProfile(environment.windSpeed, Math.max(environment.rainIntensity, environment.weather === 'storm' ? 0.9 : 0));
    const snow = snowProfile(environment.windSpeed, Math.max(environment.rainIntensity, 0.55));
    const rainCount = rainActive ? Math.min(RAIN_MAX, rain.count) : 0;
    for (let index = 0; index < RAIN_MAX; index += 1) {
      const drop = this.rain[index];
      if (!drop) continue;
      if (index >= rainCount) {
        drop.image.setVisible(false);
        continue;
      }
      const speed = rain.speed * drop.speed;
      const x = wrapValue(drop.seedX * width + seconds * rain.driftX * drop.speed + index * 17, width + 60) - 30;
      const y = wrapValue(drop.seedY * height + seconds * speed + index * 29, height + 70) - 35;
      drop.image.setVisible(true);
      drop.image.setPosition(x, y);
      drop.image.setRotation(Math.atan2(rain.driftX, rain.speed));
      drop.image.setAlpha(rain.alpha);
      drop.image.setScale(1, 0.8 + rain.length / 20);
    }
    const snowCount = snowActive ? Math.min(SNOW_MAX, snow.count) : 0;
    for (let index = 0; index < SNOW_MAX; index += 1) {
      const flake = this.snow[index];
      if (!flake) continue;
      if (index >= snowCount) {
        flake.image.setVisible(false);
        continue;
      }
      const sway = Math.sin(seconds * snow.swaySpeed + index * 1.7) * snow.swayAmplitude;
      const x = wrapValue(flake.seedX * width + seconds * snow.driftX + sway + index * 11, width + 40) - 20;
      const y = wrapValue(flake.seedY * height + seconds * snow.speed * flake.speed + index * 13, height + 40) - 20;
      flake.image.setVisible(true);
      flake.image.setPosition(x, y);
      flake.image.setAlpha(snow.alpha * (0.7 + flake.speed * 0.3));
      flake.image.setScale(flake.speed * 0.9);
    }
    const dust = windDustProfile(environment.windSpeed);
    const dustCount = dustActive ? Math.min(DUST_MAX, dust.count) : 0;
    for (let index = 0; index < DUST_MAX; index += 1) {
      const mote = this.dust[index];
      if (!mote) continue;
      if (index >= dustCount) {
        mote.image.setVisible(false);
        continue;
      }
      const x = wrapValue(mote.seedX * width + seconds * dust.speed * mote.speed, width + 40) - 20;
      const y = wrapValue(mote.seedY * height + Math.sin(seconds * 0.9 + index) * 18, height + 20) - 10;
      mote.image.setVisible(true);
      mote.image.setPosition(x, y).setAlpha(dust.alpha);
    }
    // Fog blobs.
    const fog = fogProfile(environment.fogDensity);
    const fogActive = canPrecipitate && environment.fogDensity > 0.04;
    for (let index = 0; index < FOG_MAX; index += 1) {
      const blob = this.fog[index];
      if (!blob) continue;
      if (!fogActive || index >= fog.blobs) {
        blob.image.setVisible(false);
        continue;
      }
      const x = fogBlobOffset(index, FOG_MAX, seconds, fog.speed * blob.speed, width);
      blob.image.setVisible(true);
      blob.image.setPosition(x, height * blob.y);
      blob.image.setTint(this.plan.indoor ? 0xf0e8d8 : mixColor(weatherLook.fogTint, palette.grass, 0.1));
      blob.image.setAlpha(fog.alpha);
      blob.image.setScale(1.4 + (index % 3) * 0.4, 1.1);
    }
    // Seasonal ambient particles.
    const ambient = ambientProfile(this.season, environment.daylight);
    const ambientActive = !this.indoor && ambient.count > 0;
    if (ambient.kind !== this.lastAmbientKind) {
      this.lastAmbientKind = ambient.kind;
      const texture = ambient.kind === 'petal' ? 'fx.petal' : ambient.kind === 'leaf' ? 'fx.leaf' : ambient.kind === 'firefly' ? 'fx.firefly' : 'fx.mote';
      for (const particle of this.ambient) particle.image.setTexture(texture);
    }
    for (let index = 0; index < AMBIENT_MAX; index += 1) {
      const particle = this.ambient[index];
      if (!particle) continue;
      if (!ambientActive || index >= ambient.count) {
        particle.image.setVisible(false);
        continue;
      }
      const t = seconds * particle.speed;
      let x: number;
      let y: number;
      if (ambient.kind === 'firefly') {
        x = wrapValue(particle.seedX * width + Math.sin(t * 0.6 + particle.phase) * 46, width + 20) - 10;
        y = wrapValue(particle.seedY * height + Math.cos(t * 0.5 + particle.phase) * 34, height + 20) - 10;
      } else if (ambient.kind === 'leaf' || ambient.kind === 'petal') {
        x = wrapValue(particle.seedX * width + t * 28 + Math.sin(t + particle.phase) * 26, width + 30) - 15;
        y = wrapValue(particle.seedY * height + t * 34, height + 30) - 15;
      } else {
        x = wrapValue(particle.seedX * width + Math.sin(t * 0.4 + particle.phase) * 22, width + 20) - 10;
        y = wrapValue(particle.seedY * height + t * ambient.speed * 0.4, height + 20) - 10;
      }
      particle.image.setVisible(true);
      particle.image.setPosition(x, y);
      particle.image.setTint(ambient.color);
      particle.image.setAlpha(ambient.glow ? 0.4 + Math.abs(Math.sin(t * 2 + particle.phase)) * 0.6 : ambient.alpha * 0.7);
      particle.image.setBlendMode(ambient.glow ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
      particle.image.setAngle(ambient.kind === 'leaf' || ambient.kind === 'petal' ? Math.sin(t + particle.phase) * 60 : 0);
    }

    // --- Day/night + weather wash ---
    const extraWeather = this.indoor ? weatherLook.tintAlpha * 0.25 : weatherLook.tintAlpha;
    const washAlpha = this.indoor ? night.ambientAlpha * 0.45 : night.ambientAlpha;
    this.tint.setFillStyle(mixColor(night.ambientColor, weatherLook.tint, 0.5), clamp01(washAlpha + extraWeather));
    this.warm.setFillStyle(palette.flowerAlt, this.indoor ? night.lightStrength * 0.05 : 0);

    // --- Lightning ---
    this.flashPeak = 0;
    if (!this.indoor && environment.weather === 'storm') {
      const intensity = lightningFlash(simSeconds, this.worldSeed);
      if (intensity > this.flashPeak) this.flashPeak = intensity;
      this.flash.setFillStyle(0xfff8e8, intensity * 0.32);
      this.bolt.clear();
      this.lightningCooldown = Math.max(0, this.lightningCooldown - deltaMs);
      if (intensity > 0.8 && this.lightningCooldown <= 0) {
        this.lightningCooldown = 400;
        const seed = Math.floor(simSeconds / (7 + (this.worldSeed % 6)));
        const startX = 120 + seededValue(this.worldSeed + seed, 1) * (this.plan.width - 240);
        const points = lightningBolt(this.worldSeed + seed, startX, 4, this.plan.skyHeight + 90, 8);
        this.bolt.lineStyle(2, 0xfffbe8, 0.9);
        for (let index = 0; index < points.length - 1; index += 1) {
          const a = points[index];
          const b = points[index + 1];
          if (a && b) this.bolt.lineBetween(a.x, a.y, b.x, b.y);
        }
        this.bolt.lineStyle(4, 0xfff2c0, 0.35);
        for (let index = 0; index < points.length - 1; index += 1) {
          const a = points[index];
          const b = points[index + 1];
          if (a && b) this.bolt.lineBetween(a.x, a.y, b.x, b.y);
        }
      }
    } else {
      this.flash.setFillStyle(0xffffff, 0);
      this.bolt.clear();
    }
  }

  destroy(): void {
    // Scene shutdown destroys the display list automatically; nothing global is held.
  }
}