import { describe, it, expect } from 'vitest';
import {
  createGameState,
  reduceGameState,
  isLegalTransition,
  DEFAULT_GAME_STATE_ADJACENCY,
} from '../game-state';
import type {
  GameMode,
  GameEvent,
  GameState,
  TransitionTable,
  GameStateExact,
} from '../game-state';

/**
 * Game-state FSM tests.
 *
 * The reducer mirrors the pure-progression-ops discipline established by
 * `advanceJump` / `advanceTween` / `advanceEmitter`: same `(state, event, dt,
 * table?)` always produces byte-identical output, the input state is never
 * mutated, illegal transitions are silent no-ops, and the public API never
 * throws. `timeInState` is `dt`-driven (never `Date.now()`).
 *
 * Binding spec: `docs/design/game-state-fsm-decision.md` (Resolved questions
 * 1–10) and `docs/design/game-state-fsm-proposal.md` (Approach A + C).
 */

describe('createGameState', () => {
  it('defaults to menu mode with all fields zeroed', () => {
    const s = createGameState();
    expect(s).toEqual({
      current: 'menu',
      timeInState: 0,
      level: 0,
      score: 0,
      finalScore: 0,
    });
  });

  it('honors startingLevel from config', () => {
    const s = createGameState({ startingLevel: 3 });
    expect(s.level).toBe(3);
    expect(s.current).toBe('menu');
  });

  it('treats undefined config as defaults', () => {
    const s = createGameState(undefined);
    expect(s.level).toBe(0);
  });
});

describe('reduceGameState — legal transitions', () => {
  it('menu + start → playing, timeInState reset to 0', () => {
    let s = createGameState();
    s = reduceGameState(s, null, 0.5);
    expect(s.timeInState).toBe(0.5);
    s = reduceGameState(s, { type: 'start' }, 0.5);
    expect(s.current).toBe('playing');
    expect(s.timeInState).toBe(0);
  });

  it('playing + pause → paused, then paused + resume → playing', () => {
    let s = createGameState();
    s = reduceGameState(s, { type: 'start' }, 0);
    s = reduceGameState(s, { type: 'pause' }, 0);
    expect(s.current).toBe('paused');
    s = reduceGameState(s, { type: 'resume' }, 0);
    expect(s.current).toBe('playing');
  });

  it('playing + die → gameover', () => {
    let s = createGameState();
    s = reduceGameState(s, { type: 'start' }, 0);
    s = reduceGameState(s, { type: 'die' }, 0);
    expect(s.current).toBe('gameover');
  });

  it('playing + win → levelComplete', () => {
    let s = createGameState();
    s = reduceGameState(s, { type: 'start' }, 0);
    s = reduceGameState(s, { type: 'win' }, 0);
    expect(s.current).toBe('levelComplete');
  });

  it('gameover + retry → playing, gameover + quit → menu', () => {
    let s = createGameState();
    s = reduceGameState(s, { type: 'start' }, 0);
    s = reduceGameState(s, { type: 'die' }, 0);
    expect(s.current).toBe('gameover');
    s = reduceGameState(s, { type: 'retry' }, 0);
    expect(s.current).toBe('playing');

    let s2 = createGameState();
    s2 = reduceGameState(s2, { type: 'start' }, 0);
    s2 = reduceGameState(s2, { type: 'die' }, 0);
    s2 = reduceGameState(s2, { type: 'quit' }, 0);
    expect(s2.current).toBe('menu');
  });

  it('levelComplete + next → playing, levelComplete + quit → menu', () => {
    let s = createGameState();
    s = reduceGameState(s, { type: 'start' }, 0);
    s = reduceGameState(s, { type: 'win' }, 0);
    s = reduceGameState(s, { type: 'next' }, 0);
    expect(s.current).toBe('playing');

    let s2 = createGameState();
    s2 = reduceGameState(s2, { type: 'start' }, 0);
    s2 = reduceGameState(s2, { type: 'win' }, 0);
    s2 = reduceGameState(s2, { type: 'quit' }, 0);
    expect(s2.current).toBe('menu');
  });

  it('timeInState === 0 immediately after a legal transition (just-entered signal)', () => {
    let s = createGameState();
    s = reduceGameState(s, null, 1.0);
    expect(s.timeInState).toBe(1.0);
    s = reduceGameState(s, { type: 'start' }, 1.0);
    expect(s.timeInState).toBe(0);
  });
});

