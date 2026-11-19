import type {
  ActionResult,
  FarmPlotState,
  GreenhouseState,
  IGameContext,
  IFarmingSystem,
  ISkillSystem,
  IWorldSystem,
} from '../core/contracts';
import type { CropDef, LocationDef } from '../data/schema';
import type { QualityStars, SkillId } from '../core/SharedTypes';
import { WORLD_CONFIG, SKILL_ACTIVITY_XP } from '../core/WorldConfig';
import { ITEM } from '../data/items/ids';
import { LOC } from '../data/locations/ids';
import { addItemToInventory, consumeItems, countItem, removeItemFromInventory } from '../core/InventoryUtil';
import { clamp, clamp01, makeId } from '../core/utils';

/** One in-game hour in simulated seconds (1 sim second = 1 game minute). */
// 1 simulated second = 1 in-game minute, so a game hour is 60 sim seconds.
const SECONDS_PER_GAME_HOUR = 60;
/** Upper bound of tilled plots per location (keeps the slice and per-tick work bounded). */
const MAX_PLOTS_PER_LOCATION = 40;
/** Plots created automatically inside a built greenhouse. */
const GREENHOUSE_PLOT_COUNT = 6;
/**
 * Greenhouse plots use a reserved coordinate range so they never collide with the
 * player-tilled field grid; the greenhouse id -> plots map is the authoritative list.
 */
const GREENHOUSE_PLOT_ORIGIN = 200;
/** Materials consumed by buildGreenhouse (greenhouse kit is a craftable item owned by the craft module). */
const GREENHOUSE_BUILD_COST = [
  { itemId: ITEM.greenhouseKit, quantity: 1 },
  { itemId: ITEM.wood, quantity: 10 },
  { itemId: ITEM.glass, quantity: 4 },
] as const;
/** Base soil fertility by location kind, before location condition is applied. */
const BASE_FERTILITY: Readonly<Record<string, number>> = {
  farm: 0.65,
  orchard: 0.6,
  greenhouse: 0.75,
  countryside: 0.45,
  residence: 0.5,
};

function plotKey(locationId: string, x: number, y: number): string {
  return locationId + ':' + x + ':' + y;
}

function qualityFromScore(score: number): QualityStars {
  const stars = 1 + Math.floor(clamp01(score) * 4.999);
  return clamp(stars, 1, 5) as QualityStars;
}

/**
 * FarmingSystem (system id 'farming') - soil, planting, watering, ash/compost
 * fertilising, staged crop growth with offline-safe time integration, disease,
 * withering and harvesting, plus greenhouse construction.
 *
 * State lives entirely in GameState.farming (plots keyed locationId:x:y, greenhouses).
 * Growth is integrated from absolute sim timestamps so any dt (0.25s frame or a
 * 24h offline step) produces the same result for the same elapsed time.
 */
