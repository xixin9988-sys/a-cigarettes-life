// =============================================================================
// PersonalitySystem - maps the 12 personality traits onto behavioural drives
// and utility multipliers used by the NPC decision engine.
// Pure, deterministic and DOM-free.
// =============================================================================
import type { NPCPersonalityValues } from '../core/SharedTypes';
import type { NPCState } from '../core/contracts';
import { clamp } from '../core/utils';
import {
  PERSONALITY_KEYS,
  activityGroupOf,
  getActivityDefinition,
  safeClamp01,
} from './NPC';

export interface PersonalityProfile {
  /** 0..1 desire to be around other people. */
  socialDrive: number;
  /** 0..1 dedication to labour, duty and routine. */
  workDrive: number;
  /** 0..1 pull towards the outdoors, the new and the unknown. */
  exploreDrive: number;
  /** 0..1 pull towards art, music and craft for its own sake. */
  artDrive: number;
  /** 0..1 willingness to spend money on pleasure. */
  spendDrive: number;
  /** 0..1 pull towards home, comfort and privacy. */
  homeDrive: number;
  /** 0..1 appetite for risk and travel. */
  riskDrive: number;
  /** 0..1 need for predictability and safety. */
  cautionDrive: number;
  /** 0..1 generosity towards others. */
  generosity: number;
  /** 0..1 intellectual curiosity. */
  curiosity: number;
  /** 0..1 self-sufficiency. */
  independence: number;
  /** 0..1 sense of duty. */
  responsibility: number;
  /** Raw adventure trait (0..1). */
  adventure: number;
}

const NEUTRAL_PROFILE: PersonalityProfile = {
  socialDrive: 0.5,
  workDrive: 0.5,
  exploreDrive: 0.5,
  artDrive: 0.5,
  spendDrive: 0.5,
  homeDrive: 0.5,
  riskDrive: 0.5,
  cautionDrive: 0.5,
  generosity: 0.5,
  curiosity: 0.5,
  independence: 0.5,
  responsibility: 0.5,
  adventure: 0.5,
};

function trait(personality: NPCPersonalityValues, key: keyof NPCPersonalityValues): number {
  return safeClamp01(personality[key]);
}

/** Normalises a possibly partial/legacy personality object into full 0..1 traits. */
export function normalisePersonality(
  personality: Partial<NPCPersonalityValues> | undefined
): NPCPersonalityValues {
  const result = {} as NPCPersonalityValues;
  for (const key of PERSONALITY_KEYS) {
    const value = personality ? personality[key] : undefined;
    result[key] = safeClamp01(value === undefined ? 0.5 : value);
  }
  return result;
}

export function deriveProfile(personality: NPCPersonalityValues): PersonalityProfile {
  const extroversion = trait(personality, 'extroversion');
  const introversion = trait(personality, 'introversion');
  const adventure = trait(personality, 'adventure');
  const caution = trait(personality, 'caution');
  const generosity = trait(personality, 'generosity');
  const curiosity = trait(personality, 'curiosity');
  const socialNeed = trait(personality, 'socialNeed');
  const independence = trait(personality, 'independence');
  const responsibility = trait(personality, 'responsibility');
  const spendingTendency = trait(personality, 'spendingTendency');
  const artisticTendency = trait(personality, 'artisticTendency');
  const workTendency = trait(personality, 'workTendency');
  return {
    socialDrive: safeClamp01(0.4 * extroversion + 0.4 * socialNeed + 0.2 * (1 - introversion)),
    workDrive: safeClamp01(0.55 * workTendency + 0.45 * responsibility),
    exploreDrive: safeClamp01(0.4 * adventure + 0.35 * curiosity + 0.25 * (1 - caution)),
    artDrive: safeClamp01(0.65 * artisticTendency + 0.35 * curiosity),
    spendDrive: safeClamp01(0.7 * spendingTendency + 0.3 * (1 - caution)),
    homeDrive: safeClamp01(0.4 * introversion + 0.3 * (1 - extroversion) + 0.3 * (1 - adventure)),
    riskDrive: safeClamp01(0.55 * adventure + 0.25 * (1 - caution) + 0.2 * curiosity),
    cautionDrive: caution,
    generosity,
    curiosity,
    independence,
    responsibility,
    adventure,
  };
}

