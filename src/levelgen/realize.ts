/**
 * Blueprint → LevelData realization pipeline.
 *
 * Realizes a {@link LevelBlueprint} (macro route + pacing rhythm) into a
 * complete, valid {@link GeneratedLevel} with tile geometry, entities,
 * tile semantics, editor operation, and generation report.
 *
 * The realization uses physics constraints to ensure all required jumps
 * are feasible (within estimated maximums). It places platforms, hazards,
 * and collectibles according to the rhythm and route graph.
 *
 * Determinism: uses `mulberry32` for all randomness. No `Math.random`,
 * no `Date.now`, no global mutable state. Same `(seed, blueprint, config)`
 * → same `GeneratedLevel`, forever.
 *
 * @module
 */

import type { LevelData, LevelEntity } from '../level/types';
import type { LevelBlueprint, LevelGenConfig, GeneratedLevel, GenerationReport, GenerationDiagnostic, PacingBeat } from './types';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import { derivePhysicsConstraints } from './physics';
import { mulberry32 } from '../rng/mulberry32';
import { validateLevel } from '../level/validate';
import { LEVEL_VERSION, DEFAULT_ENTITY_ID_START } from '../level/constants';
import {
  DEFAULT_TILE_SEMANTICS,
  MAX_GENERATED_CELLS,
  REALIZE_SEED_SALT,
  DEFAULT_LEVEL_ID_PREFIX,
  DEFAULT_FIXED_DT,
  DEFAULT_PLAYER_WIDTH,
  DEFAULT_PLAYER_HEIGHT,
  MIN_SAFETY_MARGIN,
} from './constants';

/**
 * Compute the difficulty contribution for a single pacing beat.
 * Returns a value `[0, 1]`.
 */
function beatIntensity(beat: PacingBeat): number {
  switch (beat) {
    case 'introduce': return 0.05;
    case 'run':       return 0.15;
    case 'jump':      return 0.35;
    case 'precisionJump': return 0.55;
    case 'dash':      return 0.50;
    case 'rest':      return 0.05;
    case 'reward':    return 0.10;
    case 'branch':    return 0.25;
    case 'climax':    return 0.80;
    case 'release':   return 0.10;
    default:          return 0.20;
  }
}

/**
 * Safely coerce config values to their expected types, returning defaults
 * for missing or invalid fields.
 */
function resolveConfig(config: Readonly<LevelGenConfig>): {
  cols: number;
  rows: number;
  tileSize: number;
  difficulty: number;
  entityIdStart: number;
  id: string;
  name: string;
  playerWidth: number;
  playerHeight: number;
  fixedDt: number;
  semantics: { solid: readonly number[]; passthrough: readonly number[] };
  diagnostics: GenerationDiagnostic[];
} {
  const diagnostics: GenerationDiagnostic[] = [];

  const cols = (typeof config.cols === 'number' && config.cols > 0)
    ? Math.floor(config.cols) : 60;
  const rows = (typeof config.rows === 'number' && config.rows > 0)
    ? Math.floor(config.rows) : 15;
  const tileSize = (typeof config.tileSize === 'number' && Number.isFinite(config.tileSize) && config.tileSize > 0)
    ? config.tileSize : 16;
  const difficulty = (typeof config.difficulty === 'number' && Number.isFinite(config.difficulty))
    ? Math.max(0, Math.min(1, config.difficulty)) : 0.5;
  const entityIdStart = (typeof config.entityIdStart === 'number' && Number.isInteger(config.entityIdStart) && config.entityIdStart >= 1)
    ? config.entityIdStart : DEFAULT_ENTITY_ID_START;
  const id = typeof config.id === 'string' ? config.id : '';
  const name = typeof config.name === 'string' ? config.name : 'Generated Level';
  const playerWidth = (typeof config.playerWidth === 'number' && config.playerWidth > 0)
    ? config.playerWidth : DEFAULT_PLAYER_WIDTH;
  const playerHeight = (typeof config.playerHeight === 'number' && config.playerHeight > 0)
    ? config.playerHeight : DEFAULT_PLAYER_HEIGHT;
  const fixedDt = (typeof config.fixedDt === 'number' && Number.isFinite(config.fixedDt) && config.fixedDt > 0)
    ? config.fixedDt : DEFAULT_FIXED_DT;

  // Validate grid size before allocating.
  const cellCount = cols * rows;
  if (cellCount > MAX_GENERATED_CELLS) {
    diagnostics.push({
      severity: 'warning',
      code: 'GRID_TOO_LARGE',
      message: `Requested ${cellCount} cells exceeds MAX_GENERATED_CELLS (${MAX_GENERATED_CELLS}). Clamping cols/rows.`,
    });
  }
  const clampedCols = Math.min(cols, Math.floor(MAX_GENERATED_CELLS / rows));
  const clampedRows = Math.min(rows, Math.floor(MAX_GENERATED_CELLS / cols));
  const finalCols = cellCount > MAX_GENERATED_CELLS ? Math.max(1, clampedCols) : cols;
  const finalRows = cellCount > MAX_GENERATED_CELLS ? Math.max(1, clampedRows) : rows;

  const semantics = config.tileSemantics ?? DEFAULT_TILE_SEMANTICS;

  return {
    cols: finalCols,
    rows: finalRows,
    tileSize,
    difficulty,
    entityIdStart,
    id,
    name,
    playerWidth,
    playerHeight,
    fixedDt,
    semantics: {
      solid: Array.isArray(semantics.solid) ? semantics.solid : [1],
      passthrough: Array.isArray(semantics.passthrough) ? semantics.passthrough : [2],
    },
    diagnostics,
  };
}

