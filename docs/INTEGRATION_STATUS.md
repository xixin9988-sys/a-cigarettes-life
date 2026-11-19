# Integration Status

Final integration status of **A Cigarette's Life / 香烟的一生** at the repository root.
Written 2026-11-19 from direct inspection of the repository and the executed verification
commands. Content counts come from the current content pack; exact command output, durations
and failure lines are recorded in [TEST_REPORT.md](TEST_REPORT.md).
Final evidence snapshot: source-frozen tree, authoritative run 2026-11-19T05:23Z - app and
worker TypeScript clean, full suite 93 files / 941 tests / 941 passing in 36.72 s (Vitest),
production build clean (185 modules, 7.37 s), ESLint 0 problems; independent browser acceptance
17/17 PASS with 0 console errors ([ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md), 05:19-05:21Z);
independent QA report ([QA_REPORT.md](QA_REPORT.md)); requirement audit
([SPEC_COVERAGE.md](SPEC_COVERAGE.md): 55 implemented / 30 partial / 0 missing of 85 rows).

## How to read this document

Two different kinds of evidence are used, and they are not mixed:

- **Verified** - covered by an automated check that was actually run: a vitest suite, a strict
  TypeScript compile, a production build or a browser smoke run. The "Verified by" line names it.
- **Implemented, not verified** - the code exists, compiles and is wired, but no automated test
  (or only an indirect one) exercises it. These are called out explicitly, per area.

Nothing in this document is aspirational. Where a claim could not be checked, it is marked
"not verified" and listed again under Known limitations and open gaps.

Legend: **Verified** / **Mostly verified** (core paths tested, some edges unverified) /
**Implemented, partially verified** / **Present but unverified**.

## Status summary (15 spec areas)

| # | Area | Verdict | Primary evidence |
|---|---|---|---|
| 0 | Core contracts, state, GameEngine, integration | **Verified** | tests/contracts, tests/integration, tests/simulation, tests/persistence; strict TS + build |
| 1 | Probability engine | **Verified** | tests/probability (13 files), contract compliance, QA determinism checks |
| 2 | Simulation orchestration, worker, offline catch-up | **Mostly verified** | tests/simulation, tests/qa/offlineCatchup, QA save/economy runs; real Worker path proven by browser acceptance S14/S15; Node tests still exercise the fallback |
| 3 | NPC autonomous life | **Verified** | tests/npc (9 files), QA 30-day multi-seed runs |
| 4 | World, map, weather, seasons, transport, history | **Verified** | tests/world (6 files), content/contract compliance |
| 5 | Farming, foraging and nature data | **Verified** | tests/gameplay/nature_*, QA regressions, full-lifecycle scenario |
| 6 | Fishing and exploration | **Verified** | tests/gameplay/nature_fishing, nature_exploration, QA scenario/regressions; browser acceptance S10 (fishing loop, post-fix) |
| 7 | Crafting, cooking, collection, skills | **Verified** | tests/gameplay/craft_*, skill_curve, content/contract checks |
| 8 | Building and housing | **Verified** | tests/gameplay/craft_building, housing_placement |
| 9 | Economy, businesses, jobs, player shop | **Verified** | tests/economy (7 files), tests/qa/economyIntegrity, QA world stability |
| 10 | Social, dialogue, romance, community | **Verified** | tests/social (8 files), QA full-lifecycle scenario |
| 11 | Events and festivals | **Implemented, partially verified** | tests/events, QA world stability event counts |
| 12 | Life, cigarette physics, archive, legacy | **Verified** | tests/life (9 files), QA world stability burn-out/archive |
| 13 | UI, Phaser scenes, audio | **Implemented; browser-verified; no vitest coverage of Phaser itself** | production build + independent browser acceptance 17/17 PASS (ACCEPTANCE_REPORT.md, 0 console errors); 46 DOM/fake-DOM UI tests + 61 Phaser-free render tests, 52 audio tests in vitest |
| 14 | QA, stress, scenario and acceptance testing | **Verified** | tests/qa, tests/scenarios; docs/QA_REPORT.md; final authoritative suite 941/941 (TEST_REPORT) |

---

## 0. Core, contracts and integration

**Module files**
src/core/ (17 files): contracts.d.ts (frozen interfaces: IClock, IEventBus, ISystemRegistry,
IGameContext, IContentRegistry, IProbabilityEngine, ISaveManager, IWorkerBridge, IGameApi, all
GameAction/GameState types), SharedTypes.ts, WorldConfig.ts, WorldFactory.ts, Clock.ts,
EventBus.ts, SystemRegistry.ts, GameContext.ts, ContentRegistry.ts, InventoryUtil.ts,
RelationshipUtil.ts, TimeUtil.ts, utils.ts, format.ts, GameLogger.ts, Game.ts (GameEngine).
Boot/wiring: src/main.ts; simulation composition: src/simulation/SimulationRuntime.ts;
persistence: src/persistence/**; worker: src/workers/**.

**Implemented**
- Single persistent GameState root with world, npcs, player, economy, farming, fishing,
  foraging, exploration, crafting, cooking, building, housing, collection, social, life,
  eventSystem, probability, settings, archive, pendingOffline, flags, clock and meta slices.
- GameEngine implements IGameApi: 75 action variants (a discriminated union covering
  movement/travel, inventory/equipment, farming, fishing, foraging, exploration, crafting,
  cooking, building, housing, shops/businesses/jobs, social/dialogue, train, life/legacy,
  events/festivals, collection, save/load, rest, settings). Every action is routed to the
  owning system and returns an ActionResult.
- SimulationRuntime constructs and registers the 17 systems in fixed order:
  world -> npc -> economy -> skill -> farming -> foraging -> fishing -> exploration ->
  crafting -> cooking -> building -> housing -> collection -> social -> dialogue -> events ->
  life. One ProbabilityEngine, one Clock, one EventBus, one SystemRegistry and one
  GameContext are shared by all of them.
- Fixed-step active loop: GameEngine.tick(realDelta) -> Clock.advanceRealSeconds ->
  SimulationRuntime.update(simDelta) -> 17 systems -> time-boundary events (time:hour,
  time:day, time:season). Base time scale: 1 real second = 1 game minute (1 game hour = 60
  simulated seconds; 1 game day = 1440 simulated seconds).
- Save/load/offline orchestration, autosave (setting, minimum 30 real seconds), life-end
  detection, next-generation creation with world/NPC/economy/archive continuity.
- Save-time snapshot: SaveManager.save() structuredClones the live state before any await, stamps
  meta/pendingOffline on the snapshot, trims only the snapshot's probability history to 400 and
  checksums/writes that exact snapshot (so the written payload always matches the checksum even
  while the render loop keeps mutating live state). The live state keeps its full 5000-record
  debug ring and receives the same save markers so the next offline calculation starts from the
  committed instant.
- Hidden-tab background simulation (LOD2-lite): while document.hidden, GameEngine pauses the
  main-thread tick, starts a 5 s worker loop (startBackgroundSimulation()), sends the world plus
  real elapsed time to the simulation worker, merges the returned advanced state on each chunk
  and saves atomically when the tab becomes visible again (stopBackgroundSimulation() ->
  saveGame()). While visible, all regions are still simulated by the one main-thread runtime.
- Atomic save after offline settlement: applyOfflineResult() records the settlement markers and
  immediately persists the settled world through the normal ping-pong autosave, so a crash after
  the in-memory apply cannot re-settle the same offline window.
- Content validation at boot (ContentRegistry.validate()) and canonical-id discipline
  (src/data/*/ids.ts).

