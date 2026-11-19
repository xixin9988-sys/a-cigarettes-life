// =============================================================================
// ModifierResolver: turns contract `ProbabilityModifier` declarations into
// concrete, traceable `AppliedModifier` entries.
//
// A modifier is only applied when its optional condition passes. Its amount is:
//   - `value` when no path is supplied,
//   - the resolved finite number when `path` is supplied (perUnit === false),
//   - `value * resolved` when both `path` and `perUnit === true` are supplied,
//   - `value` as a safe fallback when the path is missing / non-numeric.
// Invalid amounts are replaced by the neutral element of the operation (0 for
// add, 1 for multiply) so one broken content rule can never poison a weight.
// =============================================================================
import type { AppliedModifier, ProbabilityContext, ProbabilityModifier } from '../core/contracts';
import { evaluateCondition, resolvePath } from './ConditionEvaluator';

export interface ModifierResolution {
  applied: AppliedModifier[];
  /** Human-readable warnings for invalid modifier declarations. */
  warnings: string[];
}

function neutralElement(kind: 'add' | 'multiply'): number {
  return kind === 'add' ? 0 : 1;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1e6) / 1e6);
}

function formatAmount(kind: 'add' | 'multiply', amount: number): string {
  return kind === 'add' ? `+${formatNumber(amount)}` : `x${formatNumber(amount)}`;
}

/**
 * Resolves a modifier list into applied entries and warnings.
 * Skipped entries (failed condition) are not returned, so callers can simply
 * fold `applied` over the base weight.
 */
export function resolveModifiersDetailed(
  modifiers: readonly ProbabilityModifier[] | undefined | null,
  context: ProbabilityContext
): ModifierResolution {
  const applied: AppliedModifier[] = [];
  const warnings: string[] = [];
  if (!modifiers || modifiers.length === 0) return { applied, warnings };

  for (const modifier of modifiers) {
    if (!modifier || typeof modifier !== 'object') {
      warnings.push('ignored non-object probability modifier');
      continue;
    }
    if (modifier.kind !== 'add' && modifier.kind !== 'multiply') {
      warnings.push(`ignored modifier '${String(modifier.id)}' with unknown kind '${String(modifier.kind)}'`);
      continue;
    }
    if (modifier.condition && !evaluateCondition(modifier.condition, context)) {
      continue;
    }

    const kind = modifier.kind;
    const fallback =
      typeof modifier.value === 'number' && Number.isFinite(modifier.value)
        ? modifier.value
        : neutralElement(kind);
    if (fallback !== modifier.value) {
      warnings.push(
        `modifier '${modifier.id}' has a non-finite value; using ${formatAmount(kind, fallback)}`
      );
    }

    let amount = fallback;
    let detail: string;

    if (typeof modifier.path === 'string' && modifier.path.length > 0) {
      const resolved = resolvePath(context, modifier.path);
      if (typeof resolved === 'number' && Number.isFinite(resolved)) {
        amount = modifier.perUnit === true ? fallback * resolved : resolved;
        detail =
          modifier.perUnit === true
            ? `${modifier.path}=${formatNumber(resolved)} ${formatAmount(kind, amount)}`
            : `${modifier.path}=${formatNumber(resolved)} -> ${formatAmount(kind, amount)}`;
      } else {
        amount = fallback;
        detail = `${modifier.path}=<missing> -> fallback ${formatAmount(kind, amount)}`;
      }
    } else {
      detail = formatAmount(kind, amount);
      if (modifier.perUnit === true) {
        warnings.push(`modifier '${modifier.id}' sets perUnit without a path; value used as-is`);
      }
    }

    if (!Number.isFinite(amount)) {
      warnings.push(`modifier '${modifier.id}' produced a non-finite amount; neutralised`);
      amount = neutralElement(kind);
      detail = `${detail} (invalid -> neutral)`;
    }

    applied.push({
      id: typeof modifier.id === 'string' ? modifier.id : '',
      source: typeof modifier.source === 'string' ? modifier.source : 'unknown',
      kind,
      amount,
      detail,
    });
  }

  return { applied, warnings };
}

/** Convenience wrapper returning just the applied modifiers. */
export function resolveModifiers(
  modifiers: readonly ProbabilityModifier[] | undefined | null,
  context: ProbabilityContext
): AppliedModifier[] {
  return resolveModifiersDetailed(modifiers, context).applied;
}

/** Sum of every additive modifier. */
export function sumAdditiveModifiers(applied: readonly AppliedModifier[]): number {
  let total = 0;
  for (const modifier of applied) {
    if (modifier.kind === 'add' && Number.isFinite(modifier.amount)) total += modifier.amount;
  }
  return total;
}

/** Product of every multiplicative modifier (1 when none apply). */
export function productMultiplicativeModifiers(applied: readonly AppliedModifier[]): number {
  let product = 1;
  for (const modifier of applied) {
    if (modifier.kind === 'multiply' && Number.isFinite(modifier.amount)) product *= modifier.amount;
  }
  return product;
}

/**
 * Applies the whole modifier list to a base weight:
 *   weight = (base + SUM(add)) * PRODUCT(multiply)
 * The result may be negative / non-finite; ProbabilityCalculator sanitises it
 * against the configured weight bounds.
 */
export function applyModifiersToWeight(baseWeight: number, applied: readonly AppliedModifier[]): number {
  const safeBase = typeof baseWeight === 'number' && Number.isFinite(baseWeight) ? baseWeight : 0;
  const additive = sumAdditiveModifiers(applied);
  const multiplicative = productMultiplicativeModifiers(applied);
  return (safeBase + additive) * multiplicative;
}
