// =============================================================================
// Shared DOM building blocks and panel plumbing for the game UI.
// No external dependencies: every visual is DOM + inline CSS only.
// =============================================================================
import type {
  ActionResult,
  ArchivedLife,
  GameAction,
  GameState,
  IContentRegistry,
  IGameApi,
} from '../core/contracts';
import type { NotificationKind, PanelId } from './UIInterfaces';
import type { ItemDef, RecipeDef } from '../data/schema';
import type { CraftJobState, JobState, PlayerGoalState, StatusEffectState } from '../core/contracts';

// ---------------------------------------------------------------------------
// UI context supplied by UIManager to every panel
// ---------------------------------------------------------------------------
export interface UiContext {
  readonly api: IGameApi;
  readonly content: IContentRegistry;
  getState(): Readonly<GameState>;
  dispatch(action: GameAction): ActionResult;
  notify(message: string, kind?: NotificationKind): void;
  openPanel(id: PanelId): void;
  closePanel(id: PanelId): void;
  togglePanel(id: PanelId): void;
  isPanelOpen(id: PanelId): boolean;
  showSaveSlots(): void;
  showOfflineSummaryModal(): void;
  showLifeReview(archive: ArchivedLife): void;
  returnToMenu(): void;
}

// Narrow, UI-only views of extra public methods that systems expose beyond the frozen
// contracts (documented by their owners). Keeping them local avoids editing contracts.
export interface WorldUiExtras {
  getPathTo(locationId: string): string[] | null;
}

export interface EconomyUiExtras {
  getPlayerShopQuote(
    businessId: string
  ): { purchasable: boolean; pricePence: number; reason: string } | null;
  isBusinessOpen(businessId: string, atSimSeconds?: number): boolean;
  getPlayerJob(): JobState | null;
}

export interface CraftingUiExtras {
  getKnownRecipes(category: 'craft' | 'cook'): RecipeDef[];
  getStationAvailability(): Record<string, boolean>;
  hasStation(station: string): boolean;
  getActiveJobs(): CraftJobState[];
  getMastery(recipeId: string): number;
}

export interface CookingUiExtras {
  getCookableRecipes(): RecipeDef[];
  hasStation(station: 'kitchen' | 'campfire'): boolean;
  getActiveBuffs(): StatusEffectState[];
}

export interface CollectionUiExtras {
  getCategoryProgress(): { id: string; name: string; known: number; total: number }[];
  getCatalog(): ItemDef[];
  getEntries(): { itemId: string; firstCollectedAt: number; count: number; bestQuality: number; donated: boolean }[];
}

export interface LifeUiExtras {
  getPersonalGoal(): PlayerGoalState | null;
  getLegacyOptions(archive: ArchivedLife, state?: GameState): { itemId: string; name: string }[];
  getInfluenceSnapshot(): { tier: { id: string; label: string }; nextTier: { id: string; label: string } | null; progressToNext: number } | null;
  getRemainingGameHours(): number;
}

export interface SocialUiExtras {
  getSocialSummary(): {
    known: number;
    friends: number;
    closeFriends: number;
    romances: { npcId: string; partner: boolean }[];
    pendingInvitations: number;
    activeProjects: number;
    completedProjects: number;
    lastInteractionAt: number;
  };
}

export interface SkillUiExtras {
  getXpMultiplier(): number;
  getTotalLevels(): number;
  getProgressRatio(skill: string): number;
}

export function worldExtras(api: IGameApi): WorldUiExtras {
  return api.getSystems().world as unknown as WorldUiExtras;
}

export function economyExtras(api: IGameApi): EconomyUiExtras {
  return api.getSystems().economy as unknown as EconomyUiExtras;
}

export function craftingExtras(api: IGameApi): CraftingUiExtras {
  return api.getSystems().crafting as unknown as CraftingUiExtras;
}

export function cookingExtras(api: IGameApi): CookingUiExtras {
  return api.getSystems().cooking as unknown as CookingUiExtras;
}

export function collectionExtras(api: IGameApi): CollectionUiExtras {
  return api.getSystems().collection as unknown as CollectionUiExtras;
}

export function lifeExtras(api: IGameApi): LifeUiExtras {
  return api.getSystems().life as unknown as LifeUiExtras;
}

export function socialExtras(api: IGameApi): SocialUiExtras {
  return api.getSystems().social as unknown as SocialUiExtras;
}

export function skillExtras(api: IGameApi): SkillUiExtras {
  return api.getSystems().skill as unknown as SkillUiExtras;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  textContent?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

export function div(className?: string, textContent?: string): HTMLDivElement {
  return h('div', className, textContent);
}

export function span(className?: string, textContent?: string): HTMLSpanElement {
  return h('span', className, textContent);
}

export function append(parent: Node, ...children: (Node | string | null | undefined)[]): void {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === 'string') parent.appendChild(document.createTextNode(child));
    else parent.appendChild(child);
  }
}

