# Celerock 0.7.0 Upgrade Plan

**Status:** Proposed  
**Scope:** Upgrade the Celerock tutorial at `/Users/morganpage/Documents/VSCODE/OPENCODE/TUTORIALS/celerock-2` from `aicraft-engine@0.6.0` plus a consumer shim to the supported 0.7.x golden path  
**Engine baseline:** `aicraft-engine@0.7.0` is published and tagged `latest`  
**Primary evidence:**

- `/Users/morganpage/Documents/VSCODE/OPENCODE/TUTORIALS/celerock-2/BUILD_PROBLEMS.md`
- `/Users/morganpage/Documents/VSCODE/OPENCODE/TUTORIALS/celerock-2/src/engine.ts`
- `games/celerock.md`
- The `v0.7.0` source, packed artifact, and public declarations

## 1. Executive summary

The 0.7.0 release fixes the main engine gaps that forced Celerock to pin 0.6.0 and reimplement the proposed golden-path API. The published root barrel now exports:

- `loadLdtkProjectAssets`
- `inspectLdtkPlatformerProject`
- `compileLdtkRoom` and `createLdtkRoomCache`
- `scalePlatformerConfig` and `createPrecisionPlatformerConfig`
- `solidIdForEntity` and `entityIdFromSolidId`
- `settlePlatformerState`
- `IDLE_EDGE` and the standard keyboard/gamepad maps
- `sineShake` and `shakeEnvelope`

However, upgrading is not a dependency-only change. Replacing the current Celerock shim with a direct package re-export produces strict TypeScript errors because the shim's convenience shapes differ from the final 0.7.0 contracts. There is also one confirmed defect in the published loader: the documented relative browser URL `./levels/level.ldtk` is rejected before `fetch` because the implementation uses `new URL(value)` without a base.

The recommended delivery is therefore:

1. Patch the two engine issues on `main` and release them as 0.7.1.
2. Migrate Celerock away from its engine-API reimplementations.
3. Keep only genuinely game-owned helpers, such as player-image decoding and stateful shake presentation, in clearly named consumer modules.
4. Run the migration against a packed engine artifact before publishing.

An immediate exact-0.7.0 migration is also possible by resolving the project URL to an absolute `URL` in Celerock and retaining a local collectible type predicate.

## 2. Audit outcome

| Original build problem | 0.7.0 outcome | Upgrade action |
|---|---|---|
| 0.7.0 did not exist | Fixed; 0.7.0 is published | Change the dependency after compatibility work |
| Golden-path wrappers were absent | Mostly fixed | Delete shadow implementations and use package exports |
| `playNoise` documentation drift | Fixed in current brief | Keep duration-first calls |
| Strict typing in the consumer shim | Partially superseded | Remove the shim; strengthen the engine collectible bucket type |
| Invalid seed literals | Consumer bug, already fixed | Preserve the valid numeric seeds |
| `GameState.mode` drift | Fixed in current brief | Use `GameState.current` |
| Invalid `OutlineCoverage: 'all'` | Fixed in current brief | Use `'floor'` or `'ceil'` |
| Generic `SaveStorage<T>` assumption | Fixed in current brief | Keep `SaveStorage` non-generic |
| Numeric collectible IDs passed to `collect` | Fixed in current brief | Continue using `String(id)` |
| DPR canvas only partly painted | Not an engine defect | Retain the fixed 480×270 logical canvas policy |
| Parallax hidden behind an opaque room | Consumer composition issue | Retain the cave-interior depth treatment |
| Broken browser screenshots | External tooling issue | Retain the server-side render harness |
| Encoded paths fail in filesystem `loadImage` | Environment boundary | Keep filesystem paths for Node canvas; use bytes/URLs in browser loader |
| Stale Vite output | Process-management issue | Restart the dev server when transforms become stale |
| Vision misses subtle pixel effects | External tooling limitation | Keep deterministic pixel-count assertions |
| Animation advanced in render | Consumer scheduling issue, already fixed | Keep animation advancement in the fixed step |
| Player blocked at x≈68 | Level geometry, not a bug | No change |

## 3. Confirmed compatibility differences

The current Celerock `src/engine.ts` is not signature-identical to the final 0.7.0 API. The migration must address these differences explicitly.

### 3.1 Room shape

Current shim code reads:

