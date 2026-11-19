import type { CraftStation, ItemVisual, RecipeDef, RecipeIngredient } from '../schema';
import type { ItemId, SkillId } from '../../core/SharedTypes';
import { ITEM } from '../items/ids';
import { CRAFTED_ITEMS } from '../items/crafted';

/**
 * OWNER: Agent 7/8 (Crafting & Cooking).
 *
 * Every input/output item id must exist in some src/data/items/*.ts module:
 *  - crafted.ts (this agent): processed materials, furniture, kits, crafted tools
 *  - nature.ts (nature agent): seeds, produce, fish, raw materials
 *  - core.ts   (economy agent): tools, food & drink, cooking ingredients, books, gifts
 *  - life.ts   (life agent): cigarette care gear and ash products
 *
 * Material chain: raw (nature) -> processed (crafted.ts) -> furniture/kits/gear.
 * Ash chain: cigarette_ash (life) -> paint_pigment / ash_fertilizer / ash_glaze -> paint, fertiliser.
 */

const ITEM_VISUALS = new Map<string, ItemVisual>();
for (const item of CRAFTED_ITEMS) ITEM_VISUALS.set(item.id, item.visual);

function recipeVisual(outputId: ItemId): ItemVisual {
  const known = ITEM_VISUALS.get(outputId);
  if (known) return { ...known };
  return { color: '#c9a227', shape: 'tool' };
}

function ingredients(spec: Record<string, number>): RecipeIngredient[] {
  return Object.entries(spec).map(([itemId, quantity]) => ({ itemId, quantity }));
}

function craftRecipe(
  id: string,
  name: string,
  description: string,
  station: CraftStation,
  hours: number,
  levelReq: number,
  inputs: Record<string, number>,
  outputs: Record<string, number>,
  tags: string[],
  unlockItemId?: ItemId,
  skill: SkillId = 'crafting'
): RecipeDef {
  const firstOutput = Object.keys(outputs)[0] ?? ITEM.wood;
  const recipe: RecipeDef = {
    id,
    name,
    description,
    category: 'craft',
    station,
    inputs: ingredients(inputs),
    outputs: ingredients(outputs),
    hours,
    skill,
    levelReq,
    tags: ['craft', ...tags],
    visual: recipeVisual(firstOutput),
  };
  if (unlockItemId) recipe.unlockItemId = unlockItemId;
  return recipe;
}

function cookRecipe(
  id: string,
  name: string,
  description: string,
  station: CraftStation,
  hours: number,
  levelReq: number,
  inputs: Record<string, number>,
  outputs: Record<string, number>,
  tags: string[],
  unlockItemId?: ItemId
): RecipeDef {
  const firstOutput = Object.keys(outputs)[0] ?? ITEM.breadLoaf;
  const recipe: RecipeDef = {
    id,
    name,
    description,
    category: 'cook',
    station,
    inputs: ingredients(inputs),
    outputs: ingredients(outputs),
    hours,
    skill: 'cooking',
    levelReq,
    tags: ['cook', ...tags],
    visual: recipeVisual(firstOutput),
  };
  if (unlockItemId) recipe.unlockItemId = unlockItemId;
  return recipe;
}

