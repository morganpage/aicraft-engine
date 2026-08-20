/**
 * Defensive sprite-sheet JSON parser.
 *
 * `JSON.parse` + structural validation against the schema in `types.ts`.
 * **Never throws** — returns a {@link SpriteParseResult} with diagnostics,
 * mirroring the engine's `parseLdtkProject` / `validateLevel` contract.
 *
 * Determinism note: no `Math.random`, no `Date.now`, no global state. The same
 * input string always yields the same output.
 *
 * @module
 */

import type {
  SpriteDiagnostic,
  SpriteFrameJSON,
  SpriteFrameTagJSON,
  SpriteFramesJSON,
  SpriteGridJSON,
  SpriteMetaJSON,
  SpriteParseResult,
  SpriteRectJSON,
  SpriteSheetJSON,
  SpriteSizeJSON,
  SpriteTagDirection,
} from './types';

// --- Hand-written type guards (no zod — the engine is zero-dep) -----------

/** Truthy narrow for a plain non-null object record (not an array). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** True iff `v` is a finite `number`. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** True iff `v` is a finite integer. */
function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v);
}

/** Coerce to `number | undefined` (finite only). */
function num(v: unknown): number | undefined {
  return isFiniteNumber(v) ? v : undefined;
}

/** Coerce to `integer | undefined`. */
function int(v: unknown): number | undefined {
  return isFiniteInt(v) ? v : undefined;
}

/** Coerce to `string | undefined`. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Build a diagnostic. */
function diag(path: string, message: string, severity: 'error' | 'warning' = 'error'): SpriteDiagnostic {
  return { path, message, severity };
}

const DIRECTIONS: readonly SpriteTagDirection[] = ['forward', 'reverse', 'pingpong'];

/** Coerce a tag direction, defaulting to `'forward'` on anything invalid. */
function parseDirection(v: unknown): SpriteTagDirection {
  return typeof v === 'string' && (DIRECTIONS as readonly string[]).includes(v)
    ? (v as SpriteTagDirection)
    : 'forward';
}

// --- Per-shape coercers ---------------------------------------------------

function parseRect(raw: unknown, path: string, errors: SpriteDiagnostic[]): SpriteRectJSON | undefined {
  if (!isPlainObject(raw)) {
    errors.push(diag(path, 'expected a rect object {x,y,w,h}'));
    return undefined;
  }
  const x = num(raw.x);
  const y = num(raw.y);
  const w = num(raw.w);
  const h = num(raw.h);
  if (x === undefined || y === undefined || w === undefined || h === undefined) {
    errors.push(diag(path, 'rect is missing one of x/y/w/h'));
    return undefined;
  }
  return { x, y, w, h };
}

function parseSize(raw: unknown, path: string, errors: SpriteDiagnostic[]): SpriteSizeJSON | undefined {
  if (!isPlainObject(raw)) return undefined;
  const w = num(raw.w);
  const h = num(raw.h);
  if (w === undefined || h === undefined) {
    errors.push(diag(path, 'size is missing w or h'));
    return undefined;
  }
  return { w, h };
}

function parseFrame(raw: unknown, path: string, errors: SpriteDiagnostic[]): SpriteFrameJSON | undefined {
  if (!isPlainObject(raw)) {
    errors.push(diag(path, 'expected a frame object'));
    return undefined;
  }
  const frame = parseRect(raw.frame, `${path}.frame`, errors);
  if (frame === undefined) return undefined;
  // Aseprite emits `duration` in ms; a missing/invalid value defaults to 0,
  // which the compile step rewrites to the sheet-wide default.
  const duration = num(raw.duration) ?? 0;
  // Compute optionals first so the returned object is a single (readonly-safe)
  // literal — matches the LDtk parser's style.
  const spriteSourceSize = isPlainObject(raw.spriteSourceSize)
    ? parseRect(raw.spriteSourceSize, `${path}.spriteSourceSize`, errors)
    : undefined;
  const sourceSize = isPlainObject(raw.sourceSize)
    ? parseSize(raw.sourceSize, `${path}.sourceSize`, errors)
    : undefined;
  return {
    frame,
    duration,
    ...(spriteSourceSize ? { spriteSourceSize } : {}),
    ...(sourceSize ? { sourceSize } : {}),
  };
}

