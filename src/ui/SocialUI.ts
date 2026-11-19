// =============================================================================
// Social panel: relationship cards, memories, gifts, invitations and community.
// =============================================================================
import type { GameState } from '../core/contracts';
import type { NPCState, RelationshipState } from '../core/contracts';
import { formatMoney } from '../core/format';
import {
  memoryLines,
  npcPortrait,
  relationshipStatusLabel,
  sortedRelationshipCards,
  giftOptions,
  locationName,
  gameTimeText,
  eventImportanceLabel,
} from './model';
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
  PanelBase,
  socialExtras,
  type UiContext,
} from './widgets';

type SocialTab = 'people' | 'invitations' | 'community';

const INVITE_ACTIVITIES = ['walk', 'coffee', 'meal', 'date', 'festival', 'help'] as const;

export class SocialPanel extends PanelBase {
  private tab: SocialTab = 'people';
  private selectedNpcId: string | null = null;
  private giftOpen = false;

  constructor(ctx: UiContext, state: Readonly<GameState>) {
    super(ctx, state);
  }

  protected signature(state: Readonly<GameState>): string {
    return this.sig(
      this.tab,
      this.selectedNpcId,
      this.giftOpen,
      state.player.relationships,
      Object.values(state.npcs).map((npc) => [npc.id, npc.locationId, npc.currentActivity, Math.round(npc.mood * 100), npc.memories.length]),
      state.social.invitations,
      state.social.communityProjects,
      state.social.npcSocialLog.slice(-5).map((entry) => entry.at),
      state.player.influence,
      this.state.player.inventory.length
    );
  }

  protected render(): void {
    this.element.replaceChildren();
    const pending = this.state.social.invitations.filter((invitation) => invitation.status === 'pending').length;
    this.element.appendChild(
      tabs(
        [
          { id: 'people', label: 'People', icon: '👥' },
          { id: 'invitations', label: 'Invitations', count: pending, icon: '✉' },
          { id: 'community', label: 'Community', icon: '🏘' },
        ],
        this.tab,
        (id) => {
          this.tab = id as SocialTab;
          this.giftOpen = false;
          this.rerender();
        }
      )
    );
    if (this.tab === 'people') this.renderPeople();
    else if (this.tab === 'invitations') this.renderInvitations();
    else this.renderCommunity();
  }

  private renderPeople(): void {
    let summary = {
      known: 0,
      friends: 0,
      closeFriends: 0,
      romances: [] as { npcId: string; partner: boolean }[],
      pendingInvitations: 0,
      activeProjects: 0,
      completedProjects: 0,
      lastInteractionAt: 0,
    };
    try {
      summary = socialExtras(this.ctx.api).getSocialSummary();
    } catch {
      summary = {
        known: 0,
        friends: 0,
        closeFriends: 0,
        romances: [],
        pendingInvitations: 0,
        activeProjects: 0,
        completedProjects: 0,
        lastInteractionAt: 0,
      };
    }
    const overview = section('Your social life', 'people remember what you do');
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('People known', String(summary.known)),
      statTile('Friends', String(summary.friends)),
      statTile('Close friends', String(summary.closeFriends)),
      statTile('Romance', String(summary.romances.length)),
      statTile('Pending invitations', String(summary.pendingInvitations)),
      statTile('Community projects', String(summary.activeProjects + summary.completedProjects))
    );
    overview.body.appendChild(stats);
    this.element.appendChild(overview.element);

    const cards = sortedRelationshipCards(this.state, this.ctx.content);
    const people = section('People you know', cards.length + ' relationships');
    if (cards.length === 0) {
      people.body.appendChild(
        empty('You have not met anyone yet. Walk near a villager in the world and press E, or open the map to find people.')
      );
    }
    for (const card of cards.slice(0, 20)) {
      people.body.appendChild(this.renderNpcCard(card.npc, card.relationship, card.romanceable));
    }
    this.element.appendChild(people.element);

