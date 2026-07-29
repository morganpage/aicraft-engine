import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOG } from '../editor/catalog';
import {
  CHARGER_HEIGHT,
  CHARGER_WIDTH,
} from '../level/enemy-schema';
import {
  chargerBehavior,
  resolveChargerParams,
} from '../platformer/enemy/archetypes/charger';
import { createEnemyBehaviorRegistry } from '../platformer/enemy/registry';
import type {
  EnemyState,
  EnemyUpdateContext,
} from '../platformer/enemy/types';

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

describe('charger behavior', () => {
  it('is registered with canonical dimensions and catalog prefab', () => {
    expect(createEnemyBehaviorRegistry().get('charger')).toBe(chargerBehavior);
    expect(CHARGER_WIDTH).toBe(16);
    expect(CHARGER_HEIGHT).toBe(16);
    expect(DEFAULT_CATALOG.entries.charger.defaultRect).toEqual({
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    });
  });

  it('uses named defaults rather than clamping invalid params', () => {
    expect(resolveChargerParams({
      speed: -1,
      dashSpeed: 0,
      windupDuration: Number.NaN,
      recoveryDuration: 61,
      dashMaxDistance: -1,
      detectionRadius: Number.POSITIVE_INFINITY,
      verticalTolerance: -1,
    })).toMatchObject({
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

  it('normalizes malformed data and rejects invalid dt without querying', () => {
    let calls = 0;
    const current = state({
      phase: 'broken',
      windupTimer: 5,
      distanceTraveled: 9,
      dashDir: 0,
    }, { facing: -1 });
    const next = chargerBehavior.step(
      current,
      context({
        dt: Number.NaN,
        tileQuery: () => {
          calls += 1;
          return 'solid';
        },
        playerRect: { x: 10, y: 0, width: 16, height: 16 },
      }),
      {},
    );
    expect(next.data).toMatchObject({
      phase: 'patrol',
      windupTimer: 0,
      recoveryTimer: 0,
      distanceTraveled: 0,
      dashDir: -1,
    });
    expect(calls).toBe(0);
  });

  it('detects before moving, enforces vertical tolerance and LOS, and locks direction', () => {
    const current = state({}, { facing: -1 });
    const detected = chargerBehavior.step(
      current,
      context({ playerRect: { x: 0, y: 0, width: 16, height: 16 } }),
      {},
    );
    expect(detected.x).toBe(0);
    expect(detected.data).toMatchObject({
      phase: 'windup',
      windupTimer: 0.5,
      dashDir: -1,
    });
    expect(
      chargerBehavior.step(
        state(),
        context({ playerRect: { x: 20, y: 100, width: 16, height: 16 } }),
        {},
      ).data.phase,
    ).toBe('patrol');
    expect(
      chargerBehavior.step(
        state(),
        context({
          playerRect: { x: 32, y: 0, width: 16, height: 16 },
          tileQuery: (x) => (x === 1 ? 'solid' : 'empty'),
        }),
        {},
      ).data.phase,
    ).toBe('patrol');
  });

  it('keeps windup/recovery transitions observable for a whole tick', () => {
    const dash = chargerBehavior.step(
      state({ phase: 'windup', windupTimer: 0, dashDir: 1 }),
      context({ dt: 1 }),
      {},
    );
    expect(dash.data.phase).toBe('dash');
    expect(dash.x).toBe(0);
    const patrol = chargerBehavior.step(
      state({ phase: 'recovery', recoveryTimer: 0, dashDir: 1 }),
      context({ dt: 1 }),
      {},
    );
    expect(patrol.data.phase).toBe('patrol');
    expect(patrol.x).toBe(0);
  });

  it('sweeps to thin walls, ignores passthrough, and stops at max distance', () => {
    const dashData = {
      phase: 'dash',
      dashDir: 1,
      distanceTraveled: 0,
      windupTimer: 0,
      recoveryTimer: 0,
    };
    const wall = chargerBehavior.step(
      state(dashData),
      context({ dt: 1, solids: [{ x: 50, y: 0, width: 0.25, height: 16 }] }),
      { dashMaxDistance: 1000 },
    );
    expect(wall.x).toBe(34);
    expect(wall.data.phase).toBe('recovery');
    expect(wall.data.distanceTraveled).toBe(34);

    const max = chargerBehavior.step(
      state({ ...dashData, distanceTraveled: 120 }),
      context({
        dt: 1,
        solids: [{ x: 10, y: 0, width: 2, height: 16, passthrough: true }],
      }),
      {},
    );
    expect(max.x).toBe(8);
    expect(max.data.distanceTraveled).toBe(128);
    expect(max.data.phase).toBe('recovery');
  });

  it('handles zero max distance and non-finite movement products', () => {
    const dash = state({
      phase: 'dash',
      dashDir: 1,
      distanceTraveled: 0,
    });
    const stopped = chargerBehavior.step(dash, context(), { dashMaxDistance: 0 });
    expect(stopped.x).toBe(0);
    expect(stopped.data.phase).toBe('recovery');

    let queried = false;
    const overflow = chargerBehavior.step(
      state(),
      context({
        dt: Number.MAX_VALUE,
        playerRect: { x: 10, y: 0, width: 16, height: 16 },
        tileQuery: () => {
          queried = true;
          return 'empty';
        },
      }),
      { speed: 1024 },
    );
    expect(overflow.x).toBe(0);
    expect(queried).toBe(false);
  });

  it('reverses at walls/ledges and composes entity plus tile support', () => {
    const wall = chargerBehavior.step(
      state(),
      context({ dt: 1, solids: [{ x: 20, y: 0, width: 16, height: 16 }] }),
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

    const entitySupport = chargerBehavior.step(
      state(),
      context({
        dt: 0.1,
        solids: [{ x: 0, y: 17, width: 100, height: 4, passthrough: true }],
        tileQuery: () => 'empty',
      }),
      { speed: 40 },
    );
    expect(entitySupport.x).toBe(4);

    const tileSupport = chargerBehavior.step(
      state(),
      context({ dt: 0.1, tileQuery: () => 'passthrough' }),
      { speed: 40 },
    );
    expect(tileSupport.x).toBe(4);
  });

  it('is deterministic and does not mutate state, context, or params', () => {
    const current = state();
    const ctx = context({
      dt: 0.1,
      solids: [{ x: 0, y: 17, width: 100, height: 4 }],
    });
    const params = { speed: 40 };
    const stateSnapshot = structuredClone(current);
    const ctxSnapshot = structuredClone(ctx);
    const paramsSnapshot = structuredClone(params);
    expect(chargerBehavior.step(current, ctx, params)).toEqual(
      chargerBehavior.step(current, ctx, params),
    );
    expect(current).toEqual(stateSnapshot);
    expect(ctx).toEqual(ctxSnapshot);
    expect(params).toEqual(paramsSnapshot);
  });
});
