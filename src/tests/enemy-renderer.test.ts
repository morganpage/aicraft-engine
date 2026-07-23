import { describe, it, expect, vi } from 'vitest';
import { drawEnemies, drawProjectiles } from '../platformer/enemy/renderer';
import type { CompiledEnemy, ProjectileState, EnemyState } from '../platformer/enemy/types';
import type { LevelEntity } from '../level/types';

function makeEnemy(overrides?: Partial<{ id: number; archetype: string; x: number; y: number }>): CompiledEnemy {
  const id = overrides?.id ?? 1;
  const archetype = overrides?.archetype ?? 'spinny';
  const x = overrides?.x ?? 100;
  const y = overrides?.y ?? 100;
  const entity: LevelEntity = {
    id,
    kind: 'enemy',
    rect: { x, y, width: 16, height: 16 },
    props: { archetype, params: {} },
  };
  const state: EnemyState = {
    x,
    y,
    vx: 0,
    vy: 0,
    facing: 1,
    alive: true,
    data: {},
  };
  return { id, archetype, state, entity, params: {} };
}

function makeProjectile(overrides?: Partial<ProjectileState>): ProjectileState {
  return {
    x: 100,
    y: 100,
    vx: 120,
    vy: 0,
    width: 6,
    height: 6,
    alive: true,
    ...overrides,
  };
}

