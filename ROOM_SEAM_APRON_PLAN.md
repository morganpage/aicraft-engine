# Seam apron — make the next room's floor exist during simulation

Status: **implemented** — shipped as `0.18.0` on 2026-08-19. Phases 1, 2 and 5 (partial) in `f2d9b31` (characterization) and `4f320f6` (module + tests); Phases 3, 4, 6, 7 and the sweep landed in the working tree the same day. Full gate green: 3,839/3,839 engine tests (incl. the 1,548-crossing sweep), 359/359 showcase, tsc + showcase typecheck clean, size budgets ok.

> **Completed 2026-08-19.** Phase 3 (retirement: files deleted, barrel + barrel-contract swapped, migration note carrying both halves) — gated on the retirement proof now in the suite (grounded walk-across keeps support AND momentum; jump passthrough; away-from-seam no-op). Phase 4 (showcase wiring: `createSeamApronCache` + memoized `collisionSolidsFor` in `createPlaySession`). Phase 5 completed (golden-loop runner with `transitionPlatformerToRoom` + apron-augmented `destinationSolids`; the in-band hazard pin; the vertical-offset L1↔L2 rebase; the adversarial authored drop; the 1,548-crossing sweep — 43 offsets × 6 speeds × 2 directions × 3 poll orderings, all flush). Phase 6 (brief: version header + pin `0.18.0`, seam-apron API row, transitions row, §5.3 loop line, §5.5 golden path + invariant prose + removal note, criterion 6 flush-crossing). Phase 7 (design record `docs/design/room-seam-apron-plan.md`, CHANGELOG `0.18.0`, version bump). Commit sequencing note: the characterization (`f2d9b31`) landed before the module (`4f320f6`) as the plan required; the retirement + sweep + wiring + release remain uncommitted for their own commits.

> **Progress 2026-08-18.** Phase 1 `src/platformer/room-seam-apron.ts` and Phase 2 (`seamSpanFor` exported) are in, with 12 tests covering geometry units, id namespacing, flag preservation, the partial-seam void band, cache identity, overlapping rects, the hazard decision, and the vy table reproduced with and without the apron. Deviation from the plan's Phase 5 wording: the apron assertion is **"never embedded"**, not "always grounded" — a slow crossing legitimately passes the seam still airborne above the walkway, so grounded-at-every-speed was wrong to demand; grounded IS asserted for the fast crossings that previously embedded. Still open: Phase 3 (retire `protectGroundedRoomSlide`, gated on the retirement proof), Phase 4 (showcase wiring), the ~1,500-crossing sweep, Phase 6 (brief), Phase 7 (release). Two scope decisions confirmed by the user on 2026-08-18: **remove `protectGroundedRoomSlide` outright in 0.18.0** (breaking, with migration note), and **wire engine + showcase + `games/celerock.md` brief only** — the external Celerock build is NOT touched; it adopts via the updated brief on its next build.

> **Corrected 2026-08-18 (verification pass).** An earlier draft named `/Users/morganpage/Documents/2D_PLATFORMERS/Celerock` as that build. Both directories exist, but that one is on `aicraft-engine ^0.14.1` and has no local safety file. The build that produced every measurement in this plan — and that carries the band-aid — is **`/Users/morganpage/Documents/2D_PLATFORMERS/Celerock-TAL-2`**, on `0.17.5`. This matters for Phase 3/7: see the migration hazard below.

Sources: the 2026-08-18 transition post-mortem (embed-depth-vs-fall-speed measurement, uncommitted scratch harness — the vy table below is its record; neither the sweep nor the harness is in the tree), `docs/design/room-transition-session-hardening-plan.md` (0.15.0 session philosophy: structural invariants over consumer discipline), `docs/design/feel-and-transitions-plan.md` ("never settle seam-entry states"), commit `b5335d3` (the band-aids being retired), and a full verification pass over the current tree cited inline below.

