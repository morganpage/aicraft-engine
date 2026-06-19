import { volumeScale, type Scale2D } from './squash-stretch';

/**
 * Apex-parameterized jump trajectory + state machine + landing squash.
 *
 * The jump is parameterized by design-time quantities (`apexHeight`,
 * `timeToApex`) rather than raw forces; gravity and launch velocity are
 * derived once at state creation. Each tick, `advanceJump` runs a fixed-order
 * pipeline — timer decrement, input-driven transitions, Euler integration,
 * airborne-blend ramp, 1D landing-squash spring — and returns a brand-new
 * `JumpState`. `evaluateJump` is a stateless reader.
 *
 * The library NEVER reads collision or polls input. `isGrounded`,
 * `jumpPressed`, and `hitCeiling` are abstract flags the consumer provides
 * each tick. This keeps the solver pure and game-agnostic.
 *
 * **Determinism contract:** same `(state, inputs, dt, config)` → byte-identical
 * returned state, forever. No `Math.random`, no `Date.now`, no DOM reads, no
 * global mutable state. Euler integration + a 1D semi-implicit spring. The
 * caller MUST use a fixed `dt` for trajectory determinism (variable `dt`
 * causes integration drift — caller's responsibility, mirroring the
 * `advanceSpringChain` convention).
 *
 * Reduced-motion: the consumer reads `prefersReducedMotion()` (renderer layer)
 * and spreads `DEFAULT_JUMP` into a config with dampened squash amplitudes /
 * shorter apex. The deterministic core never touches the host probe.
 */

/**
 * Apex-parameterized jump tuning. All values are consumer-tunable; no magic
 * numbers live in the solver. Spread `DEFAULT_JUMP` to override individual
 * fields (`{ ...DEFAULT_JUMP, apexHeight: 64 }`).
 *
 * Math (apex parameterization, GDC 2016 "Building a Better Jump"):
 *   gravity        = 2 · apexHeight / timeToApex²
 *   launchVelocity = 2 · apexHeight / timeToApex   (negative — +Y is down)
 */
export interface JumpConfig {
  /** Desired apex height in px. Default 48. */
  readonly apexHeight: number;
  /** Time from launch to apex in seconds. Default 0.28. */
  readonly timeToApex: number;
  /**
   * Ratio applied to `vy` while rising with the button released, in
   * `[0, 1]`. `0` = no cutoff (full height even on tap), `1` = instant stop.
   * Default 0.4.
   */
  readonly jumpCutoffFactor: number;
  /**
   * Gravity multiplier applied while rising after the button is released
   * (variable-height fall-off). Default 2.5.
   */
  readonly fallMultiplier: number;
  /** Coyote-time grace after leaving ground, in seconds. Default 0.08. */
  readonly coyoteTime: number;
  /** Jump-buffer window before landing, in seconds. Default 0.1. */
  readonly jumpBufferTime: number;
  /** `scaleY` at full-impact landing (volume-preserving). Default 0.7. */
  readonly landingSquashMin: number;
  /** Landing-squash spring stiffness (recovery speed). Default 180. */
  readonly landingSquashStiffness: number;
  /** Landing-squash spring damping. Default 12. */
  readonly landingSquashDamping: number;
  /** Anticipation crouch duration before launch, in seconds. Default 0.05. */
  readonly anticipationDuration: number;
  /** `scaleY` during the anticipation crouch. Default 0.85. */
  readonly anticipationSquash: number;
  /** `scaleY` on the single launch tick. Default 1.15. */
  readonly launchStretch: number;
  /** Airborne-blend ramp-up rate (blend units / second) after launch. Default 4. */
  readonly airborneBlendRampUp: number;
  /** Airborne-blend ramp-down rate (blend units / second) after landing. Default 4. */
  readonly airborneBlendRampDown: number;
}

/**
 * Default jump tuning matching the Spitekeep devil character scale. Tunable;
 * consumers spread this into their own config.
 */
export const DEFAULT_JUMP: Readonly<JumpConfig> = {
  apexHeight: 48,
  timeToApex: 0.28,
  jumpCutoffFactor: 0.4,
  fallMultiplier: 2.5,
  coyoteTime: 0.08,
  jumpBufferTime: 0.1,
  landingSquashMin: 0.7,
  landingSquashStiffness: 180,
  landingSquashDamping: 12,
  anticipationDuration: 0.05,
  anticipationSquash: 0.85,
  launchStretch: 1.15,
  airborneBlendRampUp: 4,
  airborneBlendRampDown: 4,
};

