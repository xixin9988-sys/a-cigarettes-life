import { describe, expect, it } from 'vitest';
import { UIManager } from '../../src/ui/UIManager';
import { UI_STYLES } from '../../src/ui/styles';
import { HudView } from '../../src/ui/HUD';
import { getPanelDefinition, panelSizeClass } from '../../src/ui/Panels';
import {
  buildMainMenu,
  buildCharacterCreation,
  buildSaveSlots,
  buildOfflineSummary,
  buildLifeReview,
  faceEmojiFor,
} from '../../src/ui/screens';
import { h, button, PanelBase } from '../../src/ui/widgets';
import type { PanelId } from '../../src/ui/UIInterfaces';

// This is a module-graph smoke test: the DOM-heavy UI cannot be rendered in node,
// but importing it must never touch document/window at module scope and the frozen
// contract surface must stay intact.

describe('UI module graph', () => {
  it('imports every UI module without browser globals at module scope', () => {
    expect(typeof UIManager).toBe('function');
    expect(typeof HudView).toBe('function');
    expect(typeof UI_STYLES).toBe('string');
    expect(UI_STYLES.length).toBeGreaterThan(10000);
    expect(typeof h).toBe('function');
    expect(typeof button).toBe('function');
    expect(typeof PanelBase).toBe('function');
    expect(typeof buildMainMenu).toBe('function');
    expect(typeof buildCharacterCreation).toBe('function');
    expect(typeof buildSaveSlots).toBe('function');
    expect(typeof buildOfflineSummary).toBe('function');
    expect(typeof buildLifeReview).toBe('function');
    expect(faceEmojiFor('smile')).toBe('🙂');
  });

  it('can construct UIManager with no arguments and starts unmounted', () => {
    const manager = new UIManager();
    expect(manager.getOpenPanels()).toEqual([]);
    expect(manager.isOpen('inventory')).toBe(false);
    expect(manager.isTyping()).toBe(false);
    expect(typeof manager.mount).toBe('function');
    expect(typeof manager.destroy).toBe('function');
    manager.destroy();
  });

  it('registers a definition for every non-HUD panel id with a size class', () => {
    const ids: PanelId[] = [
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
      'dialogue',
      'fishing',
      'probability',
      'help',
    ];
    for (const id of ids) {
      const definition = getPanelDefinition(id);
      expect(definition, id).not.toBeNull();
      if (!definition) continue;
      expect(definition.id).toBe(id);
      expect(definition.title.length).toBeGreaterThan(0);
      expect(typeof definition.create).toBe('function');
      expect(definition.size).toMatch(/normal|narrow|wide|full|left|dialogue/);
      expect(typeof panelSizeClass(definition.size)).toBe('string');
    }
    expect(getPanelDefinition('hud')).toBeNull();
  });

  it('implements every frozen IUIManager method', () => {
    const manager = new UIManager();
    const required: (keyof UIManager)[] = [
      'mount',
      'destroy',
      'update',
      'openPanel',
      'closePanel',
      'togglePanel',
      'isOpen',
      'getOpenPanels',
      'showNotification',
      'showOfflineSummary',
      'showLifeReview',
      'showCharacterCreation',
      'showSaveSlots',
      'showMainMenu',
      'hideMainMenu',
      'showMenuScreen',
      'setDialogueActive',
      'isTyping',
    ];
    for (const method of required) {
      expect(typeof manager[method], method).toBe('function');
    }
    expect(manager.constructor.length).toBe(0);
    manager.destroy();
  });
});
