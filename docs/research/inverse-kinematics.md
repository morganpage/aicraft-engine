# 2D Inverse Kinematics

> Research note for 2D Inverse Kinematics. Slug: `inverse-kinematics`.
> Investigated: 2026-06-18.

## TL;DR

Inverse Kinematics (IK) in 2D calculates the joint angles or positions of a skeletal chain so that its end effector (e.g., hand or foot) reaches a specific target in world space. For `aicraft-engine`—a zero-runtime-dependency, deterministic Canvas2D library—IK is the mathematical foundation for procedural character animation, enabling dynamic walking gaits, terrain adaptation, and interactive combat postures without pre-rendered sprite assets. This note surveys three solver families: the analytical **Limb Solver** (O(1) for two-bone chains), **Cyclic Coordinate Descent (CCD)** (iterative, rotation-based, ideal for organic chains like tails), and **Forward And Backward Reaching IK (FABRIK)** (iterative, position-based, extremely fast and accurate for multi-joint limbs). It also details **effector locking** to eliminate foot-sliding and **bend-direction constraints** (pole vectors) to ensure physiological realism. To guarantee cross-platform bit-determinism across different JS engines and architectures, we recommend enforcing **strictly fixed iteration counts** rather than convergence-epsilon thresholds, which are highly susceptible to floating-point branching hazards.

## Why this matters for aicraft-engine

- **Pillars Touched**: Touches **Pillar 1 (Primitives / Animation)** and **Pillar 4 (Fake-3D / character stacks)**, and directly integrates with the skeletal bone hierarchy in `src/animation/rig.ts` (see `docs/research/skeletal-rigging.md`).
- **Consumer Games**: Sibling games like *Spitekeep* (or future Clone-to-Jest titles like a card-based village builder or procedural RTS) need characters that can dynamically plant their feet on uneven terrain, reach for weapons, or swing tails without heavy pre-baked asset footprints.
- **Unlocks**:
  - **No-Slide Foot Placement**: Lock feet to the ground during a walk cycle, adjusting the leg joints dynamically to match body motion.
  - **Dynamic Reaching**: Arms that procedurally reach for doors, levers, or enemies, reacting to real-time physics and player inputs.
  - **Procedural Creatures**: Procedural generation of multi-legged insects, squids, or dragons whose limbs react naturally to the environment.

---

## Prior Art Survey

### Pattern 1: Analytical Limb Solver (Two-Bone)
- **Source**: Unity 2D Animation Manual ("Limb Solver") & Standard Trigonometry (Law of Cosines).
- **What it does**: Solves a two-joint chain (e.g., hip-knee-foot or shoulder-elbow-hand) analytically in closed form. It calculates the exact intersection of two circles representing the reach of the upper and lower bones. It is extremely fast, has no iterations, and is perfectly stable.
- **Algorithmic shape**:
  Given root $P_0$, target $T$, bone lengths $l_1$ and $l_2$, and a bend direction sign $b \in \{-1, 1\}$:
  ```typescript
  export interface Vec2 { x: number; y: number; }

  export interface LimbResult {
    joint: Vec2;
    effector: Vec2;
    solved: boolean;
  }

  export function solveLimb2D(
    root: Vec2,
    target: Vec2,
    l1: number,
    l2: number,
    bendDir: -1 | 1 = 1
  ): LimbResult {
    const dx = target.x - root.x;
    const dy = target.y - root.y;
    const dSq = dx * dx + dy * dy;
    const d = Math.sqrt(dSq);

    // Case 1: Out of reach (fully extended)
    if (d >= l1 + l2) {
      if (d === 0) {
        return { joint: { x: root.x, y: root.y + l1 }, effector: { x: root.x, y: root.y + l1 + l2 }, solved: false };
      }
      const ux = dx / d;
      const uy = dy / d;
      return {
        joint: { x: root.x + ux * l1, y: root.y + uy * l1 },
        effector: { x: root.x + ux * (l1 + l2), y: root.y + uy * (l1 + l2) },
        solved: false
      };
    }

    // Case 2: Under-extended (too close, bones collapse)
    const minReach = Math.abs(l1 - l2);
    if (d <= minReach) {
      const ux = d === 0 ? 1 : dx / d;
      const uy = d === 0 ? 0 : dy / d;
      const vx = -uy * bendDir;
      const vy = ux * bendDir;
      return {
        joint: { x: root.x + vx * l1, y: root.y + vy * l1 },
        effector: { x: target.x, y: target.y },
        solved: true
      };
    }

    // Case 3: Standard intersection (Law of Cosines)
    // a is the distance from root to the projection of the joint onto the root-target line
    // h is the perpendicular distance from that projection to the joint position
    const a = (l1 * l1 - l2 * l2 + dSq) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));

    const ux = dx / d;
    const uy = dy / d;
    const vx = -uy * bendDir; // Perpendicular vector
    const vy = ux * bendDir;

    return {
      joint: {
        x: root.x + a * ux + h * vx,
        y: root.y + a * uy + h * vy
      },
      effector: { x: target.x, y: target.y },
      solved: true
    };
  }
  ```
