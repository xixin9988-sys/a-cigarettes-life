import type {
  ActionResult,
  BusinessState,
  IGameContext,
  JobState,
  NPCState,
  PlayerShopState,
} from '../core/contracts';
import type { NPCId } from '../core/SharedTypes';
import type { ISkillSystem } from '../core/contracts';
import { formatMoney } from '../core/format';
import { isWithinHours } from '../core/TimeUtil';
import {
  actionFail,
  actionOk,
  adjustPlayerMoney,
  businessOpenAt,
  businessTypeOf,
  emitSignal,
  finiteNumber,
  HOUR_SIM_SECONDS,
  hourOfDayAt,
  locationsEquivalent,
  money,
  playerAtBusiness,
  pushTransaction,
  safePence,
} from './EconomyHelpers';
/** Skill XP granted by a completed work shift (only when the skill system is registered). */
const WORK_SHIFT_SKILL_XP = 4;

/** Default hourly wage by business type, used only when a business definition has no jobs. */
const DEFAULT_WAGE_BY_TYPE: Readonly<Record<string, number>> = {
  cafe: 950,
  bakery: 1100,
  flower_shop: 880,
  grocery: 900,
  bookshop: 920,
  post_office: 900,
  library: 950,
  market_stall: 880,
  restaurant: 1000,
  supermarket: 900,
  convenience_store: 870,
  clothing_shop: 880,
  furniture_shop: 900,
  electronics_shop: 940,
  cinema: 850,
  museum: 1050,
  farm: 900,
  player_shop: 900,
};

/**
 * Jobs, wages and staffing. init rebuilds NPC employee links from their work locations,
 * the player applies/quits/works shifts, and daily settlement pays every NPC employee.
 * All money movements are integer pence and clamped so no balance can go negative.
 */
export class EmploymentSystem {
  constructor(private readonly ctx: IGameContext) {}

