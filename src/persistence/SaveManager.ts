import type { ArchivedLife, ActionResult, GameState, ILogger, ISaveManager, SaveEnvelope, SaveSlotMeta } from '../core/contracts';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { simSecondsToGameTime } from '../core/TimeUtil';
import { checksumOfPayload, isValidChecksum } from './ChecksumUtil';
import {
  IndexedDBStorage,
  MemorySaveStorage,
  type ISaveStorage,
  type SaveSlotLetter,
  type SlotMetaRecord,
  type StoredSlot,
} from './IndexedDBStorage';
import { migrateSave, validateLoadedState } from './SaveMigration';
import { createBackupBundle, parseBackup, parseEnvelopeJson, serialiseBackup } from './BackupManager';

export interface SaveManagerDeps {
  getState(): GameState;
  applyState(state: GameState): void;
  beforeSave?(): void;
  logger?: ILogger;
}

export const DEFAULT_SLOT_ID = 'slot_1';
export const AUTO_SLOT_ID = 'slot_auto';

function buildSlotMeta(state: GameState): SaveSlotMeta {
  const time = simSecondsToGameTime(state.clock.simTimeSeconds);
  return {
    slotId: '',
    worldId: state.world.worldId,
    lifeId: state.player.lifeId,
    playerName: state.player.name,
    generation: state.life.generation,
    year: time.year,
    season: time.season,
    dayOfSeason: time.dayOfSeason,
    money: state.player.money,
    playTimeSeconds: state.meta.playTimeSeconds,
    savedAt: Date.now(),
    saveVersion: state.version,
    checksum: '',
  };
}

/** Versioned, checksum-validated save manager with ping-pong slots and IndexedDB fallback. */
export class SaveManager implements ISaveManager {
  readonly deps: SaveManagerDeps;
  private storage: ISaveStorage;
  private currentSlotId: string = DEFAULT_SLOT_ID;
  private lastSavedAt = 0;
  private initialised = false;
  private knownArchivedLives = new Set<string>();
  private readonly logger: ILogger | undefined;

  constructor(deps: SaveManagerDeps, storage?: ISaveStorage) {
    this.deps = deps;
    this.storage = storage ?? new IndexedDBStorage();
    this.logger = deps.logger;
  }

  async init(): Promise<void> {
    try {
      await this.storage.open();
    } catch (error) {
      this.logger?.warn('IndexedDB unavailable, falling back to in-memory saves', String(error));
      this.storage = new MemorySaveStorage();
      await this.storage.open();
    }
    try {
      const archived = await this.storage.listArchivedLives();
      for (const life of archived) this.knownArchivedLives.add(life.lifeId);
    } catch {
      this.knownArchivedLives.clear();
    }
    this.initialised = true;
  }

  get storageKind(): 'indexeddb' | 'memory' {
    return this.storage.kind;
  }

  getCurrentSlotId(): string {
    return this.currentSlotId;
  }

  setCurrentSlotId(slotId: string): void {
    this.currentSlotId = slotId;
  }

  private requireInitialised(): void {
    if (!this.initialised) throw new Error('SaveManager.init() has not been awaited');
  }

  private buildEnvelope(state: GameState): SaveEnvelope {
    return {
      version: state.version,
      checksum: checksumOfPayload(state),
      savedAtRealMs: Date.now(),
      lastProcessedSimTime: state.clock.simTimeSeconds,
      payload: state,
    };
  }