- **Worked Numerical Example**:
  - **Setup**: Root $P_0 = (0, 0)$, Target $T = (0, 10)$, $l_1 = 6$, $l_2 = 8$, $bendDir = 1$.
  - **Distance**: $d = \sqrt{0^2 + 10^2} = 10$. Since $10 < 6 + 8$, the target is reachable.
  - **Projection Distance ($a$)**: $a = \frac{6^2 - 8^2 + 10^2}{2 \times 10} = \frac{36 - 64 + 100}{20} = 3.6$.
  - **Perpendicular Height ($h$)**: $h = \sqrt{6^2 - 3.6^2} = \sqrt{36 - 12.96} = \sqrt{23.04} = 4.8$.
  - **Direction Vectors**: $\hat{u} = (0, 1)$, $\hat{v} = (-1, 0)$.
  - **Joint Position**: $P_1 = (0, 0) + 3.6(0, 1) + 4.8(1)(-1, 0) = (-4.8, 3.6)$.
  - **Verification**:
    - $\|P_1 - P_0\| = \sqrt{(-4.8)^2 + 3.6^2} = \sqrt{23.04 + 12.96} = 6 = l_1$.
    - $\|T - P_1\| = \sqrt{4.8^2 + (10 - 3.6)^2} = \sqrt{23.04 + 6.4^2} = 8 = l_2$.
- **Determinism profile**: Pure mathematical operations. Fully deterministic.
- **Runtime cost**: $O(1)$ per frame. Extremely cheap (1 square root, no trigonometric functions).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is the perfect solver for character knees and elbows.
- **What to steal**: The robust handling of edge cases (unreachable and under-extended) to prevent division by zero or NaN results.
- **What to avoid**: Straight-line singularity jitter. When $d \approx l_1 + l_2$, $h \approx 0$, which can cause the joint to pop or jitter if the target moves slightly. We must apply a small dead-zone or interpolation near full extension.

---

