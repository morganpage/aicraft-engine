# Moving Gap Platform (Traveling Absence of Floor)

> Research note for a gap (hole) that moves along an arbitrarily long platform, causing a player standing on the platform to fall through when the gap reaches them. Slug: `moving-gap-platform`.
> Investigated: 2026-06-22.

## TL;DR

The "Moving Gap Platform" (implemented as `movingVoid` in Spitekeep) is a procedural rendering and collision technique where a dynamic platform's walkable surface is split into two disjoint solid fragments around a traveling gap. Unlike standard moving hazards that kill on overlap, a moving gap kills by consequence (pit-fall) when a player's vertical support is removed. The core architectural insight is the strict separation of **motion** (where the gap wants to go) from **geometry** (what solid fragments are generated). By embedding the span clamp directly inside the geometry generator rather than the motion update code, we eliminate visual-solid desync bugs—such as the player standing on a rendered void—by construction. Prototyping should focus on: (1) a pure, self-clamping dual-fragment solid generator, (2) a functional/procedural solidity query interface to support tile-grid integration, and (3) a deterministic motion state machine supporting sweep, chase, and expand modes driven by the library's seeded `mulberry32` PRNG.

## Why this matters for aicraft-engine

This technique directly touches **Pillar 1 (Primitives & secondary dynamics)** and **Pillar 4 (Fake-3D & advanced rendering)**.
- **Dynamic Collision Primitives:** It establishes a precedent for runtime-mutated platform geometry. Rather than treating platforms as static rectangles, the engine must support platforms that dynamically carve, split, or shrink their solid boundaries.
- **The "Void Never Standable" Invariant:** In a minimalist, zero-asset game (Sokpop-style), visual clarity is paramount. If a gap is rendered, the player must fall through it. If a solid is rendered, the player must be able to stand on it. Any desync between the visual representation of a hole and its collision boundaries breaks player trust and violates the library's core game-feel standards.
- **Pit-Fall Death Mechanics:** It validates the engine's gravity-first, discrete axis-resolution pipeline (`resolveAxisY`). Because gravity is applied every tick before Y-resolution, a resting player naturally re-evaluates support and falls through the gap without requiring expensive continuous collision detection (CCD) or swept AABB checks.

---

## Prior Art Survey

### Pattern 1: Spitekeep's `movingVoid` (In-House Anchor)
- **Source**: `/src/core/traps/moving-void.ts` (Spitekeep) and GDD §6.13.
- **What it does**: Represents a traveling absence of floor. The trap owns a floor span `[trap.x, trap.x + trap.width]` at height `trap.y`. The level author carves this span out of the static `level.platforms` so the trap's `getSolids()` is the sole source of floor collision. Each tick, the handler splits this span into two solid fragments around a traveling gap.
- **Algorithmic shape**:
  ```typescript
  // Spitekeep's getSolids() implementation
  getSolids(trap: TrapEntity, runtime: TrapRuntimeEntry): Platform[] {
    const data = runtime.data as unknown as MovingVoidData;
    const gapCenterX = typeof data.gapCenterX === 'number' ? data.gapCenterX : trap.x + trap.width / 2;
    const gapWidth = typeof data.gapWidth === 'number' ? data.gapWidth : 0;
    const half = gapWidth / 2;
    const gapLeft = gapCenterX - half;
    const gapRight = gapCenterX + half;
    const spanRight = trap.x + trap.width;
    const out: Platform[] = [];
    
    if (gapLeft > trap.x) {
      out.push({
        x: trap.x,
        y: trap.y,
        width: gapLeft - trap.x,
        height: trap.height,
        type: 'solid',
      });
    }
    if (spanRight > gapRight) {
      out.push({
        x: gapRight,
        y: trap.y,
        width: spanRight - gapRight,
        height: trap.height,
        type: 'solid',
      });
    }
    return out;
  }
  ```
- **Determinism profile**: Pure mathematical calculations based on tick count and speed. 100% deterministic.
- **Runtime cost**: Extremely low. Generates at most two static-like rectangles per tick, which are fed into the standard AABB collision resolver.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. It is a pure-code collision primitive requiring no external physics engine.
- **What to steal**: The span-carving authoring trick (carving the static floor around the owned span) and the two-fragment output.
- **What to avoid**: Coupling the span clamp to the motion update modes.

### Pattern 2: Runtime Tilemap Mutation (Godot / Unity)
- **Source**: Godot `TileMap.set_cell()` and Unity `TilemapCollider2D` + `CompositeCollider2D`.
- **What it does**: Modifies a global tile grid at runtime to add or remove solid blocks as a hazard moves.
- **Algorithmic shape**:
  ```typescript
  // Godot-style cell toggling
  func update_moving_gap(gap_tile_x: int, gap_width_tiles: int):
      # Restore previous tiles
      for x in last_gap_span:
          tilemap.set_cell(0, Vector2i(x, platform_y), solid_tile_id)
      # Clear new gap tiles
      for i in range(gap_width_tiles):
          tilemap.set_cell(0, Vector2i(gap_tile_x + i, platform_y), -1)
  ```
