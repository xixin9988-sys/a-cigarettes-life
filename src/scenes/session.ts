import type { ISceneSession } from '../ui/UIInterfaces';

let currentSession: ISceneSession | null = null;

export function setSceneSession(session: ISceneSession): void {
  currentSession = session;
}

export function getSceneSession(): ISceneSession {
  if (!currentSession) throw new Error('Scene session has not been set yet');
  return currentSession;
}

export function hasSceneSession(): boolean {
  return currentSession !== null;
}
