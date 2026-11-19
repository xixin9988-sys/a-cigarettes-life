# QA / Integration Report - A Cigarette's Life

**Author:** QA / Integration agent (Agent 14, task-12)
**Last verified:** 2026-11-19, on final tree snapshot `hash:22ddf4f0` (SHA-256 over `src/**` + `tests/**` +
root build configs; hash re-checked before and after the verification runs below and unchanged).
**Scope:** deterministic headless QA of the real modules - `SimulationRuntime`, `SimulationReplay`,
`GameEngine`, `SaveManager`, `ProbabilityEngine`, `ContentRegistry` - plus a full player-lifecycle
scenario. No game system was mocked; test doubles are limited to the storage backends the production
code ships itself (`MemorySaveStorage`) and fake-indexeddb for the browser API.

> Current-tree status: **`npx tsc --noEmit` clean; whole project suite 93 files / 941 tests / 941
> passing; QA + scenario suites 7 files / 30 tests / 30 passing.** Earlier revision of this report
> listed transient UI-smoke failures and `tests/ui/**` type errors; those do **not** reproduce on the
> final tree and have been removed from this document.

## Verdict

**QA + scenario suites: 7 files / 30 tests / 30 passing (0 failing, 0 skipped) - GREEN.**
Standalone run wall time 32.7 s (Vitest reports 69.5 s of test CPU, suites run in parallel).

```
npx vitest run tests/qa tests/scenarios --reporter=dot
 → Test Files  7 passed (7)
 →      Tests  30 passed (30)
```

`npx tsc --noEmit` is **clean** for the whole project (`src/**`, all tests, configs).

Five source defects were found during QA, reported to the Lead with exact repros, and fixed. They are
now covered by permanent, spec-correct **regression tests** (`tests/qa/regressions.test.ts`) so they
cannot silently come back.

---

## 1. Suites and results (final tree snapshot `22ddf4f0`)

| # | File | Tests | Time | Focus |
|---|------|-------|------|-------|
| 1 | `tests/qa/worldStability.test.ts` | 5 | 31.0 s | 3 seeds x 30 game days headless world, economy integrity, autonomous NPC life, bounded logs, life-end archiving, determinism |
| 2 | `tests/qa/offlineCatchup.test.ts` | 3 | 8.7 s | 24h / 72h / 14d real offline gaps via `GameEngine`, truthful `OfflineSummary`, idempotency, bounded runtime, offline replay determinism |
| 3 | `tests/qa/economyIntegrity.test.ts` | 3 | 2.8 s | 30-day market/business stability, price clamps, restock, wages, player-shop daily settlement idempotency, atomic trades |
| 4 | `tests/qa/performance.test.ts` | 4 | 10.4 s | 20k probability decisions, 200k primitive draws, 56-NPC 30-day sim budget, 2000-entry history trimming, save/load size+time |
| 5 | `tests/qa/saveCorruption.test.ts` | 5 | 0.2 s | ping-pong slots, checksum corruption fallback, both-slots-corrupt error, version migration, invalid payload rejection, export/import/backup round-trip |
| 6 | `tests/qa/regressions.test.ts` | 8 | 9.8 s | permanent acceptance tests for the 5 fixed defects + offline-death screen reconciliation |
| 7 | `tests/scenarios/fullPlayerLifecycle.test.ts` | 2 | 6.6 s | one `GameEngine` through travel → forage → farm+harvest → craft → fish → social/dialogue, then save/load → offline night → death → archive → next generation |

Supporting harness: `tests/qa/support/qaHarness.ts` (real `ContentRegistry`, deep semantic state
validator, determinism fingerprints, real pathfinding travel driver, real fishing-lifecycle driver).

### Multi-seed 30-day world stability (seeds 101 / 202 / 303, 6-game-hour aggregation steps)

| Seed | Elapsed | Events | History | NPC decisions | Final life |
|------|---------|--------|---------|---------------|------------|
| 101 | 9.8 s | 117 | 276 | 40 302 | ended (burned out) |
| 202 | 5.6 s | 107 | 249 | 40 285 | ended |
| 303 | 5.0 s | 85 | 207 | 40 296 | ended |

