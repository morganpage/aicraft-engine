/**
 * Animated Mob overlay for the LDtk editor.
 *
 * When the 1-bit platformer sample is open, the two Mob entities animate in
 * place as patrolling enemies drawn from the Kenney sprite sheet — the same
 * `src/sprites/` pipeline the `sprite-demo` showcase proves end-to-end. Each
 * Mob's `patrol` field (`Array<Point>` of grid cells) defines its path: the
 * enemy ping-pongs along the spawn position followed by the patrol waypoints,
 * advancing its `walk` cycle as it goes.
 *
 * This is editor chrome, not a runtime change: the level renderer
 * (`drawLdtkLevel`) skips Entities layers by design, and `drawEntities` draws
 * them as static rects. Here we overlay animated sprites on top of the scene
 * (on every layer, so the mobs are visible the moment the sample loads even
 * though the editor defaults to the Collisions layer), and we tell the editor
 * to skip the static body fill for any mob we are animating so the rect does
 * not show through the sprite.
 *
 * The pure helpers (`mobPatrolWaypoints`, `assignMobCharacter`) are exported
 * for unit tests, mirroring `play.ts`'s ladder helpers.
 */

import {
  compileSpriteSheet,
  createSpriteAnimState,
  advanceSpriteAnim,
  currentFrameIndex,
  drawSprite,
  parseSpriteSheet,
  resolveAnim,
  createSpriteTintCache,
  type CompiledSpriteSheet,
  type SpriteAnimState,
  type SpriteTintCache,
} from '../../../src/sprites';
import type {
  LdtkEntityInstance,
  LdtkLevel,
  LdtkProject,
} from '../../../src/ldtk';

// Vite imports the JSON as a parsed object and the PNG as a URL string; the
// sprite parser takes a JSON string, so we re-stringify. Mirrors
// `sections/sprite-demo.ts`. Both assets live in the canonical `assets/` tree.
import sheetJsonObject from '../../../assets/sprites/samples/kenney-1bit.json';
import sheetPngUrl from '../../../assets/vendor/kenney-1-bit-platformer/Tilemap/monochrome_tilemap_transparent_packed.png';
// The knight comes from 0x72's DungeonTileset II (CC0): a full-color sheet, so
// unlike the 1-bit Kenney art it is drawn WITHOUT a tint (see `SpriteBundle.colored`).
import knightSheetJsonObject from '../../../assets/sprites/samples/knight-0x72.json';
import knightSheetPngUrl from '../../../assets/vendor/0x72/0x72_DungeonTilesetII_v1.7.png';

// --- Constants ------------------------------------------------------------

/** Sample file name that ships the two Mob entities this overlay animates. */
export const ONE_BIT_PLATFORMER_SAMPLE = 'Typical_1-bit_platformer.ldtk';

/**
 * The full-color 2D platformer sample. This is the sample the 0x72 knight is
 * the player for (see `loadKnightBundle`): it ships a `Player` entity, three
 * patrolling `Mob` entities, and the SunnyLand tileset. Its Mobs are left as
 * the editor's default static rects — only the player is sprite-rendered here.
 */
export const TWO_D_PLATFORMER_SAMPLE = 'Typical_2D_platformer_example.ldtk';

/** Patrol speed in level pixels per second (mirrors sprite-demo enemy feel). */
const PATROL_SPEED_PX = 38;

/** Distance, in pixels, at which a waypoint is considered reached. */
const WAYPOINT_EPSILON = 0.5;

/**
 * How fast sprite animations advance relative to real time. The Kenney walk
 * cycles are 2-frame, so at real time (1.0) they shuffle at ~5Hz — too jittery
 * for these small sprites. Half-speed reads as a deliberate amble without
 * slowing the actual patrol movement (which is paced separately in px/s).
 *
 * Applied to every sprite anim clock (player and mobs, editor and play) so the
 * whole cast breathes at the same rate.
 */
export const SPRITE_ANIM_TIME_SCALE = 0.5;

