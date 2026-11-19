import { describe, expect, it } from 'vitest';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import {
  deriveStreamSeed64,
  deriveStreamState,
  deriveStreamStates,
  normalizeLifeSeed,
  streamStateSignature,
  streamStatesEqual,
  validateStreamState,
} from '../../src/probability/SeedManager';
import { drawSequence, makeContext } from './helpers';

describe('SeedManager derivation', () => {
  it('derives identical states for identical (seed, streamId) pairs', () => {
    const a = deriveStreamState(12345, 'world.weather');
    const b = deriveStreamState(12345, 'world.weather');
    expect(streamStatesEqual(a, b)).toBe(true);
    expect(streamStateSignature(a)).toBe(streamStateSignature(b));
    expect(streamStateSignature(a)).toHaveLength(32);
  });

  it('derives independent states for different stream ids', () => {
    const weather = deriveStreamState(12345, 'world.weather');
    const behavior = deriveStreamState(12345, 'npc.behavior');
    expect(streamStatesEqual(weather, behavior)).toBe(false);
    const states = deriveStreamStates(12345, ['a', 'b', 'c', 'd', 'e']);
    const signatures = new Set(Object.values(states).map((state) => streamStateSignature(state)));
    expect(signatures.size).toBe(5);
  });

  it('derives independent states for different life seeds', () => {
    expect(streamStatesEqual(deriveStreamState(1, 'npc.social'), deriveStreamState(2, 'npc.social'))).toBe(
      false
    );
    expect(deriveStreamSeed64(1, 'npc.social')).not.toBe(deriveStreamSeed64(2, 'npc.social'));
  });

  it('supports explicit re-derivation attempts', () => {
    expect(deriveStreamState(9, 'x')).not.toEqual(deriveStreamState(9, 'x', 1));
    expect(deriveStreamState(9, 'x', 2)).toEqual(deriveStreamState(9, 'x', 2));
  });

  it('normalises invalid life seeds and validates persisted states', () => {
    expect(normalizeLifeSeed(Number.NaN)).toBe(0);
    expect(normalizeLifeSeed(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeLifeSeed(7.5)).toBe(7.5);
    expect(validateStreamState([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(validateStreamState([1, 2, 3])).toBeNull();
  });
});

describe('stream independence inside the engine', () => {
  it('draws in one stream do not perturb another stream', () => {
    const control = new ProbabilityEngine();
    control.init(2024);
    const expected = drawSequence(control, 'npc.social', 100);

    const disturbed = new ProbabilityEngine();
    disturbed.init(2024);
    // A system that draws a lot from unrelated streams must not move npc.social.
    drawSequence(disturbed, 'world.weather', 900);
    disturbed.roll('economy.market');
    disturbed.intRange('fishing.results', 0, 10);
    expect(drawSequence(disturbed, 'npc.social', 100)).toEqual(expected);
  });

  it('creating a new stream does not disturb existing streams', () => {
    const control = new ProbabilityEngine();
    control.init(555);
    const first = control.roll('world.weather');
    const second = control.roll('world.weather');
    const stateAfter = control.exportState().streams['world.weather'];

    const engine = new ProbabilityEngine();
    engine.init(555);
    expect(engine.roll('world.weather')).toBe(first);
    engine.ensureStream('brand.new.stream');
    engine.roll('brand.new.stream');
    expect(engine.roll('world.weather')).toBe(second);
    expect(engine.exportState().streams['world.weather']).toEqual(stateAfter);
  });

  it('decisions on one stream do not perturb another stream', () => {
    const control = new ProbabilityEngine();
    control.init(606);
    const expected = drawSequence(control, 'crafting.quality', 60);

    const engine = new ProbabilityEngine();
    engine.init(606);
    for (let i = 0; i < 20; i += 1) {
      engine.decide({
        streamId: 'npc.behavior',
        decisionType: 'npc_behaviour',
        context: makeContext(),
        candidates: [
          { id: 'a', baseWeight: 1, result: 'a' },
          { id: 'b', baseWeight: 2, result: 'b' },
        ],
      });
    }
    expect(drawSequence(engine, 'crafting.quality', 60)).toEqual(expected);
  });

  it('different streams produce different sequences and the same stream ids stay aligned', () => {
    const engine = new ProbabilityEngine();
    engine.init(999);
    const weather = drawSequence(engine, 'world.weather', 32);
    const behavior = engine.roll('npc.behavior');
    expect(weather[0]).not.toBe(behavior);

    const second = new ProbabilityEngine();
    second.init(999);
    expect(second.roll('npc.behavior')).toBe(behavior);
  });

  it('tracks per-stream draw and decision statistics', () => {
    const engine = new ProbabilityEngine();
    engine.init(5);
    engine.roll('world.weather');
    engine.roll('world.weather');
    engine.roll('npc.behavior');
    engine.decide({
      streamId: 'world.weather',
      decisionType: 'weather',
      context: makeContext(),
      candidates: [
        { id: 'sun', baseWeight: 1, result: 'sun' },
        { id: 'rain', baseWeight: 1, result: 'rain' },
      ],
    });
    expect(engine.getStats('world.weather').draws).toBe(3);
    expect(engine.getStats('world.weather').decisions).toBe(1);
    expect(engine.getStats('npc.behavior').draws).toBe(1);
    expect(engine.getStats('npc.behavior').decisions).toBe(0);
    expect(engine.getStats('unknown.stream')).toEqual({
      streamId: 'unknown.stream',
      draws: 0,
      decisions: 0,
      lastValue: 0,
    });
  });
});
