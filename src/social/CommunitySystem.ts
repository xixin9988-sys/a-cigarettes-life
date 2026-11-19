import type { ActionResult, CommunityProjectState, IGameContext, NPCState } from '../core/contracts';
import type { NPCId } from '../core/SharedTypes';
import type { CommunityProposalDef } from '../data/schema';
import { relationshipScore } from '../core/RelationshipUtil';
import { clamp01 } from '../core/utils';
import { SOCIAL_CONFIG, cooldownSeconds } from './config';
import {
  addPlayerMoney,
  awardInfluence,
  clampProbability,
  socialResult,
} from './RelationshipOps';
import { addSocialHistory, recordNpcLifeEvent } from './SocialHistory';
import {
  countTagMatches,
  formatPence,
  isSamePlace,
  locationName,
  nextSequentialId,
  roundDelta,
} from './socialUtils';

const ACTIVE_STATUSES: readonly CommunityProjectState['status'][] = ['proposed', 'voting', 'approved', 'building'];

/**
 * Community projects: the player proposes a public work, residents vote on it
 * over a day, and approved projects are built over in-game hours, changing the
 * world (flags, location condition, influence) when they complete.
 */
export class CommunitySystem {
  constructor(private readonly ctx: IGameContext) {}

  /** All proposals the player has ever started (voting, building, complete, rejected). */
  getProjects(): CommunityProjectState[] {
    return [...this.ctx.state.social.communityProjects];
  }

  /** Proposes a public project. Checks influence, funds, location access and duplicates. */
  proposeCommunityProject(proposalId: string): ActionResult {
    const ctx = this.ctx;
    const state = ctx.state;
    const def = ctx.content.getCommunityProposal(proposalId);
    if (!def) return socialResult(false, 'Unknown community proposal.', 'not_found');

    const existing = state.social.communityProjects.find((project) => project.proposalId === proposalId);
    if (existing) {
      if (existing.status === 'complete') {
        return socialResult(false, def.title + ' has already been built.', 'invalid');
      }
      if (ACTIVE_STATUSES.includes(existing.status)) {
        return socialResult(false, 'A proposal for ' + def.title + ' is already in motion.', 'invalid');
      }
    }

    const locationDef = ctx.content.getLocation(def.locationId);
    if (!locationDef) return socialResult(false, 'That project has nowhere to be built.', 'invalid');
    const locationState = state.world.locations[def.locationId];
    if (!locationState || !locationState.unlocked || !locationState.discovered) {
      return socialResult(false, 'You have not found ' + locationDef.name + ' yet.', 'locked');
    }

    if (state.player.influence < def.influenceRequired) {
      return socialResult(
        false,
        'The town will not listen to you yet. ' + def.title + ' needs ' + String(def.influenceRequired) + ' influence (you have ' + String(Math.round(state.player.influence)) + ').',
        'requirement_not_met',
        { influenceRequired: def.influenceRequired, influence: roundDelta(state.player.influence) }
      );
    }
    if (state.player.money < def.costPence) {
      return socialResult(
        false,
        'You need ' + formatPence(def.costPence) + ' to put toward ' + def.title + '.',
        'not_enough_money',
        { costPence: def.costPence, balance: state.player.money }
      );
    }

    addPlayerMoney(ctx, -def.costPence, 'community_project');
    const project: CommunityProjectState = {
      id: nextSequentialId('community', state.social.communityProjects.map((item) => item.id)),
      proposalId,
      status: 'voting',
      votesFor: 0,
      votesAgainst: 0,
      requiredSupport: def.supportRequired,
      startedAt: state.clock.simTimeSeconds,
      completesAt: null,
      funded: true,
    };
    state.social.communityProjects.push(project);
    ctx.bus.emit('community:proposal', { project });
    addSocialHistory(state, {
      category: 'community',
      description: 'The cigarette proposed ' + def.title + ' at ' + locationName(ctx.content, def.locationId) + '. The town is discussing it.',
      importance: 3,
      at: state.clock.simTimeSeconds,
      locationId: def.locationId,
    });
    return socialResult(
      true,
      'You put ' + formatPence(def.costPence) + ' toward ' + def.title + '. Residents will discuss it over the next ' + String(SOCIAL_CONFIG.community.votingHours) + ' hours.',
      undefined,
      {
        projectId: project.id,
        proposalId,
        requiredSupport: def.supportRequired,
        influenceRequired: def.influenceRequired,
        costPence: def.costPence,
        votingHours: SOCIAL_CONFIG.community.votingHours,
      }
    );
  }

