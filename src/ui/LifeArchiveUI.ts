// =============================================================================
// Life archive panel: this life's timeline, achievements, past lives and photos.
// =============================================================================
import type { ArchivedLife, GameState } from '../core/contracts';
import { formatMoney, qualityStars } from '../core/format';
import {
  groupLifeArchive,
  lifeArchiveIcon,
  LIFE_ARCHIVE_LABELS,
  gameTimeText,
  locationName,
  totalSkillLevels,
} from './model';
import {
  h,
  span,
  button,
  badge,
  empty,
  section,
  tabs,
  statTile,
  PanelBase,
  type UiContext,
} from './widgets';

type ArchiveTab = 'current' | 'past' | 'photos';

export class LifeArchivePanel extends PanelBase {
  private tab: ArchiveTab = 'current';
  private categoryFilter = 'all';

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
  }

  protected signature(state: Readonly<GameState>): string {
    return this.sig(
      this.tab,
      this.categoryFilter,
      state.life.archive.map((entry) => entry.id),
      state.life.achievements.map((achievement) => achievement.id),
      state.life.legacyItemIds,
      state.life.letters.length,
      state.archive.length,
      state.player.skills,
      state.player.statistics.fishCaught
    );
  }

  protected render(): void {
    this.element.replaceChildren();
    const archive = this.pastLives();
    this.element.appendChild(
      tabs(
        [
          { id: 'current', label: 'This life', count: this.state.life.archive.length, icon: '🕯' },
          { id: 'past', label: 'Past lives', count: archive.length, icon: '📚' },
          { id: 'photos', label: 'Photos', icon: '📷' },
        ],
        this.tab,
        (id) => {
          this.tab = id as ArchiveTab;
          this.rerender();
        }
      )
    );
    if (this.tab === 'current') this.renderCurrent();
    else if (this.tab === 'past') this.renderPast(archive);
    else this.renderPhotos();
  }

  private pastLives(): ArchivedLife[] {
    try {
      return this.ctx.api.getLifeArchive();
    } catch {
      return [];
    }
  }

  private renderCurrent(): void {
    const state = this.state;
    const summary = section('The life of ' + state.player.name, 'generation ' + state.life.generation);
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Days lived', state.life.ageDays.toFixed(1)),
      statTile('Cigarette left', (state.player.cigarette.lengthRatio * 100).toFixed(1) + '%'),
      statTile('Influence', String(Math.round(state.player.influence))),
      statTile('Money', formatMoney(state.player.money)),
      statTile('Total skill levels', String(totalSkillLevels(state.player.skills))),
      statTile('Achievements', String(state.life.achievements.length)),
      statTile('Letters', String(state.life.letters.length)),
      statTile('Legacy mementos', String(state.life.legacyItemIds.length))
    );
    summary.body.appendChild(stats);
    this.element.appendChild(summary.element);

    const entries = [...state.life.archive].reverse();
    const categories = [...new Set(entries.map((entry) => entry.category))];
    const filterRow = h('div', 'ui-filter-row');
    filterRow.appendChild(
      button('All (' + entries.length + ')', () => {
        this.categoryFilter = 'all';
        this.rerender();
      }, { className: 'ui-filter-chip' + (this.categoryFilter === 'all' ? ' active' : '') })
    );
    for (const category of categories) {
      filterRow.appendChild(
        button((LIFE_ARCHIVE_LABELS[category] ?? category) + ' (' + entries.filter((entry) => entry.category === category).length + ')', () => {
          this.categoryFilter = category;
          this.rerender();
        }, { className: 'ui-filter-chip' + (this.categoryFilter === category ? ' active' : '') })
      );
    }
    this.element.appendChild(filterRow);

    const filtered = entries.filter((entry) => this.categoryFilter === 'all' || entry.category === this.categoryFilter);
    const timelineSection = section('Life timeline', filtered.length + ' moments');
    const timeline = h('div', 'ui-timeline');
    for (const entry of filtered.slice(0, 80)) {
      const row = h('div', 'ui-timeline-entry' + (entry.importance >= 3 ? ' important' : ''));
      row.appendChild(h('div', 'ui-timeline-title', lifeArchiveIcon(entry.category) + ' ' + entry.title));
      row.appendChild(h('div', 'ui-timeline-desc', entry.description));
      const meta = h('div', 'ui-timeline-meta');
      meta.appendChild(span('', gameTimeText(entry.at)));
      if (entry.locationId) meta.appendChild(span('', locationName(this.ctx.content, entry.locationId)));
      if (entry.participantIds.length > 0) {
        meta.appendChild(span('', entry.participantIds.map((id) => this.state.npcs[id]?.name ?? id).join(', ')));
      }
      row.appendChild(meta);
      timeline.appendChild(row);
    }
    if (filtered.length === 0) timeline.appendChild(empty('Nothing recorded in this category yet.'));
    timelineSection.body.appendChild(timeline);
    this.element.appendChild(timelineSection.element);

    this.element.appendChild(this.renderAchievements());
    if (state.life.legacyItemIds.length > 0) {
      const legacy = section('Mementos carried in', String(state.life.legacyItemIds.length));
      for (const itemId of state.life.legacyItemIds) {
        legacy.body.appendChild(h('div', 'ui-list-item', this.ctx.content.resolveItemName(itemId)));
      }
      this.element.appendChild(legacy.element);
    }
  }

  private renderAchievements(): HTMLElement {
    const entries = section('Achievements', this.state.life.achievements.length + ' unlocked');
    let all: { def: { id: string; title: string; description: string; hidden: boolean; icon: string }; state: { id: string } | null }[] = [];
    try {
      all = this.ctx.api.getSystems().life.getAchievements();
    } catch {
      all = [];
    }
    if (all.length === 0) {
      entries.body.appendChild(empty('No achievements defined.'));
      return entries.element;
    }
    const grid = h('div', 'ui-achievement-grid');
    for (const entry of all) {
      const hidden = entry.def.hidden && entry.state === null;
      const card = h('div', 'ui-achievement' + (entry.state !== null ? ' unlocked' : ''));
      card.appendChild(h('div', 'ach-icon', hidden ? '❓' : entry.def.icon || '🏆'));
      const body = h('div', '');
      body.appendChild(h('div', 'ui-card-title', hidden ? 'Hidden' : entry.def.title));
      body.appendChild(h('div', 'ui-card-text', hidden ? 'Only discovered by living.' : entry.def.description));
      card.appendChild(body);
      grid.appendChild(card);
    }
    entries.body.appendChild(grid);
    return entries.element;
  }

  private renderPast(lives: ArchivedLife[]): void {
    const intro = section('Past lives', lives.length + ' archived');
    intro.body.appendChild(
      h('div', 'ui-card-text', 'Each generation is a separate cigarette. The world persists; the person does not. Open a review to relight the next one.')
    );
    this.element.appendChild(intro.element);
    if (lives.length === 0) {
      this.element.appendChild(empty('No past lives yet. Every cigarette burns once.'));
      return;
    }
    for (const life of [...lives].reverse()) {
      const card = h('div', 'ui-card ui-archive-card');
      const head = h('div', 'ui-card-title');
      head.append(document.createTextNode('🕯 ' + life.name + ' '));
      head.appendChild(badge('generation ' + life.generation, 'accent'));
      head.appendChild(badge(life.durationDays.toFixed(1) + ' days', 'neutral'));
      card.appendChild(head);
      card.appendChild(h('div', 'ui-card-sub', 'ended: ' + life.endReason + ' · home ' + life.residenceName + ' · occupation ' + (life.occupation ?? 'none')));
      card.appendChild(
        h('div', 'ui-card-sub', 'money left ' + formatMoney(life.finalMoney) + ' · skills ' + totalSkillLevels(life.skills) + ' · ' + life.importantPeople.length + ' important people · ' + life.collections.length + ' collected species')
      );
      if (life.importantPeople.length > 0) {
        const people = h('div', 'ui-inline');
        for (const person of life.importantPeople.slice(0, 5)) {
          people.appendChild(badge(person.name + ' (' + person.status.replaceAll('_', ' ') + ')', 'neutral'));
        }
        card.appendChild(people);
      }
      if (life.worldChanges.length > 0) {
        const changes = h('div', 'ui-stack');
        for (const change of life.worldChanges.slice(0, 4)) changes.appendChild(h('div', 'ui-list-item', change));
        card.appendChild(changes);
      }
      const actions = h('div', 'ui-card-actions');
      actions.appendChild(
        button('View life review', () => {
          this.ctx.showLifeReview(life);
        }, { className: 'ui-button-small ui-button-primary' })
      );
      card.appendChild(actions);
      this.element.appendChild(card);
    }
  }

  private renderPhotos(): void {
    let photos: { id: string; title: string; description: string; takenAt: number; locationId: string; kind: string; subjects: string[] }[] = [];
    try {
      photos = this.ctx.api.getSystems().exploration.getPhotos();
    } catch {
      photos = [];
    }
    const intro = section('Photographs', photos.length + ' taken');
    intro.body.appendChild(
      h('div', 'ui-card-text', 'Photos are real records of the world. They last longer than the cigarette that took them.')
    );
    this.element.appendChild(intro.element);
    const grid = h('div', 'ui-photo-grid');
    for (const photo of [...photos].reverse().slice(0, 24)) {
      const cell = h('div', 'ui-photo');
      cell.appendChild(h('div', 'ui-photo-title', '📷 ' + photo.title));
      cell.appendChild(h('div', '', photo.description));
      cell.appendChild(h('div', '', locationName(this.ctx.content, photo.locationId) + ' · ' + gameTimeText(photo.takenAt)));
      grid.appendChild(cell);
    }
    if (photos.length === 0) {
      const emptyCell = h('div', 'ui-photo');
      emptyCell.appendChild(h('div', 'ui-photo-title', 'No photos yet'));
      emptyCell.appendChild(h('div', '', 'Use "Take a photo" from the map panel where you stand.'));
      grid.appendChild(emptyCell);
    }
    this.element.appendChild(grid);
    const letters = section('Letters kept', String(this.state.life.letters.length));
    for (const letter of [...this.state.life.letters].reverse().slice(0, 6)) {
      const line = h('div', 'ui-furniture-row');
      line.appendChild(span('ui-grow', (letter.read ? '✉ ' : '● ') + letter.subject + ' · ' + gameTimeText(letter.sentAt)));
      if (!letter.read) {
        line.appendChild(
          button('Read', () => {
            this.ctx.dispatch({ type: 'life:read-letter', letterId: letter.id });
            this.refresh();
          }, { className: 'ui-button-small' })
        );
      }
      letters.body.appendChild(line);
    }
    if (this.state.life.letters.length === 0) letters.body.appendChild(empty('No letters kept.'));
    this.element.appendChild(letters.element);
    void qualityStars;
    void groupLifeArchive;
  }
}
