# Decision: Easing & Tween

> Date: 2026-07-26. Stage 6 (Decide) for the `easing-tween` technique.

## Decision

**Adopt Approach B from `docs/design/easing-tween-proposal.md`: a pure-function
curve module (`curves.ts`) plus a stateless, fixed-step tween driver (`tween.ts`).**

## Rationale

The research note (`docs/research/easing-tween.md`) confirms the Robert Penner
easing equations are pure functions of `t ∈ [0,1]` — no `Math.random`, no
`Date.now`, no host reads — so they sit cleanly in the deterministic core and
satisfy the library's determinism discipline. The library already pays the
conceptual cost of the pure-progression-ops pattern
(`advanceJump`, `advanceEmission` both take `(state, dt, config) → { state, … }`),
so a stateless `advanceTween(state, dt, config) → { state, value, done }` is
structurally identical to patterns the consumer already knows — the marginal
complexity is near zero. The `@architect` critique returned **APPROVED** across
all dimensions (determinism, layer separation, zero-dep, pure-progression-ops,
public-API stability, scope). No benchmark was required: this is pure math with
no visual output to compare (the architect noted accessibility/visual N/A).

Approach A (curves only, no driver) was rejected because three real the reference implementation
call sites — particle lifetime curves, death-zoom tween, trap easing — all need
the driver; shipping curves alone would force every consumer to reimplement the
same fixed-step tween state machine. Approach C (minimal curves) was rejected as
too thin (back/elastic/bounce are needed for game feel).

## Resolved questions

Carried from the proposal + architect verdicts (binding for implementation):

1. **Curve subset (v1):** ship named Out curves — `linear`, `easeOutQuad`,
   `easeOutCubic`, `easeOutQuart`, `easeOutQuint`, `easeOutSine`, `easeOutExpo`,
   `easeOutCirc`, `easeOutBack`, `easeOutElastic`, `easeOutBounce` — plus a
   generic `powOut(t, n)` and `easeIn(f)` / `easeInOut(f)` inversion helpers
   (derive In/InOut from Out; do not hand-write all 31).
2. **Tween state ownership:** consumer-owned `TweenState` passed to a pure
   `advanceTween`. No factory object with methods.
3. **`advanceTween` return shape:** `{ state, value, done }` (matches
   `advanceEmission`'s `{ next, spawnCount }`).
4. **`done` semantics:** fires only on full lifecycle completion (all loops +
   optional yoyo backward pass), not at the forward-leg boundary. Consumers
   detect intermediate leg completion via `state.direction` flipping.
5. **Negative `dt`:** clamp to 0, silent no-op (never throw).
6. **No `resolveEasing(name)` dispatcher** — consumer-side concern.
7. **File structure:** two files — `curves.ts` (pure curves) + `tween.ts`
   (driver + state) — for tree-shaking (particle users import curves only).
8. **Config units:** seconds (matches `advanceAccumulator`'s `fixedDt`).

## Implementation notes (from architect objections — @coder must address)

- **Delay initialization contract:** specify and document how `state.delay` is
  seeded from `config.delay`. Recommended: `createTweenState(config?)` accepts
  the config so delay is initialized once; `advanceTween` then only counts it
  down. Document this explicitly in JSDoc.
- **`duration ≤ 0` edge case:** degrade gracefully — snap to `value: 1,
  done: true` on the first advance, never divide by zero, never throw.
  Document in JSDoc.
- **`easeOutElastic` JSDoc:** name the frequency constant ("13 half-cycles with
  exponential decay") for consistency with `easeOutBack`'s named `s = 1.70158`.
- **Penner constants** (`1.70158`, `13`, bounce piecewise coefficients) are
  mathematical definitions, not tunables — inline with a named rationale comment
  is acceptable (precedent: `oscillators.ts` inline `Math.PI * 2`).

## Scope (v1)

- `src/easing/curves.ts` — pure curve functions + `powOut` + inversion helpers.
- `src/easing/tween.ts` — `TweenState`, `TweenConfig`, `createTweenState`,
  `advanceTween`.
- `src/easing/index.ts` — barrel.
- `src/index.ts` — add `export * from './easing'`.
- `src/tests/easing-curves.test.ts` + `src/tests/easing-tween.test.ts` — TDD:
  curve endpoints/monotonicity/bounce-clamp; tween completion, yoyo, loops,
  delay, `duration ≤ 0`, negative `dt`, determinism (same inputs → identical
  output).
- `docs/api-surface.md` — flip the easing section from `(proposed)` to shipped.

## Inputs that drove this decision

- `docs/research/easing-tween.md` (prior art + math).
- `docs/design/easing-tween-proposal.md` (Approach B).
- `@architect` critique (APPROVED, 3 doc-completeness objections).
