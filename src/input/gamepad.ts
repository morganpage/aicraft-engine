/**
 * Defensive gamepad input adapter (host-touching layer).
 *
 * Polls `navigator.getGamepads()` once per tick, maps the W3C Standard
 * Gamepad layout (button indices 0-16, axes 0-3) to logical actions, applies
 * an **axial per-axis threshold** deadzone to analog axes, and latches
 * threshold-crossings + button state changes into one
 * {@link EdgeAccumulator} per action — the same core the keyboard and touch
 * adapters feed. OR-merges with keyboard/touch via the existing `orEdges`.
 *
 * Follows the canonical defensive-adapter pattern
 * (`src/primitives/motion.ts`), mirroring {@link createKeyboardAdapter}:
 *   - **Lazy host resolution** — `navigator` / `window` are resolved INSIDE
 *     {@link createGamepadAdapter}, never at module load, so the module is
 *     safe to import in Node / SSR / test environments.
 *   - **SSR guard** — `typeof navigator === 'undefined' ||
 *     typeof navigator.getGamepads !== 'function'` short-circuits to a no-op
 *     adapter whose `poll()` returns `{}`.
 *   - **Swallow all errors** — `getGamepads()`, `addEventListener`, and
 *     `removeEventListener` are all wrapped in try/catch. A broken host
 *     never crashes the game.
 *   - **Never-throw public API** — `poll()` / `dispose()` degrade gracefully.
 *
 * Determinism: `poll()` reads host state (DOM read — the same exception
 * category as the keyboard adapter) and feeds pure threshold/diff logic into
 * the `EdgeAccumulator`s. `gamepad.timestamp` is used ONLY for change-
 * detection (skip the diff when hardware hasn't reported new data) and NEVER
 * feeds simulation state.
 *
 * Decision record: `docs/design/gamepad-adapter-decision.md` (Approach A:
 * Full Parity — Keyboard-Mirror Pattern).
 * Proposal: `docs/design/gamepad-adapter-proposal.md`.
 * Research: `docs/research/gamepad-adapter.md`.
 *
 * @module
 */

import {
  createEdgeAccumulator,
  pressEdge,
  releaseEdge,
  resetEdge,
  pollEdge,
} from './edges';
import type {
  AxisBinding,
  EdgeAccumulator,
  GamepadAdapter,
  GamepadConfig,
  PolledEdge,
} from './types';

/**
 * Default analog-stick deadzone magnitude. Applied **per-axis independently**
 * (axial threshold: `Math.abs(raw) >= deadzone`). Chosen as the Sutphin
 * recommendation and adequate for platformer movement per the research note
 * (Phaser Pattern 4). Override per-adapter via {@link GamepadConfig.deadzone}.
 */
export const DEFAULT_GAMEPAD_DEADZONE = 0.25;

/**
 * Minimal structural shape the adapter reads off a `Gamepad`. Defined locally
 * (not the lib.dom `Gamepad`) so the adapter does not depend on the DOM lib
 * types and so tests can inject synthetic pads without fighting the type
 * system. Field names mirror the W3C spec exactly.
 */
interface ReadableGamepad {
  readonly id: string;
  readonly mapping: string;
  readonly timestamp: number;
  readonly buttons: ReadonlyArray<{ readonly pressed: boolean }>;
  readonly axes: ReadonlyArray<number>;
}

interface ReadableNavigator {
  getGamepads(): (ReadableGamepad | null)[] | null;
}

/** A listener matching the `GamepadEvent`-shaped callback the adapter registers. */
type GamepadListener = (e: { readonly gamepad?: unknown }) => void;