**Verified by**
- tests/contracts/contractCompliance.test.ts - content-pack completeness, all 17 systems
  registered with init/update, no Math.random() anywhere in src/, canonical item-id coverage.
- tests/integration/fullLifeCycle.test.ts - save with 56 NPCs, farming+harvest, shop
  purchase, dialogue tree, save/reload through the IndexedDB fallback, offline catch-up.
- tests/simulation/simulationCore.test.ts - scheduler, snapshots, state diff, offline summary.
- tests/persistence/saveManager.test.ts and tests/qa/saveCorruption.test.ts - ping-pong
  saves, corruption fallback, export/import checksum validation, migration/validation,
  save-time payload/checksum consistency.
- Browser acceptance (docs/ACCEPTANCE_REPORT.md) - manual save while the simulation is running,
  followed by load, reproduces the saved instant (the save-time snapshot fix came from a real
  browser report).
- Strict app and worker TypeScript projects; ESLint; production build (see TEST_REPORT).

**Known limitations**
- src/main.ts (Phaser + DOM + Web Audio bootstrap) has no automated test - it needs a
  browser. It is covered only by the production build and the headless-Chrome smoke run.
- Item instanceIds were generated by makeId() in src/core/utils.ts, which mixed in Date.now();
  this was found during the docs audit and fixed by the Lead with configureIdGenerator() /
  syncIdCounterFromState() (seed-derived deterministic token + counter, loaded saves sync past
  persisted ids). The final determinism check is in TEST_REPORT (gap G1, resolved).

## 1. Probability engine

**Module files** - src/probability/ (13 files): RandomProvider.ts (SplitMix64 + Xoshiro128**),
RandomStream.ts, SeedManager.ts (stream derivation), ProbabilityEngine.ts,
ProbabilityCalculator.ts, ProbabilityRegistry.ts (alias tables), ModifierResolver.ts,
ConditionEvaluator.ts, ProbabilityHistory.ts, ProbabilityDebugger.ts, CausalTrace.ts,
types.ts, index.ts.

**Implemented**
- One deterministic engine for every uncertain outcome; 31 persisted streams (world.weather,
  world.environment, world.transport, npc.behavior, npc.social, npc.memory, npc.schedule,
  economy.market, economy.business, economy.customer, economy.jobs, farming.growth,
  farming.quality, foraging.results, fishing.results, fishing.minigame, exploration.discovery,
  crafting.quality, cooking.quality, collection.discovery, social.interaction, social.romance,
  social.dialogue, events.occurrence, events.festival, player.opportunities,
  player.cigarettePhysics, life.ash, life.archive, housing.decor, ui.cosmetic), each
  independently persisted (4 uint32 words) and derived from the life seed.
- Conditions AST (and/or/not/cmp/flag/contains with JSON-path context), additive/multiplicative
  modifiers, weight clamps, prefix-sum + binary-search sampling for small candidate sets, Vose
  alias tables for large static distributions, deterministic zero-weight fallback.
- Bounded decision history (5000 records) with context, candidate weights/probabilities and
  selected result; replay lookup, per-stream statistics, causal-trace graph and a debug
  snapshot consumed by the F12 panel.

**Verified by** - 13 vitest suites in tests/probability/: PRNG primitives/state validation,
seed derivation and stream independence, condition operators, modifier/weight bounds,
sampling correctness and simulate() bookkeeping, distribution statistics, determinism (draws,
decisions, save/restore), history ring + causal trace, registry/alias tables, debugger maths,
replay and fuzzing (200 generated decision shapes). Also tests/contracts and QA performance
budgets (20k decisions / 200k primitive draws).

**Known limitations**
- The persisted probability history is capped to the last 400 records on save (save-size
  strategy); the in-memory ring holds 5000. Older debug decisions do not survive a save.

## 2. Simulation orchestration, worker and offline catch-up

**Module files** - src/simulation/ (10 files): SimulationRuntime.ts, ActiveSimulation.ts,
BackgroundSimulation.ts, OfflineSimulation.ts, OfflineSummaryBuilder.ts, SimulationReplay.ts,
SimulationScheduler.ts, SimulationSnapshot.ts, StateDiffEngine.ts, WorldSimulation.ts;
src/workers/ (3 files): simulation.worker.ts, WorkerBridge.ts, WorkerProtocol.ts.

**Implemented**
- LOD 1 (active): fixed 0.25 s scheduler driving the same SimulationRuntime on the main
  thread; 1 real second = 1 game minute.
- LOD 2 (background): worker message kind background and the BackgroundSimulation class exist;
  the worker clones the state, advances a local SimulationRuntime and returns the advanced
  state. LOD2-lite is wired for hidden tabs: main.ts listens to document.visibilitychange and
  calls GameEngine.startBackgroundSimulation() / stopBackgroundSimulation(); while hidden the
  main tick pauses, a 5 s interval sends the current state plus real elapsed time
  (realSeconds x offlineTimeScale = 0.05, capped at 300 s per chunk) to the worker, the returned
  state replaces the live one and a save is committed when the tab becomes visible again.
  During visible play all 56 NPCs and both regions are still simulated by the single
  main-thread runtime; there is no separate distant-region worker tick while playing.