  /** Rebuilds job/employee links deterministically. Idempotent: safe to run on every load. */
  rebuildAssignments(now: number): void {
    void now;
    const state = this.ctx.state;
    const economy = state.economy;
    const jobs = Object.values(economy.jobs);

    // 1. Owners + reset of derived employee lists.
    for (const business of Object.values(economy.businesses)) {
      const def = this.ctx.content.getBusiness(business.id);
      const declaredOwner = def?.ownerNpcId ?? business.ownerNpcId;
      if (declaredOwner) {
        const owner = state.npcs[declaredOwner];
        business.ownerNpcId = owner && owner.alive ? owner.id : null;
      } else {
        business.ownerNpcId = null;
      }
      business.employees = [];
    }
    for (const job of jobs) job.employeeIds = [];

    // 2. Honour job ids already assigned by the NPC system.
    for (const npc of Object.values(state.npcs)) {
      if (!npc.alive || !npc.jobId) continue;
      const job = economy.jobs[npc.jobId];
      if (!job) {
        npc.jobId = null;
        continue;
      }
      const business = economy.businesses[job.businessId];
      if (!business || business.ownerNpcId === npc.id) {
        npc.jobId = null;
        continue;
      }
      if (job.employeeIds.length >= job.slots) {
        npc.jobId = null;
        continue;
      }
      this.linkNpc(npc, job);
    }

    // 3. Fill remaining slots with NPCs whose workplace matches the business location.
    const candidates = Object.values(state.npcs)
      .filter((npc) => npc.alive && !npc.jobId)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const job of jobs) {
      const business = economy.businesses[job.businessId];
      if (!business) continue;
      let needed = Math.max(0, job.slots - job.employeeIds.length);
      if (needed === 0) continue;
      for (const npc of candidates) {
        if (needed <= 0) break;
        if (npc.jobId) continue;
        if (business.ownerNpcId === npc.id) continue;
        if (!locationsEquivalent(npc.workLocationId, business.locationId)) continue;
        this.linkNpc(npc, job);
        needed -= 1;
      }
    }
  }

  getJobs(): JobState[] {
    return Object.values(this.ctx.state.economy.jobs);
  }

  getJobsAtLocation(locationId: string): JobState[] {
    return this.getJobs().filter((job) => {
      const business = this.ctx.state.economy.businesses[job.businessId];
      return business ? locationsEquivalent(business.locationId, locationId) : false;
    });
  }

  getPlayerJob(): JobState | null {
    const player = this.ctx.state.player;
    if (!player.jobId) return null;
    return this.ctx.state.economy.jobs[player.jobId] ?? null;
  }

  /** Applies for a job at the player current location. */
  applyForJob(jobId: string): ActionResult {
    const state = this.ctx.state;
    const player = state.player;
    const job = state.economy.jobs[jobId];
    if (!job) return actionFail('not_found', 'That job does not exist.');
    const business = state.economy.businesses[job.businessId];
    if (!business) return actionFail('not_found', 'That workplace no longer exists.');
    if (!job.playerAvailable) return actionFail('not_allowed', 'That position is not open to new staff.');
    if (business.isPlayerOwned) return actionFail('not_allowed', 'You already own this business.');
    if (player.jobId === job.id) return actionOk('You already work here as ' + job.title + '.');
    if (player.jobId) {
      const current = state.economy.jobs[player.jobId];
      return actionFail(
        'busy',
        'You already work as ' + (current?.title ?? 'somewhere else') + ' — quit that job first.'
      );
    }
    if (job.employeeIds.length >= job.slots) {
      return actionFail('capacity_reached', 'All ' + job.slots + ' ' + job.title + ' positions are already taken.');
    }
    if (!businessOpenAt(business, businessTypeOf(this.ctx, business), this.ctx.clock.simTimeSeconds)) {
      return actionFail('wrong_time', business.name + ' is closed — come back during opening hours to ask about work.');
    }
    if (!playerAtBusiness(this.ctx, business)) {
      return actionFail('wrong_location', 'You need to be at ' + business.name + ' to apply for work.');
    }
    if (job.skill) {
      const level = player.skills[job.skill]?.level ?? 1;
      if (level < job.levelReq) {
        return actionFail(
          'skill_too_low',
          'This ' + job.title + ' position needs ' + job.skill + ' level ' + job.levelReq + ' (you are level ' + level + ').'
        );
      }
    }

    player.jobId = job.id;
    player.occupation = job.title;
    job.isPlayerJob = true;
    emitSignal(this.ctx, 'economy:job_started', { jobId: job.id, title: job.title, businessId: business.id });
    return actionOk(
      'You are hired as ' + job.title + ' at ' + business.name + ' — ' + money(job.wagePerHour) + ' per hour.',
      { jobId: job.id, wagePerHour: job.wagePerHour }
    );
  }

  quitJob(): ActionResult {
    const state = this.ctx.state;
    const player = state.player;
    if (!player.jobId) return actionFail('not_allowed', 'You are not employed at the moment.');
    const job = state.economy.jobs[player.jobId];
    const title = job?.title ?? player.occupation ?? 'your job';
    if (job) job.isPlayerJob = false;
    player.jobId = null;
    player.occupation = null;
    emitSignal(this.ctx, 'economy:job_quit', { jobId: job?.id ?? null, title });
    return actionOk('You quit your job as ' + title + '.');
  }

  /** Works exactly one paid game hour. Requires being at the workplace during the shift. */
  workShift(): ActionResult {
    const state = this.ctx.state;
    const player = state.player;
    const job = this.getPlayerJob();
    if (!job) return actionFail('not_allowed', 'You are not employed at the moment.');
    const business = state.economy.businesses[job.businessId];
    if (!business) return actionFail('not_found', 'Your workplace no longer exists.');
    if (business.isPlayerOwned) return actionFail('not_allowed', 'You own this business — owners do not clock in.');
    const now = this.ctx.clock.simTimeSeconds;
    const hour = hourOfDayAt(now);
    if (!isWithinHours(hour, job.startHour, job.endHour)) {
      return actionFail(
        'wrong_time',
        'Your shift runs ' + this.hourLabel(job.startHour) + ' to ' + this.hourLabel(job.endHour) + '.'
      );
    }
    if (!playerAtBusiness(this.ctx, business)) {
      return actionFail('wrong_location', 'You need to be at ' + business.name + ' for your shift.');
    }
    if (job.lastWorkedAt > 0 && Math.floor(now / HOUR_SIM_SECONDS) === Math.floor(job.lastWorkedAt / HOUR_SIM_SECONDS)) {
      return actionFail('on_cooldown', 'You have already worked this hour — come back next hour.');
    }
    const wage = Math.max(1, safePence(job.wagePerHour));
    if (business.money < wage) {
      return actionFail(
        'not_enough_money',
        business.name + ' cannot cover a full hour of wages right now (till: ' + formatMoney(business.money) + ').'
      );
    }

    business.money = Math.max(0, Math.round(business.money - wage));
    business.dailyExpenses += wage;
    job.lastWorkedAt = now;
    player.occupation = job.title;
    player.statistics.shiftsWorked += 1;
    adjustPlayerMoney(this.ctx, wage, 'Wages from ' + business.name);
    pushTransaction(this.ctx, {
      at: now,
      type: 'wage',
      actorId: player.id,
      businessId: business.id,
      itemId: null,
      quantity: 1,
      unitPrice: wage,
      totalPrice: wage,
      note: 'Hourly wage as ' + job.title + ' at ' + business.name,
    });
    if (job.skill) {
      const skillSystem = this.ctx.registry.get<ISkillSystem>('skill');
      if (skillSystem) skillSystem.addXp(job.skill, WORK_SHIFT_SKILL_XP, 'shift:' + job.title);
    }
    emitSignal(this.ctx, 'economy:shift_worked', {
      jobId: job.id,
      businessId: business.id,
      wage,
      workedAt: now,
    });
    return actionOk(
      'You worked an hour as ' + job.title + ' and earned ' + formatMoney(wage) + '.',
      { wage, businessId: business.id, jobId: job.id }
    );
  }

  /**
   * Pays one day of NPC wages for a single business. Shortfalls are paid in order and the
   * till is never overdrawn; a single aggregate wage transaction is recorded per business.
   */
  payBusinessWages(business: BusinessState, now: number): number {
    const ledger: { npc: NPCState; wage: number; jobTitle: string }[] = [];
    for (const job of Object.values(this.ctx.state.economy.jobs)) {
      if (job.businessId !== business.id) continue;
      for (const npcId of job.employeeIds) {
        const npc = this.ctx.state.npcs[npcId];
        if (!npc || !npc.alive) continue;
        ledger.push({ npc, wage: Math.max(1, safePence(job.wagePerHour)), jobTitle: job.title });
      }
    }
    let remaining = Math.max(0, Math.round(business.money));
    let paid = 0;
    for (const line of ledger) {
      if (remaining <= 0) break;
      const pay = Math.min(line.wage, remaining);
      if (pay <= 0) continue;
      line.npc.money = Math.max(0, Math.round(line.npc.money + pay));
      remaining -= pay;
      paid += pay;
      line.npc.occupation = line.jobTitle;
    }
    business.money = remaining;
    business.dailyExpenses += paid;
    if (paid > 0) {
      pushTransaction(this.ctx, {
        at: now,
        type: 'wage',
        actorId: business.ownerNpcId ?? business.id,
        businessId: business.id,
        itemId: null,
        quantity: ledger.length,
        unitPrice: Math.round(paid / Math.max(1, ledger.length)),
        totalPrice: paid,
        note: 'Daily wages at ' + business.name,
      });
    }
    return paid;
  }

  /** Pays wages for the player's shop employees (cap 3) from the shop till. */
  payPlayerShopWages(business: BusinessState, employees: PlayerShopState['employees'], now: number): number {
    let remaining = Math.max(0, Math.round(business.money));
    let paid = 0;
    for (const employee of employees) {
      const npc = this.ctx.state.npcs[employee.npcId];
      if (!npc || !npc.alive) continue;
      if (remaining <= 0) break;
      const wage = Math.max(1, safePence(employee.wagePerHour));
      const pay = Math.min(wage, remaining);
      npc.money = Math.max(0, Math.round(npc.money + pay));
      remaining -= pay;
      paid += pay;
    }
    business.money = remaining;
    business.dailyExpenses += paid;
    if (paid > 0) {
      pushTransaction(this.ctx, {
        at: now,
        type: 'wage',
        actorId: this.ctx.state.player.id,
        businessId: business.id,
        itemId: null,
        quantity: employees.length,
        unitPrice: Math.round(paid / Math.max(1, employees.length)),
        totalPrice: paid,
        note: 'Daily wages at ' + business.name,
      });
    }
    return paid;
  }

  /** Wage offered at a business: first player-available job, else the first job, else type default. */
  wageForBusiness(businessId: string): number {
    const jobs = Object.values(this.ctx.state.economy.jobs).filter((job) => job.businessId === businessId);
    const preferred = jobs.find((job) => job.playerAvailable) ?? jobs[0];
    if (preferred) return Math.max(1, safePence(preferred.wagePerHour));
    const business = this.ctx.state.economy.businesses[businessId];
    const type = business ? businessTypeOf(this.ctx, business) : 'cafe';
    return Math.max(1, Math.round(DEFAULT_WAGE_BY_TYPE[type] ?? 900));
  }

  /** Links an NPC to a job (also used by player-shop hiring). */
  linkNpc(npc: NPCState, job: JobState): void {
    npc.jobId = job.id;
    npc.occupation = job.title;
    if (!job.employeeIds.includes(npc.id)) job.employeeIds.push(npc.id);
    const business = this.ctx.state.economy.businesses[job.businessId];
    if (business && !business.employees.includes(npc.id)) business.employees.push(npc.id);
  }

  /** Removes an NPC from whatever job/business they currently hold. */
  unlinkNpc(npcId: NPCId): void {
    const state = this.ctx.state;
    const npc = state.npcs[npcId];
    for (const job of Object.values(state.economy.jobs)) {
      const index = job.employeeIds.indexOf(npcId);
      if (index >= 0) job.employeeIds.splice(index, 1);
    }
    for (const business of Object.values(state.economy.businesses)) {
      const index = business.employees.indexOf(npcId);
      if (index >= 0) business.employees.splice(index, 1);
    }
    if (npc) {
      npc.jobId = null;
      // Majors keep their professional identity when a shop job ends; residents reset.
      if (!npc.isMajor) npc.occupation = 'resident';
    }
  }

  private hourLabel(hour: number): string {
    return String(Math.floor(hour)).padStart(2, '0') + ':00';
  }
}

// Small re-exports kept local to avoid leaking unrelated helpers into consumers.