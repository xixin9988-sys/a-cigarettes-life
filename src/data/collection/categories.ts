import type { CollectionCategoryDef } from '../schema';

/**
 * OWNER: Agent 7/8 (Crafting, Building & Collection).
 *
 * CollectionSystem matches an item to a category when the item's tags OR its
 * ItemCategory equal one of the category's itemTags. A single item can belong to
 * more than one category; the catalog used for progress counts each item once.
 *
 * Photographs are not inventory items - the photo album itself lives in
 * state.exploration (PhotoState). The 'photographs' category is declared here so the
 * collection UI can group that album alongside the item catalog; CollectionSystem's
 * numeric progress (getProgress) only covers item-backed categories, and
 * getCategoryProgress() reports the item-backed ones.
 */
export const COLLECTION_CATEGORIES: CollectionCategoryDef[] = [
  {
    id: 'fish',
    name: 'Fish of Willowbrook & Ashford',
    description: 'Every fish landed from the river, lake and canals. The museum wants them all.',
    itemTags: ['fish'],
    icon: 'fish',
  },
  {
    id: 'insects',
    name: 'Insects & Bugs',
    description: 'Beetles, butterflies and anything else that wanders into a net.',
    itemTags: ['insect', 'bug'],
    icon: 'bug',
  },
  {
    id: 'minerals',
    name: 'Minerals & Ores',
    description: 'Stones, ores and gems pulled from the countryside.',
    itemTags: ['mineral', 'ore', 'gem'],
    icon: 'gem',
  },
  {
    id: 'flowers',
    name: 'Flowers of the Vale',
    description: 'Garden blooms and wildflowers, pressed or fresh.',
    itemTags: ['flower', 'blossom'],
    icon: 'flower',
  },
  {
    id: 'plants',
    name: 'Wild Plants & Mushrooms',
    description: 'Herbs, mushrooms and useful plants gathered from the edges of the map.',
    itemTags: ['plant', 'herb', 'mushroom', 'forage'],
    icon: 'leaf',
  },
  {
    id: 'food',
    name: 'Dishes & Preserves',
    description: 'Meals, bakes and preserves made in a proper kitchen.',
    itemTags: ['cooked', 'baked', 'preserved', 'meal', 'drink', 'food'],
    icon: 'food',
  },
  {
    id: 'recipes',
    name: 'Recipes & Books',
    description: 'Cookbooks, pattern books and the notes of other lives.',
    itemTags: ['recipe', 'recipe_scroll', 'book'],
    icon: 'book',
  },
  {
    id: 'photographs',
    name: 'Photographs',
    description: 'Every photograph worth keeping, from landscapes to festival crowds.',
    itemTags: ['photo', 'photograph'],
    icon: 'image',
  },
  {
    id: 'festival',
    name: 'Festival Keepsakes',
    description: 'Ribbons, crowns and little mementos of the seasons\' festivals.',
    itemTags: ['festival', 'festival_item', 'ribbon', 'crown'],
    icon: 'ribbon',
  },
  {
    id: 'mementos',
    name: 'Life Mementos',
    description: 'Antiques, letters and keepsakes that carry a story with them.',
    itemTags: ['memento', 'memorabilia', 'keepsake', 'legacy', 'antique'],
    icon: 'gift',
  },
];