describe('reduceGameState — illegal transitions (silent no-op)', () => {
  it('die from menu is illegal: current unchanged, timeInState KEEPS advancing', () => {
    let s = createGameState();
    s = reduceGameState(s, null, 0.3);
    s = reduceGameState(s, { type: 'die', finalScore: 100 }, 0.4);
    expect(s.current).toBe('menu');
    expect(s.timeInState).toBe(0.7);
    expect(s.finalScore).toBe(0);
  });

  it('pause from menu is illegal (no-op)', () => {
    let s = createGameState();
    s = reduceGameState(s, { type: 'pause' }, 0.1);
    expect(s.current).toBe('menu');
  });

  it('start from playing is illegal (no-op, no level reset)', () => {
    let s = createGameState();
    s = reduceGameState(s, { type: 'start', level: 2 }, 0);
    s = reduceGameState(s, { type: 'start', level: 9 }, 0);
    expect(s.current).toBe('playing');
    expect(s.level).toBe(2);
  });

  it('resume from playing is illegal (no-op)', () => {
    let s = createGameState();
    s = reduceGameState(s, { type: 'start' }, 0);
    s = reduceGameState(s, { type: 'resume' }, 0);
    expect(s.current).toBe('playing');
  });

  it('self-transition (pause while paused) is illegal: timeInState keeps advancing', () => {
    let s = createGameState();
    s = reduceGameState(s, { type: 'start' }, 0);
    s = reduceGameState(s, { type: 'pause' }, 0);
    expect(s.timeInState).toBe(0);
    s = reduceGameState(s, null, 0.4);
    expect(s.timeInState).toBe(0.4);
    s = reduceGameState(s, { type: 'pause' }, 0.5);
    expect(s.current).toBe('paused');
    expect(s.timeInState).toBe(0.9);
  });
});

describe('reduceGameState — dt-driven age', () => {
  it('two calls with dt=0.5 → timeInState=1.0 (no transition)', () => {
    let s = createGameState();
    s = reduceGameState(s, null, 0.5);
    s = reduceGameState(s, null, 0.5);
    expect(s.timeInState).toBeCloseTo(1.0, 10);
    expect(s.current).toBe('menu');
  });

  it('negative dt is treated as 0 (no regression, no throw)', () => {
    let s = createGameState();
    s = reduceGameState(s, null, 0.3);
    s = reduceGameState(s, null, -0.5);
    expect(s.timeInState).toBe(0.3);
  });

  it('NaN dt is treated as 0 (no throw)', () => {
    const s = createGameState();
    expect(() => reduceGameState(s, null, NaN)).not.toThrow();
    const r = reduceGameState(s, null, NaN);
    expect(r.timeInState).toBe(0);
    expect(Number.isFinite(r.timeInState)).toBe(true);
  });

  it('Infinity dt is clamped to 0 (no regression)', () => {
    let s = createGameState();
    s = reduceGameState(s, null, Infinity);
    expect(s.timeInState).toBe(0);
    expect(Number.isFinite(s.timeInState)).toBe(true);
  });

  it('zero dt advances time by 0 (legal transition still resets to 0)', () => {
    let s = createGameState();
    s = reduceGameState(s, null, 0);
    expect(s.timeInState).toBe(0);
    s = reduceGameState(s, { type: 'start' }, 0);
    expect(s.timeInState).toBe(0);
    expect(s.current).toBe('playing');
  });
});