```ts
room.iid
room.tileSize
```

The 0.7.0 room owns the canonical source and translated level instead:

```ts
room.ldtkLevel.iid
room.levelData.tileSize
```

Use the nested canonical fields. Do not add duplicate `iid` and `tileSize` aliases unless a second independent consumer demonstrates a real ergonomics need.

### 3.2 Spawn recovery return value

The shim returns a `PlatformerState` directly. The engine returns diagnostic metadata:

```ts
const result = settlePlatformerState(initial, room.solids, config);
const state = result.state;
```

For normal LDtk rooms, prefer `room.compiled.initialState`; `compileLdtkRoom` already applies the feet-center to actor-top-left conversion. Settling should be a recovery path for malformed or legacy spawns, not unconditional boot logic.

### 3.3 Report type name

Replace the shim-only `LdtkProjectReport` with:

```ts
LdtkPlatformerProjectReport
```

### 3.4 Loader diagnostics

The engine diagnostic shape has `message`, `severity`, and optional `relPath`/`tilesetUid`; it does not have the shim's required `path` field. Logging should tolerate optional context:

```ts
const context = diagnostic.relPath ? ` (${diagnostic.relPath})` : '';
console.warn(`[ldtk ${diagnostic.severity}]${context} ${diagnostic.message}`);
```

### 3.5 Collectible bucket typing

`CompiledLdtkRoom.collectibles` is currently declared as `readonly LevelEntity[]`, although the implementation filters it to `kind === 'collectible'`. `derivePickups` correctly requires `readonly CollectibleEntity[]`, so direct migration fails strict type checking.

Recommended engine fix:

```ts
readonly collectibles: readonly CollectibleEntity[];
```

The implementation must use a type predicate. Apply the same narrowing pattern to other room buckets where it improves the public contract without inventing new entity variants.

Immediate 0.7.0 workaround:

```ts
const collectibles = room.collectibles.filter(
  (entity): entity is CollectibleEntity => entity.kind === 'collectible',
);
```

Do not cast the whole array blindly.

### 3.6 Cache lookup behavior

The shim's `get(iid)` returns `undefined` for an unknown room. The engine's `get(iid)` throws because an unknown ID is treated as a programmer error. Neighbour-driven transitions should probe first:

```ts
if (!rooms.has(targetIid)) return false;
const target = rooms.get(targetIid);
```

### 3.7 Ladder bucket semantics

The shim exposes trigger entities as `ladders`. The engine exposes `readonly Solid[]` and currently returns an empty array; ladder traversal is represented by `tileSemantics.ladder` and runtime ladder-cell overlays. Celerock must not treat arbitrary trigger entities as ladders.

### 3.8 Consumer-only helpers

The package does not export these shim-specific helpers:

- `decodeImageBounded`
- `createShake`
- `triggerShake`
- `stepShake`
- `shakeOffset`
- shim report/diagnostic aliases

They should not remain in a file presented as an engine compatibility layer.

- Move player bitmap decoding to `src/assets/load-image.ts` or equivalent.
- Implement stateful shake presentation in `src/game/shake.ts`, composed from engine `sineShake`/`shakeEnvelope` or an explicit seeded RNG.
- Delete shim-only report and diagnostic aliases.

## 4. Engine workstream

### E1. Support relative project URLs in `loadLdtkProjectAssets`

**Confirmed defect**

The current documentation uses:

```ts
loadLdtkProjectAssets({ projectUrl: './levels/level.ldtk' });
```

The published 0.7.0 implementation returns:

```text
invalid projectUrl: ./levels/level.ldtk
```

because it evaluates `new URL(options.projectUrl)` without a base.

**Required behavior**

- Absolute strings and `URL` objects continue to work.
- Relative strings resolve against a lazily and defensively read browser base (`document.baseURI` or `location.href`).
- Node/SSR without a host base returns a clear diagnostic unless the caller supplied an absolute URL.
- Relative tileset paths continue resolving against the project URL or explicit `assetBaseUrl`.
- No host API is read at module import time.

**Tests**

- Relative project URL resolves in a simulated browser host.
- Absolute HTTP URL remains unchanged.
- Absolute `file:` URL remains usable with an injected fetch.
- Relative URL without a host base fails quickly and diagnostically in Node.
- Spaces, brackets, Unicode, and `..` segments remain encoded correctly.
- The documented Celerock call is included in a compiler-checked or runnable example.

