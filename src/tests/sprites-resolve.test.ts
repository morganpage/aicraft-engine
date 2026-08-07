import { describe, expect, it } from 'vitest';
import {
  createSpriteAnimState,
  advanceSpriteAnim,
  currentFrameIndex,
  currentFrameIndexAt,
  animTotalDuration,
} from '../sprites/resolve';
import type { CompiledAnim } from '../sprites/compile';

/** Build an anim with N frames of equal `ms` duration each. */
function uniformAnim(n: number, ms: number, direction: CompiledAnim['direction'] = 'forward', loop = true): CompiledAnim {
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  return {
    name: 'a',
    frameIndices: idx,
    durations: idx.map(() => ms),
    direction,
    loop,
  };
}

describe('frame-player — determinism', () => {
  it('identical inputs yield identical frame index', () => {
    const anim = uniformAnim(4, 100);
    for (const t of [0, 50, 99, 100, 250, 1000, 12345]) {
      expect(currentFrameIndexAt(t, anim)).toBe(currentFrameIndexAt(t, anim));
    }
  });

  it('advanceSpriteAnim is a pure clock: accumulates dt', () => {
    let s = createSpriteAnimState();
    expect(s.elapsedMs).toBe(0);
    s = advanceSpriteAnim(s, 16);
    expect(s.elapsedMs).toBe(16);
    s = advanceSpriteAnim(s, 16);
    expect(s.elapsedMs).toBe(32);
  });

  it('clamps negative dt to 0', () => {
    const s = advanceSpriteAnim({ elapsedMs: 100 }, -50);
    expect(s.elapsedMs).toBe(100);
  });
});

describe('frame-player — forward stepping', () => {
  const anim = uniformAnim(3, 100); // frames at [0-100), [100-200), [200-300)

  it('steps through frames by per-frame duration', () => {
    expect(currentFrameIndexAt(0, anim)).toBe(0);
    expect(currentFrameIndexAt(99, anim)).toBe(0);
    expect(currentFrameIndexAt(100, anim)).toBe(1);
    expect(currentFrameIndexAt(199, anim)).toBe(1);
    expect(currentFrameIndexAt(200, anim)).toBe(2);
  });

  it('loops back to frame 0 after the full cycle', () => {
    expect(currentFrameIndexAt(300, anim)).toBe(0);
    expect(currentFrameIndexAt(350, anim)).toBe(0);
    expect(currentFrameIndexAt(550, anim)).toBe(2);
  });

  it('non-looping clamps to the last frame', () => {
    const noLoop = uniformAnim(3, 100, 'forward', false);
    expect(currentFrameIndexAt(250, noLoop)).toBe(2);
    expect(currentFrameIndexAt(10000, noLoop)).toBe(2);
  });

  it('handles a single-frame clip (always 0)', () => {
    const one = uniformAnim(1, 100);
    expect(currentFrameIndexAt(0, one)).toBe(0);
    expect(currentFrameIndexAt(9999, one)).toBe(0);
  });

  it('returns undefined for an empty clip', () => {
    const empty: CompiledAnim = { name: 'e', frameIndices: [], durations: [], direction: 'forward', loop: true };
    expect(currentFrameIndexAt(100, empty)).toBeUndefined();
  });
});

describe('frame-player — reverse', () => {
  it('plays the (pre-reversed at compile) indices forward', () => {
    // Compile reverses frameIndices for direction:'reverse'. Here we simulate
    // that by passing an already-reversed index list directly.
    const anim: CompiledAnim = {
      name: 'r',
      frameIndices: [3, 2, 1, 0],
      durations: [100, 100, 100, 100],
      direction: 'reverse', // treated as forward at play time
      loop: true,
    };
    expect(currentFrameIndexAt(0, anim)).toBe(0); // shows frame "3"
    expect(currentFrameIndexAt(100, anim)).toBe(1); // shows frame "2"
    expect(currentFrameIndexAt(300, anim)).toBe(3); // shows frame "0"
  });
});

describe('frame-player — pingpong', () => {
  // 3 frames × 100ms: forward visit sequence 0,1,2 then reverse 1 → visits
  // [0,1,2,1] with durations [100,100,100,100], cycle = 400ms.
  const anim = uniformAnim(3, 100, 'pingpong');

  it('plays forward to the end then back without dwelling endpoints', () => {
    expect(currentFrameIndexAt(0, anim)).toBe(0);
    expect(currentFrameIndexAt(100, anim)).toBe(1);
    expect(currentFrameIndexAt(200, anim)).toBe(2);
    expect(currentFrameIndexAt(300, anim)).toBe(1); // reverse leg
    expect(currentFrameIndexAt(400, anim)).toBe(0); // cycle restarts
  });

  it('handles a 2-frame pingpong (0,1,0,1,... no interior reverse frames)', () => {
    const a = uniformAnim(2, 100, 'pingpong');
    // visit sequence: [0, 1] forward; reverse interior is empty; cycle = 200.
    expect(currentFrameIndexAt(0, a)).toBe(0);
    expect(currentFrameIndexAt(100, a)).toBe(1);
    expect(currentFrameIndexAt(200, a)).toBe(0);
  });
});

describe('frame-player — helpers', () => {
  it('animTotalDuration sums per-frame durations', () => {
    expect(animTotalDuration(uniformAnim(4, 100))).toBe(400);
    const mixed: CompiledAnim = {
      name: 'm',
      frameIndices: [0, 1, 2],
      durations: [50, 120, 30],
      direction: 'forward',
      loop: true,
    };
    expect(animTotalDuration(mixed)).toBe(200);
  });

  it('currentFrameIndex drives off a SpriteAnimState', () => {
    const anim = uniformAnim(2, 100);
    let s = createSpriteAnimState();
    s = advanceSpriteAnim(s, 150);
    expect(currentFrameIndex(s, anim)).toBe(1);
  });
});
