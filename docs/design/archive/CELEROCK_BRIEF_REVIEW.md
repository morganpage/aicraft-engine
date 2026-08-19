# `games/celerock.md` — Review

**Reviewed:** 2026-08-16 · **Target:** `games/celerock.md` (1148 lines) · **Against:** `aicraft-engine@0.15.0` (this repo, `dist/` barrel + `src/` signatures) and the shipped asset pack in `games/`.

Every claim below was verified by running the real engine against the real assets, not read off the brief. Evidence is inlined.

---

## 0. Verification summary — what checks out

The brief's asset contract is **exactly right**. Running the real preflight against `games/celerock.ldtk`:

```
levelCount 5   totalSpawns 1   tileSizes [8]
caps { hazards: true, collectibles: true, springs: false, dashRefills: false,
       exits: false, ladders: false, movingPlatforms: false, multiRoom: true }
spawnLessRoomIids 4   disconnectedRoomIids 0   unknownTriggerIdentifiers []

Level_0  px 320 184  world    0   0  nbrs [e]     { Player:1, Gem:1, Spike:1 }
Level_1  px 320 184  world  320   0  nbrs [w,e]   {}
Level_2  px 320 184  world  640 -72  nbrs [w,e]   {}
Level_3  px 320 184  world  960 -40  nbrs [w,e]   {}
Level_4  px 320 184  world 1280 -56  nbrs [w]     { Spike:5 }

tilesets  [('_V1_3_tranquil_tunnels_transparent', 'celerock.png', 1024, 1024, 8)]
intgrid   [(1, 'walls')]
entity defs  ['Player','Spike','Gem','Spring','DashRefill']
jsonVersion 1.5.3   externalLevels False
Player.png 160x128   celerock.png 1024x1024
```

Start-room compile: `{ ok: true, identifier: 'Level_0' }`, `spawn { x:18, y:140, source:'authored' }`, `diagnostics []`, buckets `hazards 1 / collectibles 1 / exits 0 / ladders 0`.

Also verified correct:

- **Every API name the brief uses exists on the root barrel.** A runtime import check of ~150 named exports came back with exactly one miss — `easeInOutCubic` — which the brief already flags as not exported ([:119](games/celerock.md:119)).
- `LevelData.width/height` are **pixels**, so the §5.4 `bounds: { width: active.levelData.width, ... }` is correct.
- The §5.5 session code matches the real signatures: `pollRoomTransition(session, body, level, project, options?) → { session, result }`, `beginSessionRoomSlide(session, input, options?) → { session, brain, ok }`, `endRoomTransitionSession(session, brain, 'source'|'destination')`, `SessionSlideBeginInput` fields, and the `RoomSlidePresentation` shape (`vcam` / `bounds` / `sourceOffset` / `destinationOffset` / `playerOffset`).
- The audio signatures are right: `playTone(type, f0, f1, durMs, peak, whenS?)`, `playNoise(durMs, filterType, freq, peak, whenS?)`, `startNoiseLoop(filterType, freq, peak) → NoiseLoopHandle`.
- The §4.4 "KNOWN ENGINE GAP" claim is accurate — `compileSpriteSheet` does return `loop: true` for the `jump` frameTag.
- `ActorCore` field names (`x/y/width/height/vx/vy/facing/onGround/contacts`) and `deriveSpriteAnimKind({ supported, speedX, velocityY })` are correct.

The problems below are all in the *instructions*, not the *facts*.

---

## 1. Must fix — code the agent will copy verbatim

### 1.1 The jump animation draws the wrong frames

**Where:** [celerock.md:425](games/celerock.md:425) (and the `?? 60` fallback that reveals the intent)

`currentFrameIndex` returns **the index into `anim.frameIndices`** — a slot, `0..n-1`. `drawSprite` → `resolveDrawSource` indexes **`sheet.frames[frameIndex]`** — a sheet cell. The brief pipes one straight into the other.

Proof (real engine, real sheet JSON from §4.4):

