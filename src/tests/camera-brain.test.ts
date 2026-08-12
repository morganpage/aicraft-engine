import { describe, it, expect } from 'vitest';
import {
  createCameraBrain,
  updateCameraBrain,
  converge,
  DEFAULT_CAMERA_MOTION,
  DEFAULT_LENS_MOTION,
  DEFAULT_FOLLOW_BODY,
  DEFAULT_BRAIN_BLEND_DURATION,
  type CameraBrain,
  type CameraBrainOptions,
  type CameraTarget,
  type CameraBounds,
  type CameraViewport,
  type VirtualCamera,
} from '../camera';
// `followPosition` is a file-level helper (deliberately not in the barrel),
// imported here for focused composer tests.
import { followPosition } from '../camera/motion';

// --- shared fixtures ------------------------------------------------------

const VIEWPORT: CameraViewport = { width: 640, height: 360 };
const BOUNDS: CameraBounds = { width: 1600, height: 900 };
const DT = 1 / 60;

/** Effectively-instant motion: snaps to the aim in a single step (test only). */
const INSTANT = { halfLife: 1e-4, maxSpeed: 1e7, snapThreshold: 1e-3 };

/** A 16×24 player rect whose CENTRE sits at (cx, cy). */
function playerAt(cx: number, cy: number): CameraTarget {
  return { x: cx - 8, y: cy - 12, width: 16, height: 24 };
}

/** Convenience: the world-space centre of a rendered brain view. */
function viewCentre(
  brain: Readonly<Pick<CameraBrain, 'camera' | 'zoom'>>,
  viewport: Readonly<CameraViewport> = VIEWPORT,
): { x: number; y: number } {
  return {
    x: brain.camera.x + viewport.width / brain.zoom / 2,
    y: brain.camera.y + viewport.height / brain.zoom / 2,
  };
}

const followVcam = (overrides: Partial<VirtualCamera> = {}): VirtualCamera => ({
  id: 'follow',
  priority: 1,
  blend: 0,
  body: { mode: 'follow', targetKey: 'player' },
  ...overrides,
});

const baseOptions = (
  overrides: Partial<CameraBrainOptions> = {},
): CameraBrainOptions => ({
  vcams: [followVcam()],
  targets: { player: playerAt(320, 180) },
  bounds: BOUNDS,
  viewport: VIEWPORT,
  dt: DT,
  ...overrides,
});

// =========================================================================
// Composer: analytic convergence
// =========================================================================

describe('converge — basic response', () => {
  it('never overshoots the target (result always between current and desired)', () => {
    const cfg = { halfLife: 0.1, maxSpeed: 400, snapThreshold: 0.001 };
    let v = 0;
    for (let i = 0; i < 200; i++) {
      const next = converge(v, 100, 1 / 60, cfg);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThanOrEqual(100);
      v = next;
    }
    expect(v).toBe(100); // snaps exactly eventually
  });

  it('snaps exactly when already within snapThreshold', () => {
    expect(converge(99.7, 100, DT, { snapThreshold: 0.5 })).toBe(100);
  });

  it('does not move when dt is zero or non-positive / non-finite', () => {
    expect(converge(10, 100, 0)).toBe(10);
    expect(converge(10, 100, -1)).toBe(10);
    expect(converge(10, 100, NaN)).toBe(10);
    expect(converge(10, 100, Infinity)).toBe(10);
  });

  it('a zero-time step holds current even when within the snap threshold', () => {
    // Within snapThreshold but dt = 0: must not snap (no time elapsed → no move).
    expect(converge(0, 0.4, 0, { snapThreshold: 0.5 })).toBe(0);
    expect(converge(5, 5.3, 0, { snapThreshold: 0.5 })).toBe(5);
    expect(converge(5, 5.3, -1, { snapThreshold: 0.5 })).toBe(5);
    // With a positive dt the same input snaps to the target.
    expect(converge(5, 5.3, DT, { snapThreshold: 0.5 })).toBe(5.3);
  });

  it('holds current when desired is non-finite', () => {
    expect(converge(10, NaN, DT)).toBe(10);
  });
});

