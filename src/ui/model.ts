
// =============================================================================
// Pure view-model helpers for the DOM UI. DOM-free so it can be unit tested in
// a headless node environment and reused by every panel.
// =============================================================================
import type {
  GameSettings,
  GameState,
  IContentRegistry,
  LocationState,
  OfflineChange,
  ProbabilityDecisionRecord,
} from '../core/contracts';
import type { FurnitureDef, ItemDef, LocationDef, RecipeDef } from '../data/schema';
import {
  QUALITY_DISPLAY_NAMES,
  SEASON_DISPLAY_NAMES,
  SKILL_DISPLAY_NAMES,
  WEEKDAY_NAMES,
  WEATHER_DISPLAY_NAMES,
  type EquipmentSlot,
  type GameTime,
  type ItemCategory,
  type QualityStars,
  type RegionId,
  type Season,
  type SkillId,
  type WeatherType,
  type InventoryEntry,
} from '../core/SharedTypes';
import { formatMoney, qualityStars } from '../core/format';
import { simSecondsToGameTime } from '../core/TimeUtil';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { INFLUENCE_TIERS as GAME_INFLUENCE_TIERS } from '../life/InfluenceSystem';
import type { HomeState, NPCState, RelationshipState, StatusEffectState } from '../core/contracts';

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 0): number {
  const safe = Number.isFinite(value) ? value : 0;
  const factor = Math.pow(10, digits);
  return Math.round(safe * factor) / factor;
}

export function formatPercent01(value: number, digits = 0): string {
  return (clamp01(value) * 100).toFixed(digits) + '%';
}

export function formatSigned(value: number): string {
  const rounded = Math.round(value);
  return (rounded >= 0 ? '+' : '') + rounded;
}