Asserted for every seed: full state valid (ids resolve against the content pack, all numbers finite,
needs 0..100, emotions 0..1, money never negative, inventory valid, plot/fishing ranges valid,
probability streams finite); every market price inside the [40 %, 250 %] clamp band; shops restocked;
wage transactions recorded; **11 distinct NPC activities**, **56/56 NPCs with activity history**,
**~7 600-7 680 NPC-NPC relationship interactions** with no player present; every NPC simulated to the
final clock instant; events <= 400, history <= 800, transaction log <= 100, probability history
<= 5000; JSON save round-trip byte-identical; the unattended cigarette burns out inside the 30 days
(14-game-day lifetime) and `LifeState`/archive contain a complete review (endedAt > startedAt,
durationDays > 0). Same seed with identical stepping produced a byte-identical gameplay fingerprint;
seed 999 produced a different state.

### Offline catch-up (real `GameEngine.requestOfflineCatchup`, Node main-thread fallback)

| Real gap | Simulated | Steps | Length burned | Life | Summary changes | Runtime |
|----------|-----------|-------|---------------|------|-----------------|---------|
| 24 h | 72 game h | 144 (30-game-minute policy) | 7.5 % | alive | 60 | 2.10 s |
| 72 h | 216 game h | 9 (daily macro steps) | 22.5 % | alive | 60 | 1.33 s |
| 14 d | 336 game h (clamped to `maxOfflineGameDays` = 14) | 14 (daily macro steps) | 35.0 % | alive | 60 | 1.92 s |

Asserted: `summary.fromSimTime` equals the pre-request clock, `toSimTime - fromSimTime` equals
``min(summary.realElapsedMs / 1000 * offlineTimeScale, maxOfflineGameDays * 1440)`` (nominal gap within
5 sim-seconds despite `Date.now()` jitter), `simulatedGameHours == (to-from)/60`, the world clock lands
exactly on `toSimTime`, every `summary.newEvents` id exists in the returned `world.events`, all
change strings non-empty, NPC updates <= 8, state valid, no negative balances, pending-offline lock
fields updated, an **immediate second request is a no-op** (returns null, clock and money unchanged),
each catch-up < 15 s. Replaying the identical offline window from a cloned base state through
`runOfflineSimulation` twice produced a **byte-identical gameplay state, summary and step count**
(idempotent settlement result).

### Long-run economy

30 game days integrated from absolute timestamps in one aggregated runtime step (1.18 s):
230 market prices moved, 11 wage transactions, 21 NPCs employed, 13 staffed businesses, economic
index 1.132, transaction log bounded at 100, every business still stocked at least one line, no NaN /
negative money / out-of-clamp price, and a second identical run produced byte-identical economy state.

Player-shop (bought `biz_willow_grocery`, wallet seeded to 500 000 p as a documented fixture):
settlements observed on day indices 0 and 1 only (one per day), re-running `economy.update(0)` three
times at the settled instant added **no** extra settlement and did not change `lastSettledAt`,
player wallet and till stayed >= 0, settlement history days are unique, player money after two days
333 510 p. Trading atomicity: a purchase with an empty wallet returns `not_enough_money` and leaves
money, stock and inventory byte-identical; selling credits money and never produces a negative
balance.

### Performance measurements (final snapshot, standalone QA run; dev machine, Windows, Vitest 2.1.9)

| Workload | Measured | Budget asserted |
|----------|----------|-----------------|
| 20 000 probability `decide()` calls (3 weighted candidates + conditions) | **188.2 ms** (9.4 us/decision) | < 5 000 ms, < 1 000 us/decision |
| 200 000 primitive `roll()` draws | **20.1 ms** | < 5 000 ms |
| 20 000+ decisions: history cap | 5 000 records (cap honoured) | <= `WORLD_CONFIG.probability.historyLimit` |
| 56 NPCs x 30 game days headless (`runHeadlessSimulation`, 6-game-hour steps) | **9.8 s**, 40 305 decisions, 8.85 MB state JSON | < 30 s |
| 2 000 world-history inserts + load-repair trim | **2 000 -> 800 entries** | cap `maxHistoryEntries` = 800 |
| Save / load round-trip after 10 game hours (`SaveManager` + `MemorySaveStorage`) | **save 27.4 ms / load 7.2 ms / payload 1.87 MB** | < 3 000 ms each, < 32 MB |
| GameEngine 30-day world runs | 5.0-9.8 s per seed | test timeout 180 s |

Two fresh `ProbabilityEngine` instances with the same seed produced the same 200-decision sequence
and the same 5 000-sample `simulate()` distribution. `simulate()` is isolated from the live stream
state (live stream stats unchanged by sampling). Numbers vary with machine load (the same budgets
were met when the whole project suite ran in parallel); the table records the standalone run.