  /**
   * Background: collects votes, resolves votes, advances construction and
   * completions. Runs the whole state machine in one pass so a single large
   * offline tick (days of sim time) can vote, build and finish a project.
   */
  update(): void {
    const ctx = this.ctx;
    const now = ctx.clock.simTimeSeconds;
    let voterPool: NPCState[] | null = null;
    for (const project of ctx.state.social.communityProjects) {
      const def = ctx.content.getCommunityProposal(project.proposalId);
      if (!def) continue;
      let guard = 0;
      while (guard < 6) {
        guard += 1;
        if (project.status === 'voting') {
          if (voterPool === null) voterPool = this.buildVoterPool();
          this.castVotes(project, def, now, voterPool);
          if (!this.maybeResolve(project, def, now)) break;
          continue;
        }
        if (project.status === 'approved') {
          project.status = 'building';
          if (project.completesAt === null) {
            project.completesAt = now + cooldownSeconds(def.constructionHours);
          }
          ctx.bus.emit('community:proposal', { project });
          continue;
        }
        if (project.status === 'building') {
          if (project.completesAt !== null && now >= project.completesAt) {
            this.completeProject(project, def, now);
          }
          break;
        }
        break;
      }
    }
  }

  /** Builds the voting population: people the player knows first, then other residents. */
  private buildVoterPool(): NPCState[] {
    const state = this.ctx.state;
    const known: { npc: NPCState; score: number }[] = [];
    const others: NPCState[] = [];
    const npcIds = Object.keys(state.npcs).sort((a, b) => (a < b ? -1 : 1));
    for (const npcId of npcIds) {
      const npc = state.npcs[npcId];
      if (!npc || !npc.alive) continue;
      const rel = state.player.relationships[npcId];
      if (rel && rel.interactionCount > 0) {
        known.push({ npc, score: relationshipScore(rel) });
      } else {
        others.push(npc);
      }
    }
    known.sort((a, b) => b.score - a.score || (a.npc.id < b.npc.id ? -1 : 1));
    const pool = known.map((entry) => entry.npc).concat(others);
    return pool.slice(0, 32);
  }

  /** Casts however many votes the elapsed voting time entitles the town to. */
  private castVotes(project: CommunityProjectState, def: CommunityProposalDef, now: number, pool: NPCState[]): void {
    if (pool.length === 0) return;
    const windowSeconds = cooldownSeconds(SOCIAL_CONFIG.community.voteWindowHours);
    const maxVotes = Math.max(def.supportRequired + 2, def.supportRequired * SOCIAL_CONFIG.community.maxVoteMultiplier);
    const elapsed = Math.max(0, now - project.startedAt);
    const entitledVotes = Math.floor(elapsed / windowSeconds) * SOCIAL_CONFIG.community.votesPerWindow;
    const desired = Math.min(maxVotes, entitledVotes);
    const cast = project.votesFor + project.votesAgainst;
    if (desired <= cast) return;
    for (let i = cast; i < desired; i += 1) {
      const voter = pool[i % pool.length];
      if (!voter) continue;
      const chance = this.voteSupportChance(voter, def, pool.length);
      if (this.ctx.probability.chance('social.interaction', chance)) project.votesFor += 1;
      else project.votesAgainst += 1;
    }
  }

  /** Probability a single resident votes in favour of a project. */
  voteSupportChance(voter: NPCState, def: CommunityProposalDef, poolSize: number): number {
    const state = this.ctx.state;
    const p = voter.personality;
    const rel = state.player.relationships[voter.id];
    const relationshipNorm = rel ? clamp01((relationshipScore(rel) + 100) / 200) : 0.35;
    const personality = 0.22 + p.generosity * 0.25 + p.responsibility * 0.2 + p.socialNeed * 0.1;
    const influence = clamp01(state.player.influence / 120) * 0.25;
    const interestMatches = countTagMatches(def.tags, voter.interests) * 0.06;
    const caresAboutPlace = isSamePlace(voter.locationId, def.locationId) ? 0.04 : 0;
    const contentious = def.tags.includes('controversial') ? -0.12 : 0;
    // A large population dilutes any single resident's enthusiasm.
    const crowdPenalty = poolSize > 24 ? 0.05 : 0;
    const raw =
      0.12 +
      relationshipNorm * 0.35 +
      personality * 0.3 +
      influence +
      interestMatches +
      caresAboutPlace +
      contentious -
      crowdPenalty;
    return clampProbability(raw, 0.03, 0.95);
  }

