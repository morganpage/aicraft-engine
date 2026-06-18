# API Proposal: Skeletal Rigging

> Target pillar: 1 (Primitives / Animation). Module: `src/animation/`.
> Builds on research: `docs/research/skeletal-rigging.md`, `docs/research/procedural-locomotion.md`, `docs/research/inverse-kinematics.md`.
> Status: DRAFT.

## Consumer Need

Spitekeep currently draws the devil character as a single hardcoded function (`drawDevil` in `src/render/sprites.ts:1096`) that manually calls `ctx.translate` + `ctx.scale` and draws every body part at fixed pixel offsets. This works for one character but doesn't scale: you can't swap skins, you can't animate limbs independently, you can't plant feet via IK, and you can't procedurally adapt gaits to speed/terrain.

A skeletal rig provides the mathematical substrate that unlocks:
- **Pillar 2 Cosmetics**: Same bone hierarchy, different draw functions = different "skins" (robot, goblin, slime) with zero extra assets.
- **Procedural Locomotion**: Walk/run cycles that drive bone rotations from phase-integrated trig functions, adapting to velocity in real time.
- **Inverse Kinematics**: Dynamic reaching (arms to targets, feet to ground) by solving joint angles from world-space targets.

Without the rig, each of these would be hand-coded per character. With it, they're all composable on the same substrate.

---

## Shared Foundation Types

These types live in `src/animation/types.ts` and are the **authoritative definitions** that the sibling proposals (procedural-locomotion, inverse-kinematics) must import from this module. Do not duplicate them.

### Vec2

**Migration note**: `Vec2` currently lives in `src/primitives/animation.ts`. It will be **moved** to `src/animation/types.ts` (canonical home). `src/primitives/animation.ts` is deleted entirely and `src/primitives/index.ts` drops the `Vec2` export. **No back-compat re-export shim** — the library has no consumers yet, so this is a clean break (per orchestrator decision).

```ts
/**
 * 2D vector. Used for positions, offsets, and directions throughout the
 * animation and rendering systems.
 */
export interface Vec2 {
  x: number;
  y: number;
}
```

### AffineTransform (2×3 matrix)

**The fork: TRS record vs 2×3 matrix vs both.**

Three representations were considered:

| Approach | Shape | Composition cost | Canvas2D cost | Ergonomics |
|---|---|---|---|---|
| **A: TRS record** | `{tx, ty, rotation, sx, sy}` | O(1) via sin/cos recomposition | Must build matrix each frame | Readable, easy to debug |
| **B: 2×3 matrix only** | `[a, b, c, d, tx, ty]` | O(1) matrix multiply (8 mul + 4 add) | Direct `ctx.transform(a,b,c,d,tx,ty)` | Opaque without helper |
| **C: Both + converters** | `AffineTransform` class with `.trs` and matrix fields | Cached | Cached | Most flexible, most GC |

**Recommendation: Approach B — 2×3 matrix as the canonical representation.**

Rationale:
1. **Canvas2D integration is zero-cost.** The 2×3 matrix `[a, b, c, d, tx, ty]` maps directly to `ctx.transform(a, b, c, d, e, f)`. No conversion step. This is the hot path — every bone's world matrix gets applied to the canvas context every frame.
2. **Composition is a closed-form multiply.** Two 2×3 matrices compose via 8 multiplications and 4 additions. This is faster than decomposing to TRS, applying rotations, and recomposing.
3. **Determinism is cleaner.** No trig functions in the composition path. `Math.sin`/`Math.cos` only happen once when a local rotation is set, not every frame during propagation.
4. **IK solvers output positions, not TRS.** The IK proposals (FABRIK, CCD) work in position space and reconstruct rotations via `atan2`. The matrix representation is the natural output format.

The consumer never constructs matrices by hand — they set `BonePose` (TRS) on individual bones, and `computeWorldTransforms` produces matrices. The matrix is the engine's internal representation; TRS is the consumer's input interface.

