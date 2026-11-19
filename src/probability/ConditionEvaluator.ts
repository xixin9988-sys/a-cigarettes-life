// =============================================================================
// ConditionEvaluator: evaluates the `ConditionExpr` AST from the frozen contract
// against a `ProbabilityContext` (or any plain record).
//
// Rules (spec):
//   - Condition lists are ANDed by the caller / `evaluateConditions`.
//   - Dotted paths resolve through objects and numeric array indices.
//   - A missing path always evaluates to false for every operator (never throws).
//   - NaN / non-finite numbers never compare true.
//   - Malformed expressions are treated as false instead of throwing.
// =============================================================================
import type { ConditionExpr, ProbabilityContext } from '../core/contracts';

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/** True for JSON-style objects (arrays excluded). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalises path syntax:
 *   - leading '$.' / 'context.' are stripped,
 *   - 'a[0]' becomes 'a.0',
 *   - 'a["key"]' becomes 'a.key'.
 */
function normalizePath(path: string): string {
  let value = path.trim();
  if (value === '$') return '';
  if (value.startsWith('$.')) value = value.slice(2);
  else if (value === 'context') return '';
  else if (value.startsWith('context.')) value = value.slice('context.'.length);
  value = value.replace(/\[(\d+)\]/g, '.$1');
  value = value.replace(/\[['"]([^'"]+)['"]\]/g, '.$1');
  return value;
}

/** Reads a single own property (or an array's numeric index / length). */
function readProperty(current: unknown, key: string): unknown {
  if (current === null || current === undefined) return undefined;
  if (Array.isArray(current)) {
    if (key === 'length') return current.length;
    if (!/^\d+$/.test(key)) return undefined;
    const index = Number.parseInt(key, 10);
    return index < current.length ? current[index] : undefined;
  }
  if (typeof current === 'object') {
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
    return record[key];
  }
  return undefined;
}

/**
 * Resolves a stable dotted path against a root value.
 * Returns `undefined` for missing paths and for prototype-pollution segments.
 */
export function resolvePath(root: unknown, path: string): unknown {
  if (typeof path !== 'string' || path.length === 0) return undefined;
  const normalised = normalizePath(path);
  if (normalised.length === 0) return root;
  let current: unknown = root;
  for (const segment of normalised.split('.')) {
    if (segment.length === 0) return undefined;
    if (FORBIDDEN_PATH_SEGMENTS.has(segment)) return undefined;
    current = readProperty(current, segment);
    if (current === undefined) return undefined;
  }
  return current;
}

/** Resolves a path and returns it only when it is a finite number. */
export function resolveNumber(root: unknown, path: string): number | null {
  const value = resolvePath(root, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Resolves a path from a ProbabilityContext. */
export function resolveContextPath(context: ProbabilityContext, path: string): unknown {
  return resolvePath(context, path);
}

/** Deep JSON-style equality; NaN equals NaN (runtime state may hold NaN). */
export function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!jsonEquals(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!jsonEquals(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

/** Ordering comparison for numbers (finite only) and strings. NaN => null (false). */
function compareOrder(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  return null;
}

function formatJsonValue(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? String(value) : encoded;
  } catch {
    return String(value);
  }
}

/**
 * Evaluates one condition expression. Never throws: unknown operators and
 * malformed shapes evaluate to false (conditions are a safety filter, a broken
 * content rule must not crash the simulation).
 */
export function evaluateCondition(expr: ConditionExpr, context: ProbabilityContext): boolean {
  if (!expr || typeof expr !== 'object') return false;
  switch (expr.op) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'and': {
      if (!Array.isArray(expr.args)) return false;
      for (const arg of expr.args) {
        if (!evaluateCondition(arg, context)) return false;
      }
      return true;
    }
    case 'or': {
      if (!Array.isArray(expr.args)) return false;
      for (const arg of expr.args) {
        if (evaluateCondition(arg, context)) return true;
      }
      return false;
    }
    case 'not':
      return expr.arg ? !evaluateCondition(expr.arg, context) : false;
    case 'cmp': {
      const actual = resolvePath(context, expr.path);
      if (actual === undefined) return false;
      switch (expr.cmp) {
        case 'eq':
          return jsonEquals(actual, expr.value);
        case 'ne':
          return !jsonEquals(actual, expr.value);
        case 'gt': {
          const order = compareOrder(actual, expr.value);
          return order !== null && order > 0;
        }
        case 'gte': {
          const order = compareOrder(actual, expr.value);
          return order !== null && order >= 0;
        }
        case 'lt': {
          const order = compareOrder(actual, expr.value);
          return order !== null && order < 0;
        }
        case 'lte': {
          const order = compareOrder(actual, expr.value);
          return order !== null && order <= 0;
        }
        default:
          return false;
      }
    }
    case 'flag': {
      const actual = resolvePath(context, expr.path);
      if (actual === undefined || typeof actual !== 'boolean') return false;
      return actual === expr.equals;
    }
    case 'contains': {
      const actual = resolvePath(context, expr.path);
      if (actual === undefined) return false;
      if (Array.isArray(actual)) return actual.some((item) => jsonEquals(item, expr.value));
      if (typeof actual === 'string') {
        return typeof expr.value === 'string' && actual.includes(expr.value);
      }
      if (isPlainObject(actual)) {
        return typeof expr.value === 'string' && Object.prototype.hasOwnProperty.call(actual, expr.value);
      }
      return false;
    }
    default:
      return false;
  }
}

/** ANDs a condition list. Empty / missing list => true (no restriction). */
export function evaluateConditions(
  conditions: readonly ConditionExpr[] | undefined | null,
  context: ProbabilityContext
): boolean {
  if (!conditions || conditions.length === 0) return true;
  for (const condition of conditions) {
    if (!evaluateCondition(condition, context)) return false;
  }
  return true;
}

/** Human-readable description of a condition, used by the debugger and logs. */
export function describeCondition(expr: ConditionExpr): string {
  if (!expr || typeof expr !== 'object') return '<invalid>';
  switch (expr.op) {
    case 'always':
      return 'true';
    case 'never':
      return 'false';
    case 'and': {
      if (!Array.isArray(expr.args)) return '<invalid and>';
      return `(${expr.args.map((arg) => describeCondition(arg)).join(' && ')})`;
    }
    case 'or': {
      if (!Array.isArray(expr.args)) return '<invalid or>';
      return `(${expr.args.map((arg) => describeCondition(arg)).join(' || ')})`;
    }
    case 'not':
      return expr.arg ? `!(${describeCondition(expr.arg)})` : '<invalid not>';
    case 'cmp':
      return `${expr.path} ${expr.cmp} ${formatJsonValue(expr.value)}`;
    case 'flag':
      return `${expr.path} === ${String(expr.equals)}`;
    case 'contains':
      return `${expr.path} contains ${formatJsonValue(expr.value)}`;
    default:
      return '<invalid>';
  }
}

/** Returns descriptions of every condition that failed (empty when all pass). */
export function collectFailedConditions(
  conditions: readonly ConditionExpr[] | undefined | null,
  context: ProbabilityContext
): string[] {
  if (!conditions || conditions.length === 0) return [];
  const failed: string[] = [];
  for (const condition of conditions) {
    if (!evaluateCondition(condition, context)) failed.push(describeCondition(condition));
  }
  return failed;
}
