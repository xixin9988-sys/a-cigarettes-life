import { beforeEach, describe, expect, it } from 'vitest';
import type { GameEventMap } from '../../src/core/contracts';
import type { NatureHarness } from './helpers/natureHarness';
import {
  advanceOneBigStep,
  advanceSim,
  createNatureHarness,
  giveItem,
  itemCount,
  recordEvents,
  setGameTime,
  teleport,
} from './helpers/natureHarness';
import { ITEM } from '../../src/data/items/ids';
import { LOC } from '../../src/data/locations/ids';

const HOUR = 60; // 1 game hour = 60 sim seconds (1 sim second = 1 game minute)

function makeFarmHarness(seed: number): NatureHarness {
  const h = createNatureHarness({ seed });
  teleport(h, LOC.farm);
  giveItem(h, ITEM.hoe, 1);
  giveItem(h, ITEM.wateringCan, 1);
  setGameTime(h, { seasonIndex: 0, dayOfSeason: 5, hour: 9, temperature: 16 });
  return h;
}

function tillAndPlant(h: NatureHarness, x: number, y: number, seedItemId: string): string {
  const till = h.farming.tillPlot(LOC.farm, x, y);
  expect(till.ok, till.message).toBe(true);
  const plotId = (till.data as { plotId: string }).plotId;
  const plant = h.farming.plantSeed(plotId, seedItemId);
  expect(plant.ok, plant.message).toBe(true);
  return plotId;
}

function growUntilMature(h: NatureHarness, plotId: string, maxChunks = 30): void {
  for (let chunk = 0; chunk < maxChunks; chunk += 1) {
    const plot = h.farming.getPlot(plotId);
    if (!plot || plot.stage !== 'planted') return;
    expect(h.farming.waterPlot(plotId).ok).toBe(true);
    advanceSim(h, 4 * HOUR, 900);
  }
}

function runTurnipHarvest(seed: number): { quality: number; quantity: number; matureStage: string } {
  const h = makeFarmHarness(seed);
  giveItem(h, ITEM.turnipSeed, 6);
  const plotId = tillAndPlant(h, 0, 0, ITEM.turnipSeed);
  growUntilMature(h, plotId);
  const plot = h.farming.getPlot(plotId);
  expect(plot).toBeDefined();
  const matureStage = plot?.stage ?? '';
  expect(matureStage).toBe('mature');
  const harvest = h.farming.harvestPlot(plotId);
  expect(harvest.ok, harvest.message).toBe(true);
  const data = harvest.data as { quality: number; quantity: number };
  return { quality: data.quality, quantity: data.quantity, matureStage };
}

