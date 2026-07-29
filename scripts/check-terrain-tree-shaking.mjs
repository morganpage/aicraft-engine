/**
 * Phase 6 terrain leaf-import smoke test.
 *
 * Bundles `drawTerrainRect` from its leaf module with Vite/Rollup, then checks
 * the final chunk's included-module list. This is deliberately a real bundle
 * test rather than an import-graph inspection: type-only imports and dead
 * branches must not count as shipped runtime code.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const entry = resolve(root, 'src/terrain/rect-renderer.ts');
const result = await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    write: false,
    lib: {
      entry,
      formats: ['es'],
      fileName: 'terrain-rect-smoke',
    },
    rollupOptions: {
      treeshake: true,
    },
  },
});

const outputs = Array.isArray(result)
  ? result.flatMap((item) => item.output)
  : result.output;
const included = new Set(
  outputs.flatMap((output) => output.type === 'chunk' ? Object.keys(output.modules) : []),
);
const forbidden = [
  '/src/platformer/themes/',
  '/src/terrain/tile-renderer.ts',
  '/src/terrain/surface-detail.ts',
];
const violations = [...included].filter((id) =>
  forbidden.some((needle) => id.replaceAll('\\', '/').includes(needle))
);

if (violations.length > 0) {
  console.error('Terrain leaf bundle pulled in forbidden modules:');
  for (const id of violations) console.error(`- ${id}`);
  process.exitCode = 1;
} else {
  const relative = [...included]
    .map((id) => id.replace(`${root}/`, ''))
    .sort();
  console.log(`ok  drawTerrainRect leaf bundle: ${relative.length} modules`);
  for (const id of relative) console.log(`    ${id}`);
}
