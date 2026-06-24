/**
 * gen-parallax-tiles.ts — DEV-TIME asset generator for the IMP underworld
 * showcase parallax background.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  WHAT THIS IS
 *  A standalone dev-time script that calls OpenAI's `gpt-image-2` model to
 *  paint 4 horizontally-seamless parallax tiles (sky, far-fortress, mid-ruins,
 *  foreground) for the "IMP - Not a Troll" devil/underworld side-scroller, then
 *  mirror-pads each tile to GUARANTEE seamlessness and composites a contact
 *  sheet for visual review.
 *
 *  It is NOT imported by the showcase runtime. The runtime loads the committed
 *  PNGs written to showcase/assets/parallax/. This script never ships.
 *
 *  COST: ~4 × gpt-image-2 generations per full run ≈ $0.20–$0.50 (standard
 *  quality). Retries on param/model errors can add a call or two.
 *
 *  SECRET HANDLING: reads OPENAI_API_KEY from ./../../.env (repo root) at start.
 *  Never logged, never written to any file. The .env is gitignored.
 *
 *  GREENSCREEN: transparent layers (far-fortress, mid-ruins, foreground) are
 *  prompted with a FLAT PURE CHROMA-GREEN (#00FF00) background and requested
 *  as `background:"opaque"`. We then chroma-key the green out in post with a
 *  feathered alpha band (KEY_ON=60 / KEY_OFF=15 on green-dominance) and a
 *  despill pass. This replaces the old near-black key which punched holes
 *  through dark subject art.
 *
 *  RE-RUN (full):    npx tsx showcase/_scripts/gen-parallax-tiles.ts
 *  RE-RUN (one layer, with greenscreen test sheet):
 *                    npx tsx showcase/_scripts/gen-parallax-tiles.ts --only=foreground
 *           (run from repo root so `canvas` + relative paths resolve)
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  Constraints honoured: zero new dependencies (Node built-ins + `canvas`
 *  only), nothing under src/ is touched, package.json untouched, no git ops.
 */

import { createCanvas, loadImage, type Canvas, type Image } from 'canvas';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ───────────────────────────────────────────────────────── paths ──────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const OUT_DIR = join(REPO_ROOT, 'showcase', 'assets', 'parallax');
const ENV_PATH = join(REPO_ROOT, '.env');
mkdirSync(OUT_DIR, { recursive: true });

// ──────────────────────────────────────────────────────── env / key ────────
// Parse .env manually so the run command needs no extra flags. The key is
// held only in a local const and sent solely to OpenAI over HTTPS.
function loadEnvKey(): string {
  const raw = readFileSync(ENV_PATH, 'utf8');
  const m = raw.match(/^OPENAI_API_KEY\s*=\s*(\S+)/m);
  if (!m) throw new Error(`OPENAI_API_KEY not found in ${ENV_PATH}`);
  return m[1].trim();
}
const API_KEY = loadEnvKey();