describe('FarmingSystem lifecycle', () => {
  it('tills, plants, waters, grows and harvests a turnip crop', () => {
    const h = makeFarmHarness(777);
    giveItem(h, ITEM.turnipSeed, 5);
    const seedsBefore = itemCount(h, ITEM.turnipSeed);
    const events = recordEvents(h, ['crop:harvested', 'item:acquired']);
    const plotId = tillAndPlant(h, 0, 0, ITEM.turnipSeed);
    expect(itemCount(h, ITEM.turnipSeed)).toBe(seedsBefore - 1);
    const planted = h.farming.getPlot(plotId);
    expect(planted?.stage).toBe('planted');
    expect(planted?.cropId).toBe('turnip');
    expect(h.farming.waterPlot(plotId).ok).toBe(true);
    expect(h.farming.getPlot(plotId)?.moisture).toBeGreaterThan(0.9);
    growUntilMature(h, plotId);
    const mature = h.farming.getPlot(plotId);
    expect(mature?.stage).toBe('mature');
    expect(mature?.growthStage).toBe(3);
    const turnipsBefore = itemCount(h, ITEM.turnip);
    const harvest = h.farming.harvestPlot(plotId);
    expect(harvest.ok, harvest.message).toBe(true);
    const data = harvest.data as { quality: number; quantity: number };
    expect(data.quantity).toBeGreaterThanOrEqual(1);
    expect(data.quality).toBeGreaterThanOrEqual(1);
    expect(data.quality).toBeLessThanOrEqual(5);
    expect(itemCount(h, ITEM.turnip)).toBe(turnipsBefore + data.quantity);
    expect(h.state.player.statistics.cropsHarvested).toBeGreaterThanOrEqual(data.quantity);
    const harvestEvents = events.filter((entry) => entry.topic === 'crop:harvested');
    expect(harvestEvents).toHaveLength(1);
    const payload = harvestEvents[0]?.payload as GameEventMap['crop:harvested'];
    expect(payload.cropId).toBe('turnip');
    expect(payload.quantity).toBe(data.quantity);
    expect(events.some((entry) => entry.topic === 'item:acquired')).toBe(true);
    const afterHarvest = h.farming.getPlot(plotId);
    expect(afterHarvest?.stage).toBe('tilled');
    expect(afterHarvest?.cropId).toBeNull();
  });

  it('is deterministic for the same seed and action sequence', () => {
    const first = runTurnipHarvest(4242);
    const second = runTurnipHarvest(4242);
    expect(second).toEqual(first);
  });

  it('regrows strawberries after harvest', () => {
    const h = makeFarmHarness(901);
    giveItem(h, ITEM.strawberrySeed, 3);
    const plotId = tillAndPlant(h, 1, 0, ITEM.strawberrySeed);
    growUntilMature(h, plotId, 40);
    expect(h.farming.getPlot(plotId)?.stage).toBe('mature');
    const first = h.farming.harvestPlot(plotId);
    expect(first.ok, first.message).toBe(true);
    const afterFirst = h.farming.getPlot(plotId);
    expect(afterFirst?.harvests).toBe(1);
    expect(afterFirst?.stage).toBe('planted');
    expect(afterFirst?.cropId).toBe('strawberry');
    growUntilMature(h, plotId, 20);
    expect(h.farming.getPlot(plotId)?.stage).toBe('mature');
    const second = h.farming.harvestPlot(plotId);
    expect(second.ok, second.message).toBe(true);
    expect(h.farming.getPlot(plotId)?.harvests).toBe(2);
  });

  it('grows crops through a single large offline step without hanging', () => {
    const h = makeFarmHarness(303);
    giveItem(h, ITEM.turnipSeed, 2);
    const plotId = tillAndPlant(h, 2, 0, ITEM.turnipSeed);
    // Rain keeps the soil watered through the offline period.
    setGameTime(h, { seasonIndex: 0, dayOfSeason: 5, hour: 9, temperature: 16, weather: 'rain', rainIntensity: 0.6, humidity: 0.9 });
    expect(h.farming.waterPlot(plotId).ok).toBe(true);
    advanceOneBigStep(h, 48 * HOUR);
    const plot = h.farming.getPlot(plotId);
    expect(plot?.stage).toBe('mature');
    expect(plot?.lastUpdatedAt).toBe(h.clock.simTimeSeconds);
    const harvest = h.farming.harvestPlot(plotId);
    expect(harvest.ok, harvest.message).toBe(true);
  });

  it('withers a crop that is left dry for too long', () => {
    const h = makeFarmHarness(404);
    giveItem(h, ITEM.turnipSeed, 2);
    const plotId = tillAndPlant(h, 3, 0, ITEM.turnipSeed);
    setGameTime(h, { seasonIndex: 0, dayOfSeason: 5, hour: 9, temperature: 22 });
    expect(h.farming.waterPlot(plotId).ok).toBe(true);
    advanceOneBigStep(h, 100 * HOUR);
    expect(h.farming.getPlot(plotId)?.stage).toBe('withered');
    expect(h.farming.harvestPlot(plotId).ok).toBe(false);
  });

  it('also handles a year-long offline step safely', () => {
    const h = makeFarmHarness(505);
    giveItem(h, ITEM.turnipSeed, 4);
    const plotId = tillAndPlant(h, 4, 0, ITEM.turnipSeed);
    advanceOneBigStep(h, 24 * 180 * HOUR);
    const plot = h.farming.getPlot(plotId);
    expect(plot).toBeDefined();
    expect(['mature', 'withered', 'planted']).toContain(plot?.stage);
    expect(h.state.farming.lastTickAt).toBe(h.clock.simTimeSeconds);
  });

  it('gates planting by season and allows out-of-season planting in a greenhouse', () => {
    const h = makeFarmHarness(606);
    setGameTime(h, { seasonIndex: 3, dayOfSeason: 5, hour: 9, temperature: 2 });
    giveItem(h, ITEM.tomatoSeed, 5);
    const till = h.farming.tillPlot(LOC.farm, 5, 0);
    expect(till.ok).toBe(true);
    const plotId = (till.data as { plotId: string }).plotId;
    const outOfSeason = h.farming.plantSeed(plotId, ITEM.tomatoSeed);
    expect(outOfSeason.ok).toBe(false);
    expect(outOfSeason.code).toBe('wrong_time');
    // Build a greenhouse and plant the same seed inside it.
    giveItem(h, ITEM.greenhouseKit, 1);
    giveItem(h, ITEM.wood, 10);
    giveItem(h, ITEM.glass, 4);
    const built = h.farming.buildGreenhouse(LOC.farm);
    expect(built.ok, built.message).toBe(true);
    expect(h.farming.getGreenhouses()).toHaveLength(1);
    const greenhousePlots = h.farming.getPlots(LOC.farm).filter((plot) => plot.x >= 200);
    expect(greenhousePlots).toHaveLength(6);
    const greenhousePlotId = greenhousePlots[0]?.id ?? '';
    expect(greenhousePlotId.length).toBeGreaterThan(0);
    const inside = h.farming.plantSeed(greenhousePlotId, ITEM.tomatoSeed);
    expect(inside.ok, inside.message).toBe(true);
    growUntilMature(h, greenhousePlotId, 40);
    expect(h.farming.getPlot(greenhousePlotId)?.stage).toBe('mature');
    expect(h.farming.harvestPlot(greenhousePlotId).ok).toBe(true);
  });

  it('rejects greenhouse construction without materials', () => {
    const h = makeFarmHarness(707);
    h.state.player.inventory = [];
    const result = h.farming.buildGreenhouse(LOC.farm);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_enough_items');
  });

  it('rejects tilling without a hoe or on public ground', () => {
    const h = makeFarmHarness(808);
    h.state.player.inventory = [];
    const noHoe = h.farming.tillPlot(LOC.farm, 0, 0);
    expect(noHoe.ok).toBe(false);
    expect(noHoe.code).toBe('not_enough_items');
    giveItem(h, ITEM.hoe, 1);
    teleport(h, LOC.center);
    const publicGround = h.farming.tillPlot(LOC.center, 0, 0);
    expect(publicGround.ok).toBe(false);
    expect(publicGround.code).toBe('not_allowed');
  });

  it('raises fertility with compost and potash with cigarette ash', () => {
    const h = makeFarmHarness(909);
    giveItem(h, ITEM.turnipSeed, 2);
    giveItem(h, ITEM.cigaretteAsh, 1);
    giveItem(h, ITEM.compost, 1);
    const plotId = tillAndPlant(h, 6, 0, ITEM.turnipSeed);
    const beforePotash = h.farming.getPlot(plotId)?.potash ?? -1;
    const beforeFertility = h.farming.getPlot(plotId)?.fertility ?? -1;
    const ash = h.farming.fertilizePlot(plotId, 'ash');
    expect(ash.ok, ash.message).toBe(true);
    const afterAshPotash = h.farming.getPlot(plotId)?.potash ?? -1;
    const afterAshFertility = h.farming.getPlot(plotId)?.fertility ?? -1;
    expect(afterAshPotash).toBeGreaterThan(beforePotash);
    expect(afterAshFertility).toBeGreaterThan(beforeFertility);
    expect(itemCount(h, ITEM.cigaretteAsh)).toBe(0);
    const none = h.farming.fertilizePlot(plotId, 'none');
    expect(none.ok).toBe(true);
    expect(none.stateChanged).toBe(false);
    const compost = h.farming.fertilizePlot(plotId, 'compost');
    expect(compost.ok, compost.message).toBe(true);
    expect(h.farming.getPlot(plotId)?.fertility ?? -1).toBeGreaterThan(afterAshFertility);
  });

  it('cigarette ash fertiliser improves harvested quality statistically', () => {
    const h = makeFarmHarness(4242);
    giveItem(h, ITEM.turnipSeed, 80);
    giveItem(h, ITEM.cigaretteAsh, 200);
    const withAsh: number[] = [];
    const withoutAsh: number[] = [];
    for (let index = 0; index < 32; index += 1) {
      const x = index % 8;
      const y = Math.floor(index / 8);
      const plotId = tillAndPlant(h, x, y, ITEM.turnipSeed);
      if (index % 2 === 0) {
        for (let application = 0; application < 3; application += 1) {
          expect(h.farming.fertilizePlot(plotId, 'ash').ok).toBe(true);
        }
      }
      const plot = h.farming.getPlot(plotId);
      expect(plot).toBeDefined();
      if (!plot) continue;
      plot.stage = 'mature';
      plot.growth = 1;
      plot.growthStage = 3;
      const harvest = h.farming.harvestPlot(plotId);
      expect(harvest.ok, harvest.message).toBe(true);
      const quality = (harvest.data as { quality: number }).quality;
      if (index % 2 === 0) withAsh.push(quality);
      else withoutAsh.push(quality);
    }
    const average = (values: number[]): number => values.reduce((total, value) => total + value, 0) / values.length;
    expect(withAsh).toHaveLength(16);
    expect(withoutAsh).toHaveLength(16);
    expect(average(withAsh)).toBeGreaterThan(average(withoutAsh) + 0.3);
  });

  it('clears a plot and exposes crop definitions', () => {
    const h = makeFarmHarness(111);
    expect(h.farming.getCropDef('turnip')?.produceItemId).toBe(ITEM.turnip);
    expect(h.farming.getCropDef('nope')).toBeUndefined();
    giveItem(h, ITEM.turnipSeed, 1);
    const plotId = tillAndPlant(h, 7, 0, ITEM.turnipSeed);
    expect(h.farming.clearPlot(plotId).ok).toBe(true);
    expect(h.farming.getPlot(plotId)).toBeUndefined();
    expect(h.farming.getPlots(LOC.farm)).toHaveLength(0);
  });

  it('cooldown-free till rejects duplicate patches and out-of-bounds coordinates', () => {
    const h = makeFarmHarness(222);
    expect(h.farming.tillPlot(LOC.farm, 0, 0).ok).toBe(true);
    const duplicate = h.farming.tillPlot(LOC.farm, 0, 0);
    expect(duplicate.ok).toBe(false);
    const outOfBounds = h.farming.tillPlot(LOC.farm, 999, 0);
    expect(outOfBounds.ok).toBe(false);
    const negative = h.farming.tillPlot(LOC.farm, -1, 0);
    expect(negative.ok).toBe(false);
  });
});