function parseGrid(raw: unknown, path: string, errors: SpriteDiagnostic[]): SpriteGridJSON | undefined {
  if (!isPlainObject(raw)) return undefined;
  const tileWidth = int(raw.tileWidth);
  const tileHeight = int(raw.tileHeight);
  const columns = int(raw.columns);
  if (tileWidth === undefined || tileHeight === undefined || columns === undefined) {
    errors.push(diag(path, 'grid requires integer tileWidth, tileHeight, columns'));
    return undefined;
  }
  if (tileWidth <= 0 || tileHeight <= 0 || columns <= 0) {
    errors.push(diag(path, 'grid tileWidth/tileHeight/columns must be positive'));
    return undefined;
  }
  return { tileWidth, tileHeight, columns };
}

function parseTag(raw: unknown, path: string, errors: SpriteDiagnostic[]): SpriteFrameTagJSON | undefined {
  if (!isPlainObject(raw)) {
    errors.push(diag(path, 'expected a frameTag object'));
    return undefined;
  }
  const name = str(raw.name);
  if (!name) {
    errors.push(diag(path, 'frameTag is missing a name'));
    return undefined;
  }
  const from = int(raw.from);
  const to = int(raw.to);
  if (from === undefined || to === undefined) {
    errors.push(diag(path, `frameTag "${name}" is missing integer from/to`));
    return undefined;
  }
  const color = str(raw.color);
  // Engine extensions (Aseprite never emits these): one-shot clips + per-tag
  // pacing. Parsed defensively — invalid values are dropped, never errors,
  // so a strict Aseprite file and a hand-authored extension file take the
  // same never-throws path.
  const loop = raw.loop;
  const duration = int(raw.duration);
  // Positional semantics: if ANY entry is invalid the whole array is dropped
  // (filtering would shift positions and silently re-pair frames with the
  // wrong timings).
  const rawDurations = Array.isArray(raw.durations) ? raw.durations.map((d) => int(d)) : undefined;
  const allPositive = (values: readonly (number | undefined)[]): values is number[] =>
    values.length > 0 && values.every((d) => d !== undefined && d > 0 && Number.isFinite(d));
  const durations = rawDurations !== undefined && allPositive(rawDurations) ? rawDurations : undefined;
  return {
    name,
    from,
    to,
    direction: parseDirection(raw.direction),
    ...(color ? { color } : {}),
    ...(typeof loop === 'boolean' ? { loop } : {}),
    ...(duration !== undefined && duration > 0 ? { duration } : {}),
    ...(durations !== undefined ? { durations } : {}),
  };
}

function parseMeta(raw: unknown, errors: SpriteDiagnostic[]): SpriteMetaJSON {
  if (!isPlainObject(raw)) {
    errors.push(diag('meta', 'meta is missing or not an object'));
    return {};
  }
  const image = str(raw.image);
  const size = isPlainObject(raw.size) ? parseSize(raw.size, 'meta.size', errors) : undefined;
  let tags: SpriteFrameTagJSON[] | undefined;
  if (Array.isArray(raw.frameTags)) {
    tags = [];
    raw.frameTags.forEach((t, i) => {
      const tag = parseTag(t, `meta.frameTags[${i}]`, errors);
      if (tag) tags!.push(tag);
    });
    if (tags.length === 0) tags = undefined;
  }
  const grid = isPlainObject(raw.grid) ? parseGrid(raw.grid, 'meta.grid', errors) : undefined;
  return {
    ...(image ? { image } : {}),
    ...(size ? { size } : {}),
    ...(tags ? { frameTags: tags } : {}),
    ...(grid ? { grid } : {}),
  };
}

