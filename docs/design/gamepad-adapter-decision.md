# Decision: Gamepad Adapter

> Date: 2026-07-26. Stage 6 (Decide) for the `gamepad-adapter` technique.

## Decision

**Adopt Approach A from `docs/design/gamepad-adapter-proposal.md`: a defensive
`createGamepadAdapter(config)` factory that mirrors `createKeyboardAdapter`
exactly** — same `{ poll(): Record<string, PolledEdge>; dispose(): void }`
shape, same lazy-host-resolution / swallow-errors / never-throw / Node-SSR-`{}`
fallback discipline, same idempotent `dispose()`. It is a drop-in third input
device that OR-merges with keyboard + touch via the existing `orEdges`.

## Rationale

The research note (`docs/research/gamepad-adapter.md`) confirms the W3C Gamepad
API is purely poll-based (`navigator.getGamepads()` must be re-fetched each
frame; gamepads only appear after a user gesture), and that the library's
existing input layer already owns the deterministic binary edge-accumulator
core (`edges.ts`) and the defensive-adapter pattern (`keyboard.ts`,
`touch-button.ts`). A gamepad adapter that mirrors `createKeyboardAdapter`
slot~in with near-zero new conceptual surface: it resolves `navigator`
lazily, applies an **axial per-axis threshold deadzone** (0.25) to analog axes,
latches button-state diffs and axis-threshold crossings into per-action
`EdgeAccumulator`s, and `resetEdge`s on disconnect (stuck-button safety). The
`@architect` returned **APPROVED** after one revision loop (loop 1 raised one
blocker — the deadzone was mislabeled "scaled radial" when the per-axis config
shape actually implements axial; loop 2 confirmed the rename + 3 minors
resolved, no regressions). No benchmark is needed: this is an input adapter
with no visual output.

Approach B (event-free / poll-only) was rejected — it drops the
connect/disconnect safety net and pushes disconnect-cleanup onto every
consumer, violating the defensive-adapter contract. Approach C (configurable
`deadzoneStyle` + `onVector` analog hook) was rejected as premature surface
with no existing consumer demand; both can be added additively later.

## Resolved questions (binding for implementation)

1. **Single-pad v1:** `createGamepadAdapter()` binds to `getGamepads()[0]`.
   Consumer creates a second adapter for player 2. Multi-pad index deferred.
2. **Threshold-latching only:** analog sticks latch `pressed`/`released` edges
   on deadzone threshold crossing — composes with the binary `EdgeAccumulator`
   + `orEdges`. A continuous `onVector` analog output is deferred (additive).
3. **Axial per-axis threshold deadzone, default 0.25** (`DEFAULT_GAMEPAD_DEADZONE`).
   v1 ships **axial only** — the per-axis `axisToAction` config cannot express
   stick pairing; true scaled-radial (via a future `deadzoneStyle:
   'scaled-radial'` + `stickToAction` config) is deferred.
4. **Rumble deferred to v2** (Chrome-only as of 2026; adds a second host surface).
5. **`timestamp` change-detection always-on** (cache `lastTimestamp` +
   `lastSnapshot`; skip re-diff when `pad.timestamp === lastTimestamp &&
   pad.timestamp !== 0`; Firefox `timestamp === 0` always re-diffs). Pure
   optimization; timestamp never feeds simulation state.
6. **Non-standard mapping → warn-once + no-op** (`console.warn` includes full
   gamepad `id`); consumer falls back to keyboard/touch.
7. **SSR guard:** `typeof navigator === 'undefined' || typeof
   navigator.getGamepads !== 'function'` → `{ poll: () => ({}), dispose: () => {} }`.

## Locked API shape (from proposal + architect)

- `poll()` returns `Record<string, PolledEdge>` (matches `KeyboardAdapter`).
- `buttonToAction: Record<string, string>` (string keys, matches
  `KeyboardConfig.codeToAction`).
- `axisToAction: Record<string, AxisBinding>` with `AxisBinding = {
  positive?: string; negative?: string }` — BOTH optional; silently skip
  entries where neither is set.
- `AxisBinding` is a named interface.
- `dispose()` uses `if (disposed) return; disposed = true;` (mirrors keyboard).
- `EdgeAccumulator` interface UNCHANGED — adapter consumes
  `createEdgeAccumulator`/`pressEdge`/`releaseEdge`/`resetEdge`/`pollEdge`.

## Scope (v1)

- `src/input/gamepad.ts` — `createGamepadAdapter`, `DEFAULT_GAMEPAD_DEADZONE`, `AXIS_THRESHOLD` (if separate). `@module` header.
- `src/input/types.ts` — add `GamepadConfig`, `AxisBinding`, `GamepadAdapter` (additive; existing types untouched).
- `src/input/index.ts` — re-export the new public surface.
- `src/tests/gamepad.test.ts` — TDD with a mocked `navigator.getGamepads` (follow the `input-keyboard.test.ts` fake-host pattern): button press/release edge latching + coalescing (full press+release between polls surfaces BOTH), axis threshold crossing → edge, deadzone application, `mapping !== 'standard'` warn-once no-op, disconnect → `resetEdge`, `timestamp` short-circuit, SSR `{}` fallback, never-throw, idempotent `dispose`.
- `src/tests/barrel-contract.test.ts` — add gamepad assertions.
- `docs/api-surface.md` — flip the 5 gamepad exports from `(proposed)` to shipped.
- `README.md` — update the Input row to mention gamepad.

## Inputs that drove this decision

- `docs/research/gamepad-adapter.md` (W3C API, deadzone math, engine prior art).
- `docs/design/gamepad-adapter-proposal.md` (Approach A, revised).
- `@architect` critique loop 1 (NEEDS REVISION) + loop 2 (APPROVED).