### Pattern 2: Cyclic Coordinate Descent (CCD) Solver
- **Source**: Unity Manual ("2D Inverse Kinematics (IK) | CCD Solver") & Standard Game Physics.
- **What it does**: An iterative heuristic solver that traverses the joint chain from the end effector's parent up to the root. At each joint, it calculates the angle needed to align the vector from the joint to the effector with the vector from the joint to the target, then rotates the joint and all its descendants by that angle.
- **Algorithmic shape**:
  ```typescript
  export function solveCCD2D(
    joints: Vec2[],
    lengths: number[],
    target: Vec2,
    maxIterations: number
  ): Vec2[] {
    const n = joints.length;
    if (n < 2) return joints;

    // Clone joints to maintain pure progression pattern
    const result = joints.map(j => ({ ...j }));

    for (let iter = 0; iter < maxIterations; iter++) {
      for (let i = n - 2; i >= 0; i--) {
        const joint = result[i];
        const effector = result[n - 1];

        const toEffectorX = effector.x - joint.x;
        const toEffectorY = effector.y - joint.y;
        const dEffector = Math.sqrt(toEffectorX * toEffectorX + toEffectorY * toEffectorY);

        const toTargetX = target.x - joint.x;
        const toTargetY = target.y - joint.y;
        const dTarget = Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY);

        if (dEffector < 1e-6 || dTarget < 1e-6) continue;

        // 2D Cross and Dot products to find rotation angle
        const dot = toEffectorX * toTargetX + toEffectorY * toTargetY;
        const cross = toEffectorX * toTargetY - toEffectorY * toTargetX;
        const theta = Math.atan2(cross, dot);

        if (Math.abs(theta) < 1e-6) continue;

        // Rotate descendants (i+1 to n-1) around joint i
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        for (let j = i + 1; j < n; j++) {
          const dx = result[j].x - joint.x;
          const dy = result[j].y - joint.y;
          result[j].x = joint.x + (dx * cosT - dy * sinT);
          result[j].y = joint.y + (dx * sinT + dy * cosT);
        }
      }
    }
    return result;
  }
  ```
- **Worked Numerical Example**:
  - **Setup**: 3-joint chain $P_0 = (0, 0)$, $P_1 = (0, 5)$, $P_2 = (0, 10)$ (effector). Bone lengths $l_1 = 5, l_2 = 5$. Target $T = (5, 5)$. $maxIterations = 1$.
  - **Step 1 (Joint $P_1$)**:
    - Vector to Effector: $v_E = P_2 - P_1 = (0, 5)$.
    - Vector to Target: $v_T = T - P_1 = (5, 0)$.
    - Cross Product: $v_E \times v_T = 0 \cdot 0 - 5 \cdot 5 = -25$.
    - Dot Product: $v_E \cdot v_T = 0 \cdot 5 + 5 \cdot 0 = 0$.
    - Angle: $\theta = \text{atan2}(-25, 0) = -\pi/2$ ($-90^\circ$).
    - Rotate descendant $P_2$ around $P_1$ by $-\pi/2$:
      - $dx = 0$, $dy = 5$.
      - $P_2.x = 0 + (0 \cdot 0 - 5 \cdot (-1)) = 5$.
      - $P_2.y = 5 + (0 \cdot (-1) + 5 \cdot 0) = 5$.
      - New $P_2 = (5, 5)$.
  - **Step 2 (Joint $P_0$)**:
    - Vector to Effector: $v_E = P_2 - P_0 = (5, 5)$.
    - Vector to Target: $v_T = T - P_0 = (5, 5)$.
    - Since $v_E = v_T$, the angle is $0$. No rotation.
  - **Result**: Effector $P_2$ reaches target $(5, 5)$ in exactly 1 iteration.
- **Determinism profile**: Pure mathematical operations, but highly sensitive to iteration count.
- **Runtime cost**: $O(I \cdot N^2)$ where $I$ is iterations and $N$ is joints. Rotating descendants on every step is expensive for long chains.
- **Dependencies**: None.
- **Fit for our constraints**: Medium. Excellent for organic structures like tails, tentacles, or ropes, but inefficient for standard limbs.
- **What to steal**: The simplicity of applying joint angle constraints directly during the angle calculation step (clamping $\theta$).
- **What to avoid**: The "rubbery" look. CCD tends to rotate joints closer to the end effector much more than joints near the root, leading to unnatural coiling or spiraling.

---

