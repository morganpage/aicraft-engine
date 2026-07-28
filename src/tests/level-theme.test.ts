import { createCanvas } from 'canvas';
import { describe, expect, it, vi } from 'vitest';
import type { LevelData, LevelEntity } from '../level/types';
import {
  CAVERN_LEVEL_THEME,
  MECHANICAL_LEVEL_THEME,
  OUTDOOR_LEVEL_THEME,
  NON_TERRAIN_KINDS,
  TERRAIN_ROLE_KINDS,
  createLevelThemeRenderer,
  drawPreparedLevelFrame,
  resolveLevelEntities,
  RUINS_LEVEL_THEME,
  type LevelRenderFrame,
  type LevelRenderTheme,
} from '../platformer';

const entities: readonly LevelEntity[] = [
  { id: 1, kind: 'platform', rect: { x: 0, y: 16, width: 32, height: 16 }, props: {} },
  {
    id: 2,
    kind: 'movingPlatform',
    rect: { x: 40, y: 16, width: 16, height: 8 },
    props: { speed: 1, path: [{ x: 40, y: 16 }, { x: 60, y: 16 }] },
  },
  { id: 3, kind: 'collectible', rect: { x: 8, y: 8, width: 4, height: 4 }, props: { kind: 'gem' } },
  { id: 4, kind: 'trap', rect: { x: 24, y: 8, width: 8, height: 8 }, props: { type: 'test', params: {} } },
];

const level: LevelData = {
  version: 1,
  id: 'theme-test',
  name: 'Theme test',
  width: 64,
  height: 32,
  tileSize: 16,
  spawn: { x: 0, y: 0 },
  tiles: { cols: 4, rows: 2, tileSize: 16, data: [1, 1, 0, 0, 0, 0, 0, 0] },
  entities,
  nextEntityId: 5,
};

function frame(overrides: Partial<LevelRenderFrame> = {}): LevelRenderFrame {
  return {
    level,
    devicePixelRatio: 1,
    view: { x: 0, y: 0, width: 64, height: 32 },
    entities: resolveLevelEntities(level.entities, new Map([[2, { x: 48, y: 12, width: 16, height: 8 }]])),
    tick: 10,
    ...overrides,
  };
}

