# Procedural Spider Locomotion & Organic Body Rendering

> Research note for procedurally-animated multi-legged spider-like enemies. Slug: `procedural-spider-locomotion`.
> Investigated: 2026-07-22.

## TL;DR

Procedural spider locomotion replaces pre-baked scuttling animations with real-time mathematical gait coordination and analytical Inverse Kinematics (IK), generating highly adaptive, organic, and genuinely unsettling multi-legged movement. For `aicraft-engine`—a zero-runtime-dependency, deterministic Canvas2D library—this technique allows us to build terrifying, wall-climbing, multi-legged enemies that plant their feet realistically on tile-grid terrain without the memory or performance overhead of spritesheets. By combining an **Alternating Tetrapod Gait Coordinator** (which groups legs into staggered sets to maintain balance) with a **Comfort-Radius Step Trigger** (which lifts and plants feet in parabolic arcs when they drift too far from their rest positions) and an **Analytical 2-Bone Limb Solver**, we can achieve a highly performant, scuttling locomotion system. We identify **Alternating Tetrapod Gait Coordination**, **Comfort-Radius Step Triggering with Velocity Overshoot**, and a **Segmented Organic Body Stack** (using breathing squash/stretch and seeded jittered polygons) as the top 3 patterns worth prototyping.

## Why this matters for aicraft-engine

- **Pillars Touched**: Directly extends **Pillar 1 (Primitives / Animation)**, integrates with **Pillar 4 (Fake-3D / character stacks)**, and supports **Pillar 2 (Cosmetics / Skins)**.
- **Consumer Games**: *the reference implementation* (a side-view platformer) and future card-based village builders or procedural RTS games need scary, responsive, and environmental-aware enemies.
- **Unlocks**:
  - **Zero-Asset Scary Enemies**: Procedural scuttling reads as far more organic and creepy than pre-baked sprites, making spider-like enemies genuinely scary while keeping asset sizes at zero.
  - **Wall and Ceiling Crawling**: Since foot placement is calculated dynamically by querying the tile-grid solidity, the spider can naturally crawl up walls, hang from ceilings, and navigate uneven platforms, aligning its body angle to the surface normal.
  - **Dynamic Procedural Variety**: Swapping leg counts (4, 6, 8, or more), leg lengths, body segmentation, eye counts, and colors allows us to generate an infinite variety of arachnid and insectoid enemies from a single codebase.

---

## Biomechanics & Game Feel Survey

### 1. Real Arachnid Biomechanics
Real spiders walk using an **alternating tetrapod gait** (Shultz, JEB 1987; Ma et al., 2019). Spiders have 8 legs, numbered L1-L4 on the left and R1-R4 on the right, from anterior (front) to posterior (back). 
- **Gait Coordination**: The legs are divided into two alternating sets of four:
  - **Set A**: L1, R2, L3, R4
  - **Set B**: R1, L2, R3, L4
- **Phase Shift**: While Set A is in the **stance phase** (planted on the ground, supporting and propelling the body), Set B is in the **swing phase** (lifting, arcing forward, and searching for the next foot-plant). The sets are exactly 180 degrees ($\pi$ radians) out of phase.
- **Hydraulic Extension**: Unlike vertebrates, spiders use muscular flexion to pull their legs inward but rely on **hydraulic pressure** (hemolymph) to extend them outward. This biomechanical asymmetry results in a distinct, snappy leg extension that reads as highly mechanical yet organic.

### 2. Notable Games with Procedural Creatures
- ***Rain World* (Videocult)**: Famous for its physics-driven procedural creature animation. Its lizards and spiders use a combination of procedural leg placement and physical body segments connected by Verlet springs. Spiders scuttle at high frequencies, climb on any surface, and can coalesce into larger swarms, looking incredibly organic, squishy, and terrifying.
- ***Deep Rock Galactic* (Ghost Ship Games)**: The Glyphid swarms utilize highly realistic procedural legwork. Their legs scuttle at high frequencies, and their bodies are suspended very close to the ground, giving them an aggressive, predatory posture.
- ***Grounded* (Obsidian Entertainment)**: The wolf spiders are famously terrifying. They use a low body posture, sudden twitchy direction changes, and high-frequency leg scuttling. When they accelerate, their gait becomes slightly asymmetric and chaotic, which triggers a primal fear response in players.
- ***Terraria* (Re-Logic)**: Wall-crawling spiders crawl on walls and ceilings in a 2D tile-grid world. Their legs anchor to nearby solid tiles, and their bodies rotate to align with the surface normal.
- ***Spelunky* (Mossmouth)**: Spiders hang from ceilings, drop down on players, and scuttle on floors, demonstrating simple but effective side-view 2D platformer behaviors.

