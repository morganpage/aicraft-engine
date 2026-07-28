/**
 * Static, family-scoped rectangle edge exposure.
 *
 * This is level-preparation geometry, never a per-frame operation.
 *
 * @module
 */

import type {
  ComputeRectExposureOptions,
  ExposedSpan,
  TerrainRectExposure,
  TerrainRectInput,
} from './types';

interface ValidRect {
  readonly key: number;
  readonly familyId: number;
  readonly minimumSpan: number;
  readonly x: number;
  readonly y: number;
  readonly right: number;
  readonly bottom: number;
}

function normalize(input: Readonly<TerrainRectInput>): ValidRect | null {
  const { rect } = input;
  if (
    !Number.isFinite(input.key) ||
    !Number.isFinite(input.familyId) ||
    rect === null ||
    typeof rect !== 'object' ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  if (!Number.isFinite(right) || !Number.isFinite(bottom)) return null;
  return {
    key: input.key,
    familyId: input.familyId,
    minimumSpan: Number.isFinite(input.minimumSpan)
      ? Math.max(0, input.minimumSpan ?? 0)
      : 0,
    x: rect.x,
    y: rect.y,
    right,
    bottom,
  };
}

function uncovered(
  start: number,
  end: number,
  covers: readonly ExposedSpan[],
  minimumSpan: number,
  epsilon: number,
): ExposedSpan[] {
  const sorted = [...covers]
    .map((span) => ({
      start: Math.max(start, span.start),
      end: Math.min(end, span.end),
    }))
    .filter((span) => span.end - span.start > epsilon)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: ExposedSpan[] = [];
  for (const span of sorted) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && span.start <= previous.end + epsilon) {
      merged[merged.length - 1] = {
        start: previous.start,
        end: Math.max(previous.end, span.end),
      };
    } else {
      merged.push(span);
    }
  }

  const result: ExposedSpan[] = [];
  let cursor = start;
  for (const cover of merged) {
    const length = cover.start - cursor;
    if (length > epsilon && length >= minimumSpan) {
      result.push({ start: cursor, end: cover.start });
    }
    cursor = Math.max(cursor, cover.end);
  }
  const remaining = end - cursor;
  if (remaining > epsilon && remaining >= minimumSpan) {
    result.push({ start: cursor, end });
  }
  return result;
}

/**
 * Compute exposed spans for every valid rectangle in a static set.
 *
 * Results are independent of input order. Consumer connector errors propagate.
 */
export function computeRectExposures(
  rects: readonly Readonly<TerrainRectInput>[],
  options: Readonly<ComputeRectExposureOptions> = {},
): ReadonlyMap<number, TerrainRectExposure> {
  const valid = (Array.isArray(rects) ? rects : [])
    .map(normalize)
    .filter((rect): rect is ValidRect => rect !== null)
    .sort((a, b) =>
      a.key - b.key ||
      a.x - b.x ||
      a.y - b.y ||
      a.right - b.right ||
      a.bottom - b.bottom,
    );
  const epsilon = Number.isFinite(options.epsilon)
    ? Math.max(0, options.epsilon ?? 0)
    : 0;
  const connects = options.connects ?? ((a: number, b: number) => a === b);
  const result = new Map<number, TerrainRectExposure>();

  for (const rect of valid) {
    const topCovers: ExposedSpan[] = [];
    const rightCovers: ExposedSpan[] = [];
    const bottomCovers: ExposedSpan[] = [];
    const leftCovers: ExposedSpan[] = [];

    for (const other of valid) {
      if (other === rect || !connects(rect.familyId, other.familyId)) continue;
      const horizontal: ExposedSpan = {
        start: Math.max(rect.x, other.x),
        end: Math.min(rect.right, other.right),
      };
      const vertical: ExposedSpan = {
        start: Math.max(rect.y, other.y),
        end: Math.min(rect.bottom, other.bottom),
      };
      if (horizontal.end - horizontal.start > epsilon) {
        if (Math.abs(other.bottom - rect.y) <= epsilon) topCovers.push(horizontal);
        if (Math.abs(other.y - rect.bottom) <= epsilon) bottomCovers.push(horizontal);
      }
      if (vertical.end - vertical.start > epsilon) {
        if (Math.abs(other.x - rect.right) <= epsilon) rightCovers.push(vertical);
        if (Math.abs(other.right - rect.x) <= epsilon) leftCovers.push(vertical);
      }
    }

    result.set(rect.key, {
      top: uncovered(rect.x, rect.right, topCovers, rect.minimumSpan, epsilon),
      right: uncovered(rect.y, rect.bottom, rightCovers, rect.minimumSpan, epsilon),
      bottom: uncovered(rect.x, rect.right, bottomCovers, rect.minimumSpan, epsilon),
      left: uncovered(rect.y, rect.bottom, leftCovers, rect.minimumSpan, epsilon),
    });
  }
  return result;
}
