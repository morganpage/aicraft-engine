# API Proposal: Mobile Directional Input

> Target pillar: 1 (Primitives). Module: `src/input/`.
> Builds on research: `docs/research/mobile-directional-input.md`.
> Status: DRAFT (revision 2 — addresses architect critique, 6 objections).

## Consumer Need

Spitekeep (and future Clone-to-Jest siblings) need on-screen directional input for mobile web play (Poki, CrazyGames). Today, Spitekeep hand-rolls a `TouchControls` class (`src/input/touch.ts`) with pointer-ID tracking, CSS injection, capability detection, and multi-touch safety nets. The full class is 414 lines including CSS injection (~60 lines), touch-capability detection via `matchMedia` (~15 lines), DOM button creation and layout (~50 lines), class architecture boilerplate, and the reusable pointer-ID tracking core (~120 lines). The engine needs only the reusable core — the hard, multi-touch-safe logic that tracks per-button pointer sets and provides a global safety net.

The core consumer need: a player holds "right" with their left thumb and taps "jump" with their right thumb. Both inputs must register independently, without the second finger's release clearing the first finger's held state. This is the **load-bearing mobile constraint**.

But the stronger justifications — which affect every consumer, not just those with 4-direction D-pads — are:

1. **The `pointerleave` spurious-release bug.** When a thumb drifts off a button element, `pointerleave` fires and releases the held state. If the finger re-enters, `pointerdown` fires a press. The consumer sees a spurious released+pressed edge pair on the next poll — the character momentarily stops and restarts. This is a real bug in the existing `createTouchButton` adapter (`src/input/touch-button.ts:65`), which treats `pointerleave` as a release.
2. **The missing global safety net.** If a finger leaves the browser viewport entirely (swipe to notification bar, edge gesture, OS interruption), the browser fires `pointerleave` on the element but NOT `pointerup`/`pointercancel` on `window`. The per-element handler may miss the event (browser quirk, rapid event ordering). Without a global fallback, the button stays stuck — the character walks right indefinitely. Spitekeep's `TouchControls` handles this with a window `pointerup`/`pointercancel` listener (lines 214-215), but `createTouchButton` does not.
3. **Multi-touch pointer-ID isolation.** Two fingers on the same button element causes the second finger's release to clear the held state, even though the first finger is still down. This is the "cross-talk on same element" bug that pointer-ID tracking solves.

## Approach A: Documented Composite (No New Code)

**Source pattern:** Composite Virtual D-Pad (research §Pattern 1), combined with the existing `createTouchButton` + `orEdges` pipeline.

**Concept:** The consumer creates N DOM elements, wires each via `createTouchButton`, and OR-merges each with its keyboard counterpart via `orEdges`. No new engine code. The engine documents this recipe in `docs/integration.md` and provides a worked example.

**Signature sketch:** No new exports. Existing API only:

```ts
// Consumer code — no engine changes needed
import { createTouchButton, orEdges, createKeyboardAdapter } from 'aicraft-engine/src/input';

const kb = createKeyboardAdapter({ codeToAction: { ArrowLeft: 'left', ArrowRight: 'right' } });
const touchLeft = createTouchButton(document.getElementById('btn-left'));
const touchRight = createTouchButton(document.getElementById('btn-right'));

// Once per tick:
const kbPoll = kb.poll();
const left = orEdges(kbPoll['left'], touchLeft.poll());
const right = orEdges(kbPoll['right'], touchRight.poll());
```