### Save / corruption / migration (real `SaveManager`, `MemorySaveStorage`)

- Ping-pong writes: saves alternate A/B; after three saves slot A = newest, slot B = previous,
  `meta.nextSlot` flips correctly, both envelopes pass FNV-1a checksum validation.
- Corrupting the newest slot checksum makes `load()` fall back to the older valid slot (state loaded,
  semantic validation passes).
- Corrupting both slots makes `load()` reject with a "corrupted" error and `exportSave()` returns null;
  loading a never-written slot returns null (not an error).
- A version-0 envelope (valid checksum) migrates to the current `WORLD_CONFIG.saveVersion`, updates
  `meta.saveVersion`, and preserves player data; a payload that parses and checksums but is missing
  `player` is rejected by `validateLoadedState` and `importSave` returns `ok:false`.
- Envelope export/import round-trips name and money; tampering (string replacement) is rejected;
  backup-bundle export imports through the backup parser; garbage JSON is rejected without throwing;
  full `SaveManager.load` returns a byte-identical payload to what was saved.

### Full player-lifecycle scenario (real `GameEngine`, headless)

Early-life chain: new game (56 NPCs, 25 000 p, life alive) -> walk home interior → home → forest
(real `WorldSystem.getPathTo` + adjacent `travelTo` dispatches, `location:changed` emitted, forest
visit recorded) -> forage 4 spring nodes (items + XP) -> farm at `willowbrook_farm`: till, plant
turnip, water, **collect real cigarette ash**, ash-fertilise the plot (potash > 0), grow through real
time integration and **harvest** (2 turnips) -> craft paper at the home workbench from foraged wood
(`itemsCrafted` 2) -> river fishing: full cast → wait → bite → tension minigame → land 1 fish
(`fishCaught` 1, `fish:caught` event) -> café: talk + full dialogue tree choice + end
(relationship interaction recorded) -> state valid, no negative balances, life alive.
Console evidence: `day=3 forage=4 crops=2 crafted=2 fish=1 conversations=1 ash=6 lengthRatio=0.778`.

Lifecycle chain: 120 game minutes of real play -> save slot -> 60 more minutes -> load (clock, money,
inventory, market, probability stream state, world identity all restored; screen `playing`) -> 24 h
offline night (72 game hours, summary produced and acknowledged) -> burn out the filter
(`time:rest`) -> `life.phase = ended`, screen `life_end`, life review built, archived in
`state.archive`, and **persisted as an archived life by SaveManager** -> `startNextLife([turnip_seed])`:
generation 2 alive, new lifeId, **continuous world time (simTime 5 130 - the new cigarette is lit in
the current world year, not restarted at year 1)**, same worldId and world events carried over,
archive preserved, exactly one legacy item in the inventory with `meta.legacy = true`, screen
`playing` -> generation 2 save and reload (generation/phase/state valid) with no crash.
Console evidence: `archived=1 gen=2 simTime=5130 futureTimedEventsAfterGeneration=0 legacyItems=1`.

---

## 2. Fixed defects with permanent regression tests (all verified fixed on the final tree)

All five were reported to the Lead mid-run with file:line, failing assertion and repro. Each is now
covered by a green regression test in `tests/qa/regressions.test.ts`, which asserts the
specification-correct behaviour end-to-end through the real `GameEngine`.

### BUG-1 (P0) - game-hour unit bug in 3 gameplay systems
`SECONDS_PER_GAME_HOUR = 60 * 60` was used where a game hour is 60 sim seconds
(1 sim second = 1 game minute; the canonical constant 60 is used by NPC, events, cooking, crafting,
building, life, world and economy modules). **Fixed.**
- `src/gameplay/FarmingSystem.ts` - crop growth was 60x too slow: a planted, watered turnip reached
  growth 0.34 after 144 ideal game hours and never matured inside the 14-game-day life. REGRESSION-1a:
  turnip matures and harvests in under ~2 game days, produce added to inventory.
- `src/gameplay/ForagingSystem.ts` - nodes respawned after ~60 game days instead of their configured
  20-72 game hours. REGRESSION-1b: gather, wait `respawnHours + 6`, re-gather succeeds.
