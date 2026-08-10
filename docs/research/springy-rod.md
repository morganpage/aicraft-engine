# Stable Springy-Rod Simulation

> Research note for a stable, bend-resistant springy-rod primitive. Slug: `springy-rod`.
> Investigated: 2026-07-17.

## TL;DR

To simulate a bend-resistant, stable springy rod (such as character antennae, stiff tails, or bouncing hair) within a zero-dependency Canvas 2D framework, we must combine **bending resistance** with **rigorous numerical stability guards**. The raw distance-constrained Verlet chain (`advanceSpringChain`) lacks angular resistance, causing it to buckle, kink, and whip under rapid anchor motion. Furthermore, near-coincident nodes can trigger division-by-near-zero explosions, resulting in persistent full-screen visual glitches. The optimal solution is a unified, single-pass **`advanceSpringRod`** primitive that integrates Provot next-nearest-neighbor bend constraints, a facing-aware directional rest-pose spring, and a tapered tip-weight nudge. Crucially, this solver must be hardened with **epsilon-guarded division**, **implicit velocity clamping**, and a **NaN/Infinity fallback reset** to make numerical blowouts structurally impossible.

## Why this matters for aicraft-engine

This research directly impacts **Pillar 1 (Primitives & secondary dynamics)** and **Pillar 4 (Fake-3D & character construction)**.
- **Visual Appeal & Feel:** Secondary elements like antennae, tails, and capes sell the "juice" of character movement. A bendy rod model maintains structural integrity, bending in a smooth, elastic curve under load rather than folding like a floppy rope.
- **Production-Grade Robustness:** Real-world games experience lag spikes, teleports, and violent impulses. If a physics chain blows up, it ruins the visual experience. Hardening the primitive ensures that visual glitches are structurally impossible, even under extreme conditions.
- **Performance & Memory Efficiency:** Chaining multiple showcase-local post-passes over a Verlet chain results in high garbage collection (GC) churn due to redundant array allocations. A unified, single-pass solver reduces allocations to exactly one array copy per frame, preventing frame drops on mobile devices.

---

## The In-House Showcase Approach

The engine's showcase (`showcase/helpers/slime-knight.ts`) implements a layered, multi-pass correction pipeline on top of `advanceSpringChain` to achieve a springy rod look.

### The Pipeline and Constants
In `stepHero`, the antenna is advanced using the following sequence:
$$\text{advanceSpringChain} \longrightarrow \text{applyAntennaBendConstraints} \longrightarrow \text{applyAntennaRestPose} \longrightarrow \text{applyAntennaTipWeight}$$

The behavior is governed by several showcase-local constants:
- `ANTENNA_BASE_STIFFNESS = 0.35` / `ANTENNA_TIP_STIFFNESS = 0.22`: Tapered directional spring stiffness.
- `ANTENNA_FORWARD_LEAN_X = 0.32` (~17.7°): The forward tilt of the antenna rest pose in the facing direction.
- `ANTENNA_TIP_WEIGHT = 0.12`: Positional downward nudge modeling the mass of the tip ball.
- `ANTENNA_BEND_STIFFNESS_BASE = 0.95` / `ANTENNA_BEND_STIFFNESS_TIP = 0.75`: Tapered Provot bend stiffness.
- `ANTENNA_GRAVITY_SCALE = 0`: Disables solver gravity to let the tip-weight nudge explicitly own vertical sag.

### 1. `applyAntennaBendConstraints`
Adds Provot-style next-nearest-neighbor distance constraints between nodes $i$ and $i+2$ with rest length $2 \times \text{segmentLength}$ (the straight-rod distance).
- **Stiffness Taper:** Linearly interpolates stiffness from `ANTENNA_BEND_STIFFNESS_BASE` (0.95) at the root to `ANTENNA_BEND_STIFFNESS_TIP` (0.75) at the tip.
- **Root Handling:** For $i = 0$, the pinned root (node 0) is immovable, so node 2 absorbs 100% of the correction. For $i > 0$, the correction is split 50/50.
- **Velocity Preservation:** Moves both current (`x`, `y`) and previous (`prevX`, `prevY`) coordinates by the same delta to avoid introducing spurious velocity spikes.

