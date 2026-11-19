import { describe, expect, it } from 'vitest';
import type { ProbabilityDecisionRecord } from '../../src/core/contracts';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import { ProbabilityHistory, toDecisionRecordEx } from '../../src/probability/ProbabilityHistory';
import { CausalTrace } from '../../src/probability/CausalTrace';
import { makeContext } from './helpers';

function record(id: string): ProbabilityDecisionRecord {
  return {
    decisionId: id,
    streamId: 'test.stream',
    decisionType: 'test',
    context: makeContext(),
    candidates: [],
    selectedOptionId: null,
    timestamp: 0,
  };
}

describe('ProbabilityHistory', () => {
  it('evicts oldest entries and reports newest / chronological order', () => {
    const history = new ProbabilityHistory(3);
    expect(history.limit).toBe(3);
    for (const id of ['dec_1', 'dec_2', 'dec_3', 'dec_4', 'dec_5']) {
      const extended = toDecisionRecordEx(record(id));
      expect(extended).not.toBeNull();
      if (extended) history.push(extended);
    }
    expect(history.size).toBe(3);
    expect(history.latest().map((entry) => entry.decisionId)).toEqual(['dec_5', 'dec_4', 'dec_3']);
    expect(history.latest(2).map((entry) => entry.decisionId)).toEqual(['dec_5', 'dec_4']);
    expect(history.chronological().map((entry) => entry.decisionId)).toEqual(['dec_3', 'dec_4', 'dec_5']);
    expect(history.get('dec_4')?.decisionId).toBe('dec_4');
    expect(history.get('dec_1')).toBeUndefined();
    expect(history.has('dec_5')).toBe(true);
    history.clear();
    expect(history.size).toBe(0);
    expect(history.latest()).toEqual([]);
  });

  it('loads persisted records defensively, capped at its limit', () => {
    const history = new ProbabilityHistory(2);
    const loaded = history.load([
      record('dec_1'),
      { ...record('dec_2'), candidates: undefined as unknown as [] },
      null as unknown as ProbabilityDecisionRecord,
      record('dec_3'),
      record('dec_4'),
    ]);
    expect(loaded).toBe(4);
    expect(history.chronological().map((entry) => entry.decisionId)).toEqual(['dec_3', 'dec_4']);
  });

  it('treats malformed records as invalid', () => {
    expect(toDecisionRecordEx(null as unknown as ProbabilityDecisionRecord)).toBeNull();
    expect(toDecisionRecordEx({} as ProbabilityDecisionRecord)).toBeNull();
    const extended = toDecisionRecordEx(record('dec_x'));
    expect(extended?.fallback).toBe('none');
    expect(extended?.parentDecisionId).toBeNull();
    expect(extended?.sourceEventId).toBeNull();
  });
});

describe('CausalTrace', () => {
  it('records nodes, links parents, resolves chains and children', () => {
    const trace = new CausalTrace(10);
    trace.record({
      decisionId: 'a',
      decisionType: 'root',
      streamId: 's',
      selectedOptionId: 'x',
      timestamp: 1,
      sourceEventId: 'event_1',
    });
    trace.record({
      decisionId: 'b',
      decisionType: 'child',
      streamId: 's',
      selectedOptionId: 'y',
      timestamp: 2,
      parentDecisionId: 'a',
    });
    trace.record({
      decisionId: 'c',
      decisionType: 'grandchild',
      streamId: 's',
      selectedOptionId: 'z',
      timestamp: 3,
      parentDecisionId: 'b',
    });

    expect(trace.counter).toBe(3);
    expect(trace.size).toBe(3);
    expect(trace.get('a')?.nodeId).toBe('trace_1');
    expect(trace.get('a')?.sourceEventId).toBe('event_1');
    expect(trace.chain('c').map((node) => node.decisionId)).toEqual(['a', 'b', 'c']);
    expect(trace.children('b').map((node) => node.decisionId)).toEqual(['c']);
    expect(trace.roots().map((node) => node.decisionId)).toEqual(['a']);
    expect(trace.toArray().map((node) => node.decisionId)).toEqual(['a', 'b', 'c']);
  });

  it('bounds memory and cuts cycles defensively', () => {
    const trace = new CausalTrace(3);
    for (let i = 0; i < 5; i += 1) {
      trace.record({
        decisionId: `d${i}`,
        decisionType: 't',
        streamId: 's',
        selectedOptionId: null,
        timestamp: i,
      });
    }
    expect(trace.size).toBe(3);
    expect(trace.get('d0')).toBeUndefined();
    expect(trace.get('d4')?.nodeId).toBe('trace_5');

    trace.record({
      decisionId: 'cycleA',
      decisionType: 't',
      streamId: 's',
      selectedOptionId: null,
      timestamp: 0,
      parentDecisionId: 'cycleB',
    });
    trace.record({
      decisionId: 'cycleB',
      decisionType: 't',
      streamId: 's',
      selectedOptionId: null,
      timestamp: 0,
      parentDecisionId: 'cycleA',
    });
    const chain = trace.chain('cycleA');
    expect(chain.length).toBeLessThanOrEqual(64);
    expect(trace.chain('unknown')).toEqual([]);
  });

  it('restores counters without reusing node ids', () => {
    const trace = new CausalTrace();
    trace.setCounter(41);
    const node = trace.record({
      decisionId: 'x',
      decisionType: 't',
      streamId: 's',
      selectedOptionId: null,
      timestamp: 0,
    });
    expect(node.nodeId).toBe('trace_42');
    trace.clear();
    expect(trace.counter).toBe(42);
    expect(
      trace.record({
        decisionId: 'y',
        decisionType: 't',
        streamId: 's',
        selectedOptionId: null,
        timestamp: 0,
      }).nodeId
    ).toBe('trace_43');
    trace.reset();
    expect(trace.counter).toBe(0);
    trace.setCounter(Number.NaN);
    expect(trace.counter).toBe(0);
  });
});