### 3. What Makes a Spider "Scary" vs. "Cute"?
- **High Step Frequency**: Cute spiders take slow, rhythmic steps. Scary spiders scuttle at extremely high frequencies (e.g., 8-12 steps per second), making their legs appear as a frantic blur.
- **Low Body Posture (Sprawling)**: Cute spiders stand tall on vertical legs. Scary spiders keep their body suspended very close to the ground (low clearance) with wide, splayed legs bending outward and upward before pinning downward.
- **Jittery Appendages**: Twitching pedipalps and antennae (using `springy-rod`) at the front of the head that react to movement and player proximity.
- **Asymmetric/Chaotic Gait under Acceleration**: When a spider accelerates rapidly, slipping from a perfectly coordinated alternating tetrapod gait into a **free-stepping** model (where each leg steps independently as soon as it exceeds its comfort zone, rather than waiting for its group's turn) creates a chaotic, frantic scuttle that reads as highly aggressive.
- **Body Twitching/Shaking**: Subtle, high-frequency body jittering when moving or preparing to pounce.

---

## Prior Art Survey

### Pattern 1: Alternating Tetrapod Gait Coordinator (Seeded Phase-Accumulator)
- **Source**: "Simplified Models of Terrestrial Arthropod Gaits" & Wolfram Cloud.
- **What it does**: Coordinates 8 legs into two staggered sets (Set A vs Set B) using a phase accumulator. It ensures that only one set of legs is in motion (swing phase) at any given time, while the other set remains planted (stance phase) to support the body, maintaining perfect balance and preventing all legs from lifting simultaneously.
- **Algorithmic shape**:
  ```typescript
  export interface LegGaitState {
    readonly legId: string;
    readonly set: 'A' | 'B';
    phase: number;          // Phase in radians [0, 2pi)
    isSwinging: boolean;
    stepLerp: number;       // Progress of current step [0, 1]
    startPos: Vec2;
    endPos: Vec2;
  }

  export interface GaitCoordinator {
    phase: number;          // Global gait phase
    readonly legs: LegGaitState[];
  }

  /**
   * Coordinated gait step. Set A and Set B are 180 degrees out of phase.
   */
  export function stepCoordinatedGait(
    coordinator: GaitCoordinator,
    speed: number,
    dt: number,
    stepDuration: number = 0.15
  ): GaitCoordinator {
    const dPhase = speed * Math.PI * 2 * dt;
    const nextPhase = (coordinator.phase + dPhase) % (Math.PI * 2);

    const nextLegs = coordinator.legs.map(leg => {
      const legPhase = leg.set === 'A' ? nextPhase : (nextPhase + Math.PI) % (Math.PI * 2);
      const isSwinging = legPhase > 0 && legPhase < Math.PI && speed > 0.1;
      
      let stepLerp = leg.stepLerp;
      if (isSwinging) {
        stepLerp = Math.min(1.0, stepLerp + dt / stepDuration);
      } else {
        stepLerp = 0.0; // Reset when stance phase begins
      }

      return {
        ...leg,
        phase: legPhase,
        isSwinging,
        stepLerp
      };
    });

    return {
      phase: nextPhase,
      legs: nextLegs
    };
  }
  ```
- **Determinism profile**: Pure mathematical operations. Fully deterministic.
- **Runtime cost**: Extremely cheap ($O(N)$ where $N$ is the number of legs, typically 8).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is completely zero-dependency and pure, mapping directly to our Canvas2D rendering model.
- **What to steal**: **Phase-shifted leg sets**. Grouping legs into Set A and Set B and offsetting their phases by $\pi$ radians guarantees that the spider always has a stable base of support and never lifts all legs at once.
- **What to avoid**: Hardcoding the step duration or phase offset. Fast-moving spiders need a shorter step duration and higher frequency, while heavy or slow spiders need a slower, more deliberate gait.

---

### Pattern 2: Distance-Based Comfort-Radius Step Trigger (with Velocity Overshoot)
- **Source**: David Rosen's GDC talk "Procedural Animation" (Wolfire / Overgrowth) & Ahmet Kose's procedural spider.
- **What it does**: Triggers a footstep when the distance between a leg's actual planted foot position and its default "rest position" (relative to the body) exceeds a specific "comfort radius." To anticipate future body movement and prevent the foot from immediately falling behind again, the target step destination is projected forward along the body's velocity vector (overshoot prediction) and lands in a smooth parabolic lift arc.
- **Algorithmic shape**:
  ```typescript
  export interface StepTriggerConfig {
    readonly comfortRadius: number;  // Distance threshold to trigger step
    readonly overshootFactor: number; // How far to step ahead of rest position
    readonly stepHeight: number;     // Height of the parabolic lift arc
  }

  export interface StepTargetResult {
    readonly nextEndPos: Vec2;
    readonly nextMidPos: Vec2;
    readonly triggerStep: boolean;
  }

  export function evaluateStepTrigger(
    currentFootPos: Vec2,
    defaultRestPosWorld: Vec2,
    bodyVelocity: Vec2,
    config: StepTriggerConfig
  ): StepTargetResult {
    const dx = defaultRestPosWorld.x - currentFootPos.x;
    const dy = defaultRestPosWorld.y - currentFootPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > config.comfortRadius) {
      // Predict future position based on velocity (overshoot)
      const targetX = defaultRestPosWorld.x + bodyVelocity.x * config.overshootFactor;
      const targetY = defaultRestPosWorld.y + bodyVelocity.y * config.overshootFactor;
      const nextEndPos = { x: targetX, y: targetY };

      // Calculate mid-point and lift it upward to form a parabolic arc
      const midX = (currentFootPos.x + targetX) / 2;
      const midY = (currentFootPos.y + targetY) / 2 - config.stepHeight;
      const nextMidPos = { x: midX, y: midY };

      return { nextEndPos, nextMidPos, triggerStep: true };
    }

    return { nextEndPos: currentFootPos, nextMidPos: currentFootPos, triggerStep: false };
  }

  /**
   * Quadratic Bezier curve for parabolic step lift.
   */
  export function sampleStepArc(start: Vec2, mid: Vec2, end: Vec2, t: number): Vec2 {
    const mt = 1 - t;
    return {
      x: mt * mt * start.x + 2 * mt * t * mid.x + t * t * end.x,
      y: mt * mt * start.y + 2 * mt * t * mid.y + t * t * end.y
    };
  }
  ```
- **Determinism profile**: Pure mathematical operations. Fully deterministic.
- **Runtime cost**: Very low ($O(1)$ per leg).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is the gold standard for procedural leg placement, ensuring that feet adapt dynamically to body speed and direction.
- **What to steal**: **Velocity overshoot prediction**. Projecting the step target forward based on the body's current velocity prevents "foot sliding" and makes the leg movement look highly proactive and organic.
- **What to avoid**: Sudden snapping. If a step is triggered, the foot must smoothly interpolate (using `sampleStepArc` or a cubic ease) from its start position to its end position over several frames, rather than snapping instantly.

---

### Pattern 3: Multi-Surface Tile-Grid Ground-Sampling (Wall/Ceiling Climbing)
- **Source**: *Terraria* wall-crawling spiders & *Rain World* terrain-sensing.
- **What it does**: Samples the tile-grid solidity near a leg's rest position to find a valid surface (floor, wall, or ceiling) to plant the foot. It supports wall-climbing and ceiling-crawling by casting short rays (or performing grid-aligned tile lookups) in multiple directions based on the spider's local orientation, aligning the body angle to the average surface normal.
- **Algorithmic shape**:
  ```typescript
  export type SurfaceType = 'floor' | 'wall_left' | 'wall_right' | 'ceiling' | 'none';

  export interface GroundSampleResult {
    readonly point: Vec2;
    readonly normal: Vec2;
    readonly surface: SurfaceType;
  }

  /**
   * Samples the nearest solid tile in a specific direction.
   */
  export function sampleTileSurface(
    origin: Vec2,
    direction: Vec2,
    maxDistance: number,
    tileSize: number,
    isSolid: (tileX: number, tileY: number) => boolean
  ): GroundSampleResult | null {
    const steps = Math.ceil(maxDistance / (tileSize / 2));
    const stepX = (direction.x * maxDistance) / steps;
    const stepY = (direction.y * maxDistance) / steps;

    for (let i = 0; i <= steps; i++) {
      const checkX = origin.x + stepX * i;
      const checkY = origin.y + stepY * i;
      const tileX = Math.floor(checkX / tileSize);
      const tileY = Math.floor(checkY / tileSize);

      if (isSolid(tileX, tileY)) {
        // Calculate collision point and normal
        const point = { x: checkX, y: checkY };
        const normal = { x: -direction.x, y: -direction.y }; // Simplified normal
        return { point, normal, surface: 'floor' }; // Surface type derived from normal
      }
    }

    return null;
  }
  ```
- **Determinism profile**: 100% deterministic, relying on the static tile-grid solidity.
- **Runtime cost**: Low to moderate. Casting rays can be expensive if done every frame for every leg.
- **Dependencies**: None (composes with the library's existing `worldToTile` and `TileSolidityQuery` primitives).
- **Fit for our constraints**: Strong. It allows the spider to interact natively with the game's existing tile-grid collision layer.
- **What to steal**: **Multi-directional surface sampling**. Checking for walls and ceilings as well as floors allows the spider to climb up vertical shafts and crawl upside down, which is highly creepy and atmospheric.
- **What to avoid**: High-frequency raycasting. To prevent performance drops, we must **lazy-sample** the ground: only query the tile-grid when a leg is actually preparing to trigger a step, rather than running raycasts for all 8 legs on every single frame.

---

### Pattern 4: Segmented Organic Body Stack (Cephalothorax, Abdomen, Chelicerae & Pedipalps)
- **Source**: Sokpop Collective's character construction method & *Rain World* soft-body segments.
- **What it does**: Composes the spider's body from a stack of distinct, rigid vector primitives that are offset hierarchically. It represents the body as two main segments: a **cephalothorax** (head/chest, where legs attach) and an **abdomen** (rear, larger, squishy). It adds visual organic-ness by applying breathing squash/stretch to the abdomen and attaching twitchy, physics-based pedipalps (using `springy-rod`) and multiple high-contrast eyes.
- **Algorithmic shape**:
  ```typescript
  export interface SpiderBodyPose {
    readonly cephalothorax: { x: number; y: number; radius: number };
    readonly abdomen: { x: number; y: number; rx: number; ry: number };
    readonly eyes: readonly { x: number; y: number; radius: number }[];
    readonly pedipalps: readonly Vec2[][]; // Verlet node chains
  }

  export function evaluateSpiderBody(
    bodyPos: Vec2,
    facing: 1 | -1,
    tick: number,
    velocity: Vec2,
    pedipalpChains: readonly VerletNode[][]
  ): SpiderBodyPose {
    // 1. Cephalothorax (core center)
    const cephX = bodyPos.x;
    const cephY = bodyPos.y;
    const cephRadius = 16;

    // 2. Abdomen (rear segment)
    // Lags behind the cephalothorax based on velocity, and has an ambient breathing cycle
    const breathe = Math.sin(tick * 0.08) * 0.05; // 5% scale variation
    const lagX = -velocity.x * 0.15;
    const lagY = -velocity.y * 0.15;
    
    const abdX = cephX - 22 * facing + lagX;
    const abdY = cephY + lagY;
    const abdRx = 24 * (1.0 - breathe);
    const abdRy = 18 * (1.0 + breathe); // Volume-preserving scale

    // 3. Multiple Eyes (8 eyes of varying sizes)
    const eyeOffsets = [
      { dx: 6, dy: -4, r: 3 },  { dx: 10, dy: -2, r: 4 },
      { dx: 12, dy: 3, r: 2 },   { dx: 8, dy: 5, r: 2 },
      { dx: 4, dy: -8, r: 1.5 }, { dx: 12, dy: -6, r: 1.5 },
      { dx: 14, dy: 0, r: 1.5 }, { dx: 6, dy: 8, r: 1.5 }
    ];
    const eyes = eyeOffsets.map(eye => ({
      x: cephX + eye.dx * facing,
      y: cephY + eye.dy,
      radius: eye.r
    }));

    return {
      cephalothorax: { x: cephX, y: cephY, radius: cephRadius },
      abdomen: { x: abdX, y: abdY, rx: abdRx, ry: abdRy },
      eyes,
      pedipalps: pedipalpChains.map(chain => chain.map(n => ({ x: n.x, y: n.y })))
    };
  }
  ```
- **Determinism profile**: Pure mathematical operations. Fully deterministic.
- **Runtime cost**: Negligible ($O(1)$ per frame).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It allows us to build highly expressive, organic-feeling spider bodies using only basic Canvas2D drawing commands (like `ctx.arc` or custom ellipse rendering) with zero sprite assets.
- **What to steal**: **Segmented body lag and volume-preserving breathing**. Offsetting the abdomen so that it lags behind the head based on velocity, combined with a subtle breathing squash/stretch, makes the spider look squishy and alive.
- **What to avoid**: Drawing the body as a single static circle. Spiders look rigid and robotic unless their body segments move independently and react to velocity.

---

### Pattern 5: Fail-Safe Leg Tucking & Dangling (for Ledges, Gaps, and Airtime)
- **Source**: *Grounded* spider falling physics & *Rain World* dangling limbs.
- **What it does**: Handles edge cases where a leg has no solid tile beneath it (e.g., when the spider walks over a gap, climbs past a ledge, or is knocked into the air). Instead of letting the IK solver stretch the leg infinitely or snap to invalid coordinates, the fail-safe system smoothly blends the foot target to a tucked position near the body or a dangling vertical line that sways with gravity.
- **Algorithmic shape**:
  ```typescript
  export interface FailSafeLegState {
    readonly legId: string;
    readonly defaultRestLocal: Vec2;
    currentFootWorld: Vec2;
    targetFootWorld: Vec2;
    dangleAngle: number;
    blendWeight: number; // 0 = grounded (IK), 1 = dangling/tucked (fail-safe)
  }

  export function stepFailSafeLeg(
    state: FailSafeLegState,
    bodyPos: Vec2,
    facing: 1 | -1,
    hasGround: boolean,
    groundPoint: Vec2,
    gravity: number,
    dt: number,
    blendSpeed: number = 8
  ): FailSafeLegState {
    let nextFootWorld = { ...state.currentFootWorld };
    let nextTargetWorld = { ...state.targetFootWorld };
    let nextBlendWeight = state.blendWeight;
    let nextDangleAngle = state.dangleAngle;

    if (hasGround) {
      // Grounded: target is the ground collision point
      nextTargetWorld = { ...groundPoint };
      nextBlendWeight = Math.max(0.0, nextBlendWeight - blendSpeed * dt);
    } else {
      // Airtime/Gap: target is a dangling vertical line beneath the joint
      nextBlendWeight = Math.min(1.0, nextBlendWeight + blendSpeed * dt);
      
      // Simple pendulum swing for dangling leg
      const swingFreq = 5.0;
      const swingAmp = 0.15;
      nextDangleAngle = Math.sin(bodyPos.x * 0.05 + nextBlendWeight * swingFreq) * swingAmp;

      const restWorldX = bodyPos.x + state.defaultRestLocal.x * facing;
      const restWorldY = bodyPos.y + state.defaultRestLocal.y;

      // Dangling target points straight down from the rest position
      const dangleLength = 32;
      nextTargetWorld = {
        x: restWorldX + Math.sin(nextDangleAngle) * dangleLength,
        y: restWorldY + Math.cos(nextDangleAngle) * dangleLength
      };
    }

    // Smoothly blend the actual foot position towards the target
    const w = nextBlendWeight;
    nextFootWorld = {
      x: (1 - w) * nextFootWorld.x + w * nextTargetWorld.x,
      y: (1 - w) * nextFootWorld.y + w * nextTargetWorld.y
    };

    return {
      ...state,
      currentFootWorld: nextFootWorld,
      targetFootWorld: nextTargetWorld,
      dangleAngle: nextDangleAngle,
      blendWeight: nextBlendWeight
    };
  }
  ```
- **Determinism profile**: Pure stateful progression. Fully deterministic when using dt as a parameter.
- **Runtime cost**: Extremely cheap ($O(1)$ per leg).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Essential for preventing visual glitches and solver blowouts when the spider is airborne or navigating complex geometry.
- **What to steal**: **Smooth blend weight interpolation**. Blending the foot position between world-space ground locks and local dangling/tucked states prevents sudden 1-frame pops and keeps the legs looking natural in mid-air.
- **What to avoid**: Hard-locking the foot target to the ground without a fail-safe, which causes the leg to stretch infinitely across the screen when the spider falls.

---

## Reference Implementations

- **`majidmanzarpour/threejs-procedural-spider`** ([GitHub](https://github.com/majidmanzarpour/threejs-procedural-spider)): Teaches closed-form analytical IK, gait improvisation, wall-climbing, and body leaning.
- **`PhilS94/Unity-Procedural-IK-Wall-Walking-Spider`** ([GitHub](https://github.com/PhilS94/Unity-Procedural-IK-Wall-Walking-Spider)): Teaches terrain-sensing, wall-walking, and surface-normal alignment in a procedural spider.
- **`FootPositioner.cs`** ([GitHub](https://github.com/Merxon22/Rain-World-Animation/blob/main/FootPositioner.cs)): Teaches 2D procedural walk animation, parabolic step arcs, and alternate feet movement.
- **`showcase/helpers/slime-knight.ts`** (Local): Teaches springy-rod antennae and procedural character posing.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Alternating Tetrapod Gait | Symmetrical, staggered phase diagram for 8-legged walking (L1, R2, L3, R4 vs R1, L2, R3, L4). | ScienceDirect: Terrestrial locomotion in arachnids |
| Rain World Spiders | High-frequency scuttling legs, low body posture, and multi-surface climbing in 2D. | Videocult: Rain World |
| Grounded Wolf Spider | Terrifying, low-slung posture, sudden twitchy lunges, and asymmetric scuttling under acceleration. | Obsidian Entertainment: Grounded |
| Parabolic Foot-Step Arc | How a foot lifts and lands in a smooth, eased arc between startPos, midPos, and endPos. | Medium: Recreating Rain World's 2D Procedural Animation |

---

## Open Questions

1. **Gait Coordination vs. Free-Stepping**:
   Should we enforce a strict alternating tetrapod gait (Set A vs Set B) under all conditions, or should we let legs step freely as soon as they exceed their comfort radius?
   - *Analysis*: A strict alternating gait looks highly coordinated and stable (good for a "robotic" or "calm" spider). A "free-stepping" model with a simple rule ("don't step if your immediate neighbor is already stepping") looks much more chaotic, frantic, and scary under high acceleration, which fits the "scuttling/scary" requirement perfectly.
   - *Recommendation*: Support both. Introduce a `gaitMode` parameter: `'coordinated'` (strict alternating tetrapod) or `'frantic'` (free-stepping with neighbor-lock).

2. **Wall-Climbing in a 2D Platformer**:
   The library's platformer kernel (`src/platformer/kernel.ts`) is side-view and primarily gravity-based. If a spider climbs walls or ceilings, does it need to run custom AABB physics, or can it be a purely visual effect where the spider's logical body is placed on a path (or waypoint) and the legs procedurally anchor to the nearest solid tiles?
   - *Analysis*: For `aicraft-engine`, keeping the simulation headless and simple is key. If the spider is a patrolling hazard, its path can be represented as a kinematic path (waypoints) that goes along walls and ceilings, or a simple state machine. The legs will automatically anchor to the nearest solid tiles, and the body will rotate to align with the surface normal. This keeps the physics extremely simple and robust.

3. **Leg Count in Side-View**:
   In a 2D side-view platformer, drawing all 8 legs can look extremely cluttered and messy (legs overlapping and crossing). Should we draw all 8 legs, or should we draw only 4 legs (representing the 4 legs on the facing side) or use a layered approach (4 foreground legs, 4 background legs drawn with a darker shade)?
   - *Analysis*: A layered approach (4 foreground legs, 4 background legs drawn darker) is the industry standard for 2D side-view multi-legged creatures (e.g., *Hollow Knight* or *Rain World*). It maintains the "8-legged spider" silhouette while preventing visual clutter and overlapping.

---

## Top 3 Patterns Worth Prototyping

1. **Alternating Tetrapod Gait Coordinator (with Coordinated vs. Frantic Modes)** — Proving that we can coordinate 8 legs into two staggered sets (Set A vs Set B) with smooth phase-shifted walking, and support a "frantic" free-stepping mode for scary scuttling.
2. **Comfort-Radius Step Trigger (with Velocity Overshoot and Parabolic Lift)** — Prototyping a foot-stepping system where feet lift and land in smooth parabolic arcs when they drift past a comfort threshold, using velocity overshoot to anticipate future body positions.
3. **Segmented Organic Body Stack (with Seeded Jittered Polygons & Breathing Abdomen)** — Proving that we can draw an organic-looking spider body (cephalothorax + abdomen + 8 eyes + chelicerae) using cheap, deterministic vector primitives and breathing squash/stretch, matching the Sokpop aesthetic.

---

## Cross-References

- `docs/research/inverse-kinematics.md` (the 2-bone analytical Limb Solver that draws the legs)
- `docs/research/procedural-locomotion.md` (the phase-accumulator and squash/stretch concepts)
- `docs/research/springy-rod.md` (the `advanceSpringRod` primitive used for pedipalps and antennae)
- `docs/research/platformer-enemy-archetypes.md` (the behavior-registry system where this spider handler is registered)
- The canonical Sokpop reference (sokpop.itch.io) (Sokpop's primitive-stack character construction)
