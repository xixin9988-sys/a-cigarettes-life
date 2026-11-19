import { describe, expect, it } from 'vitest';
import type { ConditionExpr, ProbabilityContext } from '../../src/core/contracts';
import {
  collectFailedConditions,
  describeCondition,
  evaluateCondition,
  evaluateConditions,
  jsonEquals,
  resolvePath,
} from '../../src/probability/ConditionEvaluator';
import { ProbabilityEngine } from '../../src/probability/ProbabilityEngine';
import { makeContext } from './helpers';

const context: ProbabilityContext = makeContext({
  simulationTime: 3600,
  locationId: 'willowbrook_bakery',
  weather: 'rain',
  season: 'autumn',
  actorId: 'npc_martha',
  targetId: 'player',
  environment: { temperature: 9, sheltered: false, moisture: 0.72 },
  actorState: {
    energy: 0.4,
    mood: 0.8,
    skill: { fishing: 7, cooking: 2 },
    traits: ['kind', 'shy'],
    inventory: { ash: 12 },
  },
  history: ['met_martha', 'helped_baker'],
});

function evaluate(expr: ConditionExpr): boolean {
  return evaluateCondition(expr, context);
}

describe('ConditionEvaluator: path resolution', () => {
  it('resolves dotted paths through objects, arrays and bracket syntax', () => {
    expect(resolvePath(context, 'actorState.skill.fishing')).toBe(7);
    expect(resolvePath(context, 'environment.temperature')).toBe(9);
    expect(resolvePath(context, 'actorState.traits.0')).toBe('kind');
    expect(resolvePath(context, 'actorState.traits[1]')).toBe('shy');
    expect(resolvePath(context, 'actorState.inventory["ash"]')).toBe(12);
    expect(resolvePath(context, 'history[0]')).toBe('met_martha');
    expect(resolvePath(context, 'actorState.traits.length')).toBe(2);
    expect(resolvePath(context, '$.weather')).toBe('rain');
    expect(resolvePath(context, 'context.season')).toBe('autumn');
  });

  it('returns undefined for missing or unsafe paths', () => {
    expect(resolvePath(context, 'actorState.missing.deep')).toBeUndefined();
    expect(resolvePath(context, 'actorState.__proto__')).toBeUndefined();
    expect(resolvePath(context, 'actorState.constructor')).toBeUndefined();
    expect(resolvePath(context, '')).toBeUndefined();
    expect(resolvePath(context, 'actorState.traits[99]')).toBeUndefined();
  });
});

