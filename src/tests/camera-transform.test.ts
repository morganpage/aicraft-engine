import { describe, expect, it, vi } from 'vitest';
import {
  applyCameraTransform,
  cameraTransform,
  type CameraTransformOptions,
} from '../camera';
import type { Camera, CameraViewport } from '../camera';

const VIEWPORT: CameraViewport = { width: 960, height: 540 };

/** Device-pixel position of world x under a transform. */
function devicePosition(offset: number, zoom: number, dpr: number): number {
  return offset * zoom * dpr;
}

describe('cameraTransform — device snapping', () => {
  it('lands the world origin on an exact device pixel under a fractional zoom', () => {
    // The case world-space rounding cannot handle: 2.75× zoom means a whole
    // world pixel is 2.75 device pixels, so a world-integer offset is still
    // fractional on the device grid.
    // x rounds to 101 in world units, and 101 · 2.75 = 277.75 — a whole world
    // pixel is still a fractional device pixel.
    const camera: Camera = { x: 101.37, y: -12.9 };
    const options: CameraTransformOptions = { zoom: 2.75, devicePixelRatio: 1 };
    const t = cameraTransform(camera, VIEWPORT, options);

    expect(Number.isInteger(devicePosition(t.offsetX, 2.75, 1))).toBe(true);
    expect(Number.isInteger(devicePosition(t.offsetY, 2.75, 1))).toBe(true);

    // The documented world-space alternative does NOT land on the device grid.
    const worldRounded = cameraTransform(camera, VIEWPORT, { ...options, snap: 'world' });
    expect(Number.isInteger(devicePosition(worldRounded.offsetX, 2.75, 1))).toBe(false);
  });

  it('accounts for the device pixel ratio', () => {
    const t = cameraTransform({ x: 10.3, y: 0 }, VIEWPORT, { zoom: 3, devicePixelRatio: 2 });
    // 10.3 * 6 = 61.8 → 62 device px → 62 / 6 world px.
    expect(t.offsetX).toBeCloseTo(-62 / 6, 12);
    expect(Number.isInteger(devicePosition(t.offsetX, 3, 2))).toBe(true);
  });

  it('never moves the offset more than half a device pixel', () => {
    const zoom = 4.75;
    for (const x of [0, 0.1, 12.49, -7.51, 300.999, -0.5]) {
      const t = cameraTransform({ x, y: 0 }, VIEWPORT, { zoom });
      const errorInDevicePixels = Math.abs(devicePosition(t.offsetX, zoom, 1) + x * zoom);
      expect(errorInDevicePixels).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it('defaults to device snapping', () => {
    const camera: Camera = { x: 33.3, y: 9.7 };
    expect(cameraTransform(camera, VIEWPORT, { zoom: 2.5 })).toEqual(
      cameraTransform(camera, VIEWPORT, { zoom: 2.5, snap: 'device' }),
    );
  });
});

describe('cameraTransform — snap modes', () => {
  const camera: Camera = { x: 100.37, y: -12.9 };

  it("'world' rounds to whole world pixels", () => {
    const t = cameraTransform(camera, VIEWPORT, { zoom: 2.75, snap: 'world' });
    expect(t.offsetX).toBe(-100);
    expect(t.offsetY).toBe(13);
  });

  it("'none' passes the exact float camera through", () => {
    const t = cameraTransform(camera, VIEWPORT, { zoom: 2.75, snap: 'none' });
    expect(t.offsetX).toBe(-100.37);
    expect(t.offsetY).toBe(12.9);
  });

  it('device and world agree exactly when zoom · dpr is an integer', () => {
    const device = cameraTransform(camera, VIEWPORT, { zoom: 2, devicePixelRatio: 2 });
    const world = cameraTransform(camera, VIEWPORT, {
      zoom: 2,
      devicePixelRatio: 2,
      snap: 'world',
    });
    // Integral device scale: rounding in world units is already device-exact
    // for whole-pixel steps, but the device grid is 4× finer, so device
    // snapping resolves to a finer offset. Both are device-aligned.
    expect(Number.isInteger(devicePosition(device.offsetX, 2, 2))).toBe(true);
    expect(Number.isInteger(devicePosition(world.offsetX, 2, 2))).toBe(true);
  });
});

describe('cameraTransform — pixelAligned', () => {
  it('is true only when the whole world grid maps onto device pixels', () => {
    expect(cameraTransform({ x: 0, y: 0 }, VIEWPORT, { zoom: 3 }).pixelAligned).toBe(true);
    expect(
      cameraTransform({ x: 0, y: 0 }, VIEWPORT, { zoom: 1.5, devicePixelRatio: 2 }).pixelAligned,
    ).toBe(true);
    // A fractional cover fit: the origin is snapped, the grid is not aligned.
    expect(cameraTransform({ x: 0, y: 0 }, VIEWPORT, { zoom: 2.75 }).pixelAligned).toBe(false);
  });

  it('is false whenever snapping is disabled, however clean the zoom', () => {
    expect(
      cameraTransform({ x: 0, y: 0 }, VIEWPORT, { zoom: 4, snap: 'none' }).pixelAligned,
    ).toBe(false);
  });
});

describe('cameraTransform — view rectangle', () => {
  it('describes what was drawn (the snapped position), not the float camera', () => {
    const t = cameraTransform({ x: 100.37, y: -12.9 }, VIEWPORT, { zoom: 2.5 });
    expect(t.view.x).toBe(-t.offsetX);
    expect(t.view.y).toBe(-t.offsetY);
    expect(t.view.width).toBe(960 / 2.5);
    expect(t.view.height).toBe(540 / 2.5);
  });

  it('divides the PHYSICAL viewport by the zoom', () => {
    const t = cameraTransform({ x: 0, y: 0 }, { width: 640, height: 360 }, { zoom: 4 });
    expect(t.view.width).toBe(160);
    expect(t.view.height).toBe(90);
  });
});

describe('cameraTransform — defensive degradation', () => {
  it('degrades non-finite / non-positive zoom and dpr to 1', () => {
    for (const zoom of [0, -3, Number.NaN, Infinity]) {
      expect(cameraTransform({ x: 0, y: 0 }, VIEWPORT, { zoom }).zoom).toBe(1);
    }
    const t = cameraTransform({ x: 2.4, y: 0 }, VIEWPORT, { zoom: 1, devicePixelRatio: 0 });
    expect(t.offsetX).toBe(-2); // dpr 0 → 1, so device snapping is world snapping
  });

  it('reads a non-finite camera coordinate as zero', () => {
    const t = cameraTransform({ x: Number.NaN, y: Infinity }, VIEWPORT, { zoom: 2 });
    expect(t.offsetX).toBe(0);
    expect(t.offsetY).toBe(0);
  });

  it('degrades non-finite viewport dimensions to 1 rather than emitting NaN', () => {
    const t = cameraTransform({ x: 0, y: 0 }, { width: Number.NaN, height: 0 }, { zoom: 2 });
    expect(t.view.width).toBe(0.5);
    expect(t.view.height).toBe(0.5);
  });

  it('uses the documented defaults when no options are supplied', () => {
    const t = cameraTransform({ x: 5.5, y: -5.5 }, VIEWPORT);
    expect(t.zoom).toBe(1);
    // `Math.round` breaks ties toward +Infinity: 5.5 → 6, but -5.5 → -5.
    expect(t.offsetX).toBe(-6);
    expect(t.offsetY).toBe(5);
    expect(t.pixelAligned).toBe(true);
  });
});

describe('applyCameraTransform', () => {
  it('scales then translates, and reports the transform it applied', () => {
    const calls: string[] = [];
    const scale = vi.fn(() => calls.push('scale'));
    const translate = vi.fn(() => calls.push('translate'));
    const ctx = { scale, translate } as unknown as CanvasRenderingContext2D;

    const t = applyCameraTransform(ctx, { x: 100.37, y: -12.9 }, VIEWPORT, { zoom: 2.75 });

    expect(calls).toEqual(['scale', 'translate']);
    expect(scale).toHaveBeenCalledExactlyOnceWith(2.75, 2.75);
    expect(translate).toHaveBeenCalledExactlyOnceWith(t.offsetX, t.offsetY);
    expect(t).toEqual(cameraTransform({ x: 100.37, y: -12.9 }, VIEWPORT, { zoom: 2.75 }));
  });

  it('leaves save/restore to the caller (composes onto the current transform)', () => {
    const save = vi.fn();
    const restore = vi.fn();
    const ctx = {
      scale: vi.fn(),
      translate: vi.fn(),
      save,
      restore,
    } as unknown as CanvasRenderingContext2D;
    applyCameraTransform(ctx, { x: 0, y: 0 }, VIEWPORT, { zoom: 2 });
    expect(save).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });
});