**Review pass 2026-08-18** (independent re-verification of every line citation in this document): exact hits for `ROOM_SLIDE_SUPPORT_EPSILON:15`, `protectGroundedRoomSlide:75`, `stabilizePlatformerRoomEntry:478`, tolerance option `:92`, `seamSpanFor:159` (private), `rebasePointBetweenLdtkRooms:533`, `mapLdtkRoomEntry:358`, `solids = compiled.staticSolids:285`, `stepPlatformer:1316`, `resolveAxisY:131`, barrel `:156-158`, barrel-contract `:302`, showcase `getLevel:486` / `stepPlatformer:645` / TODO `:710`, brief `:594` / `:732`, and the void rule at `room-transitions.ts:287-293` (`crossed the edge but OUTSIDE the shared span → void`) — which is what makes Phase 2's shared `seamSpanFor` the right call rather than a convenience. Three citations had drifted and are corrected in place; the findings that changed the plan's substance are marked inline.

---

## The missing invariant (root cause)

At a linked seam the walkway is continuous in the authored world — `games/celerock.ldtk` `Level_0` has a wall run at row y=160, x=296→320 (24×8), `Level_1` has x=0→32 (32×8) at the same y=160, both flush at the seam (rooms 320×184, `worldX` 0 and 320). It is **not continuous in the simulation**: the kernel takes `solids` as a per-tick argument (`stepPlatformer(state, input, solids, dt)` — `src/platformer/kernel.ts:1316-1328`; golden loop documented at `src/platformer/level-runtime.ts:249-257`), and every consumer assembles strictly the ACTIVE room's set (`CompiledLdtkRoom.solids` = `compiled.staticSolids`, `src/platformer/ldtk-room.ts:285`; showcase equivalent at `showcase/sections/ldtk-editor/play.ts:645`). While the body is in the source room it steps against source solids only — **the destination's floor does not exist yet.** A fast-falling body passes the floor top during the straddle window; the world-exact entry rebase (`mapLdtkRoomEntry`, `src/platformer/room-transitions.ts:358-370`) then preserves that overshoot, landing the body *into* the floor:

| entry vy | current behavior | with the destination's floor present in the set |
|---|---|---|
| 120 | −0.66px (clear) | −0.66px |
| 180 | **+0.34px embedded** | 0.00, grounded |
| 229 | **+1.16px embedded** | 0.00, grounded |
| 260 | **+1.67px embedded** | 0.00, grounded |
| 300 | **+2.34px embedded** | 0.00, grounded |

Embed depth is a function of fall speed (`vy × dt`). With the floor present, the kernel's own collision resolution (`resolveAxisY` — highest-floor snap, `src/collision/resolve.ts:131-171`) lands the body cleanly at every speed: no tolerance, no threshold, no correction.