```
elapsed   0 -> currentFrameIndex(jump) = 0   sheet cell SHOULD be 60
elapsed  80 -> currentFrameIndex(jump) = 1   sheet cell SHOULD be 61
elapsed 160 -> currentFrameIndex(jump) = 2   sheet cell SHOULD be 62
elapsed 240 -> currentFrameIndex(jump) = 3   sheet cell SHOULD be 63
elapsed 320 -> currentFrameIndex(jump) = 4   sheet cell SHOULD be 64
elapsed 1000-> currentFrameIndex(jump) = 4   (clamped — loop:false works as documented)

sheet.frames[0]  = { x:0, y:0,  w:16, h:16 }   <- row 0, WALK frame 1
sheet.frames[60] = { x:0, y:96, w:16, h:16 }   <- row 6, JUMP frame 1
```

So the jump clip renders **cells 0–4 — the first five walk frames** — while animating at the correct rate with a correct clamp. It looks like a working animation with wrong art, which is the worst failure mode for a visual gate.

Walk survives only by coincidence: its `frameIndices` are `[0..7]`, so slot == cell.

**Fix:**

```ts
const slot = currentFrameIndex(jumpClock, jumpAnim!) ?? 0;
frameIndex = jumpAnim!.frameIndices[slot];   // 60..64, not 0..4
```

Apply the same indirection to the walk path so the pattern is stated once and correctly, rather than working by accident:

```ts
const slot = currentFrameIndex(walkClock, walkAnim!) ?? 0;
frameIndex = walkAnim!.frameIndices[slot];
```

**Why it matters beyond the one line:** §12.7 criterion 14 and §13 gate 7 both assert "jump plays 60→64 then clamps on the fall frame." Both would be reported as passing by an agent that copied the sample. Worth a callout box next to the existing `loop:false` gap note, since the two gotchas live in the same three lines of code.

---

### 1.2 The §1 import block omits the entire transition + camera-fit surface

**Where:** [celerock.md:30-127](games/celerock.md:30)

§1 says *"Import from the **root barrel only**"* and supplies a block the agent will paste as its first action. The following are used in §5.4 / §5.5 / §8 / §15 Stage 3 but are **not in that block**:

| Missing value export | Used at |
|---|---|
| `fitCameraZoom` | §5.4 vcam lens, §5.5 destination zoom, §12.7 #5 |
| `roomEntrySlideView` | §5.5 destination view |
| `createRoomTransitionSession` | §5.5, Stage 3 |
| `pollRoomTransition` | §5.5, §12.3, Stage 3 |
| `beginSessionRoomSlide` | §5.5, §12.3, Stage 3 |
| `advanceSessionRoomSlide` | §5.5, §12.3, Stage 3 |
| `endRoomTransitionSession` | §5.5, §8 respawn, Stage 3 |
| `presentationForRoomSlide` | §5.5 slide camera |
| `ROOM_SLIDE_VCAM_ID` | §5.5 `activeId` |
| `mapLdtkRoomEntry` | §5.5, §12.3 |
| `transitionPlatformerToRoom` | §5.5, §8, §12.3 |
| `rebasePointBetweenLdtkRooms` | §5.5, Stage 3 particle carry |
| `findLdtkRoomExit` / `detectLdtkRoomExit` | §5.5 composition layer, §12.3 |

| Missing type export | Used at |
|---|---|
| `KeyboardConfig` | §4.3 — `const CELESTE_KEYBOARD_MAP: Readonly<KeyboardConfig>` |
| `LdtkRoomExit` / `LdtkRoomEntry` | §5.5 composition-layer signatures |
| `CollectibleKind` | §7 ("do not invent a `'strawberry'` literal") |
| `LdtkTranslateOptions` | §5.2 (`entityMap` override) |

**All of these exist on the barrel** — verified by runtime import. They are simply absent from the list.

This is the highest-leverage fix in the document. Stage 3 is the one non-skippable gate ([:172](games/celerock.md:172)), §14 declares a camera pop a build failure, and the agent's very first action is to copy an import block that cannot compile any of it. An agent that trusts the block over the prose will conclude the session API isn't available and hand-roll the transition — reproducing the exact failure mode §5.5 exists to prevent.

**Also:** `converge` ([:68](games/celerock.md:68)) is imported and never used anywhere in the brief. Drop it.

