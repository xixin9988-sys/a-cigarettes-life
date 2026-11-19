// =============================================================================
// NPC content integrity tests: 14 majors + 42 residents, canonical ids, rich
// profiles, 12-trait variation, valid locations, complete schedules and a
// believable initial relationship web.
// =============================================================================
import { describe, expect, it } from 'vitest';
import type { LocationId, NPCPersonalityValues } from '../../src/core/SharedTypes';
import { LOC, ALL_EXTERIOR_LOCATION_IDS, interiorIdFor } from '../../src/data/locations/ids';
import { MAJOR_NPC_IDS, RESIDENT_NPC_IDS } from '../../src/data/npcs/ids';
import {
  INITIAL_COUPLES,
  MAJOR_NPCS_BY_ID,
  NPC_GIFT_TAGS,
  NPCS,
  RESIDENT_NPCS_BY_ID,
} from '../../src/data/npcs/npcs';
import { PERSONALITY_KEYS } from '../../src/npc/NPC';
import { createTestContentPack } from './support/harness';

const VALID_LOCATIONS = new Set<LocationId>([
  ...ALL_EXTERIOR_LOCATION_IDS,
  ...ALL_EXTERIOR_LOCATION_IDS.map((exterior) => interiorIdFor(exterior)),
]);

const HEX = /^#[0-9a-fA-F]{6}$/;

function weekDayCoverage(entries: NPC_Entry[], weekday: number): number {
  const covered = new Array<boolean>(1440).fill(false);
  for (const entry of entries) {
    if (entry.days && entry.days.length > 0 && !entry.days.includes(weekday)) continue;
    const start = Math.max(0, Math.min(1440, Math.round(entry.startHour * 60)));
    let end = Math.min(1440, Math.round(entry.endHour * 60));
    if (end <= start) end = 1440;
    for (let minute = start; minute < end; minute += 1) covered[minute] = true;
  }
  return covered.filter(Boolean).length / 60;
}

type NPC_Entry = (typeof NPCS)[number]['scheduleTemplate'][number];

