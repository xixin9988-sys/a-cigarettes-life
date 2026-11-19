import { describe, expect, it } from 'vitest';
import type { WeatherType } from '../../src/core/SharedTypes';
import { LOC } from '../../src/data/locations/ids';
import { interiorIdFor } from '../../src/data/locations/ids';
import { addWorldHistory, getRecentWorldHistory, trimWorldHistory } from '../../src/world/WorldHistory';
import {
  computeDaylight,
  computeTargetHumidity,
  computeTargetTemperature,
  computeTargetWindSpeed,
  normaliseDegrees,
  shortestAngleDelta,
} from '../../src/world/EnvironmentSystem';
import { WEATHER_TRANSITION_INTERVAL_HOURS } from '../../src/world/WeatherSystem';
import {
  advanceGameHours,
  advanceSimSeconds,
  capturedTopics,
  createTestNpc,
  createWorldTestBed,
  placePlayer,
} from './helpers';

const SIM_SECONDS_PER_HOUR = 60;
const SIM_SECONDS_PER_DAY = 24 * SIM_SECONDS_PER_HOUR;
const SUMMER_DAY_ONE = 28 * SIM_SECONDS_PER_DAY;
const AUTUMN_DAY_ONE = 56 * SIM_SECONDS_PER_DAY;
const WINTER_DAY_ONE = 84 * SIM_SECONDS_PER_DAY;

describe('WorldSystem: initialisation and accessors', () => {
  it('creates runtime state for every location and region', () => {
    const bed = createWorldTestBed();
    expect(bed.world.getAllLocations()).toHaveLength(90);
    expect(bed.world.getLocation(LOC.home)?.name).toBe('Willowbrook Residential Lane');
    expect(bed.world.getLocationDef(LOC.home)?.indoor).toBe(false);
    expect(bed.world.getRegion('willowbrook')?.name).toBe('Willowbrook');
    expect(bed.world.getRegion('ashford')?.name).toBe('Ashford City');
    expect(bed.world.getLocationsInRegion('willowbrook')).toHaveLength(50);
    expect(bed.world.getLocationsInRegion('ashford')).toHaveLength(40);
    expect(bed.world.getLocation('missing_location')).toBeUndefined();
  });

  it('starts the player at home, indoors, with a derived calendar', () => {
    const bed = createWorldTestBed();
    expect(bed.world.getCurrentLocationId()).toBe(interiorIdFor(LOC.home));
    expect(bed.world.isIndoor(interiorIdFor(LOC.home))).toBe(true);
    expect(bed.world.isIndoor(LOC.park)).toBe(false);
    const time = bed.world.getTime();
    expect(time.year).toBe(1);
    expect(time.season).toBe('spring');
    expect(time.dayOfSeason).toBe(1);
    expect(time.hour).toBe(8);
    expect(bed.world.getEnvironment().season).toBe('spring');
  });

  it('returns defensive copies of microclimate data', () => {
    const bed = createWorldTestBed();
    const climate = bed.world.getMicroclimate(interiorIdFor(LOC.home));
    expect(climate.indoor).toBe(true);
    expect(climate.shelter).toBe(1);
    expect(climate.windExposure).toBe(0);
    climate.shelter = 0;
    expect(bed.world.getMicroclimate(interiorIdFor(LOC.home)).shelter).toBe(1);
    expect(bed.world.getMicroclimate(LOC.river).humidityModifier).toBeGreaterThan(0);
  });

  it('registers itself under the world system id in the registry', () => {
    const bed = createWorldTestBed();
    expect(bed.world.id).toBe('world');
    expect(bed.registry.get('world')).toBe(bed.world);
  });
});

