DOMAIN: Farming/nature, fishing, foraging, exploration (spec Agents 5 + 6).
ONLY write src/gameplay/FarmingSystem.ts, ForagingSystem.ts, FishingSystem.ts, ExplorationSystem.ts,
tests/gameplay/nature_*.test.ts, and the three data files.

Read docs/agent_preamble.md, docs/PROJECT_BRIEF.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_RULES.md,
src/core/contracts.d.ts, src/data/schema.ts, src/data/items/ids.ts, src/data/locations/ids.ts,
src/core/WorldConfig.ts, src/core/InventoryUtil.ts first.

FILES:
- src/gameplay/FarmingSystem.ts -> class FarmingSystem implements IFarmingSystem, id 'farming'.
- src/gameplay/ForagingSystem.ts -> class ForagingSystem implements IForagingSystem, id 'foraging'.
- src/gameplay/FishingSystem.ts -> class FishingSystem implements IFishingSystem, id 'fishing'.
- src/gameplay/ExplorationSystem.ts -> class ExplorationSystem implements IExplorationSystem, id 'exploration'.

CONTENT DATA:
1) src/data/items/nature.ts -> NATURE_ITEMS: ItemDef[] for every ITEM id in these groups (read ids.ts): seeds
   turnipSeed..cherrySapling, produce turnip..rosemary, fish fishTrout..junkBoot, raw materials wood, stone, ironOre,
   copperOre, silverOre, clay, feather, beetle, butterfly, wildBerries, wildMushroom, fibre, resin, wax, coal,
   charcoal, glassShard, scrapMetal, oldClue, hiddenKey, warehouseKey, gardenKey. Descriptions, balanced prices, tags,
   edible/nutrition, seedCropId/fishId links, visual colours/shapes.
2) src/data/crops/crops.ts -> CROPS: CropDef for 19 seed crops (turnip, carrot, potato, cabbage, tomato, onion,
   strawberry, pumpkin, sunflower, tulip, rose, lavender, wheat, barley, herbs + 4 fruit trees) with 3-5 growth stages
   (hours), seasons, water/temp/fertility requirements, baseQuality, diseaseResistance, regrowHours for berries/herbs/
   fruit trees, ashAffinity, baseYield, descriptions.
3) src/data/fish/fish.ts -> FISH: FishDef for 15 fish + junk boot (trout, salmon, carp, perch, pike, bass, eel, catfish,
   roach, bream, tench, chub, grayling, silverEel, moonfish, junkBoot) with habitats using LOC ids, seasons, hours,
   weathers, weights, sizes, difficulty, values, bait tags, skillReq, rarity. FORAGE_NODES: 25+ ForageNodeDef across
   forest/park/orchard/countryside/lake/river/abandoned farmhouse/greenhouse (mushrooms, berries, herbs, wood, stone,
   ore, insects, feathers) with seasons/respawns/skill requirements using LOC constants.

SYSTEM BEHAVIOUR:
- Farming: plots keyed locationId:x:y, only in valid farm/orchard/greenhouse/home-garden locations. tillPlot (requires
  hoe item in inventory, skill xp 'gardening'), plantSeed (seed removed via InventoryUtil, correct season check),
  waterPlot (watering can; moisture=1), fertilizePlot (ash consumes ITEM.cigaretteAsh and raises potash; compost raises
  fertility), growth update: elapsed game hours * water/temp/fertility factors * stage hours; disease risk per hour
  (stream 'farming.growth'), withering if dry too long; harvest when mature: produce quality from skill/soil/potash/
  weather/stream 'farming.quality', yield from baseYield + skill; add produce with quality/freshness, xp, statistics,
  emit 'crop:harvested' + 'item:acquired'; regrow crops reset growth; clearPlot; buildGreenhouse consumes
  ITEM.greenhouseKit + wood/glass and creates GreenhouseState + plots; greenhouse ignores season restrictions.
- Foraging: init creates ForageNodeState for each ForageNodeDef (id = defId + ':' + index) respawnAt=0; gather(nodeId)
  validates location/season/skill, depletes, yield via stream 'foraging.results', adds items, xp 'foraging', sets
  respawnAt, statistics, emit item:acquired; update respawns and daily resets.
- Fishing: castLine(locationId, rodInstanceId?, baitInstanceId?) requires location fishSpot + rod in inventory
  (basic/good/master), optional bait consumed, sets session {phase:'waiting', waitUntil, targetFishId selected via
  weighted probability using stream 'fishing.results' considering location/season/hour/weather/bait/skill/rod}.
  reel(hold) stores module-level holding flag; update: waiting -> bite (short window) -> reeling: tension rises while
  holding (WORLD_CONFIG.fishing), progress rises slower, fish stamina AI via stream 'fishing.minigame' every 0.5 sim
  second (module accumulator, no per-call randomness explosion); tension >= 100 => escaped; progress >= 100 => landed:
  quality/size (size range scaled by skill/weather), add fish item with meta {sizeCm}, statistics/fishSpeciesCaught/
  biggest, emit 'fish:caught' + item:acquired, clear session; no reel input for 4 sim seconds during reeling => escaped.
  Large dt (offline) must auto-cancel a session, never hang.
- Exploration: search(locationId) requires being at the location; cooldown 1 game hour per location; outcomes weighted
  via stream 'exploration.discovery' using skill/location tags/clues: nothing / clue (state.exploration.clues) / item
  / secret discovery / photo opportunity. unlockSecret(locationId): if clue requirement met, call world system
  unlockLocation via ctx.registry.getRequired<IWorldSystem>('world'), record, emit 'discovery:made' + world history,
  statistics.secretsFound++. takePhoto(locationId): requires camera, creates photo record in exploration state, xp art/
  exploration, statistics. getDiscoveryState returns per-location record.
- All four use ctx.registry.getRequired<ISkillSystem>('skill') for XP and InventoryUtil for items; emit bus events;
  persist in the corresponding GameState slices; no module-private authoritative state.
- Sim time: 1 game hour = 60 sim seconds, 1 game day = 1440 sim seconds.

TESTS tests/gameplay/nature_*.test.ts: crop growth over simulated hours incl. offline big dt, ash fertiliser improves
quality statistically, season gating, fishing full lifecycle deterministic (cast->wait->bite->reel->catch) and escape
on max tension, forage respawn, exploration outcomes + cooldown. Pass: npx vitest run tests/gameplay. Do not edit
CraftingSystem/CookingSystem/BuildingSystem/HousingSystem/CollectionSystem/SkillSystem (another agent owns them).
