/**
 * RPG renderer barrel. Every renderer takes a `CanvasRenderingContext2D`,
 * authoritative read-only state, immutable visual configuration, and a
 * presentation tick — and returns no gameplay state. Decorative randomness
 * is addressed by visual seeds and never feeds simulation.
 */

export type { RpgTerrainColors, RpgMarkerColors, RpgActorColors, RpgPanelColors, RpgVisualTheme } from './theme';
export { DEFAULT_RPG_THEME } from './theme';

export { drawRpgMap, drawRpgEncounterShimmer } from './map-renderer';
export type { RpgMapDrawOptions } from './map-renderer';

export { drawRpgActor, drawRpgNpc } from './actor-renderer';
export type { RpgActorFacing, RpgActorDrawOptions, RpgNpcDrawOptions } from './actor-renderer';

export { drawRpgCreature } from './creature-renderer';
export type { CreatureDrawOptions } from './creature-renderer';

export { drawRpgDialogue, wrapDialogueText } from './dialogue-renderer';
export type { RpgDialogueDrawOptions } from './dialogue-renderer';

export { drawRpgBattleScene, createBattlePresentationQueue } from './battle-renderer';
export type { RpgBattleDrawOptions, BattleCue, BattlePresentationQueue } from './battle-renderer';

export { drawHpBar, drawPartyHud, drawInventoryHud } from './hud-renderer';
export type { RpgHudDrawOptions, HpBarParams } from './hud-renderer';
