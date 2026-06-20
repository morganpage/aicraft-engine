# API Proposal: Parametric Mouth (Mouth-Emotion)

> Target pillar: Showcase-local (NOT a library export). Module: `showcase/helpers/slime-knight.ts`.
> Builds on research: `docs/research/mouth-emotion.md`.
> Status: DRAFT.

> **REVISION — Shipped divergence from this proposal.** The negative-emotion
> geometry described below (wave-displaced polyline tremble) was replaced during
> implementation with a **flat-line → filled-circle morph** (the classic nervous
> "o" mouth). The shipped code has no `drawTrembleMouth`, no `resolveMouthParams`,
> no `MouthParams` interface, and no `tick` parameter — the mouth is a pure
> function of `emotion`. Constants also changed: `MOUTH_Y_OFFSET_RATIO` is now
> `0.30` (not 0.15) and `MOUTH_CIRCLE_RADIUS_RATIO = 0.20` replaced the six
> `MOUTH_TREMBLE_*` constants. See `docs/design/mouth-emotion-decision.md` for
> the source of truth on what shipped and why.

## Consumer Need

The slime-knight showcase character currently has only a cyclops eye (gaze + blink). Adding a parametric mouth below the eye gives the character emotional range: calm smile during idle, focused expression during walk, nervous chattering during jump-panic. The mouth must:
- Interpolate smoothly across SMILING → NEUTRAL → NERVOUS
- Compose with the existing eye (gaze + blink) inside the body-local transform
- Stay 100% deterministic (the nervous tremble is a pure function of `tick`, seeded — no `Math.random`)
- Match the chunky-outline / flat-fill aesthetic (3px outline, palette-driven)
- Be benchmarkable (renderable headless to PNG via node-canvas)
- Be driven by the live showcase (happiness slider, gameplay-driven emotion)

The mouth is **showcase-local** (like `drawEye` / `drawSingleEye`) — it lives in `slime-knight.ts`, not in `src/`. The library provides primitives; the showcase assembles them.

---

## Approach A: 1-D Emotion Scalar (Happy ↔ Nervous)

**Source pattern:** Patterns 1 + 2 + 3 from the research note — cubic Bézier for the base curve (Pattern 1), wave-displaced polyline for the nervous tremble (Pattern 2), with a simplified 1-D projection of the valence-arousal space (Pattern 3) that collapses the interesting axis into a single number.

**Signature sketch:**

