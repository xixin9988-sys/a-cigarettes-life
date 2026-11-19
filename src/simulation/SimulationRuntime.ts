import type {
  GameState,
  IContentRegistry,
  IClock,
  IEventBus,
  IGameContext,
  IGameSystems,
  ILogger,
  IProbabilityEngine,
  IRngFacade,
  OfflineSummary,
  ISystemRegistry,
  ProbabilityPersistState,
} from '../core/contracts';
import type { GameTime } from '../core/SharedTypes';
import { Clock } from '../core/Clock';
import { EventBus } from '../core/EventBus';
import { SystemRegistry } from '../core/SystemRegistry';
import { RngFacade, createGameContext } from '../core/GameContext';
import { ConsoleLogger } from '../core/GameLogger';
import { ProbabilityEngine } from '../probability/ProbabilityEngine';
import { WorldSystem } from '../world/WorldManager';
import { NPCSystem } from '../npc/NPCSystem';
import { EconomySystem } from '../economy/EconomySystem';
import { SkillSystem } from '../gameplay/SkillSystem';
import { FarmingSystem } from '../gameplay/FarmingSystem';
import { ForagingSystem } from '../gameplay/ForagingSystem';
import { FishingSystem } from '../gameplay/FishingSystem';
import { ExplorationSystem } from '../gameplay/ExplorationSystem';
import { CraftingSystem } from '../gameplay/CraftingSystem';
import { CookingSystem } from '../gameplay/CookingSystem';
import { BuildingSystem } from '../gameplay/BuildingSystem';
import { HousingSystem } from '../gameplay/HousingSystem';
import { CollectionSystem } from '../gameplay/CollectionSystem';
import { SocialSystem } from '../social/SocialSystem';
import { DialogueSystem } from '../social/DialogueSystem';
import { EventSystem } from '../gameplay/EventSystem';
import { LifeSystem } from '../life/LifeSystem';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { configureIdGenerator, syncIdCounterFromState } from '../core/utils';
import { buildOfflineSummary, captureSummaryBaseline, type SummaryBaseline } from './OfflineSummaryBuilder';

export interface SimulationRuntimeOptions {
  state: GameState;
  content: IContentRegistry;
  logger?: ILogger;
  /** Shared event bus (the main thread keeps a stable bus across state replacements). */
  bus?: IEventBus;
  /** Systems to run. Defaults to all systems in dependency order. */
  systemIds?: string[];
  /** Set when restoring a loaded save: advances the deterministic id generator past saved ids. */
  syncIdCounter?: boolean;
}

export interface OfflineRunResult {
  state: GameState;
  summary: OfflineSummary;
  stats: {
    steps: number;
    npcDecisions: number;
    events: number;
    elapsedMs: number;
    transactions: number;
  };
}

/**
 * Owns the ordered composition of simulation systems, the probability engine, the event bus
 * and the clock for a given GameState. Used both on the main thread (active simulation) and
 * inside the Web Worker (background + offline simulation).
 */
export class SimulationRuntime {
  readonly state: GameState;
  readonly content: IContentRegistry;
  readonly bus: IEventBus;
  readonly clock: IClock;
  readonly probability: IProbabilityEngine;
  readonly registry: ISystemRegistry;
  readonly rng: IRngFacade;
  readonly logger: ILogger;
  readonly ctx: IGameContext;
  readonly systems: IGameSystems;

  private lastTime: GameTime;
  private active = true;

  constructor(options: SimulationRuntimeOptions) {
    this.state = options.state;
    this.content = options.content;
    this.logger = options.logger ?? new ConsoleLogger({ minLevel: 'warn', prefix: '[sim]' });
    this.bus = options.bus ?? new EventBus();
    this.clock = new Clock(this.state.clock);
    this.probability = new ProbabilityEngine();
    this.probability.init(this.state.meta.seed >>> 0, this.state.probability);
    this.registry = new SystemRegistry(this.bus);
    this.rng = new RngFacade(this.probability);

    const world = new WorldSystem();
    const npc = new NPCSystem();
    const economy = new EconomySystem();
    const skill = new SkillSystem();
    const farming = new FarmingSystem();
    const foraging = new ForagingSystem();
    const fishing = new FishingSystem();
    const exploration = new ExplorationSystem();
    const crafting = new CraftingSystem();
    const cooking = new CookingSystem();
    const building = new BuildingSystem();
    const housing = new HousingSystem();
    const collection = new CollectionSystem();
    const social = new SocialSystem();
    const dialogue = new DialogueSystem();
    const events = new EventSystem();
    const life = new LifeSystem();

    const ordered = [
      world,
      npc,
      economy,
      skill,
      farming,
      foraging,
      fishing,
      exploration,
      crafting,
      cooking,
      building,
      housing,
      collection,
      social,
      dialogue,
      events,
      life,
    ];
    const wanted = options.systemIds ? new Set(options.systemIds) : null;
    for (const system of ordered) {
      if (!wanted || wanted.has(system.id)) this.registry.register(system);
    }

    this.ctx = createGameContext({
      state: this.state,
      content: this.content,
      probability: this.probability,
      bus: this.bus,
      clock: this.clock,
      registry: this.registry,
      rng: this.rng,
      logger: this.logger,
    });
    this.registry.initAll(this.ctx);

    this.systems = {
      world,
      npc,
      economy,
      farming,
      fishing,
      foraging,
      exploration,
      crafting,
      cooking,
      building,
      housing,
      collection,
      skill,
      events,
      social,
      dialogue,
      life,
      save: undefined as unknown as IGameSystems['save'],
    };
    this.lastTime = this.clock.time;
    configureIdGenerator(this.state.meta.seed >>> 0);
    if (options.syncIdCounter) syncIdCounterFromState(this.state);
  }

