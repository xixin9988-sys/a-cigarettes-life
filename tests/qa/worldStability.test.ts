// QA world stability: multi-seed 30-day headless runs through the REAL SimulationRuntime
// (via SimulationReplay.runHeadlessSimulation). Asserts semantic validity, economy
// integrity, autonomous NPC life, bounded logs and per-seed determinism.
import { describe, expect, it } from 'vitest';
import type { HeadlessRunResult } from '../../src/simulation/SimulationReplay';
import { runHeadlessSimulation } from '../../src/simulation/SimulationReplay';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import {
  assertStateValid,
  content,
  createQaState,
  findNonFiniteNumbers,
  gameplayFingerprint,
  marketPriceViolations,
  negativeBalances,
  validateState,
} from './support/qaHarness';

const SEEDS = [101, 202, 303];
const DAYS = 30;

// The 30-day runs are the slow part of this suite (2-3s each on the dev machine); they are
// computed once per seed and shared by the assertions below.
const cache = new Map<number, HeadlessRunResult>();
function run(seed: number): HeadlessRunResult {
  const cached = cache.get(seed);
  if (cached) return cached;
  const result = runHeadlessSimulation({ seed, days: DAYS, stepMinutes: 360 });
  cache.set(seed, result);
  return result;
}

function sumRelationshipInteractions(result: HeadlessRunResult): number {
  let total = 0;
  for (const npc of Object.values(result.state.npcs)) {
    for (const relationship of Object.values(npc.relationships)) total += relationship.interactionCount;
  }
  return total;
}

function distinctActivities(result: HeadlessRunResult): string[] {
  return [...new Set(Object.values(result.state.npcs).map((npc) => npc.currentActivity))].sort();
}

