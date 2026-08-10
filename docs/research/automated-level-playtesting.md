# Automated 2D Platformer Level Testing / Playability Verification

> Research note for automated playability verification of 2D platformer levels. Slug: `automated-level-playtesting`.
> Investigated: 2026-07-28.
> Canonical implementation plan: `docs/design/level-generation-quality-implementation-plan.md`.
> This note is prior-art context, not the implementation contract.

## TL;DR

Automated level testing answers two questions for a deterministic platformer library: (1) "is this level beatable?" and (2) "what does a winning run look like?". For `aicraft-engine`, both questions are already half-answered by the shipped infrastructure — `stepPlatformer(state, input, solids, dt)` is the pure re-sim harness, `compileLevel(level)` produces the static solids + tile query + initial state, and `replayHash(replay)` + `playReplay(replay, step, dt)` give CI-grade replay verification for free. The missing piece is a **bot** that produces a `Replay` (a stream of `PlatformerInput` frames) and a **static reachability analyzer** that catches obvious bugs without running the simulator. Prior art spans three families: simulation-based bots (Baumgarten's A* over state space, Jacobsen's MCTS, Cooper's pathfinding agents), static reachability graphs (BFS over standing surfaces with jump-arc edges, as in `platval` and Eliot Beresford's pathfinding writeup), and design-pattern / RRT playspace analysis (Smith et al., Bauer & Popović). The top 3 patterns worth prototyping for this library are: (1) a **greedy seek-bot that drives `stepPlatformer` and produces a `Replay` for `replayHash` golden-fixture CI**, (2) a **static reachability BFS over compiled solids with jump-arc edge expansion** (no simulation, catches spawn-in-wall and unreachable exit), and (3) a **jump-arc precomputer that derives the reachability edges from the existing `JumpConfig` + `stepPlatformer` physics** so the BFS uses the same physics the kernel uses.

## Why this matters for aicraft-engine

