# API Proposal: Jump + Walk Locomotion

> Target pillar: 1 (Animation). Module: `src/animation/jump.ts`, `src/animation/locomotion.ts` extensions.
> Builds on research: `docs/research/jump-walk-locomotion.md`.
> Status: DRAFT.

## Consumer Need

The consumer game (and future consumer titles) needs characters that walk, jump, and land with satisfying game feel — without relying on external physics engines or pre-baked sprite sheets. Today, its input system already exposes `jump`, `jumpPressed`, `jumpReleased`, and `isGrounded` (see `src/config/types.ts:113`), but the library provides no jump trajectory solver, no landing squash, and no displacement-driven walk sync. Without this feature set, consumers must hand-roll all jump physics, coyote time, jump buffering, walk-phase syncing, and squash/stretch on landing — duplicating complex, error-prone code per game.

This proposal delivers a complete, deterministic, zero-dep jump + walk translation system: apex-parameterized trajectory, a state machine with coyote time and jump buffering, variable-height jumps, displacement-driven walk phase, airborne tuck blending, and landing squash with spring recovery.

---

> **Amendment (walk-cycle correction):** The foot-lift formula in `evaluateLocomotion` was corrected from `max(0, sin(phase))` to `max(0, -sin(phase))` — see `docs/design/walk-cycle-correction-decision.md`. The original `max(0, sin)` lifted the foot during the stance half (front→back), producing a moonwalk. The signed-dx contract in `advanceLocomotionByDisplacement` is unchanged, but consumers using geometry mirrors must pass local-space displacement (`dx * facing`). See the decision doc for full analysis.

---

## Approach A: Composable Separate Functions

**Source pattern:** Research §Top 3 Patterns — all three patterns as independent pure functions. Follows the existing library philosophy (`advanceLocomotion`, `evaluateLocomotion`, `advanceFootLock` are separate, composable pieces).

**Signature sketch:**

```ts
// --- NEW: src/animation/jump.ts ---

/** Apex parameterization: design-time jump tuning. */
export interface JumpConfig {
  /** Desired apex height in px. Default 48. */
  apexHeight: number;
  /** Time from launch to apex in seconds. Default 0.28. */
  timeToApex: number;
  /** Ratio applied to vy when jump is cut short (variable height). 0 = no cut, 1 = full. Default 0.4. */
  jumpCutoffFactor: number;
  /** Extra downward gravity multiplier after release while rising. Default 2.5. */
  fallMultiplier: number;
  /** Seconds of coyote time after leaving ground. Default 0.08. */
  coyoteTime: number;
  /** Seconds of jump buffering before landing. Default 0.1. */
  jumpBufferTime: number;
  /** Landing squash scale-Y at full impact. Default 0.7. */
  landingSquashMin: number;
  /** Landing squash spring stiffness (recovery speed). Default 180. */
  landingSquashStiffness: number;
  /** Landing squash spring damping. Default 12. */
  landingSquashDamping: number;
}

export const DEFAULT_JUMP: Readonly<JumpConfig> = { ... };

/** Pre-computed physics constants derived from JumpConfig. */
export interface JumpPhysics {
  /** Derived gravity in px/s². */
  readonly gravity: number;
  /** Derived launch velocity in px/s (+Y is down, so vy is negative). */
  readonly launchVelocity: number;
}

/** Discrete jump phase. */
export type JumpPhase =
  | 'grounded'
  | 'anticipating'
  | 'rising'
  | 'falling'
  | 'landing';

/** Persistent jump state (one per character). */
export interface JumpState {
  /** Current phase. */
  readonly phase: JumpPhase;
  /** Vertical velocity in px/s (+Y down). */
  readonly vy: number;
  /** Accumulated vertical offset from launch point in px. */
  readonly y: number;
  /** Coyote time remaining in seconds. */
  readonly coyoteTimer: number;
  /** Jump buffer remaining in seconds. */
  readonly jumpBufferTimer: number;
  /** Whether jump was held this tick (for variable-height). */
  readonly jumpHeld: boolean;
  /** Landing squash scaleY offset (negative = squash, recovers via spring). */
  readonly squashOffset: number;
  /** Squash spring velocity (for the 1D spring recovery). */
  readonly squashVelocity: number;
  /** Time spent in landing phase (seconds, for auto-transition). */
  readonly landingTimer: number;
  /** Pre-computed physics (derived from JumpConfig, cached for efficiency). */
  readonly physics: JumpPhysics;
  /** Airborne blend factor [0,1]: ramps up on launch at `airborneBlendRampUp` rate, ramps down on land at `airborneBlendRampDown` rate. */
  readonly airborneBlend: number;
}

/** Per-tick inputs from the consumer. Never throws. */
export interface JumpInputs {
  /** True when jump button is held. */
  readonly jumpHeld: boolean;
  /** True on the single tick the jump button was pressed. */
  readonly jumpPressed: boolean;
  /** True when the character is on solid ground. Library NEVER reads collision — this is the consumer's contract. */
  readonly isGrounded: boolean;
  /** True when the character hit a ceiling. Consumer responsibility. */
  readonly hitCeiling?: boolean;
}

/** Derive gravity and launch velocity from apex parameterization. */
export function deriveJumpPhysics(config: JumpConfig): JumpPhysics;

/** Create initial grounded jump state. */
export function createJumpState(config: JumpConfig): JumpState;

/** Advance jump state by one fixed timestep. Pure: returns new JumpState. */
export function advanceJump(state: JumpState, inputs: JumpInputs, dt: number, config: JumpConfig): JumpState;

/** Read-only pose output from jump state. */
export interface JumpPose {
  /** Vertical offset in px (negative = above launch point). */
  readonly yOffset: number;
  /** Volume-preserving scale for anticipation/squash (composes with breathe). */
  readonly scale: Scale2D;
  /** Whether the character is airborne (for locomotion tuck blend). */
  readonly airborne: boolean;
  /** Airborne blend factor [0,1]: ramps up on launch at `airborneBlendRampUp` rate, ramps down on land at `airborneBlendRampDown` rate. */
  readonly airborneBlend: number;
  /** Landing impact velocity (for consumer-side effects, e.g. screen shake). */
  readonly impactVelocity: number;
}

/** Read-only pose from jump state. Pure reader. */
export function evaluateJump(state: JumpState): JumpPose;

// --- EXTENSIONS: src/animation/locomotion.ts ---

/** Advance phase by actual horizontal displacement (anti-foot-slide). */
export function advanceLocomotionByDisplacement(
  state: LocomotionState,
  dx: number,
  config: GaitConfig,
): LocomotionState;

/** Blend walk-cycle foot offset toward airborne tuck pose. */
export function blendAirborneTuck(
  footOffset: Vec2,
  airborneBlend: number,
  config: TuckConfig,
): Vec2;

/** Tuck pose configuration. */
export interface TuckConfig {
  /** Left foot tuck offset when airborne (relative to rest). */
  readonly leftTuck: Vec2;
  /** Right foot tuck offset when airborne. */
  readonly rightTuck: Vec2;
  /** Hip raise during jump (negative = upward). */
  readonly hipRaise: number;
}

export const DEFAULT_TUCK: Readonly<TuckConfig> = { ... };
```

