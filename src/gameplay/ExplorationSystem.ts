import type {
  ActionResult,
  ExplorationLocationState,
  IExplorationSystem,
  IGameContext,
  ISkillSystem,
  IWorldSystem,
  PhotoState,
} from '../core/contracts';
import type { LocationDef } from '../data/schema';
import type { JsonValue, LocationId, QualityStars, SkillId } from '../core/SharedTypes';
import { SKILL_ACTIVITY_XP } from '../core/WorldConfig';
import { addWorldHistory } from '../world/WorldHistory';
import { ITEM } from '../data/items/ids';
import { addItemToInventory, countItem } from '../core/InventoryUtil';
import { clamp, clamp01, hashString, makeId, toJsonValue } from '../core/utils';

// 1 simulated second = 1 in-game minute, so a game hour is 60 sim seconds.
const SECONDS_PER_GAME_HOUR = 60;
/** One search per location per in-game hour. */
const SEARCH_COOLDOWN_SECONDS = SECONDS_PER_GAME_HOUR;
/** PlayerState.extras key where the photo album is persisted (see report: contract gap). */
const PHOTO_EXTRAS_KEY = 'nature.photos';
/** Default clues required before a secret can be unlocked when the location def omits it. */
const DEFAULT_CLUE_REQUIREMENT = 3;

const CLUE_POOL: readonly string[] = [
  'Scratched into a gatepost: half a name and a date three winters ago.',
  'An old survey mark points past the boundary hedge, to a path that is not on any map.',
  'A torn corner of a village map, with a walled garden sketched in green ink.',
  'A child\'s drawing of a well that nobody in the village remembers.',
  'A workman\'s note: "Leave the east door bolted. The cellar floods in spring."',
  'A faded shipping label for a warehouse consignment that never arrived.',
  'Initials carved under a windowsill, and a tiny keyhole beside them.',
  'A recipe in copperplate handwriting, marked "for the garden\'s keeper only".',
  'A newspaper clipping about a wedding in a garden that is not listed anywhere.',
  'A ring of pale stones on an old estate plan, deliberately left unlabelled.',
];

const PHOTO_KINDS: ReadonlySet<string> = new Set(['landscape', 'npc', 'fish', 'event', 'collection']);

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the persisted photo album out of PlayerState.extras (defensive: save data can be old). */
function readPhotos(extras: Record<string, JsonValue> | undefined): PhotoState[] {
  const raw = extras?.[PHOTO_EXTRAS_KEY];
  if (!Array.isArray(raw)) return [];
  const photos: PhotoState[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = entry['id'];
    const title = entry['title'];
    const description = entry['description'];
    const takenAt = entry['takenAt'];
    const locationId = entry['locationId'];
    const kind = entry['kind'];
    const subjectsRaw = entry['subjects'];
    if (typeof id !== 'string' || typeof title !== 'string' || typeof takenAt !== 'number' || typeof locationId !== 'string') continue;
    const subjects = Array.isArray(subjectsRaw) ? subjectsRaw.filter((subject): subject is string => typeof subject === 'string') : [];
    photos.push({
      id,
      title,
      description: typeof description === 'string' ? description : '',
      takenAt,
      locationId,
      subjects,
      kind: typeof kind === 'string' && PHOTO_KINDS.has(kind) ? (kind as PhotoState['kind']) : 'landscape',
    });
  }
  return photos;
}

/**
 * ExplorationSystem (system id 'exploration') - searching locations for clues, items,
 * photo opportunities and hidden places, unlocking secret locations with enough clues,
 * and a persistent photo album.
 *
 * All discovery draws use the module-owned `exploration.discovery` stream. Every search
 * has a 1 in-game-hour per-location cooldown. Nothing is ever permanently locked: the
 * clue weight grows with skill, collected clues and the number of previous searches.
 */
