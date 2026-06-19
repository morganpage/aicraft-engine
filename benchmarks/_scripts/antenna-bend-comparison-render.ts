/**
 * Antenna bend-resistance A/B/C comparison render.
 *
 * Renders a single comparison sheet `benchmarks/antenna-bend-comparison.png`
 * with 3 rows × 6 columns so the benchmarker can visually compare the shipped
 * Provot bend-resistance against the no-bend baseline and the (not-shipped)
 * angular PBD alternative:
 *
 *   Row 1 — BASELINE: no bend springs (the "rope/chain" read the user flagged).
 *   Row 2 — PROVOT:   `applyAntennaBendConstraints` (next-nearest-neighbor
 *                     distance constraints, rest length 2·seg). PRODUCTION —
 *                     this is what `stepHero` ships. Imported from
 *                     `showcase/helpers/slime-knight.ts`.
 *   Row 3 — ANGULAR:  2D angular PBD (θ₀=π). NOT SHIPP — Provot won the
 *                     prototype bake-off; this row is kept for reference.
 *
 * Columns = jump-landing frames (the failure case the user identified):
 *   1. Pre-jump (standing rest pose)
 *   2. Mid-air apex (chain lagging up — buckling starts)
 *   3. Just before landing
 *   4. Landing impact (the marquee failure frame — baseline rope-buckle worst)
 *   5. Landing rebound (+1 tick)
 *   6. Landing settle (+2 ticks)
 *
 * All three rows share the SAME seed (98724), SAME jump timing, SAME frame
 * ticks, SAME Bezier renderer (R1, constant across rows) — ONLY the bend
 * function differs. The jump state machine is RNG-free and receives identical
 * inputs across all three conditions, so the landing tick is identical across
 * rows; the antenna DIVERGES because the bend function changes the per-tick
 * physics.
 *
 * **Pipeline approach.** Each row runs through `stepHeroWithBend` — a faithful
 * mirror of the production `stepHero` body with a swappable bend function. This
 * guarantees all three rows share the EXACT same code path (jump, locomotion,
 * anchor, spring chain, rest-pose, tip-weight); only the bend step differs
 * (null for BASELINE, `applyAntennaBendConstraints` for PROVOT, `angularBend`
 * for ANGULAR). The PROVOT row therefore reproduces the production `stepHero`
 * output (same 4-pass pipeline in the same order); the other two rows are
 * "what production would look like with a different/no bend."
 *
 * Run:  npx tsx benchmarks/_scripts/antenna-bend-comparison-render.ts
 */

import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  deriveHeroConfig,
  createHeroFrameState,
  drawSlimeKnight,
  applyAntennaBendConstraints,
  applyAntennaRestPose,
  applyAntennaTipWeight,
  HERO_CANVAS_SIZE,
  HERO_GROUND_Y,
  type HeroFrameState,
  type HeroConfig,
} from '../../showcase/helpers/slime-knight';
import {
  breathe,
  evaluateJump,
  evaluateLocomotion,
  advanceJump,
  advanceLocomotion,
  advanceSpringChain,
  DEFAULT_JUMP,
  DEFAULT_TUCK,
  type VerletNode,
  type JumpInputs,
} from '../../src/animation';

// ---------------------------------------------------------------------------
// Tuning knobs — angular PBD stiffness only.
//
// The PROVOT stiffness constants live in `showcase/helpers/slime-knight.ts`
// (ANTENNA_BEND_STIFFNESS_BASE = 0.9, ANTENNA_BEND_STIFFNESS_TIP = 0.65) — the
// PROVOT row imports + calls the production `applyAntennaBendConstraints`
// directly, so those values are owned there. The angular constants below are
// local to this script (angular PBD is NOT shipped — Provot won).
// ---------------------------------------------------------------------------

/** Angular PBD stiffness at the base joint (j=1, root-adjacent). */
const ANGULAR_STIFFNESS_BASE = 0.6;
/** Angular PBD stiffness at the tip joint (j=n-2, last internal joint). */
const ANGULAR_STIFFNESS_TIP = 0.35;

/** Rest angle for the angular constraint = π (straight rod). COEXISTS with the
 *  absolute forward-lean spring — bend enforces straightness, NOT lean. */
