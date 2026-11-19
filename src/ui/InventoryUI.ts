// =============================================================================
// Inventory panel: item grid + details, equipment slots, crafting and cooking.
// =============================================================================
import type { GameState } from '../core/contracts';
import type { InventoryEntry, ItemCategory, QualityStars } from '../core/SharedTypes';
import type { ItemDef, RecipeDef } from '../data/schema';
import { formatMoney, qualityStars } from '../core/format';
import {
  itemIcon,
  itemCategoryLabel,
  itemActionKinds,
  describeItemEffect,
  equipmentProtectionText,
  equipmentSlotLabel,
  freshnessLabel,
  filterInventory,
  sortInventory,
  inventoryCategoryTabs,
  countItem,
  recipeAvailability,
  formatDurationClock,
  quantityFraction,
  type InventorySort,
  type RecipeKnowledge,
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
  setWidthPercent,
  PanelBase,
  craftingExtras,
  cookingExtras,
  type UiContext,
} from './widgets';

type InventoryTab = 'items' | 'equipment' | 'craft' | 'cook';

const EQUIPMENT_SLOTS = ['umbrella', 'windbreak', 'case', 'outerwear', 'accessory', 'hat', 'tool'] as const;

export class InventoryPanel extends PanelBase {
  private tab: InventoryTab = 'items';
  private category: ItemCategory | 'all' = 'all';
  private sort: InventorySort = 'name';
  private search = '';
  private selectedInstanceId: string | null = null;
  private dropQuantity = 1;
  private craftStation = 'all';
  private quantities = new Map<string, number>();

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
  }

  protected signature(state: Readonly<GameState>): string {
    return this.sig(
      this.tab,
      this.category,
      this.sort,
      state.player.inventory.map((entry) => [entry.instanceId, entry.itemId, entry.quantity, entry.quality, Math.round(entry.freshness * 20)]),
      state.player.equipment,
      state.player.knownRecipes.length,
      state.player.skills,
      state.player.position.locationId,
      state.crafting.jobs.map((job) => [job.id, Math.round(job.completesAt)]),
      state.cooking.buffs.length,
      state.player.cigarette.ashAccumulated.toFixed(2),
      state.player.money
    );
  }

  protected render(): void {
    this.element.replaceChildren();
    this.element.appendChild(
      tabs(
        [
          { id: 'items', label: 'Items', count: this.state.player.inventory.length, icon: '🎒' },
          { id: 'equipment', label: 'Protection', icon: '🛡' },
          { id: 'craft', label: 'Craft', icon: '🔨' },
          { id: 'cook', label: 'Cook', icon: '🍳' },
        ],
        this.tab,
        (id) => {
          this.tab = id as InventoryTab;
          this.rerender();
        }
      )
    );
    if (this.tab === 'items') this.renderItems();
    else if (this.tab === 'equipment') this.renderEquipment();
    else if (this.tab === 'craft') this.renderCraft();
    else this.renderCook();
  }

  // -------------------------------------------------------------------------
  // Items
  // -------------------------------------------------------------------------
  private renderItems(): void {
    const state = this.state;
    const filtered = sortInventory(filterInventory(state.player.inventory, this.ctx.content, { category: this.category, query: this.search }), this.ctx.content, this.sort);
    const toolbar = h('div', 'ui-filter-row');
    toolbar.appendChild(
      button('Collect ash (' + state.player.cigarette.ashAccumulated.toFixed(1) + ')', () => {
        this.ctx.dispatch({ type: 'ash:collect' });
        this.refresh();
      }, { className: 'ui-button-small ui-button-primary', tooltip: 'Loose ash is collected into your bag.' })
    );
    const searchInput = h('input', 'ui-input');
    searchInput.type = 'search';
    searchInput.placeholder = 'search…';
    searchInput.value = this.search;
    searchInput.style.width = '110px';
    searchInput.addEventListener('input', () => {
      this.search = searchInput.value;
      this.rerender();
    });
    toolbar.appendChild(searchInput);
    const sortSelect = h('select', 'ui-select');
    for (const [value, label] of [['name', 'name'], ['quality', 'quality'], ['quantity', 'count'], ['category', 'type']] as const) {
      const option = h('option', '', label);
      option.value = value;
      sortSelect.appendChild(option);
    }
    sortSelect.value = this.sort;
    sortSelect.addEventListener('change', () => {
      this.sort = sortSelect.value as InventorySort;
      this.rerender();
    });
    toolbar.appendChild(sortSelect);
    const chips = h('div', 'ui-filter-row');
    chips.appendChild(
      button('All', () => {
        this.category = 'all';
        this.rerender();
      }, { className: 'ui-filter-chip' + (this.category === 'all' ? ' active' : '') })
    );
    for (const category of inventoryCategoryTabs(state.player.inventory, this.ctx.content)) {
      chips.appendChild(
        button(itemCategoryLabel(category), () => {
          this.category = category;
          this.rerender();
        }, { className: 'ui-filter-chip' + (this.category === category ? ' active' : '') })
      );
    }
    toolbar.appendChild(chips);
    this.element.appendChild(toolbar);

    const layout = h('div', 'ui-inv-layout');
    const grid = h('div', 'ui-inv-grid');
    if (filtered.length === 0) grid.appendChild(empty('Nothing here matches. Your pockets are light.'));
    for (const entry of filtered) {
      const def = this.ctx.content.getItem(entry.itemId);
      const cell = button('', () => {
        this.selectedInstanceId = entry.instanceId;
        this.dropQuantity = 1;
        this.rerender();
      }, { className: 'ui-item-cell' + (this.selectedInstanceId === entry.instanceId ? ' selected' : '') });
      cell.setAttribute('aria-label', (def?.name ?? entry.itemId) + ' quantity ' + entry.quantity);
      cell.appendChild(h('div', 'ui-item-icon', itemIcon(def)));
      cell.appendChild(h('div', 'ui-item-name', def?.name ?? entry.itemId));
      const sub = h('div', 'ui-item-sub');
      sub.textContent = qualityStars(entry.quality) + (entry.quantity > 1 ? ' ×' + entry.quantity : '');
      cell.appendChild(sub);
      if (def && def.equipmentSlot) cell.appendChild(h('span', 'ui-badge ui-badge-accent', equipmentSlotLabel(def.equipmentSlot)));
      if (entry.quantity > 1) cell.appendChild(h('span', 'ui-item-qty', '×' + entry.quantity));
      grid.appendChild(cell);
    }
    layout.appendChild(grid);
    layout.appendChild(this.itemDetail(filtered));
    this.element.appendChild(layout);
    const footer = h('div', 'ui-stats');
    footer.append(
      statLine('Stacks', String(state.player.inventory.length)),
      statLine('Money', formatMoney(state.player.money)),
      statLine('Ash', state.player.cigarette.ashAccumulated.toFixed(1)),
      statLine('Buffs', String(state.player.statusEffects.length))
    );
    this.element.appendChild(footer);
  }

  private itemDetail(filtered: readonly InventoryEntry[]): HTMLElement {
    const detail = h('div', 'ui-item-detail');
    let entry = filtered.find((candidate) => candidate.instanceId === this.selectedInstanceId);
    if (!entry) {
      const first = filtered[0];
      if (first) {
        this.selectedInstanceId = first.instanceId;
        entry = first;
      }
    }
    if (!entry) {
      detail.appendChild(empty('Select an item to see what it is for.'));
      return detail;
    }
    const def = this.ctx.content.getItem(entry.itemId);
    const head = h('div', 'ui-item-detail-head');
    const icon = h('div', 'ui-item-detail-icon', itemIcon(def));
    if (def) icon.style.color = def.visual.color;
    const titleWrap = h('div', 'ui-grow');
    titleWrap.appendChild(h('div', 'ui-item-detail-title', def?.name ?? entry.itemId));
    titleWrap.appendChild(h('div', 'ui-card-sub', itemCategoryLabel(def?.category ?? 'misc') + ' · ' + qualityStars(entry.quality as QualityStars)));
    if (def) titleWrap.appendChild(h('div', 'ui-card-sub', 'value ' + formatMoney(def.basePrice) + (def.rarity ? ' · rarity ' + qualityStars(def.rarity) : '')));
    head.append(icon, titleWrap);
    detail.appendChild(head);
    if (def) detail.appendChild(h('div', 'ui-card-text', def.description));

    const stats = h('div', 'ui-stack');
    stats.appendChild(row2('Quantity', String(entry.quantity)));
    stats.appendChild(row2('Quality', qualityStars(entry.quality as QualityStars)));
    if (def?.hasQuality || entry.freshness < 1) {
      const freshness = freshnessLabel(entry.freshness);
      const freshnessRow = h('div', 'ui-row');
      freshnessRow.appendChild(span('ui-row-label', 'Freshness'));
      freshnessRow.appendChild(bar(entry.freshness, 1, freshness.kind === 'ok' ? 'ok' : freshness.kind === 'warn' ? 'warn' : 'bad'));
      freshnessRow.appendChild(span('ui-row-value', Math.round(entry.freshness * 100) + '% ' + freshness.text));
      stats.appendChild(freshnessRow);
    }
    if (def?.equipmentSlot) stats.appendChild(row2('Slot', equipmentSlotLabel(def.equipmentSlot)));
    const protection = equipmentProtectionText(def);
    if (protection) stats.appendChild(row2('Protection', protection));
    if (def?.toolSkill) stats.appendChild(row2('Tool', def.toolSkill + ' tier ' + (def.toolTier ?? 1)));
    if (def?.seedCropId) stats.appendChild(row2('Plants', this.ctx.content.getCrop(def.seedCropId)?.name ?? def.seedCropId));
    if (def?.fishId) {
      const fish = this.ctx.content.getFish(def.fishId);
      if (fish) stats.appendChild(row2('Fish', fish.name + ' · ' + fish.minSizeCm + '-' + fish.maxSizeCm + 'cm'));
    }
    if (def?.source) stats.appendChild(row2('Usually found', def.source));
    for (const effect of def?.effects ?? []) stats.appendChild(row2('Effect', describeItemEffect(effect)));
    if (def?.readSkill) stats.appendChild(row2('Reading raises', def.readSkill));
    if (def?.unlocksRecipes && def.unlocksRecipes.length > 0) {
      stats.appendChild(row2('Unlocks', def.unlocksRecipes.map((id) => this.ctx.content.getRecipe(id)?.name ?? id).join(', ')));
    }
    detail.appendChild(stats);

    const actions = h('div', 'ui-detail-actions');
    const kinds = itemActionKinds(def);
    const equippedIn = Object.entries(this.state.player.equipment).find(([, instanceId]) => instanceId === entry?.instanceId);
    if (equippedIn) {
      actions.appendChild(badge('equipped: ' + equipmentSlotLabel(equippedIn[0] as (typeof EQUIPMENT_SLOTS)[number]), 'ok'));
      actions.appendChild(
        button('Unequip', () => {
          this.ctx.dispatch({ type: 'inventory:unequip', slot: equippedIn[0] as (typeof EQUIPMENT_SLOTS)[number] });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
    } else if (kinds.canEquip) {
      actions.appendChild(
        button('Equip', () => {
          this.ctx.dispatch({ type: 'inventory:equip', instanceId: entry!.instanceId });
          this.refresh();
        }, { className: 'ui-button-small ui-button-primary' })
      );
    }
    if (kinds.canUse) {
      actions.appendChild(
        button(kinds.isFood ? 'Eat / use' : 'Use', () => {
          this.ctx.dispatch({ type: 'inventory:use', instanceId: entry!.instanceId });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
    }
    if (kinds.canRead) {
      actions.appendChild(
        button('Read', () => {
          this.ctx.dispatch({ type: 'inventory:read-book', instanceId: entry!.instanceId });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
    }
    if (def?.seedCropId) {
      actions.appendChild(badge('plant at a farm plot', 'neutral'));
    }
    detail.appendChild(actions);

    const dropRow = h('div', 'ui-inline');
    dropRow.appendChild(span('ui-row-label', 'Drop'));
    const qtyInput = h('input', 'ui-input ui-qty-stepper');
    qtyInput.type = 'number';
    qtyInput.min = '1';
    qtyInput.max = String(entry.quantity);
    qtyInput.value = String(Math.min(this.dropQuantity, entry.quantity));
    qtyInput.style.width = '56px';
    qtyInput.addEventListener('change', () => {
      const parsed = Number(qtyInput.value);
      this.dropQuantity = Number.isFinite(parsed) ? Math.max(1, Math.min(entry!.quantity, Math.round(parsed))) : 1;
      qtyInput.value = String(this.dropQuantity);
    });
    dropRow.appendChild(qtyInput);
    dropRow.appendChild(
      button('Drop', () => {
        this.ctx.dispatch({ type: 'inventory:drop', instanceId: entry!.instanceId, quantity: this.dropQuantity });
        this.refresh();
      }, { className: 'ui-button-small ui-button-danger' })
    );
    detail.appendChild(dropRow);
    return detail;
  }

  // -------------------------------------------------------------------------
  // Equipment
  // -------------------------------------------------------------------------
  private renderEquipment(): void {
    const equipment = section('Worn protection', 'each slot shields a different way');
    const grid = h('div', 'ui-equipment-grid');
    for (const slot of EQUIPMENT_SLOTS) {
      const instanceId = this.state.player.equipment[slot];
      const entry = instanceId ? this.state.player.inventory.find((candidate) => candidate.instanceId === instanceId) : undefined;
      const def = entry ? this.ctx.content.getItem(entry.itemId) : undefined;
      const cell = h('div', 'ui-equipment-slot' + (def ? ' filled' : ''));
      cell.appendChild(h('div', 'ui-equipment-slot-label', equipmentSlotLabel(slot)));
      cell.appendChild(h('div', 'ui-equipment-slot-value', def ? itemIcon(def) + ' ' + def.name : '— empty —'));
      const protection = equipmentProtectionText(def);
      if (protection) cell.appendChild(h('div', 'ui-card-sub', protection));
      if (entry) {
        cell.appendChild(
          button('Remove', () => {
            this.ctx.dispatch({ type: 'inventory:unequip', slot });
            this.refresh();
          }, { className: 'ui-button-small' })
        );
      }
      grid.appendChild(cell);
    }
    equipment.body.appendChild(grid);
    this.element.appendChild(equipment.element);

    const equipable = this.state.player.inventory.filter((entry) => this.ctx.content.getItem(entry.itemId)?.equipmentSlot);
    const available = section('Equipment in your bag', equipable.length + ' items');
    if (equipable.length === 0) available.body.appendChild(empty('No equipment carried. Craft protection gear or visit the shops.'));
    for (const entry of equipable) {
      const def = this.ctx.content.getItem(entry.itemId);
      if (!def?.equipmentSlot) continue;
      const line = h('div', 'ui-furniture-row');
      line.appendChild(span('ui-grow', itemIcon(def) + ' ' + def.name + ' (' + equipmentSlotLabel(def.equipmentSlot) + ')'));
      line.appendChild(span('ui-muted', equipmentProtectionText(def)));
      if (this.state.player.equipment[def.equipmentSlot] === entry.instanceId) line.appendChild(badge('worn', 'ok'));
      else {
        line.appendChild(
          button('Equip', () => {
            this.ctx.dispatch({ type: 'inventory:equip', instanceId: entry.instanceId });
            this.refresh();
          }, { className: 'ui-button-small' })
        );
      }
      available.body.appendChild(line);
    }
    this.element.appendChild(available.element);

    const statusEffects = section('Active effects', String(this.state.player.statusEffects.length));
    if (this.state.player.statusEffects.length === 0) statusEffects.body.appendChild(empty('No active effects.'));
    for (const effect of this.state.player.statusEffects) {
      const remaining = effect.expiresAt === null ? 'ongoing' : formatDurationClock(Math.max(0, effect.expiresAt - this.state.clock.simTimeSeconds));
      statusEffects.body.appendChild(row2(effect.label, remaining));
    }
    this.element.appendChild(statusEffects.element);
  }

  // -------------------------------------------------------------------------
  // Crafting
  // -------------------------------------------------------------------------
  private knowledge(): RecipeKnowledge {
    return {
      playerKnown: this.state.player.knownRecipes,
      cookingKnown: this.state.cooking.knownRecipes,
    };
  }

  private stationAvailability(): Record<string, boolean> {
    try {
      return craftingExtras(this.ctx.api).getStationAvailability();
    } catch {
      return { none: true };
    }
  }

  private renderCraft(): void {
    const stationMap = this.stationAvailability();
    const stations = section('Workstations here', 'materials must be to hand');
    const chips = h('div', 'ui-inline');
    const stationIds = ['workbench', 'kitchen', 'campfire', 'forge', 'art_studio'];
    for (const station of stationIds) {
      chips.appendChild(badge(station.replaceAll('_', ' '), stationMap[station] ? 'ok' : 'bad'));
    }
    stations.body.appendChild(chips);
    stations.body.appendChild(h('div', 'ui-card-sub', 'Crafting stations are found in the world: workbenches in homes and workshops, forges in town, kitchens at home.'));
    this.element.appendChild(stations.element);

    const filterRow = h('div', 'ui-filter-row');
    filterRow.appendChild(
      button('All recipes', () => {
        this.craftStation = 'all';
        this.rerender();
      }, { className: 'ui-filter-chip' + (this.craftStation === 'all' ? ' active' : '') })
    );
    for (const station of stationIds) {
      filterRow.appendChild(
        button(station.replaceAll('_', ' '), () => {
          this.craftStation = station;
          this.rerender();
        }, { className: 'ui-filter-chip' + (this.craftStation === station ? ' active' : '') })
      );
    }
    this.element.appendChild(filterRow);

    const recipes = this.ctx.content
      .getAllRecipes()
      .filter((recipe) => recipe.category === 'craft')
      .filter((recipe) => this.craftStation === 'all' || recipe.station === this.craftStation)
      .sort((a, b) => a.levelReq - b.levelReq || a.id.localeCompare(b.id));
    const list = section('Recipes', recipes.length + ' known patterns');
    let shown = 0;
    for (const recipe of recipes) {
      const availability = recipeAvailability({
        recipe,
        inventory: this.state.player.inventory,
        knowledge: this.knowledge(),
        skillLevel: this.state.player.skills[recipe.skill]?.level ?? 1,
        stationOk: stationMap[recipe.station] ?? recipe.station === 'none',
      });
      if (!availability.known) continue;
      if (this.craftStation === 'all' && availability.missing.length > 0 && !availability.levelOk) continue;
      shown += 1;
      list.body.appendChild(this.recipeCard(recipe, availability, 'craft'));
      if (shown >= 40) break;
    }
    if (shown === 0) list.body.appendChild(empty('No recipes match. Raise a skill or gather materials.'));
    this.element.appendChild(list.element);
    const jobs = this.state.crafting.jobs.filter((job) => job.completesAt > this.state.clock.simTimeSeconds);
    if (jobs.length > 0) {
      const active = section('Crafting now', jobs.length + ' jobs');
      for (const job of jobs) {
        const recipe = this.ctx.content.getRecipe(job.recipeId);
        const total = Math.max(1, job.completesAt - job.startedAt);
        const elapsed = Math.max(0, Math.min(total, this.state.clock.simTimeSeconds - job.startedAt));
        const line = h('div', 'ui-progress-row');
        line.appendChild(span('ui-progress-label', (recipe?.name ?? job.recipeId) + ' ×' + job.quantity));
        line.appendChild(bar(elapsed, total));
        line.appendChild(span('ui-progress-value', formatDurationClock(total - elapsed)));
        active.body.appendChild(line);
      }
      this.element.appendChild(active.element);
    }
  }

  private recipeCard(recipe: RecipeDef, availability: ReturnType<typeof recipeAvailability>, mode: 'craft' | 'cook'): HTMLElement {
    const card = h('div', 'ui-recipe' + (availability.canCraft ? '' : ' unavailable'));
    card.appendChild(h('div', 'ui-recipe-icon', itemIcon(this.ctx.content.getItem(recipe.outputs[0]?.itemId ?? ''))));
    const body = h('div', 'ui-recipe-body');
    const title = h('div', 'ui-recipe-title');
    title.append(document.createTextNode(recipe.name + ' '));
    title.appendChild(badge(recipe.station.replaceAll('_', ' '), availability.stationOk ? 'ok' : 'bad'));
    title.appendChild(badge(recipe.skill + ' Lv ' + recipe.levelReq, availability.levelOk ? 'ok' : 'bad'));
    if (recipe.hours > 0) title.appendChild(h('small', '', recipe.hours + 'h'));
    body.appendChild(title);
    body.appendChild(h('div', 'ui-card-sub', recipe.description));
    const inputs = h('div', 'ui-recipe-inputs');
    for (const input of recipe.inputs) {
      const have = countItem(this.state.player.inventory, input.itemId);
      const ok = have >= input.quantity;
      inputs.appendChild(
        h('span', 'ui-ingredient ' + (ok ? 'have' : 'missing'), this.ctx.content.resolveItemName(input.itemId) + ' ' + have + '/' + input.quantity)
      );
    }
    body.appendChild(inputs);
    const outputs = h('div', 'ui-card-sub');
    outputs.textContent =
      'makes ' + recipe.outputs.map((output) => this.ctx.content.resolveItemName(output.itemId) + ' ×' + output.quantity).join(', ');
    body.appendChild(outputs);
    const actions = h('div', 'ui-recipe-actions');
    const max = mode === 'craft' ? Math.max(1, availability.maxQuantity) : 1;
    let quantity = Math.max(1, Math.min(this.quantities.get(recipe.id) ?? 1, max));
    const input = h('input', 'ui-input');
    input.type = 'number';
    input.min = '1';
    input.max = String(max);
    input.value = String(quantity);
    input.style.width = '54px';
    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      quantity = Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.round(parsed))) : 1;
      this.quantities.set(recipe.id, quantity);
      input.value = String(quantity);
    });
    if (mode === 'craft') {
      actions.appendChild(input);
      actions.appendChild(
        button('Craft', () => {
          this.ctx.dispatch({ type: 'craft', recipeId: recipe.id, quantity: this.quantities.get(recipe.id) ?? quantity });
          this.refresh();
        }, { className: 'ui-button-small ui-button-primary', disabled: !availability.canCraft, tooltip: availability.canCraft ? 'Craft' : 'Missing materials or station.' })
      );
    } else {
      actions.appendChild(
        button('Cook', () => {
          this.ctx.dispatch({ type: 'cook', recipeId: recipe.id });
          this.refresh();
        }, { className: 'ui-button-small ui-button-primary', disabled: !availability.canCraft, tooltip: availability.canCraft ? 'Cook' : 'Missing materials or kitchen.' })
      );
    }
    if (availability.missing.length > 0) {
      actions.appendChild(span('ui-bad', 'missing ' + availability.missing.map((item) => this.ctx.content.resolveItemName(item.itemId)).join(', ')));
    } else if (!availability.stationOk) {
      actions.appendChild(span('ui-warn', 'needs a ' + recipe.station.replaceAll('_', ' ')));
    } else if (!availability.levelOk) {
      actions.appendChild(span('ui-warn', 'needs ' + recipe.skill + ' level ' + recipe.levelReq));
    }
    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  private renderCook(): void {
    let cookable: RecipeDef[] = [];
    let known: RecipeDef[] = [];
    try {
      const cooking = cookingExtras(this.ctx.api);
      cookable = cooking.getCookableRecipes();
      known = this.ctx.api.getSystems().cooking.getKnownRecipes();
    } catch {
      known = [];
    }
    const cookableIds = new Set(cookable.map((recipe) => recipe.id));
    const intro = section('Kitchen', known.length + ' known recipes');
    intro.body.appendChild(
      h('div', 'ui-card-text', 'Cooking needs a kitchen or a campfire. Dishes grant temporary buffs and restore the body; some also raise your Cooking skill.')
    );
    if (cookableIds.size > 0) {
      const chips = h('div', 'ui-inline');
      for (const recipe of cookable) chips.appendChild(badge(recipe.name, 'ok'));
      intro.body.appendChild(chips);
    }
    this.element.appendChild(intro.element);
    const list = section('Cookbook');
    for (const recipe of known) {
      const availability = recipeAvailability({
        recipe,
        inventory: this.state.player.inventory,
        knowledge: this.knowledge(),
        skillLevel: this.state.player.skills.cooking?.level ?? 1,
        stationOk: cookableIds.has(recipe.id) || recipe.station === 'none',
      });
      list.body.appendChild(this.recipeCard(recipe, availability, 'cook'));
    }
    if (known.length === 0) list.body.appendChild(empty('No cooking recipes known yet. Books and practice unlock them.'));
    this.element.appendChild(list.element);
    const buffs = section('Active food buffs', String(this.state.cooking.buffs.length));
    if (this.state.cooking.buffs.length === 0) buffs.body.appendChild(empty('No food buffs active.'));
    for (const buff of this.state.cooking.buffs) {
      const remaining = buff.expiresAt === null ? 'ongoing' : formatDurationClock(Math.max(0, buff.expiresAt - this.state.clock.simTimeSeconds));
      buffs.body.appendChild(row2(buff.label, remaining));
    }
    this.element.appendChild(buffs.element);
    void quantityFraction;
    void setWidthPercent;
  }
}

function row2(label: string, value: string): HTMLElement {
  const row = h('div', 'ui-row');
  row.appendChild(span('ui-row-label', label));
  row.appendChild(span('ui-row-value', value));
  return row;
}

function statLine(label: string, value: string): HTMLElement {
  const tile = h('div', 'ui-stat');
  tile.appendChild(span('ui-stat-label', label));
  tile.appendChild(span('ui-stat-value', value));
  return tile;
}
