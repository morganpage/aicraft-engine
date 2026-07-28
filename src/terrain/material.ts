/**
 * Validated terrain materials. Author-facing inputs never enter draw hot paths.
 *
 * @module
 */

import { safeHex, shade } from '../primitives/color';
import { visualChannel } from '../rng/visual-seed';
import type {
  BuiltinEdgeDetail,
  BuiltinSurfaceDetail,
  TerrainMaterialInput,
  TerrainPalette,
} from './types';

const normalized = Symbol('normalized-terrain-material');
const materialTable = Symbol('terrain-material-table');

export interface NormalizedTerrainMaterial {
  readonly [normalized]: true;
  readonly id: string;
  readonly channelId: number;
  readonly palette: Required<Readonly<TerrainPalette>>;
  readonly topThickness: number;
  readonly sideDepth: number;
  readonly outlineWidth: number;
  readonly cornerSize: number;
  readonly surfaceDetail: BuiltinSurfaceDetail;
  readonly detailDensity: number;
  readonly detailScale: number;
  readonly edgeDetail: BuiltinEdgeDetail;
  readonly edgeDensity: number;
  readonly edgeScale: number;
}

export interface TerrainMaterialTable {
  readonly [materialTable]: true;
  readonly get: (tileValue: number) => NormalizedTerrainMaterial | undefined;
}

const DETAILS: ReadonlySet<string> = new Set([
  'none', 'mortar', 'cracks', 'rivulets', 'rivets', 'crystal',
]);

const EDGES: ReadonlySet<string> = new Set([
  'none', 'chipped', 'stonework', 'rocky', 'beveled', 'grass',
]);

function finiteClamp(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value ?? fallback)) : fallback;
}

export function normalizeTerrainMaterial(
  input: Readonly<TerrainMaterialInput> | NormalizedTerrainMaterial,
): NormalizedTerrainMaterial {
  if (normalized in input && input[normalized] === true) return input;
  const id = typeof input.id === 'string' && input.id.length > 0 ? input.id : 'terrain';
  const fill = safeHex(input.palette?.fill, '#777777');
  const palette = {
    fill,
    top: safeHex(input.palette?.top, shade(fill, 1.25)),
    side: safeHex(input.palette?.side, shade(fill, 0.76)),
    shadow: safeHex(input.palette?.shadow, shade(fill, 0.5)),
    outline: safeHex(input.palette?.outline, shade(fill, 0.32)),
    detail: safeHex(input.palette?.detail, shade(fill, 0.62)),
    accent: safeHex(input.palette?.accent, shade(fill, 1.45)),
  };
  const detail = DETAILS.has(input.surfaceDetail ?? '')
    ? input.surfaceDetail as BuiltinSurfaceDetail
    : 'none';
  const edgeDetail = EDGES.has(input.edgeDetail ?? '')
    ? input.edgeDetail as BuiltinEdgeDetail
    : 'none';
  return Object.freeze({
    [normalized]: true as const,
    id,
    channelId: visualChannel(id),
    palette: Object.freeze(palette),
    topThickness: finiteClamp(input.topThickness, 3, 0, 16),
    sideDepth: finiteClamp(input.sideDepth, 4, 0, 24),
    outlineWidth: finiteClamp(input.outlineWidth, 1, 0, 4),
    cornerSize: finiteClamp(input.cornerSize, 2, 0, 8),
    surfaceDetail: detail,
    detailDensity: finiteClamp(input.detailDensity, 0.28, 0, 1),
    detailScale: finiteClamp(input.detailScale, 1, 0.25, 4),
    edgeDetail,
    edgeDensity: finiteClamp(input.edgeDensity, 0.38, 0, 1),
    edgeScale: finiteClamp(input.edgeScale, 1, 0.5, 4),
  });
}

export function createTerrainMaterialTable(
  entries: Readonly<Record<number, Readonly<TerrainMaterialInput>>>,
): TerrainMaterialTable {
  const values = new Map<number, NormalizedTerrainMaterial>();
  for (const [key, value] of Object.entries(entries ?? {})) {
    const tileValue = Number(key);
    if (Number.isFinite(tileValue) && value !== null && typeof value === 'object') {
      values.set(tileValue, normalizeTerrainMaterial(value));
    }
  }
  return Object.freeze({
    [materialTable]: true as const,
    get: (tileValue: number) => values.get(tileValue),
  });
}

export const RUINS_TERRAIN_MATERIAL = normalizeTerrainMaterial({
  id: 'ruins',
  palette: { fill: '#735846', top: '#b49872', side: '#594033', outline: '#241b1c', detail: '#49352c' },
  edgeDetail: 'stonework',
  edgeDensity: 0.82,
});

export const CAVERN_TERRAIN_MATERIAL = normalizeTerrainMaterial({
  id: 'cavern',
  palette: { fill: '#51445d', top: '#8a7891', side: '#3b3047', outline: '#1c1724', detail: '#32283d', accent: '#bca8cb' },
  edgeDetail: 'rocky',
  edgeDensity: 0.76,
});

export const MECHANICAL_TERRAIN_MATERIAL = normalizeTerrainMaterial({
  id: 'mechanical',
  palette: { fill: '#52616b', top: '#9dabb0', side: '#36434d', outline: '#172027', detail: '#26333b', accent: '#d7a84b' },
  edgeDetail: 'beveled',
});

export const OUTDOOR_TERRAIN_MATERIAL = normalizeTerrainMaterial({
  id: 'outdoor',
  palette: {
    fill: '#765035',
    top: '#6f9f46',
    side: '#422c20',
    outline: '#251c17',
    detail: '#345b2d',
    accent: '#9bc764',
  },
  topThickness: 4,
  sideDepth: 5,
  cornerSize: 3,
  edgeDetail: 'grass',
  edgeDensity: 0.88,
});
