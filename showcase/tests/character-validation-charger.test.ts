import { describe, expect, it } from 'vitest';
import type {
  EnemyState,
  EnemyUpdateContext,
} from '../../src/platformer/enemy/types';
import {
  chargerBehavior,
  resolveChargerParams,
} from '../_prototype/character-enemy-validation/charger-behavior';

function state(
  data: Record<string, unknown> = { phase: 'patrol' },
  overrides: Partial<EnemyState> = {},
): EnemyState {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    alive: true,
    data,
    ...overrides,
  };
}

function context(
  overrides: Partial<EnemyUpdateContext> = {},
): EnemyUpdateContext {
  return {
    dt: 1 / 60,
    solids: [],
    tileQuery: null,
    tileSize: 16,
    playerRect: null,
    ...overrides,
  };
}

describe('charger validation prototype', () => {
  it('uses named defaults for invalid parameters instead of clamping', () => {
    const resolved = resolveChargerParams({
      speed: -1,
      dashSpeed: 0,
      windupDuration: Number.NaN,
      recoveryDuration: 61,
      dashMaxDistance: -2,
      detectionRadius: Number.POSITIVE_INFINITY,
      verticalTolerance: -1,
    });
    expect(resolved).toMatchObject({
      speed: 40,
      dashSpeed: 300,
      windupDuration: 0.5,
      recoveryDuration: 0.8,
      dashMaxDistance: 128,
      detectionRadius: 160,
      verticalTolerance: 12,
      ledgeTurnAround: true,
    });
  });

  it('returns fresh state-equivalent results without queries for invalid dt', () => {
    const current = state({ phase: 'patrol', marker: 1 });
    let calls = 0;
    const ctx = context({
      dt: Number.NaN,
      tileQuery: () => {
        calls += 1;
        return 'solid';
      },
      playerRect: { x: 10, y: 0, width: 16, height: 16 },
    });
    const next = chargerBehavior.step(current, ctx, {});
    expect(next).not.toBe(current);
    expect(next).toMatchObject(current);
    expect(calls).toBe(0);
  });

  it('detects before patrol movement and locks a non-zero direction', () => {
    const current = state({}, { facing: -1 });
    const next = chargerBehavior.step(
      current,
      context({ playerRect: { x: 0, y: 0, width: 16, height: 16 } }),
      {},
    );
    expect(next.x).toBe(current.x);
    expect(next.data.phase).toBe('windup');
    expect(next.data.windupTimer).toBe(0.5);
    expect(next.data.dashDir).toBe(-1);
  });

  it('requires vertical tolerance and clear LOS', () => {
    const current = state();
    const tooHigh = chargerBehavior.step(
      current,
      context({ playerRect: { x: 20, y: 100, width: 16, height: 16 } }),
      {},
    );
    expect(tooHigh.data.phase).toBe('patrol');

    const blocked = chargerBehavior.step(
      current,
      context({
        playerRect: { x: 32, y: 0, width: 16, height: 16 },
        tileQuery: (x) => (x === 1 ? 'solid' : 'empty'),
      }),
      {},
    );
    expect(blocked.data.phase).toBe('patrol');
  });

  it('exposes transition phases for a tick and does not run destination bodies', () => {
    const windup = state({
      phase: 'windup',
      windupTimer: 0,
      dashDir: 1,
      distanceTraveled: 0,
    });
    const dash = chargerBehavior.step(windup, context({ dt: 1 }), {});
    expect(dash.data.phase).toBe('dash');
    expect(dash.x).toBe(windup.x);

    const recovery = state({
      phase: 'recovery',
      recoveryTimer: 0,
      dashDir: 1,
      distanceTraveled: 128,
    });
    const patrol = chargerBehavior.step(recovery, context({ dt: 1 }), {});
    expect(patrol.data.phase).toBe('patrol');
    expect(patrol.x).toBe(recovery.x);
  });

  it('sweeps to a thin wall and enters recovery on the impact tick', () => {
    const dash = state({
      phase: 'dash',
      dashDir: 1,
      distanceTraveled: 0,
      recoveryTimer: 0,
      windupTimer: 0,
    });
    const next = chargerBehavior.step(
      dash,
      context({
        dt: 1,
        solids: [{ x: 50, y: 0, width: 0.25, height: 16 }],
      }),
      { dashMaxDistance: 1000 },
    );
    expect(next.x).toBe(34);
    expect(next.data.distanceTraveled).toBe(34);
    expect(next.data.phase).toBe('recovery');
    expect(next.data.recoveryTimer).toBe(0.8);
  });

  it('ignores passthrough walls and stops exactly at max distance', () => {
    const dash = state({
      phase: 'dash',
      dashDir: 1,
      distanceTraveled: 120,
      recoveryTimer: 0,
      windupTimer: 0,
    });
    const next = chargerBehavior.step(
      dash,
      context({
        dt: 1,
        solids: [{ x: 10, y: 0, width: 2, height: 16, passthrough: true }],
      }),
      {},
    );
    expect(next.x).toBe(8);
    expect(next.data.distanceTraveled).toBe(128);
    expect(next.data.phase).toBe('recovery');
  });

  it('reverses patrol at walls and unsupported ledges', () => {
    const wall = chargerBehavior.step(
      state(),
      context({
        dt: 1,
        solids: [{ x: 20, y: 0, width: 16, height: 16 }],
      }),
      { speed: 40, ledgeTurnAround: false },
    );
    expect(wall.x).toBe(4);
    expect(wall.facing).toBe(-1);

    const ledge = chargerBehavior.step(
      state(),
      context({ dt: 0.1, tileQuery: () => 'empty' }),
      { speed: 40 },
    );
    expect(ledge.x).toBe(0);
    expect(ledge.facing).toBe(-1);
  });

  it('composes entity and tile support and leaves inputs unchanged', () => {
    const current = state();
    const ctx = context({
      dt: 0.1,
      solids: [{ x: 0, y: 17, width: 100, height: 4, passthrough: true }],
      tileQuery: () => 'empty',
    });
    const params = { speed: 40 };
    const stateSnapshot = structuredClone(current);
    const ctxSnapshot = structuredClone({ ...ctx, tileQuery: null });
    const paramsSnapshot = { ...params };
    const first = chargerBehavior.step(current, ctx, params);
    const second = chargerBehavior.step(current, ctx, params);
    expect(first).toEqual(second);
    expect(first.x).toBe(4);
    expect(current).toEqual(stateSnapshot);
    expect({ ...ctx, tileQuery: null }).toEqual(ctxSnapshot);
    expect(params).toEqual(paramsSnapshot);
  });
});
