import type {
  ActionResult,
  GameEventMap,
  GameEventTopic,
  GameSpeed,
  GameState,
  IGameContext,
  ISkillSystem,
  NPCState,
  RelationshipState,
  SkillProgressState,
} from '../../../src/core/contracts';
import type { LocationId, NPCId, QualityStars, Season, SkillId, WeatherType } from '../../../src/core/SharedTypes';
import { SKILL_IDS } from '../../../src/core/SharedTypes';
import { Clock } from '../../../src/core/Clock';
import { EventBus } from '../../../src/core/EventBus';
import { SystemRegistry } from '../../../src/core/SystemRegistry';
import { MemoryLogger } from '../../../src/core/GameLogger';
import { ContentRegistry } from '../../../src/core/ContentRegistry';
import { RngFacade, createGameContext } from '../../../src/core/GameContext';
import { createInitialGameState, DEFAULT_APPEARANCE } from '../../../src/core/WorldFactory';
import { createRelationship, refreshRelationshipStatus } from '../../../src/core/RelationshipUtil';
import { addItemToInventory, findEntry } from '../../../src/core/InventoryUtil';
import { gameTimeToSimSeconds } from '../../../src/core/TimeUtil';
import { WORLD_CONFIG } from '../../../src/core/WorldConfig';
import { createProbabilityEngine } from '../../../src/probability';
import { SocialSystem } from '../../../src/social/SocialSystem';
import { DialogueSystem } from '../../../src/social/DialogueSystem';
import { LOC } from '../../../src/data/locations/ids';
import { buildFixtureContentPack } from './fixtureContent';

/** Minimal skill-system double so social XP awards are observable in tests. */
class TestSkillSystem implements ISkillSystem {
  readonly id = 'skill';
  private ctx: IGameContext | null = null;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
  }

  update(): void {
    // no-op
  }

  addXp(skill: SkillId, amount: number, _source: string): void {
    const state = this.ctx?.state;
    if (!state) return;
    const progress = state.player.skills[skill];
    progress.xp += amount;
    progress.totalXp += amount;
    progress.uses += 1;
    while (progress.level < WORLD_CONFIG.skill.maxLevel && progress.xp >= progress.xpToNext) {
      progress.xp -= progress.xpToNext;
      progress.level += 1;
      progress.xpToNext = Math.round(progress.xpToNext * WORLD_CONFIG.skill.xpGrowth);
    }
  }

  getProgress(skill: SkillId): SkillProgressState {
    const state = this.ctx?.state;
    return state ? state.player.skills[skill] : { level: 1, xp: 0, xpToNext: 60, totalXp: 0, uses: 0 };
  }

  getLevel(skill: SkillId): number {
    return this.getProgress(skill).level;
  }

  canUse(skill: SkillId, level: number): boolean {
    return this.getLevel(skill) >= level;
  }
}

export interface CapturedEvent {
  topic: string;
  payload: unknown;
}

export interface SocialHarness {
  state: GameState;
  ctx: IGameContext;
  content: ContentRegistry;
  probability: ReturnType<typeof createProbabilityEngine>;
  clock: Clock;
  bus: EventBus;
  registry: SystemRegistry;
  logger: MemoryLogger;
  social: SocialSystem;
  dialogue: DialogueSystem;
  skill: TestSkillSystem;
  events: CapturedEvent[];
  /** Copies of state.* slices are not needed; tests read the live state object. */
}

export interface HarnessOptions {
  seed?: number;
  playerLocation?: LocationId;
  playerMoney?: number;
  weather?: WeatherType;
  season?: Season;
  hour?: number;
  dayOfSeason?: number;
}

const CAPTURED_TOPICS: readonly GameEventTopic[] = [
  'npc:met',
  'relationship:changed',
  'money:changed',
  'item:acquired',
  'item:lost',
  'game:signal',
  'community:proposal',
  'npc:activity',
  'goal:completed',
  'letter:received',
];

