# Particle Emitter Abstractions

> Research note for particle emitter abstractions. Slug: `particle-emitters`.
> Investigated: 2026-06-20.

## TL;DR

Particle emitter abstractions extend basic one-shot radial bursts into continuous, shape-bounded, and directional physical simulations. This note surveys four key patterns to address the current limitations of the `aicraft-engine` particle module: **time-accumulated continuous emission** (pure state integration for steady particle streams), **regional & shape-based spawning** (deterministic sampling from lines, rectangles, and circles), **directional cone spawning** (angular velocity constraint mapping), and **heterogeneous particle physics** (local gravity and drag scaling). For `aicraft-engine`—a zero-runtime-dependency, deterministic Canvas2D library—we propose maintaining the pure/immutable core for simulation-affecting particles while introducing a high-performance, zero-allocation **Mutable Particle Pool** in the renderer-adjacent layer to eliminate garbage collection (GC) overhead for dense visual effects.

## Why this matters for aicraft-engine

- **Pillars Touched**: Directly extends **Pillar 1 (Primitives / Particles)** and feeds into **Pillar 4 (Fake-3D / environmental FX)**.
- **Consumer Games**: Consumer titles (e.g., a card-based village builder with active campfires, or a platformer with lava pools) need continuous, directional, and regional particle effects.
- **Unlocks**:
  - **Dynamic Environments**: Continuous fire, smoke, bubbles, and weather effects (rain, snow) can be rendered entirely procedurally.
  - **Heterogeneous FX**: Fire and smoke can be emitted from the same source but behave differently (smoke rises and slows down, fire falls and fades).
  - **Zero-Allocation Sim Compatibility**: Maintaining the pure/immutable state progression of the deterministic core while supporting continuous emission.

---

## Prior Art Survey

### Pattern 1: Time-Accumulated Continuous Emitter State
- **Source**: LibGDX `ParticleEmitter` & Phaser 3 `ParticleEmitter`
- **What it does**: Tracks fractional particle emission over time using a time accumulator. Instead of spawning particles in a single burst, the emitter accumulates elapsed time (`dt` or milliseconds) and determines how many particles should be spawned in the current tick based on an emission rate (particles per tick).
- **Algorithmic shape**:
  ```typescript
  export interface EmitterState {
    x: number;
    y: number;
    accumulator: number; // Accumulated fractional particles to spawn
  }

  export interface EmitterConfig {
    rate: number; // Particles to spawn per tick (can be fractional, e.g. 0.1 for 1 particle every 10 ticks)
  }

  /**
   * Pure state progression. Integrates elapsed time and returns the number of
   * particles to spawn in this tick, along with the updated emitter state.
   */
  export function advanceEmitter(
    state: EmitterState,
    dt: number,
    config: EmitterConfig
  ): { nextState: EmitterState; spawnCount: number } {
    const totalAccumulated = state.accumulator + config.rate * dt;
    const spawnCount = Math.floor(totalAccumulated);
    return {
      nextState: {
        x: state.x,
        y: state.y,
        accumulator: totalAccumulated - spawnCount
      },
      spawnCount
    };
  }
  ```
- **Determinism profile**: Pure mathematical operations. Fully deterministic.
- **Runtime cost**: Negligible ($O(1)$).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It allows continuous emission while remaining completely pure and deterministic.
- **What to steal**: **Time accumulation of fractional particles**. Directly multiplying `rate * dt` and rounding can lead to lost particles or uneven emission if `dt` is small. Accumulating the remainder ensures that the exact requested emission rate is maintained over time.
- **What to avoid**: Avoid using wall-clock time (`Date.now()`). The accumulator must integrate using the simulation's logical `dt` parameter.

---

### Pattern 2: Regional & Shape-Based Spawning
- **Source**: LibGDX `ParticleEmitter` (SpawnShapeValue) & Phaser 3 `EmitZone`
- **What it does**: Spawns particles from a geometric region (line segment, rectangle, circle, or ring) rather than a single point. This is crucial for effects like a lava pool (spawning along a line segment or rectangle) or a shield bubble (spawning along a circle outline).
- **Algorithmic shape**:
  ```typescript
  export type SpawnRegion =
    | { type: 'point' }
    | { type: 'line'; x1: number; y1: number; x2: number; y2: number }
    | { type: 'rect'; x: number; y: number; w: number; h: number }
    | { type: 'circle'; cx: number; cy: number; radius: number; innerRadius?: number };

  /**
   * Deterministically sample a coordinate from a SpawnRegion.
   * Uses seeded RNG to maintain strict determinism.
   */
  export function sampleRegion(
    region: SpawnRegion,
    rng: () => number
  ): { x: number; y: number } {
    switch (region.type) {
      case 'point':
        return { x: 0, y: 0 }; // Relative to emitter origin
      case 'line': {
        const t = rng(); // [0, 1)
        return {
          x: region.x1 + t * (region.x2 - region.x1),
          y: region.y1 + t * (region.y2 - region.y1)
        };
      }
      case 'rect': {
        return {
          x: region.x + rng() * region.w,
          y: region.y + rng() * region.h
        };
      }
      case 'circle': {
        const angle = rng() * Math.PI * 2;
        const inner = region.innerRadius ?? 0;
        // Uniform distribution in a circle/ring requires square root of random factor
        const t = rng();
        const r = Math.sqrt(inner * inner + t * (region.radius * region.radius - inner * inner));
        return {
          x: region.cx + Math.cos(angle) * r,
          y: region.cy + Math.sin(angle) * r
        };
      }
    }
  }
  ```
