/**
 * Camera brain showcase — a visible proof of the light Cinemachine system.
 *
 * Renders the DOM-free `camera-brain-session.ts` on a procedural Canvas2D
 * stage: a moving follow target and a fixed director focus, with a visible
 * **Director focus** control that raises the fixed vcam's priority and drives a
 * real position-and-zoom blend in both directions. The canvas transform is
 * exactly the documented consumer contract:
 *
 *   ctx.scale(brain.zoom, brain.zoom);
 *   ctx.translate(-round(brain.camera.x), -round(brain.camera.y));
 *
 * Loop/sim pattern mirrors `sections/sprite-demo.ts`; reduced-motion handling
 * mirrors `helpers/motion-gate.ts`.
 */

import { createGameLoop, type GameLoop } from '../../src/game-loop';
import { resizeCanvasToBackingStore } from '../../src/primitives';
import { shouldAnimate } from '../helpers/motion-gate';
import type { Store } from '../store';
import type { GlobalState } from '../main';
import {
  createCameraBrainSession,
  DEMO_BOUNDS,
  DEMO_VIEWPORT,
  DIRECTOR_FOCUS,
  type CameraBrainSession,
} from './camera-brain-session';

const VIEW_W = DEMO_VIEWPORT.width;
const VIEW_H = DEMO_VIEWPORT.height;

// Palette (matches the rest of the showcase via CSS variables where possible).
const COLOR_BG = '#0b0d12';
const COLOR_GRID = '#1b2230';
const COLOR_BOUNDS = '#3a4258';
const COLOR_TARGET = '#ffd166';
const COLOR_TARGET_OUTLINE = '#1d1300';
const COLOR_FOCUS = '#9ad0ff';
const COLOR_DEADZONE = 'rgba(154, 208, 255, 0.10)';
const COLOR_DEADZONE_EDGE = 'rgba(154, 208, 255, 0.35)';

// Default follow band (must match the session's player-follow vcam).
const BAND_X = { trail: 0.25, lead: 0.5 };
const BAND_Y = { trail: 0.35, lead: 0.65 };

