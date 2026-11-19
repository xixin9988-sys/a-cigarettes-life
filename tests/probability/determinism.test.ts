import { describe, expect, it } from 'vitest';
import type { ProbabilityOption, ProbabilityRequest } from '../../src/core/contracts';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import { drawSequence, makeContext } from './helpers';

function makeRequest(streamId = 'npc.behavior', decisionType = 'npc_behaviour'): ProbabilityRequest<string> {
  const candidates: ProbabilityOption<string>[] = [
    { id: 'work', baseWeight: 40, result: 'work' },
    { id: 'eat', baseWeight: 25, result: 'eat' },
    {
      id: 'socialise',
      baseWeight: 15,
      conditions: [{ op: 'cmp', path: 'actorState.social', cmp: 'gte', value: 0.5 }],
      modifiers: [
        { id: 'mood', source: 'mood', kind: 'multiply', value: 1, path: 'actorState.mood', perUnit: false },
      ],
      result: 'socialise',
    },
    { id: 'rest', baseWeight: 20, result: 'rest' },
  ];
  return {
    streamId,
    decisionType,
    context: makeContext({
      simulationTime: 1234,
      actorId: 'npc_1',
      actorState: { social: 0.8, mood: 1.25 },
    }),
    candidates,
  };
}

describe('determinism: primitive draws', () => {
  it('reproduces identical sequences for the same seed and stream', () => {
    const a = new ProbabilityEngine();
    const b = new ProbabilityEngine();
    a.init(92837465);
    b.init(92837465);

    expect(drawSequence(a, 'world.weather', 500)).toEqual(drawSequence(b, 'world.weather', 500));
    expect(a.roll('npc.behavior')).toBe(b.roll('npc.behavior'));
    expect(a.intRange('economy.market', 1, 100)).toBe(b.intRange('economy.market', 1, 100));
    expect(a.floatRange('events.occurrence', -5, 5)).toBe(b.floatRange('events.occurrence', -5, 5));
    expect(a.chance('fishing.results', 0.37)).toBe(b.chance('fishing.results', 0.37));
  });

  it('diverges for different seeds', () => {
    const a = new ProbabilityEngine();
    const b = new ProbabilityEngine();
    a.init(1);
    b.init(2);
    const sequenceA = drawSequence(a, 'world.weather', 64);
    const sequenceB = drawSequence(b, 'world.weather', 64);
    expect(sequenceA).not.toEqual(sequenceB);
  });

  it('keeps working when init is called again (fresh deterministic life)', () => {
    const engine = new ProbabilityEngine();
    engine.init(555);
    const first = drawSequence(engine, 'npc.social', 20);
    engine.roll('npc.behavior');
    engine.init(555);
    expect(drawSequence(engine, 'npc.social', 20)).toEqual(first);
  });
});

describe('determinism: decisions', () => {
  it('produces identical decisions for identical request sequences', () => {
    const a = new ProbabilityEngine();
    const b = new ProbabilityEngine();
    a.init(777);
    b.init(777);

    for (let i = 0; i < 50; i += 1) {
      const request = makeRequest();
      const decisionA = a.decide(request);
      const decisionB = b.decide(request);
      expect(decisionA.decisionId).toBe(decisionB.decisionId);
      expect(decisionA.selectedOptionId).toBe(decisionB.selectedOptionId);
      expect(decisionA.totalWeight).toBeCloseTo(decisionB.totalWeight, 12);
      expect(decisionA.candidates).toEqual(decisionB.candidates);
      expect(decisionA.fallback).toBe(decisionB.fallback);
      // Same simulation timestamp, never wall-clock time.
      expect(decisionA.timestamp).toBe(1234);
    }
  });

  it('records a replayable history whose order matches the draw order', () => {
    const engine = new ProbabilityEngine();
    engine.init(777);
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) ids.push(engine.decide(makeRequest()).decisionId);
    const history = engine.getHistory(10);
    expect(history.length).toBe(10);
    // newest first
    expect(history[0]?.decisionId).toBe(ids[ids.length - 1]);
    expect(history.map((record) => record.decisionId).reverse()).toEqual(ids);
  });
});

describe('determinism: save / restore', () => {
  it('export -> import resumes the exact random sequence', () => {
    const original = new ProbabilityEngine();
    original.init(424242);
    // Mixed workload before the save point.
    drawSequence(original, 'world.weather', 137);
    original.decide(makeRequest());
    original.floatRange('farming.growth', 0, 1);
    original.ensureStream('new.stream.created.after.save');

    const saved = original.exportState();
    const restored = new ProbabilityEngine();
    restored.init(424242, saved);

    for (let i = 0; i < 200; i += 1) {
      expect(restored.roll('world.weather')).toBe(original.roll('world.weather'));
    }
    expect(restored.roll('farming.growth')).toBe(original.roll('farming.growth'));
    expect(restored.roll('new.stream.created.after.save')).toBe(
      original.roll('new.stream.created.after.save')
    );
  });

  it('survives a JSON round-trip of the persisted state', () => {
    const original = new ProbabilityEngine();
    original.init(31337);
    drawSequence(original, 'events.occurrence', 99);
    original.decide(makeRequest('events.occurrence', 'event_roll'));

    const json = JSON.parse(JSON.stringify(original.exportState())) as ReturnType<
      ProbabilityEngine['exportState']
    >;
    const restored = new ProbabilityEngine();
    restored.init(31337, json);

    expect(restored.exportState().streams).toEqual(original.exportState().streams);
    expect(restored.getHistory().length).toBe(original.getHistory().length);
    for (let i = 0; i < 50; i += 1) {
      expect(restored.roll('events.occurrence')).toBe(original.roll('events.occurrence'));
    }
  });

  it('continues decision ids without collisions after a restore', () => {
    const original = new ProbabilityEngine();
    original.init(123);
    const before: string[] = [];
    for (let i = 0; i < 5; i += 1) before.push(original.decide(makeRequest()).decisionId);
    const saved = original.exportState();

    const restored = new ProbabilityEngine();
    restored.init(123, saved);
    const after: string[] = [];
    for (let i = 0; i < 5; i += 1) after.push(restored.decide(makeRequest()).decisionId);
    expect(new Set([...before, ...after]).size).toBe(10);
    expect(after[0]).not.toBe(before[before.length - 1]);
    expect(restored.getHistory().length).toBe(10);
  });

  it('restoring state does not depend on the order streams were created in', () => {
    const a = new ProbabilityEngine();
    a.init(8008);
    a.ensureStream('stream.c');
    a.ensureStream('stream.a');
    a.roll('stream.c');
    a.roll('stream.a');
    const saved = a.exportState();

    const b = new ProbabilityEngine();
    b.init(8008, saved);
    b.ensureStream('stream.a');
    b.ensureStream('stream.b');
    b.ensureStream('stream.c');
    // Same state for the persisted streams regardless of ensure order.
    expect(b.exportState().streams['stream.c']).toEqual(a.exportState().streams['stream.c']);
    expect(b.roll('stream.c')).toBe(a.roll('stream.c'));
    expect(b.roll('stream.a')).toBe(a.roll('stream.a'));
  });
});