describe('converge — partition invariance (static target, outside snap band)', () => {
  // For a static target the capped ODE has the semigroup property: one step of
  // dt equals two steps of dt/2, including across the speed-cap boundary. The
  // snap projection preserves it in exact arithmetic. These cases keep the
  // final distance well outside the snap band so only FP error remains.
  const cases = [
    // {label, current, desired, halfLife, maxSpeed, snap, dt}
    { label: 'below cap', current: 0, desired: 1000, halfLife: 0.2, maxSpeed: 5000, snap: 0.001, dt: 0.1 },
    { label: 'capped region only', current: 0, desired: 5000, halfLife: 0.2, maxSpeed: 5000, snap: 0.001, dt: 0.5 },
    { label: 'crosses cap boundary', current: 0, desired: 5000, halfLife: 0.2, maxSpeed: 5000, snap: 0.001, dt: 0.9 },
  ];

  for (const c of cases) {
    it(`${c.label}: one dt step equals two dt/2 steps (tight tolerance)`, () => {
      const cfg = { halfLife: c.halfLife, maxSpeed: c.maxSpeed, snapThreshold: c.snap };
      const oneStep = converge(c.current, c.desired, c.dt, cfg);
      const twoStep = converge(converge(c.current, c.desired, c.dt / 2, cfg), c.desired, c.dt / 2, cfg);
      // Result stays outside the snap band for these inputs, so equality is FP-tight.
      expect(Math.abs(oneStep - c.desired)).toBeGreaterThan(c.snap);
      expect(twoStep).toBeCloseTo(oneStep, 9);
    });
  }
});

describe('converge — snap boundary discrepancy is bounded', () => {
  it('alternate partitions never differ by more than snapThreshold (static target)', () => {
    // Sweep currents that land the result near the snap boundary. If FP rounding
    // sends the snap comparison down opposite branches, the discrepancy is still
    // bounded by snapThreshold.
    const snap = 0.5;
    const cfg = { halfLife: 0.05, maxSpeed: 50, snapThreshold: snap };
    const desired = 100;
    for (let i = 0; i < 400; i += 1) {
      const current = desired - 0.5 - i * 0.01; // sweep across the boundary region
      const one = converge(current, desired, 1 / 60, cfg);
      const two = converge(converge(current, desired, 1 / 120, cfg), desired, 1 / 120, cfg);
      expect(Math.abs(one - two)).toBeLessThanOrEqual(snap + 1e-9);
    }
  });
});

describe('converge — invalid config uses documented defaults', () => {
  it('non-finite/non-positive halfLife and maxSpeed, and negative snap, fall back', () => {
    // With defaults restored, the result must be finite and bounded regardless
    // of the junk passed in.
    const junk = { halfLife: NaN, maxSpeed: -1, snapThreshold: -3 };
    const r = converge(0, 100, DT, junk);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(100);
    // Same as calling with the resolved default motion.
    expect(r).toBeCloseTo(converge(0, 100, DT, {}), 12);
  });
});

// =========================================================================
// Composer: followPosition (deadzone follow)
// =========================================================================

describe('followPosition — deadzone band', () => {
  it('holds when the target centre sits inside the band', () => {
    // Camera at top-left (200,100); visible 640×360; centre (520,280). Place the
    // player centre between trail/lead on both axes → camera must not move.
    const cam = { x: 200, y: 100 };
    const visibleCentreX = 200 + 640 / 2; // 520
    // s = (p - cam)/visible in [0.25, 0.5] → hold. p in [200+0.25*640, 200+0.5*640] = [360,520]
    const p = playerAt(440, 280); // s_x = (440-200)/640 = 0.375 ∈ band → hold
    const next = followPosition(cam, p, BOUNDS, VIEWPORT, 1, DT, {});
    expect(next.x).toBe(200); // held (converge to self)
    expect(next.y).toBe(100);
    void visibleCentreX;
  });

  it('moves forward once the target crosses lead (50% of visible width)', () => {
    const cam = { x: 0, y: 0 };
    // s_x = p/640 > 0.5 → p > 320. Player centre at 400 → s=0.625 → advance.
    const next = followPosition(cam, playerAt(400, 180), BOUNDS, VIEWPORT, 1, DT, {});
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(400 - 0.5 * 640); // aims at p - lead*visible = 400-320=80, eased
  });

  it('moves backward once the target drops below trail', () => {
    // Camera ahead of the player; player centre behind trail line → camera pulls back.
    const cam = { x: 300, y: 0 };
    const next = followPosition(cam, playerAt(50, 180), BOUNDS, VIEWPORT, 1, DT, {});
    // s_x = (50-300)/640 = -0.39 < 0.25 → aim = p - 0.25*640 = 50-160 = -110 → clamp 0
    expect(next.x).toBeLessThan(300);
    expect(next.x).toBeGreaterThanOrEqual(0); // clamped to 0
  });
});

describe('followPosition — level-start pin', () => {
  it('pins the camera at zero until the player crosses the 50% forward trigger', () => {
    let cam = { x: 0, y: 0 };
    // Player walking right from the left wall, but still left of the 50% line.
    for (let px = 40; px <= 300; px += 40) {
      cam = followPosition(cam, playerAt(px, 180), BOUNDS, VIEWPORT, 1, DT, {});
      expect(cam.x).toBe(0); // deadzone hold → no horizontal movement
    }
    // Once past 50% of the visible width (320), the camera starts following.
    cam = followPosition(cam, playerAt(360, 180), BOUNDS, VIEWPORT, 1, DT, {});
    expect(cam.x).toBeGreaterThan(0);
  });
});

