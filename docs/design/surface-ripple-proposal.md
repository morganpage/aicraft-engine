# API Proposal: Surface Ripple / Wave-on-Polyline

> Target pillar: 1 (Primitives). Module: `src/primitives/`.
> Builds on research: `docs/research/surface-ripple.md`.
> Status: DRAFT.

## Consumer Need

Spitekeep currently has no liquid-surface rendering. The motivating use case is a **lava pool** at the bottom of a level whose surface ripples. The technique must generalize to water, slime, acid, energy fields — any horizontal (or arbitrary-direction) liquid surface in a 2D side-scroller.

Without this module:
- No zero-asset liquid surfaces (requires hand-authored flipbook spritesheets or complex shader setups).
- No dynamic aesthetic variation (lava churning, water calm, acid bubbling are all the same "static rectangle" today).
- No directional generalization (waterfalls, dripping slime, diagonal energy barriers need per-surface custom math).

With this module shipped:
- A single `generateWaveLine(ctx, ...)` call replaces 30+ lines of inline sin math.
- Sum-of-Sines produces soft, rolling water; Gerstner produces sharp, crested lava/acid.
- Arbitrary-line support means horizontal pools, vertical waterfalls, and diagonal barriers all use the same API.
- Pixel-snapping option matches the retro-digital aesthetic of Spitekeep-family games.

---

## Open Question Resolution

### Q1: Stateful vs Stateless Scope for v1

**Position: Stateless only for v1.** Ship `waveDisplacement` (sum-of-sines) and `gerstnerDisplacement` (trochoidal) as pure evaluators, plus `generateWaveLine` as a high-level polyline generator. Defer the spring-mass column system to v2.

**Justification:**
- The spring-mass system requires persistent `WaterColumn[]` state and fixed-timestep management — a different consumer pattern than the pure generators. Bundling them conflates two distinct mental models.
- The stateless generators cover 90% of liquid-surface rendering needs (ambient rippling). Interactive splash physics is a second-order feature that can be layered on top once the rendering primitives are proven.
- The procedural-motion proposal shipped spring chains (`src/animation/spring.ts`) as a separate module from oscillators. The same separation applies here: pure generators first, stateful simulation later.
- v2 spring-mass columns can compose with the v1 polyline output: `advanceSpringWater(columns, dt, config)` produces a `WaterColumn[]`, and the consumer maps that to the same `WavePoint[]` polyline for rendering.

### Q2: Direction Generalization vs Axis-Aligned

