import { describe, it, expect } from 'vitest';
import {
  createEdgeAccumulator,
  pressEdge,
  releaseEdge,
  resetEdge,
  pollEdge,
} from '../input/edges';

describe('createEdgeAccumulator', () => {
  it('starts in the fully idle state', () => {
    expect(createEdgeAccumulator()).toEqual({
      held: false,
      pressedSincePoll: false,
      releasedSincePoll: false,
    });
  });
});

describe('pressEdge', () => {
  it('sets held true and latches the pressed edge', () => {
    const acc = createEdgeAccumulator();
    pressEdge(acc);
    expect(acc).toEqual({ held: true, pressedSincePoll: true, releasedSincePoll: false });
  });

  it('coalesces multiple presses before a poll into a single edge', () => {
    const acc = createEdgeAccumulator();
    pressEdge(acc);
    pressEdge(acc);
    pressEdge(acc);
    expect(acc.held).toBe(true);
    expect(acc.pressedSincePoll).toBe(true);
    expect(pollEdge(acc).pressed).toBe(true);
  });
});

describe('releaseEdge', () => {
  it('clears held and latches the released edge', () => {
    const acc = createEdgeAccumulator();
    pressEdge(acc);
    releaseEdge(acc);
    expect(acc).toEqual({ held: false, pressedSincePoll: true, releasedSincePoll: true });
  });

  it('coalesces multiple releases before a poll into a single edge', () => {
    const acc = createEdgeAccumulator();
    releaseEdge(acc);
    releaseEdge(acc);
    expect(acc.held).toBe(false);
    expect(acc.releasedSincePoll).toBe(true);
  });
});

describe('pollEdge', () => {
  it('reads held + latched edges, then clears the edge latches', () => {
    const acc = createEdgeAccumulator();
    pressEdge(acc);
    const first = pollEdge(acc);
    expect(first).toEqual({ held: true, pressed: true, released: false });
    expect(acc).toEqual({ held: true, pressedSincePoll: false, releasedSincePoll: false });
  });

  it('does not re-fire edges on a second poll (one-tick edges)', () => {
    const acc = createEdgeAccumulator();
    pressEdge(acc);
    pollEdge(acc);
    const second = pollEdge(acc);
    expect(second).toEqual({ held: true, pressed: false, released: false });
  });

  it('surfaces BOTH press and release for a full tap between two polls', () => {
    const acc = createEdgeAccumulator();
    pressEdge(acc);
    releaseEdge(acc);
    expect(pollEdge(acc)).toEqual({ held: false, pressed: true, released: true });
  });
});

describe('resetEdge', () => {
  it('returns the accumulator to the fully idle state', () => {
    const acc = createEdgeAccumulator();
    pressEdge(acc);
    resetEdge(acc);
    expect(acc).toEqual({ held: false, pressedSincePoll: false, releasedSincePoll: false });
  });

  it('clears a pending release edge too', () => {
    const acc = createEdgeAccumulator();
    releaseEdge(acc);
    resetEdge(acc);
    expect(acc.releasedSincePoll).toBe(false);
  });
});

describe('determinism', () => {
  it('reproduces identical snapshots for identical event sequences', () => {
    function run() {
      const acc = createEdgeAccumulator();
      pressEdge(acc);
      const a = pollEdge(acc);
      releaseEdge(acc);
      const b = pollEdge(acc);
      pressEdge(acc);
      releaseEdge(acc);
      const c = pollEdge(acc);
      return { a, b, c };
    }
    expect(run()).toEqual(run());
  });
});
