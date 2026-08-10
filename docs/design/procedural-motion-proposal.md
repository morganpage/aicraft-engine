# API Proposal: Procedural Motion

> Target pillar: 1 (Primitives / Animation). Module: `src/animation/`.
> Builds on research: `docs/research/procedural-locomotion.md`.
> Status: DRAFT.

## Consumer Need

The consumer game currently hand-codes procedural motion inline in its renderer:
- **Idle bob**: `Math.round(Math.sin(tick * 0.15))` hardcoded in `sprites.ts:1111`
- **Squash/stretch**: `sx = 0.92; sy = 1.1` hardcoded per state in `sprites.ts:1114-1123`
- **Key collectible bob**: `Math.round(Math.sin(tick * 0.1) * 2)` hardcoded in `sprites.ts:1209`
- **Reduced motion**: Checked at every call site via a passed-in boolean

This works for one character but doesn't scale: every new character re-implements the same sine math, every new motion type needs a new hardcoded branch, and there's no composable secondary-dynamics layer for hair/tails/cloaks.

The procedural motion module provides:
1. **Trigonometric locomotion**: Phase-accumulator walk/run cycles that smoothly adapt to variable speed with zero phase-jump glitches.
2. **Squash & stretch**: Volume-preserving scale transforms for breathing, jumping, landing, and turning.
3. **Spring chain (Verlet-PBD)**: Physics-based secondary dynamics for hair, tails, cloaks, antennae.

All three are pure functions of tick/state/config — deterministic, zero-dependency, composable with the skeletal rig proposed by the sibling proposal.

---

## Shared Foundation Assumptions

Per the task contract, these types are defined by the skeletal-rigging proposal in `src/animation/types.ts` and are NOT redefined here:

- `Vec2` — `{x: number; y: number}`
- `AffineTransform` — 2×3 matrix tuple
- `BonePose` — local TRS
- `Rig` — live rig instance with mutable localPoses

Locomotion and springs work **standalone** (produce `Vec2` offsets as pure values) but can optionally write into `Rig.localPoses` when the consumer uses the skeletal rig.

### Proposed Shared-Type Addition

The spring module needs a `VerletNode` type. This is spring-specific, not a general animation primitive, so it lives in `src/animation/spring.ts` alongside the implementation — it is NOT hoisted to `types.ts`.

---

## Sub-Module 1: Trigonometric Locomotion

**File:** `src/animation/locomotion.ts`
**Research:** `docs/research/procedural-locomotion.md` §Pattern 1

### Consumer Need

the reference `drawDevil` hand-codes a bob via `Math.sin(tick * 0.15)`. This doesn't adapt to speed, doesn't produce foot offsets, and can't drive a rig. A locomotion system produces smooth hip/foot offsets from a phase accumulator, enabling:
- Walk/run cycles that scale frequency and amplitude with velocity
- Idle→walk→run transitions with no phase-jump glitches (phase integrates continuously)
- Per-character gait variation via `GaitConfig` (troll vs spider vs slime)

### Approach A: Pure advance+evaluate split (RECOMMENDED)

**Source pattern:** `src/particles/advance.ts` — state progression is separate from pose generation. The research note recommends exactly this: `advanceLocomotion` integrates phase, `evaluateLocomotion` computes offsets from phase.

**Signature sketch:**

```ts
// In src/animation/locomotion.ts

/** Phase accumulator state. One per character. */
export interface LocomotionState {
  /** Accumulated phase in radians [0, 2π). Driven by speed over time. */
  readonly phase: number;
}

/** Per-character gait parameters. All tunable; no magic numbers. */
export interface GaitConfig {
  /** Cycles per unit of speed per tick. Default: 0.05 */
  baseFrequency: number;
  /** Horizontal foot amplitude in px. Default: 4 */
  strideLength: number;
  /** Vertical foot lift amplitude in px. Default: 3 */
  strideHeight: number;
  /** Hip vertical bob amplitude in px. Default: 2 */
  hipBobHeight: number;
  /** Hip horizontal sway amplitude in px. Default: 1 */
  hipSwayWidth: number;
}

/** Default gait config matching the reference implementation's devil character scale. */
export const DEFAULT_GAIT: Readonly<GaitConfig>;

/** Character pose offsets relative to root. */
export interface LocomotionPose {
  readonly hipOffset: Readonly<Vec2>;
  readonly leftFootOffset: Readonly<Vec2>;
  readonly rightFootOffset: Readonly<Vec2>;
}

/**
 * Pure state progression. Advances the phase accumulator by
 * `speed * config.baseFrequency * 2π * dt`. Phase wraps at 2π
 * to prevent floating-point drift at large tick values.
 *
 * @returns a new LocomotionState (pure-clone per particles pattern)
 */
export function advanceLocomotion(
  state: LocomotionState,
  speed: number,
  dt: number,
  config: GaitConfig,
): LocomotionState;

/**
 * Pure pose generator. Computes hip/foot offsets from the current
 * phase. Output is a pure function of (phase, config) — no state
 * mutation, no side effects.
 */
export function evaluateLocomotion(
  state: LocomotionState,
  config: GaitConfig,
): LocomotionPose;
```

