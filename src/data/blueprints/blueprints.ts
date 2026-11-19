import type { BlueprintDef, ItemVisual } from '../schema';
import type { ItemId, SkillId } from '../../core/SharedTypes';
import { ITEM } from '../items/ids';

/**
 * OWNER: Agent 8 (Building & Housing).
 *
 * Blueprints are long-running construction projects started through BuildingSystem.startProject().
 * Completion effects are applied by BuildingSystem:
 *  - kind 'greenhouse'      -> GreenhouseState + 4-6 FarmPlotState in state.farming
 *  - kind 'room'            -> new RoomState on the player's home (unlocksRoomId names the room)
 *  - kind 'home_expansion'  -> home.upgrades entry (+ comfort / storage bonus)
 *  - kind 'farm_facility'   -> home.upgrades entry (storage / farming bonus)
 *  - kind 'garden'          -> home.gardens entry (+ extra tillable plots for garden_patch blueprints)
 *  - kind 'store_decoration'-> shop decoration flag on state.flags
 *
 * All input item ids exist in the item data modules (nature / core / crafted / life).
 */

function vis(color: string, shape: ItemVisual['shape'], accent?: string): ItemVisual {
  return accent ? { color, shape, accent } : { color, shape };
}

function blueprint(
  id: string,
  name: string,
  description: string,
  kind: BlueprintDef['kind'],
  inputs: Record<string, number>,
  buildHours: number,
  skill: SkillId,
  levelReq: number,
  effects: string[],
  visual: ItemVisual,
  unlocksRoomId?: string
): BlueprintDef {
  const def: BlueprintDef = {
    id,
    name,
    description,
    kind,
    inputs: Object.entries(inputs).map(([itemId, quantity]: [string, number]) => ({ itemId, quantity })),
    buildHours,
    skill,
    levelReq,
    effects,
    visual,
  };
  if (unlocksRoomId) def.unlocksRoomId = unlocksRoomId;
  return def;
}

const id = (itemId: ItemId): string => itemId;