describe('followPosition — target centre drives the band', () => {
  it('uses the rectangle centre, not its top-left', () => {
    // Two targets with the SAME centre but different top-lefts produce the same aim.
    const cam = { x: 0, y: 0 };
    const a = followPosition(cam, { x: 392, y: 168, width: 16, height: 24 }, BOUNDS, VIEWPORT, 1, DT, {});
    const b = followPosition(cam, { x: 396, y: 170, width: 8, height: 20 }, BOUNDS, VIEWPORT, 1, DT, {});
    // Both centres ≈ (400,180) → identical result.
    expect(a).toEqual(b);
  });
});

describe('followPosition — padding & per-axis letterbox', () => {
  it('clamps with overscan when padding > 0', () => {
    // A target far right pulls the aim past the bound; padding lets the camera
    // overshoot the bound by up to `padding`.
    const cam = { x: 0, y: 0 };
    const padding = 40;
    const next = followPosition(cam, playerAt(2000, 180), BOUNDS, VIEWPORT, 1, DT, {
      padding,
      motion: { halfLife: 1e-4, maxSpeed: 1e7, snapThreshold: 1e-3 }, // snap to aim in one step
    });
    // aim clamps to bound - visible + padding = 1600 - 640 + 40 = 1000.
    expect(next.x).toBeCloseTo(1000, 5);
    expect(next.y).toBe(0); // s_y in band → hold
  });

  it('letterboxes (centres) the axis when the bound is smaller than visible', () => {
    const smallBounds = { width: 400, height: 200 };
    const next = followPosition({ x: 0, y: 0 }, playerAt(100, 100), smallBounds, VIEWPORT, 1, DT, {
      motion: INSTANT,
    });
    // bound <= visible on both axes → aim = (bound-visible)/2 = (-120,-80).
    expect(next.x).toBeCloseTo((400 - 640) / 2, 5);
    expect(next.y).toBeCloseTo((200 - 360) / 2, 5);
  });

  it('letterboxes one axis independently of the other', () => {
    const mixed = { width: 400, height: 900 };
    const next = followPosition({ x: 0, y: 0 }, playerAt(100, 180), mixed, VIEWPORT, 1, DT, {
      motion: INSTANT,
    });
    expect(next.x).toBeCloseTo((400 - 640) / 2, 5); // letterboxed
    expect(next.y).toBe(0); // normal band hold (s_y = 0.5 ∈ [0.35,0.65])
  });
});

describe('followPosition — invalid band & numeric defaults', () => {
  it('falls back to the default band when the supplied band is invalid', () => {
    const cam = { x: 0, y: 0 };
    // lead < trail is invalid → whole axis uses default {0.25,0.5}.
    const bad = followPosition(cam, playerAt(400, 180), BOUNDS, VIEWPORT, 1, DT, {
      followX: { trail: 0.8, lead: 0.2 },
    });
    const def = followPosition(cam, playerAt(400, 180), BOUNDS, VIEWPORT, 1, DT, {});
    expect(bad).toEqual(def);
  });

  it('repairs a non-finite camera coordinate instead of producing NaN', () => {
    const next = followPosition({ x: NaN, y: Infinity }, playerAt(320, 180), BOUNDS, VIEWPORT, 1, DT, {});
    expect(Number.isFinite(next.x)).toBe(true);
    expect(Number.isFinite(next.y)).toBe(true);
  });
});

// =========================================================================
// Brain: selection
// =========================================================================