/**
 * Tints that distinguish the two enemy types and the player against the 1-bit
 * white ink. Kept in sync with `sprite-demo.ts` so the editor and the playable
 * demo agree.
 */
const TINT_PLAYER = '#9ad0ff';
const TINT_SLIME = '#7dffa6';
const TINT_WALKER = '#ff9ad0';

// --- Pure helpers (unit-tested) -------------------------------------------

/** The two enemy characters defined on the Kenney sheet. */
export type MobCharacter = 'slime' | 'walker';

/**
 * Assign a character to a mob by encounter order: the first Mob is a slime,
 * the second a walker, and any further mobs cycle.
 */
export function assignMobCharacter(index: number): MobCharacter {
  return index % 2 === 0 ? 'slime' : 'walker';
}

/** A point in level pixels. */
export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The patrol path for a Mob, in level pixels: its own spawn position followed
 * by each patrol waypoint converted from grid cells to pixels. The spawn is
 * seeded first so a single-waypoint patrol still has somewhere to return to
 * (the runtime ping-pong needs at least two points to move).
 *
 * Returns an empty array for anything that is not a Mob (this overlay only
 * animates Mobs), or a Mob with no usable patrol — the caller leaves such a
 * mob animating in place.
 */
export function mobPatrolWaypoints(
  entity: Readonly<LdtkEntityInstance>,
  gridSize: number,
): PixelPoint[] {
  if (entity.__identifier.toLowerCase() !== 'mob') return [];
  const field = entity.fieldInstances.find((f) => f.__identifier.toLowerCase() === 'patrol');
  const value = field?.__value;
  if (!Array.isArray(value) || value.length === 0) return [];

  const out: PixelPoint[] = [{ x: entity.px[0], y: entity.px[1] }];
  for (const point of value) {
    if (point === null || typeof point !== 'object') continue;
    const p = point as { cx?: unknown; cy?: unknown };
    if (typeof p.cx !== 'number' || typeof p.cy !== 'number') continue;
    out.push({ x: p.cx * gridSize, y: p.cy * gridSize });
  }
  return out;
}

/**
 * Advance a ping-pong cursor toward the next waypoint and return the updated
 * state. Pure: the caller reassigns. `index` is the current target within
 * `waypoints`; `direction` is `+1` (moving forward through the list) or `-1`
 * (moving back). On reaching the last/first waypoint the direction reverses.
 *
 * Exported for unit tests; the overlay calls it from its `step`.
 */
export function nextPatrolTarget(
  position: PixelPoint,
  target: PixelPoint,
  index: number,
  direction: 1 | -1,
  waypoints: readonly PixelPoint[],
): { index: number; direction: 1 | -1 } {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  if (Math.hypot(dx, dy) > WAYPOINT_EPSILON) return { index, direction };
  let nextDir: 1 | -1 = direction;
  let nextIndex = index + direction;
  if (nextIndex >= waypoints.length) {
    nextIndex = waypoints.length - 2;
    nextDir = -1;
  } else if (nextIndex < 0) {
    nextIndex = 1;
    nextDir = 1;
  }
  // A single-point path has no second waypoint to bounce to — stay put.
  if (nextIndex < 0 || nextIndex >= waypoints.length) return { index, direction };
  return { index: nextIndex, direction: nextDir };
}

// --- Sprite bundle (shared by edit + play) --------------------------------

/**
 * Parsed + decoded sprite assets, ready to blit. Built once per level load and
 * shared between the editor overlay and the play session so the same sheet,
 * image, and tint cache serve both — no double-decode of the PNG.
 */
export interface SpriteBundle {
  readonly compiled: CompiledSpriteSheet;
  readonly image: CanvasImageSource;
  readonly tintCache: SpriteTintCache;
  /**
   * The character name used to resolve the PLAYER's animations on this sheet
   * (e.g. `'player'` on the Kenney sheet, `'knight'` on the 0x72 sheet). Mobs
   * still resolve to their own character names (`'slime'`/`'walker'`).
   */
  readonly playerCharacter: string;
  /**
   * `true` when the sheet's art is already full-color (0x72 DungeonTileset II).
   * Such sprites are drawn WITHOUT a tint — the `source-in` recolor path is for
   * monochrome (1-bit white) art like Kenney's. `false` (the default) keeps the
   * legacy tinting that distinguishes player/enemies against 1-bit ink.
   */
  readonly colored: boolean;
}

