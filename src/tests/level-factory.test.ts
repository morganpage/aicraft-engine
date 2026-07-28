/**
 * Tests for level factory functions — `createLevelScaffold` and
 * `createMinimalValidLevel`.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import { createLevelScaffold, createMinimalValidLevel, validateLevel } from '../level';

describe('createLevelScaffold', () => {
  it('returns a LevelData with expected defaults', () => {
    const scaffold = createLevelScaffold();
    expect(scaffold.version).toBe(1);
    expect(scaffold.id).toBe('');
    expect(scaffold.name).toBe('New Level');
    expect(scaffold.width).toBe(960);
    expect(scaffold.height).toBe(540);
    expect(scaffold.tileSize).toBe(16);
  });

  it('returns an empty tile grid (all zeros)', () => {
    const scaffold = createLevelScaffold();
    const allZero = scaffold.tiles.data.every((v) => v === 0);
    expect(allZero).toBe(true);
    expect(scaffold.tiles.cols).toBe(60); // 960 / 16
    expect(scaffold.tiles.rows).toBe(33); // 540 / 16 (Math.floor)
    expect(scaffold.tiles.tileSize).toBe(16);
  });

  it('returns no entities', () => {
    const scaffold = createLevelScaffold();
    expect(scaffold.entities.length).toBe(0);
  });

  it('starts nextEntityId at DEFAULT_ENTITY_ID_START (1)', () => {
    const scaffold = createLevelScaffold();
    expect(scaffold.nextEntityId).toBe(1);
  });

  it('sets spawn to (0, 0)', () => {
    const scaffold = createLevelScaffold();
    expect(scaffold.spawn).toEqual({ x: 0, y: 0 });
  });

  it('does not set optional fields (bottomLava, hints, flags)', () => {
    const scaffold = createLevelScaffold();
    expect(scaffold.bottomLava).toBeUndefined();
    expect(scaffold.hints).toBeUndefined();
    expect(scaffold.flags).toBeUndefined();
  });

  it('accepts custom id and name', () => {
    const scaffold = createLevelScaffold({ id: 'my-id', name: 'My Level' });
    expect(scaffold.id).toBe('my-id');
    expect(scaffold.name).toBe('My Level');
  });

  it('accepts custom dimensions and tile size', () => {
    const scaffold = createLevelScaffold({
      width: 320,
      height: 240,
      tileSize: 8,
    });
    expect(scaffold.width).toBe(320);
    expect(scaffold.height).toBe(240);
    expect(scaffold.tileSize).toBe(8);
    expect(scaffold.tiles.cols).toBe(40); // 320 / 8
    expect(scaffold.tiles.rows).toBe(30); // 240 / 8
  });

  it('is structurally invalid (no spawn entity, no exit)', () => {
    const scaffold = createLevelScaffold();
    const result = validateLevel(scaffold);
    expect(result.valid).toBe(false);
    // Should have at least errors about missing spawn and exit
    const errorPaths = result.errors.map((e) => e.path);
    expect(errorPaths).toContain('entities');
  });

  it('creates independent copies each call', () => {
    const a = createLevelScaffold({ id: 'a' });
    const b = createLevelScaffold({ id: 'b' });
    expect(a.id).toBe('a');
    expect(b.id).toBe('b');
    // Mutate a's data
    const aData = [...a.tiles.data];
    aData[0] = 99;
    expect(b.tiles.data[0]).toBe(0);
  });
});

describe('createMinimalValidLevel', () => {
  it('returns a valid LevelData (passes validateLevel)', () => {
    const level = createMinimalValidLevel();
    const result = validateLevel(level);
    expect(result.valid).toBe(true);
  });

  it('contains exactly one spawn entity', () => {
    const level = createMinimalValidLevel();
    const spawns = level.entities.filter((e) => e.kind === 'spawn');
    expect(spawns.length).toBe(1);
  });

  it('contains exactly one exit entity (non-trap, non-locked)', () => {
    const level = createMinimalValidLevel();
    const exits = level.entities.filter((e) => e.kind === 'exit');
    expect(exits.length).toBe(1);
    const exit = exits[0];
    if (exit.kind === 'exit') {
      expect(exit.props.isTrap).toBe(false);
      expect(exit.props.locked).toBe(false);
    }
  });

  it('has a bottom row of solid tiles', () => {
    const level = createMinimalValidLevel();
    const { cols, rows } = level.tiles;
    const bottomRow = level.tiles.data.slice((rows - 1) * cols);
    // All tiles in the bottom row should be non-zero (solid)
    for (const v of bottomRow) {
      expect(v).toBeGreaterThan(0);
    }
  });

  it('has coherent spawn coordinates', () => {
    const level = createMinimalValidLevel();
    const spawnEntity = level.entities.find((e) => e.kind === 'spawn');
    expect(spawnEntity).toBeDefined();
    // level.spawn should match the spawn entity's top-left
    expect(level.spawn.x).toBe(spawnEntity!.rect.x);
    expect(level.spawn.y).toBe(spawnEntity!.rect.y);
  });

  it('has correct nextEntityId', () => {
    const level = createMinimalValidLevel();
    // Two entities (spawn, exit), so nextEntityId should be 3
    expect(level.nextEntityId).toBe(3);
  });

  it('accepts custom id, name, dimensions, and tile size', () => {
    const level = createMinimalValidLevel({
      id: 'custom-id',
      name: 'Custom Level',
      width: 640,
      height: 480,
      tileSize: 32,
    });
    expect(level.id).toBe('custom-id');
    expect(level.name).toBe('Custom Level');
    expect(level.width).toBe(640);
    expect(level.height).toBe(480);
    expect(level.tileSize).toBe(32);
    const result = validateLevel(level);
    expect(result.valid).toBe(true);
  });

  it('has the exit positioned near the top-right on the ground', () => {
    const level = createMinimalValidLevel({ width: 320, height: 240, tileSize: 16 });
    const exit = level.entities.find((e) => e.kind === 'exit')!;
    // Exit should be on the ground row (near bottom)
    expect(exit.rect.y).toBe(level.height - level.tileSize * 2);
    expect(exit.rect.x).toBe(level.width - level.tileSize * 2);
  });

  it('always returns a valid level regardless of options shape', () => {
    const variations = [
      createMinimalValidLevel(),
      createMinimalValidLevel({}),
      createMinimalValidLevel({ id: 'test' }),
      createMinimalValidLevel({ width: 160, height: 160, tileSize: 8 }),
      createMinimalValidLevel({ width: 100, height: 100, tileSize: 10 }),
    ];
    for (const level of variations) {
      const result = validateLevel(level);
      expect(result.valid).toBe(true);
    }
  });

  it('creates independent copies each call', () => {
    const a = createMinimalValidLevel({ id: 'a' });
    const b = createMinimalValidLevel({ id: 'b' });
    expect(a.id).toBe('a');
    expect(b.id).toBe('b');
  });

  it('does not set optional fields (bottomLava, hints, flags)', () => {
    const level = createMinimalValidLevel();
    expect(level.bottomLava).toBeUndefined();
    expect(level.hints).toBeUndefined();
    expect(level.flags).toBeUndefined();
  });
});
