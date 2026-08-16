# Room Transition Session Hardening Plan — 0.15.0

**Status:** approved for implementation
**Scope decisions (user-confirmed):** A + B + C (detector per-axis containment latch AND session orchestrator AND brief rewrite) **+ D (preflight multi-room steer — added after the Celerock-2 post-mortem)**; the detector behavior change ships as a `0.15.0` **Changed** entry; the Celerock game repos' own `main.ts` migrations are separate follow-ups after `0.15.0` ships.

**Revision note:** Change A was originally specified as a *whole-body*
containment latch. Review against the shipped detector found that it would
suppress legitimate orthogonal exits (re-creating the §1 Bug 1 void-fall death
in diagonal-transition geometry) and could never latch for bodies larger than a
room. It is now a **per-axis** latch — see §A.0. This narrows the behavior
change rather than widening it: the corner-arrival timing shift the original
draft accepted no longer occurs.

**Amendment (post Celerock-2 review):** Change D (preflight multi-room steer)
and the Bug 4 background were folded in; Change C was extended beyond §5.5 to
the brief's executable sections (§15 Stage 3, §12.8, gates, world contract);
and the §6 orthogonal-exit / candidate-skip-ordering tests were corrected to a
two-poll form — a single poll cannot fire the south exit, because a body
observed crossing the south seam is not Y-contained on that poll, so its own
south candidate would be gated too. The latch must carry the "was vertically
inside" fact from an earlier poll.

---

## 1. Background

The last Celerock build (`aicraft-engine@0.14.1`) hit a class of room-transition
failures documented in the game repo as
`/Users/morganpage/Documents/2D_PLATFORMERS/Celerock/TRANSITION_ISSUES.md`. All
three were consumer-side misuses of individually-correct engine APIs:

### Bug 1 — detector state discarded after transition (tick-tock loop → death)

The game received the re-armed `RoomExitDetectorState` from
`detectLdtkRoomExit`, then replaced it with a fresh
`createRoomExitDetectorState()` immediately after entering the destination
room. Because `mapLdtkRoomEntry` preserves exact world position, a
post-transition body always straddles the arrival seam (part of its AABB is
outside the destination room). A fresh detector has no gate, so the very next
tick fired the reverse exit:

1. Player crosses Room A's east edge.
2. Position maps into Room B, slightly outside its west edge (intentional).
3. Detector reset to armed.
4. Next tick: Room B detects a west crossing.
5. Transition back to Room A — infinite bounce.

Downstream consequence: player state was evaluated in the wrong room's local
coordinates, so a valid seam crossing could be interpreted as
outside-the-room, triggering the void-fall death check. **Player death caused
by a room transition.**

**Engine gap:** the re-arm gate only works if the consumer adopts the returned
state. A reset mistake is not structurally harmless — the fresh detector
happily fires on a straddling body.

### Bug 2 — second transition started during an active room slide

The game allowed another `beginRoomSlideFromBrain` while the previous slide's
camera still operated in normalized two-room slide space, mixing room-local
and slide-space camera state.

**Engine gap:** no engine-owned "one transition at a time" guard. The fix in
the game is a hand-rolled `if (!slide) handleRoomExit(...)` around the poll.

### Bug 3 — death mid-slide left the camera in slide space

After a seam crossing, simulation state belongs to the destination room while
the camera temporarily operates in slide space. Celerock's death path
discarded the slide without first rebasing the camera via
`cancelRoomSlideCameraSpace` — respawn inherited a camera in the wrong
coordinate space.

**Engine gap:** `cancelRoomSlideCameraSpace` exists, but nothing structural
forces cancel-with-rebase on every abnormal slide exit
(death/retry/teleport). The game hand-rolls it in `handleDeath`.

### Bug 4 — Celerock-2: transitions never wired at all (skip path)

A second build from the same brief
(`/Users/morganpage/Documents/2D_PLATFORMERS/Celerock-2`,
`aicraft-engine@0.14.1`, brief dated Aug 14) shipped a polished
**single-room** game: `boot()` takes `rooms.getStartRoom()` and nothing else
(main.ts:388-394), and any edge crossing is death (`player.x < -40 ||
player.x > room.width + 40` → `killPlayer`, main.ts:246). No transition API
is imported, no win condition, no test files. The supplied LDtk is a fully
chained five-room mountain (Level_0..Level_4, each with authored east/west
`__neighbours`).

The build's own explanation — "an asset audit claimed there were no
neighbours" — does not hold. The brief mandates `inspectLdtkPlatformerProject`
(G3), Celerock-2 calls it at main.ts:381, and running its own installed
engine against its own `level.ldtk` reports `levelCount: 5`, every level with
populated `neighbourIids`, all rooms `connected: true`,
`disconnectedRoomIids: []`. The report was invoked as a boot gate and then
ignored — the code consumes only `totalSpawns` and `tileSizes`
(main.ts:382-386).

