# Procedural 2D Platformer Level Generation

> Research note for procedural 2D platformer level generation. Slug: `procedural-level-generation`.
> Investigated: 2026-07-28.
> Canonical implementation plan: `docs/design/level-generation-quality-implementation-plan.md`.
> This note is prior-art context, not the implementation contract.

## TL;DR

Procedural platformer level generation has a 15-year research literature and a handful of canonical industry exemplars (Spelunky, Infinite Mario Bros, Launchpad). The critical lens is **solution-preserving construction**: techniques that generate-then-test (Monte-Carlo A* agents, replay verification) can be expensive or bounded, while path-first and constraint-based techniques preserve an intended route and reject many impossible placements early. For a zero-dep, strictly deterministic, mulberry32-seeded library like `aicraft-engine`, the three patterns worth combining are: (1) a **Spelunky-style path-first chunk assembler** that defines the intended solution corridor before decoration, (2) a **Launchpad-style rhythm-group grammar** that decouples "what the player does" from "what the geometry looks like," and (3) a **physics-constrained constructive assembler** that derives conservative placement bounds from the platformer kernel. Construction reduces invalid output; kernel-aligned trajectory checks and winning replays remain necessary before claiming beatability.

## Why this matters for aicraft-engine

- **Pillars Touched**: This is the natural next step after **Pillar 2 (Level Schema)** and **Pillar 4 (Platformer Kernel)**. A procedural generator emits `LevelData` (already shipped) and is consumed by `compileLevel` (already shipped). It also feeds the existing **Replay** cross-cutting pillar — a deterministic generator + deterministic kernel + deterministic replay hash = shareable "daily seed" levels.
- **Unlocks**:
  - **Daily-seed / shareable levels**: A `seed: number` parameter produces a deterministic `LevelData`. The same seed always produces the same level. Combined with the existing `replayHash` fingerprint, this gives "share this level + this run" links.
  - **Difficulty scaling**: A `difficulty: number` parameter (0..1) drives gap widths, hazard density, and rhythm complexity — the same generator emits a tutorial level at 0.0 and a brutal level at 1.0.
  - **Editor + generator round-trip**: A generator could emit `EditorOperation[]` (already shipped in `src/editor/operations.ts`) instead of raw `LevelData`, so the editor's undo/redo and history stack work on generated levels for free.
  - **Clear-check by construction**: Because the generator guarantees solvability, the level is "clear-checked" the moment it is produced — no separate replay-verification pass required.

---

## Prior Art Survey

### Pattern 1: Spelunky Path-First Chunk Assembly

