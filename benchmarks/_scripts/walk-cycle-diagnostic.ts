import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  deriveHeroConfig,
  createHeroFrameState,
  stepHero,
  drawSlimeKnight,
  HERO_CANVAS_SIZE,
  HERO_GROUND_Y,
} from '../../showcase/helpers/slime-knight';

function renderWalkCycleDiagnostics() {
  const seed = 98724;
  const config = deriveHeroConfig(seed);
  const DT = 1 / 60;

  // Ensure output directory exists
  const outputDir = 'benchmarks/animation';
  mkdirSync(outputDir, { recursive: true });

  const numCols = 6;
  const numRows = 4;
  const compositeWidth = HERO_CANVAS_SIZE * numCols;
  const compositeHeight = HERO_CANVAS_SIZE * numRows;

  // Helper to render a frame strip
  function renderStrip(walkDx: number, facing: 1 | -1, filename: string) {
    const canvas = createCanvas(compositeWidth, compositeHeight);
    const ctx = canvas.getContext('2d');

    // 1. Simulate and collect frames
    const panels = [];
    let frame = createHeroFrameState(config);

    for (let tick = 0; tick <= 115; tick++) {
      if (tick % 5 === 0) {
        panels.push({
          frame: { ...frame },
          tick,
        });
      }
      frame = stepHero(frame, DT, { walkDx, facing, eyeCount: 1 });
    }

    // 2. Draw each panel
    panels.forEach((panel, index) => {
      const col = index % numCols;
      const row = Math.floor(index / numCols);
      const xOffset = col * HERO_CANVAS_SIZE;
      const yOffset = row * HERO_CANVAS_SIZE;

      ctx.save();
      ctx.translate(xOffset, yOffset);

      // Background
      ctx.fillStyle = config.palette.background;
      ctx.fillRect(0, 0, HERO_CANVAS_SIZE, HERO_CANVAS_SIZE);

      // Ground line
      const groundY = HERO_GROUND_Y;
      ctx.strokeStyle = config.palette.outline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, groundY + 0.5);
      ctx.lineTo(HERO_CANVAS_SIZE, groundY + 0.5);
      ctx.stroke();

      // Shadow (centered, since we center the character)
      ctx.save();
      ctx.fillStyle = config.palette.outline;
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.ellipse(HERO_CANVAS_SIZE / 2, groundY + 2, 56, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Center the character for drawing by setting x = 0 and shifting antenna nodes
      const drawFrame = {
        ...panel.frame,
        x: 0,
        antenna: panel.frame.antenna.map((node) => ({
          ...node,
          x: node.x - panel.frame.x,
          y: node.y,
          prevX: node.prevX - panel.frame.x,
          prevY: node.prevY,
        })),
      };

      // Draw character
      drawSlimeKnight(ctx as any, drawFrame, panel.tick);

      // Text overlay: tick number and phase
      ctx.fillStyle = config.palette.outline;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`Tick: ${panel.tick}`, 15, 25);
      ctx.fillText(`Phase: ${panel.frame.locomotion.phase.toFixed(2)}`, 15, 42);

      ctx.restore();
    });

    // Draw grid dividers
    ctx.strokeStyle = '#cbd5e1'; // Slate-300
    ctx.lineWidth = 1;

    // Vertical lines
    for (let col = 1; col < numCols; col++) {
      ctx.beginPath();
      ctx.moveTo(col * HERO_CANVAS_SIZE, 0);
      ctx.lineTo(col * HERO_CANVAS_SIZE, compositeHeight);
      ctx.stroke();
    }

    // Horizontal lines
    for (let row = 1; row < numRows; row++) {
      ctx.beginPath();
      ctx.moveTo(0, row * HERO_CANVAS_SIZE);
      ctx.lineTo(compositeWidth, row * HERO_CANVAS_SIZE);
      ctx.stroke();
    }

    const destPath = join(outputDir, filename);
    writeFileSync(destPath, canvas.toBuffer('image/png'));
    console.log(`Saved walk cycle diagnostic PNG to ${destPath}`);
  }

  const isFixed = process.argv.includes('--fixed');
  const rightFilename = isFixed ? 'walk-cycle-right-fixed.png' : 'walk-cycle-right-diagnostic.png';
  const leftFilename = isFixed ? 'walk-cycle-left-fixed.png' : 'walk-cycle-left-diagnostic.png';

  // Render Walk-right
  console.log(`Rendering ${rightFilename}...`);
  renderStrip(1.5, 1, rightFilename);

  // Render Walk-left
  console.log(`Rendering ${leftFilename}...`);
  renderStrip(-1.5, -1, leftFilename);
}

renderWalkCycleDiagnostics();
