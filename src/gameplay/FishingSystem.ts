import type {
  ActionResult,
  FishingSessionState,
  FishingState,
  IGameContext,
  IFishingSystem,
  ISkillSystem,
  IWorldSystem,
} from '../core/contracts';
import type { FishDef, LocationDef } from '../data/schema';
import type { FishId, InventoryEntry, ItemId, QualityStars, Season, SkillId, WeatherType } from '../core/SharedTypes';
import { WORLD_CONFIG, SKILL_ACTIVITY_XP } from '../core/WorldConfig';
import { ITEM } from '../data/items/ids';
import { addItemToInventory, findEntry, removeItemFromInventory } from '../core/InventoryUtil';
import { clamp, clamp01 } from '../core/utils';

/** Short window (sim seconds) after the bite in which the player must strike. */
const BITE_WINDOW_SECONDS = 6;
/** If the player stops reeling for this long the fish works the hook loose. */
const NO_INPUT_ESCAPE_SECONDS = 4;
/** A single update larger than this means offline catch-up: never simulate a minigame across it. */
const LARGE_DT_CANCEL_SECONDS = 60;
/** AI decision cadence for the reeling minigame. */
const MINIGAME_INTERVAL_SECONDS = 0.5;
/** Safety cap on minigame AI ticks processed in one update. */
const MAX_MINIGAME_TICKS = 24;
/** Tension lost per second while the player is not reeling. */
const TENSION_DECAY_PER_SECOND = 34;
/** Stamina regeneration per second while the fish is not being fought. */
const STAMINA_REGEN_PER_SECOND = 6;
const STAMINA_MAX = 100;

const ROD_TIER_BY_ID: Readonly<Record<string, number>> = {
  [ITEM.fishingRodBasic]: 1,
  [ITEM.fishingRodGood]: 2,
  [ITEM.fishingRodMaster]: 3,
};

function qualityFromScore(score: number): QualityStars {
  return clamp(1 + Math.floor(clamp01(score) * 4.999), 1, 5) as QualityStars;
}

function isHourActive(fish: FishDef, hour: number): boolean {
  const start = fish.startHour;
  const end = fish.endHour;
  if (start === end) return true;
  const normalisedStart = ((start % 24) + 24) % 24;
  const normalisedEnd = ((end % 24) + 24) % 24;
  const h = ((hour % 24) + 24) % 24;
  if (normalisedStart < normalisedEnd) return h >= normalisedStart && h < normalisedEnd;
  return h >= normalisedStart || h < normalisedEnd;
}

/**
 * FishingSystem (system id 'fishing') - cast / wait / bite / tension minigame / land.
 *
 * The waiting phase resolves its bite time at cast time from absolute sim timestamps, so
 * a large offline delta cancels the session cleanly instead of hanging. The reeling phase
 * is a deterministic state machine driven by the `fishing.minigame` stream on a fixed
 * 0.5s accumulator (no per-frame randomness explosion).
 */
