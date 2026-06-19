import { prefersReducedMotion } from '../../src/primitives';

/**
 * Single source of truth for "should the showcase avoid running animation
 * loops for this user".
 *
 * NOTE on naming: this returns `true` when the user has requested REDUCED
 * motion (i.e. when the section should SKIP its animation loop and render a
 * static frame). The name reads as "should animate?" but the proposal §3
 * fixes the binding `shouldAnimate = prefersReducedMotion` so that the
 * `if (shouldAnimate()) { renderStatic(); return; }` shape is uniform across
 * every section. Read it as "should-use-the-static-frame branch?".
 *
 * Cached at module load via `prefersReducedMotion()` (which probes
 * `window.matchMedia('(prefers-reduced-motion: reduce)')` once and caches).
 * Defensive: returns `false` (animate normally) when `window` is missing
 * (SSR, Node) or `matchMedia` throws.
 */
export const shouldAnimate = prefersReducedMotion;
