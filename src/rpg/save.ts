/**
 * Versioned RPG save pipeline: projection, validation, migration, restore,
 * and hashing.
 *
 * Saving is restricted to stable idle overworld state — mid-dialogue and
 * mid-battle saves are rejected as safe no-ops with diagnostics. Every
 * entry point is defensive: corrupt input produces diagnostics, never a
 * throw. The hash delegates to the canonicalize/FNV pipeline; restoration
 * refuses content-fingerprint mismatches by default so a save can never
 * silently run against different rules or content.
 */

import { canonicalize, fnv1a } from '../level/serialize';
import type { CompiledRpgContent } from './content';
import type { InventoryState } from './inventory';
import type { PartyState } from './party';
import { isSaveEligible } from './state';
import type { RpgState } from './state';
import type { RpgLocation } from './types';
import type { RpgDiagnostic } from './types';
import type { SerializableRngState } from '../rng/state';
import { RPG_RULES_VERSION, RPG_SAVE_SCHEMA_VERSION } from './constants';

/** The persisted envelope; battle/dialogue presentation is absent by design. */
export interface RpgSaveData {
  readonly schemaVersion: number;
  readonly rulesVersion: number;
  readonly contentFingerprint: string;
  readonly rootSeed: number;
  readonly tick: number;
  readonly location: RpgLocation;
  readonly lastHealAnchor: RpgLocation;
  readonly party: PartyState;
  readonly inventory: InventoryState;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly worldRng: SerializableRngState;
  readonly encounterIndex: number;
}

export interface RpgSaveResult {
  readonly save?: RpgSaveData;
  readonly diagnostics: readonly RpgDiagnostic[];
}

export interface RpgSaveMigrationResult {
  readonly save?: RpgSaveData;
  readonly diagnostics: readonly RpgDiagnostic[];
}

export interface RpgSaveValidationResult {
  readonly ok: boolean;
  readonly diagnostics: readonly RpgDiagnostic[];
}

export interface RpgRestoreResult {
  readonly state?: RpgState;
  readonly diagnostics: readonly RpgDiagnostic[];
}

function diagnostic(code: string, path: string, message: string): RpgDiagnostic {
  return { code, severity: 'error', path, message };
}

/**
 * Project a save envelope from a session state. Only stable idle overworld
 * states are save-eligible; anything else is a no-op with a diagnostic.
 */
