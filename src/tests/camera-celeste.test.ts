import { describe, it, expect } from 'vitest';
import {
  CELESTE_CAMERA_WINDOW,
  CELESTE_FOLLOW_CENTERED,
  CELESTE_FOLLOW_AHEAD,
  CELESTE_ROOM_SLIDE_DURATION,
  CELESTE_ROOM_SLIDE_OPTIONS,
  celesteCameraZoom,
  celesteFollowMotion,
  celesteFollowVcam,
  createCameraBrain,
  devicePixelSnapThreshold,
  fitCameraZoom,
  snapCameraBrain,
  type CameraBrain,
  type CameraTarget,
  type CameraViewport,
} from '../camera';
import { easeOutCubic } from '../easing';

/**
 * The Celeste camera preset — the decompile-verified constants as shipped
 * values, plus the two assemblies (zoom, follow vcam) and the device-pixel
 * snap threshold they rest on. Each assertion names the decompile fact it
 * pins, so a future edit that drifts from the reference fails with the
 * provenance attached.
 *
 * @module
 */

// A 16×24 player rect whose CENTRE sits at (cx, cy).
function playerAt(cx: number, cy: number): CameraTarget {
  return { x: cx - 8, y: cy - 12, width: 16, height: 24 };
}

describe('celeste preset — constants', () => {
  it('the window is the one-screen ROOM (320×184), not the 320×180 viewport', () => {
    // 40×23 tiles × 8px; the 4px slack becomes the vertical clamp range.
    expect(CELESTE_CAMERA_WINDOW).toEqual({ width: 320, height: 184 });
    expect(Object.isFrozen(CELESTE_CAMERA_WINDOW)).toBe(true);
  });

  it('the bands: centered recenter (the decompile has NO deadzone) and the 1/3 ahead pin', () => {
    // Player.CameraTarget recenters every frame — trail == lead == 0.5 makes
    // the deadzone hold range measure-zero, which is how the deadzone solver
    // expresses "no deadzone".
    expect(CELESTE_FOLLOW_CENTERED).toEqual({ trail: 0.5, lead: 0.5 });
    // The authored-cameraOffset framing: player at 1/3 from the left.
    expect(CELESTE_FOLLOW_AHEAD).toEqual({ trail: 1 / 3, lead: 1 / 3 });
    expect(1 / 3).toBeGreaterThan(0.32);
    expect(Object.isFrozen(CELESTE_FOLLOW_CENTERED)).toBe(true);
    expect(Object.isFrozen(CELESTE_FOLLOW_AHEAD)).toBe(true);
  });

  it('the transition: 0.65s (DefaultTransitionDuration) under CubeOut (= easeOutCubic)', () => {
    expect(CELESTE_ROOM_SLIDE_DURATION).toBe(0.65);
    expect(CELESTE_ROOM_SLIDE_OPTIONS.duration).toBe(0.65);
    expect(CELESTE_ROOM_SLIDE_OPTIONS.easing).toBe(easeOutCubic);
    expect(CELESTE_ROOM_SLIDE_OPTIONS.easing(0.5)).toBeCloseTo(0.875, 12);
    expect(Object.isFrozen(CELESTE_ROOM_SLIDE_OPTIONS)).toBe(true);
  });
});

describe('celeste preset — celesteCameraZoom', () => {
  it('is the WINDOW contain-fit with integer scale — a one-screen room fills it exactly', () => {
    const viewport: CameraViewport = { width: 1600, height: 920 };
    // 1600/320 = 5 and 920/184 = 5: the window fills the viewport at zoom 5.
    expect(celesteCameraZoom(viewport)).toBe(5);
    expect(celesteCameraZoom(viewport)).toBe(
      fitCameraZoom(CELESTE_CAMERA_WINDOW, viewport, { mode: 'contain', integerScale: true }),
    );
  });

  it('zoom is constant across differing aspect ratios only via the viewport — never a room input', () => {
    // The function takes NO room argument — the invariant is structural. Pin
    // the contain+integer behaviour at two aspect ratios:
    // 16:9 (1290/320 ≈ 4.03, 720/184 ≈ 3.91 → contain 3.91 → floor 3)…
    expect(celesteCameraZoom({ width: 1290, height: 720 })).toBe(3);
    // …and a tall viewport (720/320 = 2.25, 1035/184 ≈ 5.62 → contain 2.25 → 2).
    expect(celesteCameraZoom({ width: 720, height: 1035 })).toBe(2);
    // Always integral (integerScale) and always fits the window inside.
    for (const vp of [
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
      { width: 800, height: 600 },
      { width: 375, height: 812 },
    ]) {
      const zoom = celesteCameraZoom(vp);
      expect(Number.isInteger(zoom)).toBe(true);
      expect(CELESTE_CAMERA_WINDOW.width * zoom).toBeLessThanOrEqual(vp.width + 1e-9);
      expect(CELESTE_CAMERA_WINDOW.height * zoom).toBeLessThanOrEqual(vp.height + 1e-9);
    }
  });

  it('invalid viewports degrade like fitCameraZoom (zoom 1, never throws)', () => {
    for (const bad of [NaN, Infinity, 0, -1] as const) {
      expect(celesteCameraZoom({ width: bad, height: 720 })).toBe(1);
      expect(celesteCameraZoom({ width: 1280, height: bad })).toBe(1);
    }
  });
});

