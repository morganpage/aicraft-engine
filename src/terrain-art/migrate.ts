import { TERRAIN_ART_PROJECT_VERSION } from './constants';

/** Best-effort migration ladder for untrusted historical source documents. */
export function migrateTerrainArtProject(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  if (source.version === TERRAIN_ART_PROJECT_VERSION) return source;
  if (source.version === 0) {
    return {
      ...source,
      version: 1,
      transitionRules: Array.isArray(source.transitionRules) ? source.transitionRules : [],
      occurrenceOverrides: Array.isArray(source.occurrenceOverrides) ? source.occurrenceOverrides : [],
    };
  }
  return value;
}