export class ExplorationSystem implements IExplorationSystem {
  readonly id = 'exploration';
  private ctx!: IGameContext;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    const exploration = ctx.state.exploration;
    if (!Number.isFinite(exploration.lastSearchAt)) exploration.lastSearchAt = 0;
    // Defensive repair of persisted records.
    for (const record of Object.values(exploration.locations)) {
      if (!Number.isFinite(record.lastSearchedAt)) record.lastSearchedAt = 0;
      if (!Array.isArray(record.clues)) record.clues = [];
      if (!Array.isArray(record.discoveredSecretIds)) record.discoveredSecretIds = [];
      if (!Array.isArray(record.photoIds)) record.photoIds = [];
    }
    if (!Array.isArray(exploration.clues)) exploration.clues = [];
    if (!Array.isArray(exploration.discoveredSecrets)) exploration.discoveredSecrets = [];
  }

  // -------------------------------------------------------------------------
  // Contract API
  // -------------------------------------------------------------------------

  search(locationId: string): ActionResult {
    const def = this.ctx.content.getLocation(locationId);
    if (!def) return { ok: false, code: 'not_found', message: 'Unknown location.' };
    if (!this.isPlayerAt(locationId)) {
      return { ok: false, code: 'wrong_location', message: 'You must be at this location to search it.' };
    }
    const now = this.ctx.clock.simTimeSeconds;
    const record = this.getRecord(locationId);
    const remaining = record.lastSearchedAt + SEARCH_COOLDOWN_SECONDS - now;
    if (record.lastSearchedAt > 0 && now - record.lastSearchedAt < SEARCH_COOLDOWN_SECONDS) {
      return {
        ok: false,
        code: 'on_cooldown',
        message: 'You have already searched here. Give it ' + Math.max(1, Math.ceil(remaining / 60)) + ' more minute(s).',
        data: { availableAt: record.lastSearchedAt + SEARCH_COOLDOWN_SECONDS },
      };
    }
    const env = this.ctx.state.world.environment;
    const time = this.ctx.clock.time;
    const level = this.getSkillLevel('exploration');
    const searchCount = record.searchCount;
    const secretNeighbour = this.findUndiscoveredSecret(def);
    const cluesHeld = this.ctx.state.exploration.clues.length;
    const weights: Record<'nothing' | 'clue' | 'item' | 'photo' | 'secret', number> = {
      nothing: 46,
      clue: 22 + level * 1.2 + Math.min(12, cluesHeld * 1.5) + Math.min(10, searchCount * 2),
      item: 18 + level * 0.8 + (def.forageTags.length > 0 ? 4 : 0),
      photo: 8 + level * 0.4,
      secret:
        (secretNeighbour ? 16 : 1) +
        level * 0.7 +
        Math.min(10, cluesHeld * 1.2) +
        (def.eventTags.includes('mysterious') || def.eventTags.includes('history') ? 8 : 0),
    };
    if (def.eventTags.includes('nature') || def.eventTags.includes('scenic')) weights.photo += 8;
    if (def.eventTags.includes('wild')) weights.item += 6;
    if (env.weather === 'fog') {
      weights.secret += 4;
      weights.photo -= 2;
    }
    if (env.weather === 'clear') weights.photo += 3;
    if (env.weather === 'rain' || env.weather === 'storm') weights.item += 2;
    if (time.hour >= 21 || time.hour < 5) {
      weights.secret += 3;
      weights.photo -= 3;
    }
    const candidates = (Object.keys(weights) as (keyof typeof weights)[]).map((key) => ({
      weight: Math.max(0.01, weights[key]),
      value: key as string,
    }));
    const outcome = this.ctx.probability.weighted('exploration.discovery', candidates) ?? 'nothing';

    record.searchCount += 1;
    record.lastSearchedAt = now;
    this.ctx.state.exploration.lastSearchAt = now;
    const worldLocation = this.ctx.state.world.locations[locationId];
    if (worldLocation) worldLocation.searchCount += 1;
    this.grantXp('exploration', SKILL_ACTIVITY_XP.exploration * 0.4, 'search');

    if (outcome === 'clue') return this.searchClue(def, record);
    if (outcome === 'item') return this.searchItem(def);
    if (outcome === 'photo') {
      this.grantXp('exploration', SKILL_ACTIVITY_XP.exploration * 0.2, 'photo_spot');
      return {
        ok: true,
        message: 'A view worth remembering: ' + this.photoHint(def),
        stateChanged: true,
        data: { outcome: 'photo', hint: this.photoHint(def) },
      };
    }
    if (outcome === 'secret') {
      const secretResult = this.tryDiscoverSecret(def, record);
      if (secretResult) return secretResult;
      return this.searchClue(def, record);
    }
    return {
      ok: true,
      message: 'You search carefully, but find nothing more than dust and old leaves.',
      stateChanged: true,
      data: { outcome: 'nothing' },
    };
  }

  unlockSecret(locationId: string): ActionResult {
    const def = this.ctx.content.getLocation(locationId);
    if (!def) return { ok: false, code: 'not_found', message: 'Unknown place.' };
    if (!def.secret) return { ok: false, code: 'invalid', message: 'There is no secret here.' };
    const worldLocation = this.ctx.state.world.locations[locationId];
    if (worldLocation?.unlocked) return { ok: false, code: 'invalid', message: 'You have already found this place.' };
    const requirement = def.clueRequirement ?? DEFAULT_CLUE_REQUIREMENT;
    const cluesHeld = this.ctx.state.exploration.clues.length;
    if (cluesHeld < requirement) {
      return {
        ok: false,
        code: 'requirement_not_met',
        message: 'You need ' + requirement + ' clues to piece this together. You have ' + cluesHeld + '.',
        data: { required: requirement, clues: cluesHeld },
      };
    }
    const currentLocation = this.getCurrentLocationId();
    const nearby =
      currentLocation === locationId ||
      def.connections.includes(currentLocation) ||
      (def.entranceFrom !== undefined && def.entranceFrom === currentLocation);
    if (!nearby) {
      return { ok: false, code: 'wrong_location', message: 'You must be at or beside this place to search for the way in.' };
    }
    const world = this.ctx.registry.getRequired<IWorldSystem>('world');
    const result = world.unlockLocation(locationId);
    if (!result.ok) return result;
    const exploration = this.ctx.state.exploration;
    if (!exploration.discoveredSecrets.includes(locationId)) exploration.discoveredSecrets.push(locationId);
    const record = this.getRecord(locationId);
    if (!record.discoveredSecretIds.includes(locationId)) record.discoveredSecretIds.push(locationId);
    if (worldLocation && !worldLocation.secretsFound.includes(locationId)) worldLocation.secretsFound.push(locationId);
    this.ctx.state.player.statistics.secretsFound += 1;
    this.ctx.bus.emit('discovery:made', {
      kind: 'secret',
      id: locationId,
      description: 'The way to ' + def.name + ' is open at last.',
    });
    addWorldHistory(this.ctx.state.world, {
      at: this.ctx.clock.simTimeSeconds,
      category: 'discovery',
      description: 'The player uncovered the secret of ' + def.name + '.',
      importance: 4,
      locationId,
    });
    this.grantXp('exploration', SKILL_ACTIVITY_XP.exploration * 2.5, 'unlock_secret');
    return {
      ok: true,
      message: 'Clues click into place. The way to ' + def.name + ' is open.',
      stateChanged: true,
      data: { locationId, name: def.name },
    };
  }

  takePhoto(locationId: string): ActionResult {
    const def = this.ctx.content.getLocation(locationId);
    if (!def) return { ok: false, code: 'not_found', message: 'Unknown place.' };
    if (!this.isPlayerAt(locationId)) return { ok: false, code: 'wrong_location', message: 'You must be there to take the photo.' };
    if (countItem(this.ctx.state.player.inventory, ITEM.camera) <= 0) {
      return { ok: false, code: 'not_enough_items', message: 'You need a camera to take photos.' };
    }
    const now = this.ctx.clock.simTimeSeconds;
    const worldLocation = this.ctx.state.world.locations[locationId];
    const occupants = worldLocation
      ? worldLocation.occupants
          .map((npcId) => this.ctx.state.npcs[npcId]?.name)
          .filter((name): name is string => typeof name === 'string')
      : [];
    let kind: PhotoState['kind'] = 'landscape';
    if (occupants.length > 0) kind = 'npc';
    else if (def.fishSpot) kind = 'fish';
    else if (def.facilities.includes('museum') || def.facilities.includes('library') || def.eventTags.includes('festival')) kind = 'collection';
    else if (def.kind === 'plaza' || def.kind === 'market' || def.kind === 'event_square') kind = 'event';
    const env = this.ctx.state.world.environment;
    const time = this.ctx.clock.time;
    const title = def.name + ' - ' + env.season + ', ' + env.weather;
    const description =
      kind === 'npc'
        ? 'A candid shot of ' + occupants.join(', ') + ' in ' + def.name + ' on a ' + env.weather + ' ' + env.season + ' afternoon.'
        : kind === 'fish'
          ? 'Still water at ' + def.name + ', the light breaking across it.'
          : kind === 'event'
            ? 'The bustle of ' + def.name + ' captured mid-morning.'
            : kind === 'collection'
              ? 'A study of the exhibits and shelves of ' + def.name + '.'
              : 'A wide view of ' + def.name + ', ' + env.weather + ' skies and the ' + env.season + ' light.';
    const photo: PhotoState = {
      id: makeId('photo'),
      title,
      description,
      takenAt: now,
      locationId,
      subjects: kind === 'npc' ? occupants : [],
      kind,
    };
    const photos = readPhotos(this.ctx.state.player.extras);
    photos.push(photo);
    this.writePhotos(photos);
    const record = this.getRecord(locationId);
    record.photoIds.push(photo.id);
    this.ctx.state.player.statistics.photosTaken += 1;
    this.ctx.bus.emit('discovery:made', { kind: 'photo', id: photo.id, description: title });
    this.grantXp('art', SKILL_ACTIVITY_XP.art, 'photo');
    this.grantXp('exploration', SKILL_ACTIVITY_XP.exploration * 0.5, 'photo');
    return {
      ok: true,
      message: 'You frame the shot and take it: "' + title + '".',
      stateChanged: true,
      data: { photoId: photo.id, kind, title, hour: time.hour },
    };
  }

  getDiscoveryState(locationId: string): ExplorationLocationState {
    return this.getRecord(locationId);
  }

  getPhotos(): PhotoState[] {
    return readPhotos(this.ctx.state.player.extras);
  }

  getSecrets(): string[] {
    return this.ctx.state.exploration.discoveredSecrets.slice();
  }

  // Extra read API used by UI panels.
  getClues(): string[] {
    return this.ctx.state.exploration.clues.slice();
  }

  update(dtSimSeconds: number): void {
    // Search cooldowns are derived from absolute timestamps; no per-tick state.
    void dtSimSeconds;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private searchClue(def: LocationDef, record: ExplorationLocationState): ActionResult {
    const exploration = this.ctx.state.exploration;
    const available = CLUE_POOL.filter((clue) => !exploration.clues.includes(clue));
    const index = this.ctx.probability.intRange('exploration.discovery', 0, Math.max(0, available.length - 1));
    const baseClue =
      available.length > 0 && available[index]
        ? available[index]!
        : 'A scuffed mark near ' + def.name + ' that looks deliberate... and recently disturbed.';
    const clue = baseClue;
    if (!exploration.clues.includes(clue)) exploration.clues.push(clue);
    if (!record.clues.includes(clue)) record.clues.push(clue);
    this.ctx.bus.emit('discovery:made', {
      kind: 'clue',
      id: 'clue:' + (hashString(clue) % 100000).toString(36),
      description: clue,
    });
    addWorldHistory(this.ctx.state.world, {
      at: this.ctx.clock.simTimeSeconds,
      category: 'discovery',
      description: 'A new clue was found at ' + def.name + '.',
      importance: 2,
      locationId: def.id,
    });
    this.grantXp('exploration', SKILL_ACTIVITY_XP.exploration, 'clue');
    return {
      ok: true,
      message: 'You find a clue: ' + clue,
      stateChanged: true,
      data: { outcome: 'clue', clue, totalClues: exploration.clues.length },
    };
  }

  private searchItem(def: LocationDef): ActionResult {
    const itemCandidates: { weight: number; value: string }[] = [];
    for (const node of this.ctx.content.pack.forageNodes) {
      if (node.locationId !== def.id) continue;
      const itemDef = this.ctx.content.getItem(node.itemId);
      itemCandidates.push({ weight: 1 + (itemDef ? (itemDef.rarity ?? 1) * 0.25 : 0), value: node.itemId });
    }
    if (itemCandidates.length === 0) {
      for (const itemId of this.fallbackItems(def)) {
        itemCandidates.push({ weight: 1, value: itemId });
      }
    }
    const selectedItemId = this.ctx.probability.weighted('exploration.discovery', itemCandidates);
    if (!selectedItemId) {
      return { ok: true, message: 'A promising glint turns out to be a beetle shell.', stateChanged: true, data: { outcome: 'nothing' } };
    }
    const itemDef = this.ctx.content.getItem(selectedItemId);
    const quantity = this.ctx.probability.intRange('exploration.discovery', 1, itemCandidates.length > 4 ? 2 : 1);
    const level = this.getSkillLevel('exploration');
    const quality = qualityStars(0.22 + clamp01((level - 1) / 19) * 0.35 + this.ctx.probability.roll('exploration.discovery') * 0.3);
    addItemToInventory(this.ctx.state.player.inventory, selectedItemId, quantity, {
      quality: itemDef?.hasQuality ? quality : 1,
      freshness: 1,
      simTime: this.ctx.clock.simTimeSeconds,
      maxStack: itemDef?.maxStack ?? 99,
    });
    this.ctx.bus.emit('item:acquired', {
      itemId: selectedItemId,
      quantity,
      quality: itemDef?.hasQuality ? quality : 1,
      source: 'exploration',
    });
    this.grantXp('exploration', SKILL_ACTIVITY_XP.exploration * 0.6, 'item');
    return {
      ok: true,
      message: 'Tucked out of sight you find ' + quantity + ' ' + (itemDef?.name ?? selectedItemId) + '.',
      stateChanged: true,
      data: { outcome: 'item', itemId: selectedItemId, quantity },
    };
  }

  private tryDiscoverSecret(def: LocationDef, record: ExplorationLocationState): ActionResult | null {
    const secret = this.findUndiscoveredSecret(def);
    if (!secret) return null;
    const world = this.ctx.registry.getRequired<IWorldSystem>('world');
    const result = world.discoverLocation(secret.id);
    if (!result.ok) return null;
    if (!record.discoveredSecretIds.includes(secret.id)) record.discoveredSecretIds.push(secret.id);
    this.ctx.bus.emit('discovery:made', {
      kind: 'location',
      id: secret.id,
      description: 'Through the trees, a path you have never noticed before leads to ' + secret.name + '.',
    });
    addWorldHistory(this.ctx.state.world, {
      at: this.ctx.clock.simTimeSeconds,
      category: 'discovery',
      description: 'The player discovered the hidden path to ' + secret.name + '.',
      importance: 3,
      locationId: secret.id,
    });
    this.grantXp('exploration', SKILL_ACTIVITY_XP.exploration * 1.6, 'discover_location');
    return {
      ok: true,
      message: 'The undergrowth gives way. You have found the way to ' + secret.name + '!',
      stateChanged: true,
      data: { outcome: 'secret', locationId: secret.id, name: secret.name },
    };
  }

  /** A nearby (or same-location) locked secret that the player has not discovered yet. */
  private findUndiscoveredSecret(def: LocationDef): LocationDef | undefined {
    for (const candidate of this.ctx.content.pack.locations) {
      if (!candidate.secret || candidate.id === def.id) continue;
      const state = this.ctx.state.world.locations[candidate.id];
      if (!state || state.discovered) continue;
      if (candidate.connections.includes(def.id) || def.connections.includes(candidate.id) || candidate.entranceFrom === def.id) {
        return candidate;
      }
    }
    return undefined;
  }

  private fallbackItems(def: LocationDef): string[] {
    switch (def.kind) {
      case 'forest':
      case 'countryside':
      case 'park':
      case 'orchard':
        return [ITEM.wood, ITEM.stone, ITEM.feather, ITEM.fibre, ITEM.wildBerries];
      case 'river':
      case 'lake':
        return [ITEM.stone, ITEM.clay, ITEM.feather, ITEM.fibre];
      case 'abandoned_farmhouse':
      case 'warehouse':
        return [ITEM.scrapMetal, ITEM.glassShard, ITEM.charcoal, ITEM.coal];
      default:
        return [ITEM.stone, ITEM.wood, ITEM.wildHerb];
    }
  }

  private photoHint(def: LocationDef): string {
    const env = this.ctx.state.world.environment;
    if (def.kind === 'park' || def.kind === 'forest') return 'the ' + env.season + ' light through the trees';
    if (def.kind === 'lake' || def.kind === 'river') return 'the water reflecting a ' + env.weather + ' sky';
    if (def.kind === 'plaza' || def.kind === 'market') return 'the villagers going about their day';
    return 'the way the light falls across ' + def.name;
  }

  private getRecord(locationId: string): ExplorationLocationState {
    const exploration = this.ctx.state.exploration;
    const existing = exploration.locations[locationId];
    if (existing) return existing;
    const created: ExplorationLocationState = {
      locationId,
      searchCount: 0,
      lastSearchedAt: 0,
      clues: [],
      discoveredSecretIds: [],
      photoIds: [],
    };
    exploration.locations[locationId] = created;
    return created;
  }

  private writePhotos(photos: PhotoState[]): void {
    const extras = this.ctx.state.player.extras;
    const next: Record<string, JsonValue> = { ...(extras ?? {}) };
    next[PHOTO_EXTRAS_KEY] = toJsonValue(photos);
    this.ctx.state.player.extras = next;
  }

  private getCurrentLocationId(): string {
    const world = this.ctx.registry.get<IWorldSystem>('world');
    if (world) return world.getCurrentLocationId();
    return this.ctx.state.player.position.locationId;
  }

  private isPlayerAt(locationId: string): boolean {
    return this.getCurrentLocationId() === locationId;
  }

  private getSkillLevel(skill: SkillId): number {
    return this.ctx.registry.getRequired<ISkillSystem>('skill').getLevel(skill);
  }

  private grantXp(skill: SkillId, amount: number, source: string): void {
    this.ctx.registry.getRequired<ISkillSystem>('skill').addXp(skill, amount, 'exploration:' + source);
  }
}

function qualityStars(score: number): QualityStars {
  return clamp(1 + Math.floor(clamp01(score) * 4.999), 1, 5) as QualityStars;
}