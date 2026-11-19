DOMAIN: NPC autonomous life (spec Agent 3).

Read docs/agent_preamble.md, docs/PROJECT_BRIEF.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_RULES.md,
src/core/contracts.d.ts, src/data/schema.ts, src/data/npcs/ids.ts, src/data/locations/ids.ts,
src/core/RelationshipUtil.ts, src/core/WorldConfig.ts first.

FILES in src/npc/: NPCSystem.ts (class NPCSystem implements INPCSystem, id 'npc'), NPCDecisionEngine.ts,
PersonalitySystem.ts, NeedSystem.ts, MemorySystem.ts, ScheduleSystem.ts, RelationshipSystem.ts, SocialSimulation.ts,
NPCArchive.ts (optional NPC.ts types).

CONTENT DATA src/data/npcs/npcs.ts -> NPCS: NPCDef[]:
- 14 major NPCs from NPC constants in src/data/npcs/ids.ts (Marigold the florist, Otto the baker, Sylvia cafe owner,
  Harold postman, Eliza retired librarian, Theo bookshop owner, Clara botanist, Finn fisherman, Ada farmer, Rufus
  warehouse keeper, Penelope museum curator, Jasper barista/musician, Edmund community chair, Nina office worker).
  Rich bios, ages/life stages, 12 personality traits with real variation, appearance colours, occupation, home/work
  locations using LOC constants from src/data/locations/ids.ts, schedules (startHour/endHour/activity/locationId/days/
  adherence covering believable daily routines: sleep, breakfast, commute, work, lunch, socialise, home, hobbies),
  initialRelationships among majors (friendships, family, a rivalry, a couple), likes/dislikes gift tags, goals,
  interests, romanceable flags, dialogueTreeId = 'dialogue_' + id (the social agent creates matching trees).
- 42 residents (ids RESIDENT_NPC_IDS): varied names, ages, personalities, occupations (shop assistant, teacher,
  student, retiree, artist, nurse, mechanic...), home/work LOC ids, schedules, some initial relationships,
  dialogueTreeId = 'dialogue_resident', major=false. A believable Willowbrook/Ashford population.

SYSTEM BEHAVIOUR:
- NPCState creation is done by WorldFactory from defs; your init ensures consistency (assign jobId matching economy
  jobs where possible by reading state.economy.jobs/businesses; set locationId to a schedule-appropriate location;
  initialise schedule.lastPlannedDay).
- NeedSystem: decay needs per game hour from WORLD_CONFIG.needs.decayPerGameHour with activity modifiers; clamp 0..100.
  Update emotions/mood toward a baseline influenced by needs + events.
- ScheduleSystem: combine scheduleTemplate with adherence roll (stream 'npc.schedule') into today's planned activities;
  compute current expected activity by time; utility AI may override.
- PersonalitySystem: map 12 traits to behavioural weights (extroversion/socialNeed -> social, workTendency/
  responsibility -> work, adventure/curiosity -> explore/outdoors, spendingTendency -> shopping, artisticTendency -> art).
- NPCDecisionEngine: candidate actions (work, go_home, sleep, eat, shop, stroll, read, fish, garden, visit_friend,
  go_cafe, date, attend_event, rest, personal_errand, look_for_work, travel) with conditions (time/location/money/needs/
  relationship), utility = sum(needUrgency * satisfy) * personalityWeight * scheduleBonus * memoryInfluence; take top ~5;
  pick via ctx.probability.decide with stream 'npc.behavior'. NEVER plain random. Record last decision for debug.
- Execute decision: choose target location (schedule/home/work/social target), move NPC (locationId), set
  currentActivity/activityStartedAt/activityEndsAt/activityTarget*, apply need changes on completion (eating reduces
  hunger, sleeping restores energy, working raises workPressure), activityHistory (max 8), decisionCooldownUntil
  (10-40 game minutes, staggered by hash).
- NPCs spend money only through economy (do not mutate npc.money except wages handled by economy; do not mutate economy).
- SocialSimulation: every ~15 in-game minutes co-located NPC pairs interact with probability (stream 'npc.social'):
  apply affinity/trust/intimacy deltas via RelationshipUtil (asymmetry allowed), create memories, occasionally form
  friendship/romance/conflict/breakup (status changes), append to state.social.npcSocialLog (cap 200) and NPC
  lifeHistory. NPCs MUST form relationships without the player.
- MemorySystem: create/decay memories (exponential decay lambda from config; importance >= 80 permanent; recall boosts);
  memory strength influences decision weights; cap memories per NPC (60, keep permanent).
- RelationshipSystem: helpers for NPC-NPC + NPC-player decay (no interaction for days -> familiarity/affinity drift),
  status refresh.
- NPCArchive: record notable NPC life events to lifeHistory (first friend, new job, breakup, festival) and memories.
- Performance: update may receive huge dt (offline catch-up) -> process hour buckets, stagger decisions, cap ~8 decisions
  per update call, early exits. 56 NPCs over 30 game days in a few seconds.
- Emit 'npc:activity' on activity/location changes; 'relationship:changed' for meaningful NPC-NPC changes (kind 'npc_npc').

TESTS in tests/npc/: data integrity (14 majors + 42 residents, valid locations, schedules), needs decay/restore,
personality influences decision distribution (compare aggregated choices for high-extrovert vs high-work NPCs),
memory decay/permanent, NPC-NPC friendship/romance emerges over 10-20 simulated days, no endless identical activity,
large-dt catch-up performance. Pass: npx vitest run tests/npc. Fix your TS errors only.
