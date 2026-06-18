# Conventions

This library mirrors [Spitekeep's conventions](../../ai-craft-game-dev-devil/) exactly. New code must follow these rules.

## TypeScript

- **Strict mode** (`"strict": true`).
- **`noUnusedLocals`**, **`noUnusedParameters`**, **`noFallthroughCasesInSwitch`**, **`forceConsistentCasingInFileNames`**.
- **`isolatedModules`** — no `const enum`, no re-exported types without `export type`.
- **`moduleResolution: "bundler"`** — relative imports only; no bare specifiers.
- **Target:** ES2021. **Module:** ESNext.

## File naming

- All files: **lowercase-kebab** (`outline-rect.ts`, `mulberry32.ts`, NOT `OutlineRect.ts`).
- Test files: `*.test.ts`, colocated in `src/tests/` or `src/<module>/tests/`.

## Code style

- **No comments unless asked.** Code must be self-documenting through good names and types. (Spitekeep has heavy inline rationale, but that is in-service of explaining *non-obvious decisions*; routine comments are not added.)
- **Extensive JSDoc on every public export.** Document the contract, not the implementation.
- **Inline rationale for non-obvious decisions.** If you made a choice that isn't self-evident from the code, explain it in a comment.
- **No magic numbers.** Every tunable value lives in a config object the consumer can spread into their own.
- **No magic colors.** Every color lives in a palette object.

## Determinism

- **No `Math.random`** in deterministic code. Use `src/rng/mulberry32.ts`.
- **No `Date.now()`** in deterministic code. Take time as a parameter.
- **No global mutable state** in pure functions.
- **No DOM reads** in deterministic code. Pass host info as parameters.

## Defensiveness

- **Lazy host-API resolution.** Don't access `window` at module load; access it inside a function that runs at call time.
- **Swallow all errors** in adapter public APIs.
- **In-memory test fallback** for every adapter.
- **Never-throw public APIs.** Degrade gracefully.

## Purity

- **Progression / ownership ops are pure.** Immutable returns, JSON-clone for deep copy, never mutate input, never throw.
- **Out-of-range indices** are silent no-ops.
- **Invalid types** are coerced or ignored, never thrown.

## Accessibility

- **`prefers-reduced-motion` respected** via a cached-at-module-load probe (`src/primitives/motion.ts`).
- **WCAG 4.5:1 contrast** for all gameplay art (GDD §11.3). The library provides a `contrastRatio()` checker in `src/primitives/color.ts`.

## Testing

- **Vitest** with `environment: 'node'` (NOT jsdom unless DOM-coupled code is added later).
- **`describe` / `it` / `expect`** BDD style.
- **Public-surface assertions.** Tests treat the public API as the contract; they don't reach into private internals.
- **TDD for new deterministic logic.** Write the test first; implement until it passes.
- **Visual verification deferred to consumer** (Playwright tests in Spitekeep, not in this library).

## Naming patterns

- **Factory functions:** `createX()` (e.g. `createMemoryIAPAdapter()`).
- **Pure ops:** verb-noun (`grantEntitlement`, `markCompleted`).
- **Readers:** `isX()`, `getX()`, `hasX()`.
- **Types:** PascalCase noun (`IAPBridge`, `CosmeticManifest`).
- **Constants:** UPPER_SNAKE (`DEFAULT_OUTLINE_COLOR`).

## Module structure

Every module follows the same shape:

```
src/<module>/
├── types.ts        # Type definitions only
├── <thing>.ts      # Implementation
├── index.ts        # Barrel export
└── tests/
    └── <thing>.test.ts
```

If the module is small enough, types and implementation can live in one file. The barrel `index.ts` is always present.
