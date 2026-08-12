/**
 * Default config and dimension constants for the platformer kernel.
 *
 * Values are tuned for a Sokpop-style precision platformer feel (snappy
 * ground control, snappy jump, gentle wall-slide). Spread
 * `DEFAULT_PLATFORMER_CONFIG` into your own object to override individual
 * fields without re-typing the whole record.
 *
 * @module
 */

import { DEFAULT_JUMP } from '../animation/jump';
import type { PlatformerConfig, Contacts, PlatformerEvents, LocomotionState } from './types';

/**
 * Default platformer tuning. All values in px/s or seconds. No magic numbers
 * in the kernel hot path — every tunable lives here.
 *
 * Math: `gravity` (980 px/s²) was derived by scaling a `0.5 px/tick²`
 * `0.5 px/tick²` feel by `60²` to convert tick-rate to seconds, then tuned
 * down for snappy precision control. The `jump` sub-config delegates to
 * `DEFAULT_JUMP` from `src/animation/jump.ts` — that is the source of truth
 * for jump trajectory.
 */
export const DEFAULT_PLATFORMER_CONFIG: Readonly<PlatformerConfig> = {
  gravity: 980,
  maxFallSpeed: 600,
  // Phase 4 — fast-fall (mutable max-fall easing, Celeste `Player.cs:2910-2924`).
  // Derivations:
  //   fastMaxFallSpeed = FastMaxFall 240 / MaxFall 160 = 1.5 × maxFallSpeed 600 = 900
  //   fastMaxAccel     = FastMaxAccel 300 / Celeste-gravity 900 = 0.33 × gravity 980 ≈ 327
  fastMaxFallSpeed: 900,
  fastMaxAccel: 327,
  moveSpeed: 200,
  // Phase 3a — rate-based run/air acceleration (replaces the old dt-free
  // `airControl` lerp). Derivations pegged to Celeste `Player.cs:2891-2894`:
  //   runAccel        = RunAccel 1000 / MaxRun 90 = 11.1/s × moveSpeed 200 ≈ 2220
  //   overspeedReduce = RunReduce 400 = 0.4 × RunAccel ≈ 890 (0.4 × runAccel)
  //   airAccelMultiplier = AirMult .65 (Player.cs:2885), ratio, verbatim
  runAccel: 2220,
  overspeedReduce: 890,
  airAccelMultiplier: 0.65,
  jump: DEFAULT_JUMP,
  jumpEnabled: true,
  wallSlideEnabled: true,
  // Phase 3b — decaying wall-slide (replaces the permanent `wallSlideSpeed: 60`
  // clamp). Derivations pegged to Celeste `Player.cs:2933-2947`:
  //   wallSlideStartMax = WallSlideStartMax 20 / MaxFall 160 = 0.125 × 600 = 75
  //   wallSlideTime     = WallSlideTime 1.2, verbatim seconds
  wallSlideStartMax: 75,
  wallSlideTime: 1.2,
  wallJumpVx: 220,
  wallJumpVy: -380,
  wallJumpLockTime: 0.12,
  dashEnabled: true,
  dashSpeed: 420,
  dashDuration: 0.12,
  // Phase 2b — Celeste-style dash startup freeze. `Celeste.Freeze(.05f)`
  // (Player.cs:3448) precedes applying `Speed = newSpeed` (Player.cs:3559).
  // At 60 Hz, 0.05 s is 3 ticks the actor spends frozen at zero velocity
  // before the dash velocity applies. Set to 0 to skip the freeze.
  dashStartupTime: 0.05,
  dashCooldown: 0.3,
  // Phase 4c — end-dash velocity (Celeste `Player.cs:3625-3632`). Verbatim
  // ratios: EndDashSpeed 160 / DashSpeed 240 = 0.67; EndDashUpMult 0.75.
  endDashSpeedFactor: 0.67,
  endDashUpMult: 0.75,
  maxDashes: 1,
  doubleJumpEnabled: false,
  maxDoubleJumps: 0,
  climbEnabled: false,
  climbSpeed: 120,
  stepHeight: 0,
  // Phase 0e — wall-presence probe distance for the wall-slide ability's
  // `probeWall` geometry query. Pegged to Celeste's `WallJumpCheckDist = 3`.
  wallProbeDistance: 3,
  // -----------------------------------------------------------------------
  // Phase 5 — super jump / super wall jump / hyper / wavedash + ducking.
  // Derivations pegged to Celeste `Player.cs:3495-3524` / `1711-1715` /
  // `3578-3585` ratios (roadmap §5); magnitudes are NEVER copied.
  //   superJumpVx       = SuperJumpH 260 / MaxRun 90 = 2.89 × moveSpeed 200 = 578
  //   superWallJumpVx   = SuperWallJumpH 170 / MaxRun 90 = 1.89 × 200 = 378
  //   superWallJumpVy   = SuperWallJumpSpeed -160 / JumpSpeed -105 = 1.52 × 343 ≈ -523
  //   dodgeSlideSpeedMult = DodgeSlideSpeedMult 1.2 (verbatim ratio)
  //   duckSuperJumpXMult  = DuckSuperJumpXMult 1.25 (verbatim ratio)
  //   duckSuperJumpYMult  = DuckSuperJumpYMult 0.5 (verbatim ratio)
  //   duckFriction      = DuckFriction 500 / RunAccel 1000 = 0.5 × runAccel 2220 = 1110
  //   groundDuckEnabled = true (default-on Celeste-faithful grounded-Down latch)
  //   superJumpGrace    = JumpGraceTime 0.1 (verbatim seconds)
  // (superJumpVy is NOT here — it equals `jumpLaunchVelocity(config.jump)` at
  // runtime, the same impulse as a normal jump, per Celeste `SuperJumpSpeed =
  // JumpSpeed`. Computed in `dashTechAbility`.)
  superJumpVx: 578,
  superWallJumpVx: 378,
  superWallJumpVy: -523,
  dodgeSlideSpeedMult: 1.2,
  duckSuperJumpXMult: 1.25,
  duckSuperJumpYMult: 0.5,
  duckFriction: 1110,
  // Default-on: grounded Down establishes a duck (Celeste-faithful). Opt out
  // (false) only where the same moveY channel must stay for ladders/fast-fall
  // but a stationary crouch has no affordance — see PlatformerConfig.groundDuckEnabled.
  groundDuckEnabled: true,
  superJumpGrace: 0.1,
  // -----------------------------------------------------------------------
  // Phase 6 — wall-grab + stamina (Celeste `Climb*`, `Player.cs:102-118`).
  // Derivations (pegging rule: [A] = celeste/celesteRef × aicraftRef, reference
  // = MaxRun→moveSpeed for speeds unless noted). Stamina costs/rates are
  // per-second RATEs or a pool SIZE — scale-independent, transferred VERBATIM.
  // The climb/hop SPEEDS are magnitudes → pegged via MaxRun→moveSpeed.
  //   wallGrabEnabled       = false (OFF by default, matching climbEnabled)
  //   wallGrabMaxStamina    = ClimbMaxStamina 110 (verbatim — a pool size)
  //   staminaUpCostPerSec   = ClimbUpCost 100/2.2 ≈ 45.45 (verbatim per-sec rate)
  //   staminaStillCostPerSec= StillCost 100/10 = 10 (verbatim per-sec rate)
  //   staminaClimbJumpCost  = JumpCost 110/4 = 27.5 (verbatim flat amount)
  //   wallClimbUpSpeed      = ClimbUpSpeed 45 / MaxRun 90 × moveSpeed 200 = 100
  //   wallClimbDownSpeed    = ClimbDownSpeed 80 / MaxRun 90 × 200 ≈ 178
  //   climbHopVy            = ClimbHopY 120 / MaxRun 90 × 200 ≈ 267
  //   climbHopVx            = ClimbHopX 100 / MaxRun 90 × 200 ≈ 222
  //   climbHopForceTime     = ClimbHopForceTime .2 (verbatim seconds)
  //   climbJumpBoostTime    = ClimbJumpBoostTime .2 (verbatim; reserved — leniency deferred)
  //   climbUpCheckDist      = ClimbUpCheckDist 2 (verbatim px; reserved — leniency deferred)
  // NOTE on climb-speed pegging: the roadmap loosely says "pegged to climbSpeed
  // 120" — we deliberately use the MaxRun→moveSpeed rule (appendix) for
  // consistency with every other transferred speed. `climbSpeed` (120) is the
  // LADDER speed, a separate concern (ladder shafts); pegging wall-climb to it
  // would conflate two unrelated channels. MaxRun→moveSpeed is the canonical
  // locomotion-speed reference and is what every Phase 3-5 speed uses.
  wallGrabEnabled: false,
  wallGrabMaxStamina: 110,
  staminaUpCostPerSec: 45.45,
  staminaStillCostPerSec: 10,
  staminaClimbJumpCost: 27.5,
  wallClimbUpSpeed: 100,
  wallClimbDownSpeed: 178,
  climbHopVy: 267,
  climbHopVx: 222,
  climbHopForceTime: 0.2,
  climbJumpBoostTime: 0.2,
  climbUpCheckDist: 2,
  // -----------------------------------------------------------------------
  // Phase 7 — upward CC + dash CC + wall-speed retention (Celeste
  // `UpwardCornerCorrection` / `DashCornerCorrection` / `WallSpeedRetentionTime`).
  // The two CC tolerances are PIXEL TOLERANCES pegged to tile size (NOT copied
  // magnitudes — the pegging rule forbids copying `4`):
  //   upwardCornerCorrection = UpwardCornerCorrection 4 (in 8px Celeste tiles)
  //                           → 4/8 tile × 16px = 8px at aicraft's 16px tiles
  //   dashCornerCorrection   = DashCornerCorrection 4 (same derivation, same 8px)
  //   wallSpeedRetentionTime = WallSpeedRetentionTime 0.06 (verbatim seconds)
  // The two CC systems share the Celeste `4` tolerance but are SEPARATE systems
  // (roadmap §4d/§7 stress this). The 8px value is intentionally small so CC
  // only smooths 1-tile lips — it never teleports through walls (the clearance
  // test in the kernel is airtight against every blocking solid).
  upwardCornerCorrection: 8,
  dashCornerCorrection: 8,
  wallSpeedRetentionTime: 0.06,
  // -----------------------------------------------------------------------
  // Phase 8 — springs + dash refills (Celeste `BounceSpeed` / `SuperBounceSpeed`
  // / `BounceAutoJumpTime` / `BounceVarJumpTime`, `Player.cs:64,66,38,63`).
  // The two bounce magnitudes are pegged via the JumpSpeed→aicraft-launch rule:
  // aicraft's normal jump launch = `jumpLaunchVelocity(DEFAULT_JUMP)` ≈ 343,
  // so the spring speed is `celesteBounce / celesteJumpSpeed × 343`.
  //   springBounceVy      = BounceSpeed 140 / JumpSpeed 105 = 1.33 × 343 ≈ -460
  //   springSuperBounceVy = SuperBounceSpeed 185 / JumpSpeed 105 = 1.76 × 343 ≈ -605
  //   springVarJumpTime   = BounceVarJumpTime 0.2 (verbatim seconds)
  //   springAutoJumpTime  = BounceAutoJumpTime 0.1 (verbatim seconds; reserved)
  // -----------------------------------------------------------------------
  springBounceVy: -460,
  springSuperBounceVy: -605,
  springVarJumpTime: 0.2,
  springAutoJumpTime: 0.1,
  // -----------------------------------------------------------------------
  // Phase 8c — per-event squash & stretch FX is RENDER-ONLY and therefore
  // intentionally ABSENT from the default config object. The optional
  // `PlatformerConfig.squash` field exists so consumers can tune the pairs, but
  // leaving it `undefined` here keeps the serialized config (and thus the
  // replay hash / `physicsVersion`) byte-identical — squash never affects
  // physics trajectories or replay state. Renderers read
  // `config.squash ?? DEFAULT_SQUASH_CONFIG` (see `src/platformer/squash.ts`).
  // -----------------------------------------------------------------------
};

