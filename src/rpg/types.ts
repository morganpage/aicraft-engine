/**
 * Shared ID, diagnostic, location, and input contracts for the RPG module.
 *
 * IDs are plain validated strings, not branded types: content compilation
 * (Milestone 2) guarantees referential integrity once a bundle compiles, so
 * the type system does not need to re-prove it at every call site.
 */

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

/** Stable identifier of a map in the content catalog. */
export type RpgMapId = string;

/** Stable identifier of a spawn anchor within a map. */
export type RpgAnchorId = string;

/** Stable identifier of a creature type (e.g. `ember`, `tide`). */
export type RpgTypeId = string;

/** Stable identifier of a move definition. */
export type RpgMoveId = string;

/** Stable identifier of a species definition. */
export type RpgSpeciesId = string;

/** Stable identifier of an item definition. */
export type RpgItemId = string;

/** Stable identifier of an encounter table. */
export type RpgEncounterTableId = string;

/** Stable identifier of a dialogue graph. */
export type RpgDialogueId = string;

/** Stable identifier of a node within one dialogue graph. */
export type RpgDialogueNodeId = string;

/**
 * Stable identifier of one creature instance. Derived from deterministic
 * creation addresses — never array indices or random UUIDs — so a save can
 * reference the same individual forever.
 */
export type RpgCreatureInstanceId = string;

/** Canonical content fingerprint (FNV over canonicalized content JSON). */
export type RpgFingerprint = string;

// ---------------------------------------------------------------------------
// Spatial and input vocabulary
// ---------------------------------------------------------------------------

/** The four cardinal directions; diagonals do not exist in v1 movement. */
export type RpgDirection = 'up' | 'down' | 'left' | 'right';

/** Integer tile coordinates within a map. */
export interface RpgTileRef {
  readonly tileX: number;
  readonly tileY: number;
}

/** Authoritative player location: map, tile, and facing. */
export interface RpgLocation {
  readonly mapId: RpgMapId;
  readonly tileX: number;
  readonly tileY: number;
  readonly facing: RpgDirection;
}

/**
 * One fixed-tick semantic input snapshot.
 *
 * The input adapter must supply **at most one** directional intent per tick;
 * the deterministic core never resolves simultaneous raw device directions.
 * Booleans are edge-qualified by the adapter (a held key arrives as `true`
 * only on the tick it becomes meaningful, per the fixed-loop input contract).
 * `battleCommand` carries the semantic battle command confirmed by the
 * battle menu on the tick the player commits it (the menu itself is
 * presentation; only the confirmed command reaches the simulation).
 */
export interface RpgInput {
  readonly direction: RpgDirection | null;
  readonly confirm: boolean;
  readonly cancel: boolean;
  readonly menu: boolean;
  readonly battleCommand: import('./battle-types').BattleCommand | null;
}

/** An `RpgInput` with no pressed semantics — the neutral tick. */
export const IDLE_RPG_INPUT: Readonly<RpgInput> = Object.freeze({
  direction: null,
  confirm: false,
  cancel: false,
  menu: false,
  battleCommand: null,
});

// ---------------------------------------------------------------------------
// Numeric vocabulary
// ---------------------------------------------------------------------------

/**
 * An explicit integer ratio (e.g. type effectiveness `2/1`, critical `3/2`).
 * Battle math multiplies numerators and denominators separately with explicit
 * floor points, so results never depend on floating evaluation order.
 */
export interface IntegerRatio {
  readonly numerator: number;
  readonly denominator: number;
}

/** The four battle-relevant stats. Base values live on species content. */
export interface CreatureStats {
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type RpgDiagnosticSeverity = 'error' | 'warning';

/**
 * A never-throw failure report. `path` locates the offending value inside
 * authored data (e.g. `species[2].learnset[1].moveId`); `code` is a stable
 * machine identifier (e.g. `rpg.content.duplicateId`) suitable for tests and
 * tooling. `message` is developer-facing English, not gameplay prose.
 */
export interface RpgDiagnostic {
  readonly code: string;
  readonly severity: RpgDiagnosticSeverity;
  readonly path: string;
  readonly message: string;
}
