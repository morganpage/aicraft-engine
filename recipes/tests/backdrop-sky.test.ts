import { describe, expect, it } from 'vitest';
import { BACKDROP_PALETTE, createBackdrop, type BackdropWind } from '../backdrop-sky';

const VIEW = { width: 640, height: 360 };
const CAM = { x: 100, y: 40, zoom: 3 };
const CALM: BackdropWind = { driftX: 0, swayGain: 1 };

/** Records every drawing op so two frames can be compared exactly. */
function recordingCtx() {
  const ops: string[] = [];
  const gradient = { addColorStop: () => {} };
  const ctx = {
    save: () => ops.push('save'),
    restore: () => ops.push('restore'),
    beginPath: () => ops.push('beginPath'),
    closePath: () => ops.push('closePath'),
    fill: () => ops.push('fill'),
    stroke: () => ops.push('stroke'),
    arc: (...a: number[]) => ops.push(`arc(${a.map((n) => n.toFixed(3)).join(',')})`),
    moveTo: (x: number, y: number) => ops.push(`moveTo(${x.toFixed(3)},${y.toFixed(3)})`),
    lineTo: (x: number, y: number) => ops.push(`lineTo(${x.toFixed(3)},${y.toFixed(3)})`),
    fillRect: (...a: number[]) => ops.push(`fillRect(${a.join(',')})`),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    set fillStyle(v: unknown) { ops.push(`fillStyle=${String(v)}`); },
    set strokeStyle(v: unknown) { ops.push(`strokeStyle=${String(v)}`); },
    set globalAlpha(v: number) { ops.push(`alpha=${v.toFixed(4)}`); },
    set lineWidth(v: number) { ops.push(`lineWidth=${v}`); },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, ops };
}

/** The flake pass is the only fillRect work — terrain is paths. */
const flakeOps = (ops: readonly string[]): string[] => ops.filter((o) => o.startsWith('fillRect('));
const terrainOps = (ops: readonly string[]): string[] => ops.filter((o) => o.startsWith('lineTo(') || o.startsWith('moveTo('));

describe('createBackdrop', () => {
  it('is deterministic — the same seed draws the same frame', () => {
    const a = recordingCtx();
    const b = recordingCtx();
    createBackdrop(0xce1e5).draw(a.ctx, VIEW, CAM, 3, CALM);
    createBackdrop(0xce1e5).draw(b.ctx, VIEW, CAM, 3, CALM);
    expect(a.ops).toEqual(b.ops);
  });

  it('different seeds draw different terrain', () => {
    const a = recordingCtx();
    const b = recordingCtx();
    createBackdrop(1).draw(a.ctx, VIEW, CAM, 0, CALM);
    createBackdrop(2).draw(b.ctx, VIEW, CAM, 0, CALM);
    expect(terrainOps(a.ops)).not.toEqual(terrainOps(b.ops));
  });

  it('renders still air when no wind is passed at all', () => {
    const { ctx } = recordingCtx();
    expect(() => createBackdrop().draw(ctx, VIEW, CAM, 1.5)).not.toThrow();
  });
});

describe('only the air moves (rule 4)', () => {
  it('advancing TIME moves the flakes and leaves the terrain untouched', () => {
    const sky = createBackdrop(0xce1e5);
    const t0 = recordingCtx();
    const t1 = recordingCtx();
    sky.draw(t0.ctx, VIEW, CAM, 0, CALM);
    sky.draw(t1.ctx, VIEW, CAM, 4, CALM);

    // Terrain that slides while the player stands still reads as broken.
    expect(terrainOps(t1.ops)).toEqual(terrainOps(t0.ops));
    expect(flakeOps(t1.ops)).not.toEqual(flakeOps(t0.ops));
  });

  it('moving the CAMERA moves the terrain — parallax is camera-driven', () => {
    const sky = createBackdrop(0xce1e5);
    const near = recordingCtx();
    const far = recordingCtx();
    sky.draw(near.ctx, VIEW, { ...CAM, x: 0 }, 0, CALM);
    sky.draw(far.ctx, VIEW, { ...CAM, x: 900 }, 0, CALM);
    expect(terrainOps(far.ops)).not.toEqual(terrainOps(near.ops));
  });
});

describe('wind coupling', () => {
  it('drift moves the flakes without touching the terrain', () => {
    const sky = createBackdrop(0xce1e5);
    const calm = recordingCtx();
    const gust = recordingCtx();
    sky.draw(calm.ctx, VIEW, CAM, 2, CALM);
    sky.draw(gust.ctx, VIEW, CAM, 2, { driftX: -0.4, swayGain: 3 });
    expect(flakeOps(gust.ops)).not.toEqual(flakeOps(calm.ops));
    expect(terrainOps(gust.ops)).toEqual(terrainOps(calm.ops));
  });
});

describe('everything scales from the viewport (rule 1)', () => {
  it('a portrait window composes rather than collapsing to slivers', () => {
    const wide = recordingCtx();
    const tall = recordingCtx();
    const sky = createBackdrop(0xce1e5);
    sky.draw(wide.ctx, { width: 900, height: 300 }, CAM, 0, CALM);
    sky.draw(tall.ctx, { width: 300, height: 900 }, CAM, 0, CALM);

    const spread = (ops: readonly string[]): number => {
      const ys = ops.flatMap((o) => {
        const m = /^(?:move|line)To\([-\d.]+,([-\d.]+)\)$/.exec(o);
        return m ? [Number(m[1])] : [];
      });
      return Math.max(...ys) - Math.min(...ys);
    };
    const wideFraction = spread(wide.ops) / 300;
    const tallFraction = spread(tall.ops) / 900;

    // Rule 1 claims the composition HOLDS at any aspect, not that it is
    // pixel-identical: a narrow window samples less horizontal range and so
    // crosses fewer peaks. What must not happen is the collapse to slivers at
    // the horizon that absolute pixel sizing produced. Both bands stay a
    // substantial fraction of height, and within a factor of two of each other.
    expect(wideFraction).toBeGreaterThan(0.4);
    expect(tallFraction).toBeGreaterThan(0.4);
    expect(tallFraction / wideFraction).toBeGreaterThan(0.5);
    expect(tallFraction / wideFraction).toBeLessThan(2);
  });
});

describe('BACKDROP_PALETTE', () => {
  it('ships five ridge values, far to near', () => {
    expect(BACKDROP_PALETTE.ridges).toHaveLength(5);
  });
});
