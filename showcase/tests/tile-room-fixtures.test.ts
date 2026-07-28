import { describe, expect, it } from 'vitest';
import { compileGeneratedLevel } from '../../src/platformer';
import { validateLevel } from '../../src/level';
import {
  TILE_ROOM_COLS,
  TILE_ROOM_ROWS,
  TILE_ROOM_SEMANTICS,
  TILE_ROOM_TILE_SIZE,
  TOPOLOGY_ROOM_ART,
  TOPOLOGY_SHAPES,
  clampCameraToLevel,
  createGeneratedRoomScene,
  createTopologyRoomLevel,
  createTopologyRoomScene,
  parseTileArt,
} from '../sections/tile-room-fixtures';

describe('tile-room fixtures', () => {
  it('parses ragged tile art into a rectangular immutable grid', () => {
    const art = ['#=', '.'];
    const grid = parseTileArt(art, 8);

    expect(grid).toEqual({
      data: [1, 2, 0, 0],
      cols: 2,
      rows: 2,
      tileSize: 8,
    });
    expect(art).toEqual(['#=', '.']);
  });

  it('contains every topology shape required by the visual plan', () => {
    expect(TOPOLOGY_SHAPES.map((shape) => shape.name)).toEqual([
      'isolated',
      'ledge',
      'corner',
      'tunnel',
      'pillar',
      'room',
      'staircase',
    ]);
    for (const shape of TOPOLOGY_SHAPES) {
      expect(shape.grid.data).toHaveLength(shape.grid.cols * shape.grid.rows);
    }
  });

  it('builds a deterministic generated room that compiles through the public seam', () => {
    const first = createGeneratedRoomScene();
    const second = createGeneratedRoomScene();

    expect(first).toEqual(second);
    expect(first.level.tiles.cols).toBe(TILE_ROOM_COLS);
    expect(first.level.tiles.rows).toBe(TILE_ROOM_ROWS);
    expect(first.level.tileSize).toBe(TILE_ROOM_TILE_SIZE);
    expect(() => compileGeneratedLevel(first)).not.toThrow();
  });

  it('builds a topology room larger than its viewport on both axes', () => {
    const scene = createTopologyRoomScene();
    expect(scene.level.width).toBeGreaterThan(600);
    expect(scene.level.height).toBeGreaterThan(400);
    expect(() => compileGeneratedLevel(scene)).not.toThrow();
  });

  it('clamps static cameras and centers levels smaller than the viewport', () => {
    expect(clampCameraToLevel(999, -20, { width: 960, height: 544 })).toEqual({
      x: 360,
      y: 0,
    });
    expect(clampCameraToLevel(0, 0, { width: 320, height: 200 })).toEqual({
      x: -140,
      y: -100,
    });
  });
});

