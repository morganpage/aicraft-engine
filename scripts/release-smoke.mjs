/**
 * Packed-artifact release smoke test (Celerock hardening, Workstream A2).
 *
 * Proves the PUBLISHED artifact works for real consumers by building the
 * package, `npm pack`-ing it into a hermetic temp dir, and driving three
 * independent consumers off the resulting tarball — never off repo source:
 *
 *   1. Node ESM consumer     — `import * as ae from 'aicraft-engine'`, exercise
 *                              real exports, and run a deterministic platformer
 *                              probe (`scalePlatformerConfig` → `stepPlatformer`
 *                              ticks on a flat floor; assert finite + resting).
 *   2. NodeNext typecheck    — a `.ts` file with a VALUE import and a TYPE
 *                              import from `aicraft-engine`, typechecked under
 *                              `module:NodeNext`, `moduleResolution:NodeNext`,
 *                              `skipLibCheck:false`, `strict:true`. This is the
 *                              regression guard for TS2846 / extensionless
 *                              `.d.ts` specifier bugs that the repo's own
 *                              `skipLibCheck:true` MASKS (see
 *                              `scripts/fix-esm-specifiers.mjs`).
 *   3. Vite consumer         — a hand-authored minimal `vite build` that imports
 *                              the package from TypeScript and bundles it.
 *
 * Design goals:
 *  - Hermetic: every consumer lives under a fresh `mkdtemp(os.tmpdir())` dir;
 *    cleaned up at the end (set `AE_RELEASE_SMOKE_KEEP=1` to keep it for
 *    debugging). Idempotent and safe to re-run.
 *  - Packed-tarball-only: `aicraft-engine` is ALWAYS installed from the `.tgz`
 *    produced by `npm pack`, so this catches publish-time breakage that
 *    source-resolution-based checks miss.
 *  - Zero new runtime deps: uses only Node built-ins plus `npm` and the repo's
 *    already-installed `tsc` / `vite` binaries (devDeps of this repo).
 *  - Legible failures: each stage prints a one-line OK / FAIL; any non-zero
 *    exit is surfaced with the command's captured output and the script exits
 *    non-zero with a clear message.
 *
 * Usage: `node scripts/release-smoke.mjs`  (also wired as `npm run release:smoke`)
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolveRepoRoot();
const keepTmp = process.env.AE_RELEASE_SMOKE_KEEP === '1';

// --- helpers ---------------------------------------------------------------

/** Resolve the repo root from this script's location (no source probing). */
function resolveRepoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * Run a command synchronously. Returns `{ status, stdout, stderr }`.
 *
 * `stdio` defaults to `'pipe'` (captured). Pass `'inherit'` to stream a
 * long-running command's output straight to the terminal. NEVER throws here —
 * the caller decides how to react to a non-zero `status` (see {@link stage}).
 */
