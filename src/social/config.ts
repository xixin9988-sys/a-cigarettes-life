import { WORLD_CONFIG } from '../core/WorldConfig';

/**
 * Balance constants for the player-facing social domain (chat, gifting, help,
 * invitations, romance and community projects).
 *
 * Values that already exist in WORLD_CONFIG.social are reused so the whole game
 * tunes from one place; domain-local numbers are documented here.
 */
export const SOCIAL_CONFIG = {
  // --- Cooldowns (game hours) ---
  talkCooldownHours: WORLD_CONFIG.social.chatCooldownGameHours,
  giftCooldownHours: WORLD_CONFIG.social.giftCooldownGameHours,
  helpCooldownHours: 8,
  inviteCooldownHours: WORLD_CONFIG.social.inviteCooldownGameHours,
  confessCooldownHours: 48,
  /** Cooldown after a failed confession (the NPC needs time to think it over). */
  confessRejectedCooldownHours: 72,
  dateCooldownHours: 20,
  apologiseCooldownHours: 12,
  /** Cooldown before a declined invitation can be repeated. */
  inviteDeclinedCooldownHours: 8,
  /** Cooldown after a breakup before the NPC will hear another confession. */
  breakupCooldownHours: 24 * 7,

  // --- Relationship gates ---
  /** Minimum trust before a confession is even attempted. */
  confessTrustThreshold: 35,
  /** Minimum intimacy before a confession is even attempted. */
  confessIntimacyThreshold: 20,
  /** Minimum affinity (absolute) before a real apology is accepted. */
  apologiseAffinityThreshold: -5,

  // --- Gains ---
  giftBaseGain: WORLD_CONFIG.social.giftBaseGain,
  helpBaseGain: WORLD_CONFIG.social.helpBaseGain,
  /** Extra affinity for each matching taste tag on a gift. */
  giftLikedTagBonus: 3.5,
  /** Affinity lost when gifting something the NPC dislikes. */
  giftDislikedPenalty: 5,
  /** Extra affinity per quality star above 1. */
  giftQualityBonusPerStar: 1.2,
  /** One-off affinity for gifting a "gift" category item (wrapped present). */
  giftWrappedBonus: 1.5,
  /** Affinity gain depends on how far affinity already is from 100. */
  talkDiminishingFloor: 0.35,
  talkDiminishingDivisor: 140,
  helpRepayBaseChance: 0.32,
  apologiseBaseChance: 0.35,

  // --- Dates & romance ---
  dateCostPence: 800,
  dateAffinityGain: 7,
  dateTrustGain: 2,
  dateIntimacyGain: 6,
  /** Intimacy needed before a date can promote dating -> partner. */
  partnerIntimacyThreshold: 70,
  partnerChancePerDate: 0.4,
  /** Affinity below which a dating/partner relationship breaks up. */
  breakupAffinityThreshold: -10,
  /** Days of complete neglect before romance affinity starts to decay. */
  breakupNeglectDays: 6,
  neglectAffinityPerDay: 0.8,
  /** How often (game hours) romance drift is evaluated per relationship. */
  romanceCheckIntervalHours: 6,
  /** Extra patience from personality: partner waiting days = base + generosity*4 + responsibility*2. */
  patienceGenerosityDays: 4,
  patienceResponsibilityDays: 2,
  /** Chance the NPC is willing to be taken on a date even while dating. */
  dateWillingBaseChance: 0.55,

  // --- Invitations ---
  /** Pending invitations expire after this many game hours. */
  invitationExpiryHours: 24,
  maxPendingInvitations: 3,
  maxStoredInvitations: 60,
  npcInviteTickHours: 2,
  maxNpcInviteTicksPerUpdate: 24,
  npcInviteBaseChancePerTick: 0.05,
  /** Accepted invitation still requires the two people to be in the same place. */
  invitationRelationshipAffinity: 2.5,
  invitationRelationshipTrust: 1.5,
  invitationRelationshipIntimacy: 1,
  declineAffinityPenalty: 2.5,

  // --- Community projects ---
  community: {
    /** Hours residents spend discussing before a vote resolves. */
    votingHours: 24,
    /** Hours between vote batches. */
    voteWindowHours: 2,
    /** Votes cast per window while voting. */
    votesPerWindow: 2,
    /** Votes are capped at requiredSupport * this multiplier. */
    maxVoteMultiplier: 3,
    /** Minutes of construction per constructionHour (sim seconds per game hour). */
    completionInfluenceGain: 5,
    completionCommunityPoints: 8,
    completionLocationConditionBonus: 0.2,
    /** Extra influence per point of required support. */
    completionInfluencePerSupport: 0.4,
  },

  // --- Bookkeeping ---
  maxInteractionLog: 150,
  /** Keep at most this many social memories per NPC (permanent ones always kept). */
  maxMemoriesPerNpc: 60,
  maxDialogueDepth: 24,
  /** Stale conversation is dropped after this many game hours. */
  conversationTimeoutHours: 3,
  /** Once-only dialogue choices are remembered via flags with this prefix. */
  dialogueOnceFlagPrefix: 'dlg_once:',

  // --- Social skill XP awards ---
  socialXp: {
    talk: 3,
    gift: 5,
    help: 6,
    invite: 3,
    confess: 8,
    date: 8,
    apologise: 4,
    dialogueStart: 2,
    dialogueChoice: 1,
    invitationAccepted: 4,
  },
} as const;

export type SocialConfig = typeof SOCIAL_CONFIG;

/** Sim seconds per in-game hour (1 sim second = 1 in-game minute). */
export const SIM_SECONDS_PER_HOUR = 60;
/** Sim seconds per in-game day. */
export const SIM_SECONDS_PER_DAY = SIM_SECONDS_PER_HOUR * 24;

/** Converts game hours to simulated seconds. */
export function gameHoursToSimSeconds(hours: number): number {
  return hours * SIM_SECONDS_PER_HOUR;
}

/** Convenience: the simulated-second length of a cooldown in game hours. */
export function cooldownSeconds(hours: number): number {
  return gameHoursToSimSeconds(hours);
}
