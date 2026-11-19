// QA / Integration harness (Agent 14, task-12).
// Drives the REAL modules only (SimulationRuntime/SimulationReplay/GameEngine/SaveManager/
// ContentRegistry/ProbabilityEngine) - no mocking of game systems. Deterministic: every
// helper is seed-driven and never uses wall-clock time for gameplay assertions.
import type { GameState, IContentRegistry } from '../../../src/core/contracts';
import type { LocationId } from '../../../src/core/SharedTypes';
import { EMOTION_KEYS, NEED_KEYS, SEASONS, WEATHER_TYPES } from '../../../src/core/SharedTypes';
import { ContentRegistry } from '../../../src/core/ContentRegistry';
import { CONTENT_PACK } from '../../../src/data';
import { DEFAULT_APPEARANCE, createInitialGameState } from '../../../src/core/WorldFactory';
import { WORLD_CONFIG } from '../../../src/core/WorldConfig';
import { addItemToInventory } from '../../../src/core/InventoryUtil';
import { FORAGE_NODES } from '../../../src/data/fish/fish';
import type { GameEngine } from '../../../src/core/Game';
import { WorldSystem } from '../../../src/world/WorldManager';
import type { GameState as GameStateType } from '../../../src/core/contracts';

export const content: IContentRegistry = new ContentRegistry(CONTENT_PACK);

export const QA_PLAYER_NAME = 'QA Ash';

export function createQaState(seed: number, playerName = QA_PLAYER_NAME): GameState {
  return createInitialGameState({
    seed: seed >>> 0,
    playerName,
    appearance: DEFAULT_APPEARANCE,
    content,
  });
}

// ---------------------------------------------------------------------------
// Deep numeric / structural validation
// ---------------------------------------------------------------------------
export function findNonFiniteNumbers(value: unknown, path = '$'): string[] {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [] : [path + ' = ' + String(value)];
  }
  if (Array.isArray(value)) {
    const problems: string[] = [];
    value.forEach((entry, index) => {
      problems.push(...findNonFiniteNumbers(entry, path + '[' + index + ']'));
    });
    return problems;
  }
  if (value !== null && typeof value === 'object') {
    const problems: string[] = [];
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      problems.push(...findNonFiniteNumbers(entry, path + '.' + key));
    }
    return problems;
  }
  return [];
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

export interface ValidationReport {
  issues: string[];
  npcCount: number;
  marketGoods: number;
  businesses: number;
  events: number;
  history: number;
  transactions: number;
  decisions: number;
}

/**
 * Semantic validation of a full GameState: every id resolves against the real content pack,
 * every player-visible number is finite and inside its documented domain, money is never
 * negative and all log slices are bounded. Returns human-readable issues (empty = valid).
 */
