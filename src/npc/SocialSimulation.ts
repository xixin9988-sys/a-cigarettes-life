// =============================================================================
// SocialSimulation - NPC-NPC social life independent of the player.
//
// Every ~15 in-game minutes co-located awake NPCs may interact. Interactions
// apply personality-scaled (asymmetric) affinity/trust/intimacy/familiarity
// deltas, leave memories, occasionally form friendships, romances, rivalries
// and breakups, append to state.social.npcSocialLog and the participants'
// life histories, and emit 'relationship:changed' for meaningful changes.
// Streams used: 'npc.social' (selection) and 'npc.memory' (memory formation).
// =============================================================================
import type { IGameContext, NPCState, RelationshipState } from '../core/contracts';
import type { LocationId, RelationshipStatus } from '../core/SharedTypes';
import { simSecondsToGameTime } from '../core/TimeUtil';
import { relationshipScore } from '../core/RelationshipUtil';
import { clamp, hashString } from '../core/utils';
import {
  NPC_MODULE,
  SIM_SECONDS_PER_GAME_DAY,
  SIM_SECONDS_PER_GAME_MINUTE,
  activityGroupOf,
  isSleepActivity,
  readNpcExtras,
  writeNpcExtras,
} from './NPC';
import {
  deriveProfile,
  normalisePersonality,
  romanceCompatibility,
  socialCompatibility,
} from './PersonalitySystem';
import type { RelationshipDelta } from '../core/RelationshipUtil';
import { RelationshipSystem, type PairDeltas } from './RelationshipSystem';
import type { MemorySystem } from './MemorySystem';
import type { NPCArchive } from './NPCArchive';
import type { NeedSystem } from './NeedSystem';
import type { PersonalitySystem } from './PersonalitySystem';

const SOCIAL_STREAM = 'npc.social';
const MEMORY_STREAM = 'npc.memory';

type InteractionKind =
  | 'greet'
  | 'small_talk'
  | 'chat'
  | 'gossip'
  | 'joke'
  | 'help'
  | 'heart_to_heart'
  | 'flirt'
  | 'date'
  | 'family_chat'
  | 'argument'
  | 'bicker'
  | 'cold_shoulder'
  | 'avoid'
  | 'awkward_chat';

interface KindEffect {
  affinity: number;
  trust: number;
  intimacy: number;
  familiarity: number;
  positive: boolean;
}

const KIND_EFFECTS: Readonly<Record<InteractionKind, KindEffect>> = {
  greet: { affinity: 0.8, trust: 0.1, intimacy: 0, familiarity: 1.0, positive: true },
  small_talk: { affinity: 1.2, trust: 0.2, intimacy: 0.05, familiarity: 1.2, positive: true },
  chat: { affinity: 2.0, trust: 0.5, intimacy: 0.2, familiarity: 1.6, positive: true },
  gossip: { affinity: 1.6, trust: 0.3, intimacy: 0.6, familiarity: 1.8, positive: true },
  joke: { affinity: 2.2, trust: 0.4, intimacy: 0.3, familiarity: 1.4, positive: true },
  help: { affinity: 2.6, trust: 1.2, intimacy: 0.2, familiarity: 1.5, positive: true },
  heart_to_heart: { affinity: 2.8, trust: 1.6, intimacy: 1.5, familiarity: 2.0, positive: true },
  flirt: { affinity: 2.4, trust: 0.8, intimacy: 1.8, familiarity: 1.5, positive: true },
  date: { affinity: 3.0, trust: 1.0, intimacy: 2.4, familiarity: 1.8, positive: true },
  family_chat: { affinity: 2.0, trust: 1.0, intimacy: 0.8, familiarity: 1.5, positive: true },
  argument: { affinity: -3.2, trust: -1.8, intimacy: -0.4, familiarity: 0.6, positive: false },
  bicker: { affinity: -1.8, trust: -0.9, intimacy: -0.2, familiarity: 0.5, positive: false },
  cold_shoulder: { affinity: -1.0, trust: -0.6, intimacy: 0, familiarity: 0.4, positive: false },
  avoid: { affinity: -0.3, trust: -0.1, intimacy: 0, familiarity: 0.2, positive: false },
  awkward_chat: { affinity: 0.2, trust: 0, intimacy: 0, familiarity: 0.8, positive: false },
};

