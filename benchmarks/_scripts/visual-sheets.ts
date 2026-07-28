/**
 * Level-visual contact sheets — Phase 0 of
 * `docs/design/level-visual-rendering-plan.md` (§14.6).
 *
 * Renders the review sheets the plan requires, headlessly, via `canvas@3`:
 *
 * | Sheet | What it shows |
 * |---|---|
 * | `baseline-scenes.png`   | Both validation scenes plus the playground, as the engine renders them today |
 * | `topology-sheet.png`    | The seven §14.6 topology shapes, fallback vs production terrain |
 * | `scale-sheet.png`       | The topology room at 8px, 16px, and 32px tiles |
 * | `treatment-compare.png` | Same geometry, same camera, only the treatment varies |
 * | `snapping-junction.png` | The playground's wall/floor junction under a fractional shake offset, at DPR 1, 1.25, 1.5, 2 |
 *
 * Contact-sheet review is **advisory** (§14.6 "What blocks a merge"): these
 * inform a reviewer, they do not mechanically fail a PR. The blocking gate is
 * the §14.5 determinism assertion, which is why this script also renders every
 * sheet twice and reports whether the two passes are byte-identical.
 *
 * Run:
 *
 * ```bash
 * npm run visual:sheets
 * ```
 *
 * Deviation from the plan text, recorded deliberately: §14.6 names
 * `scripts/visual-sheets.ts`. This repository has no `scripts/` directory, and
 * `benchmarks/README.md` requires every committed PNG to be reproducible from a
 * script in `benchmarks/_scripts/`. The script therefore lives here and writes
 * to `benchmarks/visual/`, following the repository convention rather than
 * opening a second home for render scripts.
 */

import { createCanvas, type Canvas } from 'canvas';
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

import { createPlatformerState } from '../../src/platformer';
import type { ActorCore } from '../../src/platformer';
import { sineShake } from '../../src/animation/oscillators';
import type { LevelData, LevelRect } from '../../src/level/types';
import { PLAYGROUND_LEVEL } from '../../showcase/sections/playground';
import {
  createGeneratedRoomScene,
  createTopologyRoomLevel,
  createTopologyRoomScene,
  clampCameraToLevel,
  TOPOLOGY_SHAPES,
  TILE_ROOM_SEED,
  TILE_ROOM_SEMANTICS,
  TILE_ROOM_VIEW_H,
  TILE_ROOM_VIEW_W,
  type TileRoomScene,
} from '../../showcase/sections/tile-room-fixtures';
import {
  drawTileRoomFrame,
  type TileRoomTreatment,
} from '../../showcase/sections/tile-room-render';

const OUTPUT_DIR = 'benchmarks/visual';
const REFERENCE_DIR = join(OUTPUT_DIR, 'reference');

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
if (!existsSync(REFERENCE_DIR)) mkdirSync(REFERENCE_DIR, { recursive: true });

// --- Sheet chrome ----------------------------------------------------------

const SHEET_BG = '#0b070e';
const PANEL_BORDER = '#2d1f38';
const TEXT = '#e4e4e7';
const TEXT_DIM = '#9a94a4';

const HEADER_H = 46;
const LABEL_H = 34;
const GUTTER = 14;

/**
 * `canvas@3`'s context is structurally compatible with the browser's for the
 * subset the library uses, but its declared type is its own. One cast at the
 * boundary keeps every call site below honest about types.
 */
function ctx2d(canvas: Canvas): CanvasRenderingContext2D {
  return canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
}

function drawSheetHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  title: string,
  subtitle: string,
): void {
  ctx.fillStyle = SHEET_BG;
  ctx.fillRect(0, 0, width, HEADER_H);
  ctx.fillStyle = TEXT;
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(title, GUTTER, 22);
  ctx.fillStyle = TEXT_DIM;
  ctx.font = '11px sans-serif';
  ctx.fillText(subtitle, GUTTER, 38);
}

function drawPanelLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  label: string,
  note: string,
): void {
  // Clipped to the panel width: on the dense sheets the labels are wider than
  // their cells, and unclipped text from one cell reads as if it belonged to
  // the next one.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, LABEL_H - 2);
  ctx.clip();
  ctx.fillStyle = TEXT;
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText(label, x, y + 14);
  ctx.fillStyle = TEXT_DIM;
  ctx.font = '10px sans-serif';
  ctx.fillText(note, x, y + 28);
  ctx.restore();
  ctx.strokeStyle = PANEL_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y + LABEL_H - 0.5, width + 1, 1);
}