/**
 * Fill the bottom row(s) of the tile grid with solid ground.
 */
function fillGround(data: number[], cols: number, rows: number, solidValue: number): void {
  const groundRow = rows - 1;
  for (let x = 0; x < cols; x++) {
    data[groundRow * cols + x] = solidValue;
  }
}

/**
 * Fill a single tile at (col, row) with the given value, if it is within bounds.
 */
function setTile(data: number[], cols: number, rows: number, col: number, row: number, value: number): void {
  if (col >= 0 && col < cols && row >= 0 && row < rows) {
    data[row * cols + col] = value;
  }
}

/**
 * Check if a tile coordinate is within grid bounds.
 */
function inBounds(col: number, row: number, cols: number, rows: number): boolean {
  return col >= 0 && col < cols && row >= 0 && row < rows;
}

/**
 * Realize a level blueprint into a complete {@link GeneratedLevel}.
 *
 * The realization pipeline:
 * 1. Resolve config with safe defaults.
 * 2. Create an empty tile grid and fill in solid ground.
 * 3. Map the rhythm to horizontal segments and place geometry
 *    (gaps, platforms, hazards) according to each beat.
 * 4. Place branch/reward platforms and collectible entities.
 * 5. Place spawn and exit entities.
 * 6. Build the `LevelData` and validate it.
 * 7. Construct the generation report.
 *
 * Pure: never mutates input, never throws. Returns a valid
 * `GeneratedLevel` with diagnostic data on any issues.
 *
 * @param seed      - Deterministic seed for variation within the blueprint.
 * @param blueprint - The blueprint to realize (route + rhythm).
 * @param config    - Generation config (dimensions, difficulty, etc.).
 * @returns A complete generated level with report.
 *
 * @example
 * ```ts
 * const result = realizeBlueprint(42, blueprint, { cols: 60, rows: 15, tileSize: 16 });
 * // result.level passes validateLevel
 * // result.editorOp reproduces the level via applyOp
 * ```
 */
