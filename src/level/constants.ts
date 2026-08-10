/**
 * Level module constants (Pillar 4 — Level Loading).
 *
 * No magic numbers live outside this file. Consumers may import these to
 * author levels, build their own migration targets, or seed editors.
 *
 * @module
 */

/** Current level schema version. Incremented on breaking shape changes. */
export const LEVEL_VERSION = 1 as const;

/** Default tile size in pixels. Matches the Sokpop convention. */
export const DEFAULT_TILE_SIZE = 16;

/** Default level width in pixels. */
export const DEFAULT_LEVEL_WIDTH = 960;

/** Default level height in pixels. */
export const DEFAULT_LEVEL_HEIGHT = 540;

/**
 * First entity ID allocated by {@link allocateEntityId}. `0` is reserved for
 * the "invalid / unassigned" sentinel — never assigned to a real entity.
 */
export const DEFAULT_ENTITY_ID_START = 1;
