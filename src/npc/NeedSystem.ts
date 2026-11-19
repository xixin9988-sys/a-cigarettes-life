// =============================================================================
// NeedSystem - 9 needs, decay/accumulation per game hour with activity
// modifiers, activity satisfaction and derived emotions/mood.
// Deterministic, DOM-free.
// =============================================================================
import type { NPCState } from '../core/contracts';
import type { NPCEmotionsValues } from '../core/SharedTypes';
import { NEED_KEYS, SECONDS_PER_GAME_MINUTE } from '../core/SharedTypes';
import { WORLD_CONFIG } from '../core/WorldConfig';
import { clamp, moveTowards } from '../core/utils';
import {
  NEED_POLARITY,
  activityGroupOf,
  clampNeedValue,
  getActivityDefinition,
  needImprovement,
  needUrgency,
  type NeedKey,
  type NeedPolarity,
} from './NPC';
import { deriveProfile, normalisePersonality } from './PersonalitySystem';

export const NEED_KEY_LIST = NEED_KEYS as readonly NeedKey[];

export interface NeedSnapshotEntry {
  need: NeedKey;
  value: number;
  urgency: number;
  polarity: NeedPolarity;
}

export interface NeedExternalContext {
  /** Extra multiplicative decay factors keyed by need. */
  modifiers?: Partial<Record<NeedKey, number>>;
  /** True when someone else is present at the same location (social need decays slower). */
  hasCompany?: boolean;
}

/** Decay multipliers derived from what the NPC is currently doing. */
export function activityDecayModifiers(activityId: string): Partial<Record<NeedKey, number>> {
  const group = activityGroupOf(activityId);
  switch (group) {
    case 'sleep':
      return { energy: 0, hunger: 0.55, social: 0.4, fun: 0.4, workPressure: 0.35, moneyPressure: 0.4 };
    case 'work':
      return { energy: 1.55, hunger: 1.25, social: 0.9, fun: 0.7, workPressure: 1.8, moneyPressure: 0.8 };
    case 'social':
      return { social: 0.25, belonging: 0.3, fun: 0.4, hunger: 1.05, moneyPressure: 1.1 };
    case 'leisure':
      return { fun: 0.35, social: 0.8, energy: 0.9 };
    case 'explore':
      return { fun: 0.3, energy: 1.3, hunger: 1.15, safety: 1.2 };
    case 'food':
      return { hunger: 0.2, energy: 0.7, social: 0.9 };
    case 'care':
      return { energy: 0.35, workPressure: 0.6, moneyPressure: 0.7 };
    case 'home':
      return { safety: 0.4, belonging: 0.5, energy: 0.7 };
    case 'errand':
      return { purpose: 0.6, moneyPressure: 0.7, energy: 1.1 };
    case 'travel':
      return { energy: 1.2, fun: 0.7, safety: 1.1 };
    default:
      return {};
  }
}

/**
 * Lifetime money pressure target: the less money an NPC has relative to a
 * comfortable living fund, the more financial pressure they feel.
 */
export function moneyPressureTarget(moneyPence: number): number {
  if (!Number.isFinite(moneyPence)) return 50;
  if (moneyPence >= 120000) return 3;
  if (moneyPence >= 60000) return 12;
  if (moneyPence >= 30000) return 28;
  if (moneyPence >= 15000) return 48;
  if (moneyPence >= 5000) return 70;
  return 90;
}

export class NeedSystem {
  /** Multiplicative decay rates from the shared world config (per game hour). */
  readonly decayPerGameHour: Readonly<Record<NeedKey, number>> = WORLD_CONFIG.needs.decayPerGameHour;

  /**
   * Advances all nine needs over the given number of game hours.
   * Resource needs decay downward, pressure needs accumulate upward; both are
   * clamped to 0..100. The money-pressure target reacts to the NPC's wallet.
   */
  applyHourlyDecay(npc: NPCState, gameHours: number, context?: NeedExternalContext): void {
    const hours = Math.max(0, Number.isFinite(gameHours) ? gameHours : 0);
    if (hours <= 0) return;
    const activityModifiers = activityDecayModifiers(npc.currentActivity);
    const external = context?.modifiers ?? {};
    for (const need of NEED_KEY_LIST) {
      let modifier = activityModifiers[need] ?? 1;
      modifier *= external[need] ?? 1;
      if (need === 'social' && context?.hasCompany === true) modifier *= 0.55;
      const rate = this.decayPerGameHour[need];
      const direction = NEED_POLARITY[need] === 'resource' ? -1 : 1;
      npc.needs[need] = clampNeedValue(npc.needs[need] + direction * rate * hours * modifier);
    }
    // Financial pressure follows disposable wealth rather than a fixed ramp.
    const target = moneyPressureTarget(npc.money);
    npc.needs.moneyPressure = clampNeedValue(
      moveTowards(npc.needs.moneyPressure, target, hours * 0.5)
    );
  }

  /**
   * Applies the need satisfaction of a completed activity. Actual duration is
   * scaled against the activity's typical duration so interrupted naps or
   * long shifts give proportional benefits.
   */
  applyActivityCompletion(npc: NPCState, activityId: string, actualMinutes: number): void {
    const definition = getActivityDefinition(activityId);
    if (!definition) return;
    const safeMinutes = Math.max(1, Number.isFinite(actualMinutes) ? actualMinutes : definition.baseDurationMinutes);
    const scale = clamp(safeMinutes / definition.baseDurationMinutes, 0.3, 1.75);
    for (const need of NEED_KEY_LIST) {
      const delta = definition.satisfy[need];
      if (delta === undefined) continue;
      npc.needs[need] = clampNeedValue(npc.needs[need] + delta * scale);
    }
  }