### Pattern 3: Forward And Backward Reaching IK (FABRIK) Solver
- **Source**: "FABRIK: A fast, iterative solver for the Inverse Kinematics problem" (Aristidou & Lasenby, 2011) & Unity Manual ("2D Inverse Kinematics | FABRIK Solver").
- **What it does**: A position-based solver that ignores angles during computation. It performs two sweeps per iteration: a backward sweep (forcing the end effector to the target and pulling the remaining joints along) and a forward sweep (forcing the root back to its original anchor and pulling the joints back). Joint rotations are reconstructed afterwards.
- **Algorithmic shape**:
  ```typescript
  export function solveFABRIK2D(
    joints: Vec2[],
    lengths: number[],
    target: Vec2,
    maxIterations: number
  ): Vec2[] {
    const n = joints.length;
    if (n < 2) return joints;

    const result = joints.map(j => ({ ...j }));
    const rootAnchor = { ...result[0] };
    const totalLength = lengths.reduce((sum, len) => sum + len, 0);

    const dx = target.x - rootAnchor.x;
    const dy = target.y - rootAnchor.y;
    const distToTarget = Math.sqrt(dx * dx + dy * dy);

    // Case 1: Target is unreachable (stretch straight towards target)
    if (distToTarget >= totalLength) {
      if (distToTarget === 0) return result;
      const ux = dx / distToTarget;
      const uy = dy / distToTarget;
      for (let i = 0; i < n - 1; i++) {
        const len = lengths[i];
        result[i + 1].x = result[i].x + ux * len;
        result[i + 1].y = result[i].y + uy * len;
      }
      return result;
    }

    // Case 2: Target is reachable (double sweep)
    for (let iter = 0; iter < maxIterations; iter++) {
      // --- Backward Sweep (Effector to Root) ---
      result[n - 1].x = target.x;
      result[n - 1].y = target.y;

      for (let i = n - 2; i >= 0; i--) {
        const nextJoint = result[i + 1];
        const currJoint = result[i];
        const len = lengths[i];

        const vx = currJoint.x - nextJoint.x;
        const vy = currJoint.y - nextJoint.y;
        const d = Math.sqrt(vx * vx + vy * vy);

        if (d > 1e-6) {
          result[i].x = nextJoint.x + (vx / d) * len;
          result[i].y = nextJoint.y + (vy / d) * len;
        } else {
          result[i].x = nextJoint.x + len;
          result[i].y = nextJoint.y;
        }
      }

      // --- Forward Sweep (Root to Effector) ---
      result[0].x = rootAnchor.x;
      result[0].y = rootAnchor.y;

      for (let i = 0; i < n - 1; i++) {
        const currJoint = result[i];
        const nextJoint = result[i + 1];
        const len = lengths[i];

        const vx = nextJoint.x - currJoint.x;
        const vy = nextJoint.y - currJoint.y;
        const d = Math.sqrt(vx * vx + vy * vy);

        if (d > 1e-6) {
          result[i + 1].x = currJoint.x + (vx / d) * len;
          result[i + 1].y = currJoint.y + (vy / d) * len;
        } else {
          result[i + 1].x = currJoint.x + len;
          result[i + 1].y = currJoint.y;
        }
      }
    }
    return result;
  }
  ```
- **Worked Numerical Example**:
  - **Setup**: 3-joint chain $P_0 = (0, 0)$, $P_1 = (0, 5)$, $P_2 = (0, 10)$ (effector). Bone lengths $l_1 = 5, l_2 = 5$. Target $T = (5, 5)$. $maxIterations = 1$.
  - **Backward Sweep**:
    - Force Effector to Target: $P_2' = (5, 5)$.
    - Update $P_1'$: Vector $v = P_1 - P_2' = (-5, 0)$, $d = 5$. $P_1' = (5, 5) + 5 \cdot (-1, 0) = (0, 5)$.
    - Update $P_0'$: Vector $v = P_0 - P_1' = (0, -5)$, $d = 5$. $P_0' = (0, 5) + 5 \cdot (0, -1) = (0, 0)$.
  - **Forward Sweep**:
    - Force Root back: $P_0'' = (0, 0)$.
    - Update $P_1''$: Vector $v = P_1' - P_0'' = (0, 5)$, $d = 5$. $P_1'' = (0, 0) + 5 \cdot (0, 1) = (0, 5)$.
    - Update $P_2''$: Vector $v = P_2' - P_1'' = (5, 5) - (0, 5) = (5, 0)$, $d = 5$. $P_2'' = (0, 5) + 5 \cdot (1, 0) = (5, 5)$.
  - **Result**: Effector $P_2''$ reaches target $(5, 5)$ in exactly 1 iteration.
