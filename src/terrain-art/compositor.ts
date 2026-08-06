import { terrainArtMaterialResolution } from './constants';
import { deriveTerrainArtContour, generateTerrainArtCoverage } from './coverage';
import type {
  TerrainArtBlendMode,
  TerrainArtCoverage,
  TerrainArtDualGridMask,
  TerrainArtLayer,
  TerrainArtPalette,
  TerrainArtProject,
  TerrainArtRuleSet,
  TerrainArtSourceTile,
  TerrainArtTilesetBinding,
  TerrainMaterialDefinition,
  TerrainMaterialId,
  TerrainVariantDefinition,
  TerrainVariantId,
} from './types';

type Rgba = readonly [number, number, number, number];

/**
 * Map a 4-bit corner mask to its closest 3×3 neighbourhood, for rule-layer
 * preview/export only. The corner mask encodes which of the four logical cells
 * meeting at a dual-tile vertex are solid (NW=1, NE=2, SE=4, SW=8); the
 * neighbourhood mirrors that occupancy so a rule layer's single-tile preview
 * resolves to the whole tile a similar shape would pick at runtime. This is an
 * approximation by design — rule art is meant to be seen whole in the level,
 * not as a mask-shaped fragment.
 *
 * Slot order: `[NW, N, NE, W, C, E, SW, S, SE]`.
 */
function maskToNeighborhood(mask: TerrainArtDualGridMask): readonly number[] {
  const nw = (mask & 1) !== 0 ? 1 : 0;
  const ne = (mask & 2) !== 0 ? 1 : 0;
  const se = (mask & 4) !== 0 ? 1 : 0;
  const sw = (mask & 8) !== 0 ? 1 : 0;
  // A corner bit implies the two cardinals adjacent to it are likely solid too
  // (an outer corner only forms when the cardinal neighbours are empty). For a
  // preview we lean towards the filled interpretation so interior masks resolve
  // to the fill tile rather than a corner fragment.
  const n = nw || ne;
  const w = nw || sw;
  const e = ne || se;
  const s = sw || se;
  const center = (nw || ne || se || sw) ? 1 : 0;
  return [nw, n, ne, w, center, e, sw, s, se];
}

/**
 * What the compositor needs filled in for one `imported` layer contribution.
 *
 * The mask and variant are part of the request because imported art differs per
 * mask — a resolver backed by a tileset assembles a different quadrant
 * combination for each one. `tileset` carries the layer's slicing so a resolver
 * only has to supply pixels, not remember how any particular project cuts them.
 */
export interface TerrainArtImportedAssetRequest {
  readonly assetId: string;
  readonly materialId: TerrainMaterialId;
  readonly mask: TerrainArtDualGridMask;
  readonly variantId: TerrainVariantId;
  readonly width: number;
  readonly height: number;
  readonly tileset?: Readonly<TerrainArtTilesetBinding>;
  /** Auto-tiling rules for a `rule` layer. Present only for rule layers. */
  readonly rules?: Readonly<TerrainArtRuleSet>;
  /**
   * For a `rule` layer: the eight-neighbourhood to resolve, as a length-9 array
   * of `0|1` in `[NW,N,NE,W,C,E,SW,S,SE]` order. The compositor derives a
   * representative neighbourhood from `mask` for preview/export parity.
   */
  readonly neighborhood?: readonly number[];
}

/**
 * Supplies the pixels for one `imported` layer, or `null` when it cannot.
 *
 * Must return exactly `width * height * 4` RGBA bytes; anything else is ignored,
 * so a resolver that cannot serve a request should return `null` rather than a
 * best-effort buffer.
 */
export type TerrainArtImportedAssetResolver = (
  request: Readonly<TerrainArtImportedAssetRequest>,
) => Uint8ClampedArray | null;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function parseColor(value: string | undefined): Rgba {
  if (typeof value !== 'string') return [0, 0, 0, 0];
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);
  if (match?.[1] === undefined) return [0, 0, 0, 0];
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
    match[2] === undefined ? 255 : Number.parseInt(match[2], 16),
  ];
}