```ts
// In showcase/helpers/slime-knight.ts

/**
 * Parametric mouth emotion value. Drives the mouth shape from a nervous
 * chattering squiggle (-1) through a flat neutral line (0) to a wide
 * happy smile (+1). Intermediate values produce smooth blends.
 *
 * Pure function of (tick, emotion) — no frame state, no RNG.
 */
export type MouthEmotion = number; // [-1, 1] — nervous … neutral … happy

/**
 * Mouth render parameters, derived from the emotion scalar + tick.
 * Internal to the draw call; not exposed to consumers.
 */
interface MouthParams {
  /** Base curve curvature: -1 (frown) through 0 (flat) to +1 (smile). */
  curvature: number;
  /** Tremble amplitude: 0 (smooth) to max (chattering). Active when emotion < 0. */
  trembleAmp: number;
  /** Wave frequency across the mouth width. Higher = denser squiggles. */
  trembleFreq: number;
}

/** Maximum tremble amplitude in body-local px at full nervous (emotion = -1). */
const MOUTH_TREMBLE_MAX_AMPLITUDE = 3.5;

/** Base wave frequency (peaks across mouth width) at zero nervousness. */
const MOUTH_TREMBLE_BASE_FREQ = 3.0;

/** Additional wave frequency added at full nervous (emotion = -1). Range: 3.0–4.5. */
const MOUTH_TREMBLE_FREQ_RANGE = 1.5;

/**
 * Map a 1-D emotion scalar to mouth geometry parameters.
 * Deterministic — pure arithmetic, no RNG.
 *
 * @param emotion - [-1, 1] where -1 = nervous, 0 = neutral, +1 = happy
 * @returns resolved mouth params
 */
function resolveMouthParams(emotion: number): MouthParams {
  const curvature = emotion; // direct mapping: -1=frown, 0=flat, +1=smile
  // Tremble active only when emotion is negative (nervous side)
  const nervousness = Math.max(0, -emotion);
  const trembleAmp = nervousness * MOUTH_TREMBLE_MAX_AMPLITUDE;
  const trembleFreq = MOUTH_TREMBLE_BASE_FREQ + nervousness * MOUTH_TREMBLE_FREQ_RANGE;
  return { curvature, trembleAmp, trembleFreq };
}

/**
 * Draw the parametric mouth below the eye. Called inside the body-local
 * transform (after body + eye are drawn, still inside the composed scale).
 *
 * @param ctx - canvas context (body-local transform already applied)
 * @param cx - mouth center X in body-local space (0 = body midline)
 * @param cy - mouth center Y in body-local space (below the eye)
 * @param width - mouth width in body-local px (~40% of bodyWidth)
 * @param emotion - [-1, 1] emotion scalar
 * @param tick - current render tick (drives the nervous tremble phase)
 * @param palette - color palette (uses outline for the stroke)
 */
function drawMouth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  width: number,
  emotion: MouthEmotion,
  tick: number,
  palette: Palette,
): void {
  const params = resolveMouthParams(emotion);

  if (params.trembleAmp < 0.1) {
    // Smooth path: single cubic Bézier (Pattern 1)
    drawSmoothMouth(ctx, cx, cy, width, params.curvature, palette);
  } else {
    // Nervous path: wave-displaced polyline sampled along the base curve (Pattern 2)
    drawTrembleMouth(ctx, cx, cy, width, params, tick, palette);
  }
}

/**
 * Draw a smooth mouth via a single interpolated cubic Bézier.
 * Follows research Pattern 1 (docs/research/mouth-emotion.md).
 *
 * @param ctx - canvas context (body-local transform already applied)
 * @param cx - mouth center X (0 = body midline)
 * @param cy - mouth center Y (below the eye)
 * @param width - mouth width in body-local px
 * @param curvature - [-1, 1] frown to smile; controls vertical displacement
 *   of the Bézier control points
 * @param palette - color palette (outline slot used for stroke)
 * @returns void — draws directly onto ctx
 * @determinism - Pure function of (cx, cy, width, curvature, palette). No RNG,
 *   no tick dependency, no frame state. Deterministic for a given set of params.
 */
function drawSmoothMouth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  width: number,
  curvature: number,
  palette: Palette,
): void { /* cubic Bézier: start (cx-w/2, cy), ctrl1 (cx-w/4, cy+curvature*amp),
             ctrl2 (cx+w/4, cy+curvature*amp), end (cx+w/2, cy) */ }

/**
 * Draw a nervous/trembling mouth via a wave-displaced polyline sampled along
 * the base curve. Follows research Pattern 2 (docs/research/mouth-emotion.md):
 * the base Bézier is sampled at N evenly-spaced points, each displaced
 * vertically by a sine wave whose amplitude and frequency come from `params`.
 *
 * @param ctx - canvas context (body-local transform already applied)
 * @param cx - mouth center X (0 = body midline)
 * @param cy - mouth center Y (below the eye)
 * @param width - mouth width in body-local px
 * @param params - resolved mouth params (curvature, trembleAmp, trembleFreq)
 * @param tick - current render tick; drives the wave phase (tick × speed)
 * @param palette - color palette (outline slot used for stroke)
 * @returns void — draws directly onto ctx
 * @determinism - Pure function of (cx, cy, width, params, tick, palette). No RNG,
 *   no frame state. The wave phase is `tick * TREMBLE_SPEED`, fully reproducible.
 */
function drawTrembleMouth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  width: number,
  params: MouthParams,
  tick: number,
  palette: Palette,
): void { /* sample base curve at N points, displace each by
             sin(i/N * params.trembleFreq * 2π + tick * TREMBLE_SPEED) * params.trembleAmp,
             then stroke the polyline */ }
```

**Hook into `drawSlimeKnight`:**

