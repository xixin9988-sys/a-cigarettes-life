# Test Report - A Cigarette's Life / 香烟的一生

Final, evidence-based test and verification report for this repository.

- **Report written:** 2026-11-19 (Europe/London), after the Lead declared the tree source-frozen.
- **Authoritative verification run:** 2026-11-19T05:23:03Z -> 2026-11-19T05:24:09Z, on the frozen
  tree (last src changes: SaveManager save-time snapshot, FishingSystem bite-wait unit, favicon
  assets, LOD2 + atomic offline save; no further src edits after this).
- **Environment:** Windows NT 10.0.26300.0 (GMT Standard Time), Node.js v24.21.0, npm 11.19.0,
  TypeScript 5.9.3, Vitest 2.1.9, Vite 5.4.21, ESLint 9.39.1, Phaser 3.90.0,
  Chrome 157.0.8103.81 (headless, via playwright-core 1.65.1).
- **Machine load:** idle (the run was serialised with QA/verifier/Lead runs; earlier contention
  produced a false 39 s perf-budget failure, see "Known failures").

## Verdict

| Check | Command | Result | Duration |
|---|---|---|---|
| App TypeScript project | npx tsc --noEmit | **PASS** - exit 0, no output | 5.06 s |
| Worker TypeScript project | npx tsc -p tsconfig.worker.json --noEmit | **PASS** - exit 0, no output | 2.39 s |
| Full test suite | npx vitest run | **PASS** - 93 files, 941 tests, 941 passed, 0 failed, 0 skipped | 37.83 s wall (Vitest: 36.72 s) |
| Production build | npm run build (typecheck + vite build) | **PASS** - exit 0, 185 modules, dist emitted | 14.79 s (vite: 7.37 s) |
| Lint | npx eslint src tests | **PASS** - exit 0, 0 errors / 0 warnings | 5.96 s |
| Browser acceptance | scripts/acceptance-playthrough.mjs (headless Chrome) | **PASS** - 17/17 scenarios, 0 console errors (see docs/ACCEPTANCE_REPORT.md) | ~130 s |

**No failing tests, no skipped tests and no lint/typecheck errors on the final tree.**
The suite is parallel (Vitest threads pool), so the wall time is about a third of the sum of the
individual file times (129.49 s of test time). All numbers below are from the run above.

## 1. Exact commands and results

Commands were run from the repository root, one after another, on an idle machine, measured with a
stopwatch (durations include npx startup):

    npx tsc --noEmit                              # exit 0, 5.06 s
    npx tsc -p tsconfig.worker.json --noEmit      # exit 0, 2.39 s
    npx vitest run                                # exit 0, 37.83 s wall
    npm run build                                 # exit 0, 14.79 s (typecheck 2x + vite build 7.37 s)
    npx eslint src tests                          # exit 0, 5.96 s, no output

Vitest self-reported summary:

    Test Files  93 passed (93)
         Tests  941 passed (941)
      Duration  36.72s
        transform 10.04s, setup 7.65s, collect 30.10s, tests 129.49s,
        environment 34ms, prepare 15.09s

Build output (authoritative run):

    vite v5.4.21 building for production...
    transforming...
    ✓ 185 modules transformed.
    dist/index.html                                1.53 kB │ gzip:   0.70 kB
    dist/assets/simulation.worker-DSDeOCdE.js    818.58 kB
    dist/assets/index-BTRRq9z_.js              2,783.17 kB │ gzip: 711.77 kB
    ✓ built in 7.37s

dist/ totals in the final run: 6 files, 3,610,199 bytes total - index.html 1,526 B,
index-BTRRq9z_.js 2,786,651 B, simulation.worker-DSDeOCdE.js 821,324 B, favicon.ico 273 B,
favicon.png 251 B, public/assets/README.md 174 B (copied through). The two JS hashes match the
verifier's independent build (docs/ACCEPTANCE_REPORT.md section 1), and repeated clean builds
produced identical hashes.

The worker project (tsconfig.worker.json) compiles the DOM-free simulation layer with
lib WebWorker and no DOM. It passing is the evidence that the simulation code does not import
Phaser/DOM; this is also enforced by a source-reading contract test.

## 2. Test inventory by domain (93 files / 941 tests)