**Immediate consumer workaround**

```ts
const projectUrl = new URL('./level.ldtk', document.baseURI);
const loaded = await loadLdtkProjectAssets({ projectUrl });
```

### E2. Narrow LDtk room entity buckets

Update the public room contract so filtered buckets carry filtered types. At minimum:

```ts
readonly collectibles: readonly CollectibleEntity[];
```

Acceptance criteria:

- `derivePickups(rect, room.collectibles, save)` compiles without a consumer cast.
- The implementation uses a type predicate.
- The packed `.d.ts` contains the narrowed type.
- Existing room-cache identity and determinism tests still pass.

### E3. Add a migration contract test

Create a strict fixture representing the Celerock imports and direct golden-path calls. It should compile against the packed artifact, not repository source resolution.

The fixture should cover:

- Relative LDtk loading.
- Project preflight.
- Config creation.
- Room-cache start selection.
- Canonical room ID/tile-size access.
- Collectible derivation and string save IDs.
- `settlePlatformerState` result destructuring.
- Game-state `current` access.
- Duration-first `playNoise` calls.

### E4. Release policy

The published 0.7.0 tarball is immutable. Engine changes from E1/E2 should be released as 0.7.1. Once 0.7.1 exists, Celerock may depend on either:

```json
"aicraft-engine": "^0.7.0"
```

or exact `0.7.1` if tutorial reproducibility takes priority over patch uptake.

## 5. Celerock consumer workstream

### C1. Establish a migration branch and baseline

Before changing imports:

1. Record `npm run typecheck` and `npm run build` on 0.6.0.
2. Capture deterministic title, gameplay, dash, landing, and room-transition frames with the render harness.
3. Record key simulation traces: spawn position, first grounded tick, wall lip collision, dash bonk, pickup, death, and transition entry.
4. Preserve the current fixed-canvas and fixed-step animation behavior.

### C2. Upgrade the dependency

For the immediate path:

```json
"aicraft-engine": "0.7.0"
```

and apply the relative-URL/type-predicate workarounds.

For the recommended path, first release the engine fixes and use exact `0.7.1` or `^0.7.0`.

Regenerate the lockfile and confirm that `npm ls aicraft-engine` reports a single expected version.

### C3. Remove engine API shadowing

Delete from Celerock's `src/engine.ts` every implementation now owned by the package:

- LDtk loader, preflight, room compiler, and room cache
- Config scaling and precision-config factory
- Solid/entity ID helpers
- Spawn settling
- Idle input edge and standard input maps
- Reimplemented package types

Prefer direct imports from `aicraft-engine`. If a short-lived facade is necessary to keep the migration reviewable, it must contain only:

```ts
export * from 'aicraft-engine';
```

and must not redeclare a package export.

### C4. Move game-owned presentation helpers

- Move bounded `Player.png` decoding into an asset module.
- Move stateful shake timing and seeded offset selection into a presentation module.
- Continue using engine `sineShake`/`shakeEnvelope` where they fit.
- Keep all shake output presentation-only; it must never alter authoritative player coordinates.

### C5. Adopt final room contracts

Update all consumers:

- `room.iid` → `room.ldtkLevel.iid`
- `room.tileSize` → `room.levelData.tileSize`
- `settlePlatformerState(...)` → `settlePlatformerState(...).state`
- `LdtkProjectReport` → `LdtkPlatformerProjectReport`
- diagnostic `.path` → optional `.relPath` plus `.message`
- guard cache lookups with `has`
- remove trigger-as-ladder assumptions

Prefer `room.compiled.initialState` for normal spawn/respawn construction so the engine's resolved body size, config, and spawn convention remain a single unit.

### C6. Preserve already-correct consumer fixes

The migration must not regress fixes that 0.7.0 does not own:

- Fixed 480×270 backing canvas with CSS pixelated upscale.
- Identity transform for the logical render pass.
- Fixed-step-only `advancePlayerAnim`.
- `currentFrameIndex` slot-to-absolute-frame conversion.
- Valid deterministic seeds.
- `String(id)` at collectible save boundaries.
- Cave depth overlay and deterministic dust.
- Filesystem path handling in the Node render harness.
- Pixel-count assertions for subtle visual effects.

## 6. Verification plan

