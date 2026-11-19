// =============================================================================
// UIManager: owns the DOM UI tree (HUD, panels, modals, toasts, main menu),
// implements IUIManager, dispatches all gameplay actions and keeps panels in
// sync with the authoritative GameState. Mounted once into #ui-root.
// =============================================================================
import type {
  ActionResult,
  ArchivedLife,
  GameAction,
  GameState,
  IContentRegistry,
  IGameApi,
  NewGameOptions,
  OfflineSummary,
  SaveSlotMeta,
} from '../core/contracts';
import type { ISceneSession } from './UIInterfaces';
import type { IUIManager, NotificationKind, PanelId } from './UIInterfaces';
import { UI_STYLES } from './styles';
import { HudView } from './HUD';
import { getPanelDefinition, panelSizeClass, type PanelDefinition } from './Panels';
import { DialoguePanel } from './DialogueUI';
import { FishingPanel } from './FishingMiniGameUI';
import { resolveShortcuts, normaliseKeyName, type UiShortcutAction } from './model';
import {
  h,
  button,
  setClass,
  lifeExtras,
  type PanelController,
  type UiContext,
} from './widgets';
import {
  buildMainMenu,
  buildCharacterCreation,
  buildSaveSlots,
  buildOfflineSummary,
  buildLifeReview,
  toNewGameOptions,
  type CharacterOptions,
} from './screens';

const STYLE_ID = 'acg-ui-styles';

interface PanelEntry {
  definition: PanelDefinition;
  wrapper: HTMLElement;
  bodyHost: HTMLElement;
  controller: PanelController;
}

interface ModalAction {
  label: string;
  className?: string;
  onClick(): void;
}

const SHORTCUT_PANEL: Record<UiShortcutAction, PanelId> = {
  inventory: 'inventory',
  map: 'map',
  social: 'social',
  life: 'life',
  journal: 'journal',
  building: 'building',
  housing: 'housing',
  collection: 'collection',
  skills: 'skills',
  help: 'help',
  debugProbability: 'probability',
};

export class UIManager implements IUIManager {
  private api: IGameApi | null = null;
  private content: IContentRegistry | null = null;
  private root: HTMLElement | null = null;
  private hudView: HudView | null = null;
  private hudHost: HTMLElement | null = null;
  private panelLayer: HTMLElement | null = null;
  private notifyLayer: HTMLElement | null = null;
  private modalLayer: HTMLElement | null = null;
  private menuLayer: HTMLElement | null = null;
  private readonly panels = new Map<PanelId, PanelEntry>();
  private readonly openOrder: PanelId[] = [];
  private readonly toastTimers = new Set<number>();
  private keyboardHandler: ((event: KeyboardEvent) => void) | null = null;
  private keyboardUpHandler: ((event: KeyboardEvent) => void) | null = null;
  private blurHandler: (() => void) | null = null;
  private lastHudAt = 0;
  private lastPanelsAt = 0;
  private menuVisible = false;
  private offlineShown = false;
  private dialogueWasActive = false;
  private fishingWasActive = false;
  private mounted = false;
  private uiContext: UiContext | null = null;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  mount(root: HTMLElement, api: IGameApi): void {
    if (this.mounted) this.destroy();
    this.root = root;
    this.api = api;
    this.content = api.getContent();
    this.injectStyles();
    root.innerHTML = '';
    root.setAttribute('role', 'application');
    root.setAttribute('aria-label', "A Cigarette's Life interface");
    this.hudHost = h('div', 'ui-hud-host');
    this.panelLayer = h('div', 'ui-panel-layer');
    this.notifyLayer = h('div', 'ui-notify-layer');
    this.notifyLayer.setAttribute('aria-live', 'polite');
    this.modalLayer = h('div', 'ui-modal-layer ui-hidden');
    this.menuLayer = h('div', 'ui-menu-layer ui-hidden');
    root.append(this.hudHost, this.panelLayer, this.notifyLayer, this.modalLayer, this.menuLayer);
    this.hudView = new HudView(this.context());
    this.hudHost.appendChild(this.hudView.element);
    this.mounted = true;
    this.modalLayer.addEventListener('click', (event) => {
      if (event.target === this.modalLayer) this.hideModal();
    });
    this.bindKeyboard();
    this.blurHandler = () => this.releaseFishingHold();
    window.addEventListener('blur', this.blurHandler);
    this.refreshAll(api.getState());
  }

