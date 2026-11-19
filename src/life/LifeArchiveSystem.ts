import type {
  GameEventMap,
  GameEventTopic,
  IGameContext,
  LetterState,
  LifeArchiveCategory,
  LifeArchiveEntry,
  WorldEvent,
} from '../core/contracts';
import type { EntityId, JsonValue, LocationId, NPCId, RelationshipStatus } from '../core/SharedTypes';
import { archiveImportanceThreshold } from './lifeShared';

/**
 * LifeArchiveSystem - the immutable chronicle of one cigarette's life.
 *
 * It listens to the documented bus events and turns the genuinely important ones into
 * LifeArchiveEntry records (importance >= WORLD_CONFIG.life.archiveImportanceThreshold).
 * Nothing here is invented: every entry is derived from an event that really happened,
 * with real participants, locations and timestamps. The archive is capped at 400 entries;
 * when full, a low-importance entry is displaced by a more important one.
 */
const MAX_ARCHIVE_ENTRIES = 400;
const MAX_LETTERS = 80;

const MAJOR_RELATIONSHIP_STATUSES: readonly RelationshipStatus[] = [
  'friend',
  'close_friend',
  'dating',
  'partner',
  'family',
  'rival',
  'enemy',
  'ex',
];

const RELATIONSHIP_IMPORTANCE: Readonly<Record<string, number>> = {
  friend: 3,
  close_friend: 4,
  dating: 4,
  partner: 5,
  family: 5,
  rival: 3,
  enemy: 3,
  ex: 4,
};

export interface LifeArchiveDraft {
  category: LifeArchiveCategory;
  title: string;
  description: string;
  importance: number;
  participantIds?: NPCId[];
  locationId?: LocationId;
  photoId?: EntityId;
  /** Sim time override; defaults to the current clock time. */
  at?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(data: JsonValue | undefined, key: string): string | null {
  if (!isRecord(data)) return null;
  const value = data[key];
  return typeof value === 'string' ? value : null;
}

function numberField(data: JsonValue | undefined, key: string): number | null {
  if (!isRecord(data)) return null;
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function titleCase(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export class LifeArchiveSystem {
  private readonly ctx: IGameContext;
  private readonly unsubscribers: Array<() => void> = [];
  private initialized = false;
  private sequence = 0;
  /** Fish species already registered before the first catch event of this session. */
  private readonly knownFishSpecies = new Set<string>();
  /** Relationship statuses already archived (avoids duplicate entries per status). */
  private readonly archivedRelationshipStatuses = new Map<string, RelationshipStatus>();
  /** Rare items already chronicled (first acquisition only). */
  private readonly seenRareItems = new Set<string>();

  constructor(ctx: IGameContext) {
    this.ctx = ctx;
  }

  /** Subscribes to the world bus. Safe to call once; repeated calls are ignored. */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.sequence = this.ctx.state.life.archive.length;
    for (const fishId of Object.keys(this.ctx.state.player.statistics.fishSpeciesCaught)) {
      this.knownFishSpecies.add(fishId);
    }
    for (const relationship of Object.values(this.ctx.state.player.relationships)) {
      this.archivedRelationshipStatuses.set(relationship.otherId, relationship.status);
    }
    this.subscribe('fish:caught', (payload) => this.onFishCaught(payload));
    this.subscribe('crop:harvested', (payload) => this.onCropHarvested(payload));
    this.subscribe('discovery:made', (payload) => this.onDiscoveryMade(payload));
    this.subscribe('relationship:changed', (payload) => this.onRelationshipChanged(payload));
    this.subscribe('event:occurred', (payload) => this.onEventOccurred(payload.event));
    this.subscribe('festival:participated', (payload) => this.onFestivalParticipated(payload));
    this.subscribe('achievement:unlocked', (payload) => this.onAchievementUnlocked(payload));
    this.subscribe('goal:completed', (payload) => this.onGoalCompleted(payload));
    this.subscribe('letter:received', (payload) => this.onLetterReceived(payload.letter));
    this.subscribe('item:acquired', (payload) => this.onItemAcquired(payload));
    this.subscribe('game:signal', (payload) => this.onGameSignal(payload.name, payload.data));
  }

  /** Unsubscribes from the bus (called on save/teardown in tests and hot-reload flows). */
  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.initialized = false;
  }

  private subscribe<K extends GameEventTopic>(topic: K, handler: (payload: GameEventMap[K]) => void): void {
    this.unsubscribers.push(this.ctx.bus.on(topic, handler));
  }

  getEntries(): LifeArchiveEntry[] {
    return [...this.ctx.state.life.archive];
  }

  private simNow(): number {
    return this.ctx.clock.simTimeSeconds;
  }

  private isAlive(): boolean {
    return this.ctx.state.life.phase === 'alive';
  }

  /**
   * Records one archive entry. Returns null when the entry is below the importance threshold
   * or when a full archive has nothing less important to evict.
   */
  recordLifeEvent(draft: LifeArchiveDraft): LifeArchiveEntry | null {
    const state = this.ctx.state;
    const threshold = archiveImportanceThreshold();
    const importance = Math.round(draft.importance);
    if (!Number.isFinite(importance) || importance < threshold) return null;

    const at = draft.at ?? this.simNow();
    this.sequence += 1;
    const id = 'arch_' + Math.round(at).toString(36) + '_' + this.sequence.toString(36);
    const participantIds = draft.participantIds ? [...draft.participantIds] : [];
    const entry: LifeArchiveEntry = {
      id,
      at,
      category: draft.category,
      title: draft.title,
      description: draft.description,
      importance: Math.min(10, Math.max(1, importance)),
      participantIds,
    };
    if (draft.locationId) entry.locationId = draft.locationId;
    if (draft.photoId) entry.photoId = draft.photoId;

    const archive = state.life.archive;
    if (archive.length >= MAX_ARCHIVE_ENTRIES) {
      let lowestIndex = -1;
      let lowestImportance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < archive.length; index += 1) {
        const existing = archive[index];
        if (existing && existing.importance < lowestImportance) {
          lowestImportance = existing.importance;
          lowestIndex = index;
        }
      }
      if (lowestIndex < 0 || lowestImportance >= entry.importance) return null;
      archive.splice(lowestIndex, 1);
    }
    archive.push(entry);
    this.ctx.bus.emit('life:archive', { entry });
    return entry;
  }

