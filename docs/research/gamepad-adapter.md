# Gamepad Adapter

> Research note for a defensive gamepad input adapter that mirrors the existing `createKeyboardAdapter` / `createTouchButton` pattern and feeds the same `EdgeAccumulator` core. Slug: `gamepad-adapter`.
> Investigated: 2026-07-27.

## TL;DR

The library's input layer (`src/input/`) ships keyboard + touch adapters that wrap host APIs and feed a deterministic binary edge-accumulator core (`edges.ts`). The gap is **gamepad support**: there is no adapter that polls `navigator.getGamepads()`, maps the W3C Standard Gamepad layout (button indices 0-16, axes 0-3) to logical actions, applies a deadzone to analog sticks, and latches threshold-crossings into the same `EdgeAccumulator` the keyboard and touch adapters already use. The recommended design is a single-player `createGamepadAdapter(config)` factory that mirrors `createKeyboardAdapter` exactly (lazy host resolution, swallow all errors, never-throw, `{}` fallback in Node/SSR), polls `navigator.getGamepads()` once per fixed tick, requires `mapping === 'standard'` (warns and falls back to no-op otherwise), applies a **scaled radial deadzone** with a default of `0.25` to each analog stick, and latches threshold-crossings into per-action `EdgeAccumulator`s so the consumer OR-merges with keyboard/touch via the existing `orEdges` helper. Multi-gamepad support is **deferred to v2** (Phaser uses `pad1..pad4` slots; we ship `pad1` only — the consumer can re-create the adapter for player 2). Rumble (`vibrationActuator` / `GamepadHapticActuator`) is **out of scope for v1** because it is Chrome-only (Firefox/Safari do not implement it as of 2026) and adds a second host-touching surface that would need its own defensive adapter. The top three patterns worth prototyping are: (1) the **standard-mapping + scaled-radial-deadzone + threshold-latch** core, (2) the **connect/disconnect lifecycle** with `mapping !== 'standard'` graceful degradation, and (3) the **per-tick `timestamp`-based change detection** that avoids redundant `pressEdge`/`releaseEdge` calls when the gamepad hardware hasn't reported new data.

## Why this matters for aicraft-engine

- **Pillars touched**: Directly extends **Pillar 1 (Primitives / Input)**. Composes with the existing `createKeyboardAdapter` and `createTouchButton` via `orEdges` — gamepad becomes a third source feeding the same `EdgeAccumulator` core.
- **Consumer games**: Spitekeep (desktop players with controllers), any future Clone-to-Jest title targeting Poki/Steam web, the upcoming `fake3d/` isometric titles where a gamepad's analog stick is the natural input for 360-degree camera control.
- **Unlocks**:
  - **Desktop parity** — keyboard-only is a non-starter for desktop browser games shipped on Steam web; gamepad support is table-stakes.
  - **Analog input** — gamepads are the only consumer input device that natively produces continuous 2D vectors; the existing keyboard/touch adapters are purely binary. The deadzone + threshold-latch pattern unlocks analog-feel controls (variable-speed movement, 360-degree aiming) while still feeding the binary edge core.
  - **Determinism seam preservation** — the pure core (`edges.ts`, `merge.ts`) is unchanged. The adapter is purely a host-touching layer that resolves `navigator` lazily and returns `{}` in Node/SSR. The deterministic core stays Node-testable with no jsdom.
- **Non-goals for v1**: multi-player (pad2/3/4), rumble/haptics, non-standard mappings (vendor-specific button layouts), WebXR pose data.

---

## Prior Art Survey

### Pattern 1: W3C Standard Gamepad Mapping + Scaled Radial Deadzone

