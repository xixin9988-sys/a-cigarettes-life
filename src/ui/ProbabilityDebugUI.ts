// =============================================================================
// Probability debugger (F12): seed, stream states, decisions and weight bars.
// =============================================================================
import type { GameState, ProbabilityDebugInfo } from '../core/contracts';
import { candidateBars, gameTimeText } from './model';
import {
  h,
  span,
  badge,
  empty,
  section,
  statTile,
  setWidthPercent,
  PanelBase,
  type UiContext,
} from './widgets';

export class ProbabilityDebugPanel extends PanelBase {
  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
    this.element.setAttribute('aria-label', 'Probability debugger');
  }

  protected signature(state: Readonly<GameState>): string {
    return this.sig(
      state.probability.decisionCount,
      state.probability.seed,
      state.probability.history.length,
      state.probability.history.slice(-3).map((record) => record.decisionId),
      Object.keys(state.probability.streams).length
    );
  }

  private debug(): ProbabilityDebugInfo | null {
    try {
      return this.ctx.api.getProbabilityDebug();
    } catch {
      return null;
    }
  }

  protected render(): void {
    const debug = this.debug();
    if (!debug) {
      this.element.replaceChildren(empty('The probability engine is not available.'));
      return;
    }
    const summary = section('Seeded probability engine', 'deterministic, replayable');
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Seed', String(debug.seed)),
      statTile('Streams', String(debug.streams.length)),
      statTile('Recent decisions', String(debug.recent.length)),
      statTile('History stored', String(this.state.probability.history.length))
    );
    summary.body.appendChild(stats);
    summary.body.appendChild(
      h(
        'div',
        'ui-card-text',
        'Every uncertain outcome in the game is resolved here: candidates get weighted, conditions filter them, ' +
          'modifiers adjust the weights, then one deterministic draw picks an option. The same seed replays the same story.'
      )
    );
    this.element.appendChild(summary.element);

    const streamSection = section('Streams', debug.streams.length + ' independent streams');
    const grid = h('div', 'ui-prob-streams');
    for (const stream of debug.stats) {
      const tile = h('div', 'ui-prob-stream');
      tile.appendChild(span('', stream.streamId));
      tile.appendChild(span('', stream.decisions + ' dec · ' + stream.draws + ' draws'));
      grid.appendChild(tile);
    }
    if (debug.stats.length === 0) grid.appendChild(empty('No streams have been used yet.'));
    streamSection.body.appendChild(grid);
    this.element.appendChild(streamSection.element);

    const recent = section('Recent decisions', debug.recent.length + ' recorded');
    for (const decision of [...debug.recent].reverse()) {
      const card = h('div', 'ui-card ui-prob-decision' + (decision.selectedOptionId !== null ? ' selected' : ''));
      const head = h('div', 'ui-card-title');
      head.append(document.createTextNode(decision.decisionType + ' '));
      head.appendChild(badge(decision.streamId, 'accent'));
      card.appendChild(head);
      card.appendChild(h('div', 'ui-card-sub', 'at ' + gameTimeText(decision.timestamp) + ' · ' + decision.candidates.length + ' candidates · selected: ' + (decision.selectedOptionId ?? 'none')));
      const bars = h('div', 'ui-stack');
      for (const candidate of candidateBars(decision)) {
        const row = h('div', 'ui-candidate-bar' + (candidate.eligible ? '' : ' ineligible'));
        row.appendChild(span('name', candidate.id));
        const track = h('div', 'track');
        const fill = h('div', 'fill');
        fill.style.background = candidate.color;
        setWidthPercent(fill, candidate.probabilityPercent);
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(span('pct', candidate.probabilityPercent.toFixed(1) + '%'));
        if (candidate.id === decision.selectedOptionId) row.appendChild(badge('picked', 'ok'));
        bars.appendChild(row);
      }
      card.appendChild(bars);
      const modifiers = decision.candidates.flatMap((candidate) =>
        candidate.modifiers.map((modifier) => ({ candidateId: candidate.id, ...modifier }))
      );
      if (modifiers.length > 0) {
        const modList = h('div', 'ui-stack');
        for (const modifier of modifiers.slice(0, 8)) {
          modList.appendChild(
            h('div', 'ui-list-item', modifier.candidateId + ': ' + modifier.kind + ' ' + modifier.amount.toFixed(3) + ' — ' + modifier.detail)
          );
        }
        card.appendChild(modList);
      }
      const details = h('details', '');
      details.appendChild(h('summary', 'ui-card-sub', 'context json'));
      const pre = h('pre', 'ui-code', JSON.stringify(decision.context, null, 2));
      details.appendChild(pre);
      card.appendChild(details);
      recent.body.appendChild(card);
    }
    if (debug.recent.length === 0) recent.body.appendChild(empty('No decisions recorded yet. Go live a little.'));
    this.element.appendChild(recent.element);

    const streamStateSection = section('Persisted stream states');
    const states = Object.entries(debug.streamStates);
    if (states.length === 0) streamStateSection.body.appendChild(empty('No persisted streams yet.'));
    for (const [streamId, values] of states.slice(0, 20)) {
      streamStateSection.body.appendChild(h('div', 'ui-list-item', streamId + ': [' + values.map((value) => value.toFixed(6)).join(', ') + ']'));
    }
    this.element.appendChild(streamStateSection.element);
  }
}