  // -------------------------------------------------------------------------
  // Event handlers - each one describes a real event only.
  // -------------------------------------------------------------------------
  private onFishCaught(payload: GameEventMap['fish:caught']): void {
    if (!this.isAlive()) return;
    const state = this.ctx.state;
    const content = this.ctx.content;
    const fish = content.getFish(payload.fishId);
    const fishName = fish?.name ?? payload.fishId;
    const isFirstOfSpecies = !this.knownFishSpecies.has(payload.fishId);
    this.knownFishSpecies.add(payload.fishId);
    const sizeText = payload.sizeCm.toFixed(1) + ' cm';
    if (isFirstOfSpecies) {
      this.recordLifeEvent({
        category: 'collection',
        title: 'First ' + fishName,
        description: 'Landed a ' + fishName + ' (' + sizeText + ') - the first one of its kind in this life.',
        importance: 4,
        locationId: state.player.position.locationId,
      });
      return;
    }
    const isPrize = fish !== undefined && payload.sizeCm >= fish.maxSizeCm * 0.85;
    if (payload.quality >= 4 || isPrize) {
      this.recordLifeEvent({
        category: 'collection',
        title: 'A fine ' + fishName,
        description: 'Caught a ' + qualityLabel(payload.quality) + ' ' + fishName + ' measuring ' + sizeText + '.',
        importance: 3,
        locationId: state.player.position.locationId,
      });
    }
  }

  private onCropHarvested(payload: GameEventMap['crop:harvested']): void {
    if (!this.isAlive()) return;
    const state = this.ctx.state;
    const crop = this.ctx.content.getCrop(payload.cropId);
    const cropName = crop?.name ?? payload.cropId;
    if (payload.quality >= 5) {
      this.recordLifeEvent({
        category: 'collection',
        title: 'A perfect ' + cropName,
        description:
          'Harvested ' + payload.quantity + ' five-star ' + cropName + '. The soil, the water and the ash all came together.',
        importance: 3,
        locationId: state.player.position.locationId,
      });
      return;
    }
    if (payload.quantity >= 10) {
      this.recordLifeEvent({
        category: 'collection',
        title: 'A haul of ' + cropName,
        description: 'Brought in a generous ' + payload.quantity + ' x ' + cropName + ' from the plots.',
        importance: 3,
        locationId: state.player.position.locationId,
      });
    }
  }