**Engine gap (the grain of truth):** `capabilities.exits` is `false` for this
project because it counts Exit **entities** (resolved kind `'exit'`), not
`__neighbours` seam traversal. A builder scanning the capability roll-up sees
seven booleans, none saying "this is a multi-room chained world." The
multi-room signal exists but is buried in per-level fields — two notions of
"exit", no top-level steer. Compounding it, the brief offers a coherent
degenerate fallback ("edge = death") that passes most acceptance criteria,
because every stated failure mode is a defect *of* a transition — a build
with none triggers none. See Change D (preflight steer) and Change C (brief).

### Common factor

The correct path (`games/celerock.md` §5.5) is documented, but it requires the
consumer to maintain 3+ invariants across 4+ functions: adopt detector state
transactionally, never reset it mid-run, never begin a slide while one is
active, always cancel-with-rebase on abnormal exit, always finish-with-rebase
on normal completion. Each Celerock-1 bug is one forgotten invariant. Celerock-2
is a different class of failure — not a forgotten invariant but a skipped
feature, enabled by a preflight that buries the multi-room signal (Change D)
and a brief whose only cheap path around Stage 3 went undetected (Change C).

**Goal:** make all four failure modes structurally impossible when using the
recommended engine APIs, so the next Celerock build consuming the brief cannot
reproduce them — whether it wires transitions wrongly (bugs 1–3) or not at
all (bug 4).

---

## 2. Change A — per-axis containment latch (`room-transitions.ts`)

**File:** `src/platformer/room-transitions.ts` (additive to
`RoomExitDetectorState` / `detectLdtkRoomExit`; no public signature changes)

### A.0 Why per-axis (supersedes the whole-body latch draft)

An earlier draft of this change latched **whole-body** containment and gated
*every* exit until it was satisfied. Reading the shipped detector turned up two
defects in that approach:

1. **It suppresses legitimate orthogonal exits.** Arriving east into room B
   near B's floor and then falling through B's south seam is ordinary
   platformer geometry. A whole-body gate holds the south exit for as long as
   the body overlaps B — so the actor keeps falling while still simulated in
   B's local coordinates but outside B's bounds. That is precisely the
   void-fall death condition described in §1 Bug 1: the fix would reintroduce
   the symptom it exists to remove.
2. **Containment can be geometrically impossible.** When
   `body.width > level.pxWid` or `body.height > level.pxHei` the latch never
   sets, so the gate holds until the body fully backs out — an unbounded
   suppression window.

A whole-body gate also contradicts a deliberate existing design decision:
`hasClearedEntryEdge` (`room-transitions.ts:476-494`) is direction-specific on
purpose, and its comment says why — so an actor flush with an *unrelated* edge
is not gated.

Latching **per axis** and filtering **per candidate direction** fixes both: the
arrival axis stays gated (killing bug 1) while the orthogonal axis stays free
(preserving the diagonal exit). It also removes the corner-arrival behavior
change the whole-body draft required.

### A.1 New state fields

```ts
export interface RoomExitDetectorState {
  readonly blockedEntryEdge: Cardinal | null;
  readonly expectedLevelIid: string | null;
  /**
   * IID of the room in which the body has been fully contained ON THE X AXIS
   * since the last exit (latched), or null. A body not yet X-contained in the
   * current room is straddling an east/west seam, so east/west exits are
   * suppressed until it genuinely enters on that axis (or fully departs the
   * room). North/south exits are unaffected.
   */
  readonly fullyInsideXIid: string | null;
  /** As `fullyInsideXIid`, for the Y axis (gates north/south exits). */
  readonly fullyInsideYIid: string | null;
}
```

`createRoomExitDetectorState()` returns all four fields as `null`.

**Crossing axis of a cardinal:** `e`/`w` → X, `n`/`s` → Y — the axis the body
penetrates, matching `findLdtkRoomExit`'s `crossed` test.

### A.2 Internal refactor: ranked candidates

`findLdtkRoomExit` already builds a ranked candidate array and returns
`candidates[0]` (`room-transitions.ts:280-303`). Extract that ranking into a
module-private helper:

```ts
function rankLdtkRoomExits(
  body: Rect, level: LdtkLevel, project: LdtkProject,
): readonly LdtkRoomExit[];
```

- `findLdtkRoomExit` becomes `rankLdtkRoomExits(...)[0] ?? undefined` —
  **public semantics byte-identical**, no export or signature change (§9 holds).
- `detectLdtkRoomExit` consumes the ranked list so it can skip a gated
  candidate and take the next one.

This refactor is load-bearing, not cosmetic: `findLdtkRoomExit` collapses to a
single winner, so a gated west candidate that outranks a legitimate south
candidate would otherwise suppress the poll entirely and re-create defect 1
above in per-axis clothing.

### A.3 Detection semantics (updated)

Per poll, in order:

1. Normalize `deadband` (unchanged).
2. **Resolve stale/teleport** (extends the existing `expectedLevelIid`
   mismatch reset): any latch or blocked-edge field whose room differs from
   `level.iid` is not applicable here — the blocked edge resets to armed, and a
   latch belonging to another room counts as unlatched. Polling continues in
   the supplied room in the same call.
3. **Latch update** (before any gating, so an interior body never loses a
   tick):
   ```ts
   const insideX = body.x >= 0 && body.x + body.width <= level.pxWid;
   const insideY = body.y >= 0 && body.y + body.height <= level.pxHei;
   ```
   The returned state carries `fullyInsideXIid = level.iid` when `insideX`,
   else the step-2-resolved incoming value; likewise for Y. Steps 4–7 test the
   **updated** latches.
4. **Existing blocked-entry-edge / deadband gate — unchanged.** Still an early
   return suppressing all exits while the body overlaps the room and has not
   cleared `blockedEntryEdge` by the deadband. Deliberately left alone: it is a
   ~1px window tuned by `51ca752` with shipped tests (its return value now
   also carries the step-3 latches; the gate logic itself is untouched).
   See A.6.
5. **Full back-out release (preserved):** if the body no longer overlaps the
   room at all (`bodyOverlapsRoom` false), skip the axis gate entirely — a
   genuine reverse crossing or void departure stays reportable. Keeps the
   `51ca752` "gate holds only while straddling" semantics.
6. **Per-axis candidate filter (the new gate):** walk `rankLdtkRoomExits` in
   rank order and take the first candidate whose crossing axis is latched to
   `level.iid`; skip candidates whose axis is unlatched. If there is no
   surviving candidate (empty list, or all skipped), no exit fires and the
   returned state is
   `{ blockedEntryEdge: null, expectedLevelIid: null, fullyInsideXIid, fullyInsideYIid }`
   — i.e. **armed**, carrying the step-3 latches. This matches today's
   behavior: reaching the bare-helper call with no exit already returns the
   armed state, and the axis gate is expressed by the latches, not by
   `blockedEntryEdge`.
7. **Exit fires:** next state is
   ```ts
   {
     blockedEntryEdge: OPPOSITE_CARDINAL[exit.dir],
     expectedLevelIid: exit.neighbourLevelIid,
     fullyInsideXIid: null,
     fullyInsideYIid: null,
   }
   ```
   Both latches clear: they are keyed to the room just left, so neither is
   meaningful in the destination.

### A.4 Why the arrival axis always straddles (and the other one does not)

`mapLdtkRoomEntry` preserves world position exactly
(`to.worldX + entry.x === from.worldX + body.x`), so immediately after an
east→west transition the body's AABB starts at negative destination-local X.
X-containment therefore requires actual inward movement — the X latch cannot be
satisfied on the arrival tick, and the reverse west exit is suppressed for
correct and reset consumers alike.

Y-containment, by contrast, is normally already satisfied on that same arrival
tick (the transition preserves Y and the body is vertically inside), so step 3
latches Y on the first destination poll. Because the latch is **sticky** — it
records historical containment, not instantaneous containment — that first
latch is what lets a later north/south exit fire even though the body is no
longer Y-contained on the poll that crosses the south seam (a crossing body has
`insideY === false` by definition, so a non-sticky test could never report it).

**This holds only when the arrival poll is Y-contained.** A body that arrives
*already* beyond the south edge never latches Y in that room, and its south
exits stay gated until it fully departs — see the final bullet of A.6 for the
bound on that case. The two-poll test fixtures in §6 encode exactly this
ordering dependency.

### A.5 Reset-immunity

A **fresh** detector (all latches `null`) polled against a body straddling the
arrival seam cannot fire the reverse exit: the crossing axis is unlatched and
step 6 skips that candidate. The Celerock bug-1 sequence is a no-op regardless
of consumer state handling, because containment is recomputed from body
geometry on every poll rather than read from stored state.

### A.6 Compatibility & residual behavior change

- **Serialized old states** (missing both latch fields): treated as unlatched.
  The first poll latches whichever axes are contained — normally both, for an
  interior body — and behaves identically thereafter. No tick is lost, because
  step 3 precedes all gating.
- **Impossible containment** (`body.width > level.pxWid` /
  `body.height > level.pxHei`): that axis never latches, so exits on that axis
  are suppressed until full back-out. Now bounded to the one affected axis — a
  body too tall for a corridor room still transitions east/west normally.
  Explicitly tested (§6).
- **Residual `blockedEntryEdge` coupling (pre-existing, unchanged):** step 4
  still suppresses all exits during its deadband window, so a diagonal exit
  within ~1px of the entry edge is delayed by that window. This is shipped
  0.14.1 behavior, not introduced here; making that gate per-axis too is a
  possible follow-up, out of scope for `0.15.0`.
