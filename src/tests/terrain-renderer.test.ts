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
    const sampleX = Math.max(0, seam - 2);
    const sampleWidth = Math.min(5, width - sampleX);
    const sampleRows = [
      Math.min(height - 1, Math.max(0, Math.ceil(dpr))),
      Math.max(0, Math.floor(height / 2)),
      Math.max(0, height - Math.max(1, Math.ceil(2 * dpr))),
    ];
    for (const y of sampleRows) {
      const pixels = ctx.getImageData(sampleX, y, sampleWidth, 1).data;
      const colors = new Set<string>();
      for (let i = 0; i < pixels.length; i += 4) {
        expect(pixels[i + 3]).toBe(255);
        colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      }
      expect(colors.size).toBe(1);
    }
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

  it.each([1, 1.25, 1.5, 1.75, 2, 3])(
    'keeps Outdoor cap and underside colors continuous across cells at DPR %s',
    (dpr) => {
      const tileSize = 16;
      const cols = 4;
      const width = Math.ceil(tileSize * cols * dpr);
      const height = Math.ceil(tileSize * dpr);
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      const earth: TileGrid = {
        cols,
        rows: 1,
        tileSize,
        data: new Array<number>(cols).fill(1),
      };
      drawTerrainTiles(ctx as unknown as CanvasRenderingContext2D, earth, {
        visualSeed: 91,
        view: { x: 0, y: 0, width: tileSize * cols, height: tileSize },
        devicePixelRatio: dpr,
        materials: createTerrainMaterialTable({ 1: OUTDOOR_TERRAIN_MATERIAL }),
        connections: createTerrainConnectionTable(earth, (a, b) => a === b),
      });

      const rows = [
        Math.min(height - 1, Math.ceil(2 * dpr)),
        Math.max(0, height - Math.ceil(2 * dpr)),
      ];
      for (const y of rows) {
        const pixels = ctx.getImageData(2, y, width - 4, 1).data;
        const colors = new Set<string>();
        for (let i = 0; i < pixels.length; i += 4) {
          colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]},${pixels[i + 3]}`);
        }
        expect(colors.size).toBe(1);
      }
    },
  );

  it('draws connected Outdoor caps and undersides as continuous spans', () => {
    const tileSize = 16;
    const cols = 7;
    const rows = 2;
    const canvas = createCanvas(cols * tileSize, rows * tileSize);
    const ctx = canvas.getContext('2d');
    const fills: Array<{
      readonly style: string;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }> = [];
    const pathFills: string[] = [];
    const fillRect = ctx.fillRect.bind(ctx);
    const fill = ctx.fill.bind(ctx);
    vi.spyOn(ctx, 'fillRect').mockImplementation((x, y, width, height) => {
      fills.push({ style: String(ctx.fillStyle), x, y, width, height });
      fillRect(x, y, width, height);
    });
    vi.spyOn(ctx, 'fill').mockImplementation((...args) => {
      pathFills.push(String(ctx.fillStyle));
      fill(...args);
    });
    const earth: TileGrid = {
      cols,
      rows,
      tileSize,
      // A long two-tile-deep platform with the exposed step visible in the
      // reported screenshot.
      data: [
        1, 1, 1, 1, 1, 1, 0,
        1, 1, 1, 1, 1, 1, 1,
      ],
    };
    const material = {
      id: 'outdoor-span-regression',
      palette: OUTDOOR_TERRAIN_MATERIAL.palette,
      topThickness: 4,
      sideDepth: 5,
      cornerSize: 0,
      edgeDetail: 'grass' as const,
      edgeDensity: 0,
    };
    drawTerrainTiles(ctx as unknown as CanvasRenderingContext2D, earth, {
      visualSeed: 91,
      view: { x: 0, y: 0, width: cols * tileSize, height: rows * tileSize },
      devicePixelRatio: 1,
      materials: createTerrainMaterialTable({ 1: material }),
      connections: createTerrainConnectionTable(earth, (a, b) => a === b),
    });

    expect(pathFills.filter((style) =>
      style === OUTDOOR_TERRAIN_MATERIAL.palette.top
    )).toHaveLength(2);
    expect(pathFills.filter((style) =>
      style === OUTDOOR_TERRAIN_MATERIAL.palette.side
    )).toHaveLength(1);
    expect(fills.some(({ style, y, height }) =>
      style === OUTDOOR_TERRAIN_MATERIAL.palette.side && y === 27 && height === 5
    )).toBe(false);
  });

  it('rounds exposed Outdoor top and dark-mud corners without changing collision bounds', () => {
    const canvas = createCanvas(24, 24);
    const ctx = canvas.getContext('2d');
    ctx.translate(4, 4);
    const earth: TileGrid = { cols: 1, rows: 1, tileSize: 16, data: [1] };
    drawTerrainTiles(ctx as unknown as CanvasRenderingContext2D, earth, {
      visualSeed: 7,
      view: { x: 0, y: 0, width: 16, height: 16 },
      devicePixelRatio: 1,
      materials: createTerrainMaterialTable({
        1: {
          ...OUTDOOR_TERRAIN_MATERIAL,
          edgeDensity: 0,
        },
      }),
      connections: createTerrainConnectionTable(earth, (a, b) => a === b),
    });

    expect(ctx.getImageData(4, 4, 1, 1).data[3]).toBeLessThan(128);
    expect(ctx.getImageData(7, 4, 1, 1).data[3]).toBe(255);
    expect(ctx.getImageData(4, 7, 1, 1).data[3]).toBe(255);
    expect(ctx.getImageData(19, 19, 1, 1).data[3]).toBeLessThan(128);
    expect(ctx.getImageData(16, 19, 1, 1).data[3]).toBe(255);
  });

  it('makes the lower grass edge more organic than its upper edge', () => {
    const width = 128;
    const surfaceY = 8;
    const capHeight = 4;
    const canvas = createCanvas(width, 32);
    const ctx = canvas.getContext('2d');
    ctx.translate(0, surfaceY);
    const earth: TileGrid = {
      cols: 8,
      rows: 1,
      tileSize: 16,
      data: new Array<number>(8).fill(1),
    };
    drawTerrainTiles(ctx as unknown as CanvasRenderingContext2D, earth, {
      visualSeed: 91,
      view: { x: 0, y: 0, width, height: 16 },
      devicePixelRatio: 1,
      materials: createTerrainMaterialTable({
        1: {
          id: 'organic-grass-test',
          palette: OUTDOOR_TERRAIN_MATERIAL.palette,
          topThickness: capHeight,
          sideDepth: 5,
          cornerSize: 0,
          edgeDetail: 'grass',
          edgeDensity: 0,
        },
      }),
      connections: createTerrainConnectionTable(earth, (a, b) => a === b),
      drawEdgeDetail: () => {},
    });

    const image = ctx.getImageData(0, 0, width, 32).data;
    const topCoverages = new Set<number>();
    const bottomDrops = new Set<number>();
    let maxTopLift = 0;
    let maxBottomDrop = 0;
    for (let x = 2; x < width - 2; x++) {
      let firstPainted = surfaceY;
      for (let y = 0; y < surfaceY; y++) {
        if (image[(y * width + x) * 4 + 3] !== 0) {
          firstPainted = y;
          break;
        }
      }
      const topLift = surfaceY - firstPainted;
      topCoverages.add(image[((surfaceY - 1) * width + x) * 4 + 3] ?? 0);
      maxTopLift = Math.max(maxTopLift, topLift);

      let deepestGreen = surfaceY + capHeight - 1;
      for (let y = surfaceY + capHeight; y < surfaceY + 10; y++) {
        const i = (y * width + x) * 4;
        if (
          image[i] !== 118 ||
          image[i + 1] !== 80 ||
          image[i + 2] !== 53
        ) {
          deepestGreen = y;
        }
      }
      const bottomDrop = deepestGreen - (surfaceY + capHeight - 1);
      bottomDrops.add(bottomDrop);
      maxBottomDrop = Math.max(maxBottomDrop, bottomDrop);
    }

    expect(topCoverages.size).toBeGreaterThan(1);
    expect(bottomDrops.size).toBeGreaterThan(1);
    expect(maxTopLift).toBeLessThanOrEqual(1);
    expect(maxBottomDrop).toBeGreaterThan(maxTopLift);
  });

  it('makes the upper dark-mud edge more organic than its lower edge', () => {
    const width = 128;
    const originY = 4;
    const tileSize = 16;
    const sideDepth = 5;
    const sideTop = originY + tileSize - sideDepth;
    const tileBottom = originY + tileSize;
    const canvas = createCanvas(width, 28);
    const ctx = canvas.getContext('2d');
    ctx.translate(0, originY);
    const earth: TileGrid = {
      cols: 8,
      rows: 1,
      tileSize,
      data: new Array<number>(8).fill(1),
    };
    drawTerrainTiles(ctx as unknown as CanvasRenderingContext2D, earth, {
      visualSeed: 91,
      view: { x: 0, y: 0, width, height: tileSize },
      devicePixelRatio: 1,
      materials: createTerrainMaterialTable({
        1: {
          id: 'organic-mud-test',
          palette: OUTDOOR_TERRAIN_MATERIAL.palette,
          topThickness: 4,
          sideDepth,
          cornerSize: 0,
          edgeDetail: 'grass',
          edgeDensity: 0,
        },
      }),
      connections: createTerrainConnectionTable(earth, (a, b) => a === b),
      drawEdgeDetail: () => {},
    });

    const image = ctx.getImageData(0, 0, width, 28).data;
    const topRises = new Set<number>();
    const bottomCoverages = new Set<number>();
    let maxTopRise = 0;
    let maxBottomDrop = 0;
    for (let x = 2; x < width - 2; x++) {
      let firstMud = sideTop;
      for (let y = sideTop - 4; y < sideTop; y++) {
        const i = (y * width + x) * 4;
        if (
          image[i] !== 118 ||
          image[i + 1] !== 80 ||
          image[i + 2] !== 53
        ) {
          firstMud = y;
          break;
        }
      }
      const topRise = sideTop - firstMud;
      topRises.add(topRise);
      maxTopRise = Math.max(maxTopRise, topRise);

      let deepestMud = tileBottom - 1;
      for (let y = tileBottom; y < tileBottom + 4; y++) {
        if (image[(y * width + x) * 4 + 3] !== 0) deepestMud = y;
      }
      const bottomDrop = deepestMud - (tileBottom - 1);
      bottomCoverages.add(image[(tileBottom * width + x) * 4 + 3] ?? 0);
      maxBottomDrop = Math.max(maxBottomDrop, bottomDrop);
    }

    expect(topRises.size).toBeGreaterThan(1);
    expect(bottomCoverages.size).toBeGreaterThan(1);
    expect(maxTopRise).toBeGreaterThan(maxBottomDrop);
    expect(maxBottomDrop).toBeLessThanOrEqual(1);
  });

  it('gives exposed light-mud walls a subtle continuous organic contour', () => {
    const tileSize = 16;
    const rows = 6;
    const originX = 8;
    const canvas = createCanvas(32, rows * tileSize);
    const ctx = canvas.getContext('2d');
    ctx.translate(originX, 0);
    const column: TileGrid = {
      cols: 1,
      rows,
      tileSize,
      data: new Array<number>(rows).fill(1),
    };
    drawTerrainTiles(ctx as unknown as CanvasRenderingContext2D, column, {
      visualSeed: 91,
      view: { x: 0, y: 0, width: tileSize, height: rows * tileSize },
      devicePixelRatio: 1,
      materials: createTerrainMaterialTable({
        1: {
          id: 'organic-mud-wall-test',
          palette: OUTDOOR_TERRAIN_MATERIAL.palette,
          topThickness: 4,
          sideDepth: 5,
          cornerSize: 3,
          edgeDetail: 'grass',
          edgeDensity: 0,
        },
      }),
      connections: createTerrainConnectionTable(column, (a, b) => a === b),
      drawEdgeDetail: () => {},
    });

    const image = ctx.getImageData(0, 0, 32, rows * tileSize).data;
    const leftCoverages = new Set<number>();
    const rightCoverages = new Set<number>();
    for (let y = tileSize; y < (rows - 1) * tileSize; y++) {
      leftCoverages.add(image[(y * 32 + originX) * 4 + 3] ?? 0);
      rightCoverages.add(image[(y * 32 + originX + tileSize - 1) * 4 + 3] ?? 0);
      expect(image[(y * 32 + originX + 1) * 4 + 3]).toBe(255);
      expect(image[(y * 32 + originX + tileSize - 2) * 4 + 3]).toBe(255);
    }

    expect(leftCoverages.size).toBeGreaterThan(1);
    expect(rightCoverages.size).toBeGreaterThan(1);
  });

  it('keeps grass tufts occasional and no more than three pixels tall', () => {
    const width = 128;
    const surfaceY = 10;
    const canvas = createCanvas(width, 32);
    const ctx = canvas.getContext('2d');
    ctx.translate(0, surfaceY);
    const earth: TileGrid = {
      cols: 8,
      rows: 1,
      tileSize: 16,
      data: new Array<number>(8).fill(1),
    };
    drawTerrainTiles(ctx as unknown as CanvasRenderingContext2D, earth, {
      visualSeed: 91,
      view: { x: 0, y: 0, width, height: 16 },
      devicePixelRatio: 1,
      materials: createTerrainMaterialTable({ 1: OUTDOOR_TERRAIN_MATERIAL }),
      connections: createTerrainConnectionTable(earth, (a, b) => a === b),
    });

    const pixels = ctx.getImageData(0, 0, width, surfaceY).data;
    let darkContourPixels = 0;
    let maxDarkHeight = 0;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < surfaceY; y++) {
        const i = (y * width + x) * 4;
        if (
          pixels[i] === 52 &&
          pixels[i + 1] === 91 &&
          pixels[i + 2] === 45 &&
          pixels[i + 3] === 255
        ) {
          darkContourPixels++;
          maxDarkHeight = Math.max(maxDarkHeight, surfaceY - y);
        }
      }
    }
    expect(darkContourPixels).toBeGreaterThan(0);
    expect(darkContourPixels).toBeLessThan(width / 6);
    expect(maxDarkHeight).toBeLessThanOrEqual(3);
  });

  it('uses varied outline-free square shading for stonework without tile-border seams', () => {
    const width = 128;
    const surfaceY = 12;
    const tileSize = 16;
    const canvas = createCanvas(width, 36);
    const ctx = canvas.getContext('2d');
    ctx.translate(0, surfaceY);
    const stone: TileGrid = {
      cols: 8,
      rows: 1,
      tileSize,
      data: new Array<number>(8).fill(1),
    };
    drawTerrainTiles(ctx as unknown as CanvasRenderingContext2D, stone, {
      visualSeed: 37,
      view: { x: 0, y: 0, width, height: tileSize },
      devicePixelRatio: 1,
      materials: createTerrainMaterialTable({
        1: {
          id: 'stonework',
          palette: {
            fill: '#735846',
            top: '#b49872',
            side: '#594033',
            outline: '#241b1c',
            detail: '#49352c',
          },
          edgeDetail: 'stonework',
          edgeDensity: 1,
        },
      }),
      connections: createTerrainConnectionTable(stone, (a, b) => a === b),
    });

    const image = ctx.getImageData(0, surfaceY, width, tileSize).data;
    const colorAt = (x: number, y: number): string => {
      const i = (y * width + x) * 4;
      return `${image[i]},${image[i + 1]},${image[i + 2]}`;
    };
    const bodyColor = colorAt(Math.floor(width / 2), 10);
    let shadePixels = 0;
    let outlinePixels = 0;
    for (let y = 4; y <= 7; y++) {
      for (let x = 1; x < width - 1; x++) {
        const color = colorAt(x, y);
        if (color !== bodyColor) shadePixels++;
        if (color === '36,27,28') outlinePixels++;
      }
    }
    expect(shadePixels).toBeGreaterThan(0);
    expect(outlinePixels).toBe(0);

    const tileSamples = new Set<string>();
    for (let tile = 0; tile < stone.cols; tile++) {
      const startX = tile * tileSize;
      const sample = [4, 6].map((y) => (
        Array.from({ length: tileSize }, (_, localX) => colorAt(startX + localX, y))
          .join('|')
      )).join('/');
      tileSamples.add(sample);
    }
    expect(tileSamples.size).toBeGreaterThan(3);

    // The broad facets remain an edge treatment; the inner face stays plain.
    const interiorColors = new Set<string>();
    for (let y = 9; y < tileSize - 4; y++) {
      for (let x = 1; x < width - 1; x++) {
        interiorColors.add(colorAt(x, y));
      }
    }
    expect(interiorColors.has('36,27,28')).toBe(false);
    expect(interiorColors.has('73,53,44')).toBe(false);
  });

  it('continues stonework squares through stacked terrain rows', () => {
    const tileSize = 16;
    const cols = 6;
    const rows = 4;
    const width = cols * tileSize;
    const height = rows * tileSize;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const wall: TileGrid = {
      cols,
      rows,
      tileSize,
      data: new Array<number>(cols * rows).fill(1),
    };
    drawTerrainTiles(ctx as unknown as CanvasRenderingContext2D, wall, {
      visualSeed: 37,
      view: { x: 0, y: 0, width, height },
      devicePixelRatio: 1,
      materials: createTerrainMaterialTable({
        1: {
          id: 'stacked-stonework',
          palette: {
            fill: '#808080',
            top: '#c0c0c0',
            side: '#606060',
            outline: '#202020',
            detail: '#404040',
          },
          edgeDetail: 'stonework',
          edgeDensity: 1,
        },
      }),
      connections: createTerrainConnectionTable(wall, (a, b) => a === b),
    });

    const image = ctx.getImageData(0, 0, width, height).data;
    let shadedLowerPixels = 0;
    for (let y = tileSize + 2; y < tileSize * 3 - 2; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        if (
          image[i] !== 128 ||
          image[i + 1] !== 128 ||
          image[i + 2] !== 128
        ) {
          shadedLowerPixels++;
        }
      }
    }
    expect(shadedLowerPixels).toBeGreaterThan(0);
    expect(shadedLowerPixels).toBeLessThan(width * tileSize * 2 * 0.75);

    // No explicit horizontal rule is introduced where stacked tiles meet.
    for (const boundaryY of [tileSize, tileSize * 2]) {
      let outlinePixels = 0;
      for (let x = 0; x < width; x++) {
        const i = (boundaryY * width + x) * 4;
        if (
          image[i] === 32 &&
          image[i + 1] === 32 &&
          image[i + 2] === 32
        ) {
          outlinePixels++;
        }
      }
      expect(outlinePixels).toBe(0);
    }
  });

  it(
    'keeps rocky silhouettes shallow and adds sparse outline-free facets',
    () => {
      const width = 128;
      const surfaceY = 12;
      const canvas = createCanvas(width, 36);
      const ctx = canvas.getContext('2d');
      ctx.translate(0, surfaceY);
      const stone: TileGrid = {
        cols: 8,
        rows: 1,
        tileSize: 16,
        data: new Array<number>(8).fill(1),
      };
      drawTerrainTiles(ctx as unknown as CanvasRenderingContext2D, stone, {
        visualSeed: 37,
        view: { x: 0, y: 0, width, height: 16 },
        devicePixelRatio: 1,
        materials: createTerrainMaterialTable({
          1: {
            id: 'rocky',
            palette: {
              fill: '#735846',
              top: '#b49872',
              side: '#594033',
              outline: '#241b1c',
            },
            edgeDetail: 'rocky',
            edgeDensity: 1,
          },
        }),
        connections: createTerrainConnectionTable(stone, (a, b) => a === b),
      });

      const above = ctx.getImageData(0, 0, width, surfaceY).data;
      let abovePixels = 0;
      let maxLift = 0;
      for (let y = 0; y < surfaceY; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (above[i + 3] === 0) continue;
          abovePixels++;
          maxLift = Math.max(maxLift, surfaceY - y);
        }
      }
      expect(abovePixels).toBeGreaterThan(0);
      expect(maxLift).toBeLessThanOrEqual(2);

      const body = ctx.getImageData(0, surfaceY + 4, width, 8).data;
      const colors = new Map<string, number>();
      let outlinePixels = 0;
      for (let i = 0; i < body.length; i += 4) {
        const color = `${body[i]},${body[i + 1]},${body[i + 2]}`;
        colors.set(color, (colors.get(color) ?? 0) + 1);
        if (color === '36,27,28') outlinePixels++;
      }
      const dominantPixels = Math.max(...colors.values());
      const facetPixels = width * 8 - dominantPixels;
      expect(colors.size).toBeGreaterThan(2);
      expect(facetPixels).toBeGreaterThan(0);
      expect(facetPixels).toBeLessThan(width * 8 * 0.5);
      expect(outlinePixels).toBe(0);

      const below = ctx.getImageData(0, surfaceY + 16, width, 4).data;
      let belowPixels = 0;
      let maxDrop = 0;
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (below[i + 3] === 0) continue;
          belowPixels++;
          maxDrop = Math.max(maxDrop, y + 1);
        }
      }
      expect(belowPixels).toBeGreaterThan(0);
      expect(maxDrop).toBeLessThanOrEqual(2);
    },
  );

  it('continues rocky facets through stacked rows without grid lines', () => {
    const tileSize = 16;
    const cols = 6;
    const rows = 4;
    const width = cols * tileSize;
    const height = rows * tileSize;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const wall: TileGrid = {
      cols,
      rows,
      tileSize,
      data: new Array<number>(cols * rows).fill(1),
    };
    drawTerrainTiles(ctx as unknown as CanvasRenderingContext2D, wall, {
      visualSeed: 73,
      view: { x: 0, y: 0, width, height },
      devicePixelRatio: 1,
      materials: createTerrainMaterialTable({
        1: {
          id: 'stacked-rocky',
          palette: {
            fill: '#808080',
            top: '#c0c0c0',
            side: '#606060',
            outline: '#202020',
            detail: '#404040',
            accent: '#d0d0d0',
          },
          edgeDetail: 'rocky',
          edgeDensity: 1,
        },
      }),
      connections: createTerrainConnectionTable(wall, (a, b) => a === b),
    });

    const image = ctx.getImageData(0, 0, width, height).data;
    let facetPixels = 0;
    for (let y = tileSize + 2; y < tileSize * 3 - 2; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        if (
          image[i] !== 128 ||
          image[i + 1] !== 128 ||
          image[i + 2] !== 128
        ) {
          facetPixels++;
        }
      }
    }
    expect(facetPixels).toBeGreaterThan(0);
    expect(facetPixels).toBeLessThan(width * tileSize * 2 * 0.5);

    for (const boundaryY of [tileSize, tileSize * 2]) {
      let outlinePixels = 0;
      for (let x = 0; x < width; x++) {
        const i = (boundaryY * width + x) * 4;
        if (
          image[i] === 32 &&
          image[i + 1] === 32 &&
          image[i + 2] === 32
        ) {
          outlinePixels++;
        }
      }
      expect(outlinePixels).toBe(0);
    }
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

  it('keeps rectangle details opt-in and isolates an injected failure', () => {
    const canvas = createCanvas(64, 32);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    const detail = vi.fn(() => { throw new Error('rect detail'); });

    expect(() => drawTerrainRect(ctx, { x: 0, y: 0, width: 32, height: 16 }, {
      visualSeed: 9,
      devicePixelRatio: 1,
      entityKey: 3,
      role: 'solid',
      material: CAVERN_TERRAIN_MATERIAL,
      drawDetail: detail,
    })).not.toThrow();

    expect(detail).toHaveBeenCalledOnce();
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