function run(cmd, args, opts = {}) {
  const { cwd = repoRoot, stdio = 'pipe', env } = opts;
  const result = spawnSync(cmd, args, { cwd, stdio, env, encoding: 'utf8' });
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

/**
 * Run one named stage of the smoke test. Prints `[release-smoke] <label> ...`
 * then `OK` or `FAIL`. On failure, prints the captured output and exits
 * non-zero with a clear message. Returns whatever `fn` returns.
 */
function stage(label, fn) {
  process.stdout.write(`[release-smoke] ${label} ... `);
  try {
    const out = fn();
  process.stdout.write('OK\n');
    return out;
  } catch (err) {
    process.stdout.write('FAIL\n');
    const msg = err && err.message ? err.message : String(err);
    if (err && err.detail) {
      process.stdout.write(err.detail);
      if (!err.detail.endsWith('\n')) process.stdout.write('\n');
    }
    console.error(`[release-smoke] FAILED at stage "${label}": ${msg}`);
    process.exit(1);
  }
}

/** Build a failure error carrying captured command output for `stage` to print. */
function fail(message, detail) {
  const err = new Error(message);
  err.detail = detail;
  return err;
}

/** Write `file` under `dir`, creating any missing parent directories. */
function writeUnder(dir, file, content) {
  const full = join(dir, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

/**
 * Environment for nested `npm` calls with `dry-run` forced OFF.
 *
 * This smoke is wired into `prepublishOnly`, so on `npm publish` (and
 * `npm publish --dry-run`) npm sets `npm_config_dry_run=true` (and other
 * `npm_config_*` publish context) in the environment. A nested `npm pack` or
 * `npm install` INHERITS that and becomes a no-op dry-run — `npm pack` writes
 * no tarball, `npm install` writes no `node_modules` — which silently breaks
 * every stage. Force it back off so the nested commands do real work.
 */
function npmEnvForceReal() {
  return { ...process.env, npm_config_dry_run: 'false' };
}

// --- stage implementations -------------------------------------------------

/** 1. Fresh build so the tarball reflects current source. */
function doBuild() {
  const r = run('npm', ['run', 'build:dist'], { stdio: 'inherit' });
  if (r.status !== 0) {
    throw fail(
    `npm run build:dist exited ${r.status}`,
      'The dist build failed; see output above.',
    );
  }
}

/** 2. `npm pack` into `tmp`, returning the absolute path to the `.tgz`.
 *
 * `--ignore-scripts` is load-bearing: this smoke is wired into `prepublishOnly`,
 * so on `npm publish` it runs INSIDE the publish lifecycle. A nested bare
 * `npm pack` there re-enters the lifecycle chain (re-running `prepack`, and
 * under a publish command npm can route the tarball away from
 * `--pack-destination`, leaving zero tarballs in `tmp`). The dist is already
 * built by the `build:dist` stage above, so skipping scripts here is correct
 * and breaks the recursion. We then tolerate the tarball landing in either
 * `--pack-destination` (preferred) or the repo root (npm's fallback), moving it
 * into `tmp` so cleanup stays contained. */
function doPack(tmp) {
  const r = run('npm', ['pack', '--ignore-scripts', '--pack-destination', tmp], {
    env: npmEnvForceReal(),
  });
  if (r.status !== 0) {
    throw fail(
      `npm pack exited ${r.status}`,
      `stderr:\n${r.stderr}`,
    );
  }
  // Preferred: `--pack-destination` honored → the tarball is already in `tmp`.
  let tgz = readdirSync(tmp)
    .filter((f) => /^aicraft-engine-.*\.tgz$/.test(f))
    .map((f) => join(tmp, f));
  // Fallback: under some publish contexts `--pack-destination` is not honored
  // and npm writes the tarball to the repo root, printing its name to stdout.
  if (tgz.length === 0) {
    const name = r.stdout
      .split('\n')
      .map((s) => s.trim())
      .find((s) => /^aicraft-engine-.*\.tgz$/.test(s));
    if (name) {
      const fromRepo = join(repoRoot, name);
      const intoTmp = join(tmp, name);
      try {
        renameSync(fromRepo, intoTmp);
        tgz = [intoTmp];
      } catch {
        // Leave `tgz` empty; the count check below fails with a clear message.
      }
    }
  }
  if (tgz.length !== 1) {
    throw fail(
      `expected exactly 1 aicraft-engine tgz, found ${tgz.length}`,
      `found: ${tgz.join(', ') || '(none)'}`,
    );
  }
  return tgz[0];
}

/**
 * 3 + 6. Node ESM consumer + deterministic platformer probe.
 *
 * Installs the tarball into a fresh `"type":"module"` project, imports the
 * barrel, prints + asserts a large export count, exercises the named exports
 * the Celerock brief named (`createGameLoop`, `stepPlatformer`,
 * `scalePlatformerConfig`, `IDLE_EDGE`, `solidIdForEntity`), and runs a flat-
 * floor platformer simulation asserting the state stays finite and the player
 * rests (no NaN). Returns the printed key count.
 */
function doNodeConsumer(tmp, tgz) {
  const dir = join(tmp, 'node-consumer');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'ae-release-smoke-node',
        private: true,
        type: 'module',
        dependencies: { 'aicraft-engine': `file:${relative(dir, tgz)}` },
      },
      null,
      2,
    ) + '\n',
  );

  // The consumer script. Pure Node ESM. Throws (→ non-zero exit) on any
  // assertion failure so `node import.mjs` failing is the failure signal.
  writeFileSync(
    join(dir, 'import.mjs'),
    `import assert from 'node:assert/strict';
import {
  createGameLoop,
  stepPlatformer,
  scalePlatformerConfig,
  createPlatformerState,
  IDLE_EDGE,
  solidIdForEntity,
  PRECISION_PLATFORMER,
} from 'aicraft-engine';

// (3) Barrel is importable and re-exports a large surface.
const keys = Object.keys(await import('aicraft-engine')).length;
assert.ok(keys >= 100, \`expected >=100 exports, got \${keys}\`);
console.log('NODE EXPORTS: %s keys', keys);

// Exercise the named exports so a missing / renamed export fails loudly.
assert.equal(solidIdForEntity(7), 'entity-7');
assert.deepEqual(IDLE_EDGE, { held: false, pressed: false, released: false });
// scale=1 is the documented identity invariant for distance fields.
assert.equal(
  scalePlatformerConfig(PRECISION_PLATFORMER, 1).moveSpeed,
  PRECISION_PLATFORMER.moveSpeed,
);

// Defensive game-loop handle: safe to construct in Node (no rAF); never throws.
const loop = createGameLoop({ fixedDt: 1 / 60, step: () => {}, render: () => {} });
assert.equal(loop.isRunning(), false);
assert.equal(loop.lastError, null);
loop.dispose();

// (6) Deterministic platformer probe on a flat floor.
const config = scalePlatformerConfig(PRECISION_PLATFORMER, 2); // 32px tiles
const floorY = 200;
const solids = [
  { x: -5000, y: floorY, width: 100000, height: 1000, id: solidIdForEntity(0) },
];
const input = { moveX: 0, moveY: 0, jump: IDLE_EDGE, dash: IDLE_EDGE, grab: IDLE_EDGE };
const dt = 1 / 60;
let state = createPlatformerState(100, floorY - 1000, config);
for (let i = 0; i < 300; i++) state = stepPlatformer(state, input, solids, dt, config).state;
const c = state.core;
const finite = [c.x, c.y, c.vx, c.vy].every(Number.isFinite);
const resting = c.onGround === true && Math.abs(c.vy) < 1e-6;
assert.ok(finite, \`non-finite state: \${JSON.stringify({ x: c.x, y: c.y, vx: c.vx, vy: c.vy })}\`);
assert.ok(resting, \`player did not rest: \${JSON.stringify({ y: c.y, vy: c.vy, onGround: c.onGround })}\`);
console.log('PROBE OK: player rests at y=%s (vy=%s, onGround=%s)', c.y.toFixed(3), c.vy, c.onGround);
`,
  );

  const install = run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', env: npmEnvForceReal() });
  if (install.status !== 0) {
    throw fail(`consumer npm install exited ${install.status}`, 'see output above');
  }
  const runNode = run('node', ['import.mjs'], { cwd: dir, stdio: 'inherit' });
  if (runNode.status !== 0) {
    throw fail(`node import.mjs exited ${runNode.status}`, 'see output above');
  }
}

