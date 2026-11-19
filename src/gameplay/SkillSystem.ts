import type { IGameContext, ISkillSystem, SkillProgressState } from '../core/contracts';
import type { JsonValue, SkillId } from '../core/SharedTypes';
import { SKILL_IDS } from '../core/SharedTypes';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { clamp } from '../core/utils';

/**
 * SkillSystem (id 'skill') - the eight life skills.
 *
 * XP curve (WORLD_CONFIG.skill):
 *   xpToNext(currentLevel) = round(baseXpToLevel * xpGrowth ^ (currentLevel - 1))
 *   level 1 needs 60 XP, level 2 needs round(60 * 1.18) = 71, level 3 needs 84, ...
 *   max level 20: xpToNext is 0 and further XP is still recorded in totalXp but no
 *   level-ups happen.
 *
 * Every XP gain is multiplied by the player's active status-effect skillXpMultiplier
 * (food buffs from CookingSystem, meditation events, ...). Multipliers multiply and are
 * clamped to [0.25, 4] so a chain of buffs can never break the curve.
 *
 * This system owns no tick logic: skills only grow through real actions (crafting,
 * cooking, fishing, gardening, ...) that call addXp().
 */
const MIN_SKILL_XP_MULTIPLIER = 0.25;
const MAX_SKILL_XP_MULTIPLIER = 4;

export class SkillSystem implements ISkillSystem {
  readonly id = 'skill';

  private ctx: IGameContext | null = null;
  /** Cached xpToNext per level, index = level (1..maxLevel). */
  private readonly xpTable: number[] = [];

  constructor() {
    this.buildXpTable();
  }

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.ensureAllSkills();
  }

  update(_dtSimSeconds: number): void {
    // Skills grow from actions, never from time passing.
  }

  // -------------------------------------------------------------------------
  // ISkillSystem
  // -------------------------------------------------------------------------
  addXp(skill: SkillId, amount: number, source: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!SKILL_IDS.includes(skill)) return;
    if (!Number.isFinite(amount) || amount <= 0) return;

    const progress = this.ensureSkill(skill);
    const multiplier = this.getXpMultiplier();
    const gained = Math.max(1, Math.round(amount * WORLD_CONFIG.skill.xpActivityMultiplier * multiplier));

    progress.totalXp += gained;
    progress.uses += 1;
    progress.xp += gained;

    const maxLevel = WORLD_CONFIG.skill.maxLevel;
    let levelled = false;
    while (progress.level < maxLevel && progress.xp >= progress.xpToNext) {
      progress.xp -= progress.xpToNext;
      progress.level += 1;
      progress.xpToNext = this.xpToNext(progress.level);
      levelled = true;
      const data: JsonValue = { skill, level: progress.level, source };
      ctx.bus.emit('game:signal', { name: 'skill:levelup', data });
    }
    if (progress.level >= maxLevel) {
      // Maxed out: no further thresholds; keep a clean bar for the UI.
      progress.xpToNext = 0;
      if (progress.xp > 0) progress.xp = 0;
    } else if (levelled && progress.xpToNext === 0) {
      progress.xpToNext = this.xpToNext(progress.level);
    }
  }

  getProgress(skill: SkillId): SkillProgressState {
    const progress = this.ensureSkill(skill);
    return { ...progress };
  }

  getLevel(skill: SkillId): number {
    return this.ensureSkill(skill).level;
  }

  canUse(skill: SkillId, level: number): boolean {
    if (level <= 0) return true;
    return this.getLevel(skill) >= level;
  }

  // -------------------------------------------------------------------------
  // Extra public helpers (UI + other systems)
  // -------------------------------------------------------------------------
  /** Current stacked XP multiplier from status effects. */
  getXpMultiplier(): number {
    const ctx = this.ctx;
    if (!ctx) return 1;
    let multiplier = 1;
    for (const effect of ctx.state.player.statusEffects) {
      if (typeof effect.skillXpMultiplier !== 'number') continue;
      if (!Number.isFinite(effect.skillXpMultiplier)) continue;
      multiplier *= effect.skillXpMultiplier;
    }
    return clamp(multiplier, MIN_SKILL_XP_MULTIPLIER, MAX_SKILL_XP_MULTIPLIER);
  }

  /** XP required to go from `level` to `level + 1` (0 at max level). */
  xpToNext(level: number): number {
    const maxLevel = WORLD_CONFIG.skill.maxLevel;
    if (level >= maxLevel) return 0;
    const tableValue = this.xpTable[level];
    if (typeof tableValue === 'number') return tableValue;
    return this.computeXpToNext(level);
  }

  /** Fraction 0..1 of progress towards the next level (1 at max level). */
  getProgressRatio(skill: SkillId): number {
    const progress = this.ensureSkill(skill);
    if (progress.xpToNext <= 0) return 1;
    return clamp(progress.xp / progress.xpToNext, 0, 1);
  }

  /** Sum of all skill levels - used by achievements / life archive. */
  getTotalLevels(): number {
    let total = 0;
    for (const skill of SKILL_IDS) total += this.ensureSkill(skill).level;
    return total;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  private buildXpTable(): void {
    const maxLevel = WORLD_CONFIG.skill.maxLevel;
    for (let level = 1; level <= maxLevel; level += 1) {
      this.xpTable[level] = this.computeXpToNext(level);
    }
  }

  private computeXpToNext(level: number): number {
    const maxLevel = WORLD_CONFIG.skill.maxLevel;
    if (level >= maxLevel) return 0;
    const xp = WORLD_CONFIG.skill.baseXpToLevel * Math.pow(WORLD_CONFIG.skill.xpGrowth, Math.max(0, level - 1));
    return Math.max(1, Math.round(xp));
  }

  private ensureAllSkills(): void {
    for (const skill of SKILL_IDS) this.ensureSkill(skill);
  }

  private ensureSkill(skill: SkillId): SkillProgressState {
    const ctx = this.ctx;
    if (!ctx) {
      // Defensive fallback so getProgress() is always callable (e.g. before init in UI tests).
      return { level: 1, xp: 0, xpToNext: this.computeXpToNext(1), totalXp: 0, uses: 0 };
    }
    const skills = ctx.state.player.skills;
    const existing = skills[skill];
    if (existing) return existing;
    const created: SkillProgressState = {
      level: 1,
      xp: 0,
      xpToNext: this.computeXpToNext(1),
      totalXp: 0,
      uses: 0,
    };
    skills[skill] = created;
    return created;
  }
}
