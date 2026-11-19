// =============================================================================
// Events panel: active events, world log, festival schedule, notifications.
// =============================================================================
import type { GameState } from '../core/contracts';
import type { FestivalDef } from '../data/schema';
import { eventCategoryIcon, eventImportanceLabel, gameTimeText, locationName } from './model';
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

type EventTab = 'active' | 'log' | 'festivals' | 'notifications';

export class EventPanel extends PanelBase {
  private tab: EventTab = 'active';

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
  }

  protected signature(state: Readonly<GameState>): string {
    return this.sig(
      this.tab,
      state.world.events.slice(-14).map((event) => [event.id, event.acknowledged]),
      state.eventSystem.activeEventIds,
      state.eventSystem.pendingNotifications,
      state.eventSystem.festivals,
      state.world.history.slice(-6).map((entry) => entry.id),
      Math.floor(state.clock.simTimeSeconds / 60)
    );
  }

  protected render(): void {
    this.element.replaceChildren();
    this.element.appendChild(
      tabs(
        [
          { id: 'active', label: 'Active', count: this.state.eventSystem.activeEventIds.length, icon: '📣' },
          { id: 'log', label: 'Recent log', icon: '📜' },
          { id: 'festivals', label: 'Festivals', icon: '🎪' },
          { id: 'notifications', label: 'Notifications', count: this.state.eventSystem.pendingNotifications.length, icon: '🔔' },
        ],
        this.tab,
        (id) => {
          this.tab = id as EventTab;
          this.rerender();
        }
      )
    );
    if (this.tab === 'active') this.renderActive();
    else if (this.tab === 'log') this.renderLog();
    else if (this.tab === 'festivals') this.renderFestivals();
    else this.renderNotifications();
  }

  private renderActive(): void {
    let active: { id: string; title: string; description: string; category: string; importance: number; locationId?: string; participants: string[]; acknowledged?: boolean }[] = [];
    try {
      active = this.ctx.api.getSystems().events.getActiveEvents();
    } catch {
      active = [];
    }
    const summary = section('What is happening now', active.length + ' active');
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Active', String(active.length)),
      statTile('World events', String(this.state.world.events.length)),
      statTile('History entries', String(this.state.world.history.length)),
      statTile('Festivals', String(Object.keys(this.state.eventSystem.festivals).length))
    );
    summary.body.appendChild(stats);
    this.element.appendChild(summary.element);
    const list = section('Active event cards');
    if (active.length === 0) list.body.appendChild(empty('The world is quiet right now. It will not stay that way.'));
    for (const event of active) {
      const card = h('div', 'ui-card ui-event-card ' + event.category);
      const head = h('div', 'ui-card-title');
      head.append(document.createTextNode(eventCategoryIcon(event.category) + ' ' + event.title + ' '));
      head.appendChild(badge(eventImportanceLabel(event.importance), event.importance >= 3 ? 'accent' : 'neutral'));
      card.appendChild(head);
      card.appendChild(h('div', 'ui-card-text', event.description));
      const meta = h('div', 'ui-card-sub');
      meta.textContent =
        (event.locationId ? locationName(this.ctx.content, event.locationId) + ' · ' : '') +
        (event.participants.length > 0
          ? event.participants.map((id) => this.state.npcs[id]?.name ?? id).join(', ')
          : 'the whole town');
      card.appendChild(meta);
      card.appendChild(
        button('Acknowledge', () => {
          this.ctx.dispatch({ type: 'event:acknowledge', eventId: event.id });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
      list.body.appendChild(card);
    }
    this.element.appendChild(list.element);
  }

  private renderLog(): void {
    let events: { id: string; title: string; description: string; category: string; importance: number; occurredAt: number; locationId?: string; participants: string[]; acknowledged: boolean }[] = [];
    try {
      events = this.ctx.api.getSystems().events.getRecentEvents(30);
    } catch {
      events = [];
    }
    const log = section('Recent events', events.length + ' remembered');
    if (events.length === 0) log.body.appendChild(empty('No events yet.'));
    for (const event of [...events].reverse()) {
      const card = h('div', 'ui-card ui-event-card ' + event.category);
      card.appendChild(h('div', 'ui-card-title', eventCategoryIcon(event.category) + ' ' + event.title + (event.acknowledged ? '' : ' ●')));
      card.appendChild(h('div', 'ui-card-text', event.description));
      card.appendChild(
        h(
          'div',
          'ui-card-sub',
          gameTimeText(event.occurredAt) +
            ' · ' +
            eventImportanceLabel(event.importance) +
            (event.locationId ? ' · ' + locationName(this.ctx.content, event.locationId) : '')
        )
      );
      log.body.appendChild(card);
    }
    this.element.appendChild(log.element);
  }

  private renderFestivals(): void {
    let festivals: { def: FestivalDef; state: { season: number; day: number; state: 'upcoming' | 'active' | 'ended'; participantCount: number } }[] = [];
    try {
      festivals = this.ctx.api.getSystems().events.getFestivals();
    } catch {
      festivals = [];
    }
    const schedule = section('Festival year', festivals.length + ' festivals');
    if (festivals.length === 0) schedule.body.appendChild(empty('No festivals are scheduled.'));
    const seasonNames = ['Spring', 'Summer', 'Autumn', 'Winter'];
    for (const festival of festivals) {
      const state = festival.state;
      const isActive = state.state === 'active' || (state.state === undefined && isHappeningNow(festival.def, this.state));
      const card = h('div', 'ui-card ui-festival-card');
      const head = h('div', 'ui-card-title');
      head.append(document.createTextNode('🎪 ' + festival.def.name + ' '));
      head.appendChild(badge(isActive ? 'active now' : (state?.state ?? 'upcoming'), isActive ? 'accent' : 'neutral'));
      head.appendChild(badge(seasonNames[seasonIndexOf(festival.def.season)] ?? '', 'neutral'));
      card.appendChild(head);
      card.appendChild(
        h(
          'div',
          'ui-card-sub',
          'Day ' + festival.def.dayOfSeason + ' of ' + (seasonNames[festivalStateSeason(festival)] ?? 'the season') + ' · ' + String(festival.def.startHour).padStart(2, '0') + ':00 · ' + locationName(this.ctx.content, festival.def.locationId)
        )
      );
      card.appendChild(h('div', 'ui-card-text', festival.def.description));
      if (state) card.appendChild(h('div', 'ui-card-sub', state.participantCount + ' residents taking part'));
      const activities = h('div', 'ui-card-actions');
      for (const activity of festival.def.activities) {
        activities.appendChild(
          button(activity.label, () => {
            this.ctx.dispatch({ type: 'festival:participate', festivalId: festival.def.id, activityId: activity.id });
            this.refresh();
          }, { className: 'ui-button-small', disabled: !isActive, tooltip: isActive ? activity.description : 'The festival is not underway.' })
        );
      }
      card.appendChild(activities);
      if (!isActive && festival.def.activities.length > 0) {
        card.appendChild(h('div', 'ui-card-sub', 'Participate when the festival begins. Travel there with the map (M).'));
      }
      schedule.body.appendChild(card);
    }
    this.element.appendChild(schedule.element);
  }

  private renderNotifications(): void {
    const pending = this.state.eventSystem.pendingNotifications;
    const notifications = section('Pending notifications', pending.length + ' unread');
    if (pending.length === 0) notifications.body.appendChild(empty('Everything has been read.'));
    for (const eventId of pending) {
      const event = this.state.world.events.find((candidate) => candidate.id === eventId);
      const line = h('div', 'ui-buy-card');
      line.appendChild(h('div', 'ui-card-title', event ? event.title : eventId));
      if (event) line.appendChild(h('div', 'ui-card-text', event.description));
      line.appendChild(
        button('Mark read', () => {
          this.ctx.dispatch({ type: 'event:acknowledge', eventId });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
      notifications.body.appendChild(line);
    }
    this.element.appendChild(notifications.element);
    const unreadEvents = this.state.world.events.filter((event) => !event.acknowledged).slice(-5);
    if (unreadEvents.length > 0) {
      const unread = section('Seen but unread');
      for (const event of unreadEvents) {
        unread.body.appendChild(h('div', 'ui-list-item', event.title + ' · ' + gameTimeText(event.occurredAt)));
      }
      this.element.appendChild(unread.element);
    }
  }
}

function festivalStateSeason(festival: { state?: { season: number } }): number {
  return festival.state?.season ?? 0;
}

function seasonIndexOf(season: string): number {
  const index = ['spring', 'summer', 'autumn', 'winter'].indexOf(season);
  return index >= 0 ? index : 0;
}

function isHappeningNow(def: FestivalDef, state: Readonly<GameState>): boolean {
  const env = state.world.environment;
  const time = state.clock.simTimeSeconds;
  void time;
  const seasonIndex = env.seasonIndex;
  if (def.season !== env.season) return false;
  if (def.dayOfSeason !== env.dayOfSeason) return false;
  const hour = Math.floor((state.clock.simTimeSeconds % (24 * 3600)) / 3600);
  return hour >= def.startHour && hour < def.startHour + def.durationHours;
}
