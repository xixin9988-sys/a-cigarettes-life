import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installFakeDom, FakeElement, type FakeDom } from './domShim';
import { GameEngine } from '../../src/core/Game';
import { ContentRegistry } from '../../src/core/ContentRegistry';
import { CONTENT_PACK } from '../../src/data';
import { DEFAULT_APPEARANCE } from '../../src/core/WorldFactory';
import { addItemToInventory } from '../../src/core/InventoryUtil';
import { UIManager } from '../../src/ui/UIManager';
import type { ArchivedLife, OfflineSummary } from '../../src/core/contracts';
import type { PanelId } from '../../src/ui/UIInterfaces';

const PANEL_IDS: PanelId[] = [
  'inventory',
  'map',
  'social',
  'skills',
  'journal',
  'events',
  'shop',
  'building',
  'housing',
  'collection',
  'archive',
  'settings',
  'life',
  'help',
  'probability',
];

const content = new ContentRegistry(CONTENT_PACK);

function isVisible(element: FakeElement): boolean {
  let cursor: { parentNode: unknown } | null = element;
  while (cursor) {
    if (cursor instanceof FakeElement && cursor.classList.contains('ui-hidden')) return false;
    cursor = cursor.parentNode as { parentNode: unknown } | null;
  }
  return true;
}

function findButton(dom: FakeDom, label: string): FakeElement | null {
  const buttons = dom.findAll('button');
  return buttons.find((button) => isVisible(button) && button.textContent.includes(label)) ?? null;
}

function buildArchive(): ArchivedLife {
  return {
    lifeId: 'life_test',
    generation: 1,
    name: 'Ash',
    startedAt: 0,
    endedAt: 100000,
    durationDays: 27.4,
    endReason: 'burned down',
    residenceName: 'My Little Home',
    occupation: 'baker',
    skills: { gardening: 4, fishing: 2, foraging: 3, exploration: 1, crafting: 5, cooking: 3, social: 6, art: 2 },
    finalMoney: 12345,
    collections: [
      { itemId: 'turnip', count: 3 },
      { itemId: 'fish_trout', count: 1 },
    ],
    importantPeople: [{ npcId: 'npc_mayor', name: 'Mayor Bramble', status: 'friend', affinity: 55 }],
    businessHistory: ['Ran the bakery for 12 days'],
    archive: [
      {
        id: 'entry_1',
        at: 5000,
        category: 'milestone',
        title: 'First harvest',
        description: 'Pulled a turnip out of the wet earth.',
        importance: 3,
        participantIds: [],
      },
    ],
    photos: [],
    letters: [],
    worldChanges: ['The village green grew a new bench.'],
    choices: ['Chose to stay in Willowbrook'],
    legacyItemIds: [],
    statistics: {
      steps: 100,
      daysLived: 27,
      cropsHarvested: 4,
      fishCaught: 1,
      fishSpeciesCaught: {},
      fishBiggest: {},
      itemsForaged: 3,
      itemsCrafted: 2,
      mealsCooked: 5,
      itemsBought: 10,
      itemsSold: 2,
      moneyEarned: 5000,
      moneySpent: 4000,
      npcsMet: 6,
      conversations: 30,
      giftsGiven: 2,
      festivalsAttended: 1,
      photosTaken: 1,
      ashCollected: 3,
      furniturePlaced: 1,
      secretsFound: 0,
      businessesOwned: 0,
      shiftsWorked: 4,
    },
  };
}

function buildOfflineSummary(): OfflineSummary {
  return {
    fromSimTime: 0,
    toSimTime: 20000,
    realElapsedMs: 3_600_000,
    simulatedGameHours: 18,
    headline: 'The village woke without you and kept working.',
    changes: [
      { kind: 'relationship', description: 'Mayor Bramble asked after you.', importance: 2 },
      { kind: 'business', description: 'The bakery sold out of bread.', importance: 1 },
    ],
    newEvents: [],
    letters: [],
    highlights: ['A festival was announced.'],
    importantNpcUpdates: [{ npcId: 'npc_mayor', name: 'Mayor Bramble', description: 'Was seen smiling.' }],
  };
}

