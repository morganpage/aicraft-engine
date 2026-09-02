/**
 * RPG module barrel — top-down monster-tamer vertical-slice APIs.
 *
 * Milestone 0 ships the deterministic contracts (types + versioned
 * constants); reducers, generators, renderers, and the save pipeline land
 * with their milestones per `RPG_STARTER_PLAN.md`. All names are
 * `Rpg`/`Battle`/`RPG_`-prefixed or otherwise unique so the root wildcard
 * export can never silently drop an ambiguous name.
 */

export {
  RPG_STATE_SCHEMA_VERSION,
  RPG_CONTENT_SCHEMA_VERSION,
  RPG_SAVE_SCHEMA_VERSION,
  RPG_RULES_VERSION,
  RPG_GENERATOR_VERSION,
  ENCOUNTER_ROLL_PACK_SIZE,
  BATTLE_FIGHT_DRAW_BUDGET,
  BATTLE_CATCH_DRAW_BUDGET,
  BATTLE_SWITCH_DRAW_BUDGET,
  BATTLE_FLEE_DRAW_BUDGET,
  RPG_MAX_PARTY_SIZE,
  RPG_MAX_MOVES_PER_CREATURE,
  RPG_LEVEL_CAP,
  DEFAULT_RPG_CONFIG,
} from './constants';

export type {
  RpgMapId,
  RpgAnchorId,
  RpgTypeId,
  RpgMoveId,
  RpgSpeciesId,
  RpgItemId,
  RpgEncounterTableId,
  RpgDialogueId,
  RpgDialogueNodeId,
  RpgCreatureInstanceId,
  RpgFingerprint,
  RpgDirection,
  RpgTileRef,
  RpgLocation,
  RpgInput,
  IntegerRatio,
  CreatureStats,
  RpgDiagnosticSeverity,
  RpgDiagnostic,
} from './types';

export type {
  RpgTerrainKind,
  RpgMapDefinition,
  RpgSpawnAnchor,
  RpgNpcDefinition,
  RpgWarpDefinition,
  RpgHealPointDefinition,
} from './map';

export {
  advanceGridMovement,
  createOverworldAtAnchor,
} from './movement';
export type { GridMovementResult } from './movement';

export {
  facingTile,
  npcAt,
  resolveInteraction,
  resolveArrival,
} from './interaction';
export type { GridArrival, InteractionResolution } from './interaction';

export { validateRpgMap, validateRpgMapCatalog } from './validation';

export { verifyRpgWorld } from './map-verify';
export type { RpgWorldVerificationResult } from './map-verify';

export {
  generateRpgWorld,
  DEFAULT_WORLD_GEN_CONFIG,
  STARTER_FIELD_MAP_ID,
  STARTER_CLINIC_MAP_ID,
  STARTER_FIELD_START_ID,
  STARTER_FIELD_RETURN_ID,
  STARTER_CLINIC_ENTRY_ID,
} from './mapgen';
export type { RpgWorldGenConfig, RpgWorldGenResult } from './mapgen';

export type {
  RpgBodyPlan,
  CreatureVisualManifest,
  MoveDefinition,
  SpeciesDefinition,
  CreatureInstance,
} from './creatures';
export { deriveMaxHp, deriveCreatureStats } from './creatures';

export type { PartyState } from './party';
export { healPartyFully } from './party';

export type {
  RpgItemKind,
  ItemDefinition,
  InventoryEntry,
  InventoryState,
} from './inventory';

export type { EncounterEntry, EncounterTable } from './encounters';

export type {
  DialogueCondition,
  DialogueEffect,
  DialogueChoice,
  DialogueNode,
  DialogueDefinition,
  DialogueSession,
} from './dialogue';

export type {
  BattleCommand,
  BattlePhase,
  BattleOutcome,
  BattleRequest,
  BattleState,
  BattleEvent,
} from './battle-types';

export type {
  RpgTypeDefinition,
  RpgContentBundle,
  CompiledRpgContent,
  RpgContentResult,
} from './content';

export type {
  RpgActivity,
  OverworldState,
  GridStepState,
  MapTransitionState,
  DialogueActivityState,
  RpgState,
  RpgEvent,
  RpgStepResult,
  RpgConfig,
  RpgStart,
  RpgController,
} from './state';
