/**
 * Pure texture manifest: prop sprite foot-prints and texture key vocabularies.
 *
 * Kept separate from the (Phaser) texture factory so tests can verify that every
 * key emitted by the layout planner has a generated texture and that the prop
 * key vocabulary stays in sync.
 */

export interface TextureSize {
  width: number;
  height: number;
}

/** Bottom-anchored prop textures (x = centre, y = ground contact). */
export const PROP_SIZES: Readonly<Record<string, TextureSize>> = {
  'prop.tree.round': { width: 40, height: 56 },
  'prop.tree.pine': { width: 34, height: 60 },
  'prop.tree.willow': { width: 48, height: 58 },
  'prop.tree.apple': { width: 40, height: 54 },
  'prop.tree.bare': { width: 36, height: 52 },
  'prop.tree.blossom': { width: 40, height: 56 },
  'prop.bush': { width: 32, height: 20 },
  'prop.hedge': { width: 64, height: 22 },
  'prop.flowerbed': { width: 44, height: 20 },
  'prop.flowers': { width: 16, height: 14 },
  'prop.tallgrass': { width: 26, height: 18 },
  'prop.rock': { width: 28, height: 18 },
  'prop.stump': { width: 24, height: 14 },
  'prop.mushroom': { width: 16, height: 14 },
  'prop.reed': { width: 16, height: 32 },
  'prop.lily': { width: 22, height: 12 },
  'prop.bramble': { width: 32, height: 24 },
  'prop.bench': { width: 48, height: 22 },
  'prop.bench.station': { width: 56, height: 24 },
  'prop.lamp.post': { width: 14, height: 46 },
  'prop.lamp.street': { width: 16, height: 62 },
  'prop.signpost': { width: 30, height: 36 },
  'prop.noticeboard': { width: 46, height: 38 },
  'prop.menu': { width: 28, height: 32 },
  'prop.stall': { width: 76, height: 42 },
  'prop.fountain': { width: 64, height: 40 },
  'prop.statue': { width: 32, height: 46 },
  'prop.well': { width: 54, height: 38 },
  'prop.crate': { width: 28, height: 24 },
  'prop.barrel': { width: 22, height: 28 },
  'prop.sack': { width: 24, height: 20 },
  'prop.hay': { width: 32, height: 20 },
  'prop.cart': { width: 58, height: 32 },
  'prop.planter': { width: 28, height: 24 },
  'prop.pot': { width: 16, height: 16 },
  'prop.plant': { width: 24, height: 30 },
  'prop.bucket': { width: 14, height: 16 },
  'prop.watercan': { width: 20, height: 16 },
  'prop.toolbox': { width: 22, height: 14 },
  'prop.bookstack': { width: 20, height: 14 },
  'prop.table': { width: 46, height: 26 },
  'prop.chair': { width: 18, height: 24 },
  'prop.counter': { width: 76, height: 28 },
  'prop.shelves': { width: 68, height: 54 },
  'prop.bed': { width: 68, height: 42 },
  'prop.stove': { width: 40, height: 32 },
  'prop.fireplace': { width: 68, height: 44 },
  'prop.workbench': { width: 76, height: 32 },
  'prop.easel': { width: 30, height: 42 },
  'prop.rug': { width: 128, height: 72 },
  'prop.displaycase': { width: 50, height: 36 },
  'prop.pedestal': { width: 30, height: 32 },
  'prop.painting': { width: 42, height: 30 },
  'prop.screen': { width: 68, height: 30 },
  'prop.desk': { width: 58, height: 28 },
  'prop.till': { width: 26, height: 18 },
  'prop.stationboard': { width: 42, height: 36 },
  'prop.stationclock': { width: 26, height: 26 },
  'prop.kiosk': { width: 84, height: 46 },
  'prop.stage': { width: 96, height: 42 },
  'prop.campfire': { width: 30, height: 22 },
  'prop.fence': { width: 64, height: 20 },
  'prop.railfence': { width: 64, height: 18 },
  'prop.stonewall': { width: 32, height: 24 },
  'prop.dock': { width: 44, height: 18 },
  'prop.mailbox': { width: 16, height: 26 },
  'prop.bin': { width: 18, height: 24 },
  'prop.bollard': { width: 10, height: 18 },
  'prop.busstop': { width: 42, height: 42 },
  'prop.car': { width: 66, height: 30 },
  'prop.trafficlight': { width: 16, height: 42 },
  'prop.flagpole': { width: 12, height: 62 },
  'prop.luggage': { width: 26, height: 18 },
  'prop.snowman': { width: 28, height: 38 },
  'prop.scarecrow': { width: 30, height: 42 },
  'prop.plot': { width: 30, height: 22 },
  'prop.kitchen': { width: 96, height: 34 },
  'prop.boat': { width: 38, height: 24 },
};

export const CROP_STAGE_SIZES: readonly TextureSize[] = [
  { width: 12, height: 10 },
  { width: 16, height: 14 },
  { width: 20, height: 20 },
  { width: 24, height: 26 },
  { width: 28, height: 32 },
];

export const WINDOW_KINDS: readonly string[] = ['small', 'tall', 'shop', 'arch'];
export const DOOR_KINDS: readonly string[] = ['wood', 'shop', 'station'];
export const WALL_STYLES: readonly string[] = ['plaster', 'brick', 'wood', 'tile', 'industrial', 'glass'];
export const NPC_OUTFITS: readonly string[] = ['casual', 'work', 'formal', 'elder', 'outdoor', 'artsy', 'city'];
export const NPC_HAIR_STYLES: readonly string[] = ['short', 'long', 'bun', 'bald'];
export const NPC_HAT_KINDS: readonly string[] = ['cap', 'brim'];
export const PLAYER_PATTERNS: readonly string[] = ['plain', 'stripe', 'dots', 'zigzag'];

export function propSize(key: string): TextureSize {
  return PROP_SIZES[key] ?? { width: 28, height: 24 };
}

/** All prop keys used anywhere in the layout planner must exist in PROP_SIZES. */
export function isKnownPropKey(key: string): boolean {
  return key in PROP_SIZES;
}
