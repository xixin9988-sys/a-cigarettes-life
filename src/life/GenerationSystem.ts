import type {
  ArchivedLife,
  ArchivedPerson,
  GameState,
  IContentRegistry,
  LetterState,
} from '../core/contracts';
import type { IClock, IEventBus, ILogger } from '../core/contracts';
import type { SkillId } from '../core/SharedTypes';
import { SKILL_IDS } from '../core/SharedTypes';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { addItemToInventory } from '../core/InventoryUtil';
import { readLifeExtras, readPhotos } from './lifeShared';

/**
 * GenerationSystem - life review and multi-generation legacy (spec module 13).
 *
 * buildArchivedLife() turns the *real records* of an ended life into an ArchivedLife:
 * the life archive, statistics, important relationships, skills, collections, business
 * history, photos, letters, world changes and choices. Nothing is invented - an empty
 * record stays empty.
 *
 * getLegacyOptions() offers at most 3 mementos a new generation may inherit; memos come
 * from the archive's collection records (collectible / memorabilia tagged items) and, when
 * a live state is supplied, keepsakes currently carried. applyLegacyItems() puts the chosen
 * keep-sakes into the new life's inventory (meta.legacy = true) and records the inheritance
 * on the archived life.
 */
const MAX_IMPORTANT_PEOPLE = 8;
const MAX_WORLD_CHANGES = 20;
const MAX_BUSINESS_HISTORY = 8;
const KEEPSAKE_TAGS: readonly string[] = [
  'collectible',
  'memorabilia',
  'memento',
  'keepsake',
  'photo',
  'letter',
  'gift',
  'festival',
];

export interface LegacyOption {
  itemId: string;
  name: string;
}

export interface GenerationDeps {
  state: GameState;
  content: IContentRegistry;
  clock: IClock;
  bus: IEventBus;
  logger?: ILogger;
}

function copyStatistics(state: GameState): ArchivedLife['statistics'] {
  const statistics = state.player.statistics;
  return {
    ...statistics,
    fishSpeciesCaught: { ...statistics.fishSpeciesCaught },
    fishBiggest: { ...statistics.fishBiggest },
  };
}

function copyLetters(letters: readonly LetterState[]): LetterState[] {
  return letters.map((letter) => ({ ...letter, attachments: [...letter.attachments] }));
}

export class GenerationSystem {
  private readonly deps: GenerationDeps;

  constructor(deps: GenerationDeps) {
    this.deps = deps;
  }

  get maxLegacyItems(): number {
    return WORLD_CONFIG.life.maxLegacyItems;
  }

  /**
   * Builds the real life review for an ended life. Returns null while the cigarette is
   * still burning - there is no honest review of an unfinished life.
   */
  buildArchivedLife(state: GameState): ArchivedLife | null {
    const life = state.life;
    if (life.phase === 'alive') return null;
    const content = this.deps.content;
    const endedAt = life.endedAt ?? this.deps.clock.simTimeSeconds;
    const residenceId = state.player.residenceId;
    const residenceName =
      content.getLocation(residenceId)?.name ?? state.world.locations[residenceId]?.name ?? residenceId;
    const skills = {} as Record<SkillId, number>;
    for (const skill of SKILL_IDS) {
      skills[skill] = state.player.skills[skill]?.level ?? 0;
    }

    const importantPeople: ArchivedPerson[] = [];
    const relationships = Object.values(state.player.relationships);
    relationships.sort((a, b) => b.affinity - a.affinity);
    for (const relationship of relationships) {
      const isMajorStatus =
        relationship.status === 'friend' ||
        relationship.status === 'close_friend' ||
        relationship.status === 'dating' ||
        relationship.status === 'partner' ||
        relationship.status === 'family';
      if (relationship.affinity < 20 && !isMajorStatus) continue;
      const npcId = relationship.otherId;
      const name = content.getNPC(npcId)?.name ?? state.npcs[npcId]?.name ?? npcId;
      importantPeople.push({
        npcId,
        name,
        status: relationship.status,
        affinity: Math.round(relationship.affinity * 10) / 10,
      });
      if (importantPeople.length >= MAX_IMPORTANT_PEOPLE) break;
    }

    return {
      lifeId: life.lifeId,
      generation: life.generation,
      name: state.player.name.trim().length > 0 ? state.player.name.trim() : 'Ash',
      startedAt: life.startedAt,
      endedAt,
      durationDays: Math.round(life.ageDays * 10) / 10,
      endReason: life.endReason ?? 'Burned out',
      residenceName,
      occupation: state.player.occupation,
      skills,
      finalMoney: state.player.money,
      collections: Object.entries(state.collection.entries).map(([itemId, entry]) => ({
        itemId,
        count: entry.count,
      })),
      importantPeople,
      businessHistory: this.buildBusinessHistory(state),
      archive: [...life.archive],
      photos: readPhotos(state),
      letters: copyLetters(life.letters),
      worldChanges: this.buildWorldChanges(state),
      choices: this.buildChoices(state),
      legacyItemIds: [...life.legacyItemIds],
      statistics: copyStatistics(state),
    };
  }