**Trade-offs:**
- **Ergonomics (consumer-developer):** Medium. Requires N DOM elements, N× `createTouchButton`, N× `orEdges`. ~20 lines of boilerplate per direction. Acceptable for a one-time setup.
- **Ergonomics (player):** Depends entirely on consumer's DOM layout. Engine provides no guidance on button sizing, positioning, or hit-padding.
- **Determinism:** Correct. Each `createTouchButton` owns one `EdgeAccumulator`; `pollEdge` drains once per tick. Same determinism as the existing pipeline.
- **Multi-touch robustness:** **Weak.** `createTouchButton` does not track pointer IDs. Two fingers on the same button causes the second finger's release to clear the held state. For separate elements (left thumb on "right", right thumb on "jump") this is fine — the common case works. But it fails on same-button multi-touch and lacks a global safety net for pointers that leave the element without a clean `pointerup`.
- **Scope risk:** Zero. No new code.
- **Convention fit:** Perfect. Uses existing primitives exactly as designed.
- **Tree-shakeability:** N/A (no new exports).

**What this makes easy:** Quick mobile prototyping with zero engine changes. A consumer who only needs left+right+jump can wire it up in 30 minutes.

**What this makes hard:** Every consumer re-invents pointer-ID tracking if they discover the multi-touch bug. The bug is subtle — it only manifests when two fingers touch the same button, which is rare but real (e.g., a player accidentally double-taps a direction button). The recipe also provides no guidance on the `pointerleave` spurious-release bug, the global `pointerup`/`pointercancel` safety net, or button layout/hit-padding.

## Approach B: Generic `createTouchButtonSet` (Multi-Touch-Safe Button Group)

**Source pattern:** Spitekeep's `TouchControls` (`src/input/touch.ts`) — the proven multi-touch pointer-ID tracking pattern, extracted into a generic, element-count-agnostic adapter.