**Usage example:**

```ts
import {
  advanceLocomotion, evaluateLocomotion,
  type LocomotionState, type GaitConfig, DEFAULT_GAIT,
} from 'aicraft-engine/src/animation/locomotion';

// Per-character state (persisted across frames)
let locoState: LocomotionState = { phase: 0 };

// Per-frame (in game loop)
function updatePlayer(dt: number, speed: number, reduceMotion: boolean) {
  const freqScale = reduceMotion ? 0.2 : 1.0;
  const config = { ...DEFAULT_GAIT, baseFrequency: DEFAULT_GAIT.baseFrequency * freqScale };

  locoState = advanceLocomotion(locoState, speed, dt, config);
  const pose = evaluateLocomotion(locoState, config);

  // Apply to drawing:
  ctx.translate(player.x + pose.hipOffset.x, player.y + pose.hipOffset.y);
  // ... draw feet at pose.leftFootOffset, pose.rightFootOffset
}
```

**Trade-offs:**
- **Ergonomics:** Two-function call per frame. Clear separation of "advance time" vs "read pose." Consumer must track `LocomotionState` reference. Slightly more ceremony than a single `getBob(tick)` call, but far more powerful.
- **Determinism:** Maximum. Phase integration is a simple additive accumulator. No trig in the advance step. `evaluateLocomotion` is pure sin/cos — identical across all IEEE 754 platforms.
- **Runtime cost:** ~2 μs per call (advance: 1 multiply + modulo; evaluate: ~6 trig calls). Negligible.
- **Consumer complexity:** Low. Two calls, one state variable. The pattern is identical to `particles/advance()` + `particles/cull()`.
- **Tree-shake-ability:** Each function is independently importable. Consumer can import only `advanceLocomotion` if they evaluate pose differently.

**What this makes easy:** Smooth speed transitions, composable gait configs, rig integration (offsets map to bone poses), reduced-motion scaling via config.
**What this makes hard:** Consumer must manage the state reference. Simple use cases (one-off bob for a collectible) still need the full advance+evaluate machinery.

### Approach B: Single evaluateLocomotion(tick, speed, config) — no state

**Source pattern:** Current the reference implementation inline `Math.sin(tick * 0.15)` — direct function of tick.

**Signature sketch:**

```ts
/**
 * Compute locomotion pose directly from tick. No state management.
 * Phase is derived from tick × speed — simple but causes phase jumps
 * when speed changes.
 */
export function evaluateLocomotion(
  tick: number,
  speed: number,
  config: GaitConfig,
): LocomotionPose;
```

**Usage example:**

```ts
import { evaluateLocomotion, DEFAULT_GAIT } from 'aicraft-engine/src/animation/locomotion';

// In render loop — no state to manage
const pose = evaluateLocomotion(tick, player.speed, DEFAULT_GAIT);
ctx.translate(player.x + pose.hipOffset.x, player.y + pose.hipOffset.y);
```

**Trade-offs:**
- **Ergonomics:** Single call, no state. Dead simple. Matches current the reference implementation pattern exactly.
- **Determinism:** Phase jumps when speed changes. If speed goes from 0→5 in one frame, phase jumps by `5 * freq * 2π` — causing a visible glitch (character snaps to mid-stride). This is the exact problem the research note warns against.
- **Runtime cost:** Same as A (~2 μs).
- **Consumer complexity:** Lowest. No state variable.
- **Tree-shake-ability:** Single function, trivially tree-shakeable.

**What this makes easy:** Drop-in replacement for the reference implementation's inline `Math.sin(tick * 0.15)`.
**What this makes hard:** Variable-speed locomotion is broken (phase jumps). Walk→run transitions will glitch.

### Approach C: Stateful locomotion object

**Source pattern:** the reference `PlayerState` — an object that owns mutable state and advances itself.

**Signature sketch:**

```ts
export class Locomotion {
  private phase: number = 0;

  constructor(private config: GaitConfig) {}

  /** Advance phase and return pose in one call. */
  step(speed: number, dt: number): LocomotionPose {
    this.phase = (this.phase + speed * this.config.baseFrequency * Math.PI * 2 * dt) % (Math.PI * 2);
    return evaluatePhase(this.phase, this.config);
  }

  /** Reset to idle. */
  reset(): void { this.phase = 0; }
}
```

**Trade-offs:**
- **Ergonomics:** Single `.step()` call. Encapsulated state. Familiar OOP pattern.
- **Determinism:** Same as A — phase integration is sound. But the class is mutable state, which conflicts with the pure-progression-ops pattern. Snapshotting for replays requires extracting `.phase` manually.
- **Runtime cost:** Same as A (~2 μs).
- **Consumer complexity:** Medium. Consumer manages an object instance, not a plain state record. TypeScript generics/type inference work well with classes.
- **Tree-shake-ability:** The entire class is one unit. Can't tree-shake `advance` from `evaluate`.