/**
 * Pre-computed physics constants derived from a `JumpConfig`. Cached on the
 * `JumpState` so the per-tick hot path does not re-derive them.
 */
export interface JumpPhysics {
  /** Derived gravity in px/s² (positive — accelerates downward, +Y). */
  readonly gravity: number;
  /** Derived launch velocity in px/s (negative — initial upward impulse). */
  readonly launchVelocity: number;
}

/**
 * Discrete jump phase. Transitions are driven by `advanceJump`; see the
 * state-machine contract documented on that function.
 *
 * `'grounded'`     — idle on the ground (or recovering the last of a landing squash).
 * `'anticipating'` — crouch squash before launch (`anticipationDuration`).
 * `'rising'`       — ballistic, moving upward (`vy < 0`).
 * `'falling'`      — ballistic, moving downward (`vy >= 0`), or post-coyote descent.
 * `'landing'`      — impact squash recovering via the 1D spring.
 */
export type JumpPhase = 'grounded' | 'anticipating' | 'rising' | 'falling' | 'landing';

/**
 * Persistent jump state (one instance per character; cloned each tick).
 *
 * All fields are `readonly` — `advanceJump` returns a fresh record and never
 * mutates the input (pure-progression-ops discipline).
 */
export interface JumpState {
  /** Current phase. */
  readonly phase: JumpPhase;
  /** Vertical velocity in px/s (+Y is down, so upward motion is negative). */
  readonly vy: number;
  /** Accumulated vertical offset from the launch point in px (negative = up). */
  readonly y: number;
  /** Coyote-time grace remaining, in seconds (`> 0` ⇒ a jump may still fire). */
  readonly coyoteTimer: number;
  /** Jump-buffer window remaining, in seconds (`> 0` ⇒ queued jump on land). */
  readonly jumpBufferTimer: number;
  /** Anticipation crouch remaining, in seconds (`> 0` ⇒ still anticipating). */
  readonly anticipationTimer: number;
  /** Echo of the previous tick's `jumpHeld` input (for inspection / debugging). */
  readonly jumpHeld: boolean;
  /**
   * Landing-squash vertical-scale offset (negative = squashed). Recovers
   * toward `0` via the 1D spring; `0` ⇒ identity scale.
   */
  readonly squashOffset: number;
  /** Squash-spring velocity (advances the 1D spring each tick). */
  readonly squashVelocity: number;
  /** Time spent in the landing phase, in seconds. */
  readonly landingTimer: number;
  /** Last captured landing-impact speed in px/s (positive magnitude; for consumer FX). */
  readonly impactVelocity: number;
  /** `true` only on the single launch tick (drives the launch-stretch scale). */
  readonly justLaunched: boolean;
  /** Airborne blend factor `[0, 1]`, ramped in/out on launch / land. */
  readonly airborneBlend: number;
  /**
   * Volume-preserving scale for this tick (anticipation / launch / landing
   * squash), computed by `advanceJump` from the config + current squash spring.
   * `evaluateJump` returns it verbatim — a pure reader needs no config access.
   */
  readonly scale: Scale2D;
  /** Pre-computed physics derived from the `JumpConfig` at creation. */
  readonly physics: JumpPhysics;
}

/**
 * Per-tick inputs from the consumer. The library NEVER reads collision or
 * polls the host; these abstract flags are the consumer's contract each tick.
 */
export interface JumpInputs {
  /** `true` while the jump button is held (drives variable-height cutoff). */
  readonly jumpHeld: boolean;
  /** `true` on the single tick the jump button transitioned to held. */
  readonly jumpPressed: boolean;
  /**
   * `true` when the character is on solid ground this tick. The library treats
   * this as ground truth — it never validates, caches, or re-derives it.
   */
  readonly isGrounded: boolean;
  /** Optional: `true` on a tick the character struck a ceiling (zeroes `vy`). */
  readonly hitCeiling?: boolean;
}

/**
 * Read-only pose output derived from a `JumpState` by `evaluateJump`.
 */
export interface JumpPose {
  /** Vertical offset in px (negative = above the launch point). */
  readonly yOffset: number;
  /** Volume-preserving scale for anticipation / launch / landing squash. */
  readonly scale: Scale2D;
  /** `true` while the character is truly airborne (`rising` or `falling`). */
  readonly airborne: boolean;
  /** Airborne blend factor `[0, 1]` (ramps; never snaps). */
  readonly airborneBlend: number;
  /** Last captured landing-impact speed in px/s (positive magnitude; for screen-shake etc.). */
  readonly impactVelocity: number;
}

