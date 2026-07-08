# API Proposal: Foot-Plant Detection

> Target pillar: 1 (Animation). Module: `src/animation/`.
> Builds on prior art: `showcase/sections/playground.ts` lines 500-511 + 1138-1157, `src/render/dust-fx.ts` lines 109-279.
> Status: DRAFT.

## Consumer Need

Both the playground showcase and Spitekeep's `dust-fx.ts` implement identical inline foot-plant detection: track previous per-foot lift heights, detect the `>0 → 0` edge, fire dust + audio. The logic is copy-pasted across consumers with minor variations (playground stores `prevLeftFootY`/`prevRightFootY` as local `let`s; Spitekeep bundles them into `DustFxState`). Extracting this into the engine eliminates the duplication, guarantees identical detection behavior across all games, and gives future Clone-to-Jest siblings a turnkey primitive.

## Naming Decision: `advanceFootPlant` (not `detectFootPlant`)

The function both **detects** the plant edge AND **advances** state (returns the next `FootPlantState` with updated prev-lift values). This mirrors `advanceFootLock` (detects grounded/airborne + advances blend weight) and `advanceLocomotion` (integrates phase). The `advance*` prefix is the engine's convention for functions that take state-in, return state-out. A `detect*` prefix would imply a stateless reader (like `isHitStopActive`), which this is not — it needs previous-lift history to detect the edge.

## Approach A: Dedicated `FootPlantState` type

**Source pattern:** Mirrors `FootLockState` / `advanceFootLock` — a small typed state object, a `create` factory, and an `advance` progression op.

**Signature sketch:**

```ts
// In src/animation/foot-plant.ts

export interface FootPlantState {
  /** Previous-tick left-foot lift height (y-component from `evaluateLocomotion`). */
  readonly prevLeftLift: number;
  /** Previous-tick right-foot lift height (y-component from `evaluateLocomotion`). */
  readonly prevRightLift: number;
}

export interface FootPlantEvents {
  /** `true` when the left foot just transitioned from airborne (lift > 0) to planted (lift === 0). */
  readonly leftPlanted: boolean;
  /** `true` when the right foot just transitioned from airborne (lift > 0) to planted (lift === 0). */
  readonly rightPlanted: boolean;
}

export interface FootPlantResult {
  /** Next state (for the following tick). */
  readonly state: FootPlantState;
  /** Plant-edge events detected this tick. */
  readonly events: FootPlantEvents;
}

/**
 * Factory: fresh foot-plant state with both prev-lift values at 0
 * (no airborne history → first tick never fires a spurious plant event).
 */
export function createFootPlantState(): FootPlantState;

/**
 * Detect foot-plant transitions and advance state by one tick.
 *
 * A foot "plants" when its lift transitions from > 0 (airborne, mid-swing)
 * to exactly 0 (grounded, stance phase). This is the zero-crossing edge of
 * the locomotion lift signal — the moment a visible step lands.
 *
 * The speed gate (minimum horizontal velocity) is a CONSUMER-SIDE concern.
 * Different games have different thresholds (the playground uses 1 px/tick;
 * a hero character may use 0.5 or skip gating entirely). This function
 * detects the edge only; the consumer decides whether to act on it.
 *
 * Pure: returns a brand-new `FootPlantResult`; the input state is never
 * mutated. Never throws.
 *
 * @param state - current foot-plant state (previous-tick lift heights)
 * @param leftLift - current left-foot lift height (`pose.leftFootOffset.y`)
 * @param rightLift - current right-foot lift height (`pose.rightFootOffset.y`)
 * @returns plant-edge events + next state
 *
 * @example
 * ```ts
 * // After evaluateLocomotion:
 * const result = advanceFootPlant(plantState, pose.leftFootOffset.y, pose.rightFootOffset.y);
 * plantState = result.state;
 * if (result.events.leftPlanted && Math.abs(player.vx) > MIN_SPEED) {
 *   spawnDust(leftFootWorldX);
 *   audio.playTap();
 * }
 * ```
 */
export function advanceFootPlant(
  state: FootPlantState,
  leftLift: number,
  rightLift: number,
): FootPlantResult;
```

**Usage example — playground refactor:**