The suite lives in tests/<domain>/ (Node environment; Vitest threads pool; 30 s default test
timeout with explicit larger timeouts for long runs). Per-domain figures below are from the
authoritative run; "file ms" is the sum of that domain's file durations (parallel execution makes
it larger than wall time).

| Domain | Files | Tests | File ms | What it covers |
|---|---|---|---|---|
| contracts | 1 | 11 | 1,044 | Complete content pack (45 exteriors / 25 Willowbrook / 20 Ashford, interiors, 14 majors + 42 residents, item/crop/fish/recipe/event/festival/business/train/weather references), 17 systems registered in order, source scan for Math.random, canonical item ids |
| probability | 13 | 137 | 3,189 | SplitMix64 + Xoshiro128** PRNG primitives/state validation, seed derivation + stream independence, condition AST/operators, modifiers/weight clamps, prefix/alias sampling, distribution statistics, determinism (primitive draws, decisions, save/restore), history ring + causal trace, replay, debugger maths, fuzzing (200 generated decision shapes), contract compliance |
| simulation | 1 | 9 | 91 | Fixed-step scheduler accumulation/clamping, named-interval scheduler, snapshot capture/restore/serialise, state diff engine, offline summary honesty (no fabricated changes) |
| persistence | 1 | 6 | 240 | Ping-pong save/load, corrupt-slot fallback, export/import checksum validation, migration/validation, checksum stability |
| integration | 1 | 8 | 4,411 | Real GameEngine full life-cycle headless: 56-NPC save, farm + ash harvest, shop purchase, dialogue tree, save/reload, offline catch-up |
| scenarios | 1 | 2 | 7,462 | Full player life through the public API: travel -> forage -> farm + ash fertiliser -> harvest -> craft -> fish -> talk/dialogue; then save/load -> offline night -> death -> archive -> next generation with one legacy item |
| qa | 6 | 28 | 75,113 | 3 seeds x 30 game days headless world stability + determinism, long-run economy integrity and player-shop settlement idempotency, 24 h / 72 h / 14 d offline stress, save corruption/migration, performance budgets, regression tests for fixed defects |
| world | 6 | 83 | 638 | Location data graph/entrances/secrets, map BFS/Dijkstra and travel, weather transition tables + Markov weather system, train route data, WorldSystem calendar/season/daylight/discovery/transport/history/occupancy/determinism, content-set integration |
| npc | 9 | 61 | 21,777 | NPC content data, 9 needs + emotions/mood, 12 personality traits, Ebbinghaus memory decay/permanent memories, schedule adherence, autonomous activity, NPC-NPC social simulation, large-dt performance, module contracts |
| economy | 7 | 52 | 5,934 | Item/business data integrity, market/prices/clamps, transactions (buy/sell atomicity, no negative money), business customer simulation, employment and wages, player shop (buy/pricing/restock/open/hire), stability over simulated months |
| gameplay | 13 | 174 | 1,054 | Nature data + farming + fishing + foraging + exploration; craft data + crafting + cooking + building + housing + collection + module integration; 8-skill XP curve |
| social | 8 | 125 | 926 | Dialogue trees (conditional text/choices/effects, greetings by status, once-only choices), friendship actions, gift taste/balance, invitations lifecycle, romance gates/outcomes/drift, community proposals/voting, social data, large offline catch-up |
| events | 1 | 4 | 2,448 | Event/festival data validity and event occurrence/effect path through the real runtime (thin domain - see gaps) |
| life | 9 | 82 | 457 | Cigarette physics (burn, wind, moisture, shelter, ash, warnings), lifecycle end/archive, ash collection, achievements, goals, legacy/generation, identity/influence, life item data |
| ui | 4 | 46 | 748 | Pure view-model helpers (HUD model, inventory/recipe availability, map projection, furniture placement preview, settings/input, probability bars), interaction/format helpers, UI module graph (every panel registered, IUIManager contract), DOM UI smoke test in a headless fake DOM (all panels open/render/close, dialogue/fishing auto-panels, offline summary/life review/character creation modals, keyboard shortcuts incl. F12, real action dispatch from buttons, housing placement + shop purchase, many update frames) |
| scenes | 6 | 61 | 737 | Phaser-free render layer: season/day-night/weather/region/interior palettes + colour maths, tile maths, wind vectors, deterministic hashing/mulberry32, camera zoom, state<->scene coordinates, cigarette visual parameters, NPC poses/emotions/patrols, location layout planner for every location, tile variants, precipitation/ambient particles/lightning/sky motion, texture asset manifest vs generated keys |
| audio | 6 | 52 | 3,217 | Procedural audio policy (no Math.random, no network, no external assets), deterministic noise generation, synth voice helpers, ambience/music/SFX configuration and AudioManager behaviour under a fake AudioContext |