// ─────────────────────────────────────────────── argv: --only=<layer> ───────
// Minimal argv parse (no dep). `--only=foreground` generates ONLY that layer
// and (for transparent layers) writes a 3-panel greenscreen test sheet
// instead of the multi-layer contact sheet. Unknown/missing → generate all.
function parseOnlyArg(argv: string[]): string | null {
  for (const a of argv.slice(2)) {
    const m = a.match(/^--only=(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}
const ONLY_LAYER = parseOnlyArg(process.argv);

// ─────────────────────────────────────────────────────────── models ────────
// Fallback chain (confirmed gpt-image-2 available; the rest are safety nets).
const MODEL_CHAIN = [
  'gpt-image-2',
  'gpt-image-2-2026-04-21',
  'gpt-image-1.5',
  'gpt-image-1',
] as const;

// ─────────────────────────────────────────────────── layer definitions ─────
interface LayerSpec {
  name: string;
  factor: number;
  background: 'opaque' | 'transparent';
  prompt: string;
}
const LAYERS: LayerSpec[] = [
  {
    name: 'sky',
    factor: 0.1,
    background: 'opaque',
    prompt:
      'Seamless horizontally tileable 2D side-scrolling video game background layer. Infernal underworld sky: deep crimson red bleeding down into charcoal black at the bottom, faint drifting ash and smoke wisps, scattered tiny glowing orange embers. Painterly but flat, cinematic atmospheric depth, moody hellish dusk. NO characters, NO text, NO watermark, NO border. Left edge must visually continue into the right edge.',
  },
  {
    name: 'far-fortress',
    factor: 0.25,
    background: 'transparent',
    prompt:
      'Seamless horizontally tileable 2D side-scrolling video game parallax layer. Distant jagged silhouette of a hellish obsidian fortress and mountain peaks. Very dark near-black silhouette with faint molten-orange glow in cracks and windows. Flat cut-out style. The ENTIRE background MUST be a flat, uniform, pure chroma-key green (RGB 0,255,0 / #00FF00) filling all empty space — this is a greenscreen for compositing. The subject must contain NO green whatsoever. Hard clean edges where the subject meets the green; do not blend or feather the subject into the green. NO characters, NO text, NO watermark. Left edge of the green-backed image visually continues into the right edge.',
  },
  {
    name: 'mid-ruins',
    factor: 0.5,
    background: 'transparent',
    prompt:
      'Seamless horizontally tileable 2D side-scrolling video game parallax layer. Mid-ground ruined cavern: broken stone pillars, craggy rock formations, glowing lava cracks. Dark warm stone with molten-orange highlights, medium detail, flat 2D cut-out style. The ENTIRE background MUST be a flat, uniform, pure chroma-key green (RGB 0,255,0 / #00FF00) filling all empty space — this is a greenscreen for compositing. The subject must contain NO green whatsoever. Hard clean edges where the subject meets the green; do not blend or feather the subject into the green. NO characters, NO text, NO watermark. Left edge of the green-backed image visually continues into the right edge.',
  },
  {
    name: 'foreground',
    factor: 0.85,
    background: 'transparent',
    prompt:
      'Seamless horizontally tileable 2D side-scrolling video game parallax layer. A UNIFORM, low-creeping shoreline of dark volcanic foreground ROCKS along the BOTTOM EDGE of the frame only — craggy basalt boulders forming a level, consistent-height ridge. CRITICAL: the TOP EDGE of the rock mass must be roughly LEVEL and even across the ENTIRE width, with only minor jagged boulder-to-boulder variation (a few pixels). Absolutely NO tall peaks, NO spires, NO pinnacles, NO height spikes anywhere — and the height at the LEFT and RIGHT edges MUST match the height in the MIDDLE (do not raise the edges). The ridge is a short, flat-topped, horizontally-broad mass. Silhouetted and pure near-black. NO orange glow, NO warm rim light, NO molten highlights on the rocks anywhere — flat dark silhouettes only. The ENTIRE upper two-thirds of the image MUST be empty flat pure chroma-key green (RGB 0,255,0 / #00FF00) — only the bottom portion contains the level rock ridge. Hard clean edges where rock meets the green; do not blend or feather rock into green. Flat 2D cut-out, darkest layer, highest contrast. NO characters, NO text, NO watermark. Left edge of the rock ridge must visually continue into the right edge.',
  },
];

// ──────────────────────────────────────────────────── result reporting ─────
interface LayerResult {
  name: string;
  factor: number;
  model: string;
  sizeRequested: string;
  bgRequested: string;
  bgHonored: 'yes' | 'green-key' | 'opaque-saved';
  nativeW: number;
  nativeH: number;
  finalW: number;
  finalH: number;
  path: string;
  chromaKeyedPx?: number;
  keyedRatio?: number;
  despillCount?: number;
  warning?: string;
}

// ─────────────────────────────────────────────────── API call + retry ──────
const API_URL = 'https://api.openai.com/v1/images/generations';

/**
 * Build ordered list of request-body variations to try for one layer, in
 * priority order: prefer opaque + 1024x1024, then drop the background param,
 * then fall back to size "auto".
 *
 * NOTE: We NEVER pass background:"transparent" anymore. Transparent layers
 * now use a greenscreen (flat pure chroma-green background, see LAYERS
 * prompts) that we chroma-key in post. The model ignored the transparency
 * request anyway, and a near-black key punched holes through dark subject
 * art. Requesting opaque guarantees the green background is painted.
 */
function buildAttempts(model: string, prompt: string) {
  const sizes = ['1024x1024', 'auto'];
  const bgs: ('opaque' | null)[] = ['opaque', null];
  const out: { body: Record<string, unknown>; size: string; bg: string }[] = [];
  for (const size of sizes) {
    for (const b of bgs) {
      const body: Record<string, unknown> = { model, prompt, n: 1, size };
      if (b) body.background = b;
      out.push({ body, size, bg: b ?? '(omitted)' });
    }
  }
  return out;
}

async function generateImage(
  layer: LayerSpec,
): Promise<{ b64: string; model: string; size: string; bg: string }> {
  let lastErr: unknown;
  for (const model of MODEL_CHAIN) {
    for (const att of buildAttempts(model, layer.prompt)) {
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(att.body),
        });
        if (!res.ok) {
          const txt = await res.text();
          // Non-fatal: try next variation/model. Keep last error for reporting.
          lastErr = new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
          continue;
        }
        const json = (await res.json()) as {
          data?: { b64_json?: string; url?: string }[];
        };
        const b64 = json.data?.[0]?.b64_json;
        if (!b64) {
          lastErr = new Error('Response missing data[0].b64_json');
          continue;
        }
        return { b64, model, size: att.size, bg: att.bg };
      } catch (err) {
        lastErr = err;
        continue;
      }
    }
  }
  throw new Error(
    `All models/param variations failed for "${layer.name}": ${(lastErr as Error).message}`,
  );
}