export function createRpgSave(state: RpgState): RpgSaveResult {
  if (!isSaveEligible(state)) {
    return {
      diagnostics: [diagnostic(
        'rpg.save.notEligible',
        'activity',
        `Cannot save from activity '${state.activity.kind}' — saving requires an idle overworld state.`,
      )],
    };
  }
  return {
    save: {
      schemaVersion: RPG_SAVE_SCHEMA_VERSION,
      rulesVersion: state.rulesVersion,
      contentFingerprint: state.contentFingerprint,
      rootSeed: state.rootSeed,
      tick: state.tick,
      location: state.activity.kind === 'overworld' ? state.activity.overworld.location : state.lastHealAnchor,
      lastHealAnchor: state.lastHealAnchor,
      party: state.party,
      inventory: state.inventory,
      flags: state.flags,
      worldRng: state.worldRng,
      encounterIndex: state.encounterIndex,
    },
    diagnostics: [],
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validLocation(value: unknown): value is RpgLocation {
  return isPlainObject(value)
    && typeof value.mapId === 'string'
    && Number.isInteger(value.tileX)
    && Number.isInteger(value.tileY)
    && (value.facing === 'up' || value.facing === 'down' || value.facing === 'left' || value.facing === 'right');
}

/**
 * Migrate a raw persisted value toward the current save schema. v1 is the
 * current version, so today this validates shape and passes through; older
 * versions would step up a ladder before validating. Corrupt input returns
 * diagnostics without a save.
 */
export function migrateRpgSave(raw: unknown): RpgSaveMigrationResult {
  if (!isPlainObject(raw)) {
    return { diagnostics: [diagnostic('rpg.save.corrupt', 'save', 'Save data is not a JSON object.')] };
  }
  const schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : NaN;
  if (!Number.isInteger(schemaVersion)) {
    return { diagnostics: [diagnostic('rpg.save.corrupt', 'schemaVersion', 'Save schema version is missing or not an integer.')] };
  }
  if (schemaVersion > RPG_SAVE_SCHEMA_VERSION) {
    return { diagnostics: [diagnostic(
      'rpg.save.futureVersion',
      'schemaVersion',
      `Save schema version ${schemaVersion} is newer than the supported ${RPG_SAVE_SCHEMA_VERSION}.`,
    )] };
  }
  // v1 → v1: passthrough once the ladder grows, migrations step here.
  return { save: raw as unknown as RpgSaveData, diagnostics: [] };
}

/**
 * Validate a migrated save against compiled content: fingerprint and rules
 * binding, structural shape, species references, party bounds, and a
 * resolvable location. Warnings do not fail validation.
 */
export function validateRpgSave(save: RpgSaveData, content: CompiledRpgContent): RpgSaveValidationResult {
  const diagnostics: RpgDiagnostic[] = [];

  if (save.contentFingerprint !== content.fingerprint) {
    diagnostics.push(diagnostic(
      'rpg.save.fingerprintMismatch',
      'contentFingerprint',
      `Save was made against content '${save.contentFingerprint}' but the compiled content is '${content.fingerprint}'.`,
    ));
  }
  if (save.rulesVersion !== RPG_RULES_VERSION) {
    diagnostics.push(diagnostic(
      'rpg.save.rulesMismatch',
      'rulesVersion',
      `Save rules version ${String(save.rulesVersion)} does not match engine rules ${RPG_RULES_VERSION}.`,
    ));
  }
  if (!validLocation(save.location)) {
    diagnostics.push(diagnostic('rpg.save.corrupt', 'location', 'Save location is malformed.'));
  } else if (!content.maps[save.location.mapId]) {
    diagnostics.push(diagnostic('rpg.save.mapMissing', 'location.mapId', `Save references unknown map '${save.location.mapId}'.`));
  }
  if (!validLocation(save.lastHealAnchor)) {
    diagnostics.push(diagnostic('rpg.save.corrupt', 'lastHealAnchor', 'Heal anchor is malformed.'));
  }
  if (!Array.isArray(save.party) || save.party.length < 1 || save.party.length > 6) {
    diagnostics.push(diagnostic('rpg.save.corrupt', 'party', 'Party must contain 1–6 creatures.'));
  } else {
    (save.party as unknown[]).forEach((rawMember, index) => {
      const member = rawMember as { speciesId?: unknown };
      if (!isPlainObject(member) || typeof member.speciesId !== 'string' || !content.species[member.speciesId]) {
        diagnostics.push(diagnostic('rpg.save.speciesMissing', `party[${index}].speciesId`, `Party member ${index} references an unknown species.`));
      }
    });
  }
  if (!Array.isArray(save.inventory)) {
    diagnostics.push(diagnostic('rpg.save.corrupt', 'inventory', 'Inventory is malformed.'));
  }
  if (!isPlainObject(save.flags)) {
    diagnostics.push(diagnostic('rpg.save.corrupt', 'flags', 'Flags record is malformed.'));
  }
  if (!isPlainObject(save.worldRng) || !Number.isInteger(save.worldRng.value)) {
    diagnostics.push(diagnostic('rpg.save.corrupt', 'worldRng', 'World RNG state is malformed.'));
  }
  if (!Number.isInteger(save.encounterIndex) || save.encounterIndex < 0) {
    diagnostics.push(diagnostic('rpg.save.corrupt', 'encounterIndex', 'Encounter index must be a non-negative integer.'));
  }

  return { ok: !diagnostics.some((d) => d.severity === 'error'), diagnostics };
}

/**
 * Restore a session state from a validated save. The restored session is an
 * idle overworld activity at the saved location; the world RNG cursor,
 * encounter index, party, inventory, flags, and heal anchor continue
 * exactly where they left off.
 */
export function restoreRpgState(save: RpgSaveData, content: CompiledRpgContent): RpgRestoreResult {
  const validation = validateRpgSave(save, content);
  if (!validation.ok) {
    return { diagnostics: validation.diagnostics };
  }
  return {
    state: {
      schemaVersion: 1,
      rulesVersion: save.rulesVersion,
      tick: save.tick,
      rootSeed: save.rootSeed,
      contentFingerprint: save.contentFingerprint,
      activity: {
        kind: 'overworld',
        overworld: { location: save.location, step: null },
      },
      party: save.party,
      inventory: save.inventory,
      flags: save.flags,
      worldRng: save.worldRng,
      encounterIndex: save.encounterIndex,
      lastHealAnchor: save.lastHealAnchor,
    },
    diagnostics: validation.diagnostics,
  };
}

/** Canonical FNV-1a hash of a save envelope (checksums, never proof alone). */
export function rpgSaveHash(save: RpgSaveData): number {
  return fnv1a(canonicalize(save));
}
