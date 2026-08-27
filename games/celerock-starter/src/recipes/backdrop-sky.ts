/**
 * The level backdrop — procedural, deterministic, resolution-independent.
 *
 * Drawn in SCREEN space across the whole canvas before anything else; the
 * level, entities, and player composite on top under the camera transform.
 * Engine-agnostic on purpose: it takes a plain `{ x, y, zoom }` camera, so
 * nothing here depends on `CameraBrain` and the whole file is testable and
 * previewable outside the game.
 *
 * Design notes worth keeping, each one earned by a version that got it wrong:
 *
 *  1. EVERYTHING SCALES. The previous backdrop mixed absolute pixel sizes
 *     (peaks 210px apart, 85px tall) with viewport-relative horizons
 *     (`height * 0.72`), so its composition only held at the window it was
 *     tuned for — on a portrait window the range collapsed into slivers at the
 *     horizon. Every length here derives from viewport height, and the terrain
 *     lives in normalized units, so a resize never rebakes and the framing is
 *     the same at 16:9, ultrawide, and portrait.
 *
 *  2. TERRAIN CHANGES CHARACTER WITH DISTANCE. The DISTANCE is rugged (ridged
 *     multifractal — jagged, high-frequency peaks); the NEAR GROUND is rolling
 *     (smooth value noise — rounded crowns, long saddles) with conifer
 *     treelines on its crests. That split IS the depth cue: sharp silhouettes
 *     belong to things too far away to walk on, soft treed ones to the ground
 *     under your feet. Using one shape for both reads flat however the values
 *     are tuned.
 *
 *  3. DEPTH IS A VALUE LADDER. Five layers, each stepping DOWN in brightness as
 *     it comes forward, with the sky lightest at the horizon. That ordering is
 *     what makes overlapping flat shapes read as distances.
 *
 *  4. ONLY THE AIR MOVES. Ridges, stars, and the moon are welded to the world —
 *     they shift with the camera and nothing else. An earlier version drifted
 *     every layer on a timer to make the parallax visible (the game
 *     contain-fits each room, so the camera barely moves within one), and
 *     terrain that slides while the player stands still reads as broken, not
 *     alive. Only the motes move on a clock, because airborne snow is the one
 *     thing in frame that should. {@link AMBIENT_DRIFT} is the switch. The
 *     motes also answer to the wind ({@link BackdropWind}): the same gust
 *     level that swells the ambient audio pushes them right-to-left and
 *     deepens their sway, so the ear and the eye agree on the weather.
 *
 * Cost: 5 path fills, ~130 small tree paths, ~140 rects per frame. No
 * offscreen canvases, no per-frame allocation beyond the gradients.
 */

/** Viewport in CSS pixels — what `canvasCssViewport` reports. */
export interface BackdropViewport {
  readonly width: number;
  readonly height: number;
}

/** The camera the parallax rides on. */
export interface BackdropCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/**
 * What the wind does to the snowfall — the backdrop's whole weather input,
 * kept as plain numbers so the sky stays engine-agnostic and testable. The
 * game derives it from its wind state (see `snowWind` in `wind-atmosphere.ts`); anything
 * else may synthesize one.
 */
export interface BackdropWind {
  /** Integrated wind offset in viewport widths; NEGATIVE = right-to-left. */
  readonly driftX: number;
  /** Sway amplitude multiplier, 1 = still air. Gusts deepen the wobble. */
  readonly swayGain: number;
}

/*
 * Structurally identical to `wind-atmosphere.ts`'s `SnowWind` ON PURPOSE: the
 * two recipes are copied independently and neither imports the other, so
 * `snowWind(wind)` drops straight into `draw(...)` with no adapter. If you only
 * want the sky, synthesize `{ driftX, swayGain }` yourself — a fixed
 * `{ driftX: 0, swayGain: 1 }` renders still air.
 */

/** Still air — what a `draw` call without wind renders. */
const CALM: BackdropWind = { driftX: 0, swayGain: 1 };

