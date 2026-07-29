/**
 * Level-visual draw-cost baseline — Phase 0 (§13.3).
 *
 * Measures what the **current fallback renderer** costs per frame on the
 * fixtures §13.3 names, so Phase 2 has a number to be judged against instead of
 * an arbitrary budget chosen in advance. The production terrain renderer is
 * measured beside it using identical geometry and camera motion.
 *
 * Fixtures, in the plan's order:
 *
 * 1. 600×400 playground with entity rectangles
 * 2. 60×34 tile room (both scenes — generated and topology)
 * 3. large tile level (200×34) viewed through a 600×400 camera
 * 4. dense worst-case: every cell solid, with surface details
 * 5. three procedural parallax layers plus terrain
 * 6. thumbnail rendered at reduced resolution
 *
 * Fixtures 2, 3, and 4 come from the tile room, so the scene needed for
 * validation and the scene needed for benchmarking are the same work.
 *
 * The camera moves across the measured frames. A stationary camera would let a
 * future renderer look good by caching something it is not allowed to cache,
 * and it would not exercise the fractional world transforms §5.7 cares about.
 *
 * Run:
 *
 * ```bash
 * npm run bench:level-visual
 * ```
 *
 * Timings are wall-clock on one machine and are only meaningful as a ratio
 * against a baseline captured on the same machine. The committed JSON records
 * the host so a later comparison can tell whether it is comparing like with
 * like.
 */

import { createCanvas, type Canvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cpus, totalmem } from 'node:os';

import { createPlatformerState } from '../../src/platformer';
import { generateLevel } from '../../src/levelgen';
import type { LevelData, LevelRect } from '../../src/level/types';
import { PLAYGROUND_LEVEL } from '../../showcase/sections/playground';
import {
  createGeneratedRoomScene,
  createTopologyRoomLevel,
  createTopologyRoomScene,
  clampCameraToLevel,
  parseTileArt,
  TILE_ROOM_SEED,
  TILE_ROOM_SEMANTICS,
  TILE_ROOM_TILE_SIZE,
  TILE_ROOM_VIEW_H,
  TILE_ROOM_VIEW_W,
  type TileRoomScene,
} from '../../showcase/sections/tile-room-fixtures';
import {
  drawTileRoomFrame,
  type TileRoomTreatment,
} from '../../showcase/sections/tile-room-render';

const OUTPUT_DIR = 'benchmarks/visual';
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

/** Frames rendered and discarded before measurement, to let the JIT settle. */
const WARMUP_FRAMES = 30;

/** Frames measured per fixture per treatment. */
const MEASURED_FRAMES = 120;

/**
 * Portable Phase 6 regression budget. Each production cell is compared with
 * its fallback measurement from the same process/host, avoiding brittle
 * absolute CI timings while still rejecting the 20–90× regression that the
 * dense-facet implementation briefly exposed.
 */
const MAX_PRODUCTION_TO_FALLBACK_RATIO = 5;

function ctx2d(canvas: Canvas): CanvasRenderingContext2D {
  return canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
}

function asScene(id: string, label: string, level: LevelData): TileRoomScene {
  return { id, label, level, tileSemantics: TILE_ROOM_SEMANTICS };
}

/** A fully solid grid — the worst case for any per-cell renderer. */
function denseRoomLevel(cols: number, rows: number, tileSize: number): LevelData {
  const art: string[] = [];
  for (let r = 0; r < rows; r++) art.push('#'.repeat(cols));
  const tiles = parseTileArt(art, tileSize);
  return {
    version: 1,
    id: 'dense-worst-case',
    name: 'Dense worst case',
    width: cols * tileSize,
    height: rows * tileSize,
    tileSize,
    spawn: { x: 0, y: 0 },
    tiles,
    entities: [],
    nextEntityId: 1,
  };
}

// --- Fixtures ---------------------------------------------------------------

interface Fixture {
  /** §13.3 fixture number, for cross-referencing the plan. */
  readonly planFixture: number;
  readonly name: string;
  readonly scene: TileRoomScene;
  readonly viewW: number;
  readonly viewH: number;
  /** Draw the background/foreground layers (fixture 5's whole point). */
  readonly drawLayers: boolean;
  readonly note: string;
}

const generatedRoom = createGeneratedRoomScene();
const topologyRoom = createTopologyRoomScene();

