import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SOUND_NAMES } from '../../src/audio/sfx';

const AUDIO_DIR = fileURLToPath(new URL('../../src/audio', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));

function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function audioSources(): { name: string; content: string }[] {
  return readdirSync(AUDIO_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({
      name,
      content: stripComments(readFileSync(join(AUDIO_DIR, name), 'utf8')),
    }));
}

describe('procedural audio policy', () => {
  it('never uses Math.random anywhere in src/audio', () => {
    for (const source of audioSources()) {
      expect(source.content, source.name).not.toMatch(/Math\.random/);
    }
  });

  it('uses no external assets, network calls or third-party audio libraries', () => {
    for (const source of audioSources()) {
      expect(source.content, source.name).not.toMatch(/https?:\/\//);
      expect(source.content, source.name).not.toMatch(/\bfetch\s*\(/);
      expect(source.content, source.name).not.toMatch(/XMLHttpRequest/);
      expect(source.content, source.name).not.toMatch(/\.(mp3|ogg|wav|m4a|aac|flac)\b/i);
      expect(source.content, source.name).not.toMatch(/from ['"]phaser['"]/);
      expect(source.content, source.name).not.toMatch(/from ['"]howler['"]/i);
    }
  });

  it('imports only relative project modules (no node/third-party imports)', () => {
    for (const source of audioSources()) {
      const imports = [...source.content.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
      for (const specifier of imports) {
        if (specifier === undefined) continue;
        expect(specifier.startsWith('./') || specifier.startsWith('../core/'), source.name + ' -> ' + specifier).toBe(true);
      }
    }
  });

  it('keeps the AudioManager public API required by src/main.ts', () => {
    const manager = readFileSync(join(AUDIO_DIR, 'AudioManager.ts'), 'utf8');
    for (const member of ['start()', 'update(', 'setVolumes(', 'playSfx(', 'dispose()', 'get isStarted()']) {
      expect(manager, member).toContain(member);
    }
  });

  it('defines every sound cue referenced by src/main.ts', () => {
    const main = readFileSync(join(SRC_DIR, 'main.ts'), 'utf8');
    const referenced = [...main.matchAll(/playSfx\('([a-z_]+)'\)/g)]
      .map((match) => match[1])
      .filter((name): name is string => typeof name === 'string');
    expect(referenced.length).toBeGreaterThan(5);
    const known = new Set<string>(SOUND_NAMES);
    for (const name of referenced) {
      expect(known.has(name), 'main.ts references unknown sound: ' + name).toBe(true);
    }
  });
});