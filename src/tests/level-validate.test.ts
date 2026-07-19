import { describe, it, expect } from 'vitest';
import { validateLevel } from '../level/validate';
import type { ValidationError, ValidationResult } from '../level/types';

/** Deep-clone helper for test fixtures. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** A complete, valid v1 level. Each test clones and mutates one field. */
function baseLevel(): unknown {
  return {
    version: 1,
    id: 'test-level',
    name: 'Test',
    width: 100,
    height: 100,
    tileSize: 10,
    spawn: { x: 10, y: 10 },
    tiles: { data: new Array(100).fill(0), cols: 10, rows: 10, tileSize: 10 },
    entities: [
      {
        id: 1,
        kind: 'spawn',
        rect: { x: 10, y: 10, width: 10, height: 10 },
        props: {},
      },
      {
        id: 2,
        kind: 'exit',
        rect: { x: 80, y: 80, width: 10, height: 10 },
        props: { isTrap: false, locked: false },
      },
    ],
    nextEntityId: 3,
  };
}

/** All error-severity diagnostics (drops warnings). */
function errorsOnly(r: ValidationResult): ValidationError[] {
  return r.errors.filter((e) => e.severity === 'error');
}

describe('validateLevel — valid input', () => {
  it('passes a complete valid level', () => {
    const result = validateLevel(baseLevel());
    expect(result.valid).toBe(true);
    expect(errorsOnly(result)).toEqual([]);
  });

  it('accepts unknown top-level fields (forward-compat)', () => {
    const level = clone(baseLevel()) as Record<string, unknown>;
    level.futureField = 42;
    const result = validateLevel(level);
    expect(result.valid).toBe(true);
    expect(errorsOnly(result)).toEqual([]);
  });

  it('accepts unknown entity prop fields (forward-compat)', () => {
    const level = clone(baseLevel()) as {
      entities: Array<{ props: Record<string, unknown> }>;
    };
    level.entities[1].props.futureProp = 'x';
    const result = validateLevel(level);
    expect(result.valid).toBe(true);
    expect(errorsOnly(result)).toEqual([]);
  });

  it('accepts optional bottomLava, hints, and flags', () => {
    const level = clone(baseLevel()) as Record<string, unknown>;
    level.bottomLava = { surfaceY: 200 };
    level.hints = ['try jumping'];
    level.flags = { lookahead: true, foreground: false };
    const result = validateLevel(level);
    expect(result.valid).toBe(true);
  });
});

describe('validateLevel — structural errors', () => {
  it('rejects a missing version', () => {
    const level = clone(baseLevel()) as Record<string, unknown>;
    delete level.version;
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'version')).toBe(true);
  });

  it('rejects a non-integer version', () => {
    const level = clone(baseLevel()) as Record<string, unknown>;
    level.version = 1.5;
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'version')).toBe(true);
  });

  it('rejects a non-positive version', () => {
    const level = clone(baseLevel()) as Record<string, unknown>;
    level.version = 0;
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'version')).toBe(true);
  });

  it('rejects a non-string id', () => {
    const level = clone(baseLevel()) as Record<string, unknown>;
    level.id = 42;
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'id')).toBe(true);
  });

  it('rejects a non-string name', () => {
    const level = clone(baseLevel()) as Record<string, unknown>;
    level.name = null;
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'name')).toBe(true);
  });

  it('rejects a negative width', () => {
    const level = clone(baseLevel()) as Record<string, unknown>;
    level.width = -10;
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'width')).toBe(true);
  });

  it('rejects a zero height', () => {
    const level = clone(baseLevel()) as Record<string, unknown>;
    level.height = 0;
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'height')).toBe(true);
  });

  it('rejects a non-positive tileSize', () => {
    const level = clone(baseLevel()) as Record<string, unknown>;
    level.tileSize = -1;
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'tileSize')).toBe(true);
  });

  it('rejects a non-numeric nextEntityId', () => {
    const level = clone(baseLevel()) as Record<string, unknown>;
    level.nextEntityId = 'three';
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'nextEntityId')).toBe(true);
  });

  it('rejects nextEntityId < 1', () => {
    const level = clone(baseLevel()) as Record<string, unknown>;
    level.nextEntityId = 0;
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'nextEntityId')).toBe(true);
  });
});

