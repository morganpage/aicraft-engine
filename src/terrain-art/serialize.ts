import type { TerrainArtProject } from './types';
import { validateTerrainArtProject } from './validate';
import { migrateTerrainArtProject } from './migrate';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) result[key] = canonicalize(source[key]);
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