  private onDiscoveryMade(payload: GameEventMap['discovery:made']): void {
    if (!this.isAlive()) return;
    const state = this.ctx.state;
    const isMajor = payload.kind === 'secret' || payload.kind === 'location';
    const titles: Record<GameEventMap['discovery:made']['kind'], string> = {
      secret: 'A hidden secret',
      clue: 'A clue to something more',
      location: 'A hidden place',
      photo: 'A photograph worth keeping',
    };
    const draft: LifeArchiveDraft = {
      category: isMajor ? 'exploration' : 'collection',
      title: titles[payload.kind],
      description: payload.description,
      importance: isMajor ? 4 : 3,
      locationId: state.player.position.locationId,
    };
    if (payload.kind === 'photo') draft.photoId = payload.id;
    this.recordLifeEvent(draft);
  }

  private onRelationshipChanged(payload: GameEventMap['relationship:changed']): void {
    if (!this.isAlive()) return;
    const status = payload.status;
    if (!MAJOR_RELATIONSHIP_STATUSES.includes(status)) return;
    const previous = this.archivedRelationshipStatuses.get(payload.npcId);
    if (previous === status) return;
    this.archivedRelationshipStatuses.set(payload.npcId, status);
    const npcName =
      this.ctx.content.getNPC(payload.npcId)?.name ??
      this.ctx.state.npcs[payload.npcId]?.name ??
      payload.npcId;
    const importance = RELATIONSHIP_IMPORTANCE[status] ?? 3;
    this.recordLifeEvent({
      category: 'relationship',
      title: 'Became ' + relationshipNoun(status) + ' with ' + npcName,
      description:
        status === 'ex'
          ? 'A closeness with ' + npcName + ' ended, leaving only history and distance.'
          : 'The bond with ' + npcName + ' deepened to ' + relationshipNoun(status) +
            ' (affinity ' + Math.round(payload.affinity) + ', trust ' + Math.round(payload.trust) + ').',
      importance,
      participantIds: [payload.npcId],
    });
  }

  private onEventOccurred(event: WorldEvent): void {
    if (!this.isAlive()) return;
    if (event.importance < 3) return;
    const draft: LifeArchiveDraft = {
      category: 'event',
      title: event.title,
      description: event.description,
      importance: Math.min(10, Math.max(3, event.importance)),
      participantIds: event.participants,
      at: event.occurredAt,
    };
    if (event.locationId) draft.locationId = event.locationId;
    this.recordLifeEvent(draft);
  }

  private onFestivalParticipated(payload: GameEventMap['festival:participated']): void {
    if (!this.isAlive()) return;
    const festival = this.ctx.content.getFestival(payload.festivalId);
    const festivalName = festival?.name ?? payload.festivalId;
    this.recordLifeEvent({
      category: 'event',
      title: festivalName,
      description: 'Took part in ' + festivalName + ': ' + payload.activityId + ' (' + payload.result + ').',
      importance: 3,
      locationId: this.ctx.state.player.position.locationId,
    });
  }

  private onAchievementUnlocked(payload: GameEventMap['achievement:unlocked']): void {
    if (!this.isAlive()) return;
    this.recordLifeEvent({
      category: 'milestone',
      title: 'Achievement: ' + payload.title,
      description: 'Earned the achievement "' + payload.title + '".',
      importance: 4,
    });
  }

  private onGoalCompleted(payload: GameEventMap['goal:completed']): void {
    if (!this.isAlive()) return;
    this.recordLifeEvent({
      category: 'milestone',
      title: 'Life goal completed: ' + payload.title,
      description: 'Chose a direction for this life and saw it through: ' + payload.title + '.',
      importance: 5,
    });
  }

