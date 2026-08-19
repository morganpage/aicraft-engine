# Room seam apron — design record (0.18.0)

Status: **implemented** — `src/platformer/room-seam-apron.ts`, shipped with the 0.18.0 release. Working plan: `ROOM_SEAM_APRON_PLAN.md` (root, same date). This record captures the invariant, the evidence, and the decisions for future readers confronting the next seam-shaped bug.

## The invariant

**The floor across a linked seam exists in the collision set.**

At a linked seam the walkway is continuous in the authored world — `games/celerock.ldtk` `Level_0` carries a floor run at y=160 spanning x=296→320 (24×8), `Level_1` continues it at y=160 spanning x=0→32 (32×8), flush at worldX 0/320 — but it was not continuous in the simulation. The kernel takes `solids` as a per-tick argument and every consumer passed strictly the active room's set, so while the body was still in the source room the destination's floor did not exist. A body leaving the ledge while falling dropped through the hole where that floor should be, and the world-exact entry mapping (`mapLdtkRoomEntry`) faithfully preserved the overshoot into the destination as an embed.

## The evidence (why no tolerance could fix it)

Measured 2026-08-18 against the real seam, leaving the source ledge (`x=317, y=145, vx=200`) at increasing fall speeds — pinned today by `src/tests/room-seam-characterization.test.ts`:

| entry vy | without the destination's floor | with the floor present |
|---|---|---|
| 120 | −0.66px (clears) | −0.66px |
| 180 | **+0.34px embedded** | 0.00, grounded |
| 229 | **+1.16px embedded** | 0.00, grounded |
| 260 | **+1.67px embedded** | 0.00, grounded |
| 300 | **+2.34px embedded** | 0.00, grounded |

Embed depth is a function of fall speed (`vy × dt`). Every downstream repair was parameterised by a tuned constant (1px entry tolerance → overlap-based span merging; the consuming build's diagnostic net went 48px → 64px chasing a ledge 48.83px away), and past one floor-thickness per tick "snap up onto the floor" and "it legitimately fell into the pit" are the same input to any corrector. With the floor present, the kernel's own `resolveAxisY` (highest-floor snap over the moved rect) lands the body cleanly at every speed. The only fix is not creating the situation.

## The design

`compileRoomSeamApron(active, resolveNeighbour, { depth })` — every neighbour-room static solid within `depth` px of a FLUSH shared seam, rebased world-exactly into the active room's local coordinates (`x = nb.worldX + solid.x − active.worldX`), flags preserved verbatim, ids namespaced `apron:<levelIid>:<originalId>` (reversible via `seamApronSourceFromSolidId`). `createSeamApronCache(resolveRoom)` memoizes per room; cycle-free by construction because an apron needs only neighbour solids, never neighbour aprons.

- **Shared seam definition.** `seamSpanFor` (room-transitions.ts) is exported and used by both the exit poll and the apron — they cannot disagree about which crossings are real. The perpendicular span filter is strict overlap, so the void band of a partial seam grows no phantom floor (the adversarial fixture's authored 16px drop at its misaligned seam still drops).
- **Depth 64px.** Computed once per room, so generosity is free; ~12 ticks at terminal velocity, far beyond any straddle window.
- **Why not baked into `compileLdtkRoom`:** it is pure and single-room; an apron inside it would eagerly compile neighbours (whose compiles recurse back) and change the documented meaning of `CompiledLdtkRoom.solids`. The apron composes the way moving platforms do — the consumer owns per-tick assembly (the kernel's signature requires it), and the golden loop includes it in one line.

## The decisions that are decisions

- **Hazards do not ride the apron.** They live in a separate compiled bucket, not in solids. Across the straddle window floors continue and spikes do not. Accepted because at a seam failing to kill is the safe direction — the alternative kills players on geometry they cannot see yet. Pinned by engine test so it reads as a rule, not a hole; revisit only with a case where it reads as a bug in play.
- **Moving platforms and per-cell ladders do not ride it** (v1): platforms stay consumer-advanced; ladders are runtime overlays.
- **`stabilizePlatformerRoomEntry` stays, at 1px.** Genuine float-noise tolerance at the mapping boundary. Growing it is the band-aid; the apron is what lets it stay small.
- **`protectGroundedRoomSlide` removed (hard break).** It clamped grounded actors to their support span and zeroed `vx`/`vy` — momentum cancellation compensating for exactly the floor the apron now supplies. The considered alternative (a dev-mode warning "when a seam-adjacent step arrives with no apron") is unimplementable: `stepPlatformer` has no room context, it sees only `solids`. The migration note therefore carries BOTH halves: wire the apron line, AND delete any local fallback copy of the guard — a consumer shim of the form `engine.protectGroundedRoomSlide?.(…) ?? localFallback(…)` (the Celerock-TAL-2 build shipped one, at its `src/room-slide-safety.ts:204`) silently keeps clamping after the export disappears.

## The proof

`src/tests/room-seam-apron.test.ts` — geometry units (all four cardinals, span/depth filters, flags, namespacing, degenerate inputs), real-fixture solids (the keystone `apron:…:tile-0-160-32-8` at (320,160); the west mirror at (−24,160); the vertical-offset L1↔L2 rebase at (320,88)), the vy table reproduced flush through the full session golden loop, the hazard pin, the overlapping-rects no-op, the guard-retirement scenarios (a grounded walk across the seam keeps support AND momentum — better than the guard, which zeroed it), the adversarial authored drop, and the committed sweep: **1,548 crossings** (43 approach offsets × 6 fall speeds × 2 directions × 3 consumer poll orderings), every one landing flush. The showcase's ldtk-editor play loop carries the apron since this release.