/**
 * Create a defensive gamepad input adapter for the given button/axis mapping.
 *
 * Lazily resolves `navigator` / `window` at call time (NOT at module load).
 * When `navigator` is undefined or lacks `getGamepads` (Node, SSR, test
 * env), returns a no-op adapter whose `poll()` returns an empty record `{}`
 * — the gamepad contributes nothing, so the consumer's OR-merge with other
 * devices is trivial. Never throws.
 *
 * Installs `gamepadconnected` / `gamepaddisconnected` listeners on `window`
 * (best-effort, try/catch). On disconnect, all accumulators are
 * {@link resetEdge}d (stuck-button safety) and the cached timestamp is
 * cleared so a reconnect is always observed fresh.
 *
 * @param config - Button/axis mapping (see {@link GamepadConfig}).
 * @returns A defensive {@link GamepadAdapter}.
 *
 * @example
 * ```ts
 * const gamepad = createGamepadAdapter({
 *   buttonToAction: { '0': 'jump', '14': 'left', '15': 'right' },
 *   axisToAction: {
 *     '0': { positive: 'right', negative: 'left' },
 *     '1': { positive: 'down', negative: 'up' },
 *   },
 *   deadzone: 0.25,
 * });
 * // once per fixed tick:
 * const edges = gamepad.poll();
 * if (edges['jump']?.pressed) bufferJump();
 * ```
 */
