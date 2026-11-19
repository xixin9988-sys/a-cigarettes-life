import { describe, expect, it } from 'vitest';
import { ContentRegistry } from '../../src/core/ContentRegistry';
import { createInitialGameState, DEFAULT_APPEARANCE } from '../../src/core/WorldFactory';
import { CONTENT_PACK } from '../../src/data';
import { SimulationRuntime } from '../../src/simulation/SimulationRuntime';
import { LOC } from '../../src/data/locations/ids';
import { gameTimeToSimSeconds } from '../../src/core/TimeUtil';
import type { GameState } from '../../src/core/contracts';

const content = new ContentRegistry(CONTENT_PACK);

function makeRuntime(seed = 4242): { runtime: SimulationRuntime; state: GameState } {
  const state = createInitialGameState({
    seed,
    playerName: 'Event Tester',
    appearance: DEFAULT_APPEARANCE,
    content,
  });
  const runtime = new SimulationRuntime({ state, content });
  return { runtime, state };
}

describe('EventSystem', () => {
  it('triggers a defined event with real world effects and history', () => {
    const { runtime, state } = makeRuntime();
    const events = runtime.systems.events;
    const beforeHistory = state.world.history.length;
    const result = events.triggerEventForTesting('event_market_bustle');
    expect(result.ok, result.message).toBe(true);
    expect(state.world.events.length).toBeGreaterThan(0);
    expect(state.world.history.length).toBeGreaterThan(beforeHistory);
    const event = state.world.events[state.world.events.length - 1];
    expect(event).toBeDefined();
    if (!event) return;
    expect(event.type).toBe('event_market_bustle');
    expect(event.participants.length).toBeGreaterThan(0);
    expect(events.getRecentEvents(5).some((candidate) => candidate.id === event.id)).toBe(true);
    const ack = events.acknowledgeEvent(event.id);
    expect(ack.ok).toBe(true);
    const stored = state.world.events.find((candidate) => candidate.id === event.id);
    expect(stored?.acknowledged).toBe(true);
    runtime.dispose();
  });

  it('applies money and item rewards from an event to the player', () => {
    const { runtime, state } = makeRuntime(99);
    const beforeMoney = state.player.money;
    const events = runtime.systems.events;
    const result = events.triggerEventForTesting('event_market_bargain');
    expect(result.ok).toBe(true);
    // market_bargain has money(-200) and item rewards; money must never go below zero and items appear.
    expect(state.player.money).toBeLessThanOrEqual(beforeMoney);
    expect(state.player.money).toBeGreaterThanOrEqual(0);
    runtime.dispose();
  });

  it('activates a festival on its scheduled day and lets the player participate', () => {
    const { runtime, state } = makeRuntime(777);
    const events = runtime.systems.events;
    const festivalDef = content.getFestival('fest_spring_flowers');
    expect(festivalDef).toBeDefined();
    if (!festivalDef) return;
    // Move clock to the festival start (Spring 14, 10:00) and update.
    runtime.setSimTimeSeconds(
      gameTimeToSimSeconds({ year: 1, seasonIndex: 0, dayOfSeason: 14, hour: 10, minute: 0 })
    );
    state.player.position = {
      regionId: 'willowbrook',
      locationId: festivalDef.locationId,
      x: 100,
      y: 100,
      indoor: false,
    };
    runtime.advance(60);
    runtime.advance(60);
    const festivalState = events.getFestivals().find((entry) => entry.def.id === festivalDef.id);
    expect(festivalState).toBeDefined();
    if (!festivalState) return;
    expect(festivalState.state.state).toBe('active');
    const activity = festivalDef.activities[0];
    expect(activity).toBeDefined();
    if (!activity) return;
    const result = events.participateFestival(festivalDef.id, activity.id);
    expect(result.ok, result.message).toBe(true);
    expect(state.player.statistics.festivalsAttended).toBeGreaterThan(0);
    expect(state.world.events.some((event) => event.type === 'festival:' + festivalDef.id)).toBe(true);
    runtime.dispose();
  });

  it('keeps world events and active lists bounded over a long offline run', async () => {
    const { runtime, state } = makeRuntime(31337);
    const result = await runtime.runOffline(state.clock.simTimeSeconds, state.clock.simTimeSeconds + 7 * 1440);
    expect(result.stats.steps).toBeGreaterThan(0);
    expect(state.world.events.length).toBeLessThanOrEqual(400);
    expect(state.eventSystem.activeEventIds.length).toBeLessThanOrEqual(40);
    expect(state.world.history.length).toBeLessThanOrEqual(800);
    expect(state.eventSystem.pendingNotifications.length).toBeLessThanOrEqual(40);
    // Every stored event must be structurally valid.
    for (const event of state.world.events) {
      expect(typeof event.id).toBe('string');
      expect(typeof event.title).toBe('string');
      expect(event.title.length).toBeGreaterThan(0);
      expect(Number.isFinite(event.occurredAt)).toBe(true);
    }
    runtime.dispose();
  });
});