describe('brain — selection', () => {
  it('a valid explicit activeId wins regardless of priority', () => {
    const opts = baseOptions({
      vcams: [
        { id: 'low', priority: 1, blend: 0, body: { mode: 'fixed', x: 0, y: 0 } },
        { id: 'high', priority: 100, blend: 0, body: { mode: 'fixed', x: 960, y: 540 } },
      ],
      activeId: 'low',
    });
    const brain = updateCameraBrain(createCameraBrain(), opts);
    expect(brain.activeId).toBe('low');
  });

  it('an unknown explicit activeId falls back to priority selection', () => {
    const opts = baseOptions({
      vcams: [
        { id: 'a', priority: 1, blend: 0, body: { mode: 'fixed', x: 0, y: 0 } },
        { id: 'b', priority: 5, blend: 0, body: { mode: 'fixed', x: 100, y: 100 } },
      ],
      activeId: 'does-not-exist',
    });
    expect(updateCameraBrain(createCameraBrain(), opts).activeId).toBe('b');
  });

  it('highest priority wins', () => {
    const opts = baseOptions({
      vcams: [
        { id: 'a', priority: 0, blend: 0, body: { mode: 'fixed', x: 0, y: 0 } },
        { id: 'b', priority: 7, blend: 0, body: { mode: 'fixed', x: 10, y: 10 } },
        { id: 'c', priority: 3, blend: 0, body: { mode: 'fixed', x: 20, y: 20 } },
      ],
    });
    expect(updateCameraBrain(createCameraBrain(), opts).activeId).toBe('b');
  });

  it('ties retain the currently active vcam', () => {
    let brain = updateCameraBrain(createCameraBrain(), baseOptions({
      vcams: [
        { id: 'a', priority: 5, blend: 0, body: { mode: 'fixed', x: 0, y: 0 } },
        { id: 'b', priority: 5, blend: 0, body: { mode: 'fixed', x: 100, y: 100 } },
      ],
    }));
    expect(brain.activeId).toBe('a'); // first wins on first activation
    // Still tied, both present → keep 'a'.
    brain = updateCameraBrain(brain, baseOptions({
      vcams: [
        { id: 'a', priority: 5, blend: 0, body: { mode: 'fixed', x: 0, y: 0 } },
        { id: 'b', priority: 5, blend: 0, body: { mode: 'fixed', x: 100, y: 100 } },
      ],
    }));
    expect(brain.activeId).toBe('a');
  });

  it('duplicate/empty ids normalize deterministically (first wins, empties ignored)', () => {
    const opts = baseOptions({
      vcams: [
        { id: '', priority: 99, blend: 0, body: { mode: 'fixed', x: 0, y: 0 } },
        { id: 'a', priority: 1, blend: 0, body: { mode: 'fixed', x: 0, y: 0 } },
        { id: 'a', priority: 99, blend: 0, body: { mode: 'fixed', x: 999, y: 999 } }, // dup ignored
        { id: 'b', priority: 2, blend: 0, body: { mode: 'fixed', x: 10, y: 10 } },
      ],
    });
    expect(updateCameraBrain(createCameraBrain(), opts).activeId).toBe('b'); // highest priority among {a:1,b:2}
  });

  it('record input order is preserved (array form)', () => {
    // Same priority, array order picks the first; record form matches insertion order for string keys.
    const arr = baseOptions({
      vcams: [
        { id: 'z', priority: 1, blend: 0, body: { mode: 'fixed', x: 0, y: 0 } },
        { id: 'a', priority: 1, blend: 0, body: { mode: 'fixed', x: 1, y: 1 } },
      ],
    });
    expect(updateCameraBrain(createCameraBrain(), arr).activeId).toBe('z');
  });
});

// =========================================================================
// Brain: lifecycle & blends
// =========================================================================

describe('brain — first activation', () => {
  it('does not create a blend on first activation', () => {
    const brain = updateCameraBrain(createCameraBrain(), baseOptions());
    expect(brain.activeId).toBe('follow');
    expect(brain.blend).toBeNull();
    // Rendered == live on first activation (body seeds from rendered, advances one step).
    expect(brain.camera.x).toBe(brain.bodyCamera.x);
    expect(brain.camera.y).toBe(brain.bodyCamera.y);
  });

  it('first activation from a non-origin seed honours the seed', () => {
    const brain = updateCameraBrain(createCameraBrain({ x: 100, y: 50, zoom: 1 }), baseOptions());
    // bodyCamera seeds from rendered (100,50) then advances one step toward the player.
    expect(brain.lensZoom).toBe(1);
    expect(Number.isFinite(brain.camera.x)).toBe(true);
  });
});

