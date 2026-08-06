import {
  MAX_TERRAIN_ART_RESOLUTION,
  MIN_TERRAIN_ART_RESOLUTION,
  TERRAIN_ART_PROJECT_VERSION,
} from './constants';
import type {
  TerrainArtDiagnostic,
  TerrainArtValidationResult,
} from './types';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function diagnostic(
  diagnostics: TerrainArtDiagnostic[],
  code: string,
  path: string,
  message: string,
): void {
  diagnostics.push(Object.freeze({ code, path, message, severity: 'error' }));
}

/** Validate an untrusted terrain-art source value without throwing. */
export function validateTerrainArtProject(value: unknown): TerrainArtValidationResult {
  const diagnostics: TerrainArtDiagnostic[] = [];
  const project = record(value);
  if (project === null) {
    diagnostic(diagnostics, 'invalid-project', '', 'Terrain art must be an object.');
    return Object.freeze({ valid: false, diagnostics: Object.freeze(diagnostics) });
  }
  if (project.version !== TERRAIN_ART_PROJECT_VERSION) {
    diagnostic(diagnostics, 'unsupported-version', 'version', 'Unsupported terrain-art version.');
  }
  if (typeof project.id !== 'string' || project.id.trim() === '') {
    diagnostic(diagnostics, 'invalid-id', 'id', 'Project id must be a non-empty string.');
  }
  if (typeof project.name !== 'string' || project.name.trim() === '') {
    diagnostic(diagnostics, 'invalid-name', 'name', 'Project name must be a non-empty string.');
  }
  if (
    !Number.isInteger(project.authoringResolution) ||
    (project.authoringResolution as number) < MIN_TERRAIN_ART_RESOLUTION ||
    (project.authoringResolution as number) > MAX_TERRAIN_ART_RESOLUTION
  ) {
    diagnostic(diagnostics, 'invalid-resolution', 'authoringResolution', 'Resolution is outside supported bounds.');
  }
  if (!Number.isFinite(project.visualSeed)) {
    diagnostic(diagnostics, 'invalid-seed', 'visualSeed', 'Visual seed must be finite.');
  }

  const materials = Array.isArray(project.materials) ? project.materials : [];
  if (materials.length === 0) {
    diagnostic(diagnostics, 'missing-materials', 'materials', 'At least one material is required.');
  }
  if (materials.length > 64) diagnostic(diagnostics, 'too-many-materials', 'materials', 'At most 64 materials are supported.');
  const materialIds = new Set<string>();
  materials.forEach((value, index) => {
    const material = record(value);
    const path = `materials[${index}]`;
    if (material === null || typeof material.id !== 'string' || material.id.trim() === '') {
      diagnostic(diagnostics, 'invalid-material', path, 'Material must have a non-empty id.');
      return;
    }
    if (materialIds.has(material.id)) {
      diagnostic(diagnostics, 'duplicate-material-id', `${path}.id`, 'Material ids must be unique.');
    }
    materialIds.add(material.id);
    if (
      material.resolution !== undefined &&
      (!Number.isInteger(material.resolution) ||
        (material.resolution as number) < MIN_TERRAIN_ART_RESOLUTION ||
        (material.resolution as number) > MAX_TERRAIN_ART_RESOLUTION)
    ) {
      diagnostic(diagnostics, 'invalid-material-resolution', `${path}.resolution`, 'Material resolution is outside supported bounds.');
    }
    if (!Array.isArray(material.layers) || material.layers.length === 0) {
      diagnostic(diagnostics, 'missing-layers', `${path}.layers`, 'Material requires at least one layer.');
    }
    if (Array.isArray(material.layers) && material.layers.length > 32) diagnostic(diagnostics, 'too-many-layers', `${path}.layers`, 'At most 32 layers are supported per material.');
    if (Array.isArray(material.layers)) material.layers.forEach((layerValue, layerIndex) => {
      const artLayer = record(layerValue); const layerPath = `${path}.layers[${layerIndex}]`;
      if (artLayer === null || typeof artLayer.id !== 'string' || typeof artLayer.type !== 'string') diagnostic(diagnostics, 'invalid-layer', layerPath, 'Layer requires id and type.');
      const patches = Array.isArray(artLayer?.patches) ? artLayer.patches : [];
      if (patches.length > 256) diagnostic(diagnostics, 'too-many-patches', `${layerPath}.patches`, 'At most 256 patches are supported per layer.');
      patches.forEach((patchValue, patchIndex) => {
        const patch = record(patchValue); const runs = Array.isArray(patch?.runs) ? patch.runs : [];
        if (runs.length > 65536) diagnostic(diagnostics, 'too-many-pixel-runs', `${layerPath}.patches[${patchIndex}].runs`, 'Manual patch exceeds the run safety limit.');
      });
    });
    if (!Array.isArray(material.variants) || material.variants.length === 0) {
      diagnostic(diagnostics, 'missing-variants', `${path}.variants`, 'Material requires at least one variant.');
    }
    if (Array.isArray(material.variants) && material.variants.length > 64) diagnostic(diagnostics, 'too-many-variants', `${path}.variants`, 'At most 64 variants are supported per material.');
  });

  const terrainKinds = Array.isArray(project.terrainKinds) ? project.terrainKinds : [];
  if (terrainKinds.length === 0) {
    diagnostic(diagnostics, 'missing-terrain-kinds', 'terrainKinds', 'At least one terrain kind is required.');
  }
  const kindIds = new Set<string>();
  const tileValues = new Set<number>();
  terrainKinds.forEach((value, index) => {
    const kind = record(value);
    const path = `terrainKinds[${index}]`;
    if (kind === null || typeof kind.id !== 'string' || kind.id.trim() === '') {
      diagnostic(diagnostics, 'invalid-terrain-kind', path, 'Terrain kind must have a non-empty id.');
      return;
    }
    if (kindIds.has(kind.id)) {
      diagnostic(diagnostics, 'duplicate-terrain-kind-id', `${path}.id`, 'Terrain-kind ids must be unique.');
    }
    kindIds.add(kind.id);
    if (!Number.isFinite(kind.tileValue)) {
      diagnostic(diagnostics, 'invalid-tile-value', `${path}.tileValue`, 'Tile value must be finite.');
    } else if (tileValues.has(kind.tileValue as number)) {
      diagnostic(diagnostics, 'duplicate-tile-value', `${path}.tileValue`, 'Tile values must be unique.');
    } else {
      tileValues.add(kind.tileValue as number);
    }
    if (
      kind.materialId !== null &&
      (typeof kind.materialId !== 'string' || !materialIds.has(kind.materialId))
    ) {
      diagnostic(diagnostics, 'missing-material', `${path}.materialId`, 'Terrain kind references a missing material.');
    }
  });

  if (!Array.isArray(project.transitionRules)) {
    diagnostic(diagnostics, 'invalid-transition-rules', 'transitionRules', 'Transition rules must be an array.');
  }
  if (Array.isArray(project.transitionRules)) project.transitionRules.forEach((ruleValue, index) => {
    const rule = record(ruleValue); if (rule === null || typeof rule.foregroundMaterialId !== 'string' || typeof rule.backgroundMaterialId !== 'string' || !materialIds.has(rule.foregroundMaterialId) || !materialIds.has(rule.backgroundMaterialId)) diagnostic(diagnostics, 'invalid-transition-material', `transitionRules[${index}]`, 'Transition references a missing material.');
  });
  if (!Array.isArray(project.occurrenceOverrides)) {
    diagnostic(diagnostics, 'invalid-occurrence-overrides', 'occurrenceOverrides', 'Occurrence overrides must be an array.');
  }
  if (Array.isArray(project.occurrenceOverrides) && project.occurrenceOverrides.length > 10000) diagnostic(diagnostics, 'too-many-occurrence-overrides', 'occurrenceOverrides', 'Occurrence override safety limit exceeded.');

  return Object.freeze({
    valid: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
  });
}