// ───────────────────────────── transparency analysis + green chroma-key ────
/**
 * Decide whether the returned PNG actually carries meaningful alpha, and if
 * not (and the layer wants transparency), run a **greenscreen chroma-key**
 * pass with feathered alpha + despill.
 *
 * Strategy: we explicitly asked the model for a flat pure chroma-green
 * (#00FF00) background. We key on green dominance (g - max(r,b)) with a
 * linear feather band so edges are anti-aliased rather than jagged, then
 * despill any residual green fringe the model's anti-aliasing bled into
 * subject edges.
 *
 * Always returns both `canvas` (the working source for downstream
 * mirror-pad) and `rawCanvas` (the UNMODIFIED source draw, kept around for
 * the greenscreen diagnostic test sheet).
 */
function prepareSourceCanvas(
  img: Image,
  wantTransparent: boolean,
): {
  canvas: Canvas;
  rawCanvas: Canvas;
  bgHonored: LayerResult['bgHonored'];
  chromaKeyedPx: number;
  keyedRatio: number;
  despillCount: number;
} {
  const W = img.width;
  const H = img.height;
  const total = W * H;

  // Always capture an unmodified raw draw for diagnostics.
  const rawCanvas = createCanvas(W, H);
  const rawCtx = rawCanvas.getContext('2d');
  rawCtx.drawImage(img, 0, 0);

  if (!wantTransparent) {
    return {
      canvas: rawCanvas,
      rawCanvas,
      bgHonored: 'yes',
      chromaKeyedPx: 0,
      keyedRatio: 0,
      despillCount: 0,
    };
  }

  // Short-circuit: if the model returned real alpha (>=0.5% transparent),
  // honour it as-is and skip the green key. We requested opaque green
  // backgrounds, so this should rarely trigger — but if the model returns
  // alpha anyway, we keep it.
  const rawData = rawCtx.getImageData(0, 0, W, H).data;
  let realTransparent = 0;
  for (let i = 3; i < rawData.length; i += 4) {
    if (rawData[i] < 250) realTransparent++;
  }
  if (realTransparent / total >= 0.005) {
    return {
      canvas: rawCanvas,
      rawCanvas,
      bgHonored: 'yes',
      chromaKeyedPx: 0,
      keyedRatio: realTransparent / total,
      despillCount: 0,
    };
  }

  // Effectively opaque → green chroma-key + despill on a working canvas.
  const keyedCanvas = createCanvas(W, H);
  const kCtx = keyedCanvas.getContext('2d');
  kCtx.drawImage(img, 0, 0);
  const imgData = kCtx.getImageData(0, 0, W, H);
  const d = imgData.data;

  // Feather band: fully transparent above KEY_ON, fully opaque below KEY_OFF,
  // linear ramp in between for anti-aliased edges (no jaggies).
  const KEY_ON = 60;
  const KEY_OFF = 15;
  const SPREAD = KEY_ON - KEY_OFF; // 45

  let chromaKeyedPx = 0; // pixels whose alpha went below 255 (fully or partially keyed)
  let under250 = 0; // pixels that ended up alpha < 250 (the cut-out sanity metric)
  let despillCount = 0; // kept pixels where the despill clamp actually lowered g

  for (let p = 0; p < d.length; p += 4) {
    const r = d[p];
    const g = d[p + 1];
    const b = d[p + 2];

    const greenDominance = g - Math.max(r, b);

    let alpha: number;
    if (greenDominance >= KEY_ON) {
      alpha = 0; // definitely background
    } else if (greenDominance <= KEY_OFF) {
      alpha = 255; // definitely subject
    } else {
      // Linear feather → anti-aliased edge.
      alpha = Math.round((255 * (KEY_ON - greenDominance)) / SPREAD);
    }

    if (alpha < 255) chromaKeyedPx++;
    if (alpha < 250) under250++;

    // Despill: kill the green fringe the model's anti-aliasing bled into
    // subject edges. Applies to EVERY kept pixel (fully-opaque AND feathered
    // edge pixels). Clamps g to at most max(r,b)+8 — this only affects
    // pixels with residual green above the subject's red/blue; legitimate
    // non-green subject colors are untouched.
    if (alpha > 0) {
      const capped = Math.min(g, Math.max(r, b) + 8);
      if (capped < g) {
        d[p + 1] = capped;
        despillCount++;
      }
    }

    d[p + 3] = alpha;
  }

  kCtx.putImageData(imgData, 0, 0);

  const keyedRatio = under250 / total;
  return {
    canvas: keyedCanvas,
    rawCanvas,
    bgHonored: chromaKeyedPx > 0 ? 'green-key' : 'opaque-saved',
    chromaKeyedPx,
    keyedRatio,
    despillCount,
  };
}

