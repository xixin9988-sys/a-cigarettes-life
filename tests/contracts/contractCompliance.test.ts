import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_PACK } from '../../src/data';
import { ContentRegistry } from '../../src/core/ContentRegistry';
import { createInitialGameState, DEFAULT_APPEARANCE } from '../../src/core/WorldFactory';
import { SimulationRuntime } from '../../src/simulation/SimulationRuntime';
import { ALL_NPC_IDS, MAJOR_NPC_IDS, NPC } from '../../src/data/npcs/ids';
import {
  ALL_EXTERIOR_LOCATION_IDS,
  ASHFORD_EXTERIORS,
  LOC,
  WILLOWBROOK_EXTERIORS,
  interiorIdFor,
} from '../../src/data/locations/ids';
import { ALL_BUSINESS_IDS } from '../../src/data/shops/ids';
import { ALL_FESTIVAL_IDS } from '../../src/data/events/festivalIds';
import { ALL_ITEM_IDS, ITEM } from '../../src/data/items/ids';
import { SEASONS } from '../../src/core/SharedTypes';

const content = new ContentRegistry(CONTENT_PACK);

function walkFiles(root: string, extensions: string[]): string[] {
  const output: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) visit(full);
      else if (extensions.some((extension) => full.endsWith(extension))) output.push(full);
    }
  };
  visit(root);
  return output;
}

describe('content pack completeness', () => {
  it('has zero validation errors (references and unique ids)', () => {
    expect(content.validate()).toEqual([]);
  });

  it('contains a complete world map with 45 exteriors, interiors and secrets', () => {
    const exteriors = CONTENT_PACK.locations.filter((location) => !location.indoor);
    expect(exteriors).toHaveLength(45);
    expect(WILLOWBROOK_EXTERIORS).toHaveLength(25);
    expect(ASHFORD_EXTERIORS).toHaveLength(20);
    const enterableKinds = new Set([
      'cafe', 'bakery', 'flower_shop', 'grocery', 'bookshop', 'post_office', 'library', 'market',
      'train_station', 'warehouse', 'abandoned_farmhouse', 'hidden_garden', 'shopping_mall',
      'supermarket', 'convenience_store', 'clothing_shop', 'furniture_shop', 'electronics_shop',
      'restaurant', 'city_cafe', 'museum', 'city_library', 'cinema', 'apartments',
      'cultural_center', 'city_residential', 'office_district', 'event_square', 'residence',
    ]);
    for (const exteriorId of ALL_EXTERIOR_LOCATION_IDS) {
      const exterior = content.getLocation(exteriorId);
      expect(exterior, 'missing exterior ' + exteriorId).toBeDefined();
      if (!exterior) continue;
      const needsInterior = enterableKinds.has(exterior.kind) || exterior.businessId !== undefined;
      if (needsInterior) {
        expect(content.getLocation(interiorIdFor(exteriorId)), 'missing interior for ' + exteriorId).toBeDefined();
      }
    }
    const interiors = CONTENT_PACK.locations.filter((location) => location.indoor);
    expect(interiors.length).toBeGreaterThanOrEqual(20);
    for (const interior of interiors) {
      expect(interior.entranceFrom, 'interior without entrance: ' + interior.id).toBeDefined();
      if (interior.entranceFrom) {
        expect(content.getLocation(interior.entranceFrom), 'interior entrance missing: ' + interior.id).toBeDefined();
      }
    }
    const secretLocations = CONTENT_PACK.locations.filter((location) => location.secret);
    expect(secretLocations.length).toBeGreaterThanOrEqual(4);
  });

  it('has 14 majors, 42 residents and full NPC profiles', () => {
    expect(MAJOR_NPC_IDS).toHaveLength(14);
    expect(ALL_NPC_IDS).toHaveLength(56);
    for (const npcId of ALL_NPC_IDS) {
      const def = content.getNPC(npcId);
      expect(def, 'missing NPC ' + npcId).toBeDefined();
      if (!def) continue;
      expect(def.name.length).toBeGreaterThan(2);
      expect(def.homeLocationId).toBeDefined();
      expect(def.workLocationId).toBeDefined();
      expect(def.scheduleTemplate.length).toBeGreaterThan(0);
      expect(content.getDialogueTree(def.dialogueTreeId), 'missing dialogue for ' + def.id).toBeDefined();
    }
  });

  it('has rich item, crop, fish, recipe, event and business data', () => {
    expect(content.getAllItems().length).toBeGreaterThanOrEqual(170);
    expect(CONTENT_PACK.crops.length).toBeGreaterThanOrEqual(19);
    expect(CONTENT_PACK.fish.length).toBeGreaterThanOrEqual(16);
    expect(CONTENT_PACK.forageNodes.length).toBeGreaterThanOrEqual(20);
    expect(CONTENT_PACK.recipes.length).toBeGreaterThanOrEqual(50);
    expect(CONTENT_PACK.events.length).toBeGreaterThanOrEqual(30);
    expect(CONTENT_PACK.festivals).toHaveLength(ALL_FESTIVAL_IDS.length);
    expect(CONTENT_PACK.businesses).toHaveLength(ALL_BUSINESS_IDS.length);
    expect(CONTENT_PACK.furniture.length).toBeGreaterThanOrEqual(20);
    expect(CONTENT_PACK.blueprints.length).toBeGreaterThanOrEqual(10);
    expect(CONTENT_PACK.achievements.length).toBeGreaterThanOrEqual(20);
    expect(CONTENT_PACK.playerGoals.length).toBeGreaterThanOrEqual(12);
    expect(CONTENT_PACK.dialogueTrees.length).toBeGreaterThanOrEqual(15);
    // Every canonical item id must have a definition.
    const missing = ALL_ITEM_IDS.filter((itemId) => !content.getItem(itemId));
    expect(missing, 'items without ItemDef: ' + missing.join(', ')).toEqual([]);
  });

  it('has complete weather transitions and train routes', () => {
    for (const season of SEASONS) {
      const row = CONTENT_PACK.weatherTable.bySeason[season];
      expect(row, 'missing weather season ' + season).toBeDefined();
      const weatherTypes = Object.keys(row ?? {});
      expect(weatherTypes.length).toBeGreaterThanOrEqual(5);
    }
    expect(CONTENT_PACK.trainRoutes.length).toBeGreaterThanOrEqual(4);
    for (const route of CONTENT_PACK.trainRoutes) {
      expect(content.getLocation(route.fromLocationId)).toBeDefined();
      expect(content.getLocation(route.toLocationId)).toBeDefined();
      expect(route.departHours.length).toBeGreaterThan(0);
      expect(route.pricePence).toBeGreaterThan(0);
    }
  });

  it('every business is at a real location and stocks real items', () => {
    for (const business of CONTENT_PACK.businesses) {
      expect(content.getLocation(business.locationId), business.id).toBeDefined();
      expect(business.stock.length).toBeGreaterThan(0);
      for (const stock of business.stock) {
        expect(content.getItem(stock.itemId), business.id + ' -> ' + stock.itemId).toBeDefined();
      }
      if (business.ownerNpcId) expect(content.getNPC(business.ownerNpcId)).toBeDefined();
    }
  });

  it('every festival is at a real location and references known ids', () => {
    for (const festival of CONTENT_PACK.festivals) {
      expect(content.getLocation(festival.locationId), festival.id).toBeDefined();
      expect(festival.activities.length).toBeGreaterThan(0);
    }
  });
});

