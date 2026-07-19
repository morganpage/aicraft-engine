/**
 * Editor module constants (Pillar 4 — Level Editor Core).
 *
 * No magic numbers live outside this file. Consumers may import these to
 * configure their own editor instances.
 *
 * @module
 */

/**
 * Default maximum number of undo entries before the oldest is evicted.
 *
 * A typical LevelData is ~2 KB (60×34 tile grid + a few entities). At
 * this default depth, a bounded history is ~200 KB — trivially small
 * for a browser tab. Consumers with large levels (e.g. 500×500) may
 * lower this via `createEditorState(level, { maxHistoryDepth })`.
 */
export const DEFAULT_MAX_HISTORY_DEPTH = 100;

/**
 * Default grid size in pixels for the "snap to grid" feature.
 *
 * Matches the canonical Sokpop / Spitekeep 16-pixel tile. Consumers may
 * pass any positive integer to `snapToGrid` / `snapRectToGrid`.
 */
export const DEFAULT_GRID_SIZE = 16;

/**
 * Default snap threshold in pixels for edge alignment.
 *
 * If a moved rect's edge is within this many pixels of another rect's
 * edge, the moved rect snaps to that edge. Tunable per-call via the
 * `threshold` parameter to `snapToEdges`.
 */
export const DEFAULT_SNAP_THRESHOLD = 4;