/** Default player body width in world units (compact platformer scale). */
export const DEFAULT_PLAYER_WIDTH = 16;

/** Default player body height in world units (compact platformer scale). */
export const DEFAULT_PLAYER_HEIGHT = 24;

/**
 * Empty `Contacts` record — all sides `null`. Used as the initial contacts
 * for a freshly created state and as the starting point for the kernel's
 * per-tick contact resolution.
 */
export const EMPTY_CONTACTS: Readonly<Contacts> = {
  groundId: null,
  leftWallId: null,
  rightWallId: null,
  ceilingId: null,
};

/**
 * Empty `PlatformerEvents` record — all events `false`. Used as the starting
 * point for the kernel's per-tick event accumulation; the final events object
 * is built by merging partials emitted by each ability plus collision-driven
 * events.
 */
export const EMPTY_EVENTS: Readonly<PlatformerEvents> = {
  justLanded: false,
  justLaunched: false,
  hitCeiling: false,
  hitWall: false,
  startedWallSlide: false,
  wallJumpLaunched: false,
  dashStarting: false,
  dashStarted: false,
  doubleJumped: false,
};

/**
 * Empty interactions list (Phase 8). Used as the per-tick starting point the
 * kernel resets `PlatformerState.interactions` to each tick (same lifecycle as
 * {@link EMPTY_EVENTS}); the spring/dashRefill processors push
 * `InteractionEvent`s onto a local list during the tick.
 *
 * Frozen + exported so callers can reference-stable compare against the empty
 * case (`state.interactions === EMPTY_INTERACTIONS`) and so the fallback
 * state in `src/replay/player.ts` can reuse it.
 */