export function validateState(state: GameState): ValidationReport {
  const issues: string[] = [];
  const push = (message: string): void => {
    if (issues.length < 40) issues.push(message);
  };
  const maxHistory = WORLD_CONFIG.simulation.maxHistoryEntries;
  const maxEvents = WORLD_CONFIG.simulation.maxWorldEventLog;

  if (!state || typeof state !== 'object') {
    return { issues: ['state is not an object'], npcCount: 0, marketGoods: 0, businesses: 0, events: 0, history: 0, transactions: 0, decisions: 0 };
  }
  if (!Number.isFinite(state.meta?.seed)) push('meta.seed is not finite');
  if (!Number.isFinite(state.clock?.simTimeSeconds) || state.clock.simTimeSeconds < 0) {
    push('clock.simTimeSeconds invalid: ' + String(state.clock?.simTimeSeconds));
  }

  // -- world / locations ---------------------------------------------------
  const locationIds = Object.keys(state.world.locations);
  if (locationIds.length !== content.pack.locations.length) {
    push('location count ' + locationIds.length + ' != content ' + content.pack.locations.length);
  }
  if (!SEASONS.includes(state.world.environment.season)) push('invalid season ' + String(state.world.environment.season));
  if (!WEATHER_TYPES.includes(state.world.environment.weather)) push('invalid weather ' + String(state.world.environment.weather));
  if (!inRange(state.world.environment.humidity, 0, 1)) push('environment.humidity out of range');
  if (!inRange(state.world.environment.rainIntensity, 0, 1)) push('environment.rainIntensity out of range');
  if (!Number.isFinite(state.world.environment.windSpeed) || state.world.environment.windSpeed < 0) push('environment.windSpeed invalid');
  if (!Number.isFinite(state.world.environment.temperature)) push('environment.temperature invalid');
  if (!Number.isFinite(state.world.environment.dayOfSeason) || state.world.environment.dayOfSeason < 1) push('environment.dayOfSeason invalid');
  for (const location of Object.values(state.world.locations)) {
    if (!content.getLocation(location.id)) push('runtime location not in content: ' + location.id);
    if (!inRange(location.condition, 0, 1)) push('location.condition out of range for ' + location.id);
    for (const occupant of location.occupants) {
      if (!state.npcs[occupant]) push('unknown npc occupant ' + occupant + ' at ' + location.id);
    }
  }
  if (state.world.events.length > maxEvents) push('world.events ' + state.world.events.length + ' > cap ' + maxEvents);
  if (state.world.history.length > maxHistory) push('world.history ' + state.world.history.length + ' > cap ' + maxHistory);
  const historyIds = new Set<string>();
  for (const entry of state.world.history) {
    if (!Number.isFinite(entry.at)) push('history entry at not finite: ' + entry.id);
    if (historyIds.has(entry.id)) push('duplicate history id ' + entry.id);
    historyIds.add(entry.id);
  }

  // -- NPCs ----------------------------------------------------------------
  const npcEntries = Object.entries(state.npcs);
  for (const [id, npc] of npcEntries) {
    if (npc.id !== id) push('npc key/id mismatch ' + id + ' vs ' + npc.id);
    if (!Number.isFinite(npc.money) || npc.money < 0) push('npc ' + id + ' money invalid: ' + String(npc.money));
    for (const need of NEED_KEYS) {
      if (!inRange(npc.needs[need], 0, 100)) push('npc ' + id + ' need ' + need + ' out of range: ' + String(npc.needs[need]));
    }
    for (const emotion of EMOTION_KEYS) {
      if (!inRange(npc.emotions[emotion], 0, 1)) push('npc ' + id + ' emotion ' + emotion + ' out of range');
    }
    if (!inRange(npc.mood, -1, 1)) push('npc ' + id + ' mood out of range');
    if (typeof npc.currentActivity !== 'string' || npc.currentActivity.length === 0) push('npc ' + id + ' empty activity');
    if (!content.getLocation(npc.locationId)) push('npc ' + id + ' unknown location ' + npc.locationId);
    if (!content.getLocation(npc.homeLocationId)) push('npc ' + id + ' unknown home ' + npc.homeLocationId);
    if (npc.activityHistory.length > 8) push('npc ' + id + ' activityHistory unbounded: ' + npc.activityHistory.length);
    if (npc.memories.length > 100) push('npc ' + id + ' memories unbounded: ' + npc.memories.length);
    for (const relationship of Object.values(npc.relationships)) {
      if (!inRange(relationship.affinity, -100, 100)) push('npc ' + id + ' affinity out of range: ' + relationship.affinity);
      if (!inRange(relationship.trust, 0, 100)) push('npc ' + id + ' trust out of range');
      if (!inRange(relationship.intimacy, 0, 100)) push('npc ' + id + ' intimacy out of range');
      if (!Number.isFinite(relationship.interactionCount) || relationship.interactionCount < 0) {
        push('npc ' + id + ' interactionCount invalid');
      }
    }
    if (!Number.isFinite(npc.lastUpdatedAt)) push('npc ' + id + ' lastUpdatedAt not finite');
  }
  if (npcEntries.length !== WORLD_CONFIG.population.initialNpcCount) {
    push('npc count ' + npcEntries.length + ' != ' + WORLD_CONFIG.population.initialNpcCount);
  }

  // -- player --------------------------------------------------------------
  const player = state.player;
  if (!Number.isFinite(player.money) || player.money < 0) push('player money invalid: ' + String(player.money));
  if (!inRange(player.cigarette.lengthRatio, 0, 1)) push('cigarette.lengthRatio out of range');
  if (!inRange(player.cigarette.moisture, 0, 1)) push('cigarette.moisture out of range');
  if (!inRange(player.cigarette.totalBurned, 0, 1)) push('cigarette.totalBurned out of range');
  if (!inRange(player.cigarette.ashAccumulated, 0, WORLD_CONFIG.cigarette.maxAsh)) push('cigarette.ashAccumulated out of range');
  if (!content.getLocation(player.position.locationId)) push('player at unknown location ' + player.position.locationId);
  for (const [itemId, entry] of Object.entries(player.skills)) {
    if (!Number.isFinite(entry.level) || entry.level < 1 || entry.level > WORLD_CONFIG.skill.maxLevel) {
      push('skill ' + itemId + ' level out of range: ' + String(entry.level));
    }
    if (!Number.isFinite(entry.xp) || entry.xp < 0) push('skill ' + itemId + ' xp invalid');
  }
  for (const entry of player.inventory) {
    if (!Number.isFinite(entry.quantity) || !Number.isInteger(entry.quantity) || entry.quantity < 1) {
      push('inventory entry ' + entry.instanceId + ' bad quantity: ' + String(entry.quantity));
    }
    if (!content.getItem(entry.itemId)) push('inventory entry unknown item ' + entry.itemId);
    if (![1, 2, 3, 4, 5].includes(entry.quality)) push('inventory entry bad quality: ' + String(entry.quality));
    if (!Number.isFinite(entry.freshness) || entry.freshness < 0 || entry.freshness > 1) push('inventory freshness out of range');
  }

  // -- economy -------------------------------------------------------------
  const marketIds = Object.keys(state.economy.market);
  for (const [itemId, good] of Object.entries(state.economy.market)) {
    const def = content.getItem(itemId);
    if (!def) push('market good unknown item ' + itemId);
    if (!Number.isFinite(good.currentPrice) || good.currentPrice < 1) push('market price invalid for ' + itemId);
    if (!Number.isFinite(good.basePrice) || good.basePrice < 0) push('market basePrice invalid for ' + itemId);
    // Quest/unique items are priced 0 and are not traded: only their safety price matters.
    if (good.basePrice >= 1 && good.currentPrice > Math.ceil(good.basePrice * WORLD_CONFIG.economy.priceClampMax) + 1) {
      push('market price above clamp for ' + itemId);
    }
    if (!Number.isFinite(good.supply) || good.supply < 0) push('market supply invalid for ' + itemId);
    if (!Number.isFinite(good.demand) || good.demand < 0) push('market demand invalid for ' + itemId);
  }
  for (const [businessId, business] of Object.entries(state.economy.businesses)) {
    if (!Number.isFinite(business.money) || business.money < 0) push('business ' + businessId + ' money invalid: ' + String(business.money));
    if (!inRange(business.reputation, 0, 100)) push('business ' + businessId + ' reputation out of range');
    for (const stock of business.stock) {
      if (!Number.isInteger(stock.quantity) || stock.quantity < 0) push('business ' + businessId + ' stock quantity invalid');
      if (!Number.isFinite(stock.price) || stock.price < 1) push('business ' + businessId + ' stock price invalid');
      if (!content.getItem(stock.itemId)) push('business ' + businessId + ' unknown stock item ' + stock.itemId);
    }
    if (business.history.length > 120) push('business ' + businessId + ' history unbounded');
    for (const record of business.history) {
      if (!Number.isFinite(record.revenue) || !Number.isFinite(record.expenses)) push('business ' + businessId + ' history numbers invalid');
    }
  }
  for (const [jobId, job] of Object.entries(state.economy.jobs)) {
    if (!Number.isFinite(job.wagePerHour) || job.wagePerHour < 0) push('job ' + jobId + ' wage invalid');
    if (!state.economy.businesses[job.businessId]) push('job ' + jobId + ' references unknown business');
  }
  const maxTransactions = 101;
  if (state.economy.transactions.length > maxTransactions) push('transaction log unbounded: ' + state.economy.transactions.length);
  for (const record of state.economy.transactions) {
    if (!Number.isFinite(record.totalPrice) || record.totalPrice < 0) push('transaction ' + record.id + ' totalPrice invalid');
    if (!Number.isFinite(record.at)) push('transaction ' + record.id + ' timestamp invalid');
  }
  if (!Number.isFinite(state.economy.economicIndex) || state.economy.economicIndex <= 0) push('economicIndex invalid');
  if (state.economy.playerShop) {
    const shop = state.economy.playerShop;
    if (!Number.isFinite(shop.totalRevenue) || shop.totalRevenue < 0) push('playerShop totalRevenue invalid');
    if (!Number.isFinite(shop.totalExpenses) || shop.totalExpenses < 0) push('playerShop totalExpenses invalid');
    if (!inRange(shop.reputation, 0, 100)) push('playerShop reputation out of range');
    if (!state.economy.businesses[shop.businessId]) push('playerShop references unknown business');
  }

  // -- gameplay slices -----------------------------------------------------
  for (const plot of Object.values(state.farming.plots)) {
    if (!content.getLocation(plot.locationId)) push('plot unknown location ' + plot.locationId);
    if (!inRange(plot.growth, 0, 1)) push('plot growth out of range ' + plot.id);
    if (!inRange(plot.moisture, 0, 1)) push('plot moisture out of range ' + plot.id);
    if (!inRange(plot.fertility, 0, 1)) push('plot fertility out of range ' + plot.id);
    if (!inRange(plot.health, 0, 1)) push('plot health out of range ' + plot.id);
    if (!Number.isFinite(plot.lastUpdatedAt)) push('plot lastUpdatedAt invalid ' + plot.id);
  }
  if (state.fishing.session) {
    const session = state.fishing.session;
    if (!inRange(session.tension, 0, WORLD_CONFIG.fishing.escapeTension)) push('fishing tension out of range');
    if (!inRange(session.progress, 0, WORLD_CONFIG.fishing.catchProgress)) push('fishing progress out of range');
    if (!Number.isFinite(session.fishSizeCm) || session.fishSizeCm < 0) push('fishing fishSizeCm invalid');
  }
  if (!Number.isFinite(state.fishing.catches) || state.fishing.catches < 0) push('fishing.catches invalid');
  if (!Number.isFinite(state.foraging.gatheredToday) || state.foraging.gatheredToday < 0) push('foraging.gatheredToday invalid');
  for (const node of Object.values(state.foraging.nodes)) {
    if (!Number.isFinite(node.respawnAt) || node.respawnAt < 0) push('forage node respawnAt invalid ' + node.id);
    if (!Number.isFinite(node.remaining) || node.remaining < 0) push('forage node remaining invalid ' + node.id);
    if (!content.getLocation(node.locationId)) push('forage node unknown location ' + node.id);
  }
  if (!state.life || !['alive', 'ending', 'ended'].includes(state.life.phase)) push('life.phase invalid');
  if (state.life.phase === 'ended') {
    if (state.life.endReason === null || state.life.endReason.length === 0) push('ended life without endReason');
    if (state.life.endedAt === null || !Number.isFinite(state.life.endedAt)) push('ended life without endedAt');
  }
  for (const archived of state.archive) {
    if (!Number.isFinite(archived.endedAt) || !Number.isFinite(archived.durationDays)) push('archived life numbers invalid: ' + archived.lifeId);
  }
  if (state.probability.history.length > WORLD_CONFIG.probability.historyLimit) {
    push('probability history unbounded: ' + state.probability.history.length);
  }
  if (!Number.isFinite(state.probability.decisionCount) || state.probability.decisionCount < 0) push('probability decisionCount invalid');
  for (const [streamId, words] of Object.entries(state.probability.streams)) {
    for (const word of words) {
      if (!Number.isFinite(word)) push('probability stream ' + streamId + ' has non-finite word');
    }
  }

  // -- deep numeric scan (catches NaN/Infinity anywhere else) ---------------
  for (const problem of findNonFiniteNumbers(state)) push('non-finite number at ' + problem);

  return {
    issues,
    npcCount: npcEntries.length,
    marketGoods: marketIds.length,
    businesses: Object.keys(state.economy.businesses).length,
    events: state.world.events.length,
    history: state.world.history.length,
    transactions: state.economy.transactions.length,
    decisions: state.probability.decisionCount,
  };
}

