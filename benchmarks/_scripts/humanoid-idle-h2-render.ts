import { createCanvas, type Canvas } from 'canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  advanceHumanoidVisual,
  createHumanoidVisualState,
  deriveHumanoidConfig,
  drawHumanoid,
  type HumanoidConfig,
  type HumanoidMotionSample,
  type HumanoidVisualState,
} from '../../src/character/humanoid';
import { composePose } from '../../src/character/humanoid/pose';

/**
 * Phase H2 idle-sheet renderer.
 *
 * Produces a labelled grid PNG covering every cell the humanoid visual-revision
 * plan's Phase H2 requires for the idle review gate:
 *   - both facings (right / left);
 *   - three proportion-varied seeds (min / median / max body height over a
 *     deterministic seed scan);
 *   - colour and grayscale;
 *   - the three required scales (32x48, 16x24, 8x12);
 *   - an enlarged skeleton/landmark overlay (canonical right-facing) with
 *     near/far colour-coded landmarks, the three-quarter torso polygon, and the
 *     face-direction/eye marker.
 *
 * Each character cell renders through the public {@link drawHumanoid} driven by
 * an idle {@link HumanoidVisualState} (dx === 0, grounded, zero vertical
 * velocity), so it exercises the idle path of {@link composePose}.
 *
 * Deterministic: no Math.random / Date.now; the script renders twice and
 * asserts byte-identical PNG output before writing.
 */
const OUTPUT_DIR = 'benchmarks/character-body-plans';
const OUTPUT_FILE = join(OUTPUT_DIR, 'humanoid-idle-h2.png');
const WIDTH = 1080;
const HEIGHT = 1340;
const MARGIN = 16;
const GAP = 8;
const SECTION_GAP = 22;
const GROUND_MARGIN = 22;
const TICK = 0;

const COLORS = {
  background: '#0d0b12',
  panel: '#18131f',
  border: '#3d3149',
  text: '#f3edf7',
  muted: '#a79caf',
  ground: '#62586d',
  frameRect: '#4a3f55',
  near: '#ff8a3d',
  far: '#4aa8ff',
  torso: '#d8b64b',
  head: '#f4eef7',
  eye: '#ff5d7a',
  support: '#7bd88f',
  centre: '#c79cff',
} as const;

const GRAYSCALE_PALETTE = {
  outline: '#171419',
  base: '#8e8a92',
  accent: '#bcb7c1',
  feature: '#f1edf4',
  background: '#302b34',
} as const;

const FACINGS: readonly (1 | -1)[] = [1, -1];
const MODES = ['colour', 'grayscale'] as const;
type Mode = (typeof MODES)[number];

function ctx2d(canvas: Canvas): CanvasRenderingContext2D {
  return canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
}

/**
 * Build an idle visual state by advancing one tick with an idle motion sample
 * (dx === 0, grounded support, zero vertical velocity). Mirrors the validation
 * render's idle sampling so the idle path of `composePose` is actually reached.
 */
function idleState(config: HumanoidConfig, facing: 1 | -1): HumanoidVisualState {
  const motion: HumanoidMotionSample = {
    dx: 0,
    facing,
    supported: true,
    gravityDirection: 1,
    verticalVelocity: 0,
    justLaunched: false,
    justLanded: false,
    hitCeiling: false,
  };
  return advanceHumanoidVisual(
    config,
    createHumanoidVisualState(config),
    motion,
    1 / 60,
  );
}

function grayscaleConfig(config: HumanoidConfig): HumanoidConfig {
  return { ...config, palette: { ...config.palette, ...GRAYSCALE_PALETTE } };
}

interface SeedPick {
  readonly label: string;
  readonly seed: number;
}

/**
 * Deterministically select three proportion-varied seeds by scanning seeds
 * 0..199 and picking the min / median / max body height (crown-to-foot) of the
 * resolved idle pose. Guarantees the sheet visibly exercises proportion
 * variation rather than three similar random builds.
 */
