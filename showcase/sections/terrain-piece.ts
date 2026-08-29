/**
 * Terrain piece showcase — a platform eaten away from the middle.
 *
 * The platform splits into two halves. Each is anchored at its **outer** end
 * against the wall and erodes inward, so the ground does not retreat — it is
 * consumed in place. The texture is baked once and stays pinned; only the mask
 * moves.
 *
 * **Top panel — mask only.** What erosion looks like with no end treatment: the
 * cut exposes the raw cross-section of the texture, and the body's own baked cap
 * is the first thing the mask eats.
 *
 * **Bottom panel — mask + cap overlay.** A one-tile cap strip, baked once, rides
 * the eroding boundary inside the same clip. The body never re-tiles and never
 * re-bakes; the end stays finished at every width.
 *
 * Two bakes per half, both once, for any number of frames. Scrub to `0` and the
 * closed pit is seamless with the floor either side — that is the bonded policy,
 * and it is what lets a closed pit hide in plain sight.
 *
 * `Slide` switches to the other motion family for contrast: a rigid translate
 * where the halves move bodily outward under the static floor and the texture
 * travels with them.
 */

import { createGameLoop, type GameLoop } from '../../src/game-loop';
import { resizeCanvasToBackingStore } from '../../src/primitives';
import { buildTerrainArtRuleAtlas } from '../../src/terrain-art/rule-atlas';
import type { TileGrid } from '../../src/level/types';
import { shouldAnimate } from '../helpers/motion-gate';
import {
  DEMO_TILE,
  DEMO_KINDS,
  DEMO_RULE_SET,
  createDemoTilesetSource,
  pixelsToCanvasImage,
} from '../helpers/terrain-piece-tiles';
import { resolveTerrainPiece, type TerrainPiece } from '../../src/terrain-art/piece';
import {
  createTerrainPieceCache,
  drawMaskedTerrainPiece,
  type BakedTerrainPiece,
} from '../../src/terrain-art/piece-render';
import type { Store } from '../store';
import type { GlobalState } from '../main';

// --- Layout ---------------------------------------------------------------

const VIEW_W = 240;
const VIEW_H = 150;
const SCALE = 3;

const COLS = 12;
const ROWS = 2;
const PIT_START = 3;
const PIT_COLS = 6;
const HALF_COLS = PIT_COLS / 2;
const HALF_W = HALF_COLS * DEMO_TILE;

const ORIGIN_X = Math.round((VIEW_W - COLS * DEMO_TILE) / 2);
const PANEL_RAW_Y = 34;
const PANEL_CAP_Y = 100;

type DemoMode = 'erode' | 'slide';

// --- Geometry -------------------------------------------------------------

const grid = (cols: number, rows: number): TileGrid =>
  ({ data: new Array<number>(cols * rows).fill(1), cols, rows, tileSize: DEMO_TILE });

const staticSpans = [
  { col: 0, cols: PIT_START },
  { col: PIT_START + PIT_COLS, cols: COLS - PIT_START - PIT_COLS },
];

/** The intact platform — what a CLOSED pit bonds against so its seam vanishes. */
const fullField = grid(COLS, ROWS);

/** Closed: one bonded span across the pit. */
const closedPiece: TerrainPiece = {
  id: 'pit-closed',
  cells: grid(PIT_COLS, ROWS),
  originCol: PIT_START,
  originRow: 0,
  bondPolicy: 'bonded',
};

/**
 * The two halves, twice — because the two motion families want opposite bond
 * policies, and getting this wrong is the most visible mistake in the whole
 * demo.
 *
 * **Erode → bonded.** The halves never move, so their OUTER ends stay welded to
 * the static floor. A free piece would cap those ends and paint a bright seam
 * across ground that is supposed to be continuous. Bonded means the body has no
 * vertical edges at all, and every bit of end treatment comes from the cap
 * overlay riding the cut — which is exactly the behaviour being demonstrated.
 *
 * **Slide → free.** The halves travel out past the pit and their outer ends do
 * become genuinely exposed; they are hidden under the static floor by draw
 * order, not by bonding.
 */