describe('NPC content data', () => {
  it('contains exactly 14 major NPCs and 42 residents with canonical ids', () => {
    expect(NPCS).toHaveLength(56);
    const majors = NPCS.filter((npc) => npc.major);
    const residents = NPCS.filter((npc) => !npc.major);
    expect(majors).toHaveLength(14);
    expect(residents).toHaveLength(42);
    expect(new Set(NPCS.map((npc) => npc.id)).size).toBe(56);
    expect(new Set(majors.map((npc) => npc.id))).toEqual(new Set(MAJOR_NPC_IDS));
    expect(new Set(residents.map((npc) => npc.id))).toEqual(new Set(RESIDENT_NPC_IDS));
    expect([...MAJOR_NPCS_BY_ID.keys()].sort()).toEqual([...MAJOR_NPC_IDS].sort());
    expect([...RESIDENT_NPCS_BY_ID.keys()].sort()).toEqual([...RESIDENT_NPC_IDS].sort());
  });

  it('gives every NPC a rich, internally consistent profile', () => {
    for (const npc of NPCS) {
      expect(npc.name.length, npc.id).toBeGreaterThan(2);
      expect(npc.bio.length, npc.id).toBeGreaterThan(60);
      expect(npc.occupation.length, npc.id).toBeGreaterThan(2);
      expect(Number.isInteger(npc.startingMoney), npc.id).toBe(true);
      expect(npc.startingMoney, npc.id).toBeGreaterThanOrEqual(0);
      expect(npc.interests.length, npc.id).toBeGreaterThanOrEqual(2);
      expect(new Set(npc.interests).size, npc.id).toBe(npc.interests.length);
      expect(npc.goals.length, npc.id).toBeGreaterThanOrEqual(1);
      expect(npc.likes.length, npc.id).toBeGreaterThanOrEqual(3);
      expect(npc.dislikes.length, npc.id).toBeGreaterThanOrEqual(2);
      expect(npc.likes.some((tag) => npc.dislikes.includes(tag)), npc.id).toBe(false);
      expect(npc.dialogueTreeId).toBe(npc.major ? 'dialogue_' + npc.id : 'dialogue_resident');
      // Appearance is complete and renderable.
      expect(HEX.test(npc.appearance.primaryColor), npc.id).toBe(true);
      expect(HEX.test(npc.appearance.secondaryColor), npc.id).toBe(true);
      expect(HEX.test(npc.appearance.hairColor), npc.id).toBe(true);
      expect(HEX.test(npc.appearance.skinTone), npc.id).toBe(true);
      expect(npc.appearance.scale, npc.id).toBeGreaterThan(0.7);
      expect(npc.appearance.scale, npc.id).toBeLessThan(1.35);
      expect(npc.appearance.accessory.length, npc.id).toBeGreaterThan(0);
      // Life stage matches age.
      const expectedStage =
        npc.age < 13 ? 'child' : npc.age < 18 ? 'teen' : npc.age < 65 ? 'adult' : 'elder';
      expect(npc.lifeStage, npc.id).toBe(expectedStage);
      // Homes and workplaces are canonical, existing locations.
      expect(VALID_LOCATIONS.has(npc.homeLocationId), npc.id).toBe(true);
      expect(VALID_LOCATIONS.has(npc.workLocationId), npc.id).toBe(true);
      expect(npc.homeLocationId).not.toBe(npc.workLocationId);
    }
  });

  it('has all 12 personality traits in range with real population variation', () => {
    for (const npc of NPCS) {
      for (const trait of PERSONALITY_KEYS) {
        const value = npc.personality[trait];
        expect(Number.isFinite(value), npc.id + ':' + trait).toBe(true);
        expect(value, npc.id + ':' + trait).toBeGreaterThanOrEqual(0);
        expect(value, npc.id + ':' + trait).toBeLessThanOrEqual(1);
      }
    }
    for (const trait of PERSONALITY_KEYS) {
      const values = NPCS.map((npc) => npc.personality[trait]);
      const distinct = new Set(values.map((value) => value.toFixed(2)));
      expect(distinct.size, 'variation:' + trait).toBeGreaterThanOrEqual(8);
      const mean = values.reduce((total, value) => total + value, 0) / values.length;
      const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
      expect(Math.sqrt(variance), 'spread:' + trait).toBeGreaterThan(0.08);
      expect(Math.max(...values) - Math.min(...values), 'range:' + trait).toBeGreaterThan(0.3);
    }
    // No two NPCs share an identical personality vector.
    const vectors = new Set(
      NPCS.map((npc) => PERSONALITY_KEYS.map((trait) => npc.personality[trait].toFixed(2)).join('|'))
    );
    expect(vectors.size).toBe(NPCS.length);
    // Extroversion and introversion genuinely oppose each other on average.
    const contrast = NPCS.map((npc: { personality: NPCPersonalityValues }) =>
      npc.personality.extroversion - npc.personality.introversion
    );
    expect(Math.max(...contrast)).toBeGreaterThan(0.4);
    expect(Math.min(...contrast)).toBeLessThan(-0.3);
  });

  it('uses only documented gift-taste tags in likes/dislikes', () => {
    const tags = new Set<string>(NPC_GIFT_TAGS);
    expect(tags.size).toBeGreaterThanOrEqual(20);
    expect(new Set(NPC_GIFT_TAGS).size).toBe(NPC_GIFT_TAGS.length);
    const missing = new Set<string>();
    for (const npc of NPCS) {
      for (const tag of [...npc.likes, ...npc.dislikes]) {
        if (!tags.has(tag)) missing.add(tag);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('gives every NPC a complete, believable daily schedule', () => {
    for (const npc of NPCS) {
      const entries = npc.scheduleTemplate;
      expect(entries.length, npc.id).toBeGreaterThanOrEqual(8);
      for (const entry of entries) {
        expect(entry.startHour, npc.id).toBeGreaterThanOrEqual(0);
        expect(entry.startHour, npc.id).toBeLessThan(24);
        expect(entry.endHour, npc.id).toBeGreaterThan(entry.startHour);
        expect(entry.endHour, npc.id).toBeLessThanOrEqual(24);
        expect(entry.adherence, npc.id).toBeGreaterThanOrEqual(0.3);
        expect(entry.adherence, npc.id).toBeLessThanOrEqual(1);
        expect(entry.activity.length, npc.id).toBeGreaterThan(2);
        if (entry.locationId) expect(VALID_LOCATIONS.has(entry.locationId), npc.id).toBe(true);
        if (entry.days) {
          expect(entry.days.length, npc.id).toBeGreaterThan(0);
          for (const day of entry.days) {
            expect(Number.isInteger(day), npc.id).toBe(true);
            expect(day, npc.id).toBeGreaterThanOrEqual(0);
            expect(day, npc.id).toBeLessThanOrEqual(6);
          }
        }
      }
      const activities = new Set(entries.map((entry) => entry.activity));
      expect(activities.has('sleep'), npc.id).toBe(true);
      expect(
        ['breakfast', 'lunch', 'dinner', 'eat'].some((food) => activities.has(food)),
        npc.id
      ).toBe(true);
      expect(
        ['work', 'garden', 'fish', 'read', 'hobby', 'stroll', 'go_cafe', 'leisure'].some((activity) =>
          activities.has(activity)
        ),
        npc.id
      ).toBe(true);
      // Templates may leave small gaps (filled by ScheduleSystem) but should be
      // mostly complete on every weekday.
      for (let day = 0; day < 7; day += 1) {
        expect(weekDayCoverage(entries, day), npc.id + ':day' + day).toBeGreaterThanOrEqual(15);
      }
      expect(new Set(entries.map((entry) => entry.adherence)).size, npc.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('has a believable initial relationship web among majors and residents', () => {
    const ids = new Set(NPCS.map((npc) => npc.id));
    const pairs = new Set<string>();
    const statuses = new Set<string>();
    let majorsWithRelations = 0;
    let familyCount = 0;
    let rivalCount = 0;
    for (const npc of NPCS) {
      if (npc.major && npc.initialRelationships.length > 0) majorsWithRelations += 1;
      for (const seed of npc.initialRelationships) {
        expect(seed.npcId, npc.id).not.toBe(npc.id);
        expect(ids.has(seed.npcId), npc.id + '->' + seed.npcId).toBe(true);
        const key = [npc.id, seed.npcId].sort().join('|');
        expect(pairs.has(key), 'duplicate pair ' + key).toBe(false);
        pairs.add(key);
        expect(seed.affinity).toBeGreaterThanOrEqual(-100);
        expect(seed.affinity).toBeLessThanOrEqual(100);
        expect(seed.trust).toBeGreaterThanOrEqual(0);
        expect(seed.intimacy).toBeGreaterThanOrEqual(0);
        if (seed.status) {
          statuses.add(seed.status);
          if (seed.status === 'family') familyCount += 1;
          if (seed.status === 'rival') rivalCount += 1;
        }
      }
    }
    expect(majorsWithRelations).toBe(14);
    expect(familyCount).toBeGreaterThanOrEqual(2);
    expect(rivalCount).toBeGreaterThanOrEqual(1);
    expect(statuses.has('friend') || statuses.has('close_friend')).toBe(true);
    // Declared couples exist and reference real NPCs.
    expect(INITIAL_COUPLES.length).toBeGreaterThanOrEqual(1);
    for (const couple of INITIAL_COUPLES) {
      expect(ids.has(couple.a)).toBe(true);
      expect(ids.has(couple.b)).toBe(true);
      expect(couple.a).not.toBe(couple.b);
      expect(couple.description.length).toBeGreaterThan(20);
    }
  });

  it('marks romanceable flags believably across the population', () => {
    const majors = NPCS.filter((npc) => npc.major);
    const residents = NPCS.filter((npc) => !npc.major);
    const romanceableMajors = majors.filter((npc) => npc.romanceable);
    expect(romanceableMajors.length).toBeGreaterThanOrEqual(4);
    expect(romanceableMajors.length).toBeLessThan(majors.length);
    expect(residents.filter((npc) => npc.romanceable).length).toBeGreaterThanOrEqual(6);
    for (const npc of NPCS) {
      if (npc.lifeStage === 'child' || npc.lifeStage === 'teen' || npc.lifeStage === 'elder') {
        expect(npc.romanceable, npc.id).toBe(false);
      }
    }
    for (const couple of INITIAL_COUPLES) {
      const first = NPCS.find((npc) => npc.id === couple.a);
      const second = NPCS.find((npc) => npc.id === couple.b);
      expect(first?.romanceable, 'seeded couple ' + couple.a).toBe(false);
      expect(second?.romanceable, 'seeded couple ' + couple.b).toBe(false);
    }
  });

  it('builds a valid ContentPack/ContentRegistry and creates NPC states', () => {
    const pack = createTestContentPack();
    expect(pack.npcs).toHaveLength(56);
    // Fully resolvable references: no missing home/work/dialogue references.
    const locationIds = new Set(pack.locations.map((location) => location.id));
    const treeIds = new Set(pack.dialogueTrees.map((tree) => tree.id));
    for (const npc of pack.npcs) {
      expect(locationIds.has(npc.homeLocationId), npc.id).toBe(true);
      expect(locationIds.has(npc.workLocationId), npc.id).toBe(true);
      expect(treeIds.has(npc.dialogueTreeId), npc.id).toBe(true);
    }
  });

  it('keeps the canonical location constant set populated', () => {
    expect(ALL_EXTERIOR_LOCATION_IDS).toHaveLength(45);
    expect(LOC.cafe).toBe('willowbrook_cafe');
    expect(LOC.museum).toBe('ashford_museum');
    expect(ALL_EXTERIOR_LOCATION_IDS.includes(LOC.market)).toBe(true);
  });
});
