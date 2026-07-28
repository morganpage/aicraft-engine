# API Surface

> Living document. Must always match `src/`. Drift = integration pain for consumers.
> Maintained by `@api-designer`. The `@team` orchestrator checks this before committing any change to `src/`.

## How to read this

Each module's exports are listed with a one-line summary. For full signatures, see the JSDoc in the source file (linked).

---

## Pillar 1: Primitives

### `src/primitives/`

Color math, pixel helpers, motion probe. (The animation helpers — `bob`, `pulse`, `sineShake`, `shakeEnvelope`, and `Vec2` — have migrated to `src/animation/`; see the `src/animation/` section below.)

| Export | Kind | Summary | Source |
|---|---|---|---|
| `outlineRect(ctx, x, y, w, h, fill, outline?, coverage?)` | function | Flat-fill rect with 1px dark outline; `coverage` controls pixel-grid snapping: `'floor'` (default, snaps down) or `'ceil'` (snaps up) | `src/primitives/outline-rect.ts` |
| `OutlineCoverage` | type | `'floor' \| 'ceil'` — fill-extent policy for `outlineRect` (`'floor'` truncates to `floor(w/h)`; `'ceil'` covers the full geometric bounds for fractional-position rects) | `src/primitives/outline-rect.ts` |
| `DEFAULT_OUTLINE_COLOR` | const | `'#1d1128'` — Spitekeep's near-black outline | `src/primitives/outline-rect.ts` |
| `parseHex(hex)` | function | `#rrggbb` → `{r, g, b}` record; throws on invalid input | `src/primitives/color.ts` |
| `isHexColor(value)` | function | Non-throwing type guard for complete six-digit hex strings, with or without `#` | `src/primitives/color.ts` |
| `safeHex(value, fallback)` | function | Return a valid input or fallback; malformed fallback degrades to black | `src/primitives/color.ts` |
| `toHex({r, g, b})` | function | `{r, g, b}` → `#rrggbb`; channels rounded and clamped | `src/primitives/color.ts` |
| `shade(hex, factor)` | function | Multiply channels by factor (<1 darkens, >1 lightens, clamped) | `src/primitives/color.ts` |
| `mixHex(a, b, t)` | function | Linear interpolation between two hex colors | `src/primitives/color.ts` |
| `complement(hex)` | function | Channel-wise complement (255 - channel) | `src/primitives/color.ts` |
| `relativeLuminance(hex)` | function | WCAG 2.x relative luminance in [0, 1] | `src/primitives/color.ts` |
| `contrastRatio(a, b)` | function | WCAG contrast ratio in [1, 21]; symmetric | `src/primitives/color.ts` |
| `meetsWcagAa(a, b)` | function | True if contrast ≥ 4.5:1 (GDD §11.3 rule) | `src/primitives/color.ts` |
| `RGB` | type | `{r: number; g: number; b: number}` (0-255 each) | `src/primitives/color.ts` |
| `clamp(v, lo, hi)` | function | Clamp to closed range | `src/primitives/pixel.ts` |
| `floor(v)` | function | `Math.floor` alias with pixel-grid intent | `src/primitives/pixel.ts` |
| `lerp(a, b, t)` | function | Linear interpolation | `src/primitives/pixel.ts` |
| `approach(current, target, maxDelta)` | function | Frame-rate-independent smoothing toward target | `src/primitives/pixel.ts` |
| `prefersReducedMotion()` | function | Cached probe for `prefers-reduced-motion`; false in Node/SSR | `src/primitives/motion.ts` |
| `resetMotionCacheForTests()` | function | Reset cache; tests only | `src/primitives/motion.ts` |
| `FALLBACK_DPR` | const | `1` — fallback DPR when window is unavailable (Node, SSR, test) | `src/primitives/dpr.ts` |
| `getDevicePixelRatio()` | function | Cached defensive probe for `window.devicePixelRatio`; returns `FALLBACK_DPR` in Node/SSR. Intended for one-shot startup reads | `src/primitives/dpr.ts` |
| `resetDprCacheForTests()` | function | Reset cached DPR; tests only | `src/primitives/dpr.ts` |
| `resizeCanvasToBackingStore(canvas, cssWidth, cssHeight)` | function | Resize canvas backing store to `round(cssWidth × dpr)` × `round(cssHeight × dpr)`; returns the fresh DPR for caller to `ctx.scale(dpr, dpr)`. Reads DPR fresh each call (NOT via the cache — DPR changes at runtime on monitor swap / browser zoom). Does NOT touch `canvas.style` | `src/primitives/dpr.ts` |
| `SnappedTranslation` | type | `{x, y}` translation aligned to the supplied backing-store pixel grid | `src/primitives/snap.ts` |
| `snapCameraTranslation(x, y, dpr)` | function | Pure device-pixel translation snapping; invalid DPR degrades to 1 | `src/primitives/snap.ts` |
| `applySnappedTranslate(ctx, x, y, dpr)` | function | Apply the snapped translation; caller owns save/restore | `src/primitives/snap.ts` |

#### `src/easing/` (shipped)

> Decision: `docs/design/easing-tween-decision.md`.
> Proposal: `docs/design/easing-tween-proposal.md` (Approach B: Curves + Stateless Tween Driver).
> Research: `docs/research/easing-tween.md`.

Pure-function easing curves and a stateless tween driver. Deterministic: same `(t)` → same output, same `(state, dt, config)` → same result forever. Composes with the fixed-step loop (`advanceAccumulator`) — `dt` MUST come from the fixed-step accumulator, never from `performance.now()`. Curves are `(t: number) => number` functions for direct composition with `particleAge` and other `[0,1] → [0,1]` remapping. The tween driver follows the pure-progression-ops pattern: consumer owns `TweenState`, engine provides `advanceTween`.

**Tween loop convention:** `loops: N` plays the tween `N + 1` times total (one initial pass plus `N` repeats). `loops: 0` = single play. `loops: -1` = infinite. This matches Phaser repeat semantics.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `linear(t)` | function | Identity: returns `t` unchanged | `src/easing/curves.ts` |
| `easeOutQuad(t)` | function | `1 - (1-t)²` — gentle deceleration | `src/easing/curves.ts` |
| `easeOutCubic(t)` | function | `1 - (1-t)³` — fast start, soft settle (most common game easing) | `src/easing/curves.ts` |
| `easeOutQuart(t)` | function | `1 - (1-t)⁴` — aggressive start, very soft landing | `src/easing/curves.ts` |
| `easeOutQuint(t)` | function | `1 - (1-t)⁵` — maximum snap | `src/easing/curves.ts` |
| `easeOutBack(t)` | function | Overshoots past 1.0 then settles (Penner back constant `s = 1.70158`) | `src/easing/curves.ts` |
| `easeOutElastic(t)` | function | Oscillates with exponential decay — spring/bounce feel | `src/easing/curves.ts` |
| `easeOutBounce(t)` | function | Piecewise quadratic floor-bounce simulation (4 segments) | `src/easing/curves.ts` |
| `easeOutSine(t)` | function | Sine-based ease-out curve | `src/easing/curves.ts` |
| `easeOutExpo(t)` | function | Exponential ease-out curve | `src/easing/curves.ts` |
| `easeOutCirc(t)` | function | Circular ease-out curve | `src/easing/curves.ts` |
| `powOut(t, n)` | function | Generic power-out: `1 - (1-t)^n`. Covers quad/cubic/quart/quint by n | `src/easing/curves.ts` |
| `easeIn(outFn)` | function | Derive In variant from any Out curve: `(t) => 1 - outFn(1 - t)` | `src/easing/curves.ts` |
| `easeInOut(outFn)` | function | Derive InOut variant from any Out curve: symmetric around t=0.5 | `src/easing/curves.ts` |
| `TweenState` | type | Consumer-owned tween state: `elapsed`, `direction`, `loopCount`, `delay` | `src/easing/tween.ts` |
| `TweenConfig` | type | Immutable tween config: `duration`, `ease`, `yoyo?`, `loops?`, `delay?` | `src/easing/tween.ts` |
| `TweenSeedConfig` | type | Optional initial loop/delay values accepted by `createTweenState` | `src/easing/tween.ts` |
| `TweenResult` | type | Advance result: `{ state, value, done }` | `src/easing/tween.ts` |
| `createTweenState()` | function | Factory: fresh state with all fields zeroed (no delay, single forward pass) | `src/easing/tween.ts` |
| `advanceTween(state, dt, config)` | function | Pure: advance tween by `dt` seconds; returns new state + eased value + done flag. Call inside `step(fixedDt)` for replay-deterministic animation | `src/easing/tween.ts` |

- _particle lifetime integration: `particleAlphaCurve` / `particleSizeCurve` gain an optional `ease?` parameter (default linear) — see `src/particles/lifetime.ts`_
- _replaces Spitekeep's local `easing(t, name)` in `src/core/traps/hidden-pit.ts:272` and inline `1 - Math.pow(1-t, 3)` in `src/death-cinematography/zoom.ts:75`_

- _research note: See `docs/research/procedural-locomotion.md` for planned trigonometric locomotion, squash/stretch, and Verlet-based spring chains._

#### `src/primitives/wave-line.ts`

Surface ripple / wave-on-polyline. Three pure evaluators for liquid-surface rendering: sum-of-sines displacement, 1D Gerstner displacement, and a high-level polyline generator with outward normals. Deterministic — same `(x, t, config)` → same output, forever.

> Decision: `docs/design/surface-ripple-decision.md`.
> Benchmark: `benchmarks/surface-ripple/sine-vs-gerstner.png`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `WaveOctave` | type | Single-octave params: `amplitude`, `wavelength`, `speed`, `phase?` | `src/primitives/wave-line.ts` |
| `GerstnerOctave` | type | Single Gerstner octave: adds `steepness` (0–1) for trochoidal pinch | `src/primitives/wave-line.ts` |
| `WaveDisplacementConfig` | type | Config for `waveDisplacement`: `octaves`, `baseY` | `src/primitives/wave-line.ts` |
| `GerstnerDisplacementConfig` | type | Config for `gerstnerDisplacement`: `octaves`, `baseY` | `src/primitives/wave-line.ts` |
| `WaveMode` | type | `'sine' \| 'gerstner'` — algorithm selector (open for v2 `'spring-mass'`) | `src/primitives/wave-line.ts` |
| `WaveLineConfig` | type | High-level generator config: `mode?`, `octaves?`, `steepness?`, `snapToPixel?` | `src/primitives/wave-line.ts` |
| `WavePoint` | type | `{x, y, normalX, normalY}` — flat displaced point with outward normal | `src/primitives/wave-line.ts` |
| `waveDisplacement(x, t, config)` | function | Pure sum-of-sines: returns absolute Y at `(x, t)` anchored to `baseY` | `src/primitives/wave-line.ts` |
| `gerstnerDisplacement(x0, t, config)` | function | Pure 1D Gerstner: returns `{x, y, dx, dy}` with per-octave steepness | `src/primitives/wave-line.ts` |
| `generateWaveLine(startX, startY, endX, endY, sampleSpacing, t, config?)` | function | High-level polyline generator → `WavePoint[]` with outward normals from curve tangent | `src/primitives/wave-line.ts` |
| `DEFAULT_WAVE_LINE` | const | 2-octave sine config: `snapToPixel: true`, benchmark-confirmed amplitudes | `src/primitives/wave-line.ts` |
| `DEFAULT_GERSTNER` | const | 2-octave Gerstner config: `steepness: 0.7`, `snapToPixel: false` | `src/primitives/wave-line.ts` |

#### `src/primitives/hit-stop.ts`

Hit-stop (freeze-frame) game-feel helper. Pure and deterministic: no `Math.random`, no `Date.now()`, no global state. The simulation clock freezes for a configurable number of ticks while visual effects (particles, screen shake, flash) keep advancing.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `HitStopState` | type | `{ remaining: number }` — remaining freeze ticks; 0 = inactive | `src/primitives/hit-stop.ts` |
| `DEFAULT_HIT_STOP_DURATION` | const | `6` — default freeze in ticks (~100ms at 60fps) | `src/primitives/hit-stop.ts` |
| `createHitStop()` | function | Factory: fresh inactive state (`remaining: 0`) | `src/primitives/hit-stop.ts` |
| `triggerHitStop(state, duration?)` | function | Pure: start or extend a freeze; `remaining = max(current, duration)`. Duration defaults to `DEFAULT_HIT_STOP_DURATION` | `src/primitives/hit-stop.ts` |
| `stepHitStop(state, dt)` | function | Pure: decrement `remaining` by `dt`, clamped at 0 | `src/primitives/hit-stop.ts` |
| `isHitStopActive(state)` | function | Pure reader: `true` if `remaining > 0` | `src/primitives/hit-stop.ts` |

- _research note: See `docs/research/minimalist-death-feedback.md` for satisfying player-death feedback (hit-stop, screen shake, palette swap, particle bursts)._
- _death feedback recipe (shipped showcase-local): `docs/design/minimalist-death-feedback-decision.md` — Stack A uses 6-tick hit-stop as the impact anchor; implemented in `showcase/sections/playground-death.ts`_

#### `src/primitives/glow.ts`

Additive radial-gradient glow stamp. Draws a brightest-at-center, fade-to-transparent glow using `globalCompositeOperation = 'lighter'` so overlapping glows accumulate (correct physical light behavior). Restores composite + fillStyle after drawing (no state leak). Closes the palette's reserved `feature` role: weapon glow, magical highlights, eye glow, lava brightness.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `drawGlow(ctx, x, y, radius, color, intensity?)` | function | Additive radial-gradient glow; `intensity` is peak alpha [0,1], defaults to `DEFAULT_GLOW_INTENSITY` | `src/primitives/glow.ts` |
| `DEFAULT_GLOW_INTENSITY` | const | `1` — default peak alpha at glow center | `src/primitives/glow.ts` |

#### `src/primitives/bitmap-font.ts` (shipped)

> Decision: `docs/design/bitmap-font-decision.md`.
> Proposal: `docs/design/bitmap-font-proposal.md` (Approach A: Standalone Functions + Options Bag).
> Research: `docs/research/bitmap-font.md`.

Asset-less bitmap font renderer. Draws text as sequences of `fillRect` calls — no `ctx.fillText`, no webfont, no PNG atlas, no asset files. Ships a default 5×7 monospace font (Pascal Stang, MIT-licensed, 95 printable ASCII glyphs, 475 bytes). Consumers register custom fonts via `createFont()` and extend with custom glyphs via `addGlyph()`.

**Layer split:** `measureText` is deterministic core (pure arithmetic, no ctx, SSR-safe). `drawText` / `drawTextOutlined` are renderer-adjacent (take `CanvasRenderingContext2D`).

**Scale convention:** `scale` = pixels per glyph cell. `scale = 3` → 15×21px per glyph (comfortable HUD size per XAG 101). `scale = 1` → 5×7px (tiny, debug use only).

**Outline technique:** `drawTextOutlined` uses the standard 4-offset technique — flat text stamped in outline color at `(±1,0)` + `(0,±1)`, then fill color on top. Reuses `DEFAULT_OUTLINE_COLOR` from `outline-rect.ts`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `BitmapFont` | type | Font definition: `name`, `cellWidth`, `cellHeight`, `lineGap`, `glyphs` (ReadonlyMap) | `src/primitives/bitmap-font-types.ts` |
| `GlyphData` | type | Readonly column-byte array for one bitmap glyph | `src/primitives/bitmap-font-types.ts` |
| `TextMetrics` | type | Measurement result: `width`, `height`, `lineCount` | `src/primitives/bitmap-font-types.ts` |
| `TextAlign` | type | `'left' \| 'center' \| 'right'` — text alignment | `src/primitives/bitmap-font-types.ts` |
| `TextDrawOptions` | type | Draw options: `font?`, `scale?`, `align?`, `color?`, `outline?`, `charGap?` | `src/primitives/bitmap-font-types.ts` |
| `DEFAULT_TEXT_COLOR` | const | `'#ffffff'` — white text (high contrast on dark backgrounds) | `src/primitives/bitmap-font.ts` |
| `DEFAULT_TEXT_SCALE` | const | `3` — 21px tall (comfortable HUD size per XAG 101) | `src/primitives/bitmap-font.ts` |
| `DEFAULT_LINE_GAP` | const | `1` — default line gap in px (HD44780 convention; `DEFAULT_FONT` is constructed with this value) | `src/primitives/bitmap-font.ts` |
| `DEFAULT_CHAR_GAP` | const | `1` — default uniform horizontal gap between adjacent glyphs in unscaled font pixels (letter-spacing, NOT kerning — uniform advance gap) | `src/primitives/bitmap-font.ts` |
| `DEFAULT_FONT` | const | 5×7 monospace font (Pascal Stang, MIT-licensed, full printable ASCII) | `src/primitives/bitmap-font.ts` |
| `createFont(name, cellWidth, cellHeight, lineGap, glyphs)` | function | Factory: create a custom bitmap font from glyph data | `src/primitives/bitmap-font.ts` |
| `addGlyph(font, charCode, glyphData)` | function | Pure: return a new font with one additional glyph (input unchanged) | `src/primitives/bitmap-font.ts` |
| `measureText(text, font?, scale?, charGap?)` | function | Pure measurement: `{width, height, lineCount}` — no ctx, no DOM, SSR-safe. Width excludes trailing `charGap` on last glyph per line: `(lineLength - 1) × (cellWidth + charGap) × scale + cellWidth × scale`. Height excludes trailing `lineGap` on last line | `src/primitives/bitmap-font.ts` |
| `drawText(ctx, text, x, y, options?)` | function | Draw text using flat `fillRect` calls (one per lit pixel) | `src/primitives/bitmap-font.ts` |
| `drawTextOutlined(ctx, text, x, y, options?)` | function | Draw text with 1px outline via 4-offset technique (outline color at ±1 offsets, fill on top). Reuses `DEFAULT_OUTLINE_COLOR` | `src/primitives/bitmap-font.ts` |
| `FONT_5X7_DATA` | const | Packed column bytes for printable ASCII glyphs | `src/primitives/font5x7-data.ts` |
| `FONT_5X7_GLYPHS` | const | ReadonlyMap from printable ASCII code to glyph column data | `src/primitives/font5x7-data.ts` |
| `FONT_5X7_CELL_WIDTH` | const | Default font cell width (`5`) | `src/primitives/font5x7-data.ts` |
| `FONT_5X7_CELL_HEIGHT` | const | Default font cell height (`7`) | `src/primitives/font5x7-data.ts` |
| `FONT_5X7_FIRST_CHAR` | const | First supported printable ASCII code (`0x20`) | `src/primitives/font5x7-data.ts` |
| `FONT_5X7_LAST_CHAR` | const | Last supported printable ASCII code (`0x7e`) | `src/primitives/font5x7-data.ts` |

#### `src/primitives/parallax.ts`

Parallax background scroll helpers. Pure: returns the scroll offset (or tiled-geometry) for a layer given the camera position and depth factor. Consumer translates the canvas by the returned offset/draws tiles at the returned coordinates.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `parallaxOffset(cameraX, cameraY, factor)` | function | Compute scroll offset: `{x: -cameraX * factor, y: -cameraY * factor}`; normalises `-0` to `+0` | `src/primitives/parallax.ts` |
| `PARALLAX_FAR` | const | `0.25` — typical factor for far background layers (distant mountains, stars) | `src/primitives/parallax.ts` |
| `PARALLAX_MID` | const | `0.5` — typical factor for mid-depth layers (hills, trees) | `src/primitives/parallax.ts` |
| `PARALLAX_NEAR` | const | `1.0` — gameplay-layer factor (same scroll as the world) | `src/primitives/parallax.ts` |
| `TiledParallaxRange` | type | `{ startX, copies }` — draw geometry for a seamless-tiled layer along one axis | `src/primitives/parallax.ts` |
| `tiledParallaxRange(camera, factor, tileWidth, viewportWidth)` | function | Pure 1D geometry: computes leftmost draw coordinate + copy count via Optimal Branching Remainder. Returns `TiledParallaxRange`. JSDoc documents overscan/seam-mitigation pattern and sub-pixel tileWidth performance. Guard: zero/negative `tileWidth` → `{ startX: 0, copies: 0 }` | `src/primitives/parallax.ts` |
| `drawTiledParallax(ctx, drawTile, camera, factor, tileWidth, viewportWidth)` | function | Convenience wrapper: computes geometry via `tiledParallaxRange`, calls `drawTile(ctx, screenX)` for each copy using `tileWidth` as spacing. Asset-agnostic callback. Guard: zero/negative `tileWidth` → callback never called | `src/primitives/parallax.ts` |

> **Asset-agnostic callback validated:** the `drawTile: (ctx, screenX) => void` callback works with both procedural draws (hero/lava/playground sections render code-drawn tiles) and raster `drawImage` calls (parallax section renders AI-generated PNGs). The library stays zero-dep; the consumer supplies the art. See `showcase/README.md` section "Parallax section -- deep dive" for the consumer pattern.

> Decision: `docs/design/seamless-tiled-parallax-decision.md`.
> Proposal: `docs/design/seamless-tiled-parallax-proposal.md`.
> Benchmark: `benchmarks/seamless-tiled-parallax/` (5 sample sheets — scroll-right, scroll-left, perfect-alignment, sub-pixel, comparison).

### `src/rng/`

Seeded pseudo-random number generation. Required anywhere determinism matters and variation is needed.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `mulberry32(seed)` | function | Create deterministic RNG; same seed → same sequence forever | `src/rng/mulberry32.ts` |
| `nextInt(rng, min, max)` | function | Inclusive integer in [min, max] | `src/rng/mulberry32.ts` |
| `nextFloat(rng, min, max)` | function | Float in [min, max) | `src/rng/mulberry32.ts` |
| `nextSign(rng)` | function | Either -1 or +1 | `src/rng/mulberry32.ts` |
| `pick(rng, arr)` | function | Random element; throws on empty array | `src/rng/mulberry32.ts` |
| `VisualSeedPart` | type | String or numeric component accepted by readable visual addressing | `src/rng/visual-seed.ts` |
| `visualChannel(name)` | function | Stable locale-independent string-to-uint32 channel identifier | `src/rng/visual-seed.ts` |
| `mixNumber(accumulator, value)` | function | Allocation-free type-tagged numeric address fold | `src/rng/visual-seed.ts` |
| `mixChannel(accumulator, channelId)` | function | Allocation-free type-tagged string-channel address fold | `src/rng/visual-seed.ts` |
| `finalizeSeed(accumulator)` | function | Finalize an accumulator as an unsigned 32-bit visual seed | `src/rng/visual-seed.ts` |
| `deriveVisualSeed(rootSeed, ...parts)` | function | Readable stateless visual address implemented through the same tagged folds | `src/rng/visual-seed.ts` |

### `src/particles/`

Deterministic particle system. Pure spawn/advance/cull, extended with heterogeneous physics (per-particle gravity/drag scales), region/cone sampling, continuous emitters, and renderer-adjacent lifetime helpers.

> Decision: `docs/design/particle-emitters-decision.md`.
> Benchmark: `benchmarks/particle-emitters/lava-pool.png`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Particle` | type | `{x, y, vx, vy, life, maxLife, size, color?, gravityScale?, dragScale?}` — optional `gravityScale`/`dragScale` default to 1.0 via `??` in `advance` | `src/particles/types.ts` |
| `spawn(x, y, opts)` | function | Evenly-distributed particles around a circle; deterministic by default | `src/particles/spawn.ts` |
| `SpawnOptions` | type | Options for `spawn` (count, speed, jitter, life, size, color, angleOffset, rng) | `src/particles/spawn.ts` |
| `advance(particles, dt, opts?)` | function | Pure: returns new array, applies gravity×`gravityScale` + drag×`dragScale`, decrements life. Byte-identical for particles without scale fields | `src/particles/advance.ts` |
| `AdvanceOptions` | type | Options for `advance` (gravity, drag) | `src/particles/advance.ts` |
| `cull(particles)` | function | Pure: returns new array filtering dead particles | `src/particles/cull.ts` |
| `step(particles, dt, opts?)` | function | Convenience: `cull(advance(...))` | `src/particles/step.ts` |
| `DEFAULT_GRAVITY_SCALE` | const | `1.0` — neutral per-particle gravity multiplier | `src/particles/constants.ts` |
| `DEFAULT_DRAG_SCALE` | const | `1.0` — neutral per-particle drag multiplier | `src/particles/constants.ts` |
| `DEFAULT_RATE_SCALE` | const | `1.0` — neutral per-call emission-rate multiplier | `src/particles/constants.ts` |
| `DEFAULT_INNER_RADIUS` | const | `0` — default inner radius for circle region (filled disk) | `src/particles/constants.ts` |
| `SpawnRegion` | type | Discriminated union: `'point' \| 'line' \| 'rect' \| 'circle'` with shape-specific fields | `src/particles/regions.ts` |
| `sampleRegion(region, rng)` | function | Deterministic coordinate sample from a `SpawnRegion`; fixed RNG draws per shape (0/1/2/2) | `src/particles/regions.ts` |
| `ConeConfig` | type | Directional cone: `baseAngle`, `spread`, `speedMin`, `speedMax` | `src/particles/cone.ts` |
| `sampleConeVelocity(config, rng)` | function | Deterministic velocity sample inside an angular cone; exactly 2 RNG draws | `src/particles/cone.ts` |
| `EmissionState` | type | Rate accumulator: `{accumulator}` in [0, 1) | `src/particles/emitter.ts` |
| `EmissionRateConfig` | type | Rate config: `rate`, `rateScale?` | `src/particles/emitter.ts` |
| `advanceEmission(state, dt, config)` | function | Pure rate-accumulator progression; returns `{next, spawnCount}` (input never mutated) | `src/particles/emitter.ts` |
| `EmitterConfig` | type | Declarative emitter: `rate`, `region`, `cone`, `gravityScale?`, `dragScale?`, `life`, `size`, `color?`, `rng` | `src/particles/emitter.ts` |
| `Emitter` | type | Bundled state: `config` (readonly ref), `accumulator`, `particles[]` | `src/particles/emitter.ts` |
| `StepEmittersOptions` | type | Per-call world options: `gravity?`, `drag?`, `rateScale?` | `src/particles/emitter.ts` |
| `createEmitter(config)` | function | Factory: zero accumulator, empty particles array | `src/particles/emitter.ts` |
| `stepEmitters(emitters, dt, opts?)` | function | Advance all emitters: integrate rates, spawn via region+cone, advance with heterogeneous physics, cull dead. Pure: returns new `Emitter[]` | `src/particles/emitter.ts` |
| `particleAge(p)` | function | Normalized age `[0, 1]` from `life`/`maxLife`; 0 at spawn, 1 at death | `src/particles/lifetime.ts` |
| `particleSizeCurve(p, startSize, endSize)` | function | Linear size interpolation over lifetime; pure reader | `src/particles/lifetime.ts` |
| `particleAlphaCurve(p, startAlpha, endAlpha)` | function | Linear alpha interpolation over lifetime; clamped to `[0, 1]` | `src/particles/lifetime.ts` |

#### `src/particles/presets.ts`

Tuned particle-emitter presets + surface colors, lifted verbatim from the lava-pool showcase so consumers get the hand-tuned lava look by default instead of re-inventing mediocre params (a real consumer game shipped a barely-flickering lava pool because it guessed at the values). Spread a preset into `createEmitter` and supply only the per-instance `region` + `rng`.

**Units contract (the footgun):** all presets are in **TICK units** (one sim step = one tick; the showcase steps with `dt = 1`). `rate` is particles-per-tick, `life` is ticks, `gravityScale`/`dragScale` are per-tick multipliers layered on the world `gravity`/`drag` you pass to `stepEmitters`. Pair tick-unit presets with `dt = 1` in `stepEmitters`. If your game runs in SECONDS (`dt = 1/60`), convert (or multiply your `dt` by 60) — mixing tick-unit presets with a seconds-valued `dt` runs ~60× too slow. Each preset's JSDoc documents the exact `stepEmitters(emitters, 1, { gravity: 0.5 })` call to reproduce the showcase look.

**Shared-world-gravity limitation (known footgun, tracked separately):** `stepEmitters` takes a SINGLE shared world `gravity`/`drag` for every emitter in the call. Heterogeneous behaviour (fire falls, smoke rises) is achieved ONLY via the per-particle `gravityScale`/`dragScale` baked into each preset — there is no per-emitter world-gravity override on `EmitterConfig`. The lava recipe pairs both emitters with the same `gravity: 0.5` and differs only in `gravityScale` (smoke negates the shared gravity to rise). TODO(per-emitter-gravity) is noted in the source; out of scope for this preset task.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `ParticlePreset` | type | `Readonly<Omit<EmitterConfig, 'region' \| 'rng'>>` — the spreadable preset shape (every required field except the per-instance `region`/`rng`) | `src/particles/presets.ts` |
| `LAVA_FIRE_PARTICLES` | const | Fire emitter preset (tick units): rate 2, cone up `-π/2` spread `π/3` speed 3–5, gravityScale 0.4, dragScale 0.99, life 30, size 3, color `#FFAA00`. Verbatim from showcase `FIRE_*`. Pair with `stepEmitters(emitters, 1, { gravity: 0.5 })` | `src/particles/presets.ts` |
| `LAVA_SMOKE_PARTICLES` | const | Smoke emitter preset (tick units): rate 0.8, cone up `-π/2` spread `π/2` speed 0.5–1.5, gravityScale -0.4 (buoyant), dragScale 0.99, life 60, size 6, color `#888888`. Verbatim from showcase `SMOKE_*`. Shares world gravity 0.5 with fire | `src/particles/presets.ts` |
| `LAVA_SURFACE_COLOR` | const | `'#ff6a00'` — bright orange surface crust stroke; verbatim from showcase `COLOR_LAVA_SURFACE` | `src/particles/presets.ts` |
| `LAVA_BODY_COLOR` | const | `'#7a0a0a'` — deep red lava body fill; verbatim from showcase `COLOR_LAVA_BODY` | `src/particles/presets.ts` |
| `WATER_BUBBLE_PARTICLES` | const | Water-bubble emitter preset (tick units): rate 0.5, cone up `-π/2` spread `π/4` speed 0.5–1.5, gravityScale -0.2 (gentle buoyancy), dragScale 0.95 (high water resistance), life 40, size 2, color `#a0d8ff`. **DERIVED** (no showcase water section ships) — sensible starting point, tune to taste. Pair with `stepEmitters(emitters, 1, { gravity: 0.5 })` | `src/particles/presets.ts` |
| `WATER_SURFACE_COLOR` | const | `'#2a7ad4'` — mid-blue water surface stroke; **DERIVED**, pairs with `WATER_BUBBLE_PARTICLES` | `src/particles/presets.ts` |