---

### 1.3 `prevCore` is undefined in the §5.5 sample

**Where:** [celerock.md:648](games/celerock.md:648)

```ts
actor: { sourceLocal: { x: prevCore.x, y: prevCore.y }, destinationLocal: { x: entry.x, y: entry.y } },
```

`prevCore` is never declared. Two lines earlier `state` was reassigned by `transitionPlatformerToRoom`, so `state.core` is already destination-local — the agent has to infer that `prevCore` must be the **source-room body captured before the transition**. Getting it wrong corrupts the slide's continuity math (`playerOffset` would be computed from the wrong endpoint), and the symptom is a subtle seam pop rather than a crash.

**Fix:** add the capture line explicitly, before the `mapLdtkRoomEntry` call:

```ts
const prevCore = state.core;          // source-local body — captured BEFORE the transition
const entry = mapLdtkRoomEntry(state.core, active.ldtkLevel, target.ldtkLevel, exit);
({ state } = transitionPlatformerToRoom(state, entry, { destinationSolids: target.solids, config }));
```

---

## 2. Internal contradictions

Each is a one-line edit; together they cost the agent confidence in the parts of the brief that *are* precise.

| # | Where | Says | Should say |
|---|---|---|---|
| 2.1 | [:25](games/celerock.md:25) vs [:1121](games/celerock.md:1121) | "Do not pin below `0.14.1`" / "Do not pin below `0.15.0`" | `0.15.0` in both |
| 2.2 | [:1127](games/celerock.md:1127) | §19 table header "This brief (0.9.0)" | "This brief (0.15.0)" |
| 2.3 | [:1106](games/celerock.md:1106) + [:1115](games/celerock.md:1115) | "these are the reason for the pin" — claimed twice, for two different versions | Keep it on the 0.15.0 block; reword the 0.9.0 block as "still required, inherited" |
| 2.4 | [:272](games/celerock.md:272), [:838](games/celerock.md:838) | "physics v12" | `CURRENT_PHYSICS_VERSION` is **13** (verified). The wall-grab wave *landed in* v12 — phrase as "since physics v12" so it doesn't read as the current version, which [:25](games/celerock.md:25) and [:277](games/celerock.md:277) correctly give as 13 |
| 2.5 | [:1057](games/celerock.md:1057) | "Stretch Goals (only after criteria 1–13)" | §12.7 has **14** criteria |
| 2.6 | [:249](games/celerock.md:249) vs [:1021](games/celerock.md:1021) | `playConfigFor` never sets `groundDuckEnabled: false` or `stepHeight`; Stage 2 step 1 lists both as required kit | Verified defaults: `groundDuckEnabled: true`, `stepHeight: 0`. Either bake them into `playConfigFor` or strike them from Stage 2 |

On 2.6 specifically — §4.1's comment block explains *why* `groundDuckEnabled: false` is wanted ("keeps Down responsive for ladders/fast-fall/dash-aim while preserving ability-owned duck tech") and then leaves it as a "to tweak one, spread the result" aside. If it's the intended feel, the function should return it:

```ts
return { ...createPrecisionPlatformerConfig({ ... }), groundDuckEnabled: false };
```

Also note `climbEnabled: true` is hardcoded in `playConfigFor` while Stage 2 says "`climbEnabled` (if ladders)" — the shipped pack has no ladders (IntGrid is `1: walls` only). Harmless, but the two should agree.

---

## 3. Real gaps — decisions the brief never makes

### 3.1 There is no defined completion state

- [:172](games/celerock.md:172): *"Traversal from the start room to the **final room's summit** is the win condition and is **core scope**."*
- [:798](games/celerock.md:798): *"The shipped pack has no goal entity, so this transition is unreachable in the canonical build: 'finishing' means reaching `Level_4`. Do not invent a goal, and do not add one to the `.ldtk`."*

So: reaching the summit is core scope, the FSM path to acknowledge it is unreachable, and no acceptance criterion in §12.7 or gate in §13 covers arrival. The agent is told the win condition matters and given no way to express it.

**Suggested resolution** — define completion structurally rather than by entity, which keeps the "don't edit the `.ldtk`" rule intact:

> The **terminal room** is the room with no `e` neighbour in `__neighbours` (`Level_4` in the shipped pack; derived, never hardcoded). On seam-entry into the terminal room, fire the chapter-complete card via the existing `createTweenState` + `easeOutBack` path. No `Goal` entity is created and the FSM `win` event stays unused.

Then add it as §12.7 criterion 15 and a §13 gate, so Stage 3's "traversal is core scope" has something to assert against.

### 3.2 Surface cache vs `drawLdtkLevel` is left unresolved

[:615](games/celerock.md:615) introduces `createLdtkLevelSurfaceCache` as *"a drop-in replacement for the `drawLdtkLevel` call above"* and the fix for hairline seams under fractional zoom. But every other mention of rendering names `drawLdtkLevel` directly:

- §5.5 slide rendering ([:672-673](games/celerock.md:672)) — draws **both rooms** with `drawLdtkLevel`
- §11 file layout ([:867](games/celerock.md:867)) — `render.ts # drawLdtkLevel (the tileset)`
- §12.7 criterion 3, §13 gate 1, §14 first bullet, §17 — all say `drawLdtkLevel`

The mid-slide lens ease is *guaranteed* fractional zoom — it is precisely the moment the cache exists for, and precisely where the brief reverts to the direct draw. Pick one as canonical and propagate:

- If the cache is canonical: change §5.5's both-rooms draw to `cache.draw(...)`, update §11 and §12.7 #3, and make §12.8/§14 say "tiles are drawn solely through `drawLdtkLevel` **or `createLdtkLevelSurfaceCache`**" so the forbidden-pattern grep doesn't read as banning the cache.
- If `drawLdtkLevel` is canonical: demote [:615](games/celerock.md:615) to an explicit "optional optimization, only if you observe seams" note.

---

## 4. Entities must render their LDtk-assigned tile — the brief never says so

**Status:** new requirement, not previously covered anywhere in the brief.

### 4.1 The pack assigns real art to `Gem` and `Spike` — the brief throws it away

`Gem` and `Spike` both carry a `tileRect` on their entity **def**, and every instance carries the resolved `__tile`:

| Entity def | `tilesetId` | `tileRect` | `renderMode` | `tileRenderMode` | Art assigned? |
|---|---|---|---|---|---|
| `Gem` | 43 | `{ x:888, y:672, w:8, h:8 }` | `Tile` | `FitInside` | ✅ |
| `Spike` | 43 | `{ x:992, y:688, w:8, h:8 }` | `Tile` | `Repeat` | ✅ |
| `Player` | `null` | `null` | `Rectangle` | — | ❌ (drawn from `Player.png`, §4.4) |
| `Spring` | `null` | `null` | `Rectangle` | — | ❌ (no instances) |
| `DashRefill` | `null` | `null` | `Rectangle` | — | ❌ (no instances) |

Tileset uid `43` is `celerock.png` — the tileset already loaded into the bundle. **The art is sitting right there in the file the brief tells the agent to trust.**

What the brief currently says instead:

- [:805](games/celerock.md:805) — *"**Render** uncollected strawberries from `remaining` as pulsing diamond outlines with `drawGlow`."* → an invented procedural diamond, overriding the authored gem sprite.
- **Spikes have no render instruction at all.** §6 covers only the AABB collision check; §11's `render.ts` line says "+ entities" with no method. An agent will fall through to `drawLevelEntity`'s default — a flat red `hazard` fill.
- [:62](games/celerock.md:62) imports `drawLevelEntity` / `DEFAULT_ENTITY_PALETTE` but **no section ever tells the agent to call them.**

This directly contradicts the brief's own governing principle at [:185](games/celerock.md:185): *"The supplied tileset **is** the visual identity of the game."* Right now that rule is enforced for tile layers and silently abandoned for entities.

### 4.2 The engine already has the exact hook for "sprite if assigned, else engine default"

`drawLevelEntity` takes a per-kind draw override that returns `true` to claim the draw and falls through to the built-in shape otherwise (`src/platformer/renderer.ts:203-210`):

