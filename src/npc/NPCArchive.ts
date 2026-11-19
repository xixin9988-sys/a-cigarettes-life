// =============================================================================
// NPCArchive - records notable autonomous NPC life events into the NPC's
// lifeHistory, its long-term memory and (for important events) the shared
// world history so the player can read about them later.
//
// NOTE (contract gap): IWorldSystem exposes no history API, so the documented
// npc world-history entries are appended directly in the shared
// WorldHistoryEntry shape (category 'npc') with the same cap as
// src/world/WorldHistory.ts. If the Lead prefers, this can later be routed
// through that helper without changing callers.
// =============================================================================
import type { GameState, IGameContext, NPCState, WorldHistoryEntry } from '../core/contracts';
import type { LocationId } from '../core/SharedTypes';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { clamp } from '../core/utils';
import { NPC_MODULE, npcRecordId, readNpcExtras, writeNpcExtras } from './NPC';
import type { MemorySystem, MemorySeed } from './MemorySystem';

export type NpcLifeEventType =
  | 'first_friend'
  | 'close_friend'
  | 'rivalry'
  | 'romance'
  | 'breakup'
  | 'conflict'
  | 'new_job'
  | 'goal_completed'
  | 'festival'
  | 'milestone'
  | 'personal';

export interface NpcLifeEvent {
  type: NpcLifeEventType | string;
  description: string;
  /** 1..10 (life-history importance). */
  importance: number;
  participantIds?: readonly string[];
  locationId?: LocationId;
  /** Explicit memory payload; otherwise one is derived from the event. */
  memory?: MemorySeed;
  /** Force/forbid mirroring this event into world.history. */
  worldHistory?: boolean;
}

const NEGATIVE_EVENT_TYPES: readonly string[] = ['breakup', 'conflict', 'rivalry'];
const PERMANENT_EVENT_IMPORTANCE = 8;

function deriveEmotionalValue(type: string): number {
  if (NEGATIVE_EVENT_TYPES.includes(type)) return -6;
  switch (type) {
    case 'romance':
      return 7;
    case 'first_friend':
    case 'close_friend':
      return 5;
    case 'festival':
      return 4;
    case 'goal_completed':
      return 5;
    case 'new_job':
      return 4;
    default:
      return 2;
  }
}

export class NPCArchive {
  constructor(private readonly memory: MemorySystem) {}

  /** Records a notable NPC life event in every place it belongs. */
  record(ctx: IGameContext, npc: NPCState, event: NpcLifeEvent): void {
    const now = ctx.clock.simTimeSeconds;
    const importance = clamp(Math.round(event.importance), 1, 10);
    npc.lifeHistory.push({
      at: now,
      type: event.type,
      description: event.description,
      importance,
    });
    this.enforceLifeHistoryCap(npc);
    const memorySeed: MemorySeed =
      event.memory ??
      {
        type: 'event:' + event.type,
        text: event.description,
        participantIds: event.participantIds ? [...event.participantIds] : [],
        importance: clamp(importance * 10, 5, 100),
        emotionalValue: deriveEmotionalValue(event.type),
        permanent: importance >= PERMANENT_EVENT_IMPORTANCE,
      };
    this.memory.addMemory(npc, memorySeed, now);
    const mirrors = event.worldHistory ?? importance >= WORLD_CONFIG.simulation.historyArchiveImportance;
    if (mirrors) {
      this.addWorldHistory(ctx.state, npc, event, now, importance);
    }
  }

  /** Shortcut for milestone events that only need a description. */
  recordMilestone(
    ctx: IGameContext,
    npc: NPCState,
    type: NpcLifeEventType,
    description: string,
    importance: number,
    participants: readonly string[] = []
  ): void {
    this.record(ctx, npc, {
      type,
      description,
      importance,
      participantIds: participants,
    });
  }

  firstFriend(ctx: IGameContext, npc: NPCState, other: NPCState, mirrorWorld = true): void {
    const text = npc.name + ' became friends with ' + other.name + '.';
    this.record(ctx, npc, {
      type: 'first_friend',
      description: text,
      importance: 5,
      participantIds: [other.id],
      locationId: npc.locationId,
      worldHistory: mirrorWorld,
    });
  }

  closeFriend(ctx: IGameContext, npc: NPCState, other: NPCState, mirrorWorld = true): void {
    this.record(ctx, npc, {
      type: 'close_friend',
      description: npc.name + ' and ' + other.name + ' have become close friends.',
      importance: 6,
      participantIds: [other.id],
      locationId: npc.locationId,
      worldHistory: mirrorWorld,
    });
  }

