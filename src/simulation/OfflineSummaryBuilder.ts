import type { GameState, OfflineChange, OfflineSummary } from '../core/contracts';
import type { NPCId } from '../core/SharedTypes';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { formatMoney } from '../core/format';
import { simSecondsToGameTime } from '../core/TimeUtil';

interface NpcBaseline {
  money: number;
  locationId: string;
  activity: string;
  relationshipStatuses: Record<string, string>;
}

export interface SummaryBaseline {
  capturedAt: number;
  eventIds: string[];
  historyIds: string[];
  letterIds: string[];
  achievementIds: string[];
  archiveIds: string[];
  playerMoney: number;
  playerLengthRatio: number;
  playerMoisture: number;
  playerInfluence: number;
  npc: Record<string, NpcBaseline>;
  business: Record<string, { money: number; revenue: number; stockValue: number }>;
  marketPrices: Record<string, number>;
  flags: string[];
}

function stockValue(state: GameState, businessId: string): number {
  const business = state.economy.businesses[businessId];
  if (!business) return 0;
  return business.stock.reduce((total, entry) => total + entry.price * entry.quantity, 0);
}

export function captureSummaryBaseline(state: GameState): SummaryBaseline {
  const npc: Record<string, NpcBaseline> = {};
  for (const npcState of Object.values(state.npcs)) {
    if (!npcState.isMajor) continue;
    const statuses: Record<string, string> = {};
    for (const [otherId, relationship] of Object.entries(npcState.relationships)) {
      statuses[otherId] = relationship.status;
    }
    npc[npcState.id] = {
      money: npcState.money,
      locationId: npcState.locationId,
      activity: npcState.currentActivity,
      relationshipStatuses: statuses,
    };
  }
  const business: Record<string, { money: number; revenue: number; stockValue: number }> = {};
  for (const [id, biz] of Object.entries(state.economy.businesses)) {
    business[id] = {
      money: biz.money,
      revenue: biz.totalRevenue,
      stockValue: stockValue(state, id),
    };
  }
  const marketPrices: Record<string, number> = {};
  for (const [itemId, good] of Object.entries(state.economy.market)) {
    marketPrices[itemId] = good.currentPrice;
  }
  return {
    capturedAt: state.clock.simTimeSeconds,
    eventIds: state.world.events.map((event) => event.id),
    historyIds: state.world.history.map((entry) => entry.id),
    letterIds: state.life.letters.map((letter) => letter.id),
    achievementIds: state.life.achievements.map((achievement) => achievement.id),
    archiveIds: state.life.archive.map((entry) => entry.id),
    playerMoney: state.player.money,
    playerLengthRatio: state.player.cigarette.lengthRatio,
    playerMoisture: state.player.cigarette.moisture,
    playerInfluence: state.player.influence,
    npc,
    business,
    marketPrices,
    flags: Object.keys(state.world.worldFlags).filter((flag) => state.world.worldFlags[flag]),
  };
}

function push(change: OfflineChange, changes: OfflineChange[]): void {
  if (changes.length >= 60) return;
  changes.push(change);
}

export interface BuildOfflineSummaryInput {
  state: GameState;
  baseline: SummaryBaseline;
  fromSimTime: number;
  toSimTime: number;
  realElapsedMs: number;
}