- **Source**: W3C Gamepad Specification (Working Draft, July 2025, `https://w3c.github.io/gamepad/`); MDN Gamepad API reference; Josh Sutphin "Doing Thumbstick Dead Zones Right" (`https://joshsutphin.com/blog/doing-thumbstick-dead-zones-right.html`); Minimuino thumbstick-deadzones (`https://github.com/Minimuino/thumbstick-deadzones`); Unreal Engine `DeadZoneType` enum (`AXIAL`, `RADIAL`, `UNSCALED_RADIAL`).
- **What it does**: The W3C spec defines a single canonical "Standard Gamepad" layout that browsers MUST remap to when they recognize the controller. The mapping is:
  - **Buttons 0-3** = right cluster (bottom/right/left/top) — Xbox A/B/X/Y, PlayStation Cross/Circle/Square/Triangle
  - **Buttons 4-7** = front-facing shoulder buttons (top-left, top-right, bottom-left, bottom-right) — Xbox LB/RB, PlayStation L1/R1/L2/R2 (digital)
  - **Buttons 6-7** are also the analog triggers (L2/R2) — `value` 0.0-1.0
  - **Buttons 8-9** = center cluster (left/right) — Xbox Back/Start, PlayStation Select/Start
  - **Buttons 10-11** = stick clicks (left/right)
  - **Buttons 12-15** = left cluster (top/bottom/left/right) — D-pad up/down/left/right
  - **Button 16** = center button (Xbox Guide, PlayStation Home)
  - **Axes 0-1** = left stick (X, Y)
  - **Axes 2-3** = right stick (X, Y)
  - **Source**: W3C Gamepad spec §"Standard Gamepad" canonical-index table, verified across MDN, Phaser source, and the spec itself.

  Deadzone styles (from Sutphin and Minimuino):
  - **Axial** — `if (abs(x) < dz) x = 0; if (abs(y) < dz) y = 0`. Cheap but causes "snap to cardinal" when sweeping diagonally.
  - **Radial** — `if (magnitude < dz) vec = 0; else vec = vec`. Smooth cardinal transitions but loses precision (clips the input range).
  - **Scaled radial** — `if (magnitude < dz) vec = 0; else vec = normalize(vec) * ((magnitude - dz) / (1 - dz))`. Smooth AND preserves full precision. The "right" way per Sutphin.
  - **Hybrid** — scaled radial + sloped axial for high-precision FPS. Overkill for platformers.

- **Algorithmic shape** (the v1 core):

  ```typescript
  // Per-tick poll, called once per fixed step from the consumer's game loop:
  function pollGamepad(): Record<string, PolledEdge> {
    const out: Record<string, PolledEdge> = {};
    if (typeof navigator === 'undefined') return out;  // SSR/Node fallback
    const pads = navigator.getGamepads();
    if (!pads) return out;
    const pad = pads[0];  // v1: pad1 only
    if (!pad || pad.mapping !== 'standard') return out;

    // 1. Buttons → press/release edges (binary, no deadzone needed)
    for (const [buttonIndex, action] of Object.entries(config.buttonToAction)) {
      const btn = pad.buttons[buttonIndex];
      if (!btn) continue;
      const acc = accs.get(action);
      if (btn.pressed && !acc.held) pressEdge(acc);
      else if (!btn.pressed && acc.held) releaseEdge(acc);
    }

    // 2. Axes → threshold-crossing edges (analog → binary)
    for (const [axisIndex, binding] of Object.entries(config.axisToAction)) {
      const raw = pad.axes[axisIndex] ?? 0;
      const dz = config.deadzone;
      const mag = Math.abs(raw);
      const triggered = mag >= dz;
      const direction = raw > 0 ? binding.positive : binding.negative;
      if (!direction) continue;
      const acc = accs.get(direction);
      if (triggered && !acc.held) pressEdge(acc);
      else if (!triggered && acc.held) releaseEdge(acc);
    }

    // 3. Drain accumulators (same as keyboard/touch)
    for (const [action, acc] of accs) out[action] = pollEdge(acc);
    return out;
  }
  ```