const MILESTONE_KIND_LABELS: Readonly<Record<string, string>> = {
  greet: 'greeted',
  small_talk: 'chatted with',
  chat: 'had a good chat with',
  gossip: 'shared some gossip with',
  joke: 'shared a laugh with',
  help: 'helped',
  heart_to_heart: 'had a heart-to-heart with',
  flirt: 'flirted with',
  date: 'spent a lovely evening with',
  family_chat: 'caught up with',
  argument: 'argued with',
  bicker: 'bickered with',
  cold_shoulder: 'gave the cold shoulder to',
  avoid: 'avoided',
  awkward_chat: 'had an awkward exchange with',
};

export interface SocialOutcome {
  npcA: string;
  npcB: string;
  kind: string;
  positive: boolean;
  description: string;
  locationId: LocationId;
  deltaA: RelationshipDelta;
  deltaB: RelationshipDelta;
  statusBefore: { a: RelationshipStatus; b: RelationshipStatus };
  statusAfter: { a: RelationshipStatus; b: RelationshipStatus };
  /** True when a friendship/romance/rivalry/breakup milestone happened. */
  milestone: string | null;
}

export interface SocialUpdateResult {
  slots: number;
  interactions: number;
  statusChanges: number;
}

export interface SocialSimulationDeps {
  personality: PersonalitySystem;
  relationships: RelationshipSystem;
  memory: MemorySystem;
  archive: NPCArchive;
  needs: NeedSystem;
}

function statusRank(status: RelationshipStatus): number {
  switch (status) {
    case 'stranger':
      return 0;
    case 'acquaintance':
      return 1;
    case 'friend':
      return 2;
    case 'close_friend':
      return 3;
    case 'dating':
      return 4;
    case 'partner':
      return 5;
    default:
      return 2;
  }
}

export class SocialSimulation {
  private readonly personality: PersonalitySystem;
  private readonly relationships: RelationshipSystem;
  private readonly memory: MemorySystem;
  private readonly archive: NPCArchive;
  private readonly needs: NeedSystem;

  constructor(deps: SocialSimulationDeps) {
    this.personality = deps.personality;
    this.relationships = deps.relationships;
    this.memory = deps.memory;
    this.archive = deps.archive;
    this.needs = deps.needs;
  }

  /** Scheduled NPC-NPC social tick. Safe with huge offline dt (slot cap). */
  update(ctx: IGameContext): SocialUpdateResult {
    const state = ctx.state;
    const now = ctx.clock.simTimeSeconds;
    const interval = NPC_MODULE.socialIntervalGameMinutes * SIM_SECONDS_PER_GAME_MINUTE;
    const last = state.social.lastNpcSocialAt;
    if (!Number.isFinite(last) || last <= 0) {
      state.social.lastNpcSocialAt = now;
      return { slots: 0, interactions: 0, statusChanges: 0 };
    }
    const elapsed = now - last;
    if (elapsed < interval) return { slots: 0, interactions: 0, statusChanges: 0 };
    const rawSlots = Math.floor(elapsed / interval);
    const slots = Math.max(1, Math.min(rawSlots, NPC_MODULE.maxSocialSlotsPerUpdate));
    // When offline catch-up has skipped many slots, sample the capped number
    // evenly across the whole window instead of only at the end.
    const slotTimes: number[] = [];
    if (rawSlots <= slots) {
      for (let index = 1; index <= slots; index += 1) slotTimes.push(last + index * interval);
    } else {
      const span = now - last;
      for (let index = 1; index <= slots; index += 1) {
        slotTimes.push(last + (span * index) / (slots + 1));
      }
    }
    let interactions = 0;
    let statusChanges = 0;
    for (const slotTime of slotTimes) {
      const result = this.simulateSlot(ctx, slotTime);
      interactions += result.interactions;
      statusChanges += result.statusChanges;
    }
    state.social.lastNpcSocialAt = now;
    return { slots, interactions, statusChanges };
  }

