DOMAIN: Phaser 3 scenes, pixel-art rendering, weather/season/day-night FX, cigarette player rendering
(spec Agent 13 rendering half).

Read docs/agent_preamble.md, docs/PROJECT_BRIEF.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_RULES.md,
src/ui/UIInterfaces.ts, src/core/contracts.d.ts, src/data/schema.ts, src/data/locations/ids.ts first.

FILES:
- src/scenes/session.ts: module holding ISceneSession; export setSceneSession(session: ISceneSession): void and
  getSceneSession(): ISceneSession (throws if missing).
- src/scenes/config.ts: export createPhaserConfig(): Phaser.Types.Core.GameConfig. AUTO renderer, canvas parent
  'game-root', pixelArt true, no external assets, scene list [BootScene, PreloadScene, MainMenuScene, TownScene,
  CityScene, InteriorScene, LifeEndScene], scale RESIZE or FIT 1280x720, backgroundColor dark warm.
- src/scenes/BootScene.ts, PreloadScene.ts: procedurally generate all pixel-art textures with Phaser.Graphics ->
  generateTexture: player body parts (white/coloured body, brown filter, ember, smoke puff), NPC base sprites in several
  palettes, tiles (grass, dirt, road, stone, wood floor, water, indoor floor, wall), props (trees, bushes, flowers,
  bench, lamp, table, counter, bed, shelves, door, crates, fountain, train platform...), weather particles (rain drop,
  snowflake, fog blob, leaf). No network loading. Then start MainMenuScene.
- src/scenes/MainMenuScene.ts: animated menu background (drifting smoke/ember particles, village silhouette), calls
  session.ui.showMainMenu() on create; polls session.api.getState()/getScreen() in update; when screen becomes 'playing'
  start TownScene.
- src/scenes/BaseWorldScene.ts: abstract base managing current region/location rendering, player + NPC sprites, camera,
  input (WASD/arrows move player smoothly inside current location bounds, E interacts with nearest NPC/facility,
  ESC/I/M/J/K/L/B keys open panels through session.ui), day/night tint from world.environment.daylight, weather FX,
  season palette, ambient particles, scene transitions based on state.player.position.regionId/locationId and screen;
  update player position through session.api.dispatch({type:'move:position', x, y}) throttled so systems see it; speed
  affected by cigarette moisture/length (read-only).
- src/scenes/TownScene.ts / CityScene.ts: extend BaseWorldScene for willowbrook/ashford exteriors; render current
  exterior (grass/road/building props by LocationDef theme/kind), location edges as exits (walking into edge or clicking
  exit marker dispatches travel:to for connected exteriors), doors (E near door -> move:enter interiorIdFor(locationId)).
- src/scenes/InteriorScene.ts: render interior with walls/floor/facilities (shop counter, bed, kitchen, workbench,
  museum displays, train platform), door to exit (move:exit-interior), interactables dispatch: shop ->
  session.ui.openPanel('shop'), workbench -> openPanel('inventory'), kitchen -> openPanel('inventory'), bed ->
  dispatch({type:'time:rest',hours:8}), fishing spot -> dispatch fish:cast + openPanel('fishing'), museum display ->
  openPanel('collection'), train -> openPanel('map').
- src/scenes/LifeEndScene.ts: burnout animation (cigarette shortening to filter, final smoke, fade), then
  session.ui.showLifeReview(archivedLife); polls screen to return.
- src/scenes/controllers/PlayerSpriteController.ts: cigarette player with body colour/pattern, filter, face expression,
  limbs; dynamic shortening based on cigarette.lengthRatio; ember glow + smoke ParticleEmitter following wind
  (windDirectionDeg/windSpeed), rain => steam, moisture => droop, walk/idle/dialogue poses.
- src/scenes/controllers/NPCSpriteController.ts: NPC sprites with palette from NPCState.appearance, idle/walk bob,
  emotion bubble, interaction prompt, name label for majors, deterministic placement per npc id.
- src/scenes/controllers/WeatherFXController.ts: rain/snow/storm particle emitters, fog overlay, wind-swayed foliage,
  day/night tint + interior warm light, season palettes, lightning flashes.
- Optional src/render/*.ts pixel drawing helpers.

RULES:
- Phaser only in src/scenes/** (and src/render if needed). No game-state mutation except through session.api.dispatch.
  Never import game systems directly.
- Keep per-frame allocation low; reuse sprites; target 60fps with 20 NPCs.
- main.ts (Lead) owns the game loop: it calls api.tick(dt) and ui.update(state) every frame. Scenes only render + input;
  do not call api.tick.
- DOM panels are another agent's scope: use session.ui methods from UIInterfaces.ts; never edit src/ui/**.
- Tests: small headless tests for pure helper functions (wind vector, tile conversion, season palette) in
  tests/scenes/*.test.ts; don't boot Phaser in node.
- Verify npx tsc --noEmit; fix errors in your files only.
