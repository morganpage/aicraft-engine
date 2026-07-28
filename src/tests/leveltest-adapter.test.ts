/**
 * Tests for the platformer simulation adapter.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import { createPlatformerAdapter } from '../leveltest/adapter';
import type { PlatformerSimulationState } from '../leveltest/adapter';
import type { PlatformerInput } from '../platformer/types';
import type { LevelData } from '../level/types';
import { compileLevel } from '../platformer/level-runtime';
import { reachedExit } from '../leveltest/win-conditions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal valid level with one platform, spawn, and exit. */
function makeSimpleLevel(): LevelData {
  return {
    version: 1,
    id: 'test-level',
    name: 'Test Level',
    width: 800,
    height: 600,
    tileSize: 16,
    spawn: { x: 50, y: 500 },
    tiles: {
      data: [],
      cols: 0,
      rows: 0,
      tileSize: 16,
    },
    entities: [
      {
        id: 1,
        kind: 'spawn',
        rect: { x: 50, y: 500, width: 16, height: 24 },
        props: {},
      },
      {
        id: 2,
        kind: 'platform',
        rect: { x: 0, y: 524, width: 200, height: 16 },
        props: {},
      },
      {
        id: 3,
        kind: 'exit',
        rect: { x: 150, y: 500, width: 32, height: 48 },
        props: { isTrap: false, locked: false },
      },
    ],
    nextEntityId: 4,
  };
}

/** A level with a fall-off edge (spawn with no ground below). */
function makeFallLevel(): LevelData {
  return {
    version: 1,
    id: 'fall-test',
    name: 'Fall Test',
    width: 800,
    height: 600,
    tileSize: 16,
    spawn: { x: 50, y: 500 },
    tiles: {
      data: [],
      cols: 0,
      rows: 0,
      tileSize: 16,
    },
    entities: [
      {
        id: 1,
        kind: 'spawn',
        rect: { x: 50, y: 500, width: 16, height: 24 },
        props: {},
      },
      // No ground - player falls
      {
        id: 2,
        kind: 'exit',
        rect: { x: 150, y: 100, width: 32, height: 48 },
        props: { isTrap: false, locked: false },
      },
    ],
    nextEntityId: 3,
  };
}

function makeConfig() {
  return { winCondition: reachedExit, fixedDt: 1 / 60 };
}

