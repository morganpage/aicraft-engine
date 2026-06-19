# Elastic Rod Antenna Simulation

> Research note for simulating a bendy solid rod (antenna) on a Verlet/PBD spring chain. Slug: `elastic-rod-antenna`.
> Investigated: 2026-06-19.

## TL;DR

To simulate a bendy solid rod (like a character antenna) on a Verlet/PBD chain without buckling, kinking, or whipping, we must introduce **bending resistance** to complement the existing distance constraints. While a rope/chain has free-hinge joints, a solid rod resists relative angular changes between adjacent segments. The sweet spot for a 3–6 node chain in Canvas2D is a combination of a **PBD Angular Constraint** (which restores relative angles to a target rest pose) and **Rendering-Side Midpoint Bézier Smoothing** (which guarantees C1 visual continuity). Prototyping should focus on: (1) Provot's next-nearest-neighbor bend springs for sheer simplicity, (2) 2D Angular PBD constraints for robust curved rest-poses, and (3) Midpoint Bézier rendering to eliminate the faceted polyline read.

## Why this matters for aicraft-engine

This research directly impacts **Pillar 1 (Primitives & secondary dynamics)** and **Pillar 4 (Fake-3D & character construction)**. 
- **Character Appeal:** Clean secondary dynamics (bouncing antennae, springy hats, stiff tails) are core to the Sokpop-inspired minimalist aesthetic.
- **Visual Quality:** Under violent acceleration (e.g., jump launches and landings), a pure distance-constrained chain buckles and whips, reading as a floppy rope. A bendy rod model maintains structural integrity and bends in a smooth, elastic curve.
- **Determinism & Performance:** Any solution must remain 100% deterministic under a fixed timestep, require zero runtime dependencies, and execute with negligible CPU overhead on short (3–6 node) chains.

---

## The Exact Problem to Solve

A chain/rope and a solid rod differ fundamentally in their constraint formulations:
1. **Chain/Rope (Current Solver):** Enforces only *distance constraints* between adjacent nodes $i$ and $i+1$ (length preservation). Joints are free hinges with zero angular resistance. Under high acceleration (e.g., a jump), the chain folds at whichever hinge is cheapest, resulting in sharp kinks, buckling, and high-frequency whip.
2. **Bendy Solid Rod (Target):** Enforces *distance constraints* PLUS *bending resistance*. Adjacent segments resist changing their angle relative to each other. Under load, the rod bends in a smooth curve (governed by bending stiffness $EI$ in Euler-Bernoulli beam theory) and rebounds elastically.

The current showcase-local correction (`applyAntennaRestPose` in `slime-knight.ts`) pulls each node toward a **world-space absolute** forward-tilted direction. This is a 1-body angular spring toward an absolute angle, rather than a multi-body constraint enforcing inter-segment angles. Under violent motion, inertia easily overwhelms this absolute spring, causing the chain to buckle at the joints.

---

## Prior Art Survey

### Pattern 1: Position Based Dynamics (PBD) Bending Constraints
- **Source**: Müller et al. 2007, "Position Based Dynamics" (Section 3.3)
- **What it does**: Operates on a triplet of nodes $(p_{i-1}, p_i, p_{i+1})$ and constrains the angle between the two segments. For a straight rod, the constraint can be linearized as $C(p_{i-1}, p_i, p_{i+1}) = p_i - \frac{p_{i-1} + p_{i+1}}{2} = 0$. This forces the middle node to stay exactly halfway between its neighbors, resisting bending.
- **Algorithmic shape**:
  ```typescript
  // For a triplet of nodes (p1, p2, p3) with inverse masses (w1, w2, w3)
  // Linearized straightness constraint: C = p2 - 0.5 * (p1 + p3) = 0
  const dx = p2.x - 0.5 * (p1.x + p3.x);
  const dy = p2.y - 0.5 * (p1.y + p3.y);
  
  // Gradients: grad_p1 = -0.5, grad_p2 = 1.0, grad_p3 = -0.5
  // Sum of weighted squared gradients: sum(w_j * |grad_j|^2)
  const sumW = w1 * 0.25 + w2 * 1.0 + w3 * 0.25;
  if (sumW === 0) return;
  
  // Scaling factor (with stiffness kBend in [0, 1])
  const sX = (dx / sumW) * kBend;
  const sY = (dy / sumW) * kBend;
  
  // Apply position corrections
  p1.x += 0.5 * w1 * sX;
  p1.y += 0.5 * w1 * sY;
  p2.x -= 1.0 * w2 * sX;
  p2.y -= 1.0 * w2 * sY;
  p3.x += 0.5 * w3 * sX;
  p3.y += 0.5 * w3 * sY;
  ```
- **Determinism profile**: Purely deterministic. No hidden state. Composes naturally with the existing PBD distance solver loop.
- **Runtime cost**: Extremely low. A few basic arithmetic operations per triplet.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is elegant, fast, and integrates directly into the PBD constraint-satisfaction loop.
- **What to steal**: The linearized midpoint projection. It is incredibly stable and converges quickly.
- **What to avoid**: The linearized version assumes a straight rest pose ($\theta_0 = \pi$). If the antenna has a permanent curved rest pose, this formulation must be extended to include a rest offset, which increases complexity.

