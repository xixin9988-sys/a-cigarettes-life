import type { ActionResult, DialogueSessionState, IGameContext, IDialogueSystem, NPCState } from '../core/contracts';
import type { DialogueChoice, DialogueEffect, DialogueNode, DialogueTree } from '../data/schema';
import type { NPCId } from '../core/SharedTypes';
import { applyRelationshipDelta, ensureRelationship } from '../core/RelationshipUtil';
import { ensureKnown, markMet } from './RelationshipOps';
import { removeItemFromInventory } from '../core/InventoryUtil';
import { SOCIAL_CONFIG, cooldownSeconds } from './config';
import {
  awardSocialXp,
  addPlayerItem,
  addPlayerMoney,
  awardInfluence,
  recordMemory,
  socialResult,
} from './RelationshipOps';
import {
  evaluateConditions,
  interpolateDialogueText,
  isChoiceUsed,
  markChoiceUsed,
  pickGreetingNodeId,
  resolveChoices,
  resolveNodeText,
} from './DialogueConditions';
import { isSamePlace } from './socialUtils';

interface EffectOutcome {
  ok: boolean;
  code?: 'not_enough_money' | 'not_enough_items';
  message?: string;
  ended: boolean;
  summaries: string[];
}

/**
 * Dialogue system: walks condition-gated dialogue trees from src/data/dialogue,
 * resolves dynamic text variants and applies choice/node effects to real state.
 * One conversation at a time, stored in state.social.activeConversation.
 */
