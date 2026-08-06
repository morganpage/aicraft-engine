import {
  MAX_TERRAIN_ART_RESOLUTION,
  MIN_TERRAIN_ART_RESOLUTION,
} from './constants';
import type {
  TerrainArtCoverage,
  TerrainArtDualGridMask,
} from './types';

/** Inputs for generating one canonical dual-grid fill silhouette. */
export interface GenerateTerrainArtCoverageOptions {
  readonly mask: TerrainArtDualGridMask;
  readonly resolution: number;
  readonly roundness: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function validMask(value: number): value is TerrainArtDualGridMask {
  return Number.isInteger(value) && value >= 0 && value <= 15;
}

function lobeFilled(
  bit: 1 | 2 | 4 | 8,
  x: number,
  y: number,
  resolution: number,
  roundness: number,
): boolean {
  const half = resolution / 2;
  const cornerX = bit === 2 || bit === 4 ? resolution : 0;
  const cornerY = bit === 4 || bit === 8 ? resolution : 0;
  const distanceX = Math.abs(x + 0.5 - cornerX);
  const distanceY = Math.abs(y + 0.5 - cornerY);
  if (distanceX > half || distanceY > half) return false;
  const radius = half * roundness;
  if (radius <= 0) return true;
  const shoulder = half - radius;
  if (distanceX <= shoulder || distanceY <= shoulder) return true;
  const arcX = distanceX - shoulder;
  const arcY = distanceY - shoulder;
  return arcX * arcX + arcY * arcY <= radius * radius;
}

function filled(
  mask: TerrainArtDualGridMask,
  x: number,
  y: number,
  resolution: number,
  roundness: number,
): boolean {
  if (mask === 0) return false;
  if (mask === 15) return true;
  const bits = [1, 2, 4, 8] as const;
  const count = bits.reduce((total, bit) => total + Number((mask & bit) !== 0), 0);
  if (count === 3) {
    const missing = bits.find((bit) => (mask & bit) === 0);
    return missing !== undefined && !lobeFilled(missing, x, y, resolution, roundness);
  }
  if (mask === 3) return y < resolution / 2;
  if (mask === 12) return y >= resolution / 2;
  if (mask === 9) return x < resolution / 2;
  if (mask === 6) return x >= resolution / 2;
  return bits.some((bit) =>
    (mask & bit) !== 0 && lobeFilled(bit, x, y, resolution, roundness));
}

/** Generate the fill coverage from which contour, shading, and clipping derive. */
export function generateTerrainArtCoverage(
  options: Readonly<GenerateTerrainArtCoverageOptions>,
): TerrainArtCoverage {
  if (
    !validMask(options.mask) ||
    !Number.isInteger(options.resolution) ||
    options.resolution < MIN_TERRAIN_ART_RESOLUTION ||
    options.resolution > MAX_TERRAIN_ART_RESOLUTION ||
    !Number.isFinite(options.roundness)
  ) {
    return Object.freeze({
      mask: 0 as const,
      resolution: 0,
      roundness: 0,
      pixels: new Uint8Array(0),
    });
  }
  const roundness = clamp(options.roundness, 0, 1);
  const pixels = new Uint8Array(options.resolution * options.resolution);
  for (let y = 0; y < options.resolution; y++) {
    for (let x = 0; x < options.resolution; x++) {
      if (filled(options.mask, x, y, options.resolution, roundness)) {
        pixels[y * options.resolution + x] = 255;
      }
    }
  }
  return Object.freeze({
    mask: options.mask,
    resolution: options.resolution,
    roundness,
    pixels,
  });
}

function withinKernel(
  dx: number,
  dy: number,
  radius: number,
  rounded: boolean,
): boolean {
  if (dx === 0 && dy === 0) return false;
  return rounded
    ? dx * dx + dy * dy <= radius * radius
    : Math.max(Math.abs(dx), Math.abs(dy)) <= radius;
}

function touchesOpposite(
  coverage: Readonly<TerrainArtCoverage>,
  x: number,
  y: number,
  radius: number,
  filledCenter: boolean,
): boolean {
  if (radius <= 0) return false;
  const rounded = coverage.roundness > 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (!withinKernel(dx, dy, radius, rounded)) continue;
      const sampleX = x + dx;
      const sampleY = y + dy;
      if (
        sampleX < 0 || sampleY < 0 ||
        sampleX >= coverage.resolution || sampleY >= coverage.resolution
      ) continue;
      const sampleFilled = coverage.pixels[sampleY * coverage.resolution + sampleX] !== 0;
      if (sampleFilled !== filledCenter) return true;
    }
  }
  return false;
}

/** Derive contour coverage from the exact generated fill silhouette. */
export function deriveTerrainArtContour(
  coverage: Readonly<TerrainArtCoverage>,
  requestedWidth: number,
  placement: 'inside' | 'center' | 'outside' = 'inside',
): Uint8Array {
  const size = coverage.resolution;
  if (
    !Number.isInteger(size) || size <= 0 ||
    !(coverage.pixels instanceof Uint8Array) ||
    coverage.pixels.length < size * size ||
    !Number.isFinite(requestedWidth)
  ) return new Uint8Array(0);
  const width = clamp(Math.round(requestedWidth), 0, Math.floor(size / 2));
  const insideWidth = placement === 'inside'
    ? width
    : placement === 'center' ? Math.ceil(width / 2) : 0;
  const outsideWidth = placement === 'outside'
    ? width
    : placement === 'center' ? Math.floor(width / 2) : 0;
  const contour = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x;
      const isFilled = coverage.pixels[index] !== 0;
      const radius = isFilled ? insideWidth : outsideWidth;
      if (touchesOpposite(coverage, x, y, radius, isFilled)) contour[index] = 255;
    }
  }
  return contour;
}
