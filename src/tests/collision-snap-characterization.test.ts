/**
 * Multi-overlap snap semantics for resolveAxisX/Y (physics v14).
 *
 * These were originally Phase-0 CHARACTERIZATION tests pinning the old
 * iterative re-snap — which rebuilt its test rect from the updated position
 * after every snap, making the result array-order-dependent and letting an
 * intermediate snap cascade the body through solids the original move never
 * overlapped. The v14 change replaced the iteration with min/max directly
 * over the candidates the ORIGINAL moved rect overlaps; rewriting these
 * assertions IS the reviewable semantics diff (see the two commits).
 *
 * @module
 */

import { describe, expect, it } from 'vitest';
import { resolveAxisX, resolveAxisY } from '../collision/resolve';
import type { Solid } from '../collision/types';

const wall = (x: number, y: number, width: number, height: number): Solid =>
  ({ x, y, width, height });

const BODY = { x: 0, y: 0, width: 8, height: 8 };

describe('resolveAxisX — multi-overlap snap (v14: nearest wall, order-independent)', () => {
  it('a wall the original move never overlapped can never be reached — in any order', () => {
    // Moved rect 20..28. F (24..28) overlaps it; M (12..18) does not. The old
    // [F, M] order cascaded through M to x=4; v14 has no re-snap to cascade.
    const F = wall(24, 0, 4, 8);
    const M = wall(12, 0, 6, 8);
    expect(resolveAxisX(BODY, 20, [F, M])).toEqual({ x: 16, vx: 0, hitWall: true });
    expect(resolveAxisX(BODY, 20, [M, F])).toEqual({ x: 16, vx: 0, hitWall: true });
  });

  it('a rightward nudge never ejects the body through a wall behind it', () => {
    // Body at x=10 nudges right (moved 12..20); wallR (18..26) blocks it;
    // wallL (4..12) sits at its back, untouched by the move. The old
    // [wallR, wallL] order re-snapped off the updated rect and shunted the
    // body to wallL's LEFT face (-4); v14 only considers the original move.
    const wallR = wall(18, 0, 8, 8);
    const wallL = wall(4, 0, 8, 8);
    expect(resolveAxisX({ ...BODY, x: 10 }, 2, [wallR, wallL])).toEqual({ x: 10, vx: 0, hitWall: true });
    expect(resolveAxisX({ ...BODY, x: 10 }, 2, [wallL, wallR])).toEqual({ x: 10, vx: 0, hitWall: true });
  });

  it('walls both overlapped by the original move converge on the nearest — in any order', () => {
    // Moved rect 18..26 overlaps near (16..20) and far (22..26): the body
    // ends flush against NEAR's left face. (This case was correct under the
    // old iteration too — v14 preserves it.)
    const near = wall(16, 0, 4, 8);
    const far = wall(22, 0, 4, 8);
    expect(resolveAxisX(BODY, 18, [near, far])).toEqual({ x: 8, vx: 0, hitWall: true });
    expect(resolveAxisX(BODY, 18, [far, near])).toEqual({ x: 8, vx: 0, hitWall: true });
  });
});

describe('resolveAxisY — multi-overlap snap (v14: highest floor / lowest ceiling)', () => {
  it('a platform the original fall never overlapped can never be reached — in any order', () => {
    // Moved rect 20..28 (falling). F (24..28) overlaps it; M (12..18) does
    // not. The old [F, M] order cascaded UP through M to y=4.
    const F = wall(0, 24, 8, 4);
    const M = wall(0, 12, 8, 6);
    expect(resolveAxisY(BODY, 20, [F, M], 8)).toEqual({ y: 16, vy: 0, landed: true, hitCeiling: false });
    expect(resolveAxisY(BODY, 20, [M, F], 8)).toEqual({ y: 16, vy: 0, landed: true, hitCeiling: false });
  });

  it('a rising body never punches back below a ceiling it already cleared', () => {
    // Body at y=30 rises (moved 10..18). Fc (13..17) overlaps it; the lower
    // Mc (21..27) does not. The old [Fc, Mc] order re-snapped off the updated
    // rect and pushed the body to Mc's bottom face (27).
    const Fc = wall(0, 13, 8, 4);
    const Mc = wall(0, 21, 8, 6);
    expect(resolveAxisY({ ...BODY, y: 30 }, -20, [Fc, Mc], 38))
      .toEqual({ y: 17, vy: 0, landed: false, hitCeiling: true });
    expect(resolveAxisY({ ...BODY, y: 30 }, -20, [Mc, Fc], 38))
      .toEqual({ y: 17, vy: 0, landed: false, hitCeiling: true });
  });
});