- **Determinism profile**: Pure mathematical operations, highly stable.
- **Runtime cost**: $O(I \cdot N)$ where $I$ is iterations and $N$ is joints. Extremely cheap (linear time, only vector math, no trigonometric functions during position solve).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is the gold standard for multi-joint chains (e.g., arachnid legs, spines, complex arms).
- **What to steal**: The linear-time double sweep pattern. It converges in 1-3 iterations for most configurations.
- **What to avoid**: Solving in position space means joint angle constraints must be applied as an extra projection step during the sweeps, which can add complexity.

---

### Pattern 4: Effector Locking & Foot Pinning
- **Source**: "Inverse Kinematics in 2D Animation | Cartoon Animator" & Spine 2D Effector Locking.
- **What it does**: Prevents "foot sliding" and "floating hands" by pinning the end effector to a fixed world-space coordinate when grounded or holding onto a prop. As the character's root moves, the leg joints are solved to keep the foot planted. When the foot lifts, the lock is released, and the target smoothly interpolates back to the local animation space.
- **Algorithmic shape**:
  ```typescript
  export interface FootLockState {
    isLocked: boolean;
    lockPos: Vec2;
    blendWeight: number; // 0 (unlocked) to 1 (fully locked)
  }

  export function stepFootLock(
    state: FootLockState,
    isGrounded: boolean,
    animatedFootPosWorld: Vec2,
    dt: number,
    blendSpeed: number = 10
  ): FootLockState {
    const next = { ...state };

    if (isGrounded) {
      if (!next.isLocked) {
        next.isLocked = true;
        next.lockPos = { ...animatedFootPosWorld };
      }
      next.blendWeight = Math.min(1.0, next.blendWeight + blendSpeed * dt);
    } else {
      next.isLocked = false;
      next.blendWeight = Math.max(0.0, next.blendWeight - blendSpeed * dt);
    }

    return next;
  }

  export function getIKTarget(state: FootLockState, animatedFootPosWorld: Vec2): Vec2 {
    // Deterministic linear interpolation (lerp)
    const w = state.blendWeight;
    return {
      x: (1 - w) * animatedFootPosWorld.x + w * state.lockPos.x,
      y: (1 - w) * animatedFootPosWorld.y + w * state.lockPos.y
    };
  }
  ```
- **Determinism profile**: Pure stateful progression. Fully deterministic when using dt as a parameter.
- **Runtime cost**: $O(1)$ per frame.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Essential for high-fidelity procedural locomotion.
- **What to steal**: The deterministic blend weight interpolation to prevent sudden "snapping" or "popping" when transitioning between locked and unlocked states.
- **What to avoid**: Hard-locking without a blend weight, which causes jarring 1-frame pops.

---

### Pattern 5: Bend-Direction & Pole-Vector Constraints
- **Source**: Unity Manual ("2D Inverse Kinematics | Pole Vector") & Cartoon Animator.
- **What it does**: Resolves the mathematical ambiguity of IK solutions by forcing joints to bend in a specific direction (e.g., knees bending backwards, elbows forwards). In 2D, this is achieved either by passing a binary bend direction sign or by calculating the sign dynamically using a world-space "pole vector" (bend hint) and a 2D cross product.
- **Algorithmic shape**:
  Given root $P_0$, target $T$, and a pole vector (bend hint) $P_{pole}$:
  ```typescript
  export function calculateBendDir2D(root: Vec2, target: Vec2, pole: Vec2): -1 | 1 {
    const lineX = target.x - root.x;
    const lineY = target.y - root.y;
    const poleX = pole.x - root.x;
    const poleY = pole.y - root.y;

    // 2D Cross product determines if the pole is to the left or right of the root-target line
    const cross = lineX * poleY - lineY * poleX;
    return cross >= 0 ? 1 : -1;
  }
  ```