- **Determinism profile**: Pure mathematical operations. Fully deterministic when using a seeded PRNG (`mulberry32`).
- **Runtime cost**: Extremely cheap ($O(1)$ per particle).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It relies on basic trigonometry and seeded random numbers.
- **What to steal**: **Uniform circle sampling**. Sampling radius linearly (`r = random() * R`) clusters particles near the center. Using `r = Math.sqrt(random()) * R` guarantees a uniform spatial distribution across the circle's area.
- **What to avoid**: Avoid rejection sampling (e.g., picking random points in a bounding box and checking if they are inside the circle) because it takes a variable number of RNG calls, which can desynchronize the RNG stream for subsequent simulation logic. Use closed-form analytical sampling instead.

---

### Pattern 3: Directional Cone Spawning
- **Source**: LibGDX `ParticleEmitter` (angleValue) & Phaser 3 `angle`
- **What it does**: Restricts particle velocities to a specific angular cone (defined by a base angle and a spread angle) instead of a full radial circle. This is essential for directional effects like a volcanic geyser, fire rising up, or a horizontal thruster trail.
- **Algorithmic shape**:
  ```typescript
  export interface ConeConfig {
    baseAngle: number;  // Direction of the cone center in radians
    spread: number;     // Total angular width of the cone in radians
    speedMin: number;   // Minimum spawn speed
    speedMax: number;   // Maximum spawn speed
  }

  /**
   * Deterministically compute velocity vector within an angular cone.
   */
  export function sampleConeVelocity(
    config: ConeConfig,
    rng: () => number
  ): { vx: number; vy: number } {
    // Sample angle uniformly within [baseAngle - spread/2, baseAngle + spread/2]
    const halfSpread = config.spread / 2;
    const angle = config.baseAngle + (rng() * 2 - 1) * halfSpread;
    
    // Sample speed uniformly within [speedMin, speedMax]
    const speed = config.speedMin + rng() * (config.speedMax - config.speedMin);
    
    return {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed
    };
  }
  ```
- **Determinism profile**: Pure mathematical operations. Fully deterministic when using a seeded PRNG.
- **Runtime cost**: Extremely cheap ($O(1)$ per particle).
- **Dependencies**: None.
- **Fit for our constraints**: Strong.
- **What to steal**: **Decoupled speed and angle sampling**. Parameterizing the cone with `speedMin`/`speedMax` and `baseAngle`/`spread` gives complete artistic control over the shape and velocity of the burst.
- **What to avoid**: Avoid hardcoding angles or using degree-based calculations. Keep all angles in radians to match standard JS/TS math APIs and avoid conversion overhead.

---

### Pattern 4: Heterogeneous Particle Physics with Local Scales
- **Source**: GameMaker Studio Particle Types & LibGDX's per-emitter configurations
- **What it does**: Allows particles in a single active array to have different physical behaviors (e.g., smoke rising with negative gravity and high drag, while fire falls with positive gravity and low drag). This is achieved by adding optional local coefficients (`gravityScale` and `dragScale`) to the `Particle` interface, which scale the global physics options during the `advance` step.
- **Algorithmic shape**:
  ```typescript
  // Extends src/particles/types.ts:Particle
  export interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    color?: string;
    
    // Additive non-breaking extensions:
    gravityScale?: number; // Multiplier for global gravity. e.g. -0.5 for smoke (rises)
    dragScale?: number;    // Multiplier for global drag. e.g. 0.9 for high drag
  }

  /**
   * Pure progression update supporting heterogeneous particle physics.
   * Non-breaking: if local scales are omitted, they default to 1.0.
   */
  export function advanceHeterogeneous(
    particles: readonly Particle[],
    dt: number,
    globalOpts: { gravity?: number; drag?: number } = {}
  ): Particle[] {
    const globalGravity = globalOpts.gravity ?? 0;
    const globalDrag = globalOpts.drag ?? 1;

    return particles.map((p) => {
      // Resolve local physics coefficients, falling back to 1.0
      const localGravityScale = p.gravityScale ?? 1.0;
      const localDragScale = p.dragScale ?? 1.0;

      const gravity = globalGravity * localGravityScale;
      const drag = globalDrag * localDragScale;
      const dragFactor = Math.pow(drag, dt);

      const vx = p.vx * dragFactor;
      const vy = (p.vy + gravity * dt) * dragFactor;

      return {
        ...p,
        x: p.x + vx * dt,
        y: p.y + vy * dt,
        vx,
        vy,
        life: p.life - dt
      };
    });
  }
  ```
