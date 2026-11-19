DOMAIN: World events + festivals (spec Agent 11).

Read docs/agent_preamble.md, docs/PROJECT_BRIEF.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_RULES.md,
src/core/contracts.d.ts, src/data/schema.ts, src/data/locations/ids.ts, src/data/events/festivalIds.ts,
src/core/WorldConfig.ts first.

FILES: src/gameplay/EventSystem.ts -> class EventSystem implements IEventSystem, id 'events'.
Plus src/data/events/events.ts and tests/events/**.

CONTENT DATA src/data/events/events.ts -> EVENTS: 35+ EventDef[] and FESTIVALS: 10 FestivalDef[]:
- Event categories with spec weights (ordinary 45%, interesting 25%, lucky 15%, unlucky 10%, special 5%): random
  encounters, town news, weather events, market fluctuations, lost item found, neighbour needs help, stray animal, power
  cut, heatwave, storm damage, harvest surplus, community rumour, market bargain, travelling merchant, library book sale,
  festival preparations, personal letters, NPC birthday, wedding, breakup gossip, business boom/bust, ghost sighting,
  secret letter, hidden cache. Each with conditions (season/weather/hour/locationTag/minInfluence/minSkill/
  maxOccurrences/flag/probability), locationTags matching real LocationDef.eventTags (world agent writes those; use tags
  like market, cafe, forest, river, park, plaza, city, museum, festival, indoor), participants range, cooldownHours,
  unique, durationHours, effects (relationship/money/item/npc_mood/history/worldFlag/chainEvent/weather), importance, icon.
- FESTIVALS: the 10 ids in src/data/events/festivalIds.ts (springFlowers, summerMarket, autumnHarvest, winterLights,
  communityGathering, musicEvening, fishingContest, produceShow, artExhibition, cityCultureDay) with season/day/hour/
  duration/locationId (LOC constants), activities (fishing contest, garden show, art exhibition, market stall, music
  performance, costume parade), importance, npcInterestTags, visual.

SYSTEM BEHAVIOUR (IEventSystem):
- init: read eventSystem state.
- update: every WORLD_CONFIG.simulation.worldEventIntervalGameMinutes (30) roll global event occurrence (stream
  'events.occurrence'): compute eligible events (conditions evaluated against world environment/clock/player/location/
  cooldowns/occurrences/unique), pick category by weights then event by weight (ctx.probability), instantiate WorldEvent
  (id, type, category, title, description, occurredAt/createdAt, locationId from tags, participants from NPCs near
  location), apply effects to real state:
  * relationship: player<->participants or NPC-NPC deltas via RelationshipUtil
  * money: player or random NPC (integer pence, never negative)
  * item: add to player inventory via InventoryUtil
  * npc_mood: adjust NPC emotions/mood
  * history: append WorldHistoryEntry via addWorldHistory from ../world/WorldHistory
  * worldFlag: set state.world.worldFlags
  * chainEvent: roll nested event with sourceEventId/cause
  * weather: modify state.world.environment directly for temporary weather effects
  push to state.world.events (cap 400), history, emit 'event:occurred', add to pendingNotifications.
- Cooldowns: eventSystem.cooldowns[eventId] = availableAt sim time; occurrences count; uniqueTriggered.
- acknowledgeEvent: mark acknowledged, remove pending; getActiveEvents/getRecentEvents (newest first, cap);
  getEventSystemState.
- Festivals: update states by season/day/hour (upcoming -> active -> ended); on start emit 'festival:started' + history;
  participateFestival(festivalId, activityId): must be active, player at location, activity exists, once per festival;
  resolve with skill check + probability (stream 'events.festival'): success/reward money/items/relationship/influence/xp
  (ISkillSystem via registry), history, emit 'festival:participated', statistics.festivalsAttended. Update
  participantCount from NPCs at the location.
- triggerEventForTesting(eventId): force an event (no probability) and return ActionResult.
- Worker-safe, large dt tolerant (process in buckets, cap ~4 events per update, summarize offline).
- Emit 'event:occurred', 'festival:started', 'festival:participated', 'game:signal'.

TESTS in tests/events/: condition filtering, cooldown + uniqueness prevents repeats, effect application (money/item/
relationship/history/flags), chain event sourceEventId, festival lifecycle + participation reward, offline large-dt event
cap, determinism same seed. Pass: npx vitest run tests/events. Fix your TS errors only.