const largeGenerated = generateLevel(TILE_ROOM_SEED, {
  cols: 200,
  rows: 34,
  tileSize: TILE_ROOM_TILE_SIZE,
});

const FIXTURES: readonly Fixture[] = [
  {
    planFixture: 1,
    name: 'playground-rects',
    scene: asScene('playground', 'Playground', PLAYGROUND_LEVEL),
    viewW: 600,
    viewH: 400,
    drawLayers: false,
    note: '10 entity rectangles, empty 37x25 tile grid, world = screen.',
  },
  {
    planFixture: 2,
    name: 'tile-room-generated-60x34',
    scene: generatedRoom,
    viewW: TILE_ROOM_VIEW_W,
    viewH: TILE_ROOM_VIEW_H,
    drawLayers: false,
    note: 'generateLevel(1337) — 2040 cells, 115 solid.',
  },
  {
    planFixture: 2,
    name: 'tile-room-topology-60x34',
    scene: topologyRoom,
    viewW: TILE_ROOM_VIEW_W,
    viewH: TILE_ROOM_VIEW_H,
    drawLayers: false,
    note: 'Hand-authored §14.6 fixture — 2040 cells, ~700 solid, 6 entities.',
  },
  {
    planFixture: 3,
    name: 'large-tile-level-200x34',
    scene: asScene('large', 'Large tile level', largeGenerated.level),
    viewW: 600,
    viewH: 400,
    drawLayers: false,
    note: '6800 cells viewed through a 600x400 camera.',
  },
  {
    planFixture: 4,
    name: 'dense-worst-case-60x34',
    scene: asScene(
      'dense',
      'Dense worst case',
      denseRoomLevel(60, 34, TILE_ROOM_TILE_SIZE),
    ),
    viewW: TILE_ROOM_VIEW_W,
    viewH: TILE_ROOM_VIEW_H,
    drawLayers: false,
    note: 'Every one of 2040 cells solid; maximum surface detail.',
  },
  {
    planFixture: 5,
    name: 'parallax-plus-terrain',
    scene: topologyRoom,
    viewW: TILE_ROOM_VIEW_W,
    viewH: TILE_ROOM_VIEW_H,
    drawLayers: true,
    note: 'Topology room plus two procedural background bands and a foreground silhouette.',
  },
  {
    planFixture: 6,
    name: 'thumbnail-160x107',
    scene: asScene('thumbnail', 'Thumbnail', createTopologyRoomLevel(4)),
    viewW: 160,
    viewH: 107,
    drawLayers: false,
    note: 'Topology room at 4px tiles into a 160x107 viewport.',
  },
];

// --- Measurement ------------------------------------------------------------

interface Timing {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly meanMs: number;
  readonly minMs: number;
  readonly maxMs: number;
}

function summarize(samples: readonly number[]): Timing {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    medianMs: Number(at(0.5).toFixed(4)),
    p95Ms: Number(at(0.95).toFixed(4)),
    meanMs: Number((sum / (sorted.length || 1)).toFixed(4)),
    minMs: Number((sorted[0] ?? 0).toFixed(4)),
    maxMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(4)),
  };
}

const NO_MOVING_RECTS: ReadonlyMap<number, LevelRect> = new Map();

/**
 * Render `frames` frames of one fixture, panning the camera across the level so
 * the world transform is fractional and the visible region keeps changing.
 */
function runFixture(
  fixture: Fixture,
  treatment: TileRoomTreatment,
  frames: number,
  collect: boolean,
): number[] {
  const canvas = createCanvas(fixture.viewW, fixture.viewH);
  const ctx = ctx2d(canvas);
  const { level } = fixture.scene;
  const player = createPlatformerState(level.spawn.x, level.spawn.y).core;
  const spanX = Math.max(0, level.width - fixture.viewW);
  const spanY = Math.max(0, level.height - fixture.viewH);
  const samples: number[] = [];

  for (let i = 0; i < frames; i++) {
    const t = frames <= 1 ? 0 : i / (frames - 1);
    // Deliberately fractional: 0.37 keeps the camera off whole pixels.
    const camera = clampCameraToLevel(
      spanX * t + 0.37,
      spanY * Math.sin(t * Math.PI) + 0.37,
      level,
      fixture.viewW,
      fixture.viewH,
    );
    const start = performance.now();
    drawTileRoomFrame(ctx, fixture.scene, {
      camera,
      viewW: fixture.viewW,
      viewH: fixture.viewH,
      dpr: 1,
      player,
      movingRects: NO_MOVING_RECTS,
      treatment,
      showMarkers: false,
      worldSeed: TILE_ROOM_SEED,
      drawLayers: fixture.drawLayers,
    });
    const elapsed = performance.now() - start;
    if (collect) samples.push(elapsed);
  }

  return samples;
}

