/**
 * Compile a parsed {@link SpriteSheetJSON} into the engine's internal
 * {@link CompiledSpriteSheet} runtime model.
 *
 * This is where the file-format vocabulary becomes the engine's vocabulary:
 * grid descriptors are synthesized into concrete frame rects, Aseprite
 * `frameTags` are expanded into ordered frame-index lists, and the optional
 * `characters[]` extension groups animations per character. Mirrors the role
 * of `../ldtk/translate.ts` (`ldtkLevelToLevelData`).
 *
 * Determinism: pure, never throws. Malformed references (a tag pointing past
 * the frame count, a character referencing an unknown tag) yield warnings and
 * are dropped rather than throwing. No `Math.random` / `Date.now`.
 *
 * @module
 */

import type {
  SpriteDiagnostic,
  SpriteFrameJSON,
  SpriteFrameTagJSON,
  SpriteFramesJSON,
  SpriteGridJSON,
  SpriteSheetJSON,
  SpriteTagDirection,
} from './types';

// ---------------------------------------------------------------------------
// Internal runtime model
// ---------------------------------------------------------------------------

/**
 * A resolved source rect in sheet pixels. Uses the engine-wide `width`/
 * `height` naming (matching `Rect` in `../collision/types.ts`) rather than
 * Aseprite's `w`/`h`, so it composes with the rest of the engine.
 */
export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A single named animation, resolved to an ordered list of frame indices into
 * the parent sheet's `frames[]`. The frame-player in `resolve.ts` advances
 * through these.
 */
export interface CompiledAnim {
  readonly name: string;
  /** Indices into {@link CompiledSpriteSheet.frames}, in play order. */
  readonly frameIndices: readonly number[];
  /** Per-frame duration in ms, parallel to `frameIndices`. */
  readonly durations: readonly number[];
  readonly direction: SpriteTagDirection;
  /** `false` plays once and clamps to the last frame; default `true`. */
  readonly loop: boolean;
}

/** A named character with its animation table. */
export interface CompiledCharacter {
  readonly name: string;
  readonly animations: ReadonlyMap<string, CompiledAnim>;
  /** Fallback animation key when a requested key is missing. */
  readonly defaultAnim: string | undefined;
}

/**
 * The fully resolved, ready-to-animate runtime model. A `CompiledSpriteSheet`
 * + a decoded PNG is everything needed to render any character/animation in
 * the file.
 */
export interface CompiledSpriteSheet {
  /** Resolved source rects, indexed by the values in `CompiledAnim.frameIndices`. */
  readonly frames: readonly FrameRect[];
  /** Sheet pixel dimensions (0 if absent in the source). */
  readonly imageSize: Readonly<{ w: number; h: number }>;
  /** Relative PNG path from the source `meta.image` (or `''`). */
  readonly image: string;
  /** All tags by name (single-character sheets read these directly). */
  readonly anims: ReadonlyMap<string, CompiledAnim>;
  /** Per-character animation tables (multi-character sheets). Empty for
   * single-character files — use `anims` directly. */
  readonly characters: ReadonlyMap<string, CompiledCharacter>;
}

// ---------------------------------------------------------------------------
// Frame resolution
// ---------------------------------------------------------------------------

/** Default per-frame duration (ms) when a frame's `duration` is 0/missing or
 * the sheet is grid-based with no per-frame timings. */
export const DEFAULT_FRAME_DURATION_MS = 100;

/** Flatten Aseprite hash/array `frames` into an ordered `SpriteFrameJSON[]`. */
function framesInOrder(frames: SpriteFramesJSON): readonly SpriteFrameJSON[] {
  if (Array.isArray(frames)) return frames;
  return Object.values(frames);
}

/**
 * Synthesize frame rects for a uniform grid. Tile index `i` maps to column
 * `i % columns`, row `floor(i / columns)`. The count is bounded by the sheet
 * `size` if known (so a 320×320 / 16 / 20 grid yields exactly 400 tiles).
 */
