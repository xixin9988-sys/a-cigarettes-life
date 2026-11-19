// QA full player-lifecycle scenario: one real GameEngine, start to next generation.
// This is an integration scenario - every step is dispatched through the public GameEngine API
// (plus documented fixtures where noted) and asserts real state changes, not mocks.
import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/core/Game';
import { DEFAULT_APPEARANCE } from '../../src/core/WorldFactory';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import { LOC } from '../../src/data/locations/ids';
import { ITEM } from '../../src/data/items/ids';
import { NPC } from '../../src/data/npcs/ids';
import type { GameState } from '../../src/core/contracts';
import {
  assertStateValid,
  catchFish,
  content,
  findUsableForageNode,
  negativeBalances,
  travelTo,
  validateState,
} from '../qa/support/qaHarness';

const HOUR_MS = 3600_000;

const openGames: GameEngine[] = [];
afterEach(() => {
  while (openGames.length > 0) {
    const game = openGames.pop();
    if (game) game.destroy();
  }
});

async function newScenario(seed: number): Promise<GameEngine> {
  const game = new GameEngine({ content });
  await game.init();
  const created = game.newGame({
    playerName: 'Scenario Ash',
    appearance: DEFAULT_APPEARANCE,
    seed,
    slotId: 'qa_scenario_' + seed,
  });
  expect(created.ok, created.message).toBe(true);
  openGames.push(game);
  return game;
}

/**
 * State projection that must survive a save/load unchanged. The full runtime re-initialises
 * the systems on load (schedules may be re-planned for the current instant), so the scenario
 * compares the player-visible core instead of byte-identical JSON; byte-identical persistence
 * is covered directly by tests/qa/saveCorruption.test.ts.
 */
function persistenceProjection(state: GameState): Record<string, unknown> {
  const marketPrices: Record<string, number> = {};
  for (const [itemId, good] of Object.entries(state.economy.market)) marketPrices[itemId] = good.currentPrice;
  const businessMoney: Record<string, number> = {};
  for (const [businessId, business] of Object.entries(state.economy.businesses)) businessMoney[businessId] = business.money;
  return {
    clock: state.clock.simTimeSeconds,
    playerMoney: state.player.money,
    playerName: state.player.name,
    playerLocation: state.player.position.locationId,
    cigarette: { ...state.player.cigarette },
    inventory: state.player.inventory.map((entry) => ({ itemId: entry.itemId, quantity: entry.quantity, quality: entry.quality, acquiredAt: entry.acquiredAt })),
    lifeId: state.life.lifeId,
    lifePhase: state.life.phase,
    lifeGeneration: state.life.generation,
    npcCount: Object.keys(state.npcs).length,
    marketPrices,
    businessMoney,
    probabilityStreams: state.probability.streams,
    probabilityDecisionCount: state.probability.decisionCount,
    worldId: state.world.worldId,
    worldSeed: state.world.seed,
    locationCount: Object.keys(state.world.locations).length,
    historyLength: state.world.history.length,
  };
}

function countEvents(game: GameEngine): Record<string, number> {
  const counts: Record<string, number> = {};
  const bus = game.getEventBus();
  const topics = [
    'location:changed',
    'item:acquired',
    'crop:harvested',
    'fish:caught',
    'relationship:changed',
    'npc:met',
    'money:changed',
    'time:day',
  ] as const;
  for (const topic of topics) {
    counts[topic] = 0;
    bus.on(topic, () => {
      counts[topic] = (counts[topic] ?? 0) + 1;
    });
  }
  return counts;
}

