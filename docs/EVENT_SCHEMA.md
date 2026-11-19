# Event Schema

Two event layers exist:

## 1. Typed in-process bus (`GameEventMap`, src/core/contracts.d.ts)
Synchronous, typed, used between systems and the UI. Subscribe with `ctx.bus.on(topic, handler)`
or `gameApi.getEventBus()`. Topics and payloads:

| Topic | Payload | Emitted by |
|---|---|---|
| `time:hour` | simTimeSeconds, time, hour | SimulationRuntime |
| `time:day` | simTimeSeconds, time, day | SimulationRuntime |
| `time:season` | simTimeSeconds, time, season | SimulationRuntime |
| `weather:changed` | weather, previous, temperature, windSpeed | WeatherSystem |
| `location:changed` | from, to, regionId | WorldSystem |
| `npc:activity` | npcId, activity, locationId | NPCSystem |
| `npc:met` | npcId, npcName | SocialSystem |
| `relationship:changed` | npcId, kind, affinity, trust, intimacy, status | Social/NPC systems |
| `item:acquired` | itemId, quantity, quality, source | many systems |
| `item:lost` | itemId, quantity, reason | many systems |
| `money:changed` | amount, balance, reason | Economy/Life |
| `transaction:completed` | record | Economy |
| `crop:harvested` | cropId, quality, quantity | Farming |
| `fish:caught` | fishId, sizeCm, quality | Fishing |
| `discovery:made` | kind, id, description | Exploration/World |
| `event:occurred` | event: WorldEvent | EventSystem |
| `festival:started` / `festival:participated` | festivalId / activityId, result | EventSystem |
| `cigarette:state` | lengthRatio, moisture, burnRate, sheltered | LifeSystem |
| `cigarette:warning` | kind, message | LifeSystem |
| `life:ended` | lifeId, cause, ageDays | LifeSystem |
| `life:archive` | entry | LifeArchiveSystem |
| `letter:received` | letter | Social/Event systems |
| `achievement:unlocked` / `goal:completed` | id, title | Life |
| `community:proposal` | project | CommunitySystem |
| `save:completed` | slotId, savedAt | SaveManager/Game |
| `offline:progress` / `offline:completed` | percent, phase / summary | Worker/Game |
| `game:signal` | name, data? | any system (UI notices) |

`game:signal` names used by UI: `game:started`, `generation:started`, `skill:levelup`,
`item:consumed`, `item:equipped`, `invitation`, `fishing:cast`, `time:rested`, `life:ended`.

## 2. Persisted world events (`WorldEvent`)
Every meaningful world occurrence is stored in `GameState.world.events` (cap 400, older
low-importance entries archived/dropped) with:
id, type, category (ordinary/interesting/lucky/unlucky/special), title, description, createdAt,
occurredAt, locationId?, participants[], sourceEventId?, cause[], result{}, importance,
archived, acknowledged. New events also go into `world.history` (WorldHistoryEntry) with a
category and importance; both are shown in EventUI / JournalUI and the offline summary.

## 3. Worker messages (`ToSimulationWorkerMessage` / `FromSimulationWorkerMessage`)
`init`, `ping`, `offline`, `background`, `shutdown` -> `ready`, `pong`, `offline-progress`,
`offline-result`, `offline-error`, `background-result`, `worker-error`. See
`src/workers/WorkerProtocol.ts` and `src/core/contracts.d.ts`.
