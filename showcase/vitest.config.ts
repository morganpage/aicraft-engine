import { defineConfig } from 'vitest/config';

// Dedicated Vitest config for the showcase.
//
// The root `vite.config.ts` runs the LIBRARY test suite (DOM-free, pure
// deterministic core) under `environment: 'node'`. The showcase, however,
// is a real consumer app whose DOM-coupled code (`sections/playground.ts`)
// imports browser APIs (`window`, `matchMedia`, `IntersectionObserver`,
// `AudioContext`) at runtime. We can't unit-test that DOM-touched code
// without a brittle jsdom fake, and the project's tech stack forbids
// adding `jsdom` as a devDependency.
//
// The compromise (per the integration-hardening spec): extract the
// DOM-free pure logic the playground actually uses into
// `sections/playground-session.ts` and `sections/playground-helpers.ts`,
// then test those here. These tests exercise the same helpers
// `sections/playground.ts` calls into — they do NOT reimplement the
// playground's logic, so they catch real regressions in the layer that
// matters for state and simulation.
//
// Running this config:
//   npm run showcase:test          # vitest run (CI / pre-commit)
//   npm run showcase:test:watch    # watch mode
//
// Both scripts use Vitest (already a devDependency); no new deps added.
export default defineConfig({
  // `test` is recognized via the triple-slash `/// <reference types="vitest" />`
  // directive at the top of this file; defineConfig comes from `vite` itself.
  test: {
    environment: 'node',
    include: ['showcase/tests/**/*.test.ts'],
  },
});