  /**
   * Resolves the vote once the discussion window has elapsed.
   * Returns true when a decision was made this call.
   */
  private maybeResolve(project: CommunityProjectState, def: CommunityProposalDef, now: number): boolean {
    const ctx = this.ctx;
    const votingSeconds = cooldownSeconds(SOCIAL_CONFIG.community.votingHours);
    if (now - project.startedAt < votingSeconds) return false;
    // Construction starts when the vote window closed, not when the update happened,
    // so offline catch-up advances construction by the correct amount of time.
    const votingEndedAt = project.startedAt + votingSeconds;
    const approved = project.votesFor >= project.requiredSupport && project.votesFor > project.votesAgainst;
    if (approved) {
      project.status = 'approved';
      project.completesAt = votingEndedAt + cooldownSeconds(def.constructionHours);
      project.funded = true;
      ctx.bus.emit('community:proposal', { project });
      addSocialHistory(ctx.state, {
        category: 'community',
        description:
          'Willowbrook approved ' + def.title + ' (' + String(project.votesFor) + ' for, ' + String(project.votesAgainst) + ' against). Building begins.',
        importance: 4,
        at: now,
        locationId: def.locationId,
      });
      ctx.bus.emit('game:signal', {
        name: 'community_approved',
        data: { projectId: project.id, proposalId: project.proposalId, votesFor: project.votesFor, votesAgainst: project.votesAgainst },
      });
      return true;
    } else {
      project.status = 'rejected';
      project.funded = false;
      addPlayerMoney(ctx, def.costPence, 'community_project_refund');
      ctx.bus.emit('community:proposal', { project });
      addSocialHistory(ctx.state, {
        category: 'community',
        description:
          'The town turned down ' + def.title + ' (' + String(project.votesFor) + ' for, ' + String(project.votesAgainst) + ' against). The funds were returned.',
        importance: 2,
        at: now,
        locationId: def.locationId,
      });
      ctx.bus.emit('game:signal', {
        name: 'community_rejected',
        data: { projectId: project.id, proposalId: project.proposalId, votesFor: project.votesFor, votesAgainst: project.votesAgainst },
      });
      return true;
    }
  }

  /** Applies the finished project's effects to the world and the player. */
  private completeProject(project: CommunityProjectState, def: CommunityProposalDef, now: number): void {
    const ctx = this.ctx;
    const state = ctx.state;
    project.status = 'complete';
    project.completesAt = project.completesAt ?? now;
    const locationState = state.world.locations[def.locationId];
    if (locationState) {
      locationState.condition = clamp01(locationState.condition + SOCIAL_CONFIG.community.completionLocationConditionBonus);
    }
    state.world.worldFlags['community:' + def.id] = true;
    for (const tag of def.tags) {
      state.world.worldFlags['community_feature:' + tag] = true;
    }
    state.flags['community_built:' + def.id] = true;
    state.player.communityPoints += SOCIAL_CONFIG.community.completionCommunityPoints;
    const influenceGain =
      SOCIAL_CONFIG.community.completionInfluenceGain +
      def.supportRequired * SOCIAL_CONFIG.community.completionInfluencePerSupport;
    awardInfluence(ctx, influenceGain);

    addSocialHistory(state, {
      category: 'community',
      description: def.title + ' is finished at ' + locationName(ctx.content, def.locationId) + '. ' + def.effects.join(' '),
      importance: 5,
      at: now,
      locationId: def.locationId,
    });
    const participantIds: NPCId[] = [];
    const npcIds = Object.keys(state.npcs).sort((a, b) => (a < b ? -1 : 1));
    for (const npcId of npcIds) {
      const npc = state.npcs[npcId];
      if (!npc || !npc.alive) continue;
      if (participantIds.length >= 12) break;
      if (!npc.isMajor) continue;
      participantIds.push(npc.id);
      recordNpcLifeEvent(npc, now, 'community', 'The town finished ' + def.title + '.', 3);
    }
    ctx.bus.emit('community:proposal', { project });
    ctx.bus.emit('game:signal', {
      name: 'community_completed',
      data: {
        projectId: project.id,
        proposalId: project.proposalId,
        title: def.title,
        locationId: def.locationId,
        locationName: locationName(ctx.content, def.locationId),
        effects: [...def.effects],
      },
    });
    ctx.logger.info('Community project completed: ' + def.title, {
      projectId: project.id,
      proposalId: def.id,
      locationId: def.locationId,
    });
  }

  /** UI helper: per-project vote standing in 0..1 (safe when no votes are cast). */
  getSupportRatio(project: CommunityProjectState): number {
    const total = project.votesFor + project.votesAgainst;
    if (total === 0) return 0;
    return roundDelta(project.votesFor / total);
  }

  /** UI helper: how many game hours remain until the vote/construction finishes. */
  getHoursRemaining(project: CommunityProjectState): number {
    const now = this.ctx.clock.simTimeSeconds;
    if (project.status === 'voting') {
      const until = project.startedAt + cooldownSeconds(SOCIAL_CONFIG.community.votingHours);
      return Math.max(0, (until - now) / 3600);
    }
    if (project.status === 'building' || project.status === 'approved') {
      if (project.completesAt === null) return 0;
      return Math.max(0, (project.completesAt - now) / 3600);
    }
    return 0;
  }
}
