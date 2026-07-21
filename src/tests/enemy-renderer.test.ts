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
