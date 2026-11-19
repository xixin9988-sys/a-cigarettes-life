# Agent task map and final completion status

**A Cigarette's Life / 香烟的一生** - project root: this repository. This file records how the parallel build
was divided, what each task owned, and its final state. For per-module implementation detail
and verified/known-issue status, read [INTEGRATION_STATUS.md](INTEGRATION_STATUS.md) and
[TEST_REPORT.md](TEST_REPORT.md); this page is the ownership/completion record.

Status values: **Completed** - deliverable present and verified by the final run or the
acceptance report. **Completed (evidence link)** - same, with the report that proves it.

Final verification evidence (2026-11-19): app + worker TypeScript clean; full suite **93 files /
941 tests / 941 passed** (36.72 s Vitest, 0 failed/skipped); production build clean (185 modules,
vite 7.37 s); ESLint 0 problems; independent browser acceptance **17/17 PASS, 0 console errors**
(docs/ACCEPTANCE_REPORT.md); independent QA report green on the same tree (docs/QA_REPORT.md);
requirement audit 55 implemented / 30 partial / 0 missing (docs/SPEC_COVERAGE.md).

## Final completion record

| Task | Agent | Area | Write scope (module ownership) | Final status |
|---|---|---|---|---|
| task-0 / Lead integration | lead | Core contracts, GameEngine, simulation runtime, worker, persistence, boot | src/core/**, src/simulation/**, src/workers/**, src/persistence/**, src/main.ts, src/data/index.ts, configs | **Completed** - core/integration verification in TEST_REPORT |
| task-1 | prob-engine | Probability engine | src/probability/**, tests/probability/** | **Completed** |
| task-2 | world-map | World, weather, map, transport, world data | src/world/**, src/data/locations/**, src/data/probability/**, src/data/transport/**, tests/world/** | **Completed** |
| task-3 | npc-life | NPC autonomous life + NPC data | src/npc/**, src/data/npcs/**, tests/npc/** | **Completed** |
| task-4 | economy | Economy, shops, jobs, core items | src/economy/**, src/data/shops/**, src/data/items/core.ts, tests/economy/** | **Completed** |
| task-5 | nature | Farming, foraging, fishing, exploration + nature data | src/gameplay/FarmingSystem.ts, ForagingSystem.ts, FishingSystem.ts, ExplorationSystem.ts, src/data/crops/**, src/data/fish/**, src/data/items/nature.ts, tests/gameplay/nature_* | **Completed** |
| task-6 | craft | Crafting, cooking, building, housing, collection, skills + data | src/gameplay/CraftingSystem.ts, CookingSystem.ts, BuildingSystem.ts, HousingSystem.ts, CollectionSystem.ts, SkillSystem.ts, src/data/recipes/**, src/data/furniture/**, src/data/blueprints/**, src/data/collection/**, src/data/items/crafted.ts, tests/gameplay/craft_* / housing_* / skill_curve | **Completed** |
| task-7 | social | Dialogue, friendship, romance, gifts, invitations, community + data | src/social/**, src/data/dialogue/**, src/data/community/**, tests/social/** | **Completed** |
| task-8 | life | Cigarette physics, archive, achievements, goals, influence, legacy + data | src/life/**, src/data/items/life.ts, src/data/achievements/**, src/data/goals/**, tests/life/** | **Completed** |
| task-9 | lead | World events and festivals + data | src/gameplay/EventSystem.ts, src/data/events/**, tests/events/** | **Completed** |
| task-10 | scenes | Phaser scenes, procedural renderers/FX | src/scenes/**, src/render/** | **Completed** - build + browser acceptance (17/17) |
| task-15 | audio | Procedural soundtrack, ambience and SFX | src/audio/**, tests/audio/** | **Completed** - 6 test files / 52 tests, acceptance build |
| task-11 | panels | DOM UI manager and all panels | src/ui/** (UIManager, HUD, panels, widgets/styles/model) | **Completed** - build + acceptance report |
| task-12 | qa | QA performance, stress, scenario and regression tests + QA report | tests/qa/**, tests/scenarios/**, docs/QA_REPORT.md | **Completed** - docs/QA_REPORT.md |
| task-13 | verifier | Acceptance: browser playthrough verification + report | browser runs, screenshots, docs/ACCEPTANCE_REPORT.md | **Completed** - docs/ACCEPTANCE_REPORT.md |
| task-14 | docs | Final project documentation | README.md, docs/TEST_REPORT.md, docs/INTEGRATION_STATUS.md, docs/AGENT_TASKS.md | **Completed** (this file) |
| task-16 | coverage audit | Requirement-by-requirement spec audit | docs/SPEC_COVERAGE.md | **Completed** - 85 rows: 55 implemented / 30 partial / 0 missing |

All tasks were delivered in the same shared working directory; write scopes did not overlap
between parallel agents. Where a task needed a frozen contract change, it was reported to the
Lead and implemented in the Lead-owned files instead of silently diverging.

## Domain map: module -> tests -> report section

| Spec area | Main module paths | Test suites | Status detail |
|---|---|---|---|
| 0 Core, contracts, GameEngine | src/core/**, src/main.ts | tests/contracts, tests/integration, tests/simulation, tests/persistence | INTEGRATION_STATUS 0 |
| 1 Probability | src/probability/** | tests/probability (13 files) | INTEGRATION_STATUS 1 |
| 2 Simulation / worker / offline | src/simulation/**, src/workers/** | tests/simulation, tests/qa/offlineCatchup | INTEGRATION_STATUS 2 |
| 3 NPC | src/npc/**, src/data/npcs/** | tests/npc (9 files), QA world stability | INTEGRATION_STATUS 3 |
| 4 World / map | src/world/**, src/data/locations/**, src/data/transport/**, src/data/probability/** | tests/world (6 files) | INTEGRATION_STATUS 4 |
| 5 Farming / nature | src/gameplay/FarmingSystem.ts, ForagingSystem.ts, src/data/crops/**, src/data/fish/** | tests/gameplay/nature_* | INTEGRATION_STATUS 5 |
| 6 Fishing / exploration | src/gameplay/FishingSystem.ts, ExplorationSystem.ts | tests/gameplay/nature_fishing, nature_exploration | INTEGRATION_STATUS 6 |
| 7 Crafting / cooking / skills / collection | src/gameplay/CraftingSystem.ts, CookingSystem.ts, SkillSystem.ts, CollectionSystem.ts | tests/gameplay/craft_*, skill_curve | INTEGRATION_STATUS 7 |
| 8 Building / housing | src/gameplay/BuildingSystem.ts, HousingSystem.ts | tests/gameplay/craft_building, housing_placement | INTEGRATION_STATUS 8 |
| 9 Economy / business | src/economy/** | tests/economy (7 files), tests/qa/economyIntegrity | INTEGRATION_STATUS 9 |
| 10 Social / relationship | src/social/** | tests/social (8 files), scenarios | INTEGRATION_STATUS 10 |
| 11 Events / festivals | src/gameplay/EventSystem.ts, src/data/events/** | tests/events, QA world stability | INTEGRATION_STATUS 11 |
| 12 Life / cigarette physics | src/life/**, src/data/items/life.ts, src/data/achievements/**, src/data/goals/** | tests/life (9 files), QA world stability/offline | INTEGRATION_STATUS 12 |
| 13 UI / scenes / audio | src/scenes/**, src/render/**, src/ui/**, src/audio/** | tests/ui (4 files/46), tests/scenes (6/61), tests/audio (6/52) + browser acceptance | INTEGRATION_STATUS 13 |
| 14 QA / tests | tests/qa/**, tests/scenarios/**, tests/contracts/**, tests/integration/** | itself | INTEGRATION_STATUS 14, docs/QA_REPORT.md |

## Lead-owned integration files (agents did not edit)

src/core/contracts.d.ts, src/core/SharedTypes.ts, src/core/WorldConfig.ts,
src/core/WorldFactory.ts, src/core/Clock.ts, src/core/EventBus.ts,
src/core/SystemRegistry.ts, src/core/GameContext.ts, src/core/ContentRegistry.ts,
src/core/InventoryUtil.ts, src/core/RelationshipUtil.ts, src/core/TimeUtil.ts,
src/core/utils.ts, src/core/format.ts, src/core/GameLogger.ts, src/core/Game.ts,
src/simulation/** (SimulationRuntime and LOD drivers), src/workers/**,
src/persistence/**, src/main.ts, src/data/index.ts, src/data/schema.ts,
src/data/*/ids.ts, configs (package.json, tsconfig*.json, vite.config.ts,
vitest.config.ts, eslint.config.js), + all docs except the final reports.