/** Builds a player-facing summary of everything meaningful that happened while away. */
export function buildOfflineSummary(input: BuildOfflineSummaryInput): OfflineSummary {
  const { state, baseline, fromSimTime, toSimTime, realElapsedMs } = input;
  const changes: OfflineChange[] = [];
  const highlights: string[] = [];

  const knownEvents = new Set(baseline.eventIds);
  const knownHistory = new Set(baseline.historyIds);
  const knownLetters = new Set(baseline.letterIds);
  const knownAchievements = new Set(baseline.achievementIds);
  const knownArchive = new Set(baseline.archiveIds);

  const newEvents = state.world.events.filter((event) => !knownEvents.has(event.id));
  for (const event of newEvents.slice(-20)) {
    push(
      {
        kind: 'event',
        description: event.title,
        importance: event.importance,
        relatedId: event.id,
      },
      changes
    );
  }

  const newHistory = state.world.history.filter((entry) => !knownHistory.has(entry.id) && entry.importance >= 3);
  for (const entry of newHistory.slice(-20)) {
    push(
      {
        kind: 'world',
        description: entry.description,
        importance: entry.importance,
        relatedId: entry.id,
      },
      changes
    );
  }

  const importantNpcUpdates: { npcId: NPCId; name: string; description: string }[] = [];
  for (const npcState of Object.values(state.npcs)) {
    const before = baseline.npc[npcState.id];
    if (!before || !npcState.isMajor) continue;
    const parts: string[] = [];
    let importance = 1;
    if (before.activity !== npcState.currentActivity) {
      parts.push(npcState.name + ' spent time ' + npcState.currentActivity.replaceAll('_', ' ') + ' at ' + npcState.locationId);
    }
    if (Math.abs(npcState.money - before.money) >= 2500) {
      const diff = npcState.money - before.money;
      parts.push(npcState.name + (diff > 0 ? ' earned ' : ' spent ') + formatMoney(Math.abs(diff)));
      importance = 2;
    }
    for (const [otherId, relationship] of Object.entries(npcState.relationships)) {
      const previous = before.relationshipStatuses[otherId];
      if (previous && previous !== relationship.status) {
        const otherName = state.npcs[otherId]?.name ?? otherId;
        parts.push(npcState.name + ' and ' + otherName + ' are now ' + relationship.status.replaceAll('_', ' '));
        importance = Math.max(importance, 3);
      }
    }
    if (parts.length > 0) {
      const description = parts.join('; ');
      importantNpcUpdates.push({ npcId: npcState.id, name: npcState.name, description });
      push({ kind: 'npc', description, importance, relatedId: npcState.id }, changes);
    }
  }

  for (const [businessId, biz] of Object.entries(state.economy.businesses)) {
    const before = baseline.business[businessId];
    if (!before) continue;
    const revenue = biz.totalRevenue - before.revenue;
    if (revenue >= 5000) {
      push(
        {
          kind: 'business',
          description: biz.name + ' took ' + formatMoney(revenue) + ' over the time you were away',
          importance: 2,
          relatedId: businessId,
        },
        changes
      );
    }
  }

  let priceChangeCount = 0;
  for (const [itemId, good] of Object.entries(state.economy.market)) {
    const beforePrice = baseline.marketPrices[itemId];
    if (!beforePrice || beforePrice === good.currentPrice) continue;
    const ratio = good.currentPrice / beforePrice;
    if (ratio >= 1.25 || ratio <= 0.8) {
      priceChangeCount += 1;
      if (priceChangeCount <= 3) {
        push(
          {
            kind: 'economy',
            description: 'The market price of ' + state.player.name + "'s goods shifted: item " + itemId + ' is now ' + formatMoney(good.currentPrice),
            importance: 1,
            relatedId: itemId,
          },
          changes
        );
      }
    }
  }

  const newLetters = state.life.letters.filter((letter) => !knownLetters.has(letter.id));
  for (const letter of newLetters.slice(-8)) {
    push(
      {
        kind: 'event',
        description: 'You received a letter: ' + letter.subject,
        importance: 3,
        relatedId: letter.id,
      },
      changes
    );
  }

  const newAchievements = state.life.achievements.filter((achievement) => !knownAchievements.has(achievement.id));
  for (const achievement of newAchievements) {
    push(
      {
        kind: 'player',
        description: 'Achievement unlocked while away: ' + achievement.id,
        importance: 3,
        relatedId: achievement.id,
      },
      changes
    );
  }

  const newArchive = state.life.archive.filter(
    (entry) => !knownArchive.has(entry.id) && entry.importance >= WORLD_CONFIG.life.archiveImportanceThreshold
  );
  for (const entry of newArchive.slice(-12)) {
    push({ kind: 'player', description: entry.title + ': ' + entry.description, importance: entry.importance }, changes);
  }

  const moneyDelta = state.player.money - baseline.playerMoney;
  if (Math.abs(moneyDelta) >= 1000) {
    push(
      {
        kind: 'player',
        description: 'Your balance changed by ' + formatMoney(moneyDelta),
        importance: 2,
      },
      changes
    );
  }
  const burned = baseline.playerLengthRatio - state.player.cigarette.lengthRatio;
  if (burned > 0.002) {
    push(
      {
        kind: 'player',
        description: 'Your cigarette shortened by ' + (burned * 100).toFixed(1) + '% while you were away',
        importance: 2,
      },
      changes
    );
  }
  const moistureDelta = state.player.cigarette.moisture - baseline.playerMoisture;
  if (Math.abs(moistureDelta) > 0.08) {
    push(
      {
        kind: 'player',
        description: moistureDelta > 0 ? 'You got damper while away' : 'You dried out while away',
        importance: 1,
      },
      changes
    );
  }
  const influenceDelta = state.player.influence - baseline.playerInfluence;
  if (Math.abs(influenceDelta) >= 5) {
    push(
      {
        kind: 'player',
        description: 'Your influence changed by ' + influenceDelta.toFixed(0),
        importance: 2,
      },
      changes
    );
  }

  const newFlags = Object.keys(state.world.worldFlags).filter(
    (flag) => state.world.worldFlags[flag] && !baseline.flags.includes(flag)
  );
  for (const flag of newFlags.slice(0, 5)) {
    push({ kind: 'world', description: 'Something changed in the world: ' + flag.replaceAll('_', ' '), importance: 2 }, changes);
  }

  changes.sort((a, b) => b.importance - a.importance);
  for (const change of changes.slice(0, 8)) {
    if (!highlights.includes(change.description)) highlights.push(change.description);
  }

  const start = simSecondsToGameTime(fromSimTime);
  const end = simSecondsToGameTime(toSimTime);
  const simulatedGameHours = Math.max(0, (toSimTime - fromSimTime) / 60);
  const days = Math.floor(simulatedGameHours / 24);
  const hours = Math.round(simulatedGameHours % 24);
  const duration = simulatedGameHours >= 24 ? days + ' days ' + hours + 'h' : Math.max(1, Math.round(simulatedGameHours)) + 'h';

  const headline =
    changes.length > 0
      ? 'While you were away for ' + duration + ', the world kept turning. ' + changes.length + ' notable things happened.'
      : 'While you were away for ' + duration + ', the world carried on quietly. Nothing important needed your attention.';

  return {
    fromSimTime,
    toSimTime,
    realElapsedMs,
    simulatedGameHours,
    headline,
    changes: changes.slice(0, 60),
    newEvents: newEvents.map((event) => event.id).slice(0, 80),
    letters: newLetters.slice(0, 20),
    highlights,
    importantNpcUpdates: importantNpcUpdates.slice(0, 8),
  };
}
