import type { GameState, IContentRegistry } from '../core/contracts';
import { ContentRegistry } from '../core/ContentRegistry';
import { CONTENT_PACK } from '../data';
import { createInitialGameState, DEFAULT_APPEARANCE } from '../core/WorldFactory';
import { SimulationRuntime } from './SimulationRuntime';
import { captureSnapshot, type SimulationSnapshot } from './SimulationSnapshot';
import { diffGameStates, type StateDiff } from './StateDiffEngine';

export interface HeadlessRunOptions {
  seed: number;
  days: number;
  content?: IContentRegistry;
  playerName?: string;
  stepMinutes?: number;
  snapshotEveryDays?: number;
}

export interface HeadlessRunResult {
  seed: number;
  state: GameState;
  snapshots: SimulationSnapshot[];
  diff: StateDiff;
  simTimeSeconds: number;
  gameDays: number;
  elapsedMs: number;
  events: number;
  npcDecisionSample: { npcId: string; activity: string; locationId: string }[];
}

/**
 * Deterministic headless simulation used by automated tests and the QA "many seeds" runner.
 * Advances the entire world without a renderer or player input.
 */
export function runHeadlessSimulation(options: HeadlessRunOptions): HeadlessRunResult {
  const content = options.content ?? new ContentRegistry(CONTENT_PACK);
  const startedAt = Date.now();
  const state = createInitialGameState({
    seed: options.seed >>> 0,
    playerName: options.playerName ?? 'Headless',
    appearance: DEFAULT_APPEARANCE,
    content,
  });
  const runtime = new SimulationRuntime({ state, content });
  runtime.setSimTimeSeconds(state.clock.simTimeSeconds);
  const initialSnapshot = captureSnapshot(state);
  const snapshots: SimulationSnapshot[] = [];
  // 1 game day = 1440 sim seconds and 1 sim second = 1 in-game minute.
  const totalSimSeconds = options.days * 1440;
  const stepMinutes = options.stepMinutes ?? 30;
  const stepSimSeconds = Math.max(1, stepMinutes);
  const steps = Math.max(1, Math.ceil(totalSimSeconds / stepSimSeconds));
  const snapshotInterval = options.snapshotEveryDays ?? Math.max(1, Math.floor(options.days / 4));
  let nextSnapshotDay = snapshotInterval;

  for (let index = 0; index < steps; index += 1) {
    runtime.advance(stepSimSeconds);
    const currentDay = Math.floor(runtime.clock.simTimeSeconds / 1440);
    if (currentDay >= nextSnapshotDay) {
      snapshots.push(captureSnapshot(state));
      nextSnapshotDay += snapshotInterval;
    }
  }
  runtime.flushPersistence();
  const npcDecisionSample = Object.values(state.npcs)
    .slice(0, 12)
    .map((npc) => ({ npcId: npc.id, activity: npc.currentActivity, locationId: npc.locationId }));

  return {
    seed: options.seed,
    state,
    snapshots,
    diff: diffGameStates(initialSnapshot.state, state),
    simTimeSeconds: runtime.clock.simTimeSeconds,
    gameDays: options.days,
    elapsedMs: Date.now() - startedAt,
    events: state.world.events.length,
    npcDecisionSample,
  };
}

/** Runs several seeds and returns a compact comparison for balance/QA reporting. */
export function compareSeeds(seeds: number[], days: number): { seed: number; events: number; npcsWithActivities: number; elapsedMs: number }[] {
  return seeds.map((seed) => {
    const result = runHeadlessSimulation({ seed, days });
    const npcsWithActivities = Object.values(result.state.npcs).filter(
      (npc) => npc.activityHistory.length > 0
    ).length;
    return { seed, events: result.events, npcsWithActivities, elapsedMs: result.elapsedMs };
  });
}
