/**
 * The §13 capture scenes — one scene per gate shot, grown stage by stage.
 * Ships with the scaffold with the scenes the graybox already supports; the
 * manifest it must ultimately satisfy is gate/gates.ts's GATE_SHOTS (parsed
 * here so the two can never drift). Captures may GROW, never shrink.
 *
 *   node scripts/capture.mjs            # all scenes
 *   node scripts/capture.mjs menu       # one scene
 *
 * Conventions the 2026-08-27 run earned the hard way:
 *   - Positioning assists place the player via window.__celerock; every
 *     mechanic (transitions, pickups, death, the block) then runs through
 *     the REAL sim + input.
 *   - NEVER replace game.session when placing (a plain object kills the loop
 *     in three ticks — pollRoomTransition throws on the malformed detector).
 *     Placement-only edits are safe: the detector latch re-derives per poll.
 *   - Falling-block capture: RIDE the block (place on its authored top), do
 *     not dodge — the ledge has pits both sides and a death re-idles the room.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame, screenshot as shot, pressKey, holdKey, litFraction } from './qa.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The manifest gate/gates.ts requires — parsed, so this file can't drift. */
function gateShots() {
  const text = readFileSync(join(ROOT, 'gate/gates.ts'), 'utf8');
  const block = text.slice(text.indexOf('GATE_SHOTS'), text.indexOf('];', text.indexOf('GATE_SHOTS')));
  return [...block.matchAll(/'([^']+)'\s*(?:,|\/\/)/g)].map((m) => m[1]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const key = (page, code, down = true) =>
  page.evaluate(({ c, d }) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c, key: c, bubbles: true })), { c: code, d: down });
async function tap(page, code, ms = 60) { await key(page, code, true); await sleep(ms); await key(page, code, false); }

/**
 * Place the body (positioning assist; the sim keeps running). Stage 2+:
 * extend with { room } to switch the active room — via the room cache, never
 * by mutating session state.
 */
async function place(page, x, y, vx = 0) {
  await page.evaluate(({ x, y, vx }) => {
    const g = window.__celerock;
    if (!g) return;
    g.player = { ...g.player, core: { ...g.player.core, x, y, vx, vy: 0 } };
  }, { x, y, vx });
  await sleep(120);
}

const SCENES = {
  /** The menu state at boot — clean storage, NEW GAME only. */
  async menu() {
    const { browser, page } = await openGame();
    await sleep(600);
    await shot(page, '01-menu.png');
    await browser.close();
  },

  /** The graybox room renders — the Stage-1 lit-fraction probe as a capture. */
  async boot() {
    const { browser, page } = await openGame();
    const lit = await litFraction(page);
    await shot(page, 'boot.png');
    console.log(`lit fraction: ${lit.toFixed(3)}`);
    await browser.close();
  },

  /**
   * The resolution/letterbox set (§13 gate 10 — the shots the manifest does
   * NOT name; extra files are never offenders, a missing mask IS).
   */
  async resolutions() {
    const sizes = [
      ['19-res-16x9.png', 960, 540, 1],
      ['19-res-16x10.png', 960, 600, 1],
      ['19-res-4x3.png', 720, 540, 1],
      ['19-res-ultrawide.png', 1280, 540, 1],
      ['19-res-portrait.png', 405, 720, 1],
      ['19b-res-dpr2.png', 960, 540, 2],
    ];
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    for (const [name, width, height, dpr] of sizes) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
      await page.goto((process.env.QA_URL ?? 'http://localhost:5199'), { waitUntil: 'load' });
      await page.waitForFunction(() => {
        const canvas = document.querySelector('#game');
        return canvas ? canvas.width > 1 : false;
      }, { timeout: 15_000 });
      await sleep(500);
      await page.screenshot({ path: `.qa/shots/${name}` });
      await page.close();
    }
    await browser.close();
  },
};

const which = process.argv[2] ?? 'all';
const names = which === 'all' ? Object.keys(SCENES) : [which];
if (names.length === 0) {
  console.error(`unknown scene: ${which} (have: ${Object.keys(SCENES).join(', ')})`);
  process.exit(2);
}
for (const name of names) {
  console.log(`scene ${name}…`);
  await SCENES[name]();
}
const have = gateShots();
console.log(`manifest requires ${have.length} shots — produce the rest as your stages unlock them.`);
