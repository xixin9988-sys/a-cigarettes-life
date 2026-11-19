import type {
  ActionResult,
  ArchivedLife,
  CigaretteAppearance,
  GameAction,
  GameScreen,
  GameSettings,
  GameState,
  IContentRegistry,
  IEventBus,
  IGameApi,
  IGameSystems,
  ILogger,
  IProbabilityEngine,
  ISaveManager,
  NewGameOptions,
  OfflineSimRequest,
  OfflineSimResult,
  OfflineSummary,
  ProbabilityDebugInfo,
  SaveSlotMeta,
} from './contracts';
import { createInitialGameState, DEFAULT_APPEARANCE, DEFAULT_PLAYER_ID } from './WorldFactory';
import type { EquipmentSlot } from './SharedTypes';
import { WORLD_CONFIG } from './WorldConfig';
import { ConsoleLogger } from './GameLogger';
import { hashString, clamp } from './utils';
import { addItemToInventory, findEntry, removeItemFromInventory } from './InventoryUtil';
import { createWorkerRequestId } from '../workers/WorkerProtocol';
import { SimulationRuntime } from '../simulation/SimulationRuntime';
import { EventBus } from './EventBus';
import { SaveManager } from '../persistence/SaveManager';
import { WorkerBridge } from '../workers/WorkerBridge';
import type { NPCId } from './SharedTypes';

export interface GameEngineOptions {
  content: IContentRegistry;
  logger?: ILogger;
  saveManager?: SaveManager;
  workerBridge?: WorkerBridge | null;
  initialSeed?: number;
}

const REST_CHUNK_SIM_SECONDS = 180;

/**
 * Top-level game engine: owns the GameState, the SimulationRuntime, persistence and the
 * Web Worker bridge. It is Phaser/DOM-free; main.ts drives tick() and renders the state.
 */
export class GameEngine implements IGameApi {
  private readonly content: IContentRegistry;
  private readonly logger: ILogger;
  private runtime!: SimulationRuntime;
  private saveManager!: SaveManager;
  private worker: WorkerBridge | null;
  private workerDisabled = false;
  private screen: GameScreen = 'menu';
  private offlineSummary: OfflineSummary | null = null;
  private autosaveAccumulator = 0;
  private initialised = false;
  private hiddenSimTimer: ReturnType<typeof setInterval> | null = null;
  private hiddenLastTickMs = 0;
  private backgroundBusy = false;
  private hiddenSimActive = false;
  private readonly initialSeed: number;
  private readonly bus: IEventBus;