```ts
const override = options?.drawOverride?.[entity.kind];
if (override) {
  try { if (override(ctx, entity)) return; } catch { /* falls through */ }
}
```

So the general rule the user asked for maps onto one engine call, with the fallback being the engine's own renderer — no branching in the game's draw loop:

> **Entity art rule.** Draw every LDtk entity through `drawLevelEntity`. Supply a `drawOverride` that blits the instance's `__tile` when the LDtk assigns one; return `false` when it does not, and `DEFAULT_ENTITY_PALETTE` renders the engine's built-in shape. Authored art always wins; the engine is the fallback, never the default.

Note the override map also swallows throws and falls through — so a corrupt tile rect degrades to the engine shape instead of killing the frame. That is the right failure posture for this brief and worth stating.

### 4.3 The join key is exact and verified

`ldtkLevelToLevelData` drops `__tile` — `LevelEntity` is `{ id, kind, rect, props }` with no art field. But the translated rect is **byte-identical** to the LDtk instance rect (`src/ldtk/translate.ts:154`):

```ts
return { x: e.px[0], y: e.px[1], width: e.width, height: e.height };
```

so `rect` is a lossless join key back to the instance. Verified against the real pack — **7/7 entities resolved, zero misses:**

```
--- Level_0   tileIndex size 2
   hazard      {x:248, y:152, w:16, h: 8}  -> tile 43@992,688 8x8
   collectible {x:200, y:104, w: 8, h: 8}  -> tile 43@888,672 8x8
--- Level_4   tileIndex size 5
   hazard      {x: 32, y:168, w:40, h: 8}  -> tile 43@992,688 8x8
   hazard      {x: 88, y:152, w:40, h: 8}  -> tile 43@992,688 8x8
   hazard      {x:152, y:128, w:24, h: 8}  -> tile 43@992,688 8x8
   hazard      {x:176, y:160, w:24, h: 8}  -> tile 43@992,688 8x8
   hazard      {x:224, y:104, w: 8, h:16}  -> tile 43@992,688 8x8
```

Do **not** join by `LevelEntity.id`. Ids are assigned sequentially over *recognized* entities only — `translateLdtkEntity` returning `undefined` skips the `nextId++` (`src/ldtk/translate.ts:466-477`) — so any unrecognized entity in the layer silently shifts the mapping.

### 4.4 Spikes are resized instances — they must be TILED, not stretched

This is the part most likely to be got wrong. The `Spike` tile is **8×8**, but the instances are resized: `16×8`, `40×8`, `24×8`, `8×16`. The def says `tileRenderMode: 'Repeat'`, so a 40×8 spike is **five repeats of the 8×8 tile**, not one tile stretched 5× wide. Stretching produces a smeared 40px-wide spike — visibly wrong, and the kind of thing that passes a screenshot gate at a glance.

**Engine gap:** `LdtkEntityDef` preserves `renderMode` (`'Rectangle' | 'Ellipse' | 'Tile' | 'Cross'`) but **not `tileRenderMode`** — the parser drops it (`src/ldtk/types.ts:480-506`). So the game cannot read Repeat-vs-Fit from the parsed project and must derive it. Comparing the instance rect against the tile rect handles both cases correctly and needs no new parser field:

- instance ≤ tile on both axes → single scaled blit (covers `FitInside`, the Gem)
- instance larger on either axis → tile the source across the rect (covers `Repeat`, the Spikes)

### 4.5 Drop-in text for the brief

Add as **§7.1 Entity art (general rule)**, referenced from §6 (hazards), §7 (collectibles), and §11 (`render.ts`):

````markdown
### 7.1 Entity art — the LDtk tile is the sprite (general rule)

An LDtk entity def may assign a display tile (`tileRect` on the def, resolved to
`__tile` on each instance). **When it does, that tile IS the entity's sprite —
blit it.** When it does not, let the engine draw its built-in shape. Never invent
procedural art for an entity the LDtk already dressed.

In the shipped pack: `Gem` and `Spike` have tiles (both from `celerock.png`);
`Player` (drawn from `Player.png`, §4.4), `Spring`, and `DashRefill` do not.