describe('validateLevel — tile grid errors', () => {
  it('rejects tiles.data length mismatch', () => {
    const level = clone(baseLevel()) as { tiles: { data: number[] } };
    level.tiles.data = new Array(99).fill(0);
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'tiles.data')).toBe(true);
  });

  it('rejects non-array tiles.data', () => {
    const level = clone(baseLevel()) as { tiles: Record<string, unknown> };
    level.tiles.data = 'nope';
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'tiles.data')).toBe(true);
  });

  it('rejects non-integer cols', () => {
    const level = clone(baseLevel()) as { tiles: Record<string, unknown> };
    level.tiles.cols = 1.5;
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'tiles.cols')).toBe(true);
  });
});

describe('validateLevel — spawn bounds', () => {
  it('warns when spawn.x is out of bounds but stays valid', () => {
    const level = clone(baseLevel()) as { spawn: { x: number } };
    level.spawn.x = 200;
    const result = validateLevel(level);
    const warn = result.errors.find(
      (e) => e.path === 'spawn.x' && e.severity === 'warning',
    );
    expect(warn).toBeDefined();
    expect(result.valid).toBe(true);
  });

  it('errors when spawn.x is non-numeric', () => {
    const level = clone(baseLevel()) as { spawn: Record<string, unknown> };
    level.spawn.x = 'ten';
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'spawn.x')).toBe(true);
  });

  it('errors when spawn is not an object', () => {
    const level = clone(baseLevel()) as Record<string, unknown>;
    level.spawn = null;
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'spawn')).toBe(true);
  });
});

describe('validateLevel — entity errors', () => {
  it('warns when entity rect.x is out of bounds but stays valid', () => {
    const level = clone(baseLevel()) as { entities: Array<{ rect: { x: number } }> };
    level.entities[1].rect.x = 500;
    const result = validateLevel(level);
    const warn = result.errors.find(
      (e) => e.path === 'entities[1].rect.x' && e.severity === 'warning',
    );
    expect(warn).toBeDefined();
    expect(result.valid).toBe(true);
  });

  it('rejects non-positive rect.width', () => {
    const level = clone(baseLevel()) as {
      entities: Array<{ rect: { width: number } }>;
    };
    level.entities[1].rect.width = 0;
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities[1].rect.width')).toBe(true);
  });

  it('rejects duplicate entity IDs', () => {
    const level = clone(baseLevel()) as { entities: Array<{ id: number }> };
    level.entities[1].id = 1;
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities[1].id')).toBe(true);
  });

  it('rejects non-integer entity IDs', () => {
    const level = clone(baseLevel()) as { entities: Array<{ id: number }> };
    level.entities[1].id = 2.5;
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities[1].id')).toBe(true);
  });

  it('rejects a non-array entities field', () => {
    const level = clone(baseLevel()) as Record<string, unknown>;
    level.entities = { 0: 'not an array' };
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities')).toBe(true);
  });

  it('rejects an entity that is not an object', () => {
    const level = clone(baseLevel()) as { entities: unknown[] };
    level.entities[1] = 'oops';
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities[1]')).toBe(true);
  });
});

describe('validateLevel — cardinality (spawn / exit)', () => {
  it('rejects zero spawns', () => {
    const level = clone(baseLevel()) as {
      entities: Array<Record<string, unknown>>;
    };
    level.entities[0].kind = 'platform';
    level.entities[0].props = { visual: 'normal' };
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities' && /exactly one spawn/.test(e.message))).toBe(true);
  });

  it('rejects multiple spawns', () => {
    const level = clone(baseLevel()) as {
      entities: Array<Record<string, unknown>>;
    };
    level.entities.push({
      id: 99,
      kind: 'spawn',
      rect: { x: 20, y: 20, width: 5, height: 5 },
      props: {},
    });
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.path === 'entities' && /exactly one spawn/.test(e.message)),
    ).toBe(true);
  });

  it('rejects zero exits', () => {
    const level = clone(baseLevel()) as {
      entities: Array<Record<string, unknown>>;
    };
    level.entities[1].kind = 'platform';
    level.entities[1].props = { visual: 'normal' };
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities' && /at least one exit/.test(e.message))).toBe(true);
  });
});

