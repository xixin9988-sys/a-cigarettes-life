import { describe, expect, it } from 'vitest';
import {
  CAFE_INTERIOR,
  HOUR,
  advanceHours,
  businessFor,
  createScenario,
  eventsOf,
  jobFor,
  jobsFor,
  placePlayer,
  setClock,
} from './harness';
import { BIZ } from '../../src/data/shops/ids';
import { LOC } from '../../src/data/locations/ids';
import { NPC } from '../../src/data/npcs/ids';
import { interiorIdFor } from '../../src/data/locations/ids';

const RESTAURANT_INTERIOR = interiorIdFor(LOC.restaurant);

describe('EmploymentSystem: NPC staffing', () => {
  it('links NPC employees to jobs and businesses from their work locations', () => {
    const scenario = createScenario({ startSimTime: 9 * HOUR });
    let staffedJobs = 0;
    let totalEmployees = 0;
    for (const business of scenario.economy.getBusinesses()) {
      const seen = new Set<string>();
      for (const employeeId of business.employees) {
        expect(seen.has(employeeId), 'duplicate employee ' + employeeId).toBe(false);
        seen.add(employeeId);
        const npc = scenario.state.npcs[employeeId];
        expect(npc, 'employee exists ' + employeeId).toBeDefined();
        expect(npc?.jobId).not.toBeNull();
        const job = npc?.jobId ? scenario.state.economy.jobs[npc.jobId] : undefined;
        expect(job?.businessId, 'job belongs to the business').toBe(business.id);
        expect(job?.employeeIds, 'job lists the employee').toContain(employeeId);
        totalEmployees += 1;
      }
      if (business.ownerNpcId) {
        expect(business.employees, business.id + ' pays owner as employee').not.toContain(business.ownerNpcId);
        const owner = scenario.state.npcs[business.ownerNpcId];
        expect(owner?.jobId ?? null, business.id + ' owner job').toBeNull();
      }
      for (const job of jobsFor(scenario, business.id)) {
        if (job.employeeIds.length > 0) staffedJobs += 1;
        for (const npcId of job.employeeIds) {
          expect(scenario.state.npcs[npcId]?.jobId).toBe(job.id);
        }
      }
    }
    expect(totalEmployees).toBeGreaterThan(10);
    expect(staffedJobs).toBeGreaterThan(8);
  });
});

