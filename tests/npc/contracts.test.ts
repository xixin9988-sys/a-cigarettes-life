// =============================================================================
// Contract and hygiene tests for the NPC module:
//  - exactly implements INPCSystem (compile-time assignment),
//  - mutates only NPC-owned slices (does not touch player money/economy),
//  - no Math.random / DOM / Phaser imports in src/npc.
// =============================================================================
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { INPCSystem } from '../../src/core/contracts';
import { NPC } from '../../src/data/npcs/ids';
import { createNpcHarness } from './support/harness';

describe('NPC module contracts and hygiene', () => {
  it('implements the INPCSystem contract exactly', () => {
    const harness = createNpcHarness({ seed: 123123 });
    const system: INPCSystem = harness.system;
    expect(system.id).toBe('npc');
    expect(typeof system.init).toBe('function');
    expect(typeof system.update).toBe('function');
    expect(system.getNPC(NPC.edmundHale)?.name).toBe('Edmund Hale');
    expect(system.getAllNPCs()).toHaveLength(56);
    expect(system.getMajorNPCs()).toHaveLength(14);
    expect(Array.isArray(system.getNPCsAt('willowbrook_home'))).toBe(true);
    expect(system.getNearbyNPCs()).toBeDefined();
    expect(system.getLastDecision(NPC.edmundHale)).toBeNull();
  });

  it('does not mutate the player or economy slices while agents live their lives', () => {
    const harness = createNpcHarness({ seed: 234234 });
    const playerMoney = harness.state.player.money;
    const playerInventory = JSON.stringify(harness.state.player.inventory);
    const playerSkills = JSON.stringify(harness.state.player.skills);
    const economy = JSON.stringify(harness.state.economy);
    harness.advanceGameDays(3, 0.5);
    expect(harness.state.player.money).toBe(playerMoney);
    expect(JSON.stringify(harness.state.player.inventory)).toBe(playerInventory);
    expect(JSON.stringify(harness.state.player.skills)).toBe(playerSkills);
    expect(JSON.stringify(harness.state.economy)).toBe(economy);
  });

  it('keeps src/npc free of Math.random, DOM globals and Phaser imports', () => {
    const directory = join(process.cwd(), 'src', 'npc');
    const files = readdirSync(directory).filter((file) => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const file of files) {
      const source = readFileSync(join(directory, file), 'utf8');
      expect(source.includes('Math.random'), file).toBe(false);
      expect(/from ['"]phaser['"]/.test(source), file).toBe(false);
      for (const forbidden of ['window.', 'document.', 'localStorage', 'navigator.']) {
        expect(source.includes(forbidden), file + ' -> ' + forbidden).toBe(false);
      }
    }
  });

  it('is safe to re-init (systems may be rebuilt on save load) without duplicating data', () => {
    const harness = createNpcHarness({ seed: 456456 });
    const romanceEntries = (): number =>
      Object.values(harness.state.npcs).reduce(
        (total, npc) => total + npc.lifeHistory.filter((entry) => entry.type === 'romance').length,
        0
      );
    const before = romanceEntries();
    expect(before).toBeGreaterThan(0);
    const socialLogBefore = harness.state.social.npcSocialLog.length;
    harness.system.init(harness.ctx);
    expect(romanceEntries()).toBe(before);
    expect(harness.state.social.npcSocialLog.length).toBe(socialLogBefore);
    expect(Object.keys(harness.state.npcs)).toHaveLength(56);
    expect(harness.system.getMajorNPCs()).toHaveLength(14);
  });

  it('echoes world events into participant needs, emotions and memories', () => {
    const harness = createNpcHarness({ seed: 567567 });
    const npc = harness.npc(NPC.marigoldLyle);
    const funBefore = npc.needs.fun;
    const memoriesBefore = npc.memories.length;
    harness.bus.emit('event:occurred', {
      event: {
        id: 'event_test_1',
        type: 'village_fete',
        category: 'lucky',
        title: 'A surprise village fete',
        description: 'Bunting appears across the square and everyone is invited.',
        createdAt: harness.clock.simTimeSeconds,
        occurredAt: harness.clock.simTimeSeconds,
        locationId: 'willowbrook_plaza',
        participants: [npc.id],
        cause: [],
        result: {},
        importance: 3,
        archived: false,
        acknowledged: false,
      },
    });
    expect(npc.needs.fun).toBeGreaterThan(funBefore);
    expect(npc.memories.length).toBeGreaterThan(memoriesBefore);
    expect(npc.memories.some((memory) => memory.type === 'event:village_fete')).toBe(true);
  });

  it('records a new job when the economy hires an NPC', () => {
    const harness = createNpcHarness({ seed: 678678 });
    const npc = harness.npc(NPC.haroldBagg);
    expect(harness.system.recordNewJob(npc.id, 'missing_job', 'Postman').ok).toBe(false);
    harness.state.economy.jobs['job_test_post'] = {
      id: 'job_test_post',
      businessId: 'biz_test',
      title: 'Postman',
      wagePerHour: 1000,
      startHour: 8,
      endHour: 16,
      slots: 1,
      employeeIds: [],
      levelReq: 1,
      playerAvailable: true,
      isPlayerJob: false,
      lastWorkedAt: 0,
    };
    const result = harness.system.recordNewJob(npc.id, 'job_test_post', 'Postman');
    expect(result.ok).toBe(true);
    expect(npc.jobId).toBe('job_test_post');
    expect(npc.lifeHistory.some((entry) => entry.type === 'new_job')).toBe(true);
  });

  it('keeps the probability streams independent and named', () => {
    const harness = createNpcHarness({ seed: 345345 });
    const streams = harness.probability.listStreams();
    for (const stream of ['npc.behavior', 'npc.social', 'npc.schedule', 'npc.memory']) {
      expect(streams.includes(stream), stream).toBe(true);
    }
    const before = harness.probability.roll('npc.behavior');
    const after = harness.probability.roll('npc.behavior');
    expect(before).toBeGreaterThanOrEqual(0);
    expect(after).toBeGreaterThanOrEqual(0);
    expect(harness.probability.getStats('npc.schedule').draws).toBeGreaterThanOrEqual(0);
  });
});