describe('validateLevel — per-kind prop shape', () => {
  it('rejects exit with non-boolean isTrap', () => {
    const level = clone(baseLevel()) as {
      entities: Array<Record<string, unknown>>;
    };
    level.entities[1].props = { isTrap: 'yes', locked: false };
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities[1].props.isTrap')).toBe(true);
  });

  it('rejects exit with missing locked', () => {
    const level = clone(baseLevel()) as {
      entities: Array<Record<string, unknown>>;
    };
    level.entities[1].props = { isTrap: false };
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities[1].props.locked')).toBe(true);
  });

  it('rejects movingPlatform with non-array path', () => {
    const level = clone(baseLevel()) as {
      entities: Array<Record<string, unknown>>;
    };
    level.entities[1] = {
      id: 2,
      kind: 'movingPlatform',
      rect: { x: 40, y: 40, width: 20, height: 5 },
      props: { speed: 5, path: 'not an array' },
    };
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities[1].props.path')).toBe(true);
  });

  it('rejects movingPlatform with non-numeric speed', () => {
    const level = clone(baseLevel()) as {
      entities: Array<Record<string, unknown>>;
    };
    level.entities[1] = {
      id: 2,
      kind: 'movingPlatform',
      rect: { x: 40, y: 40, width: 20, height: 5 },
      props: { speed: 'fast', path: [{ x: 0, y: 0 }] },
    };
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities[1].props.speed')).toBe(true);
  });

  it('rejects movingPlatform path with malformed waypoint', () => {
    const level = clone(baseLevel()) as {
      entities: Array<Record<string, unknown>>;
    };
    level.entities[1] = {
      id: 2,
      kind: 'movingPlatform',
      rect: { x: 40, y: 40, width: 20, height: 5 },
      props: { speed: 5, path: [{ x: 0 }, { x: 1, y: 1 }] },
    };
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities[1].props.path[0]')).toBe(true);
  });

  it('rejects trap with missing type', () => {
    const level = clone(baseLevel()) as {
      entities: Array<Record<string, unknown>>;
    };
    level.entities[1] = {
      id: 2,
      kind: 'trap',
      rect: { x: 40, y: 40, width: 10, height: 10 },
      props: { params: {} },
    };
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities[1].props.type')).toBe(true);
  });

  it('rejects trap with non-object params', () => {
    const level = clone(baseLevel()) as {
      entities: Array<Record<string, unknown>>;
    };
    level.entities[1] = {
      id: 2,
      kind: 'trap',
      rect: { x: 40, y: 40, width: 10, height: 10 },
      props: { type: 'spikes', params: 'nope' },
    };
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities[1].props.params')).toBe(true);
  });

  it('rejects decoration with missing sprite', () => {
    const level = clone(baseLevel()) as {
      entities: Array<Record<string, unknown>>;
    };
    level.entities[1] = {
      id: 2,
      kind: 'decoration',
      rect: { x: 40, y: 40, width: 10, height: 10 },
      props: {},
    };
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities[1].props.sprite')).toBe(true);
  });

  it('rejects trigger with missing action', () => {
    const level = clone(baseLevel()) as {
      entities: Array<Record<string, unknown>>;
    };
    level.entities[1] = {
      id: 2,
      kind: 'trigger',
      rect: { x: 40, y: 40, width: 10, height: 10 },
      props: { params: {} },
    };
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'entities[1].props.action')).toBe(true);
  });

  it('rejects unknown kind', () => {
    const level = clone(baseLevel()) as {
      entities: Array<Record<string, unknown>>;
    };
    level.entities[1].kind = 'windTunnel';
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown entity kind/.test(e.message))).toBe(true);
  });
});

describe('validateLevel — never throws on malformed input', () => {
  it('returns invalid result for a string', () => {
    const result = validateLevel('hello');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns invalid result for null', () => {
    const result = validateLevel(null);
    expect(result.valid).toBe(false);
  });

  it('returns invalid result for an array', () => {
    const result = validateLevel([1, 2, 3]);
    expect(result.valid).toBe(false);
  });

  it('returns invalid result for a number', () => {
    const result = validateLevel(42);
    expect(result.valid).toBe(false);
  });

  it('returns invalid result for undefined', () => {
    const result = validateLevel(undefined);
    expect(result.valid).toBe(false);
  });
});
