import Phaser from 'phaser';
import type { ActionResult, GameState, IContentRegistry, NPCState } from '../core/contracts';
import type { LocationDef } from '../data/schema';
import type { NPCId } from '../core/SharedTypes';
import type { ISceneSession } from '../ui/UIInterfaces';
import { getSceneSession } from './session';
import { dayNightPalette } from '../render/palette';
import {
  cameraZoomFor,
  circleIntersectsRect,
  clamp01,
  distanceSq,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  sceneToStatePosition,
  stateToScenePosition,
} from '../render/geometry';
import { buildLocationPlan, clampToWalkable, resolveForagePoint, type FacilityPlan, type LocationPlan } from '../render/layout';
import { SEASON_DISPLAY_NAMES, WEATHER_DISPLAY_NAMES } from '../core/SharedTypes';
import { simSecondsToGameTime } from '../core/TimeUtil';
import { interiorIdFor } from '../data/locations/ids';
import { fadeToScene, worldSceneKeyForLocation } from './sceneRouter';
import { WorldRenderer } from './controllers/WorldRenderer';
import { WeatherFXController } from './controllers/WeatherFXController';
import { PlayerSpriteController } from './controllers/PlayerSpriteController';
import { NPCSpriteController } from './controllers/NPCSpriteController';

interface StaticTarget {
  kind: 'exit' | 'door' | 'facility' | 'search';
  id: string;
  label: string;
  x: number;
  y: number;
  radius: number;
}

interface ForageMarker {
  nodeId: string;
  label: string;
  marker: Phaser.GameObjects.Image;
  x: number;
  y: number;
}

interface PlotVisual {
  plotId: string;
  sceneX: number;
  sceneY: number;
  patch: Phaser.GameObjects.Image;
  crop: Phaser.GameObjects.Image;
  stage: string;
  cropStage: number;
  cropColor: number;
}

export interface InteractionTarget {
  kind: string;
  label: string;
  x: number;
  y: number;
}

const ENTERABLE_KINDS: ReadonlySet<string> = new Set([
  'residence',
  'cafe',
  'bakery',
  'flower_shop',
  'grocery',
  'bookshop',
  'post_office',
  'library',
  'market',
  'farm',
  'greenhouse',
  'train_station',
  'warehouse',
  'abandoned_farmhouse',
  'hidden_garden',
  'shopping_mall',
  'supermarket',
  'convenience_store',
  'clothing_shop',
  'furniture_shop',
  'electronics_shop',
  'restaurant',
  'city_cafe',
  'museum',
  'city_library',
  'cinema',
  'apartments',
  'cultural_center',
  'office_district',
  'event_square',
]);

const PLAYER_RADIUS = 9;

/**
 * Shared world scene: builds the location from its deterministic plan, renders
 * player/NPCs/weather, handles movement, collisions, interactions (E / click)
 * and scene transitions. Subclasses only supply the scene key.
 *
 * All game state is read through getSceneSession().api and every change is
 * dispatched as a GameAction - the scene never mutates GameState directly.
 */