- **Source**: Derek Yu's *Spelunky* (2008, 2012 remake) — reverse-engineered by Darius Kazemi ([tinysubversions.com/2009/09/spelunkys-procedural-space/](http://tinysubversions.com/2009/09/spelunkys-procedural-space/), [tinysubversions.com/spelunkyGen2/](http://tinysubversions.com/spelunkyGen2/)); Derek Yu's own writeup at [makegames.tumblr.com/post/4061040007/the-full-spelunky-on-spelunky](https://makegames.tumblr.com/post/4061040007/the-full-spelunky-on-spelunky).
- **What it does**: Each level is a 4×4 grid of 16 rooms, each 10×8 tiles. Generation is three phases:
  1. **Path-first**: A guaranteed-solution path is drawn from the entrance (top) to the exit (bottom). The path is a sequence of room "exits" — each room on the path is tagged with which exits it must have (left/right/up/down).
  2. **Template fill**: For each room on the path, a hand-authored template is chosen from a pool of ~50 templates per area, filtered by the required exit configuration. Off-path rooms are filled with "side" templates.
  3. **Decoration**: Probabilistic tiles ("33% chance of spike here") and obstacle blocks (5×3 chunks chosen from 16 variants) are overlaid. Traps, enemies, and treasures are placed by separate 100%-procedural passes.
- **Algorithmic shape**:
  ```typescript
  // Phase 1: path-first
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const path = choosePathSegment(rng, x, y, prevPath);
      rooms[y][x].pathType = path; // 'main' | 'side' | 'dead-end'
    }
  }
  // Phase 2: template fill
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const required = computeRequiredExits(rooms[y][x].pathType);
      const candidates = templates.filter(t => t.exits ⊇ required);
      rooms[y][x].template = pick(rng, candidates);
    }
  }
  // Phase 3: decoration
  for (const room of rooms.flat()) {
    overlayProbabilisticTiles(room, rng);
    overlayObstacleBlocks(room, rng);
  }
  ```
- **Determinism profile**: Pure. All randomness flows through the seeded RNG. The path-first phase guarantees solvability — every level has at least one route from entrance to exit by construction.
- **Runtime cost**: Very low. ~50 templates × 16 rooms = a few hundred string copies per level. Generation is sub-millisecond.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** Our `TileGrid` is row-major ints; our `LevelEntity` discriminated union already supports `platform`/`passthrough`/`movingPlatform`/`trap`/`hazard`/`collectible` — all the primitive types Spelunky needs. The "rooms" become "chunks" of width-N tiles, and the path becomes a guaranteed-solution corridor along the bottom of the level.
- **What to steal**: The **path-first guarantee**. The single most important idea in the entire literature. By laying down the solution before the decoration, solvability is a structural property of the generation algorithm, not a probabilistic post-hoc check.
- **What to avoid**: Spelunky's 80-character string templates are an artifact of GameMaker's string-as-asset model. We should use `TileGrid` slices or `LevelEntity[]` chunks, not strings.

### Pattern 2: Launchpad Rhythm-Group Grammar

- **Source**: Gillian Smith, Jim Whitehead, Michael Mateas, Mike Treanor, Jameka March, Mee Cha. "Launchpad: A Rhythm-Based Level Generator for 2-D Platformers." *IEEE Trans. Comput. Intellig. and AI in Games*, 3(1):1–16, 2011. PDF: [users.soe.ucsc.edu/~ejw/papers/Smith-Launchpad-TCIAIG-2011.pdf](https://users.soe.ucsc.edu/~ejw/papers/Smith-Launchpad-TCIAIG-2011.pdf). Companion dissertation: [users.soe.ucsc.edu/~ejw/dissertations/Gillian-Smith-dissertation.pdf](https://users.soe.ucsc.edu/~ejw/dissertations/Gillian-Smith-dissertation.pdf).
- **What it does**: Two-tier grammar. Tier 1 generates a **rhythm** — a sequence of player actions (move, jump, wait) with timing. Tier 2 uses a grammar to **interpret** the rhythm as geometry: a "jump" beat can become a gap, a spike, an enemy, or a moving platform; a "wait" beat can become a flat platform or a moving platform. Many rhythm groups are generated, joined with small "rest" platforms, and the best one is selected by a set of critics (gap-frequency, rhythm-density, line-distance). A global pass adds coins and ties platforms to a common ground line.
- **Algorithmic shape**:
  ```typescript
  // Tier 1: rhythm
  function generateRhythm(rng, config): Rhythm {
    const beats: Beat[] = [];
    for (let i = 0; i < config.rhythmLength; i++) {
      beats.push(pick(rng, ['move', 'jump', 'wait']));
    }
    return { beats, density: config.density };
  }
  // Tier 2: geometry
  function realizeRhythm(rng, rhythm, physics): Geometry {
    const platforms: Platform[] = [];
    let cursor = { x: 0, y: 0 };
    for (const beat of rhythm.beats) {
      if (beat === 'jump') {
        const jumpType = pick(rng, ['gap', 'spike', 'enemy', 'platform']);
        platforms.push(buildJump(cursor, jumpType, physics));
        cursor = advancePastJump(cursor, physics);
      } else if (beat === 'wait') {
        platforms.push(buildFlat(cursor, rng.nextInt(2, 5)));
        cursor.x += platforms[platforms.length - 1].width;
      }
      // ... 'move' advances cursor without placing
    }
    return { platforms };
  }
  ```
- **Determinism profile**: Pure. All randomness flows through the seeded RNG. The grammar is deterministic given a rhythm. Critics are deterministic functions of the geometry.
- **Runtime cost**: Fast. Rhythm generation is O(rhythmLength); geometry realization is O(rhythmLength × grammarBranching); critics are O(geometrySize). Total: a few hundred microseconds per level.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** Rhythm groups map cleanly to `LevelEntity[]` chunks. The "jump" beat can be realized as a `platform` entity (the landing platform) plus a `hazard` entity (the gap/spike/enemy) plus optional `collectible` entities (coins). The "rest" beat is a flat `platform` entity. The "wait" beat is a flat `platform` entity with no decoration.
- **What to steal**: The **two-tier separation** (rhythm first, geometry second). This is the most elegant idea in the literature — it lets the same rhythm produce many varied levels, and lets designers tune rhythm parameters (jump frequency, density, length) without touching geometry.
- **What to avoid**: Launchpad's critics are domain-specific (gap-frequency, line-distance) and require a "ground line" concept that doesn't map cleanly to our `TileGrid` model. We should use simpler critics — e.g., "max gap width ≤ max-jump-distance" and "hazard density ≤ target."

### Pattern 3: Physics-Constrained Constructive Assembler

- **Source**: Synthesized from error454's *Platformer Physics 101* ([error454.com/2013/10/23/platformer-physics-101-and-the-3-fundamental-equations-of-platformers/](https://error454.com/2013/10/23/platformer-physics-101-and-the-3-fundamental-equations-of-platformers/)) and the Celeste-style jump-arc math already in `src/animation/jump.ts`. Used implicitly by every solver-based generator (Driftlings, Sturgeon-MKIII, Cooper & Sarkar's repair agent) and explicitly by the launchpad rhythm-grammar's "physics constraints" step.
- **What it does**: Derives the **maximum traversable gap width**, **maximum step-up height**, and **maximum step-down height** directly from the platformer kernel's physics constants. The generator never places a gap wider than `maxJumpDistance`, never places a step-up taller than `apexHeight`, and never places a step-down deeper than `maxFallSpeed × timeToApex`. Solvability is a **structural invariant** of the placement rules — no agent needed.
- **Algorithmic shape** (for our library's specific physics):
  ```typescript
  // From src/animation/jump.ts: apexHeight=48, timeToApex=0.28
  // From src/platformer/constants.ts: moveSpeed=200, airControl=0.65
  const launchVelocity = -(2 * 48) / 0.28; // ≈ -342.86 px/s
  const gravity = (2 * 48) / (0.28 * 0.28); // ≈ 1224.49 px/s²
  // Max horizontal distance per flat-ground jump (no air control):
  const maxJumpDistance = 200 * (2 * 0.28); // = 112 px = 7 tiles (at 16px)
  // With air control 0.65, the player can adjust trajectory mid-air,
  // so the effective max gap is slightly larger (~130 px ≈ 8 tiles).
  // Max step-up height = apexHeight = 48 px = 3 tiles.
  // Max step-down height = maxFallSpeed × timeToApex = 600 × 0.56 = 336 px.
  function placeGap(rng, difficulty): Gap {
    const minGap = 2 * tileSize; // 32 px (2 tiles) — trivially traversable
    const maxGap = Math.floor(maxJumpDistance * (1 - difficulty * 0.3));
    return { width: nextInt(rng, minGap, maxGap) };
  }
  function placeStepUp(rng): StepUp {
    return { height: nextInt(rng, 1, 3) * tileSize }; // 1–3 tiles, ≤ apexHeight
  }
  ```
- **Determinism profile**: Pure. The physics constants are baked in at compile time; the RNG is seeded; the placement rules are deterministic functions of `(rng, difficulty)`.
- **Runtime cost**: Negligible. O(1) per placement decision.
- **Dependencies**: None. The physics math is already in `src/animation/jump.ts`.
- **Fit for our constraints**: **Strong.** This is a cheap constructive filter — it costs a few arithmetic operations per placement and rejects many impossible placements before verification. It composes with both Spelunky-style chunk assembly (constrain chunk templates to physics-bounded dimensions) and Launchpad-style rhythm groups (constrain the "jump" beat's gap width conservatively), but scalar bounds alone are not a proof of a joint fixed-step trajectory.
- **What to steal**: The **direct derivation of placement constraints from kernel physics**. This is the single most important idea for our library specifically — our kernel's physics are already exposed as constants (`DEFAULT_PLATFORMER_CONFIG`, `DEFAULT_JUMP`), and the jump-arc math is already implemented. A generator that reads these constants and constrains its placements accordingly is automatically correct for our kernel.
- **What to avoid**: Don't try to simulate the kernel at generation time. The math is closed-form (parabolic trajectory), so we can derive the max gap analytically. Simulating the kernel would be O(N) per placement and would require running the deterministic simulation, which is overkill for a placement constraint.

### Pattern 4: Binary Space Partitioning (BSP) for Side-Scrolling Levels

- **Source**: RogueBasin's *Basic BSP Dungeon generation* ([roguebasin.com/index.php/Basic_BSP_Dungeon_generation](https://www.roguebasin.com/index.php/Basic_BSP_Dungeon_generation)); Ondřej Nepožitek's *Edgar-DotNet* ([github.com/OndrejNepozitek/Edgar-DotNet](https://github.com/OndrejNepozitek/Edgar-DotNet)) — a graph-based platformer generator that adapts BSP for side-scrollers; Steven's *Procedural Dungeon Generation in Godot 4* ([slashskill.com/procedural-dungeon-generation-in-godot-4-bsp-trees-rooms-and-corridors/](https://www.slashskill.com/procedural-dungeon-generation-in-godot-4-bsp-trees-rooms-and-corridors/)).
- **What it does**: Recursively subdivides a rectangle into smaller rectangles (the BSP tree). Places a room in each leaf node. Walks back up the tree, connecting sibling rooms with corridors. **Connectivity is guaranteed by construction** — the tree structure ensures every room is reachable from every other room.
- **Algorithmic shape**:
  ```typescript
  interface BSPNode {
    rect: Rect;
    left: BSPNode | null;
    right: BSPNode | null;
    room: Rect | null; // assigned at leaf
  }
  function buildBSP(rng, rect, minSize, depth): BSPNode {
    if (depth === 0 || rect.width < minSize * 2 || rect.height < minSize * 2) {
      return { rect, left: null, right: null, room: null };
    }
    const splitVertical = rng() < 0.5 && rect.width >= minSize * 2;
    const split = splitVertical
      ? { x: rect.x + nextInt(rng, minSize, rect.width - minSize), horizontal: false }
      : { y: rect.y + nextInt(rng, minSize, rect.height - minSize), horizontal: true };
    return { rect, left: buildBSP(rng, splitLeft(rect, split), minSize, depth - 1),
                    right: buildBSP(rng, splitRight(rect, split), minSize, depth - 1),
                    room: null };
  }
  function connectSiblings(rng, node): void {
    if (!node.left || !node.right) return;
    connectSiblings(rng, node.left);
    connectSiblings(rng, node.right);
    const a = node.left.room ?? node.left.rect;
    const b = node.right.room ?? node.right.rect;
    carveCorridor(rng, a, b); // L-shaped or straight
  }
  ```
- **Determinism profile**: Pure. All randomness flows through the seeded RNG. Connectivity is a structural property of the tree.
- **Runtime cost**: Low. O(N log N) for N rooms (tree build) + O(N²) for corridor placement (pairwise room matching). For a platformer level with ~16 rooms, this is sub-millisecond.
- **Dependencies**: None.
- **Fit for our constraints**: **Medium.** BSP is designed for top-down dungeons with rooms and corridors. For a side-scrolling platformer, the "rooms" become horizontal "platform clusters" and the "corridors" become traversable gaps. The connectivity guarantee is valuable, but the rectangular-room model doesn't map cleanly to our `TileGrid` model — we'd need to convert BSP rectangles into tile-grid regions, which is extra work.
- **What to steal**: The **connectivity-by-construction guarantee**. The BSP tree structure ensures every region is reachable from every other region. This is the same guarantee as Spelunky's path-first phase, achieved by a different mechanism.
- **What to avoid**: BSP's rectangular-room model. For a side-scrolling platformer, the natural unit is a horizontal "chunk" of width-N tiles, not a rectangle. A chunk-based assembler (Spelunky-style) is a better fit than BSP for our schema.

### Pattern 5: Wave Function Collapse (WFC) with Reachability Constraints

- **Source**: Maxim Gumin's *WaveFunctionCollapse* ([github.com/mxgmn/wavefunctioncollapse](https://github.com/mxgmn/wavefunctioncollapse/)); Vivian Lee, Nathan Partlan, Seth Cooper. "Precomputing Player Movement in Platformers for Level Generation with Reachability Constraints." ([ceur-ws.org/Vol-2862/paper13.pdf](https://ceur-ws.org/Vol-2862/paper13.pdf)); aczw's *CelesteWFC* ([github.com/aczw/CelesteWFC](https://github.com/aczw/CelesteWFC)); thekhaosgame's *Cavern Collapse* ([thekhaosgame.github.io/caverncollapse](https://thekhaosgame.github.io/caverncollapse)).
- **What it does**: Each tile cell starts with a **superposition** of all possible tile types. At each step, the cell with the **lowest entropy** (fewest remaining possibilities) is **collapsed** to a single tile (chosen by weighted random). The collapse **propagates** constraints to neighboring cells (removing tile types that are no longer compatible). Reachability constraints (Lee et al. 2020) add: "the start state must reach the goal state" as a hard constraint on the constraint solver.
- **Algorithmic shape**:
  ```typescript
  function wfcGenerate(rng, grid, tileSet, adjacencyRules): Grid {
    // Initialize all cells with full superposition
    for (const cell of grid) cell.superposition = new Set(tileSet.allTypes);
    // Seed: collapse the spawn cell to 'air' and the exit cell to 'air'
    collapseCell(spawnCell, 'air');
    collapseCell(exitCell, 'air');
    // Main loop
    while (anyUncollapsed(grid)) {
      const cell = findLowestEntropyCell(grid);
      const tile = weightedPick(rng, cell.superposition, tileSet.weights);
      collapseCell(cell, tile);
      propagate(cell, adjacencyRules);
    }
    return grid;
  }
  ```
- **Determinism profile**: Pure if the tile weights and adjacency rules are deterministic (they are). The constraint propagation is deterministic. The weighted pick uses the seeded RNG.
- **Runtime cost**: Medium-high. WFC can take seconds for large grids with complex rules. For a 60×40 grid with ~10 tile types, expect ~100ms.
- **Dependencies**: None for the algorithm itself. But the constraint solver (Answer Set Programming, used by Lee et al.) requires a separate solver — **dependency risk**.
- **Fit for our constraints**: **Weak.** WFC is designed for **top-down** tile-based games (terrain, caves, towns). For a **side-scrolling platformer**, the relevant constraint is "traversability from left to right," not "local tile adjacency." WFC's local-adjacency model doesn't capture the physics constraints that determine traversability (jump distance, step height). Lee et al.'s reachability extension adds this but requires an external ASP solver — a dependency we can't accept.
- **What to steal**: The **lowest-entropy-first collapse order** is a useful general technique for any constraint-propagation generator. But for our library, the simpler physics-constrained constructive assembler (Pattern 3) achieves the same goal with less complexity.
- **What to avoid**: WFC's tile-adjacency model. It's the wrong abstraction for a platformer — the relevant constraint is physics-based traversability, not visual tile compatibility.

### Pattern 6: Occupancy-Regulated Extension (ORE)

- **Source**: Peter Mawhorter, Michael Mateas. "Procedural Level Generation Using Occupancy-Regulated Extension." ([cs.hmc.edu/~pmawhorter/research/papers/procedural_level_generation_using_occupancy_regulated_extension-Mawhorter_Mateas-2010.pdf](https://www.cs.hmc.edu/~pmawhorter/research/papers/procedural_level_generation_using_occupancy_regulated_extension-Mawhorter_Mateas-2010.pdf)).
- **What it does**: Levels are assembled from a library of **hand-authored chunks** (e.g., 42 chunks for Mario). Each chunk is annotated with **anchors** — potential player positions. Generation iterates: (1) select an existing anchor, (2) pick a chunk from the library that is compatible with that anchor's context, (3) integrate the chunk. The result is a level built from human-designed pieces, with the algorithm choosing the order and placement.
- **Algorithmic shape**:
  ```typescript
  interface Chunk {
    tiles: TileGrid;
    entities: LevelEntity[];
    anchors: { x: number; y: number }[]; // potential player positions
    compatibleContexts: string[]; // e.g., 'above-ground', 'after-gap'
  }
  function oreGenerate(rng, chunks, seedChunk): LevelData {
    const partial = clone(seedChunk);
    const openAnchors = [...seedChunk.anchors];
    while (openAnchors.length > 0) {
      const anchor = pick(rng, openAnchors);
      const context = inferContext(partial, anchor);
      const candidates = chunks.filter(c => c.compatibleContexts.includes(context));
      const chunk = pick(rng, candidates);
      integrate(partial, chunk, anchor);
      openAnchors.push(...chunk.anchors.map(a => translate(a, anchor)));
      openAnchors = openAnchors.filter(a => a !== anchor);
    }
    return partial;
  }
  ```
- **Determinism profile**: Pure. All randomness flows through the seeded RNG. Chunk selection is deterministic given the context.
- **Runtime cost**: Low. O(anchors × chunks) per level. For ~100 anchors and ~50 chunks, this is sub-millisecond.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** ORE's chunks map cleanly to `LevelEntity[]` slices (a chunk is a small set of `platform`/`hazard`/`collectible` entities with a known anchor position). The anchor-based assembly is exactly the kind of thing that could emit `EditorOperation[]` instead of raw `LevelData` — each chunk integration is a batch of `addEntity` ops.
- **What to steal**: The **anchor-based assembly** model. It separates the "what" (chunk library) from the "where" (anchor selection), which is a clean separation that maps well to our editor's operation-based model.
- **What to avoid**: ORE does **not** guarantee playability — Mawhorter & Mateas explicitly note this as a weakness. We should combine ORE's chunk-assembly with Pattern 3's physics constraints to guarantee playability.

### Pattern 7: Digger Agents (Constructive Carving)

- **Source**: Antonios Liapis. "Constructive Generation Methods for Dungeons and Levels." ([antoniosliapis.com/articles/pcgbook_dungeons.php](https://antoniosliapis.com/articles/pcgbook_dungeons.php)); sentientdesigns/constructive ([github.com/sentientdesigns/constructive](https://github.com/sentientdesigns/constructive)).
- **What it does**: An **agent** walks around an initially-solid grid, carving out corridors and rooms. The simplest version (random digger) moves randomly from the center, carving a path. The corridor digger biases toward continuing in the same direction for a configurable number of steps. The room digger adds rectangular rooms at intervals.
- **Algorithmic shape**:
  ```typescript
  function diggerGenerate(rng, grid, config): Grid {
    const agent = { x: grid.width / 2, y: grid.height / 2, dir: pick(rng, [N, S, E, W]) };
    let stepsSinceTurn = 0;
    while (countCarved(grid) < config.targetCarved) {
      carve(grid, agent);
      if (rng() < config.changeDirProb || stepsSinceTurn > config.maxStepsInDir) {
        agent.dir = pick(rng, perpendicular(agent.dir));
        stepsSinceTurn = 0;
      } else {
        stepsSinceTurn++;
      }
      move(agent);
    }
    return grid;
  }
  ```
- **Determinism profile**: Pure. All randomness flows through the seeded RNG.
- **Runtime cost**: Very low. O(targetCarved) per level.
- **Dependencies**: None.
- **Fit for our constraints**: **Weak.** Digger agents are designed for **top-down dungeons** (carve corridors through solid rock). For a **side-scrolling platformer**, the natural geometry is **horizontal platforms with gaps**, not carved tunnels. A digger agent would produce cave-like levels, not platformer levels.
- **What to steal**: The **simplicity**. A digger agent is the simplest possible constructive generator — ~20 lines of code. If we wanted a "minimum viable" generator for our library, a digger-variation could produce cave-like platformer levels (think *Spelunky*'s Mines area).
- **What to avoid**: The top-down dungeon model. For a side-scrolling platformer, the natural unit is a horizontal platform, not a carved corridor.

### Pattern 8: Driftlings Backwards-from-Solution Generation

- **Source**: emmettl/driftlings ([github.com/emmettl/driftlings](https://github.com/emmettl/driftlings)) — a Lemmings-like game where levels are generated **backwards from a solution** using a **solver** that proves solvability.
- **What it does**: The generator picks a **route** through the level (a sequence of player actions). It then **places obstacles** along the route that require exactly those actions to bypass. The solver verifies that the route is the minimum-skill route through the level. Levels are guaranteed solvable by construction — the solver is used as a **design instrument**, not as a post-hoc verifier.
- **Algorithmic shape**:
  ```typescript
  function backwardsGenerate(rng, solver, config): LevelData {
    // 1. Pick a route (sequence of player actions)
    const route = pickRoute(rng, config);
    // 2. Place obstacles that require exactly this route
    const level = emptyLevel(config);
    for (const action of route) {
      placeObstacleFor(level, action, rng);
    }
    // 3. Verify with the solver
    const solved = solver.solve(level);
    if (!solved) return null; // retry
    return level;
  }
  ```
- **Determinism profile**: Pure. The solver is deterministic. The route selection uses the seeded RNG.
- **Runtime cost**: High. The solver is a uniform-cost search over `(position, facing, activity, traits, terrain, skills)` — O(states) per solve. For a small level (~100 tiles), the solve is ~20ms. For a large level with a big inventory, it can be ~30ms.
- **Dependencies**: None for the algorithm itself. But the solver is a significant code investment — a full A*-style search with terrain-aware state hashing.
- **Fit for our constraints**: **Weak.** Our library's platformer kernel is much simpler than Driftlings' Lemmings-like simulation (no terrain modification, no skill inventory, no crowd management). A full solver is overkill for our use case. The physics-constrained constructive assembler (Pattern 3) achieves the same solvability guarantee with much less code.
- **What to steal**: The **design-instrument mindset** — using the solver not just to verify but to **measure design quality** (forcedness, first-decision-at, critical-skills). For our library, this could translate to: "use the kernel itself as a design instrument — measure how many distinct routes exist, how early the first jump is required, etc."
- **What to avoid**: The full solver. Our kernel is simple enough that closed-form physics constraints (Pattern 3) suffice.

### Pattern 9: Sokpop Catalog — Hand-Crafted Minimalism

- **What it does**: Sokpop games are **hand-crafted, not procedurally generated**. Each game is a small, tight, carefully-designed experience. Levels are short, the mechanics are few, and the difficulty curve is hand-tuned. The Sokpop philosophy is "small games, made often, by hand."
- **Algorithmic shape**: N/A — Sokpop doesn't use procgen. But the **design philosophy** is directly applicable to our generator's output: levels should be **small** (16–60 tiles wide), **tight** (every tile matters), and **hand-tuned-feeling** (even though they're procedurally generated).
- **Determinism profile**: N/A.
- **Runtime cost**: N/A.
- **Dependencies**: N/A.
- **Fit for our constraints**: **Strong (as a design target, not as an algorithm).** Our generator should produce levels that **feel** like Sokpop levels — short, tight, hand-crafted — even though they're procedurally generated. This means: small level dimensions (16–60 tiles wide, 10–15 tiles tall), few entity types per level (3–6), and a narrow difficulty band (the generator's `difficulty` parameter should produce levels that feel hand-tuned at every value, not just at the default).
- **What to steal**: The **design philosophy**. Short levels. Few mechanics per level. Hand-tuned feel. The generator should produce levels that a player can complete in 30–90 seconds, not 5-minute marathon levels.
- **What to avoid**: Sokpop's **lack of procgen**. We need procgen for a fast release cadence; Sokpop is a design inspiration, not a procedural technique.

### Pattern 10: Difficulty Parameterization via Gap Width and Hazard Density

- **Source**: Noor Shaker, Georgios N. Yannakakis, Julian Togelius. "Towards Automatic Personalized Content Generation for Platform Games." ([doi.org/10.1609/aiide.v6i1.12399](https://doi.org/10.1609/aiide.v6i1.12399)); Cal Poly MIMEVA thesis ([digitalcommons.calpoly.edu/cgi/viewcontent.cgi?article=4784&context=theses](https://digitalcommons.calpoly.edu/cgi/viewcontent.cgi?article=4784&context=theses)); Biemer & Cooper's MDP-based difficulty adjustment ([doi.org/10.1609/aiide.v19i1.27540](https://doi.org/10.1609/aiide.v19i1.27540)).
- **What it does**: Difficulty is parameterized by a small set of **controllable features** that the generator can tune. For platformers, the dominant features are:
  - **Number of gaps** (Shaker et al.: range [4, 10])
  - **Average gap width** (Shaker et al.: range [10, 30] tiles)
  - **Gap placement entropy** (Shaker et al.: 0 or 1 — gaps clustered or spread)
  - **Direction switches** (Shaker et al.: 0 or 1 — left-to-right or bidirectional)
  - **Hazard density** (MIMEVA: spikes per platform, enemies per level)
  - **Platform spacing** (MIMEVA: distance between platforms)
- **Algorithmic shape**:
  ```typescript
  interface DifficultyParams {
    gapCount: number;        // [4, 10]
    avgGapWidth: number;     // [10, 30] tiles
    gapPlacementEntropy: number; // [0, 1]
    directionSwitches: boolean;
    hazardDensity: number;   // [0, 1]
    platformSpacing: number; // [2, 6] tiles
  }
  function difficultyToParams(difficulty: number): DifficultyParams {
    // difficulty in [0, 1]; map to feature ranges
    return {
      gapCount: Math.floor(4 + difficulty * 6),
      avgGapWidth: Math.floor(10 + difficulty * 20),
      gapPlacementEntropy: difficulty,
      directionSwitches: difficulty > 0.5,
      hazardDensity: difficulty * 0.5,
      platformSpacing: Math.floor(2 + difficulty * 4),
    };
  }
  ```
- **Determinism profile**: Pure. The mapping from `difficulty` to `DifficultyParams` is a pure function. The generator uses these params to constrain its placements.
- **Runtime cost**: Negligible.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong.** A single `difficulty: number` parameter (0..1) maps to a `DifficultyParams` object that the generator uses to constrain its placements. This is the simplest possible difficulty interface and matches the Sokpop philosophy of "one knob, hand-tuned feel."
- **What to steal**: The **gap-width-as-primary-knob** insight. Shaker et al.'s user study found that gap width is the single most important difficulty feature for platformers. Our generator should make gap width the primary difficulty knob, with hazard density as a secondary knob.
- **What to avoid**: Shaker et al.'s **ML-based personalization**. We don't need to train a neural network on player data — a simple linear mapping from `difficulty` to `DifficultyParams` is sufficient for a library that ships to multiple games.

---

## Reference Implementations

- **Spelunky Generator Lessons** ([tinysubversions.com/spelunkyGen2/](http://tinysubversions.com/spelunkyGen2/)): A browser-based Spelunky level generator that visualizes the path-first phase, template fill, and obstacle overlay. Teaches the three-phase generation pipeline by example.
- **Launchpad** ([users.soe.ucsc.edu/~ejw/papers/Smith-Launchpad-TCIAIG-2011.pdf](https://users.soe.ucsc.edu/~ejw/papers/Smith-Launchpad-TCIAIG-2011.pdf)): The canonical rhythm-group grammar paper. Teaches the two-tier separation (rhythm first, geometry second) and the critic-based selection.
- **sgalban/platformer-gen-2D** ([github.com/sgalban/platformer-gen-2D](https://github.com/sgalban/platformer-gen-2D)): A TypeScript implementation of Launchpad's rhythm-group generator for a Mario-style platformer. **Most directly relevant to our library** — same language, same genre, same constraints. The README has a detailed account of how the rhythm → geometry pipeline was implemented.
- **emmettl/driftlings** ([github.com/emmettl/driftlings](https://github.com/emmettl/driftlings)): A TypeScript Lemmings-like game with backwards-from-solution generation. Teaches the solver-as-design-instrument mindset and the "generate-and-verify" loop.
- **Edgar-DotNet** ([github.com/OndrejNepozitek/Edgar-DotNet](https://github.com/OndrejNepozitek/Edgar-DotNet)): A .NET graph-based platformer generator. Teaches the graph-based approach (level structure as a graph, room templates as nodes) and the configuration-space layout algorithm.
- **mxgmn/WaveFunctionCollapse** ([github.com/mxgmn/wavefunctioncollapse](https://github.com/mxgmn/wavefunctioncollapse/)): The canonical WFC implementation. Teaches the lowest-entropy-first collapse order and the constraint propagation algorithm.
- **Constructive Generation Methods** ([antoniosliapis.com/articles/pcgbook_dungeons.php](https://antoniosliapis.com/articles/pcgbook_dungeons.php)): A textbook chapter covering BSP, digger agents, cellular automata, generative grammars, and multi-pass generators. Teaches the constructive-generation taxonomy.

---

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Spelunky path-first room grid | 4×4 grid with a guaranteed-solution path from entrance (top) to exit (bottom) | [tinysubversions.com/spelunkys-procedural-space/](http://tinysubversions.com/2009/09/spelunkys-procedural-space/) |
| Launchpad rhythm-group example | A rhythm (top) and four different geometric interpretations (bottom) | [users.soe.ucsc.edu/~ejw/papers/Smith-Launchpad-TCIAIG-2011.pdf](https://users.soe.ucsc.edu/~ejw/papers/Smith-Launchpad-TCIAIG-2011.pdf) (Figure 6) |
| Compton & Mateas cell structures | Branch, parallel, and loop cell structures for non-linear levels | [users.soe.ucsc.edu/~michaelm/publications/compton-aiide2006.pdf](https://users.soe.ucsc.edu/~michaelm/publications/compton-aiide2006.pdf) (Figure 2) |
| WFC simple tiled model | A 2D grid collapsed from a superposition of tile types | [github.com/mxgmn/wavefunctioncollapse](https://github.com/mxgmn/wavefunctioncollapse/) |
| Sokpop Pyramida | Hand-crafted village-builder level layout (small, tight, hand-tuned) | [sokpop.itch.io/pyramida](https://sokpop.itch.io/pyramida) |
| Driftlings solver-as-design-instrument | A level generated backwards from a solution, with solver-derived metrics | [github.com/emmettl/driftlings](https://github.com/emmettl/driftlings) |

---

## Open Questions

- **Should the generator emit `LevelData` or `EditorOperation[]`?**
  - *Draft Answer*: Emit `EditorOperation[]` by default, with a convenience wrapper that applies them to an empty `LevelData` to produce a final `LevelData`. This gives the editor's undo/redo and history stack for free, and lets the consumer inspect the generation process step-by-step. The wrapper would call `applyBatch` from `src/editor/operations.ts`.
- **How to handle the `TileGrid` vs. `LevelEntity` split?**
  - *Draft Answer*: The generator should emit **both** — `TileGrid` for the static ground/floor tiles (the "terrain") and `LevelEntity[]` for the dynamic elements (hazards, collectibles, moving platforms). This matches Spelunky's separation of "room layout" (tiles) from "obstacles" (entities). The `compileLevel` function already handles both.
- **How to parameterize difficulty without an ML model?**
  - *Draft Answer*: A single `difficulty: number` in [0, 1] maps to a `DifficultyParams` object (gap count, avg gap width, hazard density, platform spacing). This is the Shaker et al. approach without the personalization layer. For games that want personalization, the consumer can wrap the generator with their own ML model that maps player data to a `difficulty` value.
- **How to guarantee solvability for levels with moving platforms?**
  - *Draft Answer*: Moving platforms are the hardest case — the player's route depends on the platform's motion. The physics-constrained assembler (Pattern 3) can constrain the platform's path to ensure the player can always reach the next platform. Specifically: the platform's cycle period must be ≤ the player's maximum jump time (2 × timeToApex = 0.56s), and the platform's path must include at least one position within `maxJumpDistance` of the previous and next static platforms.
- **How to handle the "rest area" between rhythm groups?**
  - *Draft Answer*: A rest area is a flat `platform` entity of width ≥ 3 tiles with no hazards. Launchpad uses rest areas as "safe zones" between rhythm groups; we should do the same. The rest area is the only place where the player can pause without being in danger.

---

## Top 3 Patterns Worth Prototyping

1. **Spelunky-Style Path-First Chunk Assembler** — Lay down a guaranteed-solution corridor on the tile grid (a sequence of `platform` entities forming a continuous walkable path from spawn to exit), then decorate it with hand-authored chunk templates (gap-spike-gap, platform-collectible-platform, etc.) chosen from a library. Solvability is a structural invariant of the path-first phase — no agent needed. This is the simplest pattern to implement (~200 lines) and the most directly applicable to our `TileGrid` + `LevelEntity` schema.

2. **Launchpad-Style Rhythm-Group Grammar** — Generate a rhythm (sequence of move/jump/wait beats) first, then interpret it as geometry using a grammar. The same rhythm produces many varied levels; the rhythm parameters (length, density, jump frequency) are the design knobs. This is the most elegant pattern in the literature and maps cleanly to our `LevelEntity[]` chunk model. The two-tier separation lets designers tune rhythm without touching geometry.

3. **Physics-Constrained Constructive Assembler** — Derive placement constraints directly from the platformer kernel's physics (`apexHeight`, `timeToApex`, `moveSpeed`, `airControl`). Never place a gap wider than `maxJumpDistance`, never place a step-up taller than `apexHeight`, never place a step-down deeper than `maxFallSpeed × timeToApex`. This is the cheapest solvability guarantee in the literature — a few arithmetic operations per placement — and it composes with both Spelunky-style chunk assembly and Launchpad-style rhythm groups. For our library specifically, this is the single most valuable pattern because our kernel's physics are already exposed as constants.

---

## Cross-References

- `docs/research/level-schema.md` — The `LevelData` schema the generator emits (tiles + entities).
- `docs/research/platformer-kernel.md` — The physics constants (`DEFAULT_PLATFORMER_CONFIG`, `DEFAULT_JUMP`) that the physics-constrained assembler reads.
- `docs/research/editor-core.md` — The `EditorOperation[]` model the generator could emit instead of raw `LevelData`.
- `docs/research/platformer-enemy-archetypes.md` — The enemy archetypes (`spinny`, `turret`) the generator can place as hazards.
- `src/animation/jump.ts` — The apex-parameterized jump math (`DEFAULT_JUMP`, `deriveJumpPhysics`).
- `src/platformer/constants.ts` — The platformer config (`DEFAULT_PLATFORMER_CONFIG`) including `moveSpeed`, `airControl`, `maxFallSpeed`.
- `src/platformer/level-runtime.ts` — The `compileLevel` function that consumes the generator's output.
- `src/editor/operations.ts` — The `applyOp` / `applyBatch` functions the generator could use to emit operations.
- `src/rng/mulberry32.ts` — The seeded PRNG the generator uses for all randomness.
