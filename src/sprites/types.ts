/**
 * Wire-format schema for sprite-sheet animation files.
 *
 * This is the on-disk JSON shape — a strict, `readonly` superset of the
 * Aseprite "JSON data" export, with two optional extensions:
 *
 * 1. `meta.grid` — synthesizes frames from a uniform tile grid (Kenney CC0
 *    packs ship as a single packed grid PNG with no per-frame metadata).
 * 2. `characters[]` — lets one `.json` + one `.png` define every character in
 *    a game, mirroring how one `.ldtk` + a tileset defines a whole level.
 *
 * Field names follow Aseprite verbatim (`frames`, `meta`, `frameTags`,
 * `frame`, `duration`, `spriteSourceSize`, `sourceSize`) so a real Aseprite /
 * LibreSprite export drops in with zero translation. The extensions are
 * additive: a strict Aseprite file is a valid single-character file here.
 *
 * Determinism: every field is `readonly` and holds only primitives, readonly
 * objects, or readonly arrays — no `Date`, closures, `Set`, or `Map`. The
 * shape survives a JSON round-trip (`JSON.parse(JSON.stringify(x)) === x` for
 * all runtime-relevant fields). Mirrors the discipline in
 * `../ldtk/types.ts`.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * An integer pixel rect in sheet space. Aseprite spells the fields
 * `{x,y,w,h}`; the engine's internal `Rect` (see `../collision/types.ts`)
 * uses `{x,y,width,height}`. The compile step bridges the two, so the wire
 * format stays faithful to Aseprite.
 */