```ts
// In drawSlimeKnight's options bag (extends the existing blink flag):
options: {
  blink?: boolean;
  emotion?: MouthEmotion; // NEW — omitted = no mouth (benchmark byte-identical)
}

/** Vertical offset of the mouth center from body top, as a fraction of bodyHeight. */
const MOUTH_Y_OFFSET_RATIO = 0.15;

/** Mouth width as a fraction of bodyWidth. */
const MOUTH_WIDTH_RATIO = 0.4;

// After the eye draw (step 3 in drawSlimeKnight), still inside body-local:
// Gating on `!== undefined` (not `!== 0`): omitted → no mouth drawn (benchmark
// byte-identical, exactly like `blink`); emotion: 0 → a drawn neutral flat line.
if (options.emotion !== undefined) {
  drawMouth(ctx, 0, config.bodyHeight * MOUTH_Y_OFFSET_RATIO,
    config.bodyWidth * MOUTH_WIDTH_RATIO, options.emotion, tick, palette);
}
```

**Usage example (showcase loop):**

```ts
// Happiness slider drives the emotion scalar
const emotion = sliderValue; // -1 to +1

drawSlimeKnight(ctx, state, tick, look, {
  blink: true,
  emotion,
});
```

**Trade-offs:**
- **Ergonomics:** ★★★★★ — One number. The simplest possible call site. "Slide right = happy, left = nervous." No mental model required.
- **Determinism:** ★★★★★ — Pure function of `(tick, emotion)`. No frame state. No RNG. The tremble phase is `tick * speed`, fully reproducible.
- **Runtime cost:** ★★★★★ — O(1) parameter mapping + O(N) polyline (N ≈ 16 segments). Negligible.
- **Consumer complexity:** ★★★★★ — One number to learn. Impossible to misconfigure.
- **Tree-shake-ability:** ★★★★★ — Single function + one helper. Trivially importable.
- **Convention fit:** ★★★★★ — Follows the `options.blink` pattern exactly. Default omitted keeps benchmark byte-identical. Palette-driven stroke. 3px outline.

**What this makes easy:** Driving the mouth from a single gameplay signal (health → nervous, coin → happy). Quick prototyping. Obvious API.

**What this makes hard:** Expressing "wide-open gasping mouth" (requires `openness`, not captured by the 1-D scalar). Expressing "excited nervous" vs "scared nervous" (both map to the same negative emotion). Fine-tuning the smile-vs-frown tradeoff requires hacking `resolveMouthParams`.

---

## Approach B: 2-D Valence-Arousal Blend Space

**Source pattern:** Pattern 3 from the research note — the Russell Circumplex Model mapped to mouth geometry. Full 2-D emotion space.

**Signature sketch:**

```ts
// In showcase/helpers/slime-knight.ts

/**
 * 2-D emotion coordinate for the parametric mouth.
 * Valence: -1 (sad/worried) to +1 (happy).
 * Arousal: -1 (calm/bored) to +1 (excited/nervous).
 *
 * Canonical emotion positions:
 *   ( 1,  0) = calm smile
 *   ( 0,  0) = neutral line
 *   (-1,  0) = calm frown
 *   (-1,  1) = nervous tremble
 *   ( 1,  1) = excited gasp
 *   ( 0, -1) = bored flat line
 */
export interface MouthEmotion2D {
  readonly valence: number; // [-1, 1]
  readonly arousal: number; // [-1, 1]
}

/**
 * Resolved mouth geometry from the 2-D blend space.
 */
interface MouthParams {
  curvature: number;   // [-1, 1] frown to smile
  openness: number;    // [0, 1] closed to open (mouth gap)
  trembleAmp: number;  // [0, max] chattering amplitude
  trembleFreq: number; // wave density across the mouth
}

/**
 * Map a 2-D valence/arousal coordinate to mouth geometry.
 * Deterministic — pure arithmetic.
 *
 * @param valence - [-1, 1] sad to happy
 * @param arousal - [-1, 1] calm to excited/nervous
 * @returns resolved mouth params
 */
function resolveMouthParams2D(valence: number, arousal: number): MouthParams {
  const curvature = valence;
  const openness = Math.max(0, arousal) * (valence >= 0 ? 0.8 : 0.4);
  const nervousness = Math.max(0, arousal) * Math.max(0, -valence);
  const trembleAmp = nervousness * 3.5;
  const trembleFreq = 3.0 + Math.max(0, arousal) * 1.5;
  return { curvature, openness, trembleAmp, trembleFreq };
}

/**
 * Draw the parametric mouth. Same signature pattern as Approach A, but
 * takes a 2-D emotion coordinate instead of a scalar.
 */
function drawMouth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  width: number,
  emotion: MouthEmotion2D,
  tick: number,
  palette: Palette,
): void { ... }
```