describe('brain — normal switch & blend', () => {
  it('active id changes immediately on a normal switch', () => {
    let brain = updateCameraBrain(createCameraBrain(), baseOptions());
    brain = updateCameraBrain(brain, baseOptions({
      vcams: [
        followVcam(),
        { id: 'other', priority: 10, blend: 0, body: { mode: 'fixed', x: 0, y: 0 } },
      ],
    }));
    expect(brain.activeId).toBe('other');
  });

  it('a normal blend captures the rendered centre/zoom and finishes exactly at the live destination', () => {
    // Start on a fixed vcam, settle, then switch to a follow vcam with a blend.
    const fixedCam: VirtualCamera = {
      id: 'fixed', priority: 1, blend: 0,
      body: { mode: 'fixed', x: 480, y: 270 },
    };
    let brain = updateCameraBrain(createCameraBrain(), baseOptions({ vcams: [fixedCam] }));
    for (let i = 0; i < 60; i++) brain = updateCameraBrain(brain, baseOptions({ vcams: [fixedCam] }));
    const fixedRendered = { ...brain.camera, zoom: brain.zoom };

    // Switch to follow with a 0.3s blend.
    const followBlend: VirtualCamera = {
      id: 'follow', priority: 1, blend: 0.3,
      body: { mode: 'follow', targetKey: 'player' },
    };
    brain = updateCameraBrain(brain, baseOptions({ vcams: [followBlend] }));
    expect(brain.blend).not.toBeNull();
    expect(brain.blend?.fromZoom).toBe(fixedRendered.zoom);

    // Step until the blend completes; it must finish exactly on the live state.
    let steps = 0;
    while (brain.blend !== null && steps < 200) {
      brain = updateCameraBrain(brain, baseOptions({ vcams: [followBlend] }));
      steps++;
    }
    expect(brain.blend).toBeNull();
    expect(brain.camera.x).toBeCloseTo(brain.bodyCamera.x, 6);
    expect(brain.camera.y).toBeCloseTo(brain.bodyCamera.y, 6);
    expect(brain.zoom).toBeCloseTo(brain.lensZoom, 6);
  });

  it('the incoming bodyCamera trajectory matches a no-blend live solver (no feedback)', () => {
    // Brain 1: settle on a FIXED vcam, then switch to a FOLLOW vcam with a
    // blend. The blend interpolates the RENDERED view across different centres,
    // so rendered != bodyCamera mid-flight — if any of that fed back, the
    // incoming trajectory would diverge.
    const fixedCam: VirtualCamera = {
      id: 'fixed', priority: 2, blend: 0,
      body: { mode: 'fixed', x: 480, y: 270 },
    };
    const followBlend: VirtualCamera = {
      id: 'follow', priority: 1, blend: 0.4,
      body: { mode: 'follow', targetKey: 'player' },
    };
    let b1 = updateCameraBrain(createCameraBrain(), baseOptions({ vcams: [fixedCam], activeId: 'fixed' }));
    for (let i = 0; i < 60; i++) b1 = updateCameraBrain(b1, baseOptions({ vcams: [fixedCam], activeId: 'fixed' }));
    const switchRendered = { x: b1.camera.x, y: b1.camera.y };
    const switchZoom = b1.zoom;

    // Brain 1: switch to the blended follow.
    const after1: CameraBrain[] = [];
    b1 = updateCameraBrain(b1, baseOptions({ vcams: [fixedCam, followBlend], activeId: 'follow' }));
    after1.push(b1);
    for (let i = 0; i < 20; i++) {
      b1 = updateCameraBrain(b1, baseOptions({ vcams: [fixedCam, followBlend], activeId: 'follow' }));
      after1.push(b1);
    }

    // Brain 2: a fresh brain seeded exactly at the switch-time rendered view,
    // running the SAME follow body with NO blend.
    const followNoBlend: VirtualCamera = {
      id: 'follow', priority: 1, blend: 0,
      body: { mode: 'follow', targetKey: 'player' },
    };
    let b2 = createCameraBrain({ x: switchRendered.x, y: switchRendered.y, zoom: switchZoom });
    const after2: CameraBrain[] = [];
    b2 = updateCameraBrain(b2, baseOptions({ vcams: [followNoBlend], activeId: 'follow' }));
    after2.push(b2);
    for (let i = 0; i < 20; i++) {
      b2 = updateCameraBrain(b2, baseOptions({ vcams: [followNoBlend], activeId: 'follow' }));
      after2.push(b2);
    }

    // The incoming bodyCamera trajectories must match step-for-step.
    expect(after1.length).toBe(after2.length);
    for (let i = 0; i < after1.length; i++) {
      expect(after1[i].bodyCamera.x).toBeCloseTo(after2[i].bodyCamera.x, 9);
      expect(after1[i].bodyCamera.y).toBeCloseTo(after2[i].bodyCamera.y, 9);
    }
  });

  it('a blend interruption restarts from the currently rendered view with no discontinuity', () => {
    // Switch A→B (blend), then mid-blend switch B→C. The new blend's frozen
    // source must equal the rendered view at the moment of interruption.
    const a: VirtualCamera = { id: 'a', priority: 3, blend: 0, body: { mode: 'fixed', x: 0, y: 0 } };
    const b: VirtualCamera = { id: 'b', priority: 2, blend: 0.5, body: { mode: 'fixed', x: 960, y: 540 } };
    const c: VirtualCamera = { id: 'c', priority: 1, blend: 0.5, body: { mode: 'fixed', x: 480, y: 270 } };

    let brain = updateCameraBrain(createCameraBrain(), baseOptions({ vcams: [a, b, c], activeId: 'a' }));
    for (let i = 0; i < 60; i++) brain = updateCameraBrain(brain, baseOptions({ vcams: [a, b, c], activeId: 'a' }));

    // Switch a→b (raise b's priority via activeId override).
    brain = updateCameraBrain(brain, baseOptions({ vcams: [a, b, c], activeId: 'b' }));
    expect(brain.blend).not.toBeNull();
    // Advance a few steps into the blend.
    for (let i = 0; i < 3; i++) brain = updateCameraBrain(brain, baseOptions({ vcams: [a, b, c], activeId: 'b' }));
    const interruptedRendered = { x: brain.camera.x, y: brain.camera.y, zoom: brain.zoom };

    // Interrupt: switch to c. The new blend's fromCenter/fromZoom must match the
    // rendered view at the interruption instant.
    brain = updateCameraBrain(brain, baseOptions({ vcams: [a, b, c], activeId: 'c' }));
    expect(brain.blend).not.toBeNull();
    const fc = brain.blend!.fromCenter;
    const expected = viewCentre({ camera: { x: interruptedRendered.x, y: interruptedRendered.y }, zoom: interruptedRendered.zoom });
    expect(fc.x).toBeCloseTo(expected.x, 6);
    expect(fc.y).toBeCloseTo(expected.y, 6);
    expect(brain.blend!.fromZoom).toBeCloseTo(interruptedRendered.zoom, 6);
  });

  it('a blend starting inside the source padding overscan does not jump on the first frame', () => {
    // Source vcam allows 100px of overscan and is rendered at x = -100 (valid
    // only because of that padding). Destination vcam allows no overscan and
    // blends in over 1s. Switching with zero elapsed time, the first blend
    // frame must reproduce the previous render exactly — clamping with the new
    // (zero) padding would otherwise snap x from -100 to 0 before any blending.
    const wide: VirtualCamera = {
      id: 'wide', priority: 1, blend: 0,
      body: { mode: 'fixed', x: -100, y: 0, padding: 100 },
    };
    const tight: VirtualCamera = {
      id: 'tight', priority: 100, blend: 1.0,
      body: { mode: 'fixed', x: 480, y: 270, padding: 0 },
    };
    const before: CameraBrain = {
      camera: { x: -100, y: 0 },
      zoom: 1,
      activeId: 'wide',
      bodyCamera: { x: -100, y: 0 },
      lensZoom: 1,
      blend: null,
    };
    const brain = updateCameraBrain(before, baseOptions({ vcams: [wide, tight], activeId: 'tight', dt: 0 }));
    expect(brain.blend).not.toBeNull();
    expect(brain.camera).toEqual({ x: -100, y: 0 });
    expect(brain.zoom).toBe(1);
  });
});