export const EMPTY_INTERACTIONS: readonly import('./types').InteractionEvent[] =
  Object.freeze([]);

/**
 * Empty `LocomotionState` — all timers zero, no launch window, no lockout.
 * Used as the initial locomotion slice for a freshly created state and as the
 * base the kernel mutates each tick.
 */
export const EMPTY_LOCOMOTION: Readonly<LocomotionState> = {
  coyoteTimer: 0,
  jumpBufferTimer: 0,
  varJumpTimer: 0,
  varJumpSpeed: 0,
  forceMoveXTimer: 0,
  forceMoveX: 0,
  // Phase 4 — mutable max-fall cap starts at the default maxFallSpeed (600) so
  // a fresh state falls at the normal terminal speed until `moveY === 1` eases
  // it up. `createPlatformerState` overrides this with the caller's actual
  // `config.maxFallSpeed`.
  maxFallCurrent: DEFAULT_PLATFORMER_CONFIG.maxFallSpeed,
  // Phase 5 — ducking / last-dash-direction / super-jump grace / dashing flag.
  // A fresh actor is not ducking, has never dashed (direction 0/0), has no
  // super-jump grace, and is not mid-dash.
  ducking: false,
  lastDashDirX: 0,
  lastDashDirY: 0,
  superJumpGraceTimer: 0,
  dashing: false,
  // Phase 6 — wall-grab stamina pool. Starts at the default max (110) so a
  // fresh actor can grab immediately. `createPlatformerState` overrides this
  // with the caller's actual `config.wallGrabMaxStamina`.
  stamina: DEFAULT_PLATFORMER_CONFIG.wallGrabMaxStamina,
  // Phase 7 — wall-speed retention. A fresh actor has no stashed momentum, no
  // active retention window, and is not mid-brush (the latch starts false).
  retainedVx: 0,
  wallSpeedRetentionTimer: 0,
  wallSpeedRetaining: false,
};
