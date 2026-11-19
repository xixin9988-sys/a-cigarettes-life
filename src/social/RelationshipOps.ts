import type {
  ActionResult,
  GameState,
  IGameContext,
  InteractionLogEntry,
  ISkillSystem,
  NPCMemoryState,
  NPCState,
  RelationshipState,
} from '../core/contracts';
import type { ItemId, NPCId, QualityStars, SocialInteractionKind } from '../core/SharedTypes';
import { applyRelationshipDelta, ensureRelationship, knowsNpc } from '../core/RelationshipUtil';
import { addItemToInventory } from '../core/InventoryUtil';
import { clamp, clamp01 } from '../core/utils';
import { SOCIAL_CONFIG } from './config';
import { nextSequentialId, roundDelta } from './socialUtils';

export interface InteractionDelta {
  affinity?: number;
  trust?: number;
  intimacy?: number;
  familiarity?: number;
}

export interface InteractionResult {
  relationship: RelationshipState;
  affinityDelta: number;
  trustDelta: number;
  intimacyDelta: number;
  firstMeeting: boolean;
}

export interface SocialMemoryInit {
  type: string;
  text: string;
  /** 1..100 (values >= 80 become permanent). */
  importance: number;
  /** -10..+10 emotional polarity. */
  emotionalValue: number;
  permanent?: boolean;
  participantIds?: NPCId[];
}

/** Returns (creating if needed) the player's relationship with an NPC. */
export function ensureKnown(ctx: IGameContext, npc: NPCState): RelationshipState {
  const now = ctx.clock.simTimeSeconds;
  const rel = ensureRelationship(ctx.state.player.relationships, npc.id, now);
  if (!knowsNpc(rel)) {
    // First contact: remember the meeting.
    rel.firstMetAt = now;
  }
  return rel;
}

/** True when the player has already been introduced to this NPC (any interaction or dialogue). */
export function hasMet(ctx: IGameContext, npcId: NPCId): boolean {
  if (ctx.state.flags['met:' + npcId] === true) return true;
  const rel = ctx.state.player.relationships[npcId];
  return Boolean(rel && (rel.interactionCount > 0 || rel.familiarity > 0));
}

/**
 * Marks the first meeting with an NPC: sets the persistent flag, bumps the
 * npcs-met statistic and emits 'npc:met'. Returns true only on the first call.
 */
export function markMet(ctx: IGameContext, npc: NPCState): boolean {
  if (hasMet(ctx, npc.id)) return false;
  ctx.state.flags['met:' + npc.id] = true;
  ctx.state.player.statistics.npcsMet += 1;
  ctx.bus.emit('npc:met', { npcId: npc.id, npcName: npc.name });
  return true;
}

/**
 * Applies a relationship delta, writes an interaction log entry, updates the
 * social cursor and emits 'relationship:changed'. Also handles 'npc:met' and the
 * statistics counters on first contact.
 */
export function applyInteraction(
  ctx: IGameContext,
  npc: NPCState,
  delta: InteractionDelta,
  kind: SocialInteractionKind,
  summary: string
): InteractionResult {
  const state = ctx.state;
  const now = ctx.clock.simTimeSeconds;
  const rel = ensureRelationship(state.player.relationships, npc.id, now);
  const firstMeeting = markMet(ctx, npc);
  const beforeAffinity = rel.affinity;
  const beforeTrust = rel.trust;
  const beforeIntimacy = rel.intimacy;
  const appliedDelta: InteractionDelta = { ...delta };
  if (appliedDelta.familiarity === undefined) appliedDelta.familiarity = 0.8;
  applyRelationshipDelta(rel, appliedDelta, now);
  const affinityDelta = roundDelta(rel.affinity - beforeAffinity);
  const trustDelta = roundDelta(rel.trust - beforeTrust);
  const intimacyDelta = roundDelta(rel.intimacy - beforeIntimacy);

  logInteraction(state, npc.id, kind, summary, affinityDelta, trustDelta, intimacyDelta, now);
  state.social.lastInteractionAt = now;

  // 'conversations' is incremented by talkTo only so the statistic stays meaningful.
  ctx.bus.emit('relationship:changed', {
    npcId: npc.id,
    kind,
    affinity: rel.affinity,
    trust: rel.trust,
    intimacy: rel.intimacy,
    status: rel.status,
  });
  return { relationship: rel, affinityDelta, trustDelta, intimacyDelta, firstMeeting };
}