- LOD 3 (offline): GameEngine.requestOfflineCatchup() -> WorkerBridge.requestOffline() ->
  simulation.worker.ts -> SimulationRuntime.runOffline with adaptive aggregation, progress
  messages every 25 steps (offline-progress), a 60 s worker timeout, and a transparent
  main-thread fallback if the worker cannot start or fails. The result is applied only when
  the returned lastProcessedSimTime matches the requested target and is not older than the
  stored marker (idempotency lock); both paths set flags[offline_simulation] so systems apply
  offline multipliers (cigarette burn x0.35).
- OfflineSummaryBuilder builds a real summary from a captured baseline (money, cigarette
  length/moisture, influence, NPC location/activity/money/relationship statuses, business
  money/revenue/stock value, market prices, new events/history/letters/achievements/archive
  entries, flags) with a 60-change cap and 8 important-NPC updates.
- SimulationReplay.runHeadlessSimulation runs complete days of the real runtime with no
  renderer for tests/QA; SimulationSnapshot captures/clones states; StateDiffEngine diffs them.

**Verified by**
- tests/simulation/simulationCore.test.ts - fixed-step accumulation, scheduler intervals,
  snapshot round-trip, diff engine, offline summary honesty.
- tests/qa/offlineCatchup.test.ts - 24 h / 72 h / 14-day real gaps through the real GameEngine:
  summary magnitude matches the configured scale and cap, the world advances, the state
  validates, re-application is idempotent, no negative balances.
- tests/integration/fullLifeCycle.test.ts - offline catch-up integration.
- tests/social/offline.test.ts - large offline catch-up does not corrupt social state.
- QA performance runs: 24 h / 72 h / 14 d catch-ups settle in 3.8 s / 2.8 s / 1.8 s with
  144 / 9 / 14 aggregated steps and 7.5 % / 22.5 % / 35 % cigarette burn (TEST_REPORT).
- Browser acceptance S14: a 24 h absence ran in the REAL Web Worker against the production
  build - summary rendered, simulatedGameHours = 72, clock advanced, automatic atomic save
  observed, immediate second request became a no-op. S15: hidden-tab startBackgroundSimulation/
  stopBackgroundSimulation advanced the world in the worker and merged on return.

**Known limitations**
- In Node/vitest there is no Worker global, so tests exercise the main-thread fallback; the
  actual module Web Worker path is only exercised in a browser. The browser acceptance run is
  the evidence for the worker path.
- LOD 2 offload is partial by design: the worker-driven background path runs only while the
  tab is hidden (LOD2-lite, wired in Game.ts/main.ts). During visible play all regions are
  simulated on the main thread by the one runtime - 56 NPCs are cheap enough at this scale and
  avoids per-few-seconds snapshot/merge cost. It is not a full distant-region LOD2 offload, and
  the hidden-tab loop advances the world at the offline time scale (1 real hour = 3 game hours,
  not the active 1 real second = 1 game minute), then merges on return - a deliberate throttle,
  documented here so it is not mistaken for full-speed background play.
- Offline step-size bucketing was corrected during final integration to follow the documented
  real-hours policy: less than 1 real hour -> 5 game-minute steps, 1-24 real hours -> 30-minute
  steps, more than 24 real hours -> daily steps (the real elapsed time is passed into
  SimulationRuntime.runOffline). A 12 h real absence now aggregates dozens of 30-minute steps;
  see REGRESSION-2 and TEST_REPORT (gap G2, resolved).
- WORLD_CONFIG.worldTime.maxOfflineGameDays is 14 (config and code agree) while
  docs/WORLD_SIMULATION.md still says 7 (docs drift, not code).

## 3. NPC autonomous life

**Module files** - src/npc/ (10 files): NPCSystem.ts, NPC.ts (activity catalogue and the
serialisable per-NPC extension payload), NPCDecisionEngine.ts (utility AI), NeedSystem.ts
(9 needs, 6 emotions, mood), PersonalitySystem.ts (12 traits), MemorySystem.ts (Ebbinghaus
decay + permanent memories), ScheduleSystem.ts, RelationshipSystem.ts, SocialSimulation.ts
(NPC-NPC life), NPCArchive.ts. Data: src/data/npcs/ (56 NPC definitions, schedules,
relationships, dialogue ids).

**Implemented**
- 56 NPCs = 14 majors + 42 residents, each with personality, needs, emotions/mood, money,
  occupation/job, home/work/location, activity + history, relationships, memories, goals,
  schedule and life history.
- Needs decay per game hour; schedules generate planned activities with adherence rolls;
  utility AI scores candidates (work, sleep, eat, shop, socialise, hobbies, events, errands,
  travel...) and the top candidates are resolved on npc.behavior; execution updates needs,
  mood, memories, location and relationships.
- Independent NPC-NPC social simulation every ~15 game minutes for co-located NPCs
  (friendships, rivalries, dating, breakups), logged in NPC history and world history.
- Large-dt safety: decisions staggered/capped; a single huge update does not stall.

**Verified by** - tests/npc/ (data, needs, personality, memory, schedule, activity, social,
contracts, performance), tests/qa/worldStability.test.ts (30 game days x 3 seeds: activity
variety, 50+ NPCs with history, memories, interaction counts, bounded logs),
tests/integration/fullLifeCycle.test.ts.

**Known limitations**
- tests/npc/social.test.ts and tests/npc/activity.test.ts are among the slowest per-file NPC
  suites; 30-day headless world runs take roughly 13-20 s per seed (see TEST_REPORT).
- A 30-day world run produces about 75k NPC decision records, which is why the persisted
  probability history is capped (see area 1).

## 4. World, map, weather, seasons, transport, history

**Module files** - src/world/ (9 files): WorldManager.ts, RegionManager.ts,
LocationManager.ts, MapManager.ts, WeatherSystem.ts, EnvironmentSystem.ts, SeasonSystem.ts,
TransportSystem.ts, WorldHistory.ts. Data: src/data/locations/,
src/data/probability/weather.ts, src/data/transport/routes.ts.

**Implemented**
- 90 locations = 45 exteriors (25 Willowbrook + 20 Ashford) + 45 interiors
  (exteriorId + _interior for enterable kinds), validated undirected walk graph, 5 secret
  locations (hidden garden, secret path, ancient well, ...).
- Weather: per-season Markov chain over 7 weather types, transitions every 4 game hours on
  world.weather; environment owns temperature, humidity, wind speed/direction, rainfall, fog
  and daylight; seasons of 28 days, day/night phases, per-location microclimate
  (indoor/shelter, wind exposure, humidity modifier, heat source) and opening hours.
