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

export { IDLE_RPG_INPUT } from './types';
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
export { grantItem, consumeItem, getItemCount } from './inventory';

export type { EncounterEntry, EncounterTable, EncounterRollResult } from './encounters';
export { rollEncounter, deriveEncounterSeeds } from './encounters';

export type {
  DialogueCondition,
  DialogueEffect,
  DialogueChoice,
  DialogueNode,
  DialogueDefinition,
  DialogueSession,
  DialogueRequest,
  DialogueContext,
  DialogueCommand,
  DialogueAdvanceResult,
} from './dialogue';
export {
  startDialogue,
  getDialogueRequest,
  advanceDialogue,
  moveDialogueCursor,
} from './dialogue';

export { grantXpAward, xpForLevelStart, xpThresholdToAdvance } from './progression';
export type { ProgressionEvent, XpAwardResult } from './progression';

export { generateSpecies, generateSpeciesSet } from './creature-generator';
export type { SpeciesCatalog } from './creature-generator';

export { compileRpgContent } from './content';

export {
  createStarterContentBundle,
  STARTER_TYPES,
  STARTER_TYPE_IDS,
  STARTER_MOVES,
  STARTER_ITEMS,
  STARTER_DIALOGUE,
  STARTER_PARTY_LEVEL,
  STARTER_SPAWN_ANCHOR_ID,
  STARTER_WILD_LEVEL_RANGE,
} from './starter';

export { createCreatureInstance } from './creatures';
export { partyHasSpace, appendCreature, firstAliveIndex, aliveCount } from './party';

export type {
  BattleCommand,
  BattlePhase,
  BattleOutcome,
  BattleRequest,
  BattleState,
  BattleEvent,
} from './battle-types';
export {
  createBattleState,
  getBattleRequest,
  advanceBattle,
  DEFAULT_BATTLE_CONFIG,
} from './battle';
export type { BattleConfig } from './battle';
export {
  computeBattleDamage,
  computeCaptureChanceBasisPoints,
  computeFleeChanceBasisPoints,
  DEFAULT_CRITICAL_CHANCE_BP,
  CRITICAL_RATIO,
  VARIANCE_MIN_PERCENT,
  VARIANCE_MAX_PERCENT,
  CAPTURE_MISSING_HP_BONUS_BP,
  CAPTURE_CHANCE_MIN_BP,
  CAPTURE_CHANCE_MAX_BP,
  FLEE_BASE_BP,
  FLEE_SPEED_FACTOR_BP,
  FLEE_ATTEMPT_BONUS_BP,
  FLEE_CHANCE_MIN_BP,
  FLEE_CHANCE_MAX_BP,
} from './battle-math';
export { createBattleSimulationAdapter, BATTLE_ADAPTER_ID } from './battle-simtest';
export type { BattleScenario } from './battle-simtest';

export type {
  RpgTypeDefinition,
  RpgContentBundle,
  CompiledRpgContent,
  RpgContentResult,
} from './content';

export type {
  RpgTerrainColors,
  RpgMarkerColors,
  RpgActorColors,
  RpgPanelColors,
  RpgVisualTheme,
} from './renderer/theme';
export { DEFAULT_RPG_THEME } from './renderer/theme';
export { drawRpgMap, drawRpgEncounterShimmer } from './renderer/map-renderer';
export type { RpgMapDrawOptions } from './renderer/map-renderer';
export { drawRpgActor, drawRpgNpc } from './renderer/actor-renderer';
export type { RpgActorFacing, RpgActorDrawOptions, RpgNpcDrawOptions } from './renderer/actor-renderer';
export { drawRpgCreature } from './renderer/creature-renderer';
export type { CreatureDrawOptions } from './renderer/creature-renderer';
export { drawRpgDialogue, wrapDialogueText } from './renderer/dialogue-renderer';
export type { RpgDialogueDrawOptions } from './renderer/dialogue-renderer';
export { drawRpgBattleScene, createBattlePresentationQueue } from './renderer/battle-renderer';
export type { RpgBattleDrawOptions, BattleCue, BattlePresentationQueue } from './renderer/battle-renderer';
export { drawHpBar, drawPartyHud, drawInventoryHud } from './renderer/hud-renderer';
export type { RpgHudDrawOptions, HpBarParams } from './renderer/hud-renderer';

export { playRpgCue, rpgCueForBattleEvent, RPG_CUE_RECIPES } from './audio';
export type { RpgCue } from './audio';

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
export {
  createRpgState,
  createRpgController,
  getEffectiveParty,
  getEffectiveInventory,
  isSaveEligible,
} from './state';

export {
  createRpgSave,
  migrateRpgSave,
  validateRpgSave,
  restoreRpgState,
  rpgSaveHash,
} from './save';
export type {
  RpgSaveData,
  RpgSaveResult,
  RpgSaveMigrationResult,
  RpgSaveValidationResult,
  RpgRestoreResult,
} from './save';