describe('brain — blend duration edges', () => {
  it('a finite blend <= 0 disables the brain-level blend', () => {
    const a: VirtualCamera = { id: 'a', priority: 2, blend: 0, body: { mode: 'fixed', x: 0, y: 0 } };
    const b: VirtualCamera = { id: 'b', priority: 1, blend: 0, body: { mode: 'fixed', x: 100, y: 100 } };
    let brain = updateCameraBrain(createCameraBrain(), baseOptions({ vcams: [a, b], activeId: 'a' }));
    brain = updateCameraBrain(brain, baseOptions({ vcams: [a, b], activeId: 'b' }));
    expect(brain.blend).toBeNull();
  });

  it('a non-finite blend duration defaults to DEFAULT_BRAIN_BLEND_DURATION', () => {
    const a: VirtualCamera = { id: 'a', priority: 2, blend: 0, body: { mode: 'fixed', x: 0, y: 0 } };
    const b: VirtualCamera = { id: 'b', priority: 1, blend: NaN, body: { mode: 'fixed', x: 100, y: 100 } };
    let brain = updateCameraBrain(createCameraBrain(), baseOptions({ vcams: [a, b], activeId: 'a' }));
    brain = updateCameraBrain(brain, baseOptions({ vcams: [a, b], activeId: 'b' }));
    expect(brain.blend).not.toBeNull();
    expect(brain.blend!.duration).toBe(DEFAULT_BRAIN_BLEND_DURATION);
  });
});

describe('brain — removal & inactivity', () => {
  it('removing the active vcam selects a replacement', () => {
    const a: VirtualCamera = { id: 'a', priority: 1, blend: 0, body: { mode: 'fixed', x: 0, y: 0 } };
    const b: VirtualCamera = { id: 'b', priority: 1, blend: 0, body: { mode: 'fixed', x: 10, y: 10 } };
    let brain = updateCameraBrain(createCameraBrain(), baseOptions({ vcams: [a, b], activeId: 'a' }));
    expect(brain.activeId).toBe('a');
    // Remove a entirely; b remains.
    brain = updateCameraBrain(brain, baseOptions({ vcams: [b] }));
    expect(brain.activeId).toBe('b');
  });

  it('removing all vcams makes the brain inactive and holding', () => {
    const a: VirtualCamera = { id: 'a', priority: 1, blend: 0, body: { mode: 'fixed', x: 0, y: 0 } };
    let brain = updateCameraBrain(createCameraBrain(), baseOptions({ vcams: [a], activeId: 'a' }));
    const before = {
      camera: { ...brain.camera },
      zoom: brain.zoom,
      bodyCamera: { ...brain.bodyCamera },
      lensZoom: brain.lensZoom,
    };
    brain = updateCameraBrain(brain, baseOptions({ vcams: [] }));
    expect(brain.activeId).toBeNull();
    expect(brain.blend).toBeNull();
    expect(brain.camera).toEqual(before.camera);
    expect(brain.zoom).toBe(before.zoom);
    expect(brain.bodyCamera).toEqual(before.bodyCamera);
    expect(brain.lensZoom).toBe(before.lensZoom);
  });
});

