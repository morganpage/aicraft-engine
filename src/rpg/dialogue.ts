/**
 * Dialogue graphs.
 *
 * A dialogue is a graph of stable node IDs. The deterministic reducer
 * (`advanceDialogue`, Milestone 2) accepts only semantic `advance`/`choose`
 * commands; typewriter reveal and animations are presentation concerns.
 *
 * Effects are typed discriminated-union variants — never script strings or
 * callbacks. `startBattle`, `warp`, and `endDialogue` are **terminal**: they
 * must be the sole and final effect of a node or choice, which content
 * compilation enforces so the facade has exactly one unambiguous handoff.
 */

import type {
  RpgAnchorId,
  RpgDialogueId,
  RpgDialogueNodeId,
  RpgDirection,
  RpgItemId,
  RpgMapId,
  RpgSpeciesId,
} from './types';

/** Conditions that may gate a dialogue choice. All must pass to offer it. */
export type DialogueCondition =
  | { readonly kind: 'flagEquals'; readonly flag: string; readonly value: boolean }
  | { readonly kind: 'hasItem'; readonly itemId: RpgItemId; readonly minCount?: number }
  | { readonly kind: 'partyHasSpace' };

/** Effects the facade applies once when their node/choice is committed. */
export type DialogueEffect =
  | { readonly kind: 'setFlag'; readonly flag: string; readonly value: boolean }
  | { readonly kind: 'giveItem'; readonly itemId: RpgItemId; readonly quantity: number }
  | { readonly kind: 'takeItem'; readonly itemId: RpgItemId; readonly quantity: number }
  | { readonly kind: 'healParty' }
  /** Terminal: ends dialogue and enters a wild battle against this creature. */
  | { readonly kind: 'startBattle'; readonly speciesId: RpgSpeciesId; readonly level: number }
  /** Terminal: ends dialogue and warps the player. */
  | { readonly kind: 'warp'; readonly mapId: RpgMapId; readonly anchorId: RpgAnchorId; readonly facing: RpgDirection }
  /** Terminal: ends dialogue without further effects. */
  | { readonly kind: 'endDialogue' };

/** A selectable reply. `next` is the node entered when chosen. */
export interface DialogueChoice {
  readonly id: string;
  readonly text: string;
  readonly next: RpgDialogueNodeId;
  readonly conditions?: readonly DialogueCondition[];
  readonly effects?: readonly DialogueEffect[];
}

/**
 * One line of dialogue. Without choices, `next` continues (absent `next`
 * ends the dialogue after applying effects). With choices, the offered set
 * is the choices whose conditions all pass.
 */
export interface DialogueNode {
  readonly id: RpgDialogueNodeId;
  readonly speakerId: string;
  readonly text: string;
  readonly choices?: readonly DialogueChoice[];
  readonly next?: RpgDialogueNodeId;
  readonly effects?: readonly DialogueEffect[];
}

/** A dialogue graph anchored at an entry node. */
export interface DialogueDefinition {
  readonly id: RpgDialogueId;
  readonly entryNodeId: RpgDialogueNodeId;
  readonly nodes: readonly DialogueNode[];
}

/**
 * Deterministic dialogue session state: which node is currently displayed.
 * The Milestone 2 reducer (`advanceDialogue`) advances it from semantic
 * `advance`/`choose` commands; typewriter reveal never touches it.
 */
export interface DialogueSession {
  readonly currentNodeId: RpgDialogueNodeId;
}
