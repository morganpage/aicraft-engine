/**
 * Replay-wide constants (Pillar 4 — Runnable Subsystem).
 *
 * @module
 */

/**
 * Current platformer physics version. Bump on EVERY change that alters
 * replay trajectories — gravity tuning, ability impulse math, authority
 * collapses, a new ability slice that changes the `initial` state, etc.
 *
 *   - `1` — the post-Phase-0 "authority collapse" physics: `core.vy` is the
 *     single vertical authority, jump/wall-jump impulses flow as
 *     `LaunchIntent`s through the kernel, and the `locomotion` slice is
 *     part of `PlatformerState`.
 *   - `2` — Phase 2 dash startup ordering: the dash FREEZES the actor for
 *     `dashStartupTime` before applying velocity, and a same-direction dash
 *     preserves a faster pre-dash speed. Dash trajectories no longer match v1.
 *   - `3` — Phase 3 rate-based accel + decaying wall-slide: ground/air
 *     horizontal velocity is now advanced by `approach` at `runAccel`/
 *     `overspeedReduce` rates (replacing the old ground snap + dt-free
 *     `airControl` lerp), and wall-slide clamps `vy` to an easing max that
 *     decays from `wallSlideStartMax` toward `maxFallSpeed` over
 *     `wallSlideTime` (replacing the permanent `wallSlideSpeed` clamp) and
 *     requires directional intent toward the wall. Air + post-dash vx and
 *     slide vy trajectories no longer match v2.
 *   - `4` — Phase 4: moveY + 8-directional dash + fast-fall + end-dash
 *     velocity; `PlatformerInput` widened (the separate `climb` field was
 *     removed and replaced by the unified `moveY` field) → replay frames
 *     changed. The max-fall cap is now mutable state on `LocomotionState`
 *     (`maxFallCurrent`) that eases between `maxFallSpeed` and
 *     `fastMaxFallSpeed` while `moveY === 1` (fast-fall); wall-slide is
 *     suppressed while `moveY === 1`. Dash captures an 8-directional
 *     `(dirX, dirY)` with diagonal normalization (÷ √2), and a non-downward
 *     dash sets an absolute end-dash velocity (`dashSpeed ×
 *     endDashSpeedFactor`, upward carry × `endDashUpMult`) at expiry. Dash,
 *     fast-fall, and post-dash-carry trajectories no longer match v3.
 *   - `5` — Phase 5: super jump / super wall jump / hyper / wavedash +
 *     ducking. A new `dashTechAbility` processor (stateless slice
 *     `'dashTech'`) emits `superJump` / `superWallJump` `LaunchIntent`s that
 *     arbitrate over a plain jump; `LaunchSource` widened + priority reordered
 *     (`spring > superWallJump > superJump > wallJump > doubleJump > jump`).
 *     `LocomotionState` gained `ducking`, `lastDashDirX/Y`,
 *     `superJumpGraceTimer`, `dashing`; `PlatformerConfig` gained `superJumpVx`,
 *     `superWallJumpVx/Vy`, `dodgeSlideSpeedMult`, `duckSuperJumpXMult/YMult`,
 *     `duckFriction`, `superJumpGrace`; `AbilityContext` gained optional
 *     `locomotion`; `AbilityResult` gained optional `locomotionPatch`. A
 *     down-diagonal ground dash now converts to a ducking horizontal slide
 *     (hyper); `applyHorizontalInput` bleeds `vx` at `duckFriction` while
 *     ducking. The dash-tech and hyper trajectories do NOT match v4.
 *   - `6` — Phase 6: wall-grab + stamina (Celeste `Climb*`). New
 *     `wallGrabAbility` (slice `'wallGrab'`) claims the exclusive `'wallGrab'`
 *     mode (kernel skips gravity + horizontal input while grabbing); reads wall
 *     presence from `probeWall` (§0e — survives `vx=0`). `PlatformerInput`
 *     widened with optional `grab` (`PolledEdge | null`) → replay frames
 *     changed shape; `LocomotionState` gained `stamina`; `PlatformerConfig`
 *     gained `wallGrabEnabled` + the climb/stamina/hop fields;
 *     `LaunchSource` gained `'climbHop'`; `wallSlideAbility` yields when grab
 *     is held. The new grab/climb-hop trajectories do NOT match v5; scenarios
 *     without grab are trace-unchanged but replay-hash-shifted (new slice +
 *     config + version).
 *   - `7` — Phase 7: upward corner correction + dash corner correction +
 *     wall-speed retention (Celeste `UpwardCornerCorrection` /
 *     `DashCornerCorrection` / `WallSpeedRetentionTime`). Three new
 *     `PlatformerConfig` fields (`upwardCornerCorrection` 8,
 *     `dashCornerCorrection` 8, `wallSpeedRetentionTime` 0.06) and two new
 *     `LocomotionState` fields (`retainedVx`, `wallSpeedRetentionTimer`), all
 *     collision-time adjustments in the kernel's Step 6 using pure probe /
 *     `aabbOverlap` clearance tests. The existing trace scenarios do NOT
 *     trigger CC or retention (no 1-tile lips, no brief wall brushes that clear
 *     within 0.06s), so `traceHash` canaries are UNCHANGED; every
 *     `replayHashFor` shifts (3 new config fields + 2 new locomotion fields +
 *     version 6→7).
 *   - `8` — Phase 8: springs + dash refills (Celeste `BounceSpeed` /
 *     `SuperBounceSpeed` / `BounceAutoJumpTime` / `BounceVarJumpTime` +
 *     dash crystals). `PlatformerConfig` gained `springBounceVy` (-460),
 *     `springSuperBounceVy` (-605), `springVarJumpTime` (0.2),
 *     `springAutoJumpTime` (0.1); `Solid` gained optional `spring: { launch }`
 *     and `dashRefill: boolean` trigger-volume markers (NON-BLOCKING — the
 *     resolvers, probes, and kernel support queries skip them like
 *     `passthrough`/`ladder`); `PlatformerState` gained a top-level
 *     `interactions: readonly InteractionEvent[]` field (reset to `[]` each
 *     tick, same lifecycle as `events`) carrying identified `{ kind, entityId }`
 *     pairs so the consumer can run per-entity cooldown/respawn. The kernel
 *     detects spring overlap (gate: `vy > 0`, descending) pre-arbitration and
 *     pushes a `LaunchIntent { source: 'spring' }` (already in the union) so
 *     the impulse survives the jump slice (§0b); dash crystals refill
 *     `dashesRemaining` to max on overlap. New `'spring'` / `'dashRefill'`
 *     `EntityKind`s + `SpringProps` / `DashRefillProps` + level→solid compile.
 *     NONE of the existing trace scenarios (1–6) place a spring/crystal solid,
 *     so their `traceHash` canaries are UNCHANGED; every `replayHashFor` shifts
 *     (4 new config fields + new `interactions` field in the initial state +
 *     version 7→8). The spring/dashRefill mechanics are exercised in
   *     `platformer-springs.test.ts`, and the deferred "spring into jump slice
   *     (3 ticks)" scenario joins `platformer-traces` as scenario 7.
   *   - `9` — Phase 9: `PlatformerInput.moveX` widened from `-1 | 0 | 1` to
   *     `number` so analog controllers (gamepad sticks) can drive partial-speed
   *     movement (`moveX = 0.5` targets half `moveSpeed`). NON-PARITY
   *     extension: Celeste's `moveX` is strictly digital. Every edge/intent
   *     check is sign-based (`moveX < 0` / `> 0` / `Math.sign(moveX)`), so
   *     `moveX ∈ {-1, 0, 1}` produces byte-identical trajectories to v8 — every
   *     `traceHash` canary is UNCHANGED. Only `replayHashFor` shifts (the
   *     widened frame field shape is the same `moveX: number`, but the version
   *     8→9 bump folds into the replay config hash). The analog mechanics are
   *     exercised in `platformer-analog-input.test.ts`.
   *   - absent / `0` — pre-collapse physics. A replay whose `physicsVersion`
   *     is missing or `0` was recorded under different math; its trajectories
   *     will not reproduce, so `assertPhysicsVersion` / `playReplay` REJECT it
   *     with a `PhysicsVersionMismatchError`.
   *
   * Single source of truth: defined here, NOT redefined in the platformer
   * module. The replay layer owns version identity; the platformer kernel
   * owns physics math.
   */
export const CURRENT_PHYSICS_VERSION = 9;