- **Determinism profile**: Pure mathematical operations. Fully deterministic.
- **Runtime cost**: $O(N)$ where $N$ is the active particle count. Negligible overhead compared to standard `advance`.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is a non-breaking, backward-compatible extension of the existing `Particle` type and `advance` function.
- **What to steal**: **Local scale coefficients**. By storing optional `gravityScale` and `dragScale` directly on the particle, we can mix different particle types in a single array and update them in a single pass. This eliminates the need for the consumer to manage separate arrays for fire, smoke, and sparks.
- **What to avoid**: Avoid storing complex physics functions or callbacks on the particle itself, as this breaks JSON serializability and increases memory footprint. Store only simple numeric coefficients.

---

## Object Pooling vs. Immutability

### The Trade-off
- **Immutability (Deterministic Core)**: The current `advance()` and `cull()` functions are pure, returning brand-new arrays and particle objects. This is perfect for deterministic gameplay simulation, state rollback, replays, and debugging. Zero risk of side-effects.
- **Pooling (Renderer-Adjacent)**: High-frequency purely visual FX (like dense smoke clouds or lava bubbles) can trigger garbage collection (GC) pauses and frame-rate stutters due to allocating thousands of short-lived objects per second.

### The Resolution
We can support both paradigms without compromising our design principles:
1. **Pure/Immutable Core Progression**: Keep the existing pure `Particle` type and `advance`/`cull` pipeline. This is the default for simulation-affecting particles (e.g., gameplay-affecting gas clouds) and low-count visual FX.
2. **Mutable Particle Pool (Renderer-Adjacent)**: Introduce a pre-allocated, flat-array `MutableParticlePool` helper in the renderer-adjacent layer. This pool updates particles in-place and compacts the array without allocating any new objects per frame, satisfying the "Renderer-output buffer exception" in `docs/architecture.md`.

```typescript
export class MutableParticlePool {
  public readonly particles: Particle[];
  public activeCount: number = 0;

  constructor(maxParticles: number) {
    this.particles = Array.from({ length: maxParticles }, () => ({
      x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 0
    }));
  }

  /**
   * Spawn a particle in-place using a pre-allocated slot.
   * Zero allocation.
   */
  public spawn(
    x: number, y: number, vx: number, vy: number,
    life: number, size: number, color?: string,
    gravityScale?: number, dragScale?: number
  ): void {
    if (this.activeCount >= this.particles.length) return;
    
    const p = this.particles[this.activeCount];
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.maxLife = life; p.size = size; p.color = color;
    p.gravityScale = gravityScale; p.dragScale = dragScale;
    this.activeCount++;
  }

  /**
   * Update active particles in-place and compact the array.
   * Zero allocation.
   */
  public update(dt: number, globalGravity: number, globalDrag: number): void {
    let writeIdx = 0;
    for (let i = 0; i < this.activeCount; i++) {
      const p = this.particles[i];
      p.life -= dt;
      
      if (p.life > 0) {
        const gravity = globalGravity * (p.gravityScale ?? 1.0);
        const drag = globalDrag * (p.dragScale ?? 1.0);
        const dragFactor = Math.pow(drag, dt);

        p.vx *= dragFactor;
        p.vy = (p.vy + gravity * dt) * dragFactor;
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // Compact active particles to the front of the array
        if (writeIdx !== i) {
          const target = this.particles[writeIdx];
          target.x = p.x; target.y = p.y;
          target.vx = p.vx; target.vy = p.vy;
          target.life = p.life; target.maxLife = p.maxLife;
          target.size = p.size; target.color = p.color;
          target.gravityScale = p.gravityScale;
          target.dragScale = p.dragScale;
        }
        writeIdx++;
      }
    }
    this.activeCount = writeIdx;
  }
}
```

---

## Lifetime Curves