/** Builds a fully wired headless social environment (real probability engine). */
export function createSocialHarness(options: HarnessOptions = {}): SocialHarness {
  const seed = options.seed ?? 424242;
  const content = new ContentRegistry(buildFixtureContentPack());
  const validation = content.validate();
  if (validation.length > 0) {
    throw new Error('Fixture content pack is invalid: ' + validation.join('; '));
  }
  const state = createInitialGameState({
    seed,
    playerName: 'Ash',
    appearance: DEFAULT_APPEARANCE,
    content,
  });
  const playerLocation = options.playerLocation ?? LOC.park;
  state.player.position.locationId = playerLocation;
  state.player.position.regionId = content.getLocation(playerLocation)?.regionId ?? 'willowbrook';
  state.player.money = options.playerMoney ?? WORLD_CONFIG.economyStarting.playerMoneyPence;
  state.world.environment.weather = options.weather ?? 'clear';
  state.world.environment.season = options.season ?? 'spring';
  state.world.environment.seasonIndex = Math.max(0, ['spring', 'summer', 'autumn', 'winter'].indexOf(state.world.environment.season));
  const simSeconds = gameTimeToSimSeconds({
    year: 1,
    seasonIndex: state.world.environment.seasonIndex,
    dayOfSeason: options.dayOfSeason ?? 1,
    hour: options.hour ?? 10,
    minute: 0,
  });
  state.clock.simTimeSeconds = simSeconds;

  const clock = new Clock(state.clock);
  const bus = new EventBus();
  const registry = new SystemRegistry(bus);
  const probability = createProbabilityEngine(seed);
  const logger = new MemoryLogger();
  const rng = new RngFacade(probability);
  const ctx = createGameContext({ state, content, probability, bus, clock, registry, rng, logger });

  const events: CapturedEvent[] = [];
  const capture = <K extends GameEventTopic>(topic: K): void => {
    bus.on(topic, (payload: GameEventMap[K]) => {
      events.push({ topic, payload });
    });
  };
  for (const topic of CAPTURED_TOPICS) capture(topic);

  const social = new SocialSystem();
  const dialogue = new DialogueSystem();
  const skill = new TestSkillSystem();
  registry.register(social);
  registry.register(dialogue);
  registry.register(skill);
  registry.initAll(ctx);

  return { state, content, probability, clock, bus, registry, logger, social, dialogue, skill, events, ctx };
}

/** Returns a live NPC state or throws (keeps strict test code free of optional chaining). */
export function requireNpc(harness: SocialHarness, npcId: NPCId): NPCState {
  const npc = harness.state.npcs[npcId];
  if (!npc) throw new Error('NPC missing from fixture: ' + npcId);
  return npc;
}

/** Places an NPC at (or next to) the player's current location. */
export function placeAtPlayer(harness: SocialHarness, npcId: NPCId, locationId?: LocationId): NPCState {
  const npc = harness.state.npcs[npcId];
  if (!npc) throw new Error('Unknown NPC in fixture: ' + npcId);
  npc.locationId = locationId ?? harness.state.player.position.locationId;
  return npc;
}

/** Places every fixture major NPC at the player's location. */
export function placeAllMajorsAtPlayer(harness: SocialHarness): void {
  for (const npcId of Object.keys(harness.state.npcs)) {
    const npc = harness.state.npcs[npcId];
    if (npc && npc.isMajor) npc.locationId = harness.state.player.position.locationId;
  }
}

/** Writes a relationship from scratch (bypassing the social slow-burn) for setup. */
export function setRelationship(
  harness: SocialHarness,
  npcId: NPCId,
  values: {
    affinity: number;
    trust?: number;
    intimacy?: number;
    familiarity?: number;
    status?: RelationshipState['status'];
    interactionCount?: number;
    lastInteractionAt?: number;
  }
): RelationshipState {
  const now = harness.clock.simTimeSeconds;
  const rel = createRelationship(npcId, now, values.status ?? 'stranger');
  rel.affinity = values.affinity;
  rel.trust = values.trust ?? 0;
  rel.intimacy = values.intimacy ?? 0;
  rel.familiarity = values.familiarity ?? 0;
  rel.status = values.status ?? 'acquaintance';
  rel.interactionCount = values.interactionCount ?? 1;
  rel.lastInteractionAt = values.lastInteractionAt ?? now;
  refreshRelationshipStatus(rel);
  if (values.status) rel.status = values.status;
  harness.state.player.relationships[npcId] = rel;
  harness.state.flags['met:' + npcId] = true;
  return rel;
}

/** Adds an item instance to the player's inventory and returns its instance id. */
export function givePlayerItem(
  harness: SocialHarness,
  itemId: string,
  quantity = 1,
  quality: QualityStars = 3
): string {
  const before = harness.state.player.inventory.length;
  addItemToInventory(harness.state.player.inventory, itemId, quantity, {
    quality,
    simTime: harness.clock.simTimeSeconds,
    maxStack: 99,
  });
  const added = harness.state.player.inventory[before];
  if (!added) throw new Error('Failed to add fixture item ' + itemId);
  return added.instanceId;
}

