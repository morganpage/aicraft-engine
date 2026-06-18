# Procedural Locomotion

> Research note for procedural locomotion and animation. Slug: `procedural-locomotion`.
> Investigated: 2026-06-18.

## TL;DR

Procedural locomotion replaces traditional keyframed animations with real-time mathematical formulations, generating expressive, dynamic, and adaptive movement entirely in code. This note surveys three key sub-techniques: **trigonometric locomotion** (sine/cosine waves driving foot and hip offsets), **squash, stretch & offset** (volume-preserving scaling to simulate breathing, weight, and turning), and **physics-based spring chains** (Verlet-based secondary dynamics for hair, tails, and cloaks). For `aicraft-engine`—a zero-runtime-dependency, deterministic Canvas2D library—these techniques enable rich character animation without the memory footprint of spritesheets or pre-recorded skeletal data. We identify **Verlet Integration with Position-Based Constraints (Verlet-PBD)** as the superior formulation for secondary dynamics due to its unconditional stability and deterministic behavior under a fixed timestep.

## Why this matters for aicraft-engine

- **Pillars Touched**: Directly extends **Pillar 1 (Primitives / Animation)** and feeds into **Pillar 4 (Fake-3D / character stacks)**.
- **Consumer Games**: Sibling games like *Spitekeep* (or future Clone-to-Jest titles like a card-based village builder or procedural RTS) need lively, responsive characters without the memory overhead of spritesheets or Spine files.
- **Unlocks**:
  - **Zero-Asset Animation**: Characters are animated entirely via math, meaning we can ship hundreds of unique cosmetic skins (Pillar 2) that share the same locomotion code with zero extra asset bytes.
  - **Adaptive Gaits**: Walk and run cycles dynamically scale their frequency, stride, and bobbing based on the character's actual velocity and terrain, avoiding "foot sliding."
  - **Organic Game Feel**: Secondary elements like hair, cloaks, and tails lag and sway naturally in response to parent movement, creating a high-fidelity feel from simple vector shapes.

---

## Prior Art Survey

### Pattern 1: Trigonometric Locomotion
- **Source**: "Modern Computational Pipelines for 2D Procedural Character Production" & Sokpop Collective.
- **What it does**: Simulates walking/running animations by oscillating limb parts (feet, hips) using phase-shifted trigonometric waves (sine, cosine) parameterized by velocity and time. Feet move in forward/backward sine waves and lift in positive-clamped cosine waves, while the hips bob vertically at double the frequency to simulate weight transfer.
- **Algorithmic shape**:
  ```typescript
  export interface GaitConfig {
    baseFrequency: number;  // Cycles per unit of speed per tick
    strideLength: number;   // Horizontal foot amplitude
    strideHeight: number;   // Vertical foot lift amplitude
    hipBobHeight: number;   // Hip vertical bob amplitude
    hipSwayWidth: number;   // Hip horizontal sway amplitude
  }

  export interface LocomotionState {
    phase: number;          // Accumulated phase in radians [0, 2pi)
  }

  export interface LocomotionPose {
    hipOffset: { x: number; y: number };
    leftFootOffset: { x: number; y: number };
    rightFootOffset: { x: number; y: number };
  }

  /**
   * Pure state progression. Integrates phase based on current speed
   * to prevent visual "phase jumps" when speed changes.
   */
  export function advanceLocomotion(
    state: LocomotionState,
    speed: number,
    dt: number,
    config: GaitConfig
  ): LocomotionState {
    const dPhase = speed * config.baseFrequency * Math.PI * 2 * dt;
    return {
      phase: (state.phase + dPhase) % (Math.PI * 2)
    };
  }

  /**
   * Pure pose generator. Computes offsets relative to the character root.
   */
  export function evaluateLocomotion(
    state: LocomotionState,
    config: GaitConfig
  ): LocomotionPose {
    const phi = state.phase;

    // Left foot: standard phase
    const lFootX = Math.cos(phi) * config.strideLength;
    // Lift foot only during the forward swing phase (positive sine)
    const lFootY = Math.max(0, Math.sin(phi)) * config.strideHeight;

    // Right foot: 180 degrees (pi radians) out of phase
    const phiRight = phi + Math.PI;
    const rFootX = Math.cos(phiRight) * config.strideLength;
    const rFootY = Math.max(0, Math.sin(phiRight)) * config.strideHeight;

    // Hip bobs twice per cycle (once for each foot step)
    const hipY = -Math.abs(Math.sin(phi)) * config.hipBobHeight;
    // Hip sways horizontally out of phase with the feet
    const hipX = Math.sin(phi) * config.hipSwayWidth;

    return {
      hipOffset: { x: hipX, y: hipY },
      leftFootOffset: { x: lFootX, y: lFootY },
      rightFootOffset: { x: rFootX, y: rFootY }
    };
  }
  ```