// ─────────────────────────────────────── mirror-pad (seamless guarantee) ────
/**
 * GUARANTEED SEAMLESS TILING via mirror-padding.
 *
 * Image models do not reliably produce tiles whose left and right edges
 * match, even when the prompt insists on it. To eliminate any visible seam
 * when the consumer tiles the image horizontally with drawTiledParallax(),
 * we build a new canvas of width 2W whose second half is a horizontal mirror
 * of the first half:
 *
 *   [ original (W) ][ mirrored original (W) ]
 *
 * The right edge of the original (x=W) is identical to the left edge of the
 * mirrored half, so the internal join is invisible. And the right edge of the
 * mirrored half (x=2W) is the original's LEFT edge — so when the consumer
 * places two of these 2W tiles side by side, the join is left-edge↔left-edge,
 * again identical. Result: adjacent copies join with zero visible seam for
 * ANY source image, regardless of what the model produced.
 *
 * Implemented by drawing the source into [0,W] normally, then translating
 * the context to (2W,0) and applying scale(-1,1) so the next drawImage lands
 * flipped into [W,2W].
 */
function mirrorPad(src: Canvas): Canvas {
  const W = src.width;
  const H = src.height;
  const out = createCanvas(W * 2, H);
  const ctx = out.getContext('2d');
  // Left half: original, unmodified.
  ctx.drawImage(src, 0, 0, W, H, 0, 0, W, H);
  // Right half: horizontally flipped copy of the original.
  ctx.save();
  ctx.translate(W * 2, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0, W, H, 0, 0, W, H);
  ctx.restore();
  return out;
}

