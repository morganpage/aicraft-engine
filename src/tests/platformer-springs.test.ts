import { describe, it, expect } from 'vitest';
import { createPlatformerState, stepPlatformer } from '../platformer/kernel';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import type { Solid } from '../collision/types';
import type { DashAbilityState, PlatformerConfig, PlatformerState } from '../platformer/types';

/**
 * Phase 8 — springs + dash refills.
 *
 * These tests exercise the kernel mechanic directly with constructed solids
 * (the level→solid compile path is covered by `compile-generated-level.test.ts`).
 * The load-bearing scenarios:
 *
 *   1. Spring launch routes through the §0b launch contract — the impulse
 *      lands on `core.vy` and PERSISTS across ≥3 ticks (NOT discarded by the
 *      jump slice). This is the deferred Wave-0 "spring into jump slice"
 *      proof — the exact analogue of the double-jump persistence test, but
 *      for an environmental launch. Before Phase 0b, a spring's vy would have
 *      been overwritten by the jump ability's stale internal trajectory on the
 *      next tick.
 *   2. Spring `InteractionEvent` carries the correct `entityId` so the
 *      consumer can run per-spring cooldown / visuals.
 *   3. Super spring launches at the super velocity (`springSuperBounceVy`).
 *   4. Dash refill: overlapping a `dashRefill` solid refills
 *      `dashesRemaining` to max + emits the `dashRefill` interaction; a
 *      second overlap of the SAME solid next tick does NOT refill again if
 *      the consumer removed it (consumer-controlled one-shot — the core of
 *      Celeste's dash-crystal loop).
 *   5. Spring / dashRefill solids are NON-BLOCKING (trigger volumes) — the
 *      actor passes through; no `hitWall` / `landed`.
 *
 * @module
 */

/** Fixed timestep (60 Hz). */
const DT = 1 / 60;

/**
 * Build an initial state with the actor airborne, falling, and positioned to
 * overlap a spring volume at `springY`. `vy` is set to a positive (falling)
 * value so the spring's `vy > 0` gate fires on the first tick.
 */
function makeFallingStateOverSpring(
  springX: number,
  springY: number,
  vy: number,
  config: Readonly<PlatformerConfig> = DEFAULT_PLATFORMER_CONFIG,
): PlatformerState {
  // Place the body so its bottom is inside the spring volume (overlapping).
  // Body height 24; spring is 16 tall. Put the body top a few px above the
  // spring top so the AABBs overlap on both axes.
  const base = createPlatformerState(springX, springY - 8, config);
  return { ...base, core: { ...base.core, vy, onGround: false } };
}

