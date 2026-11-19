// =============================================================================
// Settings panel: speed, audio, text, accessibility, key remapping, saves, data.
// =============================================================================
import type { GameSettings, GameState } from '../core/contracts';
import {
  resolveShortcuts,
  shortcutBindingKey,
  normaliseKeyName,
  UI_SHORTCUT_ACTIONS,
  UI_SHORTCUT_LABELS,
  DEFAULT_UI_SHORTCUTS,
  type UiShortcutAction,
} from './model';
import {
  h,
  span,
  button,
  badge,
  empty,
  section,
  tabs,
  statTile,
  PanelBase,
  type UiContext,
} from './widgets';

type SettingsTab = 'general' | 'audio' | 'controls' | 'saves' | 'data';

export class SettingsPanel extends PanelBase {
  private tab: SettingsTab = 'general';
  private listening: UiShortcutAction | null = null;
  private captureHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
  }

  protected signature(state: Readonly<GameState>): string {
    return this.sig(this.tab, this.listening, state.settings, state.meta.savedAt, state.meta.playTimeSeconds > 0);
  }

  protected render(): void {
    this.element.replaceChildren();
    this.element.appendChild(
      tabs(
        [
          { id: 'general', label: 'General', icon: '⚙' },
          { id: 'audio', label: 'Audio', icon: '🔊' },
          { id: 'controls', label: 'Controls', icon: '⌨' },
          { id: 'saves', label: 'Saves', icon: '💾' },
          { id: 'data', label: 'Data', icon: '🗄' },
        ],
        this.tab,
        (id) => {
          this.tab = id as SettingsTab;
          this.rerender();
        }
      )
    );
    if (this.tab === 'general') this.renderGeneral();
    else if (this.tab === 'audio') this.renderAudio();
    else if (this.tab === 'controls') this.renderControls();
    else if (this.tab === 'saves') this.renderSaves();
    else this.renderData();
  }

  private updateSettings(partial: Partial<GameSettings>): void {
    this.ctx.dispatch({ type: 'settings:update', settings: partial });
    this.refresh();
  }

  private renderGeneral(): void {
    const settings = this.state.settings;
    const sim = section('Simulation', '1 simulation second is 1 in-game minute at 1x');
    const speedRow = h('div', 'ui-settings-row');
    speedRow.appendChild(span('grow', 'Game speed'));
    for (const speed of [1, 2, 4] as const) {
      speedRow.appendChild(
        button(speed + 'x', () => this.updateSettings({ speed }), { className: 'ui-button-small' + (settings.speed === speed ? ' ui-button-primary' : ''), pressed: settings.speed === speed })
      );
    }
    sim.body.appendChild(speedRow);
    sim.body.appendChild(this.numberSetting('Autosave interval (real seconds)', settings.autosaveIntervalSeconds, 30, 900, (value) => this.updateSettings({ autosaveIntervalSeconds: value })));
    const textRow = h('div', 'ui-settings-row');
    textRow.appendChild(span('grow', 'Dialogue text speed'));
    const textSlider = h('input', 'ui-input');
    textSlider.type = 'range';
    textSlider.min = '0.5';
    textSlider.max = '3';
    textSlider.step = '0.25';
    textSlider.value = String(settings.textSpeed);
    textSlider.addEventListener('change', () => this.updateSettings({ textSpeed: Number(textSlider.value) }));
    textRow.appendChild(textSlider);
    textRow.appendChild(span('ui-muted', settings.textSpeed.toFixed(2) + 'x'));
    sim.body.appendChild(textRow);
    this.element.appendChild(sim.element);

    const access = section('Accessibility & hints');
    access.body.appendChild(this.toggleSetting('Show tutorial hints', settings.showTutorialTips, (value) => this.updateSettings({ showTutorialTips: value })));
    access.body.appendChild(this.toggleSetting('Reduced motion (fewer animations)', settings.reducedMotion, (value) => this.updateSettings({ reducedMotion: value })));
    access.body.appendChild(
      this.toggleSetting('Probability debugger always shown', settings.showProbabilityDebug, (value) => {
        this.updateSettings({ showProbabilityDebug: value });
        if (value) this.ctx.openPanel('probability');
      })
    );
    access.body.appendChild(h('div', 'ui-card-sub', 'F12 opens the probability debugger at any time.'));
    this.element.appendChild(access.element);
    const saveInfo = h('div', 'ui-stats');
    saveInfo.append(
      statTile('Play time', formatRealSeconds(this.state.meta.playTimeSeconds)),
      statTile('Speed', settings.speed + 'x'),
      statTile('Last saved', this.state.meta.savedAt > 0 ? new Date(this.state.meta.savedAt).toLocaleTimeString() : 'never'),
      statTile('Generation', String(this.state.life.generation))
    );
    const infoSection = section('This session');
    infoSection.body.appendChild(saveInfo);
    this.element.appendChild(infoSection.element);
  }

  private numberSetting(label: string, value: number, min: number, max: number, onChange: (value: number) => void): HTMLElement {
    const row = h('div', 'ui-settings-row');
    row.appendChild(span('grow', label));
    const input = h('input', 'ui-input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.style.width = '80px';
    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      const clamped = Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : value;
      input.value = String(clamped);
      onChange(clamped);
    });
    row.appendChild(input);
    return row;
  }

  private toggleSetting(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
    const row = h('div', 'ui-settings-row');
    row.appendChild(span('grow', label));
    const toggle = h('input', '');
    toggle.type = 'checkbox';
    toggle.checked = value;
    toggle.setAttribute('aria-label', label);
    toggle.addEventListener('change', () => onChange(toggle.checked));
    row.appendChild(toggle);
    return row;
  }

  private renderAudio(): void {
    const settings = this.state.settings;
    const audio = section('Volume', 'changes apply immediately');
    const sliders: [string, number, (value: number) => void][] = [
      ['Master volume', settings.masterVolume, (value) => this.updateSettings({ masterVolume: value })],
      ['Music volume', settings.musicVolume, (value) => this.updateSettings({ musicVolume: value })],
      ['Sound effects', settings.sfxVolume, (value) => this.updateSettings({ sfxVolume: value })],
    ];
    for (const [label, value, onChange] of sliders) {
      const row = h('div', 'ui-settings-row');
      row.appendChild(span('grow', label));
      const slider = h('input', 'ui-input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '1';
      slider.step = '0.05';
      slider.value = String(value);
      slider.setAttribute('aria-label', label);
      slider.addEventListener('change', () => onChange(Number(slider.value)));
      row.appendChild(slider);
      row.appendChild(span('ui-muted', Math.round(value * 100) + '%'));
      audio.body.appendChild(row);
    }
    this.element.appendChild(audio.element);
    const note = section('Sound in this build');
    note.body.appendChild(
      h('div', 'ui-card-text', 'Ambient loops and effect cues are generated by the audio manager; volume sliders feed the real mixer. ')
    );
    this.element.appendChild(note.element);
  }

  private renderControls(): void {
    const shortcuts = resolveShortcuts(this.state.settings);
    const list = section('Panel shortcuts', 'click a key cap, then press the new key');
    for (const action of UI_SHORTCUT_ACTIONS) {
      const row = h('div', 'ui-settings-row');
      row.appendChild(span('grow', UI_SHORTCUT_LABELS[action]));
      const isListening = this.listening === action;
      const keyButton = button(isListening ? 'press a key…' : shortcuts[action], () => {
        this.beginCapture(action);
      }, { className: 'ui-keybinding' + (isListening ? ' listening' : ''), ariaLabel: 'Rebind ' + UI_SHORTCUT_LABELS[action] });
      row.appendChild(keyButton);
      list.body.appendChild(row);
    }
    this.element.appendChild(list.element);
    const actions = h('div', 'ui-detail-actions');
    actions.appendChild(
      button('Reset all shortcuts', () => {
        const keybindings: Record<string, string> = {};
        for (const action of UI_SHORTCUT_ACTIONS) keybindings[shortcutBindingKey(action)] = DEFAULT_UI_SHORTCUTS[action];
        this.updateSettings({ keybindings });
      }, { className: 'ui-button-small' })
    );
    actions.appendChild(
      button('Cancel capture', () => {
        this.listening = null;
        this.cleanupCapture();
        this.rerender();
      }, { className: 'ui-button-small', disabled: this.listening === null })
    );
    this.element.appendChild(actions);
    const scene = section('World controls (fixed)');
    for (const [keys, text] of [
      ['W A S D / arrows', 'walk'],
      ['E', 'interact'],
      ['SPACE', 'confirm / reel'],
      ['1-9', 'dialogue choices'],
    ] as const) {
      scene.body.appendChild(h('div', 'ui-help-row', keys + ' — ' + text));
    }
    this.element.appendChild(scene.element);
    if (this.listening) this.installCapture();
  }

  private beginCapture(action: UiShortcutAction): void {
    this.listening = action;
    this.rerender();
  }

  private installCapture(): void {
    this.cleanupCapture();
    const handler = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        this.listening = null;
        this.cleanupCapture();
        this.rerender();
        return;
      }
      const key = normaliseKeyName(event.key);
      if (!key) return;
      const action = this.listening;
      if (!action) return;
      this.listening = null;
      this.cleanupCapture();
      const keybindings = { [shortcutBindingKey(action)]: key };
      this.ctx.dispatch({ type: 'settings:update', settings: { keybindings } });
      this.refresh();
    };
    this.captureHandler = handler;
    window.addEventListener('keydown', handler, true);
  }

  private cleanupCapture(): void {
    if (this.captureHandler) {
      window.removeEventListener('keydown', this.captureHandler, true);
      this.captureHandler = null;
    }
  }

  private renderSaves(): void {
    const save = section('Manual saves', 'the game also autosaves');
    const info = h('div', 'ui-stats');
    info.append(
      statTile('Last saved', this.state.meta.savedAt > 0 ? new Date(this.state.meta.savedAt).toLocaleString() : 'never'),
      statTile('Play time', formatRealSeconds(this.state.meta.playTimeSeconds)),
      statTile('Save version', String(this.state.meta.saveVersion)),
      statTile('Generation', String(this.state.life.generation))
    );
    save.body.appendChild(info);
    const actions = h('div', 'ui-detail-actions');
    actions.appendChild(
      button('Save now', () => {
        this.ctx.dispatch({ type: 'save' });
        this.ctx.notify('Saving…', 'info');
      }, { className: 'ui-button-primary' })
    );
    actions.appendChild(button('Open save slots', () => this.ctx.showSaveSlots(), { className: 'ui-button-small' }));
    actions.appendChild(
      button('Offline summary', () => {
        const summary = this.ctx.api.getOfflineSummary();
        if (summary) this.ctx.showOfflineSummaryModal();
        else this.ctx.notify('No offline summary is waiting.', 'info');
      }, { className: 'ui-button-small' })
    );
    save.body.appendChild(actions);
    save.body.appendChild(
      h('div', 'ui-card-text', 'Save slots can be loaded, deleted, exported and imported from the save slot window. Exports are plain JSON and can be pasted back in.')
    );
    this.element.appendChild(save.element);

    const pending = section('Offline simulation');
    pending.body.appendChild(
      h(
        'div',
        'ui-card-text',
        this.state.pendingOffline.pendingSummary
          ? 'An offline summary is waiting to be acknowledged.'
          : 'No offline summary is waiting. The world simulates while you are away; the summary appears when you return.'
      )
    );
    this.element.appendChild(pending.element);
    void empty;
    void badge;
  }

  private renderData(): void {
    const save = this.ctx.api.getSystems().save;
    const data = section('Save data');
    data.body.appendChild(
      h('div', 'ui-card-text', 'Export writes a JSON document (versioned, with a checksum) that you can copy anywhere. Import validates and restores it into a slot. All data stays in your browser — no network is used.')
    );
    const actions = h('div', 'ui-detail-actions');
    actions.appendChild(button('Save slots, export & import', () => this.ctx.showSaveSlots(), { className: 'ui-button-primary' }));
    data.body.appendChild(actions);
    const debugSection = section('Debug tools');
    debugSection.body.appendChild(
      button(this.state.settings.showProbabilityDebug ? 'Close probability debugger' : 'Open probability debugger', () => {
        this.updateSettings({ showProbabilityDebug: !this.state.settings.showProbabilityDebug });
        this.ctx.togglePanel('probability');
      }, { className: 'ui-button-small' })
    );
    debugSection.body.appendChild(
      button('Trigger offline catch-up now', () => {
        void this.ctx.api.requestOfflineCatchup().then((result) => {
          if (result) this.ctx.showOfflineSummaryModal();
          else this.ctx.notify('Not enough real time has passed for offline catch-up.', 'info');
        });
      }, { className: 'ui-button-small' })
    );
    this.element.appendChild(debugSection.element);
    const danger = section('Leaving');
    danger.body.appendChild(
      button('Return to main menu', () => {
        this.ctx.returnToMenu();
      }, { className: 'ui-button-small ui-button-danger' })
    );
    danger.body.appendChild(
      h('div', 'ui-card-sub', 'The game autosaves in the background; returning to the menu pauses simulation until you load a life again.')
    );
    this.element.appendChild(danger.element);
    const about = section('About');
    about.body.appendChild(
      h('div', 'ui-card-text', "A Cigarette's Life — deterministic living-world life simulation. Build " + this.state.meta.gameVersion + ' · save version ' + this.state.meta.saveVersion + ' · engine seed ' + this.state.meta.seed)
    );
    about.body.appendChild(
      h('div', 'ui-card-sub', 'No network requests, no external fonts or assets: everything is drawn by CSS and emoji.')
    );
    this.element.appendChild(about.element);
    void save;
  }

  destroy(): void {
    this.cleanupCapture();
    this.element.replaceChildren();
  }
}

function formatRealSeconds(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours >= 24) return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h';
  return hours > 0 ? hours + 'h ' + minutes + 'm' : minutes + 'm';
}