- **Determinism profile**: Depends on the engine's internal physics server sync timing. Often non-deterministic or delayed by one frame.
- **Runtime cost**: High. Rebuilding composite colliders or updating physics grids per frame causes CPU spikes and garbage collection.
- **Dependencies**: Heavy engine-specific physics systems.
- **Fit for our constraints**: Weak. `aicraft-engine` is a zero-dependency library that avoids global mutable tilemap rebuilds for performance and determinism.
- **What to steal**: The concept of discrete grid-based cell clearing (useful if we integrate with our tile-grid collision).
- **What to avoid**: Rebuilding heavy physics meshes or composite colliders on every frame.

### Pattern 3: Procedural Solidity Query (JS13k / Demoscene)
- **Source**: JS13k platformer implementations (e.g., *Phobos*), procedural collision functions.
- **What it does**: Instead of storing and updating physical rectangle lists, the collision system queries a functional mask: `isSolid(x, y, time)`.
- **Algorithmic shape**:
  ```typescript
  function isPlatformSolid(px: number, py: number, tick: number): boolean {
    if (py < PLATFORM_Y || py > PLATFORM_Y + PLATFORM_HEIGHT) return false;
    if (px < SPAN_LEFT || px > SPAN_RIGHT) return false;
    
    // Calculate gap position procedurally
    const gapCenter = calculateGapCenter(tick);
    const halfGap = GAP_WIDTH / 2;
    
    // Solid everywhere except within the gap
    return px < gapCenter - halfGap || px > gapCenter + halfGap;
  }
  ```
- **Determinism profile**: 100% pure and deterministic.
- **Runtime cost**: Extremely low memory overhead (no arrays allocated), but requires a function call per collision check.
- **Dependencies**: None.
- **Fit for our constraints**: Strong. Aligns perfectly with our strict determinism and zero-dependency constraints.
- **What to steal**: The functional solidity query pattern, which can be adapted as a `TileSolidityQuery` in our tile-grid collision system.
- **What to avoid**: Complex mathematical functions that are expensive to evaluate many times per frame.