/**
 * The tint applied to the player on a 1-bit (monochrome) sheet, or `undefined`
 * on a colored sheet so the raw art shows through. Exposed for unit tests.
 */
export function playerTintFor(bundle: Pick<SpriteBundle, 'colored'>): string | undefined {
  return bundle.colored ? undefined : TINT_PLAYER;
}

/**
 * Parse + compile a sheet and decode its PNG. Returns `null` on any failure
 * (parse or decode); callers degrade to the non-sprite rendering path.
 *
 * `sheet`/`png` default to the Kenney 1-bit pair so existing callers are
 * unchanged; the knight path passes the 0x72 sheet + PNG and `colored: true`.
 */
async function loadBundle(
  sheetJsonObject: unknown,
  pngUrl: string,
  playerCharacter: string,
  colored: boolean,
): Promise<SpriteBundle | null> {
  const parsed = parseSpriteSheet(JSON.stringify(sheetJsonObject));
  if (!parsed.ok || !parsed.sheet) return null;
  const compiled = compileSpriteSheet(parsed.sheet).sheet;
  const image = await decodeImage(pngUrl).catch(() => null);
  if (image === null) return null;
  return { compiled, image, tintCache: createSpriteTintCache(), playerCharacter, colored };
}

/**
 * Load the Kenney 1-bit sheet (player + slime/walker mobs). Returns `null` on
 * any failure; callers degrade to the non-sprite rendering path.
 */
export async function loadSpriteBundle(): Promise<SpriteBundle | null> {
  return loadBundle(sheetJsonObject, sheetPngUrl, 'player', false);
}

/**
 * Load the 0x72 DungeonTileset II knight sheet. Used as the player for the
 * 1-bit platformer sample; the sheet is full-color, so `colored: true` disables
 * tinting. Returns `null` on any failure.
 */
export async function loadKnightBundle(): Promise<SpriteBundle | null> {
  return loadBundle(knightSheetJsonObject, knightSheetPngUrl, 'knight', true);
}

/**
 * Draw one player sprite frame. The anim kind (`'idle'`/`'walk'`/`'ascent'`/…)
 * is chosen by the caller from physics via `deriveSpriteAnimKind`; this just
 * resolves the clip, advances nothing, and blits the current frame bottom-
 * anchored to `bodyHeight` (so a tall body meets the ground at the sprite's
 * feet). Returns `false` if no frame could be drawn — the caller then falls
 * back to its rect.
 *
 * The character name and whether the art is tinted both come from the bundle:
 * the Kenney sheet resolves `'player'` with a blue tint, the 0x72 knight sheet
 * resolves `'knight'` with no tint (full-color art).
 */
export function drawPlayerSprite(
  ctx: CanvasRenderingContext2D,
  bundle: SpriteBundle,
  animState: SpriteAnimState,
  kind: string,
  destX: number,
  destY: number,
  facing: 1 | -1,
  destSize: number,
): boolean {
  return drawCharacter(
    ctx,
    bundle,
    bundle.playerCharacter,
    kind,
    animState,
    destX,
    destY,
    facing,
    playerTintFor(bundle),
    destSize,
  );
}

/**
 * Blit one sprite frame for a character/anim. The sprite source is square
 * (16px); `destSize` is the on-canvas edge length, and the frame is drawn at
 * `(destX, destY)` with that size. Mirrors `sprite-demo.ts`'s `drawCharacter`
 * but takes the bundle as a parameter so edit and play can share it.
 *
 * `tint` is optional: pass a color to recolor monochrome art (Kenney 1-bit),
 * or `undefined` to draw the sheet's full-color pixels as-is (0x72 knight).
 */
