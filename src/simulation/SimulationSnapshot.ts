import type { GameState } from '../core/contracts';

export interface SimulationSnapshot {
  simTimeSeconds: number;
  capturedAt: number;
  state: GameState;
}

/** Deep, JSON-safe snapshot of the full simulation state. */
export function captureSnapshot(state: GameState): SimulationSnapshot {
  return {
    simTimeSeconds: state.clock.simTimeSeconds,
    capturedAt: Date.now(),
    state: structuredClone(state),
  };
}

export function restoreSnapshot(snapshot: SimulationSnapshot): GameState {
  return structuredClone(snapshot.state);
}

export function snapshotSizeBytes(snapshot: SimulationSnapshot): number {
  return JSON.stringify(snapshot.state).length;
}

/** Serialises a snapshot for replay storage. */
export function serialiseSnapshot(snapshot: SimulationSnapshot): string {
  return JSON.stringify(snapshot);
}

export function deserialiseSnapshot(json: string): SimulationSnapshot {
  const parsed = JSON.parse(json) as Partial<SimulationSnapshot>;
  if (!parsed.state || typeof parsed.simTimeSeconds !== 'number') {
    throw new Error('Invalid simulation snapshot');
  }
  return parsed as SimulationSnapshot;
}