- `src/gameplay/ExplorationSystem.ts` - search cooldown was 60 game hours instead of 1.
  REGRESSION-1c: rejected on cooldown at the same instant, available again after 2 game hours.

### BUG-2 (P0) - offline step aggregation unit bug
`src/simulation/SimulationRuntime.ts` multiplied an in-game-minute step by 60, so every offline
catch-up up to 60 game days executed as **one giant step** (measured `stats.steps === 1` for
24 h/72 h/14 d instead of the documented aggregation). **Fixed:** the runner now derives the policy
from real hours away (passed as `realElapsedMs`), uses game-minute steps directly
(1 sim second = 1 game minute) and the offline summary/progress/step clamps behave as documented.
REGRESSION-2 asserts multiple bounded aggregated steps for a 24 h absence; the QA suite observed
144 steps (24 h), 9 steps (72 h) and 14 steps (14 d, capped).

### BUG-3 (P0) - offline duration cap unit bug
`src/core/Game.ts` capped with `maxOfflineGameDays * 1440 * 60` (60x too generous): a 14-day absence
simulated 1 008 game hours (42 game days) instead of the configured cap, which burned the cigarette
out during the offline period. **Fixed** (cap corrected, `maxOfflineGameDays` = 14): 14 days offline
now simulates 336 game hours, leaves `lengthRatio` 0.65 and the life alive (REGRESSION-3).

### BUG-4 (P1) - offline burn multiplier not applied on the main-thread fallback
The `GameEngine` fallback called `SimulationRuntime.runOffline()` without setting
`state.flags.offline_simulation`, which `CigarettePhysicsSystem` uses to apply the 0.35 offline burn
multiplier (only `src/simulation/OfflineSimulation.ts` set it). Without a Web Worker the cigarette
burned at full rate (measured 24 h horizon: 0.214 burned vs 0.075 on the worker path, 2.86x).
**Fixed:** the fallback now sets/clears the flag around the run; both paths burn ~0.075 over the same
window. REGRESSION-4 asserts the difference is < 0.02 and inside [0.05, 0.1].

### BUG-5 (P1) - fishing was unreachable in normal play
The basic rod was defined in `src/data/items/core.ts` but no shop stocked it, no recipe produced it,
it was not in the starter inventory and no event/festival rewarded it; the only craftable rods
require fishing level 3, which requires casting - a hard lock (and the system error text mentioned a
tackle shop that did not exist). **Fixed:** the rod is now in the starter inventory and sold by the
grocery. REGRESSION-5 checks every content acquisition path and fishes end-to-end from a fresh game.

Additional improvements verified while re-testing the final tree: offline settlement is committed
atomically (save immediately after applying a worker/fallback result), an offline catch-up that ends
the life now returns `screen = 'life_end'` directly, and the next generation inherits **continuous
world time** instead of resetting the clock (scenario evidence above).

---

## 3. Residual risks and observations (not blocking)

1. **Offline summary stats are approximate (known, accepted - MINOR B).** `OfflineSimResult.stats.events`
   and `stats.transactions` are counts of recent log slices, not per-run counters; the transaction log
   is capped at 100 rows, so `stats.transactions` saturates at 100. `summary.changes` is capped at 60
   by design. The QA tests therefore assert summary *truthfulness* (ids exist, descriptions non-empty,
   simulated duration exact) instead of exact change counts.
2. **Save payload growth.** After 10 game hours the save envelope is **1.87 MB**; the 30-day state JSON
   is **8.85 MB**, dominated by the probability decision history (capped at 5 000 full candidate
   records). IndexedDB handles this, but the cap and serialisation cost should be watched (save 27 ms /
   load 7 ms at 10 game hours; profile again with a full 5 000-decision history).
3. **Real-browser Worker + hidden-tab LOD2 simulation are wired in but not exercisable headlessly.**
   On the final tree the live browser path is:
   `main.ts` listens for `visibilitychange` -> `Game.startBackgroundSimulation()` while hidden and
   `Game.stopBackgroundSimulation()` when visible; while hidden, `Game.tick()` pauses the main-thread
   simulation so the Worker snapshot can be applied without double-simulating; every 5 s
   `Game.runHiddenBackgroundChunk()` clamps the elapsed real time (max 300 s), sends
   `worker.requestBackground(structuredClone(state), realSeconds * offlineTimeScale)`, applies the
   returned state only when it advances the clock, re-checks life end, and saves on visibility return
   (`src/core/Game.ts` hidden-simulation section; `src/workers/WorkerBridge.ts` requestBackground;
   `src/simulation/BackgroundSimulation.ts`). This **should be covered by the verifier's browser
   acceptance**: hidden -> visible round-trip, no double simulation or clock jump, merge keeps
   pending-offline locks intact, save on return, life-end during hidden simulation, and the real
   Worker offline path (the Node suite always takes the main-thread fallback and logs
   "Web Worker unavailable"). `WorkerBridge.requestBackground` protocol correctness is likewise only
   browser-verifiable.
