// =============================================================================
// Journal panel: world history, life archive, letters and the last offline summary.
// =============================================================================
import type { GameState } from '../core/contracts';
import { formatMoney } from '../core/format';
import {
  gameTimeText,
  groupLifeArchive,
  lifeArchiveIcon,
  LIFE_ARCHIVE_LABELS,
  groupOfflineChanges,
  offlineChangeIcon,
  locationName,
  eventImportanceLabel,
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

type JournalTab = 'history' | 'life' | 'letters' | 'offline';

export class JournalPanel extends PanelBase {
  private tab: JournalTab = 'history';
  private historyFilter = 'all';
  private lifeFilter = 'all';

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
  }

  protected signature(state: Readonly<GameState>): string {
    return this.sig(
      this.tab,
      this.historyFilter,
      this.lifeFilter,
      state.world.history.length,
      state.world.history.slice(-4).map((entry) => entry.id),
      state.life.archive.map((entry) => entry.id),
      state.life.letters.map((letter) => [letter.id, letter.read]),
      state.pendingOffline.pendingSummary ? 1 : 0
    );
  }

  protected render(): void {
    this.element.replaceChildren();
    const unreadLetters = this.state.life.letters.filter((letter) => !letter.read).length;
    this.element.appendChild(
      tabs(
        [
          { id: 'history', label: 'World', icon: '🌍' },
          { id: 'life', label: 'This life', count: this.state.life.archive.length, icon: '🕯' },
          { id: 'letters', label: 'Letters', count: unreadLetters, icon: '✉' },
          { id: 'offline', label: 'Offline', icon: '⏳' },
        ],
        this.tab,
        (id) => {
          this.tab = id as JournalTab;
          this.rerender();
        }
      )
    );
    if (this.tab === 'history') this.renderHistory();
    else if (this.tab === 'life') this.renderLifeArchive();
    else if (this.tab === 'letters') this.renderLetters();
    else this.renderOffline();
  }

  private renderHistory(): void {
    const all = [...this.state.world.history].reverse();
    const categories = [...new Set(all.map((entry) => entry.category))];
    const nav = h('div', 'ui-tabs');
    nav.appendChild(
      button('All (' + all.length + ')', () => {
        this.historyFilter = 'all';
        this.rerender();
      }, { className: 'ui-tab' + (this.historyFilter === 'all' ? ' ui-tab-active' : '') })
    );
    for (const category of categories) {
      nav.appendChild(
        button(category, () => {
          this.historyFilter = category;
          this.rerender();
        }, { className: 'ui-tab' + (this.historyFilter === category ? ' ui-tab-active' : '') })
      );
    }
    this.element.appendChild(nav);
    const filtered = all.filter((entry) => this.historyFilter === 'all' || entry.category === this.historyFilter);
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Entries', String(all.length)),
      statTile('Important', String(all.filter((entry) => entry.importance >= 3).length)),
      statTile('Day', String(Math.floor(this.state.clock.simTimeSeconds / 86400))),
      statTile('Events logged', String(this.state.world.events.length))
    );
    const history = section('The world keeps notes', filtered.length + ' entries');
    history.body.appendChild(stats);
    const timeline = h('div', 'ui-timeline');
    for (const entry of filtered.slice(0, 80)) {
      const row = h('div', 'ui-timeline-entry' + (entry.importance >= 3 ? ' important' : ''));
      row.appendChild(h('div', 'ui-timeline-title', entry.description));
      const meta = h('div', 'ui-timeline-meta');
      meta.append(
        span('', gameTimeText(entry.at)),
        span('', entry.category),
        span('', eventImportanceLabel(entry.importance))
      );
      if (entry.locationId) meta.appendChild(span('', locationName(this.ctx.content, entry.locationId)));
      row.appendChild(meta);
      timeline.appendChild(row);
    }
    if (filtered.length === 0) timeline.appendChild(empty('Nothing in this category yet.'));
    history.body.appendChild(timeline);
    this.element.appendChild(history.element);
  }

  private renderLifeArchive(): void {
    const entries = [...this.state.life.archive].reverse();
    const categories = [...new Set(entries.map((entry) => entry.category))];
    const nav = h('div', 'ui-tabs');
    nav.appendChild(
      button('All (' + entries.length + ')', () => {
        this.lifeFilter = 'all';
        this.rerender();
      }, { className: 'ui-tab' + (this.lifeFilter === 'all' ? ' ui-tab-active' : '') })
    );
    for (const category of categories) {
      nav.appendChild(
        button((LIFE_ARCHIVE_LABELS[category] ?? category) + ' (' + entries.filter((entry) => entry.category === category).length + ')', () => {
          this.lifeFilter = category;
          this.rerender();
        }, { className: 'ui-tab' + (this.lifeFilter === category ? ' ui-tab-active' : '') })
      );
    }
    this.element.appendChild(nav);
    const filtered = entries.filter((entry) => this.lifeFilter === 'all' || entry.category === this.lifeFilter);
    const summary = section('This life so far', this.state.life.ageDays.toFixed(1) + ' days lived');
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Generation', String(this.state.life.generation)),
      statTile('Entries', String(entries.length)),
      statTile('Photos', String(this.state.life.archive.filter((entry) => entry.photoId).length)),
      statTile('Legacy mementos', String(this.state.life.legacyItemIds.length))
    );
    summary.body.appendChild(stats);
    this.element.appendChild(summary.element);
    const groups = groupLifeArchive(filtered);
    for (const [category, group] of Object.entries(groups)) {
      const sectionEl = section((LIFE_ARCHIVE_LABELS[category] ?? category) + ' — ' + group.length);
      const timeline = h('div', 'ui-timeline');
      for (const entry of group.slice(0, 40)) {
        const row = h('div', 'ui-timeline-entry' + (entry.importance >= 3 ? ' important' : ''));
        row.appendChild(h('div', 'ui-timeline-title', lifeArchiveIcon(category) + ' ' + entry.title));
        row.appendChild(h('div', 'ui-timeline-desc', entry.description));
        const meta = h('div', 'ui-timeline-meta');
        meta.append(span('', gameTimeText(entry.at)));
        if (entry.locationId) meta.appendChild(span('', locationName(this.ctx.content, entry.locationId)));
        row.appendChild(meta);
        timeline.appendChild(row);
      }
      sectionEl.body.appendChild(timeline);
      this.element.appendChild(sectionEl.element);
    }
    if (filtered.length === 0) this.element.appendChild(empty('Your story is still a blank page. Go live a little.'));
  }

  private renderLetters(): void {
    const letters = [...this.state.life.letters].reverse();
    const listSection = section('Letters', letters.length + ' received');
    if (letters.length === 0) listSection.body.appendChild(empty('No letters yet. People write when something matters.'));
    for (const letter of letters) {
      const card = h('div', 'ui-card ui-letter' + (letter.read ? '' : ' unread'));
      const head = h('div', 'ui-card-title');
      head.append(document.createTextNode('✉ ' + letter.subject + ' '));
      if (!letter.read) head.appendChild(badge('unread', 'accent'));
      card.appendChild(head);
      card.appendChild(
        h('div', 'ui-card-sub', (letter.fromNpcId ? this.state.npcs[letter.fromNpcId]?.name ?? letter.fromNpcId : 'Anonymous') + ' · ' + gameTimeText(letter.sentAt))
      );
      card.appendChild(h('div', 'ui-card-text', letter.body));
      if (letter.attachments.length > 0) {
        card.appendChild(
          h('div', 'ui-card-sub', 'attached: ' + letter.attachments.map((itemId) => this.ctx.content.resolveItemName(itemId)).join(', '))
        );
      }
      if (!letter.read) {
        card.appendChild(
          button('Read letter', () => {
            this.ctx.dispatch({ type: 'life:read-letter', letterId: letter.id });
            this.refresh();
          }, { className: 'ui-button-small' })
        );
      }
      listSection.body.appendChild(card);
    }
    this.element.appendChild(listSection.element);
  }

  private renderOffline(): void {
    const summary = this.ctx.api.getOfflineSummary();
    const pending = this.state.pendingOffline;
    const info = section('Time away', 'the world does not pause');
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Last processed', pending.lastProcessedSimTime > 0 ? gameTimeText(pending.lastProcessedSimTime) : 'never'),
      statTile('Pending summary', summary ? 'yes' : 'none'),
      statTile('Play time', formatDuration(pending.lastSaveRealMs > 0 ? (Date.now() - pending.lastSaveRealMs) / 1000 : 0)),
      statTile('Generation', String(this.state.life.generation))
    );
    info.body.appendChild(stats);
    if (summary) {
      info.body.appendChild(h('div', 'ui-offline-headline', summary.headline));
      const changes = section('What changed', summary.changes.length + ' changes');
      const grouped = groupOfflineChanges(summary.changes);
      for (const group of grouped) {
        const line = h('div', 'ui-stack');
        for (const change of group.items.slice(0, 8)) {
          const row = h('div', 'ui-offline-change');
          row.append(span('kind', offlineChangeIcon(change.kind)), span('ui-grow', change.description));
          line.appendChild(row);
        }
        changes.body.appendChild(line);
      }
      if (summary.changes.length === 0) changes.body.appendChild(empty('Nothing notable changed.'));
      info.body.appendChild(changes.element);
      const highlightList = section('Highlights');
      for (const highlight of summary.highlights) highlightList.body.appendChild(h('div', 'ui-list-item', highlight));
      if (summary.highlights.length === 0) highlightList.body.appendChild(empty('No highlights.'));
      info.body.appendChild(highlightList.element);
      info.body.appendChild(button('Open the full summary', () => this.ctx.showOfflineSummaryModal(), { className: 'ui-button-primary ui-button-small' }));
    } else {
      info.body.appendChild(
        h('div', 'ui-card-text', 'No offline summary is waiting. When the world runs without you for a while, the changes will appear here and as a modal on return.')
      );
      info.body.appendChild(
        h('div', 'ui-card-text', 'World time advances at ' + (this.state.clock.speed ?? 1) + '× while you play, and more slowly while you are away.')
      );
    }
    this.element.appendChild(info.element);
    if (summary && summary.importantNpcUpdates.length > 0) {
      const people = section('People you know', String(summary.importantNpcUpdates.length) + ' updates');
      for (const update of summary.importantNpcUpdates) {
        people.body.appendChild(h('div', 'ui-list-item', update.name + ' — ' + update.description));
      }
      this.element.appendChild(people.element);
    }
    void formatMoney;
  }
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours >= 24) return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h';
  return hours > 0 ? hours + 'h ' + minutes + 'm' : minutes + 'm';
}
