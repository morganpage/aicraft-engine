/**
 * Whole-`dist/` distribution-size regression gate.
 *
 * Despite the historical script name (`check:level-visual-size`, retained to
 * avoid churn), this check measures the ENTIRE compiled `dist/` tree — every
 * shipped `.js` and `.d.ts` — not just the level-visual modules. It is a
 * regression budget for the whole package.
 *
 * Re-baseline policy: the baseline is re-pegged at each minor release boundary
 * so the gate guards against UNEXPECTED growth (e.g. 0.16.x patch lines) rather
 * than against the legitimate module additions that shipped with the minor.
 * The 0.6.0 minor shipped the camera brain, the LDtk loader, and the Phase 0–9
 * movement overhaul; the minors since then added the golden-path loader +
 * preflight + per-room compiler (0.7.0), the feel-moments + room-transition +
 * mantle layer (0.9.0), the destination view (0.11.0), the seam-free surface
 * cache (0.12.0), sustained audio (0.13.0), the direction-aware wall-jump and
 * room-transition session (0.14–0.15), and the entity-art pair (0.16.0) — that
 * cumulative legitimate growth exhausted the 0.6.0 headroom, so the baseline is
 * now pegged to the 0.17.0 distribution (the 0.17.0 minor added the Celerock
 * FIXES.md hardening APIs — sprite clip player, camera snap/transform — plus
 * the entity NineSlice borders, per-emitter particle gravity, the shared
 * fnv1a leaf, and the physics-v14 collision/spring changes). The 0.5.0 baseline rationale is
 * recorded in `docs/design/0.5.0-scope-decision.md`; the Phase 0 numbers in
 * `docs/design/level-visual-rendering-phase0-record.md` §2.1 are the original
 * historical baseline and are no longer the live gate.
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
  total: 3_012_389,
  js: 1_845_386,
  declarations: 1_153_363,
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
    `(${delta >= 0 ? '+' : ''}${percent}% vs 0.17.0 baseline; ceiling ${ceiling[key]})`,
  );
  if (!ok) failed = true;
}
if (failed) process.exitCode = 1;
