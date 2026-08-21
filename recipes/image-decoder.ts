/** A minimal successful fetch response (structural — avoids the full `Response`). */
export interface DecodeFetchResult {
  readonly ok: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The `<img>`-shaped fallback host (structural — `HTMLImageElement` minus noise). */
export interface DecodeImageElement {
  src: string;
  decode(): Promise<void>;
}

/** Options for {@link decodeImageBounded} / {@link decodeImageBytesBounded}. */
export interface DecodeImageBoundedOptions {
  /** Abandon a hung host call after this many ms. Default 5000. */
  readonly timeoutMs?: number;
  /** Injectable fetcher for the URL path (tests stub it). Defaults to `globalThis.fetch`. */
  readonly fetch?: (url: string) => Promise<DecodeFetchResult>;
  /** Injectable bitmap host (tests stub it). Defaults to `globalThis.createImageBitmap`. */
  readonly createBitmap?: (blob: Blob) => Promise<CanvasImageSource | undefined>;
  /** Injectable `<img>` factory for the fallback path. Defaults to the DOM `Image`. */
  readonly createImageElement?: () => (DecodeImageElement & CanvasImageSource) | undefined;
}

const DEFAULT_TIMEOUT_MS = 5000;

/** An `<img>` element that is also drawable (the DOM's `HTMLImageElement` is both). */
type ImageElementLike = DecodeImageElement & CanvasImageSource;

/** Race a host promise against a timer — a hung decode never hangs boot.
 * Resolves the promise's value, or `undefined` on timeout/rejection. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    let settled = false;
    const finish = (value: T | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    promise.then((value) => finish(value), () => finish(undefined));
  });
}

function timeoutOf(options: Readonly<DecodeImageBoundedOptions>): number {
  return typeof options.timeoutMs === 'number' && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;
}

/** The ambient `createImageBitmap`, if the host exposes one. */
function ambientCreateBitmap(): ((blob: Blob) => Promise<CanvasImageSource>) | undefined {
  try {
    const host = (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    return typeof host === 'function' ? (host as (blob: Blob) => Promise<CanvasImageSource>) : undefined;
  } catch {
    return undefined;
  }
}

/** The ambient `new Image()` element, if the host exposes one. */
function ambientImageElement(): ImageElementLike | undefined {
  try {
    const imageCtor = (globalThis as { Image?: unknown }).Image;
    if (typeof imageCtor !== 'function') return undefined;
    const candidate = new (imageCtor as new () => unknown)() as Partial<ImageElementLike>;
    if (candidate === null || typeof candidate !== 'object') return undefined;
    return typeof candidate.decode === 'function' ? (candidate as ImageElementLike) : undefined;
  } catch {
    return undefined;
  }
}

/** The ambient object-URL API, if the host exposes both halves. */
function ambientObjectUrls(): { create: (blob: Blob) => string; revoke: (url: string) => void } | undefined {
  try {
    const urlCtor = (globalThis as { URL?: { createObjectURL?: unknown; revokeObjectURL?: unknown } }).URL;
    const create = urlCtor?.createObjectURL;
    const revoke = urlCtor?.revokeObjectURL;
    if (typeof create !== 'function' || typeof revoke !== 'function') return undefined;
    return {
      create: create as (blob: Blob) => string,
      revoke: revoke as (url: string) => void,
    };
  } catch {
    return undefined;
  }
}

/** The ambient `fetch`, narrowed to the structural fetcher this recipe needs. */
function ambientFetch(): ((url: string) => Promise<DecodeFetchResult>) | undefined {
  try {
    const host = (globalThis as { fetch?: unknown }).fetch;
    return typeof host === 'function' ? (host as (url: string) => Promise<DecodeFetchResult>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Decode already-fetched image BYTES to a drawable — bounded, never throwing.
 *
 * Prefers `createImageBitmap(new Blob([bytes]))`; falls back to `new Image()`
 * + object URL + `decode()`; resolves `undefined` when the host offers neither
 * path, when the decode hangs past `timeoutMs`, or when anything throws. A
 * missing or hostile host is a degrade, never a crash.
 *
 * This is the BYTES core. `loadLdtkProjectAssets`'s injectable
 * `decodeImage?: (bytes, tilesetDef) => …` can adopt it with a one-line wrap —
 * `decodeImage: (bytes) => decodeImageBytesBounded(bytes)` — ignoring the def.
 *
 * @param bytes - raw image bytes (`Uint8Array`, `ArrayBuffer`, or `Blob`)
 * @param options - timeout + injectable hosts (tests stub them)
 * @returns the decoded image, or `undefined` on any failure
 */
export async function decodeImageBytesBounded(
  bytes: Uint8Array | ArrayBuffer | Blob,
  options: Readonly<DecodeImageBoundedOptions> = {},
): Promise<CanvasImageSource | undefined> {
  const timeoutMs = timeoutOf(options);
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart]);

  const bitmapHost = options.createBitmap ?? ambientCreateBitmap();
  if (bitmapHost !== undefined) {
    try {
      const bitmap = await withTimeout(bitmapHost(blob), timeoutMs);
      if (bitmap !== undefined) return bitmap;
    } catch {
      // Fall through to the <img> path.
    }
  }

  const element = options.createImageElement?.() ?? ambientImageElement();
  const urlApi = ambientObjectUrls();
  if (element === undefined || urlApi === undefined) return undefined;
  let objectUrl: string | undefined;
  try {
    objectUrl = urlApi.create(blob);
    element.src = objectUrl;
    const decoded = await withTimeout(element.decode().then(() => true as const), timeoutMs);
    return decoded === true ? element : undefined;
  } catch {
    return undefined;
  } finally {
    if (objectUrl !== undefined) urlApi.revoke(objectUrl);
  }
}

/**
 * Fetch a URL and decode its bytes — bounded, never throwing.
 *
 * The defensive loader `recipes/sprite-sheet-boot.ts` takes as its
 * `decodeImage` option (its shape — `(url) => Promise<CanvasImageSource |
 * undefined>` — is exactly this function's), so a game that wants the same
 * bounded, host-defensive decode the LDtk golden path applies internally can
 * copy this recipe in and pass `decodeImageBounded` directly. Never throws;
 * `undefined` on a bad fetch, a non-ok response, or any decode failure.
 *
 * @param url - the image URL (percent-encode spaces/brackets before calling)
 * @param options - timeout + injectable fetch/hosts (tests stub them)
 * @returns the decoded image, or `undefined` on any failure
 *
 * @example
 * ```ts
 * const sheet = await loadSpriteSheetAssets({
 *   imageUrl: `${import.meta.env.BASE_URL}Player.png`,
 *   jsonUrl: `${import.meta.env.BASE_URL}Player.json`,
 *   decodeImage: decodeImageBounded, // this recipe — copy it in
 * });
 * ```
 */
export async function decodeImageBounded(
  url: string,
  options: Readonly<DecodeImageBoundedOptions> = {},
): Promise<CanvasImageSource | undefined> {
  const fetcher = options.fetch ?? ambientFetch();
  if (fetcher === undefined) return undefined;
  const timeoutMs = timeoutOf(options);
  try {
    const response = await withTimeout(fetcher(url), timeoutMs);
    if (response === undefined || !response.ok) return undefined;
    const buffer = await withTimeout(response.arrayBuffer(), timeoutMs);
    if (buffer === undefined) return undefined;
    return decodeImageBytesBounded(buffer, options);
  } catch {
    return undefined;
  }
}
