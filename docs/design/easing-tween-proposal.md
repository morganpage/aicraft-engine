# API Proposal: Easing & Tween

> Target pillar: Pillar 1. Module: `src/easing/`.
> Builds on research: `docs/research/easing-tween.md`.
> Status: DRAFT.

## Consumer Need

Spitekeep currently inlines easing math in three separate places:
1. `src/core/traps/hidden-pit.ts:272` — a local `easing(t, name)` switch over quadratic curves only (`easeIn`/`easeOut`/`easeInOut`)
2. `src/death-cinematography/zoom.ts:75` — inline `1 - Math.pow(1 - t, 3)` for easeOutCubic
3. `src/render/camera.ts` — another inline easeOutCubic for the intro zoom

Particle lifetime curves (`particleAge` → `particleSizeCurve`/`particleAlphaCurve`) are linear-only; the research note identified that non-linear curves (fast-start fade, overshoot bounce) are needed for polished FX.

Without a shared easing module, each new game re-implements the same math with inconsistent naming and limited curve vocabulary. This proposal extracts a deterministic, pure-function easing library that all games can share.

## Approach A: Named Curves Only (No Tween Driver)

**Source pattern:** Pattern 1 (Robert Penner equations) + Pattern 4 (compact demoscene). mattdesl/eases one-function-per-export style.

**Signature sketch:**

```ts
// In src/easing/curves.ts

/** Linear: identity. */
export function linear(t: number): number;

/** Ease-out quad: `1 - (1-t)²`. */
export function easeOutQuad(t: number): number;

/** Ease-out cubic: `1 - (1-t)³`. Fast start, gentle settle. */
export function easeOutCubic(t: number): number;

/** Ease-out quart: `1 - (1-t)⁴`. Aggressive start, soft landing. */
export function easeOutQuart(t: number): number;

/** Ease-out quint: `1 - (1-t)⁵`. Maximum snap. */
export function easeOutQuint(t: number): number;

/** Ease-out back: overshoots past 1.0 then settles (s = 1.70158). */
export function easeOutBack(t: number): number;

/** Ease-out elastic: oscillates with exponential decay. Spring feel. */
export function easeOutElastic(t: number): number;

/** Ease-out bounce: piecewise quadratic floor-bounce simulation. */
export function easeOutBounce(t: number): number;

/** Generic power-out: `1 - (1-t)^n`. Covers quad/cubic/quart/quint by n. */
export function powOut(t: number, n: number): number;

// --- Inversion helpers ---

/** Derive In variant: `1 - outFn(1 - t)`. */
export function easeIn(outFn: (t: number) => number): (t: number) => number;

/** Derive InOut variant: symmetric around t=0.5. */
export function easeInOut(outFn: (t: number) => number): (t: number) => number;
```

**Usage example:**

```ts
// Particle alpha with easeOutCubic fade
import { easeOutCubic } from './lib/aicraft-engine/src/easing';

function particleAlphaCurve(p: Particle, startAlpha: number, endAlpha: number): number {
  const age = particleAge(p);
  const eased = easeOutCubic(age); // fast fade-out, gentle tail
  return startAlpha + (endAlpha - startAlpha) * eased;
}

// Death zoom — replaces inline `1 - Math.pow(1 - t, 3)`
import { easeOutCubic } from './lib/aicraft-engine/src/easing';
const eased = easeOutCubic(progress);
const scale = START + (TARGET - START) * eased;

// Trap easing — replaces the hidden-pit switch
import { linear, easeIn, easeOut, easeInOut, powOut } from './lib/aicraft-engine/src/easing';
const resolveEasing = (name: string) => {
  switch (name) {
    case 'easeIn': return easeIn(easeOutQuad);
    case 'easeOut': return easeOutQuad;
    case 'easeInOut': return easeInOut(easeOutQuad);
    default: return linear;
  }
};
```

**Trade-offs:**
- **Ergonomics:** Excellent for the common case (particle curves, zoom, trap easing). Consumer passes a function reference — no config objects, no state management. Exactly how mattdesl/eases works.
- **Determinism:** Perfect. Pure functions of `t`. No state, no accumulation, no timing.
- **Runtime cost:** Negligible. 1–4 multiplications per call. O(1).
- **Consumer complexity:** Consumer must build their own tween state if they need time-based animation. For particle curves, there's no tween — they just compose with `particleAge`.
- **Tree-shake-ability:** Perfect. Each curve is individually importable.
- **Convention fit:** Matches `oscillators.ts` (pure functions of a time parameter → number). No magic numbers (back constant 1.70158 is baked into the named function). JSDoc on every export.

