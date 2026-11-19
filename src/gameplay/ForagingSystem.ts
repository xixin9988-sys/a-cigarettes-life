import type {
  ActionResult,
  ForageNodeState,
  IGameContext,
  IForagingSystem,
  ISkillSystem,
  IWorldSystem,
} from '../core/contracts';
import type { ForageNodeDef } from '../data/schema';
import type { QualityStars, SkillId } from '../core/SharedTypes';
import { SKILL_ACTIVITY_XP } from '../core/WorldConfig';
import { addItemToInventory } from '../core/InventoryUtil';
import { clamp, clamp01 } from '../core/utils';

/** One in-game hour in simulated seconds. */
// 1 simulated second = 1 in-game minute, so a game hour is 60 sim seconds.
const SECONDS_PER_GAME_HOUR = 60;
/** Weather types that make mushrooms flush and berries plump. */
const WET_WEATHERS: ReadonlySet<string> = new Set(['rain', 'storm', 'fog']);

function qualityStars(score: number): QualityStars {
  return clamp(1 + Math.floor(clamp01(score) * 4.999), 1, 5) as QualityStars;
}

/**
 * ForagingSystem (system id 'foraging') - seasonal wild gathering nodes.
 *
 * init() materialises one ForageNodeState per ForageNodeDef using the stable id
 * `<defId>:<index>`. Nodes are single-yield: gather() depletes the node and sets a
 * respawnAt timestamp derived from the definition's respawnHours, so the node thaws
 * back after real in-game time passes (including large offline catch-up steps).
 */