  /** Applies an ad-hoc need delta (events, accidents, gifts...). */
  applyExternalDelta(npc: NPCState, delta: Partial<Record<NeedKey, number>>): void {
    for (const need of NEED_KEY_LIST) {
      const value = delta[need];
      if (value === undefined) continue;
      npc.needs[need] = clampNeedValue(npc.needs[need] + value);
    }
  }

  /**
   * Drifts the six emotions towards targets derived from needs + personality.
   * Emotion values are 0..1.
   */
  updateEmotions(npc: NPCState, gameHours: number): void {
    const hours = Math.max(0, Number.isFinite(gameHours) ? gameHours : 0);
    if (hours <= 0) {
      this.recomputeMood(npc);
      return;
    }
    const profile = deriveProfile(normalisePersonality(npc.personality));
    const n = npc.needs;
    const satisfaction = clamp(n.fun / 100, 0, 1);
    const social = clamp(n.social / 100, 0, 1);
    const belonging = clamp(n.belonging / 100, 0, 1);
    const purpose = clamp(n.purpose / 100, 0, 1);
    const energy = clamp(n.energy / 100, 0, 1);
    const safety = clamp(n.safety / 100, 0, 1);
    const hunger = clamp(n.hunger / 100, 0, 1);
    const workPressure = clamp(n.workPressure / 100, 0, 1);
    const moneyPressure = clamp(n.moneyPressure / 100, 0, 1);
    const stress = clamp(0.4 * workPressure + 0.3 * moneyPressure + 0.2 * (1 - energy) + 0.1 * (1 - safety), 0, 1);

    const targets: NPCEmotionsValues = {
      joy: clamp(
        0.42 * satisfaction +
          0.22 * social +
          0.12 * belonging +
          0.1 * energy +
          0.08 * purpose +
          0.06 * profile.socialDrive -
          0.3 * stress,
        0,
        1
      ),
      sadness: clamp(
        0.32 * (1 - social) +
          0.24 * (1 - belonging) +
          0.2 * (1 - purpose) +
          0.14 * (1 - satisfaction) +
          0.1 * (1 - energy) +
          0.08 * profile.cautionDrive -
          0.25 * satisfaction,
        0,
        1
      ),
      anger: clamp(0.45 * workPressure + 0.3 * moneyPressure + 0.2 * hunger + 0.05 * (1 - profile.generosity) - 0.3 * satisfaction, 0, 1),
      fear: clamp(0.5 * (1 - safety) + 0.2 * (1 - energy) + 0.15 * profile.cautionDrive + 0.15 * moneyPressure, 0, 1),
      affection: clamp(0.3 * social + 0.25 * belonging + 0.2 * profile.generosity + 0.15 * (1 - profile.cautionDrive) + 0.1 * purpose, 0, 1),
      stress,
    };
    const rate = hours * 0.18;
    for (const key of Object.keys(targets) as (keyof NPCEmotionsValues)[]) {
      npc.emotions[key] = clamp(moveTowards(npc.emotions[key], targets[key], rate), 0, 1);
    }
    this.recomputeMood(npc);
  }

  /** Mood is a -1..1 scalar used by dialogue/social systems. */
  recomputeMood(npc: NPCState): void {
    const e = npc.emotions;
    npc.mood = clamp(
      e.joy * 0.6 + e.affection * 0.2 - e.sadness * 0.5 - e.anger * 0.35 - e.fear * 0.25 - e.stress * 0.3,
      -1,
      1
    );
  }

  /** Snapshot ordered by urgency (most pressing first). */
  needSnapshot(npc: NPCState): NeedSnapshotEntry[] {
    const entries: NeedSnapshotEntry[] = NEED_KEY_LIST.map((need) => ({
      need,
      value: npc.needs[need],
      urgency: needUrgency(need, npc.needs[need]),
      polarity: NEED_POLARITY[need],
    }));
    entries.sort((a, b) => b.urgency - a.urgency);
    return entries;
  }

  mostUrgentNeed(npc: NPCState): NeedSnapshotEntry {
    const snapshot = this.needSnapshot(npc);
    return (
      snapshot[0] ?? { need: 'hunger', value: npc.needs.hunger, urgency: 0, polarity: NEED_POLARITY.hunger }
    );
  }

  /**
   * Utility score of a need-delta map: how much an activity would improve the
   * NPC's current state. Costs are weighted lower than benefits so that
   * activities with a small price still look attractive.
   */
  evaluateNeedDelta(npc: NPCState, delta: Partial<Record<NeedKey, number>>): number {
    let score = 0;
    for (const need of NEED_KEY_LIST) {
      const change = delta[need];
      if (change === undefined || change === 0) continue;
      const improvement = needImprovement(need, change);
      const urgency = needUrgency(need, npc.needs[need]);
      if (improvement >= 0) {
        score += (improvement / 55) * urgency;
      } else {
        score += (improvement / 70) * urgency * 0.55;
      }
    }
    return score;
  }

  /** Converts a need value into 0..1 urgency (resource needs inverted). */
  urgencyOf(npc: NPCState, need: NeedKey): number {
    return needUrgency(need, npc.needs[need]);
  }

  /** gameMinutes -> sim seconds helper for callers that work in game minutes. */
  static minutesToSimSeconds(minutes: number): number {
    return minutes * SECONDS_PER_GAME_MINUTE;
  }
}
