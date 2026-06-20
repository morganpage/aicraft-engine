# Decision: Surface Ripple / Wave-on-Polyline (`src/primitives/wave-line.ts`)

**Status:** APPROVED — proceeds to TDD implementation.
**Inputs:** `docs/research/surface-ripple.md` · `docs/design/surface-ripple-proposal.md` · architect critique (NEEDS REVISION minor → APPROVED, loop 2/2) · prototype `src/_prototype/wave-line-spike.ts` · benchmark `benchmarks/surface-ripple/sine-vs-gerstner.png`.

## Decision

Adopt **Approach C (Hybrid): low-level displacement evaluators + high-level polyline generator.** Stateless-only v1 (spring-mass columns deferred to v2). Lands in `src/primitives/wave-line.ts` — NOT `src/animation/` (the animation pillar is under active hero-character work and the wave math is renderer-adjacent, not animation-coupled).

- **`waveDisplacement(x, t, config: WaveDisplacementConfig) → number`** — pure sum-of-sines evaluator. Returns **absolute Y** (the full y-coordinate, not a delta). Crest-up = negative Y direction (canvas convention: up is negative). `WaveDisplacementConfig = { octaves: readonly WaveOctave[], baseY }`. Each `WaveOctave = { amplitude, wavelength, speed, phase? }`.
- **`gerstnerDisplacement(x0, t, config) → { x, y, dx, dy }`** — pure 1D Gerstner evaluator. Returns displaced position + derivatives. Config is `{ octaves: readonly GerstnerOctave[] }` — **per-octave steepness** (each `GerstnerOctave` carries its own `steepness`). No global `steepness` on this function (would conflict with per-octave; architect objection). Steepness clamp `Q ≤ 1/(k·amplitude)` prevents loop self-intersection.
- **`generateWaveLine(startX, startY, endX, endY, sampleSpacing, t, config: WaveLineConfig) → WavePoint[]`** — high-level polyline generator. `WaveLineConfig = { mode: 'sine' | 'gerstner', octaves?, steepness?, snapToPixel? }`. `mode` is an open-ended union — `'spring-mass'` can be added non-breakingly in v2. **Global `steepness` applies to all octaves in Gerstner mode**; for per-octave steepness control, use `gerstnerDisplacement` directly (documented in JSDoc).
- **`WavePoint = { x, y, normalX, normalY }`** — flat shape (NOT nested `normal`). Easier to destructure at the call site, one fewer object access in hot render loops. `WaveNormal` type removed.
- **`sampleSpacing` parameter** (not `vertexCount`) — resolution-independent across games with different pool widths.
- **Outward normal convention** (implicit via start→end ordering): outward = 90° CCW of the start→end tangent in canvas coords. For a horizontal left→right pool, outward = up (correct). **Waterfall footgun documented in JSDoc:** for a vertical waterfall where the liquid should be to the left, swap `start`↔`end`. An explicit `outwardSide: 'left' | 'right'` config field is a non-breaking v2 addition if the implicit convention proves insufficient.

## Ratified defaults (from benchmark `benchmarks/surface-ripple/sine-vs-gerstner.png`)

The provisional defaults (amplitude 3, wavelength 40, speed 0.8, steepness 0.5) were **too flat and slow**. The benchmark's tuned variants (amplitude 5.5, wavelength 28, 2 octaves for richness) looked vastly superior. Ratified:

- **`DEFAULT_WAVE_LINE`** (sine): 2 octaves — `{ amplitude: 5.5, wavelength: 28, speed: 0.8 }` + `{ amplitude: 2.0, wavelength: 15, speed: -1.2 }`. `snapToPixel: true` (retro-digital aesthetic — sine + snap is clean).
- **`DEFAULT_GERSTNER`**: same 2 octaves, `steepness: 0.7`, `snapToPixel: false`. The benchmark showed steepness 0.7 produces the sharp-crested, flat-troughed trochoidal shape that reads as viscous lava/acid.

**Mode guidance (documented in JSDoc, ratified by benchmark):**
- **Sine + `snapToPixel: true`** — best for the retro-digital pixel-art aesthetic. Sine has no horizontal displacement, so snapping produces clean uniform stepping.
- **Gerstner + `snapToPixel: false`** — best for viscous liquids (lava, acid). Gerstner's horizontal pinch + pixel snapping produces degenerate collapsed crest columns (confirmed in benchmark row 4); use smooth sub-pixel rendering instead.

## What was rejected

- **Stateful spring-mass columns in v1** — highly interactive (splash response to entities falling in) but requires the consumer to maintain state across frames under a fixed timestep. Deferred to v2. The stateless generators cover the 90% case (ambient rippling surfaces).
- **Global `steepness?` on `gerstnerDisplacement`** — ambiguous with per-octave `GerstnerOctave.steepness`. Dropped; per-octave is the whole point of the low-level evaluator.
- **Nested `WavePoint` with `normal: WaveNormal`** — flat `{x, y, normalX, normalY}` is cleaner at the call site and in hot loops.
- **`vertexCount` parameter** — `sampleSpacing` is resolution-independent across games; the consumer can compute `vertexCount = ceil(width/spacing)` trivially if needed.
- **Horizontal-only emission in v1** — the arbitrary-line math generalizes cheaply (project displacement along segment normal); horizontal-only would have been artificial restriction. Waterfall footgun is documented rather than designed around.
- **Coupling to `src/animation/oscillators.ts`** — the wave math is self-contained trig, not oscillator-coupled. `src/primitives/` is the correct home.

## Cross-references

- `docs/research/surface-ripple.md` — prior-art survey (sum-of-sines, Gerstner, spring-mass).
- `docs/design/surface-ripple-proposal.md` — API proposal (Approaches A/B/C, revised).
- `src/_prototype/wave-line-spike.ts` — prototype that surfaced sign-convention, WavePoint shape, and snapToPixel interaction findings.
- `benchmarks/surface-ripple/sine-vs-gerstner.png` — the 6×5 benchmark grid that ratified the defaults and mode guidance.
- `benchmarks/_scripts/wave-line-render.ts` — reproducible render script.