export class FishingSystem implements IFishingSystem {
  readonly id = 'fishing';
  private ctx!: IGameContext;
  /** Continuous reel input while the player holds the button. Transient, not saved. */
  private holding = false;
  /** Accumulator for the 0.5s fish AI cadence. Transient, not saved. */
  private minigameAccumulator = 0;
  /** FishId -> catch item id, built once from the content pack. */
  private readonly fishItemByFishId = new Map<string, ItemId>();

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.fishItemByFishId.clear();
    for (const item of ctx.content.pack.items) {
      if (item.fishId && !this.fishItemByFishId.has(item.fishId)) {
        this.fishItemByFishId.set(item.fishId, item.id);
      }
    }
    this.holding = false;
    this.minigameAccumulator = 0;
    const session = ctx.state.fishing.session;
    if (session) {
      // A save mid-fight cannot preserve a held button; grant a fresh input grace window.
      if (session.phase === 'reeling' || session.phase === 'bite') session.lastUpdateAt = ctx.clock.simTimeSeconds;
      if (!Number.isFinite(session.tension)) session.tension = 0;
      if (!Number.isFinite(session.progress)) session.progress = 0;
      if (!Number.isFinite(session.stamina)) session.stamina = STAMINA_MAX;
    }
  }

  // -------------------------------------------------------------------------
  // Contract API
  // -------------------------------------------------------------------------

  castLine(locationId: string, rodInstanceId?: string, baitInstanceId?: string): ActionResult {
    const session = this.ctx.state.fishing.session;
    if (session && (session.phase === 'waiting' || session.phase === 'bite' || session.phase === 'reeling' || session.phase === 'casting')) {
      return { ok: false, code: 'busy', message: 'You are already fishing. Reel in first.' };
    }
    const def = this.ctx.content.getLocation(locationId);
    if (!def) return { ok: false, code: 'not_found', message: 'Unknown location.' };
    if (!def.fishSpot) return { ok: false, code: 'not_allowed', message: 'There is no fishable water here.' };
    if (!this.isPlayerAt(locationId)) {
      return { ok: false, code: 'wrong_location', message: 'You must stand by the water to cast.' };
    }
    const now = this.ctx.clock.simTimeSeconds;
    const inventory = this.ctx.state.player.inventory;
    const rod = this.resolveRod(inventory, rodInstanceId);
    if (!rod.ok) return rod.result;
    const bait = this.resolveBait(inventory, baitInstanceId);
    if (!bait.ok) return bait.result;
    const level = this.getSkillLevel('fishing');
    const candidates = this.fishCandidates(def, environmentOf(this.ctx), level, rod.tier, bait.tags);
    let selected = this.ctx.probability.weighted('fishing.results', candidates);
    if (!selected) {
      // Last-resort: an old boot is always possible, keeping the water from being dead content.
      selected = this.ctx.content.getFish('junk_boot') ?? null;
    }
    if (!selected) return { ok: false, code: 'unsupported', message: 'The water is empty and silent.' };
    const fish = selected;
    const env = environmentOf(this.ctx);
    const waitMinutes = this.ctx.probability.floatRange(
      'fishing.results',
      WORLD_CONFIG.fishing.baseBiteWaitGameMinutes.min,
      WORLD_CONFIG.fishing.baseBiteWaitGameMinutes.max
    );
    const waitMultiplier =
      clamp(1 - (level - 1) * 0.02, 0.55, 1) *
      (bait.tags.length > 0 ? 0.82 : 1) *
      (1 - (rod.tier - 1) * 0.07) *
      weatherWaitMultiplier(env.weather);
    // Game minutes and simulated seconds are 1:1 (1 sim second = 1 game minute); clamp to a
    // few real seconds so a cast never feels frozen.
    const waitSeconds = Math.max(4, waitMinutes * waitMultiplier);
    let baitItemId: ItemId | null = null;
    if (bait.entry) {
      baitItemId = bait.entry.itemId;
      removeItemFromInventory(inventory, bait.entry.itemId, 1, bait.entry.instanceId);
      this.ctx.bus.emit('item:lost', { itemId: bait.entry.itemId, quantity: 1, reason: 'fishing_bait' });
    }
    const newSession: FishingSessionState = {
      locationId,
      phase: 'waiting',
      startedAt: now,
      waitUntil: now + waitSeconds,
      targetFishId: fish.id,
      fishSizeCm: 0,
      tension: 0,
      progress: 0,
      stamina: STAMINA_MAX,
      rodItemId: rod.itemId,
      baitItemId,
      lastUpdateAt: now,
      message: 'You cast the line. The float settles on the surface.',
    };
    this.holding = false;
    this.minigameAccumulator = 0;
    this.ctx.state.fishing.session = newSession;
    this.ctx.state.fishing.casts += 1;
    this.ctx.state.fishing.lastResultMessage = newSession.message;
    this.grantXp('fishing', SKILL_ACTIVITY_XP.fishing * 0.2, 'cast');
    return {
      ok: true,
      message: newSession.message,
      stateChanged: true,
      data: { waitUntil: newSession.waitUntil, baitUsed: baitItemId, rodTier: rod.tier },
    };
  }

  reel(hold: boolean): ActionResult {
    this.holding = hold;
    const session = this.ctx.state.fishing.session;
    if (!session) return { ok: false, code: 'invalid', message: 'You are not fishing.' };
    const now = this.ctx.clock.simTimeSeconds;
    if (session.phase === 'waiting') {
      return { ok: true, message: hold ? 'You keep the line taut and wait.' : 'You loosen the drag.', stateChanged: false };
    }
    if (session.phase === 'bite') {
      if (!hold) return { ok: true, message: 'The float dips again. Strike now!', stateChanged: false };
      session.phase = 'reeling';
      session.lastUpdateAt = now;
      session.tension = 12;
      session.progress = 0;
      session.stamina = STAMINA_MAX;
      session.message = 'Hooked! Keep the line tense without snapping it.';
      this.ctx.state.fishing.lastResultMessage = session.message;
      this.grantXp('fishing', SKILL_ACTIVITY_XP.fishing * 0.1, 'hook');
      return { ok: true, message: session.message, stateChanged: true, data: { phase: 'reeling' } };
    }
    if (session.phase === 'reeling') {
      if (hold) session.lastUpdateAt = now;
      return {
        ok: true,
        message: hold ? 'You reel in, watching the tension.' : 'You let the fish run a little.',
        stateChanged: false,
      };
    }
    return { ok: false, code: 'invalid', message: 'There is nothing on the line.' };
  }

  cancelFishing(): ActionResult {
    const session = this.ctx.state.fishing.session;
    if (!session) return { ok: false, code: 'invalid', message: 'You are not fishing.' };
    this.ctx.state.fishing.session = null;
    this.ctx.state.fishing.lastResultMessage = 'You reel in an empty line.';
    this.holding = false;
    this.minigameAccumulator = 0;
    return { ok: true, message: this.ctx.state.fishing.lastResultMessage, stateChanged: true };
  }

  getSession(): FishingSessionState | null {
    return this.ctx.state.fishing.session;
  }

  getAvailableFish(locationId: string): FishId[] {
    const def = this.ctx.content.getLocation(locationId);
    if (!def || !def.fishSpot) return [];
    const level = this.getSkillLevel('fishing');
    return this.fishCandidates(def, environmentOf(this.ctx), level, 1, []).map((candidate) => candidate.value.id);
  }

  getFishingState(): FishingState {
    return this.ctx.state.fishing;
  }

  // -------------------------------------------------------------------------
  // Simulation update
  // -------------------------------------------------------------------------

  update(dtSimSeconds: number): void {
    const session = this.ctx.state.fishing.session;
    if (!session) return;
    const dt = Number.isFinite(dtSimSeconds) && dtSimSeconds > 0 ? dtSimSeconds : 0;
    const now = this.ctx.clock.simTimeSeconds;
    if (dt > LARGE_DT_CANCEL_SECONDS) {
      this.finishSession('You were away too long; the fish took the bait and left.');
      return;
    }
    if (session.phase === 'waiting') {
      const biteAt = session.waitUntil;
      if (now >= biteAt + BITE_WINDOW_SECONDS) {
        this.finishSession('The float dipped while you were daydreaming. The fish is gone.');
        return;
      }
      if (now >= biteAt) {
        session.phase = 'bite';
        session.waitUntil = biteAt + BITE_WINDOW_SECONDS;
        session.lastUpdateAt = now;
        session.message = 'A bite! Strike now - reel in!';
        this.ctx.state.fishing.lastResultMessage = session.message;
        this.ctx.bus.emit('game:signal', { name: 'fishing_bite', data: { locationId: session.locationId } });
      }
      return;
    }
    if (session.phase === 'bite') {
      if (now > session.waitUntil) {
        this.finishSession('The fish spat out the bait and slipped away.');
        return;
      }
      return;
    }
    if (session.phase !== 'reeling') return;
    const fish = session.targetFishId ? this.ctx.content.getFish(session.targetFishId) : undefined;
    if (!fish) {
      this.finishSession('Whatever was on the line is gone.');
      return;
    }

    // No-input escape: the fish works the hook loose if the player stops reeling too long.
    if (!this.holding && now - session.lastUpdateAt > NO_INPUT_ESCAPE_SECONDS) {
      this.finishSession('You gave the fish too much slack. The hook pulled free.');
      return;
    }

    const rodTier = this.rodTierForItem(session.rodItemId);
    const difficulty = clamp(fish.difficulty, 1, 5);
    const staminaRatio = clamp01(session.stamina / STAMINA_MAX);
    const tensionRise =
      WORLD_CONFIG.fishing.tensionRisePerSecond * (1 + (difficulty - 1) * 0.12) * (0.7 + staminaRatio * 0.5);
    const progressRate =
      WORLD_CONFIG.fishing.progressPerSecond *
      (1 - (difficulty - 1) * 0.07) *
      (0.75 + (1 - staminaRatio) * 0.45) *
      (1 + (rodTier - 1) * 0.1);
    if (this.holding) {
      session.tension = clamp(session.tension + tensionRise * dt, 0, WORLD_CONFIG.fishing.escapeTension);
      session.progress = clamp(session.progress + progressRate * dt, 0, WORLD_CONFIG.fishing.catchProgress);
      session.stamina = clamp(session.stamina - (8 + difficulty * 2.5) * dt, 0, STAMINA_MAX);
    } else {
      session.tension = clamp(session.tension - TENSION_DECAY_PER_SECOND * dt, 0, WORLD_CONFIG.fishing.escapeTension);
      session.stamina = clamp(session.stamina + STAMINA_REGEN_PER_SECOND * dt, 0, STAMINA_MAX);
    }

    // Fish stamina AI on a fixed 0.5s accumulator; bounded so a mid-size delta cannot loop forever.
    this.minigameAccumulator += dt;
    let ticks = 0;
    while (this.minigameAccumulator >= MINIGAME_INTERVAL_SECONDS && ticks < MAX_MINIGAME_TICKS) {
      this.minigameAccumulator -= MINIGAME_INTERVAL_SECONDS;
      ticks += 1;
      const aiRoll = this.ctx.probability.roll('fishing.minigame');
      if (aiRoll < 0.3) {
        // Surge: the fish bolts and tension spikes.
        session.tension = clamp(session.tension + 5 + difficulty * 1.5, 0, WORLD_CONFIG.fishing.escapeTension);
        session.message = 'The fish surges! Ease off!';
      } else if (aiRoll < 0.45) {
        // Dodge: the fish shakes the hook and the player loses ground.
        session.progress = clamp(session.progress - 3 - difficulty * 0.5, 0, WORLD_CONFIG.fishing.catchProgress);
        session.message = 'It shakes its head and runs.';
      } else if (aiRoll < 0.7) {
        // Tiring: the fish rests.
        session.stamina = clamp(session.stamina - 2, 0, STAMINA_MAX);
        session.message = 'The fish is tiring.';
      } else {
        // Slack: the fish drifts back toward cover.
        session.progress = clamp(session.progress - 1, 0, WORLD_CONFIG.fishing.catchProgress);
        session.message = 'The line goes slack for a moment.';
      }
    }
    if (this.minigameAccumulator > MINIGAME_INTERVAL_SECONDS * MAX_MINIGAME_TICKS) {
      this.minigameAccumulator = 0;
    }
    session.lastUpdateAt = this.holding ? now : session.lastUpdateAt;

    if (session.tension >= WORLD_CONFIG.fishing.escapeTension) {
      this.finishSession('Snap! The line breaks under the strain and the fish escapes.');
      return;
    }
    if (session.progress >= WORLD_CONFIG.fishing.catchProgress) {
      this.landFish(session, fish, rodTier);
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private resolveRod(
    inventory: readonly InventoryEntry[],
    rodInstanceId?: string
  ): { ok: true; itemId: ItemId; tier: number } | { ok: false; result: ActionResult } {
    if (rodInstanceId) {
      const entry = findEntry(inventory, rodInstanceId);
      if (!entry) return { ok: false, result: { ok: false, code: 'not_found', message: 'That rod is not in your bag.' } };
      const tier = this.rodTierForItem(entry.itemId);
      if (tier <= 0) return { ok: false, result: { ok: false, code: 'invalid', message: 'That is not a fishing rod.' } };
      return { ok: true, itemId: entry.itemId, tier };
    }
    let best: { itemId: ItemId; tier: number } | null = null;
    for (const entry of inventory) {
      const tier = this.rodTierForItem(entry.itemId);
      if (tier > (best?.tier ?? 0)) best = { itemId: entry.itemId, tier };
    }
    if (!best) {
      return {
        ok: false,
        result: { ok: false, code: 'not_enough_items', message: 'You need a fishing rod. The tackle shop sells them.' },
      };
    }
    return { ok: true, itemId: best.itemId, tier: best.tier };
  }

  private resolveBait(
    inventory: readonly InventoryEntry[],
    baitInstanceId?: string
  ): { ok: true; entry: InventoryEntry | null; tags: string[] } | { ok: false; result: ActionResult } {
    if (!baitInstanceId) return { ok: true, entry: null, tags: [] };
    const entry = findEntry(inventory, baitInstanceId);
    if (!entry) return { ok: false, result: { ok: false, code: 'not_found', message: 'That bait is not in your bag.' } };
    const itemDef = this.ctx.content.getItem(entry.itemId);
    const tags = itemDef ? itemDef.tags.filter((tag) => tag === 'bait' || tag.startsWith('bait_')) : [];
    const isLure = entry.itemId === ITEM.legendaryLure;
    if (!isLure && tags.length === 0) {
      return { ok: false, result: { ok: false, code: 'invalid', message: 'That is not usable as bait.' } };
    }
    if (isLure) tags.push('bait_legendary');
    return { ok: true, entry, tags };
  }

  private rodTierForItem(itemId: ItemId | null): number {
    if (!itemId) return 1;
    const fromId = ROD_TIER_BY_ID[itemId];
    if (fromId) return fromId;
    const itemDef = this.ctx.content.getItem(itemId);
    if (itemDef && itemDef.toolSkill === 'fishing') return clamp(Math.round(itemDef.toolTier ?? 1), 1, 3);
    return 0;
  }

  /** Weighted candidate list of fish for the given water, environment and gear. */
  private fishCandidates(
    def: LocationDef,
    env: { season: Season; weather: WeatherType; hour: number },
    level: number,
    rodTier: number,
    baitTags: readonly string[]
  ): { weight: number; value: FishDef }[] {
    const fishSpot = def.fishSpot;
    if (!fishSpot) return [];
    const candidates: { weight: number; value: FishDef }[] = [];
    for (const fish of this.ctx.content.pack.fish) {
      if (!fish.habitats.some((habitat) => habitat === def.id || habitat === fishSpot.waterType)) continue;
      if (!fish.seasons.includes(env.season)) continue;
      if (!isHourActive(fish, env.hour)) continue;
      if (!fish.weathers.includes(env.weather)) continue;
      if (fish.skillReq > level + 3) continue;
      let weight = fish.weight;
      if (fish.skillReq > level) weight *= Math.max(0.08, 1 - (fish.skillReq - level) * 0.22);
      else weight *= 1 + (level - fish.skillReq) * 0.03;
      if (fish.rarity >= 3) weight *= 0.5 + fishSpot.quality;
      if (rodTier >= 3 && fish.rarity >= 3) weight *= 1.35;
      else if (rodTier <= 1 && fish.rarity >= 4) weight *= 0.45;
      if (baitTags.length > 0 && fish.baitTags.some((tag) => baitTags.includes(tag))) weight *= 1.7;
      if (weight > 0) candidates.push({ weight, value: fish });
    }
    return candidates;
  }

  private landFish(session: FishingSessionState, fish: FishDef, rodTier: number): void {
    const now = this.ctx.clock.simTimeSeconds;
    const itemId = this.fishItemByFishId.get(fish.id);
    if (!itemId) {
      this.ctx.logger.error('[fishing] no item definition for fish ' + fish.id);
      this.finishSession('You land something undefined and it slips back into the water.');
      return;
    }
    const itemDef = this.ctx.content.getItem(itemId);
    const level = this.getSkillLevel('fishing');
    const levelFactor = clamp01((level - 1) / 19);
    const sizeRoll = this.ctx.probability.roll('fishing.results');
    const sizeFactor = clamp01(0.15 + sizeRoll * 0.6 + levelFactor * 0.25 + (rodTier - 1) * 0.05);
    const sizeCm = Math.round((fish.minSizeCm + (fish.maxSizeCm - fish.minSizeCm) * sizeFactor) * 10) / 10;
    const sizeRatio = clamp01((sizeCm - fish.minSizeCm) / Math.max(1, fish.maxSizeCm - fish.minSizeCm));
    const qualityRoll = this.ctx.probability.roll('fishing.results');
    const env = environmentOf(this.ctx);
    const weatherBonus = env.weather === 'clear' ? 0.05 : env.weather === 'storm' ? -0.08 : 0;
    const quality = qualityFromScore(
      0.12 + levelFactor * 0.35 + (rodTier / 3) * 0.2 + sizeRatio * 0.18 + qualityRoll * 0.15 + weatherBonus
    );
    addItemToInventory(this.ctx.state.player.inventory, itemId, 1, {
      quality: itemDef?.hasQuality === false ? 1 : quality,
      freshness: 1,
      simTime: now,
      maxStack: itemDef?.maxStack ?? 99,
      meta: { sizeCm, fishId: fish.id },
    });
    const fishing = this.ctx.state.fishing;
    fishing.catches += 1;
    fishing.bySpecies[fish.id] = (fishing.bySpecies[fish.id] ?? 0) + 1;
    fishing.biggestBySpecies[fish.id] = Math.max(fishing.biggestBySpecies[fish.id] ?? 0, sizeCm);
    const stats = this.ctx.state.player.statistics;
    stats.fishCaught += 1;
    stats.fishSpeciesCaught[fish.id] = (stats.fishSpeciesCaught[fish.id] ?? 0) + 1;
    stats.fishBiggest[fish.id] = Math.max(stats.fishBiggest[fish.id] ?? 0, sizeCm);
    this.ctx.bus.emit('fish:caught', { fishId: fish.id, sizeCm, quality });
    this.ctx.bus.emit('item:acquired', { itemId, quantity: 1, quality, source: 'fishing' });
    this.grantXp('fishing', SKILL_ACTIVITY_XP.fishing * (1 + fish.difficulty * 0.25), 'catch');
    const lastResult = 'You land a ' + sizeCm + 'cm ' + fish.name + '!';
    fishing.lastResultMessage = lastResult;
    session.fishSizeCm = sizeCm;
    this.ctx.state.fishing.session = null;
    this.holding = false;
    this.minigameAccumulator = 0;
  }

  private finishSession(message: string): void {
    this.ctx.state.fishing.session = null;
    this.ctx.state.fishing.lastResultMessage = message;
    this.holding = false;
    this.minigameAccumulator = 0;
  }

  private isPlayerAt(locationId: string): boolean {
    const world = this.ctx.registry.get<IWorldSystem>('world');
    if (world) return world.getCurrentLocationId() === locationId;
    return this.ctx.state.player.position.locationId === locationId;
  }

  private getSkillLevel(skill: SkillId): number {
    return this.ctx.registry.getRequired<ISkillSystem>('skill').getLevel(skill);
  }

  private grantXp(skill: SkillId, amount: number, source: string): void {
    this.ctx.registry.getRequired<ISkillSystem>('skill').addXp(skill, amount, 'fishing:' + source);
  }
}

function environmentOf(ctx: IGameContext): { season: Season; weather: WeatherType; hour: number } {
  const environment = ctx.state.world.environment;
  return { season: environment.season, weather: environment.weather, hour: ctx.clock.time.hour };
}

function weatherWaitMultiplier(weather: WeatherType): number {
  switch (weather) {
    case 'rain':
      return 0.9;
    case 'storm':
      return 1.3;
    case 'fog':
      return 1.1;
    case 'wind':
      return 0.95;
    case 'snow':
      return 1.25;
    case 'clear':
      return 0.95;
    default:
      return 1;
  }
}