import { hashString, seededValue } from '../render/geometry';

export { hashString };

export const TILE: number = 32;

/** Stateless deterministic float in [0,1) for a string tag + index. */
export function seedToString(tag: string, index: number): number {
  return seededValue(hashString(tag), index);
}
