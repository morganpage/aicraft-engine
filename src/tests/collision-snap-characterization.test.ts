/**
 * CHARACTERIZATION tests for the multi-overlap snap in resolveAxisX/Y.
 *
 * These pin TODAY's behavior — array-order-dependent iterative re-snap —
 * deliberately, including outcomes that are physically wrong (a body ejected
 * through a wall it never touched). They exist so that the upcoming semantic
 * change (nearest-wall / highest-floor min/max over the candidates the
 * ORIGINAL moved rect overlaps) lands as a visible, reviewable rewrite of
 * these assertions rather than an unverifiable vibe. Each case states what
 * the new semantics will say next to the current expectation.
 *
 * The order-dependence mechanism: after each snap the test rect is rebuilt
 * from the UPDATED position, so an intermediate snap can drag the body into
 * a solid the original move never overlapped — and snap again (a cascade).
 *
 * @module
 */

import { describe, expect, it } from 'vitest';
import { resolveAxisX, resolveAxisY } from '../collision/resolve';
import type { Solid } from '../collision/types';

const wall = (x: number, y: number, width: number, height: number): Solid =>
  ({ x, y, width, height });

const BODY = { x: 0, y: 0, width: 8, height: 8 };

describe('resolveAxisX — multi-overlap snap (characterization)', () => {
  it('a snap cascade can reach a wall the original move never overlapped', () => {
    // Moved rect 20..28. Wall F (24..28) overlaps it; wall M (12..18) does not.
    const F = wall(24, 0, 4, 8);
    const M = wall(12, 0, 6, 8);
    // [F, M]: F snaps to 16; the re-built rect 16..24 NOW overlaps M (12..18)
    // and snaps again to 4 — a wall the direct move never touched.
    const cascaded = resolveAxisX(BODY, 20, [F, M]);
    expect(cascaded).toEqual({ x: 4, vx: 0, hitWall: true });
    // [M, F]: M never matches; F snaps to 16 and stays.
    const direct = resolveAxisX(BODY, 20, [M, F]);
    expect(direct).toEqual({ x: 16, vx: 0, hitWall: true });
    // New semantics: min over the ORIGINAL moved rect's candidates {F} → 16
    // for BOTH orders — the cascade disappears.
  });

  it('a rightward nudge can eject the body LEFT through an adjacent wall', () => {
    // Body at x=10 nudges right (moved 12..20). wallR (18..26) blocks it;
    // wallL (4..12) sits flush at its back and is never overlapped by the move.
    const wallR = wall(18, 0, 8, 8);
    const wallL = wall(4, 0, 8, 8);
    // [wallR, wallL]: snap to 10 re-builds the rect 10..18, which overlaps
    // wallL (4..12) — and the dir-based snap shunts the body to wallL's LEFT
    // face (-4), teleporting it backwards through a wall it was moving away from.
    const ejected = resolveAxisX({ ...BODY, x: 10 }, 2, [wallR, wallL]);
    expect(ejected).toEqual({ x: -4, vx: 0, hitWall: true });
    // [wallL, wallR]: wallL is checked against the ORIGINAL move (no overlap),
    // never re-checked — the body simply stops at wallR's face.
    const stopped = resolveAxisX({ ...BODY, x: 10 }, 2, [wallL, wallR]);
    expect(stopped).toEqual({ x: 10, vx: 0, hitWall: true });
    // New semantics: wallL is not a candidate of the original move → 10 for
    // BOTH orders; the ejection is unrepresentable.
  });

  it('walls both overlapped by the original move converge on the nearest — in any order', () => {
    // Moved rect 18..26 overlaps near (16..20) and far (22..26). Whichever is
    // processed first, the body ends flush against NEAR's left face.
    const near = wall(16, 0, 4, 8);
    const far = wall(22, 0, 4, 8);
    expect(resolveAxisX(BODY, 18, [near, far])).toEqual({ x: 8, vx: 0, hitWall: true });
    expect(resolveAxisX(BODY, 18, [far, near])).toEqual({ x: 8, vx: 0, hitWall: true });
    // New semantics: min(candidate.x) = 16 → 8 for both orders — unchanged.
  });
});

describe('resolveAxisY — multi-overlap snap (characterization)', () => {
  it('a landing cascade can reach a platform the original fall never overlapped', () => {
    // Moved rect 20..28 (falling). Floor F (24..28) overlaps it; platform M
    // (12..18) does not.
    const F = wall(0, 24, 8, 4);
    const M = wall(0, 12, 8, 6);
    // [F, M]: F snaps to 16; the re-built rect 16..24 overlaps M (12..18) and
    // snaps again to 4 — falling UP through a platform it never reached.
    const cascaded = resolveAxisY(BODY, 20, [F, M], 8);
    expect(cascaded).toEqual({ y: 4, vy: 0, landed: true, hitCeiling: false });
    // [M, F]: M never matches; F snaps to 16 and stays.
    const direct = resolveAxisY(BODY, 20, [M, F], 8);
    expect(direct).toEqual({ y: 16, vy: 0, landed: true, hitCeiling: false });
    // New semantics: min(candidate.y) over the ORIGINAL move = 24 → 16 for
    // BOTH orders.
  });

  it('a rising cascade can punch the body through a ceiling it never reached', () => {
    // Body at y=30 rises (moved 10..18). Ceiling Fc (13..17) overlaps it; the
    // lower Mc (21..27) does not.
    const Fc = wall(0, 13, 8, 4);
    const Mc = wall(0, 21, 8, 6);
    // [Fc, Mc]: Fc snaps to 17; the re-built rect 17..25 overlaps Mc (21..27)
    // and snaps again to 27 — teleporting the body BELOW a ceiling it already
    // cleared upward.
    const cascaded = resolveAxisY({ ...BODY, y: 30 }, -20, [Fc, Mc], 38);
    expect(cascaded).toEqual({ y: 27, vy: 0, landed: false, hitCeiling: true });
    // [Mc, Fc]: Mc never matches; Fc snaps to 17 and stays.
    const direct = resolveAxisY({ ...BODY, y: 30 }, -20, [Mc, Fc], 38);
    expect(direct).toEqual({ y: 17, vy: 0, landed: false, hitCeiling: true });
    // New semantics: max(candidate.y + height) over the ORIGINAL move → 17
    // for BOTH orders.
  });
});