/** A player body parked at a level's spawn, for scenes rendered without a sim. */
function spawnCore(level: LevelData): ActorCore {
  return createPlatformerState(level.spawn.x, level.spawn.y).core;
}

/** Wrap any level in the scene shape so one draw path serves every capture. */
function asScene(id: string, label: string, level: LevelData): TileRoomScene {
  return { id, label, level, tileSemantics: TILE_ROOM_SEMANTICS };
}

/**
 * Draw one scene panel into `ctx` at `(x, y)`, clipped to the panel rect.
 *
 * Clipping matters: `drawTileRoomFrame` fills its own backdrop across
 * `viewW × viewH` from the current origin, so without a clip a panel would
 * paint over its neighbours.
 */
function drawScenePanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scene: TileRoomScene,
  opts: {
    readonly viewW: number;
    readonly viewH: number;
    readonly camera: { readonly x: number; readonly y: number };
    readonly treatment: TileRoomTreatment;
    readonly dpr?: number;
    readonly showMarkers?: boolean;
    readonly movingRects?: ReadonlyMap<number, LevelRect>;
    readonly player?: ActorCore | null;
    readonly drawLayers?: boolean;
  },
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, opts.viewW, opts.viewH);
  ctx.clip();
  ctx.translate(x, y);
  drawTileRoomFrame(ctx, scene, {
    camera: opts.camera,
    viewW: opts.viewW,
    viewH: opts.viewH,
    dpr: opts.dpr ?? 1,
    player: opts.player === undefined ? spawnCore(scene.level) : opts.player,
    movingRects: opts.movingRects ?? new Map<number, LevelRect>(),
    treatment: opts.treatment,
    showMarkers: opts.showMarkers ?? false,
    worldSeed: TILE_ROOM_SEED,
    drawLayers: opts.drawLayers,
  });
  ctx.restore();
  ctx.strokeStyle = PANEL_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, opts.viewW + 1, opts.viewH + 1);
}

// --- Scenes ----------------------------------------------------------------

const generatedRoom = createGeneratedRoomScene();
const topologyRoom = createTopologyRoomScene();
const playground = asScene('playground', 'Playground (rect-authored)', PLAYGROUND_LEVEL);

/**
 * Framing used for every static capture of a scene.
 *
 * Centres the spawn point and clamps exactly the way `updateCamera` does, so a
 * sheet shows the framing the live section shows on load rather than an
 * arbitrary crop that happens to look good.
 */
function sheetCamera(level: LevelData, viewW: number, viewH: number) {
  return clampCameraToLevel(
    level.spawn.x - viewW / 2,
    level.spawn.y - viewH / 2,
    level,
    viewW,
    viewH,
  );
}

// --- Sheet 1: baseline scenes ---------------------------------------------

function renderBaselineScenes(): Canvas {
  const panelW = TILE_ROOM_VIEW_W;
  const panelH = TILE_ROOM_VIEW_H;
  const width = GUTTER * 4 + panelW * 3;
  const height = HEADER_H + LABEL_H + panelH + GUTTER * 2;
  const canvas = createCanvas(width, height);
  const ctx = ctx2d(canvas);

  ctx.fillStyle = SHEET_BG;
  ctx.fillRect(0, 0, width, height);
  drawSheetHeader(
    ctx,
    width,
    'Level-visual baseline — the renderer as it ships today',
    'Phase 0 comparison baseline. Fallback treatment only: drawTileGrid + drawLevelEntity + drawActor. Everything Phase 1-4 adds is measured against these three frames.',
  );

  const panels: readonly { scene: TileRoomScene; note: string }[] = [
    {
      scene: playground,
      note: 'Entity rectangles, no tiles, world = screen (600x400).',
    },
    {
      scene: generatedRoom,
      note: 'generateLevel(1337) — 60x34 tiles, 960x544 world, camera scrolls.',
    },
    {
      scene: topologyRoom,
      note: 'Hand-authored §14.6 fixture — isolated, ledge, corner, tunnel, pillar, room, staircase.',
    },
  ];

  panels.forEach((p, i) => {
    const x = GUTTER + i * (panelW + GUTTER);
    const y = HEADER_H + GUTTER;
    drawPanelLabel(ctx, x, y, panelW, p.scene.label, p.note);
    drawScenePanel(ctx, x, y + LABEL_H, p.scene, {
      viewW: panelW,
      viewH: panelH,
      camera: sheetCamera(p.scene.level, panelW, panelH),
      treatment: 'fallback',
    });
  });

  return canvas;
}