/** A built backdrop. Geometry is baked once; `draw` is pure presentation. */
export interface Backdrop {
  /**
   * @param ctx      screen space (CSS px), before any camera transform
   * @param viewport CSS pixels
   * @param camera   the game camera
   * @param time     seconds since boot — twinkle and motes only
   * @param wind     the weather moving the snow; omitted = still air
   */
  draw(
    ctx: CanvasRenderingContext2D,
    viewport: BackdropViewport,
    camera: BackdropCamera,
    time: number,
    wind?: BackdropWind,
  ): void;
}

/** Height of a terrain layer at normalized position `u`, in `0..1`. */
type HeightField = (u: number) => number;

interface TreeInstance {
  readonly u: number;
  readonly scale: number;
  readonly lean: number;
}

interface LayerSpec {
  readonly kind: 'rugged' | 'rolling';
  readonly depth: number;
  readonly horizon: number;
  readonly amplitude: number;
  readonly period: number;
  readonly drift: number;
  readonly detail: number;
  readonly roughness: number;
  readonly trees: number;
  readonly treeSize: number;
}

interface BuiltLayer extends LayerSpec {
  readonly height: HeightField;
  readonly treeList: readonly TreeInstance[];
}

/**
 * mulberry32 — the generator the engine uses. No `Math.random` anywhere (§2),
 * so the sky is identical on every run and every machine.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smoothstep-interpolated periodic value noise over `count` control points. */
function makeNoiseOctave(rng: () => number, count: number): HeightField {
  const values = new Float64Array(count);
  for (let i = 0; i < count; i += 1) values[i] = rng();
  return (u: number): number => {
    const scaled = u * count;
    const i0 = Math.floor(scaled);
    const frac = scaled - i0;
    const a = values[((i0 % count) + count) % count];
    const b = values[(((i0 + 1) % count) + count) % count];
    const smooth = frac * frac * (3 - 2 * frac);
    return a + (b - a) * smooth;
  };
}

/**
 * ROLLING hills: plain summed value noise, smoothstepped. Rounded crowns and
 * long shallow saddles. Deliberately NOT ridged — creasing this makes
 * foreground hills look like distant peaks, which is the depth cue inverted.
 */
function makeHills(rng: () => number, base: number): HeightField {
  const o1 = makeNoiseOctave(rng, base);
  const o2 = makeNoiseOctave(rng, base * 2);
  return (u: number): number => {
    const wrapped = u - Math.floor(u);
    const v = o1(wrapped) * 0.78 + o2(wrapped) * 0.22;
    return v * v * (3 - 2 * v);
  };
}

/**
 * RUGGED ridgeline: ridged multifractal. Each octave is folded through
 * `1 - |2n - 1|`, which turns smooth humps into creases — sharp peaks with long
 * clean slopes. Plain summed noise gives a wiggly line that reads as a waveform
 * plot rather than terrain.
 *
 * `roughness` scales the high octaves down for distant layers: atmosphere eats
 * fine detail with distance.
 */
function makeRidge(rng: () => number, base: number, roughness: number): HeightField {
  const o1 = makeNoiseOctave(rng, base);
  const o2 = makeNoiseOctave(rng, base * 2);
  const o3 = makeNoiseOctave(rng, base * 4);
  const ridged = (n: number): number => 1 - Math.abs(2 * n - 1);
  return (u: number): number => {
    const wrapped = u - Math.floor(u);
    const a = ridged(o1(wrapped));
    const b = ridged(o2(wrapped)) * 0.34 * roughness;
    const c = ridged(o3(wrapped)) * 0.13 * roughness;
    const total = (a + b + c) / (1 + 0.34 * roughness + 0.13 * roughness);
    // Gamma toward the peaks: keeps valleys flat and summits pointed.
    return Math.pow(total, 1.18);
  };
}

