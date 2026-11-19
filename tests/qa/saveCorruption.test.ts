// QA save / corruption / migration scenarios through the REAL SaveManager and its
// ping-pong storage (MemorySaveStorage exercises the exact production code path).
import { describe, expect, it } from 'vitest';
import { SaveManager } from '../../src/persistence/SaveManager';
import { MemorySaveStorage, type SaveSlotLetter } from '../../src/persistence/IndexedDBStorage';
import { checksumOfPayload, isValidChecksum } from '../../src/persistence/ChecksumUtil';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import type { GameState, SaveEnvelope } from '../../src/core/contracts';
import { assertStateValid, createQaState, jsonClone } from './support/qaHarness';

interface Holder {
  current: GameState;
}

function createManager(holder: Holder, storage: MemorySaveStorage): SaveManager {
  return new SaveManager(
    {
      getState: () => holder.current,
      applyState: (next) => {
        holder.current = next;
      },
    },
    storage
  );
}

async function setup(seed = 123456): Promise<{ holder: Holder; storage: MemorySaveStorage; manager: SaveManager }> {
  const holder: Holder = { current: createQaState(seed, 'QA Save') };
  const storage = new MemorySaveStorage();
  const manager = createManager(holder, storage);
  await manager.init();
  return { holder, storage, manager };
}

