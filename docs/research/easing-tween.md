# Easing & Tween

> Research note for one-shot easing curves and tween drivers. Slug: `easing-tween`.
> Investigated: 2026-07-26.

## TL;DR

The library has `lerp`/`approach` for scalar interpolation and repeating oscillators (`bob`, `pulse`, `sineShake`), but lacks the two building blocks that game UI and gameplay animations need most: **one-shot `[0,1]→[0,1]` easing curves** (easeOutCubic, easeOutBack, easeOutElastic, easeOutBounce) and a **minimal tween driver** that advances a value from start→end over a duration under the fixed-step loop. This note surveys the canonical Robert Penner easing equations (the math behind back/elastic/bounce), the tween-driver lifecycles in Phaser, Unity DOTween, and Godot, the determinism implications of fixed-step vs variable-dt tween advancement, and compact demoscene/js13k easing patterns. The top recommendation is to ship a **pure-function easing module** (no state, no deps) and a **stateless tween-advance function** that mirrors the library's pure-progression-ops discipline — the consumer owns the tween state; the engine provides the math.

## Why this matters for aicraft-engine

- **Pillars Touched**: Directly extends **Pillar 1 (Primitives / Animation)**. Complements the existing oscillators and the blend/lerp modules.
- **Consumer Games**: Spitekeep (death animations, UI transitions, card flip), any future Clone-to-Jest title (menu transitions, particle curve evaluation, hit-feedback easing). The particle-emitters research note already identified that particle lifetime curves (`evaluateAlphaCurve`, `evaluateSizeCurve`) need easing functions beyond linear lerp.
- **Unlocks**:
  - **One-shot animation curves** for UI, card transitions, hit feedback, and procedural motion that goes beyond linear or sine-based interpolation.
  - **Tween-driven state progression** that is replay-deterministic under the fixed-step loop — critical for save replays and deterministic gameplay.
  - **Compact curve library** that fits the zero-dep, zero-allocation philosophy (every curve is a pure `(t: number) => number` function).

---

## Prior Art Survey

### Pattern 1: Robert Penner Easing Equations (The Canonical Set)

- **Source**: Robert Penner's *Programming Macromedia Flash MX* (2002); open-source since ~2001; widely re-implemented in easings.net (Andrey Sitnik), mattdesl/eases, Phaser, Godot, Unity. The equations are public-domain-equivalent — Penner released them explicitly for unrestricted use.
- **What it does**: A family of 31 functions (30 curves + linear), each mapping `t ∈ [0,1]` to a value that may overshoot or oscillate. Grouped into: `quad`, `cubic`, `quart`, `quint` (power curves), `sine`, `expo`, `circ` (trig/exp), `back` (overshoot), `elastic` (spring oscillation), `bounce` (floor-bounce simulation). Each has `In`, `Out`, and `InOut` variants.
- **Algorithmic shape** (the non-trivial curves, from mattdesl/eases — MIT licensed):

```typescript
// easeOutBack — overshoots past 1.0 then settles
function easeOutBack(t: number): number {
  const s = 1.70158;
  const t1 = t - 1;
  return t1 * t1 * ((s + 1) * t1 + s) + 1;
}

// easeOutElastic — oscillates with exponential decay
function easeOutElastic(t: number): number {
  return Math.sin(-13 * (t + 1) * Math.PI / 2) * Math.pow(2, -10 * t) + 1;
}

// easeOutBounce — piecewise quadratic bounce simulation
function easeOutBounce(t: number): number {
  const a = 4 / 11;
  const b = 8 / 11;
  const c = 9 / 10;
  const ca = 4356 / 361;
  const cb = 35442 / 1805;
  const cc = 16061 / 1805;
  const t2 = t * t;
  return t < a
    ? 7.5625 * t2
    : t < b
      ? 9.075 * t2 - 9.9 * t + 3.4
      : t < c
        ? ca * t2 - cb * t + cc
        : 10.8 * t * t - 20.52 * t + 10.72;
}

// easeInOutBack — doubled-back overshoot for symmetric motion
function easeInOutBack(t: number): number {
  const s = 1.70158 * 1.525;
  if ((t *= 2) < 1) return 0.5 * (t * t * ((s + 1) * t - s));
  const t2 = t - 2;
  return 0.5 * (t2 * t2 * ((s + 1) * t2 + s) + 2);
}
```

