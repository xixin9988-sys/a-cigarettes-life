// =============================================================================
// MemorySystem - Ebbinghaus-style exponential memory decay with permanent
// important memories, recall boosts and memory influence on decisions.
// Deterministic, DOM-free.
// =============================================================================
import type { NPCState, NPCMemoryState } from '../core/contracts';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { clamp } from '../core/utils';
import {
  NPC_MODULE,
  SIM_SECONDS_PER_GAME_DAY,
  npcRecordId,
  readNpcExtras,
  writeNpcExtras,
} from './NPC';

export interface MemorySeed {
  type: string;
  text: string;
  participantIds?: readonly string[];
  /** 1..100, also the memory's starting strength. */
  importance: number;
  /** Emotional polarity -10..+10 (negative = distressing). */
  emotionalValue?: number;
  /** Forced permanent memory (importance >= threshold is always permanent). */
  permanent?: boolean;
}

export interface MemoryInfluenceSignals {
  activityId?: string;
  activityGroup?: string;
  participantId?: string;
  /** Extra free-form topic tags matched against type/text. */
  topics?: readonly string[];
}

export const MEMORY_DECAY_LAMBDA_PER_DAY = WORLD_CONFIG.world.memoryDecayLambdaPerDay;
export const PERMANENT_MEMORY_THRESHOLD = WORLD_CONFIG.world.permanentMemoryThreshold;
export const SHORT_TERM_MEMORY_THRESHOLD = WORLD_CONFIG.world.shortTermMemoryThreshold;

/** Pure decay formula: S(t) = I0 * e^(-lambda * days). */
export function decayedStrength(importance: number, daysSinceRecall: number): number {
  const safeImportance = clamp(importance, 0, 100);
  const days = Math.max(0, Number.isFinite(daysSinceRecall) ? daysSinceRecall : 0);
  return clamp(safeImportance * Math.exp(-MEMORY_DECAY_LAMBDA_PER_DAY * days), 0, 100);
}

function memoryHaystack(memory: NPCMemoryState): string {
  return (memory.type + ' ' + memory.text).toLowerCase();
}

export class MemorySystem {
  /** Creates and stores a memory. Ids are deterministic per NPC + sequence. */
  addMemory(npc: NPCState, seed: MemorySeed, now: number): NPCMemoryState {
    const extras = readNpcExtras(npc);
    const sequence = extras.memorySeq ?? 0;
    extras.memorySeq = sequence + 1;
    writeNpcExtras(npc, extras);
    const importance = clamp(Math.round(seed.importance), 1, 100);
    const permanent = seed.permanent === true || importance >= PERMANENT_MEMORY_THRESHOLD;
    const memory: NPCMemoryState = {
      id: npcRecordId('mem', npc.id, sequence, now),
      type: seed.type,
      text: seed.text,
      participantIds: seed.participantIds ? [...seed.participantIds] : [],
      importance,
      emotionalValue: clamp(seed.emotionalValue ?? 0, -10, 10),
      createdAt: now,
      lastRecalledAt: now,
      strength: permanent ? importance : importance,
      permanent,
    };
    npc.memories.push(memory);
    this.enforceCap(npc);
    return memory;
  }

  /**
   * Decays all memories, prunes the faded ones and enforces the cap.
   * Permanent memories never decay and are never pruned.
   */
  update(npc: NPCState, now: number): void {
    const kept: NPCMemoryState[] = [];
    for (const memory of npc.memories) {
      if (memory.permanent) {
        memory.strength = Math.max(memory.strength, memory.importance);
        kept.push(memory);
        continue;
      }
      const days = Math.max(0, (now - memory.lastRecalledAt) / SIM_SECONDS_PER_GAME_DAY);
      memory.strength = decayedStrength(memory.importance, days);
      if (memory.strength >= SHORT_TERM_MEMORY_THRESHOLD) kept.push(memory);
    }
    npc.memories = kept;
    this.enforceCap(npc);
  }

