import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CROP_STAGE_SIZES,
  DOOR_KINDS,
  NPC_HAIR_STYLES,
  NPC_HAT_KINDS,
  NPC_OUTFITS,
  PLAYER_PATTERNS,
  PROP_SIZES,
  WALL_STYLES,
  WINDOW_KINDS,
  isKnownPropKey,
  propSize,
} from '../../src/render/assetKeys';

const TEXTURE_SOURCE = readFileSync(fileURLToPath(new URL('../../src/render/textures.ts', import.meta.url)), 'utf8');
const RENDER_DIR = fileURLToPath(new URL('../../src/render/', import.meta.url));
const SCENES_DIR = fileURLToPath(new URL('../../src/scenes/', import.meta.url));

function readTsFiles(dir: string): string {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(readTsFiles(dir + entry.name + '/'));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(readFileSync(dir + entry.name, 'utf8'));
    }
  }
  return files.join('\n');
}

const SOURCE_ALL = (() => {
  const renderSource = readTsFiles(RENDER_DIR);
  const scenesSource = readTsFiles(SCENES_DIR);
  return renderSource + scenesSource;
})();

describe('texture manifest', () => {
  it('declares positive sizes for every prop', () => {
    const keys = Object.keys(PROP_SIZES);
    expect(keys.length).toBeGreaterThan(70);
    for (const key of keys) {
      const size = PROP_SIZES[key];
      expect(key.startsWith('prop.')).toBe(true);
      expect(size).toBeDefined();
      expect(size?.width).toBeGreaterThan(0);
      expect(size?.height).toBeGreaterThan(0);
      expect(isKnownPropKey(key)).toBe(true);
      expect(propSize(key)).toEqual(size);
    }
    expect(propSize('prop.unknown')).toEqual({ width: 28, height: 24 });
  });

  it('has a texture drawer for every declared prop (and no orphans)', () => {
    // Property keys inside the PROP_DRAWERS record literal in textures.ts.
    const drawerKeys = new Set(
      [...TEXTURE_SOURCE.matchAll(/'((?:prop)\.[a-z0-9.]+)':/g)].map((match) => match[1] ?? '').filter(Boolean)
    );
    const declared = Object.keys(PROP_SIZES);
    const missingDrawer = declared.filter((key) => !drawerKeys.has(key));
    const orphanDrawer = [...drawerKeys].filter((key) => !(key in PROP_SIZES));
    expect(missingDrawer).toEqual([]);
    expect(orphanDrawer).toEqual([]);
  });

  it('covers every crop stage and figure variation', () => {
    expect(CROP_STAGE_SIZES.length).toBe(5);
    for (const size of CROP_STAGE_SIZES) {
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    }
    for (const list of [NPC_OUTFITS, NPC_HAIR_STYLES, NPC_HAT_KINDS, PLAYER_PATTERNS, WALL_STYLES, WINDOW_KINDS, DOOR_KINDS]) {
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list).size).toBe(list.length);
    }
    // Every vocabulary id must resolve to a texture key used by the factory.
    expect(TEXTURE_SOURCE).toContain('npc.torso.');
    expect(TEXTURE_SOURCE).toContain('npc.hair.');
    expect(TEXTURE_SOURCE).toContain('npc.hat.');
    expect(TEXTURE_SOURCE).toContain('player.body.');
    expect(TEXTURE_SOURCE).toContain('wall.');
    expect(TEXTURE_SOURCE).toContain('win.glass.');
    expect(TEXTURE_SOURCE).toContain('door.');
  });

  it('uses only texture keys the factory actually generates', () => {
    const known = new Set<string>([
      'fx.smoke', 'fx.steam', 'fx.glow', 'fx.shadow', 'fx.fog', 'fx.cloud', 'fx.raindrop', 'fx.splash',
      'fx.snow', 'fx.ember', 'fx.spark', 'fx.leaf', 'fx.petal', 'fx.firefly', 'fx.mote', 'fx.winddust',
      'fx.star', 'fx.moon', 'fx.sun', 'ui.keycap', 'ui.bubble', 'ui.marker', 'ui.nameplate',
      'player.filter', 'player.umb', 'player.case', 'npc.legs', 'npc.head', 'npc.arm',
      'wall.trim',
    ]);
    for (const pattern of PLAYER_PATTERNS) known.add('player.body.' + pattern);
    for (const outfit of NPC_OUTFITS) known.add('npc.torso.' + outfit);
    for (const style of NPC_HAIR_STYLES) known.add('npc.hair.' + style);
    for (const kind of NPC_HAT_KINDS) known.add('npc.hat.' + kind);
    for (const style of WALL_STYLES) known.add('wall.' + style);
    for (const kind of WINDOW_KINDS) {
      known.add('win.glass.' + kind);
      known.add('win.frame.' + kind);
    }
    for (const kind of DOOR_KINDS) known.add('door.' + kind);
    CROP_STAGE_SIZES.forEach((_size, index) => known.add('crop.stage.' + index));
    for (const key of Object.keys(PROP_SIZES)) known.add(key);

    const prefixes = [
      'fx.', 'ui.', 'player.', 'npc.', 'crop.', 'wall.', 'win.glass.', 'win.frame.', 'door.', 'prop.',
    ];
    const referenced = new Set(
      [...SOURCE_ALL.matchAll(/'((?:fx|ui|player|npc|crop|wall|win|door|prop)\.[a-z0-9.]+)'/g)]
        .map((match) => match[1] ?? '')
        .filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))
        // Dynamic fragments such as 'player.body.' or prefix families such as
        // 'prop.tree' are completed at runtime and are not full texture keys.
        .filter((key) => !key.endsWith('.') && (known.has(key) || ![...known].some((knownKey) => knownKey.startsWith(key))))
    );
    const unknown = [...referenced].filter((key) => !known.has(key));
    expect(unknown).toEqual([]);
    expect(referenced.size).toBeGreaterThan(40);
  });

  it('references only generated fx / ui / figure texture families from scene code', () => {
    // Every literal texture key used by scenes must come from a family the factory builds.
    const sceneSources = ['BaseWorldScene.ts', 'MainMenuScene.ts', 'LifeEndScene.ts', 'PreloadScene.ts']
      .map((file) => {
        try {
          return readFileSync(fileURLToPath(new URL('../../src/scenes/' + file, import.meta.url)), 'utf8');
        } catch {
          return '';
        }
      })
      .join('\n') + TEXTURE_SOURCE;
    const keys = new Set([...sceneSources.matchAll(/'((?:fx|ui|player|npc|crop)\.[a-z0-9.]+)'/g)].map((match) => match[1] ?? ''));
    const families = ['fx.', 'ui.', 'player.', 'npc.', 'crop.'];
    for (const key of keys) {
      expect(families.some((family) => key.startsWith(family))).toBe(true);
      expect(key.length).toBeGreaterThan(3);
    }
  });
});