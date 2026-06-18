# Decision: Skeletal Rigging (`src/animation/rig.ts` + shared foundation types)

**Status:** APPROVED — proceeds to TDD implementation.
**Inputs:** `docs/research/skeletal-rigging.md` · `docs/design/skeletal-rigging-proposal.md` · architect critique (NEEDS REVISION → APPROVED, loop 2/2) · benchmark `benchmarks/animation/rig-hierarchy.png` · prototype `src/_prototype/anim-rig-min.ts`.

## Decision

Adopt the **flat-array 2×3 affine-transform rig**: bones stored in a flat array ordered parent-before-child, so `computeWorldTransforms` is a single O(N) non-recursive forward pass composing local TRS into world matrices. The matrix tuple `[a,b,c,d,tx,ty]` maps directly to `ctx.transform()`, eliminating per-frame rebuilds. This is the substrate that hosts IK effectors and locomotion targets.

Three cross-cutting decisions are locked here because the rig authoritatively defines the shared foundation:

1. **Rotation convention (pillar-wide):** radians measured from the +X axis, positive rotation +X→+Y. Because Canvas2D's Y points down, positive rotation appears clockwise on-screen and matches `ctx.rotate()` exactly. Matrix composition uses `[cos θ, sin θ, -sin θ, cos θ, tx, ty]`. Verified by benchmark: hip +35° tilts the rig clockwise and local rotations stack correctly.
2. **Effector identification (pillar-wide):** slot names (strings), resolved via `template.slotMap`. Skin-agnostic and stable across cosmetic variants — the foundation for Pillar 2.
3. **Mutability (pillar-wide):** the **Rig is the sole hybrid**. `Rig.localPoses` is the mutable consumer workspace; `worldTransforms`/`worldPositions`/`worldRotations` are a mutable *derived cache* recomputed by `computeWorldTransforms` each frame. All other animation systems stay pure-clone (per `src/particles/advance.ts`). This required a scoped exception to `docs/architecture.md` ("renderer-output buffer exception") — the only relaxation of "no state mutation," limited to derived/cached rendering data never read by simulation logic.

## Ratified from prototype
- `BonePose` keeps the **nested** shape (`translation: Vec2`, `rotation`, `scale: Vec2`) — it matches `BoneNode.restPose` and reads cleanly in rig *definitions*. (The prototype noted flat `tx/ty` is friendlier for ad-hoc mutation, but the workspace is `Rig.localPoses`, not hand-built literals, so nested is the right call.)
- `worldToLocal` uses the named constant `SINGULAR_MATRIX_DET_THRESHOLD = 1e-8` (no magic number).
- `drawRig(ctx, rig, skin)` lives in **`src/animation/skin.ts`** (renderer-adjacent), NOT in `rig.ts` (deterministic core).

## Migration (locked by user)
`Vec2` moves from `src/primitives/animation.ts` to `src/animation/types.ts` (canonical home). `src/primitives/animation.ts` is deleted; `src/primitives/index.ts` drops the export. **No back-compat shim** — the library has no consumers yet.

## What was rejected
- TRS-record transforms (rebuild matrix each frame — wasteful).
- Strict pure-clone for the rig (cloning a derived cache that is recomputed anyway is structurally pointless, not just a perf loss).
- Mesh skinning / weight painting (out of scope — "skin" = vector primitives drawn by the caller).
