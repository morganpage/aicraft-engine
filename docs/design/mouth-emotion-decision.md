# Decision: Parametric Mouth (Mouth-Emotion)

> Date: 2026-06-20.
> Decided by: @team (orchestrator).
> Proposal: `docs/design/mouth-emotion-proposal.md`.
> Architect critique: APPROVED (with magic-number/gate fixes resolved).
> Benchmark: `benchmarks/mouth-emotion.png`.

## Decision

**Chosen approach:** Approach A — 1-D Emotion Scalar (`[-1, 1]`), showcase-local, `options.emotion` on `drawSlimeKnight` mirroring the existing `options.blink` gate.

## Why

The slime-knight is a minimalist blob character whose emotional range is intentionally narrow: calm smile, neutral, nervous "o". A single `[-1, 1]` scalar maps perfectly to this range and matches the existing `options.blink` convention exactly — omit → no mouth drawn (benchmark byte-identical), `0` → neutral flat line, `+1` → smile, `-1` → small solid circle (nervous "o" mouth).

The decision was driven by four inputs:

1. **Research** (`docs/research/mouth-emotion.md`): identified three composable patterns — (1) interpolated cubic Bézier for smooth smile/frown, (2) wave-displaced polyline for the nervous tremble, and (3) 2-D valence-arousal emotion space. Approach A uses pattern 1 for the positive range; the negative range ultimately diverged from the original proposal (see below).

2. **Approved proposal** (`docs/design/mouth-emotion-proposal.md`): Approach A was recommended for its trivial call-site ergonomics (`emotion: 0.3` is a gentle smile) and zero consumer learning curve. Approach B (2-D valence-arousal) and C (explicit shape knobs) were documented as future alternatives.

3. **Architect critique**: APPROVED with two fixes applied during implementation — the gate uses `!== undefined` (not `!== 0`) so that `emotion: 0` draws a neutral flat line while omission draws nothing, and all tunable constants are named (no magic numbers).

4. **Benchmarker visual review + collision fix**: drove the final constant tuning. The nervous geometry was redesigned from the proposal's frown+tremble to a **flat-line → filled-circle morph** (see "Shipped Implementation" below). The initial circle radius (0.30) at Y offset 0.25 collided with the cyclops eye outline (~3.7px overlap → figure-8 blob). The fix — Y offset raised to 0.30 and circle radius tightened to 0.20 — was visually confirmed by the benchmarker and independently pixel-verified by the orchestrator: eye outline bottom at y=192, mouth top at y=194 → 2px gap, no collision.

## Shipped Implementation

The shipped nervous geometry **diverges from the original proposal**. The proposal described a wave-displaced polyline tremble (research Pattern 2) for the negative range. The shipped version replaces this with a **flat-line → filled-circle morph**: at `emotion = -1`, the mouth is a small solid filled "o" (classic nervous mouth); at `emotion = 0`, it is a flat neutral line. The transition is continuous — the morph parameter `t = clamp(-emotion, 0, 1)` interpolates an ellipse from the flat line to the full circle.

**Why the change:** The user requested "nervous should be a circular mouth; transition the emotion:0 line into a circle at emotion:-1." The small "o" shape itself conveys nervous without needing motion.

### How it works

- `emotion > 0` → smile via `drawSmoothMouth` (cubic Bézier, curvature = emotion). Unchanged from proposal.
- `emotion = 0` → flat line (both branches render the identical flat segment).
- `emotion ∈ [-1, 0]` → the flat line morphs into a small solid filled circle via `drawCircleMouth`:
  - `t = clamp(-emotion, 0, 1)`
  - `circleR = width · MOUTH_CIRCLE_RADIUS_RATIO`
  - `rx = lerp(width / 2, circleR, t)` — semi-width contracts
  - `ry = lerp(0, circleR, t)` — semi-height grows
  - Ellipse filled AND stroked in `palette.outline` at `CHUNKY_OUTLINE_WIDTH` (3px)

### Why these values

- **`MOUTH_Y_OFFSET_RATIO = 0.30`**: raised from the proposal's 0.15 → 0.25 → 0.30 across three iterations to clear the cyclops eye. At 0.25 the circle at full nervous still overlapped the eye outline; at 0.30 with the tighter circle, a clean 2px gap was confirmed.
- **`MOUTH_CIRCLE_RADIUS_RATIO = 0.20`**: tightened from 0.30 to reduce the circle's visual weight (reads as clenched/nervous, not surprised gasp) and to clear the eye collision. At `width ≈ 28px`, this yields a ~5.6px-radius circle.
- **`MOUTH_WIDTH_RATIO = 0.35`**: narrowed from the proposal's 0.40 so the mouth doesn't approach the body silhouette edge at the lower Y position.
- **`MOUTH_CURVATURE_CONTROL_RATIO = 0.25`**: unchanged from proposal.

