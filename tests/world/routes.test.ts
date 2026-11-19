import { describe, expect, it } from 'vitest';
import { TRAIN_ROUTES, LOCAL_TRAIN_DEPARTURE_HOURS, EXPRESS_TRAIN_DEPARTURE_HOURS } from '../../src/data/transport/routes';
import type { LocationId } from '../../src/core/SharedTypes';
import { LOCATIONS } from '../../src/data/locations/locations';
import { LOC } from '../../src/data/locations/ids';

const stationExteriors = new Set<LocationId>([LOC.trainStation, LOC.ashfordTrainStation]);

describe('train route data', () => {
  it('defines unique routes covering both directions', () => {
    expect(TRAIN_ROUTES.length).toBeGreaterThanOrEqual(4);
    const ids = TRAIN_ROUTES.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);

    const directions = new Set(TRAIN_ROUTES.map((route) => route.fromLocationId + '->' + route.toLocationId));
    expect(directions.size).toBe(2);
    expect(directions).toContain(LOC.trainStation + '->' + LOC.ashfordTrainStation);
    expect(directions).toContain(LOC.ashfordTrainStation + '->' + LOC.trainStation);
  });

  it('references real station exteriors', () => {
    const ids = new Set(LOCATIONS.map((def) => def.id));
    for (const route of TRAIN_ROUTES) {
      expect(stationExteriors.has(route.fromLocationId), route.id + ' from').toBe(true);
      expect(stationExteriors.has(route.toLocationId), route.id + ' to').toBe(true);
      expect(ids.has(route.fromLocationId)).toBe(true);
      expect(ids.has(route.toLocationId)).toBe(true);
      expect(route.name.length).toBeGreaterThan(5);
    }
  });

  it('runs local departures every two hours from 06:00 to 22:00', () => {
    expect([...LOCAL_TRAIN_DEPARTURE_HOURS]).toEqual([6, 8, 10, 12, 14, 16, 18, 20, 22]);
    for (const route of TRAIN_ROUTES.filter((candidate) => candidate.id.includes('local'))) {
      expect(route.departHours).toEqual([...LOCAL_TRAIN_DEPARTURE_HOURS]);
      for (const hour of route.departHours) {
        expect(hour).toBeGreaterThanOrEqual(6);
        expect(hour).toBeLessThanOrEqual(22);
      }
    }
  });

  it('includes a couple of express trips per direction', () => {
    const expressRoutes = TRAIN_ROUTES.filter((route) => route.id.includes('express'));
    expect(expressRoutes).toHaveLength(2);
    for (const route of expressRoutes) {
      expect(route.departHours).toEqual([...EXPRESS_TRAIN_DEPARTURE_HOURS]);
      expect(route.departHours).toHaveLength(2);
      for (const hour of route.departHours) {
        expect(hour).toBeGreaterThanOrEqual(6);
        expect(hour).toBeLessThanOrEqual(22);
      }
    }
  });

  it('keeps durations and fares inside the design range', () => {
    for (const route of TRAIN_ROUTES) {
      expect(route.durationMinutes, route.id + ' duration').toBeGreaterThanOrEqual(20);
      expect(route.durationMinutes, route.id + ' duration').toBeLessThanOrEqual(35);
      expect(route.pricePence, route.id + ' price').toBeGreaterThanOrEqual(350);
      expect(route.pricePence, route.id + ' price').toBeLessThanOrEqual(600);
      expect(Number.isInteger(route.pricePence)).toBe(true);
      expect(route.departHours.length).toBeGreaterThan(0);
    }
  });

  it('makes express trips faster and pricier than local ones', () => {
    const local = TRAIN_ROUTES.find((route) => route.id === 'train_willowbrook_ashford_local');
    const express = TRAIN_ROUTES.find((route) => route.id === 'train_willowbrook_ashford_express');
    expect(local).toBeDefined();
    expect(express).toBeDefined();
    if (local && express) {
      expect(express.durationMinutes).toBeLessThan(local.durationMinutes);
      expect(express.pricePence).toBeGreaterThan(local.pricePence);
    }
  });
});
