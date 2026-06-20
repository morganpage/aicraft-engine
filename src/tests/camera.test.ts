import { describe, it, expect } from 'vitest';
import { createCamera, updateCamera } from '../camera';
import type { Camera, CameraTarget, CameraBounds } from '../camera';

const VIEWPORT = { width: 960, height: 540 };
const TARGET_W = 16;
const TARGET_H = 24;

function targetAtCenter(cx: number, cy: number): CameraTarget {
  return { x: cx - TARGET_W / 2, y: cy - TARGET_H / 2, width: TARGET_W, height: TARGET_H };
}

const LARGE_BOUNDS: CameraBounds = { width: 2000, height: 2000 };

describe('createCamera', () => {
  it('returns a camera parked at the world origin', () => {
    expect(createCamera()).toEqual({ x: 0, y: 0 });
  });

  it('returns a fresh object each call (no shared reference)', () => {
    expect(createCamera()).not.toBe(createCamera());
  });
});

describe('updateCamera — already centred', () => {
  it('does not move when the target sits at the viewport centre and the camera is at the origin', () => {
    const camera = createCamera();
    const target = targetAtCenter(VIEWPORT.width / 2, VIEWPORT.height / 2);
    const next = updateCamera(camera, target, LARGE_BOUNDS, VIEWPORT);
    expect(next).toEqual({ x: 0, y: 0 });
  });
});

describe('updateCamera — smoothing (lerp)', () => {
  it('moves toward a rightward target but does not snap instantly (default lerp 0.1)', () => {
    const camera = createCamera();
    const target = targetAtCenter(VIEWPORT.width / 2 + 100, VIEWPORT.height / 2);
    const next = updateCamera(camera, target, LARGE_BOUNDS, VIEWPORT);
    expect(next.x).toBeCloseTo(10, 10);
    expect(next.y).toBe(0);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(100);
  });

  it('preserves sub-pixel increments (stays float between updates, no internal rounding)', () => {
    const camera = createCamera();
    const target = targetAtCenter(VIEWPORT.width / 2 + 4, VIEWPORT.height / 2);
    const next = updateCamera(camera, target, LARGE_BOUNDS, VIEWPORT);
    expect(next.x).toBeCloseTo(0.4, 10);
    expect(next.x).toBeGreaterThan(0);
    expect(next.y).toBe(0);
  });
});

describe('updateCamera — clamping', () => {
  it('clamps to bounds.width - viewport.width at the right edge (lerp 1 = instant)', () => {
    const camera = createCamera();
    const target = targetAtCenter(2000, VIEWPORT.height / 2);
    const bounds: CameraBounds = { width: 1500, height: 1500 };
    const next = updateCamera(camera, target, bounds, VIEWPORT, { lerp: 1 });
    expect(next.x).toBe(1500 - 960);
    expect(next.y).toBe(0);
  });

  it('clamps to 0 at the left edge (lerp 1 = instant)', () => {
    const camera = createCamera();
    const target = targetAtCenter(-1000, VIEWPORT.height / 2);
    const next = updateCamera(camera, target, LARGE_BOUNDS, VIEWPORT, { lerp: 1 });
    expect(next.x).toBe(0);
    expect(next.y).toBe(0);
  });

  it('clamps each axis independently', () => {
    const camera = createCamera();
    const target = targetAtCenter(2000, VIEWPORT.height / 2);
    const bounds: CameraBounds = { width: 1500, height: 2000 };
    const next = updateCamera(camera, target, bounds, VIEWPORT, { lerp: 1 });
    expect(next.x).toBe(540);
    expect(next.y).toBe(0);
  });
});

describe('updateCamera — level smaller than viewport (centre, go negative)', () => {
  it('centres both axes when the level is smaller than the viewport on both', () => {
    const camera = createCamera();
    const target = targetAtCenter(300, 200);
    const bounds: CameraBounds = { width: 600, height: 400 };
    const next = updateCamera(camera, target, bounds, VIEWPORT, { lerp: 1 });
    expect(next.x).toBe((600 - 960) / 2);
    expect(next.y).toBe((400 - 540) / 2);
    expect(next.x).toBeLessThan(0);
    expect(next.y).toBeLessThan(0);
  });

  it('centres only the axis that is smaller (per-axis independence)', () => {
    const camera = createCamera();
    const target = targetAtCenter(300, VIEWPORT.height / 2);
    const bounds: CameraBounds = { width: 600, height: 2000 };
    const next = updateCamera(camera, target, bounds, VIEWPORT, { lerp: 1 });
    expect(next.x).toBe((600 - 960) / 2);
    expect(next.y).toBe(0);
  });
});

