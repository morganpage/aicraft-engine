/**
 * Async LDtk asset loader — high-level fetch + decode + bundle pipeline.
 *
 * Wraps {@link parseLdtkProject} (parse), defensive tileset image decode, and
 * {@link buildLdtkTilesetBundle} (bundle) so consumers don't reimplement image
 * timeouts, URL encoding, or skip-icon logic. The whole point of this module
 * is the real-world boot bug where a raw `base + relPath` string concat
 * produced a URL containing raw spaces / `[` `]` / Unicode in the filename and
 * hung the game's startup fetch forever.
 *
 * Isomorphism / defensive host access (mirrors the engine's adapter pattern —
 * see `src/primitives/dpr.ts`, `src/game-loop/fixed-step.ts`):
 *  - All host APIs (`fetch`, `Image`, `createImageBitmap`, `Blob`, `URL`) are
 *    resolved LAZILY and defensively at call time, never at module load. The
 *    module imports cleanly under Node, browsers, SSR, and workers.
 *  - `fetch` and `decodeImage` are injectable so a Node test can drive the
 *    whole pipeline with stubs and zero real DOM.
 *  - Every I/O (project fetch, tileset fetch, decode) is wrapped in a bounded
 *    timeout (`imageTimeoutMs`): a hung host NEVER hangs the loader.
 *  - **Never throws.** Any failure becomes a diagnostic; a missing OPTIONAL
 *    tileset degrades to a warning and the boot continues.
 *
 * Determinism note: HOST-TOUCHING, NOT deterministic (it performs network /
 * decode I/O). Determinism of the *decode pipeline* is irrelevant to the sim
 * (the result is plain image handles, passed into render code as parameters).
 *
 * @module
 */

import type { LdtkTilesetDef } from './types';
import type { LdtkProject } from './types';
import { parseLdtkProject } from './parse';
import { buildLdtkTilesetBundle } from './render';
import type { LdtkTilesetBundle } from './render';

/** Default per-asset I/O timeout (fetch + decode): 5 seconds. */
export const DEFAULT_IMAGE_TIMEOUT_MS = 5000;

/**
 * Options for {@link loadLdtkProjectAssets}.
 */
export interface LoadLdtkProjectAssetsOptions {
  /** URL of the `.ldtk` project JSON. */
  readonly projectUrl: string | URL;
  /**
   * Base URL tileset `relPath`s resolve against. Defaults to the project
   * file's own directory (LDtk `relPath`s are relative to the project file).
   * Resolution uses standard URL semantics, so a trailing slash matters when
   * the path is treated as a directory.
   */
  readonly assetBaseUrl?: string | URL;
  /**
   * Per-asset I/O timeout in milliseconds, applied to the project fetch, each
   * tileset fetch, AND each image decode. Default {@link DEFAULT_IMAGE_TIMEOUT_MS}.
   * A hung host call is abandoned after this elapsed — boot never hangs.
   */
  readonly imageTimeoutMs?: number;
  /**
   * Injectable `fetch` (testability / Node). Defaults to `globalThis.fetch`.
   * If neither is available the loader fails fast with an error diagnostic.
   */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Injectable image decoder. Receives the raw PNG bytes and the tileset def;
   * returns a drawable {@link CanvasImageSource}, or `undefined` / a rejection
   * on failure. The default prefers `createImageBitmap(new Blob([bytes]))` and
   * falls back to `new Image()` + object URL + `decode()`.
   */
  readonly decodeImage?: (
    bytes: Uint8Array,
    def: LdtkTilesetDef,
  ) => Promise<CanvasImageSource | undefined>;
}

/** Severity for an asset-loading diagnostic. */
export type LdtkAssetDiagnosticSeverity = 'error' | 'warning' | 'info';

