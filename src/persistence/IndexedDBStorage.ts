import type { ArchivedLife, SaveEnvelope, SaveSlotMeta } from '../core/contracts';
import type { ArchivedLife as ArchivedLifeRecord } from '../core/contracts';

export type SaveSlotLetter = 'A' | 'B';

export interface StoredSlot {
  slotId: string;
  slot: SaveSlotLetter;
  envelope: SaveEnvelope;
}

export interface SlotMetaRecord {
  slotId: string;
  meta: SaveSlotMeta;
  nextSlot: SaveSlotLetter;
}

/** Storage abstraction so the game still works when IndexedDB is unavailable (tests). */
export interface ISaveStorage {
  readonly kind: 'indexeddb' | 'memory';
  open(): Promise<void>;
  readSlot(slotId: string, slot: SaveSlotLetter): Promise<StoredSlot | null>;
  writeSlot(record: StoredSlot, meta: SlotMetaRecord): Promise<void>;
  readMeta(slotId: string): Promise<SlotMetaRecord | null>;
  listMeta(): Promise<SlotMetaRecord[]>;
  deleteSlot(slotId: string): Promise<void>;
  saveArchivedLife(archived: ArchivedLife): Promise<void>;
  listArchivedLives(): Promise<ArchivedLifeRecord[]>;
  deleteArchivedLife(lifeId: string): Promise<void>;
  close(): void;
}

const DB_NAME = 'a_cigarettes_life';
const DB_VERSION = 1;
const META_STORE = 'meta';
const SAVE_STORE = 'saves';
const ARCHIVE_STORE = 'archive';

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Native IndexedDB persistence with ping-pong save slots, metadata and life archive. */
export class IndexedDBStorage implements ISaveStorage {
  readonly kind = 'indexeddb' as const;
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    if (this.db) return;
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available in this environment');
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: 'slotId' });
        }
        if (!database.objectStoreNames.contains(SAVE_STORE)) {
          database.createObjectStore(SAVE_STORE, { keyPath: ['slotId', 'slot'] });
        }
        if (!database.objectStoreNames.contains(ARCHIVE_STORE)) {
          database.createObjectStore(ARCHIVE_STORE, { keyPath: 'lifeId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    });
  }

  private requireDb(): IDBDatabase {
    if (!this.db) throw new Error('IndexedDBStorage.open() has not completed');
    return this.db;
  }

  async readSlot(slotId: string, slot: SaveSlotLetter): Promise<StoredSlot | null> {
    const database = this.requireDb();
    const transaction = database.transaction(SAVE_STORE, 'readonly');
    const request = transaction.objectStore(SAVE_STORE).get([slotId, slot]);
    const result = await requestToPromise<StoredSlot | undefined>(request);
    await transactionDone(transaction);
    return result ?? null;
  }

  async writeSlot(record: StoredSlot, meta: SlotMetaRecord): Promise<void> {
    const database = this.requireDb();
    const transaction = database.transaction([SAVE_STORE, META_STORE], 'readwrite');
    transaction.objectStore(SAVE_STORE).put({
      slotId: record.slotId,
      slot: record.slot,
      envelope: record.envelope,
    });
    transaction.objectStore(META_STORE).put(meta);
    await transactionDone(transaction);
  }

  async readMeta(slotId: string): Promise<SlotMetaRecord | null> {
    const database = this.requireDb();
    const transaction = database.transaction(META_STORE, 'readonly');
    const request = transaction.objectStore(META_STORE).get(slotId);
    const result = await requestToPromise<SlotMetaRecord | undefined>(request);
    await transactionDone(transaction);
    return result ?? null;
  }

  async listMeta(): Promise<SlotMetaRecord[]> {
    const database = this.requireDb();
    const transaction = database.transaction(META_STORE, 'readonly');
    const request = transaction.objectStore(META_STORE).getAll();
    const result = await requestToPromise<SlotMetaRecord[]>(request);
    await transactionDone(transaction);
    return result;
  }

  async deleteSlot(slotId: string): Promise<void> {
    const database = this.requireDb();
    const transaction = database.transaction([SAVE_STORE, META_STORE], 'readwrite');
    const saveStore = transaction.objectStore(SAVE_STORE);
    for (const slot of ['A', 'B'] as const) {
      saveStore.delete([slotId, slot]);
    }
    transaction.objectStore(META_STORE).delete(slotId);
    await transactionDone(transaction);
  }

  async saveArchivedLife(archived: ArchivedLife): Promise<void> {
    const database = this.requireDb();
    const transaction = database.transaction(ARCHIVE_STORE, 'readwrite');
    transaction.objectStore(ARCHIVE_STORE).put(archived);
    await transactionDone(transaction);
  }

  async listArchivedLives(): Promise<ArchivedLifeRecord[]> {
    const database = this.requireDb();
    const transaction = database.transaction(ARCHIVE_STORE, 'readonly');
    const request = transaction.objectStore(ARCHIVE_STORE).getAll();
    const result = await requestToPromise<ArchivedLifeRecord[]>(request);
    await transactionDone(transaction);
    return result;
  }

  async deleteArchivedLife(lifeId: string): Promise<void> {
    const database = this.requireDb();
    const transaction = database.transaction(ARCHIVE_STORE, 'readwrite');
    transaction.objectStore(ARCHIVE_STORE).delete(lifeId);
    await transactionDone(transaction);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

/** Fallback storage used in tests or private browsing modes where IndexedDB is unavailable. */
export class MemorySaveStorage implements ISaveStorage {
  readonly kind = 'memory' as const;
  private readonly saves = new Map<string, StoredSlot>();
  private readonly metas = new Map<string, SlotMetaRecord>();
  private readonly archived = new Map<string, ArchivedLife>();

  async open(): Promise<void> {
    return;
  }

  async readSlot(slotId: string, slot: SaveSlotLetter): Promise<StoredSlot | null> {
    return this.saves.get(slotId + ':' + slot) ?? null;
  }

  async writeSlot(record: StoredSlot, meta: SlotMetaRecord): Promise<void> {
    this.saves.set(record.slotId + ':' + record.slot, structuredClone(record));
    this.metas.set(meta.slotId, structuredClone(meta));
  }

  async readMeta(slotId: string): Promise<SlotMetaRecord | null> {
    return this.metas.get(slotId) ?? null;
  }

  async listMeta(): Promise<SlotMetaRecord[]> {
    return [...this.metas.values()];
  }

  async deleteSlot(slotId: string): Promise<void> {
    this.saves.delete(slotId + ':A');
    this.saves.delete(slotId + ':B');
    this.metas.delete(slotId);
  }

  async saveArchivedLife(archived: ArchivedLife): Promise<void> {
    this.archived.set(archived.lifeId, structuredClone(archived));
  }

  async listArchivedLives(): Promise<ArchivedLife[]> {
    return [...this.archived.values()];
  }

  async deleteArchivedLife(lifeId: string): Promise<void> {
    this.archived.delete(lifeId);
  }

  close(): void {
    return;
  }
}
