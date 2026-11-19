import { describe, expect, it } from 'vitest';
import type { ProbabilityContext, ProbabilityRequest } from '../../src/core/contracts';
import { WORLD_CONFIG } from '../../src/core/WorldConfig';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import { makeContext } from './helpers';

function makeRequest(overrides: Partial<ProbabilityRequest<string>> = {}): ProbabilityRequest<string> {
  return {
    streamId: 'social.dialogue',
    decisionType: 'dialogue_branch',
    context: makeContext({ simulationTime: 500, weather: 'clear', season: 'spring' }),
    candidates: [
      { id: 'friendly', baseWeight: 3, result: 'friendly' },
      { id: 'neutral', baseWeight: 2, result: 'neutral' },
      { id: 'rude', baseWeight: 1, result: 'rude' },
    ],
    ...overrides,
  };
}

describe('replay: decision records', () => {
  it('records a complete, replayable decision', () => {
    const engine = new ProbabilityEngine();
    engine.init(31415);
    const decision = engine.decide(makeRequest());
    const record = engine.replayDecision(decision.decisionId);

    expect(record).not.toBeNull();
    expect(record?.decisionId).toBe(decision.decisionId);
    expect(record?.streamId).toBe('social.dialogue');
    expect(record?.decisionType).toBe('dialogue_branch');
    expect(record?.selectedOptionId).toBe(decision.selectedOptionId);
    expect(record?.candidates).toHaveLength(3);
    expect(record?.timestamp).toBe(500);
    expect(record?.context.weather).toBe('clear');
    // History records deliberately exclude the caller's result payload.
    expect(record !== null && 'selectedResult' in record).toBe(false);
    expect(engine.getHistoryForDecision(decision.decisionId)).toBe(record);
    expect(engine.getHistoryForDecision('dec_999999')).toBeUndefined();
    expect(engine.replayDecision('dec_999999')).toBeNull();
  });

  it('snapshots the context so later mutation cannot rewrite history', () => {
    const engine = new ProbabilityEngine();
    engine.init(1);
    const context: ProbabilityContext = makeContext({ weather: 'rain', actorState: { mood: 0.5 } });
    const decision = engine.decide(makeRequest({ context }));
    context.weather = 'storm';
    if (context.actorState) context.actorState.mood = 99;
    expect(engine.replayDecision(decision.decisionId)?.context.weather).toBe('rain');
    const actorState = engine.replayDecision(decision.decisionId)?.context.actorState as
      { mood?: number } | undefined;
    expect(actorState?.mood).toBe(0.5);
  });

  it('keeps cached candidate diagnostics immutable from caller mutation', () => {
    const engine = new ProbabilityEngine();
    engine.init(2);
    const decision = engine.decide(makeRequest());
    const first = decision.candidates[0];
    if (first) first.probability = 999;
    expect(engine.replayDecision(decision.decisionId)?.candidates[0]?.probability).not.toBe(999);
  });

  it('returns newest-first history with a limit', () => {
    const engine = new ProbabilityEngine();
    engine.init(3);
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(engine.decide(makeRequest()).decisionId);
    expect(engine.getHistory()).toHaveLength(6);
    expect(engine.getHistory(2).map((record) => record.decisionId)).toEqual([ids[5], ids[4]]);
    expect(engine.getHistory(0)).toHaveLength(0);
    expect(engine.getHistory(-1)).toHaveLength(0);
    expect(engine.getHistory(999)).toHaveLength(6);
  });
});