/**
 * Magnitude below which both `squashOffset` and `squashVelocity` are considered
 * settled and the LANDING phase auto-transitions to GROUNDED. The residual
 * sub-threshold squash continues to compose (invisibly) during GROUNDED as the
 * spring finishes damping, so the recovery has no visible discontinuity.
 */
const LANDING_SETTLE_EPSILON = 0.01;

/**
 * Derive gravity and launch velocity from apex parameterization.
 *
 *   gravity        = 2 · apexHeight / timeToApex²      (positive — downward)
 *   launchVelocity = 2 · apexHeight / timeToApex        (negative — upward)
 *
 * Internal helper: consumers read derived physics via `state.physics` rather
 * than calling this directly. Kept internal (not re-exported) per the proposal.
 */
function deriveJumpPhysics(config: JumpConfig): JumpPhysics {
  const gravity = (2 * config.apexHeight) / (config.timeToApex * config.timeToApex);
  const launchVelocity = -(2 * config.apexHeight) / config.timeToApex;
  return { gravity, launchVelocity };
}

/**
 * Advance a 1D spring-damper one fixed timestep toward a target (semi-implicit
 * Euler). Internal helper used by the landing-squash recovery.
 *
 * Same integration scheme as the 2D Verlet chain (`spring.ts`): update velocity
 * from forces first, then position from the new velocity. Under a fixed `dt`
 * this is deterministic byte-for-byte. Underdamped (`damping < 2·√stiffness`)
 * configurations overshoot, producing the bouncy Sokpop-style recovery.
 */
function advanceOneDSpring(
  value: number,
  velocity: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
): { value: number; velocity: number } {
  const springForce = -stiffness * (value - target);
  const dampingForce = -damping * velocity;
  const newVelocity = velocity + (springForce + dampingForce) * dt;
  const newValue = value + newVelocity * dt;
  return { value: newValue, velocity: newVelocity };
}

/**
 * Create the initial grounded jump state for a character.
 *
 * The returned state is at rest on the ground with all timers zeroed and
 * derived physics cached from `config`. Pass it to `advanceJump` each tick.
 *
 * Pure: returns a fresh `JumpState`; never throws.
 *
 * @param config - jump tuning parameters
 * @returns a grounded, at-rest `JumpState`
 *
 * @example
 * ```ts
 * let jump = createJumpState(DEFAULT_JUMP);
 * jump = advanceJump(jump, inputs, 1 / 60, DEFAULT_JUMP);
 * const pose = evaluateJump(jump);
 * ```
 */
export function createJumpState(config: JumpConfig): JumpState {
  return {
    phase: 'grounded',
    vy: 0,
    y: 0,
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    anticipationTimer: 0,
    jumpHeld: false,
    squashOffset: 0,
    squashVelocity: 0,
    landingTimer: 0,
    impactVelocity: 0,
    justLaunched: false,
    airborneBlend: 0,
    scale: { scaleX: 1, scaleY: 1 },
    physics: deriveJumpPhysics(config),
  };
}