### 6.1 Engine verification

Run at minimum:

```bash
npm run build
npm test
npm run build:dist
npm run release:smoke
```

Add focused coverage for:

- `src/tests/ldtk-load.test.ts`
- `src/tests/ldtk-room.test.ts`
- `src/tests/celerock-hardening.test.ts`
- A packed-artifact Celerock contract fixture

### 6.2 Consumer verification

Run:

```bash
npm run typecheck
npm run build
```

Then verify in a real browser:

1. `./level.ldtk` loads without an invalid-URL diagnostic.
2. The tileset whose name contains spaces/brackets loads.
3. The authored start room is selected.
4. Player feet begin flush with the surface and ground within the expected ticks.
5. Room transitions preserve velocity and facing.
6. Unknown neighbour IDs fail safely.
7. Strawberries collect once and persist after reload.
8. Dash refills and springs remain non-blocking interactions.
9. Dash bonk, landing, death, and respawn shake remain presentation-only.
10. Walk/jump animation remains deterministic at different render rates.
11. The canvas has no partial-fill, tiling, or DPR artifacts.

### 6.3 Visual regression verification

Render the same deterministic ticks before and after migration. Compare:

- Canvas dimensions and painted bounds.
- Player feet anchor and selected sprite frame.
- Cave gradient samples.
- Dust pixel counts.
- Dash afterimage tint counts.
- Landing/death burst color counts.

Expected differences must be explained. Spawn movement caused by replacing the shim's raw translated spawn with the engine's resolved spawn is likely a correctness fix, not a regression, but it must be inspected explicitly.

## 7. Acceptance gates

The upgrade is complete only when:

- Celerock has no reimplementation of a public 0.7.x engine API.
- The consumer builds in strict mode without broad casts or `any`.
- The documented relative project URL works, or the exact-0.7.0 workaround is explicit at the call site.
- `derivePickups` accepts the room collectible bucket without an unsafe cast.
- Normal LDtk boot uses the compiled resolved spawn.
- Cache lookup behavior is handled intentionally.
- All deterministic simulation traces pass.
- Browser and server-side visual checks pass.
- The packed engine artifact, not only repository source, passes the Celerock contract fixture.
- `BUILD_PROBLEMS.md` is updated or supplemented to state that 0.7.x now exists and distinguish engine fixes from consumer/tooling lessons.

## 8. Recommended implementation order

1. Add failing relative-loader and collectible-bucket tests in the engine.
2. Implement E1 and E2 without touching unrelated in-progress platformer work.
3. Run engine tests and packed release smoke.
4. Pack the patched engine locally.
5. Upgrade a clean copy of Celerock to the tarball.
6. Remove the API-shadowing shim in small import-focused changes.
7. Move player-image and shake presentation helpers to consumer modules.
8. Fix room, report, diagnostics, cache, ladder, spawn, and collectible call sites.
9. Run typecheck/build, deterministic traces, browser smoke, and render-harness comparisons.
10. Publish 0.7.1, replace the tarball reference with the registry dependency, and repeat the clean-install verification.

## 9. Risks and controls

| Risk | Control |
|---|---|
| The shim masks package regressions | Remove duplicate exports and test the packed artifact |
| Spawn changes alter gameplay | Compare spawn/grounding traces and inspect first rendered frame |
| Relative URL fix reads browser globals eagerly | Resolve host base lazily inside the loader |
| Bucket narrowing becomes an unsafe assertion | Use `Extract` types and implementation predicates |
| Unknown room IDs now throw | Guard untrusted IDs with `rooms.has` |
| Shake refactor affects simulation | Keep offsets in render-only state and test authoritative coordinates |
| Canvas behavior regresses during cleanup | Leave fixed logical canvas code unchanged and compare painted bounds |
| Published docs drift again | Compile/run the canonical Celerock fixture during release smoke |

## 10. Decision record

- Treat 0.7.0 as the first golden-path release, but not as a drop-in replacement for the consumer shim.
- Do not expand the engine merely to reproduce every shim convenience alias.
- Fix the relative project URL and collectible bucket typing at the engine layer.
- Keep player bitmap loading, stateful shake policy, canvas policy, visual composition, and QA harness behavior in Celerock.
- Publish engine corrections as 0.7.1 because the existing 0.7.0 artifact cannot be changed.