describe('WorldSystem: calendar, season and daylight', () => {
  it('derives season/day/year from the clock and emits on season change', () => {
    const bed = createWorldTestBed();
    bed.clock.setSimTimeSeconds(SUMMER_DAY_ONE);
    bed.world.update(0);
    const env = bed.world.getEnvironment();
    expect(env.season).toBe('summer');
    expect(env.seasonIndex).toBe(1);
    expect(env.dayOfSeason).toBe(1);
    expect(env.year).toBe(1);
    expect(bed.state.world.history.filter((entry) => entry.description.includes('Summer arrives')).length).toBe(1);
    expect(bed.state.world.history.some((entry) => entry.description.includes('Summer arrives'))).toBe(true);

    bed.clock.setSimTimeSeconds(AUTUMN_DAY_ONE);
    bed.world.update(0);
    expect(bed.world.getEnvironment().season).toBe('autumn');
    bed.clock.setSimTimeSeconds(WINTER_DAY_ONE + 4 * SIM_SECONDS_PER_DAY);
    bed.world.update(0);
    expect(bed.world.getEnvironment().season).toBe('winter');
    expect(bed.world.getEnvironment().dayOfSeason).toBe(5);
    expect(bed.state.world.history.filter((entry) => entry.description.includes('Autumn arrives')).length).toBe(1);
    expect(bed.state.world.history.filter((entry) => entry.description.includes('Winter arrives')).length).toBe(1);
  });

  it('advances daylight with a season-aware sunrise/sunset curve', () => {
    expect(computeDaylight('spring', 0)).toBe(0);
    expect(computeDaylight('spring', 12)).toBeCloseTo(1, 2);
    expect(computeDaylight('summer', 18)).toBeGreaterThan(0.6);
    expect(computeDaylight('winter', 18)).toBe(0);
    expect(computeDaylight('spring', 9)).toBeGreaterThan(computeDaylight('spring', 7));
    expect(computeDaylight('summer', 12)).toBeGreaterThan(0.95);
  });

  it('resyncs silently when the clock is rewound', () => {
    const bed = createWorldTestBed();
    bed.clock.setSimTimeSeconds(SUMMER_DAY_ONE);
    bed.world.update(0);
    expect(bed.world.getEnvironment().season).toBe('summer');
    const historyLength = bed.state.world.history.length;
    bed.clock.setSimTimeSeconds(5 * SIM_SECONDS_PER_DAY);
    bed.world.update(0);
    expect(bed.world.getEnvironment().season).toBe('spring');
    expect(bed.world.getTime().season).toBe('spring');
    expect(bed.state.world.history.length).toBe(historyLength);
  });

  it('reflects daylight into the live environment state', () => {
    const bed = createWorldTestBed();
    bed.clock.setSimTimeSeconds(SUMMER_DAY_ONE + 12 * SIM_SECONDS_PER_HOUR);
    bed.world.update(0);
    expect(bed.world.getEnvironment().daylight).toBeGreaterThan(0.9);
    bed.clock.setSimTimeSeconds(SUMMER_DAY_ONE + 23 * SIM_SECONDS_PER_HOUR);
    bed.world.update(0);
    expect(bed.world.getEnvironment().daylight).toBe(0);
  });

  it('computes weather-aware temperature, humidity and wind targets', () => {
    expect(computeTargetTemperature('summer', 'clear', 15)).toBeGreaterThan(
      computeTargetTemperature('winter', 'clear', 15)
    );
    expect(computeTargetTemperature('spring', 'storm', 15)).toBeLessThan(
      computeTargetTemperature('spring', 'clear', 15)
    );
    expect(computeTargetHumidity('autumn', 'fog', 22)).toBeGreaterThan(
      computeTargetHumidity('summer', 'clear', 22)
    );
    expect(computeTargetWindSpeed(1234, 'storm', 3600)).toBeGreaterThan(
      computeTargetWindSpeed(1234, 'fog', 3600)
    );
  });

  it('keeps angles normalised', () => {
    expect(normaliseDegrees(-90)).toBe(270);
    expect(normaliseDegrees(720)).toBe(0);
    expect(shortestAngleDelta(350, 10)).toBe(20);
    expect(shortestAngleDelta(10, 350)).toBe(-20);
  });
});

