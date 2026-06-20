/**
 * Surface ripple / wave-on-polyline.
 *
 * Three pure evaluators for liquid-surface rendering:
 *   - `waveDisplacement`   — sum-of-sines, returns absolute Y at (x, t).
 *   - `gerstnerDisplacement` — 1D Gerstner, returns `{x, y, dx, dy}`.
 *   - `generateWaveLine`   — high-level polyline generator → `WavePoint[]`.
 *
 * Determinism: all evaluators are pure functions. No `Math.random`, no
 * `Date.now`, no DOM reads. Same inputs → same output, forever. This is
 * the whole point of the module — a lava pool rendered at tick `t` looks
 * identical on every device and every replay.
 *
 * Sign convention (kept consistent across all evaluators): a positive sin
 * peak produces a Y value LESS than `baseY`. In canvas coordinates (Y
 * growing downward) this means a crest points UPWARD. This matches the
 * outward-normal convention of `generateWaveLine`: for a horizontal
 * left→right segment, the outward normal is `(0, -1)` — up.
 */

// =============================================================================
// Types
// =============================================================================

/** Single-octave parameters for a sum-of-sines wave. */
export interface WaveOctave {
  /** Peak height of this octave in px. */
  readonly amplitude: number;
  /** Horizontal distance of one full cycle in px. Must be > 0. */
  readonly wavelength: number;
  /** Phase speed (px/tick). Positive = rightward travel. */
  readonly speed: number;
  /** Optional phase offset in radians. Default 0. */
  readonly phase?: number;
}

/**
 * Single-octave parameters for a Gerstner (trochoidal) wave.
 *
 * Gerstner waves pinch vertices horizontally toward crests, producing
 * sharp peaks and flat troughs — the classic lava/acid look that
 * sum-of-sines cannot replicate.
 */
export interface GerstnerOctave {
  /** Peak height of this octave in px. */
  readonly amplitude: number;
  /** Horizontal distance of one full cycle in px. Must be > 0. */
  readonly wavelength: number;
  /** Phase speed (px/tick). Positive = rightward travel. */
  readonly speed: number;
  /**
   * Steepness ∈ [0, 1]. 0 = pure sine (no horizontal pinch); 1 = maximum
   * trochoidal sharpness before self-intersection. Internally clamped to
   * [0, 1] then converted to `Q = steepness / (k · amplitude)` (bounded
   * by `1 / (k · amplitude)`) to prevent loop self-intersection.
   */
  readonly steepness: number;
  /** Optional phase offset in radians. Default 0. */
  readonly phase?: number;
}

/** Configuration for `waveDisplacement`. */
export interface WaveDisplacementConfig {
  /** Wave octaves (summed). Empty array → flat line at `baseY`. */
  readonly octaves: readonly WaveOctave[];
  /** Baseline Y (rest position). The returned Y is anchored to this. */
  readonly baseY: number;
}

/**
 * Configuration for `gerstnerDisplacement`.
 *
 * Mirrors `WaveDisplacementConfig`: both evaluators return absolute world
 * coordinates anchored to `baseY`, so both configs require it.
 */
export interface GerstnerDisplacementConfig {
  /** Gerstner octaves (summed). Each carries its own `steepness`. */
  readonly octaves: readonly GerstnerOctave[];
  /** Baseline Y (rest position). The returned `y` is anchored to this. */
  readonly baseY: number;
}

/** Wave algorithm selector for the high-level generator. */
export type WaveMode = 'sine' | 'gerstner';

/**
 * Unified wave-line configuration for `generateWaveLine`. All fields
 * optional with ratified defaults (`DEFAULT_WAVE_LINE` / `DEFAULT_GERSTNER`).
 */