- Transport: 4 train routes (Willowbrook <-> Ashford local/express) with timetables, ticket
  purchase and a boarding window; train travel advances with the clock.
- Discovery/secret unlock via exploration clues, visit tracking, location condition decay,
  NPC occupancy mirrors; capped world history (800 entries) and world event log (400).

**Verified by** - tests/world/ (locations 12, map 14, weather 14, routes 6, world-systems 31,
content-integration 6), tests/contracts (45 exteriors, interior entrance links, at least 4
secrets), integration travel tests, QA world stability (weather/season/environment domains
validated over 30 days).

**Known limitations** - Travel is a location graph, not tile-level pathfinding between
locations; authored mapX/mapY positions are used by the SVG map. The train timetable is static
authored data (no dynamic delays).

## 5. Farming and foraging (nature)

**Module files** - src/gameplay/FarmingSystem.ts, src/gameplay/ForagingSystem.ts; data:
src/data/crops/crops.ts, src/data/fish/fish.ts (FORAGE_NODES), src/data/items/nature.ts.

**Implemented**
- 19 crops with staged growth (game-hour scale), seasons, seed/produce items, water,
  temperature and fertility needs, disease, withering, regrow, yield/quality.
- Farm actions: till, plant, water, fertilise (cigarette ash potash / compost), harvest,
  clear, build greenhouse (greenhouses bypass season); plots keyed locationId:x:y.
- 46 seasonal forage nodes across forest/park/orchard/farm/countryside, skill/season checks,
  yield rolls, depletion and configured respawn.
- Crops and forage regrow correctly across large/dt and offline steps (QA regressions).

**Verified by** - tests/gameplay/nature_farming.test.ts (13), nature_foraging.test.ts (9),
nature_data.test.ts (17), tests/qa/regressions.test.ts (game-hour growth, respawn), and
tests/scenarios/fullPlayerLifecycle.test.ts (forage + farm + harvest + ash).

**Known limitations** - Farming is plot-based inside authored farm locations (no free-form
field editor); greenhouse placement is a fixed facility action.

## 6. Fishing and exploration

**Module files** - src/gameplay/FishingSystem.ts, src/gameplay/ExplorationSystem.ts;
data: src/data/fish/fish.ts.

**Implemented**
- 16 fish across habitats/seasons/hours/weather, rod tiers (basic/good/master), bait tags,
  skill requirements, weighted wait/target selection; real state machine cast -> wait -> bite
  -> reeling minigame (hold adds progress and tension, release lowers tension, fish pulses) ->
  catch with size/quality/statistics/collection/photo records; sessions auto-cancel on large
  offline steps.
- Exploration: per-location search with a 1 game-hour cooldown, probability-driven outcomes
  (nothing / item / clue / photo / discovery), secret-location unlocking through
  IWorldSystem.unlockLocation; photos are stored in the life archive and collection.

**Verified by** - tests/gameplay/nature_fishing.test.ts (12),
tests/gameplay/nature_exploration.test.ts (10), tests/scenarios/fullPlayerLifecycle.test.ts
(real cast/reel/catch helper), tests/qa/regressions.test.ts (exploration cooldown), and
browser acceptance S10 (cast -> bite -> reel -> landed 21.3 cm Perch on the production build).

**Known limitations** - Fishing needs continuous real-time input; offline sessions are
deliberately cancelled instead of simulated. Exploration has no dedicated minimap clue
tracker (clues are inventory/journal items). The bite-wait unit was wrong (60x: 4-22 real
minutes per cast) and was fixed post-freeze to the configured 4-22 game minutes = 4-22 real
seconds at 1x; the vitest fishing suite does not assert the absolute wait duration, so that
unit is currently guarded only by the browser acceptance replay (S10), not by a unit test.

## 7. Crafting, cooking, skills and collection

**Module files** - src/gameplay/CraftingSystem.ts, CookingSystem.ts, SkillSystem.ts,
CollectionSystem.ts; data: src/data/recipes/recipes.ts, src/data/collection/categories.ts,
src/data/items/crafted.ts.

**Implemented**
- 100 recipes (69 craft, 31 cook) across 4 stations (workbench, kitchen, campfire,
  art_studio); atomic input consumption, skill/level gates, station availability from
  location/home furniture, timed game-hour jobs, quality rolls, recipe knowledge/unlocking.
- Cooking yields food/drink with quality/freshness, nutrition and temporary buffs; eating
  applies the effects.
- 8 skills (gardening, fishing, foraging, exploration, crafting, cooking, socialising, art)
  with XP from real actions, an exponential curve, max level 20, XP multipliers and level-up
  events.
- Collection/museum: 10 categories, tagged items auto-register on acquisition, donations
  consume items and progress museum records.

**Verified by** - tests/gameplay/craft_crafting.test.ts (23), craft_cooking.test.ts (15),
craft_collection.test.ts (10), craft_integration.test.ts (5), craft_data.test.ts (15),
skill_curve.test.ts (10).

**Known limitations** - The recipe set is the authored content pack (100); crafting quality
depends on item quality + skill rolls but there is no separate durability system beyond
consumables/equipment modifiers.

## 8. Building and housing

**Module files** - src/gameplay/BuildingSystem.ts, src/gameplay/HousingSystem.ts; data:
src/data/furniture/furniture.ts, src/data/blueprints/blueprints.ts.

**Implemented**
- 17 blueprints (extra room, bedroom, kitchen, workshop, storeroom, conservatory, two
  greenhouses, farm shed, garden expansion/flowers, kitchen/bedroom upgrade, home extension,
  shop counter/shelves/sign) with real material requirements, multi-day projects and real
  effects (rooms/facilities/greenhouse plots).
- 29 furniture definitions; grid-based placement with AABB collision, door reachability,
  rotation, paint/floor changes, storage transfer, comfort/decor scores and garden plots.

**Verified by** - tests/gameplay/craft_building.test.ts (13),
tests/gameplay/housing_placement.test.ts (22), craft_data.test.ts furniture/blueprint data,
tests/scenarios/fullPlayerLifecycle.test.ts (home interactions).

**Known limitations** - One player home (home_player); no multi-property ownership.

## 9. Economy, businesses, jobs and player shop