`ldtkLevelToLevelData` does not carry `__tile` onto `LevelEntity`, but the
translated `rect` is exactly the instance's `px`/`width`/`height` — a lossless
join key. Index it ONCE per room (memoize alongside the `CompiledLdtkRoom`;
never rebuild per frame), then feed `drawLevelEntity`'s `drawOverride`:

```ts
type EntityTile = NonNullable<LdtkEntityInstance['__tile']>;

const rectKey = (r: { x: number; y: number; width: number; height: number }) =>
  `${r.x}|${r.y}|${r.width}|${r.height}`;

/** Rect → display tile, for every instance in the room that has one. */
function buildEntityTileIndex(level: LdtkLevel): ReadonlyMap<string, EntityTile> {
  const index = new Map<string, EntityTile>();
  for (const layer of level.layerInstances ?? []) {
    for (const e of layer.entityInstances ?? []) {
      if (!e.__tile) continue;                 // no art assigned → engine fallback
      index.set(`${e.px[0]}|${e.px[1]}|${e.width}|${e.height}`, e.__tile);
    }
  }
  return index;
}

function entityTileOverride(
  index: ReadonlyMap<string, EntityTile>,
  tilesets: LdtkTilesetBundle,
): DrawLevelEntityOverrideMap {
  const draw = (ctx: CanvasRenderingContext2D, entity: LevelEntity): boolean => {
    const tile = index.get(rectKey(entity.rect));
    if (!tile) return false;                   // ← engine's DEFAULT_ENTITY_PALETTE draws it
    const ts = tilesets.get(tile.tilesetUid);
    if (!ts) return false;
    const { x, y, width, height } = entity.rect;

    // LDtk's `tileRenderMode` is not preserved by the parser, so derive it:
    // an instance no larger than its tile is a FitInside blit; a resized
    // instance was authored as a Repeat strip and must be TILED, never
    // stretched (a 40x8 Spike is five 8x8 tiles, not one smeared tile).
    if (width <= tile.w && height <= tile.h) {
      ctx.drawImage(ts.image, tile.x, tile.y, tile.w, tile.h, x, y, width, height);
      return true;
    }
    for (let dy = 0; dy < height; dy += tile.h) {
      for (let dx = 0; dx < width; dx += tile.w) {
        const w = Math.min(tile.w, width - dx);   // clip the last partial column
        const h = Math.min(tile.h, height - dy);  // and row
        ctx.drawImage(ts.image, tile.x, tile.y, w, h, x + dx, y + dy, w, h);
      }
    }
    return true;
  };
  // Every drawn kind routes through the same rule.
  return { hazard: draw, collectible: draw, spring: draw, dashRefill: draw,
           enemy: draw, trap: draw, exit: draw, platform: draw, movingPlatform: draw };
}
```

Per frame — hazards from `room.hazards`, strawberries from `derivePickups`'s
`remaining` (already excludes collected ones):

```ts
for (const e of [...active.hazards, ...remaining]) {
  drawLevelEntity(ctx, e, { drawOverride: overrides });
}
```

**Coordinate space.** `drawLevelEntity` draws at absolute `entity.rect` and takes
NO `worldOffset` (unlike `drawLdtkLevel`). Translate the context yourself before
the loop — and during a §5.5 slide apply the same `presentation.sourceOffset` /
`destinationOffset` you pass to each room's tile draw, or the entities will
detach from the tiles mid-slide.

**`drawGlow` stays, as a halo.** Keep the pulsing glow behind the strawberry as
an additive accent — but the gem's *body* is the authored tile, not a procedural
diamond. Glow around it, never instead of it.
````

Then amend the two places that currently contradict it:

- **[:805](games/celerock.md:805)** — replace *"Render uncollected strawberries from `remaining` as pulsing diamond outlines with `drawGlow`"* with *"Render uncollected strawberries from `remaining` through `drawLevelEntity` + the §7.1 tile override (the authored `Gem` tile); `drawGlow` is an additive halo behind the tile, not the body."*
- **§6 Hazards** — add a closing line: *"Spikes RENDER through the §7.1 entity-art rule (the authored `Spike` tile, repeat-tiled across resized instances). §6 covers collision only."*