### Pattern 4: Swept AABB vs. Discrete Support Re-evaluation
- **Source**: Standard physics engine literature (e.g., Box2D, Sebastian Lague's 2D Controller).
- **What it does**: Evaluates whether a body falls through a moving gap by checking continuous swept volumes vs. discrete tick-by-tick state checks.
- **Algorithmic shape**:
  ```typescript
  // Discrete support check (Spitekeep / aicraft-engine)
  // Tick N: Player stands on Solid 1.
  // Tick N+1: Gap has moved under player. Gravity pulls player down.
  //           Y-resolution finds no solid → player falls.
  ```
- **Determinism profile**: 100% deterministic.
- **Runtime cost**: Low. Reuses the standard per-axis resolution pipeline.
- **Dependencies**: None.
- **Fit for our constraints**: Strong.
- **What to steal**: Applying gravity *before* resolving Y collisions. This guarantees that a resting player will always re-evaluate support and fall when the gap sweeps under them, eliminating the need for complex swept AABB calculations.
- **What to avoid**: Fast-moving gaps that exceed the player's width. If a gap moves faster than `player.width + speed`, the player can "tunnel" across the gap in a single tick without falling. The GDD-enforced `speed ≤ 3.0` and `gapWidth ≥ 64` guarantees that tunneling is physically impossible.

---

## The Motion/Geometry Separation Insight

In Spitekeep's original implementation of `movingVoid`, the span clamp was coupled to the motion update loop:

```typescript
// Spitekeep's update() clamp (lines ~313-319)
const half = data.gapWidth / 2;
const minCenter = trap.x + half;
const maxCenter = trap.x + trap.width - half;
if (data.gapCenterX < minCenter) data.gapCenterX = minCenter;
if (data.gapCenterX > maxCenter) data.gapCenterX = maxCenter;
```

### The Bug and the Lesson
In the `chase` travel mode, the gap chased the player's X coordinate. However, because the clamp was a per-motion-mode responsibility, it was easy to omit or miscalculate when adding new modes. When the player stood just outside the span (on the adjacent static platform), the gap chased left past the span edge. 

This caused a severe visual-solid desync:
1. The renderer painted the dark void fill over the static platform (making it look like a hole).
2. The static platform's collision was still active underneath because the trap's physical span ended at `trap.x`.
3. The player appeared to stand directly on top of the rendered void.

### The Engine Solution
The engine abstraction must **separate motion from geometry and put the clamp inside the geometry helper**. The motion code should calculate an *ideal* gap center (even if it goes out of bounds), and the geometry generator (`getSolids`) must enforce the physical boundaries by clamping the center before generating the fragments. 

By making the geometry generator self-clamping, we guarantee that:
- The physical collision fragments are always perfectly aligned with the clamped gap.
- The visual renderer (which queries the same clamped geometry or parameters) can never desync from the physics.
- The "void is never standable" invariant holds by construction, regardless of what motion code does.

---

## Reference Implementations

1. **Spitekeep `movingVoid` Trap**
   - *Path*: `/src/core/traps/moving-void.ts`
   - *Description*: The primary reference. Implements `sweep`, `chase`, and `expand` travel modes, the post-mortem `revealedHold` freeze, and the dual-fragment generation.
2. **Spitekeep `hiddenPit` Trap**
   - *Path*: `/src/core/traps/hidden-pit.ts`
   - *Description*: Sibling trap demonstrating multi-fragment geometry (`splitHorizontal`, `retractBothWays`) and deterministic debris velocity calculations.
3. **aicraft-engine `resolve.ts`**
   - *Path*: `src/collision/resolve.ts`
   - *Description*: The core per-axis move-and-resolve engine that handles solid snapped collisions.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Spitekeep `movingVoid` GDD §6.13 | Detailed diagram of the two-fragment split, the sweep path, and the mandatory `revealedTrail` post-mortem visuals. | `GDD.md` §6.13 |
| `moving-void-demo.ts` | The "Shelter from the Storm" level layout, showing how static platforms are carved around the trap's span `[136..824]`. | `moving-void-demo.ts` |

---

## Open Questions

1. **Should the moving gap primitive carry the player?**
   - *Context*: Sibling trap `movingPlatform` carries the player via `carryX`/`carryY` modifiers. `movingVoid` explicitly does NOT carry.
   - *Design Choice*: The moving gap primitive should remain a pure "absence of floor" and should not carry. If a player stands on a fragment, they remain stationary; when the gap reaches them, they fall.
2. **Should fragments support `passthrough` (one-way) collision?**
   - *Context*: Some level designs might benefit from a moving gap on a one-way platform.
   - *Design Choice*: Yes. The output fragments should inherit the `passthrough` flag of the parent span, making the primitive highly versatile.
3. **How should we handle tile-grid collision?**
   - *Context*: `aicraft-engine` supports both rect-list and tile-grid collision.
   - *Design Choice*: For rect-list collision, we return two `Solid` rects. For tile-grid collision, we should expose a procedural `TileSolidityQuery` wrapper that dynamically overrides tile solidity based on the clamped gap position.
4. **Should we support multiple gaps on a single platform?**
   - *Context*: Advanced level designs might feature multiple gaps sweeping along a single long platform (e.g., "Counter-Sweep" variant).
   - *Design Choice*: The core geometry helper should be designed to accept an array of gaps and return $N+1$ fragments, keeping the API future-proof.

---

## Top 3 Patterns Worth Prototyping

1. **Self-Clamping Dual-Fragment Solid Generator**
   - *Why*: This is the core geometric primitive. It takes a parent span (`x`, `y`, `width`, `height`, `passthrough`) and a gap (`centerX`, `width`), clamps the gap internally to guarantee it never extends past the span, and returns 0, 1, or 2 `Solid` fragments.
2. **Procedural Solidity Query Wrapper**
   - *Why*: Integrates the moving gap seamlessly with tile-grid collision. It wraps a standard `TileSolidityQuery` and overrides specific coordinates to `'empty'` if they fall within the moving gap, avoiding the need to modify a static tile array.
3. **Deterministic Seeded Motion Controller**
   - *Why*: A pure, tick-based state machine that updates the gap center based on travel modes (`sweep`, `chase`, `expand`) using the library's seeded `mulberry32` PRNG, ensuring 100% determinism and support for post-mortem freezes (`revealedHold`).

---

## Cross-References

- **Related notes in `docs/research/`**:
  - `docs/research/platformer-juice.md` (for screen shake, hit-stop, and post-mortem visual guidelines).
  - `docs/research/jump-walk-locomotion.md` (for player movement and gravity interaction).
- **Related strategic docs in `ai-craft-strategy/`**:
  - `ai-craft-strategy/knowledge/sokpop-minimalist-rendering-teardown.md` (for minimalist rendering and visual-solid lockstep rules).
- **Existing modules in `src/`**:
  - `src/collision/resolve.ts` (the collision resolver that consumes the generated fragments).
  - `src/rng/mulberry32.ts` (the PRNG driving the deterministic travel modes).