describe('EmploymentSystem: player jobs', () => {
  it('applies for a job only when present, open and skilled enough', () => {
    const scenario = createScenario({ startSimTime: 9 * HOUR });
    const waiter = jobFor(scenario, BIZ.willowCafe, 1);
    expect(waiter.playerAvailable).toBe(true);
    expect(waiter.employeeIds.length).toBeLessThan(waiter.slots);

    const fromHome = scenario.economy.applyForJob(waiter.id);
    expect(fromHome.ok).toBe(false);
    expect(fromHome.code).toBe('wrong_location');

    placePlayer(scenario, CAFE_INTERIOR);
    scenario.clock.setSimTimeSeconds(23 * HOUR);
    scenario.economy.update(0);
    const closed = scenario.economy.applyForJob(waiter.id);
    expect(closed.ok).toBe(false);
    expect(closed.code).toBe('wrong_time');

    const reopened = createScenario({ playerLocationId: CAFE_INTERIOR, startSimTime: 9 * HOUR });
    const waiter2 = jobFor(reopened, BIZ.willowCafe, 1);
    const applied = reopened.economy.applyForJob(waiter2.id);
    expect(applied.ok).toBe(true);
    expect(reopened.state.player.jobId).toBe(waiter2.id);
    expect(reopened.state.player.occupation).toBe('Waiter');
    expect(waiter2.isPlayerJob).toBe(true);
    expect(eventsOf(reopened, 'game:signal').some((event) => (event.payload as { name: string }).name === 'economy:job_started')).toBe(true);

    const again = reopened.economy.applyForJob(waiter2.id);
    expect(again.ok).toBe(true);

    const otherJob = jobFor(reopened, BIZ.willowBookshop, 0);
    const busy = reopened.economy.applyForJob(otherJob.id);
    expect(busy.ok).toBe(false);
    expect(busy.code).toBe('busy');
  });

  it('rejects owner-only jobs, full positions and low-skill applicants', () => {
    const scenario = createScenario({ playerLocationId: interiorIdFor(LOC.cityCafe), startSimTime: 9 * HOUR });
    const manager = jobsFor(scenario, BIZ.ashfordCafe).find((job) => job.title === 'Assistant Manager');
    expect(manager?.playerAvailable).toBe(false);
    const ownerOnly = scenario.economy.applyForJob(manager?.id ?? '');
    expect(ownerOnly.ok).toBe(false);
    expect(ownerOnly.code).toBe('not_allowed');

    const full = createScenario({ playerLocationId: CAFE_INTERIOR, startSimTime: 9 * HOUR });
    const barista = jobFor(full, BIZ.willowCafe, 0);
    expect(barista.employeeIds.length).toBe(barista.slots);
    const noRoom = full.economy.applyForJob(barista.id);
    expect(noRoom.ok).toBe(false);
    expect(noRoom.code).toBe('capacity_reached');

    const restaurant = createScenario({ playerLocationId: RESTAURANT_INTERIOR, startSimTime: 13 * HOUR });
    const chef = jobsFor(restaurant, BIZ.ashfordRestaurant).find((job) => job.title === 'Chef');
    expect(chef?.levelReq).toBe(3);
    if (chef) chef.employeeIds.length = 0; // make sure the position is free for the skill check
    const underqualified = restaurant.economy.applyForJob(chef?.id ?? '');
    expect(underqualified.ok).toBe(false);
    expect(underqualified.code).toBe('skill_too_low');
  });

  it('works a paid hour, once per game hour, only during the shift', () => {
    const scenario = createScenario({ playerLocationId: CAFE_INTERIOR, startSimTime: 11 * HOUR });
    const waiter = jobFor(scenario, BIZ.willowCafe, 1);
    expect(scenario.economy.applyForJob(waiter.id).ok).toBe(true);
    const business = businessFor(scenario, BIZ.willowCafe);

    const moneyBefore = scenario.state.player.money;
    const businessMoneyBefore = business.money;
    const firstShift = scenario.economy.workShift();
    expect(firstShift.ok).toBe(true);
    expect(scenario.state.player.money).toBe(moneyBefore + waiter.wagePerHour);
    expect(business.money).toBe(businessMoneyBefore - waiter.wagePerHour);
    expect(scenario.state.player.statistics.shiftsWorked).toBe(1);
    const wageRecord = scenario.state.economy.transactions.at(-1);
    expect(wageRecord?.type).toBe('wage');
    expect(wageRecord?.totalPrice).toBe(waiter.wagePerHour);
    expect(
      eventsOf(scenario, 'game:signal').some((event) => (event.payload as { name: string }).name === 'economy:shift_worked')
    ).toBe(true);

    const secondCallSameHour = scenario.economy.workShift();
    expect(secondCallSameHour.ok).toBe(false);
    expect(secondCallSameHour.code).toBe('on_cooldown');

    advanceHours(scenario, 1); // 12:00: a new hour can be worked
    const secondShift = scenario.economy.workShift();
    expect(secondShift.ok).toBe(true);
    expect(scenario.state.player.statistics.shiftsWorked).toBe(2);

    placePlayer(scenario, interiorIdFor(LOC.home));
    setClock(scenario, 13 * HOUR);
    const awayFromWork = scenario.economy.workShift();
    expect(awayFromWork.ok).toBe(false);
    expect(awayFromWork.code).toBe('wrong_location');

    const evening = createScenario({ playerLocationId: CAFE_INTERIOR, startSimTime: 19 * HOUR });
    const waiterEvening = jobFor(evening, BIZ.willowCafe, 1);
    evening.state.player.jobId = waiterEvening.id;
    evening.state.player.occupation = waiterEvening.title;
    waiterEvening.isPlayerJob = true;
    const outsideShift = evening.economy.workShift();
    expect(outsideShift.ok).toBe(false);
    expect(outsideShift.code).toBe('wrong_time');
  });

  it('refuses to pay wages a business cannot afford', () => {
    const scenario = createScenario({ playerLocationId: CAFE_INTERIOR, startSimTime: 11 * HOUR });
    const waiter = jobFor(scenario, BIZ.willowCafe, 1);
    expect(scenario.economy.applyForJob(waiter.id).ok).toBe(true);
    const business = businessFor(scenario, BIZ.willowCafe);
    business.money = 10;
    const broke = scenario.economy.workShift();
    expect(broke.ok).toBe(false);
    expect(broke.code).toBe('not_enough_money');
    expect(business.money).toBe(10);
    expect(scenario.state.player.jobId).toBe(waiter.id);
  });

  it('quits cleanly and cannot work or apply at a business the player owns', () => {
    const scenario = createScenario({ playerLocationId: CAFE_INTERIOR, startSimTime: 11 * HOUR });
    const waiter = jobFor(scenario, BIZ.willowCafe, 1);
    expect(scenario.economy.applyForJob(waiter.id).ok).toBe(true);
    const quit = scenario.economy.quitJob();
    expect(quit.ok).toBe(true);
    expect(scenario.state.player.jobId).toBeNull();
    expect(scenario.state.player.occupation).toBeNull();
    expect(waiter.isPlayerJob).toBe(false);
    const quitAgain = scenario.economy.quitJob();
    expect(quitAgain.ok).toBe(false);
    expect(quitAgain.code).toBe('not_allowed');

    const buyer = createScenario({ playerLocationId: interiorIdFor(LOC.grocery), startSimTime: 10 * HOUR });
    buyer.state.player.money = 500000;
    expect(buyer.economy.buyPlayerShop(BIZ.willowGrocery).ok).toBe(true);
    const cashier = jobsFor(buyer, BIZ.willowGrocery).find((job) => job.title === 'Cashier');
    const ownBusiness = buyer.economy.applyForJob(cashier?.id ?? '');
    expect(ownBusiness.ok).toBe(false);
    expect(ownBusiness.code).toBe('not_allowed');
    expect(buyer.economy.workShift().ok).toBe(false);
  });
});