- **Determinism profile**: Pure mathematical operations. Fully deterministic.
- **Runtime cost**: Extremely cheap (per-frame evaluation is just a few `Math.sin`/`Math.cos` calls, $O(1)$).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is completely zero-dependency and pure, mapping directly to our Canvas2D rendering model.
- **What to steal**: **Phase integration as a state variable**. If speed is variable, direct multiplication `tick * speed` causes violent phase jumps and visual glitching when speed changes. Integrating phase (`phase += speed * dt`) guarantees smooth transitions.
- **What to avoid**: Avoid hardcoding phase offsets or frequencies. Different characters (e.g., a heavy troll vs. a fast spider) need different step counts and phase relations. Keep parameters completely configurable.

---

### Pattern 2: Squash, Stretch & Offset
- **Source**: "I procedurally animated the 2D characters in my game" devlog & Sokpop's character construction method.
- **What it does**: Manipulates the scale (`sx`, `sy`) and relative offsets of simple 2D shapes to simulate breathing, turning, and velocity-based impact/momentum. By squashing width and stretching height (or vice versa) while preserving volume, we can fake organic muscle movement, landing impacts, and even 3D rotation (by squashing a part along the turning axis and shifting its child elements).
- **Algorithmic shape**:
  ```typescript
  export interface SquashStretchState {
    scaleX: number;
    scaleY: number;
  }

  /**
   * Volume-preserving scale calculation.
   * Ensures that area remains constant: scaleX * scaleY = 1.
   * @param deltaY - vertical scale offset (e.g. 0.1 for 10% stretch, -0.1 for 10% squash)
   */
  export function getVolumePreservedScale(deltaY: number): SquashStretchState {
    const sy = 1.0 + deltaY;
    const safeSy = Math.max(0.05, sy); // Prevent division by zero or negative scale
    return {
      scaleX: 1.0 / safeSy,
      scaleY: safeSy
    };
  }

  /**
   * Ambient breathing (idle cycle).
   */
  export function evaluateBreathing(
    tick: number,
    speed: number,
    amplitude: number
  ): SquashStretchState {
    const deltaY = Math.sin(tick * speed * Math.PI * 2) * amplitude;
    return getVolumePreservedScale(deltaY);
  }

  /**
   * Orthographic turning (Sokpop-style faked depth).
   * Squashes a part horizontally and offsets its child elements based on facing angle.
   */
  export function projectTurnedPart(
    localX: number,
    localY: number,
    facingAngle: number // 0 = front, pi/2 = profile/right
  ): { x: number; y: number; sx: number; sy: number } {
    const sx = Math.cos(facingAngle);
    const projectedX = localX * Math.cos(facingAngle);
    return {
      x: projectedX,
      y: localY,
      sx: Math.abs(sx),
      sy: 1.0
    };
  }
  ```
- **Determinism profile**: Pure function of tick or state. Completely deterministic.
- **Runtime cost**: Negligible ($O(1)$).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It allows us to build expressive, organic-feeling characters using only basic Canvas2D drawing commands (like `ctx.scale` or custom ellipse rendering) with zero sprite assets.
- **What to steal**: **Volume-preserving scaling ($s_x = 1/s_y$)** ensures characters look organic and don't feel like they are just shrinking or growing. Orthographic squashing ($s_x = \cos(\theta)$) and offset shifting are incredibly powerful for faking 3D rotation on a 2D canvas.
- **What to avoid**: Avoid applying raw scale factors directly to the rendering context without restoring it (`ctx.save()` / `ctx.restore()`), as scaling can accumulate and distort subsequent drawing operations. Avoid letting scale drop to or below zero.