- **Determinism profile**: Pure functions of `t`. No `Math.random`, no `Date.now()`, no global state. Fully deterministic. Same `t` always yields same output.
- **Runtime cost**: 1–4 multiplications + 1 `Math.sin` + 1 `Math.pow` per call. Negligible — O(1) per curve evaluation.
- **Dependencies**: None. Only `Math.sin` and `Math.pow` from the standard library.
- **Fit for our constraints**: **Strong.** These are the gold standard. They are already battle-tested in every major game engine and browser. The math is simple enough to inline.
- **What to steal**: The specific constant values (1.70158 for back, 13 for elastic frequency, the four-segment piecewise coefficients for bounce) are tuned by decades of use. Don't invent new ones. The naming convention (`easeOutCubic`, `easeInBack`) is universal.
- **What to avoid**: Don't ship all 31 curves. Games overwhelmingly use only ~10. Ship a curated subset and let consumers compose the rest via `In`/`Out`/`InOut` inversion patterns (`easeInX(t) = 1 - easeOutX(1 - t)`, `easeInOutX(t) = t < 0.5 ? 0.5*easeInX(2t) : 0.5*easeOutX(2t-1) + 0.5`).

### Pattern 2: Tween Drivers (Phaser / DOTween / Godot Lifecycle)

- **Source**: Phaser 3 Tween.js (MIT), Unity DOTween (free for personal/commercial), Godot 4 Tween (MIT)
- **What it does**: A tween driver manages the lifecycle of animating a value (or set of values) from a start to an end over a duration, with optional delay, yoyo, loop, and easing. The key insight across all three engines is that a tween is **stateful** — it tracks elapsed time, progress, loop counter, and completion status.

**Common lifecycle across Phaser, DOTween, Godot:**

```typescript
// Shared tween state (what ALL engines track internally):
interface TweenState {
  elapsed: number;        // accumulated time in current loop iteration
  progress: number;       // [0,1] normalized progress through current iteration
  loopCount: number;      // remaining loops (-1 = infinite)
  state: 'pending' | 'active' | 'delayed' | 'yoyo' | 'complete' | 'destroyed';
  hasStarted: boolean;    // false during initial delay
}
```

**Key lifecycle transitions (Phaser source, line-by-line verified):**

1. **PENDING → ACTIVE**: When start delay expires (`countdown <= 0`), set `hasStarted = true`, emit `onActive`.
2. **ACTIVE**: Each `update(delta)` advances `elapsed += delta`, computes `progress = elapsed / duration`, evaluates easing on progress, applies value to target.
3. **ACTIVE → YOYO**: When `progress >= 1` and `yoyo === true`, reverse direction, reset elapsed, decrement loop counter.
4. **ACTIVE → LOOP**: When `progress >= 1` and `repeat > 0`, reset elapsed, decrement loop counter, optionally wait for `loopDelay`.
5. **ACTIVE → COMPLETE**: When `progress >= 1` and no more loops, emit `onComplete`.
6. **COMPLETE → REMOVED**: Unless `persist === true`, the tween is garbage-collected.

**Determinism-critical observation**: Phaser's `Tween.update(delta)` multiplies delta by `timeScale * parent.timeScale` — a non-deterministic modifier. Our tween driver must NOT have a time scale. The consumer controls determinism by passing `dt` from the fixed-step loop.

- **Algorithmic shape** (the pure-advance function we should extract):

