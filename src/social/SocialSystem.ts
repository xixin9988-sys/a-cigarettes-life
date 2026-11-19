import type {
  ActionResult,
  IGameContext,
  InteractionLogEntry,
  InvitationState,
  ISocialSystem,
  NPCState,
  RelationshipState,
  SocialState,
  CommunityProjectState,
} from '../core/contracts';
import type { NPCId } from '../core/SharedTypes';
import { knowsNpc, relationshipScore } from '../core/RelationshipUtil';
import { SOCIAL_CONFIG } from './config';
import { FriendshipSystem } from './FriendshipSystem';
import { GiftSystem } from './GiftSystem';
import { RomanceSystem } from './RomanceSystem';
import { InvitationSystem, isInvitationActivity } from './InvitationSystem';
import { CommunitySystem } from './CommunitySystem';
import { hasMet, socialResult } from './RelationshipOps';

/**
 * Social coordinator (system id 'social'). Owns the player-facing relationship
 * mechanics and drives the hourly/offline maintenance of invitations, community
 * projects and romance drift.
 *
 * Dialogue lives in the separate DialogueSystem (system id 'dialogue').
 */
export class SocialSystem implements ISocialSystem {
  readonly id = 'social';
  private ctx: IGameContext | null = null;
  private friendship: FriendshipSystem | null = null;
  private gifts: GiftSystem | null = null;
  private romance: RomanceSystem | null = null;
  private invitations: InvitationSystem | null = null;
  private community: CommunitySystem | null = null;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.friendship = new FriendshipSystem(ctx);
    this.gifts = new GiftSystem(ctx);
    this.romance = new RomanceSystem(ctx);
    this.invitations = new InvitationSystem(ctx);
    this.invitations.initialise();
    this.community = new CommunitySystem(ctx);
    // Repair bookkeeping statistics that may have drifted across saves.
    this.recountMetNpcs();
  }

  /**
   * Background maintenance. All work is timestamp-driven so a single call with a
   * huge offline delta is safe and bounded (no per-minute loops).
   */
  update(_dtSimSeconds: number): void {
    const ctx = this.requireCtx();
    this.requireInvitations().update();
    this.requireCommunity().update();
    this.requireRomance().updateDrift();
    // Keep the interactions log inside its cap even on long sessions.
    const log = ctx.state.social.interactionLog;
    while (log.length > SOCIAL_CONFIG.maxInteractionLog) log.shift();
  }

  // -------------------------------------------------------------------------
  // ISocialSystem
  // -------------------------------------------------------------------------

  getRelationship(npcId: NPCId): RelationshipState | undefined {
    return this.requireCtx().state.player.relationships[npcId];
  }

  /** NPCs the player has actually been introduced to. */
  getKnownNPCs(): NPCState[] {
    const state = this.requireCtx().state;
    const known: { npc: NPCState; score: number }[] = [];
    for (const npcId of Object.keys(state.npcs)) {
      const npc = state.npcs[npcId];
      if (!npc || !npc.alive) continue;
      const rel = state.player.relationships[npcId];
      const met = hasMet(this.requireCtx(), npcId);
      if (!met && !(rel && knowsNpc(rel))) continue;
      known.push({ npc, score: rel ? relationshipScore(rel) : 0 });
    }
    known.sort((a, b) => b.score - a.score || (a.npc.id < b.npc.id ? -1 : 1));
    return known.map((entry) => entry.npc);
  }

  talkTo(npcId: NPCId): ActionResult {
    return this.requireFriendship().talkTo(npcId);
  }

  giveGift(npcId: NPCId, instanceId: string): ActionResult {
    return this.requireGifts().giveGift(npcId, instanceId);
  }

  helpNPC(npcId: NPCId): ActionResult {
    return this.requireFriendship().helpNPC(npcId);
  }

  inviteNPC(npcId: NPCId, activity: InvitationState['activity']): ActionResult {
    if (!isInvitationActivity(activity)) {
      return socialResult(false, 'That is not something you can invite someone to.', 'invalid');
    }
    return this.requireInvitations().inviteNPC(npcId, activity);
  }

  getInvitations(): InvitationState[] {
    return this.requireInvitations().getInvitations();
  }

  acceptInvitation(invitationId: string): ActionResult {
    return this.requireInvitations().acceptInvitation(invitationId);
  }

  declineInvitation(invitationId: string): ActionResult {
    return this.requireInvitations().declineInvitation(invitationId);
  }

  confessTo(npcId: NPCId): ActionResult {
    return this.requireRomance().confessTo(npcId);
  }

  goOnDate(npcId: NPCId): ActionResult {
    return this.requireRomance().goOnDate(npcId);
  }

  apologiseTo(npcId: NPCId): ActionResult {
    return this.requireFriendship().apologiseTo(npcId);
  }

  proposeCommunityProject(proposalId: string): ActionResult {
    return this.requireCommunity().proposeCommunityProject(proposalId);
  }

  getCommunityProjects(): CommunityProjectState[] {
    return this.requireCommunity().getProjects();
  }

  /** Interaction log, newest first. */
  getInteractionLog(limit?: number): InteractionLogEntry[] {
    const log = this.requireCtx().state.social.interactionLog;
    const capped = Math.max(0, Math.min(limit ?? log.length, log.length));
    const result: InteractionLogEntry[] = [];
    for (let i = log.length - 1; i >= log.length - capped; i -= 1) {
      const entry = log[i];
      if (entry) result.push(entry);
    }
    return result;
  }

  getSocialState(): SocialState {
    return this.requireCtx().state.social;
  }

  // -------------------------------------------------------------------------
  // Extra helpers for UI / integration (beyond ISocialSystem)
  // -------------------------------------------------------------------------

  /** Access to the sub-systems for panels and tests. */
  getFriendshipSystem(): FriendshipSystem {
    return this.requireFriendship();
  }

  getGiftSystem(): GiftSystem {
    return this.requireGifts();
  }

  getRomanceSystem(): RomanceSystem {
    return this.requireRomance();
  }

  getInvitationSystem(): InvitationSystem {
    return this.requireInvitations();
  }

  getCommunitySystem(): CommunitySystem {
    return this.requireCommunity();
  }

  /** Compact data snapshot for the social UI panel. */
  getSocialSummary(): {
    known: number;
    friends: number;
    closeFriends: number;
    romances: { npcId: NPCId; partner: boolean }[];
    pendingInvitations: number;
    activeProjects: number;
    completedProjects: number;
    lastInteractionAt: number;
  } {
    const state = this.requireCtx().state;
    let friends = 0;
    let closeFriends = 0;
    const romances: { npcId: NPCId; partner: boolean }[] = [];
    for (const [npcId, rel] of Object.entries(state.player.relationships)) {
      if (rel.status === 'friend') friends += 1;
      if (rel.status === 'close_friend') closeFriends += 1;
      if (rel.status === 'dating') romances.push({ npcId, partner: false });
      if (rel.status === 'partner') romances.push({ npcId, partner: true });
    }
    const projects = state.social.communityProjects;
    return {
      known: this.getKnownNPCs().length,
      friends,
      closeFriends,
      romances,
      pendingInvitations: this.getInvitations().length,
      activeProjects: projects.filter((project) => project.status !== 'complete' && project.status !== 'rejected').length,
      completedProjects: projects.filter((project) => project.status === 'complete').length,
      lastInteractionAt: state.social.lastInteractionAt,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private recountMetNpcs(): void {
    const ctx = this.requireCtx();
    let met = 0;
    for (const npcId of Object.keys(ctx.state.npcs)) {
      const rel = ctx.state.player.relationships[npcId];
      if (hasMet(ctx, npcId) || (rel && knowsNpc(rel))) met += 1;
    }
    if (met > ctx.state.player.statistics.npcsMet) {
      ctx.state.player.statistics.npcsMet = met;
    }
  }

  private requireCtx(): IGameContext {
    if (!this.ctx) throw new Error('SocialSystem.init(ctx) must be called before use');
    return this.ctx;
  }

  private requireFriendship(): FriendshipSystem {
    if (!this.friendship) throw new Error('SocialSystem.init(ctx) must be called before use');
    return this.friendship;
  }

  private requireGifts(): GiftSystem {
    if (!this.gifts) throw new Error('SocialSystem.init(ctx) must be called before use');
    return this.gifts;
  }

  private requireRomance(): RomanceSystem {
    if (!this.romance) throw new Error('SocialSystem.init(ctx) must be called before use');
    return this.romance;
  }

  private requireInvitations(): InvitationSystem {
    if (!this.invitations) throw new Error('SocialSystem.init(ctx) must be called before use');
    return this.invitations;
  }

  private requireCommunity(): CommunitySystem {
    if (!this.community) throw new Error('SocialSystem.init(ctx) must be called before use');
    return this.community;
  }
}