- **Behavior change vs 0.14.1:** materially narrower than the whole-body draft.
  An east/west exit can no longer fire before the body has been X-contained in
  the current room once (likewise N/S and Y). The corner-arrival case the
  whole-body draft would have changed — body clears the entry deadband but
  still straddles an *unrelated* edge — now behaves **exactly as it does
  today**, because the latch is sticky (historical containment, not
  instantaneous): an earlier vertically-inside poll in the same room keeps Y
  latched while the body later straddles south, so the south exit fires as in
  0.14.1. Ships as a `0.15.0` **Changed** entry, but no user-facing regression
  is expected.
- **Arrival already crossing on the orthogonal axis (the one residual
  corner):** a body that ENTERS the room already beyond its south edge has
  never been Y-contained there, so south exits are gated until the body fully
  departs the room (step 5) — at which point the bare helper reports the
  genuine crossing (or void). Bounded; ordinary geometry (arrive contained,
  later walk/fall out) is unaffected by the stickiness above.

---

## 3. Change B — `RoomTransitionSession` orchestrator

**File:** new `src/platformer/room-transition-session.ts` (additive; composes
existing helpers, never replaces them)

Owns `{ detector, slide }` as ONE immutable state machine so the three
invariants are enforced by construction:

- no second transition while a slide is active (bug 2),
- normal slide completion always applies the finish-rebase exactly once,
- every abnormal slide exit (death/retry/teleport) goes through a single
  cancel-with-rebase path (bug 3).

### B.1 API sketch

```ts
export interface RoomTransitionSessionState {
  readonly detector: RoomExitDetectorState;
  /** Active room slide, or null. Runtime tick-loop state only — a slide holds
   *  an easing fn and is not save-serialized; serialize `detector` alone. */
  readonly slide: RoomSlideState | null;
}

export function createRoomTransitionSession(): RoomTransitionSessionState;

export type RoomTransitionPollResult =
  | { readonly type: 'idle' }
  | { readonly type: 'suppressed-slide-active' }
  | { readonly type: 'exit'; readonly exit: LdtkRoomExit };

export function pollRoomTransition(
  session: Readonly<RoomTransitionSessionState>,
  body: Rect,
  level: LdtkLevel,
  project: LdtkProject,
  options?: Readonly<RoomExitDetectorOptions>,
): { readonly session: RoomTransitionSessionState;
     readonly result: RoomTransitionPollResult };

export interface SessionSlideBeginInput {
  readonly source: CompiledLdtkRoom;
  readonly destination: CompiledLdtkRoom;
  readonly viewport: Readonly<{ width: number; height: number }>;
  readonly brain: Readonly<CameraBrain>;
  readonly destinationView: Readonly<RoomSlideView>;
  readonly actor: Readonly<RoomSlideActorMapping>;
}

export function beginSessionRoomSlide(
  session: Readonly<RoomTransitionSessionState>,
  input: SessionSlideBeginInput,
  options?: Readonly<RoomSlideOptions>,
): { readonly session: RoomTransitionSessionState; readonly ok: boolean };

export function advanceSessionRoomSlide(
  session: Readonly<RoomTransitionSessionState>,
  dt: number,
  brain: Readonly<CameraBrain>,
): { readonly session: RoomTransitionSessionState;
     readonly brain: CameraBrain;
     readonly done: boolean };

export function endRoomTransitionSession(
  session: Readonly<RoomTransitionSessionState>,
  brain: Readonly<CameraBrain>,
  rebaseTo: 'source' | 'destination',
): { readonly session: RoomTransitionSessionState;
     readonly brain: CameraBrain };
```

### B.2 Semantics

- `pollRoomTransition` — while `slide !== null`, returns
  `suppressed-slide-active` with the session untouched (**bug 2 impossible**).
  Otherwise delegates to `detectLdtkRoomExit` and **auto-adopts** the returned
  detector state: the session in the return value always carries the next
  detector state, so the consumer never hand-adopts it — it only has to store
  the returned session. Note the precise strength of this guarantee: if a
  consumer *discards* the returned session, the `blockedEntryEdge` deadband
  hysteresis is lost, but the tick-tock exit is still suppressed, because
  Change A's containment gate is re-derived from body geometry on every poll
  rather than read from stored state. So a discarded session degrades jitter
  absorption; it cannot resurrect bug 1. An exit is
  reported; the consumer resolves the destination, maps the entry, and calls
  `transitionPlatformerToRoom` + `beginSessionRoomSlide`.
- `beginSessionRoomSlide` — wraps `beginRoomSlideFromBrain`. Refuses
  (`ok: false`, session unchanged) while a slide is active or inputs are
  missing; on success stores the slide in the session.
- `advanceSessionRoomSlide` — wraps `advanceRoomSlide`; when the slide
  completes, applies `finishRoomSlideCameraSpace` exactly once and clears
  `slide` — **the finish-rebase cannot be forgotten**. Returns the advanced
  session and brain. Reduced-motion immediate-cut sessions
  (`active: false, t: 1` at construction) complete on the first advance.