**What this makes easy:** Single-object management. Familiar to OOP-oriented consumers.
**What this makes hard:** Pure-clone pattern doesn't compose naturally. Snapshot/replay requires manual extraction. Conflicts with the library's functional style (all existing exports are functions, not classes).

### Comparison Table

| Criterion | A: advance+evaluate | B: single fn, no state | C: class |
|---|---|---|---|
| Ergonomics | Medium (2 calls) | High (1 call, no state) | High (1 call) |
| Determinism | Maximum | Broken on speed change | Maximum |
| Runtime cost | ~2 μs | ~2 μs | ~2 μs |
| Convention fit | Matches particles exactly | Matches current the reference implementation | Conflicts (classes) |
| Speed transitions | Smooth | Glitchy | Smooth |
| Replay snapshot | Phase is a plain number | N/A (no state) | Must extract .phase |
| Tree-shake | Excellent | Excellent | Poor (whole class) |

### Recommendation

**Approach A: Pure advance+evaluate split.** It matches the particles module pattern exactly (`advance` → `evaluate`), guarantees smooth speed transitions via phase integration, produces a plain-number state that's trivial to snapshot for replays, and tree-shakes perfectly. The two-call ceremony is a small cost for a large correctness win.

---

## Sub-Module 2: Squash & Stretch

**File:** `src/animation/squash-stretch.ts`
**Research:** `docs/research/procedural-locomotion.md` §Pattern 2

### Consumer Need

The consumer game hand-codes squash/stretch per state in `sprites.ts:1114-1123`:
```ts
if (player.state === 'jumping') { sx = 0.92; sy = 1.1; }
else if (player.state === 'falling') { sx = 1.08; sy = 0.92; }
```

This doesn't preserve volume (92×110 = 101.2, not 100), doesn't breathe, and doesn't compose. A proper squash/stretch module provides:
- Volume-preserving scale from a single `deltaY` parameter
- Ambient breathing oscillation
- Orthographic turning (Sokpop-style faked depth)
- Composable with the rig's bone scale

### Approach A: Pure functions returning scale records (RECOMMENDED)

**Source pattern:** Research note §Pattern 2 — `getVolumePreservingScale(deltaY)`, `evaluateBreathing(tick, speed, amplitude)`.

**Signature sketch:**

```ts
// In src/animation/squash-stretch.ts

/** Scale pair for volume-preserving transforms. */
export interface Scale2D {
  readonly scaleX: number;
  readonly scaleY: number;
}

/** Breathing configuration. All tunable; no magic numbers. */
export interface BreathConfig {
  /** Breathing cycles per tick. Default: 0.03 */
  frequency: number;
  /** Peak vertical stretch amplitude. Default: 0.05 */
  amplitude: number;
}

/** Default breathing config for idle animation. */
export const DEFAULT_BREATH: Readonly<BreathConfig>;

/**
 * Volume-preserving scale from a vertical delta.
 * Ensures scaleX × scaleY = 1 (area invariant).
 * Clamps scaleY to [0.05, 3.0] to prevent inversion or blow-up.
 *
 * @param deltaY - vertical scale offset (0.1 = 10% stretch, -0.1 = 10% squash)
 * @returns scale pair where scaleX = 1/safeScaleY
 */
export function volumeScale(deltaY: number): Scale2D;

/**
 * Ambient breathing oscillation. Returns a volume-preserving scale
 * that oscillates sinusoidally — suitable for idle "breathing" on
 * any drawn shape.
 *
 * @param tick - current tick (deterministic time input)
 * @param config - breathing parameters
 * @returns Scale2D to apply via ctx.scale(sx, sy)
 */
export function breathe(tick: number, config: BreathConfig): Scale2D;

/**
 * Orthographic turning projection (Sokpop-style faked depth).
 * Squashes a part horizontally based on facing angle and offsets
 * child elements to simulate 3D rotation.
 *
 * @param localX - local X offset of child element
 * @param localY - local Y offset of child element
 * @param facingAngle - 0 = front, π/2 = right profile
 * @returns projected position and scale
 */
export function projectTurnedPart(
  localX: number,
  localY: number,
  facingAngle: number,
): { readonly x: number; readonly y: number; readonly sx: number; readonly sy: number };
```

**Usage example:**

```ts
import { volumeScale, breathe, DEFAULT_BREATH } from 'aicraft-engine/src/animation/squash-stretch';

// Breathing idle
const breathScale = breathe(tick, DEFAULT_BREATH);

// Jump squash/stretch (manual)
const jumpScale = volumeScale(-0.08); // stretch vertically

// Apply
ctx.save();
ctx.translate(cx, cy);
ctx.scale(breathScale.scaleX * jumpScale.scaleX, breathScale.scaleY * jumpScale.scaleY);
// ... draw character
ctx.restore();
```