/** Validation that throws a readable failure listing the issues. */
export function assertStateValid(state: GameState, label = 'state'): void {
  const report = validateState(state);
  if (report.issues.length > 0) {
    throw new Error(label + ' is invalid:\n - ' + report.issues.slice(0, 20).join('\n - '));
  }
}

/** Market prices must stay inside the documented [40%, 250%] band of the base price. */
export function marketPriceViolations(state: GameState): string[] {
  const { priceClampMin, priceClampMax } = WORLD_CONFIG.economy;
  const violations: string[] = [];
  for (const [itemId, good] of Object.entries(state.economy.market)) {
    // Priced-0 items are untradeable quest objects; the market keeps a safety price of 1.
    if (good.basePrice === 0) continue;
    if (!Number.isFinite(good.basePrice) || good.basePrice < 1) {
      violations.push(itemId + ': basePrice invalid ' + String(good.basePrice));
      continue;
    }
    const min = Math.max(1, Math.floor(good.basePrice * priceClampMin) - 1);
    const max = Math.ceil(good.basePrice * priceClampMax) + 1;
    if (!Number.isFinite(good.currentPrice) || good.currentPrice < min || good.currentPrice > max) {
      violations.push(itemId + ': price ' + String(good.currentPrice) + ' outside [' + min + ',' + max + '] (base ' + good.basePrice + ')');
    }
  }
  return violations;
}

