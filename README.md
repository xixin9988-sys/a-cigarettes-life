# A Cigarette's Life / 香烟的一生

A complete 2D top-down, probability-driven **living world** life simulation for the browser.
You play an anthropomorphic cigarette in Willowbrook village and Ashford City: farm, forage,
fish, explore, craft, cook, build, decorate, work, run a shop, make friends, fall in love,
attend festivals - or sit in the park and quietly burn down while the world keeps living
around you.

Every uncertain outcome (weather, NPC decisions, relationships, fish, crops, prices, events)
is resolved by one unified deterministic probability engine. The world keeps running while you
are away: NPCs work and socialise, shops trade, prices move, crops grow and events unfold,
simulated in a Web Worker and summarised when you return.

## 一键启动（Windows）

双击项目根目录的 **`启动游戏.bat`**（或 `start-game.bat`）。启动器会：

1. 检查 Node.js / npm（首次运行缺少 `node_modules` 时自动执行 `npm install`）；
2. 在 3000（被占用时自动顺延到下一个空闲端口）启动本地游戏服务；
3. 等待游戏就绪后用默认浏览器打开；
4. 游戏先播放 **Synthelix 开场动画**（`public/beginning.html`），动画结束或点击跳过后进入主菜单。

关闭启动器打开的“A Cigarette's Life - game server”命令行窗口即可结束游戏服务。
若启动异常，项目根目录的 `launcher.log` 会记录启动过程的每一步（已改用不依赖系统代理的本地 TCP 检测，避免启动卡住）。

命令行等价方式：

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-game.ps1
    # 只启动服务、不自动打开浏览器：
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-game.ps1 -NoBrowser

开场动画在每次启动时播放；点击画面任意处、按 Enter/Space/Esc 或点击右上角“跳过 SKIP”可跳过。
自动化/无头运行可使用 `http://localhost:3000/?skipIntro=1` 直接进入主菜单。

## Quick start

Requirements: Node.js 20+ (tested on Node 24.21.0) and a modern browser with Web Worker,
IndexedDB and Web Audio support. No server, account, network dependency or LLM is required to
play; saves stay in your browser.

    npm install
    npm run dev        # http://localhost:3000

    npm run build      # strict typecheck (app + worker) + production build
    npm run preview    # serve the production build
    npm test           # vitest suites
    npm run lint       # eslint src tests
    npm run typecheck  # tsc app project + tsc worker project

## Browser acceptance (headless Chrome)

The real production build is exercised end-to-end by a Playwright-core script (Chrome is
driven headlessly; no test framework server is involved). Build and serve the production bundle,
then run the acceptance playthrough:

    npm run build
    npx vite preview --port 4173 --host localhost
    node scripts/acceptance-playthrough.mjs

The script uses the installed Google Chrome (documented path in the script), the
playwright-core devDependency, and appends `?skipIntro=1` so the studio intro does not
intercept the automated flow. It boots the game, creates a life, moves/talks/shops/fishes/farms/
crafts, saves + reloads, runs a real Web Worker offline catch-up and hidden-tab background chunk,
ends the life and starts the next generation. Evidence is written to smoke/: acceptance-results.json,
acceptance-console.log and 25 screenshots (smoke/acceptance-*.png). The independent verdict is in
docs/ACCEPTANCE_REPORT.md (17/17 scenarios passed on the frozen build).

## Controls

| Input | Action |
|---|---|
| W A S D / arrow keys | walk around the current location |
| E | interact: talk to a nearby NPC, enter a building, use a facility |
| Space | confirm; hold to reel while fishing |
| 1-9 | pick a dialogue choice |
| I | inventory, equipment, crafting & cooking |
| M | map, travel and train timetable |
| K | social: relationships, invitations, community |
| L | life, cigarette body, influence, statistics |
| J | journal: world history, letters, offline summary |
| B | building projects / blueprints |
| H | housing: rooms, furniture, storage, paint |
| C | collection & museum |
| Y | skills, goals & achievements (default binding; see Help) |
| Tab | help panel (controls, panels, survival rules) |
| F12 | probability debugger (seed, streams, live decisions) |
| Esc | close panel / back to menu |

All panel keys are rebindable in Settings -> Controls (click a key cap, then press the new key).
Character creation lets you choose the cigarette body colour (HEX), filter colour, pattern,
face and an optional seed for a reproducible life.

## What is implemented

- **Probability engine** - SplitMix64 + Xoshiro128**, 31 independent persisted streams,
  conditions, additive/multiplicative modifiers, weight clamps, prefix/alias sampling,
  bounded decision history, replay, causal traces, F12 debugger. No Math.random() in the game
  code (enforced by ESLint and a test that scans src/).
- **Living world** - 45 exterior locations (25 Willowbrook + 20 Ashford) plus 45 interiors,
  per-season Markov-chain weather, 28-day seasons, day/night, per-location microclimate, four
  train routes with timetables/tickets, secret locations and a capped shared world history
  that survives generations.
- **Three simulation levels** - fixed-step active main-thread simulation; a hidden-tab
  background loop (LOD2-lite) that hands the world to the Web Worker while the tab is throttled
  or hidden and merges the advanced state on return; and offline catch-up with adaptive
  real-hour time-step aggregation, progress reporting, idempotent settlement, an automatic
  atomic save after settlement, and a summary of what really changed.
- **56 NPCs** (14 major + 42 residents) with 12 personality traits, 9 needs, 6 emotions,
  schedules, utility AI + probability decisions, Ebbinghaus memories with permanent important
  events, independent NPC-NPC relationships, romance, rivalries and breakups.
