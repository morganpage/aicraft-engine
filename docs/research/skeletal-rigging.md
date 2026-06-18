# Skeletal Rigging

> Research note for 2D skeletal animation / rigging. Slug: `skeletal-rigging`.
> Investigated: 2026-06-18.

## TL;DR

Skeletal rigging establishes a hierarchical tree of 2D bone nodes with local Translation, Rotation, and Scale (TRS) offsets that compose recursively into world-space coordinate matrices. For `aicraft-engine`—a zero-runtime-dependency, deterministic Canvas2D library with no imported art assets—this bone hierarchy serves as the mathematical scaffolding for procedural character rendering. Instead of mesh skinning and vertex weight painting (which are out of scope since "skins" are drawn from vector primitives in code), the calculated world transforms are used directly by the caller to draw rigid vector shapes (circles, capsules, rectangles). This note surveys hierarchical transform propagation, modular skeletons, and attachment points for Inverse Kinematics (IK) and locomotion, identifying **Hierarchical Matrix Composition (Flat Array Layout)**, **Modular Decoupled Bone-to-Primitive Binding (Skins)**, and **World-to-Local Effector Projection** as the top 3 patterns to prototype.

## Why this matters for aicraft-engine

- **Pillars Touched**: Touches **Pillar 1 (Primitives / Animation)** and **Pillar 4 (Fake-3D / billboarding / character stacks)**.
- **Consumer Games**: Sibling games like *Spitekeep* (or future Clone-to-Jest titles like a card-based village builder or procedural RTS) need lively, responsive characters without the memory overhead of spritesheets or Spine files.
- **Unlocks**:
  - **Procedural Locomotion**: Dynamic gaits (walking, running, limping) that adapt to speed and terrain in real-time.
  - **Dynamic Combat/Interactions**: Characters reaching for targets (swords, items, door handles) using Inverse Kinematics (IK).
  - **Zero-Asset Cosmetics**: Changing a character's "skin" is a simple matter of swapping the rendering function that draws on top of the same mathematical bone rig.

## What's OUT of scope

- **Mesh skinning and weight painting are NOT applicable**: There is no mesh, no vertex buffer, and no GPU-based vertex shader. "Skin" in `aicraft-engine` = pure vector primitives (lines, circles, rectangles) drawn by the caller using Canvas2D context. While sources like Adobe discuss weight scales/maps for smooth mesh deformation, we drop this entirely. Bones in our engine are pure rigid transform handles. The caller queries a bone's world matrix or position/rotation and draws a rigid vector primitive aligned to it.

## Prior Art Survey

### Pattern 1: Hierarchical Bone Movements & Transform Propagation
- **Source**: Adobe's "What Is Rigging in Animation? Skeletal Animation Explained" & Spine 2D Architecture.
- **What it does**: Establishes a tree structure where each bone has a parent (except the root). Each bone maintains a local transform (translation, rotation, scale). To find a bone's world transform, we recursively compose its local transform with its parent's world transform.
- **Algorithmic shape**:
  In 2D, a transform is represented by a 3x3 affine matrix (or a simplified 2x3 matrix since the last row is always `[0, 0, 1]`).
  Let local matrix $M_{local} = T(x, y) \cdot R(\theta) \cdot S(sx, sy)$.
  The world matrix is $M_{world} = M_{world, parent} \cdot M_{local}$.
  ```typescript
  export interface Vec2 { x: number; y: number; }
  
  export interface BonePose {
    translation: Vec2;
    rotation: number; // in radians
    scale: Vec2;
  }
  
  export interface BoneNode {
    id: string;
    parentId: string | null;
    localPose: BonePose;
    // Computed world-space matrix elements [a, b, c, d, tx, ty]
    // representing:
    // | a  c  tx |
    // | b  d  ty |
    // | 0  0  1  |
    worldMatrix: [number, number, number, number, number, number];
  }
  ```