## System ids and registration order (frozen integration contract)

Register with these exact ids:
world, npc, economy, skill, farming, foraging, fishing, exploration, crafting, cooking,
building, housing, collection, social, dialogue, events, life.

Update order is the same sequence: world -> npc -> economy -> skill -> farming -> foraging ->
fishing -> exploration -> crafting -> cooking -> building -> housing -> collection -> social ->
dialogue -> events -> life. Every system is constructed with no constructor arguments, gets
init(ctx) once in order, then update(dtSimSeconds) each simulation step (dt can be large during
offline catch-up).

## Content data ownership

| Data | Files | Owner |
|---|---|---|
| Items (234) | src/data/items/core.ts, nature.ts, crafted.ts, life.ts, index.ts, ids.ts | economy / nature / craft / life agents |
| Locations (90), weather table, train routes | src/data/locations/**, src/data/probability/weather.ts, src/data/transport/routes.ts | world-map |
| NPCs (56) | src/data/npcs/** | npc-life |
| Shops/businesses (22) + jobs | src/data/shops/** | economy |
| Crops (19), fish (16), forage nodes (46) | src/data/crops/**, src/data/fish/** | nature |
| Recipes (100), furniture (29), blueprints (17), collection categories (10) | src/data/recipes/**, src/data/furniture/**, src/data/blueprints/**, src/data/collection/** | craft |
| Dialogue trees (18), community proposals (8) | src/data/dialogue/**, src/data/community/** | social |
| Life items, achievements (37), goals (20) | src/data/items/life.ts, src/data/achievements/**, src/data/goals/** | life |
| Events (33), festivals (10) | src/data/events/** | lead (task-9) |

## Defects found during integration and fixed before the final verification

QA/verification found real defects while the modules were integrated; the Lead fixed them in
Lead-owned files and QA added regression tests (tests/qa/regressions.test.ts). Recorded here
for honesty about the development history:

1. **Time-scale conversions** in farming growth, forage respawn and exploration cooldown were
   60x too slow (mixed game-hour vs simulated-second units). Fixed; REGRESSION-1a/1b/1c.
2. **Offline catch-up aggregation** used simulated game-hour buckets so a 12 h real absence
   collapsed into one/two giant steps. Fixed to bucket by real hours away
   (less than 1 h -> 5 game-minute steps, 1-24 h -> 30-minute steps, more than 24 h -> daily
   steps); max offline cap 14 game days. REGRESSION-2.
3. **Offline cap / life survival** around long absences (a 14-day absence could auto-kill the
   cigarette). Fixed with the 14-game-day cap and the documented offline burn multiplier.
   REGRESSION-3.
4. **Offline burn multiplier consistency**: the main-thread fallback did not set the
   offline-simulation flag, so it burned at the active rate instead of the offline rate.
   Fixed; REGRESSION-4.
5. **Fishing rod acquisition**: the basic rod had no legitimate content source. Fixed
   (shop stock); REGRESSION-5.
6. **Offline life-end reconciliation**: an offline catch-up that ends the life is now
   reconciled on the next tick instead of leaving the game on the playing screen. REGRESSION-6.
7. **Deterministic instance ids**: makeId() used Date.now(), so two identical runs produced
   different GameState fingerprints. Fixed with configureIdGenerator()/syncIdCounterFromState()
   (seed-derived token + counter; loaded saves sync the counter past persisted ids).
8. **Fishing bite-wait unit**: cast->bite used waitMinutes * 60 seconds (60x too long). Fixed
   post-freeze to the configured 4-22 real seconds at 1x; re-verified by browser acceptance S10.
9. **Save integrity while playing**: SaveManager checksummed the live state then wrote it after
   an await, so a ticking simulation could corrupt the stored payload and make the slot
   unloadable. Fixed with the save-time structuredClone snapshot (checksum of the snapshot ==
   written snapshot); re-verified by acceptance S13 and persistence/QA tests.
10. **Scene-transition crash**: moving between two locations that share a Phaser scene class
    could leave no active world scene (weather-controller resize on a destroyed geometry). Fixed
    by the scenes owner; re-verified by acceptance S05/S06/S08.
11. **Missing favicon**: three benign /favicon.ico 404 console errors per load. Favicon assets
    added and linked; re-verified with 0 console errors.
12. **Stale QA perf-test expectation**: compared the loaded state to the live state after the
    new save-time probability-history trim; the test now compares against an equivalently
    trimmed copy. This was test-only, not a product defect.

Remaining non-blocking scope findings are listed in INTEGRATION_STATUS.md "Known limitations and
open gaps" (notably: browser acceptance is a run, not a CI gate; visible-play simulation is
main-thread with a hidden-tab worker loop; no coverage tooling/CI; the 30 requirement-level
partials in docs/SPEC_COVERAGE.md). The final test suite has no failing tests.

## Final documentation set

- README.md - feature summary, controls, commands, docs index, known limitations
- docs/TEST_REPORT.md - exact verification commands/results, test inventory, performance
  evidence, known failures and residual risks
- docs/INTEGRATION_STATUS.md - per-module status for all 15 spec areas, content counts, save
  format, offline architecture, run instructions, open gaps
- docs/QA_REPORT.md - QA agent's performance/stress/scenario report (final tree 93/941 green)
- docs/ACCEPTANCE_REPORT.md - independent browser playthrough acceptance report (17/17 PASS)
- docs/SPEC_COVERAGE.md - requirement-by-requirement audit against the source spec
- docs/AGENT_TASKS.md - this ownership/completion record