**Module files** - src/economy/ (11 files): EconomySystem.ts, MarketSystem.ts, PriceSystem.ts,
SupplyDemandSystem.ts, InventorySystem.ts, TransactionSystem.ts, BusinessSystem.ts,
EmploymentSystem.ts, PlayerShopSystem.ts, EconomyHelpers.ts, index.ts.
Data: src/data/shops/shops.ts (22 businesses, 50 job seeds).

**Implemented**
- 22 businesses (17 business types) with location, owner, money, reputation, markup, hours,
  stock, employees and customers; dynamic market prices from supply/demand/seasonal pressure
  clamped to 0.4-2.5x base; NPC budgets and spending, wages with tax, restocking, hourly
  market settlement and daily business settlement (idempotent by absolute sim-time markers).
- Player jobs (apply/quit/shift with wages) and a player-run shop (buy business, open/close,
  pricing, restock, hire/fire, daily reports, revenue/expenses/reputation).
- Atomic transactions: money is integer pence, never negative; transaction log bounded.

**Verified by** - tests/economy/ (economy_data, transaction, price_market, market_stability,
business_simulation, employment, player_shop), tests/qa/economyIntegrity.test.ts (30-day
aggregated run, price moves, wages, restock, player-shop idempotent daily settlement,
determinism of the economy slice), tests/qa/worldStability.test.ts (3 seeds x 30 days: price
clamps, non-negative balances, stocked shops, wage records), and
tests/integration/fullLifeCycle.test.ts (real purchase).

**Known limitations** - Buying a business (150k+ pence) is far outside a new character's
starting 25,000 pence; QA tests seed the wallet through a documented fixture to test the
feature. The action itself is real and persists - this is balance, not a fake path.

## 10. Social, dialogue, romance and community

**Module files** - src/social/ (12 files): SocialSystem.ts, DialogueSystem.ts,
DialogueConditions.ts, FriendshipSystem.ts, GiftSystem.ts, InvitationSystem.ts,
RomanceSystem.ts, CommunitySystem.ts, RelationshipOps.ts, SocialHistory.ts, socialUtils.ts,
config.ts. Data: src/data/dialogue/dialogue.ts, src/data/community/community.ts.

**Implemented**
- Player social actions: talk/chat, gift (taste + quality), help, invite, apologise, confess,
  date, community proposals; NPC acceptance depends on personality/mood/trust/context.
- 18 dialogue trees / 314 nodes / 1135 choices with conditional text variants, conditional
  and once-only choices, effects (relationship/item/money/memory/flag/influence), greeting by
  relationship status; 8 community proposals with resident voting and build progress.
- Relationship model: affinity/trust/intimacy/familiarity, 10 statuses, decay over neglect,
  memory-influenced acceptance, asymmetric player/NPC views; NPC-initiated invitations.

**Verified by** - tests/social/ (dialogue 24, friendship 17, gift 14, invitations 15,
romance 18, community 12, data 17, offline 8), tests/scenarios/fullPlayerLifecycle.test.ts
(meet/talk/dialogue/gift/relationship chain), tests/qa/worldStability.test.ts (NPC-NPC
interactions without the player).

**Known limitations** - Dialogue content is authored (18 trees, 314 nodes); no runtime
dialogue generation. Community projects are limited to the 8 authored proposals.

## 11. Events and festivals

**Module files** - src/gameplay/EventSystem.ts; data: src/data/events/events.ts (33 events +
10 festivals), src/data/events/festivalIds.ts.

**Implemented**
- 33 events (11 ordinary, 8 interesting, 6 lucky, 5 unlucky, 3 special) with conditions
  (season/weather/hour/location tags/influence/skill/occurrence/flag), weights on
  events.occurrence, cooldowns, uniqueness, duration and effects (relationship, money, item,
  mood, history, world flag, chained event, weather). Checked every 30 game minutes and
  capped per update so long offline periods produce summaries rather than thousands of records.
- 10 festivals across the four seasons at real locations with hours and activities; festival
  actions roll skill + probability for rewards/influence; starts and participation are
  recorded in world history.

**Verified by** - tests/events/eventSystem.test.ts (4 tests: data + occurrence/effects through
the real runtime), tests/qa/worldStability.test.ts (bounded event log and occurred events over
30 days), tests/world/content-integration.test.ts (event data inside the wider content set).

**Known limitations** - Test depth is the thinnest of all domains (4 tests): the event data
schema and the core occurrence/effect path are covered, but every event's long-run balance and
every festival activity outcome are not individually asserted. Events are authored (33), not
generated.

## 12. Life, cigarette physics, archive and legacy

**Module files** - src/life/ (8 files): LifeSystem.ts, CigarettePhysicsSystem.ts,
LifeArchiveSystem.ts, AchievementSystem.ts, PlayerIdentitySystem.ts, InfluenceSystem.ts,
GenerationSystem.ts, lifeShared.ts. Data: src/data/items/life.ts,
src/data/achievements/achievements.ts, src/data/goals/goals.ts.

**Implemented**
- Cigarette body: lengthRatio burns with simulated time (base lifetime 336 game hours),
  accelerated by wind/exertion and slowed by rain/moisture; offline burn uses the 0.35
  multiplier; moisture rises in rain/humidity and dries indoors/near heat; soaked (>0.85)
  blocks heavy work; movement slows above 0.3; warnings are emitted; ash accumulates and is
  collectable as potash/pigment; equipment (umbrella, windbreak, case, outerwear, hat,
  accessory, tool) applies protection modifiers; warm-up action available.
- Life end at lengthRatio <= 0: an archive record is built from real statistics/relationships/
  world changes; the life review is shown; the next generation starts with
  world/NPC/economy/housing/collection/flags continuity, NPC memories of the previous player
  removed, and at most 3 legacy mementos.
- 37 achievements from real counters, 20 personal goals, an influence ladder, profession line,
  letters, statistics and a life archive (persisted also to the IndexedDB archive store).

**Verified by** - tests/life/ (physics 18, lifecycle 11, data 13, archive 9, achievements 7,
ash 7, goals 5, legacy 5, identity/influence 7), tests/qa/worldStability.test.ts (unattended
30-day burn-out and truthfulness of the archive review), tests/qa/offlineCatchup.test.ts
(offline burn fraction between 0 and 1, life stays alive), and
tests/scenarios/fullPlayerLifecycle.test.ts (next generation).