export function capitalise(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function humaniseId(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

/** FNV-1a style deterministic hash - cosmetic variation only (never gameplay). */
export function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic 0..1 noise from a string and index - cosmetic variation only. */
export function cosmeticNoise(key: string, index: number): number {
  return (stableHash(key + ':' + index) % 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts (UI-owned; persisted inside settings.keybindings with a
// "ui." prefix so scene keybindings are untouched).
// ---------------------------------------------------------------------------
export const UI_SHORTCUT_ACTIONS = [
  'inventory',
  'map',
  'social',
  'life',
  'journal',
  'building',
  'housing',
  'collection',
  'skills',
  'help',
  'debugProbability',
] as const;

export type UiShortcutAction = (typeof UI_SHORTCUT_ACTIONS)[number];

export const DEFAULT_UI_SHORTCUTS: Readonly<Record<UiShortcutAction, string>> = {
  inventory: 'I',
  map: 'M',
  social: 'K',
  life: 'L',
  journal: 'J',
  building: 'B',
  housing: 'H',
  collection: 'C',
  skills: 'Y',
  help: 'TAB',
  debugProbability: 'F12',
};

export const UI_SHORTCUT_LABELS: Readonly<Record<UiShortcutAction, string>> = {
  inventory: 'Inventory & crafting',
  map: 'Map & trains',
  social: 'Social',
  life: 'Life & cigarette',
  journal: 'Journal',
  building: 'Building',
  housing: 'Home & housing',
  collection: 'Collection',
  skills: 'Skills & goals',
  help: 'Help',
  debugProbability: 'Probability debugger',
};

const UI_KEYBINDING_PREFIX = 'ui.';

export function resolveShortcuts(settings: Readonly<GameSettings>): Record<UiShortcutAction, string> {
  const resolved = { ...DEFAULT_UI_SHORTCUTS } as Record<UiShortcutAction, string>;
  for (const action of UI_SHORTCUT_ACTIONS) {
    const custom = settings.keybindings[UI_KEYBINDING_PREFIX + action];
    if (typeof custom === 'string' && custom.trim().length > 0) resolved[action] = custom.trim().toUpperCase();
  }
  return resolved;
}

export function shortcutBindingKey(action: UiShortcutAction): string {
  return UI_KEYBINDING_PREFIX + action;
}

/** Normalises a KeyboardEvent.key into the stored binding representation. */
export function normaliseKeyName(key: string): string | null {
  if (key.length === 0) return null;
  if (key === ' ') return 'SPACE';
  const named: Record<string, string> = {
    Escape: 'ESC',
    Tab: 'TAB',
    Enter: 'ENTER',
    Backspace: 'BACKSPACE',
    ArrowUp: 'UP',
    ArrowDown: 'DOWN',
    ArrowLeft: 'LEFT',
    ArrowRight: 'RIGHT',
  };
  const special = named[key];
  if (special) return special;
  if (/^F\d{1,2}$/.test(key)) return key.toUpperCase();
  if (key.length === 1) return key.toUpperCase();
  return key.toUpperCase();
}

// ---------------------------------------------------------------------------
// Item / recipe helpers
// ---------------------------------------------------------------------------
export function itemIcon(def: ItemDef | undefined): string {
  if (!def) return '▫';
  if (def.visual.shape) {
    const byShape: Record<string, string> = {
      circle: '●',
      rect: '▬',
      leaf: '🍃',
      fish: '🐟',
      bottle: '🧪',
      tool: '🔨',
      food: '🍞',
      flower: '🌸',
      gem: '💎',
      book: '📖',
      furniture: '🪑',
      ash: '🌫️',
      key: '🔑',
      gift: '🎁',
      egg: '🥚',
    };
    const shaped = byShape[def.visual.shape];
    if (shaped) return shaped;
  }
  return categoryIcon(def.category);
}

export function categoryIcon(category: ItemCategory): string {
  const icons: Record<ItemCategory, string> = {
    seed: '🌱',
    produce: '🥕',
    fish: '🐟',
    material: '🪵',
    tool: '🔨',
    equipment: '🛡️',
    food: '🍞',
    drink: '☕',
    furniture: '🪑',
    decor: '🖼️',
    clothing: '👕',
    book: '📖',
    collectible: '🏺',
    gift: '🎁',
    cigarette: '🚬',
    recipe: '📜',
    misc: '📦',
  };
  return icons[category] ?? '▫';
}

export function itemCategoryLabel(category: ItemCategory): string {
  return humaniseId(category);
}

export function qualityColor(quality: QualityStars): string {
  const colors: Record<QualityStars, string> = {
    1: '#b9b3a5',
    2: '#a8c98a',
    3: '#8fc4e0',
    4: '#d6a8e8',
    5: '#f0c26a',
  };
  return colors[quality] ?? '#b9b3a5';
}

export function qualityLabel(quality: QualityStars): string {
  return (QUALITY_DISPLAY_NAMES[quality] ?? 'Common') + ' ' + qualityStars(quality);
}

export function itemValue(def: ItemDef | undefined): number {
  return def?.basePrice ?? 0;
}

export interface ItemActionKinds {
  canUse: boolean;
  canEquip: boolean;
  canRead: boolean;
  canDrop: boolean;
  isFood: boolean;
}

/** Mirrors the actionable paths handled by GameEngine.dispatch for inventory items. */
export function itemActionKinds(def: ItemDef | undefined): ItemActionKinds {
  if (!def) return { canUse: false, canEquip: false, canRead: false, canDrop: false, isFood: false };
  const readable = Boolean(def.readSkill || (def.unlocksRecipes && def.unlocksRecipes.length > 0));
  const warming = ['hand_warmer', 'matches', 'desiccant_pack', 'windproof_lighter'].includes(def.id);
  const canUse = Boolean(
    def.equipmentSlot || readable || warming || def.edible || (def.effects && def.effects.length > 0)
  );
  return {
    canUse,
    canEquip: Boolean(def.equipmentSlot),
    canRead: readable,
    canDrop: true,
    isFood: Boolean(def.edible || def.category === 'food' || def.category === 'drink'),
  };
}

export function describeItemEffect(effect: {
  kind: string;
  value: number;
  skill?: SkillId;
  durationHours?: number;
  description?: string;
}): string {
  const label: Record<string, string> = {
    energy: 'Energy',
    hunger: 'Hunger',
    fun: 'Fun',
    social: 'Social',
    mood: 'Mood',
    moisture_down: 'Dries out',
    moisture_up: 'Wets',
    burn_slow: 'Slows burn',
    skill_xp: 'Skill XP',
    influence: 'Influence',
    luck: 'Luck',
  };
  const name = effect.description ?? label[effect.kind] ?? humaniseId(effect.kind);
  const skill = effect.skill ? ' (' + SKILL_DISPLAY_NAMES[effect.skill] + ')' : '';
  const duration = effect.durationHours ? ' for ' + effect.durationHours + 'h' : '';
  return name + skill + ' ' + formatSigned(effect.value) + duration;
}

export interface RecipeAvailability {
  known: boolean;
  levelOk: boolean;
  stationOk: boolean;
  missing: { itemId: string; need: number; have: number }[];
  canCraft: boolean;
  maxQuantity: number;
}

export interface RecipeKnowledge {
  playerKnown: readonly string[];
  cookingKnown: readonly string[];
}

/**
 * Mirrors CraftingSystem.isRecipeKnown and the material/level checks so the panel can
 * show honest availability before dispatching. The system remains authoritative.
 */
export function recipeAvailability(input: {
  recipe: RecipeDef;
  inventory: readonly InventoryEntry[];
  knowledge: RecipeKnowledge;
  skillLevel: number;
  stationOk: boolean;
}): RecipeAvailability {
  const { recipe } = input;
  const known = recipe.unlockItemId
    ? input.knowledge.playerKnown.includes(recipe.id) || input.knowledge.cookingKnown.includes(recipe.id)
    : true;
  const levelOk = input.skillLevel >= recipe.levelReq;
  const missing: { itemId: string; need: number; have: number }[] = [];
  let maxQuantity = 0;
  for (const entry of recipe.inputs) {
    const have = countItem(input.inventory, entry.itemId);
    if (have < entry.quantity) missing.push({ itemId: entry.itemId, need: entry.quantity, have });
    const possible = entry.quantity > 0 ? Math.floor(have / entry.quantity) : 0;
    maxQuantity = maxQuantity === 0 ? possible : Math.min(maxQuantity, possible);
  }
  const canCraft = known && levelOk && input.stationOk && missing.length === 0;
  return {
    known,
    levelOk,
    stationOk: input.stationOk,
    missing,
    canCraft,
    maxQuantity: Math.min(maxQuantity, 99),
  };
}

export function countItem(inventory: readonly InventoryEntry[], itemId: string): number {
  let total = 0;
  for (const entry of inventory) if (entry.itemId === itemId) total += entry.quantity;
  return total;
}

export interface InventoryFilter {
  category?: ItemCategory | 'all';
  query?: string;
  equipmentOnly?: boolean;
}

export type InventorySort = 'name' | 'category' | 'quality' | 'quantity';

export function filterInventory(
  entries: readonly InventoryEntry[],
  content: IContentRegistry,
  filter: InventoryFilter = {}
): InventoryEntry[] {
  const category = filter.category ?? 'all';
  const query = (filter.query ?? '').trim().toLowerCase();
  return entries.filter((entry) => {
    const def = content.getItem(entry.itemId);
    if (filter.equipmentOnly === true && !def?.equipmentSlot) return false;
    if (category !== 'all' && def?.category !== category) return false;
    if (query.length === 0) return true;
    const name = def?.name ?? entry.itemId;
    return (
      name.toLowerCase().includes(query) ||
      entry.itemId.toLowerCase().includes(query) ||
      (def?.tags ?? []).some((tag) => tag.includes(query))
    );
  });
}

export function sortInventory(
  entries: readonly InventoryEntry[],
  content: IContentRegistry,
  sort: InventorySort
): InventoryEntry[] {
  const copy = [...entries];
  copy.sort((a, b) => {
    const defA = content.getItem(a.itemId);
    const defB = content.getItem(b.itemId);
    if (sort === 'quality') return b.quality - a.quality || nameOf(defA, a.itemId).localeCompare(nameOf(defB, b.itemId));
    if (sort === 'quantity') return b.quantity - a.quantity || nameOf(defA, a.itemId).localeCompare(nameOf(defB, b.itemId));
    if (sort === 'category') {
      const catA = defA?.category ?? 'misc';
      const catB = defB?.category ?? 'misc';
      return catA.localeCompare(catB) || nameOf(defA, a.itemId).localeCompare(nameOf(defB, b.itemId));
    }
    return nameOf(defA, a.itemId).localeCompare(nameOf(defB, b.itemId));
  });
  return copy;
}

function nameOf(def: ItemDef | undefined, fallback: string): string {
  return def?.name ?? fallback;
}

export function inventoryCategoryTabs(entries: readonly InventoryEntry[], content: IContentRegistry): ItemCategory[] {
  const seen = new Set<ItemCategory>();
  for (const entry of entries) {
    const category = content.getItem(entry.itemId)?.category;
    if (category) seen.add(category);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function equipmentSlotLabel(slot: EquipmentSlot): string {
  const labels: Record<EquipmentSlot, string> = {
    umbrella: 'Umbrella',
    windbreak: 'Windbreak',
    case: 'Cigarette case',
    outerwear: 'Outerwear',
    accessory: 'Accessory',
    hat: 'Hat',
    tool: 'Tool',
  };
  return labels[slot] ?? humaniseId(slot);
}

export function equipmentProtectionText(def: ItemDef | undefined): string {
  if (!def) return '';
  const parts: string[] = [];
  if (typeof def.moistureProtection === 'number' && def.moistureProtection > 0) {
    parts.push('rain ' + Math.round(def.moistureProtection * 100) + '%');
  }
  if (typeof def.windProtection === 'number' && def.windProtection > 0) {
    parts.push('wind ' + Math.round(def.windProtection * 100) + '%');
  }
  if (typeof def.burnRateMultiplier === 'number' && def.burnRateMultiplier !== 1) {
    parts.push('burn ×' + def.burnRateMultiplier.toFixed(2));
  }
  return parts.join(' · ');
}

export function freshnessLabel(freshness: number): { text: string; kind: 'ok' | 'warn' | 'bad' } {
  const value = clamp01(freshness);
  if (value >= 0.75) return { text: 'fresh', kind: 'ok' };
  if (value >= 0.4) return { text: 'aging', kind: 'warn' };
  return { text: 'stale', kind: 'bad' };
}

// ---------------------------------------------------------------------------
// HUD model
// ---------------------------------------------------------------------------
export interface HudBadge {
  label: string;
  kind: 'ok' | 'warn' | 'bad' | 'neutral';
}

export interface HudStatusEffect {
  label: string;
  remainingText: string;
}

export interface HudModel {
  signature: string;
  playerName: string;
  locationName: string;
  regionName: string;
  locationDetail: string;
  isIndoor: boolean;
  clockText: string;
  dateText: string;
  weekday: string;
  seasonName: string;
  seasonIcon: string;
  phaseLabel: string;
  phaseIcon: string;
  weatherLabel: string;
  weatherIcon: string;
  temperatureText: string;
  windText: string;
  windArrow: string;
  humidityText: string;
  daylightText: string;
  moneyText: string;
  influenceText: string;
  influenceTierName: string;
  influenceProgress: number;
  influenceNextText: string;
  communityPointsText: string;
  cigaretteLengthPercent: number;
  cigaretteLengthText: string;
  cigaretteRemainingText: string;
  moisturePercent: number;
  moistureText: string;
  burnRateText: string;
  ashText: string;
  bodyColor: string;
  filterColor: string;
  pattern: string;
  face: string;
  badges: HudBadge[];
  statusEffects: HudStatusEffect[];
  tutorialHint: string | null;
  isAlive: boolean;
}

const SEASON_ICONS: Record<Season, string> = {
  spring: '🌱',
  summer: '☀️',
  autumn: '🍂',
  winter: '❄️',
};

const WEATHER_ICONS: Record<WeatherType, string> = {
  clear: '☀️',
  cloudy: '☁️',
  rain: '🌧️',
  storm: '⛈️',
  fog: '🌫️',
  snow: '❄️',
  wind: '🌬️',
};

const PHASE_ICONS: Record<string, string> = {
  dawn: '🌅',
  morning: '🌤️',
  afternoon: '☀️',
  evening: '🌇',
  night: '🌙',
};

/** Authoritative influence ladder comes from the life system so the UI cannot drift. */
export const INFLUENCE_TIERS = GAME_INFLUENCE_TIERS;

const INFLUENCE_BLURBS: Readonly<Record<string, string>> = {
  new_resident: 'Nobody knows your name yet.',
  known: 'A few people nod when you pass.',
  respected: 'People ask for your opinion.',
  pillar: 'The town leans on you a little.',
  legend: 'Stories are told about you already.',
};

export interface InfluenceTierView {
  index: number;
  name: string;
  blurb: string;
  min: number;
  nextMin: number | null;
  progress: number;
  nextText: string;
}

export function influenceTier(influence: number): InfluenceTierView {
  const safe = Math.max(0, Number.isFinite(influence) ? influence : 0);
  let index = 0;
  for (let cursor = 0; cursor < INFLUENCE_TIERS.length; cursor += 1) {
    const tier = INFLUENCE_TIERS[cursor];
    if (tier && safe >= tier.minInfluence) index = cursor;
  }
  const current = INFLUENCE_TIERS[index] ?? INFLUENCE_TIERS[0]!;
  const next = INFLUENCE_TIERS[index + 1];
  const progress = next
    ? clamp01((safe - current.minInfluence) / Math.max(1, next.minInfluence - current.minInfluence))
    : 1;
  return {
    index,
    name: current.label,
    blurb: INFLUENCE_BLURBS[current.id] ?? '',
    min: current.minInfluence,
    nextMin: next ? next.minInfluence : null,
    progress,
    nextText: next ? Math.max(0, Math.ceil(next.minInfluence - safe)) + ' influence to ' + next.label : 'The summit.',
  };
}

export function windArrow(windDirectionDeg: number): string {
  const normalised = ((Number.isFinite(windDirectionDeg) ? windDirectionDeg : 0) % 360 + 360) % 360;
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  const index = Math.round(normalised / 45) % 8;
  return arrows[index] ?? '↑';
}

export function remainingCigaretteHours(lengthRatio: number, burnRate: number): number {
  const rate = Math.max(0.05, Number.isFinite(burnRate) ? burnRate : 1);
  return (clamp01(lengthRatio) * WORLD_CONFIG.cigarette.lifetimeGameHours) / rate;
}

export function weatherSummary(state: Readonly<GameState>): string {
  const env = state.world.environment;
  return WEATHER_DISPLAY_NAMES[env.weather] + ' · ' + Math.round(env.temperature) + '°C';
}

export function cigaretteBadges(state: Readonly<GameState>): HudBadge[] {
  const condition = state.player.cigarette;
  const env = state.world.environment;
  const badges: HudBadge[] = [];
  if (condition.isSheltered) badges.push({ label: 'sheltered', kind: 'ok' });
  else if (env.weather === 'rain' || env.weather === 'storm') badges.push({ label: 'in the rain', kind: 'bad' });
  else badges.push({ label: 'exposed', kind: 'neutral' });

  if (condition.moisture >= WORLD_CONFIG.cigarette.soakedThreshold) badges.push({ label: 'soaked', kind: 'bad' });
  else if (condition.moisture >= WORLD_CONFIG.cigarette.dampThreshold) badges.push({ label: 'damp', kind: 'warn' });
  else if (condition.moisture <= 0.08) badges.push({ label: 'bone dry', kind: 'warn' });
  else badges.push({ label: 'dry enough', kind: 'ok' });

  if (condition.burnRate >= 1.5) badges.push({ label: 'burning fast', kind: 'bad' });
  else if (condition.burnRate >= 1.2) badges.push({ label: 'burning warm', kind: 'warn' });
  else if (condition.burnRate <= 0.8) badges.push({ label: 'slow burn', kind: 'ok' });

  const maxAsh = WORLD_CONFIG.cigarette.maxAsh;
  if (condition.ashAccumulated >= maxAsh * 0.85) badges.push({ label: 'ash tray full', kind: 'warn' });
  else if (condition.ashAccumulated > 0.5) badges.push({ label: 'ash ' + condition.ashAccumulated.toFixed(1), kind: 'neutral' });

  if (env.windSpeed >= 0.6) badges.push({ label: 'gusty', kind: 'warn' });
  if (state.player.statusEffects.length > 0) badges.push({ label: 'buffs ' + state.player.statusEffects.length, kind: 'ok' });
  return badges;
}

export function activeStatusEffects(state: Readonly<GameState>): HudStatusEffect[] {
  const now = state.clock.simTimeSeconds;
  const effects: HudStatusEffect[] = [];
  for (const effect of state.player.statusEffects) {
    const remaining = effect.expiresAt === null ? null : Math.max(0, effect.expiresAt - now);
    if (remaining !== null && remaining <= 0) continue;
    effects.push({
      label: effect.label,
      remainingText: remaining === null ? 'ongoing' : formatDurationClock(remaining),
    });
    if (effects.length >= 6) break;
  }
  return effects;
}

/** Sim seconds -> a short duration label (1 sim second = 1 game minute). */
export function formatDurationClock(simSeconds: number): string {
  const minutesTotal = Math.max(0, Math.round(simSeconds));
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return days + 'd ' + restHours + 'h';
  }
  if (hours > 0) return hours + 'h ' + minutes + 'm';
  return minutes + 'm';
}

export function tutorialHint(state: Readonly<GameState>): string | null {
  if (!state.settings.showTutorialTips) return null;
  const condition = state.player.cigarette;
  if (condition.moisture >= WORLD_CONFIG.cigarette.soakedThreshold) {
    return 'You are soaked. Get under cover or warm up by a fire — wet cigarettes burn badly.';
  }
  if (condition.ashAccumulated >= WORLD_CONFIG.cigarette.maxAsh * 0.8) {
    return 'Your ash tray is nearly full. Open the inventory (I) and collect ash — it is good potash.';
  }
  if (state.player.statistics.npcsMet === 0) {
    return 'Walk up to someone (WASD) and press E to talk. Their name sticks to yours after that.';
  }
  if (state.life.generation === 1 && state.player.statistics.steps < 5) {
    return 'Move with WASD, interact with E. I inventory · M map · K social · L life · J journal.';
  }
  if (state.life.letters.some((letter) => !letter.read)) {
    return 'An unread letter waits in the journal (J).';
  }
  if (condition.ashAccumulated > 0.5 && state.player.inventory.length < 30) {
    return 'Loose ash can be collected from the inventory panel (I).';
  }
  const hour = simSecondsToGameTime(state.clock.simTimeSeconds).hour;
  if (hour >= 22 || hour < 5) {
    return 'It is late. Find a bed at home (E) or rest from the life panel (L).';
  }
  if (state.player.statusEffects.length === 0 && condition.moisture > 0.5) {
    return 'A fire or heater would dry you out — check the map (M) for shelter.';
  }
  if (state.eventSystem.festivals && Object.keys(state.eventSystem.festivals).length > 0) {
    return 'Festivals fill the event journal (Esc → Events, or the journal J).';
  }
  return null;
}

export function buildHudModel(state: Readonly<GameState>, content: IContentRegistry): HudModel {
  const player = state.player;
  const condition = player.cigarette;
  const env = state.world.environment;
  const time = simSecondsToGameTime(state.clock.simTimeSeconds);
  const locationDef = content.getLocation(player.position.locationId);
  const region = state.world.regions[player.position.regionId];
  const tier = influenceTier(player.influence);
  const lengthPercent = clamp01(condition.lengthRatio) * 100;
  const weatherIcon = WEATHER_ICONS[env.weather] ?? '🌤️';
  const badges = cigaretteBadges(state);
  const statusEffects = activeStatusEffects(state);
  const locationDetail =
    (locationDef ? humaniseId(locationDef.kind) : 'unknown') +
    (player.position.indoor ? ' · indoors' : '');
  const model: HudModel = {
    signature: '',
    playerName: player.name,
    locationName: locationDef?.name ?? humaniseId(player.position.locationId),
    regionName: region?.name ?? humaniseId(player.position.regionId),
    locationDetail,
    isIndoor: player.position.indoor || Boolean(locationDef?.indoor),
    clockText: String(time.hour).padStart(2, '0') + ':' + String(time.minute).padStart(2, '0'),
    dateText: SEASON_DISPLAY_NAMES[time.season] + ' ' + time.dayOfSeason + ', Year ' + time.year,
    weekday: WEEKDAY_NAMES[time.totalDays % 7] ?? 'Monday',
    seasonName: SEASON_DISPLAY_NAMES[env.season] ?? 'Spring',
    seasonIcon: SEASON_ICONS[env.season] ?? '🌱',
    phaseLabel: capitalise(time.phase),
    phaseIcon: PHASE_ICONS[time.phase] ?? '🕯️',
    weatherLabel: WEATHER_DISPLAY_NAMES[env.weather] ?? 'Clear',
    weatherIcon,
    temperatureText: Math.round(env.temperature) + '°C',
    windText: 'wind ' + Math.round(env.windSpeed * 100) + '% · ' + windArrow(env.windDirectionDeg),
    windArrow: windArrow(env.windDirectionDeg),
    humidityText: 'humidity ' + Math.round(env.humidity * 100) + '%',
    daylightText: 'daylight ' + Math.round(env.daylight * 100) + '%',
    moneyText: formatMoney(player.money),
    influenceText: Math.round(player.influence).toString(),
    influenceTierName: tier.name,
    influenceProgress: tier.progress,
    influenceNextText: tier.nextText,
    communityPointsText: Math.round(player.communityPoints) + ' community points',
    cigaretteLengthPercent: lengthPercent,
    cigaretteLengthText: lengthPercent.toFixed(1) + '% remaining',
    cigaretteRemainingText: '~' + Math.round(remainingCigaretteHours(condition.lengthRatio, condition.burnRate)) + 'h of burn left',
    moisturePercent: clamp01(condition.moisture) * 100,
    moistureText: 'moisture ' + Math.round(condition.moisture * 100) + '%',
    burnRateText: 'burn ×' + condition.burnRate.toFixed(2),
    ashText: 'ash ' + condition.ashAccumulated.toFixed(1) + ' / ' + WORLD_CONFIG.cigarette.maxAsh,
    bodyColor: player.appearance.bodyColor,
    filterColor: player.appearance.filterColor,
    pattern: player.appearance.pattern,
    face: player.appearance.face,
    badges,
    statusEffects,
    tutorialHint: tutorialHint(state),
    isAlive: state.life.phase === 'alive',
  };
  model.signature = JSON.stringify([
    model.playerName,
    model.locationName,
    model.locationDetail,
    model.clockText,
    model.dateText,
    model.weekday,
    model.weatherLabel,
    model.temperatureText,
    model.windText,
    model.humidityText,
    model.daylightText,
    model.moneyText,
    model.influenceText,
    model.influenceTierName,
    Math.round(model.influenceProgress * 100),
    model.influenceNextText,
    model.cigaretteLengthText,
    model.cigaretteRemainingText,
    model.moistureText,
    model.burnRateText,
    model.ashText,
    model.badges.map((badge) => badge.label + badge.kind).join(','),
    model.statusEffects.map((effect) => effect.label + effect.remainingText).join(','),
    model.tutorialHint ?? '',
    model.bodyColor,
    model.filterColor,
    model.isAlive,
  ]);
  return model;
}

// ---------------------------------------------------------------------------
// Map projection
// ---------------------------------------------------------------------------
export const MAP_TILE_PX = 32;

export interface MapNodeView {
  def: LocationDef;
  state: LocationState | undefined;
  x: number;
  y: number;
  discovered: boolean;
  unlocked: boolean;
  isCurrent: boolean;
  npcIds: string[];
}

export interface MapEdgeView {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MapRegionView {
  regionId: RegionId;
  name: string;
  minX: number;
  minY: number;
  width: number;
  height: number;
  nodes: MapNodeView[];
  edges: MapEdgeView[];
}

const MAP_PADDING = 3;
const MAP_LABEL_SPACE = 1.4;

/** Projects every exterior location of a region into an SVG viewBox. Pure + testable. */
export function projectRegionMap(
  regionId: RegionId,
  content: IContentRegistry,
  state: Readonly<GameState>
): MapRegionView {
  const region = state.world.regions[regionId];
  const locations = content.pack.locations.filter(
    (def) => def.regionId === regionId && def.entranceFrom === undefined
  );
  const knownNpcIds = new Set(Object.keys(state.player.relationships));
  const nodes: MapNodeView[] = [];
  for (const def of locations) {
    const locationState = state.world.locations[def.id];
    const discovered = locationState ? locationState.discovered : !def.secret;
    const unlocked = locationState ? locationState.unlocked : !def.secret;
    if (!discovered) continue;
    const occupants = Object.values(state.npcs)
      .filter((npc) => npc.locationId === def.id && knownNpcIds.has(npc.id))
      .map((npc) => npc.id);
    nodes.push({
      def,
      state: locationState,
      x: def.mapX * MAP_TILE_PX,
      y: def.mapY * MAP_TILE_PX,
      discovered,
      unlocked,
      isCurrent: state.player.position.locationId === def.id,
      npcIds: occupants,
    });
  }
  const byId = new Map(nodes.map((node) => [node.def.id, node]));
  const seen = new Set<string>();
  const edges: MapEdgeView[] = [];
  for (const node of nodes) {
    for (const neighbourId of node.def.connections) {
      const other = byId.get(neighbourId);
      if (!other) continue;
      const key = node.def.id < other.def.id ? node.def.id + '|' + other.def.id : other.def.id + '|' + node.def.id;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from: node.def.id,
        to: other.def.id,
        x1: node.x,
        y1: node.y,
        x2: other.x,
        y2: other.y,
      });
    }
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 10 * MAP_TILE_PX;
    maxY = 10 * MAP_TILE_PX;
  }
  const pad = MAP_PADDING * MAP_TILE_PX;
  return {
    regionId,
    name: region?.name ?? humaniseId(regionId),
    minX: minX - pad,
    minY: minY - pad,
    width: Math.max(4 * MAP_TILE_PX, maxX - minX + pad * 2),
    height: Math.max(4 * MAP_TILE_PX, maxY - minY + pad * 2 + MAP_LABEL_SPACE * MAP_TILE_PX),
    nodes,
    edges,
  };
}

/** All locations reachable in one step from the given location (mirrored graph + interiors). */
export function adjacentLocations(content: IContentRegistry, fromId: string): LocationDef[] {
  const current = content.getLocation(fromId);
  const ids = new Set<string>(current?.connections ?? []);
  for (const def of content.pack.locations) {
    if (def.connections.includes(fromId)) ids.add(def.id);
    if (def.entranceFrom === fromId) ids.add(def.id);
  }
  if (current?.entranceFrom) ids.add(current.entranceFrom);
  ids.delete(fromId);
  const result: LocationDef[] = [];
  for (const id of ids) {
    const def = content.getLocation(id);
    if (def) result.push(def);
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

/** The interior of the current exterior location, if one exists. */
export function interiorOfLocation(content: IContentRegistry, exteriorId: string): LocationDef | null {
  const match = content.pack.locations.find((def) => def.entranceFrom === exteriorId);
  return match ?? null;
}

export function locationStateFor(
  state: Readonly<GameState>,
  locationId: string
): LocationState | undefined {
  return state.world.locations[locationId];
}

// ---------------------------------------------------------------------------
// Social helpers
// ---------------------------------------------------------------------------
export interface NpcPortrait {
  initial: string;
  face: string;
  background: string;
  accent: string;
  skin: string;
}

export function npcPortrait(npc: NPCState | undefined, npcId: string): NpcPortrait {
  if (!npc) {
    return { initial: '?', face: '·', background: '#4a4152', accent: '#8a7a6a', skin: '#e8d8b8' };
  }
  const mood = npc.mood ?? 0;
  let face = '🙂';
  if ((npc.emotions.anger ?? 0) > 0.4) face = '😠';
  else if ((npc.emotions.sadness ?? 0) > 0.4) face = '😔';
  else if ((npc.emotions.fear ?? 0) > 0.4) face = '😟';
  else if ((npc.emotions.joy ?? 0) > 0.6) face = '😊';
  else if (mood < -0.1) face = '😐';
  const variants = ['🙂', '😊', '😐', '😌', '🤔'];
  if (face === '🙂') face = variants[stableHash(npcId) % variants.length] ?? '🙂';
  return {
    initial: npc.name.length > 0 ? npc.name.charAt(0).toUpperCase() : '?',
    face,
    background: npc.appearance.primaryColor,
    accent: npc.appearance.secondaryColor,
    skin: npc.appearance.skinTone,
  };
}

export function relationshipStatusLabel(status: RelationshipState['status']): string {
  return humaniseId(status);
}

export function relationshipDeltaKind(delta: number): 'ok' | 'warn' | 'bad' | 'neutral' {
  if (delta > 0.5) return 'ok';
  if (delta < -0.5) return 'bad';
  return 'neutral';
}

export interface RelationshipCard {
  npc: NPCState;
  relationship: RelationshipState;
  romanceable: boolean;
}

export function sortedRelationshipCards(
  state: Readonly<GameState>,
  content: IContentRegistry
): RelationshipCard[] {
  const cards: RelationshipCard[] = [];
  for (const [npcId, relationship] of Object.entries(state.player.relationships)) {
    const npc = state.npcs[npcId];
    if (!npc) continue;
    cards.push({ npc, relationship, romanceable: content.getNPC(npc.id)?.romanceable ?? false });
  }
  cards.sort((a, b) => b.relationship.affinity - a.relationship.affinity || a.npc.name.localeCompare(b.npc.name));
  return cards;
}

export function memoryLines(npc: NPCState | undefined, limit = 4): string[] {
  if (!npc) return [];
  const sorted = [...npc.memories].sort((a, b) => {
    if (a.permanent !== b.permanent) return a.permanent ? -1 : 1;
    if (b.importance !== a.importance) return b.importance - a.importance;
    return b.strength - a.strength;
  });
  const lines: string[] = [];
  for (const memory of sorted) {
    lines.push(memory.text);
    if (lines.length >= limit) break;
  }
  return lines;
}

export function locationName(content: IContentRegistry, locationId: string | null | undefined): string {
  if (!locationId) return 'nowhere';
  return content.getLocation(locationId)?.name ?? humaniseId(locationId);
}

export interface GiftOption {
  entry: InventoryEntry;
  def: ItemDef;
  liked: boolean;
}

/** Inventory entries ranked for gifting: liked tags first, then everything else. */
export function giftOptions(
  npcId: string,
  state: Readonly<GameState>,
  content: IContentRegistry
): GiftOption[] {
  const npcDef = content.getNPC(npcId);
  const likes = npcDef?.likes ?? [];
  const options: GiftOption[] = [];
  for (const entry of state.player.inventory) {
    const def = content.getItem(entry.itemId);
    if (!def) continue;
    const tags = def.giftTasteTags ?? def.tags;
    const liked = tags.some((tag) => likes.includes(tag));
    options.push({ entry, def, liked });
  }
  options.sort((a, b) => Number(b.liked) - Number(a.liked) || b.def.basePrice - a.def.basePrice);
  return options.slice(0, 12);
}

// ---------------------------------------------------------------------------
// Fishing helpers
// ---------------------------------------------------------------------------
export interface GearOption {
  entry: InventoryEntry;
  def: ItemDef;
}

export function fishingRodOptions(
  inventory: readonly InventoryEntry[],
  content: IContentRegistry
): GearOption[] {
  const rods: GearOption[] = [];
  for (const entry of inventory) {
    const def = content.getItem(entry.itemId);
    if (!def) continue;
    if (def.toolSkill === 'fishing') rods.push({ entry, def });
  }
  rods.sort((a, b) => (b.def.toolTier ?? 1) - (a.def.toolTier ?? 1));
  return rods;
}

export function fishingBaitOptions(
  inventory: readonly InventoryEntry[],
  content: IContentRegistry
): GearOption[] {
  const baits: GearOption[] = [];
  for (const entry of inventory) {
    const def = content.getItem(entry.itemId);
    if (!def) continue;
    const isBait = def.tags.some((tag) => tag === 'bait' || tag.startsWith('bait_')) || entry.itemId === 'legendary_lure';
    if (isBait) baits.push({ entry, def });
  }
  return baits;
}

// ---------------------------------------------------------------------------
// Housing helpers
// ---------------------------------------------------------------------------
export interface PlacementPreview {
  roomId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  inBounds: boolean;
  collisionIds: string[];
  fits: boolean;
}

const NON_BLOCKING_FURNITURE_TAG = 'nonblocking';

export function furnitureCollisionClass(def: FurnitureDef): 'wall' | 'surface' | 'blocking' {
  if (def.slot === 'wall') return 'wall';
  if (def.slot === 'surface') return 'surface';
  return 'blocking';
}

function furnitureFootprint(def: FurnitureDef, rotation: number): { width: number; height: number } {
  const normalised = ((Math.round(rotation) % 360) + 360) % 360;
  if (normalised === 90 || normalised === 270) return { width: def.heightTiles, height: def.widthTiles };
  return { width: def.widthTiles, height: def.heightTiles };
}

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

/**
 * Mirrors HousingSystem placement validation for the live grid preview.
 * The system stays authoritative when the player confirms the placement.
 */
export function previewFurniturePlacement(input: {
  home: HomeState;
  def: FurnitureDef;
  roomId: string;
  x: number;
  y: number;
  rotation: number;
  resolveFurniture: (furnitureId: string) => FurnitureDef | undefined;
}): PlacementPreview {
  const room = input.home.rooms.find((candidate) => candidate.id === input.roomId);
  const footprint = furnitureFootprint(input.def, input.rotation);
  const inBounds = Boolean(
    room &&
      input.x >= 0 &&
      input.y >= 0 &&
      input.x + footprint.width <= room.widthTiles &&
      input.y + footprint.height <= room.heightTiles
  );
  const collisionIds: string[] = [];
  const newClass = furnitureCollisionClass(input.def);
  for (const placed of input.home.furniture) {
    if (placed.roomId !== input.roomId) continue;
    const other = input.resolveFurniture(placed.furnitureId);
    if (!other) continue;
    if (furnitureCollisionClass(other) !== newClass) continue;
    if (newClass === 'blocking' && input.def.tags.includes(NON_BLOCKING_FURNITURE_TAG)) continue;
    const otherFootprint = furnitureFootprint(other, placed.rotation);
    if (
      rectsOverlap(
        input.x,
        input.y,
        footprint.width,
        footprint.height,
        placed.x,
        placed.y,
        otherFootprint.width,
        otherFootprint.height
      )
    ) {
      collisionIds.push(placed.id);
    }
  }
  return {
    roomId: input.roomId,
    x: input.x,
    y: input.y,
    width: footprint.width,
    height: footprint.height,
    inBounds,
    collisionIds,
    fits: inBounds && collisionIds.length === 0,
  };
}

export function ownedHomes(state: Readonly<GameState>): HomeState[] {
  const owned = new Set(state.housing.ownedHomeIds);
  return Object.values(state.housing.homes).filter(
    (home) => owned.has(home.id) || home.ownerId === state.player.id
  );
}

export const FLOOR_STYLES: readonly { id: string; name: string; color: string }[] = [
  { id: 'wood', name: 'Oak boards', color: '#8a6844' },
  { id: 'stone', name: 'Cool stone', color: '#7a7f86' },
  { id: 'tile', name: 'Terracotta tile', color: '#a86048' },
  { id: 'carpet', name: 'Wool carpet', color: '#7e6a92' },
  { id: 'checker', name: 'Checkerboard', color: '#c8c0b0' },
];

export const WALL_SWATCHES: readonly string[] = [
  '#e8d8b8',
  '#d8c0a0',
  '#c8a888',
  '#b89080',
  '#b8c8a8',
  '#a8c0c8',
  '#c8b8d8',
  '#e8e0d0',
];

// ---------------------------------------------------------------------------
// Life / archive helpers
// ---------------------------------------------------------------------------
export const LIFE_ARCHIVE_LABELS: Readonly<Record<string, string>> = {
  milestone: 'Milestones',
  relationship: 'Relationships',
  business: 'Business',
  exploration: 'Exploration',
  collection: 'Collection',
  event: 'Events',
  choice: 'Choices',
  death: 'The end',
  daily: 'Small days',
};

export function lifeArchiveIcon(category: string): string {
  const icons: Record<string, string> = {
    milestone: '🏆',
    relationship: '💞',
    business: '💼',
    exploration: '🧭',
    collection: '🏺',
    event: '🎪',
    choice: '🔀',
    death: '🕯️',
    daily: '🌾',
  };
  return icons[category] ?? '•';
}

export function groupLifeArchive<T extends { category: string }>(entries: readonly T[]): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const entry of entries) {
    const bucket = groups[entry.category];
    if (bucket) bucket.push(entry);
    else groups[entry.category] = [entry];
  }
  return groups;
}

export function totalSkillLevels(
  skills: Readonly<Record<string, number | { level: number }>>
): number {
  let total = 0;
  for (const value of Object.values(skills)) total += typeof value === 'number' ? value : value.level;
  return total;
}

/** XP needed for the next level, mirroring WORLD_CONFIG.skill growth. */
export function xpToNextForLevel(level: number): number {
  const maxLevel = WORLD_CONFIG.skill.maxLevel;
  if (level >= maxLevel) return 0;
  const xp = WORLD_CONFIG.skill.baseXpToLevel * Math.pow(WORLD_CONFIG.skill.xpGrowth, Math.max(0, level - 1));
  return Math.max(1, Math.round(xp));
}

export function skillSummaryLines(state: Readonly<GameState>): { skill: SkillId; label: string; level: number; progress: number }[] {
  const lines: { skill: SkillId; label: string; level: number; progress: number }[] = [];
  for (const [skill, progress] of Object.entries(state.player.skills)) {
    const id = skill as SkillId;
    const toNext = progress.xpToNext > 0 ? progress.xpToNext : xpToNextForLevel(progress.level);
    lines.push({
      skill: id,
      label: SKILL_DISPLAY_NAMES[id] ?? humaniseId(skill),
      level: progress.level,
      progress: toNext > 0 ? clamp01(progress.xp / toNext) : 1,
    });
  }
  return lines;
}

export function statusEffectLines(effects: readonly StatusEffectState[], nowSimSeconds: number): string[] {
  const lines: string[] = [];
  for (const effect of effects) {
    const remaining = effect.expiresAt === null ? null : Math.max(0, effect.expiresAt - nowSimSeconds);
    if (remaining !== null && remaining <= 0) continue;
    lines.push(effect.label + (remaining === null ? '' : ' · ' + formatDurationClock(remaining)));
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Event / journal helpers
// ---------------------------------------------------------------------------
export function eventCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    ordinary: '·',
    interesting: '✦',
    lucky: '🍀',
    unlucky: '⚠️',
    special: '✨',
  };
  return icons[category] ?? '·';
}

export function eventImportanceLabel(importance: number): string {
  if (importance >= 4) return 'life-changing';
  if (importance >= 3) return 'important';
  if (importance >= 2) return 'notable';
  return 'small';
}

export function offlineChangeIcon(kind: OfflineChange['kind']): string {
  const icons: Record<OfflineChange['kind'], string> = {
    npc: '👥',
    business: '🏪',
    farming: '🌾',
    economy: '💰',
    event: '🎪',
    relationship: '💞',
    weather: '⛅',
    player: '🚬',
    world: '🌍',
  };
  return icons[kind] ?? '·';
}

export function groupOfflineChanges(changes: readonly OfflineChange[]): { kind: OfflineChange['kind']; items: OfflineChange[] }[] {
  const order: OfflineChange['kind'][] = ['player', 'relationship', 'npc', 'business', 'economy', 'farming', 'event', 'weather', 'world'];
  const groups = new Map<OfflineChange['kind'], OfflineChange[]>();
  for (const change of changes) {
    const bucket = groups.get(change.kind);
    if (bucket) bucket.push(change);
    else groups.set(change.kind, [change]);
  }
  const result: { kind: OfflineChange['kind']; items: OfflineChange[] }[] = [];
  for (const kind of order) {
    const items = groups.get(kind);
    if (items && items.length > 0) result.push({ kind, items });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Probability debugger helpers
// ---------------------------------------------------------------------------
export interface CandidateBar {
  id: string;
  probabilityPercent: number;
  weight: number;
  eligible: boolean;
  color: string;
}

const CANDIDATE_COLORS = ['#e0b060', '#a8c98a', '#8fc4e0', '#d6a8e8', '#e89a8a', '#b0b8e8', '#e8cc8a'];

export function candidateBars(decision: Readonly<ProbabilityDecisionRecord>): CandidateBar[] {
  let total = 0;
  for (const candidate of decision.candidates) {
    if (candidate.eligible) total += candidate.finalWeight;
  }
  const bars: CandidateBar[] = [];
  decision.candidates.forEach((candidate, index) => {
    bars.push({
      id: candidate.id,
      probabilityPercent: candidate.eligible && total > 0 ? (candidate.finalWeight / total) * 100 : 0,
      weight: candidate.finalWeight,
      eligible: candidate.eligible,
      color: CANDIDATE_COLORS[index % CANDIDATE_COLORS.length] ?? '#e0b060',
    });
  });
  bars.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.probabilityPercent - a.probabilityPercent);
  return bars;
}

// ---------------------------------------------------------------------------
// Character creation helpers
// ---------------------------------------------------------------------------
export const BODY_COLOR_PRESETS: readonly string[] = [
  '#f7f3e8',
  '#efe4c8',
  '#e8d8b8',
  '#f0e6d2',
  '#e8c8a8',
  '#d8b8a0',
  '#c8d8c0',
  '#e8d0d8',
];

export const FILTER_COLOR_PRESETS: readonly string[] = [
  '#b07a4a',
  '#c89058',
  '#8a6844',
  '#a86048',
  '#7a6a80',
  '#5a7a8a',
  '#c8a86a',
  '#6a8a5a',
];

export const PATTERN_OPTIONS = ['plain', 'stripe', 'dots', 'zigzag'] as const;
export const FACE_OPTIONS = ['smile', 'neutral', 'wink', 'surprised', 'sleepy'] as const;

export function sanitiseHexColor(value: string, fallback: string): string {
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    const r = trimmed.charAt(1);
    const g = trimmed.charAt(2);
    const b = trimmed.charAt(3);
    return '#' + r + r + g + g + b + b;
  }
  return fallback;
}

export function parseSeed(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 0 || value > 4294967295) return null;
  return value;
}

export function parsePositiveInt(text: string, max: number, fallback = 1): number {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), Math.max(1, max));
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------
export function seasonIcon(season: Season): string {
  return SEASON_ICONS[season] ?? '🌱';
}

export function weatherIcon(weather: WeatherType): string {
  return WEATHER_ICONS[weather] ?? '🌤️';
}

export function gameTimeText(simSeconds: number): string {
  const time = simSecondsToGameTime(simSeconds);
  return SEASON_DISPLAY_NAMES[time.season] + ' ' + time.dayOfSeason + ' · ' + String(time.hour).padStart(2, '0') + ':' + String(time.minute).padStart(2, '0');
}

export function gameDateFromGameTime(time: GameTime): string {
  return SEASON_DISPLAY_NAMES[time.season] + ' ' + time.dayOfSeason + ', Year ' + time.year;
}

export function minutesUntilText(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded >= 60) return Math.floor(rounded / 60) + 'h ' + (rounded % 60) + 'm';
  return rounded + 'm';
}

export function clockOf(simSeconds: number): string {
  const time = simSecondsToGameTime(simSeconds);
  return String(time.hour).padStart(2, '0') + ':' + String(time.minute).padStart(2, '0');
}

export function townOf(content: IContentRegistry, regionId: RegionId | null): string {
  void content;
  if (regionId === 'willowbrook') return 'Willowbrook';
  if (regionId === 'ashford') return 'Ashford City';
  return 'the world';
}

export function quantityFraction(current: number, max: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return 0;
  return clamp01(current / max);
}

export function tierProgressForXp(level: number, xp: number): number {
  const toNext = xpToNextForLevel(level);
  return toNext > 0 ? clamp01(xp / toNext) : 1;
}

export function roundToTenth(value: number): number {
  return round(value, 1);
}

export function formatTemperature(celsius: number): string {
  const safe = Number.isFinite(celsius) ? celsius : 0;
  return (safe > 0 ? '+' : '') + Math.round(safe) + '°C';
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count + ' ' + (count === 1 ? singular : plural ?? singular + 's');
}