export interface WaveLineConfig {
  /** Wave algorithm. Default `'sine'`. */
  readonly mode?: WaveMode;
  /**
   * Wave octaves. For Gerstner mode each octave uses the global
   * `steepness` field (per-octave steepness control is only available
   * via the low-level `gerstnerDisplacement` evaluator). Default:
   * 2-octave ratified set.
   */
  readonly octaves?: readonly WaveOctave[];
  /**
   * Global steepness ∈ [0, 1] for Gerstner mode. Ignored in sine mode.
   * Default 0.5. For per-octave steepness control, call
   * `gerstnerDisplacement` directly.
   */
  readonly steepness?: number;
  /**
   * When true, output coordinates are `Math.floor`'d to the integer pixel
   * grid for a retro-digital stepped look. Default per `DEFAULT_*`.
   */
  readonly snapToPixel?: boolean;
}

/** A single point on a generated wave polyline. Flat shape (no nesting). */
export interface WavePoint {
  /** World-space X after displacement. */
  readonly x: number;
  /** World-space Y after displacement. */
  readonly y: number;
  /** Outward-facing unit-normal X component. */
  readonly normalX: number;
  /** Outward-facing unit-normal Y component. */
  readonly normalY: number;
}

// =============================================================================
// Internal scalar evaluators
// =============================================================================

/**
 * Pure sum-of-sines scalar evaluator. Returns
 * `Σ amplitude · sin(k·(x − speed·t) + phase)`. Positive = outward (upward
 * for a horizontal top-of-pool surface). Degenerate octaves
 * (wavelength ≤ 0) are skipped defensively.
 */
function sumOfSinesScalar(
  x: number,
  t: number,
  octaves: readonly WaveOctave[],
): number {
  let sum = 0;
  for (let i = 0; i < octaves.length; i++) {
    const o = octaves[i];
    if (o.wavelength <= 0) continue;
    const k = (Math.PI * 2) / o.wavelength;
    const phase = o.phase ?? 0;
    sum += o.amplitude * Math.sin(k * (x - o.speed * t) + phase);
  }
  return sum;
}

/** Return shape of `gerstnerScalar`: displacement components and their d/dx. */
interface GerstnerScalarResult {
  /** Horizontal pinch displacement (added to x0). */
  readonly along: number;
  /** Vertical crest displacement (subtracted from baseY). */
  readonly across: number;
  /** d(along)/dx — partial of horizontal pinch w.r.t. rest position. */
  readonly dAlongDx: number;
  /** d(across)/dx — partial of vertical displacement w.r.t. rest position. */
  readonly dAcrossDx: number;
}

/**
 * Pure Gerstner scalar evaluator.
 *
 *   - `along`  = horizontal pinch displacement along the wave-travel
 *                  direction. Sign follows `cos(arg)`: positive = +X.
 *   - `across` = vertical crest displacement perpendicular to travel.
 *                  Positive = outward (upward for a horizontal surface).
 *
 * The `d*` fields are the partial derivatives w.r.t. the rest-position
 * coordinate `x`, used by `gerstnerDisplacement` to return the curve
 * tangent. Per-octave `steepness` is clamped to [0, 1], then converted to
 * `Q = steepness / (k · amplitude)`, which is bounded by the safety limit
 * `1 / (k · amplitude)` and thus prevents loop self-intersection.
 *
 * Octaves with `wavelength ≤ 0` or `amplitude ≤ 0` are skipped
 * defensively (the latter avoids NaN in `Q = steep / (k · amplitude)`).
 */
function gerstnerScalar(
  x: number,
  t: number,
  octaves: readonly GerstnerOctave[],
): GerstnerScalarResult {
  let along = 0;
  let across = 0;
  let dAlongDx = 0;
  let dAcrossDx = 0;
  for (let i = 0; i < octaves.length; i++) {
    const o = octaves[i];
    if (o.wavelength <= 0) continue;
    if (o.amplitude <= 0) continue;
    const k = (Math.PI * 2) / o.wavelength;
    const phase = o.phase ?? 0;
    const arg = k * (x - o.speed * t) + phase;
    const steepClamped = o.steepness < 0 ? 0 : o.steepness > 1 ? 1 : o.steepness;
    const Q = steepClamped / (k * o.amplitude);
    const cosA = Math.cos(arg);
    const sinA = Math.sin(arg);
    along += Q * o.amplitude * cosA;
    across += o.amplitude * sinA;
    dAlongDx += -steepClamped * sinA;
    dAcrossDx += o.amplitude * k * cosA;
  }
  return { along, across, dAlongDx, dAcrossDx };
}

