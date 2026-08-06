import { describe, expect, it } from 'vitest';
import { terrainArtEllipsePixels, terrainArtFloodFillPixels, terrainArtLinePixels, terrainArtRectanglePixels } from '../index';

describe('terrain art pixel tools', () => {
  it('rasterizes inclusive lines and rectangle outlines without duplicates', () => {
    expect(terrainArtLinePixels({ x: 1, y: 1 }, { x: 4, y: 1 })).toHaveLength(4);
    const rectangle = terrainArtRectanglePixels({ x: 1, y: 1 }, { x: 4, y: 3 });
    expect(rectangle).toHaveLength(10);
    expect(new Set(rectangle.map(({ x, y }) => `${x},${y}`)).size).toBe(rectangle.length);
  });

  it('rasterizes a symmetric bounded ellipse', () => {
    const ellipse = terrainArtEllipsePixels({ x: 2, y: 2 }, { x: 8, y: 6 });
    expect(ellipse.length).toBeGreaterThan(8);
    expect(ellipse.every(({ x, y }) => x >= 2 && x <= 8 && y >= 2 && y <= 6)).toBe(true);
  });

  it('flood fills only the four-connected exact-color region', () => {
    const pixels = new Uint8ClampedArray(3 * 2 * 4);
    pixels.fill(255);
    pixels[(0 * 3 + 1) * 4] = 0;
    pixels[(1 * 3 + 1) * 4] = 0;
    const fill = terrainArtFloodFillPixels(pixels, 3, 2, { x: 0, y: 0 });
    expect(fill).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1 }]);
  });
});