/** Returns an inventory instance by item id (for gift tests). */
export function findPlayerItem(harness: SocialHarness, itemId: string): string | undefined {
  return harness.state.player.inventory.find((entry) => entry.itemId === itemId)?.instanceId;
}

/** Sets weather and season on the environment slice. */
export function setEnvironment(
  harness: SocialHarness,
  patch: { weather?: WeatherType; season?: Season }
): void {
  const env = harness.state.world.environment;
  if (patch.weather) env.weather = patch.weather;
  if (patch.season) {
    env.season = patch.season;
    env.seasonIndex = Math.max(0, ['spring', 'summer', 'autumn', 'winter'].indexOf(patch.season));
  }
}

/** Sets the simulated clock to a specific season day + hour. */
export function setClockTime(harness: SocialHarness, time: { dayOfSeason?: number; hour?: number; minute?: number }): void {
  const env = harness.state.world.environment;
  const seconds = gameTimeToSimSeconds({
    year: 1,
    seasonIndex: env.seasonIndex,
    dayOfSeason: time.dayOfSeason ?? env.dayOfSeason,
    hour: time.hour ?? harness.clock.time.hour,
    minute: time.minute ?? harness.clock.time.minute,
  });
  harness.clock.setSimTimeSeconds(seconds);
}

/** Advances the clock and runs a full system update tick. */
export function advance(harness: SocialHarness, simSeconds: number): void {
  harness.clock.advanceSimSeconds(simSeconds);
  harness.registry.updateAll(simSeconds);
}

/** Advances the clock by game hours (1 game hour = 60 sim seconds). */
export function advanceHours(harness: SocialHarness, hours: number): void {
  advance(harness, hours * 60);
}

/** Advances the clock by game days. */
export function advanceDays(harness: SocialHarness, days: number): void {
  advance(harness, days * 24 * 60);
}

/** Filters captured events by topic. */
export function eventsOf(harness: SocialHarness, topic: string): unknown[] {
  return harness.events.filter((entry) => entry.topic === topic).map((entry) => entry.payload);
}

/** Clears captured events (start of assertion block). */
export function clearEvents(harness: SocialHarness): void {
  harness.events.length = 0;
}

/** Enables/disables a world flag. */
export function setFlag(harness: SocialHarness, flag: string, value = true): void {
  harness.state.flags[flag] = value;
}

/** Sets the current clock hour and returns the resulting simulation time. */
export function currentHour(harness: SocialHarness): number {
  return harness.clock.time.hour;
}

/** Deep snapshot used for determinism comparisons (sim-time based, no wall clock). */
export function socialSnapshot(harness: SocialHarness): string {
  return JSON.stringify({
    relationships: harness.state.player.relationships,
    social: harness.state.social,
    memories: Object.fromEntries(
      Object.entries(harness.state.npcs).map(([npcId, npc]) => [npcId, npc.memories])
    ),
    flags: harness.state.flags,
    money: harness.state.player.money,
    statistics: harness.state.player.statistics,
    history: harness.state.world.history,
  });
}

/** Asserts that an action result is ok (throws a readable error otherwise). */
export function expectOk(result: ActionResult): ActionResult {
  if (!result.ok) throw new Error('Expected action to succeed, got: ' + result.code + ' - ' + result.message);
  return result;
}

/** Convenience: all skill ids are present in a fresh player. */
export const ALL_SKILL_IDS = SKILL_IDS;

/** Reads the player's social skill progress. */
export function socialXp(harness: SocialHarness): number {
  return harness.state.player.skills.social.totalXp;
}

/** Sets a fast game speed for Clock-based tests that accidentally use it. */
export function setSpeed(harness: SocialHarness, speed: GameSpeed): void {
  harness.clock.setSpeed(speed);
}

/** Reads an inventory entry (throws when missing) - used to assert consumption. */
export function requireItemEntry(harness: SocialHarness, instanceId: string): NonNullable<ReturnType<typeof findEntry>> {
  const entry = findEntry(harness.state.player.inventory, instanceId);
  if (!entry) throw new Error('Inventory entry not found: ' + instanceId);
  return entry;
}