function makeMockCtx(): CanvasRenderingContext2D {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    closePath: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setLineDash: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('drawEnemies', () => {
  it('draws without throwing for spinny enemies', () => {
    const ctx = makeMockCtx();
    const enemies = [makeEnemy({ archetype: 'spinny' })];
    expect(() => drawEnemies(ctx, enemies, 0)).not.toThrow();
  });

  it('draws spinny sawblade with path operations', () => {
    const ctx = makeMockCtx();
    const enemies = [makeEnemy({ archetype: 'spinny' })];
    drawEnemies(ctx, enemies, 42);
    // Sawblade uses beginPath, moveTo, lineTo, arc, fill, stroke
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalled();
    expect(ctx.lineTo).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    // Should have rotated by tick * angularSpeed
    expect(ctx.rotate).toHaveBeenCalled();
  });

  it('draws without throwing for turret enemies', () => {
    const ctx = makeMockCtx();
    const enemies = [makeEnemy({ archetype: 'turret' })];
    expect(() => drawEnemies(ctx, enemies, 0)).not.toThrow();
  });

  it('handles empty enemies array', () => {
    const ctx = makeMockCtx();
    expect(() => drawEnemies(ctx, [], 0)).not.toThrow();
  });

  it('skips dead enemies (no draw calls)', () => {
    const ctx = makeMockCtx();
    const enemy = makeEnemy();
    const deadEnemy: CompiledEnemy = { ...enemy, state: { ...enemy.state, alive: false } };
    drawEnemies(ctx, [deadEnemy], 0);
    // fillRect should not have been called for a dead enemy
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Directional deterministic roll — renderer uses stored spinAngle.
//
// The renderer should use state.data.spinAngle for rotation when present.
// For legacy/external states without it, a safe direction-aware fallback
// based on tick * angularSpeed * facing is used (not the old always-positive
// formula).
// ---------------------------------------------------------------------------

describe('drawEnemies — spinAngle rotation', () => {
  it('uses stored spinAngle from state.data.spinAngle for rotation', () => {
    const ctx = makeMockCtx();
    const spinAngle = 1.23;
    const enemy = makeEnemy({ archetype: 'spinny' });
    const withAngle: typeof enemy = {
      ...enemy,
      state: { ...enemy.state, data: { spinAngle } },
    };
    drawEnemies(ctx, [withAngle], 0);
    // The rotate call should have received spinAngle (not tick * angularSpeed).
    const rotateCalls = (ctx.rotate as ReturnType<typeof vi.fn>).mock.calls;
    expect(rotateCalls.length).toBeGreaterThan(0);
    expect(rotateCalls[0][0]).toBeCloseTo(spinAngle, 10);
  });

  it('uses direction-aware fallback when state.data.spinAngle is absent (facing +1)', () => {
    const ctx = makeMockCtx();
    const tick = 42;
    const enemy = makeEnemy({ archetype: 'spinny' });
    // enemy.state.facing defaults to 1
    drawEnemies(ctx, [enemy], tick);
    const rotateCalls = (ctx.rotate as ReturnType<typeof vi.fn>).mock.calls;
    expect(rotateCalls.length).toBeGreaterThan(0);
    // Expected: tick * angularSpeed * facing = 42 * (2π/120) * 1
    const SPINNY_ANGULAR_SPEED = Math.PI * 2 / 120;
    const expected = tick * SPINNY_ANGULAR_SPEED * 1;
    expect(rotateCalls[0][0]).toBeCloseTo(expected, 10);
  });

  it('uses direction-aware fallback with facing -1 (negative rotation)', () => {
    const ctx = makeMockCtx();
    const tick = 42;
    const enemy = makeEnemy({ archetype: 'spinny' });
    const leftFacing: typeof enemy = {
      ...enemy,
      state: { ...enemy.state, facing: -1 },
    };
    drawEnemies(ctx, [leftFacing], tick);
    const rotateCalls = (ctx.rotate as ReturnType<typeof vi.fn>).mock.calls;
    expect(rotateCalls.length).toBeGreaterThan(0);
    // Expected: tick * angularSpeed * (-1) — negative rotation for left-facing.
    const SPINNY_ANGULAR_SPEED = Math.PI * 2 / 120;
    const expected = tick * SPINNY_ANGULAR_SPEED * (-1);
    expect(rotateCalls[0][0]).toBeCloseTo(expected, 10);
  });

  it('fallback is direction-aware: facing +1 and -1 produce opposite rotations', () => {
    const ctx1 = makeMockCtx();
    const ctx2 = makeMockCtx();
    const tick = 42;
    const enemy = makeEnemy({ archetype: 'spinny' });
    const leftFacing: typeof enemy = {
      ...enemy,
      state: { ...enemy.state, facing: -1 },
    };
    drawEnemies(ctx1, [enemy], tick);
    drawEnemies(ctx2, [leftFacing], tick);
    const rotate1 = (ctx1.rotate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const rotate2 = (ctx2.rotate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(rotate2).toBeCloseTo(-rotate1, 10);
  });
});

describe('drawProjectiles', () => {
  it('draws without throwing for active projectiles', () => {
    const ctx = makeMockCtx();
    const projectiles = [makeProjectile()];
    expect(() => drawProjectiles(ctx, projectiles)).not.toThrow();
  });

  it('handles empty projectiles array', () => {
    const ctx = makeMockCtx();
    expect(() => drawProjectiles(ctx, [])).not.toThrow();
  });

  it('skips dead projectiles', () => {
    const ctx = makeMockCtx();
    const dead = makeProjectile({ alive: false });
    drawProjectiles(ctx, [dead]);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Turret renderer — shootTo direction indicator
// ---------------------------------------------------------------------------

describe('drawEnemies — turret shootTo indicator', () => {
  it('draws turret without throwing when shootTo is present', () => {
    const ctx = makeMockCtx();
    const enemy = makeEnemy({ archetype: 'turret' });
    const withShootTo: typeof enemy = {
      ...enemy,
      params: { shootTo: { x: 128, y: 0 } },
    };
    expect(() => drawEnemies(ctx, [withShootTo], 0)).not.toThrow();
  });

  it('turret with zero shootTo x-component {x:0, y:128} does not throw', () => {
    const ctx = makeMockCtx();
    const enemy = makeEnemy({ archetype: 'turret' });
    const withZeroX: typeof enemy = {
      ...enemy,
      params: { shootTo: { x: 0, y: 128 } },
    };
    expect(() => drawEnemies(ctx, [withZeroX], 0)).not.toThrow();
  });
});