**Usage example (consumer per-frame loop):**

```ts
import {
  advanceJump, evaluateJump, createJumpState, DEFAULT_JUMP,
  advanceLocomotionByDisplacement, blendAirborneTuck, evaluateLocomotion, DEFAULT_TUCK,
  volumeScale,
} from 'aicraft-engine/src/animation';

let jump = createJumpState(DEFAULT_JUMP);
let loco = { phase: 0 };

function gameLoop(input, dt) {
  // 1. Consumer-side physics
  let dx = 0;
  if (input.left) dx = -speed * dt;
  if (input.right) dx = speed * dt;
  player.x += dx;
  player.y += collisionResolveY(player); // consumer owns collision
  const isGrounded = checkGrounded(player);

  // 2. Jump
  jump = advanceJump(jump, { jumpHeld: input.jump, jumpPressed: input.jumpPressed, isGrounded }, dt, DEFAULT_JUMP);
  const jumpPose = evaluateJump(jump);
  player.y += jumpPose.yOffset;

  // 3. Walk phase (displacement-driven when grounded)
  if (jumpPose.airborne) {
    // phase frozen while airborne
  } else {
    loco = advanceLocomotionByDisplacement(loco, dx, DEFAULT_GAIT);
  }

  // 4. Pose blend
  const pose = evaluateLocomotion(loco, DEFAULT_GAIT);
  const leftFoot = blendAirborneTuck(pose.leftFootOffset, jumpPose.airborneBlend, DEFAULT_TUCK);
  const rightFoot = blendAirborneTuck(pose.rightFootOffset, jumpPose.airborneBlend, DEFAULT_TUCK);

  // 5. Render (consumer draws character)
  const breath = volumeScale(0);
  const jumpScale = jumpPose.scale;
  const finalScaleX = breath.scaleX * jumpScale.scaleX;
  const finalScaleY = breath.scaleY * jumpScale.scaleY;
  drawCharacter(ctx, player.x, player.y, finalScaleX, finalScaleY, leftFoot, rightFoot);
}
```

**Trade-offs:**
- **Ergonomics:** Good. Each function is self-documenting and composable. The consumer orchestrates the loop, calling 3–4 functions per frame. Slightly more ceremony than a single unified function, but the call site is readable.
- **Determinism:** Excellent. Each function is individually testable. The consumer controls the tick order, so replay is straightforward.
- **Runtime cost:** Negligible. ~4 small pure function calls per frame. No allocations beyond fresh return objects (which the consumer can batch-reuse if needed).
- **Consumer complexity:** Moderate. The consumer must understand which functions to call and in what order, but each function has a clear contract. The per-frame loop example serves as the integration guide.
- **Tree-shake-ability:** Excellent. Each export is independently useful. A consumer that only needs jump (not walk sync) can import just `advanceJump` + `evaluateJump`.
- **Convention fit:** Perfect match with the existing `advanceLocomotion` + `evaluateLocomotion` pattern. Follows the `advance/evaluate` split already established in the pillar.

**What this makes easy:** Composing jump with any locomotion strategy (time-driven OR displacement-driven). Selective adoption (just jump, just tuck, just displacement). Testing each piece in isolation. Adding future locomotion modes without breaking jump.

**What this makes hard:** The consumer must wire 3–4 function calls per frame in the right order. New consumers need to read the usage example to understand the orchestration. There's a risk of calling `evaluateLocomotion` before `advanceLocomotionByDisplacement` (stale phase).

---

## Approach B: Unified `advanceMotion` State Machine

**Source pattern:** Research §Jump State Machines (Celeste-style) — a single state machine that owns walk + jump + air state together. One function, one state object.

**Signature sketch:**