/**
 * Advance jump state by one fixed timestep.
 *
 * Handles the full lifecycle — `grounded → anticipating → rising → falling →
 * landing → grounded` — plus coyote time (grace period after leaving ground),
 * jump buffering (queued jump on landing), variable-height jumps (velocity cut
 * on button release), and landing-squash spring recovery.
 *
 * **Per-tick evaluation order** (must be followed exactly for deterministic
 * tick-boundary behavior):
 *   1. Capture the pre-decrement "active" booleans for coyote / buffer, then
 *      decrement all timers by `dt`. (A timer is "active" on a tick iff it was
 *      `> 0` at tick start; this is what makes a `dt`-remaining coyote window
 *      still fire on its final tick while a `0` window does not.)
 *   2. If `jumpPressed`, arm the jump buffer (`jumpBufferTimer = jumpBufferTime`).
 *   3. Phase transitions + physics integration (per-phase; see below).
 *   4. Airborne-blend ramp toward `1` (airborne phases) or `0` (grounded/landing).
 *   5. Advance the 1D landing-squash spring toward `0` (no-op when at rest).
 *
 * **Phase transitions:**
 * - `grounded` → `anticipating` on `jumpPressed` or an active buffer; →
 *   `falling` (with `coyoteTimer = coyoteTime`) when `isGrounded` becomes false.
 * - `anticipating` → `rising` when `anticipationTimer ≤ 0` (launch: sets
 *   `vy = launchVelocity`, clears residual squash, flags `justLaunched`).
 * - `rising` → `falling` on `hitCeiling` (`vy := 0`) or when `vy ≥ 0` after
 *   integration. While `!jumpHeld`, applies the variable-height cutoff
 *   (`vy := max(vy, launchVelocity · jumpCutoffFactor)`) and `fallMultiplier`.
 * - `falling` → `anticipating` on `isGrounded` if a jump is pressed or buffered
 *   (buffered re-jump fires on the landing tick); otherwise → `landing`
 *   (captures impact velocity, seeds the squash spring). Coyote-active +
 *   `jumpPressed` also fires a jump from `falling`.
 * - `landing` → `grounded` when the squash spring settles (both `squashOffset`
 *   and `squashVelocity` under `LANDING_SETTLE_EPSILON`); → `falling` with a
 *   fresh coyote window if `isGrounded` becomes false mid-recovery.
 *
 * The library NEVER reads collision or input polling. `isGrounded` and
 * `jumpPressed` are abstract flags provided by the consumer.
 *
 * **Determinism contract:** same `(state, inputs, dt, config)` → byte-identical
 * returned state, forever. No `Math.random`, no `Date.now`, no DOM reads, no
 * global mutable state.
 *
 * Pure: returns a brand-new `JumpState`; the input is never mutated.
 * Never throws.
 *
 * @param state - current jump state (from `createJumpState` or a prior `advanceJump`)
 * @param inputs - abstract input flags (`jumpHeld`, `jumpPressed`, `isGrounded`, `hitCeiling`)
 * @param dt - fixed timestep in seconds (caller MUST keep constant for determinism)
 * @param config - jump tuning parameters
 * @returns the next `JumpState`
 */
