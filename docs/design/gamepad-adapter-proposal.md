# API Proposal: Gamepad Adapter

> Target pillar: 1 (Primitives). Module: `src/input/`.
> Builds on research: `docs/research/gamepad-adapter.md`.
> Status: DRAFT (Revision 1 — architect NEEDS REVISION applied).

## Consumer Need

Spitekeep and future Clone-to-Jest siblings need gamepad support for desktop browser play (Poki, Steam web). Today, Spitekeep has no gamepad adapter — desktop players with controllers cannot play. The existing input layer (`src/input/`) ships keyboard + touch adapters that wrap host APIs and feed a deterministic binary edge-accumulator core (`edges.ts`). The gap is **gamepad support**: an adapter that polls `navigator.getGamepads()`, maps the W3C Standard Gamepad layout to logical actions, applies a deadzone to analog sticks, and latches threshold-crossings into the same `EdgeAccumulator` the keyboard and touch adapters already use.

The core consumer need: a player holds "right" with the left stick and taps "jump" with a face button. Both inputs must register independently and OR-merge with keyboard/touch edges. Analog sticks are the only input device that natively produces continuous 2D vectors — the deadzone + threshold-latching pattern bridges analog-to-binary so the gamepad feeds the same binary edge core without modification.

---

## Approach A: Full Parity — Keyboard-Mirror Pattern

**Source pattern:** Research §Pattern 1 (Standard Mapping + Scaled Radial Deadzone + Threshold-Latch), §Pattern 2 (Connect/Disconnect Lifecycle), §Pattern 3 (Browser Quirks & Defensive Null Handling). Mirrors `createKeyboardAdapter` exactly.

**Concept:** The gamepad adapter is a factory function that returns `{ poll(): Record<string, PolledEdge>; dispose(): void }` — identical shape to `KeyboardAdapter`. Internally, it manages one `EdgeAccumulator` per logical action, latches button press/release edges by diffing `btn.pressed` against previous state, latches axis threshold-crossings by comparing magnitude against deadzone (axial per-axis threshold), and drains accumulators on `poll()`. Connect/disconnect events reset accumulators (prevents stuck buttons). `timestamp`-based change detection short-circuits when hardware hasn't reported new data.

**Signature sketch:**