  getSystem<T>(id: string): T | undefined {
    return this.registry.get(id) as unknown as T | undefined;
  }

  /** Emits time boundary events when the clock crosses an hour/day/season. */
  private emitTimeEvents(): void {
    const time = this.clock.time;
    const previous = this.lastTime;
    if (previous === time) return;
    if (time.hour !== previous.hour || time.totalDays !== previous.totalDays) {
      this.bus.emit('time:hour', { simTimeSeconds: this.clock.simTimeSeconds, time, hour: time.hour });
    }
    if (time.totalDays !== previous.totalDays) {
      this.bus.emit('time:day', { simTimeSeconds: this.clock.simTimeSeconds, time, day: time.totalDays });
      if (time.season !== previous.season) {
        this.bus.emit('time:season', { simTimeSeconds: this.clock.simTimeSeconds, time, season: time.season });
      }
    }
    this.lastTime = time;
  }

  /** Runs one simulation tick. The clock must already be advanced by the caller. */
  update(dtSimSeconds: number): void {
    if (!this.active) return;
    this.emitTimeEvents();
    this.registry.updateAll(dtSimSeconds);
    this.state.clock = this.clock.serialize();
  }

  /** Advances the clock then updates all systems. Used by offline/background simulation. */
  advance(dtSimSeconds: number): void {
    this.clock.advanceSimSeconds(dtSimSeconds);
    this.update(dtSimSeconds);
  }

  /** Flushes runtime-held state (probability streams, clock) into the serialisable GameState. */
  flushPersistence(): void {
    this.state.clock = this.clock.serialize();
    this.state.probability = this.probability.exportState();
    this.state.meta.lastProcessedSimTime = this.clock.simTimeSeconds;
    this.state.meta.savedAt = Date.now();
    this.state.meta.lastRealTimestampMs = Date.now();
  }

  importProbabilityState(state: ProbabilityPersistState): void {
    this.state.probability = state;
    this.probability.importState(state);
  }

  setSimTimeSeconds(seconds: number): void {
    this.clock.setSimTimeSeconds(seconds);
    this.state.clock = this.clock.serialize();
    this.lastTime = this.clock.time;
  }

  /**
   * Runs offline catch-up between two absolute sim times using adaptive time-step aggregation:
   * <1h -> 5 game-minute steps, 1-24h -> 30 minute steps, >24h -> 1 day steps.
   */
  async runOffline(
    fromSimTime: number,
    toSimTime: number,
    onProgress?: (percent: number, phase: string) => void,
    realElapsedMs?: number
  ): Promise<OfflineRunResult> {
    const startedAt = Date.now();
    const target = Math.max(fromSimTime, toSimTime);
    this.setSimTimeSeconds(fromSimTime);
    const baseline: SummaryBaseline = captureSummaryBaseline(this.state);
    const totalSeconds = target - fromSimTime;
    const gameHours = totalSeconds / 60;
    // Offline aggregation policy is defined on REAL hours away (spec: <1h / 1-24h / >24h).
    const realHours =
      realElapsedMs !== undefined && realElapsedMs >= 0
        ? realElapsedMs / 3_600_000
        : gameHours / 3; // fallback: 1 real hour == 3 game hours at offlineTimeScale 0.05

    let stepMinutes: number;
    if (realHours < 1) stepMinutes = WORLD_CONFIG.simulation.offlineStepMinutes.short;
    else if (realHours <= 24) stepMinutes = WORLD_CONFIG.simulation.offlineStepMinutes.medium;
    else stepMinutes = WORLD_CONFIG.simulation.offlineStepMinutes.long;
    // 1 sim second = 1 in-game minute, so a step of N game minutes is N sim seconds.
    const stepSimSeconds = Math.max(1, stepMinutes);
    const maxSteps = 4000;
    const estimatedSteps = Math.max(1, Math.ceil(totalSeconds / stepSimSeconds));
    const steps = Math.min(maxSteps, estimatedSteps);
    const actualStep = totalSeconds / steps;

    const stats = { steps: 0, npcDecisions: 0, events: 0, elapsedMs: 0, transactions: 0 };
    for (let index = 0; index < steps; index += 1) {
      this.advance(actualStep);
      stats.steps += 1;
      if (index % 25 === 0) {
        onProgress?.(Math.min(99, Math.round(((index + 1) / steps) * 100)), 'simulating');
        // Yield so a Worker can flush progress messages to the main thread.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    this.setSimTimeSeconds(target);
    this.flushPersistence();
    stats.events =
      this.state.world.events.length > 0
        ? Math.max(0, this.state.world.events.filter((event) => event.occurredAt > fromSimTime).length)
        : 0;
    stats.transactions = this.state.economy.transactions.filter((entry) => entry.at > fromSimTime).length;
    stats.elapsedMs = Date.now() - startedAt;
    onProgress?.(100, 'finalising');

    const summary = buildOfflineSummary({
      state: this.state,
      baseline,
      fromSimTime,
      toSimTime: target,
      realElapsedMs: Math.max(0, (target - fromSimTime) / Math.max(0.0001, WORLD_CONFIG.worldTime.offlineTimeScale) * 1000),
    });
    return { state: this.state, summary, stats };
  }

  dispose(): void {
    this.active = false;
    this.registry.all().length = 0;
  }
}