describe('celeste preset — devicePixelSnapThreshold', () => {
  it('one device pixel expressed in world units', () => {
    expect(devicePixelSnapThreshold(1, 1)).toBe(1);
    expect(devicePixelSnapThreshold(5, 2)).toBeCloseTo(0.1, 12);
    expect(devicePixelSnapThreshold(3, 1)).toBeCloseTo(1 / 3, 12);
  });

  it('invalid zoom/dpr degrade to the shipped default (0.5), not a never-snapping 0', () => {
    for (const bad of [NaN, Infinity, 0, -1] as const) {
      expect(devicePixelSnapThreshold(bad, 2)).toBe(0.5);
      expect(devicePixelSnapThreshold(5, bad)).toBe(0.5);
    }
  });

  it('the lurch it exists to prevent: a fixed 0.5 world-px snap is a multi-DEVICE-pixel jump at zoom 3+', () => {
    // 0.5 world px × zoom 5 × dpr 2 = 5 device pixels in one terminal tick;
    // the device-pixel threshold is 1 by construction.
    expect(0.5 * 5 * 2).toBe(5);
    expect(devicePixelSnapThreshold(5, 2) * 5 * 2).toBeCloseTo(1, 12);
  });
});

describe('celeste preset — celesteFollowMotion', () => {
  it('the decompile ease (half-life ≈ 0.1505s → 0.15) with the conservative cap', () => {
    const motion = celesteFollowMotion(5, 2);
    expect(motion.halfLife).toBe(0.15);
    // Uncapped in the decompile (implied one-screen peak ≈ 1474 px/s); the cap
    // engages only beyond ~1.1 screens of error.
    expect(motion.maxSpeed).toBe(1600);
    expect(motion.snapThreshold).toBeCloseTo(devicePixelSnapThreshold(5, 2), 12);
  });
});

describe('celeste preset — celesteFollowVcam', () => {
  const VIEWPORT: CameraViewport = { width: 1600, height: 920 };

  it('assembles the complete follow vcam: cut blend, centered bands default, window-fit lens', () => {
    const vcam = celesteFollowVcam('room-0', { viewport: VIEWPORT, dpr: 2 });
    expect(vcam.id).toBe('room-0');
    expect(vcam.priority).toBe(0);
    expect(vcam.blend).toBe(0);
    expect(vcam.body).toEqual({
      mode: 'follow',
      targetKey: 'player',
      followX: CELESTE_FOLLOW_CENTERED,
      followY: CELESTE_FOLLOW_CENTERED,
      motion: celesteFollowMotion(5, 2),
      padding: 0,
    });
    expect(vcam.lens).toEqual({ zoom: 5 });
  });

  it('overrides: ahead framing, custom target key, default dpr 1', () => {
    const vcam = celesteFollowVcam('x', {
      viewport: VIEWPORT,
      followX: CELESTE_FOLLOW_AHEAD,
      targetKey: 'hero',
    });
    expect(vcam.body?.mode).toBe('follow');
    if (vcam.body?.mode === 'follow') {
      expect(vcam.body.followX).toEqual({ trail: 1 / 3, lead: 1 / 3 });
      expect(vcam.body.followY).toEqual(CELESTE_FOLLOW_CENTERED);
      expect(vcam.body.targetKey).toBe('hero');
      expect(vcam.body.motion?.snapThreshold).toBeCloseTo(1 / 5, 12); // dpr 1
    }
  });

  it('works with the brain end to end: the snap solves to the centered framing (Level.cs:2835 — no boot ease)', () => {
    const vcam = celesteFollowVcam('room-0', { viewport: VIEWPORT, dpr: 1 });
    // A room EXACTLY the window (320×184): the clamp cannot move the camera,
    // so the snapped framing is pure band math — the player dead-centre.
    let brain: CameraBrain = snapCameraBrain(createCameraBrain(), {
      vcams: [vcam],
      targets: { player: playerAt(160, 92) },
      bounds: { width: 320, height: 184 },
      viewport: VIEWPORT,
      activeId: 'room-0',
      dt: 1 / 60,
    });
    // Visible world = viewport / zoom = 320×184 → centered target = room centre.
    expect(brain.camera.x).toBeCloseTo(0, 10);
    expect(brain.camera.y).toBeCloseTo(0, 10);
    expect(brain.zoom).toBe(5);

    // A BIGGER room (640 wide = two screens): the same vcam, and the snap
    // centers the player at 1/3 with the ahead band, clamped flush at walls.
    const ahead = celesteFollowVcam('room-1', {
      viewport: VIEWPORT,
      dpr: 1,
      followX: CELESTE_FOLLOW_AHEAD,
    });
    brain = snapCameraBrain(brain, {
      vcams: [ahead],
      targets: { player: playerAt(320, 92) },
      bounds: { width: 640, height: 184 },
      viewport: VIEWPORT,
      activeId: 'room-1',
      dt: 1 / 60,
    });
    // Player mid-room at 1/3 from the left: camera.x = 320 − 320/3 ≈ 213.33,
    // within the clamp [0, 640−320].
    expect(brain.camera.x).toBeCloseTo(320 - 320 / 3, 9);
    // At the right wall (player 620): the clamp wins over the band — Celeste's
    // own behaviour near edges.
    brain = snapCameraBrain(brain, {
      vcams: [ahead],
      targets: { player: playerAt(620, 92) },
      bounds: { width: 640, height: 184 },
      viewport: VIEWPORT,
      activeId: 'room-1',
      dt: 1 / 60,
    });
    expect(brain.camera.x).toBe(640 - 320);
  });
});