```ts
// In src/input/types.ts

/**
 * Configuration for {@link createGamepadAdapter}.
 *
 * Maps W3C Standard Gamepad button indices and axis indices to logical
 * action names. Multiple buttons can map to the same action (e.g. button 0
 * + button 16 → 'jump' → one shared accumulator).
 */
export interface GamepadConfig {
  /**
   * Maps Standard Gamepad button indices (0-16) to action names.
   *
   * W3C Standard layout: 0-3 = face cluster (A/B/X/Y), 4-5 = shoulders
   * (LB/RB), 6-7 = triggers (L2/R2), 8-9 = center (Back/Start),
   * 10-11 = stick clicks (LS/RS), 12-15 = D-pad (up/down/left/right),
   * 16 = guide.
   *
   * @example
   * ```ts
   * { '0': 'jump', '1': 'dash', '12': 'up', '13': 'down', '14': 'left', '15': 'right' }
   * ```
   */
  readonly buttonToAction?: Readonly<Record<string, string>>;

  /**
   * Maps Standard Gamepad axis indices (0-3) to directional action pairs.
   * Each axis produces two actions: one for positive deflection, one for
   * negative. The axis value is compared against the deadzone; if magnitude
   * ≥ deadzone, the corresponding direction's accumulator is pressed.
   *
   * Axes 0-1 = left stick (X, Y); axes 2-3 = right stick (X, Y).
   *
   * @example
   * ```ts
   * { '0': { positive: 'right', negative: 'left' }, '1': { positive: 'down', negative: 'up' } }
   * ```
   */
  readonly axisToAction?: Readonly<Record<string, AxisBinding>>;

  /**
   * Analog stick deadzone magnitude. Values below this threshold are
   * treated as idle (no edge fired). Applies **per-axis independently**
   * (axial per-axis threshold): each axis value is compared against the
   * deadzone as `Math.abs(raw) >= deadzone`.
   *
   * v1 ships axial only because the per-axis `axisToAction` config cannot
   * express stick pairing (true scaled-radial requires 2D stick vectors,
   * which a future `deadzoneStyle: 'scaled-radial'` option with a
   * `stickToAction` config will enable — additive, deferred).
   *
   * Axial is adequate for platformers (Phaser's approach per research
   * Pattern 4). Default: `0.25`.
   *
   * @see {@link DEFAULT_GAMEPAD_DEADZONE}
   */
  readonly deadzone?: number;
}

/**
 * Bidirectional axis binding: maps positive/negative deflection to action
 * names. Either direction can be omitted (e.g. right-stick-X only maps
 * positive for camera pan-right).
 */
export interface AxisBinding {
  /** Action name for positive axis deflection (e.g. 'right'). Omit to ignore. */
  readonly positive?: string;
  /** Action name for negative axis deflection (e.g. 'left'). Omit to ignore. */
  readonly negative?: string;
}

/**
 * Gamepad adapter — polls `navigator.getGamepads()` and maps the W3C
 * Standard Gamepad layout to logical actions via one
 * {@link EdgeAccumulator} per action. OR-merges with keyboard/touch via
 * the existing {@link orEdges} helper.
 *
 * Single-player v1: binds to the first connected pad (`getGamepads()[0]`).
 * Multi-player v2: consumer creates a second adapter instance.
 */
export interface GamepadAdapter {
  /**
   * Drain all accumulators, returning a per-action edge snapshot. Call
   * exactly once per tick. Every mapped action appears in the record each
   * tick (idle actions report `{held:false, pressed:false, released:false}`).
   *
   * Returns `{}` when no standard-mapping gamepad is connected, or in
   * Node/SSR.
   */
  poll(): Record<string, PolledEdge>;
  /** Remove all window listeners and release resources. Idempotent. */
  dispose(): void;
}

// In src/input/gamepad.ts

export const DEFAULT_GAMEPAD_DEADZONE = 0.25;

export function createGamepadAdapter(config: GamepadConfig): GamepadAdapter;
```

**Usage example:**

```ts
import {
  createKeyboardAdapter,
  createGamepadAdapter,
  orEdges,
} from 'aicraft-engine/src/input';

const keyboard = createKeyboardAdapter({
  codeToAction: {
    ArrowLeft: 'left', ArrowRight: 'right',
    ArrowUp: 'up', ArrowDown: 'down',
    Space: 'jump', ShiftLeft: 'dash',
  },
});

const gamepad = createGamepadAdapter({
  buttonToAction: {
    '0': 'jump',    // A / Cross
    '1': 'dash',    // B / Circle
    '12': 'up',     // D-pad up
    '13': 'down',   // D-pad down
    '14': 'left',   // D-pad left
    '15': 'right',  // D-pad right
  },
  axisToAction: {
    '0': { positive: 'right', negative: 'left' },   // Left stick X
    '1': { positive: 'down', negative: 'up' },       // Left stick Y
  },
  deadzone: 0.25,
});

// Once per fixed tick:
const kbEdges = keyboard.poll();
const gpEdges = gamepad.poll();

const left  = orEdges(kbEdges['left']  ?? { held: false, pressed: false, released: false },
                      gpEdges['left']  ?? { held: false, pressed: false, released: false });
const right = orEdges(kbEdges['right'] ?? { held: false, pressed: false, released: false },
                      gpEdges['right'] ?? { held: false, pressed: false, released: false });
const jump  = orEdges(kbEdges['jump']  ?? { held: false, pressed: false, released: false },
                      gpEdges['jump']  ?? { held: false, pressed: false, released: false });

if (left.pressed)  startMoveLeft();
if (right.pressed) startMoveRight();
if (jump.pressed)  bufferJump();
```