export class DialogueSystem implements IDialogueSystem {
  readonly id = 'dialogue';
  private ctx: IGameContext | null = null;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    // Drop a stale conversation from a previous session (e.g. after load).
    const session = ctx.state.social.activeConversation;
    if (session) {
      const age = ctx.clock.simTimeSeconds - session.startedAt;
      if (age > cooldownSeconds(SOCIAL_CONFIG.conversationTimeoutHours)) {
        ctx.state.social.activeConversation = null;
      }
    }
  }

  update(_dtSimSeconds: number): void {
    const ctx = this.requireCtx();
    const session = ctx.state.social.activeConversation;
    if (!session) return;
    const age = ctx.clock.simTimeSeconds - session.startedAt;
    if (age > cooldownSeconds(SOCIAL_CONFIG.conversationTimeoutHours)) {
      ctx.state.social.activeConversation = null;
      ctx.logger.debug('Dialogue session timed out', { npcId: session.npcId });
    }
  }

  /** Starts a conversation with a nearby NPC using their dialogue tree. */
  startConversation(npcId: NPCId): ActionResult {
    const ctx = this.requireCtx();
    const state = ctx.state;
    const npc = state.npcs[npcId];
    if (!npc) return socialResult(false, 'There is nobody by that name here.', 'not_found');
    if (!npc.alive) return socialResult(false, npc.name + ' is no longer around.', 'not_found');
    if (!isSamePlace(state.player.position.locationId, npc.locationId)) {
      return socialResult(false, npc.name + ' is not here right now.', 'wrong_location');
    }
    const def = ctx.content.getNPC(npcId);
    if (!def) return socialResult(false, 'That person has no story to tell.', 'not_found');
    const tree = ctx.content.getDialogueTree(def.dialogueTreeId) ?? ctx.content.getDialogueTree('dialogue_resident');
    if (!tree) {
      return socialResult(false, npc.name + ' has nothing to say to you right now.', 'unsupported');
    }

    const now = ctx.clock.simTimeSeconds;
    ensureKnown(ctx, npc);
    const firstMeeting = markMet(ctx, npc);
    const rel = ensureRelationship(state.player.relationships, npcId, now);
    state.flags['dlg_met:' + npcId] = true;

    const nodeId = pickGreetingNodeId(tree, rel.status);
    const session: DialogueSessionState = {
      npcId,
      treeId: tree.id,
      nodeId,
      startedAt: now,
      choicesShown: 0,
      usedChoiceIds: {},
    };
    state.social.activeConversation = session;
    state.social.lastInteractionAt = now;

    const entryNode = tree.nodes[nodeId];
    if (entryNode) this.enterNodeEffects(ctx, npc, entryNode, session);
    awardSocialXp(ctx, SOCIAL_CONFIG.socialXp.dialogueStart, 'dialogue:start');

    return socialResult(true, npc.name + ' looks up as you approach.', undefined, {
      npcId,
      treeId: tree.id,
      nodeId,
      firstMeeting,
    });
  }

  /** The active conversation state, or null. */
  getConversation(): DialogueSessionState | null {
    return this.requireCtx().state.social.activeConversation;
  }

  /** The currently displayed node with its text, choices and emotion. */
  getCurrentNode(): { npcId: NPCId; text: string; choices: { id: string; text: string; available: boolean }[]; emotion: string } | null {
    const ctx = this.requireCtx();
    const session = ctx.state.social.activeConversation;
    if (!session) return null;
    const npc = ctx.state.npcs[session.npcId];
    if (!npc) return null;
    const tree = ctx.content.getDialogueTree(session.treeId);
    if (!tree) return null;
    const node = tree.nodes[session.nodeId];
    if (!node) return null;
    const text = resolveNodeText(ctx, npc, node);
    const resolved = resolveChoices(ctx, npc, node, session.usedChoiceIds);
    const choices = resolved.map((entry) => ({
      id: entry.choice.id,
      text: interpolateDialogueText(ctx, npc, entry.choice.text),
      available: entry.available,
    }));
    return {
      npcId: npc.id,
      text,
      choices,
      emotion: node.emotion ?? deriveEmotion(npc),
    };
  }

  /** Applies the choice at the given visible index and advances the conversation. */
  choose(choiceIndex: number): ActionResult {
    const ctx = this.requireCtx();
    const session = ctx.state.social.activeConversation;
    if (!session) return socialResult(false, 'You are not in a conversation.', 'invalid');
    const npc = ctx.state.npcs[session.npcId];
    if (!npc) {
      ctx.state.social.activeConversation = null;
      return socialResult(false, 'That person is gone.', 'not_found');
    }
    const tree = ctx.content.getDialogueTree(session.treeId);
    if (!tree) return socialResult(false, 'That conversation has lost its thread.', 'not_found');
    const node = tree.nodes[session.nodeId];
    if (!node) return socialResult(false, 'That conversation has lost its thread.', 'not_found');
    if (!node.choices || node.choices.length === 0) {
      return socialResult(false, 'There is nothing to answer here.', 'invalid');
    }
    if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= node.choices.length) {
      return socialResult(false, 'That is not one of the things you could say.', 'invalid');
    }
    const choice = node.choices[choiceIndex];
    if (!choice) return socialResult(false, 'That is not one of the things you could say.', 'invalid');
    const available = evaluateConditions(ctx, npc, choice.conditions) &&
      !(choice.once === true && isChoiceUsed(ctx, npc, choice.id, session.usedChoiceIds));
    if (!available) {
      return socialResult(false, 'You cannot say that right now.', 'requirement_not_met', { choiceId: choice.id });
    }

    const effectOutcome = this.applyEffects(ctx, npc, choice.effects, session);
    if (!effectOutcome.ok) {
      return socialResult(false, effectOutcome.message ?? 'That is not possible right now.', effectOutcome.code);
    }
    markChoiceUsed(ctx, npc, choice, session.usedChoiceIds);
    if (effectOutcome.ended) {
      this.endConversation();
      return socialResult(true, 'The conversation ends there.', undefined, {
        npcId: npc.id,
        ended: true,
        choiceId: choice.id,
      });
    }
    session.choicesShown += 1;
    awardSocialXp(ctx, SOCIAL_CONFIG.socialXp.dialogueChoice, 'dialogue:choice');

    const nextNodeId = choice.next ?? node.next;
    if (!nextNodeId) {
      this.endConversation();
      return socialResult(true, 'The conversation draws to a close.', undefined, {
        npcId: npc.id,
        ended: true,
        choiceId: choice.id,
      });
    }
    const entered = this.enterNode(ctx, npc, tree, session, nextNodeId);
    if (!entered) {
      this.endConversation();
      return socialResult(true, 'The conversation drifts away.', undefined, {
        npcId: npc.id,
        ended: true,
        choiceId: choice.id,
      });
    }
    const current = tree.nodes[session.nodeId];
    const currentText = current ? resolveNodeText(ctx, npc, current) : '';
    return socialResult(true, 'You say your piece.', undefined, {
      npcId: npc.id,
      choiceId: choice.id,
      ended: ctx.state.social.activeConversation === null,
      nodeId: session.nodeId,
      text: currentText,
    });
  }

  /** Ends the active conversation (safe to call twice). */
  endConversation(): ActionResult {
    const ctx = this.requireCtx();
    if (!ctx.state.social.activeConversation) {
      return socialResult(true, 'There is no conversation to end.', undefined, { ended: false });
    }
    ctx.state.social.activeConversation = null;
    return socialResult(true, 'Conversation ended.', undefined, { ended: true });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private requireCtx(): IGameContext {
    if (!this.ctx) throw new Error('DialogueSystem.init(ctx) must be called before use');
    return this.ctx;
  }

  /** Moves to a node, applying node effects once and following choice-less bridges. */
  private enterNode(
    ctx: IGameContext,
    npc: NPCState,
    tree: DialogueTree,
    session: DialogueSessionState,
    startNodeId: string
  ): boolean {
    let nodeId: string | undefined = startNodeId;
    let depth = 0;
    while (nodeId && depth < SOCIAL_CONFIG.maxDialogueDepth) {
      const node: DialogueNode | undefined = tree.nodes[nodeId];
      if (!node) return false;
      session.nodeId = nodeId;
      const nodeOutcome = this.enterNodeEffects(ctx, npc, node, session);
      if (!nodeOutcome) {
        // A node effect ended the conversation.
        this.endConversation();
        return true;
      }
      const hasChoices = Boolean(node.choices && node.choices.length > 0);
      if (hasChoices || !node.next) return true;
      nodeId = node.next;
      depth += 1;
    }
    return false;
  }

  /** Applies a node's effects exactly once per conversation. Returns false when it ended the conversation. */
  private enterNodeEffects(
    ctx: IGameContext,
    npc: NPCState,
    node: DialogueNode,
    session: DialogueSessionState
  ): boolean {
    const key = 'node:' + node.id;
    if (session.usedChoiceIds[key] === true) return true;
    session.usedChoiceIds[key] = true;
    if (!node.effects || node.effects.length === 0) return true;
    const outcome = this.applyEffects(ctx, npc, node.effects, session);
    return !outcome.ended;
  }

  /**
   * Applies dialogue effects atomically where money/item costs are involved.
   * Relationship deltas are aggregated so a node produces one change event.
   */
  private applyEffects(
    ctx: IGameContext,
    npc: NPCState,
    effects: readonly DialogueEffect[] | undefined,
    session: DialogueSessionState
  ): EffectOutcome {
    if (!effects || effects.length === 0) return { ok: true, ended: false, summaries: [] };
    const state = ctx.state;
    const rel = ensureRelationship(state.player.relationships, npc.id, ctx.clock.simTimeSeconds);
    const previousStatus = rel.status;

    // Pre-flight affordability/item checks so a choice cannot half-apply.
    let moneyCost = 0;
    for (const effect of effects) {
      if (effect.kind === 'money' && effect.amount < 0) moneyCost += -effect.amount;
    }
    if (moneyCost > 0 && state.player.money < moneyCost) {
      return {
        ok: false,
        code: 'not_enough_money',
        message: 'That would cost more money than you carry.',
        ended: false,
        summaries: [],
      };
    }
    for (const effect of effects) {
      if (effect.kind === 'item' && effect.quantity < 0) {
        const owned = state.player.inventory.filter((entry) => entry.itemId === effect.itemId).reduce((sum, entry) => sum + entry.quantity, 0);
        if (owned < -effect.quantity) {
          return {
            ok: false,
            code: 'not_enough_items',
            message: 'You do not have that to give.',
            ended: false,
            summaries: [],
          };
        }
      }
    }

    const affinityParts: number[] = [];
    const trustParts: number[] = [];
    const intimacyParts: number[] = [];
    let ended = false;
    for (const effect of effects) {
      switch (effect.kind) {
        case 'relationship': {
          if (typeof effect.affinity === 'number') affinityParts.push(effect.affinity);
          if (typeof effect.trust === 'number') trustParts.push(effect.trust);
          if (typeof effect.intimacy === 'number') intimacyParts.push(effect.intimacy);
          break;
        }
        case 'money': {
          addPlayerMoney(ctx, effect.amount, 'dialogue');
          break;
        }
        case 'item': {
          if (effect.quantity >= 0) {
            addPlayerItem(ctx, effect.itemId, effect.quantity, 2, 'dialogue');
          } else {
            removeItemFromInventory(state.player.inventory, effect.itemId, -effect.quantity);
            ctx.bus.emit('item:lost', { itemId: effect.itemId, quantity: -effect.quantity, reason: 'dialogue' });
          }
          break;
        }
        case 'memory': {
          recordMemory(ctx, npc, {
            type: 'dialogue',
            text: interpolateDialogueText(ctx, npc, effect.text),
            importance: effect.importance,
            emotionalValue: effect.permanent ? 6 : 3,
            permanent: effect.permanent,
          });
          break;
        }
        case 'flag': {
          state.flags[effect.flag] = effect.value;
          break;
        }
        case 'goal': {
          this.applyGoalEffect(npc, effect.goalType);
          break;
        }
        case 'influence': {
          if (effect.amount > 0) awardInfluence(ctx, effect.amount);
          break;
        }
        case 'endConversation': {
          ended = true;
          break;
        }
        default:
          break;
      }
    }

    const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
    if (affinityParts.length > 0 || trustParts.length > 0 || intimacyParts.length > 0) {
      applyRelationshipDelta(
        rel,
        { affinity: sum(affinityParts), trust: sum(trustParts), intimacy: sum(intimacyParts), familiarity: 0 },
        ctx.clock.simTimeSeconds
      );
      state.social.lastInteractionAt = ctx.clock.simTimeSeconds;
      ctx.bus.emit('relationship:changed', {
        npcId: npc.id,
        kind: 'chat',
        affinity: rel.affinity,
        trust: rel.trust,
        intimacy: rel.intimacy,
        status: rel.status,
      });
      if (previousStatus !== rel.status && rel.status !== 'stranger') {
        ctx.logger.debug('Relationship status changed through dialogue', { npcId: npc.id, status: rel.status });
      }
    }
    return { ok: true, ended, summaries: [] };
  }

  /** Advances an NPC goal when a dialogue choice mentions it. */
  private applyGoalEffect(npc: NPCState, goalType: string): void {
    const normalised = goalType.trim().toLowerCase();
    let matched = false;
    for (const goal of npc.goals) {
      const label = goal.label.toLowerCase();
      if (goal.type.toLowerCase() === normalised || label.includes(normalised) || normalised.includes(label)) {
        goal.progress = Math.min(goal.target, goal.progress + 1);
        matched = true;
        if (goal.progress >= goal.target) {
          goal.completedAt = goal.completedAt ?? this.requireCtx().clock.simTimeSeconds;
        }
      }
    }
    this.requireCtx().state.flags['goal:' + normalised] = true;
    if (!matched) {
      this.requireCtx().logger.debug('Dialogue goal effect had no matching NPC goal', { npcId: npc.id, goalType });
    }
  }

}

/** Chooses an emotion label from the NPC's emotion vector. */
export function deriveEmotion(npc: NPCState): string {
  const e = npc.emotions;
  if (e.anger > 0.55) return 'angry';
  if (e.sadness > 0.5) return 'sad';
  if (e.fear > 0.45) return 'surprised';
  if (e.affection > 0.6) return 'shy';
  if (e.joy > 0.55) return 'happy';
  return 'neutral';
}

/** Re-exported so tests can build trees without importing the data module twice. */
export type { DialogueNode, DialogueTree, DialogueChoice };