### 2. `applyAntennaRestPose`
Pulls each node toward a forward-tilted rest vector rotated in screen space based on character `facing` (+1 right / -1 left).
- **Symmetric Walk Inertia:** By computing the lean in screen space, the antenna's walk-inertia remains symmetric: in both walk directions, the tip lags backward relative to facing by the same magnitude.
- **Stiffness Taper:** Linearly interpolates stiffness from `ANTENNA_BASE_STIFFNESS` (0.35) at node 1 to `ANTENNA_TIP_STIFFNESS` (0.22) at the tip.
- **Velocity Preservation:** Moves `curr` and `prev` together by the same delta.

### 3. `applyAntennaTipWeight`
Applies a positional downward nudge proportional to node position along the chain:
$$\Delta y = \text{ANTENNA\_TIP\_WEIGHT} \times \frac{i}{\text{last}}$$
Applied *after* the rest-pose correction so that gravity sags the tip down from the rest orientation (rather than having the rest-pose correction pull it back up). Moves `curr` and `prev` together.

---

## Prior Art Survey

### Pattern 1: In-House Showcase Layered Corrections
- **Source**: `showcase/helpers/slime-knight.ts`
- **What it does**: Layers three post-simulation corrections (Provot bend springs, absolute directional spring, and tip-weight nudge) on top of the raw Verlet/PBD distance-constrained chain.
- **Algorithmic shape**:
  ```typescript
  // Pipeline in stepHero:
  let antenna = advanceSpringChain(rawAntenna, anchorX, anchorY, dt, config);
  antenna = applyAntennaBendConstraints(antenna, segmentLength);
  antenna = applyAntennaRestPose(antenna, segmentLength, facing);
  antenna = applyAntennaTipWeight(antenna);
  ```
- **Determinism profile**: Purely deterministic. Preserves implicit Verlet velocity by moving both `curr` and `prev` coordinates by identical deltas.
- **Runtime cost**: Moderate to High. Requires 4 separate array allocations and maps per frame, causing significant garbage collection (GC) churn in JavaScript/TypeScript environments.
- **Dependencies**: None.
- **Fit for our constraints**: Medium. It achieves the target aesthetic but is inefficient and error-prone due to manual chaining.
- **What to steal**: The base-to-tip stiffness taper, the velocity-preserving position updates, and the facing-aware screen-space rest vector.
- **What to avoid**: Redundant array allocations and manual, order-dependent pipeline chaining by the consumer.

### Pattern 2: Position-Based Dynamics (PBD) Angular / Bending Constraints
- **Source**: Müller et al. 2007, "Position Based Dynamics" (Section 3.3)
- **What it does**: Operates on triplets of nodes $(p_{i-1}, p_i, p_{i+1})$ and constrains the angle between the two segments. For straight rods, a linearized constraint forces the middle node to stay exactly halfway between its neighbors ($p_i - \frac{p_{i-1} + p_{i+1}}{2} = 0$). For curved or leaning rods, a 2D angular constraint rotates segments around their shared joint to match a target rest angle $\theta_0$.
- **Algorithmic shape**:
  ```typescript
  // Linearized straightness constraint for triplet (p1, p2, p3):
  const dx = p2.x - 0.5 * (p1.x + p3.x);
  const dy = p2.y - 0.5 * (p1.y + p3.y);
  const sumW = w1 * 0.25 + w2 * 1.0 + w3 * 0.25;
  const sX = (dx / sumW) * kBend;
  const sY = (dy / sumW) * kBend;
  p1.x += 0.5 * w1 * sX;
  p2.x -= 1.0 * w2 * sX;
  p3.x += 0.5 * w3 * sX;
  ```
- **Determinism profile**: Purely deterministic.
- **Runtime cost**: Very low for linearized straightness (basic arithmetic), moderate for full 2D angular (requires `atan2`, `cos`, `sin`).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It integrates directly into the PBD constraint-satisfaction loop, solving bending at the physics layer rather than as a post-pass.
- **What to steal**: The linearized midpoint projection for straight rods, or the direct angular rotation for curved rest-poses.
- **What to avoid**: Applying angular corrections without subsequently running distance constraints, which can introduce sub-pixel stretching.