export class FarmingSystem implements IFarmingSystem {
  readonly id = 'farming';
  private ctx!: IGameContext;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    const farming = ctx.state.farming;
    if (!Number.isFinite(farming.lastTickAt)) farming.lastTickAt = ctx.clock.simTimeSeconds;
    const now = ctx.clock.simTimeSeconds;
    // Repair plots restored from older saves: never let a timestamp sit in the future.
    for (const plot of Object.values(farming.plots)) {
      if (!Number.isFinite(plot.lastUpdatedAt) || plot.lastUpdatedAt > now) plot.lastUpdatedAt = now;
      plot.moisture = clamp01(plot.moisture);
      plot.fertility = clamp01(plot.fertility);
      plot.potash = clamp01(plot.potash);
      plot.health = clamp01(plot.health);
      plot.disease = clamp01(plot.disease);
    }
  }

  // -------------------------------------------------------------------------
  // Public read API (contract)
  // -------------------------------------------------------------------------

  getPlots(locationId?: string): FarmPlotState[] {
    const plots = Object.values(this.ctx.state.farming.plots);
    const filtered = locationId ? plots.filter((plot) => plot.locationId === locationId) : plots;
    return filtered.sort((a, b) => {
      if (a.locationId !== b.locationId) return a.locationId < b.locationId ? -1 : 1;
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });
  }

  getCropDef(cropId: string): CropDef | undefined {
    return this.ctx.content.getCrop(cropId);
  }

  getGreenhouses(): GreenhouseState[] {
    return Object.values(this.ctx.state.farming.greenhouses);
  }

  // -------------------------------------------------------------------------
  // Extra read API used by UI / integration
  // -------------------------------------------------------------------------

  getPlot(plotId: string): FarmPlotState | undefined {
    return this.ctx.state.farming.plots[plotId];
  }

  getGreenhouseAt(locationId: string): GreenhouseState | undefined {
    return this.getGreenhouses().find((greenhouse) => greenhouse.locationId === locationId);
  }

  isGreenhousePlot(plotId: string): boolean {
    for (const greenhouse of this.getGreenhouses()) {
      if (greenhouse.plots.includes(plotId)) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Player actions (contract)
  // -------------------------------------------------------------------------

  tillPlot(locationId: string, x: number, y: number): ActionResult {
    const def = this.ctx.content.getLocation(locationId);
    if (!def) return { ok: false, code: 'not_found', message: 'Unknown location.' };
    if (!this.isPlayerAt(locationId)) return { ok: false, code: 'wrong_location', message: 'You must be at this location to till soil.' };
    if (!this.isFarmableLocation(def)) {
      return { ok: false, code: 'not_allowed', message: 'The ground here is too hard or too public to farm.' };
    }
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
      return { ok: false, code: 'invalid', message: 'Plot coordinates must be whole numbers.' };
    }
    const width = def.widthTiles > 0 ? def.widthTiles : 16;
    const height = def.heightTiles > 0 ? def.heightTiles : 16;
    if (x >= width || y >= height) {
      return { ok: false, code: 'invalid', message: 'That plot is outside the farmable ground.' };
    }
    const plots = this.getPlots(locationId);
    const existing = plots.find((plot) => plot.x === x && plot.y === y);
    if (existing) {
      return { ok: false, code: 'invalid', message: 'That patch is already tilled.' };
    }
    if (plots.length >= MAX_PLOTS_PER_LOCATION) {
      return { ok: false, code: 'capacity_reached', message: 'This field has no more room for plots.' };
    }
    if (countItem(this.ctx.state.player.inventory, ITEM.hoe) <= 0) {
      return { ok: false, code: 'not_enough_items', message: 'You need a hoe to break the soil.' };
    }
    const now = this.ctx.clock.simTimeSeconds;
    const id = plotKey(locationId, x, y);
    const plot: FarmPlotState = {
      id,
      ownerId: this.ctx.state.player.id,
      locationId,
      x,
      y,
      stage: 'tilled',
      cropId: null,
      growth: 0,
      growthStage: 0,
      plantedAt: 0,
      wateredAt: 0,
      moisture: 0.35,
      fertility: this.baseFertility(def),
      potash: 0,
      health: 1,
      disease: 0,
      quality: 1,
      harvests: 0,
      lastUpdatedAt: now,
    };
    this.ctx.state.farming.plots[id] = plot;
    this.grantXp('gardening', SKILL_ACTIVITY_XP.gardening * 0.35, 'till');
    return {
      ok: true,
      message: 'You till the soil into a neat plot.',
      stateChanged: true,
      data: { plotId: id, x, y },
    };
  }

  plantSeed(plotId: string, seedItemId: string): ActionResult {
    const plot = this.ctx.state.farming.plots[plotId];
    if (!plot) return { ok: false, code: 'not_found', message: 'There is no plot here.' };
    if (!this.isPlayerAt(plot.locationId)) return { ok: false, code: 'wrong_location', message: 'You must be at the plot to plant.' };
    if (plot.stage !== 'tilled') {
      return { ok: false, code: 'invalid', message: plot.stage === 'planted' || plot.stage === 'mature' ? 'Something is already growing here.' : 'This plot is not ready for planting.' };
    }
    const itemDef = this.ctx.content.getItem(seedItemId);
    if (!itemDef) return { ok: false, code: 'not_found', message: 'Unknown seed item.' };
    if (!itemDef.seedCropId) return { ok: false, code: 'invalid', message: itemDef.name + ' cannot be planted.' };
    const crop = this.ctx.content.getCrop(itemDef.seedCropId);
    if (!crop) return { ok: false, code: 'not_found', message: 'The seed packet is faded and useless.' };
    const greenhouse = this.isGreenhousePlot(plotId);
    if (!greenhouse && !crop.seasons.includes(this.ctx.state.world.environment.season)) {
      return {
        ok: false,
        code: 'wrong_time',
        message: crop.name + ' does not grow in ' + this.ctx.state.world.environment.season + '. Try a greenhouse.',
      };
    }
    if (countItem(this.ctx.state.player.inventory, seedItemId) <= 0) {
      return { ok: false, code: 'not_enough_items', message: 'You have no ' + itemDef.name + ' left.' };
    }
    removeItemFromInventory(this.ctx.state.player.inventory, seedItemId, 1);
    this.ctx.bus.emit('item:lost', { itemId: seedItemId, quantity: 1, reason: 'planted' });
    const now = this.ctx.clock.simTimeSeconds;
    plot.cropId = crop.id;
    plot.stage = 'planted';
    plot.growth = 0;
    plot.growthStage = 0;
    plot.plantedAt = now;
    plot.wateredAt = now;
    plot.moisture = Math.max(plot.moisture, 0.5);
    plot.quality = 1;
    plot.harvests = 0;
    plot.lastUpdatedAt = now;
    this.grantXp('gardening', SKILL_ACTIVITY_XP.gardening * 0.5, 'plant');
    return {
      ok: true,
      message: 'You press the ' + crop.name.toLowerCase() + ' seed into the soil.',
      stateChanged: true,
      data: { plotId, cropId: crop.id },
    };
  }

  waterPlot(plotId: string): ActionResult {
    const plot = this.ctx.state.farming.plots[plotId];
    if (!plot) return { ok: false, code: 'not_found', message: 'There is no plot here.' };
    if (!this.isPlayerAt(plot.locationId)) return { ok: false, code: 'wrong_location', message: 'You must be at the plot to water it.' };
    if (plot.stage === 'wild' || plot.stage === 'cleared') {
      return { ok: false, code: 'invalid', message: 'Till the ground first.' };
    }
    if (plot.stage === 'withered') return { ok: false, code: 'invalid', message: 'The plant is dead. Clear the plot and start again.' };
    const hasCan =
      countItem(this.ctx.state.player.inventory, ITEM.wateringCan) > 0 ||
      countItem(this.ctx.state.player.inventory, ITEM.wateringCanLarge) > 0;
    if (!hasCan) return { ok: false, code: 'not_enough_items', message: 'You need a watering can.' };
    plot.moisture = WORLD_CONFIG.farming.waterCapacity;
    plot.wateredAt = this.ctx.clock.simTimeSeconds;
    this.grantXp('gardening', SKILL_ACTIVITY_XP.gardening * 0.2, 'water');
    return { ok: true, message: 'The soil darkens as you water it.', stateChanged: true, data: { plotId, moisture: plot.moisture } };
  }

  fertilizePlot(plotId: string, fertilizer: 'ash' | 'compost' | 'none'): ActionResult {
    const plot = this.ctx.state.farming.plots[plotId];
    if (!plot) return { ok: false, code: 'not_found', message: 'There is no plot here.' };
    if (!this.isPlayerAt(plot.locationId)) return { ok: false, code: 'wrong_location', message: 'You must be at the plot to fertilise it.' };
    if (plot.stage === 'wild' || plot.stage === 'cleared') {
      return { ok: false, code: 'invalid', message: 'Till the ground before fertilising.' };
    }
    if (fertilizer === 'none') {
      // Explicit "do not fertilise" choice from the UI: a harmless no-op.
      return { ok: true, message: 'You decide not to fertilise this plot yet.', stateChanged: false };
    }
    if (fertilizer === 'ash') {
      if (countItem(this.ctx.state.player.inventory, ITEM.cigaretteAsh) <= 0) {
        return { ok: false, code: 'not_enough_items', message: 'You have no cigarette ash. Smoke a little and collect the ash first.' };
      }
      removeItemFromInventory(this.ctx.state.player.inventory, ITEM.cigaretteAsh, 1);
      plot.potash = clamp01(plot.potash + WORLD_CONFIG.farming.ashPotashBonus);
      plot.fertility = clamp01(plot.fertility + 0.05);
      this.ctx.bus.emit('item:lost', { itemId: ITEM.cigaretteAsh, quantity: 1, reason: 'fertilised_plot' });
      this.grantXp('gardening', SKILL_ACTIVITY_XP.gardening * 0.4, 'fertilise_ash');
      return {
        ok: true,
        message: 'You work the cigarette ash into the soil. The potash level rises.',
        stateChanged: true,
        data: { plotId, potash: plot.potash, fertility: plot.fertility },
      };
    }
    if (countItem(this.ctx.state.player.inventory, ITEM.compost) <= 0) {
      return { ok: false, code: 'not_enough_items', message: 'You have no compost.' };
    }
    removeItemFromInventory(this.ctx.state.player.inventory, ITEM.compost, 1);
    plot.fertility = clamp01(plot.fertility + 0.25);
    plot.potash = clamp01(plot.potash + 0.02);
    this.ctx.bus.emit('item:lost', { itemId: ITEM.compost, quantity: 1, reason: 'fertilised_plot' });
    this.grantXp('gardening', SKILL_ACTIVITY_XP.gardening * 0.4, 'fertilise_compost');
    return {
      ok: true,
      message: 'The compost is turned through the topsoil. The soil looks richer already.',
      stateChanged: true,
      data: { plotId, fertility: plot.fertility },
    };
  }

  harvestPlot(plotId: string): ActionResult {
    const plot = this.ctx.state.farming.plots[plotId];
    if (!plot) return { ok: false, code: 'not_found', message: 'There is no plot here.' };
    if (!this.isPlayerAt(plot.locationId)) return { ok: false, code: 'wrong_location', message: 'You must be at the plot to harvest.' };
    if (plot.stage !== 'mature' || !plot.cropId) {
      return { ok: false, code: 'wrong_time', message: 'Nothing here is ready to harvest yet.' };
    }
    const crop = this.ctx.content.getCrop(plot.cropId);
    if (!crop) return { ok: false, code: 'not_found', message: 'The plant is too withered to identify.' };
    const quality = this.rollHarvestQuality(plot, crop);
    const quantity = this.rollHarvestYield(plot, crop);
    const produceDef = this.ctx.content.getItem(crop.produceItemId);
    addItemToInventory(this.ctx.state.player.inventory, crop.produceItemId, quantity, {
      quality: produceDef?.hasQuality === false ? 1 : quality,
      freshness: 1,
      simTime: this.ctx.clock.simTimeSeconds,
      maxStack: produceDef?.maxStack ?? 99,
    });
    plot.quality = quality;
    plot.harvests += 1;
    const player = this.ctx.state.player;
    player.statistics.cropsHarvested += quantity;
    this.ctx.bus.emit('crop:harvested', { cropId: crop.id, quality, quantity });
    this.ctx.bus.emit('item:acquired', { itemId: crop.produceItemId, quantity, quality, source: 'farming' });
    this.grantXp('gardening', SKILL_ACTIVITY_XP.gardening * (1 + quality * 0.15), 'harvest');
    const now = this.ctx.clock.simTimeSeconds;
    if (crop.regrowHours > 0) {
      // Berries, herbs and fruit trees keep the plant and re-crop after regrowHours.
      plot.stage = 'planted';
      plot.growthStage = crop.stages.length - 1;
      plot.growth = 0;
      plot.plantedAt = now;
      plot.wateredAt = now;
      plot.moisture = Math.max(plot.moisture, 0.4);
      plot.quality = 1;
    } else {
      plot.stage = 'tilled';
      plot.cropId = null;
      plot.growth = 0;
      plot.growthStage = 0;
      plot.plantedAt = 0;
      plot.quality = 1;
    }
    plot.lastUpdatedAt = now;
    return {
      ok: true,
      message: 'You harvest ' + quantity + ' ' + (produceDef?.name ?? crop.name) + (quantity > 1 ? 's' : '') + '.',
      stateChanged: true,
      data: { cropId: crop.id, itemId: crop.produceItemId, quantity, quality, regrows: crop.regrowHours > 0 },
    };
  }

  clearPlot(plotId: string): ActionResult {
    const plot = this.ctx.state.farming.plots[plotId];
    if (!plot) return { ok: false, code: 'not_found', message: 'There is no plot here.' };
    if (!this.isPlayerAt(plot.locationId)) return { ok: false, code: 'wrong_location', message: 'You must be at the plot to clear it.' };
    delete this.ctx.state.farming.plots[plotId];
    for (const greenhouse of this.getGreenhouses()) {
      const index = greenhouse.plots.indexOf(plotId);
      if (index >= 0) greenhouse.plots.splice(index, 1);
    }
    this.grantXp('gardening', SKILL_ACTIVITY_XP.gardening * 0.15, 'clear_plot');
    return { ok: true, message: 'You clear the plot and let the soil rest.', stateChanged: true, data: { plotId } };
  }

  buildGreenhouse(locationId: string): ActionResult {
    const def = this.ctx.content.getLocation(locationId);
    if (!def) return { ok: false, code: 'not_found', message: 'Unknown location.' };
    if (!this.isPlayerAt(locationId)) return { ok: false, code: 'wrong_location', message: 'You must be at the site to build a greenhouse.' };
    const allowed =
      this.isFarmableLocation(def) ||
      def.kind === 'countryside' ||
      def.id === LOC.home ||
      def.facilities.includes('farmland');
    if (!allowed) return { ok: false, code: 'not_allowed', message: 'A greenhouse needs open ground.' };
    if (this.getGreenhouseAt(locationId)) {
      return { ok: false, code: 'invalid', message: 'There is already a greenhouse here.' };
    }
    const inventory = this.ctx.state.player.inventory;
    const missing = GREENHOUSE_BUILD_COST.find((need) => countItem(inventory, need.itemId) < need.quantity);
    if (missing) {
      return { ok: false, code: 'not_enough_items', message: 'The greenhouse needs more materials: ' + missing.itemId.replace(/_/g, ' ') + '.' };
    }
    consumeItems(
      inventory,
      GREENHOUSE_BUILD_COST.map((need) => ({ itemId: need.itemId, quantity: need.quantity }))
    );
    for (const need of GREENHOUSE_BUILD_COST) {
      this.ctx.bus.emit('item:lost', { itemId: need.itemId, quantity: need.quantity, reason: 'greenhouse_built' });
    }
    const now = this.ctx.clock.simTimeSeconds;
    const greenhouseId = makeId('greenhouse');
    const plotIds: string[] = [];
    for (let index = 0; index < GREENHOUSE_PLOT_COUNT; index += 1) {
      const x = GREENHOUSE_PLOT_ORIGIN + index;
      const y = GREENHOUSE_PLOT_ORIGIN;
      const id = plotKey(locationId, x, y);
      const plot: FarmPlotState = {
        id,
        ownerId: this.ctx.state.player.id,
        locationId,
        x,
        y,
        stage: 'tilled',
        cropId: null,
        growth: 0,
        growthStage: 0,
        plantedAt: 0,
        wateredAt: 0,
        moisture: 0.4,
        fertility: 0.75,
        potash: 0,
        health: 1,
        disease: 0,
        quality: 1,
        harvests: 0,
        lastUpdatedAt: now,
      };
      this.ctx.state.farming.plots[id] = plot;
      plotIds.push(id);
    }
    const greenhouse: GreenhouseState = {
      id: greenhouseId,
      locationId,
      ownerId: this.ctx.state.player.id,
      plots: plotIds,
      condition: 1,
      builtAt: now,
    };
    this.ctx.state.farming.greenhouses[greenhouseId] = greenhouse;
    this.grantXp('gardening', SKILL_ACTIVITY_XP.gardening * 3, 'build_greenhouse');
    this.ctx.bus.emit('game:signal', {
      name: 'greenhouse_built',
      data: { greenhouseId, locationId, plotCount: plotIds.length },
    });
    return {
      ok: true,
      message: 'You raise the greenhouse frame and set the glass. ' + GREENHOUSE_PLOT_COUNT + ' warm beds are ready inside.',
      stateChanged: true,
      data: { greenhouseId, locationId, plotIds: plotIds.slice() },
    };
  }

  // -------------------------------------------------------------------------
  // Simulation update
  // -------------------------------------------------------------------------

  update(dtSimSeconds: number): void {
    const now = this.ctx.clock.simTimeSeconds;
    // Growth integrates over absolute timestamps; dt is intentionally unused so that a
    // single huge offline delta and many small active ticks advance the same hours.
    void dtSimSeconds;
    for (const plot of Object.values(this.ctx.state.farming.plots)) {
      this.updatePlot(plot, now);
    }
    for (const greenhouse of Object.values(this.ctx.state.farming.greenhouses)) {
      const elapsedHours = Math.max(0, now - greenhouse.builtAt) / SECONDS_PER_GAME_HOUR;
      greenhouse.condition = clamp01(1 - elapsedHours * 0.00002);
    }
    this.ctx.state.farming.lastTickAt = now;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private updatePlot(plot: FarmPlotState, now: number): void {
    const startedAt = plot.lastUpdatedAt;
    plot.lastUpdatedAt = now;
    if (plot.stage !== 'planted' && plot.stage !== 'mature') return;
    if (!Number.isFinite(startedAt) || now <= startedAt) return;
    const elapsedHours = (now - startedAt) / SECONDS_PER_GAME_HOUR;
    if (elapsedHours <= 0) return;
    const environment = this.ctx.state.world.environment;
    const greenhouse = this.isGreenhousePlot(plot.id);
    const crop = plot.cropId ? this.ctx.content.getCrop(plot.cropId) : undefined;

    // ---- Soil water: rain refills it (not under glass), plants drink it ----
    const rain = greenhouse ? 0 : environment.rainIntensity;
    const rainGain = rain * 0.22 * elapsedHours;
    const cropWaterUse = plot.stage === 'planted' && crop ? crop.waterPerHour * elapsedHours : 0;
    plot.moisture = clamp01(plot.moisture + rainGain - cropWaterUse);
    if (rain > 0.25) plot.wateredAt = now;

    if (plot.stage === 'mature') {
      // A mature crop waits for harvest; over-ripe plants slowly lose quality.
      if (crop && elapsedHours > 24) plot.quality = qualityFromScore(0.15 + plot.fertility * 0.4);
      return;
    }
    if (!crop) return;
    const stageDef = crop.stages[plot.growthStage];
    if (!stageDef) {
      plot.stage = 'mature';
      plot.growth = 1;
      return;
    }

    // ---- Temperature suitability ----
    const temperature = greenhouse ? 18 : environment.temperature;
    let tempFactor: number;
    if (temperature < crop.tempMin) tempFactor = clamp(1 - (crop.tempMin - temperature) / 18, 0.1, 1);
    else if (temperature > crop.tempMax) tempFactor = clamp(1 - (temperature - crop.tempMax) / 18, 0.1, 1);
    else tempFactor = 1;

    const waterFactor = clamp01(0.3 + plot.moisture * 1.1);
    const fertilityFactor = clamp(0.55 + plot.fertility * 0.45, 0.55, 1.15);
    const healthFactor = clamp(0.35 + plot.health * 0.65, 0.2, 1);
    const seasonFactor = greenhouse || crop.seasons.includes(environment.season) ? 1 : 0.15;
    const growthMultiplier =
      WORLD_CONFIG.farming.growthHoursMultiplier * waterFactor * tempFactor * fertilityFactor * healthFactor * seasonFactor;
    let remainingHours = elapsedHours * growthMultiplier;

    // ---- Stage machine (bounded loop; large offline deltas advance many stages at once) ----
    let safety = crop.stages.length + 1;
    while (remainingHours > 0 && safety > 0) {
      safety -= 1;
      const currentStage = crop.stages[plot.growthStage];
      if (!currentStage) {
        plot.stage = 'mature';
        plot.growth = 1;
        break;
      }
      const stageHours = this.stageHoursFor(plot, crop, plot.growthStage, currentStage.hours);
      const neededHours = (1 - plot.growth) * stageHours;
      if (remainingHours < neededHours) {
        plot.growth = clamp01(plot.growth + remainingHours / stageHours);
        remainingHours = 0;
        break;
      }
      remainingHours -= neededHours;
      if (plot.growthStage >= crop.stages.length - 1) {
        plot.stage = 'mature';
        plot.growth = 1;
        plot.quality = this.estimateQuality(plot, crop);
        break;
      }
      plot.growthStage += 1;
      plot.growth = 0;
    }

    // ---- Disease pressure (one draw per update; chance scales with elapsed time) ----
    const humidity = environment.humidity;
    const diseaseRiskPerHour =
      WORLD_CONFIG.farming.diseaseBaseRatePerHour *
      (1 + humidity * 0.6 + rain * 0.8) *
      (1 - clamp01(crop.diseaseResistance + plot.potash * 0.15));
    const diseaseChance = clamp01(1 - Math.exp(-diseaseRiskPerHour * elapsedHours));
    if (diseaseChance > 0 && this.ctx.probability.chance('farming.growth', diseaseChance)) {
      plot.disease = clamp01(plot.disease + 0.35);
      plot.health = clamp01(plot.health - 0.15);
    }
    if (plot.disease > 0) {
      plot.health = clamp01(plot.health - 0.03 * elapsedHours * plot.disease);
    }
    if (plot.disease > 0.6) {
      plot.quality = 1;
    }

    // ---- Dry-out withering (deterministic, timestamp based) ----
    // A mature crop stays harvestable; only crops that are still growing can die of thirst.
    if (plot.stage === 'mature') return;
    const hoursSinceWatered = plot.wateredAt > 0 ? (now - plot.wateredAt) / SECONDS_PER_GAME_HOUR : elapsedHours;
    if (plot.moisture <= 0.05 && hoursSinceWatered >= WORLD_CONFIG.farming.witheredAfterDryHours) {
      plot.stage = 'withered';
      plot.health = 0;
      plot.quality = 1;
      return;
    }
    // Frost kills tender crops in the open overnight.
    if (!greenhouse && temperature < crop.tempMin - 8 && plot.health < 0.35) {
      plot.stage = 'withered';
      plot.health = 0;
      plot.quality = 1;
    }
  }

  /** Regrowing crops use crop.regrowHours for the final stage instead of the stage definition. */
  private stageHoursFor(plot: FarmPlotState, crop: CropDef, stageIndex: number, stageHours: number): number {
    if (crop.regrowHours > 0 && plot.harvests > 0 && stageIndex === crop.stages.length - 1) {
      return crop.regrowHours;
    }
    return stageHours;
  }

  private estimateQuality(plot: FarmPlotState, crop: CropDef): QualityStars {
    const skill = this.getSkillLevel('gardening');
    const score =
      crop.baseQuality / 5 +
      clamp01(skill / 20) * 0.25 +
      (plot.fertility * 0.25 + plot.potash * crop.ashAffinity * 0.3) -
      plot.disease * 0.4 -
      (1 - plot.health) * 0.3;
    return qualityFromScore(score);
  }

  private rollHarvestQuality(plot: FarmPlotState, crop: CropDef): QualityStars {
    const skill = this.getSkillLevel('gardening');
    const levelFactor = clamp01((skill - 1) / 19);
    const weather = this.ctx.state.world.environment.weather;
    const weatherBonus =
      weather === 'clear' ? 0.08 : weather === 'cloudy' ? 0.02 : weather === 'rain' ? -0.04 : weather === 'storm' ? -0.12 : weather === 'fog' ? -0.05 : weather === 'snow' ? -0.18 : -0.08;
    const roll = this.ctx.probability.roll('farming.quality');
    const score =
      crop.baseQuality / 5 +
      levelFactor * 0.3 +
      plot.fertility * 0.22 +
      plot.potash * crop.ashAffinity * 0.35 +
      weatherBonus +
      roll * 0.18 -
      plot.disease * 0.45 -
      (1 - plot.health) * 0.35;
    return qualityFromScore(score);
  }

  private rollHarvestYield(plot: FarmPlotState, crop: CropDef): number {
    const skill = this.getSkillLevel('gardening');
    const levelFactor = clamp01((skill - 1) / 19);
    let quantity = Math.round(crop.baseYield * (0.8 + levelFactor * 0.35));
    if (plot.potash >= 0.4) quantity += Math.round(plot.potash * crop.ashAffinity);
    if (plot.fertility >= 0.75) quantity += 1;
    if (plot.disease > 0.5) quantity -= 1;
    return Math.max(1, quantity);
  }

  private baseFertility(def: LocationDef): number {
    const kindFertility = BASE_FERTILITY[def.kind] ?? 0.45;
    const locationState = this.ctx.state.world.locations[def.id];
    const condition = locationState ? clamp01(locationState.condition) : 1;
    return clamp01(kindFertility * (0.75 + condition * 0.25));
  }

  private isFarmableLocation(def: LocationDef): boolean {
    if (def.kind === 'farm' || def.kind === 'orchard' || def.kind === 'greenhouse') return true;
    if (def.id === LOC.home) return true;
    return def.facilities.includes('farmland') || def.facilities.includes('greenhouse');
  }

  private isPlayerAt(locationId: string): boolean {
    const world = this.ctx.registry.get<IWorldSystem>('world');
    if (world) return world.getCurrentLocationId() === locationId;
    return this.ctx.state.player.position.locationId === locationId;
  }

  private getSkillLevel(skill: SkillId): number {
    return this.ctx.registry.getRequired<ISkillSystem>('skill').getLevel(skill);
  }

  private grantXp(skill: SkillId, amount: number, source: string): void {
    this.ctx.registry.getRequired<ISkillSystem>('skill').addXp(skill, amount, 'farming:' + source);
  }
}