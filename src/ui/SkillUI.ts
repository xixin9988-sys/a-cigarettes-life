// =============================================================================
// Skills, personal goals and achievements.
// =============================================================================
import type { GameState } from '../core/contracts';
import { SKILL_IDS, SKILL_DISPLAY_NAMES, type SkillId } from '../core/SharedTypes';
import { formatMoney } from '../core/format';
import {
  skillSummaryLines,
  totalSkillLevels,
  xpToNextForLevel,
  formatPercent01,
} from './model';
import {
  h,
  span,
  button,
  badge,
  bar,
  empty,
  section,
  tabs,
  labelledBar,
  statTile,
  PanelBase,
  skillExtras,
  lifeExtras,
  type UiContext,
} from './widgets';

type SkillTab = 'skills' | 'goals' | 'achievements';

export class SkillPanel extends PanelBase {
  private tab: SkillTab = 'skills';

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
  }

  protected signature(state: Readonly<GameState>): string {
    const goal = this.safeGoal();
    return this.sig(
      this.tab,
      state.player.skills,
      state.life.achievements.map((achievement) => achievement.id),
      goal ? [goal.id, goal.progress, goal.target, goal.completedAt] : null,
      state.player.influence
    );
  }

  private safeGoal(): { id: string; progress: number; target: number; completedAt: number | null } | null {
    try {
      return lifeExtras(this.ctx.api).getPersonalGoal();
    } catch {
      return null;
    }
  }

  protected render(): void {
    this.element.replaceChildren();
    this.element.appendChild(
      tabs(
        [
          { id: 'skills', label: 'Skills', icon: '📊' },
          { id: 'goals', label: 'Goals', icon: '🎯' },
          { id: 'achievements', label: 'Achievements', icon: '🏆' },
        ],
        this.tab,
        (id) => {
          this.tab = id as SkillTab;
          this.rerender();
        }
      )
    );
    if (this.tab === 'skills') this.renderSkills();
    else if (this.tab === 'goals') this.renderGoals();
    else this.renderAchievements();
  }

  private renderSkills(): void {
    const state = this.state;
    const lines = skillSummaryLines(state);
    let total = 0;
    for (const line of lines) total += line.level;
    const summary = section('Skill sheet');
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Total levels', String(total), 'max ' + SKILL_IDS.length * 20),
      statTile('Influence', String(Math.round(state.player.influence))),
      statTile('Multiplier', '×' + this.skillMultiplier().toFixed(2), 'from buffs'),
      statTile('Uses tracked', String(lines.reduce((sum, _line, index) => sum + (state.player.skills[SKILL_IDS[index] ?? 'social']?.uses ?? 0), 0)))
    );
    summary.body.appendChild(stats);
    this.element.appendChild(summary.element);

    const list = section('The eight skills', 'XP grows with each action');
    for (const skill of SKILL_IDS) {
      const progress = state.player.skills[skill];
      const level = progress?.level ?? 1;
      const xp = progress?.xp ?? 0;
      const toNext = progress && progress.xpToNext > 0 ? progress.xpToNext : xpToNextForLevel(level);
      const row = h('div', 'ui-skill-row');
      row.appendChild(span('ui-skill-name', SKILL_DISPLAY_NAMES[skill]));
      row.appendChild(span('ui-skill-level', 'Lv ' + level));
      row.appendChild(bar(xp, Math.max(1, toNext), level >= 20 ? 'accent' : 'default'));
      row.appendChild(span('ui-skill-meta', level >= 20 ? 'MAX' : xp + '/' + toNext));
      list.body.appendChild(row);
      if (state.player.statusEffects.some((effect) => effect.skillXpMultiplier !== undefined)) {
        const effect = state.player.statusEffects.find((candidate) => candidate.skillXpMultiplier !== undefined);
        if (effect) {
          row.title = 'XP buff: ' + effect.label;
        }
      }
    }
    this.element.appendChild(list.element);
    const note = section('How skills grow');
    note.body.appendChild(
      h(
        'div',
        'ui-card-text',
        'Every action feeds one skill: crops feed Gardening, rods feed Fishing, conversations feed Socialising. ' +
          'Higher levels unlock recipes, better prices and rarer finds. Books and food can boost the rate.'
      )
    );
    this.element.appendChild(note.element);
  }

  private skillMultiplier(): number {
    try {
      return skillExtras(this.ctx.api).getXpMultiplier();
    } catch {
      return 1;
    }
  }

  private renderGoals(): void {
    const state = this.state;
    let available: { id: string; title: string; description: string; category: string; rewardInfluence: number; icon: string }[] = [];
    try {
      available = this.ctx.api.getSystems().life.getAvailableGoals();
    } catch {
      available = [];
    }
    const current = this.safeGoal();
    const currentDef = current ? this.ctx.content.getPlayerGoal(current.id) : undefined;
    const currentSection = section('Your goal');
    if (!current || !currentDef) {
      currentSection.body.appendChild(
        h('div', 'ui-card-text', 'You have not chosen a personal goal yet. Pick one below; progress follows your real actions.')
      );
    } else {
      const card = h('div', 'ui-card ui-goal-card' + (current.completedAt === null ? '' : ' complete'));
      card.appendChild(h('div', 'ui-card-title', currentDef.icon + ' ' + currentDef.title));
      card.appendChild(h('div', 'ui-card-sub', currentDef.category + ' · reward ' + currentDef.rewardInfluence + ' influence'));
      card.appendChild(h('div', 'ui-card-text', currentDef.description));
      card.appendChild(labelledBar('Progress', current.progress, Math.max(1, current.target), current.progress + ' / ' + current.target));
      if (current.completedAt !== null) card.appendChild(badge('completed', 'ok'));
      currentSection.body.appendChild(card);
    }
    this.element.appendChild(currentSection.element);

    const choices = section('Available goals', available.length + ' offers');
    if (available.length === 0) choices.body.appendChild(empty('No new goals are offered right now.'));
    for (const goal of available) {
      const card = h('div', 'ui-card');
      card.appendChild(h('div', 'ui-card-title', goal.icon + ' ' + goal.title));
      card.appendChild(h('div', 'ui-card-sub', goal.category + ' · ' + goal.rewardInfluence + ' influence'));
      card.appendChild(h('div', 'ui-card-text', goal.description));
      if (current?.id === goal.id) card.appendChild(badge('current goal', 'accent'));
      else {
        card.appendChild(
          button('Choose this goal', () => {
            this.ctx.dispatch({ type: 'life:set-goal', goalId: goal.id });
            this.refresh();
          }, { className: 'ui-button-small' })
        );
      }
      choices.body.appendChild(card);
    }
    this.element.appendChild(choices.element);
    const note = section('Goals and progress');
    note.body.appendChild(
      h(
        'div',
        'ui-card-text',
        'Goals swap freely; only one personal goal is tracked at a time. Completed goals are recorded in the life archive and grant influence. ' +
          'Wealth goal? ' + formatMoney(state.player.statistics.moneyEarned) + ' has passed through your hands so far.'
      )
    );
    this.element.appendChild(note.element);
  }

  private renderAchievements(): void {
    const state = this.state;
    let all: { def: { id: string; title: string; description: string; hidden: boolean; icon: string; rewardInfluence: number }; state: { id: string; unlockedAt: number } | null }[] = [];
    try {
      all = this.ctx.api.getSystems().life.getAchievements();
    } catch {
      all = [];
    }
    const unlocked = all.filter((entry) => entry.state !== null);
    const summary = section('Achievements', unlocked.length + ' / ' + all.length + ' unlocked');
    summary.body.appendChild(
      labelledBar('Progress', unlocked.length, Math.max(1, all.length), unlocked.length + ' / ' + all.length, 'accent')
    );
    this.element.appendChild(summary.element);
    const grid = h('div', 'ui-achievement-grid');
    for (const entry of all) {
      const isUnlocked = entry.state !== null;
      const hidden = entry.def.hidden && !isUnlocked;
      const card = h('div', 'ui-achievement' + (isUnlocked ? ' unlocked' : ''));
      card.appendChild(h('div', 'ach-icon', hidden ? '❓' : entry.def.icon || '🏆'));
      const body = h('div', '');
      body.appendChild(h('div', 'ui-card-title', hidden ? 'Hidden achievement' : entry.def.title));
      body.appendChild(
        h('div', 'ui-card-text', hidden ? 'Keep living; some things are only learned by doing them.' : entry.def.description)
      );
      if (isUnlocked && entry.state) {
        body.appendChild(h('div', 'ui-card-sub', 'unlocked generation ' + state.life.generation));
      } else if (!hidden) {
        body.appendChild(h('div', 'ui-card-sub', 'reward ' + entry.def.rewardInfluence + ' influence'));
      }
      card.appendChild(body);
      grid.appendChild(card);
    }
    if (all.length === 0) grid.appendChild(empty('No achievements are defined.'));
    this.element.appendChild(grid);
    void formatPercent01;
    void totalSkillLevels;
    void (SKILL_IDS as readonly SkillId[]);
  }
}