```ts
export interface MotionConfig {
  jump: JumpConfig;
  gait: GaitConfig;
  tuck: TuckConfig;
}

export interface MotionInputs {
  readonly jumpHeld: boolean;
  readonly jumpPressed: boolean;
  readonly isGrounded: boolean;
  readonly dx: number; // horizontal displacement this tick
}

export interface MotionState {
  readonly jump: JumpState;
  readonly locomotion: LocomotionState;
  readonly airborneBlend: number;
  readonly squashOffset: number;
}

export function createMotionState(config: MotionConfig): MotionState;

export function advanceMotion(
  state: MotionState,
  inputs: MotionInputs,
  dt: number,
  config: MotionConfig,
): MotionState;

export interface MotionPose {
  readonly jumpPose: JumpPose;
  readonly locomotionPose: LocomotionPose;
  readonly leftFootOffset: Vec2;
  readonly rightFootOffset: Vec2;
}

export function evaluateMotion(state: MotionState, config: MotionConfig): MotionPose;
```

**Usage example:**

```ts
import { advanceMotion, evaluateMotion, createMotionState, DEFAULT_JUMP, DEFAULT_GAIT, DEFAULT_TUCK } from 'aicraft-engine/src/animation';

let motion = createMotionState({ jump: DEFAULT_JUMP, gait: DEFAULT_GAIT, tuck: DEFAULT_TUCK });

function gameLoop(input, dt) {
  const dx = computeHorizontalPhysics(input);
  const isGrounded = checkGrounded(player);

  motion = advanceMotion(motion, {
    jumpHeld: input.jump,
    jumpPressed: input.jumpPressed,
    isGrounded,
    dx,
  }, dt, { jump: DEFAULT_JUMP, gait: DEFAULT_GAIT, tuck: DEFAULT_TUCK });

  const pose = evaluateMotion(motion, { jump: DEFAULT_JUMP, gait: DEFAULT_GAIT, tuck: DEFAULT_TUCK });
  drawCharacter(ctx, player.x + pose.jumpPose.yOffset, player.y, pose);
}
```

**Trade-offs:**
- **Ergonomics:** Best for simple cases. One call per frame, one state object. Less to think about.
- **Determinism:** Same as A, but the single function is harder to test in isolation (must test walk+jump together).
- **Runtime cost:** Same O(1), but the single function body is larger.
- **Consumer complexity:** Lowest for simple games. But if a consumer wants displacement-driven walk for some characters and time-driven for others, they must use two different configs — or the API can't handle it.
- **Tree-shake-ability:** Poor. You can't import just the jump part without pulling in locomotion, tuck, and the motion config.
- **Convention fit:** Breaks the library's composable-pieces philosophy. The existing pillar splits `advanceLocomotion`, `evaluateLocomotion`, `advanceFootLock`, `advanceSpringChain` — all independent. A monolithic state machine is a different design language.

**What this makes easy:** Quick integration for games that use exactly this locomotion model. Fewer calls, fewer things to wire up.

**What this makes hard:** Customization. A consumer that wants jump but no walk sync can't use it without also pulling in locomotion. A consumer that wants custom air-rotation or wall-jump must extend or fork the monolith. Testing the jump state machine in isolation requires mocking the walk state. The config object grows as features are added (it's already 3 sub-configs).

---

## Approach C: Data-Driven Locomotion Graph

**Source pattern:** Research §Jump State Machines — generalized into a graph of named states with transitions and per-state pose generators, interpreted by a generic runner. Most flexible, most complex.

**Signature sketch:**

```ts
interface LocomotionNode {
  readonly id: string;
  readonly enter?: (state: MotionState, inputs: MotionInputs) => MotionState;
  readonly update?: (state: MotionState, inputs: MotionInputs, dt: number) => MotionState;
  readonly exit?: (state: MotionState) => MotionState;
}

interface Transition {
  readonly from: string;
  readonly to: string;
  readonly condition: (state: MotionState, inputs: MotionInputs) => boolean;
}

interface LocomotionGraph {
  readonly nodes: readonly LocomotionNode[];
  readonly transitions: readonly Transition[];
  readonly initialState: string;
}

function advanceLocomotionGraph(
  state: MotionState,
  inputs: MotionInputs,
  dt: number,
  graph: LocomotionGraph,
): MotionState;
```

**Usage example:**

```ts
const graph: LocomotionGraph = {
  nodes: [
    { id: 'grounded', update: groundedUpdate },
    { id: 'rising', update: risingUpdate },
    // ...
  ],
  transitions: [
    { from: 'grounded', to: 'rising', condition: (s, i) => i.jumpPressed && i.isGrounded },
    // ...
  ],
  initialState: 'grounded',
};
```

**Trade-offs:**
- **Ergonomics:** Worst. The consumer must author a graph, implement per-state updaters, and understand the generic runner's execution model.
- **Determinism:** Depends on consumer-authored updaters. The runner itself is deterministic, but bugs in user code are harder to trace.
- **Runtime cost:** Slightly higher (graph traversal per tick).
- **Consumer complexity:** Highest. Requires understanding graph theory, transition conditions, and state enter/exit semantics.
- **Tree-shake-ability:** Poor. The graph runner pulls in all node types.
- **Convention fit:** Does not match any existing pattern in the library. This is a framework, not a library primitive.

**What this makes easy:** Extreme customization. Adding a "wall-slide" or "wall-jump" state is trivial (add a node + transitions). The graph is declarative and debuggable.

**What this makes hard:** Everything else. Over-engineered for the current need. The library's existing state machines (foot-lock, spring chain) are simple and composable — this approach inverts that philosophy. Testing the graph runner requires testing the whole graph, not individual behaviors.

---

## Comparison Table