**What this makes easy:**
- Particle lifetime curves: `easeOutCubic(particleAge(p))` — one line
- Trap easing: `resolveEasing(params.easing)(t)` — direct function call
- Camera zoom: `easeOutCubic(progress)` — drop-in replacement for inline math
- Any `[0,1] → [0,1]` remapping

**What this makes hard:**
- Time-based tweening (fade a value over 0.5s) — consumer must build their own elapsed/duration/loop state machine
- Yoyo/loop semantics — consumer must implement direction-flip and loop counting

## Approach B: Curves + Stateless Tween Driver (Recommended)

**Source pattern:** Pattern 1 (Penner) + Pattern 2 (Phaser/DOTween lifecycle, simplified) + Pattern 3 (fixed-step determinism). Mirrors `advanceEmitter`/`advanceJump` pure-progression-ops shape.

**Signature sketch:**

```ts
// In src/easing/curves.ts — same as Approach A (all named curves + powOut + inversion helpers)
// ...

// In src/easing/tween.ts

/**
 * Persistent tween state. Consumer owns this object and passes it to
 * `advanceTween` each tick. Initialised via `createTweenState`.
 */
export interface TweenState {
  /** Accumulated seconds in the current iteration. */
  elapsed: number;
  /** Current direction: 1 = forward, -1 = backward (yoyo). */
  direction: 1 | -1;
  /** Remaining loop count. 0 = single play, -1 = infinite. */
  loopCount: number;
  /** Delay countdown before tween begins. Decremented each tick. */
  delay: number;
}

/**
 * Configuration for `advanceTween`. Immutable after creation.
 * Consumer stores this alongside their TweenState.
 */
export interface TweenConfig {
  /** Duration of one forward (or backward) pass in seconds. */
  duration: number;
  /** Easing curve applied to normalized progress. */
  ease: (t: number) => number;
  /** Reverse direction on each completed iteration. Default: false. */
  yoyo?: boolean;
  /** Number of complete iterations. 0 = single play, -1 = infinite. Default: 0. */
  loops?: number;
  /** Delay in seconds before the first iteration begins. Default: 0. */
  delay?: number;
}

/**
 * Result of advancing a tween by one tick.
 */
export interface TweenResult {
  /** Brand-new tween state (input never mutated). */
  state: TweenState;
  /** Current eased value in [0, 1]. */
  value: number;
  /** True when all loops have completed. */
  done: boolean;
}

/**
 * Create fresh tween state. All fields zeroed; the tween starts immediately
 * (no delay) on the first `advanceTween` call.
 */
export function createTweenState(): TweenState;

/**
 * Advance a tween by `dt` seconds. Pure: returns a new TweenState and the
 * current eased value. Never throws.
 *
 * Call inside `step(fixedDt)` of the fixed-step loop for replay-deterministic
 * animation. The `dt` parameter MUST come from the fixed-step accumulator —
 * never from `performance.now()` or a variable frame delta.
 *
 * One iteration = forward pass (+ optional backward pass if yoyo). The `loops`
 * count tracks complete iterations. At `loops: 0, yoyo: false` the tween
 * completes after one forward pass. At `loops: 0, yoyo: true` it completes
 * after one forward + one backward pass.
 *
 * @param state  - current tween state (not mutated)
 * @param dt     - fixed timestep in seconds (from advanceAccumulator)
 * @param config - tween configuration (immutable)
 * @returns new state, eased value, and done flag
 *
 * @example
 * ```ts
 * let tween = createTweenState();
 * const config: TweenConfig = { duration: 0.3, ease: easeOutCubic };
 * // In step(fixedDt):
 * const result = advanceTween(tween, fixedDt, config);
 * tween = result.state;
 * const alpha = lerp(1.0, 0.0, result.value); // fade from 1→0 with easeOutCubic
 * if (result.done) { /* tween finished */ }
 * ```
 */
export function advanceTween(
  state: TweenState,
  dt: number,
  config: TweenConfig,
): TweenResult;
```

**Usage example:**

