import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  drawText,
  drawTextOutlined,
  measureText,
  DEFAULT_FONT,
} from '../../src/primitives/bitmap-font';

const OUTPUT_DIR = 'benchmarks/bitmap-font';

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

function main() {
  console.log('Generating bitmap-font benchmark PNG...');
  const start = performance.now();

  const W = 640;
  const H = 480;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;

  // Background: dark purple/black to match the library's aesthetic
  ctx.fillStyle = '#1d1128';
  ctx.fillRect(0, 0, W, H);

  // Row 1: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" at scale 3, flat white
  drawText(ctx, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 40, 40, { scale: 3, color: '#ffffff' });

  // Row 2: "abcdefghijklmnopqrstuvwxyz" at scale 3, flat white
  drawText(ctx, 'abcdefghijklmnopqrstuvwxyz', 40, 80, { scale: 3, color: '#ffffff' });

  // Row 3: "0123456789" at scale 3, flat white
  drawText(ctx, '0123456789', 40, 120, { scale: 3, color: '#ffffff' });

  // Row 4: "SCORE 1200" centered at scale 4, outlined (white fill + dark outline)
  // To make the dark outline (#1d1128) visible, we draw a lighter background panel behind it
  const panelY = 155;
  const panelH = 45;
  ctx.fillStyle = '#3b2450'; // Medium purple panel
  ctx.fillRect(40, panelY, W - 80, panelH);

  // Draw outline around the panel itself to make it look polished
  ctx.strokeStyle = '#5c3a7a';
  ctx.lineWidth = 2;
  ctx.strokeRect(40, panelY, W - 80, panelH);

  // Draw the centered text
  drawTextOutlined(ctx, 'SCORE 1200', W / 2, panelY + 8, {
    scale: 4,
    align: 'center',
    color: '#ffffff',
    outline: '#1d1128',
  });

  // Row 5: Punctuation run at scale 3, flat white
  const punctuation = `!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`;
  drawText(ctx, punctuation, 40, 220, { scale: 3, color: '#ffffff' });

  // Row 6: Multiline block at scale 3, flat white, left-aligned
  const multilineText = 'LEVEL 1\nLIVES 3\nPRESS START';
  drawText(ctx, multilineText, 40, 260, { scale: 3, color: '#ffffff' });

  // Row 7: The same alphabet at scale 1 and scale 2 (tiny rows) to confirm scaling
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  drawText(ctx, alphabet, 40, 360, { scale: 2, color: '#ffffff' });
  drawText(ctx, alphabet, 40, 390, { scale: 1, color: '#ffffff' });

  // Save the PNG
  const outputPath = join(OUTPUT_DIR, 'sample.png');
  writeFileSync(outputPath, canvas.toBuffer('image/png'));

  const end = performance.now();
  console.log(`Bitmap font benchmark rendering complete in ${(end - start).toFixed(2)}ms.`);
  console.log(`Saved to ${outputPath}`);
}

main();
