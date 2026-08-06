import { describe, expect, it } from 'vitest';
import {
  deriveTerrainArtContour,
  generateTerrainArtCoverage,
} from '../terrain-art';

function pixel(
  pixels: Uint8Array,
  size: number,
  x: number,
  y: number,
): number {
  return pixels[y * size + x] ?? 0;
}

describe('terrain-art procedural coverage', () => {
  it('makes roundness zero an exact square quadrant', () => {
    const coverage = generateTerrainArtCoverage({
      mask: 1,
      resolution: 32,
      roundness: 0,
    });

    expect(pixel(coverage.pixels, 32, 0, 0)).toBe(255);
    expect(pixel(coverage.pixels, 32, 15, 15)).toBe(255);
    expect(pixel(coverage.pixels, 32, 16, 15)).toBe(0);
    expect(pixel(coverage.pixels, 32, 15, 16)).toBe(0);
    expect(coverage.pixels.filter(Boolean)).toHaveLength(16 * 16);
  });

  it('uses clockwise lower bits for square south-east and south-west lobes', () => {
    const southEast = generateTerrainArtCoverage({
      mask: 4,
      resolution: 16,
      roundness: 0,
    });
    const southWest = generateTerrainArtCoverage({
      mask: 8,
      resolution: 16,
      roundness: 0,
    });

    expect(pixel(southEast.pixels, 16, 12, 12)).toBe(255);
    expect(pixel(southEast.pixels, 16, 3, 12)).toBe(0);
    expect(pixel(southWest.pixels, 16, 3, 12)).toBe(255);
    expect(pixel(southWest.pixels, 16, 12, 12)).toBe(0);
  });

  it('rounds convex and concave corners from the same lobe geometry', () => {
    const convex = generateTerrainArtCoverage({
      mask: 1,
      resolution: 32,
      roundness: 1,
    });
    const concave = generateTerrainArtCoverage({
      mask: 14,
      resolution: 32,
      roundness: 1,
    });

    for (let index = 0; index < convex.pixels.length; index++) {
      expect((convex.pixels[index] ?? 0) + (concave.pixels[index] ?? 0)).toBe(255);
    }
  });

  it('keeps the complete mask fully covered at every roundness', () => {
    for (const roundness of [0, 0.25, 0.5, 1]) {
      const coverage = generateTerrainArtCoverage({
        mask: 15,
        resolution: 32,
        roundness,
      });
      expect(coverage.pixels.every((value) => value === 255)).toBe(true);
    }
  });

  it('derives an inside contour from fill without changing the silhouette', () => {
    const coverage = generateTerrainArtCoverage({
      mask: 11,
      resolution: 32,
      roundness: 0,
    });
    const contour = deriveTerrainArtContour(coverage, 4, 'inside');

    for (let index = 0; index < contour.length; index++) {
      if (contour[index]) expect(coverage.pixels[index]).toBe(255);
    }
    expect(pixel(contour, 32, 12, 12)).toBe(255);
    expect(pixel(contour, 32, 15, 15)).toBe(255);
    expect(pixel(contour, 32, 11, 12)).toBe(0);
    expect(pixel(contour, 32, 12, 11)).toBe(0);
  });

  it('returns an empty result for malformed generator input', () => {
    expect(generateTerrainArtCoverage({
      mask: 99 as 15,
      resolution: 0,
      roundness: Number.NaN,
    })).toEqual({ mask: 0, resolution: 0, roundness: 0, pixels: new Uint8Array(0) });
  });
});
