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
  RpgDiagnostic,
  RpgDirection,
  RpgItemId,
  RpgMapId,
  RpgSpeciesId,
} from './types';
import type { InventoryState } from './inventory';

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
 * Deterministic dialogue session state: the current node plus the cursor
 * over the currently offered (legal) choices. The cursor advances only
 * through semantic input; typewriter reveal never touches it.
 */
export interface DialogueSession {
  readonly currentNodeId: RpgDialogueNodeId;
  readonly cursor: number;
}

/** Snapshot the facade/UI needs to render the current dialogue beat. */
export interface DialogueRequest {
  readonly nodeId: RpgDialogueNodeId;
  readonly speakerId: string;
  readonly text: string;
  /** Legal choices only: conditions already evaluated and filtered. */
  readonly choices: readonly { readonly id: string; readonly text: string }[];
  readonly cursor: number;
}

/** Everything a dialogue condition may read. Supplied by the facade. */
export interface DialogueContext {
  readonly flags: Readonly<Record<string, boolean>>;
  readonly inventory: InventoryState;
  readonly partySize: number;
  readonly maxPartySize: number;
}

/** One semantic dialogue command from the input layer. */
export type DialogueCommand =
  | { readonly type: 'advance' }
  | { readonly type: 'choose'; readonly choiceId: string };

/** Result of one dialogue advance. `session: null` means the dialogue ended. */
export interface DialogueAdvanceResult {
  readonly session: DialogueSession | null;
  /** Effects to apply once (terminal effects included, in authored order). */
  readonly effects: readonly DialogueEffect[];
  readonly diagnostics: readonly RpgDiagnostic[];
}

function nodeById(
  definition: DialogueDefinition,
  nodeId: RpgDialogueNodeId,
): DialogueNode | null {
  for (const node of definition.nodes) {
    if (node.id === nodeId) return node;
  }
  return null;
}

function conditionPasses(
  condition: DialogueCondition,
  context: DialogueContext,
): boolean {
  switch (condition.kind) {
    case 'flagEquals':
      return (context.flags[condition.flag] ?? false) === condition.value;
    case 'hasItem': {
      let count = 0;
      for (const entry of context.inventory) {
        if (entry.itemId === condition.itemId) count += entry.quantity;
      }
      return count >= (condition.minCount ?? 1);
    }
    case 'partyHasSpace':
      return context.partySize < context.maxPartySize;
    default:
      return false;
  }
}

/** Begin a dialogue session at its entry node. */
export function startDialogue(definition: DialogueDefinition): DialogueSession {
  return { currentNodeId: definition.entryNodeId, cursor: 0 };
}

/**
 * Build the current request: text plus the legal (condition-passing)
 * choices and cursor. Returns `null` defensively when the current node is
 * missing — treat as invalid content, never a crash.
 */
export function getDialogueRequest(
  definition: DialogueDefinition,
  session: DialogueSession,
  context: DialogueContext,
): DialogueRequest | null {
  const node = nodeById(definition, session.currentNodeId);
  if (!node) return null;
  const choices = (node.choices ?? []).filter(
    (choice) => (choice.conditions ?? []).every((condition) => conditionPasses(condition, context)),
  );
  const cursor = choices.length === 0 ? 0 : Math.min(session.cursor, choices.length - 1);
  return {
    nodeId: node.id,
    speakerId: node.speakerId,
    text: node.text,
    choices: choices.map((choice) => ({ id: choice.id, text: choice.text })),
    cursor,
  };
}

/**
 * Advance one semantic step. `advance` is only legal on choice-less nodes;
 * `choose` picks a currently legal choice. The returned effects fire once —
 * the facade applies non-terminal effects in order, then performs the sole
 * terminal handoff if one is present. Never throws: illegal commands are
 * no-ops with diagnostics.
 */
export function advanceDialogue(
  definition: DialogueDefinition,
  session: DialogueSession,
  command: DialogueCommand,
  context: DialogueContext,
): DialogueAdvanceResult {
  const node = nodeById(definition, session.currentNodeId);
  if (!node) {
    return {
      session: null,
      effects: [],
      diagnostics: [{
        code: 'rpg.dialogue.nodeMissing',
        severity: 'error',
        path: `dialogues[${definition.id}].nodes[${session.currentNodeId}]`,
        message: `Dialogue node '${session.currentNodeId}' does not exist.`,
      }],
    };
  }

  if (command.type === 'advance') {
    if (node.choices && node.choices.length > 0) {
      return {
        session,
        effects: [],
        diagnostics: [{
          code: 'rpg.dialogue.requiresChoice',
          severity: 'error',
          path: `dialogues[${definition.id}].nodes[${node.id}]`,
          message: `Node '${node.id}' offers choices; a concrete choice id is required.`,
        }],
      };
    }
    if (node.next) {
      return { session: { currentNodeId: node.next, cursor: 0 }, effects: node.effects ?? [], diagnostics: [] };
    }
    return { session: null, effects: node.effects ?? [], diagnostics: [] };
  }

  const legal = (node.choices ?? []).filter(
    (choice) => (choice.conditions ?? []).every((condition) => conditionPasses(condition, context)),
  );
  const choice = legal.find((c) => c.id === command.choiceId)
    ?? (node.choices ?? []).find((c) => c.id === command.choiceId);
  if (!choice) {
    return {
      session,
      effects: [],
      diagnostics: [{
        code: 'rpg.dialogue.choiceUnknown',
        severity: 'error',
        path: `dialogues[${definition.id}].nodes[${node.id}].choices[${command.choiceId}]`,
        message: `Choice '${command.choiceId}' does not exist on node '${node.id}'.`,
      }],
    };
  }
  if (!legal.includes(choice)) {
    return {
      session,
      effects: [],
      diagnostics: [{
        code: 'rpg.dialogue.choiceUnavailable',
        severity: 'error',
        path: `dialogues[${definition.id}].nodes[${node.id}].choices[${command.choiceId}]`,
        message: `Choice '${command.choiceId}' exists but its conditions do not currently pass.`,
      }],
    };
  }
  return {
    session: { currentNodeId: choice.next, cursor: 0 },
    effects: choice.effects ?? [],
    diagnostics: [],
  };
}

/**
 * Move the session cursor within the current legal choices. Pure no-op when
 * the current node has no choices or the movement is zero.
 */
export function moveDialogueCursor(
  definition: DialogueDefinition,
  session: DialogueSession,
  delta: number,
  context: DialogueContext,
): DialogueSession {
  if (delta === 0) return session;
  const request = getDialogueRequest(definition, session, context);
  if (!request || request.choices.length === 0) return session;
  const cursor = Math.min(request.choices.length - 1, Math.max(0, request.cursor + delta));
  return { ...session, cursor };
}