```typescript
// What the consumer stores (their state):
interface TweenState {
  elapsed: number;      // accumulated seconds
  direction: 1 | -1;    // 1 = forward, -1 = backward (yoyo)
  loopCount: number;    // remaining loops
  started: boolean;
}

// What the engine provides (pure function):
function advanceTween(
  state: TweenState,
  dt: number,                    // from fixed-step loop
  config: { duration: number; ease: (t: number) => number; yoyo?: boolean; loops?: number }
): { state: TweenState; value: number; done: boolean } {
  let { elapsed, direction, loopCount, started } = state;
  elapsed += dt;
  const t = Math.min(elapsed / config.duration, 1);
  const eased = config.ease(direction === 1 ? t : 1 - t);

  if (t >= 1) {
    elapsed -= config.duration;
    if (config.yoyo) direction = (direction === 1 ? -1 : 1) as 1 | -1;
    if (loopCount > 0) loopCount--;
    started = true;
    if (loopCount === 0 && !config.yoyo) {
      return { state: { elapsed: 0, direction: 1, loopCount: 0, started: true }, value: 1, done: true };
    }
  }

  return {
    state: { elapsed, direction, loopCount, started: true },
    value: eased,
    done: false,
  };
}
```

- **Determinism profile**: Pure when `dt` comes from the fixed-step loop. No `Math.random`, no `Date.now()`. Fully deterministic.
- **Runtime cost**: O(1) per advance call.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong** — but the API shape is the hard part. See Open Questions.
- **What to steal**: The universal `progress = elapsed / duration` normalization. The yoyo direction-flip pattern. The loop counter pattern from Phaser.
- **What to avoid**: Don't store target objects or property keys (that's Phaser/DOTween's domain). Our library is about **value** tweening, not property tweening. The consumer applies the value to whatever they want.

### Pattern 3: Fixed-Step vs Variable-dt Tween Determinism

- **Source**: Game loop literature; our own `src/game-loop/fixed-step.ts`; Phaser's `Tween.update(delta)` which receives variable-rate delta from the frame clock.
- **What it does**: The critical determinism distinction:
  - **Variable-dt** (Phaser/Godot default): `tween.update(frameDelta)` where `frameDelta` varies per frame. The tween's elapsed time depends on frame rate. Two machines at different FPS will produce different intermediate values at the same wall-clock time. NOT replay-deterministic.
  - **Fixed-dt** (our model): The consumer calls `advanceTween(state, FIXED_DT, config)` inside the `step(fixedDt)` callback of `advanceAccumulator`. The tween receives exactly `1/60` seconds per call. Two machines at different FPS run different numbers of steps but each step produces identical state transitions. **Replay-deterministic.**

**The determinism contract:**

```
fixed-step loop calls step(1/60) N times
  → each call advances all active tweens by exactly 1/60 seconds
  → each tween's state transition is a pure function of (prevState, 1/60, config)
  → same inputs → same outputs → replay-deterministic ✓
```

- **Determinism profile**: N/A — this is a design principle, not code.
- **Runtime cost**: N/A.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong** — this IS our constraint. The tween driver must be designed for fixed-step consumption.
- **What to steal**: The accumulator pattern from `advanceAccumulator`. The tween driver should be called INSIDE the step callback, never outside it.
- **What to avoid**: Don't provide a `tween.update(wallClockDelta)` API. The consumer must never pass a variable delta to the tween advance function.

### Pattern 4: Compact Easing Patterns (Demoscene / JS13k / Generative Art)

- **Source**: mattdesl/eases (MIT), demoscene 4KB intros, p5.js easing, generative art patterns
- **What it does**: Under extreme size constraints, developers use shorthand easing patterns that are mathematically equivalent to Penner's equations but expressed more compactly.

**Key compact patterns:**

```typescript
// "Power" easing — replaces quad/cubic/quart/quint with a single parameter
function easeOutPow(t: number, n: number): number {
  return 1 - Math.pow(1 - t, n);
}

// This single function covers:
//   n=2 → easeOutQuad
//   n=3 → easeOutCubic
//   n=4 → easeOutQuart
//   n=5 → easeOutQuint

// Bounce decomposition — the piecewise segments are quadratic parabolas
// Each bounce segment is: -k*(t - a)^2 + b where k, a, b are precomputed
// The mattdesl/eases coefficients (4/11, 8/11, 9/10) are the canonical set

// Elastic shorthand — single-line sinusoidal with exponential decay
function easeOutElasticSimple(t: number): number {
  return Math.sin(-13 * (t + 1) * Math.PI / 2) * Math.pow(2, -10 * t) + 1;
}

// Inversion patterns (save ~15 functions by deriving In/InOut from Out):
// easeInX(t)  = 1 - easeOutX(1 - t)
// easeInOutX(t) = t < 0.5 ? 0.5 * easeInX(2*t) : 0.5 * easeOutX(2*t - 1) + 0.5
```

