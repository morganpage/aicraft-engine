/**
 * Sprite animation pipeline — Aseprite-JSON-superset `.json` + a PNG = all
 * animations for a character or a whole game.
 *
 * The pipeline mirrors `../ldtk/`: a wire-format schema (`types.ts`), a
 * defensive never-throws parser (`parse.ts`), a compile step into the
 * internal runtime model (`compile.ts`), a pure deterministic frame-player
 * (`resolve.ts`), and a pure draw path (`render.ts`). The consumer loads the
 * PNG and injects it; the engine never imports `Image` or calls `fetch`.
 *
 * One `.json` + one `.png` defines a whole game's worth of characters, the
 * same way one `.ldtk` + a tileset defines a whole level.
 *
 * Quick start:
 * ```ts
 * const { ok, sheet } = parseSpriteSheet(text);
 * if (!ok || !sheet) throw new Error('bad sheet');
 * const compiled = compileSpriteSheet(sheet).sheet;
 * const anim = resolveAnim(compiled, 'player', 'idle')!;
 * let state = createSpriteAnimState();
 * // each tick: state = advanceSpriteAnim(state, dtMs);
 * const slot = currentFrameIndex(state, anim)!;
 * const frame = anim.frameIndices[slot];
 * drawSprite(ctx, image, compiled, frame, x, y, { facing: core.facing });
 * ```
 *
 * @module
 */

// Wire-format schema
export type {
  SpriteRectJSON,
  SpriteSizeJSON,
  SpriteFrameJSON,
  SpriteGridJSON,
  SpriteTagDirection,
  SpriteFrameTagJSON,
  SpriteMetaJSON,
  SpriteCharacterJSON,
  SpriteFramesJSON,
  SpriteSheetJSON,
  SpriteDiagnostic,
  SpriteParseResult,
} from './types';

// Parser
export { parseSpriteSheet } from './parse';

// Compiler + internal model
export {
  compileSpriteSheet,
  resolveAnim,
  DEFAULT_FRAME_DURATION_MS,
} from './compile';
export type {
  FrameRect,
  CompiledAnim,
  CompiledCharacter,
  CompiledSpriteSheet,
  CompileResult,
} from './compile';

// Frame-player
export {
  createSpriteAnimState,
  advanceSpriteAnim,
  currentFrameIndex,
  currentFrameIndexAt,
  animTotalDuration,
} from './resolve';
export type { SpriteAnimState } from './resolve';

// Anim-state deriver + the clip-aware clock
export {
  deriveSpriteAnimKind,
  spriteAnimClipFor,
  createSpriteAnimPlayer,
  advanceSpriteAnimPlayer,
} from './anim-state';
export type {
  SpriteAnimKind,
  SpriteAnimInputs,
  SpriteAnimClip,
  SpriteAnimPlayer,
} from './anim-state';

// Renderer
export {
  drawSprite,
  resolveDrawSource,
  createSpriteTintCache,
} from './render';
export type {
  SpriteFacing,
  DrawSpriteOptions,
  SpriteTintCache,
  TintCanvas,
  TintCanvasFactory,
} from './render';