function pickRepresentativeSeeds(): SeedPick[] {
  const samples: { seed: number; h: number }[] = [];
  for (let seed = 0; seed < 200; seed += 1) {
    const config = deriveHumanoidConfig(seed);
    const state = createHumanoidVisualState(config);
    const pose = composePose(state, config);
    samples.push({ seed, h: -pose.head.crown.y });
  }
  samples.sort((a, b) => a.h - b.h);
  const short = samples[0];
  const tall = samples[samples.length - 1];
  const nominal = samples[Math.floor(samples.length / 2)];
  return [
    { label: `short · seed ${short.seed} (H=${short.h.toFixed(1)})`, seed: short.seed },
    { label: `nominal · seed ${nominal.seed} (H=${nominal.h.toFixed(1)})`, seed: nominal.seed },
    { label: `tall · seed ${tall.seed} (H=${tall.h.toFixed(1)})`, seed: tall.seed },
  ];
}

function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function sectionTitle(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
): void {
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText(text, x, y);
}

function groundLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
): void {
  ctx.strokeStyle = COLORS.ground;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 12, y + 0.5);
  ctx.lineTo(x + w - 12, y + 0.5);
  ctx.stroke();
}

interface CharCellSpec {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly facing: 1 | -1;
  readonly config: HumanoidConfig;
  readonly state: HumanoidVisualState;
  readonly line1: string;
  readonly line2: string;
  readonly bodyW: number;
  readonly bodyH: number;
  readonly frameRect: boolean;
}

function drawCharCell(
  ctx: CanvasRenderingContext2D,
  s: CharCellSpec,
): void {
  panel(ctx, s.x, s.y, s.w, s.h);
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText(s.line1, s.x + 10, s.y + 17);
  ctx.fillStyle = COLORS.muted;
  ctx.font = '10px sans-serif';
  ctx.fillText(s.line2, s.x + 10, s.y + 31);
  const groundY = s.y + s.h - GROUND_MARGIN;
  groundLine(ctx, s.x, groundY, s.w);
  const bx = s.x + s.w / 2 - s.bodyW / 2;
  const by = groundY - s.bodyH;
  if (s.frameRect) {
    ctx.strokeStyle = COLORS.frameRect;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, s.bodyW - 1, s.bodyH - 1);
  }
  drawHumanoid(
    ctx,
    { x: bx, y: by, width: s.bodyW, height: s.bodyH, facing: s.facing },
    s.config,
    s.state,
    TICK,
  );
}

