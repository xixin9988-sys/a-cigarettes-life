// =============================================================================
// Dialogue box: typed text, numbered choices, keyboard shortcuts and portraits.
// =============================================================================
import type { GameState } from '../core/contracts';
import { npcPortrait, relationshipStatusLabel } from './model';
import { h, span, button, setText, setClass, PanelBase, type UiContext } from './widgets';

interface ChoiceRef {
  /** Index into the dialogue node's original choice array (dispatch needs this). */
  index: number;
  id: string;
  text: string;
  available: boolean;
}

export class DialoguePanel extends PanelBase {
  private left: HTMLElement | null = null;
  private nameEl: HTMLElement | null = null;
  private metaEl: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private choicesEl: HTMLElement | null = null;
  private portraitEl: HTMLElement | null = null;
  private emotionEl: HTMLElement | null = null;
  private nodeKey = '';
  private fullText = '';
  private displayed = 0;
  private lastTick = 0;
  private typing = false;
  private choices: ChoiceRef[] = [];
  private lastNpcName = '';

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state, 'ui-dialogue');
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', 'Conversation');
  }

  protected signature(state: Readonly<GameState>): string {
    const session = state.social.activeConversation;
    if (!session) return 'none';
    const node = this.currentNode();
    return JSON.stringify([
      session.npcId,
      session.nodeId,
      node ? node.text : '',
      node ? node.choices.map((choice) => [choice.id, choice.text, choice.available]) : [],
      node ? node.emotion : '',
    ]);
  }

  private currentNode(): { npcId: string; text: string; choices: { id: string; text: string; available: boolean }[]; emotion: string } | null {
    try {
      return this.ctx.api.getSystems().dialogue.getCurrentNode();
    } catch {
      return null;
    }
  }

  protected render(): void {
    const session = this.state.social.activeConversation;
    if (!session) {
      this.typing = false;
      this.fullText = '';
      this.choices = [];
      this.element.replaceChildren(h('div', 'ui-dialogue-content', 'No conversation.'));
      return;
    }
    const npc = this.state.npcs[session.npcId];
    const node = this.currentNode();
    const portrait = npcPortrait(npc, session.npcId);
    this.lastNpcName = npc?.name ?? session.npcId;
    const relation = this.state.player.relationships[session.npcId];

    const portraitEl = h('div', 'ui-dialogue-portrait');
    portraitEl.style.background = 'linear-gradient(160deg, ' + portrait.background + ', ' + portrait.accent + ')';
    portraitEl.textContent = portrait.face;
    const initial = h('span', 'initial', portrait.initial);
    portraitEl.appendChild(initial);
    portraitEl.setAttribute('aria-hidden', 'true');

    const content = h('div', 'ui-dialogue-content');
    const head = h('div', 'ui-dialogue-head');
    const nameEl = h('div', 'ui-dialogue-name', this.lastNpcName);
    const metaEl = h('div', 'ui-dialogue-meta');
    const emotionEl = h('div', 'ui-dialogue-meta');
    head.append(nameEl, metaEl, emotionEl);
    content.appendChild(head);

    const textEl = h('div', 'ui-dialogue-text');
    textEl.id = 'acg-dialogue-text';
    textEl.addEventListener('click', () => this.skipTyping());
    content.appendChild(textEl);

    const choicesEl = h('div', 'ui-dialogue-choices');
    content.appendChild(choicesEl);

    const foot = h('div', 'ui-dialogue-foot');
    const skipHint = h('div', 'ui-dialogue-skip', 'click text or press Space to skip · 1-9 choose · Esc leave');
    skipHint.addEventListener('click', () => this.skipTyping());
    const endButton = button('Leave', () => this.leave(), { className: 'ui-button ui-button-small' });
    foot.append(skipHint, endButton);
    content.appendChild(foot);

    this.element.replaceChildren(portraitEl, content);
    this.portraitEl = portraitEl;
    this.nameEl = nameEl;
    this.metaEl = metaEl;
    this.emotionEl = emotionEl;
    this.textEl = textEl;
    this.choicesEl = choicesEl;

    if (relation) {
      setText(
        metaEl,
        relationshipStatusLabel(relation.status) + ' · affinity ' + Math.round(relation.affinity) + ' · trust ' + Math.round(relation.trust)
      );
    } else {
      setText(metaEl, 'a stranger');
    }
    setText(emotionEl, node ? ' · ' + node.emotion : '');

    this.fullText = node ? node.text : '...';
    this.choices = [];
    if (node) {
      node.choices.forEach((choice, index) => {
        this.choices.push({ index, id: choice.id, text: choice.text, available: choice.available });
      });
    }
    this.renderChoices();
    this.startTyping();
  }

  private renderChoices(): void {
    if (!this.choicesEl) return;
    this.choicesEl.replaceChildren();
    let visibleNumber = 0;
    for (const choice of this.choices) {
      if (!choice.available) continue;
      visibleNumber += 1;
      const label = h('span', '');
      label.appendChild(h('span', 'num', visibleNumber + '.'));
      label.appendChild(document.createTextNode(' ' + choice.text));
      const node = button(label, () => this.chooseVisible(visibleNumber - 1), {
        className: 'ui-dialogue-choice',
        ariaLabel: 'Choice ' + visibleNumber + ': ' + choice.text,
      });
      this.choicesEl.appendChild(node);
    }
    if (visibleNumber === 0) {
      this.choicesEl.appendChild(button('End the conversation', () => this.leave(), { className: 'ui-dialogue-choice' }));
    }
  }

  private startTyping(): void {
    this.displayed = 0;
    this.lastTick = 0;
    this.typing = true;
    this.nodeKey = JSON.stringify([this.state.social.activeConversation?.nodeId, this.fullText]);
    if (this.textEl) {
      this.textEl.textContent = '';
      this.textEl.classList.add('typing');
    }
    setClass(this.element, 'ui-dialogue-typing', true);
  }

  skipTyping(): void {
    if (!this.typing) return;
    this.displayed = this.fullText.length;
    this.finishTyping();
  }

  private finishTyping(): void {
    this.typing = false;
    if (this.textEl) {
      this.textEl.textContent = this.fullText;
      this.textEl.classList.remove('typing');
    }
    setClass(this.element, 'ui-dialogue-typing', false);
  }

  isTyping(): boolean {
    return this.typing;
  }

  chooseVisible(visibleIndex: number): void {
    const available = this.choices.filter((choice) => choice.available);
    const target = available[visibleIndex];
    if (!target) return;
    this.skipTyping();
    this.ctx.dispatch({ type: 'dialogue:choose', choiceIndex: target.index });
    this.refresh();
  }

  chooseVisibleNumber(number: number): void {
    if (number < 1) return;
    this.chooseVisible(number - 1);
  }

  leave(): void {
    this.ctx.dispatch({ type: 'dialogue:end' });
    this.refresh();
  }

  protected tick(state: Readonly<GameState>, now: number): void {
    if (!this.typing) return;
    if (this.lastTick === 0) this.lastTick = now;
    const elapsed = Math.min(250, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    const speed = state.settings.reducedMotion ? 1000 : Math.max(6, 24 * (state.settings.textSpeed || 1));
    this.displayed = Math.min(this.fullText.length, this.displayed + (elapsed / 1000) * speed);
    if (this.textEl) this.textEl.textContent = this.fullText.slice(0, Math.floor(this.displayed));
    if (this.displayed >= this.fullText.length) this.finishTyping();
    void this.nodeKey;
    void this.portraitEl;
    void this.lastNpcName;
    void this.nameEl;
    void this.emotionEl;
  }

  destroy(): void {
    this.element.replaceChildren();
  }
}
