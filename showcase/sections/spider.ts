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

const DT = 1 / 60;

const CANVAS_W = 560;
const CANVAS_H = 320;
const TILE_SIZE = 16;
const FLOOR_Y = 192;

/** Body clearance above the floor (px, scaled per spider). Matches the
 *  validated benchmark — must be < thighLength+shinLength (48) so legs
 *  bend and feet reach the floor. */
const BODY_CLEARANCE = 18;

const WALK_SPEED = 90;

interface SpiderInstance {
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

function createInstanceDefs(): readonly {
  readonly config: SpiderConfig;
  readonly startX: number;
  readonly vx: number;
  readonly jitterSeed: number;
  readonly laneMin: number;
  readonly laneMax: number;
}[] {
  const green = makeGreenPalette();
  const red = makeRedPalette();

  return [
    {
      config: {
        ...DEFAULT_SPIDER,
        mode: 'coordinated',
        stepDuration: 0.18,
        phaseAdvanceRate: 0.08,
        motionScale: 1.2,
        cephRadius: DEFAULT_SPIDER.cephRadius * 1.2,
        abdRx: DEFAULT_SPIDER.abdRx * 1.2,
        abdRy: DEFAULT_SPIDER.abdRy * 1.2,
        thighLength: DEFAULT_SPIDER.thighLength * 1.2,
        shinLength: DEFAULT_SPIDER.shinLength * 1.2,
        abdOffsetX: DEFAULT_SPIDER.abdOffsetX * 1.2,
        palette: tintPalette(DEFAULT_SPIDER_PALETTE, 1.15),
      },
      startX: 84,
      vx: WALK_SPEED,
      jitterSeed: 42,
      laneMin: 30,
      laneMax: 170,
    },
    {
      config: {
        ...DEFAULT_SPIDER,
        mode: 'frantic',
        stepDuration: 0.1,
        comfortRadius: 8,
        motionScale: 0.7,
        cephRadius: DEFAULT_SPIDER.cephRadius * 0.7,
        abdRx: DEFAULT_SPIDER.abdRx * 0.7,
        abdRy: DEFAULT_SPIDER.abdRy * 0.7,
        thighLength: DEFAULT_SPIDER.thighLength * 0.7,
        shinLength: DEFAULT_SPIDER.shinLength * 0.7,
        abdOffsetX: DEFAULT_SPIDER.abdOffsetX * 0.7,
      },
      startX: 213,
      vx: WALK_SPEED * 1.4,
      jitterSeed: 101,
      laneMin: 155,
      laneMax: 310,
    },
    {
      config: {
        ...DEFAULT_SPIDER,
        mode: 'coordinated',
        palette: green,
      },
      startX: 347,
      vx: 15,
      jitterSeed: 202,
      laneMin: 295,
      laneMax: 430,
    },
    {
      config: {
        ...DEFAULT_SPIDER,
        mode: 'coordinated',
        palette: red,
      },
      startX: 476,
      vx: 0,
      jitterSeed: 303,
      laneMin: 476,
      laneMax: 476,
    },
  ];
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

  let speedMultiplier = 1;
  let gaitMode: 'coordinated' | 'frantic' = 'coordinated';
  let tick = 0;

  const tileQuery = makeFloorQuery(FLOOR_Y);

  const defs = createInstanceDefs();
  const instances: SpiderInstance[] = defs.map((d) => {
    const sizeScale = d.config.cephRadius / DEFAULT_SPIDER.cephRadius;
    const bodyY = FLOOR_Y - sizeScale * BODY_CLEARANCE;
    return {
      config: d.config,
      state: createSpiderState(d.config, d.jitterSeed, d.startX, bodyY),
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

  const applyGaitLabel = (): void => {
    const label = gaitBtn.querySelector('span');
    if (label) label.textContent = gaitMode === 'coordinated' ? 'Coordinated' : 'Frantic';
    gaitBtn.setAttribute('aria-pressed', gaitMode === 'frantic' ? 'true' : 'false');
  };
  applyGaitLabel();

  const applySpeed = (s: number): void => {
    speedMultiplier = s;
    speedValue.textContent = `${s.toFixed(1)}x`;
  };
  applySpeed(speedMultiplier);

  gaitBtn.addEventListener('click', () => {
    gaitMode = gaitMode === 'coordinated' ? 'frantic' : 'coordinated';
    applyGaitLabel();
    for (const inst of instances) {
      if (inst.baseVx !== 0) {
        inst.config = { ...inst.config, mode: gaitMode };
      }
    }
    gaitBtn.blur();
  });

  speedSlider.addEventListener('input', () => {
    applySpeed(Number(speedSlider.value));
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
