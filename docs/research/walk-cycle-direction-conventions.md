# Walk Cycle Direction and Phase Conventions

> Research note for procedural walk-cycle phase conventions, foot-lift alignment, and facing-direction coupling. Slug: `walk-cycle-direction-conventions`.
> Investigated: 2026-06-19.

## TL;DR

Procedural walk cycles require a precise mathematical alignment between horizontal foot swing (stance/swing) and vertical foot lift (grounded/airborne) to prevent unnatural "moonwalking" artifacts. Our investigation of animation theory (e.g., Richard Williams' *The Animator's Survival Kit*) and game-engine conventions (e.g., Unreal, Unity, and Wolfire's *Overgrowth*) confirms that **the foot must lift during the forward-moving swing phase (back-to-front) and stay grounded during the backward-moving stance phase (front-to-back)**. Furthermore, to handle facing direction without visual glitches, **the gait phase must be driven by local-space displacement ($dx \cdot \text{facing}$) rather than world-space displacement ($dx$)**. This elegant formulation guarantees correct forward walking in both directions when combined with standard horizontal rendering mirroring (`ctx.scale(facing, 1)`), while naturally enabling authentic backpedaling when moving opposite to the facing direction.

## Why this matters for aicraft-engine

- **Pillars Touched**: Extends **Pillar 1 (Primitives / Animation)** and prepares for **Pillar 4 (Fake-3D / character stacks)**.
- **Consumer Games**: *the reference implementation* (and future platformers or RTS titles) require characters that can walk left and right across complex terrain, jump, and backpedal without foot sliding, sudden animation pops, or awkward moonwalking.
- **Unlocks**:
  - **Flawless Side-View Traversal**: Eliminates the "moonwalk" bug where characters appear to glide backward while their feet swing backwards in the air.
  - **Robust Facing Transitions**: Solves the "double-reversal" bug where walking left reverses the phase while horizontal mirroring also flips the geometry, resulting in a broken visual cycle.
  - **Procedural Backpedaling**: Seamlessly supports characters retreating/backing away from hazards or enemies with correct backward-stepping animation, driven purely by the same mathematical core.

---

## Prior Art Survey

### Pattern 1: Swing/Stance Phase Alignment (Foot-Lift Half-Cycle)
- **Source**: Richard Williams' *The Animator's Survival Kit*, Preston Blair's *Cartoon Animation*, and Processing/p5.js procedural walk cycle sketches.
- **What it does**: A standard walk cycle consists of two main phases per foot:
  1. **Stance Phase (Support)**: The foot is planted on the ground (`y = 0`) and moves *backward* relative to the body (front-to-back, $+stride \rightarrow -stride$) as the body moves forward over it.
  2. **Swing Phase (Recovery)**: The foot lifts off the ground (`y > 0`) and swings *forward* relative to the body (back-to-front, $-stride \rightarrow +stride$) to take the next step.
  In a trigonometric walk cycle, if horizontal position is driven by $\cos(\phi)$ and vertical lift by $\max(0, \sin(\phi))$, the foot lifts when $\phi \in [0, \pi]$. During this half-cycle, $\cos(\phi)$ goes from $+1$ to $-1$ (moving backward). This means the foot is lifted while moving backward, and grounded while moving forward—the exact definition of "moonwalking." Flipping the lift half-cycle to $\max(0, -\sin(\phi))$ aligns the lift with the forward swing ($\phi \in [\pi, 2\pi]$ where $\cos(\phi)$ goes from $-1$ to $+1$).
- **Algorithmic shape**:
  ```typescript
  // Let phi be the gait phase in [0, 2pi)
  // Stance phase (phi in [0, pi]): foot is grounded (y = 0), moves front-to-back (cos goes +1 -> -1)
  // Swing phase (phi in [pi, 2pi]): foot is lifted (y > 0), moves back-to-front (cos goes -1 -> +1)
  const leftFootOffset: Vec2 = {
    x: Math.cos(phi) * config.strideLength,
    y: Math.max(0, -Math.sin(phi)) * config.strideHeight,
  };

  // Right foot is pi radians out of phase
  const phiRight = phi + Math.PI;
  const rightFootOffset: Vec2 = {
    x: Math.cos(phiRight) * config.strideLength,
    y: Math.max(0, -Math.sin(phiRight)) * config.strideHeight,
  };
  ```
- **Determinism profile**: Pure mathematical operations. Fully deterministic.
- **Runtime cost**: Negligible ($O(1)$ per frame).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It corrects the mathematical alignment without adding any runtime overhead or dependencies.
- **What to steal**: The negative sine lift alignment (`-sin(phi)`) to synchronize vertical lift with the forward-moving swing phase.
- **What to avoid**: Naive positive sine lift (`sin(phi)`) when using un-shifted cosine for horizontal swing.

### Pattern 2: Local-Space Displacement Coupling
- **Source**: Unreal Engine / Unity locomotion blend spaces, and Wolfire Games' *Overgrowth* anti-foot-slide devlog.
- **What it does**: In professional locomotion systems, character animations are driven by *local-space* velocities (e.g., `ForwardSpeed`, `StrafeSpeed`) rather than world-space velocities. When translating this to a 2D side-scroller, the local displacement is the displacement along the character's facing direction: $dx_{local} = dx \cdot \text{facing}$.
  - When walking in the facing direction (e.g., walking right while facing right, or walking left while facing left), $dx_{local}$ is positive, and the gait phase advances forward ($\phi$ increases).
  - When backpedaling (e.g., walking left while facing right, or walking right while facing left), $dx_{local}$ is negative, and the gait phase runs backward ($\phi$ decreases), producing a correct backward walk cycle.
  Using world-space signed $dx$ to drive the phase is a category error that fails when the character is mirrored horizontally.
- **Algorithmic shape**:
  ```typescript
  // In the game loop / showcase:
  const localDx = dx * facing; // positive = moving forward locally, negative = backpedaling
  locoState = advanceLocomotionByDisplacement(locoState, localDx, config);
  ```
- **Determinism profile**: Pure mathematical operations. Fully deterministic.
- **Runtime cost**: Negligible ($O(1)$ per frame).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It solves the facing-direction coupling elegantly at the integration boundary.
- **What to steal**: Coupling the gait phase to local-space displacement ($dx \cdot \text{facing}$) to support both forward walking and backpedaling.
- **What to avoid**: Passing world-space signed $dx$ to the phase accumulator when the renderer also applies a horizontal mirror.

### Pattern 3: Monotonic Phase with Horizontal Mirroring
- **Source**: Spine/DragonBones 2D skeletal animation, and classic 2D platformers (*Celeste*, *Hollow Knight*, *Sokpop* titles).
- **What it does**: In 2D side-scrolling games, characters are modeled and animated facing a single direction (usually right). When the character turns left, the rendering engine simply mirrors the entire character horizontally (`ctx.scale(-1, 1)` or `scaleX = -1`). The underlying animation phase continues to increase monotonically. The horizontal mirror automatically flips the horizontal coordinates of the bones/limbs, converting a right-facing forward walk into a left-facing forward walk.
  If the animation phase is reversed when walking left *while* the geometry is mirrored, a "double-reversal" occurs: the mirror flips the horizontal axis, and the reversed phase flips the horizontal movement of the feet in the cycle. These two flips cancel out, causing the character to moonwalk to the left.
- **Algorithmic shape**:
  ```typescript
  // Standard 2D rendering mirror pattern:
  ctx.save();
  ctx.translate(charCx, 0);
  ctx.scale(facing, 1); // facing is +1 (right) or -1 (left)
  ctx.translate(-charCx, 0);
  // Draw character using local (right-facing) offsets
  ctx.restore();
  ```
- **Determinism profile**: Pure rendering transform. Fully deterministic.
- **Runtime cost**: Negligible.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is the industry-standard way to handle 2D character facing.
- **What to steal**: Keeping the core gait phase monotonically increasing for forward walk, and letting the horizontal mirror handle the visual direction.
- **What to avoid**: Attempting to reverse the gait phase in world-space while also mirroring the geometry.

---

## Reference Implementations

- **The Animator's Survival Kit** (Richard Williams, Chapter on Walks): The definitive reference on swing vs. stance phase mechanics, detailing how the foot must lift off the ground as it begins its forward swing and plant as it reaches the front.
- **Wolfire Games - Overgrowth Devlog** ([blog.wolfire.com](https://blog.wolfire.com/2009/11/procedural-animation-foot-sliding/)): Explains how foot-sliding is eliminated by coupling gait phase to local-space displacement.
- **Sokpop Fake-3D Demo** ([sokpop.itch.io/sokpop-fake-3d-demo](https://sokpop.itch.io/sokpop-fake-3d-demo)): Reference for horizontal mirroring (`scaleX = facing`) of procedural character stacks while keeping animation phase progression independent of facing.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Williams' Walk Diagrams | Foot height is 0 during stance (front-to-back) and peaks at the midpoint of the swing (back-to-front). | *The Animator's Survival Kit* |
| Overgrowth Foot-Locking | Feet remain perfectly pinned to the ground during the stance phase, sliding only when the phase is driven by incorrect displacements. | Wolfire Devlog |

---

## Open Questions

- **Should the library enforce local-space displacement internally?**
  Should `advanceLocomotionByDisplacement` accept `facing` as an optional parameter and perform `dx * facing` internally, or should it remain a pure displacement integrator and leave the local-space conversion to the consumer?
  *Recommendation*: Keep the library function as a pure displacement integrator (`advanceLocomotionByDisplacement(state, dx, config)`) but update its JSDoc to explicitly warn that `dx` must be *local-space displacement* ($dx \cdot \text{facing}$) when horizontal mirroring is used. This preserves the library's generality (it doesn't assume a specific mirroring/facing model) while guiding the consumer to the correct integration pattern.

---

## Top 2 Patterns Worth Prototyping

1. **Aligned Swing/Stance Trigonometric Pose Generator**
   - *Why*: Changing `max(0, sin(phi))` to `max(0, -sin(phi))` in `evaluateLocomotion` aligns the vertical foot lift with the forward horizontal swing. This is a zero-cost, mathematically elegant fix that completely eliminates the "moonwalking" bug.
2. **Local-Space Displacement Integration Boundary**
   - *Why*: Passing `dx * facing` to `advanceLocomotionByDisplacement` in the showcase/renderer ensures the gait phase increases monotonically when walking forward (left or right) and decreases when backpedaling. This eliminates the "double-reversal" bug and adds native support for backpedaling.

---

## Cross-References

- `docs/research/procedural-locomotion.md` (the foundational walk cycle research)
- `docs/design/jump-walk-proposal.md` (the API proposal that introduced displacement-driven walking)
- `src/animation/locomotion.ts` (the module containing the walk cycle implementation under review)
- `showcase/helpers/slime-knight.ts` (the canonical showcase renderer exhibiting the bugs)
