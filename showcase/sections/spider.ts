/**
 * Section 5 — Spider (procedural legs).
 *
 * Live-animated showcase of the library's procedural spider module
 * (`src/animation/spider/`). Four spiders on a dark stage with a visible
 * tile-grid floor:
 *
 * - One **coordinated-gait** walker (default purple palette, 1.2× scale)
 *   pacing left↔right.
 * - One **frantic-gait** scuttler (default palette, 0.7× scale, faster)
 *   pacing left↔right.
 * - One **sickly green** palette variant (1.0× scale, idle/slow).
 * - One **blood red** palette variant (1.0× scale, idle/slow).
 *
 * Per-spider `jitterSeed` is derived from a fixed constant — no Math.random.
 * The pacing/wall-bounce is deterministic from tick + initial conditions.
 *
 * Controls: a gait-toggle button (coordinated ↔ frantic for all walking
 * spiders) and a speed slider. Motion-gated: reduced-motion renders one
 * static frame and skips the loop. No keyboard input — no
 * IntersectionObserver needed.
 */

import {
  createSpiderState,
  stepSpider,
  evaluateSpiderPose,
  drawSpider,
  DEFAULT_SPIDER,
  DEFAULT_SPIDER_PALETTE,
  type SpiderConfig,
  type SpiderState,
  type SpiderPalette,
} from '../../src/animation/spider';
import { shade } from '../../src/primitives';
import { resizeCanvasToBackingStore } from '../../src/primitives';
import { createGameLoop, type GameLoop } from '../../src/game-loop';
import { shouldAnimate } from '../helpers/motion-gate';
import type { TileSolidityQuery } from '../../src/collision/types';
import type { Store } from '../store';
import type { GlobalState } from '../main';
import {
  createShowcaseSpiderLanes,
  groundShowcaseSpiderState,
  scaleShowcaseSpiderConfig,
  tuneShowcaseSpiderSpeed,
} from './spider-config';

const DT = 1 / 60;

const CANVAS_W = 960;
const CANVAS_H = 360;
const TILE_SIZE = 16;
const FLOOR_Y = 224;

const WALK_SPEED = 90;

interface SpiderInstance {
  readonly baseConfig: SpiderConfig;
  config: SpiderConfig;
  state: SpiderState;
  bodyX: number;
  bodyY: number;
  vx: number;
  facing: 1 | -1;
  readonly baseVx: number;
  readonly jitterSeed: number;
  readonly laneMin: number;
  readonly laneMax: number;
}

function makeFloorQuery(floorY: number): TileSolidityQuery {
  return (_tileX: number, tileY: number) => {
    const worldY = tileY * TILE_SIZE;
    return worldY >= floorY ? 'solid' : 'empty';
  };
}

function makeGreenPalette(): SpiderPalette {
  return {
    ...DEFAULT_SPIDER_PALETTE,
    cephFill: '#2d5a2d',
    abdFill: '#1e4a1e',
    legFg: '#3d7a3d',
    legBg: '#264226',
    eyeFill: '#ffff22',
    cheliceraeFill: '#1a3d1a',
    palpFill: '#3d7a3d',
    outline: shade('#0d1f0d', 1.4),
  };
}

function makeRedPalette(): SpiderPalette {
  return {
    ...DEFAULT_SPIDER_PALETTE,
    cephFill: '#6b2d2d',
    abdFill: '#582424',
    legFg: '#8a3d3d',
    legBg: '#552424',
    eyeFill: '#ffaa00',
    cheliceraeFill: '#3d1a1a',
    palpFill: '#8a3d3d',
    outline: shade('#280d0d', 1.4),
  };
}

function tintPalette(base: SpiderPalette, factor: number): SpiderPalette {
  return {
    cephFill: shade(base.cephFill, factor),
    abdFill: shade(base.abdFill, factor),
    legFg: shade(base.legFg, factor),
    legBg: shade(base.legBg, factor),
    eyeFill: base.eyeFill,
    cheliceraeFill: shade(base.cheliceraeFill, factor),
    palpFill: shade(base.palpFill, factor),
    outline: base.outline,
  };
}

