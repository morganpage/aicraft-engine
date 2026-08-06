import { getTerrainArtOccurrenceStatus } from './occurrence-overrides';
import type { PreparedTerrainArtDualGrid, TerrainArtDiagnostic, TerrainArtProject } from './types';

/** Collect non-blocking export diagnostics, including safely excluded local overrides. */
export function diagnoseTerrainArtExport(project: Readonly<TerrainArtProject>, levels: Readonly<Record<string, Readonly<PreparedTerrainArtDualGrid>>>): readonly TerrainArtDiagnostic[] {
  const diagnostics: TerrainArtDiagnostic[] = [];
  project.occurrenceOverrides.forEach((override, index) => {
    const prepared = levels[override.levelId];
    const status = prepared === undefined ? 'orphaned' : getTerrainArtOccurrenceStatus(override, override.levelId, prepared, project);
    if (status !== 'active') diagnostics.push({ code: `occurrence-${status}`, path: `occurrenceOverrides[${index}]`, message: `${status === 'stale' ? 'Topology changed beneath' : status === 'hidden' ? 'Author hid' : 'No matching level or material for'} local override at ${override.dualX},${override.dualY}; it will be preserved but excluded.`, severity: 'warning' });
  });
  return diagnostics;
}