const REST_ANGLE = Math.PI;

// ---------------------------------------------------------------------------
// Not-shipped alternative — 2D angular PBD (corrected). Kept for reference;
// Provot won the prototype bake-off (smoother rod read on landing impact).
// ---------------------------------------------------------------------------

/**
 * 2D angular PBD constraints. For each internal joint nodes[j] (j=1..n-2),
 * restore the relative angle between segments (j-1→j) and (j→j+1) toward π
 * (straight). COEXISTS with `applyAntennaRestPose`: this enforces inter-segment
 * straightness (anti-buckling); the absolute spring enforces forward lean.
 * ROOT-PINNING FIX: when j===1, nodes[j-1]=nodes[0] is the pinned root →
 * rotate ONLY nodes[j+1] by the FULL corr (not corr/2), leaving the root
 * immovable. Tapered stiffness. Velocity preserved (curr+prev move together).
 *
 * NOT SHIPPED — documented here for reference if Provot's 180-degree pop
 * becomes an issue (unlikely for the antenna's moderate deflection).
 *
 * The `segmentLength` parameter is unused (angular constraints use atan2 of
 * segment vectors, not the rest length) but is required by the bend-function
 * signature for uniformity with `applyAntennaBendConstraints`. `void` silences
 * the unused-parameter check.
 *
 * Operates in place on the fresh chain from `advanceSpringChain` (already a
 * deep copy) and returns the same array for chaining. Deterministic.
 */
