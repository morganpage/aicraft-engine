import {
  currentFrameIndex,
  currentFrameIndexAt,
  type CompiledAnim,
  type SpriteAnimState,
} from 'aicraft-engine';

/**
 * The sheet-cell index currently on-screen.
 *
 * The engine's `currentFrameIndex(state, anim)` returns a SLOT into
 * `anim.frameIndices`, not a sheet cell — `drawSprite`'s `frameIndex` wants
 * the cell. The mapping is a double indirection every caller performs by
 * hand (`clip.frameIndices[currentFrameIndex(state, clip) ?? 0]`), and a
 * clip whose slots happen to be the identity (`[0, 1, 2]`, like a plain walk
 * cycle) works by coincidence, hiding the bug until a reordered clip ships.
 * This recipe is that indirection, named.
 *
 * @param state - the sprite's animation clock (advanced by `advanceSpriteAnim`)
 * @param anim - the compiled clip being played
 * @returns the index into `CompiledSpriteSheet.frames` for the current frame,
 *   or `undefined` for an empty clip
 *
 * @example
 * ```ts
 * drawSprite(ctx, sheet, {
 *   frameIndex: currentSheetFrameIndex(animState, walkClip) ?? 0,
 *   x, y,
 * });
 * ```
 */
export function currentSheetFrameIndex(
  state: SpriteAnimState,
  anim: CompiledAnim,
): number | undefined {
  const slot = currentFrameIndex(state, anim);
  return slot === undefined ? undefined : anim.frameIndices[slot];
}

/** Same as {@link currentSheetFrameIndex} but for an explicit elapsed time
 * (ms) — the scrub/preview variant, mirroring `currentFrameIndexAt`. */
export function currentSheetFrameIndexAt(
  elapsedMs: number,
  anim: CompiledAnim,
): number | undefined {
  const slot = currentFrameIndexAt(elapsedMs, anim);
  return slot === undefined ? undefined : anim.frameIndices[slot];
}