  private buildBusinessHistory(state: GameState): string[] {
    const content = this.deps.content;
    const history: string[] = [];
    const playerShop = state.economy.playerShop;
    if (playerShop) {
      const business = state.economy.businesses[playerShop.businessId];
      const region = content.getLocation(playerShop.locationId)?.regionId ?? playerShop.regionId;
      history.push(
        'Ran ' + playerShop.name + ' in ' + region + ' - ' + playerShop.totalRevenue + ' pence total revenue, ' +
          playerShop.totalExpenses + ' pence in costs, reputation ' + Math.round(playerShop.reputation) + '.'
      );
      if (business) {
        const recent = business.history.slice(-5);
        for (const record of recent) {
          history.push(
            'Day ' + record.day + ' at ' + business.name + ': ' + record.revenue + ' pence revenue from ' +
              record.customers + ' customers.'
          );
        }
      }
    }
    // Only major world business history is worth carrying into a life review.
    const businessHistoryEntries = state.world.history.filter(
      (entry) => entry.category === 'business' && entry.importance >= 4
    );
    for (const entry of businessHistoryEntries.slice(-3)) {
      history.push(entry.description);
    }
    return history.slice(0, MAX_BUSINESS_HISTORY);
  }

  private buildWorldChanges(state: GameState): string[] {
    const changes = state.world.history
      .filter((entry) => entry.importance >= 4)
      .map((entry) => entry.description);
    if (changes.length <= MAX_WORLD_CHANGES) return changes;
    return changes.slice(changes.length - MAX_WORLD_CHANGES);
  }

  private buildChoices(state: GameState): string[] {
    const choices: string[] = [];
    for (const entry of state.life.archive) {
      if (entry.category === 'choice') choices.push(entry.title);
    }
    const goal = readLifeExtras(state).personalGoal;
    if (goal) {
      choices.push('Chose the life goal "' + goal.title + '".');
    }
    return choices;
  }

  /**
   * Up to WORLD_CONFIG.life.maxLegacyItems mementos a new generation may inherit.
   * Candidates are real items from the archived collection (collectible / memorabilia
   * tagged or rare) plus items carried in the live state when one is supplied.
   */
  getLegacyOptions(archive: ArchivedLife, state?: GameState): LegacyOption[] {
    const content = this.deps.content;
    const scored = new Map<string, number>();
    const consider = (itemId: string, scoreBoost: number): void => {
      const item = content.getItem(itemId);
      if (!item) return;
      const isKeepsake = item.tags.some((tag) => KEEPSAKE_TAGS.includes(tag));
      const rarity = item.rarity ?? 1;
      if (!isKeepsake && rarity < 4) return;
      const score = rarity * 10 + (isKeepsake ? 20 : 0) + scoreBoost;
      const previous = scored.get(itemId) ?? Number.NEGATIVE_INFINITY;
      if (score > previous) scored.set(itemId, score);
    };
    for (const collection of archive.collections) {
      consider(collection.itemId, Math.min(20, collection.count));
    }
    for (const itemId of archive.legacyItemIds) {
      consider(itemId, 15);
    }
    if (state) {
      for (const entry of state.player.inventory) {
        consider(entry.itemId, entry.quantity);
      }
    }
    const sorted = [...scored.entries()].sort((a, b) => b[1] - a[1]);
    const options: LegacyOption[] = [];
    for (const [itemId] of sorted) {
      options.push({ itemId, name: content.resolveItemName(itemId) });
      if (options.length >= this.maxLegacyItems) break;
    }
    return options;
  }

  /**
   * Applies chosen legacy items to the current (new) life. At most 3 items are accepted;
   * invalid or unknown ids are skipped. Applying twice is a no-op.
   */
  applyLegacyItems(state: GameState, itemIds: string[]): void {
    if (state.life.legacyItemIds.length > 0) return;
    const content = this.deps.content;
    const applied: string[] = [];
    const seen = new Set<string>();
    for (const itemId of itemIds) {
      if (applied.length >= this.maxLegacyItems) break;
      if (seen.has(itemId)) continue;
      seen.add(itemId);
      const item = content.getItem(itemId);
      if (!item) {
        this.deps.logger?.warn('legacy item skipped: unknown item id', { itemId });
        continue;
      }
      addItemToInventory(state.player.inventory, itemId, 1, {
        simTime: this.deps.clock.simTimeSeconds,
        quality: 1,
        maxStack: Math.max(1, item.maxStack),
        meta: { legacy: true, inheritedFromGeneration: state.life.generation },
      });
      applied.push(itemId);
      this.deps.bus.emit('item:acquired', { itemId, quantity: 1, quality: 1, source: 'legacy' });
    }
    state.life.legacyItemIds = [...applied];
    if (applied.length === 0) return;
    const previousLife = state.archive.length > 0 ? state.archive[state.archive.length - 1] : undefined;
    if (previousLife) previousLife.legacyItemIds = [...applied];
    this.deps.bus.emit('game:signal', {
      name: 'life:legacy_applied',
      data: { itemIds: applied, generation: state.life.generation },
    });
    this.deps.logger?.info('legacy items applied', { count: applied.length });
  }
}

