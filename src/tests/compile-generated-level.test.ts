/**
 * Tests for `compileGeneratedLevel` — the canonical compile wrapper for
 * generated levels with explicit tile semantics.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import { compileGeneratedLevel, DEFAULT_PLATFORMER_CONFIG } from '../platformer';
import type { LevelData } from '../level/types';
import type { GeneratedTileSemantics } from '../level';

/** A simple valid level for compilation tests. */
function flatLevel(): LevelData {
  return {
    version: 1,
    id: 'generated-test',
    name: 'Generated Test',
    width: 320,
    height: 240,
    tileSize: 16,
    spawn: { x: 32, y: 32 },
    tiles: {
      data: new Array(20 * 15).fill(0),
      cols: 20,
      rows: 15,
      tileSize: 16,
    },
    entities: [
      {
        id: 1,
        kind: 'spawn',
        rect: { x: 32, y: 32, width: 16, height: 16 },
        props: {},
      },
      {
        id: 2,
        kind: 'exit',
        rect: { x: 256, y: 32, width: 16, height: 16 },
        props: { isTrap: false, locked: false },
      },
    ],
    nextEntityId: 3,
  };
}

function solidGroundLevel(): LevelData {
  const cols = 20;
  const rows = 15;
  const data: number[] = new Array(cols * rows).fill(1);
  return {
    version: 1,
    id: 'ground-test',
    name: 'Ground Test',
    width: 320,
    height: 240,
    tileSize: 16,
    spawn: { x: 32, y: 32 },
    tiles: { data, cols, rows, tileSize: 16 },
    entities: [
      {
        id: 1,
        kind: 'spawn',
        rect: { x: 32, y: 32, width: 16, height: 16 },
        props: {},
      },
      {
        id: 2,
        kind: 'exit',
        rect: { x: 256, y: 32, width: 16, height: 16 },
        props: { isTrap: false, locked: false },
      },
    ],
    nextEntityId: 3,
  };
}

function mixedTileLevel(): LevelData {
  const cols = 10;
  const rows = 10;
  const data: number[] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    1, 1, 1, 1, 0, 0, 2, 2, 2, 2,
    1, 1, 1, 1, 0, 0, 2, 2, 2, 2,
    1, 1, 1, 1, 0, 0, 2, 2, 2, 2,
    1, 1, 1, 1, 0, 0, 2, 2, 2, 2,
    1, 1, 1, 1, 0, 0, 2, 2, 2, 2,
    1, 1, 1, 1, 0, 0, 2, 2, 2, 2,
    1, 1, 1, 1, 0, 0, 2, 2, 2, 2,
  ];
  return {
    version: 1,
    id: 'mixed-tiles',
    name: 'Mixed Tiles',
    width: 160,
    height: 160,
    tileSize: 16,
    spawn: { x: 16, y: 16 },
    tiles: { data, cols, rows, tileSize: 16 },
    entities: [
      { id: 1, kind: 'spawn', rect: { x: 16, y: 16, width: 16, height: 16 }, props: {} },
      { id: 2, kind: 'exit', rect: { x: 128, y: 16, width: 16, height: 16 }, props: { isTrap: false, locked: false } },
    ],
    nextEntityId: 3,
  };
}

const semantics: GeneratedTileSemantics = { solid: [1], passthrough: [2] };

describe('compileGeneratedLevel', () => {
  it('produces a CompiledLevel with a defined initialState', () => {
    const compiled = compileGeneratedLevel({ level: flatLevel(), tileSemantics: semantics });
    expect(compiled.initialState).toBeDefined();
    expect(typeof compiled.initialState.core.x).toBe('number');
  });

  it('produces tile solids from "solid" tile values', () => {
    const compiled = compileGeneratedLevel({ level: solidGroundLevel(), tileSemantics: semantics });
    // All tiles are value 1 → all 'solid' → many tile solids
    const tileSolids = compiled.staticSolids.filter((s) => s.id?.startsWith('tile-'));
    expect(tileSolids.length).toBeGreaterThan(0);
  });

  it('produces empty staticSolids when semantics treats all tiles as empty', () => {
    const emptySemantics: GeneratedTileSemantics = { solid: [], passthrough: [] };
    const compiled = compileGeneratedLevel({ level: solidGroundLevel(), tileSemantics: emptySemantics });
    // All tiles are value 1, but 1 is not in solid or passthrough → all 'empty'
    const tileSolids = compiled.staticSolids.filter((s) => s.id?.startsWith('tile-'));
    expect(tileSolids.length).toBe(0);
  });

  it('generates passthrough tile solids for passthrough values', () => {
    const compiled = compileGeneratedLevel({ level: mixedTileLevel(), tileSemantics: semantics });
    // Value 2 tiles → passthrough
    const passthroughSolids = compiled.staticSolids.filter((s) => s.passthrough && s.id?.startsWith('tile-'));
    expect(passthroughSolids.length).toBeGreaterThan(0);
  });

  it('generates solid tile solids for solid values', () => {
    const compiled = compileGeneratedLevel({ level: mixedTileLevel(), tileSemantics: semantics });
    // Value 1 tiles → solid (not passthrough)
    const solidSolids = compiled.staticSolids.filter((s) => !s.passthrough && s.id?.startsWith('tile-'));
    expect(solidSolids.length).toBeGreaterThan(0);
  });

  it('passes through compileLevel options (playerWidth, playerHeight)', () => {
    const compiled = compileGeneratedLevel(
      { level: flatLevel(), tileSemantics: semantics },
      { playerWidth: 24, playerHeight: 32 },
    );
    expect(compiled.initialState.core.width).toBe(24);
    expect(compiled.initialState.core.height).toBe(32);
  });

  it('passes through compileLevel options and config does not throw', () => {
    // Config is accepted by compileLevel and used to initialize ability states;
    // it is not directly exposed on the returned CompiledLevel's initialState.
    // This test verifies that passing a custom config doesn't throw.
    const customConfig = { ...DEFAULT_PLATFORMER_CONFIG, gravity: 800, moveSpeed: 300 };
    expect(() =>
      compileGeneratedLevel(
        { level: flatLevel(), tileSemantics: semantics },
        { config: customConfig },
      ),
    ).not.toThrow();
  });

  it('provides a tileQuery function on the result', () => {
    const compiled = compileGeneratedLevel({ level: mixedTileLevel(), tileSemantics: semantics });
    expect(typeof compiled.tileQuery).toBe('function');
  });

  it('never throws on any input', () => {
    const badInputs = [
      { level: undefined as unknown as LevelData, tileSemantics: semantics },
      { level: null as unknown as LevelData, tileSemantics: semantics },
      { level: {} as LevelData, tileSemantics: semantics },
    ];
    for (const input of badInputs) {
      expect(() => compileGeneratedLevel(input)).not.toThrow();
    }
  });

  it('returns a CompiledLevel with movingPlatforms array', () => {
    const compiled = compileGeneratedLevel({ level: flatLevel(), tileSemantics: semantics });
    expect(Array.isArray(compiled.movingPlatforms)).toBe(true);
  });
});
