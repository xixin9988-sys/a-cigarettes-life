import type {
  FromSimulationWorkerMessage,
  GameState,
  OfflineSimRequest,
  ToSimulationWorkerMessage,
} from '../core/contracts';
import { CONTENT_PACK } from '../data';
import { ContentRegistry } from '../core/ContentRegistry';
import { SimulationRuntime } from '../simulation/SimulationRuntime';

interface WorkerScope {
  postMessage(message: FromSimulationWorkerMessage): void;
  onmessage: ((event: MessageEvent<ToSimulationWorkerMessage>) => void) | null;
  close(): void;
}

const scope = self as unknown as WorkerScope;
const content = new ContentRegistry(CONTENT_PACK);

function post(message: FromSimulationWorkerMessage): void {
  scope.postMessage(message);
}

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

async function handleOffline(request: OfflineSimRequest): Promise<void> {
  try {
    const state = request.baseState;
    // Offline simulation flag: systems apply offline-specific multipliers (e.g. cigarette burn).
    state.flags['offline_simulation'] = true;
    const runtime = new SimulationRuntime({
      state,
      content,
      syncIdCounter: true,
    });
    runtime.setSimTimeSeconds(request.fromSimTime);
    const result = await runtime.runOffline(
      request.fromSimTime,
      request.toSimTime,
      (percent, phase) => {
        post({ kind: 'offline-progress', requestId: request.requestId, percent, phase });
      },
      request.realElapsedMs
    );
    delete state.flags['offline_simulation'];
    state.pendingOffline.lastProcessedSimTime = request.toSimTime;
    state.pendingOffline.pendingSummary = result.summary;
    state.pendingOffline.lastSaveRealMs = Date.now();
    post({
      kind: 'offline-result',
      result: {
        requestId: request.requestId,
        ok: true,
        lastProcessedSimTime: request.toSimTime,
        state,
        summary: result.summary,
        stats: result.stats,
      },
    });
  } catch (error) {
    post({
      kind: 'offline-error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function handleBackground(requestId: string, baseState: GameState, simDeltaSeconds: number): void {
  try {
    const startedAt = Date.now();
    const state = cloneState(baseState);
    const runtime = new SimulationRuntime({ state, content });
    runtime.setSimTimeSeconds(state.clock.simTimeSeconds);
    runtime.advance(simDeltaSeconds);
    runtime.flushPersistence();
    post({
      kind: 'background-result',
      result: {
        requestId,
        state,
        simTimeSeconds: runtime.clock.simTimeSeconds,
        elapsedMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    post({
      kind: 'worker-error',
      message: 'Background simulation failed: ' + (error instanceof Error ? error.message : String(error)),
    });
  }
}

scope.onmessage = (event: MessageEvent<ToSimulationWorkerMessage>) => {
  const message = event.data;
  switch (message.kind) {
    case 'init': {
      post({ kind: 'ready', packVersion: message.packVersion });
      break;
    }
    case 'ping': {
      post({ kind: 'pong', requestId: message.requestId });
      break;
    }
    case 'offline': {
      void handleOffline(message.request);
      break;
    }
    case 'background': {
      handleBackground(message.requestId, message.baseState, message.simDeltaSeconds);
      break;
    }
    case 'shutdown': {
      scope.close();
      break;
    }
    default:
      break;
  }
};