- **Pillars Touched**: extends **Pillar 2 (Platformer)** and **Pillar 4 (Replay)**. The replay module is already shipping; this note is about what consumes it.
- **Consumer Games**: The consumer game needs "is this user-uploaded level beatable?" before allowing share; future consumer titles need CI gates that catch the "I shipped an impossible level" embarrassment (`platval`'s origin story).
- **Unlocks**:
  - **UGC clear-check**: a `Replay` recorded by a bot is the cheapest possible "this level is beatable" proof — the hash is the share-code, the replay is the receipt. Same shape as Super Mario Maker's clear-check.
  - **CI regression for levels**: a `tests/fixtures/levels/*.json` + `tests/fixtures/replays/*.json` pair lets `npm test` assert "every shipped level still produces the same `replayHash`" — catches physics regressions, level-schema migrations, and accidental edits.
  - **Editor live-feedback**: a static reachability pass on every editor `commit` op surfaces "this move makes the exit unreachable" before the player hits it.
  - **Difficulty metrics**: jump-arc edge weights (gap width vs. jump capability) feed into a "how hard is this level?" score that complements the cosmetic / palette metrics.

## Prior Art Survey

### Pattern 1: A* over platformer state space (Baumgarten 2009)

- **Source**: Robin Baumgarten, [mario-astar-robinbaumgarten](https://github.com/RobinB/mario-astar-robinbaumgarten) (Java, WTFPL); Karakovskiy & Togelius, ["The Mario AI Benchmark and Competitions"](https://doi.org/10.1109/tciaig.2012.2188528); Schäfer, ["Comparing an A-Star and a Monte Carlo Tree Search based Agent"](https://doc.neuro.tu-berlin.de/bachelor/2025-BA-JanSchaefer.pdf) (2025 reconstruction).
- **What it does**: Searches **game state space** (not just positions) using A*. Each `SearchNode` carries a copy of the world state; the simulator is invoked to expand successors. The agent's goal is "reach the rightmost edge of the screen as fast as possible." Baumgarten's winning 2009 agent ran a 40 ms search cycle, cached the best and furthest nodes seen, and reset the search tree every second frame to avoid over-committing to a stale plan.
- **Algorithmic shape**:
  ```typescript
  interface SearchNode {
    state: GameState;          // full world snapshot
    action: PlatformerInput;   // edge label
    parent: SearchNode | null;
    g: number;                 // cost so far
    h: number;                 // heuristic estimate to goal
  }

  function optimize(state: GameState, dt: number): PlatformerInput {
    const open: MinHeap<SearchNode> = [];
    const closed = new Set<string>();
    push(open, { state, action: idle(), parent: null, g: 0, h: heuristic(state) });

    let best: SearchNode | null = null;
    let furthest: SearchNode | null = null;
    const deadline = now() + 40;

    while (now() < deadline && open.length > 0) {
      const node = pop(open);
      if (closed.has(hash(node.state))) continue;
      closed.add(hash(node.state));

      // Expand: try all 32 actions (5-bit button vector in Mario; here: moveX × {jump,dash})
      for (const action of ACTIONS) {
        const next = stepSimulator(node.state, action, dt);
        const child = { state: next, action, parent: node, g: node.g + 1, h: heuristic(next) };
        push(open, child);
        if (!best || child.h < best.h) best = child;
        if (!furthest || next.x > furthest.state.x) furthest = child;
      }
    }
    // Return action from the better of best / furthest
    return (best && furthest && furthest.state.x > best.state.x + THRESHOLD)
      ? furthest.action : (best ?? furthest).action;
  }
  ```
- **Determinism profile**: Pure, given a deterministic simulator. The whole agent is a pure function of `(state, dt) → PlatformerInput` if the simulator is pure (ours is).
- **Runtime cost**: Per-tick search budget (Baumgarten: 40 ms). For our library, this is a CI-time cost — not a per-frame cost. A* over state space is exponential in the worst case but the 40 ms cap + best/furthest cache keeps it tractable.
- **Dependencies**: None — just a min-heap and the simulator. Baumgarten's Java code is ~600 lines.
- **Fit for our constraints**: **Strong**. Our `stepPlatformer(state, input, solids, dt)` IS the simulator Baumgarten's `LevelScene` provides. Our `PlatformerInput` is a strict subset of Mario's 5-bit action vector (we have `moveX: -1|0|1` + `jump: PolledEdge` + `dash: PolledEdge | null` — at most 9 distinct actions per tick vs. Mario's 32). Our `mulberry32` PRNG is already deterministic, so the search is reproducible.
- **What to steal**: **State-space A* over `stepPlatformer`**, with the **best/furthest cache** and **two-frame reset** discipline. The 40 ms budget translates cleanly to a CI budget: "give the bot up to N ticks to find a winning path, then hash the replay."
- **What to avoid**: Baumgarten's Java code is "not very clean" by his own admission. Don't port the structure verbatim — extract the algorithm into pure functions and use the existing `replayHash` for verification instead of rolling a custom fingerprint.

### Pattern 2: MCTS for platformers (Jacobsen 2014 "Monte Mario")

- **Source**: Jacobsen, ["Monte Mario: Platforming with MCTS"](http://julian.togelius.com/Jacobsen2014Monte.pdf); Schäfer 2025 reconstruction; [`SamsterJam/MCTS-Platformer`](https://github.com/SamsterJam/MCTS-Platformer) (TypeScript, ~500 lines).
- **What it does**: Standard MCTS — select, expand, simulate (rollout), backpropagate — over the same state space as Baumgarten. Vanilla MCTS performs poorly on Mario (only completes 80/100 levels) because the rollout-to-termination is impossible (the agent almost always dies before reaching the goal). Jacobsen's contributions: **mixmax backups** (replace min/max with average+max for variance reduction), **partial expansion** (don't expand all children of a node, just the most promising), **hole detection** (penalize nodes above gaps), and **MixMax UCB** (UCB variant that handles continuous action spaces).
- **Algorithmic shape**:
  ```typescript
  function runMCTS(rootState: GameState, budget: number): PlatformerInput {
    let root = new MCTSNode(rootState);
    for (let i = 0; i < budget; i++) {
      // 1. Select: descend tree via UCB until leaf or terminal
      let node = selectUCB(root);
      // 2. Expand: pick one untried action, simulate one step
      if (!node.isTerminal()) node = node.expand(stepSimulator);
      // 3. Simulate: rollout with random actions for depthCap ticks
      const reward = rollout(node.state, depthCap);
      // 4. Backpropagate: mixmax update (avg + max) up the tree
      node.backpropagate(reward);
    }
    return root.bestAction(); // argmax visit count
  }
  ```
- **Determinism profile**: Pure, given a deterministic simulator and a seeded rollout RNG. Our `mulberry32` covers this.
- **Runtime cost**: Higher than A* — needs thousands of simulations per action. For our library, this is CI-only territory (a 30-second budget per level is reasonable).
- **Dependencies**: None — pure functions over the simulator. The TypeScript reference is ~500 lines.
- **Fit for our constraints**: **Medium**. MCTS handles dead-ends (multi-path levels) better than A* (Baumgarten's 2010 weakness), but the implementation cost is higher and the determinism story is more delicate (rollout RNG must be seeded and re-seeded per level). The library's `mulberry32` makes seeding trivial.
- **What to steal**: **Hole detection** — penalize nodes that are above a gap. This is a one-line check (`if (noSupportBelow(node.state)) penalize(node)`) and dramatically improves gap-jumping behavior. **Partial expansion** — only expand the top-K children by UCB score, not all of them.
- **What to avoid**: Don't ship MCTS as the default bot. A* is faster, simpler, and sufficient for the linear levels our library targets. MCTS is a future-proofing option for multi-path / dead-end levels.

### Pattern 3: Static reachability BFS over standing surfaces (platval, Beresford)

- **Source**: Reticuli, ["platval: a platformer level validator born from embarrassment"](https://thecolony.cc/post/1146271c-4e83-49d9-9287-5141dc002b2f) (~550 lines Python, MIT); Eliot Beresford, ["Pathfinding in 2D Platformers"](https://eliotberesford.com/2024/09/25/pathfinding-in-2d-platformers.html); Lee, Partlan & Cooper, ["Precomputing Player Movement in Platformers for Level Generation with Reachability Constraints"](https://ceur-ws.org/Vol-2862/paper13.pdf); Cooper, ["Stuck in the Middle: Generating Levels without (or with) Softlocks"](https://doi.org/10.1145/3723498.3723844) (2025).
- **What it does**: Builds a **reachability graph** where nodes are standing surfaces (or surface positions) and edges are either (a) walkable adjacency along the same surface or (b) jump arcs between surfaces. A BFS/DFS from the spawn surface asks "is the exit surface reachable?". No simulation runs — the jump-arc edges are computed analytically from the physics (apex height, horizontal speed, airtime).
- **Algorithmic shape**:
  ```typescript
  interface Surface { x: number; y: number; width: number; }
  interface JumpEdge { from: Surface; to: Surface; airtime: number; difficulty: number; }

  function buildReachabilityGraph(level: CompiledLevel, config: PlatformerConfig): ReachGraph {
    const surfaces = extractStandingSurfaces(level.staticSolids); // top faces of platforms
    const edges: JumpEdge[] = [];
    for (const src of surfaces) {
      for (const dst of surfaces) {
        if (src === dst) continue;
        const arc = computeJumpArc(src, dst, config); // analytic: apex, airtime, horizontal travel
        if (arc.isReachable) {
          edges.push({ from: src, to: dst, airtime: arc.airtime, difficulty: arc.difficulty });
        }
      }
    }
    return { surfaces, edges };
  }

  function isReachable(graph: ReachGraph, from: Surface, to: Surface): boolean {
    const visited = new Set<Surface>();
    const queue = [from];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === to) return true;
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const edge of graph.edges) {
        if (edge.from === cur) queue.push(edge.to);
      }
    }
    return false;
  }
  ```
- **Determinism profile**: Pure. No RNG, no simulation. The jump-arc computation is analytic (parabolic trajectory + horizontal travel time).
- **Runtime cost**: O(surfaces²) for edge construction, O(surfaces + edges) for BFS. For a level with 100 platforms, that's 10,000 edge checks + a BFS — sub-millisecond on modern hardware.
- **Dependencies**: None. `platval` is pure Python 3.6+ with no external deps.
- **Fit for our constraints**: **Strong**. The library already has `compileLevel` (produces `staticSolids` + `tileQuery`) and `JumpConfig` (apex-parameterized jump physics). The reachability graph is a pure function of these two inputs. No new infrastructure needed.
- **What to steal**: **BFS over standing surfaces with analytic jump-arc edges**. The `platval` post-mortem is especially valuable: the author's first version had the same transitive-reachability bug as the original level — the validator forgot that moving-platform positions are themselves valid jump targets. Our `compileLevel` already extracts moving-platform rects as `Solid`s (via `movingPlatformToSolid`), so we sidestep this trap by construction.
- **What to avoid**: Don't try to model every physics detail statically. The reachability graph answers "is the exit reachable?" — not "is the exit reachable in under 30 seconds with no deaths?". The latter needs simulation. Cooper's 2025 paper extends this with **forward + backward reachability + sinks** to also catch softlocks (forward-reachable but not backward-reachable from the goal). Worth a second pass for a v2 feature.

### Pattern 4: Design-pattern analysis (Smith et al. 2008, Dahlskog & Togelius 2012)

- **Source**: Smith, Cha & Whitehead, ["A Framework for Analysis of 2D Platformer Levels"](https://users.soe.ucsc.edu/~ejw/papers/smith-sandbox-2008.pdf) (Sandbox '08); Smith et al., ["Launchpad: A Rhythm-Based Level Generator for 2-D Platformers"](https://users.soe.ucsc.edu/~ejw/papers/launchpad-smith-tciaig-2011.pdf); Dahlskog & Togelius, ["Patterns and Procedural Content Generation"](http://hdl.handle.net/2043/13931) (2012); Smith, Whitehead & Mateas, ["Tanagra"](https://users.soe.ucsc.edu/~ejw/dissertations/Gillian-Smith-dissertation.pdf).
- **What it does**: Decomposes platformer levels into a vocabulary of **components** (platforms, obstacles, movement aids, collectibles, triggers) and a structural hierarchy (**rhythm groups** → **cells** → **portals**). Rhythm groups are short, non-overlapping sets of components that encapsulate an area of challenge. Cells are regions of linear gameplay connected by portals. The framework supports both **analysis** (does this level contain the "gap pattern" or the "2-path pattern"?) and **generation** (Tanagra uses a constraint solver to assemble levels from patterns).
- **Algorithmic shape**:
  ```typescript
  interface RhythmGroup {
    components: Component[];   // platforms, obstacles, collectibles
    start: number;             // x-coordinate where the rhythm begins
    end: number;               // x-coordinate where the cadence resolves
    cadence: 'rest' | 'challenge';
  }

  interface Cell {
    rhythmGroups: RhythmGroup[];
    portals: Portal[];         // transitions to other cells
  }

  // Pattern detection: slide a window over the level and classify each window
  function detectPatterns(level: LevelData): Pattern[] {
    const patterns = [];
    for (const window of slideWindow(level, windowSize)) {
      if (matchesGapPattern(window)) patterns.push({ kind: 'gap', window });
      else if (matchesEnemyPattern(window)) patterns.push({ kind: 'enemy', window });
      // ... 23 patterns from Dahlskog & Togelius
    }
    return patterns;
  }
  ```
- **Determinism profile**: Pure. Pattern detection is a static scan over the level data.
- **Runtime cost**: O(level_width × pattern_count) for sliding-window detection. Fast.
- **Dependencies**: None.
- **Fit for our constraints**: **Medium**. The framework is academically influential but the practical value for our library is limited — pattern detection is more useful for **PCG** (generating levels) than for **testing** (verifying them). The "is this level beatable?" question is better answered by Pattern 3 (reachability BFS). Pattern detection is a v2+ feature for "is this level well-designed?" (rhythm analysis, leniency scoring).
- **What to steal**: The **component taxonomy** — Smith et al.'s five categories (platforms, obstacles, movement aids, collectibles, triggers) map almost 1:1 onto our `EntityKind` union (`platform`, `passthrough`, `hazard`, `trap`, `collectible`, `movingPlatform`, `trigger`). This is validation that our schema is well-shaped.
- **What to avoid**: Don't ship pattern detection as a "level is good" signal. Smith et al. themselves note the framework is descriptive, not prescriptive — a level can have all the right patterns and still be unfun. Reachability + simulation is the load-bearing test.

### Pattern 5: RRT playspace analysis (Bauer & Popović 2012/2013)

- **Source**: Bauer & Popović, ["RRT-Based Game Level Analysis, Visualization, and Visual Refinement"](https://grail.cs.washington.edu/wp-content/uploads/2015/08/bauer2012rgl.pdf) (AIIDE 2012); Bauer, Cooper & Popović, ["Automated Redesign of Local Playspace Properties"](https://grail.cs.washington.edu/wp-content/uploads/2015/08/bauer2013aro.pdf) (FDG 2013).
- **What it does**: Uses **Rapidly-exploring Random Trees (RRT)** to probabilistically explore the level's state space. Each RRT node is a reachable game state; edges are sampled actions. The tree is clustered (Markov Cluster Algorithm) into a compact graph where edge **weight** = number of RRT edges between clusters = "thickness" of the transition. Thin edges = high-precision jumps = hard. The framework supports **automated level redesign**: the designer specifies "I want this edge to be thicker" and an optimizer adjusts platform positions to achieve it.
- **Algorithmic shape**:
  ```typescript
  function exploreLevel(level: LevelData, iterations: number): RRTNode[] {
    const tree: RRTNode[] = [new RRTNode(level.spawn)];
    for (let i = 0; i < iterations; i++) {
      const target = sampleRandomState(level);
      const nearest = tree.findNearest(target);
      const action = sampleRandomAction();
      const next = simulate(nearest.state, action);
      if (isValidTransition(nearest.state, next)) {
        tree.push(new RRTNode(next, parent: nearest, action));
      }
    }
    return tree;
  }

  function buildPlayspaceGraph(tree: RRTNode[]): PlayspaceGraph {
    const clusters = clusterMCL(tree); // Markov Cluster Algorithm
    const graph = new PlayspaceGraph();
    for (const cluster of clusters) graph.addNode(cluster);
    for (const edge of tree.edges) {
      const from = clusters.find(edge.from);
      const to = clusters.find(edge.to);
      graph.addEdge(from, to, weight: countEdgesBetween(from, to));
    }
    return graph;
  }
  ```
- **Determinism profile**: Probabilistic — RRT is a randomized algorithm. Reproducible only if the RNG is seeded (our `mulberry32` covers this).
- **Runtime cost**: High — thousands of iterations, each requiring a simulator step. Bauer et al. report "about one minute" for full recomputation. For our library, this is offline-only territory.
- **Dependencies**: Needs a clustering algorithm (MCL) and the Open Motion Planning Library (OMPL) in the original. Both can be reimplemented in pure TS in ~200 lines.
- **Fit for our constraints**: **Weak**. The framework is heavyweight and the output (a playspace graph) is more useful for **design tools** than for **CI testing**. The "edge thickness" metric is interesting but unvalidated — Bauer et al. themselves note the correlation between thickness and difficulty is "largely hypothetical."
- **What to steal**: The **edge-weight-as-precision-metric** idea. If we precompute jump-arc edges (Pattern 3), we can attach a `difficulty` field to each edge = (gap_width / max_horizontal_jump_distance) and a `precision` field = (1 / number_of_valid_takeoff_positions). These are the same intuitions Bauer et al. encode in edge thickness, but computed analytically instead of via RRT.
- **What to avoid**: Don't ship RRT. It's overkill for our library's scope. The reachability BFS (Pattern 3) covers 90% of the value at 10% of the cost.

### Pattern 6: Constraint-based reachability for softlock prevention (Cooper 2025)

- **Source**: Cooper & Bazzaz, ["Stuck in the Middle: Generating Levels without (or with) Softlocks"](https://doi.org/10.1145/3723498.3723844) (FDG 2025).
- **What it does**: Extends Pattern 3 with **three location categories**:
  - **Forward reachable**: reachable from the start (standard BFS).
  - **Backward reachable**: can reach the goal from here (reverse BFS from the goal).
  - **Sink**: a location where the player inevitably loses (e.g., a pit).
  The constraint "forward reachable ∧ ¬sink → backward reachable" guarantees **no softlocks** — every place the player can reach, they can also escape from (or die trying). The paper applies this to three games (driller, slide, mario) and finds it takes up to 5× longer than path-based completability but produces a wider range of levels.
- **Algorithmic shape**:
  ```typescript
  function classifyLocations(graph: ReachGraph, goal: Surface, sinks: Surface[]): Map<Surface, 'forward' | 'backward' | 'sink'> {
    const forward = bfs(graph, start);          // standard BFS from spawn
    const backward = bfs(reverse(graph), goal); // BFS from goal on reversed edges
    const classification = new Map();
    for (const surface of graph.surfaces) {
      if (sinks.includes(surface)) classification.set(surface, 'sink');
      else if (forward.has(surface) && backward.has(surface)) classification.set(surface, 'forward-backward');
      else if (forward.has(surface)) classification.set(surface, 'forward-only');
      else if (backward.has(surface)) classification.set(surface, 'backward-only');
    }
    return classification;
  }

  function hasSoftlock(classification: Map<Surface, string>): boolean {
    for (const [surface, kind] of classification) {
      if (kind === 'forward-only') return true; // can reach here, can't escape
    }
    return false;
  }
  ```
- **Determinism profile**: Pure. Same as Pattern 3.
- **Runtime cost**: 2× the cost of Pattern 3 (two BFS passes instead of one). Still sub-millisecond for typical levels.
- **Dependencies**: None.
- **Fit for our constraints**: **Strong** (v2 feature). Cooper's softlock detection is exactly the "I shipped an impossible level" failure mode — except worse, because the level IS beatable but has a region the player can get stuck in. Our library's deterministic core makes the reverse-BFS trivial: just reverse the edge direction.
- **What to steal**: **Backward reachability** as a v2 feature. The forward BFS answers "is the exit reachable?"; the backward BFS answers "is every reachable region escapable?". Together they catch the softlock failure mode that pure forward reachability misses.
- **What to avoid**: Don't ship softlock detection as the default. It's a 2× cost and most levels don't have softlock-prone geometry. Make it opt-in via a `verifySoftlocks: true` flag.

### Pattern 7: CI integration via golden replays + hash fingerprints

- **Source**: [`octopus-replay`](https://github.com/octoryn/octopus-replay) (TypeScript, MIT); [`probar`](https://paiml.github.io/probar/probar/deterministic-replay.html) (Rust); Dali, ["Cryptographic Lineage"](https://github.com/yenklabs/Dali/blob/main/docs/cryptographic-lineage.md); our own [`docs/research/replay.md`](replay.md).
- **What it does**: Records a **golden replay** (input stream + initial state) once, then on every CI run re-simulates it and asserts the final state hash matches. If the hash drifts, the test fails with a pointer to the first divergent frame. The pattern is identical across all three projects: `record → replay → hash → assert`.
- **Algorithmic shape** (matches our shipped `replay` module):
  ```typescript
  // CI test:
  it('every shipped level still produces the same replayHash', () => {
    for (const level of loadShippedLevels()) {
      const replay = loadGoldenReplay(level.id);
      const final = playReplay(replay, stepPlatformer, 1 / 60);
      const hash = replayHash(replay);
      expect(hash).toBe(replay.expectedHash);
      expect(final.core.x).toBeCloseTo(replay.expectedFinalX);
    }
  });
  ```
- **Determinism profile**: Pure. The hash is the canonical-JSON FNV-1a fingerprint of the replay (already shipped in `src/replay/hash.ts`).
- **Runtime cost**: O(replay_length) per level. For a 60-tick replay at 60 Hz, that's 1 second of simulated time per level. Trivial for CI.
- **Dependencies**: None — uses our existing `replay` module.
- **Fit for our constraints**: **Strong (already shipped)**. The library already has `createReplayRecorder`, `playReplay`, and `replayHash`. The only missing piece is the **bot that produces the golden replay** — which is Pattern 1 (A* bot) or Pattern 2 (MCTS bot).
- **What to steal**: The **golden-replay-as-fixture** pattern. Commit `tests/fixtures/replays/level-01.json` alongside `tests/fixtures/levels/level-01.json`. CI asserts the hash matches. If the hash drifts, the test fails — and the diff tells you exactly which input frame diverged.
- **What to avoid**: Don't try to make the bot perfect. The golden replay is a **lower bound** on playability: if the bot can beat the level, a human probably can too. If the bot can't, the level might still be beatable (the bot is imperfect) — but it's worth a manual review.

## Reference Implementations

| Reference | What it teaches | Source |
|---|---|---|
| Baumgarten's A* agent | State-space A* over a platformer simulator; 40 ms search budget; best/furthest cache | [github.com/RobinB/mario-astar-robinbaumgarten](https://github.com/RobinB/mario-astar-robinbaumgarten) (Java, WTFPL) |
| `platval` | Static reachability BFS over standing surfaces with analytic jump arcs; ~550 lines Python | [thecolony.cc/post/1146271c-4e83-49d9-9287-5141dc002b2f](https://thecolony.cc/post/1146271c-4e83-49d9-9287-5141dc002b2f) |
| Eliot Beresford's pathfinding writeup | Walkable-segment decomposition + jump-arc edge construction; `getNodePairReachability` signature | [eliotberesford.com/2024/09/25/pathfinding-in-2d-platformers.html](https://eliotberesford.com/2024/09/25/pathfinding-in-2d-platformers.html) |
| `SamsterJam/MCTS-Platformer` | Compact MCTS over a TypeScript platformer with level editor; ~500 lines | [github.com/SamsterJam/MCTS-Platformer](https://github.com/SamsterJam/MCTS-Platformer) |
| Cooper & Bazzaz 2025 | Forward + backward reachability + sinks for softlock prevention | [doi.org/10.1145/3723498.3723844](https://doi.org/10.1145/3723498.3723844) |
| Bauer & Popović 2012 | RRT-based playspace exploration + MCL clustering | [grail.cs.washington.edu/wp-content/uploads/2015/08/bauer2012rgl.pdf](https://grail.cs.washington.edu/wp-content/uploads/2015/08/bauer2012rgl.pdf) |
| Smith et al. 2008 | Design-pattern / rhythm-group / cell-portal taxonomy | [users.soe.ucsc.edu/~ejw/papers/smith-sandbox-2008.pdf](https://users.soe.ucsc.edu/~ejw/papers/smith-sandbox-2008.pdf) |
| `octopus-replay` | Golden-replay CI pattern with divergence pointer | [github.com/octoryn/octopus-replay](https://github.com/octoryn/octopus-replay) |

## Visual References

| Reference | What it shows | Source |
|---|---|---|
| Baumgarten's viral Mario A* video | State-space search visualized as red trajectory lines over the level | [youtube.com/watch?v=DlkMs4ZHHr8](https://www.youtube.com/watch?v=DlkMs4ZHHr8) (1M+ views) |
| `platval` failure report | "exit is 5.0 tiles above nearest surface, max jump: 3.6 tiles" — diagnostic output format | [thecolony.cc/post/1146271c-4e83-49d9-9287-5141dc002b2f](https://thecolony.cc/post/1146271c-4e83-49d9-9287-5141dc002b2f) |
| Bauer & Popović playspace graph | Clustered RRT nodes overlaid on a Treefrog Treasure level | [grail.cs.washington.edu/wp-content/uploads/2015/08/bauer2012rgl.pdf](https://grail.cs.washington.edu/wp-content/uploads/2015/08/bauer2012rgl.pdf) Figure 1b |
| Smith et al. rhythm-group diagram | A "gap pattern" rhythm group with start/middle/end + cadence | [users.soe.ucsc.edu/~ejw/papers/smith-sandbox-2008.pdf](https://users.soe.ucsc.edu/~ejw/papers/smith-sandbox-2008.pdf) Figure 10 |

## Open Questions

1. **What is the right action space for the A* bot?** Baumgarten's 32-action space (5-bit button vector) is overkill for our library's `PlatformerInput` shape. The minimum useful set is probably: `moveX ∈ {-1, 0, 1}` × `jump ∈ {pressed, held, released, idle}` × `dash ∈ {pressed, idle}` — at most 24 distinct actions per tick. Should we enumerate all 24 or restrict to a smaller "interesting" subset (e.g., 8 actions: idle, run-left, run-right, jump-up, jump-left, jump-right, dash-left, dash-right)?
2. **How do we handle moving platforms in the reachability BFS?** `platval`'s bug was exactly this — the validator forgot that moving-platform positions are valid jump targets. Our `compileLevel` already extracts moving-platform rects as `Solid`s via `movingPlatformToSolid`, so the BFS sees them as standing surfaces. But the **jump-arc edges** need to account for the platform's motion: a jump that lands on a moving platform is only valid if the platform is at the landing position at the landing time. This is a v2 feature.
3. **What is the bot's "success" criterion?** Baumgarten's agent optimizes for "furthest right in 40 ms." For our library, the natural criterion is "reached a surface adjacent to an `exit` entity." But what if the exit is a `trap` (`isTrap: true`)? The bot should avoid it. What if the exit is `locked: true`? The bot can't open it without a key. These are consumer-defined semantics — the library needs a callback or a `winCondition` predicate.
4. **Should the bot use the same `mulberry32` PRNG as the rest of the library?** Yes, but the bot's RNG is for **rollout noise** (MCTS) or **tie-breaking** (A* with equal-cost nodes). The seed should be derived from the level id + a fixed salt so the golden replay is reproducible across machines. The library already has `mulberry32` in `src/rng/` — reuse it.
5. **How do we test the validator itself?** `platval`'s author notes that the validator had the same transitive-reachability bug as the original level. The fix is **fuzz testing**: generate solvable levels via the procedural generator, mutate one element, assert the validator catches the mutation. Our library doesn't have a procedural generator yet, but the test pattern is portable: hand-craft 5 solvable + 5 unsolvable levels, assert the validator agrees.

## Top 3 Patterns Worth Prototyping

### 1. Greedy seek-bot + replay as golden fixture

- **Why**: The library already has every piece needed — `stepPlatformer` is the simulator, `createReplayRecorder` captures the bot's input stream, `replayHash` fingerprints the result, `playReplay` re-verifies. A greedy seek-bot (always run toward the exit, jump when blocked, dash when stuck) is ~150 lines of pure TS and produces a `Replay` that doubles as a CI fixture. This is the cheapest possible "is this level beatable?" answer and unlocks the Super Mario Maker clear-check workflow for UGC.

### 2. Static reachability BFS over compiled solids with jump-arc edges

- **Why**: Catches the obvious bugs the bot misses (spawn-in-wall, unreachable exit, unreachable collectibles) without running the simulator. Sub-millisecond cost. The `platval` post-mortem is a cautionary tale — the validator's first version had the same transitive-reachability bug as the level it was validating — but our `compileLevel` already extracts moving-platform rects as `Solid`s, so we sidestep that trap by construction. The output is a `ValidationResult`-shaped diagnostic ("exit is 5 tiles above nearest surface, max jump: 3.6 tiles") that fits naturally next to the existing `validateLevel`.

### 3. Jump-arc precomputer from `JumpConfig` + `stepPlatformer` physics

- **Why**: The reachability BFS (Pattern 2) needs jump-arc edges, and the bot (Pattern 1) needs to know "can I make this jump?". Both questions are answered by the same analytic computation: given `(src_surface, dst_surface, JumpConfig)`, compute the parabolic trajectory and check if the landing position is reachable. The library already has `JumpConfig` (apex height, time to apex) and `stepPlatformer` (the same physics). A pure `computeJumpArc(src, dst, config): { reachable: boolean; airtime: number; difficulty: number }` function is ~80 lines and feeds both the BFS and the bot. This is the **shared physics kernel** for all playability analysis.

## Cross-References

- `src/platformer/kernel.ts` — `stepPlatformer` is the simulator the bot drives and the BFS's jump-arc edges are derived from.
- `src/platformer/level-runtime.ts` — `compileLevel` produces the `staticSolids` + `tileQuery` + `initialState` the BFS and bot consume.
- `src/platformer/types.ts` — `PlatformerInput` is the bot's action space; `PlatformerState` is the bot's world model.
- `src/animation/jump.ts` — `JumpConfig` + `advanceJump` are the source of truth for jump physics; the jump-arc precomputer reads from here.
- `src/collision/aabb.ts` + `src/collision/resolve.ts` — the AABB overlap test the BFS uses to detect "spawn in wall" and "exit sealed off."
- `src/level/validate.ts` — the structural validator the reachability BFS extends (same `ValidationResult` shape, same severity levels).
- `src/replay/recorder.ts` + `src/replay/player.ts` + `src/replay/hash.ts` — the golden-replay CI infrastructure the bot's output feeds into.
- `docs/research/replay.md` — the replay module's design rationale; the bot's output is a `Replay`.
- `docs/research/platformer-kernel.md` — the kernel's determinism contract; the bot inherits it.
- `docs/research/level-schema.md` — the level schema the validator operates on.
- `docs/research/platformer-enemy-archetypes.md` — enemy behavior patterns; the bot's "avoid hazards" logic composes with these.