describe('Phase 8 — springs', () => {
  // =========================================================================
  // 1. Spring launch persists across ticks (the §0b proof for springs).
  //
  // The spring's LaunchIntent lands on `core.vy` via the kernel's launch
  // arbitration (source 'spring' has the highest priority, 6). Because the
  // impulse is on `core` (not a private ability-internal velocity), subsequent
  // ticks continue from it — the old "impulse survives one tick then reverts"
  // defect (the same root cause the double-jump/wall-jump had pre-Phase-0b)
  // is gone. The proof: holding jump (full gravity in the var-jump window),
  // `vy` evolves by exactly `+g_jump·dt` each tick from the spring's launch
  // velocity. If the jump slice were discarding it, `vy` would NOT follow
  // this clean progression.
  // =========================================================================
  it('spring launch persists across ticks (routes through the launch contract)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const spring: Solid = {
      id: 'spring-1',
      x: 0,
      y: 100,
      width: 16,
      height: 16,
      spring: { launch: config.springBounceVy },
    };
    // A floor far below so the actor does not land during the trace (the
    // spring is the only interaction). Wide enough that the actor stays on it
    // horizontally.
    const floor: Solid = { id: 'floor', x: -200, y: 400, width: 600, height: 16 };

    const initial = makeFallingStateOverSpring(0, 100, 200, config);

    // Hold jump through the trace so the variable-jump window applies FULL
    // gravity (no cutoff) — the clean `+g_jump·dt` per-tick progression is the
    // persistence proof. The spring opens `springVarJumpTime` (0.2s = 12 ticks)
    // so the window covers the whole trace.
    const inputs = [
      { moveX: 0 as -1 | 0 | 1, jump: { held: true, pressed: false, released: false }, dash: null },
      { moveX: 0 as -1 | 0 | 1, jump: { held: true, pressed: false, released: false }, dash: null },
      { moveX: 0 as -1 | 0 | 1, jump: { held: true, pressed: false, released: false }, dash: null },
      { moveX: 0 as -1 | 0 | 1, jump: { held: true, pressed: false, released: false }, dash: null },
    ];

    let state = initial;
    const vys: number[] = [];
    for (const input of inputs) {
      state = stepPlatformer(state, input, [spring, floor], DT, config).state;
      vys.push(state.core.vy);
    }

    // The spring's launch velocity (pre-gravity): config.springBounceVy = -460.
    const launch = config.springBounceVy;
    // g_jump = 2 · apexHeight / timeToApex² (cached on the jump slice). Read
    // it from the same helper the kernel uses so the assertion tracks the
    // actual integration constant.
    const gJump = (2 * config.jump.apexHeight) / (config.jump.timeToApex * config.jump.timeToApex);
    const perTick = gJump * DT;

    // Tick 0: spring fired → core.vy = launch + one gravity step (the launch
    // is applied, THEN gravity integrates once this tick). This proves the
    // LaunchIntent was applied to core (vy reflects the spring, not the
    // pre-spring falling velocity of +200).
    expect(vys[0]).toBeCloseTo(launch + perTick, 4);

    // Ticks 1-3: vy evolves by exactly +perTick each tick (full gravity while
    // held in the var-jump window). If the jump slice were discarding the
    // spring impulse, vy would revert to a stale trajectory value and this
    // clean arithmetic progression would break — exactly the §0b proof.
    expect(vys[1]).toBeCloseTo(launch + 2 * perTick, 4);
    expect(vys[2]).toBeCloseTo(launch + 3 * perTick, 4);
    expect(vys[3]).toBeCloseTo(launch + 4 * perTick, 4);

    // Sanity: the actor is ascending (negative vy) across all 4 ticks — the
    // spring bounced it upward.
    expect(vys.every((v) => v < 0)).toBe(true);
  });

  // =========================================================================
  // 2. Spring InteractionEvent carries the correct entityId.
  // =========================================================================
  it('emits a spring InteractionEvent with the solid id', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const spring: Solid = {
      id: 'spring-platform-A',
      x: 0,
      y: 100,
      width: 16,
      height: 16,
      spring: { launch: config.springBounceVy },
    };
    const floor: Solid = { id: 'floor', x: -200, y: 400, width: 600, height: 16 };
    const initial = makeFallingStateOverSpring(0, 100, 200, config);

    const input = { moveX: 0 as -1 | 0 | 1, jump: { held: true, pressed: false, released: false }, dash: null };
    const next = stepPlatformer(initial, input, [spring, floor], DT, config).state;

    // Exactly one spring interaction this tick, carrying the solid's id.
    const springEvents = next.interactions.filter((i) => i.kind === 'spring');
    expect(springEvents.length).toBe(1);
    expect(springEvents[0]?.entityId).toBe('spring-platform-A');
  });

  // =========================================================================
  // 3. Super spring launches at the super velocity.
  // =========================================================================
  it('super spring launches at springSuperBounceVy', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const superSpring: Solid = {
      id: 'super-1',
      x: 0,
      y: 100,
      width: 16,
      height: 16,
      spring: { launch: config.springSuperBounceVy },
    };
    const floor: Solid = { id: 'floor', x: -200, y: 400, width: 600, height: 16 };
    const initial = makeFallingStateOverSpring(0, 100, 200, config);

    const input = { moveX: 0 as -1 | 0 | 1, jump: { held: true, pressed: false, released: false }, dash: null };
    const next = stepPlatformer(initial, input, [superSpring, floor], DT, config).state;

    const gJump = (2 * config.jump.apexHeight) / (config.jump.timeToApex * config.jump.timeToApex);
    const perTick = gJump * DT;
    // The super launch (-605) applied + one gravity step. Decisively stronger
    // than the normal spring (-460).
    expect(next.core.vy).toBeCloseTo(config.springSuperBounceVy + perTick, 4);
    expect(next.core.vy).toBeLessThan(config.springBounceVy + perTick);
  });

  // =========================================================================
  // 4. Spring is NON-BLOCKING (a trigger volume, not a wall/floor).
  //
  // The actor descends through the spring volume without landing on it or
  // hitting a wall. No `hitWall`, no `justLanded`, no `hitCeiling` — the
  // resolvers skip `spring` solids entirely.
  // =========================================================================
  it('spring solid is non-blocking (actor passes through, no hitWall/landed)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const spring: Solid = {
      id: 'spring-1',
      x: 0,
      y: 100,
      width: 16,
      height: 16,
      spring: { launch: config.springBounceVy },
    };
    // No floor — the actor should fall freely through the spring (the spring
    // fires on tick 0 and launches the actor UP, but the non-blocking proof is
    // about the solid NOT stopping the body, which is checked by the absence
    // of hitWall/landed/hitCeiling regardless of the launch).
    const initial = makeFallingStateOverSpring(0, 100, 200, config);

    const input = { moveX: 0 as -1 | 0 | 1, jump: { held: true, pressed: false, released: false }, dash: null };
    const next = stepPlatformer(initial, input, [spring], DT, config).state;

    expect(next.events.hitWall).toBe(false);
    expect(next.events.justLanded).toBe(false);
    expect(next.events.hitCeiling).toBe(false);
    // Contacts: no ground/wall/ceiling id from the spring.
    expect(next.core.contacts.groundId).toBeNull();
    expect(next.core.contacts.leftWallId).toBeNull();
    expect(next.core.contacts.rightWallId).toBeNull();
    expect(next.core.contacts.ceilingId).toBeNull();
  });

  // =========================================================================
  // 5. Spring does NOT refire while ascending (vy > 0 gate).
  //
  // The spring fires only when the actor is descending onto it (`vy > 0`).
  // After the bounce, the actor ascends (`vy < 0`) and the spring does NOT
  // refire — even though the actor is still inside the volume. This is the
  // debounce that prevents a same-spring multi-launch every tick.
  // =========================================================================
  it('spring does not refire while ascending (vy > 0 gate)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const spring: Solid = {
      id: 'spring-1',
      x: 0,
      y: 100,
      width: 16,
      height: 16,
      spring: { launch: config.springBounceVy },
    };
    const floor: Solid = { id: 'floor', x: -200, y: 400, width: 600, height: 16 };
    const initial = makeFallingStateOverSpring(0, 100, 200, config);

    const holdJump = { moveX: 0 as -1 | 0 | 1, jump: { held: true, pressed: false, released: false }, dash: null };

    // Tick 0: spring fires (descending).
    let state = stepPlatformer(initial, holdJump, [spring, floor], DT, config).state;
    const tick0Springs = state.interactions.filter((i) => i.kind === 'spring').length;
    expect(tick0Springs).toBe(1);

    // Tick 1: ascending (vy < 0), still overlapping the volume — NO refire.
    state = stepPlatformer(state, holdJump, [spring, floor], DT, config).state;
    const tick1Springs = state.interactions.filter((i) => i.kind === 'spring').length;
    expect(tick1Springs).toBe(0);
    // Confirm the actor is indeed ascending (the gate's precondition).
    expect(state.core.vy).toBeLessThan(0);
  });
});