/** A single asset-loading diagnostic. */
export interface LdtkAssetDiagnostic {
  readonly severity: LdtkAssetDiagnosticSeverity;
  /** Tileset uid the diagnostic concerns, when applicable. */
  readonly tilesetUid?: number;
  /** Tileset relPath the diagnostic concerns, when applicable. */
  readonly relPath?: string;
  /** Human-readable description. */
  readonly message: string;
}

/** Success result of {@link loadLdtkProjectAssets}. */
export interface LoadLdtkProjectAssetsOk {
  readonly ok: true;
  readonly project: LdtkProject;
  readonly tilesets: LdtkTilesetBundle;
  readonly diagnostics: readonly LdtkAssetDiagnostic[];
}

/** Failure result of {@link loadLdtkProjectAssets}. */
export interface LoadLdtkProjectAssetsErr {
  readonly ok: false;
  readonly diagnostics: readonly LdtkAssetDiagnostic[];
}

/** Outcome of {@link loadLdtkProjectAssets}. */
export type LoadLdtkProjectAssetsResult = LoadLdtkProjectAssetsOk | LoadLdtkProjectAssetsErr;

/** Outcome of a bounded race between a promise and a timer. */
interface RaceOutcome<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly timedOut: boolean;
  readonly error?: unknown;
}

/**
 * Race `work` against a `ms` timeout. NEVER hangs, NEVER rejects. On timeout
 * resolves `{ ok: false, timedOut: true }`; on rejection
 * `{ ok: false, timedOut: false, error }`; on resolve `{ ok: true, value }`.
 *
 * A non-positive `ms` disables the timer (the work still settles naturally),
 * which keeps the loader usable in environments without `setTimeout`.
 */
function raceWithTimeout<T>(work: Promise<T>, ms: number): Promise<RaceOutcome<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: RaceOutcome<T>): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    if (!(ms > 0)) {
      work.then(
        (value) => finish({ ok: true, value, timedOut: false }),
        (error) => finish({ ok: false, timedOut: false, error }),
      );
      return;
    }
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => finish({ ok: false, timedOut: true }),
      ms,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        finish({ ok: true, value, timedOut: false });
      },
      (error) => {
        clearTimeout(timer);
        finish({ ok: false, timedOut: false, error });
      },
    );
  });
}

/** Lazily read `globalThis.fetch`, or `undefined` if absent/unreadable. */
function getGlobalFetch(): typeof globalThis.fetch | undefined {
  try {
    const f = globalThis.fetch;
    return typeof f === 'function' ? f : undefined;
  } catch {
    return undefined;
  }
}

/** Message extracted from an unknown rejection reason. */
function errMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return 'unknown error';
  }
}

/**
 * Fully percent-encode each segment of a URL pathname.
 *
 * WHATWG URL parsing encodes spaces (`%20`) but leaves `[`, `]`, and a few
 * other reserved characters RAW in the pathname — and a raw-bracket URL is
 * precisely what hung boot in real Celerock builds. Decode-then-encode each
 * segment is idempotent (already-encoded `%5B` decodes to `[` then re-encodes
 * to `%5B`), so it normalizes both raw and pre-encoded paths to a safe form.
 */
function encodePathSegments(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => {
      if (seg === '') return '';
      try {
        return encodeURIComponent(decodeURIComponent(seg));
      } catch {
        return seg;
      }
    })
    .join('/');
}

/**
 * Resolve a tileset `relPath` against `base`, returning a URL whose pathname
 * is fully percent-encoded (spaces, brackets, Unicode). Returns `undefined`
 * if the combination is unresolvable.
 */
function resolveAssetUrl(relPath: string, base: URL): URL | undefined {
  try {
    const resolved = new URL(relPath, base);
    resolved.pathname = encodePathSegments(resolved.pathname);
    return resolved;
  } catch {
    return undefined;
  }
}

/**
 * Default image decoder: prefer `createImageBitmap`, fall back to `Image`.
 *
 * Returns `undefined` (resolves, never rejects) when no usable host API is
 * present — e.g. plain Node without a DOM, where neither `createImageBitmap`
 * nor `Image` exist. A caller that needs images under Node must inject
 * `options.decodeImage`.
 */