// ===========================================================================
// CRAFTING RECIPES - processed materials
// ===========================================================================
const MATERIAL_RECIPES: RecipeDef[] = [
  craftRecipe('craft_plank', 'Saw Planks', 'Split and plane rough wood into straight building planks.', 'workbench', 0.5, 1,
    { [ITEM.wood]: 3 }, { [ITEM.plank]: 2 }, ['material', 'wood']),
  craftRecipe('craft_brick', 'Fire Bricks', 'Shape clay and stone, then fire them hard into red bricks.', 'workbench', 0.75, 1,
    { [ITEM.clay]: 2, [ITEM.stone]: 1 }, { [ITEM.brick]: 2 }, ['material', 'building']),
  craftRecipe('craft_nail', 'Forge Nails', 'Cut scrap metal into short nails at the bench vice.', 'workbench', 0.25, 1,
    { [ITEM.scrapMetal]: 1 }, { [ITEM.nail]: 4 }, ['material', 'metal']),
  craftRecipe('craft_glass', 'Melt Glass', 'Melt down glass shards with a coal fire into a clean pane.', 'workbench', 1, 2,
    { [ITEM.glassShard]: 2, [ITEM.coal]: 1 }, { [ITEM.glass]: 1 }, ['material', 'fire']),
  craftRecipe('craft_cloth', 'Weave Cloth', 'Weave plant fibre into a soft, even cloth.', 'workbench', 1, 1,
    { [ITEM.fibre]: 3 }, { [ITEM.cloth]: 1 }, ['material', 'textile']),
  craftRecipe('craft_leather', 'Work Waxed Leather', 'Press waxed fibre until it is supple and water rolls off it.', 'workbench', 1.5, 2,
    { [ITEM.fibre]: 2, [ITEM.wax]: 2, [ITEM.oil]: 1 }, { [ITEM.leather]: 1 }, ['material', 'textile', 'waterproof']),
  craftRecipe('craft_paper', 'Beat Paper', 'Soak and beat wood pulp into smooth folded sheets.', 'workbench', 0.5, 1,
    { [ITEM.wood]: 2 }, { [ITEM.paper]: 2 }, ['material', 'stationery']),
  craftRecipe('craft_ink', 'Grind Ink', 'Grind charcoal into oil until the mix is black as a winter night.', 'workbench', 0.5, 1,
    { [ITEM.charcoal]: 2, [ITEM.oil]: 1 }, { [ITEM.ink]: 1 }, ['material', 'stationery']),
  craftRecipe('craft_paint', 'Blend Paint', 'Bind ash pigment into oil for a warm, lasting paint.', 'workbench', 1, 2,
    { [ITEM.oil]: 1, [ITEM.paintPigment]: 1 }, { [ITEM.paint]: 1 }, ['material', 'decorative']),
  craftRecipe('craft_ceramic', 'Fire Ceramic', 'Fire shaped clay until it rings when you tap it.', 'workbench', 1.25, 2,
    { [ITEM.clay]: 3, [ITEM.coal]: 1 }, { [ITEM.ceramic]: 1 }, ['material', 'clay']),
  craftRecipe('craft_brass', 'Smelt Brass', 'Smelt copper with scrap into a warm golden alloy.', 'workbench', 1.5, 3,
    { [ITEM.copperOre]: 2, [ITEM.scrapMetal]: 1 }, { [ITEM.brass]: 1 }, ['material', 'metal']),
  craftRecipe('craft_compost', 'Heap Compost', 'Layer mushrooms and fibre into a rich, dark compost heap.', 'workbench', 2, 1,
    { [ITEM.wildMushroom]: 1, [ITEM.fibre]: 2 }, { [ITEM.compost]: 2 }, ['material', 'soil', 'garden']),
  craftRecipe('craft_beeswax', 'Clarify Beeswax', 'Melt and strain wild wax until it is clean and sweet-smelling.', 'workbench', 1, 1,
    { [ITEM.wax]: 2 }, { [ITEM.beeswax]: 1 }, ['material', 'wax']),
  craftRecipe('craft_candle_wax', 'Pour Candle Wax', 'Pour refined beeswax and oil into pale candle blocks.', 'workbench', 1, 2,
    { [ITEM.beeswax]: 2, [ITEM.oil]: 1 }, { [ITEM.candleWax]: 2 }, ['material', 'wax']),
  craftRecipe('craft_oil', 'Press Seed Oil', 'Crush sunflower seeds in a hand press for golden cooking oil.', 'workbench', 1, 2,
    { [ITEM.sunflower]: 3 }, { [ITEM.oil]: 2 }, ['material', 'cooking']),
  craftRecipe('craft_flour', 'Mill Flour', 'Grind wheat between stones into soft flour.', 'workbench', 0.75, 1,
    { [ITEM.wheat]: 3 }, { [ITEM.flour]: 2 }, ['material', 'cooking']),
];

// ===========================================================================
// CRAFTING RECIPES - cigarette ash products (the signature loop)
// ===========================================================================
const ASH_RECIPES: RecipeDef[] = [
  craftRecipe('craft_paint_pigment', 'Ash Pigment', 'Sift cold cigarette ash into a fine grey pigment.', 'workbench', 1, 2,
    { [ITEM.cigaretteAsh]: 2, [ITEM.oil]: 1 }, { [ITEM.paintPigment]: 1 }, ['ash', 'material', 'pigment']),
  craftRecipe('craft_ash_fertilizer', 'Ash Fertiliser', 'Blend cigarette ash with compost for a potent garden feed.', 'workbench', 1.5, 2,
    { [ITEM.cigaretteAsh]: 3, [ITEM.compost]: 1 }, { [ITEM.ashFertilizer]: 2 }, ['ash', 'material', 'fertiliser']),
  craftRecipe('craft_ash_glaze', 'Ash Ceramic Glaze', 'Melt ash with glass into a pale, smoky pottery glaze.', 'workbench', 2, 3,
    { [ITEM.cigaretteAsh]: 4, [ITEM.glass]: 1 }, { [ITEM.ashGlaze]: 1 }, ['ash', 'material', 'ceramic']),
];