  constructor(options: GameEngineOptions) {
    this.bus = new EventBus();
    this.content = options.content;
    this.logger = options.logger ?? new ConsoleLogger({ minLevel: 'warn', prefix: '[game]' });
    this.worker = options.workerBridge === undefined ? null : options.workerBridge;
    this.initialSeed = options.initialSeed ?? (hashString(String(Date.now())) >>> 0);
    this.createPlaceholderSaveManager(options.saveManager);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  private createPlaceholderSaveManager(provided?: SaveManager): void {
    this.saveManager =
      provided ??
      new SaveManager({
        getState: () => this.state,
        applyState: (state) => {
          this.state = state;
        },
        beforeSave: () => this.runtime?.flushPersistence(),
        logger: this.logger,
      });
  }

  private stateInternal: GameState | null = null;

  get state(): GameState {
    if (!this.stateInternal) throw new Error('GameEngine state is not initialised');
    return this.stateInternal;
  }

  private set state(value: GameState) {
    this.stateInternal = value;
  }

  async init(): Promise<void> {
    if (this.initialised) return;
    this.state = createInitialGameState({
      seed: this.initialSeed,
      playerName: 'Ash',
      appearance: DEFAULT_APPEARANCE,
      content: this.content,
    });
    this.runtime = new SimulationRuntime({
      state: this.state,
      content: this.content,
      logger: this.logger,
      bus: this.bus,
    });
    this.bindSaveManager();
    await this.saveManager.init();
    this.screen = 'menu';
    this.initialised = true;
  }

  private bindSaveManager(): void {
    const systems = this.runtime.systems as { save: ISaveManager };
    systems.save = this.saveManager;
  }

  private replaceState(state: GameState): void {
    this.runtime?.dispose();
    this.state = state;
    this.runtime = new SimulationRuntime({
      state,
      content: this.content,
      logger: this.logger,
      bus: this.bus,
      syncIdCounter: true,
    });
    this.bindSaveManager();
  }

  destroy(): void {
    this.runtime?.dispose();
    this.worker?.terminate();
    this.worker = null;
    this.saveManager.close();
  }

  getSaveManager(): SaveManager {
    return this.saveManager;
  }

  getRuntime(): SimulationRuntime {
    return this.runtime;
  }

  // -------------------------------------------------------------------------
  // IGameApi - read model
  // -------------------------------------------------------------------------
  getState(): Readonly<GameState> {
    return this.state;
  }

  getContent(): IContentRegistry {
    return this.content;
  }

  getClock(): ReturnType<IGameApi['getClock']> {
    return this.runtime.clock;
  }

  getEventBus(): IEventBus {
    return this.bus;
  }

  getScreen(): GameScreen {
    return this.screen;
  }

  setScreen(screen: GameScreen): void {
    this.screen = screen;
  }

  isPlaying(): boolean {
    return this.screen === 'playing' && this.state.life.phase === 'alive';
  }

  getSystems(): IGameSystems {
    return this.runtime.systems;
  }

  getProbabilityDebug(): ProbabilityDebugInfo {
    const probability: IProbabilityEngine = this.runtime.probability;
    const streams = probability.listStreams();
    const stats = streams.map((stream) => probability.getStats(stream));
    const exported = probability.exportState();
    return {
      seed: probability.seed,
      streams,
      stats,
      recent: probability.getHistory(30),
      streamStates: exported.streams,
    };
  }

  getOfflineSummary(): OfflineSummary | null {
    return this.offlineSummary;
  }

  acknowledgeOfflineSummary(): void {
    this.offlineSummary = null;
    if (this.stateInternal) this.stateInternal.pendingOffline.pendingSummary = null;
  }

  getLifeArchive(): ArchivedLife[] {
    return this.state.archive;
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------
  tick(deltaRealSeconds: number): void {
    if (!this.initialised) return;
    // While the tab is hidden the Worker owns background simulation; the main thread pauses
    // so the returned snapshot can be applied safely without double-simulating.
    if (this.hiddenSimActive) return;
    if (this.screen !== 'playing') return;
    const simDelta = this.runtime.clock.advanceRealSeconds(deltaRealSeconds);
    if (simDelta <= 0) return;
    try {
      this.runtime.update(simDelta);
    } catch (error) {
      this.logger.error('Simulation update failed', error);
      return;
    }
    this.state.meta.playTimeSeconds += deltaRealSeconds;
    this.autosaveAccumulator += deltaRealSeconds;
    const interval = Math.max(30, this.state.settings.autosaveIntervalSeconds);
    if (this.autosaveAccumulator >= interval && this.screen === 'playing') {
      this.autosaveAccumulator = 0;
      void this.saveGame(this.saveManager.getCurrentSlotId());
    }
    this.checkLifeEnd();
  }

  // -------------------------------------------------------------------------
  // Background (LOD2) simulation while the tab is hidden
  // -------------------------------------------------------------------------
  /** Hands the world to the simulation Worker while the browser tab is hidden. */
  startBackgroundSimulation(): void {
    if (!this.initialised || this.hiddenSimTimer) return;
    this.hiddenSimActive = true;
    this.hiddenLastTickMs = Date.now();
    this.hiddenSimTimer = setInterval(() => {
      void this.runHiddenBackgroundChunk();
    }, 5000);
  }

  /** Stops the hidden-tab Worker loop and persists the world it advanced. */
  stopBackgroundSimulation(): void {
    const wasActive = this.hiddenSimActive;
    this.hiddenSimActive = false;
    if (this.hiddenSimTimer) clearInterval(this.hiddenSimTimer);
    this.hiddenSimTimer = null;
    this.hiddenLastTickMs = Date.now();
    if (wasActive) void this.saveGame(this.saveManager.getCurrentSlotId());
  }

  isBackgroundSimulationActive(): boolean {
    return this.hiddenSimActive;
  }

  private async runHiddenBackgroundChunk(): Promise<void> {
    if (this.backgroundBusy || !this.initialised) return;
    const now = Date.now();
    const realSeconds = Math.min(300, Math.max(0, (now - this.hiddenLastTickMs) / 1000));
    if (realSeconds < 1) return;
    this.hiddenLastTickMs = now;
    const worker = await this.ensureWorker();
    if (!worker) return;
    this.backgroundBusy = true;
    try {
      this.runtime.flushPersistence();
      const simDeltaSeconds = realSeconds * WORLD_CONFIG.worldTime.offlineTimeScale;
      const result = await worker.requestBackground(structuredClone(this.state), simDeltaSeconds);
      if (result.simTimeSeconds > this.state.clock.simTimeSeconds) {
        const next = result.state;
        const ended = next.life.phase === 'ended';
        next.pendingOffline.lastSaveRealMs = Date.now();
        next.pendingOffline.lastProcessedSimTime = result.simTimeSeconds;
        next.pendingOffline.lastOfflineSimTime = result.simTimeSeconds;
        this.replaceState(next);
        this.runtime.clock.setSpeed(next.settings.speed);
        if (ended) this.checkLifeEnd();
        this.logger.debug('Background worker advanced world to sim time ' + result.simTimeSeconds.toFixed(1));
      }
    } catch (error) {
      this.logger.warn('Hidden-tab background simulation failed', String(error));
    } finally {
      this.backgroundBusy = false;
    }
  }

  private checkLifeEnd(): void {
    if (this.state.life.phase === 'ended' && this.screen === 'playing') {
      this.screen = 'life_end';
      const review = this.getSystems().life.getLifeReview();
      if (review) void this.saveManager.saveArchivedLife(review);
      void this.saveGame(this.saveManager.getCurrentSlotId());
      this.runtime.bus.emit('game:signal', { name: 'life:ended' });
    }
  }

  // -------------------------------------------------------------------------
  // Game lifecycle
  // -------------------------------------------------------------------------
  newGame(options: NewGameOptions): ActionResult {
    if (!this.initialised) return this.fail('Game engine is not ready');
    const seed = (options.seed ?? hashString(options.playerName + ':' + Date.now())) >>> 0;
    const state = createInitialGameState({
      seed,
      playerName: options.playerName || 'Ash',
      appearance: options.appearance,
      content: this.content,
    });
    this.replaceState(state);
    this.screen = 'playing';
    this.offlineSummary = null;
    if (options.slotId) this.saveManager.setCurrentSlotId(options.slotId);
    this.runtime.clock.setSpeed(state.settings.speed);
    this.runtime.bus.emit('game:signal', { name: 'game:started' });
    void this.saveGame(this.saveManager.getCurrentSlotId());
    return this.ok('A new cigarette is lit.');
  }

  async saveGame(slotId: string): Promise<ActionResult> {
    try {
      this.runtime.flushPersistence();
      const result = await this.saveManager.save(slotId);
      if (result.ok) this.runtime.bus.emit('save:completed', { slotId, savedAt: Date.now() });
      return result;
    } catch (error) {
      return this.fail('Save failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  async loadGame(slotId: string): Promise<ActionResult> {
    try {
      const loaded = await this.saveManager.load(slotId);
      if (!loaded) return this.fail('Save slot is empty');
      this.replaceState(loaded);
      this.runtime.clock.setSpeed(loaded.settings.speed);
      this.screen = loaded.life.phase === 'ended' ? 'life_end' : 'playing';
      this.offlineSummary = null;
      await this.requestOfflineCatchup();
      return this.ok('Welcome back.');
    } catch (error) {
      return this.fail('Load failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  async listSaveSlots(): Promise<SaveSlotMeta[]> {
    try {
      return await this.saveManager.listSlots();
    } catch {
      return [];
    }
  }

  async requestOfflineCatchup(): Promise<OfflineSimResult | null> {
    if (!this.initialised) return null;
    const state = this.state;
    const now = Date.now();
    const lastSaveReal = state.pendingOffline.lastSaveRealMs || state.meta.lastRealTimestampMs || now;
    const realElapsedMs = Math.max(0, now - lastSaveReal);
    if (realElapsedMs < 45_000) return null;
    const from = state.pendingOffline.lastOfflineSimTime || state.clock.simTimeSeconds;
    const rawSimSeconds = (realElapsedMs / 1000) * WORLD_CONFIG.worldTime.offlineTimeScale;
    const simSeconds = Math.min(rawSimSeconds, WORLD_CONFIG.worldTime.maxOfflineGameDays * 1440);
    if (simSeconds < 120) return null;
    const to = from + simSeconds;
    this.runtime.flushPersistence();
    const request: OfflineSimRequest = {
      requestId: createWorkerRequestId('offline'),
      baseState: structuredClone(this.state),
      fromSimTime: from,
      toSimTime: to,
      realElapsedMs,
      baseProcessedSimTime: state.pendingOffline.lastProcessedSimTime,
    };
    let result: OfflineSimResult | null = null;
    const worker = await this.ensureWorker();
    if (worker) {
      try {
        result = await worker.requestOffline(request);
      } catch (error) {
        this.logger.warn('Worker offline simulation failed, falling back to main thread', String(error));
        result = null;
      }
    }
    if (!result) {
      try {
        this.runtime.setSimTimeSeconds(from);
        // The main-thread fallback must apply the same offline multipliers as the worker path.
        this.state.flags['offline_simulation'] = true;
        const local = await this.runtime
          .runOffline(
            from,
            to,
            (percent, phase) => {
              this.runtime.bus.emit('offline:progress', { percent, phase });
            },
            realElapsedMs
          )
          .finally(() => {
            delete this.state.flags['offline_simulation'];
          });
        result = {
          requestId: request.requestId,
          ok: true,
          lastProcessedSimTime: to,
          state: this.state,
          summary: local.summary,
          stats: local.stats,
        };
      } catch (error) {
        this.logger.error('Local offline simulation failed', error);
        return null;
      }
    }
    return this.applyOfflineResult(result, request);
  }

  private applyOfflineResult(result: OfflineSimResult, request: OfflineSimRequest): OfflineSimResult | null {
    if (!result.ok) {
      this.logger.warn('Offline result not ok', result.error ?? 'unknown');
      return null;
    }
    if (result.lastProcessedSimTime !== request.toSimTime) {
      this.logger.warn('Offline result stale (sim time mismatch)');
      return null;
    }
    const currentProcessed = this.state.pendingOffline.lastProcessedSimTime;
    if (currentProcessed > result.lastProcessedSimTime) {
      this.logger.warn('Offline result already processed (idempotency lock)');
      return null;
    }
    const next = result.state;
    next.pendingOffline.pendingSummary = result.summary;
    next.pendingOffline.lastProcessedSimTime = result.lastProcessedSimTime;
    next.pendingOffline.lastOfflineSimTime = result.lastProcessedSimTime;
    next.pendingOffline.lastSaveRealMs = Date.now();
    next.pendingOffline.offlineLockToken = null;
    const wasScreen = this.screen;
    const lifeEnded = next.life.phase === 'ended';
    this.replaceState(next);
    this.screen = lifeEnded ? 'life_end' : wasScreen === 'life_end' ? 'life_end' : 'playing';
    this.offlineSummary = result.summary;
    this.runtime.bus.emit('offline:completed', { summary: result.summary });
    // Commit the settled world atomically (ping-pong envelope + lastProcessedSimTime) so a
    // crash after this point can never re-settle the same offline window.
    void this.saveGame(this.saveManager.getCurrentSlotId());
    this.logger.info('Offline simulation complete', String(result.stats.steps) + ' steps');
    return result;
  }

  private async ensureWorker(): Promise<WorkerBridge | null> {
    if (this.workerDisabled) return null;
    if (this.worker && this.worker.ready) return this.worker;
    if (!this.worker) this.worker = new WorkerBridge();
    try {
      await this.worker.start((percent, phase) => {
        this.runtime.bus.emit('offline:progress', { percent, phase });
      });
      return this.worker;
    } catch (error) {
      this.workerDisabled = true;
      this.logger.warn('Web Worker unavailable; continuing without background simulation', String(error));
      this.worker.terminate();
      this.worker = null;
      return null;
    }
  }

  startNextLife(legacyItemIds: string[]): ActionResult {
    if (this.state.life.phase !== 'ended') return this.fail('The current life has not ended yet');
    const old = this.state;
    const archived = old.archive.length > 0 ? old.archive[old.archive.length - 1] : null;
    const generation = old.life.generation + 1;
    const newSeed = hashString(String(old.meta.seed) + ':generation:' + generation) >>> 0;
    const next = createInitialGameState({
      seed: newSeed,
      playerName: (archived?.name ?? old.player.name) + ' II',
      appearance: old.player.appearance,
      content: this.content,
    });
    // The world keeps living: transfer persistent world/NPC/economy/archive continuity.
    // Time is continuous across generations - the new cigarette is lit in the current world year.
    next.clock = { ...old.clock, paused: false, speed: old.settings.speed };
    next.meta.createdAt = Date.now();
    next.meta.lastProcessedSimTime = next.clock.simTimeSeconds;
    next.meta.lastRealTimestampMs = Date.now();
    next.life.startedAt = next.clock.simTimeSeconds;
    next.life.ageDays = 0;
    next.player.lastActionAt = next.clock.simTimeSeconds;
    next.world = old.world;
    next.npcs = old.npcs;
    next.economy = old.economy;
    next.archive = old.archive;
    next.collection = old.collection;
    next.housing = old.housing;
    next.flags = old.flags;
    next.settings = old.settings;
    next.meta.generation = generation;
    next.life.generation = generation;
    next.life.lifeId = 'life_' + generation;
    next.player.lifeId = next.life.lifeId;
    next.meta.lifeId = next.player.lifeId;
    next.world.worldId = old.world.worldId;
    next.meta.worldId = old.world.worldId;
    // A new cigarette is a new person: NPCs do not remember being friends with the previous one.
    for (const npc of Object.values(next.npcs)) {
      delete npc.relationships[DEFAULT_PLAYER_ID];
    }
    // Prefer the same home; keep residence consistent with the persisted housing record.
    const playerHome = next.housing.homes['home_player'];
    if (playerHome) {
      next.player.residenceId = playerHome.locationId;
      const homeDef = this.content.getLocation(playerHome.locationId);
      if (homeDef) {
        next.player.position = {
          regionId: homeDef.regionId,
          locationId: homeDef.id,
          x: (homeDef.widthTiles * 32) / 2,
          y: (homeDef.heightTiles * 32) / 2,
          indoor: true,
        };
      }
    }
    // Legacy: at most three mementos from the previous life.
    const chosen = legacyItemIds.slice(0, WORLD_CONFIG.life.maxLegacyItems);
    for (const itemId of chosen) {
      if (!this.content.getItem(itemId)) continue;
      addItemToInventory(next.player.inventory, itemId, 1, {
        quality: 3,
        freshness: 1,
        simTime: next.clock.simTimeSeconds,
        meta: { legacy: true, generation: generation - 1 },
      });
      next.life.legacyItemIds.push(itemId);
    }
    this.replaceState(next);
    this.screen = 'playing';
    this.offlineSummary = null;
    this.runtime.clock.setSpeed(next.settings.speed);
    this.runtime.bus.emit('game:signal', { name: 'generation:started', data: generation });
    void this.saveGame(this.saveManager.getCurrentSlotId());
    return this.ok('A new generation begins. ' + chosen.length + ' memento(s) carried over.');
  }

  // -------------------------------------------------------------------------
  // Action dispatch
  // -------------------------------------------------------------------------
  dispatch(action: GameAction): ActionResult {
    if (!this.initialised) return this.fail('Game engine is not ready');
    try {
      return this.dispatchInternal(action);
    } catch (error) {
      this.logger.error('Action failed: ' + action.type, error);
      return this.fail('Action failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private dispatchInternal(action: GameAction): ActionResult {
    const systems = this.runtime.systems;
    switch (action.type) {
      case 'move:to-location':
      case 'move:enter':
        return systems.world.travelTo(action.locationId);
      case 'move:exit-interior': {
        const current = this.state.player.position.locationId;
        const def = this.content.getLocation(current);
        if (!def || !def.entranceFrom) return this.fail('There is no way out from here');
        return systems.world.travelTo(def.entranceFrom);
      }
      case 'move:position':
        return this.movePlayer(action.x, action.y);
      case 'interact':
        return this.interact(action.targetKind, action.targetId);
      case 'inventory:use':
        return this.useItem(action.instanceId);
      case 'inventory:drop': {
        const entry = findEntry(this.state.player.inventory, action.instanceId);
        if (!entry) return this.fail('Item not found');
        const removed = removeItemFromInventory(this.state.player.inventory, entry.itemId, Math.max(1, action.quantity), action.instanceId);
        if (removed <= 0) return this.fail('Could not drop that item');
        this.runtime.bus.emit('item:lost', { itemId: entry.itemId, quantity: removed, reason: 'dropped' });
        return this.ok('Dropped ' + removed + ' item(s)');
      }
      case 'inventory:equip':
        return this.equipItem(action.instanceId);
      case 'inventory:unequip': {
        this.state.player.equipment[action.slot] = null;
        return this.ok('Unequipped');
      }
      case 'inventory:read-book':
        return this.readBook(action.instanceId);
      case 'ash:collect':
        return systems.life.collectAsh();
      case 'farm:till':
        return systems.farming.tillPlot(action.locationId, action.x, action.y);
      case 'farm:plant':
        return systems.farming.plantSeed(action.plotId, action.seedItemId);
      case 'farm:water':
        return systems.farming.waterPlot(action.plotId);
      case 'farm:fertilize':
        return systems.farming.fertilizePlot(action.plotId, action.fertilizer);
      case 'farm:harvest':
        return systems.farming.harvestPlot(action.plotId);
      case 'farm:clear':
        return systems.farming.clearPlot(action.plotId);
      case 'farm:build-greenhouse':
        return systems.farming.buildGreenhouse(action.locationId);
      case 'fish:cast':
        return systems.fishing.castLine(action.locationId, action.rodInstanceId, action.baitInstanceId);
      case 'fish:reel':
        return systems.fishing.reel(action.hold);
      case 'fish:cancel':
        return systems.fishing.cancelFishing();
      case 'forage:gather':
        return systems.foraging.gather(action.nodeId);
      case 'explore:search':
        return systems.exploration.search(action.locationId);
      case 'explore:unlock':
        return systems.exploration.unlockSecret(action.locationId);
      case 'explore:photo':
        return systems.exploration.takePhoto(action.locationId);
      case 'craft':
        return systems.crafting.craft(action.recipeId, action.quantity);
      case 'cook':
        return systems.cooking.cook(action.recipeId);
      case 'build:start':
        return systems.building.startProject(action.blueprintId, action.locationId);
      case 'build:cancel':
        return systems.building.cancelProject(action.projectId);
      case 'housing:place':
        return systems.housing.placeFurniture(action.itemInstanceId, action.x, action.y, action.rotation);
      case 'housing:remove':
        return systems.housing.removeFurniture(action.placedFurnitureId);
      case 'housing:paint':
        return systems.housing.paintWall(action.homeId, action.color);
      case 'housing:floor':
        return systems.housing.setFloorStyle(action.homeId, action.style);
      case 'housing:store':
        return systems.housing.storeItem(action.homeId, action.instanceId);
      case 'housing:take':
        return systems.housing.takeItem(action.homeId, action.instanceId);
      case 'housing:add-room':
        return systems.housing.addRoom(action.homeId, action.blueprintId);
      case 'shop:buy':
        return systems.economy.buyFromBusiness(action.businessId, action.itemId, action.quantity);
      case 'shop:sell':
        return systems.economy.sellToBusiness(action.businessId, action.itemId, action.quantity, action.instanceId);
      case 'shop:price':
        return systems.economy.setPlayerShopPrice(action.itemId, action.pricePence);
      case 'shop:restock':
        return systems.economy.restockPlayerShop(action.itemId, action.quantity);
      case 'shop:open':
        return systems.economy.togglePlayerShopOpen(action.open);
      case 'shop:hire':
        return systems.economy.hireEmployee(action.npcId);
      case 'shop:fire':
        return systems.economy.fireEmployee(action.npcId);
      case 'shop:buy-business':
        return systems.economy.buyPlayerShop(action.businessId);
      case 'work:apply':
        return systems.economy.applyForJob(action.jobId);
      case 'work:shift':
        return systems.economy.workShift();
      case 'work:quit':
        return systems.economy.quitJob();
      case 'social:talk':
        return systems.social.talkTo(action.npcId);
      case 'social:gift':
        return systems.social.giveGift(action.npcId, action.instanceId);
      case 'social:help':
        return systems.social.helpNPC(action.npcId);
      case 'social:invite':
        return systems.social.inviteNPC(action.npcId, action.activity);
      case 'social:accept-invite':
        return systems.social.acceptInvitation(action.invitationId);
      case 'social:decline-invite':
        return systems.social.declineInvitation(action.invitationId);
      case 'social:confess':
        return systems.social.confessTo(action.npcId);
      case 'social:date':
        return systems.social.goOnDate(action.npcId);
      case 'social:apologise':
        return systems.social.apologiseTo(action.npcId);
      case 'social:propose':
        return systems.social.proposeCommunityProject(action.proposalId);
      case 'dialogue:start':
        return systems.dialogue.startConversation(action.npcId);
      case 'dialogue:choose':
        return systems.dialogue.choose(action.choiceIndex);
      case 'dialogue:end':
        return systems.dialogue.endConversation();
      case 'train:buy-ticket':
        return systems.world.buyTrainTicket(action.routeId);
      case 'train:board':
        return systems.world.boardTrain();
      case 'life:customize':
        return systems.life.customizeAppearance(action.appearance);
      case 'life:set-goal':
        return systems.life.choosePersonalGoal(action.goalId);
      case 'life:warm-up':
        return systems.life.warmUp(action.source ?? 'warmth');
      case 'life:read-letter':
        return systems.life.readLetter(action.letterId);
      case 'life:end':
        return systems.life.endLife(action.reason ?? 'chosen');
      case 'life:next-generation':
        return this.startNextLife(action.legacyItemIds);
      case 'event:acknowledge':
        return systems.events.acknowledgeEvent(action.eventId);
      case 'festival:participate':
        return systems.events.participateFestival(action.festivalId, action.activityId);
      case 'collection:donate':
        return systems.collection.donateToMuseum(action.itemId);
      case 'save': {
        const slotId = action.slotId ?? this.saveManager.getCurrentSlotId();
        void this.saveGame(slotId);
        return this.ok('Saving...');
      }
      case 'load': {
        void this.loadGame(action.slotId);
        return this.ok('Loading...');
      }
      case 'time:rest':
        return this.rest(action.hours);
      case 'settings:update':
        return this.updateSettings(action.settings);
      default:
        return this.fail('Unknown action');
    }
  }

  // -------------------------------------------------------------------------
  // Action helpers
  // -------------------------------------------------------------------------
  private movePlayer(x: number, y: number): ActionResult {
    const pos = this.state.player.position;
    const def = this.content.getLocation(pos.locationId);
    const width = (def?.widthTiles ?? 20) * 32;
    const height = (def?.heightTiles ?? 20) * 32;
    pos.x = clamp(x, 8, Math.max(8, width - 8));
    pos.y = clamp(y, 8, Math.max(8, height - 8));
    if (def) pos.indoor = def.indoor;
    const before = this.state.player.statistics.steps;
    this.state.player.statistics.steps = before + 1;
    return this.ok('Moved');
  }

  private interact(targetKind: string, targetId: string): ActionResult {
    const systems = this.runtime.systems;
    switch (targetKind) {
      case 'npc':
        return systems.dialogue.startConversation(targetId as NPCId);
      case 'forage_node':
      case 'forage':
        return systems.foraging.gather(targetId);
      case 'fishing_spot':
        return systems.fishing.castLine(this.state.player.position.locationId);
      case 'bed':
        return this.rest(8);
      case 'train':
        return systems.world.boardTrain();
      case 'shop':
      case 'workbench':
      case 'kitchen':
      case 'museum':
      case 'noticeboard':
      case 'cinema_screen':
      case 'stage':
        return this.ok('Interacting with ' + targetKind);
      default:
        return this.fail('Nothing to interact with there');
    }
  }

  private useItem(instanceId: string): ActionResult {
    const player = this.state.player;
    const entry = findEntry(player.inventory, instanceId);
    if (!entry) return this.fail('Item not found in your inventory');
    const def = this.content.getItem(entry.itemId);
    if (!def) return this.fail('Unknown item');
    if (def.equipmentSlot) return this.equipItem(instanceId);
    if (def.readSkill) return this.readBook(instanceId);
    if (def.unlocksRecipes && def.unlocksRecipes.length > 0) return this.readBook(instanceId);
    const warmingSources = ['hand_warmer', 'matches', 'desiccant_pack', 'windproof_lighter'];
    if (warmingSources.includes(entry.itemId)) {
      const result = this.runtime.systems.life.warmUp(entry.itemId);
      if (result.ok) removeItemFromInventory(player.inventory, entry.itemId, 1, instanceId);
      return result;
    }
    const effects = def.effects ?? [];
    if (effects.length === 0 && !def.edible) {
      return this.fail('Nothing happens when you use that');
    }
    const simTime = this.runtime.clock.simTimeSeconds;
    for (const effect of effects) {
      switch (effect.kind) {
        case 'moisture_down':
          player.cigarette.moisture = clamp(player.cigarette.moisture - effect.value / 100, 0, 1);
          break;
        case 'moisture_up':
          player.cigarette.moisture = clamp(player.cigarette.moisture + effect.value / 100, 0, 1);
          break;
        case 'skill_xp':
          if (effect.skill) this.runtime.systems.skill.addXp(effect.skill, effect.value, 'item');
          break;
        case 'influence':
          player.influence = Math.max(0, player.influence + effect.value);
          break;
        case 'burn_slow':
        case 'energy':
        case 'hunger':
        case 'fun':
        case 'social':
        case 'mood':
        case 'luck': {
          const durationSeconds = (effect.durationHours ?? 2) * 60;
          const burnMultiplier = effect.kind === 'burn_slow' || effect.kind === 'energy' ? 0.92 : 1;
          player.statusEffects.push({
            id: entry.instanceId + ':' + effect.kind,
            label: def.name + (effect.kind === 'energy' ? ' (energised)' : ''),
            source: entry.itemId,
            startedAt: simTime,
            expiresAt: simTime + durationSeconds,
            burnRateMultiplier: burnMultiplier,
          });
          break;
        }
        default:
          break;
      }
    }
    removeItemFromInventory(player.inventory, entry.itemId, 1, instanceId);
    this.runtime.bus.emit('game:signal', { name: 'item:consumed', data: entry.itemId });
    return this.ok('Used ' + def.name);
  }

  private equipItem(instanceId: string): ActionResult {
    const player = this.state.player;
    const entry = findEntry(player.inventory, instanceId);
    if (!entry) return this.fail('Item not found');
    const def = this.content.getItem(entry.itemId);
    if (!def || !def.equipmentSlot) return this.fail(def ? def.name + ' cannot be equipped' : 'Unknown item');
    player.equipment[def.equipmentSlot] = entry.instanceId;
    this.runtime.bus.emit('game:signal', { name: 'item:equipped', data: def.id });
    return this.ok('Equipped ' + def.name);
  }

  private readBook(instanceId: string): ActionResult {
    const player = this.state.player;
    const entry = findEntry(player.inventory, instanceId);
    if (!entry) return this.fail('Book not found');
    const def = this.content.getItem(entry.itemId);
    if (!def) return this.fail('Unknown item');
    let gained = false;
    if (def.readSkill) {
      this.runtime.systems.skill.addXp(def.readSkill, 35, 'reading');
      gained = true;
    }
    if (def.unlocksRecipes) {
      for (const recipeId of def.unlocksRecipes) {
        if (!player.knownRecipes.includes(recipeId)) player.knownRecipes.push(recipeId);
        gained = true;
      }
    }
    if (!gained) return this.fail('There is nothing to learn from that');
    return this.ok('Read ' + def.name);
  }

  private rest(hours: number): ActionResult {
    const safeHours = clamp(hours, 0.25, WORLD_CONFIG.worldTime.maxOfflineGameDays * 24);
    let remaining = safeHours * 60; // sim seconds: 1 game hour = 60 sim seconds
    const start = this.runtime.clock.simTimeSeconds;
    while (remaining > 0) {
      const chunk = Math.min(REST_CHUNK_SIM_SECONDS, remaining);
      this.runtime.advance(chunk);
      remaining -= chunk;
      if (this.state.life.phase === 'ended') break;
    }
    this.checkLifeEnd();
    const restedHours = ((this.runtime.clock.simTimeSeconds - start) / 60).toFixed(1);
    this.runtime.bus.emit('game:signal', { name: 'time:rested', data: restedHours });
    return this.ok('Rested for ' + restedHours + ' game hours');
  }

  private updateSettings(partial: Partial<GameSettings>): ActionResult {
    const settings = this.state.settings;
    if (partial.speed !== undefined) {
      settings.speed = partial.speed;
      this.runtime.clock.setSpeed(partial.speed);
    }
    if (partial.autosaveIntervalSeconds !== undefined) settings.autosaveIntervalSeconds = partial.autosaveIntervalSeconds;
    if (partial.masterVolume !== undefined) settings.masterVolume = partial.masterVolume;
    if (partial.musicVolume !== undefined) settings.musicVolume = partial.musicVolume;
    if (partial.sfxVolume !== undefined) settings.sfxVolume = partial.sfxVolume;
    if (partial.textSpeed !== undefined) settings.textSpeed = partial.textSpeed;
    if (partial.showProbabilityDebug !== undefined) settings.showProbabilityDebug = partial.showProbabilityDebug;
    if (partial.showTutorialTips !== undefined) settings.showTutorialTips = partial.showTutorialTips;
    if (partial.keybindings !== undefined) settings.keybindings = { ...settings.keybindings, ...partial.keybindings };
    if (partial.reducedMotion !== undefined) settings.reducedMotion = partial.reducedMotion;
    return this.ok('Settings updated');
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------
  private ok(message: string): ActionResult {
    return { ok: true, message };
  }

  private fail(message: string): ActionResult {
    return { ok: false, code: 'invalid', message };
  }
}