- **Determinism profile**: Pure functions. Fully deterministic.
- **Runtime cost**: O(1). The `Math.pow` call is the most expensive (~3ns on modern hardware).
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** The power-easing pattern is particularly valuable — it replaces 4 separate quad/cubic/quart/quint functions with a single parameterized function, saving code size while giving consumers more control.
- **What to steal**: The `easeOutPow(t, n)` pattern. The In/InOut derivation formulas. The observation that `bounceOut` is the only curve that needs piecewise segments — all others are closed-form.
- **What to avoid**: Don't over-parameterize. The back constant (1.70158) and elastic frequency (13) are tuned values that should be baked in as named functions, not exposed as parameters.

---

## Easing Curve Math Summary

### Simple curves (power-based)
```
easeOutQuad:   1 - (1-t)²
easeOutCubic:  (t-1)³ + 1
easeOutQuart:  -(t-1)⁴ + 1
easeOutQuint:  (t-1)⁵ + 1
```
All are special cases of `1 - (1-t)^n` for n=2,3,4,5.

### easeOutBack (overshoot)
Uses a "back" constant `s = 1.70158` that controls how far past 1.0 the curve overshoots:
```
easeOutBack(t) = (t-1)² * ((s+1)(t-1) + s) + 1
```
The `s` constant represents the "pullback" before the overshoot — the curve goes backward first (for `easeIn`), then shoots past the target. For `easeInOut`, the constant is scaled to `s * 1.525`.

### easeOutElastic (spring oscillation)
Combines a sinusoidal oscillation with exponential decay:
```
easeOutElastic(t) = sin(-13π(t+1)/2) * 2^(-10t) + 1
```
- `sin(-13π(t+1)/2)` provides the oscillation (13 half-cycles)
- `2^(-10t)` provides exponential decay (reaches ~0.1% at t=1)
- The result overshoots ~1.03 at t≈0.1 and oscillates with diminishing amplitude

### easeOutBounce (piecewise quadratic)
Four quadratic segments that simulate a ball bouncing to rest:
```
Segment 1 (t < 4/11):    7.5625t²
Segment 2 (t < 8/11):    9.075t² - 9.9t + 3.4
Segment 3 (t < 9/10):    (4356/361)t² - (35442/1805)t + 16061/1805
Segment 4 (t ≥ 9/10):    10.8t² - 20.52t + 10.72
```
The piecewise constants ensure C0 continuity (no jumps) and approximate C1 continuity (smooth first derivative) at each segment boundary. This is the ONLY easing curve that cannot be expressed as a single closed-form expression.

---

## Reference Implementations

| Source | What it teaches | URL |
|---|---|---|
| **mattdesl/eases** | Clean, minimal, MIT-licensed easing functions in JS. One function per file. Perfect reference for our module structure. | https://github.com/mattdesl/eases |
| **easings.net** | Visual cheat sheet for all 31 Penner curves. Essential for verifying our implementations visually. | https://easings.net/ |
| **Phaser 3 Tween.js** | Full tween lifecycle: delay, yoyo, loop, hold, progress tracking. Shows the state machine we need to simplify. | https://github.com/phaserjs/phaser/blob/master/src/tweens/tween/Tween.js |
| **Unity DOTween docs** | API design patterns for tween configuration (SetLoops, SetEase, OnComplete). Shows what consumers expect. | https://dotween.demigiant.com/documentation.php |
| **Godot 4 Tween** | Minimal tween API: `create_tween().tween_property(target, property, end, duration).set_ease(Tween.EASE_OUT)`. Shows the simplest possible driver. | https://docs.godotengine.org/en/stable/classes/class_tween.html |

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Easing curves cheat sheet | All 31 Penner curves visualized on a single graph | https://easings.net/ |
| Phaser tween visualizer | Live demo of tween lifecycle with delay/yoyo/loop | https://labs.phaser.io/index.html?dir=tweens/ |
| DOTween showcase | Real game screenshots showing tween-driven UI animations | https://dotween.demigiant.com/showcase.php |