// ===========================================================================
// CRAFTING RECIPES - tools
// ===========================================================================
const TOOL_RECIPES: RecipeDef[] = [
  craftRecipe('craft_fishing_rod_good', 'Build Good Fishing Rod', 'Bind a straight rod with brass ferrules and a cloth grip.', 'workbench', 3, 3,
    { [ITEM.plank]: 2, [ITEM.cloth]: 1, [ITEM.brass]: 1 }, { [ITEM.fishingRodGood]: 1 }, ['tool', 'fishing']),
  craftRecipe('craft_fishing_rod_master', "Build Master's Fishing Rod", 'Balance a master rod with silver ferrules and silk line guides.', 'workbench', 6, 7,
    { [ITEM.fishingRodGood]: 1, [ITEM.brass]: 2, [ITEM.silverOre]: 1, [ITEM.cloth]: 2 }, { [ITEM.fishingRodMaster]: 1 },
    ['tool', 'fishing'], ITEM.fishingBook),
];

// ===========================================================================
// CRAFTING RECIPES - furniture
// ===========================================================================
const FURNITURE_RECIPES: RecipeDef[] = [
  craftRecipe('craft_bed_simple', 'Simple Bed', 'A narrow frame with a straw mattress.', 'workbench', 2, 2,
    { [ITEM.plank]: 4, [ITEM.cloth]: 2, [ITEM.nail]: 4 }, { [ITEM.bedSimple]: 1 }, ['furniture', 'bed']),
  craftRecipe('craft_bed_comfortable', 'Comfortable Bed', 'A deep feather bed with a patchwork quilt.', 'workbench', 4, 4,
    { [ITEM.plank]: 6, [ITEM.cloth]: 4, [ITEM.feather]: 4, [ITEM.nail]: 6 }, { [ITEM.bedComfortable]: 1 }, ['furniture', 'bed', 'luxury']),
  craftRecipe('craft_table_wood', 'Wooden Table', 'A sturdy four-leg table.', 'workbench', 1.5, 1,
    { [ITEM.plank]: 4, [ITEM.nail]: 4 }, { [ITEM.tableWood]: 1 }, ['furniture', 'table']),
  craftRecipe('craft_chair_wood', 'Wooden Chair', 'A plain chair with a shaped seat.', 'workbench', 1, 1,
    { [ITEM.plank]: 2, [ITEM.nail]: 2 }, { [ITEM.chairWood]: 1 }, ['furniture', 'chair']),
  craftRecipe('craft_sofa_comfy', 'Comfortable Sofa', 'A deep cushioned sofa you will not want to leave.', 'workbench', 4, 4,
    { [ITEM.plank]: 4, [ITEM.cloth]: 5, [ITEM.feather]: 6, [ITEM.nail]: 4 }, { [ITEM.sofaComfy]: 1 }, ['furniture', 'sofa', 'luxury']),
  craftRecipe('craft_bookshelf', 'Bookshelf', 'Shelf boards and uprights, planed smooth.', 'workbench', 2.5, 2,
    { [ITEM.plank]: 6, [ITEM.nail]: 6 }, { [ITEM.bookshelf]: 1 }, ['furniture', 'storage']),
  craftRecipe('craft_wardrobe', 'Wardrobe', 'A tall wardrobe with a hanging rail and a mirror.', 'workbench', 3, 3,
    { [ITEM.plank]: 8, [ITEM.nail]: 8, [ITEM.brass]: 1 }, { [ITEM.wardrobe]: 1 }, ['furniture', 'storage']),
  craftRecipe('craft_storage_chest', 'Storage Chest', 'A banded chest with a heavy brass latch.', 'workbench', 2, 2,
    { [ITEM.plank]: 5, [ITEM.nail]: 4, [ITEM.brass]: 1 }, { [ITEM.storageChest]: 1 }, ['furniture', 'storage']),
  craftRecipe('craft_fireplace', 'Fireplace', 'Lay a brick hearth that will warm the whole room.', 'workbench', 5, 4,
    { [ITEM.brick]: 10, [ITEM.stone]: 8, [ITEM.ironOre]: 2 }, { [ITEM.fireplace]: 1 }, ['furniture', 'heat']),
  craftRecipe('craft_rug_warm', 'Warm Rug', 'Weave a thick rug in autumn colours.', 'workbench', 2, 2,
    { [ITEM.cloth]: 6, [ITEM.fibre]: 2 }, { [ITEM.rugWarm]: 1 }, ['furniture', 'textile']),
  craftRecipe('craft_floor_lamp', 'Floor Lamp', 'A brass stand, a cloth shade and a steady light.', 'workbench', 1.5, 2,
    { [ITEM.brass]: 2, [ITEM.glass]: 1, [ITEM.cloth]: 1 }, { [ITEM.floorLamp]: 1 }, ['furniture', 'light']),
  craftRecipe('craft_potted_plant', 'Potted Plant', 'Pot a cheerful plant in glazed ceramic.', 'workbench', 0.75, 1,
    { [ITEM.ceramic]: 2, [ITEM.compost]: 1, [ITEM.tulip]: 1 }, { [ITEM.pottedPlant]: 1 }, ['furniture', 'plant']),
  craftRecipe('craft_kitchen_counter', 'Kitchen Counter', 'A scrubbed counter with cupboards beneath.', 'workbench', 3, 2,
    { [ITEM.plank]: 6, [ITEM.brick]: 4, [ITEM.nail]: 6 }, { [ITEM.kitchenCounter]: 1 }, ['furniture', 'kitchen']),
  craftRecipe('craft_stove', 'Stove', 'A cast-iron stove that heats a room and a pot alike.', 'workbench', 4, 3,
    { [ITEM.ironOre]: 6, [ITEM.brick]: 4 }, { [ITEM.stove]: 1 }, ['furniture', 'kitchen', 'heat']),
  craftRecipe('craft_workbench_home', 'Home Workbench', 'A solid bench with a vice and a drawer of nails.', 'workbench', 4, 3,
    { [ITEM.plank]: 8, [ITEM.nail]: 10, [ITEM.ironOre]: 2 }, { [ITEM.workbenchHome]: 1 }, ['furniture', 'workbench']),
  craftRecipe('craft_display_case', 'Display Case', 'A glazed case for showing off a collection.', 'workbench', 3, 3,
    { [ITEM.glass]: 4, [ITEM.plank]: 3, [ITEM.brass]: 2 }, { [ITEM.displayCase]: 1 }, ['furniture', 'storage'], ITEM.museumGuide),
  craftRecipe('craft_garden_bench', 'Garden Bench', 'A slatted bench that faces the afternoon sun.', 'workbench', 1.5, 1,
    { [ITEM.plank]: 4, [ITEM.nail]: 4 }, { [ITEM.gardenBench]: 1 }, ['furniture', 'outdoor']),
  craftRecipe('craft_wall_painting', 'Wall Painting', 'Paint a small frame of Willowbrook in autumn.', 'art_studio', 3, 2,
    { [ITEM.paper]: 2, [ITEM.paint]: 2, [ITEM.plank]: 1 }, { [ITEM.wallPainting]: 1 }, ['furniture', 'art'], ITEM.artBook, 'art'),
  craftRecipe('craft_picture_frame', 'Picture Frame', 'A small brass frame waiting for a photograph.', 'art_studio', 1, 1,
    { [ITEM.plank]: 2, [ITEM.glass]: 1, [ITEM.paint]: 1 }, { [ITEM.pictureFrame]: 1 }, ['furniture', 'art'], undefined, 'art'),
  craftRecipe('craft_vase_flowers', 'Vase of Flowers', 'Fill a ceramic vase with a few cheerful blooms.', 'art_studio', 1, 1,
    { [ITEM.ceramic]: 2, [ITEM.tulip]: 2 }, { [ITEM.vaseFlowers]: 1 }, ['furniture', 'flowers'], undefined, 'art'),
  craftRecipe('craft_wall_clock', 'Wall Clock', 'Brass and glass, ticking quietly.', 'workbench', 2, 3,
    { [ITEM.brass]: 3, [ITEM.glass]: 1 }, { [ITEM.wallClock]: 1 }, ['furniture', 'brass']),
  craftRecipe('craft_candle_holder', 'Candle Holder', 'A brass holder that keeps a candle steady.', 'workbench', 1, 2,
    { [ITEM.brass]: 2, [ITEM.candleWax]: 1 }, { [ITEM.candleHolder]: 1 }, ['furniture', 'candle']),
  craftRecipe('craft_mirror', 'Mirror', 'A tall mirror in a wooden frame.', 'workbench', 2, 2,
    { [ITEM.glass]: 3, [ITEM.brass]: 2 }, { [ITEM.mirror]: 1 }, ['furniture', 'decor']),
  craftRecipe('craft_curtain', 'Curtain', 'Heavy cloth that softens the light and stops the draught.', 'workbench', 1.5, 1,
    { [ITEM.cloth]: 4, [ITEM.fibre]: 1 }, { [ITEM.curtain]: 1 }, ['furniture', 'textile']),
  craftRecipe('craft_wind_chime', 'Wind Chime', 'Brass tubes that sing whenever the wind finds them.', 'workbench', 1, 2,
    { [ITEM.brass]: 2, [ITEM.cloth]: 1, [ITEM.glass]: 1 }, { [ITEM.windChime]: 1 }, ['furniture', 'outdoor']),
];

