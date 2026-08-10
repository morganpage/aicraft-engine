/**
 * Audio module — WebAudio synthesized SFX defensive adapter.
 *
 * Ports the reference synthesis engine into the library's per-instance
 * factory pattern (see `src/input/keyboard.ts`, `src/input/touch-button.ts`).
 * The library ships the generic infrastructure — `playTone` / `playNoise` —
 * NOT the game-specific recipe table. Consumers compose sounds from these
 * two primitives.
 *
 * Defensive adapter (host-touching layer). Follows `src/primitives/motion.ts`:
 *   - Lazy `AudioContext` resolution on first `unlock()` — never at module load.
 *   - Swallow all errors. Never-throw public API.
 *   - No-op fallback in Node / SSR / old browsers (no `window`).
 *
 * Note: `Math.random()` is used to fill the noise buffer. This is explicitly
 * allowed — decorative audio side-effect, NOT deterministic simulation logic.
 *
 * @module
 */

export type { AudioAdapter } from './types';
export { DEFAULT_AUDIO_VOLUME } from './constants';
export { createAudioAdapter } from './factory';