describe('updateCamera — snap-to-target', () => {
  it('snaps exactly when within the default snapThreshold (0.5px)', () => {
    const camera: Camera = { x: 99.8, y: 0 };
    const target = targetAtCenter(VIEWPORT.width / 2 + 100, VIEWPORT.height / 2);
    const next = updateCamera(camera, target, LARGE_BOUNDS, VIEWPORT);
    expect(next.x).toBe(100);
    expect(next.y).toBe(0);
  });

  it('does NOT snap when just outside the default snapThreshold', () => {
    const camera: Camera = { x: 99.4, y: 0 };
    const target = targetAtCenter(VIEWPORT.width / 2 + 100, VIEWPORT.height / 2);
    const next = updateCamera(camera, target, LARGE_BOUNDS, VIEWPORT);
    expect(next.x).not.toBe(100);
    expect(next.x).toBeCloseTo(99.46, 10);
  });

  it('honours a custom snapThreshold', () => {
    const camera: Camera = { x: 95, y: 0 };
    const target = targetAtCenter(VIEWPORT.width / 2 + 100, VIEWPORT.height / 2);
    const next = updateCamera(camera, target, LARGE_BOUNDS, VIEWPORT, {
      snapThreshold: 5,
    });
    expect(next.x).toBe(100);
  });
});

describe('updateCamera — convergence', () => {
  it('reaches a static target after many updates (does not asymptote forever)', () => {
    let camera = createCamera();
    const target = targetAtCenter(
      VIEWPORT.width / 2 + 200,
      VIEWPORT.height / 2 + 200,
    );
    for (let i = 0; i < 1000; i++) {
      camera = updateCamera(camera, target, LARGE_BOUNDS, VIEWPORT);
    }
    expect(camera.x).toBe(200);
    expect(camera.y).toBe(200);
  });
});

describe('updateCamera — custom config', () => {
  it('lerp 1 snaps instantly to the target', () => {
    const camera = createCamera();
    const target = targetAtCenter(VIEWPORT.width / 2 + 100, VIEWPORT.height / 2);
    const next = updateCamera(camera, target, LARGE_BOUNDS, VIEWPORT, { lerp: 1 });
    expect(next.x).toBe(100);
    expect(next.y).toBe(0);
  });

  it('lerp 0 never moves the camera', () => {
    const camera: Camera = { x: 5, y: 7 };
    const target = targetAtCenter(
      VIEWPORT.width / 2 + 100,
      VIEWPORT.height / 2 + 100,
    );
    const next = updateCamera(camera, target, LARGE_BOUNDS, VIEWPORT, { lerp: 0 });
    expect(next).toEqual({ x: 5, y: 7 });
  });
});

describe('updateCamera — purity', () => {
  it('returns a new object (not the input reference)', () => {
    const camera = createCamera();
    const target = targetAtCenter(VIEWPORT.width / 2 + 100, VIEWPORT.height / 2);
    expect(updateCamera(camera, target, LARGE_BOUNDS, VIEWPORT)).not.toBe(camera);
  });

  it('does not mutate the input camera', () => {
    const camera: Camera = { x: 10, y: 20 };
    const snapshot = { ...camera };
    const target = targetAtCenter(
      VIEWPORT.width / 2 + 100,
      VIEWPORT.height / 2 + 100,
    );
    updateCamera(camera, target, LARGE_BOUNDS, VIEWPORT);
    expect(camera).toEqual(snapshot);
  });
});

describe('updateCamera — determinism (same inputs → same outputs)', () => {
  it('returns value-equal results across calls', () => {
    const camera: Camera = { x: 7, y: 9 };
    const target = targetAtCenter(
      VIEWPORT.width / 2 + 123,
      VIEWPORT.height / 2 + 45,
    );
    const a = updateCamera(camera, target, LARGE_BOUNDS, VIEWPORT);
    const b = updateCamera(camera, target, LARGE_BOUNDS, VIEWPORT);
    expect(a).toEqual(b);
  });
});