/** Mix two `#rrggbb` colors. */
function mix(hexA: string, hexB: string, t: number): string {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

/** The night palette. Every color in the backdrop comes from here. */
export const BACKDROP_PALETTE = {
  skyTop: '#070b24',
  skyMid: '#151c44',
  skyHorizon: '#39406f',   // lightest band — atmosphere piles up at the horizon
  skyFloor: '#2c3160',
  /** Far to near. Stepping DOWN in value is what separates the distances. */
  ridges: ['#333a6b', '#2a3059', '#212648', '#181d3b', '#10142e'],
  rim: '#98a3dd',
  star: '#e9eeff',
  snow: '#ffffff',
  moon: '#dfe6ff',
} as const;

/**
 * Per-second self-drift for the terrain layers.
 *
 * ZERO ON PURPOSE. Mountains, stars, and the moon are part of the world, so
 * they move only when the camera does. Raise this for a stylized scrolling sky
 * (it reads as wind-blown cloud banks, not terrain) — but self-moving terrain
 * is the single most common way a parallax backdrop announces itself.
 */
const AMBIENT_DRIFT = 0;

/**
 * Flakes in the snowfall. Read as weather rather than as dust at roughly 120+;
 * the level hides most of them, so this is deliberately higher than it needs to
 * look right in isolation. ~200 fillRects/frame, which is noise next to the
 * terrain paths.
 */
const SNOW_COUNT = 190;

/** Terrain layers, far to near. `depth` drives parallax AND the value step. */
const LAYERS: readonly LayerSpec[] = [
  { kind: 'rugged', depth: 0.00, horizon: 0.585, amplitude: 0.30, period: 3.4, drift: 1.2, detail: 9, roughness: 1.0, trees: 0, treeSize: 0 },
  { kind: 'rugged', depth: 0.28, horizon: 0.680, amplitude: 0.245, period: 2.6, drift: 2.8, detail: 7, roughness: 0.85, trees: 0, treeSize: 0 },
  { kind: 'rugged', depth: 0.52, horizon: 0.762, amplitude: 0.175, period: 2.0, drift: 4.4, detail: 5, roughness: 0.6, trees: 16, treeSize: 0.017 },
  { kind: 'rolling', depth: 0.78, horizon: 0.848, amplitude: 0.105, period: 1.6, drift: 6.8, detail: 4, roughness: 0, trees: 34, treeSize: 0.026 },
  { kind: 'rolling', depth: 1.00, horizon: 0.945, amplitude: 0.085, period: 1.15, drift: 10.5, detail: 3, roughness: 0, trees: 46, treeSize: 0.038 },
];

/** Paint the snow band. */
function paintFlakes(
  ctx: CanvasRenderingContext2D,
  flakes: readonly Flake[],
  spec: SnowSpec,
  w: number,
  h: number,
  camX: number,
  zoom: number,
  t: number,
  wind: BackdropWind,
  fade?: (y: number) => number,
): void {
  ctx.fillStyle = BACKDROP_PALETTE.snow;
  for (const flake of flakes) {
    const parallax = band(spec.parallax, flake.depth);
    const drift = (-camX * parallax * zoom) / w;
    const sway = Math.sin(t * flake.swaySpeed + flake.sway) * flake.swayAmp * wind.swayGain;
    const push = wind.driftX * band(spec.wind, flake.depth);
    const x = (((flake.u + drift + sway + push) % 1) + 1) % 1 * w;
    const y = (((flake.v + t * flake.fall) % 1) + 1) % 1 * h;
    ctx.globalAlpha = flake.alpha * (fade === undefined ? 1 : fade(y));
    ctx.fillRect(Math.round(x), Math.round(y), flake.width, flake.height);
  }
  ctx.globalAlpha = 1;
}

/** A single flake. Positions are normalized; sizes are device pixels. */
interface Flake {
  readonly u: number;
  readonly v: number;
  readonly depth: number;
  readonly width: number;
  readonly height: number;
  readonly alpha: number;
  readonly fall: number;
  readonly sway: number;
  readonly swayAmp: number;
  readonly swaySpeed: number;
}

/** How the snow band is shaped. */
interface SnowSpec {
  /** Parallax at depth 0 and 1. Foreground snow exceeds 1: it is nearer than the world. */
  readonly parallax: readonly [number, number];
  readonly alpha: readonly [number, number];
  readonly fall: readonly [number, number];
  readonly swayAmp: readonly [number, number];
  /** Wind push at depth 0 and 1: near flakes scud harder than far ones. */
  readonly wind: readonly [number, number];
  /** Pixel size at depth 0 and 1; flakes are drawn taller than wide. */
  readonly size: readonly [number, number];
}

/**
 * Snow over the valley. Drawn behind the level, so most of it is hidden by
 * platforms and only flakes crossing open sky are seen — hence the count.
 *
 * A foreground pass (snow in front of the world, defocused) was built and cut:
 * anything moving over the play area of a precision platformer competes with
 * spike and gem silhouettes, and no tuning of speed, size, or blur made it earn
 * that cost. See the git history if it is ever wanted back.
 */
const SKY_SNOW: SnowSpec = {
  parallax: [0.25, 1.1],
  alpha: [0.18, 0.80],
  fall: [0.012, 0.067],
  swayAmp: [0.004, 0.016],
  wind: [0.3, 1.0],
  size: [1, 3],
};

/** Interpolate a `[at depth 0, at depth 1]` pair. */
function band(range: readonly [number, number], depth: number): number {
  return range[0] + (range[1] - range[0]) * depth;
}

/**
 * Build one snow band. Banded by depth rather than scattered uniformly: near
 * flakes are bigger, brighter, fall faster, and parallax more. A single uniform
 * band reads as static noise rather than weather.
 *
 * Flakes are drawn TALLER than they are wide — a sliver reads as something
 * falling, where a square dot reads as another star. (In the first pass the
 * snow and the star field were indistinguishable; if a viewer has to ask what a
 * particle is, the particle has failed.)
 */
function makeFlakes(rng: () => number, count: number, spec: SnowSpec): readonly Flake[] {
  return Array.from({ length: count }, () => {
    const depth = rng();
    const size = band(spec.size, depth);
    return {
      u: rng(),
      v: rng(),
      depth,
      width: Math.max(1, Math.round(size)),
      height: Math.max(1, Math.round(size * 1.35)),
      alpha: band(spec.alpha, depth),
      fall: band(spec.fall, depth),
      sway: rng() * Math.PI * 2,
      swayAmp: band(spec.swayAmp, depth),
      swaySpeed: 0.18 + rng() * 0.4,
    };
  });
}

/**
 * One conifer silhouette, stepped rather than a plain triangle — at 15–30px a
 * triangle reads as a spike, the tiers read as a fir. Drawn in the layer's own
 * color, so the treeline is part of that hill's silhouette.
 */
function drawConifer(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  height: number,
  lean: number,
): void {
  const halfW = height * 0.30;
  const tipX = x + lean * height;
  ctx.beginPath();
  ctx.moveTo(tipX, baseY - height);
  ctx.lineTo(x + halfW * 0.52, baseY - height * 0.52);
  ctx.lineTo(x + halfW * 0.30, baseY - height * 0.56);
  ctx.lineTo(x + halfW, baseY - height * 0.06);
  ctx.lineTo(x + halfW * 0.16, baseY + height * 0.04);
  ctx.lineTo(x - halfW * 0.16, baseY + height * 0.04);
  ctx.lineTo(x - halfW, baseY - height * 0.06);
  ctx.lineTo(x - halfW * 0.30, baseY - height * 0.56);
  ctx.lineTo(x - halfW * 0.52, baseY - height * 0.52);
  ctx.closePath();
  ctx.fill();
}

/**
 * Build a backdrop. Geometry bakes once in NORMALIZED units, so a resize never
 * needs a rebake and the composition holds at any aspect ratio.
 *
 * @param seed - the same seed always paints the same sky.
 */
export function createBackdrop(seed = 0xce1e5): Backdrop {
  const rng = mulberry32(seed);

  const layers: readonly BuiltLayer[] = LAYERS.map((layer) => {
    const height = layer.kind === 'rolling'
      ? makeHills(rng, layer.detail)
      : makeRidge(rng, layer.detail, layer.roughness);
    // Trees live in the layer's own normalized period, so they wrap with the
    // terrain. Jittered spacing and size — an even pitch reads as a fence.
    const treeList: TreeInstance[] = [];
    for (let i = 0; i < layer.trees; i += 1) {
      treeList.push({
        u: (i + 0.5 + (rng() - 0.5) * 0.8) / layer.trees,
        scale: 0.62 + rng() * 0.66,
        lean: (rng() - 0.5) * 0.16,
      });
    }
    return { ...layer, height, treeList };
  });

  const stars = Array.from({ length: 110 }, () => {
    const bright = rng();
    return {
      u: rng(),
      v: rng() ** 1.7,               // biased upward: fewer stars near the ridges
      size: bright > 0.93 ? 2 : 1,
      alpha: 0.18 + bright * 0.62,
      phase: rng() * Math.PI * 2,
      speed: 0.4 + rng() * 1.1,
    };
  });

  const skyFlakes = makeFlakes(rng, SNOW_COUNT, SKY_SNOW);

  // `v` sits well inside the frame, not at the top edge: the contain-fit margin
  // is letterboxed (§5.4) and this is painted BEHIND those bars, so anything in
  // the outer band is masked off in play.
  const moon = { u: 0.76, v: 0.26, radius: 0.017 };

  function draw(
    ctx: CanvasRenderingContext2D,
    viewport: BackdropViewport,
    camera: BackdropCamera,
    time: number,
    windArg?: BackdropWind,
  ): void {
    const w = viewport.width;
    const h = viewport.height;
    const t = Number.isFinite(time) ? time : 0;
    const camX = Number.isFinite(camera.x) ? camera.x : 0;
    const camY = Number.isFinite(camera.y) ? camera.y : 0;
    const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;

    ctx.save();

    // --- sky ---------------------------------------------------------------
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, BACKDROP_PALETTE.skyTop);
    sky.addColorStop(0.46, BACKDROP_PALETTE.skyMid);
    sky.addColorStop(0.78, BACKDROP_PALETTE.skyHorizon);
    sky.addColorStop(1, BACKDROP_PALETTE.skyFloor);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // --- moon (parallax 0.03 — effectively at infinity, but not screen-locked)
    const moonX = ((moon.u + (-camX * 0.03 * zoom) / (w * 4)) % 1 + 1) % 1 * w;
    const moonY = moon.v * h - camY * 0.03 * zoom;
    const moonR = moon.radius * h;
    const glow = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, moonR * 9);
    glow.addColorStop(0, 'rgba(190, 206, 255, 0.17)');
    glow.addColorStop(0.4, 'rgba(140, 160, 228, 0.055)');
    glow.addColorStop(1, 'rgba(120, 140, 220, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR * 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = BACKDROP_PALETTE.moon;
    ctx.globalAlpha = 0.62;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // --- stars: camera parallax only; time drives the twinkle and nothing else
    const starShift = (-camX * 0.06 * zoom) / w;
    ctx.fillStyle = BACKDROP_PALETTE.star;
    for (const star of stars) {
      const x = (((star.u + starShift) % 1) + 1) % 1 * w;
      const y = star.v * h * 0.68 - camY * 0.06 * zoom;
      if (y < -4 || y > h) continue;
      const twinkle = 0.72 + Math.sin(t * star.speed + star.phase) * 0.28;
      const fade = 1 - Math.min(1, Math.max(0, (y / (h * 0.68) - 0.55) / 0.45));
      ctx.globalAlpha = star.alpha * twinkle * fade;
      ctx.fillRect(Math.round(x), Math.round(y), star.size, star.size);
    }
    ctx.globalAlpha = 1;

    // --- terrain, far to near ----------------------------------------------
    // Sample step: fine enough for a clean silhouette, coarse enough that an
    // ultrawide window is still only ~350 points per layer.
    const step = Math.max(3, h / 120);
    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];
      const parallax = 0.10 + layer.depth * 0.42;
      const shiftPx = -camX * parallax * zoom - t * layer.drift * AMBIENT_DRIFT;
      const horizonY = h * layer.horizon;
      const amp = h * layer.amplitude;
      const top = BACKDROP_PALETTE.ridges[index];
      // A slight darkening down the face reads as the slope turning away from
      // the moon. Shallow on purpose — a strong gradient re-muddies the ladder.
      const bottom = mix(top, '#05070f', 0.35);
      const fill = ctx.createLinearGradient(0, horizonY - amp, 0, h);
      fill.addColorStop(0, top);
      fill.addColorStop(1, bottom);

      // Period in px scales with the viewport, so peak spacing is proportional.
      const periodPx = h * layer.period;

      ctx.beginPath();
      ctx.moveTo(-step, h);
      let firstY = 0;
      for (let x = -step; x <= w + step; x += step) {
        const u = (x - shiftPx) / periodPx;
        const y = horizonY - layer.height(u) * amp - camY * parallax * zoom;
        if (x === -step) firstY = y;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w + step, h);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      // Treeline: the layer's own color, planted ON the crest by sampling the
      // very same height function, so it can never float or sink. Iterating
      // whole periods keeps it wrapping with the terrain.
      if (layer.treeList.length > 0) {
        ctx.fillStyle = top;
        const firstK = Math.floor(-shiftPx / periodPx) - 1;
        const lastK = Math.ceil((w - shiftPx) / periodPx) + 1;
        const treeH = h * layer.treeSize;
        for (let k = firstK; k <= lastK; k += 1) {
          for (const tree of layer.treeList) {
            const u = k + tree.u;
            const x = shiftPx + u * periodPx;
            if (x < -treeH || x > w + treeH) continue;
            const groundY = horizonY - layer.height(u) * amp - camY * parallax * zoom;
            drawConifer(ctx, x, groundY + 1, treeH * tree.scale, tree.lean);
          }
        }
      }

      // Moonlit crest — bare rock only. On a treed ridge the stroke traces the
      // hill *through* the trees and reads as a contour line.
      if (layer.treeList.length > 0 || index === 0) continue;
      ctx.globalAlpha = 0.055 + layer.depth * 0.085;
      ctx.strokeStyle = mix(BACKDROP_PALETTE.rim, BACKDROP_PALETTE.skyHorizon, 1 - layer.depth);
      ctx.lineWidth = Math.max(1, h / 620);
      ctx.beginPath();
      ctx.moveTo(-step, firstY);
      for (let x = -step; x <= w + step; x += step) {
        const u = (x - shiftPx) / periodPx;
        ctx.lineTo(x, horizonY - layer.height(u) * amp - camY * parallax * zoom);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // --- snowfall (the band behind the world) ------------------------------
    // Faded through the upper sky, where the stars live: snow belongs over the
    // terrain, not scattered through the constellations.
    paintFlakes(ctx, skyFlakes, SKY_SNOW, w, h, camX, zoom, t, windArg ?? CALM, (y) => Math.min(1, y / (h * 0.30)));

    // --- bottom haze: gameplay sits here, so it stays the quietest part of the
    //     frame. The one element carried over from the previous backdrop. ----
    const haze = ctx.createLinearGradient(0, h * 0.52, 0, h);
    haze.addColorStop(0, 'rgba(5, 7, 15, 0)');
    haze.addColorStop(1, 'rgba(5, 7, 15, 0.42)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, h * 0.5, w, h * 0.5);

    ctx.restore();
  }

  return { draw };
}