describe('reduceGameState — payload', () => {
  it('start{level:3} sets state.level=3', () => {
    let s = createGameState();
    s = reduceGameState(s, { type: 'start', level: 3 }, 0);
    expect(s.level).toBe(3);
    expect(s.current).toBe('playing');
  });

  it('start with no level field defaults to 0', () => {
    let s = createGameState({ startingLevel: 5 });
    s = reduceGameState(s, { type: 'start' }, 0);
    expect(s.level).toBe(0);
  });

  it('die{finalScore:1200} sets state.finalScore=1200', () => {
    let s = createGameState();
    s = reduceGameState(s, { type: 'start' }, 0);
    s = reduceGameState(s, { type: 'die', finalScore: 1200 }, 0);
    expect(s.current).toBe('gameover');
    expect(s.finalScore).toBe(1200);
  });

  it('die without finalScore defaults to 0', () => {
    let s = createGameState();
    s = reduceGameState(s, { type: 'start' }, 0);
    s = reduceGameState(s, { type: 'die' }, 0);
    expect(s.finalScore).toBe(0);
  });

  it('win{finalScore:1500} sets state.finalScore=1500', () => {
    let s = createGameState();
    s = reduceGameState(s, { type: 'start' }, 0);
    s = reduceGameState(s, { type: 'win', finalScore: 1500 }, 0);
    expect(s.current).toBe('levelComplete');
    expect(s.finalScore).toBe(1500);
  });
});

describe('reduceGameState — null / undefined event', () => {
  it('null event just advances time', () => {
    let s = createGameState();
    s = reduceGameState(s, null, 0.25);
    expect(s.current).toBe('menu');
    expect(s.timeInState).toBe(0.25);
  });

  it('undefined event just advances time', () => {
    let s = createGameState();
    s = reduceGameState(s, undefined, 0.25);
    expect(s.current).toBe('menu');
    expect(s.timeInState).toBe(0.25);
  });
});

describe('DEFAULT_GAME_STATE_ADJACENCY', () => {
  it('contains menu --start--> playing', () => {
    expect(DEFAULT_GAME_STATE_ADJACENCY.menu.start).toBe('playing');
  });

  it('contains playing <--pause--> paused', () => {
    expect(DEFAULT_GAME_STATE_ADJACENCY.playing.pause).toBe('paused');
    expect(DEFAULT_GAME_STATE_ADJACENCY.paused.resume).toBe('playing');
  });

  it('contains playing --die--> gameover', () => {
    expect(DEFAULT_GAME_STATE_ADJACENCY.playing.die).toBe('gameover');
  });

  it('contains playing --win--> levelComplete', () => {
    expect(DEFAULT_GAME_STATE_ADJACENCY.playing.win).toBe('levelComplete');
  });

  it('contains gameover --retry--> playing', () => {
    expect(DEFAULT_GAME_STATE_ADJACENCY.gameover.retry).toBe('playing');
  });

  it('contains gameover --quit--> menu', () => {
    expect(DEFAULT_GAME_STATE_ADJACENCY.gameover.quit).toBe('menu');
  });

  it('contains paused --quit--> menu', () => {
    expect(DEFAULT_GAME_STATE_ADJACENCY.paused.quit).toBe('menu');
  });

  it('contains levelComplete --next--> playing', () => {
    expect(DEFAULT_GAME_STATE_ADJACENCY.levelComplete.next).toBe('playing');
  });

  it('contains levelComplete --quit--> menu', () => {
    expect(DEFAULT_GAME_STATE_ADJACENCY.levelComplete.quit).toBe('menu');
  });

  it('menu→gameover is illegal (die/quit absent on menu)', () => {
    expect(DEFAULT_GAME_STATE_ADJACENCY.menu.die).toBeUndefined();
    expect(DEFAULT_GAME_STATE_ADJACENCY.menu.quit).toBeUndefined();
  });

  it('menu→paused is illegal (pause absent on menu)', () => {
    expect(DEFAULT_GAME_STATE_ADJACENCY.menu.pause).toBeUndefined();
  });

  it('has all 5 GameMode keys', () => {
    const keys = Object.keys(DEFAULT_GAME_STATE_ADJACENCY).sort();
    expect(keys).toEqual(['gameover', 'levelComplete', 'menu', 'paused', 'playing']);
  });
});