### `src/animation/types.ts`

Shared foundation types for skeletal rigging, IK, and locomotion.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Vec2` | type | `{x: number; y: number}` — canonical definition (migrated from `src/primitives/animation.ts`) | `src/animation/types.ts` |
| `AffineTransform` | type | 2×3 column-major matrix `[a, b, c, d, tx, ty]` — maps directly to `ctx.transform()` | `src/animation/types.ts` |
| `BonePose` | type | Local TRS for one bone (translation, rotation in radians, scale; all optional, default identity) | `src/animation/types.ts` |
| `BoneNode` | type | Bone in hierarchy: id, parentIndex, restPose, optional attachmentSlot | `src/animation/types.ts` |
| `SkeletonTemplate` | type | Reusable skeleton definition: bones array, `restWorldTransforms`, bone lengths, slot map | `src/animation/types.ts` |
| `Rig` | type | Per-instance state: template ref, mutable localPoses, mutable worldTransforms/Positions/Rotations | `src/animation/types.ts` |
| `EffectorTarget` | type | IK/locomotion attachment: slot name + world-space target Vec2 | `src/animation/types.ts` |
| `BoneDrawMap` | type | Array of `{boneIndex, draw}` entries for skin rendering | `src/animation/types.ts` |

### `src/animation/rig.ts`

Skeletal rig operations: skeleton creation, rig instantiation, world-space propagation.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createSkeleton(bones)` | function | Create reusable SkeletonTemplate from BoneNode array (validates topological order, computes rest transforms + bone lengths + slot map) | `src/animation/rig.ts` |
| `createRig(template)` | function | Create a live Rig instance initialized to rest pose | `src/animation/rig.ts` |
| `computeWorldTransforms(rig)` | function | Single O(N) forward pass: reads localPoses, writes worldTransforms/Positions/Rotations in-place | `src/animation/rig.ts` |

### `src/animation/transform.ts`

Coordinate-space conversion helpers.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `localToWorld(point, rig, boneIndex)` | function | Transform a Vec2 from bone-local to world space | `src/animation/transform.ts` |
| `worldToLocal(point, rig, boneIndex)` | function | Transform a Vec2 from world space to bone-local (matrix inverse; returns `{x:0,y:0}` for singular) | `src/animation/transform.ts` |

### `src/animation/skin.ts`

Skin rendering: per-bone draw callback dispatch.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `drawRig(ctx, rig, skin)` | function | Apply each bone's world transform and call its draw callback; null entries are skipped | `src/animation/skin.ts` |

- _research note: `docs/research/skeletal-rigging.md`_
- _research note: `docs/research/inverse-kinematics.md`_
- _research note: `docs/research/procedural-locomotion.md`_
- _proposed in: `docs/design/skeletal-rigging-proposal.md`_

### `src/animation/ik/`

Inverse kinematics solvers. Decision: `docs/design/inverse-kinematics-decision.md`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `IkBone` | type | Solver-local angle-limit params (`minAngle?`/`maxAngle?`); bone lengths read from `SkeletonTemplate.boneLengths`, not duplicated here | `src/animation/ik/types.ts` |
| `IkEffector` | type | Slot name + world-space target position (skin-agnostic) | `src/animation/ik/types.ts` |
| `IkResult` | type | Solved positions + local rotations + solved flag (returned by `solveCCD`/`solveFABRIK`) | `src/animation/ik/types.ts` |
| `LimbResult` | type | Result of `solveLimb`: `{jointPos, endPos, solved}` — dedicated type for the 2-bone analytical solver | `src/animation/ik/limb.ts` |
| `LimbSolveOptions` | type | Options for `solveLimb` (`bendDir?`) | `src/animation/ik/types.ts` |
| `IterativeSolveOptions` | type | Options for `solveCCD`/`solveFABRIK` (`iterations?`, `angleLimits?`) | `src/animation/ik/types.ts` |
| `calculateBendDir(root, target, pole)` | function | 2D cross product → bend direction (`-1` or `+1`) | `src/animation/ik/limb.ts` |
| `solveLimb(root, target, lengthA, lengthB, opts?)` | function | Analytical 2-bone IK solver (O(1), closed-form); returns `LimbResult` with `{jointPos, endPos, solved}` | `src/animation/ik/limb.ts` |
| `solveCCD(positions, boneLengths, target, opts?)` | function | Cyclic Coordinate Descent for N-joint chains; returns `IkResult` | `src/animation/ik/ccd.ts` |
| `solveFABRIK(positions, boneLengths, target, opts?)` | function | FABRIK position solver + rotation reconstruction; returns `IkResult` | `src/animation/ik/fabrik.ts` |
| `reconstructRotations(positions)` | function | Reconstruct local rotations from solved positions via `atan2`; signature `(positions: readonly Vec2[]) → number[]` (no `boneLengths` param) | `src/animation/ik/fabrik.ts` |
| `IK_CCD_DEFAULT_ITERATIONS` | const | `8` — default fixed iteration count for CCD | `src/animation/ik/constants.ts` |
| `IK_FABRIK_DEFAULT_ITERATIONS` | const | `4` — default fixed iteration count for FABRIK | `src/animation/ik/constants.ts` |
| `IK_POSITION_TOLERANCE_SQ` | const | `0.0001` — sub-pixel solved-flag diagnostic threshold | `src/animation/ik/constants.ts` |
| `IK_LIMB_DEAD_ZONE` | const | `0.001` — jitter prevention at full extension in `solveLimb` | `src/animation/ik/constants.ts` |
| `IK_COLLINEAR_THRESHOLD_SQ` | const | `1e-12` — squared length below which a bone is treated as collinear-degenerate by `reconstructRotations` | `src/animation/ik/constants.ts` |

- _research note: docs/research/inverse-kinematics.md_

### `src/animation/foot-lock.ts`

Effector locking for foot-pin / hand-hold. Bridges IK solvers with locomotion.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `FootLockState` | type | Lock state: isLocked, lockPos, blendWeight | `src/animation/foot-lock.ts` |
| `advanceFootLock(state, isGrounded, footPos, dt, blendSpeed?)` | function | Pure state progression: ramp blend weight toward lock | `src/animation/foot-lock.ts` |
| `getFootLockTarget(state, animatedFootPos)` | function | Lerp between animated and locked position | `src/animation/foot-lock.ts` |

### `src/animation/foot-plant.ts`

> Proposal: `docs/design/foot-plant-detection-proposal.md`.

Foot-plant event detection: zero-crossing detector on the locomotion lift signal. Detects when each foot transitions from airborne (lift > 0) to planted (lift === 0) — the edge that consumers use to fire dust puffs and footstep audio. Complements `foot-lock.ts` (which smooths IK targets) and `locomotion.ts` (which generates the lift signal). Speed gate is consumer-side.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `FootPlantState` | type | Previous-tick lift heights: `{prevLeftLift, prevRightLift}` | `src/animation/foot-plant.ts` |
| `FootPlantEvents` | type | Per-tick plant edges: `{leftPlanted, rightPlanted}` booleans | `src/animation/foot-plant.ts` |
| `FootPlantResult` | type | Return of `advanceFootPlant`: `{state, events}` | `src/animation/foot-plant.ts` |
| `createFootPlantState()` | function | Factory: fresh state with both prev-lift values at 0 | `src/animation/foot-plant.ts` |
| `advanceFootPlant(state, leftLift, rightLift)` | function | Pure: detect plant edges + advance state. Speed gate is consumer-side | `src/animation/foot-plant.ts` |

### `src/animation/locomotion.ts`

Trigonometric locomotion: phase-accumulator walk/run cycles with smooth speed transitions.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `LocomotionState` | type | Phase accumulator: `{phase: number}` in [0, 2π) | `src/animation/locomotion.ts` |
| `GaitConfig` | type | Per-character gait params: baseFrequency, strideLength, strideHeight, hipBobHeight, hipSwayWidth | `src/animation/locomotion.ts` |
| `DEFAULT_GAIT` | const | Default GaitConfig matching Spitekeep's devil character scale | `src/animation/locomotion.ts` |
| `LocomotionPose` | type | Hip/foot offsets: hipOffset, leftFootOffset, rightFootOffset (all Vec2) | `src/animation/locomotion.ts` |
| `advanceLocomotion(state, speed, dt, config)` | function | Pure: integrate phase accumulator; returns new LocomotionState | `src/animation/locomotion.ts` |
| `evaluateLocomotion(state, config)` | function | Pure: compute hip/foot offsets from phase; returns LocomotionPose. Foot-lift half-cycle was corrected from `max(0, sin(phi))` to `max(0, -sin(phi))` — see `docs/design/walk-cycle-correction-decision.md` | `src/animation/locomotion.ts` |
| `scaledGait(config, scale)` | function | Pure: multiply all amplitude fields by scale factor (reduced-motion helper) | `src/animation/locomotion.ts` |

#### Locomotion extensions (additive, shipped)

Advances the locomotion pillar with displacement-driven phase (kills foot-sliding for translating characters) and airborne tuck blending for jumps.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `TuckConfig` | type | Airborne tuck pose params: `tuckOffset` (Vec2), `hipRaise` (px, negative = up) | `src/animation/locomotion.ts` |
| `DEFAULT_TUCK` | const | Default `TuckConfig`: `tuckOffset {x:0,y:-2}`, `hipRaise -3` | `src/animation/locomotion.ts` |
| `advanceLocomotionByDisplacement(state, dx, config)` | function | Pure: advance phase by actual horizontal displacement `dx` (anti-foot-slide). `dx` is world-space signed displacement; consumers using geometry mirrors (`ctx.scale(facing, 1)`) must pass local-space displacement (`dx * facing`) — see `docs/design/walk-cycle-correction-decision.md`. Do NOT call alongside time-driven `advanceLocomotion` in the same tick. | `src/animation/locomotion.ts` |
| `blendAirborneTuck(footOffset, airborneBlend, config)` | function | Pure: lerp a walk-cycle foot offset toward the tuck pose by `airborneBlend ∈ [0,1]` | `src/animation/locomotion.ts` |

- _decision: `docs/design/jump-walk-proposal.md` (Approach A: Composable Separate Functions)_
- _adds to existing `src/animation/locomotion.ts` without modifying any previously-shipped exports_

#### Locomotion extensions (additive, shipped)

Idle-foot stance blend: a pure pose helper that transitions a walk-cycle pose
toward a neutral standing stance with configurable foot spread. Fixes the
IK-parity idle overlap: feet cross during walking (`idleSpread = 0`) but settle
slightly apart at full idle rather than overlapping as one. `idleFootSpread` is
the **total center-to-center distance** — each foot targets `±spread/2`. To
choose a spread, use `footW + desiredGap` (hero: 28+2=30; playground: 7+1=8).
No engine default (scale is character-specific). Non-finite inputs degrade to 0;
finite values clamped. Never throws.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `blendLocomotionToStance(pose, stanceBlend, idleFootSpread)` | function | Pure: blend a `LocomotionPose` toward a neutral standing stance. `stanceBlend` = blend weight (0 = walk, 1 = idle; non-finite → 0, finite clamped [0,1]); `idleFootSpread` = total center-to-center distance in px at full idle (non-finite → 0, finite clamped ≥0). Each foot targets `±spread/2`. Hip and foot Y blend toward 0. Composition: stance blend FIRST, then `blendAirborneTuck`. Consumer owns stop/ground detection. Never throws | `src/animation/locomotion.ts` |

- _decision: `docs/design/idle-foot-stance-decision.md`_
- _benchmark: `benchmarks/idle-foot-stance/hero-comparison.png`, `benchmarks/idle-foot-stance/playground-comparison.png`_
- _proposed in: `docs/design/idle-foot-stance-proposal.md`_

- _see also `src/animation/oscillators.ts` for the migrated `bob` / `pulse` / `sineShake` / `shakeEnvelope` helpers_
- _research note: `docs/research/procedural-locomotion.md` §Pattern 1_
- _research note: `docs/research/jump-walk-locomotion.md` for deterministic jumping, walking, and state-machine coupling_
- _proposed in: `docs/design/procedural-motion-proposal.md`_

### `src/animation/squash-stretch.ts`

Volume-preserving scale transforms for breathing, jumping, landing, and turning.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Scale2D` | type | `{scaleX: number; scaleY: number}` — volume-preserving scale pair | `src/animation/squash-stretch.ts` |
| `BreathConfig` | type | Breathing params: `frequency`, `amplitude` | `src/animation/squash-stretch.ts` |
| `DEFAULT_BREATH` | const | Default `BreathConfig` for idle animation | `src/animation/squash-stretch.ts` |
| `TurnedProjection` | type | Orthographic turning result: `{x, y, sx, sy}` — projected position plus horizontal/vertical scale | `src/animation/squash-stretch.ts` |
| `volumeScale(deltaY)` | function | Pure: volume-preserving scale from vertical delta (`scaleX × scaleY = 1`) | `src/animation/squash-stretch.ts` |
| `breathe(tick, config)` | function | Pure: sinusoidal breathing oscillation returning `Scale2D` | `src/animation/squash-stretch.ts` |
| `projectTurnedPart(localX, localY, facingAngle)` | function | Pure: Sokpop-style orthographic turning projection; returns `TurnedProjection` | `src/animation/squash-stretch.ts` |
| `scaledBreath(config, scale)` | function | Pure: multiply breathing amplitude by scale factor (reduced-motion helper) | `src/animation/squash-stretch.ts` |

- _research note: `docs/research/procedural-locomotion.md` §Pattern 2_
- _proposed in: `docs/design/procedural-motion-proposal.md`_

### `src/animation/spring.ts`

Verlet-PBD spring chains for secondary dynamics (hair, tails, cloaks).

| Export | Kind | Summary | Source |
|---|---|---|---|
| `VerletNode` | type | Chain node: `{x, y, prevX, prevY}` | `src/animation/spring.ts` |
| `SpringConfig` | type | Physics params: segmentLength, gravityX/Y, drag, constraintIterations | `src/animation/spring.ts` |
| `DEFAULT_SPRING` | const | Default SpringConfig for a hanging tail/hair chain | `src/animation/spring.ts` |
| `advanceSpringChain(nodes, anchorX, anchorY, dt, config)` | function | Pure: Verlet-PBD step; returns new VerletNode[] (input not mutated) | `src/animation/spring.ts` |
| `createSpringChain(count, anchorX, anchorY, segmentLength)` | function | Factory: create initial straight chain hanging downward | `src/animation/spring.ts` |

- _determinism contract: caller MUST use fixed `dt` (see proposal §Fixed-Timestep)_
- _research note: `docs/research/procedural-locomotion.md` §Pattern 3_
- _proposed in: `docs/design/procedural-motion-proposal.md`_
- _elastic rod bending resistance investigated (Provot bend springs vs angular PBD): showcase-local for v1, L2 library export deferred until a second consumer arrives. See `docs/design/elastic-rod-antenna-decision.md`._

#### `src/animation/spring-rod.ts`

> Design: `docs/design/spring-rod-proposal.md`.
> Builds on: `docs/research/springy-rod.md`.

Stable springy-rod primitive: unified solver combining Verlet integration + PBD distance constraints + Provot bend constraints + directional rest-pose spring + tip-weight nudge, with structural stability guards (epsilon, velocity clamp, NaN reset, strain limit) baked in. Drop-in replacement for the showcase's 3-step correction pipeline. `advanceSpringChain` is kept (not deprecated) for advanced users who want the raw unguarded substrate.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `SpringRodConfig` | type | Rod physics: `segmentLength`, `restDirection` (Vec2), `stiffness` [0,1], `tipWeight`, `subSteps`, `gravityX/Y`, `drag` | `src/animation/spring-rod.ts` |
| `DEFAULT_SPRING_ROD` | const | Default `SpringRodConfig`: moderate stiffness, downward rest, no tip sag, no gravity | `src/animation/spring-rod.ts` |
| `createSpringRod(count, anchorX, anchorY, segmentLength, restDirection)` | function | Factory: straight chain along restDirection from anchor, zero velocity | `src/animation/spring-rod.ts` |
| `advanceSpringRod(nodes, anchorX, anchorY, dt, config)` | function | Pure unified solver: Verlet + distance + bend + rest-pose + tip-weight + stability guards. Returns new VerletNode[] (input not mutated). Never throws | `src/animation/spring-rod.ts` |

- _determinism contract: same as `advanceSpringChain` — caller MUST use fixed `dt`_
- _stability guarantees: epsilon-guarded division, velocity clamping, NaN/Infinity reset, strain limiting — all non-optional_
- _research note: `docs/research/springy-rod.md`_
- _showcase migration: `showcase/helpers/slime-knight.ts` can delete `applyAntennaBendConstraints`, `applyAntennaRestPose`, `applyAntennaTipWeight` (~150 lines) after this ships_

### `src/animation/jump.ts`

Apex-parameterized jump trajectory, state machine (coyote time, jump buffering, variable height), and landing squash with internal 1D spring recovery. Pure and deterministic: same `(state, inputs, dt, config)` → byte-identical returned state. The library is a trajectory solver only — `isGrounded` is a consumer-provided input flag (the library never does collision).

| Export | Kind | Summary | Source |
|---|---|---|---|
| `JumpConfig` | type | Jump tuning: `apexHeight`, `timeToApex`, `jumpCutoffFactor`, `fallMultiplier`, `coyoteTime`, `jumpBufferTime`, `landingSquashMin`, `landingSquashStiffness`, `landingSquashDamping`, `anticipationDuration`, `anticipationSquash`, `launchStretch`, `airborneBlendRampUp`, `airborneBlendRampDown` | `src/animation/jump.ts` |
| `DEFAULT_JUMP` | const | Default `JumpConfig` matching Sokpop-style platformer feel (apex 48px, timeToApex 0.28s) | `src/animation/jump.ts` |
| `JumpPhysics` | type | Pre-computed gravity + launch velocity from apex parameterization (`gravity = 2H/T²`, `launchVelocity = 2H/T`) | `src/animation/jump.ts` |
| `JumpPhase` | type | Discrete state: `'grounded' \| 'anticipating' \| 'rising' \| 'falling' \| 'landing'` | `src/animation/jump.ts` |
| `JumpState` | type | Persistent jump state: `phase`, `vy`, `y`, `coyoteTimer`, `jumpBufferTimer`, `anticipationTimer`, `jumpHeld`, `squashOffset`, `squashVelocity`, `landingTimer`, `impactVelocity`, `justLaunched`, `airborneBlend`, `scale` (Scale2D), `physics` | `src/animation/jump.ts` |
| `JumpInputs` | type | Per-tick abstract inputs: `jumpHeld`, `jumpPressed`, `isGrounded`, `hitCeiling?` | `src/animation/jump.ts` |
| `JumpPose` | type | Read-only pose: `yOffset`, `scale` (Scale2D), `airborne`, `airborneBlend`, `impactVelocity` | `src/animation/jump.ts` |
| `createJumpState(config)` | function | Factory: create initial grounded `JumpState` (pre-computes `physics`) | `src/animation/jump.ts` |
| `advanceJump(state, inputs, dt, config)` | function | Pure: advance the jump state machine by one fixed timestep; returns a new `JumpState` | `src/animation/jump.ts` |
| `evaluateJump(state)` | function | Pure reader: compute `JumpPose` (yOffset, scale, airborne, airborneBlend, impactVelocity) from state — no config needed | `src/animation/jump.ts` |

- _decision: `docs/design/jump-walk-proposal.md` (Approach A: Composable Separate Functions)_
- _determinism contract: same (state, inputs, dt, config) → byte-identical returned state; golden trajectory locked in `src/tests/__snapshots__/jump.test.ts.snap`_
- _research note: `docs/research/jump-walk-locomotion.md` §Patterns 1, 2, 4_
- _`deriveJumpPhysics` is an internal helper (not exported); derived physics are readable via `state.physics`_
- _landing squash uses an internal 1D spring-damper (`landingSquashStiffness`, `landingSquashDamping`); not exported_
- _the library does NOT clamp `y` on landing — the consumer snaps the rendered position to the ground via its own collision resolution_

### `src/animation/simple-feet.ts`

Lightweight two-rectangle feet renderer driven by a `LocomotionPose`. The drop-in alternative to the full IK rig (`drawRig` + `solveLimb`): characters that only need two body-colored foot rects bobbing via `evaluateLocomotion`'s sin/cos output use `drawSimpleFeet`. No IK, no joints — the foot-lock is emergent (displacement-driven phase integration freezes phase when the character stops, planting the feet). Ported from Spitekeep's `render/devil-sprite.ts:1436-1469`.

**Orbital gait (IK parity):** Setting `idleSpread: 0` makes both feet center on the body midline, orbiting symmetrically via `cos(phase) * strideLength`. At each footfall endpoint, both feet have equal magnitude from the midline on opposite sides — the same trajectory as the IK version's co-located-hips foot targets, without bones. See `IK_PARITY_FEET` preset.

⚠ **Facing-mirror requirement:** the foot offsets in `pose` are LOCAL-space. The caller MUST wrap the body+feet draw in `ctx.scale(facing, 1)` around the body's vertical axis or the character moonwalks.

> Proposal: `docs/design/simple-feet-gait-proposal.md`. Decision: `docs/design/simple-feet-gait-decision.md`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `SimpleFeetConfig` | type | Foot rendering config: `footW`, `footH`, `idleSpread`, `baseY`, `color`, optional `outline`. All `readonly` — no magic numbers in the renderer. `idleSpread` controls foot center distance from the midline (0 = orbital crossing / IK-parity; 5.5 = wide stance) | `src/animation/simple-feet.ts` |
| `DEFAULT_SIMPLE_FEET` | const | Default `SimpleFeetConfig` matching Spitekeep's devil character (footW 7, footH 5, idleSpread 5.5, baseY 14, color `#FE5701`, outline `#1d1128`). Spread and override `color`/`outline` with your palette | `src/animation/simple-feet.ts` |
| `IK_PARITY_FEET` | const | `SimpleFeetConfig` with `idleSpread: 0` — orbital gait preset. Feet center on the body midline, orbiting symmetrically with endpoint parity at each footfall. Mimics the IK version's foot-target trajectory without bones. Spread and override `footW`/`footH`/`color` with your character config | `src/animation/simple-feet.ts` |
| `drawSimpleFeet(ctx, pose, config)` | function | Draw two static foot rectangles positioned by a `LocomotionPose`. Uses `outlineRect` when `config.outline` is provided (1px outline, pixel-snapped), otherwise bare `fillRect`. Positions rounded to integers via `Math.round`. Caller owns transform/state | `src/animation/simple-feet.ts` |

### `src/animation/oscillators.ts` (migrated from `src/primitives/animation.ts`)

General-purpose deterministic oscillators. Migrated cleanly out of `src/primitives/animation.ts` (that file is deleted; `src/primitives/index.ts` drops these exports). **No back-compat re-export shim** — the library has no consumers yet.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `bob(tick, speed, amplitude)` | function | Deterministic sine-based bobbing; signed displacement in [-amp, +amp]; 0 at tick 0 | `src/animation/oscillators.ts` |
| `pulse(tick, speed, amplitude)` | function | Deterministic pulse in [0, amplitude] for breathing / glow | `src/animation/oscillators.ts` |
| `sineShake(tick, magnitude, freqX?, freqY?)` | function | Deterministic 2-axis screen-shake offset (decorrelated sines) | `src/animation/oscillators.ts` |
| `shakeEnvelope(tick, duration, initialMagnitude)` | function | Linear-decay magnitude envelope for shake | `src/animation/oscillators.ts` |

- _determinism: pure functions of `tick`; no `Math.random` / `Date.now()`_
- _reduced-motion: consumer-gated, e.g. `reduceMotion ? 0 : sineShake(...)`_

### `src/animation/constants.ts`

Named constants shared across the animation pillar (no magic numbers). IK-solver-specific iteration constants live in `src/animation/ik/constants.ts`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `SINGULAR_MATRIX_DET_THRESHOLD` | const | `1e-8` — determinant below this marks a 2×3 matrix singular in `worldToLocal` | `src/animation/constants.ts` |
| `FOOT_LOCK_DEFAULT_BLEND_SPEED` | const | `10` — default blend-weight change per second for `advanceFootLock` | `src/animation/constants.ts` |

### `src/animation/spider/` (SHIPPED)

> Decision: `docs/design/procedural-spider-locomotion-decision.md`.
> Proposal: `docs/design/procedural-spider-locomotion-proposal.md`.
> Research: `docs/research/procedural-spider-locomotion.md`.
> Benchmark: `benchmarks/spider/sample-sheet.png`.

Procedural multi-legged spider locomotion. Deterministic core: gait solver (`gait.ts`), ground sampling (`ground-sample.ts`), three-segment leg geometry (`geometry.ts`), and state facade (`spider-state.ts`). Renderer-adjacent: pose evaluation and body/leg drawing (`spider.ts`). Supports `'coordinated'` (alternating tetrapod) and `'frantic'` (free-stepping with neighbour-lock) gait modes. 8 legs (4 foreground + 4 background), full segmented body (cephalothorax + abdomen + eyes + chelicerae + pedipalps), terrain-adaptive foot placement via `TileSolidityQuery`. Floor-only v1 scope — non-breaking wall/ceiling extension via a `samplingDirection` config field on `sampleGround`. Composes existing primitives: `spring-rod` (pedipalps), `breathe` (squash-stretch), `worldToTile`/`tileToWorld` (collision), `mulberry32` (seeded body jitter).

#### `src/animation/spider/gait.ts` — deterministic core

