import { createCanvas, type CanvasRenderingContext2D } from 'canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createHumanoidVisualState,
  deriveHumanoidConfig,
  drawHumanoid,
} from '../../src/character/humanoid';

const WIDTH = 1200;
const HEIGHT = 820;
const OUTPUT = join(
  'benchmarks',
  'character-body-plans',
  'humanoid-reference-study.png',
);
const colors = {
  background: '#0d0b12',
  panel: '#17131d',
  border: '#3e3348',
  text: '#f4eef7',
  muted: '#aaa0b2',
  cyan: '#40d8d0',
  pink: '#ef78aa',
  gold: '#d8b64b',
  far: '#665c70',
  ground: '#62586d',
};

interface FigurePose {
  readonly head: readonly [number, number];
  readonly shoulder: readonly [number, number];
  readonly hip: readonly [number, number];
  readonly farElbow: readonly [number, number];
  readonly farHand: readonly [number, number];
  readonly nearElbow: readonly [number, number];
  readonly nearHand: readonly [number, number];
  readonly farKnee: readonly [number, number];
  readonly farFoot: readonly [number, number];
  readonly nearKnee: readonly [number, number];
  readonly nearFoot: readonly [number, number];
}

const poses: Record<string, FigurePose> = {
  idle: {
    head: [0, -36], shoulder: [0, -28], hip: [0, -17],
    farElbow: [-5, -22], farHand: [-5, -15],
    nearElbow: [5, -22], nearHand: [5, -15],
    farKnee: [-2, -9], farFoot: [-3, 0],
    nearKnee: [2, -9], nearFoot: [3, 0],
  },
  contact: {
    head: [0, -35], shoulder: [0, -27], hip: [0, -16],
    farElbow: [6, -22], farHand: [9, -16],
    nearElbow: [-5, -21], nearHand: [-9, -16],
    farKnee: [-4, -8], farFoot: [-9, 0],
    nearKnee: [4, -9], nearFoot: [10, 0],
  },
  passing: {
    head: [0, -36], shoulder: [0, -28], hip: [0, -17],
    farElbow: [4, -22], farHand: [7, -16],
    nearElbow: [-4, -23], nearHand: [-7, -17],
    farKnee: [-1, -9], farFoot: [-4, 0],
    nearKnee: [5, -11], nearFoot: [3, -5],
  },
  opposite: {
    head: [0, -35], shoulder: [0, -27], hip: [0, -16],
    farElbow: [-6, -22], farHand: [-9, -16],
    nearElbow: [5, -21], nearHand: [9, -16],
    farKnee: [4, -8], farFoot: [9, 0],
    nearKnee: [-4, -9], nearFoot: [-10, 0],
  },
  ascent: {
    head: [0, -36], shoulder: [0, -28], hip: [0, -17],
    farElbow: [-6, -24], farHand: [-8, -18],
    nearElbow: [6, -24], nearHand: [8, -18],
    farKnee: [-5, -10], farFoot: [-2, -5],
    nearKnee: [5, -10], nearFoot: [2, -5],
  },
  descent: {
    head: [0, -36], shoulder: [0, -28], hip: [0, -17],
    farElbow: [-5, -22], farHand: [-5, -15],
    nearElbow: [5, -22], nearHand: [5, -15],
    farKnee: [-3, -9], farFoot: [-4, -2],
    nearKnee: [3, -8], nearFoot: [5, -1],
  },
};

