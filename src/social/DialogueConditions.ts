import type { DialogueChoice, DialogueCondition, DialogueNode, DialogueTree } from '../data/schema';
import type { IGameContext, NPCState } from '../core/contracts';
import type { RelationshipStatus } from '../core/SharedTypes';
import { SEASON_DISPLAY_NAMES, WEATHER_DISPLAY_NAMES } from '../core/SharedTypes';
import { countItem } from '../core/InventoryUtil';
import { clamp01 } from '../core/utils';
import { npcMoodScore } from './socialUtils';

/**
 * Evaluator for the static dialogue condition model (src/data/schema.ts).
 *
 * The data model only knows about content-level conditions; anything that needs
 * live state is resolved here. Probabilistic conditions draw from the
 * 'social.dialogue' stream so replays stay deterministic.
 */

/** True when hour lies in [from, to), handling ranges that wrap over midnight. */
export function isHourInRange(hour: number, from: number, to: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  const start = ((from % 24) + 24) % 24;
  const end = ((to % 24) + 24) % 24;
  if (start === end) return true;
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}

/** Evaluates a single dialogue condition against live state. */
export function evaluateCondition(ctx: IGameContext, npc: NPCState, condition: DialogueCondition): boolean {
  const state = ctx.state;
  const rel = state.player.relationships[npc.id];
  switch (condition.kind) {
    case 'affinityMin':
      return (rel ? rel.affinity : 0) >= condition.value;
    case 'trustMin':
      return (rel ? rel.trust : 0) >= condition.value;
    case 'intimacyMin':
      return (rel ? rel.intimacy : 0) >= condition.value;
    case 'status': {
      if (!rel) return condition.statuses.includes('stranger');
      return condition.statuses.includes(rel.status);
    }
    case 'hasItem':
      return countItem(state.player.inventory, condition.itemId) > 0;
    case 'weather':
      return condition.weathers.includes(state.world.environment.weather);
    case 'season':
      return condition.seasons.includes(state.world.environment.season);
    case 'hourRange':
      return isHourInRange(ctx.clock.time.hour, condition.from, condition.to);
    case 'flag':
      return (state.flags[condition.flag] ?? false) === condition.equals;
    case 'moodMin':
      return npcMoodScore(npc) >= condition.value;
    case 'moistureMin':
      return state.player.cigarette.moisture >= condition.value;
    case 'seenBefore': {
      const hasSeen = Boolean(rel && rel.interactionCount > 0);
      return hasSeen === condition.value;
    }
    case 'probability':
      return ctx.probability.chance('social.dialogue', clamp01(condition.chance));
    default:
      return false;
  }
}

/** True when every condition passes (empty/undefined lists always pass). */
export function evaluateConditions(
  ctx: IGameContext,
  npc: NPCState,
  conditions: readonly DialogueCondition[] | undefined
): boolean {
  if (!conditions || conditions.length === 0) return true;
  for (const condition of conditions) {
    if (!evaluateCondition(ctx, npc, condition)) return false;
  }
  return true;
}

/** Resolves a node definition with all content-level guards applied. */
export function resolveDialogueNode(tree: DialogueTree, nodeId: string): DialogueNode | undefined {
  return tree.nodes[nodeId];
}

/** Chooses the first matching text variant for a node (falls back to base text). */
export function resolveNodeText(ctx: IGameContext, npc: NPCState, node: DialogueNode): string {
  if (node.variants) {
    for (const variant of node.variants) {
      if (evaluateConditions(ctx, npc, variant.conditions)) {
        return interpolateDialogueText(ctx, npc, variant.text);
      }
    }
  }
  return interpolateDialogueText(ctx, npc, node.text);
}

/** Filters a node's choices to the ones currently visible, with availability flags. */
export function resolveChoices(
  ctx: IGameContext,
  npc: NPCState,
  node: DialogueNode,
  usedChoiceIds: Record<string, boolean>
): { choice: DialogueChoice; available: boolean; index: number }[] {
  if (!node.choices) return [];
  const result: { choice: DialogueChoice; available: boolean; index: number }[] = [];
  for (let index = 0; index < node.choices.length; index += 1) {
    const choice = node.choices[index];
    if (!choice) continue;
    const conditionsPass = evaluateConditions(ctx, npc, choice.conditions);
    const usedOnce = choice.once === true && isChoiceUsed(ctx, npc, choice.id, usedChoiceIds);
    result.push({ choice, index, available: conditionsPass && !usedOnce });
  }
  return result;
}

/** Once-only choices are remembered per-NPC via a global flag. */
export function onceFlagKey(npcId: string, choiceId: string): string {
  return 'dlg_once:' + npcId + ':' + choiceId;
}

/** True when a once-only choice has been used in this session or any previous one. */
export function isChoiceUsed(
  ctx: IGameContext,
  npc: NPCState,
  choiceId: string,
  usedChoiceIds: Record<string, boolean>
): boolean {
  if (usedChoiceIds[choiceId] === true) return true;
  return ctx.state.flags[onceFlagKey(npc.id, choiceId)] === true;
}

/** Marks a once-only choice as used (session + persistent flag). */
export function markChoiceUsed(ctx: IGameContext, npc: NPCState, choice: DialogueChoice, usedChoiceIds: Record<string, boolean>): void {
  usedChoiceIds[choice.id] = true;
  if (choice.once === true) {
    ctx.state.flags[onceFlagKey(npc.id, choice.id)] = true;
  }
}

/** Replaces {tokens} in dialogue text with live, player-visible values. */
export function interpolateDialogueText(ctx: IGameContext, npc: NPCState, text: string): string {
  if (!text.includes('{')) return text;
  const state = ctx.state;
  const time = ctx.clock.time;
  const rel = state.player.relationships[npc.id];
  const moisture = state.player.cigarette.moisture;
  const moistureWord = moisture >= 0.85 ? 'soaked through' : moisture >= 0.45 ? 'damp' : 'dry';
  const tokens: Record<string, string> = {
    player: state.player.name,
    npc: npc.name,
    weather: WEATHER_DISPLAY_NAMES[state.world.environment.weather] ?? state.world.environment.weather,
    season: SEASON_DISPLAY_NAMES[state.world.environment.season] ?? state.world.environment.season,
    hour: String(time.hour) + ':' + String(time.minute).padStart(2, '0'),
    phase: time.phase,
    moisture: moistureWord,
    moisturePercent: String(Math.round(moisture * 100)),
    location: ctx.content.getLocation(state.player.position.locationId)?.name ?? 'here',
    affinity: String(Math.round(rel ? rel.affinity : 0)),
    status: rel ? rel.status : 'stranger',
    mood: String(npcMoodScore(npc)),
    money: String(state.player.money),
    influence: String(Math.round(state.player.influence)),
  };
  let result = text;
  for (const [key, value] of Object.entries(tokens)) {
    result = result.split('{' + key + '}').join(value);
  }
  return result;
}

/** Picks the greeting node for a relationship status, falling back to the tree root. */
export function pickGreetingNodeId(tree: DialogueTree, status: RelationshipStatus | undefined): string {
  const key = status ?? 'stranger';
  const greeting = tree.greetingByStatus?.[key];
  if (greeting && tree.nodes[greeting]) return greeting;
  return tree.rootNodeId;
}

