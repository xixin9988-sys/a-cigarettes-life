# Acceptance Report - A Cigarette's Life / 《香烟的一生》

Independent end-to-end acceptance verification of the **real, built game** in a headless browser.
Author: independent acceptance verifier (task-13). Date: 2026-11-19 (Europe/London).

**Verdict: PASS - 17 / 17 acceptance scenarios passed, 0 failed, 0 skipped.**
**Latest re-verification run: 2026-11-19T05:19:26Z -> 2026-11-19T05:21:36Z, with ZERO console errors
and zero failed network requests** (the earlier run on the same day had 3 benign `/favicon.ico` 404s;
that and the fishing-wait unit bug were fixed post-freeze and re-verified).

Five findings came out of this acceptance pass: two critical defects (scene-transition crash, save corruption)
were fixed before the first frozen run, and the two non-blocking ones (fishing bite-wait units, missing
favicon) plus one stale QA test expectation were fixed after it and re-verified here. See
[Bugs](#6-bugs-found-and-status) and [Verification history](#9-verification-history).

---

## 1. Verified tree / build identity

There is no git repository in the workspace, so the frozen tree is identified by build hashes and
file timestamps:

| Item | Value |
|---|---|
| Tree state | acceptance-frozen tree 2026-11-19 ~05:09; **two post-freeze source fixes** landed for the residual acceptance findings: `src/gameplay/FishingSystem.ts` bite-wait units 05:18:53 and `public/favicon.ico`/`public/favicon.png` + `index.html` link 05:18:39 (nothing else changed; `SaveManager.ts` still 05:05:53) |
| Production build (re-verified) | `npx vite build` -> exit 0, 7.63 s |
| App bundle | `dist/assets/index-BTRRq9z_.js` - 2,783.17 kB (gzip 711.77 kB) |
| Worker bundle | `dist/assets/simulation.worker-DSDeOCdE.js` - 818.58 kB |
| Build idempotence | repeated clean builds on the same tree produced identical asset hashes |
| Host | Windows, Node v24.21.0, project version 1.0.0 |
| Browser | Chrome 157.0.8103.81 (headless) driven by playwright-core 1.65.1 |
| Server | `npx vite preview --port 4173 --host localhost` (serves `dist/`) |
| Latest acceptance run | **2026-11-19T05:19:26Z -> 2026-11-19T05:21:36Z** (~130 s) |

## 2. Method

`scripts/acceptance-playthrough.mjs` drives the production build in headless Chrome. Input is real
wherever a player has the same interaction (mouse clicks on DOM UI, WASD/E keyboard in the Phaser
world); the published `window.__A_CIGARETTES_LIFE__` hook (`{ game, ui, phaser }`) is used for
assertions and for a small number of actions whose UI path is awkward. All state changes go through
the public `GameEngine.dispatch(action)` / `GameEngine` API - no state is injected into game logic.

Deliberate accelerators (also printed in the harness source and the JSON results):

1. **Wall-clock compression with `game.tick()`** - e.g. the fishing bite wait is advanced with the
   same per-frame simulation calls a real wait would produce, just faster. This is not a state hack.
2. **Offline absence anchor** - the 24 h absence is simulated by rewinding
   `pendingOffline.lastSaveRealMs` by 24 h and anchoring `lastOfflineSimTime`/`lastProcessedSimTime`
   at the current clock (exactly what a closed tab produces). The offline simulation then runs for
   real in the **Web Worker**; the summary, atomic save and modal are genuine.
3. **Life end** - the remaining ~16 in-game days of life are slept through with the same
   `time:rest` action a bed uses (24 h chunks), because passively burning out takes ~5.6 real hours.
4. Where a living-world panel re-rendered its DOM between Playwright actionability checks, the
   harness falls back to dispatching the same `GameAction` the clicked button dispatches; this is
   reported per scenario where it happened.

Command sequence used for the frozen run:

```powershell
npx tsc --noEmit
npx tsc -p tsconfig.worker.json --noEmit
npx vitest run
npx vite build
node scripts/acceptance-playthrough.mjs      # against vite preview :4173
```

Outputs: `smoke/acceptance-results.json` (full per-step evidence), `smoke/acceptance-console.log`
(every browser console entry with timestamps), 25 screenshots `smoke/acceptance-*.png`.

## 3. Static checks / build results (commands run by the verifier)

| Command | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` | **PASS**, exit 0 | empty log (`smoke/build-logs/final-typecheck.log`) |
| `npx tsc -p tsconfig.worker.json --noEmit` | **PASS**, exit 0 | empty log (`smoke/build-logs/final-typecheck-worker.log`) |
| `npx vitest run` | **1 failed / 940 passed** on the pre-postfix tree (93 files, 60.9 s) | log `smoke/build-logs/final-vitest.log`; single failure `tests/qa/performance.test.ts:174` (BUG-5). Lead subsequently fixed that stale expectation (05:09:36); authoritative final suite numbers are taken by the docs agent on an idle machine (perf thresholds are contention-sensitive: 30-day QA world test 18 s idle vs 39 s under load). |
| `npx vite build` | **PASS**, exit 0, 7.63 s on the re-verified tree | deterministic hashes in section 1; log `smoke/build-logs/reverify-build.log` |

Typecheck/worker-typecheck/vitest were last run by the verifier on the pre-postfix frozen tree; the
post-freeze fixes were verified by rebuilding and re-running the browser acceptance (which exercises
the compiled code), and the docs agent runs the authoritative final static suite on the idle machine.

## 4. Scenario results (latest re-verified run)

All 17 scenarios were executed on the frozen production build; 25 screenshots were captured.

| # | Scenario (real player path unless noted) | Result | Key evidence |
|---|---|---|---|
| S01 | Boot + main menu render | **PASS** | `screen=menu`, `MainMenuScene` active, canvas 1440x900 WebGL, 6 menu buttons, boot overlay hidden; [shot 01](../smoke/acceptance-01-boot-main-menu.png) |
| S02 | Character creation starts a real new life | **PASS** | New Life -> name "Acceptance Ash", pattern stripe, face wink, seed 424242, "Light it" -> `screen=playing`, InteriorScene "My Little Home", 56 NPCs, 8 skills, £250.00, HUD visible; [shot 02](../smoke/acceptance-02-character-creation.png), [shot 03](../smoke/acceptance-03-new-life-world.png) |
| S03 | World renders and player moves with WASD | **PASS** | player sprite moved 80 px, `statistics.steps` 0 -> 5, canvas rendering confirmed visually; [shot 04](../smoke/acceptance-04-world-moved.png) |
| S04 | Inventory panel opens/renders + real UI action | **PASS** | "Inventory" panel with 7 stacks, Protection/Craft/Cook sections, Collect-ash button clicked (empty tray -> honest toast); [shot 05](../smoke/acceptance-05-inventory-panel.png) |
| S05 | Map panel + travel | **PASS** | SVG map with 22 discovered nodes; a non-adjacent node only offers a **disabled** "Walk to" button (adjacency enforced); 5 real "Walk to" hops home-interior -> Residential Lane -> Park -> Plaza -> Centre -> Market; [shot 06](../smoke/acceptance-06-map-panel.png), [shot 07](../smoke/acceptance-07-map-travel-arrived.png) |
| S06 | NPC dialogue via real world interaction | **PASS** | walked to an NPC sprite in Willowbrook Bakery (market was empty at that hour, so the harness followed NPCs), pressed **E**, dialogue opened with Rosa Bellamy, picked "1. Ask how they are doing.", relationship created; [shot 08](../smoke/acceptance-08-npc-dialogue.png) |
| S07 | Social/Life/Journal/Events/Skills panels + gift | **PASS** | Social lists Rosa; Quick chat `ok` with `affinityDelta 3.39` (affinity 0 -> 3.39, firstMeeting); Box of Matches gift accepted (`affinityDelta 2.05`, giftsGiven 0 -> 1, via action fallback because the panel re-rendered); Life/Journal/Events panels render real data; Skills opened with the **Y** key (shortcut bound); [shots 09-13](../smoke/acceptance-09-social-panel.png) |
| S08 | Real shop transaction | **PASS** | opened the market's "Shop & work" panel at Holloway's Catch, clicked "Buy 1": money 25000 -> 24755 (-£2.45), `itemsBought` +1, newest ledger entry `{type:buy, actor:player, business:biz_willow_market_stall, item:fish_trout, totalPrice:245}`; [shot 14](../smoke/acceptance-14-shop-purchase.png) |
| S09 | Employment: apply + work a shift | **PASS** | applied for "Farmhand" at Quinn's Field Farm (a free entry-level slot), then `work:shift`: occupation Farmhand, `shiftsWorked=1`, +£9.00 |
| S10 | Fishing: cast -> bite -> reel -> land | **PASS** | cast at River Wellow (`fishing.casts` +1; panel opened then "Cast the line"), bite reached after only **4 accelerated ticks** (with the post-freeze fix the bite wait is now 4-22 real seconds at 1x, not 4-22 wall minutes), reeling minigame driven with the real `fish:reel` hold/release action, landed a **21.3 cm Perch** (`catches=1`, `fishCaught=1`); [shot 15](../smoke/acceptance-15-fishing-cast.png), [shot 16](../smoke/acceptance-16-fishing-result.png) |
| S11 | Farming loop | **PASS** | tilled a plot at Thornfield Farm, planted a turnip seed, watered, collected cigarette ash and used it as potash fertiliser (potash 0.25), grew through 6 h rest/water cycles to `stage=mature`, harvested **2 Turnips** (cropsHarvested 0 -> 2); [shot 17](../smoke/acceptance-17-farming-state.png) |
| S12 | Foraging + crafting | **PASS** | foraged "Fallen Branches" (wood) in Whispering Woods, travelled to the farm-shop workbench, crafted "Saw Planks" (job completed, itemsCrafted=2); [shot 18](../smoke/acceptance-18-crafting-complete.png) |
| S13 | Save -> page reload -> load | **PASS** | saved via Settings -> Saves -> "Save now", page reloaded (menu shown again), Save slots modal listed the life, Load restored **Acceptance Ash**, money £256.05, location farm interior, generation 1; loaded clock >= saved clock; [shot 19](../smoke/acceptance-19-saved.png), [shot 20](../smoke/acceptance-20-continue-save-slots.png), [shot 21](../smoke/acceptance-21-loaded-world.png) |
| S14 | Offline catch-up in the real Web Worker | **PASS** | simulated 24 h absence: summary headline "While you were away for 3 days 0h, the world kept turning. 60 notable things happened.", `simulatedGameHours=72`, `realElapsedMs=24 h`, 25 new events, 60 changes, 8 NPC updates, `workerReady=true`, worker fallback disabled; clock 3844.5 -> 8164.5; summary modal rendered + dismissed with "Welcome back"; automatic atomic save observed (slot `savedAt` advanced); an immediate second catch-up returns `null`; [shot 22](../smoke/acceptance-22-offline-summary-modal.png) |
| S15 | Hidden-tab LOD2 background simulation | **PASS** | `startBackgroundSimulation()` -> active; after 7 s the Worker chunk had been applied (`pendingOffline.lastProcessedSimTime` advanced) and the clock advanced 8171.1 -> 8176.8; `stopBackgroundSimulation()` -> inactive; [shot 23](../smoke/acceptance-23-background-sim.png) |
| S16 | Life end -> life review -> next generation | **PASS** | slept final 11 x 24 h: phase `ended`, lengthRatio 0, reason "Your cigarette body burned down to the filter.", life archive entry written; LifeEndScene burnout then review modal "The life of Acceptance Ash"; clicked "Light the next cigarette" -> generation 2, name **Acceptance Ash II**, same worldId, history/NPC population/archive persisted, HUD visible; [shot 24](../smoke/acceptance-24-life-review-modal.png), [shot 25](../smoke/acceptance-25-next-generation.png) |
| S17 | Console/page-error sweep | **PASS** | **14 console entries, 0 errors, 0 request failures, 0 favicon 404s.** No JS exceptions, no pageerror, no failed module/worker/asset load. `/favicon.ico` and `/favicon.png` now both served with HTTP 200. |

## 5. Console error log (latest re-verified run)

```
(no console.error, no pageerror, no requestfailed, no HTTP >= 400)
```

14 console entries total, all informational (`[game] WorldSystem initialised`,
`[game] Offline simulation complete ...`) or SwiftShader WebGL performance warnings.
The complete log is `smoke/acceptance-console.log`. For comparison, the earlier run before the
favicon fix recorded exactly 3 x 404 `/favicon.ico` and nothing else.

## 6. Bugs found and status

### BUG-1 (CRITICAL - found by acceptance, fixed before freeze): world-scene transitions crashed the renderer
- **Symptom:** moving between two locations that share a Phaser scene class (e.g. home exterior ->
  park, both `TownScene`) left **no active world scene** (black canvas, `activeScenes=[]`), with
  pageerror `Cannot read properties of null (reading 'setSize')`.
- **Root cause:** `src/scenes/BaseWorldScene.ts` `create()` called `applyCameraZoom()` **before**
  constructing the new `WeatherFXController`; on `scene.restart()` the previous controller's
  rectangles had already been destroyed by scene shutdown (`geom === null`), so its `resize()`
  threw and the scene never reached RUNNING.
- **Fix (scenes owner):** controller references are dropped on shutdown (`disposeControllers()`),
  `applyCameraZoom()` no longer resizes a stale weather controller, and the new controller is
  resized after construction.
- **Verified:** final build S05/S06/S08 all pass with scene changes and no pageerror.

### BUG-2 (CRITICAL - found by acceptance, fixed before freeze): saves written while playing could not be loaded
- **Symptom:** `saveGame()` returned ok and `listSaveSlots()` showed the slot, but loading it failed:
  `Load failed: Both save slots are corrupted for slot_1`; console warning
  `[game] Corrupted save slot detected, trying backup slot slot_1:A`.
- **Root cause:** `src/persistence/SaveManager.ts` `save()` computed the FNV-1a checksum over the
  **live** `GameState`, then awaited `readMeta()` while the rAF simulation kept mutating that same
  object; IndexedDB finally stored the mutated state, so the checksum no longer matched the payload.
  The fake-IndexedDB tests missed it because nothing ticks during their saves.
- **Repro:** newGame -> wait 2.5 s -> `saveGame('slot_probe')` -> page reload -> `loadGame` -> corrupt.
- **Fix (Lead):** `structuredClone` the live state into a frozen snapshot first, apply stamps/history
  trim to the snapshot, checksum the snapshot, mirror stamps to live state, then write. Checksummed
  payload and stored payload are now identical.
- **Verified:** S13 (save -> reload -> load) passes, including while the simulation is ticking.

### BUG-3 (FOUND HERE, FIXED POST-FREEZE, RE-VERIFIED): fishing bite delay was 60x the configured value
- Original defect: `src/gameplay/FishingSystem.ts` computed
  `waitSeconds = Math.max(45, waitMinutes * 60 * waitMultiplier)` from
  `WORLD_CONFIG.fishing.baseBiteWaitGameMinutes` (`src/core/WorldConfig.ts:91`, 4-22 game minutes).
  With the project convention 1 sim second = 1 game minute (`WorldConfig.worldTime.secondsPerGameMinute = 1`),
  the correct conversion is `waitMinutes` (x1); the old code waited 4-22 in-game **hours**,
  i.e. **4-22 real minutes at 1x** per cast.
- Fix landed 2026-11-19 05:18:53 (`src/gameplay/FishingSystem.ts`): `waitMinutes` used directly with a
  4-second floor - cast->bite is now 4-22 real seconds at 1x.
- **Re-verified:** S10 on the re-verified build reached the bite after only **4 accelerated ticks**
  (the harness compresses the wait, but the wait is now seconds not minutes) and landed the 21.3 cm
  Perch. No other fishing behaviour changed.

### BUG-4 (FOUND HERE, FIXED POST-FREEZE, RE-VERIFIED): missing favicon 404s
- Original defect: `index.html` referenced no icon and `public/` shipped none, so Chrome requested
  `/favicon.ico` (3x per page load/reload) and logged 404 console errors. No gameplay impact.
- Fix landed 2026-11-19 05:18:39: `public/favicon.ico` + `public/favicon.png` added and linked from
  `index.html`.
- **Re-verified:** both `/favicon.ico` and `/favicon.png` are served with HTTP 200 and the latest
  full run recorded **0 console errors, 0 request failures, 0 favicon 404s** (S17).

### BUG-5 (FOUND HERE, STALE TEST EXPECTATION, FIXED POST-FREEZE): one QA performance test
- Original failure: `tests/qa/performance.test.ts:174` compared
  `gameplayFingerprint(loaded)` against the **live** state:
  `expect(gameplayFingerprint(loaded)).toBe(gameplayFingerprint(game.getState()))`.
- Cause: the new SaveManager snapshot intentionally caps `probability.history` at 400 entries for
  save size, while the live engine keeps its full in-memory ring, so loaded and live differed in that
  **debug-only** field. The rest of the game state round-tripped exactly (S13 proves the
  player-visible behaviour; payload bounds still passed).
- Fix landed 2026-11-19 05:09:36 (`tests/qa/performance.test.ts`): now compares against an
  equivalently-trimmed copy. This was a stale test expectation, not a product defect; the docs agent
  takes the authoritative idle-machine vitest numbers.

### Observations (not defects)
- **O-1:** The Social panel re-renders as the living world changes NPC activities/moods, so DOM
  buttons can be replaced between Playwright actionability checks. The harness fell back to
  dispatching the same `social:talk`/`social:gift` actions; both produced full state changes
  (affinityDelta 3.39 / 2.05). A real player click lands between re-renders; minor UI churn only.
- **O-2:** `LifeEndScene` deliberately plays a ~7.2 s burnout animation before the review modal
  (Lead-confirmed timing); the harness waits up to 12 s, as a player would.
- **Verified fixed from earlier findings:** old map "Go" buttons no longer teleport to non-adjacent
  locations (non-adjacent map nodes show a disabled "Walk to"); Skills now has the Y shortcut;
  boot 404s are favicon-only.

## 7. Coverage & limitations (honest scope)

- Browser tested: headless Chrome + SwiftShader WebGL; DOM UI, Phaser world, IndexedDB and the real
  simulation Web Worker were exercised. Audio output was not verified (AudioManager runs, no
  assertion on sound).
- Regions: all deep traversal was in **Willowbrook**; Ashford City, trains/tickets, interiors beyond
  the farm shop, building/housing/collection/archive panels were not part of the required scenario
  list and were not fully played through here (the panels registry was smoke-opened for
  events/skills/life/journal; other UI panels were exercised by unit/QA suites, not acceptance).
- Offline catch-up was simulated through a 24 h saved-absence anchor (real worker run) rather than
  waiting 24 h; hidden-tab LOD2 was tested by the public start/stop API (7 s window).
- Life end was accelerated with the real `time:rest` action rather than waiting ~5.6 real hours.
- The run is deterministic in flow but not bit-identical between runs (world simulation is seeded;
  NPC movement can make the NPC to talk to differ).
- Re-run command: `node scripts/acceptance-playthrough.mjs` (env: `ACCEPTANCE_URL`,
  `ACCEPTANCE_CHROME`, `ACCEPTANCE_PREFIX`, `ACCEPTANCE_HEADFUL=1`). It exits non-zero if any
  scenario fails and rewrites `smoke/acceptance-results.json` + screenshots.

## 8. Screenshot index (all 25, in `smoke/`)

| File | Shows |
|---|---|
| acceptance-01-boot-main-menu.png | Main menu over the pixel-art city backdrop |
| acceptance-02-character-creation.png | Character creation modal (name, colours, pattern, face, seed) |
| acceptance-03-new-life-world.png | First frame of the new life in "My Little Home" |
| acceptance-04-world-moved.png | Interior after WASD movement, HUD status |
| acceptance-05-inventory-panel.png | Inventory panel: items, protection, craft/cook |
| acceptance-06-map-panel.png | SVG world map with nodes and detail panel |
| acceptance-07-map-travel-arrived.png | Arrived at Willowbrook Market |
| acceptance-08-npc-dialogue.png | Dialogue with Rosa Bellamy, choices visible |
| acceptance-09-social-panel.png | Social panel (relationships, gift button) |
| acceptance-10-life-panel.png | Life & cigarette panel |
| acceptance-11-journal-panel.png | Journal (world history/letters) |
| acceptance-12-events-panel.png | Events & festivals panel |
| acceptance-13-skills-panel.png | Skills & goals panel |
| acceptance-14-shop-purchase.png | Shop panel after buying a fish |
| acceptance-15-fishing-cast.png | Fishing panel right after casting |
| acceptance-16-fishing-result.png | After landing the Perch |
| acceptance-17-farming-state.png | Farm plot after harvest |
| acceptance-18-crafting-complete.png | Inventory/crafting after crafting planks |
| acceptance-19-saved.png | Settings save action |
| acceptance-20-continue-save-slots.png | Save slots modal after page reload |
| acceptance-21-loaded-world.png | World after loading the save |
| acceptance-22-offline-summary-modal.png | "While you were away" offline summary modal |
| acceptance-23-background-sim.png | World during hidden-tab LOD2 test |
| acceptance-24-life-review-modal.png | Life review modal after burnout |
| acceptance-25-next-generation.png | Generation 2 ("Acceptance Ash II") alive in Willowbrook |

## 9. Verification history

| Run | Tree | Result | Notes |
|---|---|---|---|
| #1 - 2026-11-19T05:14:20Z -> 05:16:30Z | pre-postfix frozen build (`index-DGBPI_nu.js`) | 17/17 PASS | full journey; 3 benign `/favicon.ico` 404s; fishing wait still 60x (harness compressed it with `game.tick`) |
| #2 - **2026-11-19T05:19:26Z -> 05:21:36Z** | **re-verified build (`index-BTRRq9z_.js`) after the fishing-unit + favicon fixes** | **17/17 PASS, 0 console errors, 0 failed requests** | S10 bite reached after 4 accelerated ticks (now real seconds); S17 zero favicon 404s; S13 save/load still green; full report numbers above are from this run |

Pre-acceptance findings (run #1 discovery) that were fixed before first freeze: same-scene Phaser
transition crash (BUG-1) and save checksum/IndexedDB race (BUG-2); both re-verified in run #1 and #2.

## 10. Repro summary

```powershell
npx vite build
# serve the frozen build (already running on :4173 in this workspace):
npx vite preview --port 4173 --host localhost
node scripts/acceptance-playthrough.mjs
# then inspect smoke/acceptance-results.json + smoke/acceptance-console.log + screenshots
```

**Bottom line:** on the re-verified production build, the required end-to-end player journey works:
boot/menu -> character creation -> rendered world with movement -> inventory/map/travel/social/life/
journal/skills panels -> NPC dialogue -> real shop purchase -> fishing minigame -> farming ->
foraging/crafting -> save/reload/load -> offline catch-up (real Worker, honest summary, atomic save)
-> hidden-tab background simulation -> life end -> next generation, **with zero console errors and
zero failed requests**. Four defects were found by this acceptance pass in total: the two critical
ones (same-scene transition crash, save corruption) were fixed before the first frozen run; the two
non-blocking ones (fishing wait units, favicon) and one stale QA test expectation were fixed
post-freeze and re-verified in the latest run.