function line(
  ctx: CanvasRenderingContext2D,
  a: readonly [number, number],
  b: readonly [number, number],
  color: string,
  width = 3,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

function drawFigure(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  pose: FigurePose,
  scale = 1.4,
): void {
  ctx.save();
  ctx.translate(x, groundY);
  ctx.scale(scale, scale);
  line(ctx, pose.shoulder, pose.farElbow, colors.far);
  line(ctx, pose.farElbow, pose.farHand, colors.far);
  line(ctx, pose.hip, pose.farKnee, colors.far);
  line(ctx, pose.farKnee, pose.farFoot, colors.far);
  ctx.fillStyle = colors.cyan;
  ctx.strokeStyle = '#171419';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-5, -31, 10, 15, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.gold;
  ctx.beginPath();
  ctx.arc(pose.head[0], pose.head[1], 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  line(ctx, pose.shoulder, pose.nearElbow, colors.pink);
  line(ctx, pose.nearElbow, pose.nearHand, colors.pink);
  line(ctx, pose.hip, pose.nearKnee, colors.cyan);
  line(ctx, pose.nearKnee, pose.nearFoot, colors.cyan);
  ctx.restore();
}

function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  subtitle: string,
): void {
  ctx.fillStyle = colors.panel;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = colors.border;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.fillStyle = colors.text;
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(title, x + 12, y + 23);
  ctx.fillStyle = colors.muted;
  ctx.font = '11px sans-serif';
  ctx.fillText(subtitle, x + 12, y + 41);
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(' ');
  let lineText = '';
  let lineY = y;
  for (const word of words) {
    const next = lineText ? `${lineText} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && lineText) {
      ctx.fillText(lineText, x, lineY);
      lineText = word;
      lineY += lineHeight;
    } else {
      lineText = next;
    }
  }
  if (lineText) ctx.fillText(lineText, x, lineY);
}

function drawStrategyIcon(
  ctx: CanvasRenderingContext2D,
  kind: 'minimal' | 'iconic' | 'mass' | 'articulated',
  x: number,
  y: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  if (kind === 'mass') {
    ctx.fillStyle = colors.text;
    ctx.beginPath();
    ctx.arc(0, -28, 7, 0, Math.PI * 2);
    ctx.fill();
    line(ctx, [-5, -33], [-10, -40], colors.text, 3);
    line(ctx, [5, -33], [10, -40], colors.text, 3);
    ctx.fillStyle = colors.far;
    ctx.beginPath();
    ctx.moveTo(-11, -23);
    ctx.lineTo(11, -23);
    ctx.lineTo(7, -2);
    ctx.lineTo(-7, -2);
    ctx.closePath();
    ctx.fill();
    line(ctx, [-4, -2], [-4, 0], colors.pink, 3);
    line(ctx, [4, -2], [4, 0], colors.cyan, 3);
  } else if (kind === 'minimal') {
    ctx.fillStyle = colors.pink;
    ctx.fillRect(-5, -30, 10, 20);
    ctx.fillStyle = colors.gold;
    ctx.fillRect(-4, -38, 8, 8);
    line(ctx, [-2, -10], [-4, 0], colors.text, 2);
    line(ctx, [2, -10], [5, 0], colors.text, 2);
    line(ctx, [4, -35], [13, -30], colors.pink, 3);
  } else if (kind === 'iconic') {
    ctx.fillStyle = colors.cyan;
    ctx.fillRect(-7, -28, 14, 17);
    ctx.fillStyle = colors.gold;
    ctx.fillRect(-6, -38, 12, 10);
    line(ctx, [-5, -11], [-6, 0], colors.pink, 4);
    line(ctx, [5, -11], [6, 0], colors.cyan, 4);
    line(ctx, [5, -24], [12, -14], colors.gold, 4);
  } else {
    drawFigure(ctx, 0, 0, poses.contact, 0.95);
  }
  ctx.restore();
}

const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
ctx.fillStyle = colors.background;
ctx.fillRect(0, 0, WIDTH, HEIGHT);
ctx.fillStyle = colors.text;
ctx.font = 'bold 24px sans-serif';
ctx.fillText('Humanoid visual-strategy study · pose hypotheses', 24, 34);
ctx.fillStyle = colors.muted;
ctx.font = '12px sans-serif';
ctx.fillText(
  'Strategy observations are sourced · skeleton poses below are unmeasured working hypotheses',
  24,
  54,
);

const strategies = [
  ['Celeste', 'minimal', 'State and direction read before anatomy.'],
  ['Shovel Knight', 'iconic', 'Quiet idle; simplify detail for readability.'],
  ['Hollow Knight', 'mass', 'Head/cloak mass dominates subordinate limbs.'],
  ['Dead Cells', 'articulated', 'Skeleton-driven, pose-first motion near 50 px.'],
] as const;
strategies.forEach(([title, kind, note], index) => {
  const x = 24 + index * 290;
  panel(ctx, x, 76, 272, 142, title, 'reference strategy abstraction');
  drawStrategyIcon(ctx, kind, x + 65, 202);
  ctx.fillStyle = colors.muted;
  ctx.font = '11px sans-serif';
  wrap(ctx, note, x + 116, 150, 140, 15);
});

ctx.fillStyle = colors.text;
ctx.font = 'bold 17px sans-serif';
ctx.fillText('Working grammar hypothesis: articulated-minimal three-quarter profile', 24, 254);
ctx.fillStyle = colors.muted;
ctx.font = '11px sans-serif';
ctx.fillText(
  'Far limbs recede · near limbs lead · quiet neutral · asymmetric action · one canonical pose mirrors horizontally',
  24,
  273,
);

const keyPoses = [
  ['neutral idle', poses.idle],
  ['contact', poses.contact],
  ['passing', poses.passing],
  ['opposite contact', poses.opposite],
  ['ascent', poses.ascent],
  ['descent / prepare', poses.descent],
] as const;
keyPoses.forEach(([label, pose], index) => {
  const x = 24 + index * 192;
  panel(ctx, x, 292, 176, 196, label, 'unvalidated pose hypothesis');
  ctx.strokeStyle = colors.ground;
  ctx.beginPath();
  ctx.moveTo(x + 16, 466.5);
  ctx.lineTo(x + 160, 466.5);
  ctx.stroke();
  drawFigure(ctx, x + 88, 466, pose);
});

panel(ctx, 24, 512, 730, 278, 'Provisional checks', 'not a source-derived pose baseline');
const rules = [
  'Idle uses a dedicated neutral pose; gait phase never defines zero-speed anatomy.',
  'Feet and knees remain on their own sides; body center stays inside the support interval.',
  'Neutral hands hang below the pelvis; shoulder-to-hand reach exceeds 90% of arm length.',
  'Contact, passing, and opposite contact are named and inspected—not arbitrary phase samples.',
  'Passive arms oppose the legs; explicit targeting affects only the intended arm.',
  'Ascent/apex/descent silhouettes keep both feet visibly off the ground.',
  'Validate at 32×48, 16×24, and 8×12; far limbs must remain subordinate.',
];
ctx.font = '12px sans-serif';
rules.forEach((rule, index) => {
  const y = 565 + index * 29;
  ctx.fillStyle = index < 3 ? colors.cyan : colors.text;
  ctx.beginPath();
  ctx.arc(45, y - 4, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors.muted;
  ctx.fillText(rule, 58, y);
});

panel(ctx, 774, 512, 402, 278, 'Current renderer against baseline', 'neutral production output at three scales');
ctx.strokeStyle = colors.ground;
ctx.beginPath();
ctx.moveTo(795, 720.5);
ctx.lineTo(1155, 720.5);
ctx.stroke();
const config = deriveHumanoidConfig(1);
const state = createHumanoidVisualState(config);
drawHumanoid(ctx, { x: 830, y: 662, width: 32, height: 48, facing: 1 }, config, state, 0);
drawHumanoid(ctx, { x: 930, y: 686, width: 16, height: 24, facing: 1 }, config, state, 0);
drawHumanoid(ctx, { x: 1000, y: 698, width: 8, height: 12, facing: 1 }, config, state, 0);
ctx.fillStyle = colors.text;
ctx.font = 'bold 11px sans-serif';
ctx.fillText('32×48', 825, 744);
ctx.fillText('16×24', 922, 744);
ctx.fillText('8×12', 993, 744);
ctx.fillStyle = colors.muted;
ctx.font = '11px sans-serif';
wrap(
  ctx,
  'Static neutral now passes. Permanent validation still needs named gait phases and an explicit landing pose.',
  1048,
  649,
  108,
  15,
);

mkdirSync(join('benchmarks', 'character-body-plans'), { recursive: true });
const first = canvas.toBuffer('image/png');
const repeat = canvas.toBuffer('image/png');
if (!first.equals(repeat)) {
  throw new Error('humanoid reference study is not byte-deterministic');
}
writeFileSync(OUTPUT, first);
console.log(`ok ${OUTPUT} ${(first.byteLength / 1024).toFixed(1)} KB`);