**Why the fixes kept regrowing:** every prior fix is parameterised by a tuned constant (1px tolerance → overlap-based span merging; the external build's diagnostic net went 48px → 64px chasing a ledge 48.83px away). Fixes tuned by constants track a symptom whose magnitude varies continuously with something you don't control. There is also a hard ceiling: at terminal velocity the body moves ~5px/tick and the ledge is 8px thick — two ticks past it, "snap up" and "legitimately fell into the pit" are the same input to any corrector. The only fix is not creating the situation.

**The fix:** a **seam apron** — the neighbour room's near-seam static solids, rebased into the active room's local coordinates, included in the tick collision set. The body then walks or falls across a continuous floor and the downstream correctors have nothing left to correct. This is an engine concern: room-local simulation is the engine's model, so the discontinuity is the engine's to close.

Not band-aids and untouched by this plan: the letterbox aperture split (`RoomSlidePresentation.aperture` vs `bounds`; `src/camera/letterbox.ts:194/297`) and the fillStyle save/restore wrap — genuine fixes at their own layers.

---

## Phase 1 — engine module `src/platformer/room-seam-apron.ts` (new)

- `DEFAULT_SEAM_APRON_DEPTH = 64` — how deep (px) into the neighbour, perpendicular from the seam line, apron solids may extend. Generosity is free (computed once per room, see cache below); 64px ≈ 12 ticks at terminal velocity, far beyond any realistic straddle window (the exit poll fires on leading-edge crossing, `rankLdtkRoomExits` `src/platformer/room-transitions.ts:214`, but pre-step-polling consumers and deadband-gated arrivals make the window nonzero).
- `SeamApronRoom` structural type `{ ldtkLevel: LdtkLevel; solids: readonly Solid[] }` — satisfied by both `CompiledLdtkRoom` and the showcase's `LevelRuntime`; no new coupling.
- `compileRoomSeamApron(active, resolveNeighbour, options?) → readonly Solid[]`:
  - For each cardinal `__neighbours` link of `active.ldtkLevel`, resolve the neighbour via `resolveNeighbour(iid)` and compute the shared seam with `seamSpanFor` (Phase 2). A `null` seam (non-flush side, or no shared span) contributes nothing.
  - Rebase each neighbour solid into active-local coordinates via a `rebaseSolidBetweenLdtkRooms` helper mirroring `rebasePointBetweenLdtkRooms` (`src/platformer/room-transitions.ts:533-542`): `x = nb.worldX + solid.x − active.worldX`, same for y.
  - Keep a rebased solid iff its AABB intersects the band within `depth` of the seam line **and** overlaps the shared perpendicular span (strict interval overlap — the same void rule the exit poll applies to bodies at `src/platformer/room-transitions.ts:287-293`, so the void band of a partial seam gets no phantom support; author-intended pits stay pits).
  - Namespace ids as `apron:<levelIid>:<originalId>` so contact ids (`contacts.groundId` etc.) can never collide with the active room's own; preserve all `Solid` flags (passthrough/spring/dashRefill/ladder) verbatim.
  - `seamApronSourceFromSolidId(id)` — tiny reversal helper so namespaced ids stay parseable.
  - Pure, never throws; a missing neighbour yields nothing for that side.
- `createSeamApronCache(resolveRoom, options?)` → lazy memoized `apronFor(iid): readonly Solid[]`. Cycle-free by construction: an apron needs only neighbour **solids**, never neighbour aprons, so `A → B → A` recursion terminates through the existing room cache.
- **Hazards do not ride the apron — deliberate, and it must be documented as such.** The apron carries `Solid`s only, with their `spring`/`dashRefill`/`ladder`/passthrough flags intact; `hazards` is a separate bucket on the compiled room (`src/platformer/ldtk-room.ts:93`) and stays behind. So after this change, across the straddle window: floors continue, springs continue, dash-refills continue, **spikes do not** — a body can pass through a neighbour hazard sitting in the apron band without dying. That is the exact mirror of the defect being fixed, and it is accepted on the grounds that under-killing is the safe direction at a seam (the alternative kills players on geometry they cannot yet see). It is a DECISION, not an oversight: Phase 5 asserts it so the next death report does not rediscover it as a bug.
- Module doc states the invariant ("the floor across a linked seam exists in the collision set") and the v1 limitations: **hazards (above), moving platforms, and per-cell ladders from the neighbour do not ride the apron** (moving platforms stay consumer-advanced in `compiled.movingPlatforms`; ladders are runtime per-cell overlays — `CompiledLdtkRoom.ladders` is documented always-empty at `src/platformer/ldtk-room.ts:113-123`).

**Design choice — why not bake the apron into `CompiledLdtkRoom.solids`:** `compileLdtkRoom(level, project)` is pure and single-room; computing an apron inside it would require eagerly compiling neighbours, whose own compiles recurse back (cycle), and would change the documented meaning of `solids` ("tile geometry plus platform/passthrough entity solids…", `src/platformer/ldtk-room.ts:85-91`). The apron instead composes the same way moving platforms do — the consumer owns per-tick assembly (the kernel's signature requires it), the engine makes the canonical set available and the golden loop (Phase 4/6) includes it in one line. `createSeamApronCache` keeps that near-zero discipline.

## Phase 2 — share the one seam definition

Export `seamSpanFor` from `src/platformer/room-transitions.ts` (currently module-private, `:159-196`) with a doc note that the exit poll and the apron share this single definition of "linked seam" — they can never disagree about which crossings are void.

## Phase 3 — retire the band-aid (user-approved removal)

**Retirement proof — required before the delete lands.** The correct evidence is narrower and stronger than the Phase 5 sweep: take the scenarios in `src/tests/room-slide-safety.test.ts` that FAIL when the guard is bypassed (verified 2026-08-18 against the external build's equivalent suite: 4 of 5 fail with `cause: 'void'`), and show they pass with the guard **removed** and the apron in place. Only then delete the suite. Deleting a guard and the evidence that it mattered in the same commit leaves nothing to prove the replacement covers the same geometry — and the sweep's crossing set is not guaranteed to include the exact narrow-pad walk-off the guard was protecting.

- Delete `src/platformer/room-slide-safety.ts` (`protectGroundedRoomSlide` `:75-113` clamps x to the support span, zeroes `vx`/`vy`, forces `onGround` — momentum cancellation to compensate for a floor that shouldn't have been missing; `ROOM_SLIDE_SUPPORT_EPSILON` `:15`) and its suite `src/tests/room-slide-safety.test.ts`.
- **`stabilizePlatformerRoomEntry` stays** (`src/platformer/room-transitions.ts:478-526`, tolerance default 1 at `:89-93`): genuine collision tolerance for float noise at the mapping boundary, now rarely exercised once the apron lands. It stays SMALL — growing it is the band-aid; the apron is what lets it stay 1px.
- Barrel `src/platformer/index.ts`: drop the room-slide-safety re-exports (`:155-158`), add the Phase 1 exports (`compileRoomSeamApron`, `createSeamApronCache`, `SeamApronOptions`, `SeamApronRoom`, `DEFAULT_SEAM_APRON_DEPTH`, `seamApronSourceFromSolidId`).
- Update `src/tests/barrel-contract.test.ts` (`:301-309`) to assert the new surface instead of the removed one.
- No other in-repo consumers exist (verified: room-slide-safety is imported only by the barrel and its own tests).
- **Migration hazard — the removal does not remove anything by itself.** `Celerock-TAL-2/src/room-slide-safety.ts:204` wraps the engine helper as `publishedEngineSafety.protectGroundedRoomSlide?.(…) ?? protectGroundedRoomSlideFallback(…)`. Drop the engine export and `?.()` returns `undefined`, so `??` silently falls through to that repo's **own local copy of the same clamp** — the momentum cancellation survives the release that claims to retire it, now invisible. The migration note must therefore say *delete your local fallback too*, not merely *adopt the apron*. Any consumer that wrote the same optional-chaining shim has the same trap.
- **Consumers who upgrade without wiring the apron get a pure regression — DECIDED: hard break (recorded 2026-08-18).** The apron is opt-in (per-tick set assembly, which the kernel signature forces); the guard removal is not. Someone who takes `0.18.0` without reading §5.3 loses the guard and gains nothing. The alternatives were considered and rejected: a dev-mode warning "when a seam-adjacent step arrives with no apron solids present" is **unimplementable** — `stepPlatformer` has no room context, it only sees `solids` — and the implementable warn-when-the-guard-fires variant was passed over to keep the function pure and to match the pre-1.0 precedent (the `0.17.0` replay-v14 break): minor bumps may break, and the brief is the adoption path. The mitigation is the Phase 7 migration note carrying BOTH halves.

## Phase 4 — showcase wiring `showcase/sections/ldtk-editor/play.ts`

- In `createPlaySession`, add a memoized `collisionSolidsFor(rt)`: `[...rt.solids, ...compileRoomSeamApron(rt, getLevel)]` computed once per room (no per-tick allocation), reusing the existing per-level cache (`getLevel`, `:486-496`).
- The tick's kernel call (`:645`) passes the combined set: `stepPlatformer(state, input, collisionSolidsFor(active), dt, config)`.
- The hand-rolled transition handler (`:680-716`) is otherwise untouched; its TODO (integrate `room-slide.ts`, `:710-711`) is out of scope here.

## Phase 5 — tests `src/tests/room-seam-apron.test.ts` (new)

Builds on existing primitives: `makeLevel`/`makeProject` synthetic levels (`src/tests/room-transitions.test.ts:41-78`, `PARTIAL` fixture `:86-103`), `createPlatformerState` + `stepPlatformer`, plain-rect `Solid`s, and the session orchestrator for the golden loop.

1. **Geometry units:** east/west/north/south rebasing; span filter (partial seam excludes out-of-span solids); depth filter; id namespacing + reversal; flags preserved verbatim; missing neighbour; non-flush neighbour → no apron; `createSeamApronCache` memo identity (`apronFor(iid) === apronFor(iid)`).
2. **Real fixtures:** `games/celerock.ldtk` `Level_0`→`Level_1` — the apron must contain the destination walkway floor rebased to source-local `x∈[320,352], y=160`, continuing the source ledge run 296→352 with aligned tops. Plus the partial-overlap `src/tests/fixtures/celerock-adversarial.ldtk` (14- vs 16-tile heights) for span filtering on a real file.
3. **The vy table, reproduced:** body leaves the ledge while falling at vy ∈ {120, 180, 229, 260, 300}; run the session golden loop (`pollRoomTransition` → `mapLdtkRoomEntry` → `transitionPlatformerToRoom` with `destinationSolids` = destination solids + destination apron) over apron-augmented tick sets; assert 0.00px embed, grounded, momentum preserved. Include one **without-apron characterization case** documenting the embed (∝ vy) so the test provably bites.
4. **Hazard asymmetry, asserted not assumed:** place a neighbour hazard inside the apron band and cross the seam through it — the body must NOT die during the straddle window (hazards stay behind; see Phase 1). Pins the accepted asymmetry so a future reader sees a decision rather than a hole, and fails loudly if someone later teaches the apron to carry hazards without revisiting the rule.
5. **Overlapping rooms:** LDtk permits overlapping level rects in free-world layouts, where the apron would inject solids duplicating the active room's own geometry at identical coordinates. Physics v14's order-independent nearest-wall / highest-floor snap over the ORIGINAL moved rect's overlaps should make that a no-op — assert it rather than assume it (a synthetic two-room fixture with a 16px overlap; landing position and contact ids must match the no-apron result).
6. **Guard-retirement scenarios (Phase 3's proof):** the narrow-pad walk-off cases from `room-slide-safety.test.ts`, re-run with the guard removed and the apron present. These must pass before the guard's deletion commit.
7. **The committed sweep (~1,500 crossings — the validation the post-mortem promised):** approach positions × vy × both directions (E `Level_0`→`Level_1`, W back) across the celerock seam and the adversarial seam; every crossing must land with 0px embed and no fall-through below the walkway baseline. Vitest node env; the kernel is pure TS and existing suites run heavier.

## Phase 6 — brief update `games/celerock.md` (how the external build adopts this)

- §5.3/§5.5 golden loops: `createSeamApronCache(rooms.get)` at boot; per tick `const solids = [...active.solids, ...apronFor(active.ldtkLevel.iid), ...movingPlatforms.map(movingPlatformToSolid)]` (current solids line at `:594`); pass `[...target.solids, ...apronFor(target.ldtkLevel.iid)]` as `destinationSolids` in the transition call (`:732`) so the entry probe sees the source-side continuation too (a straddling arrival sits at negative destination-local x).
- Add the invariant prose and the no-band-aid rule: **no diagnostic nets, no widened seam ledges** — the floor across a linked seam exists in the collision set by construction. Note `protectGroundedRoomSlide` is removed in 0.18.0 (migration: adopt the apron line) and `stabilizePlatformerRoomEntry` remains the 1px float-noise guard.
- API table (`:218`, `:226`): add the apron row alongside `compileLdtkRoom`/`createLdtkRoomCache`.
- Version history header (`:25`) gains the 0.18.0 lead sentence; pin moves "Do not pin below `0.17.4`" → `0.18.0`.
- Acceptance criteria: add "every seam crossing lands with 0px embed at any fall speed" (near `:1247`/`:1283`); the void-death note (`:1316`) is unaffected — crossings outside the shared span remain void because the apron's span filter matches the poll's.

## Phase 7 — release hygiene

- `docs/design/room-seam-apron-plan.md` (design record, house pattern): the invariant, the embed-vs-vy evidence table, the retirement decision and its rationale.
- `CHANGELOG.md` `0.18.0` entry — feature (apron, with the invariant stated) + **removal** (`protectGroundedRoomSlide` / `ROOM_SLIDE_SUPPORT_EPSILON`). The migration note must carry BOTH halves: (1) include the apron in the tick set — the guard it performed is unnecessary once the seam floor exists; and (2) **delete any local fallback copy of the guard**, because a consumer shim of the form `engine.protectGroundedRoomSlide?.(…) ?? localFallback(…)` keeps clamping silently after the export disappears (see Phase 3).
- `package.json` `0.17.5` → `0.18.0` (commit pattern `chore(release): bump version to 0.18.0`).
- Commit sequencing (house rule from `ENGINE_QUALITY_PASS_PLAN.md`): characterization/sweep tests that document current-without-apron behavior land in their own commit BEFORE the engine change where feasible, so the fix is a reviewable diff.

## Verification gates

`npm test` (engine suite) · `npm run showcase:test` · `npm run showcase:typecheck` · `npm run build` (tsc --noEmit) · `npm run check:ldtk-runtime-size` (new barrel bytes — keep the module lean; re-peg the budget only if genuinely needed, as its own change). CI (`.github/workflows/ci.yml`) runs the same set.

## Risks / open edges (documented, not blocking)

- **One seam, one approach vector** was the post-mortem's evidence caveat — the Phase 5 sweep closes exactly this.
- Neighbour **springs/dash-refills** near a seam participate in collision via the apron with namespaced ids; interaction `entityId` parsing must go through `seamApronSourceFromSolidId` first (documented in the module doc). Rare in practice (none in the shipped pack's seam bands).
- **Containment latch interaction:** with the apron the body can be grounded on destination geometry while still inside the source room — that is the intended continuous-world behavior; the poll still fires on AABB crossing and the rebase is world-exact, so the latch/deadband logic is unchanged.
- **Moving platforms crossing a seam** remain v1-out-of-scope (none in the shipped pack); the module doc states it.
- **Neighbour hazards are invisible during the straddle window** (Phase 1 decision, Phase 5 assertion). Accepted: at a seam, failing to kill is safer than killing on geometry the player cannot see yet. Revisit only with a case where it reads as a bug in play.
- **The engine cannot force the apron into a consumer's tick set** — the kernel takes `solids` per call by design. The apron is therefore adoption-dependent in a way the removed guard was not; the recorded Phase 3 decision accepts this (hard break, brief-driven adoption).

## Not in scope

- The external Celerock repo (per user decision — it adopts via the brief).
- Integrating `room-slide.ts` into the showcase's hand-rolled cut (the standing TODO at `play.ts:710-711`).
- World-space compiled geometry (the "stop splitting the world" alternative from the post-mortem) — room-local coordinates are baked into spawns, entry mapping, and slide space; the apron closes the discontinuity without that rewrite.