```ts
/**
 * 2D affine transform as a 2×3 column-major matrix.
 *
 * Layout (matching Canvas2D's `ctx.transform(a, b, c, d, e, f)`):
 * ```
 * | a  c  tx |
 * | b  d  ty |
 * | 0  0  1  |
 * ```
 *
 * For a rotation by angle θ (radians, from +X toward +Y, per the pillar
 * rotation convention): `a = cos θ, b = sin θ, c = -sin θ, d = cos θ`.
 * This maps directly to `ctx.transform(cos θ, sin θ, -sin θ, cos θ, tx, ty)`.
 *
 * Composition: `world = parent · local` (standard matrix multiplication).
 * The last row `[0, 0, 1]` is implicit and never stored.
 */
export type AffineTransform = [
  a: number, b: number,
  c: number, d: number,
  tx: number, ty: number,
];
```

**Why a tuple and not a plain object?** A 6-element tuple is 48 bytes on the heap (6 × 8-byte doubles). A plain object `{a, b, c, d, tx, ty}` with hidden class overhead is ~80+ bytes. For 20 bones × 60fps × N characters, the tuple saves meaningful GC pressure. It also avoids property-name typos at the call site — the destructuring `const [a, b, c, d, tx, ty] = m` is self-documenting.

### BonePose

The consumer's input interface for a single bone's local transform. Immutable value type — consumers set these, the engine propagates them into matrices.

```ts
/**
 * Local-space pose for a single bone. Translation, rotation (radians), and
 * scale relative to the bone's parent. This is the consumer's input interface;
 * the engine converts it to an AffineTransform during `computeWorldTransforms`.
 *
 * All fields have sensible defaults (identity transform) when omitted.
 */
export interface BonePose {
  /** Local translation relative to parent. Default `{x: 0, y: 0}`. */
  translation?: Vec2;
  /**
   * Local rotation in radians, measured from the +X axis, with positive
   * rotation going from +X toward +Y. Because Canvas2D's Y-axis points
   * down, positive rotation appears clockwise on-screen and matches
   * `ctx.rotate(angle)` exactly.
   *
   * Default `0`.
   */
  rotation?: number;
  /** Local scale. Default `{x: 1, y: 1}`. */
  scale?: Vec2;
}
```

**Pillar-wide rotation convention (Decision 1):**

All rotation values across the animation pillar — `BonePose.rotation`, IK solver outputs, locomotion outputs — follow the same convention:

> **Angles are in radians, measured from the +X axis, with positive rotation going from +X toward +Y.**

Because Canvas2D's Y-axis points down, this means positive rotation appears clockwise on-screen and matches `ctx.rotate(angle)` exactly. This convention is documented in `src/animation/types.ts` as a top-level note and is assumed by all solver implementations.

**Why optional fields with defaults?** Most bones start at identity. Requiring all three fields for a bone that just needs a rotation would be verbose. The engine fills defaults internally — the consumer only sets what they need.

### BoneNode

A bone in the hierarchy. Defines the rest pose, parent relationship, and an optional attachment slot for IK effectors and locomotion targets.

```ts
/**
 * A single bone in the skeleton hierarchy. Bones are stored in a flat array
 * ordered so that every parent precedes its children (topological sort). This
 * allows `computeWorldTransforms` to propagate transforms in a single O(N)
 * forward pass with zero recursion.
 */
export interface BoneNode {
  /** Unique identifier within the skeleton (e.g. "left_upper_arm"). */
  id: string;
  /**
   * Index of this bone's parent in the bones array, or `-1` for root bones.
   * Using an index (not a string reference) keeps the hot loop cache-friendly.
   */
  parentIndex: number;
  /** Rest pose — the default local TRS when no animation is applied. */
  restPose: BonePose;
  /**
   * Optional attachment slot name (e.g. "hand", "foot", "weapon_tip").
   * IK and locomotion solvers target bones by this slot name, not by bone id.
   * A bone may have zero or one attachment slot.
   */
  attachmentSlot?: string;
}
```

**Why `parentIndex: number` instead of `parentId: string | null`?** The research note uses string IDs, but string comparison in the hot propagation loop is wasteful. An integer index into the same flat array is O(1), cache-friendly, and the topological invariant (parents precede children) guarantees the index is always valid. The string `id` field is still available for debugging and for IK/locomotion to find bones by name at setup time.

### SkeletonTemplate

The reusable skeleton definition. Shared across all instances of the same body type. Immutable after creation.