// ─────────────────────────────────────── per-layer pipeline ────────────────
async function buildLayer(layer: LayerSpec): Promise<{
  result: LayerResult;
  rawCanvas: Canvas;
  finalCanvas: Canvas;
}> {
  process.stdout.write(`Generating ${layer.name}.png … `);
  const { b64, model, size, bg } = await generateImage(layer);
  const buf = Buffer.from(b64, 'base64');
  const img: Image = await loadImage(buf);
  const nativeW = img.width;
  const nativeH = img.height;

  const wantTransparent = layer.background === 'transparent';
  const {
    canvas: srcCanvas,
    rawCanvas,
    bgHonored,
    chromaKeyedPx,
    keyedRatio,
    despillCount,
  } = prepareSourceCanvas(img, wantTransparent);
  const padded = mirrorPad(srcCanvas);
  const finalW = padded.width;
  const finalH = padded.height;
  const outPath = join(OUT_DIR, `${layer.name}.png`);
  writeFileSync(outPath, padded.toBuffer('image/png'));

  const transparent = !wantTransparent ? false : bgHonored !== 'opaque-saved';
  console.log(
    `done (model ${model}, ${nativeW}×${nativeH} → mirror-padded ${finalW}×${finalH}, ` +
      `transparent=${transparent}` +
      (bgHonored === 'green-key'
        ? `, green-key ${chromaKeyedPx}px keyed, ${(keyedRatio * 100).toFixed(1)}% alpha<250, ${despillCount}px despilled`
        : '') +
      (bgHonored === 'opaque-saved' ? `, WARNING: no green found, no transparency` : '') +
      ')',
  );

  const result: LayerResult = {
    name: layer.name,
    factor: layer.factor,
    model,
    sizeRequested: size,
    bgRequested: bg,
    bgHonored,
    nativeW,
    nativeH,
    finalW,
    finalH,
    path: outPath,
    chromaKeyedPx,
    keyedRatio,
    despillCount,
    warning:
      bgHonored === 'opaque-saved'
        ? 'No green background detected — opaque tile saved, regenerate or check prompt.'
        : undefined,
  };
  return { result, rawCanvas, finalCanvas: padded };
}

// ─────────────────────────────────── contact-sheet compositing ─────────────
function checkerboard(ctx: import('canvas').CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cell = 16): void {
  const c1 = '#3a3a3a';
  const c2 = '#262626';
  for (let cy = 0; cy < h; cy += cell) {
    for (let cx = 0; cx < w; cx += cell) {
      ctx.fillStyle = (Math.floor(cx / cell) + Math.floor(cy / cell)) % 2 === 0 ? c1 : c2;
      ctx.fillRect(x + cx, y + cy, cell, cell);
    }
  }
}

