/**
 * The game-test harness (§12's preamble, pre-solved): the pieces every build
 * needs to drive GAME code under Node/Vitest — the two Node-host injections
 * the brief's loader needs, scripted input devices, and stub canvases.
 *
 * Ships with the scaffold because these were the 2026-08-27 run's first three
 * failed test cycles:
 *   1. `loadLdtkProjectAssets` REJECTS a relative projectUrl on a host with
 *      no `document.baseURI` — pass an absolute URL (TEST_PROJECT_URL).
 *   2. It needs `decodeImage(bytes, def)` injected on hosts with no bitmap
 *      decoder (stubDecodeImage returns a size-only fake — sim tests never
 *      read pixels).
 *   3. Single-tick moments outlive their tick under hit-stop (the kernel
 *      doesn't step while frozen) — count on kernel-step boundaries, i.e.
 *      when the player object identity changed.
 *
 * Stage 2+: extend `buildGame` to construct your Game (the starter's main.ts
 * grows a `createGame` export; pass `scriptedDevices(script)` as its devices,
 * `createMemorySaveStorage()` as its storage, and this file's recorder canvas).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PolledEdge } from 'aicraft-engine';
import { loadWorld, type WorldLoad } from '../src/ldtk';
import { stubCanvasWithRecorder, type RecordingContext2D } from '../src/recipes/game-test-harness';

/**
 * The devices' shape (Stage 2's src/input.ts owns the real one; this local
 * structural copy keeps the harness green against the Stage-1 scaffold).
 */
export interface InputDevicesLike {
  readonly keyboard: { poll(): Record<string, PolledEdge> };
  readonly gamepad: { poll(): Record<string, PolledEdge> };
  readonly touch: { poll(): unknown[] };
}

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PUBLIC = join(ROOT, 'public');

/** The projectUrl the tests hand the loader (absolute — Node has no baseURI). */
export const TEST_PROJECT_URL = 'http://test.local/celerock.ldtk';

/** A size-only image stub — sim/preflight tests never read pixels. */
export const stubDecodeImage = async (
  bytes: Uint8Array,
): Promise<CanvasImageSource | undefined> =>
  bytes.length > 0 ? ({ width: 1024, height: 1024 } as unknown as CanvasImageSource) : undefined;

/** A fetch whose URLs resolve against public/ on disk (Node host). */
export function fsFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input).split('?')[0];
    const base = url.endsWith('/') ? url.slice(0, -1) : url;
    const name = base.split('/').pop() ?? '';
    try {
      return new Response(readFileSync(join(PUBLIC, name)), { status: 200 });
    } catch {
      return new Response('', { status: 404 });
    }
  }) as unknown as typeof fetch;
}

/** Edge builders: `E.held`, `E.press` (this tick), `E.release`, `E.idle`. */
const edge = (held: boolean, pressed: boolean, released: boolean): PolledEdge => ({ held, pressed, released });
export const E = {
  idle: () => edge(false, false, false),
  held: () => edge(true, false, false),
  press: () => edge(true, true, false),
  release: () => edge(false, false, true),
};

/**
 * Devices whose keyboard poll() walks a script of per-tick edge maps. After
 * the script runs out the LAST frame repeats (a held key stays held). A
 * `press()` must NOT be the last frame if you don't want it re-pressing.
 */
export function scriptedDevices(script: ReadonlyArray<Record<string, PolledEdge>>): InputDevicesLike {
  let i = 0;
  const poll = (): Record<string, PolledEdge> => {
    if (i < script.length) return script[i++];
    return script.length > 0 ? script[script.length - 1] : {};
  };
  return { keyboard: { poll }, gamepad: { poll: () => ({}) }, touch: { poll: () => [] } };
}

let cachedWorld: WorldLoad | null = null;

/** The shared compiled world (one fs load per process — compiling is pure). */
export async function loadTestWorld(): Promise<WorldLoad> {
  if (!cachedWorld) {
    const world = await loadWorld({
      fetch: fsFetch(),
      projectUrl: TEST_PROJECT_URL,
      decodeImage: stubDecodeImage,
    });
    if (!world) throw new Error('test world failed to load — see diagnostics above');
    cachedWorld = world;
  }
  return cachedWorld;
}

export interface StubScene {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: RecordingContext2D & CanvasRenderingContext2D;
  readonly world: WorldLoad;
}

/** A stub canvas + the loaded world — the Stage-2 buildGame's ingredients. */
export async function stubScene(): Promise<StubScene> {
  const world = await loadTestWorld();
  const { canvas, ctx } = stubCanvasWithRecorder(960, 540);
  return { canvas, ctx, world };
}
