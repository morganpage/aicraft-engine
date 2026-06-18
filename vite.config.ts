/// <reference types="vitest" />
import { defineConfig } from 'vite';

// Vite + Vitest configuration.
// Tests target the pure core layer, which is DOM-free, so a fast Node
// environment is used. Add a jsdom environment later if DOM-coupled code
// needs to be exercised in unit tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
});
