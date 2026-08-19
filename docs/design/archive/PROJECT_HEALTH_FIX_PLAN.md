# Project Health Check — Findings & Fix Plan

**Date:** 2026-08-16
**Scope:** full audit of `aicraft-engine` @ `0.15.0` (commit `1aa8ce0`)
**Status:** **implemented** — Phases 1–3 executed 2026-08-16 (Option A taken per the
§2.1 recommendation). All gates green: `npm test` 3,713/3,713, `showcase:test` 359/359,
`showcase:typecheck` clean, `tsc --noEmit` clean. Each engine-bug regression test was
confirmed failing before its fix. Shipped in `0.16.0`.
**§4 follow-up (2026-08-16):** all ten medium code-quality items are now addressed in `0.17.0`
(items 1/2/3/4/5/6/7/9 fully fixed; 8 — three of four tests moved to `showcase/tests/`, the
esm-specifier exception kept; 10 — `springAutoJumpTime` wired and per-emitter gravity shipped
with physics v14; H3/H4 pose overlays remain a documented TODO by decision). See
`ENGINE_QUALITY_PASS_PLAN.md`.
**Verification pass:** 2026-08-16 — every finding below re-checked against the
source. All confirmed; three descriptions were corrected (§3.1 is broader than
first written, §2 has a live runtime consequence, §4.1 was mis-described). One
decision is open before Phase 1 can start — see §2.1.

---

## 1. Health-check summary

| Check | Result |
|---|---|
| `npx tsc --noEmit` (root) | ✅ clean |
| `npm test` (main suite) | ✅ 3,694 / 3,694 passed (194 files) |
| `npm run showcase:typecheck` | ✅ clean |
| `npm run showcase:test` | ❌ 1 failure (`tile-room-fixtures.test.ts`) |
| Determinism discipline (no stray `Math.random` / `Date.now`) | ✅ clean outside documented host layer |
| Listener/timer teardown symmetry | ✅ clean except gamepad (see §3.2) |
| Secrets / build artifacts in git | ✅ clean (`.env` local-only; `dist/` ignored) |
| CI workflow references | ✅ valid (but never runs `showcase:test` — see §2) |

CI coverage, precisely: `.github/workflows/ci.yml` runs `npm ci`, `npm test`,
`build:dist`, `release:smoke`, `check:level-visual-size`. There is no explicit
typecheck step, but `build:dist` is `tsc -p tsconfig.build.json`, so `src/` **is**
typechecked in CI. The gap is showcase-only: neither `showcase:test` nor
`showcase:typecheck` ever runs.

Overall the library is in strong shape. The issues below are one failing test,
three real engine bugs, a set of medium-severity code-quality items, and repo
hygiene drift.

---

## 2. Failing test (root cause verified)

`showcase/tests/tile-room-fixtures.test.ts:323` —

```
AssertionError: expected 24 to be 32
expect(compiled.initialState.core.x).toBe(scene.level.spawn.x);
```

**Root cause:** `compileGeneratedLevel` at `src/platformer/level-runtime.ts:720`
now defaults `spawnResolution: 'rest-on-surface'` (added during Celerock
hardening, Workstream C1, because LDtk levels emit feet-center spawn anchors).
The showcase fixtures author spawn entities as **actor-top-left** tile rects
(`x: 2 * t` = 32), so the resolver shifts x by half the player width:
`32 − 8 = 24`. The test predates the default change and was never updated.

It is rotting silently because CI (`.github/workflows/ci.yml`) never runs
`showcase:test`.

**This is not test-only.** `showcase/sections/tile-room.ts:224` compiles the same
fixtures with no `spawnResolution`, so the *running showcase* also spawns the
player 8px left of the authored position. The failing assertion is reporting a
real behavioural drift in the tile-room section, not a stale expectation.

### 2.1 Open decision — where the default should live

Call-site survey for `compileGeneratedLevel` (a **public export**, `src/platformer/index.ts:100`):

| Call site | Authored spawn semantics | Passes `spawnResolution`? |
|---|---|---|
| `src/platformer/ldtk-room.ts:237` | feet-center (LDtk) | ✅ explicit `'rest-on-surface'` |
| `showcase/sections/ldtk-editor/play.ts:466` | feet-center (LDtk) | ❌ relies on the default |
| `showcase/sections/tile-room.ts:224` | actor-top-left | ❌ relies on the default — **drifted** |
| `src/levelgen/candidates.ts:254` | n/a | ❌ only reads `staticSolids.length`; spawn unused |