**Known limitations** - Unattended at 1x the cigarette burns out in ~14 game days (by design:
336 game hours). The archive is an append-only array in the save plus the IndexedDB archive
store. Offline burn is fractionally applied across aggregated steps (QA verifies worker and
fallback paths agree).

## 13. UI, Phaser scenes and audio

**Module files** - src/scenes/ (15 files): BootScene, PreloadScene, MainMenuScene,
BaseWorldScene, TownScene, CityScene, InteriorScene, LifeEndScene, plus config.ts,
sceneRouter.ts, session.ts, sceneHelpers.ts, sceneHelpersExtra.ts and controllers/ (player
sprite, NPC sprites, weather FX, world renderer). src/render/ (8 files): procedural pixel-art
palette, geometry, layout, tiles, figures, effects, texture keys, texture factory. src/ui/
(22 files): UIManager, HUD and the panels inventory, map, social, skills, journal, events,
shop, building, housing, collection, archive, settings, life, dialogue, fishing minigame,
probability debugger, help, plus shared widgets/styles/model. src/audio/AudioManager.ts
(procedural Web Audio: ambience, generative music, 17 SFX). src/main.ts boots engine -> DOM UI
-> Phaser -> audio; index.html provides the boot overlay and mounts #game-root/#ui-root.

**Implemented**
- Phaser 3 scenes render a 1280x736 diorama per location with procedurally generated textures
  (no external asset files): town/city/interior scenes, a player cigarette sprite that
  shortens as it burns with ember glow and leaning/droop in wind/rain, NPC sprite figures,
  weather/season/day-night effects.
- DOM UI: 18 panel ids, HUD (cigarette body bar, location/time/weather, purse, hints),
  character creation, main menu, save slots, offline summary modal, life review,
  notifications; keyboard shortcuts (rebindable in Settings) and mouse/touch controls.
- Audio: lazily started after the first user gesture (browser autoplay policy); weather/season
  ambience, a generative music loop, event SFX, persisted volume settings.

**Verified by** - Production build (npx vite build) succeeds and bundles the whole game
including a separate worker chunk (185 modules; index 2.78 MB gzip 711.77 kB, worker 0.82 MB).
Independent browser acceptance (docs/ACCEPTANCE_REPORT.md, run 2026-11-19T05:19:26Z ->
05:21:36Z) passed 17/17 scenarios with 0 console errors / 0 failed requests: boot + menu,
character creation, world rendering + WASD movement, inventory, map + adjacency travel, NPC
dialogue via E, social panels + chat/gift, shop purchase, employment shift, fishing loop,
farming loop, foraging + crafting, save -> page reload -> load, real Web Worker offline catch-up
+ summary + automatic atomic save, hidden-tab LOD2 background chunk, life end -> review -> next
generation, console-error sweep. Evidence: smoke/acceptance-results.json, acceptance-console.log
and 25 screenshots smoke/acceptance-*.png. In vitest, 46 DOM/fake-DOM UI tests and 61
Phaser-free render-layer tests cover view models, panel registry, palette/geometry/layout and
texture manifest; 52 audio tests cover the procedural audio layer under a fake AudioContext.

**Known limitations**
- No browser-level automated regression in npm test: the Phaser scene layer, IndexedDB in the
  browser, the real Web Worker and hidden-tab path are proven by the acceptance script run, not
  by CI. A change to scenes/ui/browser wiring can pass vitest and still break the game until the
  acceptance replay is run (G3/G5).
- Acceptance scope is not the whole game: deep traversal was Willowbrook-only; Ashford,
  trains/tickets, most interiors and the building/housing/collection/archive panels were not
  fully played through in the browser (they are covered by unit/QA tests). Audio output was not
  asserted (AudioManager runs; no sound assertion).
- The earlier 04:24 smoke screenshot showing a small Phaser canvas was a transient state while
  the scene layer was being finalised; the accepted build renders a full-window 1440x900 WebGL
  canvas (S01/S03) and scene transitions were fixed (acceptance BUG-1).
- Audio requires a real user gesture and a real AudioContext; it cannot be exercised headlessly.

## 14. QA, stress and scenario testing

**Module files** - tests/qa/ (6 spec files + support harness): worldStability, offlineCatchup,
performance, economyIntegrity, saveCorruption, regressions; tests/scenarios/
fullPlayerLifecycle.test.ts; shared harness tests/qa/support/qaHarness.ts (deep GameState
validator, determinism fingerprint, real-path helpers). Project-wide: tests/contracts,
tests/integration.

**Implemented**
- Deep semantic validator over a full GameState (ids resolve, ranges, caps, finite numbers,
  money non-negative, logs bounded) used by long-run tests.
- Determinism fingerprint (wall-clock bookkeeping fields excluded) plus byte-for-byte JSON
  round-trip checks.
- 30-game-day x 3-seed headless stability runs, long-run economy integrity (30 days plus
  idempotent player-shop settlement), offline-gap stress (24 h / 72 h / 14 days), save
  corruption/migration scenarios, performance budgets (20k decisions, 200k draws, 30-day
  56-NPC run under 30 s, bounded logs) and a full player-lifecycle scenario through the public
  GameEngine API.

**Verified by** - the project-wide runs recorded in TEST_REPORT (final authoritative run:
93 files / 941 tests / 941 passed in 36.72 s Vitest), docs/QA_REPORT.md (same 93/941 green on
the frozen tree) and docs/ACCEPTANCE_REPORT.md (browser, 17/17 PASS). See Known limitations and
open gaps for the residual/honest findings.

**Known limitations** - No code-coverage instrumentation is configured. Browser acceptance is
a separate manual/smoke activity, not part of vitest. Some QA scenarios use documented fixtures
(seeding money to buy a business; setting pendingOffline.lastSaveRealMs to fake an absence).
The assertion targets are real state changes, but the setup is not a fully organic
play-through.

---

## Content inventory (measured from CONTENT_PACK, current tree)