describe('QA: multi-seed 30-day headless world stability', () => {
  it('runs several seeds for 30 game days and every resulting state is semantically valid', { timeout: 180000 }, () => {
    for (const seed of SEEDS) {
      const result = run(seed);
      const report = validateState(result.state);
      expect(report.issues, 'seed ' + seed + ' issues: ' + report.issues.slice(0, 10).join(' | ')).toEqual([]);
      expect(report.npcCount).toBe(WORLD_CONFIG.population.initialNpcCount);
      expect(report.marketGoods).toBe(content.pack.items.length);
      expect(report.businesses).toBe(content.pack.businesses.length);
      expect(result.simTimeSeconds).toBe(result.state.clock.simTimeSeconds);
      expect(result.state.clock.simTimeSeconds).toBe(480 + DAYS * 1440);
      // Full save round-trip: the state survives JSON serialisation byte-for-byte.
      const roundTrip = JSON.parse(JSON.stringify(result.state)) as typeof result.state;
      expect(findNonFiniteNumbers(roundTrip)).toEqual([]);
      expect(gameplayFingerprint(roundTrip)).toBe(gameplayFingerprint(result.state));
      console.log(
        'QA world seed=' + seed + ' elapsedMs=' + result.elapsedMs.toFixed(0) +
        ' events=' + report.events + ' history=' + report.history +
        ' transactions=' + report.transactions + ' decisions=' + report.decisions +
        ' life=' + result.state.life.phase
      );
    }
  });

  it('keeps the economy finite, non-negative and inside the documented price clamps', { timeout: 120000 }, () => {
    for (const seed of SEEDS) {
      const { state } = run(seed);
      expect(marketPriceViolations(state), 'seed ' + seed + ' price clamps').toEqual([]);
      expect(negativeBalances(state), 'seed ' + seed + ' negative balances').toEqual([]);
      expect(state.economy.economicIndex).toBeGreaterThan(0);
      expect(state.economy.economicIndex).toBeLessThanOrEqual(2);
      expect(state.economy.lastMarketSettlementAt % 60).toBe(0);
      expect(state.economy.lastMarketSettlementAt).toBeLessThanOrEqual(state.clock.simTimeSeconds);
      // Shops must have a live stock: after 30 days restocking, every business still carries
      // at least one stocked line (nobody is permanently sold out).
      for (const business of Object.values(state.economy.businesses)) {
        const stocked = business.stock.filter((entry) => entry.quantity > 0).length;
        expect(stocked, business.id + ' has no stocked lines after 30 days').toBeGreaterThan(0);
      }
      // Wages are actually paid: at least one wage transaction is recorded.
      const wages = state.economy.transactions.filter((record) => record.type === 'wage');
      expect(wages.length, 'seed ' + seed + ' wage transactions').toBeGreaterThan(0);
      for (const record of state.economy.transactions) {
        expect(Number.isFinite(record.totalPrice), record.id).toBe(true);
        expect(record.totalPrice).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('lets NPCs live autonomous lives: activities change, relationships move, logs are bounded', { timeout: 120000 }, () => {
    for (const seed of SEEDS) {
      const result = run(seed);
      const { state } = result;
      const npcs = Object.values(state.npcs);
      const uniqueActivities = distinctActivities(result);
      expect(uniqueActivities.length, 'seed ' + seed + ' activity variety').toBeGreaterThanOrEqual(3);

      const withHistory = npcs.filter((npc) => npc.activityHistory.length > 0).length;
      expect(withHistory, 'seed ' + seed + ' NPCs with activity history').toBeGreaterThanOrEqual(50);

      const withMemories = npcs.filter((npc) => npc.memories.length > 0).length;
      expect(withMemories, 'seed ' + seed + ' NPCs with memories').toBeGreaterThan(0);

      // The player is absent for the whole run: social life must be NPC-NPC driven.
      const interactions = sumRelationshipInteractions(result);
      expect(interactions, 'seed ' + seed + ' NPC-NPC interactions').toBeGreaterThan(0);

      // Every NPC is simulated to the final clock instant (no frozen stragglers).
      for (const npc of npcs) {
        expect(npc.lastUpdatedAt, npc.id + ' lastUpdatedAt').toBe(state.clock.simTimeSeconds);
        expect(content.getLocation(npc.locationId), npc.id + ' location').toBeDefined();
      }

      // The run really changed the world: the diff reports slices, NPCs and events.
      expect(result.diff.changedSlices).toContain('world');
      expect(result.diff.changedSlices).toContain('npcs');
      expect(result.diff.changedNpcIds.length, 'seed ' + seed + ' changed NPCs').toBeGreaterThanOrEqual(50);

      // Logs stay bounded by WORLD_CONFIG (world history is trimmed by the world system).
      expect(state.world.events.length).toBeLessThanOrEqual(WORLD_CONFIG.simulation.maxWorldEventLog);
      expect(state.world.history.length).toBeLessThanOrEqual(WORLD_CONFIG.simulation.maxHistoryEntries);
      expect(state.probability.history.length).toBeLessThanOrEqual(WORLD_CONFIG.probability.historyLimit);
      expect(state.economy.transactions.length).toBeLessThanOrEqual(101);
      console.log(
        'QA npc seed=' + seed + ' activities=' + uniqueActivities.length +
        ' distinct=' + uniqueActivities.slice(0, 6).join('/') +
        ' withHistory=' + withHistory + ' interactions=' + interactions +
        ' history=' + state.world.history.length + ' events=' + state.world.events.length
      );
    }
  });

  it('burns the cigarette out during a 30-day unattended run and archives the life truthfully', { timeout: 120000 }, () => {
    for (const seed of SEEDS) {
      const { state } = run(seed);
      // Full-length cigarette = 336 game hours = 14 game days at base rate, so by day 30 the
      // unattended body has burned out. LifeSystem must archive the complete review.
      expect(state.life.phase, 'seed ' + seed + ' life phase').toBe('ended');
      expect(state.life.endReason, 'seed ' + seed + ' end reason').not.toBeNull();
      expect(state.life.endedAt).not.toBeNull();
      expect(state.player.cigarette.lengthRatio).toBe(0);
      expect(state.life.archive.length).toBeGreaterThanOrEqual(1);
      expect(state.archive.length).toBeGreaterThanOrEqual(1);
      const review = state.archive[state.archive.length - 1];
      expect(review).toBeDefined();
      if (!review) continue;
      expect(review.lifeId).toBe(state.life.lifeId);
      expect(review.endedAt).toBeGreaterThan(review.startedAt);
      expect(review.durationDays).toBeGreaterThan(0);
      expect(Number.isFinite(review.finalMoney)).toBe(true);
    }
  });

  it('is deterministic per seed and genuinely different across seeds', { timeout: 180000 }, () => {
    // Same seed + same stepping => byte-identical gameplay state (wall-clock-only fields
    // are zeroed by gameplayFingerprint; generated ids are seed-configured and counter based
    // via configureIdGenerator()).
    const first = run(101);
    const repeated = runHeadlessSimulation({ seed: 101, days: DAYS, stepMinutes: 360 });
    expect(gameplayFingerprint(repeated.state)).toBe(gameplayFingerprint(first.state));

    const different = runHeadlessSimulation({ seed: 999, days: DAYS, stepMinutes: 360 });
    expect(gameplayFingerprint(different.state)).not.toBe(gameplayFingerprint(first.state));
    expect(different.state.world.seed).not.toBe(first.state.world.seed);
  });
});
