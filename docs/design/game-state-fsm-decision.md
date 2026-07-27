# Decision: Game-State FSM

> Date: 2026-07-26. Stage 6 (Decide) for the `game-state-fsm` technique.

## Decision

**Adopt Approach A from `docs/design/game-state-fsm-proposal.md`: a pure, flat-record, `dt`-driven FSM reducer** in a new `src/game-state/` module, with an additive type-only `GameStateExact` discriminated-union export for consumers who want compile-time impossible-state prevention.

## Rationale

The research note (`docs/research/game-state-fsm.md`) confirms a **flat FSM** is
the right abstraction for a platformer's top-level mode orchestration (5–7
modes is well within FSM scope; HSMs and behavior trees are over-engineering
here). The library already owns the pure-reducer pattern the FSM must mirror
(`advanceJump`/`advanceTween`/`advanceEmitter` all take
`(state, input, dt, config?) → state`), so `reduceGameState(state, event, dt,
table?)` slots in with near-zero new conceptual surface. The FSM sits INSIDE
the consumer's `step(dt)` callback — the game-loop module stays completely
untouched (pause is a *state*, not a loop pause; the loop's `visibilitychange`
pause and the FSM's user-pause are orthogonal). `timeInState` is `dt`-driven
(never `Date.now()`), illegal transitions are silent no-ops (never throw), and
the reducer returns a fresh shallow-spread object every call. The `@architect`
returned **APPROVED** after one revision loop (loop 1 raised 2 minor doc-sync
gaps + 1 soft rec; loop 2 confirmed all resolved, no regressions). No benchmark
is needed: this is pure data with no visual output.

Approach B (discriminated-union state as the default) was rejected — it breaks
the flat-record convention every existing module uses. Approach C's
`GameStateExact` type-only union was adopted as an additive opt-in (zero runtime
cost).

## Resolved questions (binding for implementation)

1. **Flat FSM** (5–7 modes; no HSM).
2. **Canonical state set:** `menu / playing / paused / gameover / levelComplete`.
3. **Adjacency table as data:** ship `DEFAULT_GAME_STATE_ADJACENCY` + allow
   consumer spread-override via the reducer's optional `table?` arg.
4. **Signature:** `reduceGameState(state, event, dt, table?) → state`.
5. **Flat record default** + `GameStateExact` type-only discriminated-union
   export (additive opt-in).
6. **Minimal payload via `GameEvent` discriminated union** (`{type:'start';
   level?:number}` | `{type:'die'; finalScore?:number}` | `{type:'win';
   finalScore?:number}` | `{type:'pause'}|{type:'resume'}|{type:'quit'}|{type:'restart'}|...`).
   Payload written onto the returned state.
7. **Illegal transition = silent no-op;** `timeInState` keeps advancing.
   Consumer detects "just entered" via `state.timeInState === 0` after a legal
   transition.
8. **Pause is orthogonal** to the loop's `visibilitychange` pause.
9. **Ship `isLegalTransition(from, event, table?)`** as a pure reader.
10. **No enter/exit callbacks** — the consumer's `switch` on `state.current` is
    the lifecycle.

## Convention conflicts (all resolved)

- Deterministic core only — NO defensive adapter, NO host access, NO
  `try/catch`, NO `window`.
- `timeInState` is `dt`-driven (reducer takes `dt`, never reads `Date.now()`).
- Illegal transitions are silent no-ops (never throw).
- Reducer returns a fresh shallow-spread object every call; `GameState` fields
  are all `readonly` (matches `JumpState`). Shallow-spread is safe because
  `GameState` is a flat record of primitives (no nested objects).
- `GameLoopConfig.step` signature UNCHANGED — the loop module is untouched.

## Scope (v1)

- `src/game-state/types.ts` — `GameMode`, `GameEvent`, `GameState` (all fields `readonly`), `TransitionTable`, `GameStateConfig`, `GameStateExact`. `@module` header.
- `src/game-state/game-state.ts` — `DEFAULT_GAME_STATE_ADJACENCY`, `createGameState`, `reduceGameState`, `isLegalTransition`. `@module` header.
- `src/game-state/index.ts` — barrel.
- `src/index.ts` — add `export * from './game-state';` after `./game-loop`.
- `src/tests/game-state.test.ts` — TDD: legal transitions advance + reset `timeInState`; illegal transitions are silent no-ops (`timeInState` keeps advancing); `dt`-driven age (never `Date.now()`); payload written to state (`start`→level, `die`→finalScore); default adjacency table correctness; custom spread-override table; `isLegalTransition` reader; purity (input never mutated, fresh ref each call); degenerate `dt` (negative/NaN → 0); determinism (same inputs → byte-identical output).
- `src/tests/barrel-contract.test.ts` — add game-state assertions.
- `docs/api-surface.md` — flip the `src/game-state/` section from PROPOSED to shipped.
- `README.md` — add a `1. Game state` row.

## Inputs that drove this decision

- `docs/research/game-state-fsm.md` (FSM vs HSM, adjacency tables, reducer pattern, engine prior art).
- `docs/design/game-state-fsm-proposal.md` (Approach A + `GameStateExact`, revised).
- `@architect` critique loop 1 (NEEDS REVISION — minor) + loop 2 (APPROVED).