export class ForagingSystem implements IForagingSystem {
  readonly id = 'foraging';
  private ctx!: IGameContext;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    const nodes = ctx.state.foraging.nodes;
    const now = ctx.clock.simTimeSeconds;
    // Rebuild the node set from content. Existing persisted nodes win so saved
    // depletions/respawn timers survive load.
    ctx.content.pack.forageNodes.forEach((def, index) => {
      const nodeId = def.id + ':' + index;
      if (nodes[nodeId]) return;
      nodes[nodeId] = {
        id: nodeId,
        defId: def.id,
        locationId: def.locationId,
        depleted: false,
        respawnAt: 0,
        remaining: Math.max(1, def.yieldMax),
      };
    });
    for (const node of Object.values(nodes)) {
      if (node.respawnAt < 0) node.respawnAt = 0;
      if (!Number.isFinite(node.respawnAt)) node.respawnAt = 0;
      if (node.depleted && node.respawnAt <= now) {
        node.depleted = false;
        node.remaining = 1;
        node.respawnAt = 0;
      }
    }
    ctx.state.foraging.lastResetDay = Math.min(ctx.state.foraging.lastResetDay, ctx.clock.time.totalDays);
  }

  // -------------------------------------------------------------------------
  // Contract
  // -------------------------------------------------------------------------

  gather(nodeId: string): ActionResult {
    const now = this.ctx.clock.simTimeSeconds;
    const node = this.ctx.state.foraging.nodes[nodeId];
    if (!node) return { ok: false, code: 'not_found', message: 'Nothing here to gather.' };
    const def = this.ctx.content.getForageNode(node.defId);
    if (!def) return { ok: false, code: 'not_found', message: 'The plants here are not in the almanac.' };
    if (node.depleted && now < node.respawnAt) {
      const hoursLeft = Math.ceil((node.respawnAt - now) / SECONDS_PER_GAME_HOUR);
      return {
        ok: false,
        code: 'on_cooldown',
        message: def.name + ' will recover in about ' + hoursLeft + ' hour' + (hoursLeft === 1 ? '' : 's') + '.',
        data: { respawnAt: node.respawnAt, hoursLeft },
      };
    }
    if (node.depleted && now >= node.respawnAt) {
      node.depleted = false;
      node.remaining = 1;
      node.respawnAt = 0;
    }
    if (!this.isPlayerAt(node.locationId)) {
      return { ok: false, code: 'wrong_location', message: 'You must be at ' + this.locationName(node.locationId) + ' to gather this.' };
    }
    const environment = this.ctx.state.world.environment;
    if (!def.seasons.includes(environment.season)) {
      return { ok: false, code: 'wrong_time', message: def.name + ' is out of season in ' + environment.season + '.' };
    }
    const level = this.getSkillLevel('foraging');
    if (level < def.skillReq) {
      return {
        ok: false,
        code: 'skill_too_low',
        message: 'You need foraging level ' + def.skillReq + ' to find ' + def.name + '.',
        data: { required: def.skillReq, current: level },
      };
    }
    const itemDef = this.ctx.content.getItem(def.itemId);
    if (!itemDef) return { ok: false, code: 'not_found', message: 'The gathered item is unknown to the almanac.' };
    let quantity = this.ctx.probability.intRange('foraging.results', def.yieldMin, def.yieldMax);
    quantity += Math.floor(Math.max(0, level - def.skillReq) / 6);
    if (def.tags.includes('mushroom') && WET_WEATHERS.has(environment.weather)) quantity += 1;
    if (this.ctx.probability.chance('foraging.results', clamp01(0.1 + level * 0.012))) quantity += 1;
    quantity = Math.max(1, quantity);
    const roll = this.ctx.probability.roll('foraging.results');
    const levelFactor = clamp01((level - 1) / 19);
    const quality = qualityStars(0.22 + levelFactor * 0.45 + roll * 0.3);
    addItemToInventory(this.ctx.state.player.inventory, def.itemId, quantity, {
      quality: itemDef.hasQuality ? quality : 1,
      freshness: 1,
      simTime: now,
      maxStack: itemDef.maxStack,
    });
    node.depleted = true;
    node.remaining = 0;
    node.respawnAt = now + Math.max(1, def.respawnHours) * SECONDS_PER_GAME_HOUR;
    this.ctx.state.foraging.gatheredToday += quantity;
    this.ctx.state.player.statistics.itemsForaged += quantity;
    this.ctx.bus.emit('item:acquired', {
      itemId: def.itemId,
      quantity,
      quality: itemDef.hasQuality ? quality : 1,
      source: 'foraging',
    });
    this.grantXp('foraging', SKILL_ACTIVITY_XP.foraging * (1 + def.skillReq * 0.12), 'gather');
    return {
      ok: true,
      message: 'You gather ' + quantity + ' ' + itemDef.name + (quantity > 1 ? 's' : '') + ' from the ' + def.name.toLowerCase() + '.',
      stateChanged: true,
      data: {
        nodeId,
        itemId: def.itemId,
        quantity,
        quality: itemDef.hasQuality ? quality : 1,
        respawnAt: node.respawnAt,
      },
    };
  }

  getNodesAt(locationId: string): ForageNodeState[] {
    return Object.values(this.ctx.state.foraging.nodes)
      .filter((node) => node.locationId === locationId)
      .sort((a, b) => (a.defId < b.defId ? -1 : a.defId > b.defId ? 1 : 0));
  }

  getNodeDef(nodeId: string): ForageNodeDef | undefined {
    const node = this.ctx.state.foraging.nodes[nodeId];
    const defId = node?.defId ?? nodeId.split(':')[0] ?? nodeId;
    return this.ctx.content.getForageNode(defId);
  }

  // -------------------------------------------------------------------------
  // Simulation update
  // -------------------------------------------------------------------------

  update(dtSimSeconds: number): void {
    void dtSimSeconds; // respawn logic is timestamp based
    const now = this.ctx.clock.simTimeSeconds;
    for (const node of Object.values(this.ctx.state.foraging.nodes)) {
      if (node.depleted && now >= node.respawnAt) {
        node.depleted = false;
        node.remaining = 1;
        node.respawnAt = 0;
      }
    }
    const today = this.ctx.clock.time.totalDays;
    if (today !== this.ctx.state.foraging.lastResetDay) {
      this.ctx.state.foraging.gatheredToday = 0;
      this.ctx.state.foraging.lastResetDay = today;
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private isPlayerAt(locationId: string): boolean {
    const world = this.ctx.registry.get<IWorldSystem>('world');
    if (world) return world.getCurrentLocationId() === locationId;
    return this.ctx.state.player.position.locationId === locationId;
  }

  private locationName(locationId: string): string {
    return this.ctx.content.getLocation(locationId)?.name ?? locationId;
  }

  private getSkillLevel(skill: SkillId): number {
    return this.ctx.registry.getRequired<ISkillSystem>('skill').getLevel(skill);
  }

  private grantXp(skill: SkillId, amount: number, source: string): void {
    this.ctx.registry.getRequired<ISkillSystem>('skill').addXp(skill, amount, 'foraging:' + source);
  }
}