### Pattern 3: XPBD (Extended Position-Based Dynamics) Bending
- **Source**: Macklin et al. 2016, "XPBD: Position-Based Simulation of Compliant Bodies"
- **What it does**: Replaces the iteration-dependent and timestep-dependent stiffness parameter $k \in [0, 1]$ of classical PBD with a physical compliance parameter $\alpha$. Compliance is converted to a constraint scaling factor using the timestep: $\tilde{\alpha} = \alpha / dt^2$.
- **Algorithmic shape**:
  ```typescript
  // XPBD constraint update formula:
  // dlambda = (-C - alpha_tilde * lambda) / (sum(w * |grad_C|^2) + alpha_tilde)
  // dx = dlambda * w * grad_C
  ```
- **Determinism profile**: Purely deterministic.
- **Runtime cost**: Moderate. Requires tracking constraint multipliers ($\lambda$) across iterations and performing slightly more complex arithmetic.
- **Dependencies**: None.
- **Fit for our constraints**: Medium. While physically accurate and independent of iteration count, the added complexity of tracking Lagrange multipliers across iterations is overkill for short (3-6 node) character secondary elements.
- **What to steal**: The concept of scaling stiffness by $1 / dt^2$ to maintain consistent stiffness when the timestep changes.
- **What to avoid**: Implementing full XPBD constraint multipliers, which adds significant code size and maintenance overhead for little practical gain in 2D minimalist games.

---

## Stability Techniques (The Hardening Menu)

To guarantee that a spring chain can never blow up or produce a "line covering half the screen" glitch, we must implement a layered defense of numerical stability guards:

### 1. Epsilon Guard (Safe Division)
- **The Failure Mode:** When two nodes become nearly coincident (e.g., due to physics compression or a collision), the distance $d = \sqrt{dx^2 + dy^2}$ approaches zero. Dividing by a tiny $d$ (e.g., $10^{-15}$) explodes the constraint correction vector, shooting nodes to astronomical coordinates.
- **The Guard:** Enforce a safe minimum distance threshold $\epsilon = 10^{-4}$. If $d < \epsilon$, do not skip the constraint. Instead, assign a default direction vector (e.g., `{x: 0, y: -1}` or a direction based on the node index or character facing) and set `dx / d` and `dy / d` to this unit vector. This prevents division by near-zero and pushes the nodes apart safely.
  ```typescript
  let d = Math.sqrt(dx * dx + dy * dy);
  let ux = 0;
  let uy = -1; // Default fallback direction (pointing up)
  if (d > 1e-4) {
    ux = dx / d;
    uy = dy / d;
  } else {
    d = 1e-4; // Prevent division by zero in subsequent math
  }
  ```

### 2. NaN / Infinity Reset Guard
- **The Failure Mode:** If an unexpected floating-point error or division-by-zero somehow bypasses the epsilon guard, a node's coordinates can become `NaN` or `Infinity`. Once a node becomes `NaN`, all future calculations involving that node result in `NaN`, permanently breaking the chain and drawing a corrupt line across the screen.
- **The Guard:** At the end of each simulation step, check if any node coordinate is `isNaN(n.x)` or `!isFinite(n.x)`. If a blowout is detected, immediately reset the entire chain to its rest pose relative to the anchor. This ensures that a blowout can never persist for more than a single frame.
  ```typescript
  let hasNan = false;
  for (const n of next) {
    if (isNaN(n.x) || !isFinite(n.x) || isNaN(n.y) || !isFinite(n.y)) {
      hasNan = true;
      break;
    }
  }
  if (hasNan) {
    // Reset the entire chain to a straight vertical hanging line relative to the anchor
    for (let i = 0; i < next.length; i++) {
      next[i].x = anchorX;
      next[i].y = anchorY + i * segmentLength;
      next[i].prevX = anchorX;
      next[i].prevY = anchorY + i * segmentLength;
    }
  }
  ```

### 3. Implicit Velocity Clamping
- **The Failure Mode:** High-speed anchor motion (e.g., character teleportation, violent screen shake, or massive lag spikes) can impart huge velocities to the nodes. Since velocity is implicit in Verlet integration ($v = (p - p_{prev}) \times \text{drag}$), a single-frame massive displacement translates to a permanent high-velocity state, causing the chain to whip violently or explode.
- **The Guard:** Clamp the implicit velocity components `vx` and `vy` to a maximum speed `maxVelocity` per tick (e.g., `segmentLength * 5` or a configurable parameter) before updating the current position.
  ```typescript
  const maxVel = config.maxVelocity ?? (config.segmentLength * 5);
  const vx = Math.max(-maxVel, Math.min(maxVel, (n.x - n.prevX) * config.drag));
  const vy = Math.max(-maxVel, Math.min(maxVel, (n.y - n.prevY) * config.drag));
  ```