async function buildContactSheet(results: LayerResult[]): Promise<void> {
  // Load final tiles for compositing.
  const tiles: Record<string, Image> = {};
  for (const r of results) {
    tiles[r.name] = await loadImage(readFileSync(r.path));
  }

  const SHEET_W = 1280;
  const ROW_H = 200; // image area per layer row
  const LABEL_H = 30; // label band per row
  const ROW_PITCH = ROW_H + LABEL_H;
  const TITLE_H = 40;
  const COMP_ROW_H = 240; // composite preview (taller, shows 2-tile stack)
  const COMP_LABEL_H = 30;
  const PAD = 20;

  const rows = results.length; // 4
  const SHEET_H = TITLE_H + rows * ROW_PITCH + COMP_LABEL_H + COMP_ROW_H + PAD * 2;

  const sheet = createCanvas(SHEET_W, SHEET_H);
  const ctx = sheet.getContext('2d');

  // Background.
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);

  // Title.
  ctx.fillStyle = '#e8e8ea';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('IMP Underworld — Parallax Tile Contact Sheet', PAD, 26);
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#8a8a90';
  ctx.fillText(
    'Left = tile once · Right = 2× repeat (watch the midpoint join for seams) · Bottom = full composite stack',
    PAD + 460,
    26,
  );

  let y = TITLE_H;

  // Per-layer rows.
  for (const r of results) {
    const tile = tiles[r.name];
    const isTransparent = r.bgHonored !== 'opaque-saved' && r.name !== 'sky';
    // Label band.
    ctx.fillStyle = '#cfcfd4';
    ctx.font = 'bold 13px sans-serif';
    const ratioTxt =
      r.bgHonored === 'green-key' && r.keyedRatio !== undefined
        ? `   green-key ${(r.keyedRatio * 100).toFixed(1)}% cut`
        : '';
    ctx.fillText(
      `${r.name}.png   factor ${r.factor.toFixed(2)}   ${r.finalW}×${r.finalH}   model ${r.model}` +
        (isTransparent ? `   transparent (${r.bgHonored})${ratioTxt}` : '   opaque'),
      PAD,
      y + 18,
    );

    const imgY = y + LABEL_H;
    const dispH = ROW_H;
    const dispW = (tile.width / tile.height) * dispH; // scaled width for one copy

    // LEFT: once.
    const onceX = PAD;
    const onceW = dispW;
    if (isTransparent) checkerboard(ctx, onceX, imgY, onceW, dispH);
    ctx.drawImage(tile, onceX, imgY, onceW, dispH);
    ctx.fillStyle = '#6a6a70';
    ctx.font = '10px sans-serif';
    ctx.fillText('1×', onceX + 4, imgY + 12);

    // RIGHT: 2× repeat — the seam-detection block.
    const gap = 16;
    const repX = onceX + onceW + gap;
    const repW = dispW; // each copy same width
    if (isTransparent) checkerboard(ctx, repX, imgY, repW * 2, dispH);
    ctx.drawImage(tile, repX, imgY, repW, dispH);
    ctx.drawImage(tile, repX + repW, imgY, repW, dispH);
    // Mark the midpoint seam.
    ctx.strokeStyle = '#ff4d4d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(repX + repW, imgY);
    ctx.lineTo(repX + repW, imgY + dispH);
    ctx.stroke();
    ctx.fillStyle = '#ff4d4d';
    ctx.font = '10px sans-serif';
    ctx.fillText('2×  seam ↓', repX + 4, imgY + 12);

    y += ROW_PITCH;
  }

  // Composite preview row: stack sky → far-fortress → mid-ruins → foreground.
  ctx.fillStyle = '#cfcfd4';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('COMPOSITE PREVIEW  (sky + far-fortress + mid-ruins + foreground, 2 tiles wide)', PAD, y + 18);
  y += COMP_LABEL_H;

  const compH = COMP_ROW_H;
  const skyTile = tiles['sky'];
  const compCopyW = (skyTile.width / skyTile.height) * compH;
  const compTotalW = compCopyW * 2; // two seamless tiles wide
  const compX = Math.round((SHEET_W - compTotalW) / 2);
  // Draw each layer twice (seamless), in depth order back→front.
  for (const name of ['sky', 'far-fortress', 'mid-ruins', 'foreground']) {
    if (!tiles[name]) continue;
    for (let i = 0; i < 2; i++) {
      ctx.drawImage(tiles[name], compX + i * compCopyW, y, compCopyW, compH);
    }
  }
  // Frame the composite.
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  ctx.strokeRect(compX, y, compTotalW, compH);

  const sheetPath = join(OUT_DIR, '_contact-sheet.png');
  writeFileSync(sheetPath, sheet.toBuffer('image/png'));
  console.log(`\nContact sheet written: ${sheetPath} (${SHEET_W}×${SHEET_H})`);
}