| Export | Kind | Summary | Source |
|---|---|---|---|
| `SpiderGaitMode` | type | `'coordinated' \| 'frantic'` — gait mode selector | `src/animation/spider/gait.ts` |
| `LegRestPosition` | type | `{angle: number, distance: number}` — per-leg rest position definition (angle in degrees from +X axis, distance in px from body center) | `src/animation/spider/gait.ts` |
| `GaitLegState` | type | Per-leg state: id, set ('A'\|'B'), footX/Y, stepPhase, step arc positions (start/end/mid), isSwinging, index, restLocalX/Y | `src/animation/spider/gait.ts` |
| `GaitState` | type | `{legs, phase, facing?, activeSet?, servicedLegs?}` — authoritative gait state with turn-safe within-side pairing and fair set/service bookkeeping | `src/animation/spider/gait.ts` |
| `SpiderGaitConfig` | type | Gait solver config: mode, legCount, comfortRadius, `geometry` (shared `SpiderLegGeometryConfig`), overshootFactor, stepHeight, stepDuration, phaseAdvanceRate, per-side legRestPositions, groundSampleSteps, motionScale | `src/animation/spider/gait.ts` |
| `createGaitState(config, legRestPositions, bodyX?, bodyY?, initialFacing?)` | function | Factory: initial gait state for N legs per side, with opposing alternating sets and canonical facing-relative rest offsets | `src/animation/spider/gait.ts` |
| `advanceGait(state, bodyX, bodyY, vx, vy, facing, dt, config, tileQuery, tileSize, tick)` | function | Pure gait advance. Coordinated mode enforces strict alternating-tetrapod support, corresponding-pair lock, fair service, and compressed-foot priority. Frantic mode keeps independent feet with neighbour/pair/support locks. Turns remap front-to-rear within each side | `src/animation/spider/gait.ts` |
| `getGaitFootPosition(leg)` | function | Pure reader: get world foot position (planted or sampling step arc at stepPhase) | `src/animation/spider/gait.ts` |
| `sampleStepArc(start, mid, end, t)` | function | Pure: quadratic Bezier sample for parabolic step lift. Non-finite `t` clamps to [0,1] | `src/animation/spider/gait.ts` |

#### `src/animation/spider/ground-sample.ts` — deterministic core

| Export | Kind | Summary | Source |
|---|---|---|---|
| `GroundSampleResult` | type | `{point: Vec2, normal: Vec2, hasGround: boolean}` — surface point + outward normal + found flag | `src/animation/spider/ground-sample.ts` |
| `sampleGround(originX, originY, directionX, directionY, maxDistance, tileSize, tileQuery)` | function | Pure: sample nearest solid tile in a given direction via `TileSolidityQuery`. Returns the **surface point** (top edge for downward sampling), not a point inside the tile. v1 hard-codes downward `{x:0, y:1}` at the call site; direction param is the non-breaking extension hook for wall/ceiling. Never throws | `src/animation/spider/ground-sample.ts` |

#### `src/animation/spider/geometry.ts` — three-segment leg geometry

| Export | Kind | Summary | Source |
|---|---|---|---|
| `SpiderLegGeometryConfig` | type | Shared three-segment geometry: `{hipRadius, coxaLength, femurLength, tibiaLength, minExtensionRatio, maxExtensionRatio, jointSafetyMargin, minDistalAdvanceRatio}` — used by gait solver and renderer. `minDistalAdvanceRatio` sets the minimum outward tibia advance (anti-fold anatomical sector) as a fraction of tibia length | `src/animation/spider/geometry.ts` |
| `FemurTibiaAnnuli` | type | Workspace bounds: `{hardMin, softMin, softMax, hardMax}` — femur+tibia annulus radii for IK validity | `src/animation/spider/geometry.ts` |
| `LegStepRequest` | type | Structured per-leg step request: `{needsStep, urgency, restError, workspaceError, sectorError, hardViolation}` — absolute workspace + anatomical-sector validity for gait decisions (`sectorError` > 0 marks a folded-Z foot needing replant) | `src/animation/spider/geometry.ts` |
| `computeHipPosition(bodyX, bodyY, facing, restLocal, geometry)` | function | Pure: hip joint world position on body circle at `hipRadius` from body center along leg's rest angle | `src/animation/spider/geometry.ts` |
| `computeCoxaEndpoint(hip, facing, restLocal, geometry)` | function | Pure: fixed coxa endpoint extending from hip along mirrored rest direction by `coxaLength` | `src/animation/spider/geometry.ts` |
| `computeFemurTibiaAnnuli(geometry)` | function | Pure: workspace annulus bounds (`hardMin/softMin/softMax/hardMax`) from femur+tibia lengths, offset by `jointSafetyMargin` in px | `src/animation/spider/geometry.ts` |
| `projectTargetIntoWorkspace(coxa, target, geometry)` | function | Pure: project foot target into hard annulus — clamps to `hardMin`/`hardMax` range from coxa | `src/animation/spider/geometry.ts` |
| `projectGroundedTargetIntoWorkspace(coxa, target, geometry, facing, restLocalX)` | function | Pure: project grounded target preserving ground Y with anatomical tie-break — keeps target on anatomically correct side of coxa | `src/animation/spider/geometry.ts` |
| `solveThreeSegmentLeg(bodyX, bodyY, facing, restLocal, target, geometry)` | function | Pure: full three-segment IK — fixed coxa endpoint + analytical femur/tibia two-bone solve with stable anatomical pole bend. Returns `{hip, coxa, knee, foot}` positions | `src/animation/spider/geometry.ts` |
| `computeLegStepRequest(bodyX, bodyY, facing, restLocal, footPos, geometry, comfortRadius)` | function | Pure: structured `LegStepRequest` with absolute workspace + anatomical-sector validity — combines rest-error, workspace annulus, folded-Z (`sectorError`), and hard-violation diagnostics | `src/animation/spider/geometry.ts` |

#### `src/animation/spider/spider-state.ts` — deterministic state facade

| Export | Kind | Summary | Source |
|---|---|---|---|
| `SpiderPalette` | type | Body palette: `{cephFill, abdFill, legFg, legBg, eyeFill, cheliceraeFill, palpFill, outline}` — all hex strings, no magic colors | `src/animation/spider/spider-state.ts` |
| `EyeDefinition` | type | Per-eye definition: `{dx, dy, r}` — offset from ceph center + radius | `src/animation/spider/spider-state.ts` |
| `CheliceraDefinition` | type | Per-chelicera definition: `{dx, dy, angle}` — offset + base angle in radians | `src/animation/spider/spider-state.ts` |
| `SpiderVisualConfig` | type | Visual-only config: body, palette, eye/fang/palp geometry, independent near/far leg rendering, three-segment leg geometry (coxaWidth, femurWidth, tibiaWidth), shared `SpiderLegGeometryConfig`, outlines, jitter, rest positions, and motion settings | `src/animation/spider/spider-state.ts` |
| `SpiderState` | type | Bundled spider state: `{gait: GaitState, palpL: readonly VerletNode[], palpR: readonly VerletNode[], jitterSeed: number}` — deterministic core, no renderer imports | `src/animation/spider/spider-state.ts` |
| `createSpiderState(config, jitterSeed, initialBodyX, initialBodyY, initialFacing?)` | function | Factory: initialise bundled spider state — configurable gait via `createGaitState` + both pedipalp spring-rods via `createSpringRod`. Pure, never throws | `src/animation/spider/spider-state.ts` |
| `stepSpider(state, bodyX, bodyY, vx, vy, facing, dt, config, tileQuery, tileSize, tick)` | function | Pure: advance whole spider one tick — `advanceGait` + `advanceSpringRod` (both palps). Returns fresh SpiderState. Never throws | `src/animation/spider/spider-state.ts` |

#### `src/animation/spider/types.ts` — combined config

| Export | Kind | Summary | Source |
|---|---|---|---|
| `SpiderConfig` | type | Combined gait + visual config. Extends `SpiderGaitConfig` and `SpiderVisualConfig`. Includes `geometry` (shared `SpiderLegGeometryConfig`) which is partitioned into both gait and visual halves by `splitSpiderConfig`. All fields readonly. Consumers spread `DEFAULT_SPIDER` and override fields | `src/animation/spider/types.ts` |
| `splitSpiderConfig(config)` | function | Pure: split `SpiderConfig` into `{gait: SpiderGaitConfig, visual: SpiderVisualConfig}`, partitioning the shared `geometry` config into both halves. Never throws | `src/animation/spider/types.ts` |

#### `src/animation/spider/spider.ts` — renderer-adjacent

| Export | Kind | Summary | Source |
|---|---|---|---|
| `LegPose` | type | Three-segment leg IK result: `{hipX, hipY, coxaX, coxaY, kneeX, kneeY, footX, footY, isBg}` — hip → coxa → knee → foot in world space | `src/animation/spider/spider.ts` |
| `SpiderPose` | type | Fully resolved spider pose ready for drawing: cephalothorax, abdomen, eyes, chelicerae, legPoses, palpChains, jitterOffsets | `src/animation/spider/spider.ts` |
| `evaluateSpiderPose(state, bodyX, bodyY, facing, vx, vy, tick, visualConfig)` | function | Pure: compute full rendering pose from deterministic state. Composes `solveThreeSegmentLeg` (three-segment coxa/femur/tibia IK via fixed coxa + analytical femur/tibia), `breathe` (abdomen breathing), `mulberry32` (seeded jitter). No simulation mutation. Never throws | `src/animation/spider/spider.ts` |
| `drawSpider(ctx, pose, visualConfig)` | function | Renderer-adjacent: draw spider pose. Order: bg legs → abdomen (jittered outline) → ceph (jittered outline) → 8 eyes → chelicerae fangs → fg legs (three tapered segments: coxa/femur/tibia with knee knob at femur/tibia junction and coxa knob at hip/coxa junction) → pedipalps (tapered polylines). `ctx.save()`/`ctx.restore()`. Never throws | `src/animation/spider/spider.ts` |

#### `src/animation/spider/constants.ts` — defaults

| Export | Kind | Summary | Source |
|---|---|---|---|
| `DEFAULT_SPIDER_PALETTE` | const | Default `SpiderPalette`: dark-purple body (`#4a2d6b`), red eyes (`#ff2222`), dark outline (`#1d1128`) | `src/animation/spider/constants.ts` |
| `DEFAULT_SPIDER_GEOMETRY` | const | Default `SpiderLegGeometryConfig`: tuned three-segment geometry (hipRadius, coxaLength, femurLength, tibiaLength, extension ratios, joint safety margin) for Sokpop-scale side-view spider | `src/animation/spider/constants.ts` |
| `DEFAULT_SPIDER` | const | Default `SpiderConfig` matching Sokpop-scale side-view spider. Coordinated gait, 4 legs per side, three-segment geometry, tuned step params, 8 eye definitions, 2 chelicerae, per-leg rest positions | `src/animation/spider/constants.ts` |

- _decision: `docs/design/procedural-spider-locomotion-decision.md`_
- _proposal: `docs/design/procedural-spider-locomotion-proposal.md`_
- _research: `docs/research/procedural-spider-locomotion.md`_
- _benchmark: `benchmarks/spider/sample-sheet.png`_
- _composes with: `src/animation/spider/geometry.ts` (`solveThreeSegmentLeg`, `computeHipPosition`, `computeCoxaEndpoint`, `computeFemurTibiaAnnuli`, `projectTargetIntoWorkspace`, `projectGroundedTargetIntoWorkspace`, `computeLegStepRequest`), `src/animation/spring-rod.ts` (`createSpringRod`, `advanceSpringRod`), `src/animation/squash-stretch.ts` (`breathe`), `src/collision/types.ts` (`TileSolidityQuery`), `src/collision/tiles.ts` (`worldToTile`, `tileToWorld`), `src/rng/mulberry32.ts` (seeded body jitter)_

### `src/character/` (PROPOSED)

> Proposal: `docs/design/character-body-plans-proposal.md` (Approach C: Registry Pattern).
> Research: `docs/research/character-body-plans.md`.
> Status: **PROPOSED** — awaiting `@architect` critique and benchmark.

Character body-plan catalog. Provides the registry-based abstraction for seeding, stepping, and rendering distinct character archetypes (slime-knight, humanoid biped, floater/drone, serpentine/multi-segment). Mirrors the `createEnemyBehaviorRegistry` pattern: a `BodyPlanHandler` interface encapsulates per-plan state, step, and draw; consumers register custom plans via `createBodyPlanRegistry`.

Each body plan lives in its own subdirectory under `src/character/` with dedicated `types.ts`, `config.ts`, `state.ts`, `draw.ts`, `constants.ts`, and `index.ts`. The registry layer is plan-agnostic — it never inspects config or state shapes.

**Cosmetics composition:** each plan handler's `deriveConfig` accepts a `Palette` from `src/palette/generatePalette(seed)`. Plans may embed plan-specific palette extensions (e.g., humanoid weapon/helmet colors) in their own config type. The registry imposes no palette contract.

#### `src/character/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `BodyPlanName` | type | `string` — free-string plan identifier for extensibility. Built-ins: `'slime'`, `'humanoid'`, `'floater'`, `'serpentine'` | `src/character/types.ts` |
| `CharacterConfig` | type | `Readonly<Record<string, unknown>>` — opaque config produced by `deriveConfig`. Plan-specific shape; registry never inspects | `src/character/types.ts` |
| `CharacterFrameState` | type | `Readonly<Record<string, unknown>>` — opaque per-frame state. Plan-specific shape; registry never inspects | `src/character/types.ts` |
| `CharacterInputs` | type | `{ walkDx?, facing?, jumpPressed?, jumpHeld?, [key: string]: unknown }` — shared input base + plan-specific extensions via index signature | `src/character/types.ts` |
| `BodyPlanHandler<TConfig, TState>` | interface | `{ deriveConfig(seed), createFrameState(config), step(state, dt, inputs?), draw(ctx, state, tick, look?) }` — plan handler contract. Generic over config and state types | `src/character/types.ts` |
| `BodyPlanRegistry` | type | `{ get(plan: string): BodyPlanHandler \| undefined }` — registry lookup. Same shape as `EnemyBehaviorRegistry` | `src/character/types.ts` |

#### `src/character/registry.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createBodyPlanRegistry(customPlans?)` | function | Factory: creates registry with `'slime'`, `'humanoid'`, `'floater'`, `'serpentine'` pre-registered, plus any custom handlers. Custom handlers merge on top of built-ins (same-name overrides). Mirrors `createEnemyBehaviorRegistry` | `src/character/registry.ts` |

#### `src/character/slime/` (PROPOSED — migrated from showcase)

Slime-knight body plan. Migrated from `showcase/helpers/slime-knight.ts`; showcase retains canvas-sizing, ground-line, blink, emotion, and leg-style toggle as showcase-local concerns.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `SlimeConfig` | type | Seed-derived config: seed, palette, bodyWidth/Height, eyeRadius, boneLengths, antennaSegments/SegmentLength, gaitConfig, springConfig, breathConfig, speed | `src/character/slime/types.ts` |
| `SlimeFrameState` | type | Per-frame state: config, locomotion, antenna (VerletNode[]), jump, x, facing, eyeCount, idleSettle | `src/character/slime/types.ts` |
| `SlimeInputs` | type | `{ walkDx?, facing?, jumpPressed?, jumpHeld?, eyeCount? }` — slime-specific inputs | `src/character/slime/types.ts` |
| `deriveSlimeConfig(seed)` | function | Deterministic config from 32-bit seed. Preserves the 16-draw RNG order from the showcase | `src/character/slime/config.ts` |
| `createSlimeFrameState(config)` | function | Initial frame state at rest. Antenna chain along forward-tilted rest vector | `src/character/slime/state.ts` |
| `stepSlime(state, dt, inputs?)` | function | Pure: advance jump, locomotion, antenna Verlet chain. Returns new SlimeFrameState | `src/character/slime/state.ts` |
| `drawSlime(ctx, state, tick, look?)` | function | Renderer-adjacent: draw slime-knight body + legs + eye + antenna | `src/character/slime/draw.ts` |
| `HERO_CANVAS_SIZE` | const | `320` — slime showcase canvas size. **Showcase-local, not re-exported from library** | `src/character/slime/constants.ts` |
| `HERO_GROUND_Y` | const | `HERO_CANVAS_SIZE * 0.82` — foot-plant line. **Showcase-local** | `src/character/slime/constants.ts` |
| `DEFAULT_SLIME` | const | Default SlimeConfig matching the showcase hero | `src/character/slime/constants.ts` |

#### `src/character/humanoid/` (PROPOSED)

Humanoid biped body plan. Head + torso + 2 arms + 2 legs, driven by existing `evaluateLocomotion` + `solveLimb` + skeletal rig.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `HumanoidConfig` | type | Seed-derived config: seed, palette, torsoWidth/Height, headRadius, arm/leg bone lengths, gaitConfig, breathConfig, speed | `src/character/humanoid/types.ts` |
| `HumanoidFrameState` | type | Per-frame state: config, locomotion, jump, armSwingPhase, x, facing | `src/character/humanoid/types.ts` |
| `HumanoidInputs` | type | `{ walkDx?, facing?, jumpPressed?, jumpHeld?, armTarget?: Vec2 }` — optional IK arm-target override | `src/character/humanoid/types.ts` |
| `deriveHumanoidConfig(seed)` | function | Deterministic config from seed. Same mulberry32 + palette pattern as slime | `src/character/humanoid/config.ts` |
| `createHumanoidFrameState(config)` | function | Initial frame state at rest | `src/character/humanoid/state.ts` |
| `stepHumanoid(state, dt, inputs?)` | function | Pure: advance jump, locomotion, arm-swing phase. Returns new HumanoidFrameState | `src/character/humanoid/state.ts` |
| `drawHumanoid(ctx, state, tick, look?)` | function | Renderer-adjacent: draw humanoid head + torso + arms + legs | `src/character/humanoid/draw.ts` |
| `DEFAULT_HUMANOID` | const | Default HumanoidConfig | `src/character/humanoid/constants.ts` |

#### `src/character/floater/` (PROPOSED)

Floater/drone body plan. Hovering core + trailing tentacles, driven by `breathe` + `advanceSpringChain`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `FloaterConfig` | type | Seed-derived config: seed, palette, coreRadius, tentacleCount, tentacleSegments, hoverAmplitude/Frequency, springConfig, breathConfig | `src/character/floater/types.ts` |
| `FloaterFrameState` | type | Per-frame state: config, tentacles (VerletNode[][]), hoverPhase, x, facing | `src/character/floater/types.ts` |
| `FloaterInputs` | type | `{ walkDx?, facing?, tiltOverride?: number }` — optional tilt angle override | `src/character/floater/types.ts` |
| `deriveFloaterConfig(seed)` | function | Deterministic config from seed | `src/character/floater/config.ts` |
| `createFloaterFrameState(config)` | function | Initial frame state at rest. Tentacle chains hanging below core | `src/character/floater/state.ts` |
| `stepFloater(state, dt, inputs?)` | function | Pure: advance hover oscillator + tentacle Verlet chains. Returns new FloaterFrameState | `src/character/floater/state.ts` |
| `drawFloater(ctx, state, tick, look?)` | function | Renderer-adjacent: draw core + dome + tentacles + thruster | `src/character/floater/draw.ts` |
| `DEFAULT_FLOATER` | const | Default FloaterConfig | `src/character/floater/constants.ts` |

#### `src/character/serpentine/` (PROPOSED)

Serpentine/multi-segment body plan. Head + N body segments + tail, driven by `advanceSpringChain`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `SerpentineConfig` | type | Seed-derived config: seed, palette, segmentCount, headRadius, tailRadius, segmentSpacing, springConfig, breathConfig | `src/character/serpentine/types.ts` |
| `SerpentineFrameState` | type | Per-frame state: config, segments (VerletNode[]), headAngle, x, facing | `src/character/serpentine/types.ts` |
| `SerpentineInputs` | type | `{ walkDx?, facing?, targetAngle?: number }` — optional head-angle override | `src/character/serpentine/types.ts` |
| `deriveSerpentineConfig(seed)` | function | Deterministic config from seed | `src/character/serpentine/config.ts` |
| `createSerpentineFrameState(config)` | function | Initial frame state at rest. Segments in straight line | `src/character/serpentine/state.ts` |
| `stepSerpentine(state, dt, inputs?)` | function | Pure: advance head kinematically + segment Verlet chain. Returns new SerpentineFrameState | `src/character/serpentine/state.ts` |
| `drawSerpentine(ctx, state, tick, look?)` | function | Renderer-adjacent: draw head + body segments + tail + segment-aligned plates | `src/character/serpentine/draw.ts` |
| `DEFAULT_SERPENTINE` | const | Default SerpentineConfig | `src/character/serpentine/constants.ts` |

- _proposal: `docs/design/character-body-plans-proposal.md`_
- _research: `docs/research/character-body-plans.md`_
- _composes with: `src/animation/locomotion.ts` (`advanceLocomotion`, `evaluateLocomotion`), `src/animation/ik/limb.ts` (`solveLimb`), `src/animation/spring.ts` (`advanceSpringChain`), `src/animation/squash-stretch.ts` (`breathe`), `src/animation/jump.ts` (`advanceJump`), `src/palette/generate.ts` (`generatePalette`), `src/rng/mulberry32.ts` (seeded variant generation)_

### `src/collision/`

AABB overlap test, per-axis move-and-resolve against static solids, and tile-grid collision. The foundational platformer collision layer. All exports are pure functions over plain data: no host access, no `Math.random`, no global state.

