'use strict';

/**
 * A Cigarette's Life - Electron main process.
 *
 * Responsibilities
 *  1. start a loopback static server for the built game (port 0 = OS picks a free port)
 *  2. open a single 1280x720 window on it
 *  3. provide window/fullscreen toggling, graceful save-on-close and a safe preload bridge
 *
 * Nothing in here touches the game's own source code.
 */

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, screen, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { startStaticServer, createFileResponse } = require('./static-server.cjs');

const APP_TITLE = "A Cigarette's Life";

// ---------------------------------------------------------------------------
// Origin mode
//   'app'  -> the window loads app://game/, served from the same build directory.
//             The page origin never changes, so IndexedDB save data always shows up
//             even though the loopback server gets a different port on every launch.
//   'http' -> the window loads http://127.0.0.1:<port>/ directly.
//             Simpler, but a different port means a different storage origin:
//             the player would see an empty save list on most launches. If you pick
//             this mode, pin the port with ACS_PORT as well.
// ---------------------------------------------------------------------------
const ORIGIN_MODE = process.env.ACS_ORIGIN_MODE === 'http' ? 'http' : 'app';

app.setName(APP_TITLE);

// Opt-in green/portable build: keep save data next to the exe.
if (process.env.ACS_PORTABLE_DATA === '1' && process.env.PORTABLE_EXECUTABLE_DIR) {
  try {
    app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data'));
  } catch (_error) {
    /* keep the default location */
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const DEV_SERVER_ARG = '--dev-server=';

/** The Vite dev server URL, when launched with --dev-server=http://127.0.0.1:3000 */
function readDevServerUrl() {
  var raw = process.argv.find(function (arg) {
    return arg.indexOf(DEV_SERVER_ARG) === 0;
  });
  return raw ? raw.slice(DEV_SERVER_ARG.length) : null;
}

/** Where the built game lives, unpacked (repo/dist) or packaged (app.asar/dist). */
function resolveGameRoot() {
  var candidates = app.isPackaged
    ? [path.join(app.getAppPath(), 'dist'), path.join(process.resourcesPath, 'dist')]
    : [path.join(__dirname, '..', '..', 'dist'), path.join(process.resourcesPath, 'dist')];
  for (var i = 0; i < candidates.length; i += 1) {
    if (fs.existsSync(path.join(candidates[i], 'index.html'))) return candidates[i];
  }
  return candidates[0];
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (_error) {
    return {};
  }
}

function writeSettings(patch) {
  try {
    var next = Object.assign({}, readSettings(), patch);
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (_error) {
    /* settings are best-effort */
  }
}

/** Restore the last window bounds, but only when they are still on a visible display. */
function restoreWindowBounds() {
  var saved = readSettings().windowBounds;
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return null;
  var visible = screen.getAllDisplays().some(function (display) {
    var area = display.workArea;
    return (
      saved.x + 40 < area.x + area.width &&
      saved.x + saved.width - 40 > area.x &&
      saved.y + 40 < area.y + area.height &&
      saved.y + saved.height - 40 > area.y
    );
  });
  return visible ? saved : null;
}

// Save the game before the window really closes. beforeunload alone is not enough:
// the async IndexedDB write would be killed together with the renderer process.
const FLUSH_SCRIPT = [
  '(function () {',
  '  try {',
  '    var api = window.__A_CIGARETTES_LIFE__;',
  '    if (!api || !api.game || !api.game.saveGame) return true;',
  '    var game = api.game;',
  '    var slotId = game.getSaveManager().getCurrentSlotId();',
  '    return Promise.resolve(game.saveGame(slotId))',
  '      .then(function () { return true; })',
  '      .catch(function () { return true; });',
  '  } catch (error) {',
  '    return true;',
  '  }',
  '})()',
].join('\n');

var mainWindow = null;
var gameServer = null;
var teardownStarted = false;

function log(message) {
  if (app.isPackaged && process.env.ACS_VERBOSE !== '1') return;
  process.stdout.write('[acs] ' + message + '\n');
}

function createWindow(targetUrl) {
  var bounds = restoreWindowBounds();
  var win = new BrowserWindow({
    width: bounds ? bounds.width : 1280,
    height: bounds ? bounds.height : 720,
    x: bounds ? bounds.x : undefined,
    y: bounds ? bounds.y : undefined,
    minWidth: 960,
    minHeight: 540,
    title: APP_TITLE,
    backgroundColor: '#1a1a1f',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', function () {
    win.show();
    if (win.isMaximized() || win.isFullScreen()) win.focus();
  });

  // Fullscreen / devtools keys.
  win.webContents.on('before-input-event', function (event, input) {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
      return;
    }
    if (!app.isPackaged && input.key === 'F12') {
      event.preventDefault();
      win.webContents.toggleDevTools();
      return;
    }
    if (input.key === 'F5' && !app.isPackaged) {
      event.preventDefault();
      win.webContents.reload();
    }
  });

  // Keep the shell in charge of navigation: the game page must not leave the app origin.
  win.webContents.on('will-navigate', function (event, url) {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  win.webContents.setWindowOpenHandler(function (details) {
    if (/^https?:/i.test(details.url)) shell.openExternal(details.url);
    return { action: 'deny' };
  });

  win.webContents.on('render-process-gone', function (_event, details) {
    log('renderer gone: ' + JSON.stringify(details));
  });

  win.webContents.on('did-fail-load', function (_event, errorCode, errorDescription, validatedURL) {
    log('did-fail-load ' + errorCode + ' ' + errorDescription + ' ' + validatedURL);
  });

  win.on('close', function (event) {
    if (teardownStarted) return;
    event.preventDefault();
    teardownStarted = true;

    if (!win.isFullScreen() && !win.isMaximized()) {
      writeSettings({ windowBounds: win.getBounds() });
    }

    var flush = win.isDestroyed()
      ? Promise.resolve(true)
      : win.webContents.executeJavaScript(FLUSH_SCRIPT, true).catch(function () {
          return true;
        });
    var timeout = new Promise(function (resolve) {
      setTimeout(function () {
        resolve(true);
      }, 4000);
    });

    Promise.race([flush, timeout]).then(function () {
      if (!win.isDestroyed()) win.destroy();
    });
  });

  win.on('closed', function () {
    mainWindow = null;
  });

  mainWindow = win;
  win.loadURL(targetUrl);
  return win;
}

/**
 * Serve app://game/* straight from the build directory with the same rules as the
 * HTTP server, so the page origin is constant no matter which port the server got.
 */
function registerAppProtocol(gameRoot) {
  protocol.handle('app', function (request) {
    var url = new URL(request.url);
    if (url.host !== 'game') {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    }
    return createFileResponse(gameRoot, request.url, { method: request.method }).catch(function (error) {
      log('protocol error for ' + request.url + ': ' + error.message);
      return new Response('Internal Server Error', { status: 500 });
    });
  });
}

/** Dev convenience: keep retrying while the Vite server is still booting. */
function retryUntilDevServerIsReady(win, url) {
  var attempts = 0;
  win.webContents.on('did-fail-load', function (_event, _code, _description, _validatedUrl, isMainFrame) {
    if (!isMainFrame || attempts >= 30) return;
    attempts += 1;
    setTimeout(function () {
      if (win.isDestroyed()) return;
      win.loadURL(url).catch(function () {});
    }, 1000);
  });
}

async function boot() {
  Menu.setApplicationMenu(null);

  var devServerUrl = readDevServerUrl();
  var targetUrl;

  if (devServerUrl) {
    targetUrl = devServerUrl;
    log('dev mode: loading ' + devServerUrl);
  } else {
    var gameRoot = resolveGameRoot();
    if (!fs.existsSync(path.join(gameRoot, 'index.html'))) {
      dialog.showErrorBox(
        APP_TITLE,
        'Game build not found.\n\nExpected:\n' + path.join(gameRoot, 'index.html') + '\n\nRun "npm run build" first.'
      );
      app.quit();
      return;
    }

    var preferredPort = Number(process.env.ACS_PORT) || 0;
    gameServer = await startStaticServer({
      rootDir: gameRoot,
      host: '127.0.0.1',
      preferredPort: preferredPort,
      log: log,
    });

    if (ORIGIN_MODE === 'app') {
      registerAppProtocol(gameRoot);
      targetUrl = 'app://game/index.html';
    } else {
      targetUrl = gameServer.origin + '/';
    }
  }

  ipcMain.on('acs:config', function (event) {
    event.returnValue = {
      isDesktop: true,
      baseUrl: targetUrl,
      serverOrigin: gameServer ? gameServer.origin : null,
      port: gameServer ? gameServer.port : null,
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      platform: process.platform,
    };
  });

  ipcMain.on('acs:toggle-fullscreen', function () {
    if (!mainWindow) return;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });

  ipcMain.on('acs:quit', function () {
    if (mainWindow) mainWindow.close();
  });

  var win = createWindow(targetUrl);
  if (devServerUrl) retryUntilDevServerIsReady(win, targetUrl);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', function () {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(function () {
    // The game needs nothing from the permission system.
    session.defaultSession.setPermissionRequestHandler(function (_wc, _permission, callback) {
      callback(false);
    });
    return boot();
  }).catch(function (error) {
    dialog.showErrorBox(APP_TITLE, 'Failed to start:\n\n' + String(error && error.stack ? error.stack : error));
    app.quit();
  });

  app.on('window-all-closed', function () {
    app.quit();
  });

  app.on('before-quit', function () {
    if (gameServer) {
      gameServer.close().catch(function () {});
      gameServer = null;
    }
  });
}
