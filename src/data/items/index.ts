import type { ItemDef } from '../schema';
import { CORE_ITEMS } from './core';
import { NATURE_ITEMS } from './nature';
import { CRAFTED_ITEMS } from './crafted';
import { LIFE_ITEMS } from './life';

export const ALL_ITEMS: ItemDef[] = [...CORE_ITEMS, ...NATURE_ITEMS, ...CRAFTED_ITEMS, ...LIFE_ITEMS];
export { CORE_ITEMS, NATURE_ITEMS, CRAFTED_ITEMS, LIFE_ITEMS };
