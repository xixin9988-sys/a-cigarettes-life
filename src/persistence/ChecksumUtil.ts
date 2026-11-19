import { fnv1aHex } from '../core/utils';

/** FNV-1a checksum over the serialised save payload. */
export function checksumOfPayload(payload: unknown): string {
  return fnv1aHex(JSON.stringify(payload));
}

export function isValidChecksum(payload: unknown, checksum: string): boolean {
  return checksumOfPayload(payload) === checksum;
}