  private onLetterReceived(letter: LetterState): void {
    const state = this.ctx.state;
    if (!state.life.letters.some((existing) => existing.id === letter.id)) {
      state.life.letters.push({ ...letter, attachments: [...letter.attachments] });
      if (state.life.letters.length > MAX_LETTERS) state.life.letters.shift();
    }
    if (!this.isAlive()) return;
    const from = letter.fromNpcId
      ? this.ctx.content.getNPC(letter.fromNpcId)?.name ?? this.ctx.state.npcs[letter.fromNpcId]?.name ?? 'someone'
      : 'someone';
    this.recordLifeEvent({
      category: 'event',
      title: 'A letter from ' + from,
      description: 'Received a letter titled "' + letter.subject + '".',
      importance: 3,
    });
  }

  private onItemAcquired(payload: GameEventMap['item:acquired']): void {
    if (!this.isAlive()) return;
    const item = this.ctx.content.getItem(payload.itemId);
    if (!item) return;
    const rarity = item.rarity ?? 1;
    const isLegacy = payload.source === 'legacy' || (item.tags.includes('memento') && rarity >= 3);
    if (!isLegacy && rarity < 4) return;
    const key = payload.itemId + ':' + (isLegacy ? 'legacy' : 'rare');
    if (this.seenRareItems.has(key)) return;
    this.seenRareItems.add(key);
    this.recordLifeEvent({
      category: 'collection',
      title: isLegacy ? 'An heirloom from a past life' : 'A rare find: ' + item.name,
      description: isLegacy
        ? 'Took in a keepsake from a previous cigarette: ' + item.name + '.'
        : 'Found ' + item.name + ' - one of the rarer things in the world.',
      importance: isLegacy ? 4 : 3,
    });
  }

  private onGameSignal(name: string, data: JsonValue | undefined): void {
    if (!this.isAlive()) return;
    switch (name) {
      case 'skill:levelup': {
        const level = numberField(data, 'level');
        const skill = stringField(data, 'skill');
        if (level !== null && skill !== null && level % 5 === 0) {
          this.recordLifeEvent({
            category: 'milestone',
            title: titleCase(skill) + ' level ' + level,
            description: 'Reached level ' + level + ' in ' + titleCase(skill) + '.',
            importance: 3,
          });
        }
        return;
      }
      case 'community:project_complete':
      case 'community:project_completed':
      case 'community:completed': {
        const title = stringField(data, 'title') ?? 'a community project';
        this.recordLifeEvent({
          category: 'milestone',
          title: 'Community project completed',
          description: 'The village finished work on ' + title + '.',
          importance: 4,
        });
        return;
      }
      case 'business:purchased':
      case 'business:owned': {
        const businessName = stringField(data, 'name') ?? 'a business';
        this.recordLifeEvent({
          category: 'business',
          title: 'Took over ' + businessName,
          description: 'Became the owner of ' + businessName + '.',
          importance: 4,
        });
        return;
      }
      case 'cigarette:critical':
        this.recordLifeEvent({
          category: 'milestone',
          title: 'A close call with the wind',
          description: 'Came within a hairsbreadth of burning out, and kept going.',
          importance: 4,
        });
        return;
      case 'life:legacy_applied':
        this.recordLifeEvent({
          category: 'milestone',
          title: 'A new life, carrying old keepsakes',
          description: 'A new cigarette was lit, carrying mementos of a life that came before.',
          importance: 3,
        });
        return;
      default:
        return;
    }
  }
}

function qualityLabel(quality: number): string {
  switch (quality) {
    case 5: return 'perfect';
    case 4: return 'excellent';
    case 3: return 'fine';
    case 2: return 'good';
    default: return 'common';
  }
}

function relationshipNoun(status: RelationshipStatus): string {
  switch (status) {
    case 'friend': return 'friends';
    case 'close_friend': return 'close friends';
    case 'dating': return 'dating';
    case 'partner': return 'partners';
    case 'family': return 'family';
    case 'rival': return 'rivals';
    case 'enemy': return 'enemies';
    case 'ex': return 'former partners';
    case 'acquaintance': return 'acquaintances';
    default: return 'strangers';
  }
}