function unpackRgba(value: number): Rgba {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function paletteColor(
  palette: Readonly<TerrainArtPalette>,
  key: keyof TerrainArtPalette | undefined,
  fallback: keyof TerrainArtPalette,
): Rgba {
  return parseColor(palette[key ?? fallback]);
}

function blendChannel(mode: TerrainArtBlendMode, destination: number, source: number): number {
  switch (mode) {
    case 'multiply': return destination * source / 255;
    case 'screen': return 255 - (255 - destination) * (255 - source) / 255;
    case 'add': return Math.min(255, destination + source);
    default: return source;
  }
}

function blendPixel(
  pixels: Uint8ClampedArray,
  pixelIndex: number,
  source: Rgba,
  opacity: number,
  mode: TerrainArtBlendMode,
): void {
  const offset = pixelIndex * 4;
  const destinationAlpha = (pixels[offset + 3] ?? 0) / 255;
  const sourceAlpha = source[3] / 255 * clamp(opacity, 0, 1);
  if (mode === 'erase') {
    const nextAlpha = destinationAlpha * (1 - sourceAlpha);
    pixels[offset + 3] = Math.round(nextAlpha * 255);
    if (nextAlpha === 0) {
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
    }
    return;
  }
  if (sourceAlpha <= 0) return;
  if (mode === 'replace' && sourceAlpha >= 1) {
    pixels[offset] = source[0];
    pixels[offset + 1] = source[1];
    pixels[offset + 2] = source[2];
    pixels[offset + 3] = source[3];
    return;
  }
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  const destination = [
    pixels[offset] ?? 0,
    pixels[offset + 1] ?? 0,
    pixels[offset + 2] ?? 0,
  ] as const;
  for (let channel = 0; channel < 3; channel++) {
    const blended = blendChannel(mode, destination[channel]!, source[channel]!);
    const premultiplied = blended * sourceAlpha +
      destination[channel]! * destinationAlpha * (1 - sourceAlpha);
    pixels[offset + channel] = outputAlpha <= 0 ? 0 : Math.round(premultiplied / outputAlpha);
  }
  pixels[offset + 3] = Math.round(outputAlpha * 255);
}

function renderCoverageColor(
  target: Uint8ClampedArray,
  coverage: Uint8Array,
  color: Rgba,
  layer: Readonly<TerrainArtLayer>,
): void {
  const opacity = Number.isFinite(layer.opacity) ? layer.opacity : 1;
  for (let index = 0; index < coverage.length; index++) {
    const amount = (coverage[index] ?? 0) / 255;
    if (amount <= 0) continue;
    blendPixel(target, index, color, opacity * amount, layer.blendMode);
  }
}

function boundaryBand(
  coverage: Readonly<TerrainArtCoverage>,
  depth: number,
  direction: 'top' | 'side',
): Uint8Array {
  const size = coverage.resolution;
  const band = new Uint8Array(size * size);
  const distance = clamp(Math.round(depth), 0, Math.floor(size / 2));
  if (distance === 0) return band;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x;
      if (coverage.pixels[index] === 0) continue;
      for (let step = 1; step <= distance; step++) {
        const samples = direction === 'top'
          ? [[x, y - step]] as const
          : [[x - step, y], [x + step, y], [x, y + step]] as const;
        if (samples.some(([sampleX, sampleY]) =>
          sampleX >= 0 && sampleY >= 0 && sampleX < size && sampleY < size &&
          coverage.pixels[sampleY * size + sampleX] === 0)) {
          band[index] = 255;
          break;
        }
      }
    }
  }
  return band;
}

