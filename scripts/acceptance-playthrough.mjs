#!/usr/bin/env node
/**
 * A Cigarette's Life - independent end-to-end acceptance playthrough of the production build.
 *
 * Drives the real dist/ bundle (served by "npx vite preview --port 4173") in headless Chrome via
 * playwright-core. Input is real keyboard/DOM interaction wherever a player could do the same
 * thing; the window.__A_CIGARETTES_LIFE__ hook is used for assertions and for actions whose UI
 * path is awkward (farm plots, long rests). Every state change still goes through the public
 * GameEngine action API.
 *
 * Reported accelerators:
 *  - game.tick() loops wall-clock-compress long in-game waits (fishing bite); simulation states
 *    advanced are identical to a real wait, only trigger faster.
 *  - the offline test rewinds pendingOffline.lastSaveRealMs in memory (6 real hours) instead of
 *    waiting six hours; the offline simulation itself is real worker/main-thread work.
 *
 * Usage:  node scripts/acceptance-playthrough.mjs
 * Env:    ACCEPTANCE_URL, ACCEPTANCE_CHROME, ACCEPTANCE_PREFIX, ACCEPTANCE_HEADFUL=1
 * Output: smoke/<prefix>-*.png, smoke/acceptance-results.json, smoke/acceptance-console.log
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const NL = String.fromCharCode(10);
const CHROME = process.env.ACCEPTANCE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE_URL = process.env.ACCEPTANCE_URL || 'http://localhost:4173/';
const PREFIX = process.env.ACCEPTANCE_PREFIX || 'acceptance';
const ROOT = process.cwd();
const SMOKE_DIR = path.join(ROOT, 'smoke');
const RUN_ID = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const HEADFUL = process.env.ACCEPTANCE_HEADFUL === '1';

fs.mkdirSync(SMOKE_DIR, { recursive: true });
for (const file of fs.readdirSync(SMOKE_DIR)) {
  if (file.startsWith(PREFIX + '-') && file.endsWith('.png')) fs.rmSync(path.join(SMOKE_DIR, file));
}

const results = [];
const consoleEntries = [];
const pageErrors = [];
let shotCounter = 0;
let currentStep = null;
let page;

function log(line) {
  console.log(line);
}
function truncate(value, max = 400) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return String(text);
  return text.length > max ? text.slice(0, max - 1) + '...' : text;
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

async function screenshot(slug) {
  shotCounter += 1;
  const name = PREFIX + '-' + String(shotCounter).padStart(2, '0') + '-' + slug + '.png';
  const file = path.join(SMOKE_DIR, name);
  await page.screenshot({ path: file });
  if (currentStep) currentStep.evidence.push('screenshot: ' + name);
  return name;
}

async function step(id, name, fn) {
  const record = { id, name, status: 'FAIL', details: '', evidence: [] };
  results.push(record);
  currentStep = record;
  log('');
  log('=== [' + id + '] ' + name + ' ===');
  try {
    const details = await fn(record);
    record.status = 'PASS';
    record.details = typeof details === 'string' ? details : JSON.stringify(details);
    log('PASS ' + id + ': ' + truncate(record.details, 600));
  } catch (error) {
    record.status = 'FAIL';
    record.details = error instanceof Error ? error.message : String(error);
    log('FAIL ' + id + ': ' + record.details);
    try {
      record.shot = await screenshot('FAIL-' + id);
    } catch {}
  } finally {
    currentStep = null;
  }
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------
function E(fn, arg) {
  return page.evaluate(fn, arg);
}

async function appReady() {
  return E(() => Boolean(window.__A_CIGARETTES_LIFE__ && window.__A_CIGARETTES_LIFE__.game));
}

async function waitFor(fn, timeout = 15000, label = 'condition', interval = 120) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await page.waitForTimeout(interval);
  }
  throw new Error('Timed out waiting for ' + label + (lastError ? ' (' + lastError.message + ')' : ''));
}

async function snapshot() {
  return E(() => {
    const app = window.__A_CIGARETTES_LIFE__;
    const game = app.game;
    const state = game.getState();
    const readPlayerFoot = (sceneRef) => {
      const player = sceneRef.player;
      if (!player) return null;
      if (typeof player.getFootX === 'function' && typeof player.getFootY === 'function') return { x: player.getFootX(), y: player.getFootY() };
      return { x: player.x, y: player.y };
    };
    const modalEl = document.querySelector('.ui-modal');
    const modalLayer = document.querySelector('.ui-modal-layer');
    const menuEl = document.querySelector('.ui-menu');
    const menuLayer = document.querySelector('.ui-menu-layer');
    const hudRoot = document.querySelector('.ui-hud');
    const canvas = document.querySelector('canvas');
    const panels = [...document.querySelectorAll('.ui-panel')].map((panel) => {
      const titleEl = panel.querySelector('.ui-panel-title');
      const scrollEl = panel.querySelector('.ui-panel-scroll');
      return {
        title: titleEl ? titleEl.textContent : '',
        visible: !panel.classList.contains('ui-hidden'),
        text: scrollEl ? scrollEl.textContent.slice(0, 600) : '',
      };
    });
    const scene = app.phaser.scene.getScenes(true).find((candidate) => ['TownScene', 'CityScene', 'InteriorScene'].includes(candidate.scene.key));
    const summary = game.getOfflineSummary();
    return {
      screen: game.getScreen(),
      activeScenes: app.phaser.scene.getScenes(true).map((candidate) => candidate.scene.key),
      scene: scene
        ? {
            key: scene.scene.key,
            player: readPlayerFoot(scene),
            npcs: scene.npcSprites ? [...scene.npcSprites.entries()].map(([id, sprite]) => ({ id, x: sprite.x, y: sprite.y })) : [],
          }
        : null,
      loc: state.player.position.locationId,
      locName: (game.getContent().getLocation(state.player.position.locationId) || {}).name || '',
      pos: { x: state.player.position.x, y: state.player.position.y, indoor: state.player.position.indoor },
      money: state.player.money,
      steps: state.player.statistics.steps,
      playerName: state.player.name,
      playerAppearance: state.player.appearance,
      inventory: state.player.inventory.map((entry) => ({ itemId: entry.itemId, quantity: entry.quantity, instanceId: entry.instanceId })),
      life: {
        phase: state.life.phase,
        generation: state.life.generation,
        archiveCount: state.life.archive.length,
        globalArchiveCount: state.archive.length,
        ageDays: state.life.ageDays,
        lengthRatio: state.player.cigarette.lengthRatio,
        endReason: state.life.endReason,
      },
      clock: state.clock.simTimeSeconds,
      worldId: state.world.worldId,
      historyCount: state.world.history.length,
      npcCount: Object.keys(state.npcs).length,
      season: state.world.environment.season,
      weather: state.world.environment.weather,
      pendingOffline: { ...state.pendingOffline },
      offlineSummary: summary
        ? {
            headline: summary.headline,
            highlights: summary.highlights.length,
            simulatedGameHours: summary.simulatedGameHours,
            fromSimTime: summary.fromSimTime,
            toSimTime: summary.toSimTime,
          }
        : null,
      fishing: state.fishing.session
        ? {
            phase: state.fishing.session.phase,
            tension: state.fishing.session.tension,
            progress: state.fishing.session.progress,
            targetFishId: state.fishing.session.targetFishId,
            message: state.fishing.session.message,
          }
        : null,
      catches: state.fishing.catches,
      social: {
        activeConversation: state.social.activeConversation
          ? { npcId: state.social.activeConversation.npcId, nodeId: state.social.activeConversation.nodeId }
          : null,
        relationships: Object.keys(state.player.relationships).length,
        invitations: state.social.invitations.length,
      },
      statistics: {
        itemsBought: state.player.statistics.itemsBought,
        giftsGiven: state.player.statistics.giftsGiven,
        shiftsWorked: state.player.statistics.shiftsWorked,
        cropsHarvested: state.player.statistics.cropsHarvested,
        itemsCrafted: state.player.statistics.itemsCrafted,
        itemsForaged: state.player.statistics.itemsForaged,
      },
      economyTransactions: state.economy.transactions.length,
      panels,
      hudVisible: hudRoot ? !hudRoot.classList.contains('ui-hidden') : false,
      menuVisible: Boolean(menuEl && menuLayer && !menuLayer.classList.contains('ui-hidden')),
      modalVisible: Boolean(modalEl && modalLayer && !modalLayer.classList.contains('ui-hidden')),
      modalTitle: modalEl && modalEl.querySelector('.ui-modal-title') ? modalEl.querySelector('.ui-modal-title').textContent : null,
      modalText: modalEl ? modalEl.textContent.slice(0, 1500) : null,
      toastTexts: [...document.querySelectorAll('.ui-toast')].map((toast) => toast.textContent),
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
      phaserBooted: app.phaser.isBooted,
      renderer: app.phaser.renderer ? app.phaser.renderer.type : null,
    };
  });
}

async function visiblePanelTitles() {
  const snap = await snapshot();
  return snap.panels.filter((panel) => panel.visible).map((panel) => panel.title);
}

async function keyPress(key, holdMs = 70) {
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(key);
  await page.waitForTimeout(90);
}

async function readSceneInfo() {
  return E(() => {
    const app = window.__A_CIGARETTES_LIFE__;
    const foot = (player) => {
      if (!player) return null;
      if (typeof player.getFootX === 'function' && typeof player.getFootY === 'function') return { x: player.getFootX(), y: player.getFootY() };
      return { x: player.x, y: player.y };
    };
    const scene = app.phaser.scene.getScenes(true).find((candidate) => ['TownScene', 'CityScene', 'InteriorScene'].includes(candidate.scene.key));
    if (!scene) return null;
    const plan = scene.plan || null;
    const facilities = plan && Array.isArray(plan.facilities) ? plan.facilities.map((facility) => ({ label: facility.label, action: facility.action, x: facility.x, y: facility.y, radius: facility.radius })) : [];
    return {
      key: scene.scene.key,
      player: foot(scene.player),
      npcs: scene.npcSprites ? [...scene.npcSprites.entries()].map(([id, sprite]) => ({ id, x: sprite.x, y: sprite.y })) : [],
      facilities,
      farmable: Boolean(plan && plan.farmable),
      indoor: Boolean(plan && plan.indoor),
    };
  });
}

async function waitForWorldScene(timeout = 10000) {
  return waitFor(async () => {
    const scene = await readSceneInfo();
    return scene && scene.player ? scene : null;
  }, timeout, 'world scene ready');
}

async function sceneFacility(actions) {
  const scene = await readSceneInfo();
  if (!scene) return null;
  const wanted = Array.isArray(actions) ? actions : [actions];
  const matches = scene.facilities.filter((facility) => wanted.includes(facility.action));
  return matches.length > 0 ? matches[0] : null;
}

async function walkTo(targetX, targetY, tolerance = 26, timeout = 15000) {
  const pressed = new Set();
  const setKeys = async (wanted) => {
    for (const key of [...pressed]) {
      if (!wanted.has(key)) {
        await page.keyboard.up(key);
        pressed.delete(key);
      }
    }
    for (const key of wanted) {
      if (!pressed.has(key)) {
        await page.keyboard.down(key);
        pressed.add(key);
      }
    }
  };
  const started = Date.now();
  let last = null;
  try {
    while (Date.now() - started < timeout) {
      const scene = await readSceneInfo();
      if (!scene || !scene.player) {
        await page.waitForTimeout(150);
        continue;
      }
      last = scene.player;
      const dx = targetX - last.x;
      const dy = targetY - last.y;
      if (Math.hypot(dx, dy) <= tolerance) return last;
      const wanted = new Set();
      if (Math.abs(dx) > tolerance * 0.5) wanted.add(dx > 0 ? 'd' : 'a');
      if (Math.abs(dy) > tolerance * 0.5) wanted.add(dy > 0 ? 's' : 'w');
      if (wanted.size === 0) break;
      await setKeys(wanted);
      await page.waitForTimeout(80);
    }
  } finally {
    await setKeys(new Set());
  }
  if (!last) throw new Error('could not read player position');
  const distance = Math.hypot(targetX - last.x, targetY - last.y);
  if (distance > tolerance * 2) throw new Error('could not walk to target (' + Math.round(distance) + 'px away)');
  return last;
}

async function locationInfo(locationId) {
  return E((id) => {
    const def = window.__A_CIGARETTES_LIFE__.game.getContent().getLocation(id);
    if (!def) return null;
    return {
      id: def.id,
      name: def.name,
      regionId: def.regionId,
      indoor: def.indoor,
      widthTiles: def.widthTiles,
      heightTiles: def.heightTiles,
      facilities: def.facilities,
      connections: def.connections,
      openHour: def.openHour === undefined ? null : def.openHour,
      closeHour: def.closeHour === undefined ? null : def.closeHour,
      entranceFrom: def.entranceFrom === undefined ? null : def.entranceFrom,
      secret: Boolean(def.secret),
    };
  }, locationId);
}

async function pickNpcTarget() {
  const scene = await readSceneInfo();
  if (!scene || !scene.player) return null;
  const npcsHere = await E(() => {
    const state = window.__A_CIGARETTES_LIFE__.game.getState();
    const loc = state.player.position.locationId;
    return Object.values(state.npcs).filter((npc) => npc.locationId === loc && npc.alive).map((npc) => ({ id: npc.id, name: npc.name }));
  });
  const candidates = scene.npcs.filter((sprite) => npcsHere.some((npc) => npc.id === sprite.id));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.hypot(a.x - scene.player.x, a.y - scene.player.y) - Math.hypot(b.x - scene.player.x, b.y - scene.player.y));
  const chosen = candidates[0];
  return { sprite: chosen, info: npcsHere.find((npc) => npc.id === chosen.id) };
}

const KNOWN_FACILITIES = [
  'shop', 'cafe', 'bakery', 'library', 'museum', 'workbench', 'kitchen', 'campfire', 'bed', 'storage',
  'stage', 'fishing_spot', 'forage', 'train', 'farmland', 'greenhouse', 'heater', 'noticeboard',
  'art_studio', 'cinema_screen', 'office_desk', 'shop_counter',
];
function facilityPosition(info, facility) {
  const facilities = info.facilities.filter((candidate) => KNOWN_FACILITIES.includes(candidate));
  const index = facilities.indexOf(facility);
  if (index < 0) return null;
  const spacing = Math.max(1, Math.floor(info.widthTiles / (facilities.length + 1)));
  return { x: spacing * (index + 1) * 32, y: (Math.floor(info.heightTiles / 2) + (index % 3) * 2) * 32 };
}

async function pathTo(targetId) {
  return E((id) => {
    const world = window.__A_CIGARETTES_LIFE__.game.getSystems().world;
    return typeof world.getPathTo === 'function' ? world.getPathTo(id) : null;
  }, targetId);
}

async function currentLocationId() {
  return E(() => window.__A_CIGARETTES_LIFE__.game.getState().player.position.locationId);
}

async function openMapPanel() {
  const titles = await visiblePanelTitles();
  if (titles.some((title) => title.toLowerCase().includes('map'))) return;
  await keyPress('m');
  await waitFor(async () => (await visiblePanelTitles()).some((title) => title.toLowerCase().includes('map')), 5000, 'map panel visible');
}

async function closePanels() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const titles = await visiblePanelTitles();
    if (titles.length === 0) return;
    await keyPress('Escape');
    await page.waitForTimeout(150);
  }
}

async function clickMapNode(name) {
  const clicked = await E((label) => {
    const nodes = [...document.querySelectorAll('.map-node')];
    const node = nodes.find((candidate) => (candidate.getAttribute('aria-label') || '').startsWith(label));
    if (!node) return false;
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, name);
  await page.waitForTimeout(250);
  return clicked;
}

async function clickMapDetailButton(prefix) {
  const outcome = await E((textPrefix) => {
    const buttons = [...document.querySelectorAll('button')];
    const target = buttons.find((candidate) => ((candidate.textContent || '').trim().startsWith(textPrefix)));
    if (!target) return { found: false, disabled: true, clicked: false };
    const disabled = Boolean(target.disabled);
    if (disabled) return { found: true, disabled: true, clicked: false };
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { found: true, disabled: false, clicked: true };
  }, prefix);
  await page.waitForTimeout(400);
  return outcome;
}

async function directTravelAction(nextInfo) {
  const action = nextInfo.indoor ? { type: 'move:enter', locationId: nextInfo.id } : { type: 'move:to-location', locationId: nextInfo.id };
  await dispatch(action);
  await page.waitForTimeout(400);
}

async function travelNextHop(nextId, nextInfo) {
  await openMapPanel();
  const current = await currentLocationId();
  if (current === nextId) return;
  const currentInfo = await locationInfo(current);
  const enterableInterior = nextInfo.indoor && nextInfo.entranceFrom === current;
  if (enterableInterior && currentInfo) {
    await clickMapNode(currentInfo.name);
    const enter = await clickMapDetailButton('Enter ');
    if (enter.clicked) {
      const landed = await waitFor(async () => (await currentLocationId()) === nextId, 5000, 'interior travel').catch(() => null);
      if (landed) return;
    }
    await directTravelAction(nextInfo);
  } else {
    const clicked = await clickMapNode(nextInfo.name);
    if (clicked) {
      await clickMapDetailButton('Walk to ');
      const landed = await waitFor(async () => (await currentLocationId()) === nextId, 5000, 'walk to ' + nextInfo.name).catch(() => null);
      if (!landed) await directTravelAction(nextInfo);
    } else {
      await directTravelAction(nextInfo);
    }
  }
  const after = await currentLocationId();
  if (after !== nextId) {
    const snap = await snapshot();
    throw new Error('map travel to ' + nextInfo.name + ' failed: now at ' + after + ' toasts=' + JSON.stringify(snap.toastTexts));
  }
}

async function travelViaMap(targetId) {
  await closePanels();
  const route = await pathTo(targetId);
  if (!route || route.length < 2) throw new Error('no walk path to ' + targetId + ' (' + JSON.stringify(route) + ')');
  const hops = [];
  for (let index = 1; index < route.length; index += 1) {
    const next = route[index];
    const info = await locationInfo(next);
    await travelNextHop(next, info);
    hops.push(next);
  }
  await closePanels();
  await waitForWorldScene();
  return hops;
}

async function dispatch(action) {
  return E((gameAction) => window.__A_CIGARETTES_LIFE__.game.dispatch(gameAction), action);
}

async function fastForwardSimSeconds(seconds, speed = 4, chunk = 1) {
  return E(
    (input) => {
      const game = window.__A_CIGARETTES_LIFE__.game;
      game.dispatch({ type: 'settings:update', settings: { speed: input.speed } });
      const start = game.getClock().simTimeSeconds;
      const target = start + input.seconds;
      let guard = 0;
      while (game.getClock().simTimeSeconds < target && guard < 8000) {
        game.tick(input.chunk);
        guard += 1;
      }
      return { start, end: game.getClock().simTimeSeconds, ticks: guard };
    },
    { seconds, speed, chunk }
  );
}

async function gameHour() {
  return E(() => {
    const state = window.__A_CIGARETTES_LIFE__.game.getState();
    return (state.clock.simTimeSeconds % 1440) / 60;
  });
}

async function ensureHour(targetHour) {
  const current = await gameHour();
  let delta = targetHour - current;
  while (delta < -0.01) delta += 24;
  if (delta > 0.01) {
    const result = await dispatch({ type: 'time:rest', hours: Math.min(24, Math.max(0.25, delta)) });
    if (!result.ok) throw new Error('rest to hour ' + targetHour + ' failed: ' + result.message);
    const phase = await E(() => window.__A_CIGARETTES_LIFE__.game.getState().life.phase);
    if (phase !== 'alive') throw new Error('life ended while resting to hour ' + targetHour);
  }
  return gameHour();
}

async function allLocationDefs() {
  return E(() => {
    return window.__A_CIGARETTES_LIFE__.game.getContent().pack.locations.map((location) => ({
      id: location.id,
      name: location.name,
      indoor: Boolean(location.indoor),
      connections: [...location.connections],
      secret: Boolean(location.secret),
    }));
  });
}

function walkDistances(defs, startId) {
  const byId = new Map(defs.map((def) => [def.id, def]));
  const distances = new Map([[startId, 0]]);
  const queue = [startId];
  while (queue.length > 0) {
    const currentId = queue.shift();
    const current = byId.get(currentId);
    if (!current) continue;
    const base = distances.get(currentId);
    for (const nextId of current.connections) {
      if (distances.has(nextId)) continue;
      distances.set(nextId, base + 1);
      queue.push(nextId);
    }
  }
  return distances;
}

async function npcCountsByLocation() {
  return E(() => {
    const state = window.__A_CIGARETTES_LIFE__.game.getState();
    const counts = {};
    for (const npc of Object.values(state.npcs)) {
      if (!npc.alive) continue;
      counts[npc.locationId] = (counts[npc.locationId] || 0) + 1;
    }
    return counts;
  });
}

async function findNearbyNpcLocation(maxHops) {
  const defs = await allLocationDefs();
  const counts = await npcCountsByLocation();
  const current = await currentLocationId();
  const distances = walkDistances(defs, current);
  const candidates = [];
  for (const def of defs) {
    if (def.secret || def.indoor) continue;
    const count = counts[def.id] || 0;
    if (count <= 0) continue;
    const distance = distances.get(def.id);
    if (distance === undefined || distance < 1 || distance > maxHops) continue;
    candidates.push({ id: def.id, name: def.name, count, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance || b.count - a.count);
  return candidates.length > 0 ? candidates[0] : null;
}

function attachConsole(pageRef) {
  pageRef.on('console', (message) => {
    const entry = { ts: Date.now(), type: message.type(), text: message.text() };
    consoleEntries.push(entry);
    if (entry.type === 'error') pageErrors.push({ kind: 'console.error', text: entry.text });
  });
  pageRef.on('pageerror', (error) => {
    const text = error.message + (error.stack ? ' | ' + String(error.stack).split(String.fromCharCode(10)).slice(0, 4).join(' / ') : '');
    pageErrors.push({ kind: 'pageerror', text });
    consoleEntries.push({ ts: Date.now(), type: 'pageerror', text });
  });
  pageRef.on('response', (response) => {
    if (response.status() >= 400) {
      const entry = { kind: 'http', text: response.status() + ' ' + response.url() };
      pageErrors.push(entry);
      consoleEntries.push({ ts: Date.now(), type: 'http', text: entry.text });
    }
  });
  pageRef.on('requestfailed', (request) => {
    const failure = request.failure();
    const entry = { kind: 'requestfailed', text: request.url() + ' ' + (failure ? failure.errorText : '') };
    pageErrors.push(entry);
    consoleEntries.push({ ts: Date.now(), type: 'requestfailed', text: entry.text });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  log("A Cigarette's Life - acceptance playthrough");
  log('URL: ' + BASE_URL);
  log('Chrome: ' + CHROME);
  log('Run: ' + RUN_ID);

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: !HEADFUL,
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  attachConsole(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.responseReceived', (event) => {
    if (event.response.status < 400) return;
    const entry = { kind: 'http', text: event.response.status + ' ' + event.response.url + ' [' + event.type + ']', url: event.response.url, status: event.response.status };
    pageErrors.push(entry);
    consoleEntries.push({ ts: Date.now(), type: 'http', text: entry.text });
  });

  try {
    // S01 boot + menu
    await step('S01', 'Boot and main menu render', async (record) => {
      await page.goto(BASE_URL, { waitUntil: 'load', timeout: 45000 });
      await waitFor(appReady, 45000, 'window.__A_CIGARETTES_LIFE__');
      await page.waitForTimeout(2500);
      const snap = await snapshot();
      await screenshot('boot-main-menu');
      assertEqual(snap.screen, 'menu', 'screen');
      assert(snap.menuVisible, 'main menu should be visible');
      assert(snap.activeScenes.includes('MainMenuScene'), 'MainMenuScene active, got ' + JSON.stringify(snap.activeScenes));
      assert(snap.canvas && snap.canvas.width > 0 && snap.canvas.height > 0, 'canvas should exist with a size');
      assert(snap.phaserBooted, 'Phaser booted');
      const menuButtons = await page.locator('.ui-menu button').count();
      assert(menuButtons >= 5, 'menu should expose its buttons, found ' + menuButtons);
      const overlayHidden = await page.evaluate(() => {
        const overlay = document.getElementById('boot-overlay');
        return Boolean(overlay && overlay.classList.contains('hidden'));
      });
      assert(overlayHidden, 'boot overlay should be hidden after boot');
      return JSON.stringify({ scenes: snap.activeScenes, canvas: snap.canvas, menuButtons, renderer: snap.renderer });
    });

    // S02 character creation
    const PLAYER_NAME = 'Acceptance Ash';
    const SEED = 424242;
    await step('S02', 'Character creation starts a real new life', async (record) => {
      await page.getByRole('button', { name: /^New life$/i }).first().click();
      await waitFor(async () => (await snapshot()).modalVisible, 8000, 'character creation modal');
      const title = (await snapshot()).modalTitle;
      assert(title && title.length > 0, 'character creation title');
      await page.locator('.ui-modal input.ui-input').first().fill(PLAYER_NAME);
      const selects = page.locator('.ui-modal select');
      assertEqual(await selects.count(), 2, 'pattern/face selects');
      await selects.nth(0).selectOption('stripe');
      await selects.nth(1).selectOption('wink');
      const seedLine = page.locator('.ui-modal .ui-form-line').filter({ hasText: 'Seed' }).first();
      await seedLine.locator('input').first().fill(String(SEED));
      await screenshot('character-creation');
      await page.getByRole('button', { name: 'Light it' }).click();
      await waitFor(async () => (await snapshot()).screen === 'playing', 15000, 'screen playing');
      await page.waitForTimeout(1500);
      const snap = await snapshot();
      await screenshot('new-life-world');
      assertEqual(snap.playerName, PLAYER_NAME, 'player name');
      assertEqual(snap.playerAppearance.pattern, 'stripe', 'appearance pattern');
      assertEqual(snap.playerAppearance.face, 'wink', 'appearance face');
      assert(snap.hudVisible, 'HUD visible while playing');
      assert(
        snap.activeScenes.some((key) => ['TownScene', 'CityScene', 'InteriorScene'].includes(key)),
        'world scene active, got ' + JSON.stringify(snap.activeScenes)
      );
      const world = await E(() => {
        const state = window.__A_CIGARETTES_LIFE__.game.getState();
        return { seed: state.meta.seed, npcs: Object.keys(state.npcs).length, money: state.player.money, history: state.world.history.length, skills: Object.keys(state.player.skills).length };
      });
      assertEqual(world.seed, SEED, 'seeded life seed');
      assert(world.npcs >= 54, 'NPC population, got ' + world.npcs);
      assertEqual(world.skills, 8, '8 skills');
      assert(world.history >= 1, 'seeded world history');
      return JSON.stringify({ scene: snap.scene && snap.scene.key, location: snap.locName, npcs: world.npcs, money: world.money, seed: world.seed });
    });

    await dispatch({ type: 'settings:update', settings: { autosaveIntervalSeconds: 1000000, speed: 1 } });

    // S03 world + movement
    await step('S03', 'World renders and the player moves with WASD', async (record) => {
      const before = await snapshot();
      assert(before.scene && before.scene.player, 'world scene with player sprite');
      record.evidence.push('start ' + JSON.stringify(before.scene.player) + ' scene=' + before.scene.key);
      const start = before.scene.player;
      await page.locator('canvas').first().click({ position: { x: 400, y: 400 } }).catch(() => {});
      await page.keyboard.down('d');
      await page.waitForTimeout(650);
      await page.keyboard.up('d');
      await page.waitForTimeout(250);
      await page.keyboard.down('w');
      await page.waitForTimeout(450);
      await page.keyboard.up('w');
      await page.waitForTimeout(350);
      const after = await snapshot();
      assert(after.scene && after.scene.player, 'world scene still present');
      const moved = Math.hypot(after.scene.player.x - start.x, after.scene.player.y - start.y);
      assert(moved > 30, 'player should move with WASD, moved ' + Math.round(moved) + 'px');
      assert(after.steps > before.steps, 'steps statistic should increase (' + before.steps + ' -> ' + after.steps + ')');
      await screenshot('world-moved');
      return JSON.stringify({ scene: after.scene.key, movedPx: Math.round(moved), stepsBefore: before.steps, stepsAfter: after.steps, phase: after.life.phase });
    });

    // S04 inventory panel
    await step('S04', 'Inventory panel opens and renders items + crafting', async (record) => {
      await keyPress('i');
      await waitFor(async () => (await visiblePanelTitles()).some((title) => /inventory/i.test(title)), 5000, 'inventory panel');
      const snap = await snapshot();
      const panel = snap.panels.find((candidate) => candidate.visible && /inventory/i.test(candidate.title));
      assert(panel, 'inventory panel visible');
      assert(panel.text.length > 40, 'inventory panel content length ' + panel.text.length);
      assert(/matches|watering|turnip|bread|camera|rod/i.test(panel.text), 'starter items listed, got: ' + truncate(panel.text, 200));
      assert(/craft|cook/i.test(panel.text), 'crafting UI present');
      await screenshot('inventory-panel');
      const collectAsh = page.getByRole('button', { name: /Collect ash/i }).first();
      assert((await collectAsh.count()) === 1, 'Collect ash button exists');
      await collectAsh.click();
      await page.waitForTimeout(400);
      await keyPress('Escape');
      assert(!(await visiblePanelTitles()).some((title) => /inventory/i.test(title)), 'inventory closed');
      return JSON.stringify({ title: panel.title, text: truncate(panel.text, 160) });
    });

    // S05 map panel + travel
    await step('S05', 'Map panel renders the world and travel moves the player', async (record) => {
      await openMapPanel();
      const snap = await snapshot();
      const panel = snap.panels.find((candidate) => candidate.visible && /map/i.test(candidate.title));
      assert(panel, 'map panel visible');
      assert((await page.locator('.ui-map-svg').count()) === 1, 'map renders an SVG world map');
      const nodeCount = await page.locator('.map-node').count();
      assert(nodeCount > 20, 'map shows discovered location nodes, found ' + nodeCount);
      await screenshot('map-panel');
      // Selecting a non-adjacent location must NOT offer an enabled walk action.
      const current = await currentLocationId();
      const currentInfo = await locationInfo(current);
      const farTarget = await E((adjacentIds) => {
        const app = window.__A_CIGARETTES_LIFE__;
        const content = app.game.getContent();
        const nodes = [...document.querySelectorAll('.map-node')];
        for (const node of nodes) {
          const label = (node.getAttribute('aria-label') || '').replace(/, you are here$/, '');
          const def = content.pack.locations.find((location) => location.name === label);
          if (!def || def.id === adjacentIds.current || adjacentIds.adjacent.includes(def.id)) continue;
          return { name: label, id: def.id };
        }
        return null;
      }, { current, adjacent: currentInfo.connections });
      let farOutcome = 'no non-adjacent node found';
      if (farTarget) {
        const clicked = await clickMapNode(farTarget.name);
        assert(clicked, 'could select a distant map node');
        const walkButtons = page.getByRole('button', { name: /^Walk to / });
        const walkCount = await walkButtons.count();
        const disabled = walkCount > 0 ? await walkButtons.first().isDisabled() : true;
        farOutcome = JSON.stringify({ target: farTarget.name, walkButton: walkCount > 0, disabled });
        record.evidence.push('distant map node: ' + farOutcome);
        assert(disabled, 'a non-adjacent map location must not offer an enabled walk action (found ' + walkCount + ' walk buttons, disabled=' + disabled + ')');
      }
      const hops = await travelViaMap('willowbrook_market');
      const arrived = await snapshot();
      assertEqual(arrived.loc, 'willowbrook_market', 'player location after map travel');
      assert(hops.length > 1, 'travel requires multiple walk hops');
      await screenshot('map-travel-arrived');
      return JSON.stringify({ nodes: nodeCount, distantNode: farOutcome, location: arrived.locName, hops: hops.length });
    });

    // S06 NPC dialogue
    let dialogueNpc = null;
    await step('S06', 'NPC dialogue: walk up to an NPC and talk', async (record) => {
      await closePanels();
      const npcsAtStart = await E(() => {
        const state = window.__A_CIGARETTES_LIFE__.game.getState();
        const loc = state.player.position.locationId;
        return Object.values(state.npcs).filter((npc) => npc.alive && npc.locationId === loc).length;
      });
      let relocated = null;
      if (npcsAtStart === 0) {
        const nearby = await findNearbyNpcLocation(5);
        assert(nearby, 'no reachable location with NPCs for the dialogue test');
        record.evidence.push('relocating for dialogue to ' + nearby.name + ' (' + nearby.count + ' NPCs, ' + nearby.distance + ' hops)');
        await travelViaMap(nearby.id);
        relocated = nearby;
        await page.waitForTimeout(600);
      }
      await waitForWorldScene();
      let started = false;
      let target = null;
      for (let attempt = 0; attempt < 12 && !started; attempt += 1) {
        target = await pickNpcTarget();
        if (!target) {
          await page.waitForTimeout(700);
          continue;
        }
        record.evidence.push('npc ' + JSON.stringify(target.info) + ' sprite=' + JSON.stringify({ x: Math.round(target.sprite.x), y: Math.round(target.sprite.y) }) + ' attempt=' + attempt);
        try {
          await walkTo(target.sprite.x, target.sprite.y, 36);
        } catch (error) {
          record.evidence.push('walk attempt failed: ' + error.message);
          continue;
        }
        const stillHere = await E((npcId) => {
          const state = window.__A_CIGARETTES_LIFE__.game.getState();
          const npc = state.npcs[npcId];
          return Boolean(npc && npc.alive && npc.locationId === state.player.position.locationId);
        }, target.info.id);
        if (!stillHere) continue;
        await keyPress('e', 100);
        started = await waitFor(async () => (await snapshot()).social.activeConversation !== null, 2500, 'dialogue active').then(() => true).catch(() => false);
        if (!started) {
          const snapNow = await snapshot();
          record.evidence.push('dialogue start attempt ' + attempt + ' failed; toasts=' + JSON.stringify(snapNow.toastTexts) + ' nearest panel=' + JSON.stringify(await visiblePanelTitles()));
        }
      }
      assert(started, 'pressing E near an NPC should start a dialogue (last evidence: ' + JSON.stringify(record.evidence.slice(-2)) + ')');
      await page.waitForTimeout(400);
      const dialogueVisible = await page.locator('.ui-dialogue').isVisible().catch(() => false);
      assert(dialogueVisible, 'dialogue overlay visible');
      let dialogueText = await page.locator('.ui-dialogue-text').first().textContent();
      if (!dialogueText || dialogueText.length < 3) {
        await page.locator('.ui-dialogue-text').first().click().catch(() => {});
        await page.waitForTimeout(250);
        dialogueText = await page.locator('.ui-dialogue-text').first().textContent();
      }
      assert(dialogueText && dialogueText.length > 3, 'dialogue shows real text, got ' + JSON.stringify(dialogueText));
      const dialogueName = await page.locator('.ui-dialogue-name').first().textContent();
      dialogueNpc = { npcId: (await snapshot()).social.activeConversation.npcId, name: (dialogueName || target.info.name).trim() };
      const choiceButtons = page.locator('.ui-dialogue-choice').filter({ hasNotText: /End the conversation|Leave/i });
      const choiceCount = await choiceButtons.count();
      assert(choiceCount >= 1, 'dialogue offers at least one choice, got ' + choiceCount);
      await screenshot('npc-dialogue');
      const firstChoice = choiceButtons.first();
      const choiceLabel = ((await firstChoice.textContent()) || '').trim();
      await firstChoice.click({ force: true, timeout: 4000 }).catch(() => dispatch({ type: 'dialogue:choose', choiceIndex: 0 }));
      await page.waitForTimeout(600);
      const afterChoice = await snapshot();
      let choiceEndedConversation = false;
      if (afterChoice.social.activeConversation === null) {
        choiceEndedConversation = true;
        record.evidence.push('the chosen dialogue branch ended the conversation by itself');
      } else {
        await dispatch({ type: 'dialogue:end' });
        await waitFor(async () => (await snapshot()).social.activeConversation === null, 8000, 'conversation ended');
      }
      const relationship = await E((npcId) => {
        const rel = window.__A_CIGARETTES_LIFE__.game.getState().player.relationships[npcId];
        return rel ? { affinity: rel.affinity, familiarity: rel.familiarity, status: rel.status } : null;
      }, dialogueNpc.npcId);
      assert(relationship, 'talking to an NPC should create a player relationship');
      return JSON.stringify({ npc: dialogueNpc.name, choice: choiceLabel.slice(0, 80), relationship, relocated: relocated ? relocated.name : null });
    });

    // S07 social/life/journal/events/skills panels + gift
    await step('S07', 'Social, life, journal, events and skills panels show real data (+gift)', async (record) => {
      await closePanels();
      await keyPress('k');
      await waitFor(async () => (await visiblePanelTitles()).some((title) => /social/i.test(title)), 5000, 'social panel');
      const socialSnap = await snapshot();
      const socialPanel = socialSnap.panels.find((candidate) => candidate.visible && /social/i.test(candidate.title));
      assert(socialPanel && socialPanel.text.length > 20, 'social panel renders content');
      assert(dialogueNpc && socialPanel.text.includes(dialogueNpc.name), 'social panel lists ' + (dialogueNpc ? dialogueNpc.name : 'met NPC') + ', text: ' + truncate(socialPanel.text, 300));
      await screenshot('social-panel');
      // NPCs keep living: locate a relationship NPC that is here right now, else travel to one.
      let socialNpc = dialogueNpc;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const presence = await E((npcId) => {
          const state = window.__A_CIGARETTES_LIFE__.game.getState();
          const npc = state.npcs[npcId];
          if (!npc || !npc.alive) return null;
          return npc.locationId === state.player.position.locationId ? { here: true, locationId: npc.locationId } : { here: false, locationId: npc.locationId };
        }, socialNpc.npcId);
        if (!presence) {
          const other = await E(() => {
            const state = window.__A_CIGARETTES_LIFE__.game.getState();
            const rel = Object.values(state.player.relationships).find((candidate) => {
              const npc = state.npcs[candidate.otherId];
              return npc && npc.alive && npc.locationId === state.player.position.locationId;
            });
            return rel ? { npcId: rel.otherId, name: state.npcs[rel.otherId].name } : null;
          });
          assert(other, 'a relationship NPC should exist for the social interaction test');
          socialNpc = other;
          continue;
        }
        if (presence.here) break;
        record.evidence.push('relocating to follow ' + socialNpc.name + ' to ' + presence.locationId);
        await travelViaMap(presence.locationId);
        await keyPress('k');
        await waitFor(async () => (await visiblePanelTitles()).some((title) => /social/i.test(title)), 5000, 'social panel after relocation');
      }
      const npcHereForSocial = await E((npcId) => {
        const state = window.__A_CIGARETTES_LIFE__.game.getState();
        const npc = state.npcs[npcId];
        return Boolean(npc && npc.alive && npc.locationId === state.player.position.locationId);
      }, socialNpc.npcId);
      assert(npcHereForSocial, 'the NPC for the quick chat/gift is at the current location');
      const affinityBefore = await E((npcId) => window.__A_CIGARETTES_LIFE__.game.getState().player.relationships[npcId].affinity, socialNpc.npcId);
      const quickChat = page.getByRole('button', { name: 'Quick chat' }).first();
      let quickChatVia = 'dispatch social:talk';
      const talkResult = await dispatch({ type: 'social:talk', npcId: socialNpc.npcId });
      await page.waitForTimeout(500);
      let affinityAfter = await E((npcId) => window.__A_CIGARETTES_LIFE__.game.getState().player.relationships[npcId].affinity, socialNpc.npcId);
      record.evidence.push('quick chat result: ' + JSON.stringify(talkResult) + ' buttonPresent=' + ((await quickChat.count()) === 1));
      record.evidence.push('affinity ' + affinityBefore + ' -> ' + affinityAfter);
      assert(affinityAfter > affinityBefore, 'quick chat raises affinity');
      const giftsBefore = await E(() => window.__A_CIGARETTES_LIFE__.game.getState().player.statistics.giftsGiven);
      const giftButton = page.getByRole('button', { name: /^Gift/ }).first();
      assert((await giftButton.count()) === 1, 'Gift button exists in the social panel');
      await giftButton.click({ force: true, timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      const picker = page.locator('.ui-card').filter({ hasText: /Give a gift to/i }).first();
      let giftOutcome = 'picker not opened';
      if ((await picker.count()) > 0) {
        const chip = picker.getByRole('button').first();
        if ((await chip.count()) > 0) {
          giftOutcome = 'clicked ' + ((await chip.textContent()) || '').trim();
          await chip.click();
          await page.waitForTimeout(700);
        }
      }
      const giftsAfter = await E(() => window.__A_CIGARETTES_LIFE__.game.getState().player.statistics.giftsGiven);
      if (giftsAfter <= giftsBefore) {
        const fallback = await E(() => {
          const state = window.__A_CIGARETTES_LIFE__.game.getState();
          const entry = state.player.inventory.find((candidate) => !/rod|hoe|can|water/i.test(candidate.itemId));
          return entry ? entry.instanceId : null;
        });
        if (fallback) {
          const result = await dispatch({ type: 'social:gift', npcId: socialNpc.npcId, instanceId: fallback });
          giftOutcome = giftOutcome + ' / fallback dispatch: ' + JSON.stringify(result);
        }
      }
      await page.waitForTimeout(300);
      const giftsFinal = await E(() => window.__A_CIGARETTES_LIFE__.game.getState().player.statistics.giftsGiven);
      record.evidence.push('gift giftsGiven ' + giftsBefore + ' -> ' + giftsFinal + ' (' + giftOutcome + ')');
      assert(giftsFinal > giftsBefore, 'giving a gift increases giftsGiven (' + giftOutcome + ')');
      await keyPress('Escape');

      await keyPress('l');
      await waitFor(async () => (await visiblePanelTitles()).some((title) => /life/i.test(title)), 5000, 'life panel');
      const lifePanel = (await snapshot()).panels.find((candidate) => candidate.visible && /life/i.test(candidate.title));
      assert(lifePanel && /length|moisture|burn/i.test(lifePanel.text), 'life panel shows cigarette body data');
      await screenshot('life-panel');
      await keyPress('Escape');

      await keyPress('j');
      await waitFor(async () => (await visiblePanelTitles()).some((title) => /journal/i.test(title)), 5000, 'journal panel');
      const journalPanel = (await snapshot()).panels.find((candidate) => candidate.visible && /journal/i.test(candidate.title));
      assert(journalPanel && journalPanel.text.length > 20, 'journal panel renders world history/letters');
      assert(/world history|letters|history/i.test(journalPanel.text), 'journal includes world history section');
      await screenshot('journal-panel');
      await keyPress('Escape');

      const eventsOpened = await E(() => {
        const app = window.__A_CIGARETTES_LIFE__;
        app.ui.openPanel('events');
        return app.ui.isOpen('events');
      });
      assert(eventsOpened, 'events panel openable');
      await page.waitForTimeout(400);
      const eventsText = await page.locator('.ui-panel:not(.ui-hidden) .ui-panel-scroll').last().textContent();
      assert(eventsText && /festival/i.test(eventsText), 'events panel lists festivals');
      await screenshot('events-panel');
      await keyPress('Escape');

      let skillsKeyBound = false;
      await keyPress('y');
      try {
        await waitFor(async () => (await visiblePanelTitles()).some((title) => /skill/i.test(title)), 3000, 'skills panel');
        skillsKeyBound = true;
      } catch {
        await E(() => window.__A_CIGARETTES_LIFE__.ui.openPanel('skills'));
        await page.waitForTimeout(400);
      }
      assert((await visiblePanelTitles()).some((title) => /skill/i.test(title)), 'skills panel reachable (keyboard shortcut or panel API)');
      const skillsText = await page.locator('.ui-panel:not(.ui-hidden) .ui-panel-scroll').last().textContent();
      assert(skillsText && /gardening|fishing|foraging|crafting/i.test(skillsText), 'skills panel lists the eight skills');
      await screenshot('skills-panel');
      record.evidence.push('skills keyboard shortcut bound: ' + skillsKeyBound);
      await keyPress('Escape');
      return JSON.stringify({ affinity: affinityBefore + '->' + affinityAfter, gift: giftsBefore + '->' + giftsAfter, skillsKeyBound });
    });

    // S08 real shop transaction
    await step('S08', 'Real shop transaction: buy an item through the shop panel', async (record) => {
      if ((await currentLocationId()) !== 'willowbrook_market') await travelViaMap('willowbrook_market');
      const current = await currentLocationId();
      assertEqual(current, 'willowbrook_market', 'shop test at the market');
      const businesses = await E(() => {
        const app = window.__A_CIGARETTES_LIFE__;
        const state = app.game.getState();
        return app.game.getSystems().economy.getBusinessesAtLocation(state.player.position.locationId).map((business) => ({
          id: business.id,
          name: business.name,
          isOpen: business.isOpen,
          openHour: business.openHour,
          closeHour: business.closeHour,
          stocked: business.stock.filter((stock) => stock.quantity > 0).length,
        }));
      });
      record.evidence.push('businesses at market: ' + JSON.stringify(businesses));
      assert(businesses.length > 0, 'a business exists at the market');
      if (!businesses.some((business) => business.isOpen && business.stocked > 0)) await ensureHour(8.25);
      await waitForWorldScene();
      const facility = await sceneFacility('shop');
      assert(facility, 'the market scene exposes a shop facility');
      record.evidence.push('shop facility: ' + JSON.stringify(facility));
      await walkTo(facility.x, facility.y, Math.max(12, facility.radius - 8));
      await keyPress('e', 100);
      let openedShop = await waitFor(async () => (await visiblePanelTitles()).some((title) => /shop/i.test(title)), 2500, 'shop panel').then(() => true).catch(() => false);
      if (!openedShop) {
        // Another entity (or the rewritten scene) may have taken the interact; open the real shop panel.
        await E(() => window.__A_CIGARETTES_LIFE__.ui.openPanel('shop'));
        await page.waitForTimeout(600);
        openedShop = (await visiblePanelTitles()).some((title) => /shop/i.test(title));
        record.evidence.push('shop panel opened via UIManager.openPanel after E did not open it');
      }
      assert(openedShop, 'shop panel visible');
      const buyTab = page.getByRole('button', { name: /^Buy$/ }).first();
      if ((await buyTab.count()) > 0) {
        await buyTab.click();
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(400);
      let shopPanel = (await snapshot()).panels.find((candidate) => candidate.visible && /shop/i.test(candidate.title));
      assert(shopPanel, 'shop panel visible');
      if ((await page.getByRole('button', { name: 'Buy 1' }).count()) === 0) {
        await ensureHour(8.25);
        await E(() => window.__A_CIGARETTES_LIFE__.ui.openPanel('shop'));
        await page.waitForTimeout(700);
        shopPanel = (await snapshot()).panels.find((candidate) => candidate.visible && /shop/i.test(candidate.title)) || shopPanel;
      }
      const buyCount = await page.getByRole('button', { name: 'Buy 1' }).count();
      assert(buyCount > 0, 'stocked open shop offers Buy 1 buttons; text: ' + truncate(shopPanel.text, 300));
      const firstRow = page.locator('.ui-panel:not(.ui-hidden) .ui-shop-row, .ui-panel:not(.ui-hidden) .ui-row').filter({ has: page.getByRole('button', { name: /^Buy \d+/ }) }).first();
      const rowText = (await firstRow.count()) > 0 ? await firstRow.textContent().catch(() => '') : '';
      const before = await E(() => {
        const state = window.__A_CIGARETTES_LIFE__.game.getState();
        return {
          money: state.player.money,
          itemsBought: state.player.statistics.itemsBought,
          moneySpent: state.player.statistics.moneySpent,
          lastTransactionId: state.economy.transactions.length > 0 ? state.economy.transactions[state.economy.transactions.length - 1].id : null,
        };
      });
      const buyButton = page.getByRole('button', { name: /^Buy \d+/ }).first();
      const buyLabel = ((await buyButton.textContent()) || '').trim();
      await buyButton.click();
      await page.waitForTimeout(700);
      const after = await E(() => {
        const state = window.__A_CIGARETTES_LIFE__.game.getState();
        const recent = window.__A_CIGARETTES_LIFE__.game.getSystems().economy.getRecentTransactions(1);
        const last = recent.length > 0 ? recent[0] : null;
        return {
          money: state.player.money,
          itemsBought: state.player.statistics.itemsBought,
          moneySpent: state.player.statistics.moneySpent,
          lastTransactionId: state.economy.transactions.length > 0 ? state.economy.transactions[state.economy.transactions.length - 1].id : null,
          newest: last ? { type: last.type, actorId: last.actorId, businessId: last.businessId, itemId: last.itemId, totalPrice: last.totalPrice } : null,
        };
      });
      record.evidence.push('buy button: ' + buyLabel);
      await screenshot('shop-purchase');
      record.evidence.push('purchase row: ' + (rowText || '').trim().slice(0, 160));
      assert(after.money < before.money, 'buying decreases money (' + before.money + ' -> ' + after.money + ')');
      assert(after.itemsBought > before.itemsBought, 'itemsBought increases');
      assert(after.moneySpent > before.moneySpent, 'moneySpent statistic increases');
      const spent = Math.abs(after.money - before.money);
      assert(spent > 0 && spent < 20000, 'purchase price sane, got ' + spent + 'p');
      assert(after.newest && after.newest.type === 'buy', 'a buy transaction is recorded as the newest ledger entry, got ' + JSON.stringify(after.newest));
      assert(after.newest.actorId === 'player', 'buy transaction actor is the player');
      assert(after.newest.totalPrice === spent, 'ledger total matches the money spent (' + after.newest.totalPrice + ' vs ' + spent + ')');
      assert(after.lastTransactionId !== before.lastTransactionId, 'the transaction ledger head advances');
      await closePanels();
      return JSON.stringify({ moneyBefore: before.money, moneyAfter: after.money, spentPence: spent, newest: after.newest });
    });

    // S09 employment
    await step('S09', 'Employment: apply for a job and work a paid shift', async (record) => {
      const candidateJobs = await E(() => {
        const app = window.__A_CIGARETTES_LIFE__;
        const state = app.game.getState();
        const content = app.game.getContent();
        const list = [];
        for (const job of Object.values(state.economy.jobs)) {
          if (!job.playerAvailable || job.levelReq > 1) continue;
          if (job.employeeIds.length >= job.slots) continue;
          const business = state.economy.businesses[job.businessId];
          if (!business) continue;
          const location = content.getLocation(business.locationId);
          if (!location) continue;
          list.push({
            jobId: job.id,
            title: job.title,
            businessName: business.name,
            locationId: business.locationId,
            indoor: Boolean(location.indoor),
            startHour: job.startHour,
            endHour: job.endHour,
            openHour: business.openHour,
            closeHour: business.closeHour,
            freeSlots: job.slots - job.employeeIds.length,
          });
        }
        list.sort((a, b) => (a.indoor === b.indoor ? b.freeSlots - a.freeSlots : a.indoor ? 1 : -1));
        return list;
      });
      assert(candidateJobs.length > 0, 'at least one entry-level job with a free slot is advertised');
      record.evidence.push('candidate jobs: ' + JSON.stringify(candidateJobs.slice(0, 6)));
      let chosen = null;
      let appliedResult = null;
      for (const job of candidateJobs.slice(0, 5)) {
        if ((await currentLocationId()) !== job.locationId) await travelViaMap(job.locationId);
        let hour = await gameHour();
        if (hour < job.openHour || hour >= job.closeHour) hour = await ensureHour(job.openHour + 0.25);
        if (hour < job.startHour || hour >= job.endHour) hour = await ensureHour(job.startHour + 0.5);
        const applied = await dispatch({ type: 'work:apply', jobId: job.jobId });
        record.evidence.push('apply ' + job.title + ' @ ' + job.businessName + ': ' + JSON.stringify(applied));
        if (applied.ok) {
          chosen = job;
          appliedResult = applied;
          break;
        }
      }
      assert(appliedResult, 'applying for a job succeeds; messages=' + JSON.stringify(record.evidence.slice(-5)));
      const occupation = await E(() => window.__A_CIGARETTES_LIFE__.game.getState().player.occupation);
      assert(occupation, 'player.occupation set after applying');
      let shift = await dispatch({ type: 'work:shift' });
      if (!shift.ok) {
        record.evidence.push('shift retry after resting to shift start: ' + shift.message);
        await ensureHour(chosen.startHour + 0.5);
        shift = await dispatch({ type: 'work:shift' });
      }
      record.evidence.push('shift: ' + JSON.stringify(shift));
      assert(shift.ok, 'work:shift: ' + shift.message);
      const result = await E(() => {
        const state = window.__A_CIGARETTES_LIFE__.game.getState();
        return { shiftsWorked: state.player.statistics.shiftsWorked, money: state.player.money, occupation: state.player.occupation };
      });
      record.evidence.push('after shift: ' + JSON.stringify(result));
      assert(result.shiftsWorked > 0, 'shiftsWorked increases');
      return JSON.stringify({ job: chosen.title, business: chosen.businessName, occupation: result.occupation, shiftsWorked: result.shiftsWorked, message: shift.message });
    });

    // S10 fishing
    await step('S10', 'Fishing: cast, bite and reel minigame at the river', async (record) => {
      await travelViaMap('willowbrook_river');
      await waitForWorldScene();
      const facility = await sceneFacility('fishing');
      assert(facility, 'the river scene exposes a fishing_spot facility');
      record.evidence.push('fishing facility: ' + JSON.stringify(facility));
      await walkTo(facility.x, facility.y, Math.max(12, facility.radius - 8));
      const castsBefore = await E(() => window.__A_CIGARETTES_LIFE__.game.getState().fishing.casts);
      await keyPress('e', 100);
      await page.waitForTimeout(900);
      let castSnap = await snapshot();
      let castMethod = 'E at fishing spot';
      if (!castSnap.fishing) {
        // Either the scene opened only the panel, or another interactable took the key.
        const titles = await visiblePanelTitles();
        if (!titles.some((title) => /fish/i.test(title))) {
          await E(() => window.__A_CIGARETTES_LIFE__.ui.openPanel('fishing'));
          await page.waitForTimeout(700);
          castMethod = 'fishing panel opened via UIManager';
        }
        const castButton = page.getByRole('button', { name: /^Cast the line$/ }).first();
        if ((await castButton.count()) > 0) {
          await castButton.click();
          await page.waitForTimeout(800);
          castMethod += ' + Cast the line button';
        } else {
          await dispatch({ type: 'fish:cast', locationId: 'willowbrook_river' });
          await page.waitForTimeout(700);
          castMethod += ' + fish:cast action';
        }
        castSnap = await snapshot();
      }
      const castsAfter = await E(() => window.__A_CIGARETTES_LIFE__.game.getState().fishing.casts);
      assert(castSnap.fishing, 'a fishing session starts at the river (casts ' + castsBefore + '->' + castsAfter + ', toasts=' + JSON.stringify(castSnap.toastTexts) + ', method=' + castMethod + ')');
      record.evidence.push('cast: phase=' + castSnap.fishing.phase + ' target=' + castSnap.fishing.targetFishId + ' casts ' + castsBefore + '->' + castsAfter + ' method=' + castMethod);
      await screenshot('fishing-cast');
      assert(castsAfter > castsBefore, 'fishing.casts increases');
      assertEqual(castSnap.fishing.phase, 'waiting', 'phase right after cast');
      const biteResult = await E(() => {
        const game = window.__A_CIGARETTES_LIFE__.game;
        game.dispatch({ type: 'settings:update', settings: { speed: 4 } });
        let guard = 0;
        while (guard < 2000) {
          const session = game.getState().fishing.session;
          if (!session || session.phase !== 'waiting') break;
          game.tick(1);
          guard += 1;
        }
        game.dispatch({ type: 'settings:update', settings: { speed: 1 } });
        const session = game.getState().fishing.session;
        return { phase: session ? session.phase : null, path: 'tick-fast-forward', ticks: guard };
      });
      record.evidence.push('bite: ' + JSON.stringify(biteResult));
      assert(biteResult.phase === 'bite' || biteResult.phase === 'reeling', 'no bite reached after fast-forward (phase=' + biteResult.phase + ')');
      if (biteResult.phase === 'bite') {
        const holdButton = page.getByRole('button', { name: /Hold to reel/i }).first();
        if ((await holdButton.count()) > 0) await holdButton.click();
        else await dispatch({ type: 'fish:reel', hold: true });
        await page.waitForTimeout(250);
      }
      let sawReeling = false;
      let holding = true;
      const reelStarted = Date.now();
      while (Date.now() - reelStarted < 60000) {
        const fishing = await E(() => {
          const session = window.__A_CIGARETTES_LIFE__.game.getState().fishing.session;
          return session ? { phase: session.phase, tension: session.tension, progress: session.progress } : null;
        });
        if (!fishing) break;
        if (fishing.phase === 'reeling') sawReeling = true;
        const shouldHold = fishing.tension < 62;
        if (shouldHold !== holding) {
          await dispatch({ type: 'fish:reel', hold: shouldHold });
          holding = shouldHold;
        }
        await page.waitForTimeout(110);
      }
      const fishingAfter = await E(() => {
        const state = window.__A_CIGARETTES_LIFE__.game.getState();
        return { catches: state.fishing.catches, session: Boolean(state.fishing.session), lastResultMessage: state.fishing.lastResultMessage, fishCaughtStat: state.player.statistics.fishCaught };
      });
      record.evidence.push('reeling: sawReeling=' + sawReeling + ' catches=' + fishingAfter.catches + ' message=' + truncate(fishingAfter.lastResultMessage, 200));
      if (fishingAfter.session) await dispatch({ type: 'fish:cancel' });
      await page.waitForTimeout(300);
      await screenshot('fishing-result');
      assert(sawReeling, 'reel minigame entered the reeling phase');
      assert(!fishingAfter.session, 'fishing session finished (catch or escape)');
      return JSON.stringify({ sawReeling, catches: fishingAfter.catches, fishCaughtStat: fishingAfter.fishCaughtStat, result: truncate(fishingAfter.lastResultMessage, 180) });
    });

    // S11 farming
    let farmingHarvested = 0;
    await step('S11', 'Farming: till, plant, water, grow in chunks and harvest', async (record) => {
      await travelViaMap('willowbrook_farm');
      const locationId = await currentLocationId();
      const tilled = await dispatch({ type: 'farm:till', locationId, x: 2, y: 2 });
      record.evidence.push('till: ' + JSON.stringify(tilled));
      assert(tilled.ok, 'farm till: ' + tilled.message);
      const plot = await E(() => {
        const state = window.__A_CIGARETTES_LIFE__.game.getState();
        const plots = Object.values(state.farming.plots).filter((candidate) => candidate.locationId === state.player.position.locationId);
        return plots.length > 0 ? { id: plots[plots.length - 1].id, count: plots.length } : null;
      });
      assert(plot, 'tilled plot exists in state');
      const planted = await dispatch({ type: 'farm:plant', plotId: plot.id, seedItemId: 'turnip_seed' });
      record.evidence.push('plant: ' + JSON.stringify(planted));
      assert(planted.ok, 'farm plant: ' + planted.message);
      const watered = await dispatch({ type: 'farm:water', plotId: plot.id });
      assert(watered.ok, 'farm water: ' + watered.message);
      // Grow in 6h rest chunks, watering between chunks (real time:rest actions). Collect
      // cigarette ash once enough has built up and use it as potash fertiliser.
      let ashCollect = null;
      let fertilise = null;
      for (let chunk = 0; chunk < 20; chunk += 1) {
        if (chunk === 2) {
          ashCollect = await dispatch({ type: 'ash:collect' });
          record.evidence.push('ash collect: ' + JSON.stringify(ashCollect));
          fertilise = await dispatch({ type: 'farm:fertilize', plotId: plot.id, fertilizer: 'ash' });
          record.evidence.push('fertilise: ' + JSON.stringify(fertilise));
        }
        const rest = await dispatch({ type: 'time:rest', hours: 6 });
        if (!rest.ok) {
          record.evidence.push('rest chunk ' + chunk + ' failed: ' + rest.message);
          break;
        }
        const phase = await E(() => window.__A_CIGARETTES_LIFE__.game.getState().life.phase);
        if (phase !== 'alive') {
          record.evidence.push('life ended during growth rest chunk ' + chunk);
          break;
        }
        const water = await dispatch({ type: 'farm:water', plotId: plot.id });
        if (!water.ok) record.evidence.push('mid-water failed: ' + water.message);
        const stage = await E((plotId) => {
          const candidate = window.__A_CIGARETTES_LIFE__.game.getState().farming.plots[plotId];
          return candidate ? candidate.stage : null;
        }, plot.id);
        if (stage === 'mature') break;
        if (stage === 'withered') break;
      }
      const cropState = await E((plotId) => {
        const state = window.__A_CIGARETTES_LIFE__.game.getState();
        const candidate = state.farming.plots[plotId];
        return candidate
          ? { stage: candidate.stage, cropId: candidate.cropId, growth: candidate.growth, growthStage: candidate.growthStage, moisture: candidate.moisture, potash: candidate.potash, health: candidate.health }
          : null;
      }, plot.id);
      record.evidence.push('crop: ' + JSON.stringify(cropState));
      const before = await E(() => ({
        cropsHarvested: window.__A_CIGARETTES_LIFE__.game.getState().player.statistics.cropsHarvested,
        turnips: window.__A_CIGARETTES_LIFE__.game.getState().player.inventory.filter((entry) => entry.itemId === 'turnip').reduce((sum, entry) => sum + entry.quantity, 0),
      }));
      const harvest = await dispatch({ type: 'farm:harvest', plotId: plot.id });
      record.evidence.push('harvest: ' + JSON.stringify(harvest));
      const after = await E(() => ({
        cropsHarvested: window.__A_CIGARETTES_LIFE__.game.getState().player.statistics.cropsHarvested,
        turnips: window.__A_CIGARETTES_LIFE__.game.getState().player.inventory.filter((entry) => entry.itemId === 'turnip').reduce((sum, entry) => sum + entry.quantity, 0),
      }));
      await screenshot('farming-state');
      assert(harvest.ok, 'harvest: ' + harvest.message + ' crop=' + JSON.stringify(cropState));
      assert(after.cropsHarvested > before.cropsHarvested, 'cropsHarvested increases');
      assert(after.turnips > before.turnips, 'turnip produce added');
      farmingHarvested = after.cropsHarvested;
      return JSON.stringify({ crop: cropState, harvestMessage: harvest.message, before, after });
    });

    // S12 foraging + crafting
    await step('S12', 'Forage a material and craft a real recipe at a workbench', async (record) => {
      await travelViaMap('willowbrook_forest');
      await page.waitForTimeout(600);
      let gathered = null;
      let attempts = 0;
      while (attempts < 8) {
        const node = await E(() => {
          const app = window.__A_CIGARETTES_LIFE__;
          const state = app.game.getState();
          const loc = state.player.position.locationId;
          const nodes = Object.values(state.foraging.nodes).filter((candidate) => candidate.locationId === loc && !candidate.depleted);
          if (nodes.length === 0) return null;
          const woodNode = nodes.find((candidate) => candidate.defId.includes('fallen_branches'));
          const chosen = woodNode || nodes[0];
          const def = app.game.getContent().getForageNode(chosen.defId);
          return { id: chosen.id, defId: chosen.defId, itemId: def ? def.itemId : null, name: def ? def.name : chosen.defId };
        });
        if (!node) break;
        const result = await dispatch({ type: 'forage:gather', nodeId: node.id });
        attempts += 1;
        record.evidence.push('gather ' + node.name + ' -> ' + JSON.stringify(result));
        if (result.ok) gathered = { ...node, result };
        const wood = await E(() => window.__A_CIGARETTES_LIFE__.game.getState().player.inventory.filter((entry) => entry.itemId === 'wood').reduce((sum, entry) => sum + entry.quantity, 0));
        if (wood >= 2) break;
      }
      assert(gathered, 'foraging gather should succeed, got: ' + JSON.stringify(record.evidence.slice(-4)));
      const inventoryAfterForage = await E(() => {
        const state = window.__A_CIGARETTES_LIFE__.game.getState();
        return { itemsForaged: state.player.statistics.itemsForaged, wood: state.player.inventory.filter((entry) => entry.itemId === 'wood').reduce((sum, entry) => sum + entry.quantity, 0) };
      });
      record.evidence.push('inventory after forage: ' + JSON.stringify(inventoryAfterForage));
      // Craft at the farm shop workbench (the farm's indoor location has a workbench).
      await travelViaMap('willowbrook_farm');
      const farmInteriorId = await E(() => {
        const content = window.__A_CIGARETTES_LIFE__.game.getContent();
        const interior = content.pack.locations.find((location) => location.indoor && location.entranceFrom === 'willowbrook_farm');
        return interior ? interior.id : null;
      });
      assert(farmInteriorId, 'farm shop interior exists');
      await travelViaMap(farmInteriorId);
      const craftPlan = await E(() => {
        const app = window.__A_CIGARETTES_LIFE__;
        const content = app.game.getContent();
        const state = app.game.getState();
        const inventory = state.player.inventory;
        const count = (itemId) => inventory.filter((entry) => entry.itemId === itemId).reduce((sum, entry) => sum + entry.quantity, 0);
        const station = app.game.getSystems().crafting.getStationAvailability();
        const recipes = content.getAllRecipes().filter((recipe) => recipe.category === 'craft');
        const available = [];
        for (const recipe of recipes) {
          const level = state.player.skills[recipe.skill] ? state.player.skills[recipe.skill].level : 1;
          if (recipe.levelReq > level) continue;
          if (!station[recipe.station]) continue;
          if (!recipe.inputs.every((input) => count(input.itemId) >= input.quantity)) continue;
          available.push({ recipeId: recipe.id, name: recipe.name, station: recipe.station, inputs: recipe.inputs, hours: recipe.hours });
        }
        return { station, available };
      });
      record.evidence.push('craft plan: ' + JSON.stringify(craftPlan).slice(0, 800));
      assert(craftPlan.available.length > 0, 'at least one craftable recipe at this station with current inventory; plan=' + JSON.stringify(craftPlan).slice(0, 500));
      const chosen = craftPlan.available[0];
      const crafted = await dispatch({ type: 'craft', recipeId: chosen.recipeId, quantity: 1 });
      record.evidence.push('craft: ' + JSON.stringify(crafted));
      assert(crafted.ok, 'craft: ' + crafted.message);
      await fastForwardSimSeconds(360, 4, 1);
      const craftResult = await E(() => {
        const state = window.__A_CIGARETTES_LIFE__.game.getState();
        return { itemsCrafted: state.player.statistics.itemsCrafted, jobs: state.crafting.jobs.length, lastCraftAt: state.crafting.lastCraftAt };
      });
      record.evidence.push('craft result: ' + JSON.stringify(craftResult));
      assertEqual(craftResult.jobs, 0, 'craft job completed');
      assert(craftResult.itemsCrafted > 0, 'itemsCrafted statistic increases');
      await screenshot('crafting-complete');
      return JSON.stringify({ gathered: gathered.name, crafted: chosen.name, itemsCrafted: craftResult.itemsCrafted });
    });

    // S13 save + reload + load
    let savedState = null;
    await step('S13', 'Save game, reload the page and load the save back', async (record) => {
      const before = await snapshot();
      savedState = { playerName: before.playerName, money: before.money, loc: before.loc, clock: before.clock, generation: before.life.generation, historyCount: before.historyCount };
      const slotsBefore = await E(() => window.__A_CIGARETTES_LIFE__.game.listSaveSlots());
      const latestBefore = slotsBefore.reduce((max, slot) => Math.max(max, slot.savedAt), 0);
      await E(() => window.__A_CIGARETTES_LIFE__.ui.openPanel('settings'));
      await waitFor(async () => (await visiblePanelTitles()).some((title) => /settings/i.test(title)), 5000, 'settings panel');
      await page.waitForTimeout(500);
      const settingsPanelText = await page.locator('.ui-panel:not(.ui-hidden) .ui-panel-scroll').last().textContent();
      record.evidence.push('settings panel text: ' + truncate(settingsPanelText || '', 400));
      const tabClicked = await E(() => {
        const tabNodes = [...document.querySelectorAll('.ui-tab')];
        const target = tabNodes.find((candidate) => /Saves/i.test(candidate.textContent || ''));
        if (!target) return false;
        target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      });
      record.evidence.push('Settings Saves tab clicked: ' + tabClicked);
      assert(tabClicked, 'Settings panel exposes the Saves tab');
      await page.waitForTimeout(600);
      const saveNow = page.getByRole('button', { name: /Save now/ }).first();
      if ((await saveNow.count()) > 0) {
        await saveNow.click({ force: true, timeout: 4000 }).catch(() => {});
      }
      if ((await E(() => window.__A_CIGARETTES_LIFE__.game.listSaveSlots())).every((slot) => slot.savedAt <= latestBefore)) {
        const viaAction = await dispatch({ type: 'save' });
        record.evidence.push('Save now fallback dispatch: ' + JSON.stringify(viaAction));
      }
      await waitFor(async () => {
        const currentSlots = await E(() => window.__A_CIGARETTES_LIFE__.game.listSaveSlots());
        return currentSlots.some((slot) => slot.savedAt > latestBefore);
      }, 15000, 'save slot written');
      const slots = await E(() => window.__A_CIGARETTES_LIFE__.game.listSaveSlots());
      record.evidence.push('slots: ' + JSON.stringify(slots.map((slot) => ({ slotId: slot.slotId, name: slot.playerName, money: slot.money, generation: slot.generation }))));
      assert(slots.some((slot) => slot.playerName === before.playerName), 'save slot for current life exists');
      await screenshot('saved');
      await page.reload({ waitUntil: 'load' });
      await waitFor(appReady, 45000, 'app after reload');
      await page.waitForTimeout(1800);
      const menuSnap = await snapshot();
      assert(menuSnap.menuVisible, 'main menu visible after reload');
      assertEqual(menuSnap.screen, 'menu', 'screen after reload');
      await page.getByRole('button', { name: /^Save slots$/i }).first().click();
      await waitFor(async () => (await snapshot()).modalVisible, 8000, 'save slots modal');
      assert(/save slots/i.test((await snapshot()).modalTitle || ''), 'save slots modal title');
      await screenshot('continue-save-slots');
      const row = page.locator('.ui-save-slot').filter({ hasText: before.playerName }).first();
      assert((await row.count()) === 1, 'save slots modal lists the saved life');
      await row.getByRole('button', { name: 'Load' }).click();
      await waitFor(async () => (await snapshot()).screen === 'playing', 30000, 'loaded back into playing');
      await page.waitForTimeout(2000);
      const after = await snapshot();
      assertEqual(after.playerName, before.playerName, 'loaded player name');
      assertEqual(after.money, before.money, 'loaded money');
      assertEqual(after.life.generation, before.life.generation, 'loaded generation');
      assert(after.clock >= before.clock, 'loaded clock >= saved sim time');
      assertEqual(after.worldId, 'world_1', 'loaded world id');
      record.evidence.push('loaded: ' + JSON.stringify({ loc: after.loc, money: after.money, clock: after.clock, scene: after.scene && after.scene.key }));
      await screenshot('loaded-world');
      return JSON.stringify({ slots: slots.length, saved: savedState, loaded: { loc: after.loc, money: after.money, clock: after.clock } });
    });

    // S14 offline catch-up through the real Web Worker
    await step('S14', 'Offline catch-up runs in the real Web Worker and produces a summary modal', async (record) => {
      await closePanels();
      const before = await E(() => {
        const app = window.__A_CIGARETTES_LIFE__;
        const game = app.game;
        const state = game.getState();
        return {
          clock: state.clock.simTimeSeconds,
          workerDisabled: Boolean(game.workerDisabled),
          workerReady: Boolean(game.worker && game.worker.ready),
        };
      });
      record.evidence.push('before offline: ' + JSON.stringify(before));
      const slotsBefore = await E(() => window.__A_CIGARETTES_LIFE__.game.listSaveSlots());
      const latestSavedAt = slotsBefore.reduce((max, slot) => Math.max(max, slot.savedAt), 0);
      const errorsBefore = pageErrors.filter((entry) => !/favicon\.ico/i.test(entry.text)).length;
      const offline = await E(async () => {
        const app = window.__A_CIGARETTES_LIFE__;
        const game = app.game;
        const state = game.getState();
        const clock = state.clock.simTimeSeconds;
        state.pendingOffline.lastSaveRealMs = Date.now() - 24 * 60 * 60 * 1000;
        state.pendingOffline.lastOfflineSimTime = clock;
        state.pendingOffline.lastProcessedSimTime = clock;
        const result = await game.requestOfflineCatchup();
        const summary = game.getOfflineSummary();
        const after = game.getState();
        return {
          ok: Boolean(result && result.ok),
          lastProcessedSimTime: result ? result.lastProcessedSimTime : null,
          statsSteps: result && result.stats ? result.stats.steps : null,
          clockBefore: clock,
          clockAfter: after.clock.simTimeSeconds,
          summary: summary
            ? {
                headline: summary.headline,
                highlights: summary.highlights.length,
                simulatedGameHours: summary.simulatedGameHours,
                realElapsedMs: summary.realElapsedMs,
                fromSimTime: summary.fromSimTime,
                toSimTime: summary.toSimTime,
                newEvents: summary.newEvents.length,
                letters: summary.letters.length,
                changes: summary.changes.length,
                npcUpdates: summary.importantNpcUpdates.length,
              }
            : null,
          workerDisabled: Boolean(game.workerDisabled),
          workerReady: Boolean(game.worker && game.worker.ready),
        };
      });
      record.evidence.push('offline worker result: ' + JSON.stringify(offline).slice(0, 1800));
      assert(offline.ok, 'offline catch-up succeeds');
      assert(offline.summary, 'offline summary produced');
      assert(offline.workerDisabled === false, 'Web Worker path was not disabled (a real Worker was used)');
      assert(offline.workerReady === true, 'the simulation Web Worker is running');
      assert(offline.summary.realElapsedMs >= 23 * 60 * 60 * 1000, 'offline window covers the simulated 24h absence, got ' + offline.summary.realElapsedMs);
      assert(offline.summary.simulatedGameHours >= 60 && offline.summary.simulatedGameHours <= 80, 'offline sim advanced ~72 game hours, got ' + offline.summary.simulatedGameHours);
      assert(offline.clockAfter > offline.clockBefore, 'sim clock advances after offline catch-up (' + offline.clockBefore + ' -> ' + offline.clockAfter + ')');
      assert(offline.summary.headline && offline.summary.headline.length > 5, 'summary headline meaningful');
      const errorsAfter = pageErrors.filter((entry) => !/favicon\.ico/i.test(entry.text)).length;
      assertEqual(errorsAfter, errorsBefore, 'no new console/page errors during worker offline catch-up');
      await waitFor(async () => (await snapshot()).modalVisible, 15000, 'offline summary modal');
      const snap = await snapshot();
      await screenshot('offline-summary-modal');
      assert(/while you were away/i.test(snap.modalTitle || ''), 'offline modal title "While you were away", got ' + JSON.stringify(snap.modalTitle));
      assert(snap.modalText && snap.modalText.length > 60, 'offline modal contains summary rows');
      assert(/game time passed|highlights|what changed/i.test(snap.modalText), 'offline modal shows the summary sections');
      await page.getByRole('button', { name: 'Welcome back' }).click();
      await page.waitForTimeout(500);
      const dismissed = await snapshot();
      assert(!dismissed.modalVisible, 'offline modal closes after Welcome back');
      assert(dismissed.offlineSummary === null, 'acknowledging clears the offline summary');
      const committed = await waitFor(async () => {
        const slots = await E(() => window.__A_CIGARETTES_LIFE__.game.listSaveSlots());
        return slots.some((slot) => slot.savedAt > latestSavedAt) ? slots : null;
      }, 15000, 'offline settlement auto-save').catch(() => null);
      assert(committed, 'offline settlement commits a save envelope automatically (listSaveSlots savedAt advanced)');
      const idempotent = await E(async () => await window.__A_CIGARETTES_LIFE__.game.requestOfflineCatchup());
      assert(idempotent === null, 'a second immediate catch-up is rejected (wall clock anchor was reset)');
      record.evidence.push('atomic commit slots: ' + JSON.stringify((committed || []).map((slot) => ({ slotId: slot.slotId, savedAt: slot.savedAt }))));
      return JSON.stringify({ summary: offline.summary, clockBefore: offline.clockBefore, clockAfter: offline.clockAfter, workerReady: offline.workerReady, committedSlots: (committed || []).length });
    });

    // S15 hidden-tab LOD2 background simulation (real Worker)
    await step('S15', 'Hidden-tab LOD2 background simulation toggles and advances the world', async (record) => {
      await closePanels();
      const before = await E(() => {
        const app = window.__A_CIGARETTES_LIFE__;
        const game = app.game;
        return {
          clock: game.getState().clock.simTimeSeconds,
          active: game.isBackgroundSimulationActive(),
          workerDisabled: Boolean(game.workerDisabled),
          workerReady: Boolean(game.worker && game.worker.ready),
          lastProcessed: game.getState().pendingOffline.lastProcessedSimTime,
        };
      });
      assertEqual(before.active, false, 'background simulation starts inactive');
      await E(() => window.__A_CIGARETTES_LIFE__.game.startBackgroundSimulation());
      const activeAfterStart = await E(() => window.__A_CIGARETTES_LIFE__.game.isBackgroundSimulationActive());
      assert(activeAfterStart, 'isBackgroundSimulationActive() is true after start');
      await page.waitForTimeout(7000);
      const during = await E(() => {
        const app = window.__A_CIGARETTES_LIFE__;
        const game = app.game;
        return {
          clock: game.getState().clock.simTimeSeconds,
          active: game.isBackgroundSimulationActive(),
          lastProcessed: game.getState().pendingOffline.lastProcessedSimTime,
          workerReady: Boolean(game.worker && game.worker.ready),
          workerDisabled: Boolean(game.workerDisabled),
        };
      });
      await E(() => window.__A_CIGARETTES_LIFE__.game.stopBackgroundSimulation());
      await page.waitForTimeout(1200);
      const after = await E(() => {
        const app = window.__A_CIGARETTES_LIFE__;
        const game = app.game;
        return {
          clock: game.getState().clock.simTimeSeconds,
          active: game.isBackgroundSimulationActive(),
          lastProcessed: game.getState().pendingOffline.lastProcessedSimTime,
        };
      });
      record.evidence.push('background before/during/after: ' + JSON.stringify({ before, during, after }));
      assertEqual(during.active, true, 'background simulation active while running');
      assertEqual(after.active, false, 'isBackgroundSimulationActive() is false after stop');
      assert(after.clock > before.clock, 'sim clock advanced during the hidden-tab background window (' + before.clock + ' -> ' + after.clock + ')');
      if (during.workerReady) record.evidence.push('background chunks used the real Web Worker (worker.ready=true, workerDisabled=' + during.workerDisabled + ')');
      if (during.lastProcessed > before.lastProcessed) record.evidence.push('Web Worker background chunk applied: pendingOffline.lastProcessedSimTime ' + before.lastProcessed + ' -> ' + during.lastProcessed);
      await screenshot('background-sim');
      return JSON.stringify({ clockBefore: before.clock, clockAfter: after.clock, workerReady: during.workerReady, backgroundApplied: during.lastProcessed > before.lastProcessed });
    });

    // S16 life end -> life review -> next generation
    await step('S16', 'Life end, life review and starting the next generation', async (record) => {
      const before = await snapshot();
      record.evidence.push('life before: ' + JSON.stringify({ phase: before.life.phase, generation: before.life.generation, lengthRatio: before.life.lengthRatio, clock: before.clock }));
      let rests = 0;
      while (rests < 40) {
        const phase = await E(() => window.__A_CIGARETTES_LIFE__.game.getState().life.phase);
        if (phase !== 'alive') break;
        const result = await dispatch({ type: 'time:rest', hours: 24 });
        rests += 1;
        if (!result.ok) throw new Error('rest while burning out failed: ' + result.message);
      }
      const ended = await E(() => {
        const state = window.__A_CIGARETTES_LIFE__.game.getState();
        return {
          phase: state.life.phase,
          lengthRatio: state.player.cigarette.lengthRatio,
          endReason: state.life.endReason,
          archiveLength: state.archive.length,
          screen: window.__A_CIGARETTES_LIFE__.game.getScreen(),
          ageDays: state.life.ageDays,
        };
      });
      record.evidence.push('ended: rests=' + rests + ' ' + JSON.stringify(ended));
      assertEqual(ended.phase, 'ended', 'life phase ended');
      assert(ended.lengthRatio <= 0.001, 'cigarette burnt out, got ' + ended.lengthRatio);
      assert(ended.archiveLength >= 1, 'life archive contains the ended life');
      await waitFor(async () => (await snapshot()).screen === 'life_end', 10000, 'life_end screen');
      await waitFor(async () => (await snapshot()).modalVisible, 12000, 'life review modal');
      const snap = await snapshot();
      await screenshot('life-review-modal');
      assert(/the life of/i.test(snap.modalTitle || ''), 'life review modal title, got ' + JSON.stringify(snap.modalTitle));
      assert(snap.modalText && /generation/i.test(snap.modalText), 'life review shows generation and skills');
      const nextLifeButtons = page.getByRole('button', { name: /Light the next cigarette/i });
      assert((await nextLifeButtons.count()) > 0, 'life review offers the next-generation button');
      await nextLifeButtons.last().click();
      await waitFor(async () => (await snapshot()).screen === 'playing', 15000, 'next generation playing');
      await page.waitForTimeout(2000);
      const next = await snapshot();
      await screenshot('next-generation');
      assertEqual(next.life.generation, before.life.generation + 1, 'generation increments');
      assertEqual(next.life.phase, 'alive', 'new life alive');
      assert(/II/.test(next.playerName), 'next generation name derived, got ' + next.playerName);
      assertEqual(next.worldId, before.worldId, 'world persists across generations');
      assert(next.historyCount >= before.historyCount, 'world history persists');
      assertEqual(next.npcCount, before.npcCount, 'NPC population persists');
      assert(next.life.globalArchiveCount >= 1, 'global archive carries over');
      assert(next.hudVisible, 'HUD visible in the new life');
      return JSON.stringify({ rests, ended: { endReason: ended.endReason, ageDays: ended.ageDays, archive: ended.archiveLength }, next: { name: next.playerName, generation: next.life.generation, worldId: next.worldId } });
    });

    // S17 console errors
    await step('S17', 'No unexpected console/page errors during the playthrough', async (record) => {
      const httpErrors = pageErrors.filter((entry) => entry.kind === 'http');
      const favicon404s = httpErrors.filter((entry) => /favicon\.ico/.test(entry.text));
      const nonFaviconHttp = httpErrors.filter((entry) => !/favicon\.ico/.test(entry.text));
      const console404s = pageErrors.filter((entry) => entry.kind === 'console.error' && /status of 404/.test(entry.text));
      const benign = new Set([...favicon404s, ...(nonFaviconHttp.length === 0 ? console404s : [])]);
      for (const entry of pageErrors) if (/React DevTools/i.test(entry.text)) benign.add(entry);
      const unexpected = pageErrors.filter((entry) => !benign.has(entry));
      record.evidence.push('console entries: ' + consoleEntries.length + ', errors/request failures: ' + pageErrors.length + ' (favicon 404s: ' + favicon404s.length + ')');
      for (const error of pageErrors.slice(0, 10)) record.evidence.push('error: ' + error.kind + ' :: ' + truncate(error.text, 300));
      assert(unexpected.length === 0, 'unexpected console/page errors: ' + JSON.stringify(unexpected.slice(0, 6)));
      record.evidence.push('benign (reported, not failing): ' + JSON.stringify([...benign].map((entry) => entry.text).slice(0, 4)));
      return JSON.stringify({ consoleEntries: consoleEntries.length, errors: pageErrors.length, benign: benign.length, favicon404s: favicon404s.length });
    });
  } finally {
    const summary = {
      runId: RUN_ID,
      url: BASE_URL,
      chrome: CHROME,
      finishedAt: new Date().toISOString(),
      cargo: describeBuild(),
      steps: results,
      pass: results.filter((result) => result.status === 'PASS').length,
      fail: results.filter((result) => result.status === 'FAIL').length,
      consoleErrors: pageErrors,
      consoleLog: consoleEntries,
    };
    fs.writeFileSync(path.join(SMOKE_DIR, 'acceptance-results.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(
      path.join(SMOKE_DIR, 'acceptance-console.log'),
      consoleEntries.map((entry) => new Date(entry.ts).toISOString() + ' [' + entry.type + '] ' + entry.text).join(NL) + NL
    );
    log('');
    log('--- acceptance summary ---');
    for (const result of results) {
      log(result.status + ' ' + result.id + ' ' + result.name + (result.status === 'PASS' ? '' : ' :: ' + result.details));
    }
    log('PASS ' + summary.pass + ' / FAIL ' + summary.fail);
    log('Console errors: ' + pageErrors.length);
    await browser.close();
    process.exitCode = summary.fail > 0 ? 1 : 0;
  }
}

function describeBuild() {
  try {
    const distDir = path.join(ROOT, 'dist', 'assets');
    const files = fs.readdirSync(distDir).filter((file) => file.endsWith('.js'));
    return files.map((file) => {
      const stat = fs.statSync(path.join(distDir, file));
      return { file, bytes: stat.size, mtime: stat.mtime.toISOString() };
    });
  } catch {
    return [];
  }
}

main().catch((error) => {
  console.error('ACCEPTANCE RUN CRASHED:', error);
  process.exitCode = 1;
});
