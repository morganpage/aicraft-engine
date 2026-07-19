# Deterministic 2D Platformer Kernel

> Research note for a deterministic 2D platformer simulation kernel (character controller + world model). Slug: `platformer-kernel`.
> Investigated: 2026-07-19.

## TL;DR

A deterministic 2D platformer kernel provides a headless, authoritative, fixed-step simulation of character movement, abilities, and world collisions, ensuring byte-identical replays and stable multiplayer synchronization. By composing low-level primitives (input edge accumulators, AABB resolvers, and apex-parameterized jump state machines) into a unified simulation loop, the kernel guarantees perfect responsiveness and tactile "game feel" across multiple platformer families (precision, momentum, and combat-action) via configuration presets. The top 3 patterns worth prototyping for our zero-runtime-dependency library are: (1) **Celeste's Integer-Pixel Kinematic Actor/Solid Model** with sub-pixel remainder storage to eliminate floating-point collision drift, (2) a **State-Machine-Driven Ability Composition Pattern** that avoids the god-class anti-pattern by isolating abilities into pure, testable state transitions, and (3) **Fixed-Step Accumulator Synchronization with Replay Checksumming** to verify simulation determinism.

## Why this matters for aicraft-engine

- **Pillars Touched**: Directly establishes **Pillar 4 (Fake-3D / advanced kinematics)** and integrates **Pillar 1 (Primitives / Seeded RNG / Particles)** into a cohesive, playable game-state controller.
- **Consumer Games**: Sibling games like *IMP - Not a Troll* (formerly *Spitekeep*) and future card-based sims or village builders need characters that can move, jump, dash, and ride moving platforms with absolute authority and perfect determinism.
- **Unlocks**:
  - **Authoritative Replay & Rollback**: A fully deterministic kernel allows the library to support 100% stable input-replay files (for leaderboards and anti-cheat) and client-side prediction with rollback networking (GGPO-style) without synchronization drift.
  - **Zero-Art Game Feel**: By embedding coyote time, jump buffering, wall slides, and dashes directly into the deterministic core, the library enables developers to build high-quality, professional-feeling games using only simple procedural shapes.
  - **Modular Kinematic Presets**: Allows developers to toggle between "snappy/instant" (Hollow Knight style) and "momentum/floaty" (Super Meat Boy / Sonic style) physics by simply swapping a configuration object.

---

## Prior Art Survey

### Pattern 1: Celeste's Actor/Solid Kinematic Model
- **Source**: Maddy Thorson's [Celeste and TowerFall Physics](https://maddymakesgames.com/articles/celeste_and_towerfall_physics/index.html) and [Player.cs / Actor.cs](https://github.com/NoelFB/Celeste/blob/master/Source/Player/Player.cs)
- **What it does**: Resolves collisions between moving characters (Actors) and level geometry (Solids) using axis-separated, integer-pixel movement with sub-pixel remainder storage. Actors and Solids are represented as Axis-Aligned Bounding Boxes (AABBs) with integer dimensions and positions.
- **Algorithmic shape**:
  ```typescript
  interface ActorState {
    x: number;          // Integer pixel position
    y: number;
    xRemainder: number; // Sub-pixel remainder [0, 1)
    yRemainder: number;
    width: number;
    height: number;
  }

  function moveX(actor: ActorState, amount: number, solids: readonly Solid[], onCollide?: () => void): ActorState {
    let next = { ...actor };
    next.xRemainder += amount;
    let move = Math.round(next.xRemainder);
    
    if (move !== 0) {
      next.xRemainder -= move;
      const sign = Math.sign(move);
      while (move !== 0) {
        const stepped: Rect = { x: next.x + sign, y: next.y, width: next.width, height: next.height };
        if (!checkOverlap(stepped, solids)) {
          next.x += sign;
          move -= sign;
        } else {
          if (onCollide) onCollide();
          break;
        }
      }
    }
    return next;
  }
  ```