export function initCameraBrainDemo(root: HTMLElement, _store: Store<GlobalState>): void {
  const canvas = root.querySelector<HTMLCanvasElement>('canvas.camera-brain');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const focusBtn = root.querySelector<HTMLButtonElement>('button.camera-brain-focus');
  const resetBtn = root.querySelector<HTMLButtonElement>('button.camera-brain-reset');
  const statusEl = root.querySelector<HTMLElement>('.camera-brain-status');

  const session: CameraBrainSession = createCameraBrainSession();
  const reduced = shouldAnimate(); // true when the user prefers reduced motion

  const render = (): void => {
    resizeCanvasToBackingStore(canvas, VIEW_W, VIEW_H);
    const { brain, player } = session;

    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // --- world-space layer ------------------------------------------------
    ctx.save();
    ctx.scale(brain.zoom, brain.zoom);
    ctx.translate(-Math.round(brain.camera.x), -Math.round(brain.camera.y));

    // Grid so translation + zoom anchoring are visually obvious.
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1 / brain.zoom;
    ctx.beginPath();
    for (let x = 0; x <= DEMO_BOUNDS.width; x += 80) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, DEMO_BOUNDS.height);
    }
    for (let y = 0; y <= DEMO_BOUNDS.height; y += 80) {
      ctx.moveTo(0, y);
      ctx.lineTo(DEMO_BOUNDS.width, y);
    }
    ctx.stroke();

    // World bounds outline.
    ctx.strokeStyle = COLOR_BOUNDS;
    ctx.lineWidth = 2 / brain.zoom;
    ctx.strokeRect(0, 0, DEMO_BOUNDS.width, DEMO_BOUNDS.height);

    // Fixed director-focus marker (a crosshair + rect).
    ctx.strokeStyle = COLOR_FOCUS;
    ctx.lineWidth = 2 / brain.zoom;
    ctx.strokeRect(DIRECTOR_FOCUS.x, DIRECTOR_FOCUS.y, VIEW_W, VIEW_H);
    ctx.beginPath();
    ctx.moveTo(DIRECTOR_FOCUS.x - 12, DIRECTOR_FOCUS.y);
    ctx.lineTo(DIRECTOR_FOCUS.x + 12, DIRECTOR_FOCUS.y);
    ctx.moveTo(DIRECTOR_FOCUS.x, DIRECTOR_FOCUS.y - 12);
    ctx.lineTo(DIRECTOR_FOCUS.x, DIRECTOR_FOCUS.y + 12);
    ctx.stroke();

    // Moving follow target.
    ctx.fillStyle = COLOR_TARGET;
    ctx.fillRect(player.x, player.y, player.width, player.height);
    ctx.strokeStyle = COLOR_TARGET_OUTLINE;
    ctx.lineWidth = 1.5 / brain.zoom;
    ctx.strokeRect(player.x, player.y, player.width, player.height);

    ctx.restore();

    // --- screen-space overlay: deadzone band (only while following) -------
    if (brain.activeId === 'player-follow') {
      const dx = BAND_X.trail * VIEW_W;
      const dw = (BAND_X.lead - BAND_X.trail) * VIEW_W;
      const dy = BAND_Y.trail * VIEW_H;
      const dh = (BAND_Y.lead - BAND_Y.trail) * VIEW_H;
      ctx.fillStyle = COLOR_DEADZONE;
      ctx.fillRect(dx, dy, dw, dh);
      ctx.strokeStyle = COLOR_DEADZONE_EDGE;
      ctx.lineWidth = 1;
      ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
    }

    // --- status line ------------------------------------------------------
    if (statusEl) {
      const b = brain.blend;
      const blendPart = b
        ? `blend ${Math.round((b.elapsed / b.duration) * 100)}% (${b.fromId} → ${b.toId})`
        : 'blend —';
      statusEl.textContent =
        `active ${brain.activeId ?? '—'} · ` +
        `rendered (${brain.camera.x.toFixed(1)}, ${brain.camera.y.toFixed(1)}) z${brain.zoom.toFixed(2)} · ` +
        `live (${brain.bodyCamera.x.toFixed(1)}, ${brain.bodyCamera.y.toFixed(1)}) z${brain.lensZoom.toFixed(2)} · ` +
        blendPart;
    }
  };

  const syncFocusButton = (): void => {
    if (focusBtn) {
      focusBtn.setAttribute('aria-pressed', String(session.directorFocus));
      focusBtn.textContent = session.directorFocus ? 'Director focus: on' : 'Director focus: off';
    }
  };

  const applyFocus = (on: boolean): void => {
    session.setDirectorFocus(on);
    syncFocusButton();
    if (reduced) {
      // No autonomous loop: step to a settled state so the toggle still reads.
      for (let i = 0; i < 240; i++) session.step(1 / 60);
    }
    render();
  };

  focusBtn?.addEventListener('click', () => applyFocus(!session.directorFocus));
  resetBtn?.addEventListener('click', () => {
    session.reset();
    syncFocusButton();
    render();
  });

  // Initial paint + control state.
  syncFocusButton();
  render();

  if (reduced) return; // static frame; the focus control still works via applyFocus.

  // Fixed-step loop: step the session, then render. Pauses when the canvas
  // scrolls out of view (don't burn CPU on an offscreen animation).
  const loop: GameLoop = createGameLoop({
    fixedDt: 1 / 60,
    maxFrameDelta: 1 / 6,
    step: (dt) => session.step(dt),
    render,
  });

  if (typeof IntersectionObserver !== 'undefined') {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.isIntersecting ? loop.start() : loop.stop());
      },
      { threshold: 0 },
    );
    io.observe(canvas);
  } else {
    loop.start();
  }
}