**Concept:** A first-class adapter that takes an array of DOM elements (or nulls for missing slots) and returns a multi-touch-safe button set. Internally tracks `pointerId` sets per element (matching Spitekeep's `pointersByButton` pattern), fires pressed/released on 0→≥1 / 1→0 pointer transitions, and installs a global safety net for `pointerup`/`pointercancel`/`pointerleave` on `document`. The adapter is **direction-agnostic** — it handles N buttons, not hardcoded to 4 directions. The consumer maps positional results to directional semantics.

**Why generic wins over directional:** The genuinely hard, reusable logic — multi-touch pointer-ID tracking, per-element accumulator management, and the global safety net — is element-count-agnostic. A directional `createVirtualDpad` would bake 4-way semantics into the engine when only one consumer exists today. The generic `createTouchButtonSet` captures the hard part once, and the consumer composes directions from it (via a thin wrapper or inline mapping). If a second consumer needs the ergonomic shorthand, the engine can add `createVirtualDpad` as a convenience wrapper that calls `createTouchButtonSet` internally.

**Signature sketch:**

```ts
// In src/input/touch-button-set.ts

export interface TouchButtonSetConfig {
  /** DOM elements for each button. Null entries produce idle edges. */
  elements: readonly (HTMLElement | null)[];
}

export interface TouchButtonSetAdapter {
  /** Drain all accumulators. Returns array matching input element order. */
  poll(): readonly PolledEdge[];
  /** Remove all listeners, clear pointer maps, reset accumulators. Idempotent. */
  dispose(): void;
}

export function createTouchButtonSet(config: TouchButtonSetConfig): TouchButtonSetAdapter;
```

**Usage example (directional D-pad):**

```ts
import {
  createTouchButtonSet,
  createKeyboardAdapter,
  orEdges,
} from 'aicraft-engine/src/input';

// Consumer maps positions to directions
const dpad = createTouchButtonSet({
  elements: [
    document.getElementById('btn-left'),   // index 0 → left
    document.getElementById('btn-right'),  // index 1 → right
    document.getElementById('btn-up'),     // index 2 → up
    document.getElementById('btn-down'),   // index 3 → down
  ],
});

const kb = createKeyboardAdapter({
  codeToAction: {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    Space: 'jump',
  },
});

// Once per fixed tick:
const kbPoll = kb.poll();
const [touchLeft, touchRight, touchUp, touchDown] = dpad.poll();
const left = orEdges(kbPoll['left'], touchLeft);
const right = orEdges(kbPoll['right'], touchRight);
const up = orEdges(kbPoll['up'], touchUp);
const down = orEdges(kbPoll['down'], touchDown);
const jump = kbPoll['jump'];
```

**Usage example (non-directional: action buttons):**

```ts
// Same adapter works for action buttons — no directional semantics baked in
const actions = createTouchButtonSet({
  elements: [
    document.getElementById('btn-jump'),
    document.getElementById('btn-attack'),
    document.getElementById('btn-dash'),
  ],
});

const [touchJump, touchAttack, touchDash] = actions.poll();
```

**Design details — requirements from the architect's objections:**

1. **`touchAction: 'none'` per element.** For each non-null element, the adapter sets `element.style.touchAction = 'none'` on creation. Without this, browser scroll/zoom intercepts touches on mobile and the game is unplayable. This matches the existing `createTouchButton` pattern (`src/input/touch-button.ts:61`).

2. **SSR safety: `typeof window === 'undefined'` guard.** When `window` is undefined (Node, SSR, test env), the adapter short-circuits to a no-op that returns all-false `PolledEdge` entries. This matches the keyboard adapter pattern (`src/input/keyboard.ts:59`). Without this, server-rendered DOM elements could pass the null check but `addEventListener` would fail.

3. **Global safety net including `pointerleave`.** The adapter installs listeners on `document` for `pointerup`, `pointercancel`, AND `pointerleave`. The `pointerleave` listener catches viewport-exit events (finger swipes to notification bar, edge gestures) where the browser fires `pointerleave` on the element but NOT `pointerup`/`pointercancel` on `window`. The per-element `pointerleave` handler may miss this due to browser quirks or rapid event ordering. The global `document`-level listener is the fallback. On `dispose()`, all three global listeners are removed.

4. **Per-element `touchAction` guard.** Setting `touchAction = 'none'` may throw on cross-origin iframes or restricted elements. The adapter wraps it in try/catch, matching the defensive-adapter pattern.

**Internal state (matching Spitekeep's proven pattern):**

```ts
// Per element: Set<number> of active pointer IDs
const pointersByButton: Set<number>[] = elements.map(() => new Set());
// Maps pointerId → index for global safety net release
const pointerToIndex: Map<number, number> = new Map();
// One EdgeAccumulator per element
const accs: EdgeAccumulator[] = elements.map(() => createEdgeAccumulator());
```

- `pressEdge` fires on 0→≥1 transition (first finger touches).
- `releaseEdge` fires on 1→0 transition (last finger lifts).
- Global `pointerup`/`pointercancel`/`pointerleave` on `document` releases any tracked pointer regardless of which element it's on.

**Trade-offs:**
- **Ergonomics (consumer-developer):** Good. One `createTouchButtonSet` call replaces N× `createTouchButton` + N× pointer-ID tracking boilerplate. The consumer maps array indices to semantics (e.g., `[left, right, up, down]`). Slightly less discoverable than named fields (`left`, `right`) for the directional case, but the positional mapping is explicit and obvious.
- **Ergonomics (player):** Depends on consumer's DOM. Engine doesn't dictate visual layout.
- **Determinism:** Correct. N `EdgeAccumulator`s, drained via `pollEdge` once per tick. The pointer-ID tracking is host-touching (defensive adapter); the edge core is deterministic. Clean layer separation.
- **Multi-touch robustness:** **Strong.** Per-element `Set<number>` pointer tracking with 0→≥1 / 1→0 transitions. Global `document` `pointerup`/`pointercancel`/`pointerleave` safety net. Matches Spitekeep's proven pattern. Two fingers on the same button work correctly — the button stays held until ALL pointers lift.
- **Scope risk:** Low. This centralizes a pattern that Spitekeep already ships. The engine version is simpler (~100-120 lines): no CSS injection, no touch-capability detection, no class architecture, no DOM creation — just the reusable multi-touch core.
- **Convention fit:** Good. Follows defensive-adapter pattern (null elements → no-op, try/catch, never-throw). File: `src/input/touch-button-set.ts`. Types extend `types.ts`.
- **Tree-shakeability:** Good. Consumer imports only what they need. The adapter has no dependencies beyond the existing edge core.

**What this makes easy:** Bulletproof multi-touch button group with minimal boilerplate. Consumer provides N elements, the adapter does the rest. Composes cleanly with `orEdges` + `createKeyboardAdapter`. Works for directional input, action buttons, or any multi-button layout.

**What this makes hard:** The consumer must still create and position DOM elements. No built-in layout helper (by design — layout is game-specific). The array-based return requires the consumer to destructure into named variables for readability (the `[left, right, up, down]` pattern above). The adapter doesn't handle "sliding" between buttons (a finger sliding from "left" to "right" triggers `pointerleave` on left → release, then `pointerdown` on right → press; this is acceptable for discrete buttons but not for a smooth thumbstick).

## Approach C: Analog Thumbstick `createThumbstick` Adapter

**Source pattern:** Analog Virtual Thumbstick (research §Pattern 2), referencing NippleJS and Phaser Virtual Joystick Plugin.

**Concept:** A floating or fixed-position thumbstick that tracks a single pointer, computes a normalized 2D vector with dead-zone clamping, and thresholds into directional edges. Returns both the continuous vector (for top-down games) and thresholded `PolledEdge`s (for binary-input games).

**Signature sketch:**

```ts
// In src/input/virtual-stick.ts

export interface ThumbstickConfig {
  /** Dead-zone radius as fraction of maxRadius (default: 0.15). */
  deadZone?: number;
  /** Magnitude threshold to trigger binary edge (default: 0.5). */
  threshold?: number;
  /** Maximum drag radius in pixels (default: 60). */
  maxRadius?: number;
  /** If true, base appears at initial touch point (default: true). */
  floating?: boolean;
}

export interface ThumbstickVector {
  x: number; // Normalized [-1, 1]
  y: number; // Normalized [-1, 1]
}

export interface ThumbstickResult {
  /** Continuous analog vector (null when no pointer is active). */
  vector: ThumbstickVector | null;
  /** Thresholded binary edges for directional input. */
  edges: {
    up: PolledEdge;
    down: PolledEdge;
    left: PolledEdge;
    right: PolledEdge;
  };
}

export interface ThumbstickAdapter {
  /** Drain edges and read vector. Call once per fixed tick. */
  poll(): ThumbstickResult;
  /** Remove all listeners, clear state. Idempotent. */
  dispose(): void;
}

export function createThumbstick(
  element: HTMLElement | null,
  config?: ThumbstickConfig,
): ThumbstickAdapter;
```

**Usage example:**

```ts
import {
  createThumbstick,
  createTouchButton,
  createKeyboardAdapter,
  orEdges,
} from 'aicraft-engine/src/input';

const stick = createThumbstick(document.getElementById('stick-zone'), {
  deadZone: 0.15,
  threshold: 0.5,
  maxRadius: 60,
  floating: true,
});

const jumpBtn = createTouchButton(document.getElementById('btn-jump'));
const kb = createKeyboardAdapter({ codeToAction { Space: 'jump', ArrowUp: 'up' } });

// Once per fixed tick:
const stickPoll = stick.poll();
const kbPoll = kb.poll();
const left = orEdges(kbPoll['left'], stickPoll.edges.left);
const right = orEdges(kbPoll['right'], stickPoll.edges.right);
const jump = orEdges(kbPoll['jump'], jumpBtn.poll());

// For variable-speed top-down games, also use the raw vector:
if (stickPoll.vector) {
  movePlayer(stickPoll.vector.x * moveSpeed, stickPoll.vector.y * moveSpeed);
}
```

**Trade-offs:**
- **Ergonomics (consumer-developer):** Medium-high. More config knobs than B, but the API is clean. The dual output (vector + edges) serves both platformer and top-down use cases.
- **Ergonomics (player):** **Excellent.** Floating stick is the gold standard for mobile ergonomics — the base appears where the thumb touches, reducing strain. Superior to discrete buttons for continuous movement.
- **Determinism:** Mostly correct, but the thresholding adds a design knob. The vector math (dead zone, clamping, normalization) is pure and deterministic. The threshold-to-edge conversion uses the same `pressEdge`/`releaseEdge` pattern. However, the consumer must choose a threshold value that works for their game, and the wrong threshold can cause diagonal misfires or stuck states.
- **Multi-touch robustness:** Single-pointer tracking (one finger controls the stick). Must coordinate with other adapters (jump button, etc.) for full multi-touch. The stick itself handles its pointer correctly; cross-control multi-touch is the consumer's responsibility (same as B).
- **Scope risk:** **Medium-high.** This is a new abstraction with non-trivial design knobs (dead zone, threshold, floating vs fixed, max radius). Only one consumer needs it today (the showcase playground). The analog→binary thresholding is a design decision that could be wrong for future games. Premature for a platformer whose core is binary edges.
- **Convention fit:** Good. Defensive adapter pattern. File: `src/input/virtual-stick.ts`. But the config object has more tunables than any existing adapter, increasing the surface area.
- **Tree-shakeability:** Good. Consumer imports only `createThumbstick` if they need it.

**What this makes easy:** Rich analog input for top-down games, racing games, or any game that benefits from continuous 2D movement. The floating stick is superior ergonomics for extended play sessions.

**What this makes hard:** The threshold-to-binary conversion is a footgun for platformers. A player tilting slightly diagonally might trigger "up" when they only meant "right". The consumer must tune `deadZone` and `threshold` per-game. The adapter's complexity (vector math, angle calculations, dead-zone clamping) is 3-4× the code of B, all to solve a problem (analog input) that the current consumer (Spitekeep, a platformer) doesn't have.

## Multi-Touch Pointer-ID Isolation: How Each Approach Handles It

This is the load-bearing constraint. A player must be able to hold "right" (left thumb) and tap "jump" (right thumb) simultaneously without cross-talk.

### Approach A (Composite)

Each `createTouchButton` attaches to a separate DOM element. Pointer events are per-element: `pointerdown` fires on the element the finger touches, `pointerup` fires when that finger lifts from that element.

**Isolation model:** Implicit per-element isolation via DOM event targeting. No explicit pointer-ID tracking.

**Failure modes:**
1. Two fingers on the same element: second finger's `pointerup` calls `releaseEdge` → `held=false` even though first finger is still down. This is the "cross-talk on same element" bug.
2. Finger slides off element: `pointerleave` fires → `releaseEdge`. If the finger re-enters, `pointerdown` fires → `pressEdge`. This creates a spurious released+pressed edge pair on the next poll.
3. No global safety net: if the browser fires `pointercancel` but the element handler misses it, the button stays stuck.

**Assessment:** Works for the common case (separate elements, one finger each). Fails on edge cases.

### Approach B (Touch Button Set)

The adapter owns all accumulators and tracks pointer IDs explicitly:

```ts
// Internal state per element
const pointersByButton: Set<number>[] = elements.map(() => new Set());
const pointerToIndex: Map<number, number> = new Map();
```

**Isolation model:** Explicit per-pointer tracking. `pressEdge` fires on 0→≥1 transition; `releaseEdge` fires on 1→0 transition. Global `document` `pointerup`/`pointercancel`/`pointerleave` releases any tracked pointer regardless of which element it's on.

**Failure modes:** None for the button-set use case. Two fingers on the same button: both tracked, release only fires when the set empties. Finger slides between buttons: `pointerleave` releases from old button, `pointerdown` presses on new button (acceptable behavior for discrete buttons). Viewport exit: caught by the global `document`-level `pointerleave` listener.

**Assessment:** Bulletproof. Matches Spitekeep's proven pattern.

### Approach C (Thumbstick)

Single-pointer tracking. The adapter captures one `pointerId` on `pointerdown` and ignores all others until that pointer lifts.

**Isolation model:** Single pointer capture. Cross-control multi-touch is the consumer's responsibility (the thumbstick adapter doesn't know about other controls).

**Failure modes:** The thumbstick itself is clean. But the consumer must ensure the jump button (separate adapter) handles its own pointer correctly. No cross-talk between the thumbstick and the jump button because they're separate DOM elements with separate adapters.

**Assessment:** Clean within its scope. Multi-touch between controls works if each control is a separate adapter (same as B's advantage over A, but applied to a different control type).

## Visual Rendering Decision

**Recommendation: Visually-agnostic adapters (consumer renders).**

The engine adapters capture pointer coordinates and manage edge accumulators. They do NOT render anything. The consumer provides DOM elements and styles them however they want (CSS, canvas, images).

Rationale:
1. **DPR scaling.** Canvas-rendered controls fight Device Pixel Ratio — the research note flagged this. DOM elements get DPR handling for free from the browser layout engine.
2. **Accessibility.** DOM elements can have ARIA roles, screen-reader labels, and keyboard focus. Canvas-rendered controls are invisible to accessibility tools.
3. **Styling flexibility.** Consumers have different visual languages (Spitekeep uses semi-transparent CSS buttons; another game might use pixel-art sprites). The engine shouldn't dictate visual style.
4. **Consistency.** This matches the existing `createTouchButton` pattern: consumer provides the element, engine attaches listeners.

The thumbstick adapter (C) needs to expose the knob position for the consumer to render (via CSS transform or canvas draw), but the adapter itself does not touch the DOM for visual updates.

## Floating vs Fixed Stick (Approach C)

**Recommendation: Support both via config, default to floating.**

- **Floating (dynamic origin):** The base appears wherever the thumb first touches. Superior ergonomics — the player doesn't have to reach for a fixed position. Common in modern mobile games (Fortnite, PUBG Mobile).
- **Fixed:** The base stays at a constant screen position. Simpler for games with a fixed UI layout.

The `floating: boolean` config flag (default `true`) controls this. When floating, the adapter records the initial touch position as the origin and computes the vector relative to that origin. When fixed, the origin is the element's center.

## File Structure

| Approach | New files | Types location |
|---|---|---|
| A | None | N/A |
| B | `src/input/touch-button-set.ts` | Types in `src/input/types.ts` (add `TouchButtonSetAdapter`, `TouchButtonSetConfig`) |
| C | `src/input/virtual-stick.ts` | Types in `src/input/types.ts` (add `ThumbstickAdapter`, `ThumbstickConfig`, `ThumbstickResult`, `ThumbstickVector`) |

Both B and C add barrel re-exports from `src/input/index.ts`.

## Comparison Table

| Criterion | A (Composite) | B (Touch Button Set) | C (Thumbstick) |
|---|---|---|---|
| Ergonomics (player) | Depends on consumer | Depends on consumer | Excellent (floating stick) |
| Ergonomics (developer) | Medium (~20 lines boilerplate) | Good (1 function call + index mapping) | Medium-high (config tuning) |
| Determinism | Correct | Correct | Correct, but threshold knob |
| Multi-touch robustness | Weak (same-element bug) | Bulletproof | Clean (single pointer) |
| Scope risk | Zero | Low (proven pattern, ~100-120 lines) | Medium-high (premature) |
| Convention fit | Perfect | Good | Good |
| Code complexity | 0 lines | ~100-120 lines | ~200 lines |
| Composes with orEdges | Yes | Yes | Yes |
| Solves the real problem | Partially | Yes | Yes (but adds analog) |
| Prior art pattern | Research §Pattern 1 | Spitekeep `TouchControls` | Research §Pattern 2 |
| Element-count-agnostic | Yes (by composition) | Yes (native) | N/A (single element) |

## Recommendation

**Ship B (`createTouchButtonSet`) as the single new export. Document A (Composite) as the escape hatch. Defer C (Thumbstick).**

Rationale: The two failure modes that affect every consumer — the `pointerleave` spurious-release bug and the missing global safety net (stuck-button bug) — are real, demonstrated by the gap between `createTouchButton` (no safety net, treats `pointerleave` as release) and Spitekeep's `TouchControls` (which installs window `pointerup`/`pointercancel` listeners). The multi-touch pointer-ID tracking on top is the hard logic that Spitekeep already proved is necessary (~120 lines of the 414-line class; the rest is CSS injection, capability detection, and DOM creation). Centralizing it in the engine prevents every future consumer from re-inventing it — and getting it wrong.

The generic `createTouchButtonSet` (not a directional `createVirtualDpad`) is the right v1 shape because the genuinely-hard reusable logic — multi-touch pointer-ID tracking, per-element accumulators, and the global safety net — is element-count-agnostic. Shipping a generic primitive avoids baking directional semantics into the engine when only one consumer exists today. The consumer maps array indices to directions via simple destructuring (`const [left, right, up, down] = dpad.poll()`), which is explicit and obvious. A directional convenience wrapper (`createVirtualDpad`) can be added later if a second consumer wants named-field ergonomics.

The composite pattern (A) is documented as the escape hatch for consumers who need non-standard layouts or want to understand the internals. The analog thumbstick (C) is premature: only one consumer exists today, and it's a platformer whose core is binary edges. When a second consumer needs analog input (a top-down game, a racing game), the engine can ship C with the benefit of real usage data.

This matches the engine's scope-discipline norm: ship what's needed now, document what's possible with existing primitives, defer what's speculative.

## Implementation Notes for @coder

1. **`touchAction: 'none'`** must be set on each non-null element. Wrap in try/catch for cross-origin iframe safety.
2. **SSR guard:** `if (typeof window === 'undefined')` at the top of `createTouchButtonSet`, returning a no-op adapter that produces an array of idle `PolledEdge` entries matching the input length. This matches `createKeyboardAdapter` (`src/input/keyboard.ts:59`).
3. **Global safety net:** Install `pointerup`, `pointercancel`, AND `pointerleave` listeners on `document` (not `window`). The `pointerleave` on `document` catches viewport-exit events that `pointerup`/`pointercancel` on `window` miss. Remove all three on `dispose()`.
4. **Per-element listeners:** `pointerdown`, `pointerup`, `pointercancel`, `pointerleave` on each non-null element. The per-element `pointerleave` handles drag-off within the viewport; the global `document` `pointerleave` handles viewport exit.
5. **No-op shape when `window` undefined:** Return `{ poll: () => elements.map(() => IDLE), dispose: () => {} }` — the array length must match the input so consumers can destructure consistently.
6. **File:** `src/input/touch-button-set.ts`. Types in `src/input/types.ts`. Barrel re-export from `src/input/index.ts`.
7. **~100-120 lines target.** No CSS injection, no DOM creation, no touch-capability detection — just the reusable multi-touch core.

## Open Questions for @architect

1. **Should the global safety net listen on `document` or `window`?** `document` fires `pointerleave` when the pointer exits the document (viewport exit). `window` does not fire `pointerleave` in all browsers. The keyboard adapter uses `window` for `blur`; should the touch safety net use `document` for `pointerleave` consistency with the DOM event spec, or `window` for consistency with the keyboard adapter? My recommendation: `document` for `pointerup`/`pointercancel`/`pointerleave` — it's the correct target for pointer capture scenarios.

2. **Should the no-op fallback return an array matching input length, or a fixed empty array?** The consumer may destructure the result (`const [left, right] = poll()`). If the no-op returns `[]`, the destructuring yields `undefined`. If it returns `[IDLE, IDLE]`, destructuring works. My recommendation: match input length — it's more ergonomic and the cost is negligible.
