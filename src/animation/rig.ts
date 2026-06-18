import type {
  AffineTransform,
  BoneNode,
  BonePose,
  Rig,
  SkeletonTemplate,
  Vec2,
} from './types';

/**
 * Build a local affine matrix from a `BonePose` (TRS: translate · rotate · scale).
 *
 * For rotation θ and scale `(sx, sy)`:
 *   `a = cos·sx, b = sin·sx, c = -sin·sy, d = cos·sy`.
 *
 * Internal helper — not part of the public API. Consumers never construct
 * matrices by hand; they set `BonePose` values and the engine produces
 * matrices via this conversion.
 */
function poseToMatrix(pose: BonePose): AffineTransform {
  const theta = pose.rotation ?? 0;
  const sx = pose.scale?.x ?? 1;
  const sy = pose.scale?.y ?? 1;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [
    cos * sx,
    sin * sx,
    -sin * sy,
    cos * sy,
    pose.translation?.x ?? 0,
    pose.translation?.y ?? 0,
  ];
}

/**
 * Compose two affine matrices as `parent · local` (parent on the left).
 * Standard 2×3 matrix multiplication (8 mul + 4 add). Internal helper.
 */
function compose(parent: AffineTransform, local: AffineTransform): AffineTransform {
  const [pa, pb, pc, pd, ptx, pty] = parent;
  const [la, lb, lc, ld, ltx, lty] = local;
  return [
    pa * la + pc * lb,
    pb * la + pd * lb,
    pa * lc + pc * ld,
    pb * lc + pd * ld,
    pa * ltx + pc * lty + ptx,
    pb * ltx + pd * lty + pty,
  ];
}

/**
 * Pure world-transform propagation over raw bone + pose arrays. Returns a new
 * `AffineTransform` per bone. Single O(N) forward pass — parents precede
 * children in the array, so `world[parentIndex]` is already computed when a
 * child is processed.
 *
 * Internal helper used both by `createSkeleton` (to cache rest-pose world
 * transforms) and by the public `computeWorldTransforms` (which writes the
 * result into a `Rig`'s mutable caches).
 */
function propagateWorldTransforms(
  bones: readonly BoneNode[],
  localPoses: readonly BonePose[],
): AffineTransform[] {
  const world: AffineTransform[] = new Array(bones.length);
  for (let i = 0; i < bones.length; i++) {
    const local = poseToMatrix(localPoses[i]);
    const parentIndex = bones[i].parentIndex;
    world[i] = parentIndex === -1 ? local : compose(world[parentIndex], local);
  }
  return world;
}

/**
 * Create a reusable skeleton template from a bone definition array.
 *
 * The `bones` array MUST be topologically sorted: every parent bone must
 * appear before its children (i.e. each bone's `parentIndex` is either `-1`
 * or strictly less than the bone's own index). Root bones have
 * `parentIndex: -1`.
 *
 * Validates at setup time (this is a one-time authoring function, not a
 * per-frame call):
 * - Every `parentIndex` is `-1` or a valid earlier index (`< own index`).
 *   This guarantees the topological invariant and rules out self-cycles.
 * - Attachment slot names are unique across the skeleton.
 *
 * Caches:
 * - `restWorldTransforms`: rest-pose world transform per bone.
 * - `boneLengths`: distance from each bone's rest origin to its first child's
 *   rest origin (world space); `0` for leaf bones.
 * - `slotMap`: attachment slot name → bone index.
 *
 * @param bones - flat bone array, topologically sorted (parents before children)
 * @returns the immutable `SkeletonTemplate`
 * @throws if a bone's `parentIndex` is invalid (not `-1` and not `< own index`)
 * @throws if two bones share the same `attachmentSlot` name
 *
 * @example
 * ```ts
 * const humanoid = createSkeleton([
 *   { id: 'root',  parentIndex: -1, restPose: { translation: { x: 0, y: 0 } }, attachmentSlot: 'root' },
 *   { id: 'torso', parentIndex: 0,  restPose: { translation: { x: 0, y: -12 } } },
 *   { id: 'head',  parentIndex: 1,  restPose: { translation: { x: 0, y: -16 } }, attachmentSlot: 'head' },
 * ]);
 * ```
 */
