import type {
  ArchivedLife,
  GameState,
  IContentRegistry,
  IGameApi,
  NewGameOptions,
  OfflineSummary,
} from '../core/contracts';

/**
 * UI contract shared by Agent 13 (scenes) and Agent 13b (DOM panels).
 * The DOM UI is mounted into #ui-root; Phaser scenes live in #game-root/canvas.
 */
export type PanelId =
  | 'hud'
  | 'inventory'
  | 'map'
  | 'social'
  | 'skills'
  | 'journal'
  | 'events'
  | 'shop'
  | 'building'
  | 'housing'
  | 'collection'
  | 'archive'
  | 'settings'
  | 'life'
  | 'dialogue'
  | 'fishing'
  | 'probability'
  | 'help';

export type NotificationKind = 'info' | 'success' | 'warning' | 'error';

export interface IUIManager {
  /** Mounts all DOM UI under the given root with the current game API. */
  mount(root: HTMLElement, api: IGameApi): void;
  destroy(): void;
  /** Called every animation frame with the latest persistent state. */
  update(state: Readonly<GameState>): void;
  openPanel(id: PanelId): void;
  closePanel(id: PanelId): void;
  togglePanel(id: PanelId): void;
  isOpen(id: PanelId): boolean;
  getOpenPanels(): PanelId[];
  showNotification(message: string, kind?: NotificationKind): void;
  showOfflineSummary(summary: OfflineSummary): void;
  showLifeReview(archive: ArchivedLife): void;
  showCharacterCreation(onConfirm: (options: NewGameOptions) => void): void;
  showSaveSlots(): void;
  showMainMenu(): void;
  hideMainMenu(): void;
  showMenuScreen(screen: 'main' | 'none'): void;
  setDialogueActive(active: boolean): void;
  isTyping(): boolean;
}

/** Everything a Phaser scene needs from the game - provided by src/main.ts. */
export interface ISceneSession {
  api: IGameApi;
  content: IContentRegistry;
  ui: IUIManager;
}
