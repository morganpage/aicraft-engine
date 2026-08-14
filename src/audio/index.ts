/**
 * Audio module — WebAudio synthesized SFX defensive adapter.
 *
 * Ports the reference synthesis engine into the library's per-instance
 * factory pattern (see `src/input/keyboard.ts`, `src/input/touch-button.ts`).
 * The library ships the generic infrastructure — `playTone` / `playNoise`
 * one-shots plus `startNoiseLoop` for sustained sounds — NOT the
 * game-specific recipe table. Consumers compose sounds from these primitives.
 *
 * Defensive adapter (host-touching layer). Follows `src/primitives/motion.ts`:
 *   - Lazy `AudioContext` resolution on first `unlock()` — never at module load.
 *   - Swallow all errors. Never-throw public API.
 *   - No-op fallback in Node / SSR / old browsers (no `window` / `AudioContext`).
 *
 * Note: `Math.random()` fills the noise buffer and picks each burst's playback
 * offset. This is explicitly allowed — decorative audio side-effects, NOT
 * deterministic simulation logic.
 *
 * @module
 */

export type { AudioAdapter, NoiseLoopHandle } from './types';
export { DEFAULT_AUDIO_VOLUME } from './constants';
export { createAudioAdapter } from './factory';
