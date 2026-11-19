import type { IEventBus, IGameContext, ISystem, ISystemRegistry } from './contracts';

/** Ordered registry of game systems. */
export class SystemRegistry implements ISystemRegistry {
  private readonly systems = new Map<string, ISystem>();
  private readonly order: ISystem[] = [];

  constructor(private readonly bus?: IEventBus) {}

  register(system: ISystem): void {
    if (this.systems.has(system.id)) {
      throw new Error('System already registered: ' + system.id);
    }
    this.systems.set(system.id, system);
    this.order.push(system);
  }

  get<T extends ISystem>(id: string): T | undefined {
    return this.systems.get(id) as T | undefined;
  }

  getRequired<T extends ISystem>(id: string): T {
    const system = this.systems.get(id);
    if (!system) throw new Error('Missing required system: ' + id);
    return system as T;
  }

  all(): ISystem[] {
    return [...this.order];
  }

  has(id: string): boolean {
    return this.systems.has(id);
  }

  initAll(ctx: IGameContext): void {
    for (const system of this.order) {
      system.init(ctx);
    }
  }

  updateAll(dtSimSeconds: number): void {
    for (const system of this.order) {
      system.update(dtSimSeconds);
    }
  }
}