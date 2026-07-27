/**
 * Named tunables for the music module. No magic numbers in the scheduler or
 * generator — every default lives here so consumers can override.
 *
 * @module
 */

/** Default swing ratio (straight — 50/50 long-short split). */
export const DEFAULT_SWING = 0.5;

/** Default tempo (beats per minute). Chill ambient baseline. */
export const DEFAULT_BPM = 110;

/** Default subdivision: 4 steps per beat = 16th notes. */
export const DEFAULT_STEPS_PER_BEAT = 4;

/** Default pattern length: 16 steps = one bar of 16th notes in 4/4. */
export const DEFAULT_STEPS_PER_PATTERN = 16;

/** JS scheduler poll interval (ms). Chris Wilson's canonical 25 ms. */
export const LOOKAHEAD_MS = 25;

/** Lookahead window (seconds). Chris Wilson's canonical 100 ms. */
export const SCHEDULE_AHEAD_S = 0.1;

/** Default music volume multiplier (1 = unity, independent of SFX volume). */
export const DEFAULT_MUSIC_VOLUME = 1;

/** Default root MIDI note for `generatePattern` (C3 — bass range). */
export const DEFAULT_ROOT_MIDI = 48;

/** Number of octaves `buildScale` spans by default. */
export const DEFAULT_SCALE_OCTAVES = 2;