// ──────────────────────────────── greenscreen test sheet (--only) ───────────
/**
 * 3-panel greenscreen diagnostic sheet for a single transparent layer:
 *   1. RAW GREEN — source exactly as the model returned it (green visible).
 *   2. KEYED (checkerboard) — after green-key + despill + mirror-pad, drawn
 *      over a checkerboard so transparency + edge halos are legible.
 *   3. COMPOSITE OVER SKY — keyed+padded layer over sky.png, real context.
 *
 * Written to showcase/assets/parallax/_test-<name>.png. Used by the user to
 * judge whether the greenscreen technique is acceptable before regenerating
 * all transparent layers.
 */
async function buildTestSheet(
  layer: LayerSpec,
  result: LayerResult,
  rawCanvas: Canvas,
  finalCanvas: Canvas,
): Promise<void> {
  const PANEL_W = 640;
  const GUTTER = 20;
  const PAD = 20;
  const LABEL_H = 26;
  const TITLE_H = 56;
  // Tile aspect after mirror-pad is 2:1 (2W×H). Fit panel width → height.
  const panelH = Math.round(PANEL_W / 2); // 320

  // Try to load sky.png for the composite panel. Skip-with-note if missing.
  const skyPath = join(OUT_DIR, 'sky.png');
  let skyImg: Image | null = null;
  try {
    skyImg = await loadImage(readFileSync(skyPath));
  } catch {
    skyImg = null;
  }

  const panels = skyImg ? 3 : 2;
  const SHEET_W = PAD * 2 + panels * PANEL_W + (panels - 1) * GUTTER;
  const SHEET_H = PAD + TITLE_H + panelH + LABEL_H + PAD;

  const sheet = createCanvas(SHEET_W, SHEET_H);
  const ctx = sheet.getContext('2d');

  // Background.
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);

  // Title + stats line.
  ctx.fillStyle = '#e8e8ea';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(`GREENSCREEN TEST — ${layer.name}`, PAD, 28);
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#9a9aa0';
  const ratioPct =
    result.keyedRatio !== undefined ? (result.keyedRatio * 100).toFixed(1) : '?';
  const despillTxt =
    result.despillCount !== undefined ? result.despillCount.toLocaleString() : '?';
  const keyedTxt =
    result.chromaKeyedPx !== undefined
      ? result.chromaKeyedPx.toLocaleString()
      : '?';
  ctx.fillText(
    `bgHonored=${result.bgHonored} · native ${result.nativeW}×${result.nativeH} → mirror-padded ${result.finalW}×${result.finalH} · keyed<255px=${keyedTxt} · alpha<250=${ratioPct}% · despilled=${despillTxt}px`,
    PAD,
    46,
  );

  const imgY = PAD + TITLE_H;
  const labelY = imgY + panelH + 18;

  let px = PAD;

  // ── Panel 1: RAW GREEN ─────────────────────────────────────────────────
  ctx.drawImage(rawCanvas, px, imgY, PANEL_W, panelH);
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  ctx.strokeRect(px, imgY, PANEL_W, panelH);
  ctx.fillStyle = '#e8e8ea';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('1. RAW GREEN (model output)', px, labelY);
  px += PANEL_W + GUTTER;

  // ── Panel 2: KEYED (checkerboard) ──────────────────────────────────────
  checkerboard(ctx, px, imgY, PANEL_W, panelH);
  ctx.drawImage(finalCanvas, px, imgY, PANEL_W, panelH);
  ctx.strokeStyle = '#444';
  ctx.strokeRect(px, imgY, PANEL_W, panelH);
  ctx.fillStyle = '#e8e8ea';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('2. KEYED + despill + mirror-pad (checkerboard)', px, labelY);
  px += PANEL_W + GUTTER;

  // ── Panel 3: COMPOSITE OVER SKY ────────────────────────────────────────
  if (skyImg) {
    // Fit sky to panel (cover) then overlay foreground.
    ctx.drawImage(skyImg, px, imgY, PANEL_W, panelH);
    ctx.drawImage(finalCanvas, px, imgY, PANEL_W, panelH);
    ctx.strokeStyle = '#444';
    ctx.strokeRect(px, imgY, PANEL_W, panelH);
    ctx.fillStyle = '#e8e8ea';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('3. COMPOSITE OVER sky.png (real context)', px, labelY);
  } else if (panels === 3) {
    ctx.fillStyle = '#3a2222';
    ctx.fillRect(px, imgY, PANEL_W, panelH);
    ctx.fillStyle = '#ff8080';
    ctx.font = '12px sans-serif';
    ctx.fillText('sky.png missing — panel skipped', px + 8, imgY + panelH / 2);
  }

  const sheetPath = join(OUT_DIR, `_test-${layer.name}.png`);
  writeFileSync(sheetPath, sheet.toBuffer('image/png'));
  console.log(`\nGreenscreen test sheet written: ${sheetPath} (${SHEET_W}×${SHEET_H})`);
}

