// =============================================================================
// Map panel: two regions drawn with SVG from LocationDef positions, connection
// lines, current marker, NPC dots, travel, around-you actions and train timetable.
// =============================================================================
import type { GameState } from '../core/contracts';
import type { LocationDef } from '../data/schema';
import type { RegionId } from '../core/SharedTypes';
import { formatMoney } from '../core/format';
import {
  adjacentLocations,
  projectRegionMap,
  interiorOfLocation,
  locationName,
  humaniseId,
  minutesUntilText,
  gameTimeText,
  countItem,
  fishingBaitOptions,
  fishingRodOptions,
  MAP_TILE_PX,
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

type MapTab = 'map' | 'around' | 'trains';

interface DepartureRow {
  routeId: string;
  toLocationId: string;
  minutesUntil: number;
  pricePence: number;
  departSimTime: number;
  arriveSimTime: number;
}

export class MapPanel extends PanelBase {
  private tab: MapTab = 'map';
  private region: RegionId = 'willowbrook';
  private selectedId: string | null = null;
  private tillX = 0;
  private tillY = 0;

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
    this.region = state.player.position.regionId;
    this.selectedId = state.player.position.locationId;
  }

  protected signature(state: Readonly<GameState>): string {
    return this.sig(
      this.tab,
      this.region,
      this.selectedId,
      state.player.position,
      Object.values(state.world.locations).map((location) => [location.id, location.discovered, location.unlocked]),
      Object.values(state.npcs).map((npc) => npc.locationId),
      state.world.transport,
      state.world.environment.weather,
      Object.values(state.farming.plots).slice(-12).map((plot) => [plot.id, plot.stage, Math.round(plot.moisture * 20)]),
      Object.values(state.foraging.nodes).slice(-12).map((node) => [node.id, node.depleted]),
      Math.floor(state.clock.simTimeSeconds / 15)
    );
  }

  private selectedDef(): LocationDef | null {
    if (!this.selectedId) return null;
    return this.ctx.content.getLocation(this.selectedId) ?? null;
  }

  protected render(): void {
    this.element.replaceChildren();
    this.element.appendChild(
      tabs(
        [
          { id: 'map', label: 'Map', icon: '🗺' },
          { id: 'around', label: 'Around you', icon: '📍' },
          { id: 'trains', label: 'Trains', icon: '🚂' },
        ],
        this.tab,
        (id) => {
          this.tab = id as MapTab;
          this.rerender();
        }
      )
    );
    if (this.tab === 'map') this.renderMap();
    else if (this.tab === 'around') this.renderAround();
    else this.renderTrains();
  }

  private renderMap(): void {
    const currentDef = this.ctx.content.getLocation(this.state.player.position.locationId);
    const current = section('You are here', locationName(this.ctx.content, this.state.player.position.locationId));
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Region', this.state.world.regions[this.state.player.position.regionId]?.name ?? this.state.player.position.regionId),
      statTile('Money', formatMoney(this.state.player.money)),
      statTile('Weather', this.state.world.environment.weather),
      statTile('Time', gameTimeText(this.state.clock.simTimeSeconds).split(' · ')[1] ?? '')
    );
    current.body.appendChild(stats);
    if (currentDef) current.body.appendChild(h('div', 'ui-card-text', currentDef.description));
    this.element.appendChild(current.element);

    const regionTabs = h('div', 'ui-tabs');
    for (const regionId of ['willowbrook', 'ashford'] as const) {
      regionTabs.appendChild(
        button(this.state.world.regions[regionId]?.name ?? regionId, () => {
          this.region = regionId;
          this.rerender();
        }, { className: 'ui-tab' + (this.region === regionId ? ' ui-tab-active' : ''), pressed: this.region === regionId })
      );
    }
    this.element.appendChild(regionTabs);
    const projection = projectRegionMap(this.region, this.ctx.content, this.state);
    const region = h('div', 'ui-map-region');
    const regionHead = h('div', 'ui-map-region-head');
    regionHead.append(span('', projection.name), span('', projection.nodes.length + ' places known'));
    region.appendChild(regionHead);
    region.appendChild(this.buildSvg(projection));
    const legend = h('div', 'ui-map-legend');
    legend.append(
      legendItem('var(--acg-ember)', 'you'),
      legendItem('var(--acg-amber)', 'selected'),
      legendItem('var(--acg-green)', 'next stop'),
      legendItem('var(--acg-purple)', 'people you know'),
      legendItem('#4a4152', 'locked')
    );
    region.appendChild(legend);
    this.element.appendChild(region);
    if (projection.nodes.length === 0) this.element.appendChild(empty('This region is still a rumour. Discover places to fill the map.'));

    const selected = this.selectedDef();
    if (selected) {
      const detail = section(selected.name, humaniseId(selected.kind));
      detail.body.appendChild(h('div', 'ui-card-text', selected.description));
      const locationState = this.state.world.locations[selected.id];
      const meta = h('div', 'ui-stats');
      meta.append(
        statTile('Open', this.hoursText(selected)),
        statTile('Shelter', Math.round(selected.shelter * 100) + '%'),
        statTile('Wind', Math.round(selected.windExposure * 100) + '%'),
        statTile('Visits', String(locationState?.visitCount ?? 0))
      );
      detail.body.appendChild(meta);
      if (selected.facilities.length > 0) {
        const facilities = h('div', 'ui-inline');
        for (const facility of selected.facilities) facilities.appendChild(badge(facility.replaceAll('_', ' '), 'neutral'));
        detail.body.appendChild(facilities);
      }
      const occupants = Object.values(this.state.npcs).filter((npc) => npc.locationId === selected.id);
      if (occupants.length > 0) {
        detail.body.appendChild(h('div', 'ui-card-sub', 'People here: ' + occupants.map((npc) => npc.name).join(', ')));
      }
      const actions = h('div', 'ui-detail-actions');
      const isCurrent = selected.id === this.state.player.position.locationId;
      const adjacent = adjacentLocations(this.ctx.content, this.state.player.position.locationId).some((def) => def.id === selected.id);
      const unlocked = locationState?.unlocked ?? !selected.secret;
      if (isCurrent) {
        actions.appendChild(badge('you are here', 'ok'));
      } else {
        actions.appendChild(
          button('Walk to ' + selected.name, () => {
            this.travelTo(selected);
          }, {
            className: 'ui-button-small ui-button-primary',
            disabled: !adjacent || !unlocked,
            tooltip: !unlocked ? 'This place is locked — find a way in.' : !adjacent ? 'You must walk there in steps. Select a neighbouring place.' : 'Travel here.',
          })
        );
      }
      const interior = interiorOfLocation(this.ctx.content, selected.id);
      if (interior && isCurrent) {
        actions.appendChild(
          button('Enter ' + interior.name, () => {
            this.selectedId = interior.id;
            this.ctx.dispatch({ type: 'move:enter', locationId: interior.id });
            this.refresh();
          }, { className: 'ui-button-small' })
        );
      }
      if (selected.entranceFrom) {
        actions.appendChild(
          button('Leave building', () => {
            this.ctx.dispatch({ type: 'move:exit-interior' });
            this.refresh();
          }, { className: 'ui-button-small' })
        );
      }
      if (selected.secret && !unlocked) actions.appendChild(badge('hidden place', 'warn'));
      detail.body.appendChild(actions);
      this.element.appendChild(detail.element);
    }
    void MAP_TILE_PX;
  }

  private hoursText(def: LocationDef): string {
    if (def.openHour === def.closeHour) return 'always';
    return String(def.openHour).padStart(2, '0') + ':00-' + String(def.closeHour).padStart(2, '0') + ':00';
  }

  private buildSvg(projection: ReturnType<typeof projectRegionMap>): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ui-map-svg');
    svg.setAttribute('viewBox', projection.minX + ' ' + projection.minY + ' ' + projection.width + ' ' + projection.height);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', projection.name + ' map');
    const nodeById = new Map(projection.nodes.map((node) => [node.def.id, node]));
    for (const edge of projection.edges) {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(edge.x1));
      line.setAttribute('y1', String(edge.y1));
      line.setAttribute('x2', String(edge.x2));
      line.setAttribute('y2', String(edge.y2));
      line.setAttribute('class', 'map-edge');
      svg.appendChild(line);
    }
    for (const node of projection.nodes) {
      const adjacent = adjacentLocations(this.ctx.content, this.state.player.position.locationId).some((def) => def.id === node.def.id);
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'map-node' + (node.isCurrent ? ' current' : '') + (node.unlocked ? '' : ' locked') + (this.selectedId === node.def.id ? ' selected' : '') + (adjacent ? ' adjacent' : ''));
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.setAttribute('aria-label', node.def.name + (node.isCurrent ? ', you are here' : ''));
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(node.x));
      circle.setAttribute('cy', String(node.y));
      circle.setAttribute('r', node.isCurrent ? '24' : '19');
      group.appendChild(circle);
      for (let index = 0; index < Math.min(3, node.npcIds.length); index += 1) {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', String(node.x + 20 + index * 9));
        dot.setAttribute('cy', String(node.y - 20));
        dot.setAttribute('r', '5');
        dot.setAttribute('class', 'map-npc-dot');
        group.appendChild(dot);
      }
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(node.x));
      label.setAttribute('y', String(node.y + (node.isCurrent ? 38 : 33)));
      label.setAttribute('text-anchor', 'middle');
      label.textContent = node.def.name;
      group.appendChild(label);
      group.addEventListener('click', () => {
        this.selectedId = node.def.id;
        this.rerender();
      });
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.selectedId = node.def.id;
          this.rerender();
        }
      });
      svg.appendChild(group);
    }
    return svg;
  }

  private travelTo(def: LocationDef): void {
    const action = def.indoor || def.entranceFrom ? { type: 'move:enter' as const, locationId: def.id } : { type: 'move:to-location' as const, locationId: def.id };
    this.ctx.dispatch(action);
    this.refresh();
  }

  private renderAround(): void {
    const def = this.ctx.content.getLocation(this.state.player.position.locationId);
    const header = section('At ' + (def?.name ?? 'here'), humaniseId(def?.kind ?? 'place'));
    if (def) header.body.appendChild(h('div', 'ui-card-text', def.description));
    this.element.appendChild(header.element);

    const actions = section('Things to do here', 'every action is a real dispatch');
    const row = h('div', 'ui-detail-actions');
    row.appendChild(
      button('Search the area', () => {
        this.ctx.dispatch({ type: 'explore:search', locationId: this.state.player.position.locationId });
        this.refresh();
      }, { className: 'ui-button-small' })
    );
    row.appendChild(
      button('Take a photo', () => {
        this.ctx.dispatch({ type: 'explore:photo', locationId: this.state.player.position.locationId });
        this.refresh();
      }, { className: 'ui-button-small' })
    );
    row.appendChild(
      button('Collect ash', () => {
        this.ctx.dispatch({ type: 'ash:collect' });
        this.refresh();
      }, { className: 'ui-button-small' })
    );
    if (def?.fishSpot) {
      const rods = fishingRodOptions(this.state.player.inventory, this.ctx.content);
      const baits = fishingBaitOptions(this.state.player.inventory, this.ctx.content);
      row.appendChild(
        button('Cast a line', () => {
          const rod = rods[0];
          const bait = baits[0];
          this.ctx.dispatch({
            type: 'fish:cast',
            locationId: this.state.player.position.locationId,
            ...(rod ? { rodInstanceId: rod.entry.instanceId } : {}),
            ...(bait ? { baitInstanceId: bait.entry.instanceId } : {}),
          });
          this.refresh();
        }, { className: 'ui-button-small', disabled: rods.length === 0, tooltip: rods.length === 0 ? 'No fishing rod in your bag.' : 'Cast with the best rod you carry.' })
      );
    }
    if (def?.facilities.includes('bed')) {
      row.appendChild(
        button('Sleep 8 hours', () => {
          this.ctx.dispatch({ type: 'time:rest', hours: 8 });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
    }
    if (def?.heatSource) {
      row.appendChild(
        button('Warm up by the heat', () => {
          this.ctx.dispatch({ type: 'life:warm-up', source: 'heat' });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
    }
    actions.body.appendChild(row);
    this.element.appendChild(actions.element);

    const secrets = section('Exploration', 'clues and secrets found here');
    const exploration = this.state.exploration;
    const locationState = this.state.world.locations[this.state.player.position.locationId];
    secrets.body.appendChild(row2('Clues found', String(exploration.clues.length)));
    secrets.body.appendChild(row2('Secrets in the world', String(exploration.discoveredSecrets.length)));
    secrets.body.appendChild(row2('Searches here', String(locationState?.searchCount ?? 0)));
    const photos = this.ctx.api.getSystems().exploration.getPhotos();
    secrets.body.appendChild(row2('Photos taken', String(photos.length)));
    this.element.appendChild(secrets.element);

    const forage = section('Foraging', 'seasonal nodes');
    const nodes = this.ctx.api.getSystems().foraging.getNodesAt(this.state.player.position.locationId);
    if (nodes.length === 0) forage.body.appendChild(empty('Nothing to forage here.'));
    for (const node of nodes) {
      const nodeDef = this.ctx.api.getSystems().foraging.getNodeDef(node.id);
      const line = h('div', 'ui-furniture-row');
      line.appendChild(span('ui-grow', (nodeDef?.name ?? node.defId) + (node.depleted ? ' — picked clean' : ' — ' + node.remaining + ' left')));
      line.appendChild(
        button('Gather', () => {
          this.ctx.dispatch({ type: 'forage:gather', nodeId: node.id });
          this.refresh();
        }, { className: 'ui-button-small', disabled: node.depleted })
      );
      forage.body.appendChild(line);
    }
    this.element.appendChild(forage.element);

    const plots = this.ctx.api.getSystems().farming.getPlots(this.state.player.position.locationId);
    const farm = section('Farming plots', plots.length + ' plots here');
    if (plots.length === 0) {
      farm.body.appendChild(h('div', 'ui-card-text', 'No tilled soil here. Farmland, gardens and orchards accept plots.'));
      const tillRow = h('div', 'ui-inline');
      tillRow.appendChild(span('ui-row-label', 'Till at'));
      const xInput = h('input', 'ui-input');
      xInput.type = 'number';
      xInput.min = '0';
      xInput.value = String(this.tillX);
      xInput.style.width = '54px';
      const yInput = h('input', 'ui-input');
      yInput.type = 'number';
      yInput.min = '0';
      yInput.value = String(this.tillY);
      yInput.style.width = '54px';
      tillRow.append(xInput, span('ui-muted', 'x'), yInput, span('ui-muted', 'y'));
      tillRow.appendChild(
        button('Till soil', () => {
          const x = Number(xInput.value);
          const y = Number(yInput.value);
          this.tillX = Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0;
          this.tillY = Number.isFinite(y) ? Math.max(0, Math.round(y)) : 0;
          this.ctx.dispatch({ type: 'farm:till', locationId: this.state.player.position.locationId, x: this.tillX, y: this.tillY });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
      farm.body.appendChild(tillRow);
    }
    for (const plot of plots.slice(0, 12)) {
      const crop = plot.cropId ? this.ctx.content.getCrop(plot.cropId) : undefined;
      const line = h('div', 'ui-furniture-row');
      line.appendChild(
        span('ui-grow', 'plot (' + plot.x + ',' + plot.y + ') · ' + plot.stage + (crop ? ' · ' + crop.name : '') + ' · moisture ' + Math.round(plot.moisture * 100) + '%')
      );
      if (plot.stage === 'planted' || plot.stage === 'mature') {
        line.appendChild(
          button('Water', () => {
            this.ctx.dispatch({ type: 'farm:water', plotId: plot.id });
            this.refresh();
          }, { className: 'ui-button-small' })
        );
      }
      if (plot.stage === 'mature') {
        line.appendChild(
          button('Harvest', () => {
            this.ctx.dispatch({ type: 'farm:harvest', plotId: plot.id });
            this.refresh();
          }, { className: 'ui-button-small ui-button-primary' })
        );
      }
      line.appendChild(
        button('Clear', () => {
          this.ctx.dispatch({ type: 'farm:clear', plotId: plot.id });
          this.refresh();
        }, { className: 'ui-button-small ui-button-danger' })
      );
      farm.body.appendChild(line);
    }
    const seed = this.state.player.inventory.find((entry) => this.ctx.content.getItem(entry.itemId)?.seedCropId);
    if (seed) {
      farm.body.appendChild(
        h('div', 'ui-card-sub', 'Planting: carry ' + this.ctx.content.resolveItemName(seed.itemId) + ' and use a tilled plot in the world.')
      );
    }
    this.element.appendChild(farm.element);
    void countItem;
  }

  private renderTrains(): void {
    const currentId = this.state.player.position.locationId;
    const stationDef = this.ctx.content.getLocation(currentId);
    const atStation = Boolean(stationDef?.facilities.includes('train')) || currentId.includes('train');
    const transport = this.state.world.transport;
    const schedule = section('Timetable', atStation ? 'from this platform' : 'visit a station');
    if (atStation) {
      const departures = this.departures();
      if (departures.length === 0) schedule.body.appendChild(empty('No departures in the next day.'));
      const table = h('table', 'ui-train-table');
      const head = h('tr');
      for (const label of ['Destination', 'Departs', 'Arrives', 'Fare', '']) head.appendChild(h('th', '', label));
      const thead = h('thead');
      thead.appendChild(head);
      table.appendChild(thead);
      const tbody = h('tbody');
      for (const departure of departures) {
        const row = h('tr');
        row.appendChild(h('td', '', locationName(this.ctx.content, departure.toLocationId)));
        row.appendChild(h('td', 'soon', minutesUntilText(departure.minutesUntil)));
        row.appendChild(h('td', '', gameTimeText(departure.arriveSimTime).split(' · ')[1] ?? ''));
        row.appendChild(h('td', '', formatMoney(departure.pricePence)));
        const actionCell = h('td');
        actionCell.appendChild(
          button('Buy ticket', () => {
            this.ctx.dispatch({ type: 'train:buy-ticket', routeId: departure.routeId });
            this.refresh();
          }, { className: 'ui-button-small' })
        );
        actionCell.appendChild(
          button('Board', () => {
            this.ctx.dispatch({ type: 'train:board' });
            this.refresh();
          }, { className: 'ui-button-small ui-button-primary' })
        );
        row.appendChild(actionCell);
        tbody.appendChild(row);
      }
      table.appendChild(tbody);
      schedule.body.appendChild(table);
    } else {
      schedule.body.appendChild(empty('You are not at a station. Willowbrook station and Ashford Central are marked on the map.'));
      const stations = this.ctx.content.pack.locations.filter((def) => def.facilities.includes('train'));
      for (const station of stations) schedule.body.appendChild(row2(station.name, station.regionId));
    }
    this.element.appendChild(schedule.element);

    const ride = transport.activeRide;
    if (ride) {
      const rideSection = section('Your journey', ride.status);
      rideSection.body.appendChild(row2('From', locationName(this.ctx.content, ride.fromLocationId)));
      rideSection.body.appendChild(row2('To', locationName(this.ctx.content, ride.toLocationId)));
      rideSection.body.appendChild(row2('Arrives', gameTimeText(ride.arriveSimTime)));
      rideSection.body.appendChild(
        h('div', 'ui-card-text', ride.status === 'waiting' ? 'The platform is quiet. The train has not left yet.' : 'The rails hum beneath you.')
      );
      this.element.appendChild(rideSection.element);
    }
    const tickets = section('Tickets', String(transport.tickets.filter((ticket) => !ticket.used).length) + ' valid');
    const valid = transport.tickets.filter((ticket) => !ticket.used);
    if (valid.length === 0) tickets.body.appendChild(empty('No tickets in your pocket.'));
    for (const ticket of valid.slice(0, 6)) {
      tickets.body.appendChild(
        h('div', 'ui-list-item', locationName(this.ctx.content, ticket.fromLocationId) + ' -> ' + locationName(this.ctx.content, ticket.toLocationId) + ' · ' + gameTimeText(ticket.departSimTime) + ' · ' + formatMoney(ticket.pricePence))
      );
    }
    this.element.appendChild(tickets.element);
    const note = section('Travelling');
    note.body.appendChild(
      h('div', 'ui-card-text', 'Buy a ticket at the departure station, then board within 30 in-game minutes of departure. The ride advances time and can be watched from the train tab. Walking is free but takes the day; the walk graph is drawn on the map.')
    );
    this.element.appendChild(note.element);
  }

  private departures(): DepartureRow[] {
    try {
      const raw = this.ctx.api.getSystems().world.getTrainSchedule(this.state.player.position.locationId);
      return raw.map((departure) => ({
        routeId: departure.routeId,
        toLocationId: departure.toLocationId,
        minutesUntil: departure.minutesUntil,
        pricePence: departure.pricePence,
        departSimTime: departure.departSimTime,
        arriveSimTime: departure.arriveSimTime,
      }));
    } catch {
      return [];
    }
  }
}

function row2(label: string, value: string): HTMLElement {
  const row = h('div', 'ui-row');
  row.appendChild(span('ui-row-label', label));
  row.appendChild(span('ui-row-value', value));
  return row;
}

function legendItem(color: string, label: string): HTMLElement {
  const item = span('');
  const swatch = h('i', '');
  swatch.style.background = color;
  item.appendChild(swatch);
  item.appendChild(document.createTextNode(label));
  return item;
}
