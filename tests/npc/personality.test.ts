// =============================================================================
// PersonalitySystem tests: trait -> drive mapping, activity multipliers,
// personality tags and - most importantly - the utility AI actually choosing
// different activities for an extrovert versus a workaholic NPC.
// =============================================================================
import { describe, expect, it } from 'vitest';
import {
  PersonalitySystem,
  deriveProfile,
  describePersonality,
  normalisePersonality,
  romanceCompatibility,
  socialCompatibility,
} from '../../src/npc/PersonalitySystem';
import { DECISION_ACTIVITIES, activityGroupOf, type ActivityGroup } from '../../src/npc/NPC';
import type { NPCState } from '../../src/core/contracts';
import { createNpcHarness } from './support/harness';

function withPersonality(npc: NPCState, overrides: Record<string, number>): NPCState {
  const clone = structuredClone(npc);
  clone.personality = normalisePersonality({ ...clone.personality, ...overrides });
  clone.activityHistory = [];
  clone.needs = {
    hunger: 20, energy: 90, social: 30, fun: 35, safety: 60,
    belonging: 60, moneyPressure: 80, workPressure: 80, purpose: 10,
  };
  clone.money = 50000;
  clone.jobId = null;
  clone.currentActivity = 'relax';
  clone.activityEndsAt = 0;
  clone.decisionCooldownUntil = 0;
  return clone;
}

describe('PersonalitySystem', () => {
  it('maps the 12 traits onto behavioural drives', () => {
    const personality = new PersonalitySystem();
    const extrovert = deriveProfile(
      normalisePersonality({ extroversion: 0.95, introversion: 0.05, socialNeed: 0.9, workTendency: 0.2 })
    );
    const worker = deriveProfile(
      normalisePersonality({ extroversion: 0.1, introversion: 0.9, socialNeed: 0.1, workTendency: 0.95, responsibility: 0.9 })
    );
    expect(extrovert.socialDrive).toBeGreaterThan(worker.socialDrive);
    expect(worker.workDrive).toBeGreaterThan(extrovert.workDrive);
    expect(extrovert.homeDrive).toBeLessThan(worker.homeDrive);
    for (const profile of [extrovert, worker]) {
      for (const value of Object.values(profile)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('produces personality-scaled activity multipliers', () => {
    const system = new PersonalitySystem();
    const extrovert = withPersonality(
      createNpcHarness().majorNpcs()[0]!,
      { extroversion: 0.95, introversion: 0.05, socialNeed: 0.95, workTendency: 0.1, responsibility: 0.1 }
    );
    const worker = withPersonality(
      createNpcHarness().majorNpcs()[1]!,
      { extroversion: 0.1, introversion: 0.9, socialNeed: 0.1, workTendency: 0.95, responsibility: 0.95 }
    );
    expect(system.activityMultiplier(extrovert, 'go_cafe')).toBeGreaterThan(system.activityMultiplier(extrovert, 'work'));
    expect(system.activityMultiplier(worker, 'work')).toBeGreaterThan(system.activityMultiplier(worker, 'go_cafe'));
    expect(system.activityMultiplier(worker, 'work')).toBeGreaterThan(system.activityMultiplier(extrovert, 'work'));
  });

  it('calculates compatibility within 0..1 and rewards similarity', () => {
    const similar = normalisePersonality({ extroversion: 0.7, generosity: 0.7, curiosity: 0.7 });
    const other = normalisePersonality({ extroversion: 0.7, generosity: 0.7, curiosity: 0.7 });
    const distant = normalisePersonality({ extroversion: 0.1, generosity: 0.1, curiosity: 0.1, caution: 0.95 });
    const closeScore = socialCompatibility(similar, other);
    const farScore = socialCompatibility(similar, distant);
    expect(closeScore).toBeGreaterThan(farScore);
    for (const score of [closeScore, farScore, romanceCompatibility(similar, distant)]) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('derives human-readable personality tags', () => {
    const extrovertTags = describePersonality(normalisePersonality({ extroversion: 0.95, socialNeed: 0.95, generosity: 0.9 }));
    expect(extrovertTags.length).toBeGreaterThanOrEqual(1);
    expect(extrovertTags.length).toBeLessThanOrEqual(4);
    expect(extrovertTags.some((tag) => tag.id === 'outgoing' || tag.id === 'gregarious')).toBe(true);
    const quietTags = describePersonality(normalisePersonality({ introversion: 0.95, extroversion: 0.05, caution: 0.8 }));
    expect(quietTags.some((tag) => tag.id === 'reserved' || tag.id === 'homebody')).toBe(true);
  });

  it('makes the utility AI favour social activities for extroverts and work for workaholics', () => {
    const harness = createNpcHarness({ seed: 777001 });
    const engine = harness.system.decisionEngine;
    const npcs = harness.majorNpcs();
    const extrovert = withPersonality(npcs[0]!, {
      extroversion: 0.97, introversion: 0.03, socialNeed: 0.97, generosity: 0.8,
      workTendency: 0.1, responsibility: 0.15, adventure: 0.5, curiosity: 0.6,
    });
    const workaholic = withPersonality(npcs[2]!, {
      extroversion: 0.1, introversion: 0.9, socialNeed: 0.1, generosity: 0.4,
      workTendency: 0.97, responsibility: 0.97, caution: 0.6,
    });
    // Give both the same planned workday so only temperament differentiates them.
    for (const npc of [extrovert, workaholic]) {
      npc.schedule.entries = [{ startHour: 0, endHour: 24, activity: 'work', adherence: 1, locationId: npc.workLocationId }];
      npc.schedule.lastPlannedDay = harness.time().totalDays;
    }
    const socialGroups: ActivityGroup[] = ['social'];
    const counts = {
      extrovert: { social: 0, work: 0, total: 0 },
      workaholic: { social: 0, work: 0, total: 0 },
    };
    for (let trial = 0; trial < 80; trial += 1) {
      for (const [name, npc] of [['extrovert', extrovert], ['workaholic', workaholic]] as const) {
        const outcome = engine.decide(harness.ctx, npc);
        const group = activityGroupOf(outcome.activity);
        if (socialGroups.includes(group)) counts[name].social += 1;
        if (group === 'work') counts[name].work += 1;
        counts[name].total += 1;
      }
    }
    expect(counts.extrovert.total).toBe(80);
    expect(counts.workaholic.total).toBe(80);
    expect(counts.extrovert.social).toBeGreaterThan(counts.workaholic.social);
    expect(counts.workaholic.work).toBeGreaterThan(counts.extrovert.work);
    expect(counts.extrovert.social).toBeGreaterThan(counts.extrovert.work);
    expect(counts.workaholic.work).toBeGreaterThan(counts.workaholic.social);
  });

  it('exposes a complete decision activity catalogue', () => {
    expect(DECISION_ACTIVITIES.length).toBeGreaterThanOrEqual(15);
    const ids = new Set(DECISION_ACTIVITIES.map((definition) => definition.id));
    for (const required of [
      'work', 'go_home', 'sleep', 'eat', 'shop', 'stroll', 'read', 'fish', 'garden',
      'visit_friend', 'go_cafe', 'date', 'attend_event', 'rest', 'personal_errand',
      'look_for_work', 'travel',
    ]) {
      expect(ids.has(required), required).toBe(true);
    }
  });
});