// ===========================================================================
// CRAFTING RECIPES - building & garden kits
// ===========================================================================
const BUILDING_RECIPES: RecipeDef[] = [
  craftRecipe('craft_greenhouse_kit', 'Greenhouse Kit', 'Frame, glaze and stage a flat-packed greenhouse.', 'workbench', 6, 5,
    { [ITEM.glass]: 8, [ITEM.plank]: 8, [ITEM.nail]: 10, [ITEM.ironOre]: 2 }, { [ITEM.greenhouseKit]: 1 },
    ['building', 'greenhouse'], ITEM.gardeningBook),
  craftRecipe('craft_fence_picket', 'Picket Fence Sections', 'Saw and nail a run of white pickets.', 'workbench', 0.5, 1,
    { [ITEM.plank]: 3, [ITEM.nail]: 3 }, { [ITEM.fencePicket]: 2 }, ['building', 'garden']),
  craftRecipe('craft_flower_bed', 'Flower Bed', 'A raised bed of good soil with a wooden rim.', 'workbench', 1, 1,
    { [ITEM.plank]: 3, [ITEM.brick]: 2, [ITEM.compost]: 1 }, { [ITEM.flowerBed]: 1 }, ['building', 'garden']),
  craftRecipe('craft_bird_bath', 'Bird Bath', 'A shallow stone basin on a carved pedestal.', 'workbench', 1.5, 2,
    { [ITEM.stone]: 4, [ITEM.ceramic]: 1 }, { [ITEM.birdBath]: 1 }, ['building', 'garden']),
  craftRecipe('craft_stone_path', 'Stone Path Tiles', 'Lay out flat flagstones for a garden path.', 'workbench', 0.5, 1,
    { [ITEM.stone]: 3, [ITEM.brick]: 1 }, { [ITEM.stonePath]: 2 }, ['building', 'garden']),
];

