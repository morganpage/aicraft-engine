import { describe, expect, it } from 'vitest';
import {
  advanceSpriteAnimPlayer,
  createSpriteAnimPlayer,
  deriveSpriteAnimKind,
  spriteAnimClipFor,
} from '../sprites/anim-state';
import type { SpriteAnimInputs, SpriteAnimKind } from '../sprites/anim-state';
import { currentFrameIndex } from '../sprites/resolve';
import type { CompiledAnim } from '../sprites/compile';

function inputs(partial: Partial<SpriteAnimInputs>): SpriteAnimInputs {
  return { supported: true, speedX: 0, velocityY: 0, gravityDir: 1, ...partial };
}

describe('deriveSpriteAnimKind', () => {
  it('grounded + slow → idle', () => {
    expect(deriveSpriteAnimKind(inputs({ supported: true, speedX: 0 }))).toBe('idle');
    expect(deriveSpriteAnimKind(inputs({ supported: true, speedX: 5 }))).toBe('idle');
  });

  it('grounded + fast → walk', () => {
    expect(deriveSpriteAnimKind(inputs({ supported: true, speedX: 50 }))).toBe('walk');
    expect(deriveSpriteAnimKind(inputs({ supported: true, speedX: -50 }))).toBe('walk');
  });

  it('airborne + moving up → ascent', () => {
    expect(deriveSpriteAnimKind(inputs({ supported: false, velocityY: -200 }))).toBe('ascent');
  });

  it('airborne + moving down → descent', () => {
    expect(deriveSpriteAnimKind(inputs({ supported: false, velocityY: 200 }))).toBe('descent');
  });

  it('airborne + near-zero vertical → apex', () => {
    expect(deriveSpriteAnimKind(inputs({ supported: false, velocityY: 0 }))).toBe('apex');
  });

  it('respects inverted gravity (ceiling climb)', () => {
    // gravityDir -1 flips the sign convention: +vy is "up" relative to gravity.
    expect(deriveSpriteAnimKind(inputs({ supported: false, velocityY: 200, gravityDir: -1 }))).toBe('ascent');
    expect(deriveSpriteAnimKind(inputs({ supported: false, velocityY: -200, gravityDir: -1 }))).toBe('descent');
  });

  it('honors a custom walk threshold', () => {
    expect(deriveSpriteAnimKind(inputs({ supported: true, speedX: 20, walkThreshold: 100 }))).toBe('idle');
    expect(deriveSpriteAnimKind(inputs({ supported: true, speedX: 20, walkThreshold: 10 }))).toBe('walk');
  });
});

// =========================================================================
// Kind → clip grouping and the clip-aware clock
// =========================================================================

describe('spriteAnimClipFor', () => {
  it('collapses the three airborne phases onto ONE jump clip', () => {
    expect(spriteAnimClipFor('ascent')).toBe('jump');
    expect(spriteAnimClipFor('apex')).toBe('jump');
    expect(spriteAnimClipFor('descent')).toBe('jump');
  });

  it('maps the grounded kinds 1:1', () => {
    expect(spriteAnimClipFor('idle')).toBe('idle');
    expect(spriteAnimClipFor('walk')).toBe('walk');
  });

  it('degrades an out-of-union value to idle rather than throwing', () => {
    expect(spriteAnimClipFor('nonsense' as SpriteAnimKind)).toBe('idle');
  });
});

