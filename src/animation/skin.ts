import type { BoneDrawMap, Rig } from './types';

/**
 * Draw all bones in a rig using the given skin. For each entry in the
 * `BoneDrawMap`:
 *   1. Skip if the entry is `null` (invisible bone).
 *   2. `ctx.save()`.
 *   3. Apply the bone's world transform via `ctx.transform(a, b, c, d, tx, ty)`.
 *   4. Call the entry's `draw` callback (the callback draws in the bone's
 *      local space — origin at the bone root, +X along the bone direction).
 *   5. `ctx.restore()`.
 *
 * Renderer-adjacent: reads `rig.worldTransforms` (deterministic) but mutates
 * canvas state. The draw callbacks are consumer-provided; their determinism
 * is the consumer's responsibility. The caller MUST run `computeWorldTransforms(rig)`
 * before calling this so the world transforms are current.
 *
 * @param ctx - the canvas 2D context (caller owns the outer save/restore)
 * @param rig - the rig (must have current `worldTransforms`)
 * @param skin - bone-indexed draw map; `null` entries are skipped
 */
export function drawRig(
  ctx: CanvasRenderingContext2D,
  rig: Rig,
  skin: BoneDrawMap,
): void {
  for (let i = 0; i < skin.length; i++) {
    const entry = skin[i];
    if (entry === null) continue;
    const m = rig.worldTransforms[entry.boneIndex];
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    entry.draw(ctx, rig);
    ctx.restore();
  }
}
