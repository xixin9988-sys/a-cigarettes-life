import type { TrainRouteDef } from '../schema';
import { LOC } from '../locations/ids';

/**
 * OWNER: Agent 4 (World & Map).
 *
 * Willowbrook <-> Ashford rail service.
 * Local trains leave every two hours from 06:00 to 22:00; two express trips
 * (07:00 and 17:00) skip the intermediate stop outside the region and take
 * roughly two thirds of the journey time for a premium fare.
 */
const LOCAL_DEPARTURE_HOURS: readonly number[] = [6, 8, 10, 12, 14, 16, 18, 20, 22];
const EXPRESS_DEPARTURE_HOURS: readonly number[] = [7, 17];

export const TRAIN_ROUTES: TrainRouteDef[] = [
  {
    id: 'train_willowbrook_ashford_local',
    fromLocationId: LOC.trainStation,
    toLocationId: LOC.ashfordTrainStation,
    departHours: [...LOCAL_DEPARTURE_HOURS],
    durationMinutes: 32,
    pricePence: 420,
    name: 'Willowbrook to Ashford (Local)',
  },
  {
    id: 'train_willowbrook_ashford_express',
    fromLocationId: LOC.trainStation,
    toLocationId: LOC.ashfordTrainStation,
    departHours: [...EXPRESS_DEPARTURE_HOURS],
    durationMinutes: 21,
    pricePence: 560,
    name: 'Willowbrook to Ashford (Express)',
  },
  {
    id: 'train_ashford_willowbrook_local',
    fromLocationId: LOC.ashfordTrainStation,
    toLocationId: LOC.trainStation,
    departHours: [...LOCAL_DEPARTURE_HOURS],
    durationMinutes: 33,
    pricePence: 420,
    name: 'Ashford to Willowbrook (Local)',
  },
  {
    id: 'train_ashford_willowbrook_express',
    fromLocationId: LOC.ashfordTrainStation,
    toLocationId: LOC.trainStation,
    departHours: [...EXPRESS_DEPARTURE_HOURS],
    durationMinutes: 20,
    pricePence: 560,
    name: 'Ashford to Willowbrook (Express)',
  },
];

/** Departure hours used by both local services; exported for UI rendering/tests. */
export const LOCAL_TRAIN_DEPARTURE_HOURS = LOCAL_DEPARTURE_HOURS;
export const EXPRESS_TRAIN_DEPARTURE_HOURS = EXPRESS_DEPARTURE_HOURS;