function angularBend(nodes: VerletNode[], segmentLength: number): VerletNode[] {
  void segmentLength; // not needed for angular (uses atan2 of segment vectors)
  const joints = nodes.length - 2; // j ranges 1..n-2
  for (let j = 1; j <= joints; j++) {
    const p1 = nodes[j - 1]; // "before" (root when j===1)
    const p2 = nodes[j]; // joint
    const p3 = nodes[j + 1]; // "after"
    const u1x = p1.x - p2.x,
      u1y = p1.y - p2.y;
    const u2x = p3.x - p2.x,
      u2y = p3.y - p2.y;
    const len1 = Math.sqrt(u1x * u1x + u1y * u1y);
    const len2 = Math.sqrt(u2x * u2x + u2y * u2y);
    if (len1 === 0 || len2 === 0) continue;
    const a1 = Math.atan2(u1y, u1x);
    const a2 = Math.atan2(u2y, u2x);
    let theta = a2 - a1;
    while (theta < -Math.PI) theta += 2 * Math.PI;
    while (theta > Math.PI) theta -= 2 * Math.PI;
    let err = theta - REST_ANGLE;
    while (err < -Math.PI) err += 2 * Math.PI;
    while (err > Math.PI) err -= 2 * Math.PI;
    // Tapered stiffness: joint j=1 (base) → BASE, joint j=joints (tip) → TIP.
    const t = joints > 1 ? (j - 1) / (joints - 1) : 0;
    const stiff =
      ANGULAR_STIFFNESS_BASE +
      (ANGULAR_STIFFNESS_TIP - ANGULAR_STIFFNESS_BASE) * t;
    // Negative because rotating u1 by -corr/2 and u2 by +corr/2 makes the new
    // relative angle theta' = theta + corr; to drive theta toward REST_ANGLE
    // (err = theta - REST_ANGLE), corr must be -err·stiff. A positive sign
    // AMPLIFIES the deviation and runaway-folds the antenna.
    const corr = -err * stiff;
    if (j === 1) {
      // ROOT-PINNING FIX: p1 is the pinned root. Rotate ONLY p3 by full corr.
      const c = Math.cos(corr),
        s = Math.sin(corr);
      const nx = p2.x + (u2x * c - u2y * s);
      const ny = p2.y + (u2x * s + u2y * c);
      const dx = nx - p3.x,
        dy = ny - p3.y;
      p3.x += dx;
      p3.y += dy;
      p3.prevX += dx;
      p3.prevY += dy;
    } else {
      // Rotate p1 by -corr/2, p3 by +corr/2 around p2. Curr+prev together.
      const c1 = Math.cos(-corr / 2),
        s1 = Math.sin(-corr / 2);
      const c2 = Math.cos(corr / 2),
        s2 = Math.sin(corr / 2);
      const n1x = p2.x + (u1x * c1 - u1y * s1);
      const n1y = p2.y + (u1x * s1 + u1y * c1);
      const n3x = p2.x + (u2x * c2 - u2y * s2);
      const n3y = p2.y + (u2x * s2 + u2y * c2);
      const d1x = n1x - p1.x,
        d1y = n1y - p1.y;
      const d3x = n3x - p3.x,
        d3y = n3y - p3.y;
      p1.x += d1x;
      p1.y += d1y;
      p1.prevX += d1x;
      p1.prevY += d1y;
      p3.x += d3x;
      p3.y += d3y;
      p3.prevX += d3x;
      p3.prevY += d3y;
    }
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// stepHeroWithBend — faithful mirror of production stepHero with a swappable
// bend function. All three rows run through this so ONLY the bend step differs
// (fair A/B/C comparison). The PROVOT row (bend = applyAntennaBendConstraints)
// reproduces the production stepHero output exactly.
// ---------------------------------------------------------------------------

/** A bend function matching the showcase antenna-pipeline signature, or null
 *  for the baseline row (no bend step). */
type BendFn =
  | ((nodes: VerletNode[], segmentLength: number) => VerletNode[])
  | null;

/**
 * Compute the step-time antenna anchor — mirrors `bodyTop` + `heroCenterY` in
 * `slime-knight.ts` (the STEP-time anchor, NOT the draw-time re-pin which
 * includes breath). Uses the legacy time-driven walk path (x stays 0); kept
 * here so the benchmark's custom pipeline matches production `stepHero` exactly.
 */
function stepAnchor(
  config: HeroConfig,
  pose: ReturnType<typeof evaluateLocomotion>,
  jumpPose: ReturnType<typeof evaluateJump>,
  x: number,
): { x: number; y: number } {
  const jumpLift =
    jumpPose.yOffset + DEFAULT_TUCK.hipRaise * jumpPose.airborneBlend;
  const jumpScaleY = jumpPose.scale.scaleY;
  const landingDrop =
    jumpScaleY < 1 ? (1 - jumpScaleY) * config.bodyHeight : 0;
  const reach =
    (config.boneLengths.thigh + config.boneLengths.shin) * 0.9; // LEG_REACH_RATIO
  const heroCy = HERO_GROUND_Y - config.bodyHeight / 2 - reach;
  const effectiveBodyCy = heroCy + pose.hipOffset.y + jumpLift + landingDrop;
  return {
    x: HERO_CANVAS_SIZE / 2 + x + pose.hipOffset.x,
    y: effectiveBodyCy - (config.bodyHeight / 2) * jumpScaleY,
  };
}

/**
 * Advance the hero one tick with a swappable antenna bend function. Faithful
 * mirror of production `stepHero` (legacy time-driven walk path, no walkDx):
 * jump → locomotion → anchor → advanceSpringChain → bend (optional) →
 * applyAntennaRestPose → applyAntennaTipWeight. ONLY the bend step is
 * parameterized; everything else is byte-identical across rows.
 */
function stepHeroWithBend(
  state: HeroFrameState,
  dt: number,
  jumpPressed: boolean,
  jumpHeld: boolean,
  bend: BendFn,
): HeroFrameState {
  const { config } = state;
  const isGrounded = state.jump.y >= 0;
  const jumpInputs: JumpInputs = {
    jumpPressed,
    jumpHeld,
    isGrounded,
  };
  let jump = advanceJump(state.jump, jumpInputs, dt, DEFAULT_JUMP);
  if (jump.phase === 'grounded' || jump.phase === 'landing') {
    jump = { ...jump, y: 0 };
  }
  const locomotion = advanceLocomotion(
    state.locomotion,
    config.speed,
    dt,
    config.gaitConfig,
  );
  const pose = evaluateLocomotion(locomotion, config.gaitConfig);
  const jumpPose = evaluateJump(jump);
  const anchor = stepAnchor(config, pose, jumpPose, state.x);
  let antenna = advanceSpringChain(
    state.antenna,
    anchor.x,
    anchor.y,
    dt,
    config.springConfig,
  );
  // The ONLY row-dependent step. null = baseline (skip); otherwise the bend
  // function (Provot or angular) runs between the solver and the rest-pose.
  if (bend) antenna = bend(antenna, config.antennaSegmentLength);
  antenna = applyAntennaRestPose(antenna, config.antennaSegmentLength);
  antenna = applyAntennaTipWeight(antenna);
  return {
    config,
    locomotion,
    antenna,
    jump,
    x: state.x,
    facing: state.facing,
    eyeCount: state.eyeCount,
  };
}

// ---------------------------------------------------------------------------
// Simulation — identical jump sequence across all three conditions
// ---------------------------------------------------------------------------

const SEED = 98724;
const DT = 1 / 60;
const SETTLE_STEPS = 30;
const JUMP_HOLD_STEPS = 25;
// After the jump trigger (tick 31) + hold (ticks 32-56), landing lands around
// tick 69 for seed 98724. We need enough post-landing steps to cover the
// impact, +1 rebound, +2 settle, with margin for the column detector.
const POST_LANDING_STEPS = 25;

interface Condition {
  readonly name: string;
  readonly shortName: string;
  readonly bend: BendFn;
}

const CONDITIONS: readonly Condition[] = [
  { name: 'BASELINE (no bend)', shortName: 'BASELINE', bend: null },
  {
    name: 'PROVOT bend springs (production)',
    shortName: 'PROVOT',
    bend: applyAntennaBendConstraints,
  },
  {
    name: 'ANGULAR PBD (θ₀=π) — not shipped',
    shortName: 'ANGULAR',
    bend: angularBend,
  },
];

/**
 * Run one full simulation for a given bend function, recording the state at
 * every tick. Returns an array indexed by tick (frames[tick] = state at tick).
 *
 * The input sequence is identical across conditions (the bend function only
 * touches antenna nodes, never the jump state machine), so the jump/landing
 * timing is byte-identical across all three rows — only the antenna diverges.
 */
function runSimulation(bend: BendFn): HeroFrameState[] {
  const config = deriveHeroConfig(SEED);
  const frames: HeroFrameState[] = [];
  let state = createHeroFrameState(config);
  frames.push(state); // tick 0

  // Settle — SETTLE_STEPS ticks of idle (legacy walk-in-place path). No walkDx
  // → time-driven locomotion advances.
  for (let i = 0; i < SETTLE_STEPS; i++) {
    state = stepHeroWithBend(state, DT, false, false, bend);
    frames.push(state);
  }

  // Jump trigger — one step with jumpPressed + jumpHeld.
  state = stepHeroWithBend(state, DT, true, true, bend);
  frames.push(state);

  // Hold — JUMP_HOLD_STEPS ticks of sustained jumpHeld.
  for (let i = 0; i < JUMP_HOLD_STEPS; i++) {
    state = stepHeroWithBend(state, DT, false, true, bend);
    frames.push(state);
  }

  // Release + post-landing recovery — jumpHeld released.
  for (let i = 0; i < POST_LANDING_STEPS; i++) {
    state = stepHeroWithBend(state, DT, false, false, bend);
    frames.push(state);
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Frame selection — detect landing tick + apex from the baseline run
// ---------------------------------------------------------------------------

interface FrameColumn {
  readonly tick: number;
  readonly label: string;
  readonly sub: string;
}

/**
 * Pick the 6 comparison frame ticks. The jump trigger lands at tick
 * `SETTLE_STEPS + 1` = 31. The landing tick (first `phase === 'landing'`
 * after the jump) and apex tick (min `jump.y`) are detected dynamically from
 * the baseline frames so the sheet auto-adapts if the jump constants change.
 */
function selectColumns(
  baselineFrames: readonly HeroFrameState[],
): FrameColumn[] {
  const jumpStart = SETTLE_STEPS + 1; // tick 31 (first step after trigger)

  let landingTick = -1;
  for (let t = jumpStart + 1; t < baselineFrames.length; t++) {
    if (baselineFrames[t].jump.phase === 'landing') {
      landingTick = t;
      break;
    }
  }
  if (landingTick === -1) {
    throw new Error(
      'Could not detect landing tick — check JUMP_HOLD_STEPS / POST_LANDING_STEPS.',
    );
  }

  let apexTick = jumpStart;
  let minY = Infinity;
  for (let t = jumpStart; t < landingTick; t++) {
    if (baselineFrames[t].jump.y < minY) {
      minY = baselineFrames[t].jump.y;
      apexTick = t;
    }
  }

  const preLandTick = Math.max(jumpStart + 1, landingTick - 1);

  return [
    {
      tick: SETTLE_STEPS,
      label: '1. Pre-jump (standing)',
      sub: `Tick ${SETTLE_STEPS} | Grounded rest pose | identical across rows (bend is motion-driven)`,
    },
    {
      tick: apexTick,
      label: '2. Mid-air apex',
      sub: `Tick ${apexTick} | jump.y=${minY.toFixed(1)} | chain lagging up — buckling starts`,
    },
    {
      tick: preLandTick,
      label: '3. Just before landing',
      sub: `Tick ${preLandTick} | phase=${baselineFrames[preLandTick].jump.phase} | last frame before impact`,
    },
    {
      tick: landingTick,
      label: '4. LANDING IMPACT',
      sub: `Tick ${landingTick} | MARQUEE FAILURE — baseline rope-buckle worst here`,
    },
    {
      tick: landingTick + 1,
      label: '5. Landing rebound (+1)',
      sub: `Tick ${landingTick + 1} | post-impact rebound`,
    },
    {
      tick: landingTick + 2,
      label: '6. Landing settle (+2)',
      sub: `Tick ${landingTick + 2} | settling back toward rest`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Per-panel antenna-base geometry (mirrors drawSlimeKnight's computation so
// the zoom can center on the antenna base exactly where it is drawn).
// ---------------------------------------------------------------------------

function antennaBaseForFrame(
  frame: HeroFrameState,
  tick: number,
  config: HeroConfig,
): { x: number; y: number } {
  const pose = evaluateLocomotion(frame.locomotion, config.gaitConfig);
  const jumpPose = evaluateJump(frame.jump);
  const breath = breathe(tick, config.breathConfig);
  const composedScaleY = breath.scaleY * jumpPose.scale.scaleY;
  const jumpLift =
    jumpPose.yOffset + DEFAULT_TUCK.hipRaise * jumpPose.airborneBlend;
  const bodyCx = HERO_CANVAS_SIZE / 2 + frame.x + pose.hipOffset.x;
  const bodyCy =
    HERO_GROUND_Y -
    config.bodyHeight / 2 -
    (config.boneLengths.thigh + config.boneLengths.shin) * 0.9 +
    pose.hipOffset.y +
    jumpLift;
  const jumpScaleY = jumpPose.scale.scaleY;
  const landingDrop = jumpScaleY < 1 ? (1 - jumpScaleY) * config.bodyHeight : 0;
  const effectiveBodyCy = bodyCy + landingDrop;
  return {
    x: bodyCx,
    y: effectiveBodyCy - (config.bodyHeight / 2) * composedScaleY,
  };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderComparison(): void {
  const config = deriveHeroConfig(SEED);

  console.log(
    `Seed ${SEED} | antenna: ${config.antennaSegments} nodes × ${config.antennaSegmentLength.toFixed(2)}px | body ${config.bodyWidth}×${config.bodyHeight}`,
  );

  // Run the three independent simulations.
  const sims = CONDITIONS.map((cond) => ({
    cond,
    frames: runSimulation(cond.bend),
  }));

  // Detect columns from the baseline (row 0). Jump timing is identical across
  // rows (RNG-free jump state machine + identical inputs), so the same tick
  // numbers apply to all three rows.
  const columns = selectColumns(sims[0].frames);
  console.log(`Columns: ${columns.map((c) => `t${c.tick}`).join(', ')}`);

  // Layout.
  const PANEL = 240;
  const LEFT_MARGIN = 116; // room for the row label strip
  const HEADER_H = 76;
  const COL_HEADER_H = 44;
  const sheetW = LEFT_MARGIN + columns.length * PANEL;
  const sheetH = HEADER_H + COL_HEADER_H + CONDITIONS.length * PANEL;

  const canvas = createCanvas(sheetW, sheetH);
  const ctx = canvas.getContext('2d');

  // Full-sheet background.
  ctx.fillStyle = '#0f172a'; // slate-900
  ctx.fillRect(0, 0, sheetW, sheetH);

  // --- Header bar ----------------------------------------------------------
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('Antenna Bend-Resistance A/B/C Comparison (Seed 98724)', 20, 32);
  ctx.fillStyle = '#94a3b8'; // slate-400
  ctx.font = '12px sans-serif';
  ctx.fillText(
    'Rows = bend approach. Columns = jump-landing frames. Bezier renderer (R1) constant across rows. Only the bend function differs.',
    20,
    52,
  );
  ctx.fillText(
    `Stiffness: PROVOT base=0.9 tip=0.65 (production) | ANGULAR base=${ANGULAR_STIFFNESS_BASE} tip=${ANGULAR_STIFFNESS_TIP} | θ₀=π (straight)`,
    20,
    68,
  );

  // --- Column headers ------------------------------------------------------
  ctx.fillStyle = '#e2e8f0'; // slate-200
  ctx.font = 'bold 12px sans-serif';
  columns.forEach((col, ci) => {
    const cx = LEFT_MARGIN + ci * PANEL;
    ctx.save();
    ctx.translate(cx + PANEL / 2, HEADER_H + COL_HEADER_H / 2);
    ctx.textAlign = 'center';
    ctx.fillText(col.label, 0, -4);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText(col.sub, 0, 12);
    ctx.restore();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 12px sans-serif';
  });

  // --- Grid: 3 rows × 6 columns -------------------------------------------
  const ZOOM = 2.2; // tight on the antenna (~36-84px on 320px canvas)

  sims.forEach((sim, ri) => {
    const rowY = HEADER_H + COL_HEADER_H + ri * PANEL;

    // Row label strip (left margin).
    ctx.save();
    ctx.fillStyle = '#1e293b'; // slate-800
    ctx.fillRect(0, rowY, LEFT_MARGIN, PANEL);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, rowY + 0.5, LEFT_MARGIN - 1, PANEL - 1);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.translate(LEFT_MARGIN / 2, rowY + PANEL / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(sim.cond.shortName, 0, 0);
    ctx.rotate(Math.PI / 2);
    ctx.translate(-LEFT_MARGIN / 2, -(rowY + PANEL / 2));
    ctx.fillStyle = '#64748b';
    ctx.font = '10px sans-serif';
    ctx.fillText(sim.cond.name, LEFT_MARGIN / 2, rowY + PANEL - 10);
    ctx.textAlign = 'left';
    ctx.restore();

    columns.forEach((col, ci) => {
      const panelX = LEFT_MARGIN + ci * PANEL;
      const frame = sim.frames[col.tick];

      ctx.save();
      // Clip to the panel.
      ctx.beginPath();
      ctx.rect(panelX, rowY, PANEL, PANEL);
      ctx.clip();

      // Panel background (the hero's palette background).
      ctx.fillStyle = config.palette.background;
      ctx.fillRect(panelX, rowY, PANEL, PANEL);

      // Ground line (only meaningful when grounded, but harmless to draw).
      ctx.strokeStyle = config.palette.outline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(panelX, rowY + HERO_GROUND_Y + 0.5);
      ctx.lineTo(panelX + PANEL, rowY + HERO_GROUND_Y + 0.5);
      ctx.stroke();

      // Zoom + center on the antenna base so the buckling/smoothness is visible.
      const base = antennaBaseForFrame(frame, col.tick, config);
      ctx.save();
      ctx.translate(panelX + PANEL / 2, rowY + PANEL / 2 + 18);
      ctx.scale(ZOOM, ZOOM);
      ctx.translate(-base.x, -base.y);
      drawSlimeKnight(ctx as unknown as CanvasRenderingContext2D, frame, col.tick);
      ctx.restore();

      ctx.restore();

      // Panel border.
      ctx.strokeStyle = '#334155'; // slate-700
      ctx.lineWidth = 1;
      ctx.strokeRect(panelX + 0.5, rowY + 0.5, PANEL - 1, PANEL - 1);
    });
  });

  // --- Save ----------------------------------------------------------------
  mkdirSync('benchmarks', { recursive: true });
  const dest = 'benchmarks/antenna-bend-comparison.png';
  writeFileSync(dest, canvas.toBuffer('image/png'));
  console.log(`Saved comparison sheet to ${dest} (${sheetW}×${sheetH})`);
}

renderComparison();
