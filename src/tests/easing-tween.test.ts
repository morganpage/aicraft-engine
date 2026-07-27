import { describe, it, expect } from 'vitest';
import { createTweenState, advanceTween } from '../easing/tween';
import type { TweenConfig } from '../easing/tween';
import { linear, easeOutCubic, easeOutBack } from '../easing/curves';

/**
 * Tween-driver tests. The driver is a pure progression op mirroring
 * `advanceEmission(state, dt, config) -> { next, spawnCount }`: same inputs
 * always produce byte-identical outputs, the input state is never mutated, and
 * the public API never throws.
 *
 * Loop convention (binding — see decision doc resolved Q1/Q4):
 *   `loops: N` plays the tween N+1 times total (1 initial pass + N repeats).
 *   `loops: 0` = single play. `loops: -1` = infinite. With `yoyo: true`, each
 *   iteration is a forward + backward leg pair; `done` fires only after the
 *   final backward leg, never at a forward-leg boundary.
 */

/** Build a config with sensible defaults overridden piecemeal. */
function cfg(overrides: Partial<TweenConfig> = {}): TweenConfig {
  return { duration: 1, ease: linear, ...overrides };
}

describe('basic completion', () => {
  it('duration:1 advanced by dt:0.25 four times: done:false x3 then done:true with value:1', () => {
    const config = cfg({ duration: 1, ease: linear });
    let st = createTweenState();

    const r1 = advanceTween(st, 0.25, config);
    st = r1.state;
    expect(r1.done).toBe(false);
    expect(r1.value).toBe(0.25);

    const r2 = advanceTween(st, 0.25, config);
    st = r2.state;
    expect(r2.done).toBe(false);
    expect(r2.value).toBe(0.5);

    const r3 = advanceTween(st, 0.25, config);
    st = r3.state;
    expect(r3.done).toBe(false);

    const r4 = advanceTween(st, 0.25, config);
    expect(r4.done).toBe(true);
    expect(r4.value).toBe(1);
  });

  it('value at completion is exactly the endpoint (1 for forward, any ease)', () => {
    const config = cfg({ duration: 1, ease: easeOutCubic });
    let st = createTweenState();
    let res = advanceTween(st, 0, config);
    for (let i = 0; i < 4; i++) {
      res = advanceTween(st, 0.25, config);
      st = res.state;
    }
    expect(res.done).toBe(true);
    expect(res.value).toBe(1);
  });

  it('overshooting the final step still lands exactly on the endpoint', () => {
    const config = cfg({ duration: 1 });
    const res = advanceTween(createTweenState(), 5, config);
    expect(res.done).toBe(true);
    expect(res.value).toBe(1);
  });
});

describe('duration <= 0 edge case', () => {
  it('duration:0 snaps to { value: 1, done: true } on first advance', () => {
    const config = cfg({ duration: 0 });
    const r = advanceTween(createTweenState(), 0.1, config);
    expect(r.done).toBe(true);
    expect(r.value).toBe(1);
  });

  it('negative duration also snaps to done', () => {
    const config = cfg({ duration: -5 });
    const r = advanceTween(createTweenState(), 0.1, config);
    expect(r.done).toBe(true);
    expect(r.value).toBe(1);
  });

  it('never returns NaN/Infinity', () => {
    const config = cfg({ duration: 0 });
    const r = advanceTween(createTweenState(), 0.1, config);
    expect(Number.isFinite(r.value)).toBe(true);
    expect(Number.isFinite(r.state.elapsed)).toBe(true);
    expect(Number.isFinite(r.state.loopCount)).toBe(true);
  });

  it('never throws (even with NaN inputs)', () => {
    const config = cfg({ duration: 0 });
    expect(() => advanceTween(createTweenState(), NaN, config)).not.toThrow();
  });
});