describe('WorldSystem: travel and discovery', () => {
  it('walks between adjacent locations and enters/exits interiors', () => {
    const bed = createWorldTestBed();
    const homeInterior = interiorIdFor(LOC.home);
    const exit = bed.world.travelTo(LOC.home);
    expect(exit.ok).toBe(true);
    expect(bed.world.getCurrentLocationId()).toBe(LOC.home);
    expect(bed.world.isIndoor(LOC.home)).toBe(false);

    const toPark = bed.world.travelTo(LOC.park);
    expect(toPark.ok).toBe(true);
    expect(bed.world.getCurrentLocationId()).toBe(LOC.park);
    expect(bed.state.world.locations[LOC.park]?.visitCount).toBe(1);

    // From the park we can reach the plaza, then the cafe and its interior.
    expect(bed.world.travelTo(LOC.plaza).ok).toBe(true);
    expect(bed.world.travelTo(LOC.center).ok).toBe(true);
    expect(bed.world.travelTo(LOC.cafe).ok).toBe(true);
    const cafeInterior = interiorIdFor(LOC.cafe);
    expect(bed.world.travelTo(cafeInterior).ok).toBe(true);
    expect(bed.world.isIndoor(cafeInterior)).toBe(true);
    expect(bed.world.travelTo(LOC.cafe).ok).toBe(true);
    expect(bed.world.getCurrentLocationId()).toBe(LOC.cafe);
    expect(bed.world.travelTo(homeInterior).ok).toBe(false);
    expect(bed.state.world.locations[homeInterior]?.visitCount).toBe(1);
  });

  it('rejects non-adjacent, unknown and same-location travel appropriately', () => {
    const bed = createWorldTestBed();
    placePlayer(bed, LOC.home);
    expect(bed.world.travelTo(LOC.center).code).toBe('not_allowed');
    expect(bed.world.travelTo('missing_location').code).toBe('not_found');
    const already = bed.world.travelTo(LOC.home);
    expect(already.ok).toBe(true);
    expect(already.stateChanged).toBeUndefined();
  });

  it('emits location:changed with from/to/region and tracks visits', () => {
    const bed = createWorldTestBed();
    placePlayer(bed, LOC.home);
    const before = bed.state.world.locations[LOC.park]?.visitCount ?? 0;
    expect(bed.world.travelTo(LOC.park).ok).toBe(true);
    const changes = bed.eventsFor('location:changed') as { from: string | null; to: string; regionId: string }[];
    expect(changes.length).toBe(1);
    expect(changes[0]?.from).toBe(LOC.home);
    expect(changes[0]?.to).toBe(LOC.park);
    expect(changes[0]?.regionId).toBe('willowbrook');
    expect(bed.state.world.locations[LOC.park]?.visitCount).toBe(before + 1);
    expect(bed.state.world.locations[LOC.park]?.lastVisitSimTime).toBe(bed.clock.simTimeSeconds);
  });

  it('locks secret locations until unlocked with enough clues', () => {
    const bed = createWorldTestBed();
    placePlayer(bed, LOC.forest);
    const locked = bed.world.travelTo(LOC.secretPath);
    expect(locked.ok).toBe(false);
    expect(locked.code).toBe('locked');

    const discovered = bed.world.discoverLocation(LOC.secretPath);
    expect(discovered.ok).toBe(true);
    expect(discovered.stateChanged).toBe(true);
    expect(bed.state.world.locations[LOC.secretPath]?.discovered).toBe(true);
    expect(bed.state.world.locations[LOC.secretPath]?.unlocked).toBe(false);
    const discoveryEvents = bed.eventsFor('discovery:made') as { kind: string; id: string }[];
    expect(discoveryEvents.some((event) => event.kind === 'location' && event.id === LOC.secretPath)).toBe(true);

    const withoutClues = bed.world.unlockLocation(LOC.secretPath);
    expect(withoutClues.ok).toBe(false);
    expect(withoutClues.code).toBe('requirement_not_met');

    bed.state.exploration.clues = ['a torn map corner', 'a name carved in bark'];
    const unlocked = bed.world.unlockLocation(LOC.secretPath);
    expect(unlocked.ok).toBe(true);
    expect(unlocked.stateChanged).toBe(true);
    expect(bed.state.world.locations[LOC.secretPath]?.unlocked).toBe(true);
    const secretEvents = bed.eventsFor('discovery:made') as { kind: string; id: string }[];
    expect(secretEvents.some((event) => event.kind === 'secret' && event.id === LOC.secretPath)).toBe(true);
    expect(bed.state.world.history.some((entry) => entry.category === 'discovery')).toBe(true);

    expect(bed.world.travelTo(LOC.secretPath).ok).toBe(true);
  });

  it('treats already-discovered locations as a no-op success', () => {
    const bed = createWorldTestBed();
    placePlayer(bed, LOC.home);
    const result = bed.world.discoverLocation(LOC.center);
    expect(result.ok).toBe(true);
    expect(result.stateChanged).toBeUndefined();
    expect(bed.world.unlockLocation(LOC.center).ok).toBe(true);
    expect(bed.world.discoverLocation('missing_location').code).toBe('not_found');
    expect(bed.world.unlockLocation('missing_location').code).toBe('not_found');
  });

  it('lists only unlocked exterior travel destinations', () => {
    const bed = createWorldTestBed();
    const destinations = bed.world.getUnlockedTravelDestinations();
    expect(destinations).toHaveLength(42);
    expect(destinations).toContain(LOC.home);
    expect(destinations).toContain(LOC.highStreet);
    expect(destinations).not.toContain(LOC.hiddenGarden);
    expect(destinations).not.toContain(LOC.secretPath);
    expect(destinations).not.toContain(LOC.ancientWell);
    expect(destinations).not.toContain(interiorIdFor(LOC.home));
    expect([...destinations].sort()).toEqual(destinations);
  });

  it('exposes a walk path helper from the current location', () => {
    const bed = createWorldTestBed();
    bed.world.travelTo(LOC.home);
    const path = bed.world.getPathTo(LOC.center);
    expect(path).not.toBeNull();
    expect(path?.[0]).toBe(LOC.home);
    expect(path?.[path.length - 1]).toBe(LOC.center);
  });
});

