import type { ItemDef, ItemShape, ItemVisual } from '../schema';
import type { ItemId, SkillId } from '../../core/SharedTypes';
import { ITEM } from './ids';

/**
 * OWNER: Agent 7/8 (Crafting, Cooking & Building).
 * Processed materials, crafted tools, furniture and building/garden kits.
 *
 * Items owned by other item modules are NOT defined here and are only referenced by id:
 *  - nature.ts   : seeds, produce, fish, raw materials (wood, stone, ores, clay, fibre, wax, resin, ...)
 *  - core.ts     : economy goods (tools, food/drink, books, clothing, gifts, cooking ingredients)
 *  - life.ts     : cigarette care / protection gear and ash products (cigarette_ash, ash_fertilizer,
 *                  paint_pigment, ash_glaze, cigarette gear, matches, ...)
 */

function vis(color: string, shape: ItemShape, accent?: string): ItemVisual {
  return accent ? { color, shape, accent } : { color, shape };
}

function material(
  id: ItemId,
  name: string,
  description: string,
  basePrice: number,
  visual: ItemVisual,
  tags: string[],
  source: string
): ItemDef {
  return {
    id,
    name,
    description,
    category: 'material',
    basePrice,
    stackable: true,
    maxStack: 99,
    hasQuality: true,
    tags: ['material', 'processed', ...tags],
    visual,
    source,
  };
}

function furnitureItem(
  id: ItemId,
  name: string,
  description: string,
  basePrice: number,
  visual: ItemVisual,
  tags: string[]
): ItemDef {
  return {
    id,
    name,
    description,
    category: 'furniture',
    basePrice,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: ['furniture', ...tags],
    furnitureId: id,
    giftTasteTags: ['homebody', 'decorator'],
    visual,
    source: 'Crafted at a workbench, or bought from the Ashford furniture shop.',
  };
}

// ---------------------------------------------------------------------------
// Processed materials (crafting intermediates)
// ---------------------------------------------------------------------------
const PROCESSED_MATERIALS: ItemDef[] = [
  material(ITEM.glass, 'Glass', 'A clear pane cooled from melted shards. Fits windows, cases and greenhouses.', 55, vis('#bfe3f0', 'gem', '#e8f6fb'), ['glass', 'fragile'], 'Smelted at a workbench forge from glass shards and coal.'),
  material(ITEM.cloth, 'Cloth', 'Woven fibre, soft and even. The base of curtains, cushions and clothing repairs.', 40, vis('#c9b8a8', 'rect', '#e2d6c8'), ['cloth', 'textile'], 'Woven at a workbench from fibre.'),
  material(ITEM.leather, 'Waxed Leather', 'Pliable waxed canvas that wears like soft leather. Water rolls straight off it.', 120, vis('#8a5a3b', 'rect', '#b07a4a'), ['leather', 'textile', 'waterproof'], 'Worked at a workbench from fibre and wax.'),
  material(ITEM.paper, 'Paper', 'Smooth folded sheets for letters, cards, books and wrapping.', 25, vis('#f2ead6', 'rect', '#fbf6ea'), ['paper', 'stationery'], 'Beat at a workbench from soft wood pulp.'),
  material(ITEM.ink, 'Ink', 'A dark lamp-black ink. Good for letters, labels and printing.', 80, vis('#2b2b3a', 'bottle', '#4a4a62'), ['ink', 'stationery'], 'Ground at a workbench from charcoal and oil.'),
  material(ITEM.paint, 'Paint', 'A tin of warm pigment bound in oil. For walls, frames and painted cards.', 150, vis('#d94f70', 'bottle', '#f2b544'), ['paint', 'decorative'], 'Blended at a workbench from oil and ash pigment.'),
  material(ITEM.ceramic, 'Ceramic', 'Fired clay with a clean ring. Pots, plates and garden ornaments begin here.', 90, vis('#e8e2d0', 'circle', '#f6f1e2'), ['ceramic', 'clay'], 'Fired at a workbench forge from clay and coal.'),
  material(ITEM.brass, 'Brass', 'Warm golden metal, soft enough to shape by hand. Fittings, brackets and wind chimes.', 140, vis('#c9a227', 'gem', '#f0d878'), ['brass', 'metal'], 'Smelted at a workbench forge from copper ore and scrap metal.'),
  material(ITEM.plank, 'Wooden Plank', 'A sawed plank, sanded true. The backbone of every home project.', 35, vis('#a87b4a', 'rect', '#c49a67'), ['wood', 'building'], 'Sawed at a workbench from wood.'),
  material(ITEM.brick, 'Fired Brick', 'A solid red brick, fired hard. Hearth walls and garden paths.', 30, vis('#b45a3c', 'rect', '#cf7a5c'), ['brick', 'building'], 'Fired at a workbench from clay and stone.'),
  material(ITEM.nail, 'Nail', 'A short iron nail. Small, cheap and absolutely everywhere.', 8, vis('#9aa0a6', 'rect', '#c4c9cf'), ['nail', 'metal', 'building'], 'Forged at a workbench from scrap metal.'),
  material(ITEM.compost, 'Compost', 'Rich dark compost that smells of a forest floor after rain.', 45, vis('#5a4632', 'circle', '#7a6144'), ['compost', 'fertiliser', 'soil'], 'Heaped at a workbench from mushrooms and fibre.'),
  material(ITEM.fertilizer, 'Garden Fertiliser', 'A balanced feed of compost and cigarette ash. Strong, but never harsh.', 110, vis('#7a8f4a', 'circle', '#a8bf6a'), ['fertiliser', 'soil', 'garden'], 'Blended at a workbench from compost and cigarette ash.'),
  material(ITEM.candleWax, 'Candle Wax', 'A pale wax block ready to be poured around a wick.', 70, vis('#f0e6c8', 'circle', '#fbf6e6'), ['wax', 'candle'], 'Poured at a workbench from refined beeswax.'),
  material(ITEM.beeswax, 'Refined Beeswax', 'Raw hive wax clarified until it is clean and sweet-smelling.', 90, vis('#e2b93b', 'circle', '#f2d267'), ['wax', 'bee'], 'Clarified at a workbench from wild wax.'),
];