Appendix A lists all 93 files with their test counts.

## 3. Test quality and reproducibility practices

- **Real modules, not mocks of own code.** Suites construct ContentRegistry + GameState +
  ProbabilityEngine + Clock + EventBus + SystemRegistry + GameContext and drive the actual systems;
  QA/scenario tests use the real GameEngine/SimulationRuntime/SaveManager. Test doubles are limited
  to environment shims the project owns: MemorySaveStorage (production fallback), fake-indexeddb
  (devDependency), a headless DOM shim for tests/ui, and a fake AudioContext for tests/audio.
- **Determinism.** Every test is seed-fixed and has no wall-clock gameplay decisions. QA builds a
  gameplay JSON fingerprint that deliberately excludes wall-clock bookkeeping (meta.*,
  pendingOffline.*, clock.lastRealTimestampMs) and asserts byte-identical states for identical
  seeds (probability determinism/save-restore, headless 30-day world runs, economy month re-runs,
  offline window replay). No Math.random() anywhere in src/ is enforced by both ESLint and a
  source-scanning test.
- **Bounded state.** Long runs assert caps: world events <= 400, history <= 800, transaction log
  <= 100, probability history <= 5000, NPC activity/memory bounds, finite numbers everywhere.
- **Contract/content gates.** tests/contracts loads the real content pack, checks every canonical
  reference and every registered system, and scans the source tree.

## 4. Performance evidence (measured, not estimated)

All numbers are from the authoritative idle-machine run unless stated. Budgets are the assertions
in the test files; measured values are console-logged by the tests.

| Workload | Measured | Asserted budget | Source |
|---|---|---|---|
| 20,000 probability decide() calls (3 weighted candidates + conditions) | **344.3 ms** = 17.21 us/decision | < 5,000 ms; < 1,000 us/decision | tests/qa/performance |
| 200,000 primitive roll() draws | **49.1 ms** | < 5,000 ms | tests/qa/performance |
| Decision history cap under 20k decisions | 5,000 records (cap honoured) | <= WORLD_CONFIG.probability.historyLimit | tests/qa/performance |
| 56 NPCs x 30 game days headless (6 game-hour steps) | **12,093 ms**, 40,305 decisions, 102 events, history 239, state JSON 8,846,377 bytes | < 30,000 ms | tests/qa/performance |
| 30-day world runs, seeds 101 / 202 / 303 | **11,906 / 5,100 / 4,793 ms**; 117/107/85 events; history 276/249/207; 40,302/40,285/40,296 decisions; NPC-NPC interactions 7,661/7,678/7,600 | test timeout 180 s; invariants asserted per seed | tests/qa/worldStability |
| Offline catch-up, 24 h real gap | **3,786 ms**, 144 aggregated steps, 72 game hours, cigarette burn 7.5 %, summary changes 60 | summary exactness/idempotency; QA report budget < 15 s | tests/qa/offlineCatchup |
| Offline catch-up, 72 h real gap | **2,791 ms**, 9 daily steps, 216 game hours, burn 22.5 % | same | tests/qa/offlineCatchup |
| Offline catch-up, 14-day real gap | **1,764 ms**, 14 daily steps, 336 game hours, lengthRatio 0.650, life alive | same | tests/qa/offlineCatchup |
| 30 game days of economy (aggregated runtime step) | **1,891 ms**, 230 price moves, 11 wage transactions, 21 employed NPCs, 13 staffed businesses, economic index 1.132 | exact economy determinism on re-run | tests/qa/economyIntegrity |
| Save + load after 10 game hours (MemorySaveStorage) | **save 28.1 ms / load 6.8 ms**, payload 1,959,426 bytes (1.87 MiB) | < 3,000 ms each, < 32 MB | tests/qa/performance |
| Full-lifecycle scenario | 2,356 ms (early life chain) + 5,105 ms (persist/offline/death/next generation) | test timeout | tests/scenarios |
| Full suite wall time | **37.83 s** (Vitest 36.72 s; test time 129.49 s across files) | - | authoritative run |
| Production build | **14.79 s** total; vite 7.37 s, 185 modules; index 2.78 MB + worker 0.82 MB, gzip 711.77 kB | - | authoritative run |
| Lint | **5.96 s**, 0 problems | - | authoritative run |