describe('ConditionEvaluator: operators', () => {
  it('evaluates cmp operators', () => {
    expect(evaluate({ op: 'cmp', path: 'weather', cmp: 'eq', value: 'rain' })).toBe(true);
    expect(evaluate({ op: 'cmp', path: 'weather', cmp: 'ne', value: 'clear' })).toBe(true);
    expect(evaluate({ op: 'cmp', path: 'environment.temperature', cmp: 'gt', value: 8 })).toBe(true);
    expect(evaluate({ op: 'cmp', path: 'environment.temperature', cmp: 'gte', value: 9 })).toBe(true);
    expect(evaluate({ op: 'cmp', path: 'environment.temperature', cmp: 'lt', value: 9 })).toBe(false);
    expect(evaluate({ op: 'cmp', path: 'environment.temperature', cmp: 'lte', value: 9 })).toBe(true);
    expect(evaluate({ op: 'cmp', path: 'actorState.skill.fishing', cmp: 'gte', value: 7 })).toBe(true);
    expect(evaluate({ op: 'cmp', path: 'season', cmp: 'eq', value: 'winter' })).toBe(false);
  });

  it('treats missing paths as false for every operator', () => {
    const missing = 'actorState.doesNotExist';
    expect(evaluate({ op: 'cmp', path: missing, cmp: 'eq', value: null })).toBe(false);
    expect(evaluate({ op: 'cmp', path: missing, cmp: 'ne', value: null })).toBe(false);
    expect(evaluate({ op: 'cmp', path: missing, cmp: 'gt', value: 0 })).toBe(false);
    expect(evaluate({ op: 'flag', path: missing, equals: false })).toBe(false);
    expect(evaluate({ op: 'contains', path: missing, value: 'x' })).toBe(false);
  });

  it('is NaN-safe for ordering comparisons', () => {
    const nanContext = makeContext({ actorState: { value: Number.NaN, label: 'NaN' } });
    expect(evaluateCondition({ op: 'cmp', path: 'actorState.value', cmp: 'gt', value: 0 }, nanContext)).toBe(
      false
    );
    expect(evaluateCondition({ op: 'cmp', path: 'actorState.value', cmp: 'gte', value: 0 }, nanContext)).toBe(
      false
    );
    expect(evaluateCondition({ op: 'cmp', path: 'actorState.value', cmp: 'lt', value: 0 }, nanContext)).toBe(
      false
    );
    expect(evaluateCondition({ op: 'cmp', path: 'actorState.value', cmp: 'ne', value: 1 }, nanContext)).toBe(
      true
    );
  });

  it('evaluates flags only for booleans', () => {
    const flagContext = makeContext({ environment: { flags: { met_baker: true, locked: false } } });
    expect(
      evaluateCondition({ op: 'flag', path: 'environment.flags.met_baker', equals: true }, flagContext)
    ).toBe(true);
    expect(
      evaluateCondition({ op: 'flag', path: 'environment.flags.locked', equals: false }, flagContext)
    ).toBe(true);
    expect(
      evaluateCondition({ op: 'flag', path: 'environment.flags.locked', equals: true }, flagContext)
    ).toBe(false);
    expect(
      evaluateCondition({ op: 'flag', path: 'environment.flags.missing', equals: false }, flagContext)
    ).toBe(false);
    // flags must be real booleans, not truthy numbers
    expect(
      evaluateCondition(
        { op: 'flag', path: 'environment.flags.met_baker', equals: 1 as unknown as boolean },
        flagContext
      )
    ).toBe(false);
  });

  it('evaluates contains on arrays, strings and records', () => {
    expect(evaluate({ op: 'contains', path: 'actorState.traits', value: 'kind' })).toBe(true);
    expect(evaluate({ op: 'contains', path: 'actorState.traits', value: 'brave' })).toBe(false);
    expect(evaluate({ op: 'contains', path: 'history', value: 'helped_baker' })).toBe(true);
    expect(evaluate({ op: 'contains', path: 'weather', value: 'rai' })).toBe(true);
    expect(evaluate({ op: 'contains', path: 'actorState.inventory', value: 'ash' })).toBe(true);
    expect(evaluate({ op: 'contains', path: 'environment.temperature', value: '9' })).toBe(false);
  });

  it('evaluates boolean composition with vacuous truth rules', () => {
    expect(evaluate({ op: 'always' })).toBe(true);
    expect(evaluate({ op: 'never' })).toBe(false);
    expect(evaluate({ op: 'not', arg: { op: 'never' } })).toBe(true);
    expect(evaluate({ op: 'and', args: [] })).toBe(true);
    expect(evaluate({ op: 'or', args: [] })).toBe(false);
    expect(
      evaluate({
        op: 'and',
        args: [
          { op: 'cmp', path: 'weather', cmp: 'eq', value: 'rain' },
          { op: 'or', args: [{ op: 'never' }, { op: 'cmp', path: 'season', cmp: 'eq', value: 'autumn' }] },
          { op: 'not', arg: { op: 'cmp', path: 'environment.temperature', cmp: 'lt', value: 0 } },
        ],
      })
    ).toBe(true);
    expect(evaluateConditions([{ op: 'never' }], context)).toBe(false);
    expect(evaluateConditions([], context)).toBe(true);
    expect(evaluateConditions(undefined, context)).toBe(true);
  });

  it('never throws on malformed runtime expressions', () => {
    const malformed = [
      null,
      undefined,
      {},
      { op: 'and' },
      { op: 'and', args: 'nope' },
      { op: 'not' },
      { op: 'cmp', path: 'weather', cmp: 'unknown', value: 1 },
      { op: 'flag', path: 5, equals: true },
    ] as unknown as ConditionExpr[];
    for (const expr of malformed) {
      expect(() => evaluateCondition(expr, context)).not.toThrow();
    }
    expect(
      evaluateCondition({ op: 'cmp', path: 'weather', cmp: 'unknown' as 'eq', value: 'rain' }, context)
    ).toBe(false);
  });

  it('describes conditions and collects failures for logging', () => {
    expect(describeCondition({ op: 'cmp', path: 'actorState.skill.fishing', cmp: 'gte', value: 7 })).toBe(
      'actorState.skill.fishing gte 7'
    );
    const failed = collectFailedConditions(
      [
        { op: 'cmp', path: 'weather', cmp: 'eq', value: 'rain' },
        { op: 'cmp', path: 'season', cmp: 'eq', value: 'winter' },
        { op: 'flag', path: 'environment.flags.missing', equals: true },
      ],
      context
    );
    expect(failed).toHaveLength(2);
    expect(failed[0]).toContain('season eq');
  });

  it('deep JSON equality handles nested values', () => {
    expect(jsonEquals({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(jsonEquals({ a: [1] }, { a: [2] })).toBe(false);
    expect(jsonEquals([1, 2], [1, 2, 3])).toBe(false);
    expect(jsonEquals(Number.NaN, Number.NaN)).toBe(true);
  });
});

describe('ConditionEvaluator: engine integration', () => {
  it('exposes evaluateConditions through the engine', () => {
    const engine = new ProbabilityEngine();
    engine.init(1);
    expect(
      engine.evaluateConditions(
        [
          { op: 'cmp', path: 'weather', cmp: 'eq', value: 'rain' },
          { op: 'contains', path: 'history', value: 'helped_baker' },
        ],
        context
      )
    ).toBe(true);
  });
});