**Position: Arbitrary-line support from day one.** The math generalizes cheaply (one `atan2` + `cos`/`sin` projection per vertex), and consumers need diagonal/vertical surfaces immediately (waterfalls in Spitekeep's level editor, diagonal acid channels).

**Justification:**
- The research note's formula — `P(s, t) = A + s·u + d(s,t)·n` — is trivial to implement. It adds ~2 multiply-adds per vertex over the horizontal-only case.
- A horizontal-only API would force consumers to reimplement the projection for non-horizontal surfaces, duplicating the math the library should own.
- The horizontal case is a degenerate normal of `(0, -1)`, so no special-casing is needed.

### Q3: Sample Density and Pixel Snapping

**Position: Consumer specifies `sampleSpacing` (pixel distance between sample points along the segment). Pixel snapping is an optional boolean parameter that defaults to `false`.**

**Justification:**
- `sampleSpacing` is resolution-independent: a 640px pool gets twice as many vertices as a 320px pool at the same spacing, preserving visual density across different resolutions. The consumer can compute `vertexCount = Math.ceil(segmentLength / spacing)` trivially if they need it.
- Pixel snapping is opt-in because not all consumers want it. The retro-digital look (stepped wave profile) is a specific aesthetic choice. Consumers who want smooth anti-aliased waves should not pay for `Math.floor` they don't need.
- The library should NOT snap internally by default — this follows the convention of `outlineRect` which floors coordinates at the call site but doesn't force consumers into pixel-grid rendering.

---

## Approach A: Minimal Displacement Functions

**Source pattern:** Research note §Pattern 1 (Sum-of-Sines) and §Pattern 2 (Gerstner) — the raw `evaluateSumOfSines(x, t, config)` and `evaluateGerstner1D(x0, t, config)` functions.

**Idea:** Ship only the pure displacement evaluators. The consumer builds their own polyline by calling the evaluator in a loop. Maximum flexibility, minimum API surface.

**Signature sketch:**

```ts
// In src/primitives/wave-line.ts

/** Single-octave parameters for sum-of-sines waves. */
export interface WaveOctave {
  /** Peak height of this octave in px. */
  readonly amplitude: number;
  /** Horizontal distance of one full cycle in px. */
  readonly wavelength: number;
  /** Phase speed: direction and rate of travel. Positive = rightward. */
  readonly speed: number;
}

/**
 * Single-octave parameters for Gerstner (trochoidal) waves.
 * Gerstner waves displace vertices both vertically and horizontally,
 * producing sharp crests and flat troughs.
 */
export interface GerstnerOctave {
  /** Peak height of this octave in px. */
  readonly amplitude: number;
  /** Horizontal distance of one full cycle in px. */
  readonly wavelength: number;
  /** Phase speed: direction and rate of travel. Positive = rightward. */
  readonly speed: number;
  /** Steepness [0, 1]: controls horizontal pinching toward crests. 0 = pure sine, 1 = maximum trochoidal sharpness. */
  readonly steepness: number;
}

/**
 * Configuration for low-level wave displacement evaluators.
 * Shared by `waveDisplacement` and `gerstnerDisplacement`.
 */
export interface WaveDisplacementConfig {
  /** Array of wave octaves with different frequencies and amplitudes. */
  readonly octaves: readonly WaveOctave[];
  /** Baseline Y offset (rest position). */
  readonly baseY: number;
}

/**
 * Evaluate a sum-of-sines wave at a single point.
 * Returns the absolute Y coordinate of the wave surface at horizontal
 * position `x` at time `t`. Crest-up = smaller Y (canvas convention).
 *
 * `baseY` in the config is the baseline the wave is computed around;
 * the returned Y is `baseY + displacement` (where positive displacement
 * = downward in canvas coords, so a positive-sin crest reads as upward).
 *
 * Pure: same (x, t, config) → same output, forever.
 *
 * @param x - horizontal coordinate
 * @param t - time value (tick or seconds)
 * @param config - wave parameters with baseY
 * @returns absolute Y coordinate of the wave surface
 */
export function waveDisplacement(x: number, t: number, config: WaveDisplacementConfig): number;

/**
 * Evaluate a Gerstner wave at a single rest-position coordinate.
 * Returns both the displaced position and the displacement vector,
 * which the consumer needs to build the polyline correctly.
 *
 * Gerstner waves displace vertices *toward* the crests horizontally,
 * producing the characteristic sharp-peak / flat-trough shape.
 *
 * The steepness parameter Q is clamped to `1 / (k * amplitude)` per
 * octave to prevent self-intersection loops.
 *
 * @param x0 - rest-position horizontal coordinate
 * @param t - time value (tick or seconds)
 * @param config - Gerstner wave parameters
 * @returns displaced position {x, y} and displacement {dx, dy}
 */
export function gerstnerDisplacement(
  x0: number,
  t: number,
  config: { readonly octaves: readonly GerstnerOctave[] },
): { x: number; y: number; dx: number; dy: number };
```

**Usage example:**

```ts
import { waveDisplacement, type WaveDisplacementConfig } from 'aicraft-engine/src/primitives/wave-line';

const lavaConfig: WaveDisplacementConfig = {
  octaves: [
    { amplitude: 3, wavelength: 40, speed: 0.8 },
    { amplitude: 1.5, wavelength: 22, speed: -1.2 },
    { amplitude: 0.8, wavelength: 13, speed: 2.0 },
  ],
  baseY: 200, // top of the lava pool
};

// Consumer builds their own polyline
function renderLavaSurface(
  ctx: CanvasRenderingContext2D,
  startX: number,
  endX: number,
  sampleCount: number,
  t: number,
) {
  ctx.beginPath();
  ctx.moveTo(startX, lavaConfig.baseY);
  for (let i = 0; i <= sampleCount; i++) {
    const x = startX + (endX - startX) * (i / sampleCount);
    const y = waveDisplacement(x, t, lavaConfig);
    ctx.lineTo(Math.floor(x), Math.floor(y));
  }
  ctx.lineTo(endX, lavaConfig.baseY + 40); // close below
  ctx.lineTo(startX, lavaConfig.baseY + 40);
  ctx.closePath();
  ctx.fillStyle = '#ff4400';
  ctx.fill();
  ctx.strokeStyle = '#1d1128';
  ctx.lineWidth = 1;
  ctx.stroke();
}
```

**Trade-offs:**
- **Ergonomics:** Low. Consumer must write the polyline loop, close the path, handle normals manually. Every consumer duplicates 15–20 lines of boilerplate.
- **Determinism:** Maximum. Pure functions of (x, t, config).
- **Runtime cost:** Lowest. One trig call per octave per vertex. No allocation overhead.
- **Consumer complexity:** High. Consumer must understand polyline construction, path closing, and pixel snapping if they want it.
- **Tree-shake-ability:** Excellent. Each function is independently importable.
- **Convention fit:** Matches `outlineRect` (low-level rendering helper) but not the "convenience first" pattern. The consumer does too much plumbing.
- **Aesthetic range:** High. Consumer can combine waveDisplacement + gerstnerDisplacement freely, mix octaves, apply their own transforms.

**What this makes easy:** Maximum flexibility. Consumer can evaluate the wave at arbitrary points (e.g., for hit-testing, foam placement, or non-polyline rendering).
**What this makes hard:** Every consumer duplicates the polyline construction loop. No built-in normals for foam/spume rendering. No pixel-snapping convenience.

---

## Approach B: Polyline Generator (RECOMMENDED)

**Source pattern:** Research note §Top 3 Pattern 1 (Stateless Generalized Wave-Line Generator) and §Top 3 Pattern 2 (Trochoidal Wave-Line Generator). The research explicitly proposes `generateWaveLine(startX, startY, endX, endY, sampleSpacing, t, config, snapToPixel?)`.

**Idea:** Ship a single high-level `generateWaveLine` function that takes a line segment, samples it at regular pixel intervals (`sampleSpacing`), applies wave displacement along the segment's normal, and returns a `WavePoint[]` with positions and outward-facing normals. Consumer calls one function, gets a ready-to-render polyline.

**Signature sketch:**

```ts
// In src/primitives/wave-line.ts

/** A single point on a generated wave polyline. */
export interface WavePoint {
  /** World-space X after wave displacement. */
  readonly x: number;
  /** World-space Y after wave displacement. */
  readonly y: number;
  /** Outward-facing unit normal X component. */
  readonly normalX: number;
  /** Outward-facing unit normal Y component. */
  readonly normalY: number;
}

/** Wave type selector — determines the displacement algorithm. */
export type WaveMode = 'sine' | 'gerstner';

/**
 * Unified wave-line configuration. All fields are optional with
 * sensible defaults for a calm water surface.
 */
export interface WaveLineConfig {
  /** Wave algorithm. Default: 'sine' */
  readonly mode?: WaveMode;
  /** Array of wave octaves. Default: single octave (amplitude 3, wavelength 40, speed 0.8) */
  readonly octaves?: readonly WaveOctave[];
  /**
   * Steepness [0, 1] for Gerstner mode. Ignored in sine mode.
   * Controls horizontal pinching toward crests. Default: 0.5
   *
   * Gerstner mode uses a single global steepness applied to all octaves.
   * For per-octave steepness control, use `gerstnerDisplacement` directly.
   */
  readonly steepness?: number;
  /**
   * Pixel snapping. When true, all output coordinates are Math.floor'd
   * to the integer pixel grid, producing a retro-digital stepped profile.
   * Default: false
   */
  readonly snapToPixel?: boolean;
}

/**
 * Generate a displaced wave polyline along an arbitrary line segment.
 *
 * The wave displacement is projected along the segment's perpendicular
 * normal vector. For a horizontal segment (left→right), the normal
 * points upward and displacement is vertical. For a vertical segment
 * (top→bottom), displacement is horizontal. Diagonal segments get
 * diagonal displacement.
 *
 * **Outward convention (implicit):** The outward-facing normal is
 * computed as 90° counter-clockwise of the start→end tangent in
 * canvas coordinates. For a horizontal left→right segment, outward
 * points up (correct for pool surfaces). **Footgun:** For a vertical
 * top→bottom waterfall, outward points *right* — if the liquid should
 * be to the left, swap `start`↔`end` so the tangent points downward,
 * making outward point left.
 *
 * **Gerstner + snapToPixel:** At `steepness ≥ 0.5` with small
 * `sampleSpacing`, Gerstner horizontal pinch can shift adjacent
 * samples' x-coords enough that `Math.floor` collapses nearby points
 * onto the same pixel column, producing degenerate near-vertical
 * segments. The retro-digital aesthetic (`snapToPixel: true`) pairs
 * best with sine mode. Gerstner mode is best used with
 * `snapToPixel: false` for smooth sub-pixel rendering. This is a
 * recommendation, not a hard restriction — the consumer can choose.
 *
 * Gerstner mode uses a single global `steepness` applied to all octaves.
 * For per-octave steepness control, use `gerstnerDisplacement` directly.
 *
 * Pure: same (startX, startY, endX, endY, sampleSpacing, t, config)
 *       → same WavePoint[] output, forever.
 *
 * @param startX - segment start X
 * @param startY - segment start Y
 * @param endX - segment end X
 * @param endY - segment end Y
 * @param sampleSpacing - pixel distance between sample points (min 1)
 * @param t - time value (tick or seconds)
 * @param config - wave parameters (all optional, defaulted)
 * @returns WavePoint[] array of displaced positions with outward normals
 */
export function generateWaveLine(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  sampleSpacing: number,
  t: number,
  config?: WaveLineConfig,
): readonly WavePoint[];
```

**Usage example:**

```ts
import { generateWaveLine, type WaveLineConfig } from 'aicraft-engine/src/primitives/wave-line';

// Lava pool: horizontal segment across pool width, sharp Gerstner crests
const lavaConfig: WaveLineConfig = {
  mode: 'gerstner',
  octaves: [
    { amplitude: 4, wavelength: 40, speed: 0.8 },
    { amplitude: 2, wavelength: 22, speed: -1.2 },
    { amplitude: 1, wavelength: 13, speed: 2.0 },
  ],
  steepness: 0.7,
  snapToPixel: true, // retro-digital stepped look
};

function renderLavaPool(
  ctx: CanvasRenderingContext2D,
  poolLeft: number,
  poolRight: number,
  poolTop: number,
  poolDepth: number,
  t: number,
) {
  const points = generateWaveLine(
    poolLeft, poolTop,
    poolRight, poolTop,
    8, // sampleSpacing: 8px between vertices
    t,
    lavaConfig,
  );

  // Fill below the wave
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  // Close below: straight line across the pool bottom
  ctx.lineTo(poolRight, poolTop + poolDepth);
  ctx.lineTo(poolLeft, poolTop + poolDepth);
  ctx.closePath();
  ctx.fillStyle = '#ff4400';
  ctx.fill();

  // Outline on the wave surface
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.strokeStyle = '#1d1128';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// Water surface: soft sine waves, no snapping
const waterConfig: WaveLineConfig = {
  mode: 'sine',
  octaves: [
    { amplitude: 2, wavelength: 60, speed: 0.4 },
    { amplitude: 1, wavelength: 30, speed: -0.6 },
  ],
  snapToPixel: false,
};

// Vertical waterfall: same API, different segment direction
function renderWaterfall(
  ctx: CanvasRenderingContext2D,
  x: number,
  topY: number,
  bottomY: number,
  t: number,
) {
  const points = generateWaveLine(
    x, topY,
    x, bottomY,
    10, // sampleSpacing: 10px between vertices
    t,
    { mode: 'sine', octaves: [{ amplitude: 2, wavelength: 30, speed: 1.5 }] },
  );
  // Render as a vertical polyline...
}
```

**Trade-offs:**
- **Ergonomics:** High. Single call produces a ready-to-render polyline. Consumer only does `ctx.beginPath(); for (p of points) ctx.lineTo(p.x, p.y); ctx.fill();`.
- **Determinism:** Maximum. Pure function of (segment, sampleSpacing, t, config).
- **Runtime cost:** Low. O(segmentLength/sampleSpacing × octaves) trig calls + one `atan2` + two `sin`/`cos` for the normal. For a 320px pool at 8px spacing (40 vertices) × 3 octaves: ~120 trig calls + 40 normal projections (~0.05ms).
- **Consumer complexity:** Low. Consumer calls one function, iterates the result. No wave math, no normal calculation, no pixel-snapping boilerplate.
- **Tree-shake-ability:** Excellent. Single function, single config type.
- **Convention fit:** Matches `outlineRect` — a high-level rendering helper that "just works." The config-object pattern (all optional, sensible defaults) matches `DEFAULT_OUTLINE_COLOR` and the palette constants.
- **Aesthetic range:** High. Sine mode for calm water, Gerstner mode for sharp lava/acid, snapToPixel for retro-digital, normals for foam.

**What this makes easy:** One-call liquid surfaces for any orientation. Foam/spume via normals. Retro-digital aesthetic via snapToPixel. Direction-agnostic rendering (horizontal pools, vertical waterfalls, diagonal barriers).
**What this makes hard:** Consumer can't evaluate the wave at an arbitrary single point (e.g., for hit-testing "is this point on the lava surface?"). The sampleSpacing is a fixed resolution — consumer can't query at a specific x coordinate without generating the full polyline first.

---

## Approach C: Hybrid — Low-Level + High-Level

**Source pattern:** Combination of research §Pattern 1/2 (displacement evaluators) and §Top 3 Pattern 1 (polyline generator). The library ships both the raw evaluators AND the polyline generator.

**Idea:** Provide both the minimal displacement functions (Approach A) AND the polyline generator (Approach B). Consumer picks the level of abstraction they need. Maximum flexibility with maximum convenience.

**Signature sketch:**

```ts
// In src/primitives/wave-line.ts

// --- Types (same as Approach B) ---
export type WaveMode = 'sine' | 'gerstner';
export interface WaveOctave { ... }        // same as Approach B
export interface GerstnerOctave { ... }    // same as Approach B
export interface WaveLineConfig { ... }    // same as Approach B
export interface WaveDisplacementConfig { ... } // shared by low-level evaluators
export interface WavePoint { ... }         // same as Approach B (flat: x, y, normalX, normalY)

// --- Low-level evaluators (Approach A) ---

/**
 * Evaluate sum-of-sines displacement at a single point.
 * Returns the absolute Y coordinate of the wave surface at horizontal
 * position `x` at time `t`. Crest-up = smaller Y (canvas convention).
 *
 * `baseY` in the config is the baseline the wave is computed around;
 * the returned Y is `baseY + displacement` (where positive displacement
 * = downward in canvas coords, so a positive-sin crest reads as upward).
 *
 * Pure: same (x, t, config) → same output, forever.
 *
 * @param x - horizontal coordinate
 * @param t - time value
 * @param config - wave parameters with baseY
 * @returns absolute Y coordinate of the wave surface
 */
export function waveDisplacement(
  x: number,
  t: number,
  config: WaveDisplacementConfig,
): number;

/**
 * Evaluate Gerstner displacement at a single rest-position coordinate.
 * Returns displaced position and displacement vector.
 *
 * @param x0 - rest-position horizontal coordinate
 * @param t - time value
 * @param config - Gerstner parameters
 * @returns {x, y, dx, dy} displaced position and displacement
 */
export function gerstnerDisplacement(
  x0: number,
  t: number,
  config: { readonly octaves: readonly GerstnerOctave[] },
): { x: number; y: number; dx: number; dy: number };

// --- High-level polyline generator (Approach B) ---

/**
 * Generate a displaced wave polyline along an arbitrary line segment.
 * Pure: same inputs → same WavePoint[] output, forever.
 *
 * **Outward convention (implicit):** The outward-facing normal is
 * computed as 90° counter-clockwise of the start→end tangent in
 * canvas coordinates. For a horizontal left→right segment, outward
 * points up (correct for pool surfaces). **Footgun:** For a vertical
 * top→bottom waterfall, outward points *right* — if the liquid should
 * be to the left, swap `start`↔`end` so the tangent points downward,
 * making outward point left.
 *
 * **Gerstner + snapToPixel:** At `steepness ≥ 0.5` with small
 * `sampleSpacing`, Gerstner horizontal pinch can shift adjacent
 * samples' x-coords enough that `Math.floor` collapses nearby points
 * onto the same pixel column, producing degenerate near-vertical
 * segments. The retro-digital aesthetic (`snapToPixel: true`) pairs
 * best with sine mode. Gerstner mode is best used with
 * `snapToPixel: false` for smooth sub-pixel rendering.
 *
 * Gerstner mode uses a single global `steepness` applied to all octaves.
 * For per-octave steepness control, use `gerstnerDisplacement` directly.
 *
 * @param startX - segment start X
 * @param startY - segment start Y
 * @param endX - segment end X
 * @param endY - segment end Y
 * @param sampleSpacing - pixel distance between sample points (min 1)
 * @param t - time value
 * @param config - wave parameters (all optional, defaulted)
 * @returns WavePoint[] with displaced positions and outward normals
 */
export function generateWaveLine(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  sampleSpacing: number,
  t: number,
  config?: WaveLineConfig,
): readonly WavePoint[];
```

**Usage example:**

```ts
import {
  generateWaveLine,
  waveDisplacement,
  type WaveLineConfig,
} from 'aicraft-engine/src/primitives/wave-line';

// High-level: one-call polyline (same as Approach B)
const points = generateWaveLine(10, 200, 310, 200, 8, t, {
  mode: 'gerstner',
  steepness: 0.7,
  snapToPixel: true,
});
// ... render polyline

// Low-level: single-point evaluation for hit-testing
const lavaY = waveDisplacement(mouseX, t, {
  octaves: [{ amplitude: 3, wavelength: 40, speed: 0.8 }],
  baseY: 200,
});
const isOnLava = mouseY > lavaY;
```

**Trade-offs:**
- **Ergonomics:** High for common cases (polyline generator), high for edge cases (displacement evaluators). Consumer picks the abstraction level.
- **Determinism:** Maximum. Both evaluators and generator are pure.
- **Runtime cost:** Same as A+B. The low-level evaluators add no overhead when not used (tree-shaken).
- **Consumer complexity:** Low. High-level for common cases, low-level for custom rendering.
- **Tree-shake-ability:** Good. Consumer imports only what they need. But the type definitions are shared, so there's some coupling.
- **Convention fit:** Good. Matches the library's pattern of small composable functions. The high-level generator is a convenience wrapper over the low-level evaluators.
- **Aesthetic range:** Maximum. Consumer can compose evaluators freely OR use the generator for quick prototyping.

**What this makes easy:** Everything from Approach A and B. Hit-testing, foam placement, custom rendering pipelines via low-level evaluators. Quick prototyping via the generator.
**What this makes hard:** API surface is larger (11 exports vs 5). Consumer must decide which abstraction level to use. The naming must clearly distinguish `waveDisplacement` (low-level) from `generateWaveLine` (high-level).

---

## Comparison Table

| Criterion | A: Minimal Eval | B: Polyline Gen | C: Hybrid |
|---|---|---|---|
| Ergonomics | Low (15–20 lines boilerplate) | High (1 call + loop) | High (both levels) |
| Determinism | Maximum | Maximum | Maximum |
| Runtime cost | Lowest (no allocation) | Low (segmentLen/spacing × octaves trig) | Same as A+B |
| Consumer complexity | High (must build polyline) | Low (iterator pattern) | Low (pick level) |
| Tree-shake | Excellent | Excellent | Good (shared types) |
| Convention fit | Matches pixel.ts | Matches outlineRect | Matches both |
| Aesthetic range | High (manual control) | High (sine/gerstner/snap) | Maximum |
| Hit-testing support | Built-in (eval at any x) | Requires full polyline | Built-in |
| Normals for foam | Consumer computes | Built-in | Built-in |
| API surface size | 5 exports | 5 exports | 11 exports |

---

## Recommendation

**Approach C: Hybrid — Low-Level + High-Level.** Here's why:

1. **The lava-pool use case demands the polyline generator** (Approach B). No consumer wants to write the polyline loop 15 times across 15 liquid surfaces. The generator is the 90% case.

2. **Hit-testing demands the low-level evaluator** (Approach A). "Is this enemy standing in the lava?" requires evaluating the wave at a single x coordinate without generating 40 vertices. The research note doesn't mention this, but Spitekeep's trap system needs it — `hidden-pit.ts` checks player-vs-hazard bounds, and a lava pool with a wavy surface needs the same.

3. **The naming is clear.** `waveDisplacement` (low-level, returns a number) vs `generateWaveLine` (high-level, returns `WavePoint[]`). No ambiguity.

4. **Tree-shaking works.** Consumer who only needs the polyline generator doesn't pull in the evaluator, and vice versa. The shared types are type-only imports (zero runtime cost).

5. **Convention fit.** The library already ships small composable functions (`clamp`, `floor`, `lerp`, `approach` in `pixel.ts`) alongside higher-level helpers (`outlineRect` in `outline-rect.ts`). The hybrid approach mirrors this layered pattern.

6. **Extensibility.** When v2 adds the spring-mass column system, it can compose with `waveDisplacement` to produce splash-affected displacement values, then pass those through `generateWaveLine` for rendering. The low-level evaluator is the composable primitive.

**If the orchestrator prefers a smaller API surface for v1**, Approach B (polyline generator only) is the second-best choice. The low-level evaluators can be added non-breakingly in v1.1 if consumers request them.

---

## Resolved Design Decisions

The following questions were resolved by the orchestrator and architect. These are decisions, not suggestions.

### Q1: Type file location — INLINE in `wave-line.ts`

The existing `src/primitives/` pattern is single-file modules (`outline-rect.ts`, `pixel.ts`, `color.ts`, `motion.ts` all have types inline). A separate `types.ts` is for multi-file modules with cross-file type sharing (like `src/palette/`). The wave-line module is one file. All types (`WaveOctave`, `GerstnerOctave`, `WaveLineConfig`, `WaveDisplacementConfig`, `WavePoint`, `WaveMode`) are defined inline in `wave-line.ts`.

### Q2: `vertexCount` vs `sampleSpacing` — USE `sampleSpacing`

`sampleSpacing` is resolution-independent: a 640px pool gets twice as many vertices as a 320px pool at the same spacing, preserving visual density across different resolutions. The consumer can compute `vertexCount = Math.ceil(segmentLength / spacing)` trivially if they need it.

### Q3: Gerstner steepness per-octave vs global — GLOBAL for v1

The high-level `generateWaveLine` uses a single global `steepness` field. Consumers who need per-octave steepness control use `gerstnerDisplacement` directly (see JSDoc note on `generateWaveLine`). If per-octave control is needed in the high-level generator later, `WaveLineConfig.octaves` can be widened to `readonly (WaveOctave | GerstnerOctave)[]` — a non-breaking change.

### Q4: Default config constants — EXPORT `DEFAULT_WAVE_LINE` and `DEFAULT_GERSTNER`

See Implementation Notes below.

### Q5: Low-level naming — `waveDisplacement` and `gerstnerDisplacement`

`waveDisplacement` (returns a number) over `waveLine` (ambiguous with `generateWaveLine`). Same for `gerstnerDisplacement` over `gerstnerLine`. These names are confirmed and used throughout.

---

## Implementation Notes for @coder

### Exported default config objects

Export `DEFAULT_WAVE_LINE` and `DEFAULT_GERSTNER` as named config objects with sensible default octave arrays. Consumers can spread into them: `{ ...DEFAULT_WAVE_LINE, snapToPixel: true }`. This matches the existing library pattern (`DEFAULT_GAIT`, `DEFAULT_BREATH`, `DEFAULT_SPRING`, `DEFAULT_JUMP`, `DEFAULT_OUTLINE_COLOR`) and satisfies `docs/conventions.md` line 24 ("Every tunable value lives in a config object the consumer can spread into their own").

```ts
// PROVISIONAL — pending @benchmarker render validation at Sokpop tile scale (~16-32px tiles)
export const DEFAULT_WAVE_LINE: Required<WaveLineConfig> = {
  mode: 'sine',
  octaves: [
    { amplitude: 3, wavelength: 40, speed: 0.8 },
  ],
  steepness: 0.5,
  snapToPixel: false,
};

// PROVISIONAL — pending @benchmarker render validation at Sokpop tile scale (~16-32px tiles)
export const DEFAULT_GERSTNER: Required<WaveLineConfig> = {
  mode: 'gerstner',
  octaves: [
    { amplitude: 3, wavelength: 40, speed: 0.8 },
  ],
  steepness: 0.5,
  snapToPixel: false,
};
```

**Default octave arrays and steepness values are PROVISIONAL.** They must be ratified visually by `@benchmarker` rendering test outputs at Sokpop tile scale (~16-32px tiles) before the decision doc is written. The prototype may use these values; the shipped defaults must confirm they look good.

### Low-level evaluator config

The low-level `waveDisplacement` and `gerstnerDisplacement` evaluators accept a `WaveDisplacementConfig` type (exported) with required `octaves` and `baseY` fields. This is intentionally separate from `WaveLineConfig` (which has optional fields and no `baseY`) — the evaluators need explicit values, while the generator provides defaults.

### Gerstner steepness clamping

The `gerstnerDisplacement` evaluator must clamp per-octave steepness to `1 / (k * amplitude)` where `k = 2π / wavelength` to prevent self-intersection loops. This is the standard Gerstner safety bound from the research note.

### Pixel snapping

When `snapToPixel: true`, apply `Math.floor` to both x and y coordinates of each `WavePoint`. This is opt-in only — the default is `false`.
