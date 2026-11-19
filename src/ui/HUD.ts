// =============================================================================
// HUD: cigarette-body visual, place/time/weather block, purse block and hints.
// The skeleton is built once; update() only writes changed text nodes and the
// two continuous bar widths, so it is cheap to call every animation frame.
// =============================================================================
import type { GameState, IContentRegistry } from '../core/contracts';
import { formatMoney } from '../core/format';
import { resolveShortcuts, buildHudModel, influenceTier, type HudModel } from './model';
import { h, span, setText, setWidthPercent, setClass, type UiContext } from './widgets';

interface HudRefs {
  root: HTMLElement;
  title: HTMLElement;
  playerName: HTMLElement;
  location: HTMLElement;
  locationSub: HTMLElement;
  dateLine: HTMLElement;
  timeLine: HTMLElement;
  weatherLine: HTMLElement;
  budgetLine: HTMLElement;
  money: HTMLElement;
  influence: HTMLElement;
  influenceTier: HTMLElement;
  influenceBar: HTMLElement;
  influenceFill: HTMLElement;
  cigarette: HTMLElement;
  body: HTMLElement;
  filter: HTMLElement;
  ember: HTMLElement;
  moisture: HTMLElement;
  ash: HTMLElement;
  face: HTMLElement;
  lengthText: HTMLElement;
  burnLine: HTMLElement;
  badges: HTMLElement;
  statusEffects: HTMLElement;
  hint: HTMLElement;
  keys: HTMLElement;
}

export class HudView {
  readonly element: HTMLElement;
  private refs: HudRefs;
  private signature = '';
  private state: Readonly<GameState> | null = null;
  private reducedMotion = false;

  constructor(private readonly ctx: UiContext) {
    this.element = h('div', 'ui-hud');
    this.element.setAttribute('aria-label', 'Game status');
    this.refs = this.build();
  }

  private build(): HudRefs {
    const root = this.element;
    // --- cigarette block ---------------------------------------------------
    const cigar = h('div', 'ui-hud-block ui-hud-cigar');
    const cigarHead = h('div', 'ui-hud-label');
    cigarHead.textContent = "A cigarette's life";
    cigar.appendChild(cigarHead);
    const playerName = h('div', 'ui-hud-title');
    cigar.appendChild(playerName);
    const cigarette = h('div', 'ui-cigarette');
    cigarette.setAttribute('role', 'img');
    cigarette.setAttribute('aria-label', 'Cigarette length');
    const body = h('div', 'ui-cigarette-body');
    const moisture = h('div', 'ui-cigarette-moisture');
    const ash = h('div', 'ui-cigarette-ash');
    const filter = h('div', 'ui-cigarette-filter');
    const ember = h('div', 'ui-cigarette-ember');
    const face = h('div', 'ui-cigarette-face', '🙂');
    cigarette.append(body, moisture, ash, filter, ember, face);
    cigar.appendChild(cigarette);
    const lengthText = h('div', 'ui-hud-sub');
    const badges = h('div', 'ui-badges');
    cigar.append(lengthText, badges);
    root.appendChild(cigar);

    // --- place / time / weather -------------------------------------------
    const place = h('div', 'ui-hud-block ui-hud-place');
    const location = h('div', 'ui-hud-location');
    const region = span('ui-muted');
    location.appendChild(document.createTextNode(''));
    const locationName = span('', '');
    location.replaceChildren(locationName, document.createTextNode(' '), region);
    place.appendChild(location);
    const locationSub = h('div', 'ui-hud-sub');
    place.appendChild(locationSub);
    const timeLine = h('div', 'ui-hud-sub');
    const dateLine = h('div', 'ui-hud-sub');
    const weatherLine = h('div', 'ui-hud-sub');
    const budgetLine = h('div', 'ui-hud-sub');
    place.append(timeLine, dateLine, weatherLine, budgetLine);
    root.appendChild(place);

    // --- purse / influence / hints ----------------------------------------
    const purse = h('div', 'ui-hud-block ui-hud-purse');
    const money = h('div', 'ui-hud-money');
    const influence = h('div', 'ui-hud-sub');
    const influenceTier = h('div', 'ui-hud-hint');
    const influenceBar = h('div', 'ui-bar ui-bar-accent');
    influenceBar.style.height = '4px';
    influenceBar.style.marginTop = '3px';
    const influenceFill = h('div', 'ui-bar-fill');
    influenceBar.appendChild(influenceFill);
    purse.append(money, influence, influenceTier, influenceBar);
    root.appendChild(purse);

    // --- bottom strip: status effects + hint + key legend -----------------
    const footer = h('div', 'ui-hud-footer');
    footer.style.cssText =
      'flex-basis:100%;display:flex;gap:10px;align-items:center;pointer-events:none;padding:0 2px;' +
      'font-size:10px;color:#918473;text-shadow:0 1px 0 #000;';
    const statusEffects = h('div', 'ui-inline');
    const hint = h('div', 'ui-hud-hint');
    hint.style.cssText = 'flex:1;min-width:0;margin:0;color:#c4b79f;';
    const keys = h('div', 'ui-hud-keys');
    footer.append(statusEffects, hint, keys);
    root.appendChild(footer);

    return {
      root,
      title: cigarHead,
      playerName,
      location: locationName,
      locationSub,
      dateLine,
      timeLine,
      weatherLine,
      budgetLine,
      money,
      influence,
      influenceTier,
      influenceBar,
      influenceFill,
      cigarette,
      body,
      filter,
      ember,
      moisture,
      ash,
      face,
      lengthText,
      burnLine: lengthText,
      badges,
      statusEffects,
      hint,
      keys,
    };
  }

