import type {
  BackgroundTickResult,
  GameState,
  IWorkerBridge,
  OfflineSimRequest,
  OfflineSimResult,
} from '../core/contracts';
import { WORKER_PROTOCOL_VERSION, WORKER_PACK_VERSION, createWorkerRequestId } from './WorkerProtocol';
import type { WorkerInbound, WorkerOutbound } from './WorkerProtocol';

interface PendingOffline {
  resolve: (result: OfflineSimResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface PendingBackground {
  resolve: (result: BackgroundTickResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Promised request/response wrapper around the Vite simulation Web Worker. */
export class WorkerBridge implements IWorkerBridge {
  ready = false;
  private worker: Worker | null = null;
  private startPromise: Promise<void> | null = null;
  private startResolve: (() => void) | null = null;
  private startReject: ((error: Error) => void) | null = null;
  private readonly pendingOffline = new Map<string, PendingOffline>();
  private readonly pendingBackground = new Map<string, PendingBackground>();
  private readonly pendingPings = new Map<string, (ok: boolean) => void>();
  private progressHandler: ((percent: number, phase: string) => void) | null = null;

  start(onProgress?: (percent: number, phase: string) => void): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.progressHandler = onProgress ?? null;
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
      try {
        const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
        this.worker = worker;
        worker.onmessage = (event: MessageEvent<WorkerOutbound>) => this.handleMessage(event.data);
        worker.onerror = (event) => this.handleFatal(event.message || 'simulation worker error');
        const initMessage: WorkerInbound = {
          kind: 'init',
          seed: 0,
          packVersion: WORKER_PACK_VERSION + ':' + WORKER_PROTOCOL_VERSION,
        };
        worker.postMessage(initMessage);
      } catch (error) {
        this.startReject?.(error instanceof Error ? error : new Error(String(error)));
        this.startPromise = null;
      }
    });
    return this.startPromise;
  }

  private failAll(error: Error): void {
    for (const pending of this.pendingOffline.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingOffline.clear();
    for (const pending of this.pendingBackground.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingBackground.clear();
  }

  private handleFatal(message: string): void {
    this.ready = false;
    const error = new Error(message);
    this.failAll(error);
    this.startReject?.(error);
  }

  private handleMessage(message: WorkerOutbound): void {
    switch (message.kind) {
      case 'ready': {
        this.ready = true;
        this.startResolve?.();
        break;
      }
      case 'pong': {
        const resolve = this.pendingPings.get(message.requestId);
        if (resolve) {
          this.pendingPings.delete(message.requestId);
          resolve(true);
        }
        break;
      }
      case 'offline-progress': {
        this.progressHandler?.(message.percent, message.phase);
        break;
      }
      case 'offline-result': {
        const pending = this.pendingOffline.get(message.result.requestId);
        if (pending) {
          if (pending.timer) clearTimeout(pending.timer);
          this.pendingOffline.delete(message.result.requestId);
          pending.resolve(message.result);
        }
        break;
      }
      case 'offline-error': {
        const pending = this.pendingOffline.get(message.requestId);
        if (pending) {
          if (pending.timer) clearTimeout(pending.timer);
          this.pendingOffline.delete(message.requestId);
          pending.reject(new Error(message.message));
        }
        break;
      }
      case 'background-result': {
        const pending = this.pendingBackground.get(message.result.requestId);
        if (pending) {
          if (pending.timer) clearTimeout(pending.timer);
          this.pendingBackground.delete(message.result.requestId);
          pending.resolve(message.result);
        }
        break;
      }
      case 'worker-error': {
        this.handleFatal(message.message);
        break;
      }
      default:
        break;
    }
  }

  requestOffline(request: OfflineSimRequest): Promise<OfflineSimResult> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('Worker is not started'));
    return new Promise<OfflineSimResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingOffline.delete(request.requestId);
        reject(new Error('Offline simulation timed out'));
      }, 60000);
      this.pendingOffline.set(request.requestId, { resolve, reject, timer });
      const message: WorkerInbound = { kind: 'offline', request };
      worker.postMessage(message);
    });
  }

  requestBackground(baseState: GameState, simDeltaSeconds: number): Promise<BackgroundTickResult> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('Worker is not started'));
    const requestId = createWorkerRequestId('bg');
    return new Promise<BackgroundTickResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingBackground.delete(requestId);
        reject(new Error('Background simulation timed out'));
      }, 30000);
      this.pendingBackground.set(requestId, { resolve, reject, timer });
      const message: WorkerInbound = { kind: 'background', requestId, baseState, simDeltaSeconds };
      worker.postMessage(message);
    });
  }

  ping(): Promise<boolean> {
    const worker = this.worker;
    if (!worker) return Promise.resolve(false);
    const requestId = createWorkerRequestId('ping');
    return new Promise<boolean>((resolve) => {
      this.pendingPings.set(requestId, resolve);
      setTimeout(() => {
        if (this.pendingPings.delete(requestId)) resolve(false);
      }, 5000);
      worker.postMessage({ kind: 'ping', requestId } satisfies WorkerInbound);
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.startPromise = null;
    this.failAll(new Error('Worker terminated'));
  }
}
