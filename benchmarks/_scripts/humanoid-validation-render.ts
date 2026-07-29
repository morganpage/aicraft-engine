import { createCanvas, type Canvas } from 'canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  deriveHeroConfig,
  createHeroFrameState,
  drawSlimeKnight,
} from '../../showcase/helpers/slime-knight';
import {
  deriveHumanoidConfig,
  type HumanoidConfig,
} from '../../showcase/_prototype/character-enemy-validation/humanoid-config';
import {
  advanceHumanoidVisual,
  createHumanoidVisualState,
  type HumanoidMotionSample,
} from '../../showcase/_prototype/character-enemy-validation/humanoid-state';
import { drawHumanoid } from '../../showcase/_prototype/character-enemy-validation/humanoid-draw';

const OUTPUT_DIR = 'benchmarks/character-body-plans';
const OUTPUT_FILE = join(OUTPUT_DIR, 'humanoid-prototype.png');
const WIDTH = 960;
const HEIGHT = 560;
const BACKGROUND = '#0d0b12';
const PANEL = '#18131f';
const BORDER = '#3d3149';
const TEXT = '#f3edf7';
const MUTED = '#a79caf';

interface PoseSpec {
  readonly label: string;
  readonly seed: number;
  readonly motion: Partial<HumanoidMotionSample>;
  readonly phaseSteps?: number;
  readonly facing?: 1 | -1;
  readonly grayscale?: boolean;
}

function ctx2d(canvas: Canvas): CanvasRenderingContext2D {
  return canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
}

function sample(
  config: HumanoidConfig,
  spec: PoseSpec,
): ReturnType<typeof createHumanoidVisualState> {
  let state = createHumanoidVisualState(config);
  const base: HumanoidMotionSample = {
    dx: 0,
    facing: spec.facing ?? 1,
    supported: true,
    gravityDirection: 1,
    verticalVelocity: 0,
    justLaunched: false,
    justLanded: false,
    hitCeiling: false,
    ...spec.motion,
  };
  const steps = spec.phaseSteps ?? 1;
  for (let index = 0; index < steps; index += 1) {
    state = advanceHumanoidVisual(config, state, base, 1 / 60);
  }
  return state;
}

function grayscale(config: HumanoidConfig): HumanoidConfig {
  return {
    ...config,
    palette: {
      outline: '#171419',
      base: '#8e8a92',
      accent: '#bcb7c1',
      feature: '#f1edf4',
      background: '#302b34',
    },
  };
}

function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  spec: PoseSpec,
): void {
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = BORDER;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.fillStyle = TEXT;
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText(spec.label, x + 10, y + 18);
  ctx.fillStyle = MUTED;
  ctx.font = '10px sans-serif';
  ctx.fillText(`seed ${spec.seed}`, x + 10, y + 33);
  ctx.strokeStyle = '#655b70';
  ctx.beginPath();
  ctx.moveTo(x + 15, y + height - 20.5);
  ctx.lineTo(x + width - 15, y + height - 20.5);
  ctx.stroke();

  let config = deriveHumanoidConfig(spec.seed);
  if (spec.grayscale) config = grayscale(config);
  const state = sample(config, spec);
  drawHumanoid(
    ctx,
    {
      x: x + width / 2 - 16,
      y: y + height - 20 - 48,
      width: 32,
      height: 48,
      facing: spec.facing ?? 1,
    },
    config,
    state,
    42,
    spec.motion.armTarget
      ? { lookTarget: spec.motion.armTarget }
      : undefined,
  );
}

function renderSheet(): Canvas {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = ctx2d(canvas);
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = TEXT;
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('Humanoid body-plan validation', 20, 30);
  ctx.fillStyle = MUTED;
  ctx.font = '12px sans-serif';
  ctx.fillText(
    'seed variation · displacement gait · signed-gravity poses · silhouette comparison',
    20,
    50,
  );

  const specs: readonly PoseSpec[] = [
    { label: 'idle', seed: 1, motion: {} },
    { label: 'mid stride', seed: 1, motion: { dx: 5 }, phaseSteps: 5 },
    { label: 'opposite stride', seed: 1, motion: { dx: 5 }, phaseSteps: 15 },
    {
      label: 'ascent',
      seed: 42,
      motion: { supported: false, verticalVelocity: -120, justLaunched: true },
    },
    {
      label: 'apex',
      seed: 42,
      motion: { supported: false, verticalVelocity: 0 },
    },
    {
      label: 'descent',
      seed: 42,
      motion: { supported: false, verticalVelocity: 120 },
    },
    { label: 'left-facing', seed: 99, motion: { dx: -5, facing: -1 }, facing: -1, phaseSteps: 8 },
    {
      label: 'arm target',
      seed: 99,
      motion: { armTarget: { x: 780, y: 330 } },
    },
    { label: 'grayscale', seed: 7, motion: { dx: 4 }, phaseSteps: 8, grayscale: true },
    {
      label: 'ceiling-gravity ascent',
      seed: 7,
      motion: { supported: false, gravityDirection: -1, verticalVelocity: 100 },
    },
  ];
  const columns = 5;
  const cellWidth = 176;
  const cellHeight = 205;
  specs.forEach((spec, index) => {
    panel(
      ctx,
      20 + (index % columns) * (cellWidth + 8),
      70 + Math.floor(index / columns) * (cellHeight + 8),
      cellWidth,
      cellHeight,
      spec,
    );
  });

  const y = 500;
  ctx.fillStyle = TEXT;
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('small-scale silhouettes', 20, y);
  for (let index = 0; index < 3; index += 1) {
    const config = deriveHumanoidConfig([1, 42, 99][index]);
    drawHumanoid(
      ctx,
      { x: 165 + index * 34, y: y - 18, width: 8, height: 12, facing: 1 },
      config,
      createHumanoidVisualState(config),
      0,
    );
  }

  ctx.fillStyle = TEXT;
  ctx.fillText('slime-knight scale reference', 500, y);
  const heroConfig = deriveHeroConfig(42);
  const hero = createHeroFrameState(heroConfig);
  ctx.save();
  ctx.translate(730 - 160 * 0.16, y - 262 * 0.16);
  ctx.scale(0.16, 0.16);
  drawSlimeKnight(ctx, hero, 0);
  ctx.restore();
  return canvas;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const first = renderSheet().toBuffer('image/png');
const second = renderSheet().toBuffer('image/png');
if (!first.equals(second)) {
  throw new Error('humanoid benchmark is not byte-deterministic');
}
writeFileSync(OUTPUT_FILE, first);
console.log(`ok ${OUTPUT_FILE} ${(first.byteLength / 1024).toFixed(1)} KB`);