// ---------------------------------------------------------------------------
// Furniture (each one has a matching FurnitureDef in src/data/furniture/furniture.ts)
// ---------------------------------------------------------------------------
const FURNITURE_ITEMS: ItemDef[] = [
  furnitureItem(ITEM.bedSimple, 'Simple Bed', 'A narrow wooden bed with a straw mattress. Better than the floor.', 2400, vis('#a87b4a', 'furniture', '#d9c9a3'), ['bed', 'comfort', 'wood']),
  furnitureItem(ITEM.bedComfortable, 'Comfortable Bed', 'A deep feather bed with a patchwork quilt. Sleep comes easily here.', 6800, vis('#8a5a3b', 'furniture', '#e8b4b8'), ['bed', 'comfort', 'luxury']),
  furnitureItem(ITEM.tableWood, 'Wooden Table', 'A sturdy table that seats four at a squeeze.', 1800, vis('#a87b4a', 'furniture', '#c49a67'), ['table', 'surface', 'wood']),
  furnitureItem(ITEM.chairWood, 'Wooden Chair', 'A plain chair with a shaped seat and a sensible back.', 900, vis('#a87b4a', 'furniture', '#c49a67'), ['chair', 'comfort', 'wood']),
  furnitureItem(ITEM.sofaComfy, 'Comfortable Sofa', 'A deep cushioned sofa the colour of weak tea. Hard to leave.', 8200, vis('#7a6a4a', 'furniture', '#d9c9a3'), ['sofa', 'comfort', 'luxury']),
  furnitureItem(ITEM.bookshelf, 'Bookshelf', 'Shelves of warm wood for books, jars and small treasures.', 3600, vis('#8a5a3b', 'furniture', '#c49a67'), ['shelf', 'storage', 'decor', 'wood']),
  furnitureItem(ITEM.wardrobe, 'Wardrobe', 'A tall wardrobe with a mirror inside the door and space for everything.', 5200, vis('#6a4a32', 'furniture', '#b07a4a'), ['storage', 'clothing', 'wood']),
  furnitureItem(ITEM.storageChest, 'Storage Chest', 'A banded chest with a heavy brass latch. Keeps things safe.', 2800, vis('#8a5a3b', 'furniture', '#c9a227'), ['storage', 'chest', 'wood']),
  furnitureItem(ITEM.fireplace, 'Fireplace', 'A brick hearth that holds the heat of the whole room.', 9800, vis('#b45a3c', 'furniture', '#e8d8b8'), ['fireplace', 'heat', 'comfort', 'brick']),
  furnitureItem(ITEM.rugWarm, 'Warm Rug', 'A thick woven rug in autumn colours. Warm underfoot.', 1500, vis('#b5654a', 'furniture', '#e0b47a'), ['rug', 'comfort', 'decor', 'textile']),
  furnitureItem(ITEM.floorLamp, 'Floor Lamp', 'A brass floor lamp with a cloth shade. Casts a friendly circle of light.', 2200, vis('#c9a227', 'furniture', '#f6e6b0'), ['lamp', 'light', 'decor', 'brass']),
  furnitureItem(ITEM.pottedPlant, 'Potted Plant', 'A cheerful green plant in a glazed pot. Thrives with a little attention.', 850, vis('#4f7a3a', 'furniture', '#b5654a'), ['greenery', 'decor', 'nature']),
  furnitureItem(ITEM.wallPainting, 'Wall Painting', 'A small framed painting of Willowbrook in autumn.', 3200, vis('#d9c9a3', 'furniture', '#d94f70'), ['painting', 'wall', 'decor', 'art']),
  furnitureItem(ITEM.kitchenCounter, 'Kitchen Counter', 'A scrubbed wooden counter with cupboards beneath. A proper kitchen begins here.', 4200, vis('#c49a67', 'furniture', '#f2ead6'), ['kitchen', 'counter', 'wood']),
  furnitureItem(ITEM.stove, 'Stove', 'A cast-iron stove that heats a room and a pot at the same time.', 7600, vis('#5a5a62', 'furniture', '#c9a227'), ['kitchen', 'heat', 'stove', 'metal']),
  furnitureItem(ITEM.workbenchHome, 'Home Workbench', 'A solid bench with a vice, drawers of nails and a place for every tool.', 6400, vis('#8a5a3b', 'furniture', '#9aa0a6'), ['workbench', 'crafting', 'wood']),
  furnitureItem(ITEM.displayCase, 'Display Case', 'A glazed case for showing off collections. Everything looks important inside.', 5400, vis('#bfe3f0', 'furniture', '#c9a227'), ['storage', 'display', 'decor', 'glass']),
  furnitureItem(ITEM.gardenBench, 'Garden Bench', 'A slatted bench that faces the afternoon sun.', 1600, vis('#a87b4a', 'furniture', '#7a8f4a'), ['outdoor', 'bench', 'comfort']),
  furnitureItem(ITEM.pictureFrame, 'Picture Frame', 'A small brass frame waiting for a photograph.', 950, vis('#c9a227', 'furniture', '#f2ead6'), ['frame', 'wall', 'decor']),
  furnitureItem(ITEM.wallClock, 'Wall Clock', 'A round clock that ticks in a reassuring way.', 2100, vis('#c9a227', 'furniture', '#f2ead6'), ['clock', 'wall', 'decor', 'brass']),
  furnitureItem(ITEM.vaseFlowers, 'Vase of Flowers', 'A ceramic vase with a few cheerful blooms in it.', 780, vis('#e8e2d0', 'furniture', '#d94f70'), ['vase', 'flowers', 'decor', 'ceramic']),
  furnitureItem(ITEM.candleHolder, 'Candle Holder', 'A brass holder that keeps a candle steady and safe.', 640, vis('#c9a227', 'furniture', '#f0e6c8'), ['candle', 'light', 'decor', 'brass']),
  furnitureItem(ITEM.mirror, 'Mirror', 'A tall mirror in a wooden frame. Good for checking your char before heading out.', 2600, vis('#bfe3f0', 'furniture', '#8a5a3b'), ['mirror', 'wall', 'decor']),
  furnitureItem(ITEM.curtain, 'Curtain', 'Heavy cloth curtains that soften the light and keep the draught out.', 1200, vis('#7a6a4a', 'furniture', '#c9b8a8'), ['curtain', 'wall', 'decor', 'textile']),
  furnitureItem(ITEM.windChime, 'Wind Chime', 'A handful of brass tubes that sing whenever the wind finds them.', 880, vis('#c9a227', 'furniture', '#e8f6fb'), ['wind_chime', 'decor', 'outdoor']),
];

