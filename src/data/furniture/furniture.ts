import type { FurnitureDef, ItemVisual, ItemShape } from '../schema';
import type { ItemId } from '../../core/SharedTypes';
import { ITEM } from '../items/ids';

/**
 * OWNER: Agent 8 (Building & Housing).
 * Every placeable furniture / garden piece. The FurnitureDef.id matches both the
 * ItemDef.id and ItemDef.furnitureId so an inventory item maps 1:1 to a placement.
 *
 * Slot rules used by HousingSystem:
 *  - floor   : occupies floor tiles, blocks walking, contributes comfort
 *  - wall    : hangs on a wall tile, never blocks walking
 *  - surface : small objects on top of furniture, takes one floor tile, does not block
 *  - outdoor : placed in the home garden, blocks walking
 */

function vis(color: string, shape: ItemShape, accent?: string): ItemVisual {
  return accent ? { color, shape, accent } : { color, shape };
}

function def(
  itemId: ItemId,
  name: string,
  description: string,
  slot: FurnitureDef['slot'],
  widthTiles: number,
  heightTiles: number,
  storageSlots: number,
  comfort: number,
  decor: number,
  tags: string[],
  visual: ItemVisual
): FurnitureDef {
  return {
    id: itemId,
    itemId,
    name,
    description,
    slot,
    widthTiles,
    heightTiles,
    storageSlots,
    comfort,
    decor,
    tags,
    visual,
  };
}