  async save(slotId: string = this.currentSlotId): Promise<ActionResult> {
    try {
      this.requireInitialised();
      this.deps.beforeSave?.();
      const liveState = this.deps.getState();
      const savedAt = Date.now();
      // Freeze the save instant BEFORE any await: the rAF loop keeps mutating the live state
      // while IndexedDB transactions are in flight, so the checksummed payload and the written
      // payload must be the same immutable snapshot.
      const state = structuredClone(liveState);
      state.meta.savedAt = savedAt;
      state.meta.lastRealTimestampMs = savedAt;
      state.meta.lastProcessedSimTime = state.clock.simTimeSeconds;
      state.meta.saveVersion = state.version;
      state.pendingOffline.lastSaveRealMs = savedAt;
      state.pendingOffline.lastProcessedSimTime = state.clock.simTimeSeconds;
      state.pendingOffline.lastOfflineSimTime = state.clock.simTimeSeconds;
      // The decision log is a debugging aid, not authoritative world state: cap it so saves
      // stay small even after long autonomous simulations (the engine keeps a full in-memory ring).
      if (state.probability.history.length > 400) {
        state.probability.history = state.probability.history.slice(-400);
      }
      // Mirror the save stamps onto the live state too so the next offline calculation starts
      // from the committed instant.
      liveState.meta.savedAt = savedAt;
      liveState.meta.lastRealTimestampMs = savedAt;
      liveState.meta.lastProcessedSimTime = state.clock.simTimeSeconds;
      liveState.pendingOffline.lastSaveRealMs = savedAt;
      liveState.pendingOffline.lastProcessedSimTime = state.clock.simTimeSeconds;
      liveState.pendingOffline.lastOfflineSimTime = state.clock.simTimeSeconds;
      const envelope = this.buildEnvelope(state);
      const existingMeta = await this.storage.readMeta(slotId);
      const nextSlot: SaveSlotLetter = existingMeta ? existingMeta.nextSlot : 'A';
      const metaRecord: SlotMetaRecord = {
        slotId,
        meta: { ...buildSlotMeta(state), slotId, checksum: envelope.checksum },
        nextSlot: nextSlot === 'A' ? 'B' : 'A',
      };
      await this.storage.writeSlot({ slotId, slot: nextSlot, envelope }, metaRecord);
      this.currentSlotId = slotId;
      this.lastSavedAt = Date.now();
      for (const archived of state.archive) {
        if (!this.knownArchivedLives.has(archived.lifeId)) {
          await this.storage.saveArchivedLife(archived);
          this.knownArchivedLives.add(archived.lifeId);
        }
      }
      return { ok: true, message: 'Game saved', stateChanged: false };
    } catch (error) {
      return { ok: false, code: 'invalid', message: 'Save failed: ' + (error instanceof Error ? error.message : String(error)) };
    }
  }

  private pickBestEnvelope(slots: (StoredSlot | null)[]): { envelope: SaveEnvelope; slot: SaveSlotLetter } | null {
    const valid: { envelope: SaveEnvelope; slot: SaveSlotLetter }[] = [];
    for (const stored of slots) {
      if (!stored) continue;
      if (isValidChecksum(stored.envelope.payload, stored.envelope.checksum)) {
        valid.push({ envelope: stored.envelope, slot: stored.slot });
      } else {
        this.logger?.warn('Corrupted save slot detected, trying backup slot', stored.slotId + ':' + stored.slot);
      }
    }
    if (valid.length === 0) return null;
    valid.sort((a, b) => b.envelope.savedAtRealMs - a.envelope.savedAtRealMs);
    return valid[0] ?? null;
  }

  async load(slotId: string): Promise<GameState | null> {
    this.requireInitialised();
    const slotA = await this.storage.readSlot(slotId, 'A');
    const slotB = await this.storage.readSlot(slotId, 'B');
    const best = this.pickBestEnvelope([slotA, slotB]);
    if (!best) {
      const meta = await this.storage.readMeta(slotId);
      if (!meta) return null;
      throw new Error('Both save slots are corrupted for ' + slotId);
    }
    const migration = migrateSave(best.envelope.payload, WORLD_CONFIG.saveVersion);
    const errors = validateLoadedState(migration.state);
    if (errors.length > 0) throw new Error('Save validation failed: ' + errors.join('; '));
    if (migration.migrated) this.logger?.info('Migrated save from version ' + migration.fromVersion + ' to ' + migration.toVersion);
    this.deps.applyState(migration.state);
    this.currentSlotId = slotId;
    this.lastSavedAt = best.envelope.savedAtRealMs;
    return migration.state;
  }