### `tick` removed

The mouth is now a **pure function of `emotion`** — no temporal motion, no `tick` parameter. The tremble (which depended on `tick` for its wave phase) is gone. The small "o" shape itself conveys nervous statically. A subtle pulse/jitter was considered and deferred as a possible future enhancement.

### Continuity at `emotion = 0`

Both branches render the same flat horizontal line at the boundary: the smile Bézier at curvature 0 is a flat segment from `(cx ± width/2, cy)`; the circle morph at `t = 0` is a degenerate ellipse (`ry = 0`) whose fill has zero area and whose stroke is the same flat segment. Same width, same stroke color, same line width, same round caps → the boundary is invisible from either side.

## Final Shipped Constants

| Constant | Value | Description |
|---|---|---|
| `MOUTH_Y_OFFSET_RATIO` | `0.30` | Vertical offset from body center as fraction of `bodyHeight` |
| `MOUTH_WIDTH_RATIO` | `0.35` | Mouth width as fraction of `bodyWidth` |
| `MOUTH_CURVATURE_CONTROL_RATIO` | `0.25` | Bézier control-point vertical displacement fraction of mouth width |
| `MOUTH_CIRCLE_RADIUS_RATIO` | `0.20` | Radius of the nervous "o" circle at `emotion = -1`, as fraction of mouth width |

**Removed constants** (were part of the tremble design, no longer shipped):
`MOUTH_TREMBLE_MAX_AMPLITUDE`, `MOUTH_TREMBLE_BASE_FREQ`, `MOUTH_TREMBLE_FREQ_RANGE`, `MOUTH_TREMBLE_SPEED`, `MOUTH_TREMBLE_SEGMENTS`, `MOUTH_SMOOTH_TREMBLE_THRESHOLD`.

## What was rejected, and why

- **Approach B (2-D Valence-Arousal):** richer emotional vocabulary (excited gasp, bored flat line) but overkill for the slime-knight's intentionally narrow range. The second dimension adds API surface with no current consumer. Deferred to v2 if the showcase needs "open mouth" or "excited nervous" vs "scared nervous."
- **Approach C (Explicit Shape Knobs):** maximum control, minimum opinion — the consumer must know that "happy" means `curvature: 0.7, tremble: 0, openness: 0`. Every consumer would re-implement their own emotion→shape mapping. Not ergonomic for the common case.

## Explicit Deferrals (v2)

- **Subtle mouth motion (pulse/jitter):** a possible future enhancement to add a slight time-varying element to the nervous "o" (e.g., a subtle scale pulse or position jitter). Currently the mouth is fully static — the shape alone conveys nervous. Not shipped; not a deferral from the original tremble design (that was fully removed, not deferred).
- **Filled open mouth** (gasp): the v1 mouth is line-only for positive emotion (stroked Bézier) and filled circle for negative. A true "open mouth" with configurable openness requires a second dimension (`openness`) not captured by the 1-D scalar. Deferred.
- **Eyebrows:** composable secondary cues from research Pattern 4 (angled lines above the eye). Add massive emotional ROI but add geometric complexity (two extra line segments) that should be prototyped separately. Deferred.
- **Sweat-drop particle:** research Pattern 4's tear-shaped particle. Deferred alongside eyebrows.
- **Upgrade to 2-D valence/arousal:** if the showcase later needs richer expression, the 1-D API expands additively — `MouthEmotion2D = { valence: emotion, arousal: 0 }`. No breaking change.

## Showcase Wiring

- Mood slider in `showcase/sections/hero.ts`: range `[-1, 1]`, step `0.1`, default `+0.3` (gentle resting smile so the character reads as friendly on first paint).
- `[` / `]` keyboard nudge at step `0.1`, clamped + rounded to avoid float drift.
- Wired to `drawSlimeKnight`'s `options.emotion` — local to the hero section, NOT in `GlobalState`.

## Scope

Showcase-local only. **NOT a library export.** The mouth code lives in `showcase/helpers/slime-knight.ts` alongside `drawEye`, `drawBody`, `drawLimb`, etc. The library provides primitives; the showcase assembles them.
