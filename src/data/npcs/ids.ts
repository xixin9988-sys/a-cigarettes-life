import type { NPCId } from '../../core/SharedTypes';

/** Canonical major NPC ids (Agent 0). Residents are resident_01 .. resident_42. */
export const NPC = {
  marigoldLyle: 'npc_marigold_lyle',
  ottoBramwell: 'npc_otto_bramwell',
  sylviaReed: 'npc_sylvia_reed',
  haroldBagg: 'npc_harold_bagg',
  elizaThorne: 'npc_eliza_thorne',
  theoGrey: 'npc_theo_grey',
  claraBright: 'npc_clara_bright',
  finnHolloway: 'npc_finn_holloway',
  adaQuinn: 'npc_ada_quinn',
  rufusMarsh: 'npc_rufus_marsh',
  penelopeVance: 'npc_penelope_vance',
  jasperKim: 'npc_jasper_kim',
  edmundHale: 'npc_edmund_hale',
  ninaOkoye: 'npc_nina_okoye',
} as const;

export const MAJOR_NPC_IDS: readonly NPCId[] = Object.values(NPC);

export const RESIDENT_NPC_IDS: readonly NPCId[] = Array.from({ length: 42 }, (_, index) => {
  return 'resident_' + String(index + 1).padStart(2, '0');
});

export const ALL_NPC_IDS: readonly NPCId[] = [...MAJOR_NPC_IDS, ...RESIDENT_NPC_IDS];

export function isMajorNpcId(npcId: NPCId): boolean {
  return MAJOR_NPC_IDS.includes(npcId);
}