// =========================================================================
// Brain: lens, zoom-only, centre anchoring
// =========================================================================

describe('brain — lens convergence & centre anchoring', () => {
  it('lens convergence is analytic and centre-anchored (zoom-only vcam holds the centre)', () => {
    // Zoom-only vcam (no body): the live view CENTRE stays fixed as zoom changes.
    const zoomOnly: VirtualCamera = { id: 'z', priority: 1, blend: 0, lens: { zoom: 2 } };
    let brain = updateCameraBrain(createCameraBrain({ x: 100, y: 50, zoom: 1 }), baseOptions({ vcams: [zoomOnly] }));
    const startCentre = viewCentre(brain);
    for (let i = 0; i < 40; i++) {
      brain = updateCameraBrain(brain, baseOptions({ vcams: [zoomOnly] }));
      const centre = viewCentre(brain);
      expect(centre.x).toBeCloseTo(startCentre.x, 5);
      expect(centre.y).toBeCloseTo(startCentre.y, 5);
    }
    expect(brain.lensZoom).toBeGreaterThan(1); // zoom moved toward 2
    expect(brain.lensZoom).toBeLessThanOrEqual(2);
  });

  it('a centre-based position/zoom blend has no upper-left anchoring jump', () => {
    // Two fixed vcams sharing the SAME world centre but different zoom. A
    // centre-based blend keeps the centre pinned at the midpoint; an
    // upper-left-anchored (naive top-left lerp) blend would drift the centre.
    const pad = 1000;
    const bounds = { width: 100000, height: 100000 };
    // centre (100,100): zoom 1 top-left = (100-320,100-180); zoom 2 top-left = (100-160,100-90).
    const instant = { halfLife: 1e-4, maxSpeed: 1e7, snapThreshold: 1e-3 };
    const a: VirtualCamera = {
      id: 'a', priority: 1, blend: 0,
      body: { mode: 'fixed', x: 100 - 320, y: 100 - 180, padding: pad, motion: instant },
      lens: { zoom: 1, motion: instant },
    };
    const b: VirtualCamera = {
      id: 'b', priority: 1, blend: 0.5,
      body: { mode: 'fixed', x: 100 - 160, y: 100 - 90, padding: pad, motion: instant },
      lens: { zoom: 2, motion: instant },
    };
    let brain = updateCameraBrain(createCameraBrain(), baseOptions({ vcams: [a], bounds, activeId: 'a' }));
    // Settle a.
    brain = updateCameraBrain(brain, baseOptions({ vcams: [a], bounds, activeId: 'a' }));

    // Switch to b and advance exactly one step whose dt lands t at 0.5
    // (duration 0.5, dt 0.25 → elapsed 0.25, t 0.5).
    brain = updateCameraBrain(brain, baseOptions({ vcams: [a, b], bounds, activeId: 'b', dt: 0.25 }));
    expect(brain.blend).not.toBeNull();
    expect(brain.zoom).toBeCloseTo(1.5, 5); // midpoint of 1 and 2
    const centre = viewCentre(brain);
    expect(centre.x).toBeCloseTo(100, 4); // pinned at the shared centre, not drifted
    expect(centre.y).toBeCloseTo(100, 4);
  });
});

// =========================================================================
// Brain: missing target, fixed body
// =========================================================================

describe('brain — missing follow target', () => {
  it('holds the live centre while a blend can still complete', () => {
    const fixedCam: VirtualCamera = { id: 'fixed', priority: 2, blend: 0, body: { mode: 'fixed', x: 480, y: 270 } };
    // Follow vcam whose target key is absent from the table.
    const ghostFollow: VirtualCamera = {
      id: 'ghost', priority: 1, blend: 0.3,
      body: { mode: 'follow', targetKey: 'missing' },
    };
    let brain = updateCameraBrain(createCameraBrain(), baseOptions({ vcams: [fixedCam], activeId: 'fixed', targets: {} }));
    for (let i = 0; i < 60; i++) brain = updateCameraBrain(brain, baseOptions({ vcams: [fixedCam], activeId: 'fixed', targets: {} }));

    brain = updateCameraBrain(brain, baseOptions({ vcams: [fixedCam, ghostFollow], activeId: 'ghost', targets: {} }));
    expect(brain.blend).not.toBeNull();
    const heldCentre = viewCentre({ camera: brain.bodyCamera, zoom: brain.lensZoom });

    let steps = 0;
    while (brain.blend !== null && steps < 200) {
      brain = updateCameraBrain(brain, baseOptions({ vcams: [fixedCam, ghostFollow], activeId: 'ghost', targets: {} }));
      // The LIVE body centre stays held throughout the blend.
      const c = viewCentre({ camera: brain.bodyCamera, zoom: brain.lensZoom });
      expect(c.x).toBeCloseTo(heldCentre.x, 4);
      expect(c.y).toBeCloseTo(heldCentre.y, 4);
      steps++;
    }
    expect(brain.blend).toBeNull(); // blend completed despite the missing target
  });
});