- **Determinism profile**: Host-touching. The poll reads `navigator.getGamepads()` (a DOM read) and the gamepad hardware state (wall-clock-derived `timestamp`). The threshold-crossing logic itself is pure math. The adapter call is a side effect that cannot crash the sim because `poll()` never throws.
- **Runtime cost**: O(buttons + axes) per poll. With 17 buttons and 4 axes, ~21 comparisons per tick. Negligible.
- **Dependencies**: None. Pure DOM access.
- **Fit for our constraints**: **Strong.** This is the canonical pattern; every major browser engine implements it; the deadzone math is well-documented; the threshold-crossing latches into the existing `EdgeAccumulator` core without modification.
- **What to steal**: The standard mapping table (canonical, no need to invent). The scaled radial deadzone (the "right" way per Sutphin). The threshold-crossing latching pattern (a stick crossing the deadzone latches `pressed`; returning below latches `released` — this is the analog-to-binary bridge that makes the gamepad adapter compose with the binary edge core).
- **What to avoid**: The axial deadzone (causes "snap to cardinal" — bad UX for any analog control). The unscaled radial (loses precision — bad for variable-speed movement). The hybrid/bowtie deadzone (overkill for platformers; reserve for FPS). The "press on every frame the button is held" anti-pattern (the `pressed` boolean is true for every frame the button is held — must diff against previous state to emit edges, exactly like the keyboard adapter's `!e.repeat` check).

### Pattern 2: Polling vs Events (Connect/Disconnect Lifecycle)

- **Source**: MDN "Using the Gamepad API" (`https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API`); W3C Gamepad spec §"Connecting to a gamepad"; progamepadtester.com Gamepad API Tutorial (2026-05).
- **What it does**: The Gamepad API is **poll-based for everything except connect/disconnect**. There are NO events for button presses or axis changes. The only events are `gamepadconnected` and `gamepaddisconnected`. The correct usage pattern is:
  1. Listen for `gamepadconnected` to know WHEN a controller becomes available (and to start the polling loop).
  2. Call `navigator.getGamepads()` once per frame (or per fixed tick) to read the current state.
  3. Use `gamepad.index` as the stable key (NOT the array index — `getGamepads()` returns a sparse array with `null` slots for disconnected pads).
  4. Listen for `gamepaddisconnected` to clean up state and reset accumulators (prevents stuck buttons).
  5. The `gamepadconnected` event itself requires a "gamepad user gesture" — a button press on the controller while the page is focused — to fire (fingerprinting mitigation). The gamepad is hidden until the user interacts with it.

- **Algorithmic shape** (the lifecycle handler):

  ```typescript
  // Lazy host resolution — never at module load
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { poll: () => ({}), dispose: () => {} };
  }

  const onConnect = (e: GamepadEvent): void => {
    if (e.gamepad.mapping !== 'standard') {
      // Non-standard mapping — log once, ignore. Consumer can still use keyboard/touch.
      return;
    }
    // No-op for v1 (pad1 only); v2 would track by index.
  };

  const onDisconnect = (e: GamepadEvent): void => {
    // Reset ALL accumulators — prevents stuck buttons when the controller dies mid-session.
    for (const acc of accs.values()) resetEdge(acc);
  };

  try {
    window.addEventListener('gamepadconnected', onConnect);
    window.addEventListener('gamepaddisconnected', onDisconnect);
  } catch { /* swallow */ }
  ```

- **Determinism profile**: Host-touching. The event listeners are side effects; the `resetEdge` calls are pure (mutate the accumulator buffers in place — same exception category as the renderer-output buffers in `docs/architecture.md`).
- **Runtime cost**: O(1) per event. Events fire rarely (only on physical connect/disconnect).
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** Mirrors the existing `createKeyboardAdapter` lifecycle exactly (event listeners + `dispose()` teardown + `blur` reset). The `resetEdge` on disconnect is the same pattern as the keyboard's `blur` reset.
- **What to steal**: The `gamepadconnected`/`gamepaddisconnected` event listeners (the only events the API exposes). The `resetEdge` on disconnect (prevents stuck buttons). The `mapping === 'standard'` gate (warns and falls back gracefully for non-standard controllers — the consumer can still use keyboard/touch).
- **What to avoid**: The "long-lived reference" anti-pattern — do NOT cache the `Gamepad` object from the connect event. The spec says the object MUST be re-fetched via `getGamepads()` each frame because the browser may return a different object with updated values. Use `gamepad.index` as the stable key, then `getGamepads()[index]` each poll. The "start polling on page load" anti-pattern — polling must start INSIDE the `gamepadconnected` handler (or after the first user gesture), because the API is hidden until then.

### Pattern 3: Browser Quirks & Defensive Null Handling

- **Source**: progamepadtester.com Gamepad API Tutorial (2026-05); Firefox bugzilla 1337161 (fingerprinting); MDN Gamepad API browser compatibility; W3C spec §"Standard Gamepad".
- **What it does**: The Gamepad API has FOUR major cross-browser quirks that the adapter MUST handle defensively:
  1. **User-gesture requirement** — `getGamepads()` returns an array of `null`s until the user presses a button on the controller while the page is focused. Firefox documents this explicitly as a fingerprinting defence; Chromium behaves the same way (W3C spec requirement).
  2. **Secure-context requirement** — Chromium requires HTTPS (or `localhost`); plain HTTP from a LAN IP silently returns `null`s. Firefox lifted this restriction in Firefox 125 (Feb 2024). Safari never had the restriction.
  3. **Firefox axis offset** — Firefox reports an additional axis entry compared to Chrome/Edge for XInput controllers, shifting all axis indices by one position. Code that reads `axes[2]` for right-stick-X in Chrome reads right-stick-Y in Firefox. The robust fix is to check `gamepad.mapping === 'standard'` and trust the spec's canonical indices (works in Chrome/Edge/Safari); Firefox's extra axis is a vendor quirk that the spec-compliant remapping should absorb, but in practice Firefox's remapping is incomplete for some controllers.
  4. **Sparse array from `getGamepads()`** — the returned array has `null` slots for disconnected pads. Must check `if (!pad) continue;` before reading `pad.buttons` or `pad.axes`.
  5. **`timestamp` for change detection** — `gamepad.timestamp` is a `DOMHighResTimeStamp` (monotonically increasing) that tells you when the hardware last reported data. If `timestamp` hasn't changed since the last poll, the button/axis arrays haven't changed either — skip the edge-diff work. Firefox does NOT support `timestamp` (always `0`), so the adapter must fall back to "always diff" when `timestamp === 0`.

- **Algorithmic shape** (the defensive poll):

  ```typescript
  function pollGamepad(): Record<string, PolledEdge> {
    const out: Record<string, PolledEdge> = {};
    if (typeof navigator === 'undefined') return out;

    let pads: (Gamepad | null)[] | null = null;
    try {
      pads = navigator.getGamepads();
    } catch {
      return out;  // Defensive: some sandboxed iframes throw on getGamepads().
    }
    if (!pads) return out;

    const pad = pads[0];
    if (!pad) return out;                              // Sparse array slot.
    if (pad.mapping !== 'standard') return out;        // Non-standard mapping — ignore.
    if (pad.timestamp && pad.timestamp === lastTimestamp) {
      // No new data from hardware — return last snapshot without re-diffing.
      return lastSnapshot;
    }
    lastTimestamp = pad.timestamp;
    // ... rest of poll ...
  }
  ```

- **Determinism profile**: Host-touching. All the defensive checks are pure control flow.
- **Runtime cost**: O(1) for the defensive checks; the `timestamp` short-circuit saves the O(buttons + axes) diff when the hardware hasn't reported new data (common when the controller is idle — the browser may not poll the hardware every frame).
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** Every defensive check is a `typeof` guard or a `null` check — exactly the pattern the existing adapters use.
- **What to steal**: The `typeof navigator === 'undefined'` SSR guard (mirrors `typeof window === 'undefined'` in `keyboard.ts`). The `try/catch` around `getGamepads()` (some sandboxed iframes throw). The sparse-array `null` check. The `mapping === 'standard'` gate. The `timestamp` change-detection short-circuit.
- **What to avoid**: The "trust the array index" anti-pattern — must use `gamepad.index` as the stable key, not the array position. The "cache the Gamepad object from the connect event" anti-pattern — must re-fetch via `getGamepads()` each poll. The "Firefox axis offset" hack — the spec-compliant `mapping === 'standard'` check should handle this; if it doesn't for a specific controller, that's a Firefox bug, not something the adapter should paper over with a user-agent sniff.

### Pattern 4: Phaser / babylon.js / PixiJS Gamepad Abstractions

- **Source**: Phaser 3 `GamepadPlugin` (`https://docs.phaser.io/api-documentation/class/input-gamepad-gamepadplugin`); Phaser 3 `Gamepad` class (`https://docs.phaser.io/api-documentation/class/input-gamepad-gamepad`); Phaser 3 `Axis` class (`https://docs.phaser.io/api-documentation/class/input-gamepad-axis`); Phaser source `src/input/gamepad/GamepadPlugin.js`, `src/input/gamepad/Gamepad.js`, `src/input/gamepad/Axis.js`.
- **What it does**: Phaser (the most-used web gamepad abstraction) exposes:
  - `this.input.gamepad.pad1` through `pad4` — four hard-coded slots for up to four simultaneous controllers.
  - Each `Gamepad` has `leftStick` / `rightStick` as `Vector2` properties (axes 0-1 and 2-3).
  - Each `Gamepad` has a `buttons` array and an `axes` array.
  - Each `Axis` has a `threshold` property (default `0.1`) and a `getValue()` method that returns 0 if `abs(value) < threshold`.
  - `setAxisThreshold(value)` sets the threshold on all axes of the gamepad.
  - Phaser assumes `mapping === 'standard'` and provides per-controller config files (`Sony_PlayStation_DualShock_4.js`, `XBox360_Controller.js`, `SNES_USB_Controller.js`) for non-standard mappings.
  - babylon.js and PixiJS follow similar patterns (pad1/pad2 slots, standard mapping assumption, per-axis threshold).

- **Algorithmic shape** (Phaser's `Axis.getValue()`):

  ```typescript
  // Phaser src/input/gamepad/Axis.js — verified from docs.phaser.io
  getValue(): number {
    return Math.abs(this.value) < this.threshold ? 0 : this.value;
  }
  ```

  Note: Phaser uses the **axial deadzone** (per-axis threshold), not the scaled radial. This is the "naïve" deadzone per Sutphin — fine for 4-way platformer movement, bad for analog precision. Our recommendation is scaled radial because it preserves precision and is the documented "right" way.

- **Determinism profile**: Phaser's gamepad is host-touching (same as ours). The `Axis.getValue()` math is pure.
- **Runtime cost**: O(1) per axis per frame.
- **Dependencies**: Phaser has many; babylon.js has many. We have none — the adapter is the entire abstraction.
- **Fit for our constraints**: **Strong** for the API shape (factory + `poll()` + `dispose()`), **medium** for the deadzone choice (Phaser's axial is worse than scaled radial for analog feel).
- **What to steal**: The factory + `poll()` + `dispose()` shape (mirrors Phaser's plugin lifecycle). The per-axis `threshold` concept (we generalize to per-axis-binding `threshold` in the config). The `mapping === 'standard'` assumption with per-controller config files for non-standard (we ship standard-only for v1; consumers can extend).
- **What to avoid**: The `pad1..pad4` hard-coded slots (Phaser uses these because it's Scene-based; we don't need them — the consumer can re-create the adapter for player 2). The axial deadzone (use scaled radial). The "Phaser is the whole engine" coupling (we are a library, not an engine — the adapter is a single file).

### Pattern 5: Vibration / Haptics (Deferred to v2)

- **Source**: MDN `GamepadHapticActuator` (`https://developer.mozilla.org/en-US/docs/Web/API/GamepadHapticActuator`); MDN `Gamepad.vibrationActuator`; caniuse.com `mdn-api_gamepad_vibrationactuator`; caniuse.com `mdn-api_gamepadhapticactuator_pulse`.
- **What it does**: The Gamepad API exposes two haptic surfaces:
  - `gamepad.vibrationActuator` — a single `GamepadHapticActuator` with `playEffect(type, params)` (e.g. `'dual-rumble'` with `weakMagnitude`, `strongMagnitude`, `duration`).
  - `gamepad.hapticActuators` — an array of `GamepadHapticActuator`s with `pulse(intensity, duration)` and `reset()`.
  - Browser support is **Chrome/Edge only** as of 2026. Firefox does NOT implement either property. Safari does NOT implement vibration (per progamepadtester.com 2026-05).
  - The MDN page marks both as "Limited availability" — not Baseline.

- **Algorithmic shape** (what v2 would look like):

  ```typescript
  interface GamepadAdapter {
    poll(): Record<string, PolledEdge>;
    rumble(effect: { duration: number; weak: number; strong: number }): void;
    dispose(): void;
  }

  function rumble(effect): void {
    if (typeof navigator === 'undefined') return;
    try {
      const pad = navigator.getGamepads()?.[0];
      if (!pad?.vibrationActuator?.playEffect) return;  // Firefox/Safari: no-op
      pad.vibrationActuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: effect.duration,
        weakMagnitude: effect.weak,
        strongMagnitude: effect.strong,
      });
    } catch { /* swallow */ }
  }
  ```

- **Determinism profile**: Host-touching. `playEffect` returns a Promise; the adapter must swallow rejections.
- **Runtime cost**: O(1) per rumble call.
- **Dependencies**: None.
- **Fit for our constraints**: **Weak for v1.** Browser support is Chrome-only; Firefox and Safari users would get silent no-ops, which is confusing. The API is also Promise-based, which adds a second host-touching surface that needs its own defensive adapter (separate from the polling adapter).
- **What to steal**: The defensive `try/catch` around `playEffect` (returns a Promise that can reject). The `if (!pad?.vibrationActuator?.playEffect) return` guard for unsupported browsers.
- **What to avoid**: Shipping rumble in v1. The browser-support gap is too wide; the API surface is too different from the polling adapter (Promise-based vs sync); and the consumer can call `navigator.getGamepads()[0].vibrationActuator` directly if they want Chrome-only rumble. Defer to v2 when Firefox support lands (or when the spec stabilizes the `effects` enum).

---

## Reference Implementations

| Source | What it teaches | URL |
|---|---|---|
| **W3C Gamepad Specification** | Canonical Standard Gamepad button/axis indices. The source of truth for `mapping === 'standard'`. | https://w3c.github.io/gamepad/ |
| **MDN Gamepad API** | Browser compatibility, `Gamepad`/`GamepadButton`/`GamepadHapticActuator` interface shapes, `getGamepads()` semantics. | https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API |
| **MDN Using the Gamepad API** | The canonical polling pattern: listen for `gamepadconnected`, poll `getGamepads()` per frame, use `gamepad.index` as stable key. | https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API |
| **Josh Sutphin "Doing Thumbstick Dead Zones Right"** | The three deadzone styles (axial, radial, scaled radial) with diagrams and use-case recommendations. The "right way" is scaled radial. | https://joshsutphin.com/blog/doing-thumbstick-dead-zones-right.html |
| **Minimuino thumbstick-deadzones** | Extended deadzone catalog (axial, radial, scaled radial, sloped axial, hybrid, inner+outer). Interactive demo. | https://github.com/Minimuino/thumbstick-deadzones |
| **Phaser 3 `GamepadPlugin`** | Industry-standard gamepad abstraction. `pad1..pad4` slots, `Axis.threshold`, standard mapping assumption. | https://docs.phaser.io/api-documentation/class/input-gamepad-gamepadplugin |
| **Phaser 3 `Gamepad`** | Per-gamepad `leftStick`/`rightStick` Vector2, `buttons` array, `setAxisThreshold(value)`. | https://docs.phaser.io/api-documentation/class/input-gamepad-gamepad |
| **Phaser 3 `Axis`** | The `getValue()` deadzone application: `abs(value) < threshold ? 0 : value`. Note: Phaser uses axial, not scaled radial. | https://docs.phaser.io/api-documentation/class/input-gamepad-axis |
| **progamepadtester.com Gamepad API Tutorial** | 2026-era browser-quirk summary: user-gesture requirement, secure-context requirement, Firefox axis offset, sparse array from `getGamepads()`, vibration browser support. | https://progamepadtester.com/gamepad-api-tutorial/ |
| **Unreal Engine `DeadZoneType`** | Engine-grade deadzone enum: `AXIAL`, `RADIAL`, `UNSCALED_RADIAL`. Confirms scaled radial is the production default. | https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/DeadZoneType |
| **aicraft-engine `src/input/keyboard.ts`** | Local reference for the defensive-adapter pattern this adapter must mirror. | `src/input/keyboard.ts` |
| **aicraft-engine `src/input/touch-button.ts`** | Local reference for single-element pointer tracking (different shape — gamepad is polling, not event-listening). | `src/input/touch-button.ts` |
| **aicraft-engine `src/input/edges.ts`** | Local reference for the deterministic edge-accumulator core that the adapter feeds. | `src/input/edges.ts` |

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Standard Gamepad layout diagram | The canonical button/axis positions: right cluster (0-3), shoulder buttons (4-7), center cluster (8-9, 16), stick clicks (10-11), left cluster/D-pad (12-15), left stick axes (0-1), right stick axes (2-3). | W3C Gamepad spec §"Standard Gamepad" |
| Axial vs radial vs scaled radial deadzone diagrams | Side-by-side comparison of the three deadzone shapes. Axial = square (snap to cardinal). Radial = circle (smooth but loses precision). Scaled radial = circle with rescaled output (smooth AND preserves precision). | Josh Sutphin "Doing Thumbstick Dead Zones Right" |
| Minimuino interactive deadzone demo | Live comparison of axial, radial, scaled radial, sloped axial, hybrid, and inner+outer deadzones. Move a virtual stick and see the output. | https://minimuino.github.io/thumbstick-deadzones/demo/ |
| Gamepad tester (live hardware test) | Real-time button/axis display for verifying your controller's standard mapping before writing code. | https://gamepadtester.net |

---

## Open Questions

1. **Multi-gamepad in v1 or v2?** Phaser ships `pad1..pad4`; many web games support 2-player local co-op. The argument for v1: the adapter is small, the multi-pad pattern is just a `Map<index, EdgeAccumulator>`. The argument for v2: most consumer games (Spitekeep, the upcoming Sokpop-style titles) are single-player; shipping multi-pad adds API surface that may never be used. **Recommendation: ship `pad1` only in v1; document the v2 path (consumer creates a second adapter for player 2).** This is a design decision for `@api-designer`.

2. **Analog stick → continuous vector OR threshold-latched edges?** The existing core is purely binary (`PolledEdge`). The gamepad adapter could either:
   - (a) Latch threshold-crossings into `EdgeAccumulator`s (composes with `orEdges`, but loses analog feel — stick position is binary).
   - (b) Expose a separate `vector: { x, y }` field on the poll result (preserves analog feel, but breaks the `orEdges` composition).
   - (c) Both — `edges` for binary actions (jump, dash) AND `vector` for analog actions (camera, movement speed).
   - **Recommendation: ship (a) for v1 (composes with the existing core); expose (c) as a follow-up if consumers need analog feel.** This is a design decision for `@api-designer`.

3. **Deadzone default value?** Sutphin recommends `0.25` as a reasonable default; Phaser uses `0.1` (too low — causes drift on worn sticks); Unreal's default is `0.2`. **Recommendation: `0.25` for v1** (Sutphin's recommendation; matches Unreal's `RADIAL` default; safe for old/worn controllers). Configurable via `GamepadConfig.deadzone`.

4. **Deadzone style — radial vs axial vs scaled radial?** The three styles have very different feel:
   - Axial: cheap, causes "snap to cardinal" (bad for analog feel).
   - Radial (unscaled): smooth cardinal transitions, loses precision (clips the input range).
   - Scaled radial: smooth AND preserves precision (the "right" way per Sutphin).
   - **Recommendation: scaled radial for v1** (the documented best practice; matches Unreal's `RADIAL` default; ~3 extra lines of code vs unscaled radial). Configurable via `GamepadConfig.deadzoneStyle: 'scaled-radial' | 'radial' | 'axial'`.

5. **Rumble in v1 or v2?** Browser support is Chrome-only (Firefox/Safari do not implement as of 2026). The API is Promise-based, which adds a second host-touching surface. **Recommendation: defer to v2.** Consumers who want Chrome-only rumble can call `navigator.getGamepads()[0].vibrationActuator.playEffect(...)` directly. This is a design decision for `@api-designer`.

6. **`timestamp`-based change detection — always-on or opt-in?** The `timestamp` short-circuit saves the O(buttons + axes) diff when the hardware hasn't reported new data (common when the controller is idle). Firefox does NOT support `timestamp` (always `0`), so the adapter must fall back to "always diff" when `timestamp === 0`. **Recommendation: always-on** (zero consumer-facing API; pure performance optimization; safe for Firefox).

7. **Non-standard mapping handling?** The spec says browsers SHOULD remap to standard when they recognize the controller. Some controllers (e.g. SNES USB, some fight sticks) are NOT remapped. Phaser ships per-controller config files for these. **Recommendation: warn once and no-op for v1** (the consumer can still use keyboard/touch). Document the v2 path (consumer provides a custom `buttonToAction` map keyed by raw button index).

---

## Top 3 Patterns Worth Prototyping

1. **Standard mapping + scaled radial deadzone + threshold-latching core** — The minimum viable adapter. `createGamepadAdapter(config)` returns `{ poll(), dispose() }`. `poll()` reads `navigator.getGamepads()[0]`, requires `mapping === 'standard'`, applies a scaled radial deadzone (default `0.25`) to each analog stick, diffs button `pressed` booleans against previous state, diffs axis threshold-crossings against previous state, and feeds the diffs into per-action `EdgeAccumulator`s via `pressEdge`/`releaseEdge`. The consumer OR-merges with keyboard/touch via the existing `orEdges` helper. This is the foundation everything else builds on.

2. **Connect/disconnect lifecycle with `mapping !== 'standard'` graceful degradation** — The defensive-adapter pattern that mirrors `createKeyboardAdapter` exactly. Lazy `window`/`navigator` resolution (SSR/Node fallback to `poll: () => ({})`). `gamepadconnected`/`gamepaddisconnected` event listeners with `try/catch`. `resetEdge` on disconnect (prevents stuck buttons when the controller dies mid-session). `mapping !== 'standard'` gate that warns once and returns `{}` from `poll()` (consumer falls back to keyboard/touch). `dispose()` removes listeners idempotently. This is what makes the adapter safe to use in production.

3. **`timestamp`-based change detection + sparse-array null handling** — The performance and robustness optimization. Cache `lastTimestamp` per gamepad; if `pad.timestamp === lastTimestamp && pad.timestamp !== 0`, return the last snapshot without re-diffing (saves ~21 comparisons per tick when the controller is idle). Always check `if (!pad) continue` for sparse-array `null` slots. Always `try/catch` around `navigator.getGamepads()` (some sandboxed iframes throw). This is what makes the adapter production-grade.

---

## Cross-References

- **Related notes in `docs/research/`**:
  - `docs/research/mobile-directional-input.md` — The closest analog: virtual thumbsticks that threshold analog 2D vectors into binary edges. The gamepad adapter uses the same threshold-latching pattern but with a different input source (gamepad axes vs pointer coordinates). The deadzone math is also shared (the mobile thumbstick uses a `deadZone` config; the gamepad adapter should use the same name).
- **Related strategic docs in `ai-craft-strategy/`**:
  - `ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md` — Sokpop games are desktop-first; gamepad support is table-stakes for the minimalist-procedural genre.
- **Existing modules in `src/`**:
  - `src/input/edges.ts` — The deterministic edge-accumulator core that the adapter feeds. UNCHANGED by this work.
  - `src/input/keyboard.ts` — The canonical defensive-adapter pattern this adapter must mirror (lazy host resolution, swallow errors, never-throw, `{}` fallback in Node/SSR, `dispose()` idempotent teardown).
  - `src/input/touch-button.ts` — Single-element pointer tracking (different shape — gamepad is polling, not event-listening; but the `EdgeAccumulator` integration is identical).
  - `src/input/touch-button-set.ts` — Multi-element pointer tracking with `pointerId` sets (gamepad has no equivalent — gamepad buttons are identified by index, not by pointer ID).
  - `src/input/merge.ts` — The `orEdges` helper that the consumer uses to combine gamepad edges with keyboard/touch edges.
  - `src/input/types.ts` — The `EdgeAccumulator`, `PolledEdge`, `KeyboardAdapter`, `TouchButtonAdapter`, `TouchButtonSetAdapter` interfaces. The new `GamepadAdapter` and `GamepadConfig` types belong here.
