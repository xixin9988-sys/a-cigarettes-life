import type { GameEventMap, GameEventTopic, IEventBus } from './contracts';

type AnyHandler = (payload: unknown) => void;

/** Type-safe synchronous event bus. Subscriptions return an unsubscribe function. */
export class EventBus implements IEventBus {
  private readonly listeners = new Map<string, Set<AnyHandler>>();

  on<K extends GameEventTopic>(topic: K, handler: (payload: GameEventMap[K]) => void): () => void {
    let set = this.listeners.get(topic);
    if (!set) {
      set = new Set<AnyHandler>();
      this.listeners.set(topic, set);
    }
    const wrapped = handler as AnyHandler;
    set.add(wrapped);
    return () => this.off(topic, handler);
  }

  once<K extends GameEventTopic>(topic: K, handler: (payload: GameEventMap[K]) => void): () => void {
    const unsubscribe = this.on(topic, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  emit<K extends GameEventTopic>(topic: K, payload: GameEventMap[K]): void {
    const set = this.listeners.get(topic);
    if (!set || set.size === 0) return;
    for (const handler of Array.from(set)) {
      try {
        handler(payload);
      } catch (error) {
        console.error('[EventBus] handler failed for "' + topic + '"', error);
      }
    }
  }

  off<K extends GameEventTopic>(topic: K, handler: (payload: GameEventMap[K]) => void): void {
    const set = this.listeners.get(topic);
    if (!set) return;
    set.delete(handler as AnyHandler);
    if (set.size === 0) this.listeners.delete(topic);
  }

  clear(): void {
    this.listeners.clear();
  }

  listenerCount(topic: GameEventTopic): number {
    return this.listeners.get(topic)?.size ?? 0;
  }
}
