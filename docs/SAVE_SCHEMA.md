# Save Schema

## Envelope
```ts
interface SaveEnvelope {
  version: number;            // SAVE_SCHEMA version (WORLD_CONFIG.saveVersion)
  checksum: string;           // FNV-1a 32-bit hex of JSON.stringify(payload)
  savedAtRealMs: number;
  lastProcessedSimTime: number; // idempotency marker for offline settlement
  payload: GameState;
}
```

## Storage (IndexedDB database `a_cigarettes_life`, version 1)
| Object store | Key | Contents |
|---|---|---|
| `meta` | slotId | `{ slotId, meta: SaveSlotMeta, nextSlot: 'A'|'B' }` |
| `saves` | [slotId, 'A'|'B'] | `{ slotId, slot, envelope }` - ping-pong double buffer |
| `archive` | lifeId | `ArchivedLife` records for past lives |

Fallback: if IndexedDB is unavailable (private mode, tests) `MemorySaveStorage` is used
transparently; `SaveManager.storageKind` exposes which is active.

## Ping-pong write algorithm
1. Read slot metadata to learn which buffer is next (`nextSlot`).
2. Build envelope + checksum, write the buffer and metadata in one readwrite transaction.
3. Flip `nextSlot`.
4. On read: load both buffers, discard invalid checksums, pick the newest valid one. A crash
   between the two steps can therefore never destroy the last good save.

## GameState (persisted root)
`version, meta, clock, world, npcs, player, economy, farming, fishing, foraging, exploration,
crafting, cooking, building, housing, collection, social, life, eventSystem, probability,
settings, archive, pendingOffline, flags`.
Field-level definitions live in `src/core/contracts.d.ts`. Everything a player can observe is
persisted here; module-private caches are rebuilt on load.

## Versioning & migration
`SaveMigration.migrateSave()` upgrades older payloads step by step (current version:
`WORLD_CONFIG.saveVersion = 1`). `validateLoadedState()` rejects structurally broken payloads.
Add a migration branch whenever bumping the version.

## Export / import
`SaveManager.exportSave(slotId?)` returns pretty JSON (envelope); `exportBackup()` returns a
`BackupBundle` with format marker + checksum. Import accepts either format, verifies checksum,
migrates and applies the state. `downloadSaveJson()` in BackupManager triggers a browser download.

## Offline idempotency
Before an offline simulation the game stores `pendingOffline.lastProcessedSimTime`. The worker
returns `lastProcessedSimTime`; the main thread applies the result only when it matches the
requested target and is newer than the stored marker. Saving also records
`lastSaveRealMs/lastOfflineSimTime` so each offline period is processed at most once.
