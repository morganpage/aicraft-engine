# Animation Pillar Benchmarks

This directory contains visual benchmark renders for the animation sub-module prototypes (Inverse Kinematics, Procedural Motion, and Skeletal Rigging). These renders serve as the visual quality assurance gate before committing to the full TDD implementation.

## How to Reproduce

To regenerate these PNGs, run the following command from the workspace root:

```bash
npx vite-node benchmarks/_scripts/animation-render.ts
```

This script executes the deterministic sample-scene generators from `src/_prototype/sample.ts` and renders them to 256x256 PNGs using `node-canvas` on a neutral Slate-100 (`#f1f5f9`) background.

---

## Benchmark Scenes

### 1. 2-Bone Limb Reach (`ik-limb-reach.png`)
- **Source:** `sampleLimbReach()`
- **Description:** A 2-bone analytical limb solver rooted at the canvas center reaching 5 targets arranged in a fan. Each target has an associated pole vector (red dot) that determines the bend direction of the elbow/knee joint.
- **Key Features Demonstrated:**
  - **Analytical Solver Accuracy:** The end-effector lands exactly on all reachable targets.
  - **Pole-Vector Responsiveness:** The joint bends consistently toward the pole vector.
  - **Pole Flipping:** The 5th target (top-right) flips the pole vector to the opposite side, showing that `calculateBendDir` correctly flips the joint bend direction.
  - **Unreachable Target Clamping:** The unreachable target (bottom-right, gold line) is handled gracefully by extending the limb straight toward the target and clamping at maximum reach without jitter or math errors.

### 2. FABRIK Chain Convergence (`ik-fabrik-chain.png`)
- **Source:** `sampleFabrikChain()`
- **Description:** A 5-segment FABRIK (Forward And Backward Reaching IK) chain solving to two different targets from a horizontal rest pose (gold ghost).
- **Key Features Demonstrated:**
  - **Reachable Curve Solve:** Target A (top-left) is reachable and off-axis, producing a smooth, natural-looking curve that converges exactly on the target.
  - **Bone Length Preservation:** Segment spacing is perfectly preserved along the curved solve.
  - **Unreachable Stretch:** Target B (far-right, purple line) is beyond the total chain length. The solver handles this gracefully by stretching the chain in a perfectly straight line toward the target and clamping at maximum length without overshoot.

### 3. Verlet Spring Chain (`spring-chain.png`)
- **Source:** `sampleSpringChain()`
- **Description:** An 8-node hanging Verlet chain under gravity, with the anchor moving along a horizontal sine path. The image overlays 4 snapshots (ticks 0, 10, 20, 30) in distinct colors to show the motion over time.
- **Key Features Demonstrated:**
  - **Secondary Motion & Lag:** The chain sways and lags behind the anchor naturally, demonstrating excellent secondary physics (e.g., for tails, hair, or cloaks).
  - **Numerical Stability:** The simulation is perfectly stable with no explosions, NaN values, or jitter.
  - **PBD Softness:** With 2 constraint iterations, the top segments stretch slightly more than the bottom segments under gravity (~7% softness), giving the chain an organic, rope-like elasticity rather than a rigid rod feel.

### 4. Skeletal Rig Hierarchy (`rig-hierarchy.png`)
- **Source:** `sampleRigHierarchy()`
- **Description:** A 5-bone humanoid-ish skeleton showing world-transform propagation. It overlays the rest pose (gold ghost) with a posed pose (orange bones, dark joints) sharing the same hip origin.
- **Key Features Demonstrated:**
  - **World-Transform Propagation:** Rotating the hip root (+35°) correctly drags all downstream children (spine, head, thigh, shin) in a single O(N) forward pass.
  - **Local Rotation Stacking:** The local spine rotation (-20°) correctly stacks on top of the hip's rotation, pointing the spine in a different absolute direction than in the rest pose.
  - **TRS Composition:** The affine matrix composition correctly handles translation, rotation, and scale propagation.

---

## Gallery Composite (`gallery.png`)
A 2x2 grid composite of all four benchmark scenes, separated by a subtle divider. This serves as the public showcase image for the animation pillar.