### 4.6 The forbidden-pattern rules need a carve-out or this is illegal

There is no engine helper for blitting an arbitrary tileset rect — `drawLdtkLayer` / `drawLdtkLevel` only draw tile *layers* — so the override above must call `ctx.drawImage` directly. As written, three rules read as prohibiting that:

| Where | Current wording | Problem |
|---|---|---|
| [:185](games/celerock.md:185) | "Render tiles only through `drawLdtkLevel`" | reads as banning any other tileset blit |
| [:960](games/celerock.md:960) | "No tile-art recoloring — tiles are drawn solely through `drawLdtkLevel`" | same |
| [:944](games/celerock.md:944) | "no manual tile-blit loop" | §12.7 #11 — the repeat loop is literally a manual tile-blit loop |

Amend to scope them to **level tile layers**, which is what they were always about:

> These rules govern **level tile layers**. An entity's authored display tile (`__tile`) is blitted directly via `ctx.drawImage` through the §7.1 override — that is *using* the supplied art, not overpainting it. What stays forbidden is **recoloring/tinting** tile art, and hand-rolling a replacement for `drawLdtkLevel` on the tile layers themselves.

Without this the agent faces a direct conflict between §7.1 and §12.8 and will likely resolve it by falling back to procedural entity art — the exact outcome this section exists to prevent.

### 4.7 Test + acceptance additions

**§12.1 load smoke test** — assert the art contract, so a substituted `.ldtk` that drops the tile assignments fails loudly:

- `Gem`'s and `Spike`'s entity defs both have a non-null `tileRect` with `tilesetUid` matching the `celerock.png` def; `Player` / `Spring` / `DashRefill` have `tileRect === null`.
- The §7.1 index resolves a `__tile` for **all 6 hazards and the 1 collectible** across `Level_0` + `Level_4` (7/7, zero misses).
- At least one `Spike` instance is larger than its 8×8 tile (`40×8` in `Level_4`), so the repeat path is actually exercised rather than dead.

**§12.7 acceptance** — add:

> **Entities render their authored LDtk tile.** The strawberry draws as the `Gem` tile from `celerock.png` (not a procedural diamond) and spikes draw as the `Spike` tile repeat-tiled across each resized instance (not stretched, not a flat red box). Entities whose LDtk def assigns no tile fall back to `drawLevelEntity`'s `DEFAULT_ENTITY_PALETTE` shape.

**§13 visual gate** — add: *a screenshot of `Level_4` showing the five spike rows as repeated tileset spikes at their correct 8px pitch.* This is the cheapest possible check for the stretch-vs-tile error, which is invisible in code review and obvious in a screenshot.

**§12.8 forbidden patterns** — add: *no hardcoded procedural art for an entity whose LDtk def assigns a `tileRect` (no `fillRect` gem, no polygon spike).*

### 4.8 Two engine gaps worth filing separately

> **Status: both landed in `0.16.0`** — `tileRenderMode` is parsed (all seven schema values, absent-key default `'FitInside'` pinned by tests) and `drawLdtkEntityTile` is shipped; the brief's §7.1 now routes through the helper and the §12.8 carve-out is deleted.

Neither blocks the brief — the workarounds above are complete — but both would remove consumer guesswork:

1. **`LdtkEntityDef` drops `tileRenderMode`.** The parser keeps `renderMode` and `tileRect` but not `tileRenderMode`, so every consumer must re-derive Repeat-vs-Fit from rect geometry. Parsing it is a two-line addition to `src/ldtk/parse.ts:473-503` and makes the intent authoritative instead of inferred.
2. **No `drawLdtkEntityTile` helper.** Every consumer wanting authored entity art writes the same repeat/fit blit loop, in a codebase whose stated rule is "never hand-roll a tile blit." A small `drawLdtkEntityTile(ctx, tile, rect, tilesets, mode?)` in `src/ldtk/render.ts` would close the loop and let §12.8 keep its blanket prohibition with no carve-out at all.

Also dropped by the parser: `__smartColor` on the instance (`#FF5A76` for the Gem, `#FF3A3A` for the Spike). The def's `color` **is** preserved, so accent colors for glow are reachable via `project.defs.entities` — worth noting in §7.1 if you want the halo tinted from the file rather than hardcoded.

