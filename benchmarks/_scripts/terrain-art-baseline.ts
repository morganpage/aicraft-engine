import { mkdir, writeFile } from 'node:fs/promises';
import { createCanvas, ImageData } from 'canvas';
import { compileTerrainArtRuntime, createTerrainArtProject, generateTerrainArtMaterialAtlas, serializeTerrainArtProject } from '../../src/terrain-art/index';

const output = new URL('../terrain-art/', import.meta.url);
await mkdir(output, { recursive: true });
const results: Array<Record<string, number>> = [];
for (const resolution of [16, 32, 48, 64, 96, 128]) {
  const project = createTerrainArtProject({ authoringResolution: resolution });
  const started = performance.now(); const atlas = generateTerrainArtMaterialAtlas(project, 'solid'); const generationMs = performance.now() - started;
  const canvas = createCanvas(atlas.width, atlas.height); canvas.getContext('2d').putImageData(new ImageData(atlas.pixels, atlas.width, atlas.height), 0, 0);
  await writeFile(new URL(`masks-${resolution}.png`, output), canvas.toBuffer('image/png'));
  const compileStarted = performance.now(); compileTerrainArtRuntime(project); const compileMs = performance.now() - compileStarted;
  results.push({ resolution, generationMs, compileMs, sourceBytes: new TextEncoder().encode(serializeTerrainArtProject(project)).length, atlasBytes: atlas.pixels.byteLength });
}
await writeFile(new URL('baseline.json', output), `${JSON.stringify(results, null, 2)}\n`);
