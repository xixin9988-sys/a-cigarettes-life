# Data Schema

Static content is defined in `src/data/**` and aggregated into a `ContentPack`
(`src/data/schema.ts`) which is validated by `ContentRegistry` at boot.

## Canonical IDs (never hardcode strings)
| File | Contents |
|---|---|
| `src/data/items/ids.ts` | `ITEM.*` for every item id (~234) |
| `src/data/locations/ids.ts` | `LOC.*` for 25 Willowbrook + 20 Ashford exteriors, `interiorIdFor()`, `regionOfLocation()` |
| `src/data/npcs/ids.ts` | 14 major NPC ids + 42 `resident_XX` ids |
| `src/data/shops/ids.ts` | `BIZ.*` for 22 businesses |
| `src/data/events/festivalIds.ts` | `FESTIVAL.*` for 10 festivals |

Interior locations use the convention `<exteriorId>_interior`.

## Content pack
```ts
interface ContentPack {
  items: ItemDef[]; crops: CropDef[]; fish: FishDef[]; forageNodes: ForageNodeDef[];
  recipes: RecipeDef[]; events: EventDef[]; festivals: FestivalDef[]; locations: LocationDef[];
  trainRoutes: TrainRouteDef[]; businesses: BusinessDef[]; npcs: NPCDef[];
  dialogueTrees: DialogueTree[]; furniture: FurnitureDef[]; blueprints: BlueprintDef[];
  achievements: AchievementDef[]; playerGoals: PlayerGoalDef[];
  communityProposals: CommunityProposalDef[]; collectionCategories: CollectionCategoryDef[];
  weatherTable: WeatherTransitionTable;
}
```

## Entity summaries
### ItemDef (`src/data/items/{core,nature,crafted,life}.ts`)
id, name, description, category (seed/produce/fish/material/tool/equipment/food/drink/furniture/
decor/clothing/book/collectible/gift/cigarette/recipe/misc), basePrice in pence, stackable,
maxStack, hasQuality, tags, giftTasteTags, effects, equipmentSlot, moistureProtection,
windProtection, burnRateMultiplier, toolSkill/toolTier, edible/nutrition, seedCropId, fishId,
furnitureId, unlocksRecipes, readSkill, visual {shape,color,accent}, rarity.
### LocationDef
id, name, regionId, kind (40+ kinds), description, indoor, entranceFrom, mapX/mapY, tile size,
connections (undirected graph), shelter/windExposure/humidityModifier/heatSource (microclimate),
openHour/closeHour, facilities, businessId, fishSpot, eventTags, forageTags, discoverable, secret,
clueRequirement, theme, colors.
### NPCDef
id, name, age, lifeStage, 12 personality traits (0..1), appearance, occupation, home/work
location, money, interests, goals, bio, dialogueTreeId, scheduleTemplate, initialRelationships,
major, romanceable, likes/dislikes.
### CropDef / FishDef / ForageNodeDef
Crops: seed+produce item, seasons, staged growth hours, water/temp/fertility needs, quality,
disease resistance, regrow hours, ash affinity, yield. Fish: habitats, seasons, hours, weather,
weight, size range, difficulty, value, bait tags, skill req. Forage nodes: location, item, seasons,
respawn hours, skill req, yield range.
### BusinessDef / JobDefSeed
Business: name/type/location/owner/money/reputation/markup/hours/stock/jobs. Jobs: title, wage
per hour (pence), shift hours, slots, skill requirement, playerAvailable.
### RecipeDef
category craft/cook, station, inputs, outputs, hours, skill, levelReq, unlock item, tags.
### EventDef / FestivalDef
Events: category, weight, conditions (season/weather/hour/day/locationTag/influence/skill/
occurrence/flag/probability), location tags, participants, cooldown, unique, duration, effects
(relationship/money/item/mood/history/worldFlag/chain/weather), importance. Festivals: season,
day, hour, duration, location, activities, interest tags.
### DialogueTree
Trees per major NPC (`dialogue_<npcId>`) + `dialogue_resident`; nodes with conditional text
variants, choices with conditions/effects/next/once; greetingByStatus fallbacks.
### FurnitureDef / BlueprintDef / AchievementDef / PlayerGoalDef / CommunityProposalDef
See `src/data/schema.ts` for full field contracts.

## Validation
`ContentRegistry.validate()` reports: duplicate ids; recipes referencing unknown items;
crops referencing unknown seed/produce; locations connecting to unknown locations or unknown
businesses; businesses at unknown locations or stocking unknown items; NPCs with unknown
home/work/dialogue; festivals at unknown locations; blueprints referencing unknown items.
Boot logs warnings; the content validation test asserts zero errors.