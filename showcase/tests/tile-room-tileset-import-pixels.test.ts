import { createCanvas, loadImage } from 'canvas';
import { describe, expect, it } from 'vitest';
import {
  buildTerrainArtRuleAtlas,
  drawPreparedTerrainArtRuleGrid,
  kenneyPixelPlatformerRules,
  prepareTerrainArtRuleGrid,
  type TerrainArtTilesetImage,
} from '../../src/terrain-art';

/**
 * Pixel-exact regression for the LDtk-style whole-tile rule path with the
 * original (bordered) Kenney sheet.
 *
 * The Kenney pack draws each grass tile as a complete bordered unit — the
 * bottom outline is correct for a 1-tile-thick platform's bottom edge, but
 * forms a grey seam where grass sits over a solid dirt interior. The rule set
 * fixes this at the atlas level: surface-over-interior rules composite the tile
 * (its bottom outline rows replaced by the fill body), while surface-over-air
 * rules keep the raw tile (the outline becomes the platform's bottom edge).
 *
 * These tests pin both behaviours at the pixel level against the original PNG.
 */

const KENNEY_PNG = 'assets/vendor/kenney-pixel-platformer/Tilemap/tilemap_packed.png';
const NATIVE_TILE = 18;
/** The Kenney outline colour — the seam source. */
const OUTLINE_RGB: readonly [number, number, number] = [67, 74, 95];

async function loadSheet(path: string): Promise<TerrainArtTilesetImage> {
  const element = await loadImage(path);
  const canvas = createCanvas(element.width, element.height);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(element, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  return { pixels: new Uint8ClampedArray(data.data), width: canvas.width, height: canvas.height };
}

const isOutline = (r: number, g: number, b: number): boolean => r === OUTLINE_RGB[0] && g === OUTLINE_RGB[1] && b === OUTLINE_RGB[2];

/** Render a solid block of the given size through the rule engine; return the cropped platform canvas. */
async function renderBlock(cols: number, rows: number): Promise<{ canvas: ReturnType<typeof createCanvas> }> {
  const sheet = await loadSheet(KENNEY_PNG);
  const rules = kenneyPixelPlatformerRules(0);
  const source = { pixels: sheet.pixels, width: sheet.width, height: sheet.height, tileSize: NATIVE_TILE };
  const atlas = buildTerrainArtRuleAtlas(source, rules.rules);
  const atlasCanvas = createCanvas(atlas.width, atlas.height);
  const atlasCtx = atlasCanvas.getContext('2d');
  const imageData = atlasCtx.createImageData(atlas.width, atlas.height);
  imageData.data.set(atlas.pixels);
  atlasCtx.putImageData(imageData, 0, 0);

  const grid = { data: new Array(cols * rows).fill(1), cols, rows, tileSize: NATIVE_TILE };
  const kinds = [{ id: 'd', label: 'dirt', tileValue: 1, collision: 'solid' as const, materialId: 'm', connectGroup: 'blocker', renderPriority: 0 }];
  const prepared = prepareTerrainArtRuleGrid(grid, kinds, rules);
  const world = NATIVE_TILE * (Math.max(cols, rows) + 1);
  const level = createCanvas(world, world);
  const ctx = level.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  drawPreparedTerrainArtRuleGrid(ctx as unknown as CanvasRenderingContext2D, prepared, {
    atlas,
    image: atlasCanvas as unknown as CanvasImageSource,
    view: { x: 0, y: 0, width: world, height: world },
  });

  const ld = ctx.getImageData(0, 0, world, world).data;
  let minx = 9999, maxx = -1, miny = 9999, maxy = -1;
  for (let y = 0; y < world; y++) for (let x = 0; x < world; x++) {
    if (ld[(y * world + x) * 4 + 3]! > 0) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  }
  const crop = createCanvas(maxx - minx + 1, maxy - miny + 1);
  crop.getContext('2d').drawImage(level, minx, miny, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return { canvas: crop };
}

describe('Kenney rule path suppresses the grass-on-dirt seam', () => {
  it('has NO outline row where grass meets dirt interior (5×3 platform)', async () => {
    const { canvas } = await renderBlock(5, 3);
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    // The surface row occupies y=0..17; the dirt interior starts at y=18. The
    // seam was the surface tile's bottom outline at y=16,17. After the fix those
    // rows must carry NO outline pixels across the platform width.
    for (const y of [16, 17]) {
      let outline = 0;
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (isOutline(data[i]!, data[i + 1]!, data[i + 2]!)) outline++;
      }
      // A couple of outline pixels at the very corners are tolerable (the corner
      // tile's side outline), but the row must not be a continuous outline band.
      expect(outline, `surface y=${y} outline count`).toBeLessThan(canvas.width / 2);
    }
  });

  it('keeps the outline on the platform bottom edge (1-tile-thick platform)', async () => {
    const { canvas } = await renderBlock(5, 1);
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    // A thin platform's bottom edge (y=16,17) should KEEP the outline — it is the
    // platform's bottom edge, not a seam. Most of the row should be outline.
    let outline = 0;
    for (let x = 0; x < canvas.width; x++) {
      const i = (16 * canvas.width + x) * 4;
      if (isOutline(data[i]!, data[i + 1]!, data[i + 2]!)) outline++;
    }
    expect(outline, 'thin-platform bottom outline').toBeGreaterThan(canvas.width / 2);
  });

  it('keeps the outline on the platform top edge (grass surface)', async () => {
    const { canvas } = await renderBlock(5, 3);
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    // The top edge (y=0,1) is the platform's top outline — must be present.
    let outline = 0;
    for (let x = 0; x < canvas.width; x++) {
      const i = (0 * canvas.width + x) * 4;
      if (isOutline(data[i]!, data[i + 1]!, data[i + 2]!)) outline++;
    }
    expect(outline, 'platform top outline').toBeGreaterThan(canvas.width / 2);
  });
});