So exactly one caller needs the implicit default (`play.ts`), and exactly one is
broken by it (`tile-room.ts`).

**Option A — keep `'rest-on-surface'` as the default, make top-left callers explicit.**
Touches `tile-room.ts:224` and the test. Preserves the Celerock C1 decision and
the existing public contract.

**Option B — flip the default to `'actor-top-left'`, make LDtk callers explicit.**
Two lines (`level-runtime.ts:720`, `play.ts:466`), fixes test + showcase at once,
and removes the trap instead of routing around it. But it reverses the documented
C1 decision, requires updating `src/tests/celerock-hardening.test.ts:248`, and —
decisively — `compileGeneratedLevel` is exported from the package root, so this is
a **silent behaviour change for downstream consumers** (Celerock) who would get a
half-player-width spawn shift with no compile error at a patch/minor bump.

**Recommendation: Option A.** The public-export exposure is what settles it; the
codebase also consistently describes `compileGeneratedLevel` as "the LDtk path"
(`level-runtime.ts:451`, `ldtk-room.ts:9`), so `'rest-on-surface'` is the
intent-consistent default. Option B is the better shape in isolation and is worth
revisiting at the next major.

### Planned fix (assumes Option A)

- Pass `spawnResolution: 'actor-top-left'` explicitly at the two fixture call
  sites that author top-left rects: the test at
  `showcase/tests/tile-room-fixtures.test.ts:318-335` and the showcase runtime at
  `showcase/sections/tile-room.ts:224`.
- Make `showcase/sections/ldtk-editor/play.ts:466` pass `'rest-on-surface'`
  explicitly too — it is an LDtk caller and should not depend on an implicit
  default, matching `ldtk-room.ts:237`. After this, no call site relies on the
  default, so a future flip is safe.
- Add an assertion covering the default `'rest-on-surface'` path so both
  conventions are tested.
- Add `showcase:test` and `showcase:typecheck` to CI so the suite can't rot again.

---

## 3. Engine bugs (high priority)

Each fix ships with a small regression test in `src/tests/`.

### 3.1 Degraded-bot jump delay drops presses

`src/levelgen/calibration.ts:357-372` (default `DEFAULT_JUMP_DELAY_TICKS = 2`
at line 301). `createDegradedPolicy` suppresses a base jump press and arms a
delay, but the re-fire at line 367 requires
`jumpDelayed === 0 && baseInput.jump.pressed`. `pressed` is a 1-tick edge, so
with delay ≥ 2 the counter expires on a tick when `pressed` is already false —
the jump is silently dropped.

**The defect is broader than a dropped press.** The `if (jumpDelayed > 0)`
decrement block runs in the *same tick* as the arming block, so:

| `jumpDelayTicks` | Actual behaviour |
|---|---|
| 1 | Armed to 1, decremented to 0, and re-fired on the **same tick** — zero delay |
| ≥ 2 | Counter expires on a tick where `baseInput.jump.pressed` is false — **press dropped** |

There is no setting at which this knob produces a real delay. It is an
off-by-one *and* a dropped edge. This skews `runLowSkillPerturbation` difficulty
results (`stillBeatable` / perturbed runs) in both directions — delay-1 configs
are not degraded at all, delay-2+ configs are degraded far past intent.

**Fix:** latch the pending jump when the delay is armed; on expiry fire a
synthetic `pressed`/`held` pair regardless of the current base edge. Clear the
latch on a fresh base press. Skip the decrement on the arming tick so `N` means
`N` ticks.

**Regression test must cover both rows:** delay 1 fires exactly 1 tick late (not
same-tick), and delay 2 fires exactly 2 ticks late (not dropped). Asserting only
"delay 2 eventually fires" would pass against a fix that leaves the off-by-one in.

### 3.2 Gamepad adapter leaks window listeners on the no-nav path

`src/input/gamepad.ts:168-184`. The `gamepadconnected`/`gamepaddisconnected`
listeners are attached to `window` (lines 170-171) *before* the
`if (!nav)` early return (line 177), whose `dispose()` is empty with the
comment "No host was ever attached" — false; `window` was attached.

**Fix:** move listener attachment after the early return so the no-nav adapter
never attaches, making the comment true.

### 3.3 NaN hangs the terrain editor (unguarded `while (true)`)

`src/terrain-art/pixel-tools.ts:14-28`. `terrainArtLinePixels` loops until
`x === to.x && y === to.y`; NaN or non-finite coordinates (e.g. from mouse
math) never satisfy the break → infinite loop / OOM. Every other module in the
library guards non-finite inputs; this one doesn't.

