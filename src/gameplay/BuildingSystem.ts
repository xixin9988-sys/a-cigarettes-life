import type {
  ActionResult,
  BuildProjectState,
  BuildingState,
  FarmPlotState,
  GreenhouseState,
  HomeState,
  IBuildingSystem,
  IGameContext,
  IHousingSystem,
  ISkillSystem,
  WorldHistoryCategory,
  WorldHistoryEntry,
} from '../core/contracts';
import type { BlueprintDef, BlueprintKind } from '../data/schema';
import type { EntityId, JsonValue, LocationId } from '../core/SharedTypes';
import { SKILL_ACTIVITY_XP, WORLD_CONFIG } from '../core/WorldConfig';
import { addItemToInventory, consumeItems, countItem } from '../core/InventoryUtil';
import { clamp01 } from '../core/utils';
import { findHomeAtLocation, } from './CraftingSystem';
import { ROOM_LAYOUTS } from './HousingSystem';

/**
 * BuildingSystem (id 'building') - construction projects and their world effects.
 *
 * A project consumes its blueprint materials atomically at start and completes at
 * `startedAt + buildHours * 60 sim seconds`. Completion effects:
 *   greenhouse      -> GreenhouseState + 4 (basic) or 6 (large) tilled FarmPlotStates
 *   room            -> new RoomState on the player's home (via HousingSystem)
 *   home_expansion  -> home.upgrades entry (comfort/storage bonuses)
 *   farm_facility   -> home.upgrades entry (storage bonus)
 *   garden          -> home.gardens entry, garden_expansion also adds 3 tillable plots
 *   store_decoration-> shop decoration flag + a little influence
 * Cancelling a project refunds 50% (floored) of the materials as salvage.
 *
 * Greenhouse/garden plots are placed in a virtual "garden band" of grid coordinates
 * (x,y >= 60) so they can never collide with plots the player tills by hand.
 */
const SIM_SECONDS_PER_GAME_HOUR = 60;
const MAX_ACTIVE_PROJECTS = 3;
const MAX_KEPT_PROJECTS = 24;
const SALVAGE_RATIO = 0.5;
/** Special plots live in a virtual band to the right of the location's tilled field band. */
const SPECIAL_PLOT_BAND_OFFSET = 100;
const GREENHOUSE_LOCAL_PLOTS = 4;
const GREENHOUSE_LARGE_PLOTS = 6;
const GARDEN_EXPANSION_PLOTS = 3;

/** Extra HousingSystem methods beyond the frozen IHousingSystem contract (same module owner). */
interface HousingBridge extends IHousingSystem {
  applyCompletedBlueprint(blueprintId: string, locationId: LocationId): ActionResult;
  recomputeHome(home: HomeState): void;
}

const HOME_BLUEPRINT_KINDS: readonly BlueprintKind[] = ['greenhouse', 'room', 'home_expansion', 'farm_facility', 'garden'];
const SINGLE_INSTANCE_KINDS: readonly BlueprintKind[] = [
  'greenhouse',
  'room',
  'home_expansion',
  'farm_facility',
  'store_decoration',
];

export class BuildingSystem implements IBuildingSystem {
  readonly id = 'building';