describe('createPlatformerAdapter', () => {
  it('returns a valid SimulationAdapter', () => {
    const level = makeSimpleLevel();
    const compiled = compileLevel(level);
    const adapter = createPlatformerAdapter(compiled, level, makeConfig());
    expect(adapter).toBeDefined();
    expect(typeof adapter.createInitialState).toBe('function');
    expect(typeof adapter.actions).toBe('function');
    expect(typeof adapter.step).toBe('function');
    expect(typeof adapter.outcome).toBe('function');
  });

  it('adapter.id === "platformer-level"', () => {
    const level = makeSimpleLevel();
    const compiled = compileLevel(level);
    const adapter = createPlatformerAdapter(compiled, level, makeConfig());
    expect(adapter.id).toBe('platformer-level');
  });

  it('adapter.version === 1', () => {
    const level = makeSimpleLevel();
    const compiled = compileLevel(level);
    const adapter = createPlatformerAdapter(compiled, level, makeConfig());
    expect(adapter.version).toBe(1);
  });

  it('adapter.scenarioFingerprint is deterministic', () => {
    const level = makeSimpleLevel();
    const compiled = compileLevel(level);
    const adapter1 = createPlatformerAdapter(compiled, level, makeConfig());
    const adapter2 = createPlatformerAdapter(compiled, level, makeConfig());
    expect(adapter1.scenarioFingerprint).toBe(adapter2.scenarioFingerprint);
  });

  it('createInitialState returns a valid PlatformerSimulationState', () => {
    const level = makeSimpleLevel();
    const compiled = compileLevel(level);
    const adapter = createPlatformerAdapter(compiled, level, makeConfig());
    const state = adapter.createInitialState(42);
    expect(state).toBeDefined();
    expect(state.platformerState).toBeDefined();
    expect(state.platformerState.core).toBeDefined();
    expect(typeof state.platformerState.core.x).toBe('number');
    expect(typeof state.platformerState.core.y).toBe('number');
    expect(state.save).toBeDefined();
    expect(Array.isArray(state.save.collected)).toBe(true);
    expect(state.save.collected.length).toBe(0);
    expect(state.tick).toBe(0);
  });

  it('actions returns the full action set', () => {
    const level = makeSimpleLevel();
    const compiled = compileLevel(level);
    const adapter = createPlatformerAdapter(compiled, level, makeConfig());
    const state = adapter.createInitialState(42);
    const actions = adapter.actions(state);
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBeGreaterThanOrEqual(3); // At minimum idle + left + right

    // Verify each action has the correct shape
    for (const action of actions) {
      expect([-1, 0, 1]).toContain(action.moveX);
      expect(typeof action.jump).toBe('object');
      expect(typeof action.jump.held).toBe('boolean');
      expect(typeof action.jump.pressed).toBe('boolean');
      expect(typeof action.jump.released).toBe('boolean');
      if (action.dash !== null) {
        expect(typeof action.dash.held).toBe('boolean');
        expect(typeof action.dash.pressed).toBe('boolean');
        expect(typeof action.dash.released).toBe('boolean');
      }
    }
  });

  it('step advances the platformer state', () => {
    const level = makeSimpleLevel();
    const compiled = compileLevel(level);
    const adapter = createPlatformerAdapter(compiled, level, makeConfig());
    const state = adapter.createInitialState(42);
    const action: PlatformerInput = { moveX: 1, jump: { held: false, pressed: false, released: false }, dash: { held: false, pressed: false, released: false } };
    const nextState = adapter.step(state, action, 1 / 60);
    expect(nextState.tick).toBe(1);
    expect(nextState.platformerState.tick).toBe(1);
  });

  it('outcome returns "running" for mid-level state', () => {
    const level = makeSimpleLevel();
    const compiled = compileLevel(level);
    const adapter = createPlatformerAdapter(compiled, level, makeConfig());
    const state = adapter.createInitialState(42);
    const outcome = adapter.outcome(state);
    expect(outcome).toBe('running');
  });

  it('outcome returns "success" when win condition met', () => {
    const level = makeSimpleLevel();
    const compiled = compileLevel(level);
    const adapter = createPlatformerAdapter(compiled, level, makeConfig());
    const state = adapter.createInitialState(42);

    // Move the player to the exit area
    const exitEntity = level.entities.find((e) => e.kind === 'exit')!;
    const modifiedState: PlatformerSimulationState = {
      platformerState: {
        ...state.platformerState,
        core: {
          ...state.platformerState.core,
          x: exitEntity.rect.x,
          y: exitEntity.rect.y,
        },
      },
      save: state.save,
      tick: state.tick,
    };
    const outcome = adapter.outcome(modifiedState);
    expect(outcome).toBe('success');
  });

  it('outcome returns "failure" when player falls out of bounds', () => {
    const level = makeFallLevel();
    const compiled = compileLevel(level);
    const adapter = createPlatformerAdapter(compiled, level, makeConfig());
    const state = adapter.createInitialState(42);

    // Simulate falling by setting y far below level height
    const fallenState: PlatformerSimulationState = {
      platformerState: {
        ...state.platformerState,
        core: {
          ...state.platformerState.core,
          y: level.height + 200, // Way below the level
        },
      },
      save: state.save,
      tick: state.tick,
    };
    const outcome = adapter.outcome(fallenState);
    expect(outcome).toBe('failure');
  });

  it('never throws when calling any method with bad input', () => {
    const level = makeSimpleLevel();
    const compiled = compileLevel(level);
    const adapter = createPlatformerAdapter(compiled, level, makeConfig());

    expect(() => adapter.createInitialState(NaN as unknown as number)).not.toThrow();
    expect(() => adapter.actions(null as unknown as PlatformerSimulationState)).not.toThrow();

    const state = adapter.createInitialState(42);
    expect(() => adapter.step(state, null as unknown as PlatformerInput, 1 / 60)).not.toThrow();
    expect(() => adapter.step(state, { moveX: 0 } as PlatformerInput, 1 / 60)).not.toThrow();
    expect(() => adapter.step(state, { moveX: 0, jump: { held: false, pressed: false, released: false }, dash: { held: false, pressed: false, released: false } }, NaN)).not.toThrow();
    expect(() => adapter.outcome(null as unknown as PlatformerSimulationState)).not.toThrow();
    expect(() => adapter.stateKey?.(null as unknown as PlatformerSimulationState)).not.toThrow();
  });

  it('createInitialState with different seeds produces same state (determinism)', () => {
    const level = makeSimpleLevel();
    const compiled = compileLevel(level);
    const adapter = createPlatformerAdapter(compiled, level, makeConfig());
    const state1 = adapter.createInitialState(1);
    const state2 = adapter.createInitialState(2);
    // State should be same since platformer state doesn't use seed
    expect(state1.platformerState.core.x).toBe(state2.platformerState.core.x);
    expect(state1.platformerState.core.y).toBe(state2.platformerState.core.y);
  });
});
