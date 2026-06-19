# Deterministic Jump & Walk Locomotion

> Research note for deterministic character locomotion (jumping and walking). Slug: `jump-walk-locomotion`.
> Investigated: 2026-06-19.

## TL;DR

Deterministic character locomotion beyond simple walk-in-place cycles requires a mathematical formulation that couples horizontal translation with vertical jump trajectory physics under a strict fixed-timestep constraint. The single most important finding of this research is that **jump trajectories should be parameterized by desired apex height ($H$) and time-to-apex ($T_{apex}$), rather than raw forces, to allow intuitive design while maintaining byte-identical replay determinism**. To achieve exceptional "game feel" within a zero-dependency library, we must combine this trajectory math with a pure state machine (managing coyote time, jump buffering, and squash/stretch offsets) and a walk-cycle phase accumulator that is driven by horizontal displacement rather than time (preventing "foot sliding"). We recommend keeping collision detection and input polling on the consumer/showcase side, while the library provides the pure mathematical solvers, state transitions, and pose blending.

## Why this matters for aicraft-engine

- **Pillars Touched**: Directly extends **Pillar 1 (Primitives / Animation)** and prepares for **Pillar 4 (Fake-3D / character stacks)**.
- **Consumer Games**: Sibling games like *Spitekeep* (and future platformers, RTS, or village builders) need characters that can traverse the screen, jump over obstacles, and land with satisfying physical weight without relying on heavy external physics engines or pre-baked sprite sheets.
- **Unlocks**:
  - **Perfect Replay Determinism**: Because the jump trajectory and walk-cycle synchronization are driven by pure, fixed-timestep math, game replays, multiplayer sync, and client-side prediction are 100% stable and identical across devices.
  - **Expressive "Toy-Like" Movement**: By integrating squash/stretch anticipation and landing impacts directly into the locomotion state, characters feel alive, bouncy, and tactile—matching the beloved Sokpop aesthetic.
  - **Zero-Asset Traversal**: Characters can walk, run, jump, and land across complex terrain using only vector rendering and procedural IK, maintaining our strict zero-runtime-dependency and ultra-low-bandwidth constraints.

---

## Prior Art Survey

### 1. Jump Trajectory Math (The Deterministic Core)
- **Source**: "Building a Better Jump" by Kyle Pittman (GDC 2016) & "Platformer Physics" by YoYo Games.
- **What it does**: Instead of forcing designers to guess raw gravity ($g$) and launch velocity ($v_0$), the jump is parameterized by **desired apex height ($H$)** and **time-to-apex ($T_{apex}$)**. This allows the designer to specify exactly how high and how long the jump should be.
  The physics equations are solved backward to derive the exact gravity and launch velocity:
  $$g = \frac{2H}{T_{apex}^2}$$
  $$v_0 = \frac{2H}{T_{apex}}$$
  Variable-height jumps (where holding the button jumps higher) are modeled deterministically by cutting the vertical velocity when the button is released. If the player releases the button while rising ($v_y > 0$), the velocity is instantly clamped to a minimum cutoff velocity ($v_{min} = v_0 \cdot \text{cutoffFactor}$) or gravity is multiplied by a "release multiplier" (e.g., $3\times$) for the remainder of the rise.
  To guarantee determinism, the trajectory is integrated using a fixed timestep (`dt`):
  ```typescript
  // Euler integration step
  vy += gravity * dt;
  y += vy * dt;
  ```
- **Determinism profile**: Pure mathematical operations. Fully deterministic under a fixed timestep.
- **Runtime cost**: Negligible ($O(1)$ per frame).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is completely pure and mathematically rigorous.
- **What to steal**: **Apex-height and time-to-apex parameterization**. This is the gold standard for platformer jump tuning.
- **What to avoid**: Avoid variable `dt` in the physics integration. If the host frame rate drops, naive variable `dt` integration will cause the jump height and trajectory to drift, breaking determinism.

### 2. Jump State Machines
- **Source**: "Celeste Movement" code analysis by Noel Berry & "Platformer Controls" on Game Developer.
- **What it does**: Manages the transitions between discrete locomotion states: `Grounded`, `Anticipation` (crouch before takeoff), `Rise` (rising), `Apex` (floaty peak), `Fall` (falling), and `Landing` (squashing on impact).
  To make the controls feel incredibly responsive, the state machine incorporates two critical "game feel" helpers:
  - **Coyote Time**: A brief grace period (typically 5–10 frames, ~0.08s) after leaving a ledge where the player can still jump.
  - **Jump Buffering**: Queues a jump input if pressed slightly before hitting the ground (typically 5–10 frames, ~0.1s), executing the jump instantly upon landing.
  In a deterministic library, these are modeled without wall-clock reads by using timer variables that decrement by the fixed `dt` each tick.
