import { defineConfig } from 'vite';
import { createLdtkHotReloadPlugin } from './src/recipes/ldtk-hot-reload-plugin';

// §5.7 — dev-only. The plugin fires 'ldtk:update'; src/main.ts carries the
// import.meta.hot listener that consumes it. Both halves or neither: a mounted
// plugin whose event nothing handles is a hot reload that has never reloaded.
export default defineConfig({
  root: __dirname,
  plugins: [createLdtkHotReloadPlugin()],
});