Suite slowest files (authoritative): qa/worldStability 32.1 s, qa/regressions 13.2 s,
qa/performance 12.9 s, npc/social 12.0 s, qa/offlineCatchup 11.2 s,
scenarios/fullPlayerLifecycle 7.5 s, qa/economyIntegrity 5.2 s,
integration/fullLifeCycle 4.4 s, npc/activity 4.2 s.

Known performance caveat: the 30-day 56-NPC test has a 30,000 ms budget and is CPU-sensitive.
Under concurrent full-suite runs from two agents the same workload measured 39,158 ms and failed;
idle it measures 12,093 ms (and 18 s in the QA agent's own report on a different idle run). The
authoritative number above is from the idle, serialised run. See "Known failures".

## 5. Browser acceptance evidence

Independent browser acceptance was run by the verifier on the same frozen build
(docs/ACCEPTANCE_REPORT.md; latest run 2026-11-19T05:19:26Z -> 05:21:36Z, 17/17 scenarios PASS,
0 console errors, 0 failed network requests). It drives the real production build
(npx vite build + npx vite preview) in headless Chrome, using real mouse/WASD/E input where a
player would and the published window.__A_CIGARETTES_LIFE__ hook only for assertions/awkward steps.
Evidence artifacts are in smoke/: acceptance-results.json (per-step evidence), acceptance-console.log,
acceptance-run.log and 25 screenshots smoke/acceptance-*.png (boot/menu, character creation, world,
movement, inventory, map + travel, NPC dialogue, social/life/journal/events/skills, shop purchase,
fishing, farming, crafting, save/reload, real Web Worker offline summary, hidden-tab LOD2 chunk,
life review, next generation). This is the only end-to-end evidence for the Phaser scene layer,
IndexedDB-in-browser, the real Web Worker and the hidden-tab background path; it is not part of
vitest and is not re-run by npm test.

Acceptance scenarios covered: boot/menu; character creation -> new life; world render + WASD
movement; inventory; map + adjacency-constrained travel; NPC dialogue via E; social panel chat/gift;
shop transaction; employment shift; fishing cast->bite->reel->catch; farming till/plant/water/ash
fertilise/harvest; foraging + crafting; save -> page reload -> load; real Web Worker 24 h offline
catch-up + summary + automatic atomic save + idempotent second request; hidden-tab LOD2
start/stop; life end -> review -> next generation; console/page-error sweep.

Acceptance-scope limitations (from its section 7): deep traversal was in Willowbrook only (Ashford,
trains/tickets, building/housing/collection/archive panels were not fully played through in the
browser); audio output was not asserted; offline was tested via a documented 24 h saved-absence
anchor and life end was accelerated with real time:rest actions.

## 6. Known failures

**None on the final tree.** The authoritative run has 0 failing and 0 skipped tests.

For full transparency, these defects were found during the verification campaign and fixed before
the final run (all now covered by regression tests or re-verified acceptance scenarios):

| # | Defect (found by) | Fix / status |
|---|---|---|
| 1 | Game-hour unit bug in FarmingSystem, ForagingSystem, ExplorationSystem (60x slow growth/respawn/cooldown) - QA | Fixed by Lead; covered by tests/qa/regressions REGRESSION-1a/1b/1c |
| 2 | Offline step aggregation unit bug (one giant step instead of documented buckets) - QA | Fixed; REGRESSION-2; final run shows 144/9/14 aggregated steps for 24 h/72 h/14 d |
| 3 | Offline duration cap unit bug (could simulate 42 game days and auto-kill the life) - QA | Fixed; cap now 14 game days; REGRESSION-3; final 14-day gap leaves lengthRatio 0.650 and life alive |
| 4 | Offline burn multiplier missing on the main-thread fallback - QA | Fixed; REGRESSION-4; worker/fallback burn agree |
| 5 | Fishing rod not reachable in normal play - QA | Fixed (starter + shop stock); REGRESSION-5 |
| 6 | Fishing bite delay 60x configured (4-22 real minutes per cast) - acceptance | Fixed post-freeze (waitMinutes used 1:1 with 4 s floor); re-verified acceptance S10 |
| 7 | Save checksum/payload mismatch when saving while the simulation ticks (save -> reload -> load failed) - acceptance | Fixed: SaveManager save-time structuredClone snapshot is checksummed and written; re-verified acceptance S13 and covered by tests/persistence + tests/qa/saveCorruption |
| 8 | Scene-transition crash (no active world scene after moving between locations sharing a Phaser scene class) - acceptance | Fixed by scenes owner (controller disposal/resize order); re-verified acceptance S05/S06/S08 |
| 9 | Missing favicon caused 3 benign 404 console errors - acceptance | Fixed (favicon assets + index.html links); re-verified 0 console errors |
| 10 | Stale QA performance test expectation (compared loaded state to live state after the new save-time trim) | Fixed in the test (compares against an equivalently trimmed copy); final suite green |
| 11 | Non-deterministic item instance ids (Date.now() in makeId) - docs audit | Fixed with configureIdGenerator()/syncIdCounterFromState(); QA determinism fingerprint test passes |
| 12 | LOD2-lite hidden-tab background and atomic save-after-offline wiring were missing | Added (Game.startBackgroundSimulation/stopBackgroundSimulation + visibilitychange; applyOfflineResult saves immediately); verified by acceptance S14/S15 |

No test was skipped, quarantined or weakened to make the suite green; the only test change
(#10) corrected a stale expectation to match the documented SaveManager behaviour.

## 7. Residual risks and gaps

1. **Browser acceptance is a separate manual run, not part of npm test.** The vitest suite cannot
   boot Phaser or a real browser; the scene layer, IndexedDB-in-browser, the real Web Worker and
   the hidden-tab path are evidenced only by docs/ACCEPTANCE_REPORT.md + smoke/ artifacts. A
   change to scenes/ui/browser wiring can pass the Node suite and still break the game until the
   acceptance script is re-run.
2. **Acceptance browser scope is not the whole game.** Willowbrook was traversed deeply; Ashford,
   trains/tickets, most interiors, building/housing/collection/archive panels were not fully
   played through in the browser (they are covered by unit/QA suites but not end-to-end).
   Audio output was not verified.
3. **Web Worker offline path under Node.** In Node there is no Worker, so vitest exercises the
   main-thread fallback and the shared runOffline logic. The real worker path is proven only by
   acceptance S14/S15, not by an automated regression test.
4. **LOD2 scope.** While the tab is visible, all 56 NPCs and both regions are simulated by the one
   main-thread runtime; only a hidden tab offloads chunks to the worker, and those chunks advance
   at the offline time scale (1 real hour = 3 game hours), then merge on return. This is
   documented behaviour, not a failure, but it is narrower than a full distant-region LOD2
   offload. See INTEGRATION_STATUS G4.
5. **Spec coverage is honest but partial.** docs/SPEC_COVERAGE.md audits 85 requirement rows against
   the source spec: 55 IMPLEMENTED, 30 PARTIAL, 0 MISSING, with named facets for every PARTIAL
   (e.g. transport NPC passengers/traffic/dynamic line status; no tile-layer HPA*/A* map files -
   navigation is a location graph; probability debugger not full heatmap/anomaly UI; per-system
   scheduler cadence not fully data-driven; some offline-summary entries not clickable; NPC social
   breadth; museum display; some multi-generation inheritance facets; controls/animations breadth;
   per-module READMEs missing). Use that document for requirement-level gaps.
6. **Event/festival test depth is thin.** Only 4 tests exist for 33 events + 10 festivals; data
   validity and the core occurrence/effect path are covered, but per-event balance and every
   festival activity outcome are not individually asserted.
7. **Docs drift remains in pre-existing docs** (not in this report or INTEGRATION_STATUS):
   docs/WORLD_SIMULATION.md still says maxOfflineGameDays 7 (code = 14) and describes step buckets
   ambiguously; docs/DATA_SCHEMA.md says items "~190" (actual 234); docs/ARCHITECTURE.md mentions
   SimulationRuntime.updateActive and src/core/GameBootstrap.ts, which do not exist under those
   names (the tick is GameEngine.tick, bootstrap is src/main.ts). The update loop described there
   is conceptually accurate.
8. **Save/state size.** A 10-game-hour save is 1.87 MiB; a 30-day headless state JSON is 8.4 MiB,
   dominated by the probability decision ring. SaveManager caps the saved probability history at
   400 records, but a live long session's in-memory ring reaches 5,000 full records. IndexedDB
   handles this (save 28 ms / load 7 ms measured), but it should be watched if the history grows.
9. **Offline summary statistics are approximate by design.** OfflineSimResult.stats.events /
   stats.transactions are derived from capped log slices (transaction log caps at 100), and
   summary changes cap at 60; tests assert truthfulness (new event ids exist, descriptions
   non-empty, duration exact) rather than exact counts (QA report residual risk 1).
10. **Multi-generation clock resets (design decision to confirm).** startNextLife creates a fresh
    GameState clock at Year 1 Spring 1 while carrying the world/NPC/economy/history objects; the
    lifecycle scenario observed gen 2 at simTime 5130 and no future-timed events, but pre-existing
    history timestamps can be larger than the new clock (QA report residual risk 3).
11. **World event log can be sparse** in headless runs (85-117 events per 30 days here; content
    tuning observation, not a crash). The cap works.
12. **No coverage instrumentation or CI.** No @vitest/coverage configuration, no runner; all
    numbers are from one local machine, and performance-sensitive tests can fail under heavy
    concurrent load (observed once). Treat durations/timings as machine-dependent; pass/fail
    counts are deterministic.
13. **Browser matrix.** Only headless Chrome + SwiftShader WebGL was used. Firefox/Safari/mobile
    are untested; audio requires a user gesture and was not asserted.
14. **Audio.** 52 unit tests cover the procedural audio layer under fake AudioContext, but audible
    output, mixing and autoplay-policy behaviour are browser-only and were not verified.
15. G1/G2 from the docs audit (deterministic ids, real-hour offline buckets) are fixed and
    regression-tested; historical notes are kept in INTEGRATION_STATUS.md.

## 8. Reproducing the numbers

    cd <repo>
    npm install                 # only on a clean checkout; node_modules present here
    npx tsc --noEmit
    npx tsc -p tsconfig.worker.json --noEmit
    npx vitest run
    npm run build
    npx eslint src tests
    # optional independent browser acceptance (needs Chrome; playwright-core is a devDependency):
    npx vite preview --port 4173 --host localhost   # in one terminal, after npm run build
    node scripts/acceptance-playthrough.mjs          # in another; evidence in smoke/

Notes: run the suite on an otherwise idle machine - the 30-day QA run and the 20k-decision
performance test measure wall time and are contention-sensitive. The suite is deterministic in
pass/fail; durations vary. Node 20+ is required (verified on Node 24.21.0). No network access is
used by the tests (fake-indexeddb/AudioContext shims only).

## Appendix A - all test files (93) and test counts

    tests/audio/ambience.test.ts 15
    tests/audio/audioManager.test.ts 5
    tests/audio/deterministic.test.ts 11
    tests/audio/music.test.ts 11
    tests/audio/proceduralPolicy.test.ts 5
    tests/audio/sfx.test.ts 5
    tests/contracts/contractCompliance.test.ts 11
    tests/economy/business_simulation.test.ts 7
    tests/economy/economy_data.test.ts 8
    tests/economy/employment.test.ts 6
    tests/economy/market_stability.test.ts 7
    tests/economy/player_shop.test.ts 7
    tests/economy/price_market.test.ts 8
    tests/economy/transaction.test.ts 9
    tests/events/eventSystem.test.ts 4
    tests/gameplay/craft_building.test.ts 13
    tests/gameplay/craft_collection.test.ts 10
    tests/gameplay/craft_cooking.test.ts 15
    tests/gameplay/craft_crafting.test.ts 23
    tests/gameplay/craft_data.test.ts 15
    tests/gameplay/craft_integration.test.ts 5
    tests/gameplay/housing_placement.test.ts 22
    tests/gameplay/nature_data.test.ts 17
    tests/gameplay/nature_exploration.test.ts 10
    tests/gameplay/nature_farming.test.ts 13
    tests/gameplay/nature_fishing.test.ts 12
    tests/gameplay/nature_foraging.test.ts 9
    tests/gameplay/skill_curve.test.ts 10
    tests/integration/fullLifeCycle.test.ts 8
    tests/life/achievements.test.ts 7
    tests/life/archive.test.ts 9
    tests/life/ash.test.ts 7
    tests/life/data.test.ts 13
    tests/life/goals.test.ts 5
    tests/life/identity_influence.test.ts 7
    tests/life/legacy.test.ts 5
    tests/life/lifecycle.test.ts 11
    tests/life/physics.test.ts 18
    tests/npc/activity.test.ts 6
    tests/npc/contracts.test.ts 7
    tests/npc/data.test.ts 9
    tests/npc/memory.test.ts 6
    tests/npc/needs.test.ts 8
    tests/npc/performance.test.ts 4
    tests/npc/personality.test.ts 6
    tests/npc/schedule.test.ts 6
    tests/npc/social.test.ts 9
    tests/persistence/saveManager.test.ts 6
    tests/probability/conditions.test.ts 12
    tests/probability/contract.test.ts 3
    tests/probability/debugger.test.ts 14
    tests/probability/determinism.test.ts 9
    tests/probability/distribution.test.ts 13
    tests/probability/fuzz.test.ts 3
    tests/probability/historyTrace.test.ts 9
    tests/probability/randomProvider.test.ts 14
    tests/probability/registry.test.ts 9
    tests/probability/replay.test.ts 10
    tests/probability/sampling.test.ts 9
    tests/probability/streamIndependence.test.ts 10
    tests/probability/weights.test.ts 22
    tests/qa/economyIntegrity.test.ts 3
    tests/qa/offlineCatchup.test.ts 3
    tests/qa/performance.test.ts 4
    tests/qa/regressions.test.ts 8
    tests/qa/saveCorruption.test.ts 5
    tests/qa/worldStability.test.ts 5
    tests/scenarios/fullPlayerLifecycle.test.ts 2
    tests/scenes/assetManifest.test.ts 5
    tests/scenes/layout.test.ts 13
    tests/scenes/renderEffects.test.ts 10
    tests/scenes/renderGeometry.test.ts 17
    tests/scenes/renderPalette.test.ts 12
    tests/scenes/tiles.test.ts 4
    tests/simulation/simulationCore.test.ts 9
    tests/social/community.test.ts 12
    tests/social/data.test.ts 17
    tests/social/dialogue.test.ts 24
    tests/social/friendship.test.ts 17
    tests/social/gift.test.ts 14
    tests/social/invitations.test.ts 15
    tests/social/offline.test.ts 8
    tests/social/romance.test.ts 18
    tests/ui/interactionHelpers.test.ts 12
    tests/ui/model.test.ts 20
    tests/ui/moduleGraph.test.ts 4
    tests/ui/uiSmoke.test.ts 10
    tests/world/content-integration.test.ts 6
    tests/world/locations.test.ts 12
    tests/world/map.test.ts 14
    tests/world/routes.test.ts 6
    tests/world/weather.test.ts 14
    tests/world/world-systems.test.ts 31

## Appendix B - evidence artefacts

- Authoritative vitest log: E:\Temp\life-vitest-authoritative.log (machine-local, UTF-16; the
  summary and measurements quoted above were extracted from it).
- Browser acceptance: smoke/acceptance-results.json, smoke/acceptance-console.log,
  smoke/acceptance-run.log, 25 screenshots smoke/acceptance-*.png (25 acceptance shots; the smoke/
  directory has 38 files incl. logs and earlier lead screenshots).
- Independent reports: docs/QA_REPORT.md, docs/ACCEPTANCE_REPORT.md, docs/SPEC_COVERAGE.md.
- Integration status / gaps: docs/INTEGRATION_STATUS.md.