- **Determinism profile**: Pure state machine. Fully deterministic.
- **Runtime cost**: Extremely low ($O(1)$ state transitions).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It encapsulates the complex state logic of a high-quality platformer into a pure, testable state-transition function.
- **What to steal**: **Timer-based coyote time and jump buffering**. These must be driven by the simulation tick (`dt`), not `Date.now()`.
- **What to avoid**: Avoid coupling the state machine to direct keyboard listeners. The state machine must receive abstract input flags (`jumpPressed`, `jumpHeld`, `isGrounded`) passed in by the caller.

### 3. Jump + Walk Coupling (Airborne Posing)
- **Source**: "Sokpop Fake-3D Demo" & "Procedural Animation in 2D" by Jakob Wahlberg.
- **What it does**: When a character leaves the ground, continuing the walk cycle's foot-lift looks like they are "walking in air" (unless it's a cartoon flutter jump). To solve this, the walk cycle's phase accumulator is frozen or slowly decayed to a neutral phase when airborne, and the feet are blended toward a fixed "airborne tuck" pose.
  - **Tuck Pose**: The feet are drawn slightly upward and closer to the body center (e.g., left foot at $x = -2, y = -2$, right foot at $x = 2, y = -2$ relative to the hip) to simulate legs being tucked during flight.
  - **Momentum Carry**: The horizontal velocity at takeoff is preserved as airborne momentum, with the player having reduced horizontal acceleration (air control) compared to ground movement.
- **Determinism profile**: Pure pose blending. Fully deterministic.
- **Runtime cost**: Negligible ($O(1)$ vector blending).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It bridges the gap between the existing walk cycle (`locomotion.ts`) and the new jump trajectory, ensuring a cohesive visual output.
- **What to steal**: **Velocity-based leg tucking and phase freezing**. Freezing the phase prevents awkward leg swinging in mid-air.
- **What to avoid**: Avoid sudden pose snapping. Use a smooth blend factor ($\alpha \in [0, 1]$) that ramps up when leaving the ground and ramps down on landing.

### 4. Squash & Stretch on Jump (The "Feel")
- **Source**: "The 12 Principles of Animation in Game Design" & "Bouncy Platformer Physics" by Niles Mitchell.
- **What it does**: Applies volume-preserving scale transforms to the character's drawn shapes to sell the physical forces of jumping and landing:
  - **Anticipation (Crouch)**: 3 frames before takeoff, `scaleY` squashes to `0.8` (and `scaleX` stretches to `1.25` to preserve volume).
  - **Launch (Stretch)**: Upon leaving the ground, `scaleY` stretches to `1.15` (and `scaleX` squashes to `0.87`).
  - **Landing (Impact Squash)**: Upon hitting the ground, `scaleY` squashes to `0.7` (and `scaleX` stretches to `1.43`), proportional to the fall velocity.
  - **Recovery**: The landing squash decays back to `1.0` over 8–10 frames using a spring-damper or linear interpolation.