| Criterion | A: Composable | B: Unified | C: Graph |
|---|---|---|---|
| Ergonomics | Good (4 calls/frame) | Best (1 call) | Worst (graph authoring) |
| Determinism | Excellent (isolatable) | Good (monolithic test) | Depends on consumer code |
| Runtime cost | Negligible | Negligible | Slightly higher |
| Consumer complexity | Moderate | Low | High |
| Tree-shake-ability | Excellent | Poor | Poor |
| Convention fit | Perfect (matches pillar) | Breaks composable style | Framework, not primitive |
| Customization ceiling | High (compose freely) | Medium (config-driven) | Highest (graph) |
| Testability | Excellent (unit per fn) | Moderate (integration) | Hard (graph coverage) |
| Risk | Low | Medium (monolith growth) | High (over-engineering) |

---

## Recommendation

**Approach A: Composable Separate Functions.**

The library's defining architectural principle is composable, individually testable pieces: `advanceLocomotion` does phase integration, `evaluateLocomotion` does pose derivation, `advanceFootLock` does blend-weight tracking, `advanceSpringChain` does Verlet physics. Each is independently useful, independently testable, and tree-shakeable. Approach A extends this philosophy naturally: `advanceJump` handles trajectory + state machine, `evaluateJump` reads the pose, `advanceLocomotionByDisplacement` adds displacement-driven phase, `blendAirborneTuck` does the airborne blend. Each function does one thing. The consumer composes them per frame.

Approach B is tempting for its simplicity, but it couples jump and walk into a single state object, making it impossible to use jump without walk sync, and impossible to test jump in isolation. As features accumulate (wall-jump, double-jump, wall-slide), the monolith grows. Approach C is a framework masquerading as a library — it solves a problem we don't have yet and adds complexity we don't need.

The argument from trade-offs, not familiarity: Approach A has the best tree-shake-ability, the best testability, and the highest customization ceiling, while matching the library's existing design language. The "4 calls per frame" ceremony is mitigated by the ~25-line usage example, which becomes the integration guide. Consumers who find this too verbose can write their own wrapper (Approach B is easy to build on top of A; the reverse is not true).

---

## Detailed Specification

### 1. The `src/animation/jump.ts` Module

#### JumpConfig and Physics

```ts
export interface JumpConfig {
  apexHeight: number;        // px, default 48
  timeToApex: number;        // seconds, default 0.28
  jumpCutoffFactor: number;  // [0,1], default 0.4 — vy = launchVel * cutoffFactor when released
  fallMultiplier: number;    // gravity multiplier after release while rising, default 2.5
  coyoteTime: number;        // seconds, default 0.08
  jumpBufferTime: number;    // seconds, default 0.1
  landingSquashMin: number;  // scaleY at full impact, default 0.7
  landingSquashStiffness: number; // spring stiffness, default 180
  landingSquashDamping: number;   // spring damping, default 12
  anticipationDuration: number; // seconds of squash before launch, default 0.05 (~3 frames at 60fps)
  anticipationSquash: number; // scaleY during anticipation, default 0.85
  launchStretch: number;      // scaleY on launch, default 1.15
  airborneBlendRampUp: number;   // blend-units/sec toward 1.0 after launch, default 4.0 (~0.25s to full tuck)
  airborneBlendRampDown: number; // blend-units/sec toward 0.0 after landing, default 4.0 (~0.25s to release)
}
```

**Apex-parameterization math** (from research §Pattern 1, GDC 2016):
```
gravity = 2 * apexHeight / timeToApex²
launchVelocity = 2 * apexHeight / timeToApex  (negative = upward in Y-down coords)
```

#### State Machine Transitions

**Per-tick evaluation order** (must be followed exactly for deterministic boundary behavior):

1. **Decrement all timers** by `dt` (coyoteTimer, jumpBufferTimer, anticipationTimer).
2. **Evaluate input-driven transitions** (jumpPressed → launch if grounded or coyote-active; buffered jump on land).
3. **Apply physics integration** (vy += gravity*dt; yOffset += vy*dt).
4. **Update airborneBlend ramp** (see below).
5. **Update landing-squash spring** (advanceOneDSpring toward 0).

```
GROUNDED:
  if (jumpPressed || jumpBufferTimer > 0) → ANTICIPATING
  if (!isGrounded) → FALLING (coyoteTimer = config.coyoteTime)

ANTICIPATING:
  On entering ANTICIPATING: set anticipationTimer = config.anticipationDuration
  if (anticipationTimer <= 0) → RISING (launch: vy = launchVelocity, airborneBlend = 0)

RISING:
  if (hitCeiling) → FALLING (vy = 0)
  if (!jumpHeld) → clamp vy to max(vy, launchVelocity * jumpCutoffFactor), multiply gravity by fallMultiplier
  if (vy >= 0) → FALLING
  vy += gravity * dt; y += vy * dt

FALLING:
  if (isGrounded) → LANDING (capture impact velocity, set squashOffset = -landingSquashMin + 1)
  vy += gravity * dt; y += vy * dt

LANDING:
  if (squashOffset ≈ 0) → GROUNDED (auto-transition when spring settles)
  (squashOffset advances via 1D spring toward 0)
  coyoteTimer = coyoteTime (reset)
  jumpBufferTimer = 0 (consume buffer)
```

**AirborneBlend ramp** (computed every tick, after state transitions):

```
if (phase === 'rising' || phase === 'falling' || phase === 'anticipating'):
  airborneBlend = min(1, airborneBlend + airborneBlendRampUp * dt)
else:
  airborneBlend = max(0, airborneBlend - airborneBlendRampDown * dt)
```