// ---------------------------------------------------------------------------
// Building / garden kits
// ---------------------------------------------------------------------------
const BUILDING_ITEMS: ItemDef[] = [
  {
    id: ITEM.greenhouseKit,
    name: 'Greenhouse Kit',
    description:
      'Flat-packed glass, framing and staging for a proper greenhouse. Heavier than it looks.',
    category: 'material',
    basePrice: 12000,
    stackable: true,
    maxStack: 4,
    hasQuality: false,
    tags: ['building', 'greenhouse', 'kit', 'fragile'],
    visual: vis('#bfe3f0', 'rect', '#7a8f4a'),
    source: 'Crafted at a workbench, or ordered from the Ashford garden supplier.',
  },
  {
    id: ITEM.fencePicket,
    name: 'Picket Fence Section',
    description: 'A neat run of white pickets. Ties a garden together.',
    category: 'furniture',
    basePrice: 900,
    stackable: true,
    maxStack: 20,
    hasQuality: false,
    tags: ['building', 'garden', 'fence', 'outdoor'],
    furnitureId: ITEM.fencePicket,
    visual: vis('#f2ead6', 'furniture', '#a87b4a'),
    source: 'Crafted at a workbench, or bought from the garden centre.',
  },
  {
    id: ITEM.flowerBed,
    name: 'Flower Bed',
    description: 'A raised bed of good soil with a wooden rim, ready for blooms.',
    category: 'furniture',
    basePrice: 1400,
    stackable: true,
    maxStack: 8,
    hasQuality: false,
    tags: ['building', 'garden', 'flowers', 'outdoor'],
    furnitureId: ITEM.flowerBed,
    visual: vis('#5a4632', 'furniture', '#d94f70'),
    source: 'Crafted at a workbench.',
  },
  {
    id: ITEM.birdBath,
    name: 'Bird Bath',
    description: 'A shallow stone basin on a pedestal. The birds find it within a day.',
    category: 'furniture',
    basePrice: 1900,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: ['building', 'garden', 'outdoor', 'decor', 'nature'],
    furnitureId: ITEM.birdBath,
    visual: vis('#c4c9cf', 'furniture', '#8fa6b0'),
    source: 'Crafted at a workbench.',
  },
  {
    id: ITEM.stonePath,
    name: 'Stone Path Tile',
    description: 'A flat flagstone. Line a few up and a path appears.',
    category: 'furniture',
    basePrice: 700,
    stackable: true,
    maxStack: 30,
    hasQuality: false,
    tags: ['building', 'garden', 'path', 'outdoor'],
    furnitureId: ITEM.stonePath,
    visual: vis('#9aa0a6', 'furniture', '#c4c9cf'),
    source: 'Crafted at a workbench, or bought from the garden centre.',
  },
];

