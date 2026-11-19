DOMAIN: DOM UI overlay - HUD + all panels (spec Agent 13 UI half). You own src/ui/** EXCEPT
src/ui/UIInterfaces.ts (frozen contract - read/implement, never edit).

Read docs/agent_preamble.md, docs/PROJECT_BRIEF.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_RULES.md,
src/ui/UIInterfaces.ts, src/core/contracts.d.ts, src/data/schema.ts, src/core/format.ts, src/core/SharedTypes.ts,
src/core/TimeUtil.ts first.

FILES: src/ui/UIManager.ts (class UIManager implements IUIManager), styles.ts (injects a style block at mount), HUD.ts,
InventoryUI.ts, MapUI.ts, SocialUI.ts, DialogueUI.ts, ShopUI.ts, BuildingUI.ts, HousingUI.ts, FishingMiniGameUI.ts,
SkillUI.ts, EventUI.ts, LifeArchiveUI.ts, ProbabilityDebugUI.ts, SettingsUI.ts, CollectionUI.ts, LifePanel.ts,
JournalUI.ts, HelpUI.ts, widgets.ts (shared helpers). UIManager must implement IUIManager exactly. Export class
UIManager with a no-arg constructor.

REQUIREMENTS:
- Mount into #ui-root (already in index.html); interactive elements need pointer-events (root is pointer-events:none).
  No external assets/fonts/CDN: procedural CSS pixel-art styling (warm palette, borders, shadows), emoji/SVG icons
  allowed. Inject styles once.
- update(state) called every frame: update HUD efficiently (cache values; don't rebuild DOM every frame; rebuild open
  panel bodies only when data changed or on a ~200ms interval).
- HUD: cigarette visual bar (lengthRatio with ember/burn animation, moisture/dry/sheltered badges), burn rate, ash
  amount, time/date/season/weekday, weather + wind arrow + temperature, money (use formatMoney), current location name,
  player name, key hints, notifications area. Visible while playing.
- InventoryUI: item grid with quality/freshness/quantity, category filters, details pane, actions (use food/equipment,
  equip/unequip protection slots, drop, read book), collect ash button, crafting and cooking tabs (available recipes,
  input availability, craft buttons dispatch 'craft'/'cook'). Real data only.
- MapUI: two-region map drawn with SVG/CSS from LocationDef positions and unlocked state; current location marker; click
  adjacent location -> dispatch travel:to / move:enter; train timetable from
  api.getSystems().world.getTrainSchedule + buy ticket/board buttons; NPC markers for known NPCs; secret locations hidden
  until discovered; legend.
- SocialUI: known NPC list (met), affinity/trust/intimacy bars, status, memory summary, actions (talk -> dispatch
  dialogue:start, gift, help, invite activity, confess/date/apologise), invitations accept/decline, community proposals
  with requirements.
- DialogueUI: bottom dialogue box with NPC portrait (procedural), typewriter text (speed setting), choice buttons,
  keyboard 1-9, Esc end -> dispatch dialogue:choose/dialogue:end; setDialogueActive.
- ShopUI: business selector at current location, buy/sell two-column trade, quantity stepper, stock/money display;
  player shop management tab (set prices, restock, open/close, hire/fire, daily report); dispatch real transactions.
- BuildingUI: blueprints with material costs/availability, start project buttons, active projects progress.
- HousingUI: rooms, furniture placement mode with grid preview + collision feedback, furniture list from inventory,
  storage transfer, paint/floor swatches, comfort/decoration stats.
- FishingMiniGameUI: tension bar + progress bar + fish silhouette; hold mouse/space to reel (dispatch fish:reel
  {hold:true/false}), feedback messages, cancel; opens when state.fishing.session exists, closes when gone.
- SkillUI: 8 skills with level/XP bars, total level, goals progress + choose-goal buttons from
  api.getSystems().life.getAvailableGoals().
- EventUI: recent events log with category icons/importance, active festivals with participate buttons, notifications.
- LifeArchiveUI: current life timeline grouped by category, achievements grid, letters (read), photos, past lives list
  (api.getLifeArchive()) with ArchivedLife details; showLifeReview(archive) modal with highlight stats + next-life
  button (api.startNextLife with up to 3 legacy items).
- ProbabilityDebugUI: F12 toggles; seed, stream states (api.getProbabilityDebug()), decision history, candidate weight
  bars, probabilities, selected option, context JSON, stats.
- SettingsUI: volumes, speed 1x/2x/4x, autosave interval, keybinding remap (click + press key), reduced motion,
  probability debug toggle, save/list/delete slots, export/import; return to menu.
- JournalUI (J): event log + goals + offline summary history. CollectionUI: museum categories/progress/donate.
  LifePanel (L): cigarette condition detail, influence level, statistics, occupation, home, money, achievements.
- Main menu / character creation: showMainMenu() renders title screen buttons (New Life, Continue, Save Slots, Life
  Archives, Settings); hideMainMenu() removes. showCharacterCreation(onConfirm) renders name input, body/filter/preset
  colour pickers (HEX inputs + swatches), pattern/face selectors, live cigarette preview, optional seed field, confirm ->
  callback(NewGameOptions). showSaveSlots() modal listing api.listSaveSlots() with load/delete/import/export + new slot.
  showOfflineSummary(summary) modal (offline time, highlights, changes, important NPC updates, letters; dismiss ->
  api.acknowledgeOfflineSummary()). showMenuScreen toggles overlay visibility. Used by MainMenuScene.
- Keyboard shortcuts: I inventory, M map, K social, L life, J journal, B building, H housing, C collection, Esc closes,
  F12 probability debug, Tab help; ignore while typing in inputs.
- showNotification toasts with stacking + auto-dismiss. English UI text consistent with game data. Data-driven only; show
  ActionResult failures as notifications. Cheap update() when panels closed; clean up listeners in destroy().
- Verify npx tsc --noEmit (fix your files only). Add headless tests for pure helpers (formatting/filtering/diffing) in
  tests/ui/*.test.ts. DOM-heavy code must compile but need not be unit tested.
