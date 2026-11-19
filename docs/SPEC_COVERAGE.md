# SPEC_COVERAGE - requirement-by-requirement audit

**Project:** A Cigarette's Life / 香烟的一生 (repository root, Windows)
**Auditor:** coverage agent (task-16), read-only audit
**Audit time:** 2026-11-19 ~04:52 local. The repository was being edited concurrently by other
agents while this audit ran (files under `src/`, `tests/`, `docs/` last modified 04:13-04:46);
every claim below was re-checked against the tree as it stood at the verification run in
[Verification](#verification-commands--results), 04:46-04:51.
**Sources read:** `docs/agent_preamble.md`, `docs/PROJECT_BRIEF.md`, `docs/ARCHITECTURE.md`,
`README.md`, the full 2,905-line original specification `life.txt`
(sections 1-83, all 20 parts) and `code_artifact.txt`
(418-line project/algorithm spec v3.0), plus the repository source, data, tests and docs.

## How to read this document

Status values are used strictly:

- **IMPLEMENTED** - the requirement is present in the current tree and is exercised by code
  that compiles/tests pass (evidence given as `file:line` and/or a test file).
- **PARTIAL** - a real implementation exists, but at least one listed facet of the requirement
  is absent, deviates, or is only reachable through another feature. The missing facet is
  named.
- **MISSING** - no implementation of that facet was found.

No requirement is marked IMPLEMENTED on the strength of a document claim alone; document
claims are cited only as extra context and are checked against code/tests. Test counts are
from the runs listed in [Verification](#verification-commands--results), not from prose.

**Requirement-row tally: 85 rows covering spec sections 1-78 (section 2 split into 2.1-2.4,
section 4 split into 4.1-4.4, plus the data-rules sub-section 8.5): 55 IMPLEMENTED,
30 PARTIAL, 0 MISSING.** Sections 79-83 are acceptance verdicts and are answered
question-by-question in [section 17](#17-part-19---final-acceptance-sections-79-83---verdicts):
79 PASS (with the §16 LOD2 architecture caveat), 80 PASS (with the §14 debug-UI depth caveat),
81 PASS, 82 PARTIAL, 83 PASS for all 17 listed gameplay families with the named sub-feature
gaps.

## Verified state of the repository (headline)

| Check | Result |
|---|---|
| `npx tsc --noEmit` (app project) | **exit 0**, no errors |
| `npx tsc -p tsconfig.worker.json --noEmit` (DOM-free worker project) | **exit 0**, no errors |
| `npx eslint src tests` | **exit 0** (includes the no-`Math.random` rule) |
| `npx vitest run` | **87 test files / 889 tests passed, 0 failed** (71.4 s) |
| `npx vite build` | **exit 0**, 179 modules, 32.8 s; separate worker chunk emitted |
| Targeted content/contracts subset (`tests/contracts`, locations, nature/craft data, probability determinism + stream independence, saveManager, life physics) | **8 files / 98 tests passed** |
| `tests/qa/worldStability.test.ts` (3 seeds x 30 game days, determinism) | **5/5 passed** (49.7 s) |
| Content pack counts (measured, see [Content inventory](#content-inventory-measured)) | 234 items, 90 locations, 56 NPCs, 100 recipes, 33 events, 10 festivals, 31 streams |
| `Math.random()` in `src/` | **0 call sites** (4 comment mentions only); ESLint rule at `eslint.config.js:12-18` |
| Network / `localStorage` use in `src/` | **none** (grep for `fetch(`/`XHR`/`WebSocket`/`localStorage` empty) |

---

# 1. Part 1-2 - project goals, core design, base setting (sections 1-4)

| § | Requirement (compressed) | Status | Evidence |
|---|---|---|---|
| 1 | Complete playable game, all core gameplay in scope, no shells/fake data, tests + docs + runnable project | IMPLEMENTED | production build succeeds; 87/889 vitest green; 15 spec docs under `docs/`; real content pack (`src/data/index.ts:18-42`); no placeholder paths found in audited systems. Deliverable-doc gap tracked in §77. |
| 2.1 | Truly living world: NPCs work/socialise/spend/love; shops trade; prices move; crops grow; weather/events/history advance without the player | IMPLEMENTED | 30-day unattended multi-seed run: 56/56 NPCs with activity history, 7,600-7,700 NPC-NPC relationship interactions, 85-117 world events per seed, life burned out and archived (`tests/qa/worldStability.test.ts:46-156`); shops settle/restock without player (`tests/economy/business_simulation.test.ts:44,99-134`). |
| 2.2 | All uncertain behaviour through one ProbabilityEngine, state/environment/history/causality aware | IMPLEMENTED | one engine composed in `src/simulation/SimulationRuntime.ts:93,116-150`; 31 persisted streams (`src/probability/types.ts:86-118`); conditions/modifiers/history/causal traces in `src/probability/*`; all systems take `ctx.probability`; contract test rejects `Math.random` (`tests/contracts/contractCompliance.test.ts:201`). |
| 2.3 | Special resident: home, free career, property, social network, personal goals, influence, life history, cigarette body; NPCs may refuse | IMPLEMENTED | player home `home_player` + housing/building; jobs `EmploymentSystem`; influence `src/life/InfluenceSystem.ts`; goals `src/life/LifeSystem.ts:334`; cigarette body `src/life/CigarettePhysicsSystem.ts`; NPC refusal in `src/social/RomanceSystem.ts:137-224` and invitation/invite acceptance. |
| 2.4 | Natural simulation, no artificial difficulty, negative outcomes have traceable causes, no malicious random punishment | IMPLEMENTED | no difficulty-level code; every decision records context/candidates/weights (`src/probability/ProbabilityEngine.ts:499-513`); causal parents `src/probability/types.ts:27-46`; negative events carry causes/cooldowns (`src/gameplay/EventSystem.ts:206-243`); zero-weight/empty-candidate fallback prevents soft-lock (`src/probability/types.ts:16-24`, `tests/probability/sampling.test.ts:102-132`). |
| 3 | Tech stack: 2D top-down pixel, PC web, single-player offline, TS strict, Phaser 3, Vite, Canvas, Web Workers, IndexedDB, Vitest, ESLint, Prettier; no cloud/LLM/network | IMPLEMENTED | `package.json:2-25` (phaser 3.90.0, vite 5.4.21, vitest 2.1.9, eslint 9.39.1, prettier 3.6.2, TS 5.9.3); `index.html`; worker chunk in build; no network calls in `src/`; no `localStorage`. |
| 4.1 | Willowbrook: 25 listed landmarks, each with map position, enterable interior, NPC activity, environment incl. humidity/wind/shelter, interaction, facilities, event conditions, history | IMPLEMENTED | `src/data/locations/ids.ts:4-31` (exactly the 25 spec landmarks incl. hidden garden, secret path, special exploration area); 25 Willowbrook interiors; `tests/world/locations.test.ts:67`; microclimate/opening hours/facilities/event tags per location `src/data/locations/locations.ts`; per-location visit/discovery/history state `src/world/LocationManager.ts`. |
| 4.2 | Ashford: 20 listed city locations sharing world sim/economy/weather/events/NPC society | IMPLEMENTED | `src/data/locations/ids.ts:33-54`; 20 Ashford interiors; regional location counts asserted `tests/world/world-systems.test.ts:38-39`; single WorldSystem/EconomySystem/WeatherSystem covers both regions. |
| 4.3 | Transport: walk/train/unlock routes/taxi; train stops, timetable, tickets, boarding state, NPC passengers, traffic events, line status | PARTIAL | 4 routes/timetables/tickets/boarding in `src/data/transport/routes.ts` + `src/world/TransportSystem.ts:106-310` and tests `tests/world/routes.test.ts`; **missing:** NPC passengers on trains, traffic events, dynamic line status (timetable is static; no taxi/route unlock system beyond discovery). |
| 4.4 | Map quality: terrain/building/decor/collision/interaction/NPC-navigation/region-link/microclimate layers; indoor-outdoor switching and building entry | PARTIAL | per-location Phaser scenes with procedural layout/collision/facilities (`src/render/layout.ts`, `src/scenes/BaseWorldScene.ts:301-302,422-534`); microclimate stored per location and sampled (`src/world/LocationManager.ts:89`, `src/life/CigarettePhysicsSystem.ts:330-351`); **deviation:** no separate tile-layer map files; navigation is a location graph (BFS/Dijkstra, `src/world/MapManager.ts:18-20,249,290`) rather than the spec/code-artifact HPA* tile A* with binary-heap micro layer. |

---

# 2. Part 3 - 15-agent organisation (section 5)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 5 | 15-agent split (Agent 0 architect + 14 domain agents), shared contract, no conflicting duplicate systems | IMPLEMENTED | `docs/AGENT_TASKS.md` (task-0..task-14 ownership map), `docs/prompts/*` per-domain briefs, frozen `src/core/contracts.d.ts`; `README.md` project layout mirrors the domains; single implementations per system (`src/simulation/SimulationRuntime.ts:116-134` registers each domain exactly once; `tests/contracts/contractCompliance.test.ts:145-199`). |

---

# 3. Part 4 - architecture, directory, shared data (sections 6-8)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 6 | Dependency layering: core -> probability/world-sim/persistence -> events -> NPC/economy/environment -> gameplay -> life -> UI; module boundaries respected | IMPLEMENTED | `docs/ARCHITECTURE.md` layering; systems composed in fixed dependency order `src/simulation/SimulationRuntime.ts:116-150`; DOM-free worker tsconfig compiles the simulation layer (`tsconfig.worker.json`, typecheck exit 0); contract ownership in `src/core/contracts.d.ts`. |
| 7 | Prescribed directory layout (`src/{core,workers,probability,simulation,world,npc,economy,gameplay,social,life,persistence,data,scenes,ui}`, `main.ts`, `tests/`) | PARTIAL | all prescribed top-level folders/files exist; **minor deviations:** `SimulationScheduler` lives in `src/simulation/` (not `core/`); festivals are inside `src/data/events/events.ts` (no `data/festivals/`); extra files added (e.g. `core/GameLogger.ts`, `social/config.ts`). No responsibility overlap found. |
| 8 | Shared types: `WorldState`/`NPCState`/`PlayerState` incl. `CigaretteCondition`/`WorldEvent`; global unique ids, unified time, integer money, item/NPC/location/event ids, serialisable, versioned saves | IMPLEMENTED | frozen `src/core/contracts.d.ts` (GameState root, `CigaretteCondition`, `WorldEvent`, `NPCDef`, `SaveEnvelope.version`); canonical id tables `src/data/{items,locations,npcs,shops}/ids.ts`; integer pence money (`src/core/SharedTypes.ts`, `TransactionSystem`); content validation at boot `src/core/ContentRegistry.ts`; tests `tests/contracts/contractCompliance.test.ts:44-139`. |
| 8.5 | Data rules: id uniqueness, agreed time unit, integer money, item/NPC/location/event id references, two-sided relationship ids, serialisable important data, save version | IMPLEMENTED | `ContentRegistry.validate()` checks duplicate ids/unknown references (`docs/DATA_SCHEMA.md:68-71`; no errors at boot); relationship records keyed by counterpart id; whole GameState serialised by SaveManager; `WORLD_CONFIG.saveVersion` (`src/core/WorldConfig.ts:8`). |

---

# 4. Part 5 - unified Probability Engine (sections 9-15)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 9 | One engine; no `Math.random()` in gameplay; no unrecorded randomness deciding outcomes | IMPLEMENTED | `src/probability/ProbabilityEngine.ts`; 0 `Math.random` call sites in `src/`; ESLint `no-restricted-properties` (`eslint.config.js:12-18`); static-scan test `tests/contracts/contractCompliance.test.ts:201`; all 31 streams persisted. |
| 10 | Life seed derives independent streams; adding draws in one stream must not perturb others; stream state syncs main/worker and is saved | IMPLEMENTED | SplitMix64+Xoshiro128** (`src/probability/RandomProvider.ts:5-6,58,155,204`); per-stream derivation `src/probability/SeedManager.ts:5-16,51-61`; 4x uint32 persisted state `src/probability/RandomStream.ts`, `ProbabilityEngine.ts:159-169`; independence tests `tests/probability/streamIndependence.test.ts`, `tests/probability/determinism.test.ts`. |
| 11 | Decision structure records context, candidates (base weight/conditions/modifiers/result), selected option, total weight, timestamp, stream, decision id | IMPLEMENTED | contract records `src/core/contracts.d.ts` (`ProbabilityRequest/ProbabilityDecision`) + engine extensions `src/probability/types.ts:27-46`; recorded in `ProbabilityEngine.ts:341-449,499-513`; tests `tests/probability/contract.test.ts`, `fuzz.test.ts`. |
| 12 | 19-step pipeline: snapshot -> candidates -> condition filter -> weight math (env/time/place/personality/skill/relationship/history/state) -> clamp -> normalise -> draw on named stream -> record -> execute -> follow-up events | IMPLEMENTED | engine pipeline `src/probability/ProbabilityEngine.ts:341-449` + `ProbabilityCalculator.ts` (eligibility/weight/clamp/normalise/sample) + `ConditionEvaluator.ts`/`ModifierResolver.ts`; callers execute results and emit follow-up events (e.g. `src/gameplay/EventSystem.ts:206-243,347-350`). |
| 13 | Add/multiply modifiers, weight min/max, forced conditions, cooldowns, unique/mutually-exclusive events, distributions, conditional probability, replay; NaN/zero-total protection | IMPLEMENTED | `ProbabilityCalculator.ts:187-291` (modifier application/clamp); bounds from `WORLD_CONFIG.probability.defaultMinWeight/defaultMaxWeight` (`WorldConfig.ts:143-147`); invalid-weight warnings and deterministic zero-weight fallback (`src/probability/types.ts:16-24`, `tests/probability/weights.test.ts:190,341`, `sampling.test.ts:116-132`); cooldown/unique in `EventSystem.ts:116-120,241-243`; replay `ProbabilityEngine.ts:513`, `tests/probability/replay.test.ts`. |
| 14 | Full probability debugger: seed, stream, decision id/context/candidates/weights/probabilities/result/reason, history, causality; seed replay, decision replay, long-term distribution stats, seed comparison, heatmap, anomaly checks | PARTIAL | engine/API side complete: `previewDecision`, `replayDecision`, `getHistoryDetailed`, causal trace (`src/probability/CausalTrace.ts`), debugger distribution chi-square/heatmap/seed-compare/anomalies (`src/probability/ProbabilityDebugger.ts:337,390,458,578`), tests `tests/probability/debugger.test.ts`, `historyTrace.test.ts`; F12 panel shows seed, stream states, recent decisions and weight bars (`src/ui/ProbabilityDebugUI.ts:48-130`) but **has no controls for replay, seed comparison, heatmap or anomaly views** (they exist only as code/tests). |
| 15 | Probability balance: no unconditional luck inflation, no permanent negative lockout, optional soft protection, rare content needs no pity timer | IMPLEMENTED | zero-weight/empty-candidate fallback guarantees a result (`src/probability/types.ts:16-24`); critical acquisition path fixed and regression-tested (basic fishing rod starter/shop; `tests/qa/regressions.test.ts` `REGRESSION-5`); event weights bounded and cooldown/unique guarded; no pity-timer or difficulty system found. Soft-protection tuning is optional by spec and is not implemented as a separate mechanism. |

---

# 5. Part 6 - world simulation, worker, scheduler, offline (sections 16-19)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 16 | Three simulation tiers: Active (main thread), Background (Web Worker), Offline (Web Worker); immutable snapshots/messages; no per-frame offline stepping | PARTIAL | Active tier: fixed 0.25 s runtime update (`src/core/Game.ts:218-237`, `WorldConfig.ts:98-103`), all 17 systems updated every tick; Offline tier: worker path `src/workers/simulation.worker.ts:28-69` + `SimulationRuntime.ts:236-293` with adaptive bucketing; **Background (LOD2) is not scheduled by the game loop**: `WorkerBridge.requestBackground` and the worker's `background` handler exist (`src/workers/simulation.worker.ts:71-94`, `WorkerBridge.ts`), but `Game.ts` never calls it (no `requestBackground` reference outside the bridge); `src/simulation/BackgroundSimulation.ts` is unused by `Game.ts`/`main.ts`. The world still advances because the main-thread runtime simulates all 56 NPCs every tick. |
| 17 | Unified SimulationScheduler with per-system cadence managed by config; do not bind all systems to Phaser per-frame update | PARTIAL | fixed-step active accumulator (`src/simulation/SimulationScheduler.ts`, `Game.ts:218-237`); per-system intervals centralised (`WorldConfig.ts:97-109`: economy 60 game-min, environment 15, events 30, background NPC 10) and each system self-gates; **deviation:** no worker/main-thread split by system as in the spec table (see §16). |
| 18 | Offline pipeline: duration from save timestamp -> worker snapshot -> stepped simulation -> NPC/economy/farm/events updates -> atomic IndexedDB commit -> summary; handles long absence, clock anomalies, sleep, duplicate calc, interrupted save, many NPCs, event piling, offline trades/relationships | PARTIAL | full pipeline in `Game.ts:305-397` + `SimulationRuntime.runOffline`; duration cap 14 game days and `<45 s`/`<120 s` skips (`Game.ts:308-316`); adaptive buckets by real hours (<1 h -> 5 game-min, 1-24 h -> 30 min, >24 h -> daily; `SimulationRuntime.ts:248-263`, `WorldConfig.ts:103`); idempotency lock on `lastProcessedSimTime` (`Game.ts:369-382`); offline flag makes burn 0.35x (`CigarettePhysicsSystem.ts:287-288,326-328`); big-dt safe and bounded logs (QA 24 h/72 h/14 d). **Missing facet:** the settled result is applied in memory and only persisted by the next autosave/manual save (`Game.ts:383-396`; no `save()` inside `applyOfflineResult`), i.e. no immediate atomic IndexedDB commit of the offline settlement as §18/§60 require. |
| 19 | Offline summary: time away, world changes, important NPC stories, shop/economy/facility changes, special events, letters, new history; only meaningful items; important entries clickable for detail | PARTIAL | `OfflineSummaryBuilder` compares a captured baseline and emits real changes/highlights/important NPCs, 60-change cap, 8 NPC updates (`src/simulation/OfflineSummaryBuilder.ts:37,96-311`); modal UI `src/ui/screens.ts:365-400`, `UIManager.ts:206-209,510-519`; honesty covered by `tests/simulation/simulationCore.test.ts:111-141`, `tests/qa/offlineCatchup.test.ts:98-104`; **missing facet:** summary entries are rendered as plain text with no per-entry detail click-through ("must be able to click important events to view details"). |

---

# 6. Part 7 - NPC autonomous life (sections 20-25)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 20 | >=12 major NPCs with full profiles + enough residents; each has name/age/personality/appearance/occupation/money/home/family/interests/needs/emotions/goals/friends/colleagues/memories/habits/life history | IMPLEMENTED | 56 NPCs = 14 major + 42 residents (`src/data/npcs/ids.ts:14-31`, `tests/npc/data.test.ts:43-48`); profile fields `src/data/schema.ts:518-534`; family relationships seeded as `status:'family'` (`src/data/npcs/npcs.ts:471,677,1188,1284`); needs/emotions/memories/goals/schedule/activity history in `NPCState`. **Note:** "colleagues" is not a first-class link (derived from shared `workLocationId`); habits are schedule templates, not a separate habit list. |
| 21 | 12 personality dimensions; influence behaviour weights only, never absolute | IMPLEMENTED | 12 trait keys `src/npc/NPC.ts:504-520`; scoring multipliers `src/npc/PersonalitySystem.ts:114,244` + `NPCDecisionEngine.ts:4-8,141-181`; traits never directly set an action; tests `tests/npc/personality.test.ts`. |
| 22 | 9 needs (hunger, energy, social, fun, safety, belonging, money, work, personal goal); affect behaviour; no fixed-timer identical actions | IMPLEMENTED | 9 decay rates `WorldConfig.ts:47-59`; decay/urgency/activity completion `src/npc/NeedSystem.ts:40,116`; utility scoring consumes needs (`NPCDecisionEngine.ts:141-233`); 11 distinct activities observed per seed over 30 days, not a fixed loop (`tests/qa/worldStability.test.ts:94-135`). |
| 23 | Candidate behaviours incl. work/home/sleep/eat/shop/walk/read/fish/plant/visit friend/cafe/date/attend event/travel/rest/look for work/errands; chosen by conditions + probability | IMPLEMENTED | decision catalogue `ACTIVITIES`/`DECISION_ACTIVITIES` (`src/npc/NPC.ts:380-486`: work, sleep, go_home, eat, shop, stroll, read, fish, garden, visit_friend, go_cafe, date, attend_event, rest, personal_errand, look_for_work, travel); weighted via `npc.behavior` (`NPCDecisionEngine.ts:36,176-214`); schedules add adherence (`src/npc/ScheduleSystem.ts`). |
| 24 | NPC social life: make friends, grow close, quarrel, reconcile, co-operate, romance, break up, parties, help each other, exchange items, run business together; every change leaves memory/history | PARTIAL | friends/rivals/dating/partners/breakups and memory/history: `src/npc/SocialSimulation.ts`, `RelationshipSystem.ts`, `MemorySystem.ts`, `npc.social` stream; NPC-initiated invitations `src/social/InvitationSystem.ts`; tested `tests/npc/social.test.ts`, `tests/social/*`. **Missing:** NPC-to-NPC item exchange and jointly-operated businesses. |
| 25 | Short-term and long-term memory; exponential decay; important memories never disappear | IMPLEMENTED | Ebbinghaus decay `S = I0*exp(-lambda*days)` (`src/npc/MemorySystem.ts:37-45`); importance >=80 permanent, short-term threshold 5 (`MemorySystem.ts:60-103,178-196`, `WorldConfig.ts:120-128`); tests `tests/npc/memory.test.ts:31,74-76,125`. |

---

# 7. Part 8 - complete gameplay + cigarette mechanics (sections 26-42)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 26 | Farming/gardening: till, clear weeds, plant, water, fertilise (own ash potash boosts quality), harvest, flowers, fruit trees, greenhouse, soil improvement, garden, sell/use crops; crop stages/time/water/temp/season/soil/quality/disease/harvest; quality from skill/soil/weather/seed/fertiliser; offline growth | PARTIAL | 19 crops incl. flowers + 4 fruit trees (`src/data/crops/crops.ts`, `tests/gameplay/nature_data.test.ts:98,163`); plot stages/fertility/potash/disease/moisture `src/gameplay/FarmingSystem.ts:36-79,131-297`; ash potash +25% quality `FarmingSystem.ts:254-289`, `WorldConfig.ts:80-89`; greenhouse bypass/plots `FarmingSystem.ts:384`, tests `nature_farming.test.ts:176-180`; offline-safe growth `tests/qa/regressions.test.ts:19-...` (`REGRESSION-1a`). **Missing facet:** weed spawning/clearing - `weedSpawnPerHour` exists in config (`WorldConfig.ts:87`) but is referenced nowhere in `src/`; `farm:clear` only clears dead/withered plots. |
| 27 | Fishing: rod, bait, water/time, cast, wait, bite, reel, catch, sell, collect, study fish; influenced by place/season/time/weather/water/stock/rod/bait/skill; per-water distribution | PARTIAL | 16 fish with habitats/seasons/hours/weather/bait tags (`src/data/fish/fish.ts`, `tests/gameplay/nature_data.test.ts:175-220`); cast->wait->bite->tension minigame->catch with size/quality/records (`src/gameplay/FishingSystem.ts:96-330`), tests `nature_fishing.test.ts`; rod tiers + bait consumption (`FishingSystem.ts:111-165,363-410`); sell/collection via shops/collection. **Missing facet:** no "research/study fish" mechanic (only collection registration + book). |
| 28 | Foraging: mushrooms, berries, flowers, grass, wood, stone, ore, insects, feathers, special resources; result depends on place/season/weather/skill/resource recovery | IMPLEMENTED | 46 seasonal nodes with respawn/skill/yield (`src/data/fish/fish.ts` FORAGE_NODES, counted 46); item ids cover mushrooms/berries/herbs/wood/stone/ores/insects/feathers/resin/keys (`src/data/items/nature.ts`); `src/gameplay/ForagingSystem.ts`; tests `nature_foraging.test.ts`, `REGRESSION-1b` respawn. |
| 29 | Exploration: forest/ruins/hidden paths/history clues/rare items/secret places/photos/unlock areas; may find nothing; skill/clue/environment raise odds | PARTIAL | probabilistic search, clues, photos, secret unlock, "nothing" outcome (`src/gameplay/ExplorationSystem.ts:142-...`, `:274-277`, `:448-456`; `GameAction` `explore:search/unlock/photo` `contracts.d.ts:1670-1672`); tests `nature_exploration.test.ts`; 5 secret locations. **Missing facet:** no wildlife encounters. |
| 30 | Crafting: tools/furniture/decor/farm/fishing/cooking/collectibles/gifts/cigarette protection gear/ash by-products; recipes/materials/tools/workbench/time/skill requirements | IMPLEMENTED | 100 recipes = 69 craft (workbench 64, art_studio 5) + 31 cook (kitchen 28, campfire 3) measured; stations/skill gates/timed jobs/quality `src/gameplay/CraftingSystem.ts`; protection gear + ash chain items `src/data/items/life.ts`, tags `cigarette/protection/rain/wind/moisture/ash/pigment/fertiliser`; tests `craft_crafting.test.ts`, `craft_data.test.ts`, `craft_integration.test.ts`. |
| 31 | Cooking: buy/gather/grow ingredients, unlock recipes, cook food/drinks, host a meal, gift food; effects on energy/mood/skill efficiency/relationships/special activities | PARTIAL | 31 cook recipes; quality/freshness/nutrition/buffs applied (`src/gameplay/CookingSystem.ts:325-330`); buffs for energy/mood/skill/social/influence (`src/ui/model.ts` buff display; `craft_cooking.test.ts:167-194`); gifting any food works via `GiftSystem`; "meal" invite with an NPC exists (`src/social/InvitationSystem.ts:30-40,179`). **Missing facet:** no player-hosted dinner-party action. |
| 32 | Housing/building: buy residence, expand, rooms, floors/wallpaper, furniture placement, decorate, storage, farm facilities, garden, greenhouse, outdoor remodelling; free placement persisted | PARTIAL | 17 blueprints incl. rooms/greenhouses/farm shed/garden/shop fittings (`src/data/blueprints/blueprints.ts`, measured 17); grid placement + AABB + door-reachability BFS + rotation/paint/floor/storage (`src/gameplay/HousingSystem.ts:25-29,218-220,581-620`), tests `housing_placement.test.ts` (22 tests); building projects/effects `BuildingSystem.ts`. **Missing facet:** no "buy a residence" flow - the player has exactly one home (`home_player`); see `tests/gameplay/housing_placement.test.ts:281`. |
| 33 | Business: run shop/cafe/small farm/florist/craft shop; sell collectibles; set prices; buy stock; manage inventory; hire staff; design shop; build supplier relationships; customer purchase depends on price/goods/money/reputation/place/need/competition | PARTIAL | 22 businesses / 17 types, incl. cafe, farm, florist; player can buy any business, open/close, set prices, wholesale-restock, hire/fire, daily reports (`src/economy/PlayerShopSystem.ts:55,201-220`; `GameAction` `shop:*`; tests `tests/economy/player_shop.test.ts`); NPC businesses have `supplierBusinessId` restock chains (`src/data/shops/shops.ts:57-746`, `schema.ts:482`, `BusinessSystem.ts`); shop design via blueprints (counter/shelves/sign). **Missing facets:** no dedicated craft-shop business type; no player-built supply relationships (wholesale order only); collectible selling through the shop is generic item selling. |
| 34 | Career choice: farm/store/cafe/bakery/library/museum/office/art/freelance/self-employment; career must not lock other gameplay | PARTIAL | 50 job seeds / 40+ titles across the 22 businesses (measured), incl. farmhand, barista, baker, bookseller, librarian, curator, projectionist; apply/shift/quit and wages with tax (`src/economy/EmploymentSystem.ts`; `GameAction` `work:*`; tests `employment.test.ts`); self-employment via player shop; no career lock-out (no gating code). **Missing facets:** no city-office career, no art/freelance job line (art exists as skill/crafting only). |
| 35 | Shopping: food/furniture/clothing/tools/seeds/bait/decor/gifts/books/electronics/collectibles/cigarette care; dynamic stock and prices | IMPLEMENTED | 22 shops stock these categories (`src/data/shops/shops.ts`); 234 items incl. 14 cigarette-care/ash items and clothing/electronics/collectibles (`src/data/items/ids.ts`); prices from supply/demand clamped 0.4-2.5x (`src/economy/PriceSystem.ts:48-68`); buy/sell actions + tests `tests/economy/transaction.test.ts`, `price_market.test.ts`; bait via insect items tagged `bait` consumable in `FishingSystem.ts:363-374`. |
| 36 | Social: greet, talk, chat, gift, help, invite/accept/decline, parties, dates, become friends, intimacy; NPCs have their own will | IMPLEMENTED | all actions in `GameAction` `social:*`/`dialogue:*` (`contracts.d.ts:1695-1707`) and routed to `src/social/{SocialSystem,DialogueSystem,GiftSystem,InvitationSystem,FriendshipSystem,RomanceSystem}.ts`; NPC refusals/cooldowns `InvitationSystem.ts`, `RomanceSystem.ts:137-224`; tests `tests/social/` (125 cases). Parties exist as NPC/festival invitations rather than a player-hosted party (minor). |
| 37 | Romance: acquaintance -> affection -> dates -> relationship -> romance events -> gifts -> special dialogue -> maintenance -> conflict -> reconciliation -> breakup; partner determined by personality/preference/life state/relationship; not every NPC romanceable | IMPLEMENTED | romanceable flags in data (`tests/npc/data.test.ts:219-221`, fewer than majors); confession chance from affinity/trust/intimacy/personality (`src/social/RomanceSystem.ts:96-118`), rejection/cooldown/date/drift/breakup (`RomanceSystem.ts:118-432`); conditional romance dialogue `src/data/dialogue/dialogue.ts`; tests `tests/social/romance.test.ts` (18). |
| 38 | Leisure: reading, cinema, walking, fishing, park rest, photos, painting, music, performances, games, museum visits; player may do nothing productive | PARTIAL | reading (books/skill), walking/wandering, fishing, rest/park, photos, museum/collection, art crafting and festival music/fishing-contest participation all exist (`GameAction`, `EventSystem.ts:456-501`, `ExplorationSystem` photos, `CraftingSystem` art recipes, `BaseWorldScene.ts:494-534`); **Missing facets:** no watch-a-film action (cinema facility opens the Events panel, `src/render/layout.ts:265`), no dedicated painting/music-performance leisure action outside festivals/crafting, no general games/minigames beyond fishing. |
| 39 | Collections: fish/insects/minerals/flowers/plants/recipes/photos/letters/special items/festival items/life mementos; museum display | PARTIAL | 10 categories: fish, insects, minerals, flowers, plants, food, recipes, photographs, festival, mementos (`src/data/collection/categories.ts`, measured 10); auto-register on acquisition + museum donation `src/gameplay/CollectionSystem.ts:61-141`; museum UI `CollectionUI.ts`; tests `craft_collection.test.ts`. **Missing facets:** no "letters" or distinct "special items" categories (letters live in the life archive, mementos cover legacy items; food is an extra category). |
| 40 | Cigarette-specific survival/physics: lengthRatio burns over life/exertion; rain/humidity -> moisture (slows movement, blocks heavy work, needs shelter/umbrella/case); wind -> faster burn (needs cover/wind gear); dry/indoor recovery; ash as real resource (potash/pigment/crafts); heat sources/items dry you | IMPLEMENTED | full model `src/life/CigarettePhysicsSystem.ts:242-310` (moisture integration, wind/exertion/weather/moisture burn, offline x0.35, ash gain, life-end flag), :366-391 equipment protection, :393-447 microclimate/rain/wind/drying, :190-208 damp slowdown + soaked block; collectable ash item + fertiliser/pigment/glaze recipes (`src/data/items/life.ts`, `src/data/recipes/recipes.ts`); warm-up action/sources `src/life/LifeSystem.ts:261-306`, `Game.ts:732-734`; tests `tests/life/physics.test.ts` (18), `ash.test.ts` (7), `tests/qa/regressions.test.ts` (burn multiplier). |
| 41 | Festivals: spring flowers, summer market, autumn harvest, winter lights, community gathering, music, fishing contest, produce show, art exhibition, city culture; NPCs decide attendance by schedule/interest | IMPLEMENTED | 10 festivals matching the list (`src/data/events/events.ts` FESTIVALS, measured 10; names verified: Spring Flower Festival, Summer Market, Harvest Festival, Winter Lights, Community Gathering, Music Evening, Fishing Contest, Produce Show, Art Exhibition, City Culture Day); activities + skill/probability rewards + influence `EventSystem.ts:456-501,509-527`; NPC `attend_event` decision activity (`src/npc/NPC.ts:380-486`) and 30-day runs record `attend_event`; tests `tests/events/eventSystem.test.ts` (festival activate/participate). |
| 42 | Personal goals / free life: several life paths; nothing is mandatory; not forced into a main questline | IMPLEMENTED | 20 goals incl. gardener, angler, collector, merchant, artisan, community pillar, wanderer, socialite, romantic, shop owner, hermit, folk hero (`src/data/goals/goals.ts`, measured 20); goal choice/progress/completion `src/life/LifeSystem.ts:334-364,575-587`; no mandatory quest system; tests `tests/life/goals.test.ts`. |

---

# 8. Part 9 - special resident & influence (sections 43-44)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 43 | Special-resident participation: community building, public activities, business development, social projects, city activities, community discussion, special opportunities | IMPLEMENTED | 8 community proposals with voting/construction/completion (`src/data/community/community.ts`, `src/social/CommunitySystem.ts:39-314`; tests `tests/social/community.test.ts`); festival participation; player shop/business; influence tier ladder; player opportunities stream used for friend letters (`src/life/LifeSystem.ts:591-610`). |
| 44 | Influence from community contribution, relationships, business performance, public events, resident trust, cultural contribution, long-term involvement; raises proposal odds but cannot force acceptance | PARTIAL | influence score + tiers + spend + signals `src/life/InfluenceSystem.ts:53-134`; proposal support depends on personality/relationship/influence (`src/social/CommunitySystem.ts:195-231`), rejection possible; sources found: achievements, community project completion, buildings, museum donation, festival activity, events (`AchievementSystem.ts:133`, `BuildingSystem.ts:377`, `CollectionSystem.ts:128`, `EventSystem.ts:492-501`). **Missing facets:** influence is not gained directly from relationships, business performance (beyond achievements) or a dedicated long-term-participation metric. |

---

# 9. Part 10 - events and causality (sections 45-47)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 45 | Unified EventSystem; each event has id/type/trigger conditions/probability/time/location/participants/result/aftermath/cooldown/uniqueness/cause | IMPLEMENTED | 33 authored events with conditions/weights/cooldowns/uniqueness/effects (`src/data/events/events.ts`; event effect kinds in `src/data/schema.ts` EventDef/EventEffect); `WorldEvent` records participants/cause/result/importance/timestamps (`src/core/contracts.d.ts`); occurrence via category->event weighting + conditions (`src/gameplay/EventSystem.ts:89-120`); history/caps `EventSystem.ts:206-243,334`. |
| 46 | Initial category weights reference: ordinary 45%, interesting 25%, lucky 15%, unlucky 10%, special 5% | IMPLEMENTED | defaults set exactly in `src/core/WorldFactory.ts:403` and consumed by `EventSystem.ts:89-102`; authored distribution 11/8/6/5/3 (33 events). |
| 47 | Causal chains: an event really changes state and produces follow-ups (e.g. help -> memory -> trust -> contact -> new relationship -> invite -> history); no text-only events | IMPLEMENTED | event effects mutate relationship/money/item/mood/flags/weather and can chain (`EventSystem.ts:206-243,347-350`); `cause`/`sourceEventId` recorded on `WorldEvent`; decision-level causal parent/source ids `ProbabilityEngine.ts` + `CausalTrace.ts`; NPC memory/relationship follow-ups via social systems; tests `tests/events/eventSystem.test.ts`, `tests/probability/historyTrace.test.ts`. |

---

# 10. Part 11 - natural economy & society (sections 48-50)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 48 | Economy: supply, demand, price, stock, shop profit, NPC income/spending, wages, jobs, transport cost, competition, seasonal supply/demand, special market events | PARTIAL | supply/demand mean-reverting model `src/economy/SupplyDemandSystem.ts:16-95`; elastic prices clamped to [0.4, 2.5]x base (`PriceSystem.ts:48-68`, `WorldConfig.ts:66-72`); stock/restock/settlements/`business.history`; NPC wages+tax and budgets; jobs; seasonal factor; quiet competition via markup/reputation/location. **Missing facets:** no transport/freight cost model and no dedicated "special market event" effects (events are generic world events; no explicit price-shock behaviour found). |
| 49 | Shops keep operating offline: owner, staff, hours, stock, suppliers, customers, prices, income, expenses, business history; periodic settlement while away | IMPLEMENTED | 22 businesses with owner/employees/hours/stock/money/reputation/supplierBusinessId (`src/data/shops/shops.ts`); customers simulated from real NPC budgets (`BusinessSystem.ts:115-116,322-399`); hourly market + daily business settlement idempotent by absolute sim time (`EconomyHelpers.ts`, `tests/economy/market_stability.test.ts:152-166`); offline settlement runs through the same systems during catch-up (`tests/qa/offlineCatchup.test.ts`, `tests/qa/economyIntegrity.test.ts`). |
| 50 | NPCs have their own money and economic pressure; cannot spend infinitely or gain money unconditionally; purchases depend on budget/needs/personality/price/stock/goals | IMPLEMENTED | NPC money, wages/tax, living reserve and max budget share (`WorldConfig.ts:60-65`, `EconomyHelpers.ts`); buyer weighting + affordability checks `BusinessSystem.ts:322-341,348-399`; non-negative checks in QA (`tests/qa/worldStability.test.ts:69-92`); determinism of economy slice tested. |

---

# 11. Part 12 - life, collection, inheritance (sections 51-53)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 51 | Every life archived independently with start/end time, residence, occupation, skills, money, collections, important people, social relationships, business history, important events, photos, letters, influenced NPCs, world changes, life choices | PARTIAL | `ArchivedLife` fields (`src/core/contracts.d.ts:924-946`): lifeId/generation/name/startedAt/endedAt/duration/endReason/residenceName/occupation/skills/finalMoney/collections/importantPeople/businessHistory/archive/photos/letters/worldChanges/choices/legacyItemIds/statistics; persisted to IndexedDB archive store (`SaveManager.ts:252-268`); `LifeArchiveSystem` builds from real events. **Missing facets:** no full social-relationship snapshot (only importantPeople with status/affinity) and no explicit "influenced NPCs" list; choices are derived from archive 'choice' entries + goal, not a first-class log. |
| 52 | On burn-out generate a truthful review from real records (trajectory, friends, experiences, collection, business, exploration, choices, world impact); never invent experiences | IMPLEMENTED | triggered when `lengthRatio <= 0` (`CigarettePhysicsSystem.ts:302` -> `LifeSystem` end; `Game.ts:239-247`); review from real archive/statistics/relationships/world changes (`src/life/GenerationSystem.ts:142-193`; `src/life/LifeArchiveSystem.ts:18-19` "every entry is derived from an event that really happened"); truthfulness asserted `tests/qa/worldStability.test.ts:137-156`, `tests/life/legacy.test.ts:72-84`; review UI `src/scenes/LifeEndScene.ts:58,201-204`, `showLifeReview`. |
| 53 | Multi-generation: inherit archive/photos/letters/collection records/titles/museum exhibits/some decorations/world history/mementos (incl. custom filter stub); each life saved independently; no unconditional inheritance of all resources; world history continues | PARTIAL | `startNextLife` preserves world/NPC/economy/archive/collection/housing/flags, resets player, max 3 legacy mementos (`Game.ts:417-460`; `GenerationSystem.ts:23-26,199-271`; `WorldConfig.ts:152`); different seed per generation but continuous clock (`Game.ts:421-448`); tests `tests/life/legacy.test.ts` (5), `tests/scenarios/fullPlayerLifecycle.test.ts:301-325`. **Missing facets:** no "special titles" inheritance; housing/furniture and collection are carried over wholesale rather than "partial decorations", which is a permissive reading of the spec's "不能无条件继承全部资源". |

---

# 12. Part 13 - UI, art, audio (sections 54-57)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 54 | Main UI: real world first, not a management menu; HUD shows remaining life + cigarette-length thumbnail, physical-state icons (dry/damp/shelter), time/season/weather/wind, money, location, state; main interfaces: inventory, life, map, social, skills, collection, shop, building, events, life archive, settings | IMPLEMENTED | HUD model contains length %, clock, season, weather+wind arrow, money, location, damp/soaked/burn/ash/wind badges (`src/ui/model.ts:468-618,688-702`), rendered in `src/ui/HUD.ts`; 18 panel ids = HUD + 17 panels (`src/ui/Panels.ts:36-173`, `src/ui/UIInterfaces.ts:14-30`): inventory, map, social, skills, journal, events, shop, building, housing, collection, archive, settings, life, dialogue, fishing, probability, help - all requested interfaces present and data-driven; scene facilities open the relevant panel (`src/scenes/BaseWorldScene.ts:494-534`, `src/render/layout.ts:246-267`). |
| 55 | Controls: WASD/arrows, E interact, Space confirm/use, ESC menu, I inventory, M map, J events+log, mouse UI; key rebinding | PARTIAL | scene input WASD/arrows/E/Space (`src/scenes/BaseWorldScene.ts:209,891`); ESC/I/M/J/panel mouse UI (`src/ui/UIManager.ts:58,760-831`); all panel shortcuts rebindable via Settings -> Controls (`src/ui/SettingsUI.ts:184-203`, `src/ui/model.ts:109-146`) and J opens the Journal (world history/log, `src/ui/HelpUI.ts:16`); **deviation:** only UI panel shortcuts are rebindable - the scene movement/interact keys are fixed (`SettingsUI.ts:213-220`), so "must support key rebinding" is only partially satisfied. |
| 56 | Character animations: idle (ember+smoke), walk, run, sit, sleep, talk, happy, sad, surprised, damp shiver/droop, use tool, fishing, planting, harvesting, life-end smoke/filter animation | PARTIAL | player render: dynamic shortening from lengthRatio, tinted paper/filter, face glyph by state (moisture/length/appearance), ember glow/flicker, wind-driven smoke/steam, sparks, umbrella/hat/case overlays, walk stride (`src/scenes/controllers/PlayerSpriteController.ts:27-31,90-91,133-178,201-273`), `src/render/figures.ts:124-151,232-239`; life-end scene/extinguish animation `src/scenes/LifeEndScene.ts`, `src/render/effects.ts`; NPC poses sit/sleep/work/fish/eat/talk/read (`src/render/figures.ts:124-137`). **Missing facets:** no player run/sit/sleep/use-tool/planting/harvesting animation states; damp expression is a static face variant, not a shiver animation. |
| 57 | Scene presentation: day/night, weather effects, rain/snow, fog, wind (leaves/smoke), seasons, lighting, indoor-outdoor, NPC expressions, ambient animation, scene SFX | IMPLEMENTED | day-night palette wash + sun/moon/clouds/stars + rain/snow/fog/wind-dust pools + seasonal ambient + indoor light and tint `src/scenes/controllers/WeatherFXController.ts:56-59,218-378`; daylight model `src/world/EnvironmentSystem.ts:54-162`; NPC emotion bubbles `src/scenes/controllers/NPCSpriteController.ts:9,143-159`; procedural ambience/music/17 SFX `src/audio/AudioManager.ts:38-51,103-242,270-294`; wired in `src/main.ts:54-122`. |

---

# 13. Part 14 - save/data safety (sections 58-60)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 58 | IndexedDB required; must not rely only on localStorage for the whole save | IMPLEMENTED | `src/persistence/IndexedDBStorage.ts:64-73` (meta/saves/archive object stores, readwrite transactions); no `localStorage` in `src/`; transparent `MemorySaveStorage` fallback in private mode/Node (`SaveManager.ts:61-68`). |
| 59 | Save at least: world/life id, life seed, stream states, world time, life time + cigarette physics (length/moisture/ash), season, weather, map state, NPCs/relationships/memories, economy, shop stock, player assets, skills, crops, buildings, furniture, event history, causal records, life archive, world history, last save time | IMPLEMENTED | whole `GameState` is serialised (`SaveManager.buildEnvelope`, `contracts.d.ts GameState`): clock, meta seed, probability stream states, world (weather/season/locations/history/events), npcs, player.cigarette/inventory/skills, economy, farming, building, housing, archive; envelope carries version/checksum/savedAtRealMs/lastProcessedSimTime (`SaveManager.ts:94-102`). **Note:** decision history is trimmed to 400 records on save as a size strategy (`SaveManager.ts:116-120`), so older causal audit records do not survive a save (documented in `INTEGRATION_STATUS.md`). |
| 60 | Save protection: autosave, manual save, versioning, migration, backup, crash recovery, integrity checks, IndexedDB readwrite transactions, duplicate-settlement prevention (idempotent timestamp + transaction lock), multiple independent life saves | PARTIAL | autosave >=30 s (`Game.ts:229-235`), manual `save`; version + migration `src/persistence/SaveMigration.ts` (`WORLD_CONFIG.saveVersion=1`); ping-pong A/B slots with FNV-1a checksum fallback and "both slots corrupt" error (`SaveManager.ts:144-177`, `ChecksumUtil.ts`, tests `tests/persistence/saveManager.test.ts`, `tests/qa/saveCorruption.test.ts`); export/import + backup bundle (`SaveManager.ts:196-250`); atomic write transaction (`IndexedDBStorage.ts:97-104`); offline idempotency lock (`Game.ts:369-382`); multiple slots via `slotId` + archive store. **Missing facet:** offline settlement is not committed in the same transaction as the catch-up (only applied in memory; next autosave persists - see §18), so the strict "atomic commit of the offline transaction" wording is not met end-to-end. |

---

# 14. Part 15 - multi-agent development rules (sections 61-70)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 61 | Parallel agents, dependency order, no duplicate core systems, no unauthorised contract edits, no fake completion | IMPLEMENTED (process) | one registration of each system (`SimulationRuntime.ts:116-134`); frozen contracts + `docs/AGENT_TASKS.md` statuses; honest gap list in `INTEGRATION_STATUS.md` G1-G11 (verified largely against code: G4 real). Process claims cannot be re-proved after the fact; deliverables are auditable. |
| 62 | Round 1: architect creates directory, strict `contracts.d.ts`, worker protocol, system registry, event protocol, save protocol, probability API | IMPLEMENTED | `src/core/contracts.d.ts` (frozen, 54 KB), `core/{SystemRegistry,EventBus,GameContext}.ts`, `workers/WorkerProtocol.ts`, `SAVE_SCHEMA.md`, `ProbabilityEngine` interface; subsystem code conforms (contract test). |
| 63 | Round 2: 14 modules in parallel on mocks/interfaces | IMPLEMENTED | all domain folders populated with real implementations; `docs/AGENT_TASKS.md` task map; content pack complete. |
| 64 | Round 3: integrate engine/worker/world/NPC/map/gameplay/economy/social/events/save/UI; QA contract+integration tests; fix contracts rather than hardcode | IMPLEMENTED | `SimulationRuntime` composes 17 systems; `tests/contracts/contractCompliance.test.ts` (11), `tests/integration/fullLifeCycle.test.ts` (8); build succeeds. |
| 65 | Round 4: large multi-seed headless simulation; check behaviour differences, long-term change, shops, NPC society, economy balance, event loops, offline reliability, unrecoverable states | IMPLEMENTED | `tests/qa/worldStability.test.ts` (3 seeds x 30 days: 11 activities, 56/56 histories, ~7,600-7,700 NPC-NPC interactions, price clamps, restock, wages, bounded logs, different seeds differ); `tests/qa/performance.test.ts`; offline stress `tests/qa/offlineCatchup.test.ts` (24 h/72 h/14 d, idempotent). |
| 66 | Round 5: full game acceptance from main menu through a complete life (new life -> explore -> gameplay -> NPC -> relationships -> work/business -> offline -> summary -> life end -> archive -> new life -> inheritance) | PARTIAL | complete life cycle covered headlessly through the real `GameEngine`: `tests/scenarios/fullPlayerLifecycle.test.ts` (2 tests) and `docs/QA_REPORT.md` §"Full player-lifecycle scenario"; browser smoke screenshots exist at repo root (`smoke-*.png`); **missing:** the claimed `docs/ACCEPTANCE_REPORT.md` browser play-through report does not exist, so the last visual/manual step is not evidenced in-tree. |
| 67 | Every agent task brief contains goal/boundaries/interfaces/deps/data/events/save/tests/acceptance | IMPLEMENTED | `docs/prompts/*.md` per domain + `docs/AGENT_TASKS.md` ownership table. |
| 68 | Every agent delivers code, strict types, module interface, module README, data, unit tests, integration notes, known issues, unfinished items | PARTIAL | code/types/tests/data present for all areas; known issues recorded centrally (`INTEGRATION_STATUS.md`, `QA_REPORT.md`); **missing:** per-module README files (only project-level docs). |
| 69 | Conflict handling via architect, contract update + all agents re-run contract tests; no overwriting others' code | IMPLEMENTED (process) | frozen contract file; single-owner folders; `tests/contracts` runs on every suite invocation. Not independently verifiable historically. |
| 70 | Code quality: strict TS, single responsibility, explicit interfaces, no circular deps, no giant classes, no `any`, no unhandled promises, no important state only in UI, no direct mutation of other modules' state, state save/restore | IMPLEMENTED | `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` typecheck clean; ESLint forbids `any` (`eslint.config.js:13-19`) and lint passes; all authoritative state in `GameState` (architecture); some large files exist (data/layout/dialogue) but they are content/render data rather than multi-responsibility classes. |

---

# 15. Part 17 - automated tests (sections 71-76)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 71 | Contract + probability tests: module interfaces vs contract, same seed reproducibility, stream independence, normalisation, conditions, invalid/zero weights, long-run distribution, replayable history, different seeds differ | IMPLEMENTED | `tests/contracts/contractCompliance.test.ts` (11); `tests/probability/` 13 files / 137 cases (determinism, distribution chi-square, stream independence, weights, sampling, conditions, replay, history-trace, fuzz, debugger, registry, random provider); all pass in the 889-test run. |
| 72 | World/Worker tests: worker-main sync/deadlock, world continues after leaving, NPC autonomy, offline time, state not lost, no duplicate settlement, region switch no NPC reset, long offline no crash/stall | PARTIAL | `tests/simulation/simulationCore.test.ts` (snapshots/diff/offline summary), `tests/qa/offlineCatchup.test.ts` (real `GameEngine` 24 h/72 h/14 d, idempotent replay), `tests/qa/worldStability.test.ts`, `tests/social/offline.test.ts`; **gap:** in Node the Worker global is absent, so tests exercise the main-thread fallback; the real postMessage Worker bridge is not covered by vitest (documented G5 in `INTEGRATION_STATUS.md`). |
| 73 | NPC tests: personality differences, daily behaviour, NPC-NPC relationships, important memories, no infinite repetition, work/rest/social conflicts | IMPLEMENTED | `tests/npc/` 9 files / 61 cases: data, needs, personality (80-sample trait effects), memory (decay/permanent/cap), schedule, activity (decision candidates, 56 NPCs), social (grows over days, deterministic), contracts, performance. |
| 74 | Economy tests: supply/demand, prices, stock, NPC money/income, player trade, offline operation, no duplicate settlement, long-term stability | IMPLEMENTED | `tests/economy/` 7 files / 52 cases (transaction atomicity, price/market, market stability 30 days, business simulation, employment, player shop); `tests/qa/economyIntegrity.test.ts` (30-day aggregated run, idempotent player-shop daily settlement); `tests/qa/worldStability.test.ts:69-92`. |
| 75 | Gameplay + cigarette physics tests: length shortening accuracy, rain/wind/shelter/moisture, ash -> farming/crafting linkage, all gameplay systems, inheritance | IMPLEMENTED | `tests/life/physics.test.ts` (18), `ash.test.ts` (7), `archive/achievements/goals/legacy/identity/lifecycle`; `tests/gameplay/` 13 files / 174 cases (farming, fishing, foraging, exploration, crafting, cooking, building, housing, collection, skills, ash fertiliser); `tests/scenarios/fullPlayerLifecycle.test.ts`. |
| 76 | Performance tests: many NPCs, multi-region worker sim, long offline duration with progress, large histories/items, save/IndexedDB performance, map switching, memory usage, stable 60 FPS | PARTIAL | `tests/qa/performance.test.ts` (20k decisions 520 ms, 200k draws 51.4 ms, 56-NPC 30-day 18.7 s, save 20.1 ms/load 8.4 ms, 2.01 MB payload, history trim 800), `tests/npc/performance.test.ts`, but **no automated FPS/memory-leak measurement and no automated IndexedDB benchmark** (MemorySaveStorage in Node); frame rate is only a browser-smoke concern and no browser report is present. |

---

# 16. Part 18 - deliverables and commands (sections 77-78)

| § | Requirement | Status | Evidence |
|---|---|---|---|
| 77 | Required files: package.json, tsconfigs, vite/vitest config, index.html, README, ARCHITECTURE/API_CONTRACTS/DATA_SCHEMA/EVENT_SCHEMA/SAVE_SCHEMA/PROBABILITY_ENGINE/WORLD_SIMULATION/NPC_SYSTEM/GAMEPLAY_SYSTEMS/AGENT_TASKS/TEST_REPORT, public/assets, complete src tree, tests | PARTIAL | all files present except **`docs/TEST_REPORT.md`** (referenced as completed in `docs/AGENT_TASKS.md:6,14,29,127`, `docs/INTEGRATION_STATUS.md:6,40-41,...`, `README.md`) and **`docs/ACCEPTANCE_REPORT.md`** (referenced as completed in `docs/AGENT_TASKS.md:28,132`, `docs/INTEGRATION_STATUS.md:476`) - **both missing from disk**, so §77's TEST_REPORT deliverable is unmet and the acceptance evidence is not in-tree; `public/assets/` contains only a README (all art/audio is procedural - an intentional change from the code-artifact asset tree); docs live under `docs/` rather than the project root (README reflects this). |
| 78 | Commands: `npm install`, `npm run dev`, `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck` all defined and actually runnable | IMPLEMENTED | scripts defined `package.json:6-16`; verified: `build` (exit 0), `typecheck` equivalent both tsc projects (exit 0), `lint` (exit 0), `test` (889/889); `dev` uses the standard Vite config and was not started during this audit (no server should be run by an auditor), but the production build and `index.html` are valid. |

---

# 17. Part 19 - FINAL ACCEPTANCE (sections 79-83) - verdicts

## 79. World realism - **PASS** (with the §16 caveat)

| Acceptance question | Answer | Evidence |
|---|---|---|
| Do NPCs continue to live when the player leaves/returns? | **Yes.** The world is not player-gated; all 17 systems update every tick, and offline catch-up advances them. | `Game.ts:218-237`; 30-day unattended runs `tests/qa/worldStability.test.ts:46-135`. |
| Can NPCs make friends by themselves? | **Yes.** NPC-NPC relationships grow, date, become partners, break up with no player. | `src/npc/SocialSimulation.ts`; ~7,600-7,700 interactions per 30-day run; `tests/npc/social.test.ts`; `tests/qa/worldStability.test.ts:108-110`. |
| Can NPCs work autonomously? | **Yes.** `work` is a decision activity with schedule adherence and employment. | `src/npc/NPC.ts:380-486`, `NPCDecisionEngine.ts`; 21 NPCs employed / 13 staffed businesses in the 30-day economy run (`docs/QA_REPORT.md:85-89`, matching `tests/qa/economyIntegrity.test.ts`). |
| Can NPCs spend autonomously? | **Yes.** Real shoppers with budgets/needs buy from stocked shops every settlement. | `BusinessSystem.ts:115-116,322-341`; `tests/economy/business_simulation.test.ts:44`. |
| Do shops run themselves? | **Yes.** Daily settlement, restock, wages, profit history, supplier chain. | `BusinessSystem.ts`, `src/data/shops/shops.ts` supplierBusinessId; `tests/economy/market_stability.test.ts:152-166`. |
| Does the world change over the long term? | **Yes.** 30 days produce 85-117 events, 207-276 history entries, moving prices, new relationships, crops, archives. | `tests/qa/worldStability.test.ts` stdout (117/107/85 events, 276/249/207 history at seeds 101/202/303 in the 04:51 run). |
| Do different seeds give different lives? | **Yes.** Same seed is byte-identical (gameplay fingerprint); seed 999 differs. | `tests/qa/worldStability.test.ts:158-169` (passing); deterministic ids `src/core/utils.ts:67-102`. |

**Caveat:** the spec's requirement that distant-region/background simulation run in a Web Worker is not met - LOD2 is implemented but never scheduled (§16, `docs/INTEGRATION_STATUS.md` G4). The world still lives because one main-thread runtime simulates all 56 NPCs each tick; this is a performance/architecture gap, not a "dead world" failure.

## 80. Probability system - **PASS** (UI depth is the only gap)

| Acceptance question | Answer | Evidence |
|---|---|---|
| Is there only one unified probability engine? | **Yes.** One engine instance in `SimulationRuntime`; no other RNG for game decisions. | `src/simulation/SimulationRuntime.ts:93`; static scan test. |
| Does every uncertain behaviour use the unified interface? | **Yes** for all systems audited (NPC, social, economy, events, fishing, farming, exploration, crafting, cooking, collection, weather, transport, player opportunities, cigarette physics, ash, archive, housing decor, UI cosmetics = 31 streams). | `src/probability/types.ts:86-118`; stream usage grep; `tests/contracts/contractCompliance.test.ts:219-...` asserts streams appear after updates. |
| Can the source of a probability be inspected? | **Yes** - decisions record context, candidates, base/final weights, modifiers, selected option; F12 panel visualises. | `ProbabilityEngine.ts:341-449,499-513`; `src/ui/ProbabilityDebugUI.ts:48-130`. |
| Can random decisions be replayed? | **Yes** at engine level: `replayDecision`, deterministic same-seed reproduction, persisted stream states. | `ProbabilityEngine.ts:159-169,513`; `tests/probability/replay.test.ts`, `determinism.test.ts`. |
| Can causality be tracked? | **Yes** - causal parent/source ids, `CausalTrace`, event `cause`/`sourceEventId`. | `src/probability/CausalTrace.ts`; `src/probability/types.ts:27-46`; `EventSystem.ts:206-243`; `tests/probability/historyTrace.test.ts`. |
| Are there large numbers of stray `Math.random()`? | **No** - 0 call sites in `src/`, ESLint-enforced and test-enforced. | grep; `eslint.config.js:12-18`; `tests/contracts/contractCompliance.test.ts:201`. |
| Are there unexplained random results? | **No known ones** - every decision is recorded with candidates/weights; NPC/QA long runs show no invalid outcome. | 30-day runs + decision counts (~40k/seed) and history; stats/debugger tests. |

**Caveat:** the F12 panel is a viewer (seed/streams/recent decisions/weight bars), not the full toolset in §14 (no in-panel decision replay, seed comparison, heatmap or anomaly views); those exist in `ProbabilityDebugger` and tests only.

## 81. Player freedom & thematic immersion - **PASS**

| Acceptance question | Answer | Evidence |
|---|---|---|
| Can the player skip farming/fishing/business/romance/festivals? | **Yes** - all systems are optional; nothing gates the clock or other systems; the only global pressure is the cigarette burning down. | no mandatory quest/tutorial gate in `Game.ts`; `time:rest` and idle play advance the world (`Game.ts:671`); `tests/qa/worldStability.test.ts` shows a life burning out with zero player actions. |
| Can the player only explore / only decorate / only socialise / do nothing and quietly burn out? | **Yes** - exploration, housing and social are independent actions; a full 14-game-day life can pass with no productive action. | `GameAction` (`contracts.d.ts:1647-1722`) + tests; `WorldConfig.ts:28-46` 336 game-hour lifetime; `tests/qa/worldStability.test.ts:137-156` (unattended burn-out + truthful archive). |
| Is the cigarette physical experience naturally woven into daily life (rain, wind, shortening, ash use)? | **Yes** - moisture/wind/shelter sampled continuously from environment/location microclimate; speed/work penalties; ash collected and used for fertiliser/pigment/glaze; HUD badges and warnings explain it. | `src/life/CigarettePhysicsSystem.ts:190-208,242-310,366-447`; ash recipes in `src/data/recipes/recipes.ts`; HUD `src/ui/model.ts:598-618`; help text `src/ui/HelpUI.ts:140-147`. |

## 82. Offline world - **PARTIAL / PASS with two unproven facets**

Acceptance scenario: offline 24 h, then re-enter; check world time, NPC/shop/crop/economy/event state, life time, no duplicate trades/events, no save corruption, smooth main screen; test longer offline; summary reflects real events.

| Check | Result | Evidence |
|---|---|---|
| World clock correct after absence | **Pass** (fallback path): 24 h real -> 72 game hours; 72 h -> 216; 14 d -> 336 (cap). | `tests/qa/offlineCatchup.test.ts` stdout: 24 h=144 steps/72 h; 72 h=9; 14 d=14 steps/336 h; `SimulationRuntime.ts:248-263`. |
| NPC/shop/crop/economy/event state reasonable | **Pass** in automated runs: state validator passes, shops stocked, wages paid, events/history bounded and consistent. | `tests/qa/offlineCatchup.test.ts:98-104`; `tests/qa/worldStability.test.ts`; `assertStateValid` in `tests/qa/support/qaHarness.ts`. |
| Life time correct | **Pass**: offline burn fraction 0.075 over 24 h (0.35x multiplier), 14 d leaves lengthRatio 0.65 (still alive); state reconciled. | `tests/qa/regressions.test.ts` `REGRESSION-3/-4`; `CigarettePhysicsSystem.ts:287-288`. |
| No duplicate trades/events/settlement | **Pass**: idempotency lock on `lastProcessedSimTime`; immediate second request is a no-op; replay of identical window is byte-identical. | `Game.ts:369-382`; `tests/qa/offlineCatchup.test.ts` ("settles ... idempotently" / "replays an identical offline window deterministically"); `tests/qa/regressions.test.ts` `REGRESSION-2`. |
| No save corruption | **Pass** in unit tests: ping-pong checksum fallback, both-corrupt error, migration, export/import tamper rejection. | `tests/qa/saveCorruption.test.ts` (5), `tests/persistence/saveManager.test.ts` (6). |
| Main screen smooth / no freeze | **Not proven in this audit.** Offline catch-up on the main-thread fallback takes ~1.3-4.3 s in QA (worker is the production path); no browser report exists. | `tests/qa/offlineCatchup.test.ts` timings; worker timeout 60 s (`WorldConfig.ts:104`); missing `docs/ACCEPTANCE_REPORT.md`. |
| Summary reflects real events | **Pass** in tests: summary ids exist in the returned state, durations exact, highlights non-empty. | `tests/qa/offlineCatchup.test.ts`; `src/simulation/OfflineSummaryBuilder.ts`. |

**Verdict: PARTIAL** - all settlement/correctness invariants pass and are proven on the deterministic main-thread path; the real Web Worker path and the observable browser smoothness are not demonstrated by in-tree evidence. The stricter §18 requirement of an atomic IndexedDB commit at offline settlement is also not met (applied in memory, persisted on later save).

## 83. Complete game - **PASS for all 17 listed gameplay families** (sub-feature gaps listed)

All listed gameplay families are reachable from the running game, change real state and are saved:

| Gameplay family | Verdict | Key evidence |
|---|---|---|
| Farming incl. ash improvement | **Pass** (weed spawning/clearing absent - see §26) | `FarmingSystem.ts`; `nature_farming.test.ts` |
| Fishing | **Pass** (no fish "research" - §27) | `FishingSystem.ts`; `nature_fishing.test.ts` |
| Foraging | **Pass** | `ForagingSystem.ts`; `nature_foraging.test.ts` |
| Exploration | **Pass** (no wildlife encounters - §29) | `ExplorationSystem.ts`; `nature_exploration.test.ts` |
| Crafting incl. cigarette protection gear | **Pass** | `CraftingSystem.ts`; 69 craft recipes; `craft_crafting.test.ts` |
| Cooking | **Pass** (no hosted dinner party - §31) | `CookingSystem.ts`; `craft_cooking.test.ts` |
| Building | **Pass** | `BuildingSystem.ts`; 17 blueprints; `craft_building.test.ts` |
| Shopping | **Pass** | `ShopUI`/`EconomySystem`; `transaction.test.ts`, `price_market.test.ts` |
| Jobs | **Pass** (office/art/freelance career lines missing - §34) | `EmploymentSystem.ts`; `employment.test.ts` |
| Running a business | **Pass** (no supply-relationship building - §33) | `PlayerShopSystem.ts`; `player_shop.test.ts` |
| Social | **Pass** | `social/*`; 125 social tests |
| Romance | **Pass** | `RomanceSystem.ts`; `romance.test.ts` |
| Festivals | **Pass** | 10 festivals; `eventSystem.test.ts` |
| Collection | **Pass** (10 categories; no letters/special categories - §39) | `CollectionSystem.ts`; `craft_collection.test.ts` |
| Cigarette physiology & microclimate | **Pass** | `CigarettePhysicsSystem.ts`; `physics.test.ts` (18) |
| Life archive | **Pass** (archive field completeness partial - §51) | `LifeArchiveSystem.ts`, `ArchivedLife`; `archive.test.ts` |
| Multi-generation inheritance | **Pass** | `GenerationSystem.ts`; `legacy.test.ts` (5); `fullPlayerLifecycle.test.ts` |

---

# 18. The 15 spec agent areas - verdict table

| # | Spec area | Verdict | Evidence summary |
|---|---|---|---|
| 0 | Architect: contracts, docs, integration, build | **IMPLEMENTED** | `src/core/contracts.d.ts`; all 15 docs except TEST_REPORT (§77); `SimulationRuntime`; build/typecheck/lint/test green |
| 1 | Probability engine | **IMPLEMENTED** | 31 streams; SplitMix64+Xoshiro128**; conditions/modifiers/history/causality/replay; F12 panel (partial UI per §14) |
| 2 | World simulation / worker / offline | **PARTIAL** | LOD1 + LOD3 worker path implemented; LOD2 never scheduled; worker path untested in Node |
| 3 | NPC autonomous life | **IMPLEMENTED** | 56 NPCs, utility AI + probability, needs/schedules/memories/social life; 30-day multi-seed runs |
| 4 | World, map, weather, transport, history | **IMPLEMENTED** (transport PARTIAL for NPC passengers/events §4.3; map layer model PARTIAL §4.4) | 90 locations, Markov weather, microclimate, 4 train routes, world history |
| 5 | Farming & nature | **PARTIAL** | 19 crops, ash potash, greenhouse, offline growth; weeds absent |
| 6 | Fishing & exploration | **PARTIAL** | 16 fish tension minigame, clues/secrets/photos; no fish research, no wildlife |
| 7 | Crafting & cooking | **IMPLEMENTED** | 100 recipes, stations, timed jobs, quality, protection gear, ash chains |
| 8 | Building & housing | **PARTIAL** | 17 blueprints, grid/AABB/reachability, paint/floor/storage; single fixed home, no residence purchase |
| 9 | Economy & business | **IMPLEMENTED** (transport cost/competition facets partial §48) | 22 businesses, dynamic prices, NPC budgets, wages, player shop |
| 10 | Social & relationship | **IMPLEMENTED** (NPC item exchange/joint business missing) | NPC-NPC + player relationships, dialogue, gifts, invites, romance, community |
| 11 | Events & festivals | **IMPLEMENTED** | 33 events with conditions/cooldowns/unique/chains, 10 festivals, history |
| 12 | Life, cigarette, legacy | **IMPLEMENTED** (titles/archive completeness partial) | physics, 8 skills, goals, influence, achievements, archive, legacy |
| 13 | UI, art, audio | **PARTIAL** | 18 panels/HUD/procedural pixel art/audio; no browser acceptance report; partial animations; only UI keys rebindable; F12 toolset partial |
| 14 | QA, integration, acceptance | **PARTIAL** | 87/889 green, QA/regressions/scenario/performance; missing TEST_REPORT + ACCEPTANCE_REPORT, real-worker test, browser FPS/memory evidence, CI/coverage |

---

# 19. Content inventory (measured)

Counts were measured at audit time by a temporary probe (outside the repo) importing the real
`CONTENT_PACK` from `src/data/index.ts`, then cross-checked against test assertions
(`tests/world/locations.test.ts:67,144`, `tests/contracts/contractCompliance.test.ts:44-139`,
`tests/npc/data.test.ts:43-48`, `tests/gameplay/nature_data.test.ts:98,163,175`,
`tests/gameplay/craft_data.test.ts:97,135-136,206,243`, `tests/social/data.test.ts:178`).

| Content | Count | Notes |
|---|---|---|
| Items | **234** | 14 of the item categories populated; canonical ids `src/data/items/ids.ts` |
| Crops | **19** | incl. sunflower/tulip/rose/lavender (flowers) and apple/pear/plum/cherry (4 fruit trees) |
| Fish | **16** | habitats/seasons/hours/weather/bait tags; junk boot included |
| Forage nodes | **46** | seasonal, respawn hours, skill requirements |
| Recipes | **100** | 69 craft (workbench 64, art_studio 5) + 31 cook (kitchen 28, campfire 3) |
| World events | **33** | ordinary 11 / interesting 8 / lucky 6 / unlucky 5 / special 3 |
| Festivals | **10** | spring 3 / summer 3 / autumn 3 / winter 1 |
| Locations | **90** | 45 exteriors (Willowbrook 25 + Ashford 20) + 45 interiors; 5 secret |
| Train routes | **4** | Willowbrook <-> Ashford local/express |
| Businesses | **22** | 17 business types; 50 job seeds |
| NPCs | **56** | 14 major + 42 residents |
| Dialogue trees | **18** | 314 nodes, 1,135 choices |
| Furniture | **29** | slot types floor/outdoor/surface/wall |
| Blueprints | **17** | rooms, home upgrades, greenhouses, farm/shop facilities |
| Achievements | **37** | 4+ hidden per `tests/life/data.test.ts:206` |
| Player goals | **20** | personal goals |
| Community proposals | **8** | resident-voted projects |
| Collection categories | **10** | fish, insects, minerals, flowers, plants, food, recipes, photographs, festival, mementos |
| Skills | **8** | gardening, fishing, foraging, exploration, crafting, cooking, social, art; max level 20 (`WorldConfig.ts:73-79`) |
| Probability streams | **31** | `src/probability/types.ts:86-118` |
| GameAction variants | 70+ | `src/core/contracts.d.ts:1647-1722`; every variant has a dispatch case `src/core/Game.ts:509-673` |
| UI panels | **18** ids | HUD + 17 panels (`src/ui/Panels.ts:36-173`) |

---

# 20. Honest gaps (ordered by importance) - report to Lead

1. **Missing required deliverable docs:** `docs/TEST_REPORT.md` and
   `docs/ACCEPTANCE_REPORT.md` are marked "Completed" in
   `docs/AGENT_TASKS.md:6,14,28,29,127,132` and referenced by `README.md` and
   `docs/INTEGRATION_STATUS.md:6,40-41,470-476,502`, but **neither file exists**. This is the
   single clearest §77/§66 non-compliance and it blocks independent verification of the
   browser acceptance and of the exact test/build numbers cited by other docs.
2. **LOD2 background simulation is not scheduled** (spec §16 hard requirement, §17 table):
   `WorkerBridge.requestBackground` + worker `background` handler
   (`src/workers/simulation.worker.ts:71-94`) exist and compile, but nothing in
   `src/core/Game.ts`/`src/main.ts` ever calls them; `src/simulation/BackgroundSimulation.ts`
   is unused. Distant-region simulation is not offloaded to a worker during play. The world
   still lives because the main-thread runtime updates all 17 systems/56 NPCs every tick.
3. **Offline settlement is not committed atomically to IndexedDB** (§18/§60):
   `Game.ts:369-397` applies the result in memory only; persistence happens on the next
   autosave (>=30 s) or manual save. Idempotency markers prevent double settlement, but a
   crash/close between settlement and save loses the settled window (recomputed from the old
   save on next load - deterministic, not corrupting, but not the specified atomic commit).
4. **Real Web Worker path has no automated coverage** (§72): Node/vitest has no Worker, so
   all offline tests exercise the main-thread fallback; the postMessage bridge and worker
   message handling are only claimed by browser acceptance - and that report is missing
   (gap 1). Worker path should be browser-tested and recorded.
5. **Stale verification artifact:** `vitest-run.log` (34,337,732 bytes, mtime
   04:29:46) records the 04:28 run as **2 failed / 765 passed / 73 files** including a
   deleted `tests/qa/knownDefects.test.ts` and a determinism failure in
   `tests/qa/worldStability.test.ts`. The current tree passes 87/889 after the 04:37-04:46
   fixes; this log is misleading evidence and should be regenerated by the missing
   TEST_REPORT or removed.
6. **Partial spec facets** (all listed above): weeds (§26), fish research (§27), wildlife
   (§29), player-hosted dinner party (§31), buying a residence (§32), craft-shop business /
   supply relationships (§33), office/art/freelance jobs (§34), cinema/film/painting/music
   leisure actions (§38), letters & special-item collection categories (§39), NPC item
   exchange / joint NPC business (§24), influence sources (§44), archive influenced-NPC list
   (§51), title inheritance (§53), F12 replay/compare/heatmap/anomaly UI (§14), scene-key
   rebinding (§55), several player animation states (§56), offline summary detail click-through
   (§19), transport costs/special market events (§48).
7. **Docs drift** (verified): `docs/WORLD_SIMULATION.md:58` says `maxOfflineGameDays = 7`
   (actual 14, `src/core/WorldConfig.ts:26`); `docs/DATA_SCHEMA.md:9` says "~190" items
   (actual 234). `docs/QA_REPORT.md` §4 still describes an older full run with failing
   `tests/ui/uiSmoke.test.ts` and tsc errors in `tests/ui/domShim.ts`; the current tree
   passes typecheck and 889/889 tests, so that section is stale.
8. **Assets deviation:** `public/assets/` contains only `README.md`; all pixel art and audio
   are procedural (`src/render/**`, `src/audio/AudioManager.ts`). This meets the brief's
   quality intent (and the no-network rule) but deviates from the v3.0 physical asset tree in
   `code_artifact.txt`.

---

# 21. Verification commands & results (run by this audit)

Executed from the repository root on 2026-11-19 between 04:46:59 and ~04:53 local, while other agents
were still touching `tests/ui/` and `src/scenes/` (last observed mtimes 04:44-04:46):

```text
npx vitest run tests/contracts tests/world/locations.test.ts tests/gameplay/nature_data.test.ts \
  tests/gameplay/craft_data.test.ts tests/probability/determinism.test.ts \
  tests/probability/streamIndependence.test.ts tests/persistence/saveManager.test.ts \
  tests/life/physics.test.ts --reporter=dot
  -> Test Files 8 passed (8); Tests 98 passed (98)

npx vitest run tests/qa/worldStability.test.ts --reporter=dot
  -> 5/5 passed (49.7 s); seeds 101/202/303 x 30 game days;
     determinism across identical seed verified; seed 999 differs.

npx vitest run --reporter=dot
  -> Test Files 87 passed (87); Tests 889 passed (889); Duration 71.37 s

npx tsc --noEmit                              -> exit 0
npx tsc -p tsconfig.worker.json --noEmit      -> exit 0
npx eslint src tests                          -> exit 0
npx vite build                                -> exit 0; 179 modules; worker chunk emitted; 32.79 s

Content-count probe (esbuild bundle of src/data/index.ts, outside the repo)
  -> items 234, crops 19, fish 16, forage 46, recipes 100 (69+31),
     events 33 (11/8/6/5/3), festivals 10, locations 90 (45+45, 5 secret),
     routes 4, businesses 22 (17 types, 50 job seeds), npcs 56 (14+42),
     dialogue 18 trees / 314 nodes / 1135 choices, furniture 29,
     blueprints 17, achievements 37, goals 20, proposals 8,
     categories 10, streams 31
```

Not run (and therefore not claimed): `npm run dev` (no server started by an auditor),
`npm install` (dependencies present), a real browser play-through, Firefox/Safari/audio
verification.

## Limitations of this audit

- Audited statically plus executed tests/build/lint/typecheck and a content probe; it did not
  play the game in a browser and did not inspect the `smoke-*.png` screenshots visually.
- The repository was being actively edited by other agents during the audit; evidence line
  numbers may drift if files change again. The state described is the tree at the verification
  run above (after fixes at 04:37-04:46 removed the last two known test failures).
- "IMPLEMENTED" means present + compiled + at least indirectly exercised; for UI/render/audio
  areas the strongest automated evidence is the build, DOM-smoke tests
  (`tests/ui/`) and static inspection, not a visual browser run.