describe('WorldSystem: train transport', () => {
  function bedAtWillowbrookStation() {
    const bed = createWorldTestBed();
    placePlayer(bed, interiorIdFor(LOC.trainStation));
    bed.clock.setSimTimeSeconds(6 * SIM_SECONDS_PER_HOUR);
    bed.world.update(0);
    return bed;
  }

  it('builds a sorted timetable from the station interior and exterior', () => {
    const bed = bedAtWillowbrookStation();
    const fromInterior = bed.world.getTrainSchedule(interiorIdFor(LOC.trainStation));
    const fromExterior = bed.world.getTrainSchedule(LOC.trainStation);
    expect(fromInterior).toHaveLength(11);
    expect(fromExterior).toHaveLength(11);
    for (let i = 1; i < fromInterior.length; i += 1) {
      const previous = fromInterior[i - 1];
      const current = fromInterior[i];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      if (previous && current) expect(current.departSimTime).toBeGreaterThanOrEqual(previous.departSimTime);
    }
    const first = fromInterior[0];
    expect(first).toBeDefined();
    if (first) {
      expect(first.departSimTime).toBe(6 * SIM_SECONDS_PER_HOUR);
      expect(first.minutesUntil).toBe(0);
      expect(first.fromLocationId).toBe(LOC.trainStation);
      expect(first.toLocationId).toBe(LOC.ashfordTrainStation);
      expect(first.arriveSimTime).toBe(first.departSimTime + 32);
    }
    expect(bed.world.getTrainSchedule(LOC.trainStation, LOC.ashfordTrainStation)).toHaveLength(11);
    expect(bed.world.getTrainSchedule(LOC.cafe)).toHaveLength(0);
    expect(bed.world.getTrainRoutes()).toHaveLength(4);
    expect(bed.world.getTrainSchedule(LOC.trainStation)[0]?.routeId).toBe('train_willowbrook_ashford_local');
  });

  it('runs the full ticket lifecycle: buy, board, ride, arrive', () => {
    const bed = bedAtWillowbrookStation();
    const departure = bed.world.getTrainSchedule(LOC.trainStation)[0];
    expect(departure).toBeDefined();
    if (!departure) return;
    bed.clock.setSimTimeSeconds(departure.departSimTime - 20);
    bed.world.update(0);

    const moneyBefore = bed.state.player.money;
    const bought = bed.world.buyTrainTicket(departure.routeId);
    expect(bought.ok).toBe(true);
    expect(bought.stateChanged).toBe(true);
    expect(bed.state.player.money).toBe(moneyBefore - departure.pricePence);
    const moneyEvents = bed.eventsFor('money:changed') as { amount: number; balance: number }[];
    expect(moneyEvents.length).toBe(1);
    expect(moneyEvents[0]?.amount).toBe(-departure.pricePence);
    expect(moneyEvents[0]?.balance).toBe(bed.state.player.money);
    const tickets = bed.world.transport.getTickets();
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.used).toBe(false);
    expect(tickets[0]?.departSimTime).toBe(departure.departSimTime);

    const boarded = bed.world.boardTrain();
    expect(boarded.ok).toBe(true);
    expect(bed.world.transport.getRideStatus()).toBe('waiting');
    // Cannot walk away while the train is moving, but can step off the platform before departure.
    expect(bed.world.travelTo(LOC.trainStation).ok).toBe(true);
    expect(bed.world.transport.getRideStatus()).toBe('none');

    // Board again and ride to the other city.
    expect(bed.world.boardTrain().ok).toBe(true);
    bed.clock.setSimTimeSeconds(departure.departSimTime);
    bed.world.update(0);
    expect(bed.world.transport.getRideStatus()).toBe('riding');
    expect(bed.world.travelTo(LOC.center).code).toBe('busy');

    bed.clock.setSimTimeSeconds(departure.departSimTime + 10);
    bed.world.update(0);
    expect(bed.world.getCurrentLocationId()).toBe(LOC.trainStation);
    expect(bed.world.transport.getRideStatus()).toBe('riding');

    bed.clock.setSimTimeSeconds(departure.arriveSimTime + 1);
    bed.world.update(0);
    expect(bed.world.getCurrentLocationId()).toBe(LOC.ashfordTrainStation);
    expect(bed.world.transport.getRideStatus()).toBe('none');
    expect(bed.world.transport.getActiveRide()).toBeNull();
    expect(bed.world.transport.getTickets().every((ticket) => ticket.used)).toBe(true);
    expect(bed.world.transport.getTickets()[0]?.departSimTime).toBe(departure.departSimTime);
    expect(bed.state.world.transport.lastArrivalAt).toBe(departure.arriveSimTime + 1);
    const locationChanges = bed.eventsFor('location:changed') as { to: string; from: string | null }[];
    expect(locationChanges[locationChanges.length - 1]?.to).toBe(LOC.ashfordTrainStation);
    expect(bed.state.world.history.some((entry) => entry.description.includes('Arrived by train'))).toBe(true);
    expect(bed.state.world.locations[LOC.ashfordTrainStation]?.visitCount).toBe(1);
  });

  it('rejects buying a ticket away from the station or without money', () => {
    const bed = createWorldTestBed();
    placePlayer(bed, LOC.home);
    expect(bed.world.buyTrainTicket('train_willowbrook_ashford_local').code).toBe('wrong_location');

    placePlayer(bed, LOC.trainStation);
    bed.state.player.money = 10;
    expect(bed.world.buyTrainTicket('train_willowbrook_ashford_local').code).toBe('not_enough_money');
    expect(bed.world.buyTrainTicket('missing_route').code).toBe('not_found');
  });

  it('rejects boarding with no valid ticket in the window', () => {
    const bed = bedAtWillowbrookStation();
    expect(bed.world.boardTrain().code).toBe('wrong_time');
    placePlayer(bed, LOC.cafe);
    expect(bed.world.boardTrain().code).toBe('wrong_location');
  });

  it('rejects buying a second ticket while busy', () => {
    const bed = bedAtWillowbrookStation();
    const departure = bed.world.getTrainSchedule(LOC.trainStation)[0];
    expect(departure).toBeDefined();
    if (!departure) return;
    bed.clock.setSimTimeSeconds(departure.departSimTime - 20);
    expect(bed.world.buyTrainTicket(departure.routeId).ok).toBe(true);
    expect(bed.world.boardTrain().ok).toBe(true);
    expect(bed.world.buyTrainTicket(departure.routeId).code).toBe('busy');
  });

  it('supports direction-specific schedules from Ashford', () => {
    const bed = createWorldTestBed();
    placePlayer(bed, interiorIdFor(LOC.ashfordTrainStation));
    bed.clock.setSimTimeSeconds(8 * SIM_SECONDS_PER_HOUR);
    bed.world.update(0);
    const schedule = bed.world.getTrainSchedule(LOC.ashfordTrainStation);
    expect(schedule.length).toBe(11);
    expect(schedule.every((entry) => entry.fromLocationId === LOC.ashfordTrainStation)).toBe(true);
    expect(schedule.every((entry) => entry.toLocationId === LOC.trainStation)).toBe(true);
    expect(schedule[0]?.departSimTime).toBe(8 * SIM_SECONDS_PER_HOUR);
  });
});

