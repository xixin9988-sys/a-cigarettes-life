# Project Brief - A Cigarette's Life / 《香烟的一生》

## The game
A complete 2D top-down, pixel-art life simulation sandbox for PC web. The player is an
anthropomorphic cigarette living in Willowbrook (English village) and Ashford City.
The world is a *living world*: it keeps running while the player is away. Nearly every
uncertain outcome is resolved by one unified deterministic probability engine. The
cigarette physically burns down (lengthRatio), soaks in rain, burns faster in wind,
produces ash (usable as potash fertiliser and crafting pigment), and eventually burns out.

Full requirements: the original `life.txt` design specification (2900 lines) and
`code_artifact.txt` (file tree + algorithm specs v3.0).
This brief distils the hard rules; read the relevant sections of those files for detail.

## Non-negotiable design decisions
1. **Real living world** - no gameplay is player-gated. NPCs work, socialise, shop, fall in
   love, fight, make friends without the player. Businesses trade, prices move, crops grow,
   weather changes, festivals happen, history accumulates in the background (LOD 2/3
   simulations in a Web Worker).
2. **One probability engine** - every uncertain decision goes through
   `IProbabilityEngine`. No `Math.random()` anywhere in `src/` (ESLint error). Each decision
   records context, candidate weights and selected result for replay/debugging. Random
   streams are independent (adding a draw in one stream must not perturb others).
3. **Special resident** - the player owns a home, can work any job, run businesses, build
   influence, has personal goals, relationships and a cigarette body. NPCs can refuse.
4. **Natural simulation** - no fake difficulty levels, no malicious random punishment.
   Negative outcomes must have traceable causes. Rare content needs no pity timer, but
   critical systems must never be permanently locked by an unlucky roll.

## Required systems (all must be real, integrated, saved)
- Probability engine (seeded SplitMix64 + Xoshiro128**, streams, conditions, modifiers,
  history, replay, debug stats).
- World simulation: real-time active LOD1, background LOD2 in Web Worker, offline LOD3
  in Web Worker with time-step aggregation and idempotent transaction lock.
- World/map: 25 Willowbrook + 20 Ashford exterior locations, interiors, weather (Markov
  chain per season), seasons, day/night, microclimate (shelter/wind/humidity/heat),
  train transport with timetable/tickets, discovery of secret locations.
- NPCs: >= 14 major NPCs with full profiles + 42 residents; 12 personality traits, 9 needs,
  6 emotions, goals, schedules, utility AI + probability decision, memories with
  Ebbinghaus decay and permanent important memories, NPC-NPC and NPC-player relationships
  (affinity/trust/intimacy/status), independent social life.
- Economy: market supply/demand prices, shops with stock/hours/owners/employees/customers,
  NPC budgets and spending, jobs and wages, player shop ownership, daily settlements,
  transactions, price clamps, no negative money.
- Gameplay: farming (till/plant/water/ash fertilise/harvest/greenhouse, offline growth),
  fishing (cast/wait/bite/tension minigame/catch/size/quality), foraging (seasonal nodes),
  exploration (probabilistic discovery, clues, secrets, photos), crafting (recipes,
  stations, quality, cigarette protection gear, ash products), cooking (recipes, buffs),
  building (greenhouse, home upgrades, farm facilities), housing (grid furniture placement,
  AABB collision, storage, paint/floor), collection/museum, 8 skills with XP from actions.
- Social: dialogue trees with conditions, chat/gift/help/invite, invitations, romance with
  confession/date/rejection, apologies, community proposals and resident support.
- Events: random/personal/community/festival events with conditions, weights, cooldowns,
  uniqueness, causal chains, world history; 10 seasonal festivals with activities.
- Life: cigarette physics (burn/wind/humidity/shelter/moisture/ash), 8 skills, career,
  personal goals, influence, achievements, letters, life archive, life review generated
  from real records, life end when lengthRatio reaches 0, multi-generation legacy
  (max 3 legacy items, world history persists, new life independent save state).
- Persistence: IndexedDB with versioned saves, ping-pong slots + FNV-1a checksums,
  crash recovery, autosave, manual save, export/import, offline idempotency lock,
  multiple life slots.
- UI/scenes: Phaser 3 pixel-art scenes (Boot, Preload, MainMenu, Town, City, Interior,
  LifeEnd), player cigarette rendering with dynamic shortening + ember particles + smoke
  wind reaction, weather/season/day-night FX, NPC sprites, full DOM UI (HUD, inventory,
  map, social, dialogue, shop, building, fishing minigame, skills, events, life archive,
  probability debug F12, settings). All data-driven, no fake buttons.
- Tests: vitest suites for probability determinism/distribution, worker/offline, NPC
  autonomy, economy stability, cigarette physics, farming/crafting consistency,
  persistence transactions, contract compliance, full life cycle integration.

## Deliverable quality bar
Every listed feature must be reachable by a player in the running game, cause real state
changes and survive save/load. Spinning placeholder screens, dead buttons, hardcoded
fake numbers or "coming soon" panels are failures. If something cannot be completed,
report it honestly rather than faking it.

## Tech stack (fixed)
TypeScript strict mode, Phaser 3.90, Vite 5, Web Workers, IndexedDB, Vitest 2, ESLint 9,
Prettier 3. No server, no cloud, no LLM runtime dependency, no network needed to play.