function parseCharacter(
  raw: unknown,
  path: string,
  errors: SpriteDiagnostic[],
): import('./types').SpriteCharacterJSON | undefined {
  if (!isPlainObject(raw)) {
    errors.push(diag(path, 'expected a character object'));
    return undefined;
  }
  const name = str(raw.name);
  if (!name) {
    errors.push(diag(path, 'character is missing a name'));
    return undefined;
  }
  if (!isPlainObject(raw.animations)) {
    errors.push(diag(`${path}.animations`, `character "${name}" animations must be an object`));
    return undefined;
  }
  const animations: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.animations)) {
    const vs = str(v);
    if (vs === undefined) {
      errors.push(diag(`${path}.animations["${k}"]`, `character "${name}" animation "${k}" must map to a string tag name`));
      continue;
    }
    animations[k] = vs;
  }
  const defaultAnim = str(raw.defaultAnim);
  return {
    name,
    animations,
    ...(defaultAnim ? { defaultAnim } : {}),
  };
}

function parseFrames(
  raw: unknown,
  path: string,
  errors: SpriteDiagnostic[],
): SpriteFramesJSON {
  if (Array.isArray(raw)) {
    // Aseprite "array" form — declaration order is the frame index.
    const frames: SpriteFrameJSON[] = [];
    raw.forEach((f, i) => {
      const frame = parseFrame(f, `${path}[${i}]`, errors);
      if (frame) frames.push(frame);
    });
    return frames;
  }
  if (isPlainObject(raw)) {
    // Aseprite "hash" form — key insertion order is the frame index.
    const frames: Record<string, SpriteFrameJSON> = {};
    for (const [k, v] of Object.entries(raw)) {
      const frame = parseFrame(v, `${path}["${k}"]`, errors);
      if (frame) frames[k] = frame;
    }
    return frames;
  }
  // Missing/non-object frames is fine for a pure grid sheet (synthesized
  // from meta.grid); default to empty.
  if (raw !== undefined) {
    errors.push(diag(path, 'frames is not an object or array; treating as empty'));
  }
  return {};
}

// --- Public entry point ---------------------------------------------------

/**
 * Parse a sprite-sheet JSON string. **Never throws.**
 *
 * Performs `JSON.parse` then defensive structural coercion into
 * {@link SpriteSheetJSON}. Malformed-but-recoverable fields are dropped with a
 * warning; structural failures produce error diagnostics. `ok === true` iff
 * there are no error-severity diagnostics.
 *
 * Accepts Aseprite's `frames` in **hash** or **array** form, with or without
 * the `meta.grid` / `characters[]` extensions.
 *
 * @example
 * ```ts
 * const text = await fs.readFile('player.json', 'utf8');
 * const { ok, sheet, errors } = parseSpriteSheet(text);
 * if (!ok || !sheet) { console.error(errors); return; }
 * ```
 *
 * @param json - Raw `.json` file contents.
 * @returns A {@link SpriteParseResult}.
 */
export function parseSpriteSheet(json: string): SpriteParseResult {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      errors: [diag('root', `JSON parse failed: ${(e as Error).message}`)],
    };
  }
  if (!isPlainObject(root)) {
    return { ok: false, errors: [diag('root', 'document root is not an object')] };
  }
  const errors: SpriteDiagnostic[] = [];

  const frames = parseFrames(root.frames, 'frames', errors);
  const meta = parseMeta(root.meta, errors);

  // Structural requirement: either explicit frames OR a grid must be present,
  // otherwise there is nothing to draw.
  const hasExplicitFrames =
    (Array.isArray(frames) && frames.length > 0) ||
    (isPlainObject(frames) && Object.keys(frames).length > 0);
  if (!hasExplicitFrames && meta.grid === undefined) {
    errors.push(
      diag('frames', 'no frames and no meta.grid — nothing to animate; provide frames or a grid'),
    );
  }

  let characters: import('./types').SpriteCharacterJSON[] | undefined;
  if (Array.isArray(root.characters)) {
    const list: import('./types').SpriteCharacterJSON[] = [];
    root.characters.forEach((c, i) => {
      const ch = parseCharacter(c, `characters[${i}]`, errors);
      if (ch) list.push(ch);
    });
    if (list.length > 0) characters = list;
  }

  const sheet: SpriteSheetJSON = {
    frames,
    meta,
    ...(characters ? { characters } : {}),
  };

  return {
    ok: errors.every((e) => e.severity !== 'error'),
    sheet,
    errors,
  };
}