/**
 * 4. NodeNext typecheck with skipLibCheck:false (the TS2846 / .d.ts specifier
 * regression guard).
 *
 * The consumer `.ts` has BOTH a value import and a type import from
 * `aicraft-engine`; `tsc --noEmit` must report 0 errors. The repo's own
 * `tsconfig.json` has `skipLibCheck:true`, which masks declaration-file
 * specifier bugs — this stage typechecks the SHIPPED `.d.ts` with
 * `skipLibCheck:false` under NodeNext so any regression fails the release.
 */
function doTypecheckConsumer(tmp, tgz) {
  const dir = join(tmp, 'typecheck-consumer');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'ae-release-smoke-typecheck',
        private: true,
        type: 'module',
        dependencies: { 'aicraft-engine': `file:${relative(dir, tgz)}` },
      },
      null,
      2,
    ) + '\n',
  );

  // Value import + type import — the combination that surfaces TS2846 when a
  // `.d.ts` uses a bad relative specifier under NodeNext resolution.
  writeFileSync(
    join(dir, 'consumer.ts'),
    `import {
  createGameLoop,
  stepPlatformer,
  scalePlatformerConfig,
  createPlatformerState,
  IDLE_EDGE,
  solidIdForEntity,
  PRECISION_PLATFORMER,
} from 'aicraft-engine';
import type { GameLoop, PlatformerState, PlatformerInput, Solid } from 'aicraft-engine';

const loop: GameLoop = createGameLoop({
  fixedDt: 1 / 60,
  step: () => {},
  render: () => {},
});
loop.dispose();

const config = scalePlatformerConfig(PRECISION_PLATFORMER, 1);
const solids: Solid[] = [{ x: 0, y: 200, width: 10000, height: 100, id: solidIdForEntity(0) }];
let state: PlatformerState = createPlatformerState(100, 100, config);
const input: PlatformerInput = {
  moveX: 0,
  moveY: 0,
  jump: IDLE_EDGE,
  dash: IDLE_EDGE,
  grab: IDLE_EDGE,
};
for (let i = 0; i < 120; i++) {
  state = stepPlatformer(state, input, solids, 1 / 60, config).state;
}
void state;
`,
  );

  // NodeNext + skipLibCheck:false is the WHOLE point — do not relax these.
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2021',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          skipLibCheck: false,
          strict: true,
          noEmit: true,
          lib: ['ES2021', 'DOM', 'DOM.Iterable'],
        },
        include: ['consumer.ts'],
      },
      null,
      2,
    ) + '\n',
  );

  const install = run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', env: npmEnvForceReal() });
  if (install.status !== 0) {
    throw fail(`typecheck consumer npm install exited ${install.status}`, 'see output above');
  }

  // Use the repo's own tsc (a devDep here) so no extra toolchain dep is needed.
  // Run with cwd = consumer dir so resolution starts from the consumer's
  // node_modules (the installed tarball), not the repo source.
  const tscBin = join(repoRoot, 'node_modules', 'typescript', 'lib', 'tsc.js');
  const r = run('node', [tscBin, '-p', 'tsconfig.json'], { cwd: dir });
  if (r.status !== 0) {
    throw fail(`tsc exited ${r.status} (expected 0 errors)`, `tsc output:\n${r.stdout}${r.stderr}`);
  }
  console.log('[release-smoke] tsc: 0 errors (NodeNext, skipLibCheck:false)');
}

