import type { FromSimulationWorkerMessage, ToSimulationWorkerMessage } from '../core/contracts';

export const WORKER_PROTOCOL_VERSION = '1';
export const WORKER_PACK_VERSION = '1';

export type WorkerInbound = ToSimulationWorkerMessage;
export type WorkerOutbound = FromSimulationWorkerMessage;

let requestCounter = 0;

/** Creates a unique worker request id without relying on Math.random. */
export function createWorkerRequestId(prefix = 'req'): string {
  requestCounter += 1;
  return prefix + '_' + Date.now().toString(36) + '_' + requestCounter.toString(36);
}

export function isWorkerOutbound(value: unknown): value is WorkerOutbound {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.kind === 'string';
}