// ===========================================================================
// CRAFTING RECIPES - cigarette protection gear
// ===========================================================================
const PROTECTION_RECIPES: RecipeDef[] = [
  craftRecipe('craft_mini_umbrella', 'Mini Folding Umbrella', 'A tiny parasol of cloth and brass for sudden rain.', 'workbench', 2, 2,
    { [ITEM.cloth]: 2, [ITEM.brass]: 1, [ITEM.paper]: 2 }, { [ITEM.miniUmbrella]: 1 }, ['cigarette', 'protection', 'rain']),
  craftRecipe('craft_waterproof_case', 'Waterproof Cigarette Case', 'Line a case with waxed leather so the rain slides off.', 'workbench', 2, 3,
    { [ITEM.leather]: 2, [ITEM.brass]: 1, [ITEM.cloth]: 1 }, { [ITEM.waterproofCase]: 1 }, ['cigarette', 'protection', 'rain']),
  craftRecipe('craft_windbreak_screen', 'Windbreak Screen', 'A folding screen of canvas on a light wooden frame.', 'workbench', 2.5, 3,
    { [ITEM.plank]: 2, [ITEM.cloth]: 2, [ITEM.leather]: 1 }, { [ITEM.windbreakScreen]: 1 }, ['cigarette', 'protection', 'wind']),
  craftRecipe('craft_waxed_paper_coat', 'Waxed Paper Coat', 'Fold paper and wax into a coat that shrugs off weather.', 'workbench', 3, 4,
    { [ITEM.paper]: 3, [ITEM.candleWax]: 2, [ITEM.cloth]: 1 }, { [ITEM.waxedPaperCoat]: 1 }, ['cigarette', 'protection', 'rain']),
  craftRecipe('craft_brass_wind_guard', 'Brass Wind Guard', 'A perforated brass collar that steadies the flame.', 'workbench', 3, 4,
    { [ITEM.brass]: 3, [ITEM.ironOre]: 1 }, { [ITEM.brassWindGuard]: 1 }, ['cigarette', 'protection', 'wind']),
  craftRecipe('craft_cigarette_holder', 'Cigarette Holder', 'A ceramic-lined brass holder that keeps your hands clean.', 'workbench', 2, 3,
    { [ITEM.brass]: 2, [ITEM.ceramic]: 1 }, { [ITEM.cigaretteHolder]: 1 }, ['cigarette', 'protection']),
  craftRecipe('craft_filter_extender', 'Filter Extender', 'A wrapped paper collar that stretches a filter further.', 'workbench', 1, 2,
    { [ITEM.paper]: 2, [ITEM.cloth]: 1 }, { [ITEM.filterExtender]: 1 }, ['cigarette', 'protection']),
  craftRecipe('craft_desiccant_pack', 'Desiccant Pack', 'Charcoal sewn into cloth pulls damp out of the air.', 'workbench', 1, 2,
    { [ITEM.cloth]: 1, [ITEM.charcoal]: 2 }, { [ITEM.desiccantPack]: 1 }, ['cigarette', 'protection', 'moisture']),
  craftRecipe('craft_hand_warmer', 'Hand Warmer', 'A brass warmer with a slow coal core.', 'workbench', 2, 3,
    { [ITEM.brass]: 2, [ITEM.coal]: 2 }, { [ITEM.handWarmer]: 1 }, ['cigarette', 'protection', 'warmth']),
  craftRecipe('craft_windproof_lighter', 'Windproof Lighter', 'A brass lighter with a shielded wick.', 'workbench', 2, 3,
    { [ITEM.brass]: 1, [ITEM.scrapMetal]: 2, [ITEM.oil]: 1 }, { [ITEM.windproofLighter]: 1 }, ['cigarette', 'protection', 'fire']),
  craftRecipe('craft_ash_tray', 'Ash Tray', 'A shallow ceramic tray for tapping ash.', 'workbench', 1.5, 2,
    { [ITEM.ceramic]: 2 }, { [ITEM.ashTray]: 1 }, ['cigarette', 'ash', 'home']),
  craftRecipe('craft_ceramic_ash_pot', 'Ceramic Ash Pot', 'A lidded pot glazed with your own ash.', 'workbench', 3, 4,
    { [ITEM.ceramic]: 3, [ITEM.ashGlaze]: 1 }, { [ITEM.ceramicAshPot]: 1 }, ['cigarette', 'ash', 'home']),
];

