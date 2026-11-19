import type { AchievementState, GameEventMap, GameEventTopic, IGameContext } from '../core/contracts';
import type { AchievementDef } from '../data/schema';
import type { ILogger } from '../core/contracts';
import type { LifeCounters, TriggerContext } from './lifeShared';
import { evaluateTrigger, mutateLifeExtras, readLifeExtras } from './lifeShared';
import type { InfluenceSystem } from './InfluenceSystem';
import { ITEM } from '../data/items/ids';

/**
 * AchievementSystem - hidden milestones and life titles.
 *
 * Every achievement uses an AchievementDef trigger from src/data/achievements/achievements.ts
 * evaluated against real GameState data (statistics, skills, collections, relationships,
 * wealth, lifecycle counters). Achievements unlock exactly once, grant influence and are
 * emitted as 'achievement:unlocked' (LifeArchiveSystem archives them).
 */
const CAKE_OR_PIE_ITEM_IDS: readonly string[] = [ITEM.strawberryCake, ITEM.applePie];

export interface AchievementProgress {
  def: AchievementDef;
  state: AchievementState | null;
  /** Current trigger progress (only computed on request; cheap enough for panels). */
  progress: number;
}

export interface AchievementDeps {
  ctx: IGameContext;
  influence: InfluenceSystem;
  logger?: ILogger;
}

export class AchievementSystem {
  private readonly ctx: IGameContext;
  private readonly influence: InfluenceSystem;
  private readonly logger?: ILogger;
  private readonly unsubscribers: Array<() => void> = [];
  private initialized = false;

  constructor(deps: AchievementDeps) {
    this.ctx = deps.ctx;
    this.influence = deps.influence;
    if (deps.logger) this.logger = deps.logger;
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.subscribe('fish:caught', () => this.checkAll());
    this.subscribe('crop:harvested', (payload) => this.onCropHarvested(payload));
    this.subscribe('item:acquired', (payload) => this.onItemAcquired(payload));
    this.subscribe('money:changed', () => this.checkAll());
    this.subscribe('relationship:changed', () => this.checkAll());
    this.subscribe('discovery:made', () => this.checkAll());
    this.subscribe('festival:participated', () => this.checkAll());
    this.subscribe('event:occurred', () => this.checkAll());
    this.subscribe('game:signal', (payload) => this.onGameSignal(payload.name));
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.initialized = false;
  }

  private subscribe<K extends GameEventTopic>(topic: K, handler: (payload: GameEventMap[K]) => void): void {
    this.unsubscribers.push(this.ctx.bus.on(topic, handler));
  }

  /** Trigger context used to evaluate goals and achievements against live state. */
  getTriggerContext(): TriggerContext {
    const counters = this.getCounters();
    return { state: this.ctx.state, content: this.ctx.content, counters };
  }

  getCounters(): LifeCounters {
    return readLifeExtras(this.ctx.state).counters;
  }

  /** Evaluates every locked achievement and unlocks those whose trigger threshold is met. */
  checkAll(): void {
    const state = this.ctx.state;
    if (state.life.phase !== 'alive') return;
    const defs = this.ctx.content.pack.achievements;
    if (defs.length === 0) return;
    const now = this.ctx.clock.simTimeSeconds;
    const context = this.getTriggerContext();
    for (const def of defs) {
      if (this.isUnlocked(def.id)) continue;
      const value = evaluateTrigger(context, def.trigger);
      if (value < def.trigger.threshold) continue;
      this.unlock(def, now);
    }
  }

  /** All achievements paired with their unlock state, for the life panel. */
  getAll(): { def: AchievementDef; state: AchievementState | null }[] {
    const unlocked = new Map<string, AchievementState>();
    for (const achievement of this.ctx.state.life.achievements) unlocked.set(achievement.id, achievement);
    return this.ctx.content.pack.achievements.map((def) => {
      const achievementState = unlocked.get(def.id);
      return achievementState ? { def, state: achievementState } : { def, state: null };
    });
  }

  /** Achievement definitions with current progress, for journal / life panel UI. */
  getProgressList(): AchievementProgress[] {
    const context = this.getTriggerContext();
    const unlocked = new Map<string, AchievementState>();
    for (const achievement of this.ctx.state.life.achievements) unlocked.set(achievement.id, achievement);
    return this.ctx.content.pack.achievements.map((def) => {
      const achievementState = unlocked.get(def.id) ?? null;
      const progress = achievementState ? def.trigger.threshold : evaluateTrigger(context, def.trigger);
      return { def, state: achievementState, progress };
    });
  }

  getUnlocked(): AchievementState[] {
    return this.ctx.state.life.achievements.map((achievement) => ({ ...achievement }));
  }

  isUnlocked(achievementId: string): boolean {
    return this.ctx.state.life.achievements.some((achievement) => achievement.id === achievementId);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------
  private unlock(def: AchievementDef, now: number): void {
    const state = this.ctx.state;
    if (this.isUnlocked(def.id)) return;
    state.life.achievements.push({ id: def.id, unlockedAt: now });
    if (def.rewardInfluence > 0) {
      this.influence.gainInfluence(def.rewardInfluence, 'achievement:' + def.id);
    }
    this.ctx.bus.emit('achievement:unlocked', { achievementId: def.id, title: def.title });
    this.logger?.info('achievement unlocked', { achievementId: def.id, title: def.title });
  }

  private onCropHarvested(payload: GameEventMap['crop:harvested']): void {
    if (payload.quality >= 5 && payload.quantity > 0) {
      const perfectQuantity = Math.floor(payload.quantity);
      if (perfectQuantity > 0) {
        mutateLifeExtras(this.ctx.state, (extras) => {
          extras.counters.perfectCrops += perfectQuantity;
        });
      }
    }
    this.checkAll();
  }

  private onItemAcquired(payload: GameEventMap['item:acquired']): void {
    if (CAKE_OR_PIE_ITEM_IDS.includes(payload.itemId)) {
      // A cake is only 'baked' when it comes from a kitchen, not from a shop shelf.
      const source = payload.source.toLowerCase();
      const purchased = ['buy', 'purchase', 'shop', 'gift', 'legacy', 'market'].some((token) => source.includes(token));
      if (!purchased) {
        const quantity = Math.max(1, Math.floor(payload.quantity));
        mutateLifeExtras(this.ctx.state, (extras) => {
          extras.counters.cakesBaked += quantity;
        });
      }
    }
    this.checkAll();
  }

  private onGameSignal(name: string): void {
    if (name === 'skill:levelup') this.checkAll();
  }
}