/** Sums every pence balance the game exposes, for "money is never negative" assertions. */
export function negativeBalances(state: GameState): string[] {
  const negatives: string[] = [];
  if (!Number.isFinite(state.player.money) || state.player.money < 0) negatives.push('player: ' + String(state.player.money));
  for (const [id, npc] of Object.entries(state.npcs)) {
    if (!Number.isFinite(npc.money) || npc.money < 0) negatives.push('npc ' + id + ': ' + String(npc.money));
  }
  for (const [id, business] of Object.entries(state.economy.businesses)) {
    if (!Number.isFinite(business.money) || business.money < 0) negatives.push('business ' + id + ': ' + String(business.money));
  }
  if (state.economy.playerShop && state.economy.playerShop.totalExpenses < 0) negatives.push('playerShop expenses negative');
  return negatives;
}

// ---------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------

/**
 * JSON fingerprint of the deterministic gameplay state. Wall-clock-only fields are
 * excluded deliberately: meta timestamps, pendingOffline real-time fields and
 * clock.lastRealTimestampMs are allowed to differ between identical runs (they are
 * persistence bookkeeping, not gameplay). Everything a player can observe is included.
 */
export function gameplayFingerprint(state: GameState): string {
  const metaFields = new Set(['meta', 'pendingOffline']);
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (metaFields.has(key)) continue;
    if (key === 'clock') {
      const clock = value as GameStateType['clock'];
      copy[key] = { ...clock, lastRealTimestampMs: 0 };
      continue;
    }
    copy[key] = value;
  }
  return JSON.stringify(copy);
}