describe('custom spread-override table', () => {
  it('spread-override makes menu --secret--> playing legal in the reducer', () => {
    const table = {
      ...DEFAULT_GAME_STATE_ADJACENCY,
      menu: { ...DEFAULT_GAME_STATE_ADJACENCY.menu, secret: 'playing' },
    } as unknown as TransitionTable;
    const event = { type: 'secret' } as unknown as GameEvent;

    let s = createGameState();
    s = reduceGameState(s, event, 0.5, table);
    expect(s.current).toBe('playing');
    expect(s.timeInState).toBe(0);
  });

  it('custom table omits canonical transition → reducer treats it as illegal', () => {
    const table: TransitionTable = {
      menu: {},
      playing: { pause: 'paused', win: 'levelComplete', die: 'gameover' },
      paused: { resume: 'playing', quit: 'menu' },
      gameover: { retry: 'playing', quit: 'menu' },
      levelComplete: { next: 'playing', quit: 'menu' },
    };
    let s = createGameState();
    s = reduceGameState(s, { type: 'start' }, 0.5, table);
    expect(s.current).toBe('menu');
    expect(s.timeInState).toBe(0.5);
  });

  it('isLegalTransition consults the custom table', () => {
    const table = {
      ...DEFAULT_GAME_STATE_ADJACENCY,
      menu: { ...DEFAULT_GAME_STATE_ADJACENCY.menu, secret: 'playing' },
    } as unknown as TransitionTable;
    const event = { type: 'secret' } as unknown as GameEvent;
    expect(isLegalTransition('menu', event, table)).toBe(true);
    expect(isLegalTransition('menu', event)).toBe(false);
  });
});

describe('isLegalTransition', () => {
  it('returns true for every canonical legal transition', () => {
    expect(isLegalTransition('menu', { type: 'start' })).toBe(true);
    expect(isLegalTransition('playing', { type: 'pause' })).toBe(true);
    expect(isLegalTransition('playing', { type: 'die' })).toBe(true);
    expect(isLegalTransition('playing', { type: 'win' })).toBe(true);
    expect(isLegalTransition('paused', { type: 'resume' })).toBe(true);
    expect(isLegalTransition('paused', { type: 'quit' })).toBe(true);
    expect(isLegalTransition('gameover', { type: 'retry' })).toBe(true);
    expect(isLegalTransition('gameover', { type: 'quit' })).toBe(true);
    expect(isLegalTransition('levelComplete', { type: 'next' })).toBe(true);
    expect(isLegalTransition('levelComplete', { type: 'quit' })).toBe(true);
  });

  it('returns false for illegal transitions', () => {
    expect(isLegalTransition('menu', { type: 'die' })).toBe(false);
    expect(isLegalTransition('menu', { type: 'pause' })).toBe(false);
    expect(isLegalTransition('menu', { type: 'resume' })).toBe(false);
    expect(isLegalTransition('gameover', { type: 'start' })).toBe(false);
    expect(isLegalTransition('paused', { type: 'win' })).toBe(false);
    expect(isLegalTransition('levelComplete', { type: 'die' })).toBe(false);
  });

  it('matches the reducer transition decision (true iff reducer transitions)', () => {
    const cases: Array<{ from: GameMode; event: GameEvent }> = [
      { from: 'menu', event: { type: 'start' } },
      { from: 'menu', event: { type: 'die' } },
      { from: 'playing', event: { type: 'pause' } },
      { from: 'playing', event: { type: 'win', finalScore: 10 } },
      { from: 'playing', event: { type: 'die', finalScore: 5 } },
      { from: 'gameover', event: { type: 'retry' } },
      { from: 'gameover', event: { type: 'quit' } },
      { from: 'paused', event: { type: 'start' } },
      { from: 'levelComplete', event: { type: 'next' } },
      { from: 'levelComplete', event: { type: 'pause' } },
    ];
    for (const { from, event } of cases) {
      const legal = isLegalTransition(from, event);
      const state: GameState = { ...createGameState(), current: from };
      const reduced = reduceGameState(state, event, 0.5);
      if (legal) {
        expect(reduced.current).not.toBe(from);
        expect(reduced.timeInState).toBe(0);
      } else {
        expect(reduced.current).toBe(from);
        expect(reduced.timeInState).toBe(0.5);
      }
    }
  });
});

