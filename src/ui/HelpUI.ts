// =============================================================================
// Help panel: controls, panel guide, survival rules and lore-friendly tips.
// =============================================================================
import type { GameState } from '../core/contracts';
import { resolveShortcuts, UI_SHORTCUT_ACTIONS, UI_SHORTCUT_LABELS, influenceTier, type UiShortcutAction } from './model';
import { h, span, button, section, tabs, statTile, badge, PanelBase, type UiContext } from './widgets';
import type { PanelId } from './UIInterfaces';

type HelpTab = 'controls' | 'panels' | 'survival';

const PANEL_GUIDE: { id: PanelId; label: string; text: string; key: string }[] = [
  { id: 'inventory', label: 'Inventory & crafting', text: 'Everything you carry, your protection gear, recipes and the ash tray.', key: 'inventory' },
  { id: 'map', label: 'Map & travel', text: 'Both regions, walkable routes, secrets, trains and what is around you.', key: 'map' },
  { id: 'social', label: 'Social', text: 'People you know, relationship bars, memories, invitations and community projects.', key: 'social' },
  { id: 'life', label: 'Life', text: 'Your cigarette body, influence ladder, statistics and how to rest.', key: 'life' },
  { id: 'journal', label: 'Journal', text: 'World history, letters, life archive and the last offline summary.', key: 'journal' },
  { id: 'building', label: 'Building', text: 'Blueprints with real material costs and active projects.', key: 'building' },
  { id: 'housing', label: 'Home', text: 'Rooms, furniture placement on the grid, paint, floor, storage.', key: 'housing' },
  { id: 'collection', label: 'Collection', text: 'The museum catalogue, category progress and donations.', key: 'collection' },
  { id: 'skills', label: 'Skills & goals', text: 'Eight skills, personal goals and achievements.', key: 'skills' },
  { id: 'events', label: 'Events', text: 'Active events, the recent log, festival schedule and pending notifications.', key: 'help' },
  { id: 'settings', label: 'Settings', text: 'Speed, volume, key remapping, saves, export and import.', key: 'help' },
];