- **Economy** - 22 businesses across 17 types with stock/hours/owners/employees/customers,
  supply-and-demand prices clamped to 0.4-2.5x base, NPC budgets, wages with tax, hourly and
  daily settlements, player jobs and a player-run shop.
- **Gameplay** - 19 crops (with cigarette-ash fertiliser), 46 seasonal forage nodes, 16 fish
  with a real cast/bite/reel tension minigame, exploration clues/photos/secrets, 100 recipes
  (69 craft + 31 cook), 29 furniture items with grid housing, 17 building blueprints, 10
  collection categories, 8 skills up to level 20, dialogue trees (18 trees, 314 nodes, 1135
  choices), gifts, invitations, romance, apologies and 8 community proposals.
- **Cigarette existence** - lengthRatio burns down over 336 game hours by design, wind burns
  faster, rain and humidity soak you, shelter/fire dry you, protection equipment helps, ash is
  a real resource; a life that burns out writes an honest archive review, and a new generation
  can inherit up to three mementos while the world continues.
- **Quests of a small life** - 37 achievements, 20 personal goals, influence ladder, letters,
  statistics and a life review generated from real records.
- **Persistence** - versioned, FNV-1a-checksummed ping-pong IndexedDB saves (crash fallback),
  migrate/validate, export/import, archive store for past lives, offline idempotency markers.
  Saving freezes a save-time snapshot so the checksum always matches the written payload even
  while the simulation keeps ticking; offline settlement is committed immediately.
- **Presentation** - Phaser 3 scenes with procedural pixel art (no external asset packs), an
  animated cigarette sprite that shortens as it burns, weather/season/day-night effects, and a
  full DOM UI: HUD, 18 panels, character creation, save slots, offline summary, life review,
  notifications. Procedural Web Audio ambience/music/SFX starts on the first user gesture.
- **Tests** - 93 vitest files / 941 tests, all green on the frozen tree: probability engine,
  simulation/offline, NPC autonomy, economy stability, every gameplay system, persistence,
  contracts, QA stress, UI/view-model and Phaser-free render-layer tests, audio and a
  full-lifecycle scenario; plus an independent 17/17 browser acceptance run. Results and known
  gaps are in docs/TEST_REPORT.md.

The game is fully offline and procedural: pixel art and audio are generated/rendered in code
rather than shipped as large asset packs.

## Project layout

    src/
      core/         contracts/state root, clock, event bus, registry, GameEngine, world factory
      probability/  deterministic probability engine and tooling
      simulation/   runtime composition, LOD drivers, offline summary, replay, snapshots
      world/        world/map/weather/season/environment/transport/history
      npc/          autonomous NPC life: needs, utility AI, memory, schedules, social life
      economy/      market, prices, businesses, employment, player shop, transactions
      gameplay/     farming, fishing, foraging, exploration, crafting, cooking, building,
                    housing, collection, skills, world events
      social/       relationships, dialogue, gifts, invitations, romance, community
      life/         cigarette physics, life archive, achievements, goals, influence, legacies
      persistence/  IndexedDB ping-pong saves, migration, backups, replay storage
      workers/      simulation worker, protocol, promise bridge
      data/         validated static content (items, locations, NPCs, shops, crops, fish,
                    recipes, events, dialogue, furniture, blueprints, achievements, goals)
      scenes/       Phaser scenes, procedural renderers and controllers
      render/       DOM-/Phaser-free pixel-art palettes, layout, textures, figures, effects
      ui/           DOM UI manager and all panels
      audio/        procedural Web Audio manager
      main.ts       bootstraps engine + DOM UI + Phaser + audio

## Documentation

- docs/PROJECT_BRIEF.md - game concept and non-negotiable requirements
- docs/ARCHITECTURE.md - layering, state ownership, threading, save/worker flow
- docs/API_CONTRACTS.md - frozen interfaces and system integration order
- docs/DATA_SCHEMA.md - content/entity data dictionary
- docs/EVENT_SCHEMA.md - bus events, world events, worker messages
- docs/SAVE_SCHEMA.md - save format, ping-pong slots, migration, idempotency
- docs/PROBABILITY_ENGINE.md - randomness algorithms, streams, history/debugging
- docs/WORLD_SIMULATION.md - time model, LODs, weather, map, offline catch-up
- docs/NPC_SYSTEM.md - NPC population, utility AI, memory, relationships, schedules
- docs/GAMEPLAY_SYSTEMS.md - farming, fishing, foraging, crafting, cooking, building,
  housing, skills, collection, social, events, cigarette physics, economy
- docs/INTEGRATION_STATUS.md - final per-module status, content counts, save format, offline
  architecture, exact run instructions and the honest list of open gaps
- docs/TEST_REPORT.md - exact verification commands/results, test inventory, performance
  evidence, known failures and residual risks
- docs/QA_REPORT.md - QA performance, stress, long-run and scenario findings
- docs/ACCEPTANCE_REPORT.md - browser playthrough acceptance report
- docs/SPEC_COVERAGE.md - requirement-by-requirement audit against the source spec
- docs/AGENT_TASKS.md - development task map and final completion status

## Known limitations

See docs/INTEGRATION_STATUS.md ("Known limitations and open gaps"), docs/TEST_REPORT.md and
docs/SPEC_COVERAGE.md. In short: the Phaser scene layer itself has no automated browser test
(the Phaser-free render layer and the DOM UI have headless suites; the full browser playthrough
is the acceptance report); the Web Worker offline path falls back to the main thread in Node
tests; hidden-tab background play is throttled to the offline time scale (1 real hour = 3 game
hours) and while the tab is visible all regions are simulated on the main thread; and some spec
facets are narrower than the source spec (tracked in docs/SPEC_COVERAGE.md). Browser acceptance
and audio must be checked in a real browser; audio starts after the first click or key press.