/**
 * Character-agnostic animation-state deriver.
 *
 * Maps a minimal physics surface (`supported`, `speedX`, `velocityY`, …) onto
 * a semantic animation kind (`'idle'` / `'walk'` / `'climb'` / `'ascent'` /
 * `'apex'` / `'descent'`). The branching mirrors `../character/humanoid/state.ts`'
 * `airPose` derivation so sprite characters animate with the same intent as
 * the procedural humanoid. Crucially, the SAME primitive drives both the
 * player (built from `PlatformerState.core`) and enemies (built from
 * `EnemyState` + a grounded check) — there is no player-specific logic here.
 *
 * The module also owns the KIND → CLIP grouping ({@link spriteAnimClipFor})
 * and the clip-aware clock ({@link advanceSpriteAnimPlayer}). A sheet has
 * fewer clips than the deriver has kinds — one airborne clip covers `ascent`,
 * `apex`, and `descent` — so a consumer that restarts its clock on every KIND
 * change restarts the jump clip mid-jump, twice per arc. That grouping is now
 * engine-owned rather than re-derived at each call site.
 *
 * Determinism: pure, no `Math.random` / `Date.now`.
 *
 * @module
 */

import {
  advanceSpriteAnim,
  createSpriteAnimState,
  type SpriteAnimState,
} from './resolve';

/** Semantic animation key. Maps 1:1 to a character's `animations` entry. */
export type SpriteAnimKind = 'idle' | 'walk' | 'climb' | 'ascent' | 'apex' | 'descent';

/**
 * Minimal physics surface any animated body can supply. Deliberately tiny so
 * both the player and enemies can construct it without coupling to a
 * specific simulation type.
 */
export interface SpriteAnimInputs {
  /** True when the body is supported by ground this tick. */
  readonly supported: boolean;
  /** Horizontal speed in px/s (sign indicates direction). */
  readonly speedX: number;
  /** Vertical velocity in px/s (world-down positive under normal gravity). */
  readonly velocityY: number;
  /** `1` for normal gravity (down), `-1` for inverted. Used so airborne
   * ascent/descent reads correctly on ceilings/walls. Default `1`. */
  readonly gravityDir?: 1 | -1;
  /** Absolute horizontal speed above which the body is "walking" vs "idle". */
  readonly walkThreshold?: number;
  /**
   * True while the body is gripping a wall (wall-grab / wall-climb — for the
   * platformer kernel, `state.abilities.wallGrab?.kind === 'wallGrab'`).
   * Takes priority over the grounded/airborne branches so a cling reads as
   * `'climb'` even while sliding slowly down the wall. Default `false`.
   */
  readonly climbing?: boolean;
}

/** Defaults if the caller omits optional fields. */
const DEFAULT_WALK_THRESHOLD = 12; // px/s — below this the body reads as idle

/**
 * Derive the semantic animation kind from physics. Pure.
 *
 * Climbing (`climbing: true`) → `'climb'`, priority over everything — a cling
 * is a cling whether the body is grounded, sliding, or hopping up the wall.
 * Grounded: `|speedX| > threshold` → `'walk'`, else `'idle'`.
 * Airborne: `velocityY * gravityDir < 0` → `'ascent'`, `> 0` → `'descent'`,
 * else `'apex'`.
 *
 * Matches `humanoid/state.ts:50-56` thresholds (-0.5 / +0.5 vertical), scaled
 * to px/s.
 */
export function deriveSpriteAnimKind(inputs: SpriteAnimInputs): SpriteAnimKind {
  const gravityDir = inputs.gravityDir ?? 1;
  const threshold = inputs.walkThreshold ?? DEFAULT_WALK_THRESHOLD;
  if (inputs.climbing === true) return 'climb';
  if (inputs.supported) {
    return Math.abs(inputs.speedX) > threshold ? 'walk' : 'idle';
  }
  // Relative-to-gravity vertical velocity: negative = moving up, positive =
  // moving down. Same convention as `humanoid/state.ts`.
  const rel = (inputs.velocityY ?? 0) * gravityDir;
  if (rel < -0.5) return 'ascent';
  if (rel > 0.5) return 'descent';
  return 'apex';
}

// --- kind → clip grouping + the clip-aware clock --------------------------

