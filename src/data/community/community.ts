import type { CommunityProposalDef } from '../schema';
import { LOC } from '../locations/ids';

/**
 * OWNER: Agent 10 (Social & Relationship).
 *
 * Community proposals the player can fund and push through a resident vote
 * (see src/social/CommunitySystem.ts). Costs are integer pence; support is the
 * number of resident votes needed; constructionHours is in-game hours.
 */
export const COMMUNITY_PROPOSALS: CommunityProposalDef[] = [
  {
    id: 'proposal_public_garden',
    title: 'Public Garden',
    description:
      'Turn the overgrown corner of the park into a walled garden with lavender beds, a sundial and benches that face the afternoon sun.',
    locationId: LOC.park,
    costPence: 18000,
    influenceRequired: 10,
    supportRequired: 5,
    constructionHours: 16,
    effects: [
      'A quiet walled garden opens in the park.',
      'Lavender and roses bloom there in spring and summer.',
      'Residents linger longer in the park on clear days.',
    ],
    tags: ['greenery', 'leisure', 'beauty'],
  },
  {
    id: 'proposal_playground',
    title: 'Children\'s Playground',
    description:
      'A safe place for the village children: a wooden climbing frame, a sandpit and a low fence so parents can rest easy.',
    locationId: LOC.plaza,
    costPence: 24000,
    influenceRequired: 15,
    supportRequired: 6,
    constructionHours: 20,
    effects: [
      'A playground fills the quiet end of the plaza.',
      'Families spend their afternoons in the square.',
      'The plaza becomes livelier on sunny days.',
    ],
    tags: ['children', 'family', 'safety'],
  },
  {
    id: 'proposal_market_awning',
    title: 'Market Awning',
    description:
      'A long canvas awning over the market stalls so that trading does not stop the moment the sky turns.',
    locationId: LOC.market,
    costPence: 12000,
    influenceRequired: 6,
    supportRequired: 4,
    constructionHours: 10,
    effects: [
      'The market stays open through light rain.',
      'Stallholders sell more on wet days.',
      'The market square feels busier whatever the weather.',
    ],
    tags: ['commerce', 'shelter', 'market'],
  },
  {
    id: 'proposal_library_extension',
    title: 'Library Reading Room',
    description:
      'A glass-roofed reading room added to the library, with long tables, a local history shelf and a kettle that is always warm.',
    locationId: LOC.library,
    costPence: 40000,
    influenceRequired: 25,
    supportRequired: 7,
    constructionHours: 36,
    effects: [
      'The library gains a bright reading room.',
      'Students and researchers stay longer and study deeper.',
      'The library becomes the heart of the village in winter.',
    ],
    tags: ['education', 'culture', 'history'],
  },
  {
    id: 'proposal_bridge_repair',
    title: 'Stone Bridge Repair',
    description:
      'Rebuild the cracked footbridge over the river so the west bank path is passable even after a storm.',
    locationId: LOC.river,
    costPence: 22000,
    influenceRequired: 12,
    supportRequired: 5,
    constructionHours: 24,
    effects: [
      'The footbridge is safe to cross in all weathers.',
      'The riverside path becomes a favourite walking route.',
      'Wet-season travel across the west bank is no longer risky.',
    ],
    tags: ['infrastructure', 'safety', 'transport'],
  },
  {
    id: 'proposal_festival_stage',
    title: 'Festival Stage',
    description:
      'A permanent timber stage on the event square with a proper soundboard and dressing rooms behind a painted screen.',
    locationId: LOC.eventSquare,
    costPence: 30000,
    influenceRequired: 18,
    supportRequired: 6,
    constructionHours: 28,
    effects: [
      'Musicians and performers have a stage of their own.',
      'Festivals in the square become more ambitious.',
      'Jasper could play somewhere that deserves him.',
    ],
    tags: ['festival', 'music', 'culture'],
  },
  {
    id: 'proposal_tree_planting',
    title: 'Countryside Tree Planting',
    description:
      'Plant a line of oak and birch saplings along the lane, with wire guards and a small plaque naming the year.',
    locationId: LOC.countryside,
    costPence: 8000,
    influenceRequired: 4,
    supportRequired: 3,
    constructionHours: 8,
    effects: [
      'A new line of saplings follows the country lane.',
      'Shelter for birds and shade for walkers in summers to come.',
      'The village leaves something behind for the next generation.',
    ],
    tags: ['greenery', 'environment', 'legacy'],
  },
  {
    id: 'proposal_street_lamps',
    title: 'Street Lamps',
    description:
      'Iron lamps along the path through the village centre, lit by the shopkeeper\'s promise to keep the wicks trimmed.',
    locationId: LOC.center,
    costPence: 15000,
    influenceRequired: 8,
    supportRequired: 5,
    constructionHours: 14,
    effects: [
      'The village centre is safe to cross after dark.',
      'Late evening footfall rises around the shops.',
      'Returning home at night becomes a little warmer.',
    ],
    tags: ['infrastructure', 'safety', 'night'],
  },
];

/** Lookup map for UI/debug (proposal id -> definition). */
export const COMMUNITY_PROPOSALS_BY_ID: ReadonlyMap<string, CommunityProposalDef> = new Map(
  COMMUNITY_PROPOSALS.map((proposal) => [proposal.id, proposal])
);
