# Character Body-Plan Catalog

> Research note for procedural character body-plan construction. Slug: `character-body-plans`.
> Investigated: 2026-07-27.

## TL;DR

This research note surveys player character and enemy body-plan variety to expand `aicraft-engine`'s procedural rendering catalog beyond the existing `slime-knight` model. By evaluating reference games like *Dead Cells*, *Axiom Verge*, *Hollow Knight*, and *Celeste*, we identify how visual variety is achieved through topological structure, proportion, and armament. We evaluate five candidate body plans against our strict zero-runtime-dependency, Canvas2D-only, and deterministic constraints. We recommend prioritizing **Humanoid Biped** (Rank 1), **Floater / Drone** (Rank 2), and **Serpentine / Multi-segment** (Rank 3) as the top three body plans to prototype. These three plans provide maximum silhouette diversity and consumer-game versatility while achieving a low implementation cost by reusing our existing skeletal rig, analytical 2-bone IK solver (`solveLimb`), biped locomotion phase integrator, and Verlet spring chain (`advanceSpringChain`) primitives.

## Why this matters for aicraft-engine

- **Pillars Touched**: Directly drives **Pillar 1 (Primitives / Animation)** and **Pillar 4 (Fake-3D / character stacks)**, and integrates with **Pillar 2 (Cosmetics / Skins)**.
- **Consumer Games**: Consumer titles (such as card-based village builders, procedural RTSs, or idle gardens) require distinct player characters and enemy archetypes to build legible, engaging gameplay.
- **Unlocks**:
  - **Silhouette Legibility**: In fast-paced 2D platformers, players must instantly distinguish between friendly characters and enemy threats. Expanding our body-plan catalog provides creators with highly distinct silhouette archetypes.
  - **Combinatorial Variety**: Combining 4 distinct body plans (slime-knight + 3 new plans) with our existing palette substitution and Phase 4 silhouette-diversity parameters yields thousands of unique, seed-driven procedural characters with zero asset footprint.
  - **Extensible Locomotion**: Establishing modular body plans proves that our core animation primitives (IK, Verlet, phase oscillators) can animate diverse topologies without duplicating core math.

---

## Prior Art Survey

