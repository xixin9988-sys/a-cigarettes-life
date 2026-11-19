'use strict';

/**
 * Preload bridge. Runs with contextIsolation: true, nodeIntegration: false, sandbox: true.
 * Only plain data and a couple of fire-and-forget channels cross the boundary.
 */

const { contextBridge, ipcRenderer } = require('electron');

let config = {};
try {
  config = ipcRenderer.sendSync('acs:config') || {};
} catch (error) {
  config = { isDesktop: false, error: String(error && error.message) };
}

const bridge = Object.freeze({
  isDesktop: config.isDesktop === true,
  /** URL the game is actually served from, e.g. "app://game/index.html" */
  baseUrl: config.baseUrl || null,
  /** Loopback HTTP origin, e.g. "http://127.0.0.1:52133" (useful for debugging) */
  serverOrigin: config.serverOrigin || null,
  port: typeof config.port === 'number' ? config.port : null,
  appVersion: config.appVersion || null,
  electron: config.electron || null,
  chrome: config.chrome || null,
  platform: config.platform || null,
  toggleFullscreen: function toggleFullscreen() {
    ipcRenderer.send('acs:toggle-fullscreen');
  },
  quit: function quit() {
    ipcRenderer.send('acs:quit');
  },
});

contextBridge.exposeInMainWorld('acsDesktop', bridge);

// Drop-in for game code that used to hardcode http://127.0.0.1:3000/
contextBridge.exposeInMainWorld('gameBaseUrl', bridge.baseUrl);
