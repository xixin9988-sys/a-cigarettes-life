# NPC System

## Population
- 14 major NPCs with unique personalities, homes, jobs, schedules, relationships, dialogue trees
  and life histories, plus 42 residents for a living population (`NPC_IDS` in
  `src/data/npcs/ids.ts`).
- Every NPC owns a complete `NPCState`: personality (12 traits), needs (9), emotions (6), mood,
  money, occupation/job, home/work/location, current activity + timing, relationships, memories,
  goals, schedule, interests, life history.

## Decision making (Utility AI + probability)
1. **Needs** decay every game hour (hunger, energy, social, fun, safety, belonging, money
   pressure, work pressure, purpose), modified by activities; emotions/mood drift toward a
   personality baseline and recent events.
2. **Candidates** are generated from time, location, money, needs and relationships: work, go
   home, sleep, eat, shop, stroll, read, fish, garden, visit a friend, go to the cafe, date,
   attend an event, rest, personal errand, look for work, travel.
3. **Utility** = sum(needUrgency * actionSatisfy) * personalityWeight * scheduleBonus *
   memoryInfluence. The top candidates are passed to `ProbabilityEngine.decide` on stream
   `npc.behavior`, so behaviour is plausible rather than deterministic.
4. The chosen action sets the activity, target location/NPC, duration and cooldown; execution
   updates needs, memory and location. Recent activities are penalised to avoid repetition.
5. Decisions are staggered (each NPC has a cooldown) and capped per update, so 56 NPCs over weeks
   of simulated time stay fast.

## Memory
`NPCMemoryState` with importance and emotional value. Strength decays exponentially
(`S(t) = I0 * e^(-delta * t)`, lambda from `WORLD_CONFIG.world.memoryDecayLambdaPerDay`);
memories below the short-term threshold are pruned. Importance >= 80 (or explicitly permanent)
is never forgotten. Strong memories bias future social decisions.

## Relationships
- Relationship vectors: affinity (-100..100), trust (0..100), intimacy (0..100), familiarity
  (0..100), status (stranger/acquaintance/friend/close_friend/rival/enemy/dating/partner/family/ex),
  interaction counters and cooldowns. Stored per NPC (`relationships`), including their view of
  the player; the player keeps their own view in `player.relationships`, which may be asymmetric.
- NPC-NPC social simulation runs in the background: co-located NPCs interact with probability,
  forming friendships, rivalries, romances and breakups without the player. Effects create
  memories and life-history events and are logged in `social.npcSocialLog`.
- Relationships slowly decay without contact; major memories prevent permanent amnesia.

## Schedules
`scheduleTemplate` entries (work, meals, leisure, sleep, hobbies) are expanded per day with an
adherence probability (stream `npc.schedule`), then the utility AI may override with needs-driven
behaviour. Schedules give NPCs recognisable routines while remaining flexible.

## Files
`src/npc/NPCSystem.ts`, `NPCDecisionEngine.ts`, `PersonalitySystem.ts`, `NeedSystem.ts`,
`MemorySystem.ts`, `ScheduleSystem.ts`, `RelationshipSystem.ts`, `SocialSimulation.ts`,
`NPCArchive.ts`; data in `src/data/npcs/npcs.ts`.