  private ctx: IGameContext | null = null;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.syncUnlockedBlueprints(false);
  }

  update(_dtSimSeconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.syncUnlockedBlueprints(true);
    const now = ctx.clock.simTimeSeconds;
    const projects = ctx.state.building.projects;
    for (const project of projects) {
      if (project.status !== 'building') continue;
      const total = Math.max(1, project.completesAt - project.startedAt);
      project.progress = clamp01((now - project.startedAt) / total);
      if (now >= project.completesAt) {
        this.completeProject(project);
      }
    }
    this.pruneProjects();
  }

  // -------------------------------------------------------------------------
  // IBuildingSystem
  // -------------------------------------------------------------------------
  getProjects(): BuildProjectState[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    return ctx.state.building.projects.map((project) => ({ ...project }));
  }

  getAvailableBlueprints(): BlueprintDef[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    this.syncUnlockedBlueprints(false);
    return ctx.content.pack.blueprints
      .filter((blueprint) => this.getSkillLevel(blueprint.skill) >= blueprint.levelReq)
      .filter((blueprint) => !this.isAlreadyBuilt(blueprint))
      .sort((a, b) => a.levelReq - b.levelReq || a.buildHours - b.buildHours || a.id.localeCompare(b.id));
  }

  startProject(blueprintId: string, locationId: LocationId): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return this.fail('not_found', 'Building is not available yet.');
    const blueprint = ctx.content.getBlueprint(blueprintId);
    if (!blueprint) return this.fail('not_found', 'No such blueprint.');
    const skillLevel = this.getSkillLevel(blueprint.skill);
    if (skillLevel < blueprint.levelReq) {
      return this.fail(
        'skill_too_low',
        'You need ' + blueprint.skill + ' level ' + blueprint.levelReq + ' (you are ' + skillLevel + ').'
      );
    }
    if (this.isAlreadyBuilt(blueprint)) {
      return this.fail('locked', blueprint.name + ' is already built.');
    }
    const locationDef = ctx.content.getLocation(locationId);
    if (!locationDef) return this.fail('not_found', 'That place does not exist.');
    const home = findHomeAtLocation(ctx, locationId);
    const playerHere = ctx.state.player.position.locationId === locationId;
    const atOwnHome = home ? this.canModify(home) : false;
    if (!playerHere && !atOwnHome) {
      return this.fail('wrong_location', 'You need to be there to start building.');
    }
    if (HOME_BLUEPRINT_KINDS.includes(blueprint.kind) && !atOwnHome) {
      return this.fail('not_allowed', blueprint.name + ' can only be built at your own home.');
    }
    const active = ctx.state.building.projects.filter((project) => project.status === 'building');
    if (active.length >= MAX_ACTIVE_PROJECTS) {
      return this.fail('busy', 'You already have ' + MAX_ACTIVE_PROJECTS + ' builds in progress.');
    }
    const duplicate = active.find(
      (project) => project.blueprintId === blueprint.id && project.locationId === locationId
    );
    if (duplicate) return this.fail('busy', blueprint.name + ' is already under construction here.');
    const missing = this.firstMissingMaterial(blueprint);
    if (missing) return this.fail('not_enough_items', 'You need ' + missing + '.');
    const requirements = blueprint.inputs.map((input) => ({ itemId: input.itemId, quantity: input.quantity }));
    if (!consumeItems(ctx.state.player.inventory, requirements)) {
      return this.fail('not_enough_items', 'You are missing building materials.');
    }

    const now = ctx.clock.simTimeSeconds;
    const project: BuildProjectState = {
      id: this.nextProjectId(),
      blueprintId: blueprint.id,
      locationId,
      startedAt: now,
      completesAt: now + blueprint.buildHours * SIM_SECONDS_PER_GAME_HOUR,
      status: 'building',
      progress: 0,
    };
    ctx.state.building.projects.push(project);
    const data: JsonValue = {
      projectId: project.id,
      blueprintId: blueprint.id,
      locationId,
      completesAt: project.completesAt,
    };
    ctx.bus.emit('game:signal', { name: 'build:started', data });
    return {
      ok: true,
      message: 'Started building ' + blueprint.name + '. It will take ' + blueprint.buildHours + ' game hours.',
      stateChanged: true,
      data,
    };
  }

  cancelProject(projectId: string): ActionResult {
    const ctx = this.ctx;
    if (!ctx) return this.fail('not_found', 'Building is not available yet.');
    const project = ctx.state.building.projects.find((candidate) => candidate.id === projectId);
    if (!project) return this.fail('not_found', 'No such building project.');
    if (project.status !== 'building') return this.fail('invalid', 'That project is not in progress.');
    const blueprint = ctx.content.getBlueprint(project.blueprintId);
    project.status = 'cancelled';
    project.progress = 0;
    let salvaged = 0;
    if (blueprint) {
      const now = ctx.clock.simTimeSeconds;
      for (const input of blueprint.inputs) {
        const refund = Math.floor(input.quantity * SALVAGE_RATIO);
        if (refund <= 0) continue;
        const def = ctx.content.getItem(input.itemId);
        addItemToInventory(ctx.state.player.inventory, input.itemId, refund, {
          quality: 1,
          freshness: 1,
          simTime: now,
          maxStack: def?.maxStack ?? 99,
        });
        salvaged += refund;
        ctx.bus.emit('item:acquired', { itemId: input.itemId, quantity: refund, quality: 1, source: 'build_salvage' });
      }
    }
    const data: JsonValue = { projectId, blueprintId: project.blueprintId, salvaged };
    ctx.bus.emit('game:signal', { name: 'build:cancelled', data });
    return {
      ok: true,
      message: 'Cancelled the build. Salvaged ' + salvaged + ' material(s).',
      stateChanged: true,
      data,
    };
  }

  // -------------------------------------------------------------------------
  // Extra public helpers
  // -------------------------------------------------------------------------
  getActiveProjects(): BuildProjectState[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    return ctx.state.building.projects.filter((project) => project.status === 'building').map((project) => ({ ...project }));
  }

  isBlueprintUnlocked(blueprintId: string): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    this.syncUnlockedBlueprints(false);
    return ctx.state.building.unlockedBlueprints.includes(blueprintId);
  }

  /** Project progress 0..1 (persisted each tick). */
  getProjectProgress(projectId: string): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    return ctx.state.building.projects.find((project) => project.id === projectId)?.progress ?? 0;
  }

  // -------------------------------------------------------------------------
  // Internals - completion
  // -------------------------------------------------------------------------
  private completeProject(project: BuildProjectState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const blueprint = ctx.content.getBlueprint(project.blueprintId);
    project.status = 'complete';
    project.progress = 1;
    if (!blueprint) {
      ctx.logger.warn('Build project references an unknown blueprint', project.blueprintId);
      return;
    }
    ctx.state.building.completedProjects.push(blueprint.id);
    this.applyCompletion(project, blueprint);

    const xp = Math.max(
      1,
      Math.round(SKILL_ACTIVITY_XP[blueprint.skill] * (1 + blueprint.buildHours * 0.2) + blueprint.levelReq * 4)
    );
    this.skillSystem()?.addXp(blueprint.skill, xp, 'building:' + blueprint.id);

    this.appendHistory(
      'player',
      'You finished building the ' + blueprint.name.toLowerCase() + '.',
      3,
      project.locationId
    );
    const data: JsonValue = {
      projectId: project.id,
      blueprintId: blueprint.id,
      kind: blueprint.kind,
      locationId: project.locationId,
      xp,
    };
    ctx.bus.emit('game:signal', { name: 'build:completed', data });
  }

  private applyCompletion(project: BuildProjectState, blueprint: BlueprintDef): void {
    switch (blueprint.kind) {
      case 'greenhouse':
        this.buildGreenhouse(project, blueprint);
        return;
      case 'room':
      case 'home_expansion':
      case 'farm_facility':
      case 'garden':
        this.applyHomeBlueprint(project, blueprint);
        return;
      case 'store_decoration':
        this.applyStoreDecoration(blueprint);
        return;
      default:
        return;
    }
  }

  private buildGreenhouse(project: BuildProjectState, blueprint: BlueprintDef): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const state = ctx.state;
    const gardenLocation = this.gardenLocationFor(project.locationId);
    const greenhouseIndex = Object.keys(state.farming.greenhouses).length;
    const greenhouseId = this.uniqueFarmingId('gh', greenhouseIndex);
    const plotCount = blueprint.id === 'bp_greenhouse_large' ? GREENHOUSE_LARGE_PLOTS : GREENHOUSE_LOCAL_PLOTS;
    const plotIds: EntityId[] = [];
    const origin = this.plotBandOrigin(gardenLocation, greenhouseIndex);
    for (let index = 0; index < plotCount; index += 1) {
      const plotId = this.uniquePlotId(greenhouseId + '_p' + index);
      const plot = this.createFarmPlot(
        plotId,
        gardenLocation,
        origin.x + (index % 3) * 2,
        origin.y + Math.floor(index / 3) * 2
      );
      state.farming.plots[plotId] = plot;
      plotIds.push(plotId);
    }
    const greenhouse: GreenhouseState = {
      id: greenhouseId,
      locationId: gardenLocation,
      ownerId: state.player.id,
      plots: plotIds,
      condition: 1,
      builtAt: ctx.clock.simTimeSeconds,
    };
    state.farming.greenhouses[greenhouseId] = greenhouse;
    const home = findHomeAtLocation(ctx, project.locationId);
    if (home && !home.gardens.includes(blueprint.id)) home.gardens.push(blueprint.id);
    if (this.housingSystem()) this.housingSystem()?.recomputeHome(home as HomeState);
  }

  private applyHomeBlueprint(project: BuildProjectState, blueprint: BlueprintDef): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const housing = this.housingSystem();
    if (housing) {
      const result = housing.applyCompletedBlueprint(blueprint.id, project.locationId);
      if (!result.ok) ctx.logger.warn('Housing rejected blueprint completion', result.message);
    } else {
      const home = findHomeAtLocation(ctx, project.locationId) ?? this.firstOwnedHome();
      if (home) this.applyBlueprintFallback(home, blueprint);
    }
    if (blueprint.id === 'bp_garden_expansion') {
      this.addGardenPlots(this.gardenLocationFor(project.locationId), GARDEN_EXPANSION_PLOTS);
    }
    const home = findHomeAtLocation(ctx, project.locationId) ?? this.firstOwnedHome();
    if (home && housing) housing.recomputeHome(home);
  }

  private applyBlueprintFallback(home: HomeState, blueprint: BlueprintDef): void {
    if (blueprint.kind === 'room' && blueprint.unlocksRoomId) {
      const roomId = blueprint.unlocksRoomId;
      if (!home.rooms.some((room) => room.id === roomId)) {
        const layout = ROOM_LAYOUTS[roomId] ?? { name: blueprint.name, widthTiles: 10, heightTiles: 8 };
        home.rooms.push({
          id: roomId,
          name: layout.name,
          widthTiles: layout.widthTiles,
          heightTiles: layout.heightTiles,
          unlocked: true,
          wallColor: home.wallColor,
          floorStyle: home.floorStyle,
        });
      }
    }
    if (
      (blueprint.kind === 'room' || blueprint.kind === 'home_expansion' || blueprint.kind === 'farm_facility') &&
      !home.upgrades.includes(blueprint.id)
    ) {
      home.upgrades.push(blueprint.id);
    }
    if (blueprint.kind === 'garden' && !home.gardens.includes(blueprint.id)) {
      home.gardens.push(blueprint.id);
    }
  }

  private applyStoreDecoration(blueprint: BlueprintDef): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.state.flags['shop.decoration:' + blueprint.id] = true;
    ctx.state.player.influence = Math.max(0, ctx.state.player.influence + 1);
    ctx.state.player.communityPoints += 1;
  }

  private addGardenPlots(locationId: LocationId, count: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const state = ctx.state;
    let gardenIndex = 0;
    for (const plotId of Object.keys(state.farming.plots)) {
      if (plotId.startsWith('plot_garden_')) gardenIndex += 1;
    }
    const origin = this.plotBandOrigin(locationId, SPECIAL_PLOT_BAND_OFFSET + gardenIndex);
    for (let index = 0; index < count; index += 1) {
      const plotId = this.uniquePlotId('garden_' + gardenIndex + '_' + index);
      const plot = this.createFarmPlot(
        plotId,
        locationId,
        origin.x + (index % 3) * 2,
        origin.y + Math.floor(index / 3) * 2
      );
      state.farming.plots[plotId] = plot;
    }
  }

  /**
   * Greenhouses and garden extensions reserve a virtual plot band to the right of the
   * location's farmable field (x >= width), so they never collide with hand-tilled plots
   * (FarmingSystem rejects till coordinates outside the location bounds) while staying
   * adjacent to the map for renderers.
   */
  private plotBandOrigin(locationId: LocationId, blockIndex: number): { x: number; y: number } {
    const ctx = this.ctx;
    const def = ctx?.content.getLocation(locationId);
    const width = def && def.widthTiles > 0 ? def.widthTiles : 16;
    return { x: width + 1 + blockIndex * 8, y: 1 };
  }

  private createFarmPlot(id: EntityId, locationId: LocationId, x: number, y: number): FarmPlotState {
    const ctx = this.requireContext();
    const now = ctx ? ctx.clock.simTimeSeconds : 0;
    return {
      id,
      ownerId: ctx ? ctx.state.player.id : 'player',
      locationId,
      x,
      y,
      stage: 'tilled',
      cropId: null,
      growth: 0,
      growthStage: 0,
      plantedAt: 0,
      wateredAt: 0,
      moisture: 1,
      fertility: 0.75,
      potash: 0,
      health: 1,
      disease: 0,
      quality: 3,
      harvests: 0,
      lastUpdatedAt: now,
    };
  }

  /** Greenhouse/garden builds belong to the outdoor side of an interior project location. */
  private gardenLocationFor(locationId: LocationId): LocationId {
    const ctx = this.ctx;
    if (!ctx) return locationId;
    const def = ctx.content.getLocation(locationId);
    if (def?.indoor && def.entranceFrom) return def.entranceFrom;
    return locationId;
  }

  // -------------------------------------------------------------------------
  // Internals - helpers
  // -------------------------------------------------------------------------
  private syncUnlockedBlueprints(announce: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const unlocked = ctx.state.building.unlockedBlueprints;
    for (const blueprint of ctx.content.pack.blueprints) {
      if (unlocked.includes(blueprint.id)) continue;
      if (this.getSkillLevel(blueprint.skill) < blueprint.levelReq) continue;
      unlocked.push(blueprint.id);
      if (announce) {
        const data: JsonValue = { blueprintId: blueprint.id, name: blueprint.name };
        ctx.bus.emit('game:signal', { name: 'build:blueprint-unlocked', data });
      }
    }
  }

  private isAlreadyBuilt(blueprint: BlueprintDef): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (blueprint.kind === 'garden') return false;
    if (!SINGLE_INSTANCE_KINDS.includes(blueprint.kind)) return false;
    const built = ctx.state.building.completedProjects.includes(blueprint.id);
    if (built) return true;
    if (blueprint.kind === 'room' && blueprint.unlocksRoomId) {
      const home = this.firstOwnedHome();
      if (home?.rooms.some((room) => room.id === blueprint.unlocksRoomId)) return true;
    }
    return false;
  }

  private firstMissingMaterial(blueprint: BlueprintDef): string | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    for (const input of blueprint.inputs) {
      const have = countItem(ctx.state.player.inventory, input.itemId);
      if (have >= input.quantity) continue;
      return ctx.content.resolveItemName(input.itemId) + ' (have ' + have + '/' + input.quantity + ')';
    }
    return null;
  }

  private nextProjectId(): string {
    const ctx = this.ctx;
    if (!ctx) return 'build_0_1';
    const existing = new Set(ctx.state.building.projects.map((project) => project.id));
    const stamp = Math.round(ctx.clock.simTimeSeconds);
    let counter = 1;
    let candidate = 'build_' + stamp + '_' + counter;
    while (existing.has(candidate)) {
      counter += 1;
      candidate = 'build_' + stamp + '_' + counter;
    }
    return candidate;
  }

  private uniqueFarmingId(prefix: string, seed: number): EntityId {
    const ctx = this.ctx;
    if (!ctx) return prefix + '_' + seed + '_1';
    const existing = new Set(Object.keys(ctx.state.farming.greenhouses));
    let counter = seed + 1;
    let candidate = prefix + '_' + counter;
    while (existing.has(candidate)) {
      counter += 1;
      candidate = prefix + '_' + counter;
    }
    return candidate;
  }

  private uniquePlotId(base: string): EntityId {
    const ctx = this.ctx;
    if (!ctx) return 'plot_' + base;
    const existing = new Set(Object.keys(ctx.state.farming.plots));
    let counter = 1;
    let candidate = 'plot_' + base;
    while (existing.has(candidate)) {
      counter += 1;
      candidate = 'plot_' + base + '_' + counter;
    }
    return candidate;
  }

  private pruneProjects(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const projects = ctx.state.building.projects;
    if (projects.length <= MAX_KEPT_PROJECTS) return;
    let toRemove = projects.length - MAX_KEPT_PROJECTS;
    for (let index = 0; index < projects.length && toRemove > 0; index += 1) {
      const project = projects[index];
      if (!project || project.status === 'building') continue;
      projects.splice(index, 1);
      index -= 1;
      toRemove -= 1;
    }
  }

  private appendHistory(
    category: WorldHistoryCategory,
    description: string,
    importance: number,
    locationId: LocationId
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const history = ctx.state.world.history;
    const entry: WorldHistoryEntry = {
      id: 'hist_build_' + history.length + '_' + Math.round(ctx.clock.simTimeSeconds),
      at: ctx.clock.simTimeSeconds,
      category,
      description,
      importance,
      participantIds: [],
      locationId,
    };
    history.push(entry);
    const cap = WORLD_CONFIG.simulation.maxHistoryEntries;
    if (history.length > cap) history.splice(0, history.length - cap);
  }

  private canModify(home: HomeState): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (home.ownerId === ctx.state.player.id) return true;
    return ctx.state.housing.ownedHomeIds.includes(home.id);
  }

  private firstOwnedHome(): HomeState | undefined {
    const ctx = this.ctx;
    if (!ctx) return undefined;
    const playerId = ctx.state.player.id;
    const ownedIds = new Set(ctx.state.housing.ownedHomeIds);
    return Object.values(ctx.state.housing.homes).find(
      (home) => home.ownerId === playerId || ownedIds.has(home.id)
    );
  }

  private housingSystem(): HousingBridge | null {
    const ctx = this.ctx;
    if (!ctx || !ctx.registry.has('housing')) return null;
    return ctx.registry.getRequired<HousingBridge>('housing');
  }

  private getSkillLevel(skill: BlueprintDef['skill']): number {
    const ctx = this.ctx;
    if (!ctx) return 1;
    return this.skillSystem()?.getLevel(skill) ?? ctx.state.player.skills[skill]?.level ?? 1;
  }

  private skillSystem(): ISkillSystem | null {
    const ctx = this.ctx;
    if (!ctx || !ctx.registry.has('skill')) return null;
    return ctx.registry.getRequired<ISkillSystem>('skill');
  }

  private requireContext(): IGameContext | null {
    return this.ctx;
  }

  private fail(code: ActionResult['code'], message: string): ActionResult {
    const result: ActionResult = { ok: false, message };
    if (code) result.code = code;
    return result;
  }
}

/** Kept for symmetry with other systems; a BuildingState is created by WorldFactory. */
export function isBuildingState(value: unknown): value is BuildingState {
  if (!value || typeof value !== 'object') return false;
  return Array.isArray((value as BuildingState).projects);
}