function overlayBone(
  ctx: CanvasRenderingContext2D,
  root: Readonly<{ x: number; y: number }>,
  joint: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>,
  color: string,
  width: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(root.x, root.y);
  ctx.lineTo(joint.x, joint.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
}

function overlayDot(
  ctx: CanvasRenderingContext2D,
  p: Readonly<{ x: number; y: number }>,
  fill: string,
  r: number,
): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = COLORS.background;
  ctx.lineWidth = 0.15;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/**
 * Enlarged skeleton/landmark overlay for one seed: far limbs (cool), near limbs
 * (warm), the three-quarter torso polygon, the head circle + crown + face-
 * direction/eye marker, the support-base segment, and the centre-of-mass dot.
 */
function drawOverlayCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  config: HumanoidConfig,
  seedLabel: string,
): void {
  panel(ctx, x, y, w, h);
  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText(`skeleton · ${seedLabel}`, x + 12, y + 20);
  ctx.fillStyle = COLORS.muted;
  ctx.font = '10px sans-serif';
  ctx.fillText('canonical right-facing · near=warm · far=cool', x + 12, y + 34);

  const pose = composePose(createHumanoidVisualState(config), config);
  const scale = 9;
  const groundY = y + h - 40;
  const cx = x + w / 2;
  const pelvisX = pose.torso.bottomCentre.x;

  ctx.strokeStyle = COLORS.ground;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 14, groundY + 0.5);
  ctx.lineTo(x + w - 14, groundY + 0.5);
  ctx.stroke();

  ctx.save();
  ctx.translate(cx - pelvisX * scale, groundY);
  ctx.scale(scale, scale);

  ctx.strokeStyle = COLORS.support;
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  ctx.moveTo(pose.farLeg.end.x, 0);
  ctx.lineTo(pose.nearLeg.end.x, 0);
  ctx.stroke();
  overlayDot(ctx, pose.torso.bottomCentre, COLORS.centre, 0.45);

  ctx.fillStyle = 'rgba(216,182,75,0.10)';
  ctx.strokeStyle = COLORS.torso;
  ctx.lineWidth = 0.25;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pose.torso.topFar.x, pose.torso.topFar.y);
  ctx.lineTo(pose.torso.topNear.x, pose.torso.topNear.y);
  ctx.lineTo(pose.torso.bottomNear.x, pose.torso.bottomNear.y);
  ctx.lineTo(pose.torso.bottomFar.x, pose.torso.bottomFar.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  overlayBone(
    ctx,
    pose.farLeg.root,
    pose.farLeg.joint,
    pose.farLeg.end,
    COLORS.far,
    0.55,
  );
  overlayBone(
    ctx,
    pose.farArm.root,
    pose.farArm.joint,
    pose.farArm.end,
    COLORS.far,
    0.5,
  );
  overlayBone(
    ctx,
    pose.nearLeg.root,
    pose.nearLeg.joint,
    pose.nearLeg.end,
    COLORS.near,
    0.6,
  );
  overlayBone(
    ctx,
    pose.nearArm.root,
    pose.nearArm.joint,
    pose.nearArm.end,
    COLORS.near,
    0.55,
  );

  ctx.fillStyle = 'rgba(244,238,247,0.12)';
  ctx.strokeStyle = COLORS.head;
  ctx.lineWidth = 0.22;
  ctx.beginPath();
  ctx.arc(pose.head.centre.x, pose.head.centre.y, config.headRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  overlayDot(ctx, pose.head.crown, COLORS.head, 0.28);
  overlayDot(ctx, pose.head.eye, COLORS.eye, 0.4);

  overlayDot(ctx, pose.nearLeg.root, COLORS.near, 0.4);
  overlayDot(ctx, pose.nearLeg.joint, COLORS.near, 0.4);
  overlayDot(ctx, pose.nearLeg.end, COLORS.near, 0.4);
  overlayDot(ctx, pose.nearArm.root, COLORS.near, 0.38);
  overlayDot(ctx, pose.nearArm.joint, COLORS.near, 0.38);
  overlayDot(ctx, pose.nearArm.end, COLORS.near, 0.38);
  overlayDot(ctx, pose.farLeg.root, COLORS.far, 0.4);
  overlayDot(ctx, pose.farLeg.joint, COLORS.far, 0.4);
  overlayDot(ctx, pose.farLeg.end, COLORS.far, 0.4);
  overlayDot(ctx, pose.farArm.root, COLORS.far, 0.38);
  overlayDot(ctx, pose.farArm.joint, COLORS.far, 0.38);
  overlayDot(ctx, pose.farArm.end, COLORS.far, 0.38);

  ctx.restore();
}

function render(seeds: readonly SeedPick[]): Canvas {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = COLORS.text;
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('Humanoid idle sheet · Phase H2 visual review', MARGIN, 32);
  ctx.fillStyle = COLORS.muted;
  ctx.font = '12px sans-serif';
  ctx.fillText(
    'idle (dx=0, grounded) · both facings · 3 proportion seeds · 3 scales · colour + grayscale · enlarged skeleton overlay',
    MARGIN,
    52,
  );

  let cursorY = 70;

  // Section A — colour + grayscale × both facings × 3 seeds (32×48).
  sectionTitle(
    ctx,
    'A · Idle body · colour + grayscale · both facings · 3 seeds · 32×48',
    MARGIN,
    cursorY + 16,
  );
  cursorY += 24;
  const aCols = 6;
  const aCellW = Math.floor((WIDTH - 2 * MARGIN - (aCols - 1) * GAP) / aCols);
  const aCellH = 176;
  ctx.fillStyle = COLORS.muted;
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('COLOUR', MARGIN + 4, cursorY + 12);
  ctx.fillText('GRAYSCALE', MARGIN + 4 + (aCellW + GAP) * 3, cursorY + 12);
  cursorY += 18;
  FACINGS.forEach((facing, row) => {
    MODES.forEach((mode, mgroup) => {
      seeds.forEach((seedPick, col) => {
        const cellX = MARGIN + (mgroup * 3 + col) * (aCellW + GAP);
        const baseConfig = deriveHumanoidConfig(seedPick.seed);
        const config = mode === 'grayscale' ? grayscaleConfig(baseConfig) : baseConfig;
        const state = idleState(baseConfig, facing);
        const facingName = facing === 1 ? 'right' : 'left';
        const facingArrow = facing === 1 ? '→' : '←';
        drawCharCell(ctx, {
          x: cellX,
          y: cursorY + row * (aCellH + GAP),
          w: aCellW,
          h: aCellH,
          facing,
          config,
          state,
          line1: `${facingArrow} ${facingName} · ${mode}`,
          line2: seedPick.label,
          bodyW: 32,
          bodyH: 48,
          frameRect: false,
        });
      });
    });
  });
  cursorY += 2 * (aCellH + GAP) - GAP + SECTION_GAP;

  // Section B — scale sweep, nominal seed, both facings.
  const nominalSeed = seeds[1].seed;
  sectionTitle(
    ctx,
    'B · Idle scale sweep · 32×48 · 16×24 · 8×12 · nominal seed · both facings',
    MARGIN,
    cursorY + 16,
  );
  cursorY += 24;
  const bScales = [
    { label: '32 × 48', bodyW: 32, bodyH: 48 },
    { label: '16 × 24', bodyW: 16, bodyH: 24 },
    { label: '8 × 12', bodyW: 8, bodyH: 12 },
  ] as const;
  const bCols = 3;
  const bCellW = Math.floor((WIDTH - 2 * MARGIN - (bCols - 1) * GAP) / bCols);
  const bCellH = 180;
  FACINGS.forEach((facing, row) => {
    bScales.forEach((sc, col) => {
      const cellX = MARGIN + col * (bCellW + GAP);
      const config = deriveHumanoidConfig(nominalSeed);
      const state = idleState(config, facing);
      const facingName = facing === 1 ? 'right' : 'left';
      const facingArrow = facing === 1 ? '→' : '←';
      drawCharCell(ctx, {
        x: cellX,
        y: cursorY + row * (bCellH + GAP),
        w: bCellW,
        h: bCellH,
        facing,
        config,
        state,
        line1: `${facingArrow} ${facingName} · ${sc.label}`,
        line2: `nominal · seed ${nominalSeed}`,
        bodyW: sc.bodyW,
        bodyH: sc.bodyH,
        frameRect: true,
      });
    });
  });
  cursorY += 2 * (bCellH + GAP) - GAP + SECTION_GAP;

  // Section C — enlarged skeleton/landmark overlay (canonical right-facing).
  sectionTitle(
    ctx,
    'C · Skeleton / landmark overlay · canonical right-facing · near=warm far=cool · torso polygon + face-direction marker',
    MARGIN,
    cursorY + 16,
  );
  cursorY += 24;
  const cCols = 3;
  const cCellW = Math.floor((WIDTH - 2 * MARGIN - (cCols - 1) * GAP) / cCols);
  const cCellH = 360;
  seeds.forEach((seedPick, col) => {
    const cellX = MARGIN + col * (cCellW + GAP);
    const config = deriveHumanoidConfig(seedPick.seed);
    drawOverlayCell(ctx, cellX, cursorY, cCellW, cCellH, config, seedPick.label);
  });

  return canvas;
}

const SEEDS = pickRepresentativeSeeds();
console.log(
  'representative seeds:\n  ' +
    SEEDS.map((s) => s.label).join('\n  '),
);

mkdirSync(OUTPUT_DIR, { recursive: true });
const first = render(SEEDS).toBuffer('image/png');
const repeat = render(SEEDS).toBuffer('image/png');
if (!first.equals(repeat)) {
  throw new Error('humanoid idle H2 sheet is not byte-deterministic');
}
writeFileSync(OUTPUT_FILE, first);
console.log(`ok ${OUTPUT_FILE} ${(first.byteLength / 1024).toFixed(1)} KB`);