// =============================================================================
// Public low-level evaluators
// =============================================================================

/**
 * Evaluate a sum-of-sines wave at a single horizontal point.
 *
 * Returns the **absolute Y** of the wave surface at `(x, t)` — the full
 * y-coordinate, not a delta. **Crest-up = negative Y direction** (canvas
 * convention: up is negative): a positive sin peak returns Y < `baseY`.
 * This matches the outward-normal convention of `generateWaveLine`.
 *
 * Pure: same `(x, t, config)` → same output, forever. No `Math.random`,
 * no `Date.now`, no DOM reads.
 *
 * Usage:
 * ```ts
 * const y = waveDisplacement(mouseX, t, {
 *   baseY: 200,
 *   octaves: [{ amplitude: 3, wavelength: 40, speed: 0.8 }],
 * });
 * const isUnderSurface = mouseY > y;
 * ```
 *
 * @param x - horizontal coordinate
 * @param t - time value (tick or seconds; consumer picks the unit)
 * @param config - wave parameters with `baseY`
 * @returns absolute displaced Y at `(x, t)`
 */
export function waveDisplacement(
  x: number,
  t: number,
  config: WaveDisplacementConfig,
): number {
  return config.baseY - sumOfSinesScalar(x, t, config.octaves);
}

/**
 * Evaluate a 1D Gerstner wave at a single rest-position x.
 *
 * Returns `{ x, y, dx, dy }`:
 *   - `x`, `y` — absolute displaced world position (anchored to `baseY`).
 *   - `dx`, `dy` — the curve tangent `d(x, y) / d(x0)` at fixed `t`. Use
 *     these to compute per-vertex normals analytically (rotate 90°) rather
 *     than via finite differences.
 *
 * Gerstner pinches vertices horizontally toward crests (the returned `x`
 * differs from `x0`) and displaces them vertically (returned `y` differs
 * from `baseY`). The horizontal pinch is what produces the sharp,
 * trochoidal crest shape — it cannot be replicated with sum-of-sines.
 *
 * **Per-octave steepness** is respected: each `GerstnerOctave` carries
 * its own `steepness` field (clamped to [0, 1] internally, then converted
 * to `Q = steepness / (k · amplitude)` which is bounded by the safety
 * limit `1 / (k · amplitude)` and prevents loop self-intersection).
 * There is **no global `steepness` on this evaluator** — for a global
 * knob, use `generateWaveLine` in `'gerstner'` mode.
 *
 * Pure: same `(x0, t, config)` → same output, forever.
 *
 * @param x0 - rest-position horizontal coordinate
 * @param t - time value
 * @param config - Gerstner parameters with `baseY`
 * @returns displaced position `{x, y}` and tangent `{dx, dy}`
 */
export function gerstnerDisplacement(
  x0: number,
  t: number,
  config: GerstnerDisplacementConfig,
): { x: number; y: number; dx: number; dy: number } {
  const g = gerstnerScalar(x0, t, config.octaves);
  return {
    x: x0 + g.along,
    y: config.baseY - g.across,
    dx: 1 + g.dAlongDx,
    dy: -g.dAcrossDx,
  };
}

// =============================================================================
// High-level polyline generator
// =============================================================================

/** Outward normal for degenerate (zero-length) segments: points up. */
const DEFAULT_DEGENERATE_NORMAL_X = 0;
const DEFAULT_DEGENERATE_NORMAL_Y = -1;