4. **Headless environments never use the real Worker.** In Node, `GameEngine` falls back to the
   main-thread offline simulation (warn logged). The fallback's behavioural parity with the worker
   path is covered by REGRESSION-4, and the worker's core logic is the same
   `SimulationRuntime.runOffline` exercised directly through `runOfflineSimulation`, but the
   postMessage/Worker bridge itself is not covered by this headless suite.
5. **Test fixtures are explicit where a full real playthrough would be impractical:** QA seeds the
   player wallet before buying a shop (150 000-350 000 p capital), places one NPC at the café for the
   dialogue step, and forces `lengthRatio` low to end the life deterministically. Every state
   transition that the fixture feeds into is still the real system under test.
6. **Aggregation steps for the 30-day headless runs are 6 game hours** (chosen to keep the QA suite
   under ~35 s while still exercising the documented large-dt tolerance). The same runner supports
   30-game-minute steps; smaller steps change runtime, not the asserted invariants. Offline
   aggregation policy is measured per real gap: 24 h -> 144 (30-game-minute) steps, 72 h -> 9 and
   14 d -> 14 (daily macro) steps.
7. **Long headless suites are CPU-heavy and timing-sensitive across machines.** Suite wall time ranged
   ~32-140 s between runs depending on concurrent agent load (the full project suite ranged 38-139 s);
   the individual performance budgets are therefore generous and the assertions use ranges/upper
   bounds, not exact timings.
8. **Determinism policy.** Same seed + same stepping produces byte-identical gameplay state. The
   comparison fingerprint deliberately excludes wall-clock-only fields (`meta.*`, `pendingOffline.*`,
   `clock.lastRealTimestampMs`), which are persistence bookkeeping rather than gameplay. Random gameplay
   ids are produced by `configureIdGenerator(seed)` + counter, so they are reproducible too.
9. **World event/history volume** is now healthy on the final tree: 85-117 world events and 207-276
   history entries over 30 unattended game days with player absent; the logs stay within their
   configured caps (400 / 800).

## 4. Whole-project verification (final tree snapshot `22ddf4f0`)

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `npx tsc --noEmit` | **clean** (exit 0, no output) |
| Whole project suite | `npx vitest run` | **93 files / 941 tests / 941 passed**, 38.1 s |
| QA + scenario suites | `npx vitest run tests/qa tests/scenarios` | **7 files / 30 tests / 30 passed**, 32.7 s |

The snapshot hash was computed before and after the verification runs and was unchanged
(`22ddf4f0a7b1917b235f845916f22a03005e454f8127cfafef96ee6ce48c4c69`), so every number in this report
belongs to one and the same tree. Transient UI-smoke failures and `tests/ui/**` type errors observed
during earlier, still-moving revisions of the tree do not reproduce on this snapshot and are no
longer reported as open issues.

## 5. Reproducing

```powershell
# QA + scenario suites only (the deliverable of this task)
npx vitest run tests/qa tests/scenarios

# whole project (all agents' suites included)
npx vitest run
npx tsc --noEmit
```

All tests are deterministic and seed-fixed (world seeds 101/202/303/999, offline 7101-7201, economy
8801-8803, lifecycle 13579, scenario 24680, probability 20260101, save 123456/2222/3333/4444/5555/6666,
performance 424242/5150/7001). No network, no wall-clock decisions, no `Math.random()`.

## 6. Files added by this task

- `tests/qa/support/qaHarness.ts` - shared deterministic harness and semantic state validator
- `tests/qa/worldStability.test.ts`
- `tests/qa/offlineCatchup.test.ts`
- `tests/qa/economyIntegrity.test.ts`
- `tests/qa/performance.test.ts`
- `tests/qa/saveCorruption.test.ts`
- `tests/qa/regressions.test.ts`
- `tests/scenarios/fullPlayerLifecycle.test.ts`
- `docs/QA_REPORT.md` (this report)
