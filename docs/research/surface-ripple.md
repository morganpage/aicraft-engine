# 1D Surface Ripple and Wave-on-Polyline Techniques

> Research note for 1D surface ripple and wave-on-polyline techniques. Slug: `surface-ripple`.
> Investigated: 2026-06-20.

## TL;DR

Liquid surfaces in 2D side-scrollers (such as lava pools, acid pits, water hazards, and energy shields) are best modeled as a 1D wave displacement applied to a baseline polyline. This note surveys three primary techniques for simulating these surfaces under strict zero-dependency, deterministic constraints: **Sum-of-Sines (Spectral) Displacement** (a cheap, stateless combination of sine wave octaves), **1D Trochoidal (Gerstner) Waves** (which displace vertices both vertically and horizontally to produce sharp, stylized crests and flat troughs), and **Stateful Spring-Mass Column Systems** (which couple vertical spring columns to enable dynamic wave propagation and realistic splash responses). For `aicraft-engine`, we recommend starting with a stateless **Sum-of-Sines Wave Generator** generalized along an arbitrary normal vector for maximum performance and simplicity, with a stateful **Spring-Mass Column Simulator** as a follow-up for games requiring interactive splash physics.

## Why this matters for aicraft-engine

- **Pillars Touched**: Extends **Pillar 1 (Primitives / Animation)** and lays the groundwork for **Pillar 4 (Fake-3D / liquid surfaces)**.
- **Consumer Games**: Consumer titles (such as a card-based village builder with shorelines, or a procedural RTS with ocean waves and river flows) need lively, responsive liquid surfaces.
- **Unlocks**:
  - **Zero-Asset Liquid Surfaces**: Replaces heavy flipbook spritesheets or complex shader setups with lightweight, procedural math that can be rendered using standard Canvas2D vector paths.
  - **Dynamic Aesthetics**: Allows liquid surfaces to churn, bubble, or ripple dynamically based on game state, seed parameters, or environmental factors.
  - **Generalized Directional Waves**: By projecting 1D wave displacement along a polyline's normal vector, a single wave primitive can render horizontal pools, vertical waterfalls, dripping slime, or diagonal energy barriers.

---

## Prior Art Survey

### Pattern 1: Sum-of-Sines (Spectral) Wave Displacement
- **Source**: Classic Fourier synthesis & p5.js generative wave tutorials.
- **What it does**: Computes a vertical displacement $y$ at a given horizontal coordinate $x$ and time $t$ by summing multiple sine wave "octaves" with different amplitudes, wavelengths, and phase speeds. Using fractional, non-integer ratios between frequencies (often based on prime numbers or the golden ratio) prevents the waves from repeating too quickly, producing an organic, non-mechanical "churning" look.
- **Algorithmic shape**:
  ```typescript
  export interface WaveOctave {
    amplitude: number;   // Peak height of this octave
    wavelength: number;  // Horizontal distance of one full cycle
    speed: number;       // Phase speed (direction and rate of travel)
  }

  export interface WaveLineConfig {
    octaves: WaveOctave[];
    baseY: number;       // Baseline height
  }

  /**
   * Pure, stateless wave evaluator.
   * Computes the vertical displacement at coordinate x and time t.
   */
  export function evaluateSumOfSines(
    x: number,
    t: number,
    config: WaveLineConfig
  ): number {
    let displacement = 0;
    for (let i = 0; i < config.octaves.length; i++) {
      const octave = config.octaves[i];
      // Wave number k = 2pi / wavelength
      const k = (Math.PI * 2) / octave.wavelength;
      // Phase speed term: speed * t
      const phase = k * x - octave.speed * t;
      displacement += octave.amplitude * Math.sin(phase);
    }
    return config.baseY + displacement;
  }
  ```
- **Determinism profile**: Pure mathematical operations. Fully deterministic.
- **Runtime cost**: Extremely cheap. Evaluating $M$ octaves per vertex takes $O(M)$ operations. For a typical screen width of 320px with a vertex every 8px (40 vertices) and 3 octaves, this is only 120 sine evaluations per frame ($<0.05\text{ms}$).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is completely stateless, zero-dependency, and pure, fitting perfectly into our Core layer.
- **What to steal**: **Multi-octave spectral synthesis**. Combining 3-4 octaves with slightly decorrelated frequencies is the cheapest way to simulate organic liquid motion.
- **What to avoid**: Avoid using integer multiples for octave frequencies (e.g., $1\text{Hz}, 2\text{Hz}, 4\text{Hz}$), as this creates highly repetitive harmonic patterns that look mechanical. Use irrational or prime-based ratios instead.