  destroy(): void {
    if (this.keyboardHandler) window.removeEventListener('keydown', this.keyboardHandler);
    if (this.keyboardUpHandler) window.removeEventListener('keyup', this.keyboardUpHandler);
    if (this.blurHandler) window.removeEventListener('blur', this.blurHandler);
    this.keyboardHandler = null;
    this.keyboardUpHandler = null;
    this.blurHandler = null;
    for (const timer of this.toastTimers) window.clearTimeout(timer);
    this.toastTimers.clear();
    for (const entry of this.panels.values()) {
      try {
        entry.controller.destroy();
      } catch {
        // A panel failing to tear down must not break the rest of the UI.
      }
    }
    this.panels.clear();
    this.openOrder.length = 0;
    try {
      this.hudView?.destroy();
    } catch {
      // ignore
    }
    this.hudView = null;
    this.hudHost = null;
    this.panelLayer = null;
    this.notifyLayer = null;
    this.modalLayer = null;
    this.menuLayer = null;
    this.uiContext = null;
    this.root?.replaceChildren();
    this.root = null;
    this.api = null;
    this.content = null;
    this.mounted = false;
    this.menuVisible = false;
    this.offlineShown = false;
    this.dialogueWasActive = false;
    this.fishingWasActive = false;
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = UI_STYLES;
    document.head.appendChild(style);
  }

  // -------------------------------------------------------------------------
  // UiContext handed to panels
  // -------------------------------------------------------------------------
  private context(): UiContext {
    if (this.uiContext) return this.uiContext;
    const api = this.api;
    const content = this.content;
    if (!api || !content) throw new Error('UI is not mounted');
    this.uiContext = {
      api,
      content,
      getState: () => this.api?.getState() ?? api.getState(),
      dispatch: (action: GameAction): ActionResult => this.dispatchAction(action),
      notify: (message: string, kind?: NotificationKind): void => {
        this.showNotification(message, kind ?? 'info');
      },
      openPanel: (id: PanelId): void => {
        this.openPanel(id);
      },
      closePanel: (id: PanelId): void => {
        this.closePanel(id);
      },
      togglePanel: (id: PanelId): void => {
        this.togglePanel(id);
      },
      isPanelOpen: (id: PanelId): boolean => this.isOpen(id),
      showSaveSlots: (): void => {
        this.showSaveSlots();
      },
      showOfflineSummaryModal: (): void => {
        const summary = this.api?.getOfflineSummary();
        if (summary) this.showOfflineSummary(summary);
        else this.showNotification('No offline summary is waiting.', 'info');
      },
      showLifeReview: (archive: ArchivedLife): void => {
        this.showLifeReview(archive);
      },
      returnToMenu: (): void => {
        this.returnToMenu();
      },
    };
    return this.uiContext as UiContext;
  }

  private dispatchAction(action: GameAction): ActionResult {
    const api = this.api;
    if (!api) return { ok: false, message: 'The game is not ready.', code: 'not_found' };
    const result = api.dispatch(action);
    if (!result.ok) {
      this.showNotification(result.message || 'That did not work.', 'error');
    } else if (
      result.message &&
      result.stateChanged !== true &&
      action.type !== 'settings:update' &&
      action.type !== 'save' &&
      action.type !== 'load'
    ) {
      this.showNotification(result.message, 'info');
    }
    this.refreshOpenPanels();
    return result;
  }

