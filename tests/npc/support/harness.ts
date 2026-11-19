// =============================================================================
// Test harness for the NPC autonomous-life module.
//
// Builds a deterministic, headless game context around the REAL ProbabilityEngine
// and the REAL static NPC content, with a synthetic-but-valid world content pack
// so the NPC module can be tested without depending on other agents' unfinished
// data modules. Every canonical location id is created as a valid LocationDef,
// and every referenced dialogue tree id exists.
// =============================================================================
import { EventBus } from '../../../src/core/EventBus';
import { Clock } from '../../../src/core/Clock';
import { SystemRegistry } from '../../../src/core/SystemRegistry';
import { RngFacade, createGameContext } from '../../../src/core/GameContext';
import { MemoryLogger } from '../../../src/core/GameLogger';
import { ContentRegistry } from '../../../src/core/ContentRegistry';
import { DEFAULT_APPEARANCE, createInitialGameState } from '../../../src/core/WorldFactory';
import type { GameState, IGameContext, NPCState } from '../../../src/core/contracts';
import type { ContentPack, DialogueTree, LocationDef } from '../../../src/data/schema';
import type { GameTime, LocationId, NPCId } from '../../../src/core/SharedTypes';
import { createProbabilityEngine, type ProbabilityEngine } from '../../../src/probability';
import { NPCSystem } from '../../../src/npc/NPCSystem';
import { SIM_SECONDS_PER_GAME_DAY, SIM_SECONDS_PER_GAME_HOUR } from '../../../src/npc/NPC';
import { NPCS } from '../../../src/data/npcs/npcs';
import {
  ALL_EXTERIOR_LOCATION_IDS,
  interiorIdFor,
  regionOfLocation,
} from '../../../src/data/locations/ids';

function createTestLocation(id: LocationId, indoor: boolean, entranceFrom?: LocationId): LocationDef {
  const definition: LocationDef = {
    id,
    name: id,
    regionId: regionOfLocation(id),
    kind: indoor ? 'interior' : 'town_center',
    description: 'Synthetic test location for ' + id,
    indoor,
    mapX: 0,
    mapY: 0,
    widthTiles: 20,
    heightTiles: 20,
    connections: entranceFrom ? [entranceFrom] : [],
    shelter: indoor ? 1 : 0.4,
    windExposure: indoor ? 0 : 0.3,
    humidityModifier: 0,
    heatSource: indoor,
    openHour: 6,
    closeHour: 23,
    facilities: [],
    eventTags: [],
    forageTags: [],
    discoverable: true,
    secret: false,
    theme: indoor ? 'indoor' : 'town',
    visual: { shape: 'rect', color: '#cccccc' },
    floorColor: '#dddddd',
    accentColor: '#888888',
  };
  if (entranceFrom) definition.entranceFrom = entranceFrom;
  return definition;
}

/** Valid content pack: all canonical locations + the real NPC defs. */
export function createTestContentPack(): ContentPack {
  const locations: LocationDef[] = [];
  for (const exterior of ALL_EXTERIOR_LOCATION_IDS) {
    locations.push(createTestLocation(exterior, false));
  }
  for (const exterior of ALL_EXTERIOR_LOCATION_IDS) {
    locations.push(createTestLocation(interiorIdFor(exterior), true, exterior));
  }
  const dialogueIds = new Set<string>(NPCS.map((npc) => npc.dialogueTreeId));
  const dialogueTrees: DialogueTree[] = [...dialogueIds]
    .sort()
    .map((id) => ({ id, rootNodeId: 'root', nodes: { root: { id: 'root', text: 'Hello there.' } } }));
  return {
    items: [],
    crops: [],
    fish: [],
    forageNodes: [],
    recipes: [],
    events: [],
    festivals: [],
    locations,
    trainRoutes: [],
    businesses: [],
    npcs: NPCS,
    dialogueTrees,
    furniture: [],
    blueprints: [],
    achievements: [],
    playerGoals: [],
    communityProposals: [],
    collectionCategories: [],
    weatherTable: { bySeason: { spring: {}, summer: {}, autumn: {}, winter: {} } },
  };
}

export interface NpcHarness {
  state: GameState;
  content: ContentRegistry;
  ctx: IGameContext;
  system: NPCSystem;
  clock: Clock;
  bus: EventBus;
  probability: ProbabilityEngine;
  registry: SystemRegistry;
  logger: MemoryLogger;
  /** Advances the clock and runs only the NPC system, in fixed steps. */
  advanceSimSeconds(totalSeconds: number, stepSeconds?: number): void;
  advanceGameHours(hours: number, stepHours?: number): void;
  advanceGameDays(days: number, stepHours?: number): void;
  advanceGameMinutes(minutes: number, stepMinutes?: number): void;
  npc(id: NPCId): NPCState;
  majorNpcs(): NPCState[];
  time(): GameTime;
}

export interface NpcHarnessOptions {
  seed?: number;
}

export function createNpcHarness(options: NpcHarnessOptions = {}): NpcHarness {
  const seed = options.seed ?? 20241119;
  const content = new ContentRegistry(createTestContentPack());
  const state = createInitialGameState({
    seed,
    playerName: 'Ash',
    appearance: DEFAULT_APPEARANCE,
    content,
  });
  const probability = createProbabilityEngine(seed, state.probability);
  const bus = new EventBus();
  const clock = new Clock(state.clock);
  const registry = new SystemRegistry(bus);
  const rng = new RngFacade(probability);
  const logger = new MemoryLogger();
  const ctx = createGameContext({ state, content, probability, bus, clock, registry, rng, logger });
  const system = new NPCSystem();
  registry.register(system);
  registry.initAll(ctx);

  const syncClock = (): void => {
    state.clock = clock.serialize();
  };

  const advanceSimSeconds = (totalSeconds: number, stepSeconds?: number): void => {
    const safeTotal = Math.max(0, totalSeconds);
    const safeStep = stepSeconds && stepSeconds > 0 ? stepSeconds : safeTotal;
    let remaining = safeTotal;
    if (remaining === 0) {
      system.update(0);
      return;
    }
    while (remaining > 1e-9) {
      const step = Math.min(safeStep, remaining);
      clock.advanceSimSeconds(step);
      syncClock();
      system.update(step);
      remaining -= step;
    }
    syncClock();
  };

  return {
    state,
    content,
    ctx,
    system,
    clock,
    bus,
    probability,
    registry,
    logger,
    advanceSimSeconds,
    advanceGameHours: (hours: number, stepHours = 1) =>
      advanceSimSeconds(hours * SIM_SECONDS_PER_GAME_HOUR, stepHours * SIM_SECONDS_PER_GAME_HOUR),
    advanceGameDays: (days: number, stepHours = 1) =>
      advanceSimSeconds(days * SIM_SECONDS_PER_GAME_DAY, stepHours * SIM_SECONDS_PER_GAME_HOUR),
    advanceGameMinutes: (minutes: number, stepMinutes = minutes) =>
      advanceSimSeconds(minutes * (SIM_SECONDS_PER_GAME_HOUR / 60), stepMinutes * (SIM_SECONDS_PER_GAME_HOUR / 60)),
    npc: (id: NPCId) => {
      const npc = state.npcs[id];
      if (!npc) throw new Error('Unknown NPC in test harness: ' + id);
      return npc;
    },
    majorNpcs: () => Object.values(state.npcs).filter((npc) => npc.isMajor),
    time: () => clock.time,
  };
}

/** JSON snapshot of the NPC-owned state used for determinism assertions. */
export function npcStateSnapshot(state: GameState): string {
  return JSON.stringify({ npcs: state.npcs, social: state.social });
}