```ts
/**
 * A reusable skeleton definition. Shared across all instances of the same
 * body type (e.g. "humanoid", "quadruped"). Contains the bone hierarchy,
 * rest poses, and bone lengths (used by IK solvers).
 *
 * Create via `createSkeleton()`. Templates are immutable after creation.
 */
export interface SkeletonTemplate {
  /** Flat array of bones, topologically sorted (parents before children). */
  readonly bones: readonly BoneNode[];
  /**
   * Pre-computed rest-pose world transforms for each bone. Cached at template
   * creation time so the consumer can read default bone positions without
   * running `computeWorldTransforms`.
   */
  readonly restWorldTransforms: readonly AffineTransform[];
  /**
   * Pre-computed bone lengths (distance from bone origin to first child's
   * origin in rest pose). Used by IK solvers. Indexed by bone index.
   */
  readonly boneLengths: readonly number[];
  /**
   * Map from attachment slot name to bone index. Built at template creation
   * time for O(1) lookup by IK/locomotion.
   */
  readonly slotMap: Readonly<Record<string, number>>;
}
```

### Rig (Instance State)

The per-instance runtime state. Contains mutable pose overrides and the computed world matrices.

```ts
/**
 * A live rig instance bound to a SkeletonTemplate. Contains the current
 * local poses (what the consumer or locomotion system writes) and the
 * computed world-space transforms (what the renderer reads).
 *
 * **Mutability contract (Decision 3 — scoped hybrid):**
 * - `localPoses` = mutable consumer workspace (the pose-building surface).
 * - `worldTransforms` / `worldPositions` / `worldRotations` = mutable DERIVED
 *   CACHE, recomputed by `computeWorldTransforms(rig)`. These are rendering
 *   output; never read by deterministic simulation logic.
 *
 * All OTHER animation systems (locomotion, IK, springs) stay pure-clone
 * consistent with `src/particles/advance.ts`. This hybrid mutability is
 * exercised ONLY by `src/animation/rig.ts`.
 */
export interface Rig {
  /** Reference to the shared skeleton definition. */
  readonly template: SkeletonTemplate;
  /**
   * Current local poses for each bone. Indexed identically to
   * `template.bones`. The consumer (or locomotion system) writes here;
   * `computeWorldTransforms` reads from here.
   *
   * Mutable: the consumer sets bone poses each tick without cloning.
   */
  localPoses: BonePose[];
  /**
   * Computed world-space transforms. Written by `computeWorldTransforms`.
   * Indexed identically to `template.bones`.
   *
   * Mutable DERIVED CACHE: overwritten in-place each frame by
   * `computeWorldTransforms`. Rendering output; never read by deterministic
   * simulation logic.
   */
  worldTransforms: AffineTransform[];
  /**
   * World-space positions for each bone origin (derived from worldTransforms).
   * Convenience cache for IK solvers, which need positions more than matrices.
   *
   * Mutable DERIVED CACHE: overwritten in-place by `computeWorldTransforms`.
   */
  worldPositions: Vec2[];
  /**
   * World-space rotations for each bone (derived from worldTransforms).
   * Convenience cache for locomotion, which reads parent rotations to
   * compute relative offsets.
   *
   * Mutable DERIVED CACHE: overwritten in-place by `computeWorldTransforms`.
   */
  worldRotations: number[];
}
```

---

## The Big Fork: Mutability Stance — DECIDED

> **Decision 3 (orchestrator):** APPROVE the hybrid mutability **for the Rig only**.
>
> - `Rig.localPoses` = mutable consumer workspace (the pose-building surface).
> - `Rig.worldTransforms` / `worldPositions` / `worldRotations` = mutable DERIVED CACHE, recomputed by `computeWorldTransforms(rig)`, documented as "rendering output; never read by deterministic simulation logic."
> - **All OTHER animation systems stay pure-clone** consistent with `src/particles/advance.ts`: `advanceLocomotion`, `evaluateLocomotion`, `advanceSpringChain`, `solveLimb`/`solveCCD`/`solveFABRIK` (pure-public + internal-local-clone), `advanceFootLock`.
>
> This exception is exercised by `src/animation/rig.ts` (derived world-transform cache) and nowhere else.

### Approach A: Strict Pure-Clone Every Tick — REJECTED

**Source pattern:** `src/particles/advance.ts` — returns a new array of new objects every frame.

```ts
// Every tick:
const nextRig = cloneRig(currentRig);
for (const bone of nextRig.localPoses) {
  // apply locomotion offsets...
}
computeWorldTransforms(nextRig);
// nextRig is a brand-new object; currentRig is untouched
```

