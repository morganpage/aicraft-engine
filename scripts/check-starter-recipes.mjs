#!/usr/bin/env node
/**
 * The starter carries a COPY of recipes/ (games/celerock-starter/src/recipes/).
 * A copy is a second source of truth, and a second source of truth drifts.
 * This fails the moment the two diverge, so the starter cannot quietly ship a
 * stale recipe against a newer engine.
 *
 * Fix drift by re-copying, never by editing the starter's copy:
 *   node scripts/check-starter-recipes.mjs --fix
 */
import { readFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'recipes');
const dst = join(root, 'games', 'celerock-starter', 'src', 'recipes');
const fix = process.argv.includes('--fix');

const REQUIRED = [
  'fixed-tick-game', 'platformer-input', 'sprite-sheet-boot', 'image-decoder',
  'sheet-frame-index', 'ldtk-draw-pipeline', 'room-slide-aperture',
  'ldtk-entity-art', 'feel-effects', 'audio-unlock', 'game-test-harness',
  'ldtk-hot-reload-plugin',
  // Capability-gated on the level (§6.1): the shipped pack defines a
  // FallingBlock entity, so the starter carries the art recipe for it.
  'ldtk-entity-tile-art',
];

let bad = 0;
for (const name of REQUIRED) {
  const a = join(src, `${name}.ts`);
  const b = join(dst, `${name}.ts`);
  if (!existsSync(a)) { console.error(`  MISSING IN recipes/: ${name}.ts`); bad++; continue; }
  if (!existsSync(b)) {
    if (fix) { copyFileSync(a, b); console.log(`  copied ${name}.ts`); continue; }
    console.error(`  MISSING IN STARTER: ${name}.ts`); bad++; continue;
  }
  if (readFileSync(a, 'utf8') !== readFileSync(b, 'utf8')) {
    if (fix) { copyFileSync(a, b); console.log(`  resynced ${name}.ts`); continue; }
    console.error(`  DRIFTED: ${name}.ts — starter copy differs from recipes/`);
    bad++;
  }
}

if (bad > 0) {
  console.error(`\nstarter recipes: ${bad} problem(s). Re-copy with --fix (never edit the copy).`);
  process.exit(1);
}
console.log(`starter recipes: ${REQUIRED.length} in sync.`);
