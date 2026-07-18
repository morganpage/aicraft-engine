# Spring Rod Primitive Benchmarks

This directory contains visual benchmark renders for the stable springy-rod primitive (`src/animation/spring-rod.ts`). These renders serve as the visual quality assurance gate, confirming that the mathematical implementation of the unified, blowout-proof solver for secondary-dynamics rods (antennae, tails, manes, capes) produces correct, stable, and aesthetically beautiful results under both normal and extreme conditions.

## How to Reproduce

To regenerate this gallery PNG, run the following command from the workspace root:

```bash
npx tsx benchmarks/_scripts/spring-rod-render.ts
```

This script executes the deterministic spring-rod solver from `benchmarks/_scripts/spring-rod-render.ts` using the production modules in `src/animation/` and renders them to a single PNG using `node-canvas` on a dark background (`#0b0f19`).

---

## Benchmark Gallery (`gallery.png`)

The benchmark gallery consists of a 3×2 grid of panels (each 320×240) demonstrating different physical configurations, recovery behaviors, and extreme stress tests.

### 1. Upward Antenna
- **Configuration:** `restDirection: { x: 0.32, y: -1 }`, `stiffness: 0.7`, `tipWeight: 0.12`.
- **Motion:** Swaying anchor (`centerX + sin(tick * 0.1) * 15`).
- **Visual Features:**
  - **Forward Lean & Sag:** The antenna leans forward naturally, with the tip sagging slightly due to the `tipWeight` modeling tip mass.
  - **Smooth Secondary Dynamics:** The faded overlays show a smooth, lag-and-whip secondary motion trailing the swaying anchor.
  - **Chunky Tapered Stroke:** Drawn with a thick outline and accent core that tapers from base to tip, matching the stylized look of the showcase antenna.

### 2. Downward Tail
- **Configuration:** `restDirection: { x: 0, y: 1 }`, `stiffness: 0.3`, `tipWeight: 0`.
- **Motion:** Swaying anchor (`centerX + sin(tick * 0.1) * 15`).
- **Visual Features:**
  - **Floppy Wag:** Demonstrates a lower stiffness tail hanging downward.
  - **Fluid Motion:** The overlays capture a beautiful, fluid wagging motion with significant lag at the tip, showing excellent secondary dynamics.

### 3. Sideways → Vertical Recovery
- **Configuration:** Start nodes along +X (sideways), `restDirection: { x: 0, y: -1 }`, `stiffness: 0.6`.
- **Motion:** No anchor motion.
- **Visual Features:**
  - **Elastic Recovery:** The rod starts completely horizontal (tick 0) and springs back to its vertical rest direction.
  - **Smooth Curve:** The intermediate states (ticks 15, 30, 60) show a smooth, elegant curve as the rod pulls itself upward, demonstrating the effectiveness of the Provot next-nearest-neighbor bend constraints.

### 4. Stress: Anchor Teleport +200px
- **Configuration:** `restDirection: { x: 0, y: -1 }`, `stiffness: 0.5`.
- **Motion:** Anchor teleports from `x = 60` to `x = 260` at tick 60.
- **Visual Features:**
  - **Perfect Stability:** The rod does not blow out, stretch infinitely, or escape the panel bounds.
  - **Whip Recovery:** Shows the rod trailing at tick 59, teleporting at tick 60, whipping forward at ticks 61 and 65, and fully settling at tick 120.
  - **Implicit Velocity Clamping:** Demonstrates that a single-frame teleport does not impart permanent astronomical velocities.

### 5. Stress: dt=100
- **Configuration:** `restDirection: { x: 0.32, y: -1 }`, `stiffness: 0.7`.
- **Motion:** Constant anchor, stepped with a massive timestep of `dt = 100` for 120 ticks.
- **Visual Features:**
  - **Blowout-Proof Solver:** Under standard Verlet, `dt = 100` would instantly cause numerical explosion. Here, the rod remains perfectly finite, stable, and well-behaved.
  - **Structural Integrity:** The rod maintains its shape and length, proving the effectiveness of the epsilon-guarded division, implicit velocity clamping, and strain limiting.

### 6. Stress: NaN Input & Recovery
- **Configuration:** `restDirection: { x: 0.32, y: -1 }`, `stiffness: 0.7`.
- **Motion:** Node 3's x-coordinate is set to `NaN` at tick 0.
- **Visual Features:**
  - **Instant Recovery:** Tick 0 shows the broken state (red dashed line with a red cross at the NaN node). At tick 1, the solver detects the non-finite coordinate, triggers the NaN reset safety net, and completely rebuilds the rod along the rest direction off the anchor.
  - **Zero Persistence:** A blowout or corrupted state cannot persist for more than one frame, ensuring robust gameplay rendering.