function createInstanceDefs(
  overshoot: number,
  comfort: number,
  stepDur: number,
  stepHeight: number,
): readonly {
  readonly baseConfig: SpiderConfig;
  readonly config: SpiderConfig;
  readonly startX: number;
  readonly vx: number;
  readonly jitterSeed: number;
  readonly laneMin: number;
  readonly laneMax: number;
}[] {
  const green = makeGreenPalette();
  const red = makeRedPalette();
  const speeds = [WALK_SPEED, WALK_SPEED * 0.8, 15, 0];
  const baseConfigs = [
    scaleShowcaseSpiderConfig({
      ...DEFAULT_SPIDER,
      mode: 'coordinated',
      stepDuration: stepDur,
      phaseAdvanceRate: 0.16,
      overshootFactor: overshoot,
      comfortRadius: comfort,
      stepHeight,
      palette: tintPalette(DEFAULT_SPIDER_PALETTE, 1.15),
    }, 1.2),
    scaleShowcaseSpiderConfig({
      ...DEFAULT_SPIDER,
      mode: 'frantic',
      stepDuration: Math.max(0.1, stepDur * 0.78),
      comfortRadius: Math.max(6, comfort * 1.4),
      overshootFactor: overshoot,
      stepHeight,
    }, 0.7),
    scaleShowcaseSpiderConfig({
      ...DEFAULT_SPIDER,
      mode: 'coordinated',
      overshootFactor: overshoot,
      comfortRadius: comfort,
      stepHeight,
      palette: green,
    }, 1),
    scaleShowcaseSpiderConfig({
      ...DEFAULT_SPIDER,
      mode: 'coordinated',
      overshootFactor: overshoot,
      comfortRadius: comfort,
      stepHeight,
      palette: red,
    }, 1),
  ];
  const lanes = createShowcaseSpiderLanes(baseConfigs, CANVAS_W);

  return baseConfigs.map((baseConfig, index) => ({
    baseConfig,
    config: tuneShowcaseSpiderSpeed(baseConfig, speeds[index]),
    startX: lanes[index].center,
    vx: speeds[index],
    jitterSeed: [42, 101, 202, 303][index],
    laneMin: index === 3 ? lanes[index].center : lanes[index].min,
    laneMax: index === 3 ? lanes[index].center : lanes[index].max,
  }));
}

/**
 * Initialize the spider section.
 *
 * @param container - the `<section id="spider">` element
 * @param store - the global observable store
 */