/**
 * Generate a displaced wave polyline along an arbitrary line segment.
 *
 * The wave displacement is projected along the segment's outward normal,
 * defined as the **90° CCW rotation of the start→end tangent** in canvas
 * coordinates (Y growing downward):
 *   - Horizontal left→right segment → outward normal `(0, −1)`, points UP.
 *   - Vertical top→bottom segment   → outward normal `(+1, 0)`, points RIGHT.
 *
 * For sine mode, displacement is purely along the normal. For Gerstner
 * mode, the vertical "across" component is applied along the normal AND
 * the horizontal "along" (pinch) component is applied along the tangent —
 * so Gerstner crests pinch in the direction of wave travel regardless of
 * segment orientation.
 *
 * **Three things worth knowing (all ratified by benchmark
 * `benchmarks/surface-ripple/sine-vs-gerstner.png`):**
 *
 * 1. **Gerstner mode uses the global `steepness` field applied to ALL
 *    octaves.** For per-octave steepness control, call
 *    `gerstnerDisplacement` directly and project the result yourself.
 *
 * 2. **Outward normal = 90° CCW of start→end tangent.** For a horizontal
 *    left→right pool, outward points up (correct). For a vertical
 *    waterfall where the liquid should be to the LEFT of the segment,
 *    swap `start`↔`end` — the tangent reverses, so outward flips to left.
 *
 * 3. **Gerstner + `snapToPixel: true` produces degenerate crests.** The
 *    horizontal pinch collapses adjacent sample x-coords onto the same
 *    pixel column after `Math.floor`, producing near-vertical segments.
 *    Use sine + snap for the retro-digital aesthetic; use Gerstner +
 *    smooth (`snapToPixel: false`) for viscous lava/acid.
 *
 * Outward normals at each sample are computed from the local curve
 * tangent (finite-difference of neighbours), so they tilt with the wave
 * curvature — useful for foam/spume that should fly off crests at angles.
 * At the segment endpoints, one-sided differences are used. If two
 * snapped samples collapse onto the same pixel (Gerstner + snap near a
 * crest), the tangent length drops to zero and the normal falls back to
 * the segment's outward normal so the field is never degenerate.
 *
 * Pure: same `(startX, startY, endX, endY, sampleSpacing, t, config)` →
 * same `WavePoint[]` output, forever.
 *
 * Usage:
 * ```ts
 * const points = generateWaveLine(0, 200, 256, 200, 4, t, {
 *   mode: 'gerstner',
 *   steepness: 0.7,
 *   snapToPixel: false,
 * });
 * ctx.beginPath();
 * ctx.moveTo(points[0].x, points[0].y);
 * for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
 * ctx.stroke();
 * ```
 *
 * @param startX - segment start X
 * @param startY - segment start Y
 * @param endX - segment end X
 * @param endY - segment end Y
 * @param sampleSpacing - pixel distance between samples (clamped to ≥ 1)
 * @param t - time value
 * @param config - wave parameters (all optional, defaulted)
 * @returns `WavePoint[]` with displaced positions and outward normals
 */