    const nearby = this.ctx.api.getSystems().npc.getNearbyNPCs();
    const strangers = nearby.filter((npc) => !this.state.player.relationships[npc.id]);
    if (strangers.length > 0) {
      const strangerSection = section('Nearby strangers', 'say hello');
      for (const npc of strangers.slice(0, 6)) {
        const line = h('div', 'ui-furniture-row');
        line.appendChild(span('ui-grow', npc.name + ' · ' + (npc.occupation ?? 'resident')));
        line.appendChild(
          button('Say hello', () => {
            this.ctx.dispatch({ type: 'dialogue:start', npcId: npc.id });
            this.refresh();
          }, { className: 'ui-button-small' })
        );
        strangerSection.body.appendChild(line);
      }
      this.element.appendChild(strangerSection.element);
    }
    const gossip = section('Town gossip', String(this.state.social.npcSocialLog.length) + ' whispers');
    if (this.state.social.npcSocialLog.length === 0) gossip.body.appendChild(empty('Nobody has gossiped about anyone yet. Give it time.'));
    for (const entry of [...this.state.social.npcSocialLog].reverse().slice(0, 8)) {
      const a = this.state.npcs[entry.npcA]?.name ?? entry.npcA;
      const b = this.state.npcs[entry.npcB]?.name ?? entry.npcB;
      gossip.body.appendChild(h('div', 'ui-list-item', a + ' and ' + b + ': ' + entry.description + ' (' + gameTimeText(entry.at) + ')'));
    }
    this.element.appendChild(gossip.element);
  }

  private renderNpcCard(npc: NPCState, relationship: RelationshipState, romanceable: boolean): HTMLElement {
    const portrait = npcPortrait(npc, npc.id);
    const card = h('div', 'ui-npc-card' + (this.selectedNpcId === npc.id ? ' selected' : ''));
    const portraitEl = h('div', 'ui-npc-portrait');
    portraitEl.style.background = 'linear-gradient(160deg, ' + portrait.background + ', ' + portrait.accent + ')';
    portraitEl.textContent = portrait.face;
    portraitEl.appendChild(h('span', 'initial', portrait.initial));
    card.appendChild(portraitEl);
    const info = h('div', 'ui-npc-info');
    const head = h('div', 'ui-npc-name');
    head.append(document.createTextNode(npc.name + ' '));
    head.appendChild(badge(relationshipStatusLabel(relationship.status), 'accent'));
    head.appendChild(h('small', '', (npc.occupation ?? 'resident') + ' · ' + locationName(this.ctx.content, npc.locationId)));
    info.appendChild(head);
    const moodText = npc.mood > 0.25 ? 'content' : npc.mood > -0.1 ? 'even' : npc.mood > -0.35 ? 'low' : 'miserable';
    info.appendChild(h('div', 'ui-card-sub', 'doing: ' + npc.currentActivity + ' · feeling ' + moodText + ' · age ' + npc.age));

    const relBars = h('div', 'ui-rel-bars');
    const entries: [string, number, number, 'default' | 'bad' | 'ok' | 'accent' | 'muted'][] = [
      ['affinity', relationship.affinity + 100, 200, relationship.affinity < -20 ? 'bad' : 'accent'],
      ['trust', relationship.trust, 100, 'ok'],
      ['intimacy', relationship.intimacy, 100, 'default'],
      ['familiarity', relationship.familiarity, 100, 'muted'],
    ];
    for (const [label, value, max, kind] of entries) {
      relBars.appendChild(span('', label));
      relBars.appendChild(bar(value, max, kind));
    }
    info.appendChild(relBars);
    const memories = memoryLines(npc, 3);
    if (memories.length > 0) {
      const list = h('ul', 'ui-memory-list');
      for (const memory of memories) list.appendChild(h('li', '', memory));
      info.appendChild(list);
    }
    const actions = h('div', 'ui-card-actions');
    actions.appendChild(
      button('Talk', () => {
        this.ctx.dispatch({ type: 'dialogue:start', npcId: npc.id });
        this.refresh();
      }, { className: 'ui-button-small ui-button-primary' })
    );
    actions.appendChild(
      button('Quick chat', () => {
        this.ctx.dispatch({ type: 'social:talk', npcId: npc.id });
        this.refresh();
      }, { className: 'ui-button-small' })
    );
    actions.appendChild(
      button('Gift...', () => {
        this.selectedNpcId = npc.id;
        this.giftOpen = this.selectedNpcId === npc.id ? !this.giftOpen : true;
        this.rerender();
      }, { className: 'ui-button-small' })
    );
    actions.appendChild(
      button('Help', () => {
        this.ctx.dispatch({ type: 'social:help', npcId: npc.id });
        this.refresh();
      }, { className: 'ui-button-small' })
    );
    for (const activity of INVITE_ACTIVITIES) {
      actions.appendChild(
        button('Invite: ' + activity, () => {
          this.ctx.dispatch({ type: 'social:invite', npcId: npc.id, activity });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
    }
    if (romanceable) {
      actions.appendChild(
        button('Confess', () => {
          this.ctx.dispatch({ type: 'social:confess', npcId: npc.id });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
      actions.appendChild(
        button('Date', () => {
          this.ctx.dispatch({ type: 'social:date', npcId: npc.id });
          this.refresh();
        }, { className: 'ui-button-small' })
      );
    }
    actions.appendChild(
      button('Apologise', () => {
        this.ctx.dispatch({ type: 'social:apologise', npcId: npc.id });
        this.refresh();
      }, { className: 'ui-button-small' })
    );
    info.appendChild(actions);
    if (this.giftOpen && this.selectedNpcId === npc.id) info.appendChild(this.giftPicker(npc));
    card.appendChild(info);
    return card;
  }

  private giftPicker(npc: NPCState): HTMLElement {
    const picker = h('div', 'ui-card');
    picker.appendChild(h('div', 'ui-card-title', 'Give a gift to ' + npc.name));
    const npcDef = this.ctx.content.getNPC(npc.id);
    if (npcDef) picker.appendChild(h('div', 'ui-card-sub', 'likes: ' + (npcDef.likes.join(', ') || 'nothing in particular')));
    const options = giftOptions(npc.id, this.state, this.ctx.content);
    if (options.length === 0) {
      picker.appendChild(empty('Your bag is empty; a gift needs something to give.'));
      return picker;
    }
    const grid = h('div', 'ui-inline');
    for (const option of options) {
      const chip = button(
        (option.liked ? '♥ ' : '') + option.def.name + (option.entry.quantity > 1 ? ' x' + option.entry.quantity : ''),
        () => {
          this.ctx.dispatch({ type: 'social:gift', npcId: npc.id, instanceId: option.entry.instanceId });
          this.giftOpen = false;
          this.refresh();
        },
        { className: 'ui-button-small' + (option.liked ? ' ui-button-primary' : ''), tooltip: option.liked ? 'They like this.' : 'Might be appreciated.' }
      );
      grid.appendChild(chip);
    }
    picker.appendChild(grid);
    return picker;
  }

  private renderInvitations(): void {
    const invitations = this.state.social.invitations;
    const pending = invitations.filter((invitation) => invitation.status === 'pending');
    const list = section('Invitations', pending.length + ' waiting');
    if (invitations.length === 0) list.body.appendChild(empty('No invitations yet. Talk to people and they will start asking.'));
    for (const invitation of invitations) {
      const npc = this.state.npcs[invitation.fromNpcId];
      const card = h('div', 'ui-invite');
      const text = h('div', 'grow');
      text.appendChild(h('div', 'ui-card-title', (npc?.name ?? invitation.fromNpcId) + ' invites you to ' + invitation.activity));
      text.appendChild(
        h('div', 'ui-card-sub', locationName(this.ctx.content, invitation.locationId) + ' · proposed ' + gameTimeText(invitation.proposedAt) + ' · expires ' + gameTimeText(invitation.expiresAt))
      );
      text.appendChild(badge(invitation.status, invitation.status === 'pending' ? 'accent' : invitation.status === 'accepted' ? 'ok' : 'neutral'));
      card.appendChild(text);
      if (invitation.status === 'pending') {
        card.appendChild(
          button('Accept', () => {
            this.ctx.dispatch({ type: 'social:accept-invite', invitationId: invitation.id });
            this.refresh();
          }, { className: 'ui-button-small ui-button-primary' })
        );
        card.appendChild(
          button('Decline', () => {
            this.ctx.dispatch({ type: 'social:decline-invite', invitationId: invitation.id });
            this.refresh();
          }, { className: 'ui-button-small ui-button-danger' })
        );
      }
      list.body.appendChild(card);
    }
    this.element.appendChild(list.element);
    const interaction = section('Recent interactions', String(this.state.social.interactionLog.length) + ' logged');
    for (const entry of [...this.state.social.interactionLog].reverse().slice(0, 12)) {
      const npc = this.state.npcs[entry.npcId];
      const line = h('div', 'ui-row');
      line.appendChild(span('ui-row-label', (npc?.name ?? entry.npcId) + ' · ' + entry.kind));
      line.appendChild(span('ui-row-hint', entry.summary));
      line.appendChild(
        span(
          'ui-row-value',
          'aff ' + signed(entry.affinityDelta) + ' · trust ' + signed(entry.trustDelta) + ' · int ' + signed(entry.intimacyDelta)
        )
      );
      interaction.body.appendChild(line);
    }
    if (this.state.social.interactionLog.length === 0) interaction.body.appendChild(empty('No interactions logged yet.'));
    this.element.appendChild(interaction.element);
  }

  private renderCommunity(): void {
    const proposals = this.ctx.content.pack.communityProposals;
    const projects = this.state.social.communityProjects;
    const overview = section('Community life', 'projects take money, influence and support');
    const stats = h('div', 'ui-stats');
    stats.append(
      statTile('Proposals', String(proposals.length)),
      statTile('Started', String(projects.length)),
      statTile('Completed', String(projects.filter((project) => project.status === 'complete').length)),
      statTile('Influence', String(Math.round(this.state.player.influence))),
      statTile('Money', formatMoney(this.state.player.money))
    );
    overview.body.appendChild(stats);
    this.element.appendChild(overview.element);
    const list = section('Community proposals');
    for (const proposal of proposals) {
      const project = projects.find((candidate) => candidate.proposalId === proposal.id);
      const card = h('div', 'ui-card');
      const head = h('div', 'ui-card-title');
      head.append(document.createTextNode(proposal.title + ' '));
      if (project) head.appendChild(badge(project.status, project.status === 'complete' ? 'ok' : 'accent'));
      card.appendChild(head);
      card.appendChild(h('div', 'ui-card-text', proposal.description));
      card.appendChild(
        h(
          'div',
          'ui-card-sub',
          'cost ' + formatMoney(proposal.costPence) + ' · influence ' + proposal.influenceRequired + ' · support ' + proposal.supportRequired + ' · ' + proposal.constructionHours + 'h build'
        )
      );
      card.appendChild(h('div', 'ui-card-sub', 'at ' + locationName(this.ctx.content, proposal.locationId) + ' · effects: ' + proposal.effects.join(', ')));
      if (project) {
        const ratio = project.votesFor + project.votesAgainst > 0 ? project.votesFor / (project.votesFor + project.votesAgainst) : 0;
        const row = h('div', 'ui-progress-row');
        row.appendChild(span('ui-progress-label', 'Support'));
        row.appendChild(bar(ratio, 1, 'accent'));
        row.appendChild(span('ui-progress-value', project.votesFor + ' for / ' + project.votesAgainst + ' against'));
        card.appendChild(row);
        card.appendChild(h('div', 'ui-card-sub', 'required support ' + project.requiredSupport + ' · funded: ' + (project.funded ? 'yes' : 'no')));
      } else {
        card.appendChild(
          button('Propose project', () => {
            this.ctx.dispatch({ type: 'social:propose', proposalId: proposal.id });
            this.refresh();
          }, { className: 'ui-button-small ui-button-primary', tooltip: 'Starts a community vote; needs influence and money.' })
        );
      }
      list.body.appendChild(card);
    }
    if (proposals.length === 0) list.body.appendChild(empty('No community proposals are defined.'));
    this.element.appendChild(list.element);
    const events = section('Community history');
    const history = this.state.world.history.filter((entry) => entry.category === 'community' || entry.category === 'festival').reverse().slice(0, 12);
    if (history.length === 0) events.body.appendChild(empty('The community has not made history yet.'));
    for (const entry of history) {
      events.body.appendChild(h('div', 'ui-list-item', entry.description + ' · ' + gameTimeText(entry.at) + ' · ' + eventImportanceLabel(entry.importance)));
    }
    this.element.appendChild(events.element);
  }
}

function signed(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return (rounded >= 0 ? '+' : '') + rounded;
}