describe('level theme facade', () => {
  it('partitions every entity kind exactly once', () => {
    const all = [...TERRAIN_ROLE_KINDS, ...NON_TERRAIN_KINDS];
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual([
      'collectible', 'decoration', 'enemy', 'exit', 'hazard', 'movingPlatform',
      'passthrough', 'platform', 'spawn', 'trap', 'trigger',
    ]);
  });

  it('prepares connectors once and never invokes them during drawing', () => {
    const connects = vi.fn((a: number, b: number) => a === b);
    const renderer = createLevelThemeRenderer({
      ...CAVERN_LEVEL_THEME,
      terrain: { ...CAVERN_LEVEL_THEME.terrain, connects },
    });
    const scene = renderer.prepare(level);
    const preparedCalls = connects.mock.calls.length;
    const ctx = createCanvas(64, 32).getContext('2d') as unknown as CanvasRenderingContext2D;
    scene.drawTerrainTiles(ctx, frame());
    scene.drawTerrainTiles(ctx, frame());
    expect(preparedCalls).toBeGreaterThan(0);
    expect(connects).toHaveBeenCalledTimes(preparedCalls);
  });

  it('draws each supplied entity in exactly one partition and uses runtime rects', () => {
    const rectDetail = vi.fn();
    const collectible = vi.fn(() => true);
    const trap = vi.fn(() => true);
    const theme: LevelRenderTheme = {
      ...CAVERN_LEVEL_THEME,
      terrain: { ...CAVERN_LEVEL_THEME.terrain, drawRectDetail: rectDetail },
      entityOverrides: { collectible, trap },
    };
    const scene = createLevelThemeRenderer(theme).prepare(level);
    const ctx = createCanvas(64, 32).getContext('2d') as unknown as CanvasRenderingContext2D;
    scene.drawTerrainRects(ctx, frame());
    scene.drawEntities(ctx, frame());
    expect(rectDetail).toHaveBeenCalledTimes(2);
    expect(rectDetail.mock.calls[1]?.[1].x).toBe(48);
    expect(collectible).toHaveBeenCalledTimes(1);
    expect(trap).toHaveBeenCalledTimes(1);
  });

  it('fails closed and diagnoses a mismatched level reference only once', () => {
    const diagnostic = vi.fn();
    const scene = createLevelThemeRenderer(CAVERN_LEVEL_THEME, { onDiagnostic: diagnostic }).prepare(level);
    const canvas = createCanvas(64, 32);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    const other = { ...level };
    const mismatched = frame({ level: other });
    const before = canvas.toBuffer('image/png');
    scene.drawBackground(ctx, mismatched);
    scene.drawTerrainTiles(ctx, mismatched);
    expect(canvas.toBuffer('image/png')).toEqual(before);
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(diagnostic.mock.calls[0]?.[0].code).toBe('scene-mismatch');
  });

  it('keeps screen and world passes ordered and restores the transform', () => {
    const order: string[] = [];
    let resolvedMotion: boolean | undefined;
    const theme: LevelRenderTheme = {
      ...CAVERN_LEVEL_THEME,
      farBackground: (_ctx, currentFrame) => {
        resolvedMotion = currentFrame.reducedMotion;
        order.push('far');
      },
      midBackground: () => order.push('mid'),
      backDecorations: () => order.push('back'),
      frontDecorations: () => order.push('front'),
      foreground: () => order.push('foreground'),
      screenTint: () => order.push('tint'),
    };
    const scene = createLevelThemeRenderer(theme).prepare(level);
    const context = createCanvas(64, 32).getContext('2d');
    const before = context.getTransform();
    drawPreparedLevelFrame(context as unknown as CanvasRenderingContext2D, scene, frame(), {
      drawWorld: () => order.push('world'),
      drawHud: () => order.push('hud'),
    });
    expect(order).toEqual(['far', 'mid', 'back', 'world', 'front', 'foreground', 'tint', 'hud']);
    expect(resolvedMotion).toBeTypeOf('boolean');
    expect(context.getTransform()).toEqual(before);
  });

  it('accepts raster-backed layer callbacks through the same layer contract', () => {
    const image = createCanvas(2, 2);
    const imageCtx = image.getContext('2d');
    imageCtx.fillStyle = '#ff00ff';
    imageCtx.fillRect(0, 0, 2, 2);
    const theme: LevelRenderTheme = {
      ...CAVERN_LEVEL_THEME,
      farBackground(ctx) {
        ctx.drawImage(image as unknown as CanvasImageSource, 0, 0);
      },
    };
    const scene = createLevelThemeRenderer(theme).prepare(level);
    const canvas = createCanvas(64, 32);
    scene.drawBackground(canvas.getContext('2d') as unknown as CanvasRenderingContext2D, frame());
    expect(canvas.getContext('2d').getImageData(0, 0, 1, 1).data[0]).toBe(255);
  });

  it('restores the world transform when a consumer world callback throws', () => {
    const scene = createLevelThemeRenderer(CAVERN_LEVEL_THEME).prepare(level);
    const context = createCanvas(64, 32).getContext('2d');
    const before = context.getTransform();
    expect(() => drawPreparedLevelFrame(
      context as unknown as CanvasRenderingContext2D,
      scene,
      frame(),
      { drawWorld: () => { throw new Error('consumer draw failed'); } },
    )).toThrow('consumer draw failed');
    expect(context.getTransform()).toEqual(before);
  });

  it('ships four visually distinct leaf themes with plain terrain interiors', () => {
    const themes = [
      RUINS_LEVEL_THEME,
      CAVERN_LEVEL_THEME,
      MECHANICAL_LEVEL_THEME,
      OUTDOOR_LEVEL_THEME,
    ];
    expect(themes.map((theme) => theme.id)).toEqual([
      'ruins',
      'cavern',
      'mechanical',
      'outdoor',
    ]);
    expect(new Set(themes.map((theme) => theme.backgroundColor)).size).toBe(4);
    for (const theme of themes) {
      for (const material of Object.values(theme.terrain.tiles)) {
        expect(material.surfaceDetail ?? 'none').toBe('none');
      }
    }
    expect(RUINS_LEVEL_THEME.terrain.tiles[1]?.edgeDetail).toBe('stonework');
    expect(CAVERN_LEVEL_THEME.terrain.tiles[1]?.edgeDetail).toBe('rocky');
    expect(OUTDOOR_LEVEL_THEME.terrain.tiles[1]?.edgeDetail).toBe('grass');
  });
});
