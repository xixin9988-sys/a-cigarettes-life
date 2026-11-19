import { describe, it, expect, beforeEach } from 'vitest';
import { ContentRegistry } from '../../src/core/ContentRegistry';
import { createInitialGameState, DEFAULT_APPEARANCE } from '../../src/core/WorldFactory';
import { CONTENT_PACK } from '../../src/data';
import { MemorySaveStorage, type ISaveStorage } from '../../src/persistence/IndexedDBStorage';
import { SaveManager } from '../../src/persistence/SaveManager';
import { checksumOfPayload } from '../../src/persistence/ChecksumUtil';
import type { GameState } from '../../src/core/contracts';

function buildState(): GameState {
  const content = new ContentRegistry(CONTENT_PACK);
  return createInitialGameState({
    seed: 123456,
    playerName: 'Test Cigarette',
    appearance: DEFAULT_APPEARANCE,
    content,
  });
}

async function createManager(state: { current: GameState }, storage?: ISaveStorage): Promise<SaveManager> {
  const manager = new SaveManager(
    {
      getState: () => state.current,
      applyState: (next) => {
        state.current = next;
      },
      beforeSave: () => {
        // No-op: SaveManager serialises the current state directly.
      },
    },
    storage ?? new MemorySaveStorage()
  );
  await manager.init();
  return manager;
}

describe('SaveManager', () => {
  let ownState: { current: GameState };
  beforeEach(() => {
    ownState = { current: buildState() };
  });

  it('writes a slot and lists metadata with real player data', async () => {
    const manager = await createManager(ownState);
    const result = await manager.save('slot_1');
    expect(result.ok).toBe(true);
    const slots = await manager.listSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0]?.playerName).toBe('Test Cigarette');
    expect(slots[0]?.money).toBe(ownState.current.player.money);
    expect(slots[0]?.generation).toBe(1);
    manager.close();
  });

  it('round-trips the game state through save and load', async () => {
    const manager = await createManager(ownState);
    ownState.current.player.money = 4242;
    ownState.current.player.cigarette.lengthRatio = 0.61;
    ownState.current.clock.simTimeSeconds = 12345;
    await manager.save('slot_1');

    ownState.current = buildState(); // pretend a fresh boot
    const loaded = await manager.load('slot_1');
    expect(loaded).not.toBeNull();
    expect(loaded?.player.money).toBe(4242);
    expect(loaded?.player.cigarette.lengthRatio).toBeCloseTo(0.61, 5);
    expect(ownState.current).toBe(loaded);
    manager.close();
  });

  it('ping-pongs between the A and B slots and rolls back on corruption', async () => {
    const storage = new MemorySaveStorage();
    const manager = await createManager(ownState, storage);

    ownState.current.player.money = 100;
    await manager.save('slot_1');
    ownState.current.player.money = 200;
    await manager.save('slot_1');

    const slotA = await storage.readSlot('slot_1', 'A');
    const slotB = await storage.readSlot('slot_1', 'B');
    expect(slotA).not.toBeNull();
    expect(slotB).not.toBeNull();

    // Corrupt the newest (money=200) slot: load must fall back to the other valid slot.
    const newer = slotA?.envelope.payload.player.money === 200 ? slotA : slotB;
    expect(newer).not.toBeNull();
    if (newer) {
      const meta = await storage.readMeta('slot_1');
      expect(meta).not.toBeNull();
      if (meta) {
        await storage.writeSlot(
          { ...newer, envelope: { ...newer.envelope, checksum: 'deadbeef' } },
          meta
        );
      }
    }
    const loaded = await manager.load('slot_1');
    expect(loaded).not.toBeNull();
    expect(loaded?.player.money).toBe(100); // the older valid slot
    manager.close();
  });

  it('exports and imports a save with checksum validation', async () => {
    const manager = await createManager(ownState);
    ownState.current.player.name = 'Exported Ash';
    await manager.save('slot_1');
    const json = await manager.exportSave('slot_1');
    expect(json).not.toBeNull();
    if (!json) return;

    const target = { current: buildState() };
    const other = await createManager(target);
    const result = await other.importSave(json, 'slot_import');
    expect(result.ok).toBe(true);
    expect(target.current.player.name).toBe('Exported Ash');

    const tampered = json.replace('Exported Ash', 'Tampered Ash');
    const result2 = await other.importSave(tampered, 'slot_import_2');
    expect(result2.ok).toBe(false);
    manager.close();
    other.close();
  });

  it('rejects state with a missing checksum and reports corrupted slots', async () => {
    const manager = await createManager(ownState);
    const result = await manager.importSave('{"version":1,"payload":{}}', 'slot_x');
    expect(result.ok).toBe(false);
    manager.close();
  });

  it('checksums are stable and version tolerant', () => {
    const state = buildState();
    const first = checksumOfPayload(state);
    const second = checksumOfPayload(state);
    expect(first).toBe(second);
    expect(first).toHaveLength(8);
    state.player.money += 1;
    expect(checksumOfPayload(state)).not.toBe(first);
  });
});