function synthesizeGridFrames(
  grid: SpriteGridJSON,
  size: Readonly<{ w: number; h: number }> | undefined,
): FrameRect[] {
  const { tileWidth: tw, tileHeight: th, columns } = grid;
  let rows: number;
  if (size && size.w > 0 && size.h > 0 && columns > 0) {
    // Derive rows from the declared image size; the grid's own column count
    // is authoritative for width.
    rows = Math.floor(size.h / th);
  } else {
    // Without a size we can't know the row count; synthesize a single row as
    // a safe degenerate. (The caller still gets `columns` usable tiles.)
    rows = 1;
  }
  const frames: FrameRect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      frames.push({ x: c * tw, y: r * th, width: tw, height: th });
    }
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Tag → CompiledAnim expansion
// ---------------------------------------------------------------------------

/**
 * Expand a closed `[from, to]` range into the ordered frame-index list for
 * the tag's `direction`. Indices are clamped to `[0, frameCount)` per element;
 * out-of-range tags are reported via diagnostics and skipped.
 *
 * The list is the *single forward pass* — pingpong's reverse leg is produced
 * by the frame-player in `resolve.ts`, not stored here, so the clip length
 * stays equal to the authored frame count.
 */
function expandTagRange(
  tag: SpriteFrameTagJSON,
  frameCount: number,
): { indices: number[]; valid: boolean } {
  if (frameCount === 0) return { indices: [], valid: false };
  const lo = Math.max(0, Math.min(tag.from, frameCount - 1));
  const hi = Math.max(0, Math.min(tag.to, frameCount - 1));
  const start = Math.min(lo, hi);
  const end = Math.max(lo, hi);
  const indices: number[] = [];
  for (let i = start; i <= end; i++) indices.push(i);
  // For `reverse` we store the reversed order; the player then walks it
  // forward (and loops back to index 0 of this list).
  if (tag.direction === 'reverse') indices.reverse();
  return { indices, valid: indices.length > 0 };
}

// ---------------------------------------------------------------------------
// Public compiler
// ---------------------------------------------------------------------------

/**
 * Compile a parsed sheet into the runtime model. **Never throws.**
 *
 * @param sheet - Output of {@link parseSpriteSheet} (a `SpriteSheetJSON`).
 * @returns A {@link CompileResult}: the compiled sheet plus any diagnostics.
 */
export interface CompileResult {
  readonly sheet: CompiledSpriteSheet;
  readonly diagnostics: readonly SpriteDiagnostic[];
}

/** Build a diagnostic. */
function diag(path: string, message: string, severity: 'error' | 'warning' = 'warning'): SpriteDiagnostic {
  return { path, message, severity };
}