describe('advanceSpriteAnimPlayer', () => {
  const TICK = 1000 / 60; // ms

  it('does NOT restart the clock across ascent → apex → descent', () => {
    // The regression this helper exists for: a held jump whose animation
    // appears to replay because the naive `kind !== lastKind` reset fires
    // twice per arc.
    let player = createSpriteAnimPlayer('idle');
    player = advanceSpriteAnimPlayer(player, 'ascent', TICK);
    expect(player.restarted).toBe(true); // idle → jump IS a clip change
    const afterLaunch = player.state.elapsedMs;

    player = advanceSpriteAnimPlayer(player, 'ascent', TICK);
    player = advanceSpriteAnimPlayer(player, 'apex', TICK);
    expect(player.restarted).toBe(false);
    player = advanceSpriteAnimPlayer(player, 'descent', TICK);
    expect(player.restarted).toBe(false);

    expect(player.clip).toBe('jump');
    expect(player.kind).toBe('descent');
    // Four ticks of monotonically accumulated time, never rewound.
    expect(player.state.elapsedMs).toBeCloseTo(afterLaunch + TICK * 3, 10);
  });

  it('restarts the clock when the CLIP changes', () => {
    let player = createSpriteAnimPlayer('walk');
    for (let i = 0; i < 10; i += 1) player = advanceSpriteAnimPlayer(player, 'walk', TICK);
    expect(player.state.elapsedMs).toBeCloseTo(TICK * 10, 10);

    player = advanceSpriteAnimPlayer(player, 'ascent', TICK);
    expect(player.restarted).toBe(true);
    expect(player.clip).toBe('jump');
    // Restart is to zero, then this tick's dt is still absorbed (no dropped dt).
    expect(player.state.elapsedMs).toBeCloseTo(TICK, 10);
  });

  it('holds a one-shot jump clip clamped on its last frame while airborne', () => {
    // The feel contract: 60 → 64 once, then CLAMP on the fall frame — which
    // only holds if the clock is never restarted mid-arc.
    const jump: CompiledAnim = {
      name: 'jump',
      frameIndices: [60, 61, 62, 63, 64],
      durations: [70, 70, 70, 70, 70],
      direction: 'forward',
      loop: false,
    };
    // Half a frame duration per step, so a mid-arc restart would rewind the
    // cell rather than merely repeat it.
    const STEP = 35;
    const phases: SpriteAnimKind[] = [
      'ascent', 'ascent', 'apex', 'apex', 'descent', 'descent', 'descent', 'descent',
    ];
    let player = createSpriteAnimPlayer('idle');
    const cells: number[] = [];
    for (const phase of phases) {
      player = advanceSpriteAnimPlayer(player, phase, STEP);
      cells.push(jump.frameIndices[currentFrameIndex(player.state, jump) ?? 0]);
    }
    expect(cells).toEqual([60, 61, 61, 62, 62, 63, 63, 64]);

    // Still airborne well past the clip total → clamped on the fall frame.
    player = advanceSpriteAnimPlayer(player, 'descent', 500);
    expect(jump.frameIndices[currentFrameIndex(player.state, jump) ?? 0]).toBe(64);

    // Contrast — the naive `kind !== lastKind` reset this helper replaces.
    // Same phases, same dt, but the clock restarts at every phase boundary, so
    // the launch frames replay twice mid-arc.
    let naiveClock = { elapsedMs: 0 };
    let lastKind: SpriteAnimKind = 'idle';
    const naiveCells: number[] = [];
    for (const phase of phases) {
      if (phase !== lastKind) naiveClock = { elapsedMs: 0 };
      lastKind = phase;
      naiveClock = { elapsedMs: naiveClock.elapsedMs + STEP };
      naiveCells.push(jump.frameIndices[currentFrameIndex(naiveClock, jump) ?? 0]);
    }
    expect(naiveCells).toEqual([60, 61, 60, 61, 60, 61, 61, 62]);
  });

  it('a fresh player is the reset: the next jump starts on frame 0', () => {
    let player = createSpriteAnimPlayer('idle');
    for (let i = 0; i < 30; i += 1) player = advanceSpriteAnimPlayer(player, 'descent', TICK);
    expect(player.state.elapsedMs).toBeGreaterThan(0);

    // Respawn/restart: assign a fresh player.
    player = createSpriteAnimPlayer();
    expect(player.kind).toBe('idle');
    expect(player.clip).toBe('idle');
    expect(player.state.elapsedMs).toBe(0);
    expect(player.restarted).toBe(false);

    // The first airborne tick after the reset starts the clip from zero.
    player = advanceSpriteAnimPlayer(player, 'ascent', TICK);
    expect(player.restarted).toBe(true);
    expect(player.state.elapsedMs).toBeCloseTo(TICK, 10);
  });

  it('never mutates the player it was given', () => {
    const before = createSpriteAnimPlayer('walk');
    const snapshot = { ...before, state: { ...before.state } };
    advanceSpriteAnimPlayer(before, 'ascent', TICK);
    expect(before).toEqual(snapshot);
  });

  it('advances by zero on a non-finite or negative dt', () => {
    let player = advanceSpriteAnimPlayer(createSpriteAnimPlayer('walk'), 'walk', TICK);
    const held = player.state.elapsedMs;
    player = advanceSpriteAnimPlayer(player, 'walk', Number.NaN);
    expect(player.state.elapsedMs).toBe(held);
    player = advanceSpriteAnimPlayer(player, 'walk', -100);
    expect(player.state.elapsedMs).toBe(held);
  });
});
