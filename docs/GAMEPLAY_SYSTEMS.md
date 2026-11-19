# Gameplay Systems

All gameplay state lives in `GameState` slices (see contracts) and all randomness uses the
probability engine. Every player-visible action returns an `ActionResult`.

## Farming (`gameplay/FarmingSystem.ts`, `data/crops`)
Plots are keyed `locationId:x:y`. Actions: till (hoe), plant (seed item, season check), water
(watering can, moisture), fertilise (cigarette ash -> potash, compost -> fertility), harvest,
clear, build greenhouse. Growth advances with elapsed game hours scaled by water, temperature,
fertility; disease risk per hour; withering when dry. Harvest quality comes from skill, soil,
potash, weather and `farming.quality`; ash greatly improves quality for high-ash-affinity crops.
Greenhouses ignore season restrictions. Crops keep growing while offline.

## Fishing (`gameplay/FishingSystem.ts`, `data/fish`)
Cast at a water location with a rod (basic/good/master) and optional bait. Wait time and target
fish are weighted by habitat, season, hour, weather, bait, rod and skill on `fishing.results`.
Bite -> reeling mini-game: hold to raise progress and tension, release to lower tension; fish AI
pulses via `fishing.minigame`; tension 100 = escape, progress 100 = catch (size/quality recorded,
statistics, collection). Cannot hang: sessions auto-cancel on large offline steps.

## Foraging (`gameplay/ForagingSystem.ts`, `data/fish.forageNodes`)
Seasonal nodes across forest/park/orchard/farm/countryside; gathering checks season, skill and
depletion, rolls yield on `foraging.results`, sets respawn time and emits item events.

## Exploration (`gameplay/ExplorationSystem.ts`)
Searching a location (1 game hour cooldown) can find nothing, clues, items, photo opportunities or
secret discoveries based on skill, tags and clues via `exploration.discovery`. Secret locations
are unlocked through `IWorldSystem.unlockLocation` when requirements are met. Photos are stored in
the life archive and count toward collections.

## Crafting (`gameplay/CraftingSystem.ts`, `data/recipes`)
Recipe validation: station availability (workbench/kitchen/campfire/forge mapped sensibly, home
furniture can provide stations), skill level, known recipes, inputs. Crafting consumes inputs
atomically, queues a job with game-hour duration, then outputs items with quality derived from
input quality, skill and `crafting.quality`. Includes cigarette-protection gear and ash products.

## Cooking (`gameplay/CookingSystem.ts`)
Recipes produce food with quality/freshness; eating applies nutrition and temporary status effects
(energy, burn-slow, skill XP multipliers). Recipe books/items unlock new recipes.

## Building & housing (`gameplay/BuildingSystem.ts`, `HousingSystem.ts`)
Blueprints (rooms, greenhouse, farm facilities, home upgrades, store decoration) consume
materials over game hours and apply real effects (e.g. greenhouse places plots; rooms update the
home). Housing supports grid furniture placement with AABB collision and door-reachability
validation, rotation, painting, floors, storage transfer, furniture comfort/decor scores.

## Skills (`gameplay/SkillSystem.ts`)
Eight skills (gardening, fishing, foraging, exploration, crafting, cooking, socialising, artistry)
with XP from real actions, exponential level thresholds (max 20), status-effect XP multipliers and
level-up events. No grinding loop is required: any play style advances relevant skills.

## Collection & museum (`gameplay/CollectionSystem.ts`)
Items with collection tags register automatically on acquisition (fish, insects, minerals, flowers,
food, photos, festival items, life mementos). Museum donations consume the item, count toward
progress and influence.

## Social & romance (`social/`)
Player-facing social actions: talk, gift (taste matching + quality), help, invite, confess, date,
apologise, community proposals. NPC acceptance depends on personality, mood, trust and context.
Dialogue trees support conditional text variants, conditional choices, relationship/item/money/
memory/flag/influence effects. Romance has rejection/cooldown and can progress dating -> partner.
Community proposals are voted on by residents based on personality/relationships/influence and
then built over time.

## Events & festivals (`gameplay/EventSystem.ts`, `data/events`)
Weighted events are checked every 30 game minutes: random, personal, community, lucky/unlucky,
special, with conditions (season/weather/hour/location tags/influence/skill/occurrence/flags),
cooldowns and uniqueness. Effects mutate the world (money, items, relationships, moods, flags,
weather, chained events) and are recorded in world history. Ten seasonal festivals have defined
dates/locations/activities; participation rolls skill + probability for rewards and influence.
Events are capped per update so long offline periods produce summaries, not thousands of records.

## Cigarette physics & life (`life/`)
The player is a living cigarette:
- `lengthRatio` burns down with time (base lifetime `WORLD_CONFIG.cigarette.lifetimeGameHours`),
  accelerated by wind and exertion, slowed by moisture and rain; offline burn uses
  `offlineBurnMultiplier`.
- `moisture` rises in rain/humidity without protection, dries indoors/near heat/with desiccant;
  high moisture slows movement and prevents heavy work; soaked state triggers warnings.
- `ashAccumulated` grows with burning and can be collected into `cigarette_ash` (potash fertiliser,
  pigment/glaze material).
- Protection equipment (mini umbrella, waterproof case, windbreak screen, waxed coat, wind guard)
  registers moisture/wind/burn modifiers.
- At `lengthRatio <= 0` the life ends: `LifeArchiveSystem` builds an honest `ArchivedLife` from the
  real archive/statistics, and a new generation can inherit up to three mementos while the world
  and its history continue.

## Economy (`economy/`)
Dynamic market prices (supply/demand, seasonal factors, clamped 0.4-2.5x base), NPC customers with
budgets, business ownership/employees/wages, restocking and daily settlements, jobs for the player,
player-run shops with pricing/restocking/hiring/daily reports, atomic transactions with no negative
money. All settlements are idempotent by absolute sim-time markers.