/**
 * Utility multiplier that tilts an activity towards the NPC's temperament.
 * The per-activity coefficients are stored on the activity definition so the
 * mapping is data-driven and easy to audit. Result is clamped to [0.15, 2.6].
 */
export function activityPersonalityMultiplier(
  personality: NPCPersonalityValues,
  activityId: string
): number {
  const definition = getActivityDefinition(activityId);
  if (!definition) return 1;
  let multiplier = 1;
  for (const key of PERSONALITY_KEYS) {
    const coefficient = definition.personality[key];
    if (coefficient === undefined) continue;
    multiplier += (trait(personality, key) - 0.5) * coefficient;
  }
  const profile = deriveProfile(personality);
  switch (activityGroupOf(activityId)) {
    case 'work':
      multiplier *= 0.5 + 1.2 * profile.workDrive;
      break;
    case 'social':
      multiplier *= 0.35 + 1.35 * profile.socialDrive;
      break;
    case 'explore':
      multiplier *= 0.45 + 1.1 * profile.exploreDrive;
      break;
    case 'leisure':
      multiplier *= 0.6 + 0.8 * Math.max(profile.curiosity, profile.artDrive, 0.35);
      break;
    case 'care':
      multiplier *= 0.55 + 0.9 * (0.5 * profile.cautionDrive + 0.5 * (1 - profile.workDrive));
      break;
    case 'home':
      multiplier *= 0.5 + 1.0 * profile.homeDrive;
      break;
    case 'errand':
      multiplier *= 0.6 + 0.8 * profile.responsibility;
      break;
    case 'travel':
      multiplier *= 0.4 + 1.2 * profile.riskDrive;
      break;
    default:
      break;
  }
  // Art-driven personalities enjoy creative leisure/exploration a little more.
  if (profile.artDrive > 0.6 && (definition.interests.includes('art') || definition.interests.includes('music'))) {
    multiplier *= 1 + (profile.artDrive - 0.6) * 0.6;
  }
  return clamp(multiplier, 0.15, 2.6);
}

/** Probability the NPC follows a schedule entry given their responsibility. */
export function scheduleAdherenceChance(
  personality: NPCPersonalityValues,
  baseAdherence: number
): number {
  const responsibility = trait(personality, 'responsibility');
  const workTendency = trait(personality, 'workTendency');
  const discipline = 0.72 + 0.5 * responsibility + 0.18 * workTendency;
  return clamp(baseAdherence * discipline, 0.05, 0.985);
}

/** Trait distance 0..1 between two personalities (0 = identical). */
export function personalityDistance(a: NPCPersonalityValues, b: NPCPersonalityValues): number {
  let total = 0;
  for (const key of PERSONALITY_KEYS) total += Math.abs(trait(a, key) - trait(b, key));
  return total / PERSONALITY_KEYS.length;
}

/** How much two people enjoy each other's company, 0..1. */
export function socialCompatibility(a: NPCPersonalityValues, b: NPCPersonalityValues): number {
  const distance = personalityDistance(a, b);
  const warmth = (trait(a, 'extroversion') + trait(b, 'extroversion')) / 2;
  const generosity = (trait(a, 'generosity') + trait(b, 'generosity')) / 2;
  const caution = (trait(a, 'caution') + trait(b, 'caution')) / 2;
  return safeClamp01(0.3 + 0.4 * (1 - distance) + 0.2 * warmth + 0.15 * generosity - 0.1 * caution);
}