- `endRoomTransitionSession` — the single mid-flight exit path for
  death/retry/teleport/reset. If a slide is active it applies
  `cancelRoomSlideCameraSpace(slide, brain, rebaseTo)` BEFORE clearing
  (**bug 3 impossible**); with no active slide it returns the brain
  unchanged. Always returns a fresh idle session with a fresh detector —
  the "reset on respawn" discipline is owned here, not by the consumer. The
  fresh detector is unlatched on both axes, which costs nothing: A.3 step 3
  latches before gating, so a respawn placing the body inside a room can still
  exit on the very next poll, and a respawn straddling a seam is gated only on
  the axis it straddles.
- All functions pure, immutable, never-throw, no environment reads
  (the reduced-motion decision stays a `RoomSlideOptions` input, exactly as
  today). Export everything from `src/platformer/index.ts`.

### B.3 Golden consumer loop (target state after the brief rewrite)

```ts
// per simulation tick:
const poll = pollRoomTransition(session, state.core, active.ldtkLevel, project);
session = poll.session;
// No `if (!slide)` guard here — `pollRoomTransition` already returns
// 'suppressed-slide-active' while a slide is running (B.2, bug 2).
if (poll.result.type === 'exit') {
  // resolve target, mapLdtkRoomEntry, transitionPlatformerToRoom …
  const begun = beginSessionRoomSlide(session, { source, destination, viewport, brain, destinationView, actor }, { reducedMotion });
  if (begun.ok) { session = begun.session; /* adopt transitioned state, active = target */ }
}
// per presentation tick:
const advanced = advanceSessionRoomSlide(session, dt, brain);
session = advanced.session; brain = advanced.brain;
// on death / retry / teleport:
const ended = endRoomTransitionSession(session, brain, 'destination');
session = ended.session; brain = ended.brain;
```

Four named calls replace the invariant checklist. No hand-rolled
`if (!slide)`, no manual detector adoption, no manual cancel/finish rebases.

---

## 4. Change C — brief rewrite (`games/celerock.md` — §5.5 plus the executable sections)

- Golden path becomes the session API: one `pollRoomTransition` per tick,
  `beginSessionRoomSlide` on accept, `advanceSessionRoomSlide` per
  presentation tick, `endRoomTransitionSession` on death/respawn/reset.
- Retire the per-invariant discipline lines ("adopt transactionally", "reset
  it on respawn", "never begin while a slide is active") — the session owns
  them. Keep the low-level helpers documented as the composition layer for
  callers that need full control, with a pointer that they then own the
  invariants themselves.
- Add the Change A note: an exit additionally requires the body to have been
  fully contained once on that exit's **crossing axis** in the current room
  (straddle suppression is now intrinsic, so even a discarded detector state
  cannot tick-tock). State explicitly that the orthogonal axis is not gated —
  a diagonal exit taken straight off an arrival still fires — so the brief does
  not imply the actor must settle inside a room before it can leave.
- Bump the brief's engine version pins to `0.15.0`.

Beyond §5.5, the Celerock-2 post-mortem requires the brief's executable
sections to stop contradicting §5.5 and to make the skip path detectable:

- **Rewrite §15 Stage 3** — it still instructs wiring bare `findLdtkRoomExit`
  (the stateless primitive §5.5 warns per-tick consumers against, i.e. the
  Celerock-1 bug recipe) — plus the stale header-table row (line 162) and the
  file-layout comment (line 784), all to the session API.
- **Forbidden pattern (§12.8):** no death/respawn trigger on a
  `__neighbours` seam edge — walking/falling off a linked edge must
  transition. Names Celerock-2's exact degenerate fallback.
- **Executable Stage 3 gate:** the §12.3 transition smoke test must exist as
  a file and pass before Stage 4 begins; transition gates are no longer
  self-certified prose.
- **World contract in the brief's opening section:** the supplied LDtk is a
  five-room chained mountain; traversal to the final room's summit (win
  condition) is core scope, not emergent; a single-room build is a failure
  regardless of what `capabilities.exits` reports.
- **Stage 1 step 3:** log the FULL preflight report — `levelCount`,
  per-level `neighbourIids`, `connected`, and `capabilities.multiRoom`
  (Change D) — not just spawn/capability booleans, and treat `multiRoom` as
  the signal that Stage 3 is in scope.

---

## 5. Change D — preflight multi-room steer (`src/ldtk/preflight.ts`)

**File:** `src/ldtk/preflight.ts` (additive; no existing report field changes)

Celerock-2 skipped transitions entirely while the report it already held
described the full five-room chain. The preflight DOES surface the neighbour
graph — per-level `neighbourIids` (preflight.ts:50), `levelCount`, BFS
`connected`, `disconnectedRoomIids` — but buries it: the one roll-up a
builder actually scans is `capabilities`, and its `exits` flag counts Exit
ENTITIES (resolved kind `'exit'`), not `__neighbours` seam traversal. For the
Celerock LDtk that flag is `false` in a fully chained five-room world — two
notions of "exit", no top-level multi-room signal.

### D.1 Additions

