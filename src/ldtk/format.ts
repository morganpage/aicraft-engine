/**
 * LDtk-style JSON serializer.
 *
 * `JSON.stringify` cannot produce LDtk's layout. LDtk tab-indents objects but
 * collapses leaf arrays onto one line, wraps IntGrid rows at a fixed width, and
 * prints each tile as a single compact line. On a real project the difference
 * is not cosmetic: tab-indenting `Typical_2D_platformer_example.ldtk` inflates
 * it from 401 KB to 897 KB, and — because these files live in git — reformatting
 * every line would bury a one-tile edit in a whole-file diff.
 *
 * The goal is a file that reopens in LDtk *and* diffs cleanly against the
 * version LDtk wrote.
 *
 * Determinism note: pure string building. Key order follows the input object's
 * own insertion order, which the parser preserves from the source file.
 *
 * @module
 */

/** Numbers per line when wrapping an IntGrid. Matches LDtk's own output. */
const INT_GRID_WRAP = 35;

/**
 * Fields whose arrays hold one compact object per line — the tile arrays.
 * These dominate a project's size, and one-per-line keeps edits diffable.
 */
const TILE_ARRAY_FIELDS: ReadonlySet<string> = new Set([
  'autoLayerTiles',
  'gridTiles',
]);

/** Fields printed as a single line of compact objects. */
const INLINE_OBJECT_ARRAY_FIELDS: ReadonlySet<string> = new Set(['__neighbours']);

/** Fields whose numeric contents wrap at {@link INT_GRID_WRAP} per line. */
const WRAPPED_NUMBER_ARRAY_FIELDS: ReadonlySet<string> = new Set(['intGridCsv']);

/** True when every element is a primitive, or an array of primitives. */
function isLeafArray(value: readonly unknown[]): boolean {
  for (const item of value) {
    if (item === null) continue;
    if (Array.isArray(item)) {
      if (!item.every((inner) => inner === null || typeof inner !== 'object')) return false;
      continue;
    }
    if (typeof item === 'object') return false;
  }
  return true;
}

/**
 * Serialize a scalar the way `JSON.stringify` would.
 *
 * Numbers go through `JSON.stringify` rather than `String` so that `-0`, large
 * integers and exponent formatting match what a JSON round-trip produces.
 */
function scalar(value: unknown): string {
  if (value === undefined) return 'null';
  return JSON.stringify(value) ?? 'null';
}

/** Compact, spaceless form: `[1,2,3]` or `{"a":1}`. */
function compact(value: unknown): string {
  return JSON.stringify(value) ?? 'null';
}

/** `{ "px": [96,8], "src": [0,0] }` — spaced braces, compact values. */
function compactObject(value: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}: ${compact(item)}`);
  }
  return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`;
}

function indentOf(depth: number): string {
  return '\t'.repeat(depth);
}

/** Serialize an array according to its field's house style. */
function writeArray(value: readonly unknown[], field: string, depth: number): string {
  if (value.length === 0) return '[]';

  if (WRAPPED_NUMBER_ARRAY_FIELDS.has(field)) {
    const pad = indentOf(depth + 1);
    const lines: string[] = [];
    for (let i = 0; i < value.length; i += INT_GRID_WRAP) {
      lines.push(pad + value.slice(i, i + INT_GRID_WRAP).map(scalar).join(','));
    }
    return `[\n${lines.join(',\n')}\n${indentOf(depth)}]`;
  }

  if (TILE_ARRAY_FIELDS.has(field)) {
    const pad = indentOf(depth + 1);
    const lines = value.map(
      (item) => pad + (isRecord(item) ? compactObject(item) : compact(item)),
    );
    return `[\n${lines.join(',\n')}\n${indentOf(depth)}]`;
  }

  if (INLINE_OBJECT_ARRAY_FIELDS.has(field)) {
    return `[ ${value.map((item) => (isRecord(item) ? compactObject(item) : compact(item))).join(', ')} ]`;
  }

  if (isLeafArray(value)) {
    // Numeric leaves pack tight (`[0,0,1]`) — they are the bulk of a project
    // and readability buys nothing. Anything containing a string gets breathing
    // room (`[ "a", "b" ]`), which is what LDtk itself emits.
    return containsString(value)
      ? `[ ${value.map(compact).join(', ')} ]`
      : compact(value);
  }

  const pad = indentOf(depth + 1);
  const lines = value.map((item) => pad + writeValue(item, field, depth + 1));
  return `[\n${lines.join(',\n')}\n${indentOf(depth)}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when a leaf array holds a string at any depth. */
function containsString(value: readonly unknown[]): boolean {
  for (const item of value) {
    if (typeof item === 'string') return true;
    if (Array.isArray(item) && containsString(item)) return true;
  }
  return false;
}

/** Serialize any value. `field` selects the array style for arrays. */
function writeValue(value: unknown, field: string, depth: number): string {
  if (Array.isArray(value)) return writeArray(value, field, depth);
  if (isRecord(value)) return writeObject(value, depth);
  return scalar(value);
}

function writeObject(value: Record<string, unknown>, depth: number): string {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  if (entries.length === 0) return '{}';
  const pad = indentOf(depth + 1);
  const lines = entries.map(
    ([key, item]) => `${pad}${JSON.stringify(key)}: ${writeValue(item, key, depth + 1)}`,
  );
  return `{\n${lines.join(',\n')}\n${indentOf(depth)}}`;
}

/**
 * Serialize a parsed `.ldtk` document in LDtk's own layout.
 *
 * @param document - A plain object, normally from `JSON.parse` of a `.ldtk`
 *   file with owned fields written back into it.
 * @returns The formatted JSON text, without a trailing newline.
 *
 * @example
 * ```ts
 * const raw = JSON.parse(text);
 * raw.levels[0].pxWid = 512;
 * await write(formatLdtkJson(raw));
 * ```
 */
export function formatLdtkJson(document: unknown): string {
  return writeValue(document, '', 0);
}