export interface ButtonOptions {
  className?: string;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
  pressed?: boolean;
  /** Adds a tooltip that also works with keyboard focus. */
  tooltip?: string;
}

export function button(
  label: string | Node,
  onClick: (event: MouseEvent) => void,
  options: ButtonOptions = {}
): HTMLButtonElement {
  const node = h('button', 'ui-button');
  node.type = 'button';
  if (options.className) node.className = options.className;
  if (typeof label === 'string') node.textContent = label;
  else node.appendChild(label);
  const tooltip = options.tooltip ?? options.title;
  if (tooltip) {
    node.title = tooltip;
    node.setAttribute('data-tooltip', tooltip);
  }
  if (options.ariaLabel) node.setAttribute('aria-label', options.ariaLabel);
  if (options.pressed !== undefined) node.setAttribute('aria-pressed', options.pressed ? 'true' : 'false');
  if (options.disabled) {
    node.disabled = true;
    node.setAttribute('aria-disabled', 'true');
  } else {
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick(event);
    });
  }
  return node;
}

export function iconButton(symbol: string, ariaLabel: string, onClick: (event: MouseEvent) => void, className = 'ui-button ui-button-icon'): HTMLButtonElement {
  return button(symbol, onClick, { className, ariaLabel });
}

export function linkButton(label: string, onClick: () => void, className = 'ui-link'): HTMLButtonElement {
  return button(label, onClick, { className });
}

export function setText(node: HTMLElement | null, text: string): void {
  if (node && node.textContent !== text) node.textContent = text;
}

export function setWidthPercent(node: HTMLElement | null, percent: number): void {
  if (!node) return;
  const next = Math.max(0, Math.min(100, percent)) + '%';
  if (node.style.width !== next) node.style.width = next;
}

export function setClass(node: HTMLElement | null, className: string, active: boolean): void {
  if (!node) return;
  if (active) node.classList.add(className);
  else node.classList.remove(className);
}

export function empty(message: string): HTMLElement {
  return h('div', 'ui-empty', message);
}

export function section(title: string, hint?: string): { element: HTMLElement; body: HTMLElement } {
  const element = h('section', 'ui-section');
  const header = h('div', 'ui-section-header');
  header.appendChild(h('h3', 'ui-section-title', title));
  if (hint) header.appendChild(span('ui-section-hint', hint));
  element.appendChild(header);
  const body = h('div', 'ui-section-body');
  element.appendChild(body);
  return { element, body };
}

export function row(label: string, value: string, hint?: string): HTMLElement {
  const line = h('div', 'ui-row');
  line.appendChild(span('ui-row-label', label));
  if (hint) line.appendChild(span('ui-row-hint', hint));
  line.appendChild(span('ui-row-value', value));
  return line;
}

export function keyValue(key: string, value: string): HTMLElement {
  const line = h('div', 'ui-kv');
  line.appendChild(span('ui-kv-key', key));
  line.appendChild(span('ui-kv-value', value));
  return line;
}

export function statTile(label: string, value: string, hint?: string): HTMLElement {
  const tile = h('div', 'ui-stat');
  tile.appendChild(span('ui-stat-label', label));
  tile.appendChild(span('ui-stat-value', value));
  if (hint) tile.appendChild(span('ui-stat-hint', hint));
  return tile;
}

export function badge(text: string, kind: 'ok' | 'warn' | 'bad' | 'neutral' | 'accent' = 'neutral'): HTMLElement {
  return h('span', 'ui-badge ui-badge-' + kind, text);
}

export function chip(text: string, kind: 'ok' | 'warn' | 'bad' | 'neutral' | 'accent' = 'neutral'): HTMLElement {
  return h('span', 'ui-chip ui-chip-' + kind, text);
}

export function bar(value: number, max: number, kind: 'default' | 'warn' | 'bad' | 'ok' | 'accent' | 'muted' = 'default'): HTMLElement {
  const outer = h('div', 'ui-bar ui-bar-' + kind);
  const fill = h('div', 'ui-bar-fill');
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  fill.style.width = ratio * 100 + '%';
  outer.appendChild(fill);
  outer.setAttribute('role', 'progressbar');
  outer.setAttribute('aria-valuemin', '0');
  outer.setAttribute('aria-valuemax', String(Math.max(0, max)));
  outer.setAttribute('aria-valuenow', String(Math.max(0, value)));
  return outer;
}

export function labelledBar(label: string, value: number, max: number, valueText?: string, kind: 'default' | 'warn' | 'bad' | 'ok' | 'accent' | 'muted' = 'default'): HTMLElement {
  const wrap = h('div', 'ui-labelled-bar');
  const head = h('div', 'ui-labelled-bar-head');
  head.appendChild(span('ui-labelled-bar-label', label));
  head.appendChild(span('ui-labelled-bar-value', valueText ?? Math.round(value) + ' / ' + Math.round(max)));
  wrap.appendChild(head);
  wrap.appendChild(bar(value, max, kind));
  return wrap;
}

