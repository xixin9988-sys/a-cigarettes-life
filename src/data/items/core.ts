import type { ItemDef, ItemEffect, ItemVisual } from '../schema';
import type { EquipmentSlot, ItemCategory, ItemId, QualityStars, SkillId } from '../../core/SharedTypes';
import { ITEM } from './ids';

/**
 * CORE_ITEMS - general shop goods owned by the economy domain.
 *
 * Covers the item ids that shops sell and the player buys: tools, prepared food and
 * drink, cooking ingredients, books, clothing, gifts/collectibles and assorted misc goods.
 * Items owned by other data modules are deliberately NOT declared here:
 *   - nature.ts: seeds, produce, fish, forage, raw materials
 *   - crafted.ts: processed materials (incl. oil), furniture, building kits, good/master rods
 *   - life.ts: cigarette care equipment and ash products
 */

type ItemExtra = Partial<Omit<ItemDef, 'id' | 'name' | 'description' | 'category' | 'basePrice' | 'visual'>>;

function item(
  id: ItemId,
  name: string,
  description: string,
  category: ItemCategory,
  basePrice: number,
  visual: ItemVisual,
  extra: ItemExtra = {}
): ItemDef {
  return {
    id,
    name,
    description,
    category,
    basePrice,
    stackable: true,
    maxStack: 20,
    hasQuality: false,
    tags: [],
    visual,
    ...extra,
  };
}

function v(shape: ItemVisual['shape'], color: string, accent?: string): ItemVisual {
  if (accent) return { shape, color, accent };
  return { shape, color };
}

function toolItem(
  id: ItemId,
  name: string,
  description: string,
  basePrice: number,
  skill: SkillId,
  tier: number,
  visual: ItemVisual,
  tags: string[],
  slot: EquipmentSlot = 'tool'
): ItemDef {
  return item(id, name, description, 'tool', basePrice, visual, {
    stackable: false,
    maxStack: 1,
    toolSkill: skill,
    toolTier: tier,
    equipmentSlot: slot,
    tags: ['tool', skill, ...tags],
    rarity: 2,
  });
}

interface ConsumableOptions {
  hunger?: number;
  energy?: number;
  mood?: number;
  fun?: number;
  social?: number;
  nutrition: number;
  tags?: string[];
  taste?: string[];
  source?: string;
}

function consumable(
  id: ItemId,
  name: string,
  description: string,
  category: 'food' | 'drink',
  basePrice: number,
  visual: ItemVisual,
  options: ConsumableOptions
): ItemDef {
  const effects: ItemEffect[] = [];
  if (options.hunger) effects.push({ kind: 'hunger', value: options.hunger });
  if (options.energy) effects.push({ kind: 'energy', value: options.energy });
  if (options.mood) effects.push({ kind: 'mood', value: options.mood });
  if (options.fun) effects.push({ kind: 'fun', value: options.fun });
  if (options.social) effects.push({ kind: 'social', value: options.social });
  const tags = [category, ...(options.tags ?? [])];
  const extra: ItemExtra = {
    hasQuality: true,
    maxStack: 10,
    edible: true,
    nutrition: options.nutrition,
    tags,
  };
  if (effects.length > 0) extra.effects = effects;
  if (options.taste) extra.giftTasteTags = options.taste;
  if (options.source) extra.source = options.source;
  return item(id, name, description, category, basePrice, visual, extra);
}

interface IngredientOptions {
  tags?: string[];
  edible?: boolean;
  nutrition?: number;
  hasQuality?: boolean;
  taste?: string[];
  source?: string;
}

function ingredientItem(
  id: ItemId,
  name: string,
  description: string,
  basePrice: number,
  visual: ItemVisual,
  options: IngredientOptions = {}
): ItemDef {
  const extra: ItemExtra = {
    maxStack: 50,
    tags: ['ingredient', 'cooking', ...(options.tags ?? [])],
  };
  if (options.edible) {
    extra.edible = true;
    extra.nutrition = options.nutrition ?? 5;
  }
  if (options.hasQuality) extra.hasQuality = true;
  if (options.taste) extra.giftTasteTags = options.taste;
  if (options.source) extra.source = options.source;
  return item(id, name, description, 'material', basePrice, visual, extra);
}

function bookItem(
  id: ItemId,
  name: string,
  description: string,
  basePrice: number,
  visual: ItemVisual,
  skill: SkillId,
  xp: number,
  tags: string[],
  source: string
): ItemDef {
  return item(id, name, description, 'book', basePrice, visual, {
    stackable: false,
    maxStack: 1,
    readSkill: skill,
    effects: [{ kind: 'skill_xp', value: xp, skill }],
    tags: ['book', 'reading', skill, ...tags],
    source,
  });
}