- **`capabilities.multiRoom: boolean`** — true iff `levelCount > 1` AND some
  level's `neighbourIids` entry resolves to a DIFFERENT level within the
  project. Single-room projects stay false; neighbour links pointing outside
  the project (dangling iids) must not set it.

  > **Implementation note — do NOT derive this from the existing `adjacency`
  > map.** `adjacency` (preflight.ts:160-170) inserts a node for every
  > non-empty `n.levelIid` **without checking it resolves to a real level**
  > (line 167), so it contains phantom nodes for dangling links. Deriving
  > `multiRoom` from `adjacency` (or from `neighbourIids`, which is likewise
  > unresolved — it only drops `''` and dedupes, lines 197-204) would report
  > `true` for a single-room project carrying one dangling neighbour, which is
  > exactly the case this bullet forbids. Resolve against the actual level set
  > instead:
  >
  > ```ts
  > const levelIids = new Set(levels.map((l) => l.iid));
  > const multiRoom =
  >   levels.length > 1 &&
  >   levels.some((l) =>
  >     l.__neighbours.some(
  >       (n) => n.levelIid !== '' && n.levelIid !== l.iid && levelIids.has(n.levelIid),
  >     ),
  >   );
  > ```
  >
  > (The phantom nodes are harmless *in practice* for the existing BFS, which
  > only queries `reachable` for real levels. One theoretical exception — two
  > real levels linking to the SAME dangling iid become mutually "connected"
  > through the phantom bridge node — is pre-existing 0.14.1 behavior in the
  > connectivity report, not something Change D introduces or needs to fix; it
  > is explicitly out of scope here. The constraint above applies only to the
  > new `multiRoom` flag, which must resolve against the real level set.)
- **Info diagnostic when true** (never a warning — multi-room is not a
  defect): `multi-room world: N rooms chained via __neighbours — seam
  traversal (room-transition path) is in scope`.
- **JSDoc on `capabilities.exits`**: "Exit ENTITIES (resolved kind `'exit'`)
  only — NOT `__neighbours` seam traversal; see `neighbourIids` /
  `capabilities.multiRoom`."
- `LdtkPlatformerCapabilities` is already exported from `src/ldtk/index.ts`
  as a type — the additive field requires no new export names.

### D.2 Ground truth (verified)

Celerock-2's own installed `aicraft-engine@0.14.1` was run against its own
`level.ldtk`: `levelCount: 5`, every level reporting 1–2 `neighbourIids`, all
`connected: true`, `disconnectedRoomIids: []`, `capabilities.exits: false`.
The report was correct; the decision-relevant signal a builder scans for was
absent. Change D makes the flag exist; Change C makes the brief consume it.

---

## 6. Tests

### `src/tests/room-transitions.test.ts` (existing — extend `detectLdtkRoomExit` suite)

- **Exact Celerock bug-1 repro:** east exit fires → transition (entry straddles
  west edge) → replace detector with a FRESH `createRoomExitDetectorState()`
  → poll in destination → **no reverse exit** (reset-immunity).
- **Orthogonal exit preserved (the per-axis regression test) — TWO POLLS.** A
  single poll cannot assert this: a body observed crossing the south seam is
  not Y-contained on that poll, so its own south candidate would be gated too.
  The fixture is: **(poll 1)** fresh detector, body straddling the west seam
  (`x < 0`) and vertically inside → no exit, X unlatched, Y latches to the
  room; adopt the returned state. **(poll 2)** the body now crosses the south
  seam while STILL straddling west → the **south exit fires on poll 2** and
  the west candidate stays suppressed. This is the exact Celerock bug-1
  geometry plus a legitimate orthogonal exit — the case the whole-body latch
  would have broken (it would gate south until full departure, recreating the
  §1 Bug 1 death path) — and it proves the Y latch carries the
  "was vertically inside" fact across polls.
- **Candidate-skip ordering — same two-poll setup**, with geometry arranged so
  the gated west candidate *outranks* the valid south candidate (greater
  normalized penetration) → the south exit is still returned on poll 2.
  Proves the ranked-list walk (A.2), not merely gating `candidates[0]`.
- Per-axis latch semantics: X containment alone sets `fullyInsideXIid` and
  leaves `fullyInsideYIid` untouched (and vice versa); each latch persists
  while the body straddles the *other* axis.
- Full back-out release: gated body backs fully out of the room → bare helper
  result reported (genuine reverse or void).
- **Impossible containment:** `body.height > level.pxHei` → N/S exits
  suppressed until full back-out, while E/W exits still fire normally once
  X-contained (the suppression is bounded to one axis).
- **Corner arrival is unchanged from 0.14.1:** poll 1 vertically inside (Y
  latch sets), poll 2 clears the entry deadband while now straddling the
  unrelated south edge → the south exit still fires, because the latch is
  sticky. This asserts the *absence* of the behavior change the whole-body
  draft required.
- Old serialized state shape (missing both latch fields) → treated as
  unlatched; an interior body latches and can fire an exit on the **same**
  poll (no lost tick).