  /** Recalls a specific memory, strengthening it and resetting its decay clock. */
  recall(npc: NPCState, memoryId: string, now: number, boost = 0.25): boolean {
    const memory = npc.memories.find((entry) => entry.id === memoryId);
    if (!memory) return false;
    memory.lastRecalledAt = now;
    if (!memory.permanent) {
      const gain = memory.importance * clamp(boost, 0, 1);
      memory.strength = clamp(Math.max(memory.strength, decayedStrength(memory.importance, 0)) + gain * 0.15, 0, memory.importance);
    } else {
      memory.strength = Math.max(memory.strength, memory.importance);
    }
    return true;
  }

  /** Recalls the strongest memories shared with another character. */
  recallAbout(npc: NPCState, otherId: string, now: number, limit = 2): NPCMemoryState[] {
    const candidates = npc.memories
      .filter((memory) => memory.participantIds.includes(otherId))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, Math.max(0, limit));
    for (const memory of candidates) this.recall(npc, memory.id, now, 0.15);
    return candidates;
  }

  /**
   * Memory influence multiplier for the decision engine: recent strong positive
   * memories of an activity/person make it more attractive, negative ones less.
   * Returns 0.7..1.3 (neutral = 1).
   */
  influence(npc: NPCState, signals: MemoryInfluenceSignals): number {
    if (npc.memories.length === 0) return 1;
    const topics = [
      signals.activityId,
      signals.activityGroup,
      ...(signals.topics ?? []),
    ]
      .filter((topic): topic is string => typeof topic === 'string' && topic.length > 0)
      .map((topic) => topic.toLowerCase());
    let score = 0;
    for (const memory of npc.memories) {
      let relevance = 0;
      if (signals.participantId && memory.participantIds.includes(signals.participantId)) relevance += 1;
      if (topics.length > 0) {
        const haystack = memoryHaystack(memory);
        for (const topic of topics) {
          if (haystack.includes(topic)) relevance += 0.6;
        }
      }
      if (relevance <= 0) continue;
      const strengthFactor = clamp(memory.strength / 100, 0, 1);
      const polarity = memory.emotionalValue >= 0 ? 1 : -1;
      const emotionalWeight = 0.4 + clamp(Math.abs(memory.emotionalValue) / 10, 0, 1);
      score += relevance * strengthFactor * polarity * emotionalWeight;
    }
    return clamp(1 + clamp(score, -1.5, 1.5) * 0.2, 0.7, 1.3);
  }

  /** All memories that mention another character, newest/strongest first. */
  memoriesAbout(npc: NPCState, otherId: string, limit = 10): NPCMemoryState[] {
    return npc.memories
      .filter((memory) => memory.participantIds.includes(otherId))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, limit);
  }

  strongest(npc: NPCState, limit = 5): NPCMemoryState[] {
    return [...npc.memories].sort((a, b) => b.strength - a.strength).slice(0, limit);
  }

  /** Most recently formed memories (used by the life archive / UI). */
  recent(npc: NPCState, limit = 5): NPCMemoryState[] {
    return [...npc.memories].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  /** Number of permanent memories (useful for debug and tests). */
  permanentCount(npc: NPCState): number {
    return npc.memories.filter((memory) => memory.permanent).length;
  }

  /**
   * Cap enforcement: permanent memories are always kept; remaining slots are
   * filled with the strongest short-term memories.
   */
  private enforceCap(npc: NPCState): void {
    const cap = NPC_MODULE.maxMemoriesPerNpc;
    if (npc.memories.length <= cap) return;
    const permanent = npc.memories.filter((memory) => memory.permanent);
    const transient = npc.memories
      .filter((memory) => !memory.permanent)
      .sort((a, b) => b.strength - a.strength);
    const budget = Math.max(0, cap - permanent.length);
    const keptIds = new Set<string>();
    for (const memory of permanent) keptIds.add(memory.id);
    for (const memory of transient.slice(0, budget)) keptIds.add(memory.id);
    npc.memories = npc.memories.filter((memory) => keptIds.has(memory.id));
    // If the permanent memories alone exceed the cap, keep the strongest.
    if (npc.memories.length > cap) {
      npc.memories = npc.memories
        .sort((a, b) => Number(b.permanent) - Number(a.permanent) || b.strength - a.strength)
        .slice(0, cap);
    }
  }
}