  async listSlots(): Promise<SaveSlotMeta[]> {
    this.requireInitialised();
    const records = await this.storage.listMeta();
    return records
      .map((record) => record.meta)
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  async deleteSlot(slotId: string): Promise<void> {
    this.requireInitialised();
    await this.storage.deleteSlot(slotId);
  }

  async autosave(): Promise<ActionResult> {
    return this.save(this.currentSlotId || AUTO_SLOT_ID);
  }

  async exportSave(slotId?: string): Promise<string | null> {
    this.requireInitialised();
    if (slotId) {
      const slotA = await this.storage.readSlot(slotId, 'A');
      const slotB = await this.storage.readSlot(slotId, 'B');
      const best = this.pickBestEnvelope([slotA, slotB]);
      return best ? JSON.stringify(best.envelope, null, 2) : null;
    }
    this.deps.beforeSave?.();
    return JSON.stringify(this.buildEnvelope(this.deps.getState()), null, 2);
  }

  async exportBackup(): Promise<string> {
    this.deps.beforeSave?.();
    return serialiseBackup(createBackupBundle(this.deps.getState()));
  }

  async importSave(json: string, slotId: string = this.currentSlotId): Promise<ActionResult> {
    try {
      this.requireInitialised();
      let envelope: SaveEnvelope;
      try {
        const backup = parseBackup(json);
        envelope = {
          version: backup.version,
          checksum: backup.checksum,
          savedAtRealMs: Date.now(),
          lastProcessedSimTime: backup.state.clock.simTimeSeconds,
          payload: backup.state,
        };
      } catch {
        envelope = parseEnvelopeJson(json);
      }
      const migration = migrateSave(envelope.payload, WORLD_CONFIG.saveVersion);
      const errors = validateLoadedState(migration.state);
      if (errors.length > 0) return { ok: false, code: 'invalid', message: 'Import failed: ' + errors.join('; ') };
      const existingMeta = await this.storage.readMeta(slotId);
      const nextSlot: SaveSlotLetter = existingMeta ? existingMeta.nextSlot : 'A';
      const state = migration.state;
      await this.storage.writeSlot(
        { slotId, slot: nextSlot, envelope: { ...envelope, version: state.version, payload: state, checksum: checksumOfPayload(state) } },
        {
          slotId,
          meta: { ...buildSlotMeta(state), slotId, checksum: checksumOfPayload(state) },
          nextSlot: nextSlot === 'A' ? 'B' : 'A',
        }
      );
      this.deps.applyState(state);
      this.currentSlotId = slotId;
      this.lastSavedAt = Date.now();
      return { ok: true, message: 'Save imported', stateChanged: true };
    } catch (error) {
      return { ok: false, code: 'invalid', message: 'Import failed: ' + (error instanceof Error ? error.message : String(error)) };
    }
  }

  async saveArchivedLife(archived: ArchivedLife): Promise<void> {
    if (this.knownArchivedLives.has(archived.lifeId)) return;
    try {
      await this.storage.saveArchivedLife(archived);
      this.knownArchivedLives.add(archived.lifeId);
    } catch (error) {
      this.logger?.warn('Failed to persist archived life', String(error));
    }
  }

  async listArchivedLives(): Promise<ArchivedLife[]> {
    try {
      return await this.storage.listArchivedLives();
    } catch {
      return [];
    }
  }

  async hasAnySave(): Promise<boolean> {
    const slots = await this.listSlots();
    return slots.length > 0;
  }

  getLastSavedAt(): number {
    return this.lastSavedAt;
  }

  close(): void {
    this.storage.close();
  }
}