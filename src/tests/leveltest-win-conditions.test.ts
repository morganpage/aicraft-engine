/**
 * Tests for win-condition combinators.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import {
  reachedExit,
  collectedAll,
  reachedExitWithKey,
  DEFAULT_WIN_CONDITION,
} from '../leveltest/win-conditions';
import type { WinCondition } from '../leveltest/win-conditions';
import type { PlatformerState } from '../platformer/types';
import type { CollectibleSave } from '../collectibles/types';
import type { LevelEntity } from '../level/types';
import { EMPTY_CONTACTS, EMPTY_EVENTS, EMPTY_INTERACTIONS, EMPTY_MOMENTS, EMPTY_LOCOMOTION } from '../platformer/constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal PlatformerState at a given position. */
function makeState(x: number, y: number): PlatformerState {
  return {
    core: {
      x,
      y,
      width: 16,
      height: 24,
      vx: 0,
      vy: 0,
      facing: 1,
      onGround: true,
      contacts: EMPTY_CONTACTS,
    },
    abilities: {},
    locomotion: EMPTY_LOCOMOTION,
    events: EMPTY_EVENTS,
    interactions: EMPTY_INTERACTIONS,
    moments: EMPTY_MOMENTS,
    tick: 0,
  };
}

/** Create an exit entity. */
function makeExit(
  id: number,
  x: number,
  y: number,
  isTrap: boolean = false,
  locked: boolean = false,
): LevelEntity {
  return {
    id,
    kind: 'exit' as const,
    rect: { x, y, width: 32, height: 48 },
    props: { isTrap, locked },
  };
}

/** Create a collectible entity. */
function makeCollectible(id: number, x: number, y: number, kind: 'coin' | 'gem' | 'key' = 'coin'): LevelEntity {
  return {
    id,
    kind: 'collectible' as const,
    rect: { x, y, width: 16, height: 16 },
    props: { kind },
  };
}

/** An empty save (nothing collected). */
const EMPTY_SAVE: CollectibleSave = { collected: [] };

describe('reachedExit', () => {
  it('returns true when player overlaps non-trap, non-locked exit', () => {
    const state = makeState(100, 200);
    const exit = makeExit(1, 100, 200);
    const result = reachedExit(state, [exit], EMPTY_SAVE);
    expect(result).toBe(true);
  });

  it('returns true with partial overlap (1px)', () => {
    const state = makeState(115, 200); // Right edge of player at 131, left edge of exit at 100
    const exit = makeExit(1, 100, 200);
    // Player rect: (115, 200, 16, 24). Exit rect: (100, 200, 32, 48)
    // Overlap: player right (131) > exit left (100) && player left (115) < exit right (132)
    const result = reachedExit(state, [exit], EMPTY_SAVE);
    expect(result).toBe(true);
  });

  it('returns false for trap exits', () => {
    const state = makeState(100, 200);
    const trapExit = makeExit(1, 100, 200, true);
    const result = reachedExit(state, [trapExit], EMPTY_SAVE);
    expect(result).toBe(false);
  });

  it('returns false for locked exits', () => {
    const state = makeState(100, 200);
    const lockedExit = makeExit(1, 100, 200, false, true);
    const result = reachedExit(state, [lockedExit], EMPTY_SAVE);
    expect(result).toBe(false);
  });

  it('returns false when no overlap', () => {
    const state = makeState(0, 0);
    const exit = makeExit(1, 200, 200);
    const result = reachedExit(state, [exit], EMPTY_SAVE);
    expect(result).toBe(false);
  });

  it('returns false when no exit entities exist', () => {
    const state = makeState(100, 200);
    const result = reachedExit(state, [], EMPTY_SAVE);
    expect(result).toBe(false);
  });

  it('returns true when multiple exits and one is non-trap reachable', () => {
    const state = makeState(100, 200);
    const trapExit = makeExit(1, 0, 0, true);
    const goodExit = makeExit(2, 100, 200);
    const result = reachedExit(state, [trapExit, goodExit], EMPTY_SAVE);
    expect(result).toBe(true);
  });

  it('never throws on malformed input', () => {
    expect(() => reachedExit(null as unknown as PlatformerState, [], EMPTY_SAVE)).not.toThrow();
    expect(() => reachedExit(undefined as unknown as PlatformerState, [], EMPTY_SAVE)).not.toThrow();
    expect(() => reachedExit(makeState(0, 0), null as unknown as LevelEntity[], EMPTY_SAVE)).not.toThrow();
    expect(() => reachedExit(makeState(0, 0), [{} as LevelEntity], EMPTY_SAVE)).not.toThrow();
  });
});

