# Benchmarks

This directory holds visual sample renders produced by the `@benchmarker` agent. PNGs here are documentation — they show what the library actually produces, not what we claim it produces.

## Convention

- One subdirectory per technique: `benchmarks/<technique>/`.
- Each subdirectory contains:
  - The PNG samples themselves (tracked in git).
  - A `README.md` explaining what each PNG shows and how to reproduce it.
- Render scripts live in `benchmarks/_scripts/` and are also tracked so renders are reproducible.

```
benchmarks/
├── README.md                    # This file
├── _scripts/                    # Reproducible render scripts
│   └── <technique>-render.ts
└── <technique>/
    ├── README.md                # What the samples show
    ├── variant-sheet.png        # Standard layouts (see prompts/benchmarker.md)
    ├── stress-sheet.png
    └── gallery.png              # Polished showcase image (referenced in docs/api-surface.md)
```

## Reproducibility

Every PNG in this directory must be reproducible from a script in `_scripts/`. If you find an orphaned PNG with no script, flag it — either write the script or delete the PNG.

To re-render a technique:

```bash
npx tsx benchmarks/_scripts/<technique>-render.ts
```

The script regenerates the PNGs in `benchmarks/<technique>/`. With deterministic library code, the output should be byte-identical across runs. If it isn't, that's a library bug.

## Determinism check

Same inputs → identical PNG bytes. This is enforced by:

1. Seeded RNG (`src/rng/mulberry32.ts`) — no `Math.random`.
2. No wall-clock reads in deterministic code.
3. No global mutable state.

If a render script's PNGs change between runs without code changes, the bug is in the library, not the script.

## Standard sample layouts

See `prompts/benchmarker.md` for the canonical layouts:

- **Variant sheet** — 8 or 16 variants in a grid (for cosmetics / procedural generation).
- **Before/after sheet** — two halves for refactor comparisons.
- **Stress sheet** — deliberately hard cases packed into one image (tiny/huge/overlapping/high-contrast/off-grid).
- **Orientation sheet** — same subject at 4-8 camera angles (for fake-3D).

## Rendering setup

The library targets `CanvasRenderingContext2D`. For headless Node rendering, use the `canvas` (node-canvas) npm package as a devDependency:

```bash
npm install --save-dev canvas
```

This is a **devDependency only** — never added to runtime `dependencies`. The zero-dep invariant is preserved for consumers.

See `prompts/benchmarker.md` for the full setup and Playwright fallback.

## When to add a benchmark

Add a benchmark whenever:

- A new rendering technique ships (Pillars 1, 2, 4).
- A refactor changes visual output — capture before/after.
- A bug fix touches rendering — capture the bug and the fix side-by-side.
- An API proposal needs visual comparison between approaches (Step 5 of the team workflow).

Don't add benchmarks for:

- Pure deterministic helpers with no visual output (color math utilities — covered by unit tests).
- Save/entitlement state ops — covered by unit tests.
- Documentation changes.