function hash32(seed: number, mask: number, x: number, y: number): number {
  let value = (seed ^ Math.imul(mask + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ x, 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ y, 0xc2b2ae35) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

function decorationCoverage(
  coverage: Readonly<TerrainArtCoverage>,
  density: number,
  scale: number,
  seed: number,
): Uint8Array {
  const result = new Uint8Array(coverage.pixels.length);
  const chance = clamp(density, 0, 1);
  const step = clamp(Math.round(scale), 1, Math.max(1, coverage.resolution));
  if (chance <= 0) return result;
  for (let y = 0; y < coverage.resolution; y += step) {
    for (let x = 0; x < coverage.resolution; x += step) {
      const index = y * coverage.resolution + x;
      if (coverage.pixels[index] === 0) continue;
      if (hash32(seed, coverage.mask, x, y) / 0xffffffff > chance) continue;
      for (let oy = 0; oy < step; oy++) {
        for (let ox = 0; ox < step; ox++) {
          const targetX = x + ox;
          const targetY = y + oy;
          if (targetX >= coverage.resolution || targetY >= coverage.resolution) continue;
          const target = targetY * coverage.resolution + targetX;
          if (coverage.pixels[target] !== 0) result[target] = 255;
        }
      }
    }
  }
  return result;
}

function applyManualLayer(
  target: Uint8ClampedArray,
  coverage: Readonly<TerrainArtCoverage>,
  material: Readonly<TerrainMaterialDefinition>,
  layer: Readonly<TerrainArtLayer>,
  variantId: string,
): void {
  const patches = Array.isArray(layer.patches) ? layer.patches : [];
  for (const patch of patches) {
    if (patch.mask !== coverage.mask || patch.variantId !== variantId || !Array.isArray(patch.runs)) continue;
    for (const run of patch.runs) {
      if (
        !Number.isInteger(run.y) || !Number.isInteger(run.x) ||
        !Number.isInteger(run.length) || run.length <= 0 ||
        run.y < 0 || run.y >= coverage.resolution
      ) continue;
      const start = Math.max(0, run.x);
      const end = Math.min(coverage.resolution, run.x + run.length);
      const color = run.colorRef !== undefined
        ? paletteColor(material.palette, run.colorRef, 'accent')
        : unpackRgba(run.rgba ?? 0);
      for (let x = start; x < end; x++) {
        const index = run.y * coverage.resolution + x;
        if (layer.clipMode !== 'none' && coverage.pixels[index] === 0) continue;
        if (run.mode === 'erase') {
          blendPixel(target, index, [0, 0, 0, 255], layer.opacity, 'erase');
        } else {
          blendPixel(target, index, color, layer.opacity, layer.blendMode);
        }
      }
    }
  }
}

function selectedVariant(
  material: Readonly<TerrainMaterialDefinition>,
  requestedId: string,
): Readonly<TerrainVariantDefinition> | null {
  return material.variants.find((variant) => variant.enabled && variant.id === requestedId) ??
    material.variants.find((variant) => variant.enabled) ?? null;
}

function emptyTile(
  project: Readonly<TerrainArtProject>,
  materialId: string,
  mask: TerrainArtDualGridMask,
  variantId: string,
): TerrainArtSourceTile {
  const size = terrainArtMaterialResolution(
    project.authoringResolution,
    project.materials.find((candidate) => candidate.id === materialId)?.resolution,
  );
  return Object.freeze({
    materialId,
    variantId,
    mask,
    width: size,
    height: size,
    pixels: new Uint8ClampedArray(size * size * 4),
  });
}

/** Flatten one reusable material/mask/variant through its ordered art layers. */
export function renderTerrainArtSourceTile(
  project: Readonly<TerrainArtProject>,
  materialId: string,
  mask: TerrainArtDualGridMask,
  requestedVariantId = 'default',
  resolveImportedAsset?: TerrainArtImportedAssetResolver,
): TerrainArtSourceTile {
  const material = project.materials.find((candidate) => candidate.id === materialId);
  if (material === undefined || !material.enabled || mask < 0 || mask > 15) {
    return emptyTile(project, materialId, mask, requestedVariantId);
  }
  const variant = selectedVariant(material, requestedVariantId);
  const variantId = variant?.id ?? requestedVariantId;
  const coverage = generateTerrainArtCoverage({
    mask,
    resolution: terrainArtMaterialResolution(project.authoringResolution, material.resolution),
    roundness: material.generator.roundness,
  });
  if (coverage.resolution === 0) return emptyTile(project, materialId, mask, variantId);
  const pixels = new Uint8ClampedArray(coverage.resolution * coverage.resolution * 4);

  for (const layer of material.layers) {
    if (!layer.visible) continue;
    switch (layer.type) {
      case 'base':
        renderCoverageColor(pixels, coverage.pixels, parseColor(material.palette.fill), layer);
        break;
      case 'shading': {
        const side = boundaryBand(coverage, material.generator.sideShadeDepth, 'side');
        renderCoverageColor(pixels, side, parseColor(material.palette.shadow), layer);
        const top = boundaryBand(coverage, material.generator.topHighlightDepth, 'top');
        renderCoverageColor(pixels, top, parseColor(material.palette.highlight), layer);
        break;
      }
      case 'contour':
        renderCoverageColor(
          pixels,
          deriveTerrainArtContour(
            coverage,
            material.generator.contourWidth,
            material.generator.contourPlacement,
          ),
          parseColor(material.palette.contour),
          layer,
        );
        break;
      case 'decoration':
        renderCoverageColor(
          pixels,
          decorationCoverage(
            coverage,
            material.generator.detailDensity,
            material.generator.detailScale,
            project.visualSeed + (variant?.seedOffset ?? 0),
          ),
          parseColor(material.palette.detail),
          layer,
        );
        break;
      case 'manual':
        applyManualLayer(pixels, coverage, material, layer, variantId);
        break;
      case 'imported': {
        // @deprecated The `'imported'` quarter-tile path slices conventional
        // whole-tile tilesets (e.g. Kenney) into corner fragments and clips
        // them to the dual-grid coverage silhouette — which destroys authored
        // art and produced the import artifacts this engine moved away from.
        // New work should use the LDtk pipeline (`src/ldtk/`) for real
        // auto-tiled tilesets, or the `'rule'` layer for in-engine whole-tile
        // auto-tiling. Retained for backward compatibility only.
        if (layer.assetId === undefined || resolveImportedAsset === undefined) break;
        const imported = resolveImportedAsset({
          assetId: layer.assetId,
          materialId,
          mask,
          variantId,
          width: coverage.resolution,
          height: coverage.resolution,
          ...(layer.tileset === undefined ? {} : { tileset: layer.tileset }),
        });
        if (imported?.length === pixels.length) for (let index = 0; index < coverage.pixels.length; index++) {
          if (layer.clipMode !== 'none' && coverage.pixels[index] === 0) continue;
          const offset = index * 4; blendPixel(pixels, index, [imported[offset] ?? 0, imported[offset + 1] ?? 0, imported[offset + 2] ?? 0, imported[offset + 3] ?? 0], layer.opacity, layer.blendMode);
        }
        break;
      }
      case 'rule': {
        // Rule layers render through the whole-tile path (drawPreparedTerrainArtRuleGrid),
        // not this mask-shaped compositor. This case exists only so a single source-tile
        // preview / contact-sheet export resolves to a representative whole tile: derive
        // the closest 3×3 neighbourhood from the corner mask and ask the resolver for the
        // matching rule's tile, clipped to the coverage silhouette like any other layer.
        if (layer.assetId === undefined || layer.rules === undefined || resolveImportedAsset === undefined) break;
        const neighborhood = maskToNeighborhood(mask);
        const imported = resolveImportedAsset({
          assetId: layer.assetId,
          materialId,
          mask,
          variantId,
          width: coverage.resolution,
          height: coverage.resolution,
          rules: layer.rules,
          neighborhood,
        });
        if (imported?.length === pixels.length) for (let index = 0; index < coverage.pixels.length; index++) {
          if (layer.clipMode !== 'none' && coverage.pixels[index] === 0) continue;
          const offset = index * 4; blendPixel(pixels, index, [imported[offset] ?? 0, imported[offset + 1] ?? 0, imported[offset + 2] ?? 0, imported[offset + 3] ?? 0], layer.opacity, layer.blendMode);
        }
        break;
      }
    }
  }

  return Object.freeze({
    materialId,
    variantId,
    mask,
    width: coverage.resolution,
    height: coverage.resolution,
    pixels,
  });
}