// ===========================================================================
// CRAFTING RECIPES - gifts
// ===========================================================================
const GIFT_RECIPES: RecipeDef[] = [
  craftRecipe('craft_handmade_candle', 'Handmade Candle', 'Pour a candle with a clean cotton wick.', 'workbench', 1, 1,
    { [ITEM.candleWax]: 2 }, { [ITEM.handmadeCandle]: 1 }, ['gift', 'candle']),
  craftRecipe('craft_gift_box', 'Gift Box', 'Fold paper and cloth into a neat little box.', 'workbench', 0.75, 1,
    { [ITEM.paper]: 2, [ITEM.cloth]: 1 }, { [ITEM.giftBox]: 1 }, ['gift', 'wrapping']),
  craftRecipe('craft_friendship_bracelet', 'Friendship Bracelet', 'Braid cloth over a thin silver clasp.', 'workbench', 1, 2,
    { [ITEM.cloth]: 1, [ITEM.brass]: 1, [ITEM.silverOre]: 1 }, { [ITEM.friendshipBracelet]: 1 }, ['gift', 'jewellery']),
  craftRecipe('craft_plush_cigarette', 'Plush Cigarette', 'A soft stuffed friend with a stitched smile.', 'workbench', 1.5, 2,
    { [ITEM.cloth]: 3, [ITEM.feather]: 2 }, { [ITEM.plushCigarette]: 1 }, ['gift', 'toy']),
  craftRecipe('craft_painted_card', 'Painted Card', 'A card painted with something worth saying.', 'art_studio', 1, 1,
    { [ITEM.paper]: 1, [ITEM.paint]: 1 }, { [ITEM.paintedCard]: 1 }, ['gift', 'art'], undefined, 'art'),
  craftRecipe('craft_bouquet', 'Bouquet', 'Gather garden flowers and tie them with cloth.', 'art_studio', 0.5, 1,
    { [ITEM.tulip]: 2, [ITEM.rose]: 2, [ITEM.cloth]: 1 }, { [ITEM.bouquet]: 1 }, ['gift', 'flowers'], undefined, 'art'),
];

// ===========================================================================
// COOKING RECIPES - preparation & ingredients
// ===========================================================================
const PREP_RECIPES: RecipeDef[] = [
  cookRecipe('cook_dough', 'Knead Dough', 'Flour and milk worked into a soft dough.', 'kitchen', 0.5, 1,
    { [ITEM.flour]: 2, [ITEM.milk]: 1 }, { [ITEM.dough]: 2 }, ['prep', 'baking']),
  cookRecipe('cook_pie_dough', 'Shortcrust Pastry', 'Rub butter into flour for a crumbly pastry.', 'kitchen', 0.5, 1,
    { [ITEM.flour]: 2, [ITEM.butter]: 1, [ITEM.salt]: 1 }, { [ITEM.pieDough]: 2 }, ['prep', 'baking']),
  cookRecipe('cook_butter', 'Churn Butter', 'Churn fresh milk until the butter separates.', 'kitchen', 0.5, 1,
    { [ITEM.milk]: 2 }, { [ITEM.butter]: 1 }, ['prep', 'dairy']),
  cookRecipe('cook_cheese', 'Press Cheese', 'Warm milk, salt and patience make a firm white cheese.', 'kitchen', 1.5, 2,
    { [ITEM.milk]: 3, [ITEM.salt]: 1 }, { [ITEM.cheese]: 2 }, ['prep', 'dairy']),
  cookRecipe('cook_jam', 'Cook Jam', 'Wild berries and sugar reduced to a thick jam.', 'kitchen', 1, 2,
    { [ITEM.wildBerries]: 3, [ITEM.sugar]: 2 }, { [ITEM.jam]: 2 }, ['prep', 'preserve']),
  cookRecipe('cook_berry_jam', 'Jar Blackberry Jam', 'Blackberries and sugar sealed in a glass jar.', 'kitchen', 1.25, 2,
    { [ITEM.blackberry]: 3, [ITEM.sugar]: 2, [ITEM.glass]: 1 }, { [ITEM.berryJam]: 2 }, ['preserve', 'jam']),
];