/** Romantic compatibility, 0..1 (biases towards complementary but shared values). */
export function romanceCompatibility(a: NPCPersonalityValues, b: NPCPersonalityValues): number {
  const curiosity = (trait(a, 'curiosity') + trait(b, 'curiosity')) / 2;
  const generosity = (trait(a, 'generosity') + trait(b, 'generosity')) / 2;
  const adventure = (trait(a, 'adventure') + trait(b, 'adventure')) / 2;
  const responsibility = (trait(a, 'responsibility') + trait(b, 'responsibility')) / 2;
  const extroversionGap = Math.abs(trait(a, 'extroversion') - trait(b, 'extroversion'));
  const distance = personalityDistance(a, b);
  return safeClamp01(
    0.3 + 0.25 * (1 - distance) + 0.2 * generosity + 0.15 * curiosity + 0.15 * adventure - 0.15 * extroversionGap + 0.1 * responsibility
  );
}

export interface PersonalityTag {
  id: string;
  label: string;
}

const TAG_DEFINITIONS: readonly { id: string; label: string; test: (profile: PersonalityProfile, traits: NPCPersonalityValues) => boolean }[] = [
  { id: 'outgoing', label: 'Outgoing', test: (p) => p.socialDrive >= 0.68 },
  { id: 'reserved', label: 'Reserved', test: (p) => p.homeDrive >= 0.62 },
  { id: 'hardworking', label: 'Hardworking', test: (p) => p.workDrive >= 0.65 },
  { id: 'curious', label: 'Curious', test: (p) => p.curiosity >= 0.66 },
  { id: 'adventurous', label: 'Adventurous', test: (p) => p.riskDrive >= 0.66 },
  { id: 'cautious', label: 'Cautious', test: (p) => p.cautionDrive >= 0.66 },
  { id: 'generous', label: 'Generous', test: (p) => p.generosity >= 0.66 },
  { id: 'artistic', label: 'Artistic', test: (p) => p.artDrive >= 0.64 },
  { id: 'thrifty', label: 'Thrifty', test: (p) => p.spendDrive <= 0.38 },
  { id: 'free_spirited', label: 'Free-spirited', test: (p) => p.independence >= 0.68 },
  { id: 'dutiful', label: 'Dutiful', test: (p) => p.responsibility >= 0.68 },
  { id: 'homebody', label: 'Homebody', test: (p) => p.homeDrive >= 0.7 },
  { id: 'gregarious', label: 'Gregarious', test: (p, traits) => traits.socialNeed >= 0.7 },
  { id: 'planner', label: 'Planner', test: (p, traits) => traits.caution >= 0.5 && traits.responsibility >= 0.6 },
];

/** Human-readable personality tags for the social UI / dialogue. */
export function describePersonality(personality: NPCPersonalityValues): PersonalityTag[] {
  const profile = deriveProfile(personality);
  const tags: PersonalityTag[] = [];
  for (const definition of TAG_DEFINITIONS) {
    if (definition.test(profile, personality)) tags.push({ id: definition.id, label: definition.label });
    if (tags.length >= 4) break;
  }
  if (tags.length === 0) tags.push({ id: 'easygoing', label: 'Easygoing' });
  return tags;
}

/** Convenience facade used by NPCSystem (keeps subsystems loosely coupled). */
export class PersonalitySystem {
  profile(personality: NPCPersonalityValues): PersonalityProfile {
    return deriveProfile(normalisePersonality(personality));
  }

  profileOf(npc: NPCState): PersonalityProfile {
    return deriveProfile(normalisePersonality(npc.personality));
  }

  activityMultiplier(npc: NPCState, activityId: string): number {
    return activityPersonalityMultiplier(normalisePersonality(npc.personality), activityId);
  }

  adherenceChance(npc: NPCState, baseAdherence: number): number {
    return scheduleAdherenceChance(normalisePersonality(npc.personality), baseAdherence);
  }

  compatibility(a: NPCState, b: NPCState): number {
    return socialCompatibility(
      normalisePersonality(a.personality),
      normalisePersonality(b.personality)
    );
  }

  romanceCompatibility(a: NPCState, b: NPCState): number {
    return romanceCompatibility(
      normalisePersonality(a.personality),
      normalisePersonality(b.personality)
    );
  }

  tags(npc: NPCState): PersonalityTag[] {
    return describePersonality(normalisePersonality(npc.personality));
  }

  neutralProfile(): PersonalityProfile {
    return { ...NEUTRAL_PROFILE };
  }
}