export const BLUEPRINTS: BlueprintDef[] = [
  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------
  blueprint(
    'bp_extra_room',
    'Extra Room',
    'Frame, board and plaster a brand-new room onto the house.',
    'room',
    { [id(ITEM.plank)]: 20, [id(ITEM.brick)]: 15, [id(ITEM.nail)]: 20, [id(ITEM.glass)]: 4 },
    36,
    'crafting',
    3,
    ['Adds a second room to your home', 'Extra floor space for furniture and storage'],
    vis('#e8d8b8', 'rect', '#a87b4a'),
    'second_room'
  ),
  blueprint(
    'bp_bedroom',
    "Bedroom",
    'A quiet room with a window facing the morning sun.',
    'room',
    { [id(ITEM.plank)]: 24, [id(ITEM.cloth)]: 6, [id(ITEM.nail)]: 24, [id(ITEM.paint)]: 2 },
    40,
    'crafting',
    4,
    ['Adds a bedroom to your home', '+0.05 comfort'],
    vis('#d9c9a3', 'rect', '#e8b4b8'),
    'bedroom'
  ),
  blueprint(
    'bp_kitchen',
    'Kitchen Room',
    'A proper kitchen room with a worktop and a place for a stove.',
    'room',
    { [id(ITEM.plank)]: 18, [id(ITEM.brick)]: 12, [id(ITEM.nail)]: 18, [id(ITEM.glass)]: 3 },
    32,
    'crafting',
    3,
    ['Adds a kitchen room', 'A kitchen station is always available at your home'],
    vis('#c49a67', 'rect', '#f2ead6'),
    'kitchen'
  ),
  blueprint(
    'bp_workshop',
    'Workshop',
    'A sturdy room with a concrete floor, a bench and a hand forge.',
    'room',
    { [id(ITEM.plank)]: 30, [id(ITEM.nail)]: 30, [id(ITEM.ironOre)]: 6, [id(ITEM.brick)]: 10 },
    48,
    'crafting',
    5,
    ['Adds a workshop room', 'A workbench and hand forge are always available at your home'],
    vis('#8a7a62', 'rect', '#9aa0a6'),
    'workshop'
  ),
  blueprint(
    'bp_storeroom',
    'Storeroom',
    'Shelves, pegs and dry air. Somewhere to put everything.',
    'room',
    { [id(ITEM.plank)]: 16, [id(ITEM.nail)]: 16 },
    24,
    'crafting',
    2,
    ['Adds a storeroom', '+16 home storage slots'],
    vis('#a87b4a', 'rect', '#c49a67'),
    'storeroom'
  ),
  blueprint(
    'bp_conservatory',
    'Conservatory',
    'A glass-walled room that catches the light all year round.',
    'room',
    { [id(ITEM.glass)]: 20, [id(ITEM.plank)]: 20, [id(ITEM.nail)]: 20, [id(ITEM.brass)]: 4 },
    60,
    'crafting',
    6,
    ['Adds a conservatory', 'Greatly improves decoration score'],
    vis('#bfe3f0', 'rect', '#7a8f4a'),
    'conservatory'
  ),

  // -------------------------------------------------------------------------
  // Greenhouses & farm facilities
  // -------------------------------------------------------------------------
  blueprint(
    'bp_greenhouse_basic',
    'Greenhouse',
    'Build a working glasshouse in the garden. Crops inside ignore the cold.',
    'greenhouse',
    { [id(ITEM.greenhouseKit)]: 1, [id(ITEM.wood)]: 10, [id(ITEM.stone)]: 8 },
    24,
    'gardening',
    2,
    ['Builds a greenhouse at home', 'Adds 4 fertile plots that ignore seasonal frost'],
    vis('#bfe3f0', 'rect', '#7a8f4a')
  ),
  blueprint(
    'bp_greenhouse_large',
    'Large Greenhouse',
    'A bigger glasshouse with staging down both sides.',
    'greenhouse',
    { [id(ITEM.greenhouseKit)]: 2, [id(ITEM.glass)]: 10, [id(ITEM.wood)]: 16, [id(ITEM.brick)]: 12 },
    40,
    'gardening',
    5,
    ['Builds a large greenhouse at home', 'Adds 6 fertile plots that ignore seasonal frost'],
    vis('#d7eef5', 'rect', '#7a8f4a')
  ),
  blueprint(
    'bp_farm_shed',
    'Farm Shed',
    'A timber shed for tools, seed sacks and wet boots.',
    'farm_facility',
    { [id(ITEM.plank)]: 24, [id(ITEM.nail)]: 24, [id(ITEM.brick)]: 10, [id(ITEM.ironOre)]: 2 },
    28,
    'crafting',
    3,
    ['Builds a farm shed', '+20 home storage slots', '+0.05 comfort'],
    vis('#8a5a3b', 'rect', '#9aa0a6')
  ),
  blueprint(
    'bp_garden_expansion',
    'Garden Expansion',
    'Clears and dresses a new patch of ground for growing.',
    'garden',
    { [id(ITEM.plank)]: 12, [id(ITEM.stone)]: 10, [id(ITEM.compost)]: 4 },
    16,
    'gardening',
    2,
    ['Extends the home garden', 'Adds 3 tillable plots beside the house'],
    vis('#5a4632', 'rect', '#7a8f4a')
  ),
  blueprint(
    'bp_garden_flowers',
    'Flower Garden',
    'A formal little flower garden with a path around it.',
    'garden',
    { [id(ITEM.tulipBulb)]: 5, [id(ITEM.roseCutting)]: 3, [id(ITEM.compost)]: 2, [id(ITEM.plank)]: 4 },
    12,
    'gardening',
    2,
    ['Plants a flower garden at home', '+0.1 decoration score'],
    vis('#7a8f4a', 'rect', '#d94f70')
  ),

  // -------------------------------------------------------------------------
  // Home expansions
  // -------------------------------------------------------------------------
  blueprint(
    'bp_kitchen_upgrade',
    'Kitchen Upgrade',
    'New worktops, a pantry shelf and a better stove flue.',
    'home_expansion',
    { [id(ITEM.plank)]: 14, [id(ITEM.nail)]: 14, [id(ITEM.brass)]: 4, [id(ITEM.glass)]: 2 },
    20,
    'cooking',
    3,
    ['Upgrades the kitchen', '+0.08 comfort'],
    vis('#c49a67', 'rect', '#c9a227')
  ),
  blueprint(
    'bp_bedroom_expansion',
    'Bedroom Expansion',
    'Knock through and make the bedroom genuinely restful.',
    'home_expansion',
    { [id(ITEM.plank)]: 20, [id(ITEM.cloth)]: 8, [id(ITEM.paint)]: 2, [id(ITEM.nail)]: 20 },
    30,
    'crafting',
    4,
    ['Expands the bedroom', '+0.1 comfort'],
    vis('#d9c9a3', 'rect', '#e8b4b8')
  ),
  blueprint(
    'bp_home_extension',
    'Home Extension',
    'A general extension: better insulation, a porch and a coat rail.',
    'home_expansion',
    { [id(ITEM.plank)]: 18, [id(ITEM.brick)]: 12, [id(ITEM.nail)]: 18, [id(ITEM.glass)]: 2 },
    26,
    'crafting',
    3,
    ['Extends the house', '+8 home storage slots'],
    vis('#e8d8b8', 'rect', '#a87b4a')
  ),

  // -------------------------------------------------------------------------
  // Store decoration
  // -------------------------------------------------------------------------
  blueprint(
    'bp_shop_counter',
    'Shop Counter',
    'A proper serving counter for the shop floor.',
    'store_decoration',
    { [id(ITEM.plank)]: 10, [id(ITEM.nail)]: 10, [id(ITEM.brass)]: 3 },
    14,
    'crafting',
    3,
    ['Adds a serving counter to your shop', '+1 influence in the village'],
    vis('#8a5a3b', 'rect', '#c9a227')
  ),
  blueprint(
    'bp_store_shelves',
    'Display Shelves',
    'Glass-fronted shelving that makes stock look like treasure.',
    'store_decoration',
    { [id(ITEM.plank)]: 12, [id(ITEM.nail)]: 12, [id(ITEM.glass)]: 4 },
    12,
    'crafting',
    2,
    ['Adds display shelves to your shop', '+1 influence in the village'],
    vis('#bfe3f0', 'rect', '#c9a227')
  ),
  blueprint(
    'bp_shop_sign',
    'Painted Shop Sign',
    'A hand-painted sign over the door. Shops with signs get noticed.',
    'store_decoration',
    { [id(ITEM.paint)]: 2, [id(ITEM.plank)]: 4, [id(ITEM.ink)]: 1 },
    8,
    'art',
    2,
    ['Paints a shop sign', '+1 influence in the village'],
    vis('#d94f70', 'rect', '#f2ead6')
  ),
];