  setVisible(visible: boolean): void {
    setClass(this.element, 'ui-hidden', !visible);
    this.element.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  isVisible(): boolean {
    return !this.element.classList.contains('ui-hidden');
  }

  /** Full update with change detection. Cheap: one JSON signature per call. */
  update(state: Readonly<GameState>, content: IContentRegistry): void {
    this.state = state;
    const model = buildHudModel(state, content);
    this.applyContinuous(model);
    setClass(this.element, 'ui-reduced-motion', state.settings.reducedMotion);
    this.reducedMotion = state.settings.reducedMotion;
    if (model.signature === this.signature) return;
    this.signature = model.signature;
    this.applyModel(model, state);
  }

  private applyModel(model: HudModel, state: Readonly<GameState>): void {
    const refs = this.refs;
    setText(refs.playerName, model.playerName);
    setText(refs.location, model.locationName);
    const regionNode = refs.location.nextSibling;
    if (regionNode && regionNode.nodeType === Node.TEXT_NODE) regionNode.textContent = ' ';
    setText(refs.locationSub, model.regionName + ' · ' + model.locationDetail);
    setText(refs.timeLine, '🕯 ' + model.clockText + ' · ' + model.weekday);
    setText(refs.dateLine, model.phaseIcon + ' ' + model.dateText + ' · ' + model.phaseLabel);
    setText(
      refs.weatherLine,
      model.weatherIcon + ' ' + model.weatherLabel + ' · ' + model.temperatureText + ' · ' + model.windText + ' · ' + model.humidityText
    );
    setText(refs.budgetLine, model.seasonIcon + ' ' + model.seasonName + ' · ' + model.daylightText);
    setText(refs.money, model.moneyText);
    setText(refs.influence, '✦ ' + model.influenceText + ' influence · ' + model.communityPointsText);
    setText(refs.influenceTier, model.influenceTierName + ' — ' + model.influenceNextText);
    setText(refs.lengthText, model.cigaretteLengthText + ' · ' + model.cigaretteRemainingText + ' · ' + model.burnRateText + ' · ' + model.ashText);
    setText(refs.face, faceEmoji(model.face));
    this.applyBadges(this.refs.badges, model);
    this.applyStatusEffects(model);
    refs.hint.textContent = model.tutorialHint ?? '';
    refs.hint.style.display = model.tutorialHint ? '' : 'none';
    this.applyKeys(state);
    this.applyContinuous(model);
  }

  private applyContinuous(model: HudModel): void {
    const refs = this.refs;
    const usable = Math.max(0, model.cigaretteLengthPercent) * 0.82;
    setWidthPercent(refs.body, usable);
    refs.body.style.background = model.bodyColor;
    refs.ember.style.left = usable + '%';
    refs.ember.style.display = model.cigaretteLengthPercent <= 0.5 ? 'none' : '';
    refs.filter.style.background = model.filterColor;
    setWidthPercent(refs.moisture, usable);
    refs.moisture.style.opacity = String(0.15 + 0.55 * (model.moisturePercent / 100));
    const ashOpacity = Math.max(0.15, Math.min(1, model.ashText.includes('/') ? 1 : 0.2));
    refs.ash.style.opacity = String(ashOpacity);
    const pattern = 'ui-cigarette-pattern-' + (model.pattern || 'plain');
    for (const name of ['ui-cigarette-pattern-plain', 'ui-cigarette-pattern-stripe', 'ui-cigarette-pattern-dots', 'ui-cigarette-pattern-zigzag']) {
      setClass(refs.cigarette, name, name === pattern);
    }
    refs.face.style.right = Math.max(0, 100 - usable - 20) + '%';
    refs.face.textContent = faceEmoji(model.face);
  }

  private applyBadges(container: HTMLElement, model: HudModel): void {
    container.replaceChildren();
    for (const badge of model.badges) {
      container.appendChild(h('span', 'ui-badge ui-badge-' + badge.kind, badge.label));
    }
  }

  private applyStatusEffects(model: HudModel): void {
    const container = this.refs.statusEffects;
    container.replaceChildren();
    for (const effect of model.statusEffects) {
      const chip = h('span', 'ui-chip ui-chip-warn');
      chip.textContent = '✧ ' + effect.label + ' · ' + effect.remainingText;
      container.appendChild(chip);
    }
  }

  private applyKeys(state: Readonly<GameState>): void {
    const keys = this.refs.keys;
    keys.replaceChildren();
    const shortcuts = resolveShortcuts(state.settings);
    const items: [string, string][] = [
      ['I', 'inventory'],
      ['M', 'map'],
      ['K', 'social'],
      ['L', 'life'],
      ['J', 'journal'],
    ];
    for (const [label, action] of items) {
      const key = shortcuts[action as keyof typeof shortcuts] ?? label;
      const chip = h('span', 'ui-hud-key', key + ' ' + label.toLowerCase());
      keys.appendChild(chip);
    }
    const helpKey = shortcuts.help;
    keys.appendChild(h('span', 'ui-hud-key', helpKey + ' help'));
    void this.reducedMotion;
  }

  destroy(): void {
    this.element.replaceChildren();
    this.state = null;
  }
}

function faceEmoji(face: string): string {
  switch (face) {
    case 'smile':
      return '🙂';
    case 'neutral':
      return '😐';
    case 'wink':
      return '😉';
    case 'surprised':
      return '😮';
    case 'sleepy':
      return '😴';
    default:
      return '🙂';
  }
}

/** Convenience for building the influence ladder used by the life panel. */
export function hudInfluenceSummary(state: Readonly<GameState>): { name: string; next: string; progress: number } {
  const tier = influenceTier(state.player.influence);
  return { name: tier.name, next: tier.nextText, progress: tier.progress };
}

/** Formats the current money for the HUD (re-exported for tests). */
export function hudMoneyText(state: Readonly<GameState>): string {
  return formatMoney(state.player.money);
}