**Trade-offs:**
- **Ergonomics:** Strong. The `createXAdapter(config)` + `{ poll(), dispose() }` shape is identical to `createKeyboardAdapter`. Consumers who know one adapter know all three. Config mirrors `KeyboardConfig.codeToAction` — same key-value pattern, different keys.
- **Determinism:** Correct. `poll()` reads host state (DOM read — the same exception as the keyboard adapter) and feeds pure threshold-crossing logic into `EdgeAccumulator`s. The adapter call is a side effect that cannot crash the sim because `poll()` never throws. `gamepad.timestamp` is used ONLY for change-detection (skip diff when unchanged) and never feeds simulation state.
- **Runtime cost:** O(buttons + axes) per poll (~21 comparisons). `timestamp` short-circuit saves this when hardware hasn't reported new data (common when idle). Negligible.
- **Consumer complexity:** Low. The consumer calls `keyboard.poll()` and `gamepad.poll()` and OR-merges per action — same pattern as keyboard+touch. The `??` fallback for undefined actions is slightly verbose but explicit.
- **Tree-shake-ability:** Strong. Single factory function. Consumer imports only `createGamepadAdapter` + types.
- **Convention fit:** Perfect. Mirrors `createKeyboardAdapter` exactly (lazy host resolution, swallow errors, never-throw, `{}` fallback in Node/SSR, closure-scoped state, idempotent `dispose()`). Lowercase-kebab file (`gamepad.ts`). JSDoc on every export. All tunable values in config object.

**What this makes easy:**
- Drop-in third adapter alongside keyboard/touch. Zero changes to existing input types.
- `orEdges` composition is natural — same action names across all three devices.
- `dispose()` tears down listeners idempotently, matching the keyboard pattern.

**What this makes hard:**
- Binary edges only — analog stick feel is lost (stick position is latched to 0 or 1). Consumers who want variable-speed movement from the analog stick must read `navigator.getGamepads()` directly (acceptable v1 trade-off).
- The `?? { held: false, pressed: false, released: false }` fallback in consumer code is verbose. A helper (`emptyEdge()`) could reduce this, but that's additive and optional.

#### Timestamp change-detection (pure optimization)

The adapter caches `lastTimestamp` and `lastSnapshot` (the full `Record<string, PolledEdge>` from the previous poll). On each `poll()`:

1. Read `pad.timestamp` from `navigator.getGamepads()[0]`.
2. If `pad.timestamp === lastTimestamp && pad.timestamp !== 0`, return the cached snapshot immediately — no re-diffing.
3. Otherwise, perform the full button/axis diff, drain accumulators, cache the new snapshot and timestamp.

Firefox reports `pad.timestamp === 0` for all polls, so the `!== 0` guard ensures Firefox always re-diffs (correct behavior, slight perf cost).

This is a **pure optimization** — zero consumer-facing API surface. The timestamp never feeds simulation state; it only short-circuits work when hardware hasn't reported new data. The consumer sees no difference in output.

#### Locked architect verdicts

The following decisions are locked and must be implemented exactly as specified:

1. **`axisToAction` directions:** Both `positive?` and `negative?` are optional on `AxisBinding`. Silently skip entries where neither is set (no error, no warning).
2. **`poll()` return type:** `Record<string, PolledEdge>` — matches `KeyboardAdapter`.
3. **`DEFAULT_GAMEPAD_DEADZONE`:** Named const `0.25` (top-level export from `src/input/gamepad.ts`).
4. **`buttonToAction` key type:** `Record<string, string>` (string keys, matches `KeyboardConfig.codeToAction`).
5. **`AxisBinding`:** Named interface (not inline type literal).
6. **Non-standard mapping `console.warn`:** Include the full gamepad `id` string in the warning message. Warn-once (use a closure-scoped `warned` flag).
7. **`dispose()` guard:** `if (disposed) return; disposed = true;` — mirrors the keyboard adapter's idempotent dispose pattern.

## Approach B: Minimal Poll — Event-Free Factory

**Source pattern:** Research §Pattern 1 (the poll-only core from §Algorithmic Shape), simplified. No connect/disconnect lifecycle.