describe('QA: save / corruption / migration', () => {
  it('writes ping-pong A/B slots and rolls back to the older valid slot when the newest is corrupted', { timeout: 60000 }, async () => {
    const { holder, storage, manager } = await setup();
    holder.current.player.money = 100;
    expect((await manager.save('slot_qa')).ok).toBe(true);
    holder.current.player.money = 200;
    expect((await manager.save('slot_qa')).ok).toBe(true);
    holder.current.player.money = 300;
    expect((await manager.save('slot_qa')).ok).toBe(true);

    const slotA = await storage.readSlot('slot_qa', 'A');
    const slotB = await storage.readSlot('slot_qa', 'B');
    expect(slotA).not.toBeNull();
    expect(slotB).not.toBeNull();
    expect(isValidChecksum(slotA?.envelope.payload as GameState, slotA?.envelope.checksum ?? '')).toBe(true);
    expect(isValidChecksum(slotB?.envelope.payload as GameState, slotB?.envelope.checksum ?? '')).toBe(true);
    // Third save overwrote slot A (ping-pong), so A holds 300 and B holds 200.
    expect(slotA?.envelope.payload.player.money).toBe(300);
    expect(slotB?.envelope.payload.player.money).toBe(200);
    const meta = await storage.readMeta('slot_qa');
    expect(meta?.nextSlot).toBe('B');

    // Corrupt the newest payload (slot A) -> load must fall back to B (money 200).
    const corrupted: SaveEnvelope = { ...(slotA as NonNullable<typeof slotA>).envelope, checksum: 'deadbeef' };
    await storage.writeSlot({ slotId: 'slot_qa', slot: 'A', envelope: corrupted }, meta as NonNullable<typeof meta>);
    const loaded = await manager.load('slot_qa');
    expect(loaded).not.toBeNull();
    expect(loaded?.player.money).toBe(200);
    expect(assertStateValid(loaded as GameState, 'fallback loaded state')).toBeUndefined();
    manager.close();
  });

  it('reports a fully corrupted slot honestly instead of returning a broken state', { timeout: 60000 }, async () => {
    const { holder, storage, manager } = await setup(2222);
    holder.current.player.money = 10;
    await manager.save('slot_bad');
    holder.current.player.money = 20;
    await manager.save('slot_bad');
    const meta = await storage.readMeta('slot_bad');
    expect(meta).not.toBeNull();
    if (!meta) return;
    for (const slot of ['A', 'B'] as const) {
      const record = await storage.readSlot('slot_bad', slot);
      if (!record) continue;
      await storage.writeSlot({ ...record, envelope: { ...record.envelope, checksum: '00000000' } }, meta);
    }
    await expect(manager.load('slot_bad')).rejects.toThrow(/corrupted/i);
    expect(await manager.exportSave('slot_bad')).toBeNull();
    // A missing slot is not an error, just empty.
    expect(await manager.load('slot_missing')).toBeNull();
    manager.close();
  });

  it('migrates older save versions and rejects structurally invalid payloads', { timeout: 60000 }, async () => {
    const { holder, storage, manager } = await setup(3333);
    const oldState = jsonClone(holder.current);
    oldState.version = 0;
    oldState.meta.saveVersion = 0;
    oldState.player.name = 'Legacy Ash';
    const envelope: SaveEnvelope = {
      version: 0,
      checksum: checksumOfPayload(oldState),
      savedAtRealMs: Date.now(),
      lastProcessedSimTime: oldState.clock.simTimeSeconds,
      payload: oldState,
    };
    await storage.writeSlot(
      { slotId: 'slot_old', slot: 'A' as SaveSlotLetter, envelope },
      {
        slotId: 'slot_old',
        meta: {
          slotId: 'slot_old',
          worldId: oldState.world.worldId,
          lifeId: oldState.player.lifeId,
          playerName: oldState.player.name,
          generation: 1,
          year: 1,
          season: 'spring',
          dayOfSeason: 1,
          money: oldState.player.money,
          playTimeSeconds: 0,
          savedAt: Date.now(),
          saveVersion: 0,
          checksum: envelope.checksum,
        },
        nextSlot: 'B',
      }
    );
    const migrated = await manager.load('slot_old');
    expect(migrated).not.toBeNull();
    expect(migrated?.version).toBe(WORLD_CONFIG.saveVersion);
    expect(migrated?.meta.saveVersion).toBe(WORLD_CONFIG.saveVersion);
    expect(migrated?.player.name).toBe('Legacy Ash');

    // A payload that parses and checksums but is structurally incomplete must be rejected.
    const broken = jsonClone(holder.current) as unknown as Record<string, unknown>;
    delete broken.player;
    const brokenChecksum = checksumOfPayload(broken as unknown as GameState);
    const brokenJson = JSON.stringify({ version: 1, checksum: brokenChecksum, savedAtRealMs: 1, lastProcessedSimTime: 0, payload: broken });
    const importResult = await manager.importSave(brokenJson, 'slot_broken');
    expect(importResult.ok).toBe(false);
    manager.close();
  });

  it('exports, imports and validates envelopes and backup bundles; tampering is rejected', { timeout: 60000 }, async () => {
    const source = await setup(4444);
    source.holder.current.player.name = 'Exported Ash';
    source.holder.current.player.money = 12345;
    expect((await source.manager.save('slot_export')).ok).toBe(true);
    const envelopeJson = await source.manager.exportSave('slot_export');
    const backupJson = await source.manager.exportBackup();
    expect(envelopeJson).not.toBeNull();
    expect(backupJson.length).toBeGreaterThan(100);

    const target = await setup(5555);
    if (envelopeJson) {
      const imported = await target.manager.importSave(envelopeJson, 'slot_import');
      expect(imported.ok, imported.message).toBe(true);
      expect(target.holder.current.player.name).toBe('Exported Ash');
      expect(target.holder.current.player.money).toBe(12345);
      assertStateValid(target.holder.current, 'imported state');
      const slots = await target.manager.listSlots();
      expect(slots.some((slot) => slot.slotId === 'slot_import')).toBe(true);

      const tampered = envelopeJson.split('Exported Ash').join('Tampered Ash');
      const rejected = await target.manager.importSave(tampered, 'slot_tampered');
      expect(rejected.ok).toBe(false);
    }

    const backupImported = await target.manager.importSave(backupJson, 'slot_backup');
    expect(backupImported.ok, backupImported.message).toBe(true);
    expect(target.holder.current.player.name).toBe('Exported Ash');
    expect(await target.manager.hasAnySave()).toBe(true);

    // Garbage input is rejected without throwing.
    expect((await target.manager.importSave('{"nope":true}', 'slot_garbage')).ok).toBe(false);
    source.manager.close();
    target.manager.close();
  });

  it('round-trips the full state through save/load without losing gameplay data', { timeout: 60000 }, async () => {
    const { holder, manager } = await setup(6666);
    holder.current.player.money = 777;
    holder.current.player.cigarette.lengthRatio = 0.42;
    holder.current.world.history.push({
      id: 'hist_qa_marker',
      at: holder.current.clock.simTimeSeconds,
      category: 'world',
      description: 'QA round-trip marker',
      importance: 3,
      participantIds: [],
    });
    expect((await manager.save('slot_roundtrip')).ok).toBe(true);
    const savedSnapshot = jsonClone(holder.current);
    holder.current = createQaState(9999, 'Fresh boot');
    const loaded = await manager.load('slot_roundtrip');
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.player.money).toBe(777);
    expect(loaded.player.cigarette.lengthRatio).toBeCloseTo(0.42, 6);
    expect(loaded.world.history.some((entry) => entry.id === 'hist_qa_marker')).toBe(true);
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(savedSnapshot));
    manager.close();
  });
});