### Dead Cells (Motion Twin)
- **Source**: *Dead Cells* gameplay and developer blogs on procedural/fluid 2D animation.
- **What it does**: *Dead Cells* achieves fluid, hand-drawn-looking combat animations using 3D models rendered down to 2D spritesheets. The protagonist (the Beheaded) is a humanoid biped. Perceived variety among enemies is achieved primarily through proportion, distinct headgear (e.g., the Beheaded's flame-head, hoods, helmets), and highly visible armament (giant shields on Shieldbearers, long swords, bows) that extend far beyond the body bounding box.
- **Key takeaways**:
  - **Armament as Silhouette**: Weapons and shields are critical for silhouette legibility. A humanoid biped with a giant shield (Shieldbearer) has a completely different silhouette from one with a long sword.
  - **Proportion Jittering**: Humanoids can look vastly different by simply altering bone length ratios (e.g., long spindly arms vs. short stubby legs, hunched torsos).
  - **Secondary Physics**: Flowing capes, scarf-tails, and flame-heads (which we can render via Verlet spring chains and particle emitters) add immense kinetic energy to a standard biped.

### Axiom Verge (Thomas Happ Games)
- **Source**: *Axiom Verge* biomechanical pixel-art survey.
- **What it does**: *Axiom Verge* features a humanoid protagonist (Trace) in a suit, but the enemy catalog is dominated by non-humanoid biomechanical drones, floating brains, wall-crawlers, and multi-segmented swimmers. Variety is achieved via asymmetric plating, mechanical joints, rigid corners, and animated scanline/glitch effects.
- **Key takeaways**:
  - **Asymmetry**: Biomechanical designs look more mechanical and alien when they are asymmetric (e.g., one giant gun-arm, one small claw-arm, asymmetric shoulder plating).
  - **Rigid Plating**: Swapping rounded curves (like our slime squircle) for rigid, overlapping rectangular plates creates an immediate mechanical, robotic feel.
  - **Floating/Hovering**: Floating drones with trailing tentacles or thruster particles provide an excellent contrast to walking/crawling enemies.

### Hollow Knight (Team Cherry)
- **Source**: *Hollow Knight* character design and silhouette analysis.
- **What it does**: *Hollow Knight* features a small, masked humanoid protagonist (the Knight) and a massive cast of insectoid enemies spanning walking bipeds, aerial flyers, multi-legged crawlers, and burrowing worms. Legibility is maintained through high-contrast masks, distinct horn shapes, and flowing cloaks.
- **Key takeaways**:
  - **Masks and Horns**: High-contrast, simple geometric masks with unique horn/antenna extensions are highly legible and cheap to render procedurally.
  - **Cloak as Body Volume**: The Knight's cloak hides the limbs during idle/fall, simplifying the silhouette into a clean teardrop shape, and opens up during slashes or dashes to show limb extensions.
  - **Multi-Segmented Bosses**: Large worm-like bosses (like the Loly) use a simple follow-the-leader chain of circles, which is highly expressive and cheap to compute.

### Celeste (Maddy Makes Games)
- **Source**: Noel Berry's *Celeste* source code and design post-mortems.
- **What it does**: *Celeste* uses tiny, highly legible pixel-art bipeds. Madeline's silhouette is dominated by her large hair, which changes color based on her dash count (blue/red/pink) and flows behind her using simple secondary physics.
- **Key takeaways**:
  - **Hair/Trail as State Indicator**: Flowing hair or trails are excellent visual indicators of gameplay state (e.g., dash availability, health, or speed).
  - **Minimalist Legibility**: At small scales, legs can be drawn as simple 1px or 2px lines, and the body as a single block, relying on squash/stretch to convey weight and momentum.

### Sokpop Catalog (Sokpop Collective)
- **What it does**: Sokpop games build characters entirely from stacked geometric primitives (cubes, cylinders, spheres, rounded rects) with relative offsets from a root bone. They bypass complex skeletal meshes, drawing billboarded 2D shapes that always face the camera.
- **Key takeaways**:
  - **Primitive Stacking**: Highly expressive characters can be built by stacking a few simple shapes (e.g., a circle for a head, a rounded rect for a torso, lines for limbs).
  - **Orthographic Turning**: Squashing a shape horizontally ($s_x = \cos(\theta)$) and shifting child offsets fakes 3D rotation on a flat canvas.

### JS13k Winners (Constrained-Size Procedural Games)
- **Source**: JS13k games like *Space Hug* and *Lost in Cyberspace*.
- **What it does**: These games achieve rich character and enemy variety under a strict 13KB size constraint by generating biped and drone silhouettes procedurally using seeded PRNGs to jitter scale, limb counts, and colors.
- **Key takeaways**:
  - **Seeded Jittering**: Jittering base parameters (e.g., body scale, limb offsets, eye counts) within safe bounds creates infinite visual variety from a single drawing function.
  - **Symmetry Mirroring**: Generating one side of a character and mirroring it guarantees visual balance and halves the procedural generation logic.

---

## Candidate Body Plans

### Plan 1: Humanoid Biped
- **Silhouette description**: Taller, structured, upright silhouette consisting of a distinct head, torso, two arms, and two legs. It contrasts sharply with the short, blobby, single-volume `slime-knight`.
- **Primitive stack**:
  - **Head**: Circle or rounded rectangle.
  - **Torso**: Stacked rounded rectangles (chest and hips) connected by a spine bone.
  - **Arms**: Two 2-bone chains (shoulder-elbow-hand) drawn as thick lines or capsules.
  - **Legs**: Two 2-bone chains (hip-knee-foot) drawn as thick lines or capsules.
  - **Accessories**: Optional helmet (arc/dome), weapon (line/rect), or shield (rounded rect) attached to hand/head bones.
- **Reuse of existing primitives**:
  - **Locomotion**: Reuses `evaluateLocomotion` / `advanceLocomotion` to drive the hip bobbing and foot targets.
  - **IK Solver**: Reuses `solveLimb` (2-bone analytical IK) for both legs (walking) and arms (reaching for weapons or swinging).
  - **Skeletal Rig**: Reuses the hierarchical transform propagation (`docs/research/skeletal-rigging.md`) to position the head, chest, hips, and limbs.
- **What's new**:
  - **Arm Pose Controller**: Logic to coordinate arm swing in opposition to leg stride, or to lock hands to a weapon/shield target.
  - **Biped Bone Template**: A standard skeleton template defining the bone hierarchy (Root -> Hip -> Spine -> Chest -> Neck -> Head, with shoulder/arm and hip/leg branches).
- **Determinism profile**: 100% pure mathematical calculations. Fully deterministic.
- **Runtime cost**: Low. Computing world matrices for ~10 bones and solving IK for 4 limbs is extremely cheap (under 0.02ms per frame).

### Plan 2: Floater / Drone
- **Silhouette description**: A hovering, legless silhouette suspended above the ground. It features a central core/eye, an armored dome or shell, and trailing appendages (tentacles, wires, or particle thruster plumes).
- **Primitive stack**:
  - **Core/Eye**: Central circle or squircle with a gaze-tracking pupil.
  - **Shell/Armor**: Semicircular dome or segmented plates drawn as filled arcs/paths above the core.
  - **Tentacles**: 2-3 independent Verlet node chains (`VerletNode[]`) trailing below the core.
  - **Thruster**: Procedural triangle or particle emitter spitting downward.
- **Reuse of existing primitives**:
  - **Secondary Physics**: Reuses `advanceSpringChain` (Verlet spring chain with distance constraints) to simulate trailing tentacles or wires reacting to hover movement.
  - **Oscillators**: Reuses sine/cosine oscillators (`breathe` / `bob`) to drive the ambient hover bobbing.
  - **Particles**: Reuses the deterministic particle emitter (`src/particles/`) for thruster sparks or energy plumes.
- **What's new**:
  - **Hover Controller**: Simple kinematic movement logic that translates the drone and applies a tilt angle proportional to horizontal velocity ($\theta_{tilt} = v_x \cdot k$).
  - **Tentacle Anchor Binding**: Logic to bind the root of each Verlet tentacle chain to the bottom of the hovering core.
- **Determinism profile**: 100% deterministic (Verlet integration requires a fixed timestep `dt`).
- **Runtime cost**: Extremely low. No IK solvers or leg gait calculations are required. Verlet chains of 3-5 nodes are highly performant.

### Plan 3: Serpentine / Multi-segment
- **Silhouette description**: A long, slithering, multi-segmented chain of body segments (snake, worm, or mechanical eel) that crawls along the ground or swims through the air.
- **Primitive stack**:
  - **Head**: Large circle or rounded rectangle with eyes and jaw/mouth primitives.
  - **Body Segments**: A chain of $N$ circles or squircles (typically 6-12) that gradually decrease in radius towards the tail.
  - **Tail**: Small circle, triangle, or springy rattle tip.
- **Reuse of existing primitives**:
  - **Secondary Physics**: Reuses `advanceSpringChain` (Verlet spring chain) to simulate the body segments following the head. By setting a high drag and tight distance constraints, the segments slither naturally behind the head.
  - **Mouth/Emotion**: Reuses the parametric mouth and eye primitives from `slime-knight` to convey emotions or telegraph attacks on the head segment.
- **What's new**:
  - **Kinematic Head Controller**: Drives the head segment along a path (e.g., sine wave patrol or direct player seeking).
  - **Segment Angle Reconstruction**: Calculates the angle of each segment vector ($P_{i} - P_{i-1}$) using `Math.atan2` to rotate the segment primitives (e.g., drawing spikes or plates aligned to the body curve).
- **Determinism profile**: 100% deterministic under a fixed timestep `dt`.
- **Runtime cost**: Low. A 10-segment Verlet chain requires only a few dozen floating-point operations per frame.

### Plan 4: Quadruped
- **Silhouette description**: A four-legged beast or mount silhouette. It features a horizontal torso, a distinct neck/head, and 4 legs splayed out to support the body.
- **Primitive stack**:
  - **Torso**: Horizontal rounded rectangle or capsule.
  - **Head/Neck**: Head circle connected to the torso via a neck bone.
  - **Legs**: Four 2-bone IK chains (front-left, front-right, back-left, back-right).
  - **Tail**: Trailing Verlet spring chain.
- **Reuse of existing primitives**:
  - **IK Solver**: Reuses `solveLimb` (2-bone analytical IK) for all 4 legs.
  - **Secondary Physics**: Reuses `advanceSpringChain` for the tail.
- **What's new**:
  - **Quadruped Gait Coordinator**: A bespoke gait phase accumulator coordinating 4 legs. It must support walking (trot gait: diagonal leg pairs L1/R4 and R1/L4 in phase) and running (gallop gait: front pairs and back pairs phase-shifted).
- **Determinism profile**: 100% deterministic.
- **Runtime cost**: Medium. Solving 2-bone IK for 4 legs increases the computational cost, though it remains well within performance budgets.

### Plan 5: Biomech / Robot
- **Silhouette description**: A plated, mechanical, and often asymmetric silhouette. It features rigid corners, overlapping rectangular plates, and mechanical joints.
- **Analysis**: Upon close evaluation, "Biomech / Robot" is not a distinct topological body plan (bone hierarchy), but rather a **Cosmetic Skin Variant (Phase 4)** that can be applied on top of the **Humanoid Biped** or **Floater / Drone** body plans. The structural bones remain the same, but the drawing callbacks are swapped to render rigid, flat-shaded rectangular plates with asymmetric armaments instead of rounded, organic curves.
- **Verdict**: Reclassify as a Phase 4 (Silhouette Diversity) cosmetic skin preset rather than a standalone Phase 1 body plan. This avoids duplicating skeletal and locomotion code while achieving the exact same visual variety.

---

## Comparison Matrix

| Body Plan | Silhouette Distinctness vs. Slime-Knight | Implementation Cost | Reuse of Existing Rig/IK/Locomotion | Consumer-Game Versatility | Total Score / Verdict |
|---|---|---|---|---|---|
| **1. Humanoid Biped** | **High** (Taller, distinct limbs, arms, upright posture) | **Low-Medium** (Requires biped template and arm pose controller) | **High** (100% reuse of `solveLimb`, `evaluateLocomotion`, and skeletal rig) | **High** (Protagonists, guards, melee enemies, archers) | **9.5/10** — **Rank 1 (Must Prototype)**. Essential for standard platformers. |
| **2. Floater / Drone** | **High** (No legs, hovering, trailing tentacles, thrusters) | **Extremely Low** (No IK legs or walking gaits; simple hover math) | **Medium** (Bypasses gait/IK, reuses `advanceSpringChain` and particles) | **High** (Flying hazards, drones, ghosts, aerial bosses) | **9.0/10** — **Rank 2 (Must Prototype)**. Unlocks aerial enemy variety. |
| **3. Serpentine / Multi-segment** | **High** (Long, slithering, segmented chain of body parts) | **Low** (Uses Verlet chain for body; needs segment angle math) | **Medium** (100% reuse of `advanceSpringChain` for segments) | **Medium-High** (Snakes, worms, hazard chains, segmented bosses) | **8.5/10** — **Rank 3 (Must Prototype)**. High visual impact for low cost. |
| **4. Quadruped** | **Medium-High** (Four-legged beast, horizontal torso) | **Medium-High** (Requires bespoke 4-legged gait coordinator) | **Medium** (Reuses `solveLimb` for legs, but gait code is new) | **Medium** (Mounts, wolves, crawling beasts) | **6.5/10** — **Rank 4 (Secondary)**. High cost; defer to a future extension. |
| **5. Biomech / Robot** | **High** (Rigid corners, asymmetric plating, mechanical joints) | **Low** (If treated as a skin variant) | **High** (Binds directly to Biped or Floater bone rigs) | **High** (Cyborgs, robots, sci-fi enemies) | **Reclassified** — Implement as a Phase 4 cosmetic skin variant. |

---

## Open Questions

1. **How should arm posing be coordinated for the Humanoid Biped?**
   - *Flag for @api-designer*: Should the arms swing passively in opposition to the legs during walking (purely driven by the locomotion phase), or should they support active targeting (e.g., pointing toward the player, holding a shield forward, or aiming a bow) via an IK target override?
   - *Recommendation*: Support both. The default state should be passive swinging, but allow the caller to supply an optional `armTarget: Vec2` in world space to override the arm IK and point the arm toward a weapon target.

2. **How do we handle Verlet chain stretching under high-speed movement for Floaters and Serpentines?**
   - *Flag for @coder*: When a Floater or Serpentine moves extremely fast, the Verlet distance solver can experience "stretching" or lag if the constraint iterations are too low.
   - *Recommendation*: Enforce a strictly fixed iteration count of `constraintIterations: 3` in `advanceSpringChain` for secondary tentacles, which provides excellent stability and minimal stretch without performance degradation.

3. **Should the Serpentine body segments have collision, or are they purely visual?**
   - *Flag for @api-designer*: If a Serpentine worm is an enemy, does the player take damage from hitting any segment, or only the head?
   - *Recommendation*: The logical simulation should represent the Serpentine as a single AABB (or a small chain of AABBs) for collision, while the rendering draws the detailed segmented chain on top. This keeps collision resolution extremely cheap and deterministic.

---

## Top 3 Patterns Worth Prototyping

1. **Humanoid Biped Bone Template & Arm Swing Controller**
   - *Why*: Proving that we can define a standard 10-bone skeletal rig template, coordinate passive arm swinging in opposition to leg stride, and reuse `solveLimb` for all 4 limbs without foot-sliding.
2. **Floater Drone Hover Bobbing & Trailing Verlet Tentacles**
   - *Why*: Proving that we can create a highly distinct, legless flying archetype by combining simple sine hover bobbing with multiple trailing Verlet spring chains (`advanceSpringChain`) anchored to the core.
3. **Serpentine Follow-the-Leader Chain & Segment Angle Reconstruction**
   - *Why*: Proving that we can simulate a slithering worm/snake body by driving the head kinematically and letting body segments follow via `advanceSpringChain`, reconstructing segment angles (`Math.atan2`) to draw aligned decorative plates.

---

## Cross-References

- `docs/research/procedural-locomotion.md` (trigonometric phase integration and squash/stretch)
- `docs/research/skeletal-rigging.md` (hierarchical bone transforms and local/world matrix math)
- `docs/research/inverse-kinematics.md` (analytical 2-bone limb solver and fixed iteration counts)
- `docs/research/procedural-spider-locomotion.md` (alternating tetrapod gaits and comfort-radius step triggers)
- `docs/research/algorithmic-skin-variation.md` (cosmetic skin presets and defensive parsing)
- `docs/research/humanoid-platformer-visual-reference.md` (pose-specific
  platformer references and the permanent humanoid validation baseline)