describe('DOM UI smoke test (headless fake DOM)', () => {
  let dom: FakeDom;
  let game: GameEngine;
  let ui: UIManager;
  let root: FakeElement;

  beforeAll(async () => {
    dom = installFakeDom();
    root = dom.document.createElement('div');
    root.id = 'ui-root';
    dom.document.body.appendChild(root);
    game = new GameEngine({ content });
    await game.init();
    const created = game.newGame({ playerName: 'Smoke Ash', appearance: DEFAULT_APPEARANCE, seed: 424242 });
    expect(created.ok, created.message).toBe(true);
    ui = new UIManager();
    ui.mount(root as unknown as HTMLElement, game);
  }, 60000);

  afterAll(() => {
    try {
      ui.destroy();
      game.destroy();
    } finally {
      if (dom) dom.uninstall();
    }
  });

  it('mounts the HUD, menu and notification systems', () => {
    expect(dom.find('.ui-hud')).not.toBeNull();
    expect(dom.find('.ui-panel-layer')).not.toBeNull();
    expect(dom.find('.ui-notify-layer')).not.toBeNull();
    ui.update(game.getState());
    ui.showNotification('A toast appears.', 'success');
    expect(dom.find('.ui-toast')).not.toBeNull();

    ui.showMainMenu();
    expect(dom.find('.ui-menu')).not.toBeNull();
    expect(dom.find('.ui-menu')?.textContent).toContain("A Cigarette's Life");
    ui.hideMainMenu();
  });

  it('opens, renders, cycles tabs and closes every panel', () => {
    for (const id of PANEL_IDS) {
      try {
        ui.openPanel(id);
        expect(ui.isOpen(id), id).toBe(true);
        ui.update(game.getState());
        const tabs = dom.findAll('.ui-tab');
        for (const tab of tabs) {
          dom.click(tab);
          ui.update(game.getState());
        }
        if (id === 'map') {
          const mapTab = dom.findAll('.ui-tab').find((tab) => tab.textContent.includes('Map'));
          if (mapTab) {
            dom.click(mapTab);
            ui.update(game.getState());
          }
          const nodes = dom.findAll('.map-node');
          expect(nodes.length).toBeGreaterThan(0);
          const first = nodes[0];
          if (first) {
            dom.click(first);
            ui.update(game.getState());
          }
        }
      } finally {
        ui.closePanel(id);
      }
      expect(ui.isOpen(id), id).toBe(false);
    }
    expect(ui.getOpenPanels()).toEqual([]);
  });

  it('auto-opens the dialogue panel, types text and handles keyboard choices', () => {
    const state = game.getState();
    const npc = Object.values(state.npcs).find((candidate) => candidate.alive);
    expect(npc).toBeDefined();
    if (!npc) return;
    const npcDef = content.getLocation(npc.locationId);
    if (npcDef) {
      state.player.position = {
        regionId: npcDef.regionId,
        locationId: npcDef.id,
        x: (npcDef.widthTiles * 32) / 2,
        y: (npcDef.heightTiles * 32) / 2,
        indoor: npcDef.indoor,
      };
    }
    const npcId = npc.id;
    const started = game.dispatch({ type: 'dialogue:start', npcId });
    expect(started.ok, started.message).toBe(true);
    try {
      ui.update(game.getState());
      expect(ui.isOpen('dialogue')).toBe(true);
      const dialogueText = dom.find('.ui-dialogue-text');
      expect(dialogueText).not.toBeNull();
      // Space skips the typewriter; a number key then picks the first choice.
      dom.dispatchKey('keydown', ' ');
      ui.update(game.getState());
      expect(ui.isTyping()).toBe(false);
      for (let index = 0; index < 3; index += 1) ui.update(game.getState());
      dom.dispatchKey('keydown', '1');
      ui.update(game.getState());
    } finally {
      game.dispatch({ type: 'dialogue:end' });
      ui.update(game.getState());
    }
    expect(ui.isOpen('dialogue')).toBe(false);
  });

  it('auto-opens the fishing minigame and supports hold/release input', () => {
    const state = game.getState();
    const rod = content.getAllItems().find((item) => item.toolSkill === 'fishing');
    const fishSpot = content.pack.locations.find((location) => location.fishSpot !== undefined && location.indoor === false);
    expect(rod).toBeDefined();
    expect(fishSpot).toBeDefined();
    if (!rod || !fishSpot) return;
    addItemToInventory(game.getState().player.inventory, rod.id, 1, { simTime: state.clock.simTimeSeconds, maxStack: 1 });
    const rodEntry = game.getState().player.inventory.find((entry) => entry.itemId === rod.id);
    state.player.position = { regionId: fishSpot.regionId, locationId: fishSpot.id, x: 32, y: 32, indoor: false };
    const cast = game.dispatch({
      type: 'fish:cast',
      locationId: fishSpot.id,
      ...(rodEntry ? { rodInstanceId: rodEntry.instanceId } : {}),
    });
    expect(cast.ok, cast.message).toBe(true);
    ui.update(game.getState());
    expect(ui.isOpen('fishing')).toBe(true);
    ui.update(game.getState());
    dom.dispatchKey('keydown', ' ');
    ui.update(game.getState());
    dom.dispatchKey('keyup', ' ');
    ui.update(game.getState());
    game.dispatch({ type: 'fish:cancel' });
    ui.update(game.getState());
    expect(ui.isOpen('fishing')).toBe(false);
  });

  it('shows and closes the offline summary, life review and character creation modals', () => {
    ui.showOfflineSummary(buildOfflineSummary());
    expect(dom.find('.ui-modal')).not.toBeNull();
    expect(dom.find('.ui-modal')?.textContent).toContain('While you were away');
    dom.dispatchKey('keydown', 'Escape');
    expect(dom.find('.ui-modal')).toBeNull();

    ui.showLifeReview(buildArchive());
    expect(dom.find('.ui-modal')?.textContent).toContain('The life of Ash');
    dom.dispatchKey('keydown', 'Escape');
    expect(dom.find('.ui-modal')).toBeNull();

    const captured: { playerName: string }[] = [];
    ui.showCharacterCreation((options) => {
      captured.push({ playerName: options.playerName });
      expect(options.appearance.bodyColor).toMatch(/^#[0-9a-f]{6}$/);
    });
    const modal = dom.find('.ui-modal');
    expect(modal).not.toBeNull();
    const nameInput = modal?.querySelector('input') ?? null;
    expect(nameInput).not.toBeNull();
    if (nameInput) nameInput.value = 'Teak';
    const lightButton = findButton(dom, 'Light it');
    expect(lightButton).not.toBeNull();
    if (lightButton) dom.click(lightButton);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.playerName).toBe('Teak');
  });

  it('handles keyboard shortcuts and the probability debugger toggle', () => {
    // Ensure the previous tests left no panel or modal open and the world is active.
    for (const id of [...ui.getOpenPanels()]) ui.closePanel(id);
    game.setScreen('playing');
    ui.hideMainMenu();
    ui.update(game.getState());
    dom.dispatchKey('keydown', 'i');
    expect(ui.isOpen('inventory')).toBe(true);
    dom.dispatchKey('keydown', 'Escape');
    expect(ui.isOpen('inventory')).toBe(false);

    dom.dispatchKey('keydown', 'F12');
    ui.update(game.getState());
    expect(ui.isOpen('probability')).toBe(true);
    expect(game.getState().settings.showProbabilityDebug).toBe(true);
    dom.dispatchKey('keydown', 'Escape');
    expect(ui.isOpen('probability')).toBe(false);
    expect(game.getState().settings.showProbabilityDebug).toBe(false);
  });

  it('dispatches real actions from panel buttons', () => {
    ui.openPanel('inventory');
    ui.update(game.getState());
    const itemCell = dom.find('.ui-item-cell');
    if (itemCell) {
      dom.click(itemCell);
      ui.update(game.getState());
    }
    for (const label of ['Use', 'Equip', 'Read']) {
      const actionButton = findButton(dom, label);
      if (actionButton) {
        dom.click(actionButton);
        ui.update(game.getState());
      }
    }
    ui.closePanel('inventory');

    ui.openPanel('life');
    ui.update(game.getState());
    try {
      const collect = findButton(dom, 'Collect ash');
      if (collect) dom.click(collect);
      ui.update(game.getState());
      const warm = findButton(dom, 'Warm up');
      if (warm) dom.click(warm);
      ui.update(game.getState());
    } finally {
      ui.closePanel('life');
    }

    ui.openPanel('map');
    ui.update(game.getState());
    try {
      const aroundTab = dom.findAll('.ui-tab').find((tab) => tab.textContent.includes('Around you'));
      if (aroundTab) {
        dom.click(aroundTab);
        ui.update(game.getState());
      }
      const search = findButton(dom, 'Search the area');
      if (search) dom.click(search);
      ui.update(game.getState());
    } finally {
      ui.closePanel('map');
    }
    expect(ui.getOpenPanels()).toEqual([]);
  });

  it('renders the save slot modal and the HUD money line from real state', async () => {
    const hud = dom.find('.ui-hud');
    expect(hud).not.toBeNull();
    ui.update(game.getState());
    expect(hud?.textContent).toContain('Ash');
    ui.showSaveSlots();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const modal = dom.find('.ui-modal');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('Save slots');
    dom.dispatchKey('keydown', 'Escape');
    expect(dom.find('.ui-modal')).toBeNull();
  });

  it('places furniture on the housing grid and buys from a shop', () => {
    const state = game.getState();
    // --- housing: add a real furniture item and place it through the grid ---
    const furnitureItem = content.getAllItems().find((item) => {
      const furnitureId = item.furnitureId;
      return furnitureId !== undefined && content.getFurniture(furnitureId) !== undefined;
    });
    expect(furnitureItem).toBeDefined();
    if (furnitureItem) {
      const playerHome = Object.values(state.housing.homes).find((candidate) => candidate.ownerId === state.player.id || state.housing.ownedHomeIds.includes(candidate.id));
      const homeDef = playerHome ? content.getLocation(playerHome.locationId) : undefined;
      if (homeDef) {
        state.player.position = {
          regionId: homeDef.regionId,
          locationId: homeDef.id,
          x: (homeDef.widthTiles * 32) / 2,
          y: (homeDef.heightTiles * 32) / 2,
          indoor: homeDef.indoor,
        };
      }
      addItemToInventory(state.player.inventory, furnitureItem.id, 1, { simTime: state.clock.simTimeSeconds, maxStack: 99 });
      ui.openPanel('housing');
      ui.update(state);
      try {
        const furnishTab = dom.findAll('.ui-tab').find((tab) => isVisible(tab) && tab.textContent.includes('Furnish'));
        if (furnishTab) {
          dom.click(furnishTab);
          ui.update(state);
        }
        const cell = dom.find('.ui-house-cell');
        if (cell) {
          dom.click(cell);
          ui.update(state);
        }
        const selectButton = findButton(dom, 'select');
        if (selectButton) {
          dom.click(selectButton);
          ui.update(state);
        }
        const placeButton = findButton(dom, 'Place here');
        expect(placeButton).not.toBeNull();
        if (placeButton && !placeButton.disabled) {
          dom.click(placeButton);
          ui.update(state);
        }
      } finally {
        ui.closePanel('housing');
      }
      const home = Object.values(state.housing.homes).find((candidate) => candidate.ownerId === state.player.id || state.housing.ownedHomeIds.includes(candidate.id));
      if (home) expect(home.furniture.length).toBeGreaterThan(0);
    }

    // --- shop: stand at a business and buy the first stock line ---
    const business = content.pack.businesses.find((candidate) => candidate.stock.length > 0);
    const businessState = business ? state.economy.businesses[business.id] : undefined;
    expect(businessState).toBeDefined();
    if (business) {
      const locationDef = content.getLocation(business.locationId);
      if (locationDef) {
        state.player.position = {
          regionId: locationDef.regionId,
          locationId: locationDef.id,
          x: (locationDef.widthTiles * 32) / 2,
          y: (locationDef.heightTiles * 32) / 2,
          indoor: locationDef.indoor,
        };
        state.clock.simTimeSeconds = 9 * 3600;
      }
      const before = state.player.statistics.itemsBought;
      ui.openPanel('shop');
      ui.update(state);
      const buyTab = dom.findAll('.ui-tab').find((tab) => isVisible(tab) && tab.textContent.includes('Buy'));
      if (buyTab) {
        dom.click(buyTab);
        ui.update(state);
      }
      const stockRow = dom.find('.ui-shop-row');
      if (stockRow) {
        dom.click(stockRow);
        ui.update(state);
      }
      const buyButton = dom.findAll('button').find((node) => node.textContent.startsWith('Buy ') && !node.disabled);
      if (buyButton) {
        dom.click(buyButton);
        ui.update(state);
      }
      ui.closePanel('shop');
      expect(state.player.statistics.itemsBought).toBeGreaterThan(before);
    }
  });

  it('survives many update frames while everything is closed', () => {
    for (let index = 0; index < 20; index += 1) ui.update(game.getState());
    expect(ui.getOpenPanels()).toEqual([]);
    expect(ui.isTyping()).toBe(false);
  });
});