**Concept:** Strip the adapter to its absolute minimum: `poll()` reads `navigator.getGamepads()[0]`, applies deadzone, latches edges, returns the record. No `gamepadconnected`/`gamepaddisconnected` event listeners. No `resetEdge` on disconnect. The consumer is responsible for detecting gamepad absence (poll returns `{}` when no pad is connected). Lighter, simpler, fewer lines.

**Signature sketch:**

```ts
// In src/input/types.ts

export interface GamepadConfig {
  readonly buttonToAction?: Readonly<Record<string, string>>;
  readonly axisToAction?: Readonly<Record<string, AxisBinding>>;
  readonly deadzone?: number;
}

export interface AxisBinding {
  readonly positive?: string;
  readonly negative?: string;
}

export interface GamepadAdapter {
  poll(): Record<string, PolledEdge>;
  dispose(): void;
}

// In src/input/gamepad.ts

export const DEFAULT_GAMEPAD_DEADZONE = 0.25;

export function createGamepadAdapter(config: GamepadConfig): GamepadAdapter;
```

**Usage example:** Same as Approach A.

**Trade-offs:**
- **Ergonomics:** Same as A for the happy path. Worse when the controller disconnects mid-session: accumulators stay stuck because there's no `resetEdge` on disconnect. The consumer must poll `navigator.getGamepads()[0]` themselves to detect disconnection and call `dispose()` + recreate.
- **Determinism:** Correct for the poll path. But the stuck-button risk on disconnect is a real footgun — the edge latch stays set if the pad vanishes between polls with no disconnect handler to reset it.
- **Runtime cost:** Marginally lower (no event listeners to install/remove). The savings are negligible.
- **Consumer complexity:** Higher. The consumer must handle disconnect detection, stuck-button cleanup, and reconnection. This is exactly the complexity the defensive adapter pattern is designed to absorb.
- **Tree-shake-ability:** Same as A.
- **Convention fit:** Weaker. The existing `createKeyboardAdapter` installs `blur` → `resetEdge` as a safety net. The gamepad equivalent is `gamepaddisconnected` → `resetEdge`. Omitting this breaks the defensive-adapter contract. The `touch-button-set` adapter also installs a global safety net for the same reason. Consistency demands the lifecycle listeners.

**What this makes easy:**
- Minimal code. Easy to understand. Fewer edge cases in the adapter itself.

**What this makes hard:**
- Stuck buttons on disconnect. The consumer must reinvent the `resetEdge` safety net. Every consumer will hit this bug. The defensive-adapter pattern exists precisely to prevent this class of problem.

## Approach C: Extended — Configurable Deadzone Style + Vector Hook