/** Appends an interaction log entry (capped, newest last). */
export function logInteraction(
  state: GameState,
  npcId: NPCId,
  kind: SocialInteractionKind,
  summary: string,
  affinityDelta: number,
  trustDelta: number,
  intimacyDelta: number,
  at: number
): InteractionLogEntry {
  const entry: InteractionLogEntry = {
    id: nextSequentialId('ilog', state.social.interactionLog.map((item) => item.id)),
    at,
    npcId,
    kind,
    summary,
    affinityDelta: roundDelta(affinityDelta),
    trustDelta: roundDelta(trustDelta),
    intimacyDelta: roundDelta(intimacyDelta),
  };
  state.social.interactionLog.push(entry);
  while (state.social.interactionLog.length > SOCIAL_CONFIG.maxInteractionLog) {
    state.social.interactionLog.shift();
  }
  return entry;
}

/** Adds a memory to an NPC, applying the Ebbinghaus-ready initial fields and the cap. */
export function recordMemory(ctx: IGameContext, npc: NPCState, init: SocialMemoryInit): NPCMemoryState {
  const now = ctx.clock.simTimeSeconds;
  const memory: NPCMemoryState = {
    id: nextSequentialId('mem_' + npc.id, npc.memories.map((item) => item.id)),
    type: init.type,
    text: init.text,
    participantIds: init.participantIds ? [...init.participantIds] : [ctx.state.player.id],
    importance: clamp(Math.round(init.importance), 1, 100),
    emotionalValue: clamp(init.emotionalValue, -10, 10),
    createdAt: now,
    lastRecalledAt: now,
    strength: 1,
    permanent: init.permanent === true || init.importance >= 80,
  };
  npc.memories.push(memory);
  trimMemories(npc);
  return memory;
}

/** Keeps permanent + strongest memories inside the per-NPC cap. */
export function trimMemories(npc: NPCState): void {
  const cap = SOCIAL_CONFIG.maxMemoriesPerNpc;
  while (npc.memories.length > cap) {
    let weakestIndex = -1;
    let weakestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < npc.memories.length; i += 1) {
      const memory = npc.memories[i];
      if (!memory || memory.permanent) continue;
      const score = memory.importance * memory.strength;
      if (score < weakestScore) {
        weakestScore = score;
        weakestIndex = i;
      }
    }
    if (weakestIndex < 0) {
      // Everything is permanent: drop the oldest permanent memory instead.
      weakestIndex = 0;
    }
    npc.memories.splice(weakestIndex, 1);
  }
}

/** Awards social skill XP through the skill system when it is registered. */
export function awardSocialXp(ctx: IGameContext, amount: number, source: string): void {
  if (amount <= 0) return;
  const skill = ctx.registry.get<ISkillSystem>('skill');
  if (skill) skill.addXp('social', amount, source);
}

/** Adds influence, clamping at a sane range and emitting a debug-friendly log. */
export function awardInfluence(ctx: IGameContext, amount: number): number {
  const state = ctx.state;
  state.player.influence = Math.max(0, Math.round((state.player.influence + amount) * 10) / 10);
  return state.player.influence;
}

/** Adds (or removes) player money, clamps at zero and emits 'money:changed'. */
export function addPlayerMoney(ctx: IGameContext, amount: number, reason: string): number {
  const state = ctx.state;
  const rounded = Math.round(amount);
  const balance = Math.max(0, state.player.money + rounded);
  const applied = balance - state.player.money;
  state.player.money = balance;
  if (applied !== 0) {
    ctx.bus.emit('money:changed', { amount: applied, balance, reason });
  }
  return balance;
}

/** Adds an item to the player's inventory with the correct stack size and emits the event. */
export function addPlayerItem(
  ctx: IGameContext,
  itemId: ItemId,
  quantity: number,
  quality: QualityStars,
  source: string
): void {
  const state = ctx.state;
  const itemDef = ctx.content.getItem(itemId);
  const maxStack = itemDef ? itemDef.maxStack : 99;
  addItemToInventory(state.player.inventory, itemId, quantity, {
    quality,
    simTime: ctx.clock.simTimeSeconds,
    maxStack,
  });
  ctx.bus.emit('item:acquired', { itemId, quantity, quality, source });
}

/** Clamps a probability into the practical [min, max] range. */
export function clampProbability(value: number, min = 0.02, max = 0.95): number {
  return clamp(clamp01(value), min, max);
}

/**
 * Standard message builder for social action results.
 * `stateChanged` defaults to "yes when the action succeeded"; callers that
 * record a cooldown or other side effect on a refusal pass true explicitly.
 */
export function socialResult(
  ok: boolean,
  message: string,
  code?: ActionResult['code'],
  data?: ActionResult['data'],
  sideEffect = false
): ActionResult {
  const result: ActionResult = { ok, message, stateChanged: ok || sideEffect };
  if (code) result.code = code;
  if (data !== undefined) result.data = data;
  return result;
}
