// =============================================================================
// Life panel: the cigarette body, influence ladder, statistics and quick rest.
// =============================================================================
import type { GameState } from '../core/contracts';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { formatMoney } from '../core/format';
import { FACE_OPTIONS, PATTERN_OPTIONS, formatDurationClock, influenceTier, lifeArchiveIcon } from './model';
import {
  h,
  span,
  button,
  badge,
  bar,
  empty,
  section,
  tabs,
  statTile,
  labelledBar,
  setWidthPercent,
  PanelBase,
  lifeExtras,
  socialExtras,
  type UiContext,
} from './widgets';

type LifeTab = 'body' | 'identity' | 'stats' | 'appearance';

export class LifePanel extends PanelBase {
  private tab: LifeTab = 'body';
  private pendingBodyColor = '';
  private pendingFilterColor = '';
  private pendingPattern = 'plain';
  private pendingFace = 'smile';

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
    this.pendingBodyColor = state.player.appearance.bodyColor;
    this.pendingFilterColor = state.player.appearance.filterColor;
    this.pendingPattern = state.player.appearance.pattern;
    this.pendingFace = state.player.appearance.face;
  }

  protected signature(state: Readonly<GameState>): string {
    return this.sig(
      this.tab,
      state.player.cigarette,
      state.player.appearance,
      state.player.influence,
      state.player.communityPoints,
      state.player.statistics,
      state.player.money,
      state.player.occupation,
      state.player.residenceId,
      state.life.generation,
      state.life.ageDays,
      state.life.achievements.length,
      state.life.letters.filter((letter) => !letter.read).length,
      this.state.life.archive.slice(-3).map((entry) => entry.id),
      Math.floor(state.clock.simTimeSeconds / 60)
    );
  }

  protected render(): void {
    this.element.replaceChildren();
    this.element.appendChild(
      tabs(
        [
          { id: 'body', label: 'Body', icon: '🚬' },
          { id: 'identity', label: 'Life', icon: '🕯' },
          { id: 'stats', label: 'Statistics', icon: '📈' },
          { id: 'appearance', label: 'Appearance', icon: '🎨' },
        ],
        this.tab,
        (id) => {
          this.tab = id as LifeTab;
          this.rerender();
        }
      )
    );
    if (this.tab === 'body') this.renderBody();
    else if (this.tab === 'identity') this.renderIdentity();
    else if (this.tab === 'stats') this.renderStats();
    else this.renderAppearance();
  }

  private renderBody(): void {
    const condition = this.state.player.cigarette;
    const remaining = this.remainingHours();
    const body = section('Your cigarette body', (condition.lengthRatio * 100).toFixed(1) + '% remaining');
    const visual = h('div', 'ui-life-cigarette');
    visual.appendChild(this.buildBigCigarette());
    body.body.appendChild(visual);
    const bars = h('div', 'ui-stack');
    bars.appendChild(labelledBar('Length', condition.lengthRatio, 1, (condition.lengthRatio * 100).toFixed(1) + '%', condition.lengthRatio < 0.2 ? 'bad' : condition.lengthRatio < 0.4 ? 'warn' : 'default'));
    bars.appendChild(labelledBar('Moisture', condition.moisture, 1, Math.round(condition.moisture * 100) + '%', condition.moisture > 0.85 ? 'bad' : condition.moisture > 0.3 ? 'warn' : 'default'));
    bars.appendChild(labelledBar('Ash in tray', condition.ashAccumulated, WORLD_CONFIG.cigarette.maxAsh, condition.ashAccumulated.toFixed(1) + ' / ' + WORLD_CONFIG.cigarette.maxAsh, 'accent'));
    body.body.appendChild(bars);
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Burn rate', '×' + condition.burnRate.toFixed(2)),
      statTile('Est. hours left', String(Math.round(remaining))),
      statTile('Total burned', (condition.totalBurned * 100).toFixed(1) + '%'),
      statTile('Sheltered', condition.isSheltered ? 'yes' : 'no')
    );
    body.body.appendChild(stats);
    const warnings = h('div', 'ui-inline');
    if (condition.moisture >= WORLD_CONFIG.cigarette.soakedThreshold) warnings.appendChild(badge('SOAKED — no heavy work', 'bad'));
    if (condition.moisture >= WORLD_CONFIG.cigarette.dampThreshold && condition.moisture < WORLD_CONFIG.cigarette.soakedThreshold) warnings.appendChild(badge('damp', 'warn'));
    if (condition.burnRate > 1.25) warnings.appendChild(badge('burning fast', 'bad'));
    if (condition.ashAccumulated >= WORLD_CONFIG.cigarette.maxAsh * 0.8) warnings.appendChild(badge('ash tray nearly full', 'warn'));
    if (!condition.isSheltered) warnings.appendChild(badge('exposed to the weather', 'neutral'));
    if (warnings.childElementCount > 0) body.body.appendChild(warnings);
    this.element.appendChild(body.element);

    const actions = section('Care', 'little rituals that keep you lit');
    const actionRow = h('div', 'ui-detail-actions');
    actionRow.appendChild(
      button('Collect ash (' + condition.ashAccumulated.toFixed(1) + ')', () => {
        this.ctx.dispatch({ type: 'ash:collect' });
        this.refresh();
      }, { className: 'ui-button-small ui-button-primary' })
    );
    actionRow.appendChild(
      button('Warm up', () => {
        this.ctx.dispatch({ type: 'life:warm-up', source: 'warmth' });
        this.refresh();
      }, { className: 'ui-button-small', tooltip: 'Dries you out; a fire or heater helps most.' })
    );
    for (const hours of [1, 4, 8]) {
      actionRow.appendChild(
        button('Rest ' + hours + 'h', () => {
          this.ctx.dispatch({ type: 'time:rest', hours });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
    }
    actions.body.appendChild(actionRow);
    actions.body.appendChild(
      h('div', 'ui-card-text', 'Resting advances the world around you. Find a bed at home for a proper sleep; a short rest anywhere still passes the time.')
    );
    this.element.appendChild(actions.element);

    const effects = section('Effects on your body', String(this.state.player.statusEffects.length));
    if (this.state.player.statusEffects.length === 0) effects.body.appendChild(empty('No active effects.'));
    for (const effect of this.state.player.statusEffects) {
      const remainingText = effect.expiresAt === null ? 'ongoing' : formatDurationClock(Math.max(0, effect.expiresAt - this.state.clock.simTimeSeconds));
      effects.body.appendChild(row2(effect.label, remainingText));
    }
    this.element.appendChild(effects.element);
  }

  private buildBigCigarette(): HTMLElement {
    const condition = this.state.player.cigarette;
    const appearance = this.state.player.appearance;
    const cigarette = h('div', 'ui-cigarette');
    const body = h('div', 'ui-cigarette-body');
    const moisture = h('div', 'ui-cigarette-moisture');
    const ash = h('div', 'ui-cigarette-ash');
    const filter = h('div', 'ui-cigarette-filter');
    const ember = h('div', 'ui-cigarette-ember');
    const face = h('div', 'ui-cigarette-face', faceEmoji(appearance.face));
    face.style.fontSize = '18px';
    cigarette.append(body, moisture, ash, filter, ember, face);
    const usable = Math.max(0, condition.lengthRatio) * 82;
    body.style.width = usable + '%';
    body.style.background = appearance.bodyColor;
    moisture.style.width = usable + '%';
    moisture.style.opacity = String(0.15 + condition.moisture * 0.6);
    filter.style.background = appearance.filterColor;
    ember.style.left = usable + '%';
    cigarette.classList.add('ui-cigarette-pattern-' + appearance.pattern);
    return cigarette;
  }

  private remainingHours(): number {
    try {
      return lifeExtras(this.ctx.api).getRemainingGameHours();
    } catch {
      return (this.state.player.cigarette.lengthRatio * WORLD_CONFIG.cigarette.lifetimeGameHours) / Math.max(0.05, this.state.player.cigarette.burnRate);
    }
  }

  private renderIdentity(): void {
    const state = this.state;
    const identity = section('Who you are this life');
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Name', state.player.name),
      statTile('Generation', String(state.life.generation)),
      statTile('Days lived', state.life.ageDays.toFixed(1)),
      statTile('Occupation', state.player.occupation ?? 'unemployed'),
      statTile('Home', this.ctx.content.getLocation(state.player.residenceId)?.name ?? state.player.residenceId),
      statTile('Money', formatMoney(state.player.money)),
      statTile('Achievements', String(state.life.achievements.length)),
      statTile('Unread letters', String(state.life.letters.filter((letter) => !letter.read).length))
    );
    identity.body.appendChild(stats);
    this.element.appendChild(identity.element);

    const tier = influenceTier(state.player.influence);
    const influence = section('Influence in the community', tier.name);
    influence.body.appendChild(labelledBar('Progress to ' + (tier.nextMin === null ? 'legend' : 'next rank'), tier.progress, 1, Math.round(state.player.influence) + ' influence', 'accent'));
    influence.body.appendChild(h('div', 'ui-card-text', tier.blurb + ' ' + tier.nextText));
    const ladder = h('div', 'ui-influence-ladder');
    let rank = 0;
    for (let index = 0; index < 5; index += 1) {
      rank += 1;
      const row = h('div', 'ui-tier-row' + (index === tier.index ? ' current' : ''));
      row.appendChild(span('tier-mark', index === tier.index ? '◆' : '◇'));
      row.appendChild(span('ui-grow', tierNames[index] ?? 'rank ' + rank));
      if (index === tier.index) row.appendChild(badge('you are here', 'accent'));
      ladder.appendChild(row);
    }
    influence.body.appendChild(ladder);
    this.element.appendChild(influence.element);

    const goalSection = section('Personal goal');
    let goal: { id: string; progress: number; target: number } | null = null;
    try {
      const full = lifeExtras(this.ctx.api).getPersonalGoal();
      if (full) goal = { id: full.id, progress: full.progress, target: full.target };
    } catch {
      goal = null;
    }
    const goalDef = goal ? this.ctx.content.getPlayerGoal(goal.id) : undefined;
    if (goal && goalDef) {
      goalSection.body.appendChild(h('div', 'ui-card-title', goalDef.icon + ' ' + goalDef.title));
      goalSection.body.appendChild(labelledBar('Progress', goal.progress, Math.max(1, goal.target), goal.progress + ' / ' + goal.target));
      goalSection.body.appendChild(h('div', 'ui-card-text', goalDef.description));
    } else {
      goalSection.body.appendChild(empty('No personal goal chosen. The skills panel has offers.'));
      goalSection.body.appendChild(button('Choose a goal', () => this.ctx.openPanel('skills'), { className: 'ui-button-small' }));
    }
    this.element.appendChild(goalSection.element);

    const archive = section('This life', state.life.archive.length + ' moments');
    for (const entry of [...state.life.archive].reverse().slice(0, 6)) {
      archive.body.appendChild(h('div', 'ui-list-item', lifeArchiveIcon(entry.category) + ' ' + entry.title));
    }
    if (state.life.archive.length === 0) archive.body.appendChild(empty('Your story has barely started.'));
    this.element.appendChild(archive.element);

    let social = { known: 0, friends: 0, closeFriends: 0, pendingInvitations: 0 };
    try {
      social = socialExtras(this.ctx.api).getSocialSummary();
    } catch {
      social = { known: 0, friends: 0, closeFriends: 0, pendingInvitations: 0 };
    }
    const soc = section('People', social.known + ' known');
    soc.body.appendChild(row2('Friends', String(social.friends)));
    soc.body.appendChild(row2('Close friends', String(social.closeFriends)));
    soc.body.appendChild(row2('Pending invitations', String(social.pendingInvitations)));
    soc.body.appendChild(button('Open social panel', () => this.ctx.openPanel('social'), { className: 'ui-button-small' }));
    this.element.appendChild(soc.element);
  }

  private renderStats(): void {
    const stats = this.state.player.statistics;
    const list = section('Life statistics', 'the honest count');
    const grid = h('div', 'ui-stats');
    const entries: [string, number][] = [
      ['Steps', stats.steps],
      ['Days lived', stats.daysLived],
      ['Crops harvested', stats.cropsHarvested],
      ['Fish caught', stats.fishCaught],
      ['Foraged items', stats.itemsForaged],
      ['Items crafted', stats.itemsCrafted],
      ['Meals cooked', stats.mealsCooked],
      ['Items bought', stats.itemsBought],
      ['Items sold', stats.itemsSold],
      ['Money earned', stats.moneyEarned],
      ['Money spent', stats.moneySpent],
      ['People met', stats.npcsMet],
      ['Conversations', stats.conversations],
      ['Gifts given', stats.giftsGiven],
      ['Festivals', stats.festivalsAttended],
      ['Photos taken', stats.photosTaken],
      ['Ash collected', stats.ashCollected],
      ['Furniture placed', stats.furniturePlaced],
      ['Secrets found', stats.secretsFound],
      ['Shifts worked', stats.shiftsWorked],
    ];
    for (const [label, value] of entries) {
      grid.appendChild(statTile(label, label.toLowerCase().includes('money') ? formatMoney(value) : String(value)));
    }
    list.body.appendChild(grid);
    this.element.appendChild(list.element);

    const fish = section('Biggest catches');
    const species = Object.entries(stats.fishBiggest);
    if (species.length === 0) fish.body.appendChild(empty('No fish recorded yet.'));
    for (const [fishId, size] of species) {
      fish.body.appendChild(row2(fishId, size.toFixed(1) + ' cm'));
    }
    this.element.appendChild(fish.element);

    const archive = section('Life archive');
    for (const entry of [...this.state.life.archive].reverse().slice(0, 10)) {
      archive.body.appendChild(h('div', 'ui-list-item', entry.title + ' — ' + entry.description));
    }
    if (this.state.life.archive.length === 0) archive.body.appendChild(empty('Nothing archived yet.'));
    this.element.appendChild(archive.element);
  }

  private renderAppearance(): void {
    const form = section('Cigarette appearance', 'a face for the world');
    const formGrid = h('div', 'ui-charcreate-form');
    formGrid.appendChild(
      colorLine('Body colour', this.state.player.appearance.bodyColor, ['#f7f3e8', '#efe4c8', '#e8d8b8', '#f0e6d2', '#e8c8a8', '#d8b8a0', '#c8d8c0', '#e8d0d8'], (value) => {
        this.pendingBodyColor = value;
      })
    );
    formGrid.appendChild(
      colorLine('Filter colour', this.state.player.appearance.filterColor, ['#b07a4a', '#c89058', '#8a6844', '#a86048', '#7a6a80', '#5a7a8a', '#c8a86a', '#6a8a5a'], (value) => {
        this.pendingFilterColor = value;
      })
    );
    const patternLine = h('div', 'ui-form-line');
    patternLine.appendChild(span('ui-label', 'Pattern'));
    const patternSelect = h('select', 'ui-select');
    for (const pattern of PATTERN_OPTIONS) {
      const option = h('option', '', pattern);
      option.value = pattern;
      patternSelect.appendChild(option);
    }
    patternSelect.value = this.state.player.appearance.pattern;
    patternSelect.addEventListener('change', () => {
      this.pendingPattern = patternSelect.value;
    });
    patternLine.appendChild(patternSelect);
    formGrid.appendChild(patternLine);
    const faceLine = h('div', 'ui-form-line');
    faceLine.appendChild(span('ui-label', 'Face'));
    const faceSelect = h('select', 'ui-select');
    for (const face of FACE_OPTIONS) {
      const option = h('option', '', face);
      option.value = face;
      faceSelect.appendChild(option);
    }
    faceSelect.value = this.state.player.appearance.face;
    faceSelect.addEventListener('change', () => {
      this.pendingFace = faceSelect.value;
    });
    faceLine.appendChild(faceSelect);
    formGrid.appendChild(faceLine);
    const preview = h('div', 'ui-preview-cigarette');
    preview.style.background = this.pendingBodyColor;
    const previewFace = h('div', 'ui-preview-face', faceEmoji(this.pendingFace));
    preview.appendChild(previewFace);
    const filterPreview = h('div', 'ui-preview-filter');
    filterPreview.style.background = this.pendingFilterColor;
    formGrid.appendChild(preview);
    formGrid.appendChild(filterPreview);
    formGrid.appendChild(
      button('Apply appearance', () => {
        this.ctx.dispatch({
          type: 'life:customize',
          appearance: {
            bodyColor: this.pendingBodyColor,
            filterColor: this.pendingFilterColor,
            accessory: this.state.player.appearance.accessory,
            face: this.pendingFace as (typeof FACE_OPTIONS)[number],
            pattern: this.pendingPattern as (typeof PATTERN_OPTIONS)[number],
          },
        });
        this.refresh();
      }, { className: 'ui-button-primary' })
    );
    form.body.appendChild(formGrid);
    this.element.appendChild(form.element);
    const note = section('A note on colour');
    note.body.appendChild(
      h('div', 'ui-card-text', 'Body and filter colours are cosmetic only — the burn, the weather and the choices are what shape a life. The preview updates as you pick colours.')
    );
    this.element.appendChild(note.element);
  }
}

const tierNames = ['New Resident', 'Known Face', 'Respected Neighbour', 'Pillar of the Community', 'Village Legend'];

function row2(label: string, value: string): HTMLElement {
  const row = h('div', 'ui-row');
  row.appendChild(span('ui-row-label', label));
  row.appendChild(span('ui-row-value', value));
  return row;
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

function colorLine(label: string, initial: string, presets: string[], onChange: (value: string) => void): HTMLElement {
  const line = h('div', 'ui-form-line');
  line.appendChild(span('ui-label', label));
  const input = h('input', 'ui-input');
  input.type = 'color';
  input.value = initial;
  input.addEventListener('input', () => onChange(input.value));
  line.appendChild(input);
  const swatches = h('div', 'ui-swatch-row');
  for (const color of presets) {
    const swatch = h('button', 'ui-swatch');
    swatch.type = 'button';
    swatch.style.background = color;
    swatch.setAttribute('aria-label', 'Use colour ' + color);
    swatch.addEventListener('click', () => {
      input.value = color;
      onChange(color);
    });
    swatches.appendChild(swatch);
  }
  line.appendChild(swatches);
  return line;
}

export function lifeTierNames(): readonly string[] {
  return tierNames;
}