---

### Pattern 2: 1D Trochoidal (Gerstner) Waves
- **Source**: Oceanography (Gerstner, 1802) & demoscene water rendering.
- **What it does**: Gerstner waves are traditionally used in 2D/3D ocean rendering to simulate trochoidal wave shapes where water particles move in circular orbits. In 1D, this technique displaces vertices both vertically *and* horizontally. This shifts vertices toward the wave crests, sharpening the peaks and flattening the troughs. This is highly effective for stylized liquid (like bubbling lava, boiling acid, or sharp energy fields) where symmetric sine waves look too "soft" or "rubbery."
- **Algorithmic shape**:
  ```typescript
  export interface GerstnerOctave {
    amplitude: number;
    wavelength: number;
    speed: number;
    steepness: number; // Q parameter: controls horizontal pinching [0, 1]
  }

  export interface GerstnerConfig {
    octaves: GerstnerOctave[];
  }

  export interface Vec2 {
    x: number;
    y: number;
  }

  /**
   * Pure, stateless Gerstner wave evaluator.
   * Takes a rest coordinate x0 and time t, and returns the displaced 2D position.
   */
  export function evaluateGerstner1D(
    x0: number,
    t: number,
    config: GerstnerConfig
  ): Vec2 {
    let displacedX = x0;
    let displacedY = 0;

    for (let i = 0; i < config.octaves.length; i++) {
      const octave = config.octaves[i];
      const k = (Math.PI * 2) / octave.wavelength;
      const phase = k * x0 - octave.speed * t;

      // Q_max = 1 / (k * amplitude) to prevent self-intersection loops
      const maxQ = 1 / (k * octave.amplitude);
      const q = octave.steepness * maxQ;

      // Horizontal displacement shifts vertices toward the crests
      displacedX -= q * octave.amplitude * Math.sin(phase);
      // Vertical displacement is cosine-based
      displacedY += octave.amplitude * Math.cos(phase);
    }

    return { x: displacedX, y: displacedY };
  }
  ```
- **Determinism profile**: Pure mathematical operations. Fully deterministic.
- **Runtime cost**: Very low. Requires twice as many trigonometric calls as Sum-of-Sines (one `sin` and one `cos` per octave), but remains well within our budget ($O(M)$ per vertex).
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It provides a highly stylized, crested wave shape that perfectly suits retro/minimalist game aesthetics without requiring shaders.
- **What to steal**: **Horizontal vertex pinching**. Shifting vertices horizontally toward the wave peaks creates a beautiful, sharp "crested" liquid look that is impossible to achieve with vertical-only displacement.
- **What to avoid**: Avoid setting the steepness parameter $Q$ higher than $1 / (k \cdot A)$, as this causes the wave to loop back on itself, creating ugly self-intersecting polygon artifacts.

---