---

## Open Questions

1. **Curve subset for v1**: Which curves to ship? The research suggests ~10 named functions covering: `linear`, `easeOutQuad`, `easeOutCubic`, `easeOutBack`, `easeOutElastic`, `easeOutBounce`, and their In/InOut variants. But should we also ship a generic `powOut(t, n)` for custom power curves? The `powOut` pattern is trivial (one line) but gives consumers full control over the power curve family.

2. **Tween state ownership**: Should the engine provide a `TweenState` type that the consumer owns and passes to `advanceTween`, or should the engine provide a factory (`createTween(config)`) that returns an object with `advance(dt)` and `value` methods? The library's pure-progression-ops discipline strongly favors the former (consumer owns state, engine provides pure functions), but the latter is more ergonomic. This is a design decision for `@api-designer`.

3. **Delay support**: Should the tween driver support an initial delay (time before the tween starts advancing)? Phaser and DOTween both support this. For a fixed-step driver, delay means "decrement a countdown timer before the tween begins." It's trivial to implement but adds a field to the state object.

4. **Yoyo semantics**: When a yoyo tween completes a forward+backward cycle, does that count as one loop or two? Phaser counts it as one loop (forward+backward = one iteration). DOTween counts it as one loop. Godot counts it as one loop. Consensus: one loop = forward + (optional backward if yoyo). This should be documented clearly.

5. **Value type**: Should `advanceTween` return a raw `number`, or should it return `{ value: number; done: boolean; state: TweenState }`? The compound return is more ergonomic but allocates an object per call. Given this is in the hot path (called every fixed step), the API-designer should consider whether to return a tuple, a pre-allocated output object, or separate the "advance" and "read value" calls.

---

## Top 3 Patterns Worth Prototyping

1. **Pure easing function module** — Ship a barrel of `(t: number) => number` functions following the mattdesl/eases pattern (one function, one export, zero state). Include `easeOutCubic`, `easeOutBack`, `easeOutElastic`, `easeOutBounce` as named exports, plus `powOut(t, n)` for the generic power curve. Derive In/InOut variants via the inversion formulas. This is the foundation everything else builds on.

2. **Stateless `advanceTween` pure function** — A function that takes `(prevState, dt, config)` and returns `{ nextState, value, done }`. Consumer owns the state object. Designed to be called inside `step(fixedDt)` of the fixed-step loop. Yoyo, loop count, and delay are config-driven. This mirrors the pure-progression-ops discipline from `docs/architecture.md` and the `advanceEmitter` pattern from the particle-emitters research.

3. **Inversion formula helpers** — Ship `easeIn(outFn)` and `easeInOut(outFn)` higher-order functions that transform any Out-curve into its In and InOut variants. This means we only need to implement ~10 Out curves and get all 30 for free. The math is 2 lines each: `easeIn(f) = (t) => 1 - f(1 - t)` and `easeInOut(f) = (t) => t < 0.5 ? 0.5 * easeIn(f)(2*t) : 0.5 * f(2*t - 1) + 0.5`.

---

## Cross-References

- `docs/architecture.md` — Layer separation (easing functions belong in deterministic core; tween driver is deterministic core if `dt` comes from fixed-step loop)
- `docs/conventions.md` — Pure progression ops, no magic numbers, JSDoc requirements
- `src/primitives/pixel.ts` — Existing `lerp`, `clamp`, `approach` (easing curves are complementary, not overlapping)
- `src/animation/oscillators.ts` — Existing repeating oscillators (easing curves are one-shot, not repeating)
- `src/game-loop/fixed-step.ts` — The fixed-step accumulator that the tween driver must integrate with
- `src/blend/lerp.ts` — Pose interpolation (uses lerp; easing curves would be the natural extension)
- `docs/research/particle-emitters.md` — Already identified the need for easing curves in particle lifetime evaluation (`evaluateAlphaCurve`, `evaluateSizeCurve`)