// ─────────────────────────────────────────── verify + orchestrate ──────────
async function main(): Promise<void> {
  console.log(`Output dir: ${OUT_DIR}`);

  // ── --only=<layer> mode: generate one layer + test sheet ────────────────
  if (ONLY_LAYER) {
    const layer = LAYERS.find((l) => l.name === ONLY_LAYER);
    if (!layer) {
      console.error(
        `\n✗ --only=${ONLY_LAYER} matches no layer. Known: ${LAYERS.map((l) => l.name).join(', ')}`,
      );
      process.exit(1);
    }
    console.log(`Single-layer mode: --only=${layer.name}\n`);

    const { result, rawCanvas, finalCanvas } = await buildLayer(layer);

    // Verify saved tile by reading dimensions back.
    const rb = await loadImage(readFileSync(result.path));
    const ok = rb.width === result.finalW && rb.height === result.finalH && rb.width > 0;
    console.log(
      `\nVerification (read-back): ${result.name}.png ${rb.width}×${rb.height} ${ok ? 'OK' : '✗ UNEXPECTED'} (${result.bgHonored})` +
        (result.warning ? `  ⚠ ${result.warning}` : ''),
    );

    // Build the greenscreen test sheet for transparent layers. For opaque
    // layers (e.g. sky) there's nothing to key — skip the sheet.
    if (layer.background === 'transparent') {
      await buildTestSheet(layer, result, rawCanvas, finalCanvas);
      // Sanity-check the cut-out ratio for the user.
      if (result.keyedRatio !== undefined) {
        const pct = result.keyedRatio * 100;
        const band = pct >= 40 && pct <= 60;
        console.log(
          `Cut-out ratio: ${pct.toFixed(1)}% alpha<250 ${band ? '(in expected 40–60% band ✓)' : '(outside 40–60% — inspect the test sheet)'}`,
        );
      }
    } else {
      console.log(`(opaque layer — no greenscreen test sheet)`);
    }

    console.log('\nDone.');
    return;
  }

  // ── full run ───────────────────────────────────────────────────────────
  console.log(`Layers: ${LAYERS.map((l) => l.name).join(', ')}\n`);

  const results: LayerResult[] = [];
  for (const layer of LAYERS) {
    try {
      const { result } = await buildLayer(layer);
      results.push(result);
    } catch (err) {
      console.error(`\n✗ FAILED layer "${layer.name}": ${(err as Error).message}`);
      console.error('  (continuing with remaining layers — regenerate this one separately.)');
    }
  }

  if (results.length === 0) {
    console.error('\nNo layers succeeded. Aborting contact sheet.');
    process.exit(1);
  }

  await buildContactSheet(results);

  // Verify saved PNGs by reading dimensions back.
  console.log('\nVerification (read-back):');
  for (const r of results) {
    const img = await loadImage(readFileSync(r.path));
    const ok = img.width === r.finalW && img.height === r.finalH && img.width > 0;
    console.log(
      `  ${r.name}.png: ${img.width}×${img.height} ${ok ? 'OK' : '✗ UNEXPECTED'} (${r.bgHonored})` +
        (r.warning ? `  ⚠ ${r.warning}` : ''),
    );
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});