**Trade-offs:**
- **Ergonomics:** Consumer writes `rig = updateRig(rig, ...)` — clean functional style. But cloning 20 bones × (BonePose + AffineTransform + Vec2 + number) = ~20 × (3 + 6 + 2 + 1) × 8 bytes = ~1,920 bytes per character per frame. At 60fps × 50 characters = ~5.8 KB/s of short-lived objects. This is within modern GC budgets but not free.
- **Determinism:** Maximum clarity. No accidental mutation. Every tick is a clean snapshot. Perfect for replay systems.
- **Runtime cost:** ~50-200μs per character (clone + compute) for 20 bones. Measurable but not catastrophic.
- **Consumer complexity:** Consumer must track the returned rig reference. Can't pass rig by reference and expect mutations to stick.

### Approach B: In-Place Mutation (Renderer-Style Exception) — REJECTED

**Source pattern:** Spitekeep's `drawDevil` mutates the canvas transform in-place; the renderer never feeds back into the sim.

```ts
// Every tick:
for (let i = 0; i < rig.localPoses.length; i++) {
  // apply locomotion offsets directly to rig.localPoses[i]...
}
computeWorldTransforms(rig);
// rig is mutated in-place; the renderer reads worldTransforms directly
```

**Trade-offs:**
- **Ergonomics:** Most natural. `rig.localPoses[boneIdx].rotation = newAngle` — direct, obvious, no return-value gymnastics.
- **Determinism:** Risk of accidental shared-state bugs if two systems read/write the same rig. But the architecture layer rule ("renderer may relax rules when result cannot leak back into simulation") already handles this — the rig is a renderer-adjacent construct.
- **Runtime cost:** Zero clone overhead. Only the matrix computation happens. Cheapest option.
- **Consumer complexity:** Lowest. Direct mutation is how Spitekeep already works (`state.player.x = newX`).

### Approach C: Hybrid — Mutable Poses, Mutable Derived Cache (DECIDED)

**Source pattern:** Synthesis of particles (pure logical state) and renderer (mutable computed output).

```ts
// Local poses are set directly (small, cheap to reason about):
rig.localPoses[hipIdx].rotation = walkCycleAngle;

// World matrices are computed in-place (transient, never leaked to sim):
computeWorldTransforms(rig);

// The consumer reads rig.worldTransforms for rendering.
// The simulation never reads rig.worldTransforms.
```

**Trade-offs:**
- **Ergonomics:** Same as Approach B for the consumer — direct mutation of local poses. No cloning ceremony.
- **Determinism:** The logical pose (localPoses) is a small array of TRS values — easy to snapshot for replays if needed (just JSON.stringify the poses). The world matrices are computed output that can be recomputed from the poses at any time — they are NOT authoritative state.
- **Runtime cost:** Same as Approach B — zero clone. The local poses are ~12 bytes per bone (2 + 1 + 2 fields × 8 bytes default, or ~40 bytes with the interface overhead). For 20 bones, that's ~800 bytes — trivial to snapshot if a replay system needs it.
- **Consumer complexity:** Consumer treats `rig.localPoses` as the "write" surface and `rig.worldTransforms` as the "read" surface. The contract is clear: you write poses, you read matrices. The two surfaces never conflict.

**Why this was decided:**

The rig is fundamentally a **renderer-adjacent** construct — it feeds the Canvas2D context, and its computed output (world matrices) never leaks back into the simulation. This matches the architecture layer model exactly: "Renderer-adjacent: may read CanvasRenderingContext2D passed in; no state mutation [of the simulation]." The rig's world matrices are the renderer's business, not the simulation's.

Cloning 20 bones × 60fps × N characters is wasteful when the matrices can be recomputed from the poses in O(N) time. The poses themselves are small (one rotation + one translation + one scale per bone) and could be snapshot for replay if needed — but that's a consumer concern, not a library concern.

The decided contract:

> **Rig Mutation Contract (Decision 3)**: `Rig.localPoses` is the mutable consumer workspace. `computeWorldTransforms` reads `localPoses` and writes `worldTransforms`, `worldPositions`, and `worldRotations` in-place (mutable derived cache). The rendering output is never read by deterministic simulation logic. All other animation systems (locomotion, IK, springs, foot-lock) stay pure-clone consistent with `src/particles/advance.ts`. Replays that need to snapshot pose state should clone `rig.localPoses` (a cheap shallow array copy).