| Content | Count | Notes |
|---|---|---|
| Items | **234** | 14 of the 17 defined item categories are populated; canonical ids in src/data/items/ids.ts |
| Crops | **19** | turnip, carrot, potato, cabbage, tomato, onion, strawberry, pumpkin, sunflower, tulip, rose, lavender, wheat, barley, herb, apple, pear, plum, cherry |
| Fish | **16** | trout, salmon, carp, perch, pike, bass, eel, catfish, roach, bream, tench, chub, grayling, silver eel, moonfish, junk boot |
| Forage nodes | **46** | seasonal, respawn hours, skill requirements |
| Recipes | **100** | 69 crafting + 31 cooking; stations workbench/kitchen/campfire/art_studio |
| World events | **33** | 11 ordinary / 8 interesting / 6 lucky / 5 unlucky / 3 special |
| Festivals | **10** | spring 3, summer 3, autumn 3, winter 1 (authored dates in data/events/events.ts) |
| Locations | **90** | 45 exteriors (Willowbrook 25, Ashford 20) + 45 interiors; 5 secret |
| Train routes | **4** | Willowbrook <-> Ashford local/express |
| Businesses | **22** | 17 business types, 50 job seeds |
| NPCs | **56** | 14 major + 42 residents |
| Dialogue trees | **18** | 314 nodes, 1135 choices |
| Furniture | **29** | grid placement, comfort/decor |
| Blueprints | **17** | rooms, home upgrades, greenhouses, farm/shop facilities |
| Achievements | **37** | evaluated from real statistics |
| Player goals | **20** | personal goals |
| Community proposals | **8** | resident-voted projects |
| Collection categories | **10** | fish, insects, minerals, flowers, plants, food, recipes, photographs, festival, mementos |
| Skills | **8** | gardening, fishing, foraging, exploration, crafting, cooking, socialising, art (max level 20) |
| Weather types | **7** | clear, cloudy, rain, storm, fog, snow, wind |
| Relationship statuses | **10** | stranger; acquaintance/friend/close_friend; rival/enemy; dating/partner/family/ex |
| NPC traits / needs / emotions | **12 / 9 / 6** | personality; needs; emotions |

ContentRegistry.validate() returns no errors on the current pack (content inventory script
run during this audit).

## Save format

- **Root state**: the whole GameState (version 1) is serialised - one authoritative object.
  Player-visible state is never stored only in a module cache or in UI code.
- **Envelope**: version, checksum, savedAtRealMs, lastProcessedSimTime, payload. The checksum
  is FNV-1a 32-bit hex (fnv1aHex) over JSON.stringify(payload).
- **Storage**: IndexedDB database a_cigarettes_life version 1, object stores meta (slot
  metadata + next buffer), saves (key [slotId, 'A'|'B']) and archive (key lifeId, ArchivedLife
  records). If IndexedDB is unavailable (private mode, Node), MemorySaveStorage transparently
  replaces it; SaveManager.storageKind reports which is active. Save writes a save-time
  structuredClone snapshot (see area 0), so the checksum always matches the payload actually
  written even if the live simulation ticks during the IndexedDB await.
- **Ping-pong**: each save writes the non-"next" buffer plus metadata in one readwrite
  transaction and flips nextSlot; load validates both buffers, discards checksum-invalid ones,
  picks the newest valid one, then migrates/validates. A crash between writes cannot destroy
  the last good save.
- **Export/import**: export produces a pretty save-envelope JSON; backup export produces
  format 'a-cigarettes-life-backup' with exportedAt/version/checksum/state; import accepts
  either format, verifies checksums and migrates.
- **Migration**: SaveMigration.migrateSave() currently normalises a missing legacy version to
  version 1 (no earlier shipped schema exists yet); validateLoadedState() rejects structurally
  broken payloads. A future schema version needs a new migration branch.
- **Offline idempotency markers**: pendingOffline { lastSaveRealMs, lastOfflineSimTime,
  lastProcessedSimTime, pendingSummary, offlineLockToken }; a save records real-clock and
  sim-time markers so each absence is processed at most once.
- **Measured sizes (final run)**: save + load after 10 game hours = 28.1 ms / 6.8 ms with a
  1,959,426-byte (1.87 MiB) payload; a 30-day headless state JSON is 8,846,377 bytes, dominated
  by the probability decision ring (the saved copy is trimmed to 400 records; the live engine
  keeps its 5,000-record ring).

## Offline architecture (as implemented)

    loadGame() / requestOfflineCatchup()
      realElapsed = now - pendingOffline.lastSaveRealMs
      if realElapsed < 45 s            -> skip
      rawSim = realElapsed_s * 0.05    (1 real hour = 3 game hours)
      simSpan = min(rawSim, maxOfflineGameDays * 1440 = 14 game days * 1440)
      if simSpan < 120 sim seconds     -> skip
      from = pendingOffline.lastOfflineSimTime ; to = from + simSpan
      flushPersistence() ; request = { baseState: structuredClone(state), from, to, ... }

      ensureWorker(): lazy WorkerBridge.start() -> module worker (Vite worker format es)
        worker: SimulationRuntime over the snapshot, flags.offline_simulation = true,
                runOffline(from, to, onProgress, realElapsedMs):
                  realHours < 1    -> 5 game-minute steps
                  realHours <= 24  -> 30 game-minute steps
                  else             -> 1 game-day (1440 game-minute) steps
                  (1 game minute = 1 sim second; max 4000 aggregated steps)
                  every 25 steps -> postMessage offline-progress (percent, phase)
                returns advanced state + OfflineSummary + stats
      if worker fails/timeouts (60 s) -> the same runOffline on the main-thread runtime, same flag
      apply only if result.lastProcessedSimTime == request.toSimTime
                 and >= state.pendingOffline.lastProcessedSimTime (idempotency lock)
      update pendingOffline markers ; persist the settled world atomically through the normal
      ping-pong save (a crash after apply cannot re-settle the same window) ; show the summary
      modal ; emit offline:progress/completed

Final measured offline runs (authoritative suite, idle machine): 24 h real -> 144 aggregated
30-game-minute steps, 72 game hours simulated, 7.5 % cigarette burn, 3.8 s; 72 h real -> 9 daily
steps, 216 game hours, 22.5 % burn, 2.8 s; 14 days real -> 14 daily steps, 336 game hours (the
14-game-day cap), 35 % burn, lengthRatio 0.650, life alive, 1.8 s. Browser acceptance S14 ran a
real 24 h absence through the actual Web Worker (workerReady = true, fallback disabled) and
observed the summary modal + automatic atomic save; S15 exercised the hidden-tab worker chunk.

Honesty notes:

- The worker path is the intended production path, but in the Node test environment Worker is
  undefined, so vitest proves the fallback path and the shared runOffline aggregation logic. The
  real worker message plumbing is proven by the browser acceptance run (S14/S15), not by CI.