---

### Pattern 3: Physics-Based Spring Chains (Secondary Elements)
- **Source**: *Rain World* procedural physics & "Exploring Procedural Design In Rain World: The Watcher".
- **What it does**: Simulates secondary elements (tails, hair, cloaks, antennae) as a chain of nodes connected by springs and angular constraints. The root node is anchored to the parent skeleton, and subsequent nodes react to gravity, drag, and parent acceleration.
- **Algorithmic shape**:
  We represent the chain as a flat array of nodes. To achieve maximum stability, we use **Verlet Integration with Position-Based Distance Constraints (PBD)**.
  ```typescript
  export interface VerletNode {
    x: number;
    y: number;
    prevX: number;
    prevY: number;
  }

  export interface SpringChainConfig {
    segmentLength: number;
    gravityX: number;
    gravityY: number;
    drag: number;                 // 0 = complete drag, 1 = no drag (e.g. 0.95)
    constraintIterations: number; // usually 1 to 3 is plenty for secondary elements
  }

  /**
   * Pure state progression update for a single node chain.
   * Matches the `src/particles/advance.ts` pattern: takes state in, returns a new cloned state.
   */
  export function advanceSpringChain(
    nodes: readonly VerletNode[],
    anchorX: number,
    anchorY: number,
    dt: number, // Must be a fixed timestep for determinism
    config: SpringChainConfig
  ): VerletNode[] {
    if (nodes.length === 0) return [];

    // 1. Clone nodes to maintain pure progression discipline
    const next: VerletNode[] = nodes.map(n => ({ ...n }));

    // 2. Set root node directly to anchor (infinite mass / immovable)
    next[0].x = anchorX;
    next[0].y = anchorY;
    next[0].prevX = anchorX;
    next[0].prevY = anchorY;

    // 3. Verlet Integration step for all other nodes
    for (let i = 1; i < next.length; i++) {
      const n = next[i];
      // Velocity is implied by the difference between current and previous position
      const vx = (n.x - n.prevX) * config.drag;
      const vy = (n.y - n.prevY) * config.drag;

      // Save current position as previous
      n.prevX = n.x;
      n.prevY = n.y;

      // Apply velocity and external forces (gravity)
      n.x = n.x + vx + config.gravityX * dt * dt;
      n.y = n.y + vy + config.gravityY * dt * dt;
    }

    // 4. Satisfy distance constraints (Position-Based Dynamics)
    for (let iter = 0; iter < config.constraintIterations; iter++) {
      for (let i = 1; i < next.length; i++) {
        const prevNode = next[i - 1];
        const currNode = next[i];

        const dx = currNode.x - prevNode.x;
        const dy = currNode.y - prevNode.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance === 0) continue;

        const difference = config.segmentLength - distance;
        const offsetX = (dx / distance) * difference;
        const offsetY = (dy / distance) * difference;

        if (i === 1) {
          // Node 0 is the anchor and is immovable
          // Node 1 absorbs 100% of the correction
          currNode.x += offsetX;
          currNode.y += offsetY;
        } else {
          // Both nodes are free to move; each absorbs 50% of the correction
          prevNode.x -= offsetX * 0.5;
          prevNode.y -= offsetY * 0.5;
          currNode.x += offsetX * 0.5;
          currNode.y += offsetY * 0.5;
        }
      }
    }

    return next;
  }
  ```