describe('purity', () => {
  it('input state is never mutated (deep-equal before/after)', () => {
    const s = createGameState();
    const snapshot = JSON.parse(JSON.stringify(s));
    reduceGameState(s, { type: 'start' }, 0.5);
    reduceGameState(s, { type: 'pause' }, 0.5);
    reduceGameState(s, null, 0.5);
    expect(s).toEqual(snapshot);
  });

  it('reducer returns a fresh ref each call (not the same object)', () => {
    const s = createGameState();
    const r1 = reduceGameState(s, null, 0.1);
    const r2 = reduceGameState(s, null, 0.1);
    const r3 = reduceGameState(s, { type: 'start' }, 0.1);
    expect(r1).not.toBe(s);
    expect(r2).not.toBe(s);
    expect(r3).not.toBe(s);
    expect(r1).not.toBe(r2);
  });

  it('never throws on degenerate inputs', () => {
    const s = createGameState();
    expect(() => reduceGameState(s, null, NaN)).not.toThrow();
    expect(() => reduceGameState(s, undefined, NaN)).not.toThrow();
    expect(() => reduceGameState(s, { type: 'start' }, NaN)).not.toThrow();
    expect(() => reduceGameState(s, { type: 'start' }, -1)).not.toThrow();
    expect(() => reduceGameState(s, { type: 'start' }, Infinity)).not.toThrow();
  });
});

describe('determinism', () => {
  it('identical inputs produce byte-identical output across repeated calls', () => {
    const s = createGameState();
    const event: GameEvent = { type: 'start', level: 2 };
    const r1 = reduceGameState(s, event, 0.5);
    const r2 = reduceGameState(s, event, 0.5);
    const r3 = reduceGameState(s, event, 0.5);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('deterministic across a multi-step sequence', () => {
    function run(): GameState {
      let s = createGameState({ startingLevel: 1 });
      s = reduceGameState(s, { type: 'start', level: 1 }, 0.016);
      s = reduceGameState(s, null, 0.016);
      s = reduceGameState(s, { type: 'pause' }, 0.016);
      s = reduceGameState(s, null, 0.016);
      s = reduceGameState(s, { type: 'resume' }, 0.016);
      s = reduceGameState(s, { type: 'die', finalScore: 999 }, 0.016);
      return s;
    }
    const a = run();
    const b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('illegal-transition no-op is also deterministic', () => {
    const s = createGameState();
    const r1 = reduceGameState(s, { type: 'die' }, 0.5);
    const r2 = reduceGameState(s, { type: 'die' }, 0.5);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

describe('GameStateExact (type-only discriminated union)', () => {
  it('menu variant omits score/finalScore at the type level', () => {
    const s: GameStateExact = { current: 'menu', timeInState: 0, level: 0 };
    expect(s.current).toBe('menu');
  });

  it('gameover variant carries score and finalScore', () => {
    const g: GameStateExact = {
      current: 'gameover',
      timeInState: 0,
      level: 1,
      score: 100,
      finalScore: 100,
    };
    expect(g.finalScore).toBe(100);
  });

  it('a flat GameState is assignable to GameStateExact when its fields line up', () => {
    const flat: GameState = {
      current: 'playing',
      timeInState: 0,
      level: 1,
      score: 50,
      finalScore: 0,
    };
    const exact: GameStateExact = flat as GameStateExact;
    expect(exact.current).toBe('playing');
  });
});