---

### Pattern 2: Mass-Spring with Next-Nearest-Neighbor Bend Springs
- **Source**: Provot 1995, "Deformation Responses in Mass-Spring Polyester Cloth Models"
- **What it does**: Adds standard distance constraints between next-nearest neighbors (nodes $i$ and $i+2$) with a rest length equal to the distance between them in the straight/rest pose (usually $2 \times \text{segmentLength}$). When the chain bends, the distance between $i$ and $i+2$ shrinks, and the constraint pushes them apart, restoring straightness.
- **Algorithmic shape**:
  ```typescript
  // For each node i from 0 to n-3:
  const prev = nodes[i];
  const nextNext = nodes[i + 2];
  const dx = nextNext.x - prev.x;
  const dy = nextNext.y - prev.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d === 0) continue;
  
  const restLen = 2 * segmentLength; // or geodesic distance in rest pose
  const diff = restLen - d;
  const ox = (dx / d) * diff * kBend;
  const oy = (dy / d) * diff * kBend;
  
  // Apply corrections (assuming equal masses, root node 0 is pinned)
  if (i === 0) {
    nextNext.x += ox;
    nextNext.y += oy;
  } else {
    prev.x -= ox * 0.5;
    prev.y -= oy * 0.5;
    nextNext.x += ox * 0.5;
    nextNext.y += oy * 0.5;
  }
  ```
- **Determinism profile**: Purely deterministic.
- **Runtime cost**: Extremely low. It is just a standard distance constraint.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is the easiest to implement because it uses the exact same mathematical shape as the existing distance constraints.
- **What to steal**: The next-nearest-neighbor distance constraint. It can be added to the existing solver loop with zero new architectural concepts.
- **What to avoid**: "Double-covering" or buckling. If a joint bends past 180 degrees, a distance-based bend spring can "pop" to the other side because a distance constraint doesn't care about the sign of the angle. For an antenna with moderate bending, this is rarely an issue, but it is a known limitation.

---

### Pattern 3: 2D Angular PBD Constraints (Torsional Joint Restorers)
- **Source**: Standard 2D character physics (e.g., Box2D, Matter.js joint limits)
- **What it does**: Restores the relative angle between adjacent segments to a target rest angle $\theta_0$ by directly rotating the segments around their shared joint. This handles non-straight rest poses perfectly and avoids the "folding/flipping" failure mode of distance-based bend springs.
- **Algorithmic shape**:
  ```typescript
  // For adjacent segments e1 (p1 -> p2) and e2 (p2 -> p3)
  const u1x = p1.x - p2.x;
  const u1y = p1.y - p2.y;
  const u2x = p3.x - p2.x;
  const u2y = p3.y - p2.y;
  
  const len1 = Math.sqrt(u1x * u1x + u1y * u1y);
  const len2 = Math.sqrt(u2x * u2x + u2y * u2y);
  if (len1 === 0 || len2 === 0) return;
  
  const alpha1 = Math.atan2(u1y, u1x);
  const alpha2 = Math.atan2(u2y, u2x);
  
  // Relative angle and wrap to [-PI, PI]
  let theta = alpha2 - alpha1;
  while (theta < -Math.PI) theta += 2 * Math.PI;
  while (theta > Math.PI) theta -= 2 * Math.PI;
  
  // Angular error relative to rest angle theta0
  let err = theta - theta0;
  while (err < -Math.PI) err += 2 * Math.PI;
  while (err > Math.PI) err -= 2 * Math.PI;
  
  // Apply angular correction scaled by stiffness kBend in [0, 1]
  const corr = err * kBend;
  
  // Rotate u1 by -corr * 0.5, rotate u2 by +corr * 0.5
  const cos1 = Math.cos(-corr * 0.5);
  const sin1 = Math.sin(-corr * 0.5);
  const cos2 = Math.cos(corr * 0.5);
  const sin2 = Math.sin(corr * 0.5);
  
  p1.x = p2.x + (u1x * cos1 - u1y * sin1);
  p1.y = p2.y + (u1x * sin1 + u1y * cos1);
  p3.x = p2.x + (u2x * cos2 - u2y * sin2);
  p3.y = p2.y + (u2x * sin2 + u2y * cos2);
  ```
- **Determinism profile**: Purely deterministic under a fixed timestep.
- **Runtime cost**: Moderate. Requires `atan2`, `cos`, and `sin` calls. For a 3–6 node chain, this is negligible (2–5 triplets), but it is more expensive than basic arithmetic.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is extremely robust, handles curved rest poses natively, and prevents any folding or flipping.
- **What to steal**: The direct angular correction. It is the most physically accurate way to represent a torsional spring in 2D.
- **What to avoid**: Applying this correction without subsequently running distance constraints. Because rotation can introduce sub-pixel stretching, it should be solved *before* or *interleaved with* distance constraints.

---