// --- Sheet 2: topology shapes ---------------------------------------------

function renderTopologySheet(): Canvas {
  const cell = 8 * 16;
  const cols = TOPOLOGY_SHAPES.length;
  const width = GUTTER * (cols + 1) + cell * cols;
  const height = HEADER_H + (LABEL_H + cell + GUTTER) * 2 + GUTTER;
  const canvas = createCanvas(width, height);
  const ctx = ctx2d(canvas);

  ctx.fillStyle = SHEET_BG;
  ctx.fillRect(0, 0, width, height);
  drawSheetHeader(
    ctx,
    width,
    'Topology sheet — §14.6 shapes, fallback (top) vs production terrain (bottom)',
    'Review question 5: do connected surfaces look continuous? The fallback draws a 1px outline per cell, so every internal edge is visible; the prototype suppresses internal edges and caps only exposed tops.',
  );

  const treatments: readonly TileRoomTreatment[] = ['fallback', 'cavern'];
  treatments.forEach((treatment, rowIndex) => {
    TOPOLOGY_SHAPES.forEach((shape, colIndex) => {
      const x = GUTTER + colIndex * (cell + GUTTER);
      const y = HEADER_H + GUTTER + rowIndex * (LABEL_H + cell + GUTTER);
      drawPanelLabel(
        ctx,
        x,
        y,
        cell,
        `${shape.name} — ${treatment}`,
        '',
      );
      const level: LevelData = {
        version: 1,
        id: `shape-${shape.name}`,
        name: shape.name,
        width: shape.grid.cols * shape.grid.tileSize,
        height: shape.grid.rows * shape.grid.tileSize,
        tileSize: shape.grid.tileSize,
        spawn: { x: 0, y: 0 },
        tiles: shape.grid,
        entities: [],
        nextEntityId: 1,
      };
      drawScenePanel(ctx, x, y + LABEL_H, asScene(shape.name, shape.name, level), {
        viewW: cell,
        viewH: cell,
        camera: { x: 0, y: 0 },
        treatment,
        player: null,
        // Terrain only: atmosphere is exactly what must not be in the frame
        // when the question is whether connected surfaces read as continuous.
        drawLayers: false,
      });
    });
  });

  return canvas;
}

// --- Sheet 3: scale ---------------------------------------------------------

function renderScaleSheet(): Canvas {
  const sizes = [8, 16, 32] as const;
  const panelW = TILE_ROOM_VIEW_W;
  const panelH = 300;
  const width = GUTTER * 2 + panelW * 2;
  const height = HEADER_H + (LABEL_H + panelH + GUTTER) * sizes.length + GUTTER;
  const canvas = createCanvas(width, height);
  const ctx = ctx2d(canvas);

  ctx.fillStyle = SHEET_BG;
  ctx.fillRect(0, 0, width, height);
  drawSheetHeader(
    ctx,
    width,
    'Scale sheet — the same topology at 8px, 16px, and 32px tiles',
    'Review question 3: does any surface detail become noise at small scale? Left column fallback, right column production terrain. Same camera origin in tile units at every size.',
  );

  sizes.forEach((size, i) => {
    const level = createTopologyRoomLevel(size);
    const scene = asScene(`scale-${size}`, `${size}px tiles`, level);
    const y = HEADER_H + GUTTER + i * (LABEL_H + panelH + GUTTER);
    const camera = clampCameraToLevel(4 * size, 18 * size, level, panelW, panelH);

    (['fallback', 'cavern'] as const).forEach((treatment, col) => {
      const x = GUTTER + col * (panelW + GUTTER) - (col === 1 ? GUTTER : 0);
      drawPanelLabel(
        ctx,
        x,
        y,
        panelW - GUTTER,
        `${size}px — ${treatment}`,
        `Level ${level.width}x${level.height}px, viewport ${panelW}x${panelH}.`,
      );
      drawScenePanel(ctx, x, y + LABEL_H, scene, {
        viewW: panelW - GUTTER,
        viewH: panelH,
        camera,
        treatment,
        player: null,
        drawLayers: false,
      });
    });
  });

  return canvas;
}

// --- Sheet 4: treatment comparison ------------------------------------------

