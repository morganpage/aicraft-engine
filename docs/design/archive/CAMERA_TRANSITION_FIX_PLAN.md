# Camera level-transition bugs — root cause & fix plan

Both bugs live in **`showcase/sections/ldtk-editor/play.ts`** (the LDtk play-session driver). The engine already has a richer `src/platformer/room-slide.ts` slide system, but it is **not wired into any driver** — this plan fixes the symptoms at their actual source rather than doing a large integration.

## Bug 1 — "tick-tocks" between levels at the seam (no hysteresis)

**`transitionFor()` (play.ts:250–272)** fires the instant *any* part of the AABB is `> 0` past an edge:

```ts
const overLeft = -body.x;                 // >0 as soon as x < 0
const maxOver = Math.max(...);
if (maxOver <= 0) return undefined;
```

Combined with `entryPoint()` clamping the player to *exactly* the new room's seam (`x: 0` on east entry, pinned by `ldtk-editor-transitions.test.ts:108–113`), one sub-pixel of solver jitter on the seam flips A→B→A→B every frame. Each flip calls `resetRoomCameraBrain` + re-render → visible tick-tock.

**Fix — add a direction-specific re-arm deadband on the session side (keeps `transitionFor` pure + tests intact):**

A plain `armedFor` boolean is not sufficient: `entryPoint()` places the player exactly on the destination seam, and exact containment (`x === 0`, for example) would re-arm immediately. Requiring strict containment on every edge is also wrong because a grounded player may legitimately remain flush with the floor forever.

Add a small pure helper plus a session-local `blockedEntryEdge: CardinalDir | null`:

```ts
export const TRANSITION_REARM_MARGIN = 1; // world pixel

export function hasClearedEntryDeadband(
  body: Readonly<{ x: number; y: number; width: number; height: number }>,
  level: Readonly<{ pxWid: number; pxHei: number }>,
  entryEdge: CardinalDir,
  margin = TRANSITION_REARM_MARGIN,
): boolean {
  switch (entryEdge) {
    case 'w': return body.x >= margin;
    case 'e': return body.x + body.width <= level.pxWid - margin;
    case 'n': return body.y >= margin;
    case 's': return body.y + body.height <= level.pxHei - margin;
  }
}
```

Session logic:

- Start with `blockedEntryEdge = null`.
- Before checking for an exit, clear the block only when `hasClearedEntryDeadband` says the player has moved at least one world pixel away from the seam they entered through.
- Only call `transitionFor` while there is no blocked entry edge. The gate is deliberately global for this short interval so a corner overlap cannot select a second edge while the entry seam is still unsettled.
- After an exit fires, record the opposite edge in the destination (`e → w`, `w → e`, `n → s`, `s → n`). The stored direction determines which seam must be cleared before transitions are enabled again.
- On the reset key and fall-respawn fallback, clear the block (`blockedEntryEdge = null`).

The one-pixel margin is large enough to absorb sub-pixel solver jitter while remaining small relative to both 8px and 16px tiles. The pure helper makes the contract directly testable without constructing a DOM-backed play session.

## Bug 2 — "always dips down" (camera cuts to room origin `(0,0)`)

**`resetRoomCameraBrain()` (play.ts:216–218)** creates the new brain at the destination room's local origin:

```ts
return createCameraBrain({ x: 0, y: 0, zoom: brain.zoom });
```

On the next frame this is a **first activation** (`activeId === null`), and `updateCameraBrain` (brain.ts:381–383) seeds `bodyCamera` from `repaired.camera` — the `(0,0)` top-left. The follow solver then pans *down* from the room's top-left to wherever the player is (up to 1600 px/s). For east/west transitions the camera should preserve its perpendicular world-Y framing through the room cut; instead it restarts from local `y=0` and visibly dips toward the player.

**Fix — seed the new brain from the world-space-preserved camera position:** replace the `(0,0)` origin with the destination-local camera position computed from the previous room's rendered camera. Use the engine's existing `rebasePointBetweenLdtkRooms()` helper, which preserves a point exactly and does not apply actor-specific clamping:

```ts
// in the transition handler, before resetRoomCameraBrain:
const cameraSeed = rebasePointBetweenLdtkRooms(
  brain.camera,
  active.ldtkLevel, // current source room
  target.ldtkLevel, // destination
);
brain = resetRoomCameraBrain(brain, cameraSeed);
```

`resetRoomCameraBrain` gains one optional atomic seed object (defaulting to `{ x: 0, y: 0 }` for back-compat):

```ts
export function resetRoomCameraBrain(
  brain: Readonly<CameraBrain>,
  seed: Readonly<{ x: number; y: number }> = { x: 0, y: 0 },
): CameraBrain {
  return createCameraBrain({ x: seed.x, y: seed.y, zoom: brain.zoom });
}
```

The rebase preserves the rendered camera top-left in world space. On the first destination update, `updateCameraBrain()` remains the sole authority for viewport/zoom-aware clamping; this correctly handles cameras whose valid local position is negative because the room is smaller than the viewport. For east/west transitions, perpendicular world-Y continuity is preserved where the destination bounds permit it; north/south transitions get the equivalent world-X continuity.

> Do not use `entryPoint()` for the camera. Its clamp is intentionally based on an actor AABB (`to.pxWid - body.width`, `to.pxHei - body.height`), not the camera's `viewport / zoom` dimensions. Treating the camera as a player-sized rectangle can collapse a valid rebased coordinate back to `(0,0)` or clamp it to a position the camera itself cannot use.

This is a **continuity-preserving room cut**, not a full visual room slide: the showcase still renders only the active destination room. A true slide must integrate `src/platformer/room-slide.ts` and render both rooms in its normalized slide space; that remains a separate follow-up.

## Files changed

- **`showcase/sections/ldtk-editor/play.ts`**
  - Import the existing `rebasePointBetweenLdtkRooms` helper from the platformer barrel.
  - `resetRoomCameraBrain(brain, seed?)` — accept an optional atomic seed position (defaults to the origin).
  - Add the pure `hasClearedEntryDeadband` helper and one-pixel default margin.
  - `step(dt)` transition handler — compute the rebased camera seed before changing `active`, pass it to reset, and maintain `blockedEntryEdge`.
- **`showcase/tests/ldtk-editor-transitions.test.ts`**
  - Keep one test for the default origin behavior and add seeded-position assertions for `camera` and `bodyCamera`; the first-activation/no-blend contract still holds.
  - Pin the camera world-space invariant (`to.worldX + seed.x === from.worldX + oldCamera.x`, and likewise for Y).
  - Run the first destination `updateCameraBrain()` step with bounds that permit the seeded perpendicular coordinate, proving it does not restart that axis from zero and that the camera brain performs the final viewport-aware clamp.
  - Test all four `hasClearedEntryDeadband` directions: exact seam and sub-margin jitter stay blocked; reaching the margin re-arms. Include a grounded south-edge case to prove unrelated flush edges do not prevent an east/west re-arm.

## Not changing

- `transitionFor` and `entryPoint` — kept pure; `entryPoint` remains player-only.
- `src/platformer/room-transitions.ts` — reuse its existing exported point-rebase helper; no engine change required.
- `src/platformer/room-slide.ts` — full slide/render integration is a larger follow-up. Leave a `// TODO` near the reset call that explicitly identifies this implementation as a room cut.

## Verification

- Run the transition test file with the showcase Vitest config: `npm run showcase:test -- showcase/tests/ldtk-editor-transitions.test.ts`
- Run engine tests: `npm test`
- Run the full showcase suite: `npm run showcase:test`
- Type-check both targets: `npm run build` and `npm run showcase:typecheck`
- Manual: in the existing LDtk editor play mode, cross east/west/north/south seams and linger on each entry seam. Confirm there is no reverse tick-tock and no perpendicular-axis dip. The room switch remains an intentional cut; do not claim a two-room smooth slide in this scope.

Branch off `main` before implementation. Preserve the existing unrelated modification to `games/celerock.md`; do not stage or edit it as part of this fix.
