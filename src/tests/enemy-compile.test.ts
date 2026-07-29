import { describe, it, expect } from 'vitest';
import { compileEnemies, stepEnemies } from '../platformer/enemy/compile';
import { createEnemyBehaviorRegistry } from '../platformer/enemy/registry';
import type { LevelData, LevelEntity } from '../level/types';
import type { EnemyUpdateContext, CompiledEnemy } from '../platformer/enemy/types';

function makeLevel(entities: readonly LevelEntity[]): LevelData {
  return {
    version: 1,
    id: 'test',
    name: 'Test',
    width: 600,
    height: 400,
    tileSize: 16,
    spawn: { x: 0, y: 0 },
    tiles: { data: [], cols: 0, rows: 0, tileSize: 16 },
    entities,
    nextEntityId: 100,
  };
}

describe('compileEnemies', () => {
  it('handles empty level (no entities)', () => {
    const level = makeLevel([]);
    const result = compileEnemies(level);
    expect(result).toEqual([]);
  });

  it('extracts multiple enemies from level', () => {
    const entities: LevelEntity[] = [
      { id: 1, kind: 'enemy', rect: { x: 100, y: 200, width: 16, height: 16 }, props: { archetype: 'spinny', params: {} } },
      { id: 2, kind: 'enemy', rect: { x: 300, y: 400, width: 16, height: 16 }, props: { archetype: 'turret', params: {} } },
      { id: 3, kind: 'platform', rect: { x: 0, y: 368, width: 600, height: 32 }, props: {} },
    ];
    const level = makeLevel(entities);
    const result = compileEnemies(level);
    expect(result.length).toBe(2);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(2);
  });

  it('initializes position from entity rect', () => {
    const entities: LevelEntity[] = [
      { id: 5, kind: 'enemy', rect: { x: 120, y: 240, width: 16, height: 16 }, props: { archetype: 'spinny', params: {} } },
    ];
    const level = makeLevel(entities);
    const result = compileEnemies(level);
    expect(result[0].state.x).toBe(120);
    expect(result[0].state.y).toBe(240);
    expect(result[0].state.vx).toBe(0);
    expect(result[0].state.vy).toBe(0);
    expect(result[0].state.facing).toBe(1);
    expect(result[0].state.alive).toBe(true);
    expect(result[0].state.data).toEqual({});
  });

  it('preserves archetype from props', () => {
    const entities: LevelEntity[] = [
      { id: 7, kind: 'enemy', rect: { x: 50, y: 50, width: 16, height: 16 }, props: { archetype: 'turret', params: { fireRate: 2 } } },
    ];
    const level = makeLevel(entities);
    const result = compileEnemies(level);
    expect(result[0].archetype).toBe('turret');
    expect(result[0].params).toEqual({ fireRate: 2 });
  });

  it('preserves entity back-reference', () => {
    const entity: LevelEntity = { id: 9, kind: 'enemy', rect: { x: 10, y: 20, width: 16, height: 16 }, props: { archetype: 'spinny', params: {} } };
    const level = makeLevel([entity]);
    const result = compileEnemies(level);
    expect(result[0].entity).toBe(entity);
  });

  it('skips non-enemy entities', () => {
    const entities: LevelEntity[] = [
      { id: 1, kind: 'platform', rect: { x: 0, y: 0, width: 100, height: 16 }, props: {} },
      { id: 2, kind: 'spawn', rect: { x: 0, y: 0, width: 16, height: 16 }, props: {} },
      { id: 3, kind: 'exit', rect: { x: 0, y: 0, width: 16, height: 16 }, props: { isTrap: false, locked: false } },
    ];
    const level = makeLevel(entities);
    const result = compileEnemies(level);
    expect(result).toEqual([]);
  });

  it('handles null/undefined level gracefully', () => {
    const result1 = compileEnemies(null as unknown as LevelData);
    expect(result1).toEqual([]);
    const result2 = compileEnemies(undefined as unknown as LevelData);
    expect(result2).toEqual([]);
  });

  it('skips entities with malformed rect', () => {
    const entities: LevelEntity[] = [
      { id: 1, kind: 'enemy', rect: { x: NaN, y: 100, width: 16, height: 16 }, props: { archetype: 'spinny', params: {} } },
      { id: 2, kind: 'enemy', rect: { x: 100, y: 100, width: 16, height: 16 }, props: { archetype: 'spinny', params: {} } },
    ];
    const level = makeLevel(entities);
    const result = compileEnemies(level);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(2);
  });

  it('is pure: same input produces same output', () => {
    const entities: LevelEntity[] = [
      { id: 1, kind: 'enemy', rect: { x: 100, y: 200, width: 16, height: 16 }, props: { archetype: 'spinny', params: {} } },
    ];
    const level = makeLevel(entities);
    const result1 = compileEnemies(level);
    const result2 = compileEnemies(level);
    expect(result1).toEqual(result2);
    // Input not mutated
    expect(level.entities.length).toBe(1);
  });

  it('compiles fixed-size chargers and skips mismatched built-in dimensions', () => {
    const entities: LevelEntity[] = [
      {
        id: 20,
        kind: 'enemy',
        rect: { x: 10, y: 20, width: 16, height: 16 },
        props: { archetype: 'charger', params: { speed: 40 } },
      },
      {
        id: 21,
        kind: 'enemy',
        rect: { x: 30, y: 20, width: 32, height: 16 },
        props: { archetype: 'charger', params: {} },
      },
      {
        id: 22,
        kind: 'enemy',
        rect: { x: 50, y: 20, width: 32, height: 16 },
        props: { archetype: 'custom-large', params: {} },
      },
    ];
    const result = compileEnemies(makeLevel(entities));
    expect(result.map((enemy) => enemy.id)).toEqual([20, 22]);
    expect(result[0].archetype).toBe('charger');
  });
});

