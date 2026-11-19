DOMAIN: World, map, environment, weather, seasons, transport, world history (spec Agent 4 + Agent 2 world parts).

Read docs/agent_preamble.md, docs/PROJECT_BRIEF.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_RULES.md,
src/core/contracts.d.ts, src/data/schema.ts, src/core/WorldConfig.ts, src/data/locations/ids.ts,
src/core/WorldFactory.ts first.

FILES in src/world/: WorldManager.ts (class WorldSystem implements IWorldSystem, id 'world'), RegionManager.ts,
LocationManager.ts, MapManager.ts, EnvironmentSystem.ts, WeatherSystem.ts (implements IWeatherSystem),
SeasonSystem.ts, TransportSystem.ts, WorldHistory.ts (export addWorldHistory(world, partial) helper used by all
systems; cap at WORLD_CONFIG.simulation.maxHistoryEntries).

CONTENT DATA (replace stubs):
1) src/data/locations/locations.ts -> LOCATIONS: LocationDef[]:
   - All 25 Willowbrook exteriors and 20 Ashford exteriors from src/data/locations/ids.ts (LOC constants) with rich
     descriptions, map tiles (village layout: town centre middle, farm/forest west, station north, city grid for
     Ashford), width/height, connections (undirected graph, every exterior reachable; interiors connect only to their
     exterior), facilities, open hours, microclimate (indoor shelter 1/windExposure 0; cafes indoor; park half
     shelter; riverside windy; forest sheltered etc.), fishSpot on river/lake/riverside, forageTags, eventTags,
     theme/floorColor/accentColor, discoverable/secret flags (hidden garden, secret path, ancient well and warehouse
     basement are secret with clueRequirement).
   - Interior LocationDefs for every building the player can enter: id = interiorIdFor(exteriorId) from ids.ts,
     indoor=true, entranceFrom=exterior, connections=[exterior], facilities (shop counter, cafe, library shelves,
     museum, bed, kitchen, workbench, train platform etc.), businessId where a matching BIZ constant exists, sensible
     dimensions + colors. Include interior for home, cafe, bakery, flower shop, grocery, bookshop, post office,
     library, market stall, farm shop, train stations, warehouse, abandoned farmhouse, hidden garden shed, Ashford
     shop interiors, museum, cinema, cultural centre, office, apartments lobby.
   - Every business in src/data/shops/shops.ts must have a locationId pointing at an existing location (that file is
     written by the economy agent in parallel; check it when available and fix references).
2) src/data/probability/weather.ts -> WEATHER_TABLE: full 7x7 transition weight matrix per season
   (clear/cloudy/rain/storm/fog/snow/wind) with seasonal realism (snow winter only; storms rarer; fog autumn/winter;
   rows non-empty).
3) src/data/transport/routes.ts -> TRAIN_ROUTES: Willowbrook station <-> Ashford station both directions, departures
   06:00..22:00 every 2 hours plus a couple of express trips, durationMinutes 20-35, pricePence 350-600, unique ids.

SYSTEM BEHAVIOUR:
- WeatherSystem.init reads pack.weatherTable; update: every 4 in-game hours (config) transition using stream
  'world.weather' per-season markov chain; set environment weather/temperature/humidity/windSpeed/windDirection
  (drift), rainIntensity/fogDensity from WEATHER_PROFILES in WorldConfig; emit 'weather:changed'; keep recentWeather
  (last 10).
- SeasonSystem/EnvironmentSystem: derive season/day/year from clock; daylight curve from SEASON_DAYLIGHT_HOURS;
  gradual humidity/temperature interpolation; environment fields updated; no duplicate ownership.
- MapManager: build undirected adjacency from LOCATION defs; findPath (BFS/Dijkstra) used by map UI/transport; validate
  graph connectivity at init (log/throw if disconnected).
- WorldSystem: implements IWorldSystem (contracts). travelTo: only adjacent locations (interior<->entrance or exterior
  neighbours), must be unlocked; updates player.position (locationId, indoor from def, x/y = location centre in
  pixels), visitCount/lastVisit/discovered, emit 'location:changed'. discoverLocation/unlockLocation: sets
  discovered/unlocked, records world history, emits 'discovery:made', returns ActionResult (used by ExplorationSystem).
- Transport: getTrainSchedule computes next departures from routes+clock; buyTrainTicket (player must be at a station
  location interior/exterior, deduct money, create ticket); boardTrain (ticket departing within 30 game minutes, set
  activeRide); update advances ride: when clock passes arriveSimTime move player to destination station exterior,
  ticket used, activeRide cleared, emit location:changed + history.
- Calendar rollovers: detect day change in update; record season history; location condition slowly decays; recompute
  occupants from state.npcs at most every 5 in-game minutes.
- WorldHistory.addWorldHistory caps history and returns the entry.

TESTS in tests/world/: data validation (45 exteriors exist, graph fully connected, secret locations present, interior
entrance links valid, weather matrix rows valid, train routes reference real stations), deterministic weather
transitions for same seed, travel adjacency + interior exit, ticket lifecycle + arrival, day/night + season derivation.
Pass: npx vitest run tests/world. Fix your TS errors only.
