export interface TerrainArtPixelPoint { readonly x: number; readonly y: number }

function unique(points: readonly TerrainArtPixelPoint[]): TerrainArtPixelPoint[] {
  const seen = new Set<string>();
  return points.filter(({ x, y }) => {
    const key = `${x},${y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Rasterize an inclusive one-pixel Bresenham line. */
export function terrainArtLinePixels(from: TerrainArtPixelPoint, to: TerrainArtPixelPoint): TerrainArtPixelPoint[] {
  const result: TerrainArtPixelPoint[] = [];
  let x = from.x; let y = from.y;
  const dx = Math.abs(to.x - x); const sx = x < to.x ? 1 : -1;
  const dy = -Math.abs(to.y - y); const sy = y < to.y ? 1 : -1;
  let error = dx + dy;
  while (true) {
    result.push({ x, y });
    if (x === to.x && y === to.y) break;
    const doubled = error * 2;
    if (doubled >= dy) { error += dy; x += sx; }
    if (doubled <= dx) { error += dx; y += sy; }
  }
  return result;
}

/** Rasterize an axis-aligned rectangle outline. */
export function terrainArtRectanglePixels(from: TerrainArtPixelPoint, to: TerrainArtPixelPoint): TerrainArtPixelPoint[] {
  const left = Math.min(from.x, to.x); const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y); const bottom = Math.max(from.y, to.y);
  return unique([
    ...terrainArtLinePixels({ x: left, y: top }, { x: right, y: top }),
    ...terrainArtLinePixels({ x: right, y: top }, { x: right, y: bottom }),
    ...terrainArtLinePixels({ x: right, y: bottom }, { x: left, y: bottom }),
    ...terrainArtLinePixels({ x: left, y: bottom }, { x: left, y: top }),
  ]);
}

/** Rasterize an ellipse outline inside the inclusive bounding rectangle. */
export function terrainArtEllipsePixels(from: TerrainArtPixelPoint, to: TerrainArtPixelPoint): TerrainArtPixelPoint[] {
  const cx = (from.x + to.x) / 2; const cy = (from.y + to.y) / 2;
  const rx = Math.max(0.5, Math.abs(to.x - from.x) / 2);
  const ry = Math.max(0.5, Math.abs(to.y - from.y) / 2);
  const steps = Math.max(12, Math.ceil(2 * Math.PI * Math.max(rx, ry) * 1.5));
  const result: TerrainArtPixelPoint[] = [];
  for (let index = 0; index < steps; index++) {
    const angle = index / steps * Math.PI * 2;
    result.push({ x: Math.round(cx + Math.cos(angle) * rx), y: Math.round(cy + Math.sin(angle) * ry) });
  }
  return unique(result);
}

/** Return the four-connected region sharing the start pixel's exact RGBA value. */
export function terrainArtFloodFillPixels(
  pixels: Uint8ClampedArray, width: number, height: number, start: TerrainArtPixelPoint,
): TerrainArtPixelPoint[] {
  if (start.x < 0 || start.y < 0 || start.x >= width || start.y >= height) return [];
  const startOffset = (start.y * width + start.x) * 4;
  const target = pixels.slice(startOffset, startOffset + 4);
  const visited = new Uint8Array(width * height);
  const queue: TerrainArtPixelPoint[] = [start];
  const result: TerrainArtPixelPoint[] = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const point = queue[cursor]!; const index = point.y * width + point.x;
    if (visited[index]) continue;
    visited[index] = 1;
    const offset = index * 4;
    if (pixels[offset] !== target[0] || pixels[offset + 1] !== target[1] || pixels[offset + 2] !== target[2] || pixels[offset + 3] !== target[3]) continue;
    result.push(point);
    if (point.x > 0) queue.push({ x: point.x - 1, y: point.y });
    if (point.x + 1 < width) queue.push({ x: point.x + 1, y: point.y });
    if (point.y > 0) queue.push({ x: point.x, y: point.y - 1 });
    if (point.y + 1 < height) queue.push({ x: point.x, y: point.y + 1 });
  }
  return result;
}
