// =============================================================================
// Housing panel: rooms, grid furniture placement preview, paint/floor, storage.
// =============================================================================
import type { GameState, HomeState, PlacedFurnitureState, RoomState } from '../core/contracts';
import type { BlueprintDef, FurnitureDef } from '../data/schema';
import { formatMoney } from '../core/format';
import {
  ownedHomes,
  previewFurniturePlacement,
  furnitureCollisionClass,
  FLOOR_STYLES,
  WALL_SWATCHES,
  itemIcon,
  formatPercent01,
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

type HousingTab = 'rooms' | 'decor' | 'storage';

interface PlacementState {
  x: number;
  y: number;
  rotation: number;
}

export class HousingPanel extends PanelBase {
  private tab: HousingTab = 'rooms';
  private homeId: string | null = null;
  private roomId: string | null = null;
  private furnitureInstanceId: string | null = null;
  private placement: PlacementState = { x: 0, y: 0, rotation: 0 };

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
  }

  protected signature(state: Readonly<GameState>): string {
    return this.sig(
      this.tab,
      this.homeId,
      this.roomId,
      this.furnitureInstanceId,
      this.placement,
      state.housing.homes,
      state.housing.ownedHomeIds,
      state.player.inventory.map((entry) => [entry.instanceId, entry.itemId, entry.quantity]),
      state.player.money
    );
  }

  private homes(): HomeState[] {
    return ownedHomes(this.state);
  }

  private currentHome(): HomeState | null {
    const homes = this.homes();
    if (this.homeId) {
      const found = homes.find((home) => home.id === this.homeId);
      if (found) return found;
    }
    return homes[0] ?? null;
  }

  private currentRoom(home: HomeState): RoomState | null {
    if (this.roomId) {
      const found = home.rooms.find((room) => room.id === this.roomId);
      if (found) return found;
    }
    return home.rooms[0] ?? null;
  }

  private furnitureInInventory(): { instanceId: string; itemId: string; quantity: number; def: FurnitureDef }[] {
    const result: { instanceId: string; itemId: string; quantity: number; def: FurnitureDef }[] = [];
    for (const entry of this.state.player.inventory) {
      const item = this.ctx.content.getItem(entry.itemId);
      const furnitureId = item?.furnitureId;
      if (!furnitureId) continue;
      const def = this.ctx.content.getFurniture(furnitureId);
      if (!def) continue;
      result.push({ instanceId: entry.instanceId, itemId: entry.itemId, quantity: entry.quantity, def });
    }
    return result;
  }

  protected render(): void {
    this.element.replaceChildren();
    const homes = this.homes();
    if (homes.length === 0) {
      this.element.appendChild(empty('You do not own a home yet. The player starts with one; if this is wrong, check the housing state.'));
      return;
    }
    const homeSelector = h('div', 'ui-tabs');
    for (const home of homes) {
      homeSelector.appendChild(
        button(home.name, () => {
          this.homeId = home.id;
          this.roomId = null;
          this.furnitureInstanceId = null;
          this.placement = { x: 0, y: 0, rotation: 0 };
          this.rerender();
        }, { className: 'ui-tab' + (this.currentHome()?.id === home.id ? ' ui-tab-active' : ''), pressed: this.currentHome()?.id === home.id })
      );
    }
    this.element.appendChild(homeSelector);
    const home = this.currentHome();
    if (!home) return;
    this.homeId = home.id;

    const overview = section(home.name, 'at ' + (this.ctx.content.getLocation(home.locationId)?.name ?? home.locationId));
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Comfort', formatPercent01(home.comfort)),
      statTile('Decoration', formatPercent01(home.decorationScore)),
      statTile('Rooms', String(home.rooms.length)),
      statTile('Furniture', String(home.furniture.length)),
      statTile('Storage stacks', String(home.storage.length)),
      statTile('Upgrades', String(home.upgrades.length))
    );
    overview.body.appendChild(stats);
    this.element.appendChild(overview.element);

    this.element.appendChild(
      tabs(
        [
          { id: 'rooms', label: 'Furnish', icon: '🪑' },
          { id: 'decor', label: 'Paint & build', icon: '🎨' },
          { id: 'storage', label: 'Storage', count: home.storage.length, icon: '📦' },
        ],
        this.tab,
        (id) => {
          this.tab = id as HousingTab;
          this.rerender();
        }
      )
    );
    if (this.tab === 'rooms') this.renderRooms(home);
    else if (this.tab === 'decor') this.renderDecor(home);
    else this.renderStorage(home);
  }

  // -------------------------------------------------------------------------
  // Rooms + placement
  // -------------------------------------------------------------------------
  private renderRooms(home: HomeState): void {
    const room = this.currentRoom(home);
    if (!room) {
      this.element.appendChild(empty('This home has no rooms.'));
      return;
    }
    this.roomId = room.id;
    const roomTabs = h('div', 'ui-tabs');
    for (const candidate of home.rooms) {
      roomTabs.appendChild(
        button(candidate.name + ' (' + candidate.widthTiles + 'x' + candidate.heightTiles + ')' + (candidate.unlocked ? '' : ' locked'), () => {
          this.roomId = candidate.id;
          this.placement = { x: 0, y: 0, rotation: 0 };
          this.rerender();
        }, { className: 'ui-tab' + (room.id === candidate.id ? ' ui-tab-active' : ''), pressed: room.id === candidate.id })
      );
    }
    this.element.appendChild(roomTabs);
    if (!room.unlocked) {
      this.element.appendChild(empty('This room is locked. Unlock it with a room blueprint in the build tab.'));
      return;
    }

    const layout = h('div', 'ui-house-grid-wrap');
    const gridWrap = h('div', 'ui-stack');
    const grid = h('div', 'ui-house-grid-preview');
    grid.style.gridTemplateColumns = 'repeat(' + room.widthTiles + ', 22px)';
    const placedByCell = new Map<string, PlacedFurnitureState>();
    for (const placed of home.furniture) {
      if (placed.roomId !== room.id) continue;
      const def = this.ctx.content.getFurniture(placed.furnitureId);
      if (!def) continue;
      const rotated = placed.rotation === 90 || placed.rotation === 270;
      const width = rotated ? def.heightTiles : def.widthTiles;
      const height = rotated ? def.widthTiles : def.heightTiles;
      for (let dx = 0; dx < width; dx += 1) {
        for (let dy = 0; dy < height; dy += 1) {
          placedByCell.set(placed.x + dx + ',' + (placed.y + dy), placed);
        }
      }
    }
    const selectedFurniture = this.furnitureInInventory().find((item) => item.instanceId === this.furnitureInstanceId);
    const preview = selectedFurniture
      ? previewFurniturePlacement({
          home,
          def: selectedFurniture.def,
          roomId: room.id,
          x: this.placement.x,
          y: this.placement.y,
          rotation: this.placement.rotation,
          resolveFurniture: (furnitureId) => this.ctx.content.getFurniture(furnitureId),
        })
      : null;
    const previewCells = new Set<string>();
    if (preview) {
      for (let dx = 0; dx < preview.width; dx += 1) {
        for (let dy = 0; dy < preview.height; dy += 1) {
          previewCells.add(this.placement.x + dx + ',' + (this.placement.y + dy));
        }
      }
    }
    for (let y = 0; y < room.heightTiles; y += 1) {
      for (let x = 0; x < room.widthTiles; x += 1) {
        const key = x + ',' + y;
        const placed = placedByCell.get(key);
        const cell = h('div', 'ui-house-cell' + (placed ? ' placed' : ''));
        if (previewCells.has(key)) cell.classList.add(preview && preview.fits ? 'preview-fit' : 'preview-bad');
        if (this.placement.x === x && this.placement.y === y) cell.classList.add('origin');
        if (placed) {
          const def = this.ctx.content.getFurniture(placed.furnitureId);
          cell.title = def?.name ?? placed.furnitureId;
          cell.textContent = itemIcon(this.ctx.content.getItem(def?.itemId ?? ''));
          cell.style.fontSize = '12px';
          cell.style.lineHeight = '20px';
          cell.style.textAlign = 'center';
        }
        cell.addEventListener('click', () => {
          this.placement = { ...this.placement, x, y };
          this.rerender();
        });
        grid.appendChild(cell);
      }
    }
    gridWrap.appendChild(grid);
    const legend = h('div', 'ui-map-legend');
    legend.append(span('ui-muted', 'click a cell to move the placement origin; green fits, red collides'));
    gridWrap.appendChild(legend);
    layout.appendChild(gridWrap);

    const side = h('div', 'ui-stack');
    side.appendChild(h('span', 'ui-section-title', 'Place furniture'));
    const furnitureOptions = this.furnitureInInventory();
    if (furnitureOptions.length === 0) {
      side.appendChild(empty('No furniture in your bag. Buy or craft pieces first.'));
    }
    const optionList = h('div', 'ui-stack');
    for (const option of furnitureOptions.slice(0, 20)) {
      const active = option.instanceId === this.furnitureInstanceId;
      const item = h('div', 'ui-furniture-row');
      item.appendChild(span('ui-grow', itemIcon(this.ctx.content.getItem(option.itemId)) + ' ' + option.def.name + ' (' + option.def.widthTiles + 'x' + option.def.heightTiles + ')'));
      item.appendChild(badge(option.def.slot, 'neutral'));
      item.appendChild(
        button(active ? 'selected' : 'select', () => {
          this.furnitureInstanceId = option.instanceId;
          this.placement = { x: 0, y: 0, rotation: 0 };
          this.rerender();
        }, { className: 'ui-button-small' + (active ? ' ui-button-primary' : '') })
      );
      optionList.appendChild(item);
    }
    side.appendChild(optionList);
    if (selectedFurniture) {
      const controls = h('div', 'ui-inline');
      controls.appendChild(span('ui-muted', 'at (' + this.placement.x + ', ' + this.placement.y + ')'));
      controls.appendChild(
        button('Rotate 90°', () => {
          this.placement = { ...this.placement, rotation: (this.placement.rotation + 90) % 360 };
          this.rerender();
        }, { className: 'ui-button-small' })
      );
      side.appendChild(controls);
      const fit = preview?.fits ?? false;
      const feedback = h('div', 'ui-card-text');
      if (!preview) feedback.textContent = '';
      else if (!preview.inBounds) feedback.textContent = 'Outside the room bounds.';
      else if (preview.collisionIds.length > 0) feedback.textContent = 'Collides with ' + preview.collisionIds.length + ' placed piece(s).';
      else feedback.textContent = 'Fits: ' + preview.width + 'x' + preview.height + ' tiles.';
      side.appendChild(feedback);
      side.appendChild(
        button('Place here', () => {
          this.ctx.dispatch({
            type: 'housing:place',
            itemInstanceId: selectedFurniture.instanceId,
            x: this.placement.x,
            y: this.placement.y,
            rotation: this.placement.rotation,
          });
          this.furnitureInstanceId = null;
          this.refresh();
        }, { className: 'ui-button-primary', disabled: !fit, tooltip: fit ? 'Place the furniture.' : 'Cannot place here.' })
      );
    }
    layout.appendChild(side);
    this.element.appendChild(layout);

    const placedList = section('Placed furniture', home.furniture.filter((placed) => placed.roomId === room.id).length + ' in ' + room.name);
    for (const placed of home.furniture.filter((candidate) => candidate.roomId === room.id)) {
      const def = this.ctx.content.getFurniture(placed.furnitureId);
      const line = h('div', 'ui-furniture-row');
      line.appendChild(span('ui-grow', (def ? itemIcon(this.ctx.content.getItem(def.itemId)) + ' ' + def.name : placed.furnitureId) + ' · (' + placed.x + ', ' + placed.y + ') rot ' + placed.rotation + (def ? ' · ' + furnitureCollisionClass(def) : '')));
      line.appendChild(
        button('Remove', () => {
          this.ctx.dispatch({ type: 'housing:remove', placedFurnitureId: placed.id });
          this.refresh();
        }, { className: 'ui-button-small ui-button-danger' })
      );
      placedList.body.appendChild(line);
    }
    if (home.furniture.filter((candidate) => candidate.roomId === room.id).length === 0) placedList.body.appendChild(empty('This room is empty.'));
    this.element.appendChild(placedList.element);
    void formatMoney;
    void formatPercent01;
  }

  // -------------------------------------------------------------------------
  // Decor / build
  // -------------------------------------------------------------------------
  private renderDecor(home: HomeState): void {
    const paint = section('Wall paint', 'click a swatch to repaint the whole home');
    const wallSwatches = h('div', 'ui-swatch-row');
    for (const color of WALL_SWATCHES) {
      const swatch = h('button', 'ui-swatch' + (home.wallColor.toLowerCase() === color ? ' active' : ''));
      swatch.type = 'button';
      swatch.style.background = color;
      swatch.setAttribute('aria-label', 'Paint wall ' + color);
      swatch.addEventListener('click', () => {
        this.ctx.dispatch({ type: 'housing:paint', homeId: home.id, color });
        this.refresh();
      });
      wallSwatches.appendChild(swatch);
    }
    paint.body.appendChild(wallSwatches);
    paint.body.appendChild(h('div', 'ui-card-sub', 'current wall colour ' + home.wallColor));
    this.element.appendChild(paint.element);

    const floors = section('Flooring', 'each style changes the whole home');
    const floorRow = h('div', 'ui-inline');
    for (const floor of FLOOR_STYLES) {
      const active = home.floorStyle === floor.id;
      const chip = h('button', 'ui-chip' + (active ? ' ui-chip-accent' : ''));
      chip.type = 'button';
      chip.textContent = floor.name;
      chip.style.borderColor = floor.color;
      chip.addEventListener('click', () => {
        this.ctx.dispatch({ type: 'housing:floor', homeId: home.id, style: floor.id });
        this.refresh();
      });
      floorRow.appendChild(chip);
    }
    floors.body.appendChild(floorRow);
    floors.body.appendChild(h('div', 'ui-card-sub', 'current floor ' + home.floorStyle));
    this.element.appendChild(floors.element);

    const rooms = section('Add a room', 'rooms unlock with blueprints');
    const roomBlueprints = this.ctx.content.pack.blueprints.filter((blueprint) => blueprint.kind === 'room');
    if (roomBlueprints.length === 0) rooms.body.appendChild(empty('No room blueprints are defined.'));
    for (const blueprint of roomBlueprints) {
      const card = h('div', 'ui-buy-card');
      card.appendChild(h('div', 'ui-card-title', blueprint.name));
      card.appendChild(h('div', 'ui-card-sub', blueprint.skill + ' Lv ' + blueprint.levelReq + ' · ' + blueprint.buildHours + 'h · ' + blueprint.effects.join(', ')));
      card.appendChild(h('div', 'ui-card-text', blueprint.description));
      const inputs = h('div', 'ui-inline');
      let hasMaterials = true;
      for (const input of blueprint.inputs) {
        const have = this.state.player.inventory.filter((entry) => entry.itemId === input.itemId).reduce((sum, entry) => sum + entry.quantity, 0);
        if (have < input.quantity) hasMaterials = false;
        inputs.appendChild(h('span', 'ui-ingredient ' + (have >= input.quantity ? 'have' : 'missing'), this.ctx.content.resolveItemName(input.itemId) + ' ' + have + '/' + input.quantity));
      }
      card.appendChild(inputs);
      card.appendChild(
        button('Add room', () => {
          this.ctx.dispatch({ type: 'housing:add-room', homeId: home.id, blueprintId: blueprint.id });
          this.refresh();
        }, { className: 'ui-button-small', disabled: !hasMaterials, tooltip: hasMaterials ? 'Build this room.' : 'Missing materials.' })
      );
      rooms.body.appendChild(card);
    }
    this.element.appendChild(rooms.element);

    const notes = section('Comfort and decoration');
    notes.body.appendChild(
      h('div', 'ui-card-text', 'Comfort and decoration come from the furniture you actually own and place, and from the paint and floor you choose. They affect how well resting restores you and how visitors judge the home.')
    );
    this.element.appendChild(notes.element);
    void blueprintKindLabel;
  }

  // -------------------------------------------------------------------------
  // Storage
  // -------------------------------------------------------------------------
  private renderStorage(home: HomeState): void {
    const layout = h('div', 'ui-shop-layout');
    const stored = section('In storage', home.storage.length + ' stacks');
    if (home.storage.length === 0) stored.body.appendChild(empty('Nothing stored here yet.'));
    for (const entry of home.storage) {
      const def = this.ctx.content.getItem(entry.itemId);
      const line = h('div', 'ui-furniture-row');
      line.appendChild(span('ui-grow', itemIcon(def) + ' ' + (def?.name ?? entry.itemId) + ' x' + entry.quantity));
      line.appendChild(
        button('Take', () => {
          this.ctx.dispatch({ type: 'housing:take', homeId: home.id, instanceId: entry.instanceId });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
      stored.body.appendChild(line);
    }
    layout.appendChild(stored.element);
    const carried = section('In your bag', this.state.player.inventory.length + ' stacks');
    if (this.state.player.inventory.length === 0) carried.body.appendChild(empty('Your bag is empty.'));
    for (const entry of this.state.player.inventory.slice(0, 40)) {
      const def = this.ctx.content.getItem(entry.itemId);
      const line = h('div', 'ui-furniture-row');
      line.appendChild(span('ui-grow', itemIcon(def) + ' ' + (def?.name ?? entry.itemId) + ' x' + entry.quantity));
      line.appendChild(
        button('Store', () => {
          this.ctx.dispatch({ type: 'housing:store', homeId: home.id, instanceId: entry.instanceId });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
      carried.body.appendChild(line);
    }
    layout.appendChild(carried.element);
    this.element.appendChild(layout);
    const note = section('Storage rules');
    note.body.appendChild(
      h('div', 'ui-card-text', 'Anything can be stored, including furniture you are not using yet. Stored stacks keep their quality and freshness.')
    );
    this.element.appendChild(note.element);
  }
}

function blueprintKindLabel(blueprint: BlueprintDef): string {
  return blueprint.kind.replaceAll('_', ' ');
}