**Trade-offs:**
- **Ergonomics:** Three standalone functions. `volumeScale(d)` is a one-liner. `breathe(tick, config)` replaces the inline `Math.sin` pattern. `projectTurnedPart` enables Sokpop-style fake-3D.
- **Determinism:** Pure functions of inputs. `breathe` is a single sin call — fully deterministic.
- **Runtime cost:** Negligible (~1 μs per call). One sin, one division.
- **Consumer complexity:** Low. Consumer composes scale values manually — maximum flexibility, zero hidden state.
- **Tree-shake-ability:** Each function is independently importable. `projectTurnedPart` doesn't pull in `breathe`.

**What this makes easy:** Volume-preserving squash for jumps/landings, ambient breathing, Sokpop-style turning. Composable with rig bone scales.
**What this makes hard:** Consumer must compose multiple scale effects manually (e.g., breathing × jump squash × turning). No single "apply all" function.

### Approach B: Unified `squashStretch(tick, state, config)` returning a composed transform

**Source pattern:** the reference `drawDevil` — one code path applies all transforms at once.

**Signature sketch:**

```ts
export interface SquashStretchConfig {
  breath: BreathConfig;
  /** Current vertical delta from gameplay (e.g., -0.08 during jump). Default: 0 */
  gameplayDeltaY: number;
  /** Current facing angle for orthographic turning. Default: 0 */
  facingAngle: number;
}

/**
 * Compute a composed scale+offset transform from all squash/stretch
 * influences in a single call.
 */
export function squashStretch(
  tick: number,
  config: SquashStretchConfig,
): { sx: number; sy: number; offsetX: number; offsetY: number };
```

**Trade-offs:**
- **Ergonomics:** Single call, single result. No manual composition.
- **Determinism:** Same as A.
- **Runtime cost:** Same as A (~2 μs).
- **Consumer complexity:** Lower than A — one call handles everything. But the consumer loses fine-grained control: they can't apply breathing to one bone and jump-squash to another independently.
- **Tree-shake-ability:** All three sub-effects are bundled. Can't import just `breathe`.

**What this makes easy:** Simple use cases — one character, one call.
**What this makes hard:** Per-bone composition. Multi-character with different configs. Testing individual effects.

### Comparison Table

| Criterion | A: Pure functions | B: Unified transform |
|---|---|---|
| Ergonomics | Medium (compose manually) | High (single call) |
| Determinism | Maximum | Maximum |
| Runtime cost | ~1 μs/call | ~2 μs/call |
| Per-bone composition | Easy | Hard |
| Tree-shake | Excellent | Poor (bundled) |
| Convention fit | Matches library style | Matches the reference implementation style |

### Recommendation

**Approach A: Pure functions.** The library's convention is small, composable functions (not monolithic helpers). Per-bone composition is the primary use case — breathing on the torso, jump-squash on the legs, turning on the arms. A unified function would force the consumer to decompose it again.

---

## Sub-Module 3: Spring Chain (Verlet-PBD)

**File:** `src/animation/spring.ts`
**Research:** `docs/research/procedural-locomotion.md` §Pattern 3

### Consumer Need

No current the reference implementation use case — this is forward-looking for:
- Hair/cloak/tail secondary dynamics on characters
- Antenna/flag physics on enemies
- Rope/chain rendering in puzzles

The spring chain must follow the pure-progression-ops pattern exactly: `advanceSpringChain(state, ..., dt, config) → newState` — immutable in, cloned out, never throws.

### Approach A: Pure advance function, caller owns fixed-timestep (RECOMMENDED)

**Source pattern:** `src/particles/advance.ts` — single `advance(particles, dt, opts)` call. The particles module does NOT do fixed-timestep internally; the consumer wraps it. This is the established pattern.

**Signature sketch:**

```ts
// In src/animation/spring.ts

/** A single node in the Verlet chain. */
export interface VerletNode {
  /** Current position X. */
  x: number;
  /** Current position Y. */
  y: number;
  /** Previous position X (for implicit velocity). */
  prevX: number;
  /** Previous position Y (for implicit velocity). */
  prevY: number;
}

/** Spring chain configuration. All tunable; no magic numbers. */
export interface SpringConfig {
  /** Rest distance between adjacent nodes in px. Default: 4 */
  segmentLength: number;
  /** Gravity X component in px/tick². Default: 0 */
  gravityX: number;
  /** Gravity Y component in px/tick². Default: 0.5 */
  gravityY: number;
  /** Velocity damping per tick. 1 = no drag, 0.9 = 10% energy loss. Default: 0.95 */
  drag: number;
  /** Constraint solver iterations per step. 1–3 typical. Default: 2 */
  constraintIterations: number;
}

/** Default config for a hanging tail/hair chain. */
export const DEFAULT_SPRING: Readonly<SpringConfig>;

/**
 * Advance a Verlet spring chain by one fixed timestep. Pure: returns
 * a new array of new VerletNode objects; the input is not mutated.
 *
 * **Determinism contract:** The caller MUST call this function with a
 * fixed `dt` value (e.g., always `1` at 60Hz, or always `1/60` at
 * 60Hz — consistency matters, not the absolute value). Variable `dt`
 * causes Verlet velocity drift and non-deterministic results.
 *
 * Physics order per step:
 *   1. Pin root node to anchor (infinite mass).
 *   2. Verlet integration: apply implicit velocity + gravity.
 *   3. Satisfy distance constraints (PBD).
 *
 * @param nodes - current chain state (read-only; a new array is returned)
 * @param anchorX - world X of the parent attachment point
 * @param anchorY - world Y of the parent attachment point
 * @param dt - fixed timestep (caller must ensure this is constant)
 * @param config - spring parameters
 * @returns new array of VerletNodes (input is not mutated)
 */
export function advanceSpringChain(
  nodes: readonly VerletNode[],
  anchorX: number,
  anchorY: number,
  dt: number,
  config: SpringConfig,
): VerletNode[];

/**
 * Create an initial straight chain of VerletNodes hanging downward
 * from an anchor point. Useful for initialization.
 *
 * @param count - number of nodes (including anchor node at index 0)
 * @param anchorX - world X of the anchor
 * @param anchorY - world Y of the anchor
 * @param segmentLength - distance between nodes
 * @returns array of VerletNodes in a straight vertical line
 */
export function createSpringChain(
  count: number,
  anchorX: number,
  anchorY: number,
  segmentLength: number,
): VerletNode[];
```