**Hook into `drawSlimeKnight`:**

```ts
options: {
  blink?: boolean;
  emotion?: MouthEmotion2D; // NEW — default {valence:0, arousal:0} for benchmark
}
```

**Usage example:**

```ts
// Gameplay-driven emotion
drawSlimeKnight(ctx, state, tick, look, {
  blink: true,
  emotion: { valence: happiness, arousal: panic },
});
```

**Trade-offs:**
- **Ergonomics:** ★★★★☆ — Two numbers instead of one. Slightly more to learn, but the semantics are well-known (valence/arousal is standard in game AI).
- **Determinism:** ★★★★★ — Same as A. Pure function of `(tick, valence, arousal)`.
- **Runtime cost:** ★★★★★ — Same as A. O(1) mapping + O(N) polyline.
- **Consumer complexity:** ★★★☆☆ — Requires understanding what valence and arousal mean. Two axes to tune. But the canonical positions are documented.
- **Tree-shake-ability:** ★★★★★ — Same as A.
- **Convention fit:** ★★★★★ — Same `options` pattern. Default `{0, 0}` keeps benchmark byte-identical.

**What this makes easy:** Expressing "excited smile" (high valence + high arousal → open happy mouth) vs "scared nervous" (negative valence + high arousal → chattering frown). Richer emotional vocabulary. Maps naturally to game AI emotion systems.

**What this makes hard:** The consumer must think in 2-D. A slider becomes two sliders. For the common case ("make him happy or nervous"), the extra dimension is wasted complexity.

---

## Approach C: Explicit Shape Parameters (Curvature + Tremble + Openness)

**Source pattern:** Pattern 1 (Bézier curvature) + Pattern 2 (tremble amplitude) used directly, without an emotion mapping layer. The consumer owns the semantics.

**Signature sketch:**

```ts
// In showcase/helpers/slime-knight.ts

/**
 * Explicit mouth shape parameters. The consumer controls the visual
 * output directly — no emotion mapping layer. This is the "raw knobs"
 * approach: maximum control, minimum opinion.
 */
export interface MouthShape {
  /** Base curve curvature: -1 (frown) through 0 (flat) to +1 (smile). */
  readonly curvature: number;
  /** Tremble amplitude: 0 (smooth Bézier) to ~4 (chattering polyline). */
  readonly tremble: number;
  /** Mouth openness: 0 (closed line) to 1 (wide open). Affects vertical
   *  depth of the Bézier control points. */
  readonly openness: number;
}

/**
 * Draw the parametric mouth from explicit shape parameters.
 */
function drawMouth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  width: number,
  shape: MouthShape,
  tick: number,
  palette: Palette,
): void {
  if (shape.tremble < 0.1) {
    drawSmoothMouth(ctx, cx, cy, width, shape.curvature, shape.openness, palette);
  } else {
    drawTrembleMouth(ctx, cx, cy, width, shape, tick, palette);
  }
}
```

**Hook into `drawSlimeKnight`:**

```ts
options: {
  blink?: boolean;
  mouth?: MouthShape; // NEW — default {curvature:0, tremble:0, openness:0} for benchmark
}
```

**Usage example:**

```ts
// Consumer maps gameplay state to explicit shape
const isNervous = health < 30;
drawSlimeKnight(ctx, state, tick, look, {
  blink: true,
  mouth: {
    curvature: isHappy ? 0.7 : isNervous ? -0.3 : 0,
    tremble: isNervous ? 3.0 : 0,
    openness: isGasp ? 0.6 : 0,
  },
});
```

**Trade-offs:**
- **Ergonomics:** ★★★☆☆ — Three numbers to juggle. The consumer must know what each knob does visually. No "just make him happy" shortcut.
- **Determinism:** ★★★★★ — Same as A and B. Pure function of `(tick, shape)`.
- **Runtime cost:** ★★★★★ — Same as A and B.
- **Consumer complexity:** ★★☆☆☆ — Maximum knobs. The consumer must build their own emotion→shape mapping if they want one. But they have total control.
- **Tree-shake-ability:** ★★★★★ — Same as A and B.
- **Convention fit:** ★★★★★ — Same `options` pattern. Default zeros keep benchmark byte-identical.