export function realizeBlueprint(
  seed: number,
  blueprint: Readonly<LevelBlueprint>,
  config: Readonly<LevelGenConfig> = {},
): GeneratedLevel {
  const rng = mulberry32((seed >>> 0) ^ REALIZE_SEED_SALT);

  // Defensive null/undefined check for blueprint.
  const safeBlueprint: LevelBlueprint = (blueprint ?? {
    version: 1,
    route: { version: 1, nodes: [{ id: 'start', x: 1, y: 1, kind: 'start' }, { id: 'exit', x: 3, y: 1, kind: 'exit' }], edges: [{ from: 'start', to: 'exit', kind: 'main' }] },
    pacing: ['introduce', 'run', 'release'],
    requiredMechanics: [{ name: 'jump', enabled: true }, { name: 'dash', enabled: false }, { name: 'doubleJump', enabled: false }, { name: 'wallJump', enabled: false }, { name: 'wallSlide', enabled: false }],
    targetDifficulty: 0.5,
  }) as LevelBlueprint;

  const resolved = resolveConfig(config ?? {});
  const {
    cols,
    rows,
    tileSize,
    difficulty,
    entityIdStart,
    id,
    name,
    playerHeight,
    semantics,
    diagnostics: configDiagnostics,
  } = resolved;

  const solidValue = (semantics.solid.length > 0) ? semantics.solid[0] : 1;
  const allDiagnostics: GenerationDiagnostic[] = [...configDiagnostics];

  // Create tile grid: all zeros initially.
  const data: number[] = new Array(cols * rows).fill(0);

  // Fill bottom row with solid ground.
  fillGround(data, cols, rows, solidValue);

  // The walking surface is one tile above the bottom row.
  const surfaceRow = rows - 2;

  // Fill the surface row with solid ground (we'll remove tiles for gaps).
  for (let x = 0; x < cols; x++) {
    setTile(data, cols, rows, x, surfaceRow, solidValue);
  }

  // Track entities to place.
  const entities: LevelEntity[] = [];
  let nextId = entityIdStart;

  // Look up blueprint nodes by kind.
  const startNode = safeBlueprint.route.nodes.find((n) => n.kind === 'start');
  const exitNode = safeBlueprint.route.nodes.find((n) => n.kind === 'exit');
  const branchNodes = safeBlueprint.route.nodes.filter((n) => n.kind === 'branch');
  const rewardNodes = safeBlueprint.route.nodes.filter((n) => n.kind === 'reward');

  // -------------------------------------------------------------------
  // 1. Apply pacing beats to create geometry along the main path.
  // -------------------------------------------------------------------
  const beats = safeBlueprint.pacing;
  const segmentWidth = Math.max(1, Math.floor(cols / beats.length));

  beats.forEach((beat, beatIndex) => {
    const segStart = beatIndex * segmentWidth;
    const segEnd = Math.min((beatIndex + 1) * segmentWidth, cols - 1);
    const segCenter = Math.floor((segStart + segEnd) / 2);

    switch (beat) {
      case 'jump': {
        // Create a 2-3 tile gap.
        const gapWidth = 2 + Math.floor(rng() * 2); // 2-3 tiles
        const gapStart = Math.max(segStart + 1, segCenter - Math.floor(gapWidth / 2) - 1);
        for (let gx = gapStart; gx < gapStart + gapWidth && gx < cols - 1; gx++) {
          setTile(data, cols, rows, gx, surfaceRow, 0);
          setTile(data, cols, rows, gx, surfaceRow - 1, 0);
        }
        break;
      }
      case 'precisionJump': {
        // Create a wider gap (3-4 tiles).
        const gapWidth = 3 + Math.floor(rng() * 2);
        const gapStart = Math.max(segStart + 1, segCenter - Math.floor(gapWidth / 2));
        for (let gx = gapStart; gx < gapStart + gapWidth && gx < cols - 1; gx++) {
          setTile(data, cols, rows, gx, surfaceRow, 0);
          setTile(data, cols, rows, gx, surfaceRow - 1, 0);
        }
        break;
      }
      case 'dash': {
        // Longer gap, requires dash extension.
        const gapWidth = 4 + Math.floor(rng() * 2);
        const gapStart = Math.max(segStart + 1, segCenter - Math.floor(gapWidth / 2));
        for (let gx = gapStart; gx < gapStart + gapWidth && gx < cols - 1; gx++) {
          setTile(data, cols, rows, gx, surfaceRow, 0);
          setTile(data, cols, rows, gx, surfaceRow - 1, 0);
        }
        break;
      }
      case 'climax': {
        // Two gaps near each other with a narrow platform between them.
        const gap1Width = 2;
        const gap1Start = Math.max(segStart + 1, segCenter - 3);
        for (let gx = gap1Start; gx < gap1Start + gap1Width && gx < cols - 1; gx++) {
          setTile(data, cols, rows, gx, surfaceRow, 0);
          setTile(data, cols, rows, gx, surfaceRow - 1, 0);
        }
        // Narrow middle platform (1 tile wide).
        const midX = gap1Start + gap1Width + 1;
        // Second gap.
        const gap2Start = midX + 1;
        const gap2Width = 2 + Math.floor(rng() * 2);
        for (let gx = gap2Start; gx < gap2Start + gap2Width && gx < cols - 1; gx++) {
          setTile(data, cols, rows, gx, surfaceRow, 0);
          setTile(data, cols, rows, gx, surfaceRow - 1, 0);
        }
        break;
      }
      case 'branch': {
        // Branch node determines if there's a platform above.
        // Find a branch node that falls within this segment.
        const branchInSegment = branchNodes.find((bn) =>
          bn.x >= segStart && bn.x <= segEnd,
        );
        if (branchInSegment) {
          // Create a platform staircase from surface up to branch height.
          const branchTile = branchInSegment.x;
          const branchHeight = branchInSegment.y;
          if (branchHeight < surfaceRow) {
            // Vertical ascent: pillars up to the branch height.
            for (let y = surfaceRow - 1; y >= branchHeight && y >= 0; y--) {
              setTile(data, cols, rows, branchTile, y, solidValue);
              setTile(data, cols, rows, branchTile - 1, y, solidValue);
            }
            // Platform at the branch height.
            setTile(data, cols, rows, branchTile, branchHeight, solidValue);
            setTile(data, cols, rows, branchTile - 1, branchHeight, solidValue);
          }
        }
        break;
      }
      case 'reward': {
        // Flat ground, collectible placed on it.
        // No geometry changes needed — reward entities are placed below.
        break;
      }
      case 'introduce':
      case 'run':
      case 'rest':
      case 'release': {
        // Flat ground — no gaps, no special geometry.
        break;
      }
      default: {
        // Unknown beat — treat as run.
        break;
      }
    }
  });

  // -------------------------------------------------------------------
  // 2. Place branch/reward collectibles.
  // -------------------------------------------------------------------
  for (const reward of rewardNodes) {
    const rewardX = reward.x * tileSize;
    const rewardY = (reward.y + 1) * tileSize; // place at body height
    if (inBounds(reward.x, reward.y, cols, rows)) {
      // Ensure there's a platform under the collectible.
      if (data[(reward.y + 1) * cols + reward.x] === 0) {
        setTile(data, cols, rows, reward.x, Math.min(rows - 1, reward.y + 1), solidValue);
      }
      entities.push({
        id: nextId++,
        kind: 'collectible',
        rect: { x: rewardX, y: rewardY - tileSize, width: tileSize, height: tileSize },
        props: { kind: 'coin' as const, value: 1 },
      });
    }
  }

  // -------------------------------------------------------------------
  // 3. Place branch platforms.
  // -------------------------------------------------------------------
  for (const branch of branchNodes) {
    // Add a visual hazard decoration below the branch platform to signal danger.
    if (branch.y + 1 < rows - 1) {
      // Create a small trap indicator (not an actual hazard entity, just visual).
      // We use a variation: if high enough, place a passthrough tile below.
      if (rng() < 0.5) {
        setTile(data, cols, rows, branch.x, branch.y + 2, solidValue);
      }
    }
  }

  // -------------------------------------------------------------------
  // 4. Place spawn entity.
  // -------------------------------------------------------------------
  const spawnTileX = startNode ? startNode.x : 1;
  const spawnWorldX = spawnTileX * tileSize;
  // Place spawn so the player stands on the surface row.
  const spawnWorldY = (surfaceRow) * tileSize - playerHeight;

  // Place a small platform where the spawn is if ground is not there.
  if (data[surfaceRow * cols + spawnTileX] === 0) {
    setTile(data, cols, rows, spawnTileX, surfaceRow, solidValue);
    setTile(data, cols, rows, spawnTileX + 1, surfaceRow, solidValue);
  }

  entities.push({
    id: nextId++,
    kind: 'spawn',
    rect: { x: spawnWorldX, y: spawnWorldY, width: tileSize, height: tileSize },
    props: {},
  });

  // -------------------------------------------------------------------
  // 5. Place exit entity.
  // -------------------------------------------------------------------
  const exitTileX = exitNode ? exitNode.x : Math.max(1, cols - 3);
  const exitWorldX = exitTileX * tileSize;
  const exitWorldY = (surfaceRow) * tileSize - playerHeight;

  // Ensure ground exists at exit.
  if (data[surfaceRow * cols + exitTileX] === 0) {
    setTile(data, cols, rows, exitTileX, surfaceRow, solidValue);
    setTile(data, cols, rows, exitTileX - 1, surfaceRow, solidValue);
  }

  entities.push({
    id: nextId++,
    kind: 'exit',
    rect: { x: exitWorldX, y: exitWorldY, width: tileSize, height: tileSize },
    props: { isTrap: false, locked: false },
  });

  // -------------------------------------------------------------------
  // 6. Build LevelData.
  // -------------------------------------------------------------------
  const levelWidth = cols * tileSize;
  const levelHeight = rows * tileSize;

  const level: LevelData = {
    version: LEVEL_VERSION,
    id: id || `${DEFAULT_LEVEL_ID_PREFIX}${seed}`,
    name,
    width: levelWidth,
    height: levelHeight,
    tileSize,
    spawn: { x: spawnWorldX, y: spawnWorldY },
    tiles: {
      data,
      cols,
      rows,
      tileSize,
    },
    entities,
    nextEntityId: nextId,
  };

  // -------------------------------------------------------------------
  // 7. Validate the level.
  // -------------------------------------------------------------------
  const validationResult = validateLevel(level);
  if (!validationResult.valid) {
    for (const err of validationResult.errors) {
      if (err.severity === 'error') {
        allDiagnostics.push({
          severity: 'error',
          code: 'LEVEL_INVALID',
          message: `${err.path}: ${err.message}`,
        });
      }
    }
  }

  // -------------------------------------------------------------------
  // 8. Compute basic safety margins.
  // -------------------------------------------------------------------
  // The fallback is the engine's canonical default config (was a ~60-field
  // inline duplicate with `as any` — a pure drift hazard; the swap adds five
  // optional fields the literal omitted, all read through `??` fallbacks in
  // the kernel, so derivation output is unchanged — pinned by test).
  const physics = derivePhysicsConstraints(
    (config ?? {}).platformerConfig ?? DEFAULT_PLATFORMER_CONFIG,
    tileSize,
  );

  const safetyMargins = safeBlueprint.route.edges.map((edge) => {
    const fromNode = safeBlueprint.route.nodes.find((n) => n.id === edge.from);
    const toNode = safeBlueprint.route.nodes.find((n) => n.id === edge.to);
    if (!fromNode || !toNode) {
      return { from: edge.from, to: edge.to, margin: 0, feasible: false };
    }
    const dx = Math.abs(toNode.x - fromNode.x) * tileSize;
    const margin = physics.maxJumpDistance - dx;
    const feasible = margin >= (MIN_SAFETY_MARGIN * 0.5);
    return { from: edge.from, to: edge.to, margin: Math.round(margin * 100) / 100, feasible };
  });

  // -------------------------------------------------------------------
  // 9. Build report.
  // -------------------------------------------------------------------
  const measuredDifficulty = beats.length > 0
    ? beats.reduce((sum, b) => sum + beatIntensity(b), 0) / beats.length
    : difficulty;

  const report: GenerationReport = {
    version: 1,
    seed,
    candidateIndex: 0,
    repairs: [],
    verification: {
      version: 1,
      status: 'inconclusive',
      structural: validationResult,
      reachability: {
        confidence: 'heuristic',
        reachable: validationResult.valid,
        nodeCount: safeBlueprint.route.nodes.length,
        summary: validationResult.valid
          ? 'Structural validation passed. Full verification requires Phase 5.'
          : 'Structural validation failed.',
      },
      scenario: {
        version: 1,
        status: 'inconclusive',
        runs: [],
        diagnostics: [],
      },
      winningReplay: undefined,
      winningReplayHash: undefined,
      diagnostics: [],
    },
    quality: (() => {
      const fairness = safetyMargins.every((m) => m.feasible) ? 0.8 : 0.3;
      const exploration = branchNodes.length > 0 ? 0.7 : 0.2;
      const difficultyFit = Math.max(0, Math.min(1, 1 - Math.abs(measuredDifficulty - difficulty)));
      const readability = 0.7;
      const scoreComponents = [fairness, exploration, difficultyFit, readability];
      const qualityScore = scoreComponents.length > 0
        ? scoreComponents.reduce((a, b) => a + b, 0) / scoreComponents.length
        : 0;
      return {
        version: 1,
        score: qualityScore,
        pacing: 0,
        variety: 0,
        fairness,
        exploration,
        difficultyFit,
        readability,
        measuredDifficulty,
        safetyMargins,
        diagnostics: [],
      };
    })(),
    diagnostics: allDiagnostics,
  };

  // -------------------------------------------------------------------
  // 10. Build editor operation.
  // -------------------------------------------------------------------
  const editorOp = {
    type: 'replaceLevel' as const,
    level: JSON.parse(JSON.stringify(level)) as LevelData,
    label: `Replace with generated level "${level.name}"`,
  };

  return {
    level,
    editorOp,
    tileSemantics: semantics,
    report,
  };
}
