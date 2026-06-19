import { defineConfig } from 'vite';

// Showcase-only Vite config. The library is imported via relative paths
// (../../src/<module>); no alias, no symlink, no package.json dependency.
//
// No `@types/node` is required (and the task forbids adding devDeps): the
// config uses only string-relative paths, resolved by Vite against the
// project root (the directory `npm run showcase:dev` is invoked from).
//
// `base: './'` makes the built index.html portable to any deploy path.
// Swap to `base: '/aicraft-engine/'` before deploying to GitHub Pages.
export default defineConfig({
  root: 'showcase',
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