---

## Functional Surface

### `createSkeleton(bones)`

Factory function. Creates a `SkeletonTemplate` from a bone array. Validates topological order (parents before children), computes rest-pose world transforms, bone lengths, and slot map.

```ts
/**
 * Create a reusable skeleton template from a bone definition array.
 *
 * The `bones` array MUST be topologically sorted: every parent bone must
 * appear before its children. The root bone(s) have `parentIndex: -1`.
 *
 * Validates:
 * - All parentIndex values are valid (-1 or a valid index less than current)
 * - No cycles (guaranteed by topological sort invariant)
 * - Attachment slot names are unique
 *
 * @throws if validation fails (this is a setup-time function, not per-frame)
 */
export function createSkeleton(bones: BoneNode[]): SkeletonTemplate;
```

**Usage example:**
```ts
import { createSkeleton } from 'aicraft-engine/src/animation';

const humanoid = createSkeleton([
  { id: 'root',       parentIndex: -1, restPose: { translation: { x: 0, y: 0 } }, attachmentSlot: 'root' },
  { id: 'hip',        parentIndex: 0,  restPose: { translation: { x: 0, y: 0 } } },
  { id: 'torso',      parentIndex: 1,  restPose: { translation: { x: 0, y: -12 } } },
  { id: 'head',       parentIndex: 2,  restPose: { translation: { x: 0, y: -16 } } },
  { id: 'left_upper', parentIndex: 2,  restPose: { translation: { x: -6, y: 2 } } },
  { id: 'left_lower', parentIndex: 4,  restPose: { translation: { x: 0, y: 8 } }, attachmentSlot: 'left_hand' },
  { id: 'right_upper',parentIndex: 2,  restPose: { translation: { x: 6, y: 2 } } },
  { id: 'right_lower',parentIndex: 6,  restPose: { translation: { x: 0, y: 8 } }, attachmentSlot: 'right_hand' },
  { id: 'left_thigh', parentIndex: 1,  restPose: { translation: { x: -4, y: 0 } } },
  { id: 'left_shin',  parentIndex: 8,  restPose: { translation: { x: 0, y: 8 } }, attachmentSlot: 'left_foot' },
  { id: 'right_thigh',parentIndex: 1,  restPose: { translation: { x: 4, y: 0 } } },
  { id: 'right_shin', parentIndex: 10, restPose: { translation: { x: 0, y: 8 } }, attachmentSlot: 'right_foot' },
]);
```

### `createRig(template)`

Factory function. Creates a `Rig` instance from a template. Copies rest poses as the initial local poses. Allocates world-space output arrays.

```ts
/**
 * Create a live rig instance from a skeleton template. Initializes all
 * local poses to the template's rest poses and computes initial world
 * transforms.
 */
export function createRig(template: SkeletonTemplate): Rig;
```

### `computeWorldTransforms(rig)`

The core propagation function. Single-pass, non-recursive, O(N).

```ts
/**
 * Compute world-space transforms for all bones in a rig.
 *
 * Single forward pass through the flat bone array (parents precede children),
 * composing each bone's local transform with its parent's world transform.
 *
 * Local-to-matrix conversion uses the pillar rotation convention:
 * for a rotation by θ radians, the matrix elements are
 * `cos θ, sin θ, -sin θ, cos θ` — consistent with
 * `ctx.transform(cos θ, sin θ, -sin θ, cos θ, tx, ty)`.
 *
 * Mutates `rig.worldTransforms`, `rig.worldPositions`, and `rig.worldRotations`
 * in-place. Does NOT mutate `rig.localPoses`.
 *
 * Complexity: O(N) where N = number of bones. No recursion.
 * Determinism: Pure bit-deterministic given identical localPoses. The only
 * floating-point operations are matrix multiplication (8 mul + 4 add per bone)
 * and sqrt (for world positions). No trig in the propagation loop — trig
 * happens only when `BonePose.rotation` is converted to matrix elements.
 */
export function computeWorldTransforms(rig: Rig): void;
```

**Usage example:**
```ts
import { computeWorldTransforms } from 'aicraft-engine/src/animation';

// Set some poses
rig.localPoses[4].rotation = Math.sin(tick * 0.1) * 0.3; // left_upper arm swing

// Propagate — single call, all world matrices are now current
computeWorldTransforms(rig);

// Read results
const handMatrix = rig.worldTransforms[5]; // left_lower arm world transform
const handPos = rig.worldPositions[5];     // left_hand world position
```

