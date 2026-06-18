# Animation Pillar Benchmarks

This directory contains visual benchmark renders for the production animation sub-modules (Inverse Kinematics, Procedural Motion, Skeletal Rigging, and Squash & Stretch). These renders serve as the visual quality assurance gate, confirming that the mathematical implementations produce correct, stable, and organic results.

## How to Reproduce

To regenerate these PNGs, run the following command from the workspace root:

```bash
npx vite-node benchmarks/_scripts/animation-render.ts
```

This script executes the deterministic sample-scene generators from `benchmarks/_scripts/animation-render.ts` using the production modules in `src/animation/` and renders them to 256x256 PNGs using `node-canvas` on a neutral Slate-100 (`#f1f5f9`) background.

---

## Benchmark Scenes

### 1. 2-Bone Limb Reach (`ik-limb-reach.png`)
- **Source:** `solveLimb` + `calculateBendDir` from `src/animation/ik/limb`
- **Description:** A 2-bone analytical limb solver rooted at the canvas center reaching 5 targets arranged in a fan. Each target has an associated pole vector (red dot) that determines the bend direction of the elbow/knee joint.
- **Key Features Demonstrated:**
  - **Analytical Solver Accuracy:** The end-effector lands exactly on all reachable targets.
  - **Pole-Vector Responsiveness:** The joint bends consistently toward the pole vector.
  - **Pole Flipping:** The 5th target (top-right) flips the pole vector to the opposite side, showing that `calculateBendDir` correctly flips the joint bend direction.
  - **Unreachable Target Clamping:** The unreachable target (bottom-right, gold line) is handled gracefully by extending the limb straight toward the target and clamping at maximum reach without jitter or math errors.

### 2. FABRIK Chain Convergence (`ik-fabrik-chain.png`)
- **Source:** `solveFABRIK` from `src/animation/ik/fabrik`
- **Description:** A 5-segment FABRIK (Forward And Backward Reaching IK) chain solving to two different targets from a horizontal rest pose (gold ghost).
- **Key Features Demonstrated:**
  - **Reachable Curve Solve:** Target A (top-left) is reachable and off-axis, producing a smooth, natural-looking curve that converges exactly on the target.
  - **Bone Length Preservation:** Segment spacing is perfectly preserved along the curved solve.
  - **Unreachable Stretch:** Target B (far-right, purple line) is beyond the total chain length. The solver handles this gracefully by stretching the chain in a perfectly straight line toward the target and clamping at maximum length without overshoot.

### 3. Verlet Spring Chain (`spring-chain.png`)
- **Source:** `createSpringChain` + `advanceSpringChain` from `src/animation/spring`
- **Description:** An 8-node hanging Verlet chain under gravity, with the anchor moving along a horizontal sine path. The image overlays 4 snapshots (ticks 0, 10, 20, 30) in distinct colors to show the motion over time.
- **Key Features Demonstrated:**
  - **Secondary Motion & Lag:** The chain sways and lags behind the anchor naturally, demonstrating excellent secondary physics (e.g., for tails, hair, or cloaks).
  - **Numerical Stability:** The simulation is perfectly stable with no explosions, NaN values, or jitter.
  - **PBD Softness:** With 2 constraint iterations, the top segments stretch slightly more than the bottom segments under gravity (~7% softness), giving the chain an organic, rope-like elasticity rather than a rigid rod feel.

### 4. Skeletal Rig Hierarchy (`rig-hierarchy.png`)
- **Source:** `createSkeleton` + `createRig` + `computeWorldTransforms` from `src/animation/rig`
- **Description:** A 5-bone humanoid-ish skeleton showing world-transform propagation. It overlays the rest pose (gold ghost) with a posed pose (orange bones, dark joints) sharing the same hip origin.
- **Key Features Demonstrated:**
  - **World-Transform Propagation:** Rotating the hip root (+35°) correctly drags all downstream children (spine, head, thigh, shin) in a single O(N) forward pass.
  - **Local Rotation Stacking:** The local spine rotation (-20°) correctly stacks on top of the hip's rotation, pointing the spine in a different absolute direction than in the rest pose.
  - **TRS Composition:** The affine matrix composition correctly handles translation, rotation, and scale propagation.

### 5. Procedural Locomotion Cycle (`locomotion-cycle.png`)
- **Source:** `advanceLocomotion` + `evaluateLocomotion` from `src/animation/locomotion`
- **Description:** A walk cycle visualization showing the trajectories of the hip (gold), left foot (orange), and right foot (purple) over a full phase sweep. A stick figure is drawn at the mid-swing phase (`phase = π/2`) with full opacity, and at key transition phases (`phase = 0` and `phase = π`) with lower opacity.
- **Key Features Demonstrated:**
  - **Gait Phase Integration:** The feet swing fore/aft in a smooth sinusoidal motion, and lift only on the forward half of the cycle.
  - **Opposite-Phase Feet:** The left and right feet are exactly 180 degrees (π radians) out of phase, producing a natural walking cadence.
  - **Hip Bobbing & Sway:** The hip bobs downward twice per cycle (once per foot plant) and sways laterally in counter-phase with the feet, demonstrating a realistic weight-transfer effect.
  - **IK Leg Composition:** The stick figure's legs are dynamically solved using `solveLimb` targeting the locomotion foot offsets, proving seamless integration between the locomotion and IK modules.

### 6. Squash & Stretch (`squash-stretch.png`)
- **Source:** `volumeScale` + `projectTurnedPart` from `src/animation/squash-stretch`
- **Description:** A dual-purpose visualization demonstrating volume-preserving scaling (left) and orthographic turning projection (right).
- **Key Features Demonstrated:**
  - **Volume Preservation:** On the left, a reference square (gold) is shown alongside its vertically stretched/horizontally squashed (orange) and vertically squashed/horizontally stretched (purple) states. The product of `scaleX * scaleY` is held at exactly `1.0`, preserving the visual area.
  - **Orthographic Turning:** On the right, a circular body (orange) with an attached child element/eye (dark purple) is shown at three facing angles: front-facing (`0°`), three-quarter (`45°`), and near-profile (`75°`).
  - **Horizontal Squash & Projection:** As the body turns, it squashes horizontally by `|cos(angle)|`, and the child element slides across the body via `localX * cos(angle)` while squashing itself, creating a convincing faked-3D depth effect on a flat 2D canvas.

---

## Gallery Composite (`gallery.png`)

A 3x2 grid composite of all six benchmark scenes, separated by a subtle divider. This serves as the public showcase image for the animation pillar.