- Exit-fires next state carries both `fullyInsideXIid` and `fullyInsideYIid`
  as `null`.
- `findLdtkRoomExit` unaffected by the A.2 refactor: existing suite passes
  untouched, plus a case asserting it still returns the top-ranked candidate
  with no gating applied.
- Purity/immutability/JSON-clone equivalence for the new fields.
- All existing blocked-entry-edge / deadband / cardinal tests unchanged and
  passing.

### `src/tests/room-transition-session.test.ts` (new file)

- Exit suppressed while a slide is active (`suppressed-slide-active`, session
  byte-identical).
- `beginSessionRoomSlide` refuses a second begin during an active slide
  (`ok: false`, unchanged session).
- Death mid-slide via `endRoomTransitionSession(..., 'destination')`: output
  brain equals direct `cancelRoomSlideCameraSpace(slide, brain,
  'destination')`; camera coordinates are destination-room-local (not slide
  space); session returned idle with fresh detector.
- `endRoomTransitionSession` with no active slide: brain unchanged, fresh
  session.
- Normal completion: `advanceSessionRoomSlide` applies
  `finishRoomSlideCameraSpace` exactly once (compare against manual sequence)
  and clears the slide.
- Advance-after-completion idempotency: advancing an already-completed
  (`slide: null`) session returns the brain **byte-identical** to its input and
  `done` stable — asserting explicitly that the finish-rebase is not applied a
  second time (a double rebase would silently offset the camera by one room).
- Reduced-motion immediate cut: begin (inactive, `t: 1`) → first advance
  finishes + rebases.
- Poll auto-adoption: an 'exit' result followed by a poll with the body still
  straddling the destination seam produces no second exit even if the consumer
  never stored the intermediate session (latch re-derives).
- Begin with missing destination room in inputs / non-finite viewport →
  `ok: false`, never-throw.
- Immutability: input session objects never mutated; JSON-clone of
  `detector`-only serialization behaves identically.

### `src/tests/barrel-contract.test.ts` (existing — extend)

- Assert `createRoomTransitionSession`, `pollRoomTransition`,
  `beginSessionRoomSlide`, `advanceSessionRoomSlide`,
  `endRoomTransitionSession` are functions on the top-level barrel;
  compile-time uses of `RoomTransitionSessionState`,
  `RoomTransitionPollResult`, `SessionSlideBeginInput`.

### `scripts/release-smoke.mjs` (existing — extend)

- Extend all three generated consumers (Node ESM / NodeNext / Vite) to import
  and minimally exercise every new public name explicitly, so a missing
  export fails loudly (not just the barrel key count).

### `src/tests/ldtk-preflight.test.ts` (existing — extend, Change D)

- `multiRoom` true: multi-level project with an internal `__neighbours` link
  (two levels, one resolved link).
- `multiRoom` false: single-level project; AND a multi-level project whose
  only neighbour iids point OUTSIDE the project (dangling links must not set
  the flag).
- The info diagnostic is present iff `multiRoom` is true; message includes the
  room count; severity is info (multi-room is not a warning).
- `multiRoom` is independent of `capabilities.exits`: a project with Exit
  entities and no internal neighbours → `exits: true, multiRoom: false`; the
  Celerock shape (no Exit entities, full chain) → `exits: false, multiRoom:
  true`.
- Existing preflight suite unchanged (report shape is additive; the
  `capabilities` object gains a field — update any exhaustive
  `toEqual`-style assertions to the new shape).

---

## 7. Release & docs

- `CHANGELOG.md` `0.15.0`:
  - **Added** — `RoomTransitionSession` orchestrator APIs (with the
    Celerock TRANSITION_ISSUES failure modes each prevents).
  - **Added** — preflight: `capabilities.multiRoom`, the multi-room info
    diagnostic, and the `exits`-counts-Exit-entities-not-seams JSDoc
    clarification (Change D — the observability gap behind Celerock-2).
  - **Changed** — `detectLdtkRoomExit` per-axis containment latch: straddle
    suppression is now intrinsic (reset-immune — a discarded or freshly
    created detector state can no longer tick-tock). An exit additionally
    requires the body to have been fully contained on that exit's **crossing
    axis** in the current room once; the orthogonal axis is unaffected, so
    diagonal seam exits and corner arrivals behave as in 0.14.1.
