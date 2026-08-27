/**
 * The QA harness — headless Playwright against the dev server, with pixel
 * probes (pngjs). Ships with the scaffold because §13's captures and §14's
 * per-stage "headless screenshot" gates both need it, and the 2026-08-27
 * gauntlet run had to invent all of this mid-Stage-7.
 *
 * Library use (the capture scenes and your own probes import these):
 *   import { openGame, pressKey, holdKey, screenshot, countColor, litFraction,
 *            gameState, traverse } from './scripts/qa.mjs';
 * CLI use (a boot smoke):
 *   QA_LIBRARY=1 node scripts/qa.mjs boot   # …or add scenes to SCENARIOS below
 *
 * The game object is exposed at window.__celerock (add that line to boot —
 * one try/catch assign — the day you write src/main.ts's boot).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const BASE_URL = process.env.QA_URL ?? 'http://localhost:5199';
const SHOTS_DIR = '.qa/shots';

export async function ensureShotsDir() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
}

/** Launch a page at the game with a viewport (CSS px) and DPR. */
export async function openGame({ width = 960, height = 540, dpr = 1 } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: dpr,
  });
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[console.error]', msg.text());
  });
  await page.goto(BASE_URL, { waitUntil: 'load' });
  // Boot is async (LDtk + tileset fetch). Wait for a painted backing store.
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#game');
    return canvas ? canvas.width > 1 && canvas.height > 1 : false;
  }, { timeout: 15_000 });
  await page.waitForTimeout(350);
  return { browser, page };
}

/**
 * Dispatch a REAL KeyboardEvent with .code set. The game's map is
 * .code-based (§4.3): a tool whose synthetic presses omit .code silently
 * fails to drive the game and looks like a dead build. Playwright's own
 * keyboard.press sets .code — this explicit dispatch documents the contract
 * and works everywhere.
 */
export async function pressKey(page, code, { durationMs = 0 } = {}) {
  await page.evaluate(({ c }) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c, bubbles: true }));
  }, { c: code });
  if (durationMs > 0) await page.waitForTimeout(durationMs);
  await page.evaluate(({ c }) => {
    window.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: c, bubbles: true }));
  }, { c: code });
}

/**
 * HOLD a key. Variable jump height follows HOLD TIME (a 60 ms tap is a
 * minimum hop that cannot clear a full-tile step — hold jumps ~220 ms).
 */
export async function holdKey(page, code, durationMs) {
  await page.evaluate(({ c }) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c, bubbles: true }));
  }, { c: code });
  await page.waitForTimeout(durationMs);
  await page.evaluate(({ c }) => {
    window.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: c, bubbles: true }));
  }, { c: code });
}

export async function screenshot(page, name) {
  await ensureShotsDir();
  const file = path.join(SHOTS_DIR, name);
  await page.screenshot({ path: file });
  return file;
}

/** Count pixels whose RGBA is within tol of the target — THE probe. */
export async function countColor(page, { r, g, b }, tol = 24) {
  const png = PNG.sync.read(await page.screenshot());
  let n = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (
      Math.abs(png.data[i] - r) <= tol
      && Math.abs(png.data[i + 1] - g) <= tol
      && Math.abs(png.data[i + 2] - b) <= tol
    ) n += 1;
  }
  return n;
}

/** Fraction of pixels not near-black — "did anything render". */
export async function litFraction(page) {
  const png = PNG.sync.read(await page.screenshot());
  let lit = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i] + png.data[i + 1] + png.data[i + 2] > 45) lit += 1;
  }
  return lit / (png.width * png.height);
}

/** Read the live game object (window.__celerock — see the file header). */
export function gameState(page) {
  return page.evaluate(() => {
    const g = window.__celerock;
    if (!g) return null;
    const core = g.player?.core ?? g.state?.core;
    return {
      tick: g.tick,
      gameState: g.gameState?.current ?? null,
      room: g.active?.ldtkLevel?.identifier ?? null,
      x: core?.x ?? null,
      y: core?.y ?? null,
      vx: core?.vx ?? null,
      vy: core?.vy ?? null,
      onGround: core?.onGround ?? null,
      deaths: g.save?.deaths ?? null,
      gems: g.save ? Object.values(g.save.collectibles ?? {}).reduce((n, r) => n + r.collected.length, 0) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// The traversal bot — walks the mountain eastward with the real kernel.
// Hold right; jump on a cadence (HELD ~220 ms — see holdKey); dash when
// descending into a pit; wait out deaths (respawn is automatic). onEvent
// fires on room changes and mid-slide, so capture scenes can ride it.
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function traverse(page, { onEvent = async () => {}, maxMs = 180_000 } = {}) {
  const started = Date.now();
  const boot = await gameState(page);
  if (boot && boot.gameState === 'menu') {
    await pressKey(page, 'KeyC', { durationMs: 60 });
    await sleep(400);
  }
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true })));
  let lastRoom = boot?.room ?? null;
  let lastJump = 0;
  let capturedSlide = false;
  let last = boot;
  while (Date.now() - started < maxMs) {
    await sleep(80);
    const st = await gameState(page);
    if (!st) break;
    if (st.gameState !== 'playing' && st.gameState !== 'gameover') break;
    if (!capturedSlide && st.slideT !== null && st.slideT !== undefined) {
      // (extend gameState with slideT when you wire the session — Stage 3)
      capturedSlide = true;
      await onEvent('slide-mid', st, page);
    }
    if (st.room !== lastRoom) {
      lastRoom = st.room;
      await onEvent('room', st, page);
    }
    if (st.gameState === 'gameover') continue;
    const jumpDue = (st.tick ?? 0) - lastJump > 32;
    if (jumpDue) {
      lastJump = st.tick ?? 0;
      await holdKey(page, 'KeyC', 220);
    } else if (st.onGround === false && st.vy > 60) {
      await pressKey(page, 'KeyX', { durationMs: 30 }); // dash-save the gap
    }
    last = st;
  }
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true })));
  return last;
}

// ---------------------------------------------------------------------------
// CLI scenarios (grow these per stage; the capture scenes live alongside)
// ---------------------------------------------------------------------------
const SCENARIOS = {
  /** Any stage: the room renders — lit fraction probe + a capture. */
  async boot({ page }) {
    const lit = await litFraction(page);
    await screenshot(page, 'boot.png');
    return { lit };
  },
};

// CLI entry: run only when invoked as a script with a scenario argument.
const name = process.argv[2];
if (name !== undefined && process.env.QA_LIBRARY !== '1') {
  const scenario = SCENARIOS[name];
  if (!scenario) {
    console.error(`unknown scenario: ${name} (have: ${Object.keys(SCENARIOS).join(', ')})`);
    process.exit(2);
  }
  const { browser, page } = await openGame();
  try {
    const result = await scenario({ browser, page });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}