  rivalry(ctx: IGameContext, npc: NPCState, other: NPCState, mirrorWorld = true, description?: string): void {
    this.record(ctx, npc, {
      type: 'rivalry',
      description:
        description ?? npc.name + ' and ' + other.name + ' have fallen out and become rivals.',
      importance: 6,
      participantIds: [other.id],
      locationId: npc.locationId,
      worldHistory: mirrorWorld,
    });
  }

  romance(ctx: IGameContext, npc: NPCState, other: NPCState, description?: string, mirrorWorld = true): void {
    this.record(ctx, npc, {
      type: 'romance',
      description:
        description ?? npc.name + ' and ' + other.name + ' have started seeing each other.',
      importance: 9,
      participantIds: [other.id],
      locationId: npc.locationId,
      worldHistory: mirrorWorld,
      memory: {
        type: 'romance:began',
        text:
          description ?? npc.name + ' and ' + other.name + ' have started seeing each other.',
        participantIds: [other.id],
        importance: 92,
        emotionalValue: 9,
        permanent: true,
      },
    });
  }

  breakup(ctx: IGameContext, npc: NPCState, other: NPCState, description?: string, mirrorWorld = true): void {
    this.record(ctx, npc, {
      type: 'breakup',
      description:
        description ?? npc.name + ' and ' + other.name + ' have broken up.',
      importance: 8,
      participantIds: [other.id],
      locationId: npc.locationId,
      worldHistory: mirrorWorld,
      memory: {
        type: 'romance:breakup',
        text: description ?? npc.name + ' and ' + other.name + ' have broken up.',
        participantIds: [other.id],
        importance: 85,
        emotionalValue: -9,
        permanent: true,
      },
    });
  }

  conflict(ctx: IGameContext, npc: NPCState, other: NPCState, description: string): void {
    this.record(ctx, npc, {
      type: 'conflict',
      description,
      importance: 5,
      participantIds: [other.id],
      locationId: npc.locationId,
    });
  }

  newJob(ctx: IGameContext, npc: NPCState, jobTitle: string, locationId?: LocationId): void {
    const location = locationId ?? npc.workLocationId;
    this.record(ctx, npc, {
      type: 'new_job',
      description: npc.name + ' started work as ' + jobTitle + '.',
      importance: 6,
      locationId: location,
    });
  }

  goalCompleted(ctx: IGameContext, npc: NPCState, goalLabel: string): void {
    this.record(ctx, npc, {
      type: 'goal_completed',
      description: npc.name + ' achieved a personal goal: ' + goalLabel + '.',
      importance: 6,
      locationId: npc.locationId,
    });
  }

  festival(ctx: IGameContext, npc: NPCState, festivalName: string, locationId: LocationId): void {
    this.record(ctx, npc, {
      type: 'festival',
      description: npc.name + ' attended the ' + festivalName + '.',
      importance: 4,
      locationId,
    });
  }

  /**
   * Drops the least important (then oldest) entries beyond the life-history cap
   * while preserving chronological order for the UI.
   */
  private enforceLifeHistoryCap(npc: NPCState): void {
    const cap = NPC_MODULE.lifeHistoryCap;
    while (npc.lifeHistory.length > cap) {
      let victim = 0;
      for (let index = 1; index < npc.lifeHistory.length; index += 1) {
        const candidate = npc.lifeHistory[index];
        const current = npc.lifeHistory[victim];
        if (!candidate || !current) continue;
        if (candidate.importance < current.importance) victim = index;
        else if (candidate.importance === current.importance && candidate.at < current.at) victim = index;
      }
      npc.lifeHistory.splice(victim, 1);
    }
  }

  private addWorldHistory(
    state: GameState,
    npc: NPCState,
    event: NpcLifeEvent,
    now: number,
    importance: number
  ): void {
    const extras = readNpcExtras(npc);
    const sequence = extras.historySeq ?? 0;
    extras.historySeq = sequence + 1;
    writeNpcExtras(npc, extras);
    const entry: WorldHistoryEntry = {
      id: npcRecordId('npc_history', npc.id, sequence, now),
      at: now,
      category: 'npc',
      description: event.description,
      importance,
      participantIds: event.participantIds ? [...event.participantIds] : [],
    };
    if (event.locationId) entry.locationId = event.locationId;
    state.world.history.push(entry);
    const cap = WORLD_CONFIG.simulation.maxHistoryEntries;
    while (state.world.history.length > cap) {
      let victim = 0;
      for (let index = 1; index < state.world.history.length; index += 1) {
        const candidate = state.world.history[index];
        const current = state.world.history[victim];
        if (!candidate || !current) continue;
        if (candidate.importance < current.importance) victim = index;
        else if (candidate.importance === current.importance && candidate.at < current.at) victim = index;
      }
      state.world.history.splice(victim, 1);
    }
  }
}
