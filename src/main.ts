import Phaser from 'phaser';
import { CONTENT_PACK } from './data';
import { ContentRegistry } from './core/ContentRegistry';
import { GameEngine } from './core/Game';
import { ConsoleLogger } from './core/GameLogger';
import { formatMoney } from './core/format';
import { UIManager } from './ui/UIManager';
import { AudioManager } from './audio/AudioManager';
import { setSceneSession } from './scenes/session';
import { createPhaserConfig } from './scenes/config';
import type { ISceneSession } from './ui/UIInterfaces';

declare global {
  interface Window {
    __A_CIGARETTES_LIFE__?: {
      game: GameEngine;
      ui: UIManager;
      phaser: Phaser.Game;
    };
  }
}

function hideBootOverlay(): void {
  const overlay = document.getElementById('boot-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function showBootError(error: unknown): void {
  const overlay = document.getElementById('boot-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.innerHTML =
    '<div style="max-width:720px;padding:24px;font-family:monospace;color:#ffb7a1">' +
    '<div style="font-size:20px;margin-bottom:12px">The game failed to start</div>' +
    '<pre style="white-space:pre-wrap;font-size:12px;opacity:.85">' +
    String(error instanceof Error ? error.stack ?? error.message : error).replaceAll('<', '&lt;') +
    '</pre></div>';
}

async function boot(): Promise<void> {
  const logger = new ConsoleLogger({ minLevel: 'info' });
  const content = new ContentRegistry(CONTENT_PACK);
  const validationErrors = content.validate();
  if (validationErrors.length > 0) {
    logger.warn('Content validation issues (' + validationErrors.length + '): ' + validationErrors.slice(0, 8).join(' | '));
  }

  const game = new GameEngine({ content, logger });
  await game.init();

  const uiRoot = document.getElementById('ui-root');
  if (!uiRoot) throw new Error('Missing #ui-root element');
  const ui = new UIManager();
  ui.mount(uiRoot, game);

  const session: ISceneSession = { api: game, content, ui };
  setSceneSession(session);

  const phaser = new Phaser.Game(createPhaserConfig());
  window.__A_CIGARETTES_LIFE__ = { game, ui, phaser };

  const audio = new AudioManager();
  const unlockAudio = (): void => {
    void audio.start().then(() => {
      const settings = game.getState().settings;
      audio.setVolumes({ master: settings.masterVolume, music: settings.musicVolume, sfx: settings.sfxVolume });
    });
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
  // UI feedback: every persisted DOM button click gets a soft click sound once audio is unlocked.
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const button = target.closest('button, .ui-button');
      if (button) audio.playSfx('ui_click');
    },
    { capture: true }
  );

  // Bridge prominent bus events to player-facing toasts.
  const bus = game.getEventBus();
  bus.on('fish:caught', () => audio.playSfx('fish_catch'));
  bus.on('crop:harvested', () => audio.playSfx('harvest'));
  bus.on('achievement:unlocked', (payload) => {
    ui.showNotification('Achievement: ' + payload.title, 'success');
    audio.playSfx('level_up');
  });
  bus.on('money:changed', (payload) => {
    if (payload.amount > 0) audio.playSfx('coin');
  });
  bus.on('item:acquired', () => audio.playSfx('item_get'));
  bus.on('cigarette:warning', () => audio.playSfx('warning'));
  bus.on('save:completed', () => audio.playSfx('save'));
  bus.on('relationship:changed', (payload) => {
    if (payload.status === 'dating' || payload.status === 'partner') audio.playSfx('success');
  });
  bus.on('letter:received', (payload) => ui.showNotification('New letter: ' + payload.letter.subject, 'info'));
  bus.on('offline:completed', () => ui.showNotification('The world moved on while you were away.', 'info'));
  bus.on('event:occurred', (payload) => {
    if (payload.event.importance >= 3) ui.showNotification(payload.event.title, 'info');
  });
  bus.on('save:completed', () => ui.showNotification('Game saved', 'success'));
  bus.on('game:signal', (payload) => {
    if (payload.name === 'skill:levelup') ui.showNotification('Skill level up!', 'success');
    if (payload.name === 'inventory:full') ui.showNotification('Your bag is full', 'warning');
  });

  let lastTimestamp = performance.now();
  const frame = (timestamp: number): void => {
    const deltaSeconds = Math.min(0.1, Math.max(0, (timestamp - lastTimestamp) / 1000));
    lastTimestamp = timestamp;
    game.tick(deltaSeconds);
    const state = game.getState();
    ui.update(state);
    audio.update(state);
    const volumes = state.settings;
    audio.setVolumes({ master: volumes.masterVolume, music: volumes.musicVolume, sfx: volumes.sfxVolume });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  ui.showMainMenu();
  const state = game.getState();
  logger.info('A Cigarette\'s Life booted. Player money: ' + formatMoney(state.player.money));

  const hideWhenReady = (): void => {
    if (phaser.isBooted) hideBootOverlay();
    else setTimeout(hideWhenReady, 60);
  };
  hideWhenReady();

  // Tab visibility: the Web Worker keeps the living world moving while the main thread is
  // throttled or suspended (LOD2 background simulation), then the result is merged on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.startBackgroundSimulation();
    else game.stopBackgroundSimulation();
  });

  window.addEventListener('beforeunload', () => {
    void game.saveGame(game.getSaveManager().getCurrentSlotId());
    audio.dispose();
  });
}

boot().catch((error) => {
  console.error(error);
  showBootError(error);
});