# Decision: Mobile Directional Input (multi-touch-safe button set)

> **Decision record** for on-screen mobile directional input. Locks the API shape chosen for implementation. Supersedes the *proposed (pending decision)* markers in `docs/api-surface.md`.
>
> Slug: `mobile-directional-input`. Date: 2026-06-22.

## The technique

On-screen touch controls for mobile web play — the player steers with the left thumb (left/right) and jumps with the right thumb, simultaneously. The hard part is not "detect a touch"; it is **multi-touch pointer-ID isolation across multiple controls plus a global safety net that releases stuck buttons** when a pointer leaves the viewport without a clean `pointerup`.

## The chosen abstraction

**Ship a generic `createTouchButtonSet` — NOT a directional `createVirtualDpad`.** Source: `docs/design/mobile-directional-input-proposal.md` (2 architect loops, APPROVED).

`createTouchButtonSet(config)` takes an array of `HTMLElement | null` and returns one `PolledEdge` per element (array-aligned). The consumer maps indices to game actions via destructuring: `const [left, right, jump] = set.poll()`. It composes with `createKeyboardAdapter` + `orEdges` so keyboard and touch work simultaneously.

## Why generic, not directional

The genuinely-hard, reusable logic is **element-count-agnostic**:

- Per-element `Set<pointerId>` tracking with `0→≥1` press / `1→0` release transitions (so two fingers on one button don't double-fire, and lifting one of two fingers doesn't release).
- A **global safety net** on `document` listening to `pointerup`, `pointercancel`, AND `pointerleave` — the last is load-bearing: when a thumb swipes off the viewport edge, the browser fires `pointerleave` on the element but not `pointerup` on `window`, leaving the button stuck running the character forever.
- Per-element `touch-action: none` (without it, mobile scroll/zoom hijacks the touch and the game is unplayable).
- `typeof window === 'undefined'` SSR guard + never-throw defensive discipline.

None of that is specific to 4-way directional semantics. A directional `createVirtualDpad({up,down,left,right})` would bake "this is a D-pad" into the engine when **only one consumer** (the showcase playground) exists today, and the same adapter must also serve action buttons (jump), menu navigation, and any future multi-button layout. The generic shape centralizes the hard logic once and lets the consumer name things at the call site. A `createVirtualDpad` convenience wrapper can be added later (~15 lines on top of the set) if a second consumer wants the ergonomic shorthand.

## Why ship a new adapter at all (vs. documenting the composite)

The composite recipe — 4× `createTouchButton` + `orEdges` — works for the common case (separate elements, one finger each) but has two real failure modes that affect **every** consumer:

1. **`pointerleave` spurious release** — a thumb drifting off a button fires release + re-press, causing input stutter.
2. **No global safety net** — a missed `pointercancel`/viewport-exit `pointerleave` leaves a button stuck.

Centralizing the pointer-ID tracking + safety net prevents every future consumer from re-inventing it (and getting the `pointerleave` case wrong). the reference implementation's hand-rolled `TouchControls` is 414 lines including CSS/capability/DOM concerns; the reusable core the engine needs is ~120 lines — modest, but exactly the kind of edge-case-heavy logic that benefits from being written and tested once.

## What drove the decision

| Input | Contribution |
|---|---|
| `docs/research/mobile-directional-input.md` (@researcher) | Surveyed discrete D-pad, analog thumbstick, canvas-region patterns; flagged the analog→binary thresholding question and the multi-touch pointer-ID requirement as the load-bearing constraint. |
| Proposal, loop 1 (@api-designer) | Originally proposed directional `createVirtualDpad`. |
| Architect, loop 1 | Caught 6 gaps: inflated 414-line claim, missing `touchAction:none` (correctness), missing SSR guard, missing `pointerleave` in safety net (correctness), justification ordering, and — crucially — flagged the unaddressed generic-vs-directional shape question. |
| Proposal, loop 2 (@api-designer) | Resolved all 6; adopted the generic `createTouchButtonSet` shape (the architect's suggested middle ground). |
| Architect, loop 2 | APPROVED. Verified all fixes; ratified the generic shape; confirmed `createTouchButtonSet` fully subsumes what `createVirtualDpad` would have done. |
| No benchmark | Input adapter, not rendering — there is no PNG to compare. Verification is the TDD suite (pointer-event simulation) + the playground integration (item 2). |

## Locked API (for `src/input/touch-button-set.ts`)

**Types** (in `src/input/types.ts`): `TouchButtonSetConfig`, `TouchButtonSetAdapter`.

**Function** (in `src/input/touch-button-set.ts`): `createTouchButtonSet(config): TouchButtonSetAdapter`.

**Barrel:** re-export from `src/input/index.ts`.

**Return shape:** `poll()` returns `PolledEdge[]` aligned with the input element array. Consumer destructures: `const [left, right, jump] = set.poll()`.

## Invariants the test suite must lock

- **Pointer-ID isolation:** two simultaneous pointers on two different buttons each register independently; lifting one does not release the other.
- **Same-button multi-touch:** two pointers on the SAME button → one `held=true`; lifting one → still `held=true`; lifting both → `held=false` with a single `released` edge.
- **`0→≥1` press / `1→0` release transitions** are edge-latched correctly (no missed presses, no double-fires).
- **Global safety net:** a `pointerleave`/`pointercancel`/`pointerup` on `document` releases any button tracking that pointer (the stuck-button fix).
- **`touch-action: none`** set on each non-null element (test it's assigned).
- **SSR no-op:** `typeof window === 'undefined'` returns an adapter whose `poll()` returns idle `PolledEdge[]` of the right length and whose `dispose()` is a no-op.
- **Defensive:** null elements → that slot is an idle `PolledEdge`; all listener registration wrapped in try/catch; `dispose()` idempotent; never throws.
- **Composability:** output `PolledEdge`s OR-merge cleanly with keyboard via `orEdges`.

Tests run in the Node vitest env (no jsdom) — mock elements as plain objects with `addEventListener`/`removeEventListener`/`style` and dispatch pointer events through the registered handlers (mirror how `src/tests/input-touch-button.test.ts` works).

## Out of scope (deferred)

- **Analog thumbstick (`createThumbstick`).** The platformer's core is binary edges; an analog stick would threshold its own signal into binary — premature without a consumer that needs analog axes (top-down, racing). Defer until a second consumer arrives with real usage data.
- **Directional convenience wrapper (`createVirtualDpad`).** ~15 lines on top of `createTouchButtonSet`; add when a second consumer wants named-field ergonomics.

## Cross-references

- Proposal: `docs/design/mobile-directional-input-proposal.md`
- Research: `docs/research/mobile-directional-input.md`
- Composes with: `src/input/touch-button.ts` (`createTouchButton` — the single-button adapter; its multi-touch limitation is now documented in `docs/api-surface.md`), `src/input/edges.ts` (the deterministic edge core), `src/input/merge.ts` (`orEdges`)
- Parallel mobile work: `docs/design/dpr-canvas-proposal.md` (DPR helper), showcase viewport/CSS hardening