export function createGamepadAdapter(config: GamepadConfig): GamepadAdapter {
  const buttonToAction = config.buttonToAction ?? {};
  const axisToAction = config.axisToAction ?? {};
  const deadzone =
    typeof config.deadzone === 'number' ? config.deadzone : DEFAULT_GAMEPAD_DEADZONE;

  // Closure-scoped state ONLY — no module-level globals (mirrors keyboard.ts).
  const accs = new Map<string, EdgeAccumulator>();
  for (const action of Object.values(buttonToAction)) {
    if (!accs.has(action)) accs.set(action, createEdgeAccumulator());
  }
  for (const binding of Object.values(axisToAction)) {
    if (binding.positive && !accs.has(binding.positive)) {
      accs.set(binding.positive, createEdgeAccumulator());
    }
    if (binding.negative && !accs.has(binding.negative)) {
      accs.set(binding.negative, createEdgeAccumulator());
    }
  }

  // Previous-frame per-source held state, used to diff press/release. Keyed
  // by SOURCE INDEX (button index / axis index+direction) so that multiple
  // buttons mapping to the same action each diff independently and the shared
  // accumulator coalesces their edges.
  const prevButtonHeld = new Map<string, boolean>();
  const prevAxisPositiveHeld = new Map<string, boolean>();
  const prevAxisNegativeHeld = new Map<string, boolean>();

  let lastTimestamp = 0;
  let lastSnapshot: Record<string, PolledEdge> = {};
  let warnedNonStandard = false;
  let disposed = false;

  // SSR / no-host guard — more precise than the keyboard adapter's `window`
  // check because the gamepad API lives on `navigator.getGamepads()`.
  const nav: ReadableNavigator | undefined =
    typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
      ? (navigator as ReadableNavigator)
      : undefined;

  const onDisconnect: GamepadListener = (): void => {
    for (const acc of accs.values()) resetEdge(acc);
    prevButtonHeld.clear();
    prevAxisPositiveHeld.clear();
    prevAxisNegativeHeld.clear();
    lastTimestamp = 0;
    lastSnapshot = {};
  };

  const onConnect: GamepadListener = (): void => {
    // v1 is single-pad; no per-index tracking. Listener exists for lifecycle
    // parity with the keyboard adapter and to support a future v2.
  };

  if (!nav) {
    return {
      poll: () => ({}),
      dispose: () => {
        // No host was ever attached.
      },
    };
  }

  // Attached only once a host is confirmed, so the no-nav adapter above never
  // touches the host (its dispose() removes nothing).
  if (typeof window !== 'undefined') {
    try {
      window.addEventListener('gamepadconnected', onConnect as EventListener);
      window.addEventListener('gamepaddisconnected', onDisconnect as EventListener);
    } catch {
      // A broken window never crashes the game.
    }
  }

  const buildSnapshot = (pad: ReadableGamepad): Record<string, PolledEdge> => {
    // 1. Buttons — diff pressed vs prior, keyed by button index so multiple
    //    buttons mapping to the same action each diff independently (the
    //    shared accumulator coalesces their edges).
    for (const [idxStr, action] of Object.entries(buttonToAction)) {
      const btn = pad.buttons[Number(idxStr)];
      if (!btn) continue;
      const now = btn.pressed;
      const was = prevButtonHeld.get(idxStr) ?? false;
      if (now && !was) {
        const acc = accs.get(action);
        if (acc) pressEdge(acc);
      } else if (!now && was) {
        const acc = accs.get(action);
        if (acc) releaseEdge(acc);
      }
      prevButtonHeld.set(idxStr, now);
    }

    // 2. Axes — axial per-axis threshold deadzone (`Math.abs(raw) >= deadzone`).
    //    Each axis-direction diffs against its own prev state (keyed by
    //    `${axisIdx}:pos` / `${axisIdx}:neg`) so multiple axes mapping to the
    //    same action each diff independently.
    for (const [idxStr, binding] of Object.entries(axisToAction)) {
      applyAxisDiff(idxStr, binding, pad, deadzone);
    }

    // 3. Drain accumulators into a fresh snapshot.
    const out: Record<string, PolledEdge> = {};
    for (const [action, acc] of accs) {
      out[action] = pollEdge(acc);
    }
    return out;
  };

  const applyAxisDiff = (
    idxStr: string,
    binding: AxisBinding,
    pad: ReadableGamepad,
    dz: number,
  ): void => {
    if (binding.positive === undefined && binding.negative === undefined) return;
    const raw = pad.axes[Number(idxStr)] ?? 0;
    const mag = Math.abs(raw);
    const triggered = mag >= dz;

    // Positive direction — keyed by `${idxStr}:pos` so multiple axes mapping
    // to the same action each diff independently.
    if (binding.positive !== undefined) {
      const action = binding.positive;
      const key = `${idxStr}:pos`;
      const now = triggered && raw > 0;
      const was = prevAxisPositiveHeld.get(key) ?? false;
      const acc = accs.get(action);
      if (acc) {
        if (now && !was) pressEdge(acc);
        else if (!now && was) releaseEdge(acc);
      }
      prevAxisPositiveHeld.set(key, now);
    }

    // Negative direction — keyed by `${idxStr}:neg`.
    if (binding.negative !== undefined) {
      const action = binding.negative;
      const key = `${idxStr}:neg`;
      const now = triggered && raw < 0;
      const was = prevAxisNegativeHeld.get(key) ?? false;
      const acc = accs.get(action);
      if (acc) {
        if (now && !was) pressEdge(acc);
        else if (!now && was) releaseEdge(acc);
      }
      prevAxisNegativeHeld.set(key, now);
    }
  };

  return {
    poll(): Record<string, PolledEdge> {
      let pads: (ReadableGamepad | null)[] | null;
      try {
        pads = nav.getGamepads();
      } catch {
        // Sandboxed iframes and some test harnesses throw on getGamepads().
        return {};
      }
      if (!pads) return {};
      const pad = pads[0];
      if (!pad) return {};

      if (pad.mapping !== 'standard') {
        if (!warnedNonStandard) {
          warnedNonStandard = true;
          try {
            console.warn(
              `[aicraft-engine] gamepad: ignoring non-standard mapping (id="${pad.id}"). ` +
                `Falling back to keyboard/touch.`,
            );
          } catch {
            // Even console.warn can throw in some sandboxes — swallow.
          }
        }
        return {};
      }

      // Timestamp short-circuit: skip re-diff when hardware hasn't reported
      // new data. Firefox reports timestamp === 0 → always re-diff.
      if (pad.timestamp !== 0 && pad.timestamp === lastTimestamp) {
        return lastSnapshot;
      }

      const snapshot = buildSnapshot(pad);
      lastTimestamp = pad.timestamp;
      // Cache the STEADY STATE (held only, edges already consumed by
      // pollEdge during buildSnapshot) so a subsequent short-circuit does
      // NOT re-fire the one-tick pressed/released edges. Without this, a
      // cached snapshot with pressed:true would surface twice.
      const steady: Record<string, PolledEdge> = {};
      for (const action of Object.keys(snapshot)) {
        steady[action] = { held: snapshot[action].held, pressed: false, released: false };
      }
      lastSnapshot = steady;
      return snapshot;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (typeof window !== 'undefined') {
        try {
          window.removeEventListener('gamepadconnected', onConnect as EventListener);
          window.removeEventListener('gamepaddisconnected', onDisconnect as EventListener);
        } catch {
          // Swallow — idempotent teardown must not throw.
        }
      }
    },
  };
}