function clothingItem(
  id: ItemId,
  name: string,
  description: string,
  basePrice: number,
  visual: ItemVisual,
  slot: EquipmentSlot,
  tags: string[],
  protections: { moisture?: number; wind?: number } = {}
): ItemDef {
  const extra: ItemExtra = {
    stackable: false,
    maxStack: 1,
    equipmentSlot: slot,
    tags: ['clothing', ...tags],
    source: 'Ashford clothing shops',
  };
  if (protections.moisture !== undefined) extra.moistureProtection = protections.moisture;
  if (protections.wind !== undefined) extra.windProtection = protections.wind;
  return item(id, name, description, 'clothing', basePrice, visual, extra);
}

function giftItem(
  id: ItemId,
  name: string,
  description: string,
  basePrice: number,
  visual: ItemVisual,
  taste: string[],
  tags: string[],
  rarity?: QualityStars
): ItemDef {
  const extra: ItemExtra = {
    maxStack: 5,
    giftTasteTags: taste,
    tags: ['gift', 'giftable', ...tags],
  };
  if (rarity) extra.rarity = rarity;
  return item(id, name, description, 'gift', basePrice, visual, extra);
}

function collectibleItem(
  id: ItemId,
  name: string,
  description: string,
  basePrice: number,
  visual: ItemVisual,
  tags: string[],
  rarity: QualityStars
): ItemDef {
  return item(id, name, description, 'collectible', basePrice, visual, {
    stackable: false,
    maxStack: 1,
    tags: ['collectible', 'memento', ...tags],
    rarity,
  });
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
const TOOLS: ItemDef[] = [
  toolItem(
    ITEM.fishingRodBasic,
    'Alder Fishing Rod',
    'A simple alder-wood rod with a cork float and a spool of waxed line. It will not land the giants of the lake, but it gets bites.',
    1800,
    'fishing',
    1,
    v('tool', '#b07a4a', '#d9c8a0'),
    ['fishing', 'rod', 'wooden'],
    'tool'
  ),
  toolItem(
    ITEM.axe,
    'Woodcutter’s Axe',
    'A well-balanced axe with a hickory handle. Deadwood and fallen branches give way to it in a few clean strokes.',
    1600,
    'foraging',
    2,
    v('tool', '#8a6a4a', '#c9c9d1'),
    ['axe', 'wood', 'woodcutting']
  ),
  toolItem(
    ITEM.pickaxe,
    'Iron Pickaxe',
    'A heavy iron head on an ash handle, worn smooth by years of knocking loose stone out of the quarry face.',
    1700,
    'foraging',
    2,
    v('tool', '#6f7079', '#a96c3f'),
    ['pickaxe', 'mining', 'stone']
  ),
  toolItem(
    ITEM.hoe,
    'Garden Hoe',
    'A sturdy hoe with a bright steel blade. Turns clods of stubborn earth into neat rows ready for seed.',
    900,
    'gardening',
    2,
    v('tool', '#7c8a5a', '#b98a4f'),
    ['hoe', 'garden', 'soil']
  ),
  toolItem(
    ITEM.wateringCan,
    'Tin Watering Can',
    'A dented tin can with a brass rose. Holds enough water for a small bed of thirsty seedlings.',
    750,
    'gardening',
    1,
    v('tool', '#9aa5a8', '#c9a25a'),
    ['wateringcan', 'water', 'garden']
  ),
  toolItem(
    ITEM.wateringCanLarge,
    'Large Copper Watering Can',
    'A tall copper can that holds twice as much as the tin one. The handle is wrapped in worn leather.',
    1500,
    'gardening',
    2,
    v('tool', '#b06a3f', '#e0c07a'),
    ['wateringcan', 'water', 'garden', 'large'],
    'accessory'
  ),
  toolItem(
    ITEM.shovel,
    'Garden Shovel',
    'A short-handled spade for digging, transplanting and unearthing whatever the previous owner buried.',
    800,
    'gardening',
    2,
    v('tool', '#7d6a55', '#9aa5a8'),
    ['shovel', 'dig', 'garden']
  ),
  toolItem(
    ITEM.bugNet,
    'Muslin Bug Net',
    'A fine muslin net on a bamboo hoop. Catches butterflies and beetles without hurting them.',
    950,
    'foraging',
    1,
    v('tool', '#e8e0c8', '#8a9a6a'),
    ['bugnet', 'insects', 'nature']
  ),
  toolItem(
    ITEM.camera,
    'Box Camera',
    'A leather-wrapped box camera with a brass lens and a folding viewfinder. Every photograph costs a roll of film.',
    4500,
    'art',
    1,
    v('rect', '#5a3f2e', '#d6b05a'),
    ['camera', 'photography', 'art'],
    'accessory'
  ),
  toolItem(
    ITEM.paintbrush,
    'Sable Paintbrush',
    'A soft sable brush with a lacquered handle. Good for fine detail work and for signing your name.',
    350,
    'art',
    2,
    v('tool', '#d8c7a0', '#7a5a3a'),
    ['paintbrush', 'painting', 'art']
  ),
  toolItem(
    ITEM.hammer,
    'Carpenter’s Hammer',
    'A claw hammer with a hickory shaft. Builds, mends and occasionally removes a stubborn nail.',
    700,
    'crafting',
    2,
    v('tool', '#8a6a4a', '#9a9a9a'),
    ['hammer', 'build', 'repair']
  ),
  toolItem(
    ITEM.sewingKit,
    'Sewing Kit',
    'A tin of needles, waxed thread and cloth patches. Enough to mend a tear and make something small and new.',
    600,
    'crafting',
    1,
    v('rect', '#c9a25a', '#7a5a3a'),
    ['sewing', 'needle', 'textile'],
    'accessory'
  ),
  toolItem(
    ITEM.cookingPot,
    'Cast Iron Pot',
    'A heavy cast-iron pot that holds heat for hours. The heart of any good soup or stew.',
    850,
    'cooking',
    1,
    v('circle', '#4a4a52', '#7a7a82'),
    ['pot', 'cooking', 'kitchen']
  ),
  toolItem(
    ITEM.pan,
    'Copper Frying Pan',
    'A copper pan that warms evenly. It still smells faintly of onions and better days.',
    700,
    'cooking',
    1,
    v('circle', '#b06a3f', '#e0c07a'),
    ['pan', 'cooking', 'kitchen']
  ),
  toolItem(
    ITEM.workbenchKit,
    'Workbench Kit',
    'A crate of clamps, files and birch boards. Unpack it at home to set up a proper workbench.',
    3200,
    'crafting',
    2,
    v('rect', '#a07a4a', '#6f6a5a'),
    ['workbench', 'crafting', 'kit'],
    'accessory'
  ),
  toolItem(
    ITEM.lantern,
    'Brass Lantern',
    'A brass lantern with a thick glass chimney and a wind-proof wick. Keeps the dark at arm’s length.',
    550,
    'exploration',
    1,
    v('rect', '#c9a25a', '#f0e0a0'),
    ['lantern', 'light', 'exploration'],
    'accessory'
  ),
  toolItem(
    ITEM.backpack,
    'Canvas Backpack',
    'A scuffed canvas pack with leather straps and three secret pockets. Holds a surprising amount of quiet treasure.',
    1200,
    'exploration',
    1,
    v('rect', '#8a7a5a', '#5a4a3a'),
    ['backpack', 'bag', 'travel'],
    'accessory'
  ),
];

// ---------------------------------------------------------------------------
// Food and drink
// ---------------------------------------------------------------------------
const FOOD_AND_DRINK: ItemDef[] = [
  consumable(
    ITEM.breadLoaf,
    'Crusty Bread Loaf',
    'A warm, flour-dusted loaf from the bakehouse. The crust crackles when you squeeze it.',
    'food',
    120,
    v('food', '#d9a866', '#8a5a2b'),
    { hunger: 22, energy: 8, nutrition: 22, taste: ['food', 'baking'], tags: ['bread', 'bakery', 'fresh'], source: 'Willowbrook Bakery' }
  ),
  consumable(
    ITEM.cheeseWedge,
    'Wedge of Farmhouse Cheese',
    'A firm golden wedge with a crumbly bite and a long, grassy finish.',
    'food',
    250,
    v('food', '#e8c45a', '#b08a2a'),
    { hunger: 18, energy: 6, nutrition: 18, taste: ['food', 'cheese'], tags: ['cheese', 'dairy', 'farm'], source: 'Willowbrook Farm' }
  ),
  consumable(
    ITEM.vegetableSoup,
    'Vegetable Soup',
    'A deep bowl of root vegetables and herbs, thick enough to stand a spoon in.',
    'food',
    380,
    v('food', '#c97a3a', '#8a9a5a'),
    { hunger: 32, energy: 10, mood: 2, nutrition: 32, taste: ['food', 'cooking', 'cozy'], tags: ['soup', 'vegetable', 'hot'], source: 'Cafes and cooking' }
  ),
  consumable(
    ITEM.applePie,
    'Apple Pie',
    'A slice of apple pie with a lattice crust and a dusting of sugar. Best warm.',
    'food',
    350,
    v('food', '#d9a866', '#c94a3a'),
    { hunger: 20, energy: 8, mood: 5, nutrition: 20, taste: ['food', 'baking', 'sweet'], tags: ['pie', 'apple', 'dessert'], source: 'Willowbrook Bakery' }
  ),
  consumable(
    ITEM.strawberryCake,
    'Strawberry Cake',
    'A small pink cake crowned with cream and wild strawberries. It looks too pretty to cut.',
    'food',
    420,
    v('food', '#f0b8c8', '#c93a5a'),
    { hunger: 16, energy: 6, mood: 8, fun: 2, nutrition: 16, taste: ['food', 'sweet', 'flowers'], tags: ['cake', 'strawberry', 'dessert'], source: 'Willowbrook Bakery' }
  ),
  consumable(
    ITEM.cheeseSandwich,
    'Cheese Sandwich',
    'Thick bread, a slab of farmhouse cheese and a smear of mustard, wrapped in paper.',
    'food',
    220,
    v('food', '#d9b866', '#e8c45a'),
    { hunger: 26, energy: 12, nutrition: 26, taste: ['food', 'cheese'], tags: ['sandwich', 'lunch', 'cheese'], source: 'Cafes and bakeries' }
  ),
  consumable(
    ITEM.gardenSalad,
    'Garden Salad',
    'Crisp leaves, radishes and a lemon dressing, arranged as though the plate mattered.',
    'food',
    280,
    v('food', '#7aa04a', '#d94a3a'),
    { hunger: 20, energy: 8, mood: 3, nutrition: 20, taste: ['food', 'garden', 'fresh'], tags: ['salad', 'vegetable', 'fresh'], source: 'Cafes and restaurants' }
  ),
  consumable(
    ITEM.fishStew,
    'Fish Stew',
    'A rich stew of river fish, potatoes and cream, served with a heel of bread.',
    'food',
    520,
    v('food', '#c9a25a', '#7a9aa8'),
    { hunger: 40, energy: 18, mood: 4, nutrition: 40, taste: ['food', 'fish', 'cooking'], tags: ['stew', 'fish', 'hot'], source: 'Ashford restaurants' }
  ),
  consumable(
    ITEM.teaCup,
    'Cup of Tea',
    'Strong tea in a chipped cup, brewed just the way you like it.',
    'drink',
    90,
    v('bottle', '#c9a25a', '#e8e0c8'),
    { energy: 12, mood: 3, nutrition: 2, taste: ['tea', 'cozy'], tags: ['tea', 'hot', 'drink'], source: 'Everywhere sensible' }
  ),
  consumable(
    ITEM.coffeeCup,
    'Cup of Coffee',
    'A dark, bitter coffee with a swirl of milk. Wakes up the whole morning.',
    'drink',
    120,
    v('bottle', '#5a3f2e', '#c9a25a'),
    { energy: 18, mood: 2, nutrition: 2, taste: ['coffee', 'city'], tags: ['coffee', 'hot', 'drink'], source: 'Cafes' }
  ),
  consumable(
    ITEM.lemonade,
    'Lemonade',
    'Sharp, sweet and full of fizz, served in a sweating glass.',
    'drink',
    140,
    v('bottle', '#f0e07a', '#d9c94a'),
    { hunger: 4, energy: 8, mood: 4, nutrition: 4, taste: ['sweet', 'refreshing'], tags: ['lemonade', 'cold', 'drink'], source: 'Cafes and stalls' }
  ),
  consumable(
    ITEM.cider,
    'Golden Cider',
    'Cloudy orchard cider in a heavy glass. Warms you from the toes up.',
    'drink',
    220,
    v('bottle', '#e0b03a', '#b07a2a'),
    { hunger: 4, energy: 10, mood: 8, fun: 4, nutrition: 4, taste: ['cider', 'autumn'], tags: ['cider', 'alcohol', 'drink'], source: 'Willowbrook Orchard' }
  ),
  consumable(
    ITEM.hotChocolate,
    'Hot Chocolate',
    'Melted chocolate and hot milk with a cloud of cream and a cinnamon pinch.',
    'drink',
    160,
    v('bottle', '#7a4a2e', '#e8d0b0'),
    { hunger: 6, energy: 10, mood: 6, nutrition: 6, taste: ['sweet', 'cozy'], tags: ['chocolate', 'hot', 'drink'], source: 'Cafes' }
  ),
  consumable(
    ITEM.honeyJar,
    'Jar of Honey',
    'A glass jar of dark, floral honey with a cloth lid tied with string.',
    'food',
    380,
    v('bottle', '#e0a02a', '#d9c07a'),
    { hunger: 12, energy: 8, mood: 3, nutrition: 12, taste: ['sweet', 'honey', 'nature'], tags: ['honey', 'jar', 'sweet'], source: 'Willowbrook Farm' }
  ),
  consumable(
    ITEM.berryJam,
    'Jar of Berry Jam',
    'A jar of berries boiled down with sugar. The lid pops when it opens.',
    'food',
    260,
    v('bottle', '#9a2a4a', '#e8d0b0'),
    { hunger: 8, energy: 6, mood: 2, nutrition: 8, taste: ['sweet', 'berries'], tags: ['jam', 'berry', 'preserve'], source: 'Willowbrook Bakery' }
  ),
  consumable(
    ITEM.mushroomSoup,
    'Cream of Mushroom Soup',
    'A velvet soup of forest mushrooms with a swirl of cream and thyme.',
    'food',
    340,
    v('food', '#d0c0a0', '#7a6a4a'),
    { hunger: 30, energy: 12, mood: 3, nutrition: 30, taste: ['food', 'mushroom', 'cooking'], tags: ['soup', 'mushroom', 'hot'], source: 'Cafes and restaurants' }
  ),
  consumable(
    ITEM.roastDinner,
    'Sunday Roast Dinner',
    'Roast meat, crisp potatoes, greens and a lake of gravy. A proper sit-down meal.',
    'food',
    680,
    v('food', '#b0762e', '#7aa04a'),
    { hunger: 55, energy: 20, mood: 8, social: 3, nutrition: 55, taste: ['food', 'cooking', 'hearty'], tags: ['roast', 'dinner', 'hearty'], source: 'Ashford restaurants' }
  ),
  consumable(
    ITEM.picnicBasket,
    'Picnic Basket',
    'A wicker basket of bread, cheese, fruit and a bottle of cordial. Meant to be shared outdoors.',
    'food',
    950,
    v('rect', '#c9a25a', '#8a6a4a'),
    { hunger: 45, energy: 15, mood: 10, fun: 5, social: 5, nutrition: 45, taste: ['food', 'picnic', 'hearty'], tags: ['picnic', 'basket', 'social'], source: 'Willowbrook Bakery' }
  ),
  consumable(
    ITEM.herbalTea,
    'Herbal Tea',
    'A pale green infusion of mint and chamomile. Calms a racing mind.',
    'drink',
    110,
    v('bottle', '#a8c98a', '#e8e0c8'),
    { energy: 8, mood: 5, nutrition: 1, taste: ['tea', 'herbal', 'cozy'], tags: ['tea', 'herbal', 'drink'], source: 'Cafes and home' }
  ),
];

// ---------------------------------------------------------------------------
// Cooking ingredients
// ---------------------------------------------------------------------------
const INGREDIENTS: ItemDef[] = [
  ingredientItem(ITEM.flour, 'Bag of Flour', 'A paper bag of stone-ground flour, soft as dust.', 80, v('rect', '#efe6d0', '#c9a25a'), { tags: ['flour', 'baking'], source: 'Willowbrook Bakery' }),
  ingredientItem(ITEM.sugar, 'Bag of Sugar', 'A bag of fine white sugar with a folded paper top.', 95, v('rect', '#f2f2f2', '#c9a25a'), { tags: ['sugar', 'sweet'], source: 'Grocery' }),
  ingredientItem(ITEM.salt, 'Pouch of Salt', 'A small cotton pouch of coarse sea salt.', 60, v('rect', '#e6e6ea', '#8a8a92'), { tags: ['salt', 'seasoning'], source: 'Grocery' }),
  ingredientItem(ITEM.butter, 'Block of Butter', 'A pale yellow block of butter wrapped in waxed paper.', 140, v('rect', '#f0e08a', '#d9c05a'), { tags: ['butter', 'dairy'], hasQuality: true, edible: true, nutrition: 6, source: 'Dairy seller' }),
  ingredientItem(ITEM.milk, 'Bottle of Milk', 'A cold glass bottle of milk with a foil cap, delivered before dawn.', 110, v('bottle', '#f2f2f2', '#a8c0d9'), { tags: ['milk', 'dairy'], hasQuality: true, edible: true, nutrition: 5, source: 'Dairy seller' }),
  ingredientItem(ITEM.egg, 'Fresh Egg', 'A brown egg from the farm hens, still warm from the straw.', 45, v('egg', '#f0e0c0', '#c9a25a'), { tags: ['egg', 'dairy'], hasQuality: true, edible: true, nutrition: 6, source: 'Willowbrook Farm' }),
  ingredientItem(ITEM.cheese, 'Wheel of Cheese', 'A small wheel of firm farmhouse cheese, rind wrapped in cloth.', 240, v('circle', '#e8c45a', '#b08a2a'), { tags: ['cheese', 'dairy'], hasQuality: true, edible: true, nutrition: 12, source: 'Willowbrook Farm' }),
  ingredientItem(ITEM.dough, 'Ball of Dough', 'A soft ball of proved dough, ready to be shaped and baked.', 120, v('circle', '#e8d8b0', '#c9a25a'), { tags: ['dough', 'baking'], source: 'Willowbrook Bakery' }),
  ingredientItem(ITEM.pieDough, 'Sheet of Pie Dough', 'A rolled sheet of buttery pastry, chilled between two papers.', 150, v('rect', '#e8d8b0', '#d9c07a'), { tags: ['pastry', 'baking'], source: 'Willowbrook Bakery' }),
  ingredientItem(ITEM.jam, 'Pot of Mixed Jam', 'A dark pot of mixed fruit jam with a paper lid.', 280, v('bottle', '#9a2a4a', '#e8d0b0'), { tags: ['jam', 'sweet'], hasQuality: true, edible: true, nutrition: 8, source: 'Willowbrook Bakery' }),
  ingredientItem(ITEM.teaLeaves, 'Pouch of Tea Leaves', 'A muslin pouch of loose black tea, fragrant with bergamot.', 160, v('rect', '#6a7a4a', '#c9a25a'), { tags: ['tea', 'leaves'], source: 'Grocery' }),
  ingredientItem(ITEM.coffeeBeans, 'Bag of Coffee Beans', 'A paper bag of dark-roasted coffee beans from Ashford.', 320, v('rect', '#5a3f2e', '#c9a25a'), { tags: ['coffee', 'beans'], source: 'Ashford cafes' }),
  ingredientItem(ITEM.honey, 'Pot of Honey', 'A clay pot of honey, thick and dark and faintly smoky.', 360, v('circle', '#e0a02a', '#b07a2a'), { tags: ['honey', 'sweet'], hasQuality: true, edible: true, nutrition: 10, source: 'Willowbrook Farm' }),
  ingredientItem(ITEM.oil, 'Bottle of Cooking Oil', 'A dark glass bottle of sunflower oil, corked and labelled by hand.', 190, v('bottle', '#e8d08a', '#a89a5a'), { tags: ['oil', 'cooking', 'fat'], source: 'Grocery' }),
];

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------
const BOOKS: ItemDef[] = [
  bookItem(ITEM.gardeningBook, 'The Patient Garden', 'A well-thumbed guide to soil, seasons and coaxing things to grow. The margins are full of pencil notes.', 480, v('book', '#5a7a4a', '#d9c07a'), 'gardening', 45, ['gardening', 'garden', 'nonfiction'], 'Grey’s Pages'),
  bookItem(ITEM.fishingBook, 'Rivercraft', 'A calm, practical book about reading water, choosing bait and waiting properly. Chapter nine is just about patience.', 520, v('book', '#4a6a8a', '#d9c07a'), 'fishing', 45, ['fishing', 'river', 'nonfiction'], 'Grey’s Pages'),
  bookItem(ITEM.localHistoryBook, 'A History of Willowbrook', 'A thick local history from the first bridge to the last festival. Someone has drawn a map in the back.', 600, v('book', '#7a5a3a', '#e0c07a'), 'exploration', 40, ['history', 'willowbrook', 'nonfiction'], 'Grey’s Pages'),
  bookItem(ITEM.recipeBook, 'The Copper Pot Cookbook', 'Recipes collected from village kitchens, with stains where the best pages were used most.', 720, v('book', '#a05a3a', '#e0c07a'), 'cooking', 50, ['cooking', 'recipes', 'food'], 'Grey’s Pages'),
  bookItem(ITEM.romanceNovel, 'The Long Way Home', 'A dog-eared romance about two people missing the same train for years. Swoony and slightly ridiculous.', 380, v('book', '#b04a6a', '#e8b8c8'), 'social', 30, ['romance', 'fiction', 'novel'], 'Grey’s Pages'),
  bookItem(ITEM.artBook, 'Colour and Light', 'A beautiful art book of landscapes and still lifes, with notes on mixing pigment and catching weather.', 640, v('book', '#6a4a8a', '#e0c07a'), 'art', 45, ['art', 'painting', 'nonfiction'], 'Ashford Museum shop'),
  bookItem(ITEM.museumGuide, 'Ashford Museum Guide', 'A slim guide to the museum collection, with a fold-out map and a page on the curious blue crystal.', 450, v('book', '#4a6a6a', '#d9c07a'), 'exploration', 30, ['museum', 'history', 'guide'], 'Ashford Museum shop'),
  bookItem(ITEM.townAlmanac, 'The Town Almanac', 'Tide tables, market days, weather lore and a list of who has won the harvest crown. Published every year.', 550, v('book', '#5a6a4a', '#d9c07a'), 'foraging', 35, ['almanac', 'town', 'nonfiction'], 'Post office and station kiosks'),
];

// ---------------------------------------------------------------------------
// Clothing
// ---------------------------------------------------------------------------
const CLOTHING: ItemDef[] = [
  clothingItem(ITEM.raincoat, 'Waxed Raincoat', 'A long waxed coat with a deep hood and big pockets. Rain runs off it in bright beads.', 2400, v('rect', '#c9b03a', '#8a7a2a'), 'outerwear', ['raincoat', 'waterproof', 'outerwear'], { moisture: 0.65 }),
  clothingItem(ITEM.wellyBoots, 'Welly Boots', 'Green rubber boots with a splash of mud already on them. Made for puddles.', 1800, v('rect', '#3a6a3a', '#7a9a5a'), 'accessory', ['boots', 'waterproof', 'footwear'], { moisture: 0.2 }),
  clothingItem(ITEM.sunHat, 'Straw Sun Hat', 'A wide straw hat with a ribbon that ties under the chin. Keeps the sun out of your eyes.', 900, v('circle', '#e8d08a', '#c94a3a'), 'hat', ['hat', 'summer', 'straw'], { moisture: 0.1 }),
  clothingItem(ITEM.scarf, 'Knitted Scarf', 'A soft knitted scarf in moss green. Smells faintly of cedar.', 750, v('rect', '#5a7a5a', '#c9a25a'), 'accessory', ['scarf', 'winter', 'knitted'], { wind: 0.15 }),
  clothingItem(ITEM.townCoat, 'Town Coat', 'A smart charcoal coat with brass buttons. The kind of coat that gets you served first.', 3600, v('rect', '#4a4a52', '#c9a25a'), 'outerwear', ['coat', 'smart', 'city'], { moisture: 0.3, wind: 0.2 }),
  clothingItem(ITEM.workApron, 'Work Apron', 'A canvas apron with a dozen pockets and a permanent dusting of flour.', 650, v('rect', '#8a6a4a', '#d9c07a'), 'outerwear', ['apron', 'work', 'shop'], { moisture: 0.1 }),
];

// ---------------------------------------------------------------------------
// Gifts and collectibles
// ---------------------------------------------------------------------------
const GIFTS: ItemDef[] = [
  giftItem(ITEM.bouquet, 'Bouquet of Garden Flowers', 'A hand-tied bunch of whatever smelled best this morning, wrapped in brown paper and string.', 450, v('flower', '#e8a0b8', '#7aa04a'), ['flowers', 'romance', 'nature'], ['flower', 'bouquet', 'handmade']),
  giftItem(ITEM.giftBox, 'Wrapped Gift Box', 'A small box wrapped in brown paper with a ribbon and a hand-written tag.', 200, v('gift', '#c96a3a', '#e8d08a'), ['surprise', 'handmade', 'cute'], ['box', 'wrapped', 'handmade']),
  giftItem(ITEM.handmadeCandle, 'Handmade Candle', 'A hand-poured beeswax candle that smells of honey and woodsmoke.', 280, v('rect', '#e8d08a', '#b07a2a'), ['handmade', 'cozy', 'home'], ['candle', 'homemade', 'cosy']),
  giftItem(ITEM.plushCigarette, 'Plush Cigarette Toy', 'A soft toy shaped like a smiling cigarette, stitched slightly lopsided. Ridiculous and lovable.', 600, v('rect', '#f7f3e8', '#b07a4a'), ['cute', 'funny', 'memento'], ['plush', 'toy', 'cute']),
  giftItem(ITEM.friendshipBracelet, 'Friendship Bracelet', 'A woven bracelet of three coloured threads with a tiny brass bead in the middle.', 350, v('circle', '#7aa0c9', '#e8d08a'), ['handmade', 'friendship', 'jewellery'], ['bracelet', 'friendship', 'handmade']),
  giftItem(ITEM.paintedCard, 'Painted Card', 'A small watercolour card of the river at dusk, signed in the corner with a paint-speckled initial.', 120, v('rect', '#f0e8d8', '#7a9ac9'), ['art', 'handmade', 'romance'], ['card', 'painting', 'handmade']),
  collectibleItem(ITEM.oldCoin, 'Old Silver Coin', 'A worn silver coin with a milled edge. The face has rubbed away, but the weight feels important.', 2500, v('circle', '#c9c9d1', '#8a8a92'), ['coin', 'antique', 'curio', 'history'], 3),
  collectibleItem(ITEM.messageBottle, 'Message in a Bottle', 'A green glass bottle sealed with wax. There is paper inside, folded very small.', 900, v('bottle', '#6a9a7a', '#d9c07a'), ['bottle', 'message', 'mystery', 'romance'], 3),
  collectibleItem(ITEM.pressedFlower, 'Pressed Flower', 'A tiny wildflower pressed flat between wax paper. The colour has gone soft and faded.', 180, v('flower', '#d9b8c9', '#a89a6a'), ['flower', 'pressed', 'romance'], 2),
  collectibleItem(ITEM.fossil, 'Ammonite Fossil', 'A spiral shell turned to stone, half a million years older than the village. Heavy and satisfying to hold.', 3200, v('gem', '#b0a08a', '#d9c07a'), ['fossil', 'prehistory', 'curio', 'museum'], 4),
  collectibleItem(ITEM.crystal, 'Blue Crystal', 'A cluster of blue crystal that catches light strangely. Cold to the touch even in summer.', 2800, v('gem', '#7aa0e8', '#d0e0f0'), ['crystal', 'mineral', 'curio', 'museum'], 4),
  collectibleItem(ITEM.musicBox, 'Antique Music Box', 'A walnut music box that plays a slow, familiar waltz when the lid is lifted.', 4200, v('rect', '#7a5a3a', '#d9c07a'), ['music', 'antique', 'heirloom', 'curio'], 5),
  collectibleItem(ITEM.oldLetter, 'Bundle of Old Letters', 'Letters tied with faded ribbon, written in a careful hand. They were never sent.', 1100, v('rect', '#e8dcc0', '#b07a4a'), ['letter', 'history', 'memento', 'romance'], 3),
  collectibleItem(ITEM.antiqueKey, 'Antique Key', 'A heavy iron key with a brass tag. The tag has a number on it and no address.', 2200, v('key', '#b08a4a', '#c9a25a'), ['key', 'antique', 'mystery', 'curio'], 4),
  collectibleItem(ITEM.silverLocket, 'Silver Locket', 'A small silver locket on a fine chain. It opens, but the picture inside is gone.', 5200, v('circle', '#c9c9d1', '#e8d08a'), ['jewellery', 'silver', 'heirloom', 'romance'], 5),
];

// ---------------------------------------------------------------------------
// Misc and special items
// ---------------------------------------------------------------------------
const MISC: ItemDef[] = [
  item(ITEM.cameraFilm, 'Roll of Camera Film', 'A sealed roll of 35mm film in a yellow canister. Twelve photographs, if you are careful.', 'material', 320, v('rect', '#e8c83a', '#5a4a2a'), {
    maxStack: 10,
    tags: ['photography', 'film', 'consumable'],
    source: 'Ashford electronics shop',
  }),
  item(ITEM.photoPaper, 'Pack of Photo Paper', 'A packet of glossy photographic paper, still crisp in its wrapper.', 'material', 180, v('rect', '#f2f2f2', '#a8b8c9'), {
    maxStack: 20,
    tags: ['photography', 'paper', 'art'],
    source: 'Ashford electronics shop',
  }),
  item(ITEM.artSupplies, 'Artist’s Supplies', 'A tin of pigments, a palette knife and three stretched canvases. Everything smells of linseed oil.', 'material', 420, v('rect', '#c9a25a', '#7a6ac9'), {
    maxStack: 10,
    tags: ['art', 'crafting', 'supplies', 'paint'],
    source: 'Grey’s Pages',
  }),
  collectibleItem(ITEM.festivalRibbon, 'Festival Ribbon', 'A bright silk ribbon from a summer festival, with a tiny brass bell sewn to one end.', 150, v('rect', '#c94a6a', '#e8d08a'), ['festival', 'ribbon', 'colour'], 2),
  collectibleItem(ITEM.harvestCrown, 'Harvest Crown', 'A crown woven from wheat, dried flowers and red ribbon. Worn by the harvest queen for one day a year.', 800, v('flower', '#e0c07a', '#c94a3a'), ['festival', 'harvest', 'crown', 'autumn'], 3),
  item(ITEM.goldenSeed, 'Golden Seed', 'A seed the colour of old honey, warm even through the paper. Nobody in the village knows what it grows into.', 'seed', 5000, v('circle', '#e8c03a', '#f7f0c0'), {
    maxStack: 1,
    stackable: false,
    hasQuality: true,
    tags: ['seed', 'golden', 'special', 'rare', 'mystery'],
    rarity: 5,
    source: 'Unknown',
  }),
  collectibleItem(ITEM.rainbowScale, 'Rainbow Scale', 'A single fish scale that shifts through every colour in the light. It is said to come from the moonfish.', 6000, v('gem', '#c9e0f0', '#e8a0e8'), ['fish', 'rainbow', 'legendary', 'curio'], 5),
  item(ITEM.legendaryLure, 'Legendary Lure', 'An old brass lure with a feather and a single ruby eye. It hums faintly when held near water.', 'tool', 8000, v('tool', '#c9a25a', '#c93a4a'), {
    stackable: false,
    maxStack: 1,
    toolSkill: 'fishing',
    toolTier: 3,
    equipmentSlot: 'tool',
    tags: ['tool', 'fishing', 'lure', 'legendary', 'rare'],
    rarity: 5,
    source: 'Unknown',
  }),
  item(ITEM.mysteriousLetter, 'Mysterious Letter', 'A letter with no signature, sealed in dark green wax. The handwriting is neat and very old.', 'collectible', 1000, v('rect', '#e8dcc0', '#3a5a3a'), {
    stackable: false,
    maxStack: 1,
    tags: ['collectible', 'memento', 'letter', 'mystery', 'quest'],
    rarity: 4,
    source: 'Unknown',
  }),
];

export const CORE_ITEMS: ItemDef[] = [...TOOLS, ...FOOD_AND_DRINK, ...INGREDIENTS, ...BOOKS, ...CLOTHING, ...GIFTS, ...MISC];