### 4. Strain Limiting (Clamping Stretch)
- **The Failure Mode:** Under extreme external forces, the PBD solver may fail to converge within its finite iteration limit, leaving the segments highly stretched.
- **The Guard:** Hard-clamp the maximum distance between adjacent nodes to `maxStretch = segmentLength * 1.5` after the constraint solver runs. If a node stretches beyond this threshold, its position is directly clamped along the segment vector.
  ```typescript
  const maxStretch = config.segmentLength * 1.5;
  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > maxStretch) {
    const scale = maxStretch / d;
    curr.x = prev.x + dx * scale;
    curr.y = prev.y + dy * scale;
  }
  ```

### 5. Sub-stepping
- **The Failure Mode:** Large timesteps `dt` or high stiffness can cause numerical instability because the constraint corrections are too large for a single step.
- **The Guard:** Divide the timestep `dt` into $S$ sub-steps (e.g., $S = 4$). Run the Verlet integration and constraint solver $S$ times per frame with a timestep of `dt / S`. This distributes forces over smaller increments, dramatically increasing numerical stability and allowing high stiffness values to converge safely without exploding. Since our chains are very short (3-6 nodes), sub-stepping is extremely cheap and highly effective!

---

## Reference Implementations

- **Sokpop Fake-3D Demo** (`sokpop.itch.io/sokpop-fake-3d-demo`): Demonstrates how they use short, highly-stiffened Verlet chains with midpoint-smoothing drawing to represent antennae and tails.
- **Thomas Jakobsen, "Advanced Character Physics" (2001)**: The seminal paper demonstrating that next-nearest-neighbor distance constraints (bend springs) are sufficient for stiffening Verlet cloth and rods in games.
- **verlet-js** (`github.com/subat0m/verlet-js`): A lightweight, dependency-free JS Verlet integration library showing clean constraint-solving patterns.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| `docs/research/elastic-rod-antenna.md` | Buckling vs. smooth bending curve under point load | Theoretical beam mechanics |
| `showcase/helpers/slime-knight.ts:1295` | Polyline rendering pass (current faceted look) | Local codebase |

---

## Open Questions

1. **Stiffness Parameterization:** Should we expose a single high-level `stiffness` parameter $[0, 1]$ that automatically configures both adjacent distance and next-nearest-neighbor bend constraints, or should we expose separate `distanceStiffness` and `bendingStiffness` parameters for fine-grained tuning?
2. **Rest Pose Configuration:** How should we represent non-straight rest poses? A straight rod is easy ($\theta_0 = \pi$), but a curved or forward-leaning rod requires storing either a rest angle per joint or a list of relative rest vectors.
3. **Sub-stepping Exposure:** Should sub-stepping be handled internally by the solver (e.g., a `subSteps` parameter in `SpringConfig`), or should we rely on the caller to perform sub-stepping by calling `advanceSpringRod` multiple times with a smaller `dt`?

---

## Top 3 Patterns Worth Prototyping

1. **Unified `advanceSpringRod` Solver (Single-Pass PBD)** — *Why:* Combining Verlet integration, adjacent distance constraints, Provot bend constraints, rest-pose forces, and tip weight into a single unified solver function. This eliminates garbage collection churn by allocating only a single new array per frame, and simplifies the consumer API.
2. **Epsilon-Guarded Distance Constraints** — *Why:* Hardening the division math in all distance and bend constraints with a safe minimum distance threshold ($\epsilon = 10^{-4}$) and fallback unit direction vectors to make division-by-zero explosions mathematically impossible.
3. **Tapered Angular PBD Constraints** — *Why:* Implementing a dedicated angular constraint solver on triplets of nodes to support curved rest poses natively, preventing the folding/flipping failure mode of distance-based bend springs.

---

## Cross-References

- `docs/research/README.md` — Research note conventions.
- `docs/research/elastic-rod-antenna.md` — Initial antenna simulation notes.
- `src/animation/spring.ts` — The current Verlet/PBD distance solver.
- `showcase/helpers/slime-knight.ts` — The current showcase character composition and antenna drawing.
- The canonical Sokpop reference (sokpop.itch.io) — Strategic context on Sokpop's minimalist rendering.