**Usage example:**

```ts
import {
  advanceSpringChain, createSpringChain,
  type VerletNode, DEFAULT_SPRING,
} from 'aicraft-engine/src/animation/spring';

// Initialize (once)
let tailNodes = createSpringChain(6, player.x, player.y, 4);

// Per-frame: caller owns the fixed-timestep accumulator
let accumulator = 0;
const FIXED_DT = 1; // Always 1 — the contract

function gameTick(frameDt: number) {
  accumulator += frameDt;
  while (accumulator >= FIXED_DT) {
    tailNodes = advanceSpringChain(
      tailNodes,
      player.x + 8,  // tail attachment point
      player.y + 12,
      FIXED_DT,
      DEFAULT_SPRING,
    );
    accumulator -= FIXED_DT;
  }

  // Render from tailNodes positions
  for (const node of tailNodes) {
    ctx.fillRect(Math.floor(node.x), Math.floor(node.y), 2, 2);
  }
}
```

**Trade-offs:**
- **Ergonomics:** Matches `particles/advance` exactly. Consumer who already uses particles knows this pattern. But the consumer MUST implement their own fixed-timestep accumulator — this is extra boilerplate for simple use cases.
- **Determinism:** Maximum when caller follows the contract. Verlet with fixed `dt` is unconditionally stable and deterministic across platforms. The research note explicitly recommends this: "the library should provide the pure `advanceSpringChain` assuming a fixed `dt`."
- **Runtime cost:** O(N × I) where N = chain length, I = constraint iterations. For a 6-node tail with 2 iterations: ~24 operations + 6 sqrts per call. Negligible.
- **Consumer complexity:** Medium. Consumer must manage the accumulator. But this is a well-understood game-dev pattern (fixed-timestep update loop).
- **Tree-shake-ability:** `advanceSpringChain` and `createSpringChain` are independently importable.

**What this makes easy:** Deterministic physics, composable with any game loop, pure-progression-ops discipline.
**What this makes hard:** Simple use cases (one-off spring for a UI element) need accumulator boilerplate.

### Approach B: Library sub-steps internally

**Source pattern:** Physics engines that own their timestep (Box2D, Matter.js).

**Signature sketch:**

```ts
/**
 * Advance a spring chain, sub-stepping internally to maintain
 * a fixed physics timestep regardless of the caller's dt.
 *
 * @param nodes - current chain state
 * @param anchorX - anchor world X
 * @param anchorY - anchor world Y
 * @param elapsedDt - caller's actual frame dt (may vary)
 * @param config - spring parameters + physicsTickRate
 * @returns new VerletNode[] array
 */
export function advanceSpringChain(
  nodes: readonly VerletNode[],
  anchorX: number,
  anchorY: number,
  elapsedDt: number,
  config: SpringConfig & { physicsTickRate: number },
): VerletNode[];
```

The library accumulates `elapsedDt` internally and runs fixed-step sub-updates.

**Trade-offs:**
- **Ergonomics:** Consumer just passes their frame dt. No accumulator needed. Simplest possible API.
- **Determinism:** Same as A when `physicsTickRate` is constant. But the internal accumulator is hidden state — the consumer can't inspect or reset it. If the consumer's dt fluctuates wildly, the library may run 0 or N sub-steps per call, making CPU cost unpredictable.
- **Runtime cost:** Same per-step cost, but the TOTAL cost per call varies with dt. A 200ms frame spike could trigger 12+ sub-steps at 60Hz.
- **Consumer complexity:** Lowest. Single call, no state management.
- **Tree-shake-ability:** Same as A.

**What this makes easy:** Drop-in usage. No accumulator management.
**What this makes hard:** Hidden sub-step count makes profiling harder. Consumer can't reset the accumulator. Duplicates the fixed-timestep pattern the consumer likely already has.