// ===========================================================================
// COOKING RECIPES - meals
// ===========================================================================
const MEAL_RECIPES: RecipeDef[] = [
  cookRecipe('cook_vegetable_soup', 'Garden Vegetable Soup', 'A pot of carrots, potato and onion, slowly simmered.', 'kitchen', 1, 1,
    { [ITEM.carrot]: 2, [ITEM.potato]: 1, [ITEM.onion]: 1, [ITEM.salt]: 1 }, { [ITEM.vegetableSoup]: 1 }, ['soup', 'meal']),
  cookRecipe('cook_potato_onion_soup', 'Potato & Onion Soup', 'A simple, filling soup for a cold evening.', 'kitchen', 1, 1,
    { [ITEM.potato]: 2, [ITEM.onion]: 1, [ITEM.butter]: 1, [ITEM.salt]: 1 }, { [ITEM.vegetableSoup]: 1 }, ['soup', 'meal']),
  cookRecipe('cook_mushroom_soup', 'Cream of Mushroom Soup', 'Mushrooms, milk and butter, blended smooth.', 'kitchen', 1, 1,
    { [ITEM.commonMushroom]: 2, [ITEM.milk]: 1, [ITEM.butter]: 1 }, { [ITEM.mushroomSoup]: 1 }, ['soup', 'meal']),
  cookRecipe('cook_rare_mushroom_soup', 'Rare Mushroom Soup', 'A fragrant soup made with the forest’s best mushrooms.', 'kitchen', 1.25, 3,
    { [ITEM.rareMushroom]: 1, [ITEM.commonMushroom]: 1, [ITEM.milk]: 1, [ITEM.butter]: 1 }, { [ITEM.mushroomSoup]: 1 }, ['soup', 'meal']),
  cookRecipe('cook_fish_stew', 'River Fish Stew', 'Trout, potato and onion in a peppery broth.', 'kitchen', 1.5, 2,
    { [ITEM.fishTrout]: 1, [ITEM.potato]: 1, [ITEM.onion]: 1, [ITEM.salt]: 1 }, { [ITEM.fishStew]: 1 }, ['stew', 'meal']),
  cookRecipe('cook_river_fish_soup', 'Carp & Herb Broth', 'A clear fish broth finished with herbs.', 'kitchen', 1.25, 2,
    { [ITEM.fishCarp]: 1, [ITEM.wildHerb]: 1, [ITEM.salt]: 1, [ITEM.onion]: 1 }, { [ITEM.fishStew]: 1 }, ['stew', 'meal']),
  cookRecipe('cook_roast_dinner', 'Sunday Roast Dinner', 'Roast roots and a rich gravy. A proper dinner.', 'kitchen', 2.5, 3,
    { [ITEM.potato]: 2, [ITEM.carrot]: 2, [ITEM.onion]: 1, [ITEM.butter]: 1 }, { [ITEM.roastDinner]: 1 }, ['meal', 'hearty']),
  cookRecipe('cook_cheese_sandwich', 'Cheese Sandwich', 'Bread, farmhouse cheese and a little butter.', 'kitchen', 0.25, 1,
    { [ITEM.breadLoaf]: 1, [ITEM.cheese]: 1, [ITEM.butter]: 1 }, { [ITEM.cheeseSandwich]: 1 }, ['snack', 'meal']),
  cookRecipe('cook_garden_salad', 'Garden Salad', 'Tomato, cabbage and carrot with seed oil.', 'kitchen', 0.4, 1,
    { [ITEM.tomato]: 1, [ITEM.cabbage]: 1, [ITEM.carrot]: 1, [ITEM.oil]: 1 }, { [ITEM.gardenSalad]: 1 }, ['salad', 'meal']),
  cookRecipe('cook_berry_salad', 'Summer Berry Salad', 'A bright salad scattered with wild berries.', 'kitchen', 0.4, 2,
    { [ITEM.wildBerries]: 2, [ITEM.tomato]: 1, [ITEM.mint]: 1, [ITEM.oil]: 1 }, { [ITEM.gardenSalad]: 1 }, ['salad', 'meal']),
  cookRecipe('cook_apple_pie', 'Apple Pie', 'Apples and sugar under a golden shortcrust lid.', 'kitchen', 2, 2,
    { [ITEM.pieDough]: 1, [ITEM.apple]: 3, [ITEM.sugar]: 1 }, { [ITEM.applePie]: 1 }, ['pie', 'baking']),
  cookRecipe('cook_orchard_pie', 'Orchard Fruit Pie', 'Pears folded into pastry with a little sugar.', 'kitchen', 2, 2,
    { [ITEM.pieDough]: 1, [ITEM.pear]: 3, [ITEM.sugar]: 1 }, { [ITEM.applePie]: 1 }, ['pie', 'baking']),
  cookRecipe('cook_strawberry_cake', 'Strawberry Cake', 'A soft sponge, cream and strawberries.', 'kitchen', 2.5, 3,
    { [ITEM.dough]: 1, [ITEM.strawberry]: 4, [ITEM.sugar]: 2, [ITEM.egg]: 2 }, { [ITEM.strawberryCake]: 1 }, ['cake', 'baking'], ITEM.recipeBook),
  cookRecipe('cook_bread_loaf', 'Bake Bread Loaf', 'Dough proved and baked into a crusty loaf.', 'kitchen', 1.5, 2,
    { [ITEM.dough]: 1, [ITEM.salt]: 1 }, { [ITEM.breadLoaf]: 2 }, ['baking', 'bread']),
  cookRecipe('cook_cheese_wedge', 'Farmhouse Cheese Wedge', 'A firm cheese wrapped in cloth to ripen.', 'kitchen', 1.5, 2,
    { [ITEM.cheese]: 2, [ITEM.cloth]: 1 }, { [ITEM.cheeseWedge]: 2 }, ['dairy', 'meal']),
  cookRecipe('cook_picnic_basket', 'Pack a Picnic', 'Bread, cheese, apples and a bottle of cider.', 'kitchen', 1, 3,
    { [ITEM.breadLoaf]: 1, [ITEM.cheese]: 1, [ITEM.apple]: 2, [ITEM.cider]: 1 }, { [ITEM.picnicBasket]: 1 }, ['meal', 'picnic'], ITEM.recipeBook),
  cookRecipe('cook_honey_jar', 'Jar Honey', 'Honey warmed and sealed in a glass jar.', 'kitchen', 0.5, 1,
    { [ITEM.honey]: 2, [ITEM.glass]: 1 }, { [ITEM.honeyJar]: 2 }, ['preserve', 'honey']),
  cookRecipe('cook_campfire_stew', 'Campfire Stew', 'Roots and mushrooms simmered over an open fire.', 'campfire', 1.5, 1,
    { [ITEM.potato]: 1, [ITEM.carrot]: 1, [ITEM.commonMushroom]: 1, [ITEM.salt]: 1 }, { [ITEM.vegetableSoup]: 1 }, ['stew', 'campfire']),
  cookRecipe('cook_campfire_fish_pot', 'Campfire Fish Pot', 'A trout and a handful of roots boiled in a pot.', 'campfire', 1.25, 2,
    { [ITEM.fishTrout]: 1, [ITEM.potato]: 1, [ITEM.wildHerb]: 1 }, { [ITEM.fishStew]: 1 }, ['stew', 'campfire']),
];

