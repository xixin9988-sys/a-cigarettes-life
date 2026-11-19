import { describe, expect, it } from 'vitest';
import { COMMUNITY_PROPOSALS } from '../../src/data/community/community';
import { LOC } from '../../src/data/locations/ids';
import {
  advance,
  advanceDays,
  advanceHours,
  createSocialHarness,
  eventsOf,
  placeAtPlayer,
  setRelationship,
} from './support/harness';
import type { SocialHarness } from './support/harness';

const CHEAP = 'proposal_tree_planting';
const EXPENSIVE = 'proposal_library_extension';

function boostInfluence(h: SocialHarness, value: number): void {
  h.state.player.influence = value;
}

function makeFriendlyTown(h: SocialHarness, affinity = 80): void {
  for (const npcId of Object.keys(h.state.npcs)) {
    const npc = h.state.npcs[npcId];
    if (!npc) continue;
    placeAtPlayer(h, npcId);
    setRelationship(h, npcId, { affinity, trust: 70, intimacy: 20, familiarity: 60, status: 'friend' });
  }
}

describe('proposeCommunityProject validation', () => {
  it('rejects unknown proposals', () => {
    const h = createSocialHarness({ playerMoney: 100000 });
    const result = h.social.proposeCommunityProject('proposal_does_not_exist');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_found');
  });

  it('requires enough influence', () => {
    const h = createSocialHarness({ playerMoney: 100000 });
    const result = h.social.proposeCommunityProject(EXPENSIVE);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('requirement_not_met');
    expect(h.state.player.money).toBe(100000);
  });

  it('requires enough money', () => {
    const h = createSocialHarness({ playerMoney: 100 });
    boostInfluence(h, 30);
    const result = h.social.proposeCommunityProject(EXPENSIVE);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_enough_money');
    expect(h.state.social.communityProjects).toHaveLength(0);
  });

  it('requires the site to be discovered and unlocked', () => {
    const h = createSocialHarness({ playerMoney: 100000 });
    boostInfluence(h, 30);
    const state = h.state.world.locations[LOC.countryside];
    expect(state).toBeDefined();
    if (!state) return;
    state.unlocked = false;
    const result = h.social.proposeCommunityProject(CHEAP);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('locked');
  });

  it('creates a voting project, takes the money and emits the proposal event', () => {
    const h = createSocialHarness({ playerMoney: 100000 });
    boostInfluence(h, 10);
    const def = COMMUNITY_PROPOSALS.find((proposal) => proposal.id === CHEAP);
    expect(def).toBeDefined();
    if (!def) return;
    const result = h.social.proposeCommunityProject(CHEAP);
    expect(result.ok).toBe(true);
    const projects = h.social.getCommunityProjects();
    expect(projects).toHaveLength(1);
    const project = projects[0];
    expect(project?.proposalId).toBe(CHEAP);
    expect(project?.status).toBe('voting');
    expect(project?.votesFor).toBe(0);
    expect(project?.votesAgainst).toBe(0);
    expect(project?.requiredSupport).toBe(def.supportRequired);
    expect(project?.funded).toBe(true);
    expect(h.state.player.money).toBe(100000 - def.costPence);
    expect(eventsOf(h, 'community:proposal')).toHaveLength(1);
    expect(h.state.world.history.some((entry) => entry.category === 'community')).toBe(true);
    expect(eventsOf(h, 'money:changed')).toHaveLength(1);
  });

  it('does not allow two live projects for the same proposal', () => {
    const h = createSocialHarness({ playerMoney: 100000 });
    boostInfluence(h, 30);
    expect(h.social.proposeCommunityProject(CHEAP).ok).toBe(true);
    const second = h.social.proposeCommunityProject(CHEAP);
    expect(second.ok).toBe(false);
    expect(second.code).toBe('invalid');
    expect(h.state.social.communityProjects).toHaveLength(1);
  });
});

