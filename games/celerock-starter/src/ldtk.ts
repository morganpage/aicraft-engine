/**
 * LDtk world (§5.1/§5.2): golden-path load, the G3 preflight, the per-room
 * cache, and the painter over the surface cache.
 *
 * The painter is the whole point of this file. A per-frame `drawLdtkLevel`
 * re-bakes the level every frame and is a §12.8 failure; `createLdtkRoomPainter`
 * bakes once per room and blits once per frame at any fractional zoom.
 */
import {
  createLdtkRoomCache,
  createPrecisionPlatformerConfig,
  inspectLdtkPlatformerProject,
  loadLdtkProjectAssets,
  type LdtkRoomCache,
  type LdtkTilesetBundle,
  type PlatformerConfig,
} from 'aicraft-engine';
import { createLdtkRoomPainter, type LdtkRoomPainter } from './recipes/ldtk-draw-pipeline';

export const PROJECT_URL = `${import.meta.env.BASE_URL}celerock.ldtk`;

/**
 * ONE options object. §5.7's hot reload rebuilds the whole cache and must pass
 * exactly these — a second literal is how the swapped world quietly differs
 * from the booted one.
 */
export const ROOM_CACHE_OPTIONS = {
  playerWidthForTileSize: (ts: number) => 0.5 * ts,
  playerHeightForTileSize: (ts: number) => 1.5 * ts,
} as const;

/** The Celeste kit in tile units (§4.1). Stage 2 turns on the rest of it. */
export function playConfigFor(tileSize: number): Readonly<PlatformerConfig> {
  return {
    ...createPrecisionPlatformerConfig({
      tileSize,
      referenceTileSize: 16,
      jumpApexTiles: 81 / 16,
      timeToApex: 0.3,
      wallGrabEnabled: true,
      climbEnabled: true,
    }),
    groundDuckEnabled: false,
  };
}

export interface WorldLoad {
  readonly rooms: LdtkRoomCache;
  readonly tilesets: LdtkTilesetBundle;
  readonly painter: LdtkRoomPainter;
}

export interface LoadWorldOptions {
  /** Injectable fetch (tests stub it against public/ on disk). */
  fetch?: typeof fetch;
  /** Absolute URL override — the loader rejects relative URLs on hosts with no document.baseURI (Node). */
  projectUrl?: string;
  /** Injectable decode (tests stub it on hosts with no bitmap decoder). */
  decodeImage?: (bytes: Uint8Array, def: import('aicraft-engine').LdtkTilesetDef) => Promise<CanvasImageSource | undefined>;
}

/** Load + preflight. Returns null and logs on any hard failure — never fabricates. */
export async function loadWorld(options: LoadWorldOptions = {}): Promise<WorldLoad | null> {
  const loaded = await loadLdtkProjectAssets({
    projectUrl: options.projectUrl ?? PROJECT_URL,
    fetch: options.fetch,
    decodeImage: options.decodeImage,
  });
  if (!loaded.ok) {
    console.error('[celerock] LDtk assets failed to load', loaded);
    return null;
  }

  // §5.1 G3 — log the FULL report. A missing capability is information; no
  // spawns at all is a hard block, and you want to see it here rather than as
  // a blank screen three stages later.
  console.info('[celerock] preflight', inspectLdtkPlatformerProject(loaded.project));

  return {
    rooms: createLdtkRoomCache(loaded.project, ROOM_CACHE_OPTIONS),
    tilesets: loaded.tilesets,
    painter: createLdtkRoomPainter(loaded.tilesets),
  };
}
