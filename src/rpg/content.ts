/**
 * The content bundle and its compile result.
 *
 * Content is authored (or AI-generated) as one JSON-serializable bundle.
 * `compileRpgContent` (Milestone 2) validates unique IDs, every
 * cross-reference, weights, ranges, the type-effectiveness matrix, dialogue
 * reachability, and terminal-effect ordering — never throwing, reporting
 * path-based diagnostics instead — and produces an immutable indexed
 * `CompiledRpgContent` plus a canonical fingerprint that saves and traces
 * bind to.
 */

import type { DialogueDefinition } from './dialogue';
import type { EncounterTable } from './encounters';
import type { ItemDefinition } from './inventory';
import type { RpgMapDefinition } from './map';
import type { MoveDefinition, SpeciesDefinition } from './creatures';
import type {
  IntegerRatio,
  RpgDiagnostic,
  RpgDialogueId,
  RpgEncounterTableId,
  RpgFingerprint,
  RpgItemId,
  RpgMapId,
  RpgMoveId,
  RpgSpeciesId,
  RpgTypeId,
} from './types';

/** A creature type: display name plus this type's effectiveness as attacker. */
export interface RpgTypeDefinition {
  readonly id: RpgTypeId;
  readonly name: string;
  /**
   * Attack effectiveness against every other type id (and itself), as
   * integer ratios. The matrix must be complete; missing or non-allowed
   * multipliers are compile errors.
   */
  readonly effectiveness: Readonly<Record<RpgTypeId, IntegerRatio>>;
}

/** Everything a game is made of, as data. */
export interface RpgContentBundle {
  readonly schemaVersion: 1;
  readonly types: readonly RpgTypeDefinition[];
  readonly moves: readonly MoveDefinition[];
  readonly species: readonly SpeciesDefinition[];
  readonly items: readonly ItemDefinition[];
  readonly encounters: readonly EncounterTable[];
  readonly dialogues: readonly DialogueDefinition[];
  readonly maps: readonly RpgMapDefinition[];
}

/**
 * Immutable validated content: lookup records for O(1) reference plus the
 * ordered id arrays preserving authoring order. Records are plain objects —
 * never `Map`/`Set` — so the shape stays JSON-friendly.
 */
export interface CompiledRpgContent {
  readonly fingerprint: RpgFingerprint;
  readonly typeEffectiveness: Readonly<Record<RpgTypeId, Readonly<Record<RpgTypeId, IntegerRatio>>>>;
  readonly types: Readonly<Record<RpgTypeId, RpgTypeDefinition>>;
  readonly typeIds: readonly RpgTypeId[];
  readonly moves: Readonly<Record<RpgMoveId, MoveDefinition>>;
  readonly moveIds: readonly RpgMoveId[];
  readonly species: Readonly<Record<RpgSpeciesId, SpeciesDefinition>>;
  readonly speciesIds: readonly RpgSpeciesId[];
  readonly items: Readonly<Record<RpgItemId, ItemDefinition>>;
  readonly itemIds: readonly RpgItemId[];
  readonly encounters: Readonly<Record<RpgEncounterTableId, EncounterTable>>;
  readonly encounterIds: readonly RpgEncounterTableId[];
  readonly dialogues: Readonly<Record<RpgDialogueId, DialogueDefinition>>;
  readonly dialogueIds: readonly RpgDialogueId[];
  readonly maps: Readonly<Record<RpgMapId, RpgMapDefinition>>;
  readonly mapIds: readonly RpgMapId[];
}

/**
 * Compile outcome. `ok: false` carries error diagnostics and no content —
 * callers must not run a game on an uncompiled bundle. Warnings ride along
 * with a successful compile.
 */
export type RpgContentResult =
  | { readonly ok: true; readonly content: CompiledRpgContent; readonly diagnostics: readonly RpgDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly RpgDiagnostic[] };
