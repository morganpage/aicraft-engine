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

import type { DialogueDefinition, DialogueEffect } from './dialogue';
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
import { canonicalize, fnv1a } from '../level/serialize';
import { validateRpgMap, validateRpgMapCatalog } from './validation';
import { RPG_LEVEL_CAP } from './constants';

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

const ALLOWED_MULTIPLIERS: ReadonlySet<string> = new Set(['2/1', '1/2', '1/1']);
const TERMINAL_EFFECT_KINDS: ReadonlySet<string> = new Set(['startBattle', 'warp', 'endDialogue']);

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value;
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function ratioKey(ratio: IntegerRatio): string {
  return `${ratio.numerator}/${ratio.denominator}`;
}

/**
 * Compile a content bundle: validate every id, integer range, weight,
 * cross-reference, the type-effectiveness matrix, dialogue reachability and
 * terminal-effect ordering, then index the content and fingerprint it.
 * Never throws — all failures are path-based diagnostics, and any error
 * yields `{ ok: false }` with no content. The fingerprint is the FNV-1a of
 * the canonicalized bundle; saves and traces bind to it.
 */
export function compileRpgContent(bundle: RpgContentBundle): RpgContentResult {
  const diagnostics: RpgDiagnostic[] = [];
  const push = (code: string, path: string, message: string) =>
    diagnostics.push({ code, severity: 'error', path, message });
  const warn = (code: string, path: string, message: string) =>
    diagnostics.push({ code, severity: 'warning', path, message });

  // --- types ---
  const typeIds: string[] = [];
  const types: Record<string, RpgTypeDefinition> = {};
  (bundle.types ?? []).forEach((type, i) => {
    if (types[type.id]) {
      push('rpg.content.duplicateId', `types[${i}].id`, `Duplicate type id '${type.id}'.`);
      return;
    }
    types[type.id] = type;
    typeIds.push(type.id);
  });
  const typeCount = typeIds.length;
  for (const attacker of bundle.types ?? []) {
    for (const defenderId of typeIds) {
      const ratio = attacker.effectiveness?.[defenderId];
      if (!ratio || !isInt(ratio?.numerator) || !isInt(ratio?.denominator) || ratio.denominator <= 0) {
        push(
          'rpg.content.typeMatrixIncomplete',
          `types[${attacker.id}].effectiveness[${defenderId}]`,
          `Effectiveness of '${attacker.id}' vs '${defenderId}' must be an integer ratio.`,
        );
      } else if (!ALLOWED_MULTIPLIERS.has(ratioKey(ratio))) {
        push(
          'rpg.content.typeMatrixMultiplier',
          `types[${attacker.id}].effectiveness[${defenderId}]`,
          `Multiplier ${ratioKey(ratio)} is not one of the allowed 2/1, 1/1, 1/2.`,
        );
      }
    }
    if (typeCount > 0 && Object.keys(attacker.effectiveness ?? {}).length > typeCount) {
      warn(
        'rpg.content.typeMatrixExtra',
        `types[${attacker.id}].effectiveness`,
        `Type '${attacker.id}' lists effectiveness against unknown types; extras are ignored.`,
      );
    }
  }

  // --- moves ---
  const moves: Record<string, MoveDefinition> = {};
  const moveIds: string[] = [];
  (bundle.moves ?? []).forEach((move, i) => {
    if (moves[move.id]) {
      push('rpg.content.duplicateId', `moves[${i}].id`, `Duplicate move id '${move.id}'.`);
      return;
    }
    if (!types[move.typeId]) {
      push('rpg.content.missingReference', `moves[${i}].typeId`, `Move '${move.id}' references unknown type '${move.typeId}'.`);
    }
    if (!isInt(move.power) || !inRange(move.power, 0, 50)) {
      push('rpg.content.invalidRange', `moves[${i}].power`, `Move '${move.id}' power must be an integer in 0–50.`);
    }
    if (!isInt(move.accuracyBasisPoints) || !inRange(move.accuracyBasisPoints, 0, 10000)) {
      push('rpg.content.invalidRange', `moves[${i}].accuracyBasisPoints`, `Move '${move.id}' accuracy must be an integer in 0–10000.`);
    }
    if (!isInt(move.priority) || !inRange(move.priority, -3, 3)) {
      push('rpg.content.invalidRange', `moves[${i}].priority`, `Move '${move.id}' priority must be an integer in −3–3.`);
    }
    moves[move.id] = move;
    moveIds.push(move.id);
  });

  // --- species ---
  const species: Record<string, SpeciesDefinition> = {};
  const speciesIds: string[] = [];
  (bundle.species ?? []).forEach((def, i) => {
    if (species[def.id]) {
      push('rpg.content.duplicateId', `species[${i}].id`, `Duplicate species id '${def.id}'.`);
      return;
    }
    if (!types[def.typeId]) {
      push('rpg.content.missingReference', `species[${i}].typeId`, `Species '${def.id}' references unknown type '${def.typeId}'.`);
    }
    const stats = def.baseStats ?? ({} as SpeciesDefinition['baseStats']);
    for (const key of ['hp', 'attack', 'defense', 'speed'] as const) {
      if (!isInt(stats[key]) || !inRange(stats[key] as number, 1, 255)) {
        push('rpg.content.invalidRange', `species[${i}].baseStats.${key}`, `Species '${def.id}' stat '${key}' must be an integer in 1–255.`);
      }
    }
    if (!isInt(def.catchBasisPoints) || !inRange(def.catchBasisPoints, 0, 10000)) {
      push('rpg.content.invalidRange', `species[${i}].catchBasisPoints`, `Species '${def.id}' catch rate must be an integer in 0–10000.`);
    }
    if (!isInt(def.expYield) || !inRange(def.expYield, 1, 255)) {
      push('rpg.content.invalidRange', `species[${i}].expYield`, `Species '${def.id}' exp yield must be an integer in 1–255.`);
    }
    let lastLevel = 0;
    const seenMoves = new Set<string>();
    (def.learnset ?? []).forEach((entry, j) => {
      if (!isInt(entry.level) || !inRange(entry.level, 1, RPG_LEVEL_CAP)) {
        push('rpg.content.invalidRange', `species[${i}].learnset[${j}].level`, `Species '${def.id}' learnset level must be an integer in 1–${RPG_LEVEL_CAP}.`);
      } else if (entry.level < lastLevel) {
        push('rpg.content.learnsetOrder', `species[${i}].learnset[${j}].level`, `Species '${def.id}' learnset must be in ascending level order.`);
      } else {
        lastLevel = entry.level;
      }
      if (!moves[entry.moveId]) {
        push('rpg.content.missingReference', `species[${i}].learnset[${j}].moveId`, `Species '${def.id}' references unknown move '${entry.moveId}'.`);
      }
      if (seenMoves.has(entry.moveId)) {
        push('rpg.content.duplicateId', `species[${i}].learnset[${j}].moveId`, `Species '${def.id}' learns move '${entry.moveId}' twice.`);
      }
      seenMoves.add(entry.moveId);
    });
    species[def.id] = def;
    speciesIds.push(def.id);
  });

  // --- items ---
  const items: Record<string, ItemDefinition> = {};
  const itemIds: string[] = [];
  (bundle.items ?? []).forEach((item, i) => {
    if (items[item.id]) {
      push('rpg.content.duplicateId', `items[${i}].id`, `Duplicate item id '${item.id}'.`);
      return;
    }
    if (item.kind === 'potion') {
      if (!isInt(item.healAmount) || !inRange(item.healAmount, 1, 999)) {
        push('rpg.content.invalidRange', `items[${i}].healAmount`, `Potion '${item.id}' heal amount must be an integer in 1–999.`);
      }
    } else if (item.kind === 'capture') {
      if (!isInt(item.catchBonusBasisPoints) || !inRange(item.catchBonusBasisPoints, 0, 9000)) {
        push('rpg.content.invalidRange', `items[${i}].catchBonusBasisPoints`, `Capture item '${item.id}' bonus must be an integer in 0–9000.`);
      }
    } else {
      push('rpg.content.itemKind', `items[${i}].kind`, `Item '${item.id}' kind must be 'potion' or 'capture'.`);
    }
    items[item.id] = item;
    itemIds.push(item.id);
  });

  // --- encounters ---
  const encounters: Record<string, EncounterTable> = {};
  const encounterIds: string[] = [];
  (bundle.encounters ?? []).forEach((table, i) => {
    if (encounters[table.id]) {
      push('rpg.content.duplicateId', `encounters[${i}].id`, `Duplicate encounter table id '${table.id}'.`);
      return;
    }
    if (!isInt(table.triggerBasisPoints) || !inRange(table.triggerBasisPoints, 0, 10000)) {
      push('rpg.content.invalidRange', `encounters[${i}].triggerBasisPoints`, `Encounter table '${table.id}' trigger rate must be an integer in 0–10000.`);
    }
    if (!table.entries || table.entries.length === 0) {
      push('rpg.content.emptyTable', `encounters[${i}].entries`, `Encounter table '${table.id}' must have at least one entry.`);
    }
    (table.entries ?? []).forEach((entry, j) => {
      if (!species[entry.speciesId]) {
        push('rpg.content.missingReference', `encounters[${i}].entries[${j}].speciesId`, `Encounter table '${table.id}' references unknown species '${entry.speciesId}'.`);
      }
      if (!isInt(entry.weight) || entry.weight <= 0) {
        push('rpg.content.invalidRange', `encounters[${i}].entries[${j}].weight`, `Encounter weights must be positive integers.`);
      }
      if (
        !isInt(entry.minLevel) || !isInt(entry.maxLevel) ||
        !inRange(entry.minLevel, 1, RPG_LEVEL_CAP) || !inRange(entry.maxLevel, 1, RPG_LEVEL_CAP) ||
        entry.minLevel > entry.maxLevel
      ) {
        push('rpg.content.invalidRange', `encounters[${i}].entries[${j}]`, `Encounter levels must be integers in 1–${RPG_LEVEL_CAP} with min ≤ max.`);
      }
    });
    encounters[table.id] = table;
    encounterIds.push(table.id);
  });

  // --- dialogues ---
  const dialogues: Record<string, DialogueDefinition> = {};
  const dialogueIds: string[] = [];
  const itemEffectRefs: { path: string; itemId: string }[] = [];
  const speciesEffectRefs: { path: string; itemId: string }[] = [];
  const mapEffectRefs: { path: string; mapId: string; anchorId: string }[] = [];
  (bundle.dialogues ?? []).forEach((dialogue, i) => {
    if (dialogues[dialogue.id]) {
      push('rpg.content.duplicateId', `dialogues[${i}].id`, `Duplicate dialogue id '${dialogue.id}'.`);
      return;
    }
    const nodes = dialogue.nodes ?? [];
    const nodeIds = new Set<string>();
    for (const node of nodes) nodeIds.add(node.id);
    if (!nodeIds.has(dialogue.entryNodeId)) {
      push('rpg.content.missingReference', `dialogues[${i}].entryNodeId`, `Dialogue '${dialogue.id}' entry node '${dialogue.entryNodeId}' does not exist.`);
    }
    const reachable = new Set<string>();
    const visit = (nodeId: string) => {
      if (reachable.has(nodeId) || !nodeIds.has(nodeId)) return;
      reachable.add(nodeId);
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      if (node.next) visit(node.next);
      for (const choice of node.choices ?? []) visit(choice.next);
    };
    visit(dialogue.entryNodeId);

    const checkEffects = (effects: readonly DialogueEffect[] | undefined, path: string) => {
      if (!effects) return;
      let terminalSeen = false;
      effects.forEach((effect, j) => {
        if (TERMINAL_EFFECT_KINDS.has(effect.kind)) {
          if (effects.length > 1 && j < effects.length - 1) {
            push('rpg.content.terminalEffectOrder', `${path}.effects[${j}]`, `Terminal effect '${effect.kind}' must be the sole and final effect.`);
          }
          if (terminalSeen) {
            push('rpg.content.terminalEffectOrder', `${path}.effects[${j}]`, `Only one terminal effect is allowed.`);
          }
          terminalSeen = true;
          if (effect.kind === 'startBattle') {
            speciesEffectRefs.push({ path: `${path}.effects[${j}]`, itemId: effect.speciesId });
          } else if (effect.kind === 'warp') {
            mapEffectRefs.push({ path: `${path}.effects[${j}]`, mapId: effect.mapId, anchorId: effect.anchorId });
          }
        } else if (effect.kind === 'giveItem' || effect.kind === 'takeItem') {
          itemEffectRefs.push({ path: `${path}.effects[${j}]`, itemId: effect.itemId });
          if (!isInt(effect.quantity) || effect.quantity <= 0) {
            push('rpg.content.invalidRange', `${path}.effects[${j}].quantity`, `Item effect quantity must be a positive integer.`);
          }
        }
      });
    };

    for (const node of nodes) {
      const nodePath = `dialogues[${dialogue.id}].nodes[${node.id}]`;
      if (!reachable.has(node.id)) {
        warn('rpg.content.dialogueUnreachableNode', nodePath, `Node '${node.id}' cannot be reached from the dialogue entry.`);
      }
      if (node.next && !nodeIds.has(node.next)) {
        push('rpg.content.missingReference', `${nodePath}.next`, `Node '${node.id}' targets unknown node '${node.next}'.`);
      }
      if (node.next && (node.choices ?? []).length > 0) {
        warn('rpg.content.dialogueAmbiguousExit', nodePath, `Node '${node.id}' defines both choices and a next; choices take precedence.`);
      }
      checkEffects(node.effects, nodePath);
      (node.choices ?? []).forEach((choice) => {
        const choicePath = `${nodePath}.choices[${choice.id}]`;
        if (!nodeIds.has(choice.next)) {
          push('rpg.content.missingReference', `${choicePath}.next`, `Choice '${choice.id}' targets unknown node '${choice.next}'.`);
        }
        checkEffects(choice.effects, choicePath);
        (choice.conditions ?? []).forEach((condition, j) => {
          if (condition.kind === 'hasItem' && !items[condition.itemId]) {
            push('rpg.content.missingReference', `${choicePath}.conditions[${j}].itemId`, `Condition references unknown item '${condition.itemId}'.`);
          }
        });
      });
    }
    dialogues[dialogue.id] = dialogue;
    dialogueIds.push(dialogue.id);
  });
  for (const ref of itemEffectRefs) {
    if (!items[ref.itemId]) {
      push('rpg.content.missingReference', `${ref.path}.itemId`, `Dialogue effect references unknown item '${ref.itemId}'.`);
    }
  }
  for (const ref of speciesEffectRefs) {
    if (!species[ref.itemId]) {
      push('rpg.content.missingReference', `${ref.path}.speciesId`, `Dialogue effect references unknown species '${ref.itemId}'.`);
    }
  }

  // --- maps ---
  const maps: Record<string, RpgMapDefinition> = {};
  const mapIds: string[] = [];
  const mapList: RpgMapDefinition[] = [];
  (bundle.maps ?? []).forEach((map, i) => {
    if (maps[map.id]) {
      push('rpg.content.duplicateId', `maps[${i}].id`, `Duplicate map id '${map.id}'.`);
      return;
    }
    for (const diagnostic of validateRpgMap(map)) {
      diagnostics.push({ ...diagnostic, path: `maps[${map.id}].${diagnostic.path}` });
    }
    for (const npc of map.npcs ?? []) {
      if (!dialogues[npc.dialogueId]) {
        push('rpg.content.missingReference', `maps[${map.id}].npcs[${npc.id}].dialogueId`, `NPC '${npc.id}' references unknown dialogue '${npc.dialogueId}'.`);
      }
    }
    const seen = new Set<string>();
    (map.encounterZones ?? []).forEach((zoneId, j) => {
      if (zoneId == null) return;
      if (!encounters[zoneId] && !seen.has(`missing:${zoneId}`)) {
        seen.add(`missing:${zoneId}`);
        push('rpg.content.missingReference', `maps[${map.id}].encounterZones[${j}]`, `Map references unknown encounter table '${zoneId}'.`);
      }
    });
    maps[map.id] = map;
    mapIds.push(map.id);
    mapList.push(map);
  });
  for (const diagnostic of validateRpgMapCatalog(mapList)) {
    diagnostics.push(diagnostic);
  }
  for (const ref of mapEffectRefs) {
    const target = maps[ref.mapId];
    if (!target) {
      push('rpg.content.missingReference', `${ref.path}.mapId`, `Dialogue effect references unknown map '${ref.mapId}'.`);
    } else if (!target.spawns.some((s) => s.id === ref.anchorId)) {
      push('rpg.content.missingReference', `${ref.path}.anchorId`, `Dialogue effect references unknown anchor '${ref.anchorId}' on map '${ref.mapId}'.`);
    }
  }

  const hasErrors = diagnostics.some((d) => d.severity === 'error');
  if (hasErrors) {
    return { ok: false, diagnostics };
  }

  const typeEffectiveness: Record<string, Readonly<Record<string, IntegerRatio>>> = {};
  for (const attacker of typeIds) {
    const row: Record<string, IntegerRatio> = {};
    for (const defender of typeIds) {
      row[defender] = types[attacker].effectiveness[defender] ?? { numerator: 1, denominator: 1 };
    }
    typeEffectiveness[attacker] = row;
  }

  const fingerprint: RpgFingerprint = `fnv1a-${fnv1a(canonicalize(bundle)).toString(16)}`;
  return {
    ok: true,
    diagnostics,
    content: {
      fingerprint,
      typeEffectiveness,
      types,
      typeIds,
      moves,
      moveIds,
      species,
      speciesIds,
      items,
      itemIds,
      encounters,
      encounterIds,
      dialogues,
      dialogueIds,
      maps,
      mapIds,
    },
  };
}