function renderTreatmentCompare(): Canvas {
  const panelW = TILE_ROOM_VIEW_W;
  const panelH = TILE_ROOM_VIEW_H;
  const scenes = [playground, generatedRoom, topologyRoom];
  const treatments = ['fallback', 'ruins', 'cavern', 'mechanical'] as const;
  const width = GUTTER * (treatments.length + 1) + panelW * treatments.length;
  const height = HEADER_H + (LABEL_H + panelH + GUTTER) * scenes.length + GUTTER;
  const canvas = createCanvas(width, height);
  const ctx = ctx2d(canvas);

  ctx.fillStyle = SHEET_BG;
  ctx.fillRect(0, 0, width, height);
  drawSheetHeader(
    ctx,
    width,
    'Treatment comparison — identical geometry, identical camera, only the renderer changes',
    '§9.2. Fallback, Ruins, Cavern, Mechanical. Geometry, player, camera, and entity list are identical across columns.',
  );

  scenes.forEach((scene, i) => {
    const y = HEADER_H + GUTTER + i * (LABEL_H + panelH + GUTTER);
    const camera = sheetCamera(scene.level, panelW, panelH);
    treatments.forEach((treatment, col) => {
      const x = GUTTER + col * (panelW + GUTTER);
      drawPanelLabel(ctx, x, y, panelW, `${scene.label} — ${treatment}`, '');
      drawScenePanel(ctx, x, y + LABEL_H, scene, {
        viewW: panelW,
        viewH: panelH,
        camera,
        treatment,
      });
    });
  });

  return canvas;
}

// --- Sheet 5: snapping / junction ------------------------------------------

/**
 * The §19 item-5 capture: the playground's wall/floor junction under a
 * fractional camera offset, at several device pixel ratios.
 *
 * `sineShake` is what the playground actually uses, so the offsets here are
 * fractional by construction rather than by contrivance — exactly the case §5.7
 * says subpixel cracks appear in.
 *
 * Two things this sheet has to get right to mean anything:
 *
 * 1. **Real backing stores.** Each panel is rendered into its own canvas sized
 *    `crop × dpr` with `ctx.scale(dpr, dpr)` applied once, exactly as
 *    `resizeCanvasToBackingStore` sets a real canvas up. Passing a DPR *number*
 *    into a 1× canvas would only exercise the snapping arithmetic, not the
 *    rasteriser, and a seam is a rasterisation outcome.
 * 2. **Magnification without resampling.** The device-pixel result is blitted
 *    at an integer zoom with smoothing disabled, so one backing-store pixel is
 *    one visible block and a hairline crack cannot be averaged away by the
 *    contact sheet itself.
 *
 * The full §5.7 matrix (1, 1.25, 1.5, 1.75, 2, 3, plus 9px tiles at 1.3) is a
 * Phase 2 automated test. This sheet is the human-readable subset.
 */
function renderSnappingJunction(): Canvas {
  const ratios = [1, 1.25, 1.5, 2] as const;
  /** World-space crop around the junction, in CSS px. */
  const cropW = 44;
  const cropH = 30;
  /** Integer magnification applied to the device-pixel result. */
  const ZOOM = 5;
  const treatments = ['fallback', 'cavern'] as const;

  // A tick where sineShake produces a decisively fractional offset on both axes.
  const shake = sineShake(7, 3);

  const panelWidths = ratios.map((dpr) => Math.round(cropW * dpr) * ZOOM);
  const panelHeights = ratios.map((dpr) => Math.round(cropH * dpr) * ZOOM);
  const rowH = Math.max(...panelHeights);

  const width =
    GUTTER * (ratios.length + 1) + panelWidths.reduce((a, b) => a + b, 0);
  const height = HEADER_H + (LABEL_H + rowH + GUTTER) * treatments.length + GUTTER;
  const canvas = createCanvas(width, height);
  const ctx = ctx2d(canvas);

  ctx.fillStyle = SHEET_BG;
  ctx.fillRect(0, 0, width, height);
  drawSheetHeader(
    ctx,
    width,
    'Snapping — playground wall/floor junction, fractional shake, real device pixels',
    `Review question 8: are visible seams or subpixel cracks present? Rendered into a ${cropW}x${cropH} CSS-px crop at each DPR, then magnified ${ZOOM}x with smoothing off, so one block = one backing-store pixel. Top: fallback (rounds the whole translate). Bottom: production terrain (snaps the composed device-pixel transform, §5.7).`,
  );

  treatments.forEach((treatment, row) => {
    let x = GUTTER;
    ratios.forEach((dpr, col) => {
      const panelW = panelWidths[col];
      const y = HEADER_H + GUTTER + row * (LABEL_H + rowH + GUTTER);

      drawPanelLabel(
        ctx,
        x,
        y,
        panelW,
        `DPR ${dpr} — ${treatment}`,
        row === 0 ? `shake (${shake.x.toFixed(3)}, ${shake.y.toFixed(3)})` : '',
      );

      // Render at the device resolution this DPR implies, then magnify.
      const deviceW = Math.round(cropW * dpr);
      const deviceH = Math.round(cropH * dpr);
      const off = createCanvas(deviceW, deviceH);
      const offCtx = ctx2d(off);
      offCtx.scale(dpr, dpr);
      drawTileRoomFrame(offCtx, playground, {
        // Frame the junction itself: the left wall spans y 0..368 and the floor
        // starts at y 368, so the shared edge sits in the middle of this crop.
        camera: { x: -6 - shake.x, y: 352 - shake.y },
        viewW: cropW,
        viewH: cropH,
        dpr,
        player: null,
        movingRects: new Map<number, LevelRect>(),
        treatment,
        showMarkers: false,
        worldSeed: TILE_ROOM_SEED,
        drawLayers: false,
      });

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        off as unknown as CanvasImageSource,
        x,
        y + LABEL_H,
        deviceW * ZOOM,
        deviceH * ZOOM,
      );
      ctx.imageSmoothingEnabled = true;
      ctx.strokeStyle = PANEL_BORDER;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 0.5, y + LABEL_H - 0.5, deviceW * ZOOM + 1, deviceH * ZOOM + 1);

      x += panelW + GUTTER;
    });
  });

  return canvas;
}