export function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Determinism fingerprint that also ignores generated id strings (itm_.../photo_.../greenhouse_...
 * are built with makeId(), which embeds Date.now()). The strict gameplayFingerprint() above is used
 * for save/load identity; this normalised one is used to compare two independent same-seed runs.
 * See docs/QA_REPORT.md BUG-6: generated ids make byte-identical replay impossible.
 */
export function normalisedGameplayFingerprint(state: GameState): string {
  const GENERATED_ID = /^(itm|photo|greenhouse|evt_qa)[-_]/;
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return GENERATED_ID.test(value) ? '<generated-id>' : value;
    if (Array.isArray(value)) return value.map((entry) => walk(entry));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) out[key] = walk(entry);
      return out;
    }
    return value;
  };
  const metaFields = new Set(['meta', 'pendingOffline']);
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (metaFields.has(key)) continue;
    if (key === 'clock') {
      const clock = value as GameStateType['clock'];
      copy[key] = { ...clock, lastRealTimestampMs: 0 };
      continue;
    }
    copy[key] = walk(value);
  }
  return JSON.stringify(copy);
}

// ---------------------------------------------------------------------------
// Player / travel helpers (real WorldSystem pathfinding + real GameEngine dispatch)
// ---------------------------------------------------------------------------

export function travelTo(game: GameEngine, target: LocationId): void {
  const current = game.getState().player.position.locationId;
  if (current === target) return;
  const world = game.getRuntime().systems.world as WorldSystem;
  const path = world.getPathTo(target);
  if (!path || path.length === 0) throw new Error('No walk path from ' + current + ' to ' + target);
  for (const step of path.slice(1)) {
    const result = game.dispatch({ type: 'move:to-location', locationId: step });
    if (!result.ok) throw new Error('Travel ' + step + ' failed: ' + result.message);
  }
  if (game.getState().player.position.locationId !== target) {
    throw new Error('Travel ended at ' + game.getState().player.position.locationId + ' not ' + target);
  }
}