- **Determinism profile**: Purely deterministic. By locking positions to integers and performing step-by-step collision checks, it eliminates IEEE 754 floating-point rounding drift across different browsers and platforms.
- **Runtime cost**: Very low. $O(N)$ where $N$ is the integer movement distance in pixels (typically capped to a maximum step size like 16px to prevent infinite loops).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is a pure, headless mathematical model that perfectly aligns with our zero-dependency, deterministic core.
- **What to steal**: **Sub-pixel remainder storage and integer-pixel step resolution**. This completely eliminates tunneling through thin walls without needing complex swept-AABB math.
- **What to avoid**: Avoid global mutable state during the step loop; the helper should be a pure function returning a new state.

### Pattern 2: Celeste's Player State Machine
- **Source**: Noel Berry's [Player.cs](https://github.com/NoelFB/Celeste/blob/master/Source/Player/Player.cs)
- **What it does**: Manages player state transitions (Normal, Dash, Climb, StStarFlyer, etc.) using an explicit enumeration and a state transition table. It handles input buffering, dash cooldowns, and dash locking by decrementing timers on each fixed tick.
- **Algorithmic shape**:
  ```typescript
  type PlayerStateEnum = 'normal' | 'dash' | 'climb' | 'wallSlide';

  interface PlayerState {
    state: PlayerStateEnum;
    dashTimer: number;       // Decrements by dt each tick
    dashCooldown: number;
    dashCount: number;
    // ...
  }
  ```
- **Determinism profile**: 100% deterministic. All timers are decremented by the fixed `dt` parameter rather than wall-clock reads (`Date.now()`).
- **Runtime cost**: Negligible ($O(1)$ state transitions).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It provides a clean, structured way to handle complex movement mechanics.
- **What to steal**: **Timer-based cooldowns and input buffers** driven strictly by the fixed-step simulation tick.
- **What to avoid**: Avoid Celeste's "one giant file" (5000+ lines) anti-pattern. We must decouple individual state behaviors into modular handlers.

### Pattern 3: Sebastian Lague's Raycast-Based Slope Handling
- **Source**: Sebastian Lague's [2DPlatformer-Tutorial](https://github.com/SebLague/2DPlatformer-Tutorial) (`Controller2D.cs`)
- **What it does**: Casts a grid of rays from the character's bounding box edges to detect slopes and adjust horizontal and vertical velocities. It uses trigonometry to "climb" and "descend" slopes smoothly, keeping the player snapped to the ground.
- **Algorithmic shape**:
  ```typescript
  function climbSlope(moveAmount: Vec2, slopeAngle: number): Vec2 {
    const moveDistance = Math.abs(moveAmount.x);
    const climbY = Math.sin(slopeAngle * DEG_TO_RAD) * moveDistance;
    if (moveAmount.y <= climbY) {
      return {
        x: Math.cos(slopeAngle * DEG_TO_RAD) * moveDistance * Math.sign(moveAmount.x),
        y: climbY
      };
    }
    return moveAmount;
  }
  ```
- **Determinism profile**: Depends on host floating-point precision of trigonometric functions (`Math.sin`, `Math.cos`).
- **Runtime cost**: Medium. Requires multiple raycasts and trigonometric evaluations.
- **Dependencies**: None, but requires a raycasting or line-segment intersection helper.
- **Fit for our constraints**: Medium. While highly robust for arbitrary smooth slopes, raycasting is complex to implement in a zero-dependency AABB-based engine and introduces minor floating-point drift risks.
- **What to steal**: **Trigonometric velocity projection** for climbing and descending slopes.
- **What to avoid**: Avoid full raycast grids if we can achieve the same feel using discrete tile-heightmap lookups (which are cheaper and 100% deterministic).