  // -------------------------------------------------------------------------
  // Frame update
  // -------------------------------------------------------------------------
  update(state: Readonly<GameState>): void {
    if (!this.mounted || !this.api) return;
    const now = performance.now();
    const screen = this.api.getScreen();
    if (this.menuVisible && screen === 'playing') this.hideMainMenu();
    const playing = screen === 'playing' && !this.menuVisible;
    this.root?.classList.toggle('ui-reduced-motion', state.settings.reducedMotion);
    if (this.hudView) {
      this.hudView.setVisible(playing);
      if (playing && now - this.lastHudAt >= 100) {
        this.lastHudAt = now;
        this.hudView.update(state, this.content ?? this.api.getContent());
      }
    }
    this.handleAutomaticPanels(state);
    // Typewriter and fishing bars need every-frame updates while open.
    const dialogue = this.panels.get('dialogue');
    if (dialogue && this.isOpen('dialogue')) dialogue.controller.update(state, now);
    const fishing = this.panels.get('fishing');
    if (fishing && this.isOpen('fishing')) fishing.controller.update(state, now);
    if (now - this.lastPanelsAt >= 200) {
      this.lastPanelsAt = now;
      for (const [id, entry] of this.panels) {
        if (id === 'dialogue' || id === 'fishing') continue;
        if (!this.isOpen(id)) continue;
        try {
          entry.controller.update(state, now);
        } catch (error) {
          console.error('[ui] panel update failed: ' + id, error);
        }
      }
    }
    this.syncProbabilityPanel(state);
    if (playing) {
      const summary = this.api.getOfflineSummary();
      if (summary && !this.offlineShown) {
        this.offlineShown = true;
        this.showOfflineSummary(summary);
      }
      if (!summary) this.offlineShown = false;
    }
    if (this.panelLayer) setClass(this.panelLayer, 'ui-hidden', this.menuVisible);
  }

  private handleAutomaticPanels(state: Readonly<GameState>): void {
    const dialogueActive = state.social.activeConversation !== null;
    if (dialogueActive !== this.dialogueWasActive) {
      this.dialogueWasActive = dialogueActive;
      if (dialogueActive) this.openPanel('dialogue');
      else this.closePanelInternal('dialogue');
    }
    const fishingActive = state.fishing.session !== null;
    if (fishingActive !== this.fishingWasActive) {
      this.fishingWasActive = fishingActive;
      if (fishingActive) this.openPanel('fishing');
      else this.closePanelInternal('fishing');
    }
  }

  private syncProbabilityPanel(state: Readonly<GameState>): void {
    const wantsDebug = state.settings.showProbabilityDebug;
    const isOpen = this.isOpen('probability');
    if (wantsDebug && !isOpen) this.openPanel('probability');
    else if (!wantsDebug && isOpen) this.closePanelInternal('probability');
  }

  /** Initial / forced refresh of everything (mount + menu restore). */
  private refreshAll(state: Readonly<GameState>): void {
    const playing = this.api?.getScreen() === 'playing' && !this.menuVisible;
    if (this.hudView) {
      this.hudView.setVisible(playing);
      this.hudView.update(state, this.content ?? this.api?.getContent() ?? (null as never));
    }
    for (const [id, entry] of this.panels) {
      if (!this.isOpen(id)) continue;
      entry.controller.update(state, performance.now());
    }
  }

  private refreshOpenPanels(): void {
    if (!this.api) return;
    const state = this.api.getState();
    const now = performance.now();
    for (const [id, entry] of this.panels) {
      if (!this.isOpen(id)) continue;
      try {
        entry.controller.update(state, now);
      } catch (error) {
        console.error('[ui] panel refresh failed: ' + id, error);
      }
    }
    if (this.hudView && this.api.getScreen() === 'playing') {
      this.hudView.update(state, this.content ?? this.api.getContent());
    }
  }

  // -------------------------------------------------------------------------
  // Panels
  // -------------------------------------------------------------------------
  openPanel(id: PanelId): void {
    if (!this.api || !this.panelLayer) return;
    if (id === 'hud') return;
    if (id === 'probability') {
      const settings = this.api.getState().settings;
      if (!settings.showProbabilityDebug) {
        this.api.dispatch({ type: 'settings:update', settings: { showProbabilityDebug: true } });
      }
    }
    const existing = this.panels.get(id);
    if (existing) {
      if (!this.openOrder.includes(id)) this.openOrder.push(id);
      setClass(existing.wrapper, 'ui-hidden', false);
      existing.controller.update(this.api.getState(), performance.now());
      return;
    }
    const definition = getPanelDefinition(id);
    if (!definition) return;
    const created = this.createPanel(definition);
    if (!created) return;
    this.panels.set(id, created);
    this.panelLayer.appendChild(created.wrapper);
    this.openOrder.push(id);
    created.controller.update(this.api.getState(), performance.now());
    if (id === 'probability') created.wrapper.classList.add('ui-panel-debug');
  }