- **Determinism profile**: Pure mathematical operations. Fully deterministic.
- **Runtime cost**: Per-frame calculation. For a small rig (e.g., 5-15 bones), computing matrices is extremely fast (under 0.01ms per character).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It's the foundational math for any hierarchical animation.
- **What to steal**: The 2x3 matrix composition math. Canvas2D's `ctx.transform(a, b, c, d, e, f)` accepts exactly this 2x3 matrix format, allowing direct rendering integration.
- **What to avoid**: Complex 3D matrix libraries or heavy scene-graph objects. Keep the data model flat and array-based or ID-linked to avoid garbage collection overhead.

### Pattern 2: Modular Skeletons & Shared Animation Libraries
- **Source**: "Character Design and Animation in RPG-Based Games"
- **What it does**: Decouples the skeleton structure (the rig) from the visual representation (the skin) and the animation data (the keyframes/gait parameters). This allows a single "Humanoid" skeleton to be shared across heroes, enemies, and NPCs, reducing memory and production costs.
- **Algorithmic shape**:
  ```typescript
  export interface SkeletonTemplate {
    bones: Array<{
      id: string;
      parentId: string | null;
      defaultPose: BonePose;
    }>;
  }
  
  export interface RigInstance {
    templateId: string;
    bones: Record<string, BonePose>; // current local poses
  }
  
  // The caller supplies a skin function:
  type SkinRenderer = (ctx: CanvasRenderingContext2D, rig: RigInstance) => void;
  ```
- **Determinism profile**: Pure.
- **Runtime cost**: One-time setup for templates; per-frame pose updates.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Decoupling rig from skin is the exact foundation for Pillar 2 (Cosmetics / Skins).
- **What to steal**: The separation of skeleton structure (template) from instance poses, allowing multiple visual skins to bind to the same mathematical skeleton.
- **What to avoid**: Hardcoding visual drawing logic inside the bone or rig structures. The rig should only output numbers (matrices, positions, rotations); the renderer draws.

### Pattern 3: World-to-Local and Local-to-World Transform Math
- **Source**: Standard 2D computer graphics / Scene-graph mathematics.
- **What it does**: Provides the explicit math to convert coordinates between local bone space and world space. This is critical for Inverse Kinematics (IK) and locomotion, where target positions are often specified in world space but must be converted to local bone rotations.
- **Algorithmic shape**:
  To convert local point $P_{local}$ to world:
  $$P_{world} = M_{world} \cdot P_{local}$$
  To convert world point $P_{world}$ to local:
  $$P_{local} = M_{world}^{-1} \cdot P_{world}$$
  Where the inverse of a 2x3 matrix $M = \begin{bmatrix} a & c & tx \\ b & d & ty \end{bmatrix}$ is:
  $$\text{det} = a \cdot d - b \cdot c$$
  $$M^{-1} = \frac{1}{\text{det}} \begin{bmatrix} d & -c & c \cdot ty - d \cdot tx \\ -b & a & b \cdot tx - a \cdot ty \end{bmatrix}$$
  
  ```typescript
  // Transform a local coordinate to world space
  export function localToWorld(localPt: Vec2, m: [number, number, number, number, number, number]): Vec2 {
    const [a, b, c, d, tx, ty] = m;
    return {
      x: a * localPt.x + c * localPt.y + tx,
      y: b * localPt.x + d * localPt.y + ty
    };
  }

  // Transform a world coordinate to local space
  export function worldToLocal(worldPt: Vec2, m: [number, number, number, number, number, number]): Vec2 {
    const [a, b, c, d, tx, ty] = m;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-8) {
      return { x: 0, y: 0 }; // Singular matrix fallback
    }
    const invDet = 1.0 / det;
    const dx = worldPt.x - tx;
    const dy = worldPt.y - ty;
    return {
      x: (d * dx - c * dy) * invDet,
      y: (-b * dx + a * dy) * invDet
    };
  }
  ```
