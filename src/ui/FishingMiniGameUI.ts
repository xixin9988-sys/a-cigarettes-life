// =============================================================================
// Fishing minigame panel: cast setup + tension/progress reeling with hold control.
// Opens automatically while state.fishing.session exists.
// =============================================================================
import type { GameState } from '../core/contracts';
import { WEATHER_DISPLAY_NAMES } from '../core/SharedTypes';
import { fishingBaitOptions, fishingRodOptions, type GearOption } from './model';
import {
  h,
  span,
  button,
  bar,
  empty,
  section,
  statTile,
  setText,
  setWidthPercent,
  setClass,
  PanelBase,
  type UiContext,
} from './widgets';

export class FishingPanel extends PanelBase {
  private tensionFill: HTMLElement | null = null;
  private progressFill: HTMLElement | null = null;
  private tensionWrap: HTMLElement | null = null;
  private tensionText: HTMLElement | null = null;
  private progressText: HTMLElement | null = null;
  private holdButton: HTMLButtonElement | null = null;
  private messageEl: HTMLElement | null = null;
  private holding = false;
  private selectedRod: string | null = null;
  private selectedBait: string | null = null;

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
  }

  protected signature(state: Readonly<GameState>): string {
    const session = state.fishing.session;
    return JSON.stringify([
      session ? [session.phase, session.targetFishId, session.locationId, session.rodItemId, session.baitItemId] : null,
      session ? session.message : '',
      state.player.position.locationId,
      state.world.environment.weather,
      this.selectedRod,
      this.selectedBait,
      state.fishing.casts,
      state.fishing.catches,
      state.player.inventory.length,
    ]);
  }

  protected render(): void {
    const session = this.state.fishing.session;
    this.tensionFill = null;
    this.progressFill = null;
    this.holdButton = null;
    if (!session) {
      this.renderCastSetup();
      return;
    }
    const root = h('div', 'ui-fishing');
    const fish = session.targetFishId ? this.ctx.content.getFish(session.targetFishId) : undefined;
    const fishBox = h('div', 'ui-fishing-fish');
    const waterline = h('div', 'waterline');
    const silhouette = h('div', 'silhouette', fish ? '🐟' : session.phase === 'waiting' ? '🌊' : '🪝');
    const fishLabel = h('div', '');
    fishLabel.style.cssText = 'font-size:11px;color:#c4b79f;text-align:center;';
    const phaseLabel: Record<string, string> = {
      casting: 'Casting…',
      waiting: 'Waiting for a bite…',
      bite: 'A bite! Strike now!',
      reeling: fish ? 'Something is fighting: ' + fish.name : 'Something is fighting!',
      landed: 'Landed!',
      escaped: 'It got away.',
      idle: 'Idle.',
    };
    fishLabel.textContent = phaseLabel[session.phase] ?? session.phase;
    fishBox.append(waterline, silhouette, fishLabel);
    root.appendChild(fishBox);

    const tension = section('Line tension', 'snaps at the top');
    const tensionWrap = h('div', 'ui-bar ui-bar-warn ui-fish-tension');
    const tensionFill = h('div', 'ui-bar-fill');
    tensionWrap.appendChild(tensionFill);
    const tensionHead = h('div', 'ui-fish-meter-label');
    const tensionText = span('', '0%');
    tensionHead.append(span('', 'tension'), tensionText);
    tension.body.append(tensionHead, tensionWrap);
    root.appendChild(tension.element);

    const progress = section('Reel progress', 'land the fish at 100%');
    const progressHead = h('div', 'ui-fish-meter-label');
    const progressText = span('', '0%');
    progressHead.append(span('', 'progress'), progressText);
    const progressWrap = h('div', 'ui-bar ui-bar-ok ui-fish-progress');
    const progressFill = h('div', 'ui-bar-fill');
    progressWrap.appendChild(progressFill);
    progress.body.append(progressHead, progressWrap);
    root.appendChild(progress.element);

    const controls = h('div', 'ui-stack');
    const holdButton = button('HOLD TO REEL', () => undefined, { className: 'ui-button ui-button-primary ui-fish-hold' });
    holdButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.beginHold();
    });
    holdButton.addEventListener('pointerup', () => this.endHold());
    holdButton.addEventListener('pointerleave', () => this.endHold());
    holdButton.addEventListener('pointercancel', () => this.endHold());
    controls.appendChild(holdButton);
    const cancel = button('Cut the line', () => this.cancel(), { className: 'ui-button ui-button-danger' });
    controls.appendChild(cancel);
    if (session.phase === 'bite') {
      controls.prepend(h('div', 'ui-fish-message', 'Tap the reel button the moment it bites.'));
    }
    root.appendChild(controls);

    const message = h('div', 'ui-fish-message', session.message);
    root.appendChild(message);

    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Casts', String(this.state.fishing.casts)),
      statTile('Catches', String(this.state.fishing.catches)),
      statTile('Line', session.rodItemId ? this.ctx.content.resolveItemName(session.rodItemId) : 'hands'),
      statTile('Weather', WEATHER_DISPLAY_NAMES[this.state.world.environment.weather] ?? '')
    );
    root.appendChild(stats);
    this.element.replaceChildren(root);
    this.tensionFill = tensionFill;
    this.progressFill = progressFill;
    this.tensionWrap = tensionWrap;
    this.tensionText = tensionText;
    this.progressText = progressText;
    this.holdButton = holdButton;
    this.messageEl = message;
    this.applyMeters();
  }

  private renderCastSetup(): void {
    const state = this.state;
    const location = this.ctx.content.getLocation(state.player.position.locationId);
    const root = h('div', 'ui-fishing');
    root.appendChild(
      h(
        'div',
        'ui-card-text',
        location?.fishSpot
          ? 'The water at ' + location.name + ' moves slowly. Cast a line and wait for a bite.'
          : 'There is no fishable water here. Look for a river, lake or pond on the map (M).'
      )
    );
    const locationInfo = h('div', 'ui-stats');
    if (location?.fishSpot) {
      locationInfo.append(
        statTile('Water', location.fishSpot.waterType),
        statTile('Water quality', Math.round(location.fishSpot.quality * 100) + '%'),
        statTile('Time', String(state.clock.simTimeSeconds > 0 ? 'now' : 'now')),
        statTile('Weather', WEATHER_DISPLAY_NAMES[state.world.environment.weather] ?? '')
      );
    }
    root.appendChild(locationInfo);
    if (!location?.fishSpot) {
      this.element.replaceChildren(root);
      return;
    }
    const rods = fishingRodOptions(state.player.inventory, this.ctx.content);
    const baits = fishingBaitOptions(state.player.inventory, this.ctx.content);
    if (this.selectedRod === null && rods[0]) this.selectedRod = rods[0].entry.instanceId;
    const setup = section('Tackle', rods.length > 0 ? rods.length + ' rod(s)' : 'you have no rod');
    const rodRow = h('div', 'ui-inline');
    rodRow.appendChild(span('ui-row-label', 'Rod'));
    const rodSelect = h('select', 'ui-select');
    const noRod = h('option', '', 'bare hands');
    noRod.value = '';
    rodSelect.appendChild(noRod);
    for (const rod of rods) {
      const option = h('option', '', rod.def.name + ' (tier ' + (rod.def.toolTier ?? 1) + ')');
      option.value = rod.entry.instanceId;
      rodSelect.appendChild(option);
    }
    rodSelect.value = this.selectedRod ?? '';
    rodSelect.addEventListener('change', () => {
      this.selectedRod = rodSelect.value === '' ? null : rodSelect.value;
      this.rerender();
    });
    setup.body.appendChild(rodRow);
    rodRow.appendChild(rodSelect);
    const baitRow = h('div', 'ui-inline');
    baitRow.appendChild(span('ui-row-label', 'Bait'));
    const baitSelect = h('select', 'ui-select');
    const noBait = h('option', '', 'no bait');
    noBait.value = '';
    baitSelect.appendChild(noBait);
    for (const bait of baits) {
      const option = h('option', '', bait.def.name + ' ×' + bait.entry.quantity);
      option.value = bait.entry.instanceId;
      baitSelect.appendChild(option);
    }
    baitSelect.value = this.selectedBait ?? '';
    baitSelect.addEventListener('change', () => {
      this.selectedBait = baitSelect.value === '' ? null : baitSelect.value;
      this.rerender();
    });
    baitRow.appendChild(baitSelect);
    setup.body.appendChild(baitRow);
    if (rods.length === 0) {
      setup.body.appendChild(h('div', 'ui-card-text', 'You need a fishing rod. The tackle shop in Ashford sells them.'));
    }
    root.appendChild(setup.element);
    const cast = button(
      'Cast the line',
      () => {
        const rodInstanceId = this.selectedRod ?? undefined;
        const baitInstanceId = this.selectedBait ?? undefined;
        this.cast(rodInstanceId, baitInstanceId);
      },
      { className: 'ui-button ui-button-primary', disabled: rods.length === 0, tooltip: rods.length === 0 ? 'A rod is required.' : 'Cast into the water.' }
    );
    root.appendChild(cast);
    const help = section('How the minigame works');
    help.body.appendChild(
      h(
        'div',
        'ui-card-text',
        'Hold to reel: tension rises and progress fills. Release: tension falls and the fish runs. ' +
          'If tension maxes out the line snaps. If you let the line slack too long the fish escapes. ' +
          'Hold the mouse button on the reel button (or Space) and pulse it to keep the line in the middle.'
      )
    );
    root.appendChild(help.element);
    this.element.replaceChildren(root);
  }

  private cast(rodInstanceId?: string, baitInstanceId?: string): void {
    const locationId = this.state.player.position.locationId;
    const action = {
      type: 'fish:cast' as const,
      locationId,
      ...(rodInstanceId ? { rodInstanceId } : {}),
      ...(baitInstanceId ? { baitInstanceId } : {}),
    };
    this.ctx.dispatch(action);
    this.refresh();
  }

  beginHold(): void {
    if (this.holding) return;
    this.holding = true;
    this.ctx.dispatch({ type: 'fish:reel', hold: true });
    if (this.holdButton) {
      this.holdButton.classList.add('holding');
      this.holdButton.textContent = 'REELING — release to ease off';
    }
  }

  endHold(): void {
    if (!this.holding) return;
    this.holding = false;
    this.ctx.dispatch({ type: 'fish:reel', hold: false });
    if (this.holdButton) {
      this.holdButton.classList.remove('holding');
      this.holdButton.textContent = 'HOLD TO REEL';
    }
  }

  isHolding(): boolean {
    return this.holding;
  }

  cancel(): void {
    this.endHold();
    this.ctx.dispatch({ type: 'fish:cancel' });
    this.refresh();
  }

  protected tick(state: Readonly<GameState>): void {
    const session = state.fishing.session;
    if (!session) return;
    this.applyMeters();
    if (this.messageEl) setText(this.messageEl, session.message);
  }

  private applyMeters(): void {
    const session = this.state.fishing.session;
    if (!session) return;
    const tensionMax = 100;
    const progressMax = 100;
    setWidthPercent(this.tensionFill, (session.tension / tensionMax) * 100);
    setWidthPercent(this.progressFill, (session.progress / progressMax) * 100);
    setText(this.tensionText, Math.round(session.tension) + '%');
    setText(this.progressText, Math.round(session.progress) + '%');
    setClass(this.tensionWrap, 'danger', session.tension >= 78);
    if (this.holdButton) {
      const active = session.phase === 'reeling' || session.phase === 'bite';
      this.holdButton.disabled = !active;
      this.holdButton.setAttribute('aria-disabled', active ? 'false' : 'true');
    }
  }

  destroy(): void {
    this.endHold();
    this.element.replaceChildren();
  }
}

// Re-exported helpers used by map/around-you UI
export function gearLabel(content: { resolveItemName(itemId: string): string }, gear: GearOption | null): string {
  return gear ? content.resolveItemName(gear.entry.itemId) : '—';
}

export function rodTierBadge(tier: number | undefined): HTMLElement {
  return span('ui-chip ui-chip-accent', 'tier ' + (tier ?? 1));
}

export function noFishingSpot(): HTMLElement {
  return empty('No fishable water here.');
}