function drawCharacter(
  ctx: CanvasRenderingContext2D,
  bundle: SpriteBundle,
  character: string,
  animKey: string,
  animState: SpriteAnimState,
  destX: number,
  destY: number,
  facing: 1 | -1,
  tint: string | undefined,
  destSize: number,
): boolean {
  const anim = resolveAnim(bundle.compiled, character, animKey);
  if (anim === undefined) return false;
  const slot = currentFrameIndex(animState, anim);
  if (slot === undefined) return false;
  const frameIndex = anim.frameIndices[slot];
  if (frameIndex === undefined) return false;
  return drawSprite(ctx, bundle.image, bundle.compiled, frameIndex, destX, destY, {
    facing,
    ...(tint === undefined ? {} : { tint, tintCache: bundle.tintCache }),
    destWidth: destSize,
    destHeight: destSize,
  });
}

// --- Mob actors (sim + draw, reusable) -------------------------------------

/** The animated state for one Mob. */
interface MobState {
  readonly iid: string;
  readonly character: MobCharacter;
  readonly width: number;
  readonly height: number;
  /** Patrol path in level pixels (spawn first). Empty = stay put. */
  readonly waypoints: readonly PixelPoint[];
  x: number;
  y: number;
  facing: 1 | -1;
  /** Index into `waypoints` of the current target. */
  targetIndex: number;
  /** Travel direction through the waypoint list (+1 / -1). */
  direction: 1 | -1;
  animState: SpriteAnimState;
}

/**
 * The patrolling-mob simulation and its draw, decoupled from how the host
 * applies a camera transform. `step` advances the patrol kinematics and each
 * mob's `walk` clock; `draw` blits the current frame of every mob at its level
 * position plus an optional pixel `offset` (the camera translation the play
 * session applies — the editor overlay applies its own transform and passes
 * `{0,0}`). Shared by the editor overlay and the play session.
 */
export class MobActors {
  private disposed = false;
  constructor(
    private readonly bundle: SpriteBundle,
    private readonly mobs: MobState[],
  ) {}

  get animatedIids(): ReadonlySet<string> {
    return new Set(this.mobs.map((m) => m.iid));
  }

  get count(): number {
    return this.mobs.length;
  }

  step(dt: number): void {
    if (this.disposed || dt <= 0) return;
    const dtClamped = Math.min(dt, 1 / 20); // avoid tunneling on a stalled frame
    for (const mob of this.mobs) {
      // Anim clock advances at the scaled rate; patrol movement uses real `dt`.
      mob.animState = advanceSpriteAnim(mob.animState, dt * 1000 * SPRITE_ANIM_TIME_SCALE);
      if (mob.waypoints.length < 2) continue;

      const target = mob.waypoints[mob.targetIndex] ?? mob.waypoints[0]!;
      const dx = target.x - mob.x;
      const dy = target.y - mob.y;
      const dist = Math.hypot(dx, dy);
      if (dist > WAYPOINT_EPSILON) {
        const stepLen = Math.min(dist, PATROL_SPEED_PX * dtClamped);
        mob.x += (dx / dist) * stepLen;
        mob.y += (dy / dist) * stepLen;
        if (Math.abs(dx) > WAYPOINT_EPSILON) mob.facing = dx >= 0 ? 1 : -1;
      } else {
        // Reached the target — pick the next waypoint, ping-ponging at the ends.
        const next = nextPatrolTarget(
          { x: mob.x, y: mob.y },
          target,
          mob.targetIndex,
          mob.direction,
          mob.waypoints,
        );
        mob.targetIndex = next.index;
        mob.direction = next.direction;
        // Flip to face the new target so the walk reads in the right direction.
        const newTarget = mob.waypoints[mob.targetIndex];
        if (newTarget !== undefined) {
          const ndx = newTarget.x - mob.x;
          if (Math.abs(ndx) > WAYPOINT_EPSILON) mob.facing = ndx >= 0 ? 1 : -1;
        }
      }
    }
  }