async function defaultDecodeImage(bytes: Uint8Array): Promise<CanvasImageSource | undefined> {
  // 1. createImageBitmap (browsers; some Bun/Node-with-canvas runtimes).
  try {
    const BlobCtor = globalThis.Blob;
    const createImageBitmapFn = globalThis.createImageBitmap;
    if (typeof BlobCtor === 'function' && typeof createImageBitmapFn === 'function') {
      const blob = new BlobCtor([bytes as unknown as BlobPart]);
      const bitmap = await createImageBitmapFn(blob);
      return bitmap as unknown as CanvasImageSource;
    }
  } catch {
    // Fall through to the Image path.
  }
  // 2. HTMLImageElement + object URL + decode().
  return decodeViaImage(bytes);
}

/** `Image` + object-URL decode path. Resolves `undefined` if `Image` is absent. */
function decodeViaImage(bytes: Uint8Array): Promise<CanvasImageSource | undefined> {
  return new Promise((resolve) => {
    let ImageCtor: typeof Image | undefined;
    let BlobCtor: typeof Blob | undefined;
    let createObjectURL: ((obj: Blob) => string) | undefined;
    let revokeObjectURL: ((url: string) => void) | undefined;
    try {
      ImageCtor = typeof globalThis.Image === 'function' ? globalThis.Image : undefined;
      BlobCtor = typeof globalThis.Blob === 'function' ? globalThis.Blob : undefined;
      const urlApi = globalThis.URL;
      if (urlApi !== undefined) {
        createObjectURL =
          typeof urlApi.createObjectURL === 'function' ? urlApi.createObjectURL : undefined;
        revokeObjectURL =
          typeof urlApi.revokeObjectURL === 'function' ? urlApi.revokeObjectURL : undefined;
      }
    } catch {
      // Swallow — treat unreadable host APIs as absent.
    }
    if (ImageCtor === undefined || BlobCtor === undefined || createObjectURL === undefined) {
      resolve(undefined);
      return;
    }
    let url = '';
    try {
      const blob = new BlobCtor([bytes as unknown as BlobPart]);
      url = createObjectURL(blob);
      const img = new ImageCtor();
      let done = false;
      const finish = (value: CanvasImageSource | undefined): void => {
        if (done) return;
        done = true;
        try {
          if (url !== '' && revokeObjectURL !== undefined) revokeObjectURL(url);
        } catch {
          // Swallow — cleanup must not throw.
        }
        resolve(value);
      };
      img.onload = (): void => finish(img as unknown as CanvasImageSource);
      img.onerror = (): void => finish(undefined);
      img.src = url;
      // Prefer the modern decode() promise when present (forces decode before
      // first draw); onload/onerror remain the universal safety net.
      const decode = (img as HTMLImageElement & { decode?: () => Promise<void> }).decode;
      if (typeof decode === 'function') {
        try {
          decode
            .call(img)
            .then(() => finish(img as unknown as CanvasImageSource), () => finish(undefined));
        } catch {
          // onload/onerror will still settle.
        }
      }
    } catch {
      resolve(undefined);
    }
  });
}

/** Outcome of a bounded text/bytes fetch. */
type FetchOutcome =
  | { readonly ok: true; readonly text?: string; readonly bytes?: Uint8Array }
  | { readonly ok: false; readonly message: string };

/** Bounded fetch reading the body as UTF-8 text. */
async function fetchAsText(
  fetchImpl: typeof globalThis.fetch,
  url: URL,
  timeoutMs: number,
): Promise<FetchOutcome> {
  const work = fetchImpl(url).then(async (resp): Promise<string> => {
    if (!resp.ok) throw new Error(`HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`);
    return resp.text();
  });
  const r = await raceWithTimeout(work, timeoutMs);
  if (r.ok && r.value !== undefined) return { ok: true, text: r.value };
  return {
    ok: false,
    message: r.timedOut ? `timed out after ${timeoutMs}ms` : errMessage(r.error),
  };
}

