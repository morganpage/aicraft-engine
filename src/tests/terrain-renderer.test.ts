import { createCanvas } from 'canvas';
import { describe, expect, it, vi } from 'vitest';
import {
  CAVERN_TERRAIN_MATERIAL,
  computeRectExposures,
  createTerrainConnectionTable,
  createTerrainMaterialTable,
  drawTerrainRect,
  drawTerrainTiles,
  OUTDOOR_TERRAIN_MATERIAL,
} from '../terrain';
import type { TileGrid } from '../level/types';

const grid: TileGrid = {
  cols: 3,
  rows: 2,
  tileSize: 16,
  data: [1, 1, 0, 0, 1, 0],
};

function renderTiles(viewX = 0): Uint8Array {
  const canvas = createCanvas(48, 32);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  const materials = createTerrainMaterialTable({
    1: { id: 'cave', palette: { fill: '#51445d' }, surfaceDetail: 'cracks' },
  });
  drawTerrainTiles(ctx, grid, {
    visualSeed: 42,
    view: { x: viewX, y: 0, width: 48, height: 32 },
    devicePixelRatio: 1,
    materials,
    connections: createTerrainConnectionTable(grid, (a, b) => a === b),
  });
  return canvas.toBuffer('image/png') as Uint8Array;
}

describe('terrain renderers', () => {
  it('renders tile terrain deterministically', () => {
    expect(renderTiles()).toEqual(renderTiles());
  });

  it('culls cells outside the authoritative viewport', () => {
    expect(renderTiles(100)).not.toEqual(renderTiles());
  });

  it.each([
    [8, 1], [8, 1.25], [8, 1.5], [8, 1.75], [8, 2], [8, 3],
    [16, 1], [16, 1.25], [16, 1.5], [16, 1.75], [16, 2], [16, 3],
    [32, 1], [32, 1.25], [32, 1.5], [32, 1.75], [32, 2], [32, 3],
    [9, 1.3],
  ])('keeps a connected shared edge covered at %ipx / DPR %s', (tileSize, dpr) => {
    const width = Math.ceil(tileSize * 2 * dpr);
    const height = Math.ceil(tileSize * dpr);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const pair: TileGrid = { cols: 2, rows: 1, tileSize, data: [1, 1] };
    drawTerrainTiles(ctx as unknown as CanvasRenderingContext2D, pair, {
      visualSeed: 1,
      view: { x: 0, y: 0, width: tileSize * 2, height: tileSize },
      devicePixelRatio: dpr,
      materials: createTerrainMaterialTable({ 1: { id: 'seam', palette: { fill: '#777777' } } }),
      connections: createTerrainConnectionTable(pair, (a, b) => a === b),
    });
    const seam = Math.round(tileSize * dpr);
    const y = Math.max(0, Math.floor(height / 2));
    const pixels = ctx.getImageData(Math.max(0, seam - 1), y, Math.min(3, width), 1).data;
    for (let i = 3; i < pixels.length; i += 4) expect(pixels[i]).toBe(255);
  });

  it('draws connected tiles as one seamless lit mass without outline pixels', () => {
    const canvas = createCanvas(32, 32);
    const ctx = canvas.getContext('2d');
    const connected: TileGrid = {
      cols: 2,
      rows: 2,
      tileSize: 16,
      data: [1, 1, 1, 1],
    };
    drawTerrainTiles(ctx as unknown as CanvasRenderingContext2D, connected, {
      visualSeed: 1,
      view: { x: 0, y: 0, width: 32, height: 32 },
      devicePixelRatio: 1,
      materials: createTerrainMaterialTable({
        1: {
          id: 'seamless',
          palette: {
            fill: '#445566',
            top: '#88aa77',
            side: '#223344',
            outline: '#ff00ff',
          },
          topThickness: 3,
          sideDepth: 4,
        },
      }),
      connections: createTerrainConnectionTable(connected, (a, b) => a === b),
    });

    const rgba = (x: number, y: number): readonly number[] =>
      [...ctx.getImageData(x, y, 1, 1).data];
    expect(rgba(15, 0)).toEqual([136, 170, 119, 255]);
    expect(rgba(16, 0)).toEqual([136, 170, 119, 255]);
    expect(rgba(15, 15)).toEqual([68, 85, 102, 255]);
    expect(rgba(16, 16)).toEqual([68, 85, 102, 255]);
    expect(rgba(15, 31)).toEqual([34, 51, 68, 255]);
    expect(rgba(16, 31)).toEqual([34, 51, 68, 255]);

    const pixels = ctx.getImageData(0, 0, 32, 32).data;
    for (let i = 0; i < pixels.length; i += 4) {
      expect([pixels[i], pixels[i + 1], pixels[i + 2]]).not.toEqual([255, 0, 255]);
    }
  });

  it('keeps the outdoor terrain body plain between its grass and dark mud edges', () => {
    const canvas = createCanvas(20, 24);
    const ctx = canvas.getContext('2d');
    ctx.translate(2, 4);
    const earth: TileGrid = { cols: 1, rows: 1, tileSize: 16, data: [1] };
    drawTerrainTiles(ctx as unknown as CanvasRenderingContext2D, earth, {
      visualSeed: 7,
      view: { x: 0, y: 0, width: 16, height: 16 },
      devicePixelRatio: 1,
      materials: createTerrainMaterialTable({ 1: OUTDOOR_TERRAIN_MATERIAL }),
      connections: createTerrainConnectionTable(earth, (a, b) => a === b),
    });

    const middle = ctx.getImageData(10, 12, 1, 1).data;
    expect([...middle]).toEqual([118, 80, 53, 255]);
    const top = ctx.getImageData(10, 4, 1, 1).data;
    expect([...top]).toEqual([111, 159, 70, 255]);
    const bottom = ctx.getImageData(10, 19, 1, 1).data;
    expect([...bottom]).toEqual([66, 44, 32, 255]);
  });

  it('isolates a throwing detail renderer per tile', () => {
    const canvas = createCanvas(48, 32);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    const detail = vi.fn(() => { throw new Error('detail'); });
    drawTerrainTiles(ctx, grid, {
      visualSeed: 1,
      view: { x: 0, y: 0, width: 48, height: 32 },
      devicePixelRatio: 1,
      materials: createTerrainMaterialTable({ 1: { id: 'x', palette: { fill: '#555555' } } }),
      connections: createTerrainConnectionTable(grid, (a, b) => a === b),
      drawDetail: detail,
    });
    expect(detail).toHaveBeenCalledTimes(3);
  });

  it('isolates a throwing edge-detail renderer per tile', () => {
    const canvas = createCanvas(48, 32);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    const detail = vi.fn(() => { throw new Error('edge detail'); });
    drawTerrainTiles(ctx, grid, {
      visualSeed: 1,
      view: { x: 0, y: 0, width: 48, height: 32 },
      devicePixelRatio: 1,
      materials: createTerrainMaterialTable({ 1: { id: 'x', palette: { fill: '#555555' } } }),
      connections: createTerrainConnectionTable(grid, (a, b) => a === b),
      drawEdgeDetail: detail,
    });
    expect(detail).toHaveBeenCalledTimes(3);
  });

  it('honors partial rect exposure and gives hazards a pointed silhouette', () => {
    const canvas = createCanvas(64, 32);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    const exposure = computeRectExposures([
      { key: 1, familyId: 1, rect: { x: 0, y: 16, width: 48, height: 16 } },
      { key: 2, familyId: 1, rect: { x: 0, y: 0, width: 16, height: 16 } },
    ]).get(1);
    expect(exposure?.top).toEqual([{ start: 16, end: 48 }]);
    drawTerrainRect(ctx, { x: 0, y: 16, width: 48, height: 16 }, {
      visualSeed: 1, devicePixelRatio: 1, entityKey: 1, role: 'solid',
      material: CAVERN_TERRAIN_MATERIAL, exposure,
    });
    drawTerrainRect(ctx, { x: 48, y: 16, width: 16, height: 16 }, {
      visualSeed: 1, devicePixelRatio: 1, entityKey: 2, role: 'hazard',
      material: CAVERN_TERRAIN_MATERIAL,
    });
    expect(canvas.toBuffer('image/png').length).toBeGreaterThan(100);
  });
});