describe('WorldSystem: history, conditions and occupancy', () => {
  it('caps world history deterministically and keeps ids unique', () => {
    const bed = createWorldTestBed();
    const world = bed.state.world;
    const baseLength = world.history.length;
    for (let i = 0; i < 900; i += 1) {
      addWorldHistory(world, {
        at: bed.clock.simTimeSeconds + i,
        category: 'world',
        description: 'test entry ' + i,
      });
    }
    expect(world.history).toHaveLength(800);
    const ids = world.history.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(world.history[world.history.length - 1]?.description).toBe('test entry 899');
    expect(getRecentWorldHistory(world, 3).length).toBe(3);
    expect(baseLength).toBeGreaterThan(0);

    world.history.push({
      id: 'manual_0',
      at: 0,
      category: 'world',
      description: 'manual',
      importance: 1,
      participantIds: [],
    });
    expect(world.history.length).toBe(801);
    trimWorldHistory(world);
    expect(world.history.length).toBe(800);
  });

  it('decays location condition once per elapsed day', () => {
    const bed = createWorldTestBed();
    const before = bed.state.world.locations[LOC.center]?.condition ?? 1;
    bed.clock.advanceSimSeconds(SIM_SECONDS_PER_DAY);
    bed.world.update(SIM_SECONDS_PER_DAY);
    const after = bed.state.world.locations[LOC.center]?.condition ?? 1;
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
    for (const location of bed.world.getAllLocations()) {
      expect(location.condition).toBeGreaterThanOrEqual(0.05);
      expect(location.condition).toBeLessThanOrEqual(1);
    }
  });

  it('recomputes NPC occupancy at most every five in-game minutes', () => {
    const bed = createWorldTestBed();
    bed.state.npcs['npc_test'] = createTestNpc('npc_test', LOC.center);
    bed.world.refreshOccupants();
    expect(bed.state.world.locations[LOC.center]?.occupants).toContain('npc_test');

    const npc = bed.state.npcs['npc_test'];
    expect(npc).toBeDefined();
    if (!npc) return;
    npc.locationId = LOC.park;
    advanceSimSeconds(bed, 2);
    expect(bed.state.world.locations[LOC.center]?.occupants).toContain('npc_test');
    advanceSimSeconds(bed, 3);
    expect(bed.state.world.locations[LOC.center]?.occupants ?? []).not.toContain('npc_test');
    expect(bed.state.world.locations[LOC.park]?.occupants).toContain('npc_test');
  });

  it('keeps history entries well-formed', () => {
    const bed = createWorldTestBed();
    for (const entry of bed.state.world.history) {
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.importance).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(entry.at)).toBe(true);
      expect(Array.isArray(entry.participantIds)).toBe(true);
    }
  });
});

