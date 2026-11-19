# World Simulation

## Time model
- 1 real second = 1 in-game minute at 1x speed (speed 2x/4x available).
- 1 game hour = 60 simulated seconds; 1 game day = 1440 simulated seconds.
- Seasons of 28 days; 4 seasons per year. Calendar starts Year 1 Spring 1, 08:00.
- Simulation time is stored as `simTimeSeconds` in `ClockState`; calendar values are derived with
  `src/core/TimeUtil.ts` (`simSecondsToGameTime`, `gameTimeToSimSeconds`, phase/weekday helpers).
- No gameplay code reads the wall clock; `Date.now()` is only used for save timestamps and the
  offline duration calculation.

## Three levels of detail
| LOD | Scope | Thread | Driver |
|---|---|---|---|
| LOD 1 Active | Player's location + systems that need per-frame fidelity (cigarette physics, fishing minigame, interaction) | main | `ActiveSimulation` fixed-step (0.25s) from the render loop |
| LOD 2 Background | World keeps moving while the main thread is throttled | Web Worker | `GameEngine.startBackgroundSimulation()` + worker `background` messages; also `BackgroundSimulation` utility |
| LOD 3 Offline | Everything that happened while the tab was closed | Web Worker (main-thread fallback) | `OfflineSimulation` adaptive time steps |

The same `SimulationRuntime` composes all systems in all three contexts; LOD is a scheduling /
threading concern, not a second implementation.

### LOD 2 in practice
While the tab is hidden, `main.ts` (`visibilitychange`) calls
`GameEngine.startBackgroundSimulation()`. A 5-second interval snapshots the world and calls
`IWorkerBridge.requestBackground(state, realSeconds * offlineTimeScale)`; the worker advances a
`SimulationRuntime` and returns the new state, which the main thread applies only when it is
newer (`lastProcessedSimTime` monotonic guard). The main-thread tick pauses during this mode so
the same world is never simulated twice; on visibility return the loop stops and saves. During
normal play the main thread simulates all 56 NPCs directly (cheap at this scale), so the Worker
is an offload for hidden tabs and a mandatory processor for offline catch-up, not a bottleneck
that blocks rendering.

## Update flow (main thread)
```
requestAnimationFrame(dtReal)
  -> GameEngine.tick(dtReal)
  -> Clock.advanceRealSeconds(dtReal)            // pause/speed aware
  -> SimulationRuntime.update(simDelta)          // emit time boundaries, update systems in order
  -> lifecycle checks (life ended), autosave scheduling
  -> UI reads GameState; Phaser scenes render
```
`SimulationRuntime.update` emits `time:hour`, `time:day`, `time:season` when the clock crosses
boundaries; systems either listen or use absolute `ctx.clock` timestamps, so large offline dt is
processed correctly.

## Weather & environment
- Per-season Markov chain over clear/cloudy/rain/storm/fog/snow/wind, transitioning every 4 game
  hours from stream `world.weather`.
- `EnvironmentState` holds weather, wind speed/direction, humidity, temperature, rain/fog density,
  daylight and recent weather history.
- Microclimate per location (from `LocationDef`): indoor/shelter, wind exposure, humidity
  modifier, heat source. Queried in O(1) via `state.world.locations[id].microclimate`.
- Seasons affect temperature, daylight, crops, fish, festivals and weather transitions.

## Map & travel
- 25 Willowbrook exteriors + 20 Ashford exteriors; every enterable building has an interior
  location (`<exteriorId>_interior`). Exterior connections form a validated undirected graph.
- Secret locations (hidden garden, secret path, ancient well, warehouse basement) start locked and
  require exploration clues.
- Player movement inside a location is local; travelling between locations uses `IWorldSystem.travelTo`
  (adjacent only, unlocked only). `location:changed` updates UI and history.
- Train: timetable derived from `TRAIN_ROUTES`, tickets bought at stations (money), boarding
  within 30 game minutes of departure; rides advance with the clock and place the player at the
  destination when they arrive.

## Offline catch-up
1. On load, compute real elapsed = now - `pendingOffline.lastSaveRealMs`.
2. sim seconds = real seconds * `WORLD_CONFIG.worldTime.offlineTimeScale` (0.05; 24h real = 3 game
   days), capped at `maxOfflineGameDays` (14).
3. Send a full state snapshot to the worker (`{kind:'offline'}`).
4. Worker creates a `SimulationRuntime`, sets `flags.offline_simulation = true` (systems apply
   offline multipliers, e.g. client burn), and runs `runOffline`:
   - <1h simulated -> 5 game-minute steps,
   - 1-24h -> 30 game-minute steps,
   - >24h -> 1 game-day steps,
   yielding periodically so progress messages reach the UI, capped at 4000 steps.
5. Worker returns the advanced GameState + `OfflineSummary` + idempotency marker.
6. Main thread applies only if the marker matches the request target and is newer than the stored
   marker (prevents double-settlement on duplicate results), then immediately commits the settled
   world through SaveManager (atomic ping-pong envelope + `lastProcessedSimTime`), so a crash can
   never re-settle the same offline window. Summary is shown in a modal (offline duration,
   highlights, important NPC updates, new letters/events, state changes).
7. If workers are unavailable, the same runtime runs offline on the main thread as a fallback.

## World history
`addWorldHistory` records meaningful world changes (weather records, business news, NPC
milestones, festivals, discoveries, player achievements) with importance 1-5, capped at
`WORLD_CONFIG.simulation.maxHistoryEntries`. History is inherited across generations.

## Files
`src/simulation/{SimulationRuntime,ActiveSimulation,BackgroundSimulation,OfflineSimulation,
OfflineSummaryBuilder,SimulationScheduler,SimulationSnapshot,StateDiffEngine,SimulationReplay,
WorldSimulation}.ts`, `src/world/**`, `src/workers/**`.