export class HelpPanel extends PanelBase {
  private tab: HelpTab = 'controls';

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
  }

  protected signature(state: Readonly<GameState>): string {
    return this.sig(this.tab, state.settings, state.player.influence, state.life.generation, state.meta.playTimeSeconds > 0);
  }

  protected render(): void {
    this.element.replaceChildren();
    this.element.appendChild(
      tabs(
        [
          { id: 'controls', label: 'Controls', icon: '⌨' },
          { id: 'panels', label: 'Panels', icon: '🗂' },
          { id: 'survival', label: 'Survival', icon: '🚬' },
        ],
        this.tab,
        (id) => {
          this.tab = id as HelpTab;
          this.rerender();
        }
      )
    );
    if (this.tab === 'controls') this.renderControls();
    else if (this.tab === 'panels') this.renderPanels();
    else this.renderSurvival();
  }

  private renderControls(): void {
    const shortcuts = resolveShortcuts(this.state.settings);
    const scene = section('On your feet', 'Phaser scene controls');
    const sceneRows: [string, string][] = [
      ['W A S D / arrow keys', 'walk around'],
      ['E', 'interact: talk to a nearby person, enter a building, use a facility'],
      ['SPACE', 'confirm; hold to reel while fishing'],
    ];
    for (const [keys, text] of sceneRows) scene.body.appendChild(helpRow(keys, text));
    this.element.appendChild(scene.element);

    const ui = section('Panels', 'click keys to open the panel');
    for (const action of UI_SHORTCUT_ACTIONS) {
      const line = h('div', 'ui-help-row');
      const keys = span('keys');
      keys.appendChild(h('span', 'ui-kbd-hint', shortcuts[action]));
      line.appendChild(keys);
      const label = span('ui-row-label', UI_SHORTCUT_LABELS[action]);
      line.appendChild(label);
      line.appendChild(
        button('open', () => this.ctx.openPanel(panelForAction(action)), { className: 'ui-button-small' })
      );
      ui.body.appendChild(line);
    }
    const escLine = h('div', 'ui-help-row');
    const escKeys = span('keys');
    escKeys.appendChild(h('span', 'ui-kbd-hint', 'ESC'));
    escLine.append(escKeys, span('ui-row-label', 'close a panel; from the world opens the menu'));
    ui.body.appendChild(escLine);
    const typeLine = h('div', 'ui-help-row');
    const typeKeys = span('keys');
    typeKeys.appendChild(h('span', 'ui-kbd-hint', '1-9'));
    typeLine.append(typeKeys, span('ui-row-label', 'pick a dialogue option'));
    ui.body.appendChild(typeLine);
    this.element.appendChild(ui.element);
    const note = section('Remapping');
    note.body.appendChild(
      h('div', 'ui-card-text', 'Every panel key can be rebound in Settings → Controls: click the key cap, then press the new key. Tab moves focus while a panel is open.')
    );
    this.element.appendChild(note.element);
  }

  private renderPanels(): void {
    const shortcuts = resolveShortcuts(this.state.settings);
    const guide = section('Panel guide');
    for (const entry of PANEL_GUIDE) {
      const card = h('div', 'ui-card');
      const head = h('div', 'ui-card-title');
      const key = entry.key as UiShortcutAction;
      head.append(document.createTextNode(entry.label + ' '));
      head.appendChild(badge(shortcuts[key] ?? '—', 'accent'));
      card.appendChild(head);
      card.appendChild(h('div', 'ui-card-text', entry.text));
      card.appendChild(button('Open ' + entry.label, () => this.ctx.openPanel(entry.id), { className: 'ui-button-small' }));
      guide.body.appendChild(card);
    }
    this.element.appendChild(guide.element);
  }

  private renderSurvival(): void {
    const state = this.state;
    const tier = influenceTier(state.player.influence);
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Generation', String(state.life.generation)),
      statTile('Days lived', state.life.ageDays.toFixed(1)),
      statTile('Influence', Math.round(state.player.influence) + ' — ' + tier.name),
      statTile('People met', String(state.player.statistics.npcsMet))
    );
    const intro = section('What you are');
    intro.body.appendChild(stats);
    intro.body.appendChild(
      h(
        'div',
        'ui-card-text',
        'You are a cigarette: a body of paper and tobacco with a small, stubborn flame. Your length only ever shrinks. ' +
          'Rain soaks you (a soaked cigarette cannot work), wind burns you faster, shelter and fire protect you. ' +
          'Your ash is valuable: collect it and use it as potash fertiliser or crafting pigment.'
      )
    );
    this.element.appendChild(intro.element);
    const rules = section('Rules of a burning life');
    const rulesList = h('div', 'ui-list');
    for (const text of [
      'lengthRatio falls with time and exertion. When it reaches zero, the life ends and a review is written.',
      'Moisture rises in rain and water, falls near fires and in dry shelter. Over 85% you are soaked.',
      'Wind increases your burn rate; an umbrella, windbreak or sheltered doorway helps.',
      'Ash accumulates as you burn. Collect it from the inventory; it improves crop quality and crafts.',
      'Skills grow from use; goals and achievements follow real statistics, not dialogue choices alone.',
      'The world runs even while you are away. Offline summaries list what changed.',
    ]) {
      rulesList.appendChild(h('div', 'ui-list-item', text));
    }
    rules.body.appendChild(rulesList);
    this.element.appendChild(rules.element);
    const about = section('About');
    about.body.appendChild(
      h('div', 'ui-card-text', "A Cigarette's Life · a living-world life simulation. The world is deterministic: every uncertain outcome goes through one seeded probability engine, so the same seed replays the same story.")
    );
    about.body.appendChild(button('Open the probability debugger (F12)', () => this.ctx.togglePanel('probability'), { className: 'ui-button-small' }));
    this.element.appendChild(about.element);
  }
}

function helpRow(keys: string, text: string): HTMLElement {
  const line = h('div', 'ui-help-row');
  const keyCell = span('keys');
  for (const part of keys.split(' ')) {
    keyCell.appendChild(h('span', 'ui-kbd-hint', part));
  }
  line.append(keyCell, span('ui-row-label', text));
  return line;
}

function panelForAction(action: UiShortcutAction): PanelId {
  const map: Record<UiShortcutAction, PanelId> = {
    inventory: 'inventory',
    map: 'map',
    social: 'social',
    life: 'life',
    journal: 'journal',
    building: 'building',
    housing: 'housing',
    collection: 'collection',
    skills: 'skills',
    help: 'help',
    debugProbability: 'probability',
  };
  return map[action];
}