/**
 * The animation CLIP a {@link SpriteAnimKind} plays on.
 *
 * Six kinds collapse onto four clips because the three airborne phases are
 * phases of ONE arc, not three animations: a sheet's jump clip is authored as
 * launch → apex → fall and is meant to play once, straight through, across all
 * three. `'idle'`, `'walk'`, and `'climb'` map 1:1. A sheet without a climb
 * clip degrades per {@link spriteAnimClipFor} — the consumer's clip table
 * simply omits the key.
 */
export type SpriteAnimClip = 'idle' | 'walk' | 'climb' | 'jump';

/**
 * Map a semantic kind onto the clip that plays it. Pure and total: any value
 * outside the {@link SpriteAnimKind} union degrades to `'idle'` (the safe
 * hold) rather than throwing.
 *
 * ```
 * idle                      → 'idle'
 * walk                      → 'walk'
 * climb                     → 'climb'
 * ascent | apex | descent   → 'jump'
 * ```
 */
export function spriteAnimClipFor(kind: SpriteAnimKind): SpriteAnimClip {
  if (kind === 'walk') return 'walk';
  if (kind === 'climb') return 'climb';
  if (kind === 'ascent' || kind === 'apex' || kind === 'descent') return 'jump';
  return 'idle';
}

/**
 * A clip-aware animation clock: the current kind, the clip it resolves to, the
 * accumulated {@link SpriteAnimState} for that clip, and whether the clip
 * restarted on the tick that produced this player.
 *
 * Immutable by convention, like every other progression op in the engine —
 * {@link advanceSpriteAnimPlayer} returns a fresh player and the caller
 * reassigns.
 */
export interface SpriteAnimPlayer {
  /** The kind supplied on the most recent advance. */
  readonly kind: SpriteAnimKind;
  /** The clip `kind` resolves to — what the clock is actually timing. */
  readonly clip: SpriteAnimClip;
  /** The clock for `clip`. Pass to `currentFrameIndex` with that clip's anim. */
  readonly state: SpriteAnimState;
  /**
   * `true` only on the tick the clip changed and the clock restarted at zero.
   * Useful for one-shot side effects (a launch puff, a footstep on the walk
   * cycle's first frame). Always `false` on a freshly created player.
   */
  readonly restarted: boolean;
}

/**
 * Create a player parked at `kind` (default `'idle'`) with a zeroed clock.
 *
 * This is ALSO the reset: respawn, room restart, and any teleport should
 * assign a fresh player so the next jump starts on frame 0 instead of
 * inheriting the clamped fall frame of the arc that killed the player.
 */
export function createSpriteAnimPlayer(kind: SpriteAnimKind = 'idle'): SpriteAnimPlayer {
  return {
    kind,
    clip: spriteAnimClipFor(kind),
    state: createSpriteAnimState(),
    restarted: false,
  };
}

/**
 * Advance the clock by `dtMs` under a (possibly new) `kind`.
 *
 * The clock restarts **only when the CLIP changes**, never on a bare kind
 * change. That single rule is the whole point of this helper: the naive
 * `if (kind !== lastKind) clock = createSpriteAnimState()` restarts the jump
 * clip at the ascent→apex and apex→descent boundaries, so a held jump appears
 * to replay its launch frames two or three times per arc. Grouping the
 * airborne phases into one clip makes that failure unrepresentable.
 *
 * On a restart the fresh clock still absorbs this tick's `dtMs` (no dt is
 * dropped at a clip boundary). Non-finite or negative `dtMs` advances by zero,
 * inheriting {@link advanceSpriteAnim}'s guard.
 *
 * ```ts
 * anim = advanceSpriteAnimPlayer(anim, deriveSpriteAnimKind({
 *   supported: core.onGround, speedX: core.vx, velocityY: core.vy,
 * }), dt * 1000);
 * const clip = anim.clip === 'walk' ? walkAnim : jumpAnim;   // 'idle' holds a frame
 * const cell = clip.frameIndices[currentFrameIndex(anim.state, clip) ?? 0];
 * ```
 */
export function advanceSpriteAnimPlayer(
  player: Readonly<SpriteAnimPlayer>,
  kind: SpriteAnimKind,
  dtMs: number,
): SpriteAnimPlayer {
  const clip = spriteAnimClipFor(kind);
  const restarted = clip !== player.clip;
  const base = restarted ? createSpriteAnimState() : player.state;
  return {
    kind,
    clip,
    state: advanceSpriteAnim(base, dtMs),
    restarted,
  };
}
