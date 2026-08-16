import type { TerrainArtProject } from './types';
import { validateTerrainArtProject } from './validate';
import { migrateTerrainArtProject } from './migrate';

/**
 * Deterministic object-key ordering for the persisted document format.
 *
 * Cycle-safe via a path-scoped `seen` set (add before recursion, delete
 * after — so a repeated-but-acyclic reference serializes twice, while a
 * back-edge becomes `null` instead of recursing forever). Valid projects
 * cannot contain cycles; this guards the serializer against hostile input
 * without changing output for anything valid.
 */
function canonicalize(value: unknown, seen: Set<object> = new Set()): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return null;
    seen.add(value);
    const out = value.map((item) => canonicalize(item, seen));
    seen.delete(value);
    return out;
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return null;
  seen.add(value);
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) result[key] = canonicalize(source[key], seen);
  seen.delete(value);
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Serialize terrain-art source with deterministic object-key ordering. */
export function serializeTerrainArtProject(project: Readonly<TerrainArtProject>): string {
  try {
    return JSON.stringify(canonicalize(project), null, 2);
  } catch {
    return '';
  }
}

/** Parse and validate one terrain-art source document. Invalid input returns null. */
export function deserializeTerrainArtProject(source: string): TerrainArtProject | null {
  try {
    const parsed: unknown = migrateTerrainArtProject(JSON.parse(source));
    if (!validateTerrainArtProject(parsed).valid) return null;
    return deepFreeze(parsed as TerrainArtProject);
  } catch {
    return null;
  }
}
