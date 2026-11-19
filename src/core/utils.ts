import type { JsonValue } from './SharedTypes';

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, value: number): number {
  if (a === b) return 0;
  return clamp01((value - a) / (b - a));
}

export function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

export function roundMoney(value: number): number {
  return Math.round(value);
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

export function chunk<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

/** Structural clone for plain JSON state. Uses structuredClone when available. */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to JSON clone for non-cloneable payloads.
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Convenience alias for a JSON-safe deep clone (used by tests/tooling). */
export function jsonClone<T>(value: T): T {
  return deepClone(value);
}

export function toJsonValue<T>(value: T): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

let idCounter = 0;
let idToken = 's0';

/**
 * Configures the deterministic id generator for a new life/world. Ids derived this way are
 * reproducible for the same seed (important for deterministic replays) while remaining unique.
 */
export function configureIdGenerator(seed: number): void {
  idToken = (hashString('ids:' + (seed >>> 0)) >>> 0).toString(36);
  idCounter = 0;
}

/** Advances the id counter past every already-persisted id so loaded saves never collide. */
export function syncIdCounterFromState(state: unknown): void {
  let json: string;
  try {
    json = JSON.stringify(state);
  } catch {
    return;
  }
  if (!json) return;
  const pattern = new RegExp('_' + idToken + '_([0-9a-z]+)', 'g');
  let match: RegExpExecArray | null = null;
  let maximum = 0;
  while ((match = pattern.exec(json)) !== null) {
    const parsed = Number.parseInt(match[1] ?? '0', 36);
    if (Number.isFinite(parsed) && parsed > maximum) maximum = parsed;
  }
  if (maximum > idCounter) idCounter = maximum;
}

/** Creates a deterministic, unique id for a new entity instance. Not used for probability decisions. */
export function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idToken}_${idCounter.toString(36)}`;
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export const FNV_OFFSET_BASIS = 2166136261;
export const FNV_PRIME = 16777619;

/** FNV-1a 32-bit checksum used for save integrity validation. */
export function fnv1a(value: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

export function fnv1aHex(value: string): string {
  return fnv1a(value).toString(16).padStart(8, '0');
}

export function safeNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value;
}

export function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}

export function pickFirst<T>(values: readonly T[]): T | undefined {
  return values.length > 0 ? values[0] : undefined;
}

export function keysOf<T extends object>(value: T): string[] {
  return Object.keys(value);
}

export function valuesOf<T>(record: Record<string, T>): T[] {
  return Object.values(record);
}

export function entriesOf<T>(record: Record<string, T>): [string, T][] {
  return Object.entries(record);
}

export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${String(value)}`);
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invariant violated: ${message}`);
}

export function fillArray<T>(length: number, producer: (index: number) => T): T[] {
  const result: T[] = [];
  for (let i = 0; i < length; i += 1) result.push(producer(i));
  return result;
}

export function groupBy<T, K extends string>(values: readonly T[], keyFn: (value: T) => K): Record<K, T[]> {
  const result = {} as Record<K, T[]>;
  for (const value of values) {
    const key = keyFn(value);
    const bucket = result[key];
    if (bucket) bucket.push(value);
    else result[key] = [value];
  }
  return result;
}

/** Formats a percentage (0..1) as an integer percentage string. */
export function formatPercent(value: number, fractionDigits = 0): string {
  return `${(clamp01(value) * 100).toFixed(fractionDigits)}%`;
}