export interface SpriteRectJSON {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Size pair. Aseprite uses `{w,h}`. */
export interface SpriteSizeJSON {
  readonly w: number;
  readonly h: number;
}

/**
 * A single source frame on the sheet. Matches Aseprite's per-frame object.
 *
 * `frame` is the source rect in sheet pixels. `duration` is the frame's
 * on-screen time in **milliseconds** (Aseprite's unit). `spriteSourceSize` /
 * `sourceSize` describe trimming and are stored verbatim for forward
 * compatibility — **v1 does not apply trim/rotation** (grid + explicit rect
 * only); packed-sheet support is deferred.
 */
export interface SpriteFrameJSON {
  readonly frame: SpriteRectJSON;
  /** Frame duration in ms. Aseprite uses `100`/`0`-ish values; 0 is treated
   * as "use the sheet default" downstream. */
  readonly duration: number;
  /** Trimmed sub-rect within the untrimmed frame (Aseprite; unused in v1). */
  readonly spriteSourceSize?: SpriteRectJSON;
  /** Untrimmed frame size (Aseprite; unused in v1). */
  readonly sourceSize?: SpriteSizeJSON;
}

// ---------------------------------------------------------------------------
// Grid extension (uniform-grid sheets, e.g. Kenney CC0 packs)
// ---------------------------------------------------------------------------

/**
 * Uniform tile-grid descriptor. When present on `meta`, the parser synthesizes
 * a `frames[]` entry for every cell of the grid (row-major), and frame indices
 * referenced by `frameTags` are interpreted as **tile indices** into that grid
 * (0 = top-left). This is the only practical way to consume a Kenney sheet,
 * which ships as a single packed grid PNG with no per-frame JSON.
 *
 * Cells are laid out row-major: tile index `i` → column `i % columns`,
 * row `floor(i / columns)`, pixel rect `(col*tileWidth, row*tileHeight,
 * tileWidth, tileHeight)`.
 */
export interface SpriteGridJSON {
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly columns: number;
}

// ---------------------------------------------------------------------------
// Animation tags (Aseprite `frameTags`)
// ---------------------------------------------------------------------------

/**
 * Playback direction for a tag. Aseprite values verbatim.
 * - `'forward'`  — play `from → to`, loop back to `from`.
 * - `'reverse'`  — play `to → from`, loop back to `to`.
 * - `'pingpong'` — play `from → to → from`, dwelling one tick at each end.
 */
export type SpriteTagDirection = 'forward' | 'reverse' | 'pingpong';

/**
 * A named animation spanning a closed range of frame indices. Matches
 * Aseprite's `meta.frameTags[]` entry. With `meta.grid`, `from`/`to` are tile
 * indices; otherwise they index the `frames` object/array in declaration
 * order.
 */
export interface SpriteFrameTagJSON {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly direction: SpriteTagDirection;
  /** Aseprite-only display hint; ignored at runtime. */
  readonly color?: string;
  /**
   * Play the clip once and CLAMP on its last frame instead of looping.
   * Engine extension (Aseprite never emits it): `false` is how a jump arc —
   * launch → apex → fall — holds its fall frame until landing rather than
   * rewinding mid-air. Default `true` (Aseprite behavior).
   */
  readonly loop?: boolean;
  /**
   * Uniform per-frame duration for THIS clip, in ms. Engine extension: a
   * grid sheet has no per-frame timings (every cell compiles at the sheet
   * default, 100 ms — which reads as vibration on a 2-frame clip), so the
   * tag is the natural place to author a per-clip pace. Ignored when `0` or
   * non-finite; `durations` (per-frame) wins when both are present.
   */
  readonly duration?: number;
  /**
   * Per-frame durations for THIS clip, in ms, parallel to the tag's frame
   * range (`to - from + 1` entries). Engine extension. A length mismatch is
   * a compile diagnostic (the tag falls back to `duration`/per-frame
   * timings), never a throw.
   */
  readonly durations?: readonly number[];
}

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------

/**
 * Sheet metadata. Mirrors Aseprite's `meta` object with the added optional
 * `grid` extension.
 */
export interface SpriteMetaJSON {
  /** Relative path to the PNG (as in LDtk tileset `relPath`). */
  readonly image?: string;
  readonly size?: SpriteSizeJSON;
  readonly frameTags?: readonly SpriteFrameTagJSON[];
  /** Uniform-grid extension. Mutually exclusive with authoring `frames` by
   * hand — if `grid` is present, frames are synthesized and any explicit
   * `frames` entries are ignored. */
  readonly grid?: SpriteGridJSON;
}

// ---------------------------------------------------------------------------
// characters[] extension (one file = whole game)
// ---------------------------------------------------------------------------

/**
 * Maps a character's semantic animation keys (`idle`, `walk`, …) to the
 * frame-tag names that supply their frames. Lets multiple characters share a
 * sheet and one JSON file define a whole game's cast.
 */
export interface SpriteCharacterJSON {
  /** Stable character identifier (e.g. `'player'`, `'slime'`). */
  readonly name: string;
  /** Animation key (`'idle'`, `'walk'`, …) → frame-tag name. */
  readonly animations: Readonly<Record<string, string>>;
  /** Which animation key to fall back to when a requested key is absent. */
  readonly defaultAnim?: string;
}

// ---------------------------------------------------------------------------
// Top-level document + parse result
// ---------------------------------------------------------------------------

/**
 * `frames` may be an Aseprite **hash** (`{ "player 0": {...}, ... }`) or an
 * **array** (`[ {...}, {...} ]`). Both are accepted; declaration order is the
 * canonical frame index for array form, key insertion order for hash form.
 */
export type SpriteFramesJSON =
  | Readonly<Record<string, SpriteFrameJSON>>
  | readonly SpriteFrameJSON[];

/** A sprite-sheet document: one `.json` file's parsed contents. */
export interface SpriteSheetJSON {
  readonly frames: SpriteFramesJSON;
  readonly meta: SpriteMetaJSON;
  /** Multi-character extension. Omit for a single-character sheet whose anim
   * keys are the raw frame-tag names. */
  readonly characters?: readonly SpriteCharacterJSON[];
}

// ---------------------------------------------------------------------------
// Parse result (mirrors `LdtkParseResult`)
// ---------------------------------------------------------------------------

/** A diagnostic, identical in shape to `LdtkParseError`. */
export interface SpriteDiagnostic {
  /** Dotted path into the document (e.g. `'meta.frameTags[2].from'`). */
  readonly path: string;
  readonly message: string;
  /** `'error'` blocks `ok`; `'warning'` is informational only. */
  readonly severity: 'error' | 'warning';
}

/** Result of {@link parseSpriteSheet}. `ok === true` iff no error diagnostics. */
export interface SpriteParseResult {
  readonly ok: boolean;
  readonly sheet?: SpriteSheetJSON;
  readonly errors: readonly SpriteDiagnostic[];
}