```ts
// Before (inline):
let prevLeftFootY = 0;
let prevRightFootY = 0;
// ...
const leftLift = locoPose.leftFootOffset.y;
const rightLift = locoPose.rightFootOffset.y;
if (prevLeftFootY > 0 && leftLift === 0 && Math.abs(player.vx) > FOOTSTEP_MIN_SPEED) {
  spawnFootstepDust(player.x + player.width / 2 - player.facing * 5);
  audio.playNoise(FOOTSTEP_SOUND_DUR, 'lowpass', FOOTSTEP_SOUND_FREQ, FOOTSTEP_SOUND_PEAK);
}
if (prevRightFootY > 0 && rightLift === 0 && Math.abs(player.vx) > FOOTSTEP_MIN_SPEED) {
  spawnFootstepDust(player.x + player.width / 2 + player.facing * 5);
  audio.playNoise(FOOTSTEP_SOUND_DUR, 'lowpass', FOOTSTEP_SOUND_FREQ, FOOTSTEP_SOUND_PEAK);
}
prevLeftFootY = leftLift;
prevRightFootY = rightLift;

// After (engine primitive):
let plantState = createFootPlantState();
// ...
const plant = advanceFootPlant(plantState, locoPose.leftFootOffset.y, locoPose.rightFootOffset.y);
plantState = plant.state;
if (plant.events.leftPlanted && Math.abs(player.vx) > FOOTSTEP_MIN_SPEED) {
  spawnFootstepDust(player.x + player.width / 2 - player.facing * 5);
  audio.playNoise(FOOTSTEP_SOUND_DUR, 'lowpass', FOOTSTEP_SOUND_FREQ, FOOTSTEP_SOUND_PEAK);
}
if (plant.events.rightPlanted && Math.abs(player.vx) > FOOTSTEP_MIN_SPEED) {
  spawnFootstepDust(player.x + player.width / 2 + player.facing * 5);
  audio.playNoise(FOOTSTEP_SOUND_DUR, 'lowpass', FOOTSTEP_SOUND_FREQ, FOOTSTEP_SOUND_PEAK);
}
```

**Usage example — Spitekeep dust-fx refactor:**

```ts
// Before (DustFxState owns prevLeftLift / prevRightLift):
if (fx.prevLeftLift > 0 && leftLift === 0) {
  spawnFootstepDust(fx, centerX - player.facing * 5, feetY);
  playSound('footstep');
}
if (fx.prevRightLift > 0 && rightLift === 0) {
  spawnFootstepDust(fx, centerX + player.facing * 5, feetY);
  playSound('footstep');
}
fx.prevLeftLift = leftLift;
fx.prevRightLift = rightLift;
// (not-moving branch resets both to 0)

// After:
const plant = advanceFootPlant(fx.plantState, leftLift, rightLift);
fx.plantState = plant.state;
if (plant.events.leftPlanted) {
  spawnFootstepDust(fx, centerX - player.facing * 5, feetY);
  playSound('footstep');
}
if (plant.events.rightPlanted) {
  spawnFootstepDust(fx, centerX + player.facing * 5, feetY);
  playSound('footstep');
}
// Speed gate stays in consumer: if (!moving) { fx.plantState = createFootPlantState(); }
```

**Trade-offs:**
- Ergonomics: Slightly more ceremony than raw numbers (3-return object vs 2 assignments), but the named fields (`leftPlanted`, `rightPlanted`) read clearly at the call site. The consumer never touches raw lift values — the edge is pre-detected.
- Determinism: Fully pure. Same `(state, leftLift, rightLift)` → same result, forever. No hidden state.
- Runtime cost: One shallow object allocation per tick (`FootPlantResult`). Negligible — this is in the noise of the per-frame render cost.
- Consumer complexity: Minimal. The consumer calls `advanceFootPlant`, reads `.events.leftPlanted`, applies their own gate. The speed-threshold and audio coupling stay exactly where they are today.
- Tree-shake-ability: Three small exports (`FootPlantState`, `createFootPlantState`, `advanceFootPlant`). A consumer that only wants the events type can import just that.
- Convention fit: Matches `advanceFootLock(state, ...) → FootLockState` exactly. The `create` / `advance` pair is the library's standard for stateful helpers.

**What this makes easy:**
- Drop-in replacement for the inline pattern in any consumer.
- The `FootPlantEvents` type makes it obvious what happened this tick.
- Resetting on movement-stop: `plantState = createFootPlantState()` (same as `DustFxState` does today).

**What this makes hard:**
- Nothing. The API is strictly additive — no existing code changes.

## The One Design Tension: State Shape

The core question: should `FootPlantState` be a dedicated type, or should the function take/return plain numbers?

**Option A (chosen): Dedicated type.** `FootPlantState` with `prevLeftLift` / `prevRightLift`, a `createFootPlantState()` factory, and the state threaded through `advanceFootPlant`. This mirrors `FootLockState` / `createFootLockState` / `advanceFootLock` — the exact same pattern the library uses for a structurally identical concern (two floats of previous-tick history).

