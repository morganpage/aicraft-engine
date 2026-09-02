import { describe, it, expect } from 'vitest';
import {
  startDialogue,
  getDialogueRequest,
  advanceDialogue,
  moveDialogueCursor,
  type DialogueContext,
  type DialogueDefinition,
} from '../dialogue';

const DIALOGUE: DialogueDefinition = {
  id: 'dlg-test',
  entryNodeId: 'greet',
  nodes: [
    {
      id: 'greet',
      speakerId: 'guide',
      text: 'Hello!',
      choices: [
        { id: 'ask', text: 'Advice?', next: 'tip' },
        {
          id: 'secret',
          text: 'Gimme a potion',
          next: 'tip',
          conditions: [{ kind: 'flagEquals', flag: 'trusted', value: true }],
        },
      ],
    },
    {
      id: 'tip',
      speakerId: 'guide',
      text: 'Weaken before you capture.',
      next: 'bye-node',
      effects: [{ kind: 'setFlag', flag: 'tipped', value: true }],
    },
    {
      id: 'bye-node',
      speakerId: 'guide',
      text: 'Farewell!',
      effects: [{ kind: 'giveItem', itemId: 'potion', quantity: 1 }],
    },
  ],
};

const CONTEXT: DialogueContext = { flags: {}, inventory: [], partySize: 1, maxPartySize: 6 };

describe('dialogue runtime', () => {
  it('starts at the entry node and exposes only legal choices', () => {
    const session = startDialogue(DIALOGUE);
    const request = getDialogueRequest(DIALOGUE, session, CONTEXT);
    expect(request?.nodeId).toBe('greet');
    expect(request?.choices.map((choice) => choice.id)).toEqual(['ask']);
  });

  it('reveals condition-gated choices only when conditions pass', () => {
    const trusted: DialogueContext = { ...CONTEXT, flags: { trusted: true } };
    const request = getDialogueRequest(DIALOGUE, startDialogue(DIALOGUE), trusted);
    expect(request?.choices.map((choice) => choice.id)).toEqual(['ask', 'secret']);
  });

  it('rejects advance on a choice node as a no-op with a diagnostic', () => {
    const result = advanceDialogue(DIALOGUE, startDialogue(DIALOGUE), { type: 'advance' }, CONTEXT);
    expect(result.session).toEqual(startDialogue(DIALOGUE));
    expect(result.effects).toEqual([]);
    expect(result.diagnostics[0].code).toBe('rpg.dialogue.requiresChoice');
  });

  it('applies choice effects, then node effects, walking to the end', () => {
    let session = startDialogue(DIALOGUE);
    let result = advanceDialogue(DIALOGUE, session, { type: 'choose', choiceId: 'ask' }, CONTEXT);
    expect(result.session?.currentNodeId).toBe('tip');
    expect(result.effects).toEqual([]);
    session = result.session as NonNullable<typeof session>;
    result = advanceDialogue(DIALOGUE, session, { type: 'advance' }, CONTEXT);
    expect(result.effects).toEqual([{ kind: 'setFlag', flag: 'tipped', value: true }]);
    expect(result.session?.currentNodeId).toBe('bye-node');
    session = result.session as NonNullable<typeof session>;
    result = advanceDialogue(DIALOGUE, session, { type: 'advance' }, CONTEXT);
    expect(result.session).toBeNull();
    expect(result.effects).toEqual([{ kind: 'giveItem', itemId: 'potion', quantity: 1 }]);
  });

  it('rejects unavailable and unknown choices without state change', () => {
    const session = startDialogue(DIALOGUE);
    const unavailable = advanceDialogue(DIALOGUE, session, { type: 'choose', choiceId: 'secret' }, CONTEXT);
    expect(unavailable.diagnostics[0].code).toBe('rpg.dialogue.choiceUnavailable');
    expect(unavailable.session).toEqual(session);
    const unknown = advanceDialogue(DIALOGUE, session, { type: 'choose', choiceId: 'nope' }, CONTEXT);
    expect(unknown.diagnostics[0].code).toBe('rpg.dialogue.choiceUnknown');
    expect(unknown.session).toEqual(session);
  });

  it('evaluates hasItem and partyHasSpace conditions', () => {
    const def: DialogueDefinition = {
      id: 'dlg-cond',
      entryNodeId: 'n',
      nodes: [{
        id: 'n',
        speakerId: 's',
        text: 't',
        choices: [
          { id: 'needs-item', text: 'a', next: 'n', conditions: [{ kind: 'hasItem', itemId: 'potion', minCount: 2 }] },
          { id: 'needs-space', text: 'b', next: 'n', conditions: [{ kind: 'partyHasSpace' }] },
        ],
      }],
    };
    const poor: DialogueContext = { flags: {}, inventory: [{ itemId: 'potion', quantity: 1 }], partySize: 6, maxPartySize: 6 };
    expect(getDialogueRequest(def, startDialogue(def), poor)?.choices).toEqual([]);
    const rich: DialogueContext = { flags: {}, inventory: [{ itemId: 'potion', quantity: 2 }], partySize: 2, maxPartySize: 6 };
    expect(getDialogueRequest(def, startDialogue(def), rich)?.choices.map((c) => c.id)).toEqual(['needs-item', 'needs-space']);
  });

  it('moves the cursor within legal choices only', () => {
    const session = startDialogue(DIALOGUE);
    const trusted: DialogueContext = { ...CONTEXT, flags: { trusted: true } };
    const moved = moveDialogueCursor(DIALOGUE, session, 1, trusted);
    expect(moved.cursor).toBe(1);
    const clamped = moveDialogueCursor(DIALOGUE, moved, 5, trusted);
    expect(clamped.cursor).toBe(1);
    const floor = moveDialogueCursor(DIALOGUE, moved, -9, trusted);
    expect(floor.cursor).toBe(0);
  });
});