interface Result {
  readonly planFixture: number;
  readonly name: string;
  readonly note: string;
  readonly viewport: string;
  readonly cells: number;
  readonly fallback: Timing;
  readonly productionTerrain: Timing;
}

const results: Result[] = [];

for (const fixture of FIXTURES) {
  const timings: Partial<Record<TileRoomTreatment, Timing>> = {};
  for (const treatment of ['fallback', 'cavern'] as const) {
    runFixture(fixture, treatment, WARMUP_FRAMES, false);
    timings[treatment] = summarize(
      runFixture(fixture, treatment, MEASURED_FRAMES, true),
    );
  }
  results.push({
    planFixture: fixture.planFixture,
    name: fixture.name,
    note: fixture.note,
    viewport: `${fixture.viewW}x${fixture.viewH}`,
    cells: fixture.scene.level.tiles.cols * fixture.scene.level.tiles.rows,
    fallback: timings.fallback!,
    productionTerrain: timings.cavern!,
  });
}

// --- Report -----------------------------------------------------------------

const host = {
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  cpu: cpus()[0]?.model ?? 'unknown',
  cpuCount: cpus().length,
  totalMemGb: Number((totalmem() / 1024 ** 3).toFixed(1)),
};

const payload = {
  capturedFor: 'level-visual-rendering-plan Phase 6 (§13.3 release gate)',
  warmupFrames: WARMUP_FRAMES,
  measuredFrames: MEASURED_FRAMES,
  maxProductionToFallbackRatio: MAX_PRODUCTION_TO_FALLBACK_RATIO,
  host,
  results,
};

writeFileSync(
  join(OUTPUT_DIR, 'level-visual-bench.json'),
  `${JSON.stringify(payload, null, 2)}\n`,
);

const pad = (s: string, n: number): string => s.padEnd(n);
const num = (n: number): string => n.toFixed(3).padStart(8);

console.log(`\nLevel-visual draw cost — ${host.cpu}, ${host.node}`);
console.log(`${WARMUP_FRAMES} warmup + ${MEASURED_FRAMES} measured frames per cell.\n`);
console.log(
  `${pad('§13.3', 6)}${pad('fixture', 32)}${pad('viewport', 10)}` +
    `${pad('fallback med', 14)}${pad('fallback p95', 14)}` +
    `${pad('terrain med', 12)}${pad('terrain p95', 12)}`,
);
console.log('-'.repeat(100));
for (const r of results) {
  console.log(
    `${pad(String(r.planFixture), 6)}${pad(r.name, 32)}${pad(r.viewport, 10)}` +
      `${num(r.fallback.medianMs)}      ${num(r.fallback.p95Ms)}      ` +
      `${num(r.productionTerrain.medianMs)}    ${num(r.productionTerrain.p95Ms)}`,
  );
}
const regressions = results.flatMap((result) => {
  const checks = [
    ['median', result.productionTerrain.medianMs, result.fallback.medianMs],
    ['p95', result.productionTerrain.p95Ms, result.fallback.p95Ms],
  ] as const;
  return checks
    .filter(([, production, fallback]) =>
      fallback > 0 && production / fallback > MAX_PRODUCTION_TO_FALLBACK_RATIO
    )
    .map(([metric, production, fallback]) =>
      `${result.name} ${metric}: ${(production / fallback).toFixed(2)}× fallback`
    );
});
console.log(
  `\nWritten to ${join(OUTPUT_DIR, 'level-visual-bench.json')}.` +
    `\nPhase 6 budget: production median and p95 <= ${MAX_PRODUCTION_TO_FALLBACK_RATIO}× ` +
    'the same-host fallback.',
);
if (regressions.length > 0) {
  console.error('\nLevel-visual benchmark budget exceeded:');
  for (const regression of regressions) console.error(`- ${regression}`);
  process.exitCode = 1;
} else {
  console.log('All benchmark cells are inside the Phase 6 regression budget.');
}