/** Fixture only: adds items through the real inventory util and emits the real bus event. */
export function giveItem(game: GameEngine, itemId: string, quantity: number, quality: 1 | 2 | 3 | 4 | 5 = 3): void {
  const state = game.getState();
  const def = content.getItem(itemId);
  addItemToInventory(state.player.inventory, itemId, quantity, {
    quality,
    freshness: 1,
    simTime: state.clock.simTimeSeconds,
    maxStack: def?.maxStack ?? 99,
  });
  game.getEventBus().emit('item:acquired', { itemId, quantity, quality, source: 'qa_fixture' });
}

export function initialStockUnits(state: GameState): number {
  let total = 0;
  for (const business of Object.values(state.economy.businesses)) {
    for (const entry of business.stock) total += Math.max(0, entry.quantity);
  }
  return total;
}

export function totalStockUnits(state: GameState): number {
  return initialStockUnits(state);
}

// ---------------------------------------------------------------------------
// Fishing driver (real cast/wait/bite/reel state machine)
// ---------------------------------------------------------------------------
export interface FishingAttempt {
  castOk: boolean;
  message: string;
  caught: number;
  simSecondsSpent: number;
}

/**
 * Plays the real fishing lifecycle: cast, tick until the bite window, strike, then run the
 * tension minigame by releasing at high tension. Returns the measured outcome.
 */
export function catchFish(game: GameEngine, locationId: LocationId, maxWaitTicks = 6000): FishingAttempt {
  const before = game.getState().fishing.catches;
  const startSim = game.getState().clock.simTimeSeconds;
  const cast = game.dispatch({ type: 'fish:cast', locationId });
  if (!cast.ok) {
    return { castOk: false, message: cast.message, caught: 0, simSecondsSpent: 0 };
  }
  const fishing = game.getRuntime().systems.fishing;
  let ticks = 0;
  // Wait phase: advance in 1-second real ticks (1 tick = 1 sim second = 1 game minute).
  while (ticks < maxWaitTicks) {
    const session = fishing.getSession();
    if (!session) break;
    if (session.phase === 'bite' || session.phase === 'reeling') break;
    game.tick(1);
    ticks += 1;
  }
  const session = fishing.getSession();
  if (session && session.phase === 'bite') {
    const strike = game.dispatch({ type: 'fish:reel', hold: true });
    if (!strike.ok) {
      return { castOk: true, message: strike.message, caught: 0, simSecondsSpent: game.getState().clock.simTimeSeconds - startSim };
    }
  }
  // Minigame: hold while tension is safe, release above the safe band.
  let guard = 0;
  while (guard < 8000) {
    const active = fishing.getSession();
    if (!active || active.phase !== 'reeling') break;
    game.dispatch({ type: 'fish:reel', hold: active.tension <= 62 });
    game.tick(0.25);
    guard += 1;
  }
  const caught = game.getState().fishing.catches - before;
  return {
    castOk: true,
    message: game.getState().fishing.lastResultMessage,
    caught,
    simSecondsSpent: game.getState().clock.simTimeSeconds - startSim,
  };
}

/** First forage node usable by a level-1 forager in the current season at this location. */
export function findUsableForageNode(state: GameState, locationId: LocationId): { nodeId: string; itemId: string } | null {
  const season = state.world.environment.season;
  for (const [nodeId, node] of Object.entries(state.foraging.nodes)) {
    if (node.locationId !== locationId) continue;
    if (node.depleted) continue;
    const def = FORAGE_NODES.find((candidate) => candidate.id === node.defId);
    if (!def) continue;
    if (!def.seasons.includes(season)) continue;
    if (def.skillReq > 1) continue;
    return { nodeId, itemId: def.itemId };
  }
  return null;
}

export function countItemInState(state: GameState, itemId: string): number {
  let total = 0;
  for (const entry of state.player.inventory) {
    if (entry.itemId === itemId) total += entry.quantity;
  }
  return total;
}