- **Determinism profile**: Pure math. Fully deterministic.
- **Runtime cost**: Low. Matrix inversion is a few multiplications and divisions.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Necessary for IK effectors to calculate target angles.
- **What to steal**: Fast, closed-form 2x3 matrix inversion and vector multiplication.
- **What to avoid**: Floating-point drift in deep hierarchies. If a hierarchy is 10+ levels deep, cumulative precision loss can occur. We must keep hierarchies shallow (typically 3-5 levels: Root -> Torso -> Upper Arm -> Forearm -> Hand).

## Reference Implementations

- **Sokpop Fake-3D Demo** ([sokpop.itch.io/sokpop-fake-3d-demo](https://sokpop.itch.io/sokpop-fake-3d-demo)): Teaches character construction via primitive stacks with relative offsets, demonstrating how simple transformations create the illusion of 3D.
- **Spine-TS Runtime** ([github.com/EsotericSoftware/spine-runtimes/tree/4.1/spine-ts](https://github.com/EsotericSoftware/spine-runtimes/tree/4.1/spine-ts)): Teaches skeleton hierarchy, local-to-world matrix propagation, and bone constraints, though we must strip out its heavy mesh/vertex skinning code.
- **Pixi.js DisplayObject / Transform** ([github.com/pixijs/pixijs](https://github.com/pixijs/pixijs)): Teaches clean, performant 2D matrix update loops and parent-child propagation.

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Primitive Stack Character | How a character is composed of simple shapes (torso, head, limbs) offset from bones without a mesh. | Sokpop Fake-3D Demo |
| 2D Bone Hierarchy | Root -> Hip -> Spine -> Neck -> Head, with branches for arms and legs. | Adobe Skeletal Animation Guide |
| Local vs World Coordinate Spaces | How a hand bone's local coordinate system rotates and translates relative to the forearm and world. | Spine 2D Documentation |

## Open Questions

- **The Mutability vs. Performance Trade-off**:
  In `src/particles/advance.ts`, the engine enforces a strict "pure progression" pattern: state is cloned on every step (`JSON.parse(JSON.stringify(state))`).
  However, a skeletal rig with 10-20 bones, each containing matrices and vectors, will generate substantial garbage collection overhead if cloned 60 times per second per character.
  Should we:
  1. Enforce strict immutability (pure-clone) and accept the GC cost, optimizing via flat arrays or typed arrays?
  2. Document a "renderer-style exception" allowing in-place mutation of bone matrices and poses during the update tick, since skeletal rigs are primarily used for rendering and don't leak back into the core simulation state?
  3. Use a hybrid approach where the *logical pose* (a small set of angles/positions) is immutable, but the *computed world matrices* are cached mutably in a transient pool?
  This is a critical decision for `@architect` to adjudicate.

- **Float-Precision in Deep Hierarchies**:
  Does cumulative floating-point division/multiplication in matrix composition pose a threat to cross-platform determinism (e.g., JS engines in Chrome vs. Safari)? (Usually, 64-bit floats are highly consistent, but deep hierarchies or fast rotations can cause tiny drifts. Keeping hierarchies shallow solves this).

## Top 3 Patterns Worth Prototyping

1. **Hierarchical 2x3 Matrix Composition (Flat Array Layout)** — Storing bones in a flat array ordered such that parents always precede children allows a single, non-recursive loop to compute all world matrices in $O(N)$ time with zero recursion overhead.
2. **Modular Decoupled Bone-to-Primitive Binding (Skins)** — Proving that we can swap the rendering function (e.g., drawing a "Robot" skin vs. a "Goblin" skin) on top of the exact same bone hierarchy, establishing our Pillar 2 cosmetics foundation.
3. **World-to-Local Effector Projection** — Implementing the 2x3 matrix inversion math to project a world-space coordinate (like a foot target on the ground) into a limb bone's local space, proving the mathematical viability of our upcoming IK and locomotion modules.

## Cross-References

- `inverse-kinematics.md` (parallel note on IK effectors reaching for targets)
- `procedural-locomotion.md` (parallel note on gait-driven bone TRS)
- `ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md` (Sokpop's primitive-stack character construction)
- `src/primitives/` (where the vector drawing helpers live)
