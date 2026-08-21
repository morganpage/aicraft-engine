import type { AudioAdapter } from 'aicraft-engine';

/** Options for {@link attachAudioUnlock}. */
export interface AttachAudioUnlockOptions {
  /**
   * Event names that count as the first user gesture. Defaults to
   * `['keydown', 'pointerdown', 'touchstart', 'click']`.
   */
  readonly events?: readonly string[];
  /**
   * The event target to listen on. Defaults to `window` (falling back to
   * `document`), resolved lazily so the module is import-safe in Node/SSR.
   * Pass any `EventTarget` to make the wiring testable.
   */
  readonly target?: EventTarget;
}

/**
 * Unlock the audio adapter on the first user gesture (one-shot).
 *
 * Browsers start `AudioContext` suspended until a user gesture; the engine's
 * adapter exposes `unlock()` for exactly this moment, and every game wires it
 * the same way: add listeners, remove them all on the first fire, call
 * `unlock()` once. This recipe is that wiring, defensive in Node/SSR (no
 * `window` → silent no-op), and testable via an injected `EventTarget`.
 *
 * @param adapter - the adapter created by `createAudioAdapter()` (only the
 *   `unlock` method is required)
 * @param options - optional event names / target overrides
 * @returns a detach function that removes any remaining listeners (idempotent)
 *
 * @example
 * ```ts
 * const audio = createAudioAdapter();
 * const detachAudioUnlock = attachAudioUnlock(audio);
 * // later, if the game tears down before the first gesture:
 * detachAudioUnlock();
 * ```
 */
export function attachAudioUnlock(
  adapter: Pick<AudioAdapter, 'unlock'>,
  options: Readonly<AttachAudioUnlockOptions> = {},
): () => void {
  const target = options.target ?? resolveDefaultTarget();
  if (target === null) return () => {};

  const events = options.events ?? ['keydown', 'pointerdown', 'touchstart', 'click'];
  let fired = false;

  const onFirstGesture = (): void => {
    if (fired) return;
    fired = true;
    for (const name of events) target.removeEventListener(name, onFirstGesture);
    adapter.unlock();
  };

  for (const name of events) target.addEventListener(name, onFirstGesture);

  return () => {
    for (const name of events) target.removeEventListener(name, onFirstGesture);
  };
}

/** Lazily resolve the default gesture target. `window` first (key/pointer
 * events bubble to it), then `document`; `null` in environments with neither. */
function resolveDefaultTarget(): EventTarget | null {
  try {
    const w = (globalThis as { window?: EventTarget }).window;
    if (w && typeof w.addEventListener === 'function') return w;
    const d = (globalThis as { document?: EventTarget }).document;
    if (d && typeof d.addEventListener === 'function') return d;
  } catch {
    // Swallow — a hostile host means no unlock wiring, never a crash.
  }
  return null;
}
