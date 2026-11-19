import type {
  CigaretteConditionState,
  EnvironmentState,
  IClock,
  IContentRegistry,
  IEventBus,
  ILogger,
  MicroclimateState,
} from '../core/contracts';
import type { GameState } from '../core/contracts';
import type { ItemDef } from '../data/schema';
import type { LocationId } from '../core/SharedTypes';
import { WORLD_CONFIG, WEATHER_PROFILES } from '../core/WorldConfig';
import { clamp, clamp01 } from '../core/utils';
import { ITEM } from '../data/items/ids';
import { clampMultiplier, countItemOnPerson, simSecondsToGameHours } from './lifeShared';

/**
 * CigarettePhysicsSystem - the signature mechanic of the game (spec module 8).
 *
 * Every simulation second the player's cigarette body evolves:
 *  - moisture: rain and humid air soak the paper when unprotected; shelter, indoor warmth,
 *    heat sources, a desiccant pack or a hand warmer dry it out again;
 *  - burn rate: base burn is accelerated by wind and exertion, damped by moisture, scaled
 *    by weather and by carried/equipped protection;
 *  - lengthRatio: the body shortens by burnRate * dt; at 0 the life is over;
 *  - ash: burning produces cigarette ash that the player can later collect.
 *
 * The system is deterministic (no randomness) and DOM-free, so it runs in the Web Worker.
 * Time scale: 1 simulated second = 1 in-game minute, therefore 60 sim seconds = 1 game hour.
 */
export interface CigarettePhysicsDeps {
  state: GameState;
  content: IContentRegistry;
  bus: IEventBus;
  clock: IClock;
  /** Microclimate provider (normally delegated to the world system). */
  getMicroclimate: (locationId: LocationId) => MicroclimateState;
  /** Environment provider (normally delegated to the world system). */
  getEnvironment: () => EnvironmentState;
  logger?: ILogger;
}

/** Written to the bus every ~5 simulated seconds so the HUD can interpolate. */
export const CIGARETTE_STATE_EMIT_INTERVAL_SECONDS = 5;

/** Minimum simulated seconds between two cigarette warnings (2 in-game hours). */
export const CIGARETTE_WARNING_COOLDOWN_SECONDS = 120;

/** Burn rate coefficient of the wind term: 1 + 0.8 * wind * (1 - windProtection). */
export const WIND_BURN_COEFFICIENT = 0.8;
/** Burn multiplier added per unit of exertion (heavy work burns the body faster). */
export const EXERTION_BURN_FACTOR = 0.75;
/** Burn reduction per unit of moisture: (1 - 0.4 * moisture). */
export const MOISTURE_BURN_COEFFICIENT = 0.4;
/** Lowest possible damp burn multiplier (never fully extinguishes by moisture alone). */
export const MIN_MOISTURE_BURN_MULTIPLIER = 0.2;
/** 'Damp' is reached above the config damp threshold; soaked at the soaked threshold. */
export const NEAR_BURNOUT_RATIO = 0.15;
/** Movement penalty applied near burnout (matches the design spec). */
export const NEAR_BURNOUT_MOVE_MULTIPLIER = 0.75;
/** Ash cap warning fires at this fraction of WORLD_CONFIG.cigarette.maxAsh. */
export const ASH_FULL_WARNING_FRACTION = 0.98;
/** Floating-point residue below this is treated as an exhausted body (length 0). */
export const LENGTH_EPSILON = 1e-9;
/** Curvature start of the humidity soak term (below this humidity the paper stays dry). */
export const HUMIDITY_GAIN_START = 0.6;
/** Temperature (C) at which drying runs at its configured base speed. */
export const TEMPERATURE_DRYING_BASELINE_C = 12;
/** Drying speed change per degree Celsius away from the baseline (colder dries slower). */
export const TEMPERATURE_DRYING_PER_DEGREE = 0.03;
export const TEMPERATURE_DRYING_MIN = 0.5;
export const TEMPERATURE_DRYING_MAX = 1.6;
/** Moisture gain per game hour from fully saturated air with no protection. */
export const HUMIDITY_MOISTURE_GAIN_PER_HOUR = 0.22;
/** Base evaporation even outdoors in dry weather, as a multiple of moistureDryRatePerHour. */
export const DRYING_BASE_FACTOR = 0.35;
export const DRYING_INDOOR_FACTOR = 0.65;
export const DRYING_HEAT_SOURCE_FACTOR = 1.0;
export const DRYING_DESICCANT_FACTOR = 0.8;
export const DRYING_HAND_WARMER_FACTOR = 0.4;
/** Effective wind (0..1) above which the wind warning fires. */
export const WIND_WARNING_THRESHOLD = 0.55;