export function advanceJump(
  state: JumpState,
  inputs: JumpInputs,
  dt: number,
  config: JumpConfig,
): JumpState {
  // Step 1 — capture pre-decrement actives, then decrement timers.
  const coyoteActive = state.coyoteTimer > 0;
  const bufferActive = state.jumpBufferTimer > 0;
  const coyoteTimer = Math.max(0, state.coyoteTimer - dt);
  const jumpBufferTimer = Math.max(0, state.jumpBufferTimer - dt);
  const anticipationTimer = Math.max(0, state.anticipationTimer - dt);

  // Step 2 — arm the buffer on press (consumed when a jump actually fires).
  const armedBuffer = inputs.jumpPressed ? config.jumpBufferTime : jumpBufferTimer;

  // Locals carried into the new state.
  let phase = state.phase;
  let vy = state.vy;
  let y = state.y;
  let nextCoyote = coyoteTimer;
  let nextBuffer = armedBuffer;
  let nextAnticipation = anticipationTimer;
  let squashOffset = state.squashOffset;
  let squashVelocity = state.squashVelocity;
  let landingTimer = state.landingTimer;
  let impactVelocity = state.impactVelocity;
  let justLaunched = false;

  // Reference landing velocity = magnitude of the launch velocity. A symmetric
  // jump lands at ~launch speed, so a normal jump yields ~full squash and a
  // short hop yields less. Derived from physics, not a magic constant.
  const referenceVelocity = -state.physics.launchVelocity;

  // Step 3 — per-phase transitions + integration.
  switch (state.phase) {
    case 'grounded': {
      if (inputs.jumpPressed || bufferActive) {
        phase = 'anticipating';
        nextAnticipation = config.anticipationDuration;
        nextBuffer = 0;
      } else if (!inputs.isGrounded) {
        phase = 'falling';
        nextCoyote = config.coyoteTime;
      }
      break;
    }
    case 'anticipating': {
      if (anticipationTimer <= 0) {
        phase = 'rising';
        vy = state.physics.launchVelocity;
        justLaunched = true;
        squashOffset = 0;
        squashVelocity = 0;
      }
      break;
    }
    case 'rising': {
      if (inputs.hitCeiling) {
        phase = 'falling';
        vy = 0;
      } else {
        let g = state.physics.gravity;
        if (!inputs.jumpHeld) {
          vy = Math.max(vy, state.physics.launchVelocity * config.jumpCutoffFactor);
          g = g * config.fallMultiplier;
        }
        vy += g * dt;
        y += vy * dt;
        if (vy >= 0) phase = 'falling';
      }
      break;
    }
    case 'falling': {
      if (coyoteActive && inputs.jumpPressed) {
        phase = 'anticipating';
        nextAnticipation = config.anticipationDuration;
        nextBuffer = 0;
      } else {
        vy += state.physics.gravity * dt;
        y += vy * dt;
        if (inputs.isGrounded) {
          // Impact speed is the downward velocity magnitude (vy > 0 while
          // falling). max(0, vy) defends against a consumer reporting
          // isGrounded during a rising tick (then no squash is applied).
          const impactSpeed = Math.max(0, vy);
          impactVelocity = impactSpeed;
          if (inputs.jumpPressed || bufferActive) {
            // Buffered / pressed-on-land jump fires immediately.
            phase = 'anticipating';
            nextAnticipation = config.anticipationDuration;
            nextBuffer = 0;
          } else {
            phase = 'landing';
            const squashDepth =
              (1 - config.landingSquashMin) *
              Math.min(1, impactSpeed / referenceVelocity);
            squashOffset = -squashDepth;
            squashVelocity = 0;
            landingTimer = 0;
          }
        }
      }
      break;
    }
    case 'landing': {
      landingTimer += dt;
      if (!inputs.isGrounded) {
        phase = 'falling';
        nextCoyote = config.coyoteTime;
      } else if (Math.abs(squashOffset) < LANDING_SETTLE_EPSILON) {
        phase = 'grounded';
        nextCoyote = config.coyoteTime;
      }
      break;
    }
  }

  // Step 4 — airborne-blend ramp.
  const airbornePhase = phase === 'anticipating' || phase === 'rising' || phase === 'falling';
  let airborneBlend: number;
  if (airbornePhase) {
    airborneBlend = Math.min(1, state.airborneBlend + config.airborneBlendRampUp * dt);
  } else {
    airborneBlend = Math.max(0, state.airborneBlend - config.airborneBlendRampDown * dt);
  }

  // Step 5 — advance the 1D landing-squash spring toward 0 (no-op at rest).
  if (squashOffset !== 0 || squashVelocity !== 0) {
    const sprung = advanceOneDSpring(
      squashOffset,
      squashVelocity,
      0,
      config.landingSquashStiffness,
      config.landingSquashDamping,
      dt,
    );
    squashOffset = sprung.value;
    squashVelocity = sprung.velocity;
  }

  return {
    phase,
    vy,
    y,
    coyoteTimer: nextCoyote,
    jumpBufferTimer: nextBuffer,
    anticipationTimer: nextAnticipation,
    jumpHeld: inputs.jumpHeld,
    squashOffset,
    squashVelocity,
    landingTimer,
    impactVelocity,
    justLaunched,
    airborneBlend,
    scale: computeJumpScale(phase, justLaunched, squashOffset, config),
    physics: state.physics,
  };
}

/**
 * Compute the volume-preserving scale for a tick from the resolved phase, the
 * one-tick launch flag, the current squash offset, and the config. Called by
 * `advanceJump` so the result can be cached on `JumpState` (keeping
 * `evaluateJump` a pure, config-free reader).
 */
function computeJumpScale(
  phase: JumpPhase,
  justLaunched: boolean,
  squashOffset: number,
  config: JumpConfig,
): Scale2D {
  if (phase === 'anticipating') {
    return volumeScale(config.anticipationSquash - 1);
  }
  if (justLaunched) {
    return volumeScale(config.launchStretch - 1);
  }
  return volumeScale(squashOffset);
}

/**
 * Read the pose implied by a `JumpState`. Pure reader.
 *
 * The scale is the volume-preserving anticipation / launch / landing-squash
 * pair computed by `advanceJump` (which has the config) — identity (`1, 1`)
 * when at rest, the crouch during anticipation, the launch pop on the launch
 * tick, and the deep landing squash while the spring recovers.
 *
 * `airborne` is `true` only while truly ballistic (`rising` or `falling`); the
 * consumer freezes walk-phase advance while airborne and uses `airborneBlend`
 * to drive the tuck blend.
 *
 * @param state - current jump state
 * @returns a fresh `JumpPose`; never mutates `state`
 */
export function evaluateJump(state: JumpState): JumpPose {
  const airborne = state.phase === 'rising' || state.phase === 'falling';

  return {
    yOffset: state.y,
    scale: state.scale,
    airborne,
    airborneBlend: state.airborneBlend,
    impactVelocity: state.impactVelocity,
  };
}
