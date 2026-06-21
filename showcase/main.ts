/**
 * Showcase bootstrap.
 *
 * Wires the global store, reads `?seed=` from the URL (host-side input, not
 * a determinism leak — see proposal §6), injects the library's
 * `DEFAULT_OUTLINE_COLOR` into CSS so the page chrome and the canvas cannot
 * drift, and initializes the hero section.
 */

import { DEFAULT_OUTLINE_COLOR } from '../src/primitives';
import { createStore } from './store';
import { initHero } from './sections/hero';
import { initLavaPool } from './sections/lava-pool';
import { initPlayground } from './sections/playground';

/**
 * Global showcase state. The hero fields are populated; the rest of the
 * fields (determinism prover, primitives playground, etc.) will be added
 * as those sections come online.
 *
 * The palette is NOT cached here. Any consumer needing the palette calls
 * `generatePalette(state.heroSeed)` directly. Caching it here previously
 * caused a nested `store.set` inside the seed subscriber — a fragile
 * anti-pattern that produced stale-DOM symptoms in screenshot tooling.
 */
export interface GlobalState {
  /** Current hero seed (drives `deriveHeroConfig`). */
  heroSeed: number;
  /** Runtime gait speed multiplier (0 = idle, 1 = walk, 2 = run). */
  heroSpeed: number;
}

/** Default seed when no `?seed=` is present. Stable so the landing page is consistent. */
const DEFAULT_SEED = 98724;

/**
 * Read the seed from the URL's `?seed=` query parameter.
 *
 * Returns `null` for missing / non-finite / out-of-32-bit-range values. The
 * library's deterministic core never touches the URL — the showcase reads
 * it and passes the value into `mulberry32(seed)`, identical to how a game
 * reads a save file.
 */
function readSeedFromURL(): number | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('seed');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 2_147_483_647 ? n : null;
}

/**
 * Write the seed to the URL's `?seed=` query parameter (replaceState, so the
 * back button is not polluted). Lets users share / bookmark a specific hero.
 */
function writeSeedToURL(seed: number): void {
  const url = new URL(window.location.href);
  url.searchParams.set('seed', String(seed));
  window.history.replaceState(null, '', url);
}

// --- Boot -----------------------------------------------------------------

const initialSeed = readSeedFromURL() ?? DEFAULT_SEED;

const store = createStore<GlobalState>({
  heroSeed: initialSeed,
  heroSpeed: 1,
});

// Inject the library's outline color into CSS so `--outline` and
// DEFAULT_OUTLINE_COLOR can never drift. The library is the single source
// of truth for the outline color.
document.documentElement.style.setProperty('--outline', DEFAULT_OUTLINE_COLOR);

// Keep the URL in sync with the seed whenever it changes (so the 🎲 button
// produces a shareable link). Skipped for the initial load if the URL
// already has a seed.
let urlSeeded = readSeedFromURL() !== null;
store.subscribe((state, prev) => {
  if (state.heroSeed !== prev.heroSeed) {
    if (urlSeeded || state.heroSeed !== DEFAULT_SEED) {
      writeSeedToURL(state.heroSeed);
    }
    urlSeeded = true;
  }
});

// Initialize sections.
const heroSection = document.getElementById('hero');
if (heroSection) {
  initHero(heroSection, store);
} else {
  // Defensive: should never happen — index.html always has <section id="hero">.
}

const lavaPoolSection = document.getElementById('lava-pool');
if (lavaPoolSection) {
  initLavaPool(lavaPoolSection, store);
}

const playgroundSection = document.getElementById('playground');
if (playgroundSection) {
  initPlayground(playgroundSection, store);
}