export function initSpider(container: HTMLElement, store: Store<GlobalState>): void {
  void store;

  const canvas = container.querySelector<HTMLCanvasElement>('.spider-canvas')!;
  const ctx = canvas.getContext('2d')!;
  const dpr = resizeCanvasToBackingStore(canvas, CANVAS_W, CANVAS_H);
  ctx.scale(dpr, dpr);

  const gaitBtn = container.querySelector<HTMLButtonElement>('.spider-gait')!;
  const speedSlider = container.querySelector<HTMLInputElement>('.spider-speed')!;
  const speedValue = container.querySelector<HTMLElement>('.spider-speed-value')!;
  const legsSlider = container.querySelector<HTMLInputElement>('.spider-legs')!;
  const legsValue = container.querySelector<HTMLElement>('.spider-legs-value')!;
  const overshootSlider = container.querySelector<HTMLInputElement>('.spider-overshoot')!;
  const overshootValue = container.querySelector<HTMLElement>('.spider-overshoot-value')!;
  const comfortSlider = container.querySelector<HTMLInputElement>('.spider-comfort')!;
  const comfortValue = container.querySelector<HTMLElement>('.spider-comfort-value')!;
  const stepDurSlider = container.querySelector<HTMLInputElement>('.spider-stepdur')!;
  const stepDurValue = container.querySelector<HTMLElement>('.spider-stepdur-value')!;
  const stepHeightSlider = container.querySelector<HTMLInputElement>('.spider-stepheight')!;
  const stepHeightValue = container.querySelector<HTMLElement>('.spider-stepheight-value')!;
  const clearanceSlider = container.querySelector<HTMLInputElement>('.spider-clearance')!;
  const clearanceValue = container.querySelector<HTMLElement>('.spider-clearance-value')!;

  let speedMultiplier = 1;
  let totalLegs = 8;
  let gaitMode: 'coordinated' | 'frantic' = 'coordinated';
  let baseOvershoot = 0.80;
  let baseComfort = 30;
  let baseStepDur = 0.30;
  let baseStepHeight = 30;
  let baseClearance = 30;
  let tick = 0;

  const tileQuery = makeFloorQuery(FLOOR_Y);

  let instances: SpiderInstance[] = [];

  const rebuildInstances = (): void => {
    const defs = createInstanceDefs(baseOvershoot, baseComfort, baseStepDur, baseStepHeight);
    instances = defs.map((d) => {
      const sizeScale = d.config.cephRadius / DEFAULT_SPIDER.cephRadius;
      const bodyY = FLOOR_Y - sizeScale * baseClearance;
      return {
        baseConfig: d.baseConfig,
        config: d.config,
        state: groundShowcaseSpiderState(
          createSpiderState(d.config, d.jitterSeed, d.startX, bodyY, 1),
          d.startX,
          bodyY,
          1,
          FLOOR_Y,
          d.config,
        ),
        bodyX: d.startX,
        bodyY,
        vx: d.vx,
        facing: 1 as 1 | -1,
        baseVx: d.vx,
        jitterSeed: d.jitterSeed,
        laneMin: d.laneMin,
        laneMax: d.laneMax,
      };
    });
    tick = 0;
  };
  rebuildInstances();

  const applyGaitLabel = (): void => {
    const label = gaitBtn.querySelector('span');
    if (label) label.textContent = gaitMode === 'coordinated' ? 'Coordinated' : 'Frantic';
    gaitBtn.setAttribute('aria-pressed', gaitMode === 'frantic' ? 'true' : 'false');
  };
  applyGaitLabel();

  const applySpeed = (s: number): void => {
    speedMultiplier = s;
    speedValue.textContent = `${s.toFixed(1)}x`;
    for (const inst of instances) {
      inst.config = tuneShowcaseSpiderSpeed({
        ...inst.baseConfig,
        mode: inst.config.mode,
        legCount: totalLegs / 2,
      }, Math.abs(inst.baseVx * speedMultiplier));
    }
  };
  applySpeed(speedMultiplier);

  gaitBtn.addEventListener('click', () => {
    gaitMode = gaitMode === 'coordinated' ? 'frantic' : 'coordinated';
    applyGaitLabel();
    for (const inst of instances) {
      if (inst.baseVx !== 0) {
        inst.config = tuneShowcaseSpiderSpeed({
          ...inst.baseConfig,
          mode: gaitMode,
          legCount: totalLegs / 2,
        }, Math.abs(inst.baseVx * speedMultiplier));
      }
    }
    gaitBtn.blur();
  });

  speedSlider.addEventListener('input', () => {
    applySpeed(Number(speedSlider.value));
  });

  legsSlider.addEventListener('input', () => {
    totalLegs = Number(legsSlider.value);
    legsValue.textContent = String(totalLegs);
    for (const inst of instances) {
      inst.config = tuneShowcaseSpiderSpeed({
        ...inst.baseConfig,
        mode: inst.config.mode,
        legCount: totalLegs / 2,
      }, Math.abs(inst.baseVx * speedMultiplier));
      inst.state = groundShowcaseSpiderState(
        createSpiderState(
          inst.config,
          inst.jitterSeed,
          inst.bodyX,
          inst.bodyY,
          inst.facing,
        ),
        inst.bodyX,
        inst.bodyY,
        inst.facing,
        FLOOR_Y,
        inst.config,
      );
    }
  });

  const rebuildFromSliders = (): void => {
    rebuildInstances();
    applySpeed(speedMultiplier);
    applyGaitLabel();
    if (gaitMode === 'frantic') {
      for (const inst of instances) {
        if (inst.baseVx !== 0) {
          inst.config = tuneShowcaseSpiderSpeed({
            ...inst.baseConfig,
            mode: 'frantic',
            legCount: totalLegs / 2,
          }, Math.abs(inst.baseVx * speedMultiplier));
        }
      }
    }
  };

  overshootSlider.addEventListener('input', () => {
    baseOvershoot = Number(overshootSlider.value);
    overshootValue.textContent = baseOvershoot.toFixed(2);
    rebuildFromSliders();
  });

  comfortSlider.addEventListener('input', () => {
    baseComfort = Number(comfortSlider.value);
    comfortValue.textContent = String(baseComfort);
    rebuildFromSliders();
  });

  stepDurSlider.addEventListener('input', () => {
    baseStepDur = Number(stepDurSlider.value);
    stepDurValue.textContent = baseStepDur.toFixed(2);
    rebuildFromSliders();
  });

  stepHeightSlider.addEventListener('input', () => {
    baseStepHeight = Number(stepHeightSlider.value);
    stepHeightValue.textContent = String(baseStepHeight);
    rebuildFromSliders();
  });

  clearanceSlider.addEventListener('input', () => {
    baseClearance = Number(clearanceSlider.value);
    clearanceValue.textContent = String(baseClearance);
    rebuildFromSliders();
  });

  const step = (dt: number): void => {
    for (const inst of instances) {
      const scaledVx = inst.baseVx * speedMultiplier;
      inst.vx = scaledVx;
      inst.bodyX += scaledVx * inst.facing * dt;

      if (scaledVx !== 0) {
        if (inst.bodyX > inst.laneMax) {
          inst.bodyX = inst.laneMax;
          inst.facing = -1;
        } else if (inst.bodyX < inst.laneMin) {
          inst.bodyX = inst.laneMin;
          inst.facing = 1;
        }
      }

      inst.state = stepSpider(
        inst.state,
        inst.bodyX,
        inst.bodyY,
        inst.vx * inst.facing,
        0,
        inst.facing,
        dt,
        inst.config,
        tileQuery,
        TILE_SIZE,
        tick,
      );
    }
    tick += 1;
  };

  const renderFrame = (): void => {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, FLOOR_Y, CANVAS_W, CANVAS_H - FLOOR_Y);

    ctx.strokeStyle = '#444466';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    ctx.lineTo(CANVAS_W, FLOOR_Y);
    ctx.stroke();

    ctx.strokeStyle = '#252540';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < CANVAS_W; x += TILE_SIZE) {
      ctx.beginPath();
      ctx.moveTo(x, FLOOR_Y);
      ctx.lineTo(x, FLOOR_Y + 16);
      ctx.stroke();
    }

    for (const inst of instances) {
      const pose = evaluateSpiderPose(
        inst.state,
        inst.bodyX,
        inst.bodyY,
        inst.facing,
        inst.vx * inst.facing,
        0,
        tick,
        inst.config,
      );
      drawSpider(ctx, pose, inst.config);
    }
  };

  renderFrame();

  if (shouldAnimate()) {
    return;
  }

  const loop: GameLoop = createGameLoop({
    fixedDt: DT,
    step,
    render: () => {
      renderFrame();
    },
  });

  loop.start();
}
