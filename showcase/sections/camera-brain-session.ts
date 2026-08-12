/**
 * DOM-free demo session for the camera-brain showcase section.
 *
 * Owns plain state for a `1600 x 900` world viewed through a `640 x 360`
 * physical viewport. A target moves deterministically back and forth through
 * the world at the fixed timestep; two same-space virtual cameras compete by
 * PRIORITY (no `activeId` is ever supplied, so selection is real, not an
 * override):
 *
 *   - `player-follow` (priority 10, blend 0.45) — deadzone-follows the target.
 *   - `director-focus` (priority 20 when enabled, else 0; blend 0.6) — a fixed
 *     focus at (720, 300) with a 1.35× zoom.
 *
 * Toggling director focus raises the fixed vcam's priority and drives a real
 * position-and-zoom blend in both directions, exercising selection, live-body
 * independence, frozen-source blending, centre-based zoom, and blend
 * interruption if toggled mid-transition.
 *
 * Pure/deterministic: no `Math.random`, no `Date.now`, no DOM. The visible
 * `camera-brain-demo.ts` section renders this; `tests/camera-brain-session.test.ts`
 * drives it without a canvas.
 */

import {
  createCameraBrain,
  updateCameraBrain,
  type CameraBrain,
  type CameraBounds,
  type CameraTarget,
  type CameraViewport,
  type VirtualCamera,
} from '../../src/camera';

/** Demo world size (world units). */
export const DEMO_BOUNDS: CameraBounds = { width: 1600, height: 900 };
/** Demo physical viewport (screen pixels). */
export const DEMO_VIEWPORT: CameraViewport = { width: 640, height: 360 };

/** Target movement speed (world units / second). */
const TARGET_SPEED = 240;
/** Target horizontal travel range (centres). */
const TARGET_MIN_X = 120;
const TARGET_MAX_X = 1480;
/** Fixed vertical centre for the moving target. */
const TARGET_CENTER_Y = 450;
/** Target rect size (square). */
const TARGET_SIZE = 32;

/** The fixed focus point the director-focus vcam frames. */
export const DIRECTOR_FOCUS = { x: 720, y: 300, zoom: 1.35 };

/**
 * The two demo vcams. The director-focus priority flips with `directorFocus`
 * so priority selection (not an override) drives the switch.
 */
export function cameraDemoVcams(directorFocus: boolean): readonly VirtualCamera[] {
  return [
    {
      id: 'player-follow',
      priority: 10,
      blend: 0.45,
      body: { mode: 'follow', targetKey: 'player' },
      lens: { zoom: 1 },
    },
    {
      id: 'director-focus',
      priority: directorFocus ? 20 : 0,
      blend: 0.6,
      body: { mode: 'fixed', x: DIRECTOR_FOCUS.x, y: DIRECTOR_FOCUS.y },
      lens: { zoom: DIRECTOR_FOCUS.zoom },
    },
  ];
}

/** A running DOM-free demo session. */
export interface CameraBrainSession {
  /** Current brain state (fresh object each step). */
  readonly brain: CameraBrain;
  /** Whether director focus is currently requested. */
  readonly directorFocus: boolean;
  /** Elapsed sim time (seconds). */
  readonly elapsed: number;
  /** The current moving target rect. */
  readonly player: CameraTarget;
  /** Advance the target + brain by one fixed step. */
  step(dt: number): void;
  /** Toggle director focus (changes the fixed vcam's priority next step). */
  setDirectorFocus(on: boolean): void;
  /** Reset to the initial state. */
  reset(): void;
}

/**
 * Deterministic moving-target centre as a pure function of elapsed time
 * (triangle wave across the travel range). Exported for tests.
 */
export function targetCentreAt(elapsed: number): { x: number; y: number } {
  const period = ((TARGET_MAX_X - TARGET_MIN_X) * 2) / TARGET_SPEED;
  const phase = ((elapsed % period) + period) % period / period; // 0..1, defensive to negatives
  const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2; // 0→1→0
  return { x: TARGET_MIN_X + (TARGET_MAX_X - TARGET_MIN_X) * tri, y: TARGET_CENTER_Y };
}

/** Create a fresh demo session (inactive brain at zoom 1). */
export function createCameraBrainSession(): CameraBrainSession {
  let brain: CameraBrain = createCameraBrain({ zoom: 1 });
  let directorFocus = false;
  let elapsed = 0;

  const playerRect = (): CameraTarget => {
    const c = targetCentreAt(elapsed);
    return { x: c.x - TARGET_SIZE / 2, y: c.y - TARGET_SIZE / 2, width: TARGET_SIZE, height: TARGET_SIZE };
  };

  return {
    get brain() {
      return brain;
    },
    get directorFocus() {
      return directorFocus;
    },
    get elapsed() {
      return elapsed;
    },
    get player() {
      return playerRect();
    },
    step(dt) {
      elapsed += dt;
      brain = updateCameraBrain(brain, {
        vcams: cameraDemoVcams(directorFocus),
        targets: { player: playerRect() },
        bounds: DEMO_BOUNDS,
        viewport: DEMO_VIEWPORT,
        dt,
      });
    },
    setDirectorFocus(on) {
      directorFocus = on;
    },
    reset() {
      brain = createCameraBrain({ zoom: 1 });
      elapsed = 0;
      directorFocus = false;
    },
  };
}
