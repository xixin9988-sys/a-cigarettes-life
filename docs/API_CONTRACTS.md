# API Contracts

The single source of truth is `src/core/contracts.d.ts` (strict TypeScript, frozen during
parallel development). This document explains the contract surface and integration order.

## Core services
| Interface | Purpose | Implementation |
|---|---|---|
| `IClock` | simulated time, speed, pause, save/restore | `src/core/Clock.ts` |
| `IEventBus` | typed synchronous events (see EVENT_SCHEMA.md) | `src/core/EventBus.ts` |
| `ISystemRegistry` | ordered system registration + update | `src/core/SystemRegistry.ts` |
| `IGameContext` | services + state handed to every system | `src/core/GameContext.ts` |
| `IContentRegistry` | validated static content lookups | `src/core/ContentRegistry.ts` |
| `IProbabilityEngine` | the only randomness API in the game | `src/probability/ProbabilityEngine.ts` |
| `ISaveManager` | versioned checksum saves + export/import | `src/persistence/SaveManager.ts` |
| `IWorkerBridge` | offline/background simulation worker RPC | `src/workers/WorkerBridge.ts` |
| `IGameApi` | facade consumed by Phaser scenes and DOM UI | `src/core/Game.ts` |

## Domain systems (register order)
1. `world` - `IWorldSystem` (src/world/WorldManager.ts)
2. `npc` - `INPCSystem` (src/npc/NPCSystem.ts)
3. `economy` - `IEconomySystem` (src/economy/EconomySystem.ts)
4. `skill` - `ISkillSystem` (src/gameplay/SkillSystem.ts)
5. `farming` - `IFarmingSystem` (src/gameplay/FarmingSystem.ts)
6. `foraging` - `IForagingSystem` (src/gameplay/ForagingSystem.ts)
7. `fishing` - `IFishingSystem` (src/gameplay/FishingSystem.ts)
8. `exploration` - `IExplorationSystem` (src/gameplay/ExplorationSystem.ts)
9. `crafting` - `ICraftingSystem` (src/gameplay/CraftingSystem.ts)
10. `cooking` - `ICookingSystem` (src/gameplay/CookingSystem.ts)
11. `building` - `IBuildingSystem` (src/gameplay/BuildingSystem.ts)
12. `housing` - `IHousingSystem` (src/gameplay/HousingSystem.ts)
13. `collection` - `ICollectionSystem` (src/gameplay/CollectionSystem.ts)
14. `social` - `ISocialSystem` (src/social/SocialSystem.ts)
15. `dialogue` - `IDialogueSystem` (src/social/DialogueSystem.ts)
16. `events` - `IEventSystem` (src/gameplay/EventSystem.ts)
17. `life` - `ILifeSystem` (src/life/LifeSystem.ts)

Each system follows the same lifecycle:
```ts
class XSystem implements IXSystem {
  readonly id = 'x';
  init(ctx: IGameContext): void;   // called once after all systems registered, in order
  update(dtSimSeconds: number): void; // called every simulation step; dt may be large offline
}
```
All player-facing operations return `ActionResult { ok, message, code?, data?, stateChanged? }`.

## Game API (src/core/Game.ts)
```
I API:
  getState(): Readonly<GameState>
  getContent(): IContentRegistry
  getClock(): IClock
  getEventBus(): IEventBus
  getScreen(): 'boot'|'menu'|'playing'|'life_end'|'offline_summary'
  setScreen(screen)
  dispatch(action: GameAction): ActionResult
  tick(deltaRealSeconds: number): void
  newGame(options: NewGameOptions): ActionResult
  saveGame(slotId): Promise<ActionResult>
  loadGame(slotId): Promise<ActionResult>
  listSaveSlots(): Promise<SaveSlotMeta[]>
  startNextLife(legacyItemIds: string[]): ActionResult
  requestOfflineCatchup(): Promise<OfflineSimResult | null>
  getOfflineSummary() / acknowledgeOfflineSummary()
  getLifeArchive(): ArchivedLife[]
  getProbabilityDebug(): ProbabilityDebugInfo
  isPlaying(): boolean
  getSystems(): IGameSystems
```
`GameAction` is a discriminated union covering movement, interaction, inventory, farming,
fishing, foraging, exploration, crafting, cooking, building, housing, shops/jobs, social,
dialogue, travel/train, life/legacy, events/festivals, collection, save/load, rest and settings.
UI never mutates state directly - it dispatches actions and renders the returned state.

## UI contract
`src/ui/UIInterfaces.ts` defines `IUIManager` (mount/update/panels/notifications/main menu/
character creation/save slots/offline summary/life review) and `ISceneSession` passed to Phaser.
`src/scenes/config.ts` exports `createPhaserConfig(): Phaser.Types.Core.GameConfig`;
scenes read the session via `src/scenes/session.ts`.

## Contract change policy
During parallel development contracts were frozen. Any incompatible need had to be reported to
the Lead and implemented as a local type rather than silently diverging. Final integration was
verified by `tests/contracts/contractCompliance.test.ts`.
