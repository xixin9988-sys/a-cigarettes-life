// =============================================================================
// Panel registry: metadata + controller factory for every DOM panel.
// =============================================================================
import type { GameState } from '../core/contracts';
import type { PanelId } from './UIInterfaces';
import type { PanelController, UiContext } from './widgets';
import { InventoryPanel } from './InventoryUI';
import { MapPanel } from './MapUI';
import { SocialPanel } from './SocialUI';
import { DialoguePanel } from './DialogueUI';
import { ShopPanel } from './ShopUI';
import { BuildingPanel } from './BuildingUI';
import { HousingPanel } from './HousingUI';
import { FishingPanel } from './FishingMiniGameUI';
import { SkillPanel } from './SkillUI';
import { EventPanel } from './EventUI';
import { JournalPanel } from './JournalUI';
import { CollectionPanel } from './CollectionUI';
import { LifePanel } from './LifePanel';
import { LifeArchivePanel } from './LifeArchiveUI';
import { SettingsPanel } from './SettingsUI';
import { HelpPanel } from './HelpUI';
import { ProbabilityDebugPanel } from './ProbabilityDebugUI';

export type PanelSize = 'normal' | 'narrow' | 'wide' | 'full' | 'left' | 'dialogue';

export interface PanelDefinition {
  id: PanelId;
  title: string;
  subtitle: string;
  icon: string;
  size: PanelSize;
  create(ctx: UiContext, state: Readonly<GameState>): PanelController;
}

const DEFINITIONS: Record<Exclude<PanelId, 'hud'>, PanelDefinition> = {
  inventory: {
    id: 'inventory',
    title: 'Inventory',
    subtitle: 'items · protection · crafting · cooking',
    icon: '🎒',
    size: 'wide',
    create: (ctx, state) => new InventoryPanel(ctx, state),
  },
  map: {
    id: 'map',
    title: 'Map & travel',
    subtitle: 'two regions · secrets · trains · around you',
    icon: '🗺',
    size: 'full',
    create: (ctx, state) => new MapPanel(ctx, state),
  },
  social: {
    id: 'social',
    title: 'Social',
    subtitle: 'relationships · memories · invitations · community',
    icon: '👥',
    size: 'normal',
    create: (ctx, state) => new SocialPanel(ctx, state),
  },
  skills: {
    id: 'skills',
    title: 'Skills & goals',
    subtitle: 'eight skills · personal goals · achievements',
    icon: '📊',
    size: 'normal',
    create: (ctx, state) => new SkillPanel(ctx, state),
  },
  journal: {
    id: 'journal',
    title: 'Journal',
    subtitle: 'world history · this life · letters · offline',
    icon: '📜',
    size: 'normal',
    create: (ctx, state) => new JournalPanel(ctx, state),
  },
  events: {
    id: 'events',
    title: 'Events & festivals',
    subtitle: 'what is happening · recent log · festival year',
    icon: '🎪',
    size: 'normal',
    create: (ctx, state) => new EventPanel(ctx, state),
  },
  shop: {
    id: 'shop',
    title: 'Shop & work',
    subtitle: 'buy · sell · business · jobs',
    icon: '🏪',
    size: 'wide',
    create: (ctx, state) => new ShopPanel(ctx, state),
  },
  building: {
    id: 'building',
    title: 'Building',
    subtitle: 'blueprints · materials · active projects',
    icon: '🏗',
    size: 'normal',
    create: (ctx, state) => new BuildingPanel(ctx, state),
  },
  housing: {
    id: 'housing',
    title: 'Home & housing',
    subtitle: 'rooms · grid placement · paint · storage',
    icon: '🏠',
    size: 'full',
    create: (ctx, state) => new HousingPanel(ctx, state),
  },
  collection: {
    id: 'collection',
    title: 'Collection',
    subtitle: 'museum progress · catalogue · donations',
    icon: '🏛',
    size: 'normal',
    create: (ctx, state) => new CollectionPanel(ctx, state),
  },
  archive: {
    id: 'archive',
    title: 'Life archive',
    subtitle: 'this life · past lives · photographs',
    icon: '📚',
    size: 'wide',
    create: (ctx, state) => new LifeArchivePanel(ctx, state),
  },
  settings: {
    id: 'settings',
    title: 'Settings',
    subtitle: 'simulation · audio · controls · saves · data',
    icon: '⚙',
    size: 'normal',
    create: (ctx, state) => new SettingsPanel(ctx, state),
  },
  life: {
    id: 'life',
    title: 'Life',
    subtitle: 'your cigarette body · influence · statistics',
    icon: '🚬',
    size: 'normal',
    create: (ctx, state) => new LifePanel(ctx, state),
  },
  dialogue: {
    id: 'dialogue',
    title: 'Conversation',
    subtitle: '',
    icon: '💬',
    size: 'dialogue',
    create: (ctx, state) => new DialoguePanel(ctx, state),
  },
  fishing: {
    id: 'fishing',
    title: 'Fishing',
    subtitle: 'tension · progress · hold to reel',
    icon: '🎣',
    size: 'left',
    create: (ctx, state) => new FishingPanel(ctx, state),
  },
  probability: {
    id: 'probability',
    title: 'Probability debugger',
    subtitle: 'F12 · seed · streams · decisions · weights',
    icon: '🎲',
    size: 'full',
    create: (ctx, state) => new ProbabilityDebugPanel(ctx, state),
  },
  help: {
    id: 'help',
    title: 'Help',
    subtitle: 'controls · panels · survival rules',
    icon: '❓',
    size: 'normal',
    create: (ctx, state) => new HelpPanel(ctx, state),
  },
};

export function getPanelDefinition(id: PanelId): PanelDefinition | null {
  if (id === 'hud') return null;
  return DEFINITIONS[id] ?? null;
}

export function panelSizeClass(size: PanelSize): string {
  switch (size) {
    case 'wide':
      return 'ui-panel-wide';
    case 'full':
      return 'ui-panel-full';
    case 'narrow':
      return 'ui-panel-narrow';
    case 'left':
      return 'ui-panel ui-panel-left';
    default:
      return '';
  }
}