- **Determinism profile**: Pure mathematical operations.
- **Runtime cost**: $O(1)$ per frame.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Standardizes bend direction across all solvers.
- **What to steal**: The 2D cross product sign. It maps a 2D "pole target" (which can be animated or attached to another bone) directly to the analytical Limb Solver's `bendDir` parameter.
- **What to avoid**: Complex 3D plane projection math. In 2D, a simple scalar cross product is sufficient, robust, and much faster.

---

## Determinism & Numerical Stability Analysis

IK solvers are iterative and mathematically sensitive. When implementing them in a deterministic engine, we face a critical choice between two termination conditions:

### Option A: Convergence-Epsilon with Tolerance
```typescript
while (error > epsilon && iterations < maxIterations) { ... }
```
- **The Hazard**: Floating-point arithmetic (`number` in JS/TS) is governed by IEEE 754 double-precision standards. While basic math is highly consistent, minor differences in compiler optimizations, JIT compilation (V8 vs. JavaScriptCore), CPU architectures (x86_64 vs. ARM64), or FMA (Fused Multiply-Add) instructions can cause tiny discrepancies in the least significant bits (e.g., $10^{-16}$).
- **The Branching Trap**: If the error is calculated as `0.000099999999999999` on Chrome/Intel and `0.000100000000000001` on Safari/M1, and the epsilon is `0.0001`:
  - Chrome/Intel exits the loop at iteration 4.
  - Safari/M1 runs an extra iteration and exits at iteration 5.
  - The joint positions will slightly diverge. If these positions feed back into the gameplay simulation (e.g., triggering a collision, footstep event, or damage box), **the simulation will desynchronize (desync) immediately**.

### Option B: Strictly Fixed Iteration Counts
```typescript
for (let iter = 0; iter < fixedIterations; iter++) { ... }
```
- **The Solution**: By enforcing a strictly fixed iteration count (e.g., exactly 4 iterations for FABRIK, or 8 for CCD), we eliminate the conditional branch based on float threshold comparison.
- **The Benefits**:
  1. **Bit-Determinism**: The control flow is identical across all platforms and engines. Any tiny floating-point rounding errors remain confined to the 15th decimal place and do not cause divergent execution paths.
  2. **Predictable CPU Cost**: The solver has a constant, predictable execution time per frame, preventing frame-rate spikes when the character's limbs are in difficult or unreachable configurations.

### Recommendation
**`aicraft-engine` must enforce strictly fixed iteration counts (Option B) for all iterative solvers (CCD and FABRIK).** The convergence-epsilon check must be omitted entirely or used only as a non-binding visual fallback in the renderer-adjacent layer (which cannot leak back into the simulation). For the core simulation, a fixed loop is the only way to guarantee multi-platform desync safety.

---

## Stability & Cost Analysis

| Solver | Iteration Count (Recommended) | Computational Complexity | Primary Moat / Strength | Failure Modes & Edge Cases |
|---|---|---|---|---|
| **Limb Solver** | N/A ($O(1)$ analytical) | $O(1)$ | Instantaneous, zero-iteration, perfectly stable, mathematically exact. | **Straight-line singularity**: Popping/jitter when target is exactly at max reach ($d \approx l_1 + l_2$). **Target on root**: Division by zero when $d = 0$. |
| **CCD Solver** | 8 - 12 | $O(I \cdot N^2)$ | Natural organic dragging, excellent for tails, tentacles, and ropes. Easy angular clamping. | **Rubbery coiling**: Outer joints rotate excessively, causing the chain to spiral or fold unnaturally if the target is close. High CPU cost for long chains. |
| **FABRIK Solver** | 3 - 5 | $O(I \cdot N)$ | Extremely fast convergence, high positional accuracy, linear-time complexity. | **Constraint complexity**: Applying joint angle limits requires projecting positions back onto angular cones, which can be mathematically heavy. |

