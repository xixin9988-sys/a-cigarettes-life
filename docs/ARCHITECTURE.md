# Architecture

## Layers (hard rule - no upward imports)
```
L4 presentation   src/scenes/**, src/ui/**, src/main.ts   (Phaser + DOM; may read state, dispatch actions)
L3 application    src/gameplay/**, src/social/**, src/life/**
L2 simulation     src/simulation/**, src/world/**, src/npc/**, src/economy/**
L1 facilities     src/probability/**, src/persistence/**, src/workers/**
L0 contracts      src/core/contracts.d.ts, src/core/SharedTypes.ts, src/core/*.ts, src/data/**
```
L0-L3 must be DOM-free / Phaser-free so the same code runs inside the Web Worker.
`tsconfig.worker.json` compiles the simulation layer with `lib: WebWorker` and no DOM;
violations must be fixed by moving DOM code up into scenes/ui.

## Single source of state
`GameState` (`src/core/contracts.d.ts`) is the complete persistent game state. Its slices
are owned by the domain systems:

| Slice | Owner system |
|---|---|
| clock, meta | Clock / Game (Lead) |
| world (regions, locations, environment, transport, events, history) | WorldSystem + WeatherSystem/EnvironmentSystem/TransportSystem |
| npcs | NPCSystem |
| player | PlayerIdentitySystem / LifeSystem / SocialSystem (carefully, documented fields) |
| economy | EconomySystem |
| farming / foraging / fishing / exploration | FarmingSystem / ForagingSystem / FishingSystem / ExplorationSystem |
| crafting / cooking / building / housing / collection | CraftingSystem / CookingSystem / BuildingSystem / HousingSystem / CollectionSystem |
| social | SocialSystem / DialogueSystem |
| life, archive | LifeSystem / LifeArchiveSystem / GenerationSystem |
| eventSystem | EventSystem |
| probability | ProbabilityEngine |
| settings, flags, pendingOffline | Game / SaveManager |

State is mutated in place by systems; `SaveManager` serialises the whole GameState.
Module-private runtime caches are allowed but everything a player can observe MUST live in
GameState. Never keep authoritative state in UI code.

## Update loop (main thread)
```
requestAnimationFrame(dtReal)
  -> Clock.advanceRealSeconds(dtReal)                 // 1 real second = 1 in-game minute at 1x
  -> emit time hour/day/season events from Clock-like driver
  -> SimulationRuntime.updateActive(simDelta)         // orders systems, calls update(dtSimSeconds)
  -> every N real seconds: hand a GameState snapshot to Worker for LOD2 background tick
  -> Phaser scenes render interpolated view, UI reads state + dispatches actions
```

`dtSimSeconds` is simulated seconds (1 sim second = 1 game minute at 1x). Systems must
tolerate both small (0.25s) and large (hundreds of seconds, used by offline catch-up) deltas:
drive logic from absolute timestamps (`ctx.clock.simTimeSeconds`) and clamp per-step
accumulators. Use `ctx.bus` hour/day events or compare clock time for daily rollovers.

## Worker architecture
- `src/workers/simulation.worker.ts` is a separate Vite worker module. It must never import
  Phaser or touch `window`/`document`.
- `SimulationRuntime` (`src/simulation/SimulationRuntime.ts`) composes the L2/L3 systems.
  It is used on the main thread for active simulation and inside the worker for offline.
- `IWorkerBridge` sends `{kind:'offline', request}` with a full `GameState` snapshot and
  receives an advanced state + `OfflineSummary`. The result carries `lastProcessedSimTime`;
  the main thread applies it atomically only if it matches
  `pendingOffline.lastProcessedSimTime` (idempotency lock). Background ticks use
  `{kind:'background'}` and return the changed state slices (used when a hidden tab needs the
  world to keep moving while the main thread is throttled). During normal play the main thread
  runs the full L2 simulation for all 56 NPCs - cheap enough at this scale - instead of paying
  the snapshot/merge cost every few seconds; the worker exists for real offline catch-up and
  for any future LOD2 offload.
- Offline time aggregation buckets by REAL hours away (matching the spec policy):
  <1 real hour -> 5 game-minute simulation steps; 1-24 real hours -> 30 game-minute steps;
  >24 real hours -> daily macro steps. 1 sim second = 1 in-game minute, so a 30 game-minute
  step is 30 sim seconds. The total simulated span is capped at
  WORLD_CONFIG.worldTime.maxOfflineGameDays (14 game days); offlineTimeScale = 0.05 means
  1 real hour away = 3 game hours. Progress messages are posted to the main thread. Never
  simulate frame-by-frame offline. The main-thread fallback uses the same buckets and sets
  state.flags.offline_simulation so systems apply offline multipliers (cigarette burn 0.35x).

## Save flow
IndexedDB stores: `meta` (slot metadata), `saves` (ping-pong slots slotA/slotB with FNV-1a
checksum), `archive` (past lives). Write: serialise -> checksum -> write alternate slot in a
transaction -> update meta. Read: validate checksum, fall back to the other slot, migrate
version, seal envelope with `lastProcessedSimTime`. The probability debug decision history is
an audit aid, not authoritative world state: SaveManager trims it to the most recent 400
records so saves stay small after long autonomous runs (the live engine keeps its full ring).

## Deterministic identifiers
Entity instance ids come from `configureIdGenerator(seed)` + `makeId(prefix)`
(`src/core/utils.ts`): a seed-derived token plus a monotonic counter, so identical seeds replay
identical ids (needed for deterministic headless runs). Loading a save calls
`syncIdCounterFromState(state)` (via `SimulationRuntime({ syncIdCounter: true })`) so newly
created items/events can never collide with persisted ids.

## Probability streams (stable ids)
Every random call names a stream; streams are independent and persisted.
`world.weather`, `world.environment`, `world.transport`,
`npc.behavior`, `npc.social`, `npc.memory`, `npc.schedule`,
`economy.market`, `economy.business`, `economy.customer`, `economy.jobs`,
`farming.growth`, `farming.quality`, `foraging.results`, `fishing.results`,
`fishing.minigame`, `exploration.discovery`,
`crafting.quality`, `cooking.quality`, `collection.discovery`,
`social.interaction`, `social.romance`, `social.dialogue`,
`events.occurrence`, `events.festival`,
`player.opportunities`, `player.cigarettePhysics`, `life.ash`, `life.archive`,
`housing.decor`, `ui.cosmetic`.
A module owns its streams; do not draw from another module's stream ids.

## IDs and content
- Item / location / NPC / business / festival ids are canonical constants in
  `src/data/*/ids.ts` - always import them, never hardcode strings.
- Static content lives in `src/data/**` and is aggregated by `src/data/index.ts` into a
  validated `ContentPack`; `ContentRegistry` provides lookups. Data files are owned by
  the domain agents listed in `docs/AGENT_TASKS.md`.
- Interiors use `interiorIdFor(exteriorId)` = `<exteriorId>_interior`.
- Money is integer pence (1/100 GBP). Time is simulated seconds since Year 1 Spring 1 00:00;
  use helpers in `src/core/TimeUtil.ts`. Uses `GameTime` for calendar values.

## Integration points (Lead owns)
- `src/core/Game.ts` - game facade, action dispatch, save/load/offline orchestration.
- `src/simulation/SimulationRuntime.ts` - system composition + ordering.
- `src/core/GameBootstrap.ts`, `src/main.ts` - wiring Phaser + UI + systems.
- `src/persistence/**`, `src/workers/**`.
Agents must not edit these; they implement the interfaces in `contracts.d.ts`.