### Comparison Table

| Criterion | A: Caller owns dt | B: Library sub-steps |
|---|---|---|
| Ergonomics | Medium (accumulator needed) | High (pass frame dt) |
| Determinism | Maximum (caller controls) | Maximum (library controls) |
| Runtime cost | Predictable (fixed per call) | Variable (depends on dt spikes) |
| Consumer complexity | Medium | Low |
| Convention fit | Matches particles exactly | Matches physics engines (foreign) |
| CPU predictability | Guaranteed fixed cost | Bursty on frame spikes |

### Recommendation

**Approach A: Caller owns fixed-timestep.** Three reasons:
1. **Convention consistency.** `particles/advance.ts` uses the same pattern — single `advance(state, dt, config)` with the consumer managing dt. Having two different dt-handling patterns in the same library would confuse consumers.
2. **Transparency.** The consumer can see exactly how many sub-steps happen, profile them, and budget CPU accordingly. Hidden sub-steps are a debugging nightmare.
3. **Research recommendation.** The research note explicitly says: "the library should provide the pure `advanceSpringChain` assuming a fixed `dt`, and document that the caller must run it within a fixed-timestep loop."

---

## Reduced-Motion Strategy

**Research recommendation:** Locomotion/breathing amplitudes scale to 0.2×; screen shake disabled.

**Three options considered:**

### Option A: Auto-apply via `prefersReducedMotion()`

The library calls `prefersReducedMotion()` internally and dampens automatically.

**Rejected.** This couples the deterministic core to a host API probe. The architecture says "no DOM reads in deterministic code." Even though `prefersReducedMotion()` is cached, importing it into the animation module creates a dependency chain from the deterministic core to the host-touching layer. The consumer should decide how to apply reduced motion.

### Option B: Every function takes `reducedMotion: boolean`

```ts
export function evaluateLocomotion(state, config, reducedMotion): LocomotionPose;
export function breathe(tick, config, reducedMotion): Scale2D;
```

**Rejected.** Bakes a policy decision into every function signature. What if a consumer wants 0.5× amplitude instead of 0.2×? What if they want to animate the reduction (fade from full to reduced)? A boolean is too coarse.

### Option C: Config-level amplitude scaling (RECOMMENDED)

The consumer sets amplitude multipliers in the config object:

```ts
const config = {
  ...DEFAULT_GAIT,
  strideLength: DEFAULT_GAIT.strideLength * (reduceMotion ? 0.2 : 1),
  strideHeight: DEFAULT_GAIT.strideHeight * (reduceMotion ? 0.2 : 1),
  // etc.
};
```

For springs, the consumer reduces `gravityY` and `drag` in the config.

**Why this wins:**
1. **Follows the convention.** "Every tunable number lives in a config object the consumer can spread into their own." The amplitude scale IS a tunable number.
2. **Flexible.** Consumer can use any reduction factor (0.2, 0.5, 0.0) or animate the transition.
3. **Pure.** No host API dependency in the animation module. The consumer reads `prefersReducedMotion()` in their own code (renderer layer) and passes the result as a config value.
4. **Matches the consumer game.** The consumer game already does this: `const bob = bobbing && !reduceMotion ? Math.round(Math.sin(tick * 0.15)) : 0` — it gates the amplitude at the call site, not inside the library.

**Library provides convenience:** Export a `scaledGait(config, motionScale)` helper that multiplies all amplitude fields by a scale factor:

```ts
/**
 * Scale all amplitude fields in a GaitConfig by a factor.
 * Useful for reduced-motion: `scaledGait(DEFAULT_GAIT, 0.2)`.
 *
 * @returns new GaitConfig (input not mutated)
 */
export function scaledGait(config: GaitConfig, scale: number): GaitConfig;
```

Similarly for `BreathConfig`:
```ts
export function scaledBreath(config: BreathConfig, scale: number): BreathConfig;
```

**For sineShake/shakeEnvelope:** These now live in `src/animation/oscillators.ts` (migrated from `src/primitives/animation.ts`). They are NOT part of this locomotion proposal. Screen shake is gated by the consumer (`reduceMotion ? 0 : sineShake(...)`). No change needed.

---

## Where Do the Migrating Helpers Land?

> **Decision: Clean migration, NO back-compat shim.** Code is unused outside the library. The four functions move out of `src/primitives/animation.ts` and the file is deleted.

### Migration Plan

**`bob`, `pulse`, `sineShake`, `shakeEnvelope`** — these are general-purpose oscillators, not locomotion-specific. They live in a new file:

- **`src/animation/oscillators.ts`** — houses `bob`, `pulse`, `sineShake`, `shakeEnvelope`. These are deterministic sine-based functions useful for UI elements, screen shake, and any repeating motion pattern — not just locomotion. Placing them in `oscillators.ts` (not `locomotion.ts`) correctly reflects their general-purpose nature. `sineShake` and `shakeEnvelope` are screen-shake utilities; they fit naturally alongside the other oscillators because they share the same mathematical shape (sine-based periodic functions).