### Pattern 3: Spring-Mass Column Simulation (Dynamic Shallow Water)
- **Source**: Hugo Elias' shallow water approximation & *Limbo* / *Rain World* water physics.
- **What it does**: Models the liquid surface as a series of vertical spring columns spaced evenly across the horizontal span. Each column acts as a damped harmonic oscillator coupled to its immediate neighbors. When an entity falls into the liquid, a downward or upward velocity impulse is applied to the nearest column. Hooke's Law spring forces and neighbor-to-neighbor tension propagation naturally disperse this impulse outward as a wave packet, creating realistic splashes, ripples, and boundary reflections.
- **Algorithmic shape**:
  ```typescript
  export interface WaterColumn {
    y: number;       // Current height displacement
    velocity: number; // Vertical velocity
  }

  export interface SpringWaterConfig {
    kSpring: number;  // Spring constant (stiffness)
    damping: number;  // Velocity decay rate (e.g., 0.98)
    spread: number;   // Wave propagation rate to neighbors (e.g., 0.05)
  }

  /**
   * Pure state progression for the water column array.
   * Must be run at a fixed timestep (dt) for deterministic simulation.
   */
  export function advanceSpringWater(
    columns: readonly WaterColumn[],
    dt: number,
    config: SpringWaterConfig
  ): WaterColumn[] {
    const next: WaterColumn[] = columns.map(c => ({ ...c }));
    const len = next.length;

    // 1. Update spring forces (Hooke's Law)
    for (let i = 0; i < len; i++) {
      const c = next[i];
      // Force pulling back to rest position (y = 0)
      const force = -config.kSpring * c.y;
      c.velocity = (c.velocity + force * dt) * config.damping;
      c.y += c.velocity * dt;
    }

    // 2. Propagate waves to neighbors (coupling pass)
    // We perform multiple passes or use temporary arrays to prevent directional bias
    const leftDeltas = new Float32Array(len);
    const rightDeltas = new Float32Array(len);

    for (let i = 0; i < len; i++) {
      if (i > 0) {
        leftDeltas[i] = config.spread * (next[i].y - next[i - 1].y);
        next[i - 1].velocity += leftDeltas[i];
      }
      if (i < len - 1) {
        rightDeltas[i] = config.spread * (next[i].y - next[i + 1].y);
        next[i + 1].velocity += rightDeltas[i];
      }
    }

    // Apply propagation deltas to positions
    for (let i = 0; i < len; i++) {
      if (i > 0) next[i - 1].y += leftDeltas[i];
      if (i < len - 1) next[i + 1].y += rightDeltas[i];
    }

    return next;
  }

  /**
   * Inject a splash impulse into the simulation.
   */
  export function injectSplash(
    columns: WaterColumn[],
    columnIndex: number,
    impulse: number
  ): WaterColumn[] {
    const next = columns.map(c => ({ ...c }));
    if (columnIndex >= 0 && columnIndex < next.length) {
      next[columnIndex].velocity += impulse;
    }
    return next;
  }
  ```
- **Determinism profile**: Stateful simulation. Fully deterministic **only under a fixed timestep `dt`** (e.g., 60Hz physics ticks).
- **Runtime cost**: Extremely cheap. For 50 columns, the update loop is just a few hundred simple additions and multiplications ($O(N)$ where $N$ is the number of columns), taking $<0.01\text{ms}$.
- **Dependencies**: None.
- **Fit for our constraints**: Medium-to-Strong. It is highly interactive and enables beautiful splash mechanics, but requires the consumer to manage persistent state (the column array) across frames, which is more complex than stateless math.
- **What to steal**: **Harmonic spring coupling**. It is the simplest and most robust way to model physical fluid interaction in 2D games.
- **What to avoid**: Avoid variable `dt` in the physics update, as it will cause wave speeds and damping rates to drift, ruining cross-device replay determinism.

---

## Reference Implementations

- **Sokpop Collective Titles**:
  - *Uniseas* (Ocean waves rendered as layered, flat-filled polygons with contrasting outlines).
  - *Mistward* (Water boundaries and fog edges rendered as shifting, low-resolution waves).
  - *Mistward* and *Pyramida* demonstrate that minimalist liquid surfaces should avoid heavy gradients and instead rely on flat, high-contrast colors with 1px outlines to maintain readability.
- **Hugo Elias' Shallow Water Tutorial**: The classic game development reference for 2D water column spring simulations, detailing the coupling math and velocity propagation.
- **Retro JRPG Lava Tiles (JRPG / SNES Era)**:
  - Titles like *Chrono Trigger* and *Final Fantasy VI* faked lava movement using 2-4 frame flipbook animations or palette cycling (shifting color indexes in the palette table over time).
  - *Contrast with Procedural Waves*: While palette cycling is extremely cheap, it is locked to grid boundaries and cannot support physical interactions (like player splashes or object floating). Procedural wave-on-polyline is vastly superior for dynamic, responsive gameplay.
- **Demoscene Sine Plasma**:
  - The classic demoscene "plasma" effect combines multiple overlapping 1D and 2D sine waves to create organic, swirling patterns.
  - *Application*: We can use a slow, secondary sine wave to modulate the amplitude or frequency of our primary wave octaves over time, creating a "churning" or "bubbling" effect that is highly characteristic of thick fluids like lava or acid.

---

## Visual References