  /**
   * Draw every mob's current walk frame. `offset` translates the mob positions
   * (the play session's camera offset); pass `{0,0}` when the host has already
   * applied its own transform (the editor overlay does this).
   */
  draw(ctx: CanvasRenderingContext2D, offset: Readonly<PixelPoint> = { x: 0, y: 0 }): void {
    if (this.disposed) return;
    for (const mob of this.mobs) {
      drawCharacter(
        ctx,
        this.bundle,
        mob.character,
        'walk',
        mob.animState,
        // Snap to whole pixels so the float patrol position doesn't bleed
        // across edges mid-step (classic pixel-art draw discipline).
        Math.round(mob.x + offset.x),
        Math.round(mob.y + offset.y),
        mob.facing,
        mob.character === 'slime' ? TINT_SLIME : TINT_WALKER,
        // Mob art is square; draw at the entity's footprint edge length.
        Math.max(mob.width, mob.height),
      );
    }
  }

  dispose(): void {
    this.disposed = true;
  }
}

/** Collect Mob instances from every Entities layer, in encounter order. */
function collectMobs(level: LdtkLevel): MobState[] {
  const out: MobState[] = [];
  let mobIndex = 0;
  for (const layer of level.layerInstances ?? []) {
    if (layer.__type !== 'Entities') continue;
    const gridSize = layer.__gridSize;
    for (const entity of layer.entityInstances ?? []) {
      if (entity.__identifier.toLowerCase() !== 'mob') continue;
      const waypoints = mobPatrolWaypoints(entity, gridSize);
      out.push({
        iid: entity.iid,
        character: assignMobCharacter(mobIndex),
        width: entity.width,
        height: entity.height,
        waypoints,
        x: entity.px[0],
        y: entity.px[1],
        facing: -1,
        // Start by heading toward the first patrol waypoint (index 1) when one
        // exists; otherwise stay at the spawn (index 0).
        targetIndex: waypoints.length > 1 ? 1 : 0,
        direction: 1,
        animState: createSpriteAnimState(),
      });
      mobIndex += 1;
    }
  }
  return out;
}

/**
 * Build the mob actors for a level from a loaded sprite bundle. Returns `null`
 * when the level has no Mobs. Each call produces a fresh actors with its own
 * sim state, so the editor overlay and a play session can run independent
 * patrols off the same shared (read-only) bundle.
 */
export function createMobActors(level: LdtkLevel, bundle: SpriteBundle): MobActors | null {
  const mobs = collectMobs(level);
  if (mobs.length === 0) return null;
  return new MobActors(bundle, mobs);
}

// --- Editor overlay (thin wrapper) ----------------------------------------

/** An active overlay the editor steps and draws each frame. */
export interface MobOverlay {
  /** Advance the patrol sim and animation clocks by `dt` seconds. */
  step(dt: number): void;
  /** Draw the animated mobs into a world-pixel context (level space, no camera). */
  draw(context: CanvasRenderingContext2D): void;
  /** Release resources (tint cache canvases). */
  dispose(): void;
  /** Instance iids this overlay animates, so the editor can skip their bodies. */
  readonly animatedIids: ReadonlySet<string>;
}

/**
 * Build a mob overlay for a level if (and only if) it is the 1-bit platformer
 * sample. Returns `null` for any other source, so unrelated samples pay no
 * load cost beyond the guard.
 */
export async function createMobOverlay(opts: {
  readonly level: LdtkLevel;
  readonly project: LdtkProject;
  readonly source: string;
}): Promise<MobOverlay | null> {
  if (opts.source !== ONE_BIT_PLATFORMER_SAMPLE) return null;
  const bundle = await loadSpriteBundle();
  if (bundle === null) return null;
  const actors = createMobActors(opts.level, bundle);
  if (actors === null) return null;
  return {
    step: (dt) => actors.step(dt),
    draw: (ctx) => actors.draw(ctx),
    dispose: () => actors.dispose(),
    get animatedIids() {
      return actors.animatedIids;
    },
  };
}

// --- Image decode (mirrors sprite-demo.ts / parallax.ts) ------------------

function decodeImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img);
}