#### `src/collision/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Rect` | type | `{x, y, width, height}` — axis-aligned bounding box (world-space, top-left origin) | `src/collision/types.ts` |
| `Solid` | type | Extends `Rect` with optional `passthrough?: boolean` (one-way platform) and optional `id?: string` (stable contact identity used by the platformer kernel's `Contacts` record). Existing collision code ignores `id` — non-breaking addition | `src/collision/types.ts` |
| `ResolveXResult` | type | `{x, vx, hitWall}` — resolved horizontal position + adjusted velocity + wall-hit flag | `src/collision/types.ts` |
| `ResolveYResult` | type | `{y, vy, landed, hitCeiling}` — resolved vertical position + adjusted velocity + ground/ceiling flags | `src/collision/types.ts` |
| `TileType` | type | `'empty' \| 'solid' \| 'passthrough'` — tile solidity classification | `src/collision/types.ts` |
| `TileSolidityQuery` | type | `(tileX, tileY) => TileType` — consumer-provided tile-grid classifier | `src/collision/types.ts` |

#### `src/collision/aabb.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `aabbOverlap(a, b)` | function | Strict AABB overlap test — edges that merely touch are NOT overlapping (prevents re-collision jitter) | `src/collision/aabb.ts` |

#### `src/collision/resolve.ts`

Per-axis move-and-resolve against static solids. Passthrough solids are skipped on X (one-way platforms only block downward Y). Pure: inputs never mutated.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `resolveAxisX(body, vx, solids)` | function | Move body by `vx`, resolve against fully-solid surfaces. Snaps flush + zeros `vx` on wall hit. Zero velocity short-circuits | `src/collision/resolve.ts` |
| `resolveAxisY(body, vy, solids, prevBottom)` | function | Move body by `vy`, resolve against solids. Passthrough platforms only block when `prevBottom <= solid.y`. Returns `landed`/`hitCeiling` flags | `src/collision/resolve.ts` |

#### `src/collision/tiles.ts`

Tile-grid collision layer. Queries the tile grid for overlapping tiles, converts to `Solid` rects, delegates to `resolveAxisX`/`resolveAxisY`. No resolution logic duplicated. Tunneling limitation: `|v| > tileSize` can skip thin tiles.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `worldToTile(worldX, worldY, tileSize)` | function | World-space coords → `{tileX, tileY}` grid indices (floor-based, handles negatives) | `src/collision/tiles.ts` |
| `tileToWorld(tileX, tileY, tileSize)` | function | Grid indices → `{x, y}` world-space top-left corner | `src/collision/tiles.ts` |
| `tileRect(tileX, tileY, tileSize)` | function | Grid indices → world-space `Rect` covering that tile | `src/collision/tiles.ts` |
| `resolveTileX(body, vx, query, tileSize)` | function | Horizontal tile-grid resolve: queries overlapping tiles, delegates to `resolveAxisX` | `src/collision/tiles.ts` |
| `resolveTileY(body, vy, query, tileSize, prevBottom)` | function | Vertical tile-grid resolve: queries overlapping tiles, delegates to `resolveAxisY` with passthrough support | `src/collision/tiles.ts` |

#### `src/collision/moving-gap.ts`

> Decision: `docs/design/moving-gap-decision.md`.
> Research: `docs/research/moving-gap-platform.md`.
> Benchmark: `benchmarks/moving-gap/sample-sheet.png`.

Moving-gap platform: a traveling absence of floor. Splits a span into 0–2 `Solid` fragments around a clamped gap. The geometry helper (`gapSolids`) enforces the "void never standable" invariant by clamping internally — no caller can produce fragments that escape the span. Optional deterministic motion state machine for sweep/chase/expand patterns. `GapGeometry` (not `GapState`) avoids confusion with `GapMotionState`. `path`/`loopMode` are optional on `GapMotionConfig` (only meaningful for sweep). NaN inputs throw (programmer error, consistent with `parseHex`).

**Non-barrel export:** `sampleMovingGapScene` and its helper types (`MovingGapSampleRect`, `MovingGapSampleFrame`, `MovingGapSampleScene`, `MovingGapSampleSheet`) are exported from this file but deliberately NOT re-exported from `src/collision/index.ts`. They are benchmark-only data consumed by `benchmarks/_scripts/moving-gap-render.ts` via direct import — not part of the public API.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `GapSpanConfig` | type | Span definition: `{x, y, width, height, passthrough?}`. Immutable after creation | `src/collision/moving-gap.ts` |
| `GapGeometry` | type | Geometry snapshot: `{centerX, width}` — where the gap is right now (world-space pixels) | `src/collision/moving-gap.ts` |
| `GapTravelMode` | type | `'sweep' \| 'chase' \| 'expand'` — motion mode selector | `src/collision/moving-gap.ts` |
| `GapLoopMode` | type | `'loop' \| 'pingpong'` — sweep endpoint behavior | `src/collision/moving-gap.ts` |
| `GapMotionConfig` | type | Motion params: `travelMode`, `speed`, `gapWidth`, `path?`, `loopMode?`, `giveUpRadius?`, `minWidth?`, `maxWidth?`, `expandTicks?`, `initialCenterX?`. Mode-specific fields optional with documented defaults; `path` defaults to `[]`, `loopMode` defaults to `'loop'` | `src/collision/moving-gap.ts` |
| `GapMotionState` | type | Motion state: `centerX`, `width`, `dist`, `dir`, `expandElapsed` | `src/collision/moving-gap.ts` |
| `gapSolids(span, gap)` | function | **Invariant anchor.** Pure geometry: split span into 0–2 `Solid` fragments around a clamped gap. Four-guard clamp algorithm (NaN→throw, ≤0→full span, ≥span→void, else→clamp). Throws on NaN inputs | `src/collision/moving-gap.ts` |
| `createGapMotion(config)` | function | Pure: initialize `GapMotionState` from a `GapMotionConfig`. Per-mode `centerX` default (sweep→`path[0].x`, chase/expand→`0`); override via `initialCenterX`. `width` is `gapWidth` (sweep/chase) or `minWidth` (expand). Never throws | `src/collision/moving-gap.ts` |
| `advanceGapMotion(state, dt, config, targetX?)` | function | Pure motion: advance gap state by one tick. Returns new `GapMotionState`. May produce unclamped `centerX`; `gapSolids` clamps before fragment generation | `src/collision/moving-gap.ts` |
| `gapTileQuery(base, span, gap, tileSize)` | function | Pure: wrap a `TileSolidityQuery` to report `'empty'` for tiles inside the clamped gap. Single-row v1: only tiles overlapping the span's Y range are affected. Uses strict AABB overlap (not left-edge test) for tile membership. Clamped gap bounds computed once at wrap time, O(1) per tile | `src/collision/moving-gap.ts` |
| `DEFAULT_GAP_WIDTH` | const | `64` — default gap width in pixels (GDD §6.13) | `src/collision/moving-gap.ts` |
| `DEFAULT_GAP_SPEED` | const | `2` — default movement speed in px/tick (GDD §6.13) | `src/collision/moving-gap.ts` |
| `DEFAULT_CHASE_GIVE_UP_RADIUS` | const | `200` — default chase give-up radius (~3× gap width; mirrors Spitekeep chase-disengage feel) | `src/collision/moving-gap.ts` |

### `src/camera/`

Follow-camera: pure world-space position that lerps toward a target, clamped to level bounds. The renderer reads `Camera.x/y` and rounds to integer pixels only when applying the world transform.

#### `src/camera/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Camera` | type | `{x, y}` — viewport top-left in world-space (floats between updates for smooth lerp) | `src/camera/types.ts` |
| `CameraTarget` | type | `{x, y, width, height}` — axis-aligned rect the camera follows (typically the player) | `src/camera/types.ts` |
| `CameraBounds` | type | `{width, height}` — level / world dimensions for clamping | `src/camera/types.ts` |
| `CameraConfig` | type | `{lerp?, snapThreshold?}` — tuning; all fields optional, fall back to `DEFAULT_CAMERA` | `src/camera/types.ts` |

#### `src/camera/constants.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `DEFAULT_CAMERA` | const | `{lerp: 0.1, snapThreshold: 0.5}` — smooth follow with sub-pixel convergence | `src/camera/constants.ts` |

#### `src/camera/follow.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createCamera()` | function | Factory: fresh camera at world origin `{x: 0, y: 0}` | `src/camera/follow.ts` |
| `updateCamera(camera, target, bounds, viewport, config?)` | function | Pure: advance camera one frame toward target. Centres on target, clamps to bounds (centres level when smaller than viewport), lerps with snap-to-target convergence. Returns new `Camera` | `src/camera/follow.ts` |

### `src/input/`

Deterministic edge accumulator + defensive device adapters. Two layers: pure core (`edges.ts`, `merge.ts`) for DOM-free unit testing, and defensive adapters (`keyboard.ts`, `touch-button.ts`, `touch-button-set.ts`, `gamepad.ts`) with lazy host resolution, error swallowing, and never-throw public APIs.

- _research note: See `docs/research/mobile-directional-input.md` for multi-touch pointer-ID tracking, virtual D-pads, and analog thumbsticks._

#### `src/input/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `EdgeAccumulator` | type | Mutable event buffer: `{held, pressedSincePoll, releasedSincePoll}`. **Intentionally mutable** — device events latch here between ticks; drained deterministically via `pollEdge` | `src/input/types.ts` |
| `PolledEdge` | type | `{held, pressed, released}` — per-tick snapshot (single-tick edges cleared after poll) | `src/input/types.ts` |
| `KeyboardAdapter` | type | `{poll(), dispose()}` — maps `KeyboardEvent.code` to actions, manages one `EdgeAccumulator` per action | `src/input/types.ts` |
| `KeyboardConfig` | type | `{codeToAction: Record<string, string>}` — maps key codes to action names | `src/input/types.ts` |
| `TouchButtonAdapter` | type | `{poll(), dispose()}` — tracks pointer events on a single DOM element | `src/input/types.ts` |
| `TouchButtonSetConfig` | type | `{ elements: readonly (HTMLElement \| null)[] }` — DOM elements for each button; nulls produce idle slots but keep alignment | `src/input/types.ts` |
| `TouchButtonSetAdapter` | type | `{poll(): PolledEdge[], dispose(): void}` — multi-touch-safe button group; array-aligned with input | `src/input/types.ts` |
| `GamepadConfig` | type | `{ buttonToAction, axisToAction?, deadzone? }` — maps Standard Gamepad buttons/axes to action names. `buttonToAction` is required; `axisToAction` and `deadzone` are optional | `src/input/types.ts` |
| `AxisBinding` | type | `{ positive?: string; negative?: string }` — bidirectional axis-to-action pair | `src/input/types.ts` |
| `GamepadAdapter` | type | `{ poll(): Record<string, PolledEdge>, dispose(): void }` — mirrors `KeyboardAdapter` shape | `src/input/types.ts` |

#### `src/input/edges.ts`

Pure edge accumulator core. DOM-free, deterministic, fully unit-testable under Node. Edges are latched as booleans on event arrival (not derived from held-state diff), so a full press+release between polls surfaces as `pressed=true AND released=true`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createEdgeAccumulator()` | function | Factory: fresh idle accumulator (`held: false`, no pending edges) | `src/input/edges.ts` |
| `pressEdge(acc)` | function | Record a press: sets `held` true, latches `pressedSincePoll`. Mutates in place | `src/input/edges.ts` |
| `releaseEdge(acc)` | function | Record a release: clears `held`, latches `releasedSincePoll`. Mutates in place | `src/input/edges.ts` |
| `resetEdge(acc)` | function | Reset to fully idle (blur/dispose). Mutates in place | `src/input/edges.ts` |
| `pollEdge(acc)` | function | Drain accumulated edges for this tick: returns `PolledEdge` snapshot, clears edge latches. Mutates in place | `src/input/edges.ts` |

#### `src/input/merge.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `orEdges(a, b)` | function | Pure OR-merge of two `PolledEdge` snapshots (e.g. keyboard + touch for same action). Returns fresh object | `src/input/merge.ts` |

#### `src/input/keyboard.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createKeyboardAdapter(config)` | function | Defensive keyboard adapter. Lazily resolves `window`, swallows errors. Returns no-op adapter in Node/SSR. Ignores `e.repeat`; resets all accumulators on blur | `src/input/keyboard.ts` |

#### `src/input/touch-button.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createTouchButton(element)` | function | Defensive touch-button adapter. Tracks `pointerdown`/`pointerup`/`pointercancel`/`pointerleave` on a single DOM element. Returns no-op when element is null. Sets `touchAction: 'none'`. **Limitation:** no pointer-ID tracking (two fingers on same element cause cross-talk) and no global safety net — use `createTouchButtonSet` for multi-touch-safe button groups | `src/input/touch-button.ts` |

#### `src/input/touch-button-set.ts`

> Decision: `docs/design/mobile-directional-input-decision.md`.
> Proposal: `docs/design/mobile-directional-input-proposal.md` (Approach B).

Generic multi-touch-safe button group adapter. Takes an array of DOM elements (or nulls for missing slots), returns N `PolledEdge` outputs. Tracks pointer IDs per element with 0→≥1 / 1→0 transitions, preventing cross-talk when two fingers touch the same button. Global `document` `pointerup`/`pointercancel`/`pointerleave` safety net catches viewport-exit events (the stuck-button fix). Sets `touchAction: 'none'` on each non-null element. Short-circuits to a no-op adapter (still returning an idle array of the right length) when `window` is undefined (SSR safety). Direction-agnostic — the consumer maps array indices to semantics (directions, action buttons, etc.).

| Export | Kind | Summary | Source |
|---|---|---|---|
| `TouchButtonSetConfig` | type | `{ elements: readonly (HTMLElement \| null)[] }` — DOM elements for each button, in positional order. Null entries produce idle slots but keep array alignment | `src/input/types.ts` |
| `TouchButtonSetAdapter` | type | `{ poll(): PolledEdge[], dispose(): void }` — drains N accumulators per tick; array-aligned with input | `src/input/types.ts` |
| `createTouchButtonSet(config)` | function | Defensive multi-touch button set. Tracks pointer IDs per element with 0→≥1 / 1→0 transitions; global `document` safety net (`pointerup`/`pointercancel`/`pointerleave`). Sets `touchAction: 'none'` on each non-null element. Returns no-op adapter (still array-length-aligned) when `window` undefined | `src/input/touch-button-set.ts` |

- _decision: `docs/design/mobile-directional-input-decision.md`_
- _research note: `docs/research/mobile-directional-input.md` §Pattern 1, §Multi-Touch_
- _existence proof: Spitekeep `src/input/touch.ts` (`TouchControls` class with identical pointer-ID tracking; ~120 lines of reusable core in a 414-line class that also includes CSS injection, capability detection, and DOM creation)_

#### `src/input/gamepad.ts`

> Decision: `docs/design/gamepad-adapter-decision.md` (Approach A: Full Parity — Keyboard-Mirror Pattern).
> Proposal: `docs/design/gamepad-adapter-proposal.md`.
> Research: `docs/research/gamepad-adapter.md`.

Defensive gamepad input adapter. Polls `navigator.getGamepads()` once per tick, maps the W3C Standard Gamepad layout (button indices 0–16, axes 0–3) to logical actions, applies an **axial per-axis threshold** deadzone (default 0.25) to analog sticks, and latches threshold-crossings into per-action `EdgeAccumulator`s. OR-merges with keyboard/touch via the existing `orEdges` helper — gamepad becomes a third device feeding the same binary edge core.

Single-player v1: binds to the first connected pad (`getGamepads()[0]`). Multi-player deferred to v2 (consumer creates a second adapter). Connect/disconnect lifecycle events reset accumulators (prevents stuck buttons on controller disconnect). `timestamp`-based change detection short-circuits when hardware hasn't reported new data. Requires `mapping === 'standard'` — warns once and no-ops for non-standard controllers. No rumble (deferred to v2, Chrome-only). Closure-scoped state (no module-level globals). `gamepad.timestamp` used ONLY for change-detection, never feeds simulation state.

SSR guard: `typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function'` returns no-op adapter.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `GamepadConfig` | type | `{ buttonToAction, axisToAction?, deadzone? }` — maps Standard Gamepad buttons/axes to action names. `buttonToAction` is required; `axisToAction` and `deadzone` (default 0.25) are optional | `src/input/types.ts` |
| `AxisBinding` | type | `{ positive?: string; negative?: string }` — bidirectional axis-to-action pair | `src/input/types.ts` |
| `GamepadAdapter` | type | `{ poll(): Record<string, PolledEdge>, dispose(): void }` — mirrors `KeyboardAdapter` shape; returns `{}` when no standard pad is connected or in Node/SSR | `src/input/types.ts` |
| `DEFAULT_GAMEPAD_DEADZONE` | const | `0.25` — default axial per-axis threshold deadzone (Sutphin recommendation, adequate for platformers per research Pattern 4) | `src/input/gamepad.ts` |
| `createGamepadAdapter(config)` | function | Defensive gamepad adapter. Lazily resolves `navigator` at factory-call time. SSR guard: `typeof navigator === 'undefined' \|\| typeof navigator.getGamepads !== 'function'` → returns no-op adapter (`{ poll: () => ({}), dispose: () => {} }`). Installs `gamepadconnected`/`gamepaddisconnected` listeners with `resetEdge` on disconnect. `poll()` reads `navigator.getGamepads()[0]`, requires `mapping === 'standard'`, applies axial per-axis threshold deadzone, diffs button/axis state against previous, drains accumulators. `timestamp` change-detection: skips re-diff when `pad.timestamp` unchanged (Firefox fallback: always re-diff when `timestamp === 0`). Warns once on non-standard mapping (includes full gamepad `id`). `dispose()` guard: `if (disposed) return; disposed = true;`. Never throws | `src/input/gamepad.ts` |

- _proposal: `docs/design/gamepad-adapter-proposal.md` (Approach A: Full Parity)_
- _research: `docs/research/gamepad-adapter.md`_
- _composes with: `src/input/edges.ts` (`createEdgeAccumulator`, `pressEdge`, `releaseEdge`, `resetEdge`, `pollEdge`), `src/input/merge.ts` (`orEdges`)_

### `src/game-loop/`

Fixed-step game loop — the connective tissue that ties input → simulation → render into a running game. Two layers: pure accumulator math (`advanceAccumulator`, DOM-free, unit-testable under Node) and a defensive host-touching adapter (`createGameLoop`) that lazily resolves `requestAnimationFrame` / `performance.now()` / `document`, swallows all errors, never throws. Includes spiral-of-death guard (`maxFrameDelta` clamp) and `visibilitychange` pause/resume so a backgrounded tab doesn't produce a catch-up burst on regain.

#### `src/game-loop/fixed-step.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `DEFAULT_FIXED_DT` | const | `1/60` — default fixed simulation timestep (60 Hz) | `src/game-loop/fixed-step.ts` |
| `DEFAULT_MAX_FRAME_DELTA` | const | `1/6` — default max frame delta before clamping (~10 catch-up steps at 60 Hz; spiral-of-death guard) | `src/game-loop/fixed-step.ts` |
| `AccumulatorStep` | type | `{accumulator, alpha}` — leftover time + interpolation alpha returned by `advanceAccumulator` | `src/game-loop/fixed-step.ts` |
| `advanceAccumulator(accumulator, frameDelta, fixedDt, maxFrameDelta, step)` | function | Pure fixed-timestep math: clamps delta, calls `step(fixedDt)` once per whole step, returns leftover accumulator + alpha. No DOM, no globals, no `Date.now()` | `src/game-loop/fixed-step.ts` |
| `createGameLoop(config)` | function | Defensive fixed-step loop adapter. Lazily resolves RAF / `performance.now()` / `document` at factory-call time. Handles `visibilitychange` pause/resume. `start()` is a silent no-op in Node/SSR. Never throws | `src/game-loop/fixed-step.ts` |

#### `src/game-loop/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `GameLoopConfig` | type | `{fixedDt?, maxFrameDelta?, step, render}` — loop config; `step` receives `fixedDt` each call, `render` receives interpolation alpha | `src/game-loop/types.ts` |
| `GameLoop` | interface | `{start(), stop(), isRunning(), dispose()}` — running loop handle; all methods idempotent and never-throw | `src/game-loop/types.ts` |

### `src/game-state/` (shipped)

> Decision: `docs/design/game-state-fsm-decision.md`.
> Proposal: `docs/design/game-state-fsm-proposal.md` (Approach A: Pure Reducer + Flat Record, with type-only discriminated-union export).
> Research: `docs/research/game-state-fsm.md`.

Top-level game-mode FSM — declarative mode orchestration (menu / playing / paused / gameover / levelComplete). Pure deterministic reducer mirrors the `advanceJump` / `advanceTween` / `advanceEmitter` shape: consumer owns `GameState`, engine provides `reduceGameState`. The FSM sits inside the consumer's `step(fixedDt)` callback; the game-loop module is completely untouched (pause is a *state*, not a loop pause). Adjacency table is plain data (`DEFAULT_GAME_STATE_ADJACENCY`) consumers can spread-override — custom modes/events are added by extending the table with type assertions at the call site. Illegal transitions are silent no-ops (never throw); `timeInState` keeps advancing on illegal events. Consumer detects "just entered" via `state.timeInState === 0` after a legal transition. No enter/exit callbacks — the consumer's `switch` on `state.current` IS the lifecycle.

**Terminal-event semantics:** both `die` and `win` write `finalScore` AND freeze `score` to the same value, so consumers reading `state.score` after a terminal event see the final score. This is symmetric — no special-casing between win and die.

**Determinism contract:** `dt`-driven `timeInState` (never `Date.now()`), no `Math.random`, no DOM reads, no global mutable state. Same `(state, event, dt, table)` → byte-identical returned state forever.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `GameMode` | type | `'menu' \| 'playing' \| 'paused' \| 'gameover' \| 'levelComplete'` — canonical 5-state platformer modes | `src/game-state/types.ts` |
| `GameEvent` | type | Discriminated union of 8 transition events, each carrying only its relevant payload: `start` (`level?: number`), `pause`, `resume`, `die` (`finalScore?: number`), `win` (`finalScore?: number`), `retry`, `next`, `quit` | `src/game-state/types.ts` |
| `GameState` | type | Flat record: `{ readonly current, readonly timeInState, readonly level, readonly score, readonly finalScore }` — consumer-owned state; all fields `readonly` (reducer returns fresh shallow-spread). Shallow-spread is safe because `GameState` is a flat record of primitives — no nested objects to share by reference | `src/game-state/types.ts` |
| `GameStateExact` | type | **Type-only** discriminated-union alias of `GameState` — each variant carries only valid fields per mode (e.g. `menu` omits `score`/`finalScore` as `?: never`; `gameover`/`levelComplete` carry both). Compile-time impossible-state prevention; no runtime shape change. Erases completely at compile time | `src/game-state/types.ts` |
| `TransitionTable` | type | `Record<GameMode, Partial<Record<GameEvent['type'], GameMode>>>` — adjacency table as plain data. A missing `(from, event)` entry means the transition is illegal | `src/game-state/types.ts` |
| `GameStateConfig` | type | `{ startingLevel? }` — config for `createGameState`. All fields optional | `src/game-state/types.ts` |
| `DEFAULT_GAME_STATE_ADJACENCY` | const | Canonical adjacency table: `menu→playing` (start), `playing→paused` (pause), `playing→levelComplete` (win), `playing→gameover` (die), `paused→playing` (resume), `paused→menu` (quit), `gameover→playing` (retry), `gameover→menu` (quit), `levelComplete→playing` (next), `levelComplete→menu` (quit). Spread-override for custom states | `src/game-state/game-state.ts` |
| `createGameState(config?)` | function | Factory: fresh `'menu'` state with all accumulators zeroed (`timeInState: 0`, `level: config?.startingLevel ?? 0`, `score: 0`, `finalScore: 0`). Matches `createJumpState` / `createTweenState` / `createEmitter` pattern | `src/game-state/game-state.ts` |
| `reduceGameState(state, event, dt, table?)` | function | Pure: advance FSM one fixed timestep. Per-tick order: (1) clamp `dt` to `>= 0` (non-finite/≤0 → 0), (2) always advance `timeInState` by clamped `dt`, (3) if `event` is `null`/`undefined` return time-advanced state, (4) look up `(state.current, event.type)` in table, (5) if legal: spread advanced state, write event payload, set `current` to next mode, reset `timeInState` to `0`, (6) if illegal: return time-advanced state unchanged. Payload mapping: `start` → `level` (defaults to `0`); `die`/`win` → `finalScore` (defaults to `0`) AND `score` (frozen to match). `event` parameter accepts `null`/`undefined` to just advance time. Never throws | `src/game-state/game-state.ts` |
| `isLegalTransition(from, event, table?)` | function | Pure reader: check whether a transition is legal without advancing state. Returns `true` iff `event.type` resolves to a defined next mode for `from` in `table`. Mirrors the reducer's transition decision exactly. No `dt`, no mutation | `src/game-state/game-state.ts` |

**Note on `retry` vs `restart`:** the event that restarts from `gameover` back into `playing` is named `retry` (not `restart`). The event that advances from `levelComplete` back into `playing` is named `next`. These are the actual `GameEvent` variant names in source.

- _decision: `docs/design/game-state-fsm-decision.md`_
- _proposal: `docs/design/game-state-fsm-proposal.md`_
- _research: `docs/research/game-state-fsm.md`_
- _composes with: `src/game-loop/fixed-step.ts` (sits inside consumer's `step(fixedDt)` callback; loop module untouched)_

### `src/terrain/`

Deterministic terrain foundation and Phase 2 Canvas renderers.
dependency; material normalization and drawing are Phase 2.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `TerrainNeighborMask` | type | Eight-neighbor connection bitmask | `src/terrain/types.ts` |
| `TerrainNeighborhood` | type | Named neighbor booleans plus compact mask | `src/terrain/types.ts` |
| `TERRAIN_NORTH` … `TERRAIN_NORTH_WEST` | constants | Stable bits for the eight compass directions | `src/terrain/connectivity.ts` |
| `sampleTerrainNeighborhood(grid, col, row, connects)` | function | Pure eight-neighbor sampling; malformed data returns empty, connector errors propagate | `src/terrain/connectivity.ts` |
| `connectsEqualValue(a, b)` | function | Common identical-value connector | `src/terrain/connectivity.ts` |
| `createTerrainConnector(values)` | function | Treat configured tile values as one connected family | `src/terrain/connectivity.ts` |
| `TerrainConnectionTable` | type | Sparse prepared ordered-pair lookup | `src/terrain/types.ts` |
| `createTerrainConnectionTable(grid, connects, options?)` | function | Evaluate each observed ordered pair once; optional preparation-time error reporting | `src/terrain/connectivity.ts` |
| `TerrainViewport` | type | Authoritative world-space view rectangle | `src/terrain/types.ts` |
| `VisibleTileRange` | type | Half-open visible grid indices | `src/terrain/types.ts` |
| `visibleTileRange(grid, view, overscanTiles?)` | function | Pure, clamped visible-cell range with malformed/disjoint empty behavior | `src/terrain/viewport.ts` |
| `ExposedSpan` | type | Half-open world-space interval along an edge | `src/terrain/types.ts` |
| `TerrainRectInput` | type | Static rectangle, connection family, and optional sliver threshold | `src/terrain/types.ts` |
| `TerrainRectExposure` | type | Exposed spans for top/right/bottom/left edges | `src/terrain/types.ts` |
| `ComputeRectExposureOptions` | type | Optional family connector and touching epsilon | `src/terrain/types.ts` |
| `computeRectExposures(rects, options?)` | function | Order-independent, family-scoped static edge exposure preparation | `src/terrain/rect-exposure.ts` |
| `TerrainMaterialInput`, `TerrainPalette` | interfaces | Loose author-facing material and palette inputs | `src/terrain/types.ts` |
| `NormalizedTerrainMaterial` | branded interface | Validated, fully resolved material accepted by draw APIs | `src/terrain/material.ts` |
| `normalizeTerrainMaterial(input)` | function | Validate colors, clamp geometry/detail values, and resolve the hot-path channel id | `src/terrain/material.ts` |
| `TerrainMaterialTable` | opaque interface | Prepared numeric tile-value to normalized-material lookup | `src/terrain/material.ts` |
| `createTerrainMaterialTable(entries)` | function | Normalize a complete material table once at setup | `src/terrain/material.ts` |
| `RUINS_TERRAIN_MATERIAL`, `CAVERN_TERRAIN_MATERIAL`, `MECHANICAL_TERRAIN_MATERIAL` | constants | Built-in example materials with distinct structural treatments | `src/terrain/material.ts` |
| `TerrainDetailRenderer`, `TerrainDetailContext` | types | Seeded per-surface extension contract | `src/terrain/surface-detail.ts` |
| `drawBuiltinTerrainDetail(ctx, detail)` | function | Mortar, cracks, rivulets, rivets, and crystal detail dispatcher | `src/terrain/surface-detail.ts` |
| `drawTerrainTiles(ctx, grid, options)` | function | Culled connected-tile renderer with exposed caps, sides, silhouettes, and stable details | `src/terrain/tile-renderer.ts` |
| `TerrainRectRole` | type | `solid`, `passthrough`, `moving`, or `hazard` rectangle role | `src/terrain/types.ts` |
| `drawTerrainRect(ctx, rect, options)` | function | Span-aware role renderer, including mechanical and pointed hazard silhouettes | `src/terrain/rect-renderer.ts` |

### `src/platformer/`

#### Level theme facade

| Export | Kind | Purpose | Module |
|---|---|---|---|
| `LevelRenderTheme`, `LevelTerrainTheme` | interfaces | Author-facing theme, materials, palettes, layers, and overrides | `src/platformer/level-theme.ts` |
| `LevelRenderFrame` | interface | View, DPR, resolved runtime entities, tick, mode, and reduced-motion state | `src/platformer/level-theme.ts` |
| `ResolvedLevelEntity` | interface | Authored entity paired with its authoritative current-frame rectangle | `src/platformer/level-theme.ts` |
| `createLevelThemeRenderer(theme, options?)` | function | Normalize level-independent theme data and capture diagnostics | `src/platformer/level-theme.ts` |
| `LevelThemeRenderer.prepare(level)` | function | Prepare connectivity and static rectangle exposure once for a level | `src/platformer/level-theme.ts` |
| `PreparedLevelScene` | interface | Explicit background, terrain, entity, decoration, foreground, and tint passes | `src/platformer/level-theme.ts` |
| `resolveLevelEntities(entities, runtimeRects?)` | function | Build resolved entries while preserving authored entity records | `src/platformer/level-theme.ts` |
| `TERRAIN_ROLE_KINDS`, `NON_TERRAIN_KINDS` | constants | Compile-time and runtime exhaustive entity partition | `src/platformer/level-theme.ts` |
| `drawPreparedLevelFrame(ctx, scene, frame, options?)` | function | Compose screen/world passes with a snapped, balanced world transform | `src/platformer/level-layers.ts` |
| `RUINS_LEVEL_THEME` | constant | Warm masonry example theme | `src/platformer/themes/ruins.ts` |
| `CAVERN_LEVEL_THEME` | constant | Cool rock-and-vein example theme | `src/platformer/themes/cavern.ts` |
| `MECHANICAL_LEVEL_THEME` | constant | Steel plate example theme | `src/platformer/themes/mechanical.ts` |
| `drawThemedLevelEntity(ctx, resolved, frame, options)` | function | Semantic exits, collectibles, traps, and play/edit marker behavior | `src/platformer/themed-entity-renderer.ts` |
| `DrawThemedLevelEntityOptions` | interface | Theme identity and entity-palette input for semantic fallbacks | `src/platformer/themed-entity-renderer.ts` |
| `drawRuinsDust` | layer callback | Sparse stateless dust recipe with fixed reduced-motion output | `src/platformer/atmosphere-recipes.ts` |
| `drawCavernDrips` | layer callback | Stateless cavern drips with reduced-motion simplification | `src/platformer/atmosphere-recipes.ts` |
| `drawMechanicalSparks` | layer callback | Stateless warning sparks with static reduced-motion state | `src/platformer/atmosphere-recipes.ts` |

> Decision: `docs/design/platformer-kernel-decision.md`.
> Proposal: `docs/design/platformer-kernel-proposal.md` (Approach B: Composable Ability Processors).
> Research: `docs/research/platformer-kernel.md`.

Deterministic 2D platformer simulation kernel. Composes existing primitives (`advanceJump`, `resolveAxisX`/`resolveAxisY`, edge accumulators) into a single authoritative step function with composable ability processors. Single-actor v1; multi-actor deferred. Supports precision platformer conformance suite: coyote time, jump buffering, variable height, wall slide/jump, dash, double-jump, moving-platform push-and-carry.

#### `src/platformer/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Contacts` | type | Contact identity: `groundId`, `leftWallId`, `rightWallId`, `ceilingId` (all `string \| null`). Populated from `Solid.id` via collision resolution | `src/platformer/types.ts` |
| `PlatformerEvents` | type | Per-tick events: `justLanded`, `justLaunched`, `hitCeiling`, `hitWall`, `startedWallSlide`, `wallJumpLaunched`, `dashStarted`, `doubleJumped` (all `boolean`) | `src/platformer/types.ts` |
| `PlatformerInput` | type | Per-tick input: `moveX` (-1/0/+1), `jump` (PolledEdge), `dash` (PolledEdge \| null) | `src/platformer/types.ts` |
| `ActorCore` | type | Core physics state: `x`, `y`, `width`, `height`, `vx`, `vy`, `facing`, `onGround`, `contacts`. Strictly readonly per tick | `src/platformer/types.ts` |
| `AbilityState` | interface | Base ability state: `kind` discriminator | `src/platformer/types.ts` |
| `AbilityContext` | type | Read-only tick context passed to abilities: `core`, `input`, `dt`, `config` | `src/platformer/types.ts` |
| `AbilityResult<T>` | type | Per-ability return: `core` (shallow-copied), `state`, `events` (partial) | `src/platformer/types.ts` |
| `AbilityProcessor<T>` | interface | Ability processor: `kind` + `advance(ctx, state) → AbilityResult<T>`. Pure, never throws | `src/platformer/types.ts` |
| `PlatformerState` | type | Full character state: `core`, `abilities` (Record by kind), `events`, `tick` | `src/platformer/types.ts` |
| `PlatformerConfig` | type | Tunable knobs including signed `gravity`, gravity-direction terminal-speed magnitude `maxFallSpeed`, optional `jumpEnabled`, and existing movement/ability settings | `src/platformer/types.ts` |
| `MoveInput` | type | Convenience pair: `left` + `right` PolledEdge for building `PlatformerInput.moveX` | `src/platformer/types.ts` |
| `JumpAbilityState` | type | Jump ability state: `kind: 'jump'`, wraps `JumpState` from `src/animation/jump` | `src/platformer/types.ts` |
| `WallSlideAbilityState` | type | Wall-slide state: `kind: 'wallSlide'`, `sliding`, `side`, `lockTimer` | `src/platformer/types.ts` |
| `DashAbilityState` | type | Dash state: `kind: 'dash'`, `timer`, `cooldown`, `dashesRemaining`, `dirX`, `dirY` | `src/platformer/types.ts` |
| `DoubleJumpAbilityState` | type | Double-jump state: `kind: 'doubleJump'`, `jumpsRemaining` | `src/platformer/types.ts` |
| `AnyAbilityState` | type | Discriminated union of all shipped ability states | `src/platformer/types.ts` |

#### `src/platformer/constants.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `DEFAULT_PLATFORMER_CONFIG` | const | Default config matching Sokpop-style precision platformer feel (gravity 980, moveSpeed 200, etc.) | `src/platformer/constants.ts` |
| `DEFAULT_PLAYER_WIDTH` | const | `16` — default player body width in world units | `src/platformer/constants.ts` |
| `DEFAULT_PLAYER_HEIGHT` | const | `24` — default player body height in world units | `src/platformer/constants.ts` |
| `EMPTY_CONTACTS` | const | All-null `Contacts` — initial state for a freshly created actor | `src/platformer/constants.ts` |
| `EMPTY_EVENTS` | const | All-false `PlatformerEvents` — starting point for per-tick event accumulation | `src/platformer/constants.ts` |

#### `src/platformer/riding-tracker.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `SolidDisplacement` | type | `{dx, dy}` — per-tick displacement of a moving solid in world units | `src/platformer/riding-tracker.ts` |
| `SolidDisplacementProvider` | type | `(solidId: string) => SolidDisplacement \| null` — consumer-provided callback for moving-platform carry | `src/platformer/riding-tracker.ts` |
| `RidingTracker` | type | `{applyCarry(core, getDisplacement, supportId?)}` — applies a support solid's displacement before abilities; defaults to `groundId` | `src/platformer/riding-tracker.ts` |
| `createRidingTracker()` | function | Pure factory with optional explicit support ID for inverted-gravity carry. Returns input core unchanged when no carry applies | `src/platformer/riding-tracker.ts` |

#### `src/platformer/kernel.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `PlatformerController` | type | Stateless step function bound to a pipeline + config: `step(state, input, solids, dt) → {state}` | `src/platformer/kernel.ts` |
| `PlatformerControllerOptions` | type | `{getSolidDisplacement?}` — optional moving-platform carry provider | `src/platformer/kernel.ts` |
| `createPlatformerState(x, y, config?, width?, height?)` | function | Factory: airborne at-rest `PlatformerState` with all ability initial states. Pure, never throws | `src/platformer/kernel.ts` |
| `createPlatformerController(pipeline, config, options?)` | function | Stateless controller bound to a fixed ability pipeline + config. Multiple characters can share one controller | `src/platformer/kernel.ts` |
| `stepPlatformer(state, input, solids, dt, config?, getSolidDisplacement?)` | function | Convenience: builds a default-precision controller and steps once. For hot loops, prefer `createPlatformerController` (avoids per-tick closure allocation) | `src/platformer/kernel.ts` |
| `CompileLevelOptions` | type | Player overrides plus optional `tileTypeMap(value)`, captured once per in-bounds cell | `src/platformer/level-runtime.ts` |
| `CompiledLevel` | type | Complete `staticSolids` (entity first, then tile), moving platforms, initial state, and captured `tileQuery` | `src/platformer/level-runtime.ts` |
| `compileLevel(level, options?)` | function | Unified entity/tile runtime compiler. Without `tileTypeMap`, preserves entity-only collision behavior | `src/platformer/level-runtime.ts` |
| `CompiledMovingPlatform` | type | Consumer-owned moving-platform runtime descriptor with stable ID, path, speed, target, and direction | `src/platformer/level-runtime.ts` |
| `advanceMovingPlatform(platform, dt)` | function | Pure seconds-based moving-platform progression | `src/platformer/level-runtime.ts` |
| `movingPlatformToSolid(platform)` | function | Convert the current moving-platform descriptor to a kernel `Solid` | `src/platformer/level-runtime.ts` |
| `createMovingPlatformDisplacementProvider(current, previous)` | function | Build the per-tick carry displacement lookup used by the kernel | `src/platformer/level-runtime.ts` |

#### `src/platformer/renderer.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `EntityPalette` | type | Semantic colors for actors, platforms, enemies, traps, and collectibles | `src/platformer/renderer.ts` |
| `DEFAULT_ENTITY_PALETTE` | const | Default semantic renderer palette | `src/platformer/renderer.ts` |
| `DrawLevelEntityOverrideMap` | type | Per-entity-kind renderer override callbacks | `src/platformer/renderer.ts` |
| `DrawLevelEntityOptions` | type | Palette and override options for `drawLevelEntity` | `src/platformer/renderer.ts` |
| `drawLevelEntity(ctx, entity, options?)` | function | Draw one level entity using semantic defaults or an override | `src/platformer/renderer.ts` |
| `drawActor(ctx, core, options?)` | function | Draw a platformer actor from `ActorCore` | `src/platformer/renderer.ts` |
| `drawTileGrid(ctx, grid, drawTile)` | function | Traverse nonzero tiles and invoke the consumer appearance callback | `src/platformer/renderer.ts` |

#### `src/platformer/presets.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `PRECISION_PLATFORMER` | const | Precision-platformer tuning preset | `src/platformer/presets.ts` |
| `CLASSIC_PLATFORMER` | const | Classic jump-focused preset with double-jump disabled | `src/platformer/presets.ts` |
| `EXPLORATION_PLATFORMER` | const | Exploration-oriented movement preset | `src/platformer/presets.ts` |
| `PUZZLE_PLATFORMER` | const | Puzzle movement preset with advanced abilities disabled | `src/platformer/presets.ts` |

#### `src/platformer/pipelines.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `defaultPrecisionPipeline()` | function | Returns `[jumpAbility, wallSlideAbility, dashAbility, doubleJumpAbility]` — fresh array each call, safe to extend via spread | `src/platformer/pipelines.ts` |

#### `src/platformer/abilities/jump-ability.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `jumpAbility` | const | Jump ability processor (`kind: 'jump'`). Wraps `advanceJump` from `src/animation/jump`; emits `justLaunched` on launch tick | `src/platformer/abilities/jump-ability.ts` |

#### `src/platformer/abilities/wall-slide-ability.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `wallSlideAbility` | const | Wall-slide + wall-jump processor (`kind: 'wallSlide'`). Clamps `vy` to `wallSlideSpeed`, launches on `jump.pressed`, emits `startedWallSlide` / `wallJumpLaunched` | `src/platformer/abilities/wall-slide-ability.ts` |

#### `src/platformer/abilities/dash-ability.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `dashAbility` | const | Directional dash processor (`kind: 'dash'`). Overrides velocity for `dashDuration`, cooldown-gated, budget refills on land. Emits `dashStarted` | `src/platformer/abilities/dash-ability.ts` |

#### `src/platformer/abilities/double-jump-ability.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `doubleJumpAbility` | const | Double-jump processor (`kind: 'doubleJump'`). Second airborne impulse using jump launch velocity; budget refills on land. Emits `doubleJumped` | `src/platformer/abilities/double-jump-ability.ts` |

- _decision: `docs/design/platformer-kernel-decision.md`_
- _proposal: `docs/design/platformer-kernel-proposal.md`_
- _research: `docs/research/platformer-kernel.md`_
- _composes with: `src/animation/jump.ts` (`advanceJump`), `src/collision/resolve.ts` (`resolveAxisX`/`resolveAxisY`), `src/input/edges.ts` (`pollEdge`)_

### `src/save/`

Defensive save-data storage backends and JSON load/write helpers. Follows the canonical defensive adapter pattern (`src/primitives/motion.ts`): lazy `window.localStorage` resolution, swallow all errors, never-throw public API. Zero cross-module imports.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `SaveStorage` | interface | Storage backend contract: `load()`, `save(json)`, `clear()` — all must never throw | `src/save/types.ts` |
| `DEFAULT_SAVE_KEY` | const | `'aicraft-save'` — default localStorage key | `src/save/constants.ts` |
| `createLocalStorageSaveStorage(key?)` | function | Defensive localStorage backend. Lazily resolves `window.localStorage` inside methods. Falls back to no-op in Node/SSR | `src/save/storage.ts` |
| `createMemorySaveStorage()` | function | In-memory closure backend for tests/SSR. No persistence across reloads | `src/save/storage.ts` |
| `loadSave<T>(storage, defaultValue)` | function | Parse JSON from storage; returns `defaultValue` on any error (missing, corrupt, unavailable). Never throws | `src/save/storage.ts` |
| `writeSave<T>(storage, value)` | function | Serialize and persist via `JSON.stringify`; silently fails on quota/stringify errors. Never throws | `src/save/storage.ts` |

### `src/audio/`

WebAudio synthesized SFX defensive adapter. Zero audio assets — every sound is generated on the fly from oscillators + a reused white-noise buffer. Follows the canonical defensive adapter pattern: lazy `AudioContext` resolution on first `unlock()` (never at module load), swallow all errors, never-throw public API, no-op fallback in Node/SSR. Per-instance factory pattern (each `createAudioAdapter` call creates an independent adapter with its own closure state). The library ships generic primitives (`playTone` / `playNoise`); consumers compose game-specific sounds from these two building blocks.

> Note: `Math.random()` is used to fill the noise buffer. This is explicitly allowed — decorative audio side-effect, NOT deterministic simulation logic. Audio output never leaks back into game state.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `AudioAdapter` | interface | `{unlock(), isUnlocked(), playTone(...), playNoise(...), setMuted(...), isMuted(), setVolume(...), getVolume(), dispose()}` — WebAudio SFX adapter contract. All playback methods are no-op when muted, pre-unlock, or without WebAudio | `src/audio/types.ts` |
| `DEFAULT_AUDIO_VOLUME` | const | `0.7` — default SFX volume | `src/audio/constants.ts` |
| `createAudioAdapter()` | function | Defensive factory: independent adapter with private `AudioContext`, master gain, and noise buffer. Lazily resolves `AudioContext`/`webkitAudioContext` on first `unlock()`. Never throws | `src/audio/factory.ts` |

### `src/music/` (shipped)

> Decision: `docs/design/music-sequencer-decision.md`.
> Proposal: `docs/design/music-sequencer-proposal.md`.
> Research: `docs/research/music-sequencer.md`.

Procedural music: pure music-theory primitives, seeded pattern generator, and a two-clock lookahead sequencer that reuses the existing `AudioAdapter`.

**Four-layer architecture:**

| Layer | Module | What it provides | Determinism |
|---|---|---|---|
| 1. Pure theory | `theory.ts` | note↔freq, scales, BPM, swing math | No host, no state, no `Math.random` |
| 2. Seeded generator | `pattern.ts` | `generatePattern` using `mulberry32` + theory | Same `(seed, config)` → same `Pattern` forever |
| 3. Advance (determinism seam) | `advance.ts` | `advanceSequencer` walks the pattern | No host, no `audio.currentTime`, no `Math.random`, no `setTimeout` |
| 4. Host adapter | `sequencer.ts` | `createSequencer` — two-clock lookahead scheduler | Uses `audio.currentTime` + `setTimeout` (determinism carve-out for decorative audio) |

Layers 1–3 are fully deterministic and Node-testable. Layer 4 reuses the consumer's `AudioAdapter` — does NOT create a second `AudioContext`.

**`generatePattern` contract:** `generatePattern(seed)` produces a complete usable minor-pentatonic bass + melody loop with no config. Uses `scaleDegree` (not `pick`) for note selection — safe for any seed and any config, including empty arrays.

**Determinism:** same seed → identical pattern; same `(state, dt, pattern)` → byte-identical `advanceSequencer` output.

#### `src/music/theory.ts` — Pure music-theory primitives

| Export | Kind | Summary | Source |
|---|---|---|---|
| `A4_MIDI` | const | `69` — MIDI note number for A4 | `src/music/theory.ts` |
| `A4_FREQ` | const | `440` — reference frequency in Hz | `src/music/theory.ts` |
| `SCALES` | const | Named interval arrays (semitones from root): `major [0,2,4,5,7,9,11]`, `minor [0,2,3,5,7,8,10]`, `majorPentatonic [0,2,4,7,9]`, `minorPentatonic [0,3,5,7,10]`, `blues [0,3,5,6,7,10]`, `dorian [0,2,3,5,7,9,10]`. Pass these into `buildScale` — e.g. `buildScale(60, SCALES.majorPentatonic)` | `src/music/theory.ts` |
| `noteToFrequency(midi, tuning?)` | function | MIDI note → frequency in Hz. Equal temperament. `tuning` defaults to `A4_FREQ` (440) | `src/music/theory.ts` |
| `frequencyToNote(freq)` | function | Frequency in Hz → MIDI note number (float, full precision — consumers round if needed) | `src/music/theory.ts` |
| `buildScale(rootMidi, intervals, octaves?)` | function | Build a scale as MIDI note numbers across `octaves` octaves (default 2). `intervals` is a readonly number array (one of `SCALES.*` or hand-authored). Returns `intervals.length × octaves` notes | `src/music/theory.ts` |
| `scaleDegree(scale, degree)` | function | Pick a MIDI note from a scale by 0-based degree. Wraps gracefully across octaves via modular arithmetic. Negative degrees wrap to lower octaves. Never throws | `src/music/theory.ts` |
| `secondsPerBeat(bpm)` | function | BPM → seconds per quarter-note beat | `src/music/theory.ts` |
| `secondsPerStep(bpm, stepsPerBeat)` | function | BPM + subdivision → seconds per step | `src/music/theory.ts` |
| `swingLongDuration(pairDuration, swingRatio)` | function | Duration of the LONG half of a swing pair. `swingRatio` clamped to `[0.5, 0.75]` — out-of-range values are clamped, never thrown. `0.5` = straight, `0.66` ≈ triplet, `0.75` = hard swing | `src/music/theory.ts` |

#### `src/music/pattern.ts` — Seeded pattern generator

| Export | Kind | Summary | Source |
|---|---|---|---|
| `NoteEvent` | type | `{ midi, durationSteps?, peak?, waveform? }` — single note event (pure data, serializable). `midi: null` = rest. `durationSteps` is gate time in steps (BPM-independent); adapter converts to ms via `durationSteps × secondsPerStep(bpm, stepsPerBeat) × 1000`. `peak` defaults to track volume. `waveform` defaults to track waveform | `src/music/types.ts` |
| `Track` | type | `{ name, waveform, volume, sequence, patterns }` — one voice in a pattern | `src/music/types.ts` |
| `Pattern` | type | `{ bpm, stepsPerBeat, stepsPerPattern, scale?, tracks }` — complete song (JSON-serializable) | `src/music/types.ts` |
| `PatternGenConfig` | type | Seeded generator config: `rootMidi?`, `scale?`, `bpm?`, `stepsPerBeat?`, `stepsPerPattern?`, `tracks?`. All fields optional with musical defaults | `src/music/types.ts` |
| `TrackGenConfig` | type | Per-track generation config: `name`, `waveform`, `volume`, `rhythm` (hit/miss per step), `degreeMin`, `degreeMax`, `noteDurationSteps?` | `src/music/types.ts` |
| `generatePattern(seed, config?)` | function | Deterministically generate a `Pattern` from a 32-bit seed. Uses `mulberry32`. Same `(seed, config)` → same `Pattern` forever. With no config, ships a complete usable minor-pentatonic bass + melody loop. **Constraint:** MUST NOT call `pick` on potentially-empty arrays — uses `scaleDegree` (wraps gracefully, never throws) for note selection | `src/music/pattern.ts` |

#### `src/music/advance.ts` — Pure sequencer state + step walker

The determinism seam. Pure sequencer advance — walks the pattern deterministically, advances elapsed time, fires notes whose step boundary is crossed. Applies swing to odd-indexed off-beat steps. No host access, no `Math.random`, no `Date.now()`, no `setTimeout`. Mirrors `advanceEmission` (`src/particles/emitter.ts`) and `advanceTween` (`src/easing/tween.ts`). Fully unit-testable in Node.

**`AdvanceOptions` note:** The `AdvanceOptions` type is intentionally NOT re-exported from the `src/music/index.ts` barrel (name collision with `src/particles/advance.ts`'s `AdvanceOptions`). Consumers reach it via `import type { AdvanceOptions } from 'aicraft-engine/src/music/types'`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `SequencerState` | type | `{ elapsedS, stepIndex, loopCount }` — pure playback state (all readonly). Consumer-owned; `advanceSequencer` returns a new state | `src/music/types.ts` |
| `NoteFire` | type | `{ midi, waveform, peak, gateS, whenOffset }` — fired note event (pure data). `gateS` = `durationSteps × secondsPerStep(bpm, stepsPerBeat)` in seconds; host adapter passes `gateS × 1000` as `durMs` to `playTone`. `whenOffset` is seconds from window start | `src/music/types.ts` |
| `AdvanceOptions` | type | `{ swing?: number }` — optional advance-time config. `swing` ratio `[0.5, 0.75]`. **Not re-exported from barrel** (name collision with particles); import from `src/music/types` directly | `src/music/types.ts` |
| `advanceSequencer(state, dt, pattern, opts?)` | function | Pure: advance sequencer by `dt` seconds. Returns `{ next, events }` where `next` is new `SequencerState` and `events` is readonly array of `NoteFire`. Empty `events` = no notes crossed a step boundary. `opts.swing` sets swing ratio (default `DEFAULT_SWING` = 0.5). No host access, fully Node-testable | `src/music/advance.ts` |
| `NoteFirePlayer` | type | Defensive stateless host renderer for externally advanced `NoteFire[]` | `src/music/types.ts` |
| `createNoteFirePlayer(audio)` | function | Maps exact external note events to an existing `AudioAdapter`; owns no pattern, clock, or simulation state | `src/music/note-fire-player.ts` |

#### `src/music/sequencer.ts` — Two-clock lookahead sequencer

Host-touching adapter. Implements Chris Wilson's "A Tale of Two Clocks" lookahead scheduler: `setTimeout` chain polls every `LOOKAHEAD_MS` (25 ms), pre-queues notes whose `nextNoteTime` falls within `SCHEDULE_AHEAD_S` (0.1 s) of `audio.currentTime`. Reuses the consumer's `AudioAdapter` — no second `AudioContext`. Defensive: every method is a no-op when audio is locked, disposed, or unavailable; every error swallowed; `stop()` and `dispose()` are idempotent.

`setVolume(v)` scales the `peak` argument of every subsequent `playTone` call by the music-volume factor — pure multiplication, independent of the `AudioAdapter`'s own SFX volume. No extra gain nodes, no second context.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Sequencer` | interface | `{ play(), stop(), isPlaying(), setVolume(v), getVolume(), dispose() }` — playback controls (defensive, never-throw). `play()` resets to step 0 and starts the scheduler. `stop()` halts playback (idempotent). `isPlaying()` returns `playing && !disposed`. `setVolume(v)` clamps `[0, 1]` and scales `peak` on each `playTone` call. `dispose()` stops + clears the timer (idempotent). **`setBpm()` is NOT in v1** | `src/music/types.ts` |
| `SequencerConfig` | type | `{ lookaheadMs?, scheduleAheadS?, swing? }` — scheduler tuning (all optional with defaults from Chris Wilson's canonical values) | `src/music/types.ts` |
| `createSequencer(audio, pattern, config?)` | function | Factory: create a sequencer that plays `pattern` via the existing `AudioAdapter`. Uses Chris Wilson's two-clock lookahead scheduler. Reuses `AudioAdapter` — no second `AudioContext`. Returns a `Sequencer` | `src/music/sequencer.ts` |

#### `src/music/constants.ts` — Named tunables

| Export | Kind | Summary | Source |
|---|---|---|---|
| `DEFAULT_SWING` | const | `0.5` — straight (no swing) | `src/music/constants.ts` |
| `DEFAULT_BPM` | const | `110` — default tempo (chill ambient baseline) | `src/music/constants.ts` |
| `DEFAULT_STEPS_PER_BEAT` | const | `4` — 16th notes | `src/music/constants.ts` |
| `DEFAULT_STEPS_PER_PATTERN` | const | `16` — one bar of 16th notes in 4/4 | `src/music/constants.ts` |
| `DEFAULT_MUSIC_VOLUME` | const | `1` — unity gain (independent of AudioAdapter SFX volume) | `src/music/constants.ts` |
| `DEFAULT_ROOT_MIDI` | const | `48` — C3 (bass range) | `src/music/constants.ts` |
| `DEFAULT_SCALE_OCTAVES` | const | `2` — number of octaves `buildScale` spans by default | `src/music/constants.ts` |
| `LOOKAHEAD_MS` | const | `25` — JS scheduler poll interval (ms). Chris Wilson's canonical 25 ms | `src/music/constants.ts` |
| `SCHEDULE_AHEAD_S` | const | `0.1` — pre-queue window (seconds). Chris Wilson's canonical 100 ms | `src/music/constants.ts` |

### `src/blend/`

General pose-blend primitives. Standalone pure-arithmetic module for interpolating between two TRS poses by a weight. Independent of the animation pillar — `Pose2D` is structurally compatible with `BonePose` from `src/animation/types.ts` (duck typing) but defined separately to keep this module dependency-free.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Pose2D` | interface | Blendable 2D bone pose: optional `translation` (`{x,y}`), `rotation` (radians), `scale` (uniform scalar). Undefined fields resolve to identity | `src/blend/types.ts` |
| `blendPose(a, b, weight)` | function | Interpolate two single-bone TRS poses; `weight` clamped to `[0,1]`. Returns fully-specified `Pose2D` (no undefined fields). Pure, never throws | `src/blend/lerp.ts` |
| `blendPoses(posesA, posesB, weight)` | function | Element-wise blend of pose arrays; pads shorter array with identity. Returns new array of new objects. Pure, never throws | `src/blend/lerp.ts` |

---

## Pillar 2: Cosmetics (shipped, Phase 2)

### `src/palette/`

Per-skin OKLCH palette substitution, deterministic harmonic generation, and WCAG AA contrast repair. 330+ tests, build clean.

> Decision: `docs/design/algorithmic-palette-decision.md`.

#### `src/palette/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Palette` | type | Canonical 5-slot interface: `outline`, `base`, `accent`, `feature`, `background` (all `#rrggbb` hex) | `src/palette/types.ts` |
| `PaletteOverrides` | type | `Partial<Palette>` — partial overrides for skin variation | `src/palette/types.ts` |
| `Oklch` | type | `{l, c, h}` — OKLCH color record (lightness [0,1], chroma [0,~0.4], hue [0,360)) | `src/palette/types.ts` |
| `ContrastPair` | type | `{fg, bg}` — checked slot pair for contrast repair | `src/palette/types.ts` |
| `GenerationStrategy` | type | `'complementary' \| 'analogous' \| 'triadic'` — seed-driven palette generation strategy (default `'triadic'`) | `src/palette/types.ts` |
| `GenerationConfig` | type | Tunable generation params: strategy, baseLightness, baseChroma, lightnessJitter, chromaJitter | `src/palette/types.ts` |
| `ContrastRepairOptions` | type | Options for `repairContrast` (`targetRatio?`) | `src/palette/types.ts` |

#### `src/palette/oklch.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `rgbToOklch(rgb)` | function | sRGB (0-255) → OKLCH. Pure, ~54 lines matrix math, zero deps | `src/palette/oklch.ts` |
| `oklchToRgb(oklch)` | function | OKLCH → sRGB. Out-of-gamut channels clamped; may hue-shift near-gamut-boundary colors. Pure | `src/palette/oklch.ts` |
| `hexToOklch(hex)` | function | `#rrggbb` → OKLCH. Composes `parseHex` + `rgbToOklch` | `src/palette/oklch.ts` |
| `oklchToHex(oklch)` | function | OKLCH → `#rrggbb`. Composes `oklchToRgb` + `toHex` (8-bit rounding at boundary) | `src/palette/oklch.ts` |

#### `src/palette/resolve.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `resolvePalette(base, overrides?)` | function | Merge base palette with optional overrides; missing slots fall back silently to base. Pure, never throws | `src/palette/resolve.ts` |

#### `src/palette/generate.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `generatePalette(seed, config?)` | function | Deterministic palette from 32-bit seed + optional config. Uses `mulberry32`, always contrast-repaired. Same seed → same palette forever | `src/palette/generate.ts` |

#### `src/palette/contrast-repair.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `repairContrast(palette, opts?)` | function | Fixed 8-iter binary search on OKLCH lightness to enforce WCAG AA (4.5:1) on 3 slot pairs. Pre-computed at load time, NOT per-frame. Pure, never throws (throws on malformed hex — programmer error inheriting `parseHex`) | `src/palette/contrast-repair.ts` |

#### `src/palette/constants.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `WCAG_AA_TARGET_RATIO` | const | `4.5` — WCAG AA minimum contrast ratio (GDD §11.3) | `src/palette/constants.ts` |
| `CONTRAST_REPAIR_ITERATIONS` | const | `8` — fixed binary-search iterations (1/256 lightness precision) | `src/palette/constants.ts` |
| `MAX_CHROMA` | const | `0.35` — maximum OKLCH chroma for generation (avoids sRGB gamut violations) | `src/palette/constants.ts` |
| `MIN_LIGHTNESS` | const | `0.05` — minimum lightness for dark slots (outline) | `src/palette/constants.ts` |
| `MAX_LIGHTNESS` | const | `0.97` — maximum lightness for light slots (background) | `src/palette/constants.ts` |
| `CONTRAST_PAIRS` | const | `[{fg:'outline',bg:'base'}, {fg:'feature',bg:'base'}, {fg:'outline',bg:'background'}]` — slot pairs checked for contrast (accent vs base intentionally NOT checked) | `src/palette/constants.ts` |
| `DEFAULT_STRATEGY` | const | `'triadic'` — default generation strategy | `src/palette/constants.ts` |
| `DEFAULT_BASE_LIGHTNESS` | const | `0.70` — default base lightness for the `base` slot | `src/palette/constants.ts` |
| `DEFAULT_BASE_CHROMA` | const | `0.15` — default base chroma for colored slots | `src/palette/constants.ts` |
| `DEFAULT_LIGHTNESS_JITTER` | const | `0.05` — default per-slot lightness jitter amplitude | `src/palette/constants.ts` |
| `DEFAULT_CHROMA_JITTER` | const | `0.04` — default per-slot chroma jitter amplitude | `src/palette/constants.ts` |
| `STRATEGY_HUE_OFFSETS` | const | Per-strategy hue offsets (degrees) for accent and feature slots: `complementary` → {180°, 150°}, `analogous` → {30°, −30°}, `triadic` → {120°, 240°} | `src/palette/constants.ts` |
| `ACCENT_LIGHTNESS_FACTOR` | const | `0.9` — lightness multiplier shaping accent from base lightness | `src/palette/constants.ts` |
| `ACCENT_CHROMA_FACTOR` | const | `0.8` — chroma multiplier shaping accent from base chroma | `src/palette/constants.ts` |
| `FEATURE_LIGHTNESS_FACTOR` | const | `1.15` — lightness multiplier shaping feature from base lightness (clamped to MAX_LIGHTNESS) | `src/palette/constants.ts` |
| `FEATURE_CHROMA` | const | `0.15` — chroma cap for the feature slot (the highlight/accent color). Bounded so contrast repair can always push feature to extreme WCAG luminances for lightness-only repair to reach WCAG AA | `src/palette/constants.ts` |
| `OUTLINE_CHROMA` | const | `0.02` — near-achromatic chroma for the outline slot | `src/palette/constants.ts` |
| `BACKGROUND_CHROMA` | const | `0.01` — near-achromatic chroma for the background slot | `src/palette/constants.ts` |

**Note on the `feature` slot:** The `feature` slot is the highest-saturation color, but its chroma is capped at `FEATURE_CHROMA` (0.15). This bound is mathematically necessary: higher chroma traps the feature in a mid-luminance band, making `feature`/`base` unrepairable for some seeds. The 0.15 cap was ratified by the benchmark sample sheet (visually confirmed the feature still pops vividly; see decision doc).

- _research note: See `docs/research/algorithmic-palette-substitution.md`_
- _research note: See `docs/research/algorithmic-skin-variation.md`_
- _decision: `docs/design/algorithmic-palette-decision.md`_

### `src/cosmetics/`

Skin presets, versioned manifests, defensive migration, deterministic seeded generation, and pure ownership operations. Builds on the settled palette module (`src/palette/`).

> Decision: `docs/design/algorithmic-skin-variation-decision.md`.

#### `src/cosmetics/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Rarity` | type | `'common' \| 'rare' \| 'epic' \| 'legendary'` — typed rarity union (not free string). Adding a tier later is a non-breaking union expansion | `src/cosmetics/types.ts` |
| `EquipSlot` | type | `'body' \| 'head' \| 'trail'` — cosmetic equipment regions. **Separate namespace from `SkeletonTemplate.slotMap`:** rig `slotMap` keys are consumer-defined *attachment* slots for IK/locomotion targeting; `EquipSlot` values are *cosmetic regions* the consumer maps to draw callbacks | `src/cosmetics/types.ts` |
| `SkinPreset` | type | `{ id, name, rarity, palette, scale }` — serializable parameter preset. `palette` is the settled `Palette` from `src/palette/types.ts`; `scale` is a single `number` (uniform render-scale multiplier) | `src/cosmetics/types.ts` |
| `CosmeticManifest` | type | `{ version: number, skins: readonly SkinPreset[] }` — versioned, JSON-serializable manifest. `skins` is `readonly` (manifests are load-once, read-many content — never mutated after parse) | `src/cosmetics/types.ts` |
| `CosmeticSave` | type | `{ owned: string[], equipped: Partial<Record<EquipSlot, string>> }` — player ownership + equipment state. Fields intentionally **NOT `readonly`** (ownership ops clone-then-mutate the clone; `readonly` + `as`-cast would be misleading ceremony). `owned` is a plain sorted `string[]`, never Set/Map | `src/cosmetics/types.ts` |

#### `src/cosmetics/constants.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `MANIFEST_VERSION` | const | `1` — current manifest schema version | `src/cosmetics/constants.ts` |
| `DEFAULT_RARITY` | const | `'common'` — fallback rarity for invalid or missing rarity fields | `src/cosmetics/constants.ts` |
| `SCALE_MIN` | const | `0.1` — minimum bone scale multiplier | `src/cosmetics/constants.ts` |
| `SCALE_MAX` | const | `5.0` — maximum bone scale multiplier | `src/cosmetics/constants.ts` |
| `JITTER_SCALE_MIN` | const | `0.8` — lower bound (inclusive) of generated scale jitter | `src/cosmetics/constants.ts` |
| `JITTER_SCALE_MAX` | const | `1.2` — upper bound (exclusive) of generated scale jitter | `src/cosmetics/constants.ts` |
| `MAX_SIGNATURE_RETRIES` | const | `100` — cap on signature-collision retries per variant before giving up that slot | `src/cosmetics/constants.ts` |
| `EQUIP_SLOTS` | const | `['body', 'head', 'trail']` — all valid equipment slots | `src/cosmetics/constants.ts` |
| `RARITY_TIERS` | const | `['common', 'rare', 'epic', 'legendary']` — all valid rarity tiers (used by defensive parsing and UI consumers) | `src/cosmetics/constants.ts` |
| `DEFAULT_SCALE` | const | `1.0` — neutral render scale (no change) | `src/cosmetics/constants.ts` |
| `DEFAULT_PALETTE` | const | Default 5-slot palette used as per-field fallback in defensive parsing. Valid `#rrggbb` hex per `Palette` contract | `src/cosmetics/constants.ts` |
| `DEFAULT_SKIN_PRESET` | const | Fallback preset: id `'default'`, common rarity, scale `1.0`, default palette | `src/cosmetics/constants.ts` |
| `DEFAULT_COSMETIC_SAVE` | const | Empty save: no owned skins, nothing equipped | `src/cosmetics/constants.ts` |
| `DEFAULT_MANIFEST` | const | Fallback manifest: version 1, single default skin | `src/cosmetics/constants.ts` |

#### `src/cosmetics/migrate.ts`

Defensive manifest parser. Mirrors Spitekeep's `platform/save.ts` `migrateSave` pattern: never throws, rebuilds a fresh default, overlays validated fields.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `migrateManifest(raw)` | function | Defensively parse a versioned manifest. Gates on `version === MANIFEST_VERSION`, parses/dedupes skins by id (last entry wins), falls back to `DEFAULT_MANIFEST` if empty. Never throws | `src/cosmetics/migrate.ts` |

**Internal (not public):** `migrateSkinPreset` is an internal helper within `migrate.ts` — not part of the public surface.

#### `src/cosmetics/generate.ts`

Deterministic seeded generation. Delegates palette entirely to `src/palette/generatePalette` (which repairs contrast internally).

| Export | Kind | Summary | Source |
|---|---|---|---|
| `generateSkinVariants(seed, baseSkin, count)` | function | Deterministic batch: same `(seed, baseSkin, count)` → same variants forever. Uses `mulberry32`, generates palette via `generatePalette`, jitters scale within `[JITTER_SCALE_MIN, JITTER_SCALE_MAX]`, guarantees batch uniqueness via signature hashing. Variant ID format: `${baseSkin.id}-var-${i}-${seed}-${hash}` where `hash` is FNV-1a base36 of the base skin's palette+scale content (ensures cross-base-skin collision avoidance) | `src/cosmetics/generate.ts` |

#### `src/cosmetics/ownership.ts`

Pure progression ops. Mirrors Spitekeep's `platform/progress.ts`: immutable in → JSON-clone out → never mutate → never throw. Call only on user actions (equip/purchase), never per-frame.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `grantSkin(save, skinId)` | function | Pure op: add skin to `owned` (sorted alphabetically, deduped). Invalid skinId = silent no-op (returned save value-equal to input) | `src/cosmetics/ownership.ts` |
| `equipSkin(save, slot, skinId)` | function | Pure op: equip owned skin into slot. Verifies **ownership** (skin in `owned`), NOT manifest existence. Invalid slot/skinId/unowned = silent no-op | `src/cosmetics/ownership.ts` |
| `unequipSkin(save, slot)` | function | Pure op: clear a slot. Invalid slot or empty slot = silent no-op | `src/cosmetics/ownership.ts` |

- _research note: `docs/research/algorithmic-skin-variation.md`_
- _decision: `docs/design/algorithmic-skin-variation-decision.md`_

---

## Pillar 2: Level Generation (PROPOSED)

> Proposal: `docs/design/procedural-level-generation-proposal.md` (Approach C: Physics-Constrained Editor-Ops Generator recommended; Approach A and B also proposed).
> Research: `docs/research/procedural-level-generation.md`.
> Canonical plan: `docs/design/level-generation-quality-implementation-plan.md`.
> Status: **APPROVED DIRECTION; API UNDER REVISION; NOT SHIPPED**.
>
> **Authority note:** the detailed proposal inventory below predates the canonical
> plan and is retained for design history. Its exact signatures are non-canonical
> where they conflict with the plan, especially tile semantics, editor replacement,
> scaffold validity, verification, and quality reporting.

### `src/levelgen/` (PROPOSED)

The historical proposal describes deterministic seeded generation and analytic placement constraints. The canonical plan evolves this into path-first layout, rhythm/pacing, physics-aware realization, explicit tile semantics, replay verification, quality scoring, repair, and deterministic candidate selection. Construction constraints reduce invalid output but do not independently prove beatability.

**Determinism & purity contract (non-negotiable):** every export is never-throw, no-mutate, and pure. Non-finite inputs degrade to defaults (never `NaN`, never `Infinity`); out-of-range inputs clamp; missing fields fall back to `DEFAULT_GEN_CONFIG` or `src/level/constants.ts` defaults. See `docs/design/procedural-level-generation-proposal.md` §Determinism & Purity Contract for the full contract.

**Three proposed approaches (choose one to prototype):**

- **Approach A: Path-First Chunk Assembler** (Spelunky pattern) — `generateLevel(seed, config) → LevelData`. Simplest surface. One call, one return.
- **Approach B: Composable Rhythm-Group Pipeline** (Launchpad pattern) — `pickRhythm(rng, ...) → realizeRhythm(rng, ...) → assembleLevel(...)`. Most customizable. Each stage independently replaceable. Both rhythm stages take an `rng: () => number` (NOT a `seed`) — the consumer creates the RNG once with `mulberry32(seed)` and threads it through both stages.
- **Approach C: Physics-Constrained Editor-Ops Generator** (recommended) — `generateLevel(seed, config) → { level, ops }` where `ops` is a single `batch` op wrapping the full op sequence. Best editor integration + physics guarantees. Dual output.

#### `src/levelgen/index.ts`

Barrel re-export of every public export from the module sub-files. Consumers import from `aicraft-engine/src/levelgen` for the full surface, or from individual sub-files (`aicraft-engine/src/levelgen/physics`) for tree-shaken bundles. Tree-shaking is preserved because each sub-file has its own barrel.

#### `src/levelgen/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `LevelGenConfig` | type | Generation parameters: `cols`, `rows`, `tileSize`, `difficulty` (0..1), `solidTile`, optional `platformerConfig` override, optional `entityIdStart` (defaults to `DEFAULT_ENTITY_ID_START` = 1) | `src/levelgen/types.ts` |
| `GeneratedLevel` | type | `{ level: LevelData, ops: readonly EditorOperation[] }` — dual output: direct level + editor operations. `ops` is a single-element array containing one `{ type: 'batch', ops: [...], label: 'Generate level (seed N)' }` op | `src/levelgen/types.ts` |
| `PhysicsConstraints` | type | Derived physics bounds from `PlatformerConfig`: `maxJumpDistance` (px), `maxStepUp` (px), `maxGapWidth` (tiles), `maxStepUpTiles` (tiles) | `src/levelgen/types.ts` |
| `Beat` | type | `{ type: 'move' \| 'jump' \| 'wait' }` — single rhythm beat (Approach B) | `src/levelgen/types.ts` |
| `Rhythm` | type | `{ beats: readonly Beat[], density: number }` — generated rhythm sequence (Approach B) | `src/levelgen/types.ts` |
| `RhythmConfig` | type | Rhythm generation params: `length`, `jumpFrequency`, `waitFrequency` (Approach B) | `src/levelgen/types.ts` |
| `RealizedSegment` | type | Geometry output from rhythm interpretation: `platforms`, `hazards`, `advanceTiles`, `heightOffset` (Approach B) | `src/levelgen/types.ts` |
| `EmptyLevelOptions` | type | Optional overrides for `emptyLevel`: `id?`, `name?`, `width?`, `height?`, `tileSize?` (all default to `src/level/constants.ts` defaults) | `src/levelgen/types.ts` |

#### `src/levelgen/constants.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `DEFAULT_GEN_CONFIG` | const | Default generation config: 60×15 tiles, tileSize 16, difficulty 0.3, solidTile 1 | `src/levelgen/constants.ts` |
| `DEFAULT_RHYTHM_CONFIG` | const | Default rhythm config: 12 beats, 40% jump, 20% wait | `src/levelgen/constants.ts` |
| `MIN_DIFFICULTY` | const | `0` — minimum difficulty value | `src/levelgen/constants.ts` |
| `MAX_DIFFICULTY` | const | `1` — maximum difficulty value | `src/levelgen/constants.ts` |
| `DEFAULT_SOLID_TILE` | const | `1` — tile value for solid ground | `src/levelgen/constants.ts` |

#### `src/levelgen/generate.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `generateLevel(seed, config?)` | function | Deterministic level generation. Returns `GeneratedLevel` with both `level` (complete `LevelData`) and `ops` (single-element array containing one `batch` op). Same `(seed, config)` → same output forever. Uses `mulberry32` internally. Never throws, no-mutate, pure | `src/levelgen/generate.ts` |

#### `src/levelgen/physics.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `derivePhysicsConstraints(config)` | function | Analytic derivation of placement bounds from `PlatformerConfig`. Returns `PhysicsConstraints` (`{ maxJumpDistance, maxStepUp, maxGapWidth, maxStepUpTiles }`). O(1). Pure, never throws, no-mutate | `src/levelgen/physics.ts` |
| `deriveMaxJumpDistance(config)` | function | Maximum traversable horizontal distance in **pixels** for a single flat-ground jump. Closed-form: `2 × moveSpeed × timeToApex`. Returns `number` (finite, non-negative; non-finite inputs degrade to `0`). Pure, never throws, no-mutate | `src/levelgen/physics.ts` |
| `deriveMaxStepUp(config)` | function | Maximum reachable step-up height in **pixels** (= `config.jump.apexHeight`). Returns `number` (finite, non-negative; non-finite `apexHeight` degrades to `0`). Pure, never throws, no-mutate | `src/levelgen/physics.ts` |

#### `src/levelgen/empty-level.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `emptyLevel(opts?)` | function | Pure factory: returns a minimal valid `LevelData` with empty tile grid, no entities, `nextEntityId: DEFAULT_ENTITY_ID_START`. Used as the starting point for `createEditorState` when loading a freshly generated level into the editor. Never throws, no-mutate, pure. Non-finite numeric opts degrade to defaults | `src/levelgen/empty-level.ts` |

#### `src/levelgen/rhythm.ts` (Approach B only)

| Export | Kind | Summary | Source |
|---|---|---|---|
| `pickRhythm(rng, config)` | function | Deterministic rhythm generation. Returns `Rhythm`. Receives consumer's `rng: () => number` (NOT a seed) — the consumer creates the RNG once with `mulberry32(seed)` and threads it through both `pickRhythm` and `realizeRhythm`. Pure, never throws | `src/levelgen/rhythm.ts` |
| `realizeRhythm(rng, rhythm, config)` | function | Interpret rhythm as geometry segments. Receives the same `rng` instance as `pickRhythm`. Returns `readonly RealizedSegment[]`. Pure, never throws | `src/levelgen/rhythm.ts` |
| `assembleLevel(segments, config)` | function | Assemble `RealizedSegment[]` into a complete `LevelData`. Pure, never throws | `src/levelgen/rhythm.ts` |

- _proposal: `docs/design/procedural-level-generation-proposal.md`_
- _research: `docs/research/procedural-level-generation.md`_
- _test plan: §Test Plan in the proposal (determinism, solvability, difficulty, edge cases, editor integration, cross-pillar composition, snapshot tests)_
- _benchmarks: `benchmarks/levelgen/` (runtime, diversity, solvability, ops count)_
- _composes with: `src/rng/mulberry32.ts` (seeded PRNG), `src/level/types.ts` (`LevelData`, `LevelEntity`, `TileGrid`, `LevelRect`), `src/level/constants.ts` (`LEVEL_VERSION`, `DEFAULT_TILE_SIZE`, `DEFAULT_LEVEL_WIDTH`, `DEFAULT_LEVEL_HEIGHT`, `DEFAULT_ENTITY_ID_START`), `src/level/entity-id.ts` (`allocateEntityId`), `src/level/validate.ts` (`validateLevel`), `src/editor/types.ts` (`EditorOperation`), `src/editor/operations.ts` (`applyBatch`), `src/editor/factory.ts` (`createEditorState`), `src/platformer/types.ts` (`PlatformerConfig`), `src/platformer/constants.ts` (`DEFAULT_PLATFORMER_CONFIG`), `src/platformer/level-runtime.ts` (`compileLevel`)_
- _resolved open questions: `ops` wrapped in a single `batch` op (Q1); entity IDs start from `DEFAULT_ENTITY_ID_START` with `entityIdStart` override (Q2); `derivePhysicsConstraints` lives in `src/levelgen/` for v1 (Q3). Chunk template library (Q4) and vertical levels (Q5) deferred to v2._

---

## Pillar 3: IAP Bridge (shipped)

> Decision: `docs/design/iap-bridge-decision.md`.

### `src/iap/types.ts`

All IAP type definitions. Zero cross-pillar imports. `EntitlementSave` is a pure overlay containing NO cosmetic fields — the consumer composes it with `CosmeticSave` at the tick boundary via the `GrantDescriptor[]` returned from `flushIAPEvents`.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `ProductType` | type | `'non_consumable'` — v1 only; consumables/subscriptions deferred to v2 | `src/iap/types.ts` |
| `IAPPrice` | type | `{ formatted, micros, currency }` — localized display string + raw micro-units + ISO 4217 code | `src/iap/types.ts` |
| `IAPProduct` | type | `{ id, type, name, description, price }` — store catalog product record | `src/iap/types.ts` |
| `TransactionState` | type | `'pending' \| 'approved' \| 'finished' \| 'failed'` — platform transaction lifecycle | `src/iap/types.ts` |
| `IAPTransaction` | type | `{ id, sku, state, receipt?, error? }` — platform transaction record (adapter produces, consumer feeds to `pushTransaction`) | `src/iap/types.ts` |
| `IAPEvent` | type | `{ type, sku, txId }` — normalised event for the deterministic sim core (`'purchase' \| 'restore' \| 'revoke'`) | `src/iap/types.ts` |
| `EntitlementSave` | type | `{ entitlements: string[], receipts: Record<string, string> }` — pure IAP overlay. **No cosmetic fields.** Fields intentionally NOT `readonly` (clone-then-mutate discipline) | `src/iap/types.ts` |
| `GrantDescriptor` | type | `{ target: 'skin', targetId }` — consumer-side grant descriptor; open union for future `'bundle'`/`'currency'` | `src/iap/types.ts` |
| `SkuResolver` | type | `(sku: string) => readonly GrantDescriptor[]` — consumer-provided SKU→grant mapping; library never embeds SKU metadata | `src/iap/types.ts` |
| `IAPBridge` | interface | Host-touching adapter: `initialize()`, `isInitialized()`, `getCatalog()`, `getEntitlements()`, `purchase(sku)`, `restore()`, `onTransaction(cb)` | `src/iap/types.ts` |

### `src/iap/constants.ts`

Canonical defaults and tunables. No magic strings or numbers outside this file.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `DEFAULT_IAP_STORAGE_KEY` | const | `'aicraft-iap-entitlements'` — localStorage key for mock IAP store | `src/iap/constants.ts` |
| `PRODUCT_TYPE_NON_CONSUMABLE` | const | `'non_consumable'` — canonical product type constant | `src/iap/constants.ts` |
| `TX_STATE_APPROVED` | const | `'approved'` — purchase succeeded | `src/iap/constants.ts` |
| `TX_STATE_FAILED` | const | `'failed'` — purchase declined or errored | `src/iap/constants.ts` |
| `TX_STATE_PENDING` | const | `'pending'` — platform still resolving | `src/iap/constants.ts` |
| `TX_STATE_FINISHED` | const | `'finished'` — purchase fully consumed | `src/iap/constants.ts` |
| `DEFAULT_IAP_PRICE` | const | `{ formatted: '$0.99', micros: 990000, currency: 'USD' }` — fallback price record | `src/iap/constants.ts` |
| `DEFAULT_IAP_PRODUCT` | const | `{ id: 'com.aicraft.default', type: 'non_consumable', ... }` — default product for smoke tests | `src/iap/constants.ts` |
| `DEFAULT_IAP_CATALOG` | const | `[ DEFAULT_IAP_PRODUCT ]` — single-item default catalog | `src/iap/constants.ts` |
| `DEFAULT_ENTITLEMENT_SAVE` | const | `{ entitlements: [], receipts: {} }` — empty entitlement state | `src/iap/constants.ts` |

### `src/iap/entitlements.ts`

Pure progression ops + queue primitives. Mirrors `src/cosmetics/ownership.ts`: immutable in → JSON-clone out → never mutate → never throw. Call on purchase/restore/revoke events only (not per-frame). `flushIAPEvents` returns `GrantDescriptor[]` for the consumer to compose with `grantSkin` at their own boundary — no cross-pillar import.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `grantEntitlement(save, sku, receipt?)` | function | Pure op: add SKU to sorted deduped `entitlements`, store receipt. Invalid/empty SKU = silent no-op | `src/iap/entitlements.ts` |
| `revokeEntitlement(save, sku)` | function | Pure op: remove SKU from `entitlements` and drop receipt. Does NOT auto-unequip skins | `src/iap/entitlements.ts` |
| `flushIAPEvents(save, events, resolver)` | function | Pure op: batch-process events into save; returns `{ save, grants }`. Consumer iterates `grants` and calls `grantSkin` themselves | `src/iap/entitlements.ts` |
| `drainQueue(events)` | function | Pure op: shallow-copy + empty array; returns `{ drained, next }` | `src/iap/entitlements.ts` |
| `pushTransaction(events, tx)` | function | Pure op: append `'purchase'` event for `'approved'` tx; no-op for `'pending'`/`'finished'`/`'failed'` | `src/iap/entitlements.ts` |

### `src/iap/adapters/memory.ts`

In-memory IAP adapter. No host API access. Transaction ids are monotonic per-instance for deterministic tests (no `Math.random` / `Date.now()`).

| Export | Kind | Summary | Source |
|---|---|---|---|
| `MemoryIAPAdapterConfig` | type | `{ catalog? }` — optional catalog override | `src/iap/adapters/memory.ts` |
| `createMemoryIAPAdapter(config?)` | function | Factory: in-process mock store. `purchase()` resolves approved for known SKUs, failed for unknown; never rejects | `src/iap/adapters/memory.ts` |

### `src/iap/adapters/local-storage.ts`

localStorage-backed adapter for local dev. Lazily resolves `window.localStorage` inside methods (never at module load), falls back to in-memory in Node/SSR/test. Cached probe after first resolution. Never throws, never rejects.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `LocalStorageIAPAdapterConfig` | type | `{ storageKey?, catalog? }` — optional storage key + catalog override | `src/iap/adapters/local-storage.ts` |
| `createLocalStorageIAPAdapter(config?)` | function | Factory: persists to `localStorage` (or in-memory fallback). Same contract as memory adapter | `src/iap/adapters/local-storage.ts` |

- _decision: `docs/design/iap-bridge-decision.md`_
- _research note: `docs/research/iap-bridge.md`_

---

## Pillar 4: Level Schema (shipped)

> Decision: `docs/design/level-schema-decision.md`.
> Proposal: `docs/design/level-schema-proposal.md` (Approach B: Opinionated Platformer Schema).
> Research: `docs/research/level-schema.md`.

### `src/level/`

Versioned, serializable 2D platformer level schema with forward-ladder migration, defensive validation, and a tile-grid bridge to `src/collision/`. Ships an opinionated entity taxonomy (spawn, exit, platform, passthrough, trap, hazard, decoration, trigger, movingPlatform, enemy, collectible) that mirrors Spitekeep's `LevelData` shape. Consumer extends via typed `props` bags on each entity kind.

#### `src/level/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `LevelRect` | type | `{x, y, width, height}` — serializable AABB (world-space, top-left origin) | `src/level/types.ts` |
| `EntityId` | type | `number` — stable monotonic entity identifier | `src/level/types.ts` |
| `EntityKind` | type | `'spawn' \| 'exit' \| 'platform' \| 'passthrough' \| 'trap' \| 'hazard' \| 'decoration' \| 'trigger' \| 'movingPlatform' \| 'enemy' \| 'collectible'` — shipped entity kinds (non-breaking union expansion for future kinds) | `src/level/types.ts` |
| `CollectibleKind` | type | `'coin' \| 'gem' \| 'key'` — typed sub-kind union for collectible entities. Adding a tier later is a non-breaking union expansion | `src/level/types.ts` |
| `CollectibleProps` | type | `{ kind: CollectibleKind, value?: number, persists?: boolean }` — collectible entity props. `kind` dispatches to renderer palette and catalog prefabs; `value` is an opaque score/currency number; `persists` (default `false`) controls per-run vs persistent collection state | `src/level/types.ts` |
| `ExitProps` | type | `{isTrap: boolean, locked: boolean}` — exit props; `isTrap` marks decoy/failure exits | `src/level/types.ts` |
| `PlatformProps` | type | `{visual?: 'normal' \| 'cracked' \| 'dark'}` — platform visual variant hint | `src/level/types.ts` |
| `TrapProps` | type | `{type: string, params: Record<string, unknown>}` — trap dispatch key + untyped params bag | `src/level/types.ts` |
| `DecorationProps` | type | `{sprite: string, flipX?: boolean}` — decoration sprite key + flip | `src/level/types.ts` |
| `TriggerProps` | type | `{action: string, params: Record<string, unknown>}` — rectangular event zone | `src/level/types.ts` |
| `MovingPlatformProps` | type | `{speed, path, loopMode?}` — kinematic platform motion (path is `readonly {x, y}[]`) | `src/level/types.ts` |
| `EnemyProps` | type | `{archetype: string, params: Record<string, unknown>}` — archetyped dispatch key + untyped params bag. Canonical definition lives here; re-exported from `src/platformer/enemy/types.ts` | `src/level/types.ts` |
| `LevelEntity` | type | Discriminated union on `kind` with kind-specific `props` — 11 variants (`'enemy'` kind carries `EnemyProps`, `'collectible'` kind carries `CollectibleProps`) | `src/level/types.ts` |
| `TileGrid` | type | `{data, cols, rows, tileSize}` — flat row-major tile-value integer array | `src/level/types.ts` |
| `LevelFlags` | type | `{lookahead?, foreground?, background?}` — optional renderer flags | `src/level/types.ts` |
| `LevelData` | type | Complete level schema: version, id, name, dimensions, spawn, tiles, entities, nextEntityId, bottomLava?, hints?, flags? | `src/level/types.ts` |
| `ValidationResult` | type | `{valid, errors[]}` — never-throw validation outcome | `src/level/types.ts` |
| `ValidationError` | type | `{path, message, severity}` — single diagnostic (dotted path into level) | `src/level/types.ts` |
| `ValidationErrorSeverity` | type | `'error' \| 'warning'` — severity of a validation diagnostic | `src/level/types.ts` |
| `LevelMigration` | type | `(raw: Record<string, unknown>) => Record<string, unknown>` — forward-ladder migration step | `src/level/types.ts` |

#### `src/level/constants.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `LEVEL_VERSION` | const | `1` — current level schema version | `src/level/constants.ts` |
| `DEFAULT_TILE_SIZE` | const | `16` — default tile grid cell size in pixels | `src/level/constants.ts` |
| `DEFAULT_LEVEL_WIDTH` | const | `960` — default level width (single-screen) | `src/level/constants.ts` |
| `DEFAULT_LEVEL_HEIGHT` | const | `540` — default level height (single-screen) | `src/level/constants.ts` |
| `DEFAULT_ENTITY_ID_START` | const | `1` — first entity ID allocated by `allocateEntityId` (0 is reserved sentinel) | `src/level/constants.ts` |

#### `src/level/migrate.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `LevelMigrationResult` | type | `{level, fromVersion, toVersion, errors}` — migration outcome (level is `null` on failure) | `src/level/migrate.ts` |
| `migrateLevel(raw, migrations, targetVersion)` | function | Defensive forward-ladder migration: applies version steps in order, coerces/clamps/strips, returns guaranteed-valid shape. Never throws on any input | `src/level/migrate.ts` |

#### `src/level/validate.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `validateLevel(raw)` | function | Defensive structural validation: version, dimensions, bounds, entity IDs/uniqueness, tile grid shape, per-kind prop shape. Returns `ValidationResult`. Never throws. Turret archetype validation accepts optional `params.shootTo` (`{x, y}` with finite numbers) per `docs/design/turret-shoot-to-decision.md` | `src/level/validate.ts` |

#### `src/level/tiles.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createTileQuery(grid, typeMap)` | function | Bridge: build a `TileSolidityQuery` from a `TileGrid` + integer-to-TileType mapper. Out-of-bounds and malformed inputs degrade to `'empty'`; never throws | `src/level/tiles.ts` |

#### `src/level/entity-id.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `allocateEntityId(level)` | function | Pure: returns `{id, nextEntityId}` for a new entity. Monotonic, no `Math.random`. Falls back to `DEFAULT_ENTITY_ID_START` if counter is missing | `src/level/entity-id.ts` |

#### `src/level/serialize.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `canonicalize(value)` | function | RFC 8785 key-sorting JSON canonicalizer. Deterministic, circular-safe, handles non-finite numbers. Pure, zero-dep, never throws | `src/level/serialize.ts` |
| `fnv1a(text)` | function | 32-bit FNV-1a hash → unsigned integer in `[0, 2^32)`. For share-code generation. Pure, zero-dep | `src/level/serialize.ts` |

- _proposal: `docs/design/level-schema-proposal.md`_
- _decision: `docs/design/level-schema-decision.md`_
- _research: `docs/research/level-schema.md`_
- _composes with: `src/collision/types.ts` (`TileSolidityQuery`, `TileType`)_

### `src/editor/`

> Decision: `docs/design/editor-core-decision.md`.
> Proposal: `docs/design/editor-core-proposal.md`.
> Research: `docs/research/editor-core.md`.

Headless level-editor core. Pure operations over `LevelData` — no DOM, no rendering, no mouse handling. Provides undo/redo, selection, transactions, snapping, playtest boundary, clipboard, prefab catalog, and validation diagnostics. Operations are serializable data (no closures) for future multiplayer collaboration readiness. Composes with `src/level/validate.ts` and `src/level/entity-id.ts`.

Architecture: **serializable operations + snapshot history (hybrid)**. Undo restores pre-snapshots; redo restores post-snapshots. The serializable `EditorOperation` record is kept for diagnostics and future CRDT integration. `EditorState` is immutable — every reducer returns a new state.

#### `src/editor/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `EditorOperation` | type | Discriminated union of serializable editor operations: `addEntity`, `removeEntity`, `updateEntityProps`, `moveEntities`, `setEntityRect`, `paintTiles`, `setSpawnPoint`, `batch` | `src/editor/types.ts` |
| `HistoryEntry` | type | `{ op, preSnapshot, postSnapshot, label, transactionId }` — one undo/redo step | `src/editor/types.ts` |
| `SelectionMode` | type | `'replace' \| 'add' \| 'subtract' \| 'toggle'` | `src/editor/types.ts` |
| `SelectionState` | type | `{ ids: ReadonlySet<EntityId> }` — pure-data selection (no closures) | `src/editor/types.ts` |
| `SnapGuide` | type | `{ axis: 'x' \| 'y'; position; start; end }` — alignment guide for UI rendering | `src/editor/types.ts` |
| `EditorState` | type | Full headless document: `level`, `undoStack`, `redoStack`, `maxHistoryDepth`, `selection`, `nextTransactionId`, `pendingTransaction`, `playtestSnapshot`, `validation` | `src/editor/types.ts` |
| `ClipboardEntry` | type | `{ entities: readonly LevelEntity[] }` — in-memory only, never serialized to disk in v1 | `src/editor/types.ts` |
| `CatalogEntry` | type | `{ kind, label, defaultRect, defaultProps }` — prefab descriptor | `src/editor/types.ts` |
| `EntityCatalog` | type | `{ entries: Readonly<Record<string, CatalogEntry>> }` | `src/editor/types.ts` |

#### `src/editor/constants.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `DEFAULT_MAX_HISTORY_DEPTH` | const | `100` — default max undo entries before oldest is evicted | `src/editor/constants.ts` |
| `DEFAULT_GRID_SIZE` | const | `16` — default snap-grid size in world units | `src/editor/constants.ts` |
| `DEFAULT_SNAP_THRESHOLD` | const | `4` — default edge-snap threshold in pixels | `src/editor/constants.ts` |

#### `src/editor/operations.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `applyOp(state, op)` | function | Pure reducer: applies one `EditorOperation` to `EditorState`, returns new state with new `LevelData` (deep JSON-cloned). Pushes to undo stack (unless inside a transaction). Recomputes `validation`. Never throws — unknown entity IDs are silent no-ops | `src/editor/operations.ts` |
| `applyBatch(state, ops, label)` | function | Convenience: applies N ops as one batch with one history entry | `src/editor/operations.ts` |

#### `src/editor/history.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `undo(state)` | function | Pure: pops top of undoStack, restores preSnapshot, pushes entry to redoStack | `src/editor/history.ts` |
| `redo(state)` | function | Pure: pops top of redoStack, restores postSnapshot, pushes entry back to undoStack | `src/editor/history.ts` |
| `beginTransaction(state)` | function | Pure: marks state as in-transaction. Throws if already in a transaction (programmer error) | `src/editor/history.ts` |
| `commitTransaction(state, label)` | function | Pure: collapses pending ops into one batch, pushes to history with label. Clears redo stack | `src/editor/history.ts` |
| `canUndo(state)` | function | Pure reader: `undoStack.length > 0` | `src/editor/history.ts` |
| `canRedo(state)` | function | Pure reader: `redoStack.length > 0` | `src/editor/history.ts` |
| `clearHistory(state)` | function | Pure: empties both stacks. Useful after loading a new level | `src/editor/history.ts` |

#### `src/editor/selection.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `select(state, id, mode)` | function | Pure: select one entity by ID with the given mode | `src/editor/selection.ts` |
| `selectMany(state, ids, mode)` | function | Pure: select multiple entities | `src/editor/selection.ts` |
| `selectInRect(state, rect, mode)` | function | Pure: select all entities whose rect overlaps the given rect (marquee) | `src/editor/selection.ts` |
| `clearSelection(state)` | function | Pure: empty selection set | `src/editor/selection.ts` |
| `selectAll(state)` | function | Pure: select all entity IDs | `src/editor/selection.ts` |
| `isInSelection(state, id)` | function | Pure reader | `src/editor/selection.ts` |
| `entityAtPoint(level, point)` | function | Return the topmost entity containing a world-space point, or null | `src/editor/selection.ts` |

Selection is ephemeral — NOT recorded in history.

#### `src/editor/snapping.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `snapToGrid(x, y, gridSize?)` | function | Pure: rounds coords to nearest grid multiple. Normalises `-0` to `+0` | `src/editor/snapping.ts` |
| `snapRectToGrid(rect, gridSize?)` | function | Pure: snaps rect's top-left corner to grid (preserves dimensions) | `src/editor/snapping.ts` |
| `snapToEdges(movedRect, otherRects, threshold?)` | function | Pure: edge-aligns `movedRect` to the closest edge in `otherRects` if within threshold. Returns `{ rect, guides }` — guides are for UI rendering | `src/editor/snapping.ts` |

#### `src/editor/clipboard.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `copySelection(state)` | function | Pure: returns `ClipboardEntry` with selected entities, or null if selection empty | `src/editor/clipboard.ts` |
| `pasteClipboard(state, clipboard, at)` | function | Pure: pastes entities at offset from their bounding-box top-left. Allocates new stable IDs. Pushes a `batch` op to history | `src/editor/clipboard.ts` |

#### `src/editor/playtest.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `enterPlaytest(state)` | function | Pure: returns `{ snapshot, runtimeLevel }` — both deep JSON-clones of the current level. Consumer runs their simulation against `runtimeLevel`; editor stays frozen | `src/editor/playtest.ts` |
| `exitPlaytest(state, snapshot)` | function | Pure: restores the snapshot as the editor's level. Discards any runtime mutations. History preserved (editor can still undo prior edits) | `src/editor/playtest.ts` |

#### `src/editor/catalog.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `DEFAULT_CATALOG` | const | Ships one `CatalogEntry` per `EntityKind` (spawn, exit, platform, passthrough, trap, hazard, decoration, trigger, movingPlatform, collectible) with sensible defaults. Additional prefab entries for collectible sub-kinds: `coin`, `gem`, `key` (all with `kind: 'collectible'` and appropriate `CollectibleProps`) | `src/editor/catalog.ts` |
| `createCatalogEntry(kind, label, defaultRect?, defaultProps?)` | function | Helper for consumers to build custom catalog entries | `src/editor/catalog.ts` |
| `instantiateCatalogEntry(entry, at)` | function | Returns an `addEntity` op for placing this catalog entry at the given position. Caller applies via `applyOp` | `src/editor/catalog.ts` |
| `findCatalogEntry(catalog, kind)` | function | Find a catalog entry by entity kind, or return `undefined` | `src/editor/catalog.ts` |

#### `src/editor/factory.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createEditorState(level, options?)` | function | Factory: initial `EditorState` with empty history, empty selection, validation cache populated. `options.maxHistoryDepth` overrides default | `src/editor/factory.ts` |

#### `src/editor/index.ts`

Barrel re-export of all public editor APIs. Uses `export type` for type-only re-exports per `isolatedModules`.

- _decision: `docs/design/editor-core-decision.md`_
- _proposal: `docs/design/editor-core-proposal.md`_
- _research: `docs/research/editor-core.md`_
- _composes with: `src/level/types.ts` (`LevelData`, `LevelEntity`, `EntityId`, `EntityKind`, `LevelRect`), `src/level/validate.ts` (`validateLevel`, `ValidationResult`), `src/level/entity-id.ts` (`allocateEntityId`)_

### `src/replay/` ✓ shipped

> Decision: `docs/design/replay-decision.md` (consolidated proposal + decision — architecture pre-determined by existing seams).
> Research: `docs/research/replay.md`.
> Status: **shipped** — implementation complete; verification at `src/tests/replay.test.ts` (byte-identity-with-`stepPlatformer` rerun + hash determinism).

Replay record/playback — the determinism-harness. Captures per-tick `PlatformerInput` + initial state + seed + config into a frozen `Replay`, re-simulates via a consumer-supplied `step` callback, and produces a 32-bit FNV-1a fingerprint via `canonicalize` (re-uses `src/level/serialize.ts`). Determinism discipline was paid for by the existing `stepPlatformer` kernel + serializable `PlatformerInput` shape + the `mulberry32`-only RNG mandate; this module is the final slab.

**Recorder:** mutable renderer-output-buffer exception (mirrors `EdgeAccumulator`). `record()` swallows bad inputs silently and returns the recorder for fluent chaining. `finish()` returns a frozen `Replay`; further `record()` is a no-op.

**Player:** pure. `playReplay(replay, step, dt) → PlatformerState` runs the consumer's `step` for `frames.length` ticks. Empty replay returns `initial` without invoking `step`. `step` throws are swallowed at the throw boundary (returns the highest state reached) — belt-and-braces; `stepPlatformer` is pure.

**Hash:** `replayHash(replay) → number` uses `fnv1a(canonicalize(replay))`. Stable across orders/engines (canonicalize sorts keys), stable across repeated calls, different inputs → different fingerprints with overwhelming probability. Returns `0` on malformed input (stable sentinel).

#### `src/replay/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `Replay` | type | Frozen `{ seed, initial: PlatformerState, frames: readonly PlatformerInput[], config: ReplayConfig }`. Re-simulation contract: same `(replay, step, dt)` → byte-identical final state | `src/replay/types.ts` |
| `ReplayFrame` | type | Alias of `PlatformerInput` — one tick worth of consumer input. Serializes via the platformer's existing `JSON.stringify` round-trip | `src/replay/types.ts` |
| `ReplayConfig` | type | `{ tickRate: number; [key: string]: unknown }` — open extension surface so consumers can attach level id / physics version / etc. into the canonical hash without a library update | `src/replay/types.ts` |
| `ReplayRecorder` | type | The mutable sibling of `Replay`. `record(input) → ReplayRecorder` (chainable), `finish(config) → Replay`, `discard(): void`, `pending: number` | `src/replay/types.ts` |

#### `src/replay/recorder.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createReplayRecorder` | function | `(seed: number, initial: PlatformerState) → ReplayRecorder`. Closure-scoped mutable `ReplayFrame[]` buffer (renderer-output buffer exception). Seed falls back to `0` on non-finite input. Never throws | `src/replay/recorder.ts` |

#### `src/replay/player.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `ReplayStep` | type | `(state, input, dt) → state` — the consumer's pure step (typically a closure over `stepPlatformer(state, input, solids, dt).state`). `playReplay` invokes `step` exactly once per recorded frame | `src/replay/player.ts` |
| `playReplay` | function | Pure. Runs `step` for `frames.length` ticks; swallows throws defensively (returns highest state reached); clamps non-finite `dt` to `0`; empty replay → initial; malformed replay → fallback empty state — never throws | `src/replay/player.ts` |

#### `src/replay/hash.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `replayHash` | function | `fnv1a(canonicalize(replay))` → unsigned 32-bit. Stable across orderings (canonicalize sorts keys). Returns `0` on malformed input as a stable sentinel | `src/replay/hash.ts` |

### `src/collectibles/` ✓ shipped

> Decision: `docs/design/collectibles-decision.md` (Approach A: Closed Kind Taxonomy).
> Proposal: `docs/design/collectibles-proposal.md`.
> Research: `docs/research/collectibles.md`.
> Status: **shipped** — `@architect` APPROVED (loop 2); implementation complete.

Collectibles / pickups subsystem. Extends the level entity taxonomy with a `'collectible'` kind (`CollectibleProps` with typed sub-kind dispatch) and provides pure-progression-ops save state mirroring `src/cosmetics/ownership.ts`. The platformer kernel remains unaware of collectibles — pickups are derived from deterministic AABB collision after each tick, so replays re-derive the same collection events from the same inputs.

**Schema change:** additive union expansion — `'collectible'` added to `EntityKind`. Levels without collectibles are unaffected. Forward-ladder migration v1→v2 is a no-op for the entity list.

**Kernel isolation:** `compileLevel` (in `src/platformer/level-runtime.ts`) already ignores non-solid entity kinds via fallthrough (line 207-208). Collectibles are NOT collision surfaces — they are consumed by `derivePickups` in the consumer's game loop, not by the kernel's collision resolver.

#### `src/collectibles/types.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `CollectibleSave` | type | `{ collected: string[] }` — player collection state. Fields intentionally **NOT `readonly`** (clone-then-mutate discipline, same as `CosmeticSave`). `collected` is a plain sorted `string[]`, never Set/Map. JSON-roundtrip-safe | `src/collectibles/types.ts` |
| `CollectibleEntity` | type | `LevelEntity` narrowed to `kind: 'collectible'` | `src/collectibles/types.ts` |

#### `src/collectibles/collectibles.ts`

Pure progression ops for collectible ownership. Mirrors `src/cosmetics/ownership.ts`: immutable in → JSON-clone out → never mutate → never throw. Call only on user actions (collection events), never per-frame. **Per-level scoping is consumer-owned** — the consumer maintains a `Record<string, CollectibleSave>` keyed by level ID and drops/replaces entries on level reset.

| Export | Kind | Summary | Source |
|---|---|---|---|
| `collect(save, entityId)` | function | Pure op: add entity ID to `collected` (sorted alphabetically, deduped). `entityId` is string — entity IDs are `number` (`EntityId`) in the level schema, but the save stores them as string for canonical sorted-string[] serialization (mirrors `CosmeticSave.owned`). Consumer bridges with `String(id)`. Invalid/empty entityId = silent no-op. Already-collected = silent no-op | `src/collectibles/collectibles.ts` |
| `hasCollected(save, entityId)` | function | Pure reader: `true` if entityId is in `collected`. Invalid/empty entityId = `false` | `src/collectibles/collectibles.ts` |

#### `src/collectibles/derive-pickups.ts`

Deterministic pickup derivation. Pure function of `(playerRect, collectibles, save)` — same inputs → same outputs forever. Uses `aabbOverlap` from `src/collision/aabb.ts` for the overlap test (strict: edges touching = NOT overlapping, preventing false-positive collection at exact boundaries).

| Export | Kind | Summary | Source |
|---|---|---|---|
| `derivePickups(playerRect, collectibles, save)` | function | Pure: test each `collectible` entity's rect against `playerRect` via `aabbOverlap`. Returns `{ collected: EntityId[], remaining: LevelEntity[] }` — newly-collected IDs this tick (number `EntityId`, consumer bridges to string via `String(id)`) and entities not yet collected. Skips entities already in `save.collected`. O(n) per tick where n = collectible count. Never throws — malformed inputs return empty results | `src/collectibles/derive-pickups.ts` |
| `PickupDerivation` | type | Immutable `{ collected, remaining }` result from `derivePickups` | `src/collectibles/derive-pickups.ts` |
| `PlayerRect` | type | Player AABB input accepted by `derivePickups` | `src/collectibles/derive-pickups.ts` |

#### `src/collectibles/constants.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `DEFAULT_COLLECTIBLE_RECT` | const | `{ x: 0, y: 0, width: 16, height: 16 }` — default rect for catalog-placed collectibles (one tile) | `src/collectibles/constants.ts` |
| `DEFAULT_COLLECTIBLE_VALUE` | const | `1` — default value when `CollectibleProps.value` is omitted | `src/collectibles/constants.ts` |

- _proposal: `docs/design/collectibles-proposal.md`_
- _research: `docs/research/collectibles.md`_
- _composes with: `src/level/types.ts` (`EntityKind`, `LevelEntity`, `CollectibleProps`), `src/collision/aabb.ts` (`aabbOverlap`), `src/cosmetics/ownership.ts` (pattern template for pure-progression-ops save)_

### `src/primitives/vector.ts` — NOT SHIPPED

> Proposal: `docs/design/turret-shoot-to-proposal.md`.
> Decision: **REJECTED** — turret-only scope, no new vector module. See `docs/design/turret-shoot-to-decision.md`.

The original proposal (Approach B) included a reusable vector module. The orchestrator decision rejected this: the turret is the only ranged entity; premature abstraction adds surface area without demand. Vector math lives inline in the turret behavior. Extract to `src/primitives/vector.ts` only when a second consumer arrives.

### `src/platformer/enemy/` (Pillar 4)

> Proposal: `docs/design/platformer-enemy-archetypes-proposal.md` (Approach A: Extend EntityKind + Behavior Registry).
> Research: `docs/research/platformer-enemy-archetypes.md`.
> Status: **SHIPPED** — compile, step, renderer, behavior registry all implemented.
> ShootTo extension: **SHIPPED** — `docs/design/turret-shoot-to-decision.md`.

Deterministic reusable platformer enemy archetypes. Ships three built-in archetypes (spinny contact-patrol, turret ranged-shooter, spider procedural-locomotion) with a behavior-handler registry for consumer extensibility. Enemies serialize into `LevelData` as a new `'enemy'` entity kind and compile to a flat runtime state for the game loop.

#### `src/platformer/enemy/types.ts`

Runtime types for the enemy archetype system. `EnemyProps` is re-exported from `src/level/types.ts` (canonical definition lives there).

| Export | Kind | Summary | Source |
|---|---|---|---|
| `EnemyArchetype` | type | `'spinny' \| 'turret' \| 'spider'` — built-in archetype identifiers. Consumers register additional archetypes via `createEnemyBehaviorRegistry`; `EnemyBehaviorRegistry.get()` accepts any `string` | `src/platformer/enemy/types.ts` |
| `EnemyProps` | type | Re-export of `src/level/types.ts` `EnemyProps` — `{archetype: string, params: Record<string, unknown>}`. The `archetype` field dispatches to a behavior handler; `params` is an untyped bag whose shape depends on the archetype | `src/platformer/enemy/types.ts` (re-export from `src/level/types.ts`) |
| `EnemyState` | type | `{x, y, vx, vy, facing, alive, data}` — runtime enemy state. All fields `readonly`; handlers return a fresh object via spread | `src/platformer/enemy/types.ts` |
| `EnemyStepResult` | type | `{x, y, vx, vy, facing, alive, data, projectile?}` — flat per-tick result mirroring `EnemyState` fields plus optional `ProjectileState` spawn | `src/platformer/enemy/types.ts` |
| `EnemyBehaviorHandler` | interface | `{step(state, ctx, params): EnemyStepResult}` — behavior handler contract. Pure, deterministic, never throws. `state` is current `EnemyState` (immutable), `ctx` is per-tick context, `params` is `EnemyProps.params` | `src/platformer/enemy/types.ts` |
| `EnemyUpdateContext` | type | `{dt, solids, tileQuery, tileSize, playerRect}` — read-only tick context. `tileQuery` is `((tileX, tileY) => string) \| null` for ledge/wall detection. `playerRect` is `{x, y, width, height} \| null` for aimed behaviors | `src/platformer/enemy/types.ts` |
| `CompiledEnemy` | type | `{id, archetype, state, entity, params}` — runtime representation of a level enemy entity. `entity` is the source `LevelEntity` (read-only back-reference for rendering); `params` is `EnemyProps.params` | `src/platformer/enemy/types.ts` |
| `EnemyBehaviorRegistry` | type | `{get(archetype: string): EnemyBehaviorHandler \| undefined}` — registry lookup contract. Internal map is an implementation detail; public API is the `get` method | `src/platformer/enemy/types.ts` |
| `ProjectileState` | type | `{x, y, vx, vy, width, height, alive}` — kinematic AABB for enemy-spawned projectiles. Optional `maxRange?: number` — max travel distance in px; `undefined` or `0` = no range limit (legacy). Optional `distanceTraveled?: number` — accumulated distance in px; `undefined` when `maxRange` is absent or `0`; starts at `0` on spawn when `maxRange > 0`. Preserved (not zeroed) on every deactivation path (range exceeded, solid hit, player hit). Set by fixed-mode turrets with a finite `shootTo` vector; aimed-mode turrets always produce projectiles with no `maxRange`. See `docs/design/turret-shoot-to-decision.md` | `src/platformer/enemy/types.ts` |
| `ProjectileStepResult` | interface | Extends `ProjectileState` with `hitPlayer: boolean` — result of `stepProjectile`. Carries through `maxRange`/`distanceTraveled` when present | `src/platformer/enemy/types.ts` |

#### `src/platformer/enemy/registry.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `createEnemyBehaviorRegistry(customHandlers?)` | function | Factory: creates registry with `spinnyBehavior`, `turretBehavior`, and `spiderBehavior` pre-registered, plus any custom handlers. Custom handlers merge on top of built-ins (same-name overrides) | `src/platformer/enemy/registry.ts` |
| `spinnyBehavior` | const | Built-in spinny patrol behavior handler (contact hazard, ledge-detection, path patrol). Patrol path location: `props.params.patrolPath` — `{x, y}[]` waypoints in world-space pixels (minimum 2 waypoints). Also reads `params.speed` (px/s, default 60), `params.ledgeTurnAround` (boolean, default false). **Displacement-coupled deterministic rolling:** accumulates `data.spinAngle` (radians) from actual horizontal displacement each tick: `nextAngle = wrap(prevAngle + dx / RADIUS, 0, 2π)` where `RADIUS = 8` (half the 16px body width). Direction reversal on wall/ledge detection preserves the angle (dx=0). Wraps into `[0, 2π)` to prevent unbounded floating-point growth. Safe legacy fallback: defaults to `0` when `data.spinAngle` is absent or non-finite | `src/platformer/enemy/registry.ts` |
| `turretBehavior` | const | Built-in turret shooting behavior handler (cooldown-gated, aimed or fixed projectiles). Params: `fireRate` (default 1), `projectileSpeed` (default 120), `projectileSize` (default 6), `aimMode` (`'fixed'` or `'aimed'`, default `'fixed'`), `aimDirection` (`{x,y}`, default `{x:1,y:0}`), `shootTo` (`{x,y}`, optional), `detectionRadius` (default 200), `enemyWidth`/`enemyHeight` (default 16). **Fixed mode:** `shootTo` present + finite → normalized direction + `maxRange = magnitude`; `shootTo` missing/zero-length/malformed → falls back to legacy `aimDirection`, `maxRange = 0` (no limit). Zero components preserved via `Number.isFinite` (not `\|\| 0`). **Aimed mode:** `shootTo` is completely ignored; fires toward player within `detectionRadius`, always unbounded (`maxRange = 0`). Spawned projectile carries `maxRange`/`distanceTraveled` when present. Default catalog vector: 128px right. See `docs/design/turret-shoot-to-decision.md` | `src/platformer/enemy/registry.ts` |
| `spiderBehavior` | const | Built-in spider patrol behavior handler. Movement mirrors spinny: x-axis patrol at `speed`, wall collision against `ctx.solids`, optional ledge-turnaround via `ctx.tileQuery`, optional `patrolPath` waypoints. On first tick (when `state.data.spider` is absent), initialises spider state via `createSpiderState`; subsequent ticks advance via `stepSpider`. Params: `speed` (px/s, default 50), `ledgeTurnAround` (boolean, default false), `patrolPath` (`{x,y}[]`, optional), `gaitMode` (`'coordinated' \| 'frantic'`, default `'coordinated'`), `jitterSeed` (number, optional — deterministic from `state.x` via Knuth hash when absent), `palette` (`Partial<SpiderPalette>`, optional). Adapts `ctx.tileQuery` (returns `string \| null`) to `TileSolidityQuery` (returns `'empty'\|'solid'\|'passthrough'`). All tileQuery calls wrapped in try/catch — never throws | `src/platformer/enemy/registry.ts` |

#### `src/platformer/enemy/projectile.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `stepProjectile(projectile, dt, solids, playerRect?)` | function | Pure: advance projectile by `velocity * dt`, check solid collision, check player overlap. Returns `ProjectileStepResult` (`ProjectileState` + `hitPlayer` flag). Dead projectiles pass through unchanged. When `maxRange > 0`: accumulates `distanceTraveled` each tick; on range exceeded, clamps final position to the exact range boundary (`prevPos + dirUnit * remaining`) and deactivates with zero overshoot. Player hit deactivates projectile (prevents death-by-same-projectile on respawn). Precedence: solid hit > player hit > range exceeded. `maxRange`/`distanceTraveled` preserved on every deactivation path. Never throws | `src/platformer/enemy/projectile.ts` |

#### `src/platformer/enemy/compile.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `compileEnemies(level)` | function | Pure: extract `'enemy'` entities from `LevelData`, compile to `CompiledEnemy[]`. Initial state position from entity rect, archetype/params from props. Never throws | `src/platformer/enemy/compile.ts` |
| `stepEnemies(enemies, registry, ctx)` | function | Pure: step all enemies by dt via behavior registry, return `{ enemies, projectiles }`. Dead/unknown enemies passed through unchanged. Never throws | `src/platformer/enemy/compile.ts` |
| `StepEnemiesResult` | type | `{ enemies: readonly CompiledEnemy[], projectiles: readonly ProjectileState[] }` — result of `stepEnemies` | `src/platformer/enemy/compile.ts` |

#### `src/platformer/enemy/renderer.ts`

| Export | Kind | Summary | Source |
|---|---|---|---|
| `EnemyPalette` | type | Optional per-archetype color overrides: `spinny`, `turret`, `default`, `indicator`, `projectile` | `src/platformer/enemy/renderer.ts` |
| `drawEnemies(ctx, enemies, tick, palette?)` | function | Renderer-adjacent: per-archetype visual treatment. Spinny enemies rotate by `enemy.state.data.spinAngle` (deterministic, displacement-coupled). Turret enemies draw a direction indicator line from center: uses `shootTo` direction when present and finite, otherwise falls back to `aimDirection`; zero-component preserved via `Number.isFinite`. Spider enemies draw procedural legs and body segments via `evaluateSpiderPose` + `drawSpider` (reads `state.data.spider`; lazily initialises on first render if missing). Unknown archetypes: static outlined rect. Uses `outlineRect`. Dead enemies skipped. Never throws | `src/platformer/enemy/renderer.ts` |
| `drawProjectiles(ctx, projectiles, palette?)` | function | Renderer-adjacent: draw active projectiles as small outlined rects. Dead projectiles skipped. Never throws | `src/platformer/enemy/renderer.ts` |

- _proposed in: `docs/design/platformer-enemy-archetypes-proposal.md`_
- _research: `docs/research/platformer-enemy-archetypes.md`_
- _composes with: `src/collision/types.ts` (`Solid`, `Rect`), `src/collision/aabb.ts` (`aabbOverlap`), `src/collision/tiles.ts` (`worldToTile`), `src/primitives/outline-rect.ts` (`outlineRect`)_

### `src/platformer/enemy/` — PROPOSED: Archetype Catalog Extension (Phase 2)

> Proposal: `docs/design/enemy-archetype-catalog-proposal.md` (Approach C: Per-Archetype Modules + Registry-Driven Renderer).
> Research: `docs/research/enemy-archetype-catalog.md`.
> Prior decision: `docs/design/platformer-enemy-archetypes-decision.md`.
> Status: **PROPOSED** — awaiting `@architect` critique and benchmark.

Extends the shipped 3-archetype system with 5 new behavior archetypes (`charger`, `chaser`, `burster`, `flyer`, `crawler`). Adds per-archetype modules, line-of-sight helper, surface-hugging stepper, projectile lifetime, and registry-driven renderer. All changes are additive-only — no existing type signatures change.

#### `src/platformer/enemy/types.ts` — additive changes

| Export | Kind | Summary | Status |
|---|---|---|---|
| `EnemyArchetype` | type | Extended to `'spinny' \| 'turret' \| 'spider' \| 'charger' \| 'chaser' \| 'burster' \| 'flyer' \| 'crawler'`. Still a free string at runtime for consumer extensibility | PROPOSED |
| `ProjectileState.lifetime` | field | Optional `number` — remaining lifetime in seconds. When `> 0`, decremented by `dt` each tick; deactivates when `<= 0`. `undefined` = no limit (legacy turrets). Enables burster explosion (zero-velocity, short-lived) | PROPOSED |
| `EnemyStepResult.projectiles` | field | Optional `readonly ProjectileState[]` — all projectiles spawned this tick (may be 0, 1, or many). `stepEnemies` merges with legacy `projectile?` for backward compat | PROPOSED |
| `EnemyUpdateContext.playerVelocity` | field | Optional `{readonly vx: number; readonly vy: number} \| null` — player's velocity this tick. Used by chaser to predict movement, by flyer to lead targets | PROPOSED |
| `EnemyUpdateContext.tick` | field | Optional `number` — current world tick count (monotonic integer). Used for visual timing (flash frequency, shake phase), NOT simulation decisions | PROPOSED |

#### `src/platformer/enemy/los.ts` (NEW)

| Export | Kind | Summary | Status |
|---|---|---|---|
| `checkLineOfSight(x1, y1, x2, y2, tileQuery, tileSize)` | function | DDA tile-grid raycast: returns `true` if the line between two world-space points is unobstructed by solid tiles. Pure, O(max(|dx|, |dy|)), never throws. Used by chaser/charger for player detection | PROPOSED |

#### `src/platformer/enemy/crawler-stepper.ts` (NEW)

| Export | Kind | Summary | Status |
|---|---|---|---|
| `AttachmentSide` | type | `'bottom' \| 'left' \| 'top' \| 'right'` — which side of the enemy is touching the solid surface | PROPOSED |
| `stepCrawler(x, y, crawlDir, speed, dt, side, hitboxSize, tileQuery, tileSize)` | function | Surface-hugging stepper: advances a crawler by one step along its current surface, rotating attachment side at corners. Returns `{x, y, side, angle}`. Pure, grid-aligned 90° only (no slopes), never throws | PROPOSED |

#### `src/platformer/enemy/archetypes/` (NEW — 5 files)

| Export | Kind | Summary | Source | Status |
|---|---|---|---|---|
| `chargerBehavior` | const | Charger: 4-phase state machine (patrol → windup → dash → recovery). Telegraphed high-speed dash with wall-stun. Params: `speed`, `windupDuration`, `dashSpeed`, `dashMaxDistance`, `recoveryDuration`, `detectionRadius` | `archetypes/charger.ts` | PROPOSED |
| `chaserBehavior` | const | Chaser: 2-phase (patrol → chase). Active ground pursuit with LOS detection, lost-timer, optional ledge-turnaround. Params: `patrolSpeed`, `chaseSpeed`, `detectionRadius`, `lostTimer`, `ledgeTurnAround` | `archetypes/chaser.ts` | PROPOSED |
| `bursterBehavior` | const | Burster: 3-phase (seek → fuse → exploded). Kamikaze with proximity trigger, fuse countdown, zero-velocity explosion projectile. Params: `seekSpeed`, `fuseDuration`, `explosionRadius`, `explosionLifetime`, `detectionRadius`, `proximityThreshold` | `archetypes/burster.ts` | PROPOSED |
| `flyerBehavior` | const | Flyer: 2-phase (sinePatrol → seek). Aerial patrol with sine-wave offset, player seek in 2D space. Ignores gravity. Params: `patrolSpeed`, `seekSpeed`, `sineAmplitude`, `sineFrequency`, `detectionRadius` | `archetypes/flyer.ts` | PROPOSED |
| `crawlerBehavior` | const | Crawler: continuous surface-hugging patrol. Walks on floors, climbs walls, traverses ceilings. Composes `stepCrawler`. Params: `speed`, `crawlDir` | `archetypes/crawler.ts` | PROPOSED |

#### `src/platformer/enemy/registry.ts` — additive changes

| Export | Kind | Summary | Status |
|---|---|---|---|
| `chargerBehavior` | const (re-export) | Re-exported from `archetypes/charger.ts` | PROPOSED |
| `chaserBehavior` | const (re-export) | Re-exported from `archetypes/chaser.ts` | PROPOSED |
| `bursterBehavior` | const (re-export) | Re-exported from `archetypes/burster.ts` | PROPOSED |
| `flyerBehavior` | const (re-export) | Re-exported from `archetypes/flyer.ts` | PROPOSED |
| `crawlerBehavior` | const (re-export) | Re-exported from `archetypes/crawler.ts` | PROPOSED |
| `BUILT_IN_HANDLERS` | const (internal) | Extended to include all 8 archetypes | PROPOSED |

#### `src/platformer/enemy/renderer.ts` — refactored dispatch

| Export | Kind | Summary | Status |
|---|---|---|---|
| `EnemyPalette` | type | Extended with optional per-archetype colors: `charger?`, `chaser?`, `burster?`, `flyer?`, `crawler?` | PROPOSED |
| `drawEnemies` | function | Refactored: registry-driven dispatch via `DRAW_REGISTRY` lookup instead of `if/else if` chain. Same signature, same behavior. Fallback: outlined rect for unknown archetypes | PROPOSED |

#### `src/platformer/enemy/index.ts` — additive exports

| Export | Kind | Summary | Status |
|---|---|---|---|
| `checkLineOfSight` | function (re-export) | Re-exported from `los.ts` | PROPOSED |
| `stepCrawler` | function (re-export) | Re-exported from `crawler-stepper.ts` | PROPOSED |
| `AttachmentSide` | type (re-export) | Re-exported from `crawler-stepper.ts` | PROPOSED |
| `chargerBehavior` | const (re-export) | Re-exported from `registry.ts` | PROPOSED |
| `chaserBehavior` | const (re-export) | Re-exported from `registry.ts` | PROPOSED |
| `bursterBehavior` | const (re-export) | Re-exported from `registry.ts` | PROPOSED |
| `flyerBehavior` | const (re-export) | Re-exported from `registry.ts` | PROPOSED |
| `crawlerBehavior` | const (re-export) | Re-exported from `registry.ts` | PROPOSED |

#### `src/editor/catalog.ts` — additive prefab entries

| Export | Kind | Summary | Status |
|---|---|---|---|
| `DEFAULT_CATALOG.entries.charger` | CatalogEntry | Charger prefab: `{archetype: 'charger', params: {speed: 40, windupDuration: 0.5, dashSpeed: 300, dashMaxDistance: 128, recoveryDuration: 0.8, detectionRadius: 160}}` | PROPOSED |
| `DEFAULT_CATALOG.entries.chaser` | CatalogEntry | Chaser prefab: `{archetype: 'chaser', params: {patrolSpeed: 50, chaseSpeed: 90, detectionRadius: 160, lostTimer: 2.0, ledgeTurnAround: true}}` | PROPOSED |
| `DEFAULT_CATALOG.entries.burster` | CatalogEntry | Burster prefab: `{archetype: 'burster', params: {seekSpeed: 60, fuseDuration: 0.6, explosionRadius: 32, explosionLifetime: 0.3, detectionRadius: 200, proximityThreshold: 32}}` | PROPOSED |
| `DEFAULT_CATALOG.entries.flyer` | CatalogEntry | Flyer prefab: `{archetype: 'flyer', params: {patrolSpeed: 40, seekSpeed: 70, sineAmplitude: 20, sineFrequency: 2, detectionRadius: 160}}` | PROPOSED |
| `DEFAULT_CATALOG.entries.crawler` | CatalogEntry | Crawler prefab: `{archetype: 'crawler', params: {speed: 30, crawlDir: 1}}` | PROPOSED |

- _proposal: `docs/design/enemy-archetype-catalog-proposal.md`_
- _research: `docs/research/enemy-archetype-catalog.md`_
- _composes with: `src/collision/tiles.ts` (`worldToTile`, `tileToWorld`), `src/collision/aabb.ts` (`aabbOverlap`), `src/rng/mulberry32.ts` (deterministic shake offsets)_

### `src/primitives/death-feedback.ts` — NOT SHIPPED (showcase-local composition recipe)

> Proposal: `docs/design/minimalist-death-feedback-proposal.md`.
> Decision: **REJECTED as public module** — showcase-local composition, no library exports. See `docs/design/minimalist-death-feedback-decision.md`.

The original proposal (Approach A) included a `DeathFeedbackConfig` type, `DeathEffectDescriptors`, and pure lifecycle helpers. The orchestrator decision rejected this: the consumer already owns `GameState.status` and `deathTimer`; the "6-7 lines per tick" wiring is trivial and game-specific; shipping a config type now locks in parameters before any game has shipped the death feel. The consumer composes death feedback locally using existing engine primitives (`hit-stop`, `particles`, `oscillators`, `audio`). Extract to library only when a second consumer arrives.

**Shipped recipe (Stack A — Vlambeer-style, implemented in `showcase/sections/playground-death.ts`):** 15-tick dying phase, 6-tick hit-stop, 16 deterministic particles, shake amplitude 6 / 10 ticks, 3-tick white flash, player hidden while dying, delayed reset, 8-tick respawn pop, one-shot audio/FX, projectile hit deactivates source. Reduced motion preserves total timing/hit-stop/pop, halves particles, disables shake/flash. See `docs/design/minimalist-death-feedback-decision.md` §Locked values for the complete parameter table. The showcase-local helpers (`beginDeath`, `advanceDeath`, `shouldRespawn`, `isDying`, `isOneShotTick`, `shouldFlash`, `flashAlpha`, `respawnPopScale`) and locked constants are documented in `showcase/sections/playground-death.ts` and tested in `showcase/tests/playground-death.test.ts`.

---

## Pillar 2: Level Testing (PROPOSED)

> Proposal: `docs/design/automated-level-playtesting-proposal.md`.
> Research: `docs/research/automated-level-playtesting.md`.
> Canonical plan: `docs/design/level-generation-quality-implementation-plan.md`.
> Status: **APPROVED DIRECTION; API UNDER REVISION; NOT SHIPPED**.
>
> **Authority note:** the detailed proposal inventory below predates the canonical
> plan and is retained for design history. Its exact signatures are non-canonical
> where they conflict with required-save win conditions, compile options, a single
> physics source, tri-state verification, and unsupported-mechanic handling.

Automated playability verification: "is this level beatable, and what does a winning run look like?" Extends `validateLevel` (structural) with two complementary analyses: **static reachability BFS** (sub-ms, catches obvious bugs) and **simulation seek-bot** (produces a `Replay` for CI golden-fixture verification). The hybrid entry point composes both.

The canonical plan places generic deterministic orchestration in planned
`src/simtest/`; this historical `src/leveltest/` surface becomes its standard
`LevelData`/platformer adapter. Consumer-specific actions and state remain outside
the engine adapter.

### `src/leveltest/jump-arc.ts`

Jump-arc precomputer. Analytic parabolic trajectory computation from `JumpConfig` physics. Shared foundation for both the reachability BFS (generates jump-arc edges) and the bot (validates "can I make this jump?").

| Export | Kind | Summary | Status |
|---|---|---|---|
| `JumpArc` | type | `{ reachable: boolean; airtime: number; difficulty: number; requiresDash: boolean }` — analytic jump-arc result | PROPOSED |
| `computeJumpArc(src, dst, jumpConfig, platformerConfig?, playerWidth?)` | function | Pure: compute whether a jump from src surface to dst surface is reachable. Returns `JumpArc`. Parabolic trajectory math: gravity = 2H/T², launchVelocity = 2H/T. `difficulty` = `clamp(horizontal_distance / maxHorizontalJumpDistance, 0, 1)`. `requiresDash = horizontal_distance > maxNoDashDistance`. `airtime` = exact formula per `to.y` vs `from.y` (see proposal). Never throws | PROPOSED |

- _composes with: `src/animation/jump.ts` (`JumpConfig`, `DEFAULT_JUMP`), `src/platformer/constants.ts` (`DEFAULT_PLATFORMER_CONFIG`, `DEFAULT_PLAYER_WIDTH`, `DEFAULT_PLAYER_HEIGHT`)_

### `src/leveltest/reachability.ts`

Static reachability BFS over compiled standing surfaces with jump-arc edges. No simulation — pure analytic geometry. Catches: spawn-in-wall, unreachable exit, floating exit, unreachable collectibles. Optional backward BFS for softlock detection (forward-reachable but not backward-reachable from exit).

**Surface.id format:** matches `compileLevel`'s `Solid.id` exactly so Surface↔Solid correspondence is verifiable by string equality — entity-derived: `entity-<id>` (id is `EntityId` / number); tile-derived: `tile-<x>-<y>-<width>-<height>` (world-space px, 4 components).

**BFS visit order:** surfaces are visited in lexicographic order of `Surface.id`. The graph builder sorts `CompiledLevel.staticSolids` by `solid.id` before extracting surfaces, so `ReachGraph.surfaces` is sorted. The BFS is reproducible across machines.

| Export | Kind | Summary | Status |
|---|---|---|---|
| `Surface` | type | `{ id, x, y, width, passthrough, entityId? }` — standing surface extracted from compiled geometry. `id` matches `Solid.id` format (entity: `entity-<n>`; tile: `tile-<x>-<y>-<w>-<h>`) | PROPOSED |
| `JumpEdge` | type | `{ from, to, requiresDash, airtime, difficulty }` — jump arc between surfaces. `requiresDash` = `horizontal_distance > maxNoDashDistance`. `difficulty` = `clamp(horizontal_distance / maxHorizontalJumpDistance, 0, 1)`. `airtime` = exact formula (see proposal) | PROPOSED |
| `ReachGraph` | type | `{ surfaces, edges }` — complete reachability graph. `surfaces` is sorted by `id` (lexicographic) | PROPOSED |
| `ReachabilityConfig` | type | `{ jumpConfig?, platformerConfig?, playerWidth?, playerHeight? }` — graph construction params. Defaults: `DEFAULT_JUMP`, `DEFAULT_PLATFORMER_CONFIG`, `DEFAULT_PLAYER_WIDTH` (16), `DEFAULT_PLAYER_HEIGHT` (24) | PROPOSED |
| `ReachabilityResult` | type | `{ version: 1, reachable, graph, spawnSurface, exitSurfaces, reachableSurfaces, softlockSurfaces, diagnostics }` — analysis outcome. `version: 1` pins the schema | PROPOSED |
| `buildReachGraph(compiled, config?)` | function | Pure: build reachability graph from `CompiledLevel`. Sorts `staticSolids` by `id` before extraction. O(surfaces²) edge construction + O(surfaces + edges) BFS. Never throws | PROPOSED |
| `analyzeReachability(level, config?)` | function | Pure: full reachability analysis of `LevelData`. Calls `compileLevel` internally. Returns `ReachabilityResult`. Never throws | PROPOSED |
| `validatePlayability(level, config?)` | function | Convenience: returns `ValidationResult`-shaped diagnostics (extends `validateLevel` with playability errors). Never throws | PROPOSED |

- _composes with: `src/leveltest/jump-arc.ts` (`computeJumpArc`), `src/platformer/level-runtime.ts` (`compileLevel`, `CompiledLevel`), `src/platformer/constants.ts` (`DEFAULT_PLAYER_WIDTH`, `DEFAULT_PLAYER_HEIGHT`), `src/level/validate.ts` (`ValidationResult`)_

### `src/leveltest/bot.ts`

Simulation seek-bot. Drives `stepPlatformer` with a heuristic policy, produces a `Replay` for `replayHash` CI golden-fixture verification. Ships a default greedy exit-seeker; consumers supply custom `BotPolicy` callbacks for complex levels.

**Bot RNG seed:** default = `fnv1a(level.id) XOR BOT_SEED_SALT` (where `BOT_SEED_SALT` is a fixed 32-bit constant in `src/leveltest/constants.ts`). Reproducible across machines — same `level.id` → same seed. Consumers override via `LevelTestConfig.seed` for fuzz-testing.

**Collectibles:** the bot's `collectiblesReached` field is populated each tick by calling `derivePickups(playerRect, collectibles, save)` from `src/collectibles/derive-pickups.ts` — the same deterministic AABB derivation the consumer's game loop uses. Zero replay impact.

| Export | Kind | Summary | Status |
|---|---|---|---|
| `BotContext` | type | `{ entities, solids, movingPlatforms, tick, dt, jumpConfig }` — read-only per-tick context for the bot policy. `dt` is the fixed timestep; `movingPlatforms` lets the bot reason about platform carry | PROPOSED |
| `BotPolicy` | type | `(state, ctx) => PlatformerInput` — consumer-supplied bot decision callback. Pure, deterministic, never throws | PROPOSED |
| `LevelTestConfig` | type | `{ maxTicks?, policy?, platformerConfig?, seed?, winCondition? }` — bot test parameters. `maxTicks` defaults to `DEFAULT_MAX_TICKS` (3600); `seed` defaults to `fnv1a(level.id) XOR BOT_SEED_SALT`; `winCondition` defaults to `reachedExit` | PROPOSED |
| `WinCondition` | type | `(state, entities) => boolean` — consumer-supplied win predicate. Library ships three built-in combinators (`reachedExit`, `collectedAll`, `reachedExitWithKey`) | PROPOSED |
| `reachedExit(state, entities)` | function | Built-in `WinCondition`: true when player AABB overlaps a non-trap, non-locked exit entity. Pure, never throws | PROPOSED |
| `collectedAll(state, entities, save)` | function | Built-in `WinCondition`: true when every `kind: 'collectible'` entity id is in `save.collected`. Pure, never throws | PROPOSED |
| `reachedExitWithKey(state, entities, save)` | function | Built-in `WinCondition`: true when a `kind: 'key'` collectible is in `save.collected` AND player overlaps a beatable exit. Pure, never throws | PROPOSED |
| `LevelTestResult` | type | `{ version: 1, beatable, replay?, replayHash?, winTicks?, failTicks?, deaths, collectiblesReached, failureReason? }` — simulation outcome. `version: 1` pins the schema | PROPOSED |
| `testLevel(level, config?)` | function | Pure: run bot simulation against level. Returns `LevelTestResult`. Default policy: `DEFAULT_BOT_POLICY`. Default maxTicks: `DEFAULT_MAX_TICKS` (3600, 60s at 60Hz). Default seed: `fnv1a(level.id) XOR BOT_SEED_SALT`. Never throws | PROPOSED |
| `DEFAULT_BOT_POLICY` | const | Greedy exit-seeker policy: always move toward nearest non-trap exit, jump when blocked, dash when stuck | PROPOSED |

- _composes with: `src/platformer/kernel.ts` (`stepPlatformer`, `createPlatformerState`), `src/platformer/level-runtime.ts` (`compileLevel`, `CompiledMovingPlatform`), `src/replay/recorder.ts` (`createReplayRecorder`), `src/replay/hash.ts` (`replayHash`), `src/leveltest/jump-arc.ts` (`computeJumpArc`), `src/collectibles/derive-pickups.ts` (`derivePickups`), `src/collision/aabb.ts` (`aabbOverlap`)_

### `src/leveltest/constants.ts`

Named tunables. No magic numbers in the level-test hot path.

| Export | Kind | Summary | Status |
|---|---|---|---|
| `DEFAULT_MAX_TICKS` | const | `3600` — default max bot ticks before declaring failure (60s at 60Hz). Consumers override via `LevelTestConfig.maxTicks` | PROPOSED |
| `BOT_SEED_SALT` | const | Fixed 32-bit constant XORed with `fnv1a(level.id)` to produce the default bot RNG seed. Ensures reproducibility across machines | PROPOSED |

### `src/leveltest/index.ts`

Barrel export. Re-exports all public level-testing APIs.

| Export | Kind | Summary | Status |
|---|---|---|---|
| `HybridTestConfig` | type | `{ maxTicks?, policy?, winCondition?, jumpConfig?, platformerConfig?, seed?, verifySoftlocks? }` — combined test params. Defaults match `LevelTestConfig` | PROPOSED |
| `HybridSimulation` | type | Discriminated union: `{ kind: 'skipped', reason }` (static check failed, bot not run) \| `{ kind: 'ran', winTicks?, deaths, collectiblesReached, failureReason? }` (bot ran) | PROPOSED |
| `HybridTestResult` | type | `{ version: 1, structurallyBeatable, botBeatable, replay?, replayHash?, reachability, simulation, validation }` — layered outcome. `simulation` is a `HybridSimulation` discriminated union (NOT optional). `version: 1` pins the schema | PROPOSED |
| `testLevelHybrid(level, config?)` | function | Pure: static BFS pre-filter + simulation bot. Fast-fail on unreachable exit (sets `simulation.kind = 'skipped'`); bot verifies when reachable (sets `simulation.kind = 'ran'`). Returns `HybridTestResult`. Never throws | PROPOSED |

- _composes with: `src/leveltest/reachability.ts` (`analyzeReachability`), `src/leveltest/bot.ts` (`testLevel`), `src/level/validate.ts` (`validateLevel`)_

- _proposal: `docs/design/automated-level-playtesting-proposal.md`_
- _research: `docs/research/automated-level-playtesting.md`_
- _composes with: `src/platformer/kernel.ts` (`stepPlatformer`), `src/platformer/level-runtime.ts` (`compileLevel`), `src/animation/jump.ts` (`JumpConfig`, `DEFAULT_JUMP`), `src/replay/recorder.ts` (`createReplayRecorder`), `src/replay/player.ts` (`playReplay`), `src/replay/hash.ts` (`replayHash`), `src/level/validate.ts` (`validateLevel`, `ValidationResult`), `src/collision/aabb.ts` (`aabbOverlap`), `src/collectibles/derive-pickups.ts` (`derivePickups`), `src/editor/playtest.ts` (`enterPlaytest`, `exitPlaytest`)_
- _test fixtures: `src/tests/fixtures/levels/<level-id>.json` (committed `LevelData`) + `src/tests/fixtures/replays/<level-id>.json` (committed golden replay with expected `replayHash`)_
- _property-based tests: BFS reachability is reflexive; backward BFS is the reverse of forward BFS; edge symmetry for flat jumps; Surface.id matches Solid.id (string equality)_
- _performance bounds: `analyzeReachability` <0.1 ms for 100 surfaces; `testLevel` <60 ms for 3600 ticks; `testLevelHybrid` <60 ms worst case (fast-fail makes the typical case <0.5 ms)_

---

## Pillar 5: Fake-3D (planned, Phase 4)

### `src/fake3d/` (planned)

Sokpop-inspired fake-3D rendering on Canvas2D. Reference: `docs/research/fake-3d-cube-face-sorting.md` (to be written).

- `project(x, y, z, camera) → Vec2` — orthographic projection
- `drawCube(ctx, x, y, z, size, palette)` — orthographic cube with face-sorting and derived shading
- `billboard(ctx, draw, x, y, z, camera)` — billboard a 2D shape at a 3D position
- `isometricTile(ctx, gridX, gridY, gridSize, palette)` — single isometric tile

---

## Pillar 6: Platform Adapters (on-demand)

### `src/iap/adapters/jest.ts` (deferred)

Jest SDK adapter. Triggered when Spitekeep (or a sibling) submits to Jest.

### `src/iap/adapters/poki.ts` (deferred)

Poki SDK adapter (ads variant). Triggered for dual-publish.

---

## Top-level barrel: `src/index.ts`

Re-exports everything from `./primitives`, `./rng`, `./particles`, `./animation`,
`./palette`, `./cosmetics`, `./iap`, `./collision`, `./camera`, `./input`,
`./game-loop`, `./game-state`, `./audio`, `./save`, `./blend`, `./easing`,
`./music`, `./platformer`, `./level`, `./editor`, `./collectibles`, and
`./replay`. Planned modules are added only after their implementations and contract
tests ship.

```ts
export * from './primitives';
export * from './rng';
export * from './particles';
export * from './animation';
export * from './palette';
export * from './cosmetics';
export * from './iap';
export * from './collision';
export * from './camera';
export * from './input';
export * from './game-loop';
export * from './game-state';
export * from './audio';
export * from './save';
export * from './blend';
export * from './easing';
export * from './music';
export * from './platformer';
export * from './level';
export * from './editor';
export * from './collectibles';
export * from './replay';
// Phase 4: export * from './fake3d';
```

---

## Showcase-local: `showcase/helpers/slime-knight.ts` (shipped)

> Decision: `docs/design/mouth-emotion-decision.md`.
> **NOT a library export.** The library provides primitives; the showcase assembles them.

### Parametric Mouth (shipped)

Additive extension to `drawSlimeKnight`'s `options` bag. Default omitted = no mouth drawn → benchmark byte-identical preserved. The mouth is a pure function of `emotion` — no `tick`, no temporal motion.

| Export | Kind | Summary | Status |
|---|---|---|---|
| `MouthEmotion` | type alias | `number` — `[-1, 1]` where -1 = nervous "o" (small filled circle), 0 = neutral flat line, +1 = happy smile | SHIPPED |
| `drawMouth(ctx, cx, cy, width, emotion, palette)` | function (showcase-local) | Parametric mouth: `emotion > 0` → cubic-Bézier smile via `drawSmoothMouth` (curvature = emotion). `emotion <= 0` → flat-line → filled-circle morph via `drawCircleMouth` (morph param `t = clamp(-emotion, 0, 1)`). Pure function of `(cx, cy, width, emotion, palette)` — no tick, no RNG | SHIPPED |
| `options.emotion` | field on `drawSlimeKnight` options | `MouthEmotion` — drives the mouth shape. Default omitted (no mouth drawn, benchmark byte-identical); `0` draws a neutral flat line | SHIPPED |

**Internal functions** (not exported, called by `drawMouth`):

| Function | Summary |
|---|---|
| `drawSmoothMouth(ctx, cx, cy, width, curvature, palette)` | Cubic-Bézier smile for `emotion > 0`. Stroke-only using `palette.outline` at `CHUNKY_OUTLINE_WIDTH` |
| `drawCircleMouth(ctx, cx, cy, width, t, palette)` | Flat-line → filled-circle morph for `emotion <= 0`. Ellipse filled AND stroked in `palette.outline` at `CHUNKY_OUTLINE_WIDTH`. At `t = 0` renders the same flat line as the smile branch at curvature 0 |

**Shipped constants** (all in `showcase/helpers/slime-knight.ts`):

| Constant | Value | Description |
|---|---|---|
| `MOUTH_Y_OFFSET_RATIO` | `0.30` | Vertical offset from body center as fraction of `bodyHeight` |
| `MOUTH_WIDTH_RATIO` | `0.35` | Mouth width as fraction of `bodyWidth` |
| `MOUTH_CURVATURE_CONTROL_RATIO` | `0.25` | Bézier control-point vertical displacement fraction of mouth width |
| `MOUTH_CIRCLE_RADIUS_RATIO` | `0.20` | Radius of the nervous "o" circle at `emotion = -1`, as fraction of mouth width |

- _research note: `docs/research/mouth-emotion.md`_
- _proposal: `docs/design/mouth-emotion-proposal.md`_
- _decision: `docs/design/mouth-emotion-decision.md`_
- _benchmark: `benchmarks/mouth-emotion.png`_

---

## Change protocol

When adding, changing, or removing an export:

1. The proposal lives at `docs/design/<technique>-proposal.md`.
2. The decision lives at `docs/design/<technique>-decision.md`.
3. **This file must be updated in the same task** as the source change. Drift is an integration bug.
4. The `@team` orchestrator inspects this file against `src/` before committing.
5. The `@architect` critiques any new export or signature change before it ships.

Breaking changes to existing exports require:

- Major version bump in `package.json`.
- Migration notes in `docs/design/<technique>-decision.md`.
- Update to Spitekeep (the first consumer) in the same coordinated change.
