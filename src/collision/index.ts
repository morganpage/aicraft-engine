/**
 * Collision module — AABB overlap test and per-axis move-and-resolve.
 *
 * The foundational platformer collision layer. All exports are pure functions
 * over plain data: no host access, no `Math.random`, no global state. Safe to
 * call from deterministic simulation code.
 *
 * @module
 */

export type { Rect, Solid, ResolveXResult, ResolveYResult } from './types';

export { aabbOverlap } from './aabb';

export { resolveAxisX, resolveAxisY } from './resolve';