export const FURNITURE: FurnitureDef[] = [
  // --- Sleeping / seating ---
  def(ITEM.bedSimple, 'Simple Bed', 'A narrow bed for one tired cigarette.', 'floor', 2, 3, 0, 0.45, 0.05, ['bed', 'comfort', 'wood'], vis('#a87b4a', 'furniture', '#d9c9a3')),
  def(ITEM.bedComfortable, 'Comfortable Bed', 'A deep feather bed with a patchwork quilt.', 'floor', 2, 3, 0, 0.8, 0.12, ['bed', 'comfort', 'luxury'], vis('#8a5a3b', 'furniture', '#e8b4b8')),
  def(ITEM.chairWood, 'Wooden Chair', 'A plain chair with a shaped seat.', 'floor', 1, 1, 0, 0.1, 0.05, ['chair', 'wood'], vis('#a87b4a', 'furniture', '#c49a67')),
  def(ITEM.sofaComfy, 'Comfortable Sofa', 'A deep cushioned sofa the colour of weak tea.', 'floor', 3, 2, 0, 0.55, 0.18, ['sofa', 'comfort', 'luxury'], vis('#7a6a4a', 'furniture', '#d9c9a3')),
  def(ITEM.gardenBench, 'Garden Bench', 'A slatted bench that faces the afternoon sun.', 'outdoor', 2, 1, 0, 0.2, 0.12, ['bench', 'outdoor', 'comfort'], vis('#a87b4a', 'furniture', '#7a8f4a')),

  // --- Tables / surfaces ---
  def(ITEM.tableWood, 'Wooden Table', 'A sturdy table that seats four at a squeeze.', 'surface', 2, 2, 0, 0.05, 0.12, ['table', 'surface', 'wood'], vis('#a87b4a', 'furniture', '#c49a67')),
  def(ITEM.kitchenCounter, 'Kitchen Counter', 'A scrubbed counter with cupboards beneath.', 'floor', 3, 1, 4, 0.05, 0.15, ['kitchen', 'counter', 'workstation'], vis('#c49a67', 'furniture', '#f2ead6')),
  def(ITEM.stove, 'Stove', 'A cast-iron stove that heats a room and a pot alike.', 'floor', 2, 1, 0, 0.1, 0.15, ['kitchen', 'heat', 'workstation'], vis('#5a5a62', 'furniture', '#c9a227')),
  def(ITEM.workbenchHome, 'Home Workbench', 'A solid bench with a vice and drawers of nails.', 'floor', 3, 1, 0, 0, 0.1, ['workbench', 'crafting', 'workstation'], vis('#8a5a3b', 'furniture', '#9aa0a6')),

  // --- Storage ---
  def(ITEM.bookshelf, 'Bookshelf', 'Shelves of warm wood for books and small treasures.', 'floor', 2, 1, 8, 0, 0.2, ['shelf', 'storage', 'decor'], vis('#8a5a3b', 'furniture', '#c49a67')),
  def(ITEM.wardrobe, 'Wardrobe', 'A tall wardrobe with a mirror in the door.', 'floor', 2, 2, 12, 0.05, 0.12, ['storage', 'clothing'], vis('#6a4a32', 'furniture', '#b07a4a')),
  def(ITEM.storageChest, 'Storage Chest', 'A banded chest with a heavy brass latch.', 'floor', 2, 1, 10, 0, 0.08, ['storage', 'chest'], vis('#8a5a3b', 'furniture', '#c9a227')),
  def(ITEM.displayCase, 'Display Case', 'A glazed case for showing off collections.', 'floor', 2, 1, 6, 0, 0.3, ['storage', 'display', 'decor'], vis('#bfe3f0', 'furniture', '#c9a227')),

  // --- Heat / light ---
  def(ITEM.fireplace, 'Fireplace', 'A brick hearth that holds the heat of the room.', 'wall', 3, 1, 0, 0.2, 0.25, ['fireplace', 'heat', 'campfire'], vis('#b45a3c', 'furniture', '#e8d8b8')),
  def(ITEM.floorLamp, 'Floor Lamp', 'A brass lamp with a cloth shade.', 'floor', 1, 1, 0, 0.05, 0.12, ['lamp', 'light', 'decor'], vis('#c9a227', 'furniture', '#f6e6b0')),
  def(ITEM.candleHolder, 'Candle Holder', 'A brass holder that keeps a candle steady.', 'surface', 1, 1, 0, 0, 0.1, ['candle', 'light', 'decor'], vis('#c9a227', 'furniture', '#f0e6c8')),

  // --- Decoration ---
  def(ITEM.rugWarm, 'Warm Rug', 'A thick woven rug in autumn colours.', 'floor', 3, 2, 0, 0.15, 0.15, ['rug', 'comfort', 'decor', 'nonblocking'], vis('#b5654a', 'furniture', '#e0b47a')),
  def(ITEM.pottedPlant, 'Potted Plant', 'A cheerful green plant in a glazed pot.', 'surface', 1, 1, 0, 0, 0.15, ['plant', 'decor'], vis('#4f7a3a', 'furniture', '#b5654a')),
  def(ITEM.wallPainting, 'Wall Painting', 'A small framed painting of Willowbrook in autumn.', 'wall', 2, 1, 0, 0, 0.28, ['painting', 'wall', 'decor', 'art'], vis('#d9c9a3', 'furniture', '#d94f70')),
  def(ITEM.pictureFrame, 'Picture Frame', 'A small brass frame waiting for a photograph.', 'wall', 1, 1, 0, 0, 0.12, ['frame', 'wall', 'decor'], vis('#c9a227', 'furniture', '#f2ead6')),
  def(ITEM.wallClock, 'Wall Clock', 'A round clock that ticks reassuringly.', 'wall', 1, 1, 0, 0, 0.12, ['clock', 'wall', 'decor'], vis('#c9a227', 'furniture', '#f2ead6')),
  def(ITEM.vaseFlowers, 'Vase of Flowers', 'A ceramic vase with a few cheerful blooms.', 'surface', 1, 1, 0, 0, 0.18, ['vase', 'flowers', 'decor'], vis('#e8e2d0', 'furniture', '#d94f70')),
  def(ITEM.mirror, 'Mirror', 'A tall mirror in a wooden frame.', 'wall', 1, 2, 0, 0, 0.18, ['mirror', 'wall', 'decor'], vis('#bfe3f0', 'furniture', '#8a5a3b')),
  def(ITEM.curtain, 'Curtain', 'Heavy cloth curtains that soften the light.', 'wall', 2, 1, 0, 0, 0.14, ['curtain', 'wall', 'decor'], vis('#7a6a4a', 'furniture', '#c9b8a8')),
  def(ITEM.windChime, 'Wind Chime', 'Brass tubes that sing whenever the wind finds them.', 'wall', 1, 1, 0, 0, 0.1, ['wind_chime', 'decor'], vis('#c9a227', 'furniture', '#e8f6fb')),

  // --- Garden structures ---
  def(ITEM.fencePicket, 'Picket Fence Section', 'A neat run of white pickets.', 'outdoor', 1, 1, 0, 0, 0.08, ['fence', 'garden', 'outdoor'], vis('#f2ead6', 'furniture', '#a87b4a')),
  def(ITEM.flowerBed, 'Flower Bed', 'A raised bed of good soil with a wooden rim.', 'outdoor', 2, 1, 0, 0, 0.2, ['garden', 'flowers', 'outdoor'], vis('#5a4632', 'furniture', '#d94f70')),
  def(ITEM.birdBath, 'Bird Bath', 'A shallow stone basin on a pedestal.', 'outdoor', 1, 1, 0, 0, 0.22, ['garden', 'outdoor', 'decor', 'nature'], vis('#c4c9cf', 'furniture', '#8fa6b0')),
  def(ITEM.stonePath, 'Stone Path Tile', 'A flat flagstone for a garden path.', 'outdoor', 1, 1, 0, 0, 0.1, ['path', 'garden', 'outdoor', 'nonblocking'], vis('#9aa0a6', 'furniture', '#c4c9cf')),
];

/** Furniture tagged with this are walkable / do not block movement. */
export const NON_BLOCKING_FURNITURE_TAG = 'nonblocking';