describe('replay: ring buffer bounds', () => {
  it('evicts the oldest records once the history limit is reached', () => {
    const engine = new ProbabilityEngine({ historyLimit: 3 });
    engine.init(4);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(engine.decide(makeRequest()).decisionId);
    const remaining = engine.getHistory().map((record) => record.decisionId);
    expect(remaining).toEqual([ids[4], ids[3], ids[2]]);
    expect(engine.replayDecision(ids[0] ?? '')).toBeNull();
    expect(engine.replayDecision(ids[1] ?? '')).toBeNull();
    expect(engine.replayDecision(ids[4] ?? '')).not.toBeNull();
  });

  it('uses WORLD_CONFIG.probability.historyLimit by default', () => {
    const engine = new ProbabilityEngine();
    engine.init(5);
    const limit = WORLD_CONFIG.probability.historyLimit;
    expect(limit).toBe(5000);
    for (let i = 0; i < limit + 3; i += 1) engine.decide(makeRequest());
    expect(engine.getHistory()).toHaveLength(limit);
    expect(engine.getHistory(1)[0]?.decisionId).toBe(`dec_${String(limit + 3).padStart(6, '0')}`);
    expect(engine.replayDecision('dec_000001')).toBeNull();
  });
});

describe('replay: persistence', () => {
  it('persists history oldest-first and restores replayable records', () => {
    const engine = new ProbabilityEngine();
    engine.init(6);
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) ids.push(engine.decide(makeRequest()).decisionId);
    const saved = engine.exportState();
    expect(saved.history.map((record) => record.decisionId)).toEqual(ids);
    expect(saved.decisionCount).toBe(4);

    const restored = new ProbabilityEngine();
    restored.init(6, JSON.parse(JSON.stringify(saved)) as typeof saved);
    expect(restored.getHistory().map((record) => record.decisionId)).toEqual([...ids].reverse());
    for (const id of ids) expect(restored.replayDecision(id)).not.toBeNull();
    expect(restored.getHistoryForDecision(ids[0] ?? '')?.selectedOptionId).toBeDefined();
  });

  it('keeps decision ids unique across save/load', () => {
    const engine = new ProbabilityEngine();
    engine.init(7);
    for (let i = 0; i < 3; i += 1) engine.decide(makeRequest());
    const saved = engine.exportState();
    const restored = new ProbabilityEngine();
    restored.init(7, saved);
    const nextId = restored.decide(makeRequest()).decisionId;
    expect(nextId).toBe('dec_000004');
    expect(restored.getHistory().filter((record) => record.decisionId === nextId)).toHaveLength(1);
  });

  it('repairs a stale decisionCount from the history to avoid id collisions', () => {
    const engine = new ProbabilityEngine();
    engine.init(8);
    for (let i = 0; i < 3; i += 1) engine.decide(makeRequest());
    const saved = engine.exportState();
    saved.decisionCount = 0;
    const restored = new ProbabilityEngine();
    restored.init(8, saved);
    expect(restored.decide(makeRequest()).decisionId).toBe('dec_000004');
  });
});

describe('replay: fallback diagnostics', () => {
  it('records the fallback flag and causal ids in the detailed history', () => {
    const engine = new ProbabilityEngine();
    engine.init(9);
    engine.setNextCause({ parentDecisionId: 'dec_000000', sourceEventId: 'event_weather_shift' });
    const decision = engine.decide({
      streamId: 'events.occurrence',
      decisionType: 'forced',
      context: makeContext(),
      candidates: [{ id: 'only', baseWeight: 1, conditions: [{ op: 'never' }], result: 'only' }],
    });
    expect(decision.fallback).toBe('first-candidate');
    expect(decision.parentDecisionId).toBe('dec_000000');
    expect(decision.sourceEventId).toBe('event_weather_shift');
    const detailed = engine.getHistoryDetailed(1)[0];
    expect(detailed?.fallback).toBe('first-candidate');
    expect(detailed?.parentDecisionId).toBe('dec_000000');
    // cause metadata is consumed by exactly one decision
    expect(
      engine.decide({
        streamId: 'events.occurrence',
        decisionType: 'next',
        context: makeContext(),
        candidates: [{ id: 'x', baseWeight: 1, result: 'x' }],
      }).parentDecisionId
    ).toBeNull();
  });
});