/** Bounded fetch reading the body as raw bytes. */
async function fetchAsBytes(
  fetchImpl: typeof globalThis.fetch,
  url: URL,
  timeoutMs: number,
): Promise<FetchOutcome> {
  const work = fetchImpl(url).then(async (resp): Promise<Uint8Array> => {
    if (!resp.ok) throw new Error(`HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`);
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  });
  const r = await raceWithTimeout(work, timeoutMs);
  if (r.ok && r.value !== undefined) return { ok: true, bytes: r.value };
  return {
    ok: false,
    message: r.timedOut ? `timed out after ${timeoutMs}ms` : errMessage(r.error),
  };
}

/**
 * Load a `.ldtk` project and all its drawable tilesets.
 *
 * Fetches the project JSON (via injected `fetch` or `globalThis.fetch`),
 * parses it with {@link parseLdtkProject}, then for each tileset def fetches
 * its PNG bytes and decodes an image (via injected `decodeImage` or the
 * default `createImageBitmap` / `Image` path). Every fetch + decode is
 * bounded by `imageTimeoutMs`; failures on OPTIONAL tilesets become warnings
 * and the load continues. Finally builds a {@link LdtkTilesetBundle} via the
 * synchronous {@link buildLdtkTilesetBundle}.
 *
 * URL encoding: tileset `relPath`s are resolved against `assetBaseUrl` (or the
 * project file's directory) through `new URL`, then every pathname segment is
 * fully percent-encoded — so spaces, `[` `]`, and Unicode in filenames become
 * `%20` / `%5B` / `%5D` / etc. A raw-bracket URL is what hung boot in real
 * builds; this normalization is the fix.
 *
 * **Never throws.** Returns `{ ok: false, diagnostics }` on:
 *  - no usable `fetch`,
 *  - project fetch / parse failure,
 *  - zero drawable (non-icon) tilesets decoded when at least one was a candidate.
 *
 * @param options - See {@link LoadLdtkProjectAssetsOptions}.
 * @returns A {@link LoadLdtkProjectAssetsResult}.
 *
 * @example
 * ```ts
 * const result = await loadLdtkProjectAssets({ projectUrl: '/levels/game.ldtk' });
 * if (!result.ok) { console.warn(result.diagnostics); return; }
 * for (const level of result.project.levels) drawLdtkLevel(ctx, level, { tilesets: result.tilesets });
 * ```
 */
