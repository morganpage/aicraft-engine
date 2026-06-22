# Tech Stack

This is a TypeScript library, not a game or app. It has no runtime entry point, no DOM, no build output that ships anywhere — it is consumed by other projects via git submodule or vendored copy.

## Non-negotiables

- **Zero runtime dependencies.** `package.json` has no `dependencies` block. Adding one is a breaking change requiring user approval.
- **devDependencies only:** `typescript`, `vite`, `vitest`. Nothing else without explicit approval.
- **Strict TypeScript.** See `tsconfig.json`: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `isolatedModules`.
- **Target ES2021, module ESNext, moduleResolution bundler.**
- **Vitest with `environment: 'node'`.** No jsdom unless DOM-coupled tests are added later.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Run all unit tests (`vitest run`) |
| `npm run test:watch` | Vitest watch mode |
| `npm run build` | `tsc --noEmit` — typecheck gate (no JS emitted; consumers compile the TS directly via their bundler) |

There is no `npm run dev` (no app to run) and no `npm start`.

## Determinism rules

The library enforces strict determinism in its core layer. See `docs/architecture.md` for the full layer model. Summary:

- No `Math.random` in deterministic code. Use `src/rng/mulberry32.ts`.
- No `Date.now()` in deterministic code. Take `tick` or `dt` as a parameter.
- No global mutable state in pure functions.
- No DOM reads in deterministic code.
- Renderers may relax these only when the result cannot leak back into the simulation.

## Defensive adapter pattern

Anything that touches a host API (`window`, `localStorage`, `matchMedia`, platform SDKs) must:

- Resolve the host lazily — never at module load.
- Swallow all errors.
- Fall back to an in-memory implementation in Node/SSR/test environments.
- Expose a never-throw public API.

See `src/primitives/motion.ts` for the canonical example.

## Pure progression ops

Anything that mutates logical state (entitlements, ownership, settings):

- Takes current state as input.
- Returns a brand-new state object (JSON-clone for deep copy).
- Never mutates input.
- Never throws.

Mirrors the discipline of `platform/progress.ts` in the sibling Spitekeep codebase (Spitekeep has been renamed to **IMP - Not a Troll** — same repo).

## When in doubt

Read `docs/architecture.md` and `docs/conventions.md`. They are the source of truth.
