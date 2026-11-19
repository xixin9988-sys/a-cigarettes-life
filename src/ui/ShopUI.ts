// =============================================================================
// Shop panel: buy / sell / player business management / jobs.
// =============================================================================
import type { BusinessState, GameState, JobState } from '../core/contracts';
import { formatMoney, qualityStars } from '../core/format';
import { itemIcon, locationName, gameTimeText } from './model';
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
  economyExtras,
  type UiContext,
} from './widgets';

type ShopTab = 'buy' | 'sell' | 'business' | 'work';

interface StockRow {
  itemId: string;
  quantity: number;
  price: number;
  demandIndex: number;
}

export class ShopPanel extends PanelBase {
  private tab: ShopTab = 'buy';
  private selectedBusinessId: string | null = null;
  private selectedItemId: string | null = null;
  private quantity = 1;

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
  }

  protected signature(state: Readonly<GameState>): string {
    return this.sig(
      this.tab,
      this.selectedBusinessId,
      this.selectedItemId,
      this.quantity,
      state.player.position.locationId,
      state.player.money,
      state.player.inventory.map((entry) => [entry.instanceId, entry.itemId, entry.quantity]),
      state.economy.businesses,
      state.economy.playerShop,
      state.economy.jobs,
      state.economy.transactions.length
    );
  }

  private localBusinesses(): BusinessState[] {
    try {
      return this.ctx.api.getSystems().economy.getBusinessesAtLocation(this.state.player.position.locationId);
    } catch {
      return [];
    }
  }

  private selectedBusiness(): BusinessState | null {
    const local = this.localBusinesses();
    if (this.selectedBusinessId) {
      const found = local.find((business) => business.id === this.selectedBusinessId);
      if (found) return found;
    }
    return local[0] ?? null;
  }

  protected render(): void {
    this.element.replaceChildren();
    const playerShop = this.state.economy.playerShop;
    this.element.appendChild(
      tabs(
        [
          { id: 'buy', label: 'Buy', icon: '🛒' },
          { id: 'sell', label: 'Sell', icon: '💰' },
          { id: 'business', label: playerShop ? 'My business' : 'Own a shop', icon: '🏪' },
          { id: 'work', label: 'Work', icon: '💼' },
        ],
        this.tab,
        (id) => {
          this.tab = id as ShopTab;
          this.rerender();
        }
      )
    );
    const locals = this.localBusinesses();
    const selector = h('div', 'ui-tabs');
    if (locals.length === 0) selector.appendChild(span('ui-muted', 'No shops at this location.'));
    for (const business of locals) {
      const open = this.isOpen(business);
      selector.appendChild(
        button((open ? '🟢 ' : '🔴 ') + business.name, () => {
          this.selectedBusinessId = business.id;
          this.selectedItemId = null;
          this.quantity = 1;
          this.rerender();
        }, { className: 'ui-tab' + (this.selectedBusiness()?.id === business.id ? ' ui-tab-active' : ''), pressed: this.selectedBusiness()?.id === business.id })
      );
    }
    this.element.appendChild(selector);
    if (this.tab === 'buy') this.renderBuy();
    else if (this.tab === 'sell') this.renderSell();
    else if (this.tab === 'business') this.renderBusiness();
    else this.renderWork();
  }

  private isOpen(business: BusinessState): boolean {
    try {
      return economyExtras(this.ctx.api).isBusinessOpen(business.id);
    } catch {
      return business.isOpen;
    }
  }

  private renderBuy(): void {
    const business = this.selectedBusiness();
    if (!business) {
      this.element.appendChild(empty('There is no shop here. Look at the map (M) for shops in Willowbrook or Ashford.'));
      this.element.appendChild(button('Open the map', () => this.ctx.openPanel('map'), { className: 'ui-button-small' }));
      return;
    }
    const stock: StockRow[] = business.stock.filter((entry) => entry.quantity > 0);
    const layout = h('div', 'ui-shop-layout');
    const stockSection = section(business.name, stock.length + ' lines in stock');
    if (!this.isOpen(business)) stockSection.body.appendChild(badge('closed — prices are shown, sales are not', 'warn'));
    const stockList = h('div', 'ui-stack');
    for (const entry of stock) {
      const def = this.ctx.content.getItem(entry.itemId);
      const row = button('', () => {
        this.selectedItemId = entry.itemId;
        this.quantity = 1;
        this.rerender();
      }, { className: 'ui-shop-row' + (this.selectedItemId === entry.itemId ? ' selected' : '') });
      row.appendChild(span('', itemIcon(def) + ' ' + (def?.name ?? entry.itemId)));
      row.appendChild(span('ui-shop-stock', 'x' + entry.quantity));
      row.appendChild(span('ui-shop-price', formatMoney(entry.price)));
      row.appendChild(span('ui-muted', 'demand ' + entry.demandIndex.toFixed(2)));
      stockList.appendChild(row);
    }
    if (stock.length === 0) stockList.appendChild(empty('The shelves are empty.'));
    stockSection.body.appendChild(stockList);
    layout.appendChild(stockSection.element);
    layout.appendChild(this.purchaseDetail(business, stock));
    this.element.appendChild(layout);
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Your money', formatMoney(this.state.player.money)),
      statTile('Shop reputation', Math.round(business.reputation).toString()),
      statTile('Daily customers', String(business.dailyCustomers)),
      statTile('Shop markup', 'x' + business.priceMarkup.toFixed(2))
    );
    this.element.appendChild(stats);
  }

  private purchaseDetail(business: BusinessState, stock: StockRow[]): HTMLElement {
    const detail = h('div', 'ui-item-detail');
    let selected = stock.find((entry) => entry.itemId === this.selectedItemId);
    if (!selected) {
      const first = stock[0];
      if (first) {
        this.selectedItemId = first.itemId;
        selected = first;
      }
    }
    if (!selected) {
      detail.appendChild(empty('Pick a line to buy.'));
      return detail;
    }
    const def = this.ctx.content.getItem(selected.itemId);
    const head = h('div', 'ui-item-detail-head');
    head.appendChild(h('div', 'ui-item-detail-icon', itemIcon(def)));
    const title = h('div', 'ui-grow');
    title.appendChild(h('div', 'ui-item-detail-title', def?.name ?? selected.itemId));
    title.appendChild(h('div', 'ui-card-sub', 'unit ' + formatMoney(selected.price) + ' · ' + selected.quantity + ' in stock'));
    head.appendChild(title);
    detail.appendChild(head);
    if (def) {
      detail.appendChild(h('div', 'ui-card-text', def.description));
      detail.appendChild(h('div', 'ui-card-sub', 'category ' + def.category + ' · base ' + formatMoney(def.basePrice)));
    }
    const qtyRow = h('div', 'ui-inline');
    qtyRow.appendChild(span('ui-row-label', 'Quantity'));
    const qty = h('input', 'ui-input');
    qty.type = 'number';
    qty.min = '1';
    qty.max = String(Math.max(1, selected.quantity));
    qty.value = String(Math.min(this.quantity, Math.max(1, selected.quantity)));
    qty.style.width = '62px';
    qty.addEventListener('change', () => {
      const parsed = Number(qty.value);
      this.quantity = Number.isFinite(parsed) ? Math.max(1, Math.min(selected!.quantity, Math.round(parsed))) : 1;
      qty.value = String(this.quantity);
    });
    qtyRow.appendChild(qty);
    qtyRow.appendChild(button('1', () => { this.quantity = 1; this.rerender(); }, { className: 'ui-button-small' }));
    qtyRow.appendChild(button('5', () => { this.quantity = Math.min(5, selected!.quantity); this.rerender(); }, { className: 'ui-button-small' }));
    qtyRow.appendChild(button('Max', () => { this.quantity = selected!.quantity; this.rerender(); }, { className: 'ui-button-small' }));
    detail.appendChild(qtyRow);
    const effectiveQty = Math.min(this.quantity, selected.quantity);
    const total = effectiveQty * selected.price;
    detail.appendChild(h('div', 'ui-shop-total', 'Total ' + formatMoney(total) + ' · you carry ' + formatMoney(this.state.player.money)));
    detail.appendChild(
      button('Buy ' + effectiveQty, () => {
        this.ctx.dispatch({ type: 'shop:buy', businessId: business.id, itemId: selected!.itemId, quantity: effectiveQty });
        this.refresh();
      }, {
        className: 'ui-button-primary',
        disabled: this.state.player.money < total || effectiveQty <= 0,
        tooltip: this.state.player.money < total ? 'Not enough money.' : 'Buy these items.',
      })
    );
    return detail;
  }

  private renderSell(): void {
    const business = this.selectedBusiness();
    if (!business) {
      this.element.appendChild(empty('No shop here to sell to.'));
      return;
    }
    const inventory = this.state.player.inventory;
    const layout = h('div', 'ui-shop-layout');
    const listSection = section('Sell to ' + business.name, inventory.length + ' stacks');
    if (!this.isOpen(business)) listSection.body.appendChild(badge('closed', 'warn'));
    const rows = h('div', 'ui-stack');
    for (const entry of inventory) {
      const def = this.ctx.content.getItem(entry.itemId);
      const market = this.state.economy.market[entry.itemId];
      const row = button('', () => {
        this.selectedItemId = entry.itemId;
        this.rerender();
      }, { className: 'ui-shop-row' + (this.selectedItemId === entry.itemId ? ' selected' : '') });
      row.appendChild(span('', itemIcon(def) + ' ' + (def?.name ?? entry.itemId) + ' x' + entry.quantity));
      row.appendChild(span('ui-muted', qualityStars(entry.quality)));
      row.appendChild(span('ui-shop-price', market ? formatMoney(market.currentPrice) : '—'));
      rows.appendChild(row);
    }
    if (inventory.length === 0) rows.appendChild(empty('Your bag is empty.'));
    listSection.body.appendChild(rows);
    layout.appendChild(listSection.element);
    const detail = h('div', 'ui-item-detail');
    const entry = inventory.find((candidate) => candidate.itemId === this.selectedItemId);
    if (!entry) {
      detail.appendChild(empty('Pick an item from your bag to see the reference price.'));
      layout.appendChild(detail);
      this.element.appendChild(layout);
      return;
    }
    const def = this.ctx.content.getItem(entry.itemId);
    const market = this.state.economy.market[entry.itemId];
    detail.appendChild(h('div', 'ui-item-detail-title', itemIcon(def) + ' ' + (def?.name ?? entry.itemId)));
    detail.appendChild(
      h('div', 'ui-card-sub', 'quality ' + qualityStars(entry.quality) + ' · freshness ' + Math.round(entry.freshness * 100) + '% · qty ' + entry.quantity)
    );
    detail.appendChild(h('div', 'ui-card-text', def?.description ?? ''));
    detail.appendChild(h('div', 'ui-card-sub', 'market reference ' + (market ? formatMoney(market.currentPrice) : 'unknown') + ' · the shop pays its own rate'));
    const qtyRow = h('div', 'ui-inline');
    qtyRow.appendChild(span('ui-row-label', 'Quantity'));
    const qty = h('input', 'ui-input');
    qty.type = 'number';
    qty.min = '1';
    qty.max = String(entry.quantity);
    qty.value = String(Math.min(this.quantity, entry.quantity));
    qty.style.width = '62px';
    qty.addEventListener('change', () => {
      const parsed = Number(qty.value);
      this.quantity = Number.isFinite(parsed) ? Math.max(1, Math.min(entry.quantity, Math.round(parsed))) : 1;
      qty.value = String(this.quantity);
    });
    qtyRow.appendChild(qty);
    detail.appendChild(qtyRow);
    detail.appendChild(
      button('Sell ' + Math.min(this.quantity, entry.quantity), () => {
        this.ctx.dispatch({
          type: 'shop:sell',
          businessId: business.id,
          itemId: entry.itemId,
          quantity: Math.min(this.quantity, entry.quantity),
          instanceId: entry.instanceId,
        });
        this.refresh();
      }, { className: 'ui-button-primary', disabled: !this.isOpen(business), tooltip: this.isOpen(business) ? 'Sell these items.' : 'The shop is closed.' })
    );
    layout.appendChild(detail);
    this.element.appendChild(layout);
    const recent = section('Recent transactions');
    const transactions = this.ctx.api.getSystems().economy.getRecentTransactions(8);
    if (transactions.length === 0) recent.body.appendChild(empty('No transactions yet.'));
    for (const transaction of [...transactions].reverse()) {
      recent.body.appendChild(
        h(
          'div',
          'ui-list-item',
          transaction.type + ' ' + (transaction.itemId ? this.ctx.content.resolveItemName(transaction.itemId) + ' x' + transaction.quantity : '') + ' · ' + formatMoney(transaction.totalPrice) + ' · ' + gameTimeText(transaction.at)
        )
      );
    }
    this.element.appendChild(recent.element);
  }

  private renderBusiness(): void {
    const playerShop = this.state.economy.playerShop;
    if (!playerShop) {
      this.renderOwnershipOptions();
      return;
    }
    const business = this.state.economy.businesses[playerShop.businessId];
    const overview = section(playerShop.name, playerShop.open ? 'open' : 'closed');
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Reputation', Math.round(playerShop.reputation).toString()),
      statTile('Total revenue', formatMoney(playerShop.totalRevenue)),
      statTile('Total expenses', formatMoney(playerShop.totalExpenses)),
      statTile('Employees', String(playerShop.employees.length) + ' / 3'),
      statTile('Location', locationName(this.ctx.content, playerShop.locationId)),
      statTile('Your money', formatMoney(this.state.player.money))
    );
    overview.body.appendChild(stats);
    const toggleRow = h('div', 'ui-detail-actions');
    toggleRow.appendChild(
      button(playerShop.open ? 'Close the shop' : 'Open the shop', () => {
        this.ctx.dispatch({ type: 'shop:open', open: !playerShop.open });
        this.refresh();
      }, { className: 'ui-button-small' })
    );
    toggleRow.appendChild(
      button('Save now', () => {
        this.ctx.dispatch({ type: 'save' });
      }, { className: 'ui-button-small' })
    );
    overview.body.appendChild(toggleRow);
    this.element.appendChild(overview.element);
    if (business) {
      this.element.appendChild(this.renderPricing(business));
      this.element.appendChild(this.renderEmployees(business));
      this.element.appendChild(this.renderDailyReport(business));
    }
    const restock = section('Wholesale restock', 'the shop floats a small reserve');
    const rows = h('div', 'ui-stack');
    const stock = business?.stock ?? [];
    for (const entry of stock.slice(0, 16)) {
      const def = this.ctx.content.getItem(entry.itemId);
      const row = h('div', 'ui-owner-row');
      row.appendChild(span('grow', itemIcon(def) + ' ' + (def?.name ?? entry.itemId) + ' · stock ' + entry.quantity + ' · price ' + formatMoney(entry.price)));
      const qty = h('input', 'ui-input');
      qty.type = 'number';
      qty.min = '1';
      qty.value = '5';
      qty.style.width = '54px';
      row.appendChild(qty);
      row.appendChild(
        button('Restock', () => {
          const parsed = Number(qty.value);
          const amount = Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : 1;
          this.ctx.dispatch({ type: 'shop:restock', itemId: entry.itemId, quantity: amount });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
      rows.appendChild(row);
    }
    if (stock.length === 0) rows.appendChild(empty('No stock lines.'));
    restock.body.appendChild(rows);
    this.element.appendChild(restock.element);
  }

  private renderOwnershipOptions(): void {
    const locals = this.localBusinesses();
    const all = this.ctx.api.getSystems().economy.getBusinesses();
    const candidates = locals.length > 0 ? locals : all.slice(0, 3);
    const intro = section('Own a shop', 'a steady income, a lot of bookkeeping');
    intro.body.appendChild(
      h('div', 'ui-card-text', 'You can buy a business you are standing in, if it is for sale. Quotes come from the economy system: the price depends on the business type, stock and reputation.')
    );
    this.element.appendChild(intro.element);
    const list = section('Businesses to buy');
    for (const business of candidates) {
      let quote: { purchasable: boolean; pricePence: number; reason: string } | null = null;
      try {
        quote = economyExtras(this.ctx.api).getPlayerShopQuote(business.id);
      } catch {
        quote = null;
      }
      const card = h('div', 'ui-buy-card');
      card.appendChild(h('div', 'ui-card-title', business.name));
      card.appendChild(h('div', 'ui-card-sub', locationName(this.ctx.content, business.locationId) + ' · ' + business.type));
      if (quote) {
        card.appendChild(h('div', 'ui-card-text', quote.reason));
        if (quote.purchasable) card.appendChild(h('div', 'ui-shop-total', 'Price ' + formatMoney(quote.pricePence)));
        card.appendChild(
          button('Buy this business', () => {
            this.ctx.dispatch({ type: 'shop:buy-business', businessId: business.id });
            this.refresh();
          }, {
            className: 'ui-button-small ui-button-primary',
            disabled: !quote.purchasable || this.state.player.money < quote.pricePence,
            tooltip: !quote.purchasable ? quote.reason : this.state.player.money < quote.pricePence ? 'Not enough money.' : 'Buy it.',
          })
        );
      } else {
        card.appendChild(empty('No quote available.'));
      }
      list.body.appendChild(card);
    }
    if (candidates.length === 0) list.body.appendChild(empty('No businesses exist.'));
    this.element.appendChild(list.element);
  }

  private renderPricing(business: BusinessState): HTMLElement {
    const pricing = section('Sticker prices', 'clamped to 40%-250% of base');
    for (const entry of business.stock.slice(0, 16)) {
      const def = this.ctx.content.getItem(entry.itemId);
      const row = h('div', 'ui-owner-row');
      row.appendChild(span('grow', itemIcon(def) + ' ' + (def?.name ?? entry.itemId) + ' · stock ' + entry.quantity));
      const input = h('input', 'ui-input');
      input.type = 'number';
      input.min = '1';
      input.value = String(entry.price);
      input.style.width = '74px';
      row.appendChild(input);
      row.appendChild(span('ui-muted', 'p'));
      row.appendChild(
        button('Set price', () => {
          const parsed = Number(input.value);
          const price = Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : entry.price;
          this.ctx.dispatch({ type: 'shop:price', itemId: entry.itemId, pricePence: price });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
      pricing.body.appendChild(row);
    }
    if (business.stock.length === 0) pricing.body.appendChild(empty('No stock to price.'));
    return pricing.element;
  }

  private renderEmployees(business: BusinessState): HTMLElement {
    const employees = section('Staff', business.employees.length + ' employed');
    const playerShop = this.state.economy.playerShop;
    for (const npcId of business.employees) {
      const npc = this.state.npcs[npcId];
      const line = h('div', 'ui-owner-row');
      line.appendChild(span('grow', (npc?.name ?? npcId) + ' · ' + (npc?.occupation ?? 'worker')));
      line.appendChild(
        button('Let go', () => {
          this.ctx.dispatch({ type: 'shop:fire', npcId });
          this.refresh();
        }, { className: 'ui-button-small ui-button-danger' })
      );
      employees.body.appendChild(line);
    }
    if (business.employees.length === 0) employees.body.appendChild(empty('Nobody works here yet.'));
    if (playerShop && playerShop.employees.length < 3) {
      const candidates = this.ctx.api.getSystems().npc.getNearbyNPCs().filter((npc) => !business.employees.includes(npc.id));
      if (candidates.length > 0) {
        const hireRow = h('div', 'ui-inline');
        for (const npc of candidates.slice(0, 5)) {
          hireRow.appendChild(
            button('Hire ' + npc.name, () => {
              this.ctx.dispatch({ type: 'shop:hire', npcId: npc.id });
              this.refresh();
            }, { className: 'ui-button-small' })
          );
        }
        employees.body.appendChild(hireRow);
      } else {
        employees.body.appendChild(h('div', 'ui-card-sub', 'Nobody nearby to hire. Meet more villagers first.'));
      }
    }
    return employees.element;
  }

  private renderDailyReport(business: BusinessState): HTMLElement {
    const report = section('Daily report', 'the last few days');
    const rows = business.history.slice(-7);
    if (rows.length === 0) report.body.appendChild(empty('No trading days recorded yet.'));
    for (const record of rows) {
      const profit = record.revenue - record.expenses;
      const line = h('div', 'ui-row');
      line.appendChild(span('ui-row-label', 'day ' + record.day + ' · ' + record.customers + ' customers'));
      line.appendChild(span('ui-row-value ' + (profit >= 0 ? 'ui-good' : 'ui-bad'), formatMoney(profit)));
      line.appendChild(span('ui-row-hint', 'rev ' + formatMoney(record.revenue) + ' · exp ' + formatMoney(record.expenses)));
      report.body.appendChild(line);
    }
    return report.element;
  }

  private renderWork(): void {
    const playerJob = this.currentJob();
    const jobs = this.jobsHere();
    const mine = section('Your job', playerJob ? playerJob.title : 'unemployed');
    if (playerJob) {
      mine.body.appendChild(h('div', 'ui-card-sub', formatMoney(playerJob.wagePerHour) + ' / hour · ' + (this.ctx.content.getBusiness(playerJob.businessId)?.name ?? playerJob.businessId)));
      const actions = h('div', 'ui-detail-actions');
      actions.appendChild(
        button('Work a shift', () => {
          this.ctx.dispatch({ type: 'work:shift' });
          this.refresh();
        }, { className: 'ui-button-small ui-button-primary' })
      );
      actions.appendChild(
        button('Quit', () => {
          this.ctx.dispatch({ type: 'work:quit' });
          this.refresh();
        }, { className: 'ui-button-small ui-button-danger' })
      );
      mine.body.appendChild(actions);
    } else {
      mine.body.appendChild(h('div', 'ui-card-text', 'No job. Businesses with open positions are listed below; apply where you stand.'));
    }
    this.element.appendChild(mine.element);
    const list = section('Open positions here', jobs.length + ' jobs');
    if (jobs.length === 0) list.body.appendChild(empty('No jobs at this location. Try the cafe, bakery, shops or the farm.'));
    for (const job of jobs) {
      const card = h('div', 'ui-buy-card');
      card.appendChild(h('div', 'ui-card-title', job.title));
      card.appendChild(
        h('div', 'ui-card-sub', formatMoney(job.wagePerHour) + '/hour · ' + String(job.startHour).padStart(2, '0') + ':00-' + String(job.endHour).padStart(2, '0') + ':00 · ' + job.slots + ' slots' + (job.skill ? ' · ' + job.skill + ' Lv ' + job.levelReq : ''))
      );
      card.appendChild(h('div', 'ui-card-sub', job.employeeIds.length + ' of ' + job.slots + ' filled · ' + (job.isPlayerJob ? 'your current job' : job.playerAvailable ? 'open to you' : 'not open to you')));
      if (!job.isPlayerJob) {
        card.appendChild(
          button('Apply', () => {
            this.ctx.dispatch({ type: 'work:apply', jobId: job.id });
            this.refresh();
          }, { className: 'ui-button-small', disabled: !job.playerAvailable, tooltip: job.playerAvailable ? 'Take this job.' : 'Not open to the player.' })
        );
      }
      list.body.appendChild(card);
    }
    this.element.appendChild(list.element);
    const transactions = section('Recent money movement');
    const recent = this.ctx.api.getSystems().economy.getRecentTransactions(10);
    if (recent.length === 0) transactions.body.appendChild(empty('No transactions recorded.'));
    for (const transaction of [...recent].reverse()) {
      const line = h('div', 'ui-row');
      line.appendChild(span('ui-row-label', transaction.type + ' · ' + transaction.note));
      line.appendChild(span('ui-row-value', formatMoney(transaction.totalPrice)));
      line.appendChild(span('ui-row-hint', gameTimeText(transaction.at)));
      transactions.body.appendChild(line);
    }
    this.element.appendChild(transactions.element);
  }

  private currentJob(): JobState | null {
    try {
      return economyExtras(this.ctx.api).getPlayerJob();
    } catch {
      return null;
    }
  }

  private jobsHere(): JobState[] {
    try {
      return this.ctx.api.getSystems().economy.getJobsAtLocation(this.state.player.position.locationId);
    } catch {
      return [];
    }
  }
}
