/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Vite + Vitest configuration.
// Tests target the pure core layer, which is DOM-free, so a fast Node
// environment is used. Add a jsdom environment later if DOM-coupled code
// needs to be exercised in unit tests.
//
// `recipes/` are copy-in consumer modules (see recipes/README.md): they
// import from 'aicraft-engine' exactly the way a real game does, so both
// the test include and the alias below wire them against live `src/` —
// the same mapping `recipes/tsconfig.json` provides for `tsc`.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^aicraft-engine$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    include: [
      'src/tests/**/*.test.ts',
      'src/*/tests/**/*.test.ts',
      'recipes/tests/**/*.test.ts',
    ],
  },
});