export function tabs(
  items: { id: string; label: string; count?: number; icon?: string }[],
  activeId: string,
  onSelect: (id: string) => void
): HTMLElement {
  const nav = h('nav', 'ui-tabs');
  nav.setAttribute('role', 'tablist');
  for (const item of items) {
    const node = button(
      (item.icon ? item.icon + ' ' : '') + item.label + (item.count !== undefined ? ' (' + item.count + ')' : ''),
      () => onSelect(item.id),
      {
        className: 'ui-tab' + (item.id === activeId ? ' ui-tab-active' : ''),
        pressed: item.id === activeId,
        ariaLabel: item.label,
      }
    );
    node.setAttribute('role', 'tab');
    node.setAttribute('aria-selected', item.id === activeId ? 'true' : 'false');
    nav.appendChild(node);
  }
  return nav;
}

export function grid(className = 'ui-grid'): HTMLElement {
  return h('div', className);
}

export function list(className = 'ui-list'): HTMLElement {
  return h('div', className);
}

export function listItem(text: string): HTMLElement {
  return h('div', 'ui-list-item', text);
}

export function progressRow(label: string, value: number, max: number, right?: string): HTMLElement {
  const line = h('div', 'ui-progress-row');
  line.appendChild(span('ui-progress-label', label));
  line.appendChild(bar(value, max));
  line.appendChild(span('ui-progress-value', right ?? Math.round(value) + '/' + Math.round(max)));
  return line;
}

export function tooltip(node: HTMLElement, text: string): HTMLElement {
  node.title = text;
  node.setAttribute('data-tooltip', text);
  return node;
}

export function ariaLabel(node: HTMLElement, label: string): HTMLElement {
  node.setAttribute('aria-label', label);
  return node;
}

export function scrollBox(className = 'ui-scroll'): HTMLElement {
  return h('div', className);
}

// ---------------------------------------------------------------------------
// Panel base class with cheap signature-based re-rendering
// ---------------------------------------------------------------------------
export interface PanelController {
  readonly element: HTMLElement;
  update(state: Readonly<GameState>, now: number): void;
  destroy(): void;
}

export abstract class PanelBase implements PanelController {
  readonly element: HTMLElement;
  protected state: Readonly<GameState>;
  protected readonly ctx: UiContext;
  private signatureValue: string | null = null;

  constructor(ctx: UiContext, state: Readonly<GameState>, className = 'ui-panel-body') {
    this.ctx = ctx;
    this.state = state;
    this.element = h('div', className);
  }

  update(state: Readonly<GameState>, now: number): void {
    this.state = state;
    const signature = this.signature(state);
    if (signature !== this.signatureValue) {
      this.signatureValue = signature;
      this.render();
    }
    this.tick(state, now);
  }

  /** Forces a re-render after a local (non-persistent) UI state change. */
  protected rerender(): void {
    this.render();
  }

  protected content(): IContentRegistry {
    return this.ctx.content;
  }

  protected dispatch(action: GameAction): ActionResult {
    return this.ctx.dispatch(action);
  }

  protected notify(message: string, kind?: NotificationKind): void {
    this.ctx.notify(message, kind);
  }

  protected refresh(): void {
    this.update(this.ctx.getState(), performance.now());
  }

  protected abstract signature(state: Readonly<GameState>): string;

  protected abstract render(): void;

  protected tick(_state: Readonly<GameState>, _now: number): void {}

  destroy(): void {}

  /** JSON signature helper so panels only rebuild when real data changed. */
  protected sig(...values: unknown[]): string {
    return JSON.stringify(values);
  }
}

/** Simple read-only panel used for placeholders that must still explain themselves. */
export class NoticePanel extends PanelBase {
  constructor(ctx: UiContext, state: Readonly<GameState>, private readonly message: string) {
    super(ctx, state);
  }

  protected signature(): string {
    return this.message;
  }

  protected render(): void {
    this.element.replaceChildren(empty(this.message));
  }
}

// ---------------------------------------------------------------------------
// Small deterministic formatting used by several panels
// ---------------------------------------------------------------------------
export function itemDisplayName(content: IContentRegistry, itemId: string): string {
  return content.getItem(itemId)?.name ?? itemId;
}

export function actionFailed(result: ActionResult): boolean {
  return !result.ok;
}

export function describeAction(result: ActionResult): string {
  return result.ok ? result.message : 'Failed: ' + result.message;
}

/** Toggle helper for sets stored in local UI state. */
export function toggleInSet<T>(set: Set<T>, value: T): void {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}