  private createPanel(definition: PanelDefinition): PanelEntry | null {
    const ctx = this.context();
    const state = this.api?.getState();
    if (!state) return null;
    let controller: PanelController;
    try {
      controller = definition.create(ctx, state);
    } catch (error) {
      console.error('[ui] failed to create panel ' + definition.id, error);
      return null;
    }
    if (definition.size === 'dialogue') {
      const overlay = h('div', 'ui-dialogue-overlay');
      overlay.appendChild(controller.element);
      return { definition, wrapper: overlay, bodyHost: overlay, controller };
    }
    const wrapper = h('div', 'ui-panel');
    if (definition.size === 'left') wrapper.classList.add('ui-panel-left');
    else {
      const sizeClass = panelSizeClass(definition.size);
      if (sizeClass) for (const name of sizeClass.split(' ')) wrapper.classList.add(name);
    }
    wrapper.setAttribute('role', 'dialog');
    wrapper.setAttribute('aria-label', definition.title);
    wrapper.tabIndex = -1;
    const header = h('div', 'ui-panel-header');
    header.appendChild(h('span', 'ui-panel-icon', definition.icon));
    const titleWrap = h('div', 'ui-panel-title-wrap');
    titleWrap.appendChild(h('div', 'ui-panel-title', definition.title));
    if (definition.subtitle) titleWrap.appendChild(h('div', 'ui-panel-subtitle', definition.subtitle));
    header.appendChild(titleWrap);
    header.appendChild(
      button('×', () => this.closePanel(definition.id), {
        className: 'ui-button ui-button-icon ui-panel-close',
        ariaLabel: 'Close ' + definition.title,
        title: 'Close (Esc)',
      })
    );
    wrapper.appendChild(header);
    const bodyHost = h('div', 'ui-panel-scroll');
    bodyHost.appendChild(controller.element);
    wrapper.appendChild(bodyHost);
    return { definition, wrapper, bodyHost, controller };
  }

  closePanel(id: PanelId): void {
    this.closePanelInternal(id);
    if (id === 'probability' && this.api) {
      const settings = this.api.getState().settings;
      if (settings.showProbabilityDebug) {
        this.api.dispatch({ type: 'settings:update', settings: { showProbabilityDebug: false } });
      }
    }
    this.maybeReopenMenu();
  }

  private closePanelInternal(id: PanelId): void {
    const entry = this.panels.get(id);
    if (entry) setClass(entry.wrapper, 'ui-hidden', true);
    const index = this.openOrder.indexOf(id);
    if (index >= 0) this.openOrder.splice(index, 1);
  }

  togglePanel(id: PanelId): void {
    if (this.isOpen(id)) this.closePanel(id);
    else this.openPanel(id);
  }

  isOpen(id: PanelId): boolean {
    return this.openOrder.includes(id);
  }

  getOpenPanels(): PanelId[] {
    return [...this.openOrder];
  }

