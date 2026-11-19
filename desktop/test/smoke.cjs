'use strict';

/**
 * Headless-ish smoke test for the Electron shell.
 * Boots the real main process (../electron/main.cjs), then inspects the live renderer:
 * origin, preload bridge, WebGL, module-worker load, IndexedDB read/write, screenshot.
 *
 * SMOKE_MODE=write|read|full   (read = check that a marker from a previous run survived)
 * SMOKE_OUT=<dir>              where the JSON result and screenshot are written
 */

const { app, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

require('../electron/main.cjs');

const MODE = process.env.SMOKE_MODE || 'full';
const OUT_DIR = process.env.SMOKE_OUT || path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const consoleMessages = [];
let done = false;

function js(win, code) {
  return win.webContents.executeJavaScript(code, true);
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function waitFor(win, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await js(win, '!!(' + expression + ')').catch(function () {
      return false;
    });
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

const IDB_WRITE = [
  'new Promise(function (resolve, reject) {',
  '  var open = indexedDB.open("acs_smoke", 1);',
  '  open.onupgradeneeded = function () { open.result.createObjectStore("k"); };',
  '  open.onerror = function () { reject(open.error); };',
  '  open.onsuccess = function () {',
  '    var db = open.result;',
  '    var tx = db.transaction("k", "readwrite");',
  '    tx.objectStore("k").put({ at: Date.now(), origin: location.origin }, "marker");',
  '    tx.oncomplete = function () { resolve("written"); };',
  '    tx.onerror = function () { reject(tx.error); };',
  '  };',
  '})',
].join('\n');

const IDB_READ = [
  'new Promise(function (resolve, reject) {',
  '  var open = indexedDB.open("acs_smoke", 1);',
  '  open.onupgradeneeded = function () { open.result.createObjectStore("k"); };',
  '  open.onerror = function () { reject(open.error); };',
  '  open.onsuccess = function () {',
  '    try {',
  '      var tx = open.result.transaction("k", "readonly");',
  '      var req = tx.objectStore("k").get("marker");',
  '      req.onsuccess = function () { resolve(req.result || null); };',
  '      req.onerror = function () { reject(req.error); };',
  '    } catch (error) { resolve(null); }',
  '  };',
  '})',
].join('\n');

const WORKER_TEST = [
  'new Promise(function (resolve) {',
  '  var scripts = Array.prototype.map.call(document.querySelectorAll("script[type=module]"), function (s) { return s.src; });',
  '  var entry = scripts.filter(function (s) { return s.indexOf("/assets/index-") !== -1 && s.slice(-3) === ".js"; })[0];',
  '  if (!entry) return resolve({ ok: false, reason: "no entry script", scripts: scripts });',
  '  fetch(entry)',
  '    .then(function (r) { return r.text(); })',
  '    .then(function (text) {',
  '      var at = text.indexOf("simulation.worker-");',
  '      var rest = at === -1 ? "" : text.slice(at + 18);',
  '      var nameMatch = rest.match(/^[A-Za-z0-9_.-]+/);',
  '      var name = nameMatch ? "simulation.worker-" + nameMatch[0] : null;',
  '      if (!name) return resolve({ ok: false, reason: "worker ref not found" });',
  '      var url = new URL("./" + name, entry).href;',
  '      var settled = false;',
  '      var worker;',
  '      try { worker = new Worker(url, { type: "module" }); } catch (error) {',
  '        return resolve({ ok: false, reason: "constructor: " + String(error), url: url });',
  '      }',
  '      worker.onerror = function (event) {',
  '        if (settled) return;',
  '        settled = true;',
  '        resolve({ ok: false, reason: "load error: " + (event.message || "unknown"), url: url });',
  '      };',
  '      setTimeout(function () {',
  '        if (settled) return;',
  '        settled = true;',
  '        worker.terminate();',
  '        resolve({ ok: true, url: url });',
  '      }, 3000);',
  '    })',
  '    .catch(function (error) { resolve({ ok: false, reason: "fetch: " + String(error) }); });',
  '})',
].join('\n');;

const SAVE_SCRIPT = [
  '(function () {',
  '  var api = window.__A_CIGARETTES_LIFE__;',
  '  if (!api || !api.game) return Promise.resolve("no-game");',
  '  try {',
  '    var game = api.game;',
  '    var slotId = game.getSaveManager().getCurrentSlotId();',
  '    return Promise.resolve(game.saveGame(slotId))',
  '      .then(function (result) { return JSON.stringify(result); })',
  '      .catch(function (error) { return "ERR:" + String(error); });',
  '  } catch (error) {',
  '    return Promise.resolve("THROW:" + String(error));',
  '  }',
  '})()',
].join('\n');

app.on('browser-window-created', function (_event, win) {
  win.webContents.on('console-message', function (event) {
    if (event && typeof event.message === 'string') {
      consoleMessages.push({ level: event.level, message: event.message.slice(0, 400) });
    }
  });

  win.webContents.once('did-finish-load', function () {
    run(win).catch(function (error) {
      finish({ mode: MODE, fatal: String(error && error.stack ? error.stack : error) });
    });
  });
});

async function run(win) {
  const out = {
    mode: MODE,
    originMode: process.env.ACS_ORIGIN_MODE || 'app',
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  };

  out.booted = await waitFor(win, 'window.__A_CIGARETTES_LIFE__', 45000);
  out.origin = await js(win, 'location.origin');
  out.href = await js(win, 'location.href');
  out.title = await js(win, 'document.title');
  out.bridge = await js(win, 'JSON.stringify(window.acsDesktop || null)');
  out.gameBaseUrl = await js(win, 'window.gameBaseUrl || null');
  out.webgl = await js(
    win,
    '(function(){ try { var c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return "ERR:" + e; } })()'
  );
  out.phaserBooted = await js(
    win,
    '(function(){ var api = window.__A_CIGARETTES_LIFE__; return api && api.phaser ? !!api.phaser.isBooted : false; })()'
  );
  out.workerChunk = await js(
    win,
    '(function(){ return performance.getEntriesByType("resource").map(function (e) { return e.name; }).filter(function (n) { return n.indexOf("worker") !== -1; }); })()'
  );
  out.bounds = win.getBounds();
  out.contentSize = win.getContentSize();
  out.scaleFactor = screen.getPrimaryDisplay().scaleFactor;
  try {
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    const targets = await dbg.sendCommand('Target.getTargets');
    out.targets = (targets.targetInfos || []).map(function (t) {
      return t.type + ' ' + t.url;
    });
    dbg.detach();
  } catch (error) {
    out.targetsError = String(error);
  }
  out.idbDatabases = await js(
    win,
    '(function(){ if (!indexedDB.databases) return "unsupported"; return indexedDB.databases().then(function (list) { return list.map(function (d) { return d.name + ":" + d.version; }); }); })()'
  );

  if (MODE === 'write' || MODE === 'full') {
    out.idbWrite = await js(win, IDB_WRITE).catch(function (error) {
      return 'ERR:' + String(error);
    });
  }
  if (MODE === 'read' || MODE === 'full') {
    out.idbMarker = await js(win, IDB_READ).catch(function (error) {
      return 'ERR:' + String(error);
    });
  }

  out.moduleWorker = await js(win, WORKER_TEST).catch(function (error) {
    return { ok: false, reason: String(error) };
  });

  out.gameSave = await js(win, SAVE_SCRIPT).catch(function (error) {
    return 'PROTOCOL-ERR:' + String(error);
  });

  await sleep(6500);
  try {
    const image = await win.webContents.capturePage();
    out.screenshot = path.join(OUT_DIR, 'shot-' + (process.env.SMOKE_TAG || MODE) + '.png');
    fs.writeFileSync(out.screenshot, image.toPNG());
    out.screenshotBytes = fs.statSync(out.screenshot).size;
  } catch (error) {
    out.screenshotError = String(error);
  }

  out.consoleErrors = consoleMessages.filter(function (entry) {
    return entry.level === 'error' || entry.level === 'warning' || entry.level >= 2;
  }).slice(0, 25);
  out.consoleTail = consoleMessages.slice(-15);

  finish(out);
}

function finish(out) {
  if (done) return;
  done = true;
  out.appVersion = app.getVersion();
  out.userData = app.getPath('userData');
  const file = path.join(OUT_DIR, 'result-' + (process.env.SMOKE_TAG || MODE) + '.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
  process.stdout.write('\n===== SMOKE RESULT =====\n' + JSON.stringify(out, null, 2) + '\n');
  process.stdout.write('result file: ' + file + '\n');
  app.exit(0);
}

setTimeout(function () {
  finish({ mode: MODE, fatal: 'timeout' });
}, 120000);