describe('Phase 8 — dash refills', () => {
  /**
   * Build an initial state with the dash budget EMPTY (dashesRemaining = 0),
   * positioned overlapping a dashRefill solid. The actor is airborne (no
   * floor) so the landing-refill can't top it up — only the crystal can.
   */
  function makeEmptyDashState(
    crystalX: number,
    crystalY: number,
    config: Readonly<PlatformerConfig> = DEFAULT_PLATFORMER_CONFIG,
  ): PlatformerState {
    const base = createPlatformerState(crystalX, crystalY - 8, config);
    const dashSlice = base.abilities['dash'] as DashAbilityState | undefined;
    if (dashSlice === undefined || dashSlice.kind !== 'dash') {
      throw new Error('dash slice missing');
    }
    return {
      ...base,
      core: { ...base.core, vy: 0, onGround: false },
      abilities: { ...base.abilities, dash: { ...dashSlice, dashesRemaining: 0 } },
    };
  }

  // =========================================================================
  // 1. Overlapping a dashRefill solid refills dashesRemaining + emits the
  //    interaction. Consumer-owned one-shot: removing the solid (the
  //    consumer's respawn-cycle action) means a second overlap does NOT
  //    refill again.
  // =========================================================================
  it('dash crystal refills dashesRemaining to max and emits the interaction', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const crystal: Solid = {
      id: 'crystal-7',
      x: 0,
      y: 100,
      width: 16,
      height: 16,
      dashRefill: true,
    };
    const initial = makeEmptyDashState(0, 100, config);

    // Precondition: dashes are empty.
    const dash0 = initial.abilities['dash'] as DashAbilityState;
    expect(dash0.dashesRemaining).toBe(0);

    const input = { moveX: 0 as -1 | 0 | 1, jump: { held: false, pressed: false, released: false }, dash: null };
    const next = stepPlatformer(initial, input, [crystal], DT, config).state;

    // Refilled to max.
    const dash1 = next.abilities['dash'] as DashAbilityState;
    expect(dash1.dashesRemaining).toBe(config.maxDashes);

    // Interaction emitted with the crystal's id.
    const refillEvents = next.interactions.filter((i) => i.kind === 'dashRefill');
    expect(refillEvents.length).toBe(1);
    expect(refillEvents[0]?.entityId).toBe('crystal-7');
  });

  it('does NOT refill again when the consumer removes the crystal (one-shot)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const crystal: Solid = {
      id: 'crystal-7',
      x: 0,
      y: 100,
      width: 16,
      height: 16,
      dashRefill: true,
    };
    const initial = makeEmptyDashState(0, 100, config);

    const input = { moveX: 0 as -1 | 0 | 1, jump: { held: false, pressed: false, released: false }, dash: null };

    // Tick 0: crystal present → refill + interaction.
    let state = stepPlatformer(initial, input, [crystal], DT, config).state;
    expect((state.abilities['dash'] as DashAbilityState).dashesRemaining).toBe(config.maxDashes);
    expect(state.interactions.filter((i) => i.kind === 'dashRefill').length).toBe(1);

    // Consumer drains the dash (simulating the player dashing) so the refill
    // is observable again. Drop the crystal from solids[] (the consumer's
    // respawn-cycle action on seeing the interaction).
    const dashSlice = state.abilities['dash'] as DashAbilityState;
    state = {
      ...state,
      abilities: { ...state.abilities, dash: { ...dashSlice, dashesRemaining: 0 } },
    };

    // Tick 1: crystal REMOVED from solids → no refill, no interaction. This is
    // the consumer-controlled one-shot: the crystal cannot refill again until
    // the consumer re-adds it (its respawn timer expires).
    const drained = stepPlatformer(state, input, [], DT, config).state;
    expect((drained.abilities['dash'] as DashAbilityState).dashesRemaining).toBe(0);
    expect(drained.interactions.filter((i) => i.kind === 'dashRefill').length).toBe(0);
  });

  // =========================================================================
  // 2. Dash crystal is NON-BLOCKING (a trigger volume).
  // =========================================================================
  it('dashRefill solid is non-blocking (actor passes through, no hitWall/landed)', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const crystal: Solid = {
      id: 'crystal-1',
      x: 0,
      y: 100,
      width: 16,
      height: 16,
      dashRefill: true,
    };
    const initial = makeEmptyDashState(0, 100, config);

    const input = { moveX: 0 as -1 | 0 | 1, jump: { held: false, pressed: false, released: false }, dash: null };
    const next = stepPlatformer(initial, input, [crystal], DT, config).state;

    expect(next.events.hitWall).toBe(false);
    expect(next.events.justLanded).toBe(false);
    expect(next.events.hitCeiling).toBe(false);
    expect(next.core.contacts.groundId).toBeNull();
  });
});