**Fix:** return `[]` when either endpoint is non-finite (matching the
defensive style used elsewhere).

---

## 4. Code issues (medium — flagged, not in this fix pass)

1. **Multi-overlap collision snap is array-order-dependent** —
   `src/collision/resolve.ts:59-69` (`resolveAxisX`) and `:132-150`
   (`resolveAxisY`). Not simply "last solid wins": `moved` is rebuilt from the
   *updated* `newX` on each iteration (`resolve.ts:64-67`), so every snap changes
   the test rect seen by subsequent solids — an iterative re-snap whose result
   depends on array order. It still does not compute the nearest wall / highest
   floor the comments promise. Should compute min/max over candidates.
   (Semantic change — needs dedicated tests before touching, and those tests must
   be written against the iterative behaviour described here, not against a
   last-wins model.)
2. **~60-number inline duplicate of `DEFAULT_PLATFORMER_CONFIG` + `as any`** —
   `src/levelgen/realize.ts:462-465`. Values match today; pure drift hazard.
   Import from `src/platformer/constants.ts` and drop the cast.
3. **Compile-failure stub runs a full wasted pipeline** —
   `src/leveltest/verify.ts:386-397` and `src/leveltest/reachability.ts:392-398`.
   On `compileLevel` throw, a `null as any` initialState flows through
   6,000 ticks × every policy that can only end in the catch-path `'failure'`.
   Early `'inconclusive'` return would be honest and cheap.
4. **NaN/Infinity-prone divisions without zero guards** —
   `src/animation/jump.ts:258-276`, `src/platformer/config-scale.ts:384-410`,
   `src/leveltest/verify.ts:266-267` (`safeDt` of 0 → `tickRate: Infinity`
   baked into the emitted `ReplayConfig`).
5. **Duplicated verification types bridged by unsafe casts** —
   `src/levelgen/types.ts:310-364` re-declares `ReachabilityResult` /
   `VerificationStatus` / `VerificationDiagnostic` / `VerificationResult`;
   bridged via `as unknown as` at `src/levelgen/calibration.ts:174-178`;
   `calibrateDifficulty` ignores its `_verification` parameter (lines 180-183).
6. **Cache invalidation over-matches** — `src/terrain-art/cache.ts:27`:
   `key.includes(':' + materialId + ':')` can delete unrelated entries when a
   materialId string equals another entry's variant/mask segment.
7. **Wrong import paths in doc-comment examples** —
   `src/primitives/parallax.ts:162,257` (`'./lib/aicraft-engine/src/primitives'`).
8. **`src/tests` reach outside `src/`** — 4 test files import
   `../../showcase/…` and `../../scripts/…`, coupling the root tsconfig to
   directories outside `include: ["src"]`.
9. **Duplicate hash/canonicalize implementations with divergent semantics** —
   `fnv1a` (`src/level/serialize.ts:112` vs `src/cosmetics/generate.ts:48`);
   `canonicalize` (`src/level/serialize.ts:48` vs
   `src/terrain-art/serialize.ts:5-12`, the latter not cycle-safe).
10. **TODOs in library code** — `src/platformer/types.ts:1502`
    (`springAutoJumpTime` parsed but unwired), `src/character/humanoid/pose.ts:358-381`
    (H3/H4 locomotion overlay blends stubbed), `src/particles/presets.ts:50`
    (per-emitter gravity).

---

## 5. Repo hygiene

1. **Missing release tags** `v0.12.0` / `v0.13.0` / `v0.14.0` / `v0.14.1` —
   CHANGELOG compare links for these versions are broken (origin jumps
   `v0.11.0` → `v0.15.0`). Creating them needs release authorization and a
   push to origin — **not part of this pass**.
2. **Three stale plan docs untracked at root** — verified shipped:
   - `CAMERA_TRANSITION_FIX_PLAN.md` (shipped in `7a90c37`; logic live in
     `showcase/sections/ldtk-editor/play.ts`)
   - `ENGINE_TRANSITION_HARDENING_PLAN.md` (shipped as 0.10.0;
     `src/platformer/room-transitions.ts:601`, `room-slide.ts:428,462`)
   - `DESTINATION_VIEW_PLAN.md` (shipped as 0.11.0; `room-slide.ts:554`)

   **Plan:** move to `docs/design/archive/` (not delete — they are untracked,
   so deletion is unrecoverable). Keep `CELEROCK_BRIEF_REVIEW.md` at root;
   its Pass 4 (~200-line trim of `games/celerock.md`) is still pending.