/**
 * Ash model. WORLD_CONFIG.cigarette.ashPerLengthUnit (0.0045) describes raw paper ash per
 * 1% of length burned - realistic, but far below one collectable item for a whole lifetime.
 * We convert raw ash to collectable "pinches" so that a whole cigarette yields exactly
 * WORLD_CONFIG.cigarette.maxAsh pinches (100). One pinch == one ITEM.cigaretteAsh item.
 */
export const ASH_PINCHES_PER_FULL_LENGTH = WORLD_CONFIG.cigarette.maxAsh;

export interface CigaretteProtectionProfile {
  moistureProtection: number;
  windProtection: number;
  burnRateMultiplier: number;
  /** Equipped item ids that contributed to the profile (UI/debug). */
  sources: string[];
}

export interface CigaretteClimate {
  indoor: boolean;
  shelter: number;
  rainProtection: number;
  rainGainPerHour: number;
  humidityGainPerHour: number;
  dryingPerGameHour: number;
  effectiveWind: number;
  windFactor: number;
  weatherBurnMultiplier: number;
  isSheltered: boolean;
}

export interface CigaretteSnapshot {
  lengthRatio: number;
  moisture: number;
  burnRate: number;
  totalBurned: number;
  ashAccumulated: number;
  isSheltered: boolean;
  effectiveWind: number;
  rainProtection: number;
  moistureProtection: number;
  windProtection: number;
  burnRateMultiplier: number;
  dryingPerGameHour: number;
  temperature: number;
  offline: boolean;
  exertion: number;
  tooSoakedForHeavyWork: boolean;
  moveSpeedMultiplier: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export class CigarettePhysicsSystem {
  private readonly deps: CigarettePhysicsDeps;
  /** 0..1 physical exertion set by the game loop while the player runs/works. */
  private exertion = 0;
  /** Accumulated simulated seconds since the last cigarette:state event. */
  private stateEmitAccumulator = 0;
  /** True on the tick the body just reached 0; LifeSystem consumes it to end the life. */
  private burnedOutThisTick = false;

  constructor(deps: CigarettePhysicsDeps) {
    this.deps = deps;
  }

  /** Sets the current exertion level (0 idle .. 1 sprinting / heavy labour). */
  setExertion(level: number): void {
    this.exertion = clamp01(isFiniteNumber(level) ? level : 0);
  }

  getExertion(): number {
    return this.exertion;
  }

  getCondition(): CigaretteConditionState {
    return this.deps.state.player.cigarette;
  }

  /** Current microclimate sampled at the player position (world system or fallback). */
  getCurrentMicroclimate(): MicroclimateState {
    return this.safeMicroclimate();
  }

  /** Current world environment (weather, wind, humidity, temperature). */
  getCurrentEnvironment(): EnvironmentState {
    return this.safeEnvironment();
  }

  /** Remaining game hours at the current burn rate (HUD estimate). */
  getRemainingGameHours(): number {
    const config = WORLD_CONFIG.cigarette;
    const cigarette = this.deps.state.player.cigarette;
    const burnPerGameHour = config.baseBurnPerGameHour * Math.max(0.01, cigarette.burnRate);
    return cigarette.lengthRatio / burnPerGameHour;
  }

  /** True only for the update tick on which lengthRatio reached 0. */
  consumeBurnedOutFlag(): boolean {
    const value = this.burnedOutThisTick;
    this.burnedOutThisTick = false;
    return value;
  }

  /** True when the player is too soaked to perform heavy physical work. */
  isTooSoakedForHeavyWork(): boolean {
    return this.deps.state.player.cigarette.moisture >= WORLD_CONFIG.cigarette.soakedThreshold;
  }

  /** Movement multiplier from moisture, near-burnout frailty and status effects. */
  getMoveSpeedMultiplier(): number {
    const cigarette = this.deps.state.player.cigarette;
    const damp = WORLD_CONFIG.cigarette.dampThreshold;
    let multiplier = 1 - 0.5 * Math.max(0, cigarette.moisture - damp);
    if (cigarette.lengthRatio > 0 && cigarette.lengthRatio < NEAR_BURNOUT_RATIO) {
      multiplier *= NEAR_BURNOUT_MOVE_MULTIPLIER;
    }
    const now = this.deps.clock.simTimeSeconds;
    for (const effect of this.deps.state.player.statusEffects) {
      if (effect.expiresAt !== null && effect.expiresAt <= now) continue;
      if (effect.moveSpeedMultiplier !== undefined) multiplier *= effect.moveSpeedMultiplier;
    }
    return clampMultiplier(multiplier);
  }

  /** Read-only environment + protection snapshot for the HUD and debug panels. */
  getSnapshot(): CigaretteSnapshot {
    const cigarette = this.deps.state.player.cigarette;
    const environment = this.safeEnvironment();
    const microclimate = this.safeMicroclimate();
    const protection = this.computeProtection();
    const climate = this.computeClimate(environment, microclimate, protection);
    return {
      lengthRatio: cigarette.lengthRatio,
      moisture: cigarette.moisture,
      burnRate: cigarette.burnRate,
      totalBurned: cigarette.totalBurned,
      ashAccumulated: cigarette.ashAccumulated,
      isSheltered: cigarette.isSheltered,
      effectiveWind: climate.effectiveWind,
      rainProtection: climate.rainProtection,
      moistureProtection: protection.moistureProtection,
      windProtection: protection.windProtection,
      burnRateMultiplier: protection.burnRateMultiplier,
      dryingPerGameHour: climate.dryingPerGameHour,
      temperature: environment.temperature,
      offline: this.isOfflineTick(),
      exertion: this.exertion,
      tooSoakedForHeavyWork: this.isTooSoakedForHeavyWork(),
      moveSpeedMultiplier: this.getMoveSpeedMultiplier(),
    };
  }

  /**
   * Advances the cigarette body by dtSimSeconds simulated seconds. Pure state mutation:
   * no wall-clock time, no randomness, so identical dt sequences reproduce identical state.
   */
  update(dtSimSeconds: number): void {
    const state = this.deps.state;
    if (state.life.phase !== 'alive') return;
    if (!isFiniteNumber(dtSimSeconds) || dtSimSeconds <= 0) {
      this.emitStateIfDue(0);
      return;
    }
    const cigarette = state.player.cigarette;
    const config = WORLD_CONFIG.cigarette;
    const gameHours = simSecondsToGameHours(dtSimSeconds);
    const environment = this.safeEnvironment();
    const microclimate = this.safeMicroclimate();
    const protection = this.computeProtection();
    const climate = this.computeClimate(environment, microclimate, protection);
    const now = this.deps.clock.simTimeSeconds;

    // --- Status effect contributions -------------------------------------
    let statusMoisturePerHour = 0;
    let statusBurnMultiplier = 1;
    for (const effect of state.player.statusEffects) {
      if (effect.expiresAt !== null && effect.expiresAt <= now) continue;
      if (effect.moistureChangePerHour !== undefined) statusMoisturePerHour += effect.moistureChangePerHour;
      if (effect.burnRateMultiplier !== undefined) statusBurnMultiplier *= effect.burnRateMultiplier;
    }

    // --- Moisture ---------------------------------------------------------
    const moistureDeltaPerHour = climate.rainGainPerHour + climate.humidityGainPerHour - climate.dryingPerGameHour + statusMoisturePerHour;
    cigarette.moisture = clamp01(cigarette.moisture + moistureDeltaPerHour * gameHours);

    // --- Burn rate --------------------------------------------------------
    const exertionFactor = 1 + EXERTION_BURN_FACTOR * clamp01(this.exertion);
    const weatherMultiplier = microclimate.indoor ? 1 : climate.weatherBurnMultiplier;
    const moistureMultiplier = clamp(
      1 - MOISTURE_BURN_COEFFICIENT * cigarette.moisture,
      MIN_MOISTURE_BURN_MULTIPLIER,
      1
    );
    const burnMultiplier =
      climate.windFactor *
      exertionFactor *
      moistureMultiplier *
      weatherMultiplier *
      statusBurnMultiplier *
      protection.burnRateMultiplier;
    let deltaLength = config.baseBurnPerGameHour * burnMultiplier * gameHours;
    const offline = this.isOfflineTick();
    if (offline) deltaLength *= config.offlineBurnMultiplier;
    const previousLength = cigarette.lengthRatio;
    let nextLength = clamp01(previousLength - deltaLength);
    // Snap arithmetic residue so an exactly-spent body reliably reaches 0 (life end).
    if (nextLength < LENGTH_EPSILON) nextLength = 0;
    cigarette.lengthRatio = nextLength;
    const burnedNow = previousLength - cigarette.lengthRatio;
    cigarette.totalBurned = clamp(cigarette.totalBurned + burnedNow, 0, 1);
    cigarette.burnRate = burnMultiplier;

    // --- Ash --------------------------------------------------------------
    const ashGain = burnedNow * ASH_PINCHES_PER_FULL_LENGTH;
    cigarette.ashAccumulated = clamp(cigarette.ashAccumulated + ashGain, 0, config.maxAsh);
    cigarette.isSheltered = climate.isSheltered;
    this.burnedOutThisTick = previousLength > 0 && cigarette.lengthRatio <= 0;

    // --- Events -----------------------------------------------------------
    this.stateEmitAccumulator += dtSimSeconds;
    this.emitStateIfDue(this.stateEmitAccumulator);
    if (this.stateEmitAccumulator >= CIGARETTE_STATE_EMIT_INTERVAL_SECONDS) this.stateEmitAccumulator = 0;
    // No danger warnings on the tick the body finally goes out - the life:ended event follows.
    if (!this.burnedOutThisTick) this.processWarnings(climate, now);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------
  private emitStateIfDue(accumulated: number): void {
    if (accumulated < CIGARETTE_STATE_EMIT_INTERVAL_SECONDS) return;
    const cigarette = this.deps.state.player.cigarette;
    this.deps.bus.emit('cigarette:state', {
      lengthRatio: cigarette.lengthRatio,
      moisture: cigarette.moisture,
      burnRate: cigarette.burnRate,
      sheltered: cigarette.isSheltered,
    });
  }

  private isOfflineTick(): boolean {
    return this.deps.state.flags['offline_simulation'] === true;
  }

  private safeMicroclimate(): MicroclimateState {
    const locationId = this.deps.state.player.position.locationId;
    try {
      const provided = this.deps.getMicroclimate(locationId);
      if (provided && typeof provided.indoor === 'boolean') return provided;
    } catch (error) {
      this.deps.logger?.warn('cigarette physics: microclimate provider failed; using location state fallback', {
        locationId,
        error: String(error),
      });
    }
    const location = this.deps.state.world.locations[locationId];
    if (location) return location.microclimate;
    const indoor = this.deps.state.player.position.indoor;
    return {
      indoor,
      shelter: indoor ? 1 : 0,
      windExposure: indoor ? 0 : 1,
      humidityModifier: 0,
      heatSource: false,
    };
  }

  private safeEnvironment(): EnvironmentState {
    try {
      const provided = this.deps.getEnvironment();
      if (provided) return provided;
    } catch (error) {
      this.deps.logger?.warn('cigarette physics: environment provider failed; using world state fallback', {
        error: String(error),
      });
    }
    return this.deps.state.world.environment;
  }

  /** Aggregates moisture/wind/burn protection from all equipped cigarette gear. */
  computeProtection(): CigaretteProtectionProfile {
    const state = this.deps.state;
    let moistureProtection = 0;
    let windProtection = 0;
    let burnRateMultiplier = 1;
    const sources: string[] = [];
    for (const equippedId of Object.values(state.player.equipment)) {
      if (typeof equippedId !== 'string' || equippedId.length === 0) continue;
      const item: ItemDef | undefined = this.deps.content.getItem(equippedId);
      if (!item) continue;
      const itemMoisture = clamp01(item.moistureProtection ?? 0);
      const itemWind = clamp01(item.windProtection ?? 0);
      if (itemMoisture > 0) moistureProtection = 1 - (1 - moistureProtection) * (1 - itemMoisture);
      if (itemWind > 0) windProtection = 1 - (1 - windProtection) * (1 - itemWind);
      if (item.burnRateMultiplier !== undefined && Number.isFinite(item.burnRateMultiplier)) {
        burnRateMultiplier *= item.burnRateMultiplier;
      }
      sources.push(item.id);
    }
    return {
      moistureProtection: clamp01(moistureProtection),
      windProtection: clamp01(windProtection),
      burnRateMultiplier: clamp(burnRateMultiplier, 0.3, 1.5),
      sources,
    };
  }

  private computeClimate(
    environment: EnvironmentState,
    microclimate: MicroclimateState,
    protection: CigaretteProtectionProfile
  ): CigaretteClimate {
    const config = WORLD_CONFIG.cigarette;
    const state = this.deps.state;
    const indoor = microclimate.indoor;
    const shelter = indoor ? 1 : clamp01(microclimate.shelter);
    const rainIntensity = clamp01(environment.rainIntensity);
    const rainProtection = indoor ? 1 : 1 - (1 - shelter) * (1 - protection.moistureProtection);

    const rainGainPerHour = config.moistureRainGainPerHour * rainIntensity * (1 - rainProtection);
    const effectiveHumidity = clamp01(environment.humidity + microclimate.humidityModifier);
    const humidityGainPerHour =
      HUMIDITY_MOISTURE_GAIN_PER_HOUR *
      clamp01((effectiveHumidity - HUMIDITY_GAIN_START) / (1 - HUMIDITY_GAIN_START)) *
      (1 - rainProtection);

    const hasDesiccant = countItemOnPerson(state, ITEM.desiccantPack) > 0;
    const hasHandWarmer = countItemOnPerson(state, ITEM.handWarmer) > 0;
    const isRaining = rainGainPerHour > 0.0001;
    let dryingFactor = isRaining && !indoor ? 0 : DRYING_BASE_FACTOR;
    if (indoor) dryingFactor += DRYING_INDOOR_FACTOR;
    if (microclimate.heatSource) dryingFactor += DRYING_HEAT_SOURCE_FACTOR;
    if (hasDesiccant) dryingFactor += DRYING_DESICCANT_FACTOR;
    if (hasHandWarmer) dryingFactor += DRYING_HAND_WARMER_FACTOR;
    // Cold slows drying; warmth speeds it. Temperature sampling comes from the environment.
    const temperatureFactor = clamp(
      1 + (environment.temperature - TEMPERATURE_DRYING_BASELINE_C) * TEMPERATURE_DRYING_PER_DEGREE,
      TEMPERATURE_DRYING_MIN,
      TEMPERATURE_DRYING_MAX
    );
    const dryingPerGameHour = config.moistureDryRatePerHour * dryingFactor * temperatureFactor;

    const windExposure = indoor ? 0 : clamp01(microclimate.windExposure);
    const effectiveWind = clamp01(environment.windSpeed * windExposure);
    const windFactor = 1 + WIND_BURN_COEFFICIENT * effectiveWind * (1 - protection.windProtection);
    const profile = WEATHER_PROFILES[environment.weather] ?? WEATHER_PROFILES.clear;
    const weatherBurnMultiplier = profile.burnMultiplier;
    const isSheltered = indoor || shelter >= 0.5;

    return {
      indoor,
      shelter,
      rainProtection,
      rainGainPerHour,
      humidityGainPerHour,
      dryingPerGameHour,
      effectiveWind,
      windFactor,
      weatherBurnMultiplier,
      isSheltered,
    };
  }

  /** Emits throttled cigarette warnings for genuinely observable danger states. */
  private processWarnings(climate: CigaretteClimate, now: number): void {
    const state = this.deps.state;
    const config = WORLD_CONFIG.cigarette;
    const cigarette = state.player.cigarette;
    const life = state.life;
    const protection = this.computeProtection();

    interface WarningCandidate {
      key: string;
      kind: 'soaked' | 'near_burnout' | 'wind' | 'ash_full';
      message: string;
    }
    const candidates: WarningCandidate[] = [];
    if (cigarette.lengthRatio > 0 && cigarette.lengthRatio <= NEAR_BURNOUT_RATIO) {
      candidates.push({
        key: 'near_burnout',
        kind: 'near_burnout',
        message: 'Your body is nearly burned down - only the filter is left. Make every hour count.',
      });
    }
    if (cigarette.moisture >= config.soakedThreshold) {
      candidates.push({
        key: 'soaked',
        kind: 'soaked',
        message: 'You are soaked through. Find shelter or a heat source; wet paper burns slow and moves slower.',
      });
    } else if (cigarette.moisture > config.dampThreshold) {
      candidates.push({
        key: 'damp',
        kind: 'soaked',
        message: 'Your paper is getting damp. Dry off somewhere warm before the wet seeps in.',
      });
    }
    if (!climate.indoor && climate.effectiveWind >= WIND_WARNING_THRESHOLD && protection.windProtection < 0.5) {
      candidates.push({
        key: 'wind',
        kind: 'wind',
        message: 'The wind is tearing at your ember and burning you down fast. Find cover or a wind guard.',
      });
    }
    if (cigarette.ashAccumulated >= config.maxAsh * ASH_FULL_WARNING_FRACTION) {
      candidates.push({
        key: 'ash_full',
        kind: 'ash_full',
        message: 'Your ash is overflowing. Flick it into your bag before you lose the lot.',
      });
    }
    if (candidates.length === 0) return;
    // A single shared throttle: one warning per cooldown, no matter how many dangers exist.
    if (now - life.lastWarnedAt < CIGARETTE_WARNING_COOLDOWN_SECONDS) return;
    const candidate = candidates[0];
    if (!candidate) return;
    if (!life.warnings.includes(candidate.key)) life.warnings.push(candidate.key);
    life.lastWarnedAt = now;
    this.deps.bus.emit('cigarette:warning', { kind: candidate.kind, message: candidate.message });
  }
}