```ts
// Death zoom with tween driver
import { createTweenState, advanceTween, easeOutCubic } from './lib/aicraft-engine/src/easing';
import type { TweenConfig } from './lib/aicraft-engine/src/easing';

// Store in game state
let zoomTween = createTweenState();
const ZOOM_CONFIG: TweenConfig = { duration: 0.5, ease: easeOutCubic };

// In step(fixedDt):
const { state, value, done } = advanceTween(zoomTween, fixedDt, ZOOM_CONFIG);
zoomTween = state;
const scale = 1.0 + (2.0 - 1.0) * value; // 1.0 → 2.0 with easeOutCubic

// Camera punch (yoyo + delay)
let punchTween = createTweenState();
const PUNCH_CONFIG: TweenConfig = {
  duration: 0.15,
  ease: easeOutBack,
  yoyo: true,
  delay: 0.05,
};

// Particle alpha with easing (no tween — direct curve composition)
import { easeOutCubic } from './lib/aicraft-engine/src/easing';
const alpha = easeOutCubic(particleAge(p)); // drop-in for linear age
```

**Trade-offs:**
- **Ergonomics:** Excellent. `createTweenState()` + `advanceTween(state, dt, config)` follows the exact same pattern as `createEmitter` + `stepEmitters` and `createJumpState` + `advanceJump`. The consumer stores state and config separately; the engine provides the pure advance function.
- **Determinism:** Perfect. Pure functions. State is consumer-owned. No `Math.random`, no `Date.now()`. `dt` comes from the fixed-step loop. Same inputs → byte-identical outputs.
- **Runtime cost:** One object spread per `advanceTween` call (the `TweenResult` allocation). This matches `advanceEmission` which allocates `{ next, spawnCount }` per call. In practice the JIT optimises this to a stack allocation. The hot path is 1 comparison (delay check) + 1 division (elapsed/duration) + 1 ease call + 1 direction check. Negligible.
- **Consumer complexity:** Low. State management is explicit (consumer owns `TweenState`). Config is immutable. The consumer must write `tween = result.state` each tick — this is the standard pure-progression-ops pattern used throughout the library.
- **Tree-shake-ability:** Good. Curves and tween driver are separate modules. Consumer can import only curves (for particle lifetime) or only the tween driver (if they write custom curves).
- **Convention fit:** Strong. Follows `advanceJump(state, inputs, dt, config)` → `{ state, value, events }` and `advanceEmission(state, dt, config)` → `{ next, spawnCount }` patterns exactly. Pure in, fresh out, never throw.

**What this makes easy:**
- Everything from Approach A (all curves are available)
- Time-based tweening with one line of setup: `createTweenState()` + config
- Yoyo, delay, and loop semantics out of the box
- Deterministic replay: same `(state, dt, config)` → same output
- Camera punch, UI fade, card flip — any one-shot or repeating value animation

**What this makes hard:**
- Multi-property tweening (e.g. animate x AND opacity simultaneously) — consumer calls `advanceTween` once and reads `result.value` for both, using different lerp endpoints. This is fine for v1.
- Chaining tweens (sequence A → B → C) — consumer checks `done` and starts the next tween manually. Acceptable for v1.

## Approach C: Minimal Curves (Particle-Lifetime Only)

**Source pattern:** Pattern 1 (Penner), stripped to the minimum needed for `particleAlphaCurve`/`particleSizeCurve` evaluation.

**Signature sketch:**

```ts
// In src/easing/curves.ts

/** Linear: identity. */
export function linear(t: number): number;

/** Ease-out cubic: `1 - (1-t)³`. The most common game easing. */
export function easeOutCubic(t: number): number;

/** Ease-out quad: `1 - (1-t)²`. Gentler variant. */
export function easeOutQuad(t: number): number;

/** Generic power-out: `1 - (1-t)^n`. */
export function powOut(t: number, n: number): number;

// NO: back, elastic, bounce, inversion helpers, tween driver
```

**Usage example:**

```ts
// Particle alpha with easeOutCubic
import { easeOutCubic } from './lib/aicraft-engine/src/easing';
const alpha = easeOutCubic(particleAge(p));
```

**Trade-offs:**
- **Ergonomics:** Minimal. Covers the particle-lifetime use case but forces consumers to re-implement everything else.
- **Determinism:** Perfect.
- **Runtime cost:** Lowest (fewest exports, smallest bundle).
- **Consumer complexity:** High for anything beyond particle curves. Spitekeep still needs to implement its own back/elastic/bounce for trap easing and zoom.
- **Tree-shake-ability:** Perfect.
- **Convention fit:** Matches the module structure but underserves the consumer.

**What this makes easy:**
- Particle lifetime curves only