const leftHalfBonded: TerrainPiece = {
  id: 'pit-left-bonded', cells: grid(HALF_COLS, ROWS), originCol: PIT_START, originRow: 0, bondPolicy: 'bonded',
};
const rightHalfBonded: TerrainPiece = {
  ...leftHalfBonded, id: 'pit-right-bonded', originCol: PIT_START + HALF_COLS,
};
const leftHalfFree: TerrainPiece = { ...leftHalfBonded, id: 'pit-left-free', bondPolicy: 'free' };
const rightHalfFree: TerrainPiece = {
  ...leftHalfFree, id: 'pit-right-free', originCol: PIT_START + HALF_COLS,
};

/**
 * A one-column cap strip.
 *
 * Built as a **bonded** piece sitting at the edge of its own field: solid
 * neighbour on the inward side, out-of-bounds (air) on the exposed side. That
 * resolves to exactly the end tile the eroding cut needs — no special-case rule
 * lookup, just the ordinary bonded path used with a deliberately small field.
 */
const capField = grid(2, ROWS);
const capRight: TerrainPiece = {
  id: 'cap-right', cells: grid(1, ROWS), originCol: 1, originRow: 0, bondPolicy: 'bonded',
};
const capLeft: TerrainPiece = {
  id: 'cap-left', cells: grid(1, ROWS), originCol: 0, originRow: 0, bondPolicy: 'bonded',
};

// --- Section --------------------------------------------------------------

