DOMAIN: Social relationships, dialogue, romance, gifts, invitations, community (spec Agent 10).

Read docs/agent_preamble.md, docs/PROJECT_BRIEF.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_RULES.md,
src/core/contracts.d.ts, src/data/schema.ts, src/data/npcs/ids.ts, src/data/locations/ids.ts,
src/core/RelationshipUtil.ts, src/core/InventoryUtil.ts, src/core/WorldConfig.ts first.

FILES in src/social/: SocialSystem.ts (class SocialSystem implements ISocialSystem, id 'social'), DialogueSystem.ts
(class DialogueSystem implements IDialogueSystem, id 'dialogue'), FriendshipSystem.ts, GiftSystem.ts, RomanceSystem.ts,
InvitationSystem.ts, CommunitySystem.ts.

CONTENT DATA:
1) src/data/dialogue/dialogue.ts -> DIALOGUE_TREES:
   - One rich tree per major NPC, id = 'dialogue_' + NPC id (ids in src/data/npcs/ids.ts; the NPC agent creates matching
     defs). Each tree >= 8 nodes with condition branches (affinity/trust/intimacy/status/weather/season/hour/flags/
     hasItem/probability), dynamic text variants, choices with effects (relationship, money, items, memory, flags, goals,
     influence), greetingByStatus. Give each NPC a distinctive voice: Marigold flowers, Otto baking, Sylvia cafe gossip,
     Harold postal routes, Eliza local history, Theo books, Clara plants, Finn water, Ada farming, Rufus warehouse,
     Penelope museum, Jasper music, Edmund town matters, Nina city life.
   - 'dialogue_resident' generic tree (>= 10 nodes, several branches, resident small talk/gossip referencing weather,
     season, the player's cigarette moisture) used by 42 residents.
   - Optional role trees ('dialogue_shopkeeper', 'dialogue_farmer', 'dialogue_artist'). Every npc.dialogueTreeId must
     resolve.
   Use ITEM constants for item ids; DialogueCondition/DialogueEffect types from src/data/schema.ts.
2) src/data/community/community.ts -> COMMUNITY_PROPOSALS: 8 defs (public garden, playground, market awning, library
   extension, bridge repair, festival stage, tree planting, street lamps) with locationId (LOC constants), costPence,
   influenceRequired, supportRequired, constructionHours, effects text.

SYSTEM BEHAVIOUR:
- SocialSystem (ISocialSystem): relationship utilities over player.relationships + npc.relationships using
  RelationshipUtil; talkTo(npcId): NPC must be at player's location, cooldown 1 game hour, personality/needs modified
  affinity+trust, NPC memory, emits 'npc:met'/'relationship:changed', statistics.conversations/npcsMet; giveGift(npcId,
  instanceId): consume item, taste match against likes/dislikes via item giftTasteTags + quality bonus, cooldown 12 game
  hours, relationship delta + memory, statistics.giftsGiven; helpNPC: cooldown, trust/affinity boost, chance NPC repays;
  inviteNPC(npcId, activity): acceptance probability from relationship/personality/weather/needs; creates
  InvitationState (pending, expires 24h) or immediate decline; getInvitations/accept/decline (accept adds relationship
  and logs; decline small penalty); confessTo: gate on affinity >= config confessThreshold/trust, romanceable NPC, not
  already dating; success probability influenced by personality/emotions; success => status 'dating' + permanent memory;
  failure => cooldown + slight penalty; goOnDate: requires dating status, cooldown, money cost, boosts intimacy/affinity,
  memories, chance NPC wants to become 'partner' at high intimacy; apologiseTo: reduces negative affinity, restores
  trust; proposeCommunityProject: checks influence + money + support -> CommunityProjectState voting; update resolves
  proposals (NPC votes via personality/relationship probability) -> approved (construction, completes after hours,
  effects/history) or rejected; getInteractionLog.
- NPC-initiated invitations: update (every ~2 game hours) samples friendly NPCs, creates pending invitations (cap 3,
  expires 24h), emits 'game:signal' {name:'invitation', data}; NPCs may invite the player to festivals.
- RomanceSystem: dating/partner transitions, breakups from low affinity/neglect, rejection cooldown, NPC autonomy
  (NPC may decline dates), personality compatibility factor.
- DialogueSystem: startConversation(npcId): fetch npc def dialogueTreeId + tree, create DialogueSessionState
  {treeId, rootNodeId}, return first node (evaluated variants); getCurrentNode: evaluate node variants, filter choices by
  conditions and once-used; choose(index): apply effects via helpers (relationship, money, item, memory, flags, goal,
  influence), follow next or end; endConversation. Award social skill XP. Write your own DialogueCondition evaluator.
- No DOM, no Math.random; streams 'social.interaction', 'social.romance', 'social.dialogue'; state in
  player.relationships/npc.relationships/memories/social slice; emit bus events; history via
  import { addWorldHistory } from '../world/WorldHistory' (read-only import).
- NPC-NPC social life is owned by the npc agent - do not duplicate; you own player-facing social.
- Performance: update tolerates large offline dt (hour buckets, expire invitations, resolve proposals, romance drift).

TESTS in tests/social/: gift preference/cooldown, talk affinity mechanics, romance rejection/success determinism,
dialogue navigation + condition filtering + effects, invitation lifecycle, community proposal voting/construction,
offline large-dt expiry. Pass: npx vitest run tests/social. Fix your TS errors only.