- `package.json` → `0.15.0`.
- `docs/api-surface.md` — **the drift is larger than the preflight alone.**
  Exact-match audit — counting method: unique exported names across the
  barrel's `export {}` blocks (type-only exports included), each `` `name` ``
  backtick-matched against the document; re-run the same method when
  re-auditing so the figures stay reproducible. Result: the
  `src/platformer/` barrel exports **151** names, of which **115 (76%) are
  missing from the `src/platformer/` pillar** — 94 are absent from the whole
  document, and the other 21 live under different pillars (a name filed under
  another pillar is still undiscoverable where a platformer consumer looks,
  so the pillar count is the one that matters). The documented pillar predates
  0.9.0 entirely. Absent: the whole transition layer this plan builds on
  (`findLdtkRoomExit`, `detectLdtkRoomExit`, `beginRoomSlide*`,
  `roomEntrySlideView`, `seedRoomCutCamera`, …), the LDtk golden path
  (`compileLdtkRoom`, `createLdtkRoomCache`), the config scaler, feel
  moments, squash, the enemy layer. `loadLdtkProjectAssets` is also missing
  from the ldtk pillar (no `load.ts` row at all). The doc's own header says
  "Must always match `src/`. Drift = integration pain for consumers" — the
  Celerock builds are case study #1 for that warning. Scoped fixes:
  - **`src/ldtk/` pillar (header at line 1846):** add the missing preflight
    row — `inspectLdtkPlatformerProject(project)` describing the report
    (`levelCount`, per-level `neighbourIids` / `connected`,
    `disconnectedRoomIids`, `capabilities` including the new `multiRoom`) and
    stating in that row that `exits` counts Exit entities, not seam traversal
    — **plus** the missing `load.ts` row (`loadLdtkProjectAssets`,
    `LdtkAssetDiagnostic`).
  - **`src/platformer/` pillar (line 1114):** add rows for the **transition
    surface** — `room-transitions.ts`, `room-slide.ts`, and the new
    `room-transition-session.ts` — not just the session exports. That is
    **34 currently-missing names from the first two modules (19 values +
    15 types)** plus the **8 new session exports** (5 functions + 3 types) —
    **~42 rows**. These are the APIs Change C's brief rewrite tells builders
    to use by name — types included (`RoomExitDetectorState`, `RoomSlideView`,
    `RoomSlideOptions`, …) — so documenting the session while omitting what it
    composes would repeat the discoverability failure one layer up.
  - **Out of scope for 0.15.0:** the remaining **~81** missing names
    (115 − 34 transition-surface names brought in scope above; enemies,
    squash, config scaler, feel moments, LDtk room cache internals, …) — flag
    as a separate `@api-designer` backfill follow-up.
- No kernel physics/replay version bump expected (presentation/transition
  helpers only, no kernel state change — matches the `51ca752` precedent);
  re-verify during implementation that no replay-hash fixture changes
  (executed as §8 step 2).

---

## 8. Verification

1. Targeted:
   `npx vitest run src/tests/room-transitions.test.ts src/tests/room-transition-session.test.ts src/tests/room-slide.test.ts src/tests/ldtk-preflight.test.ts src/tests/barrel-contract.test.ts`
2. **Replay/determinism guard** (discharges the §7 "re-verify no replay-hash
   fixture changes" item, which is otherwise not covered by any test above):
   `npx vitest run src/tests/replay.test.ts src/tests/platformer-determinism.test.ts`
   must pass with **no fixture regeneration**. If either needs an updated hash,
   the change has touched kernel state and the "no kernel bump" assumption in
   §7 is wrong — stop and re-scope rather than re-baselining the fixture.
3. Full suite: `npm test` (current baseline: all passing — record new counts).
4. Typecheck: `npm run build` (`tsc --noEmit`).
5. Packed consumers: `npm run release:smoke`.
6. Manual review of the rewritten §5.5 example and §15 Stage 3 against the
   session API signatures (compile the example mentally or via a scratch
   typecheck; do not ship scratch files).

## 9. Not changing

- `findLdtkRoomExit`, `mapLdtkRoomEntry`, `transitionPlatformerToRoom`,
  `rebasePointBetweenLdtkRooms` semantics. `findLdtkRoomExit` is internally
  refactored to share the ranked-candidate helper (A.2), but its signature,
  export, and returned exit are unchanged — it still yields the top-ranked
  candidate with no gating.
- The `blockedEntryEdge` / deadband gate's blast radius: it still suppresses
  all exits during its ~1px window (A.6). Making it per-axis is a possible
  follow-up, explicitly out of scope here.
- `beginRoomSlide` / `beginRoomSlideFromBrain` / `roomEntrySlideView` /
  camera-space enter/finish/cancel helpers (the session composes them).
- Camera-brain first-activation behavior; kernel physics; replay hash.
- Existing preflight report fields, entity-kind resolution
  (`LDTK_DEFAULT_ENTITY_MAP`), and BFS connectivity semantics — Change D adds
  only `multiRoom` + one diagnostic + JSDoc. Additive for *consumers* (no field
  is removed, renamed, or retyped, so existing reads keep compiling), but not
  a no-op for *tests*: `capabilities` gains a key, so exhaustive
  `toEqual`-style assertions on the report shape must be updated (§6).
- The Celerock game repos (`main.ts` migrations are a separate follow-up once
  `0.15.0` is published).

## 10. Workspace safety

Branch from `main` before implementation. Do not commit, tag, push, or
publish without explicit user approval. Release actions (`v0.15.0` tag, npm
publish) are a separately authorized step after all gates pass.
