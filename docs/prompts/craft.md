DOMAIN: Crafting, cooking, building, housing, collection, skills (spec Agents 7 + 8).
ONLY write the six listed system files, tests/gameplay/craft_*.test.ts, housing_*.test.ts, skill_*.test.ts,
and the five data files.

Read docs/agent_preamble.md, docs/PROJECT_BRIEF.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_RULES.md,
src/core/contracts.d.ts, src/data/schema.ts, src/data/items/ids.ts, src/data/locations/ids.ts,
src/core/WorldConfig.ts, src/core/InventoryUtil.ts first.

FILES:
- src/gameplay/SkillSystem.ts -> class SkillSystem implements ISkillSystem, id 'skill' (no dependencies).
- src/gameplay/CraftingSystem.ts -> class CraftingSystem implements ICraftingSystem, id 'crafting'.
- src/gameplay/CookingSystem.ts -> class CookingSystem implements ICookingSystem, id 'cooking'.
- src/gameplay/BuildingSystem.ts -> class BuildingSystem implements IBuildingSystem, id 'building'.
- src/gameplay/HousingSystem.ts -> class HousingSystem implements IHousingSystem, id 'housing'.
- src/gameplay/CollectionSystem.ts -> class CollectionSystem implements ICollectionSystem, id 'collection'.

CONTENT DATA:
1) src/data/items/crafted.ts -> CRAFTED_ITEMS: ItemDef[] for processed materials (glass, cloth, leather, paper, ink,
   paint, ceramic, brass, plank, brick, nail, compost, fertilizer, candleWax, beeswax, oil), furniture items (bedSimple,
   bedComfortable, tableWood, chairWood, sofaComfy, bookshelf, wardrobe, storageChest, fireplace, rugWarm, floorLamp,
   pottedPlant, wallPainting, kitchenCounter, stove, workbenchHome, displayCase, gardenBench, pictureFrame, wallClock,
   vaseFlowers, candleHolder, mirror, curtain, windChime), building/garden items (greenhouseKit, fencePicket, flowerBed,
   birdBath, stonePath), crafted tools (fishingRodGood, fishingRodMaster) and any ITEM id in those groups that neither
   nature nor economy nor life owns (check src/data/items/*.ts; READ them before finalising).
2) src/data/recipes/recipes.ts -> RECIPES: 30+ craft recipes (tools, furniture, greenhouse kit, fertilizer, paint,
   gifts, cigarette protection gear) and 25+ cooking recipes (soups, pies, cakes, sandwiches, salads, stews, teas,
   coffees, jams) referencing existing item ids. Each with station, inputs, outputs, hours, skill, levelReq, tags.
   All referenced item ids MUST exist in an items data file - read src/data/items/*.ts first; if missing, choose an
   existing id or report to Lead.
3) src/data/furniture/furniture.ts -> FURNITURE: FurnitureDef for every furniture item id (slot, tiles, storageSlots,
   comfort, decor, tags, visual).
4) src/data/blueprints/blueprints.ts -> BLUEPRINTS: 12+ blueprints (extra room, greenhouse, farm shed, garden expansion,
   kitchen upgrade, workshop, shop counter, bedroom expansion, conservatory, store decoration...) with material inputs
   (existing ids), buildHours, skill, levelReq, effects text, kind.
5) src/data/collection/categories.ts -> COLLECTION_CATEGORIES: fish/insects/minerals/flowers/plants/food/recipes/photos/
   festival items/life mementos with itemTags matching tags you use in ItemDefs.

SYSTEM BEHAVIOUR:
- SkillSystem: level curve from WORLD_CONFIG.skill (baseXpToLevel 60, growth 1.18, maxLevel 20); addXp(skill, amount,
  source) applies xp multiplier from player status effects; levels up and emits 'game:signal' {name:'skill:levelup',
  data}; getProgress/getLevel/canUse.
- CraftingSystem: getAvailableRecipes(category) filters by station facilities at player location (workbench/kitchen/
  campfire/forge/art_studio), skill level, known recipes, inputs; canCraft returns ActionResult explaining missing
  inputs/stations/level. craft(recipeId, quantity): validate and consume inputs atomically, create CraftJobState with
  completesAt = now + hours*60 sim seconds, xp; update completes due jobs: output quality = clamp(round(avgInputQuality *
  0.6 + skillLevelFactor * 0.3 + rng('crafting.quality') * 0.1), 1, 5) (document exact formula), add outputs via
  InventoryUtil, mastery++, statistics.itemsCrafted, emit item:acquired + game:signal. Recipe unlock items via
  RecipeDef.unlockItemId on item:acquired add known recipes.
- CookingSystem: cook recipes with kitchen/campfire; known recipes from player.knownRecipes + unlock items; outputs food
  with quality/freshness; apply food effects through player.statusEffects and CookingState.buffs (persisted), cap
  durations; statistics.mealsCooked.
- BuildingSystem: getAvailableBlueprints; startProject(blueprintId, locationId): blueprint exists, player at location
  or owns home, consume inputs, create BuildProjectState completesAt = now + buildHours*60; update completes: mark
  complete, apply effects: greenhouse -> adds GreenhouseState + 4-6 FarmPlotState plots to state.farming (coordinate
  with farming data model), rooms/workshop -> housing upgrades/completedProjects; emit history/game:signal; statistics.
- HousingSystem: home lookup (WorldFactory creates state.housing.homes['home_player']); placeFurniture(itemInstanceId,
  x, y, rotation): furniture item in player inventory, def exists, room bounds, AABB collision against placed furniture,
  and doorway tile remains reachable (BFS over free tiles), consume item, add PlacedFurnitureState, recompute comfort/
  decor, statistics.furniturePlaced; removeFurniture returns item; paintWall/setFloorStyle; storeItem/takeItem between
  player.inventory and home.storage; addRoom via room blueprint. Recompute comfort/decor with diminishing returns.
- CollectionSystem: totalSpeciesKnown from collectible items; listen 'item:acquired' -> register item if its category/tags
  match a collection category (entries count/bestQuality/donated; emit 'game:signal' on first collection);
  donateToMuseum(itemId): player at Ashford museum location + item in inventory, mark donated, consume item,
  donatedCount++, history, small influence; getProgress known/total/donated.

TESTS: skill curve; craft atomic consumption + quality range; cooking buffs; build completion effects; housing collision/
path rejection + remove returns item; collection registration + donation. Pass: npx vitest run tests/gameplay. Do not
edit the nature agent's files (Farming/Foraging/Fishing/Exploration). Fix your TS errors only.