**Option B (rejected): Plain numbers.** `advanceFootPlant(prevLeft, prevRight, leftLift, rightLift) → { leftPlanted, rightPlanted, nextPrevLeft, nextPrevRight }`. Less ceremony, but: (1) breaks the `create`/`advance` convention the library has established for all stateful helpers; (2) the return type becomes a bag of four undifferentiated numbers; (3) the consumer must manually manage two separate variables and remember to assign both back — exactly the footgun the typed state eliminates.

**Why A wins:** The library has exactly one pattern for stateful pure helpers: typed state + `create` factory + `advance` progression op. `FootPlantState` is two floats, same as `LocomotionState` (one float) and `HitStopState` (one integer). The ceremony cost is near-zero; the consistency payoff is high. When a future consumer reads `createFootPlantState()` they immediately know the lifecycle. When they read `advanceFootPlant(state, ...)` they immediately know it's pure and returns new state. No learning curve, no ambiguity.

## Behavior-Identical-to-Playground Proof

The playground's inline code:

```ts
// line 1148
if (prevLeftFootY > 0 && leftLift === 0 && Math.abs(player.vx) > FOOTSTEP_MIN_SPEED) {
  spawnFootstepDust(...);
  audio.playNoise(...);
}
// line 1156
prevLeftFootY = leftLift;
```

The engine primitive computes:

```ts
// inside advanceFootPlant:
leftPlanted = state.prevLeftLift > 0 && leftLift === 0;
// ...
return { state: { prevLeftLift: leftLift, prevRightLift: rightLift }, events: { leftPlanted, rightPlanted } };
```

The consumer then gates:

```ts
if (plant.events.leftPlanted && Math.abs(player.vx) > FOOTSTEP_MIN_SPEED) { ... }
```

The compound condition `prevLeftFootY > 0 && leftLift === 0 && Math.abs(player.vx) > FOOTSTEP_MIN_SPEED` decomposes to `leftPlanted && speedGate` — identical logic. The prev-update (`prevLeftFootY = leftLift`) maps to `state: { prevLeftLift: leftLift }`. No behavioral change.

## Prior Art

- **Primary:** `showcase/sections/playground.ts` lines 500-511 (state init) + 1138-1157 (inline detection). This is the reference implementation being generalized.
- **Secondary:** `src/render/dust-fx.ts` lines 109-279 (Spitekeep's bundled version in `DustFxState`). Same logic, slightly different state management (module-local object vs local `let`s).
- **Pattern template:** `src/animation/foot-lock.ts` — `FootLockState` / `createFootLockState` (implicit via default `{isLocked: false, ...}`) / `advanceFootLock`. The new primitive follows this exact shape.

## Implementation Notes for @coder

1. **New file:** `src/animation/foot-plant.ts`. Types + factory + `advanceFootPlant` in one file (small enough to avoid a `types.ts` split).
2. **Update barrel:** Add `export * from './foot-plant'` to `src/animation/index.ts`.
3. **The implementation is trivial:**
   ```ts
   export function advanceFootPlant(state, leftLift, rightLift) {
     return {
       state: { prevLeftLift: leftLift, prevRightLift: rightLift },
       events: {
         leftPlanted: state.prevLeftLift > 0 && leftLift === 0,
         rightPlanted: state.prevRightLift > 0 && rightLift === 0,
       },
     };
   }
   ```
4. **`createFootPlantState`:** Returns `{ prevLeftLift: 0, prevRightLift: 0 }`.
5. **No imports** outside of the file (zero-dep invariant). The types are self-contained.
6. **JSDoc** on every export, matching `advanceFootLock`'s docblock style (see template above).
7. **Test:** Verify edge detection with a table of `(prevLeft, prevRight, left, right) → (leftPlanted, rightPlanted)`. Key cases: both feet airborne → both plant; one plants, one stays airborne; both already planted (no edge); left plants then right plants on next tick.

## Open Questions for @architect

1. Should `FootPlantResult` be a flat `{ state, events }` or should `events` be inlined into the result (i.e. `{ state, leftPlanted, rightPlanted }`)? The nested structure is cleaner for future extension (adding a `bothPlanted` convenience field); the flat structure is one less object allocation. Recommendation: nested, because the `events` object is only allocated when the consumer checks it, and extension is likely.

2. Is there any concern about the `createFootPlantState` returning all-zeros meaning the first tick never fires a plant? This matches the playground behavior (initial `prevLeftFootY = 0` means no edge on first tick) and is correct — but worth confirming the architect agrees this is the right default rather than some sentinel like `NaN`.
