import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  sampleLimbReach,
  sampleFabrikChain,
  sampleSpringChain,
  sampleRigHierarchy,
  SampleScene
} from '../../src/_prototype/sample';

const OUTPUT_DIR = 'benchmarks/animation';
const BACKGROUND_COLOR = '#f1f5f9'; // Slate-100: clean, high-contrast neutral background

function renderSceneToCanvas(scene: SampleScene, bg: string) {
  const canvas = createCanvas(256, 256);
  const ctx = canvas.getContext('2d');

  // Fill background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 256);

  // Draw lines
  for (const line of scene.lines) {
    ctx.beginPath();
    ctx.moveTo(line.from.x, line.from.y);
    ctx.lineTo(line.to.x, line.to.y);
    ctx.strokeStyle = line.color;
    ctx.lineWidth = line.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // Draw points
  for (const pt of scene.points) {
    ctx.beginPath();
    ctx.arc(pt.pos.x, pt.pos.y, pt.r, 0, Math.PI * 2);
    ctx.fillStyle = pt.color;
    ctx.fill();
  }

  return canvas;
}

function main() {
  console.log('Generating animation-pillar prototype benchmark PNGs...');

  const start = performance.now();

  // 1. Generate scenes
  const limbReachScene = sampleLimbReach();
  const fabrikChainScene = sampleFabrikChain();
  const springChainScene = sampleSpringChain();
  const rigHierarchyScene = sampleRigHierarchy();

  // 2. Render to individual canvases
  const limbCanvas = renderSceneToCanvas(limbReachScene, BACKGROUND_COLOR);
  const fabrikCanvas = renderSceneToCanvas(fabrikChainScene, BACKGROUND_COLOR);
  const springCanvas = renderSceneToCanvas(springChainScene, BACKGROUND_COLOR);
  const rigCanvas = renderSceneToCanvas(rigHierarchyScene, BACKGROUND_COLOR);

  // 3. Save individual PNGs
  writeFileSync(join(OUTPUT_DIR, 'ik-limb-reach.png'), limbCanvas.toBuffer('image/png'));
  writeFileSync(join(OUTPUT_DIR, 'ik-fabrik-chain.png'), fabrikCanvas.toBuffer('image/png'));
  writeFileSync(join(OUTPUT_DIR, 'spring-chain.png'), springCanvas.toBuffer('image/png'));
  writeFileSync(join(OUTPUT_DIR, 'rig-hierarchy.png'), rigCanvas.toBuffer('image/png'));

  console.log('Saved individual PNGs to benchmarks/animation/');

  // 4. Generate 2x2 gallery composite
  const galleryCanvas = createCanvas(512, 512);
  const gCtx = galleryCanvas.getContext('2d');

  // Draw the 4 canvases into the 2x2 grid
  gCtx.drawImage(limbCanvas, 0, 0);
  gCtx.drawImage(fabrikCanvas, 256, 0);
  gCtx.drawImage(springCanvas, 0, 256);
  gCtx.drawImage(rigCanvas, 256, 256);

  // Draw grid dividers
  gCtx.strokeStyle = '#cbd5e1'; // Slate-300 divider
  gCtx.lineWidth = 2;
  gCtx.beginPath();
  gCtx.moveTo(256, 0);
  gCtx.lineTo(256, 512);
  gCtx.moveTo(0, 256);
  gCtx.lineTo(512, 256);
  gCtx.stroke();

  // Save gallery
  writeFileSync(join(OUTPUT_DIR, 'gallery.png'), galleryCanvas.toBuffer('image/png'));
  console.log('Saved gallery composite to benchmarks/animation/gallery.png');

  const end = performance.now();
  console.log(`Benchmark rendering complete in ${(end - start).toFixed(2)}ms.`);
}

main();
