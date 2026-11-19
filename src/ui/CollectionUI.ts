// =============================================================================
// Collection / museum panel: category progress, catalogue and donations.
// =============================================================================
import type { GameState } from '../core/contracts';
import type { ItemDef } from '../data/schema';
import { qualityStars } from '../core/format';
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
  collectionExtras,
  type UiContext,
} from './widgets';
import { itemIcon } from './model';

type CollectionTab = 'progress' | 'catalogue';

interface CatalogEntry {
  def: ItemDef;
  categoryId: string;
  categoryName: string;
  known: boolean;
  count: number;
  bestQuality: number;
  donated: boolean;
}

export class CollectionPanel extends PanelBase {
  private tab: CollectionTab = 'progress';
  private category: string = 'all';

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
  }

  protected signature(state: Readonly<GameState>): string {
    return this.sig(
      this.tab,
      this.category,
      state.collection.entries,
      state.collection.donatedCount,
      state.collection.totalSpeciesKnown,
      state.player.inventory.map((entry) => [entry.itemId, entry.quantity])
    );
  }

  private buildCatalogue(): CatalogEntry[] {
    const entries: CatalogEntry[] = [];
    let catalog: ItemDef[] = [];
    try {
      catalog = collectionExtras(this.ctx.api).getCatalog();
    } catch {
      catalog = [];
    }
    if (catalog.length === 0) {
      const categories = this.ctx.content.pack.collectionCategories;
      const tagToCategory = new Map<string, { id: string; name: string }>();
      for (const category of categories) for (const tag of category.itemTags) tagToCategory.set(tag, category);
      for (const item of this.ctx.content.getAllItems()) {
        let matched: { id: string; name: string } | null = null;
        for (const tag of item.tags) {
          const category = tagToCategory.get(tag);
          if (category) {
            matched = category;
            break;
          }
        }
        if (matched) catalog.push(item);
      }
    }
    const categories = this.ctx.content.pack.collectionCategories;
    const tagToCategory = new Map<string, { id: string; name: string }>();
    for (const category of categories) for (const tag of category.itemTags) tagToCategory.set(tag, category);
    for (const def of catalog) {
      const category = tagToCategory.get(def.tags.find((tag) => tagToCategory.has(tag)) ?? '') ?? { id: 'misc', name: 'Curiosities' };
      const collectionEntry = this.state.collection.entries[def.id];
      entries.push({
        def,
        categoryId: category.id,
        categoryName: category.name,
        known: collectionEntry !== undefined,
        count: collectionEntry?.count ?? 0,
        bestQuality: collectionEntry?.bestQuality ?? 0,
        donated: collectionEntry?.donated ?? false,
      });
    }
    entries.sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.def.name.localeCompare(b.def.name));
    return entries;
  }

  protected render(): void {
    this.element.replaceChildren();
    this.element.appendChild(
      tabs(
        [
          { id: 'progress', label: 'Museum', icon: '🏛' },
          { id: 'catalogue', label: 'Catalogue', icon: '🗃' },
        ],
        this.tab,
        (id) => {
          this.tab = id as CollectionTab;
          this.rerender();
        }
      )
    );
    if (this.tab === 'progress') this.renderProgress();
    else this.renderCatalogue();
  }

  private renderProgress(): void {
    let progress = { known: 0, total: 0, donated: 0 };
    let categories: { id: string; name: string; known: number; total: number }[] = [];
    try {
      progress = this.ctx.api.getSystems().collection.getProgress();
      categories = collectionExtras(this.ctx.api).getCategoryProgress();
    } catch {
      progress = { known: 0, total: 0, donated: 0 };
    }
    const museum = section('The Ashford museum', 'every find has a label');
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Species known', progress.known + ' / ' + progress.total),
      statTile('Donated', String(progress.donated)),
      statTile('Completion', progress.total > 0 ? Math.round((progress.known / progress.total) * 100) + '%' : '0%'),
      statTile('Keeper influence', String(Math.round(this.state.player.influence)))
    );
    museum.body.appendChild(stats);
    if (categories.length > 0) {
      for (const category of categories) {
        const row = h('div', 'ui-progress-row');
        row.appendChild(span('ui-progress-label', category.name));
        row.appendChild(bar(category.known, Math.max(1, category.total), 'accent'));
        row.appendChild(span('ui-progress-value', category.known + '/' + category.total));
        museum.body.appendChild(row);
      }
    }
    this.element.appendChild(museum.element);

    const donate = section('Ready to donate', 'duplicates are welcome');
    const entries = Object.values(this.state.collection.entries).filter((entry) => !entry.donated);
    if (entries.length === 0) donate.body.appendChild(empty('Nothing un-donated in your collection yet. Fish, forage, grow and craft.'));
    for (const entry of entries.slice(0, 30)) {
      const def = this.ctx.content.getItem(entry.itemId);
      const line = h('div', 'ui-buy-card');
      const title = h('div', 'ui-card-title');
      title.append(document.createTextNode((def ? itemIcon(def) + ' ' + def.name : entry.itemId) + ' '));
      title.appendChild(badge('×' + entry.count, 'neutral'));
      title.appendChild(badge(qualityStars(entry.bestQuality as 1 | 2 | 3 | 4 | 5), 'accent'));
      line.appendChild(title);
      line.appendChild(
        button('Donate to museum', () => {
          this.ctx.dispatch({ type: 'collection:donate', itemId: entry.itemId });
          this.refresh();
        }, { className: 'ui-button-small ui-button-primary' })
      );
      donate.body.appendChild(line);
    }
    this.element.appendChild(donate.element);
  }

  private renderCatalogue(): void {
    const catalogue = this.buildCatalogue();
    const categories = this.ctx.content.pack.collectionCategories;
    const counts = new Map<string, { known: number; total: number }>();
    for (const entry of catalogue) {
      const bucket = counts.get(entry.categoryId) ?? { known: 0, total: 0 };
      bucket.total += 1;
      if (entry.known) bucket.known += 1;
      counts.set(entry.categoryId, bucket);
    }
    const nav = h('div', 'ui-tabs');
    nav.appendChild(
      button('All (' + catalogue.length + ')', () => {
        this.category = 'all';
        this.rerender();
      }, { className: 'ui-tab' + (this.category === 'all' ? ' ui-tab-active' : ''), pressed: this.category === 'all' })
    );
    for (const category of categories) {
      const count = counts.get(category.id);
      nav.appendChild(
        button(category.icon + ' ' + category.name + (count ? ' (' + count.known + '/' + count.total + ')' : ''), () => {
          this.category = category.id;
          this.rerender();
        }, { className: 'ui-tab' + (this.category === category.id ? ' ui-tab-active' : ''), pressed: this.category === category.id })
      );
    }
    this.element.appendChild(nav);

    const filtered = catalogue.filter((entry) => this.category === 'all' || entry.categoryId === this.category);
    const list = h('div', 'ui-stack');
    for (const entry of filtered) {
      const card = h('div', 'ui-buy-card');
      const head = h('div', 'ui-card-title');
      head.append(document.createTextNode(itemIcon(entry.def) + ' ' + entry.def.name + ' '));
      if (entry.known) {
        head.appendChild(badge('found' + (entry.count > 1 ? ' ×' + entry.count : ''), 'ok'));
        if (entry.bestQuality > 0) head.appendChild(badge(qualityStars(entry.bestQuality as 1 | 2 | 3 | 4 | 5), 'accent'));
        if (entry.donated) head.appendChild(badge('donated', 'neutral'));
      } else {
        head.appendChild(badge('not found', 'bad'));
      }
      card.appendChild(head);
      card.appendChild(h('div', 'ui-card-sub', entry.categoryName + ' · ' + entry.def.description));
      if (entry.known) {
        const owned = this.state.player.inventory.filter((inv) => inv.itemId === entry.def.id).reduce((sum, inv) => sum + inv.quantity, 0);
        card.appendChild(h('div', 'ui-card-sub', 'In your bag: ' + owned));
        if (!entry.donated) {
          card.appendChild(
            button('Donate', () => {
              this.ctx.dispatch({ type: 'collection:donate', itemId: entry.def.id });
              this.refresh();
            }, { className: 'ui-button-small' })
          );
        }
      }
      list.appendChild(card);
    }
    if (filtered.length === 0) list.appendChild(empty('This category has no catalogue entries.'));
    this.element.appendChild(list);
  }
}