export function initTerrainPiece(root: HTMLElement, _store: Store<GlobalState>): void {
  const canvas = root.querySelector<HTMLCanvasElement>('.terrain-piece-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const source = createDemoTilesetSource();
  if (source === null) return; // no canvas host — leave the section blank rather than throw
  const atlas = buildTerrainArtRuleAtlas(source, DEMO_RULE_SET.rules);
  const image = pixelsToCanvasImage(atlas.pixels, atlas.width, atlas.height);
  if (image === null) return;

  const cache = createTerrainPieceCache();
  const bakeOptions = { atlas, image };

  let mode: DemoMode = 'erode';
  let eaten = 0; // pixels consumed from each half's inner end
  let playing = true;
  let direction = 1;

  const scrub = root.querySelector<HTMLInputElement>('.terrain-piece-scrub');
  const playBtn = root.querySelector<HTMLButtonElement>('.terrain-piece-play');
  const readout = root.querySelector<HTMLElement>('.terrain-piece-readout');
  const modeBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('.terrain-piece-mode'));

  /** Bake-on-demand; the cache rebakes only when a piece's topology changes. */
  const baked = (piece: TerrainPiece, field?: TileGrid): BakedTerrainPiece | undefined =>
    cache.get(piece.id, resolveTerrainPiece(piece, DEMO_KINDS, DEMO_RULE_SET, field), bakeOptions);

  const syncChrome = (): void => {
    if (scrub && document.activeElement !== scrub) scrub.value = String(Math.round(eaten));
    if (playBtn) playBtn.textContent = playing ? 'Pause' : 'Play';
    if (readout) {
      readout.textContent = eaten <= 0
        ? 'closed — one bonded span, seamless with the floor'
        : mode === 'erode'
          ? `eroded ${Math.round(eaten)}px — texture pinned, ends masked · ${cache.bakeCount()} bakes total`
          : `offset ${Math.round(eaten)}px — rigid translate, texture travels · ${cache.bakeCount()} bakes total`;
    }
    for (const btn of modeBtns) btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
  };

  // --- Drawing ------------------------------------------------------------

  const drawStatic = (y: number): void => {
    for (const [index, span] of staticSpans.entries()) {
      if (span.cols <= 0) continue;
      const piece: TerrainPiece = {
        id: `static-${index}`,
        cells: grid(span.cols, ROWS),
        originCol: span.col,
        originRow: 0,
        bondPolicy: 'bonded',
      };
      const surface = baked(piece, fullField);
      if (surface !== undefined) {
        ctx.drawImage(surface.canvas as CanvasImageSource, ORIGIN_X + span.col * DEMO_TILE, y);
      }
    }
  };

  /**
   * One panel. `withCap` is the entire difference between the two — same
   * geometry, same bakes, same mask.
   */
  const drawPanel = (y: number, withCap: boolean): void => {
    const pitX = ORIGIN_X + PIT_START * DEMO_TILE;

    if (eaten <= 0) {
      const closed = baked(closedPiece, fullField);
      if (closed !== undefined) ctx.drawImage(closed.canvas as CanvasImageSource, pitX, y);
      drawStatic(y);
      return;
    }

    if (mode === 'slide') {
      // The other motion family: rigid translate, texture travels with the
      // piece, outer ends hidden under the static floor by draw order.
      const left = baked(leftHalfFree);
      const right = baked(rightHalfFree);
      if (left !== undefined) ctx.drawImage(left.canvas as CanvasImageSource, pitX - eaten, y);
      if (right !== undefined) ctx.drawImage(right.canvas as CanvasImageSource, pitX + HALF_W + eaten, y);
      drawStatic(y);
      return;
    }

    // Erode. Each half keeps its position; the mask eats inward from the shared
    // centre. Bodies are bonded — seamless with the floor — so the ONLY
    // difference between the two panels is whether a cap rides the cut.
    const left = baked(leftHalfBonded, fullField);
    const right = baked(rightHalfBonded, fullField);
    const survives = Math.max(0, HALF_W - eaten);
    const capR = withCap ? baked(capRight, capField) : undefined;
    const capL = withCap ? baked(capLeft, capField) : undefined;
    if (left !== undefined) drawMaskedTerrainPiece(ctx, left, 'left', survives, pitX, y, capR);
    if (right !== undefined) {
      drawMaskedTerrainPiece(ctx, right, 'right', survives, pitX + HALF_W, y, capL);
    }
    drawStatic(y);
  };

  const label = (text: string, y: number, accent: string): void => {
    ctx.fillStyle = accent;
    ctx.fillRect(ORIGIN_X, y, 3, 9);
    ctx.fillStyle = '#d9d2c4';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(text, ORIGIN_X + 8, y);
  };

  const render = (): void => {
    const dpr = resizeCanvasToBackingStore(canvas, VIEW_W * SCALE, VIEW_H * SCALE);
    ctx.setTransform(dpr * SCALE, 0, 0, dpr * SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#15130f';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    label(mode === 'erode' ? 'mask only — raw cut' : 'rigid translate', PANEL_RAW_Y - 14, '#c86a4a');
    drawPanel(PANEL_RAW_Y, false);

    label(mode === 'erode' ? 'mask + cap overlay' : 'rigid translate — capped', PANEL_CAP_Y - 14, '#6aa84f');
    drawPanel(PANEL_CAP_Y, true);

    syncChrome();
  };

  // --- Loop ---------------------------------------------------------------

  const loop: GameLoop = createGameLoop({
    step: (dt) => {
      if (!playing) return;
      eaten += direction * dt * 22;
      if (eaten >= HALF_W) { eaten = HALF_W; direction = -1; }
      if (eaten <= 0) { eaten = 0; direction = 1; }
    },
    render,
  });

  // --- Controls -----------------------------------------------------------

  scrub?.addEventListener('input', () => {
    playing = false;
    eaten = Math.min(HALF_W, Math.max(0, Number(scrub.value) || 0));
    render();
  });

  playBtn?.addEventListener('click', () => {
    playing = !playing;
    if (playing && !shouldAnimate()) loop.start();
    render();
  });

  for (const btn of modeBtns) {
    btn.addEventListener('click', () => {
      const next = btn.dataset.mode;
      if (next !== 'erode' && next !== 'slide') return;
      mode = next;
      render();
    });
  }

  render();
  if (shouldAnimate()) return; // reduced motion: the static frame above is the section
  loop.start();
}