export function createSkeleton(bones: BoneNode[]): SkeletonTemplate {
  for (let i = 0; i < bones.length; i++) {
    const parentIndex = bones[i].parentIndex;
    if (parentIndex !== -1 && !(parentIndex > -1 && parentIndex < i)) {
      throw new Error(
        `createSkeleton: bone "${bones[i].id}" at index ${i} has invalid parentIndex ` +
          `${parentIndex} (must be -1 or an earlier index < ${i})`,
      );
    }
  }

  const slotMap: Record<string, number> = {};
  for (let i = 0; i < bones.length; i++) {
    const slot = bones[i].attachmentSlot;
    if (slot !== undefined) {
      if (slot in slotMap) {
        throw new Error(
          `createSkeleton: duplicate attachment slot "${slot}" on bone "${bones[i].id}" ` +
            `(already used by bone at index ${slotMap[slot]})`,
        );
      }
      slotMap[slot] = i;
    }
  }

  const restPoses = bones.map((b) => b.restPose);
  const restWorldTransforms = propagateWorldTransforms(bones, restPoses);

  const boneLengths: number[] = new Array(bones.length).fill(0);
  for (let i = 0; i < bones.length; i++) {
    const px = restWorldTransforms[i][4];
    const py = restWorldTransforms[i][5];
    for (let j = i + 1; j < bones.length; j++) {
      if (bones[j].parentIndex === i) {
        const dx = restWorldTransforms[j][4] - px;
        const dy = restWorldTransforms[j][5] - py;
        boneLengths[i] = Math.sqrt(dx * dx + dy * dy);
        break;
      }
    }
  }

  return {
    bones,
    restWorldTransforms,
    boneLengths,
    slotMap,
  };
}

/**
 * Create a live rig instance from a skeleton template. Initializes all
 * `localPoses` to (cloned copies of) the template's rest poses and runs an
 * initial `computeWorldTransforms` so `worldTransforms` / `worldPositions` /
 * `worldRotations` are populated immediately.
 *
 * The local-pose clones are shallow at the `Vec2` level (`{x, y}` is flat) —
 * sufficient to isolate the rig's workspace from the template's rest pose.
 *
 * @param template - the shared skeleton definition
 * @returns a fresh `Rig` bound to `template`, with world transforms computed
 *   for the rest pose
 */
export function createRig(template: SkeletonTemplate): Rig {
  const n = template.bones.length;
  const localPoses: BonePose[] = template.bones.map((b) => ({
    translation: b.restPose.translation ? { ...b.restPose.translation } : undefined,
    rotation: b.restPose.rotation,
    scale: b.restPose.scale ? { ...b.restPose.scale } : undefined,
  }));
  const rig: Rig = {
    template,
    localPoses,
    worldTransforms: new Array<AffineTransform>(n),
    worldPositions: new Array<Vec2>(n),
    worldRotations: new Array<number>(n),
  };
  computeWorldTransforms(rig);
  return rig;
}

/**
 * Compute world-space transforms for all bones in a rig.
 *
 * Single forward pass through the flat bone array (parents precede children),
 * composing each bone's local transform with its parent's world transform.
 * Local-to-matrix conversion uses the pillar rotation convention: for a
 * rotation by θ radians, the matrix elements are `cos θ, sin θ, -sin θ, cos θ`
 * — consistent with `ctx.transform(cos θ, sin θ, -sin θ, cos θ, tx, ty)`.
 *
 * Mutates `rig.worldTransforms`, `rig.worldPositions`, and
 * `rig.worldRotations` in-place (the sanctioned renderer-output buffer
 * exception; see `docs/architecture.md`). Does NOT mutate `rig.localPoses`.
 *
 * Complexity: O(N) where N = number of bones. No recursion. No trig in the
 * propagation loop itself — trig happens only inside `poseToMatrix`, once per
 * bone per call.
 *
 * @param rig - the rig whose world transforms to recompute
 */
export function computeWorldTransforms(rig: Rig): void {
  const world = propagateWorldTransforms(rig.template.bones, rig.localPoses);
  for (let i = 0; i < world.length; i++) {
    const m = world[i];
    rig.worldTransforms[i] = m;
    const a = m[0];
    const b = m[1];
    const tx = m[4];
    const ty = m[5];
    rig.worldPositions[i] = { x: tx, y: ty };
    rig.worldRotations[i] = Math.atan2(b, a);
  }
}