// --- Emit -------------------------------------------------------------------

interface Sheet {
  readonly file: string;
  readonly render: () => Canvas;
}

const SHEETS: readonly Sheet[] = [
  { file: 'baseline-scenes.png', render: renderBaselineScenes },
  { file: 'topology-sheet.png', render: renderTopologySheet },
  { file: 'scale-sheet.png', render: renderScaleSheet },
  { file: 'treatment-compare.png', render: renderTreatmentCompare },
  { file: 'snapping-junction.png', render: renderSnappingJunction },
];

let allDeterministic = true;
const renderTimings: Record<string, { firstMs: number; secondMs: number }> = {};

for (const sheet of SHEETS) {
  const firstStart = performance.now();
  const first = sheet.render().toBuffer('image/png');
  const firstMs = performance.now() - firstStart;
  // §14.5's blocking property, applied to the sheets themselves: rendering the
  // same frame twice must produce identical output. A mismatch means something
  // in the draw path is reading order, time, or unseeded randomness.
  const secondStart = performance.now();
  const second = sheet.render().toBuffer('image/png');
  const secondMs = performance.now() - secondStart;
  const identical = first.equals(second);
  if (!identical) allDeterministic = false;
  renderTimings[sheet.file] = {
    firstMs: Number(firstMs.toFixed(3)),
    secondMs: Number(secondMs.toFixed(3)),
  };

  writeFileSync(join(OUTPUT_DIR, sheet.file), first);
  const kb = (first.byteLength / 1024).toFixed(1);
  console.log(
    `${identical ? 'ok  ' : 'FAIL'} ${sheet.file.padEnd(24)} ${kb.padStart(8)} KB` +
      (identical ? '' : '  — two renders of the same frame differ'),
  );
}

// Small committed review reference; the larger diagnostic sheets are
// regenerable and gitignored.
const reference = createCanvas(TILE_ROOM_VIEW_W, TILE_ROOM_VIEW_H);
drawScenePanel(
  ctx2d(reference),
  0,
  0,
  generatedRoom,
  {
    viewW: TILE_ROOM_VIEW_W,
    viewH: TILE_ROOM_VIEW_H,
    camera: sheetCamera(generatedRoom.level, TILE_ROOM_VIEW_W, TILE_ROOM_VIEW_H),
    treatment: 'cavern',
  },
);
writeFileSync(
  join(REFERENCE_DIR, 'phase0-generated-cave.png'),
  reference.toBuffer('image/png'),
);

function directorySize(path: string): number {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    total += entry.isDirectory()
      ? directorySize(entryPath)
      : statSync(entryPath).size;
  }
  return total;
}

const distBytes = existsSync('dist') ? directorySize('dist') : null;
writeFileSync(
  join(OUTPUT_DIR, 'phase0-baseline.json'),
  `${JSON.stringify({
    node: process.version,
    distBytes,
    renderTimings,
  }, null, 2)}\n`,
);

console.log(
  allDeterministic
    ? '\nAll sheets are byte-identical across two renders.'
    : '\nDETERMINISM FAILURE — see the FAIL rows above.',
);

if (!allDeterministic) process.exitCode = 1;