### `localToWorld(point, rig, boneIndex)` / `worldToLocal(point, rig, boneIndex)`

Point transformation via the affine matrix. Needed for IK effector projection.

```ts
/**
 * Transform a point from a bone's local space to world space.
 *
 * @param point - the point in the bone's local coordinate system
 * @param rig - the rig (must have current worldTransforms)
 * @param boneIndex - the bone whose space to transform from
 * @returns the point in world space
 */
export function localToWorld(point: Vec2, rig: Rig, boneIndex: number): Vec2;

/**
 * Transform a point from world space to a bone's local space.
 *
 * Uses the inverse of the bone's world affine transform. For non-degenerate
 * transforms (scale > 0, no shear), this is a closed-form 2×3 matrix inversion.
 * Returns `{x: 0, y: 0}` for degenerate (singular) transforms where
 * `Math.abs(det) < SINGULAR_MATRIX_DET_THRESHOLD` (from `src/animation/constants.ts`).
 *
 * @param point - the point in world space
 * @param rig - the rig (must have current worldTransforms)
 * @param boneIndex - the bone whose space to transform into
 * @returns the point in the bone's local coordinate system
 */
export function worldToLocal(point: Vec2, rig: Rig, boneIndex: number): Vec2;
```

**Usage example (IK):**
```ts
import { worldToLocal } from 'aicraft-engine/src/animation';

// IK solver wants to know where the target is in the forearm's local space
const targetWorld = { x: 200, y: 300 };
const targetLocal = worldToLocal(targetWorld, rig, forearmBoneIndex);
// Now the IK solver can compute the rotation needed to reach targetLocal
```

**Determinism note on `worldToLocal`:** The matrix inversion uses `1 / (a*d - b*c)` — a single division. The only float hazard is a near-zero determinant (degenerate transform). The fallback `{x: 0, y: 0}` is safe and deterministic. The threshold (`SINGULAR_MATRIX_DET_THRESHOLD = 1e-8`) is a named constant from `src/animation/constants.ts` — no epsilon-based branching that could desync across platforms.

### Skin Binding: Per-Bone Draw Callbacks

> **Fix #6 (architect objection):** `drawRig` lives in `src/animation/skin.ts` (renderer-adjacent), NOT in `src/animation/rig.ts` (deterministic core). `rig.ts` stays pure math. This aligns with `docs/api-surface.md` already listing `drawRig` under `src/animation/skin.ts`.

The "skin" is a set of draw functions that receive the canvas context and bone world transforms. Different skins are different sets of draw functions on the same skeleton.

```ts
/**
 * A skin definition: a mapping from bone index to a draw callback.
 * Each callback receives the canvas context and the rig (so it can read
 * worldTransforms/worldPositions) and draws vector primitives for that bone.
 *
 * The skin does NOT own the skeleton — it's a thin rendering layer on top
 * of the rig. Swapping skins means swapping the BoneDrawMap, not the rig.
 */
export type BoneDrawMap = Array<{
  /** The bone index this draw function is responsible for. */
  boneIndex: number;
  /**
   * Draw callback. Called with the canvas context (already transformed to
   * the bone's world position/rotation) and the rig for reading sibling data.
   */
  draw: (ctx: CanvasRenderingContext2D, rig: Rig) => void;
} | null>;

/**
 * Draw all bones in a rig using the given skin. For each non-null entry in
 * the BoneDrawMap:
 *   1. Save the canvas state
 *   2. Apply the bone's world transform via ctx.transform()
 *   3. Call the draw callback
 *   4. Restore the canvas state
 *
 * Bones with null entries in the map are skipped (invisible bones).
 */
export function drawRig(
  ctx: CanvasRenderingContext2D,
  rig: Rig,
  skin: BoneDrawMap,
): void;
```