- LOD 2 during a hidden tab is wired (GameEngine.startBackgroundSimulation /
  stopBackgroundSimulation + document visibilitychange in src/main.ts; 5 s chunks through
  worker requestBackground at offlineTimeScale); during visible play everything is simulated by
  the one main-thread runtime. This is a deliberate scope decision - see gap G4.

## Run instructions (exact)

Prerequisites: Node.js + npm (final run: Node v24.21.0 via npx) and a modern browser with Web
Worker, IndexedDB and Web Audio support. No server, account, network dependency or LLM runtime
is required to play.

    cd <repo>
    npm install                 # dependencies are already present; needed on a clean checkout
    npm run dev                 # Vite dev server, http://localhost:3000
    # or
    npm run build               # tsc --noEmit + tsc -p tsconfig.worker.json --noEmit + vite build
    npm run preview             # serve dist/ (Vite preview, http://localhost:4173)

Verification commands (all from the repo root):

    npx tsc --noEmit                              # app project (src + tests, DOM lib)
    npx tsc -p tsconfig.worker.json --noEmit      # simulation layer, WebWorker lib, no DOM
    npx vitest run                                # full test suite (Node environment)
    npx vitest run tests/qa                       # QA/acceptance subset
    npx vite build                                # production bundle -> dist/
    npx eslint src tests                          # lint, including the no-Math.random rule

Other package.json scripts: npm test (= vitest run), npm run test:watch, npm run lint
(= eslint src tests), npm run typecheck (= both tsc projects), npm run format (Prettier).
Independent browser acceptance (manual, not an npm script; playwright-core is a devDependency):

    npm run build
    npx vite preview --port 4173 --host localhost
    node scripts/acceptance-playthrough.mjs

It uses the installed Google Chrome (documented path in the script), writes
smoke/acceptance-results.json, smoke/acceptance-console.log and 25 screenshots
smoke/acceptance-*.png, and is described in docs/ACCEPTANCE_REPORT.md. The older
scripts/smoke-ui.mjs is a smaller manual smoke variant; both need a preview server.

## Known limitations and open gaps

These are real, current gaps - they are not hidden behind documentation language.

- **G1 - Determinism of item instance ids (RESOLVED during final integration).** makeId()
  used to mix Date.now() into ids; InventoryUtil uses it for player.inventory[].instanceId,
  exploration photos and greenhouses. The Lead fixed it with configureIdGenerator() /
  syncIdCounterFromState() (seed-derived token + counter, loaded saves sync past persisted
  ids); verified by the determinism test and the QA world-stability fingerprint check in
  TEST_REPORT.
- **G2 - Offline step-size policy mismatch (RESOLVED during final integration).** Buckets now
  follow real elapsed hours (<1 h real -> 5 game-min steps, 1-24 h -> 30-min, >24 h -> daily),
  matching docs/WORLD_SIMULATION.md; the real elapsed time is passed to runOffline and the
  offline cap is 14 game days. Verified by REGRESSION-2 / REGRESSION-3 and TEST_REPORT.
- **G3 - Browser/UI evidence is acceptance-run based, not CI.** Phaser scenes and the browser
  runtime have no vitest coverage; the final evidence is the production build plus the
  independent browser acceptance run (17/17 PASS, 0 console errors, 25 screenshots in smoke/).
  That run must be repeated after scene/UI/browser-wiring changes; it is a script, not an
  automated CI gate.
- **G4 - LOD 2 scope is a hidden-tab worker loop, not a perpetual distant-region offload.**
  LOD2-lite is wired: while the tab is hidden, GameEngine pauses the main tick and a 5 s worker
  loop advances the world at the offline time scale (0.05), merging the returned state and
  saving on return. During visible play the whole world is simulated by the one main-thread
  runtime (all 56 NPCs / both regions); there is no separate per-NPC LOD2 offload while the
  player is actively playing. That is a deliberate scale decision, not an accident, but it is
  narrower than a literal 'all distant regions run in the worker at full rate' claim.
- **G5 - Web Worker offline path is browser-only evidence.** Unit/integration tests in Node
  exercise the main-thread fallback (Node has no Worker). The real Worker path is proven by
  browser acceptance S14 (24 h real offline catch-up, workerReady = true, worker fallback
  disabled) and S15 (hidden-tab background chunk). No automated regression covers it.
- **G6 - Documentation drift.** docs/WORLD_SIMULATION.md (maxOfflineGameDays 7, step buckets
  described per real hours) and docs/DATA_SCHEMA.md (items "~190") predate final values (14
  days, 234 items). This document and TEST_REPORT use the measured/current values.
- **G7 - Test-suite status.** The final authoritative run is fully green: 93 files / 941 tests
  / 941 passed, 0 failed, 0 skipped, 36.72 s Vitest. It was not always green: TEST_REPORT section
  6 lists the defects found and fixed during the campaign and their regression/browser
  re-verification. One earlier "failure" was CPU contention on a perf-budget test; the other
  was a stale test expectation after the save-time snapshot change (fixed in the test).
- **G8 - Thin event/festival test depth.** Only 4 event tests exist; full per-event balance and
  every festival activity outcome are not individually asserted.
- **G9 - No coverage tooling / CI.** No @vitest/coverage configuration and no CI runner; the
  numbers in TEST_REPORT are from a single local run. Counts and durations vary with machine
  load (the suite is parallel; the sum of per-file times differs from wall time).
- **G10 - Browser matrix.** Only Chromium (Chrome) is used by the project smoke script;
  Firefox/Safari/mobile are untested. The IndexedDB-to-memory fallback is exercised in Node.
- **G11 - Balance note.** Buying the player shop requires capital far above a new character's
  starting money; reaching it through normal play takes many simulated days (QA seeds the
  wallet deliberately to test the real action path).
- **G12 - Requirement-level partials.** docs/SPEC_COVERAGE.md audits 85 spec requirement rows:
  55 implemented, 30 partial, 0 missing, each partial with named missing facets (transport NPC
  passengers/traffic/line status; location-graph navigation instead of tile-layer HPA*/A* map
  files; debugger heatmap/anomaly depth; some scheduler cadence data-driving; offline-summary
  click-through depth; museum display; parts of multi-generation inheritance; per-module
  READMEs; etc.). Use that report for requirement-by-requirement gaps.
- **G13 - Fishing wait unit guarded only by browser acceptance.** The fixed cast->bite unit
  (4-22 real seconds at 1x) is asserted by the browser acceptance scenario S10, not by a vitest
  test; a future unit regression could pass npm test.