- **Determinism profile**: Pure scale calculations. Fully deterministic.
- **Runtime cost**: Negligible ($O(1)$ math).
- **Dependencies**: None (composes with the library's existing `volumeScale` in `squash-stretch.ts`).
- **Fit for our constraints**: Strong. It uses our existing `volumeScale` primitive to add immense juicy game feel.
- **What to steal**: **Velocity-proportional landing squash**. The harder the fall, the deeper the squash, capped at a safe minimum (e.g., `scaleY = 0.6`).
- **What to avoid**: Avoid letting the squash scale persist too long, which makes the character feel "mushy" or unresponsive. Keep the recovery snappy (8–12 frames).

### 5. Prior-Art Implementations Worth Studying
- **Source**: Sokpop Collective platformers (*Fishy 3D*, *Pear Quest*, *Temple of Rubbo*) & *Celeste* jump tuning.
- **What it does**:
  - **Sokpop**: Focuses heavily on toy-like, bouncy physics. Their jumps feel extremely responsive because they use short anticipation windows (2–3 frames) and highly pronounced landing squashes that recover quickly.
  - **Celeste**: Uses a highly tuned physics model with extensive corner correction, variable gravity (lower gravity at the apex), and generous coyote time (5 frames) and jump buffering (5 frames).
  - **JS13k Platformers**: Use extremely compact, deterministic Euler integration loops to fit within the 13KB limit, showing that high-quality platforming can be written in under 100 lines of pure TS/JS.
- **Determinism profile**: Varied, but the core physics and state logic are easily made 100% deterministic.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. They provide the exact target "feel" and implementation simplicity we need.
- **What to steal**: **Sokpop's rapid landing recovery** (gives a snappy, toy-like feel) and **Celeste's jump buffering** (essential for precision).
- **What to avoid**: Avoid complex collision response models (like sliding along sloped walls) in the core library; keep the library focused on trajectory and posing.

### 6. How Existing JS Game Libraries Expose Jump
- **Source**: Kaboom.js (`body.jump()`), Phaser (Arcade Physics `velocity.y`), and Matter.js.
- **What it does**:
  - **Kaboom.js**: Highly opinionated and coupled to its internal physics engine. You call `player.jump(force)` and the engine handles gravity and collision. Hard to customize or make deterministic across network clients.
  - **Phaser**: Low-level physics. You set `body.velocity.y = -jumpForce`. The developer must write all the state machines, squash/stretch, and coyote time from scratch.
  - **Matter.js**: Rigid-body physics engine. Overkill for minimalist 2D platformers, non-deterministic across platforms, and prone to the "sliding block" friction problem.
- **Determinism profile**: Mostly non-deterministic (especially Matter.js) or highly coupled to the DOM/renderer.
- **Fit for our constraints**: Weak. We need a zero-dependency, headless, fully deterministic solver.
- **What to steal**: **Headless separation**. The library should provide the mathematical and state-machine core, completely decoupled from any physics engine or drawing context.
- **What to avoid**: Avoid coupling jump logic to a specific physics body or renderer.

### 7. Deterministic Testing Patterns for Jump/Walk
- **Source**: "Deterministic Physics Testing" by Glenn Fiedler (Gaffer on Games) & "Property-Based Testing in JavaScript" (fast-check).
- **What it does**:
  - **Golden Testing**: A test feeds a fixed sequence of inputs (e.g., `[JumpDown, JumpUp, Wait]`) to the state machine and integrates it over 120 frames. The resulting positions and scales are recorded and asserted against a "golden array," ensuring that any changes to the code do not break the trajectory or determinism.
  - **Property-Based Testing**: Asserts mathematical invariants, such as:
    - *Symmetry*: A jump with no horizontal movement must have a symmetric rise and fall trajectory.
    - *Clamping*: The character's scale factors must never drop below `MIN_SCALE_Y` or exceed `MAX_SCALE_Y`.
- **Determinism profile**: 100% deterministic.
- **Runtime cost**: Run only during testing (Vitest).
- **Dependencies**: Vitest (dev-only).
- **Fit for our constraints**: Strong. It guarantees that our core locomotion remains bulletproof and deterministic across all platforms.
- **What to steal**: **Fixed-input golden trajectory tests**.
- **What to avoid**: Avoid testing with variable `dt` in the golden tests; always use a fixed `dt` (e.g., `1/60`) to guarantee identical floating-point results.

### 8. Walking (Horizontal Translation) & Walk-Translation Sync
- **Source**: "Foot Sliding in Procedural Animation" by Overgrowth Devlog (Wolfire Games).
- **What it does**: Naive walking animations advance the walk cycle phase based on *time* (`phase += dt`), while horizontal translation is driven by *speed* (`x += speed * dt`). If speed changes, the feet appear to "slide" across the ground because the animation cadence doesn't match the physical movement.
  To solve this, the walk cycle phase is **coupled directly to horizontal displacement**:
  $$dPhase = \frac{dx}{\text{strideLength} \cdot \pi}$$
  This guarantees that the feet move in perfect sync with the ground. When the character stops moving ($dx = 0$), the phase stops advancing, and the feet remain planted.
  Furthermore, the existing `foot-lock.ts` module can be used to pin the feet to world coordinates while they are in the grounded phase, blending back to the animated position during the lift phase.
- **Determinism profile**: Pure mathematical coupling. Fully deterministic.
- **Runtime cost**: Negligible ($O(1)$ math).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It solves the hardest visual problem of procedural walking (foot sliding) using simple, pure math.
- **What to steal**: **Displacement-driven phase accumulation**.
- **What to avoid**: Avoid advancing the phase when the character is blocked by a wall (where $dx = 0$ but the player is still holding the walk button). The phase must be driven by *actual displacement*, not intended speed.

---

## Library vs Showcase: Where Does Each Piece Live?

To maintain our strict architecture, we must divide the locomotion features cleanly between the core library (`src/`) and the interactive showcase/examples:

| Feature / Responsibility | Where it Lives | Why |
|---|---|---|
| **Jump Trajectory Solver** | **Library (`src/animation/jump.ts`)** | Pure physics math ($g$ and $v_0$ derivation, Euler integration) that must be 100% deterministic and reusable. |
| **Jump State Machine** | **Library (`src/animation/jump.ts`)** | Pure state transitions (`Grounded` $\rightarrow$ `Rise` $\rightarrow$ `Fall` $\rightarrow$ `Landing`), coyote time timers, and jump buffering. Decoupled from inputs (receives raw flags). |
| **Locomotion Sync & Blending** | **Library (`src/animation/locomotion.ts`)** | Coupling walk phase to horizontal displacement ($dx$) and blending feet offsets to airborne tuck poses. |
| **Squash & Stretch Math** | **Library (`src/animation/squash-stretch.ts`)** | Volume-preserving scale calculations (`volumeScale`) and transient squash/stretch offset generators. |
| **Input Polling (Keyboard/Touch)** | **Showcase / Consumer Game** | Non-deterministic host API interaction. The showcase listens to keys and passes `jumpPressed: boolean` to the library. |
| **Collision Detection (Floor/Ceiling)** | **Showcase / Consumer Game** | Highly game-specific. The showcase runs its own tilemap or AABB collisions and tells the library `isGrounded = true` or `hitCeiling = true`. |
| **Canvas Drawing Loop** | **Showcase / Consumer Game** | Renderer-layer concern. The showcase takes the offsets and scale factors returned by the library and draws the character stack. |

---

## Reference Implementations

- **GDC 2016 - Building a Better Jump** ([gdcvault.com/play/1023384](https://www.gdcvault.com/play/1023384/Building-a-Better-Jump-Math)): The definitive mathematical breakdown of apex-based jump parameterization.
- **Celeste Player Physics Source** ([github.com/NoelFB/Celeste](https://github.com/NoelFB/Celeste/blob/master/Source/Player/Player.cs)): Reference for coyote time, jump buffering, and variable jump height implementation details.
- **Wolfire Games - Overgrowth Devlog** ([blog.wolfire.com](https://blog.wolfire.com/2009/11/procedural-animation-foot-sliding/)): The classic reference for solving foot-sliding via displacement-driven animation.
- **Sokpop Fake-3D Demo** ([sokpop.itch.io/sokpop-fake-3d-demo](https://sokpop.itch.io/sokpop-fake-3d-demo)): Reference for character construction, billboarding, and primitive stacking.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| `docs/research/procedural-locomotion.md` | Trigonometric walk cycle formulas and hip-bobbing curves | Local |
| `src/tests/squash-stretch.test.ts` | Volume-preserving scale invariants ($s_x \cdot s_y = 1$) | Local |
| Celeste Jump Curves | Apex hang-time gravity scaling and snappier fall trajectories | Celeste Dev Blog |

---

## Open Questions

- **Air Control Parameterization**:
  How should horizontal movement in mid-air be parameterized? Should the library provide a pure air-acceleration and air-friction solver, or should the consumer handle horizontal air movement and simply pass the resulting displacement ($dx$) to the library?
  *Recommendation*: The consumer should handle horizontal movement (since it is highly coupled to game-specific physics and collisions) and pass the actual displacement ($dx$) to the library, which then updates the walk phase and tuck blends.
- **Landing Squash Recovery Curve**:
  Should the landing squash recovery use a simple linear interpolation, an exponential decay, or a full spring-damper solver (using `src/animation/spring.ts`)?
  *Recommendation*: A spring-damper solver provides the most organic, bouncy "Sokpop-style" recovery. The library should provide a helper that connects the landing squash state to a spring.

---

## Top 3 Patterns Worth Adopting

1. **Apex-Parameterized Jump Solver (`JumpConfig` $\rightarrow$ `JumpState`)**
   - *Why*: It completely eliminates the guesswork of jump tuning. Designers specify `apexHeight` (px) and `timeToApex` (seconds), and the library derives the exact gravity and launch velocity. It updates via a pure `advanceJump(state, inputs, dt, config)` function, guaranteeing 100% determinism.
2. **Displacement-Driven Locomotion Phase Accumulator**
   - *Why*: It solves the "foot-sliding" problem elegantly and deterministically. By advancing the walk cycle phase based on actual horizontal displacement ($dx$) rather than time, the character's feet remain perfectly pinned to the ground when walking, running, or stopping.
3. **Transient Squash/Stretch State Machine with Spring Recovery**
   - *Why*: It delivers the juicy, bouncy "game feel" of professional platformers in a pure, zero-dependency mathematical package. It manages the crouch, stretch, and landing squash states, using our existing `volumeScale` and spring solvers to smoothly recover on impact.

---

## Cross-References

- `docs/research/procedural-locomotion.md` (the foundational walk cycle research)
- `src/animation/locomotion.ts` (existing walk cycle implementation)
- `src/animation/squash-stretch.ts` (existing volume-preserving scale helpers)
- `src/animation/foot-lock.ts` (foot-pinning logic)
- `docs/architecture.md` (determinism and layer separation rules)
