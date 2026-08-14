# Platformer Direction-Aware Wall-Jump and Post-Slide Grace Plan

**Status:** Implemented (physics version 13 — see `src/platformer/abilities/wall-slide-ability.ts` and the wall-jump/grace tests in `src/tests/platformer-wall-slide.test.ts` + `src/tests/platformer-traces.test.ts` scenarios 2/2b).
**Scope:** Fix the wall-jump launch direction in the reusable `src/platformer/` engine and keep the away leap reachable.
**Baseline:** `aicraft-engine@0.13.0` (physics v12, mantle wave).
**Primary implementation seam:** `src/platformer/abilities/wall-slide-ability.ts`.
**Consumer target:** every `stepPlatformer` caller with `wallSlideEnabled: true` (Celerock's `PRECISION_PLATFORMER` kit).

## 1. Problem

The wall-jump push was always computed AWAY from the wall, ignoring held input
(`pushX = side === 'left' ? wallJumpVx : -wallJumpVx`). Because the slide only
stays engaged while the player holds INTO the wall, sliding + jump ALWAYS
flung the player off the wall it was holding into — sliding down a wall on
your right while holding Right and tapping jump launched you left, and
chimney-climbing a single wall was impossible.

The fix has a structural wrinkle: the slide gate and the jump gate interact.
Making "holding into the wall → straight up" the only rule would make EVERY
wall jump vertical, because into-wall is by definition held on any active
slide tick — and releasing the direction disengages the slide, which used to
disarm the jump with it. Preserving the away leap requires a short grace
window after the slide direction leaves the wall.

## 2. Semantics

| Press context | Input at the press | Launch | Facing |
|---|---|---|---|
| Active slide (into-wall, by definition of the slide gate) | into-wall | straight up: `vy = wallJumpVy`, `vx = 0`, `varJumpTime = jump.timeToApex` | the wall |
| Slide disengaged < `wallJumpGraceTime` ago | neutral or away (wall still beside the actor) | classic away leap: `vy = wallJumpVy`, `vx = ±wallJumpVx` | the push |
| Slide disengaged ≥ `wallJumpGraceTime` ago | any | no wall jump (plain jump owns the press) | — |

Both fire paths emit `source: 'wallJump'` (unchanged launch priority, lockout,
and `wallJumpLaunched` event/SFX mapping) and set
`lockTimer = wallJumpLockTime`, `graceTimer = 0`.

Grace gates beyond the timer, all mirroring the slide's own engage gates so
the leap can never fire where a slide could not:

- `!core.onGround` — `wallJump` OUTRANKS `jump` in launch arbitration; firing
  while grounded would hijack the plain ground jump.
- `lockTimer === 0`.
- `!grab.held` — the wall-grab ability owns grab+jump (climb-jump/hop).
- `(moveY ?? 0) !== 1` — fast-fall suppression, same as slide engage.
- NOT holding into the wall — holding in re-engages the slide (whose jump is
  the straight-up hop above); when the slide cannot re-engange (e.g. rising),
  the press is simply not a wall jump.
- The wall is still beside the actor (`probeWall` at `wallProbeDistance`) —
  no leaping off a wall that ended.

## 3. State and config

- `WallSlideAbilityState.graceTimer: number` — decayed by `dt` every tick,
  re-armed to the full window on every sliding tick (coyote-style, like the
  jump's `coyoteTimer`). `side` now PERSISTS while `graceTimer > 0` (the tick
  the slide drops used to null it immediately, which is exactly why the away
  leap needed the grace timer to be reachable at all).
- `PlatformerConfig.wallJumpGraceTime?: number` (optional, default `0.1` —
  sized with `coyoteTime` 0.08 / `jumpBufferTime` 0.1; classified `'time'` in
  `PLATFORMER_CONFIG_FIELD_UNITS`, i.e. copied by config scaling). `0`
  disables the window (wall jumps fire only on active slides).

`lockTimer` (0.12 s) outlives the grace window (0.1 s) and both fire paths
zero `graceTimer`, so a double wall jump from one press window is impossible.

## 4. Kernel interaction — the zero-vx force window (deliberately kept)

The straight-up hop keeps `source: 'wallJump'` with `vx: 0`. The kernel then
resolves `forceMoveX = Math.sign(0) = 0` with `forceMoveXTimer =
wallJumpLockTime`: `applyForcedHorizontal` early-returns on 0 (documented:
"`0` simply preserves `vx` … input is still suppressed by the caller's gate"),
so the lockout holds `vx ≈ 0` (`applyLaunch` wrote the exact 0) while
suppressing steering input for the lockout. Net behavior — a COMMITTED
vertical hop, then normal air control — was play-validated in the Celerock
build (a game-level pipeline wrapper prototyping these exact semantics) and is
intentionally preserved: NO kernel launch-handling change is part of this
wave. The kernel's only edit is the initial-state factory gaining
`graceTimer: 0`.

## 5. Versioning, tests, docs

- `CURRENT_PHYSICS_VERSION` 12 → 13 (trajectory-changing: into-wall slide+
  jumps go from up-and-away to straight-up; replay hash shifts for every
  scenario via the widened config/state + version).
- `platformer-wall-slide.test.ts` — the two into-wall wall-jump cases assert
  the straight-up launch (`vx = 0`, facing the wall); new grace cases cover
  neutral/away leaps, expiry, ground/grab/fast-fall/wall-gone/lock
  suppressions, into-wall-while-rising, and arming/decay of the timer with
  `side` persistence.
- `platformer-traces.test.ts` — scenario 2 becomes the away leap via the grace
  window (release tick 5, press tick 6); new scenario 2b pins the straight-up
  hop (`vx` stays 0 through the lockout, identical vy persistence to the away
  leap). All `replayHashFor` canaries re-pinned.
- `replay.test.ts` — the explicit previous-version boundary test moved to the
  12→13 edge.
- `games/celerock.md` — documents the mechanic in the §4.1 wall-kit block so
  game builds inherit it from `PRECISION_PLATFORMER` without a wrapper.

## 6. Out of scope

- Kernel launch/force-move changes (see §4).
- Presentation: `wallJumpLaunched` drives the horizontal squash/stretch pulse;
  the straight-up hop receives it too. Cosmetic; revisit only if the vertical
  hop reads wrong in a consumer.