---

## 5. Minor / robustness

| Where | Note |
|---|---|
| [:138](games/celerock.md:138) | `curl --output-dir` needs curl ≥ 7.73 and will not create a missing directory. The `npm create vite` vanilla-ts template does ship `public/`, so this only bites if the fetch is run out of order — a `mkdir -p public` is a cheap guard |
| [:464](games/celerock.md:464) | `'./celerock.ldtk'` is route-relative. Correct at `/`, breaks under a base path or a nested route. Consider `new URL('celerock.ldtk', document.baseURI)` or `${import.meta.env.BASE_URL}celerock.ldtk` |
| [:68](games/celerock.md:68) | `converge` imported, never used |
| §1 import block | §7.1 additionally needs `type LdtkEntityInstance`, `type LdtkLevel` (already present), `type LdtkTilesetBundle` (present), `type LevelEntity`, and `type DrawLevelEntityOverrideMap` — all exported from the barrel, none currently in the block (see §1.2) |

---

## 6. Structure — the document is ~200 lines longer than it needs to be

At **1148 lines / 117 KB** the brief is at the point where an agent begins skimming, and the skimmed sections are the repetitive ones — which is fine, except the non-repetitive precision in §5.5 sits right next to them.

The same ~8 rules (no legacy camera, no double jump, no hand-rolled movement, no ASCII rooms, no tile recolor, no silent dash-bonk, no momentum loss at seams, no camera pop) are restated in **eight** places:

| Section | Role | Verdict |
|---|---|---|
| §2 Discipline Rules | the rules, with rationale | **keep** — this is the canonical statement |
| §9 Feel Checklist | actionable per-feature checklist | **keep** — genuinely different content |
| §12.7 Acceptance | testable criteria | **keep** |
| §12.8 Forbidden Patterns | greppable | **keep** — make this the single "don'ts" home |
| §13 Rejection Criteria | 8 bullets | **merge into §12.8** — near-verbatim duplicate |
| §14 Anti-Failure Wording | 8 bullets, longer prose | **merge into §12.8** — same 8 rules a third time |
| §17 Preserved Constraints | 13 bullets | **cut** — restates §2 + §12.7 with no new information |
| §19 Summary of Changes | diff vs a 0.4.0 brief | **cut** — the agent has never seen the previous brief; it is changelog, not instruction |

That is roughly 200 lines out with zero information loss, and it buys back attention for §5.5 — the section where builds actually fail.

One caveat: §14's *tone* ("this is a failure", "STOP and use the engine") is doing real work. Preserve that voice when merging into §12.8 rather than flattening it into a neutral list.

---

## 7. Suggested order of work

**Pass 1 — correctness (no decisions needed):**
1. §4.4 frame-index fix (1.1) + callout
2. §1 import block (1.2) + drop `converge` + the §7.1 types from §5
3. `prevCore` declaration (1.3)
4. All six contradictions in §2

**Pass 2 — the entity-art rule (§4):**
5. Add §7.1 "Entity art — the LDtk tile is the sprite" (4.5 has drop-in text)
6. Amend [:805](games/celerock.md:805) and §6 to route through it (4.5)
7. Scope the three forbidden-pattern rules to level tile layers (4.6) — **required**, or §7.1 contradicts §12.8
8. Add the smoke-test / acceptance / visual-gate items (4.7)

**Pass 3 — needs your call:**
9. Completion state (3.1) — decide the terminal-room rule and whether a card renders
10. Surface cache vs `drawLdtkLevel` (3.2) — pick the canonical renderer
11. `groundDuckEnabled` / `stepHeight` / `climbEnabled` (2.6) — decide whether `playConfigFor` owns them

**Pass 4 — trim:**
12. Merge §13 + §14 into §12.8; cut §17 and §19; add the minor robustness notes from §5

**Separate from the brief:** the two engine gaps in 4.8 (`tileRenderMode` parsing, a `drawLdtkEntityTile` helper). Landing #2 would let Pass 2 step 7 be dropped entirely.