**`Vec2`** — moves to `src/animation/types.ts` (canonical home, per the skeletal-rigging proposal).

### What Gets Deleted

- **`src/primitives/animation.ts`** — DELETED entirely.
- **`src/primitives/index.ts`** — drops the `bob, pulse, sineShake, shakeEnvelope, type Vec2` exports.
- **NO re-export shim.** The library has no external consumers yet. Clean break.

### Updated Import Paths for Consumers

```ts
// Before (broken after migration):
import { bob, pulse, sineShake, shakeEnvelope } from 'aicraft-engine/src/primitives';
import { Vec2 } from 'aicraft-engine/src/primitives';

// After:
import { bob, pulse, sineShake, shakeEnvelope } from 'aicraft-engine/src/animation/oscillators';
import { Vec2 } from 'aicraft-engine/src/animation/types';
// Or via the animation barrel:
import { bob, pulse, sineShake, shakeEnvelope, Vec2 } from 'aicraft-engine/src/animation';
```

### `src/animation/index.ts` barrel

The animation barrel re-exports everything from its sub-modules including the migrated oscillators:

```ts
export { bob, pulse, sineShake, shakeEnvelope } from './oscillators';
export { advanceLocomotion, evaluateLocomotion, ... } from './locomotion';
export { volumeScale, breathe, ... } from './squash-stretch';
export { advanceSpringChain, createSpringChain, ... } from './spring';
export type { Vec2, AffineTransform, BonePose, ... } from './types';
```

**Signatures stay identical — only the file location changes:**

```ts
// In src/animation/oscillators.ts (same signatures, new home)
export function bob(tick: number, speed: number, amplitude: number): number;
export function pulse(tick: number, speed: number, amplitude: number): number;
export function sineShake(tick: number, magnitude: number, frequencyX?: number, frequencyY?: number): Vec2;
export function shakeEnvelope(tick: number, duration: number, initialMagnitude: number): number;
```

**Why oscillators.ts, not locomotion.ts?** The locomotion module is specifically about phase-accumulator walk/run cycles. `bob` and `pulse` are used for UI elements (key bobbing at `sprites.ts:1209`, door glows), not locomotion. `sineShake` and `shakeEnvelope` are screen-shake effects. Grouping all sine-based periodic functions in one module is more discoverable than scattering them across locomotion and primitives.

---

## Mutability Stance