  /** One social slot: co-located awake NPCs are paired and may interact. */
  private simulateSlot(ctx: IGameContext, slotTime: number): { interactions: number; statusChanges: number } {
    const state = ctx.state;
    const locationMembers = new Map<LocationId, NPCState[]>();
    const npcs = Object.values(state.npcs).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const npc of npcs) {
      if (!npc.alive) continue;
      if (isSleepActivity(npc.currentActivity)) continue;
      const bucket = locationMembers.get(npc.locationId);
      if (bucket) bucket.push(npc);
      else locationMembers.set(npc.locationId, [npc]);
    }
    const locations = [...locationMembers.keys()].sort();
    const time = simSecondsToGameTime(slotTime);
    const hour = time.hour + time.minute / 60;
    let interactions = 0;
    let statusChanges = 0;
    for (const locationId of locations) {
      if (interactions >= NPC_MODULE.maxInteractionsPerSocialSlot) break;
      const members = locationMembers.get(locationId);
      if (!members || members.length < 2) continue;
      const shuffled = ctx.rng.shuffle(SOCIAL_STREAM, members);
      for (let index = 0; index + 1 < shuffled.length; index += 2) {
        if (interactions >= NPC_MODULE.maxInteractionsPerSocialSlot) break;
        const a = shuffled[index];
        const b = shuffled[index + 1];
        if (!a || !b) continue;
        if (!this.dailyBudgetAllows(a, slotTime) || !this.dailyBudgetAllows(b, slotTime)) continue;
        const chance = this.pairInteractionChance(a, b, hour);
        if (!ctx.probability.chance(SOCIAL_STREAM, chance)) continue;
        const outcome = this.simulatePair(ctx, a, b, slotTime);
        if (!outcome) continue;
        this.consumeDailyBudget(a, slotTime);
        this.consumeDailyBudget(b, slotTime);
        interactions += 1;
        if (outcome.statusBefore.a !== outcome.statusAfter.a || outcome.statusBefore.b !== outcome.statusAfter.b) {
          statusChanges += 1;
        }
      }
    }
    return { interactions, statusChanges };
  }

  /** Per-slot chance that a co-located pair chooses to interact. */
  private pairInteractionChance(a: NPCState, b: NPCState, hour: number): number {
    const profileA = deriveProfile(normalisePersonality(a.personality));
    const profileB = deriveProfile(normalisePersonality(b.personality));
    let chance =
      NPC_MODULE.basePairInteractionChance +
      0.3 * ((profileA.socialDrive + profileB.socialDrive) / 2) -
      0.14 * ((profileA.homeDrive + profileB.homeDrive) / 2);
    const groupA = activityGroupOf(a.currentActivity);
    const groupB = activityGroupOf(b.currentActivity);
    if (groupA === 'work' && groupB === 'work') chance *= 0.3;
    else if (groupA === 'work' || groupB === 'work') chance *= 0.65;
    if (groupA === 'social' || groupB === 'social') chance *= 1.35;
    if (hour >= 23 || hour < 6) chance *= 0.4;
    const rel = a.relationships[b.id];
    if (rel && (rel.status === 'dating' || rel.status === 'partner')) chance *= 1.6;
    else if (rel && rel.status === 'close_friend') chance *= 1.3;
    else if (rel && (rel.status === 'rival' || rel.status === 'enemy')) chance *= 1.1;
    return clamp(chance, 0.03, 0.85);
  }

  /**
   * Simulates a single interaction between two NPCs (public so tests/integration
   * can exercise specific pairs; the daily scheduler budget is enforced by
   * simulateSlot, not here).
   */
  simulatePair(
    ctx: IGameContext,
    a: NPCState,
    b: NPCState,
    now: number,
    forcedKind?: string
  ): SocialOutcome | null {
    if (!a.alive || !b.alive || a.id === b.id) return null;
    this.relationships.ensureBilateral(a, b, now);
    const relA = this.relationships.ensure(a, b.id, now);
    const relB = this.relationships.ensure(b, a.id, now);
    const statusBefore = { a: relA.status, b: relB.status };
    const kind = (forcedKind ?? this.chooseKind(ctx, a, b, relA)) as InteractionKind;
    const effect = KIND_EFFECTS[kind];
    if (!effect) return null;
    const deltas = this.computeDeltas(a, b, relA, effect);
    this.relationships.applyInteraction(a, b, deltas, now);
    const afterA = this.relationships.ensure(a, b.id, now);
    const afterB = this.relationships.ensure(b, a.id, now);
    const statusAfter = { a: afterA.status, b: afterB.status };
    this.applyNeedEffects(a, effect.positive, kind);
    this.applyNeedEffects(b, effect.positive, kind);
    const description = this.describe(ctx, a, b, kind);
    this.appendSocialLog(ctx, a, b, kind, description, now);
    this.recordMemories(ctx, a, b, kind, effect, description, now);
    const milestone = this.handleMilestones(ctx, a, b, afterA, afterB, statusBefore, effect.positive, now);
    if (
      statusAfter.a !== statusBefore.a ||
      statusAfter.b !== statusBefore.b ||
      Math.abs(deltas.a.affinity ?? 0) >= 2.5 ||
      Math.abs(deltas.b.affinity ?? 0) >= 2.5
    ) {
      ctx.bus.emit('relationship:changed', {
        npcId: a.id,
        kind: 'npc_npc',
        affinity: afterA.affinity,
        trust: afterA.trust,
        intimacy: afterA.intimacy,
        status: afterA.status,
      });
    }
    return {
      npcA: a.id,
      npcB: b.id,
      kind,
      positive: effect.positive,
      description,
      locationId: a.locationId,
      deltaA: deltas.a,
      deltaB: deltas.b,
      statusBefore,
      statusAfter,
      milestone,
    };
  }

  /** Chooses an interaction kind appropriate to the current relationship. */
  private chooseKind(ctx: IGameContext, a: NPCState, b: NPCState, rel: RelationshipState): InteractionKind {
    const options: { weight: number; value: InteractionKind }[] = [];
    const status = rel.status;
    if (status === 'enemy') {
      options.push({ weight: 3, value: 'argument' }, { weight: 1.2, value: 'cold_shoulder' }, { weight: 0.8, value: 'avoid' });
    } else if (status === 'rival') {
      options.push({ weight: 2, value: 'argument' }, { weight: 2, value: 'bicker' }, { weight: 1, value: 'cold_shoulder' });
    } else if (status === 'partner' || status === 'dating') {
      options.push({ weight: 3, value: 'flirt' }, { weight: 2, value: 'date' }, { weight: 1.4, value: 'heart_to_heart' });
    } else if (status === 'family') {
      options.push({ weight: 3, value: 'family_chat' }, { weight: 1.4, value: 'help' }, { weight: 1, value: 'gossip' });
    } else if (status === 'close_friend') {
      options.push({ weight: 2.4, value: 'heart_to_heart' }, { weight: 2, value: 'chat' }, { weight: 1.4, value: 'joke' });
    } else if (status === 'friend') {
      options.push({ weight: 3, value: 'chat' }, { weight: 1.6, value: 'gossip' }, { weight: 1, value: 'joke' }, { weight: 0.8, value: 'help' });
    } else if (status === 'acquaintance') {
      options.push({ weight: 3, value: 'small_talk' }, { weight: 2, value: 'chat' }, { weight: 1, value: 'gossip' });
    } else if (status === 'ex') {
      options.push({ weight: 2, value: 'awkward_chat' }, { weight: 1, value: 'avoid' });
    } else {
      options.push({ weight: 2.5, value: 'greet' }, { weight: 1.5, value: 'small_talk' });
    }
    // Hostile relationships may spill over into open conflict.
    const score = relationshipScore(rel);
    if (score <= -15 && status !== 'rival' && status !== 'enemy') {
      options.push({ weight: 1.4, value: 'bicker' });
    }
    if (rel.affinity > 25 && rel.trust > 20 && status !== 'partner' && status !== 'dating') {
      options.push({ weight: 1.2, value: 'help' });
    }
    // Personality weights: extraverts favour lively kinds, introverts quiet ones.
    const profileA = deriveProfile(normalisePersonality(a.personality));
    const profileB = deriveProfile(normalisePersonality(b.personality));
    const liveliness = (profileA.socialDrive + profileB.socialDrive) / 2;
    for (const option of options) {
      if (option.value === 'joke' || option.value === 'gossip' || option.value === 'flirt') {
        option.weight *= 0.6 + liveliness;
      }
      if (option.value === 'awkward_chat' || option.value === 'avoid') {
        option.weight *= 1.2 - liveliness * 0.4;
      }
    }
    const picked = ctx.probability.weighted(SOCIAL_STREAM, options);
    return picked ?? 'small_talk';
  }

  /**
   * Interaction deltas are asymmetric: compatibility, generosity and the
   * recipient's warmth decide how each side feels afterwards.
   */
  private computeDeltas(a: NPCState, b: NPCState, rel: RelationshipState, effect: KindEffect): PairDeltas {
    const personalityA = normalisePersonality(a.personality);
    const personalityB = normalisePersonality(b.personality);
    const compatibility = socialCompatibility(personalityA, personalityB);
    const profileA = deriveProfile(personalityA);
    const profileB = deriveProfile(personalityB);
    let contextFactor = 1;
    const groupA = activityGroupOf(a.currentActivity);
    const groupB = activityGroupOf(b.currentActivity);
    if (groupA === 'work' && groupB === 'work') contextFactor *= 0.75;
    if (groupA === 'social' || groupB === 'social') contextFactor *= 1.15;
    if (groupA === 'leisure' || groupB === 'leisure') contextFactor *= 1.05;
    const stressFactor = effect.positive
      ? 1
      : 0.8 + 0.5 * ((clamp(a.needs.workPressure / 100, 0, 1) + clamp(b.needs.workPressure / 100, 0, 1)) / 2);
    const base = (0.7 + 0.6 * compatibility) * contextFactor * stressFactor;
    const gainA = effect.positive
      ? base * (0.8 + 0.45 * profileA.socialDrive) * (1 + (rel.affinity > 0 ? 0.1 : 0))
      : base * (0.9 + 0.4 * profileA.cautionDrive);
    const gainB = effect.positive
      ? base * (0.8 + 0.45 * profileB.socialDrive) * (1 + (rel.affinity > 0 ? 0.1 : 0))
      : base * (0.9 + 0.4 * profileB.cautionDrive);
    const deltaA: RelationshipDelta = {
      affinity: effect.affinity * gainA,
      trust: effect.trust * gainA,
      intimacy: effect.intimacy * gainA,
      familiarity: effect.familiarity * (0.85 + 0.3 * profileA.curiosity),
    };
    const deltaB: RelationshipDelta = {
      affinity: effect.affinity * gainB,
      trust: effect.trust * gainB,
      intimacy: effect.intimacy * gainB,
      familiarity: effect.familiarity * (0.85 + 0.3 * profileB.curiosity),
    };
    return { a: deltaA, b: deltaB };
  }

  private applyNeedEffects(npc: NPCState, positive: boolean, kind: InteractionKind): void {
    const intensity = kind === 'heart_to_heart' || kind === 'date' || kind === 'family_chat' ? 1.6 : kind === 'greet' ? 0.5 : 1;
    if (positive) {
      this.needs.applyExternalDelta(npc, { social: 5 * intensity, belonging: 2 * intensity, fun: 2 * intensity });
    } else {
      this.needs.applyExternalDelta(npc, { social: -2 * intensity, fun: -2 * intensity, belonging: -1 });
    }
  }

  private describe(ctx: IGameContext, a: NPCState, b: NPCState, kind: InteractionKind): string {
    const locationName =
      ctx.content.getLocation(a.locationId)?.name ?? ctx.state.world.locations[a.locationId]?.name ?? a.locationId;
    const label = MILESTONE_KIND_LABELS[kind] ?? 'interacted with';
    return a.name + ' ' + label + ' ' + b.name + ' at ' + locationName + '.';
  }

  private appendSocialLog(
    ctx: IGameContext,
    a: NPCState,
    b: NPCState,
    kind: string,
    description: string,
    now: number
  ): void {
    const log = ctx.state.social.npcSocialLog;
    log.push({ at: now, npcA: a.id, npcB: b.id, kind, description });
    const cap = NPC_MODULE.npcSocialLogCap;
    if (log.length > cap) log.splice(0, log.length - cap);
  }

  private recordMemories(
    ctx: IGameContext,
    a: NPCState,
    b: NPCState,
    kind: InteractionKind,
    effect: KindEffect,
    description: string,
    now: number
  ): void {
    const strong = kind === 'heart_to_heart' || kind === 'flirt' || kind === 'date' || kind === 'family_chat';
    const negative = !effect.positive;
    const roll = ctx.probability.chance(MEMORY_STREAM, negative ? 0.8 : strong ? 0.55 : 0.22);
    if (!roll) return;
    const importance = negative
      ? 14
      : strong
        ? 22
        : 6 + (hashString(a.id + b.id + kind + Math.floor(now)) % 9);
    this.memory.addMemory(
      a,
      {
        type: 'social:' + kind,
        text: description,
        participantIds: [b.id],
        importance,
        emotionalValue: negative ? -5 : strong ? 6 : 2,
      },
      now
    );
    this.memory.addMemory(
      b,
      {
        type: 'social:' + kind,
        text: description,
        participantIds: [a.id],
        importance,
        emotionalValue: negative ? -5 : strong ? 6 : 2,
      },
      now
    );
  }

  // ---------------------------------------------------------------------------
  // Milestones: friendship, close friendship, rivalry, romance, partnership,
  // breakups. Each transition is archived once and marked with a flag.
  // ---------------------------------------------------------------------------
  private handleMilestones(
    ctx: IGameContext,
    a: NPCState,
    b: NPCState,
    relA: RelationshipState,
    relB: RelationshipState,
    statusBefore: { a: RelationshipStatus; b: RelationshipStatus },
    positive: boolean,
    now: number
  ): string | null {
    const before = statusRank(statusBefore.a);
    const after = statusRank(relA.status);
    let milestone: string | null = null;
    // Friendship milestones.
    if (positive && (relA.status === 'friend' || relA.status === 'close_friend') && !relA.flags.includes('npc_friend_archived')) {
      relA.flags.push('npc_friend_archived');
      if (!relB.flags.includes('npc_friend_archived')) relB.flags.push('npc_friend_archived');
      this.archive.firstFriend(ctx, a, b);
      this.archive.firstFriend(ctx, b, a, false);
      milestone = 'first_friend';
    } else if (positive && relA.status === 'close_friend' && before < 3 && relA.flags.includes('npc_friend_archived')) {
      if (!relA.flags.includes('npc_close_friend_archived')) {
        relA.flags.push('npc_close_friend_archived');
        relB.flags.push('npc_close_friend_archived');
        this.archive.closeFriend(ctx, a, b);
        this.archive.closeFriend(ctx, b, a, false);
        milestone = 'close_friend';
      }
    }
    if (!positive && (relA.status === 'rival' || relA.status === 'enemy') && !relA.flags.includes('npc_rival_archived')) {
      relA.flags.push('npc_rival_archived');
      relB.flags.push('npc_rival_archived');
      this.archive.rivalry(ctx, a, b);
      this.archive.rivalry(ctx, b, a, false);
      milestone = 'rivalry';
    }
    // Romance milestones.
    if (positive) {
      const romance = this.maybeFormRomance(ctx, a, b, relA, relB, now);
      if (romance) milestone = romance;
      else if (relA.status === 'dating' && relA.intimacy >= 68 && relA.affinity >= 62) {
        if (ctx.probability.chance(SOCIAL_STREAM, 0.12)) {
          this.relationships.setStatus(a, b, 'partner', now);
          this.archive.romance(ctx, a, b, a.name + ' and ' + b.name + ' are now partners.');
          this.archive.romance(ctx, b, a, a.name + ' and ' + b.name + ' are now partners.', false);
          milestone = 'partner';
        }
      }
    } else if ((relA.status === 'dating' || relA.status === 'partner') && relA.affinity < 8) {
      if (ctx.probability.chance(SOCIAL_STREAM, 0.3)) {
        this.relationships.setStatus(a, b, 'ex', now);
        relA.flags.push('npc_breakup_archived');
        relB.flags.push('npc_breakup_archived');
        this.archive.breakup(ctx, a, b);
        this.archive.breakup(ctx, b, a, undefined, false);
        milestone = 'breakup';
      }
    }
    return milestone;
  }

  private maybeFormRomance(
    ctx: IGameContext,
    a: NPCState,
    b: NPCState,
    relA: RelationshipState,
    relB: RelationshipState,
    now: number
  ): string | null {
    if (relA.status === 'dating' || relA.status === 'partner' || relA.status === 'family') return null;
    if (relA.flags.includes('npc_breakup_archived')) return null;
    const defA = ctx.content.getNPC(a.id);
    const defB = ctx.content.getNPC(b.id);
    if (!defA?.romanceable || !defB?.romanceable) return null;
    if (a.lifeStage === 'child' || b.lifeStage === 'child') return null;
    if (this.hasPartner(a) || this.hasPartner(b)) return null;
    if (relA.affinity < 38 || relA.trust < 28 || relA.intimacy < 22 || relA.familiarity < 35) return null;
    if (relB.affinity < 30 || relB.trust < 22) return null;
    const compatibility = romanceCompatibility(
      normalisePersonality(a.personality),
      normalisePersonality(b.personality)
    );
    const chance = clamp(NPC_MODULE.romanceFormationChance * (0.5 + compatibility), 0.02, 0.4);
    if (!ctx.probability.chance(SOCIAL_STREAM, chance)) return null;
    this.relationships.setStatus(a, b, 'dating', now);
    this.relationships.markFlag(a, b, 'npc_romance_archived', now);
    this.archive.romance(ctx, a, b);
    this.archive.romance(ctx, b, a, undefined, false);
    return 'romance';
  }

  private hasPartner(npc: NPCState): boolean {
    for (const rel of Object.values(npc.relationships)) {
      if (rel.status === 'dating' || rel.status === 'partner') return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Daily social budget (prevents runaway interaction spam during updates).
  // ---------------------------------------------------------------------------
  private dailyBudgetAllows(npc: NPCState, now: number): boolean {
    const day = Math.floor(now / SIM_SECONDS_PER_GAME_DAY);
    const extras = readNpcExtras(npc);
    if (extras.socialDay !== day) return true;
    return (extras.socialCount ?? 0) < NPC_MODULE.maxSocialInteractionsPerNpcDay;
  }

  private consumeDailyBudget(npc: NPCState, now: number): void {
    const day = Math.floor(now / SIM_SECONDS_PER_GAME_DAY);
    const extras = readNpcExtras(npc);
    if (extras.socialDay !== day) {
      extras.socialDay = day;
      extras.socialCount = 1;
    } else {
      extras.socialCount = (extras.socialCount ?? 0) + 1;
    }
    writeNpcExtras(npc, extras);
  }
}
