import { describe, expect, it } from 'vitest';
import {
  afterimagesFor,
  clearAfterimages,
  createAfterimageTrail,
  createFeelEffects,
  recordAfterimage,
} from '../feel-effects';
import type { PlatformerState } from 'aicraft-engine';

const DT = 1 / 60;

function dashingPlayer(): PlatformerState {
  return {
    abilities: { dash: { kind: 'dash', timer: 5 } },
    core: { x: 40, y: 40, width: 4, height: 12 },
  } as unknown as PlatformerState;
}

function idlePlayer(): PlatformerState {
  return { abilities: {}, core: { x: 0, y: 0, width: 4, height: 12 } } as unknown as PlatformerState;
}

describe('createFeelEffects — the burst kit', () => {
  it('dash trail spawns only while the dash timer runs', () => {
    const fx = createFeelEffects({ seed: 1 });
    expect(fx.dashTrail([], dashingPlayer())).toHaveLength(6);
    expect(fx.dashTrail([], idlePlayer())).toHaveLength(0);
  });

  it('every effect stays room-local under the shared air medium (px/tick contract)', () => {
    const fx = createFeelEffects({ seed: 2 });
    const cases: readonly [string, readonly Particle0[], { x: number; y: number }][] = [
      ['dust', fx.landingDust([], 100, 100, true), { x: 100, y: 100 }],
      ['sparkle', fx.pickupSparkle([], 50, 60), { x: 50, y: 60 }],
      ['death', fx.deathBurst([], 80, 80), { x: 80, y: 80 }],
      ['respawn', fx.respawnFlash([], 10, 10), { x: 10, y: 10 }],
      ['sweat', fx.sweat([], 30, 20), { x: 30, y: 20 }],
    ];
    for (const [name, born, origin] of cases) {
      let live = born;
      for (let i = 0; i < 60 && live.length > 0; i += 1) live = fx.step(live, DT);
      for (const p of live) {
        const distance = Math.hypot(p.x - origin.x, p.y - origin.y);
        expect(distance, `${name} wandered ${distance.toFixed(0)}px`).toBeLessThan(80);
      }
    }
  });

  it('the gem sparkle fires on the gem-id-staggered due tick only', () => {
    const fx = createFeelEffects({ seed: 3, gemSparklePeriodTicks: 40 });
    const dueTick = 40 + (7 % 40); // gemId 7's due tick in the second period
    expect(fx.gemSparkle([], 7, 0, 0, dueTick)).toHaveLength(1);
    expect(fx.gemSparkle([], 7, 0, 0, dueTick + 1)).toHaveLength(0);
    // Different gems come due on different ticks (no lockstep).
    const otherDue = 40 + (9 % 40);
    expect(fx.gemSparkle([], 9, 0, 0, otherDue)).toHaveLength(1);
  });

  it('draw emits one fillRect per live mote with a fading color and alpha', () => {
    const fx = createFeelEffects({ seed: 4 });
    const canvas = documentStub();
    fx.draw(canvas.ctx as unknown as CanvasRenderingContext2D, [
      { x: 10, y: 10, vx: 0, vy: 0, life: 10, maxLife: 20, size: 2, color: '#000000', colorEnd: '#ffffff' },
      { x: 20, y: 10, vx: 0, vy: 0, life: 0, maxLife: 20, size: 2 }, // dead — skipped
    ]);
    const rects = canvas.ctx.opsNamed('fillRect');
    expect(rects).toHaveLength(1);
    expect(canvas.ctx.ops.some((op) => op.op === 'set:globalAlpha')).toBe(true);
    expect(canvas.ctx.ops.some((op) => op.op === 'set:fillStyle' && String(op.args[0]).startsWith('#'))).toBe(true);
  });

  it('determinism: the same seed replays the same effects', () => {
    const a = createFeelEffects({ seed: 9 });
    const b = createFeelEffects({ seed: 9 });
    const pa = a.step(a.landingDust(a.pickupSparkle([], 1, 1), 2, 2, true), DT);
    const pb = b.step(b.landingDust(b.pickupSparkle([], 1, 1), 2, 2, true), DT);
    expect(pa).toEqual(pb);
  });
});

describe('the afterimage ring buffer', () => {
  it('records poses and surfaces only the in-age window, oldest first', () => {
    let trail = createAfterimageTrail(8);
    for (let t = 0; t < 12; t += 1) trail = recordAfterimage(trail, t * 4, 0, 1, t);
    const now = 11;
    // The ring holds ticks 4..11; the age window [2, 8] keeps ticks 4..9.
    const ghosts = afterimagesFor(trail, now, 2, 8);
    expect(ghosts.map((g) => g.tick)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  it('wraps at capacity without losing the window', () => {
    let trail = createAfterimageTrail(3);
    for (let t = 0; t < 10; t += 1) trail = recordAfterimage(trail, t, 0, -1, t);
    // The ring holds ticks 7..9; the age window [0, 3] keeps ticks 6..9.
    expect(afterimagesFor(trail, 9, 0, 3).map((g) => g.tick)).toEqual([7, 8, 9]);
  });

  it('clear drops every sample (no ghosts across a respawn)', () => {
    let trail = createAfterimageTrail(4);
    trail = recordAfterimage(trail, 1, 1, 1, 1);
    trail = clearAfterimages(trail);
    expect(afterimagesFor(trail, 5, 0, 10)).toEqual([]);
  });
});

// Local stubs (this test file must not import the harness recipe — that is a
// different recipe's concern).
type Particle0 = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color?: string };
function documentStub(): { ctx: Recording0 } {
  const ops: { op: string; args: unknown[] }[] = [];
  const ctx = {
    ops,
    opsNamed: (name: string) => ops.filter((o) => o.op === name),
    set globalAlpha(v: number) {
      ops.push({ op: 'set:globalAlpha', args: [v] });
    },
    get globalAlpha() {
      return 1;
    },
    set fillStyle(v: string) {
      ops.push({ op: 'set:fillStyle', args: [v] });
    },
    get fillStyle() {
      return '#000';
    },
    fillRect: (...args: unknown[]) => {
      ops.push({ op: 'fillRect', args });
    },
  };
  return { ctx };
}
interface Recording0 {
  readonly ops: readonly { op: string; args: readonly unknown[] }[];
  opsNamed(name: string): readonly { op: string; args: readonly unknown[] }[];
}
