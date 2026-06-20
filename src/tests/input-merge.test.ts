import { describe, it, expect } from 'vitest';
import { orEdges } from '../input/merge';
import type { PolledEdge } from '../input/types';

const ALL_FALSE: PolledEdge = { held: false, pressed: false, released: false };
const ALL_TRUE: PolledEdge = { held: true, pressed: true, released: true };

describe('orEdges — held', () => {
  it('is true when either source is held', () => {
    expect(orEdges(ALL_TRUE, ALL_FALSE).held).toBe(true);
    expect(orEdges(ALL_FALSE, ALL_TRUE).held).toBe(true);
  });

  it('is true when both sources are held', () => {
    expect(orEdges(ALL_TRUE, ALL_TRUE).held).toBe(true);
  });

  it('is false when neither source is held', () => {
    expect(orEdges(ALL_FALSE, ALL_FALSE).held).toBe(false);
  });
});

describe('orEdges — pressed edge', () => {
  it('fires if either source produced it', () => {
    expect(orEdges({ ...ALL_FALSE, pressed: true }, ALL_FALSE).pressed).toBe(true);
    expect(orEdges(ALL_FALSE, { ...ALL_FALSE, pressed: true }).pressed).toBe(true);
    expect(orEdges(ALL_FALSE, ALL_FALSE).pressed).toBe(false);
  });
});

describe('orEdges — released edge', () => {
  it('fires if either source produced it', () => {
    expect(orEdges({ ...ALL_FALSE, released: true }, ALL_FALSE).released).toBe(true);
    expect(orEdges(ALL_FALSE, { ...ALL_FALSE, released: true }).released).toBe(true);
    expect(orEdges(ALL_FALSE, ALL_FALSE).released).toBe(false);
  });
});

describe('orEdges — purity', () => {
  it('does not mutate either input', () => {
    const a: PolledEdge = { held: true, pressed: true, released: false };
    const b: PolledEdge = { held: false, pressed: false, released: true };
    const aSnap = { ...a };
    const bSnap = { ...b };
    orEdges(a, b);
    expect(a).toEqual(aSnap);
    expect(b).toEqual(bSnap);
  });

  it('returns a fresh object each call', () => {
    const out1 = orEdges(ALL_FALSE, ALL_FALSE);
    const out2 = orEdges(ALL_FALSE, ALL_FALSE);
    expect(out1).not.toBe(out2);
    expect(out1).toEqual(out2);
  });
});
