import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * The LDtk module splits into independently shippable leaves. A game that only
 * draws levels must not pay for the parser, the rule engine or the writer, so
 * each budget is checked against its own entry point rather than the barrel.
 */
const TARGETS = [
  {
    name: 'render',
    entry: 'src/ldtk/render.ts',
    maxBytes: 12000,
    // Authoring-time code. Leaking any of it into the draw path would drag the
    // whole document model into a runtime that only needs to blit tiles.
    forbidden: [
      '/ldtk/parse.ts',
      '/ldtk/translate.ts',
      '/ldtk/rules.ts',
      '/ldtk/rng.ts',
      '/ldtk/edit.ts',
      '/ldtk/write.ts',
      '/ldtk/format.ts',
    ],
  },
  {
    name: 'auto-tiler',
    entry: 'src/ldtk/rules.ts',
    // The rule engine is useful at runtime on its own — procedurally generated
    // levels can be skinned with an authored ruleset at load time — so it gets
    // a budget rather than a ban. Perlin's gradient table dominates its size.
    maxBytes: 20000,
    forbidden: ['/ldtk/parse.ts', '/ldtk/edit.ts', '/ldtk/write.ts', '/ldtk/format.ts'],
  },
  {
    name: 'writer',
    entry: 'src/ldtk/write.ts',
    maxBytes: 24000,
    // The writer necessarily pulls the parser; it must not pull the renderer
    // or the rule engine.
    forbidden: ['/ldtk/render.ts', '/ldtk/rules.ts'],
  },
];

let failed = false;

for (const target of TARGETS) {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: true,
      lib: { entry: resolve(root, target.entry), formats: ['es'], fileName: target.name },
      rollupOptions: { treeshake: true },
    },
  });
  const outputs = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output;
  const chunks = outputs.filter((output) => output.type === 'chunk');
  const included = chunks
    .flatMap((chunk) => Object.keys(chunk.modules))
    .map((id) => id.replaceAll('\\', '/'));
  const violations = included.filter((id) => target.forbidden.some((part) => id.includes(part)));
  const bytes = chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0);

  if (violations.length > 0 || bytes > target.maxBytes) {
    failed = true;
    console.error(`FAIL  ldtk ${target.name}: ${bytes} bytes (max ${target.maxBytes})`);
    for (const violation of violations) console.error(`  - leaked ${violation}`);
  } else {
    console.log(
      `ok    ldtk ${target.name}: ${bytes} bytes (max ${target.maxBytes}), `
      + `${included.length} modules, no leakage`,
    );
  }
}

if (failed) process.exitCode = 1;