describe('negative / non-finite dt', () => {
  it('negative dt is clamped to 0 — value frozen at start, no throw', () => {
    const config = cfg({ duration: 1 });
    const st = createTweenState();
    const before = JSON.parse(JSON.stringify(st));
    const r = advanceTween(st, -0.5, config);
    expect(r.done).toBe(false);
    expect(r.value).toBe(0);
    expect(r.state).toEqual(before);
  });

  it('NaN dt is treated as 0 (no throw, finite output)', () => {
    const config = cfg({ duration: 1 });
    const r = advanceTween(createTweenState(), NaN, config);
    expect(r.done).toBe(false);
    expect(Number.isFinite(r.value)).toBe(true);
  });

  it('Infinity dt is rejected (clamped) rather than looping forever', () => {
    const config = cfg({ duration: 1 });
    const r = advanceTween(createTweenState(), Infinity, config);
    expect(Number.isFinite(r.value)).toBe(true);
  });
});

describe('yoyo', () => {
  it('loops:1, yoyo:true — direction flips 1 -> -1 at the forward leg; done only after the final backward leg', () => {
    const config = cfg({ duration: 1, ease: linear, yoyo: true, loops: 1 });
    let st = createTweenState({ loops: 1 });

    // Forward leg (1.0s). done must NOT fire at this boundary.
    for (let i = 0; i < 4; i++) {
      const r = advanceTween(st, 0.25, config);
      st = r.state;
      expect(r.done).toBe(false);
    }
    // After the forward leg: direction has flipped to -1, tween still live.
    expect(st.direction).toBe(-1);

    // Backward leg (iteration 1 of 2 completes).
    for (let i = 0; i < 4; i++) {
      const r = advanceTween(st, 0.25, config);
      st = r.state;
      expect(r.done).toBe(false);
    }

    // Second forward leg.
    for (let i = 0; i < 4; i++) {
      const r = advanceTween(st, 0.25, config);
      st = r.state;
      expect(r.done).toBe(false);
    }
    expect(st.direction).toBe(-1);

    // Second backward leg — done fires here.
    let doneSeen = false;
    for (let i = 0; i < 4; i++) {
      const r = advanceTween(st, 0.25, config);
      st = r.state;
      if (r.done) doneSeen = true;
    }
    expect(doneSeen).toBe(true);
    expect(st.loopCount).toBe(0);
  });

  it('loops:0, yoyo:true completes after exactly forward + backward (2 legs)', () => {
    const config = cfg({ duration: 1, yoyo: true, loops: 0 });
    let st = createTweenState({ loops: 0 });
    // 1.0s forward
    for (let i = 0; i < 4; i++) {
      const r = advanceTween(st, 0.25, config);
      st = r.state;
      expect(r.done).toBe(false);
    }
    // 1.0s backward -> done
    let doneAt: number | null = null;
    for (let i = 0; i < 4; i++) {
      const r = advanceTween(st, 0.25, config);
      st = r.state;
      if (r.done && doneAt === null) doneAt = 8; // 8th quarter-step total
    }
    expect(doneAt).toBe(8);
  });
});

describe('loops', () => {
  it('loops:3, yoyo:false cycles (loops + 1) iterations then done — not sooner', () => {
    const config = cfg({ duration: 1, loops: 3 });
    let st = createTweenState({ loops: 3 });

    // 3.0s elapsed = 3 forward legs done; one iteration still remains -> not done.
    let doneWithinFirst12 = false;
    for (let i = 0; i < 12; i++) {
      const r = advanceTween(st, 0.25, config);
      st = r.state;
      if (r.done) doneWithinFirst12 = true;
    }
    expect(doneWithinFirst12).toBe(false);

    // Continue to 4.0s = 4th leg = final iteration -> done.
    let doneAt: number | null = null;
    for (let i = 12; i < 20; i++) {
      const r = advanceTween(st, 0.25, config);
      st = r.state;
      if (r.done && doneAt === null) doneAt = i + 1;
    }
    // 16th quarter-step total == 4.0s == end of the 4th forward leg.
    expect(doneAt).toBe(16);
  });

  it('a completed tween stays done (loopCount pinned at 0)', () => {
    const config = cfg({ duration: 0.5 });
    let st = createTweenState();
    st = advanceTween(st, 0.5, config).state;
    expect(st.loopCount).toBe(0);
    const again = advanceTween(st, 0.5, config);
    expect(again.done).toBe(true);
    expect(again.value).toBe(1);
  });
});

