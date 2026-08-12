/**
 * Integration tests for the camera-brain demo session.
 *
 * Drives the real DOM-free session (`createCameraBrainSession`) through the
 * priority-driven switch and bidirectional position/zoom blend that the visible
 * section renders. The session NEVER supplies `activeId`, so an implementation
 * that bypasses priority selection fails these tests. No canvas required.
 */

import { describe, expect, it } from 'vitest';
import {
  createCameraBrainSession,
  DEMO_VIEWPORT,
} from '../sections/camera-brain-session';

const DT = 1 / 60;

/** World-space centre of a rendered view (top-left + zoom + viewport). */
function renderedCentre(brain: { camera: { x: number; y: number }; zoom: number }): { x: number; y: number } {
  return {
    x: brain.camera.x + DEMO_VIEWPORT.width / brain.zoom / 2,
    y: brain.camera.y + DEMO_VIEWPORT.height / brain.zoom / 2,
  };
}

/** Step the session `n` times at the fixed dt. */
function stepN(session: ReturnType<typeof createCameraBrainSession>, n: number): void {
  for (let i = 0; i < n; i++) session.step(DT);
}

describe('camera-brain demo session — priority selection', () => {
  it('first step selects player-follow with no blend', () => {
    const session = createCameraBrainSession();
    session.step(DT);
    expect(session.brain.activeId).toBe('player-follow');
    expect(session.brain.blend).toBeNull();
  });

  it('raising director focus selects director-focus by priority', () => {
    const session = createCameraBrainSession();
    stepN(session, 10); // settle on player-follow
    session.setDirectorFocus(true);
    session.step(DT);
    expect(session.brain.activeId).toBe('director-focus');
    expect(session.brain.blend).not.toBeNull();
  });

  it('the blend is real: mid-flight the rendered view differs from both frozen source and live destination', () => {
    const session = createCameraBrainSession();
    stepN(session, 30); // settle player-follow
    session.setDirectorFocus(true);
    session.step(DT); // start the blend
    // Step a few frames in (not yet complete).
    stepN(session, 4);

    const brain = session.brain;
    expect(brain.blend).not.toBeNull();
    const t = brain.blend!.elapsed / brain.blend!.duration;
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);

    // Frozen source top-left, derived from the captured centre/zoom.
    const fromVisibleW = DEMO_VIEWPORT.width / brain.blend!.fromZoom;
    const fromVisibleH = DEMO_VIEWPORT.height / brain.blend!.fromZoom;
    const fromTopLeft = {
      x: brain.blend!.fromCenter.x - fromVisibleW / 2,
      y: brain.blend!.fromCenter.y - fromVisibleH / 2,
    };
    // Live destination.
    const live = { x: brain.bodyCamera.x, y: brain.bodyCamera.y, zoom: brain.lensZoom };

    // The rendered view is the interpolated composite, so it is NOT equal to
    // either the frozen source or the live destination while 0 < t < 1.
    const rendered = { x: brain.camera.x, y: brain.camera.y, zoom: brain.zoom };
    expect(rendered.x).not.toBeCloseTo(fromTopLeft.x, 3);
    expect(rendered.x).not.toBeCloseTo(live.x, 3);
    expect(rendered.zoom).not.toBeCloseTo(brain.blend!.fromZoom, 3);
    expect(rendered.zoom).not.toBeCloseTo(live.zoom, 3);
  });

  it('repeated fixed steps complete exactly at the live destination', () => {
    const session = createCameraBrainSession();
    stepN(session, 30);
    session.setDirectorFocus(true);
    // Step until the blend completes (bounded).
    let guard = 0;
    do {
      session.step(DT);
      guard++;
    } while (session.brain.blend !== null && guard < 600);
    expect(session.brain.blend).toBeNull();
    expect(session.brain.camera.x).toBeCloseTo(session.brain.bodyCamera.x, 6);
    expect(session.brain.camera.y).toBeCloseTo(session.brain.bodyCamera.y, 6);
    expect(session.brain.zoom).toBeCloseTo(session.brain.lensZoom, 6);
  });

  it('lowering focus selects player-follow and produces a second real blend', () => {
    const session = createCameraBrainSession();
    stepN(session, 30);
    session.setDirectorFocus(true);
    // Complete the focus blend.
    let guard = 0;
    do {
      session.step(DT);
      guard++;
    } while (session.brain.blend !== null && guard < 600);
    expect(session.brain.activeId).toBe('director-focus');

    session.setDirectorFocus(false);
    session.step(DT);
    expect(session.brain.activeId).toBe('player-follow');
    expect(session.brain.blend).not.toBeNull(); // second blend underway
  });

  it('toggling focus mid-blend captures the current rendered centre (no discontinuity)', () => {
    const session = createCameraBrainSession();
    stepN(session, 30);
    session.setDirectorFocus(true);
    stepN(session, 4); // part-way into the focus blend
    const interruptedCentre = renderedCentre(session.brain);
    const interruptedZoom = session.brain.zoom;

    // Interrupt: drop focus back to player-follow mid-blend.
    session.setDirectorFocus(false);
    session.step(DT);

    // The new blend's frozen source must equal the rendered view at the
    // interruption instant — visual continuity, not a jump back to the
    // original source.
    expect(session.brain.blend).not.toBeNull();
    expect(session.brain.blend!.fromCenter.x).toBeCloseTo(interruptedCentre.x, 5);
    expect(session.brain.blend!.fromCenter.y).toBeCloseTo(interruptedCentre.y, 5);
    expect(session.brain.blend!.fromZoom).toBeCloseTo(interruptedZoom, 5);
  });
});