### Pattern 4: Hollow Knight's Snappy Kinematics
- **Source**: Team Cherry developer interviews and movement analysis.
- **What it does**: Implements extremely tight, non-physics-based movement characterized by instant acceleration, instant deceleration (no slide), constant jump velocity, and instant jump cutoff on button release.
- **Determinism profile**: Purely deterministic.
- **Runtime cost**: Extremely low.
- **Fit for our constraints**: Strong.
- **What to steal**: **Instant velocity snapping** and **non-decaying jump cutoff**. This is the easiest kinematic family to implement and test because it has zero momentum state.
- **What to avoid**: Avoid letting the character feel "sterile" or "robotic" by omitting secondary animation cues; even with snappy physics, visual-only squash/stretch must be applied to convey weight.

### Pattern 5: Super Meat Boy's Momentum & Apex Float
- **Source**: Tommy Refenes' GDC talks and postmortems.
- **What it does**: Implements high-speed, momentum-based movement with rapid acceleration/deceleration curves and a floaty jump apex. Near the apex of the jump (where vertical velocity is close to zero), gravity is scaled down (e.g., multiplied by `0.5`) to increase the player's "hang time" and air control.
- **Algorithmic shape**:
  ```typescript
  // Apex gravity scaling
  let activeGravity = gravity;
  if (Math.abs(vy) < APEX_THRESHOLD) {
    activeGravity = gravity * apexGravityMultiplier;
  }
  vy += activeGravity * dt;
  ```
- **Determinism profile**: Fully deterministic.
- **What to steal**: **Apex gravity scaling (hang time)** and **generous jump buffering**.
- **What to avoid**: Avoid extreme slide values that make the character feel like they are "walking on ice."