describe('delay', () => {
  it('createTweenState({ delay: 0.5 }) advanced by 0.5s total leaves value at the start', () => {
    const config = cfg({ duration: 1 });
    let st = createTweenState({ delay: 0.5 });

    const r1 = advanceTween(st, 0.25, config);
    st = r1.state;
    expect(r1.value).toBe(0);
    expect(st.delay).toBeCloseTo(0.25, 9);
    expect(st.elapsed).toBe(0);

    const r2 = advanceTween(st, 0.25, config);
    st = r2.state;
    expect(r2.value).toBe(0);
    expect(st.delay).toBe(0);
    expect(st.elapsed).toBe(0);
  });

  it('value only begins moving after the delay is exhausted', () => {
    const config = cfg({ duration: 1 });
    let st = createTweenState({ delay: 0.5 });

    // Exhaust the full 0.5s delay in one step (no progress carryover).
    st = advanceTween(st, 0.5, config).state;
    expect(st.delay).toBe(0);
    expect(st.elapsed).toBe(0);

    // Now a 0.25s advance moves the value off the start.
    const r = advanceTween(st, 0.25, config);
    expect(r.value).toBeCloseTo(0.25, 9);
  });

  it('delay carryover feeds into elapsed when a single step exceeds the delay', () => {
    const config = cfg({ duration: 1 });
    const r = advanceTween(createTweenState({ delay: 0.2 }), 0.5, config);
    expect(r.state.delay).toBe(0);
    expect(r.state.elapsed).toBeCloseTo(0.3, 9);
    expect(r.value).toBeCloseTo(0.3, 9);
  });

  it('delay is consumed exactly once (never re-applied after exhaustion)', () => {
    const config = cfg({ duration: 1 });
    let st = createTweenState({ delay: 0.3 });
    st = advanceTween(st, 0.3, config).state;
    expect(st.delay).toBe(0);
    for (let i = 0; i < 5; i++) {
      st = advanceTween(st, 0.1, config).state;
      expect(st.delay).toBe(0);
    }
  });
});

describe('determinism', () => {
  it('two independent states with identical (initialState, dt-sequence, config) yield byte-identical value sequences', () => {
    const config = cfg({
      duration: 0.7,
      ease: easeOutBack,
      yoyo: true,
      loops: 2,
    });
    const dts = [0.1, 0.05, 1 / 60, 0.2, 0.3, 0.15, 0.05, 0.4, 0.1, 0.1, 0.25, 0.25];
    let a = createTweenState({ loops: 2, delay: 0.2 });
    let b = createTweenState({ loops: 2, delay: 0.2 });
    const va: number[] = [];
    const vb: number[] = [];
    for (const dt of dts) {
      const ra = advanceTween(a, dt, config);
      const rb = advanceTween(b, dt, config);
      a = ra.state;
      b = rb.state;
      va.push(ra.value);
      vb.push(rb.value);
    }
    expect(va).toEqual(vb);
    expect(a).toEqual(b);
  });
});

describe('purity', () => {
  it('advanceTween does not mutate the input state (deep-equal before/after)', () => {
    const config = cfg({ duration: 1, ease: easeOutCubic });
    const original = createTweenState({ loops: 2, delay: 0.1 });
    const snapshot = JSON.parse(JSON.stringify(original));
    advanceTween(original, 0.25, config);
    advanceTween(original, 0.25, config);
    expect(original).toEqual(snapshot);
  });

  it('returns a fresh state object each call (distinct reference)', () => {
    const config = cfg({ duration: 1 });
    const st = createTweenState();
    const r = advanceTween(st, 0.25, config);
    expect(r.state).not.toBe(st);
  });
});