  private maybeReopenMenu(): void {
    if (!this.api) return;
    if (this.api.getScreen() !== 'menu') return;
    if (this.menuVisible) return;
    if (this.isModalOpen()) return;
    if (this.openOrder.length > 0) return;
    this.showMainMenu();
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------
  showNotification(message: string, kind: NotificationKind = 'info'): void {
    if (!this.notifyLayer) return;
    const toast = h('div', 'ui-toast ui-toast-' + kind, message);
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    toast.addEventListener('click', () => {
      toast.remove();
    });
    this.notifyLayer.appendChild(toast);
    while (this.notifyLayer.childElementCount > 5) {
      this.notifyLayer.firstElementChild?.remove();
    }
    const timer = window.setTimeout(() => {
      this.toastTimers.delete(timer);
      toast.remove();
    }, kind === 'error' ? 6000 : 4200);
    this.toastTimers.add(timer);
  }

  // -------------------------------------------------------------------------
  // Modals
  // -------------------------------------------------------------------------
  private showModal(content: HTMLElement, actions: ModalAction[], wide = false): void {
    if (!this.modalLayer) return;
    const modal = h('div', 'ui-modal' + (wide ? ' ui-modal-wide' : ''));
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.appendChild(content);
    if (actions.length > 0) {
      const actionRow = h('div', 'ui-modal-actions');
      for (const action of actions) {
        actionRow.appendChild(button(action.label, action.onClick, { className: action.className ?? '' }));
      }
      modal.appendChild(actionRow);
    }
    this.modalLayer.replaceChildren(modal);
    setClass(this.modalLayer, 'ui-hidden', false);
    modal.focus?.();
  }

  private isModalOpen(): boolean {
    return this.modalLayer !== null && !this.modalLayer.classList.contains('ui-hidden');
  }

  private hideModal(): void {
    if (!this.modalLayer) return;
    setClass(this.modalLayer, 'ui-hidden', true);
    this.modalLayer.replaceChildren();
    this.maybeReopenMenu();
  }

  // -------------------------------------------------------------------------
  // IUIManager modal screens
  // -------------------------------------------------------------------------
  showOfflineSummary(summary: OfflineSummary): void {
    const content = buildOfflineSummary(summary);
    this.showModal(
      content,
      [
        {
          label: 'Welcome back',
          className: 'ui-button-primary',
          onClick: () => {
            this.api?.acknowledgeOfflineSummary();
            this.hideModal();
          },
        },
      ],
      true
    );
  }

  showLifeReview(archive: ArchivedLife): void {
    const api = this.api;
    if (!api) return;
    const legacyOptions = this.legacyOptionsFor(archive);
    const content = buildLifeReview({
      life: archive,
      legacyOptions,
      onNextLife: (itemIds) => {
        const result = api.startNextLife(itemIds);
        if (!result.ok) this.showNotification(result.message, 'error');
        else {
          this.hideModal();
          this.hideMainMenu();
          this.showNotification(result.message, 'success');
        }
      },
      onClose: () => this.hideModal(),
    });
    this.showModal(content, [], true);
  }

  private legacyOptionsFor(archive: ArchivedLife): { itemId: string; name: string }[] {
    const api = this.api;
    if (!api) return [];
    try {
      const state = api.getState();
      const options = lifeExtras(api).getLegacyOptions(archive, state as GameState);
      if (options.length > 0) return options.slice(0, 6);
    } catch {
      // Fall through to archive data.
    }
    const names: { itemId: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const itemId of archive.legacyItemIds) {
      if (seen.has(itemId)) continue;
      seen.add(itemId);
      names.push({ itemId, name: api.getContent().resolveItemName(itemId) });
    }
    for (const entry of archive.collections) {
      if (names.length >= 6) break;
      if (seen.has(entry.itemId)) continue;
      seen.add(entry.itemId);
      names.push({ itemId: entry.itemId, name: api.getContent().resolveItemName(entry.itemId) });
    }
    return names;
  }

  showCharacterCreation(onConfirm: (options: NewGameOptions) => void): void {
    const api = this.api;
    if (!api) return;
    const defaults = api.getState().player.appearance;
    const content = buildCharacterCreation({
      defaults,
      onConfirm: (options: CharacterOptions) => {
        this.hideModal();
        onConfirm(toNewGameOptions(options, defaults));
      },
    });
    this.showModal(content, [{ label: 'Cancel', onClick: () => this.hideModal() }], true);
  }

  showSaveSlots(): void {
    const api = this.api;
    if (!api) return;
    this.hideMainMenu();
    void api.listSaveSlots().then((slots: SaveSlotMeta[]) => {
      const content = buildSaveSlots({
        slots: [...slots].sort((a, b) => b.savedAt - a.savedAt),
        handlers: {
          onLoad: (slotId) => {
            void api.loadGame(slotId).then((result) => {
              this.hideModal();
              if (!result.ok) this.showNotification(result.message, 'error');
              else {
                this.hideMainMenu();
                this.showNotification(result.message || 'Welcome back.', 'success');
              }
            });
          },
          onDelete: (slotId) => {
            void api
              .getSystems()
              .save.deleteSlot(slotId)
              .then(() => {
                this.showNotification('Save deleted.', 'info');
                this.showSaveSlots();
              });
          },
          onExport: (slotId) => api.getSystems().save.exportSave(slotId),
          onImport: (json, slotId) =>
            api.getSystems().save.importSave(json, slotId).then((result) => {
              if (result.ok) void this.showSaveSlots();
              return { ok: result.ok, message: result.message };
            }),
          onNewLife: () => {
            this.hideModal();
            this.showCharacterCreation((options) => {
              const slotId = 'slot_' + Date.now().toString(36);
              const result = api.newGame({ ...options, slotId });
              if (!result.ok) this.showNotification(result.message, 'error');
              else {
                this.hideMainMenu();
                this.showNotification('A new cigarette is lit.', 'success');
              }
            });
          },
        },
      });
      this.showModal(content, [{ label: 'Close', onClick: () => this.hideModal() }], true);
    });
  }

  // -------------------------------------------------------------------------
  // Main menu
  // -------------------------------------------------------------------------
  showMainMenu(): void {
    const api = this.api;
    if (!api || !this.menuLayer) return;
    this.menuVisible = true;
    for (const id of [...this.openOrder]) this.closePanelInternal(id);
    this.menuLayer.replaceChildren();
    const content = buildMainMenu({
      version: api.getState().meta.gameVersion,
      onNewLife: () => {
        this.hideMainMenu();
        this.showCharacterCreation((options) => {
          const result = api.newGame(options);
          if (!result.ok) this.showNotification(result.message, 'error');
          else {
            this.hideMainMenu();
            this.showNotification('A new cigarette is lit. The world was already awake.', 'success');
          }
        });
      },
      onContinue: () => {
        void api.listSaveSlots().then((slots) => {
          const latest = [...slots].sort((a, b) => b.savedAt - a.savedAt)[0];
          if (!latest) {
            this.showNotification('No saves yet. Start a new life.', 'info');
            this.hideMainMenu();
            this.showCharacterCreation((options) => {
              const result = api.newGame(options);
              if (!result.ok) this.showNotification(result.message, 'error');
              else this.hideMainMenu();
            });
            return;
          }
          void api.loadGame(latest.slotId).then((result) => {
            if (!result.ok) this.showNotification(result.message, 'error');
            else {
              this.hideMainMenu();
              this.showNotification('Welcome back.', 'success');
            }
          });
        });
      },
      onSaveSlots: () => this.showSaveSlots(),
      onLifeArchives: () => {
        const archive = api.getLifeArchive();
        if (archive.length === 0) {
          this.showNotification('No past lives yet. Every cigarette burns once.', 'info');
          return;
        }
        const last = archive[archive.length - 1];
        if (last) this.showLifeReview(last);
      },
      onSettings: () => {
        this.hideMainMenu();
        this.openPanel('settings');
      },
      onHelp: () => {
        this.hideMainMenu();
        this.openPanel('help');
      },
    });
    this.menuLayer.appendChild(content);
    setClass(this.menuLayer, 'ui-hidden', false);
    if (this.panelLayer) setClass(this.panelLayer, 'ui-hidden', true);
    this.hudView?.setVisible(false);
  }

  hideMainMenu(): void {
    this.menuVisible = false;
    if (this.menuLayer) setClass(this.menuLayer, 'ui-hidden', true);
    if (this.panelLayer) setClass(this.panelLayer, 'ui-hidden', false);
  }

  showMenuScreen(screen: 'main' | 'none'): void {
    if (screen === 'main') this.showMainMenu();
    else this.hideMainMenu();
  }

  private returnToMenu(): void {
    for (const id of [...this.openOrder]) this.closePanelInternal(id);
    this.hideModal();
    this.api?.setScreen('menu');
    this.hideMainMenu();
    this.showMainMenu();
  }

  setDialogueActive(active: boolean): void {
    if (active) this.openPanel('dialogue');
    else this.closePanel('dialogue');
  }

  isTyping(): boolean {
    if (!this.api) return false;
    if (this.api.getState().social.activeConversation === null) return false;
    const dialogue = this.panels.get('dialogue');
    if (!dialogue) return false;
    return dialogue.controller instanceof DialoguePanel && dialogue.controller.isTyping();
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------
  private bindKeyboard(): void {
    if (this.keyboardHandler) return;
    this.keyboardHandler = (event: KeyboardEvent) => this.onKeyDown(event);
    this.keyboardUpHandler = (event: KeyboardEvent) => this.onKeyUp(event);
    window.addEventListener('keydown', this.keyboardHandler);
    window.addEventListener('keyup', this.keyboardUpHandler);
  }

  private isTypingTarget(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return target.isContentEditable === true;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.api || !this.mounted) return;
    if (event.defaultPrevented) return;
    if (this.isTypingTarget(event)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = normaliseKeyName(event.key);
    if (!key) return;
    if (key === 'ESC' || event.key === 'Escape') {
      event.preventDefault();
      if (this.isModalOpen()) {
        this.hideModal();
        return;
      }
      if (this.isOpen('dialogue')) {
        this.dispatchAction({ type: 'dialogue:end' });
        return;
      }
      if (this.openOrder.length > 0) {
        const top = this.openOrder[this.openOrder.length - 1];
        if (top) this.closePanel(top);
        return;
      }
      if (this.menuVisible) return;
      if (this.api.getScreen() === 'playing') {
        this.api.setScreen('menu');
        this.showMainMenu();
      }
      return;
    }
    if (this.isModalOpen()) return;
    // Dialogue: numbers pick choices, space skips the typewriter.
    if (this.isOpen('dialogue')) {
      const dialogue = this.panels.get('dialogue')?.controller;
      if (dialogue instanceof DialoguePanel) {
        if (event.key === ' ' || key === 'SPACE') {
          event.preventDefault();
          dialogue.skipTyping();
          return;
        }
        const digit = Number(event.key);
        if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
          event.preventDefault();
          dialogue.chooseVisibleNumber(digit);
          return;
        }
      }
    }
    if (this.isOpen('fishing')) {
      const fishing = this.panels.get('fishing')?.controller;
      if ((key === 'SPACE' || event.key === ' ') && fishing instanceof FishingPanel && !fishing.isHolding()) {
        event.preventDefault();
        fishing.beginHold();
        return;
      }
    }
    const settings = this.api.getState().settings;
    const shortcuts = resolveShortcuts(settings);
    for (const action of Object.keys(shortcuts) as UiShortcutAction[]) {
      if (shortcuts[action] !== key) continue;
      if (action === 'help' && this.openOrder.length > 0) continue; // Tab navigates inside panels
      event.preventDefault();
      if (action === 'debugProbability') {
        const next = !this.isOpen('probability');
        this.api.dispatch({ type: 'settings:update', settings: { showProbabilityDebug: next } });
        if (next) this.openPanel('probability');
        else this.closePanel('probability');
        return;
      }
      this.togglePanel(SHORTCUT_PANEL[action]);
      return;
    }
  }

  private releaseFishingHold(): void {
    const fishing = this.panels.get('fishing')?.controller;
    if (fishing instanceof FishingPanel) fishing.endHold();
  }

  private onKeyUp(event: KeyboardEvent): void {
    if (!this.api || !this.mounted) return;
    const key = normaliseKeyName(event.key);
    if (key !== 'SPACE' && event.key !== ' ') return;
    if (!this.isOpen('fishing')) return;
    const fishing = this.panels.get('fishing')?.controller;
    if (fishing instanceof FishingPanel) fishing.endHold();
  }
}

export type { ISceneSession };