export function generateWaveLine(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  sampleSpacing: number,
  t: number,
  config?: WaveLineConfig,
): readonly WavePoint[] {
  const mode: WaveMode = config?.mode ?? DEFAULT_WAVE_LINE.mode;
  const steepness = config?.steepness ?? DEFAULT_WAVE_LINE.steepness;
  const snap = config?.snapToPixel ?? DEFAULT_WAVE_LINE.snapToPixel;
  const octaves: readonly WaveOctave[] =
    config?.octaves ?? DEFAULT_WAVE_LINE.octaves;
  const spacing = sampleSpacing < 1 ? 1 : sampleSpacing;

  const dx = endX - startX;
  const dy = endY - startY;
  const segLen = Math.sqrt(dx * dx + dy * dy);
  if (segLen < 1e-9) {
    return [
      {
        x: startX,
        y: startY,
        normalX: DEFAULT_DEGENERATE_NORMAL_X,
        normalY: DEFAULT_DEGENERATE_NORMAL_Y,
      },
    ];
  }
  const tx = dx / segLen;
  const ty = dy / segLen;
  // Outward normal: 90° CCW of tangent in canvas coords (Y flipped).
  // (1,0) → (0,−1); (0,1) → (1,0).
  const nx = ty;
  const ny = -tx;

  // For Gerstner mode, derive per-octave GerstnerOctave[] from the global
  // steepness. Per-octave steepness control is only available via the
  // low-level `gerstnerDisplacement` evaluator.
  const gerstnerOctaves: readonly GerstnerOctave[] = octaves.map((o) => ({
    amplitude: o.amplitude,
    wavelength: o.wavelength,
    speed: o.speed,
    steepness,
    phase: o.phase,
  }));

  const sampleCount = Math.max(1, Math.round(segLen / spacing));
  const rawPoints: { x: number; y: number }[] = new Array(sampleCount + 1);

  for (let i = 0; i <= sampleCount; i++) {
    // s = arc length along the segment; used as the wave's "x" input so
    // the same wavelength reads the same physical size on any orientation.
    const s = (i / sampleCount) * segLen;
    const restX = startX + tx * s;
    const restY = startY + ty * s;

    let dispAlong = 0;
    let dispAcross = 0;
    if (mode === 'gerstner') {
      const g = gerstnerScalar(s, t, gerstnerOctaves);
      dispAlong = g.along;
      dispAcross = g.across;
    } else {
      dispAcross = sumOfSinesScalar(s, t, octaves);
    }

    const px = restX + dispAlong * tx + dispAcross * nx;
    const py = restY + dispAlong * ty + dispAcross * ny;

    rawPoints[i] = snap
      ? { x: Math.floor(px), y: Math.floor(py) }
      : { x: px, y: py };
  }

  // Second pass: compute outward normals from the local curve tangent
  // (finite difference of neighbours). Done after the fact so the normals
  // reflect the actual displaced curve, not just the segment direction.
  const out: WavePoint[] = new Array(rawPoints.length);
  for (let i = 0; i < rawPoints.length; i++) {
    const prev = rawPoints[Math.max(0, i - 1)];
    const next = rawPoints[Math.min(rawPoints.length - 1, i + 1)];
    const tdx = next.x - prev.x;
    const tdy = next.y - prev.y;
    const tlen = Math.sqrt(tdx * tdx + tdy * tdy);
    let normX: number;
    let normY: number;
    if (tlen < 1e-9) {
      // Degenerate (e.g. two snapped samples on the same pixel): fall back
      // to the segment outward normal so the field is never zero.
      normX = nx;
      normY = ny;
    } else {
      // 90° CCW of curve tangent in canvas coords.
      normX = tdy / tlen;
      normY = -tdx / tlen;
    }
    out[i] = {
      x: rawPoints[i].x,
      y: rawPoints[i].y,
      normalX: normX,
      normalY: normY,
    };
  }
  return out;
}

// =============================================================================
// Ratified defaults
//
// Values confirmed by benchmark
// `benchmarks/surface-ripple/sine-vs-gerstner.png`: the provisional
// amplitude-3 / wavelength-40 defaults were too flat and slow at Sokpop
// tile scale; amplitude-5.5 / wavelength-28 with a 2-octave stack reads
// as lava. Steepness 0.7 produces the sharp-crested, flat-troughed
// trochoidal shape that reads as viscous.
// =============================================================================

/**
 * Default config for sine-mode wave lines. 2 octaves for richness,
 * `snapToPixel: true` for the retro-digital pixel-art aesthetic (sine
 * has no horizontal displacement, so snapping produces clean uniform
 * stepping). Consumers spread into their own config:
 * `{ ...DEFAULT_WAVE_LINE, snapToPixel: false }`.
 */
export const DEFAULT_WAVE_LINE: Required<WaveLineConfig> = {
  mode: 'sine',
  octaves: [
    { amplitude: 5.5, wavelength: 28, speed: 0.8 },
    { amplitude: 2.0, wavelength: 15, speed: -1.2 },
  ],
  steepness: 0.5,
  snapToPixel: true,
};

/**
 * Default config for Gerstner-mode wave lines. Same 2 octaves as
 * `DEFAULT_WAVE_LINE`, with `steepness: 0.7` (the benchmark-confirmed
 * sharp-crested lava shape) and `snapToPixel: false` (Gerstner's
 * horizontal pinch + pixel snapping collapses crest columns — see
 * `generateWaveLine` JSDoc).
 */
export const DEFAULT_GERSTNER: Required<WaveLineConfig> = {
  mode: 'gerstner',
  octaves: [
    { amplitude: 5.5, wavelength: 28, speed: 0.8 },
    { amplitude: 2.0, wavelength: 15, speed: -1.2 },
  ],
  steepness: 0.7,
  snapToPixel: false,
};
