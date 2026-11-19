import type { ContentPack } from './schema';
import { ALL_ITEMS } from './items';
import { LOCATIONS } from './locations/locations';
import { BUSINESSES } from './shops/shops';
import { NPCS } from './npcs/npcs';
import { CROPS } from './crops/crops';
import { FISH, FORAGE_NODES } from './fish/fish';
import { RECIPES } from './recipes/recipes';
import { EVENTS, FESTIVALS } from './events/events';
import { DIALOGUE_TREES } from './dialogue/dialogue';
import { FURNITURE } from './furniture/furniture';
import { BLUEPRINTS } from './blueprints/blueprints';
import { ACHIEVEMENTS } from './achievements/achievements';
import { PLAYER_GOALS } from './goals/goals';
import { COMMUNITY_PROPOSALS } from './community/community';
import { COLLECTION_CATEGORIES } from './collection/categories';
import { TRAIN_ROUTES } from './transport/routes';
import { WEATHER_TABLE } from './probability/weather';

export const CONTENT_PACK: ContentPack = {
  items: ALL_ITEMS,
  crops: CROPS,
  fish: FISH,
  forageNodes: FORAGE_NODES,
  recipes: RECIPES,
  events: EVENTS,
  festivals: FESTIVALS,
  locations: LOCATIONS,
  trainRoutes: TRAIN_ROUTES,
  businesses: BUSINESSES,
  npcs: NPCS,
  dialogueTrees: DIALOGUE_TREES,
  furniture: FURNITURE,
  blueprints: BLUEPRINTS,
  achievements: ACHIEVEMENTS,
  playerGoals: PLAYER_GOALS,
  communityProposals: COMMUNITY_PROPOSALS,
  collectionCategories: COLLECTION_CATEGORIES,
  weatherTable: WEATHER_TABLE,
};

export type ContentModules = typeof CONTENT_PACK;