describe('Phase 8 — level→solid compile (springs + dash refills)', () => {
  // Directly exercises the level→solid compile path for the new entity kinds,
  // verifying the `Solid.spring.launch` pre-computation and `dashRefill`
  // marking produced by `compileLevel`.
  it('compiles a spring entity into a non-blocking spring solid with the launch velocity', async () => {
    const { compileLevel } = await import('../platformer/level-runtime');
    const config = DEFAULT_PLATFORMER_CONFIG;
    const level = {
      version: 1,
      id: 'spring-test',
      name: 'Spring Test',
      width: 320,
      height: 240,
      tileSize: 16,
      spawn: { x: 16, y: 16 },
      tiles: { data: [], cols: 0, rows: 0, tileSize: 16 },
      entities: [
        { id: 1, kind: 'spring' as const, rect: { x: 48, y: 100, width: 16, height: 16 }, props: { power: 'normal' as const } },
        { id: 2, kind: 'spring' as const, rect: { x: 96, y: 100, width: 16, height: 16 }, props: { power: 'super' as const } },
        { id: 3, kind: 'dashRefill' as const, rect: { x: 144, y: 100, width: 16, height: 16 }, props: {} as Record<string, never> },
      ],
      nextEntityId: 4,
    };
    const compiled = compileLevel(level, { config });
    // Two springs + one crystal.
    const springs = compiled.staticSolids.filter((s) => s.spring !== undefined);
    const crystals = compiled.staticSolids.filter((s) => s.dashRefill === true);
    expect(springs.length).toBe(2);
    expect(crystals.length).toBe(1);
    // Normal spring → springBounceVy; super → springSuperBounceVy.
    const normal = springs.find((s) => s.id === 'entity-1');
    const superS = springs.find((s) => s.id === 'entity-2');
    expect(normal?.spring?.launch).toBe(config.springBounceVy);
    expect(superS?.spring?.launch).toBe(config.springSuperBounceVy);
    // Crystal carries a stable id (entity-<id>) the kernel reports back.
    expect(crystals[0]?.id).toBe('entity-3');
  });
});