> **Decision 3 (orchestrator):** All animation systems outside the Rig stay pure-clone consistent with `src/particles/advance.ts`. The hybrid mutability exception is scoped exclusively to `src/animation/rig.ts` (the Rig's derived world-transform cache).

**For locomotion:** Pure-clone. `advanceLocomotion(state, ...) → newState` — returns a new `LocomotionState` object, input is not mutated. `evaluateLocomotion(state, config)` is a pure reader — returns a new `LocomotionPose`. The consumer takes the pose and applies it to `rig.localPoses` if they want rig integration. This keeps locomotion standalone and composable.

**For springs:** Pure-clone, following the particles pattern exactly. `advanceSpringChain(state, ...) → newState` — input is not mutated, output is a new array. The spring chain is renderer-adjacent (its output feeds drawing, not simulation), but the pure-clone pattern is still correct because:
1. Multiple systems might read the same spring chain (e.g., hair + cloak share a chain)
2. Replay/snapshot systems need to capture the chain state without mutation risk
3. Consistency with `particles/advance.ts` — same pattern, same expectations

**For squash/stretch:** Stateless. `volumeScale(d)` and `breathe(tick, config)` return new `Scale2D` objects each call. No mutation involved.

**Summary:**

| System | Mutability | Pattern |
|---|---|---|
| `Rig.localPoses` | Mutable consumer workspace | Decision 3 exception (rig only) |
| `Rig.worldTransforms/Positions/Rotations` | Mutable derived cache | Decision 3 exception (rig only) |
| `advanceLocomotion` | Pure-clone | Returns new LocomotionState |
| `evaluateLocomotion` | Pure reader | Returns new LocomotionPose |
| `advanceSpringChain` | Pure-clone | Returns new VerletNode[] |
| `volumeScale`, `breathe` | Stateless | Returns new Scale2D |
| `advanceFootLock` | Pure-clone | Returns new FootLockState |

---

## Complete API Surface for `src/animation/`

### `src/animation/types.ts` (from skeletal-rigging proposal)

- `Vec2` — `{x: number; y: number}` (canonical home; migrated from `src/primitives/animation.ts`)
- `AffineTransform` — 2×3 matrix tuple
- `BonePose` — local TRS
- `BoneNode` — bone in hierarchy
- `SkeletonTemplate` — reusable skeleton definition
- `Rig` — live rig instance
- `EffectorTarget` — IK/locomotion attachment point
- `BoneDrawMap` — skin draw callback map

### `src/animation/oscillators.ts` (migrated from `src/primitives/animation.ts`)

General-purpose deterministic oscillators (sine-based periodic functions).

- `bob(tick, speed, amplitude)` → `number` — signed displacement
- `pulse(tick, speed, amplitude)` → `number` — unipolar pulse in [0, amplitude]
- `sineShake(tick, magnitude, freqX?, freqY?)` → `Vec2` — 2-axis screen shake
- `shakeEnvelope(tick, duration, initialMagnitude)` → `number` — linear-decay magnitude

### `src/animation/locomotion.ts` (this proposal)

- `LocomotionState` — phase accumulator
- `GaitConfig` — per-character gait parameters
- `DEFAULT_GAIT` — default config constant
- `LocomotionPose` — hip/foot offsets
- `advanceLocomotion(state, speed, dt, config)` → `LocomotionState`
- `evaluateLocomotion(state, config)` → `LocomotionPose`
- `scaledGait(config, scale)` → `GaitConfig`

### `src/animation/squash-stretch.ts` (this proposal)

- `Scale2D` — `{scaleX, scaleY}`
- `BreathConfig` — breathing parameters
- `DEFAULT_BREATH` — default config constant
- `volumeScale(deltaY)` → `Scale2D`
- `breathe(tick, config)` → `Scale2D`
- `projectTurnedPart(localX, localY, facingAngle)` → `{x, y, sx, sy}`
- `scaledBreath(config, scale)` → `BreathConfig`

### `src/animation/spring.ts` (this proposal)

- `VerletNode` — chain node position
- `SpringConfig` — physics parameters
- `DEFAULT_SPRING` — default config constant
- `advanceSpringChain(nodes, anchorX, anchorY, dt, config)` → `VerletNode[]`
- `createSpringChain(count, anchorX, anchorY, segmentLength)` → `VerletNode[]`

### `src/animation/index.ts` (barrel)

Re-exports everything from the above modules plus the foundation types from `types.ts`. Also re-exports `bob`, `pulse`, `sineShake`, `shakeEnvelope` from `./oscillators` (migrated from `src/primitives/animation.ts`).

---

## Comparison of Overall Module Shapes

### Shape 1: Split functions with advance+evaluate (RECOMMENDED)

```
advanceLocomotion → evaluateLocomotion
volumeScale / breathe / projectTurnedPart (stateless)
advanceSpringChain / createSpringChain
```

**Pros:** Matches particles pattern. Maximum composability. Each function tree-shakes independently. State is explicit plain data.
**Cons:** Two-call pattern for locomotion (minor ceremony).

### Shape 2: Single mega-`animate(tick, config)` entry point

```ts
export function animate(tick: number, config: AnimationConfig): AnimationPose;
```

Returns hip offset, foot offsets, scale, spring positions all in one object.

**Pros:** Single call. Maximum simplicity for simple use cases.
**Cons:** Tightly couples unrelated systems. Can't use locomotion without springs. Can't tree-shake. The consumer can't apply locomotion to one character and springs to another independently.

**Verdict:** Rejected. Violates the library's composability principle.

### Shape 3: Stateful animation controller class

```ts
class AnimationController {
  locomotion: LocomotionState;
  springs: Map<string, VerletNode[]>;
  step(dt: number): AnimationPose { ... }
}
```

**Pros:** Single object manages everything. Familiar OOP.
**Cons:** Conflicts with functional style. Hard to snapshot for replay. Can't tree-shake. Forces all consumers through one interface.

**Verdict:** Rejected. Classes don't compose well with the existing function-based API.

### Final Recommendation: Shape 1 (Split functions)

It matches the particles module pattern, tree-shakes perfectly, and keeps each concern independent. The two-call locomotion pattern is a small ceremony cost for a large composability win.

---

## Open Questions for @architect

1. ~~**`bob`/`pulse` re-export from animation barrel**~~: **RESOLVED (Fix #1).** Clean migration: `bob`, `pulse`, `sineShake`, `shakeEnvelope` move to `src/animation/oscillators.ts`. `src/primitives/animation.ts` is deleted. No re-export shim.

2. **Spring `VerletNode` in `types.ts` vs `spring.ts`:** Should the `VerletNode` type be hoisted to `src/animation/types.ts` alongside `Vec2` and `BonePose`, or kept in `src/animation/spring.ts`? It's spring-specific but might be referenced by other modules (e.g., a future cloth simulation).

3. **`scaledGait` / `scaledBreath` convenience helpers:** Are these worth the API surface cost, or should the consumer just multiply config fields manually? The counterargument is that multiplying 5 fields correctly is error-prone (forgetting `hipSwayWidth` means the sway doesn't reduce).

4. **`DEFAULT_SPRING` gravityY = 0.5:** Is this a reasonable default for a downward-hanging tail? Or should gravity be zero by default (chain hangs limp) with the consumer adding gravity explicitly? The research note uses `gravityY: 0.5` as a reasonable starting point.

5. **`createSpringChain` initial straight-line:** Should the initial chain be perfectly straight (deterministic) or slightly jittered (more natural-looking at rest)? Straight is more deterministic but looks stiff until the first few frames of simulation settle it. Jittered looks better immediately but requires an RNG parameter.