### Pattern 6: Sonic Physics Guide (Slope & Ground Modes)
- **Source**: [Sonic Physics Guide](https://info.sonicretro.org/Sonic_Physics_Guide)
- **What it does**: Implements a full momentum-based platformer engine with 360-degree slope walking, loop-the-loops, and wall running. It defines four **Ground Modes** (Floor, Right Wall, Ceiling, Left Wall) and transitions between them based on the player's speed and the surface angle.
- **Determinism profile**: High risk of floating-point drift due to heavy use of trigonometry and angle-based coordinate transformations.
- **Fit for our constraints**: Weak for the initial precision-platformer target, but highly valuable as a reference for advanced momentum-based presets.
- **What to steal**: The concept of **Ground Modes** to handle walking on walls and ceilings deterministically.

---

## Recommended Simulation Update Order

To guarantee determinism and prevent players from falling through moving platforms, getting crushed, or experiencing input lag, the simulation update must follow a strict, non-negotiable order of operations each tick:

```
[Fixed-Step Tick Start]
       │
       ▼
1. Move Solids (Platforms)  ◄─── Moving platforms advance first
       │
       ▼
2. Push & Carry Actors      ◄─── Solids push overlapping actors & carry riding actors
       │
       ▼
3. Process Inputs           ◄─── Poll edge accumulators & buffer inputs
       │
       ▼
4. Execute Abilities        ◄─── Update active ability state (Dash, Wall Jump, Climb)
       │
       ▼
5. Integrate Forces         ◄─── Apply gravity, acceleration, and air control
       │
       ▼
6. Resolve Actor Collision  ◄─── Resolve X, then Y collisions against level geometry
       │
       ▼
7. Emit Triggers & Events   ◄─── Fire landing, collection, and death events
       │
       ▼
[Fixed-Step Tick End]
```

### Citations & Rationale:
1. **Move Solids First**: As documented in Maddy Thorson's *Celeste and TowerFall Physics* article, moving platforms must update their positions *before* actors move. This ensures that the platform's leading edge is already in place to push or carry actors, preventing the player from falling through a rising platform.
2. **Push & Carry Before Actor Movement**: Pushing and carrying must be resolved immediately after solids move, using the actor's pre-tick position as the reference frame. This ensures that the player is correctly aligned with the platform before their own inputs are applied.
3. **Collision Resolution After Integration**: Integrating forces (gravity, walking speed) must happen *before* resolving collisions. This ensures that the final position returned at the end of the tick is guaranteed to be collision-free.

---

## Anti-Patterns Observed

1. **The God-Class Controller**: In Celeste, `Player.cs` is a massive 5000+ line file containing physics, state machines, animation, audio, and visual effects. This is a major maintainability trap.
   - *Fix*: Decouple physics integration, ability states, and visual posing into separate pure modules.
2. **Independent Axis Scale Decay**: Decaying horizontal and vertical squash/stretch scales independently using simple linear interpolation violates volume preservation (`scaleX * scaleY != 1`), making the character look "mushy" or "ghostly."
   - *Fix*: Maintain a single fractional displacement offset (`squashOffset`) from a 1D spring-damper, decay that single value, and compute the volume-preserving scale pair `(scaleX = 1 / (1 + squashOffset), scaleY = 1 + squashOffset)`.
3. **Input Lag for Visual Anticipation**: Delaying the physical jump launch to play a visual "crouch" animation makes the controls feel sluggish.
   - *Fix*: Launch the physics instantly, and apply a visual-only post-launch stretch (`scaleY = 1.15`) on the launch frame.
4. **Time-Driven Walk Cycles (Foot Sliding)**: Advancing the walk cycle phase based on time (`phase += dt`) while speed varies causes the feet to slide across the ground.
   - *Fix*: Couple the walk cycle phase directly to actual horizontal displacement (`dPhase = dx / (strideLength * Math.PI)`), as implemented in `src/animation/locomotion.ts`.

---

## Top 3 Patterns Worth Prototyping

### 1. Celeste-Style Integer-Pixel Kinematic Actor/Solid Model
- **Why**: It is the most robust, deterministic, and tunneling-free collision model for 2D grid-based platformers. By locking positions to integers and storing sub-pixel remainders, we completely eliminate floating-point collision drift across different browsers and platforms.
- **Implementation**: Create `src/fake3d/kinematic-body.ts` with pure functions `moveX` and `moveY` that accept a remainder-carrying state and return a fresh state.

### 2. State-Machine-Driven Ability Composition Pattern
- **Why**: It avoids the god-class anti-pattern while allowing developers to easily compose player capabilities (coyote jump, wall slide, dash, climb) via configuration presets.
- **Implementation**: Define a pure `updatePlatformerKernel(state, inputs, dt, config)` function that delegates to a set of active ability states. Each ability is a self-contained pure function that transforms the character's velocity and state.

### 3. Fixed-Step Accumulator Synchronization with Replay Checksumming
- **Why**: Essential for guaranteeing and verifying determinism in our zero-dependency library.
- **Implementation**: Create a test suite that feeds a fixed sequence of inputs to the platformer kernel, integrates it over 1000 frames, and asserts that the resulting player position and state checksum are byte-identical across runs.

---

## Open Questions for @api-designer

1. **How to compose abilities without a god-class?**
   - *Proposal*: Use an array of "Ability Processors" that execute in a fixed order during the tick. Each processor is a pure function: `(state: KernelState, inputs: Inputs, dt: number) => KernelState`.
2. **How to handle moving-platform carry without a full rigid-body engine?**
   - *Proposal*: Compose the existing `resolveAxisY` primitive with a platform-riding check. If the player was grounded on a moving platform last tick, apply the platform's displacement ($dx, dy$) to the player's position *before* running the player's own movement resolution.
3. **How to expose stable contact identity?**
   - *Proposal*: Return a `contacts` object at the end of each tick containing stable identifiers for what the player is touching (e.g., `groundId: string | null`, `leftWallId: string | null`), which the developer can use to trigger game-specific logic (like taking damage or opening doors).

---

## Cross-References

- `docs/research/procedural-locomotion.md` — Walk cycle phase integration.
- `docs/research/platformer-juice.md` — Squash/stretch, screen shake, and hit-stop.
- `src/animation/jump.ts` — Existing apex-parameterized jump state machine.
- `src/collision/resolve.ts` — Existing per-axis AABB resolver.
- `src/collision/moving-gap.ts` — Existing dynamic geometry primitive.
- `src/game-loop/fixed-step.ts` — Fixed-step accumulator.
- `ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md` — Strategic context on Sokpop's minimalist rendering.
