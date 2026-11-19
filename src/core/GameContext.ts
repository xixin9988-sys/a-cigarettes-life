import type { IGameContext, IProbabilityEngine, IEventBus, IClock, ISystemRegistry, IContentRegistry, ILogger, IRngFacade } from './contracts';
import type { GameState } from './contracts';

/** Fisher-Yates + weighted helpers powered by the unified probability engine. */
export class RngFacade implements IRngFacade {
  constructor(private readonly probability: IProbabilityEngine) {}

  roll(streamId: string): number {
    return this.probability.roll(streamId);
  }

  chance(streamId: string, probability: number): boolean {
    return this.probability.chance(streamId, probability);
  }

  floatRange(streamId: string, min: number, max: number): number {
    return this.probability.floatRange(streamId, min, max);
  }

  intRange(streamId: string, minInclusive: number, maxInclusive: number): number {
    return this.probability.intRange(streamId, minInclusive, maxInclusive);
  }

  weighted<T>(streamId: string, candidates: readonly { weight: number; value: T }[]): T | null {
    return this.probability.weighted(streamId, candidates);
  }

  shuffle<T>(streamId: string, values: readonly T[]): T[] {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = this.probability.intRange(streamId, 0, i);
      const current = result[i];
      const other = result[j];
      if (current !== undefined && other !== undefined) {
        result[i] = other;
        result[j] = current;
      }
    }
    return result;
  }
}

export interface GameContextParams {
  state: GameState;
  content: IContentRegistry;
  probability: IProbabilityEngine;
  bus: IEventBus;
  clock: IClock;
  registry: ISystemRegistry;
  rng: IRngFacade;
  logger: ILogger;
}

export function createGameContext(params: GameContextParams): IGameContext {
  return {
    state: params.state,
    content: params.content,
    probability: params.probability,
    bus: params.bus,
    clock: params.clock,
    registry: params.registry,
    rng: params.rng,
    logger: params.logger,
  };
}