**What this makes hard:**
- Trap easing (needs easeIn for the `hidden-pit.ts` switch)
- Camera zoom (needs easeOutCubic — which IS included, but no back/elastic)
- Any overshoot or bounce effect
- Time-based tweening

## Comparison Table

| Criterion | A: Named Curves | B: Curves + Tween | C: Minimal |
|---|---|---|---|
| Particle curves | ✅ Full | ✅ Full | ⚠️ Limited subset |
| Trap easing | ✅ Full | ✅ Full | ❌ No easeIn |
| Camera zoom | ✅ Full | ✅ Full | ✅ easeOutCubic only |
| Time-based tweening | ❌ Consumer builds | ✅ Built-in | ❌ Consumer builds |
| Yoyo/loops | ❌ Consumer builds | ✅ Built-in | ❌ Consumer builds |
| Determinism | ✅ Perfect | ✅ Perfect | ✅ Perfect |
| Hot-path allocation | 0 | 1 object/tick | 0 |
| Convention fit | ✅ | ✅ Strongest | ✅ |
| Bundle size | Small | Medium | Tiny |
| Spitekeep fit | ⚠️ Still needs tween state | ✅ Matches advanceJump pattern | ❌ Too minimal |

## Recommendation

**Approach B: Curves + Stateless Tween Driver.**

Reasoning:

1. **Matches the library's existing pattern exactly.** `advanceTween(state, dt, config) → { state, value, done }` is structurally identical to `advanceJump(state, inputs, dt, config) → JumpState` and `advanceEmission(state, dt, config) → { next, spawnCount }`. The consumer already knows this pattern.

2. **Serves all three Spitekeep call sites.** The particle curves get `easeOutCubic(particleAge(p))` (direct curve import, no tween needed). The death zoom gets a tween with `easeOutCubic` + duration. The trap system gets a `resolveEasing` that maps string names to curve functions.

3. **The object allocation is a non-issue.** `advanceEmission` already allocates `{ next, spawnCount }` per call in the particle hot path. The `TweenResult` is the same shape. Modern V8 stack-allocates these. If profiling later shows a problem, we can add an output-parameter overload — but that's a v2 optimisation, not a v1 design constraint.

4. **Delay + yoyo + loops are table-stakes for any game tween.** Shipping curves without a tween driver forces every consumer to re-implement the same state machine. Approach B gives them the standard lifecycle (delay → forward → optional backward → loop → done) out of the box.

5. **Inversion helpers save code size.** `easeIn(outFn)` and `easeInOut(outFn)` are two lines each. They let us ship ~10 Out curves and derive all 30 In/InOut variants. This is cheaper than implementing 30 separate functions.

6. **Tree-shaking is preserved.** A consumer that only needs particle curves imports from `src/easing/curves.ts` — the tween driver is never pulled in. A consumer that needs tweening imports from `src/easing/tween.ts` too.

## Open Questions for @architect

1. **Should `done` fire at the forward-leg boundary or only at full completion?** My design: `done = true` only when all loops complete. For a `loops: 0, yoyo: true` tween, `done` fires after the backward pass (not after the forward pass). Consumer detects intermediate forward completion via `direction` change. This is consistent with Phaser/DOTween/Godot consensus.

2. **Should `advanceTween` accept negative `dt`?** I recommend clamping to 0 (silent no-op) rather than throwing, matching the pure-ops discipline. Negative dt would mean "time running backwards" which is undefined for yoyo/loop counting.

3. **Should we ship a `resolveEasing(name)` helper that maps string names to curve functions?** Spitekeep already has this pattern in `hidden-pit.ts`. A library-provided version would standardise the mapping across games. But it adds a string-switch that consumers could write themselves. I lean toward NOT shipping it — let consumers write their own `resolveEasing` with only the curves they need. This keeps the library focused on math, not dispatch.

4. **File structure: one file or two?** I propose `src/easing/curves.ts` (all curve functions + inversion helpers) and `src/easing/tween.ts` (TweenState + advanceTween + createTweenState). Separate files so consumers who only need curves don't pull in tween state types. Both re-exported from `src/easing/index.ts`.

5. **Should the tween config use `duration` (seconds) or `ticks`?** I recommend seconds, matching `advanceAccumulator`'s units. The consumer passes `fixedDt` (which is in seconds) as `dt`. If the consumer's game runs in tick units (like the particle presets), they multiply their tick count by `fixedDt` to get seconds, or adjust their `fixedDt` to 1. The JSDoc should document this clearly, matching the particle-preset units-contract pattern.