/**
 * 5. Minimal Vite consumer: bundle a TypeScript entry that imports the package.
 *
 * `npm create vite` is interactive, so the project is hand-authored. Vite is
 * run from the repo's installed binary (already a devDep); the consumer's own
 * node_modules holds only the installed tarball, so the package is resolved
 * exactly as a real bundler consumer would resolve it.
 */
function doViteConsumer(tmp, tgz) {
  const dir = join(tmp, 'vite-consumer');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'ae-release-smoke-vite',
        private: true,
        type: 'module',
        dependencies: { 'aicraft-engine': `file:${relative(dir, tgz)}` },
      },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(
    join(dir, 'index.html'),
    [
      '<!doctype html>',
      '<html lang="en">',
      '<head><meta charset="utf-8" /><title>ae vite smoke</title></head>',
      '<body>',
      '  <div id="app"></div>',
      '  <script type="module" src="/src/main.ts"></script>',
      '</body>',
      '</html>',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'src', 'main.ts'),
    `import {
  createPlatformerState,
  stepPlatformer,
  IDLE_EDGE,
  solidIdForEntity,
  PRECISION_PLATFORMER,
} from 'aicraft-engine';

const solids = [{ x: 0, y: 200, width: 10000, height: 100, id: solidIdForEntity(0) }];
let s = createPlatformerState(10, 10, PRECISION_PLATFORMER);
for (let i = 0; i < 10; i++) {
  s = stepPlatformer(s, { moveX: 0, jump: IDLE_EDGE, dash: IDLE_EDGE }, solids, 1 / 60).state;
}
const el = document.getElementById('app');
if (el) el.textContent = 'y=' + s.core.y.toFixed(1);
`,
  );

  const install = run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', env: npmEnvForceReal() });
  if (install.status !== 0) {
    throw fail(`vite consumer npm install exited ${install.status}`, 'see output above');
  }

  const viteBin = join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const r = run('node', [viteBin, 'build'], { cwd: dir, stdio: 'inherit' });
  if (r.status !== 0) {
    throw fail(`vite build exited ${r.status}`, 'see output above');
  }
  console.log('[release-smoke] vite build: success');
}

// --- entry point -----------------------------------------------------------

function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'ae-release-smoke-'));
  console.log(`[release-smoke] temp dir: ${tmp}`);
  try {
    stage('build:dist', doBuild);
    const tgz = stage('npm pack', () => doPack(tmp));
    console.log(`[release-smoke] tarball:  ${tgz}`);
    stage('node ESM consumer + platformer probe', () => doNodeConsumer(tmp, tgz));
    stage('NodeNext typecheck (skipLibCheck:false)', () => doTypecheckConsumer(tmp, tgz));
    stage('vite consumer build', () => doViteConsumer(tmp, tgz));
    console.log('[release-smoke] ALL STAGES PASSED');
  } finally {
    if (keepTmp) {
      console.log(`[release-smoke] keeping temp dir (AE_RELEASE_SMOKE_KEEP=1): ${tmp}`);
    } else {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

main();
