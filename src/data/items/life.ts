import type { ItemDef } from '../schema';
import { ITEM } from './ids';

/**
 * OWNER: Agent 12 (Life & Cigarette Physics).
 *
 * Cigarette care / protection equipment and the ash product chain. Every id here is a
 * canonical constant below; the ids list is derived from src/data/items/ids.ts so the
 * content can never drift from the shared registry.
 *
 * Protection model (consumed by CigarettePhysicsSystem):
 *  - moistureProtection 0..1 reduces rain and humidity moisture gain while equipped.
 *  - windProtection     0..1 reduces the wind burn acceleration term while equipped.
 *  - burnRateMultiplier <1 slows the base burn rate while equipped.
 *  - desiccantPack / handWarmer are carried (not worn) and are detected through
 *    inventory presence by the physics system; they dry the paper passively and are
 *    also usable through LifeSystem.warmUp().
 */
export const LIFE_ITEMS: ItemDef[] = [
  // -------------------------------------------------------------------------
  // Wearable protection
  // -------------------------------------------------------------------------
  {
    id: ITEM.miniUmbrella,
    name: 'Miniature Umbrella',
    description:
      'A tiny folding umbrella that clips to a cigarette band. The spokes are brass wire and the canopy is oiled silk, small enough for a filter yet it shrugs off most of a shower.',
    category: 'equipment',
    basePrice: 850,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: ['cigarette_equipment', 'protection', 'rain', 'umbrella', 'craftable'],
    giftTasteTags: ['practical', 'quirky'],
    effects: [{ kind: 'moisture_down', value: 0.12, durationHours: 1, description: 'Keeps stray droplets off the paper.' }],
    equipmentSlot: 'umbrella',
    moistureProtection: 0.55,
    windProtection: 0.08,
    visual: { shape: 'tool', color: '#6fa8dc', accent: '#2f5f8f' },
    source: 'Crafted at a workbench, sold by the Willowbrook flower shop.',
    rarity: 3,
  },
  {
    id: ITEM.waterproofCase,
    name: 'Waterproof Cigarette Case',
    description:
      'A snug little case of waxed leather and tin. When closed it keeps a cigarette bone dry; when worn open it still shields the longer half of the body from rain.',
    category: 'equipment',
    basePrice: 1250,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: ['cigarette_equipment', 'protection', 'rain', 'case', 'craftable'],
    effects: [{ kind: 'moisture_down', value: 0.2, durationHours: 2, description: 'Traps humidity beside the paper.' }],
    equipmentSlot: 'case',
    moistureProtection: 0.9,
    burnRateMultiplier: 0.95,
    visual: { shape: 'rect', color: '#8d6e63', accent: '#cfd8dc' },
    source: 'Crafted at a workbench from leather, wax and tin.',
    rarity: 4,
  },
  {
    id: ITEM.windbreakScreen,
    name: 'Pocket Windbreak Screen',
    description:
      'Three hinged paper panels on a wire frame. Staked in front of you it breaks the worst of a gale, and it folds flat as a bookmark when the weather softens.',
    category: 'equipment',
    basePrice: 980,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: ['cigarette_equipment', 'protection', 'wind', 'windbreak', 'craftable'],
    equipmentSlot: 'windbreak',
    windProtection: 0.75,
    moistureProtection: 0.04,
    visual: { shape: 'rect', color: '#b7c4a8', accent: '#6d7b5e' },
    source: 'Crafted at a workbench, sold by the Willowbrook market stall.',
    rarity: 3,
  },
  {
    id: ITEM.waxedPaperCoat,
    name: 'Waxed Paper Coat',
    description:
      'A paper overcoat soaked in beeswax and pressed smooth. It crinkles when you walk and smells faintly of honey, and the rain beads and rolls right off it.',
    category: 'equipment',
    basePrice: 720,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: ['cigarette_equipment', 'protection', 'rain', 'outerwear', 'craftable'],
    giftTasteTags: ['clothing', 'practical'],
    equipmentSlot: 'outerwear',
    moistureProtection: 0.5,
    windProtection: 0.22,
    visual: { shape: 'rect', color: '#c9a227', accent: '#f2e3b3' },
    source: 'Crafted at a workbench from paper and beeswax.',
    rarity: 3,
  },
  {
    id: ITEM.brassWindGuard,
    name: 'Brass Wind Guard',
    description:
      'A perforated brass sleeve that fits over the burning tip. It feeds the ember just enough air to keep smouldering evenly no matter how the wind tears at it.',
    category: 'equipment',
    basePrice: 1650,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: ['cigarette_equipment', 'protection', 'wind', 'brass', 'craftable'],
    equipmentSlot: 'accessory',
    windProtection: 0.85,
    burnRateMultiplier: 0.92,
    visual: { shape: 'circle', color: '#c9a227', accent: '#7a5c10' },
    source: 'Crafted at a workbench from brass.',
    rarity: 4,
  },
  {
    id: ITEM.cigaretteHolder,
    name: 'Long Cigarette Holder',
    description:
      'A slender bone holder that keeps the burning tip at a polite distance. It burns a little slower and keeps the filter end dry when the weather turns.',
    category: 'equipment',
    basePrice: 1400,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: ['cigarette_equipment', 'protection', 'holder', 'craftable'],
    equipmentSlot: 'accessory',
    moistureProtection: 0.25,
    burnRateMultiplier: 0.93,
    visual: { shape: 'tool', color: '#efe6d5', accent: '#b0a58f' },
    source: 'Crafted at a workbench, occasional museum gift-shop stock.',
    rarity: 3,
  },
  {
    id: ITEM.filterExtender,
    name: 'Filter Extender',
    description:
      'A screw-on filter segment that adds a thumb-width to your body. Simple, clever, and it stretches a short life by a comfortable margin.',
    category: 'equipment',
    basePrice: 1800,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: ['cigarette_equipment', 'protection', 'holder', 'craftable'],
    equipmentSlot: 'accessory',
    burnRateMultiplier: 0.88,
    visual: { shape: 'rect', color: '#d9b98c', accent: '#8a6a3f' },
    source: 'Crafted at a workbench from paper, wax and a spare filter.',
    rarity: 4,
  },

  // -------------------------------------------------------------------------
  // Carried care items
  // -------------------------------------------------------------------------
  {
    id: ITEM.desiccantPack,
    name: 'Desiccant Pack',
    description:
      'A cloth pouch of baked clay beads. Tuck it in your pocket and it drinks the damp out of the air around you; leave it in the sun to dry out for another day.',
    category: 'tool',
    basePrice: 620,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: ['cigarette_equipment', 'drying', 'desiccant', 'carry'],
    effects: [{ kind: 'moisture_down', value: 0.1, durationHours: 2, description: 'Passively wicks moisture away from the paper.' }],
    visual: { shape: 'rect', color: '#e8dcc8', accent: '#a1887f' },
    source: 'Sold by the grocery and the Ashford convenience store; crafted from clay and cloth.',
    rarity: 2,
  },
  {
    id: ITEM.windproofLighter,
    name: 'Windproof Lighter',
    description:
      'A squat brass lighter with a chimney of drilled holes. It lights first time in a storm and never needs a dry match, though the fuel is not infinite.',
    category: 'tool',
    basePrice: 480,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: ['cigarette_equipment', 'fire', 'lighter', 'tool'],
    effects: [{ kind: 'fun', value: 2, description: 'A small, reliable pleasure.' }],
    visual: { shape: 'tool', color: '#bfa15a', accent: '#4e3d1c' },
    source: 'Sold by the Ashford electronics shop and the Willowbrook market stall.',
    rarity: 2,
  },
  {
    id: ITEM.matches,
    name: 'Box of Matches',
    description:
      'Twenty wooden matches in a cardboard sleeve with a striking strip on the side. Cheap, cheerful, and ruined by the first serious rain.',
    category: 'tool',
    basePrice: 15,
    stackable: true,
    maxStack: 20,
    hasQuality: false,
    tags: ['cigarette_equipment', 'fire', 'match', 'tool'],
    visual: { shape: 'tool', color: '#e0c9a6', accent: '#b23b23' },
    source: 'Sold at the grocery, the market stall and the post office.',
    rarity: 1,
  },
  {
    id: ITEM.handWarmer,
    name: 'Clay Hand Warmer',
    description:
      'A fired clay pocket warmer with a lid of pierced tin. Filled with a glowing ember it keeps your hands warm and quietly dries the damp from your paper.',
    category: 'tool',
    basePrice: 820,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: ['cigarette_equipment', 'warming', 'drying', 'carry', 'ceramic'],
    effects: [{ kind: 'moisture_down', value: 0.08, durationHours: 3, description: 'A gentle warmth that lifts damp out of the paper.' }],
    visual: { shape: 'circle', color: '#b06a4a', accent: '#f2c48d' },
    source: 'Crafted at a workbench from clay and tin; sold by the Ashford furniture shop.',
    rarity: 2,
  },
  {
    id: ITEM.ashTray,
    name: 'Pocket Ash Tray',
    description:
      'A shallow enamelled dish with a hinged lid that snaps shut, so a pinch of ash travels home in your pocket instead of down your front. Holds one good collection.',
    category: 'misc',
    basePrice: 350,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: ['ash', 'container', 'cigarette_equipment', 'home'],
    effects: [{ kind: 'fun', value: 1, description: 'A tidy little ritual.' }],
    visual: { shape: 'circle', color: '#7d8f7a', accent: '#d8d2c2' },
    source: 'Sold at the grocery and the Ashford convenience store.',
    rarity: 2,
  },
  {
    id: ITEM.ceramicAshPot,
    name: 'Ceramic Ash Pot',
    description:
      'A heavy glazed pot thrown from river clay. It keeps collected ash perfectly dry for the garden, and its wide rim is just right for tapping out the tip of a well-lived cigarette.',
    category: 'misc',
    basePrice: 1150,
    stackable: false,
    maxStack: 1,
    hasQuality: false,
    tags: ['ash', 'container', 'cigarette_equipment', 'home', 'decor', 'ceramic'],
    visual: { shape: 'circle', color: '#6b8e9e', accent: '#e7dfc9' },
    source: 'Crafted at a workbench from ceramic and ash glaze; sold by the Ashford furniture shop.',
    rarity: 3,
  },

  // -------------------------------------------------------------------------
  // Ash product chain
  // -------------------------------------------------------------------------
  {
    id: ITEM.cigaretteAsh,
    name: 'Cigarette Ash',
    description:
      'A soft grey pinch of your own ash. Rich in potash and surprisingly good for tomatoes; artists also prize it as a smoky black pigment when it is ground finer.',
    category: 'material',
    basePrice: 8,
    stackable: true,
    maxStack: 99,
    hasQuality: false,
    tags: ['ash', 'fertilizer', 'potash', 'pigment', 'crafting', 'garden'],
    visual: { shape: 'ash', color: '#9a9a93', accent: '#d9d4c7' },
    source: 'Flicked from your own cigarette body with the collect-ash action.',
    rarity: 1,
  },
  {
    id: ITEM.ashFertilizer,
    name: 'Ash Fertiliser',
    description:
      'Cigarette ash sieved fine and cut with a little compost. One good pinch under a root crop and the leaves come up glossy; too much and the soil turns sour, so use it with care.',
    category: 'material',
    basePrice: 120,
    stackable: true,
    maxStack: 99,
    hasQuality: false,
    tags: ['ash', 'fertilizer', 'potash', 'garden', 'crafting'],
    visual: { shape: 'ash', color: '#6f6f68', accent: '#c8c3b4' },
    source: 'Crafted at a workbench or compost heap from cigarette ash and compost.',
    rarity: 2,
  },
  {
    id: ITEM.ashGlaze,
    name: 'Ash Ceramic Glaze',
    description:
      'A pale blue-grey glaze made with sifted ash and ceramic powder. Fired into stoneware it gives a speckled, softly gleaming surface that no shop-bought glaze quite matches.',
    category: 'material',
    basePrice: 240,
    stackable: true,
    maxStack: 50,
    hasQuality: true,
    tags: ['ash', 'ceramic', 'glaze', 'crafting', 'pigment'],
    visual: { shape: 'bottle', color: '#8ba6b5', accent: '#e6e2d3' },
    source: 'Crafted at a workbench from cigarette ash, ceramic and oil.',
    rarity: 3,
  },
  {
    id: ITEM.paintPigment,
    name: 'Ash Pigment',
    description:
      'Jars of smoky grey, charcoal and warm umber ground from cigarette ash and bound with linseed oil. Paintings made with it have a soft, smoky depth that deepens as it ages.',
    category: 'material',
    basePrice: 180,
    stackable: true,
    maxStack: 99,
    hasQuality: true,
    tags: ['ash', 'pigment', 'art', 'paint', 'crafting'],
    visual: { shape: 'bottle', color: '#5c5a55', accent: '#c7b299' },
    source: 'Crafted at a workbench or art studio from cigarette ash and oil.',
    rarity: 2,
  },
];

/** Every cigarette-care / ash item id this module owns. */
export const LIFE_ITEM_IDS: readonly string[] = LIFE_ITEMS.map((item) => item.id);