**What this makes easy:** Fine-tuning exactly what "nervous" looks like (tremble amplitude, frequency, curvature). Expressing mouth shapes that don't map to a clean emotion (e.g., a crooked smirk = curvature 0.5, openness 0.2, tremble 0). Composing with other face elements (the consumer decides how mouth relates to eyebrows).

**What this makes hard:** The common case ("make him happy") requires the consumer to know that "happy" means `curvature: 0.7, tremble: 0, openness: 0`. There's no semantic shortcut. Every consumer re-implements their own emotion→shape mapping.

---

## Comparison Table

| Criterion | A: 1-D Scalar | B: 2-D Valence-Arousal | C: Explicit Shape |
|---|---|---|---|
| **Ergonomics** | ★★★★★ one number | ★★★★☆ two numbers | ★★★☆☆ three numbers |
| **Determinism** | ★★★★★ pure (tick, emotion) | ★★★★★ pure (tick, v, a) | ★★★★★ pure (tick, shape) |
| **Runtime cost** | ★★★★★ O(1) + O(N) | ★★★★★ O(1) + O(N) | ★★★★★ O(1) + O(N) |
| **Emotional range** | ★★★☆☆ smile↔nervous only | ★★★★★ full 2-D space | ★★★★☆ any shape, no semantics |
| **Convention fit** | ★★★★★ options pattern | ★★★★★ options pattern | ★★★★★ options pattern |
| **Benchmark safety** | ★★★★★ default 0 | ★★★★★ default {0,0} | ★★★★★ default zeros |
| **Consumer learning** | ★★★★★ trivial | ★★★★☆ valence/arousal | ★★★☆☆ three knobs |
| **Open mouth support** | ✗ not in 1-D space | ✓ arousal drives openness | ✓ openness is explicit |
| **Risk** | Low — simple, proven | Low — standard model | Low — raw control |

---

## Recommendation

**Approach A: 1-D Emotion Scalar** — prototype first.

Rationale: The slime-knight is a minimalist blob character. Its emotional range is intentionally narrow: calm smile, neutral, nervous chattering. A single `[-1, 1]` scalar maps perfectly to this range and matches the existing `options.blink` convention exactly. The 1-D scalar is trivial to drive from a slider (the showcase's primary interaction), from gameplay state (`health < 30 ? -0.8 : 0.5`), or from a blend of signals. The nervous tremble (the hardest visual to get right) is fully captured by the negative half of the scalar.

If the showcase later needs "excited gasp" (open mouth) or "scared vs excited nervous," we can **additively** expand to Approach B's 2-D space without breaking the 1-D API — a `MouthEmotion2D` is just `{ valence: emotion, arousal: 0 }`. Approach C's explicit knobs are always available as an internal implementation detail inside `drawMouth`; the consumer never needs to see them.

**Prototype order:** A first (prove the Bézier + polyline rendering works), then optionally promote to B if the showcase needs richer expression.

---

## Open Questions for @architect

1. **Mouth position relative to the eye:** The mouth sits below the cyclops eye at `bodyHeight * 0.15` (body-local Y). Is this the right vertical offset? Should it be derived from `eyeRadius` instead (so it tracks different seed proportions)?

2. **Mouth width scaling:** Proposed `bodyWidth * 0.4`. Should this be a named constant in `HERO_RANGES` (like `eyeRadius`) so different seeds get different mouth widths? Or fixed at 40% of body width for all seeds?

3. **Benchmark byte-identical preservation:** ~~Resolved~~ — The gate is `options.emotion !== undefined` (matching `options.blink`'s `=== true` pattern). Omitted → no mouth drawn (benchmark unchanged). `emotion: 0` → a drawn neutral flat line.

4. **Eyebrows / sweat-drop in scope for v1?** The research note (Pattern 4) recommends composable secondary cues. Should the proposal include a `worry` parameter for eyebrows, or explicitly defer to v2? My recommendation: defer — the mouth alone sells the emotion at the Sokpop scale, and eyebrows add geometric complexity (two extra line segments above the eye) that should be prototyped separately.

5. **Open mouth (filled shape) — v1 or v2?** Approach A's 1-D scalar cannot express "open mouth" without adding a second dimension. Should v1 be line-only (stroked Bézier / polyline), with filled open mouth deferred to v2? My recommendation: line-only for v1, matching the simplest Sokpop style.