describe('WorldSystem: deterministic environment', () => {
  it('reproduces identical environments for the same seed and sequence', () => {
    const run = (): string => {
      const bed = createWorldTestBed({ seed: 20241119 });
      advanceGameHours(bed, 72);
      return JSON.stringify({
        environment: bed.world.getEnvironment(),
        history: bed.state.world.history.map((entry) => entry.description),
      });
    };
    expect(run()).toBe(run());
  });

  it('diverges for a different seed', () => {
    const run = (seed: number): string => {
      const bed = createWorldTestBed({ seed });
      advanceGameHours(bed, 72);
      return JSON.stringify(bed.world.getEnvironment());
    };
    expect(run(111)).not.toBe(run(222));
  });

  it('keeps the environment numerically sane across a week', () => {
    const bed = createWorldTestBed({ seed: 5150 });
    advanceGameHours(bed, 24 * 7);
    const env = bed.world.getEnvironment();
    expect(Number.isFinite(env.temperature)).toBe(true);
    expect(env.temperature).toBeGreaterThan(-30);
    expect(env.temperature).toBeLessThan(45);
    expect(env.humidity).toBeGreaterThanOrEqual(0);
    expect(env.humidity).toBeLessThanOrEqual(1);
    expect(env.daylight).toBeGreaterThanOrEqual(0);
    expect(env.daylight).toBeLessThanOrEqual(1);
    expect(env.nextWeatherChangeAt).toBeGreaterThan(bed.clock.simTimeSeconds);
    expect(bed.clock.simTimeSeconds).toBeGreaterThan(0);
    expect(WEATHER_TRANSITION_INTERVAL_HOURS).toBe(4);
    expect(bed.world.getEnvironment().recentWeather.length).toBeLessThanOrEqual(10);
    expect(capturedTopics(bed)).toContain('weather:changed');
  });

  it('keeps weather state coherent with its profiles', () => {
    const bed = createWorldTestBed({ seed: 8 });
    advanceGameHours(bed, 24 * 3);
    const env = bed.world.getEnvironment();
    const weather: WeatherType = env.weather;
    if (weather === 'clear') {
      expect(env.rainIntensity).toBe(0);
      expect(env.fogDensity).toBe(0);
    }
    if (weather === 'storm') {
      expect(env.rainIntensity).toBeGreaterThan(0.9);
    }
    expect(env.previousWeather).toBeDefined();
  });
});