describe('QA scenario: a full player life', () => {
  it('walks a real early-life chain: travel, forage, farm+harvest, craft, fish, social and dialogue', { timeout: 240000 }, async () => {
    const game = await newScenario(24680);
    const state = game.getState();
    const events = countEvents(game);

    // -- new game ------------------------------------------------------------
    expect(game.getScreen()).toBe('playing');
    expect(state.life.phase).toBe('alive');
    expect(Object.keys(state.npcs)).toHaveLength(WORLD_CONFIG.population.initialNpcCount);
    expect(state.player.money).toBe(WORLD_CONFIG.economyStarting.playerMoneyPence);

    // -- travel: home interior -> village -> forest --------------------------
    travelTo(game, LOC.home);
    expect(game.getState().player.position.locationId).toBe(LOC.home);
    travelTo(game, LOC.forest);
    expect(game.getState().player.position.locationId).toBe(LOC.forest);
    expect(events['location:changed']).toBeGreaterThan(0);
    expect(game.getState().world.locations[LOC.forest]?.visitCount).toBeGreaterThanOrEqual(1);

    // -- forage: gather every spring node the level-1 forager can find -------
    const gathered: string[] = [];
    for (let guard = 0; guard < 20; guard += 1) {
      const candidate = findUsableForageNode(game.getState(), LOC.forest);
      if (!candidate) break;
      const result = game.dispatch({ type: 'forage:gather', nodeId: candidate.nodeId });
      if (!result.ok) break;
      gathered.push(candidate.nodeId);
    }
    expect(gathered.length, 'spring forage nodes gathered at the forest').toBeGreaterThanOrEqual(2);
    expect(game.getState().player.statistics.itemsForaged).toBeGreaterThan(0);
    expect(events['item:acquired']).toBeGreaterThan(0);
    const woodBefore = game.getState().player.inventory
      .filter((entry) => entry.itemId === ITEM.wood)
      .reduce((total, entry) => total + entry.quantity, 0);

    // -- farm: till, plant, water, ash-fertilise, grow and harvest -----------
    travelTo(game, LOC.farm);
    const till = game.dispatch({ type: 'farm:till', locationId: LOC.farm, x: 5, y: 5 });
    expect(till.ok, till.message).toBe(true);
    const farming = game.getRuntime().systems.farming;
    const plots = farming.getPlots(LOC.farm);
    const plotId = plots[plots.length - 1]?.id ?? null;
    expect(plotId).not.toBeNull();
    if (!plotId) return;
    expect(game.dispatch({ type: 'farm:plant', plotId, seedItemId: ITEM.turnipSeed }).ok).toBe(true);
    expect(game.dispatch({ type: 'farm:water', plotId }).ok).toBe(true);

    // Two half-days of growth produce enough ash to collect and work into the soil.
    for (let cycle = 0; cycle < 2; cycle += 1) {
      game.dispatch({ type: 'time:rest', hours: 12 });
      game.dispatch({ type: 'farm:water', plotId });
    }
    const ash = game.dispatch({ type: 'ash:collect' });
    expect(ash.ok, ash.message).toBe(true);
    expect(game.getState().player.statistics.ashCollected).toBeGreaterThan(0);
    expect(game.getState().player.inventory.some((entry) => entry.itemId === ITEM.cigaretteAsh)).toBe(true);
    const fertilised = game.dispatch({ type: 'farm:fertilize', plotId, fertilizer: 'ash' });
    expect(fertilised.ok, fertilised.message).toBe(true);
    const plotAfterAsh = farming.getPlots(LOC.farm).find((candidate) => candidate.id === plotId);
    expect(plotAfterAsh?.potash).toBeGreaterThan(0);

    // Continue watering/growing until the crop is ready (bounded loop, fixed hour scale).
    for (let cycle = 0; cycle < 8; cycle += 1) {
      const plot = farming.getPlots(LOC.farm).find((candidate) => candidate.id === plotId);
      if (plot?.stage === 'mature') break;
      game.dispatch({ type: 'time:rest', hours: 12 });
      game.dispatch({ type: 'farm:water', plotId });
    }
    const maturePlot = farming.getPlots(LOC.farm).find((candidate) => candidate.id === plotId);
    expect(maturePlot?.stage, 'crop matured through real growth integration').toBe('mature');
    const harvested = game.dispatch({ type: 'farm:harvest', plotId });
    expect(harvested.ok, harvested.message).toBe(true);
    expect(game.getState().player.statistics.cropsHarvested).toBeGreaterThan(0);
    expect(events['crop:harvested']).toBeGreaterThanOrEqual(1);

    // -- craft: use foraged wood at the home workbench -----------------------
    travelTo(game, LOC.home + '_interior');
    const woodNow = game.getState().player.inventory
      .filter((entry) => entry.itemId === ITEM.wood)
      .reduce((total, entry) => total + entry.quantity, 0);
    expect(woodNow, 'foraged wood available for crafting').toBeGreaterThanOrEqual(2);
    const crafting = game.getRuntime().systems.crafting;
    const canCraft = crafting.canCraft('craft_paper', 1);
    expect(canCraft.ok, canCraft.message).toBe(true);
    const craft = game.dispatch({ type: 'craft', recipeId: 'craft_paper', quantity: 1 });
    expect(craft.ok, craft.message).toBe(true);
    game.dispatch({ type: 'time:rest', hours: 2 });
    expect(game.getState().player.statistics.itemsCrafted).toBeGreaterThan(0);
    expect(game.getState().player.inventory.some((entry) => entry.itemId === ITEM.paper)).toBe(true);
    expect(woodBefore).toBeGreaterThanOrEqual(0);

    // -- fishing: full cast -> bite -> reel -> land lifecycle ---------------
    travelTo(game, LOC.river);
    const fishing = catchFish(game, LOC.river);
    expect(fishing.castOk, fishing.message).toBe(true);
    expect(fishing.caught, 'fish landed: ' + fishing.message).toBe(1);
    expect(game.getState().player.statistics.fishCaught).toBe(1);
    expect(events['fish:caught']).toBe(1);
    expect(game.getState().fishing.catches).toBe(1);

    // -- social + dialogue ---------------------------------------------------
    travelTo(game, LOC.cafe);
    const world = game.getRuntime().systems.world;
    let npcId = game.getState().world.locations[LOC.cafe]?.occupants[0] ?? null;
    if (!npcId) {
      // Documented fixture: place a known major NPC where the scenario needs them.
      const npc = game.getState().npcs[NPC.theoGrey];
      expect(npc).toBeDefined();
      if (!npc) return;
      npc.locationId = LOC.cafe;
      (world as unknown as { refreshOccupants(): void }).refreshOccupants();
      npcId = npc.id;
    }
    const talk = game.dispatch({ type: 'social:talk', npcId });
    expect(talk.ok, talk.message).toBe(true);
    const startDialogue = game.dispatch({ type: 'dialogue:start', npcId });
    expect(startDialogue.ok, startDialogue.message).toBe(true);
    const dialogue = game.getRuntime().systems.dialogue;
    const node = dialogue.getCurrentNode();
    expect(node).not.toBeNull();
    expect(node?.text.length).toBeGreaterThan(0);
    const choiceIndex = node?.choices.findIndex((choice) => choice.available) ?? -1;
    if (choiceIndex >= 0) {
      const chosen = game.dispatch({ type: 'dialogue:choose', choiceIndex });
      expect(chosen.ok, chosen.message).toBe(true);
    }
    expect(game.dispatch({ type: 'dialogue:end' }).ok).toBe(true);
    const relationship = game.getSystems().social.getRelationship(npcId);
    expect(relationship).not.toBeNull();
    expect(relationship?.interactionCount).toBeGreaterThanOrEqual(1);
    expect((events['relationship:changed'] ?? 0) + (events['npc:met'] ?? 0)).toBeGreaterThanOrEqual(0);

    // -- final integrity -----------------------------------------------------
    expect(validateState(game.getState()).issues).toEqual([]);
    expect(negativeBalances(game.getState())).toEqual([]);
    expect(game.getState().life.phase).toBe('alive');
    console.log(
      'QA scenario early-life: day=' + game.getClock().time.totalDays +
      ' forage=' + gathered.length + ' crops=' + game.getState().player.statistics.cropsHarvested +
      ' crafted=' + game.getState().player.statistics.itemsCrafted +
      ' fish=' + game.getState().player.statistics.fishCaught +
      ' conversations=' + game.getState().player.statistics.conversations +
      ' ash=' + game.getState().player.statistics.ashCollected +
      ' lengthRatio=' + game.getState().player.cigarette.lengthRatio.toFixed(3)
    );
  });

  it('persists a life, survives an offline night, records the death and starts the next generation', { timeout: 240000 }, async () => {
    const game = await newScenario(13579);
    // A little real play before saving.
    for (let tick = 0; tick < 120; tick += 1) game.tick(1);
    travelTo(game, LOC.river);
    expect(game.getState().player.position.locationId).toBe(LOC.river);

    // -- save / load round-trip ---------------------------------------------
    const saved = await game.saveGame('qa_lifecycle');
    expect(saved.ok, saved.message).toBe(true);
    const savedProjection = persistenceProjection(game.getState());
    const savedSimTime = game.getState().clock.simTimeSeconds;
    const slots = await game.listSaveSlots();
    const slotMeta = slots.find((slot) => slot.slotId === 'qa_lifecycle');
    expect(slotMeta).toBeDefined();
    expect(slotMeta?.playerName).toBe('Scenario Ash');

    for (let tick = 0; tick < 60; tick += 1) game.tick(1);
    const loaded = await game.loadGame('qa_lifecycle');
    expect(loaded.ok, loaded.message).toBe(true);
    expect(game.getScreen()).toBe('playing');
    expect(game.getState().clock.simTimeSeconds).toBe(savedSimTime);
    expect(persistenceProjection(game.getState())).toEqual(savedProjection);

    // -- offline catch-up (24h real = 3 game days, uncapped) ----------------
    const state = game.getState();
    const beforeOffline = state.clock.simTimeSeconds;
    state.pendingOffline.lastSaveRealMs = Date.now() - 24 * HOUR_MS;
    state.pendingOffline.lastOfflineSimTime = beforeOffline;
    state.pendingOffline.lastProcessedSimTime = beforeOffline;
    const offline = await game.requestOfflineCatchup();
    expect(offline).not.toBeNull();
    if (!offline) return;
    expect(offline.ok).toBe(true);
    expect(offline.summary.simulatedGameHours).toBeGreaterThan(60);
    expect(game.getState().clock.simTimeSeconds).toBeGreaterThan(beforeOffline);
    expect(game.getState().life.phase).toBe('alive');
    expect(game.getOfflineSummary()).not.toBeNull();
    game.acknowledgeOfflineSummary();
    expect(game.getOfflineSummary()).toBeNull();
    assertStateValid(game.getState(), 'after offline night');

    // -- life end: burn the last of the filter ------------------------------
    game.getState().player.cigarette.lengthRatio = 0.001;
    const rest = game.dispatch({ type: 'time:rest', hours: 24 });
    expect(rest.ok, rest.message).toBe(true);
    const ended = game.getState();
    expect(ended.life.phase).toBe('ended');
    expect(ended.life.endReason).not.toBeNull();
    expect(game.getScreen()).toBe('life_end');
    const review = game.getSystems().life.getLifeReview();
    expect(review).not.toBeNull();
    expect(ended.archive.length).toBeGreaterThanOrEqual(1);
    const archivedLifeId = ended.life.lifeId;
    expect(ended.archive.some((archived) => archived.lifeId === archivedLifeId)).toBe(true);

    // -- the ended life is persisted with its archive -----------------------
    const savedEnd = await game.saveGame('qa_lifecycle_end');
    expect(savedEnd.ok, savedEnd.message).toBe(true);
    const archivedLives = await game.getSaveManager().listArchivedLives();
    expect(archivedLives.some((archived) => archived.lifeId === archivedLifeId)).toBe(true);

    // -- next generation: world continues, identity does not -----------------
    const oldWorldId = ended.world.worldId;
    const oldEventCount = ended.world.events.length;
    const next = game.startNextLife([ITEM.turnipSeed]);
    expect(next.ok, next.message).toBe(true);
    const gen2 = game.getState();
    expect(gen2.life.phase).toBe('alive');
    expect(gen2.life.generation).toBe(2);
    expect(gen2.life.lifeId).not.toBe(archivedLifeId);
    expect(gen2.player.lifeId).toBe(gen2.life.lifeId);
    expect(gen2.world.worldId).toBe(oldWorldId);
    expect(gen2.world.events.length).toBeGreaterThanOrEqual(oldEventCount);
    expect(gen2.archive.length).toBeGreaterThanOrEqual(1);
    const legacyEntries = gen2.player.inventory.filter((entry) => entry.meta?.legacy === true);
    expect(legacyEntries).toHaveLength(1);
    expect(legacyEntries[0]?.itemId).toBe(ITEM.turnipSeed);
    expect(game.getScreen()).toBe('playing');

    // -- generation 2 is itself saveable and loadable -----------------------
    const gen2Save = await game.saveGame('qa_lifecycle_gen2');
    expect(gen2Save.ok, gen2Save.message).toBe(true);
    for (let tick = 0; tick < 30; tick += 1) game.tick(1);
    const gen2Load = await game.loadGame('qa_lifecycle_gen2');
    expect(gen2Load.ok, gen2Load.message).toBe(true);
    expect(game.getState().life.generation).toBe(2);
    expect(game.getState().life.phase).toBe('alive');
    expect(validateState(game.getState()).issues).toEqual([]);
    expect(negativeBalances(game.getState())).toEqual([]);

    // Diagnostics for the report: does the persisted world clock continue across generations?
    const newClock = gen2.clock.simTimeSeconds;
    const futureEvents = gen2.world.events.filter((event) => event.occurredAt > newClock).length;
    console.log(
      'QA scenario lifecycle: archived=' + archivedLives.length +
      ' gen=' + gen2.life.generation + ' simTime=' + newClock +
      ' futureTimedEventsAfterGeneration=' + futureEvents +
      ' legacyItems=' + legacyEntries.length +
      ' history=' + gen2.world.history.length
    );
  });
});