### Pattern 4: Discrete Elastic Rods (DER)
- **Source**: Bergou et al. 2008, "Discrete Elastic Rods"
- **What it does**: An academically rigorous model for thin, flexible rods. It represents the rod as a space curve with an adapted reference frame (the Bishop frame) at each segment to track bending and twisting. It minimizes a global energy function using an implicit solver.
- **Algorithmic shape**: Formulates stretching, bending, and twisting energy terms, then solves a global system of equations using Newton-Raphson.
- **Determinism profile**: Deterministic if the solver is deterministic, but floating-point drift in global matrix solvers can be an issue.
- **Runtime cost**: High. Requires solving a system of equations per frame.
- **Dependencies**: None (but would require writing a custom matrix/tridiagonal solver).
- **Fit for our constraints**: Weak. It is extreme overkill for a 3–6 node character antenna in a 2D Canvas game.
- **What to steal**: The concept that bending resistance is a function of discrete curvature (the change in tangent direction per unit length).
- **What to avoid**: The full mathematical apparatus (Bishop frames, parallel transport, twisting energy, implicit matrix solvers).

---

### Pattern 5: Rendering-Side Smoothing (Complementary Technique)
- **Source**: Standard computer graphics spline techniques (Catmull-Rom, Chaikin's corner-cutting, Midpoint Bézier)
- **What it does**: This is a rendering-side visual improvement. Instead of drawing a straight polyline (which has C0 continuity and makes any bend look like a sharp kink), we draw a smooth curve (C1 or C2 continuity) through the same physics nodes. This is a complementary technique that does not change the physics but completely removes the "faceted/kinked" visual read.
- **Algorithmic shape (Midpoint Bézier)**:
  ```typescript
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (let i = 1; i < nodes.length - 1; i++) {
    const xc = (nodes[i].x + nodes[i + 1].x) / 2;
    const yc = (nodes[i].y + nodes[i + 1].y) / 2;
    ctx.quadraticCurveTo(nodes[i].x, nodes[i].y, xc, yc);
  }
  ctx.lineTo(nodes[nodes.length - 1].x, nodes[nodes.length - 1].y);
  ctx.stroke();
  ```
- **Determinism profile**: Purely deterministic (drawing only).
- **Runtime cost**: Extremely low. Uses native browser Canvas2D rendering.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is a highly recommended visual complement to any physics fix.
- **What to steal**: Midpoint Bézier. It is native to Canvas2D, requires zero allocations, and is incredibly fast.
- **What to avoid**: Catmull-Rom splines, which require manual evaluation of cubic equations and generate many intermediate points, increasing JS allocation overhead.

---

## Reference Implementations

- **Sokpop Fake-3D Demo** (`sokpop.itch.io/sokpop-fake-3d-demo`): Shows how they use short, highly-stiffened Verlet chains with midpoint-smoothing drawing to represent antennae and tails.
- **Thomas Jakobsen, "Advanced Character Physics" (2001)**: The seminal paper demonstrating that next-nearest-neighbor distance constraints (bend springs) are sufficient for stiffening Verlet cloth and rods in games.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| `docs/research/elastic-rod-antenna.md` | Buckling vs. smooth bending curve under point load | Theoretical beam mechanics |
| `showcase/helpers/slime-knight.ts:1295` | Polyline rendering pass (current faceted look) | Local codebase |

---

## Open Questions for @api-designer

1. **Library-vs-Showcase Placement:** Should the bending constraint be integrated directly into the library solver (`src/animation/spring.ts`) as a `bendingStiffness` field on `SpringConfig`, or should it be kept as a showcase-local triplet correction composed on top (parallel to `applyAntennaRestPose`)?
   - *Library integration:* Reusable for other secondary elements (hair, tails, capes, vines) that need stiffness. Consolidates the physics solver.
   - *Showcase-local:* Keeps the library solver extremely lean and focused on pure distance springs. Allows the showcase to customize the bending behavior specifically for the antenna (e.g., tapering stiffness, forward lean, tip weight).
2. **Rest Pose Representation:** If we choose PBD Angular Constraints, how should we represent the rest pose? A straight rod is easy ($\theta_0 = \pi$), but a curved or forward-leaning rod requires storing a rest angle per joint.

---

## Top 3 Patterns Worth Prototyping

1. **Provot's Next-Nearest-Neighbor Bend Springs (Pattern 2)** — *Why:* It is the simplest possible physics fix, requiring zero new mathematical concepts or trigonometric functions. It integrates directly into the existing PBD distance solver loop.
2. **2D Angular PBD Constraints (Pattern 3)** — *Why:* It is the most robust physics fix for curved or forward-leaning rest poses. It prevents the folding/flipping failure mode of distance-based springs and allows precise angular stiffness tuning.
3. **Midpoint Bézier Rendering (Pattern 5)** — *Why:* It is a pure rendering-side fix that completely removes the faceted, kinked look of the antenna by guaranteeing C1 visual continuity. It can be paired with any physics fix (or even the current solver) to immediately improve the visual read.

---

## Cross-References

- `docs/research/README.md` — Research note conventions.
- `src/animation/spring.ts` — The current Verlet/PBD distance solver.
- `showcase/helpers/slime-knight.ts` — The current showcase character composition and antenna drawing.
- `ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md` — Strategic context on Sokpop's minimalist rendering.