### Where should curves be evaluated?
- **Option A: On the Particle.** Storing start/end sizes, start/end alphas, and color gradients on every particle object. This bloats the particle size and increases allocation overhead.
- **Option B: On the Emitter Config / Evaluated in the Renderer (Recommended).** The particle stores only `life` and `maxLife`. The renderer calculates `t = 1 - life / maxLife` (normalized age in `[0, 1]`) and applies any curve it wants.

This is incredibly elegant because:
1. It keeps the `Particle` interface ultra-lightweight and serializable.
2. It decouples physics from rendering. The physics loop only updates positions and velocities; the renderer handles visual styling (like fading alpha, shrinking size, or blending colors).
3. It allows different renderers to draw the same particle differently (e.g., one renderer might draw smoke as a shrinking circle, while another draws it as a fading puff).

We can provide helper functions in the renderer-adjacent layer to evaluate common curves:
```typescript
export function evaluateSizeCurve(p: Particle, startSize: number, endSize: number): number {
  const t = 1 - p.life / p.maxLife;
  return lerp(startSize, endSize, t);
}

export function evaluateAlphaCurve(p: Particle, startAlpha: number, endAlpha: number): number {
  const t = 1 - p.life / p.maxLife;
  return lerp(startAlpha, endAlpha, t);
}
```

---

## Reference Implementations

- **LibGDX ParticleEmitter.java** ([GitHub: libgdx/libgdx](https://github.com/libgdx/libgdx/blob/master/gdx/src/com/badlogic/gdx/graphics/g2d/ParticleEmitter.java)): Teaches time-accumulated continuous emission, regional spawning (point, line, square, ellipse), and timeline-based keyframe interpolation.
- **Phaser 3 ParticleEmitter.js** ([GitHub: phaserjs/phaser](https://github.com/phaserjs/phaser/blob/master/src/gameobjects/particles/ParticleEmitter.js)): Teaches flexible configuration parsing (`EmitterOp`), emission zones (`RandomZone`, `EdgeZone`), and mutable object pooling (`dead`/`alive` arrays).
- **GameMaker Studio Particle System** ([YoYo Games Docs](https://manual.gamemaker.io/monthly/en-US/The_Asset_Editors/Room_Properties/Filters_and_Effects.htm)): Teaches the separation of particle systems (managers), particle types (physics/visual configurations), and particle emitters (spawning behavior).

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Continuous Fire & Smoke | Fire particles rising and falling back (positive gravity) while smoke particles rise higher (negative gravity) and spread out, creating a realistic campfire. | GameMaker Campfire Devlog |
| Lava Pool Regional Spawning | Bubbles and sparks spawning uniformly along a horizontal line segment (the lava surface) rather than a single point. | Sokpop *Stacklands* / *Sunset Kingdom* |
| Volcanic Geyser Cone Spawning | Particles bursting upwards within a narrow 30-degree vertical cone, simulating high-pressure directional emission. | Phaser 3 Particle Examples |

---

## Open Questions

- **RNG Stream Pollution**:
  When regional or cone spawning is active, the emitter calls the seeded RNG (`mulberry32`) multiple times per particle to resolve position and velocity. If the particle system is part of the deterministic gameplay simulation, these calls will advance the global simulation seed.
  *Recommendation*: The particle system should use its own dedicated, isolated RNG instance (created with a sub-seed) to prevent visual particle variation from polluting the RNG stream of critical gameplay systems (like combat hit rolls or card draws).
  
- **Reduced Motion Adaptation**:
  How should continuous emitters adapt when `prefersReducedMotion()` is active?
  *Recommendation*: The emitter should scale down its emission rate by a factor of 0.25 (or disable continuous emission entirely for heavy systems) to prevent visual overload, while maintaining the functional gameplay state.

---

## Top 3 Patterns Worth Prototyping

1. **Time-Accumulated Continuous Emitter State** — Prototyping a pure, non-mutating emitter state updater (`advanceEmitter`) to prove that steady, fractional particle streams can be generated deterministically without frame-rate-dependent drift.
2. **Seeded Regional & Cone Spawn Generators** — Prototyping deterministic shape-based coordinate sampling (lines, rectangles, circles) and angular cone mapping using our `mulberry32` RNG.
3. **Zero-Allocation Mutable Particle Pool** — Prototyping a high-performance in-place mutable particle pool in the renderer-adjacent layer to eliminate garbage collection overhead during dense visual effects.

---

## Cross-References

- `docs/architecture.md` (determinism rules, layer separation, and the renderer-output buffer exception)
- `docs/conventions.md` (code style rules and pure progression ops)
- `src/particles/advance.ts` (existing pure particle physics update)
- `src/primitives/color.ts` (contains `mixHex` for color interpolation)