describe('voting', () => {
  it('casts votes over time deterministically (2 votes per 2 game hours)', () => {
    const h = createSocialHarness({ playerMoney: 100000 });
    boostInfluence(h, 10);
    makeFriendlyTown(h);
    expect(h.social.proposeCommunityProject(CHEAP).ok).toBe(true);
    const project = h.social.getCommunityProjects()[0];
    expect(project).toBeDefined();
    if (!project) return;
    advanceHours(h, 6);
    const after6 = project.votesFor + project.votesAgainst;
    expect(after6).toBe(6);
    advanceHours(h, 2);
    const after8 = project.votesFor + project.votesAgainst;
    expect(after8).toBe(8);
    expect(project.status).toBe('voting');
    const support = h.social.getCommunitySystem().getSupportRatio(project);
    expect(support).toBeGreaterThanOrEqual(0);
    expect(support).toBeLessThanOrEqual(1);
    expect(h.social.getCommunitySystem().getHoursRemaining(project)).toBeGreaterThan(0);
  });

  it('resolves to approved once support requirements are met, then constructs and completes', () => {
    const h = createSocialHarness({ playerMoney: 100000 });
    boostInfluence(h, 30);
    makeFriendlyTown(h);
    expect(h.social.proposeCommunityProject(CHEAP).ok).toBe(true);
    const def = COMMUNITY_PROPOSALS.find((proposal) => proposal.id === CHEAP);
    const project = h.social.getCommunityProjects()[0];
    expect(def && project).toBeTruthy();
    if (!def || !project) return;

    // Force a clear majority and a finished voting window.
    project.votesFor = 9; // equals the maximum votes the cap allows for this proposal
    project.votesAgainst = 0;
    project.startedAt = h.clock.simTimeSeconds - 25 * 60;
    const locationState = h.state.world.locations[def.locationId];
    if (locationState) locationState.condition = 0.6;
    const beforeInfluence = h.state.player.influence;
    const beforeCondition = locationState?.condition ?? 0;
    advance(h, 60);
    // The state machine runs in one pass: vote -> approved -> building.
    expect(project.status).toBe('building');
    expect(project.completesAt).not.toBeNull();
    expect(eventsOf(h, 'game:signal').some((payload) => JSON.stringify(payload).includes('community_approved'))).toBe(true);
    advanceHours(h, def.constructionHours + 1);
    expect(project.status).toBe('complete');
    expect(h.state.world.worldFlags['community:' + def.id]).toBe(true);
    expect(h.state.player.communityPoints).toBeGreaterThan(0);
    expect(h.state.player.influence).toBeGreaterThan(beforeInfluence);
    const condition = h.state.world.locations[def.locationId]?.condition ?? 0;
    expect(condition).toBeGreaterThan(beforeCondition);
    const completionHistory = h.state.world.history.filter((entry) => entry.importance >= 5 && entry.category === 'community');
    expect(completionHistory.length).toBeGreaterThan(0);
    expect(completionHistory[0]?.description).toContain(def.title);
    expect(eventsOf(h, 'game:signal').some((payload) => JSON.stringify(payload).includes('community_completed'))).toBe(true);
    // Major NPCs remember the day.
    const remembered = Object.values(h.state.npcs).filter((npc) =>
      npc.lifeHistory.some((entry) => entry.type === 'community')
    );
    expect(remembered.length).toBeGreaterThan(0);
  });

  it('rejected projects refund the funds and leave a record', () => {
    const h = createSocialHarness({ playerMoney: 100000 });
    boostInfluence(h, 10);
    expect(h.social.proposeCommunityProject(CHEAP).ok).toBe(true);
    const def = COMMUNITY_PROPOSALS.find((proposal) => proposal.id === CHEAP);
    const project = h.social.getCommunityProjects()[0];
    expect(def && project).toBeTruthy();
    if (!def || !project) return;
    project.votesFor = 0;
    project.votesAgainst = def.supportRequired + 2;
    project.startedAt = h.clock.simTimeSeconds - 25 * 60;
    const beforeMoney = h.state.player.money;
    advance(h, 60);
    expect(project.status).toBe('rejected');
    expect(project.funded).toBe(false);
    expect(h.state.player.money).toBe(beforeMoney + def.costPence);
    expect(eventsOf(h, 'game:signal').some((payload) => JSON.stringify(payload).includes('community_rejected'))).toBe(true);
    expect(h.state.world.history.some((entry) => entry.description.includes('turned down'))).toBe(true);
  });

  it('allows re-proposing after a rejection', () => {
    const h = createSocialHarness({ playerMoney: 100000 });
    boostInfluence(h, 10);
    expect(h.social.proposeCommunityProject(CHEAP).ok).toBe(true);
    const project = h.social.getCommunityProjects()[0];
    expect(project).toBeDefined();
    if (!project) return;
    project.status = 'rejected';
    project.votesAgainst = 99;
    expect(h.social.proposeCommunityProject(CHEAP).ok).toBe(true);
    expect(h.social.getCommunityProjects()).toHaveLength(2);
  });

  it('votes deterministically for the same seed and setup', () => {
    const run = (): string => {
      const h = createSocialHarness({ seed: 555, playerMoney: 100000 });
      boostInfluence(h, 20);
      makeFriendlyTown(h);
      h.social.proposeCommunityProject(CHEAP);
      advanceHours(h, 20);
      const project = h.social.getCommunityProjects()[0];
      return JSON.stringify({ votesFor: project?.votesFor, votesAgainst: project?.votesAgainst, status: project?.status });
    };
    expect(run()).toBe(run());
  });

  it('community projects resolve inside a single huge offline tick', () => {
    const h = createSocialHarness({ playerMoney: 100000 });
    boostInfluence(h, 30);
    makeFriendlyTown(h);
    expect(h.social.proposeCommunityProject(CHEAP).ok).toBe(true);
    advanceDays(h, 3);
    const project = h.social.getCommunityProjects()[0];
    expect(project).toBeDefined();
    if (!project) return;
    expect(project.status === 'complete' || project.status === 'rejected').toBe(true);
    expect(h.social.getCommunitySystem().getHoursRemaining(project)).toBe(0);
  });
});
