import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const result = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: true, lib: { entry: resolve(root, 'src/terrain-art/runtime-renderer.ts'), formats: ['es'], fileName: 'terrain-art-runtime' }, rollupOptions: { treeshake: true } } });
const outputs = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output;
const chunks = outputs.filter((output) => output.type === 'chunk');
const included = chunks.flatMap((chunk) => Object.keys(chunk.modules)).map((id) => id.replaceAll('\\', '/'));
const forbidden = ['/reference-editor.ts', '/factory.ts', '/compositor.ts', '/manual-paint.ts', '/project-operations.ts'];
const violations = included.filter((id) => forbidden.some((part) => id.includes(part)));
const bytes = chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0);
if (violations.length || bytes > 12000) {
  console.error(`Terrain-art runtime bundle failed: ${bytes} bytes`); for (const violation of violations) console.error(`- ${violation}`); process.exitCode = 1;
} else console.log(`ok  terrain-art runtime leaf bundle: ${bytes} bytes, ${included.length} modules, no editor/authoring UI`);