---

## Reference Implementations

- **Unity 2D Animation IK Solvers** ([github.com/Unity-Technologies/2d-animation](https://github.com/Unity-Technologies/2d-animation)): Teaches the production-tested structure of CCD and FABRIK solvers in 2D, including pole-vector and joint-limit constraints.
- **FABRIK Original Paper** ([andreasaristidou.com/FABRIK.html](http://www.andreasaristidou.com/publications/papers/FABRIK.pdf)): Teaches the mathematical proof of the forward/backward reach sweeps, multi-effector extensions, and closed-loop solving.
- **Sokpop Fake-3D Demo** ([sokpop.itch.io/sokpop-fake-3d-demo](https://sokpop.itch.io/sokpop-fake-3d-demo)): Teaches primitive-stack character construction, showing how simple relative offsets can animate beautifully without complex skeletal meshes.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Circle-Circle Intersection | The analytical geometry of the Limb Solver, showing the two valid joint positions (elbow/knee) and how the bend direction selects between them. | Standard Geometric Reference |
| Forward/Backward Sweeps | How FABRIK iteratively pulls the chain towards the target (backward) and then anchors it back to the root (forward), rapidly closing the distance gap. | Aristidou & Lasenby (2011) |
| Foot Sliding vs. Locked Foot | A side-by-side comparison of a walking character: one with sliding feet (local animation only) and one with pinned feet (IK effector locking). | Spine 2D Effector Locking Guide |

---

## Open Questions

- **The GC vs. Mutability Trade-off**:
  In `src/particles/advance.ts`, the engine enforces a strict "pure progression" pattern where state is cloned on every step.
  However, running iterative IK solvers (CCD/FABRIK) on multiple characters with 10+ joints will generate substantial garbage collection overhead if objects are cloned on every iteration.
  *Proposed Solution*: The solver functions should be pure and return new arrays of joint positions, but the *internal* iterations should operate on a single mutable local clone (`result`) created once at the start of the function. This keeps the public API pure and deterministic while keeping GC overhead to a minimum.
- **Angle Reconstruction for Bone Hierarchies**:
  FABRIK outputs joint *positions*, but skeletal rigs (like `src/animation/rig.ts`) typically require joint *rotations* (angles) to propagate transforms down the tree.
  *Proposed Solution*: After solving joint positions with FABRIK, we must perform a post-pass to calculate the absolute angles of each bone vector ($P_{i+1} - P_i$) and convert them back into local rotations relative to their parents. This math is straightforward ($atan2$) but must be implemented defensively to handle collinear bones.

---

## Top 3 Patterns Worth Prototyping

1. **Analytical Limb Solver with Pole-Vector Cross Product (Rank 1)** — *Why*: It is $O(1)$, has zero iteration overhead, is perfectly deterministic, and covers 90% of character animation needs (arms and legs). It should be the first solver shipped in `src/animation/ik/`.
2. **FABRIK Solver with Fixed Iterations (Rank 2)** — *Why*: It is the most performant and visually natural solver for multi-joint chains (spines, tentacles, multi-segmented legs). Enforcing a fixed iteration count of 4 guarantees bit-determinism and linear performance.
3. **Stateful Foot-Locking Adapter (Rank 3)** — *Why*: It directly solves the "foot sliding" problem in procedural walking gaits, bridging the gap between raw mathematical solvers and professional-grade game locomotion.

---

## Cross-References

- `docs/research/skeletal-rigging.md` (the hierarchical bone tree that IK transforms)
- `docs/research/procedural-locomotion.md` (dynamic walking gaits that drive IK targets)
- `ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md` (Sokpop's character rendering and fake-3D techniques)
- `src/rng/mulberry32.ts` (the deterministic PRNG used for procedural variation)
