/**
 * `cameraLetterbox` / `applyCameraLetterbox` / `composeCameraTransform`.
 *
 * The defect these close, from a real Celerock build: a contain-fitted room
 * left slack on one axis, the backdrop was painted across the whole canvas,
 * and the world was drawn unclipped — so the empty margin read as playable
 * level and the (correct) camera clamp looked broken. Plus its sibling: the
 * camera offset lived in each draw's `worldOffset` parameter rather than in
 * the context, so the hand-written particle layer rendered camera-independent.
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest';
import {
  applyCameraLetterbox,
  cameraLetterbox,
  cameraTransform,
  composeCameraTransform,
  fitCameraZoom,
  type CameraFrameRect,
  type CameraLetterbox,
  type CameraViewport,
} from '../camera';

/** The shipped Celerock room size. */
const ROOM = { width: 320, height: 184 } as const;

/** Total area of a rect list. */
function area(rects: readonly CameraFrameRect[]): number {
  return rects.reduce((sum, r) => sum + r.width * r.height, 0);
}

/** True when two rects share any interior area. */
function overlaps(a: CameraFrameRect, b: CameraFrameRect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * A contain-fitted transform for `room` in `viewport`, with the camera parked
 * at the origin — the steady state of a room smaller than the screen.
 */
function containBox(viewport: CameraViewport, room = ROOM): CameraLetterbox {
  const zoom = fitCameraZoom(room, viewport, { mode: 'contain' });
  const t = cameraTransform({ x: 0, y: 0 }, viewport, { zoom });
  return cameraLetterbox(room, viewport, t);
}

// ===========================================================================
// Geometry
// ===========================================================================
describe('cameraLetterbox — the contain-fit margin', () => {
  it('reports side bars when the viewport is wider than the fitted room', () => {
    const viewport: CameraViewport = { width: 1600, height: 736 };   // room aspect is 320:184
    const box = containBox(viewport);

    // contain fit: min(1600/320, 736/184) = min(5, 4) = 4 → 1280 × 736.
    expect(box.frame).toEqual({ x: 0, y: 0, width: 1280, height: 736 });
    expect(box.covered).toBe(false);
    expect(box.bars).toEqual([{ x: 1280, y: 0, width: 320, height: 736 }]);
    expect(box.clip).toEqual({ x: 0, y: 0, width: 1280, height: 736 });
  });

  it('reports top/bottom bars when the viewport is taller than the fitted room', () => {
    const viewport: CameraViewport = { width: 1280, height: 1000 };
    const box = containBox(viewport);

    // min(1280/320, 1000/184) = 4 → 1280 × 736, 264px of vertical slack.
    expect(box.frame).toEqual({ x: 0, y: 0, width: 1280, height: 736 });
    expect(box.bars).toEqual([{ x: 0, y: 736, width: 1280, height: 264 }]);
  });

  it('covers the viewport under a cover fit — no bars, clip is the viewport', () => {
    const viewport: CameraViewport = { width: 1600, height: 736 };
    const zoom = fitCameraZoom(ROOM, viewport, { mode: 'cover' });   // max(5, 4) = 5
    const t = cameraTransform({ x: 0, y: 0 }, viewport, { zoom });   // clamped to the bound
    const box = cameraLetterbox(ROOM, viewport, t);

    expect(box.covered).toBe(true);
    expect(box.bars).toEqual([]);
    expect(box.clip).toEqual({ x: 0, y: 0, width: 1600, height: 736 });
  });

  it('tracks the camera: the frame moves with the snapped offset', () => {
    const viewport: CameraViewport = { width: 1600, height: 736 };
    const t = cameraTransform({ x: 10, y: 4 }, viewport, { zoom: 4 });
    const box = cameraLetterbox(ROOM, viewport, t);

    expect(box.frame.x).toBe(-40);          // -10 · 4
    expect(box.frame.y).toBe(-16);
    // Bottom bar first (full width), then the side bar spanning only the band
    // between the horizontal bars — disjoint by construction.
    expect(box.bars).toEqual([
      { x: 0, y: 720, width: 1600, height: 16 },
      { x: 1240, y: 0, width: 360, height: 720 },
    ]);
  });
});

describe('cameraLetterbox — invariants', () => {
  const viewports: readonly CameraViewport[] = [
    { width: 1600, height: 736 },
    { width: 1280, height: 1000 },
    { width: 900, height: 900 },
    { width: 375, height: 812 },
    { width: 320, height: 184 },
  ];

  it('bars are disjoint, and bars + clip tile the viewport exactly', () => {
    for (const viewport of viewports) {
      for (const camera of [{ x: 0, y: 0 }, { x: 37.4, y: -12.5 }, { x: -200, y: 90 }]) {
        const zoom = fitCameraZoom(ROOM, viewport, { mode: 'contain' });
        const t = cameraTransform(camera, viewport, { zoom, devicePixelRatio: 2 });
        const box = cameraLetterbox(ROOM, viewport, t);

        for (let i = 0; i < box.bars.length; i++) {
          for (let j = i + 1; j < box.bars.length; j++) {
            expect(overlaps(box.bars[i], box.bars[j])).toBe(false);
          }
          expect(overlaps(box.bars[i], box.clip)).toBe(false);
        }
        expect(area([...box.bars, box.clip])).toBeCloseTo(viewport.width * viewport.height, 6);
      }
    }
  });

  it('masks the whole viewport when the frame is entirely off-screen', () => {
    const viewport: CameraViewport = { width: 1600, height: 736 };
    const t = cameraTransform({ x: 5000, y: 0 }, viewport, { zoom: 4 });
    const box = cameraLetterbox(ROOM, viewport, t);

    expect(box.clip.width * box.clip.height).toBe(0);
    expect(area(box.bars)).toBe(1600 * 736);
    expect(box.covered).toBe(false);
  });

  it('never reports a negative extent', () => {
    const viewport: CameraViewport = { width: 800, height: 600 };
    for (const camera of [{ x: -9999, y: -9999 }, { x: 9999, y: 9999 }]) {
      const box = cameraLetterbox(ROOM, viewport, cameraTransform(camera, viewport, { zoom: 3 }));
      for (const r of [box.frame, box.clip, ...box.bars]) {
        expect(r.width).toBeGreaterThanOrEqual(0);
        expect(r.height).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('cameraLetterbox — fail-safe degradation', () => {
  const viewport: CameraViewport = { width: 1600, height: 736 };
  const t = cameraTransform({ x: 0, y: 0 }, viewport, { zoom: 4 });

  it.each([
    ['undefined bounds', undefined],
    ['null bounds', null],
    ['NaN dimensions', { width: NaN, height: 184 }],
    ['zero dimensions', { width: 0, height: 0 }],
    ['negative dimensions', { width: -320, height: 184 }],
  ])('%s masks nothing rather than blanking the screen', (_label, bounds) => {
    const box = cameraLetterbox(bounds as never, viewport, t);
    expect(box.covered).toBe(true);
    expect(box.bars).toEqual([]);
    expect(box.clip).toEqual({ x: 0, y: 0, width: 1600, height: 736 });
  });

  it('degrades on a non-finite transform', () => {
    for (const bad of [{ zoom: 0, offsetX: 0, offsetY: 0 }, { zoom: NaN, offsetX: 0, offsetY: 0 }, { zoom: 4, offsetX: NaN, offsetY: 0 }, { zoom: 4, offsetX: 0, offsetY: Infinity }]) {
      const box = cameraLetterbox(ROOM, viewport, bad);
      expect(box.covered).toBe(true);
      expect(box.bars).toEqual([]);
    }
  });

  it('degrades on a degenerate viewport', () => {
    const box = cameraLetterbox(ROOM, { width: 0, height: 0 }, t);
    expect(box.covered).toBe(true);
    expect(box.bars).toEqual([]);
  });

  it('reads a compiled-room-shaped bounds the way fitCameraZoom does', () => {
    const room = { levelData: { width: 320, height: 184 } };
    expect(cameraLetterbox(room as never, viewport, t)).toEqual(cameraLetterbox(ROOM, viewport, t));
  });
});

// ===========================================================================
// Context application
// ===========================================================================
/** A canvas context stub that records the calls this module makes. */
function stubContext(): {
  ctx: CanvasRenderingContext2D;
  calls: string[];
  fills: Array<readonly [number, number, number, number, unknown]>;
} {
  const calls: string[] = [];
  const fills: Array<readonly [number, number, number, number, unknown]> = [];
  const state = { fillStyle: 'INITIAL' as unknown };
  const stack: unknown[] = [];
  const ctx = {
    get fillStyle() { return state.fillStyle; },
    set fillStyle(value: unknown) { state.fillStyle = value; },
    save: vi.fn(() => { calls.push('save'); stack.push(state.fillStyle); }),
    restore: vi.fn(() => { calls.push('restore'); state.fillStyle = stack.pop(); }),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      calls.push('fillRect');
      fills.push([x, y, w, h, state.fillStyle]);
    }),
    beginPath: vi.fn(() => calls.push('beginPath')),
    rect: vi.fn(() => calls.push('rect')),
    clip: vi.fn(() => calls.push('clip')),
    scale: vi.fn(() => calls.push('scale')),
    translate: vi.fn(() => calls.push('translate')),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls, fills };
}

describe('applyCameraLetterbox', () => {
  const viewport: CameraViewport = { width: 1600, height: 736 };
  const transform = cameraTransform({ x: 0, y: 0 }, viewport, { zoom: 4 });

  it('fills every bar then clips to the frame, and returns the resolved box', () => {
    const { ctx, calls, fills } = stubContext();
    const box = applyCameraLetterbox(ctx, ROOM, viewport, transform, { fill: '#070b18' });

    expect(calls).toEqual(['save', 'fillRect', 'restore', 'beginPath', 'rect', 'clip']);
    expect(fills).toEqual([[1280, 0, 320, 736, '#070b18']]);
    expect(ctx.rect).toHaveBeenCalledExactlyOnceWith(0, 0, 1280, 736);
    expect(box).toEqual(cameraLetterbox(ROOM, viewport, transform));
  });

  it('restores the caller fillStyle but leaves the clip standing', () => {
    const { ctx, calls } = stubContext();
    ctx.fillStyle = '#ff00ff';
    applyCameraLetterbox(ctx, ROOM, viewport, transform);

    expect(ctx.fillStyle).toBe('#ff00ff');
    // The clip is applied OUTSIDE the internal save/restore — it must survive.
    expect(calls.indexOf('clip')).toBeGreaterThan(calls.lastIndexOf('restore'));
  });

  it('defaults to black bars', () => {
    const { ctx, fills } = stubContext();
    applyCameraLetterbox(ctx, ROOM, viewport, transform);
    expect(fills[0][4]).toBe('#000000');
  });

  it('fill: null takes the clip only', () => {
    const { ctx, calls } = stubContext();
    applyCameraLetterbox(ctx, ROOM, viewport, transform, { fill: null });
    expect(calls).toEqual(['beginPath', 'rect', 'clip']);
  });

  it('clip: false takes the bars only', () => {
    const { ctx, calls } = stubContext();
    applyCameraLetterbox(ctx, ROOM, viewport, transform, { clip: false });
    expect(calls).toEqual(['save', 'fillRect', 'restore']);
  });

  it('touches nothing but the clip when the room covers the viewport', () => {
    const { ctx, calls } = stubContext();
    const covering = cameraTransform({ x: 0, y: 0 }, viewport, { zoom: 8 });
    applyCameraLetterbox(ctx, ROOM, viewport, covering);
    expect(calls).toEqual(['beginPath', 'rect', 'clip']);
  });
});

// ===========================================================================
// composeCameraTransform — the world-space boundary
// ===========================================================================
/** A context stub that tracks the affine transform as `screen = world · s + t`. */
function transformTracker(): {
  ctx: CanvasRenderingContext2D;
  map: (x: number, y: number) => readonly [number, number];
} {
  let sx = 1;
  let sy = 1;
  let tx = 0;
  let ty = 0;
  const ctx = {
    scale: (x: number, y: number) => { sx *= x; sy *= y; },
    translate: (x: number, y: number) => { tx += x * sx; ty += y * sy; },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, map: (x, y) => [x * sx + tx, y * sy + ty] as const };
}

describe('composeCameraTransform', () => {
  const viewport: CameraViewport = { width: 1600, height: 736 };

  it('puts a hand-drawn world layer on the same screen pixel as an engine draw', () => {
    // The Celerock particle defect: the engine's level draw received the offset
    // as its `worldOffset` parameter, and the hand-written particle loop drew
    // under the zoom alone. Composing the offset into the CONTEXT makes the two
    // paths the same coordinate space by construction.
    const t = cameraTransform({ x: 137.4, y: 62.8 }, viewport, { zoom: 4, devicePixelRatio: 2 });
    const world = { x: 200, y: 96 };

    const engine = transformTracker();          // ctx.scale(zoom) + draw at worldOffset
    engine.ctx.scale(t.zoom, t.zoom);
    engine.ctx.translate(t.offsetX, t.offsetY); // what drawLdtkLevel does internally
    const enginePoint = engine.map(world.x, world.y);

    const composed = transformTracker();
    composeCameraTransform(composed.ctx, t);
    expect(composed.map(world.x, world.y)).toEqual(enginePoint);

    // And the defect itself: the zoom alone is camera-independent.
    const buggy = transformTracker();
    buggy.ctx.scale(t.zoom, t.zoom);
    expect(buggy.map(world.x, world.y)).not.toEqual(enginePoint);
  });

  it('leaves a room offset composable on top (the room-slide case)', () => {
    // During a slide, `worldOffset` carries each room's origin in SLIDE space
    // and the camera offset stays in the context — the two compose.
    const t = cameraTransform({ x: 178.2, y: 10 }, viewport, { zoom: 3.9 });
    const sourceOffset = { x: 0, y: 0 };
    const destinationOffset = { x: 320, y: 0 };

    const tracker = transformTracker();
    composeCameraTransform(tracker.ctx, t);
    const [sourceOriginX] = tracker.map(sourceOffset.x, sourceOffset.y);
    const [destOriginX] = tracker.map(destinationOffset.x, destinationOffset.y);

    expect(destOriginX - sourceOriginX).toBeCloseTo(320 * t.zoom, 9);
    expect(sourceOriginX).toBeCloseTo(t.offsetX * t.zoom, 9);
  });

  it('agrees with applyCameraTransform', () => {
    const camera = { x: 100.37, y: -12.9 };
    const options = { zoom: 2.75, devicePixelRatio: 2 } as const;
    const direct = transformTracker();
    const t = cameraTransform(camera, viewport, options);
    composeCameraTransform(direct.ctx, t);

    const applied = transformTracker();
    const appliedT = { ...t };
    composeCameraTransform(applied.ctx, appliedT);
    expect(applied.map(50, 50)).toEqual(direct.map(50, 50));
  });

  it('degrades a non-finite transform to an identity-safe composition', () => {
    const tracker = transformTracker();
    composeCameraTransform(tracker.ctx, { zoom: NaN, offsetX: NaN, offsetY: NaN });
    expect(tracker.map(10, 20)).toEqual([10, 20]);
  });
});