3. **README drift** — `README.md` (~lines 134-143) says the showcase has
   "Four sections"; `showcase/main.ts` initializes nine. `showcase/README.md`
   lists six of nine (missing ldtk-editor, sprite-demo, camera-brain).
   **Plan:** update both.
4. Minor: the four post-0.15.0 docs-only commits have no CHANGELOG trace
   (cosmetic; can fold into the next release entry).

---

## 6. Fix plan (proposed execution order)

**Blocked on:** the §2.1 Option A / Option B decision. Everything below assumes
Option A (recommended).

### Phase 1 — failing test
1. Update `tile-room-fixtures.test.ts` compiled-scenes tests to pass
   `spawnResolution: 'actor-top-left'`; add a default-path assertion.
2. Make the resolution explicit at all three known runtime call sites (survey in
   §2.1 — no sweep needed, it is complete): `tile-room.ts:224` →
   `'actor-top-left'` (fixes live drift), `ldtk-editor/play.ts:466` →
   `'rest-on-surface'` (removes the last implicit dependency on the default).
3. Add `showcase:test` + `showcase:typecheck` to CI.

### Phase 2 — engine bugs
4. `calibration.ts` jump-delay latch + arming-tick off-by-one (§3.1) +
   regression test covering **both** delay 1 (fires 1 tick late, not same-tick)
   and delay 2 (fires 2 ticks late, not dropped).
5. `gamepad.ts` listener attachment order (§3.2) + regression test
   (no-nav adapter adds no listeners / dispose removes them).
6. `pixel-tools.ts` finite guard (§3.3) + regression test (NaN endpoint → `[]`).

### Phase 3 — hygiene
7. `git mv` the three stale plan docs to `docs/design/archive/`.
8. Update `README.md` and `showcase/README.md` section lists.

### Verification gate
- `npm test`, `npm run showcase:test`, `npm run showcase:typecheck`,
  `npx tsc --noEmit` — all green.
- Each new regression test fails before its fix and passes after.

---

## 7. Explicitly out of scope

- All §4 medium code-quality items (separate pass; collision-snap change is
  semantic and needs its own tests).
- Creating the four missing release tags (needs release authorization).
- CELEROCK_BRIEF_REVIEW Pass 4 trim.
- Flipping the `compileGeneratedLevel` spawn default (§2.1 Option B) — revisit at
  the next major, once Phase 1 step 2 has removed every implicit dependency.

---

## 8. Verification log (2026-08-16)

Re-checked against the working tree at `1aa8ce0`. Method noted where it matters.

| Item | Result |
|---|---|
| §2 failing test | ✅ Reproduced: `showcase:test` → 1 failed / 357 passed, `tile-room-fixtures.test.ts:323`, expected 24 to be 32 |
| §2 live showcase drift | ✅ New finding — `tile-room.ts:224` compiles with no `spawnResolution` |
| §3.1 jump delay | ✅ Confirmed, and broader than written (see revised §3.1) |
| §3.2 gamepad listeners | ✅ Confirmed — attach at `gamepad.ts:169-174`, `if (!nav)` return at `:177` |
| §3.3 `while (true)` | ✅ Confirmed — `pixel-tools.ts:20`, no finite guard on either endpoint |
| §4.1 collision snap | ✅ Order-dependent, but description corrected (iterative re-snap) |
| §4.5 duplicated verification types | ✅ Confirmed — `as unknown as` cast at `calibration.ts:176`, `_verification` unused at `:180` |
| §4.6 cache over-match | ✅ Confirmed — key is `hash:materialId:variantId:mask`, `invalidate` matches `:${materialId}:`, which can hit another entry's `variantId` segment |
| §5.1 missing tags | ✅ Confirmed absent **both locally and on origin**: `git tag --sort=v:refname` and `git ls-remote --tags origin` both jump `v0.11.0` → `v0.15.0` |
| §5.3 README drift | ✅ Confirmed — `showcase/main.ts` has 9 `init*` calls (`:98`–`:140`); `README.md:133` says "Four sections"; `showcase/README.md:28` table lists 6 |
| CI scope | ⚠️ Narrower than implied — `src/` **is** typechecked via `build:dist`; the gap is showcase-only (see §1) |

Not independently re-verified (accepted as written): §4.2, §4.3, §4.4, §4.7,
§4.8, §4.9, §4.10, and the §5.2 "already shipped" attributions.
