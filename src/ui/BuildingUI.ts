// =============================================================================
// Building panel: blueprints with real material requirements and live projects.
// =============================================================================
import type { GameState } from '../core/contracts';
import type { BlueprintDef } from '../data/schema';
import {
  h,
  span,
  button,
  badge,
  bar,
  empty,
  section,
  tabs,
  statTile,
  PanelBase,
  type UiContext,
} from './widgets';
import { countItem, formatDurationClock, formatPercent01, itemIcon, qualityColor } from './model';

type BuildTab = 'projects' | 'blueprints' | 'completed';

export class BuildingPanel extends PanelBase {
  private tab: BuildTab = 'projects';

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
  }

  protected signature(state: Readonly<GameState>): string {
    return this.sig(
      this.tab,
      state.building.projects.map((project) => [project.id, project.status, Math.round(project.progress * 100), project.completesAt]),
      state.building.completedProjects.length,
      state.player.inventory.map((entry) => [entry.itemId, entry.quantity]),
      state.player.skills,
      state.player.position.locationId,
      Math.floor(state.clock.simTimeSeconds / 30)
    );
  }

  protected render(): void {
    this.element.replaceChildren();
    const active = this.state.building.projects.filter((project) => project.status === 'building');
    this.element.appendChild(
      tabs(
        [
          { id: 'projects', label: 'Projects', count: active.length, icon: '🏗' },
          { id: 'blueprints', label: 'Blueprints', icon: '📐' },
          { id: 'completed', label: 'Completed', count: this.state.building.completedProjects.length, icon: '✅' },
        ],
        this.tab,
        (id) => {
          this.tab = id as BuildTab;
          this.rerender();
        }
      )
    );
    if (this.tab === 'projects') this.renderProjects();
    else if (this.tab === 'blueprints') this.renderBlueprints();
    else this.renderCompleted();
  }

  private hint(): string {
    return 'You build where you stand. Home upgrades only at your own home.';
  }

  private renderProjects(): void {
    const projects = this.state.building.projects.filter((project) => project.status === 'building');
    const active = section('Under construction', projects.length + ' active');
    active.body.appendChild(h('div', 'ui-card-text', this.hint()));
    if (projects.length === 0) active.body.appendChild(empty('Nothing is being built right now. Check the blueprints tab.'));
    for (const project of projects) {
      const blueprint = this.ctx.content.getBlueprint(project.blueprintId);
      const card = h('div', 'ui-card');
      const title = h('div', 'ui-card-title', (blueprint?.visual ? '' : '') + (blueprint?.name ?? project.blueprintId));
      card.appendChild(title);
      const locationName = this.ctx.content.getLocation(project.locationId)?.name ?? project.locationId;
      card.appendChild(h('div', 'ui-card-sub', locationName + ' · started ' + formatDurationClock(Math.max(0, this.state.clock.simTimeSeconds - project.startedAt)) + ' ago'));
      card.appendChild(bar(project.progress, 1, 'accent'));
      const remaining = Math.max(0, project.completesAt - this.state.clock.simTimeSeconds);
      card.appendChild(
        h('div', 'ui-card-sub', formatPercent01(project.progress) + ' complete · ' + formatDurationClock(remaining) + ' remaining')
      );
      card.appendChild(
        button('Cancel build', () => {
          this.ctx.dispatch({ type: 'build:cancel', projectId: project.id });
          this.refresh();
        }, { className: 'ui-button-small ui-button-danger' })
      );
      active.body.appendChild(card);
    }
    this.element.appendChild(active.element);
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Completed', String(this.state.building.completedProjects.length)),
      statTile('In progress', String(projects.length)),
      statTile('Known blueprints', String(this.state.building.unlockedBlueprints.length)),
      statTile('Crafting level', 'Lv ' + (this.state.player.skills.crafting?.level ?? 1))
    );
    const statsSection = section('Building site');
    statsSection.body.appendChild(stats);
    this.element.appendChild(statsSection.element);
  }

  private renderBlueprints(): void {
    let available: BlueprintDef[] = [];
    try {
      available = this.ctx.api.getSystems().building.getAvailableBlueprints();
    } catch {
      available = [];
    }
    const availableIds = new Set(available.map((blueprint) => blueprint.id));
    const all = this.ctx.content.pack.blueprints;
    const eligible = section('Ready to build', available.length + ' blueprints');
    eligible.body.appendChild(h('div', 'ui-card-text', 'Click a blueprint to see material availability, then start the project.'));
    for (const blueprint of available) {
      eligible.body.appendChild(this.blueprintCard(blueprint, true));
    }
    if (available.length === 0) eligible.body.appendChild(empty('No blueprints are available for your skill levels yet.'));
    this.element.appendChild(eligible.element);

    const locked = all.filter((blueprint) => !availableIds.has(blueprint.id));
    if (locked.length > 0) {
      const lockedSection = section('Still locked', locked.length + ' blueprints');
      for (const blueprint of locked) lockedSection.body.appendChild(this.blueprintCard(blueprint, false));
      this.element.appendChild(lockedSection.element);
    }
  }

  private blueprintCard(blueprint: BlueprintDef, eligible: boolean): HTMLElement {
    const card = h('div', 'ui-card');
    const head = h('div', 'ui-card-title');
    head.append(document.createTextNode(blueprint.name + ' '));
    head.appendChild(badge(blueprint.kind.replaceAll('_', ' '), 'neutral'));
    head.appendChild(badge(blueprint.skill + ' Lv ' + blueprint.levelReq, (this.state.player.skills[blueprint.skill]?.level ?? 1) >= blueprint.levelReq ? 'ok' : 'bad'));
    card.appendChild(head);
    card.appendChild(h('div', 'ui-card-sub', blueprint.buildHours + ' game hours · ' + (blueprint.effects.join(', ') || 'no listed effects')));
    card.appendChild(h('div', 'ui-card-text', blueprint.description));
    const inputs = h('div', 'ui-inline');
    let materialsOk = true;
    for (const input of blueprint.inputs) {
      const have = countItem(this.state.player.inventory, input.itemId);
      const ok = have >= input.quantity;
      if (!ok) materialsOk = false;
      const item = this.ctx.content.getItem(input.itemId);
      const chip = span('ui-ingredient ' + (ok ? 'have' : 'missing'), (item ? itemIcon(item) + ' ' : '') + (item?.name ?? input.itemId) + ' ' + have + '/' + input.quantity);
      inputs.appendChild(chip);
    }
    card.appendChild(inputs);
    const levelOk = (this.state.player.skills[blueprint.skill]?.level ?? 1) >= blueprint.levelReq;
    const canStart = eligible && levelOk && materialsOk;
    const reason = !eligible
      ? 'Requires ' + blueprint.skill + ' level ' + blueprint.levelReq
      : !materialsOk
        ? 'Missing materials'
        : !levelOk
          ? 'Skill too low'
          : 'Start building here';
    card.appendChild(
      button('Start project', () => {
        this.ctx.dispatch({ type: 'build:start', blueprintId: blueprint.id, locationId: this.state.player.position.locationId });
        this.refresh();
      }, { className: 'ui-button-small', disabled: !canStart, tooltip: reason })
    );
    return card;
  }

  private renderCompleted(): void {
    const completed = this.state.building.completedProjects;
    const sectionEl = section('Finished work', completed.length + ' projects');
    if (completed.length === 0) sectionEl.body.appendChild(empty('Nothing finished yet.'));
    for (const blueprintId of [...completed].reverse()) {
      const blueprint = this.ctx.content.getBlueprint(blueprintId);
      const line = h('div', 'ui-row');
      line.appendChild(span('ui-row-label', blueprint?.name ?? blueprintId));
      line.appendChild(span('ui-row-value', blueprint?.kind.replaceAll('_', ' ') ?? ''));
      line.appendChild(span('ui-row-hint', blueprint?.effects.join(', ') ?? ''));
      sectionEl.body.appendChild(line);
    }
    this.element.appendChild(sectionEl.element);
    const projects = this.state.building.projects.filter((project) => project.status === 'complete');
    if (projects.length > 0) {
      const archive = section('Build log');
      for (const project of [...projects].reverse().slice(0, 15)) {
        const blueprint = this.ctx.content.getBlueprint(project.blueprintId);
        archive.body.appendChild(
          h(
            'div',
            'ui-list-item',
            (blueprint?.name ?? project.blueprintId) +
              ' at ' +
              (this.ctx.content.getLocation(project.locationId)?.name ?? project.locationId) +
              ' · ' +
              formatDurationClock(Math.max(0, project.completesAt - project.startedAt)) +
              ' of work'
          )
        );
      }
      this.element.appendChild(archive.element);
    }
    void qualityColor;
  }
}