export abstract class BaseWorldScene extends Phaser.Scene {
  protected session!: ISceneSession;
  private content!: IContentRegistry;
  private locationId = '';
  private locationDef!: LocationDef;
  private plan!: LocationPlan;
  private worldRenderer: WorldRenderer | null = null;
  private weather: WeatherFXController | null = null;
  private player: PlayerSpriteController | null = null;
  private readonly npcSprites = new Map<string, NPCSpriteController>();
  private staticTargets: StaticTarget[] = [];
  private readonly forageMarkers = new Map<string, ForageMarker>();
  private readonly plotVisuals = new Map<string, PlotVisual>();
  private keys!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    interact: Phaser.Input.Keyboard.Key;
  };
  private cursorKeys!: Phaser.Types.Input.Keyboard.CursorKeys;
  private prompt: Phaser.GameObjects.Container | null = null;
  private promptText: Phaser.GameObjects.Text | null = null;
  private promptKey: Phaser.GameObjects.Image | null = null;
  private highlight: Phaser.GameObjects.Graphics | null = null;
  private transitionPending = false;
  private elapsed = 0;
  private sceneReadyAt = 0;
  private lastNpcSync = 0;
  private lastDynamicSync = 0;
  private lastPositionDispatch = 0;
  private lastDispatchX = -1;
  private lastDispatchY = -1;
  private flashCooldown = 0;
  private nearest: InteractionTarget | null = null;
  private readonly resizeHandler: (gameSize: Phaser.Structs.Size) => void;

  protected constructor(key: string) {
    super(key);
    this.resizeHandler = () => this.applyCameraZoom();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  create(): void {
    this.session = getSceneSession();
    const api = this.session.api;
    const screen = api.getScreen();
    if (screen !== 'playing') {
      if (screen === 'life_end') this.scene.start('LifeEndScene');
      else this.scene.start('MainMenuScene');
      return;
    }
    this.content = this.session.content;
    const state = api.getState();
    if (state.life.phase !== 'alive') {
      this.scene.start('LifeEndScene');
      return;
    }
    this.disposeControllers();
    this.locationId = state.player.position.locationId;
    const def = this.content.getLocation(this.locationId);
    if (!def) {
      this.scene.start('MainMenuScene');
      return;
    }
    this.locationDef = def;
    this.lastSeasonSeen = state.world.environment.season;
    this.transitionPending = false;
    this.elapsed = 0;
    this.sceneReadyAt = 0;
    this.lastNpcSync = 0;
    this.lastDynamicSync = 0;
    this.flashCooldown = 0;

    this.plan = this.buildPlan(def, state);
    this.cameras.main.setBackgroundColor(this.plan.indoor ? '#1a161e' : '#20222a');
    this.cameras.main.setBounds(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
    this.cameras.main.setRoundPixels(true);
    this.applyCameraZoom();

    const season = state.world.environment.season;
    this.worldRenderer = new WorldRenderer({ scene: this, plan: this.plan, def, season });
    this.weather = new WeatherFXController(this, this.plan, season, state.world.seed);
    this.weather.resize(this.scale.width, this.scale.height);
    this.buildStaticTargets();

    const spawn = this.resolveSpawn(state, def);
    const player = new PlayerSpriteController(this, spawn.x, spawn.y, state);
    this.player = player;
    player.setDepth(Math.round(spawn.y));
    this.cameras.main.startFollow(player, true, 0.12, 0.12);
    this.cameras.main.setDeadzone(150, 96);
    this.cameras.main.fadeIn(260, 10, 8, 14);

    const keyboard = this.input.keyboard;
    if (keyboard) {
      const keys = keyboard.addKeys('W,A,S,D,E') as Record<string, Phaser.Input.Keyboard.Key>;
      this.cursorKeys = keyboard.createCursorKeys();
      this.keys = {
        up: keys.W ?? this.cursorKeys.up,
        down: keys.S ?? this.cursorKeys.down,
        left: keys.A ?? this.cursorKeys.left,
        right: keys.D ?? this.cursorKeys.right,
        interact: keys.E ?? this.cursorKeys.space,
      };
    }
    this.createPrompt();
    this.syncNpcs(state);
    this.syncDynamicObjects(state);
    this.showLocationBanner(state, def);
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.scale.on('resize', this.resizeHandler);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.resizeHandler);
      this.input.off('pointerdown', this.handlePointerDown, this);
      this.disposeControllers();
    });
    this.sceneReadyAt = this.elapsed;
  }

  private buildPlan(def: LocationDef, state: Readonly<GameState>): LocationPlan {
    const neighbours = def.connections
      .map((id) => this.content.getLocation(id))
      .filter((neighbour): neighbour is LocationDef => neighbour !== undefined)
      .map((neighbour) => ({ id: neighbour.id, name: neighbour.name, mapX: neighbour.mapX, mapY: neighbour.mapY }));
    const interiorDef =
      !def.indoor && ENTERABLE_KINDS.has(def.kind) ? this.content.getLocation(interiorIdFor(def.id)) ?? null : null;
    const entranceDef = def.indoor && def.entranceFrom ? this.content.getLocation(def.entranceFrom) ?? null : null;
    return buildLocationPlan(def, {
      season: state.world.environment.season,
      neighbours,
      interior: interiorDef ? { id: interiorDef.id, name: interiorDef.name } : null,
      entrance: entranceDef ? { id: entranceDef.id, name: entranceDef.name } : null,
    });
  }

  private applyCameraZoom(): void {
    const zoom = cameraZoomFor(this.scale.width, this.scale.height, SCENE_WIDTH, SCENE_HEIGHT);
    this.cameras.main.setZoom(zoom);
  }

  /**
   * Drops every reference to scene-generation objects.
   *
   * Phaser re-uses the same Scene instance for scene.restart()/scene.start(sameKey),
   * so fields survive a shutdown while their game objects do not. This must run on
   * shutdown (and defensively on create) so a stale WeatherFXController can never
   * be resized after its rectangles were destroyed.
   */
  private disposeControllers(): void {
    this.weather?.destroy();
    this.weather = null;
    this.worldRenderer = null;
    this.player = null;
    for (const sprite of this.npcSprites.values()) sprite.destroy();
    this.npcSprites.clear();
    for (const marker of this.forageMarkers.values()) marker.marker.destroy();
    this.forageMarkers.clear();
    for (const visual of this.plotVisuals.values()) {
      visual.patch.destroy();
      visual.crop.destroy();
    }
    this.plotVisuals.clear();
    this.staticTargets = [];
    this.banner = null;
    this.prompt = null;
    this.promptText = null;
    this.promptKey = null;
    this.highlight = null;
  }

  private resolveSpawn(state: Readonly<GameState>, def: LocationDef): { x: number; y: number } {
    const mapped = stateToScenePosition(
      state.player.position.x,
      state.player.position.y,
      Math.max(32, def.widthTiles * 32),
      Math.max(32, def.heightTiles * 32)
    );
    let point = clampToWalkable(this.plan.walkable, mapped.x, mapped.y, 26);
    if (this.isBlocked(point.x, point.y, PLAYER_RADIUS + 4)) {
      // Nudge toward the walkable centre until we find free ground.
      const centreX = this.plan.walkable.x + this.plan.walkable.width / 2;
      const centreY = this.plan.walkable.y + this.plan.walkable.height / 2;
      for (let step = 1; step <= 14; step += 1) {
        const t = step / 14;
        const candidate = { x: point.x + (centreX - point.x) * t, y: point.y + (centreY - point.y) * t };
        if (!this.isBlocked(candidate.x, candidate.y, PLAYER_RADIUS + 4)) {
          point = candidate;
          break;
        }
      }
    }
    return point;
  }

  private isBlocked(x: number, y: number, radius: number): boolean {
    const walkable = this.plan.walkable;
    if (x < walkable.x + radius || x > walkable.x + walkable.width - radius) return true;
    if (y < walkable.y + radius || y > walkable.y + walkable.height - radius) return true;
    for (const obstacle of this.plan.obstacles) {
      if (circleIntersectsRect(x, y, radius, obstacle)) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Static targets & prompt
  // -------------------------------------------------------------------------

  private buildStaticTargets(): void {
    this.staticTargets = [];
    for (const exit of this.plan.exits) {
      this.staticTargets.push({ kind: 'exit', id: exit.toId, label: exit.label, x: exit.x, y: exit.y, radius: 42 });
    }
    if (this.plan.door) {
      const door = this.plan.door;
      this.staticTargets.push({
        kind: 'door',
        id: door.toId,
        label: door.kind === 'enter' ? 'Enter ' + door.label : 'Leave to ' + door.label,
        x: door.x,
        y: door.y,
        radius: 46,
      });
    }
    for (const facility of this.plan.facilities) {
      this.staticTargets.push({ kind: 'facility', id: facility.kind, label: facility.label, x: facility.x, y: facility.y, radius: facility.radius });
    }
    if (this.plan.searchSpot) {
      this.staticTargets.push({ kind: 'search', id: 'search', label: this.plan.searchSpot.label, x: this.plan.searchSpot.x, y: this.plan.searchSpot.y, radius: 54 });
    }
  }

  private createPrompt(): void {
    this.promptKey = this.add.image(0, 0, 'ui.keycap').setOrigin(0.5, 0.5).setDepth(7001).setScrollFactor(0);
    this.promptText = this.add.text(0, 0, '', {
      fontFamily: '"Courier New", monospace',
      fontSize: '11px',
      color: '#f6ecd8',
      backgroundColor: '#1a1620dd',
      padding: { left: 6, right: 6, top: 3, bottom: 3 },
      resolution: 2,
    });
    this.promptText.setOrigin(0, 0.5).setDepth(7002).setScrollFactor(0);
    const keyText = this.add.text(0, 0, 'E', {
      fontFamily: '"Courier New", monospace',
      fontSize: '11px',
      color: '#2a2228',
      resolution: 2,
    });
    keyText.setOrigin(0.5, 0.5).setDepth(7003).setScrollFactor(0);
    this.prompt = this.add.container(0, 0, [this.promptKey, keyText, this.promptText]).setDepth(7000).setVisible(false);
    this.highlight = this.add.graphics().setDepth(-80);
  }

  private updatePrompt(target: InteractionTarget | null): void {
    this.nearest = target;
    const prompt = this.prompt;
    const promptText = this.promptText;
    const promptKey = this.promptKey;
    const highlight = this.highlight;
    if (!prompt || !promptText || !promptKey || !highlight) return;
    if (!target) {
      prompt.setVisible(false);
      highlight.clear();
      return;
    }
    promptText.setText(target.label);
    const textWidth = promptText.width;
    const totalWidth = textWidth + 26;
    prompt.setPosition(Math.round(target.x - totalWidth / 2 + 10), Math.round(target.y - 62));
    promptKey.setPosition(0, 0).setScale(0.95);
    promptText.setPosition(16, 0);
    prompt.setVisible(true);
    const pulse = 0.55 + Math.abs(Math.sin(this.elapsed * 0.005)) * 0.45;
    highlight.clear();
    highlight.lineStyle(2, 0xf0e2bc, 0.55 * pulse);
    highlight.strokeEllipse(target.x, target.y + 4, 42, 18);
    highlight.setDepth(Math.round(target.y) + 2);
  }

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

  private findNearestTarget(state: Readonly<GameState>): InteractionTarget | null {
    const player = this.player;
    if (!player) return null;
    const playerX = player.getFootX();
    const playerY = player.getFootY();
    // NPCs take priority over scenery.
    let bestNpcDistance = 82 * 82;
    let bestNpc: NPCState | null = null;
    for (const [id, sprite] of this.npcSprites) {
      const npc = state.npcs[id as keyof typeof state.npcs];
      if (!npc) continue;
      const d = distanceSq(playerX, playerY, sprite.x, sprite.y);
      if (d < bestNpcDistance) {
        bestNpcDistance = d;
        bestNpc = npc;
      }
    }
    if (bestNpc) return { kind: 'npc', label: 'Talk to ' + bestNpc.name, x: bestNpc ? this.npcSprites.get(bestNpc.id)?.x ?? playerX : playerX, y: this.npcSprites.get(bestNpc.id)?.y ?? playerY };
    let best: InteractionTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const target of this.staticTargets) {
      const d = distanceSq(playerX, playerY, target.x, target.y);
      if (d < target.radius * target.radius && d < bestDistance) {
        bestDistance = d;
        best = { kind: target.kind, label: target.label, x: target.x, y: target.y };
      }
    }
    for (const marker of this.forageMarkers.values()) {
      const d = distanceSq(playerX, playerY, marker.x, marker.y);
      if (d < 58 * 58 && d < bestDistance) {
        bestDistance = d;
        best = { kind: 'forage', label: marker.label, x: marker.x, y: marker.y };
      }
    }
    for (const plot of this.plotVisuals.values()) {
      const d = distanceSq(playerX, playerY, plot.sceneX, plot.sceneY);
      if (d < 62 * 62 && d < bestDistance) {
        bestDistance = d;
        best = { kind: 'plot', label: this.plotLabel(plot), x: plot.sceneX, y: plot.sceneY };
      }
    }
    if (!best) {
      if (this.plan.farmable && !this.plan.indoor) {
        const tile = this.currentFarmTile();
        if (tile) return { kind: 'till', label: 'Till soil', x: playerX, y: playerY };
      }
      return null;
    }
    return best;
  }

  private plotLabel(plot: PlotVisual): string {
    if (plot.stage === 'mature') return 'Harvest crop';
    if (plot.stage === 'planted') return plot.cropStage >= 2 ? 'Water plot' : 'Water seedling';
    if (plot.stage === 'tilled') return 'Plant seed';
    if (plot.stage === 'withered') return 'Clear withered plot';
    return 'Farm plot';
  }

  private currentFarmTile(): { x: number; y: number } | null {
    const def = this.locationDef;
    const player = this.player;
    if (!player) return null;
    const statePos = sceneToStatePosition(player.getFootX(), player.getFootY(), Math.max(32, def.widthTiles * 32), Math.max(32, def.heightTiles * 32));
    const tileX = Math.floor(statePos.x / 32);
    const tileY = Math.floor(statePos.y / 32);
    if (tileX < 0 || tileY < 0 || tileX >= def.widthTiles || tileY >= def.heightTiles) return null;
    return { x: tileX, y: tileY };
  }

  private performInteraction(state: Readonly<GameState>, target: InteractionTarget | null): void {
    if (!target) return;
    switch (target.kind) {
      case 'npc':
        this.talkToNearestNpc(state);
        return;
      case 'exit':
        this.travelThroughExit(this.nearestExitId(target));
        return;
      case 'door':
        this.useDoor();
        return;
      case 'facility':
        this.useFacility(target.label, state);
        return;
      case 'search':
        this.showResult(this.session.api.dispatch({ type: 'explore:search', locationId: this.locationId }), true);
        return;
      case 'forage':
        this.gatherNearestForage();
        return;
      case 'plot':
        this.useNearestPlot(state);
        return;
      case 'till': {
        const tile = this.currentFarmTile();
        if (tile) this.showResult(this.session.api.dispatch({ type: 'farm:till', locationId: this.locationId, x: tile.x, y: tile.y }), false);
        return;
      }
      default:
        return;
    }
  }

  private nearestExitId(target: InteractionTarget): string {
    let best: StaticTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of this.staticTargets) {
      if (candidate.kind !== 'exit') continue;
      const d = distanceSq(target.x, target.y, candidate.x, candidate.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = candidate;
      }
    }
    return best?.id ?? '';
  }

  private travelThroughExit(toId: string): void {
    if (!toId) return;
    const result = this.session.api.dispatch({ type: 'move:to-location', locationId: toId });
    if (!result.ok) {
      this.session.ui.showNotification(result.message, 'error');
      return;
    }
    if (result.stateChanged) this.beginTransition(worldSceneKeyForLocation(this.session, toId));
  }

  private useDoor(): void {
    const door = this.plan.door;
    if (!door) return;
    const result =
      door.kind === 'enter'
        ? this.session.api.dispatch({ type: 'move:enter', locationId: door.toId })
        : this.session.api.dispatch({ type: 'move:exit-interior' });
    if (!result.ok) {
      this.session.ui.showNotification(result.message, 'error');
      return;
    }
    if (result.stateChanged) this.beginTransition(worldSceneKeyForLocation(this.session, door.toId));
  }

  private useFacility(label: string, state: Readonly<GameState>): void {
    const api = this.session.api;
    const facility = this.currentFacility(state);
    if (!facility) return;
    switch (facility.action) {
      case 'shop':
        this.session.ui.openPanel('shop');
        return;
      case 'collection':
        this.session.ui.openPanel('collection');
        return;
      case 'inventory':
        this.session.ui.openPanel('inventory');
        return;
      case 'rest':
        this.showResult(api.dispatch({ type: 'time:rest', hours: 8 }), false);
        return;
      case 'fishing':
        this.showResult(api.dispatch({ type: 'fish:cast', locationId: this.locationId }), false);
        this.session.ui.openPanel('fishing');
        return;
      case 'train':
        this.session.ui.openPanel('map');
        return;
      case 'warm':
        this.showResult(api.dispatch({ type: 'life:warm-up', source: 'campfire' }), false);
        return;
      case 'events':
        this.session.ui.openPanel('events');
        return;
      case 'housing':
        this.session.ui.openPanel('housing');
        return;
      case 'farm':
        this.session.ui.showNotification(label + ': walk out onto a field and press E to till, plant, water or harvest.', 'info');
        return;
      default:
        this.session.ui.showNotification('You look at the ' + label.toLowerCase() + '.', 'info');
        return;
    }
  }

  private currentFacility(state: Readonly<GameState>): FacilityPlan | null {
    const player = this.player;
    if (!player) return null;
    let best: FacilityPlan | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const facility of this.plan.facilities) {
      const d = distanceSq(player.getFootX(), player.getFootY(), facility.x, facility.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = facility;
      }
    }
    void state;
    return bestDistance <= (best?.radius ?? 0) * (best?.radius ?? 0) ? best : null;
  }

  private talkToNearestNpc(state: Readonly<GameState>): void {
    const player = this.player;
    if (!player) return;
    let bestId: string | null = null;
    let bestDistance = 82 * 82;
    for (const [id, sprite] of this.npcSprites) {
      const d = distanceSq(player.getFootX(), player.getFootY(), sprite.x, sprite.y);
      if (d < bestDistance) {
        bestDistance = d;
        bestId = id;
      }
    }
    if (!bestId) return;
    const result = this.session.api.dispatch({ type: 'dialogue:start', npcId: bestId as NPCId });
    if (result.ok) this.session.ui.openPanel('dialogue');
    else this.session.ui.showNotification(result.message, 'error');
    void state;
  }

  private gatherNearestForage(): void {
    const player = this.player;
    if (!player) return;
    let bestId: string | null = null;
    let bestDistance = 58 * 58;
    for (const marker of this.forageMarkers.values()) {
      const d = distanceSq(player.getFootX(), player.getFootY(), marker.x, marker.y);
      if (d < bestDistance) {
        bestDistance = d;
        bestId = marker.nodeId;
      }
    }
    if (!bestId) return;
    this.showResult(this.session.api.dispatch({ type: 'forage:gather', nodeId: bestId }), true);
  }

  private useNearestPlot(state: Readonly<GameState>): void {
    const player = this.player;
    if (!player) return;
    let best: PlotVisual | null = null;
    let bestDistance = 62 * 62;
    for (const plot of this.plotVisuals.values()) {
      const d = distanceSq(player.getFootX(), player.getFootY(), plot.sceneX, plot.sceneY);
      if (d < bestDistance) {
        bestDistance = d;
        best = plot;
      }
    }
    if (!best) return;
    const plotState = state.farming.plots[best.plotId];
    if (!plotState) return;
    if (plotState.stage === 'mature') {
      this.showResult(this.session.api.dispatch({ type: 'farm:harvest', plotId: plotState.id }), false);
      return;
    }
    if (plotState.stage === 'withered') {
      this.showResult(this.session.api.dispatch({ type: 'farm:clear', plotId: plotState.id }), false);
      return;
    }
    if (plotState.stage === 'planted') {
      if (plotState.moisture < 0.65) this.showResult(this.session.api.dispatch({ type: 'farm:water', plotId: plotState.id }), false);
      else this.session.ui.showNotification('The soil is still damp.', 'info');
      return;
    }
    if (plotState.stage === 'tilled') {
      const seed = this.firstSeedItem(state);
      if (!seed) {
        this.session.ui.showNotification('You have no seeds to plant. Buy some, or forage for wild seeds.', 'warning');
        return;
      }
      this.showResult(this.session.api.dispatch({ type: 'farm:plant', plotId: plotState.id, seedItemId: seed }), false);
      return;
    }
    this.session.ui.showNotification('Nothing to do with this patch right now.', 'info');
  }

  private firstSeedItem(state: Readonly<GameState>): string | null {
    for (const entry of state.player.inventory) {
      const item = this.content.getItem(entry.itemId);
      if (item && item.seedCropId) return entry.itemId;
    }
    return null;
  }

  private showResult(result: ActionResult, informSuccess: boolean): void {
    if (!result.ok) {
      this.session.ui.showNotification(result.message, 'error');
      return;
    }
    if (informSuccess && result.message && !result.stateChanged) this.session.ui.showNotification(result.message, 'info');
    else if (informSuccess && result.message) this.session.ui.showNotification(result.message, 'success');
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.transitionPending) return;
    const player = this.player;
    if (!player) return;
    const worldX = pointer.worldX;
    const worldY = pointer.worldY;
    // Exit markers are clickable from anywhere: the brief calls for click-to-travel.
    for (const exit of this.plan.exits) {
      if (distanceSq(worldX, worldY, exit.x, exit.y - 14) < 40 * 40) {
        this.travelThroughExit(exit.toId);
        return;
      }
    }
    if (this.plan.door) {
      const door = this.plan.door;
      if (distanceSq(worldX, worldY, door.x, door.y - 20) < 44 * 44) {
        if (distanceSq(player.getFootX(), player.getFootY(), door.x, door.y) < 150 * 150) this.useDoor();
        else this.session.ui.showNotification('Walk closer to the door first.', 'warning');
        return;
      }
    }
    if (this.nearest?.kind === 'npc') {
      const spriteX = this.nearest.x;
      const spriteY = this.nearest.y;
      if (distanceSq(worldX, worldY, spriteX, spriteY - 20) < 34 * 34) this.talkToNearestNpc(this.session.api.getState());
    }
  }

  // -------------------------------------------------------------------------
  // Dynamic object sync (NPCs, forage nodes, farm plots)
  // -------------------------------------------------------------------------

  private syncNpcs(state: Readonly<GameState>): void {
    const present = new Set<string>();
    for (const id in state.npcs) {
      const npc = state.npcs[id];
      if (!npc || npc.locationId !== this.locationId) continue;
      present.add(id);
      if (this.npcSprites.has(id)) continue;
      const sprite = new NPCSpriteController(this, npc, this.plan);
      this.npcSprites.set(id, sprite);
    }
    for (const [id, sprite] of this.npcSprites) {
      if (present.has(id)) continue;
      sprite.destroy();
      this.npcSprites.delete(id);
    }
  }

  private syncDynamicObjects(state: Readonly<GameState>): void {
    // Forage nodes.
    const seenForage = new Set<string>();
    for (const nodeId in state.foraging.nodes) {
      const node = state.foraging.nodes[nodeId];
      if (!node || node.locationId !== this.locationId) continue;
      seenForage.add(nodeId);
      let marker = this.forageMarkers.get(nodeId);
      if (!marker) {
        const point = resolveForagePoint(this.plan, nodeId);
        const def = this.content.getForageNode(node.defId);
        const image = this.add.image(point.x, point.y - 8, 'fx.spark').setDepth(Math.round(point.y)).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffe8a0).setScale(1.2);
        marker = {
          nodeId,
          label: 'Gather ' + (def?.name ?? 'wild plants'),
          marker: image,
          x: point.x,
          y: point.y,
        };
        this.forageMarkers.set(nodeId, marker);
      }
      markForageState(marker.marker, node.depleted, node.respawnAt, state.clock.simTimeSeconds);
    }
    for (const [nodeId, marker] of this.forageMarkers) {
      if (seenForage.has(nodeId)) continue;
      marker.marker.destroy();
      this.forageMarkers.delete(nodeId);
    }
    // Farm plots.
    const seenPlots = new Set<string>();
    const def = this.locationDef;
    for (const plotId in state.farming.plots) {
      const plot = state.farming.plots[plotId];
      if (!plot || plot.locationId !== this.locationId) continue;
      seenPlots.add(plotId);
      const nx = (plot.x + 0.5) / Math.max(1, def.widthTiles);
      const ny = (plot.y + 0.5) / Math.max(1, def.heightTiles);
      const sceneX = Math.round(nx * SCENE_WIDTH);
      const sceneY = Math.round(ny * SCENE_HEIGHT);
      let visual = this.plotVisuals.get(plotId);
      if (!visual) {
        const patch = this.add.image(sceneX, sceneY, 'prop.plot').setDepth(Math.round(sceneY)).setAlpha(0.95);
        const crop = this.add.image(sceneX, sceneY - 4, 'crop.stage.0').setOrigin(0.5, 1).setDepth(Math.round(sceneY) + 1).setVisible(false);
        visual = { plotId, sceneX, sceneY, patch, crop, stage: '', cropStage: -1, cropColor: 0xffffff };
        this.plotVisuals.set(plotId, visual);
      }
      const cropDef = plot.cropId ? this.content.getCrop(plot.cropId) : undefined;
      if (plot.stage !== visual.stage || plot.growthStage !== visual.cropStage) {
        visual.stage = plot.stage;
        visual.cropStage = plot.growthStage;
        const growing = plot.stage === 'planted' || plot.stage === 'mature';
        visual.crop.setVisible(growing);
        const stageIndex = plot.stage === 'mature' ? 4 : Math.max(0, Math.min(3, plot.growthStage));
        visual.crop.setTexture('crop.stage.' + stageIndex);
        visual.crop.setScale(plot.stage === 'mature' ? 1.15 : 0.9);
        if (cropDef) {
          const color = cropDef.visual.color;
          visual.cropColor = Number.parseInt(color.replace('#', ''), 16) || 0xffffff;
        }
        visual.crop.setTint(plot.stage === 'withered' ? 0x8a7a5a : 0xffffff);
        visual.patch.setTint(plot.stage === 'withered' ? 0x8a7a5a : plot.stage === 'planted' || plot.stage === 'mature' ? 0x9a7a5a : 0x6f5238);
        visual.patch.setAlpha(0.95);
      }
    }
    for (const [plotId, visual] of this.plotVisuals) {
      if (seenPlots.has(plotId)) continue;
      visual.patch.destroy();
      visual.crop.destroy();
      this.plotVisuals.delete(plotId);
    }
  }

  // -------------------------------------------------------------------------
  // Update loop
  // -------------------------------------------------------------------------

  update(_time: number, delta: number): void {
    if (!this.player) return;
    const api = this.session.api;
    const screen = api.getScreen();
    if (screen === 'life_end') {
      this.beginTransition('LifeEndScene');
      return;
    }
    if (screen !== 'playing') {
      this.beginTransition('MainMenuScene');
      return;
    }
    if (this.transitionPending) return;
    const state = api.getState();
    if (state.player.position.locationId !== this.locationId) {
      this.beginTransition(worldSceneKeyForLocation(this.session, null));
      return;
    }
    if (state.life.phase !== 'alive') {
      this.beginTransition('LifeEndScene');
      return;
    }
    const player = this.player;
    const weather = this.weather;
    const worldRenderer = this.worldRenderer;
    if (!player || !weather || !worldRenderer) return;
    const dt = Math.min(delta, 100);
    this.elapsed += dt;
    const environment = state.world.environment;

    // Season changes rebuild the scene assets; this happens rarely (28 game days).
    if (environment.season !== this.lastSeasonSeen) {
      this.lastSeasonSeen = environment.season;
      this.beginTransition(this.scene.key);
      return;
    }

    const talking = state.social.activeConversation !== null;
    const blocked = this.isTextInputFocused() || talking;
    this.updateMovement(state, dt, blocked);

    const wet = !this.plan.indoor && (environment.weather === 'rain' || environment.weather === 'storm' || environment.weather === 'snow');
    player.updateFromState(
      state,
      dt,
      this.movingNow,
      talking,
      environment.windSpeed,
      environment.windDirectionDeg,
      environment.daylight,
      wet,
      this.plan.indoor
    );
    player.setDepth(Math.round(player.getFootY()));

    for (const [id, sprite] of this.npcSprites) {
      const npc = state.npcs[id];
      if (!npc) continue;
      sprite.updateFromState(npc, dt, state.clock.simTimeSeconds);
      sprite.setDepth(Math.round(sprite.y));
    }

    weather.update(state, dt);
    const dayNight = dayNightPalette(environment.daylight);
    worldRenderer.update(dt, this.elapsed, dayNight.lightStrength, environment.windSpeed, this.plan.indoor);
    const flash = weather.getFlashPeak();
    if (flash > 0.72 && this.flashCooldown <= 0) {
      this.flashCooldown = 700;
      this.cameras.main.flash(140, 255, 250, 232);
      this.cameras.main.shake(160, 0.0032);
    }
    this.flashCooldown = Math.max(0, this.flashCooldown - dt);

    this.syncNpcsIfDue(state);
    this.syncDynamicObjectsIfDue(state);
    this.updatePrompt(this.findNearestTarget(state));
    this.handleInteractions(state, blocked);
    this.autoTravelThroughExits();
  }

  private lastSeasonSeen = '';
  private movingNow = false;

  private updateMovement(state: Readonly<GameState>, dt: number, blocked: boolean): void {
    const keys = this.keys;
    const keyboard = this.input.keyboard;
    const player = this.player;
    if (!keys || !keyboard || !player) {
      this.movingNow = false;
      return;
    }
    let dx = 0;
    let dy = 0;
    if (!blocked) {
      if (keys.left.isDown || this.cursorKeys.left.isDown) dx -= 1;
      if (keys.right.isDown || this.cursorKeys.right.isDown) dx += 1;
      if (keys.up.isDown || this.cursorKeys.up.isDown) dy -= 1;
      if (keys.down.isDown || this.cursorKeys.down.isDown) dy += 1;
    }
    this.movingNow = dx !== 0 || dy !== 0;
    if (!this.movingNow) return;
    const currentX = player.getFootX();
    const currentY = player.getFootY();
    const condition = state.player.cigarette;
    const damp = Math.max(0, clamp01(condition.moisture) - 0.3);
    let speed = 168 * (1 - damp * 0.62) * (0.86 + 0.14 * clamp01(condition.lengthRatio));
    for (const effect of state.player.statusEffects) {
      if (typeof effect.moveSpeedMultiplier === 'number') speed *= Math.max(0.4, Math.min(1.4, effect.moveSpeedMultiplier));
    }
    const length = Math.hypot(dx, dy) || 1;
    const stepX = (dx / length) * speed * (dt / 1000);
    const stepY = (dy / length) * speed * (dt / 1000);
    let nextX = currentX;
    let nextY = currentY;
    if (!this.isBlocked(currentX + stepX, currentY, PLAYER_RADIUS)) nextX = currentX + stepX;
    if (!this.isBlocked(nextX, currentY + stepY, PLAYER_RADIUS)) nextY = currentY + stepY;
    player.setFootPosition(nextX, nextY);
    if (this.elapsed - this.lastPositionDispatch > 150) {
      if (Math.abs(nextX - this.lastDispatchX) > 2 || Math.abs(nextY - this.lastDispatchY) > 2) {
        this.lastPositionDispatch = this.elapsed;
        this.lastDispatchX = nextX;
        this.lastDispatchY = nextY;
        const def = this.locationDef;
        const statePosition = sceneToStatePosition(
          nextX,
          nextY,
          Math.max(32, def.widthTiles * 32),
          Math.max(32, def.heightTiles * 32)
        );
        this.session.api.dispatch({ type: 'move:position', x: statePosition.x, y: statePosition.y });
      }
    }
  }

  private handleInteractions(state: Readonly<GameState>, blocked: boolean): void {
    if (blocked) return;
    if (!this.keys || !this.input.keyboard) return;
    if (!Phaser.Input.Keyboard.JustDown(this.keys.interact)) return;
    this.performInteraction(state, this.nearest);
  }

  private autoTravelThroughExits(): void {
    if (this.elapsed - this.sceneReadyAt < 900) return;
    const player = this.player;
    if (!player) return;
    for (const exit of this.plan.exits) {
      if (distanceSq(player.getFootX(), player.getFootY(), exit.x, exit.y) < 26 * 26) {
        this.travelThroughExit(exit.toId);
        return;
      }
    }
  }

  private syncNpcsIfDue(state: Readonly<GameState>): void {
    if (this.elapsed - this.lastNpcSync < 400) return;
    this.lastNpcSync = this.elapsed;
    this.syncNpcs(state);
  }

  private syncDynamicObjectsIfDue(state: Readonly<GameState>): void {
    if (this.elapsed - this.lastDynamicSync < 500) return;
    this.lastDynamicSync = this.elapsed;
    this.syncDynamicObjects(state);
  }

  private isTextInputFocused(): boolean {
    if (typeof document === 'undefined') return false;
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    const tag = active.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable === true;
  }

  private beginTransition(key: string): void {
    if (this.transitionPending) return;
    this.transitionPending = true;
    fadeToScene(this, key);
  }

  // -------------------------------------------------------------------------
  // Banners
  // -------------------------------------------------------------------------

  private showLocationBanner(state: Readonly<GameState>, def: LocationDef): void {
    const time = simSecondsToGameTime(state.clock.simTimeSeconds);
    const environment = state.world.environment;
    // The DOM HUD is ~160px tall, so the Phaser banner sits below it. Control hints
    // are already rendered by the DOM HUD - do not duplicate them here.
    const width = Math.min(540, this.scale.width - 40);
    const banner = this.add.container(SCENE_WIDTH / 2, 196).setDepth(8000).setAlpha(0);
    const backdrop = this.add.rectangle(0, 0, width, 50, 0x15121a, 0.76).setOrigin(0.5, 0);
    backdrop.setStrokeStyle(1, 0x5a4a3a, 0.8);
    const title = this.add.text(0, 6, def.name, {
      fontFamily: '"Courier New", monospace',
      fontSize: '16px',
      color: '#f2e4c8',
      resolution: 2,
    });
    title.setOrigin(0.5, 0);
    const region = def.regionId === 'ashford' ? 'Ashford City' : 'Willowbrook';
    // Same clock source as the DOM HUD (GameState.clock.simTimeSeconds).
    const clock = String(time.hour).padStart(2, '0') + ':' + String(time.minute).padStart(2, '0');
    const subtitle = this.add.text(
      0,
      27,
      region + '  ·  ' + SEASON_DISPLAY_NAMES[environment.season] + ' day ' + time.dayOfSeason + '  ·  ' + WEATHER_DISPLAY_NAMES[environment.weather] + '  ·  ' + clock,
      {
        fontFamily: '"Courier New", monospace',
        fontSize: '10px',
        color: '#c8b48a',
        resolution: 2,
      }
    );
    subtitle.setOrigin(0.5, 0);
    banner.add([backdrop, title, subtitle]);
    this.banner = banner;
    this.tweens.add({ targets: banner, alpha: 1, duration: 260, ease: 'Sine.easeOut' });
    this.time.delayedCall(3600, () => {
      this.tweens.add({ targets: banner, alpha: 0, duration: 500, ease: 'Sine.easeIn', onComplete: () => banner.destroy() });
    });
    void width;
  }

  private banner: Phaser.GameObjects.Container | null = null;

  private bannerDestroyed(): boolean {
    return this.banner !== null && !this.banner.active;
  }
}

/** Small helper so TS knows the marker image shape without importing Phaser types twice. */
function markForageState(marker: Phaser.GameObjects.Image, depleted: boolean, respawnAt: number, now: number): void {
  const ready = !depleted || respawnAt <= now;
  marker.setAlpha(ready ? 0.55 + Math.abs(Math.sin(now * 0.0015)) * 0.45 : 0.14);
  marker.setTint(ready ? 0xffe8a0 : 0x8a8478);
}