export function compileSpriteSheet(sheet: SpriteSheetJSON): CompileResult {
  const diagnostics: SpriteDiagnostic[] = [];
  const meta = sheet.meta;
  const size = meta.size ? { w: meta.size.w, h: meta.size.h } : { w: 0, h: 0 };
  const explicitFrames = framesInOrder(sheet.frames);

  // 1. Resolve the frame table. Grid sheets synthesize frames; explicit-rect
  //    sheets use the authored frames directly. If both are present, grid
  //    wins (it's the point of the extension) and we warn.
  let frames: FrameRect[];
  let durations: number[];
  if (meta.grid) {
    if (explicitFrames.length > 0) {
      diagnostics.push(
        diag('frames', 'meta.grid is present; explicit frames are ignored (synthesizing from grid)'),
      );
    }
    frames = synthesizeGridFrames(meta.grid, meta.size);
    // Grid sheets have no per-frame timings; use the default for every cell.
    durations = frames.map(() => DEFAULT_FRAME_DURATION_MS);
  } else {
    frames = explicitFrames.map((f) => ({
      x: f.frame.x,
      y: f.frame.y,
      width: f.frame.w,
      height: f.frame.h,
    }));
    durations = explicitFrames.map((f) =>
      f.duration > 0 ? f.duration : DEFAULT_FRAME_DURATION_MS,
    );
  }

  // 2. Expand frameTags into CompiledAnims.
  const anims = new Map<string, CompiledAnim>();
  const tags = meta.frameTags ?? [];
  const usedDurationFor = (idx: number): number =>
    idx >= 0 && idx < durations.length ? durations[idx] : DEFAULT_FRAME_DURATION_MS;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const { indices, valid } = expandTagRange(tag, frames.length);
    if (!valid) {
      diagnostics.push(
        diag(`meta.frameTags[${i}]`, `tag "${tag.name}" resolved to no frames; skipped`),
      );
      continue;
    }
    if (anims.has(tag.name)) {
      diagnostics.push(
        diag(`meta.frameTags[${i}]`, `duplicate tag name "${tag.name}"; first definition wins`),
      );
      continue;
    }
    // Per-tag pacing. A grid sheet has no per-frame timings (every cell lands
    // on the 100 ms default), so a clip's pace is authored ON the tag:
    // `durations` (per-frame, must be parallel to the range) wins over
    // `duration` (uniform), which wins over the per-frame table. Length
    // mismatches and non-positive entries are diagnostics, never throws.
    let clipDurations: number[] | undefined;
    if (tag.durations !== undefined) {
      if (tag.durations.length === indices.length && tag.durations.every((d) => d > 0 && Number.isFinite(d))) {
        clipDurations = [...tag.durations];
      } else {
        diagnostics.push(
          diag(
            `meta.frameTags[${i}].durations`,
            `tag "${tag.name}" durations must be ${indices.length} positive entries; ignored`,
          ),
        );
      }
    }
    if (clipDurations === undefined && tag.duration !== undefined) {
      if (tag.duration > 0 && Number.isFinite(tag.duration)) {
        clipDurations = indices.map(() => tag.duration!);
      } else {
        diagnostics.push(
          diag(
            `meta.frameTags[${i}].duration`,
            `tag "${tag.name}" duration must be positive; ignored`,
          ),
        );
      }
    }
    anims.set(tag.name, {
      name: tag.name,
      frameIndices: indices,
      durations: clipDurations ?? indices.map(usedDurationFor),
      direction: tag.direction,
      loop: tag.loop ?? true,
    });
  }

  // 3. Build per-character tables if `characters[]` is present. Each
  //    character's semantic key (e.g. `'walk'`) maps to a tag name, which
  //    resolves to a CompiledAnim above. Missing tags warn and are skipped.
  const characters = new Map<string, CompiledCharacter>();
  const charDefs = sheet.characters ?? [];
  for (let i = 0; i < charDefs.length; i++) {
    const c = charDefs[i];
    const charAnims = new Map<string, CompiledAnim>();
    for (const [key, tagName] of Object.entries(c.animations)) {
      const anim = anims.get(tagName);
      if (!anim) {
        diagnostics.push(
          diag(
            `characters[${i}].animations["${key}"]`,
            `character "${c.name}" key "${key}" references unknown tag "${tagName}"; skipped`,
          ),
        );
        continue;
      }
      charAnims.set(key, anim);
    }
    if (charAnims.size === 0) {
      diagnostics.push(
        diag(`characters[${i}]`, `character "${c.name}" has no resolvable animations; skipped`),
      );
      continue;
    }
    if (characters.has(c.name)) {
      diagnostics.push(
        diag(`characters[${i}]`, `duplicate character name "${c.name}"; first definition wins`),
      );
      continue;
    }
    characters.set(c.name, {
      name: c.name,
      animations: charAnims,
      defaultAnim: c.defaultAnim,
    });
  }

  const compiled: CompiledSpriteSheet = {
    frames,
    imageSize: size,
    image: meta.image ?? '',
    anims,
    characters,
  };
  return { sheet: compiled, diagnostics };
}

// ---------------------------------------------------------------------------
// Convenience lookups
// ---------------------------------------------------------------------------

/**
 * Resolve an animation for a character by semantic key, falling back to the
 * character's `defaultAnim`, then to any available animation. Returns
 * `undefined` if the character is unknown or has no usable animation.
 *
 * For a single-character sheet (no `characters[]`), pass `undefined` for
 * `characterName` and the tag-name → anim map is consulted directly.
 */
export function resolveAnim(
  compiled: CompiledSpriteSheet,
  characterName: string | undefined,
  animKey: string,
): CompiledAnim | undefined {
  if (characterName === undefined) {
    return compiled.anims.get(animKey);
  }
  const character = compiled.characters.get(characterName);
  if (!character) return undefined;
  const direct = character.animations.get(animKey);
  if (direct) return direct;
  if (character.defaultAnim) {
    const fallback = character.animations.get(character.defaultAnim);
    if (fallback) return fallback;
  }
  // Last resort: any animation on the character.
  return character.animations.values().next().value;
}