export async function loadLdtkProjectAssets(
  options: Readonly<LoadLdtkProjectAssetsOptions>,
): Promise<LoadLdtkProjectAssetsResult> {
  const diagnostics: LdtkAssetDiagnostic[] = [];
  const timeoutMs =
    typeof options.imageTimeoutMs === 'number' && options.imageTimeoutMs > 0
      ? options.imageTimeoutMs
      : DEFAULT_IMAGE_TIMEOUT_MS;

  // --- Resolve host fetch (lazy, defensive). ---
  const fetchImpl = options.fetch ?? getGlobalFetch();
  if (fetchImpl === undefined) {
    diagnostics.push({
      severity: 'error',
      message:
        'no fetch implementation available; provide options.fetch or run in an environment with globalThis.fetch',
    });
    return { ok: false, diagnostics };
  }

  // --- Resolve project URL + asset base URL. ---
  let projectUrl: URL;
  try {
    projectUrl = new URL(options.projectUrl);
  } catch {
    diagnostics.push({
      severity: 'error',
      message: `invalid projectUrl: ${String(options.projectUrl)}`,
    });
    return { ok: false, diagnostics };
  }
  let base: URL = projectUrl;
  if (options.assetBaseUrl !== undefined) {
    try {
      base = new URL(options.assetBaseUrl);
    } catch {
      // Fall back to the project URL's directory.
    }
  }

  // --- Fetch + parse the project JSON (bounded). ---
  const projectFetch = await fetchAsText(fetchImpl, projectUrl, timeoutMs);
  if (!projectFetch.ok) {
    diagnostics.push({
      severity: 'error',
      message: `failed to fetch project: ${projectFetch.message}`,
    });
    return { ok: false, diagnostics };
  }
  if (projectFetch.text === undefined) {
    diagnostics.push({
      severity: 'error',
      message: 'project fetch returned an empty body',
    });
    return { ok: false, diagnostics };
  }
  const parsed = parseLdtkProject(projectFetch.text);
  if (!parsed.ok || parsed.project === undefined) {
    for (const e of parsed.errors) {
      diagnostics.push({
        severity: e.severity === 'error' ? 'error' : 'warning',
        message: `parse ${e.path}: ${e.message}`,
      });
    }
    if (!diagnostics.some((d) => d.severity === 'error')) {
      diagnostics.push({ severity: 'error', message: 'project parse failed' });
    }
    return { ok: false, diagnostics };
  }
  const project = parsed.project;
  for (const e of parsed.errors) {
    diagnostics.push({
      severity: e.severity === 'error' ? 'error' : 'info',
      message: `parse ${e.path}: ${e.message}`,
    });
  }

  // --- Decode each candidate tileset (bounded fetch + bounded decode). ---
  const decodeImage = options.decodeImage ?? defaultDecodeImage;
  const imageByUid = new Map<number, CanvasImageSource>();
  let candidateCount = 0;
  for (const def of project.defs.tilesets) {
    if (def.embedAtlas === 'LdtkIcons') continue; // editor-only icon atlas
    if (def.relPath === null || def.relPath === '') continue;
    candidateCount++;

    const url = resolveAssetUrl(def.relPath, base);
    if (url === undefined) {
      diagnostics.push({
        severity: 'warning',
        tilesetUid: def.uid,
        relPath: def.relPath,
        message: `could not resolve tileset relPath ${JSON.stringify(def.relPath)}`,
      });
      continue;
    }

    // Fetch bytes.
    const fetched = await fetchAsBytes(fetchImpl, url, timeoutMs);
    if (!fetched.ok) {
      diagnostics.push({
        severity: 'warning',
        tilesetUid: def.uid,
        relPath: def.relPath,
        message: `tileset fetch failed: ${fetched.message}`,
      });
      continue;
    }
    if (fetched.bytes === undefined) {
      diagnostics.push({
        severity: 'warning',
        tilesetUid: def.uid,
        relPath: def.relPath,
        message: 'tileset fetch returned an empty body',
      });
      continue;
    }

    // Decode image (bounded).
    const decoded = await raceWithTimeout(decodeImage(fetched.bytes, def), timeoutMs);
    if (!decoded.ok || decoded.value === undefined) {
      diagnostics.push({
        severity: 'warning',
        tilesetUid: def.uid,
        relPath: def.relPath,
        message: decoded.timedOut
          ? `tileset decode timed out after ${timeoutMs}ms`
          : `tileset decode failed: ${errMessage(decoded.error)}`,
      });
      continue;
    }

    imageByUid.set(def.uid, decoded.value);
  }

  // --- Build the bundle via the existing synchronous builder. ---
  const tilesets = buildLdtkTilesetBundle(
    project.defs.tilesets,
    (def) => imageByUid.get(def.uid),
  );

  if (candidateCount === 0) {
    diagnostics.push({
      severity: 'info',
      message: 'project defines no drawable tilesets; bundle is empty',
    });
    return { ok: true, project, tilesets, diagnostics };
  }
  if (imageByUid.size === 0) {
    diagnostics.push({
      severity: 'error',
      message: 'no drawable tileset decoded successfully',
    });
    return { ok: false, diagnostics };
  }
  return { ok: true, project, tilesets, diagnostics };
}
