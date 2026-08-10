/**
 * Whole-`dist/` distribution-size regression gate.
 *
 * Despite the historical script name (`check:level-visual-size`, retained to
 * avoid churn), this check measures the ENTIRE compiled `dist/` tree — every
 * shipped `.js` and `.d.ts` — not just the level-visual modules. It is a
 * regression budget for the whole package.
 *
 * Re-baseline policy: the baseline is re-pegged at each minor release boundary
 * so the gate guards against UNEXPECTED growth (0.5.x patch lines and into
 * 0.6.0) rather than against the legitimate module additions that shipped with
 * the minor (e.g. `sprites/`, `ldtk/`, `terrain-art/`, `character/humanoid/`
 * in 0.5.0). The current baseline is pegged to 0.5.0; the re-baseline
 * rationale is recorded in `docs/design/0.5.0-scope-decision.md`. The Phase 0
 * numbers in `docs/design/level-visual-rendering-phase0-record.md` §2.1 are the
 * original historical baseline and are no longer the live gate.
 *
 * Ceilings leave 10% total headroom, 10% declarations headroom, and 12%
 * JavaScript headroom over the current baseline.
 */

import { readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const baseline = Object.freeze({
  total: 2_319_394,
  js: 1_423_685,
  declarations: 895_709,
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
    `(${delta >= 0 ? '+' : ''}${percent}% vs 0.5.0 baseline; ceiling ${ceiling[key]})`,
  );
  if (!ok) failed = true;
}
if (failed) process.exitCode = 1;
