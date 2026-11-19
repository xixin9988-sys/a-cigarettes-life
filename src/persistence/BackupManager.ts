import type { GameState, SaveEnvelope } from '../core/contracts';
import { checksumOfPayload, isValidChecksum } from './ChecksumUtil';

export interface BackupBundle {
  format: 'a-cigarettes-life-backup';
  exportedAt: number;
  version: number;
  checksum: string;
  state: GameState;
}

export function createBackupBundle(state: GameState): BackupBundle {
  return {
    format: 'a-cigarettes-life-backup',
    exportedAt: Date.now(),
    version: state.version,
    checksum: checksumOfPayload(state),
    state,
  };
}

export function serialiseBackup(bundle: BackupBundle): string {
  return JSON.stringify(bundle);
}

export function parseBackup(json: string): BackupBundle {
  const parsed = JSON.parse(json) as Partial<BackupBundle>;
  if (!parsed || parsed.format !== 'a-cigarettes-life-backup' || !parsed.state) {
    throw new Error('Not a valid A Cigarette\'s Life backup file');
  }
  if (!parsed.checksum || !isValidChecksum(parsed.state, parsed.checksum)) {
    throw new Error('Backup checksum mismatch - file is corrupted');
  }
  return parsed as BackupBundle;
}

export function parseEnvelopeJson(json: string): SaveEnvelope {
  const parsed = JSON.parse(json) as Partial<SaveEnvelope>;
  if (!parsed || typeof parsed.version !== 'number' || !parsed.payload || !parsed.checksum) {
    throw new Error('Not a valid save envelope');
  }
  if (!isValidChecksum(parsed.payload, parsed.checksum)) {
    throw new Error('Save checksum mismatch - file is corrupted');
  }
  return parsed as SaveEnvelope;
}

/** Triggers a browser download for exported save JSON. */
export function downloadSaveJson(json: string, filename: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