**Usage example:**
```ts
import { drawRig, type BoneDrawMap } from 'aicraft-engine/src/animation';

// A "devil" skin
const devilSkin: BoneDrawMap = [
  null, // root (invisible)
  null, // hip
  { boneIndex: 2, draw: (ctx) => {
    // Torso: 24×32 red body
    ctx.fillStyle = '#b91c1c';
    ctx.fillRect(-12, -16, 24, 32);
    ctx.strokeStyle = '#1d1128';
    ctx.lineWidth = 1;
    ctx.strokeRect(-12, -16, 24, 32);
  }},
  { boneIndex: 3, draw: (ctx) => {
    // Head: eyes, horns
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-6, -9, 3, 3);
    ctx.fillRect(3, -9, 3, 3);
  }},
  // ... etc
];

// In the render loop:
computeWorldTransforms(rig);
drawRig(ctx, rig, devilSkin);
```

**How this enables Pillar 2 Cosmetics:** A "robot" skin is just a different `BoneDrawMap` with different draw callbacks (metallic colors, rivets, antenna) on the same skeleton and rig. The locomotion system drives `rig.localPoses` identically — the visual variation is entirely in the skin.

### Effector/Locomotion Attachment Contract

IK solvers and locomotion targets attach to bones by slot name. The rig provides a lookup from slot name to bone index (via `template.slotMap`). The attachment is a data-only contract — the solver owns its own state.

```ts
/**
 * An attachment point for IK or locomotion. Identifies a bone by its
 * attachment slot and specifies a world-space target position.
 *
 * This is the contract between the rig and the solver streams. The solver
 * reads this to know WHERE to aim; the rig provides the bone's world
 * transform so the solver can compute joint angles.
 */
export interface EffectorTarget {
  /** The attachment slot name (e.g. "left_foot", "right_hand"). */
  slot: string;
  /** World-space target position for the effector. */
  target: Vec2;
}
```

**Usage example (IK):**
```ts
import { type EffectorTarget } from 'aicraft-engine/src/animation';
// In the IK proposal:
const feetTargets: EffectorTarget[] = [
  { slot: 'left_foot',  target: { x: leftFootWorldX, y: groundY } },
  { slot: 'right_foot', target: { x: rightFootWorldX, y: groundY } },
];
// The IK solver resolves these by looking up bone indices via template.slotMap,
// then adjusting rig.localPoses[shinIdx].rotation to plant the foot at the target.
```

**Usage example (locomotion):**
```ts
// The locomotion system reads bone world positions to compute foot offsets,
// then writes back to rig.localPoses:
const hipIdx = template.slotMap['root'];
rig.localPoses[hipIdx].translation = { x: hipOffset.x, y: hipOffset.y };

const leftFootIdx = template.slotMap['left_foot'];
// ... compute walk-cycle rotation and set it
rig.localPoses[leftShinIdx].rotation = walkAngle;
```

---

## Float-Precision in Deep Hierarchies

**Risk:** Each matrix multiplication introduces ~15 digits of double-precision accuracy. For a 5-level deep hierarchy (root → torso → upper_arm → forearm → hand), the accumulated error is ~5 × 10⁻¹⁵ — negligible. For a 15-level deep hierarchy, it's ~15 × 10⁻¹⁵ — still within double precision but approaching the noise floor for rendering (sub-pixel jitter).

**Mitigation:**

1. **Document a soft depth limit of 10 bones.** This is a convention, not a hard cap. Most 2D characters need 8-15 bones total, not 15 levels of depth. A typical humanoid is 4 levels deep (root → torso → upper_arm → forearm).
2. **No epsilon-based branching in propagation.** The matrix multiply is pure arithmetic — no comparisons, no conditionals. Floating-point rounding is symmetric and deterministic across IEEE 754 platforms. The only hazard is `worldToLocal`'s `1/det` division, which has a deterministic fallback for singular matrices.
3. **Re-rooting.** If a consumer needs a deep chain (e.g., a 10-segment tentacle), they can re-root the chain at its base bone to minimize depth. The flat-array layout supports this naturally.

**Flag for @architect:** Should we enforce a hard cap (e.g., `MAX_BONE_DEPTH = 16`) at `createSkeleton` time and throw, or keep it as documentation only? The library's conventions say "throw at setup time for invalid input" is acceptable — `createSkeleton` is a one-time setup function, not per-frame.

---

## Determinism Confirmation