describe('collectedAll', () => {
  it('returns true when all collectibles are in save', () => {
    const state = makeState(0, 0);
    const entities = [makeCollectible(1, 100, 100), makeCollectible(2, 200, 200)];
    const save: CollectibleSave = { collected: ['1', '2'] };
    const result = collectedAll(state, entities, save);
    expect(result).toBe(true);
  });

  it('returns false when some collectibles are missing', () => {
    const state = makeState(0, 0);
    const entities = [makeCollectible(1, 100, 100), makeCollectible(2, 200, 200)];
    const save: CollectibleSave = { collected: ['1'] };
    const result = collectedAll(state, entities, save);
    expect(result).toBe(false);
  });

  it('returns false when no collectibles collected but level has them', () => {
    const state = makeState(0, 0);
    const entities = [makeCollectible(1, 100, 100)];
    const result = collectedAll(state, entities, EMPTY_SAVE);
    expect(result).toBe(false);
  });

  it('returns true for level with zero collectibles', () => {
    const state = makeState(0, 0);
    const result = collectedAll(state, [], EMPTY_SAVE);
    expect(result).toBe(true);
  });

  it('never throws on malformed input', () => {
    expect(() => collectedAll(null as unknown as PlatformerState, [], EMPTY_SAVE)).not.toThrow();
    expect(() => collectedAll(makeState(0, 0), null as unknown as LevelEntity[], EMPTY_SAVE)).not.toThrow();
    expect(() => collectedAll(makeState(0, 0), [], null as unknown as CollectibleSave)).not.toThrow();
  });
});

describe('reachedExitWithKey', () => {
  it('returns true when player overlaps exit AND key is collected', () => {
    const state = makeState(100, 200);
    const exit = makeExit(1, 100, 200);
    const key = makeCollectible(1, 0, 0, 'key');
    const save: CollectibleSave = { collected: ['1'] };
    const result = reachedExitWithKey(state, [exit, key], save);
    expect(result).toBe(true);
  });

  it('returns false when key is not collected', () => {
    const state = makeState(100, 200);
    const exit = makeExit(1, 100, 200);
    const key = makeCollectible(1, 0, 0, 'key');
    const result = reachedExitWithKey(state, [exit, key], EMPTY_SAVE);
    expect(result).toBe(false);
  });

  it('returns false when not at exit even with key', () => {
    const state = makeState(0, 0);
    const exit = makeExit(1, 100, 200);
    const key = makeCollectible(1, 0, 0, 'key');
    const save: CollectibleSave = { collected: ['1'] };
    const result = reachedExitWithKey(state, [exit, key], save);
    expect(result).toBe(false);
  });

  it('returns false for trap exits with key', () => {
    const state = makeState(100, 200);
    const trapExit = makeExit(1, 100, 200, true);
    const key = makeCollectible(2, 0, 0, 'key');
    const save: CollectibleSave = { collected: ['2'] };
    const result = reachedExitWithKey(state, [trapExit, key], save);
    expect(result).toBe(false);
  });

  it('never throws on malformed input', () => {
    expect(() => reachedExitWithKey(null as unknown as PlatformerState, [], EMPTY_SAVE)).not.toThrow();
    expect(() => reachedExitWithKey(makeState(0, 0), null as unknown as LevelEntity[], EMPTY_SAVE)).not.toThrow();
  });
});

describe('DEFAULT_WIN_CONDITION', () => {
  it('is the same function as reachedExit', () => {
    expect(DEFAULT_WIN_CONDITION).toBe(reachedExit);
  });
});

describe('WinCondition type assignability', () => {
  it('two-arg predicates are assignable to WinCondition (ignoring third arg)', () => {
    const twoArgCondition: WinCondition = (_state, entities, _save) => {
      // Only uses first two args — valid because WinCondition accepts 3
      return entities.length > 0;
    };
    const state = makeState(0, 0);
    expect(twoArgCondition(state, [], EMPTY_SAVE)).toBe(false);
    expect(twoArgCondition(state, [makeExit(1, 0, 0)], EMPTY_SAVE)).toBe(true);
  });
});
