DOMAIN: Player life, cigarette physics, identity, influence, archive, achievements, goals, multi-generation
legacy (spec Agent 12).

Read docs/agent_preamble.md, docs/PROJECT_BRIEF.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_RULES.md,
src/core/contracts.d.ts, src/data/schema.ts, src/core/WorldConfig.ts, src/data/items/ids.ts, src/core/InventoryUtil.ts,
code_artifact.txt module 8 (cigarette physics formulas) first.

FILES in src/life/: LifeSystem.ts (class LifeSystem implements ILifeSystem, id 'life'), CigarettePhysicsSystem.ts,
PlayerIdentitySystem.ts, InfluenceSystem.ts, LifeArchiveSystem.ts, GenerationSystem.ts, AchievementSystem.ts.

CONTENT DATA:
1) src/data/items/life.ts -> LIFE_ITEMS: ItemDef for every cigarette-care / ash-product id in src/data/items/ids.ts:
   miniUmbrella, waterproofCase, windbreakScreen, waxedPaperCoat, brassWindGuard, cigaretteHolder, filterExtender,
   desiccantPack, windproofLighter, matches, handWarmer, ashTray, ceramicAshPot, cigaretteAsh, ashFertilizer, ashGlaze,
   paintPigment. Include equipmentSlot for wearables, moistureProtection/windProtection/burnRateMultiplier values,
   effects for warming/desiccant, prices, colours. These item defs must exist because shops reference them.
2) src/data/achievements/achievements.ts -> ACHIEVEMENTS: 25+ AchievementDef with real triggers (first fish, 10 fish,
   perfect crop, 5 friendships, romance partner, own business, 10k pence, all secrets, 20 species collected, ash used 50
   times, survive 7 days, 3 festivals, community project, max skill, bake a cake, catch moonfish...), hidden flags,
   influence rewards.
3) src/data/goals/goals.ts -> PLAYER_GOALS: 15+ PlayerGoalDef (renowned gardener/fisher/collector/merchant/artist/
   community pillar/traveller/hermit, raise 5 perfect crops, catch 10 species, own a shop, decorate home to 80 decor,
   befriend 8 residents...) with triggers and rewards.

SYSTEM BEHAVIOUR:
- CigarettePhysicsSystem: pure update called from LifeSystem.update(dtSimSeconds). Use code_artifact module 8 formulas
  adapted to WORLD_CONFIG.cigarette. Inputs: microclimate via ctx.registry.getRequired<IWorldSystem>('world').
  getMicroclimate(player.position.locationId), environment weather/wind/humidity/temperature, equipment protections (read
  player.equipment slots -> ItemDef moistureProtection/windProtection/burnRateMultiplier), status effects, module-level
  exertion (public setExertion(level 0..1) called by Game/dispatch). Update moisture gain in rain/high humidity when
  unprotected, drying indoors/heat/heat source/desiccant/handWarmer; burnRate = base * (1 + 0.8 * windSpeed * (1 -
  windProtection)) * exertionFactor * (1 - 0.4 * moisture) with weather burn multipliers; lengthRatio -= burnRate *
  dt (base: 1 / lifetimeGameHours per game hour => per sim second divide by 60); ash += ashPerLengthUnit per 0.01 burned
  up to maxAsh; totalBurned; isSheltered. Clamp all. Emit 'cigarette:state' every ~5 sim seconds and
  'cigarette:warning' throttled (soaked >= 0.85, moisture > 0.3, near burnout lengthRatio < 0.15, ash full).
  Public getMoveSpeedMultiplier(): 1 - 0.5 * max(0, moisture - 0.3), and 0.75 near burn-out. At lengthRatio <= 0 the
  life ends.
- LifeSystem: init wires events; update: ageDays += dt / 1440 (1440 sim seconds per game day); call physics; process
  warnings; achievements/goal progress; readLetter; collectAsh(): converts cigarette.ashAccumulated into ITEM.cigaretteAsh
  inventory entries (integer, cap), resets, emits item:acquired + statistics.ashCollected; warmUp(source): heat source
  location or handWarmer/desiccant item reduces moisture; customizeAppearance; choosePersonalGoal from PLAYER_GOALS;
  getArchive/getAchievements/getLifeReview; endLife(reason): set life.phase 'ended', build ArchivedLife, emit
  'life:ended', guard double-ending. On death do not delete state - Game handles screen.
- LifeArchiveSystem: recordLifeEvent(state, partial) helper (cap 400; archive importance >= threshold). Listen to bus
  events: 'fish:caught', 'crop:harvested', 'discovery:made', 'relationship:changed' (major status upgrades),
  'event:occurred' (importance >= 3), 'festival:participated', 'achievement:unlocked', 'goal:completed',
  'letter:received', 'item:acquired' (rare only), 'game:signal'. Entries must describe real events only.
- InfluenceSystem: gainInfluence(amount, reason) adds player.influence/communityPoints, emits; thresholds
  (0 new resident, 50 known, 150 respected, 400 pillar, 800 legend) for UI.
- AchievementSystem: checks triggers from data against statistics/state/skills/collection/relationships/wealth on events
  and every game hour; unlock once, state.life.achievements, reward influence, emit 'achievement:unlocked', archive.
- GenerationSystem: buildArchivedLife(state, content): ArchivedLife from real records (archive, stats, important people
  by affinity, skills, collections, business history, photos, letters, worldChanges from world.history importance >= 4,
  choices, selected legacyItemIds). getLegacyOptions(archive): up to 3 memento candidates (collectible/memorabilia tags,
  plus current inventory keepsakes). applyLegacyItems(state, itemIds): adds chosen items with meta legacy=true.
  Public methods the Game will call: buildArchivedLife(state): ArchivedLife | null; getLegacyOptions(archive):
  { itemId: string; name: string }[]; applyLegacyItems(state, itemIds: string[]): void.
- PlayerIdentitySystem: appearance validation (hex colours, pattern/face), name display helpers, occupation.
- Extra public methods on LifeSystem: setExertion(level: number): void; getMoveSpeedMultiplier(): number;
  getLifeReview(): ArchivedLife | null.
- Sim time helpers: 1 game hour = 60 sim seconds, 1 day = 1440 sim seconds. Streams 'player.cigarettePhysics',
  'life.ash', 'life.archive', 'player.opportunities'. Worker-safe, no DOM.

TESTS in tests/life/: burn math over 1/7/14 game days vs config, rain/wind/shelter moisture+burn effects, equipment
protection, ash conversion + collection, warning thresholds, life end at 0 + archived life honesty, legacy limit 3,
achievement unlock, goal progress. Pass: npx vitest run tests/life. Fix your TS errors only.