| Operation | Deterministic? | Notes |
|---|---|---|
| `computeWorldTransforms` | **Yes** | Pure matrix multiply. No trig, no branching on float values. Same input → same output on any IEEE 754 platform. |
| `localToWorld` | **Yes** | 6 multiplications + 4 additions. No division, no sqrt. |
| `worldToLocal` | **Yes** | One division (`1/det`). The singular-matrix fallback (`{x:0, y:0}`) is deterministic because the branch condition (`Math.abs(det) < SINGULAR_MATRIX_DET_THRESHOLD`) is based on a named constant from `src/animation/constants.ts`, not an epsilon comparison against computed error. |
| `createSkeleton` | **Yes** | Setup-time only. Not per-frame. |
| `drawRig` | **N/A** | Renderer-adjacent. Reads world transforms (deterministic) but drawing is side-effectful (canvas state). The draw callbacks are consumer-provided — their determinism is the consumer's responsibility. |

**No desync hazards identified.** The only float-sensitive operation is `worldToLocal`'s determinant check, which uses a named constant (`SINGULAR_MATRIX_DET_THRESHOLD` from `src/animation/constants.ts`) — this is a constant, not a comparison between two computed values, so it cannot branch differently across platforms.

---

## Comparison Table

| Criterion | A: Pure-Clone (rejected) | B: In-Place Mutation (rejected) | C: Hybrid (DECIDED) |
|---|---|---|---|
| Ergonomics | Medium (must track return) | High (direct mutation) | High (direct mutation) |
| Determinism clarity | Maximum | Good (with discipline) | Good (poses = logical state) |
| Runtime cost | ~50-200μs/char clone overhead | Zero clone | Zero clone |
| GC pressure | 20 bones × 60fps × N chars | Zero | Zero |
| Convention fit | Matches particles exactly | Matches renderer pattern | Matches architecture layer model |
| Replay snapshot | Trivial (already cloned) | Must clone manually | Clone localPoses (cheap) |
| Risk | Low | Medium (accidental shared-state) | Low (scoped to rig only) |

---

## Approach Comparison: Transform Representation

| Criterion | A: TRS Record | B: 2×3 Matrix (Rec.) | C: Both + Converters |
|---|---|---|---|
| Canvas2D integration | Must build matrix each frame | Direct `ctx.transform()` | Direct (cached) |
| Composition cost | O(1) sin/cos per composition | O(1) 8 mul + 4 add | Same as B |
| Memory per bone | 5 numbers (40 bytes) | 6 numbers (48 bytes) | 11+ numbers (88+ bytes) |
| Debuggability | High (read rotation in radians) | Low (matrix elements are opaque) | High (both available) |
| Recommendation | | **Recommended** | Overkill |

---

## Recommendation

**Mutability: Approach C (Hybrid) — DECIDED** — the rig is renderer-adjacent, not simulation state. Local poses are the mutable write surface; world matrices are mutable derived cache. No cloning overhead, clear contract, matches the architecture layer model. Scoped exclusively to `src/animation/rig.ts` — all other animation systems stay pure-clone.

**Transform: Approach B (2×3 matrix)** — zero-cost Canvas2D integration, cache-friendly tuple layout, deterministic composition. TRS is the consumer input interface (BonePose); matrix is the engine output.

**Module shape:** `createSkeleton` + `createRig` + `computeWorldTransforms` + `localToWorld`/`worldToLocal` + `EffectorTarget`. Types live in `src/animation/types.ts`. `drawRig` lives in `src/animation/skin.ts` (renderer-adjacent, see Fix #6). Six functions, one type. Minimal surface, maximum composability.

---

## Open Questions for @architect

1. **Bone depth hard cap**: Should `createSkeleton` throw if any bone chain exceeds N levels deep (e.g., 16)? Or documentation-only? The library convention says "throw at setup time for invalid input" is acceptable.

2. ~~**`drawRig` ownership**~~: **RESOLVED (Fix #6).** `drawRig(ctx, rig, skin)` lives in `src/animation/skin.ts` (renderer-adjacent), NOT in `src/animation/rig.ts` (deterministic core).

3. **`BonePose` optionality**: Should all fields be optional (defaults to identity), or should we require explicit `{x: 0, y: 0}` for translation? Optional fields are more ergonomic but hide intent. The research note's example uses explicit values.

4. **Attachment slot uniqueness**: Should we enforce that attachment slot names are unique across the skeleton, or allow multiple bones with the same slot (e.g., two "joint" slots on different limbs)? IK solvers typically target one bone per slot, so uniqueness seems right — but confirm.