**Source pattern:** Research §Pattern 1 (Scaled Radial + Axial + Radial options), §Pattern 4 (Phaser's per-axis threshold). Extends Approach A with additional config options and a non-breaking `vector` hook.

**Concept:** Approach A plus two additions: (1) `deadzoneStyle` config option to choose between `'scaled-radial'`, `'radial'`, and `'axial'` deadzone styles; (2) an optional `onVector` callback that receives continuous `{x, y}` stick values after deadzone application — for consumers who want analog feel without breaking the binary edge core.

**Signature sketch:**

```ts
// In src/input/types.ts — extends Approach A

export interface GamepadConfig {
  readonly buttonToAction?: Readonly<Record<string, string>>;
  readonly axisToAction?: Readonly<Record<string, AxisBinding>>;
  readonly deadzone?: number;
  /**
   * Deadzone algorithm. Default: `'scaled-radial'` (Sutphin's recommended
   * approach — smooth cardinal transitions AND full precision preservation).
   *
   * - `'scaled-radial'`: magnitude < deadzone → zero; else rescale to
   *   preserve full range. Best analog feel.
   * - `'radial'`: magnitude < deadzone → zero; else pass through (clips
   *   range). Smooth but loses precision.
   * - `'axial'`: per-axis threshold. Cheap but causes snap-to-cardinal.
   */
  readonly deadzoneStyle?: 'scaled-radial' | 'radial' | 'axial';
  /**
   * Optional callback receiving continuous stick values after deadzone
   * application. Called once per tick when the gamepad has new data.
   * For consumers who need analog feel (variable-speed movement, 360° camera).
   *
   * The callback receives axis index → `{x, y}` vectors for each mapped
   * axis pair. The binary edges still fire via `poll()` — this is additive.
   *
   * @example
   * ```ts
   * onVector: (vectors) => {
   *   moveSpeed = vectors['0'].x * maxSpeed; // Left stick X → variable speed
   * }
   * ```
   */
  readonly onVector?: (vectors: Record<string, { x: number; y: number }>) => void;
}

export interface GamepadAdapter {
  poll(): Record<string, PolledEdge>;
  dispose(): void;
}
```

**Usage example:**

```ts
const gamepad = createGamepadAdapter({
  buttonToAction: { '0': 'jump', '1': 'dash' },
  axisToAction: {
    '0': { positive: 'right', negative: 'left' },
    '1': { positive: 'down', negative: 'up' },
  },
  deadzone: 0.25,
  deadzoneStyle: 'scaled-radial',
  onVector: (vectors) => {
    // Continuous analog feel for variable-speed movement
    const stick = vectors['0'] ?? { x: 0, y: 0 };
    moveSpeed = Math.abs(stick.x) * maxSpeed;
  },
});
```

**Trade-offs:**
- **Ergonomics:** Slightly more complex config surface. The `deadzoneStyle` option adds a choice that most consumers won't need (scaled-radial is correct for 95% of cases). The `onVector` callback is opt-in and additive.
- **Determinism:** The `onVector` callback is host-touching (receives values derived from `navigator.getGamepads()`). It fires as a side effect inside `poll()`, which is already a side-effect call. No determinism regression — the callback receives pure-math outputs, never raw host state.
- **Runtime cost:** Marginally higher (deadzone style dispatch, optional callback invocation). Still negligible.
- **Consumer complexity:** Higher config surface. The `deadzoneStyle` option is premature — consumers don't need it yet. The `onVector` callback is useful but adds a second output channel alongside `poll()`.
- **Tree-shake-ability:** Weak. The deadzone style dispatch pulls in all three algorithms even if only one is used. A tree-shaking bundler won't eliminate the unused branches because they share a function.
- **Convention fit:** The `deadzoneStyle` enum violates the "no magic numbers" principle less than a raw algorithm reference, but it does add a config option that has no existing consumer need. The `onVector` callback pattern doesn't exist elsewhere in the input layer — it's a new concept.

**What this makes easy:**
- Analog feel for consumers who need it (360° camera, variable-speed movement).
- Deadzone style tuning for games that need a different feel (FPS axial, etc.).

**What this makes hard:**
- Premature API surface. Two options with no existing consumer demand. The deadzone style adds dispatch complexity for a problem that hasn't been observed. The `onVector` callback introduces a second output channel that breaks the clean `{ poll(), dispose() }` shape — consumers must now handle two outputs from one adapter.

---

## Comparison Table

| Criterion | A: Full Parity | B: Minimal Poll | C: Extended |
|---|---|---|---|
| Ergonomics | ★★★★★ | ★★★★ | ★★★★ |
| Determinism | ★★★★★ | ★★★★ | ★★★★★ |
| Runtime cost | ★★★★★ | ★★★★★ | ★★★★ |
| Consumer complexity | ★★★★★ | ★★★ | ★★★ |
| Convention fit | ★★★★★ | ★★★ | ★★★ |
| Tree-shake-ability | ★★★★★ | ★★★★★ | ★★★ |
| Public API stability | ★★★★★ | ★★★★★ | ★★★★ |
| Risk | Low | Medium (stuck buttons) | Medium (premature surface) |

## Recommendation

**Approach A: Full Parity.**

It mirrors `createKeyboardAdapter` exactly — same factory shape, same defensive-adapter pattern, same lifecycle listeners. The connect/disconnect → `resetEdge` safety net is the load-bearing fix for stuck buttons on controller disconnect, and it's the exact pattern the keyboard adapter already uses for `blur`. Approach B omits this and pushes the complexity to consumers who will all hit the same bug. Approach C adds two config options (`deadzoneStyle`, `onVector`) with no existing consumer demand — premature API surface that violates the "bias toward additive change" principle. The deadzone style can be added later if a consumer needs it; the `onVector` callback can be added later if analog feel becomes a requirement.

Approach A is the minimum viable adapter that is production-grade, convention-perfect, and additive-only. Everything else is a follow-up.

## Implementation notes for @coder

### SSR/host guard

The gamepad adapter's SSR guard must be more precise than the keyboard adapter's `typeof window === 'undefined'`:

```ts
// Correct guard for gamepad adapter:
if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
  // Return no-op adapter: { poll: () => ({}), dispose: () => {} }
}
```

This is more specific than the keyboard's `window` check because the gamepad API lives on `navigator.getGamepads()`, not `window`. The `{ poll: () => ({}), dispose: () => {} }` fallback shape is identical to the keyboard adapter's.

### api-surface.md sync

Update `docs/api-surface.md` `src/input/` section with the following exports:

- `GamepadConfig` (type)
- `AxisBinding` (type)
- `GamepadAdapter` (type)
- `DEFAULT_GAMEPAD_DEADZONE` (const)
- `createGamepadAdapter` (function)

All five are currently listed as **PROPOSED** in api-surface.md. After implementation, remove the PROPOSED markers.

### Research mislabel note

The research note at `docs/research/gamepad-adapter.md` TL;DR / Pattern 1 uses the term "scaled radial" for the deadzone algorithm. This is a mislabel — the per-axis `axisToAction` config shape can only implement an **axial per-axis threshold** (`Math.abs(raw) >= deadzone`). True scaled-radial requires pairing axes into 2D stick vectors, which the v1 config cannot express. The @coder should follow the proposal's corrected terminology ("axial per-axis threshold") and not be confused by the research note's "scaled radial" label.

## Open Questions for @architect

1. **`axisToAction` with only one direction:** Is `readonly positive?: string` sufficient for the right-stick camera use case (e.g. only map positive X for pan-right, ignore pan-left)? Or should we require both directions and let the consumer use a no-op action name for the unused direction?

2. **`poll()` returning `Record<string, PolledEdge>` vs `Map<string, PolledEdge>`:** The keyboard adapter uses `Record`. Gamepad has the same shape. Confirm `Record` is correct (preserves existing pattern, simpler consumer destructuring).

3. **`DEFAULT_GAMEPAD_DEADZONE` as a named constant:** Should this be `0.25` as a top-level const (matching `DEFAULT_OUTLINE_COLOR` pattern), or inline in the function body? The research recommends `0.25` (Sutphin, Unreal Engine RADIAL default). Named constant follows the "no magic numbers" convention.

4. **`buttonToAction` key type — string vs number:** The config uses `Record<string, string>` for button indices (matching `KeyboardConfig.codeToAction` which uses `Record<string, string>` for `e.code`). Gamepad button indices are numbers but `Record` keys are always strings in JS. Confirm string keys are correct (consistent with existing pattern, avoids `Record<number, string>` which has ergonomic issues).

5. **`AxisBinding` as a separate interface vs inline `{ positive?: string; negative?: string }`:** The research uses inline types for simplicity. A named interface follows the "PascalCase noun" convention and enables JSDoc. Confirm the named interface approach.

6. **Non-standard mapping `console.warn` — should the warn message include the gamepad's `id` string?** The `id` is a browser-provided controller identifier (e.g. "Xbox 360 Controller (XInput STANDARD GAMEPAD)"). Including it helps consumers debug, but `id` can be a long string. Confirm whether to truncate or include in full.

7. **`dispose()` on an already-disposed adapter:** Should it be a silent no-op (matching `createKeyboardAdapter`'s `if (disposed) return;` pattern), or should we document that calling `dispose()` twice is safe but have no guard (relying on `removeEventListener` being idempotent)? The keyboard adapter uses the guard — confirm we mirror it.