describe('brain — fixed body', () => {
  it('clamps to bounds and uses its supplied motion config', () => {
    const fixed: VirtualCamera = {
      id: 'fixed', priority: 1, blend: 0,
      body: { mode: 'fixed', x: 2000, y: 2000 }, // beyond bounds → clamped
    };
    let brain = updateCameraBrain(createCameraBrain(), baseOptions({ vcams: [fixed] }));
    // Converge + clamp: x aims at min(2000, 1600-640)=960, y at min(2000,900-360)=540.
    // Default motion's long capped region needs a couple seconds to fully snap.
    for (let i = 0; i < 240; i++) brain = updateCameraBrain(brain, baseOptions({ vcams: [fixed] }));
    expect(brain.bodyCamera.x).toBeCloseTo(960, 5);
    expect(brain.bodyCamera.y).toBeCloseTo(540, 5);
  });
});

// =========================================================================
// Brain: purity, determinism, degeneracies
// =========================================================================

describe('brain — purity & determinism', () => {
  it('never mutates inputs and returns fresh objects', () => {
    const brain0 = createCameraBrain();
    const opts = baseOptions();
    const brainSnapshot = JSON.stringify(brain0);
    const optsSnapshot = JSON.stringify(opts);
    const result = updateCameraBrain(brain0, opts);
    expect(JSON.stringify(brain0)).toBe(brainSnapshot); // input brain unchanged
    expect(JSON.stringify(opts)).toBe(optsSnapshot); // input options unchanged
    expect(result).not.toBe(brain0); // fresh top-level object
    expect(result.camera).not.toBe(brain0.camera);
    expect(result.bodyCamera).not.toBe(brain0.bodyCamera);
  });

  it('identical inputs yield identical outputs', () => {
    const a = updateCameraBrain(createCameraBrain(), baseOptions());
    const b = updateCameraBrain(createCameraBrain(), baseOptions());
    expect(a).toEqual(b);
  });
});

describe('brain — numeric degeneracies return finite state without throwing', () => {
  it('survives non-finite/non-positive viewport, bounds, dt, and state', () => {
    const brain0: CameraBrain = {
      camera: { x: NaN, y: Infinity },
      zoom: -2,
      activeId: null,
      bodyCamera: { x: NaN, y: NaN },
      lensZoom: 0,
      blend: null,
    };
    const opts: CameraBrainOptions = {
      vcams: [followVcam()],
      targets: { player: playerAt(320, 180) },
      bounds: { width: -10, height: NaN },
      viewport: { width: 0, height: -5 },
      dt: NaN,
    };
    const brain = updateCameraBrain(brain0, opts);
    expect(Number.isFinite(brain.camera.x)).toBe(true);
    expect(Number.isFinite(brain.camera.y)).toBe(true);
    expect(Number.isFinite(brain.zoom)).toBe(true);
    expect(brain.zoom).toBeGreaterThan(0);
    expect(Number.isFinite(brain.lensZoom)).toBe(true);
    expect(Number.isFinite(brain.bodyCamera.x)).toBe(true);
    expect(Number.isFinite(brain.bodyCamera.y)).toBe(true);
  });

  it('survives a non-finite lens target by holding the current zoom', () => {
    const bad: VirtualCamera = { id: 'bad', priority: 1, blend: 0, lens: { zoom: NaN } };
    const brain = updateCameraBrain(createCameraBrain({ zoom: 1.5 }), baseOptions({ vcams: [bad] }));
    expect(brain.lensZoom).toBe(1.5); // held
  });
});

// =========================================================================
// Defaults sanity
// =========================================================================

describe('defaults', () => {
  it('exposes the documented motion/lens/follow/blend defaults', () => {
    expect(DEFAULT_CAMERA_MOTION).toEqual({ halfLife: 0.12, maxSpeed: 1600, snapThreshold: 0.5 });
    expect(DEFAULT_LENS_MOTION).toEqual({ halfLife: 0.12, maxSpeed: 4, snapThreshold: 0.001 });
    expect(DEFAULT_FOLLOW_BODY.targetKey).toBe('player');
    expect(DEFAULT_FOLLOW_BODY.followX).toEqual({ trail: 0.25, lead: 0.5 });
    expect(DEFAULT_FOLLOW_BODY.followY).toEqual({ trail: 0.35, lead: 0.65 });
    expect(DEFAULT_BRAIN_BLEND_DURATION).toBe(0.3);
  });
});
