/**
 * Phase 6 distribution-size gate for level visuals.
 *
 * Baseline: docs/design/level-visual-rendering-phase0-record.md §2.1.
 * Ceilings leave 10% total headroom and 12% JavaScript headroom for the
 * complete terrain/theme/preview stack. Declarations are tracked separately
 * because they were 41% of the Phase 0 distribution.
 */

import { readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const baseline = Object.freeze({
  total: 1_662_368,
  js: 973_436,
  declarations: 688_932,
});
const ceiling = Object.freeze({
  total: Math.floor(baseline.total * 1.10),
  js: Math.floor(baseline.js * 1.12),
  declarations: Math.floor(baseline.declarations * 1.10),
});

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

const sizes = { total: 0, js: 0, declarations: 0 };
for (const file of filesBelow(dist)) {
  const bytes = statSync(file).size;
  sizes.total += bytes;
  if (file.endsWith('.d.ts')) sizes.declarations += bytes;
  else if (extname(file) === '.js') sizes.js += bytes;
}

let failed = false;
for (const key of ['total', 'js', 'declarations']) {
  const delta = sizes[key] - baseline[key];
  const percent = (delta / baseline[key] * 100).toFixed(2);
  const ok = sizes[key] <= ceiling[key];
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${key.padEnd(12)} ${String(sizes[key]).padStart(9)} bytes ` +
    `(${delta >= 0 ? '+' : ''}${percent}% vs Phase 0; ceiling ${ceiling[key]})`,
  );
  if (!ok) failed = true;
}
if (failed) process.exitCode = 1;