- **Determinism profile**: Pure function of input nodes, anchor, and config. Completely deterministic **provided the timestep `dt` is fixed**.
- **Runtime cost**: Very low. For a chain of 5-10 nodes with 2 iterations, the cost is a few dozen floating-point operations and square roots per frame ($O(N)$ where $N$ is chain length).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It provides beautiful, fluid, organic movement for tails, cloaks, and hair with zero assets, and fits perfectly into our pure-progression-ops architecture (similar to `src/particles/advance.ts`).
- **What to steal**: **Position-Based Dynamics (PBD) with Verlet integration**. PBD is unconditionally stable (it never blows up, even under extreme forces or large timesteps), handles rigid distance constraints perfectly, and is incredibly simple to implement in zero-dep TS.
- **What to avoid**: Avoid variable `dt` in the physics update. Avoid large numbers of constraint iterations ($>5$) which are unnecessary for secondary elements and increase CPU cost.

---

## Reference Implementations

- **Sokpop Fake-3D Demo** ([sokpop.itch.io/sokpop-fake-3d-demo](https://sokpop.itch.io/sokpop-fake-3d-demo)): Teaches character construction via primitive stacks with relative offsets, demonstrating how simple transformations create the illusion of 3D.
- **Rain World Physics / Movement** ([github.com/rw-modding/RainWorldDocs](https://github.com/rw-modding/RainWorldDocs)): Teaches procedural physics and rigid chunks entirely replacing traditional keyframed skeletons.
- **p5.js Spring Chain Examples** ([p5js.org/examples/input-constrain.html](https://p5js.org/examples/input-constrain.html)): Teaches basic spring-mass-damper physics and constraint logic.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Primitive Stack Walk | How feet oscillating in sine/cosine waves combined with hip bobbing creates a convincing walk cycle. | Sokpop Fake-3D Demo |
| Volume-Preserving Squash/Stretch | A character squashing on impact and stretching during jumps while keeping area constant. | "I procedurally animated the 2D characters" |
| Verlet Rope/Tail Chain | A chain of nodes lagging behind an anchor point, creating fluid secondary motion for tails/hair. | *Rain World* Case Study |

---

## Open Questions

- **The Fixed-Timestep Integration Requirement**:
  Verlet integration is highly dependent on a **fixed timestep (`dt`)**. If `dt` varies (due to frame rate drops or host lag), the implied velocities and force integrations will drift, causing non-deterministic physics simulation across different clients or replays.
  Should the library mandate that the caller wrap physics-based spring updates in a fixed-timestep accumulator (e.g., always update physics at exactly 60Hz with `dt = 1`), or should the library's internal `advanceSpringChain` function handle its own sub-stepping/accumulation?
  *Recommendation*: The library should provide the pure `advanceSpringChain` assuming a fixed `dt`, and document that the caller must run it within a fixed-timestep loop if cross-device determinism is required.

- **Reduced Motion Adaptation**:
  `src/primitives/motion.ts` exposes `prefersReducedMotion()`.
  How should the procedural locomotion and squash/stretch systems adapt when reduced motion is active?
  *Recommendation*: Locomotion and breathing amplitudes should be scaled down by a factor of 0.2, and screen-shake should be completely disabled. This ensures accessibility compliance (WCAG 2.x) while maintaining the structural positioning of limbs.

---

## Top 3 Patterns Worth Prototyping

1. **Verlet-PBD Spring Chain Integrator** — Prototyping a pure, non-mutating Verlet-PBD chain update (matching the `src/particles/advance.ts` pattern) to prove its stability and deterministic nature for tails/hair.
2. **Phase-Integrated Trigonometric Locomotion** — Prototyping a walk cycle that integrates phase based on a variable speed parameter, proving that transitions between idle, walking, and running are completely smooth and free of phase-jump glitches.
3. **Volume-Preserving Squash & Stretch Transform Matrix** — Prototyping a helper that takes a vertical scale offset and returns a 2D transform matrix, proving that we can easily apply organic squash/stretch to any Canvas2D rendering call.

---

## Cross-References

- `docs/research/skeletal-rigging.md` (hierarchical bone transforms that this locomotion drives)
- `docs/architecture.md` (determinism rules and layer separation)
- `src/primitives/animation.ts` (existing sine-based animation helpers like `bob` and `pulse`)
- `src/particles/advance.ts` (canonical pure-progression-ops pattern)
- `src/primitives/motion.ts` (cached reduced-motion probe)