// ---------------------------------------------------------------------------
// Crafted tools
// ---------------------------------------------------------------------------
function craftedTool(
  id: ItemId,
  name: string,
  description: string,
  basePrice: number,
  skill: SkillId,
  tier: number,
  visual: ItemVisual
): ItemDef {
  return {
    id,
    name,
    description,
    category: 'tool',
    basePrice,
    stackable: false,
    maxStack: 1,
    hasQuality: true,
    tags: ['tool', 'crafted', skill, 'rod'],
    toolSkill: skill,
    toolTier: tier,
    visual,
    source: 'Crafted at a workbench.',
  };
}

const CRAFTED_TOOLS: ItemDef[] = [
  craftedTool(
    ITEM.fishingRodGood,
    'Good Fishing Rod',
    'A slender rod of brass fittings and supple wood. Holds a cast where you put it.',
    2200,
    'fishing',
    2,
    vis('#8a5a3b', 'tool', '#c9a227')
  ),
  craftedTool(
    ITEM.fishingRodMaster,
    "Master's Fishing Rod",
    'A beautiful rod, balanced like a fine pen. Silver ferrules, silk line guides.',
    7800,
    'fishing',
    3,
    vis('#6a4a32', 'tool', '#dfe6ec')
  ),
];

export const CRAFTED_ITEMS: ItemDef[] = [
  ...PROCESSED_MATERIALS,
  ...FURNITURE_ITEMS,
  ...BUILDING_ITEMS,
  ...CRAFTED_TOOLS,
];