function makeDefaultContext(overrides?: Partial<EnemyUpdateContext>): EnemyUpdateContext {
  return {
    dt: 1 / 60,
    solids: [],
    tileQuery: null,
    tileSize: 16,
    playerRect: null,
    ...overrides,
  };
}

describe('stepEnemies', () => {
  it('advances spinny enemies (position changes)', () => {
    const entities: LevelEntity[] = [
      { id: 1, kind: 'enemy', rect: { x: 100, y: 100, width: 16, height: 16 }, props: { archetype: 'spinny', params: { speed: 60 } } },
    ];
    const level = makeLevel(entities);
    const enemies = compileEnemies(level);
    const registry = createEnemyBehaviorRegistry();
    const ctx = makeDefaultContext();

    const result = stepEnemies(enemies, registry, ctx);

    expect(result.enemies.length).toBe(1);
    expect(result.enemies[0].state.x).toBeGreaterThan(100);
    expect(result.projectiles.length).toBe(0);
  });

  it('spawns projectiles from turret enemies', () => {
    const entities: LevelEntity[] = [
      { id: 1, kind: 'enemy', rect: { x: 100, y: 100, width: 16, height: 16 }, props: { archetype: 'turret', params: { fireRate: 1 } } },
    ];
    const level = makeLevel(entities);
    const enemies = compileEnemies(level);
    const registry = createEnemyBehaviorRegistry();
    const ctx = makeDefaultContext();

    const result = stepEnemies(enemies, registry, ctx);

    expect(result.projectiles.length).toBe(1);
    expect(result.projectiles[0].alive).toBe(true);
  });

  it('handles empty enemies array', () => {
    const registry = createEnemyBehaviorRegistry();
    const ctx = makeDefaultContext();
    const result = stepEnemies([], registry, ctx);
    expect(result.enemies).toEqual([]);
    expect(result.projectiles).toEqual([]);
  });

  it('passes through enemies with unknown archetype', () => {
    const enemy: CompiledEnemy = {
      id: 1,
      archetype: 'unknown',
      state: { x: 100, y: 100, vx: 0, vy: 0, facing: 1, alive: true, data: {} },
      entity: { id: 1, kind: 'enemy', rect: { x: 100, y: 100, width: 16, height: 16 }, props: { archetype: 'unknown', params: {} } },
      params: {},
    };
    const registry = createEnemyBehaviorRegistry();
    const ctx = makeDefaultContext();
    const result = stepEnemies([enemy], registry, ctx);
    expect(result.enemies[0]).toBe(enemy);
    expect(result.projectiles.length).toBe(0);
  });

  it('passes through dead enemies unchanged', () => {
    const enemy: CompiledEnemy = {
      id: 1,
      archetype: 'spinny',
      state: { x: 100, y: 100, vx: 0, vy: 0, facing: 1, alive: false, data: {} },
      entity: { id: 1, kind: 'enemy', rect: { x: 100, y: 100, width: 16, height: 16 }, props: { archetype: 'spinny', params: {} } },
      params: {},
    };
    const registry = createEnemyBehaviorRegistry();
    const ctx = makeDefaultContext();
    const result = stepEnemies([enemy], registry, ctx);
    expect(result.enemies[0]).toBe(enemy);
  });

  it('is pure: same input produces same output', () => {
    const entities: LevelEntity[] = [
      { id: 1, kind: 'enemy', rect: { x: 100, y: 100, width: 16, height: 16 }, props: { archetype: 'spinny', params: { speed: 60 } } },
    ];
    const level = makeLevel(entities);
    const enemies = compileEnemies(level);
    const registry = createEnemyBehaviorRegistry();
    const ctx = makeDefaultContext();

    const result1 = stepEnemies(enemies, registry, ctx);
    const result2 = stepEnemies(enemies, registry, ctx);

    expect(result1).toEqual(result2);
    // Input not mutated
    expect(enemies[0].state.x).toBe(100);
  });
});