| Wave Type | Visual Profile | Core Aesthetic |
|---|---|---|
| **Sum-of-Sines** | Smooth, symmetric, rolling curves. | Soft water, calm pools, energy force fields. |
| **Gerstner (Trochoidal)** | Sharp, pinched crests; wide, flat troughs. | Bubbling lava, boiling acid, stormy seas, stylized retro waves. |
| **Spring-Mass Splash** | Localized wave packet propagating outward and damping. | Interactive water splashes, object impacts, ripple rings. |

---

## Open Questions

1. **Direction Generalization (Arbitrary Polylines)**:
   - *Problem*: While lava pools are horizontal, waterfalls, leaking pipes, or energy shields can be vertical, diagonal, or curved.
   - *Solution*: The wave generator should not assume horizontal coordinates. Instead, it should operate on a parameterized distance $s$ along a line segment from $A$ to $B$. The wave displacement $d(s, t)$ is then projected along the segment's perpendicular normal vector $\vec{n}$:
     $$P(s, t) = A + s \cdot \vec{u} + d(s, t) \cdot \vec{n}$$
     where $\vec{u}$ is the unit direction vector of the segment. This elegant generalization handles any orientation out-of-the-box.
2. **Stateful vs. Stateless API Scope**:
   - *Problem*: Stateful spring-mass columns are highly interactive but require the consumer to maintain and update state variables in their game loop. Stateless waves (Sum-of-Sines and Gerstner) are "fire-and-forget" but cannot easily support dynamic splash physics.
   - *Recommendation*: v1 of the library should focus on the stateless **Sum-of-Sines** and **Gerstner** generators (landing in `src/primitives/wave-line.ts`) to provide immediate, zero-setup rendering helpers. We should flag the stateful **Spring-Mass** column system as a v2 feature once the core rendering primitives are proven.
3. **Sample Density and Pixel Snapping**:
   - *Problem*: How do we ensure the wave looks good at low resolutions (Sokpop ~16-32px tiles) without wasting CPU cycles?
   - *Recommendation*: The library should recommend a default sample spacing of 8-16 pixels. To match the retro, pixel-art aesthetic of the library's family of games, the generated vertices should support optional integer-pixel snapping (`Math.floor`) before rendering, creating a beautiful, stepped, retro-digital wave profile.

---

## Top 3 Patterns Worth Prototyping

1. **Stateless Generalized Wave-Line Generator**
   - *Why*: Provides a zero-setup, high-performance, horizontal/vertical wave primitive.
   - *API Sketch*:
     ```typescript
     export interface WavePoint {
       x: number;
       y: number;
       normalX: number;
       normalY: number;
     }

     export function generateWaveLine(
       startX: number,
       startY: number,
       endX: number,
       endY: number,
       sampleSpacing: number,
       t: number,
       config: WaveLineConfig,
       snapToPixel?: boolean
     ): WavePoint[];
     ```

2. **Trochoidal (Gerstner) Wave-Line Generator**
   - *Why*: Delivers the highly requested "sharp crest, flat trough" look for lava and acid pools.
   - *API Sketch*:
     ```typescript
     export function generateGerstnerLine(
       startX: number,
       startY: number,
       endX: number,
       endY: number,
       sampleSpacing: number,
       t: number,
       config: GerstnerConfig,
       snapToPixel?: boolean
     ): WavePoint[];
     ```

3. **Stateful Spring-Mass Column Simulator**
   - *Why*: Enables interactive splash and ripple physics for games where entities fall into liquid.
   - *API Sketch*:
     ```typescript
     export function initSpringWater(columnCount: number, baseY: number): WaterColumn[];
     export function advanceSpringWater(
       columns: readonly WaterColumn[],
       dt: number,
       config: SpringWaterConfig
     ): WaterColumn[];
     export function injectSplash(
       columns: WaterColumn[],
       columnIndex: number,
       impulse: number
     ): WaterColumn[];
     ```

---

## Cross-References

- `docs/architecture.md` (Strict determinism and fixed-timestep rules)
- `docs/conventions.md` (Code style and pure progression ops discipline)
- `src/primitives/pixel.ts` (Core math helpers like `floor`, `clamp`, and `lerp`)
- `src/animation/oscillators.ts` (Trigonometric oscillators like `bob` and `pulse`)