// ===========================================================================
// COOKING RECIPES - drinks
// ===========================================================================
const DRINK_RECIPES: RecipeDef[] = [
  cookRecipe('cook_herbal_tea', 'Herbal Tea', 'Wild herbs steeped in hot water.', 'kitchen', 0.25, 1,
    { [ITEM.wildHerb]: 1, [ITEM.mint]: 1 }, { [ITEM.herbalTea]: 2 }, ['drink', 'tea']),
  cookRecipe('cook_mint_honey_tea', 'Honey Mint Tea', 'Mint tea sweetened with a spoon of honey.', 'kitchen', 0.25, 1,
    { [ITEM.mint]: 2, [ITEM.honey]: 1 }, { [ITEM.herbalTea]: 2 }, ['drink', 'tea']),
  cookRecipe('cook_afternoon_tea', 'Afternoon Tea', 'Proper tea with a splash of milk.', 'kitchen', 0.25, 1,
    { [ITEM.teaLeaves]: 1, [ITEM.milk]: 1 }, { [ITEM.teaCup]: 2 }, ['drink', 'tea']),
  cookRecipe('cook_coffee', 'Brew Coffee', 'Ground beans and hot milk.', 'kitchen', 0.25, 1,
    { [ITEM.coffeeBeans]: 2, [ITEM.milk]: 1 }, { [ITEM.coffeeCup]: 2 }, ['drink', 'coffee']),
  cookRecipe('cook_hot_chocolate', 'Hot Chocolate', 'Milk, sugar and cocoa whisked until steaming.', 'kitchen', 0.3, 1,
    { [ITEM.milk]: 2, [ITEM.sugar]: 1 }, { [ITEM.hotChocolate]: 2 }, ['drink', 'warm']),
  cookRecipe('cook_mulled_cider', 'Mulled Cider', 'Cider warmed with apple and sugar.', 'campfire', 0.75, 2,
    { [ITEM.cider]: 1, [ITEM.apple]: 1, [ITEM.sugar]: 1 }, { [ITEM.cider]: 2 }, ['drink', 'campfire']),
];

export const RECIPES: RecipeDef[] = [
  ...MATERIAL_RECIPES,
  ...ASH_RECIPES,
  ...TOOL_RECIPES,
  ...FURNITURE_RECIPES,
  ...BUILDING_RECIPES,
  ...PROTECTION_RECIPES,
  ...GIFT_RECIPES,
  ...PREP_RECIPES,
  ...MEAL_RECIPES,
  ...DRINK_RECIPES,
];