describe('topology shapes carry the geometry their names claim', () => {
  it('leaves the isolated cell with no orthogonal neighbour', () => {
    const shape = TOPOLOGY_SHAPES.find((s) => s.name === 'isolated');
    expect(shape).toBeDefined();
    const { data, cols, rows } = shape!.grid;
    const solid = data.flatMap((v, i) => (v !== 0 ? [i] : []));
    expect(solid).toHaveLength(1);

    const col = solid[0] % cols;
    const row = Math.floor(solid[0] / cols);
    for (const [c, r] of [
      [col - 1, row],
      [col + 1, row],
      [col, row - 1],
      [col, row + 1],
    ]) {
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      expect(data[r * cols + c]).toBe(0);
    }
  });

  it('bores a void through the tunnel with solid directly above and below', () => {
    const { data, cols, rows } = TOPOLOGY_SHAPES.find((s) => s.name === 'tunnel')!.grid;
    let found = false;
    for (let r = 1; r < rows - 1 && !found; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if (data[r * cols + c] !== 0) continue;
        if (data[(r - 1) * cols + c] !== 0 && data[(r + 1) * cols + c] !== 0) {
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('gives every shape at least one solid cell to render', () => {
    for (const shape of TOPOLOGY_SHAPES) {
      expect(shape.grid.data.some((v) => v !== 0)).toBe(true);
    }
  });
});

describe('topology room level', () => {
  it('is the rectangle the benchmark fixtures assume', () => {
    expect(TOPOLOGY_ROOM_ART).toHaveLength(TILE_ROOM_ROWS);
    for (const line of TOPOLOGY_ROOM_ART) {
      expect(line).toHaveLength(TILE_ROOM_COLS);
    }
  });

  it('passes the engine level validator', () => {
    const result = validateLevel(createTopologyRoomLevel());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('seats the spawn above the floor rather than inside it', () => {
    const level = createTopologyRoomLevel();
    const { data, cols, tileSize } = level.tiles;
    const col = Math.floor(level.spawn.x / tileSize);
    const spawnRow = Math.floor(level.spawn.y / tileSize);
    expect(data[spawnRow * cols + col]).toBe(0);
    expect(data[(spawnRow + 2) * cols + col]).not.toBe(0);
  });

  it('carries a moving platform, so some consumer must substitute a runtime rect', () => {
    expect(
      createTopologyRoomLevel().entities.some((e) => e.kind === 'movingPlatform'),
    ).toBe(true);
  });

  it('places collectibles in empty cells rather than embedding them in terrain', () => {
    const level = createTopologyRoomLevel();
    for (const entity of level.entities.filter((item) => item.kind === 'collectible')) {
      const col = Math.floor((entity.rect.x + entity.rect.width / 2) / level.tileSize);
      const row = Math.floor((entity.rect.y + entity.rect.height / 2) / level.tileSize);
      expect(level.tiles.data[row * level.tiles.cols + col]).toBe(0);
    }
  });

  it('contains a visible trigger region for the marker toggle', () => {
    const trigger = createTopologyRoomLevel().entities.find((entity) => entity.kind === 'trigger');
    expect(trigger).toBeDefined();
    expect(trigger?.rect.width).toBeGreaterThan(TILE_ROOM_TILE_SIZE);
    expect(trigger?.rect.height).toBeGreaterThan(TILE_ROOM_TILE_SIZE);
  });

  it('scales tiles and entity geometry together, so the scale sheet compares like with like', () => {
    const at16 = createTopologyRoomLevel(16);
    const at32 = createTopologyRoomLevel(32);
    expect(at32.width).toBe(at16.width * 2);
    expect(at32.height).toBe(at16.height * 2);
    expect(at32.entities).toHaveLength(at16.entities.length);
    for (let i = 0; i < at16.entities.length; i++) {
      expect(at32.entities[i].rect.x).toBe(at16.entities[i].rect.x * 2);
      expect(at32.entities[i].rect.width).toBe(at16.entities[i].rect.width * 2);
    }
  });

  it('hands out an independent level on every call', () => {
    const a = createTopologyRoomLevel();
    const b = createTopologyRoomLevel();
    expect(a).not.toBe(b);
    expect(a.tiles.data).not.toBe(b.tiles.data);
    expect(a.tiles.data).toEqual(b.tiles.data);
  });
});

describe('compiled scenes', () => {
  it('lifts tile geometry into collision solids for both validation scenes', () => {
    for (const scene of [createGeneratedRoomScene(), createTopologyRoomScene()]) {
      const compiled = compileGeneratedLevel(scene);
      expect(compiled.staticSolids.length).toBeGreaterThan(0);
      expect(compiled.initialState.core.x).toBe(scene.level.spawn.x);
    }
  });

  it('classifies fixture tile values the way the shared semantics say', () => {
    const compiled = compileGeneratedLevel({
      level: createTopologyRoomLevel(),
      tileSemantics: TILE_ROOM_SEMANTICS,
    });
    // (0, 0) is the room's solid shell; (2, 2) is interior air.
    expect(compiled.tileQuery(0, 0)).toBe('solid');
    expect(compiled.tileQuery(2, 2)).toBe('empty');
  });
});