describe('engine causal integration', () => {
  it('links decisions and persists the trace counter across saves', () => {
    const engine = new ProbabilityEngine();
    engine.init(11);
    const root = engine.decide({
      streamId: 'events.occurrence',
      decisionType: 'root',
      context: makeContext(),
      candidates: [{ id: 'a', baseWeight: 1, result: 'a' }],
    });
    engine.setNextCause({ parentDecisionId: root.decisionId, sourceEventId: 'event_storm' });
    const child = engine.decide({
      streamId: 'events.occurrence',
      decisionType: 'child',
      context: makeContext(),
      candidates: [{ id: 'b', baseWeight: 1, result: 'b' }],
    });
    expect(child.parentDecisionId).toBe(root.decisionId);
    expect(engine.causalTrace.chain(child.decisionId).map((node) => node.decisionId)).toEqual([
      root.decisionId,
      child.decisionId,
    ]);
    expect(engine.causalTrace.get(child.decisionId)?.sourceEventId).toBe('event_storm');
    expect(engine.exportState().traceCounter).toBe(2);

    const restored = new ProbabilityEngine();
    restored.init(11, engine.exportState());
    expect(restored.causalTrace.counter).toBe(2);
    restored.decide({
      streamId: 'events.occurrence',
      decisionType: 'after',
      context: makeContext(),
      candidates: [{ id: 'c', baseWeight: 1, result: 'c' }],
    });
    expect(restored.causalTrace.counter).toBe(3);
  });

  it('clears the pending cause when set to null and after use', () => {
    const engine = new ProbabilityEngine();
    engine.init(12);
    engine.setNextCause(null);
    expect(
      engine.decide({
        streamId: 'x',
        decisionType: 'd',
        context: makeContext(),
        candidates: [{ id: 'a', baseWeight: 1, result: 'a' }],
      }).parentDecisionId
    ).toBeNull();
    engine.setNextCause({ parentDecisionId: 'p', sourceEventId: null });
    expect(
      engine.decide({
        streamId: 'x',
        decisionType: 'd',
        context: makeContext(),
        candidates: [{ id: 'a', baseWeight: 1, result: 'a' }],
      }).parentDecisionId
    ).toBe('p');
    expect(
      engine.decide({
        streamId: 'x',
        decisionType: 'd',
        context: makeContext(),
        candidates: [{ id: 'a', baseWeight: 1, result: 'a' }],
      }).parentDecisionId
    ).toBeNull();
  });

  it('exports decisionCount and traceCounter consistently', () => {
    const engine = new ProbabilityEngine();
    engine.init(13);
    for (let i = 0; i < 7; i += 1) {
      engine.decide({
        streamId: 'x',
        decisionType: 'd',
        context: makeContext(),
        candidates: [{ id: 'a', baseWeight: 1, result: 'a' }],
      });
    }
    const state = engine.exportState();
    expect(state.version).toBe(1);
    expect(state.seed).toBe(13);
    expect(state.decisionCount).toBe(7);
    expect(state.traceCounter).toBe(7);
    expect(state.history).toHaveLength(7);
    expect(Object.keys(state.streams)).toEqual(['x']);
    expect(state.streams['x']).toHaveLength(4);
  });
});
