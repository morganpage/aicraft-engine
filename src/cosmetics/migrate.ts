/**
 * Defensive manifest migration (Pillar 2b).
 *
 * Never throws on any input — malformed JSON, non-objects, wrong versions,
 * unknown fields, and individually-broken skin entries all collapse
 * gracefully to a valid {@link CosmeticManifest}. The strategy is **parse →
 * validate/dedupe each skin by id → fall back to {@link DEFAULT_MANIFEST} if
 * the result is empty** (NOT a "rebuild default then overlay" strategy,
 * which suits player saves, not content manifests).
 *
 * All hex validation matches the {@link Palette} contract (`#rrggbb`); invalid
 * slots fall back to {@link DEFAULT_PALETTE}. No palette/OKLCH conversion runs
 * here — color logic is delegated entirely to `src/palette/`.
 *
 * @module
 */

import type { Palette } from '../palette/types';
import type { CosmeticManifest, Rarity, SkinPreset } from './types';
import {
  DEFAULT_MANIFEST,
  DEFAULT_PALETTE,
  DEFAULT_RARITY,
  DEFAULT_SCALE,
  DEFAULT_SKIN_PRESET,
  MANIFEST_VERSION,
  RARITY_TIERS,
  SCALE_MAX,
  SCALE_MIN,
} from './constants';

/** Exact `#rrggbb` format required by the {@link Palette} contract. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Truthy narrow for a plain non-null object record. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Clamp a finite number into `[min, max]`; return `fallback` for non-numbers. */
function clampFinite(n: unknown, min: number, max: number, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return n < min ? min : n > max ? max : n;
}

/** Validate a single palette slot hex, falling back when invalid. */
function migrateHex(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && HEX_RE.test(raw) ? raw : fallback;
}

/** Defensively parse a {@link Palette}; every slot defaults when missing/invalid. */
function migratePalette(raw: unknown): Palette {
  const p = { ...DEFAULT_PALETTE };
  if (isRecord(raw)) {
    p.outline = migrateHex(raw.outline, DEFAULT_PALETTE.outline);
    p.base = migrateHex(raw.base, DEFAULT_PALETTE.base);
    p.accent = migrateHex(raw.accent, DEFAULT_PALETTE.accent);
    p.feature = migrateHex(raw.feature, DEFAULT_PALETTE.feature);
    p.background = migrateHex(raw.background, DEFAULT_PALETTE.background);
  }
  return p;
}

/** Defensively parse a {@link Rarity}; unknown strings fall back to default. */
function migrateRarity(raw: unknown): Rarity {
  return typeof raw === 'string' && (RARITY_TIERS as readonly string[]).includes(raw)
    ? (raw as Rarity)
    : DEFAULT_RARITY;
}

/**
 * Defensively parse a single {@link SkinPreset}. Never throws.
 *
 * Missing/malformed fields fall back to {@link DEFAULT_SKIN_PRESET} values;
 * `scale` is clamped into `[SCALE_MIN, SCALE_MAX]`. Unknown sub-fields are
 * silently ignored (forward-compat for manifest v2+).
 *
 * Internal helper — not part of the module's public surface.
 */
function migrateSkinPreset(raw: unknown): SkinPreset {
  if (!isRecord(raw)) return { ...DEFAULT_SKIN_PRESET };
  const id =
    typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : DEFAULT_SKIN_PRESET.id;
  const name =
    typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : DEFAULT_SKIN_PRESET.name;
  const rarity = migrateRarity(raw.rarity);
  const palette = migratePalette(raw.palette);
  const scale = clampFinite(raw.scale, SCALE_MIN, SCALE_MAX, DEFAULT_SCALE);
  return { id, name, rarity, palette, scale };
}

/**
 * Defensively parse a raw manifest into a valid {@link CosmeticManifest}.
 * **Never throws.**
 *
 * Algorithm:
 *   1. Gate on `version === targetVersion` (defaults to {@link MANIFEST_VERSION}).
 *   2. Parse each skin entry defensively; **dedupe by `id`, last entry wins**
 *      (later definitions patch earlier ones — content-pack semantics), with
 *      first-seen ordering preserved.
 *   3. Drop entries that aren't objects, keeping the rest.
 *   4. If zero skins survive, fall back to {@link DEFAULT_MANIFEST}.
 *
 * @example
 * ```ts
 * const manifest = migrateManifest(JSON.parse(rawJson));
 * // manifest is always valid; never throws on corrupt/unknown payloads.
 * ```
 *
 * @param raw           - Arbitrary persisted data (e.g. a `JSON.parse` result).
 * @param targetVersion - Schema version to accept. Defaults to {@link MANIFEST_VERSION}.
 * @returns A valid, non-empty {@link CosmeticManifest}. Never throws.
 */
export function migrateManifest(
  raw: unknown,
  targetVersion: number = MANIFEST_VERSION,
): CosmeticManifest {
  const fallback = (): CosmeticManifest => ({
    version: DEFAULT_MANIFEST.version,
    skins: DEFAULT_MANIFEST.skins.map((s) => ({ ...s, palette: { ...s.palette } })),
  });

  if (!isRecord(raw)) return fallback();
  if (raw.version !== targetVersion) return fallback();

  const skins: SkinPreset[] = [];
  if (Array.isArray(raw.skins)) {
    for (const entry of raw.skins) {
      // Non-object entries are dropped, not coerced — one corrupt entry must
      // never flood the manifest with default-skin duplicates.
      if (!isRecord(entry)) continue;
      const parsed = migrateSkinPreset(entry);
      const existingIdx = skins.findIndex((s) => s.id === parsed.id);
      if (existingIdx >= 0) {
        skins[existingIdx] = parsed;
      } else {
        skins.push(parsed);
      }
    }
  }

  if (skins.length === 0) return fallback();
  return { version: targetVersion, skins };
}