This uses `approach()` from `src/primitives/pixel.ts` internally if desired, or a simple clamp+increment (the math is identical). The ramp is continuous and frame-rate-independent: at default ramp rate 4.0/s, full tuck (blend = 1.0) is reached in ~0.25s after launch; full release (blend = 0.0) is reached in ~0.25s after landing.

**Coyote time** (research §Pattern 2): When `isGrounded` becomes false, the state transitions to FALLING but `coyoteTimer` is set to `config.coyoteTime`. For the duration of the coyote timer, `jumpPressed` is still honored (the character can jump even though they've left the ground). The timer decrements by `dt` each tick. When it reaches 0, the grace period expires. This is the Celeste-style grace period.

**Jump buffering** (research §Pattern 2): When `jumpPressed` fires while the character is in FALLING or LANDING, `jumpBufferTimer` is set to `config.jumpBufferTime`. When the character returns to GROUNDED, the buffer is consumed and the jump fires immediately. This makes fast repeated jumps feel responsive.

**Variable-height jumps** (research §Pattern 1): When `jumpHeld` becomes `false` while in RISING, the vertical velocity is instantly clamped: `vy = Math.max(vy, launchVelocity * jumpCutoffFactor)`. Additionally, gravity is multiplied by `fallMultiplier` for the rest of the rise. This gives the player control over jump height — holding the button jumps higher, tapping it produces a short hop.

**Landing squash** (research §Pattern 4): On transition to LANDING, `squashOffset` is set proportional to impact velocity: `squashOffset = -clamp(impactVelocity / maxExpectedVelocity, 0, 1 - landingSquashMin)`. This ensures a harder fall produces a deeper squash (scaleY closer to `landingSquashMin`), while a gentle landing barely squashes at all. The offset recovers via a 1D spring (see §3 below).

#### JSDoc Contract for `advanceJump`

```ts
/**
 * Advance jump state by one fixed timestep.
 *
 * Handles the full jump lifecycle: grounded → anticipating → rising → falling → landing → grounded.
 * Manages coyote time (grace period after leaving ground), jump buffering (queued jump on landing),
 * variable-height jumps (velocity cut on button release), and landing squash recovery.
 *
 * The library NEVER reads collision or input polling. `isGrounded` and `jumpPressed` are abstract
 * flags provided by the consumer. This respects the defensive-adapter discipline: the library
 * is a pure mathematical solver, not a physics engine.
 *
 * **Determinism contract:** same (state, inputs, dt, config) → byte-identical returned state, forever.
 * No Math.random, no Date.now, no DOM reads, no global mutable state.
 *
 * Pure: returns a brand-new `JumpState`; the input is never mutated. Never throws.
 *
 * @param state - current jump state (from createJumpState or previous advanceJump)
 * @param inputs - abstract input flags (jumpHeld, jumpPressed, isGrounded, hitCeiling)
 * @param dt - fixed timestep in seconds (caller MUST keep constant for determinism)
 * @param config - jump tuning parameters
 * @returns the next JumpState
 */
export function advanceJump(state: JumpState, inputs: JumpInputs, dt: number, config: JumpConfig): JumpState
```

#### Determinism Guarantees

For `advanceJump`:
- Same `(state, inputs, dt, config)` → byte-identical `JumpState`.
- No `Math.random`. No `Date.now()`. No DOM reads. No global mutable state.
- Euler integration: `vy += gravity * dt; y += vy * dt` — pure arithmetic.
- Spring recovery: `squashOffset` advances via `advanceOneDSpring` (see §3) — pure arithmetic.
- Timers (`coyoteTimer`, `jumpBufferTimer`) decrement by `dt` — pure arithmetic.

For `evaluateJump`:
- Pure reader. Same `state` → same `JumpPose` always. No side effects.

---

### 2. Locomotion Extensions in `src/animation/locomotion.ts`

#### `advanceLocomotionByDisplacement`

**Math** (research §Walking §Walk-Translation Sync):
```
dPhase = dx / (strideLength * π)
```

This is derived from the relationship between foot displacement and phase: one full stride cycle (left foot forward → right foot forward → left foot forward) corresponds to `2 * strideLength` of horizontal movement, and the phase wraps at `2π`. So `dPhase = dx / (strideLength * π)`.

When `dx = 0` (character blocked or stopped), phase stops advancing — feet stay planted. When `dx > 0` (moving right), phase advances proportionally. This is the anti-foot-slide formula from Wolfire Games' Overgrowth devlog.

**Coexist, not replace.** The existing `advanceLocomotion(state, speed, dt, config)` is time-driven and used by the current hero (has tests, is in api-surface.md). `advanceLocomotionByDisplacement` is additive and non-breaking. Both return `LocomotionState` (same type). The consumer chooses which to use per character: time-driven for non-translating characters (idle breathing, in-place combat), displacement-driven for walking characters.

> **⚠ Double-advance foot-gun:** Do NOT call both `advanceLocomotion` and `advanceLocomotionByDisplacement` in the same tick — this double-advances the phase. Use the time-driven `advanceLocomotion` for walk-in-place characters, and the displacement-driven variant for translating characters. The choice is per-character, not per-frame.

```ts
/**
 * Advance phase by actual horizontal displacement (anti-foot-slide).
 *
 * Phase advances by `dx / (strideLength * π)`, coupling the walk cycle
 * directly to physical movement. When the character stops (`dx = 0`), the
 * phase freezes — feet stay planted. This solves the "foot sliding" problem
 * where time-driven phase doesn't match physical speed.
 *
 * Same type signature as advanceLocomotion (returns LocomotionState) so
 * consumers can switch between time-driven and displacement-driven without
 * changing their state variable type.
 *
 * **Determinism contract:** same (state, dx, config) → byte-identical result, forever.
 * Pure: returns a new LocomotionState; input is never mutated. Never throws.
 *
 * ⚠ Do not call both `advanceLocomotion` and `advanceLocomotionByDisplacement`
 * in the same tick — this double-advances the phase. Use one or the other per
 * character per tick.
 *
 * @param state - current locomotion state
 * @param dx - actual horizontal displacement this tick (positive = right, in px)
 * @param config - gait parameters (strideLength is the key input)
 * @returns the next LocomotionState with phase driven by displacement
 */
export function advanceLocomotionByDisplacement(
  state: LocomotionState,
  dx: number,
  config: GaitConfig,
): LocomotionState
```

#### `blendAirborneTuck`

Blends a walk-cycle foot offset toward the airborne tuck pose using a linear interpolation factor.

```ts
/**
 * Blend a walk-cycle foot offset toward an airborne tuck pose.
 *
 * When airborne, the character's legs should tuck up (feet drawn closer to the
 * body center) rather than continuing the walk cycle's swing. This function
 * linearly interpolates between the walk-cycle offset and the tuck offset,
 * using `airborneBlend` as the weight.
 *
 * `airborneBlend = 0` → pure walk-cycle offset (grounded).
 * `airborneBlend = 1` → pure tuck offset (fully airborne).
 *
 * **Determinism contract:** pure function of (footOffset, airborneBlend, config).
 * Same inputs → same output, forever. No side effects.
 *
 * @param footOffset - walk-cycle foot offset from evaluateLocomotion
 * @param airborneBlend - blend weight [0,1] from evaluateJump().airborneBlend
 * @param config - tuck pose configuration
 * @returns blended Vec2 offset
 */
export function blendAirborneTuck(
  footOffset: Vec2,
  airborneBlend: number,
  config: TuckConfig,
): Vec2
```

#### TuckConfig

```ts
export interface TuckConfig {
  /** Left foot tuck offset when airborne (relative to rest position). Default: {x: -2, y: -2}. */
  readonly leftTuck: Vec2;
  /** Right foot tuck offset when airborne. Default: {x: 2, y: -2}. */
  readonly rightTuck: Vec2;
  /** Hip raise amount in px (negative = upward). Default: -3. */
  readonly hipRaise: number;
}

export const DEFAULT_TUCK: Readonly<TuckConfig> = {
  leftTuck: { x: -2, y: -2 },
  rightTuck: { x: 2, y: -2 },
  hipRaise: -3,
};
```

---

### 3. The Landing-Squash Spring

**Recommendation: new 1D spring helper** (`advanceOneDSpring` in `src/animation/jump.ts` as an internal function, not public).

The existing `advanceSpringChain` is a 2D Verlet-PBD chain solver designed for hair/tails/cloaks. It solves distance constraints between chain nodes. A landing squash is a 1D scale value recovering to 0 — there's no chain, no constraints, no 2D position. Forcing the chain solver to model this would require creating a 2-node chain, pinning one end, and interpreting the node position as a scale offset — confusing and wasteful.

The recommended approach is a tiny 1D spring-damper using semi-implicit Euler integration:

```ts
// Internal to jump.ts (not exported)
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
```

**Why not exponential decay:** Exponential decay (`value *= decayFactor`) doesn't overshoot — it can't produce the bouncy "Sokpop-style" recovery where the character squashes back slightly past neutral before settling. The spring-damper gives this organic feel.

**Why not a lerp:** Lerp is frame-rate-dependent and non-deterministic under variable `dt`. Even under fixed `dt`, lerp can't overshoot (it asymptotically approaches the target).

**Why not reuse `advanceSpringChain`:** The chain solver's constraints are 2D distance constraints between nodes. A 1D spring needs no constraints, no node positions, no chain topology. The abstraction mismatch would confuse consumers reading the jump module's internals.

**Determinism:** The 1D spring uses the same semi-implicit Euler integration as the chain solver. Same `(value, velocity, target, stiffness, damping, dt)` → identical result. The `squashOffset` and `squashVelocity` are stored in `JumpState` and advanced each tick by `advanceJump`.

---

### 4. The `isGrounded` Boundary

The library receives `isGrounded: boolean` as an input flag. This is a critical architectural boundary:

**Contract:**
- `isGrounded` is a **consumer-provided boolean**, like `jumpPressed`. The library NEVER reads collision, never checks tilemaps, never touches the DOM.
- The consumer polls its own collision system (AABB, tilemap, raycast) and passes the result as `inputs.isGrounded`.
- The library treats `isGrounded` as ground truth for the current tick — it does not validate, cache, or remember previous grounded states (the jump state machine tracks its own internal grounded history via phase transitions).
- If the consumer provides `isGrounded = true` while the character is mid-jump, the library transitions to LANDING. This is a consumer bug, not a library bug — the library trusts its inputs.

**Why this boundary:** It mirrors the `InputState` pattern in the reference implementation (`src/config/types.ts:113`), where the input layer provides abstract flags and the simulation consumes them. It keeps the library deterministic (no DOM reads) and game-agnostic (no collision model assumed).

**Edge case — `hitCeiling`:** If the character hits a ceiling while rising, the consumer sets `hitCeiling = true`. The library transitions from RISING to FALLING and zeroes `vy`. This is optional (default `false`).

---

### 5. Determinism Guarantees (Summary)

| Function | Determinism Contract |
|---|---|
| `deriveJumpPhysics(config)` | Pure derivation. Same config → same physics. No side effects. |
| `createJumpState(config)` | Factory. Same config → same initial state. No side effects. |
| `advanceJump(state, inputs, dt, config)` | **Same (state, inputs, dt, config) → byte-identical returned state, forever.** No Math.random, no Date.now, no DOM, no global state. Euler integration + 1D spring. |
| `evaluateJump(state)` | Pure reader. Same state → same pose. No side effects. |
| `advanceLocomotionByDisplacement(state, dx, config)` | **Same (state, dx, config) → byte-identical phase, forever.** No Math.random, no Date.now. |
| `blendAirborneTuck(offset, blend, config)` | Pure lerp. Same inputs → same output. No side effects. |

All functions return fresh objects. Input state is never mutated. The caller MUST use a fixed `dt` for trajectory determinism (variable `dt` causes Euler integration drift — this is the caller's responsibility, matching the `advanceSpringChain` convention).

---

### 6. Test Plan (TDD)

Tests will be written FIRST (failing) before implementation, following the existing test style in `src/tests/locomotion.test.ts` and `src/tests/squash-stretch.test.ts`.

#### Jump Tests (`src/tests/jump.test.ts`)

**Golden trajectory (FIRST test — TDD, write before implementation):**
```ts
it('golden trajectory matches pre-computed array (fixed inputs → fixed outputs)', () => {
  // Style template: src/tests/locomotion.test.ts lines 56-75
  const dt = 1 / 60;
  let state = createJumpState(DEFAULT_JUMP);

  // Record yOffset and phase at each tick for 120 ticks:
  // tick 0: jumpPressed=true, isGrounded=true
  // ticks 1-119: jumpHeld=true, isGrounded=false (after tick ~1)
  const golden: Array<{ yOffset: number; phase: string }> = [];

  for (let tick = 0; tick < 120; tick++) {
    const inputs: JumpInputs = {
      jumpPressed: tick === 0,
      jumpHeld: tick < 120,
      isGrounded: tick === 0,
    };
    state = advanceJump(state, inputs, dt, DEFAULT_JUMP);
    const pose = evaluateJump(state);
    golden.push({ yOffset: roundTo(pose.yOffset, 6), phase: state.phase });
  }

  // Record golden on first run; assert against it thereafter.
  // Any code change that perturbs the array fails the test.
  expect(golden).toMatchSnapshot();
});
```
The `roundTo` helper prevents brittle float comparison; the snapshot is the source of truth. Reference: `src/tests/locomotion.test.ts` lines 56-75 (cumulative integral pattern).

**Apex height:**
- Jump from grounded, hold button for full height, verify apex y-offset matches `apexHeight` within tolerance.
- Verify total air time matches `2 * timeToApex` (symmetric trajectory).

**Symmetry:**
- A jump with no horizontal movement must have symmetric rise and fall: `y(t) === y(2T - t)` for `t ∈ [0, 2T]`.

**Coyote time:**
- Walk off ledge (isGrounded → false), jump within coyote window → jump fires.
- Walk off ledge, wait past coyote window → jump is rejected.

**Jump buffering:**
- Press jump while falling, land → jump fires on the landing tick.
- Press jump while falling, wait past buffer → buffer expires, no jump on landing.

**Variable height:**
- Full hold → apex at `apexHeight`.
- Release at 75% of rise time (t = 0.75 * timeToApex) → apex at `0.9375 * apexHeight` (analytically derivable: release height = 0.75² * apexHeight = 0.5625H, remaining climb from v₀/2 = H/4, total = 0.5625H + 0.25H = 0.8125H... verify with snapshot).
- Tap (immediate release) → short hop (apex < 0.1 * apexHeight).

**Landing squash:**
- Hard fall (high vy on landing) → deep squash (squashOffset closer to `landingSquashMin`).
- Gentle landing (low vy) → shallow squash.
- Squash recovers via spring to 0 within configurable time.

**Anticipation:**
- Verify that during ANTICIPATING phase, scaleY is at `anticipationSquash` value.
- Verify transition from ANTICIPATING to RISING after `anticipationDuration` seconds.

**AirborneBlend ramp:**
- `airborneBlend` ramps 0→1 over `1/airborneBlendRampUp` seconds after launch (check at 0s, mid, full).
- `airborneBlend` ramps 1→0 over `1/airborneBlendRampDown` seconds after landing (check at 0s, mid, full).
- Blend is clamped to [0, 1] at all times (never overshoots).

**Tick-boundary coyote tests:**
- `coyoteTimer === dt` at tick start, `jumpPressed=true` same tick → jump fires (timer was > 0 before decrement).
- `coyoteTimer === 0` at tick start, `jumpPressed=true` same tick → jump does NOT fire.

**Tick-boundary buffer tests:**
- `jumpBufferTimer === dt` at tick start, landing same tick → buffered jump fires (timer was > 0 before decrement).
- `jumpBufferTimer === 0` at tick start, landing same tick → buffered jump does NOT fire.

**Ceiling hit:**
- While rising, `hitCeiling = true` → transition to FALLING, vy = 0.

**Determinism:**
- Run advanceJump 1000 times with identical inputs → byte-identical final state.
- No Math.random / Date.now in the function body (source inspection test).

**No mutation:**
- advanceJump returns a new object; input state is unchanged.

#### Locomotion Extension Tests (`src/tests/locomotion.test.ts` additions)

**Displacement phase:**
- `advanceLocomotionByDisplacement(state, 4, config)` advances phase by `4 / (strideLength * π)`.
- `dx = 0` → phase unchanged (feet planted).
- Displacement of `strideLength * π` → phase advances by exactly 1.0 radian.
- Accumulated displacement matches cumulative single-tick calls.

**Anti-foot-slide invariant:**
- For any `dx`, the foot's x-offset from `evaluateLocomotion` is proportional to the total displacement (no drift).

**Tuck blend:**
- `blendAirborneTuck(offset, 0, config)` → returns original offset (no change).
- `blendAirborneTuck(offset, 1, config)` → returns tuck offset.
- `blendAirborneTuck(offset, 0.5, config)` → returns midpoint.

**Coexistence:**
- `advanceLocomotion` and `advanceLocomotionByDisplacement` both return `LocomotionState` and can be used interchangeably (type compatibility).

#### Integration Tests (`src/tests/jump-integration.test.ts`)

**Full loop:**
- Simulate 120 frames: grounded walk → jump press → rise → fall → land → walk resumes.
- Verify phase freezes during air, resumes on landing.
- Verify squash offset peaks on landing, recovers to 0.

---

### 7. Consumer Usage Example (~25 lines)

This becomes the README / api-surface example:

```ts
import {
  createJumpState, advanceJump, evaluateJump, DEFAULT_JUMP,
  advanceLocomotionByDisplacement, blendAirborneTuck,
  evaluateLocomotion, DEFAULT_GAIT, DEFAULT_TUCK,
  volumeScale,
} from 'aicraft-engine/src/animation';

// One-time init
let jump = createJumpState(DEFAULT_JUMP);
let loco = { phase: 0 };

function gameTick(input: InputState, dt: number) {
  // Consumer-side: horizontal physics + collision
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const displacement = dx * speed * dt;
  player.x += displacement;
  const isGrounded = resolveCollisionY(player); // consumer owns this

  // Jump trajectory + state machine
  jump = advanceJump(jump, {
    jumpHeld: input.jump,
    jumpPressed: input.jumpPressed,
    isGrounded,
  }, dt, DEFAULT_JUMP);
  const jumpPose = evaluateJump(jump);

  // Walk phase (displacement-driven when grounded, frozen when airborne)
  if (!jumpPose.airborne) {
    loco = advanceLocomotionByDisplacement(loco, displacement, DEFAULT_GAIT);
  }

  // Pose: walk offsets + airborne tuck blend
  const pose = evaluateLocomotion(loco, DEFAULT_GAIT);
  const leftFoot = blendAirborneTuck(pose.leftFootOffset, jumpPose.airborneBlend, DEFAULT_TUCK);
  const rightFoot = blendAirborneTuck(pose.rightFootOffset, jumpPose.airborneBlend, DEFAULT_TUCK);

  // Render: compose breathing + jump squash into final scale
  const finalScale = volumeScale(0); // breathing disabled for brevity
  drawCharacter(ctx, player.x, player.y + jumpPose.yOffset,
    finalScale.scaleX * jumpPose.scale.scaleX,
    finalScale.scaleY * jumpPose.scale.scaleY,
    leftFoot, rightFoot,
  );
}
```

---

### 8. Open Questions for @architect — RESOLVED

All four questions answered by the architect in the revision round:

1. **Landing-squash spring:** Keep internal. `squashOffset` + `squashVelocity` live in `JumpState`, advanced by `advanceJump`. (Not a separate consumer call.)
2. **Squash/spring constants in JumpConfig:** Keep in JumpConfig. Unified config is simpler; the 14-field object is manageable.
3. **Anticipation phase:** Distinct `anticipating` state with `anticipationDuration` timer. More explicit, more testable.
4. **AirborneBlend:** Continuous float [0,1] stored in JumpState, ramped via configurable `airborneBlendRampUp` / `airborneBlendRampDown` rates (blend-units/sec). Self-contained, frame-rate-independent.

---

## New Exports Summary (Approach A)

**JSDoc requirement:** All public exports MUST have full JSDoc blocks before shipping. Interfaces need `@` contract docs (what the field means, valid ranges). Functions need `@param`, `@returns`, determinism contract, and usage examples. Match the quality of the existing `advanceJump` JSDoc block (§1 of the detailed spec). The coder must not ship without it.

### `src/animation/jump.ts` (new file)

| Export | Kind |
|---|---|
| `JumpConfig` | type |
| `DEFAULT_JUMP` | const |
| `JumpPhysics` | type |
| `JumpPhase` | type |
| `JumpState` | type |
| `JumpInputs` | type |
| `JumpPose` | type |
| `createJumpState(config)` | function |
| `advanceJump(state, inputs, dt, config)` | function |
| `evaluateJump(state)` | function |

> **Note:** `deriveJumpPhysics(config)` is an internal helper used by `createJumpState`. It is NOT exported publicly — consumers read derived physics via `state.physics`. See Advisory 7.

### `src/animation/locomotion.ts` (extensions, additive)

| Export | Kind |
|---|---|
| `TuckConfig` | type |
| `DEFAULT_TUCK` | const |
| `advanceLocomotionByDisplacement(state, dx, config)` | function |
| `blendAirborneTuck(footOffset, airborneBlend, config)` | function |

**Total new public exports: 14** (10 from jump.ts + 4 from locomotion.ts extensions).

**All additive.** No existing exports are modified. The existing `advanceLocomotion`, `evaluateLocomotion`, `scaledGait`, `DEFAULT_GAIT`, `LocomotionState`, `GaitConfig`, `LocomotionPose` remain unchanged. Locomotion extensions are purely additive — consumers can adopt displacement-driven walk incrementally.