describe('system contract compliance', () => {
  it('instantiates every registered system with an id and lifecycle methods', () => {
    const state = createInitialGameState({
      seed: 999,
      playerName: 'Contract',
      appearance: DEFAULT_APPEARANCE,
      content,
    });
    const runtime = new SimulationRuntime({ state, content });
    const expectedIds = [
      'world',
      'npc',
      'economy',
      'skill',
      'farming',
      'foraging',
      'fishing',
      'exploration',
      'crafting',
      'cooking',
      'building',
      'housing',
      'collection',
      'social',
      'dialogue',
      'events',
      'life',
    ];
    const registered = runtime.registry.all().map((system) => system.id);
    for (const id of expectedIds) {
      expect(registered, 'system ' + id + ' missing').toContain(id);
      const system = runtime.registry.get(id);
      expect(system).toBeDefined();
      expect(typeof system?.init).toBe('function');
      expect(typeof system?.update).toBe('function');
    }
    // Initial population / world state is fully materialised.
    expect(Object.keys(state.npcs)).toHaveLength(56);
    expect(Object.keys(state.world.locations).length).toBeGreaterThanOrEqual(70);
    expect(Object.keys(state.economy.businesses)).toHaveLength(ALL_BUSINESS_IDS.length);
    runtime.dispose();
  });

  it('has a valid core item for each profession/tool requirement', () => {
    const requiredIds = [
      ITEM.hoe,
      ITEM.wateringCan,
      ITEM.fishingRodBasic,
      ITEM.camera,
      ITEM.matches,
      ITEM.cigaretteAsh,
      ITEM.greenhouseKit,
      ITEM.bedSimple,
    ];
    for (const itemId of requiredIds) expect(content.getItem(itemId), itemId).toBeDefined();
  });

  it('has no Math.random usage anywhere in src/', () => {
    const files = walkFiles(join(process.cwd(), 'src'), ['.ts']);
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const offenders = files.filter((file) => /Math\.random\s*\(/.test(stripComments(readFileSync(file, 'utf8'))));
    expect(offenders).toEqual([]);
  });

  it('exposes the documented probability streams after a few updates', () => {
    const state = createInitialGameState({
      seed: 4242,
      playerName: 'Streams',
      appearance: DEFAULT_APPEARANCE,
      content,
    });
    const runtime = new SimulationRuntime({ state, content });
    for (let index = 0; index < 20; index += 1) runtime.advance(60);
    const streams = runtime.probability.listStreams();
    expect(streams.length).toBeGreaterThan(0);
    runtime.dispose();
  });
});